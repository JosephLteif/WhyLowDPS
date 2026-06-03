use std::sync::Arc;

use actix_files::NamedFile;
use actix_web::{web, HttpRequest, HttpResponse};
use serde::Deserialize;
use serde_json::json;

#[cfg(feature = "desktop")]
use std::sync::Mutex;

use super::types::FrontendDir;
use crate::storage::{self, JobStorage};

#[cfg(feature = "desktop")]
/// Shared system info state, refreshed in background for live CPU readings.
pub(super) struct SystemStats {
    sys: sysinfo::System,
}

#[cfg(feature = "desktop")]
impl SystemStats {
    pub(super) fn new() -> Self {
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

pub(super) async fn get_config(store: web::Data<Arc<dyn JobStorage>>) -> HttpResponse {
    HttpResponse::Ok().json(json!({
        "max_scenarios": *storage::MAX_SCENARIOS,
        "max_jobs": store.get_max_jobs(),
    }))
}

#[derive(Deserialize)]
pub(super) struct UpdateConfig {
    pub(super) max_jobs: Option<usize>,
}

pub(super) async fn update_config(
    body: web::Json<UpdateConfig>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    if let Some(limit) = body.max_jobs {
        store.set_max_jobs(limit);
    }
    HttpResponse::Ok().json(json!({"status": "updated"}))
}

pub(super) async fn health_check() -> HttpResponse {
    let threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);
    HttpResponse::Ok().json(json!({
        "status": "ok",
        "threads": threads,
        "mode": "desktop",
    }))
}

#[cfg(feature = "desktop")]
pub(super) async fn system_stats(stats: web::Data<Arc<Mutex<SystemStats>>>) -> HttpResponse {
    let mut s = stats.lock().unwrap();
    s.refresh();
    let cpu = s.cpu_usage();
    HttpResponse::Ok().json(json!({
        "cpu_usage": (cpu * 10.0).round() / 10.0,
    }))
}

/// SPA fallback: serve the appropriate HTML file for client-side routes.
pub(super) async fn spa_fallback(
    req: HttpRequest,
    frontend_dir: web::Data<FrontendDir>,
) -> actix_web::Result<NamedFile> {
    let path = req.path();
    let trimmed = path.trim_start_matches('/').trim_end_matches('/');

    if !trimmed.is_empty() {
        let folder_index = frontend_dir.0.join(trimmed).join("index.html");
        if folder_index.exists() {
            return Ok(NamedFile::open(folder_index)?);
        }

        let flat_html = frontend_dir.0.join(format!("{}.html", trimmed));
        if flat_html.exists() {
            return Ok(NamedFile::open(flat_html)?);
        }
    }

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

    Ok(NamedFile::open(frontend_dir.0.join("index.html"))?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::{JobStorage, MemoryStorage};
    use actix_web::body::to_bytes;
    use actix_web::test::TestRequest;
    use serde_json::Value;
    use std::fs;

    fn test_store() -> web::Data<Arc<dyn JobStorage>> {
        web::Data::new(Arc::new(MemoryStorage::new()) as Arc<dyn JobStorage>)
    }

    async fn response_json(resp: HttpResponse) -> Value {
        let body = to_bytes(resp.into_body()).await.expect("response body");
        serde_json::from_slice(&body).expect("response json")
    }

    fn write_file(path: impl AsRef<std::path::Path>, body: &str) {
        if let Some(parent) = path.as_ref().parent() {
            fs::create_dir_all(parent).expect("create parent dir");
        }
        fs::write(path, body).expect("write file");
    }

    #[actix_web::test]
    async fn get_config_returns_max_scenarios_and_current_max_jobs() {
        let store = test_store();
        store.set_max_jobs(7);

        let resp = get_config(store).await;

        assert_eq!(resp.status(), 200);

        let payload = response_json(resp).await;

        assert_eq!(
            payload["max_scenarios"].as_u64(),
            Some(*storage::MAX_SCENARIOS as u64)
        );

        assert_eq!(payload["max_jobs"].as_u64(), Some(7));
    }

    #[actix_web::test]
    async fn update_config_without_max_jobs_preserves_existing_limit() {
        let store = test_store();
        store.set_max_jobs(9);

        let resp = update_config(web::Json(UpdateConfig { max_jobs: None }), store.clone()).await;

        assert_eq!(resp.status(), 200);
        assert_eq!(
            response_json(resp).await["status"].as_str(),
            Some("updated")
        );

        let config = get_config(store).await;
        let payload = response_json(config).await;

        assert_eq!(payload["max_jobs"].as_u64(), Some(9));
    }

    #[actix_web::test]
    async fn update_config_with_max_jobs_updates_config() {
        let store = test_store();
        store.set_max_jobs(3);

        let resp = update_config(
            web::Json(UpdateConfig { max_jobs: Some(12) }),
            store.clone(),
        )
        .await;

        assert_eq!(resp.status(), 200);
        assert_eq!(
            response_json(resp).await["status"].as_str(),
            Some("updated")
        );

        let config = get_config(store).await;
        let payload = response_json(config).await;

        assert_eq!(payload["max_jobs"].as_u64(), Some(12));
        assert_eq!(
            payload["max_scenarios"].as_u64(),
            Some(*storage::MAX_SCENARIOS as u64)
        );
    }

    #[actix_web::test]
    async fn update_config_allows_zero_max_jobs() {
        let store = test_store();
        store.set_max_jobs(3);

        let resp =
            update_config(web::Json(UpdateConfig { max_jobs: Some(0) }), store.clone()).await;

        assert_eq!(resp.status(), 200);

        let config = get_config(store).await;
        let payload = response_json(config).await;

        assert_eq!(payload["max_jobs"].as_u64(), Some(0));
    }

    #[actix_web::test]
    async fn update_config_can_be_applied_multiple_times() {
        let store = test_store();

        update_config(web::Json(UpdateConfig { max_jobs: Some(4) }), store.clone()).await;

        update_config(
            web::Json(UpdateConfig { max_jobs: Some(15) }),
            store.clone(),
        )
        .await;

        let config = get_config(store).await;
        let payload = response_json(config).await;

        assert_eq!(payload["max_jobs"].as_u64(), Some(15));
    }

    #[actix_web::test]
    async fn health_check_reports_ok_desktop_mode_and_threads() {
        let health = health_check().await;

        assert_eq!(health.status(), 200);

        let payload = response_json(health).await;

        assert_eq!(payload["status"].as_str(), Some("ok"));
        assert_eq!(payload["mode"].as_str(), Some("desktop"));
        assert!(payload["threads"].as_u64().unwrap_or(0) >= 1);
    }

    #[cfg(feature = "desktop")]
    #[test]
    fn system_stats_new_returns_non_negative_cpu_usage() {
        let stats = SystemStats::new();
        assert!(stats.cpu_usage() >= 0.0);
    }

    #[cfg(feature = "desktop")]
    #[test]
    fn system_stats_refresh_keeps_cpu_usage_non_negative() {
        let mut stats = SystemStats::new();
        stats.refresh();
        assert!(stats.cpu_usage() >= 0.0);
    }

    #[cfg(feature = "desktop")]
    #[actix_web::test]
    async fn system_stats_endpoint_returns_rounded_cpu_usage() {
        let stats = web::Data::new(Arc::new(Mutex::new(SystemStats::new())));

        let resp = system_stats(stats).await;

        assert_eq!(resp.status(), 200);

        let payload = response_json(resp).await;
        let cpu_usage = payload["cpu_usage"]
            .as_f64()
            .expect("cpu_usage should be numeric");

        assert!(cpu_usage >= 0.0);
        assert!(cpu_usage <= 100.0);
    }

    #[actix_web::test]
    async fn spa_fallback_serves_folder_index_for_nested_route() {
        let dir = tempfile::tempdir().expect("frontend temp dir");

        write_file(dir.path().join("settings").join("index.html"), "settings");

        let frontend = web::Data::new(FrontendDir(dir.path().to_path_buf()));

        let file = spa_fallback(
            TestRequest::with_uri("/settings").to_http_request(),
            frontend,
        )
        .await
        .expect("settings fallback");

        assert_eq!(
            fs::read_to_string(file.path()).expect("settings body"),
            "settings"
        );
    }

    #[actix_web::test]
    async fn spa_fallback_serves_folder_index_when_route_has_trailing_slash() {
        let dir = tempfile::tempdir().expect("frontend temp dir");

        write_file(dir.path().join("settings").join("index.html"), "settings");

        let frontend = web::Data::new(FrontendDir(dir.path().to_path_buf()));

        let file = spa_fallback(
            TestRequest::with_uri("/settings/").to_http_request(),
            frontend,
        )
        .await
        .expect("settings fallback");

        assert_eq!(
            fs::read_to_string(file.path()).expect("settings body"),
            "settings"
        );
    }

    #[actix_web::test]
    async fn spa_fallback_serves_flat_html_when_folder_index_is_missing() {
        let dir = tempfile::tempdir().expect("frontend temp dir");

        write_file(dir.path().join("about.html"), "about");

        let frontend = web::Data::new(FrontendDir(dir.path().to_path_buf()));

        let file = spa_fallback(TestRequest::with_uri("/about").to_http_request(), frontend)
            .await
            .expect("about fallback");

        assert_eq!(
            fs::read_to_string(file.path()).expect("about body"),
            "about"
        );
    }

    #[actix_web::test]
    async fn spa_fallback_prefers_folder_index_over_flat_html() {
        let dir = tempfile::tempdir().expect("frontend temp dir");

        write_file(dir.path().join("about").join("index.html"), "folder");
        write_file(dir.path().join("about.html"), "flat");

        let frontend = web::Data::new(FrontendDir(dir.path().to_path_buf()));

        let file = spa_fallback(TestRequest::with_uri("/about").to_http_request(), frontend)
            .await
            .expect("about fallback");

        assert_eq!(
            fs::read_to_string(file.path()).expect("about body"),
            "folder"
        );
    }

    #[actix_web::test]
    async fn spa_fallback_serves_sim_placeholder_for_sim_root() {
        let dir = tempfile::tempdir().expect("frontend temp dir");

        write_file(dir.path().join("sim").join("_").join("index.html"), "sim");

        let frontend = web::Data::new(FrontendDir(dir.path().to_path_buf()));

        for uri in ["/sim", "/sim/"] {
            let file = spa_fallback(
                TestRequest::with_uri(uri).to_http_request(),
                frontend.clone(),
            )
            .await
            .expect("sim fallback");

            assert_eq!(fs::read_to_string(file.path()).expect("sim body"), "sim");
        }
    }

    #[actix_web::test]
    async fn spa_fallback_serves_sim_placeholder_for_nested_sim_route() {
        let dir = tempfile::tempdir().expect("frontend temp dir");

        write_file(dir.path().join("sim").join("_").join("index.html"), "sim");

        let frontend = web::Data::new(FrontendDir(dir.path().to_path_buf()));

        let file = spa_fallback(
            TestRequest::with_uri("/sim/abc123").to_http_request(),
            frontend,
        )
        .await
        .expect("sim nested fallback");

        assert_eq!(fs::read_to_string(file.path()).expect("sim body"), "sim");
    }

    #[actix_web::test]
    async fn spa_fallback_serves_character_placeholder_for_character_root() {
        let dir = tempfile::tempdir().expect("frontend temp dir");

        write_file(
            dir.path()
                .join("character")
                .join("us")
                .join("realm")
                .join("name")
                .join("index.html"),
            "character",
        );

        let frontend = web::Data::new(FrontendDir(dir.path().to_path_buf()));

        for uri in ["/character", "/character/"] {
            let file = spa_fallback(
                TestRequest::with_uri(uri).to_http_request(),
                frontend.clone(),
            )
            .await
            .expect("character fallback");

            assert_eq!(
                fs::read_to_string(file.path()).expect("character body"),
                "character"
            );
        }
    }

    #[actix_web::test]
    async fn spa_fallback_serves_character_placeholder_for_nested_character_route() {
        let dir = tempfile::tempdir().expect("frontend temp dir");

        write_file(
            dir.path()
                .join("character")
                .join("us")
                .join("realm")
                .join("name")
                .join("index.html"),
            "character",
        );

        let frontend = web::Data::new(FrontendDir(dir.path().to_path_buf()));

        let file = spa_fallback(
            TestRequest::with_uri("/character/eu/turalyon/lazarruss").to_http_request(),
            frontend,
        )
        .await
        .expect("character nested fallback");

        assert_eq!(
            fs::read_to_string(file.path()).expect("character body"),
            "character"
        );
    }

    #[actix_web::test]
    async fn spa_fallback_serves_root_index_for_unknown_route() {
        let dir = tempfile::tempdir().expect("frontend temp dir");

        write_file(dir.path().join("index.html"), "root");

        let frontend = web::Data::new(FrontendDir(dir.path().to_path_buf()));

        let file = spa_fallback(
            TestRequest::with_uri("/unknown").to_http_request(),
            frontend,
        )
        .await
        .expect("root fallback");

        assert_eq!(fs::read_to_string(file.path()).expect("root body"), "root");
    }

    #[actix_web::test]
    async fn spa_fallback_serves_root_index_for_root_path() {
        let dir = tempfile::tempdir().expect("frontend temp dir");

        write_file(dir.path().join("index.html"), "root");

        let frontend = web::Data::new(FrontendDir(dir.path().to_path_buf()));

        let file = spa_fallback(TestRequest::with_uri("/").to_http_request(), frontend)
            .await
            .expect("root fallback");

        assert_eq!(fs::read_to_string(file.path()).expect("root body"), "root");
    }

    #[actix_web::test]
    async fn spa_fallback_errors_when_no_matching_file_or_root_index_exists() {
        let dir = tempfile::tempdir().expect("frontend temp dir");

        let frontend = web::Data::new(FrontendDir(dir.path().to_path_buf()));

        let missing = spa_fallback(
            TestRequest::with_uri("/missing").to_http_request(),
            frontend,
        )
        .await;

        assert!(missing.is_err());
    }
}
