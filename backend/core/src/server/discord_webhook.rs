use actix_web::{web, HttpRequest, HttpResponse};
use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;

use crate::models::{extract_result_summary, Job};
use crate::storage::JobStorage;

use super::auth_handlers::{verify_active_session, BlizzardAuthState};

const WEBHOOK_URL_KEY: &str = "discord_webhook_url";
const WEBHOOK_ENABLED_KEY: &str = "discord_webhook_enabled";
const WEBHOOK_NOTIFICATION_TYPE_PREFIX: &str = "discord_webhook_notification_";
const NOTIFICATION_TYPE_KEYS: &[&str] = &[
    "quick",
    "top_gear",
    "droptimizer",
    "stat_weights",
    "stat_plot",
    "upgrade_compare",
    "matrices",
    "heatmaps",
    "other",
];
const DISCORD_HOSTS: &[&str] = &[
    "discord.com",
    "discordapp.com",
    "canary.discord.com",
    "ptb.discord.com",
];

#[derive(Debug, Deserialize)]
pub(crate) struct UpdateDiscordWebhookRequest {
    pub enabled: bool,
    pub url: Option<String>,
    #[serde(default)]
    pub clear: bool,
    #[serde(default)]
    pub notification_types: Option<BTreeMap<String, bool>>,
}

#[derive(Debug, Serialize)]
pub(crate) struct DiscordWebhookSettingsResponse {
    pub enabled: bool,
    pub configured: bool,
    pub notification_types: BTreeMap<String, bool>,
}

fn authenticated_owner(
    req: &HttpRequest,
    auth: &BlizzardAuthState,
    store: &dyn JobStorage,
) -> Result<String, HttpResponse> {
    verify_active_session(req, auth, store)
        .map(|claims| claims.sub)
        .ok_or_else(|| HttpResponse::Unauthorized().json(json!({ "error": "Not logged in" })))
}

fn settings_response(
    owner_id: &str,
    auth: &BlizzardAuthState,
    store: &dyn JobStorage,
) -> DiscordWebhookSettingsResponse {
    let configured = store
        .get_user_config(owner_id, WEBHOOK_URL_KEY)
        .and_then(|value| auth.decrypt_private_value(&value))
        .is_some();
    let enabled = configured
        && store
            .get_user_config(owner_id, WEBHOOK_ENABLED_KEY)
            .is_some_and(|value| value == "true");

    DiscordWebhookSettingsResponse {
        enabled,
        configured,
        notification_types: notification_preferences(owner_id, store),
    }
}

fn notification_preferences(owner_id: &str, store: &dyn JobStorage) -> BTreeMap<String, bool> {
    NOTIFICATION_TYPE_KEYS
        .iter()
        .map(|key| {
            let enabled = store
                .get_user_config(owner_id, &notification_config_key(key))
                .map(|value| value == "true")
                .unwrap_or(true);
            ((*key).to_string(), enabled)
        })
        .collect()
}

fn notification_config_key(notification_type: &str) -> String {
    format!("{WEBHOOK_NOTIFICATION_TYPE_PREFIX}{notification_type}")
}

fn notification_type_for_sim(sim_type: &str) -> &str {
    match sim_type {
        "quick" => "quick",
        "top_gear" | "top_gear_exact_stats" => "top_gear",
        "droptimizer" => "droptimizer",
        "stat_weights" => "stat_weights",
        "stat_plot" => "stat_plot",
        "upgrade_compare" => "upgrade_compare",
        "external_buff_matrix" | "consumable_matrix" => "matrices",
        "trinket_tier_heatmap" => "heatmaps",
        _ => "other",
    }
}

fn notification_type_enabled(owner_id: &str, sim_type: &str, store: &dyn JobStorage) -> bool {
    store
        .get_user_config(
            owner_id,
            &notification_config_key(notification_type_for_sim(sim_type)),
        )
        .map(|value| value == "true")
        .unwrap_or(true)
}

pub(crate) fn validate_webhook_url(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw).map_err(|_| "Enter a valid Discord webhook URL.".to_string())?;
    let host = url
        .host_str()
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| "Discord webhook URL must include a hostname.".to_string())?;
    let path_segments: Vec<_> = url
        .path_segments()
        .map(|segments| segments.collect())
        .unwrap_or_default();

    if url.scheme() != "https"
        || url.port().is_some()
        || url.username() != ""
        || url.password().is_some()
        || !DISCORD_HOSTS.contains(&host.as_str())
        || path_segments.len() != 4
        || path_segments[0] != "api"
        || path_segments[1] != "webhooks"
        || path_segments[2].is_empty()
        || path_segments[3].is_empty()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Use a standard HTTPS Discord webhook URL.".to_string());
    }

    Ok(url)
}

