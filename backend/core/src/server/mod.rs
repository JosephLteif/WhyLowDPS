#[cfg(feature = "web")]
pub mod auth_handlers;
mod blizzard;
mod character_profile_handlers;
mod data_sync;
#[cfg(feature = "web")]
pub mod dungeon_data;
#[cfg(feature = "web")]
pub mod dungeon_source_blizzard;
#[cfg(feature = "web")]
mod game_data_handlers;
#[cfg(feature = "web")]
mod helpers;
#[cfg(feature = "web")]
mod job_handlers;
#[cfg(feature = "web")]
mod route_handlers;
#[cfg(feature = "web")]
mod sim_handlers;
#[cfg(all(feature = "desktop", feature = "web"))]
mod simc_updater;
#[cfg(feature = "web")]
mod types;
#[cfg(feature = "web")]
mod upgrade_compare;

#[cfg(feature = "web")]
use actix_cors::Cors;
#[cfg(feature = "web")]
use actix_files::NamedFile;
#[cfg(feature = "web")]
use actix_web::{web, App, HttpRequest, HttpResponse, HttpServer};
#[cfg(feature = "web")]
use serde::Deserialize;
#[cfg(feature = "web")]
use serde_json::json;
use std::path::{Path, PathBuf};
use std::sync::Arc;
#[cfg(all(feature = "desktop", feature = "web"))]
use std::sync::Mutex;

#[cfg(feature = "web")]
use crate::log_buffer::LogBuffer;
use crate::storage::{self, JobStorage};
#[cfg(feature = "web")]
use types::FrontendDir;

// ---------- System handlers ----------

#[cfg(all(feature = "desktop", feature = "web"))]
/// Shared system info state, refreshed in background for live CPU readings.
struct SystemStats {
    sys: sysinfo::System,
}

#[cfg(all(feature = "desktop", feature = "web"))]
impl SystemStats {
    fn new() -> Self {
        let mut sys = sysinfo::System::new();
        sys.refresh_cpu_all();
        Self { sys }
    }

    fn refresh(&mut self) {
        self.sys.refresh_cpu_all();
    }

    fn cpu_usage(&self) -> f32 {
        let cpus = self.sys.cpus();
        if cpus.is_empty() {
            return 0.0;
        }
        cpus.iter().map(|c| c.cpu_usage()).sum::<f32>() / cpus.len() as f32
    }
}

#[cfg(feature = "web")]
async fn get_config(store: web::Data<Arc<dyn JobStorage>>) -> HttpResponse {
    HttpResponse::Ok().json(json!({
        "max_scenarios": *storage::MAX_SCENARIOS,
        "max_jobs": store.get_max_jobs(),
    }))
}

#[cfg(feature = "web")]
#[derive(Deserialize)]
struct UpdateConfig {
    max_jobs: Option<usize>,
}

#[cfg(feature = "web")]
async fn update_config(
    body: web::Json<UpdateConfig>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    if let Some(limit) = body.max_jobs {
        store.set_max_jobs(limit);
    }
    HttpResponse::Ok().json(json!({"status": "updated"}))
}

#[cfg(feature = "web")]
async fn health_check() -> HttpResponse {
    let threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);
    HttpResponse::Ok().json(json!({
        "status": "ok",
        "threads": threads,
        "mode": "desktop",
    }))
}

#[cfg(all(feature = "desktop", feature = "web"))]
async fn system_stats(stats: web::Data<Arc<Mutex<SystemStats>>>) -> HttpResponse {
    let mut s = stats.lock().unwrap();
    s.refresh();
    let cpu = s.cpu_usage();
    HttpResponse::Ok().json(json!({
        "cpu_usage": (cpu * 10.0).round() / 10.0,
    }))
}

