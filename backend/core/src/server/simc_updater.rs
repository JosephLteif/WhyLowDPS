use actix_web::{web, HttpResponse};
use futures_util::StreamExt;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::cmp::Ordering;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::time::Duration;
use std::time::Instant;
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;

const NIGHTLY_LINK_WIN64_URL: &str =
    "https://nightly.link/simulationcraft/simc-publish/workflows/nightly/master/simc-nightly-win64-midnight.zip";
const NIGHTLY_LINK_WIN64_FILENAME: &str = "simc-nightly-win64-midnight.zip";
const NIGHTLY_INDEX_URL: &str = "http://downloads.simulationcraft.org/nightly/?C=M;O=D";
const NIGHTLY_BASE_URL: &str = "http://downloads.simulationcraft.org/nightly/";
const VERSION_MARKER: &str = ".simc-version";
const CHANNEL_MARKER: &str = ".simc-channel";
const CHANNELS_DIR: &str = "channels";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum SimcChannel {
    Stable,
    Nightly,
}

impl SimcChannel {
    pub(super) fn as_str(self) -> &'static str {
        match self {
            Self::Stable => "stable",
            Self::Nightly => "nightly",
        }
    }
}

#[derive(Debug, Deserialize)]
pub(super) struct SimcChannelQuery {}

#[derive(Clone)]
pub(super) struct SimcUpdaterState {
    lock: Arc<Mutex<()>>,
    progress: Arc<std::sync::Mutex<Option<DownloadProgressState>>>,
}

impl SimcUpdaterState {
    pub(super) fn new() -> Self {
        Self {
            lock: Arc::new(Mutex::new(())),
            progress: Arc::new(std::sync::Mutex::new(None)),
        }
    }

    fn begin_download(&self, channel: SimcChannel, bytes_total: Option<u64>) {
        if let Ok(mut guard) = self.progress.lock() {
            *guard = Some(DownloadProgressState {
                channel: channel.as_str().to_string(),
                phase: "downloading".to_string(),
                unit: ProgressUnit::Bytes,
                bytes_downloaded: 0,
                bytes_total,
                phase_started_at: Instant::now(),
                updated_at: Instant::now(),
            });
        }
    }

    fn set_phase(&self, phase: &str, unit: ProgressUnit, bytes_total: Option<u64>) {
        if let Ok(mut guard) = self.progress.lock() {
            if let Some(progress) = guard.as_mut() {
                progress.phase = phase.to_string();
                progress.unit = unit;
                progress.bytes_total = bytes_total;
                progress.bytes_downloaded = 0;
                progress.phase_started_at = Instant::now();
                progress.updated_at = Instant::now();
            }
        }
    }

    fn update_downloaded(&self, bytes_downloaded: u64) {
        if let Ok(mut guard) = self.progress.lock() {
            if let Some(progress) = guard.as_mut() {
                progress.bytes_downloaded = bytes_downloaded;
                progress.updated_at = Instant::now();
            }
        }
    }

    fn clear_progress(&self) {
        if let Ok(mut guard) = self.progress.lock() {
            *guard = None;
        }
    }

    fn snapshot(&self) -> Option<DownloadProgressResponse> {
        let guard = self.progress.lock().ok()?;
        let current = guard.as_ref()?;
        let elapsed_secs = current.phase_started_at.elapsed().as_secs_f64();
        let speed_bps = if elapsed_secs > 0.2 {
            Some(current.bytes_downloaded as f64 / elapsed_secs)
        } else {
            None
        };
        let percent = current
            .bytes_total
            .filter(|total| *total > 0)
            .map(|total| (current.bytes_downloaded as f64 / total as f64) * 100.0)
            .map(|p| p.clamp(0.0, 100.0));
        let eta_seconds = match (current.bytes_total, speed_bps) {
            (Some(total), Some(speed)) if speed > 0.1 && total > current.bytes_downloaded => {
                let remaining = (total - current.bytes_downloaded) as f64;
                Some((remaining / speed).ceil().max(0.0) as u64)
            }
            _ => None,
        };

        Some(DownloadProgressResponse {
            channel: current.channel.clone(),
            phase: current.phase.clone(),
            unit: current.unit.as_str().to_string(),
            bytes_downloaded: current.bytes_downloaded,
            bytes_total: current.bytes_total,
            speed_bps,
            percent,
            eta_seconds,
            elapsed_seconds: current.phase_started_at.elapsed().as_secs(),
        })
    }
}

