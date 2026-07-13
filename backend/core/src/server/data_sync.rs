use actix_web::{web, HttpResponse};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::future::Future;
use std::path::Path;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::server::auth_handlers::{verify_jwt, BlizzardAuthState};
use crate::server::blizzard::BlizzardState;
use crate::storage::JobStorage;

mod background;
mod catalog;
mod data_files;
mod image_helpers;
mod image_sources;
mod raidbots;
#[allow(dead_code)] // Task 3 wires this isolated recovery module into the handler flow.
mod recovery_snapshot;
mod wowhead_zones;
mod zones_index;

pub use background::{spawn_background_sync_loop, DataSyncState};
use catalog::{
    data_file_catalog, restore_local_file_from_bundle, DataFileEntryType, DataFileSource,
};
pub use data_files::{get_data_file_content, get_data_file_states};
use image_helpers::{
    best_blizzard_asset_url, content_type_for_extension, image_error_response,
    infer_image_extension, is_allowed_remote_image_url, is_http_url, localized_str,
    media_url_from_entity_payload,
};
use image_sources::{
    find_cached_image_file, find_runtime_image_url, journal_instance_candidates,
    journal_instance_id_from_names_with_token, media_url_from_media_href,
    runtime_dungeon_name_candidates,
};
use raidbots::{raidbots_file_progress, stage_raidbots_files};
pub use wowhead_zones::{
    get_wowhead_zone_match, get_wowhead_zones_index, get_wowhead_zones_index_summary,
};
use zones_index::{resolve_data_file_read_path, resolve_zones_index_path};

const IMAGE_CACHE_VERSION: &str = "bapi3";
const EMBEDDED_DATA_MANIFEST: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../resources/data-manifest.json"
));
const ZONES_INDEX_ENTRY_KEY: &str = "runtime_wowhead_zones_index";
const ZONES_INDEX_FILE_NAME: &str = "zones-encounters-index.json";
const ZONES_INDEX_RELEASE_BASE_URL: &str =
    "https://github.com/JosephLteif/simcraft/releases/download";

fn write_runtime_file_atomically(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("Missing parent directory for {}", path.display()))?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let temporary = parent.join(format!(
        ".{}.part-{}",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("runtime-data"),
        uuid::Uuid::new_v4()
    ));
    let result = (|| {
        std::fs::write(&temporary, bytes).map_err(|e| e.to_string())?;
        if path.exists() {
            std::fs::remove_file(path).map_err(|e| e.to_string())?;
        }
        std::fs::rename(&temporary, path).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result
}

#[derive(Debug, Clone, Serialize)]
pub struct WowheadZoneNameId {
    pub id: u32,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct WowheadRaidZoneSummary {
    pub id: u32,
    pub name: String,
    pub expansion: Option<u32>,
    pub encounters: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WowheadZonesIndexSummary {
    pub zones: Vec<WowheadZoneNameId>,
    pub raids: Vec<WowheadRaidZoneSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SyncStatus {
    Ready,
    Syncing,
    NeedsCredentials,
    Error(String),
}

#[derive(Debug, Deserialize)]
pub struct SyncQuery {
    pub force: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct DataImageQuery {
    pub source: Option<String>,
}

async fn download_github_release_asset(
    client: &reqwest::Client,
    version: &str,
    file_name: &str,
    destination: &Path,
) -> Result<(), String> {
    let version = version.trim();
    if version.is_empty() {
        return Err("App version is unavailable; cannot resolve release asset URL".to_string());
    }

    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            format!(
                "Failed to create directory for {}: {}",
                destination.display(),
                e
            )
        })?;
    }

    let mut tag_candidates: Vec<String> = Vec::new();
    let prefixed = if version.starts_with('v') {
        version.to_string()
    } else {
        format!("v{}", version)
    };
    tag_candidates.push(prefixed);
    tag_candidates.push(version.to_string());
    tag_candidates.retain(|tag| !tag.is_empty());
    tag_candidates.dedup();

    let mut errors = Vec::new();
    for tag in tag_candidates {
        let asset_url = format!("{}/{}/{}", ZONES_INDEX_RELEASE_BASE_URL, tag, file_name);
        let response = match client
            .get(&asset_url)
            .header("User-Agent", "WhyLowDps/desktop-data-refresh")
            .send()
            .await
        {
            Ok(resp) => resp,
            Err(err) => {
                errors.push(format!("{} (request failed: {})", asset_url, err));
                continue;
            }
        };
        if !response.status().is_success() {
            errors.push(format!("{} (HTTP {})", asset_url, response.status()));
            continue;
        }
        let bytes = response
            .bytes()
            .await
            .map_err(|e| format!("Failed to read response for {}: {}", asset_url, e))?;
        write_runtime_file_atomically(destination, &bytes)
            .map_err(|e| format!("Failed to save {}: {}", destination.display(), e))?;
        return Ok(());
    }

    Err(format!(
        "Failed to download {} from GitHub release assets for version {}: {}",
        file_name,
        version,
        errors.join(" ; ")
    ))
}

async fn download_github_release_asset_with_progress(
    client: &reqwest::Client,
    version: &str,
    file_name: &str,
    destination: &Path,
    state: &Arc<DataSyncState>,
    index: usize,
    total_files: usize,
) -> Result<(), String> {
    let version = version.trim();
    if version.is_empty() {
        return Err("App version is unavailable; cannot resolve release asset URL".to_string());
    }
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            format!(
                "Failed to create directory for {}: {}",
                destination.display(),
                e
            )
        })?;
    }

    let mut tag_candidates: Vec<String> = Vec::new();
    let prefixed = if version.starts_with('v') {
        version.to_string()
    } else {
        format!("v{}", version)
    };
    tag_candidates.push(prefixed);
    tag_candidates.push(version.to_string());
    tag_candidates.retain(|tag| !tag.is_empty());
    tag_candidates.dedup();

    let mut errors = Vec::new();
    for tag in tag_candidates {
        let asset_url = format!("{}/{}/{}", ZONES_INDEX_RELEASE_BASE_URL, tag, file_name);
        let response = match client
            .get(&asset_url)
            .header("User-Agent", "WhyLowDps/desktop-data-refresh")
            .send()
            .await
        {
            Ok(resp) => resp,
            Err(err) => {
                errors.push(format!("{} (request failed: {})", asset_url, err));
                continue;
            }
        };
        if !response.status().is_success() {
            errors.push(format!("{} (HTTP {})", asset_url, response.status()));
            continue;
        }

        let total_bytes = response.content_length();
        let started_at = Instant::now();
        let mut downloaded_bytes = 0_u64;
        let mut content = Vec::with_capacity(total_bytes.unwrap_or(0).min(10_000_000) as usize);
        let mut stream = response.bytes_stream();

        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("Failed to read {}: {}", file_name, e))?;
            downloaded_bytes += chunk.len() as u64;
            content.extend_from_slice(&chunk);
            let mut p = state.progress.lock().await;
            *p = raidbots_file_progress(
                index,
                total_files,
                file_name,
                downloaded_bytes,
                total_bytes,
                started_at.elapsed(),
            );
        }

        write_runtime_file_atomically(destination, &content)
            .map_err(|e| format!("Failed to save {}: {}", destination.display(), e))?;
        return Ok(());
    }

    Err(format!(
        "Failed to download {} from GitHub release assets for version {}: {}",
        file_name,
        version,
        errors.join(" ; ")
    ))
}

pub async fn open_data_directory(data_dir: web::Data<Option<PathBuf>>) -> HttpResponse {
    let Some(root) = data_dir.get_ref().clone() else {
        return HttpResponse::BadRequest().json(json!({"detail": "Data directory is unavailable"}));
    };

    let result = if cfg!(target_os = "windows") {
        Command::new("explorer").arg(&root).spawn()
    } else if cfg!(target_os = "macos") {
        Command::new("open").arg(&root).spawn()
    } else {
        Command::new("xdg-open").arg(&root).spawn()
    };

    match result {
        Ok(_child) => HttpResponse::Ok().json(json!({
            "status": "ok",
            "path": root,
        })),
        Err(err) => HttpResponse::InternalServerError().json(json!({
            "detail": format!("Failed to open data directory: {}", err)
        })),
    }
}

#[cfg(test)]
#[allow(clippy::items_after_test_module)]
mod tests {
    use super::wowhead_zones::{WowheadZoneMatchQuery, WowheadZonesSummaryQuery};
    use super::*;
    use crate::item_db::state;
    use crate::storage::{JobStorage, MemoryStorage};
    use actix_web::body::to_bytes;
    use actix_web::test::TestRequest;

    fn test_auth_state() -> web::Data<Arc<BlizzardAuthState>> {
        web::Data::new(Arc::new(BlizzardAuthState::new(
            None,
            None,
            "http://localhost/callback".to_string(),
            "jwt-secret".to_string(),
        )))
    }

    fn test_store() -> web::Data<Arc<dyn JobStorage>> {
        web::Data::new(Arc::new(MemoryStorage::new()) as Arc<dyn JobStorage>)
    }

    fn test_sync_state() -> web::Data<Arc<DataSyncState>> {
        web::Data::new(Arc::new(DataSyncState::new()))
    }

    #[tokio::test]
    async fn data_operations_share_one_lifecycle_lock() {
        let state = DataSyncState::new();
        let guard = state.operation_lock.lock().await;
        assert!(state.operation_lock.try_lock().is_err());
        drop(guard);
        assert!(state.operation_lock.try_lock().is_ok());
    }

    #[test]
    fn cached_image_lookup_checks_supported_extensions_in_order() {
        let dir = tempfile::tempdir().expect("temp image dir");
        let png_path = dir
            .path()
            .join(format!("instance-42-{}.png", IMAGE_CACHE_VERSION));
        std::fs::write(&png_path, b"png").expect("write cached image");

        assert_eq!(
            find_cached_image_file(dir.path(), "instance", 42).as_deref(),
            Some(png_path.as_path())
        );
        assert!(find_cached_image_file(dir.path(), "encounter", 42).is_none());
    }

    #[actix_web::test]
    async fn data_image_rejects_invalid_requests_before_network_work() {
        let invalid_type = get_data_image(
            TestRequest::default().to_http_request(),
            web::Path::from(("bad".to_string(), "42".to_string())),
            web::Query(DataImageQuery { source: None }),
            web::Data::new(Some(PathBuf::from("unused"))),
            web::Data::new(Arc::new(BlizzardState::new())),
            test_auth_state(),
            test_store(),
        )
        .await;
        assert_eq!(invalid_type.status(), 400);

        let invalid_id = get_data_image(
            TestRequest::default().to_http_request(),
            web::Path::from(("instance".to_string(), "not-a-number".to_string())),
            web::Query(DataImageQuery { source: None }),
            web::Data::new(Some(PathBuf::from("unused"))),
            web::Data::new(Arc::new(BlizzardState::new())),
            test_auth_state(),
            test_store(),
        )
        .await;
        assert_eq!(invalid_id.status(), 400);

        let missing_data_dir = get_data_image(
            TestRequest::default().to_http_request(),
            web::Path::from(("instance".to_string(), "42".to_string())),
            web::Query(DataImageQuery { source: None }),
            web::Data::new(None),
            web::Data::new(Arc::new(BlizzardState::new())),
            test_auth_state(),
            test_store(),
        )
        .await;
        assert_eq!(missing_data_dir.status(), 400);
    }

