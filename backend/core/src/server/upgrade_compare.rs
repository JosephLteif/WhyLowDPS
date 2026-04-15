use actix_web::{web, HttpResponse};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use super::helpers::*;
use super::types::*;
use crate::addon_parser;
use crate::game_data;
use crate::gear_resolver;
use crate::log_buffer::LogBuffer;
use crate::models::Job;
use crate::profileset_generator;
use crate::storage::JobStorage;

fn resolve_simc_binary_for_request(
    simc_path: &Path,
    _options: &SimOptions,
) -> Result<PathBuf, String> {
    #[cfg(feature = "desktop")]
    {
        if let Some(path) = super::simc_updater::resolve_installed_binary_for_channel(
            simc_path,
            None,
        ) {
            return Ok(path);
        }
        Err(
            "SimC nightly is not installed. Open Settings -> SimulationCraft Engine and install/update it first.".to_string()
        )
    }

    #[cfg(not(feature = "desktop"))]
    {
        if simc_path.exists() {
            Ok(simc_path.to_path_buf())
        } else {
            Err(format!("simc binary not found at: {}", simc_path.display()))
        }
    }
}
use crate::types::ResolvedItem;

/// Shared prep: parse SimC input, extract upgrade budget, build upgrade options per slot.
struct PreparedUpgradeCompare {
    base_profile: String,
    upgraded_options_by_slot: HashMap<String, Vec<ResolvedItem>>,
    upgrade_budget: HashMap<u64, u64>,
}

fn prepare_upgrade_compare(
    simc_input: &str,
    selected_slots: &[String],
    upgrade_depth: &str,
    budget_mode: &str,
    upgrade_budget_override: &HashMap<u64, u64>,
) -> Result<PreparedUpgradeCompare, HttpResponse> {
    let mut upgrade_budget = addon_parser::parse_upgrade_currencies(simc_input);
    for (cid, amount) in upgrade_budget_override {
        upgrade_budget.insert(*cid, *amount);
    }
    if upgrade_budget.is_empty() {
        return Err(HttpResponse::BadRequest().json(json!({
            "detail": "No upgrade_currencies found in SimC addon export."
        })));
    }

    let upgrade_currency_ids: std::collections::HashSet<u64> =
        upgrade_budget.keys().copied().collect();

    let parse_result = addon_parser::parse_simc_input(simc_input);
    let resolved = gear_resolver::resolve_gear(&parse_result);
    let base_profile = resolved.base_profile.clone();
    let items_by_slot = resolve_to_items_by_slot(&resolved);

    let bonus_re = regex::Regex::new(r"bonus_id=([0-9/:]+)").unwrap();
    let mut upgraded_options_by_slot: HashMap<String, Vec<ResolvedItem>> = HashMap::new();

    for slot in selected_slots {
        let slot_items = match items_by_slot.get(slot) {
            Some(items) => items,
            None => continue,
        };

        let equipped = match slot_items
            .iter()
            .find(|it| it.origin == crate::types::ItemOrigin::Equipped)
        {
            Some(e) => e,
            None => continue,
        };

        let options = game_data::get_upgrade_options(&equipped.bonus_ids);
        if options.is_empty() {
            continue;
        }

        // Find current level
        let current_level = options
            .iter()
            .filter(|opt| equipped.bonus_ids.contains(&opt.bonus_id))
            .map(|opt| opt.level)
            .next()
            .unwrap_or(0);

        let mut slot_upgrades: Vec<ResolvedItem> = Vec::new();
        let mut candidate_opts: Vec<&game_data::UpgradeOption> = options
            .iter()
            .filter(|opt| opt.level > current_level)
            .collect();

        if candidate_opts.is_empty() {
            continue;
        }

        if upgrade_depth == "highest_only" || upgrade_depth != "all_levels" {
            candidate_opts = vec![candidate_opts.last().copied().unwrap()];
        }

        if budget_mode != "ignore_budget" {
            candidate_opts.retain(|opt| {
                !opt.cumulative_costs.is_empty()
                    && opt
                        .cumulative_costs
                        .iter()
                        .any(|(cid, amt)| upgrade_currency_ids.contains(cid) && *amt > 0)
                    && opt.cumulative_costs.iter().all(|(cid, amt)| {
                        upgrade_budget.get(cid).copied().unwrap_or(0) >= *amt
                    })
            });
        }

        for opt in candidate_opts {
            let mut new_bonus_ids = equipped.bonus_ids.clone();
            for bid in &mut new_bonus_ids {
                if bonuses_in_same_group(*bid, opt.bonus_id) {
                    *bid = opt.bonus_id;
                }
            }

            let mut upgraded = equipped.clone();
            upgraded.origin = crate::types::ItemOrigin::Bags; // Marks as not baseline
            upgraded.bonus_ids = new_bonus_ids.clone();
            upgraded.ilevel = opt.ilevel as i64;

            let new_simc = bonus_re
                .replace(&equipped.simc_string, |caps: &regex::Captures| {
                    let raw = &caps[1];
                    let sep = if raw.contains('/') { "/" } else { ":" };
                    format!(
                        "bonus_id={}",
                        new_bonus_ids
                            .iter()
                            .map(|id| id.to_string())
                            .collect::<Vec<_>>()
                            .join(sep)
                    )
                })
                .to_string();

            upgraded.simc_string = new_simc;
            slot_upgrades.push(upgraded);
        }

        if !slot_upgrades.is_empty() {
            upgraded_options_by_slot.insert(slot.clone(), slot_upgrades);
        }
    }

    Ok(PreparedUpgradeCompare {
        base_profile,
        upgraded_options_by_slot,
        upgrade_budget,
    })
}

