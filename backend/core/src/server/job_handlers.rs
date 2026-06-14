use actix_web::{web, HttpResponse};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;

use super::types::*;
use crate::log_buffer::LogBuffer;
use crate::models::JobStatus;
use crate::simc_runner;
use crate::storage::JobStorage;

pub(super) async fn list_sims(
    query: web::Query<ListSimsQuery>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    let max_jobs = store.get_max_jobs();

    let player = if query.player.is_empty() {
        None
    } else {
        Some(query.player.as_str())
    };
    let realm = if query.realm.is_empty() {
        None
    } else {
        Some(query.realm.as_str())
    };

    let summaries = store.list_recent(
        std::cmp::max(max_jobs, 10000),
        player,
        realm,
        query.linked_only,
        query.unlinked_only,
        query.pinned_only,
    );
    HttpResponse::Ok().json(summaries)
}

pub(super) async fn list_related_sims(
    path: web::Path<String>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    let id = path.into_inner();
    let job = match store.get(&id) {
        Some(j) => j,
        None => return HttpResponse::NotFound().json(json!({ "detail": "Job not found" })),
    };

    let parent_id = job.batch_id.clone().unwrap_or_else(|| job.id.clone());
    let max_jobs = store.get_max_jobs();
    let summaries = store.list_recent(
        std::cmp::max(max_jobs, 3000),
        None,
        None,
        false,
        false,
        false,
    );

    let related: Vec<Value> = summaries
        .into_iter()
        .filter(|s| s.id == parent_id || s.batch_id.as_deref() == Some(parent_id.as_str()))
        .map(|s| {
            json!({
                "id": s.id,
                "status": s.status,
                "sim_type": s.sim_type,
                "batch_id": s.batch_id,
                "fight_style": s.fight_style,
                "player_name": s.player_name,
                "created_at": s.created_at,
            })
        })
        .collect();

    HttpResponse::Ok().json(related)
}

pub(super) async fn get_sim_status(
    path: web::Path<String>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    let job_id = path.into_inner();
    let job = match store.get(&job_id) {
        Some(j) => j,
        None => {
            return HttpResponse::NotFound().json(json!({"detail": "Job not found"}));
        }
    };

    let status_str = match job.status {
        JobStatus::Pending => "pending",
        JobStatus::Running => "running",
        JobStatus::Done => "done",
        JobStatus::Failed => "failed",
        JobStatus::Cancelled => "cancelled",
    };

    let progress = match job.status {
        JobStatus::Done => 100,
        _ => job.progress_pct as i32,
    };

    let parsed_result: Option<Value> = if job.status == JobStatus::Done {
        job.result_json
            .as_ref()
            .and_then(|s| serde_json::from_str(s).ok())
    } else {
        None
    };

    let mut profilesets_completed = 0;
    let mut profilesets_total = 0;
    let mut iterations_completed = 0;
    if let Some(ref detail) = job.progress_detail {
        if let Some(caps) = regex::Regex::new(r"(\d+)/(\d+) profilesets")
            .unwrap()
            .captures(detail)
        {
            profilesets_completed = caps[1].parse::<usize>().unwrap_or(0);
            profilesets_total = caps[2].parse::<usize>().unwrap_or(0);
        } else if let Some(caps) = regex::Regex::new(r"(\d+)/(\d+) iterations")
            .unwrap()
            .captures(detail)
        {
            iterations_completed = caps[1].parse::<usize>().unwrap_or(0);
        } else if let Some(caps) = regex::Regex::new(r"(\d+) combos").unwrap().captures(detail) {
            profilesets_total = caps[1].parse::<usize>().unwrap_or(0);
        }
    }

    let mut cpu_cores = std::thread::available_parallelism()
        .map(|n| n.get() as u32)
        .unwrap_or(4);
    for line in job.simc_input.lines() {
        if let Some(val) = line.trim().strip_prefix("threads=") {
            if let Ok(n) = val.parse::<u32>() {
                cpu_cores = n;
                break;
            }
        }
    }

    let mut cpu_pct = 0.0;
    let mut mem_bytes = 0;
    if job.status == JobStatus::Running {
        if let Some((cpu, mem)) = crate::simc_runner::get_process_stats(&job_id) {
            cpu_pct = cpu / cpu_cores as f32;
            mem_bytes = mem;
        }
    }

    HttpResponse::Ok().json(json!({
        "id": job.id,
        "status": status_str,
        "sim_type": job.sim_type,
        "simc_input": job.simc_input,
        "options": job.options,
        "created_at": job.created_at,
        "progress": progress,
        "progress_stage": job.progress_stage,
        "progress_detail": job.progress_detail,
        "stages_completed": job.stages_completed,
        "result": parsed_result,
        "error": job.error_message,
        "iterations": job.iterations,
        "iterations_completed": iterations_completed,
        "fight_style": job.fight_style,
        "profilesets_completed": profilesets_completed,
        "profilesets_total": profilesets_total,
        "cpu_pct": cpu_pct,
        "mem_bytes": mem_bytes,
        "cpu_cores": cpu_cores,
        "linked_region": job.linked_region,
        "linked_realm": job.linked_realm,
        "linked_name": job.linked_name,
    }))
}