    #[actix_web::test]
    async fn data_image_serves_cached_bytes_without_credentials() {
        let dir = tempfile::tempdir().expect("temp data dir");
        let images_dir = dir.path().join("instance-images");
        std::fs::create_dir_all(&images_dir).expect("images dir");
        std::fs::write(
            images_dir.join(format!("encounter-77-{}.webp", IMAGE_CACHE_VERSION)),
            b"cached-webp",
        )
        .expect("cached image");

        let resp = get_data_image(
            TestRequest::default().to_http_request(),
            web::Path::from(("encounter".to_string(), "77".to_string())),
            web::Query(DataImageQuery { source: None }),
            web::Data::new(Some(dir.path().to_path_buf())),
            web::Data::new(Arc::new(BlizzardState::new())),
            test_auth_state(),
            test_store(),
        )
        .await;
        assert_eq!(resp.status(), 200);
        assert_eq!(
            resp.headers()
                .get(actix_web::http::header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok()),
            Some("image/webp")
        );

        let body = to_bytes(resp.into_body()).await.expect("image body");
        assert_eq!(body.as_ref(), b"cached-webp");
    }

    #[test]
    fn runtime_image_url_and_journal_candidates_use_runtime_metadata() {
        let _guard = state::TEST_STATE_LOCK.lock().unwrap();
        let prev_runtime = state::RUNTIME_DATA.read().unwrap().clone();

        *state::RUNTIME_DATA.write().unwrap() = json!({
            "dungeon_details": [{
                "id": 100,
                "map_id": 200,
                "challenge_mode_id": 300,
                "image_url": "https://render.worldofwarcraft.com/instance.jpg",
                "blizzard_href": "https://us.api.blizzard.com/data/wow/journal-instance/400?namespace=static-us",
                "blizzard_api_data": {
                    "key": {"href": "https://us.api.blizzard.com/data/wow/journal-instance/500?namespace=static-us"},
                    "instance_map": {"id": 600},
                    "encounters": [{
                        "id": 700,
                        "image_url": "https://render.worldofwarcraft.com/encounter.jpg"
                    }]
                }
            }]
        });

        assert_eq!(
            find_runtime_image_url("instance", 100).as_deref(),
            Some("https://render.worldofwarcraft.com/instance.jpg")
        );
        assert_eq!(
            find_runtime_image_url("encounter", 700).as_deref(),
            Some("https://render.worldofwarcraft.com/encounter.jpg")
        );
        assert_eq!(
            journal_instance_candidates(100),
            vec![100, 200, 300, 400, 500, 600]
        );

        *state::RUNTIME_DATA.write().unwrap() = prev_runtime;
    }

    #[test]
    fn runtime_dungeon_name_candidates_merge_instance_and_runtime_names() {
        let _guard = state::TEST_STATE_LOCK.lock().unwrap();
        let prev_runtime = state::RUNTIME_DATA.read().unwrap().clone();
        let prev_instances = state::INSTANCES.read().unwrap().clone();

        *state::INSTANCES.write().unwrap() = vec![json!({
            "id": 100,
            "name": "Instance Name",
            "short_name": "Instance Short"
        })];
        *state::RUNTIME_DATA.write().unwrap() = json!({
            "dungeon_details": [{
                "id": 100,
                "name": "Runtime Name",
                "short_name": "Runtime Short",
                "blizzard_api_data": {
                    "name": {"en_US": "Localized Name"},
                    "short_name": {"en_US": "Localized Short"}
                }
            }]
        });

        assert_eq!(
            runtime_dungeon_name_candidates(100),
            vec![
                "Instance Name",
                "Instance Short",
                "Localized Name",
                "Localized Short",
                "Runtime Name",
                "Runtime Short"
            ]
        );

        *state::RUNTIME_DATA.write().unwrap() = prev_runtime;
        *state::INSTANCES.write().unwrap() = prev_instances;
    }

    #[actix_web::test]
    async fn data_file_states_report_unavailable_without_data_dir() {
        let resp = get_data_file_states(web::Data::new(None)).await;
        assert_eq!(resp.status(), 200);

        let body = to_bytes(resp.into_body()).await.expect("states body");
        let payload: Value = serde_json::from_slice(&body).expect("states json");
        assert_eq!(
            payload.get("available").and_then(Value::as_bool),
            Some(false)
        );
        assert!(payload
            .get("files")
            .and_then(Value::as_array)
            .is_some_and(Vec::is_empty));
    }

    #[actix_web::test]
    async fn data_file_content_reads_previewable_manifest_entry() {
        let dir = tempfile::tempdir().expect("temp data dir");
        std::fs::write(dir.path().join("metadata.json"), "{\"ok\":true}").expect("write metadata");

        let resp = get_data_file_content(
            web::Path::from("metadata".to_string()),
            web::Data::new(Some(dir.path().to_path_buf())),
        )
        .await;
        assert_eq!(resp.status(), 200);

        let body = to_bytes(resp.into_body()).await.expect("content body");
        let payload: Value = serde_json::from_slice(&body).expect("content json");
        assert_eq!(payload.get("key").and_then(Value::as_str), Some("metadata"));
        assert_eq!(
            payload.get("content").and_then(Value::as_str),
            Some("{\"ok\":true}")
        );
        assert_eq!(
            payload.get("truncated").and_then(Value::as_bool),
            Some(false)
        );
    }

    #[actix_web::test]
    async fn data_file_content_rejects_unavailable_unknown_directory_and_missing_keys() {
        let unavailable = get_data_file_content(
            web::Path::from("metadata".to_string()),
            web::Data::new(None),
        )
        .await;
        assert_eq!(unavailable.status(), 400);

        let dir = tempfile::tempdir().expect("temp data dir");
        let unknown = get_data_file_content(
            web::Path::from("../../../metadata".to_string()),
            web::Data::new(Some(dir.path().to_path_buf())),
        )
        .await;
        assert_eq!(unknown.status(), 404);

        let directory = get_data_file_content(
            web::Path::from("instance_images_dir".to_string()),
            web::Data::new(Some(dir.path().to_path_buf())),
        )
        .await;
        assert_eq!(directory.status(), 400);

        let missing = get_data_file_content(
            web::Path::from("metadata".to_string()),
            web::Data::new(Some(dir.path().to_path_buf())),
        )
        .await;
        assert_eq!(missing.status(), 404);
    }

    #[actix_web::test]
    async fn data_file_download_rejects_invalid_requests_before_network_work() {
        let unavailable = download_data_file(
            web::Path::from("metadata".to_string()),
            web::Data::new(None),
            web::Data::new(Arc::new(BlizzardState::new())),
            test_sync_state(),
        )
        .await;
        assert_eq!(unavailable.status(), 400);

        let dir = tempfile::tempdir().expect("temp data dir");
        let unknown = download_data_file(
            web::Path::from("../../../metadata".to_string()),
            web::Data::new(Some(dir.path().to_path_buf())),
            web::Data::new(Arc::new(BlizzardState::new())),
            test_sync_state(),
        )
        .await;
        assert_eq!(unknown.status(), 404);
        let body = to_bytes(unknown.into_body()).await.expect("unknown body");
        let payload: Value = serde_json::from_slice(&body).expect("unknown json");
        assert_eq!(
            payload.get("detail").and_then(Value::as_str),
            Some("Unknown data file key")
        );

        let cannot_download = download_data_file(
            web::Path::from("runtime_blizzard".to_string()),
            web::Data::new(Some(dir.path().to_path_buf())),
            web::Data::new(Arc::new(BlizzardState::new())),
            test_sync_state(),
        )
        .await;
        assert_eq!(cannot_download.status(), 400);
        let body = to_bytes(cannot_download.into_body())
            .await
            .expect("cannot download body");
        let payload: Value = serde_json::from_slice(&body).expect("cannot download json");
        assert_eq!(
            payload.get("detail").and_then(Value::as_str),
            Some("This entry cannot be downloaded directly")
        );
    }

    #[actix_web::test]
    async fn missing_data_file_download_rejects_unavailable_data_dir() {
        let resp = download_missing_data_files(
            web::Data::new(None),
            web::Data::new(Arc::new(BlizzardState::new())),
            test_sync_state(),
        )
        .await;
        assert_eq!(resp.status(), 400);
        let body = to_bytes(resp.into_body()).await.expect("missing body");
        let payload: Value = serde_json::from_slice(&body).expect("missing json");
        assert_eq!(
            payload.get("detail").and_then(Value::as_str),
            Some("Data directory is unavailable")
        );
    }

    fn raidbots_entry(key: &str, local_path: &str) -> catalog::DataFileEntry {
        catalog::DataFileEntry {
            key: key.to_string(),
            label: key.to_string(),
            section: "Test".to_string(),
            source: DataFileSource::Raidbots,
            remote_path: Some(local_path.to_string()),
            local_path: local_path.to_string(),
            required: true,
            entry_type: DataFileEntryType::File,
            bundled_path: None,
        }
    }

    fn recovery_snapshot_fixture(path: &str, contents: &[u8]) -> (Vec<u8>, Vec<u8>) {
        use sha2::{Digest, Sha256};
        use std::io::Write;

        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        zip.start_file::<_, ()>(path, zip::write::FileOptions::default())
            .expect("start recovery fixture entry");
        zip.write_all(contents)
            .expect("write recovery fixture entry");
        let archive = zip.finish().expect("finish recovery fixture").into_inner();
        let sha256 = |bytes: &[u8]| format!("{:x}", Sha256::digest(bytes));
        let manifest = serde_json::to_vec(&json!({
            "schema_version": 1,
            "generated_at": chrono::Utc::now(),
            "archive": {
                "name": "snapshot.zip",
                "sha256": sha256(&archive),
                "size": archive.len(),
            },
            "files": [{
                "path": path,
                "sha256": sha256(contents),
                "size": contents.len(),
            }],
        }))
        .expect("serialize recovery fixture manifest");
        (manifest, archive)
    }

    #[actix_web::test]
    async fn missing_data_repair_prefers_recovery_snapshot() {
        let root = tempfile::tempdir().expect("repair root");
        let entry = raidbots_entry("items", "items.json");
        let (manifest, archive) = recovery_snapshot_fixture("items.json", b"[]");
        let raidbots_attempts = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let recovery_root = root.path().to_path_buf();
        let recovery_entries = vec![entry.clone()];
        let recovery = recovery_snapshot::restore_missing_raidbots_files_from_bytes(
            &recovery_root,
            &recovery_entries,
            &manifest,
            &archive,
            |_| {},
        );

        let result = repair_missing_raidbots_entries(root.path(), &[entry], recovery, || {}, {
            let raidbots_attempts = raidbots_attempts.clone();
            move |_| {
                let raidbots_attempts = raidbots_attempts.clone();
                async move {
                    raidbots_attempts.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    Err("Raidbots is unavailable".to_string())
                }
            }
        })
        .await;

        assert_eq!(
            result.sources["recovery_snapshot"],
            vec!["items".to_string()]
        );
        assert!(result.sources["raidbots"].is_empty());
        assert!(result.failed.is_empty());
        assert_eq!(
            raidbots_attempts.load(std::sync::atomic::Ordering::SeqCst),
            0
        );
    }