/// Check if two bonus IDs belong to the same upgrade group.
fn bonuses_in_same_group(a: u64, b: u64) -> bool {
    let bonuses = crate::item_db::bonuses();
    let group_a = bonuses
        .get(&a)
        .and_then(|v| v.upgrade.as_ref())
        .and_then(|u| u.group);
    let group_b = bonuses
        .get(&b)
        .and_then(|v| v.upgrade.as_ref())
        .and_then(|u| u.group);
    group_a.is_some() && group_a == group_b
}

/// Returns everything the frontend needs to render the upgrade-compare UI in one call:
/// equipped items, upgrade options per slot, currency budget with metadata.
pub(super) async fn get_upgrade_compare_prepare(req: web::Json<serde_json::Value>) -> HttpResponse {
    let simc_input = req.get("simc_input").and_then(|v| v.as_str()).unwrap_or("");
    if simc_input.len() < 10 {
        return HttpResponse::BadRequest().json(json!({ "detail": "SimC input too short." }));
    }

    let upgrade_budget = addon_parser::parse_upgrade_currencies(simc_input);
    let upgrade_currency_ids: std::collections::HashSet<u64> =
        upgrade_budget.keys().copied().collect();

    let parse_result = addon_parser::parse_simc_input(simc_input);
    let resolved = gear_resolver::resolve_gear(&parse_result);
    let items_by_slot = resolve_to_items_by_slot(&resolved);

    let mut candidates: Vec<Value> = Vec::new();

    for slot in crate::types::class_data::GEAR_SLOTS {
        let slot_items = match items_by_slot.get(*slot) {
            Some(items) => items,
            None => continue,
        };
        let equipped = match slot_items
            .iter()
            .find(|it| it.origin == crate::types::ItemOrigin::Equipped)
        {
            Some(e) => e,
            None => continue,
        };

        if equipped.bonus_ids.is_empty() {
            continue;
        }

        let options = game_data::get_upgrade_options(&equipped.bonus_ids);
        if options.is_empty() {
            continue;
        }

        // Find current level and its cumulative cost
        let mut current_level: u64 = 0;
        let mut current_cumulative: HashMap<u64, u64> = HashMap::new();
        for opt in &options {
            if equipped.bonus_ids.contains(&opt.bonus_id) {
                current_level = opt.level;
                current_cumulative = opt.cumulative_costs.clone();
                break;
            }
        }

        // Filter to upgrades that cost our currencies
        let upgrades: Vec<&game_data::UpgradeOption> = options
            .iter()
            .filter(|o| {
                if o.level <= current_level {
                    return false;
                }
                o.cumulative_costs
                    .keys()
                    .any(|k| upgrade_currency_ids.contains(k))
            })
            .collect();

        if upgrades.is_empty() {
            continue;
        }

        let max_upgrade = upgrades.last().unwrap();
        let target_ilevel = max_upgrade.ilevel;

        // Delta cost = target cumulative - current cumulative
        let mut delta_costs: HashMap<String, u64> = HashMap::new();
        for (cid, &target_amt) in &max_upgrade.cumulative_costs {
            let current_amt = current_cumulative.get(cid).copied().unwrap_or(0);
            let delta = target_amt.saturating_sub(current_amt);
            if delta > 0 {
                delta_costs.insert(cid.to_string(), delta);
            }
        }
        let costs = json!(delta_costs);

        candidates.push(json!({
            "slot": slot,
            "item_id": equipped.item_id,
            "bonus_ids": equipped.bonus_ids,
            "ilevel": equipped.ilevel,
            "target_ilevel": target_ilevel,
            "costs": costs,
        }));
    }

    // Build currency info
    let mut currency_info: HashMap<String, Value> = HashMap::new();
    for (cid, amount) in &upgrade_budget {
        let meta = game_data::get_currency_info(*cid);
        currency_info.insert(
            cid.to_string(),
            json!({
                "id": cid,
                "amount": amount,
                "name": meta.as_ref().map(|(n, _)| n.as_str()).unwrap_or(""),
                "icon": meta.as_ref().map(|(_, i)| i.as_str()).unwrap_or(""),
            }),
        );
    }

    HttpResponse::Ok().json(json!({
        "candidates": candidates,
        "currencies": currency_info,
    }))
}

