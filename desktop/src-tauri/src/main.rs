#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::Mutex;
use std::time::Duration;
use std::{collections::HashMap, collections::HashSet};
use serde_json::Value;
use tauri::path::BaseDirectory;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::Emitter;
use tauri::Listener;
use tauri::Manager;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::WindowEvent;
use tokio::sync::mpsc;
use tokio::io::AsyncWriteExt;
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;
use whylowdps_core::game_data;
use whylowdps_core::server;
use whylowdps_core::storage::{JobStorage, SqliteStorage};

fn seed_runtime_data_if_missing(bundled_data_dir: &Path, runtime_data_dir: &Path) {
    let bundled_classes = bundled_data_dir.join("classes.json");
    if !bundled_classes.exists() {
        return;
    }

    let mut stack: Vec<(PathBuf, PathBuf)> =
        vec![(bundled_data_dir.to_path_buf(), runtime_data_dir.to_path_buf())];
    while let Some((src_dir, dst_dir)) = stack.pop() {
        let _ = std::fs::create_dir_all(&dst_dir);
        let entries = match std::fs::read_dir(&src_dir) {
            Ok(entries) => entries,
            Err(_) => continue,
        };

        for entry in entries.flatten() {
            let src_path = entry.path();
            let dst_path = dst_dir.join(entry.file_name());
            if src_path.is_dir() {
                stack.push((src_path, dst_path));
            } else if src_path.is_file() && !dst_path.exists() {
                if let Some(parent) = dst_path.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                let _ = std::fs::copy(&src_path, &dst_path);
            }
        }
    }
}

#[tauri::command]
async fn open_auth_window(handle: tauri::AppHandle, url: String) -> Result<(), String> {
    tauri::WebviewWindowBuilder::new(
        &handle,
        "auth",
        tauri::WebviewUrl::External(url.parse::<url::Url>().map_err(|e| e.to_string())?),
    )
    .title("Blizzard Login")
    .inner_size(600.0, 750.0)
    .resizable(true)
    .always_on_top(true)
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn open_external_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| format!("Failed to open external URL: {e}"))
}

#[tauri::command]
fn open_data_dir(app: tauri::AppHandle) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
    let data_dir = app_data_dir.join("data");
    std::fs::create_dir_all(&data_dir).map_err(|e| format!("Failed to create data dir: {e}"))?;

    let status = if cfg!(target_os = "windows") {
        std::process::Command::new("explorer")
            .arg(data_dir.as_os_str())
            .status()
    } else if cfg!(target_os = "macos") {
        std::process::Command::new("open")
            .arg(data_dir.as_os_str())
            .status()
    } else {
        std::process::Command::new("xdg-open")
            .arg(data_dir.as_os_str())
            .status()
    }
    .map_err(|e| format!("Failed to launch file explorer: {e}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "File explorer exited with status: {}",
            status
                .code()
                .map(|c| c.to_string())
                .unwrap_or_else(|| "unknown".to_string())
        ))
    }
}

#[derive(serde::Serialize)]
struct SystemInfo {
    os: String,
    exe_path: String,
    data_dir: String,
    simc_dir: String,
    data_valid: bool,
    simc_valid: bool,
    api_url: String,
    version: String,
}

#[derive(Debug, serde::Deserialize)]
struct SimNotificationSummary {
    id: String,
    status: String,
    sim_type: String,
    player_name: Option<String>,
    linked_name: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
struct SimTrackEventPayload {
    sims: Vec<SimTrackEventItem>,
}

#[derive(Debug, Clone, serde::Deserialize)]
struct SimTrackEventItem {
    id: String,
    sim_type: Option<String>,
    player_name: Option<String>,
    linked_name: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
struct SimStatusResponse {
    status: String,
    #[serde(default)]
    sim_type: String,
    #[serde(default)]
    simc_input: String,
    linked_name: Option<String>,
    result: Option<Value>,
}

#[derive(Debug)]
enum SimWatcherCommand {
    Track(Vec<SimTrackEventItem>),
}

#[derive(Debug, Clone)]
struct SimWatcherMeta {
    sim_type: String,
    player_name: Option<String>,
    linked_name: Option<String>,
}

impl SimWatcherMeta {
    fn from_summary(summary: &SimNotificationSummary) -> Self {
        Self {
            sim_type: summary.sim_type.clone(),
            player_name: summary.player_name.clone(),
            linked_name: summary.linked_name.clone(),
        }
    }