    #[actix_web::test]
    async fn missing_data_repair_falls_back_only_after_snapshot_failure() {
        let root = tempfile::tempdir().expect("repair root");
        let entry = raidbots_entry("items", "items.json");
        let (mut manifest, archive) = recovery_snapshot_fixture("items.json", b"[]");
        manifest[0] = b'!';
        let recovery_root = root.path().to_path_buf();
        let recovery_entries = vec![entry.clone()];
        let recovery = recovery_snapshot::restore_missing_raidbots_files_from_bytes(
            &recovery_root,
            &recovery_entries,
            &manifest,
            &archive,
            |_| {},
        );

        let result = repair_missing_raidbots_entries(
            root.path(),
            &[entry],
            recovery,
            || {},
            |entry| {
                let target = root.path().join(&entry.local_path);
                async move {
                    std::fs::write(target, b"[]").map_err(|err| err.to_string())?;
                    Ok(())
                }
            },
        )
        .await;

        assert!(result.sources["recovery_snapshot"].is_empty());
        assert_eq!(result.sources["raidbots"], vec!["items".to_string()]);
        assert_eq!(result.failed.len(), 1);
        assert_eq!(result.failed[0]["source"], "recovery_snapshot");
        assert!(result.failed[0]["error"].is_string());
    }

    #[actix_web::test]
    async fn missing_data_repair_reports_recovery_failure_after_raidbots_fallback() {
        let root = tempfile::tempdir().expect("repair root");
        let entry = raidbots_entry("items", "items.json");

        let result = repair_missing_raidbots_entries(
            root.path(),
            &[entry],
            async { Err("snapshot unavailable".to_string()) },
            || {},
            |entry| {
                let target = root.path().join(&entry.local_path);
                async move {
                    std::fs::write(target, b"[]").map_err(|err| err.to_string())?;
                    Ok(())
                }
            },
        )
        .await;

        assert_eq!(result.sources["raidbots"], vec!["items".to_string()]);
        assert_eq!(result.failed.len(), 1);
        assert_eq!(result.failed[0]["source"], "recovery_snapshot");
        assert_eq!(result.failed[0]["error"], "snapshot unavailable");
    }

    #[actix_web::test]
    async fn missing_data_repair_reports_recovery_and_raidbots_failures() {
        let root = tempfile::tempdir().expect("repair root");
        let entry = raidbots_entry("items", "items.json");

        let result = repair_missing_raidbots_entries(
            root.path(),
            &[entry],
            async { Err("snapshot unavailable".to_string()) },
            || {},
            |_| async { Err("Raidbots unavailable".to_string()) },
        )
        .await;

        assert_eq!(result.failed.len(), 2);
        assert_eq!(result.failed[0]["source"], "recovery_snapshot");
        assert_eq!(result.failed[0]["error"], "snapshot unavailable");
        assert_eq!(result.failed[1]["source"], "raidbots");
        assert_eq!(result.failed[1]["error"], "Raidbots unavailable");
    }

    #[actix_web::test]
    async fn missing_data_repair_creates_missing_root_before_snapshot_restore() {
        let parent = tempfile::tempdir().expect("repair parent");
        let root = parent.path().join("missing-root");
        let entry = raidbots_entry("items", "items.json");
        let (manifest, archive) = recovery_snapshot_fixture("items.json", b"[]");
        let raidbots_attempts = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let recovery_entries = vec![entry.clone()];
        let recovery = recovery_snapshot::restore_missing_raidbots_files_from_bytes(
            &root,
            &recovery_entries,
            &manifest,
            &archive,
            |_| {},
        );

        let result = repair_missing_raidbots_entries(&root, &[entry], recovery, || {}, {
            let raidbots_attempts = raidbots_attempts.clone();
            move |_| {
                let raidbots_attempts = raidbots_attempts.clone();
                async move {
                    raidbots_attempts.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    Err("Raidbots is unavailable".to_string())
                }
            }
        })
        .await;

        assert_eq!(
            result.sources["recovery_snapshot"],
            vec!["items".to_string()]
        );
        assert!(result.failed.is_empty());
        assert_eq!(
            raidbots_attempts.load(std::sync::atomic::Ordering::SeqCst),
            0
        );
        assert_eq!(std::fs::read(root.join("items.json")).unwrap(), b"[]");
    }

    #[actix_web::test]
    async fn sync_status_reports_credential_availability_without_starting_sync() {
        let req = TestRequest::default().to_http_request();
        let state = test_sync_state();
        let store = test_store();

        let missing =
            get_sync_status(req.clone(), state.clone(), test_auth_state(), store.clone()).await;
        assert_eq!(missing.status(), 200);
        let missing_body = to_bytes(missing.into_body()).await.expect("status body");
        let missing_payload: Value = serde_json::from_slice(&missing_body).expect("status json");
        assert_eq!(
            missing_payload.get("can_sync").and_then(Value::as_bool),
            Some(false)
        );

        let configured_auth = web::Data::new(Arc::new(BlizzardAuthState::new(
            Some("client-id".to_string()),
            Some("client-secret".to_string()),
            "http://localhost/callback".to_string(),
            "test-secret".to_string(),
        )));
        let configured = get_sync_status(req, state, configured_auth, store).await;
        let configured_body = to_bytes(configured.into_body())
            .await
            .expect("configured status body");
        let configured_payload: Value =
            serde_json::from_slice(&configured_body).expect("configured status json");
        assert_eq!(
            configured_payload.get("can_sync").and_then(Value::as_bool),
            Some(true)
        );
    }

    #[actix_web::test]
    async fn trigger_sync_requires_credentials_and_marks_status() {
        let state = test_sync_state();
        let resp = trigger_sync(
            TestRequest::default().to_http_request(),
            web::Query(SyncQuery { force: None }),
            state.clone(),
            test_auth_state(),
            web::Data::new(Arc::new(BlizzardState::new())),
            test_store(),
            web::Data::new(None),
        )
        .await;

        assert_eq!(resp.status(), 400);
        assert_eq!(*state.status.lock().await, SyncStatus::NeedsCredentials);
    }

    #[actix_web::test]
    async fn trigger_dungeon_sync_rejects_when_sync_is_already_running() {
        let state = test_sync_state();
        *state.status.lock().await = SyncStatus::Syncing;

        let resp = trigger_dungeon_sync(
            TestRequest::default().to_http_request(),
            web::Query(SyncQuery { force: None }),
            state.clone(),
            test_auth_state(),
            web::Data::new(Arc::new(BlizzardState::new())),
            test_store(),
            web::Data::new(None),
        )
        .await;

        assert_eq!(resp.status(), 409);
        assert_eq!(*state.status.lock().await, SyncStatus::Syncing);
    }

    #[actix_web::test]
    async fn wowhead_zones_summary_filters_by_kind() {
        let dir = tempfile::tempdir().expect("temp zones dir");
        std::fs::write(
            dir.path().join(ZONES_INDEX_FILE_NAME),
            serde_json::to_vec(&json!({
                "zones": [
                    {"id": 1, "name": "Dungeon One", "is_raid": false},
                    {"id": 2, "name": "Raid One", "is_raid": true, "expansion": 10, "encounters": [{"name": "Boss"}]}
                ]
            }))
            .expect("zones json"),
        )
        .expect("write zones index");

        let resp = get_wowhead_zones_index_summary(
            web::Data::new(Some(dir.path().to_path_buf())),
            web::Query(WowheadZonesSummaryQuery {
                kind: Some("raid".to_string()),
            }),
        )
        .await;
        assert_eq!(resp.status(), 200);

        let body = to_bytes(resp.into_body()).await.expect("summary body");
        let payload: Value = serde_json::from_slice(&body).expect("summary json");
        assert!(payload
            .get("zones")
            .and_then(Value::as_array)
            .is_some_and(Vec::is_empty));
        assert_eq!(
            payload
                .get("raids")
                .and_then(Value::as_array)
                .and_then(|raids| raids.first())
                .and_then(|raid| raid.get("name"))
                .and_then(Value::as_str),
            Some("Raid One")
        );
    }

    #[actix_web::test]
    async fn wowhead_zone_match_finds_by_name_id_and_raid_filter() {
        let dir = tempfile::tempdir().expect("temp zones dir");
        std::fs::write(
            dir.path().join(ZONES_INDEX_FILE_NAME),
            serde_json::to_vec(&json!({
                "zones": [
                    {"id": 11, "name": "Dungeon One", "is_raid": false, "url": "https://wowhead.com/zone=111"},
                    {"id": 22, "name": "Raid One", "is_raid": true}
                ]
            }))
            .expect("zones json"),
        )
        .expect("write zones index");

        let by_name = get_wowhead_zone_match(
            web::Data::new(Some(dir.path().to_path_buf())),
            web::Query(WowheadZoneMatchQuery {
                instance_id: None,
                wowhead_id: None,
                name: Some("raid one".to_string()),
                is_raid: Some(true),
            }),
        )
        .await;
        assert_eq!(by_name.status(), 200);
        let body = to_bytes(by_name.into_body()).await.expect("match body");
        let payload: Value = serde_json::from_slice(&body).expect("match json");
        assert_eq!(payload["zone"]["id"].as_u64(), Some(22));

        let by_url_instance = get_wowhead_zone_match(
            web::Data::new(Some(dir.path().to_path_buf())),
            web::Query(WowheadZoneMatchQuery {
                instance_id: Some("111".to_string()),
                wowhead_id: None,
                name: None,
                is_raid: Some(false),
            }),
        )
        .await;
        assert_eq!(by_url_instance.status(), 200);
        let body = to_bytes(by_url_instance.into_body())
            .await
            .expect("url match body");
        let payload: Value = serde_json::from_slice(&body).expect("url match json");
        assert_eq!(payload["zone"]["id"].as_u64(), Some(11));
    }
}

async fn fetch_blizzard_mythic_dungeon_image_url(
    client: &reqwest::Client,
    client_id: &str,
    client_secret: &str,
    dungeon_id: u64,
    name_candidates: &[String],
) -> Option<String> {
    let token = BlizzardState::get_token_with_creds(client, client_id, client_secret).await?;
    fetch_blizzard_mythic_dungeon_image_url_with_token(client, &token, dungeon_id, name_candidates)
        .await
}

