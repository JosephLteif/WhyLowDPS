use actix_web::cookie::{Cookie, SameSite};
use actix_web::http::header;
use actix_web::{web, HttpRequest, HttpResponse};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
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
    pub sub: String, // BattleTag
    pub access_token: String,
    pub exp: usize,
}

#[derive(Deserialize)]
pub struct AuthCallbackQuery {
    pub code: String,
    pub state: String, // This is our flow_id
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
}

#[derive(Deserialize)]
struct UserInfoResponse {
    battletag: String,
}

#[derive(Deserialize)]
pub struct LoginQuery {
    pub client_id: Option<String>,
    pub client_secret: Option<String>,
    pub flow_id: Option<String>,
}
fn get_effective_creds(
    state: &BlizzardAuthState,
    store: &dyn crate::storage::JobStorage,
    query_id: Option<&String>,
    query_secret: Option<&String>,
) -> Option<(String, String)> {
    // 1. Try query params (temporary session use)
    if let (Some(id), Some(sec)) = (query_id, query_secret) {
        return Some((id.clone(), sec.clone()));
    }

    // 2. Try environment variables
    if let (Some(id), Some(sec)) = (&state.client_id, &state.client_secret) {
        return Some((id.clone(), sec.clone()));
    }

    // 3. Try "system" config in storage (saved via UI)
    if let (Some(id), Some(sec)) = (
        store.get_user_config("system", "blizzard_client_id"),
        store.get_user_config("system", "blizzard_client_secret"),
    ) {
        return Some((id, sec));
    }

    None
}

pub async fn get_credentials_status(
    state: web::Data<Arc<BlizzardAuthState>>,
    store: web::Data<Arc<dyn crate::storage::JobStorage>>,
) -> HttpResponse {
    let env_configured = state.client_id.is_some() && state.client_secret.is_some();
    let system_configured = store
        .get_user_config("system", "blizzard_client_id")
        .is_some()
        && store
            .get_user_config("system", "blizzard_client_secret")
            .is_some();

    HttpResponse::Ok().json(json!({
        "globally_configured": env_configured || system_configured
    }))
}

pub async fn bnet_login(
    state: web::Data<Arc<BlizzardAuthState>>,
    store: web::Data<Arc<dyn crate::storage::JobStorage>>,
    query: web::Query<LoginQuery>,
) -> HttpResponse {
    let creds = get_effective_creds(
        &state,
        &***store,
        query.client_id.as_ref(),
        query.client_secret.as_ref(),
    );

    let (client_id, _client_secret) = match creds {
        Some(c) => c,
        None => return HttpResponse::BadRequest().json(json!({
            "error": "Blizzard API Client ID not configured globally and not provided in request."
        })),
    };

    let mut builder = HttpResponse::Found();

    // If credentials were provided in query, set them as temporary cookies
    if let (Some(id), Some(sec)) = (&query.client_id, &query.client_secret) {
        builder.cookie(
            Cookie::build("temp_bnet_id", id)
                .path("/")
                .http_only(true)
                .secure(false) // Local dev
                .same_site(SameSite::Lax)
                .finish(),
        );
        builder.cookie(
            Cookie::build("temp_bnet_secret", sec)
                .path("/")
                .http_only(true)
                .secure(false) // Local dev
                .same_site(SameSite::Lax)
                .finish(),
        );
    }

    println!("Starting Blizzard Login for client_id: {}", client_id);
    println!("Target Redirect URI: {}", state.redirect_uri);

    let flow_id = query
        .flow_id
        .clone()
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    let auth_url = format!(
        "https://oauth.battle.net/authorize?client_id={}&redirect_uri={}&response_type=code&scope=wow.profile%20openid&state={}&prompt=login%20consent&max_age=0",
        client_id,
        urlencoding::encode(&state.redirect_uri),
        flow_id
    );

    println!("Final Blizzard Auth URL: {}", auth_url);

    builder.append_header((header::LOCATION, auth_url)).finish()
}

#[derive(Deserialize)]
pub struct PollQuery {
    pub flow_id: String,
}