#[derive(Debug, Clone)]
struct DownloadProgressState {
    channel: String,
    phase: String,
    unit: ProgressUnit,
    bytes_downloaded: u64,
    bytes_total: Option<u64>,
    phase_started_at: Instant,
    updated_at: Instant,
}

#[derive(Debug, Clone, Serialize)]
struct DownloadProgressResponse {
    channel: String,
    phase: String,
    unit: String,
    bytes_downloaded: u64,
    bytes_total: Option<u64>,
    speed_bps: Option<f64>,
    percent: Option<f64>,
    eta_seconds: Option<u64>,
    elapsed_seconds: u64,
}

#[derive(Debug, Clone, Copy)]
enum ProgressUnit {
    Bytes,
}

impl ProgressUnit {
    fn as_str(self) -> &'static str {
        match self {
            Self::Bytes => "bytes",
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
    suffix: Option<String>,
}

#[derive(Serialize)]
struct SimcStatusResponse {
    channel: String,
    channel_path: String,
    installed_path: String,
    installed_exists: bool,
    installed_version: Option<String>,
    installed_date: Option<String>,
    installed_channel: Option<String>,
    latest_version: Option<String>,
    latest_download: Option<String>,
    available_versions: HashMap<String, Option<String>>,
    available_downloads: HashMap<String, Option<String>>,
    update_available: bool,
    checking_failed: bool,
    detail: Option<String>,
    is_updating: bool,
    download_progress: Option<DownloadProgressResponse>,
}

pub(super) async fn simc_status(
    simc_path: web::Data<PathBuf>,
    updater: web::Data<SimcUpdaterState>,
    _query: web::Query<SimcChannelQuery>,
) -> HttpResponse {
    let channel = SimcChannel::Nightly;

    let is_updating = updater.lock.try_lock().is_err();
    let status =
        build_status_response(simc_path.get_ref().clone(), channel, is_updating, &updater).await;

    HttpResponse::Ok().json(status)
}

pub(super) async fn download_latest_simc(
    simc_path: web::Data<PathBuf>,
    updater: web::Data<SimcUpdaterState>,
    _query: web::Query<SimcChannelQuery>,
) -> HttpResponse {
    if !cfg!(windows) {
        return HttpResponse::BadRequest().json(json!({
            "detail": "Automatic SimC updates are currently supported only on Windows desktop builds."
        }));
    }

    let channel = SimcChannel::Nightly;

    let lock = match updater.lock.try_lock() {
        Ok(lock) => lock,
        Err(_) => {
            return HttpResponse::Conflict().json(json!({
                "detail": "A SimC update is already in progress."
            }));
        }
    };

    let result = do_download_channel(simc_path.get_ref().clone(), channel, &updater).await;
    drop(lock);

    match result {
        Ok(()) => HttpResponse::Ok().json(
            build_status_response(simc_path.get_ref().clone(), channel, false, &updater).await,
        ),
        Err(err) => HttpResponse::InternalServerError().json(json!({
            "detail": err
        })),
    }
}

pub(super) async fn remove_simc_channel(
    simc_path: web::Data<PathBuf>,
    updater: web::Data<SimcUpdaterState>,
    _query: web::Query<SimcChannelQuery>,
) -> HttpResponse {
    let channel = SimcChannel::Nightly;

    let lock = match updater.lock.try_lock() {
        Ok(lock) => lock,
        Err(_) => {
            return HttpResponse::Conflict().json(json!({
                "detail": "A SimC update is already in progress."
            }));
        }
    };

    let root_path = simc_path.get_ref().as_path();
    let installed_count = installed_channel_count(root_path);
    let is_target_installed = channel_binary_path(root_path, channel)
        .map(|bin| bin.exists())
        .unwrap_or(false);
    if is_target_installed && installed_count <= 1 {
        drop(lock);
        return HttpResponse::BadRequest().json(json!({
            "detail": "At least one SimC channel must remain installed."
        }));
    }

    let result = remove_channel_install(root_path, channel);
    drop(lock);

    match result {
        Ok(()) => HttpResponse::Ok().json(
            build_status_response(simc_path.get_ref().clone(), channel, false, &updater).await,
        ),
        Err(err) => HttpResponse::InternalServerError().json(json!({
            "detail": err
        })),
    }
}

pub(super) fn resolve_installed_binary_for_channel(
    simc_path: &Path,
    _requested_channel: Option<&str>,
) -> Option<PathBuf> {
    let channel = SimcChannel::Nightly;

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
    updater: &SimcUpdaterState,
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
    let installed_date = detect_installed_date(&effective_installed_path);
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
                ("stable", assets.stable.clone()),
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
        channel_path: requested_channel_bin.to_string_lossy().to_string(),
        installed_path: effective_installed_path.to_string_lossy().to_string(),
        installed_exists,
        installed_version,
        installed_date,
        installed_channel,
        latest_version,
        latest_download,
        available_versions,
        available_downloads,
        update_available,
        checking_failed,
        detail,
        is_updating,
        download_progress: updater.snapshot(),
    }
}