async fn fetch_blizzard_mythic_dungeon_image_url_with_token(
    client: &reqwest::Client,
    token: &str,
    dungeon_id: u64,
    name_candidates: &[String],
) -> Option<String> {
    let dungeon_url = format!(
        "https://us.api.blizzard.com/data/wow/mythic-keystone/dungeon/{}?namespace=dynamic-us&locale=en_US",
        dungeon_id
    );
    println!("[image-api] GET Blizzard mythic dungeon: {}", dungeon_url);
    let dungeon_res = client
        .get(&dungeon_url)
        .bearer_auth(token)
        .send()
        .await
        .ok()?;
    println!(
        "[image-api] Blizzard mythic dungeon status: {} (dungeon_id={})",
        dungeon_res.status(),
        dungeon_id
    );
    if !dungeon_res.status().is_success() {
        return None;
    }

    let dungeon_json: Value = dungeon_res.json().await.ok()?;
    if let Some(url) = media_url_from_entity_payload(&dungeon_json) {
        return Some(url);
    }

    if let Some(media_href) = dungeon_json
        .get("media")
        .and_then(|m| m.get("key"))
        .and_then(|k| k.get("href"))
        .and_then(|h| h.as_str())
    {
        if let Some(url) = media_url_from_media_href(client, token, media_href).await {
            return Some(url);
        }
    }

    if let Some(journal_id) = dungeon_json
        .get("journal_instance")
        .and_then(|v| v.get("id"))
        .and_then(|v| v.as_u64())
    {
        let candidates = vec![journal_id];
        return fetch_blizzard_journal_instance_image_url_with_token(client, token, &candidates)
            .await;
    }

    let mut names = name_candidates.to_vec();
    if let Some(name) = localized_str(dungeon_json.get("name")) {
        names.push(name);
    }
    if let Some(short_name) = localized_str(dungeon_json.get("short_name")) {
        names.push(short_name);
    }
    names.sort();
    names.dedup();
    if let Some(journal_id) = journal_instance_id_from_names_with_token(client, token, &names).await
    {
        println!(
            "[image-api] Mapped dungeon_id={} to journal_instance_id={} via name candidates",
            dungeon_id, journal_id
        );
        let candidates = vec![journal_id];
        return fetch_blizzard_journal_instance_image_url_with_token(client, token, &candidates)
            .await;
    }

    None
}

async fn fetch_blizzard_journal_instance_image_url(
    client: &reqwest::Client,
    client_id: &str,
    client_secret: &str,
    instance_candidates: &[u64],
) -> Option<String> {
    let token = BlizzardState::get_token_with_creds(client, client_id, client_secret).await?;
    fetch_blizzard_journal_instance_image_url_with_token(client, &token, instance_candidates).await
}

async fn fetch_blizzard_journal_instance_image_url_with_token(
    client: &reqwest::Client,
    token: &str,
    instance_candidates: &[u64],
) -> Option<String> {
    for instance_id in instance_candidates {
        let media_url = format!(
            "https://us.api.blizzard.com/data/wow/media/journal-instance/{}?namespace=static-us&locale=en_US",
            instance_id
        );
        println!(
            "[image-api] GET Blizzard journal media: {} (candidate={})",
            media_url, instance_id
        );
        let media_res = match client.get(&media_url).bearer_auth(token).send().await {
            Ok(res) => res,
            Err(_) => continue,
        };
        println!(
            "[image-api] Blizzard journal media status: {} (candidate={})",
            media_res.status(),
            instance_id
        );
        if !media_res.status().is_success() {
            continue;
        }
        let media_json: Value = match media_res.json().await {
            Ok(json) => json,
            Err(_) => continue,
        };
        if let Some(url) =
            best_blizzard_asset_url(&media_json).filter(|url| is_allowed_remote_image_url(url))
        {
            println!(
                "[image-api] Selected journal media asset for candidate {}: {}",
                instance_id, url
            );
            return Some(url);
        }
    }

    for instance_id in instance_candidates {
        let instance_url = format!(
            "https://us.api.blizzard.com/data/wow/journal-instance/{}?namespace=static-us&locale=en_US",
            instance_id
        );
        println!(
            "[image-api] GET Blizzard journal instance: {} (candidate={})",
            instance_url, instance_id
        );
        let instance_res = match client.get(&instance_url).bearer_auth(token).send().await {
            Ok(res) => res,
            Err(_) => continue,
        };
        println!(
            "[image-api] Blizzard journal instance status: {} (candidate={})",
            instance_res.status(),
            instance_id
        );
        if !instance_res.status().is_success() {
            continue;
        }
        let instance_json: Value = match instance_res.json().await {
            Ok(json) => json,
            Err(_) => continue,
        };

        if let Some(url) = media_url_from_entity_payload(&instance_json) {
            return Some(url);
        }

        let Some(media_href) = instance_json
            .get("media")
            .and_then(|m| m.get("key"))
            .and_then(|k| k.get("href"))
            .and_then(|h| h.as_str())
        else {
            continue;
        };

        if let Some(url) = media_url_from_media_href(client, token, media_href).await {
            return Some(url);
        }
    }

    None
}

pub async fn get_data_image(
    req: actix_web::HttpRequest,
    path: web::Path<(String, String)>,
    query: web::Query<DataImageQuery>,
    data_dir: web::Data<Option<PathBuf>>,
    blizzard: web::Data<Arc<BlizzardState>>,
    auth_state: web::Data<Arc<BlizzardAuthState>>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    let (image_type, id_raw) = path.into_inner();
    println!(
        "[image-api] Incoming request type={} id_raw={} query_source={:?}",
        image_type, id_raw, query.source
    );
    if image_type != "instance" && image_type != "encounter" {
        return HttpResponse::BadRequest()
            .json(json!({"detail": "Unsupported image type. Use 'instance' or 'encounter'."}));
    }

    let id = match id_raw.parse::<u64>() {
        Ok(id) => id,
        Err(_) => return HttpResponse::BadRequest().json(json!({"detail": "Invalid image id"})),
    };

    let Some(root) = data_dir.get_ref().clone() else {
        return HttpResponse::BadRequest().json(json!({"detail": "Data directory is unavailable"}));
    };
    let images_dir = root.join("instance-images");
    std::fs::create_dir_all(&images_dir).ok();

    if let Some(cached_path) = find_cached_image_file(&images_dir, &image_type, id) {
        println!(
            "[image-api] Cache hit type={} id={} path={}",
            image_type,
            id,
            cached_path.display()
        );
        match std::fs::read(&cached_path) {
            Ok(bytes) => {
                let ext = cached_path
                    .extension()
                    .and_then(|v| v.to_str())
                    .unwrap_or("jpg")
                    .to_ascii_lowercase();
                return HttpResponse::Ok()
                    .append_header(("Cache-Control", "no-store, no-cache, must-revalidate"))
                    .content_type(content_type_for_extension(&ext))
                    .body(bytes);
            }
            Err(err) => {
                return HttpResponse::InternalServerError().json(json!({
                    "detail": format!("Failed to read cached image: {}", err)
                }));
            }
        }
    }
    println!("[image-api] Cache miss type={} id={}", image_type, id);

    let hinted_source = query
        .source
        .as_deref()
        .filter(|url| is_http_url(url))
        .map(ToOwned::to_owned);
    let hinted_allowed = hinted_source
        .clone()
        .filter(|url| is_allowed_remote_image_url(url));
    let mut source_url = hinted_allowed.clone();
    if let Some(url) = &hinted_allowed {
        println!("[image-api] Using hinted allowed source URL: {}", url);
    }

    if source_url.is_none() && image_type == "instance" {
        let candidate_ids = journal_instance_candidates(id);
        let name_candidates = runtime_dungeon_name_candidates(id);

        if let Some((client_id, client_secret)) =
            BlizzardState::get_effective_credentials(&req, Some(auth_state.get_ref()), &***store)
        {
            source_url = fetch_blizzard_mythic_dungeon_image_url(
                &blizzard.client,
                &client_id,
                &client_secret,
                id,
                &name_candidates,
            )
            .await;
            if source_url.is_none() {
                source_url = fetch_blizzard_journal_instance_image_url(
                    &blizzard.client,
                    &client_id,
                    &client_secret,
                    &candidate_ids,
                )
                .await;
            }
        } else if let Some(claims) = verify_jwt(&req, &auth_state.jwt_secret) {
            if let Some(access_token) = auth_state.oauth_token(&claims.session_id) {
                source_url = fetch_blizzard_mythic_dungeon_image_url_with_token(
                    &blizzard.client,
                    &access_token,
                    id,
                    &name_candidates,
                )
                .await;
                if source_url.is_none() {
                    source_url = fetch_blizzard_journal_instance_image_url_with_token(
                        &blizzard.client,
                        &access_token,
                        &candidate_ids,
                    )
                    .await;
                }
            }
        }
    }
    if source_url.is_none() {
        source_url =
            find_runtime_image_url(&image_type, id).filter(|url| is_allowed_remote_image_url(url));
        if let Some(url) = &source_url {
            println!("[image-api] Using runtime source URL: {}", url);
        }
    }

    let Some(source_url) = source_url else {
        println!(
            "[image-api] No source URL resolved type={} id={}",
            image_type, id
        );
        return image_error_response(actix_web::http::StatusCode::NOT_FOUND, "no_source");
    };
    if !is_allowed_remote_image_url(&source_url) {
        println!(
            "[image-api] Rejected source host type={} id={} url={}",
            image_type, id, source_url
        );
        return image_error_response(actix_web::http::StatusCode::BAD_REQUEST, "unsupported_host");
    }

    println!(
        "[image-api] Fetching final image type={} id={} url={}",
        image_type, id, source_url
    );
    let response = match blizzard.client.get(&source_url).send().await {
        Ok(res) => res,
        Err(err) => {
            let _ = err;
            println!(
                "[image-api] Final image fetch error type={} id={} url={}",
                image_type, id, source_url
            );
            return image_error_response(actix_web::http::StatusCode::BAD_GATEWAY, "fetch_error");
        }
    };
    println!(
        "[image-api] Final image status type={} id={} status={} url={}",
        image_type,
        id,
        response.status(),
        source_url
    );
    if !response.status().is_success() {
        return image_error_response(actix_web::http::StatusCode::BAD_GATEWAY, "remote_status");
    }
    let bytes = match response.bytes().await {
        Ok(bytes) => bytes,
        Err(err) => {
            let _ = err;
            return image_error_response(actix_web::http::StatusCode::BAD_GATEWAY, "read_error");
        }
    };
    println!(
        "[image-api] Final image bytes type={} id={} size={}",
        image_type,
        id,
        bytes.len()
    );

    let ext = infer_image_extension(&source_url);
    let target = images_dir.join(format!(
        "{}-{}-{}.{}",
        image_type, id, IMAGE_CACHE_VERSION, ext
    ));
    if std::fs::write(&target, &bytes).is_err() {
        // Best-effort cache write; still return downloaded bytes.
    }

    HttpResponse::Ok()
        .append_header(("Cache-Control", "no-store, no-cache, must-revalidate"))
        .content_type(content_type_for_extension(ext))
        .body(bytes)
}

