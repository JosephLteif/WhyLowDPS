use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::Mutex;

use super::{perform_sync, SyncStatus};
use crate::server::auth_handlers::BlizzardAuthState;
use crate::server::blizzard::BlizzardState;
use crate::storage::JobStorage;

pub struct DataSyncState {
    pub status: Mutex<SyncStatus>,
    pub progress: Mutex<String>,
    pub operation_lock: Mutex<()>,
}

impl DataSyncState {
    pub fn new() -> Self {
        Self {
            status: Mutex::new(SyncStatus::Ready),
            progress: Mutex::new(String::new()),
            operation_lock: Mutex::new(()),
        }
    }
}

fn get_background_credentials(
    auth_state: &BlizzardAuthState,
    _store: &dyn JobStorage,
) -> Option<(String, String)> {
    if let (Some(id), Some(sec)) = (&auth_state.client_id, &auth_state.client_secret) {
        return Some((id.clone(), sec.clone()));
    }

    None
}

fn is_background_sync_due(data_dir: Option<&Path>, threshold_hours: i64) -> bool {
    let Some(dir) = data_dir else {
        return true;
    };
    let runtime_file = dir.join("blizzard-runtime-data.json");
    let content = match std::fs::read_to_string(runtime_file) {
        Ok(content) => content,
        Err(_) => return true,
    };
    let parsed: Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => return true,
    };
    let last_sync_str = match parsed.get("last_sync").and_then(|v| v.as_str()) {
        Some(s) => s,
        None => return true,
    };
    let last_sync = match chrono::DateTime::parse_from_rfc3339(last_sync_str) {
        Ok(ts) => ts.with_timezone(&chrono::Utc),
        Err(_) => return true,
    };
    chrono::Utc::now()
        .signed_duration_since(last_sync)
        .num_hours()
        >= threshold_hours
}

pub fn spawn_background_sync_loop(
    state: Arc<DataSyncState>,
    auth_state: Arc<BlizzardAuthState>,
    blizzard: Arc<BlizzardState>,
    store: Arc<dyn JobStorage>,
    data_dir: Option<PathBuf>,
) {
    tokio::spawn(async move {
        let poll_duration = tokio::time::Duration::from_secs(10 * 60);
        let stale_threshold_hours = 6;

        loop {
            let due = is_background_sync_due(data_dir.as_deref(), stale_threshold_hours);
            let already_syncing = {
                let status = state.status.lock().await;
                *status == SyncStatus::Syncing
            };

            if due && !already_syncing {
                if let Some((client_id, client_secret)) =
                    get_background_credentials(auth_state.as_ref(), &*store)
                {
                    {
                        let mut status = state.status.lock().await;
                        *status = SyncStatus::Syncing;
                    }
                    {
                        let mut progress = state.progress.lock().await;
                        *progress = "Auto:0:1:Scheduled background data sync...".to_string();
                    }

                    let result = perform_sync(
                        state.clone(),
                        blizzard.clone(),
                        client_id,
                        client_secret,
                        data_dir.clone(),
                        false,
                    )
                    .await;

                    let mut status = state.status.lock().await;
                    *status = match result {
                        Ok(_) => SyncStatus::Ready,
                        Err(err) => SyncStatus::Error(err),
                    };
                }
            }

            tokio::time::sleep(poll_duration).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::server::auth_handlers::BlizzardAuthState;
    use crate::storage::{JobStorage, MemoryStorage};
    use serde_json::json;
    use std::sync::Arc;

    #[test]
    fn background_sync_is_due_without_usable_runtime_file() {
        assert!(is_background_sync_due(None, 6));

        let temp = tempfile::tempdir().expect("temp dir");
        assert!(is_background_sync_due(Some(temp.path()), 6));

        std::fs::write(temp.path().join("blizzard-runtime-data.json"), "{bad json")
            .expect("write invalid runtime data");
        assert!(is_background_sync_due(Some(temp.path()), 6));

        std::fs::write(temp.path().join("blizzard-runtime-data.json"), "{}")
            .expect("write missing timestamp runtime data");
        assert!(is_background_sync_due(Some(temp.path()), 6));
    }

    #[test]
    fn background_sync_uses_last_sync_age_threshold() {
        let temp = tempfile::tempdir().expect("temp dir");
        let runtime_file = temp.path().join("blizzard-runtime-data.json");
        let fresh = chrono::Utc::now() - chrono::Duration::hours(2);
        std::fs::write(
            &runtime_file,
            json!({ "last_sync": fresh.to_rfc3339() }).to_string(),
        )
        .expect("write fresh runtime data");
        assert!(!is_background_sync_due(Some(temp.path()), 6));

        let stale = chrono::Utc::now() - chrono::Duration::hours(8);
        std::fs::write(
            &runtime_file,
            json!({ "last_sync": stale.to_rfc3339() }).to_string(),
        )
        .expect("write stale runtime data");
        assert!(is_background_sync_due(Some(temp.path()), 6));
    }

    #[test]
    fn background_credentials_use_only_auth_state_configuration() {
        let store = MemoryStorage::new();
        store.set_user_config("system", "blizzard_client_id", "system-id");
        store.set_user_config("system", "blizzard_client_secret", "system-secret");
        let auth = BlizzardAuthState::new(
            Some("auth-id".to_string()),
            Some("auth-secret".to_string()),
            "http://localhost/callback".to_string(),
            "jwt-secret".to_string(),
        );

        assert_eq!(
            get_background_credentials(&auth, &store),
            Some(("auth-id".to_string(), "auth-secret".to_string()))
        );

        let fallback_store = MemoryStorage::new();
        assert_eq!(
            get_background_credentials(&auth, &fallback_store),
            Some(("auth-id".to_string(), "auth-secret".to_string()))
        );
    }

    #[test]
    fn background_credentials_require_complete_pair() {
        let auth = BlizzardAuthState::new(
            Some("auth-id".to_string()),
            None,
            "http://localhost/callback".to_string(),
            "jwt-secret".to_string(),
        );
        let store = MemoryStorage::new();
        store.set_user_config("system", "blizzard_client_id", "system-id");

        assert_eq!(get_background_credentials(&auth, &store), None);

        let empty_store: Arc<dyn JobStorage> = Arc::new(MemoryStorage::new());
        let empty_auth = BlizzardAuthState::new(
            None,
            None,
            "http://localhost/callback".to_string(),
            "jwt-secret".to_string(),
        );
        assert_eq!(
            get_background_credentials(&empty_auth, empty_store.as_ref()),
            None
        );
    }
}
