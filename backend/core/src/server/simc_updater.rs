use actix_web::{web, HttpResponse};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::cmp::Ordering;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;

const NIGHTLY_INDEX_URL: &str = "http://downloads.simulationcraft.org/nightly/?C=M;O=D";
const NIGHTLY_BASE_URL: &str = "http://downloads.simulationcraft.org/nightly/";
const VERSION_MARKER: &str = ".simc-version";
const CHANNEL_MARKER: &str = ".simc-channel";
const CHANNELS_DIR: &str = "channels";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum SimcChannel {
    Latest,
    Weekly,
    Nightly,
}

impl SimcChannel {
    pub(super) fn as_str(self) -> &'static str {
        match self {
            Self::Latest => "latest",
            Self::Weekly => "weekly",
            Self::Nightly => "nightly",
        }
    }

    fn from_input(raw: &str) -> Result<Self, String> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "" | "latest" => Ok(Self::Latest),
            "weekly" => Ok(Self::Weekly),
            "nightly" => Ok(Self::Nightly),
            other => Err(format!(
                "Unsupported SimC channel '{}'. Use latest, weekly, or nightly.",
                other
            )),
        }
    }
}

#[derive(Debug, Deserialize)]
pub(super) struct SimcChannelQuery {
    #[serde(default)]
    pub channel: String,
}

impl SimcChannelQuery {
    fn resolve_channel(&self) -> Result<SimcChannel, String> {
        SimcChannel::from_input(&self.channel)
    }
}

#[derive(Clone)]
pub(super) struct SimcUpdaterState {
    lock: Arc<Mutex<()>>,
}

impl SimcUpdaterState {
    pub(super) fn new() -> Self {
        Self {
            lock: Arc::new(Mutex::new(())),
        }
    }
}

#[derive(Debug, Clone)]
enum ArchiveKind {
    SevenZip,
    Zip,
}

#[derive(Debug, Clone)]
struct RemoteAsset {
    version: String,
    filename: String,
    url: String,
    archive_kind: ArchiveKind,
}

#[derive(Debug, Clone)]
struct ParsedVersion {
    major: u32,
    minor: u32,
    extra: Option<String>,
}

#[derive(Serialize)]
struct SimcStatusResponse {
    channel: String,
    installed_path: String,
    installed_exists: bool,
    installed_version: Option<String>,
    installed_channel: Option<String>,
    latest_version: Option<String>,
    latest_download: Option<String>,
    available_versions: HashMap<String, Option<String>>,
    available_downloads: HashMap<String, Option<String>>,
    update_available: bool,
    checking_failed: bool,
    detail: Option<String>,
    is_updating: bool,
}

pub(super) async fn simc_status(
    simc_path: web::Data<PathBuf>,
    updater: web::Data<SimcUpdaterState>,
    query: web::Query<SimcChannelQuery>,
) -> HttpResponse {
    let channel = match query.resolve_channel() {
        Ok(value) => value,
        Err(detail) => {
            return HttpResponse::BadRequest().json(json!({ "detail": detail }));
        }
    };

    let is_updating = updater.lock.try_lock().is_err();
    let status = build_status_response(simc_path.get_ref().clone(), channel, is_updating).await;

    HttpResponse::Ok().json(status)
}

pub(super) async fn download_latest_simc(
    simc_path: web::Data<PathBuf>,
    updater: web::Data<SimcUpdaterState>,
    query: web::Query<SimcChannelQuery>,
) -> HttpResponse {
    if !cfg!(windows) {
        return HttpResponse::BadRequest().json(json!({
            "detail": "Automatic SimC updates are currently supported only on Windows desktop builds."
        }));
    }

    let channel = match query.resolve_channel() {
        Ok(value) => value,
        Err(detail) => {
            return HttpResponse::BadRequest().json(json!({ "detail": detail }));
        }
    };

    let lock = match updater.lock.try_lock() {
        Ok(lock) => lock,
        Err(_) => {
            return HttpResponse::Conflict().json(json!({
                "detail": "A SimC update is already in progress."
            }));
        }
    };

    let result = do_download_channel(simc_path.get_ref().clone(), channel).await;
    drop(lock);

    match result {
        Ok(()) => HttpResponse::Ok()
            .json(build_status_response(simc_path.get_ref().clone(), channel, false).await),
        Err(err) => HttpResponse::InternalServerError().json(json!({
            "detail": err
        })),
    }
}