pub async fn poll_login(
    query: web::Query<PollQuery>,
    store: web::Data<Arc<dyn crate::storage::JobStorage>>,
) -> HttpResponse {
    let cache_key = format!("login_flow_{}", query.flow_id);
    match store.get_cache(&cache_key) {
        Some(token) => {
            // Remove from cache after successful poll to clean up
            store.remove_cache(&cache_key);
            HttpResponse::Ok().json(json!({ "token": token }))
        }
        None => HttpResponse::NotFound().json(json!({ "status": "pending" })),
    }
}

pub async fn login_success() -> HttpResponse {
    let html = r#"
<!DOCTYPE html>
<html>
    <meta charset="UTF-8">
    <title>Login Successful - WhyLowDps</title>
    <style>
        body {
            background-color: #0c0c0e;
            color: white;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            text-align: center;
        }
        .container {
            background: rgba(255, 255, 255, 0.05);
            padding: 2rem;
            border-radius: 1rem;
            border: 1px solid rgba(255, 255, 255, 0.1);
            max-width: 400px;
        }
        .icon {
            width: 64px;
            height: 64px;
            background: linear-gradient(180deg, #ffd700, #b8860b);
            border-radius: 0.75rem;
            margin-bottom: 1.5rem;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            color: black;
            font-size: 2rem;
            box-shadow: 0 0 20px rgba(255, 215, 0, 0.2);
        }
        .icon svg {
            width: 32px;
            height: 32px;
            fill: none;
            stroke: currentColor;
            stroke-width: 3;
            stroke-linecap: round;
            stroke-linejoin: round;
        }
        h1 { margin-bottom: 0.5rem; font-size: 1.5rem; }
        p { color: #a1a1aa; line-height: 1.5; margin-bottom: 1.5rem; }
        .button {
            background: #0074e0;
            color: white;
            padding: 0.75rem 1.5rem;
            border-radius: 0.5rem;
            text-decoration: none;
            font-weight: 600;
            transition: background 0.2s;
        }
        .button:hover { background: #005fb8; }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">
            <svg viewBox="0 0 24 24">
                <path d="M5 13l4 4L19 7" />
            </svg>
        </div>
        <h1>Logged In Successfully!</h1>
        <p>Your Battle.net account has been linked. You can now close this window and return to the WhyLowDps app.</p>
        <p style="font-size: 0.8rem;">(This window will not close automatically for security reasons)</p>
    </div>
</body>
</html>
"#;
    HttpResponse::Ok().content_type("text/html").body(html)
}

pub async fn bnet_callback(
    req: HttpRequest,
    query: web::Query<AuthCallbackQuery>,
    state: web::Data<Arc<BlizzardAuthState>>,
    store: web::Data<Arc<dyn crate::storage::JobStorage>>,
) -> HttpResponse {
    let client = reqwest::Client::new();

    let creds = match (req.cookie("temp_bnet_id"), req.cookie("temp_bnet_secret")) {
        (Some(id_c), Some(sec_c)) => Some((id_c.value().to_string(), sec_c.value().to_string())),
        _ => get_effective_creds(&state, &***store, None, None),
    };

    let (client_id, client_secret) = match creds {
        Some(c) => c,
        None => {
            return HttpResponse::InternalServerError()
                .json(json!({"error": "Blizzard credentials not found."}))
        }
    };

    let token_resp = client
        .post("https://oauth.battle.net/token")
        .basic_auth(&client_id, Some(&client_secret))
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
                    return HttpResponse::InternalServerError()
                        .json(json!({"error": "Failed to parse token response", "details": text}));
                }
            }
        }
        Ok(res) => {
            let status = res.status();
            let text = res.text().await.unwrap_or_default();
            println!(
                "Token exchange failed with status: {}, body: {}",
                status, text
            );
            return HttpResponse::BadRequest()
                .json(json!({"error": "Failed to exchange code", "details": text}));
        }
        Err(e) => {
            println!("Network error during token exchange: {}", e);
            return HttpResponse::BadRequest()
                .json(json!({"error": "Network error during token exchange"}));
        }
    };

    let user_resp = client
        .get("https://oauth.battle.net/oauth/userinfo")
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
                    return HttpResponse::InternalServerError().json(
                        json!({"error": "Failed to parse userinfo response", "details": text}),
                    );
                }
            }
        }
        Ok(res) => {
            let status = res.status();
            let text = res.text().await.unwrap_or_default();
            println!(
                "Userinfo fetch failed with status: {}, body: {}",
                status, text
            );
            return HttpResponse::BadRequest()
                .json(json!({"error": "Failed to get userinfo", "details": text}));
        }
        Err(e) => {
            println!("Network error during userinfo fetch: {}", e);
            return HttpResponse::BadRequest()
                .json(json!({"error": "Network error during userinfo fetch"}));
        }
    };

    let expiration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as usize
        + (30 * 24 * 60 * 60); // 30 days

    let claims = Claims {
        sub: battletag.clone(),
        access_token,
        exp: expiration,
    };

    let token = match encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(state.jwt_secret.as_bytes()),
    ) {
        Ok(t) => t,
        Err(e) => {
            println!("Failed to generate JWT token: {}", e);
            return HttpResponse::InternalServerError()
                .json(json!({"error": "Failed to generate token"}));
        }
    };

    let same_site = if cfg!(feature = "desktop") {
        SameSite::None
    } else {
        SameSite::Lax
    };
    let secure = cfg!(feature = "desktop");

    let cookie = Cookie::build("bnet_session", token.clone())
        .path("/")
        .http_only(true)
        .secure(secure)
        .same_site(same_site)
        .max_age(actix_web::cookie::time::Duration::days(30))
        .finish();

    let redirect_url = "/api/auth/bnet/login-success";

    let mut resp_builder = HttpResponse::Found();
    resp_builder.append_header((header::LOCATION, redirect_url)); // Redirect to success page
    resp_builder.cookie(cookie);

    // Store token in cache for polling (handoff to desktop app)
    let flow_id = query.state.clone();
    let cache_key = format!("login_flow_{}", flow_id);
    store.set_cache(&cache_key, token);

    // If we used temporary credentials, save them to the user's permanent config
    if state.client_id.is_none() {
        store.set_user_config(&battletag, "blizzard_client_id", &client_id);
        store.set_user_config(&battletag, "blizzard_client_secret", &client_secret);

        // Clear temporary cookies
        resp_builder.cookie(
            Cookie::build("temp_bnet_id", "")
                .path("/")
                .max_age(actix_web::cookie::time::Duration::seconds(0))
                .finish(),
        );
        resp_builder.cookie(
            Cookie::build("temp_bnet_secret", "")
                .path("/")
                .max_age(actix_web::cookie::time::Duration::seconds(0))
                .finish(),
        );
    }

    resp_builder.finish()
}