pub(super) async fn get_upgrade_compare_combo_count(
    req: web::Json<UpgradeCompareRequest>,
) -> HttpResponse {
    let simc_input = crate::talent_normalize::normalize_simc_talents(&apply_talent_override(
        &req.simc_input,
        &req.options.talents,
    ));

    let prepared = match prepare_upgrade_compare(
        &simc_input,
        &req.selected_slots,
        &req.upgrade_depth,
        &req.budget_mode,
        &req.upgrade_budget_override,
    ) {
        Ok(v) => v,
        Err(resp) => return resp,
    };

    match profileset_generator::generate_upgrade_compare_input(
        &prepared.base_profile,
        &prepared.upgraded_options_by_slot,
        &prepared.upgrade_budget,
        req.max_combinations,
        &req.upgrade_depth,
        &req.budget_mode,
    ) {
        Ok((_, count, _)) => HttpResponse::Ok().json(json!({ "combo_count": count })),
        Err(e) => {
            let e_str = e.to_string();
            let count: usize = e_str
                .split('(')
                .nth(1)
                .and_then(|s| s.split(')').next())
                .and_then(|s| s.parse().ok())
                .unwrap_or(0);
            HttpResponse::Ok().json(json!({ "combo_count": count, "error": e_str }))
        }
    }
}

pub(super) async fn create_upgrade_compare_sim(
    req: web::Json<UpgradeCompareRequest>,
    store: web::Data<Arc<dyn JobStorage>>,
    simc_path: web::Data<PathBuf>,
    log_buffer: web::Data<Arc<LogBuffer>>,
) -> HttpResponse {
    let simc_input = crate::talent_normalize::normalize_simc_talents(&apply_talent_override(
        &req.simc_input,
        &req.options.talents,
    ));

    let prepared = match prepare_upgrade_compare(
        &simc_input,
        &req.selected_slots,
        &req.upgrade_depth,
        &req.budget_mode,
        &req.upgrade_budget_override,
    ) {
        Ok(v) => v,
        Err(resp) => return resp,
    };

    let (generated_input, combo_count, combo_metadata) =
        match profileset_generator::generate_upgrade_compare_input(
            &prepared.base_profile,
            &prepared.upgraded_options_by_slot,
            &prepared.upgrade_budget,
            req.max_combinations,
            &req.upgrade_depth,
            &req.budget_mode,
        ) {
            Ok(result) => result,
            Err(e) => {
                return HttpResponse::BadRequest().json(json!({ "detail": e.to_string() }));
            }
        };

    if combo_count == 0 {
        return HttpResponse::BadRequest().json(json!({
            "detail": "No valid upgrade combinations within budget."
        }));
    }

    let generated_input = inject_expert_fields(&generated_input, &req.options);

    if let Some(resp) = validate_batch(&req.options.batch_id, store.get_ref().as_ref()) {
        return resp;
    }

    let job = Job::new(
        generated_input.clone(),
        "top_gear".to_string(), // Reuse top_gear result format
        req.options.iterations,
        req.options.fight_style.clone(),
        req.options.target_error,
    );
    let job_id = job.id.clone();
    let created_at = job.created_at.clone();

    let meta_json = serde_json::to_string(&json!({
        "_combo_metadata": combo_metadata,
        "_combo_count": combo_count,
    }))
    .unwrap_or_default();

    let mut job = job;
    job.combo_metadata_json = Some(meta_json);
    job.batch_id = req.options.batch_id.clone();
    store.insert(job);

    let simc_binary = match resolve_simc_binary_for_request(simc_path.get_ref(), &req.options) {
        Ok(path) => path,
        Err(detail) => return HttpResponse::BadRequest().json(json!({ "detail": detail })),
    };

    spawn_staged_sim(
        store.get_ref().clone(),
        simc_binary,
        req.options.to_json(),
        job_id.clone(),
        generated_input,
        combo_count,
        log_buffer.get_ref().clone(),
    );

    HttpResponse::Ok().json(SimResponse {
        id: job_id,
        status: "pending".to_string(),
        created_at,
    })
}

pub(super) async fn get_upgrade_options_handler(
    query: web::Query<HashMap<String, String>>,
) -> HttpResponse {
    let bonus_ids: Vec<u64> = query
        .get("bonus_ids")
        .unwrap_or(&String::new())
        .split(',')
        .filter_map(|s| s.trim().parse().ok())
        .collect();

    let options = game_data::get_upgrade_options(&bonus_ids);
    HttpResponse::Ok().json(json!({ "options": options }))
}
