#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;
use std::sync::Arc;
use tauri::Manager;
use tauri::path::BaseDirectory;
use whylowdps_core::game_data;
use whylowdps_core::server;
use whylowdps_core::storage::{JobStorage, SqliteStorage};

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
    let resolve_resource = |path: &str| {
        app.path()
            .resolve(path, BaseDirectory::Resource)
            .unwrap_or_else(|_| PathBuf::from(format!("./{}", path)))
    };

    let data_dir = resolve_resource("data");
    let simc_dir = resolve_resource("simc");
    
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
        version: "0.2.4-STABILITY-V2".to_string(),
    })
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            open_auth_window,
            get_system_info
        ])
        .setup(|app| {
            let app_handle = app.handle().clone();
            
            // 1. Resolve Resource Paths (simc, data)
            // With flattened mapping, these are now at the root of the resource bundle
            let resolve_resource = |path: &str, dev_fallback: &str| {
                app_handle.path()
                    .resolve(path, BaseDirectory::Resource)
                    .unwrap_or_else(|_| PathBuf::from(dev_fallback))
            };

            let data_dir = resolve_resource("data", "../../backend/resources/data");
            let simc_dir = resolve_resource("simc", "../../backend/resources/simc");

            let simc_bin = if cfg!(windows) {
                simc_dir.join("simc.exe")
            } else {
                simc_dir.join("simc")
            };

            println!("Resolved data_dir: {:?}", data_dir);
            println!("Resolved simc_dir: {:?}", simc_dir);
            println!("Resolved simc_bin: {:?}", simc_bin);

            if !data_dir.exists() {
                eprintln!("CRITICAL: data_dir does not exist at {:?}", data_dir);
            }
            if !simc_bin.exists() {
                eprintln!("CRITICAL: simc_bin does not exist at {:?}", simc_bin);
            }

            // 2. Resolve Database Path (persistent SQLite)
            let app_data_dir = app_handle.path().app_data_dir().unwrap_or_else(|_| PathBuf::from("./"));
            if !app_data_dir.exists() {
                let _ = std::fs::create_dir_all(&app_data_dir);
            }
            let db_path = app_data_dir.join("whylowdps.db");
            let db_path_str = db_path.to_string_lossy().to_string();
            
            // 3. Start Server
            tauri::async_runtime::spawn(async move {
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