pub(super) fn resolve_installed_binary_for_channel(
    simc_path: &Path,
    requested_channel: Option<&str>,
) -> Option<PathBuf> {
    let channel = requested_channel
        .and_then(|raw| SimcChannel::from_input(raw).ok())
        .unwrap_or(SimcChannel::Latest);

    if let Some(channel_bin) = channel_binary_path(simc_path, channel) {
        if channel_bin.exists() {
            return Some(channel_bin);
        }
    }

    if simc_path.exists() {
        return Some(simc_path.to_path_buf());
    }

    None
}

async fn build_status_response(
    simc_path: PathBuf,
    channel: SimcChannel,
    is_updating: bool,
) -> SimcStatusResponse {
    let requested_channel_bin =
        channel_binary_path(&simc_path, channel).unwrap_or(simc_path.clone());
    let mut effective_installed_path = requested_channel_bin.clone();
    let mut installed_exists = effective_installed_path.exists();

    if !installed_exists && simc_path.exists() {
        effective_installed_path = simc_path.clone();
        installed_exists = true;
    }

    let installed_version = detect_installed_version(&effective_installed_path);
    let installed_channel = detect_installed_channel(&effective_installed_path, channel);

    let mut checking_failed = false;
    let mut detail = None;
    let mut latest_version = None;
    let mut latest_download = None;
    let mut available_versions: HashMap<String, Option<String>> = HashMap::new();
    let mut available_downloads: HashMap<String, Option<String>> = HashMap::new();
    let mut update_available = !installed_exists;

    match fetch_channel_assets().await {
        Ok(assets) => {
            for (name, maybe_asset) in [
                ("latest", assets.latest.clone()),
                ("weekly", assets.weekly.clone()),
                ("nightly", assets.nightly.clone()),
            ] {
                available_versions.insert(
                    name.to_string(),
                    maybe_asset.as_ref().map(|a| a.version.clone()),
                );
                available_downloads.insert(
                    name.to_string(),
                    maybe_asset.as_ref().map(|a| a.url.clone()),
                );
            }

            if let Some(latest_asset) = assets.for_channel(channel) {
                latest_version = Some(latest_asset.version.clone());
                latest_download = Some(latest_asset.url.clone());
                update_available = !installed_exists
                    || installed_version
                        .as_deref()
                        .map(|v| is_update_available(v, &latest_asset.version))
                        .unwrap_or(true);
            } else {
                checking_failed = true;
                detail = Some(format!(
                    "No Windows SimC archive found for '{}' channel.",
                    channel.as_str()
                ));
            }
        }
        Err(err) => {
            checking_failed = true;
            detail = Some(err);
        }
    }

    SimcStatusResponse {
        channel: channel.as_str().to_string(),
        installed_path: effective_installed_path.to_string_lossy().to_string(),
        installed_exists,
        installed_version,
        installed_channel,
        latest_version,
        latest_download,
        available_versions,
        available_downloads,
        update_available,
        checking_failed,
        detail,
        is_updating,
    }
}

async fn do_download_channel(simc_path: PathBuf, channel: SimcChannel) -> Result<(), String> {
    let assets = fetch_channel_assets().await?;
    let latest = assets.for_channel(channel).ok_or_else(|| {
        format!(
            "No downloadable Windows SimC archive found for '{}' channel.",
            channel.as_str()
        )
    })?;

    let install_dir = channel_install_dir(&simc_path, channel)
        .ok_or_else(|| "Invalid SimC path (missing parent directory)".to_string())?;
    std::fs::create_dir_all(&install_dir).map_err(|e| {
        format!(
            "Failed to create SimC install directory {}: {}",
            install_dir.display(),
            e
        )
    })?;

    let temp_root =
        std::env::temp_dir().join(format!("whylowdps-simc-update-{}", uuid::Uuid::new_v4()));
    let extract_dir = temp_root.join("extracted");
    let archive_path = temp_root.join(&latest.filename);

    std::fs::create_dir_all(&extract_dir).map_err(|e| {
        format!(
            "Failed to create temporary extraction directory {}: {}",
            extract_dir.display(),
            e
        )
    })?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(240))
        .user_agent("whylowdps-desktop/0.3")
        .build()
        .map_err(|e| format!("Failed to initialize HTTP client: {e}"))?;

    let response = client
        .get(&latest.url)
        .send()
        .await
        .map_err(|e| format!("Failed to download latest SimC build: {e}"))?;
    if !response.status().is_success() {
        let status = response.status();
        let _ = std::fs::remove_dir_all(&temp_root);
        return Err(format!(
            "SimC download failed with HTTP status {} for {}",
            status, latest.url
        ));
    }

    let body = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read SimC download body: {e}"))?;
    std::fs::write(&archive_path, &body).map_err(|e| {
        format!(
            "Failed to write SimC archive to {}: {}",
            archive_path.display(),
            e
        )
    })?;

    let install_result = tokio::task::spawn_blocking({
        let archive_path = archive_path.clone();
        let extract_dir = extract_dir.clone();
        let install_dir = install_dir.clone();
        let latest = latest.clone();
        move || install_from_archive(&archive_path, &extract_dir, &install_dir, &latest, channel)
    })
    .await
    .map_err(|e| format!("SimC installation task failed to complete: {e}"))?;

    let cleanup_err = std::fs::remove_dir_all(&temp_root).err();

    install_result?;

    if let Some(err) = cleanup_err {
        eprintln!(
            "Warning: failed to clean temporary SimC updater directory {}: {}",
            temp_root.display(),
            err
        );
    }

    Ok(())
}

