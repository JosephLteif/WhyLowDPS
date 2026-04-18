use actix_web::{web, HttpResponse};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::Path;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::server::auth_handlers::BlizzardAuthState;
use crate::server::blizzard::BlizzardState;
use crate::storage::JobStorage;

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

#[derive(Clone, Copy)]
enum DataFileSource {
    Raidbots,
    Runtime,
    Directory,
    LocalStatic,
}

#[derive(Clone)]
struct DataFileEntry {
    key: &'static str,
    label: &'static str,
    section: &'static str,
    relative_path: &'static str,
    required: bool,
    source: DataFileSource,
}

fn data_file_catalog() -> [DataFileEntry; 46] {
    [
        DataFileEntry {
            key: "metadata",
            label: "Metadata",
            section: "Metadata",
            relative_path: "metadata.json",
            required: true,
            source: DataFileSource::Raidbots,
        },
        DataFileEntry {
            key: "items",
            label: "Equippable Items",
            section: "Items",
            relative_path: "equippable-items.json",
            required: true,
            source: DataFileSource::Raidbots,
        },
        DataFileEntry {
            key: "bonuses",
            label: "Bonuses",
            section: "Bonus Data",
            relative_path: "bonuses.json",
            required: true,
            source: DataFileSource::Raidbots,
        },
        DataFileEntry {
            key: "equippable_items_full",
            label: "Equippable Items (Full)",
            section: "Items",
            relative_path: "equippable-items-full.json",
            required: false,
            source: DataFileSource::Raidbots,
        },
        DataFileEntry {
            key: "item_names",
            label: "Item Names",
            section: "Items",
            relative_path: "item-names.json",
            required: false,
            source: DataFileSource::Raidbots,
        },
        DataFileEntry {
            key: "bonus_affix_names",
            label: "Bonus Affix Names",
            section: "Bonus Data",
            relative_path: "bonus-affix-names.json",
            required: false,
            source: DataFileSource::Raidbots,
        },
        DataFileEntry {
            key: "bonus_corruption",
            label: "Bonus Corruption",
            section: "Bonus Data",
            relative_path: "bonus-corruption.json",
            required: false,
            source: DataFileSource::Raidbots,
        },
        DataFileEntry {
            key: "bonus_crafted_stats",
            label: "Bonus Crafted Stats",
            section: "Bonus Data",
            relative_path: "bonus-crafted-stats.json",
            required: false,
            source: DataFileSource::Raidbots,
        },
        DataFileEntry {
            key: "bonus_effects",
            label: "Bonus Effects",
            section: "Bonus Data",
            relative_path: "bonus-effects.json",
            required: false,
            source: DataFileSource::Raidbots,
        },
        DataFileEntry {
            key: "bonus_id_base_levels",
            label: "Bonus ID Base Levels",
            section: "Bonus Data",
            relative_path: "bonus-id-base-levels.json",
            required: false,
            source: DataFileSource::Raidbots,
        },
        DataFileEntry {
            key: "bonus_id_levels",
            label: "Bonus ID Levels",
            section: "Bonus Data",
            relative_path: "bonus-id-levels.json",
            required: false,
            source: DataFileSource::Raidbots,
        },
        DataFileEntry {
            key: "bonus_level_deltas",
            label: "Bonus Level Deltas",
            section: "Bonus Data",
            relative_path: "bonus-level-deltas.json",
            required: false,
            source: DataFileSource::Raidbots,
        },
        DataFileEntry {
            key: "bonus_sockets",
            label: "Bonus Sockets",
            section: "Bonus Data",
            relative_path: "bonus-sockets.json",
            required: false,
            source: DataFileSource::Raidbots,
        },
        DataFileEntry {
            key: "bonus_upgrade_sets",
            label: "Bonus Upgrade Sets",
            section: "Bonus Data",
            relative_path: "bonus-upgrade-sets.json",
            required: false,
            source: DataFileSource::Raidbots,
        },
        DataFileEntry {
            key: "item_curves",
            label: "Item Curves",
            section: "Curves",
            relative_path: "item-curves.json",
            required: false,
            source: DataFileSource::Raidbots,
        },
        DataFileEntry {
            key: "item_squish_era",
            label: "Item Squish Era",
            section: "Curves",
            relative_path: "item-squish-era.json",
            required: false,
            source: DataFileSource::Raidbots,
        },
        DataFileEntry {
            key: "item_level_bonus_lookup",
            label: "Item Level Bonus Lookup",
            section: "Bonus Data",
            relative_path: "item-level-bonus-lookup.json",
            required: false,
            source: DataFileSource::Raidbots,
        },
        DataFileEntry {
            key: "item_level_offset_bonuses",
            label: "Item Level Offset Bonuses",
            section: "Bonus Data",
            relative_path: "item-level-offset-bonuses.json",
            required: false,
            source: DataFileSource::Raidbots,
        },
        DataFileEntry {
            key: "item_limit_categories",
            label: "Item Limit Categories",
            section: "Item Data",
            relative_path: "item-limit-categories.json",
            required: false,
            source: DataFileSource::Raidbots,
        },
        DataFileEntry {
            key: "item_conversions",
            label: "Item Conversions",
            section: "Item Data",
            relative_path: "item-conversions.json",
            required: false,
            source: DataFileSource::Raidbots,
        },
        DataFileEntry {
            key: "crafting",
            label: "Crafting",
            section: "Item Data",
            relative_path: "crafting.json",
            required: false,
            source: DataFileSource::Raidbots,
        },
        DataFileEntry {
            key: "instances",
            label: "Instances",
            section: "Instances",
            relative_path: "instances.json",
            required: true,
            source: DataFileSource::Raidbots,
        },
        DataFileEntry {
            key: "instance_names",
            label: "Instance Names",
            section: "Instances",
            relative_path: "instance-names.json",
            required: false,
            source: DataFileSource::Raidbots,
        },
        DataFileEntry {
            key: "encounter_names",
            label: "Encounter Names",
            section: "Instances",
            relative_path: "encounter-names.json",
            required: false,
            source: DataFileSource::Raidbots,
        },
        DataFileEntry {
            key: "encounter_items",
            label: "Encounter Items",
            section: "Instances",
            relative_path: "encounter-items.json",
            required: false,
            source: DataFileSource::Raidbots,
        },
        DataFileEntry {
            key: "gems",
            label: "Gems",
            section: "Enchants & Gems",
            relative_path: "gems.json",
            required: true,
            source: DataFileSource::Raidbots,
        },
        DataFileEntry {
            key: "enchants",
            label: "Enchantments",
            section: "Enchants & Gems",
            relative_path: "enchantments.json",
            required: true,
            source: DataFileSource::Raidbots,
        },
        DataFileEntry {
            key: "season_config",
            label: "Season Config",
            section: "Static Config",
            relative_path: "season-config.json",
            required: true,
            source: DataFileSource::LocalStatic,
        },
        DataFileEntry {
            key: "talents",
            label: "Talents",
            section: "Talents",
            relative_path: "talents.json",
            required: false,
            source: DataFileSource::Raidbots,
        },
        DataFileEntry {
            key: "consumables_flasks",
            label: "Consumables: Flasks",
            section: "Consumables",
            relative_path: "flasks.json",
            required: false,
            source: DataFileSource::Raidbots,
        },
        DataFileEntry {
            key: "consumables_foods",
            label: "Consumables: Foods",
            section: "Consumables",
            relative_path: "foods.json",
            required: false,
            source: DataFileSource::Raidbots,
        },
        DataFileEntry {
            key: "consumables_potions",
            label: "Consumables: Potions",
            section: "Consumables",
            relative_path: "potions.json",
            required: false,
            source: DataFileSource::Raidbots,
        },
        DataFileEntry {
            key: "consumables_augments",
            label: "Consumables: Augments",
            section: "Consumables",
            relative_path: "augments.json",
            required: false,
            source: DataFileSource::Raidbots,
        },
        DataFileEntry {
            key: "consumables_temp_enchants",
            label: "Consumables: Temp Enchants",
            section: "Consumables",
            relative_path: "temp-enchants.json",
            required: false,
            source: DataFileSource::Raidbots,
        },
        DataFileEntry {
            key: "class_traits_json",
            label: "Class Traits",
            section: "Classes",
            relative_path: "class-traits.json",
            required: true,
            source: DataFileSource::Raidbots,
        },
        DataFileEntry {
            key: "currency_types",
            label: "Currency Types",
            section: "Item Data",
            relative_path: "currency-types.json",
            required: false,
            source: DataFileSource::Raidbots,
        },
        DataFileEntry {
            key: "legendary_abilities",
            label: "Legendary Abilities",
            section: "Static Config",
            relative_path: "legendary-abilities.json",
            required: false,
            source: DataFileSource::Raidbots,
        },
        DataFileEntry {
            key: "level_selector_sequences",
            label: "Level Selector Sequences",
            section: "Static Config",
            relative_path: "level-selector-sequences.json",
            required: false,
            source: DataFileSource::Raidbots,
        },
        DataFileEntry {
            key: "manifest_paths",
            label: "Manifest Paths",
            section: "Static Config",
            relative_path: "manifest-paths.txt",
            required: false,
            source: DataFileSource::Raidbots,
        },
        DataFileEntry {
            key: "manifest_paths_all",
            label: "Manifest Paths (All)",
            section: "Static Config",
            relative_path: "manifest-paths-all.txt",
            required: false,
            source: DataFileSource::Raidbots,
        },
        DataFileEntry {
            key: "icon_lookup",
            label: "Icon Lookup",
            section: "Static Config",
            relative_path: "icon-lookup.json",
            required: false,
            source: DataFileSource::Raidbots,
        },
        DataFileEntry {
            key: "icon_paths",
            label: "Icon Paths",
            section: "Static Config",
            relative_path: "icon-paths.txt",
            required: false,
            source: DataFileSource::Raidbots,
        },
        DataFileEntry {
            key: "spell_scaling_table",
            label: "Spell Scaling Table",
            section: "Static Config",
            relative_path: "spell-scaling-table.json",
            required: false,
            source: DataFileSource::Raidbots,
        },
        DataFileEntry {
            key: "item_sets",
            label: "Item Sets",
            section: "Item Data",
            relative_path: "item-sets.json",
            required: false,
            source: DataFileSource::Raidbots,
        },
        DataFileEntry {
            key: "runtime_blizzard",
            label: "Runtime: Blizzard Rotation",
            section: "Runtime",
            relative_path: "blizzard-runtime-data.json",
            required: false,
            source: DataFileSource::Runtime,
        },
        DataFileEntry {
            key: "instance_images_dir",
            label: "Instance Images Directory",
            section: "Runtime",
            relative_path: "instance-images",
            required: false,
            source: DataFileSource::Directory,
        },
    ]
}