pub(super) async fn get_sim_logs(
    path: web::Path<String>,
    query: web::Query<LogsQuery>,
    log_buffer: web::Data<Arc<LogBuffer>>,
) -> HttpResponse {
    let job_id = path.into_inner();
    let (lines, next) = log_buffer.get_lines_after(&job_id, query.after);
    HttpResponse::Ok().json(json!({
        "lines": lines,
        "next": next,
    }))
}

pub(super) async fn cancel_sim(
    path: web::Path<String>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    let job_id = path.into_inner();
    let job = match store.get(&job_id) {
        Some(j) => j,
        None => return HttpResponse::NotFound().json(json!({"detail": "Job not found"})),
    };

    match job.status {
        JobStatus::Pending | JobStatus::Running => {
            // Mark as cancelled first so the error handler doesn't overwrite
            store.update_status(&job_id, JobStatus::Cancelled);
            // Kill the simc process if running
            simc_runner::kill_job(&job_id);
            HttpResponse::Ok().json(json!({"status": "cancelled"}))
        }
        _ => HttpResponse::BadRequest().json(json!({"detail": "Job is not running"})),
    }
}

pub(super) async fn get_sim_input(
    path: web::Path<String>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    let job_id = path.into_inner();
    let job = match store.get(&job_id) {
        Some(j) => j,
        None => {
            return HttpResponse::NotFound().json(json!({"detail": "Job not found"}));
        }
    };

    HttpResponse::Ok()
        .content_type("text/plain; charset=utf-8")
        .body(job.simc_input)
}

pub(super) async fn get_sim_raw(
    path: web::Path<String>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    let job_id = path.into_inner();
    let job = match store.get(&job_id) {
        Some(j) => j,
        None => {
            return HttpResponse::NotFound().json(json!({"detail": "Job not found"}));
        }
    };

    match &job.raw_json {
        Some(raw) => match serde_json::from_str::<Value>(raw) {
            Ok(val) => HttpResponse::Ok().json(val),
            Err(_) => HttpResponse::InternalServerError()
                .json(json!({"detail": "Failed to parse stored raw JSON"})),
        },
        None => {
            // Fallback to parsed result if raw not available
            match &job.result_json {
                Some(result) => match serde_json::from_str::<Value>(result) {
                    Ok(val) => HttpResponse::Ok().json(val),
                    Err(_) => HttpResponse::InternalServerError()
                        .json(json!({"detail": "Failed to parse stored result"})),
                },
                None => {
                    HttpResponse::NotFound().json(json!({"detail": "No results available yet"}))
                }
            }
        }
    }
}

pub(super) async fn get_sim_html(
    path: web::Path<String>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    let job_id = path.into_inner();
    let job = match store.get(&job_id) {
        Some(j) => j,
        None => {
            return HttpResponse::NotFound().json(json!({"detail": "Job not found"}));
        }
    };

    match &job.html_report {
        Some(html) => HttpResponse::Ok()
            .content_type("text/html; charset=utf-8")
            .body(html.clone()),
        None => HttpResponse::NotFound()
            .json(json!({"detail": "HTML report not available for this sim"})),
    }
}

pub(super) async fn get_sim_text_output(
    path: web::Path<String>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    let job_id = path.into_inner();
    let job = match store.get(&job_id) {
        Some(j) => j,
        None => {
            return HttpResponse::NotFound().json(json!({"detail": "Job not found"}));
        }
    };

    match &job.text_output {
        Some(text) => HttpResponse::Ok()
            .content_type("text/plain; charset=utf-8")
            .body(text.clone()),
        None => HttpResponse::NotFound()
            .json(json!({"detail": "Text output not available for this sim"})),
    }
}