fn install_from_archive(
    archive_path: &Path,
    extract_dir: &Path,
    install_dir: &Path,
    latest: &RemoteAsset,
    channel: SimcChannel,
) -> Result<(), String> {
    match latest.archive_kind {
        ArchiveKind::SevenZip => sevenz_rust::decompress_file(archive_path, extract_dir)
            .map_err(|e| format!("Failed to extract SimC 7z archive: {e}"))?,
        ArchiveKind::Zip => extract_zip_archive(archive_path, extract_dir)?,
    };

    let extracted_bin = find_simc_binary(extract_dir).ok_or_else(|| {
        format!(
            "Could not find simc executable after extracting {}",
            archive_path.display()
        )
    })?;

    let source_dir = extracted_bin
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "Failed to resolve extracted SimC folder".to_string())?;

    clear_directory(install_dir)?;
    copy_dir_contents(&source_dir, install_dir)?;

    let expected_bin = install_dir.join(binary_filename());
    if !expected_bin.exists() {
        return Err(format!(
            "Installation finished but {} is missing",
            expected_bin.display()
        ));
    }

    std::fs::write(install_dir.join(VERSION_MARKER), latest.version.as_bytes())
        .map_err(|e| format!("Failed to persist installed SimC version marker: {e}"))?;
    std::fs::write(
        install_dir.join(CHANNEL_MARKER),
        channel.as_str().as_bytes(),
    )
    .map_err(|e| format!("Failed to persist installed SimC channel marker: {e}"))?;

    Ok(())
}

#[derive(Debug, Clone, Default)]
struct ChannelAssets {
    latest: Option<RemoteAsset>,
    weekly: Option<RemoteAsset>,
    nightly: Option<RemoteAsset>,
}

impl ChannelAssets {
    fn for_channel(&self, channel: SimcChannel) -> Option<RemoteAsset> {
        match channel {
            SimcChannel::Latest => self.latest.clone(),
            SimcChannel::Weekly => self.weekly.clone(),
            SimcChannel::Nightly => self.nightly.clone(),
        }
    }
}

