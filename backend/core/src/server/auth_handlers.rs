use actix_web::cookie::{Cookie, SameSite};
use actix_web::http::header;
use actix_web::{web, HttpRequest, HttpResponse};
use jsonwebtoken::{encode, decode, Header, Validation, EncodingKey, DecodingKey};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

pub struct BlizzardAuthState {
    pub client_id: Option<String>,
    pub client_secret: Option<String>,
    pub redirect_uri: String,
    pub jwt_secret: String,
}

impl BlizzardAuthState {
    pub fn new(
        client_id: Option<String>,
        client_secret: Option<String>,
        redirect_uri: String,
        jwt_secret: String,
    ) -> Self {
        Self {
            client_id,
            client_secret,
            redirect_uri,
            jwt_secret,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,         // BattleTag
    pub access_token: String,
    pub exp: usize,
}

#[derive(Deserialize)]
pub struct AuthCallbackQuery {
    pub code: String,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
}

#[derive(Deserialize)]
struct UserInfoResponse {
    battletag: String,
}

pub async fn bnet_login(state: web::Data<Arc<BlizzardAuthState>>) -> HttpResponse {
    let client_id = match &state.client_id {
        Some(id) => id,
        None => return HttpResponse::InternalServerError().json(json!({"error": "Blizzard API Client ID not configured globally."})),
    };

    let auth_url = format!(
        "https://oauth.battle.net/authorize?client_id={}&redirect_uri={}&response_type=code&scope=wow.profile&state={}",
        client_id,
        urlencoding::encode(&state.redirect_uri),
        uuid::Uuid::new_v4()
    );
    HttpResponse::Found()
        .append_header((header::LOCATION, auth_url))
        .finish()
}

pub async fn bnet_callback(
    query: web::Query<AuthCallbackQuery>,
    state: web::Data<Arc<BlizzardAuthState>>,
) -> HttpResponse {
    let client = reqwest::Client::new();
    
    let (client_id, client_secret) = match (&state.client_id, &state.client_secret) {
        (Some(id), Some(sec)) => (id, sec),
        _ => return HttpResponse::InternalServerError().json(json!({"error": "Global Blizzard credentials not configured."})),
    };

    let token_resp = client.post("https://oauth.battle.net/token")
        .basic_auth(client_id, Some(client_secret))
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", &query.code),
            ("redirect_uri", &state.redirect_uri),
        ])
        .send()
        .await;

    let access_token = match token_resp {
        Ok(res) if res.status().is_success() => {
            let text = res.text().await.unwrap_or_default();
            match serde_json::from_str::<TokenResponse>(&text) {
                Ok(data) => data.access_token,
                Err(e) => {
                    println!("Failed to parse token response: {}, raw: {}", e, text);
                    return HttpResponse::InternalServerError().json(json!({"error": "Failed to parse token response", "details": text}))
                }
            }
        },
        Ok(res) => {
            let status = res.status();
            let text = res.text().await.unwrap_or_default();
            println!("Token exchange failed with status: {}, body: {}", status, text);
            return HttpResponse::BadRequest().json(json!({"error": "Failed to exchange code", "details": text}))
        },
        Err(e) => {
            println!("Network error during token exchange: {}", e);
            return HttpResponse::BadRequest().json(json!({"error": "Network error during token exchange"}))
        }
    };

    let user_resp = client.get("https://oauth.battle.net/oauth/userinfo")
        .bearer_auth(&access_token)
        .send()
        .await;

    let battletag = match user_resp {
        Ok(res) if res.status().is_success() => {
            let text = res.text().await.unwrap_or_default();
            match serde_json::from_str::<UserInfoResponse>(&text) {
                Ok(data) => data.battletag,
                Err(e) => {
                    println!("Failed to parse userinfo response: {}, raw: {}", e, text);
                    return HttpResponse::InternalServerError().json(json!({"error": "Failed to parse userinfo response", "details": text}))
                }
            }
        },
        Ok(res) => {
            let status = res.status();
            let text = res.text().await.unwrap_or_default();
            println!("Userinfo fetch failed with status: {}, body: {}", status, text);
            return HttpResponse::BadRequest().json(json!({"error": "Failed to get userinfo", "details": text}))
        },
        Err(e) => {
            println!("Network error during userinfo fetch: {}", e);
            return HttpResponse::BadRequest().json(json!({"error": "Network error during userinfo fetch"}))
        }
    };

