use crate::server::auth_handlers::{verify_jwt, BlizzardAuthState};
use actix_web::{web, HttpResponse};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Debug, Serialize, Deserialize, Clone)]
struct BlizzardToken {
    access_token: String,
    expires_in: u64,
}

pub struct BlizzardState {
    pub client: Client,
}

impl BlizzardState {
    pub fn new() -> Self {
        Self {
            client: Client::new(),
        }
    }

    pub async fn get_token_with_creds(client: &Client, id: &str, secret: &str) -> Option<String> {
        let res = client
            .post("https://oauth.battle.net/token")
            .basic_auth(id, Some(secret))
            .form(&[("grant_type", "client_credentials")])
            .send()
            .await
            .ok()?;

        if !res.status().is_success() {
            return None;
        }

        let data: BlizzardToken = res.json().await.ok()?;
        Some(data.access_token)
    }

    pub fn get_effective_credentials(
        req: &actix_web::HttpRequest,
        auth_state: Option<&BlizzardAuthState>,
        store: &dyn crate::storage::JobStorage,
    ) -> Option<(String, String)> {
        // 1. Try system credentials (local app config)
        if let (Some(id), Some(sec)) = (
            store.get_user_config("system", "blizzard_client_id"),
            store.get_user_config("system", "blizzard_client_secret"),
        ) {
            return Some((id, sec));
        }

        // 2. Try logged in user credentials
        if let Some(auth) = auth_state {
            if let Some(claims) = verify_jwt(req, &auth.jwt_secret) {
                if let (Some(id), Some(sec)) = (
                    store.get_user_config(&claims.sub, "blizzard_client_id"),
                    store.get_user_config(&claims.sub, "blizzard_client_secret"),
                ) {
                    return Some((id, sec));
                }
            }
        }

        // 3. Try global config (env vars)
        if let Some(auth) = auth_state {
            if let (Some(id), Some(sec)) = (&auth.client_id, &auth.client_secret) {
                return Some((id.clone(), sec.clone()));
            }
        }

        None
    }
}

pub async fn get_effective_token(
    req: &actix_web::HttpRequest,
    state: &BlizzardState,
    auth_state: Option<&BlizzardAuthState>,
    store: &dyn crate::storage::JobStorage,
) -> Option<String> {
    // Priority 1: Check for an active user session token (direct access)
    if let Some(auth) = auth_state {
        if let Some(_claims) = verify_jwt(req, &auth.jwt_secret) {
            // If the user is logged in via OAuth, we might have their access token directly.
            // However, Blizzard user tokens expire. For proxying, we often prefer client_credentials
            // using their configured keys, or just use their user token if it's fresh.
            // For now, we continue to prioritize client_credentials for proxying as it's more stable.
            // But we COULD return claims.access_token here if we wanted.
        }
    }

    // Priority 2: Use client_credentials from the best available source
    if let Some((id, secret)) = BlizzardState::get_effective_credentials(req, auth_state, store) {
        return BlizzardState::get_token_with_creds(&state.client, &id, &secret).await;
    }

    None
}

#[derive(Deserialize)]
pub struct ProxyQuery {
    pub region: Option<String>,
    pub refresh: Option<bool>,
}

pub async fn proxy_character_profile(
    req: actix_web::HttpRequest,
    state: web::Data<Arc<BlizzardState>>,
    auth_state: web::Data<Option<Arc<BlizzardAuthState>>>,
    store: web::Data<Arc<dyn crate::storage::JobStorage>>,
    path: web::Path<(String, String)>,
    query: web::Query<ProxyQuery>,
) -> HttpResponse {
    let (realm, name) = path.into_inner();
    let region = query.region.as_deref().unwrap_or("us");
    let namespace = format!("profile-{}", region);
    let realm_slug = realm.to_lowercase().replace("'", "").replace(" ", "-");

    let cache_key = format!(
        "char_profile_{}_{}_{}",
        region,
        realm_slug,
        name.to_lowercase()
    );
    if !query.refresh.unwrap_or(false) {
        if let Some(cached) = store.get_cache(&cache_key) {
            if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(&cached) {
                return HttpResponse::Ok().json(json_val);
            }
        }
    }

    let token = match get_effective_token(
        &req,
        &state,
        auth_state.as_ref().as_ref().map(|a| a.as_ref()),
        &***store,
    )
    .await
    {
        Some(t) => t,
        None => return HttpResponse::Unauthorized().finish(),
    };

    let url = format!(
        "https://{}.api.blizzard.com/profile/wow/character/{}/{}?namespace={}&locale=en_US",
        region,
        realm_slug,
        name.to_lowercase(),
        namespace
    );

    let res = state
        .client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await;

    match res {
        Ok(r) if r.status().is_success() => {
            let data: serde_json::Value = r.json().await.unwrap_or(serde_json::json!({}));
            store.set_cache(&cache_key, data.to_string());
            HttpResponse::Ok().json(data)
        }
        _ => HttpResponse::NotFound().finish(),
    }
}