fn load_webhook_url(
    owner_id: &str,
    auth: &BlizzardAuthState,
    store: &dyn JobStorage,
) -> Option<String> {
    store
        .get_user_config(owner_id, WEBHOOK_URL_KEY)
        .and_then(|value| auth.decrypt_private_value(&value))
        .and_then(|value| validate_webhook_url(&value).ok())
        .map(|url| url.to_string())
}

pub(crate) async fn get_settings(
    req: HttpRequest,
    auth: web::Data<Arc<BlizzardAuthState>>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    let owner_id = match authenticated_owner(&req, auth.get_ref(), store.get_ref().as_ref()) {
        Ok(owner_id) => owner_id,
        Err(response) => return response,
    };

    HttpResponse::Ok().json(settings_response(
        &owner_id,
        auth.get_ref(),
        store.get_ref().as_ref(),
    ))
}

pub(crate) async fn update_settings(
    req: HttpRequest,
    auth: web::Data<Arc<BlizzardAuthState>>,
    store: web::Data<Arc<dyn JobStorage>>,
    body: web::Json<UpdateDiscordWebhookRequest>,
) -> HttpResponse {
    let owner_id = match authenticated_owner(&req, auth.get_ref(), store.get_ref().as_ref()) {
        Ok(owner_id) => owner_id,
        Err(response) => return response,
    };

    let normalized_url = body
        .url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(validate_webhook_url)
        .transpose();
    let normalized_url = match normalized_url {
        Ok(url) => url,
        Err(error) => return HttpResponse::BadRequest().json(json!({ "error": error })),
    };

    if body.clear && normalized_url.is_some() {
        return HttpResponse::BadRequest()
            .json(json!({ "error": "Choose a new URL or clear the saved webhook, not both." }));
    }

    let currently_configured =
        load_webhook_url(&owner_id, auth.get_ref(), store.get_ref().as_ref()).is_some();
    let will_be_configured = if body.clear {
        false
    } else {
        normalized_url.is_some() || currently_configured
    };
    if body.enabled && !will_be_configured {
        return HttpResponse::BadRequest()
            .json(json!({ "error": "Save a Discord webhook URL before enabling notifications." }));
    }

    if let Some(notification_types) = &body.notification_types {
        if let Some(invalid_type) = notification_types
            .keys()
            .find(|key| !NOTIFICATION_TYPE_KEYS.contains(&key.as_str()))
        {
            return HttpResponse::BadRequest().json(json!({
                "error": format!("Unknown Discord notification type: {invalid_type}")
            }));
        }
    }

    if body.clear {
        store.remove_user_config(&owner_id, WEBHOOK_URL_KEY);
    } else if let Some(url) = normalized_url {
        let encrypted = match auth.encrypt_private_value(url.as_str()) {
            Ok(value) => value,
            Err(error) => {
                eprintln!("Failed to encrypt Discord webhook URL: {error}");
                return HttpResponse::InternalServerError()
                    .json(json!({ "error": "Could not save the Discord webhook securely." }));
            }
        };
        store.set_user_config(&owner_id, WEBHOOK_URL_KEY, &encrypted);
    }

    store.set_user_config(
        &owner_id,
        WEBHOOK_ENABLED_KEY,
        if body.enabled { "true" } else { "false" },
    );

    if let Some(notification_types) = &body.notification_types {
        for (notification_type, enabled) in notification_types {
            store.set_user_config(
                &owner_id,
                &notification_config_key(notification_type),
                if *enabled { "true" } else { "false" },
            );
        }
    }

    HttpResponse::Ok().json(settings_response(
        &owner_id,
        auth.get_ref(),
        store.get_ref().as_ref(),
    ))
}

