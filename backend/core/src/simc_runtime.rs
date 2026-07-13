use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fmt;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tokio::io::AsyncWriteExt;

const DEFAULT_MANIFEST_BASE_URL: &str =
    "https://github.com/JosephLteif/whylowdps-simc-runtime/releases/download";
const MANIFEST_FILE: &str = "simc-metadata.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SimcChannel {
    Weekly,
    Nightly,
}

impl SimcChannel {
    pub fn parse(value: &str) -> Self {
        match value.trim().to_ascii_lowercase().as_str() {
            "nightly" => Self::Nightly,
            _ => Self::Weekly,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Weekly => "weekly",
            Self::Nightly => "nightly",
        }
    }
}

impl fmt::Display for SimcChannel {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Clone)]
pub struct SimcRuntimeConfig {
    pub channel: SimcChannel,
    pub manifest_base_url: String,
    pub install_dir: PathBuf,
    pub release_tag: Option<String>,
}

impl SimcRuntimeConfig {
    pub fn new(channel: SimcChannel, install_dir: PathBuf) -> Self {
        let manifest_base_url = std::env::var("SIMC_RUNTIME_MANIFEST_BASE_URL")
            .unwrap_or_else(|_| DEFAULT_MANIFEST_BASE_URL.to_string());

        Self {
            channel,
            manifest_base_url,
            install_dir,
            release_tag: None,
        }
    }

    pub fn with_release_tag(mut self, release_tag: Option<String>) -> Self {
        self.release_tag = release_tag.and_then(|tag| {
            let trimmed = tag.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        });
        self
    }

    pub fn manifest_url(&self) -> String {
        let release_tag = self
            .release_tag
            .as_deref()
            .unwrap_or_else(|| self.channel.as_str());
        format!(
            "{}/{}/manifest.json",
            self.manifest_base_url.trim_end_matches('/'),
            release_tag
        )
    }

    pub fn simc_path(&self) -> PathBuf {
        self.install_dir.join(simc_binary_name())
    }

