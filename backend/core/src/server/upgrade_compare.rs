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
        if simc_path.exists() {
            return Ok(simc_path.to_path_buf());
        }
        Err(
            "Bundled SimulationCraft is missing from this app build. Reinstall the app or switch to another release channel build."
                .to_string(),
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
                    && opt
                        .cumulative_costs
                        .iter()
                        .all(|(cid, amt)| upgrade_budget.get(cid).copied().unwrap_or(0) >= *amt)
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
            upgraded.upgrade_costs = opt.cumulative_costs.clone();

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

    let mut job = Job::new(
        generated_input.clone(),
        "top_gear".to_string(), // Reuse top_gear result format
        req.options.iterations,
        req.options.fight_style.clone(),
        req.options.target_error,
    );
    job.options = Some(req.options.to_json_with_sim_type("top_gear"));
    let job_id = job.id.clone();
    let created_at = job.created_at.clone();

    let meta_json = serde_json::to_string(&json!({
        "_combo_metadata": combo_metadata,
        "_combo_count": combo_count,
        "currencies": prepared.upgrade_budget.keys().map(|&cid| {
            let (name, icon) = crate::game_data::get_currency_info(cid).unwrap_or((format!("Currency {}", cid), "inv_misc_questionmark".to_string()));
            (cid.to_string(), json!({ "id": cid, "name": name, "icon": icon }))
        }).collect::<HashMap<String, Value>>(),
    }))
    .unwrap_or_default();

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::item_db::state;
    use crate::storage::{JobStorage, MemoryStorage};
    use crate::types::{BonusData, BonusUpgrade};
    use actix_web::body::to_bytes;
    use std::sync::Arc;

    fn parse_upgrade_compare_req(value: Value) -> UpgradeCompareRequest {
        serde_json::from_value(value).expect("valid UpgradeCompareRequest")
    }

    fn test_store() -> web::Data<Arc<dyn JobStorage>> {
        web::Data::new(Arc::new(MemoryStorage::new()) as Arc<dyn JobStorage>)
    }

    fn test_log_buffer() -> web::Data<Arc<LogBuffer>> {
        web::Data::new(Arc::new(LogBuffer::new()))
    }

    fn test_simc_path() -> web::Data<PathBuf> {
        web::Data::new(PathBuf::from("C:/nonexistent/simc.exe"))
    }

    #[test]
    fn resolve_simc_binary_uses_existing_path_and_rejects_missing_binary() {
        let temp = tempfile::tempdir().expect("temp dir");
        let existing = temp.path().join("simc.exe");
        std::fs::write(&existing, "binary").expect("write simc");

        let options: SimOptions = serde_json::from_value(json!({})).expect("sim options");
        assert_eq!(
            resolve_simc_binary_for_request(&existing, &options).expect("existing simc"),
            existing
        );

        let missing = temp.path().join("missing-simc.exe");
        let err = resolve_simc_binary_for_request(&missing, &options).expect_err("missing simc");
        #[cfg(feature = "desktop")]
        assert!(err.contains("Bundled SimulationCraft is missing"));
        #[cfg(not(feature = "desktop"))]
        assert!(err.contains("simc binary not found at:"));
    }

    #[test]
    fn bonuses_in_same_group_only_matches_shared_upgrade_groups() {
        let _guard = state::TEST_STATE_LOCK.lock().unwrap();
        let prev_bonuses = state::BONUSES.read().unwrap().clone();
        *state::BONUSES.write().unwrap() = Arc::new(HashMap::from([
            (
                100u64,
                BonusData {
                    upgrade: Some(BonusUpgrade {
                        group: Some(77),
                        ..Default::default()
                    }),
                    ..Default::default()
                },
            ),
            (
                200u64,
                BonusData {
                    upgrade: Some(BonusUpgrade {
                        group: Some(77),
                        ..Default::default()
                    }),
                    ..Default::default()
                },
            ),
            (
                300u64,
                BonusData {
                    upgrade: Some(BonusUpgrade {
                        group: Some(88),
                        ..Default::default()
                    }),
                    ..Default::default()
                },
            ),
        ]));

        assert!(bonuses_in_same_group(100, 200));
        assert!(!bonuses_in_same_group(100, 300));
        assert!(!bonuses_in_same_group(100, 999));

        *state::BONUSES.write().unwrap() = prev_bonuses;
    }

    #[actix_web::test]
    async fn prepare_requires_minimum_simc_input_length() {
        let resp = get_upgrade_compare_prepare(web::Json(json!({"simc_input": "short"}))).await;
        assert_eq!(resp.status(), 400);
        let body = to_bytes(resp.into_body()).await.expect("response body");
        let payload: Value = serde_json::from_slice(&body).expect("json body");
        assert_eq!(
            payload.get("detail").and_then(Value::as_str),
            Some("SimC input too short.")
        );
    }

    #[actix_web::test]
    async fn combo_count_requires_upgrade_currency_block_in_simc_input() {
        let req = parse_upgrade_compare_req(json!({
            "simc_input": "warrior=\"Tester\"\nspec=fury\n",
            "selected_slots": ["head"],
            "upgrade_depth": "highest_only",
            "budget_mode": "max_affordability",
            "upgrade_budget_override": {}
        }));
        let resp = get_upgrade_compare_combo_count(web::Json(req)).await;
        assert_eq!(resp.status(), 400);
        let body = to_bytes(resp.into_body()).await.expect("response body");
        let payload: Value = serde_json::from_slice(&body).expect("json body");
        assert_eq!(
            payload.get("detail").and_then(Value::as_str),
            Some("No upgrade_currencies found in SimC addon export.")
        );
    }

    #[actix_web::test]
    async fn combo_count_reports_upgrade_limit_error_count() {
        let _guard = state::TEST_STATE_LOCK.lock().unwrap();
        let prev_bonuses = state::BONUSES.read().unwrap().clone();
        let prev_tracks = state::UPGRADE_TRACKS.read().unwrap().clone();
        let prev_step_costs = state::UPGRADE_STEP_COSTS.read().unwrap().clone();

        *state::BONUSES.write().unwrap() = Arc::new(HashMap::from([
            (
                101_u64,
                BonusData {
                    upgrade: Some(BonusUpgrade {
                        full_name: Some("Hero 1/4".to_string()),
                        group: Some(77),
                        level: Some(1),
                        ..Default::default()
                    }),
                    ..Default::default()
                },
            ),
            (
                102_u64,
                BonusData {
                    upgrade: Some(BonusUpgrade {
                        full_name: Some("Hero 2/4".to_string()),
                        group: Some(77),
                        level: Some(2),
                        ..Default::default()
                    }),
                    ..Default::default()
                },
            ),
        ]));
        *state::UPGRADE_TRACKS.write().unwrap() = Arc::new(HashMap::from([
            (
                ("Hero".to_string(), 1_u64, 4_u64),
                (623_u64, 101_u64, 4_u64),
            ),
            (
                ("Hero".to_string(), 2_u64, 4_u64),
                (626_u64, 102_u64, 4_u64),
            ),
        ]));
        *state::UPGRADE_STEP_COSTS.write().unwrap() = Arc::new(HashMap::from([(
            102_u64,
            HashMap::from([(3008_u64, 15_u64)]),
        )]));

        let req = parse_upgrade_compare_req(json!({
            "simc_input": "warrior=\"Tester\"\nspec=fury\nhead=equipped,id=1000,bonus_id=101\n# upgrade_currencies = c:3008:25\n",
            "selected_slots": ["head"],
            "upgrade_depth": "highest_only",
            "budget_mode": "max_affordability",
            "upgrade_budget_override": {},
            "max_combinations": 0
        }));
        let resp = get_upgrade_compare_combo_count(web::Json(req)).await;
        assert_eq!(resp.status(), 200);

        let body = to_bytes(resp.into_body()).await.expect("response body");
        let payload: Value = serde_json::from_slice(&body).expect("json body");
        assert_eq!(payload.get("combo_count").and_then(Value::as_u64), Some(1));
        assert!(payload
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .contains("Too many upgrade combinations (1)"));

        *state::BONUSES.write().unwrap() = prev_bonuses;
        *state::UPGRADE_TRACKS.write().unwrap() = prev_tracks;
        *state::UPGRADE_STEP_COSTS.write().unwrap() = prev_step_costs;
    }

    #[actix_web::test]
    async fn prepare_returns_upgrade_candidates_and_currency_metadata() {
        let _guard = state::TEST_STATE_LOCK.lock().unwrap();
        let prev_bonuses = state::BONUSES.read().unwrap().clone();
        let prev_tracks = state::UPGRADE_TRACKS.read().unwrap().clone();
        let prev_step_costs = state::UPGRADE_STEP_COSTS.read().unwrap().clone();
        let prev_currency_info = state::CURRENCY_INFO.read().unwrap().clone();

        *state::BONUSES.write().unwrap() = Arc::new(HashMap::from([
            (
                101_u64,
                BonusData {
                    upgrade: Some(BonusUpgrade {
                        full_name: Some("Hero 1/4".to_string()),
                        group: Some(77),
                        level: Some(1),
                        ..Default::default()
                    }),
                    ..Default::default()
                },
            ),
            (
                102_u64,
                BonusData {
                    upgrade: Some(BonusUpgrade {
                        full_name: Some("Hero 2/4".to_string()),
                        group: Some(77),
                        level: Some(2),
                        ..Default::default()
                    }),
                    ..Default::default()
                },
            ),
        ]));
        *state::UPGRADE_TRACKS.write().unwrap() = Arc::new(HashMap::from([
            (
                ("Hero".to_string(), 1_u64, 4_u64),
                (623_u64, 101_u64, 4_u64),
            ),
            (
                ("Hero".to_string(), 2_u64, 4_u64),
                (626_u64, 102_u64, 4_u64),
            ),
        ]));
        *state::UPGRADE_STEP_COSTS.write().unwrap() = Arc::new(HashMap::from([(
            102_u64,
            HashMap::from([(3008_u64, 15_u64)]),
        )]));
        *state::CURRENCY_INFO.write().unwrap() = Arc::new(HashMap::from([(
            3008_u64,
            ("Crests".to_string(), "inv_currency_crests".to_string()),
        )]));

        let resp = get_upgrade_compare_prepare(web::Json(json!({
            "simc_input": "warrior=\"Tester\"\nspec=fury\nhead=equipped,id=1000,bonus_id=101\n# upgrade_currencies = c:3008:25\n"
        })))
        .await;
        assert_eq!(resp.status(), 200);

        let body = to_bytes(resp.into_body()).await.expect("response body");
        let payload: Value = serde_json::from_slice(&body).expect("json body");

        let candidates = payload
            .get("candidates")
            .and_then(Value::as_array)
            .expect("candidates array");
        assert_eq!(candidates.len(), 1);
        assert_eq!(
            candidates[0].get("slot").and_then(Value::as_str),
            Some("head")
        );
        assert_eq!(
            candidates[0].get("target_ilevel").and_then(Value::as_u64),
            Some(626)
        );
        assert_eq!(
            candidates[0]
                .get("costs")
                .and_then(|costs| costs.get("3008"))
                .and_then(Value::as_u64),
            Some(15)
        );

        let currencies = payload
            .get("currencies")
            .and_then(Value::as_object)
            .expect("currencies object");
        assert_eq!(
            currencies
                .get("3008")
                .and_then(|value| value.get("name"))
                .and_then(Value::as_str),
            Some("Crests")
        );
        assert_eq!(
            currencies
                .get("3008")
                .and_then(|value| value.get("icon"))
                .and_then(Value::as_str),
            Some("inv_currency_crests")
        );

        *state::BONUSES.write().unwrap() = prev_bonuses;
        *state::UPGRADE_TRACKS.write().unwrap() = prev_tracks;
        *state::UPGRADE_STEP_COSTS.write().unwrap() = prev_step_costs;
        *state::CURRENCY_INFO.write().unwrap() = prev_currency_info;
    }

    #[actix_web::test]
    async fn create_upgrade_compare_reaches_binary_check_for_valid_request() {
        let _guard = state::TEST_STATE_LOCK.lock().unwrap();
        let prev_bonuses = state::BONUSES.read().unwrap().clone();
        let prev_tracks = state::UPGRADE_TRACKS.read().unwrap().clone();
        let prev_step_costs = state::UPGRADE_STEP_COSTS.read().unwrap().clone();

        *state::BONUSES.write().unwrap() = Arc::new(HashMap::from([
            (
                101_u64,
                BonusData {
                    upgrade: Some(BonusUpgrade {
                        full_name: Some("Hero 1/4".to_string()),
                        group: Some(77),
                        level: Some(1),
                        ..Default::default()
                    }),
                    ..Default::default()
                },
            ),
            (
                102_u64,
                BonusData {
                    upgrade: Some(BonusUpgrade {
                        full_name: Some("Hero 2/4".to_string()),
                        group: Some(77),
                        level: Some(2),
                        ..Default::default()
                    }),
                    ..Default::default()
                },
            ),
        ]));
        *state::UPGRADE_TRACKS.write().unwrap() = Arc::new(HashMap::from([
            (
                ("Hero".to_string(), 1_u64, 4_u64),
                (623_u64, 101_u64, 4_u64),
            ),
            (
                ("Hero".to_string(), 2_u64, 4_u64),
                (626_u64, 102_u64, 4_u64),
            ),
        ]));
        *state::UPGRADE_STEP_COSTS.write().unwrap() = Arc::new(HashMap::from([(
            102_u64,
            HashMap::from([(3008_u64, 15_u64)]),
        )]));

        let req = parse_upgrade_compare_req(json!({
            "simc_input": "warrior=\"Tester\"\nspec=fury\nhead=equipped,id=1000,bonus_id=101\n# upgrade_currencies = c:3008:25\n",
            "selected_slots": ["head"],
            "upgrade_depth": "highest_only",
            "budget_mode": "max_affordability",
            "upgrade_budget_override": {}
        }));
        let resp = create_upgrade_compare_sim(
            web::Json(req),
            test_store(),
            test_simc_path(),
            test_log_buffer(),
        )
        .await;
        assert_eq!(resp.status(), 400);

        let body = to_bytes(resp.into_body()).await.expect("response body");
        let payload: Value = serde_json::from_slice(&body).expect("json body");
        let detail = payload
            .get("detail")
            .and_then(Value::as_str)
            .unwrap_or_default();
        assert!(detail.contains("simc binary not found") || detail.contains("missing"));

        *state::BONUSES.write().unwrap() = prev_bonuses;
        *state::UPGRADE_TRACKS.write().unwrap() = prev_tracks;
        *state::UPGRADE_STEP_COSTS.write().unwrap() = prev_step_costs;
    }

    #[actix_web::test]
    async fn upgrade_options_handler_always_returns_options_array_shape() {
        let resp = get_upgrade_options_handler(web::Query(HashMap::from([(
            "bonus_ids".to_string(),
            "1,2,3".to_string(),
        )])))
        .await;
        assert_eq!(resp.status(), 200);
        let body = to_bytes(resp.into_body()).await.expect("response body");
        let payload: Value = serde_json::from_slice(&body).expect("json body");
        assert!(payload.get("options").is_some());
        assert!(payload.get("options").unwrap().is_array());
    }
}