async fn do_download_channel(
    simc_path: PathBuf,
    channel: SimcChannel,
    updater: &SimcUpdaterState,
) -> Result<(), String> {
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
    let content_length = response.content_length();
    updater.begin_download(channel, content_length);

    if !response.status().is_success() {
        let status = response.status();
        let _ = std::fs::remove_dir_all(&temp_root);
        updater.clear_progress();
        return Err(format!(
            "SimC download failed with HTTP status {} for {}",
            status, latest.url
        ));
    }

    let mut file = tokio::fs::File::create(&archive_path).await.map_err(|e| {
        updater.clear_progress();
        format!(
            "Failed to create SimC archive file {}: {}",
            archive_path.display(),
            e
        )
    })?;

    let mut stream = response.bytes_stream();
    let mut downloaded: u64 = 0;
    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| {
            updater.clear_progress();
            format!("Failed to read SimC download body: {e}")
        })?;
        file.write_all(&chunk).await.map_err(|e| {
            updater.clear_progress();
            format!(
                "Failed to write SimC archive to {}: {}",
                archive_path.display(),
                e
            )
        })?;
        downloaded = downloaded.saturating_add(chunk.len() as u64);
        updater.update_downloaded(downloaded);
    }
    file.flush().await.map_err(|e| {
        updater.clear_progress();
        format!(
            "Failed to finalize SimC archive file {}: {}",
            archive_path.display(),
            e
        )
    })?;

    let install_result = tokio::task::spawn_blocking({
        let archive_path = archive_path.clone();
        let extract_dir = extract_dir.clone();
        let install_dir = install_dir.clone();
        let latest = latest.clone();
        let updater = updater.clone();
        move || {
            install_from_archive(
                &archive_path,
                &extract_dir,
                &install_dir,
                &latest,
                channel,
                &updater,
            )
        }
    })
    .await
    .map_err(|e| format!("SimC installation task failed to complete: {e}"))?;

    let cleanup_err = std::fs::remove_dir_all(&temp_root).err();
    let _ = std::fs::remove_file(&archive_path); // Cleanup archive

    if let Err(err) = install_result {
        updater.clear_progress();
        return Err(err);
    }

    if let Some(err) = cleanup_err {
        eprintln!(
            "Warning: failed to clean temporary SimC updater directory {}: {}",
            temp_root.display(),
            err
        );
    }

    updater.clear_progress();
    Ok(())
}

