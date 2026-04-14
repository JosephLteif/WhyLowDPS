#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::io::Cursor;
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
    let resolve_bundled_resource = |path: &str| {
        app.path()
            .resolve(path, BaseDirectory::Resource)
            .unwrap_or_else(|_| PathBuf::from(format!("./{}", path)))
    };

    let app_data_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("./"));
    let data_dir = app_data_dir.join("data");
    let simc_dir = resolve_bundled_resource("simc");
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

async fn bootstrap_simc(simc_dir: &std::path::Path) -> Result<(), String> {
    fs::create_dir_all(simc_dir).map_err(|e| e.to_string())?;

    if !cfg!(windows) {
        return Err(
            "Automatic SimC download is only supported on Windows in desktop mode".to_string(),
        );
    }

    let url =
        "https://github.com/simulationcraft/simc/releases/download/v1100-01/simc-1100-01-win64.zip";
    println!("SimC not found locally. Downloading from: {}", url);

    let response = reqwest::get(url)
        .await
        .map_err(|e| format!("Failed to download SimC: {}", e))?;
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read SimC download body: {}", e))?;

    let cursor = Cursor::new(bytes);
    let mut archive =
        zip::ZipArchive::new(cursor).map_err(|e| format!("Failed to open SimC archive: {}", e))?;

    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read zip entry {}: {}", i, e))?;
        let Some(safe_path) = file.enclosed_name().map(|p| p.to_path_buf()) else {
            continue;
        };
        let outpath = simc_dir.join(safe_path);
        if file.is_dir() {
            fs::create_dir_all(&outpath).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = outpath.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut outfile = fs::File::create(&outpath).map_err(|e| e.to_string())?;
            std::io::copy(&mut file, &mut outfile).map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

fn find_simc_binary(simc_dir: &std::path::Path) -> Option<PathBuf> {
    let target_name = if cfg!(windows) { "simc.exe" } else { "simc" };
    let direct = simc_dir.join(target_name);
    if direct.exists() {
        return Some(direct);
    }

    let mut stack = vec![simc_dir.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path
                .file_name()
                .and_then(|f| f.to_str())
                .is_some_and(|name| name.eq_ignore_ascii_case(target_name))
            {
                return Some(path);
            }
        }
    }
    None
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
            let simc_dir = resolve_bundled_resource("simc", "../../backend/resources/simc");

            let simc_bin = if cfg!(windows) {
                simc_dir.join("simc.exe")
            } else {
                simc_dir.join("simc")
            };

            println!("Resolved bundled_data_dir: {:?}", bundled_data_dir);
            println!("Resolved simc_dir: {:?}", simc_dir);
            println!("Resolved simc_bin: {:?}", simc_bin);
            if !simc_bin.exists() {
                eprintln!("CRITICAL: simc_bin does not exist at {:?}", simc_bin);
            }

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

            let db_path = app_data_dir.join("whylowdps.db");
            let db_path_str = db_path.to_string_lossy().to_string();

            // 3. Start Server
            tauri::async_runtime::spawn(async move {
                let simc_bin = if simc_bin.exists() {
                    simc_bin
                } else {
                    if let Err(e) = bootstrap_simc(&simc_dir).await {
                        eprintln!("CRITICAL: failed to bootstrap SimC: {}", e);
                    }
                    find_simc_binary(&simc_dir).unwrap_or(simc_bin)
                };
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
