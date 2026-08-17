use actix_web::cookie::{Cookie, SameSite};
use actix_web::http::header;
use actix_web::{web, HttpRequest, HttpResponse};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

const PAIRING_TOKEN_TTL: Duration = Duration::from_secs(5 * 60);
const ACCESS_TOKEN_TTL: Duration = Duration::from_secs(24 * 60 * 60);

#[derive(Debug)]
struct PendingPairing {
    bnet_session: Option<String>,
    expires_at: Instant,
}

#[derive(Debug)]
pub struct LanAccessState {
    pending: Mutex<HashMap<String, PendingPairing>>,
    active: Mutex<HashMap<String, Instant>>,
}

impl LanAccessState {
    pub fn new() -> Self {
        Self {
            pending: Mutex::new(HashMap::new()),
            active: Mutex::new(HashMap::new()),
        }
    }

    fn create_pending_pairing(&self, bnet_session: Option<String>) -> String {
        let token = uuid::Uuid::new_v4().to_string();
        let mut pending = self
            .pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        pending.retain(|_, value| value.expires_at > Instant::now());
        pending.insert(
            token.clone(),
            PendingPairing {
                bnet_session,
                expires_at: Instant::now() + PAIRING_TOKEN_TTL,
            },
        );
        token
    }

    fn consume_pending_pairing(&self, token: &str) -> Option<Option<String>> {
        let mut pending = self
            .pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let pairing = pending.remove(token)?;
        if pairing.expires_at <= Instant::now() {
            return None;
        }

        Some(pairing.bnet_session)
    }

    fn create_access_token(&self) -> String {
        let token = uuid::Uuid::new_v4().to_string();
        self.active
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(token.clone(), Instant::now() + ACCESS_TOKEN_TTL);
        token
    }

    fn is_active(&self, token: &str) -> bool {
        let mut active = self
            .active
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        active.retain(|_, expires_at| *expires_at > Instant::now());
        active.contains_key(token)
    }
}

impl Default for LanAccessState {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Deserialize)]
pub struct PairingQuery {
    pub token: String,
}

#[derive(Debug, Serialize)]
pub struct PairingResponse {
    pub path: String,
}

pub async fn create_pairing(
    req: HttpRequest,
    state: web::Data<std::sync::Arc<LanAccessState>>,
) -> HttpResponse {
    if !req
        .peer_addr()
        .is_some_and(|address| address.ip().is_loopback())
    {
        return HttpResponse::Forbidden().json(serde_json::json!({
            "error": "LAN pairing can only be started from the PC"
        }));
    }

    let bnet_session = req
        .cookie("bnet_session")
        .map(|cookie| cookie.value().to_string());
    let token = state.create_pending_pairing(bnet_session);
    HttpResponse::Ok().json(PairingResponse {
        path: format!("/api/lan/pair?token={token}"),
    })
}

pub async fn consume_pairing(
    query: web::Query<PairingQuery>,
    state: web::Data<std::sync::Arc<LanAccessState>>,
) -> HttpResponse {
    let Some(bnet_session) = state.consume_pending_pairing(&query.token) else {
        return HttpResponse::Gone().json(serde_json::json!({
            "error": "This LAN pairing link has expired or was already used"
        }));
    };

    let access_token = state.create_access_token();
    let access_cookie = Cookie::build("lan_access", access_token)
        .path("/")
        .http_only(true)
        .secure(false)
        .same_site(SameSite::Lax)
        .max_age(actix_web::cookie::time::Duration::hours(24))
        .finish();

    let mut response = HttpResponse::Found();
    response
        .append_header((header::LOCATION, "/"))
        .cookie(access_cookie);

    if let Some(bnet_session) = bnet_session {
        let bnet_cookie = Cookie::build("bnet_session", bnet_session)
            .path("/")
            .http_only(true)
            .secure(false)
            .same_site(SameSite::Lax)
            .max_age(actix_web::cookie::time::Duration::days(30))
            .finish();
        response.cookie(bnet_cookie);
    }

    response.finish()
}

pub fn has_valid_access(req: &actix_web::dev::ServiceRequest, state: &LanAccessState) -> bool {
    req.cookie("lan_access")
        .is_some_and(|cookie| state.is_active(cookie.value()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::http::header::SET_COOKIE;

    #[test]
    fn pairing_tokens_are_one_time() {
        let state = LanAccessState::new();
        let token = state.create_pending_pairing(Some("session".to_string()));

        assert_eq!(
            state.consume_pending_pairing(&token),
            Some(Some("session".to_string()))
        );
        assert_eq!(state.consume_pending_pairing(&token), None);
    }

    #[test]
    fn expired_pairing_tokens_are_rejected() {
        let state = LanAccessState::new();
        state.pending.lock().unwrap().insert(
            "expired".to_string(),
            PendingPairing {
                bnet_session: Some("session".to_string()),
                expires_at: Instant::now() - Duration::from_secs(1),
            },
        );

        assert_eq!(state.consume_pending_pairing("expired"), None);
    }

    #[test]
    fn access_tokens_are_active_until_their_expiry() {
        let state = LanAccessState::new();
        let token = state.create_access_token();
        let request = actix_web::test::TestRequest::default()
            .cookie(Cookie::new("lan_access", token.clone()))
            .to_srv_request();

        assert!(has_valid_access(&request, &state));
    }

    #[test]
    fn restarted_state_rejects_old_access_tokens() {
        let state = LanAccessState::new();
        let token = state.create_access_token();
        let restarted_state = LanAccessState::new();
        let request = actix_web::test::TestRequest::default()
            .cookie(Cookie::new("lan_access", token))
            .to_srv_request();

        assert!(!has_valid_access(&request, &restarted_state));
    }

    #[actix_web::test]
    async fn consuming_pairing_mirrors_the_desktop_session() {
        let state = std::sync::Arc::new(LanAccessState::new());
        let token = state.create_pending_pairing(Some("desktop-session".to_string()));

        let response =
            consume_pairing(web::Query(PairingQuery { token }), web::Data::new(state)).await;

        assert_eq!(response.status(), actix_web::http::StatusCode::FOUND);
        let cookies: Vec<&str> = response
            .headers()
            .get_all(SET_COOKIE)
            .filter_map(|value| value.to_str().ok())
            .collect();
        assert!(cookies
            .iter()
            .any(|cookie| cookie.starts_with("lan_access=")));
        assert!(cookies
            .iter()
            .any(|cookie| cookie.starts_with("bnet_session=desktop-session")));
        assert!(cookies.iter().all(|cookie| cookie.contains("SameSite=Lax")));
    }

    #[actix_web::test]
    async fn creating_pairing_is_loopback_only() {
        let state = web::Data::new(std::sync::Arc::new(LanAccessState::new()));
        let remote_response = create_pairing(
            actix_web::test::TestRequest::post()
                .peer_addr("192.168.1.20:50000".parse().unwrap())
                .to_http_request(),
            state.clone(),
        )
        .await;
        assert_eq!(
            remote_response.status(),
            actix_web::http::StatusCode::FORBIDDEN
        );

        let loopback_response = create_pairing(
            actix_web::test::TestRequest::post()
                .peer_addr("127.0.0.1:50000".parse().unwrap())
                .cookie(Cookie::new("bnet_session", "desktop-session"))
                .to_http_request(),
            state,
        )
        .await;
        assert_eq!(loopback_response.status(), actix_web::http::StatusCode::OK);
    }
}