fn install_from_archive(
    archive_path: &Path,
    extract_dir: &Path,
    install_dir: &Path,
    latest: &RemoteAsset,
    channel: SimcChannel,
    updater: &SimcUpdaterState,
) -> Result<(), String> {
    match latest.archive_kind {
        ArchiveKind::SevenZip => extract_7z_archive(archive_path, extract_dir, updater)?,
        ArchiveKind::Zip => extract_zip_archive(archive_path, extract_dir, updater)?,
    };

    let extracted_bin = find_simc_binary(extract_dir).ok_or_else(|| {
        format!(
            "Could not find simc executable after extracting {}",
            archive_path.display()
        )
    })?;

    let source_dir = find_source_root(extract_dir, &extracted_bin);

    let files_to_copy = gather_files(&source_dir)?;
    let total_bytes: u64 = files_to_copy
        .iter()
        .map(|p| std::fs::metadata(p).map(|m| m.len()).unwrap_or(0))
        .sum();

    updater.set_phase("extracting_data", ProgressUnit::Bytes, Some(total_bytes));

    let backup_dir = install_dir.with_extension("backup");
    if install_dir.exists() {
        if let Err(e) = std::fs::rename(install_dir, &backup_dir) {
            eprintln!("Warning: failed to create backup directory: {e}");
        }
    }

    let install_res = (|| -> Result<(), String> {
        std::fs::create_dir_all(install_dir)
            .map_err(|e| format!("Failed to create install dir: {e}"))?;
        copy_files_with_progress(&source_dir, install_dir, &files_to_copy, updater)?;

        let expected_bin = install_dir.join(binary_filename());
        if !expected_bin.exists() {
            return Err(format!(
                "Installation finished but {} is missing",
                expected_bin.display()
            ));
        }

        validate_simc_installation(&expected_bin)?;

        std::fs::write(install_dir.join(VERSION_MARKER), latest.version.as_bytes())
            .map_err(|e| format!("Failed to persist installed SimC version marker: {e}"))?;
        std::fs::write(
            install_dir.join(CHANNEL_MARKER),
            channel.as_str().as_bytes(),
        )
        .map_err(|e| format!("Failed to persist installed SimC channel marker: {e}"))?;

        Ok(())
    })();

    if let Err(e) = install_res {
        if backup_dir.exists() {
            let _ = std::fs::remove_dir_all(install_dir);
            let _ = std::fs::rename(&backup_dir, install_dir);
        }
        return Err(e);
    }

    if backup_dir.exists() {
        let _ = std::fs::remove_dir_all(&backup_dir);
    }

    Ok(())
}

fn validate_simc_installation(bin_path: &Path) -> Result<(), String> {
    // Run with 'help=1' which is a standard SimC way to show help/version and exit.
    let output = Command::new(bin_path)
        .arg("help=1")
        .output()
        .map_err(|e| format!("Failed to execute SimC for validation: {e}"))?;

    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let combined = format!("{stdout}\n{stderr}");

    // Even if SimC returns a non-zero exit code (some versions do if no simulation is run),
    // seeing the version header confirms the binary is valid and all dependencies (DLLs) are met.
    if combined.contains("SimulationCraft") && combined.contains("World of Warcraft") {
        return Ok(());
    }

    if !output.status.success() {
        return Err(format!(
            "SimC validation failed (exit code {:?}). The binary might be corrupted or missing dependencies.\n\nOutput:\n{}",
            output.status.code(),
            combined.trim()
        ));
    }

    Ok(())
}

#[derive(Debug, Clone, Default)]
struct ChannelAssets {
    stable: Option<RemoteAsset>,
    nightly: Option<RemoteAsset>,
}

impl ChannelAssets {
    fn for_channel(&self, channel: SimcChannel) -> Option<RemoteAsset> {
        match channel {
            SimcChannel::Stable => self.stable.clone(),
            SimcChannel::Nightly => self.nightly.clone(),
        }
    }
}