async fn download_raidbots_file(
    client: &reqwest::Client,
    data_root: &Path,
    remote_path: &str,
    local_path: &str,
) -> Result<(), String> {
    let base_url = "https://www.raidbots.com/static/data/live";
    let file_url = format!("{}/{}", base_url, remote_path);
    let dst = data_root.join(local_path);
    if let Some(parent) = dst.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let res = client
        .get(&file_url)
        .send()
        .await
        .map_err(|e| format!("Failed to download {}: {}", remote_path, e))?;
    if !res.status().is_success() {
        return Err(format!(
            "Failed to download {}: HTTP {}",
            remote_path,
            res.status()
        ));
    }
    let bytes = res
        .bytes()
        .await
        .map_err(|e| format!("Failed to read {}: {}", remote_path, e))?;
    write_runtime_file_atomically(&dst, &bytes)
        .map_err(|e| format!("Failed to save {}: {}", local_path, e))?;
    Ok(())
}

#[derive(Default)]
struct MissingDataRepairResult {
    downloaded_keys: Vec<String>,
    sources: BTreeMap<String, Vec<String>>,
    failed: Vec<Value>,
}

impl MissingDataRepairResult {
    fn new() -> Self {
        let mut sources = BTreeMap::new();
        for source in ["bundled", "recovery_snapshot", "raidbots"] {
            sources.insert(source.to_string(), Vec::new());
        }
        Self {
            sources,
            ..Self::default()
        }
    }

    fn restored(&mut self, source: &str, entry: &catalog::DataFileEntry) {
        self.downloaded_keys.push(entry.key.clone());
        self.sources
            .get_mut(source)
            .expect("repair source initialized")
            .push(entry.key.clone());
    }

    fn failed(&mut self, source: &str, entry: &catalog::DataFileEntry, error: String) {
        self.failed.push(json!({
            "source": source,
            "key": entry.key,
            "relative_path": entry.local_path,
            "error": error,
        }));
    }

    fn merge(&mut self, other: Self) {
        self.downloaded_keys.extend(other.downloaded_keys);
        self.failed.extend(other.failed);
        for (source, keys) in other.sources {
            self.sources
                .get_mut(&source)
                .expect("repair source initialized")
                .extend(keys);
        }
    }
}

async fn restore_local_entries(
    root: &Path,
    entries: &[catalog::DataFileEntry],
    client: &reqwest::Client,
    result: &mut MissingDataRepairResult,
) {
    for entry in entries {
        let restore_result = if entry.key == ZONES_INDEX_ENTRY_KEY {
            download_github_release_asset(
                client,
                env!("CARGO_PKG_VERSION"),
                ZONES_INDEX_FILE_NAME,
                &resolve_zones_index_path(root),
            )
            .await
        } else {
            restore_local_file_from_bundle(root, entry)
        };
        match restore_result {
            Ok(()) => result.restored("bundled", entry),
            Err(error) => result.failed("bundled", entry, error),
        }
    }
}

async fn repair_missing_raidbots_entries<R, D, DFut, P>(
    root: &Path,
    entries: &[catalog::DataFileEntry],
    recovery: R,
    mut report_snapshot_failure: P,
    mut download: D,
) -> MissingDataRepairResult
where
    R: Future<Output = Result<Vec<String>, String>>,
    D: FnMut(catalog::DataFileEntry) -> DFut,
    DFut: Future<Output = Result<(), String>>,
    P: FnMut(),
{
    let mut result = MissingDataRepairResult::new();
    match recovery.await {
        Ok(restored) => {
            for key in restored {
                if let Some(entry) = entries.iter().find(|entry| entry.key == key) {
                    result.restored("recovery_snapshot", entry);
                }
            }
        }
        Err(error) => {
            result.failed.push(json!({
                "source": "recovery_snapshot",
                "error": error,
            }));
            report_snapshot_failure();
        }
    }

    for entry in entries
        .iter()
        .filter(|entry| !resolve_data_file_read_path(root, entry).exists())
    {
        match download(entry.clone()).await {
            Ok(()) => result.restored("raidbots", entry),
            Err(error) => result.failed("raidbots", entry, error),
        }
    }
    result
}

fn repair_progress(
    current: usize,
    total: usize,
    detail: &str,
    downloaded_bytes: u64,
    total_bytes: u64,
    started: Instant,
    speed_bytes_per_sec: u64,
) -> String {
    format!(
        "Repair:{current}:{total}:{detail}:{downloaded_bytes}:{total_bytes}:{}:{speed_bytes_per_sec}",
        started.elapsed().as_millis()
    )
}

pub async fn download_data_file(
    path: web::Path<String>,
    data_dir: web::Data<Option<PathBuf>>,
    blizzard: web::Data<Arc<BlizzardState>>,
    state: web::Data<Arc<DataSyncState>>,
) -> HttpResponse {
    let _operation = state.operation_lock.lock().await;
    let key = path.into_inner();
    let catalog = match data_file_catalog() {
        Ok(entries) => entries,
        Err(err) => {
            return HttpResponse::InternalServerError().json(json!({
                "detail": err,
            }));
        }
    };
    let Some(root) = data_dir.get_ref().clone() else {
        return HttpResponse::BadRequest().json(json!({"detail": "Data directory is unavailable"}));
    };

    let Some(entry) = catalog.iter().find(|e| e.key == key) else {
        return HttpResponse::NotFound().json(json!({"detail": "Unknown data file key"}));
    };

    if entry.source == DataFileSource::Local {
        if entry.key == ZONES_INDEX_ENTRY_KEY {
            let destination = resolve_zones_index_path(&root);
            let version = env!("CARGO_PKG_VERSION");
            match download_github_release_asset(
                &blizzard.client,
                version,
                ZONES_INDEX_FILE_NAME,
                &destination,
            )
            .await
            {
                Ok(()) => {
                    crate::item_db::load(&root);
                    let runtime_file = root.join("blizzard-runtime-data.json");
                    if runtime_file.exists() {
                        crate::item_db::hydrate_runtime_metadata(&runtime_file);
                    }
                    return HttpResponse::Ok().json(json!({
                        "status": "ok",
                        "key": entry.key,
                        "relative_path": entry.local_path,
                        "downloaded_from_release": true,
                        "version": version,
                    }));
                }
                Err(e) => {
                    return HttpResponse::InternalServerError().json(json!({"detail": e}));
                }
            }
        }

        match restore_local_file_from_bundle(&root, entry) {
            Ok(()) => {
                crate::item_db::load(&root);
                let runtime_file = root.join("blizzard-runtime-data.json");
                if runtime_file.exists() {
                    crate::item_db::hydrate_runtime_metadata(&runtime_file);
                }
                return HttpResponse::Ok().json(json!({
                    "status": "ok",
                    "key": entry.key,
                    "relative_path": entry.local_path,
                    "restored_from_bundled": true,
                }));
            }
            Err(e) => {
                return HttpResponse::InternalServerError().json(json!({"detail": e}));
            }
        }
    }

    if entry.source != DataFileSource::Raidbots {
        return HttpResponse::BadRequest()
            .json(json!({"detail": "This entry cannot be downloaded directly"}));
    }

    let Some(remote_path) = entry.remote_path.as_deref() else {
        return HttpResponse::BadRequest()
            .json(json!({"detail": "Missing remote path in data manifest for this entry"}));
    };

    match download_raidbots_file(&blizzard.client, &root, remote_path, &entry.local_path).await {
        Ok(()) => {
            crate::item_db::load(&root);
            let runtime_file = root.join("blizzard-runtime-data.json");
            if runtime_file.exists() {
                crate::item_db::hydrate_runtime_metadata(&runtime_file);
            }
            HttpResponse::Ok().json(json!({
                "status": "ok",
                "key": entry.key,
                "relative_path": entry.local_path,
            }))
        }
        Err(e) => HttpResponse::InternalServerError().json(json!({"detail": e})),
    }
}

pub async fn download_missing_data_files(
    data_dir: web::Data<Option<PathBuf>>,
    blizzard: web::Data<Arc<BlizzardState>>,
    state: web::Data<Arc<DataSyncState>>,
) -> HttpResponse {
    let _operation = state.operation_lock.lock().await;
    let catalog = match data_file_catalog() {
        Ok(entries) => entries,
        Err(err) => {
            return HttpResponse::InternalServerError().json(json!({
                "detail": err,
            }));
        }
    };
    let Some(root) = data_dir.get_ref().clone() else {
        return HttpResponse::BadRequest().json(json!({"detail": "Data directory is unavailable"}));
    };

    let missing_entries: Vec<_> = catalog
        .into_iter()
        .filter(|entry| {
            entry.entry_type == DataFileEntryType::File
                && ((entry.source == DataFileSource::Raidbots && entry.remote_path.is_some())
                    || (entry.source == DataFileSource::Local && entry.bundled_path.is_some()))
        })
        .filter(|entry| {
            let path = if entry.source == DataFileSource::Local && entry.bundled_path.is_some() {
                catalog::resolve_runtime_path(&root, entry)
            } else {
                resolve_data_file_read_path(&root, entry)
            };
            !path.exists()
        })
        .collect();
    let (local_entries, raidbots_entries): (Vec<_>, Vec<_>) = missing_entries
        .into_iter()
        .partition(|entry| entry.source == DataFileSource::Local);
    let mut result = MissingDataRepairResult::new();
    restore_local_entries(&root, &local_entries, &blizzard.client, &mut result).await;

    if !raidbots_entries.is_empty() {
        let started = Instant::now();
        let raidbots_total = raidbots_entries.len();
        let progress_state = state.get_ref().clone();
        let recovery_progress_state = progress_state.clone();
        let recovery = recovery_snapshot::restore_missing_raidbots_files(
            &blizzard.client,
            &root,
            &raidbots_entries,
            move |progress| {
                if let Ok(mut value) = recovery_progress_state.progress.try_lock() {
                    *value = repair_progress(
                        progress.current,
                        progress.total,
                        &progress.detail,
                        progress.downloaded_bytes,
                        progress.total_bytes,
                        started,
                        progress.speed_bytes_per_sec,
                    );
                }
            },
        );
        let raidbots_client = blizzard.get_ref().clone();
        let raidbots_root = root.clone();
        let raidbots_result = repair_missing_raidbots_entries(
            &root,
            &raidbots_entries,
            recovery,
            move || {
                if let Ok(mut value) = progress_state.progress.try_lock() {
                    *value = repair_progress(
                        0,
                        raidbots_total,
                        "Recovery snapshot unavailable; trying Raidbots",
                        0,
                        0,
                        started,
                        0,
                    );
                }
            },
            move |entry| {
                let client = raidbots_client.clone();
                let root = raidbots_root.clone();
                async move {
                    let remote_path = entry
                        .remote_path
                        .as_deref()
                        .expect("raidbots repair entries must have remote paths");
                    download_raidbots_file(&client.client, &root, remote_path, &entry.local_path)
                        .await
                }
            },
        )
        .await;
        result.merge(raidbots_result);
    }

    if !result.downloaded_keys.is_empty() {
        crate::item_db::load(&root);
        let runtime_file = root.join("blizzard-runtime-data.json");
        if runtime_file.exists() {
            crate::item_db::hydrate_runtime_metadata(&runtime_file);
        }
    }

    HttpResponse::Ok().json(json!({
        "status": if result.failed.is_empty() { "ok" } else { "partial" },
        "downloaded_keys": result.downloaded_keys,
        "sources": result.sources,
        "failed": result.failed,
    }))
}