    fn metadata_path(&self) -> PathBuf {
        self.install_dir.join(MANIFEST_FILE)
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SimcManifest {
    pub channel: String,
    pub version: String,
    pub published_at: String,
    pub assets: Vec<SimcManifestAsset>,
}

impl SimcManifest {
    pub fn asset_for_platform(&self, platform: &str) -> Option<&SimcManifestAsset> {
        self.assets.iter().find(|asset| asset.platform == platform)
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SimcManifestAsset {
    pub platform: String,
    pub url: String,
    pub sha256: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SimcCachedMetadata {
    pub channel: String,
    pub version: String,
    pub sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SimcRuntimeResolution {
    pub simc_path: PathBuf,
    pub channel: String,
    pub version: String,
    pub updated: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SimcDownloadProgress {
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub elapsed_ms: u64,
    pub speed_bytes_per_sec: u64,
    pub eta_seconds: Option<u64>,
}

impl SimcDownloadProgress {
    pub fn new(downloaded_bytes: u64, total_bytes: Option<u64>, elapsed: Duration) -> Self {
        let elapsed_ms = elapsed.as_millis() as u64;
        let speed_bytes_per_sec = downloaded_bytes
            .saturating_mul(1000)
            .checked_div(elapsed_ms)
            .unwrap_or(0);
        let eta_seconds = match (total_bytes, speed_bytes_per_sec) {
            (Some(total), speed) if speed > 0 && downloaded_bytes < total => {
                Some((total - downloaded_bytes).div_ceil(speed))
            }
            _ => None,
        };

        Self {
            downloaded_bytes,
            total_bytes,
            elapsed_ms,
            speed_bytes_per_sec,
            eta_seconds,
        }
    }
}

pub fn needs_update(
    current: Option<&SimcCachedMetadata>,
    channel: &str,
    version: &str,
    asset: &SimcManifestAsset,
) -> bool {
    current
        .map(|metadata| {
            metadata.channel != channel
                || metadata.version != version
                || metadata.sha256 != asset.sha256
        })
        .unwrap_or(true)
}

pub fn simc_binary_name() -> &'static str {
    if cfg!(windows) {
        "simc.exe"
    } else {
        "simc"
    }
}

pub fn current_platform() -> &'static str {
    if cfg!(windows) {
        "win64"
    } else if cfg!(target_os = "linux") {
        "linux-x64"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        std::env::consts::OS
    }
}

fn promote_simc_binary(staged: &Path, target: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows::core::PCWSTR;
        use windows::Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        };

        let staged_w = staged
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect::<Vec<_>>();
        let target_w = target
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect::<Vec<_>>();
        unsafe {
            MoveFileExW(
                PCWSTR(staged_w.as_ptr()),
                PCWSTR(target_w.as_ptr()),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
            .map_err(|error| format!("Failed to promote SimC binary: {error}"))?;
        }
        Ok(())
    }

    #[cfg(not(windows))]
    {
        fs::rename(staged, target).map_err(|error| format!("Failed to promote SimC binary: {error}"))
    }
}

pub fn read_cached_metadata(path: &Path) -> Option<SimcCachedMetadata> {
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

pub async fn resolve_simc_runtime(
    config: &SimcRuntimeConfig,
) -> Result<SimcRuntimeResolution, String> {
    resolve_simc_runtime_with_progress(config, |_| {}).await
}

pub async fn resolve_simc_runtime_with_progress<F>(
    config: &SimcRuntimeConfig,
    mut on_progress: F,
) -> Result<SimcRuntimeResolution, String>
where
    F: FnMut(SimcDownloadProgress) + Send,
{
    fs::create_dir_all(&config.install_dir)
        .map_err(|e| format!("Failed to create SimC runtime dir: {e}"))?;

    let cached_metadata = read_cached_metadata(&config.metadata_path());
    let cached_path = config.simc_path();

    let manifest = match fetch_manifest(&config.manifest_url()).await {
        Ok(manifest) => manifest,
        Err(err) if cached_path.exists() => {
            let metadata = cached_metadata.unwrap_or(SimcCachedMetadata {
                channel: config.channel.as_str().to_string(),
                version: "cached".to_string(),
                sha256: String::new(),
            });
            eprintln!("Failed to update SimC runtime, using cached binary: {err}");
            return Ok(SimcRuntimeResolution {
                simc_path: cached_path,
                channel: metadata.channel,
                version: metadata.version,
                updated: false,
            });
        }
        Err(err) => return Err(err),
    };

    let platform = current_platform();
    let asset = manifest
        .asset_for_platform(platform)
        .ok_or_else(|| format!("SimC runtime manifest has no asset for platform {platform}"))?;

    if cached_path.exists()
        && !needs_update(
            cached_metadata.as_ref(),
            &manifest.channel,
            &manifest.version,
            asset,
        )
    {
        return Ok(SimcRuntimeResolution {
            simc_path: cached_path,
            channel: manifest.channel,
            version: manifest.version,
            updated: false,
        });
    }

    let download_path = config.install_dir.join("simc-download.zip");
    download_asset(asset, &download_path, &mut on_progress).await?;
    verify_sha256(&download_path, &asset.sha256)?;

    let extract_dir = config.install_dir.join("next");
    if extract_dir.exists() {
        fs::remove_dir_all(&extract_dir)
            .map_err(|e| format!("Failed to clear SimC staging dir: {e}"))?;
    }
    fs::create_dir_all(&extract_dir)
        .map_err(|e| format!("Failed to create SimC staging dir: {e}"))?;
    extract_simc_binary(&download_path, &extract_dir)?;

    let staged_simc = find_file_named(&extract_dir, simc_binary_name()).ok_or_else(|| {
        format!(
            "Downloaded SimC archive did not contain {}",
            simc_binary_name()
        )
    })?;

    let next_simc = config
        .install_dir
        .join(format!("{}.next", simc_binary_name()));
    fs::copy(&staged_simc, &next_simc).map_err(|e| format!("Failed to stage SimC binary: {e}"))?;

    promote_simc_binary(&next_simc, &cached_path)?;

    let metadata = SimcCachedMetadata {
        channel: manifest.channel.clone(),
        version: manifest.version.clone(),
        sha256: asset.sha256.clone(),
    };
    let metadata_json = serde_json::to_string_pretty(&metadata)
        .map_err(|e| format!("Failed to serialize SimC metadata: {e}"))?;
    fs::write(config.metadata_path(), metadata_json)
        .map_err(|e| format!("Failed to write SimC metadata: {e}"))?;

    let _ = fs::remove_file(download_path);
    let _ = fs::remove_dir_all(extract_dir);

    Ok(SimcRuntimeResolution {
        simc_path: cached_path,
        channel: manifest.channel,
        version: manifest.version,
        updated: true,
    })
}

async fn fetch_manifest(url: &str) -> Result<SimcManifest, String> {
    reqwest::get(url)
        .await
        .map_err(|e| format!("Failed to request SimC manifest: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Failed to download SimC manifest: {e}"))?
        .json::<SimcManifest>()
        .await
        .map_err(|e| format!("Failed to parse SimC manifest: {e}"))
}

async fn download_asset<F>(
    asset: &SimcManifestAsset,
    path: &Path,
    on_progress: &mut F,
) -> Result<(), String>
where
    F: FnMut(SimcDownloadProgress) + Send,
{
    let mut response = reqwest::get(&asset.url)
        .await
        .map_err(|e| format!("Failed to request SimC asset: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Failed to download SimC asset: {e}"))?;
    let total_bytes = response.content_length();
    let started_at = Instant::now();
    let mut downloaded_bytes = 0_u64;
    let mut file = tokio::fs::File::create(path)
        .await
        .map_err(|e| format!("Failed to write SimC asset: {e}"))?;

    on_progress(SimcDownloadProgress::new(
        0,
        total_bytes,
        started_at.elapsed(),
    ));
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("Failed to read SimC asset: {e}"))?
    {
        downloaded_bytes += chunk.len() as u64;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Failed to write SimC asset: {e}"))?;
        on_progress(SimcDownloadProgress::new(
            downloaded_bytes,
            total_bytes,
            started_at.elapsed(),
        ));
    }

    file.flush()
        .await
        .map_err(|e| format!("Failed to finalize SimC asset: {e}"))
}

fn verify_sha256(path: &Path, expected: &str) -> Result<(), String> {
    let bytes = fs::read(path).map_err(|e| format!("Failed to read SimC archive: {e}"))?;
    let actual = format!("{:x}", Sha256::digest(&bytes));
    if actual.eq_ignore_ascii_case(expected.trim()) {
        Ok(())
    } else {
        Err(format!(
            "SimC archive checksum mismatch: expected {}, got {}",
            expected, actual
        ))
    }
}

fn extract_simc_binary(zip_path: &Path, target_dir: &Path) -> Result<(), String> {
    let file = fs::File::open(zip_path).map_err(|e| format!("Failed to open SimC archive: {e}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("Failed to read SimC archive: {e}"))?;

    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read SimC archive entry: {e}"))?;
        if !file.is_file() {
            continue;
        }

        let Some(name) = file.enclosed_name().map(|name| name.to_path_buf()) else {
            continue;
        };
        let output = target_dir.join(name);
        if let Some(parent) = output.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create SimC extract dir: {e}"))?;
        }
        let mut out =
            fs::File::create(&output).map_err(|e| format!("Failed to extract SimC file: {e}"))?;
        io::copy(&mut file, &mut out).map_err(|e| format!("Failed to write SimC file: {e}"))?;
    }

    Ok(())
}

fn find_file_named(root: &Path, name: &str) -> Option<PathBuf> {
    let entries = fs::read_dir(root).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() && path.file_name().is_some_and(|file_name| file_name == name) {
            return Some(path);
        }
        if path.is_dir() {
            if let Some(found) = find_file_named(&path, name) {
                return Some(found);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;
    use std::path::PathBuf;
    use std::time::Duration;

    #[test]
    fn channel_parsing_accepts_supported_values_and_defaults_to_weekly() {
        assert_eq!(SimcChannel::parse("nightly"), SimcChannel::Nightly);
        assert_eq!(SimcChannel::parse(" WEEKLY "), SimcChannel::Weekly);
        assert_eq!(SimcChannel::parse("stable"), SimcChannel::Weekly);
        assert_eq!(SimcChannel::parse(""), SimcChannel::Weekly);
        assert_eq!(SimcChannel::Nightly.to_string(), "nightly");
        assert_eq!(SimcChannel::Weekly.to_string(), "weekly");
    }

    #[test]
    fn runtime_config_new_and_release_tag_helpers_trim_and_build_paths() {
        let original = std::env::var("SIMC_RUNTIME_MANIFEST_BASE_URL").ok();
        std::env::set_var(
            "SIMC_RUNTIME_MANIFEST_BASE_URL",
            "https://runtime.example/releases/download/",
        );

        let config = SimcRuntimeConfig::new(SimcChannel::Weekly, PathBuf::from("runtime"))
            .with_release_tag(Some("  pinned-release  ".to_string()));

        assert_eq!(
            config.manifest_base_url,
            "https://runtime.example/releases/download/"
        );
        assert_eq!(config.release_tag.as_deref(), Some("pinned-release"));
        assert_eq!(
            config.simc_path(),
            PathBuf::from("runtime").join(simc_binary_name())
        );
        assert_eq!(
            config.metadata_path(),
            PathBuf::from("runtime").join("simc-metadata.json")
        );

        let config = config.with_release_tag(Some("   ".to_string()));
        assert_eq!(config.release_tag, None);

        match original {
            Some(value) => std::env::set_var("SIMC_RUNTIME_MANIFEST_BASE_URL", value),
            None => std::env::remove_var("SIMC_RUNTIME_MANIFEST_BASE_URL"),
        }
    }

    #[test]
    fn staged_simc_binary_replaces_existing_target_without_a_missing_path_window() {
        let dir = tempfile::tempdir().expect("tempdir");
        let staged = dir.path().join("simc.next");
        let target = dir.path().join(simc_binary_name());
        fs::write(&staged, b"new binary").expect("staged binary");
        fs::write(&target, b"old binary").expect("old binary");

        promote_simc_binary(&staged, &target).expect("promote binary");

        assert_eq!(fs::read(&target).expect("target binary"), b"new binary");
        assert!(!staged.exists());
    }

    #[test]
    fn read_cached_metadata_returns_none_for_missing_or_invalid_files() {
        let dir = tempfile::tempdir().expect("temp dir");
        let missing = dir.path().join("missing.json");
        assert!(read_cached_metadata(&missing).is_none());

        let invalid = dir.path().join("invalid.json");
        fs::write(&invalid, "{not json").expect("invalid metadata");
        assert!(read_cached_metadata(&invalid).is_none());

        let valid = dir.path().join("valid.json");
        fs::write(
            &valid,
            r#"{"channel":"weekly","version":"2026.06.30","sha256":"abc"}"#,
        )
        .expect("valid metadata");

        let cached = read_cached_metadata(&valid).expect("cached metadata");
        assert_eq!(cached.channel, "weekly");
        assert_eq!(cached.version, "2026.06.30");
        assert_eq!(cached.sha256, "abc");
    }

    #[test]
    fn current_platform_and_binary_name_are_non_empty() {
        assert!(!current_platform().is_empty());
        assert!(!simc_binary_name().is_empty());
    }

    #[test]
    fn manifest_url_uses_stable_channel_release_asset() {
        let config = SimcRuntimeConfig {
            channel: SimcChannel::Nightly,
            manifest_base_url: "https://github.com/acme/whylowdps-simc-runtime/releases/download"
                .to_string(),
            install_dir: PathBuf::from("runtime"),
            release_tag: None,
        };

        assert_eq!(
            config.manifest_url(),
            "https://github.com/acme/whylowdps-simc-runtime/releases/download/nightly/manifest.json"
        );
    }

    #[test]
    fn manifest_url_uses_pinned_release_tag_when_selected() {
        let config = SimcRuntimeConfig {
            channel: SimcChannel::Nightly,
            manifest_base_url: "https://github.com/acme/whylowdps-simc-runtime/releases/download"
                .to_string(),
            install_dir: PathBuf::from("runtime"),
            release_tag: Some("weekly-202606240100".to_string()),
        };

        assert_eq!(
            config.manifest_url(),
            "https://github.com/acme/whylowdps-simc-runtime/releases/download/weekly-202606240100/manifest.json"
        );
    }

    #[test]
    fn manifest_requires_matching_platform_asset() {
        let manifest = SimcManifest {
            channel: "weekly".to_string(),
            version: "20260622".to_string(),
            published_at: "2026-06-22T00:00:00Z".to_string(),
            assets: vec![SimcManifestAsset {
                platform: "win64".to_string(),
                url: "https://example.invalid/simc-win64.zip".to_string(),
                sha256: "a".repeat(64),
            }],
        };

        assert!(manifest.asset_for_platform("win64").is_some());
        assert!(manifest.asset_for_platform("linux-x64").is_none());
    }

    #[test]
    fn cached_metadata_detects_changed_channel_version_or_checksum() {
        let current = SimcCachedMetadata {
            channel: "weekly".to_string(),
            version: "old".to_string(),
            sha256: "old-hash".to_string(),
        };
        let asset = SimcManifestAsset {
            platform: "win64".to_string(),
            url: "https://example.invalid/simc-win64.zip".to_string(),
            sha256: "new-hash".to_string(),
        };

        assert!(needs_update(Some(&current), "weekly", "old", &asset));
        assert!(needs_update(Some(&current), "nightly", "old", &asset));
        assert!(needs_update(Some(&current), "weekly", "new", &asset));

        let current = SimcCachedMetadata {
            sha256: "new-hash".to_string(),
            ..current
        };
        assert!(!needs_update(Some(&current), "weekly", "old", &asset));
        assert!(needs_update(None, "weekly", "old", &asset));
    }

    #[test]
    fn simc_download_progress_calculates_elapsed_speed_and_eta() {
        let progress = SimcDownloadProgress::new(4_096, Some(8_192), Duration::from_secs(2));

        assert_eq!(progress.downloaded_bytes, 4_096);
        assert_eq!(progress.total_bytes, Some(8_192));
        assert_eq!(progress.elapsed_ms, 2_000);
        assert_eq!(progress.speed_bytes_per_sec, 2_048);
        assert_eq!(progress.eta_seconds, Some(2));
    }

    #[test]
    fn verify_sha256_accepts_matching_digest_and_rejects_mismatch() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("simc.zip");
        fs::write(&path, b"runtime-bytes").expect("runtime bytes");

        let expected = format!("{:x}", Sha256::digest(b"runtime-bytes")).to_uppercase();
        assert!(verify_sha256(&path, &expected).is_ok());

        let err = verify_sha256(&path, "deadbeef").expect_err("checksum mismatch");
        assert!(err.contains("checksum mismatch"));
    }

    #[test]
    fn extract_simc_binary_and_find_file_named_handle_nested_archives() {
        let dir = tempfile::tempdir().expect("temp dir");
        let zip_path = dir.path().join("simc.zip");
        let extract_dir = dir.path().join("extract");

        let file = fs::File::create(&zip_path).expect("zip file");
        let mut archive = zip::ZipWriter::new(file);
        let options: zip::write::FileOptions<'_, ()> = zip::write::FileOptions::default();
        archive
            .add_directory("nested/", options)
            .expect("nested dir entry");
        archive
            .start_file(format!("nested/{}", simc_binary_name()), options)
            .expect("binary entry");
        archive.write_all(b"simc-binary").expect("binary bytes");
        archive.finish().expect("finish archive");

        extract_simc_binary(&zip_path, &extract_dir).expect("extract archive");

        let extracted = find_file_named(&extract_dir, simc_binary_name()).expect("find binary");
        assert_eq!(
            fs::read(&extracted).expect("read extracted"),
            b"simc-binary"
        );
        assert!(extracted.ends_with(Path::new("nested").join(simc_binary_name())));
    }
}