async fn fetch_channel_assets() -> Result<ChannelAssets, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(45))
        .user_agent("whylowdps-desktop/0.3")
        .build()
        .map_err(|e| format!("Failed to initialize HTTP client: {e}"))?;

    // Primary source: nightly.link ZIP (matches CI flow when available).
    if let Ok(resp) = client.head(NIGHTLY_LINK_WIN64_URL).send().await {
        if resp.status().is_success() {
            let version = resp
                .headers()
                .get(reqwest::header::ETAG)
                .and_then(|v| v.to_str().ok())
                .map(|s| s.trim_matches('"').to_string())
                .or_else(|| {
                    resp.headers()
                        .get(reqwest::header::LAST_MODIFIED)
                        .and_then(|v| v.to_str().ok())
                        .map(|s| s.to_string())
                })
                .unwrap_or_else(|| "nightly-link-win64-midnight".to_string());

            let newest = Some(RemoteAsset {
                version,
                filename: NIGHTLY_LINK_WIN64_FILENAME.to_string(),
                url: NIGHTLY_LINK_WIN64_URL.to_string(),
                archive_kind: ArchiveKind::Zip,
            });

            return Ok(ChannelAssets {
                stable: newest.clone(),
                nightly: newest,
            });
        }
    }

    // Fallback source: SimC nightly directory listing.
    let body = client
        .get(NIGHTLY_INDEX_URL)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch SimC nightly index: {e}"))?
        .error_for_status()
        .map_err(|e| format!("SimC nightly index responded with an error: {e}"))?
        .text()
        .await
        .map_err(|e| format!("Failed to read SimC nightly index body: {e}"))?;

    let re = Regex::new(r#"href="(?P<file>simc-[^"]+-(win64)\.(?:7z|zip))""#)
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
        let version = matched.clone();

        assets.push(RemoteAsset {
            version,
            filename: matched.clone(),
            url: format!("{}{}", NIGHTLY_BASE_URL, matched),
            archive_kind,
        });
    }

    if assets.is_empty() {
        return Err(
            "No downloadable Windows nightly archive found (nightly.link and index fallback both failed)."
                .to_string(),
        );
    }

    let newest = assets.first().cloned();

    Ok(ChannelAssets {
        stable: newest.clone(),
        nightly: newest,
    })
}
/// Migrate legacy channel folders (weekly, latest) to the new "stable" name.
///
/// Called once during a download/status check so that users who had a
/// previously installed "weekly" or "latest" channel keep their install
/// without needing to re-download.
pub(super) fn migrate_legacy_channel_dirs(simc_path: &Path) {
    let Some(root) = simc_path.parent() else {
        return;
    };
    let channels = root.join(CHANNELS_DIR);
    let stable_dir = channels.join("stable");
    if stable_dir.exists() {
        return; // already migrated or installed
    }

    // Prefer "weekly" over "latest" — it was the default.
    for legacy_name in ["weekly", "latest"] {
        let legacy_dir = channels.join(legacy_name);
        if legacy_dir.exists() {
            if let Err(e) = std::fs::rename(&legacy_dir, &stable_dir) {
                eprintln!(
                    "Warning: failed to migrate SimC channel dir {} → {}: {}",
                    legacy_dir.display(),
                    stable_dir.display(),
                    e
                );
            } else {
                eprintln!(
                    "Migrated legacy SimC channel '{}' → 'stable' at {}",
                    legacy_name,
                    stable_dir.display()
                );
                // Update the channel marker file
                let _ = std::fs::write(stable_dir.join(CHANNEL_MARKER), b"stable");
            }
            return;
        }
    }
}

fn channel_install_dir(simc_path: &Path, channel: SimcChannel) -> Option<PathBuf> {
    simc_path
        .parent()
        .map(|root| root.join(CHANNELS_DIR).join(channel.as_str()))
}

fn remove_channel_install(simc_path: &Path, channel: SimcChannel) -> Result<(), String> {
    let Some(dir) = channel_install_dir(simc_path, channel) else {
        return Err("Invalid SimC path (missing parent directory)".to_string());
    };

    if !dir.exists() {
        return Ok(());
    }

    std::fs::remove_dir_all(&dir).map_err(|e| {
        format!(
            "Failed to remove SimC channel '{}' at {}: {}",
            channel.as_str(),
            dir.display(),
            e
        )
    })?;

    Ok(())
}