    let expiration = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as usize + (30 * 24 * 60 * 60); // 30 days

    let claims = Claims {
        sub: battletag,
        access_token,
        exp: expiration,
    };

    let token = match encode(&Header::default(), &claims, &EncodingKey::from_secret(state.jwt_secret.as_bytes())) {
        Ok(t) => t,
        Err(e) => {
            println!("Failed to generate JWT token: {}", e);
            return HttpResponse::InternalServerError().json(json!({"error": "Failed to generate token"}))
        }
    };

    let cookie = Cookie::build("bnet_session", token)
        .path("/")
        .http_only(true)
        .secure(false) // Set to false for local dev without HTTPS
        .same_site(SameSite::Lax)
        .max_age(actix_web::cookie::time::Duration::days(30))
        .finish();

    HttpResponse::Found()
        .append_header((header::LOCATION, "/characters")) // Redirect to characters page after login
        .cookie(cookie)
        .finish()
}

pub fn verify_jwt(req: &HttpRequest, secret: &str) -> Option<Claims> {
    let cookie = req.cookie("bnet_session");
    if cookie.is_none() {
        println!("No bnet_session cookie found in request headers: {:?}", req.headers());
        return None;
    }
    let cookie = cookie.unwrap();
    let token = cookie.value();
    
    let token_data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    );

    match token_data {
        Ok(data) => Some(data.claims),
        Err(e) => {
            println!("Failed to decode JWT: {}", e);
            None
        }
    }
}

pub async fn get_me(req: HttpRequest, state: web::Data<Arc<BlizzardAuthState>>) -> HttpResponse {
    println!("get_me called, checking auth...");
    match verify_jwt(&req, &state.jwt_secret) {
        Some(claims) => {
            println!("get_me success: {}", claims.sub);
            HttpResponse::Ok().json(json!({
                "battletag": claims.sub
            }))
        },
        None => {
            println!("get_me failed: not logged in or invalid token");
            HttpResponse::Unauthorized().json(json!({"error": "Not logged in"}))
        }
    }
}

pub async fn bnet_logout() -> HttpResponse {
    let cookie = Cookie::build("bnet_session", "")
        .path("/")
        .http_only(true)
        .secure(false)
        .same_site(SameSite::Lax)
        .max_age(actix_web::cookie::time::Duration::seconds(0))
        .finish();

    HttpResponse::Ok()
        .cookie(cookie)
        .json(json!({"status": "logged_out"}))
}

#[derive(Deserialize)]
pub struct RefreshQuery {
    pub refresh: Option<bool>,
}

