#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app_logic;

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use app_logic::*;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::path::BaseDirectory;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::WindowEvent;
use tauri::{Emitter, Listener, Manager};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;
use tokio::io::AsyncWriteExt;
use tokio::sync::mpsc;
use whylowdps_core::game_data;
use whylowdps_core::server;
use whylowdps_core::storage::{JobStorage, SqliteStorage};

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
                .map(|code| code.to_string())
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
    let filename = installer_filename_from_url(&url)?;

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;

    let updates_dir = app_data_dir.join("updates");

    std::fs::create_dir_all(&updates_dir)
        .map_err(|e| format!("Failed to create updates dir: {e}"))?;

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

    // Give the UI thread a tiny window to process the "finished" event, then exit cleanly.
    tokio::time::sleep(Duration::from_millis(150)).await;

    app.exit(0);

    Ok(())
}

async fn run_sim_notification_watcher(
    notifier_handle: tauri::AppHandle,
    mut rx: mpsc::UnboundedReceiver<SimWatcherCommand>,
) {
    let client = reqwest::Client::new();

    let mut tracked_active: std::collections::HashMap<String, SimWatcherMeta> =
        std::collections::HashMap::new();

    let mut notified_sims: std::collections::HashSet<String> = std::collections::HashSet::new();

    // Startup scan: attach to pre-existing active sims.
    for _ in 0..30 {
        let scan = client
            .get("http://127.0.0.1:17384/api/sims")
            .send()
            .await
            .and_then(|response| response.error_for_status());

        if let Ok(response) = scan {
            if let Ok(sims) = response.json::<Vec<SimNotificationSummary>>().await {
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
        while let Ok(command) = rx.try_recv() {
            match command {
                SimWatcherCommand::Track(items) => {
                    handle_track_command(items, &mut tracked_active, &mut notified_sims);
                }
            }
        }

        if tracked_active.is_empty() {
            let Some(command) = rx.recv().await else {
                break;
            };

            match command {
                SimWatcherCommand::Track(items) => {
                    handle_track_command(items, &mut tracked_active, &mut notified_sims);
                }
            }

            continue;
        }

        tokio::select! {
            command = rx.recv() => {
                let Some(command) = command else {
                    break;
                };

                match command {
                    SimWatcherCommand::Track(items) => {
                        handle_track_command(items, &mut tracked_active, &mut notified_sims);
                    }
                }
            }

            _ = tokio::time::sleep(Duration::from_secs(5)) => {
                let ids: Vec<String> = tracked_active.keys().cloned().collect();

                for id in ids {
                    let status_url = format!("http://127.0.0.1:17384/api/sim/{id}");

                    let status_response = client
                        .get(&status_url)
                        .send()
                        .await
                        .and_then(|response| response.error_for_status());

                    let Ok(response) = status_response else {
                        continue;
                    };

                    let Ok(status) = response.json::<SimStatusResponse>().await else {
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

                    let body = build_sim_notification_body(&status, &meta);

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

    let classes_json = data_dir.join("classes.json");
    let simc_exe = simc_dir.join(simc_binary_name());

    Ok(SystemInfo {
        os: std::env::consts::OS.to_string(),
        exe_path: std::env::current_exe()
            .map(|path| path.to_string_lossy().to_string())
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
                prefs: std::sync::Mutex::new(close_prefs),
                path: close_prefs_path,
            });

            let app_handle = app.handle().clone();
            let notifier_handle = app_handle.clone();

            let show_item = MenuItemBuilder::with_id("show_app", "Show WhyLowDps").build(app)?;
            let dashboard_item =
                MenuItemBuilder::with_id("open_dashboard", "Dashboard").build(app)?;
            let quick_sim_item = MenuItemBuilder::with_id("quick_sim", "Quick Sim").build(app)?;
            let top_gear_item = MenuItemBuilder::with_id("top_gear", "Top Gear").build(app)?;
            let drop_finder_item =
                MenuItemBuilder::with_id("drop_finder", "Drop Finder").build(app)?;
            let dungeons_item = MenuItemBuilder::with_id("dungeons", "Dungeons").build(app)?;
            let history_item =
                MenuItemBuilder::with_id("history", "Simulation History").build(app)?;
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
                .on_menu_event(
                    move |app: &tauri::AppHandle, event: tauri::menu::MenuEvent| {
                        let focus_main_window =
                            |app: &tauri::AppHandle| -> Option<tauri::WebviewWindow> {
                                let window = app.get_webview_window("main")?;
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                                Some(window)
                            };

                        match tray_menu_action(event.id().as_ref()) {
                            TrayMenuAction::ShowApp => {
                                let _ = focus_main_window(app);
                            }
                            TrayMenuAction::Navigate(route) => {
                                if let Some(window) = focus_main_window(app) {
                                    let _ = window.eval(navigation_script(route));
                                }
                            }
                            TrayMenuAction::CheckUpdates => {
                                if let Some(window) = focus_main_window(app) {
                                    let _ = window.eval(updater_check_script());
                                }
                            }
                            TrayMenuAction::Quit => {
                                app.exit(0);
                            }
                            TrayMenuAction::Ignore => {}
                        }
                    },
                )
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

            // Force-apply bundled icon on startup so native window chrome does not keep
            // showing stale/cached icon resources.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_decorations(false);

                if let Some(icon) = app.default_window_icon().cloned() {
                    let _ = window.set_icon(icon);
                }
            }

            let (sim_watcher_tx_for_events, sim_watcher_rx) =
                mpsc::unbounded_channel::<SimWatcherCommand>();

            app.listen("whylowdps-track-sims", move |event| {
                if let TrackSimsPayloadParseResult::Track(sims) =
                    parse_track_sims_payload(event.payload())
                {
                    let _ = sim_watcher_tx_for_events.send(SimWatcherCommand::Track(sims));
                }
            });

            tauri::async_runtime::spawn(run_sim_notification_watcher(
                notifier_handle,
                sim_watcher_rx,
            ));

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

            let bundled_simc_bin = bundled_simc_dir.join(simc_binary_name());
            let legacy_runtime_simc_bin = app_data_dir.join("simc").join(simc_binary_name());
            let simc_bin = choose_simc_bin(bundled_simc_bin, legacy_runtime_simc_bin);

            println!("Using bundled simc_bin path: {:?}", simc_bin);

            let db_path = app_data_dir.join("whylowdps.db");
            let db_path_str = db_path.to_string_lossy().to_string();

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

                match resolve_main_window_close_action(close_behavior) {
                    MainWindowCloseAction::HideToTray => {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                    MainWindowCloseAction::CloseNaturally => {
                        // Let the window close naturally.
                    }
                    MainWindowCloseAction::AskUser => {
                        api.prevent_close();
                        let _ = window.emit("whylowdps-close-choice-requested", ());
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