    fn from_event(item: &SimTrackEventItem) -> Self {
        Self {
            sim_type: item
                .sim_type
                .clone()
                .filter(|v| !v.trim().is_empty())
                .unwrap_or_else(|| "quick".to_string()),
            player_name: item.player_name.clone(),
            linked_name: item.linked_name.clone(),
        }
    }
}

#[derive(Clone, Debug, Default, serde::Deserialize, serde::Serialize)]
struct AppClosePreferences {
    minimize_to_tray_on_close: Option<bool>,
}

#[derive(Debug)]
struct AppClosePreferencesState {
    prefs: Mutex<AppClosePreferences>,
    path: PathBuf,
}

#[derive(serde::Serialize)]
struct CloseBehaviorPreferenceResponse {
    minimize_to_tray_on_close: Option<bool>,
}

fn load_close_preferences(path: &Path) -> AppClosePreferences {
    if !path.exists() {
        return AppClosePreferences::default();
    }
    let raw = match std::fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(_) => return AppClosePreferences::default(),
    };
    serde_json::from_str::<AppClosePreferences>(&raw).unwrap_or_default()
}

fn save_close_preferences(path: &Path, prefs: &AppClosePreferences) -> Result<(), String> {
    let payload = serde_json::to_string_pretty(prefs).map_err(|e| e.to_string())?;
    std::fs::write(path, payload).map_err(|e| e.to_string())
}

fn set_close_behavior_preference_internal(
    state: &AppClosePreferencesState,
    minimize_to_tray_on_close: bool,
) -> Result<(), String> {
    let mut prefs = state.prefs.lock().map_err(|e| e.to_string())?;
    prefs.minimize_to_tray_on_close = Some(minimize_to_tray_on_close);
    save_close_preferences(&state.path, &prefs)
}

fn clear_close_behavior_preference_internal(state: &AppClosePreferencesState) -> Result<(), String> {
    let mut prefs = state.prefs.lock().map_err(|e| e.to_string())?;
    prefs.minimize_to_tray_on_close = None;
    save_close_preferences(&state.path, &prefs)
}

#[tauri::command]
fn get_close_behavior_preference(
    state: tauri::State<'_, AppClosePreferencesState>,
) -> CloseBehaviorPreferenceResponse {
    let minimize_to_tray_on_close = state
        .prefs
        .lock()
        .ok()
        .and_then(|prefs| prefs.minimize_to_tray_on_close);
    CloseBehaviorPreferenceResponse {
        minimize_to_tray_on_close,
    }
}

#[tauri::command]
fn set_close_behavior_preference(
    state: tauri::State<'_, AppClosePreferencesState>,
    minimize_to_tray_on_close: bool,
) -> Result<(), String> {
    set_close_behavior_preference_internal(&state, minimize_to_tray_on_close)
}

#[tauri::command]
fn clear_close_behavior_preference(
    state: tauri::State<'_, AppClosePreferencesState>,
) -> Result<(), String> {
    clear_close_behavior_preference_internal(&state)
}

#[tauri::command]
fn apply_close_behavior_choice(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppClosePreferencesState>,
    minimize_to_tray_on_close: bool,
) -> Result<(), String> {
    set_close_behavior_preference_internal(&state, minimize_to_tray_on_close)?;
    if minimize_to_tray_on_close {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.hide();
        }
    } else {
        app.exit(0);
    }
    Ok(())
}

#[tauri::command]
fn restart_app(app: tauri::AppHandle) {
    app.restart();
}

#[tauri::command]
fn quit_app_now(app: tauri::AppHandle) {
    app.exit(0);
}

#[derive(Clone, serde::Serialize)]
struct DirectInstallProgressEvent {
    status: String,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    message: Option<String>,
}