pub async fn get_characters(
    req: HttpRequest, 
    state: web::Data<Arc<BlizzardAuthState>>,
    store: web::Data<Arc<dyn crate::storage::JobStorage>>,
    query: web::Query<RefreshQuery>,
) -> HttpResponse {
    let claims = match verify_jwt(&req, &state.jwt_secret) {
        Some(c) => c,
        None => return HttpResponse::Unauthorized().json(json!({"error": "Not logged in"})),
    };

    let cache_key = format!("user_characters_{}", claims.sub);
    
    if !query.refresh.unwrap_or(false) {
        if let Some(cached_data) = store.get_cache(&cache_key) {
            if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(&cached_data) {
                return HttpResponse::Ok().json(json_val);
            }
        }
    }

    let client = reqwest::Client::new();
    
    // We attempt to fetch from both US and EU regions as we don't know the user's primary region
    let regions = [
        ("us", "profile-us"),
        ("eu", "profile-eu"),
    ];

    let mut all_characters = vec![];
    let mut last_error = None;

    for (region, namespace) in regions {
        let url = format!("https://{}.api.blizzard.com/profile/user/wow?namespace={}&locale=en_US", region, namespace);
        let resp = client.get(&url)
            .bearer_auth(&claims.access_token)
            .send()
            .await;

        match resp {
            Ok(res) if res.status().is_success() => {
                if let Ok(data) = res.json::<serde_json::Value>().await {
                    if let Some(wow_accounts) = data.get("wow_accounts").and_then(|v| v.as_array()) {
                        for account in wow_accounts {
                            if let Some(chars) = account.get("characters").and_then(|v| v.as_array()) {
                                for char_data in chars {
                                    let name = char_data.get("name").and_then(|v| v.as_str()).unwrap_or("Unknown");
                                    let realm_name = char_data.get("realm").and_then(|v| v.get("name")).and_then(|v| v.as_str()).unwrap_or("Unknown");
                                    let realm_slug = char_data.get("realm").and_then(|v| v.get("slug")).and_then(|v| v.as_str()).unwrap_or("unknown");
                                    let class = char_data.get("playable_class").and_then(|v| v.get("name")).and_then(|v| v.as_str()).unwrap_or("Unknown");
                                    let race = char_data.get("playable_race").and_then(|v| v.get("name")).and_then(|v| v.as_str()).unwrap_or("Unknown");
                                    let faction = char_data.get("faction").and_then(|v| v.get("name")).and_then(|v| v.as_str()).unwrap_or("Unknown");
                                    let level = char_data.get("level").and_then(|v| v.as_u64()).unwrap_or(0);
                                    
                                    all_characters.push(json!({
                                        "name": name,
                                        "realm": realm_slug,
                                        "realm_name": realm_name,
                                        "region": region,
                                        "class": class,
                                        "race": race,
                                        "faction": faction,
                                        "level": level,
                                        "mode": region.to_uppercase(),
                                    }));
                                }
                            }
                        }
                    }
                }
            },
            Ok(res) => {
                if res.status() != reqwest::StatusCode::NOT_FOUND {
                    last_error = Some(format!("Blizzard {} API error: {}", region, res.status()));
                }
            },
            Err(e) => {
                last_error = Some(format!("Network error fetching {} characters: {}", region, e));
            }
        }
    }

    if all_characters.is_empty() && last_error.is_some() {
        return HttpResponse::InternalServerError().json(json!({"error": last_error.unwrap()}));
    }

    let json_resp = json!({
        "characters": all_characters
    });

    store.set_cache(&cache_key, json_resp.to_string());

    HttpResponse::Ok().json(json_resp)
}

#[derive(Deserialize)]
pub struct UserConfigUpdate {
    pub key: String,
    pub value: String,
}

pub async fn get_user_configs(
    req: HttpRequest,
    state: web::Data<Arc<BlizzardAuthState>>,
    store: web::Data<Arc<dyn crate::storage::JobStorage>>,
) -> HttpResponse {
    let claims = match verify_jwt(&req, &state.jwt_secret) {
        Some(c) => c,
        None => return HttpResponse::Unauthorized().json(json!({"error": "Not logged in"})),
    };

    let client_id = store.get_user_config(&claims.sub, "blizzard_client_id").unwrap_or_default();
    let has_secret = store.get_user_config(&claims.sub, "blizzard_client_secret").is_some();

    HttpResponse::Ok().json(json!({
        "blizzard_client_id": client_id,
        "has_blizzard_client_secret": has_secret,
    }))
}

pub async fn set_user_config(
    req: HttpRequest,
    state: web::Data<Arc<BlizzardAuthState>>,
    store: web::Data<Arc<dyn crate::storage::JobStorage>>,
    body: web::Json<UserConfigUpdate>,
) -> HttpResponse {
    let claims = match verify_jwt(&req, &state.jwt_secret) {
        Some(c) => c,
        None => return HttpResponse::Unauthorized().json(json!({"error": "Not logged in"})),
    };

    if body.key != "blizzard_client_id" && body.key != "blizzard_client_secret" {
        return HttpResponse::BadRequest().json(json!({"error": "Invalid config key"}));
    }

    store.set_user_config(&claims.sub, &body.key, &body.value);

    HttpResponse::Ok().json(json!({"status": "updated"}))
}

#[derive(Deserialize)]
pub struct TestBlizzardCreds {
    pub client_id: String,
    pub client_secret: String,
}

pub async fn test_blizzard_creds(
    body: web::Json<TestBlizzardCreds>,
) -> HttpResponse {
    let client = reqwest::Client::new();
    let res = crate::server::blizzard::BlizzardState::get_token_with_creds(&client, &body.client_id, &body.client_secret).await;
    
    if res.is_some() {
        HttpResponse::Ok().json(json!({"status": "success"}))
    } else {
        HttpResponse::BadRequest().json(json!({"status": "error", "message": "Failed to authenticate with Blizzard"}))
    }
}

