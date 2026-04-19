#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use std::{collections::HashMap, collections::HashSet};
use tauri::path::BaseDirectory;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::Manager;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::WindowEvent;
use tauri_plugin_notification::NotificationExt;
use whylowdps_core::game_data;
use whylowdps_core::server;
use whylowdps_core::storage::{JobStorage, SqliteStorage};

fn seed_runtime_data_if_missing(bundled_data_dir: &Path, runtime_data_dir: &Path) {
    let runtime_classes = runtime_data_dir.join("classes.json");
    if runtime_classes.exists() {
        return;
    }

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
            } else if src_path.is_file() {
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
    // We use the Blizzard logout endpoint with a 'ref' parameter to force a session clear
    // before redirecting to the actual authorize URL.
    let logout_url = format!("https://battle.net/login/en/logout?ref={}", url);

    tauri::WebviewWindowBuilder::new(
        &handle,
        "auth",
        tauri::WebviewUrl::External(logout_url.parse::<url::Url>().map_err(|e| e.to_string())?),
    )
    .title("Blizzard Login")
    .inner_size(600.0, 750.0)
    .resizable(true)
    .always_on_top(true)
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
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
    dps: Option<f64>,
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

#[tauri::command]
async fn get_system_info(app: tauri::AppHandle) -> Result<SystemInfo, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("./"));
    let data_dir = app_data_dir.join("data");
    let simc_dir = app_data_dir.join("simc");
    // Specifically check for critical files
    let classes_json = data_dir.join("classes.json");
    let simc_exe_legacy = if cfg!(windows) {
        simc_dir.join("simc.exe")
    } else {
        simc_dir.join("simc")
    };
    let simc_exe_latest = if cfg!(windows) {
        simc_dir.join("channels").join("latest").join("simc.exe")
    } else {
        simc_dir.join("channels").join("latest").join("simc")
    };
    let simc_exe_weekly = if cfg!(windows) {
        simc_dir.join("channels").join("weekly").join("simc.exe")
    } else {
        simc_dir.join("channels").join("weekly").join("simc")
    };
    let simc_exe_nightly = if cfg!(windows) {
        simc_dir.join("channels").join("nightly").join("simc.exe")
    } else {
        simc_dir.join("channels").join("nightly").join("simc")
    };

    Ok(SystemInfo {
        os: std::env::consts::OS.to_string(),
        exe_path: std::env::current_exe()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| "Unknown".to_string()),
        data_dir: data_dir.to_string_lossy().to_string(),
        simc_dir: simc_dir.to_string_lossy().to_string(),
        data_valid: classes_json.exists(),
        simc_valid: simc_exe_legacy.exists()
            || simc_exe_latest.exists()
            || simc_exe_weekly.exists()
            || simc_exe_nightly.exists(),
        api_url: "http://localhost:17384".to_string(),
        version: "0.2.4-STABILITY-V2".to_string(),
    })
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            open_auth_window,
            get_system_info
        ])
        .setup(|app| {
            let app_handle = app.handle().clone();
            let notifier_handle = app_handle.clone();
            let show_item = MenuItemBuilder::with_id("show_app", "Show WhyLowDps").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit_app", "Quit WhyLowDps").build(app)?;
            let tray_menu = MenuBuilder::new(app)
                .item(&show_item)
                .separator()
                .item(&quit_item)
                .build()?;

            let mut tray_builder = TrayIconBuilder::with_id("main-tray")
                .menu(&tray_menu)
                .tooltip("WhyLowDps")
                .show_menu_on_left_click(false)
                .on_menu_event(move |app: &tauri::AppHandle, event: tauri::menu::MenuEvent| {
                    match event.id().as_ref() {
                        "show_app" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
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

            tauri::async_runtime::spawn(async move {
                let client = reqwest::Client::new();
                let mut baseline_ready = false;
                let mut previous_statuses: HashMap<String, String> = HashMap::new();
                let mut notified_sims: HashSet<String> = HashSet::new();

                loop {
                    let sims = match client
                        .get("http://127.0.0.1:17384/api/sims")
                        .send()
                        .await
                        .and_then(|resp| resp.error_for_status())
                    {
                        Ok(resp) => match resp.json::<Vec<SimNotificationSummary>>().await {
                            Ok(sims) => sims,
                            Err(_) => {
                                tokio::time::sleep(Duration::from_secs(5)).await;
                                continue;
                            }
                        },
                        Err(_) => {
                            tokio::time::sleep(Duration::from_secs(5)).await;
                            continue;
                        }
                    };

                    let mut next_statuses: HashMap<String, String> = HashMap::new();

                    if !baseline_ready {
                        for sim in sims {
                            if is_terminal_status(&sim.status) {
                                notified_sims.insert(sim.id.clone());
                            }
                            next_statuses.insert(sim.id, sim.status);
                        }
                        previous_statuses = next_statuses;
                        baseline_ready = true;
                        tokio::time::sleep(Duration::from_secs(5)).await;
                        continue;
                    }

                    for sim in sims {
                        let prev = previous_statuses.get(&sim.id).map(String::as_str);
                        let should_notify = if notified_sims.contains(&sim.id) {
                            false
                        } else if let Some(prev_status) = prev {
                            is_active_status(prev_status) && is_terminal_status(&sim.status)
                        } else {
                            is_terminal_status(&sim.status)
                        };

                        if should_notify {
                            let player = sim
                                .player_name
                                .clone()
                                .or(sim.linked_name.clone())
                                .unwrap_or_else(|| "Simulation".to_string());
                            let sim_type = sim_type_label(&sim.sim_type);
                            let body = if sim.status == "done" {
                                match sim.dps {
                                    Some(dps) => format!("{player} - {sim_type} - {} DPS", dps.round() as i64),
                                    None => format!("{player} - {sim_type}"),
                                }
                            } else {
                                format!("{player} - {sim_type} - {}", sim.status)
                            };

                            let _ = notifier_handle
                                .notification()
                                .builder()
                                .title(notification_title(&sim.status))
                                .body(body)
                                .show();

                            notified_sims.insert(sim.id.clone());
                        }

                        next_statuses.insert(sim.id, sim.status);
                    }

                    previous_statuses = next_statuses;
                    tokio::time::sleep(Duration::from_secs(5)).await;
                }
            });

            // 1. Resolve bundled resources
            let resolve_bundled_resource = |path: &str, dev_fallback: &str| {
                app_handle
                    .path()
                    .resolve(path, BaseDirectory::Resource)
                    .unwrap_or_else(|_| PathBuf::from(dev_fallback))
            };

            let bundled_data_dir = resolve_bundled_resource("data", "../../backend/resources/data");
            println!("Resolved bundled_data_dir: {:?}", bundled_data_dir);

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

            let runtime_simc_dir = app_data_dir.join("simc");
            if !runtime_simc_dir.exists() {
                let _ = std::fs::create_dir_all(&runtime_simc_dir);
            }

            let simc_bin = if cfg!(windows) {
                runtime_simc_dir.join("simc.exe")
            } else {
                runtime_simc_dir.join("simc")
            };
            println!("Using runtime simc_bin path: {:?}", simc_bin);

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
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
