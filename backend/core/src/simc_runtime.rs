use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fmt;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

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
}

impl SimcRuntimeConfig {
    pub fn new(channel: SimcChannel, install_dir: PathBuf) -> Self {
        let manifest_base_url = std::env::var("SIMC_RUNTIME_MANIFEST_BASE_URL")
            .unwrap_or_else(|_| DEFAULT_MANIFEST_BASE_URL.to_string());

        Self {
            channel,
            manifest_base_url,
            install_dir,
        }
    }

    pub fn manifest_url(&self) -> String {
        format!(
            "{}/{}/manifest.json",
            self.manifest_base_url.trim_end_matches('/'),
            self.channel.as_str()
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

pub fn needs_update(current: Option<&SimcCachedMetadata>, asset: &SimcManifestAsset) -> bool {
    current
        .map(|metadata| metadata.sha256 != asset.sha256)
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

pub fn read_cached_metadata(path: &Path) -> Option<SimcCachedMetadata> {
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

pub async fn resolve_simc_runtime(
    config: &SimcRuntimeConfig,
) -> Result<SimcRuntimeResolution, String> {
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

    if cached_path.exists() && !needs_update(cached_metadata.as_ref(), asset) {
        return Ok(SimcRuntimeResolution {
            simc_path: cached_path,
            channel: manifest.channel,
            version: manifest.version,
            updated: false,
        });
    }

    let download_path = config.install_dir.join("simc-download.zip");
    download_asset(asset, &download_path).await?;
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

    if cached_path.exists() {
        fs::remove_file(&cached_path).map_err(|e| format!("Failed to replace SimC binary: {e}"))?;
    }
    fs::rename(&next_simc, &cached_path)
        .map_err(|e| format!("Failed to promote SimC binary: {e}"))?;

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

async fn download_asset(asset: &SimcManifestAsset, path: &Path) -> Result<(), String> {
    let bytes = reqwest::get(&asset.url)
        .await
        .map_err(|e| format!("Failed to request SimC asset: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Failed to download SimC asset: {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("Failed to read SimC asset: {e}"))?;

    fs::write(path, bytes).map_err(|e| format!("Failed to write SimC asset: {e}"))
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
    use std::path::PathBuf;

    #[test]
    fn channel_parsing_accepts_supported_values_and_defaults_to_weekly() {
        assert_eq!(SimcChannel::parse("nightly"), SimcChannel::Nightly);
        assert_eq!(SimcChannel::parse(" WEEKLY "), SimcChannel::Weekly);
        assert_eq!(SimcChannel::parse("stable"), SimcChannel::Weekly);
        assert_eq!(SimcChannel::parse(""), SimcChannel::Weekly);
    }

    #[test]
    fn manifest_url_uses_stable_channel_release_asset() {
        let config = SimcRuntimeConfig {
            channel: SimcChannel::Nightly,
            manifest_base_url: "https://github.com/acme/whylowdps-simc-runtime/releases/download"
                .to_string(),
            install_dir: PathBuf::from("runtime"),
        };

        assert_eq!(
            config.manifest_url(),
            "https://github.com/acme/whylowdps-simc-runtime/releases/download/nightly/manifest.json"
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
    fn cached_metadata_detects_changed_checksum() {
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

        assert!(needs_update(Some(&current), &asset));

        let current = SimcCachedMetadata {
            sha256: "new-hash".to_string(),
            ..current
        };
        assert!(!needs_update(Some(&current), &asset));
        assert!(needs_update(None, &asset));
    }
}
