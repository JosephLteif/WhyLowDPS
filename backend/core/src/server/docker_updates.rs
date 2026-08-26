use std::sync::Arc;
use std::time::Duration;

use actix_web::{web, HttpRequest, HttpResponse};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;

use super::auth_handlers::{self, BlizzardAuthState};
use crate::storage::JobStorage;

const CONFIG_MODE: &str = "docker_update_mode";
const CONFIG_INTERVAL: &str = "docker_update_interval_minutes";
const CONFIG_LAST_TRIGGERED: &str = "docker_update_last_triggered_at";
const DEFAULT_INTERVAL_MINUTES: u64 = 1_440;
const MIN_INTERVAL_MINUTES: u64 = 60;
const MAX_INTERVAL_MINUTES: u64 = 10_080;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
enum DockerUpdateMode {
    Manual,
    Automatic,
}

impl Default for DockerUpdateMode {
    fn default() -> Self {
        Self::Manual
    }
}

#[derive(Debug, Deserialize)]
pub(crate) struct DockerUpdateRequest {
    action: Option<String>,
    interval_minutes: Option<u64>,
    mode: Option<DockerUpdateMode>,
}

#[derive(Debug, Serialize)]
struct DockerUpdateStatus {
    available: bool,
    configured: bool,
    interval_minutes: u64,
    last_triggered_at: Option<String>,
    manager: Option<&'static str>,
    mode: DockerUpdateMode,
}

struct UpdateManagerConfig {
    token: String,
    url: String,
}

fn update_manager_config() -> UpdateManagerConfig {
    UpdateManagerConfig {
        token: std::env::var("WHYLOWDPS_DOCKER_UPDATE_TOKEN")
            .unwrap_or_default()
            .trim()
            .to_owned(),
        url: std::env::var("WHYLOWDPS_DOCKER_UPDATE_URL")
            .unwrap_or_else(|_| "http://watchtower:8080".to_owned())
            .trim_end_matches('/')
            .to_owned(),
    }
}

pub(crate) fn is_configured() -> bool {
    let config = update_manager_config();
    !config.token.is_empty() && config.token != "disabled" && !config.url.is_empty()
}

fn settings(store: &dyn JobStorage) -> (DockerUpdateMode, u64, Option<String>) {
    let mode = match store.get_user_config("system", CONFIG_MODE).as_deref() {
        Some("automatic") => DockerUpdateMode::Automatic,
        _ => DockerUpdateMode::Manual,
    };
    let interval_minutes = store
        .get_user_config("system", CONFIG_INTERVAL)
        .and_then(|value| value.parse::<u64>().ok())
        .map(clamp_interval)
        .unwrap_or(DEFAULT_INTERVAL_MINUTES);
    let last_triggered_at = store.get_user_config("system", CONFIG_LAST_TRIGGERED);
    (mode, interval_minutes, last_triggered_at)
}

fn clamp_interval(interval_minutes: u64) -> u64 {
    interval_minutes.clamp(MIN_INTERVAL_MINUTES, MAX_INTERVAL_MINUTES)
}

async fn trigger_update(config: &UpdateManagerConfig) -> Result<(), String> {
    let response = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|error| format!("Could not create the update client: {error}"))?
        .post(format!("{}/v1/update", config.url))
        .bearer_auth(&config.token)
        .send()
        .await
        .map_err(|error| format!("Could not reach the Docker update manager: {error}"))?;

    if response.status().is_success() {
        return Ok(());
    }

    let status = response.status();
    let detail = response
        .text()
        .await
        .unwrap_or_default()
        .chars()
        .take(200)
        .collect::<String>();
    Err(if detail.is_empty() {
        format!("Docker update manager returned {status}")
    } else {
        format!("Docker update manager returned {status}: {detail}")
    })
}

async fn manager_available(config: &UpdateManagerConfig) -> bool {
    if !is_configured() {
        return false;
    }
    let Ok(client) = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(2))
        .timeout(Duration::from_secs(3))
        .build()
    else {
        return false;
    };
    client.get(&config.url).send().await.is_ok()
}

async fn status(store: &dyn JobStorage) -> DockerUpdateStatus {
    let config = update_manager_config();
    let (mode, interval_minutes, last_triggered_at) = settings(store);
    let configured = is_configured();
    DockerUpdateStatus {
        available: configured && manager_available(&config).await,
        configured,
        interval_minutes,
        last_triggered_at,
        manager: configured.then_some("watchtower"),
        mode,
    }
}