pub async fn proxy_character_media(
    req: actix_web::HttpRequest,
    state: web::Data<Arc<BlizzardState>>,
    auth_state: web::Data<Option<Arc<BlizzardAuthState>>>,
    store: web::Data<Arc<dyn crate::storage::JobStorage>>,
    path: web::Path<(String, String, String)>,
    query: web::Query<ProxyQuery>,
) -> HttpResponse {
    let (realm, name, _type) = path.into_inner();
    let region = query.region.as_deref().unwrap_or("us");
    let namespace = format!("profile-{}", region);
    let realm_slug = realm.to_lowercase().replace("'", "").replace(" ", "-");

    let target_type = if _type == "render" || _type == "main" {
        "main-raw"
    } else {
        _type.as_str()
    };

    let cache_key = format!(
        "char_media_{}_{}_{}_{}",
        target_type,
        region,
        realm_slug,
        name.to_lowercase()
    );
    if !query.refresh.unwrap_or(false) {
        if let Some(cached) = store.get_cache(&cache_key) {
            return HttpResponse::Found()
                .append_header(("Location", cached))
                .finish();
        }
    }

    let token = match get_effective_token(
        &req,
        &state,
        auth_state.as_ref().as_ref().map(|a| a.as_ref()),
        &***store,
    )
    .await
    {
        Some(t) => t,
        None => return HttpResponse::Unauthorized().finish(),
    };

    let url = format!(
        "https://{}.api.blizzard.com/profile/wow/character/{}/{}/character-media?namespace={}&locale=en_US",
        region,
        realm_slug,
        name.to_lowercase(),
        namespace
    );

    let res = state
        .client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await;

    match res {
        Ok(r) if r.status().is_success() => {
            let data: serde_json::Value = r.json().await.unwrap_or(serde_json::json!({}));
            if let Some(assets) = data.get("assets").and_then(|a| a.as_array()) {
                for asset in assets {
                    if let (Some(key), Some(value)) = (
                        asset.get("key").and_then(|v| v.as_str()),
                        asset.get("value").and_then(|v| v.as_str()),
                    ) {
                        if key == target_type {
                            store.set_cache(&cache_key, value.to_string());
                            return HttpResponse::Found()
                                .append_header(("Location", value))
                                .finish();
                        }
                    }
                }
            }
            HttpResponse::NotFound().finish()
        }
        _ => HttpResponse::NotFound().finish(),
    }
}

pub async fn proxy_character_equipment(
    req: actix_web::HttpRequest,
    state: web::Data<Arc<BlizzardState>>,
    auth_state: web::Data<Option<Arc<BlizzardAuthState>>>,
    store: web::Data<Arc<dyn crate::storage::JobStorage>>,
    path: web::Path<(String, String)>,
    query: web::Query<ProxyQuery>,
) -> HttpResponse {
    let (realm, name) = path.into_inner();
    let region = query.region.as_deref().unwrap_or("us");
    let namespace = format!("profile-{}", region);
    let realm_slug = realm.to_lowercase().replace("'", "").replace(" ", "-");

    let cache_key = format!(
        "char_equip_{}_{}_{}",
        region,
        realm_slug,
        name.to_lowercase()
    );
    if !query.refresh.unwrap_or(false) {
        if let Some(cached) = store.get_cache(&cache_key) {
            if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(&cached) {
                return HttpResponse::Ok().json(json_val);
            }
        }
    }

    let token = match get_effective_token(
        &req,
        &state,
        auth_state.as_ref().as_ref().map(|a| a.as_ref()),
        &***store,
    )
    .await
    {
        Some(t) => t,
        None => return HttpResponse::Unauthorized().finish(),
    };

    let url = format!(
        "https://{}.api.blizzard.com/profile/wow/character/{}/{}/equipment?namespace={}&locale=en_US",
        region,
        realm_slug,
        name.to_lowercase(),
        namespace
    );

    let res = state
        .client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await;

    match res {
        Ok(r) if r.status().is_success() => {
            let data: serde_json::Value = r.json().await.unwrap_or(serde_json::json!({}));
            store.set_cache(&cache_key, data.to_string());
            HttpResponse::Ok().json(data)
        }
        _ => HttpResponse::NotFound().finish(),
    }
}