#[cfg(feature = "web")]
/// SPA fallback: serve the appropriate HTML file for client-side routes
async fn spa_fallback(
    req: HttpRequest,
    frontend_dir: web::Data<FrontendDir>,
) -> actix_web::Result<NamedFile> {
    let path = req.path();
    let trimmed = path.trim_start_matches('/').trim_end_matches('/');

    // Try static-export folder routes first (e.g., /quick-sim -> quick-sim/index.html).
    if !trimmed.is_empty() {
        let folder_index = frontend_dir.0.join(trimmed).join("index.html");
        if folder_index.exists() {
            return Ok(NamedFile::open(folder_index)?);
        }

        // Support non-folder exports when present.
        let flat_html = frontend_dir.0.join(format!("{}.html", trimmed));
        if flat_html.exists() {
            return Ok(NamedFile::open(flat_html)?);
        }
    }

    // Map dynamic exported pages to their static placeholders.
    if path.starts_with("/sim/") || path == "/sim" || path == "/sim/" {
        let sim_placeholder = frontend_dir.0.join("sim").join("_").join("index.html");
        if sim_placeholder.exists() {
            return Ok(NamedFile::open(sim_placeholder)?);
        }
    }

    if path.starts_with("/character/") || path == "/character" || path == "/character/" {
        let character_placeholder = frontend_dir
            .0
            .join("character")
            .join("us")
            .join("realm")
            .join("name")
            .join("index.html");
        if character_placeholder.exists() {
            return Ok(NamedFile::open(character_placeholder)?);
        }
    }

    // Final fallback for unknown routes.
    Ok(NamedFile::open(frontend_dir.0.join("index.html"))?)
}

// ---------- Server startup ----------

/// Start the HTTP server with in-memory storage (desktop default).
pub async fn start(
    resource_dir: &Path,
    frontend_dir: Option<PathBuf>,
) -> (actix_web::dev::Server, u16) {
    let simc_path = if cfg!(windows) {
        resource_dir.join("simc").join("simc.exe")
    } else {
        resource_dir.join("simc").join("simc")
    };
    let data_dir = Some(resource_dir.join("data"));
    let storage: Arc<dyn JobStorage> = Arc::new(crate::storage::memory::MemoryStorage::new());
    start_with_storage(storage, simc_path, 17384, frontend_dir, data_dir).await
}

/// Start the actix-web HTTP server with a given storage backend.
/// Returns the server handle and port number.
pub async fn start_with_storage(
    storage: Arc<dyn JobStorage>,
    simc_path: PathBuf,
    port: u16,
    frontend_dir: Option<PathBuf>,
    data_dir: Option<PathBuf>,
) -> (actix_web::dev::Server, u16) {
    start_with_storage_bind(
        storage,
        simc_path,
        "127.0.0.1",
        port,
        frontend_dir,
        data_dir,
    )
    .await
}