pub async fn get_sync_status(
    req: actix_web::HttpRequest,
    state: web::Data<Arc<DataSyncState>>,
    auth_state: web::Data<Arc<BlizzardAuthState>>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    let status = state.status.lock().await.clone();
    let progress = state.progress.lock().await.clone();

    let can_sync =
        BlizzardState::get_effective_credentials(&req, Some(auth_state.get_ref()), &***store)
            .is_some();

    HttpResponse::Ok().json(json!({
        "status": status,
        "progress": progress,
        "can_sync": can_sync,
    }))
}

pub async fn trigger_sync(
    req: actix_web::HttpRequest,
    query: web::Query<SyncQuery>,
    state: web::Data<Arc<DataSyncState>>,
    auth_state: web::Data<Arc<BlizzardAuthState>>,
    blizzard: web::Data<Arc<BlizzardState>>,
    store: web::Data<Arc<dyn JobStorage>>,
    data_dir: web::Data<Option<PathBuf>>,
) -> HttpResponse {
    let mut status = state.status.lock().await;
    if *status == SyncStatus::Syncing {
        return HttpResponse::Conflict().json(json!({"detail": "Sync already in progress"}));
    }

    let creds =
        BlizzardState::get_effective_credentials(&req, Some(auth_state.get_ref()), &***store);
    if creds.is_none() {
        *status = SyncStatus::NeedsCredentials;
        return HttpResponse::BadRequest()
            .json(json!({"detail": "Blizzard API credentials required"}));
    }
    let (client_id, client_secret) = creds.unwrap();

    *status = SyncStatus::Syncing;
    let state_clone = state.get_ref().clone();
    let blizzard_clone = blizzard.get_ref().clone();
    let data_dir_clone = data_dir.get_ref().clone();
    let force_refresh = query.force.unwrap_or(false);

    tokio::spawn(async move {
        if let Err(e) = perform_sync(
            state_clone.clone(),
            blizzard_clone,
            client_id,
            client_secret,
            data_dir_clone,
            force_refresh,
        )
        .await
        {
            let mut s = state_clone.status.lock().await;
            *s = SyncStatus::Error(e);
        } else {
            let mut s = state_clone.status.lock().await;
            *s = SyncStatus::Ready;
        }
    });

    HttpResponse::Accepted().finish()
}

pub async fn trigger_dungeon_sync(
    req: actix_web::HttpRequest,
    query: web::Query<SyncQuery>,
    state: web::Data<Arc<DataSyncState>>,
    auth_state: web::Data<Arc<BlizzardAuthState>>,
    blizzard: web::Data<Arc<BlizzardState>>,
    store: web::Data<Arc<dyn JobStorage>>,
    data_dir: web::Data<Option<PathBuf>>,
) -> HttpResponse {
    let mut status = state.status.lock().await;
    if *status == SyncStatus::Syncing {
        return HttpResponse::Conflict().json(json!({"detail": "Sync already in progress"}));
    }

    let creds =
        BlizzardState::get_effective_credentials(&req, Some(auth_state.get_ref()), &***store);
    if creds.is_none() {
        *status = SyncStatus::NeedsCredentials;
        return HttpResponse::BadRequest()
            .json(json!({"detail": "Blizzard API credentials required"}));
    }
    let (client_id, client_secret) = creds.unwrap();

    *status = SyncStatus::Syncing;
    let state_clone = state.get_ref().clone();
    let blizzard_clone = blizzard.get_ref().clone();
    let data_dir_clone = data_dir.get_ref().clone();
    let force_refresh = query.force.unwrap_or(false);

    tokio::spawn(async move {
        if let Err(e) = perform_dungeon_sync(
            state_clone.clone(),
            blizzard_clone,
            client_id,
            client_secret,
            data_dir_clone,
            force_refresh,
        )
        .await
        {
            let mut s = state_clone.status.lock().await;
            *s = SyncStatus::Error(e);
        } else {
            let mut s = state_clone.status.lock().await;
            *s = SyncStatus::Ready;
        }
    });

    HttpResponse::Accepted().finish()
}