fn channel_binary_path(simc_path: &Path, channel: SimcChannel) -> Option<PathBuf> {
    channel_install_dir(simc_path, channel).map(|dir| dir.join(binary_filename()))
}

fn installed_channel_count(simc_path: &Path) -> usize {
    [SimcChannel::Stable, SimcChannel::Nightly]
        .iter()
        .filter_map(|channel| channel_binary_path(simc_path, *channel))
        .filter(|bin| bin.exists())
        .count()
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

fn detect_installed_date(simc_path: &Path) -> Option<String> {
    if !simc_path.exists() {
        return None;
    }

    let marker = simc_path.parent()?.join(VERSION_MARKER);
    let from_path = if marker.exists() {
        marker
    } else {
        simc_path.to_path_buf()
    };
    let modified = std::fs::metadata(from_path).ok()?.modified().ok()?;
    let dt: chrono::DateTime<chrono::Utc> = modified.into();
    Some(dt.format("%Y-%m-%d").to_string())
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
            .then_with(|| match (&a.suffix, &b.suffix) {
                (None, None) => Ordering::Equal,
                (None, Some(_)) => Ordering::Less,
                (Some(_), None) => Ordering::Greater,
                (Some(a), Some(b)) if a == b => Ordering::Equal,
                (Some(_), Some(_)) => Ordering::Less,
            }),
    )
}

fn parse_version(input: &str) -> Option<ParsedVersion> {
    let re = Regex::new(r"(?i)(\d{4})[.-](\d{2})(.*)$").ok()?;
    let caps = re.captures(input)?;
    let major = caps.get(1)?.as_str().parse::<u32>().ok()?;
    let minor = caps.get(2)?.as_str().parse::<u32>().ok()?;
    let suffix = caps
        .get(3)
        .map(|m| m.as_str().trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty());
    Some(ParsedVersion {
        major,
        minor,
        suffix,
    })
}

fn normalize_version(value: &str) -> String {
    value.trim().to_ascii_lowercase().replace('-', ".")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_available_detects_newer_same_day_build_suffix() {
        assert!(is_update_available(
            "simc-2026-04-18-win64.zip",
            "simc-2026-04-18-hotfix-win64.zip"
        ));
    }

    #[test]
    fn update_available_detects_newer_date() {
        assert!(is_update_available(
            "simc-2026-04-18-win64.zip",
            "simc-2026-04-19-win64.zip"
        ));
    }
}

/// Find a working 7z.exe on the system.
fn find_system_7z() -> Option<PathBuf> {
    // Check PATH first
    if let Ok(output) = Command::new("7z").arg("--help").output() {
        if output.status.success() || !output.stdout.is_empty() {
            return Some(PathBuf::from("7z"));
        }
    }

    // Common install locations on Windows
    let candidates = [
        r"C:\Program Files\7-Zip\7z.exe",
        r"C:\Program Files (x86)\7-Zip\7z.exe",
    ];
    for path in candidates {
        let p = PathBuf::from(path);
        if p.exists() {
            return Some(p);
        }
    }

    None
}

