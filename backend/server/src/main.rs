use std::path::PathBuf;
use std::sync::Arc;

use whylowdps_core::game_data;
use whylowdps_core::server;
use whylowdps_core::storage::JobStorage;

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

#[tokio::main]
async fn main() {
    let base_dir = if std::path::Path::new("backend/resources").exists() {
        "backend/resources"
    } else {
        "resources"
    };

    let data_dir_default = format!("{}/data", base_dir);
    let simc_path_default = if cfg!(windows) {
        format!("{}/simc/simc.exe", base_dir)
    } else {
        "/usr/local/bin/simc".to_string()
    };

    let data_dir = PathBuf::from(env_or("DATA_DIR", &data_dir_default));
    let simc_path = PathBuf::from(env_or("SIMC_PATH", &simc_path_default));
    let frontend_dir = std::env::var("FRONTEND_DIR").ok().map(PathBuf::from);

    let bind_host = env_or("BIND_HOST", "0.0.0.0");

    // Check for --port <port> in arguments
    let mut args = std::env::args().skip(1);
    let mut port: u16 = env_or("PORT", "8000")
        .parse()
        .expect("PORT must be a number");
    while let Some(arg) = args.next() {
        if arg == "--port" {
            if let Some(p) = args.next().and_then(|s| s.parse().ok()) {
                port = p;
            }
        }
    }

    println!("Loading game data from {:?}", data_dir);
    game_data::load(&data_dir);

    let _db_url = env_or("DATABASE_URL", "whylowdps.db");
    println!("Starting WhyLowDps server on {}:{}", bind_host, port);

    let storage: Arc<dyn JobStorage> = {
        #[cfg(feature = "web")]
        {
            println!("Using SQLite storage: {}", _db_url);
            Arc::new(whylowdps_core::storage::sqlite::SqliteStorage::new(
                &_db_url,
            ))
        }
        #[cfg(not(feature = "web"))]
        {
            println!("Using In-Memory storage (SQLite not enabled)");
            Arc::new(whylowdps_core::storage::memory::MemoryStorage::new())
        }
    };

    let (server, actual_port) = server::start_with_storage_bind(
        storage,
        simc_path,
        &bind_host,
        port,
        frontend_dir,
        Some(data_dir),
    )
    .await;

    println!("HTTP server active at http://{}:{}", bind_host, actual_port);

    // Keep the server running
    server.await.expect("Server error");
}