#[tauri::command]
async fn download_and_install_release(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let parsed_url = url::Url::parse(&url).map_err(|e| format!("Invalid update URL: {e}"))?;
    let filename = parsed_url
        .path_segments()
        .and_then(|mut segments| segments.next_back())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or("whylowdps-update-installer.exe")
        .to_string();

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
    let updates_dir = app_data_dir.join("updates");
    std::fs::create_dir_all(&updates_dir).map_err(|e| format!("Failed to create updates dir: {e}"))?;
    let installer_path = updates_dir.join(filename);

    let client = reqwest::Client::new();
    let mut response = client
        .get(parsed_url)
        .send()
        .await
        .map_err(|e| format!("Update download request failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Update download failed: {e}"))?;
    let total_bytes = response.content_length();

    let _ = app.emit(
        "whylowdps-direct-install-progress",
        DirectInstallProgressEvent {
            status: "started".to_string(),
            downloaded_bytes: 0,
            total_bytes,
            message: Some("Downloading installer...".to_string()),
        },
    );

    let mut file = tokio::fs::File::create(&installer_path)
        .await
        .map_err(|e| format!("Failed to create installer file: {e}"))?;
    let mut downloaded_bytes: u64 = 0;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("Failed while downloading installer: {e}"))?
    {
        downloaded_bytes += chunk.len() as u64;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Failed while writing installer file: {e}"))?;
        let _ = app.emit(
            "whylowdps-direct-install-progress",
            DirectInstallProgressEvent {
                status: "progress".to_string(),
                downloaded_bytes,
                total_bytes,
                message: None,
            },
        );
    }
    file.flush()
        .await
        .map_err(|e| format!("Failed to finalize installer file: {e}"))?;
    // Important on Windows: close file handle before launching the installer.
    drop(file);

    let _ = app.emit(
        "whylowdps-direct-install-progress",
        DirectInstallProgressEvent {
            status: "finished".to_string(),
            downloaded_bytes,
            total_bytes,
            message: Some("Installer downloaded. Launching installer...".to_string()),
        },
    );

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }

    std::process::Command::new(&installer_path)
        .spawn()
        .map_err(|e| format!("Failed to launch installer: {e}"))?;
    // Give the UI thread a tiny window to process "finished" event, then exit cleanly.
    tokio::time::sleep(Duration::from_millis(150)).await;
    app.exit(0);
    Ok(())
}

fn is_active_status(status: &str) -> bool {
    status == "pending" || status == "running"
}

fn is_terminal_status(status: &str) -> bool {
    status == "done" || status == "failed" || status == "cancelled"
}

fn sim_type_label(sim_type: &str) -> &str {
    match sim_type {
        "quick" => "Quick Sim",
        "top_gear" => "Top Gear",
        "droptimizer" => "Drop Finder",
        "upgrade_compare" => "Upgrade Compare",
        _ => sim_type,
    }
}

fn notification_title(status: &str) -> &'static str {
    match status {
        "done" => "Simulation Finished",
        "failed" => "Simulation Failed",
        "cancelled" => "Simulation Cancelled",
        _ => "Simulation Update",
    }
}

fn parse_simc_player_name(simc_input: &str) -> Option<String> {
    let actor_keys = [
        "warrior",
        "paladin",
        "hunter",
        "rogue",
        "priest",
        "death_knight",
        "deathknight",
        "shaman",
        "mage",
        "warlock",
        "monk",
        "druid",
        "demon_hunter",
        "demonhunter",
        "evoker",
        "player",
        "name",
    ];
    for raw in simc_input.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim().to_ascii_lowercase();
        if actor_keys.contains(&key.as_str()) {
            let cleaned = value.trim().trim_matches('"').to_string();
            if !cleaned.is_empty() {
                return Some(cleaned);
            }
        }
    }
    None
}

fn extract_dps_from_result(result: &Value) -> Option<f64> {
    let candidates = [
        result.pointer("/statistics/raid_dps/mean"),
        result.pointer("/statistics/dps"),
        result.pointer("/dps"),
    ];
    for candidate in candidates {
        let Some(value) = candidate else {
            continue;
        };
        if let Some(num) = value.as_f64() {
            return Some(num);
        }
        if let Some(num) = value.as_i64() {
            return Some(num as f64);
        }
        if let Some(text) = value.as_str() {
            if let Ok(num) = text.parse::<f64>() {
                return Some(num);
            }
        }
    }
    None
}

fn handle_track_command(
    items: Vec<SimTrackEventItem>,
    tracked_active: &mut HashMap<String, SimWatcherMeta>,
    notified_sims: &mut HashSet<String>,
) {
    for item in items {
        if item.id.trim().is_empty() {
            continue;
        }
        tracked_active
            .entry(item.id.clone())
            .or_insert_with(|| SimWatcherMeta::from_event(&item));
        notified_sims.remove(&item.id);
    }
}

