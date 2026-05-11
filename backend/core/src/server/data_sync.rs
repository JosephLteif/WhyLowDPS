use actix_web::{web, HttpResponse};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io;
use std::path::Path;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;

use crate::server::auth_handlers::{verify_jwt, BlizzardAuthState};
use crate::server::blizzard::BlizzardState;
use crate::server::wow_data_map;
use crate::storage::JobStorage;

const IMAGE_CACHE_VERSION: &str = "bapi3";
const EMBEDDED_DATA_MANIFEST: &str =
    include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../resources/data-manifest.json"));

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SyncStatus {
    Ready,
    Syncing,
    NeedsCredentials,
    Error(String),
}

pub struct DataSyncState {
    pub status: Mutex<SyncStatus>,
    pub progress: Mutex<String>,
}

#[derive(Debug, Deserialize)]
pub struct SyncQuery {
    pub force: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DataFileState {
    pub key: String,
    pub label: String,
    pub section: String,
    pub relative_path: String,
    pub required: bool,
    pub downloadable: bool,
    pub exists: bool,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct DataFilePreviewResponse {
    pub key: String,
    pub label: String,
    pub relative_path: String,
    pub content: String,
    pub truncated: bool,
}

#[derive(Debug, Deserialize)]
pub struct DataImageQuery {
    pub source: Option<String>,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum DataFileSource {
    Raidbots,
    Blizzard,
    Local,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
enum DataFileEntryType {
    #[default]
    File,
    Directory,
}

#[derive(Debug, Clone, Deserialize)]
struct DataManifest {
    files: Vec<DataManifestEntry>,
}

#[derive(Debug, Clone, Deserialize)]
struct DataManifestEntry {
    key: String,
    label: String,
    section: String,
    source: DataFileSource,
    remote_path: Option<String>,
    local_path: String,
    required: bool,
    #[serde(default)]
    entry_type: DataFileEntryType,
    bundled_path: Option<String>,
}

#[derive(Clone)]
struct DataFileEntry {
    key: String,
    label: String,
    section: String,
    source: DataFileSource,
    remote_path: Option<String>,
    local_path: String,
    required: bool,
    entry_type: DataFileEntryType,
    bundled_path: Option<String>,
}

impl From<DataManifestEntry> for DataFileEntry {
    fn from(value: DataManifestEntry) -> Self {
        Self {
            key: value.key,
            label: value.label,
            section: value.section,
            source: value.source,
            remote_path: value.remote_path,
            local_path: value.local_path,
            required: value.required,
            entry_type: value.entry_type,
            bundled_path: value.bundled_path,
        }
    }
}

fn data_manifest_path() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("resources")
        .join("data-manifest.json")
}

fn data_file_catalog() -> Result<Vec<DataFileEntry>, String> {
    let manifest_path = data_manifest_path();
    let content = match std::fs::read_to_string(&manifest_path) {
        Ok(content) => content,
        Err(err) => {
            // Release bundles don't have the source checkout path; use embedded manifest fallback.
            eprintln!(
                "Failed to read data manifest at {}: {}. Falling back to embedded manifest.",
                manifest_path.display(),
                err
            );
            EMBEDDED_DATA_MANIFEST.to_string()
        }
    };
    let parsed: DataManifest = serde_json::from_str(&content).map_err(|err| {
        format!(
            "Failed to parse data manifest at {}: {}",
            manifest_path.display(),
            err
        )
    })?;
    Ok(parsed.files.into_iter().map(DataFileEntry::from).collect())
}

fn resolve_catalog_path(root: &Path, entry: &DataFileEntry) -> PathBuf {
    let runtime = root.join(&entry.local_path);
    for candidate in path_variants_with_json_alias(&runtime) {
        if candidate.exists() {
            return candidate;
        }
    }

    if let Some(bundled_path) = &entry.bundled_path {
        let dev_bundled = Path::new(env!("CARGO_MANIFEST_DIR")).join(bundled_path);
        for candidate in path_variants_with_json_alias(&dev_bundled) {
            if candidate.exists() {
                return candidate;
            }
        }

        if let Some(exe_dir) = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        {
            if let Some(file_name) = Path::new(bundled_path).file_name() {
                let exe_bundled = exe_dir.join("resources").join(file_name);
                for candidate in path_variants_with_json_alias(&exe_bundled) {
                    if candidate.exists() {
                        return candidate;
                    }
                }
            }
        }
    }

    runtime
}

fn path_variants_with_json_alias(path: &Path) -> Vec<PathBuf> {
    let mut out = vec![path.to_path_buf()];
    match path.extension().and_then(|ext| ext.to_str()) {
        Some("json") => {
            out.push(path.with_extension(""));
        }
        None => {
            out.push(path.with_extension("json"));
        }
        _ => {}
    }
    out
}

impl DataSyncState {
    pub fn new() -> Self {
        Self {
            status: Mutex::new(SyncStatus::Ready),
            progress: Mutex::new(String::new()),
        }
    }
}

fn get_background_credentials(
    auth_state: &BlizzardAuthState,
    store: &dyn JobStorage,
) -> Option<(String, String)> {
    if let (Some(id), Some(sec)) = (
        store.get_user_config("system", "blizzard_client_id"),
        store.get_user_config("system", "blizzard_client_secret"),
    ) {
        return Some((id, sec));
    }

    if let (Some(id), Some(sec)) = (&auth_state.client_id, &auth_state.client_secret) {
        return Some((id.clone(), sec.clone()));
    }

    None
}

fn is_background_sync_due(data_dir: Option<&Path>, threshold_hours: i64) -> bool {
    let Some(dir) = data_dir else {
        return true;
    };
    let runtime_file = dir.join("blizzard-runtime-data.json");
    let content = match std::fs::read_to_string(runtime_file) {
        Ok(content) => content,
        Err(_) => return true,
    };
    let parsed: Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => return true,
    };
    let last_sync_str = match parsed.get("last_sync").and_then(|v| v.as_str()) {
        Some(s) => s,
        None => return true,
    };
    let last_sync = match chrono::DateTime::parse_from_rfc3339(last_sync_str) {
        Ok(ts) => ts.with_timezone(&chrono::Utc),
        Err(_) => return true,
    };
    chrono::Utc::now().signed_duration_since(last_sync).num_hours() >= threshold_hours
}

pub fn spawn_background_sync_loop(
    state: Arc<DataSyncState>,
    auth_state: Arc<BlizzardAuthState>,
    blizzard: Arc<BlizzardState>,
    store: Arc<dyn JobStorage>,
    data_dir: Option<PathBuf>,
) {
    tokio::spawn(async move {
        let poll_duration = tokio::time::Duration::from_secs(10 * 60);
        let stale_threshold_hours = 6;

        loop {
            let due = is_background_sync_due(data_dir.as_deref(), stale_threshold_hours);
            let already_syncing = {
                let status = state.status.lock().await;
                *status == SyncStatus::Syncing
            };

            if due && !already_syncing {
                if let Some((client_id, client_secret)) =
                    get_background_credentials(auth_state.as_ref(), &*store)
                {
                    {
                        let mut status = state.status.lock().await;
                        *status = SyncStatus::Syncing;
                    }
                    {
                        let mut progress = state.progress.lock().await;
                        *progress = "Auto:0:1:Scheduled background data sync...".to_string();
                    }

                    let result = perform_sync(
                        state.clone(),
                        blizzard.clone(),
                        client_id,
                        client_secret,
                        data_dir.clone(),
                        false,
                    )
                    .await;

                    let mut status = state.status.lock().await;
                    *status = match result {
                        Ok(_) => SyncStatus::Ready,
                        Err(err) => SyncStatus::Error(err),
                    };
                }
            }

            tokio::time::sleep(poll_duration).await;
        }
    });
}

pub async fn get_data_file_states(data_dir: web::Data<Option<PathBuf>>) -> HttpResponse {
    let catalog = match data_file_catalog() {
        Ok(entries) => entries,
        Err(err) => {
            return HttpResponse::InternalServerError().json(json!({
                "detail": err,
            }));
        }
    };

    let Some(root) = data_dir.get_ref().clone() else {
        let empty_files: Vec<DataFileState> = Vec::new();
        return HttpResponse::Ok().json(json!({
            "base_path": null,
            "available": false,
            "files": empty_files,
        }));
    };

    let files: Vec<DataFileState> = catalog
        .iter()
        .map(|entry| {
            let metadata = std::fs::metadata(resolve_catalog_path(&root, entry)).ok();
            let is_dir = entry.entry_type == DataFileEntryType::Directory
                || metadata.as_ref().map(|m| m.is_dir()).unwrap_or(false);
            let size_bytes = if is_dir {
                0
            } else {
                metadata.as_ref().map(|m| m.len()).unwrap_or(0)
            };
            DataFileState {
                key: entry.key.clone(),
                label: entry.label.clone(),
                section: entry.section.clone(),
                relative_path: entry.local_path.clone(),
                required: entry.required,
                downloadable: entry.source == DataFileSource::Raidbots
                    && entry.remote_path.is_some()
                    && entry.entry_type == DataFileEntryType::File,
                exists: metadata.is_some(),
                size_bytes,
            }
        })
        .collect();

    HttpResponse::Ok().json(json!({
        "base_path": root,
        "available": true,
        "files": files,
    }))
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

fn is_previewable_file(relative_path: &str) -> bool {
    matches!(
        Path::new(relative_path)
            .extension()
            .and_then(|ext| ext.to_str()),
        Some("json" | "txt" | "lua" | "csv" | "xml" | "tsv")
    )
}

fn is_http_url(url: &str) -> bool {
    let lowered = url.to_ascii_lowercase();
    lowered.starts_with("https://") || lowered.starts_with("http://")
}

fn is_allowed_remote_image_url(url: &str) -> bool {
    let Ok(parsed) = reqwest::Url::parse(url) else {
        return false;
    };
    let Some(host) = parsed.host_str() else {
        return false;
    };
    let host = host.to_ascii_lowercase();
    host == "blizzard.com"
        || host.ends_with(".blizzard.com")
        || host == "battle.net"
        || host.ends_with(".battle.net")
        || host == "worldofwarcraft.com"
        || host.ends_with(".worldofwarcraft.com")
}

fn find_cached_image_file(images_dir: &Path, image_type: &str, id: u64) -> Option<PathBuf> {
    let candidates = [
        format!("{}-{}-{}.jpg", image_type, id, IMAGE_CACHE_VERSION),
        format!("{}-{}-{}.jpeg", image_type, id, IMAGE_CACHE_VERSION),
        format!("{}-{}-{}.png", image_type, id, IMAGE_CACHE_VERSION),
        format!("{}-{}-{}.webp", image_type, id, IMAGE_CACHE_VERSION),
        format!("{}-{}-{}.gif", image_type, id, IMAGE_CACHE_VERSION),
    ];

    for candidate in candidates {
        let path = images_dir.join(candidate);
        if path.exists() {
            return Some(path);
        }
    }

    None
}

fn find_runtime_image_url(image_type: &str, id: u64) -> Option<String> {
    let runtime = crate::item_db::get_runtime_data();
    if let Some(details) = runtime.get("dungeon_details").and_then(|v| v.as_array()) {
        for detail in details {
            if image_type == "instance" && detail.get("id").and_then(|v| v.as_u64()) == Some(id) {
                if let Some(url) = detail
                    .get("image_url")
                    .and_then(|v| v.as_str())
                    .filter(|url| is_http_url(url))
                {
                    return Some(url.to_string());
                }
            }
            if image_type == "encounter" {
                let Some(raw_payload) = detail.get("blizzard_api_data") else {
                    continue;
                };
                if let Some(encounters) = raw_payload.get("encounters").and_then(|v| v.as_array()) {
                    for encounter in encounters {
                        if encounter.get("id").and_then(|v| v.as_u64()) == Some(id) {
                            if let Some(url) = encounter
                                .get("image_url")
                                .and_then(|v| v.as_str())
                                .filter(|url| is_http_url(url))
                            {
                                return Some(url.to_string());
                            }
                        }
                    }
                }
            }
        }
    }

    None
}

fn infer_image_extension(url: &str) -> &'static str {
    let Ok(parsed) = reqwest::Url::parse(url) else {
        return "jpg";
    };
    let path = parsed.path().to_ascii_lowercase();
    if path.ends_with(".png") {
        return "png";
    }
    if path.ends_with(".webp") {
        return "webp";
    }
    if path.ends_with(".gif") {
        return "gif";
    }
    if path.ends_with(".jpeg") {
        return "jpeg";
    }
    "jpg"
}

fn content_type_for_extension(ext: &str) -> &'static str {
    match ext {
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "jpeg" | "jpg" => "image/jpeg",
        _ => "application/octet-stream",
    }
}

fn image_error_response(status: actix_web::http::StatusCode, reason: &str) -> HttpResponse {
    HttpResponse::build(status).json(json!({
        "detail": format!("Image unavailable: {}", reason),
        "reason": reason,
    }))
}

fn journal_instance_candidates(instance_id: u64) -> Vec<u64> {
    let mut candidates = vec![instance_id];
    let runtime = crate::item_db::get_runtime_data();
    let Some(details) = runtime.get("dungeon_details").and_then(|v| v.as_array()) else {
        return candidates;
    };

    for detail in details {
        if detail.get("id").and_then(|v| v.as_u64()) != Some(instance_id) {
            continue;
        }
        if let Some(map_id) = detail.get("map_id").and_then(|v| v.as_u64()) {
            candidates.push(map_id);
        }
        if let Some(cm_id) = detail.get("challenge_mode_id").and_then(|v| v.as_u64()) {
            candidates.push(cm_id);
        }
        if let Some(href) = detail.get("blizzard_href").and_then(|v| v.as_str()) {
            if let Some(parsed) = href
                .split("/journal-instance/")
                .nth(1)
                .and_then(|tail| tail.split('?').next())
                .and_then(|raw| raw.parse::<u64>().ok())
            {
                candidates.push(parsed);
            }
        }
        if let Some(raw) = detail.get("blizzard_api_data") {
            if let Some(key_href) = raw
                .get("key")
                .and_then(|k| k.get("href"))
                .and_then(|h| h.as_str())
            {
                if let Some(parsed) = key_href
                    .split("/journal-instance/")
                    .nth(1)
                    .and_then(|tail| tail.split('?').next())
                    .and_then(|raw| raw.parse::<u64>().ok())
                {
                    candidates.push(parsed);
                }
            }
            if let Some(map_id) = raw
                .get("instance_map")
                .and_then(|m| m.get("id"))
                .and_then(|v| v.as_u64())
            {
                candidates.push(map_id);
            }
        }
    }

    candidates.sort_unstable();
    candidates.dedup();
    candidates
}

#[derive(Clone)]
struct JournalIndexCache {
    fetched_at: chrono::DateTime<chrono::Utc>,
    entries: Vec<(u64, String)>,
}

static JOURNAL_INDEX_CACHE: Lazy<Mutex<Option<JournalIndexCache>>> = Lazy::new(|| Mutex::new(None));

fn localized_str(value: Option<&Value>) -> Option<String> {
    let value = value?;
    if let Some(raw) = value.as_str() {
        return Some(raw.to_string());
    }
    if let Some(obj) = value.as_object() {
        if let Some(en) = obj.get("en_US").and_then(|v| v.as_str()) {
            return Some(en.to_string());
        }
        if let Some(any) = obj.values().find_map(|v| v.as_str()) {
            return Some(any.to_string());
        }
    }
    None
}

fn normalize_lookup_key(input: &str) -> String {
    input
        .to_ascii_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect()
}

fn runtime_dungeon_name_candidates(instance_id: u64) -> Vec<String> {
    let mut names = Vec::new();

    // Prefer stable local instance metadata first so lookup still works even when
    // blizzard-runtime-data.json has sparse/empty dungeon_details.
    for instance in crate::item_db::instances() {
        if instance.get("id").and_then(|v| v.as_u64()) != Some(instance_id) {
            continue;
        }
        if let Some(name) = instance.get("name").and_then(|v| v.as_str()) {
            names.push(name.to_string());
        }
        if let Some(short_name) = instance.get("short_name").and_then(|v| v.as_str()) {
            names.push(short_name.to_string());
        }
    }

    let runtime = crate::item_db::get_runtime_data();
    if let Some(details) = runtime.get("dungeon_details").and_then(|v| v.as_array()) {
        for detail in details {
            if detail.get("id").and_then(|v| v.as_u64()) != Some(instance_id) {
                continue;
            }
            if let Some(name) = detail.get("name").and_then(|v| v.as_str()) {
                names.push(name.to_string());
            }
            if let Some(short_name) = detail.get("short_name").and_then(|v| v.as_str()) {
                names.push(short_name.to_string());
            }
            if let Some(raw) = detail.get("blizzard_api_data") {
                if let Some(name) = localized_str(raw.get("name")) {
                    names.push(name);
                }
                if let Some(short_name) = localized_str(raw.get("short_name")) {
                    names.push(short_name);
                }
            }
        }
    }

    names.sort_unstable();
    names.dedup();
    names
}

async fn journal_index_entries_with_token(
    client: &reqwest::Client,
    token: &str,
) -> Vec<(u64, String)> {
    {
        let cache = JOURNAL_INDEX_CACHE.lock().await;
        if let Some(cached) = cache.as_ref() {
            let age = chrono::Utc::now().signed_duration_since(cached.fetched_at);
            if age.num_hours() < 6 {
                return cached.entries.clone();
            }
        }
    }

    let index_url = "https://us.api.blizzard.com/data/wow/journal-instance/index?namespace=static-us&locale=en_US";
    let response = match client.get(index_url).bearer_auth(token).send().await {
        Ok(res) => res,
        Err(_) => return Vec::new(),
    };
    if !response.status().is_success() {
        return Vec::new();
    }
    let payload: Value = match response.json().await {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };

    let mut entries = Vec::new();
    if let Some(instances) = payload.get("instances").and_then(|v| v.as_array()) {
        for item in instances {
            let Some(id) = item.get("id").and_then(|v| v.as_u64()) else {
                continue;
            };
            let Some(name) = localized_str(item.get("name")) else {
                continue;
            };
            entries.push((id, name));
        }
    }

    let mut cache = JOURNAL_INDEX_CACHE.lock().await;
    *cache = Some(JournalIndexCache {
        fetched_at: chrono::Utc::now(),
        entries: entries.clone(),
    });

    entries
}

async fn journal_instance_id_from_names_with_token(
    client: &reqwest::Client,
    token: &str,
    names: &[String],
) -> Option<u64> {
    if names.is_empty() {
        return None;
    }
    let entries = journal_index_entries_with_token(client, token).await;
    if entries.is_empty() {
        return None;
    }

    let normalized_names: Vec<String> = names
        .iter()
        .map(|name| normalize_lookup_key(name))
        .filter(|v| !v.is_empty())
        .collect();

    for target in &normalized_names {
        if let Some((id, _)) = entries
            .iter()
            .find(|(_, name)| normalize_lookup_key(name) == *target)
        {
            return Some(*id);
        }
    }

    for target in &normalized_names {
        if let Some((id, _)) = entries.iter().find(|(_, name)| {
            let candidate = normalize_lookup_key(name);
            candidate.contains(target) || target.contains(&candidate)
        }) {
            return Some(*id);
        }
    }

    None
}

fn best_blizzard_asset_url(media_json: &Value) -> Option<String> {
    let assets = media_json.get("assets").and_then(|v| v.as_array())?;
    let preferred_keys = ["tile", "splash", "header", "main", "icon", "image"];
    for key in preferred_keys {
        if let Some(url) = assets.iter().find_map(|asset| {
            let matches_key = asset
                .get("key")
                .and_then(|v| v.as_str())
                .map(|k| k.eq_ignore_ascii_case(key))
                .unwrap_or(false);
            if !matches_key {
                return None;
            }
            asset.get("value").and_then(|v| v.as_str()).map(str::to_string)
        }) {
            return Some(url);
        }
    }
    assets
        .iter()
        .find_map(|asset| asset.get("value").and_then(|v| v.as_str()).map(str::to_string))
}

fn media_url_from_entity_payload(entity_json: &Value) -> Option<String> {
    if let Some(url) = entity_json
        .get("media")
        .and_then(best_blizzard_asset_url)
        .filter(|url| is_allowed_remote_image_url(url))
    {
        return Some(url);
    }
    None
}

async fn media_url_from_media_href(
    client: &reqwest::Client,
    token: &str,
    media_href: &str,
) -> Option<String> {
    let media_url = if media_href.contains("locale=") {
        media_href.to_string()
    } else if media_href.contains('?') {
        format!("{media_href}&locale=en_US")
    } else {
        format!("{media_href}?locale=en_US")
    };

    println!("[image-api] GET Blizzard media href: {}", media_url);
    let media_res = client
        .get(&media_url)
        .bearer_auth(token)
        .send()
        .await
        .ok()?;
    println!(
        "[image-api] Blizzard media href status: {} ({})",
        media_res.status(),
        media_url
    );
    if !media_res.status().is_success() {
        return None;
    }
    let media_json: Value = media_res.json().await.ok()?;
    let selected = best_blizzard_asset_url(&media_json)
        .filter(|url| is_allowed_remote_image_url(url));
    if let Some(url) = &selected {
        println!("[image-api] Selected Blizzard media asset: {}", url);
    } else {
        println!("[image-api] No allowed Blizzard media asset in payload");
    }
    selected
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
        if let Some(url) = media_url_from_media_href(client, &token, media_href).await {
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
        if let Some(url) = best_blizzard_asset_url(&media_json)
            .filter(|url| is_allowed_remote_image_url(url))
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
        let instance_res = match client
            .get(&instance_url)
            .bearer_auth(token)
            .send()
            .await
        {
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

pub async fn get_data_file_content(
    path: web::Path<String>,
    data_dir: web::Data<Option<PathBuf>>,
) -> HttpResponse {
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

    if entry.entry_type == DataFileEntryType::Directory {
        return HttpResponse::BadRequest()
            .json(json!({"detail": "Directories do not have file content"}));
    }

    if !is_previewable_file(&entry.local_path) {
        return HttpResponse::BadRequest()
            .json(json!({"detail": "This file type is not previewable"}));
    }

    let path = resolve_catalog_path(&root, entry);

    let metadata = match std::fs::metadata(&path) {
        Ok(metadata) => metadata,
        Err(_) => return HttpResponse::NotFound().json(json!({"detail": "File not found"})),
    };

    if metadata.is_dir() {
        return HttpResponse::BadRequest()
            .json(json!({"detail": "Directories do not have file content"}));
    }

    let content = match std::fs::read_to_string(&path) {
        Ok(content) => content,
        Err(err) => {
            return HttpResponse::InternalServerError()
                .json(json!({"detail": format!("Failed to read file: {}", err)}));
        }
    };
    let no_truncate_keys = ["runtime_wowhead_zones_index"];
    let should_truncate = !no_truncate_keys.contains(&entry.key.as_str());
    let max_preview_len = 250_000usize;
    let truncated = should_truncate && content.len() > max_preview_len;
    let preview = if truncated {
        content.chars().take(max_preview_len).collect::<String>()
    } else {
        content
    };

    HttpResponse::Ok().json(DataFilePreviewResponse {
        key: entry.key.clone(),
        label: entry.label.clone(),
        relative_path: entry.local_path.clone(),
        content: preview,
        truncated,
    })
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
        image_type,
        id_raw,
        query.source
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
            source_url = fetch_blizzard_mythic_dungeon_image_url_with_token(
                &blizzard.client,
                &claims.access_token,
                id,
                &name_candidates,
            )
            .await;
            if source_url.is_none() {
                source_url = fetch_blizzard_journal_instance_image_url_with_token(
                    &blizzard.client,
                    &claims.access_token,
                    &candidate_ids,
                )
                .await;
            }
        }
    }
    if source_url.is_none() {
        source_url = find_runtime_image_url(&image_type, id).filter(|url| is_allowed_remote_image_url(url));
        if let Some(url) = &source_url {
            println!("[image-api] Using runtime source URL: {}", url);
        }
    }

    let Some(source_url) = source_url else {
        println!("[image-api] No source URL resolved type={} id={}", image_type, id);
        return image_error_response(actix_web::http::StatusCode::NOT_FOUND, "no_source");
    };
    if !is_allowed_remote_image_url(&source_url) {
        println!(
            "[image-api] Rejected source host type={} id={} url={}",
            image_type, id, source_url
        );
        return image_error_response(
            actix_web::http::StatusCode::BAD_REQUEST,
            "unsupported_host",
        );
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
            return image_error_response(
                actix_web::http::StatusCode::BAD_GATEWAY,
                "fetch_error",
            );
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
        return image_error_response(
            actix_web::http::StatusCode::BAD_GATEWAY,
            "remote_status",
        );
    }
    let bytes = match response.bytes().await {
        Ok(bytes) => bytes,
        Err(err) => {
            let _ = err;
            return image_error_response(
                actix_web::http::StatusCode::BAD_GATEWAY,
                "read_error",
            );
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

pub async fn get_wow_data_map(data_dir: web::Data<Option<PathBuf>>) -> HttpResponse {
    let use_wow_data_map = std::env::var("USE_WOW_DATA_MAP")
        .ok()
        .map(|v| v.eq_ignore_ascii_case("1") || v.eq_ignore_ascii_case("true"))
        .unwrap_or(cfg!(debug_assertions));

    if !use_wow_data_map {
        return HttpResponse::NotFound().json(json!({
            "detail": "wow-data-map endpoint disabled by feature flag"
        }));
    }

    let Some(root) = data_dir.get_ref().clone() else {
        return HttpResponse::BadRequest().json(json!({"detail": "Data directory is unavailable"}));
    };

    match wow_data_map::load_wow_data_map(&root) {
        Ok(v) => HttpResponse::Ok().json(v),
        Err(err) => HttpResponse::NotFound().json(json!({
            "detail": err,
            "hint": "Run data sync to generate wow-data-map.json"
        })),
    }
}

pub async fn get_wowhead_zones_index(data_dir: web::Data<Option<PathBuf>>) -> HttpResponse {
    let Some(root) = data_dir.get_ref().clone() else {
        return HttpResponse::BadRequest().json(json!({"detail": "Data directory is unavailable"}));
    };

    let runtime_base = root.join("zones-encounters-index.json");
    let mut candidates = path_variants_with_json_alias(&runtime_base);
    if let Some(exe_dir) = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
    {
        candidates.extend(path_variants_with_json_alias(
            &exe_dir.join("resources").join("zones-encounters-index.json"),
        ));
    }
    candidates.extend(path_variants_with_json_alias(
        &Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../resources")
            .join("zones-encounters-index.json"),
    ));

    let existing: Vec<PathBuf> = candidates.into_iter().filter(|p| p.exists()).collect();
    if existing.is_empty() {
        return HttpResponse::NotFound().json(json!({
            "detail": "zones-encounters-index file not found in runtime or bundled resources"
        }));
    }

    let mut last_error: Option<String> = None;
    for path in existing {
        match std::fs::read_to_string(&path) {
            Ok(content) => match serde_json::from_str::<Value>(&content) {
                Ok(v) => return HttpResponse::Ok().json(v),
                Err(err) => {
                    last_error = Some(format!("Failed to parse {}: {}", path.display(), err));
                }
            },
            Err(err) => {
                last_error = Some(format!("Failed to read {}: {}", path.display(), err));
            }
        }
    }

    HttpResponse::InternalServerError().json(json!({
        "detail": last_error.unwrap_or_else(|| "Failed to read zones-encounters-index".to_string())
    }))
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
    std::fs::write(dst, bytes).map_err(|e| format!("Failed to save {}: {}", local_path, e))?;
    Ok(())
}

fn stage_raidbots_files(
    staging_root: &Path,
    final_root: &Path,
    files: &[String],
    metadata_text: &str,
) -> Result<(), String> {
    for file_name in files {
        let staged = staging_root.join(file_name);
        let final_path = final_root.join(file_name);
        if let Some(parent) = final_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                format!(
                    "Failed to create final directory for {}: {}",
                    final_path.display(),
                    e
                )
            })?;
        }

        match std::fs::rename(&staged, &final_path) {
            Ok(_) => {}
            Err(err) if err.kind() == io::ErrorKind::CrossesDevices => {
                std::fs::copy(&staged, &final_path).map_err(|copy_err| {
                    format!(
                        "Failed to copy staged file {} to {}: {}",
                        staged.display(),
                        final_path.display(),
                        copy_err
                    )
                })?;
                std::fs::remove_file(&staged).ok();
            }
            Err(err) => {
                return Err(format!(
                    "Failed to move staged file {} to {}: {}",
                    staged.display(),
                    final_path.display(),
                    err
                ));
            }
        }
    }

    std::fs::write(final_root.join("metadata.json"), metadata_text)
        .map_err(|e| format!("Failed to write metadata.json: {}", e))?;
    Ok(())
}

pub async fn download_data_file(
    path: web::Path<String>,
    data_dir: web::Data<Option<PathBuf>>,
    blizzard: web::Data<Arc<BlizzardState>>,
) -> HttpResponse {
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
) -> HttpResponse {
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

    let mut downloaded: Vec<String> = Vec::new();
    let mut failed: Vec<serde_json::Value> = Vec::new();

    for entry in catalog
        .iter()
        .filter(|e| {
            e.source == DataFileSource::Raidbots
                && e.entry_type == DataFileEntryType::File
                && e.remote_path.is_some()
        })
    {
        let path = root.join(&entry.local_path);
        if path.exists() {
            continue;
        }

        let Some(remote_path) = entry.remote_path.as_deref() else {
            continue;
        };

        match download_raidbots_file(&blizzard.client, &root, remote_path, &entry.local_path).await
        {
            Ok(()) => downloaded.push(entry.key.clone()),
            Err(err) => failed.push(json!({
                "key": entry.key,
                "relative_path": entry.local_path,
                "error": err,
            })),
        }
    }

    crate::item_db::load(&root);
    let runtime_file = root.join("blizzard-runtime-data.json");
    if runtime_file.exists() {
        crate::item_db::hydrate_runtime_metadata(&runtime_file);
    }

    HttpResponse::Ok().json(json!({
        "status": if failed.is_empty() { "ok" } else { "partial" },
        "downloaded_keys": downloaded,
        "failed": failed,
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
    let request_timeout = Duration::from_secs(15);

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
                    return Err("Raidbots metadata request timed out and no cached metadata.json exists".to_string());
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

                let file_res = tokio::time::timeout(request_timeout, blizzard.client.get(&file_url).send())
                    .await
                    .map_err(|_| format!("Timed out while downloading {}", file_name))?
                    .map_err(|e| format!("Failed to download {}: {}", file_name, e))?;
                let content = file_res
                    .bytes()
                    .await
                    .map_err(|e| format!("Failed to read {}: {}", file_name, e))?;

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
        if let Err(err) = wow_data_map::write_wow_data_map(dir) {
            eprintln!("wow-data-map generation warning: {}", err);
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
        if let Err(err) = wow_data_map::write_wow_data_map(dir) {
            eprintln!("wow-data-map generation warning: {}", err);
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