pub async fn proxy_character_statistics(
    req: actix_web::HttpRequest,
    state: web::Data<Arc<BlizzardState>>,
    auth_state: web::Data<Option<Arc<BlizzardAuthState>>>,
    store: web::Data<Arc<dyn crate::storage::JobStorage>>,
    path: web::Path<(String, String)>,
    query: web::Query<ProxyQuery>,
) -> HttpResponse {
    let (realm, name) = path.into_inner();
    let region = query.region.as_deref().unwrap_or("us");
    let namespace = format!("profile-{}", region);
    let realm_slug = realm.to_lowercase().replace("'", "").replace(" ", "-");

    let cache_key = format!(
        "char_stats_{}_{}_{}",
        region,
        realm_slug,
        name.to_lowercase()
    );
    if !query.refresh.unwrap_or(false) {
        if let Some(cached) = store.get_cache(&cache_key) {
            if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(&cached) {
                return HttpResponse::Ok().json(json_val);
            }
        }
    }

    let token = match get_effective_token(
        &req,
        &state,
        auth_state.as_ref().as_ref().map(|a| a.as_ref()),
        &***store,
    )
    .await
    {
        Some(t) => t,
        None => return HttpResponse::Unauthorized().finish(),
    };

    let url = format!(
        "https://{}.api.blizzard.com/profile/wow/character/{}/{}/statistics?namespace={}&locale=en_US",
        region,
        realm_slug,
        name.to_lowercase(),
        namespace
    );

    let res = state
        .client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await;

    match res {
        Ok(r) if r.status().is_success() => {
            let data: serde_json::Value = r.json().await.unwrap_or(serde_json::json!({}));
            store.set_cache(&cache_key, data.to_string());
            HttpResponse::Ok().json(data)
        }
        _ => {
            println!("Blizzard API 404/Error for character statistics at {}", url);
            HttpResponse::Ok().json(serde_json::json!({}))
        }
    }
}

pub async fn proxy_character_specializations(
    req: actix_web::HttpRequest,
    state: web::Data<Arc<BlizzardState>>,
    auth_state: web::Data<Option<Arc<BlizzardAuthState>>>,
    store: web::Data<Arc<dyn crate::storage::JobStorage>>,
    path: web::Path<(String, String)>,
    query: web::Query<ProxyQuery>,
) -> HttpResponse {
    let (realm, name) = path.into_inner();
    let region = query.region.as_deref().unwrap_or("us");
    let namespace = format!("profile-{}", region);
    let realm_slug = realm.to_lowercase().replace("'", "").replace(" ", "-");

    let cache_key = format!(
        "char_specs_{}_{}_{}",
        region,
        realm_slug,
        name.to_lowercase()
    );
    if !query.refresh.unwrap_or(false) {
        if let Some(cached) = store.get_cache(&cache_key) {
            if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(&cached) {
                return HttpResponse::Ok().json(json_val);
            }
        }
    }

    let token = match get_effective_token(
        &req,
        &state,
        auth_state.as_ref().as_ref().map(|a| a.as_ref()),
        &***store,
    )
    .await
    {
        Some(t) => t,
        None => return HttpResponse::Unauthorized().finish(),
    };

    let url = format!(
        "https://{}.api.blizzard.com/profile/wow/character/{}/{}/specializations?namespace={}&locale=en_US",
        region,
        realm_slug,
        name.to_lowercase(),
        namespace
    );

    let res = state
        .client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await;

    match res {
        Ok(r) if r.status().is_success() => {
            let data: serde_json::Value = r.json().await.unwrap_or(serde_json::json!({}));
            store.set_cache(&cache_key, data.to_string());
            HttpResponse::Ok().json(data)
        }
        _ => {
            println!("Blizzard API 404/Error for specializations at {}", url);
            HttpResponse::Ok().json(serde_json::json!({}))
        }
    }
}
pub async fn proxy_character_professions(
    req: actix_web::HttpRequest,
    state: web::Data<Arc<BlizzardState>>,
    auth_state: web::Data<Option<Arc<BlizzardAuthState>>>,
    store: web::Data<Arc<dyn crate::storage::JobStorage>>,
    path: web::Path<(String, String)>,
    query: web::Query<ProxyQuery>,
) -> HttpResponse {
    let (realm, name) = path.into_inner();
    let region = query.region.as_deref().unwrap_or("us");
    let namespace = format!("profile-{}", region);
    let realm_slug = realm.to_lowercase().replace("'", "").replace(" ", "-");

    let cache_key = format!(
        "char_profs_{}_{}_{}",
        region,
        realm_slug,
        name.to_lowercase()
    );
    if !query.refresh.unwrap_or(false) {
        if let Some(cached) = store.get_cache(&cache_key) {
            if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(&cached) {
                return HttpResponse::Ok().json(json_val);
            }
        }
    }

    let token = match get_effective_token(
        &req,
        &state,
        auth_state.as_ref().as_ref().map(|a| a.as_ref()),
        &***store,
    )
    .await
    {
        Some(t) => t,
        None => return HttpResponse::Unauthorized().finish(),
    };

    let url = format!(
        "https://{}.api.blizzard.com/profile/wow/character/{}/{}/professions?namespace={}&locale=en_US",
        region,
        realm_slug,
        name.to_lowercase(),
        namespace
    );

    let res = state
        .client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await;

    match res {
        Ok(r) if r.status().is_success() => {
            let data: serde_json::Value = r.json().await.unwrap_or(serde_json::json!({}));
            store.set_cache(&cache_key, data.to_string());
            HttpResponse::Ok().json(data)
        }
        _ => HttpResponse::Ok().json(serde_json::json!({})),
    }
}
