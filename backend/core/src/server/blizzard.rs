use crate::server::auth_handlers::{verify_jwt, BlizzardAuthState};
use actix_web::{web, HttpResponse};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
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

#[derive(Serialize, Deserialize)]
struct RealmEntry {
    slug: String,
    name: String,
}

#[derive(Serialize, Deserialize)]
struct RealmsResponse {
    region: String,
    realms: Vec<RealmEntry>,
}

fn parse_character_path_from_url(url: &str) -> Option<(String, String, String)> {
    let after_character = url.split("/character/").nth(1)?;
    let clean = after_character
        .split('?')
        .next()
        .unwrap_or(after_character)
        .split('#')
        .next()
        .unwrap_or(after_character);
    let parts: Vec<&str> = clean.split('/').filter(|p| !p.is_empty()).collect();
    if parts.len() < 3 {
        return None;
    }
    Some((
        parts[0].to_lowercase(),
        parts[1].to_lowercase(),
        parts[2].to_lowercase(),
    ))
}

fn enrich_member_with_profile_link(member: &mut Map<String, Value>) {
    let profile_url = member
        .get("profile")
        .and_then(|p| p.get("url"))
        .and_then(Value::as_str)
        .or_else(|| {
            member
                .get("character")
                .and_then(|c| c.get("url"))
                .and_then(Value::as_str)
        })
        .or_else(|| member.get("url").and_then(Value::as_str));

    let Some(url) = profile_url else { return };
    let url_owned = url.to_string();

    let Some((region, realm, name)) = parse_character_path_from_url(url) else {
        return;
    };

    member
        .entry("linked_region".to_string())
        .or_insert_with(|| Value::String(region.clone()));
    member
        .entry("linked_realm".to_string())
        .or_insert_with(|| Value::String(realm.clone()));
    member
        .entry("linked_name".to_string())
        .or_insert_with(|| Value::String(name.clone()));
    member
        .entry("linked_profile_url".to_string())
        .or_insert_with(|| Value::String(url_owned.clone()));

    if let Some(profile_obj) = member.get_mut("profile").and_then(Value::as_object_mut) {
        profile_obj
            .entry("region".to_string())
            .or_insert_with(|| Value::String(region.clone()));
        profile_obj
            .entry("name".to_string())
            .or_insert_with(|| Value::String(name.clone()));
        let realm_obj = profile_obj
            .entry("realm".to_string())
            .or_insert_with(|| Value::Object(Map::new()));
        if let Some(realm_map) = realm_obj.as_object_mut() {
            realm_map
                .entry("slug".to_string())
                .or_insert_with(|| Value::String(realm));
        }
    }
}