async fn perform_sync(
    state: Arc<DataSyncState>,
    blizzard: Arc<BlizzardState>,
    client_id: String,
    client_secret: String,
    data_dir: Option<PathBuf>,
    force_refresh: bool,
) -> Result<(), String> {
    let _operation = state.operation_lock.lock().await;
    let request_timeout = Duration::from_secs(15);
    if let Some(ref dir) = data_dir {
        let destination = dir.join(ZONES_INDEX_FILE_NAME);
        if !destination.exists() {
            // Local-first fallback chain for zones index:
            // 1) Use local file when present
            // 2) Otherwise try release download
            // 3) Error only if neither is available
            download_github_release_asset_with_progress(
                &blizzard.client,
                env!("CARGO_PKG_VERSION"),
                ZONES_INDEX_FILE_NAME,
                &destination,
                &state,
                1,
                1,
            )
            .await?;
        }
    }

    // 1. Fetch from Raidbots
    let base_url = "https://www.raidbots.com/static/data/live";
    let metadata_url = format!("{}/metadata.json", base_url);

    {
        let mut p = state.progress.lock().await;
        *p = "Metadata:0:1:Checking Raidbots metadata...".to_string();
    }

    let metadata_text = match tokio::time::timeout(
        request_timeout,
        blizzard.client.get(&metadata_url).send(),
    )
    .await
    {
        Ok(Ok(res)) => res
            .text()
            .await
            .map_err(|e| format!("Failed to read metadata: {}", e))?,
        Ok(Err(e)) => {
            if let Some(ref dir) = data_dir {
                let local_metadata_path = dir.join("metadata.json");
                if local_metadata_path.exists() {
                    eprintln!(
                        "Raidbots metadata fetch failed ({}). Falling back to cached metadata.json.",
                        e
                    );
                    std::fs::read_to_string(&local_metadata_path).map_err(|ioe| {
                        format!(
                            "Failed to fetch metadata ({}) and failed to read cached metadata ({}): {}",
                            e,
                            local_metadata_path.display(),
                            ioe
                        )
                    })?
                } else {
                    return Err(format!("Failed to fetch metadata: {}", e));
                }
            } else {
                return Err(format!("Failed to fetch metadata: {}", e));
            }
        }
        Err(_) => {
            if let Some(ref dir) = data_dir {
                let local_metadata_path = dir.join("metadata.json");
                if local_metadata_path.exists() {
                    eprintln!(
                        "Raidbots metadata request timed out. Falling back to cached metadata.json."
                    );
                    std::fs::read_to_string(&local_metadata_path).map_err(|ioe| {
                        format!(
                            "Metadata request timed out and failed to read cached metadata ({}): {}",
                            local_metadata_path.display(),
                            ioe
                        )
                    })?
                } else {
                    return Err(
                        "Raidbots metadata request timed out and no cached metadata.json exists"
                            .to_string(),
                    );
                }
            } else {
                return Err("Raidbots metadata request timed out".to_string());
            }
        }
    };

    // Check if we need to sync based on metadata changes
    let mut skip_raidbots = false;
    if !force_refresh {
        if let Some(ref dir) = data_dir {
            let local_metadata_path = dir.join("metadata.json");
            if local_metadata_path.exists() {
                if let Ok(local_metadata) = std::fs::read_to_string(&local_metadata_path) {
                    if local_metadata == metadata_text {
                        println!("Raidbots metadata matches local cache. Skipping file downloads.");
                        skip_raidbots = true;
                    }
                }
            }
        }
    }

    if !skip_raidbots {
        // Extract all file names ending in .json, .txt, or .lua
        let re = regex::Regex::new(r#""([^"]*\.(json|txt|lua))""#).unwrap();
        let files: Vec<String> = re
            .captures_iter(&metadata_text)
            .filter_map(|cap| cap.get(1).map(|m| m.as_str().to_string()))
            .collect();

        let total_files = files.len();
        if let Some(dir) = &data_dir {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
            let staging = tempfile::Builder::new()
                .prefix("raidbots-sync-")
                .tempdir_in(dir)
                .map_err(|e| format!("Failed to create staging directory: {}", e))?;
            let staging_path = staging.path().to_path_buf();

            for (i, file_name) in files.iter().enumerate() {
                {
                    let mut p = state.progress.lock().await;
                    *p = format!("Files:{}:{}:{}", i + 1, total_files, file_name);
                }

                let file_url = format!("{}/{}", base_url, file_name);
                let file_path = staging_path.join(file_name);
                if let Some(parent) = file_path.parent() {
                    std::fs::create_dir_all(parent).map_err(|e| {
                        format!("Failed to create directory for {}: {}", file_name, e)
                    })?;
                }

                let file_res =
                    tokio::time::timeout(request_timeout, blizzard.client.get(&file_url).send())
                        .await
                        .map_err(|_| format!("Timed out while downloading {}", file_name))?
                        .map_err(|e| format!("Failed to download {}: {}", file_name, e))?;
                let total_bytes = file_res.content_length();
                let started_at = Instant::now();
                let mut downloaded_bytes = 0_u64;
                let mut content =
                    Vec::with_capacity(total_bytes.unwrap_or(0).min(10_000_000) as usize);
                let mut stream = file_res.bytes_stream();

                while let Some(chunk) = stream.next().await {
                    let chunk =
                        chunk.map_err(|e| format!("Failed to read {}: {}", file_name, e))?;
                    downloaded_bytes += chunk.len() as u64;
                    content.extend_from_slice(&chunk);

                    let mut p = state.progress.lock().await;
                    *p = raidbots_file_progress(
                        i + 1,
                        total_files,
                        file_name,
                        downloaded_bytes,
                        total_bytes,
                        started_at.elapsed(),
                    );
                }

                std::fs::write(&file_path, content)
                    .map_err(|e| format!("Failed to save {}: {}", file_name, e))?;
            }

            {
                let mut p = state.progress.lock().await;
                *p = "Applying staged Raidbots data...".to_string();
            }
            stage_raidbots_files(&staging_path, dir, &files, &metadata_text)?;
        }
    }

    // 2. Blizzard Season Sync (Rotation Data)
    let mut skip_blizzard = false;
    if !force_refresh {
        if let Some(ref dir) = data_dir {
            let runtime_file = dir.join("blizzard-runtime-data.json");
            if runtime_file.exists() {
                if let Ok(content) = std::fs::read_to_string(&runtime_file) {
                    if let Ok(v) = serde_json::from_str::<Value>(&content) {
                        if let Some(last_sync_str) = v.get("last_sync").and_then(|ls| ls.as_str()) {
                            if let Ok(last_sync) =
                                chrono::DateTime::parse_from_rfc3339(last_sync_str)
                            {
                                let now = chrono::Utc::now();
                                if now.signed_duration_since(last_sync).num_hours() < 24 {
                                    println!("Blizzard sync performed recently. Skipping.");
                                    skip_blizzard = true;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if !skip_blizzard {
        let season_index_url = "https://us.api.blizzard.com/data/wow/mythic-keystone/season/index?namespace=dynamic-us&locale=en_US";
        let token =
            BlizzardState::get_token_with_creds(&blizzard.client, &client_id, &client_secret)
                .await
                .ok_or("Failed to authenticate with Blizzard")?;
        let res = blizzard
            .client
            .get(season_index_url)
            .bearer_auth(&token)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let season_index: Value = res.json().await.map_err(|e| e.to_string())?;

        let current_season_id = season_index
            .get("current_season")
            .and_then(|s| s.get("id"))
            .and_then(|id| id.as_i64())
            .ok_or("Could not find current season ID")?;

        {
            let mut p = state.progress.lock().await;
            *p = format!("Fetching details for Season {}...", current_season_id);
        }

        let season_url = format!("https://us.api.blizzard.com/data/wow/mythic-keystone/season/{}?namespace=dynamic-us&locale=en_US", current_season_id);
        let res = blizzard
            .client
            .get(&season_url)
            .bearer_auth(&token)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let season_data: Value = res.json().await.map_err(|e| e.to_string())?;

        let mut rotation_dungeons = Vec::new();
        let mut dungeon_details: Vec<Value> = Vec::new();
        let dungeons = season_data.get("dungeons").and_then(|d| d.as_array());
        let dungeon_count = dungeons.map(|d| d.len()).unwrap_or(0);

        // Blizzard sometimes returns localized name objects (e.g. {"en_US": "..."}).
        let localized_str = |v: Option<&Value>| -> Option<String> {
            let value = v?;
            if let Some(s) = value.as_str() {
                return Some(s.to_string());
            }
            if let Some(obj) = value.as_object() {
                if let Some(en) = obj.get("en_US").and_then(|x| x.as_str()) {
                    return Some(en.to_string());
                }
                if let Some(any) = obj.values().find_map(|x| x.as_str()) {
                    return Some(any.to_string());
                }
            }
            None
        };

        // Get season name for storage
        let season_name = localized_str(season_data.get("name"))
            .unwrap_or_else(|| format!("Season {}", current_season_id));

        if let Some(dungeons) = dungeons {
            for (i, dungeon) in dungeons.iter().enumerate() {
                let name = localized_str(dungeon.get("name"))
                    .or_else(|| localized_str(dungeon.get("short_name")))
                    .unwrap_or_else(|| "Unknown Dungeon".to_string());
                let id = dungeon.get("id").and_then(|v| v.as_i64());
                let href = dungeon
                    .get("key")
                    .and_then(|k| k.get("href"))
                    .and_then(|h| h.as_str());
                let href_id = href
                    .and_then(|h| h.split("/mythic-keystone/dungeon/").nth(1))
                    .and_then(|tail| tail.split('?').next())
                    .and_then(|id_str| id_str.parse::<i64>().ok());
                let dungeon_id = id.or(href_id);

                {
                    let mut p = state.progress.lock().await;
                    *p = format!("Dungeons:{}:{}:{}", i + 1, dungeon_count, name);
                }

                // Try to fetch details for this dungeon from Blizzard API
                if let Some(dungeon_id) = dungeon_id {
                    let dungeon_url = if let Some(h) = href {
                        if h.contains("locale=") {
                            h.to_string()
                        } else if h.contains('?') {
                            format!("{h}&locale=en_US")
                        } else {
                            format!("{h}?locale=en_US")
                        }
                    } else {
                        format!(
                            "https://us.api.blizzard.com/data/wow/mythic-keystone/dungeon/{}?namespace=dynamic-us&locale=en_US",
                            dungeon_id
                        )
                    };

                    if let Ok(res) = blizzard
                        .client
                        .get(&dungeon_url)
                        .bearer_auth(&token)
                        .send()
                        .await
                    {
                        let json_result = res.json::<Value>().await.ok();
                        if let Some(detail_data) = json_result {
                            let description = detail_data
                                .get("description")
                                .and_then(|d| d.as_str())
                                .map(|s| s.to_string())
                                .or_else(|| localized_str(detail_data.get("description")));
                            let zone = detail_data
                                .get("location")
                                .and_then(|l| l.get("name"))
                                .and_then(|n| localized_str(Some(n)))
                                .or_else(|| {
                                    detail_data
                                        .get("instance_map")
                                        .and_then(|m| m.get("name"))
                                        .and_then(|n| localized_str(Some(n)))
                                });
                            let slug = detail_data
                                .get("slug")
                                .and_then(|s| s.as_str())
                                .map(|s| s.to_string());
                            let short_name = detail_data
                                .get("short_name")
                                .and_then(|s| s.as_str())
                                .map(|s| s.to_string());
                            let expansion_id = detail_data
                                .get("expansion")
                                .and_then(|e| e.get("id"))
                                .and_then(|v| v.as_i64());
                            let expansion_name = detail_data
                                .get("expansion")
                                .and_then(|e| e.get("name"))
                                .and_then(|n| localized_str(Some(n)));
                            let map_id = detail_data
                                .get("instance_map")
                                .and_then(|m| m.get("id"))
                                .and_then(|v| v.as_i64());
                            let challenge_mode_id = detail_data
                                .get("challenge_mode")
                                .and_then(|cm| cm.get("id"))
                                .and_then(|v| v.as_i64());
                            let minimum_level =
                                detail_data.get("minimum_level").and_then(|v| v.as_i64());
                            let keystone_timer_ms = detail_data
                                .get("keystone_timer_ms")
                                .and_then(|v| v.as_i64())
                                .or_else(|| detail_data.get("timer_ms").and_then(|v| v.as_i64()));
                            let keystone_upgrades: Vec<i64> = detail_data
                                .get("keystone_upgrades")
                                .and_then(|a| a.as_array())
                                .map(|arr| arr.iter().filter_map(|v| v.as_i64()).collect())
                                .unwrap_or_default();
                            let encounter_names: Vec<String> = detail_data
                                .get("encounters")
                                .and_then(|a| a.as_array())
                                .map(|arr| {
                                    arr.iter()
                                        .filter_map(|enc| {
                                            enc.get("name").and_then(|n| localized_str(Some(n)))
                                        })
                                        .collect()
                                })
                                .unwrap_or_default();
                            let blizzard_href = detail_data
                                .get("key")
                                .and_then(|k| k.get("href"))
                                .and_then(|h| h.as_str())
                                .map(|s| s.to_string());

                            let mut detail = json!({"id": dungeon_id, "name": name});

                            if let Some(desc) = description {
                                detail["description"] = json!(desc);
                            }
                            if let Some(z) = zone {
                                detail["zone"] = json!(z);
                            }
                            if let Some(s) = slug {
                                detail["slug"] = json!(s);
                            }
                            if let Some(s) = short_name {
                                detail["short_name"] = json!(s);
                            }
                            if let Some(exp) = expansion_id {
                                detail["expansion"] = json!(exp);
                            }
                            if let Some(exp_name) = expansion_name {
                                detail["expansion_name"] = json!(exp_name);
                            }
                            if let Some(mid) = map_id {
                                detail["map_id"] = json!(mid);
                            }
                            if let Some(cmid) = challenge_mode_id {
                                detail["challenge_mode_id"] = json!(cmid);
                            }
                            if let Some(level) = minimum_level {
                                detail["minimum_level"] = json!(level);
                            }
                            if let Some(timer) = keystone_timer_ms {
                                detail["keystone_timer_ms"] = json!(timer);
                            }
                            if !keystone_upgrades.is_empty() {
                                detail["keystone_upgrades"] = json!(keystone_upgrades);
                            }
                            if !encounter_names.is_empty() {
                                detail["encounters"] = json!(encounter_names.clone());
                                detail["num_bosses"] = json!(encounter_names.len() as i64);
                            }
                            if let Some(href) = blizzard_href {
                                detail["blizzard_href"] = json!(href);
                            }

                            let mut media_asset_url = media_url_from_entity_payload(&detail_data);
                            if media_asset_url.is_none() {
                                if let Some(media_href) = detail_data
                                    .get("media")
                                    .and_then(|m| m.get("key"))
                                    .and_then(|k| k.get("href"))
                                    .and_then(|h| h.as_str())
                                {
                                    media_asset_url = media_url_from_media_href(
                                        &blizzard.client,
                                        &token,
                                        media_href,
                                    )
                                    .await;
                                }
                            }
                            if media_asset_url.is_none() {
                                if let Some(journal_id) = detail_data
                                    .get("journal_instance")
                                    .and_then(|v| v.get("id"))
                                    .and_then(|v| v.as_u64())
                                {
                                    media_asset_url =
                                        fetch_blizzard_journal_instance_image_url_with_token(
                                            &blizzard.client,
                                            &token,
                                            &[journal_id],
                                        )
                                        .await;
                                }
                            }
                            if let Some(url) = media_asset_url {
                                detail["image_url"] = json!(url);
                            }

                            // Keep full raw payload so the UI can render all available Blizzard fields.
                            detail["blizzard_api_data"] = detail_data;

                            dungeon_details.push(detail);
                        }
                    }

                    rotation_dungeons.push(dungeon_id);
                }

                tokio::time::sleep(tokio::time::Duration::from_millis(150)).await;
            }
        }

        if let Some(dir) = &data_dir {
            let runtime_file = dir.join("blizzard-runtime-data.json");
            let runtime_data = json!({
                "current_season_id": current_season_id,
                "season_name": season_name,
                "season_api_data": season_data,
                "mplus_rotation": rotation_dungeons,
                "dungeon_details": dungeon_details,
                "last_sync": chrono::Utc::now().to_rfc3339(),
            });
            std::fs::write(
                &runtime_file,
                serde_json::to_string_pretty(&runtime_data).unwrap(),
            )
            .ok();
        }
    }

    // Always Load/Reload data into memory at the end
    if let Some(dir) = &data_dir {
        crate::item_db::load(dir);
        let runtime_file = dir.join("blizzard-runtime-data.json");
        if runtime_file.exists() {
            crate::item_db::hydrate_runtime_metadata(&runtime_file);
        }
    }

    {
        let mut p = state.progress.lock().await;
        *p = if skip_raidbots && skip_blizzard {
            "Done:1:1:Sync complete (cached)".to_string()
        } else {
            "Done:1:1:Sync complete".to_string()
        };
    }

    Ok(())
}

async fn perform_dungeon_sync(
    state: Arc<DataSyncState>,
    blizzard: Arc<BlizzardState>,
    client_id: String,
    client_secret: String,
    data_dir: Option<PathBuf>,
    force_refresh: bool,
) -> Result<(), String> {
    let _operation = state.operation_lock.lock().await;
    {
        let mut p = state.progress.lock().await;
        *p = "Dungeons:0:1:Checking Blizzard dungeon cache...".to_string();
    }

    let mut skip_blizzard = false;
    if !force_refresh {
        if let Some(ref dir) = data_dir {
            let runtime_file = dir.join("blizzard-runtime-data.json");
            if runtime_file.exists() {
                if let Ok(content) = std::fs::read_to_string(&runtime_file) {
                    if let Ok(v) = serde_json::from_str::<Value>(&content) {
                        if let Some(last_sync_str) = v.get("last_sync").and_then(|ls| ls.as_str()) {
                            if let Ok(last_sync) =
                                chrono::DateTime::parse_from_rfc3339(last_sync_str)
                            {
                                let now = chrono::Utc::now();
                                if now.signed_duration_since(last_sync).num_hours() < 24 {
                                    skip_blizzard = true;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if !skip_blizzard {
        let season_index_url = "https://us.api.blizzard.com/data/wow/mythic-keystone/season/index?namespace=dynamic-us&locale=en_US";
        let token =
            BlizzardState::get_token_with_creds(&blizzard.client, &client_id, &client_secret)
                .await
                .ok_or("Failed to authenticate with Blizzard")?;
        let res = blizzard
            .client
            .get(season_index_url)
            .bearer_auth(&token)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let season_index: Value = res.json().await.map_err(|e| e.to_string())?;

        let current_season_id = season_index
            .get("current_season")
            .and_then(|s| s.get("id"))
            .and_then(|id| id.as_i64())
            .ok_or("Could not find current season ID")?;

        {
            let mut p = state.progress.lock().await;
            *p = format!("Fetching details for Season {}...", current_season_id);
        }

        let season_url = format!(
            "https://us.api.blizzard.com/data/wow/mythic-keystone/season/{}?namespace=dynamic-us&locale=en_US",
            current_season_id
        );
        let res = blizzard
            .client
            .get(&season_url)
            .bearer_auth(&token)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let season_data: Value = res.json().await.map_err(|e| e.to_string())?;

        let mut rotation_dungeons = Vec::new();
        let mut dungeon_details: Vec<Value> = Vec::new();
        let dungeons = season_data.get("dungeons").and_then(|d| d.as_array());
        let dungeon_count = dungeons.map(|d| d.len()).unwrap_or(0);

        let localized_str = |v: Option<&Value>| -> Option<String> {
            let value = v?;
            if let Some(s) = value.as_str() {
                return Some(s.to_string());
            }
            if let Some(obj) = value.as_object() {
                if let Some(en) = obj.get("en_US").and_then(|x| x.as_str()) {
                    return Some(en.to_string());
                }
                if let Some(any) = obj.values().find_map(|x| x.as_str()) {
                    return Some(any.to_string());
                }
            }
            None
        };

        let season_name = localized_str(season_data.get("name"))
            .unwrap_or_else(|| format!("Season {}", current_season_id));

        if let Some(dungeons) = dungeons {
            for (i, dungeon) in dungeons.iter().enumerate() {
                let name = localized_str(dungeon.get("name"))
                    .or_else(|| localized_str(dungeon.get("short_name")))
                    .unwrap_or_else(|| "Unknown Dungeon".to_string());
                let id = dungeon.get("id").and_then(|v| v.as_i64());
                let href = dungeon
                    .get("key")
                    .and_then(|k| k.get("href"))
                    .and_then(|h| h.as_str());
                let href_id = href
                    .and_then(|h| h.split("/mythic-keystone/dungeon/").nth(1))
                    .and_then(|tail| tail.split('?').next())
                    .and_then(|id_str| id_str.parse::<i64>().ok());
                let dungeon_id = id.or(href_id);

                {
                    let mut p = state.progress.lock().await;
                    *p = format!("Dungeons:{}:{}:{}", i + 1, dungeon_count, name);
                }

                if let Some(dungeon_id) = dungeon_id {
                    let dungeon_url = if let Some(h) = href {
                        if h.contains("locale=") {
                            h.to_string()
                        } else if h.contains('?') {
                            format!("{h}&locale=en_US")
                        } else {
                            format!("{h}?locale=en_US")
                        }
                    } else {
                        format!(
                            "https://us.api.blizzard.com/data/wow/mythic-keystone/dungeon/{}?namespace=dynamic-us&locale=en_US",
                            dungeon_id
                        )
                    };

                    if let Ok(res) = blizzard
                        .client
                        .get(&dungeon_url)
                        .bearer_auth(&token)
                        .send()
                        .await
                    {
                        let json_result = res.json::<Value>().await.ok();
                        if let Some(detail_data) = json_result {
                            let description = detail_data
                                .get("description")
                                .and_then(|d| d.as_str())
                                .map(|s| s.to_string())
                                .or_else(|| localized_str(detail_data.get("description")));
                            let zone = detail_data
                                .get("location")
                                .and_then(|l| l.get("name"))
                                .and_then(|n| localized_str(Some(n)))
                                .or_else(|| {
                                    detail_data
                                        .get("instance_map")
                                        .and_then(|m| m.get("name"))
                                        .and_then(|n| localized_str(Some(n)))
                                });
                            let slug = detail_data
                                .get("slug")
                                .and_then(|s| s.as_str())
                                .map(|s| s.to_string());
                            let short_name = detail_data
                                .get("short_name")
                                .and_then(|s| s.as_str())
                                .map(|s| s.to_string());
                            let expansion_id = detail_data
                                .get("expansion")
                                .and_then(|e| e.get("id"))
                                .and_then(|v| v.as_i64());
                            let expansion_name = detail_data
                                .get("expansion")
                                .and_then(|e| e.get("name"))
                                .and_then(|n| localized_str(Some(n)));
                            let map_id = detail_data
                                .get("instance_map")
                                .and_then(|m| m.get("id"))
                                .and_then(|v| v.as_i64());
                            let challenge_mode_id = detail_data
                                .get("challenge_mode")
                                .and_then(|cm| cm.get("id"))
                                .and_then(|v| v.as_i64());
                            let minimum_level =
                                detail_data.get("minimum_level").and_then(|v| v.as_i64());
                            let keystone_timer_ms = detail_data
                                .get("keystone_timer_ms")
                                .and_then(|v| v.as_i64())
                                .or_else(|| detail_data.get("timer_ms").and_then(|v| v.as_i64()));
                            let keystone_upgrades: Vec<i64> = detail_data
                                .get("keystone_upgrades")
                                .and_then(|a| a.as_array())
                                .map(|arr| arr.iter().filter_map(|v| v.as_i64()).collect())
                                .unwrap_or_default();
                            let encounter_names: Vec<String> = detail_data
                                .get("encounters")
                                .and_then(|a| a.as_array())
                                .map(|arr| {
                                    arr.iter()
                                        .filter_map(|enc| {
                                            enc.get("name").and_then(|n| localized_str(Some(n)))
                                        })
                                        .collect()
                                })
                                .unwrap_or_default();
                            let blizzard_href = detail_data
                                .get("key")
                                .and_then(|k| k.get("href"))
                                .and_then(|h| h.as_str())
                                .map(|s| s.to_string());

                            let mut detail = json!({"id": dungeon_id, "name": name});

                            if let Some(desc) = description {
                                detail["description"] = json!(desc);
                            }
                            if let Some(z) = zone {
                                detail["zone"] = json!(z);
                            }
                            if let Some(s) = slug {
                                detail["slug"] = json!(s);
                            }
                            if let Some(s) = short_name {
                                detail["short_name"] = json!(s);
                            }
                            if let Some(exp) = expansion_id {
                                detail["expansion"] = json!(exp);
                            }
                            if let Some(exp_name) = expansion_name {
                                detail["expansion_name"] = json!(exp_name);
                            }
                            if let Some(mid) = map_id {
                                detail["map_id"] = json!(mid);
                            }
                            if let Some(cmid) = challenge_mode_id {
                                detail["challenge_mode_id"] = json!(cmid);
                            }
                            if let Some(level) = minimum_level {
                                detail["minimum_level"] = json!(level);
                            }
                            if let Some(timer) = keystone_timer_ms {
                                detail["keystone_timer_ms"] = json!(timer);
                            }
                            if !keystone_upgrades.is_empty() {
                                detail["keystone_upgrades"] = json!(keystone_upgrades);
                            }
                            if !encounter_names.is_empty() {
                                detail["encounters"] = json!(encounter_names.clone());
                                detail["num_bosses"] = json!(encounter_names.len() as i64);
                            }
                            if let Some(href) = blizzard_href {
                                detail["blizzard_href"] = json!(href);
                            }

                            let mut media_asset_url = media_url_from_entity_payload(&detail_data);
                            if media_asset_url.is_none() {
                                if let Some(media_href) = detail_data
                                    .get("media")
                                    .and_then(|m| m.get("key"))
                                    .and_then(|k| k.get("href"))
                                    .and_then(|h| h.as_str())
                                {
                                    media_asset_url = media_url_from_media_href(
                                        &blizzard.client,
                                        &token,
                                        media_href,
                                    )
                                    .await;
                                }
                            }
                            if media_asset_url.is_none() {
                                if let Some(journal_id) = detail_data
                                    .get("journal_instance")
                                    .and_then(|v| v.get("id"))
                                    .and_then(|v| v.as_u64())
                                {
                                    media_asset_url =
                                        fetch_blizzard_journal_instance_image_url_with_token(
                                            &blizzard.client,
                                            &token,
                                            &[journal_id],
                                        )
                                        .await;
                                }
                            }
                            if let Some(url) = media_asset_url {
                                detail["image_url"] = json!(url);
                            }

                            detail["blizzard_api_data"] = detail_data;
                            dungeon_details.push(detail);
                        }
                    }

                    rotation_dungeons.push(dungeon_id);
                }

                tokio::time::sleep(tokio::time::Duration::from_millis(150)).await;
            }
        }

        if let Some(dir) = &data_dir {
            let runtime_file = dir.join("blizzard-runtime-data.json");
            let runtime_data = json!({
                "current_season_id": current_season_id,
                "season_name": season_name,
                "season_api_data": season_data,
                "mplus_rotation": rotation_dungeons,
                "dungeon_details": dungeon_details,
                "last_sync": chrono::Utc::now().to_rfc3339(),
            });
            std::fs::write(
                &runtime_file,
                serde_json::to_string_pretty(&runtime_data).unwrap(),
            )
            .ok();
        }
    }

    if let Some(dir) = &data_dir {
        crate::item_db::load(dir);
        let runtime_file = dir.join("blizzard-runtime-data.json");
        if runtime_file.exists() {
            crate::item_db::hydrate_runtime_metadata(&runtime_file);
        }
    }

    {
        let mut p = state.progress.lock().await;
        *p = if skip_blizzard {
            "Done:1:1:Dungeon data already fresh (cached)".to_string()
        } else {
            "Done:1:1:Dungeon data refreshed".to_string()
        };
    }

    Ok(())
}
