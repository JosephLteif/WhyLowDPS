use actix_web::cookie::{Cookie, SameSite};
use actix_web::http::header;
use actix_web::{web, HttpRequest, HttpResponse};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const PAIRING_TOKEN_TTL: Duration = Duration::from_secs(5 * 60);
const ACCESS_TOKEN_TTL: Duration = Duration::from_secs(24 * 60 * 60);
const CONNECTED_WINDOW_SECS: u64 = 5 * 60;
const MAX_DEVICE_NAME_LENGTH: usize = 64;

#[derive(Debug)]
struct PendingPairing {
    bnet_session: Option<String>,
    device_id: Option<String>,
    expires_at: Instant,
}

#[derive(Debug)]
struct ActiveAccess {
    device_id: String,
    expires_at: Instant,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct StoredDevice {
    id: String,
    name: String,
    paired_at: u64,
    last_seen_at: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
pub struct LanDeviceSummary {
    pub id: String,
    pub name: String,
    pub paired_at: u64,
    pub last_seen_at: Option<u64>,
    pub active: bool,
}

#[derive(Debug)]
pub struct LanAccessState {
    pending: Mutex<HashMap<String, PendingPairing>>,
    active: Mutex<HashMap<String, ActiveAccess>>,
    devices: Mutex<HashMap<String, StoredDevice>>,
    device_store: Option<PathBuf>,
}

impl LanAccessState {
    pub fn new() -> Self {
        Self::with_device_store(None)
    }

    pub fn with_device_store(path: Option<PathBuf>) -> Self {
        let devices = path.as_deref().map(load_devices).unwrap_or_default();
        Self {
            pending: Mutex::new(HashMap::new()),
            active: Mutex::new(HashMap::new()),
            devices: Mutex::new(devices),
            device_store: path,
        }
    }

    fn create_pending_pairing_for_device(
        &self,
        bnet_session: Option<String>,
        device_id: Option<String>,
    ) -> String {
        let token = uuid::Uuid::new_v4().to_string();
        let now = Instant::now();
        let mut pending = self
            .pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        pending.retain(|_, value| value.expires_at > now);
        pending.insert(
            token.clone(),
            PendingPairing {
                bnet_session,
                device_id,
                expires_at: now + PAIRING_TOKEN_TTL,
            },
        );
        token
    }

    fn consume_pending_pairing(&self, token: &str) -> Option<(Option<String>, Option<String>)> {
        let mut pending = self
            .pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let pairing = pending.remove(token)?;
        if pairing.expires_at <= Instant::now() {
            return None;
        }

        Some((pairing.bnet_session, pairing.device_id))
    }

    fn has_pending_pairing(&self, token: &str) -> bool {
        let mut pending = self
            .pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let now = Instant::now();
        pending.retain(|_, value| value.expires_at > now);
        pending.contains_key(token)
    }

    fn register_device(&self, user_agent: Option<&str>) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        let now = unix_now();
        let device = StoredDevice {
            id: id.clone(),
            name: default_device_name(user_agent),
            paired_at: now,
            last_seen_at: Some(now),
        };
        self.devices
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(id.clone(), device);
        self.persist_devices();
        id
    }

    fn has_device(&self, id: &str) -> bool {
        self.devices
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .contains_key(id)
    }

    fn mark_device_paired(&self, id: &str) {
        if let Some(device) = self
            .devices
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get_mut(id)
        {
            device.last_seen_at = Some(unix_now());
        }
        self.persist_devices();
    }

    fn create_access_token(&self, device_id: &str) -> String {
        let token = uuid::Uuid::new_v4().to_string();
        self.active
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(
                token.clone(),
                ActiveAccess {
                    device_id: device_id.to_string(),
                    expires_at: Instant::now() + ACCESS_TOKEN_TTL,
                },
            );
        token
    }

    fn touch_access(&self, token: &str) -> bool {
        let device_id = {
            let mut active = self
                .active
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let now = Instant::now();
            active.retain(|_, access| access.expires_at > now);
            active.get(token).map(|access| access.device_id.clone())
        };

        let Some(device_id) = device_id else {
            return false;
        };

        let mut devices = self
            .devices
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some(device) = devices.get_mut(&device_id) else {
            return false;
        };
        device.last_seen_at = Some(unix_now());
        true
    }

    fn active_device_ids(&self) -> HashSet<String> {
        let mut active = self
            .active
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let now = Instant::now();
        active.retain(|_, access| access.expires_at > now);
        active
            .values()
            .map(|access| access.device_id.clone())
            .collect()
    }

    fn list_devices(&self) -> Vec<LanDeviceSummary> {
        let active_ids = self.active_device_ids();
        let now = unix_now();
        let devices = self
            .devices
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut summaries: Vec<_> = devices
            .values()
            .cloned()
            .map(|device| LanDeviceSummary {
                active: active_ids.contains(&device.id)
                    && device.last_seen_at.is_some_and(|last_seen| {
                        now.saturating_sub(last_seen) <= CONNECTED_WINDOW_SECS
                    }),
                id: device.id,
                name: device.name,
                paired_at: device.paired_at,
                last_seen_at: device.last_seen_at,
            })
            .collect();
        summaries.sort_by(|left, right| right.paired_at.cmp(&left.paired_at));
        drop(devices);
        self.persist_devices();
        summaries
    }

    fn rename_device(&self, id: &str, name: &str) -> Result<(), &'static str> {
        let name =
            normalize_device_name(name).ok_or("Device name must be between 1 and 64 characters")?;
        let mut devices = self
            .devices
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some(device) = devices.get_mut(id) else {
            return Err("LAN device not found");
        };
        device.name = name;
        drop(devices);
        self.persist_devices();
        Ok(())
    }