async fn fetch_channel_assets() -> Result<ChannelAssets, String> {
    let body = reqwest::Client::builder()
        .timeout(Duration::from_secs(45))
        .user_agent("whylowdps-desktop/0.3")
        .build()
        .map_err(|e| format!("Failed to initialize HTTP client: {e}"))?
        .get(NIGHTLY_INDEX_URL)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch SimC nightly index: {e}"))?
        .error_for_status()
        .map_err(|e| format!("SimC nightly index responded with an error: {e}"))?
        .text()
        .await
        .map_err(|e| format!("Failed to read SimC nightly index body: {e}"))?;

    let re = Regex::new(r#"href="(?P<file>simc-[^"]+-win64\.(?:7z|zip))""#)
        .map_err(|e| format!("Failed to build nightly parser regex: {e}"))?;
    let mut assets: Vec<RemoteAsset> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    for caps in re.captures_iter(&body) {
        let Some(matched) = caps.name("file").map(|m| m.as_str().to_string()) else {
            continue;
        };
        if !seen.insert(matched.clone()) {
            continue;
        }

        let archive_kind = if matched.to_ascii_lowercase().ends_with(".7z") {
            ArchiveKind::SevenZip
        } else {
            ArchiveKind::Zip
        };
        let version = parse_version_from_filename(&matched).unwrap_or_else(|| matched.clone());

        assets.push(RemoteAsset {
            version,
            filename: matched.clone(),
            url: format!("{}{}", NIGHTLY_BASE_URL, matched),
            archive_kind,
        });
    }

    if assets.is_empty() {
        return Err("Could not locate a Windows nightly archive in the SimC index.".to_string());
    }

    let nightly = assets.first().cloned();
    let latest = assets
        .iter()
        .find(|asset| !looks_like_commit_build(&asset.version))
        .cloned()
        .or_else(|| nightly.clone());
    let weekly = assets.get(1).cloned().or_else(|| nightly.clone());

    Ok(ChannelAssets {
        latest,
        weekly,
        nightly,
    })
}

fn parse_version_from_filename(filename: &str) -> Option<String> {
    let lower = filename.to_ascii_lowercase();
    let archive_ext = if lower.ends_with(".7z") {
        ".7z"
    } else if lower.ends_with(".zip") {
        ".zip"
    } else {
        return None;
    };

    let without_ext = filename.strip_suffix(archive_ext)?;
    let core = without_ext.strip_prefix("simc-")?.strip_suffix("-win64")?;
    Some(core.to_string())
}

fn looks_like_commit_build(version: &str) -> bool {
    let parts: Vec<&str> = version.split('.').collect();
    if parts.len() < 3 {
        return false;
    }
    let tail = parts.last().copied().unwrap_or_default();
    tail.len() >= 6 && tail.chars().all(|c| c.is_ascii_hexdigit())
}

fn channel_install_dir(simc_path: &Path, channel: SimcChannel) -> Option<PathBuf> {
    simc_path
        .parent()
        .map(|root| root.join(CHANNELS_DIR).join(channel.as_str()))
}

fn channel_binary_path(simc_path: &Path, channel: SimcChannel) -> Option<PathBuf> {
    channel_install_dir(simc_path, channel).map(|dir| dir.join(binary_filename()))
}

fn detect_installed_channel(simc_path: &Path, requested: SimcChannel) -> Option<String> {
    if !simc_path.exists() {
        return None;
    }

    let marker = simc_path.parent()?.join(CHANNEL_MARKER);
    if marker.exists() {
        if let Ok(raw) = std::fs::read_to_string(marker) {
            let trimmed = raw.trim().to_ascii_lowercase();
            if !trimmed.is_empty() {
                return Some(trimmed);
            }
        }
    }

    let parent = simc_path.parent()?;
    let comps: Vec<String> = parent
        .components()
        .map(|c| c.as_os_str().to_string_lossy().to_ascii_lowercase())
        .collect();
    let requested_str = requested.as_str().to_string();
    let is_channel_path = comps.windows(2).any(|pair| {
        pair.first().is_some_and(|value| value == CHANNELS_DIR)
            && pair.get(1).is_some_and(|value| value == &requested_str)
    });
    if is_channel_path {
        return Some(requested.as_str().to_string());
    }

    Some("legacy".to_string())
}

fn detect_installed_version(simc_path: &Path) -> Option<String> {
    if !simc_path.exists() {
        return None;
    }

    let marker = simc_path.parent()?.join(VERSION_MARKER);
    if marker.exists() {
        if let Ok(raw) = std::fs::read_to_string(marker) {
            let trimmed = raw.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }

    detect_version_from_binary(simc_path)
}

fn detect_version_from_binary(simc_path: &Path) -> Option<String> {
    let output = Command::new(simc_path).arg("--version").output().ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined = format!("{stdout}\n{stderr}");
    extract_version_like_value(&combined)
}

fn extract_version_like_value(text: &str) -> Option<String> {
    let re = Regex::new(r"(?i)\b(\d{4}[.-]\d{2}(?:[.-][0-9a-z]+)?)\b").ok()?;
    let capture = re.captures(text)?;
    Some(capture.get(1)?.as_str().replace('-', "."))
}

fn is_update_available(installed: &str, latest: &str) -> bool {
    match compare_versions(installed, latest) {
        Some(Ordering::Less) => true,
        Some(Ordering::Equal) => false,
        Some(Ordering::Greater) => false,
        None => normalize_version(installed) != normalize_version(latest),
    }
}

fn compare_versions(a: &str, b: &str) -> Option<Ordering> {
    let a = parse_version(a)?;
    let b = parse_version(b)?;

    Some(
        a.major
            .cmp(&b.major)
            .then(a.minor.cmp(&b.minor))
            .then_with(|| match (&a.extra, &b.extra) {
                (None, None) => Ordering::Equal,
                (None, Some(_)) => Ordering::Less,
                (Some(_), None) => Ordering::Greater,
                (Some(a), Some(b)) => a.cmp(b),
            }),
    )
}

fn parse_version(input: &str) -> Option<ParsedVersion> {
    let re = Regex::new(r"(?i)(\d{4})[.-](\d{2})(?:[.-]([0-9a-z]+))?").ok()?;
    let caps = re.captures(input)?;
    let major = caps.get(1)?.as_str().parse::<u32>().ok()?;
    let minor = caps.get(2)?.as_str().parse::<u32>().ok()?;
    let extra = caps.get(3).map(|m| m.as_str().to_ascii_lowercase());
    Some(ParsedVersion {
        major,
        minor,
        extra,
    })
}

fn normalize_version(value: &str) -> String {
    value.trim().to_ascii_lowercase().replace('-', ".")
}

fn extract_zip_archive(archive_path: &Path, dest: &Path) -> Result<(), String> {
    let reader = std::fs::File::open(archive_path).map_err(|e| {
        format!(
            "Failed to open zip archive {}: {}",
            archive_path.display(),
            e
        )
    })?;
    let mut archive =
        zip::ZipArchive::new(reader).map_err(|e| format!("Failed to parse zip archive: {e}"))?;

    for idx in 0..archive.len() {
        let mut file = archive
            .by_index(idx)
            .map_err(|e| format!("Failed reading zip entry {idx}: {e}"))?;
        let Some(safe_path) = file.enclosed_name().map(|path| path.to_path_buf()) else {
            continue;
        };

        let out = dest.join(safe_path);
        if file.is_dir() {
            std::fs::create_dir_all(&out).map_err(|e| {
                format!(
                    "Failed creating directory while extracting zip {}: {}",
                    out.display(),
                    e
                )
            })?;
            continue;
        }

        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                format!(
                    "Failed creating parent directory while extracting zip {}: {}",
                    parent.display(),
                    e
                )
            })?;
        }

        let mut out_file = std::fs::File::create(&out)
            .map_err(|e| format!("Failed creating extracted file {}: {}", out.display(), e))?;
        std::io::copy(&mut file, &mut out_file)
            .map_err(|e| format!("Failed writing extracted file {}: {}", out.display(), e))?;
    }

    Ok(())
}