async fn run_sim_notification_watcher(
    notifier_handle: tauri::AppHandle,
    mut rx: mpsc::UnboundedReceiver<SimWatcherCommand>,
) {
    let client = reqwest::Client::new();
    let mut tracked_active: HashMap<String, SimWatcherMeta> = HashMap::new();
    let mut notified_sims: HashSet<String> = HashSet::new();

    // One startup scan to attach to pre-existing active sims.
    for _ in 0..30 {
        let scan = client
            .get("http://127.0.0.1:17384/api/sims")
            .send()
            .await
            .and_then(|resp| resp.error_for_status());
        if let Ok(resp) = scan {
            if let Ok(sims) = resp.json::<Vec<SimNotificationSummary>>().await {
                for sim in sims {
                    if is_active_status(&sim.status) {
                        tracked_active.insert(sim.id.clone(), SimWatcherMeta::from_summary(&sim));
                    } else if is_terminal_status(&sim.status) {
                        notified_sims.insert(sim.id);
                    }
                }
                break;
            }
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
    }

    loop {
        while let Ok(cmd) = rx.try_recv() {
            match cmd {
                SimWatcherCommand::Track(items) => {
                    handle_track_command(items, &mut tracked_active, &mut notified_sims);
                }
            }
        }

        if tracked_active.is_empty() {
            let Some(cmd) = rx.recv().await else {
                break;
            };
            match cmd {
                SimWatcherCommand::Track(items) => {
                    handle_track_command(items, &mut tracked_active, &mut notified_sims);
                }
            }
            continue;
        }

        tokio::select! {
            cmd = rx.recv() => {
                let Some(cmd) = cmd else {
                    break;
                };
                match cmd {
                    SimWatcherCommand::Track(items) => {
                        handle_track_command(items, &mut tracked_active, &mut notified_sims);
                    }
                }
            }
            _ = tokio::time::sleep(Duration::from_secs(5)) => {
                let ids: Vec<String> = tracked_active.keys().cloned().collect();
                for id in ids {
                    let status_url = format!("http://127.0.0.1:17384/api/sim/{id}");
                    let status_resp = client
                        .get(&status_url)
                        .send()
                        .await
                        .and_then(|resp| resp.error_for_status());
                    let Ok(resp) = status_resp else {
                        continue;
                    };
                    let Ok(status) = resp.json::<SimStatusResponse>().await else {
                        continue;
                    };

                    if is_active_status(&status.status) {
                        continue;
                    }
                    if !is_terminal_status(&status.status) {
                        continue;
                    }

                    let meta = tracked_active.remove(&id).unwrap_or(SimWatcherMeta {
                        sim_type: status.sim_type.clone(),
                        player_name: None,
                        linked_name: None,
                    });
                    if notified_sims.contains(&id) {
                        continue;
                    }

                    let player = status
                        .linked_name
                        .clone()
                        .or(meta.linked_name.clone())
                        .or(meta.player_name.clone())
                        .or_else(|| parse_simc_player_name(&status.simc_input))
                        .unwrap_or_else(|| "Simulation".to_string());

                    let resolved_sim_type = if status.sim_type.trim().is_empty() {
                        meta.sim_type
                    } else {
                        status.sim_type.clone()
                    };
                    let sim_type = sim_type_label(&resolved_sim_type);

                    let dps = status
                        .result
                        .as_ref()
                        .and_then(extract_dps_from_result);

                    let body = if status.status == "done" {
                        match dps {
                            Some(v) => format!("{player} - {sim_type} - {} DPS", v.round() as i64),
                            None => format!("{player} - {sim_type}"),
                        }
                    } else {
                        format!("{player} - {sim_type} - {}", status.status)
                    };

                    let _ = notifier_handle
                        .notification()
                        .builder()
                        .title(notification_title(&status.status))
                        .body(body)
                        .show();

                    notified_sims.insert(id);
                }
            }
        }
    }
}

#[tauri::command]
async fn get_system_info(app: tauri::AppHandle) -> Result<SystemInfo, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("./"));
    let data_dir = app_data_dir.join("data");
    let simc_dir = app
        .path()
        .resolve("simc", BaseDirectory::Resource)
        .unwrap_or_else(|_| app_data_dir.join("simc"));
    // Specifically check for critical files
    let classes_json = data_dir.join("classes.json");
    let simc_exe = if cfg!(windows) {
        simc_dir.join("simc.exe")
    } else {
        simc_dir.join("simc")
    };

    Ok(SystemInfo {
        os: std::env::consts::OS.to_string(),
        exe_path: std::env::current_exe()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| "Unknown".to_string()),
        data_dir: data_dir.to_string_lossy().to_string(),
        simc_dir: simc_dir.to_string_lossy().to_string(),
        data_valid: classes_json.exists(),
        simc_valid: simc_exe.exists(),
        api_url: "http://localhost:17384".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
    })
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            open_auth_window,
            open_external_url,
            open_data_dir,
            get_system_info,
            get_close_behavior_preference,
            set_close_behavior_preference,
            clear_close_behavior_preference,
            apply_close_behavior_choice,
            restart_app,
            quit_app_now,
            download_and_install_release
        ])
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("./"));
            if !app_data_dir.exists() {
                let _ = std::fs::create_dir_all(&app_data_dir);
            }
            let close_prefs_path = app_data_dir.join("desktop_prefs.json");
            let close_prefs = load_close_preferences(&close_prefs_path);
            app.manage(AppClosePreferencesState {
                prefs: Mutex::new(close_prefs),
                path: close_prefs_path,
            });

            let app_handle = app.handle().clone();
            let notifier_handle = app_handle.clone();
            let show_item = MenuItemBuilder::with_id("show_app", "Show WhyLowDps").build(app)?;
            let dashboard_item = MenuItemBuilder::with_id("open_dashboard", "Dashboard").build(app)?;
            let quick_sim_item = MenuItemBuilder::with_id("quick_sim", "Quick Sim").build(app)?;
            let top_gear_item = MenuItemBuilder::with_id("top_gear", "Top Gear").build(app)?;
            let drop_finder_item =
                MenuItemBuilder::with_id("drop_finder", "Drop Finder").build(app)?;
            let dungeons_item = MenuItemBuilder::with_id("dungeons", "Dungeons").build(app)?;
            let history_item = MenuItemBuilder::with_id("history", "Simulation History").build(app)?;
            let settings_item = MenuItemBuilder::with_id("settings", "Settings").build(app)?;
            let check_updates_item =
                MenuItemBuilder::with_id("check_updates", "Check for Updates").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit_app", "Quit WhyLowDps").build(app)?;
            let tray_menu = MenuBuilder::new(app)
                .item(&show_item)
                .separator()
                .item(&dashboard_item)
                .item(&quick_sim_item)
                .item(&top_gear_item)
                .item(&drop_finder_item)
                .item(&dungeons_item)
                .item(&history_item)
                .item(&settings_item)
                .separator()
                .item(&check_updates_item)
                .separator()
                .item(&quit_item)
                .build()?;

            let mut tray_builder = TrayIconBuilder::with_id("main-tray")
                .menu(&tray_menu)
                .tooltip("WhyLowDps")
                .show_menu_on_left_click(false)
                .on_menu_event(move |app: &tauri::AppHandle, event: tauri::menu::MenuEvent| {
                    let focus_main_window = |app: &tauri::AppHandle| -> Option<tauri::WebviewWindow> {
                        let window = app.get_webview_window("main")?;
                        let _ = window.show();
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                        Some(window)
                    };

                    match event.id().as_ref() {
                        "show_app" => {
                            let _ = focus_main_window(app);
                        }
                        "open_dashboard" => {
                            if let Some(window) = focus_main_window(app) {
                                let _ = window.eval("window.location.href='/';");
                            }
                        }
                        "quick_sim" => {
                            if let Some(window) = focus_main_window(app) {
                                let _ = window.eval("window.location.href='/quick-sim';");
                            }
                        }
                        "top_gear" => {
                            if let Some(window) = focus_main_window(app) {
                                let _ = window.eval("window.location.href='/top-gear';");
                            }
                        }
                        "drop_finder" => {
                            if let Some(window) = focus_main_window(app) {
                                let _ = window.eval("window.location.href='/drop-finder';");
                            }
                        }
                        "dungeons" => {
                            if let Some(window) = focus_main_window(app) {
                                let _ = window.eval("window.location.href='/dungeons';");
                            }
                        }
                        "history" => {
                            if let Some(window) = focus_main_window(app) {
                                let _ = window.eval("window.location.href='/history';");
                            }
                        }
                        "settings" => {
                            if let Some(window) = focus_main_window(app) {
                                let _ = window.eval("window.location.href='/settings';");
                            }
                        }
                        "check_updates" => {
                            if let Some(window) = focus_main_window(app) {
                                let _ = window.eval(
                                    "window.dispatchEvent(new CustomEvent('whylowdps-updater-check', { detail: { background: false } }));",
                                );
                            }
                        }
                        "quit_app" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(move |tray: &tauri::tray::TrayIcon, event: TrayIconEvent| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                    }
                });

            if let Some(icon) = app.default_window_icon().cloned() {
                tray_builder = tray_builder.icon(icon);
            }

            tray_builder.build(app)?;

            // Force-apply the bundled icon on startup so native window chrome
            // does not keep showing stale/cached icon resources.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_decorations(false);
                if let Some(icon) = app.default_window_icon().cloned() {
                    let _ = window.set_icon(icon);
                }
            }

            let (sim_watcher_tx_for_events, sim_watcher_rx) =
                mpsc::unbounded_channel::<SimWatcherCommand>();
            app.listen("whylowdps-track-sims", move |event| {
                let payload = event.payload();
                if payload.trim().is_empty() {
                    return;
                }
                let Ok(parsed) = serde_json::from_str::<SimTrackEventPayload>(payload) else {
                    return;
                };
                if parsed.sims.is_empty() {
                    return;
                }
                let _ = sim_watcher_tx_for_events.send(SimWatcherCommand::Track(parsed.sims));
            });
            tauri::async_runtime::spawn(run_sim_notification_watcher(
                notifier_handle,
                sim_watcher_rx,
            ));

            // 1. Resolve bundled resources
            let resolve_bundled_resource = |path: &str, dev_fallback: &str| {
                app_handle
                    .path()
                    .resolve(path, BaseDirectory::Resource)
                    .unwrap_or_else(|_| PathBuf::from(dev_fallback))
            };

            let bundled_data_dir = resolve_bundled_resource("data", "../../backend/resources/data");
            let bundled_simc_dir = resolve_bundled_resource("simc", "../../backend/resources/simc");
            println!("Resolved bundled_data_dir: {:?}", bundled_data_dir);
            println!("Resolved bundled_simc_dir: {:?}", bundled_simc_dir);

            // 2. Resolve writable runtime paths (persistent app data)
            let app_data_dir = app_handle
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("./"));
            if !app_data_dir.exists() {
                let _ = std::fs::create_dir_all(&app_data_dir);
            }

            let data_dir = app_data_dir.join("data");
            if !data_dir.exists() {
                let _ = std::fs::create_dir_all(&data_dir);
            }
            seed_runtime_data_if_missing(&bundled_data_dir, &data_dir);

            let bundled_simc_bin = if cfg!(windows) {
                bundled_simc_dir.join("simc.exe")
            } else {
                bundled_simc_dir.join("simc")
            };
            let legacy_runtime_simc_bin = if cfg!(windows) {
                app_data_dir.join("simc").join("simc.exe")
            } else {
                app_data_dir.join("simc").join("simc")
            };
            let simc_bin = if bundled_simc_bin.exists() {
                bundled_simc_bin
            } else {
                legacy_runtime_simc_bin
            };
            println!("Using bundled simc_bin path: {:?}", simc_bin);

            let db_path = app_data_dir.join("whylowdps.db");
            let db_path_str = db_path.to_string_lossy().to_string();

            // 3. Start Server
            tauri::async_runtime::spawn(async move {
                println!("Using simc binary at {:?}", simc_bin);

                println!("Loading game data from {:?}", data_dir);
                game_data::load(&data_dir);

                println!("Using SQLite database at {}", db_path_str);
                let storage: Arc<dyn JobStorage> = Arc::new(SqliteStorage::new(&db_path_str));

                let (server, _actual_port) = server::start_with_storage_bind(
                    storage,
                    simc_bin,
                    "127.0.0.1",
                    17384,
                    None,
                    Some(data_dir),
                )
                .await;

                server.await.expect("Server error");
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                let state = window.app_handle().state::<AppClosePreferencesState>();
                let close_behavior = state
                    .prefs
                    .lock()
                    .ok()
                    .and_then(|prefs| prefs.minimize_to_tray_on_close);

                match close_behavior {
                    Some(true) => {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                    Some(false) => {
                        // Let the window close naturally.
                    }
                    None => {
                        api.prevent_close();
                        let _ = window.emit("whylowdps-close-choice-requested", ());
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
