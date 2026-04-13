#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;
use std::sync::Arc;
use tauri::path::BaseDirectory;
use tauri::Manager;
use whylowdps_core::game_data;
use whylowdps_core::server;
use whylowdps_core::storage::{JobStorage, SqliteStorage};

fn seed_runtime_data_if_missing(bundled_data_dir: &PathBuf, runtime_data_dir: &PathBuf) {
    let runtime_classes = runtime_data_dir.join("classes.json");
    if runtime_classes.exists() {
        return;
    }

    let bundled_classes = bundled_data_dir.join("classes.json");
    if !bundled_classes.exists() {
        return;
    }

    let mut stack: Vec<(PathBuf, PathBuf)> =
        vec![(bundled_data_dir.clone(), runtime_data_dir.clone())];
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

fn seed_runtime_simc_if_missing(bundled_simc_dir: &PathBuf, runtime_simc_dir: &PathBuf) {
    let runtime_bin = if cfg!(windows) {
        runtime_simc_dir.join("simc.exe")
    } else {
        runtime_simc_dir.join("simc")
    };
    if runtime_bin.exists() {
        return;
    }

    let bundled_bin = if cfg!(windows) {
        bundled_simc_dir.join("simc.exe")
    } else {
        bundled_simc_dir.join("simc")
    };
    if !bundled_bin.exists() {
        return;
    }

    let mut stack: Vec<(PathBuf, PathBuf)> =
        vec![(bundled_simc_dir.clone(), runtime_simc_dir.clone())];
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

    Ok(SystemInfo {
        os: std::env::consts::OS.to_string(),
        exe_path: std::env::current_exe()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| "Unknown".to_string()),
        data_dir: data_dir.to_string_lossy().to_string(),
        simc_dir: simc_dir.to_string_lossy().to_string(),
        data_valid: classes_json.exists(),
        simc_valid: simc_exe_legacy.exists() || simc_exe_latest.exists(),
        api_url: "http://localhost:17384".to_string(),
        version: "0.2.4-STABILITY-V2".to_string(),
    })
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![open_auth_window, get_system_info])
        .setup(|app| {
            let app_handle = app.handle().clone();

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

            let runtime_simc_dir = app_data_dir.join("simc");
            if !runtime_simc_dir.exists() {
                let _ = std::fs::create_dir_all(&runtime_simc_dir);
            }
            seed_runtime_simc_if_missing(&bundled_simc_dir, &runtime_simc_dir);

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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