    fn remove_device(&self, id: &str) -> bool {
        let removed = self
            .devices
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(id)
            .is_some();
        if !removed {
            return false;
        }

        self.active
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .retain(|_, access| access.device_id != id);
        self.persist_devices();
        true
    }

    fn persist_devices(&self) {
        let Some(path) = self.device_store.as_deref() else {
            return;
        };
        let devices: Vec<_> = self
            .devices
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .values()
            .cloned()
            .collect();
        let Ok(payload) = serde_json::to_vec_pretty(&devices) else {
            return;
        };
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(path, payload);
    }
}

impl Default for LanAccessState {
    fn default() -> Self {
        Self::new()
    }
}

fn load_devices(path: &Path) -> HashMap<String, StoredDevice> {
    let Ok(raw) = std::fs::read_to_string(path) else {
        return HashMap::new();
    };
    serde_json::from_str::<Vec<StoredDevice>>(&raw)
        .unwrap_or_default()
        .into_iter()
        .map(|device| (device.id.clone(), device))
        .collect()
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default()
}

fn normalize_device_name(name: &str) -> Option<String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > MAX_DEVICE_NAME_LENGTH {
        return None;
    }
    Some(name.to_string())
}

fn default_device_name(user_agent: Option<&str>) -> String {
    let user_agent = user_agent.unwrap_or_default().to_ascii_lowercase();
    if user_agent.contains("iphone") {
        "iPhone".to_string()
    } else if user_agent.contains("ipad") {
        "iPad".to_string()
    } else if user_agent.contains("android") {
        "Android device".to_string()
    } else if user_agent.contains("windows") {
        "Windows browser".to_string()
    } else if user_agent.contains("macintosh") {
        "Mac browser".to_string()
    } else {
        "LAN device".to_string()
    }
}

#[derive(Debug, Deserialize)]
pub struct PairingQuery {
    pub token: String,
}

