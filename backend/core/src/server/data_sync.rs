use actix_web::{web, HttpResponse};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::item_db;
use crate::server::auth_handlers::{self, BlizzardAuthState};
use crate::server::blizzard::BlizzardState;
use crate::storage::JobStorage;

use actix_web::HttpRequest;

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

impl DataSyncState {
    pub fn new() -> Self {
        Self {
            status: Mutex::new(SyncStatus::Ready),
            progress: Mutex::new(String::new()),
        }
    }
}

pub async fn get_sync_status(
    req: HttpRequest,
    state: web::Data<Arc<DataSyncState>>,
    auth_state: web::Data<Arc<BlizzardAuthState>>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    let status = state.status.lock().await.clone();
    let progress = state.progress.lock().await.clone();

    let mut can_sync = false;
    if status == SyncStatus::NeedsCredentials 
        && get_effective_credentials(&req, &auth_state, store.get_ref()).is_some() {
        can_sync = true;
    }

    HttpResponse::Ok().json(json!({
        "status": status,
        "progress": progress,
        "can_sync": can_sync,
    }))
}

fn get_effective_credentials(
    req: &HttpRequest,
    auth_state: &Arc<BlizzardAuthState>,
    store: &Arc<dyn JobStorage>,
) -> Option<(String, String)> {
    // 1. Try system
    if let (Some(id), Some(sec)) = (
        store.get_user_config("system", "blizzard_client_id"),
        store.get_user_config("system", "blizzard_client_secret"),
    ) {
        return Some((id, sec));
    }

    // 2. Try logged in user
    if let Some(claims) = auth_handlers::verify_jwt(req, &auth_state.jwt_secret) {
        if let (Some(id), Some(sec)) = (
            store.get_user_config(&claims.sub, "blizzard_client_id"),
            store.get_user_config(&claims.sub, "blizzard_client_secret"),
        ) {
            return Some((id, sec));
        }
    }

    // 3. Try global config (from auth_state)
    if let (Some(id), Some(sec)) = (&auth_state.client_id, &auth_state.client_secret) {
        return Some((id.clone(), sec.clone()));
    }

    None
}

pub async fn trigger_sync(
    req: HttpRequest,
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

    let creds = get_effective_credentials(&req, &auth_state, store.get_ref());
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

    tokio::spawn(async move {
        if let Err(e) = perform_sync(
            state_clone.clone(),
            blizzard_clone,
            client_id,
            client_secret,
            data_dir_clone,
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
) -> Result<(), String> {
    // 1. Fetch from Raidbots
    let base_url = "https://www.raidbots.com/static/data/live";
    let metadata_url = format!("{}/metadata.json", base_url);

    {
        let mut p = state.progress.lock().await;
        *p = "Metadata:0:1:Fetching Raidbots metadata...".to_string();
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

    // Extract all file names ending in .json, .txt, or .lua using a simple regex mirror of the bash script
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
    }

    {
        let mut p = state.progress.lock().await;
        *p = "Season:0:1:Fetching current season index...".to_string();
    }

    // 2. Blizzard Season Sync (Rotation Data)
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

    // 2. Process Dungeons
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

            // Collect dungeon ID for rotation
            if let Some(id) = dungeon.get("id").and_then(|v| v.as_i64()) {
                rotation_dungeons.push(id);
            }

            // Small artificial delay to make the UI feel "alive" if it's too fast
            tokio::time::sleep(tokio::time::Duration::from_millis(150)).await;
        }
    }

    {
        let mut p = state.progress.lock().await;
        *p = "Finalizing:0:0:Saving rotation data...".to_string();
    }

    // 3. Update INSTANCES state and RELOAD all data
    if let Some(dir) = data_dir {
        let runtime_file = dir.join("blizzard-runtime-data.json");
        let runtime_data = json!({
            "current_season_id": current_season_id,
            "mplus_rotation": rotation_dungeons,
            "last_sync": chrono::Utc::now().to_rfc3339(),
        });

        std::fs::write(
            &runtime_file,
            serde_json::to_string_pretty(&runtime_data).unwrap(),
        )
        .map_err(|e| format!("Failed to save runtime data: {}", e))?;

        // Reload everything from the disk into memory
        item_db::load(&dir);
        item_db::hydrate_runtime_metadata(&runtime_file);
    }

    {
        let mut p = state.progress.lock().await;
        *p = "Done:1:1:Sync complete".to_string();
    }

    Ok(())
}
