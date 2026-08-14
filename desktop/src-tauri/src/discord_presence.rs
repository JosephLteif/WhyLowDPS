use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use serde::Serialize;
use std::sync::{Arc, Mutex};

use crate::app_logic::{save_close_preferences, AppClosePreferencesState};

const MAX_ACTIVITY_TEXT_LENGTH: usize = 128;

#[derive(Clone, Debug, Default)]
pub(crate) struct DiscordPresenceState {
    client: Arc<Mutex<Option<DiscordIpcClient>>>,
    connected_client_id: Arc<Mutex<Option<String>>>,
    last_error: Arc<Mutex<Option<String>>>,
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct DiscordPresenceSettingsResponse {
    pub(crate) enabled: bool,
    pub(crate) client_id: Option<String>,
    pub(crate) configured: bool,
    pub(crate) connected: bool,
    pub(crate) message: String,
}

#[derive(Clone, Debug, serde::Deserialize)]
pub(crate) struct DiscordPresenceUpdate {
    pub(crate) route: String,
    pub(crate) character_name: Option<String>,
    pub(crate) realm: Option<String>,
}

impl DiscordPresenceState {
    pub(crate) fn settings(
        &self,
        preferences: &AppClosePreferencesState,
    ) -> DiscordPresenceSettingsResponse {
        let prefs = preferences.prefs.lock().ok();
        let enabled = prefs
            .as_ref()
            .and_then(|value| value.discord_presence_enabled)
            .unwrap_or(false);
        let client_id = prefs.and_then(|value| value.discord_client_id.clone());
        let connected = self.is_connected();
        let message = if !enabled {
            "Discord Rich Presence is disabled.".to_string()
        } else if client_id.is_none() {
            "Add a Discord Application ID to enable Rich Presence.".to_string()
        } else if connected {
            "Connected to Discord.".to_string()
        } else {
            self.last_error
                .lock()
                .ok()
                .and_then(|value| value.clone())
                .unwrap_or_else(|| "Waiting for the Discord desktop app.".to_string())
        };

        DiscordPresenceSettingsResponse {
            enabled,
            configured: client_id.is_some(),
            client_id,
            connected,
            message,
        }
    }

    pub(crate) fn apply_settings(
        &self,
        preferences: &AppClosePreferencesState,
        enabled: bool,
        client_id: Option<String>,
    ) -> Result<DiscordPresenceSettingsResponse, String> {
        let normalized_client_id = client_id.and_then(normalize_client_id);
        if enabled && normalized_client_id.is_none() {
            return Err(
                "A Discord Application ID is required to enable Rich Presence.".to_string(),
            );
        }

        {
            let mut prefs = preferences
                .prefs
                .lock()
                .map_err(|error| error.to_string())?;
            prefs.discord_presence_enabled = Some(enabled);
            prefs.discord_client_id = normalized_client_id;
            save_close_preferences(&preferences.path, &prefs)?;
        }

        if !enabled {
            self.clear();
        } else {
            let _ = self.update(
                preferences,
                DiscordPresenceUpdate {
                    route: "/".to_string(),
                    character_name: None,
                    realm: None,
                },
            );
        }

        Ok(self.settings(preferences))
    }

    pub(crate) fn update(
        &self,
        preferences: &AppClosePreferencesState,
        update: DiscordPresenceUpdate,
    ) -> DiscordPresenceSettingsResponse {
        let settings = self.settings(preferences);
        if !settings.enabled || !settings.configured {
            return settings;
        }

        let client_id = settings.client_id.clone().unwrap_or_default();
        let activity = build_activity(&update);
        let mut client_guard = match self.client.lock() {
            Ok(guard) => guard,
            Err(_) => return self.with_error(preferences, "Discord Rich Presence is unavailable."),
        };

        let connected_id = self
            .connected_client_id
            .lock()
            .ok()
            .and_then(|value| value.clone());
        if connected_id.as_deref() != Some(client_id.as_str()) {
            if let Some(mut client) = client_guard.take() {
                let _ = client.close();
            }
            if let Ok(mut value) = self.connected_client_id.lock() {
                *value = None;
            }
        }

        if client_guard.is_none() {
            let mut client = DiscordIpcClient::new(&client_id);
            if let Err(error) = client.connect() {
                drop(client_guard);
                return self.with_error(preferences, &format!("Discord is not available: {error}"));
            }
            *client_guard = Some(client);
            if let Ok(mut value) = self.connected_client_id.lock() {
                *value = Some(client_id);
            }
        }

        if let Some(client) = client_guard.as_mut() {
            if let Err(error) = client.set_activity(activity) {
                let _ = client.close();
                client_guard.take();
                if let Ok(mut value) = self.connected_client_id.lock() {
                    *value = None;
                }
                drop(client_guard);
                return self.with_error(
                    preferences,
                    &format!("Discord Rich Presence update failed: {error}"),
                );
            }
        }

        if let Ok(mut error) = self.last_error.lock() {
            *error = None;
        }
        drop(client_guard);
        self.settings(preferences)
    }