fn enrich_mythic_profile_member_links(value: &mut Value) {
    match value {
        Value::Array(arr) => {
            for item in arr {
                enrich_mythic_profile_member_links(item);
            }
        }
        Value::Object(obj) => {
            if let Some(Value::Array(members)) = obj.get_mut("members") {
                for member in members {
                    if let Some(member_obj) = member.as_object_mut() {
                        enrich_member_with_profile_link(member_obj);
                    }
                }
            }
            for nested in obj.values_mut() {
                enrich_mythic_profile_member_links(nested);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_character_path_from_url, BlizzardState};
    use crate::server::auth_handlers::BlizzardAuthState;
    use crate::storage::{JobStorage, MemoryStorage};
    use actix_web::test::TestRequest;

    #[test]
    fn parse_character_path_from_url_extracts_region_realm_name() {
        let url = "https://worldofwarcraft.blizzard.com/en-us/character/us/illidan/tester?foo=bar";
        let parsed = parse_character_path_from_url(url);
        assert_eq!(
            parsed,
            Some(("us".to_string(), "illidan".to_string(), "tester".to_string()))
        );
    }

    #[test]
    fn get_effective_credentials_prefers_system_over_global() {
        let req = TestRequest::default().to_http_request();
        let store = MemoryStorage::new();
        store.set_user_config("system", "blizzard_client_id", "system-id");
        store.set_user_config("system", "blizzard_client_secret", "system-secret");

        let auth = BlizzardAuthState::new(
            Some("global-id".to_string()),
            Some("global-secret".to_string()),
            "http://localhost/callback".to_string(),
            "jwt-secret".to_string(),
        );

        let creds = BlizzardState::get_effective_credentials(&req, Some(&auth), &store);
        assert_eq!(
            creds,
            Some(("system-id".to_string(), "system-secret".to_string()))
        );
    }

    #[test]
    fn get_effective_credentials_falls_back_to_global_when_no_system() {
        let req = TestRequest::default().to_http_request();
        let store = MemoryStorage::new();
        let auth = BlizzardAuthState::new(
            Some("global-id".to_string()),
            Some("global-secret".to_string()),
            "http://localhost/callback".to_string(),
            "jwt-secret".to_string(),
        );

        let creds = BlizzardState::get_effective_credentials(&req, Some(&auth), &store);
        assert_eq!(
            creds,
            Some(("global-id".to_string(), "global-secret".to_string()))
        );
    }
}

async fn proxy_blizzard_data_url(
    req: &actix_web::HttpRequest,
    state: &web::Data<Arc<BlizzardState>>,
    auth_state: &web::Data<Option<Arc<BlizzardAuthState>>>,
    store: &web::Data<Arc<dyn crate::storage::JobStorage>>,
    cache_key: &str,
    url: &str,
    refresh: bool,
) -> HttpResponse {
    if !refresh {
        if let Some(cached) = store.get_cache(cache_key) {
            if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(&cached) {
                return HttpResponse::Ok().json(json_val);
            }
        }
    }

    let token = match get_effective_token(
        req,
        state,
        auth_state.as_ref().as_ref().map(|a| a.as_ref()),
        store.get_ref().as_ref(),
    )
    .await
    {
        Some(t) => t,
        None => return HttpResponse::Unauthorized().finish(),
    };

    let res = state
        .client
        .get(url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await;

    match res {
        Ok(r) if r.status().is_success() => {
            let data: serde_json::Value = r.json().await.unwrap_or(serde_json::json!({}));
            store.set_cache(cache_key, data.to_string());
            HttpResponse::Ok().json(data)
        }
        _ => HttpResponse::Ok().json(serde_json::json!({})),
    }
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
            let mut data: serde_json::Value = r.json().await.unwrap_or(serde_json::json!({}));
            enrich_mythic_profile_member_links(&mut data);
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

pub async fn proxy_character_mythic_keystone_profile(
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
        "char_mplus_{}_{}_{}",
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
        "https://{}.api.blizzard.com/profile/wow/character/{}/{}/mythic-keystone-profile?namespace={}&locale=en_US",
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

pub async fn proxy_character_raid_encounters(
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
        "char_raid_prog_{}_{}_{}",
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
        "https://{}.api.blizzard.com/profile/wow/character/{}/{}/encounters/raids?namespace={}&locale=en_US",
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

pub async fn proxy_mythic_keystone_dungeon_index(
    req: actix_web::HttpRequest,
    state: web::Data<Arc<BlizzardState>>,
    auth_state: web::Data<Option<Arc<BlizzardAuthState>>>,
    store: web::Data<Arc<dyn crate::storage::JobStorage>>,
    query: web::Query<ProxyQuery>,
) -> HttpResponse {
    let region = query.region.as_deref().unwrap_or("us");
    let refresh = query.refresh.unwrap_or(false);
    let cache_key = format!("mplus_dungeon_index_{}", region);
    let url = format!(
        "https://{}.api.blizzard.com/data/wow/mythic-keystone/dungeon/index?namespace=dynamic-{}&locale=en_US",
        region, region
    );

    proxy_blizzard_data_url(&req, &state, &auth_state, &store, &cache_key, &url, refresh).await
}

pub async fn proxy_mythic_keystone_dungeon_detail(
    req: actix_web::HttpRequest,
    state: web::Data<Arc<BlizzardState>>,
    auth_state: web::Data<Option<Arc<BlizzardAuthState>>>,
    store: web::Data<Arc<dyn crate::storage::JobStorage>>,
    path: web::Path<u64>,
    query: web::Query<ProxyQuery>,
) -> HttpResponse {
    let dungeon_id = path.into_inner();
    let region = query.region.as_deref().unwrap_or("us");
    let refresh = query.refresh.unwrap_or(false);
    let cache_key = format!("mplus_dungeon_detail_{}_{}", region, dungeon_id);
    let url = format!(
        "https://{}.api.blizzard.com/data/wow/mythic-keystone/dungeon/{}?namespace=dynamic-{}&locale=en_US",
        region, dungeon_id, region
    );

    proxy_blizzard_data_url(&req, &state, &auth_state, &store, &cache_key, &url, refresh).await
}

pub async fn proxy_realms_index(
    req: actix_web::HttpRequest,
    state: web::Data<Arc<BlizzardState>>,
    auth_state: web::Data<Option<Arc<BlizzardAuthState>>>,
    store: web::Data<Arc<dyn crate::storage::JobStorage>>,
    query: web::Query<ProxyQuery>,
) -> HttpResponse {
    let region = query.region.as_deref().unwrap_or("us").to_lowercase();
    let refresh = query.refresh.unwrap_or(false);
    let cache_key = format!("realms_index_{}", region);

    if !refresh {
        if let Some(cached) = store.get_cache(&cache_key) {
            if let Ok(json_val) = serde_json::from_str::<RealmsResponse>(&cached) {
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
        "https://{}.api.blizzard.com/data/wow/realm/index?namespace=dynamic-{}&locale=en_US",
        region, region
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
            let mut realms: Vec<RealmEntry> = data
                .get("realms")
                .and_then(|v| v.as_array())
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|item| {
                            let slug = item.get("slug").and_then(|v| v.as_str())?.to_string();
                            let name = item
                                .get("name")
                                .and_then(|v| v.as_str())
                                .map(str::to_string)
                                .unwrap_or_else(|| slug.clone());
                            Some(RealmEntry { slug, name })
                        })
                        .collect()
                })
                .unwrap_or_default();
            realms.sort_by(|a, b| a.name.cmp(&b.name));
            let payload = RealmsResponse { region, realms };
            store.set_cache(
                &cache_key,
                serde_json::to_string(&payload).unwrap_or_default(),
            );
            HttpResponse::Ok().json(payload)
        }
        _ => HttpResponse::Ok().json(RealmsResponse {
            region,
            realms: Vec::new(),
        }),
    }
}
