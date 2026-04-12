use actix_web::{web, HttpResponse};
use regex::Regex;
use serde::Serialize;
use serde_json::json;
use std::cmp::Ordering;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;

const NIGHTLY_INDEX_URL: &str = "http://downloads.simulationcraft.org/nightly/?C=M;O=D";
const NIGHTLY_BASE_URL: &str = "http://downloads.simulationcraft.org/nightly/";
const VERSION_MARKER: &str = ".simc-version";

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
    installed_path: String,
    installed_exists: bool,
    installed_version: Option<String>,
    latest_version: Option<String>,
    latest_download: Option<String>,
    update_available: bool,
    checking_failed: bool,
    detail: Option<String>,
    is_updating: bool,
}

pub(super) async fn simc_status(
    simc_path: web::Data<PathBuf>,
    updater: web::Data<SimcUpdaterState>,
) -> HttpResponse {
    let simc_path = simc_path.get_ref().clone();
    let installed_exists = simc_path.exists();
    let installed_version = detect_installed_version(&simc_path);

    let mut checking_failed = false;
    let mut detail = None;
    let mut latest_version = None;
    let mut latest_download = None;
    let mut update_available = !installed_exists;

    match fetch_latest_windows_asset().await {
        Ok(latest) => {
            latest_version = Some(latest.version.clone());
            latest_download = Some(latest.url.clone());
            update_available = !installed_exists
                || installed_version
                    .as_deref()
                    .map(|v| is_update_available(v, &latest.version))
                    .unwrap_or(true);
        }
        Err(err) => {
            checking_failed = true;
            detail = Some(err);
        }
    }

    let is_updating = updater.lock.try_lock().is_err();

    HttpResponse::Ok().json(SimcStatusResponse {
        installed_path: simc_path.to_string_lossy().to_string(),
        installed_exists,
        installed_version,
        latest_version,
        latest_download,
        update_available,
        checking_failed,
        detail,
        is_updating,
    })
}

pub(super) async fn download_latest_simc(
    simc_path: web::Data<PathBuf>,
    updater: web::Data<SimcUpdaterState>,
) -> HttpResponse {
    if !cfg!(windows) {
        return HttpResponse::BadRequest().json(json!({
            "detail": "Automatic SimC updates are currently supported only on Windows desktop builds."
        }));
    }

    let lock = match updater.lock.try_lock() {
        Ok(lock) => lock,
        Err(_) => {
            return HttpResponse::Conflict().json(json!({
                "detail": "A SimC update is already in progress."
            }));
        }
    };

    let result = do_download_latest(simc_path.get_ref().clone()).await;
    drop(lock);

    match result {
        Ok(()) => simc_status(simc_path, updater).await,
        Err(err) => HttpResponse::InternalServerError().json(json!({
            "detail": err
        })),
    }
}

async fn do_download_latest(simc_path: PathBuf) -> Result<(), String> {
    let latest = fetch_latest_windows_asset().await?;

    let install_dir = simc_path
        .parent()
        .map(Path::to_path_buf)
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
        move || install_from_archive(&archive_path, &extract_dir, &install_dir, &latest)
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

    Ok(())
}

async fn fetch_latest_windows_asset() -> Result<RemoteAsset, String> {
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
    let filename = re
        .captures_iter(&body)
        .find_map(|caps| caps.name("file").map(|m| m.as_str().to_string()))
        .ok_or_else(|| {
            "Could not locate a Windows nightly archive in the SimC index.".to_string()
        })?;

    let archive_kind = if filename.to_ascii_lowercase().ends_with(".7z") {
        ArchiveKind::SevenZip
    } else {
        ArchiveKind::Zip
    };

    let version = parse_version_from_filename(&filename).unwrap_or_else(|| filename.clone());
    let url = format!("{}{}", NIGHTLY_BASE_URL, filename);

    Ok(RemoteAsset {
        version,
        filename,
        url,
        archive_kind,
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
