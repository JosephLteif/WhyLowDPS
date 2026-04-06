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
    let data_dir = PathBuf::from(env_or("DATA_DIR", "./resources/data"));
    let simc_path = PathBuf::from(env_or("SIMC_PATH", "/usr/local/bin/simc"));
    let frontend_dir = std::env::var("FRONTEND_DIR").ok().map(PathBuf::from);

    let bind_host = env_or("BIND_HOST", "0.0.0.0");
    let port: u16 = env_or("PORT", "8000")
        .parse()
        .expect("PORT must be a number");

    println!("Loading game data from {:?}", data_dir);
    game_data::load(&data_dir);

    let db_url = env_or("DATABASE_URL", "whylowdps.db");
    println!("Starting WhyLowDps server on {}:{}", bind_host, port);

    let storage: Arc<dyn JobStorage> = {
        #[cfg(feature = "postgres")]
        if db_url.starts_with("postgres://") || db_url.starts_with("postgresql://") {
            println!("Using PostgreSQL storage");
            Arc::new(whylowdps_core::storage::postgres::PostgresStorage::new(&db_url).await)
        } else {
            #[cfg(feature = "web")]
            {
                println!("Using SQLite storage: {}", db_url);
                Arc::new(whylowdps_core::storage::sqlite::SqliteStorage::new(&db_url))
            }
            #[cfg(not(feature = "web"))]
            {
                println!("Using In-Memory storage (SQLite not enabled)");
                Arc::new(whylowdps_core::storage::memory::MemoryStorage::new())
            }
        }

        #[cfg(not(feature = "postgres"))]
        {
            #[cfg(feature = "web")]
            {
                println!("Using SQLite storage: {}", db_url);
                Arc::new(whylowdps_core::storage::sqlite::SqliteStorage::new(&db_url))
            }
            #[cfg(not(feature = "web"))]
            {
                println!("Using In-Memory storage (SQLite not enabled)");
                Arc::new(whylowdps_core::storage::memory::MemoryStorage::new())
            }
        }
    };

    server::start_with_storage_bind(
        storage,
        simc_path,
        &bind_host,
        port,
        frontend_dir,
        Some(data_dir),
    )
    .await;

    // Keep the server running
    tokio::signal::ctrl_c().await.ok();
}
