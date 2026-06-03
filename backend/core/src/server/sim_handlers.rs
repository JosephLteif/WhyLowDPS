use actix_web::{web, HttpResponse};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use super::helpers::*;
use super::types::*;
use crate::addon_parser;
use crate::game_data;
use crate::gear_resolver;
use crate::log_buffer::LogBuffer;
use crate::models::{Job, JobStatus};
use crate::profileset_generator;
use crate::result_parser;
use crate::simc_runner;
use crate::storage::JobStorage;

mod droptimizer;
mod heatmap;
mod items;
mod matrix;
mod matrix_handlers;
mod top_gear;

pub(super) use droptimizer::create_droptimizer_sim;
use heatmap::*;
use items::*;
use matrix::*;
use matrix_handlers::*;
pub(super) use top_gear::{create_top_gear_sim, get_top_gear_combo_count};

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

pub(super) async fn create_sim(
    req: web::Json<SimRequest>,
    store: web::Data<Arc<dyn JobStorage>>,
    simc_path: web::Data<PathBuf>,
    log_buffer: web::Data<Arc<LogBuffer>>,
) -> HttpResponse {
    let mut simc_input = if req.max_upgrade {
        game_data::upgrade_simc_input(&req.simc_input)
    } else {
        req.simc_input.clone()
    };

    let class_name = crate::types::class_data::detect_class(&simc_input);
    if class_name.is_none() {
        return HttpResponse::BadRequest().json(json!({
            "detail": "Could not detect character class from SimC input. Ensure the input starts with a character name line (e.g. warrior=\"Name\")."
        }));
    }

    simc_input = apply_talent_override(&simc_input, &req.options.talents);
    simc_input = apply_spec_override(&simc_input, &req.options.spec_override);
    simc_input = crate::talent_normalize::normalize_simc_talents(&simc_input);

    if req.sim_type == "trinket_tier_heatmap" {
        return create_trinket_tier_heatmap_sim(
            simc_input,
            class_name.unwrap_or_default(),
            (
                req.options.include_trinket_matrix,
                req.options.include_tier_matrix,
            ),
            &req.options,
            store,
            simc_path,
            log_buffer,
        )
        .await;
    }

    if req.sim_type == "external_buff_matrix" {
        return create_external_buff_matrix_sim(
            simc_input,
            &req.options,
            store,
            simc_path,
            log_buffer,
        )
        .await;
    }

    if req.sim_type == "consumable_matrix" {
        return create_consumable_matrix_sim(
            simc_input,
            &req.options,
            store,
            simc_path,
            log_buffer,
        )
        .await;
    }

    simc_input = inject_expert_fields(&simc_input, &req.options);
    simc_input = apply_shared_simc_options(&simc_input, &req.options, true);

    let resolved_threads = if req.options.threads == 0 {
        std::thread::available_parallelism()
            .map(|n| n.get() as u32)
            .unwrap_or(4)
    } else {
        req.options.threads
    };
    simc_input.push_str(&format!("\nthreads={}\n", resolved_threads));

    if let Some(resp) = validate_batch(&req.options.batch_id, store.get_ref().as_ref()) {
        return resp;
    }

    let simc = match resolve_simc_binary_for_request(simc_path.get_ref(), &req.options) {
        Ok(path) => path,
        Err(detail) => return HttpResponse::BadRequest().json(json!({ "detail": detail })),
    };

    let options = req.options.to_json_with_sim_type(&req.sim_type);
    let mut job = Job::new(
        simc_input.clone(),
        req.sim_type.clone(),
        req.options.iterations,
        req.options.fight_style.clone(),
        req.options.target_error,
    );
    job.options = Some(options.clone());
    job.batch_id = req.options.batch_id.clone();
    let job_id = job.id.clone();
    let created_at = job.created_at.clone();
    store.insert(job);

    // Spawn background task
    let store_clone = store.get_ref().clone();
    let job_id_clone = job_id.clone();
    let logs = log_buffer.get_ref().clone();
    let jid_logs = job_id.clone();

    tokio::spawn(async move {
        store_clone.update_status(&job_id_clone, JobStatus::Running);
        store_clone.update_progress(&job_id_clone, 20, "Simulating", "");
        let logs_cb = logs.clone();
        let jid_cb = jid_logs.clone();
        let store_prog = store_clone.clone();
        let jid_prog = job_id_clone.clone();

        match simc_runner::run_simc(
            &simc,
            &job_id_clone,
            &simc_input,
            &options,
            move |current, total| {
                let pct = 20 + ((current as f64 / total as f64) * 80.0) as u8;
                store_prog.update_progress(
                    &jid_prog,
                    pct,
                    "Simulating",
                    &format!("{}/{} iterations", current, total),
                );
            },
            move |line| {
                logs_cb.push_line(&jid_cb, line.to_string());
            },
        )
        .await
        {
            Ok(output) => {
                let mut parsed = result_parser::parse_simc_result(&output.json, true);
                if let Some(job_snap) = store_clone.get(&job_id_clone) {
                    if let Some(baseline_live_stats) = job_snap
                        .options
                        .as_ref()
                        .and_then(|options| options.get("baseline_live_stats"))
                        .filter(|stats| !stats.is_null())
                    {
                        if let Some(obj) = parsed.as_object_mut() {
                            obj.insert(
                                "baseline_live_stats".to_string(),
                                baseline_live_stats.clone(),
                            );
                        }
                    }
                }
                inject_realm(&mut parsed, &simc_input);
                let result_str = serde_json::to_string(&parsed).unwrap_or_default();
                let raw_str = serde_json::to_string(&output.json).ok();
                store_clone.set_result(&job_id_clone, result_str, raw_str);
                store_clone.set_report_files(&job_id_clone, output.html_report, output.text_output);
            }
            Err(e) => {
                let is_cancelled = store_clone
                    .get(&job_id_clone)
                    .map(|j| j.status == JobStatus::Cancelled)
                    .unwrap_or(false);
                if !is_cancelled {
                    store_clone.set_error(&job_id_clone, e.to_string());
                }
            }
        }
        logs.remove(&jid_logs);
    });

    HttpResponse::Ok().json(SimResponse {
        id: job_id,
        status: "pending".to_string(),
        created_at,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::{JobStorage, MemoryStorage};
    use actix_web::body::to_bytes;

    fn test_store() -> web::Data<Arc<dyn JobStorage>> {
        web::Data::new(Arc::new(MemoryStorage::new()) as Arc<dyn JobStorage>)
    }

    fn test_log_buffer() -> web::Data<Arc<LogBuffer>> {
        web::Data::new(Arc::new(LogBuffer::new()))
    }

    fn test_simc_path() -> web::Data<PathBuf> {
        web::Data::new(PathBuf::from("C:/nonexistent/simc.exe"))
    }

    fn parse_sim_req(value: Value) -> SimRequest {
        serde_json::from_value(value).expect("valid SimRequest")
    }

    fn parse_top_gear_req(value: Value) -> TopGearRequest {
        serde_json::from_value(value).expect("valid TopGearRequest")
    }

    fn parse_droptimizer_req(value: Value) -> DroptimizerRequest {
        serde_json::from_value(value).expect("valid DroptimizerRequest")
    }

    fn default_options() -> SimOptions {
        serde_json::from_value(json!({})).expect("default SimOptions")
    }

    #[test]
    fn simc_binary_resolver_accepts_existing_path_and_rejects_missing_path() {
        let temp = tempfile::tempdir().expect("temp simc dir");
        let simc = temp.path().join("simc-test");
        std::fs::write(&simc, "").expect("write fake simc");
        let options = default_options();

        assert_eq!(
            resolve_simc_binary_for_request(&simc, &options).expect("existing simc"),
            simc
        );

        let missing = temp.path().join("missing-simc");
        let detail = resolve_simc_binary_for_request(&missing, &options).expect_err("missing simc");
        assert!(detail.contains("simc binary not found") || detail.contains("missing"));
    }

    #[test]
    fn sanitize_matrix_token_accepts_simc_tokens_only() {
        assert_eq!(
            sanitize_matrix_token("  main_hand:123/bonus+foo  "),
            Some("main_hand:123/bonus+foo".to_string())
        );
        assert_eq!(sanitize_matrix_token(""), None);
        assert_eq!(sanitize_matrix_token("bad token"), None);
        assert_eq!(sanitize_matrix_token("bad;token"), None);
    }

    #[test]
    fn top_gear_consumables_filter_invalid_and_offhand_temporary_enchants() {
        let mut options = default_options();
        options.consumable_matrix_flasks = vec![" flask_a ".to_string(), "bad token".to_string()];
        options.consumable_matrix_foods = vec!["food-a".to_string()];
        options.consumable_matrix_potions = vec!["".to_string()];
        options.consumable_matrix_augmentations = vec!["aug.1".to_string()];
        options.consumable_matrix_temporary_enchants =
            vec!["main_hand:123".to_string(), "off_hand:456".to_string()];

        let matrix = top_gear_consumables_from_options(&options).expect("matrix");

        assert_eq!(matrix.flasks, vec!["flask_a"]);
        assert_eq!(matrix.foods, vec!["food-a"]);
        assert!(matrix.potions.is_empty());
        assert_eq!(matrix.augmentations, vec!["aug.1"]);
        assert_eq!(matrix.temporary_enchants, vec!["main_hand:123"]);
    }

    #[test]
    fn external_buff_matrix_requires_selection_and_emits_metadata() {
        let simc = "warrior=\"Tester\"\nspec=fury\ntalents=abc\nmain_hand=item,id=1\n";
        let mut options = default_options();
        assert_eq!(
            build_external_buff_matrix_input(simc, &options).unwrap_err(),
            "Select at least one external buff for the matrix."
        );

        options.external_buff_power_infusion = true;
        let (input, combo_count, metadata) =
            build_external_buff_matrix_input(simc, &options).expect("matrix input");

        assert_eq!(combo_count, 1);
        assert!(input.contains("optimal_raid=0"));
        assert!(input.contains("### External Buff 1 | Power Infusion"));
        assert!(input.contains(
            "profileset.\"External Buff 1 | Power Infusion\"+=external_buffs.power_infusion=0/120/240"
        ));
        assert_eq!(
            metadata["External Buff 1 | Power Infusion"][0]["external_buff"],
            json!("Power Infusion")
        );
    }

    #[test]
    fn consumable_matrix_cleans_baseline_dedupes_and_emits_metadata() {
        let simc = "warrior=\"Tester\"\nspec=fury\nflask=old\noptimal_raid=1\ntalents=abc\nmain_hand=item,id=1\n";
        let mut options = default_options();
        assert_eq!(
            build_consumable_matrix_input(simc, &options).unwrap_err(),
            "Select at least one consumable or raid buff to compare."
        );

        options.consumable_matrix_flasks = vec!["flask_a".to_string(), "flask_a".to_string()];
        options.consumable_matrix_raid_buffs = vec!["bloodlust".to_string(), "unknown".to_string()];
        let (input, combo_count, metadata) =
            build_consumable_matrix_input(simc, &options).expect("matrix input");

        assert_eq!(combo_count, 2);
        assert!(input.contains("flask="));
        assert!(input.contains("optimal_raid=0"));
        assert!(!input.contains("flask=old"));
        assert!(input.contains("profileset.\"Consumable 1 | Flask: flask_a\"+=flask=flask_a"));
        assert!(input
            .contains("profileset.\"Consumable 2 | Raid Buff: bloodlust\"+=override.bloodlust=1"));
        assert_eq!(
            metadata["Consumable 1 | Flask: flask_a"][0]["consumable_category"],
            json!("flask")
        );
        assert_eq!(
            metadata["Consumable 2 | Raid Buff: bloodlust"][0]["consumable_token"],
            json!("bloodlust")
        );
    }

    #[actix_web::test]
    async fn external_buff_matrix_handler_rejects_empty_selection() {
        let options = default_options();
        let resp = create_external_buff_matrix_sim(
            "warrior=\"Tester\"\nspec=fury\n".to_string(),
            &options,
            test_store(),
            test_simc_path(),
            test_log_buffer(),
        )
        .await;
        assert_eq!(resp.status(), 400);

        let body = to_bytes(resp.into_body()).await.expect("response body");
        let payload: Value = serde_json::from_slice(&body).expect("json body");
        assert_eq!(
            payload.get("detail").and_then(Value::as_str),
            Some("Select at least one external buff for the matrix.")
        );
    }

    #[actix_web::test]
    async fn consumable_matrix_handler_rejects_empty_selection() {
        let options = default_options();
        let resp = create_consumable_matrix_sim(
            "warrior=\"Tester\"\nspec=fury\n".to_string(),
            &options,
            test_store(),
            test_simc_path(),
            test_log_buffer(),
        )
        .await;
        assert_eq!(resp.status(), 400);

        let body = to_bytes(resp.into_body()).await.expect("response body");
        let payload: Value = serde_json::from_slice(&body).expect("json body");
        assert_eq!(
            payload.get("detail").and_then(Value::as_str),
            Some("Select at least one consumable or raid buff to compare.")
        );
    }

    #[test]
    fn heatmap_role_pool_selection_defaults_to_active_spec_role() {
        assert_eq!(spec_id_to_role_pool(66), TrinketRolePool::Tank);
        assert_eq!(spec_id_to_role_pool(257), TrinketRolePool::Healer);
        assert_eq!(spec_id_to_role_pool(72), TrinketRolePool::Dps);

        let auto = selected_heatmap_role_pools("auto", Some(66));
        assert_eq!(auto, HashSet::from([TrinketRolePool::Tank]));

        let explicit = selected_heatmap_role_pools("dps, healer", Some(66));
        assert_eq!(
            explicit,
            HashSet::from([TrinketRolePool::Dps, TrinketRolePool::Healer])
        );

        let fallback = selected_heatmap_role_pools("unknown", Some(66));
        assert_eq!(
            fallback,
            HashSet::from([
                TrinketRolePool::Dps,
                TrinketRolePool::Tank,
                TrinketRolePool::Healer
            ])
        );
    }

    #[test]
    fn heatmap_spec_filters_honor_spec_class_and_role_restrictions() {
        assert!(item_specs_match_active_spec(&[], Some(62), false));
        assert!(item_specs_match_active_spec(&[62], Some(62), false));
        assert!(!item_specs_match_active_spec(&[63], Some(62), false));
        assert!(!item_specs_match_active_spec(&[8], Some(62), false));
        assert!(!item_specs_match_active_spec(&[2], Some(62), false));
        assert!(item_specs_match_active_spec(&[63], Some(62), true));

        let dps_pool = HashSet::from([TrinketRolePool::Dps]);
        let tank_pool = HashSet::from([TrinketRolePool::Tank]);
        assert!(item_specs_match_role_pools(&[62], &dps_pool));
        assert!(!item_specs_match_role_pools(&[62], &tank_pool));
        assert!(item_specs_match_role_pools(&[1], &tank_pool));
        assert!(!item_specs_match_role_pools(&[3], &tank_pool));
    }

    #[test]
    fn heatmap_json_and_source_helpers_filter_predictably() {
        let dps_pool = HashSet::from([TrinketRolePool::Dps]);
        assert!(trinket_json_matches_active_spec(
            &json!({ "specs": [72] }),
            Some(72),
            false,
            &dps_pool
        ));
        assert!(!trinket_json_matches_active_spec(
            &json!({ "specs": [73] }),
            Some(72),
            false,
            &dps_pool
        ));
        assert!(trinket_json_matches_active_spec(
            &json!({ "specs": ["bad"] }),
            Some(72),
            false,
            &dps_pool
        ));

        assert_eq!(
            selected_heatmap_source_types("raid,delves,profession"),
            vec!["delve", "profession", "raid"]
        );
        assert_eq!(
            selected_heatmap_source_types(""),
            vec!["delve", "dungeon", "profession", "pvp", "raid"]
        );
        assert_eq!(
            normalized_locked_trinket_slot(" Trinket2 "),
            Some("trinket2")
        );
        assert_eq!(normalized_locked_trinket_slot("both"), None);
    }

    #[test]
    fn mplus_rotation_helpers_read_rotation_instance_and_sources() {
        let _guard = crate::item_db::state::TEST_STATE_LOCK.lock().unwrap();
        let prev_instances = crate::item_db::state::INSTANCES.read().unwrap().clone();
        let source_item = |sources| crate::types::GameItem {
            id: 1,
            name: String::new(),
            icon: String::new(),
            quality: 0,
            base_ilevel: None,
            class: None,
            subclass: None,
            inventory_type: None,
            set_id: None,
            has_sockets: false,
            socket_info: None,
            classes: None,
            specs: None,
            stats: None,
            bonus_lists: Vec::new(),
            sources,
            profession: None,
        };

        *crate::item_db::state::INSTANCES.write().unwrap() = vec![json!({
            "id": -1,
            "encounters": [
                {"id": 100},
                {"id": 200},
                {"id": "bad"}
            ]
        })];

        let rotation_ids = mplus_rotation_instance_ids();
        assert_eq!(rotation_ids, HashSet::from([100, 200]));

        let rotation_item = source_item(Some(vec![crate::types::ItemSource {
            encounter_id: None,
            instance_id: Some(100),
        }]));
        let synthetic_pool_item = source_item(Some(vec![crate::types::ItemSource {
            encounter_id: None,
            instance_id: Some(-1),
        }]));
        let non_rotation_item = source_item(Some(vec![crate::types::ItemSource {
            encounter_id: None,
            instance_id: Some(999),
        }]));
        let source_less_item = source_item(None);

        assert!(item_has_mplus_rotation_source(
            &rotation_item,
            &rotation_ids
        ));
        assert!(item_has_mplus_rotation_source(
            &synthetic_pool_item,
            &rotation_ids
        ));
        assert!(!item_has_mplus_rotation_source(
            &non_rotation_item,
            &rotation_ids
        ));
        assert!(!item_has_mplus_rotation_source(
            &source_less_item,
            &rotation_ids
        ));

        *crate::item_db::state::INSTANCES.write().unwrap() = prev_instances;
    }

    #[test]
    fn simc_item_string_includes_bonus_ids_and_positive_ilevel_only() {
        assert_eq!(build_simc_item_string(123, &[], 0), ",id=123");
        assert_eq!(build_simc_item_string(123, &[], 489), ",id=123,ilevel=489");
        assert_eq!(
            build_simc_item_string(123, &[10, 20], 0),
            ",id=123,bonus_id=10/20"
        );
        assert_eq!(
            build_simc_item_string(123, &[10, 20], 489),
            ",id=123,bonus_id=10/20,ilevel=489"
        );
    }

    #[test]
    fn make_resolved_item_builds_uid_simc_and_display_fields() {
        let item = make_resolved_item(
            "Trinket1",
            123,
            ResolvedItemSeed {
                name: "Test Trinket".to_string(),
                icon: "inv_trinket".to_string(),
                quality: 4,
                ilevel: 489,
                bonus_ids: vec![10, 20],
            },
            crate::types::ItemOrigin::Vault,
            12,
        );

        assert_eq!(item.uid, "123:10-20:vault:trinket1");
        assert_eq!(item.slot, "Trinket1");
        assert_eq!(item.simc_string, ",id=123,bonus_id=10/20,ilevel=489");
        assert_eq!(item.bonus_ids, vec![10, 20]);
        assert_eq!(item.name, "Test Trinket");
        assert_eq!(item.icon, "inv_trinket");
        assert_eq!(item.quality, 4);
        assert_eq!(item.inventory_type, 12);
        assert_eq!(item.season_id, crate::item_db::current_season_id() as i64);
    }

    #[test]
    fn spec_name_fallbacks_preserve_ambiguous_names_for_class_resolution() {
        assert_eq!(fallback_spec_id_by_name("fury"), Some(72));
        assert_eq!(fallback_spec_id_by_name("beastmastery"), Some(253));
        assert_eq!(fallback_spec_id_by_name("beast_mastery"), Some(253));
        assert_eq!(fallback_spec_id_by_name("holypriest"), Some(257));
        assert_eq!(fallback_spec_id_by_name("holy_priest"), Some(257));
        assert_eq!(fallback_spec_id_by_name("frostdk"), Some(251));
        assert_eq!(fallback_spec_id_by_name("frost_death_knight"), Some(251));
        assert_eq!(fallback_spec_id_by_name("restorationshaman"), Some(264));
        assert_eq!(fallback_spec_id_by_name("restoration_shaman"), Some(264));
        assert_eq!(fallback_spec_id_by_name("protection"), None);
        assert_eq!(fallback_spec_id_by_name("restoration"), None);

        assert_eq!(resolve_active_spec_id("paladin", "protection"), Some(66));
        assert_eq!(resolve_active_spec_id("warrior", "protection"), Some(73));
        assert_eq!(resolve_active_spec_id("druid", "restoration"), Some(105));
        assert_eq!(resolve_active_spec_id("shaman", "restoration"), Some(264));
        assert_eq!(resolve_active_spec_id("priest", "holy"), Some(257));
        assert_eq!(resolve_active_spec_id("mage", "frost"), Some(64));
        assert_eq!(resolve_active_spec_id("deathknight", "frostdk"), Some(251));
        assert_eq!(resolve_active_spec_id("hunter", "beast_mastery"), Some(253));
        assert_eq!(resolve_active_spec_id("shaman", "restorationshaman"), Some(264));
    }

    #[actix_web::test]
    async fn create_sim_rejects_input_without_detectable_class() {
        let req = parse_sim_req(json!({
            "simc_input": "this is not a simc export",
            "sim_type": "quick",
            "max_upgrade": false
        }));
        let resp = create_sim(
            web::Json(req),
            test_store(),
            test_simc_path(),
            test_log_buffer(),
        )
        .await;
        assert_eq!(resp.status(), 400);
        let body = to_bytes(resp.into_body()).await.expect("response body");
        let payload: Value = serde_json::from_slice(&body).expect("json body");
        assert!(payload
            .get("detail")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .contains("Could not detect character class"));
    }

    #[actix_web::test]
    async fn create_sim_rejects_valid_class_input_when_simc_binary_is_missing() {
        let req = parse_sim_req(json!({
            "simc_input": "warrior=\"Tester\"\nspec=fury\ntalents=abc\n",
            "sim_type": "quick",
            "max_upgrade": false
        }));
        let resp = create_sim(
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
    }

    #[actix_web::test]
    async fn create_sim_does_not_persist_job_before_binary_failure() {
        let store = test_store();
        let req = parse_sim_req(json!({
            "simc_input": "warrior=\"Tester\"\nspec=fury\ntalents=abc\n",
            "sim_type": "quick",
            "max_upgrade": false,
            "batch_id": "quick-meta"
        }));
        let resp = create_sim(
            web::Json(req),
            store.clone(),
            test_simc_path(),
            test_log_buffer(),
        )
        .await;
        assert_eq!(resp.status(), 400);

        let summaries = store
            .get_ref()
            .list_recent(10, None, None, false, false, false);
        assert!(summaries.is_empty());
        assert_eq!(store.get_ref().get_storage_size(), 0);
    }

    #[actix_web::test]
    async fn create_top_gear_rejects_input_without_detectable_class() {
        let req = parse_top_gear_req(json!({
            "simc_input": "not simc",
            "selected_items": {},
            "talent_builds": []
        }));
        let resp = create_top_gear_sim(
            web::Json(req),
            test_store(),
            test_simc_path(),
            test_log_buffer(),
        )
        .await;
        assert_eq!(resp.status(), 400);
        let body = to_bytes(resp.into_body()).await.expect("response body");
        let payload: Value = serde_json::from_slice(&body).expect("json body");
        assert!(payload
            .get("detail")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .contains("Could not detect character class"));
    }

    #[actix_web::test]
    async fn top_gear_combo_count_reports_zero_for_empty_selection() {
        let req = parse_top_gear_req(json!({
            "simc_input": "warrior=\"Tester\"\nspec=fury\n",
            "selected_items": {},
            "items_by_slot": {},
            "talent_builds": []
        }));
        let resp = get_top_gear_combo_count(web::Json(req)).await;
        assert_eq!(resp.status(), 200);

        let body = to_bytes(resp.into_body()).await.expect("response body");
        let payload: Value = serde_json::from_slice(&body).expect("json body");
        assert_eq!(payload.get("combo_count").and_then(Value::as_u64), Some(0));
    }

    #[actix_web::test]
    async fn top_gear_combo_count_reports_limit_error_count() {
        let req = parse_top_gear_req(json!({
            "simc_input": "warrior=\"Tester\"\nspec=fury\n",
            "selected_items": {
                "head": ["head-1"]
            },
            "items_by_slot": {
                "head": [
                    {
                        "uid": "head-equipped",
                        "slot": "head",
                        "item_id": 1000,
                        "simc_string": ",id=1000",
                        "origin": "equipped",
                        "bonus_ids": [],
                        "name": "Equipped Helm",
                        "icon": "inv_helmet",
                        "quality": 4
                    },
                    {
                        "uid": "head-1",
                        "slot": "head",
                        "item_id": 1001,
                        "simc_string": ",id=1001",
                        "origin": "bags",
                        "bonus_ids": [],
                        "name": "Test Helm",
                        "icon": "inv_helmet",
                        "quality": 4
                    }
                ]
            },
            "max_combinations": 1,
            "talent_builds": []
        }));
        let resp = get_top_gear_combo_count(web::Json(req)).await;
        assert_eq!(resp.status(), 200);

        let body = to_bytes(resp.into_body()).await.expect("response body");
        let payload: Value = serde_json::from_slice(&body).expect("json body");
        assert_eq!(payload.get("combo_count").and_then(Value::as_u64), Some(2));
        assert!(
            payload
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .contains("Too many combinations (2)")
        );
    }

    #[actix_web::test]
    async fn create_droptimizer_requires_at_least_one_selected_item() {
        let req = parse_droptimizer_req(json!({
            "simc_input": "warrior=\"Tester\"\nspec=fury\n",
            "drop_items": [],
            "copy_enchants": true
        }));
        let resp = create_droptimizer_sim(
            web::Json(req),
            test_store(),
            test_simc_path(),
            test_log_buffer(),
        )
        .await;
        assert_eq!(resp.status(), 400);
        let body = to_bytes(resp.into_body()).await.expect("response body");
        let payload: Value = serde_json::from_slice(&body).expect("json body");
        assert_eq!(
            payload.get("detail").and_then(Value::as_str),
            Some("No items selected. Select at least one drop item.")
        );
    }

    #[actix_web::test]
    async fn create_top_gear_with_multiple_talent_builds_reaches_binary_check() {
        let req = parse_top_gear_req(json!({
            "simc_input": "warrior=\"Tester\"\nspec=fury\ntalents=abc\n",
            "selected_items": {},
            "items_by_slot": {},
            "talent_builds": [
                {"name": "Build A", "talent_string": "abc"},
                {"name": "Build B", "talent_string": "def"}
            ]
        }));
        let resp = create_top_gear_sim(
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
    }

    #[actix_web::test]
    async fn create_top_gear_persists_job_metadata_before_binary_failure() {
        let store = test_store();
        let req = parse_top_gear_req(json!({
            "simc_input": "warrior=\"Tester\"\nspec=fury\ntalents=abc\n",
            "selected_items": {},
            "items_by_slot": {},
            "talent_builds": [
                {"name": "Build A", "talent_string": "abc"},
                {"name": "Build B", "talent_string": "def"}
            ],
            "batch_id": "top-gear-meta"
        }));
        let resp = create_top_gear_sim(
            web::Json(req),
            store.clone(),
            test_simc_path(),
            test_log_buffer(),
        )
        .await;
        assert_eq!(resp.status(), 400);

        let summaries = store
            .get_ref()
            .list_recent(10, None, None, false, false, false);
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].sim_type, "top_gear");

        let job = store
            .get_ref()
            .get(&summaries[0].id)
            .expect("stored top gear job");
        assert_eq!(job.batch_id.as_deref(), Some("top-gear-meta"));
        assert!(job.combo_metadata_json.is_some());
        let combo_meta: Value = serde_json::from_str(
            job.combo_metadata_json.as_deref().expect("combo metadata json"),
        )
        .expect("combo metadata value");
        assert_eq!(combo_meta["_combo_count"].as_u64(), Some(2));
        let combo_metadata = combo_meta["_combo_metadata"]
            .as_object()
            .expect("top gear combo metadata object");
        assert_eq!(combo_metadata.len(), 2);
        assert!(combo_metadata.values().all(|value| value.is_array()));
    }

    #[actix_web::test]
    async fn create_top_gear_rejects_full_batches_before_inserting_job() {
        let store = test_store();
        let max = *crate::storage::MAX_SCENARIOS;
        for _ in 0..max {
            let mut job = crate::models::Job::new(
                "warrior=tester".to_string(),
                "top_gear".to_string(),
                1000,
                "Patchwerk".to_string(),
                0.05,
            );
            job.batch_id = Some("top-gear-batch".to_string());
            store.insert(job);
        }

        let req = parse_top_gear_req(json!({
            "simc_input": "warrior=\"Tester\"\nspec=fury\ntalents=abc\n",
            "selected_items": {},
            "items_by_slot": {},
            "talent_builds": [
                {"name": "Build A", "talent_string": "abc"},
                {"name": "Build B", "talent_string": "def"}
            ],
            "batch_id": "top-gear-batch"
        }));
        let resp = create_top_gear_sim(
            web::Json(req),
            store.clone(),
            test_simc_path(),
            test_log_buffer(),
        )
        .await;
        assert_eq!(resp.status(), 400);

        let body = to_bytes(resp.into_body()).await.expect("response body");
        let payload: Value = serde_json::from_slice(&body).expect("json body");
        let expected = format!("Batch limit reached ({max} scenarios max).");
        assert_eq!(
            payload.get("detail").and_then(Value::as_str),
            Some(expected.as_str())
        );
        assert_eq!(store.get_ref().count_batch("top-gear-batch"), max);
    }

    #[actix_web::test]
    async fn create_top_gear_rejects_when_only_equipped_items_are_available() {
        let req = parse_top_gear_req(json!({
            "simc_input": "warrior=\"Tester\"\nspec=fury\n",
            "selected_items": {},
            "items_by_slot": {
                "head": [{
                    "uid": "head-equipped",
                    "slot": "head",
                    "item_id": 1000,
                    "simc_string": ",id=1000",
                    "origin": "equipped",
                    "bonus_ids": [],
                    "name": "Equipped Helm",
                    "icon": "inv_helmet",
                    "quality": 4
                }]
            },
            "talent_builds": []
        }));
        let resp = create_top_gear_sim(
            web::Json(req),
            test_store(),
            test_simc_path(),
            test_log_buffer(),
        )
        .await;
        assert_eq!(resp.status(), 400);

        let body = to_bytes(resp.into_body()).await.expect("response body");
        let payload: Value = serde_json::from_slice(&body).expect("json body");
        assert_eq!(
            payload.get("detail").and_then(Value::as_str),
            Some("No alternative items selected. Select at least one non-equipped item or multiple talent builds.")
        );
    }

    #[actix_web::test]
    async fn create_droptimizer_with_selected_item_reaches_binary_check() {
        let req = parse_droptimizer_req(json!({
            "simc_input": "warrior=\"Tester\"\nspec=fury\n",
            "drop_items": [{
                "uid": "drop-1",
                "slot": "head",
                "item_id": 1001,
                "simc_string": ",id=1001",
                "origin": "bags",
                "bonus_ids": [],
                "name": "Test Helm",
                "icon": "inv_helmet",
                "quality": 4
            }],
            "copy_enchants": true
        }));
        let resp = create_droptimizer_sim(
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
    }

    #[actix_web::test]
    async fn create_droptimizer_persists_job_metadata_before_binary_failure() {
        let store = test_store();
        let req = parse_droptimizer_req(json!({
            "simc_input": "warrior=\"Tester\"\nspec=fury\n",
            "drop_items": [{
                "uid": "drop-1",
                "slot": "head",
                "item_id": 1001,
                "simc_string": ",id=1001",
                "origin": "bags",
                "bonus_ids": [],
                "name": "Test Helm",
                "icon": "inv_helmet",
                "quality": 4
            }],
            "copy_enchants": true,
            "batch_id": "droptimizer-meta"
        }));
        let resp = create_droptimizer_sim(
            web::Json(req),
            store.clone(),
            test_simc_path(),
            test_log_buffer(),
        )
        .await;
        assert_eq!(resp.status(), 400);

        let summaries = store
            .get_ref()
            .list_recent(10, None, None, false, false, false);
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].sim_type, "droptimizer");

        let job = store
            .get_ref()
            .get(&summaries[0].id)
            .expect("stored droptimizer job");
        assert_eq!(job.batch_id.as_deref(), Some("droptimizer-meta"));
        assert!(job.combo_metadata_json.is_some());
        let combo_meta: Value = serde_json::from_str(
            job.combo_metadata_json.as_deref().expect("combo metadata json"),
        )
        .expect("combo metadata value");
        assert_eq!(combo_meta["_combo_count"].as_u64(), Some(1));
        let combo_metadata = combo_meta["_combo_metadata"]
            .as_object()
            .expect("droptimizer combo metadata object");
        assert_eq!(combo_metadata.len(), 1);
        assert!(combo_metadata.values().all(|value| value.is_array()));
    }

    #[actix_web::test]
    async fn create_droptimizer_rejects_full_batches_before_inserting_job() {
        let store = test_store();
        let max = *crate::storage::MAX_SCENARIOS;
        for _ in 0..max {
            let mut job = crate::models::Job::new(
                "warrior=tester".to_string(),
                "droptimizer".to_string(),
                1000,
                "Patchwerk".to_string(),
                0.05,
            );
            job.batch_id = Some("droptimizer-batch".to_string());
            store.insert(job);
        }

        let req = parse_droptimizer_req(json!({
            "simc_input": "warrior=\"Tester\"\nspec=fury\n",
            "drop_items": [{
                "uid": "drop-1",
                "slot": "head",
                "item_id": 1001,
                "simc_string": ",id=1001",
                "origin": "bags",
                "bonus_ids": [],
                "name": "Test Helm",
                "icon": "inv_helmet",
                "quality": 4
            }],
            "copy_enchants": true,
            "batch_id": "droptimizer-batch"
        }));
        let resp = create_droptimizer_sim(
            web::Json(req),
            store.clone(),
            test_simc_path(),
            test_log_buffer(),
        )
        .await;
        assert_eq!(resp.status(), 400);

        let body = to_bytes(resp.into_body()).await.expect("response body");
        let payload: Value = serde_json::from_slice(&body).expect("json body");
        let expected = format!("Batch limit reached ({max} scenarios max).");
        assert_eq!(
            payload.get("detail").and_then(Value::as_str),
            Some(expected.as_str())
        );
        assert_eq!(store.get_ref().count_batch("droptimizer-batch"), max);
    }

    #[actix_web::test]
    async fn create_sim_dispatches_external_buff_matrix_validation() {
        let req = parse_sim_req(json!({
            "simc_input": "warrior=\"Tester\"\nspec=fury\n",
            "sim_type": "external_buff_matrix"
        }));
        let resp = create_sim(
            web::Json(req),
            test_store(),
            test_simc_path(),
            test_log_buffer(),
        )
        .await;
        assert_eq!(resp.status(), 400);

        let body = to_bytes(resp.into_body()).await.expect("response body");
        let payload: Value = serde_json::from_slice(&body).expect("json body");
        assert_eq!(
            payload.get("detail").and_then(Value::as_str),
            Some("Select at least one external buff for the matrix.")
        );
    }

    #[actix_web::test]
    async fn create_sim_dispatches_consumable_matrix_validation() {
        let req = parse_sim_req(json!({
            "simc_input": "warrior=\"Tester\"\nspec=fury\n",
            "sim_type": "consumable_matrix"
        }));
        let resp = create_sim(
            web::Json(req),
            test_store(),
            test_simc_path(),
            test_log_buffer(),
        )
        .await;
        assert_eq!(resp.status(), 400);

        let body = to_bytes(resp.into_body()).await.expect("response body");
        let payload: Value = serde_json::from_slice(&body).expect("json body");
        assert_eq!(
            payload.get("detail").and_then(Value::as_str),
            Some("Select at least one consumable or raid buff to compare.")
        );
    }

    #[actix_web::test]
    async fn create_sim_dispatches_trinket_heatmap_validation() {
        let req = parse_sim_req(json!({
            "simc_input": "warrior=\"Tester\"\nspec=fury\n",
            "sim_type": "trinket_tier_heatmap",
            "include_trinket_matrix": false,
            "include_tier_matrix": false
        }));
        let resp = create_sim(
            web::Json(req),
            test_store(),
            test_simc_path(),
            test_log_buffer(),
        )
        .await;
        assert_eq!(resp.status(), 400);

        let body = to_bytes(resp.into_body()).await.expect("response body");
        let payload: Value = serde_json::from_slice(&body).expect("json body");
        assert_eq!(
            payload.get("detail").and_then(Value::as_str),
            Some("Enable at least one matrix option (Trinkets or Tier Sets).")
        );
    }

    #[actix_web::test]
    async fn external_buff_matrix_with_selection_reaches_binary_check() {
        let mut options = default_options();
        options.external_buff_power_infusion = true;

        let resp = create_external_buff_matrix_sim(
            "warrior=\"Tester\"\nspec=fury\n".to_string(),
            &options,
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
    }

    #[actix_web::test]
    async fn external_buff_matrix_persists_job_metadata_before_binary_failure() {
        let store = test_store();
        let mut options = default_options();
        options.external_buff_power_infusion = true;
        options.batch_id = Some("matrix-meta".to_string());

        let resp = create_external_buff_matrix_sim(
            "warrior=\"Tester\"\nspec=fury\n".to_string(),
            &options,
            store.clone(),
            test_simc_path(),
            test_log_buffer(),
        )
        .await;
        assert_eq!(resp.status(), 400);

        let summaries = store
            .get_ref()
            .list_recent(10, None, None, false, false, false);
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].sim_type, "external_buff_matrix");

        let job = store
            .get_ref()
            .get(&summaries[0].id)
            .expect("stored external buff matrix job");
        assert_eq!(job.batch_id.as_deref(), Some("matrix-meta"));
        assert!(job.combo_metadata_json.is_some());
        let combo_meta: Value = serde_json::from_str(
            job.combo_metadata_json.as_deref().expect("combo metadata json"),
        )
        .expect("combo metadata value");
        assert_eq!(combo_meta["_combo_count"].as_u64(), Some(1));
        assert_eq!(
            combo_meta["_combo_metadata"]["External Buff 1 | Power Infusion"][0]["external_buff"],
            json!("Power Infusion")
        );
    }

    #[actix_web::test]
    async fn consumable_matrix_with_selection_reaches_binary_check() {
        let mut options = default_options();
        options.consumable_matrix_flasks = vec!["flask_a".to_string()];

        let resp = create_consumable_matrix_sim(
            "warrior=\"Tester\"\nspec=fury\n".to_string(),
            &options,
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
    }

    #[actix_web::test]
    async fn consumable_matrix_persists_job_metadata_before_binary_failure() {
        let store = test_store();
        let mut options = default_options();
        options.consumable_matrix_flasks = vec!["flask_a".to_string()];
        options.batch_id = Some("consumable-meta".to_string());

        let resp = create_consumable_matrix_sim(
            "warrior=\"Tester\"\nspec=fury\n".to_string(),
            &options,
            store.clone(),
            test_simc_path(),
            test_log_buffer(),
        )
        .await;
        assert_eq!(resp.status(), 400);

        let summaries = store
            .get_ref()
            .list_recent(10, None, None, false, false, false);
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].sim_type, "consumable_matrix");

        let job = store
            .get_ref()
            .get(&summaries[0].id)
            .expect("stored consumable matrix job");
        assert_eq!(job.batch_id.as_deref(), Some("consumable-meta"));
        assert!(job.combo_metadata_json.is_some());
        let combo_meta: Value = serde_json::from_str(
            job.combo_metadata_json.as_deref().expect("combo metadata json"),
        )
        .expect("combo metadata value");
        assert_eq!(combo_meta["_combo_count"].as_u64(), Some(1));
        assert_eq!(
            combo_meta["_combo_metadata"]["Consumable 1 | Flask: flask_a"][0]["consumable_category"],
            json!("flask")
        );
    }

    #[actix_web::test]
    async fn external_buff_matrix_rejects_batches_at_scenario_limit() {
        let store = test_store();
        let max = *crate::storage::MAX_SCENARIOS;
        for _ in 0..max {
            let mut job = crate::models::Job::new(
                "warrior=tester".to_string(),
                "external_buff_matrix".to_string(),
                1000,
                "Patchwerk".to_string(),
                0.05,
            );
            job.batch_id = Some("matrix-batch".to_string());
            store.insert(job);
        }

        let mut options = default_options();
        options.external_buff_power_infusion = true;
        options.batch_id = Some("matrix-batch".to_string());

        let resp = create_external_buff_matrix_sim(
            "warrior=\"Tester\"\nspec=fury\n".to_string(),
            &options,
            store,
            test_simc_path(),
            test_log_buffer(),
        )
        .await;
        assert_eq!(resp.status(), 400);

        let body = to_bytes(resp.into_body()).await.expect("response body");
        let payload: Value = serde_json::from_slice(&body).expect("json body");
        let expected = format!("Batch limit reached ({max} scenarios max).");
        assert_eq!(
            payload.get("detail").and_then(Value::as_str),
            Some(expected.as_str())
        );
    }

    #[actix_web::test]
    async fn consumable_matrix_rejects_batches_at_scenario_limit() {
        let store = test_store();
        let max = *crate::storage::MAX_SCENARIOS;
        for _ in 0..max {
            let mut job = crate::models::Job::new(
                "warrior=tester".to_string(),
                "consumable_matrix".to_string(),
                1000,
                "Patchwerk".to_string(),
                0.05,
            );
            job.batch_id = Some("consumable-batch".to_string());
            store.insert(job);
        }

        let mut options = default_options();
        options.consumable_matrix_flasks = vec!["flask_a".to_string()];
        options.batch_id = Some("consumable-batch".to_string());

        let resp = create_consumable_matrix_sim(
            "warrior=\"Tester\"\nspec=fury\n".to_string(),
            &options,
            store,
            test_simc_path(),
            test_log_buffer(),
        )
        .await;
        assert_eq!(resp.status(), 400);

        let body = to_bytes(resp.into_body()).await.expect("response body");
        let payload: Value = serde_json::from_slice(&body).expect("json body");
        let expected = format!("Batch limit reached ({max} scenarios max).");
        assert_eq!(
            payload.get("detail").and_then(Value::as_str),
            Some(expected.as_str())
        );
    }
}
