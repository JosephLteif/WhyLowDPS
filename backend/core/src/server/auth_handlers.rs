use actix_web::cookie::{Cookie, SameSite};
use actix_web::http::header;
use actix_web::{web, HttpRequest, HttpResponse};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
#[cfg(all(feature = "desktop", target_os = "windows"))]
use windows::Win32::Foundation::{LocalFree, HLOCAL};
#[cfg(all(feature = "desktop", target_os = "windows"))]
use windows::Win32::Security::Cryptography::{
    CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
};

const BLIZZARD_CREDENTIAL_PROFILES_KEY: &str = "blizzard_credential_profiles";
#[cfg(feature = "desktop")]
const BLIZZARD_KEYRING_SERVICE: &str = "WhyLowDPS Blizzard Credentials";
#[cfg(all(feature = "desktop", target_os = "windows"))]
const BLIZZARD_SECRET_BLOB_KEY_PREFIX: &str = "blizzard_credential_secret_blob:";

pub trait BlizzardCredentialSecretStore: Send + Sync {
    fn set_secret(&self, profile_id: &str, secret: &str) -> Result<(), String>;
    fn get_secret(&self, profile_id: &str) -> Result<Option<String>, String>;
    fn delete_secret(&self, profile_id: &str) -> Result<(), String>;
}

#[cfg(feature = "desktop")]
pub struct OsBlizzardCredentialSecretStore {
    store: Arc<dyn crate::storage::JobStorage>,
}