pub(super) async fn get_sim_csv(
    path: web::Path<String>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    let job_id = path.into_inner();
    let job = match store.get(&job_id) {
        Some(j) => j,
        None => {
            return HttpResponse::NotFound().json(json!({"detail": "Job not found"}));
        }
    };

    let result = match &job.result_json {
        Some(r) => match serde_json::from_str::<Value>(r) {
            Ok(v) => v,
            Err(_) => {
                return HttpResponse::InternalServerError()
                    .json(json!({"detail": "Failed to parse result"}))
            }
        },
        None => {
            return HttpResponse::NotFound().json(json!({"detail": "No results available yet"}))
        }
    };

    let mut csv = String::from("actor,dps,dps_error\n");

    if result.get("type").and_then(|t| t.as_str()) == Some("top_gear") {
        // Top Gear / Droptimizer: base + profileset results
        if let Some(base_dps) = result.get("base_dps").and_then(|v| v.as_f64()) {
            let name = result
                .get("player_name")
                .and_then(|n| n.as_str())
                .unwrap_or("Base");
            csv.push_str(&format!("{},{:.1},\n", name, base_dps));
        }
        if let Some(results) = result.get("results").and_then(|r| r.as_array()) {
            for r in results {
                let name = r.get("name").and_then(|n| n.as_str()).unwrap_or("");
                let dps = r.get("dps").and_then(|v| v.as_f64()).unwrap_or(0.0);
                csv.push_str(&format!("{},{:.1},\n", name, dps));
            }
        }
    } else {
        // Quick Sim
        let name = result
            .get("player_name")
            .and_then(|n| n.as_str())
            .unwrap_or("Player");
        let dps = result.get("dps").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let error = result
            .get("dps_error")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        csv.push_str(&format!("{},{:.1},{:.1}\n", name, dps, error));
    }

    HttpResponse::Ok()
        .content_type("text/csv; charset=utf-8")
        .insert_header((
            "Content-Disposition",
            format!("attachment; filename=\"sim-{}.csv\"", job_id),
        ))
        .body(csv)
}

pub(super) async fn delete_sim(
    path: web::Path<String>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    let id = path.into_inner();
    store.delete(&id);
    crate::simc_runner::cleanup_cancelled_job(&id);
    HttpResponse::Ok().json(json!({"status": "deleted"}))
}

pub(super) async fn get_history_stats(store: web::Data<Arc<dyn JobStorage>>) -> HttpResponse {
    let size = store.get_storage_size();
    let sims = store.list_recent(1000, None, None, false, false, false);
    HttpResponse::Ok().json(json!({
        "size_bytes": size,
        "count": sims.len(),
    }))
}

pub(super) async fn clear_history(store: web::Data<Arc<dyn JobStorage>>) -> HttpResponse {
    store.clear_history();
    HttpResponse::Ok().json(json!({"status": "cleared"}))
}

#[derive(Deserialize)]
pub struct LinkSimRequest {
    pub region: Option<String>,
    pub realm: Option<String>,
    pub name: Option<String>,
}

pub(super) async fn link_sim(
    path: web::Path<String>,
    payload: web::Json<LinkSimRequest>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    let id = path.into_inner();
    store.link_character(
        &id,
        payload.region.clone(),
        payload.realm.clone(),
        payload.name.clone(),
    );
    HttpResponse::Ok().json(json!({"status": "linked"}))
}

#[derive(Deserialize)]
pub struct PinSimRequest {
    pub pinned: bool,
}

pub(super) async fn pin_sim(
    path: web::Path<String>,
    payload: web::Json<PinSimRequest>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    let id = path.into_inner();
    store.set_pinned(&id, payload.pinned);
    HttpResponse::Ok().json(json!({"status": "updated", "pinned": payload.pinned}))
}

