use actix_web::{web, HttpResponse};
use chrono::{DateTime, Duration, Utc};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::server::auth_handlers::BlizzardAuthState;
use crate::server::blizzard::BlizzardState;
use crate::storage::JobStorage;

const RAIDER_AFFIXES_URL: &str = "https://raider.io/api/v1/mythic-plus/affixes?region=us&locale=en";
const BLIZZARD_SEASON_INDEX_URL: &str =
    "https://us.api.blizzard.com/data/wow/mythic-keystone/season/index?namespace=dynamic-us&locale=en_US";
const CACHE_TTL_MINUTES: i64 = 15;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameDataState {
    pub season_id: u32,
    pub season_name: String,
    pub active_affixes: Vec<String>,
    pub mplus_rotation: Vec<u32>,
    pub last_sync: String,
}

#[derive(Debug, Clone)]
struct CachedGameState {
    data: GameDataState,
    fetched_at: DateTime<Utc>,
}

#[derive(Default)]
struct GameDataProviderCache {
    latest: Option<CachedGameState>,
    refreshing: bool,
}

#[derive(Debug, Deserialize)]
struct RaiderAffixPayload {
    #[serde(default)]
    affix_details: Vec<RaiderAffixDetail>,
}

#[derive(Debug, Deserialize)]
struct RaiderAffixDetail {
    name: Option<String>,
}

static GAME_DATA_CACHE: Lazy<Mutex<GameDataProviderCache>> =
    Lazy::new(|| Mutex::new(GameDataProviderCache::default()));

fn localized_name(value: Option<&Value>) -> Option<String> {
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

fn extract_dungeon_id(dungeon: &Value) -> Option<u32> {
    if let Some(id) = dungeon.get("id").and_then(|v| v.as_u64()) {
        return u32::try_from(id).ok();
    }
    let href = dungeon
        .get("key")
        .and_then(|k| k.get("href"))
        .and_then(|h| h.as_str())?;
    href.split("/mythic-keystone/dungeon/")
        .nth(1)
        .and_then(|tail| tail.split('?').next())
        .and_then(|id_str| id_str.parse::<u32>().ok())
}

fn runtime_fallback_state() -> GameDataState {
    let runtime = crate::item_db::get_runtime_data();

    let season_id = runtime
        .get("current_season_id")
        .and_then(|v| v.as_u64())
        .and_then(|v| u32::try_from(v).ok())
        .unwrap_or_else(|| crate::item_db::current_season_id() as u32);

    let season_name = runtime
        .get("season_name")
        .and_then(|v| v.as_str())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| format!("Season {}", season_id));

    let active_affixes = runtime
        .get("current_affixes")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|affix| {
                    affix
                        .get("name")
                        .and_then(|name| name.as_str())
                        .map(ToOwned::to_owned)
                })
                .collect::<Vec<String>>()
        })
        .unwrap_or_default();

    let mplus_rotation = runtime
        .get("mplus_rotation")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|id| id.as_u64())
                .filter_map(|id| u32::try_from(id).ok())
                .collect::<Vec<u32>>()
        })
        .unwrap_or_default();

    let last_sync = runtime
        .get("last_sync")
        .and_then(|v| v.as_str())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| Utc::now().to_rfc3339());

    GameDataState {
        season_id,
        season_name,
        active_affixes,
        mplus_rotation,
        last_sync,
    }
}

async fn fetch_raider_affix_names(client: &reqwest::Client) -> Option<Vec<String>> {
    let res = client.get(RAIDER_AFFIXES_URL).send().await.ok()?;
    if !res.status().is_success() {
        return None;
    }

    let payload: RaiderAffixPayload = res.json().await.ok()?;
    let mut names = Vec::new();
    for affix in payload.affix_details {
        let Some(name) = affix.name else {
            continue;
        };
        if !name.trim().is_empty() {
            names.push(name);
        }
    }
    if names.is_empty() {
        None
    } else {
        Some(names)
    }
}

async fn fetch_blizzard_state(
    client: &reqwest::Client,
    credentials: Option<(String, String)>,
) -> Option<(u32, String, Vec<u32>)> {
    let (client_id, client_secret) = credentials?;
    let token = BlizzardState::get_token_with_creds(client, &client_id, &client_secret).await?;

    let season_index_res = client
        .get(BLIZZARD_SEASON_INDEX_URL)
        .bearer_auth(&token)
        .send()
        .await
        .ok()?;
    if !season_index_res.status().is_success() {
        return None;
    }
    let season_index: Value = season_index_res.json().await.ok()?;
    let season_id = season_index
        .get("current_season")
        .and_then(|s| s.get("id"))
        .and_then(|id| id.as_u64())
        .and_then(|id| u32::try_from(id).ok())?;

    let season_url = format!(
        "https://us.api.blizzard.com/data/wow/mythic-keystone/season/{}?namespace=dynamic-us&locale=en_US",
        season_id
    );
    let season_res = client
        .get(&season_url)
        .bearer_auth(&token)
        .send()
        .await
        .ok()?;
    if !season_res.status().is_success() {
        return None;
    }
    let season_data: Value = season_res.json().await.ok()?;
    let season_name =
        localized_name(season_data.get("name")).unwrap_or_else(|| format!("Season {}", season_id));
    let rotation = season_data
        .get("dungeons")
        .and_then(|d| d.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(extract_dungeon_id)
                .collect::<Vec<u32>>()
        })
        .unwrap_or_default();

    Some((season_id, season_name, rotation))
}

