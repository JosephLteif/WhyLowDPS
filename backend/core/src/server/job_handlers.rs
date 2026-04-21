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
        store.get_max_jobs(),
        player,
        realm,
        query.linked_only,
        query.unlinked_only,
        query.pinned_only,
    );
    HttpResponse::Ok().json(summaries)
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