    pub(crate) fn clear(&self) {
        if let Ok(mut client) = self.client.lock() {
            if let Some(mut client) = client.take() {
                let _ = client.clear_activity();
                let _ = client.close();
            }
        }
        if let Ok(mut value) = self.connected_client_id.lock() {
            *value = None;
        }
    }

    fn is_connected(&self) -> bool {
        self.client
            .lock()
            .map(|value| value.is_some())
            .unwrap_or(false)
    }

    fn with_error(
        &self,
        preferences: &AppClosePreferencesState,
        message: &str,
    ) -> DiscordPresenceSettingsResponse {
        if let Ok(mut error) = self.last_error.lock() {
            *error = Some(message.to_string());
        }
        self.settings(preferences)
    }
}

fn normalize_client_id(value: String) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || !trimmed.chars().all(|character| character.is_ascii_digit()) {
        return None;
    }
    Some(trimmed.to_string())
}

fn build_activity(update: &DiscordPresenceUpdate) -> activity::Activity<'static> {
    let details = truncate_activity_text(route_label(&update.route));
    let state = match (update.character_name.as_deref(), update.realm.as_deref()) {
        (Some(name), Some(realm)) if !name.trim().is_empty() && !realm.trim().is_empty() => {
            format!("Playing {name} on {realm}")
        }
        (Some(name), _) if !name.trim().is_empty() => format!("Playing as {name}"),
        _ => "Exploring the app".to_string(),
    };

    activity::Activity::new()
        .name("WhyLowDPS")
        .details(details)
        .state(truncate_activity_text(state))
}

fn route_label(route: &str) -> String {
    let route = route.split('?').next().unwrap_or(route);
    if route.starts_with("/sim/") {
        return "Watching a simulation".to_string();
    }
    match route {
        "/" => "Checking the dashboard".to_string(),
        "/quick-sim" => "Preparing a Quick Sim".to_string(),
        "/top-gear" => "Optimizing gear".to_string(),
        "/drop-finder" => "Finding upgrades".to_string(),
        "/upgrade-compare" => "Comparing upgrades".to_string(),
        "/history" => "Reviewing simulation history".to_string(),
        "/dungeons" | "/dungeon-routes" => "Planning dungeon routes".to_string(),
        "/settings" => "Managing settings".to_string(),
        _ => "Exploring WhyLowDPS".to_string(),
    }
}

fn truncate_activity_text(value: String) -> String {
    let mut chars = value.chars();
    let truncated: String = chars.by_ref().take(MAX_ACTIVITY_TEXT_LENGTH).collect();
    if chars.next().is_some() {
        format!(
            "{}…",
            truncated
                .chars()
                .take(MAX_ACTIVITY_TEXT_LENGTH - 1)
                .collect::<String>()
        )
    } else {
        truncated
    }
}

#[cfg(test)]
mod tests {
    use super::{normalize_client_id, route_label, truncate_activity_text};

    #[test]
    fn client_id_accepts_public_numeric_application_ids_only() {
        assert_eq!(
            normalize_client_id(" 1234567890 ".to_string()),
            Some("1234567890".to_string())
        );
        assert_eq!(normalize_client_id("abc".to_string()), None);
        assert_eq!(normalize_client_id("".to_string()), None);
    }

    #[test]
    fn route_labels_are_user_facing() {
        assert_eq!(
            route_label("/quick-sim?source=history"),
            "Preparing a Quick Sim"
        );
        assert_eq!(route_label("/unknown"), "Exploring WhyLowDPS");
    }

    #[test]
    fn activity_text_is_bounded() {
        let text = truncate_activity_text("a".repeat(200));
        assert_eq!(text.chars().count(), 128);
        assert!(text.ends_with('…'));
    }
}