impl DataSyncState {
    pub fn new() -> Self {
        Self {
            status: Mutex::new(SyncStatus::Ready),
            progress: Mutex::new(String::new()),
        }
    }
}

pub async fn get_data_file_states(data_dir: web::Data<Option<PathBuf>>) -> HttpResponse {
    let Some(root) = data_dir.get_ref().clone() else {
        let empty_files: Vec<DataFileState> = Vec::new();
        return HttpResponse::Ok().json(json!({
            "base_path": null,
            "available": false,
            "files": empty_files,
        }));
    };

    let files: Vec<DataFileState> = data_file_catalog()
        .iter()
        .map(|entry| {
            let metadata = match entry.source {
                DataFileSource::LocalStatic => {
                    let runtime = root.join(entry.relative_path);
                    if runtime.exists() {
                        std::fs::metadata(runtime).ok()
                    } else {
                        let bundled =
                            Path::new(env!("CARGO_MANIFEST_DIR")).join(entry.relative_path);
                        std::fs::metadata(bundled).ok()
                    }
                }
                _ => std::fs::metadata(root.join(entry.relative_path)).ok(),
            };
            let is_dir = metadata.as_ref().map(|m| m.is_dir()).unwrap_or(false);
            let size_bytes = if is_dir {
                0
            } else {
                metadata.as_ref().map(|m| m.len()).unwrap_or(0)
            };
            DataFileState {
                key: entry.key.to_string(),
                label: entry.label.to_string(),
                section: entry.section.to_string(),
                relative_path: entry.relative_path.to_string(),
                required: entry.required,
                downloadable: matches!(entry.source, DataFileSource::Raidbots),
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

pub async fn get_data_file_content(
    path: web::Path<String>,
    data_dir: web::Data<Option<PathBuf>>,
) -> HttpResponse {
    let key = path.into_inner();
    let Some(root) = data_dir.get_ref().clone() else {
        return HttpResponse::BadRequest().json(json!({"detail": "Data directory is unavailable"}));
    };

    let catalog = data_file_catalog();
    let Some(entry) = catalog.iter().find(|e| e.key == key) else {
        return HttpResponse::NotFound().json(json!({"detail": "Unknown data file key"}));
    };

    if matches!(entry.source, DataFileSource::Directory) {
        return HttpResponse::BadRequest()
            .json(json!({"detail": "Directories do not have file content"}));
    }

    if !is_previewable_file(entry.relative_path) {
        return HttpResponse::BadRequest()
            .json(json!({"detail": "This file type is not previewable"}));
    }

    let path = match entry.source {
        DataFileSource::LocalStatic => {
            let runtime = root.join(entry.relative_path);
            if runtime.exists() {
                runtime
            } else {
                Path::new(env!("CARGO_MANIFEST_DIR")).join(entry.relative_path)
            }
        }
        _ => root.join(entry.relative_path),
    };

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
    let max_preview_len = 250_000usize;
    let truncated = content.len() > max_preview_len;
    let preview = if truncated {
        content.chars().take(max_preview_len).collect::<String>()
    } else {
        content
    };

    HttpResponse::Ok().json(DataFilePreviewResponse {
        key: entry.key.to_string(),
        label: entry.label.to_string(),
        relative_path: entry.relative_path.to_string(),
        content: preview,
        truncated,
    })
}

async fn download_raidbots_file(
    client: &reqwest::Client,
    data_root: &Path,
    relative_path: &str,
) -> Result<(), String> {
    let base_url = "https://www.raidbots.com/static/data/live";
    let file_url = format!("{}/{}", base_url, relative_path);
    let dst = data_root.join(relative_path);
    if let Some(parent) = dst.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let res = client
        .get(&file_url)
        .send()
        .await
        .map_err(|e| format!("Failed to download {}: {}", relative_path, e))?;
    if !res.status().is_success() {
        return Err(format!(
            "Failed to download {}: HTTP {}",
            relative_path,
            res.status()
        ));
    }
    let bytes = res
        .bytes()
        .await
        .map_err(|e| format!("Failed to read {}: {}", relative_path, e))?;
    std::fs::write(dst, bytes).map_err(|e| format!("Failed to save {}: {}", relative_path, e))?;
    Ok(())
}

pub async fn download_data_file(
    path: web::Path<String>,
    data_dir: web::Data<Option<PathBuf>>,
    blizzard: web::Data<Arc<BlizzardState>>,
) -> HttpResponse {
    let key = path.into_inner();
    let Some(root) = data_dir.get_ref().clone() else {
        return HttpResponse::BadRequest().json(json!({"detail": "Data directory is unavailable"}));
    };

    let catalog = data_file_catalog();
    let Some(entry) = catalog.iter().find(|e| e.key == key) else {
        return HttpResponse::NotFound().json(json!({"detail": "Unknown data file key"}));
    };

    if !matches!(entry.source, DataFileSource::Raidbots) {
        return HttpResponse::BadRequest()
            .json(json!({"detail": "This entry cannot be downloaded directly"}));
    }

    match download_raidbots_file(&blizzard.client, &root, entry.relative_path).await {
        Ok(()) => {
            crate::item_db::load(&root);
            let runtime_file = root.join("blizzard-runtime-data.json");
            if runtime_file.exists() {
                crate::item_db::hydrate_runtime_metadata(&runtime_file);
            }
            HttpResponse::Ok().json(json!({
                "status": "ok",
                "key": entry.key,
                "relative_path": entry.relative_path,
            }))
        }
        Err(e) => HttpResponse::InternalServerError().json(json!({"detail": e})),
    }
}

pub async fn download_missing_data_files(
    data_dir: web::Data<Option<PathBuf>>,
    blizzard: web::Data<Arc<BlizzardState>>,
) -> HttpResponse {
    let Some(root) = data_dir.get_ref().clone() else {
        return HttpResponse::BadRequest().json(json!({"detail": "Data directory is unavailable"}));
    };

    let mut downloaded: Vec<String> = Vec::new();
    let mut failed: Vec<serde_json::Value> = Vec::new();

    for entry in data_file_catalog()
        .iter()
        .filter(|e| matches!(e.source, DataFileSource::Raidbots))
    {
        let path = root.join(entry.relative_path);
        if path.exists() {
            continue;
        }

        match download_raidbots_file(&blizzard.client, &root, entry.relative_path).await {
            Ok(()) => downloaded.push(entry.key.to_string()),
            Err(err) => failed.push(json!({
                "key": entry.key,
                "relative_path": entry.relative_path,
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

async fn perform_sync(
    state: Arc<DataSyncState>,
    blizzard: Arc<BlizzardState>,
    client_id: String,
    client_secret: String,
    data_dir: Option<PathBuf>,
    force_refresh: bool,
) -> Result<(), String> {
    // 1. Fetch from Raidbots
    let base_url = "https://www.raidbots.com/static/data/live";
    let metadata_url = format!("{}/metadata.json", base_url);

    {
        let mut p = state.progress.lock().await;
        *p = "Metadata:0:1:Checking Raidbots metadata...".to_string();
    }

    let res = blizzard
        .client
        .get(&metadata_url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch metadata: {}", e))?;
    let metadata_text = res
        .text()
        .await
        .map_err(|e| format!("Failed to read metadata: {}", e))?;

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

            for (i, file_name) in files.iter().enumerate() {
                {
                    let mut p = state.progress.lock().await;
                    *p = format!("Files:{}:{}:{}", i + 1, total_files, file_name);
                }

                let file_url = format!("{}/{}", base_url, file_name);
                let file_path = dir.join(file_name);
                if let Some(parent) = file_path.parent() {
                    std::fs::create_dir_all(parent).map_err(|e| {
                        format!("Failed to create directory for {}: {}", file_name, e)
                    })?;
                }

                let file_res = blizzard
                    .client
                    .get(&file_url)
                    .send()
                    .await
                    .map_err(|e| format!("Failed to download {}: {}", file_name, e))?;
                let content = file_res
                    .bytes()
                    .await
                    .map_err(|e| format!("Failed to read {}: {}", file_name, e))?;

                std::fs::write(&file_path, content)
                    .map_err(|e| format!("Failed to save {}: {}", file_name, e))?;
            }
            // Save metadata last
            std::fs::write(dir.join("metadata.json"), &metadata_text).ok();
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
                    
                    if let Ok(res) = blizzard.client.get(&dungeon_url).bearer_auth(&token).send().await {
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
                            let minimum_level = detail_data
                                .get("minimum_level")
                                .and_then(|v| v.as_i64());
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
                                            enc.get("name")
                                                .and_then(|n| localized_str(Some(n)))
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
                            
                            // Try to get image from media assets
                            if let Some(media) = detail_data.get("media").and_then(|m| m.as_object()) {
                                if let Some(assets) = media.get("assets").and_then(|a| a.as_array()) {
                                    if let Some(first_asset) = assets.first() {
                                        if let Some(url) = first_asset.get("value").and_then(|v| v.as_str()) {
                                            detail["image_url"] = json!(url);
                                        }
                                    }
                                }
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