pub(crate) async fn send_test(
    req: HttpRequest,
    auth: web::Data<Arc<BlizzardAuthState>>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    let owner_id = match authenticated_owner(&req, auth.get_ref(), store.get_ref().as_ref()) {
        Ok(owner_id) => owner_id,
        Err(response) => return response,
    };
    let Some(url) = load_webhook_url(&owner_id, auth.get_ref(), store.get_ref().as_ref()) else {
        return HttpResponse::BadRequest()
            .json(json!({ "error": "Save a Discord webhook URL before testing it." }));
    };

    match post_webhook(&url, test_payload()).await {
        Ok(()) => HttpResponse::Ok().json(json!({ "status": "sent" })),
        Err(error) => {
            eprintln!("Discord webhook test failed: {error}");
            HttpResponse::BadGateway()
                .json(json!({ "error": "Discord did not accept the test notification." }))
        }
    }
}

pub(crate) fn spawn_sim_completion_notification(
    store: Arc<dyn JobStorage>,
    auth: Arc<BlizzardAuthState>,
    job_id: String,
) {
    tokio::spawn(async move {
        let Some(job) = store.get(&job_id) else {
            return;
        };
        let enabled = store
            .get_user_config(&job.owner_id, WEBHOOK_ENABLED_KEY)
            .is_some_and(|value| value == "true");
        if !enabled || !notification_type_enabled(&job.owner_id, &job.sim_type, store.as_ref()) {
            return;
        }
        let Some(url) = load_webhook_url(&job.owner_id, auth.as_ref(), store.as_ref()) else {
            return;
        };

        if let Err(error) = post_webhook(&url, completion_payload(&job)).await {
            eprintln!(
                "Discord webhook delivery failed for simulation {}: {error}",
                job.id
            );
        }
    });
}

async fn post_webhook(url: &str, payload: Value) -> Result<(), String> {
    let response = reqwest::Client::new()
        .post(url)
        .timeout(Duration::from_secs(10))
        .json(&payload)
        .send()
        .await
        .map_err(|_| "Discord request failed".to_string())?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err(format!("Discord returned HTTP {}", response.status()))
    }
}

fn test_payload() -> Value {
    json!({
        "username": "WhyLowDPS",
        "allowed_mentions": { "parse": [] },
        "embeds": [{
            "title": "Discord notifications connected",
            "description": "WhyLowDPS can now notify you when a simulation finishes.",
            "color": 13936555
        }]
    })
}

fn simulation_label(sim_type: &str) -> String {
    match sim_type {
        "quick" => "Quick Sim".to_string(),
        "top_gear" | "top_gear_exact_stats" => "Top Gear".to_string(),
        "droptimizer" => "Drop Finder".to_string(),
        "stat_weights" => "Quick Weights".to_string(),
        "stat_plot" => "Stat Plot".to_string(),
        "upgrade_compare" => "Upgrade Compare".to_string(),
        "external_buff_matrix" => "External Buff Matrix".to_string(),
        "consumable_matrix" => "Consumable Matrix".to_string(),
        "trinket_tier_heatmap" => "Trinket / Tier Heatmap".to_string(),
        other if other.is_empty() => "Simulation".to_string(),
        other => other.replace('_', " "),
    }
}

fn simulation_color(sim_type: &str) -> u32 {
    match sim_type {
        "quick" => 0x3B82F6,
        "top_gear" | "top_gear_exact_stats" => 0xF59E0B,
        "droptimizer" => 0x10B981,
        "stat_weights" => 0x8B5CF6,
        "stat_plot" => 0xEC4899,
        "upgrade_compare" => 0xF97316,
        "external_buff_matrix" => 0x06B6D4,
        "consumable_matrix" => 0x14B8A6,
        "trinket_tier_heatmap" => 0xEF4444,
        _ => 0x6B7280,
    }
}

fn result_number<'a>(result: &'a Value, key: &str) -> Option<f64> {
    result.get(key).and_then(Value::as_f64)
}

fn add_field(fields: &mut Vec<Value>, name: &str, value: String, inline: bool) {
    fields.push(json!({
        "name": name,
        "value": value,
        "inline": inline,
    }));
}