pub fn verify_jwt(req: &HttpRequest, secret: &str) -> Option<Claims> {
    let token = if let Some(cookie) = req.cookie("bnet_session") {
        cookie.value().to_string()
    } else if let Some(auth_header) = req.headers().get(header::AUTHORIZATION) {
        let auth_str = auth_header.to_str().unwrap_or_default();
        if let Some(stripped) = auth_str.strip_prefix("Bearer ") {
            stripped.to_string()
        } else {
            return None;
        }
    } else {
        println!(
            "No auth found in request (cookie or Authorization header). headers: {:?}",
            req.headers()
        );
        return None;
    };

    let token_data = decode::<Claims>(
        &token,
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
    println!("get_me called. Headers: {:?}", req.headers());
    if let Some(cookie) = req.cookie("bnet_session") {
        println!("Found bnet_session cookie: {}", cookie.value());
    } else {
        println!("No bnet_session cookie found.");
    }

    match verify_jwt(&req, &state.jwt_secret) {
        Some(claims) => {
            println!("get_me success: {}", claims.sub);
            HttpResponse::Ok().json(json!({
                "battletag": claims.sub
            }))
        }
        None => {
            println!("get_me failed: not logged in or invalid token");
            HttpResponse::Unauthorized().json(json!({"error": "Not logged in"}))
        }
    }
}

pub async fn bnet_logout(
    req: HttpRequest,
    state: web::Data<Arc<BlizzardAuthState>>,
    store: web::Data<Arc<dyn crate::storage::JobStorage>>,
) -> HttpResponse {
    if let Some(claims) = verify_jwt(&req, &state.jwt_secret) {
        store.remove_user_config(&claims.sub, "blizzard_client_id");
        store.remove_user_config(&claims.sub, "blizzard_client_secret");
    }

    // Also clear system-level credentials if they were set via the UI
    store.remove_user_config("system", "blizzard_client_id");
    store.remove_user_config("system", "blizzard_client_secret");

    let same_site = if cfg!(feature = "desktop") {
        SameSite::None
    } else {
        SameSite::Lax
    };
    let secure = cfg!(feature = "desktop");

    let cookie = Cookie::build("bnet_session", "")
        .path("/")
        .http_only(true)
        .secure(secure)
        .same_site(same_site)
        .max_age(actix_web::cookie::time::Duration::seconds(0))
        .finish();

    let temp_id = Cookie::build("temp_bnet_id", "")
        .path("/")
        .max_age(actix_web::cookie::time::Duration::seconds(0))
        .finish();

    let temp_sec = Cookie::build("temp_bnet_secret", "")
        .path("/")
        .max_age(actix_web::cookie::time::Duration::seconds(0))
        .finish();

    HttpResponse::Ok()
        .cookie(cookie)
        .cookie(temp_id)
        .cookie(temp_sec)
        .json(json!({"status": "success"}))
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
    let regions = [("us", "profile-us"), ("eu", "profile-eu")];

    let mut all_characters = vec![];
    let mut last_error = None;

    for (region, namespace) in regions {
        let url = format!(
            "https://{}.api.blizzard.com/profile/user/wow?namespace={}&locale=en_US",
            region, namespace
        );
        let resp = client
            .get(&url)
            .bearer_auth(&claims.access_token)
            .send()
            .await;

        match resp {
            Ok(res) if res.status().is_success() => {
                if let Ok(data) = res.json::<serde_json::Value>().await {
                    if let Some(wow_accounts) = data.get("wow_accounts").and_then(|v| v.as_array())
                    {
                        for account in wow_accounts {
                            if let Some(chars) =
                                account.get("characters").and_then(|v| v.as_array())
                            {
                                for char_data in chars {
                                    let name = char_data
                                        .get("name")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("Unknown");
                                    let realm_name = char_data
                                        .get("realm")
                                        .and_then(|v| v.get("name"))
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("Unknown");
                                    let realm_slug = char_data
                                        .get("realm")
                                        .and_then(|v| v.get("slug"))
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("unknown");
                                    let class = char_data
                                        .get("playable_class")
                                        .and_then(|v| v.get("name"))
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("Unknown");
                                    let race = char_data
                                        .get("playable_race")
                                        .and_then(|v| v.get("name"))
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("Unknown");
                                    let faction = char_data
                                        .get("faction")
                                        .and_then(|v| v.get("name"))
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("Unknown");
                                    let level = char_data
                                        .get("level")
                                        .and_then(|v| v.as_u64())
                                        .unwrap_or(0);

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
            }
            Ok(res) => {
                if res.status() != reqwest::StatusCode::NOT_FOUND {
                    last_error = Some(format!("Blizzard {} API error: {}", region, res.status()));
                }
            }
            Err(e) => {
                last_error = Some(format!(
                    "Network error fetching {} characters: {}",
                    region, e
                ));
            }
        }
    }

    if all_characters.is_empty() {
        if let Some(err) = last_error {
            return HttpResponse::InternalServerError().json(json!({"error": err}));
        }
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

    let client_id = store
        .get_user_config(&claims.sub, "blizzard_client_id")
        .unwrap_or_default();
    let has_secret = store
        .get_user_config(&claims.sub, "blizzard_client_secret")
        .is_some();
    let sim_threads = store
        .get_user_config(&claims.sub, "sim_threads")
        .unwrap_or_default();
    let max_gear_combinations = store
        .get_user_config(&claims.sub, "max_gear_combinations")
        .unwrap_or_default();
    let simc_download_channel = store
        .get_user_config(&claims.sub, "simc_download_channel")
        .unwrap_or_default();
    let simc_sim_channel = store
        .get_user_config(&claims.sub, "simc_sim_channel")
        .unwrap_or_default();
    let app_update_channel = store
        .get_user_config(&claims.sub, "app_update_channel")
        .unwrap_or_default();

    HttpResponse::Ok().json(json!({
        "blizzard_client_id": client_id,
        "has_blizzard_client_secret": has_secret,
        "sim_threads": sim_threads,
        "max_gear_combinations": max_gear_combinations,
        "simc_download_channel": simc_download_channel,
        "simc_sim_channel": simc_sim_channel,
        "app_update_channel": app_update_channel,
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

    if body.key != "blizzard_client_id"
        && body.key != "blizzard_client_secret"
        && body.key != "sim_threads"
        && body.key != "max_gear_combinations"
        && body.key != "simc_download_channel"
        && body.key != "simc_sim_channel"
        && body.key != "app_update_channel"
    {
        return HttpResponse::BadRequest().json(json!({"error": "Invalid config key"}));
    }

    store.set_user_config(&claims.sub, &body.key, &body.value);

    HttpResponse::Ok().json(json!({"status": "updated"}))
}

#[derive(Deserialize)]
pub struct SystemConfigUpdate {
    pub client_id: String,
    pub client_secret: String,
}

pub async fn set_system_blizzard_creds(
    store: web::Data<Arc<dyn crate::storage::JobStorage>>,
    body: web::Json<SystemConfigUpdate>,
) -> HttpResponse {
    store.set_user_config("system", "blizzard_client_id", &body.client_id);
    store.set_user_config("system", "blizzard_client_secret", &body.client_secret);

    HttpResponse::Ok().json(json!({"status": "system credentials updated"}))
}

pub async fn clear_user_configs(
    req: HttpRequest,
    state: web::Data<Arc<BlizzardAuthState>>,
    store: web::Data<Arc<dyn crate::storage::JobStorage>>,
) -> HttpResponse {
    let claims = match verify_jwt(&req, &state.jwt_secret) {
        Some(c) => c,
        None => return HttpResponse::Unauthorized().json(json!({"error": "Not logged in"})),
    };

    store.remove_user_config(&claims.sub, "blizzard_client_id");
    store.remove_user_config(&claims.sub, "blizzard_client_secret");

    HttpResponse::Ok().json(json!({"status": "cleared"}))
}

#[derive(Deserialize)]
pub struct TestBlizzardCreds {
    pub client_id: String,
    pub client_secret: Option<String>,
}

pub async fn test_blizzard_creds(
    req: HttpRequest,
    state: web::Data<Arc<BlizzardAuthState>>,
    store: web::Data<Arc<dyn crate::storage::JobStorage>>,
    body: web::Json<TestBlizzardCreds>,
) -> HttpResponse {
    let client_id = body.client_id.trim().to_string();
    if client_id.is_empty() {
        return HttpResponse::BadRequest()
            .json(json!({"status": "error", "message": "Missing client_id"}));
    }

    let client_secret = body
        .client_secret
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| {
            let claims = verify_jwt(&req, &state.jwt_secret)?;
            store.get_user_config(&claims.sub, "blizzard_client_secret")
        });

    let client_secret = match client_secret {
        Some(v) => v,
        None => {
            return HttpResponse::BadRequest().json(json!({
                "status": "error",
                "message": "Missing client_secret and no saved secret found"
            }));
        }
    };

    let client = reqwest::Client::new();
    let res = crate::server::blizzard::BlizzardState::get_token_with_creds(
        &client,
        &client_id,
        &client_secret,
    )
    .await;

    if res.is_some() {
        HttpResponse::Ok().json(json!({"status": "success"}))
    } else {
        HttpResponse::BadRequest()
            .json(json!({"status": "error", "message": "Failed to authenticate with Blizzard"}))
    }
}
