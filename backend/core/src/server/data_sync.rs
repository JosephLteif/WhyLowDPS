use actix_web::{web, HttpResponse};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;
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

impl DataSyncState {
    pub fn new() -> Self {
        Self {
            status: Mutex::new(SyncStatus::Ready),
            progress: Mutex::new(String::new()),
        }
    }
}

pub async fn get_sync_status(
    req: actix_web::HttpRequest,
    state: web::Data<Arc<DataSyncState>>,
    auth_state: web::Data<Arc<BlizzardAuthState>>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    let status = state.status.lock().await.clone();
    let progress = state.progress.lock().await.clone();

    let can_sync = BlizzardState::get_effective_credentials(
        &req,
        Some(auth_state.get_ref()),
        &***store,
    )
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

    let creds = BlizzardState::get_effective_credentials(
        &req,
        Some(auth_state.get_ref()),
        &***store,
    );
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
                        if let Ok(last_sync) = chrono::DateTime::parse_from_rfc3339(last_sync_str) {
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
        let token = BlizzardState::get_token_with_creds(&blizzard.client, &client_id, &client_secret)
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
        let dungeons = season_data.get("dungeons").and_then(|d| d.as_array());
        let dungeon_count = dungeons.map(|d| d.len()).unwrap_or(0);

        if let Some(dungeons) = dungeons {
            for (i, dungeon) in dungeons.iter().enumerate() {
                let name = dungeon
                    .get("name")
                    .and_then(|n| n.as_str())
                    .unwrap_or("Unknown Dungeon");
                {
                    let mut p = state.progress.lock().await;
                    *p = format!("Dungeons:{}:{}:{}", i + 1, dungeon_count, name);
                }
                if let Some(id) = dungeon.get("id").and_then(|v| v.as_i64()) {
                    rotation_dungeons.push(id);
                }
                tokio::time::sleep(tokio::time::Duration::from_millis(150)).await;
            }
        }

        if let Some(dir) = &data_dir {
            let runtime_file = dir.join("blizzard-runtime-data.json");
            let runtime_data = json!({
                "current_season_id": current_season_id,
                "mplus_rotation": rotation_dungeons,
                "last_sync": chrono::Utc::now().to_rfc3339(),
            });
            std::fs::write(&runtime_file, serde_json::to_string_pretty(&runtime_data).unwrap()).ok();
        }
    }

    // Always Load/Reload data into memory at the end
    if let Some(dir) = &data_dir {
        crate::item_db::load(&dir);
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