#[derive(Debug, Default, Deserialize)]
pub struct PairingCreateQuery {
    pub device_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PairingResponse {
    pub path: String,
    pub expires_in_seconds: u64,
}

#[derive(Debug, Deserialize)]
pub struct RenameDeviceRequest {
    pub name: String,
}

fn expired_pairing_response() -> HttpResponse {
    HttpResponse::Gone().json(serde_json::json!({
        "error": "This LAN pairing link has expired or was already used",
        "help": "Create a new link on the PC and open it in Safari or Chrome, not only in a QR scanner preview"
    }))
}

fn is_loopback_request(req: &HttpRequest) -> bool {
    req.peer_addr()
        .is_some_and(|address| address.ip().is_loopback())
}

pub async fn create_pairing(
    req: HttpRequest,
    query: web::Query<PairingCreateQuery>,
    state: web::Data<std::sync::Arc<LanAccessState>>,
) -> HttpResponse {
    if !is_loopback_request(&req) {
        return HttpResponse::Forbidden().json(serde_json::json!({
            "error": "LAN pairing can only be started from the PC"
        }));
    }

    let bnet_session = req
        .cookie("bnet_session")
        .map(|cookie| cookie.value().to_string());
    if let Some(device_id) = query.device_id.as_deref() {
        if !state.has_device(device_id) {
            return HttpResponse::NotFound().json(serde_json::json!({
                "error": "LAN device not found"
            }));
        }
    }
    let token = state.create_pending_pairing_for_device(bnet_session, query.device_id.clone());
    HttpResponse::Ok().json(PairingResponse {
        path: format!("/api/lan/pair?token={token}"),
        expires_in_seconds: PAIRING_TOKEN_TTL.as_secs(),
    })
}

pub async fn show_pairing(
    query: web::Query<PairingQuery>,
    state: web::Data<std::sync::Arc<LanAccessState>>,
) -> HttpResponse {
    if !state.has_pending_pairing(&query.token) {
        return expired_pairing_response();
    }

    let encoded_token = urlencoding::encode(&query.token);
    let consume_path = format!("/api/lan/pair/consume?token={encoded_token}");
    let body = format!(
        r##"<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Open WhyLowDPS</title>
    <style>
      :root {{ color-scheme: dark; font-family: system-ui, sans-serif; }}
      body {{ margin: 0; min-height: 100vh; display: grid; place-items: center; background: #09090b; color: #f4f4f5; }}
      main {{ width: min(90vw, 420px); box-sizing: border-box; padding: 28px; border: 1px solid #27272a; border-radius: 16px; background: #18181b; }}
      h1 {{ margin: 0 0 12px; font-size: 24px; }}
      p {{ color: #a1a1aa; line-height: 1.5; }}
      a {{ display: block; margin-top: 24px; padding: 13px 16px; border-radius: 10px; background: #f0c75e; color: #18181b; text-align: center; font-weight: 700; text-decoration: none; }}
      small {{ display: block; margin-top: 16px; color: #71717a; line-height: 1.45; }}
    </style>
  </head>
  <body>
    <main>
      <h1>Open WhyLowDPS</h1>
      <p>This link is ready to pair this browser with the WhyLowDPS app on your PC.</p>
      <a href="{consume_path}">Continue to WhyLowDPS</a>
      <small>If this page opened inside a QR scanner, use its Share or Open in Safari option first, then tap Continue. The link is one-time and expires after five minutes.</small>
    </main>
  </body>
</html>"##
    );

    HttpResponse::Ok()
        .insert_header((header::CACHE_CONTROL, "no-store"))
        .content_type("text/html; charset=utf-8")
        .body(body)
}

pub async fn consume_pairing(
    req: HttpRequest,
    query: web::Query<PairingQuery>,
    state: web::Data<std::sync::Arc<LanAccessState>>,
) -> HttpResponse {
    let Some((bnet_session, existing_device_id)) = state.consume_pending_pairing(&query.token)
    else {
        return expired_pairing_response();
    };

    let user_agent = req
        .headers()
        .get("user-agent")
        .and_then(|value| value.to_str().ok());
    let device_id = existing_device_id
        .filter(|device_id| state.has_device(device_id))
        .unwrap_or_else(|| state.register_device(user_agent));
    state.mark_device_paired(&device_id);
    let access_token = state.create_access_token(&device_id);
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

pub async fn list_devices(
    req: HttpRequest,
    state: web::Data<std::sync::Arc<LanAccessState>>,
) -> HttpResponse {
    if !is_loopback_request(&req) {
        return HttpResponse::Forbidden().json(serde_json::json!({
            "error": "LAN device management can only be used from the PC"
        }));
    }
    HttpResponse::Ok().json(state.list_devices())
}

pub async fn rename_device(
    req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<RenameDeviceRequest>,
    state: web::Data<std::sync::Arc<LanAccessState>>,
) -> HttpResponse {
    if !is_loopback_request(&req) {
        return HttpResponse::Forbidden().json(serde_json::json!({
            "error": "LAN device management can only be used from the PC"
        }));
    }
    match state.rename_device(&path, &body.name) {
        Ok(()) => HttpResponse::NoContent().finish(),
        Err(error) if error == "LAN device not found" => {
            HttpResponse::NotFound().json(serde_json::json!({ "error": error }))
        }
        Err(error) => HttpResponse::BadRequest().json(serde_json::json!({ "error": error })),
    }
}

pub async fn remove_device(
    req: HttpRequest,
    path: web::Path<String>,
    state: web::Data<std::sync::Arc<LanAccessState>>,
) -> HttpResponse {
    if !is_loopback_request(&req) {
        return HttpResponse::Forbidden().json(serde_json::json!({
            "error": "LAN device management can only be used from the PC"
        }));
    }
    if state.remove_device(&path) {
        HttpResponse::NoContent().finish()
    } else {
        HttpResponse::NotFound().json(serde_json::json!({ "error": "LAN device not found" }))
    }
}

pub fn has_valid_access(req: &actix_web::dev::ServiceRequest, state: &LanAccessState) -> bool {
    req.cookie("lan_access")
        .is_some_and(|cookie| state.touch_access(cookie.value()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::http::header::SET_COOKIE;

    #[test]
    fn pairing_tokens_are_one_time() {
        let state = LanAccessState::new();
        let token = state.create_pending_pairing_for_device(Some("session".to_string()), None);

        assert_eq!(
            state.consume_pending_pairing(&token),
            Some((Some("session".to_string()), None))
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
                device_id: None,
                expires_at: Instant::now() - Duration::from_secs(1),
            },
        );

        assert_eq!(state.consume_pending_pairing("expired"), None);
    }

    #[test]
    fn access_tokens_are_active_until_their_expiry() {
        let state = LanAccessState::new();
        let device_id = state.register_device(Some("iPhone"));
        let token = state.create_access_token(&device_id);
        let request = actix_web::test::TestRequest::default()
            .cookie(Cookie::new("lan_access", token.clone()))
            .to_srv_request();

        assert!(has_valid_access(&request, &state));
    }

    #[test]
    fn restarted_state_rejects_old_access_tokens() {
        let state = LanAccessState::new();
        let device_id = state.register_device(Some("iPhone"));
        let token = state.create_access_token(&device_id);
        let restarted_state = LanAccessState::new();
        let request = actix_web::test::TestRequest::default()
            .cookie(Cookie::new("lan_access", token))
            .to_srv_request();

        assert!(!has_valid_access(&request, &restarted_state));
    }

    #[test]
    fn device_records_persist_without_access_tokens() {
        let dir = tempfile::tempdir().expect("device store dir");
        let path = dir.path().join("lan_devices.json");
        let state = LanAccessState::with_device_store(Some(path.clone()));
        let device_id = state.register_device(Some("iPhone"));
        let access_token = state.create_access_token(&device_id);
        drop(state);

        let raw = std::fs::read_to_string(&path).expect("device store");
        assert!(raw.contains(&device_id));
        assert!(!raw.contains(&access_token));

        let restarted = LanAccessState::with_device_store(Some(path));
        let devices = restarted.list_devices();
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].name, "iPhone");
        assert!(!devices[0].active);
    }

    #[test]
    fn removing_a_device_revokes_its_access_token() {
        let state = LanAccessState::new();
        let device_id = state.register_device(Some("Android"));
        let token = state.create_access_token(&device_id);
        let request = actix_web::test::TestRequest::default()
            .cookie(Cookie::new("lan_access", token))
            .to_srv_request();

        assert!(state.remove_device(&device_id));
        assert!(!has_valid_access(&request, &state));
    }

    #[actix_web::test]
    async fn pairing_landing_page_does_not_consume_the_token() {
        let state = std::sync::Arc::new(LanAccessState::new());
        let token = state.create_pending_pairing_for_device(None, None);
        let response = show_pairing(
            web::Query(PairingQuery {
                token: token.clone(),
            }),
            web::Data::new(state.clone()),
        )
        .await;

        assert_eq!(response.status(), actix_web::http::StatusCode::OK);
        assert_eq!(
            response
                .headers()
                .get(header::CACHE_CONTROL)
                .and_then(|value| value.to_str().ok()),
            Some("no-store")
        );
        assert!(state.consume_pending_pairing(&token).is_some());
    }

    #[actix_web::test]
    async fn consuming_pairing_mirrors_the_desktop_session_and_registers_device() {
        let state = std::sync::Arc::new(LanAccessState::new());
        let token =
            state.create_pending_pairing_for_device(Some("desktop-session".to_string()), None);

        let response = consume_pairing(
            actix_web::test::TestRequest::get()
                .insert_header(("user-agent", "Mozilla iPhone"))
                .to_http_request(),
            web::Query(PairingQuery { token }),
            web::Data::new(state.clone()),
        )
        .await;

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
        assert_eq!(state.list_devices()[0].name, "iPhone");
    }

    #[actix_web::test]
    async fn re_pairing_an_existing_device_keeps_one_record_and_its_name() {
        let state = std::sync::Arc::new(LanAccessState::new());
        let device_id = state.register_device(Some("iPhone"));
        let token = state.create_pending_pairing_for_device(None, Some(device_id));

        let _ = consume_pairing(
            actix_web::test::TestRequest::get()
                .insert_header(("user-agent", "Mozilla Android"))
                .to_http_request(),
            web::Query(PairingQuery { token }),
            web::Data::new(state.clone()),
        )
        .await;

        let devices = state.list_devices();
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].name, "iPhone");
    }

    #[actix_web::test]
    async fn creating_pairing_is_loopback_only() {
        let state = web::Data::new(std::sync::Arc::new(LanAccessState::new()));
        let remote_response = create_pairing(
            actix_web::test::TestRequest::post()
                .peer_addr("192.168.1.20:50000".parse().unwrap())
                .to_http_request(),
            web::Query(PairingCreateQuery::default()),
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
            web::Query(PairingCreateQuery::default()),
            state,
        )
        .await;
        assert_eq!(loopback_response.status(), actix_web::http::StatusCode::OK);
    }
}