fn add_result_highlights(fields: &mut Vec<Value>, result: &Value, sim_type: &str) {
    if matches!(
        sim_type,
        "top_gear" | "top_gear_exact_stats" | "droptimizer"
    ) {
        if let Some(results) = result.get("results").and_then(Value::as_array) {
            let candidates = results
                .iter()
                .filter(|entry| {
                    !entry
                        .get("name")
                        .and_then(Value::as_str)
                        .is_some_and(|name| name.starts_with("Currently Equipped"))
                })
                .count();
            add_field(fields, "Candidates", candidates.to_string(), true);

            if let Some((name, delta)) = results
                .iter()
                .filter_map(|entry| {
                    let delta = entry.get("delta").and_then(Value::as_f64)?;
                    if delta <= 0.0 {
                        return None;
                    }
                    Some((
                        entry
                            .get("name")
                            .and_then(Value::as_str)
                            .unwrap_or("Best upgrade"),
                        delta,
                    ))
                })
                .max_by(|left, right| {
                    left.1
                        .partial_cmp(&right.1)
                        .unwrap_or(std::cmp::Ordering::Equal)
                })
            {
                add_field(
                    fields,
                    "Best gain",
                    format!("{name} (+{delta:.0} DPS)"),
                    false,
                );
            }
        }
    }

    if let Some(abilities) = result.get("abilities").and_then(Value::as_array) {
        let top_abilities = abilities
            .iter()
            .take(3)
            .filter_map(|ability| {
                let name = ability.get("name").and_then(Value::as_str)?;
                let dps = ability.get("portion_dps").and_then(Value::as_f64)?;
                Some(format!("{name}: {dps:.0} DPS"))
            })
            .collect::<Vec<_>>();
        if !top_abilities.is_empty() {
            add_field(fields, "Top damage", top_abilities.join("\n"), false);
        }
    }

    if let Some(weights) = result.get("stat_weights").and_then(Value::as_object) {
        let mut top_weights = weights
            .iter()
            .filter_map(|(stat, value)| Some((stat, value.as_f64()?)))
            .collect::<Vec<_>>();
        top_weights.sort_by(|left, right| {
            right
                .1
                .partial_cmp(&left.1)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        let top_weights = top_weights
            .into_iter()
            .take(4)
            .map(|(stat, value)| format!("{stat}: {value:.2}"))
            .collect::<Vec<_>>();
        if !top_weights.is_empty() {
            add_field(fields, "Top stat weights", top_weights.join(" · "), false);
        }
    }

    if let Some(stat_plots) = result.get("stat_plots").and_then(Value::as_object) {
        let plotted_stats = stat_plots.keys().take(6).cloned().collect::<Vec<_>>();
        if !plotted_stats.is_empty() {
            add_field(fields, "Plotted stats", plotted_stats.join(", "), false);
        }
    }
}

fn completion_payload(job: &Job) -> Value {
    let summary = extract_result_summary(&job.result_json, &job.simc_input);
    let result = job
        .result_json
        .as_deref()
        .and_then(|value| serde_json::from_str::<Value>(value).ok())
        .unwrap_or_else(|| json!({}));
    let player = summary.player_name.as_deref().unwrap_or("Simulation");
    let simulation = simulation_label(&job.sim_type);
    let character = summary
        .player_class
        .as_deref()
        .filter(|class| !class.is_empty() && *class != "Unknown")
        .map(|class| format!("{player} · {class}"))
        .unwrap_or_else(|| player.to_string());
    let dps = result_number(&result, "dps")
        .or_else(|| result_number(&result, "base_dps"))
        .or(summary.dps);
    let mut fields = Vec::with_capacity(16);
    add_field(&mut fields, "Character", character, true);
    add_field(&mut fields, "Simulation", simulation.clone(), true);
    if let Some(realm) = summary.realm.as_deref().or(job.linked_realm.as_deref()) {
        add_field(&mut fields, "Realm", realm.to_string(), true);
    }
    if let Some(dps) = dps {
        let dps_error = result_number(&result, "dps_error");
        let dps_error_pct = result_number(&result, "dps_error_pct");
        let dps_value = match (dps_error, dps_error_pct) {
            (Some(error), Some(error_pct)) if error > 0.0 => {
                format!("{dps:.0} ± {error:.0} ({error_pct:.2}%)")
            }
            _ => format!("{dps:.0}"),
        };
        add_field(&mut fields, "DPS", dps_value, true);
    }
    add_field(&mut fields, "Fight style", job.fight_style.clone(), true);
    if let Some(fight_length) = result_number(&result, "fight_length") {
        add_field(
            &mut fields,
            "Fight length",
            format!("{fight_length:.1}s"),
            true,
        );
    }
    if let Some(targets) = result.get("desired_targets").and_then(Value::as_u64) {
        add_field(&mut fields, "Targets", targets.to_string(), true);
    }
    let iterations = result
        .get("iterations")
        .and_then(Value::as_u64)
        .filter(|iterations| *iterations > 0)
        .unwrap_or(job.iterations as u64);
    if iterations > 0 {
        add_field(&mut fields, "Iterations", iterations.to_string(), true);
    }
    let target_error = result_number(&result, "target_error").unwrap_or(job.target_error);
    if target_error > 0.0 {
        add_field(
            &mut fields,
            "Target error",
            format!("{:.1}%", target_error * 100.0),
            true,
        );
    }
    if let Some(elapsed) = result_number(&result, "elapsed_time_seconds") {
        add_field(&mut fields, "Runtime", format!("{elapsed:.1}s"), true);
    }
    if let Some(upgrades) = summary.upgrades {
        add_field(&mut fields, "Upgrades", upgrades.to_string(), true);
    }
    if let Some(downgrades) = summary.downgrades {
        add_field(&mut fields, "Downgrades", downgrades.to_string(), true);
    }
    add_result_highlights(&mut fields, &result, &job.sim_type);

    let simc_version = result
        .get("simc_version")
        .and_then(Value::as_str)
        .filter(|version| !version.is_empty())
        .unwrap_or("SimC");

    json!({
        "username": "WhyLowDPS",
        "allowed_mentions": { "parse": [] },
        "embeds": [{
            "title": format!("{simulation} finished"),
            "description": format!("{player}'s {simulation} is ready."),
            "color": simulation_color(&job.sim_type),
            "fields": fields,
            "footer": { "text": format!("WhyLowDPS · {simc_version}") }
        }]
    })
}

#[cfg(test)]
mod tests {
    use super::{
        completion_payload, notification_config_key, notification_type_enabled,
        notification_type_for_sim, validate_webhook_url,
    };
    use crate::models::Job;
    use crate::storage::{JobStorage, MemoryStorage};
    use serde_json::Value;

    #[test]
    fn validates_only_standard_discord_webhook_urls() {
        assert!(validate_webhook_url("https://discord.com/api/webhooks/123/token").is_ok());
        assert!(validate_webhook_url("http://discord.com/api/webhooks/123/token").is_err());
        assert!(validate_webhook_url("https://example.com/api/webhooks/123/token").is_err());
        assert!(validate_webhook_url("https://discord.com/api/webhooks/123/token?x=1").is_err());
    }

    #[test]
    fn completion_payload_contains_result_summary() {
        let mut job = Job::new(
            "mage=\"Alice\"\nserver=illidan\n".to_string(),
            "quick".to_string(),
            1000,
            "Patchwerk".to_string(),
            0.1,
        );
        job.result_json = Some(
            r#"{
                "player_name":"Alice",
                "player_class":"Fire",
                "dps":12345.6,
                "dps_error":45.6,
                "dps_error_pct":0.37,
                "fight_length":300.0,
                "desired_targets":1,
                "iterations":1000,
                "elapsed_time_seconds":12.5,
                "simc_version":"SimC  v1"
            }"#
            .to_string(),
        );

        let payload = completion_payload(&job);
        assert_eq!(
            payload["embeds"][0]["title"],
            Value::String("Quick Sim finished".to_string())
        );
        assert_eq!(payload["embeds"][0]["color"], 0x3B82F6);
        let fields = payload["embeds"][0]["fields"].as_array().unwrap();
        assert_eq!(
            fields
                .iter()
                .find(|field| field["name"] == "Character")
                .unwrap()["value"],
            "Alice · Fire"
        );
        assert_eq!(
            fields.iter().find(|field| field["name"] == "DPS").unwrap()["value"],
            "12346 ± 46 (0.37%)"
        );
        assert_eq!(
            fields
                .iter()
                .find(|field| field["name"] == "Fight length")
                .unwrap()["value"],
            "300.0s"
        );
    }

    #[test]
    fn notification_types_group_simulation_variants() {
        assert_eq!(notification_type_for_sim("quick"), "quick");
        assert_eq!(
            notification_type_for_sim("top_gear_exact_stats"),
            "top_gear"
        );
        assert_eq!(
            notification_type_for_sim("external_buff_matrix"),
            "matrices"
        );
        assert_eq!(notification_type_for_sim("unknown_sim"), "other");
    }

    #[test]
    fn notification_types_default_to_enabled_and_respect_saved_values() {
        let store = MemoryStorage::new();

        assert!(notification_type_enabled("owner-1", "quick", &store));
        store.set_user_config("owner-1", &notification_config_key("quick"), "false");
        assert!(!notification_type_enabled("owner-1", "quick", &store));
        assert!(notification_type_enabled("owner-1", "top_gear", &store));
    }
}