pub(super) async fn get_history_characters(store: web::Data<Arc<dyn JobStorage>>) -> HttpResponse {
    let sims = store.list_recent(10000, None, None, false, false, false);
    let mut seen = std::collections::HashSet::new();
    let mut chars = Vec::new();

    for sim in sims {
        // Use the summary names which already incorporate linked overrides
        let name = sim.player_name.clone();
        let realm = sim.realm.clone().unwrap_or_else(|| "Unknown".to_string());
        let region = sim
            .linked_region
            .clone()
            .unwrap_or_else(|| "us".to_string());

        if let Some(n) = name {
            let key = format!(
                "{}-{}-{}",
                n.to_lowercase(),
                realm.to_lowercase(),
                region.to_lowercase()
            );
            if seen.insert(key) {
                chars.push(json!({
                    "name": n,
                    "realm": realm,
                    "region": region,
                }));
            }
        }
    }

    HttpResponse::Ok().json(chars)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Job, JobStatus};
    use crate::storage::MemoryStorage;
    use actix_web::body::to_bytes;

    fn test_store() -> web::Data<Arc<dyn JobStorage>> {
        web::Data::new(Arc::new(MemoryStorage::new()) as Arc<dyn JobStorage>)
    }

    fn make_job(id: &str, status: JobStatus, created_at: &str) -> Job {
        let mut job = Job::new(
            "mage=\"Alice\"\nserver=illidan\nthreads=8\n".to_string(),
            "quick".to_string(),
            1000,
            "Patchwerk".to_string(),
            0.1,
        );
        job.id = id.to_string();
        job.status = status;
        job.created_at = created_at.to_string();
        job
    }

    async fn json_body(resp: HttpResponse) -> Value {
        let body = to_bytes(resp.into_body()).await.expect("body bytes");
        serde_json::from_slice(&body).expect("json body")
    }

    async fn text_body(resp: HttpResponse) -> String {
        let body = to_bytes(resp.into_body()).await.expect("body bytes");
        String::from_utf8(body.to_vec()).expect("utf8 body")
    }

    #[actix_web::test]
    async fn status_handler_shapes_done_and_running_progress() {
        let store = test_store();
        let mut done = make_job("done", JobStatus::Done, "2026-01-02T00:00:00Z");
        done.progress_pct = 17;
        done.result_json = Some(json!({"player_name":"Alice","dps":1234.5}).to_string());
        store.insert(done);

        let done_resp = get_sim_status(web::Path::from("done".to_string()), store.clone()).await;
        assert_eq!(done_resp.status(), 200);
        let done_payload = json_body(done_resp).await;
        assert_eq!(
            done_payload.get("status").and_then(Value::as_str),
            Some("done")
        );
        assert_eq!(
            done_payload.get("progress").and_then(Value::as_i64),
            Some(100)
        );
        assert_eq!(
            done_payload
                .get("result")
                .and_then(|v| v.get("player_name"))
                .and_then(Value::as_str),
            Some("Alice")
        );
        assert_eq!(
            done_payload.get("cpu_cores").and_then(Value::as_u64),
            Some(8)
        );

        let mut running = make_job("running", JobStatus::Running, "2026-01-03T00:00:00Z");
        running.progress_detail = Some("12/30 profilesets".to_string());
        store.insert(running);

        let running_resp =
            get_sim_status(web::Path::from("running".to_string()), store.clone()).await;
        let running_payload = json_body(running_resp).await;
        assert_eq!(
            running_payload
                .get("profilesets_completed")
                .and_then(Value::as_u64),
            Some(12)
        );
        assert_eq!(
            running_payload
                .get("profilesets_total")
                .and_then(Value::as_u64),
            Some(30)
        );

        let missing = get_sim_status(web::Path::from("missing".to_string()), store).await;
        assert_eq!(missing.status(), 404);
    }

    #[actix_web::test]
    async fn status_handler_parses_iteration_and_combo_progress_details() {
        let store = test_store();

        let mut iterations = make_job("iterations", JobStatus::Running, "2026-01-04T00:00:00Z");
        iterations.progress_detail = Some("345/1000 iterations".to_string());
        store.insert(iterations);

        let iterations_resp =
            get_sim_status(web::Path::from("iterations".to_string()), store.clone()).await;
        let iterations_payload = json_body(iterations_resp).await;
        assert_eq!(
            iterations_payload
                .get("iterations_completed")
                .and_then(Value::as_u64),
            Some(345)
        );
        assert_eq!(
            iterations_payload
                .get("profilesets_total")
                .and_then(Value::as_u64),
            Some(0)
        );

        let mut combos = make_job("combos", JobStatus::Running, "2026-01-05T00:00:00Z");
        combos.progress_detail = Some("17 combos".to_string());
        store.insert(combos);

        let combos_resp =
            get_sim_status(web::Path::from("combos".to_string()), store.clone()).await;
        let combos_payload = json_body(combos_resp).await;
        assert_eq!(
            combos_payload
                .get("profilesets_total")
                .and_then(Value::as_u64),
            Some(17)
        );
        assert_eq!(
            combos_payload
                .get("profilesets_completed")
                .and_then(Value::as_u64),
            Some(0)
        );
    }

    #[actix_web::test]
    async fn list_sims_ignores_empty_filters_and_applies_linked_and_pinned_flags() {
        let store = test_store();

        let mut linked = make_job("linked", JobStatus::Done, "2026-01-06T00:00:00Z");
        linked.linked_region = Some("us".to_string());
        linked.linked_realm = Some("illidan".to_string());
        linked.linked_name = Some("Alice".to_string());
        linked.pinned = true;
        store.insert(linked);

        let unlinked = make_job("unlinked", JobStatus::Done, "2026-01-05T00:00:00Z");
        store.insert(unlinked);

        let all_resp = list_sims(
            web::Query(ListSimsQuery {
                player: String::new(),
                realm: String::new(),
                linked_only: false,
                unlinked_only: false,
                pinned_only: false,
            }),
            store.clone(),
        )
        .await;
        let all_payload = json_body(all_resp).await;
        assert_eq!(all_payload.as_array().map(Vec::len), Some(2));

        let linked_resp = list_sims(
            web::Query(ListSimsQuery {
                player: "Alice".to_string(),
                realm: "illidan".to_string(),
                linked_only: true,
                unlinked_only: false,
                pinned_only: false,
            }),
            store.clone(),
        )
        .await;
        let linked_payload = json_body(linked_resp).await;
        let linked_ids: Vec<&str> = linked_payload
            .as_array()
            .expect("linked array")
            .iter()
            .filter_map(|v| v.get("id").and_then(Value::as_str))
            .collect();
        assert_eq!(linked_ids, vec!["linked"]);

        let pinned_resp = list_sims(
            web::Query(ListSimsQuery {
                player: String::new(),
                realm: String::new(),
                linked_only: false,
                unlinked_only: false,
                pinned_only: true,
            }),
            store.clone(),
        )
        .await;
        let pinned_payload = json_body(pinned_resp).await;
        let pinned_ids: Vec<&str> = pinned_payload
            .as_array()
            .expect("pinned array")
            .iter()
            .filter_map(|v| v.get("id").and_then(Value::as_str))
            .collect();
        assert_eq!(pinned_ids, vec!["linked"]);

        let unlinked_resp = list_sims(
            web::Query(ListSimsQuery {
                player: String::new(),
                realm: String::new(),
                linked_only: false,
                unlinked_only: true,
                pinned_only: false,
            }),
            store.clone(),
        )
        .await;
        let unlinked_payload = json_body(unlinked_resp).await;
        let unlinked_ids: Vec<&str> = unlinked_payload
            .as_array()
            .expect("unlinked array")
            .iter()
            .filter_map(|v| v.get("id").and_then(Value::as_str))
            .collect();
        assert_eq!(unlinked_ids, vec!["unlinked"]);

        let linked_without_identity_resp = list_sims(
            web::Query(ListSimsQuery {
                player: String::new(),
                realm: String::new(),
                linked_only: true,
                unlinked_only: false,
                pinned_only: false,
            }),
            store.clone(),
        )
        .await;
        let linked_without_identity_payload = json_body(linked_without_identity_resp).await;
        let linked_without_identity_ids: Vec<&str> = linked_without_identity_payload
            .as_array()
            .expect("linked fallback array")
            .iter()
            .filter_map(|v| v.get("id").and_then(Value::as_str))
            .collect();
        assert_eq!(linked_without_identity_ids, vec!["linked", "unlinked"]);
    }

    #[actix_web::test]
    async fn related_sims_follow_parent_batch_and_missing_jobs_404() {
        let store = test_store();
        let parent = make_job("batch-root", JobStatus::Done, "2026-01-01T00:00:00Z");
        let mut child = make_job("batch-child", JobStatus::Done, "2026-01-02T00:00:00Z");
        child.batch_id = Some("batch-root".to_string());
        let unrelated = make_job("other", JobStatus::Done, "2026-01-03T00:00:00Z");
        store.insert(parent);
        store.insert(child);
        store.insert(unrelated);

        let resp =
            list_related_sims(web::Path::from("batch-child".to_string()), store.clone()).await;
        let payload = json_body(resp).await;
        let ids: Vec<&str> = payload
            .as_array()
            .expect("related array")
            .iter()
            .filter_map(|v| v.get("id").and_then(Value::as_str))
            .collect();
        assert_eq!(ids, vec!["batch-child", "batch-root"]);

        let missing = list_related_sims(web::Path::from("missing".to_string()), store).await;
        assert_eq!(missing.status(), 404);
    }

    #[actix_web::test]
    async fn raw_html_text_csv_and_input_handlers_return_expected_fallbacks() {
        let store = test_store();
        let mut job = make_job("job", JobStatus::Done, "2026-01-01T00:00:00Z");
        job.result_json =
            Some(json!({"player_name":"Alice","dps":1000.0,"dps_error":1.5}).to_string());
        job.html_report = Some("<html>report</html>".to_string());
        job.text_output = Some("plain output".to_string());
        store.insert(job);

        assert_eq!(
            text_body(get_sim_input(web::Path::from("job".to_string()), store.clone()).await).await,
            "mage=\"Alice\"\nserver=illidan\nthreads=8\n"
        );
        assert_eq!(
            json_body(get_sim_raw(web::Path::from("job".to_string()), store.clone()).await)
                .await
                .get("player_name")
                .and_then(Value::as_str),
            Some("Alice")
        );
        assert_eq!(
            text_body(get_sim_html(web::Path::from("job".to_string()), store.clone()).await).await,
            "<html>report</html>"
        );
        assert_eq!(
            text_body(get_sim_text_output(web::Path::from("job".to_string()), store.clone()).await)
                .await,
            "plain output"
        );
        let csv =
            text_body(get_sim_csv(web::Path::from("job".to_string()), store.clone()).await).await;
        assert!(csv.contains("actor,dps,dps_error"));
        assert!(csv.contains("Alice,1000.0,1.5"));

        let mut no_result = make_job("empty", JobStatus::Pending, "2026-01-02T00:00:00Z");
        no_result.result_json = None;
        store.insert(no_result);
        assert_eq!(
            get_sim_raw(web::Path::from("empty".to_string()), store.clone())
                .await
                .status(),
            404
        );
        assert_eq!(
            get_sim_csv(web::Path::from("empty".to_string()), store)
                .await
                .status(),
            404
        );
    }

    #[actix_web::test]
    async fn list_logs_cancel_link_pin_history_and_clear_paths() {
        let store = test_store();
        let mut pending = make_job("pending", JobStatus::Pending, "2026-01-02T00:00:00Z");
        pending.result_json = Some(json!({"player_name":"Alice","dps":1000.0}).to_string());
        store.insert(pending);
        let done = make_job("done", JobStatus::Done, "2026-01-01T00:00:00Z");
        store.insert(done);

        let cancel_done = cancel_sim(web::Path::from("done".to_string()), store.clone()).await;
        assert_eq!(cancel_done.status(), 400);
        let cancel_pending =
            cancel_sim(web::Path::from("pending".to_string()), store.clone()).await;
        assert_eq!(cancel_pending.status(), 200);
        assert_eq!(
            store.get_ref().get("pending").expect("pending job").status,
            JobStatus::Cancelled
        );

        let link = link_sim(
            web::Path::from("pending".to_string()),
            web::Json(LinkSimRequest {
                region: Some("us".to_string()),
                realm: Some("illidan".to_string()),
                name: Some("Alice".to_string()),
            }),
            store.clone(),
        )
        .await;
        assert_eq!(link.status(), 200);

        let pin = pin_sim(
            web::Path::from("pending".to_string()),
            web::Json(PinSimRequest { pinned: true }),
            store.clone(),
        )
        .await;
        assert_eq!(
            json_body(pin).await.get("pinned").and_then(Value::as_bool),
            Some(true)
        );

        let chars = json_body(get_history_characters(store.clone()).await).await;
        assert_eq!(
            chars
                .as_array()
                .and_then(|arr| arr.first())
                .and_then(|v| v.get("name"))
                .and_then(Value::as_str),
            Some("Alice")
        );

        let logs = Arc::new(LogBuffer::new());
        logs.push_line("pending", "line one".to_string());
        let log_resp = get_sim_logs(
            web::Path::from("pending".to_string()),
            web::Query(LogsQuery { after: 0 }),
            web::Data::new(logs),
        )
        .await;
        assert_eq!(
            json_body(log_resp)
                .await
                .get("lines")
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(1)
        );

        let stats = json_body(get_history_stats(store.clone()).await).await;
        assert_eq!(stats.get("count").and_then(Value::as_u64), Some(2));

        assert_eq!(clear_history(store.clone()).await.status(), 200);
        assert_eq!(
            json_body(get_history_stats(store).await)
                .await
                .get("count")
                .and_then(Value::as_u64),
            Some(0)
        );
    }
}
