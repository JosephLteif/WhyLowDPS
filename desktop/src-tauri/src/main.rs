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

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![open_auth_window])
        .setup(|app| {
            let app_handle = app.handle().clone();
            
            // 1. Resolve Resource Paths (simc, data)
            // In development, Tauri v2 places resources in target/debug/_up_/_up_/backend/resources/...
            // The resolve function should use the path relative to tauri.conf.json
            let data_dir = app_handle.path()
                .resolve("../../backend/resources/data", BaseDirectory::Resource)
                .or_else(|_| app_handle.path().resolve("data", BaseDirectory::Resource))
                .unwrap_or_else(|_| PathBuf::from("../../backend/resources/data"));
                
            let simc_dir = app_handle.path()
                .resolve("../../backend/resources/simc", BaseDirectory::Resource)
                .or_else(|_| app_handle.path().resolve("simc", BaseDirectory::Resource))
                .unwrap_or_else(|_| PathBuf::from("../../backend/resources/simc"));

            let simc_bin = if cfg!(windows) {
                simc_dir.join("simc.exe")
            } else {
                simc_dir.join("simc")
            };

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