#[cfg(feature = "desktop")]
impl OsBlizzardCredentialSecretStore {
    fn read_legacy_keyring_secret(&self, profile_id: &str) -> Result<Option<String>, String> {
        match keyring::Entry::new(BLIZZARD_KEYRING_SERVICE, profile_id)
            .map_err(|e| e.to_string())?
            .get_password()
        {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    fn delete_legacy_keyring_secret(&self, profile_id: &str) -> Result<(), String> {
        match keyring::Entry::new(BLIZZARD_KEYRING_SERVICE, profile_id)
            .map_err(|e| e.to_string())?
            .delete_credential()
        {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

#[cfg(all(feature = "desktop", target_os = "windows"))]
fn secret_blob_config_key(profile_id: &str) -> String {
    format!("{BLIZZARD_SECRET_BLOB_KEY_PREFIX}{profile_id}")
}

#[cfg(all(feature = "desktop", target_os = "windows"))]
fn encode_secret_blob(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for &byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

#[cfg(all(feature = "desktop", target_os = "windows"))]
fn decode_secret_blob(blob: &str) -> Result<Vec<u8>, String> {
    fn nibble(byte: u8) -> Result<u8, String> {
        match byte {
            b'0'..=b'9' => Ok(byte - b'0'),
            b'a'..=b'f' => Ok(byte - b'a' + 10),
            b'A'..=b'F' => Ok(byte - b'A' + 10),
            _ => Err("Invalid encrypted secret encoding".to_string()),
        }
    }

    let bytes = blob.as_bytes();
    if !bytes.len().is_multiple_of(2) {
        return Err("Invalid encrypted secret encoding".to_string());
    }

    let mut output = Vec::with_capacity(bytes.len() / 2);
    for pair in bytes.chunks_exact(2) {
        output.push((nibble(pair[0])? << 4) | nibble(pair[1])?);
    }
    Ok(output)
}

#[cfg(all(feature = "desktop", target_os = "windows"))]
fn encrypt_secret_blob(secret: &str) -> Result<String, String> {
    unsafe {
        let bytes = secret.as_bytes();
        let input = CRYPT_INTEGER_BLOB {
            cbData: bytes.len() as u32,
            pbData: bytes.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB::default();
        CryptProtectData(
            &input,
            None,
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .map_err(|e| e.to_string())?;

        let encrypted = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(HLOCAL(output.pbData.cast()));
        Ok(encode_secret_blob(&encrypted))
    }
}

#[cfg(all(feature = "desktop", target_os = "windows"))]
fn decrypt_secret_blob(blob: &str) -> Result<String, String> {
    let encrypted = decode_secret_blob(blob)?;
    unsafe {
        let input = CRYPT_INTEGER_BLOB {
            cbData: encrypted.len() as u32,
            pbData: encrypted.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB::default();
        CryptUnprotectData(
            &input,
            None,
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .map_err(|e| e.to_string())?;

        let decrypted = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(HLOCAL(output.pbData.cast()));
        String::from_utf8(decrypted).map_err(|e| e.to_string())
    }
}

#[cfg(feature = "desktop")]
impl BlizzardCredentialSecretStore for OsBlizzardCredentialSecretStore {
    fn set_secret(&self, profile_id: &str, secret: &str) -> Result<(), String> {
        #[cfg(target_os = "windows")]
        {
            let encrypted = encrypt_secret_blob(secret)?;
            self.store
                .set_user_config("system", &secret_blob_config_key(profile_id), &encrypted);
            let _ = self.delete_legacy_keyring_secret(profile_id);
            Ok(())
        }

        #[cfg(not(target_os = "windows"))]
        {
            keyring::Entry::new(BLIZZARD_KEYRING_SERVICE, profile_id)
                .map_err(|e| e.to_string())?
                .set_password(secret)
                .map_err(|e| e.to_string())
        }
    }

    fn get_secret(&self, profile_id: &str) -> Result<Option<String>, String> {
        #[cfg(target_os = "windows")]
        {
            if let Some(blob) = self
                .store
                .get_user_config("system", &secret_blob_config_key(profile_id))
            {
                return decrypt_secret_blob(&blob).map(Some);
            }

            if let Some(secret) = self.read_legacy_keyring_secret(profile_id)? {
                self.set_secret(profile_id, &secret)?;
                return Ok(Some(secret));
            }

            Ok(None)
        }

        #[cfg(not(target_os = "windows"))]
        {
            self.read_legacy_keyring_secret(profile_id)
        }
    }

    fn delete_secret(&self, profile_id: &str) -> Result<(), String> {
        #[cfg(target_os = "windows")]
        {
            self.store
                .remove_user_config("system", &secret_blob_config_key(profile_id));
            let _ = self.delete_legacy_keyring_secret(profile_id);
            Ok(())
        }

        #[cfg(not(target_os = "windows"))]
        {
            self.delete_legacy_keyring_secret(profile_id)
        }
    }
}

#[cfg(any(test, not(feature = "desktop")))]
#[derive(Default)]
pub struct MemoryBlizzardCredentialSecretStore {
    secrets: Mutex<HashMap<String, String>>,
}

#[cfg(any(test, not(feature = "desktop")))]
impl BlizzardCredentialSecretStore for MemoryBlizzardCredentialSecretStore {
    fn set_secret(&self, profile_id: &str, secret: &str) -> Result<(), String> {
        self.secrets
            .lock()
            .map_err(|e| e.to_string())?
            .insert(profile_id.to_string(), secret.to_string());
        Ok(())
    }

    fn get_secret(&self, profile_id: &str) -> Result<Option<String>, String> {
        Ok(self
            .secrets
            .lock()
            .map_err(|e| e.to_string())?
            .get(profile_id)
            .cloned())
    }

    fn delete_secret(&self, profile_id: &str) -> Result<(), String> {
        self.secrets
            .lock()
            .map_err(|e| e.to_string())?
            .remove(profile_id);
        Ok(())
    }
}

pub fn create_blizzard_credential_secret_store(
    _store: Arc<dyn crate::storage::JobStorage>,
) -> Arc<dyn BlizzardCredentialSecretStore> {
    #[cfg(feature = "desktop")]
    {
        Arc::new(OsBlizzardCredentialSecretStore { store: _store })
    }
    #[cfg(not(feature = "desktop"))]
    {
        Arc::new(MemoryBlizzardCredentialSecretStore::default())
    }
}

pub struct BlizzardAuthState {
    pub client_id: Option<String>,
    pub client_secret: Option<String>,
    pub redirect_uri: String,
    pub jwt_secret: String,
    oauth_sessions: Mutex<HashMap<String, (String, Instant)>>,
}

pub fn validate_jwt_secret(
    configured: Option<String>,
    require_strong: bool,
) -> Result<String, String> {
    let secret = configured
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "dev-secret-key-123".to_string());
    let weak = secret.len() < 32
        || matches!(
            secret.as_str(),
            "dev-secret-key-123" | "change-me" | "secret" | "password"
        )
        || secret
            .chars()
            .all(|character| character == secret.chars().next().unwrap_or('\0'));
    if require_strong && weak {
        return Err("JWT_SECRET must be at least 32 characters and must not use a development/default value".to_string());
    }
    Ok(secret)
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
            oauth_sessions: Mutex::new(HashMap::new()),
        }
    }

    fn store_oauth_session(&self, session_id: String, access_token: String) {
        self.oauth_sessions
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(
                session_id,
                (
                    access_token,
                    Instant::now() + Duration::from_secs(24 * 60 * 60),
                ),
            );
    }

    pub(crate) fn oauth_token(&self, session_id: &str) -> Option<String> {
        let mut sessions = self
            .oauth_sessions
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let (token, expires_at) = sessions.get(session_id)?.clone();
        if expires_at <= Instant::now() {
            sessions.remove(session_id);
            return None;
        }
        Some(token)
    }

    fn remove_oauth_session(&self, session_id: &str) {
        self.oauth_sessions
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(session_id);
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String, // BattleTag
    pub session_id: String,
    pub exp: usize,
}

#[derive(Deserialize)]
pub struct AuthCallbackQuery {
    pub code: Option<String>,
    pub state: Option<String>, // This is our flow_id
    pub error: Option<String>,
    pub error_description: Option<String>,
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
    pub credential_id: Option<String>,
    pub flow_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BlizzardCredentialProfile {
    pub id: String,
    pub name: String,
    pub client_id: String,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Deserialize)]
pub struct SaveBlizzardCredentialProfileRequest {
    pub name: Option<String>,
    pub client_id: String,
    pub client_secret: String,
}

#[derive(Deserialize)]
pub struct RenameBlizzardCredentialProfileRequest {
    pub name: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct BlizzardCredentialProfileSummary {
    pub id: String,
    pub name: String,
    pub client_id: String,
    pub created_at: u64,
    pub updated_at: u64,
    pub has_secret: bool,
}

#[derive(Debug, PartialEq, Eq)]
enum SavedProfileLookupError {
    NotFound,
    MissingSecret,
}

fn now_unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn load_blizzard_credential_profiles(
    store: &dyn crate::storage::JobStorage,
) -> Vec<BlizzardCredentialProfile> {
    store
        .get_user_config("system", BLIZZARD_CREDENTIAL_PROFILES_KEY)
        .and_then(|raw| serde_json::from_str::<Vec<BlizzardCredentialProfile>>(&raw).ok())
        .unwrap_or_default()
}

fn save_blizzard_credential_profiles(
    store: &dyn crate::storage::JobStorage,
    profiles: &[BlizzardCredentialProfile],
) -> Result<(), String> {
    let payload = serde_json::to_string(profiles).map_err(|e| e.to_string())?;
    store.set_user_config("system", BLIZZARD_CREDENTIAL_PROFILES_KEY, &payload);
    Ok(())
}

fn load_saved_profile(
    store: &dyn crate::storage::JobStorage,
    profile_id: Option<&String>,
) -> Option<BlizzardCredentialProfile> {
    let profile_id = profile_id?;
    load_blizzard_credential_profiles(store)
        .into_iter()
        .find(|profile| profile.id == *profile_id || profile.client_id == *profile_id)
}

fn read_profile_secret(
    secrets: &dyn BlizzardCredentialSecretStore,
    profile: &BlizzardCredentialProfile,
) -> Result<Option<String>, String> {
    match secrets.get_secret(&profile.id)? {
        Some(secret) => Ok(Some(secret)),
        None => secrets.get_secret(&profile.client_id),
    }
}

fn profile_summary(
    secrets: &dyn BlizzardCredentialSecretStore,
    profile: BlizzardCredentialProfile,
) -> BlizzardCredentialProfileSummary {
    let has_secret = read_profile_secret(secrets, &profile)
        .ok()
        .flatten()
        .is_some();
    BlizzardCredentialProfileSummary {
        id: profile.id,
        name: profile.name,
        client_id: profile.client_id,
        created_at: profile.created_at,
        updated_at: profile.updated_at,
        has_secret,
    }
}

fn find_saved_profile_creds(
    store: &dyn crate::storage::JobStorage,
    secrets: &dyn BlizzardCredentialSecretStore,
    profile_id: &String,
) -> Result<(String, String), SavedProfileLookupError> {
    let profile =
        load_saved_profile(store, Some(profile_id)).ok_or(SavedProfileLookupError::NotFound)?;
    let secret = read_profile_secret(secrets, &profile)
        .map_err(|_| SavedProfileLookupError::MissingSecret)?
        .ok_or(SavedProfileLookupError::MissingSecret)?;
    Ok((profile.client_id, secret))
}

pub async fn list_blizzard_credential_profiles(
    store: web::Data<Arc<dyn crate::storage::JobStorage>>,
    secrets: web::Data<Arc<dyn BlizzardCredentialSecretStore>>,
) -> HttpResponse {
    let profiles = load_blizzard_credential_profiles(&***store)
        .into_iter()
        .map(|profile| profile_summary(&***secrets, profile))
        .collect::<Vec<_>>();
    HttpResponse::Ok().json(json!({
        "profiles": profiles
    }))
}

pub async fn save_blizzard_credential_profile(
    store: web::Data<Arc<dyn crate::storage::JobStorage>>,
    secrets: web::Data<Arc<dyn BlizzardCredentialSecretStore>>,
    body: web::Json<SaveBlizzardCredentialProfileRequest>,
) -> HttpResponse {
    let client_id = body.client_id.trim();
    let client_secret = body.client_secret.trim();
    if client_id.is_empty() || client_secret.is_empty() {
        return HttpResponse::BadRequest()
            .json(json!({"error": "Missing client_id or client_secret"}));
    }

    let mut profiles = load_blizzard_credential_profiles(&***store);
    let preferred_name = body
        .name
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .unwrap_or("Blizzard credentials")
        .to_string();
    let now = now_unix_secs();

    if let Some(existing) = profiles
        .iter_mut()
        .find(|profile| profile.client_id == client_id)
    {
        if let Err(e) = secrets.set_secret(&existing.id, client_secret) {
            return HttpResponse::InternalServerError().json(json!({"error": e}));
        }
        let _ = secrets.delete_secret(client_id);
        existing.name = preferred_name;
        existing.updated_at = now;
        let profile = existing.clone();
        return match save_blizzard_credential_profiles(&***store, &profiles) {
            Ok(()) => HttpResponse::Ok().json(json!({
                "profile": profile_summary(&***secrets, profile)
            })),
            Err(e) => HttpResponse::InternalServerError().json(json!({"error": e})),
        };
    }

    let profile = BlizzardCredentialProfile {
        id: uuid::Uuid::new_v4().to_string(),
        name: preferred_name,
        client_id: client_id.to_string(),
        created_at: now,
        updated_at: now,
    };

    if let Err(e) = secrets.set_secret(&profile.id, client_secret) {
        return HttpResponse::InternalServerError().json(json!({"error": e}));
    }

    profiles.push(profile.clone());
    if let Err(e) = save_blizzard_credential_profiles(&***store, &profiles) {
        let _ = secrets.delete_secret(&profile.id);
        return HttpResponse::InternalServerError().json(json!({"error": e}));
    }

    HttpResponse::Ok().json(json!({ "profile": profile_summary(&***secrets, profile) }))
}

pub async fn rename_blizzard_credential_profile(
    path: web::Path<String>,
    store: web::Data<Arc<dyn crate::storage::JobStorage>>,
    secrets: web::Data<Arc<dyn BlizzardCredentialSecretStore>>,
    body: web::Json<RenameBlizzardCredentialProfileRequest>,
) -> HttpResponse {
    let next_name = body.name.trim();
    if next_name.is_empty() {
        return HttpResponse::BadRequest().json(json!({"error": "Missing credential name"}));
    }

    let profile_id = path.into_inner();
    let mut profiles = load_blizzard_credential_profiles(&***store);
    let Some(profile) = profiles.iter_mut().find(|profile| profile.id == profile_id) else {
        return HttpResponse::NotFound().json(json!({"error": "Credential profile not found"}));
    };
    profile.name = next_name.to_string();
    profile.updated_at = now_unix_secs();
    let renamed = profile.clone();

    match save_blizzard_credential_profiles(&***store, &profiles) {
        Ok(()) => HttpResponse::Ok().json(json!({
            "profile": profile_summary(&***secrets, renamed)
        })),
        Err(e) => HttpResponse::InternalServerError().json(json!({"error": e})),
    }
}

pub async fn delete_blizzard_credential_profile(
    path: web::Path<String>,
    store: web::Data<Arc<dyn crate::storage::JobStorage>>,
    secrets: web::Data<Arc<dyn BlizzardCredentialSecretStore>>,
) -> HttpResponse {
    let profile_id = path.into_inner();
    let mut profiles = load_blizzard_credential_profiles(&***store);
    let removed_client_id = profiles
        .iter()
        .find(|profile| profile.id == profile_id)
        .map(|profile| profile.client_id.clone());
    let original_len = profiles.len();
    profiles.retain(|profile| profile.id != profile_id);
    if profiles.len() == original_len {
        return HttpResponse::NotFound().json(json!({"error": "Credential profile not found"}));
    }

    if let Err(e) = secrets.delete_secret(&profile_id) {
        return HttpResponse::InternalServerError().json(json!({"error": e}));
    }
    if let Some(client_id) = removed_client_id {
        let _ = secrets.delete_secret(&client_id);
    }

    match save_blizzard_credential_profiles(&***store, &profiles) {
        Ok(()) => HttpResponse::Ok().json(json!({"status": "deleted"})),
        Err(e) => HttpResponse::InternalServerError().json(json!({"error": e})),
    }
}

fn get_effective_creds(
    state: &BlizzardAuthState,
    store: &dyn crate::storage::JobStorage,
    secrets: &dyn BlizzardCredentialSecretStore,
    credential_id: Option<&String>,
) -> Result<Option<(String, String)>, SavedProfileLookupError> {
    // 1. Try a selected saved desktop credential profile
    if let Some(profile_id) = credential_id {
        return find_saved_profile_creds(store, secrets, profile_id).map(Some);
    }

    // 2. Try environment variables
    if let (Some(id), Some(sec)) = (&state.client_id, &state.client_secret) {
        return Ok(Some((id.clone(), sec.clone())));
    }

    Ok(None)
}

pub async fn get_credentials_status(
    state: web::Data<Arc<BlizzardAuthState>>,
    store: web::Data<Arc<dyn crate::storage::JobStorage>>,
    secrets: web::Data<Arc<dyn BlizzardCredentialSecretStore>>,
) -> HttpResponse {
    let env_configured = state.client_id.is_some() && state.client_secret.is_some();
    let saved_profile_count = load_blizzard_credential_profiles(&***store)
        .iter()
        .filter(|profile| {
            read_profile_secret(&***secrets, profile)
                .ok()
                .flatten()
                .is_some()
        })
        .count();
    HttpResponse::Ok().json(json!({
        "globally_configured": env_configured || saved_profile_count > 0,
        "saved_profile_count": saved_profile_count
    }))
}

pub async fn bnet_login(
    req: HttpRequest,
    state: web::Data<Arc<BlizzardAuthState>>,
    store: web::Data<Arc<dyn crate::storage::JobStorage>>,
    secrets: web::Data<Arc<dyn BlizzardCredentialSecretStore>>,
    query: web::Query<LoginQuery>,
) -> HttpResponse {
    let creds = get_effective_creds(&state, &***store, &***secrets, query.credential_id.as_ref());

    let (client_id, _client_secret) = match creds {
        Ok(Some(c)) => c,
        Ok(None) => return HttpResponse::BadRequest().json(json!({
            "error": "Blizzard API Client ID is not configured. Save a credential profile or configure the server environment."
        })),
        Err(SavedProfileLookupError::NotFound) => {
            return HttpResponse::BadRequest().json(json!({
                "error": "Saved Blizzard credentials were not found on this device."
            }))
        }
        Err(SavedProfileLookupError::MissingSecret) => {
            return HttpResponse::BadRequest().json(json!({
                "error": "Saved Blizzard credentials are missing their secure secret on this device. Re-enter the client secret and save again."
            }))
        }
    };

    let mut builder = HttpResponse::Found();

    let conn = req.connection_info();
    let request_host = conn.host().to_string();
    let request_scheme = conn.scheme().to_string();
    let request_redirect_uri = format!(
        "{}://{}/api/auth/bnet/callback",
        request_scheme, request_host
    );
    let redirect_uri_for_flow = std::env::var("BLIZZARD_REDIRECT_URI")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or(request_redirect_uri);

    let flow_id = query
        .flow_id
        .clone()
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    builder.cookie(
        Cookie::build("bnet_flow_id", flow_id.clone())
            .path("/")
            .http_only(true)
            .secure(false) // Local dev
            .same_site(SameSite::Lax)
            .finish(),
    );
    let flow_status_cache_key = format!("login_flow_status_{}", flow_id);
    store.set_cache(&flow_status_cache_key, "started".to_string());
    let redirect_cache_key = format!("login_flow_redirect_uri_{}", flow_id);
    store.set_cache(&redirect_cache_key, redirect_uri_for_flow.clone());
    let client_id_cache_key = format!("login_flow_client_id_{}", flow_id);
    let client_secret_cache_key = format!("login_flow_client_secret_{}", flow_id);
    store.set_cache(&client_id_cache_key, client_id.clone());
    store.set_cache(&client_secret_cache_key, _client_secret.clone());

    let auth_url = format!(
        "https://oauth.battle.net/authorize?client_id={}&redirect_uri={}&response_type=code&scope=wow.profile%20openid&state={}&prompt=login%20consent&max_age=0",
        client_id,
        urlencoding::encode(&redirect_uri_for_flow),
        flow_id
    );

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
    let error_key = format!("login_flow_error_{}", query.flow_id);
    let status_key = format!("login_flow_status_{}", query.flow_id);
    match store.get_cache(&cache_key) {
        Some(token) => {
            // Remove from cache after successful poll to clean up
            store.remove_cache(&cache_key);
            store.remove_cache(&error_key);
            store.remove_cache(&status_key);
            HttpResponse::Ok().json(json!({ "token": token }))
        }
        None => {
            if let Some(err) = store.get_cache(&error_key) {
                store.remove_cache(&error_key);
                store.remove_cache(&status_key);
                return HttpResponse::BadRequest()
                    .json(json!({ "status": "failed", "error": err }));
            }
            HttpResponse::Ok().json(json!({ "status": "pending" }))
        }
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
    secrets: web::Data<Arc<dyn BlizzardCredentialSecretStore>>,
) -> HttpResponse {
    let client = reqwest::Client::new();
    let flow_id_opt = query
        .state
        .clone()
        .or_else(|| req.cookie("bnet_flow_id").map(|c| c.value().to_string()));
    let flow_id = flow_id_opt.clone().unwrap_or_else(|| "unknown".to_string());
    let redirect_cache_key = format!("login_flow_redirect_uri_{}", flow_id);
    let client_id_cache_key = format!("login_flow_client_id_{}", flow_id);
    let client_secret_cache_key = format!("login_flow_client_secret_{}", flow_id);
    let error_cache_key = format!("login_flow_error_{}", flow_id);
    let status_cache_key = format!("login_flow_status_{}", flow_id);
    let redirect_uri_for_exchange = store
        .get_cache(&redirect_cache_key)
        .unwrap_or_else(|| state.redirect_uri.clone());

    if let Some(provider_error) = &query.error {
        let message = format!(
            "{}{}",
            provider_error,
            query
                .error_description
                .as_ref()
                .map(|d| format!(": {}", d))
                .unwrap_or_default()
        );
        if flow_id_opt.is_some() {
            store.set_cache(&error_cache_key, message.clone());
            store.remove_cache(&status_cache_key);
        }
        return HttpResponse::BadRequest().json(json!({
            "error": "OAuth provider returned an error",
            "details": message
        }));
    }

    let code = match &query.code {
        Some(code) if !code.trim().is_empty() => code.clone(),
        _ => {
            let message = "Missing authorization code in callback query".to_string();
            if flow_id_opt.is_some() {
                store.set_cache(&error_cache_key, message.clone());
                store.remove_cache(&status_cache_key);
            }
            return HttpResponse::BadRequest().json(json!({
                "error": "Failed to exchange code",
                "details": message
            }));
        }
    };

    // Prefer credentials captured at login start for this exact flow. Secrets stay
    // server-side and are never transported in the OAuth URL or browser cookies.
    let creds = match (
        store.get_cache(&client_id_cache_key),
        store.get_cache(&client_secret_cache_key),
    ) {
        (Some(id), Some(sec)) => Some((id, sec)),
        _ => get_effective_creds(&state, &***store, &***secrets, None)
            .ok()
            .flatten(),
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
            ("code", &code),
            ("redirect_uri", &redirect_uri_for_exchange),
        ])
        .send()
        .await;

    let access_token = match token_resp {
        Ok(res) if res.status().is_success() => {
            let text = res.text().await.unwrap_or_default();
            match serde_json::from_str::<TokenResponse>(&text) {
                Ok(data) => data.access_token,
                Err(e) => {
                    println!("Failed to parse token response: {}", e);
                    return HttpResponse::InternalServerError()
                        .json(json!({"error": "Failed to parse token response"}));
                }
            }
        }
        Ok(res) => {
            let status = res.status();
            let _text = res.text().await.unwrap_or_default();
            println!("Token exchange failed with status: {}", status);
            if flow_id_opt.is_some() {
                store.set_cache(
                    &error_cache_key,
                    "Token exchange was rejected by Blizzard.".to_string(),
                );
                store.remove_cache(&status_cache_key);
            }
            return HttpResponse::BadRequest().json(json!({"error": "Failed to exchange code"}));
        }
        Err(e) => {
            println!("Network error during token exchange: {}", e);
            if flow_id_opt.is_some() {
                store.set_cache(
                    &error_cache_key,
                    "Network error during token exchange".to_string(),
                );
                store.remove_cache(&status_cache_key);
            }
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
                    println!("Failed to parse userinfo response: {}", e);
                    return HttpResponse::InternalServerError()
                        .json(json!({"error": "Failed to parse userinfo response"}));
                }
            }
        }
        Ok(res) => {
            let status = res.status();
            let _text = res.text().await.unwrap_or_default();
            println!("Userinfo fetch failed with status: {}", status);
            return HttpResponse::BadRequest().json(json!({"error": "Failed to get userinfo"}));
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

    let session_id = uuid::Uuid::new_v4().to_string();
    state.store_oauth_session(session_id.clone(), access_token);
    let claims = Claims {
        sub: battletag.clone(),
        session_id,
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
    if flow_id_opt.is_some() {
        let cache_key = format!("login_flow_{}", flow_id);
        store.set_cache(&cache_key, token);
    }
    store.remove_cache(&redirect_cache_key);
    store.remove_cache(&client_id_cache_key);
    store.remove_cache(&client_secret_cache_key);
    store.remove_cache(&status_cache_key);

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
        return None;
    };

    let token_data = decode::<Claims>(
        &token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    );

    match token_data {
        Ok(data) => Some(data.claims),
        Err(_) => None,
    }
}

pub async fn get_me(req: HttpRequest, state: web::Data<Arc<BlizzardAuthState>>) -> HttpResponse {
    match verify_jwt(&req, &state.jwt_secret) {
        Some(claims) => HttpResponse::Ok().json(json!({
            "battletag": claims.sub
        })),
        None => HttpResponse::Unauthorized().json(json!({"error": "Not logged in"})),
    }
}

pub async fn bnet_logout(
    req: HttpRequest,
    state: web::Data<Arc<BlizzardAuthState>>,
    store: web::Data<Arc<dyn crate::storage::JobStorage>>,
) -> HttpResponse {
    if let Some(claims) = verify_jwt(&req, &state.jwt_secret) {
        state.remove_oauth_session(&claims.session_id);
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

    let access_token = match state.oauth_token(&claims.session_id) {
        Some(token) => token,
        None => return HttpResponse::Unauthorized().json(json!({"error": "Session expired"})),
    };

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
        let resp = client.get(&url).bearer_auth(&access_token).send().await;

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
    let main_character = store
        .get_user_config(&claims.sub, "main_character")
        .unwrap_or_default();

    HttpResponse::Ok().json(json!({
        "blizzard_client_id": "",
        "has_blizzard_client_secret": false,
        "sim_threads": sim_threads,
        "max_gear_combinations": max_gear_combinations,
        "simc_download_channel": simc_download_channel,
        "simc_sim_channel": simc_sim_channel,
        "app_update_channel": app_update_channel,
        "main_character": main_character,
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

    if body.key != "sim_threads"
        && body.key != "max_gear_combinations"
        && body.key != "simc_download_channel"
        && body.key != "simc_sim_channel"
        && body.key != "app_update_channel"
        && body.key != "main_character"
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
    secrets: web::Data<Arc<dyn BlizzardCredentialSecretStore>>,
    body: web::Json<SystemConfigUpdate>,
) -> HttpResponse {
    save_blizzard_credential_profile(
        store,
        secrets,
        web::Json(SaveBlizzardCredentialProfileRequest {
            name: Some("Main credentials".to_string()),
            client_id: body.client_id.clone(),
            client_secret: body.client_secret.clone(),
        }),
    )
    .await
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
    _req: HttpRequest,
    state: web::Data<Arc<BlizzardAuthState>>,
    _store: web::Data<Arc<dyn crate::storage::JobStorage>>,
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
        .or_else(|| state.client_secret.clone());

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::{JobStorage, MemoryStorage};
    use actix_web::body::to_bytes;
    use actix_web::http::header::HeaderValue;
    use actix_web::test::TestRequest;
    use serde_json::Value;

    fn test_store() -> web::Data<Arc<dyn JobStorage>> {
        web::Data::new(Arc::new(MemoryStorage::new()) as Arc<dyn JobStorage>)
    }

    fn test_secret_store() -> web::Data<Arc<dyn BlizzardCredentialSecretStore>> {
        web::Data::new(Arc::new(MemoryBlizzardCredentialSecretStore::default())
            as Arc<dyn BlizzardCredentialSecretStore>)
    }

    fn auth_state() -> web::Data<Arc<BlizzardAuthState>> {
        web::Data::new(Arc::new(BlizzardAuthState::new(
            None,
            None,
            "http://localhost:3000/api/auth/bnet/callback".to_string(),
            "test-secret".to_string(),
        )))
    }

    fn make_jwt_with_exp(sub: &str, access_token: &str, secret: &str, exp: usize) -> String {
        let claims = Claims {
            sub: sub.to_string(),
            session_id: access_token.to_string(),
            exp,
        };
        encode(
            &Header::default(),
            &claims,
            &EncodingKey::from_secret(secret.as_bytes()),
        )
        .expect("jwt encode")
    }

    fn make_jwt(sub: &str, access_token: &str, secret: &str) -> String {
        make_jwt_with_exp(
            sub,
            access_token,
            secret,
            (SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time")
                .as_secs()
                + 3600) as usize,
        )
    }

    fn now_secs() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_secs()
    }

    async fn body_json(resp: HttpResponse) -> Value {
        let bytes = to_bytes(resp.into_body()).await.expect("response body");
        serde_json::from_slice(&bytes).expect("json response")
    }

    #[test]
    fn get_effective_creds_uses_expected_precedence() {
        let state = BlizzardAuthState::new(
            Some("env-id".to_string()),
            Some("env-secret".to_string()),
            "http://localhost/callback".to_string(),
            "jwt".to_string(),
        );
        let store = MemoryStorage::new();
        let secrets = MemoryBlizzardCredentialSecretStore::default();
        assert_eq!(
            get_effective_creds(&state, &store, &secrets, None),
            Ok(Some(("env-id".to_string(), "env-secret".to_string())))
        );

        assert_eq!(
            get_effective_creds(&state, &store, &secrets, None),
            Ok(Some(("env-id".to_string(), "env-secret".to_string())))
        );

        let no_env_state = BlizzardAuthState::new(
            None,
            None,
            "http://localhost/callback".to_string(),
            "jwt".to_string(),
        );
        assert_eq!(
            get_effective_creds(&no_env_state, &store, &secrets, None),
            Ok(None)
        );
    }

    #[test]
    fn production_jwt_secret_must_be_strong_and_non_default() {
        assert!(validate_jwt_secret(None, false).is_ok());
        assert!(validate_jwt_secret(Some("short".to_string()), true).is_err());
        assert!(validate_jwt_secret(Some("dev-secret-key-123".to_string()), true).is_err());
        assert!(validate_jwt_secret(Some("a".repeat(32)), true).is_err());
        assert!(validate_jwt_secret(
            Some("a-secure-secret-with-more-than-32-bytes".to_string()),
            true
        )
        .is_ok());
    }

    #[actix_web::test]
    async fn get_credentials_status_reports_env_and_saved_profile_configuration() {
        let empty = get_credentials_status(auth_state(), test_store(), test_secret_store()).await;
        assert_eq!(
            body_json(empty).await.get("globally_configured"),
            Some(&Value::Bool(false))
        );

        let incomplete_store = test_store();
        save_blizzard_credential_profiles(
            &***incomplete_store,
            &[BlizzardCredentialProfile {
                id: "missing-secret-profile".to_string(),
                name: "Main credentials".to_string(),
                client_id: "client-id".to_string(),
                created_at: 1,
                updated_at: 1,
            }],
        )
        .expect("save incomplete profile");
        let incomplete =
            get_credentials_status(auth_state(), incomplete_store, test_secret_store()).await;
        assert_eq!(
            body_json(incomplete).await.get("globally_configured"),
            Some(&Value::Bool(false))
        );

        let store = test_store();
        store.set_user_config("system", "blizzard_client_id", "system-id");
        store.set_user_config("system", "blizzard_client_secret", "system-secret");

        let system_configured =
            get_credentials_status(auth_state(), store, test_secret_store()).await;
        assert_eq!(
            body_json(system_configured)
                .await
                .get("globally_configured"),
            Some(&Value::Bool(false))
        );

        let env_state = web::Data::new(Arc::new(BlizzardAuthState::new(
            Some("env-id".to_string()),
            Some("env-secret".to_string()),
            "http://localhost/callback".to_string(),
            "jwt".to_string(),
        )));
        let env_configured =
            get_credentials_status(env_state, test_store(), test_secret_store()).await;
        assert_eq!(
            body_json(env_configured).await.get("globally_configured"),
            Some(&Value::Bool(true))
        );
    }

    #[actix_web::test]
    async fn set_system_blizzard_creds_persists_global_credentials() {
        let store = test_store();
        let secrets = test_secret_store();

        let saved = set_system_blizzard_creds(
            store.clone(),
            secrets.clone(),
            web::Json(SystemConfigUpdate {
                client_id: "system-id".to_string(),
                client_secret: "system-secret".to_string(),
            }),
        )
        .await;
        assert_eq!(saved.status(), 200);
        assert!(store
            .get_user_config("system", "blizzard_client_secret")
            .is_none());
        let profiles = load_blizzard_credential_profiles(&***store);
        assert_eq!(profiles.len(), 1);
        assert_eq!(
            secrets.get_secret(&profiles[0].id).unwrap(),
            Some("system-secret".to_string())
        );

        let status = get_credentials_status(auth_state(), store, secrets).await;
        assert_eq!(
            body_json(status).await.get("globally_configured"),
            Some(&Value::Bool(true))
        );
    }

    #[actix_web::test]
    async fn saved_blizzard_credentials_are_listed_without_secret_values() {
        let store = test_store();
        let secrets = test_secret_store();

        let saved = save_blizzard_credential_profile(
            store.clone(),
            secrets.clone(),
            web::Json(SaveBlizzardCredentialProfileRequest {
                name: Some("Main".to_string()),
                client_id: "client-id".to_string(),
                client_secret: "client-secret".to_string(),
            }),
        )
        .await;
        assert_eq!(saved.status(), 200);

        let listed = list_blizzard_credential_profiles(store, secrets.clone()).await;
        assert_eq!(listed.status(), 200);
        let payload = body_json(listed).await;
        let profiles = payload
            .get("profiles")
            .and_then(Value::as_array)
            .expect("profiles array");
        assert_eq!(profiles.len(), 1);
        assert_eq!(
            profiles[0].get("name").and_then(Value::as_str),
            Some("Main")
        );
        assert_eq!(
            profiles[0].get("client_id").and_then(Value::as_str),
            Some("client-id")
        );
        assert_eq!(
            profiles[0].get("has_secret").and_then(Value::as_bool),
            Some(true)
        );
        assert!(profiles[0].get("client_secret").is_none());

        let profile_id = profiles[0]
            .get("id")
            .and_then(Value::as_str)
            .expect("profile id");
        assert_eq!(
            secrets.get_secret(profile_id).expect("secret read"),
            Some("client-secret".to_string())
        );
    }

    #[actix_web::test]
    async fn saved_blizzard_credentials_can_be_renamed_and_deleted() {
        let store = test_store();
        let secrets = test_secret_store();
        let saved = save_blizzard_credential_profile(
            store.clone(),
            secrets.clone(),
            web::Json(SaveBlizzardCredentialProfileRequest {
                name: Some("Original".to_string()),
                client_id: "client-id".to_string(),
                client_secret: "client-secret".to_string(),
            }),
        )
        .await;
        let saved_payload = body_json(saved).await;
        let profile_id = saved_payload
            .get("profile")
            .and_then(|profile| profile.get("id"))
            .and_then(Value::as_str)
            .expect("profile id")
            .to_string();

        let renamed = rename_blizzard_credential_profile(
            web::Path::from(profile_id.clone()),
            store.clone(),
            secrets.clone(),
            web::Json(RenameBlizzardCredentialProfileRequest {
                name: "Renamed".to_string(),
            }),
        )
        .await;
        assert_eq!(renamed.status(), 200);
        assert_eq!(
            secrets.get_secret(&profile_id).expect("secret read"),
            Some("client-secret".to_string())
        );

        let listed =
            body_json(list_blizzard_credential_profiles(store.clone(), secrets.clone()).await)
                .await;
        assert_eq!(
            listed["profiles"][0].get("name").and_then(Value::as_str),
            Some("Renamed")
        );

        let deleted = delete_blizzard_credential_profile(
            web::Path::from(profile_id.clone()),
            store.clone(),
            secrets.clone(),
        )
        .await;
        assert_eq!(deleted.status(), 200);
        assert_eq!(secrets.get_secret(&profile_id).expect("secret read"), None);
        let listed_after_delete =
            body_json(list_blizzard_credential_profiles(store.clone(), secrets.clone()).await)
                .await;
        assert_eq!(
            listed_after_delete
                .get("profiles")
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(0)
        );
    }

    #[actix_web::test]
    async fn saved_blizzard_credentials_report_missing_secret_and_are_repaired_by_resave() {
        let store = test_store();
        let secrets = test_secret_store();
        let now = now_secs();
        let profile = BlizzardCredentialProfile {
            id: "profile-id".to_string(),
            name: "Main".to_string(),
            client_id: "saved-client-id".to_string(),
            created_at: now,
            updated_at: now,
        };
        save_blizzard_credential_profiles(&***store, &[profile]).expect("save profile");

        let listed =
            body_json(list_blizzard_credential_profiles(store.clone(), secrets.clone()).await)
                .await;
        assert_eq!(
            listed["profiles"][0]
                .get("has_secret")
                .and_then(Value::as_bool),
            Some(false)
        );

        let repaired = save_blizzard_credential_profile(
            store.clone(),
            secrets.clone(),
            web::Json(SaveBlizzardCredentialProfileRequest {
                name: Some("Main credentials".to_string()),
                client_id: "saved-client-id".to_string(),
                client_secret: "saved-client-secret".to_string(),
            }),
        )
        .await;
        assert_eq!(repaired.status(), 200);

        let repaired_payload = body_json(repaired).await;
        assert_eq!(
            repaired_payload["profile"]
                .get("id")
                .and_then(Value::as_str),
            Some("profile-id")
        );
        assert_eq!(
            repaired_payload["profile"]
                .get("has_secret")
                .and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            secrets.get_secret("profile-id").expect("secret read"),
            Some("saved-client-secret".to_string())
        );
    }

    #[actix_web::test]
    async fn bnet_login_uses_saved_credential_profile_without_query_secret() {
        let req = TestRequest::default().to_http_request();
        let state = auth_state();
        let store = test_store();
        let secrets = test_secret_store();

        let saved = save_blizzard_credential_profile(
            store.clone(),
            secrets.clone(),
            web::Json(SaveBlizzardCredentialProfileRequest {
                name: Some("Main".to_string()),
                client_id: "saved-client-id".to_string(),
                client_secret: "saved-client-secret".to_string(),
            }),
        )
        .await;
        let saved_payload = body_json(saved).await;
        let profile_id = saved_payload
            .get("profile")
            .and_then(|profile| profile.get("id"))
            .and_then(Value::as_str)
            .expect("profile id")
            .to_string();

        let resp = bnet_login(
            req,
            state,
            store.clone(),
            secrets,
            web::Query(LoginQuery {
                credential_id: Some(profile_id),
                flow_id: Some("flow-123".to_string()),
            }),
        )
        .await;

        assert_eq!(resp.status(), 302);
        assert_eq!(
            store.get_cache("login_flow_client_id_flow-123"),
            Some("saved-client-id".to_string())
        );
        assert_eq!(
            store.get_cache("login_flow_client_secret_flow-123"),
            Some("saved-client-secret".to_string())
        );
    }

    #[actix_web::test]
    async fn bnet_login_uses_saved_profile_secret_stored_by_client_id() {
        let req = TestRequest::default().to_http_request();
        let state = auth_state();
        let store = test_store();
        let secrets = test_secret_store();
        let now = now_secs();
        let profile = BlizzardCredentialProfile {
            id: "profile-id".to_string(),
            name: "Main".to_string(),
            client_id: "saved-client-id".to_string(),
            created_at: now,
            updated_at: now,
        };
        save_blizzard_credential_profiles(&***store, &[profile]).expect("save profile");
        secrets
            .set_secret("saved-client-id", "saved-client-secret")
            .expect("save legacy secret");

        let resp = bnet_login(
            req,
            state,
            store.clone(),
            secrets,
            web::Query(LoginQuery {
                credential_id: Some("profile-id".to_string()),
                flow_id: Some("flow-123".to_string()),
            }),
        )
        .await;

        assert_eq!(resp.status(), 302);
        assert_eq!(
            store.get_cache("login_flow_client_id_flow-123"),
            Some("saved-client-id".to_string())
        );
        assert_eq!(
            store.get_cache("login_flow_client_secret_flow-123"),
            Some("saved-client-secret".to_string())
        );
    }

    #[actix_web::test]
    async fn bnet_login_reports_missing_saved_profile_secret() {
        let req = TestRequest::default().to_http_request();
        let state = auth_state();
        let store = test_store();
        let secrets = test_secret_store();
        let now = now_secs();
        let profile = BlizzardCredentialProfile {
            id: "profile-id".to_string(),
            name: "Main".to_string(),
            client_id: "saved-client-id".to_string(),
            created_at: now,
            updated_at: now,
        };
        save_blizzard_credential_profiles(&***store, &[profile]).expect("save profile");

        let resp = bnet_login(
            req,
            state,
            store,
            secrets,
            web::Query(LoginQuery {
                credential_id: Some("profile-id".to_string()),
                flow_id: Some("flow-123".to_string()),
            }),
        )
        .await;

        assert_eq!(resp.status(), 400);
        let payload = body_json(resp).await;
        assert_eq!(
            payload.get("error").and_then(Value::as_str),
            Some(
                "Saved Blizzard credentials are missing their secure secret on this device. Re-enter the client secret and save again."
            )
        );
    }

    #[actix_web::test]
    async fn bnet_login_requires_configured_credentials() {
        let req = TestRequest::default().to_http_request();
        let state = auth_state();
        let store = test_store();

        let resp = bnet_login(
            req,
            state,
            store,
            test_secret_store(),
            web::Query(LoginQuery {
                credential_id: None,
                flow_id: None,
            }),
        )
        .await;

        assert_eq!(resp.status(), 400);
        let payload = body_json(resp).await;
        assert_eq!(
            payload.get("error").and_then(Value::as_str),
            Some("Blizzard API Client ID is not configured. Save a credential profile or configure the server environment.")
        );
    }

    #[actix_web::test]
    async fn bnet_login_does_not_accept_credentials_from_query_parameters() {
        let req = TestRequest::with_uri("/?client_id=query-id&client_secret=query-secret")
            .to_http_request();
        let state = auth_state();
        let store = test_store();

        let resp = bnet_login(
            req,
            state,
            store.clone(),
            test_secret_store(),
            web::Query(LoginQuery {
                credential_id: None,
                flow_id: Some("flow-123".to_string()),
            }),
        )
        .await;

        assert_eq!(resp.status(), 400);
        assert!(store
            .get_cache("login_flow_client_secret_flow-123")
            .is_none());
    }

    #[actix_web::test]
    async fn poll_login_returns_token_once_and_clears_flow_keys() {
        let store = test_store();
        store.set_cache("login_flow_abc", "jwt-token".to_string());
        store.set_cache("login_flow_error_abc", "old-error".to_string());
        store.set_cache("login_flow_status_abc", "started".to_string());

        let success = poll_login(
            web::Query(PollQuery {
                flow_id: "abc".to_string(),
            }),
            store.clone(),
        )
        .await;
        assert_eq!(success.status(), 200);
        let body = body_json(success).await;
        assert_eq!(body.get("token").and_then(Value::as_str), Some("jwt-token"));
        assert!(store.get_cache("login_flow_abc").is_none());
        assert!(store.get_cache("login_flow_error_abc").is_none());
        assert!(store.get_cache("login_flow_status_abc").is_none());

        store.set_cache("login_flow_error_abc", "oauth denied".to_string());
        let failed = poll_login(
            web::Query(PollQuery {
                flow_id: "abc".to_string(),
            }),
            store.clone(),
        )
        .await;
        assert_eq!(failed.status(), 400);
        let failed_body = body_json(failed).await;
        assert_eq!(
            failed_body.get("status").and_then(Value::as_str),
            Some("failed")
        );
        assert_eq!(
            failed_body.get("error").and_then(Value::as_str),
            Some("oauth denied")
        );
    }

    #[test]
    fn verify_jwt_reads_cookie_then_bearer_header() {
        let cookie_token = make_jwt("CookieUser#1111", "cookie-token", "test-secret");
        let bearer_token = make_jwt("HeaderUser#2222", "header-token", "test-secret");
        let req = TestRequest::default()
            .cookie(Cookie::new("bnet_session", cookie_token))
            .insert_header((
                header::AUTHORIZATION,
                HeaderValue::from_str(&format!("Bearer {bearer_token}")).expect("header value"),
            ))
            .to_http_request();

        let claims = verify_jwt(&req, "test-secret").expect("valid claims");
        assert_eq!(claims.sub, "CookieUser#1111");

        let header_only = TestRequest::default()
            .insert_header((
                header::AUTHORIZATION,
                HeaderValue::from_str(&format!("Bearer {bearer_token}")).expect("header value"),
            ))
            .to_http_request();
        let header_claims = verify_jwt(&header_only, "test-secret").expect("header claims");
        assert_eq!(header_claims.sub, "HeaderUser#2222");
    }

    #[test]
    fn verify_jwt_rejects_invalid_expired_and_non_bearer_tokens() {
        let valid = make_jwt("Tester#9999", "access", "test-secret");
        let wrong_secret = TestRequest::default()
            .cookie(Cookie::new("bnet_session", valid.clone()))
            .to_http_request();
        assert!(verify_jwt(&wrong_secret, "other-secret").is_none());

        let tampered = format!("{valid}x");
        let tampered_req = TestRequest::default()
            .cookie(Cookie::new("bnet_session", tampered))
            .to_http_request();
        assert!(verify_jwt(&tampered_req, "test-secret").is_none());

        let expired = make_jwt_with_exp(
            "Tester#9999",
            "access",
            "test-secret",
            now_secs().saturating_sub(3600) as usize,
        );
        let expired_req = TestRequest::default()
            .cookie(Cookie::new("bnet_session", expired))
            .to_http_request();
        assert!(verify_jwt(&expired_req, "test-secret").is_none());

        let non_bearer = TestRequest::default()
            .insert_header((header::AUTHORIZATION, HeaderValue::from_static("Basic abc")))
            .to_http_request();
        assert!(verify_jwt(&non_bearer, "test-secret").is_none());
    }

    #[actix_web::test]
    async fn get_me_and_logout_enforce_session_and_clear_sensitive_config() {
        let state = auth_state();
        let store = test_store();
        let unauthorized = get_me(TestRequest::default().to_http_request(), state.clone()).await;
        assert_eq!(unauthorized.status(), 401);

        let token = make_jwt("Tester#9999", "access", "test-secret");
        let authed_req = TestRequest::default()
            .cookie(Cookie::new("bnet_session", token.clone()))
            .to_http_request();
        let me = get_me(authed_req, state.clone()).await;
        assert_eq!(
            body_json(me).await.get("battletag").and_then(Value::as_str),
            Some("Tester#9999")
        );

        store.set_user_config("Tester#9999", "blizzard_client_id", "user-id");
        store.set_user_config("Tester#9999", "blizzard_client_secret", "user-secret");
        store.set_user_config("system", "blizzard_client_id", "system-id");
        store.set_user_config("system", "blizzard_client_secret", "system-secret");

        let logout_req = TestRequest::default()
            .cookie(Cookie::new("bnet_session", token))
            .to_http_request();
        let logout = bnet_logout(logout_req, state, store.clone()).await;
        assert_eq!(logout.status(), 200);
        assert!(store
            .get_user_config("Tester#9999", "blizzard_client_id")
            .is_none());
        assert!(store
            .get_user_config("Tester#9999", "blizzard_client_secret")
            .is_none());
        assert!(store
            .get_user_config("system", "blizzard_client_id")
            .is_none());
        assert!(store
            .get_user_config("system", "blizzard_client_secret")
            .is_none());

        let cookies = logout
            .headers()
            .iter()
            .filter(|(name, _)| **name == header::SET_COOKIE)
            .map(|(_, value)| value)
            .filter_map(|value| value.to_str().ok())
            .collect::<Vec<_>>();
        assert!(cookies
            .iter()
            .any(|cookie| cookie.starts_with("bnet_session=") && cookie.contains("Max-Age=0")));
        assert!(cookies
            .iter()
            .any(|cookie| cookie.starts_with("temp_bnet_id=") && cookie.contains("Max-Age=0")));
        assert!(cookies
            .iter()
            .any(|cookie| cookie.starts_with("temp_bnet_secret=") && cookie.contains("Max-Age=0")));
    }

    #[actix_web::test]
    async fn get_characters_requires_session_and_reads_user_scoped_cache() {
        let state = auth_state();
        let store = test_store();

        let unauthorized = get_characters(
            TestRequest::default().to_http_request(),
            state.clone(),
            store.clone(),
            web::Query(RefreshQuery { refresh: None }),
        )
        .await;
        assert_eq!(unauthorized.status(), 401);

        store.set_cache(
            "user_characters_Tester#9999",
            json!({
                "characters": [{
                    "name": "Tester",
                    "realm": "area-52",
                    "region": "us"
                }]
            })
            .to_string(),
        );
        store.set_cache(
            "user_characters_Other#1111",
            json!({"characters": [{"name": "Other"}]}).to_string(),
        );

        let token = make_jwt("Tester#9999", "access", "test-secret");
        let req = TestRequest::default()
            .cookie(Cookie::new("bnet_session", token))
            .to_http_request();
        let cached = get_characters(
            req,
            state,
            store,
            web::Query(RefreshQuery {
                refresh: Some(false),
            }),
        )
        .await;
        assert_eq!(cached.status(), 200);

        let payload = body_json(cached).await;
        let characters = payload
            .get("characters")
            .and_then(Value::as_array)
            .expect("characters array");
        assert_eq!(characters.len(), 1);
        assert_eq!(
            characters[0].get("name").and_then(Value::as_str),
            Some("Tester")
        );
    }

    #[actix_web::test]
    async fn set_user_config_validates_keys_and_persists_for_authenticated_user() {
        let state = auth_state();
        let store = test_store();
        let token = make_jwt("Tester#9999", "access", "test-secret");
        let req = TestRequest::default()
            .cookie(Cookie::new("bnet_session", token))
            .to_http_request();

        let invalid = set_user_config(
            req.clone(),
            state.clone(),
            store.clone(),
            web::Json(UserConfigUpdate {
                key: "invalid_key".to_string(),
                value: "x".to_string(),
            }),
        )
        .await;
        assert_eq!(invalid.status(), 400);

        let credential_rejected = set_user_config(
            req.clone(),
            state.clone(),
            store.clone(),
            web::Json(UserConfigUpdate {
                key: "blizzard_client_secret".to_string(),
                value: "must-not-be-persisted".to_string(),
            }),
        )
        .await;
        assert_eq!(credential_rejected.status(), 400);

        let valid = set_user_config(
            req,
            state,
            store.clone(),
            web::Json(UserConfigUpdate {
                key: "sim_threads".to_string(),
                value: "8".to_string(),
            }),
        )
        .await;
        assert_eq!(valid.status(), 200);
        assert_eq!(
            store.get_user_config("Tester#9999", "sim_threads"),
            Some("8".to_string())
        );
    }

    #[actix_web::test]
    async fn user_configs_require_session_and_exclude_credential_values() {
        let state = auth_state();
        let store = test_store();

        let unauthorized = get_user_configs(
            TestRequest::default().to_http_request(),
            state.clone(),
            store.clone(),
        )
        .await;
        assert_eq!(unauthorized.status(), 401);

        store.set_user_config("Tester#9999", "blizzard_client_id", "client-id");
        store.set_user_config("Tester#9999", "blizzard_client_secret", "client-secret");
        store.set_user_config("Tester#9999", "sim_threads", "8");
        store.set_user_config("Other#1111", "sim_threads", "99");

        let token = make_jwt("Tester#9999", "access", "test-secret");
        let req = TestRequest::default()
            .cookie(Cookie::new("bnet_session", token))
            .to_http_request();
        let resp = get_user_configs(req, state, store).await;
        assert_eq!(resp.status(), 200);

        let payload = body_json(resp).await;
        assert_eq!(
            payload.get("blizzard_client_id").and_then(Value::as_str),
            Some("")
        );
        assert_eq!(
            payload
                .get("has_blizzard_client_secret")
                .and_then(Value::as_bool),
            Some(false)
        );
        assert!(payload.get("blizzard_client_secret").is_none());
        assert_eq!(
            payload.get("sim_threads").and_then(Value::as_str),
            Some("8")
        );
    }

    #[actix_web::test]
    async fn clear_user_configs_requires_session_and_only_removes_blizzard_credentials() {
        let state = auth_state();
        let store = test_store();

        let unauthorized = clear_user_configs(
            TestRequest::default().to_http_request(),
            state.clone(),
            store.clone(),
        )
        .await;
        assert_eq!(unauthorized.status(), 401);

        store.set_user_config("Tester#9999", "blizzard_client_id", "client-id");
        store.set_user_config("Tester#9999", "blizzard_client_secret", "client-secret");
        store.set_user_config("Tester#9999", "sim_threads", "8");
        store.set_user_config("Other#1111", "blizzard_client_id", "other-client");

        let token = make_jwt("Tester#9999", "access", "test-secret");
        let req = TestRequest::default()
            .cookie(Cookie::new("bnet_session", token))
            .to_http_request();
        let cleared = clear_user_configs(req, state, store.clone()).await;
        assert_eq!(cleared.status(), 200);

        assert!(store
            .get_user_config("Tester#9999", "blizzard_client_id")
            .is_none());
        assert!(store
            .get_user_config("Tester#9999", "blizzard_client_secret")
            .is_none());
        assert_eq!(
            store.get_user_config("Tester#9999", "sim_threads"),
            Some("8".to_string())
        );
        assert_eq!(
            store.get_user_config("Other#1111", "blizzard_client_id"),
            Some("other-client".to_string())
        );
    }
}