fn find_simc_binary(search_root: &Path) -> Option<PathBuf> {
    let target = binary_filename();
    if search_root.join(target).exists() {
        return Some(search_root.join(target));
    }

    let mut queue = vec![search_root.to_path_buf()];
    while let Some(dir) = queue.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                queue.push(path);
                continue;
            }

            let is_match = path
                .file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.eq_ignore_ascii_case(target))
                .unwrap_or(false);

            if is_match {
                return Some(path);
            }
        }
    }

    None
}

fn clear_directory(dir: &Path) -> Result<(), String> {
    if !dir.exists() {
        std::fs::create_dir_all(dir).map_err(|e| {
            format!(
                "Failed to create install directory {}: {}",
                dir.display(),
                e
            )
        })?;
        return Ok(());
    }

    let entries = std::fs::read_dir(dir)
        .map_err(|e| format!("Failed to read install directory {}: {}", dir.display(), e))?;
    for entry in entries {
        let entry =
            entry.map_err(|e| format!("Failed to enumerate install directory entries: {e}"))?;
        let path = entry.path();
        if path.is_dir() {
            std::fs::remove_dir_all(&path).map_err(|e| {
                format!(
                    "Failed to remove old SimC directory {} (is a simulation still running?): {}",
                    path.display(),
                    e
                )
            })?;
        } else {
            std::fs::remove_file(&path).map_err(|e| {
                format!(
                    "Failed to remove old SimC file {} (is a simulation still running?): {}",
                    path.display(),
                    e
                )
            })?;
        }
    }

    Ok(())
}

fn copy_dir_contents(src: &Path, dst: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| {
        format!(
            "Failed creating destination directory {}: {}",
            dst.display(),
            e
        )
    })?;

    let entries = std::fs::read_dir(src).map_err(|e| {
        format!(
            "Failed to read extracted SimC directory {}: {}",
            src.display(),
            e
        )
    })?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to enumerate extracted files: {e}"))?;
        let source_path = entry.path();
        let target_path = dst.join(entry.file_name());

        if source_path.is_dir() {
            copy_dir_contents(&source_path, &target_path)?;
        } else {
            std::fs::copy(&source_path, &target_path).map_err(|e| {
                format!(
                    "Failed copying {} to {}: {}",
                    source_path.display(),
                    target_path.display(),
                    e
                )
            })?;
        }
    }

    Ok(())
}

fn binary_filename() -> &'static str {
    if cfg!(windows) {
        "simc.exe"
    } else {
        "simc"
    }
}