/// Extract a .7z archive. Tries system 7z.exe first (handles all codecs),
/// then falls back to the sevenz-rust2 Rust crate.
fn extract_7z_archive(
    archive_path: &Path,
    dest: &Path,
    updater: &SimcUpdaterState,
) -> Result<(), String> {
    let total_uncompressed_bytes = std::fs::File::open(archive_path)
        .ok()
        .and_then(|mut file| {
            sevenz_rust2::Archive::read(&mut file, &sevenz_rust2::Password::empty()).ok()
        })
        .map(|archive| archive.files.iter().map(|f| f.size).sum::<u64>());

    updater.set_phase(
        "extracting_archive",
        ProgressUnit::Bytes,
        total_uncompressed_bytes,
    );
    if let Some(seven_zip) = find_system_7z() {
        eprintln!(
            "Using system 7-Zip ({}) for extraction",
            seven_zip.display()
        );
        let output = Command::new(&seven_zip)
            .arg("x") // extract with full paths
            .arg(format!("-o{}", dest.display())) // output directory
            .arg("-y") // assume yes on all queries
            .arg("-bso0") // suppress standard output
            .arg("-bsp0") // suppress progress
            .arg(archive_path.as_os_str())
            .output()
            .map_err(|e| {
                format!(
                    "Failed to run 7z.exe for extraction of {}: {}",
                    archive_path.display(),
                    e
                )
            })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            let combined = format!("{stdout}\n{stderr}").trim().to_string();
            return Err(format!(
                "7z.exe extraction failed (exit code {:?}) for {}:\n{}",
                output.status.code(),
                archive_path.display(),
                combined
            ));
        }

        // When using system 7z, we can't easily track progress per file,
        // so we just jump to total if we have it.
        if let Some(total) = total_uncompressed_bytes {
            updater.update_downloaded(total);
        }

        // Clean up optional entries (e.g. WACTAC.h!ml) after system 7z extraction
        cleanup_optional_entries_recursive(dest);
        return Ok(());
    }

    // Fall back to the Rust crate
    eprintln!("No system 7-Zip found, falling back to built-in extractor");
    let mut extracted_bytes = 0;
    sevenz_rust2::decompress_file_with_extract_fn(archive_path, dest, |entry, reader, dest_path| {
        // DO NOT skip files entirely during extraction. In 7z solid blocks,
        // failing to consume the reader can cause ChecksumVerificationFailed.
        // We extract everything, then clean up the optional entries afterward.
        let uncompressed_size = entry.size;
        let res = sevenz_rust2::default_entry_extract_fn(entry, reader, dest_path);
        extracted_bytes += uncompressed_size;
        updater.update_downloaded(extracted_bytes);
        res
    })
    .map(|_| {
        // Clean up optional entries (e.g. WACTAC.h!ml) after internal extraction
        cleanup_optional_entries_recursive(dest);
    })
    .map_err(|e| {
        let msg = format!("Failed to extract SimC 7z archive: {e}");
        if msg.contains("ChecksumVerificationFailed") {
            format!(
                "{msg}\n\nThe built-in 7z extractor cannot handle this archive. \
                 Please install 7-Zip (https://www.7-zip.org/download.html) \
                 and the extraction will use it automatically."
            )
        } else if msg.contains("Access is denied")
            || msg.contains("PermissionDenied")
            || msg.contains("being used by another process")
        {
            format!(
                "{msg}\n\nThis may be caused by Windows Defender flagging a file \
                 inside the archive (e.g. WACTAC.h!ml false positive). \
                 Try adding your SimC install/temp folder as a Defender exclusion: \
                 Settings → Virus & threat protection → Exclusions."
            )
        } else {
            msg
        }
    })
}

/// After system 7z extraction, walk the tree and remove any files that
/// should have been skipped (optional HTML entries like WACTAC).
fn cleanup_optional_entries_recursive(root: &Path) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            cleanup_optional_entries_recursive(&path);
        } else if should_skip_optional_entry(&path) {
            let _ = std::fs::remove_file(&path);
        }
    }
}

