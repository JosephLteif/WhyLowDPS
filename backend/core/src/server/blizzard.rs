use actix_web::{web, HttpResponse};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;
use reqwest::Client;

#[derive(Debug, Serialize, Deserialize, Clone)]
struct BlizzardToken {
    access_token: String,
    expires_in: u64,
}

pub struct BlizzardState {
    client_id: String,
    client_secret: String,
    client: Client,
    token: Mutex<Option<(String, Instant)>>,
}

impl BlizzardState {
    pub fn new(id: String, secret: String) -> Self {
        Self {
            client_id: id,
            client_secret: secret,
            client: Client::new(),
            token: Mutex::new(None),
        }
    }

    async fn get_token(&self) -> Option<String> {
        let mut token_lock = self.token.lock().await;

        if let Some((token, expiry)) = &*token_lock {
            if Instant::now() < *expiry {
                return Some(token.clone());
            }
        }

        // Fetch new token
        let res = self.client
            .post("https://oauth.battle.net/token")
            .basic_auth(&self.client_id, Some(&self.client_secret))
            .form(&[("grant_type", "client_credentials")])
            .send()
            .await
            .ok()?;

        if !res.status().is_success() {
            return None;
        }

        let data: BlizzardToken = res.json().await.ok()?;
        let expiry = Instant::now() + Duration::from_secs(data.expires_in.saturating_sub(60));
        *token_lock = Some((data.access_token.clone(), expiry));
        Some(data.access_token)
    }
}

pub async fn proxy_character_profile(
    state: web::Data<Arc<BlizzardState>>,
    path: web::Path<(String, String)>,
) -> HttpResponse {
    let (realm, name) = path.into_inner();
    let token = match state.get_token().await {
        Some(t) => t,
        None => return HttpResponse::Unauthorized().finish(),
    };

    let url = format!(
        "https://us.api.blizzard.com/profile/wow/character/{}/{}/status?namespace=profile-us&locale=en_US",
        realm.to_lowercase(),
        name.to_lowercase()
    );

    // Note: For now we proxy a simple status check or specific profile data.
    // If you need the full profile, use the base profile endpoint instead.
    let res = state.client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await;

    match res {
        Ok(r) if r.status().is_success() => {
            let data: serde_json::Value = r.json().await.unwrap_or(serde_json::json!({}));
            HttpResponse::Ok().json(data)
        }
        _ => HttpResponse::NotFound().finish(),
    }
}

pub async fn proxy_character_media(
    state: web::Data<Arc<BlizzardState>>,
    path: web::Path<(String, String, String)>,
) -> HttpResponse {
    let (realm, name, _type) = path.into_inner();
    let token = match state.get_token().await {
        Some(t) => t,
        None => return HttpResponse::Unauthorized().finish(),
    };

    let url = format!(
        "https://us.api.blizzard.com/profile/wow/character/{}/{}/character-media?namespace=profile-us&locale=en_US",
        realm.to_lowercase(),
        name.to_lowercase()
    );

    let res = state.client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await;

    match res {
        Ok(r) if r.status().is_success() => {
            let data: serde_json::Value = r.json().await.unwrap_or(serde_json::json!({}));
            // Extract the specific image URL based on type (render, inset, etc)
            if let Some(assets) = data.get("assets").and_then(|a| a.as_array()) {
                for asset in assets {
                    if let (Some(key), Some(value)) = (
                        asset.get("key").and_then(|v| v.as_str()),
                        asset.get("value").and_then(|v| v.as_str()),
                    ) {
                        if key == _type {
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