pub(crate) fn spawn_scheduler(store: Arc<dyn JobStorage>) {
    tokio::spawn(async move {
        let manager = update_manager_config();
        let mut ticker = tokio::time::interval(Duration::from_secs(60));
        ticker.tick().await;

        loop {
            ticker.tick().await;
            let (mode, interval_minutes, last_triggered_at) = settings(&*store);
            if mode != DockerUpdateMode::Automatic || !is_configured() {
                continue;
            }

            let due = last_triggered_at
                .as_deref()
                .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
                .map(|last| {
                    Utc::now().signed_duration_since(last).num_minutes() >= interval_minutes as i64
                })
                .unwrap_or(true);
            if !due {
                continue;
            }

            let triggered_at = Utc::now().to_rfc3339();
            store.set_user_config("system", CONFIG_LAST_TRIGGERED, &triggered_at);
            if let Err(error) = trigger_update(&manager).await {
                eprintln!("Automatic Docker update failed: {error}");
            }
        }
    });
}

pub(crate) async fn get_status(
    req: HttpRequest,
    state: web::Data<BlizzardAuthState>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    if !auth_handlers::hosted_private_deployment() {
        return HttpResponse::NotFound().finish();
    }
    if let Err(response) = auth_handlers::require_admin(&req, state.get_ref(), &***store) {
        return response;
    }
    HttpResponse::Ok().json(status(&***store).await)
}

pub(crate) async fn update(
    req: HttpRequest,
    state: web::Data<BlizzardAuthState>,
    store: web::Data<Arc<dyn JobStorage>>,
    body: web::Json<DockerUpdateRequest>,
) -> HttpResponse {
    if !auth_handlers::hosted_private_deployment() {
        return HttpResponse::NotFound().finish();
    }
    if let Err(response) = auth_handlers::require_admin(&req, state.get_ref(), &***store) {
        return response;
    }

    if body.action.as_deref() == Some("update") {
        let config = update_manager_config();
        if !is_configured() {
            return HttpResponse::ServiceUnavailable().json(json!({
                "error": "Docker updates are not enabled. Start Compose with the updates profile and configure WHYLOWDPS_DOCKER_UPDATE_TOKEN."
            }));
        }
        return match trigger_update(&config).await {
            Ok(()) => {
                store.set_user_config("system", CONFIG_LAST_TRIGGERED, &Utc::now().to_rfc3339());
                HttpResponse::Accepted().json(status(&***store).await)
            }
            Err(error) => HttpResponse::BadGateway().json(json!({ "error": error })),
        };
    }

    if body.action.is_some() {
        return HttpResponse::BadRequest().json(json!({
            "error": "Docker update action must be update"
        }));
    }

    if let Some(mode) = body.mode {
        store.set_user_config(
            "system",
            CONFIG_MODE,
            match mode {
                DockerUpdateMode::Manual => "manual",
                DockerUpdateMode::Automatic => "automatic",
            },
        );
    }
    if let Some(interval_minutes) = body.interval_minutes {
        if !(MIN_INTERVAL_MINUTES..=MAX_INTERVAL_MINUTES).contains(&interval_minutes) {
            return HttpResponse::BadRequest().json(json!({
                "error": format!("Docker update interval must be between {MIN_INTERVAL_MINUTES} and {MAX_INTERVAL_MINUTES} minutes")
            }));
        }
        store.set_user_config(
            "system",
            CONFIG_INTERVAL,
            &clamp_interval(interval_minutes).to_string(),
        );
    }

    HttpResponse::Ok().json(status(&***store).await)
}

#[cfg(test)]
mod tests {
    use super::{
        clamp_interval, DockerUpdateMode, DEFAULT_INTERVAL_MINUTES, MAX_INTERVAL_MINUTES,
        MIN_INTERVAL_MINUTES,
    };

    #[test]
    fn update_intervals_are_clamped_to_safe_bounds() {
        assert_eq!(clamp_interval(1), MIN_INTERVAL_MINUTES);
        assert_eq!(
            clamp_interval(DEFAULT_INTERVAL_MINUTES),
            DEFAULT_INTERVAL_MINUTES
        );
        assert_eq!(
            clamp_interval(MAX_INTERVAL_MINUTES + 1),
            MAX_INTERVAL_MINUTES
        );
    }

    #[test]
    fn update_modes_serialize_as_api_values() {
        assert_eq!(
            serde_json::to_string(&DockerUpdateMode::Automatic).unwrap(),
            "\"automatic\""
        );
    }
}