fn extract_zip_archive(
    archive_path: &Path,
    dest: &Path,
    updater: &SimcUpdaterState,
) -> Result<(), String> {
    let reader = std::fs::File::open(archive_path).map_err(|e| {
        format!(
            "Failed to open zip archive {}: {}",
            archive_path.display(),
            e
        )
    })?;
    let mut archive =
        zip::ZipArchive::new(reader).map_err(|e| format!("Failed to parse zip archive: {e}"))?;

    let mut total_uncompressed_bytes = 0;
    for i in 0..archive.len() {
        if let Ok(file) = archive.by_index(i) {
            total_uncompressed_bytes += file.size();
        }
    }

    updater.set_phase(
        "extracting_archive",
        ProgressUnit::Bytes,
        Some(total_uncompressed_bytes),
    );

    let mut extracted_bytes = 0;
    for idx in 0..archive.len() {
        let mut file = archive
            .by_index(idx)
            .map_err(|e| format!("Failed reading zip entry {idx}: {e}"))?;

        let uncompressed_size = file.size();
        let Some(safe_path) = file.enclosed_name().map(|path| path.to_path_buf()) else {
            extracted_bytes += uncompressed_size;
            updater.update_downloaded(extracted_bytes);
            continue;
        };

        let out = dest.join(safe_path);
        if should_skip_optional_entry(&out) {
            extracted_bytes += uncompressed_size;
            updater.update_downloaded(extracted_bytes);
            continue;
        }

        if file.is_dir() {
            std::fs::create_dir_all(&out).map_err(|e| {
                format!(
                    "Failed creating directory while extracting zip {}: {}",
                    out.display(),
                    e
                )
            })?;
            extracted_bytes += uncompressed_size;
            updater.update_downloaded(extracted_bytes);
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

        extracted_bytes += uncompressed_size;
        updater.update_downloaded(extracted_bytes);
    }

    Ok(())
}

fn should_skip_optional_entry(path: &Path) -> bool {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if ext == "html" || ext == "htm" {
        return true;
    }

    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .replace('!', "");
    name.contains("wactac") && name.contains("html")
}

fn find_source_root(extract_dir: &Path, binary_path: &Path) -> PathBuf {
    let mut current = binary_path.to_path_buf();
    // Start with the binary's parent
    if let Some(parent) = current.parent() {
        current = parent.to_path_buf();
    } else {
        return extract_dir.to_path_buf();
    }

    let mut best_root = current.clone();

    // Climb up from binary parent towards extract_dir
    let mut temp = current;
    while temp != extract_dir {
        // If this folder has scdata, it's a very strong candidate for the package root
        if temp.join("scdata").exists() {
            best_root = temp.clone();
        }

        if let Some(parent) = temp.parent() {
            temp = parent.to_path_buf();
        } else {
            break;
        }
    }

    // Check extract_dir itself too
    if extract_dir.join("scdata").exists() {
        best_root = extract_dir.to_path_buf();
    }

    best_root
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

fn gather_files(root: &Path) -> Result<Vec<PathBuf>, String> {
    let mut files = Vec::new();
    let mut queue = vec![root.to_path_buf()];
    while let Some(dir) = queue.pop() {
        let entries = std::fs::read_dir(&dir).map_err(|e| {
            format!(
                "Failed to read extracted SimC directory {}: {}",
                dir.display(),
                e
            )
        })?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("Failed to enumerate extracted files: {e}"))?;
            let path = entry.path();
            if path.is_dir() {
                queue.push(path);
            } else if path.is_file() {
                files.push(path);
            }
        }
    }
    Ok(files)
}

fn copy_files_with_progress(
    root: &Path,
    dst: &Path,
    files: &[PathBuf],
    updater: &SimcUpdaterState,
) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| {
        format!(
            "Failed creating destination directory {}: {}",
            dst.display(),
            e
        )
    })?;

    let mut copied_bytes = 0;
    for source_path in files {
        let size = std::fs::metadata(source_path).map(|m| m.len()).unwrap_or(0);
        let relative = source_path.strip_prefix(root).map_err(|e| {
            format!(
                "Failed resolving relative path for {}: {}",
                source_path.display(),
                e
            )
        })?;
        let target_path = dst.join(relative);
        if let Some(parent) = target_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                format!(
                    "Failed creating destination directory {}: {}",
                    parent.display(),
                    e
                )
            })?;
        }
        std::fs::copy(source_path, &target_path).map_err(|e| {
            format!(
                "Failed copying {} to {}: {}",
                source_path.display(),
                target_path.display(),
                e
            )
        })?;
        copied_bytes += size;
        updater.update_downloaded(copied_bytes);
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
