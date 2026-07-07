use std::path::PathBuf;
use std::sync::Arc;

use whylowdps_core::game_data;
use whylowdps_core::server;
use whylowdps_core::simc_runtime::{resolve_simc_runtime, SimcChannel, SimcRuntimeConfig};
use whylowdps_core::storage::JobStorage;

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

fn choose_base_dir(has_backend_resources: bool) -> &'static str {
    if has_backend_resources {
        "backend/resources"
    } else {
        "resources"
    }
}

fn resolve_port<I>(args: I, env_port: u16) -> u16
where
    I: IntoIterator<Item = String>,
{
    let mut port = env_port;
    let mut args = args.into_iter();
    while let Some(arg) = args.next() {
        if arg == "--port" {
            if let Some(p) = args.next().and_then(|s| s.parse().ok()) {
                port = p;
            }
        }
    }
    port
}

#[tokio::main]
async fn main() {
    let base_dir = choose_base_dir(std::path::Path::new("backend/resources").exists());

    let data_dir_default = format!("{}/data", base_dir);
    let data_dir = PathBuf::from(env_or("DATA_DIR", &data_dir_default));
    let frontend_dir = std::env::var("FRONTEND_DIR").ok().map(PathBuf::from);
    let simc_runtime_dir = PathBuf::from(env_or("SIMC_RUNTIME_DIR", "simc-runtime"));
    let simc_channel = SimcChannel::parse(&env_or("SIMC_CHANNEL", "weekly"));
    let simc_config = SimcRuntimeConfig::new(simc_channel, simc_runtime_dir);
    let simc_path = match std::env::var("SIMC_PATH") {
        Ok(path) if !path.trim().is_empty() => PathBuf::from(path),
        _ => match resolve_simc_runtime(&simc_config).await {
            Ok(resolution) => {
                println!(
                    "Using SimC {} channel version {} at {:?}",
                    resolution.channel, resolution.version, resolution.simc_path
                );
                resolution.simc_path
            }
            Err(err) => {
                eprintln!("Failed to update SimC runtime: {err}");
                simc_config.simc_path()
            }
        },
    };

    let bind_host = env_or("BIND_HOST", "0.0.0.0");

    let env_port: u16 = env_or("PORT", "8000")
        .parse()
        .expect("PORT must be a number");
    let port = resolve_port(std::env::args().skip(1), env_port);

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

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    #[test]
    fn choose_base_dir_prefers_backend_resources_when_present() {
        assert_eq!(choose_base_dir(true), "backend/resources");
        assert_eq!(choose_base_dir(false), "resources");
    }

    #[test]
    fn env_or_returns_env_value_when_present() {
        let key = "WHYLOWDPS_TEST_ENV_OR_PRESENT";
        unsafe {
            env::set_var(key, "custom-value");
        }

        assert_eq!(env_or(key, "default-value"), "custom-value");

        unsafe {
            env::remove_var(key);
        }
    }

    #[test]
    fn env_or_returns_default_when_missing() {
        let key = "WHYLOWDPS_TEST_ENV_OR_MISSING";
        unsafe {
            env::remove_var(key);
        }

        assert_eq!(env_or(key, "default-value"), "default-value");
    }

    #[test]
    fn env_or_preserves_empty_env_value() {
        let key = "WHYLOWDPS_TEST_ENV_OR_EMPTY";
        unsafe {
            env::set_var(key, "");
        }

        assert_eq!(env_or(key, "default-value"), "");

        unsafe {
            env::remove_var(key);
        }
    }

    #[test]
    fn resolve_port_uses_env_port_when_no_args_are_provided() {
        assert_eq!(resolve_port(Vec::<String>::new(), 8000), 8000);
    }

    #[test]
    fn resolve_port_uses_cli_override_when_valid() {
        assert_eq!(
            resolve_port(vec!["--port".to_string(), "9000".to_string()], 8000),
            9000
        );
    }

    #[test]
    fn resolve_port_ignores_invalid_cli_override() {
        assert_eq!(
            resolve_port(vec!["--port".to_string(), "bad".to_string()], 8000),
            8000
        );
    }

    #[test]
    fn resolve_port_ignores_missing_cli_override_value() {
        assert_eq!(resolve_port(vec!["--port".to_string()], 8000), 8000);
    }

    #[test]
    fn resolve_port_ignores_unrelated_args() {
        assert_eq!(
            resolve_port(
                vec!["--other".to_string(), "1".to_string(), "--flag".to_string(),],
                8000,
            ),
            8000
        );
    }

    #[test]
    fn resolve_port_finds_port_after_unrelated_args() {
        assert_eq!(
            resolve_port(
                vec![
                    "--other".to_string(),
                    "1".to_string(),
                    "--port".to_string(),
                    "7777".to_string(),
                ],
                8000,
            ),
            7777
        );
    }

    #[test]
    fn resolve_port_uses_last_valid_port_when_multiple_ports_are_provided() {
        assert_eq!(
            resolve_port(
                vec![
                    "--port".to_string(),
                    "7000".to_string(),
                    "--port".to_string(),
                    "9000".to_string(),
                ],
                8000,
            ),
            9000
        );
    }

    #[test]
    fn resolve_port_keeps_previous_valid_port_when_later_port_is_invalid() {
        assert_eq!(
            resolve_port(
                vec![
                    "--port".to_string(),
                    "7000".to_string(),
                    "--port".to_string(),
                    "bad".to_string(),
                ],
                8000,
            ),
            7000
        );
    }

    #[test]
    fn resolve_port_accepts_zero_port_for_os_assigned_port() {
        assert_eq!(
            resolve_port(vec!["--port".to_string(), "0".to_string()], 8000),
            0
        );
    }

    #[test]
    fn resolve_port_accepts_max_u16_port() {
        assert_eq!(
            resolve_port(vec!["--port".to_string(), "65535".to_string()], 8000),
            65535
        );
    }

    #[test]
    fn resolve_port_rejects_port_above_u16_range() {
        assert_eq!(
            resolve_port(vec!["--port".to_string(), "65536".to_string()], 8000),
            8000
        );
    }

    #[test]
    fn resolve_port_rejects_negative_port() {
        assert_eq!(
            resolve_port(vec!["--port".to_string(), "-1".to_string()], 8000),
            8000
        );
    }

    #[test]
    fn resolve_port_rejects_decimal_port() {
        assert_eq!(
            resolve_port(vec!["--port".to_string(), "8080.5".to_string()], 8000),
            8000
        );
    }

    #[test]
    fn resolve_port_does_not_treat_port_equals_syntax_as_supported() {
        assert_eq!(resolve_port(vec!["--port=9000".to_string()], 8000), 8000);
    }

    #[test]
    fn resolve_port_does_not_consume_flag_as_valid_port_value() {
        assert_eq!(
            resolve_port(
                vec![
                    "--port".to_string(),
                    "--other".to_string(),
                    "9000".to_string(),
                ],
                8000,
            ),
            8000
        );
    }
}