async fn fetch_fresh_state(
    client: &reqwest::Client,
    credentials: Option<(String, String)>,
) -> GameDataState {
    let mut state = runtime_fallback_state();

    if let Some(active_affixes) = fetch_raider_affix_names(client).await {
        state.active_affixes = active_affixes;
    }

    if let Some((season_id, season_name, rotation)) =
        fetch_blizzard_state(client, credentials).await
    {
        state.season_id = season_id;
        state.season_name = season_name;
        state.mplus_rotation = rotation;
    }

    state.last_sync = Utc::now().to_rfc3339();
    state
}

async fn refresh_cache_in_background(
    client: reqwest::Client,
    credentials: Option<(String, String)>,
) {
    let fresh = fetch_fresh_state(&client, credentials).await;
    let mut cache = GAME_DATA_CACHE.lock().await;
    cache.latest = Some(CachedGameState {
        data: fresh,
        fetched_at: Utc::now(),
    });
    cache.refreshing = false;
}

pub async fn get_game_data_state(
    req: actix_web::HttpRequest,
    blizzard: web::Data<Arc<BlizzardState>>,
    auth_state: web::Data<Arc<BlizzardAuthState>>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    let credentials =
        BlizzardState::get_effective_credentials(&req, Some(auth_state.get_ref()), &***store);
    let now = Utc::now();
    let stale_after = Duration::minutes(CACHE_TTL_MINUTES);

    let mut cache = GAME_DATA_CACHE.lock().await;
    if let Some(existing) = cache.latest.clone() {
        let is_stale = now.signed_duration_since(existing.fetched_at) >= stale_after;
        if is_stale && !cache.refreshing {
            cache.refreshing = true;
            let client = blizzard.client.clone();
            let creds = credentials.clone();
            tokio::spawn(async move {
                refresh_cache_in_background(client, creds).await;
            });
        }
        return HttpResponse::Ok().json(existing.data);
    }

    if cache.refreshing {
        return HttpResponse::Ok().json(runtime_fallback_state());
    }
    cache.refreshing = true;
    drop(cache);

    let fresh = fetch_fresh_state(&blizzard.client, credentials).await;
    let mut cache = GAME_DATA_CACHE.lock().await;
    cache.latest = Some(CachedGameState {
        data: fresh.clone(),
        fetched_at: Utc::now(),
    });
    cache.refreshing = false;

    HttpResponse::Ok().json(fresh)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::item_db::state;
    use serde_json::json;

    #[test]
    fn localized_name_prefers_en_us_then_any_value() {
        assert_eq!(localized_name(Some(&json!("Season 3"))), Some("Season 3".to_string()));
        assert_eq!(
            localized_name(Some(&json!({"en_US":"Season Three","fr_FR":"Saison Trois"}))),
            Some("Season Three".to_string())
        );
        assert_eq!(
            localized_name(Some(&json!({"fr_FR":"Saison Trois"}))),
            Some("Saison Trois".to_string())
        );
        assert_eq!(localized_name(Some(&json!({"x": 1}))), None);
        assert_eq!(localized_name(None), None);
    }

    #[test]
    fn extract_dungeon_id_supports_numeric_id_and_href_key() {
        assert_eq!(extract_dungeon_id(&json!({"id": 507})), Some(507));
        assert_eq!(
            extract_dungeon_id(&json!({
                "key": {
                    "href": "https://us.api.blizzard.com/data/wow/mythic-keystone/dungeon/525?namespace=dynamic-us"
                }
            })),
            Some(525)
        );
        assert_eq!(extract_dungeon_id(&json!({"key":{"href":"https://example.com/invalid"}})), None);
    }

    #[test]
    fn runtime_fallback_state_prefers_runtime_payload_and_defaults_when_missing() {
        let _guard = state::TEST_STATE_LOCK.lock().unwrap();
        let prev_runtime = state::RUNTIME_DATA.read().unwrap().clone();
        let prev_season = *state::CURRENT_SEASON_ID.read().unwrap();

        *state::RUNTIME_DATA.write().unwrap() = json!({
            "current_season_id": 14,
            "season_name": "Season of Midnight",
            "current_affixes": [{"name":"Tyrannical"},{"name":"Entangled"}],
            "mplus_rotation": [505, 506, 507],
            "last_sync": "2026-05-19T10:00:00Z"
        });
        *state::CURRENT_SEASON_ID.write().unwrap() = 13;

        let with_runtime = runtime_fallback_state();
        assert_eq!(with_runtime.season_id, 14);
        assert_eq!(with_runtime.season_name, "Season of Midnight");
        assert_eq!(with_runtime.active_affixes, vec!["Tyrannical", "Entangled"]);
        assert_eq!(with_runtime.mplus_rotation, vec![505, 506, 507]);
        assert_eq!(with_runtime.last_sync, "2026-05-19T10:00:00Z");

        *state::RUNTIME_DATA.write().unwrap() = json!({});
        *state::CURRENT_SEASON_ID.write().unwrap() = 22;
        let fallback_only = runtime_fallback_state();
        assert_eq!(fallback_only.season_id, 22);
        assert_eq!(fallback_only.season_name, "Season 22");
        assert!(fallback_only.active_affixes.is_empty());
        assert!(fallback_only.mplus_rotation.is_empty());
        assert!(!fallback_only.last_sync.is_empty());

        *state::RUNTIME_DATA.write().unwrap() = prev_runtime;
        *state::CURRENT_SEASON_ID.write().unwrap() = prev_season;
    }
}