/// Start the actix-web HTTP server with a given storage backend and bind address.
/// Returns the server handle and the port number.
pub async fn start_with_storage_bind(
    storage: Arc<dyn JobStorage>,
    simc_path: PathBuf,
    bind_host: &str,
    port: u16,
    frontend_dir: Option<PathBuf>,
    data_dir: Option<PathBuf>,
) -> (actix_web::dev::Server, u16) {
    #[cfg(feature = "web")]
    {
        let store_data = web::Data::new(storage);
        let simc_data = web::Data::new(simc_path);
        let log_data = web::Data::new(Arc::new(LogBuffer::new()));
        #[cfg(feature = "desktop")]
        let stats_data = web::Data::new(Arc::new(Mutex::new(SystemStats::new())));
        #[cfg(feature = "desktop")]
        let simc_updater_data = web::Data::new(simc_updater::SimcUpdaterState::new());
        #[cfg(feature = "desktop")]
        simc_updater::migrate_legacy_channel_dirs(simc_data.get_ref());
        let frontend = frontend_dir.clone();
        let data = data_dir.clone();

        let bind_addr = format!("{}:{}", bind_host, port);

        let blizzard_state = web::Data::new(Arc::new(blizzard::BlizzardState::new()));

        let bnet_redirect = std::env::var("BLIZZARD_REDIRECT_URI").unwrap_or_else(|_| {
            if port == 17384 || cfg!(feature = "desktop") {
                format!("http://localhost:{}/api/auth/bnet/callback", port)
            } else {
                "http://localhost:3000/api/auth/bnet/callback".to_string()
            }
        });
        let jwt_secret =
            std::env::var("JWT_SECRET").unwrap_or_else(|_| "dev-secret-key-123".to_string());

        let client_id = std::env::var("BLIZZARD_CLIENT_ID").ok();
        let client_secret = std::env::var("BLIZZARD_CLIENT_SECRET").ok();

        println!("Configured Blizzard Redirect URI: {}", bnet_redirect);

        let auth_state = web::Data::new(Arc::new(auth_handlers::BlizzardAuthState::new(
            client_id,
            client_secret,
            bnet_redirect,
            jwt_secret,
        )));

        let sync_state = web::Data::new(Arc::new(data_sync::DataSyncState::new()));

        // For historical/trait reasons, we still provide a web::Data<Option<Arc<BlizzardAuthState>>>
        // to the proxy handlers so они can check for JWT sub.
        let auth_state_opt_data = web::Data::new(Some(auth_state.get_ref().clone()));

        let server = HttpServer::new(move || {
            let cors = Cors::default()
                .allowed_origin_fn(|origin, _req_head| {
                    let origin_str = origin.to_str().unwrap_or("");
                    origin_str == "http://localhost:3000"
                        || origin_str == "tauri://localhost"
                        || origin_str == "https://tauri.localhost"
                        || origin_str == "http://tauri.localhost"
                        || origin_str == "tauri.localhost"
                        || origin_str.starts_with("http://localhost:")
                        || origin_str.starts_with("https://localhost:")
                        || origin_str.starts_with("http://127.0.0.1:")
                        || origin_str.starts_with("https://127.0.0.1:")
                })
                .allow_any_method()
                .allow_any_header()
                .supports_credentials()
                .max_age(3600);

            let mut app = App::new()
                .app_data(web::JsonConfig::default().error_handler(|err, _req| {
                    let detail = err.to_string();
                    actix_web::error::InternalError::from_response(
                        err,
                        HttpResponse::BadRequest().json(serde_json::json!({ "detail": detail })),
                    )
                    .into()
                }))
                .wrap(cors)
                .app_data(store_data.clone())
                .app_data(simc_data.clone())
                .app_data(log_data.clone())
                .app_data(blizzard_state.clone())
                .app_data(auth_state.clone())
                .app_data(auth_state_opt_data.clone())
                .route(
                    "/api/auth/bnet/login",
                    web::get().to(auth_handlers::bnet_login),
                )
                .route(
                    "/api/auth/bnet/login-success",
                    web::get().to(auth_handlers::login_success),
                )
                .route("/api/auth/poll", web::get().to(auth_handlers::poll_login))
                .route(
                    "/api/auth/bnet/callback",
                    web::get().to(auth_handlers::bnet_callback),
                )
                .route(
                    "/api/auth/bnet/credentials-status",
                    web::get().to(auth_handlers::get_credentials_status),
                )
                .route("/api/auth/me", web::get().to(auth_handlers::get_me))
                .route(
                    "/api/auth/logout",
                    web::post().to(auth_handlers::bnet_logout),
                )
                .route(
                    "/api/bnet/user/characters",
                    web::get().to(auth_handlers::get_characters),
                )
                .route(
                    "/api/user/config",
                    web::get().to(auth_handlers::get_user_configs),
                )
                .route(
                    "/api/user/config",
                    web::post().to(auth_handlers::set_user_config),
                )
                .route(
                    "/api/user/blizzard/clear",
                    web::post().to(auth_handlers::clear_user_configs),
                )
                .route(
                    "/api/system/blizzard/credentials",
                    web::post().to(auth_handlers::set_system_blizzard_creds),
                )
                .route(
                    "/api/user/blizzard/test",
                    web::post().to(auth_handlers::test_blizzard_creds),
                )
                .route(
                    "/api/data/status",
                    web::get().to(data_sync::get_sync_status),
                )
                .route(
                    "/api/data/files",
                    web::get().to(data_sync::get_data_file_states),
                )
                .route(
                    "/api/data/files/open-directory",
                    web::post().to(data_sync::open_data_directory),
                )
                .route(
                    "/api/data/files/missing/download",
                    web::post().to(data_sync::download_missing_data_files),
                )
                .route(
                    "/api/data/files/{key}/download",
                    web::post().to(data_sync::download_data_file),
                )
                .route(
                    "/api/data/files/{key}/content",
                    web::get().to(data_sync::get_data_file_content),
                )
                .route("/api/data/sync", web::post().to(data_sync::trigger_sync))
                .route(
                    "/api/data/sync-dungeons",
                    web::post().to(data_sync::trigger_dungeon_sync),
                );

            #[cfg(feature = "desktop")]
            {
                app = app
                    .app_data(stats_data.clone())
                    .app_data(simc_updater_data.clone());
            }

            // Simulation routes
            app = app
                .route("/api/sim", web::post().to(sim_handlers::create_sim))
                .route(
                    "/api/top-gear/sim",
                    web::post().to(sim_handlers::create_top_gear_sim),
                )
                .route(
                    "/api/top-gear/combo-count",
                    web::post().to(sim_handlers::get_top_gear_combo_count),
                )
                .route(
                    "/api/droptimizer/sim",
                    web::post().to(sim_handlers::create_droptimizer_sim),
                )
                // Upgrade compare routes
                .route(
                    "/api/upgrade-compare/prepare",
                    web::post().to(upgrade_compare::get_upgrade_compare_prepare),
                )
                .route(
                    "/api/upgrade-compare/sim",
                    web::post().to(upgrade_compare::create_upgrade_compare_sim),
                )
                .route(
                    "/api/upgrade-compare/combo-count",
                    web::post().to(upgrade_compare::get_upgrade_compare_combo_count),
                )
                .route(
                    "/api/upgrade-options",
                    web::get().to(upgrade_compare::get_upgrade_options_handler),
                )
                // Job management routes
                .route("/api/sim/{id}", web::get().to(job_handlers::get_sim_status))
                .route(
                    "/api/sim/{id}/logs",
                    web::get().to(job_handlers::get_sim_logs),
                )
                .route(
                    "/api/sim/{id}/cancel",
                    web::post().to(job_handlers::cancel_sim),
                )
                .route("/api/sim/{id}/link", web::post().to(job_handlers::link_sim))
                .route(
                    "/api/sim/{id}/input",
                    web::get().to(job_handlers::get_sim_input),
                )
                .route(
                    "/api/sim/{id}/raw",
                    web::get().to(job_handlers::get_sim_raw),
                )
                .route(
                    "/api/sim/{id}/html",
                    web::get().to(job_handlers::get_sim_html),
                )
                .route(
                    "/api/sim/{id}/output.txt",
                    web::get().to(job_handlers::get_sim_text_output),
                )
                .route(
                    "/api/sim/{id}/data.csv",
                    web::get().to(job_handlers::get_sim_csv),
                )
                .route("/api/sim/{id}", web::delete().to(job_handlers::delete_sim))
                .route(
                    "/api/history/stats",
                    web::get().to(job_handlers::get_history_stats),
                )
                .route(
                    "/api/history/characters",
                    web::get().to(job_handlers::get_history_characters),
                )
                .route(
                    "/api/history/clear",
                    web::post().to(job_handlers::clear_history),
                )
                // Blizzard proxy routes (only active if configured)
                .route(
                    "/api/blizzard/character/{realm}/{name}/profile",
                    web::get().to(blizzard::proxy_character_profile),
                )
                .route(
                    "/api/blizzard/character/{realm}/{name}/equipment",
                    web::get().to(blizzard::proxy_character_equipment),
                )
                .route(
                    "/api/blizzard/character/{realm}/{name}/statistics",
                    web::get().to(blizzard::proxy_character_statistics),
                )
                .route(
                    "/api/blizzard/character/{realm}/{name}/specializations",
                    web::get().to(blizzard::proxy_character_specializations),
                )
                .route(
                    "/api/blizzard/character/{realm}/{name}/media/{type}",
                    web::get().to(blizzard::proxy_character_media),
                )
                .route(
                    "/api/blizzard/character/{realm}/{name}/professions",
                    web::get().to(blizzard::proxy_character_professions),
                )
                .route(
                    "/api/blizzard/character/{realm}/{name}/mythic-keystone-profile",
                    web::get().to(blizzard::proxy_character_mythic_keystone_profile),
                )
                .route(
                    "/api/blizzard/character/{realm}/{name}/encounters/raids",
                    web::get().to(blizzard::proxy_character_raid_encounters),
                )
                // Game data routes
                .route(
                    "/api/item-info/{id}",
                    web::get().to(game_data_handlers::get_item_info),
                )
                .route(
                    "/api/item-info/batch",
                    web::post().to(game_data_handlers::get_item_info_batch),
                )
                .route(
                    "/api/enchant-info/{id}",
                    web::get().to(game_data_handlers::get_enchant_info),
                )
                .route(
                    "/api/gem-info/{id}",
                    web::get().to(game_data_handlers::get_gem_info),
                )
                .route(
                    "/api/max-upgrade-ilevels",
                    web::post().to(game_data_handlers::get_max_upgrade_ilevels),
                )
                .route(
                    "/api/gear/enchant-options",
                    web::get().to(game_data_handlers::list_enchant_options),
                )
                .route(
                    "/api/gear/gem-options",
                    web::get().to(game_data_handlers::list_gem_options),
                )
                .route(
                    "/api/gear/consumable-options",
                    web::get().to(game_data_handlers::list_consumable_options),
                )
                .route(
                    "/api/upgrade-tracks",
                    web::get().to(game_data_handlers::list_upgrade_tracks),
                )
                .route(
                    "/api/gear/resolve",
                    web::post().to(game_data_handlers::resolve_gear),
                )
                .route(
                    "/api/gear/catalyst-convert",
                    web::post().to(game_data_handlers::catalyst_convert),
                )
                .route(
                    "/api/season-config",
                    web::get().to(game_data_handlers::get_season_config),
                )
                // Saved dungeon routes
                .route("/api/routes", web::post().to(route_handlers::save_route))
                .route("/api/routes", web::get().to(route_handlers::list_routes))
                .route(
                    "/api/routes/{id}",
                    web::delete().to(route_handlers::delete_route),
                )
                // Character profiles
                .route(
                    "/api/character-profiles",
                    web::post().to(character_profile_handlers::save_character_profile),
                )
                .route(
                    "/api/character-profiles",
                    web::get().to(character_profile_handlers::list_character_profiles),
                )
                .route(
                    "/api/character-profiles/{id}",
                    web::delete().to(character_profile_handlers::delete_character_profile),
                )
                .route(
                    "/api/instances",
                    web::get().to(game_data_handlers::list_instances),
                )
                .route(
                    "/api/instances/type/{type}/drops",
                    web::get().to(game_data_handlers::get_drops_by_type),
                )
                .route(
                    "/api/instances/{id}/drops",
                    web::get().to(game_data_handlers::get_instance_drops),
                )
                .route(
                    "/api/talent-tree/{specId}",
                    web::get().to(game_data_handlers::get_talent_tree),
                )
                .route("/api/sims", web::get().to(job_handlers::list_sims))
                .route("/api/config", web::get().to(get_config))
                .route("/api/config", web::post().to(update_config))
                .route(
                    "/api/dungeons",
                    web::get().to(game_data_handlers::get_dungeon_data),
                )
                .route("/health", web::get().to(health_check));

            #[cfg(feature = "desktop")]
            {
                app = app
                    .route("/api/system-stats", web::get().to(system_stats))
                    .route(
                        "/api/system/simc/status",
                        web::get().to(simc_updater::simc_status),
                    )
                    .route(
                        "/api/system/simc/download-latest",
                        web::post().to(simc_updater::download_latest_simc),
                    )
                    .route(
                        "/api/system/simc/remove",
                        web::post().to(simc_updater::remove_simc_channel),
                    );
            }

            let data_dir_inner = data.clone();
            app = app.app_data(web::Data::new(data_dir_inner));
            app = app.app_data(sync_state.clone());

            // Serve cached assets from data directory
            if let Some(ref dir) = data {
                let images_dir = dir.join("instance-images");
                if images_dir.exists() {
                    app = app.service(
                        actix_files::Files::new("/api/data/instance-images", images_dir)
                            .prefer_utf8(true),
                    );
                }
                let static_dir = dir.join("static");
                if static_dir.exists() {
                    app = app.service(
                        actix_files::Files::new("/api/data/static", static_dir).prefer_utf8(true),
                    );
                }
            }

            // Serve static frontend files in production (not in dev mode)
            if let Some(ref dir) = frontend {
                app = app
                    .app_data(web::Data::new(FrontendDir(dir.clone())))
                    .service(actix_files::Files::new("/_next", dir.join("_next")).prefer_utf8(true))
                    .default_service(web::get().to(spa_fallback));
            }

            app
        })
        .bind(&bind_addr)
        .unwrap_or_else(|_| panic!("Failed to bind to {}", bind_addr))
        .run();

        println!("HTTP server starting on port {}", port);
        (server, port)
    }
    #[cfg(not(feature = "web"))]
    {
        panic!("HTTP server disabled (web feature not active)");
    }
}
