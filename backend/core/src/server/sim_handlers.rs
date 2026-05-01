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

#[derive(Clone)]
struct HeatmapTrinketVariant {
    label: String,
    item: crate::types::ResolvedItem,
}

struct ExternalBuffScenario {
    label: String,
    lines: Vec<String>,
}

struct ConsumableScenario {
    label: String,
    category: String,
    token: String,
    lines: Vec<String>,
}

type ComboMetadata = HashMap<String, Vec<Value>>;
type MatrixBuildResult = Result<(String, usize, ComboMetadata), String>;

struct ResolvedItemSeed {
    name: String,
    icon: String,
    quality: i64,
    ilevel: i64,
    bonus_ids: Vec<u64>,
}

fn sanitize_matrix_token(input: &str) -> Option<String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return None;
    }
    let ok = trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.' | '/' | ':' | '+'));
    if ok {
        Some(trimmed.to_string())
    } else {
        None
    }
}

fn raid_buff_line(buff_key: &str) -> Option<&'static str> {
    match buff_key {
        "bloodlust" => Some("override.bloodlust=1"),
        "arcane_intellect" => Some("override.arcane_intellect=1"),
        "power_word_fortitude" => Some("override.power_word_fortitude=1"),
        "battle_shout" => Some("override.battle_shout=1"),
        "mark_of_the_wild" => Some("override.mark_of_the_wild=1"),
        "hunters_mark" => Some("override.hunters_mark=1"),
        "bleeding" => Some("override.bleeding=1"),
        "chaos_brand" => Some("override.chaos_brand=1"),
        "mystic_touch" => Some("override.mystic_touch=1"),
        "skyfury" => Some("override.skyfury=1"),
        "power_infusion" => Some("external_buffs.power_infusion=0/120/240"),
        "blessing_of_bronze" => Some("override.blessing_of_the_bronze=1"),
        _ => None,
    }
}

fn build_external_buff_matrix_input(simc_input: &str, options: &SimOptions) -> MatrixBuildResult {
    let (base_lines, equipped_gear, talents, _spec) =
        crate::profileset_generator::parser::parse_base_profile(simc_input);

    let mut scenarios: Vec<ExternalBuffScenario> = Vec::new();
    if options.external_buff_chaos_brand {
        scenarios.push(ExternalBuffScenario {
            label: "Chaos Brand".to_string(),
            lines: vec!["override.chaos_brand=1".to_string()],
        });
    }
    if options.external_buff_mystic_touch {
        scenarios.push(ExternalBuffScenario {
            label: "Mystic Touch".to_string(),
            lines: vec!["override.mystic_touch=1".to_string()],
        });
    }
    if options.external_buff_skyfury {
        scenarios.push(ExternalBuffScenario {
            label: "Skyfury".to_string(),
            lines: vec!["override.skyfury=1".to_string()],
        });
    }
    if options.external_buff_power_infusion {
        scenarios.push(ExternalBuffScenario {
            label: "Power Infusion".to_string(),
            lines: vec!["external_buffs.power_infusion=0/120/240".to_string()],
        });
    }
    if options.external_buff_blessing_of_bronze {
        scenarios.push(ExternalBuffScenario {
            label: "Blessing of Bronze".to_string(),
            lines: vec!["override.blessing_of_the_bronze=1".to_string()],
        });
    }
    if options.external_buff_augmentation {
        scenarios.push(ExternalBuffScenario {
            label: "Augmentation Evoker Buffs".to_string(),
            lines: vec![
                "override.blessing_of_the_bronze=1".to_string(),
                "dragonflight.brilliance_party=1".to_string(),
            ],
        });
    }

    if scenarios.is_empty() {
        return Err("Select at least one external buff for the matrix.".to_string());
    }

    let mut lines: Vec<String> = Vec::new();
    let mut combo_metadata: ComboMetadata = HashMap::new();
    lines.push("optimal_raid=0".to_string());
    lines.push(String::new());
    lines.push("# Base Actor".to_string());
    lines.extend(base_lines);
    lines.push("### Combo 1".to_string());
    for slot in crate::types::class_data::GEAR_SLOTS {
        if let Some(gear) = equipped_gear.get(*slot) {
            lines.push(format!("{}={}", slot, gear));
        } else if *slot == "off_hand" {
            lines.push("off_hand=,".to_string());
        }
    }
    if !talents.is_empty() {
        lines.push(format!("talents={}", talents));
    }
    lines.push(String::new());

    let mut combo_index = 2usize;
    for scenario in scenarios {
        let combo_name = format!("External Buff {} | {}", combo_index - 1, scenario.label);
        lines.push(format!("### {}", combo_name));
        for line in scenario.lines {
            lines.push(format!("profileset.\"{}\"+={}", combo_name, line));
        }
        if !talents.is_empty() {
            lines.push(format!(
                "profileset.\"{}\"+=talents={}",
                combo_name, talents
            ));
        }
        lines.push(String::new());

        combo_metadata.insert(
            combo_name.clone(),
            vec![json!({
                "external_buff": scenario.label,
                "heatmap_kind": "external_buff",
                "is_kept": false
            })],
        );
        combo_index += 1;
    }

    Ok((
        lines.join("\n"),
        combo_index.saturating_sub(2),
        combo_metadata,
    ))
}

fn build_consumable_matrix_input(simc_input: &str, options: &SimOptions) -> MatrixBuildResult {
    let (base_lines, equipped_gear, talents, _spec) =
        crate::profileset_generator::parser::parse_base_profile(simc_input);

    let mut scenarios: Vec<ConsumableScenario> = Vec::new();
    let mut seen = HashSet::<String>::new();

    for raw in &options.consumable_matrix_flasks {
        if let Some(token) = sanitize_matrix_token(raw) {
            let dedupe_key = format!("flask:{}", token);
            if !seen.insert(dedupe_key) {
                continue;
            }
            scenarios.push(ConsumableScenario {
                label: format!("Flask: {}", token),
                category: "flask".to_string(),
                token: token.clone(),
                lines: vec![format!("flask={}", token)],
            });
        }
    }
    for raw in &options.consumable_matrix_foods {
        if let Some(token) = sanitize_matrix_token(raw) {
            let dedupe_key = format!("food:{}", token);
            if !seen.insert(dedupe_key) {
                continue;
            }
            scenarios.push(ConsumableScenario {
                label: format!("Food: {}", token),
                category: "food".to_string(),
                token: token.clone(),
                lines: vec![format!("food={}", token)],
            });
        }
    }
    for raw in &options.consumable_matrix_potions {
        if let Some(token) = sanitize_matrix_token(raw) {
            let dedupe_key = format!("potion:{}", token);
            if !seen.insert(dedupe_key) {
                continue;
            }
            scenarios.push(ConsumableScenario {
                label: format!("Potion: {}", token),
                category: "potion".to_string(),
                token: token.clone(),
                lines: vec![format!("potion={}", token)],
            });
        }
    }
    for raw in &options.consumable_matrix_augmentations {
        if let Some(token) = sanitize_matrix_token(raw) {
            let dedupe_key = format!("augmentation:{}", token);
            if !seen.insert(dedupe_key) {
                continue;
            }
            scenarios.push(ConsumableScenario {
                label: format!("Augmentation: {}", token),
                category: "augmentation".to_string(),
                token: token.clone(),
                lines: vec![format!("augmentation={}", token)],
            });
        }
    }
    for raw in &options.consumable_matrix_temporary_enchants {
        if let Some(token) = sanitize_matrix_token(raw) {
            if token.starts_with("off_hand:") {
                continue;
            }
            let dedupe_key = format!("temporary_enchant:{}", token);
            if !seen.insert(dedupe_key) {
                continue;
            }
            scenarios.push(ConsumableScenario {
                label: format!("Temp Enchant: {}", token),
                category: "temporary_enchant".to_string(),
                token: token.clone(),
                lines: vec![format!("temporary_enchant={}", token)],
            });
        }
    }
    for raw in &options.consumable_matrix_raid_buffs {
        let key = raw.trim();
        if key.is_empty() {
            continue;
        }
        if let Some(line) = raid_buff_line(key) {
            let dedupe_key = format!("raid_buff:{}", key);
            if !seen.insert(dedupe_key) {
                continue;
            }
            scenarios.push(ConsumableScenario {
                label: format!("Raid Buff: {}", key),
                category: "raid_buff".to_string(),
                token: key.to_string(),
                lines: vec![line.to_string()],
            });
        }
    }

    if scenarios.is_empty() {
        return Err("Select at least one consumable or raid buff to compare.".to_string());
    }

    let mut lines: Vec<String> = Vec::new();
    let mut combo_metadata: ComboMetadata = HashMap::new();
    lines.push(String::new());
    lines.push("# Base Actor".to_string());

    // Filter out existing consumables, raid buffs, and common overrides from base_lines
    // to ensure the baseline is clean as requested.
    let base_lines_filtered: Vec<String> = base_lines
        .into_iter()
        .filter(|line| {
            let l = line.trim().to_lowercase();
            // Clear standard consumable lines
            if l.starts_with("food=")
                || l.starts_with("flask=")
                || l.starts_with("potion=")
                || l.starts_with("augmentation=")
                || l.starts_with("temporary_enchant=")
                || l.starts_with("feast=")
            {
                return false;
            }
            // Clear raid buff settings
            if l.starts_with("optimal_raid=") || l.starts_with("party_buffs=") {
                return false;
            }
            // Clear common raid buff overrides that might be in the matrix
            if l.starts_with("override.bloodlust=")
                || l.starts_with("override.arcane_intellect=")
                || l.starts_with("override.power_word_fortitude=")
                || l.starts_with("override.battle_shout=")
                || l.starts_with("override.mark_of_the_wild=")
                || l.starts_with("override.hunters_mark=")
                || l.starts_with("override.bleeding=")
                || l.starts_with("override.chaos_brand=")
                || l.starts_with("override.mystic_touch=")
                || l.starts_with("override.skyfury=")
                || l.starts_with("override.blessing_of_the_bronze=")
                || l.starts_with("external_buffs.power_infusion=")
            {
                return false;
            }
            true
        })
        .collect();

    lines.extend(base_lines_filtered);

    // Force matrix baseline to "no consumables" and "no raid buffs"
    lines.push("optimal_raid=0".to_string());
    lines.push("party_buffs=0".to_string());
    lines.push("flask=".to_string());
    lines.push("food=".to_string());
    lines.push("potion=".to_string());
    lines.push("augmentation=".to_string());
    lines.push("temporary_enchant=".to_string());
    // Also clear common overrides to match the filter above
    lines.push("override.bloodlust=0".to_string());
    lines.push("override.arcane_intellect=0".to_string());
    lines.push("override.power_word_fortitude=0".to_string());
    lines.push("override.battle_shout=0".to_string());
    lines.push("override.mark_of_the_wild=0".to_string());
    lines.push("override.hunters_mark=0".to_string());
    lines.push("override.bleeding=0".to_string());
    lines.push("override.chaos_brand=0".to_string());
    lines.push("override.mystic_touch=0".to_string());
    lines.push("override.skyfury=0".to_string());
    lines.push("override.blessing_of_the_bronze=0".to_string());
    lines.push("external_buffs.power_infusion=".to_string());

    lines.push("### Combo 1".to_string());
    for slot in crate::types::class_data::GEAR_SLOTS {
        if let Some(gear) = equipped_gear.get(*slot) {
            lines.push(format!("{}={}", slot, gear));
        } else if *slot == "off_hand" {
            lines.push("off_hand=,".to_string());
        }
    }
    if !talents.is_empty() {
        lines.push(format!("talents={}", talents));
    }
    lines.push(String::new());

    let mut combo_index = 2usize;
    for scenario in scenarios {
        let combo_name = format!("Consumable {} | {}", combo_index - 1, scenario.label);
        lines.push(format!("### {}", combo_name));
        for line in scenario.lines {
            lines.push(format!("profileset.\"{}\"+={}", combo_name, line));
        }
        if !talents.is_empty() {
            lines.push(format!(
                "profileset.\"{}\"+=talents={}",
                combo_name, talents
            ));
        }
        lines.push(String::new());
        combo_metadata.insert(
            combo_name.clone(),
            vec![json!({
                "consumable_category": scenario.category,
                "consumable_token": scenario.token,
                "heatmap_kind": "consumable",
                "is_kept": false
            })],
        );
        combo_index += 1;
    }

    Ok((
        lines.join("\n"),
        combo_index.saturating_sub(2),
        combo_metadata,
    ))
}

fn build_simc_item_string(item_id: u64, bonus_ids: &[u64], ilevel: i64) -> String {
    if bonus_ids.is_empty() {
        if ilevel > 0 {
            format!(",id={},ilevel={}", item_id, ilevel)
        } else {
            format!(",id={}", item_id)
        }
    } else {
        let joined = bonus_ids
            .iter()
            .map(|b| b.to_string())
            .collect::<Vec<_>>()
            .join("/");
        if ilevel > 0 {
            format!(",id={},bonus_id={},ilevel={}", item_id, joined, ilevel)
        } else {
            format!(",id={},bonus_id={}", item_id, joined)
        }
    }
}

fn make_resolved_item(
    slot: &str,
    item_id: u64,
    seed: ResolvedItemSeed,
    origin: crate::types::ItemOrigin,
    inventory_type: i64,
) -> crate::types::ResolvedItem {
    let uid_bonus = if seed.bonus_ids.is_empty() {
        "0".to_string()
    } else {
        seed.bonus_ids
            .iter()
            .map(|b| b.to_string())
            .collect::<Vec<_>>()
            .join("-")
    };
    let simc_string = build_simc_item_string(item_id, &seed.bonus_ids, seed.ilevel);
    crate::types::ResolvedItem {
        uid: format!(
            "{}:{}:{}:{}",
            item_id,
            uid_bonus,
            origin.as_str(),
            slot.to_lowercase()
        ),
        slot: slot.to_string(),
        item_id,
        ilevel: seed.ilevel,
        simc_string,
        origin,
        bonus_ids: seed.bonus_ids,
        enchant_id: 0,
        gem_id: 0,
        name: seed.name,
        icon: seed.icon,
        quality: seed.quality,
        quality_color: crate::types::class_data::quality_color(seed.quality as u64).to_string(),
        tag: String::new(),
        upgrade: String::new(),
        sockets: 0,
        enchant_name: String::new(),
        gem_name: String::new(),
        gem_icon: String::new(),
        encounter: String::new(),
        instance_name: String::new(),
        source_type: String::new(),
        season_id: crate::item_db::current_season_id() as i64,
        inventory_type,
        is_catalyst: false,
        can_catalyst: false,
        ..Default::default()
    }
}

fn fallback_spec_id_by_name(spec_name: &str) -> Option<u64> {
    match spec_name {
        "arcane" => Some(62),
        "fire" => Some(63),
        "frost" => Some(64),
        "holy" => Some(65),
        "protection" => None, // ambiguous (paladin/warrior)
        "retribution" => Some(70),
        "arms" => Some(71),
        "fury" => Some(72),
        "balance" => Some(102),
        "feral" => Some(103),
        "guardian" => Some(104),
        "restoration" => None, // ambiguous (druid/shaman)
        "devastation" => Some(1467),
        "preservation" => Some(1468),
        "augmentation" => Some(1473),
        "blood" => Some(250),
        "frost_death_knight" | "frostdk" => Some(251),
        "unholy" => Some(252),
        "beast_mastery" | "beastmastery" => Some(253),
        "marksmanship" => Some(254),
        "survival" => Some(255),
        "discipline" => Some(256),
        "holy_priest" | "holypriest" => Some(257),
        "shadow" => Some(258),
        "assassination" => Some(259),
        "outlaw" => Some(260),
        "subtlety" => Some(261),
        "elemental" => Some(262),
        "enhancement" => Some(263),
        "restoration_shaman" | "restorationshaman" => Some(264),
        "affliction" => Some(265),
        "demonology" => Some(266),
        "destruction" => Some(267),
        "brewmaster" => Some(268),
        "windwalker" => Some(269),
        "mistweaver" => Some(270),
        "havoc" => Some(577),
        "vengeance" => Some(581),
        _ => None,
    }
}

fn resolve_active_spec_id(class_name: &str, spec_name: &str) -> Option<u64> {
    if let Some(id) = crate::types::class_data::class_spec_ids(class_name, Some(spec_name))
        .into_iter()
        .next()
    {
        return Some(id);
    }

    // Disambiguate ambiguous names with class where possible.
    match (class_name, spec_name) {
        ("paladin", "protection") => return Some(66),
        ("warrior", "protection") => return Some(73),
        ("druid", "restoration") => return Some(105),
        ("shaman", "restoration") => return Some(264),
        ("priest", "holy") => return Some(257),
        _ => {}
    }

    fallback_spec_id_by_name(spec_name)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum TrinketRolePool {
    Dps,
    Tank,
    Healer,
}

fn spec_id_to_role_pool(spec_id: u64) -> TrinketRolePool {
    match spec_id {
        66 | 73 | 104 | 250 | 268 | 581 => TrinketRolePool::Tank,
        65 | 105 | 257 | 264 | 270 | 1468 => TrinketRolePool::Healer,
        _ => TrinketRolePool::Dps,
    }
}

fn class_id_supports_role_pool(class_id: u64, role: TrinketRolePool) -> bool {
    match class_id {
        1 => matches!(role, TrinketRolePool::Dps | TrinketRolePool::Tank), // Warrior
        2 => true,                                                         // Paladin
        3 => matches!(role, TrinketRolePool::Dps),                         // Hunter
        4 => matches!(role, TrinketRolePool::Dps),                         // Rogue
        5 => matches!(role, TrinketRolePool::Dps | TrinketRolePool::Healer), // Priest
        6 => matches!(role, TrinketRolePool::Dps | TrinketRolePool::Tank), // Death Knight
        7 => matches!(role, TrinketRolePool::Dps | TrinketRolePool::Healer), // Shaman
        8 => matches!(role, TrinketRolePool::Dps),                         // Mage
        9 => matches!(role, TrinketRolePool::Dps),                         // Warlock
        10 => true,                                                        // Monk
        11 => true,                                                        // Druid
        12 => matches!(role, TrinketRolePool::Dps | TrinketRolePool::Tank), // Demon Hunter
        13 => matches!(role, TrinketRolePool::Dps | TrinketRolePool::Healer), // Evoker
        _ => true,
    }
}

fn selected_heatmap_role_pools(
    role_pools: &str,
    active_spec_id: Option<u64>,
) -> HashSet<TrinketRolePool> {
    let mut explicit: HashSet<TrinketRolePool> = HashSet::new();
    let mut has_auto = false;
    for token in role_pools.split(',') {
        match token.trim().to_lowercase().as_str() {
            "all" | "any" => {
                explicit.insert(TrinketRolePool::Dps);
                explicit.insert(TrinketRolePool::Tank);
                explicit.insert(TrinketRolePool::Healer);
            }
            "dps" => {
                explicit.insert(TrinketRolePool::Dps);
            }
            "tank" => {
                explicit.insert(TrinketRolePool::Tank);
            }
            "healer" | "heal" => {
                explicit.insert(TrinketRolePool::Healer);
            }
            "auto" | "" => {
                has_auto = true;
            }
            _ => {}
        }
    }
    if !explicit.is_empty() {
        return explicit;
    }
    if has_auto {
        return HashSet::from([spec_id_to_role_pool(active_spec_id.unwrap_or(0))]);
    }
    HashSet::from([
        TrinketRolePool::Dps,
        TrinketRolePool::Tank,
        TrinketRolePool::Healer,
    ])
}

fn item_specs_match_role_pools(specs: &[u64], selected_pools: &HashSet<TrinketRolePool>) -> bool {
    if selected_pools.is_empty() || specs.is_empty() {
        return true;
    }

    let spec_entries: Vec<u64> = specs.iter().copied().filter(|id| *id > 13).collect();
    if !spec_entries.is_empty() {
        return spec_entries
            .iter()
            .any(|sid| selected_pools.contains(&spec_id_to_role_pool(*sid)));
    }

    const KNOWN_CLASS_IDS: &[u64] = &[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
    let class_entries: Vec<u64> = specs
        .iter()
        .copied()
        .filter(|id| KNOWN_CLASS_IDS.contains(id))
        .collect();
    if class_entries.is_empty() {
        return true;
    }

    class_entries.iter().any(|class_id| {
        selected_pools
            .iter()
            .any(|pool| class_id_supports_role_pool(*class_id, *pool))
    })
}

fn item_specs_match_active_spec(
    specs: &[u64],
    active_spec_id: Option<u64>,
    ignore_spec_restrictions: bool,
) -> bool {
    if ignore_spec_restrictions {
        return true;
    }
    if specs.is_empty() {
        return true;
    }
    // Values <= 13 are WoW class IDs. Values > 13 are spec IDs.
    let spec_entries: Vec<u64> = specs.iter().copied().filter(|id| *id > 13).collect();
    if !spec_entries.is_empty() {
        // Has explicit spec IDs — the active spec must be among them.
        return active_spec_id.is_some_and(|id| spec_entries.contains(&id));
    }

    // Class-only restriction list (allowableClasses).
    const KNOWN_CLASS_IDS: &[u64] = &[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
    let class_entries: Vec<u64> = specs
        .iter()
        .copied()
        .filter(|id| KNOWN_CLASS_IDS.contains(id))
        .collect();
    if class_entries.is_empty() {
        // Neither spec IDs nor class IDs — treat as unrestricted.
        return true;
    }

    // Resolve the active spec's parent class and check against allowed classes.
    active_spec_id.is_some_and(|sid| {
        crate::types::class_data::spec_id_to_wow_class_id(sid)
            .is_some_and(|cid| class_entries.contains(&cid))
    })
}

fn trinket_json_matches_active_spec(
    trinket: &Value,
    active_spec_id: Option<u64>,
    ignore_spec_restrictions: bool,
    selected_role_pools: &HashSet<TrinketRolePool>,
) -> bool {
    let Some(specs) = trinket.get("specs").and_then(|v| v.as_array()) else {
        return true;
    };
    if specs.is_empty() {
        return true;
    }
    let parsed_specs: Vec<u64> = specs.iter().filter_map(|v| v.as_u64()).collect();
    if parsed_specs.len() != specs.len() {
        return true;
    }
    item_specs_match_active_spec(&parsed_specs, active_spec_id, ignore_spec_restrictions)
        && item_specs_match_role_pools(&parsed_specs, selected_role_pools)
}

fn item_id_matches_active_spec(
    item_id: u64,
    active_spec_id: Option<u64>,
    ignore_spec_restrictions: bool,
) -> bool {
    if ignore_spec_restrictions {
        return true;
    }
    let Some(raw) = crate::item_db::get_raw_item(item_id) else {
        return true;
    };
    let item_specs = raw.restriction_ids();
    item_specs_match_active_spec(&item_specs, active_spec_id, ignore_spec_restrictions)
}

fn item_id_matches_active_spec_with_lookup(
    item_id: u64,
    active_spec_id: Option<u64>,
    drop_specs_by_item: &HashMap<u64, Vec<u64>>,
    ignore_spec_restrictions: bool,
    selected_role_pools: &HashSet<TrinketRolePool>,
) -> bool {
    if let Some(specs) = drop_specs_by_item.get(&item_id) {
        return item_specs_match_active_spec(specs, active_spec_id, ignore_spec_restrictions)
            && item_specs_match_role_pools(specs, selected_role_pools);
    }
    item_id_matches_active_spec(item_id, active_spec_id, ignore_spec_restrictions)
}

fn mplus_rotation_instance_ids() -> HashSet<i64> {
    crate::item_db::instances()
        .into_iter()
        .find(|inst| inst.get("id").and_then(|v| v.as_i64()) == Some(-1))
        .and_then(|inst| inst.get("encounters").and_then(|v| v.as_array()).cloned())
        .unwrap_or_default()
        .into_iter()
        .filter_map(|e| e.get("id").and_then(|v| v.as_i64()))
        .collect()
}

fn item_has_mplus_rotation_source(item: &crate::types::GameItem, mplus_ids: &HashSet<i64>) -> bool {
    item.sources.as_ref().is_some_and(|sources| {
        sources.iter().any(|src| {
            src.instance_id == Some(-1)
                || src.instance_id.is_some_and(|iid| mplus_ids.contains(&iid))
        })
    })
}

fn selected_heatmap_source_types(scope: &str) -> Vec<&'static str> {
    let mut picked: HashSet<&'static str> = HashSet::new();
    for token in scope.split(',') {
        match token.trim().to_lowercase().as_str() {
            "all" => {
                picked.insert("raid");
                picked.insert("dungeon");
                picked.insert("delve");
                picked.insert("pvp");
                picked.insert("profession");
            }
            "raid" | "raids" => {
                picked.insert("raid");
            }
            "dungeon" | "dungeons" => {
                picked.insert("dungeon");
            }
            "delve" | "delves" => {
                picked.insert("delve");
            }
            "pvp" => {
                picked.insert("pvp");
            }
            "profession" | "professions" => {
                picked.insert("profession");
            }
            _ => {}
        }
    }
    if picked.is_empty() {
        picked.insert("raid");
        picked.insert("dungeon");
        picked.insert("delve");
        picked.insert("pvp");
        picked.insert("profession");
    }
    let mut out: Vec<&'static str> = picked.into_iter().collect();
    out.sort_unstable();
    out
}

fn normalized_locked_trinket_slot(raw: &str) -> Option<&'static str> {
    match raw.trim().to_lowercase().as_str() {
        "trinket1" => Some("trinket1"),
        "trinket2" => Some("trinket2"),
        _ => None,
    }
}

fn append_fallback_trinkets_from_encounter_drops(
    merged_drop_trinkets: &mut Vec<Value>,
    active_spec_id: Option<u64>,
    source_scope: &str,
    ignore_spec_restrictions: bool,
    selected_role_pools: &HashSet<TrinketRolePool>,
) {
    let selected_sources = selected_heatmap_source_types(source_scope);
    let include_raid = selected_sources.contains(&"raid");
    let include_dungeon = selected_sources.contains(&"dungeon");
    if !include_raid && !include_dungeon {
        return;
    }

    let instances = crate::item_db::instances();
    let mut raid_dungeon_encounters: HashSet<i64> = HashSet::new();
    let mut encounter_is_dungeon: HashMap<i64, bool> = HashMap::new();
    let mplus_ids = mplus_rotation_instance_ids();
    for inst in instances {
        let itype = inst.get("type").and_then(|v| v.as_str()).unwrap_or("");
        if itype != "raid" && itype != "dungeon" {
            continue;
        }
        if itype == "raid" && !include_raid {
            continue;
        }
        if itype == "dungeon" && !include_dungeon {
            continue;
        }
        if let Some(encs) = inst.get("encounters").and_then(|v| v.as_array()) {
            for enc in encs {
                if let Some(eid) = enc.get("id").and_then(|v| v.as_i64()) {
                    raid_dungeon_encounters.insert(eid);
                    encounter_is_dungeon.insert(eid, itype == "dungeon");
                }
            }
        }
    }

    let mut seen_item_ids: HashSet<u64> = merged_drop_trinkets
        .iter()
        .filter_map(|v| v.get("item_id").and_then(|id| id.as_u64()))
        .collect();

    let drops_by_encounter = crate::item_db::drops_by_encounter();
    for eid in raid_dungeon_encounters {
        let Some(items) = drops_by_encounter.get(&eid) else {
            continue;
        };
        for item in items {
            if item.inventory_type.unwrap_or(0) != 12 {
                continue;
            }
            if encounter_is_dungeon.get(&eid).copied().unwrap_or(false)
                && !item_has_mplus_rotation_source(item, &mplus_ids)
            {
                continue;
            }
            if !seen_item_ids.insert(item.id) {
                continue;
            }
            let specs = item.restriction_ids();
            if !item_specs_match_active_spec(&specs, active_spec_id, ignore_spec_restrictions) {
                continue;
            }
            if !item_specs_match_role_pools(&specs, selected_role_pools) {
                continue;
            }
            merged_drop_trinkets.push(json!({
                "item_id": item.id,
                "name": item.name,
                "icon": item.icon,
                "quality": item.quality,
                "ilevel": item.base_ilevel.unwrap_or(0),
                "specs": specs,
            }));
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn build_heatmap_profileset_input(
    simc_input: &str,
    class_name: &str,
    include_trinket_matrix: bool,
    include_tier_matrix: bool,
    heatmap_target_ilevel: i64,
    heatmap_trinket_sources: &str,
    heatmap_lock_trinket_slot: &str,
    heatmap_role_pools: &str,
    heatmap_ignore_spec_restrictions: bool,
) -> MatrixBuildResult {
    let parse_result = addon_parser::parse_simc_input(simc_input);
    let base_profile = parse_result.base_profile.clone();
    let resolved = gear_resolver::resolve_gear(&parse_result);

    let mut spec_name = parse_result
        .character
        .spec
        .as_deref()
        .unwrap_or_default()
        .to_string();
    if spec_name.is_empty() {
        spec_name = crate::types::class_data::detect_spec(simc_input).unwrap_or_default();
    }

    let (base_lines, equipped_gear, talents, _spec) =
        crate::profileset_generator::parser::parse_base_profile(&base_profile);

    let mut lines: Vec<String> = Vec::new();
    let mut combo_metadata: ComboMetadata = HashMap::new();

    lines.push("# Base Actor".to_string());
    lines.extend(base_lines);
    // Heatmap baseline must be the actual equipped setup from the input profile.
    // This keeps matrix deltas aligned with Top Gear expectations.
    for slot in crate::types::class_data::GEAR_SLOTS {
        if let Some(gear) = equipped_gear.get(*slot) {
            lines.push(format!("{}={}", slot, gear));
        } else if *slot == "off_hand" {
            lines.push("off_hand=,".to_string());
        }
    }
    if !talents.is_empty() {
        lines.push(format!("talents={}", talents));
    }
    lines.push(String::new());

    let mut combo_index: usize = 2;

    let target_ilevel = if heatmap_target_ilevel > 0 {
        heatmap_target_ilevel
    } else {
        289
    };

    // ---------- Trinket matrix ----------
    if include_trinket_matrix {
        let mut trinket_variants: Vec<HeatmapTrinketVariant> = Vec::new();
        let mut seen_variant = HashSet::new();

        let mut merged_drop_trinkets: Vec<Value> = Vec::new();
        let class_spec_ids = crate::types::class_data::class_spec_ids(class_name, None);
        let spec_from_name = resolve_active_spec_id(class_name, &spec_name);
        let spec_from_talents =
            crate::profileset_generator::parser::extract_spec_id_from_talent_string(&talents)
                .filter(|sid| class_spec_ids.contains(sid));
        let active_spec_id = spec_from_name.or(spec_from_talents);
        if active_spec_id.is_none() {
            return Err(
                "Could not resolve active spec ID from SimC input; cannot safely filter trinkets."
                    .to_string(),
            );
        }
        let selected_role_pools = selected_heatmap_role_pools(heatmap_role_pools, active_spec_id);

        for source in selected_heatmap_source_types(heatmap_trinket_sources) {
            if let Some(drops) = game_data::get_drops_by_type(source, Some(class_name), None) {
                if let Some(arr) = drops.get("Trinket").and_then(|v| v.as_array()) {
                    for v in arr {
                        merged_drop_trinkets.push(v.clone());
                    }
                }
            }
        }
        append_fallback_trinkets_from_encounter_drops(
            &mut merged_drop_trinkets,
            active_spec_id,
            heatmap_trinket_sources,
            heatmap_ignore_spec_restrictions,
            &selected_role_pools,
        );

        let mut drop_specs_by_item: HashMap<u64, Vec<u64>> = HashMap::new();
        for trinket in &merged_drop_trinkets {
            let item_id = trinket.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
            if item_id == 0 {
                continue;
            }
            let Some(specs_arr) = trinket.get("specs").and_then(|v| v.as_array()) else {
                continue;
            };
            let parsed_specs: Vec<u64> = specs_arr.iter().filter_map(|v| v.as_u64()).collect();
            if parsed_specs.len() != specs_arr.len() {
                continue;
            }
            let entry = drop_specs_by_item.entry(item_id).or_default();
            for spec_id in parsed_specs {
                if !entry.contains(&spec_id) {
                    entry.push(spec_id);
                }
            }
        }

        if cfg!(debug_assertions) {
            let eligible_drop_count = merged_drop_trinkets
                .iter()
                .filter(|t| {
                    trinket_json_matches_active_spec(
                        t,
                        active_spec_id,
                        heatmap_ignore_spec_restrictions,
                        &selected_role_pools,
                    )
                })
                .count();
            println!(
                "[heatmap] class={} spec={} active_spec_id={:?} merged_drops={} eligible_drops={}",
                class_name,
                spec_name,
                active_spec_id,
                merged_drop_trinkets.len(),
                eligible_drop_count
            );
        }

        let mut add_variant = |item: crate::types::ResolvedItem| {
            if item.item_id == 0 || item.ilevel <= 0 {
                return;
            }
            if !item_id_matches_active_spec_with_lookup(
                item.item_id,
                active_spec_id,
                &drop_specs_by_item,
                heatmap_ignore_spec_restrictions,
                &selected_role_pools,
            ) {
                return;
            }
            let bonus_key = if item.bonus_ids.is_empty() {
                "0".to_string()
            } else {
                item.bonus_ids
                    .iter()
                    .map(|b| b.to_string())
                    .collect::<Vec<_>>()
                    .join("-")
            };
            let key = format!("{}:{}:{}", item.item_id, item.ilevel, bonus_key);
            if !seen_variant.insert(key) {
                return;
            }
            trinket_variants.push(HeatmapTrinketVariant {
                label: format!("{} ({})", item.name, item.ilevel),
                item,
            });
        };

        // Intentionally do NOT inject owned/equipped trinkets into this pool.
        // Upgrade Trinkets should reflect the selected drop-source pool only.

        for trinket in merged_drop_trinkets {
            if !trinket_json_matches_active_spec(
                &trinket,
                active_spec_id,
                heatmap_ignore_spec_restrictions,
                &selected_role_pools,
            ) {
                continue;
            }
            let item_id = trinket.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
            if item_id == 0 {
                continue;
            }
            let item_name = trinket
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown Trinket")
                .to_string();
            let item_icon = trinket
                .get("icon")
                .and_then(|v| v.as_str())
                .unwrap_or("inv_misc_questionmark")
                .to_string();
            let source_type = trinket
                .get("source_type")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_lowercase();
            let mut item_quality = trinket.get("quality").and_then(|v| v.as_i64()).unwrap_or(4);
            if source_type.contains("profession") {
                item_quality = 5;
            }
            let is_mplus_rotation = trinket
                .get("mplus_rotation")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            if (source_type == "dungeon" || source_type == "expansion-dungeon")
                && !is_mplus_rotation
            {
                continue;
            }
            let instance_name = trinket
                .get("instance_name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_lowercase();
            let is_world_boss_source = instance_name.contains("world boss")
                || source_type == "world_boss"
                || source_type == "world-boss";

            let difficulty_info = trinket.get("difficulty_info").and_then(|v| v.as_object());
            let dungeon_info = trinket.get("dungeon_info").and_then(|v| v.as_object());
            let mut added_for_item = false;
            let mut add_from_entry = |entry: &serde_json::Map<String, Value>| {
                let ilvl = entry.get("ilvl").and_then(|v| v.as_i64()).unwrap_or(0);
                let bonus_id = entry.get("bonus_id").and_then(|v| v.as_u64()).unwrap_or(0);
                if ilvl <= 0 {
                    return;
                }
                let entry_quality = entry.get("quality").and_then(|v| v.as_i64()).unwrap_or(item_quality);
                let item = make_resolved_item(
                    "trinket",
                    item_id,
                    ResolvedItemSeed {
                        name: item_name.clone(),
                        icon: item_icon.clone(),
                        quality: entry_quality,
                        ilevel: ilvl,
                        bonus_ids: if bonus_id > 0 { vec![bonus_id] } else { vec![] },
                    },
                    crate::types::ItemOrigin::Bags,
                    12,
                );
                add_variant(item);

                // Also add a "max-upgraded" variant for this drop bonus when applicable.
                // World boss drops are intentionally capped and should not be promoted.
                if bonus_id > 0 && !is_world_boss_source {
                    let max_bonus = crate::item_db::upgrade_bonus_ids_to_max(&[bonus_id]);
                    if max_bonus.len() == 1 && max_bonus[0] != bonus_id {
                        let max_ilvl = crate::item_db::get_item_info(item_id, Some(&max_bonus))
                            .map(|i| i.ilevel)
                            .unwrap_or(ilvl);
                        let upgraded = make_resolved_item(
                            "trinket",
                            item_id,
                            ResolvedItemSeed {
                                name: item_name.clone(),
                                icon: item_icon.clone(),
                                quality: item_quality,
                                ilevel: max_ilvl,
                                bonus_ids: max_bonus,
                            },
                            crate::types::ItemOrigin::Bags,
                            12,
                        );
                        add_variant(upgraded);
                    }
                }
                added_for_item = true;
            };

            if let Some(diff_obj) = difficulty_info {
                for diff_key in ["lfr", "normal", "heroic", "mythic"] {
                    let Some(entry) = diff_obj.get(diff_key).and_then(|v| v.as_object()) else {
                        continue;
                    };
                    add_from_entry(entry);
                }
            }
            if let Some(dungeon_obj) = dungeon_info {
                let mut entries: Vec<&serde_json::Map<String, Value>> =
                    dungeon_obj.values().filter_map(|v| v.as_object()).collect();
                entries
                    .sort_by_key(|entry| entry.get("ilvl").and_then(|v| v.as_i64()).unwrap_or(0));
                for entry in entries {
                    add_from_entry(entry);
                }
            }

            if !added_for_item {
                let ilvl = trinket.get("ilevel").and_then(|v| v.as_i64()).unwrap_or(0);
                if ilvl <= 0 {
                    continue;
                }
                let item = make_resolved_item(
                    "trinket",
                    item_id,
                    ResolvedItemSeed {
                        name: item_name.clone(),
                        icon: item_icon.clone(),
                        quality: item_quality,
                        ilevel: ilvl,
                        bonus_ids: vec![],
                    },
                    crate::types::ItemOrigin::Bags,
                    12,
                );
                add_variant(item);
            }
        }

        // Hard safety pass: nothing reaches SimC unless it matches the active spec.
        let pre_retain_count = trinket_variants.len();
        trinket_variants.retain(|variant| {
            item_id_matches_active_spec_with_lookup(
                variant.item.item_id,
                active_spec_id,
                &drop_specs_by_item,
                heatmap_ignore_spec_restrictions,
                &selected_role_pools,
            )
        });
        if cfg!(debug_assertions) {
            println!(
                "[heatmap] variants_pre_retain={} variants_post_retain={}",
                pre_retain_count,
                trinket_variants.len()
            );
        }

        // Keep one variant per item ID based on target ilvl.
        // Rule: use exact target ilvl when available;
        // else use highest available <= target;
        // else use lowest available > target.
        let mut best_by_item: HashMap<u64, HeatmapTrinketVariant> = HashMap::new();
        for variant in trinket_variants.drain(..) {
            let item_id = variant.item.item_id;
            match best_by_item.get(&item_id) {
                None => {
                    best_by_item.insert(item_id, variant);
                }
                Some(current) => {
                    let cand_ilvl = variant.item.ilevel;
                    let curr_ilvl = current.item.ilevel;

                    let cand_exact = cand_ilvl == target_ilevel;
                    let curr_exact = curr_ilvl == target_ilevel;
                    let cand_under = cand_ilvl <= target_ilevel;
                    let curr_under = curr_ilvl <= target_ilevel;

                    let pick_candidate = if cand_exact != curr_exact {
                        cand_exact
                    } else if cand_under != curr_under {
                        cand_under
                    } else if cand_under {
                        // both <= target: prefer higher ilvl
                        cand_ilvl > curr_ilvl
                    } else {
                        // both > target: prefer lower ilvl
                        cand_ilvl < curr_ilvl
                    };
                    if pick_candidate {
                        best_by_item.insert(item_id, variant);
                    }
                }
            }
        }
        trinket_variants = best_by_item.into_values().collect();

        // Respect the requested target ilvl as an upper bound whenever possible.
        // If we can still build a valid matrix with capped variants, drop entries above target.
        if target_ilevel > 0 {
            let capped: Vec<HeatmapTrinketVariant> = trinket_variants
                .iter()
                .filter(|v| v.item.ilevel <= target_ilevel)
                .cloned()
                .collect();
            if capped.len() >= 2 {
                trinket_variants = capped;
            }
        }

        let locked_slot = normalized_locked_trinket_slot(heatmap_lock_trinket_slot);

        if (locked_slot.is_none() && trinket_variants.len() < 2)
            || (locked_slot.is_some() && trinket_variants.is_empty())
        {
            return Err(
                "Not enough trinket variants were found for a heatmap with this character input."
                    .to_string(),
            );
        }

        trinket_variants.sort_by(|a, b| {
            b.item
                .ilevel
                .cmp(&a.item.ilevel)
                .then_with(|| a.item.name.cmp(&b.item.name))
        });
        trinket_variants.truncate(24);

        if let Some(slot) = locked_slot {
            let Some(fixed_item) = resolved
                .slots
                .get(slot)
                .and_then(|slot_res| slot_res.equipped.clone())
            else {
                return Err(format!(
                    "Could not resolve equipped {} for locked-slot trinket simulation.",
                    slot
                ));
            };
            let fixed = HeatmapTrinketVariant {
                label: format!("{} ({})", fixed_item.name, fixed_item.ilevel),
                item: fixed_item,
            };

            for cand in &trinket_variants {
                if cand.item.item_id == fixed.item.item_id {
                    continue;
                }

                let (t1, t2) = if slot == "trinket1" {
                    (&fixed, cand)
                } else {
                    (cand, &fixed)
                };

                let combo_name = format!(
                    "Heatmap Trinket {} | {} + {}",
                    combo_index - 1,
                    t1.label,
                    t2.label
                );
                lines.push(format!("### {}", combo_name));
                lines.push(format!(
                    "profileset.\"{}\"+=trinket1={}",
                    combo_name, t1.item.simc_string
                ));
                lines.push(format!(
                    "profileset.\"{}\"+=trinket2={}",
                    combo_name, t2.item.simc_string
                ));
                if !talents.is_empty() {
                    lines.push(format!(
                        "profileset.\"{}\"+=talents={}",
                        combo_name, talents
                    ));
                }
                lines.push(String::new());

                combo_metadata.insert(
                    combo_name.clone(),
                    vec![
                        crate::profileset_generator::writer::item_meta(&t1.item, "trinket1"),
                        crate::profileset_generator::writer::item_meta(&t2.item, "trinket2"),
                        json!({"heatmap_kind":"trinket"}),
                    ],
                );
                combo_index += 1;
            }
        } else {
            for i in 0..trinket_variants.len() {
                for j in (i + 1)..trinket_variants.len() {
                    let t1 = &trinket_variants[i];
                    let t2 = &trinket_variants[j];
                    let combo_name = format!(
                        "Heatmap Trinket {} | {} + {}",
                        combo_index - 1,
                        t1.label,
                        t2.label
                    );
                    lines.push(format!("### {}", combo_name));
                    lines.push(format!(
                        "profileset.\"{}\"+=trinket1={}",
                        combo_name, t1.item.simc_string
                    ));
                    lines.push(format!(
                        "profileset.\"{}\"+=trinket2={}",
                        combo_name, t2.item.simc_string
                    ));
                    if !talents.is_empty() {
                        lines.push(format!(
                            "profileset.\"{}\"+=talents={}",
                            combo_name, talents
                        ));
                    }
                    lines.push(String::new());

                    combo_metadata.insert(
                        combo_name.clone(),
                        vec![
                            crate::profileset_generator::writer::item_meta(&t1.item, "trinket1"),
                            crate::profileset_generator::writer::item_meta(&t2.item, "trinket2"),
                            json!({"heatmap_kind":"trinket"}),
                        ],
                    );
                    combo_index += 1;
                }
            }
        }
    }

    // ---------- Tier set matrix ----------
    if include_tier_matrix {
        let class_id = crate::types::class_data::class_wow_id(class_name).unwrap_or(0);
        if class_id > 0 {
            let tier_slots = ["head", "shoulder", "chest", "hands", "legs"];
            let mut tier_options: Vec<(String, crate::types::ResolvedItem)> = Vec::new();

            for slot in tier_slots {
                let Some(slot_res) = resolved.slots.get(slot) else {
                    continue;
                };
                let Some(equipped) = slot_res.equipped.as_ref() else {
                    continue;
                };
                let inv_type = gear_resolver::slot_to_inv_type(slot).unwrap_or(0);
                if inv_type == 0 {
                    continue;
                }
                let Some(tier_info) = crate::item_db::catalyst_tier_item(class_id, inv_type) else {
                    continue;
                };
                let mut converted = gear_resolver::build_catalyst_item(equipped, &tier_info, slot);
                converted.origin = crate::types::ItemOrigin::Bags;
                if converted.item_id == 0 || converted.simc_string.is_empty() {
                    continue;
                }
                tier_options.push((slot.to_string(), converted));
            }

            let n = tier_options.len();
            if n > 0 {
                for mask in 1..(1usize << n) {
                    if combo_index > 320 {
                        break;
                    }
                    let mut changed_meta: Vec<Value> = Vec::new();
                    let mut changed_slots: Vec<String> = Vec::new();
                    let piece_count = mask.count_ones();
                    let combo_name = format!("Heatmap Tier {} | {}p", combo_index - 1, piece_count);
                    lines.push(format!("### {}", combo_name));

                    for (idx, (slot, item)) in tier_options.iter().enumerate() {
                        if (mask & (1usize << idx)) == 0 {
                            continue;
                        }
                        changed_slots.push(slot.clone());
                        lines.push(format!(
                            "profileset.\"{}\"+={}={}",
                            combo_name, slot, item.simc_string
                        ));
                        changed_meta
                            .push(crate::profileset_generator::writer::item_meta(item, slot));
                    }
                    if !talents.is_empty() {
                        lines.push(format!(
                            "profileset.\"{}\"+=talents={}",
                            combo_name, talents
                        ));
                    }
                    lines.push(String::new());

                    changed_meta.push(json!({
                        "heatmap_kind":"tier",
                        "tier_pieces": piece_count,
                        "tier_slots": changed_slots,
                    }));
                    combo_metadata.insert(combo_name.clone(), changed_meta);
                    combo_index += 1;
                }
            }
        }
    }

    let combo_count = combo_index.saturating_sub(2);
    if combo_count == 0 {
        return Err("No heatmap combinations could be generated for this character.".to_string());
    }

    Ok((lines.join("\n"), combo_count, combo_metadata))
}

async fn create_trinket_tier_heatmap_sim(
    simc_input: String,
    class_name: String,
    matrix_flags: (bool, bool),
    options: &SimOptions,
    store: web::Data<Arc<dyn JobStorage>>,
    simc_path: web::Data<PathBuf>,
    log_buffer: web::Data<Arc<LogBuffer>>,
) -> HttpResponse {
    let (include_trinket_matrix, include_tier_matrix) = matrix_flags;
    if !include_trinket_matrix && !include_tier_matrix {
        return HttpResponse::BadRequest().json(json!({
            "detail": "Enable at least one matrix option (Trinkets or Tier Sets)."
        }));
    }
    let (generated_input, combo_count, combo_metadata) = match build_heatmap_profileset_input(
        &simc_input,
        &class_name,
        include_trinket_matrix,
        include_tier_matrix,
        options.heatmap_target_ilevel,
        &options.heatmap_trinket_sources,
        &options.heatmap_lock_trinket_slot,
        &options.heatmap_role_pools,
        options.heatmap_ignore_spec_restrictions,
    ) {
        Ok(v) => v,
        Err(detail) => return HttpResponse::BadRequest().json(json!({ "detail": detail })),
    };

    let mut generated_input = inject_expert_fields(&generated_input, options);
    generated_input = apply_shared_simc_options(&generated_input, options, true);

    let resolved_threads = if options.threads == 0 {
        std::thread::available_parallelism()
            .map(|n| n.get() as u32)
            .unwrap_or(4)
    } else {
        options.threads
    };
    generated_input.push_str(&format!("\nthreads={}\n", resolved_threads));

    if let Some(resp) = validate_batch(&options.batch_id, store.get_ref().as_ref()) {
        return resp;
    }

    let mut job = Job::new(
        generated_input.clone(),
        "trinket_tier_heatmap".to_string(),
        options.iterations,
        options.fight_style.clone(),
        options.target_error,
    );
    job.options = Some(options.to_json_with_sim_type("trinket_tier_heatmap"));
    job.batch_id = options.batch_id.clone();
    let job_id = job.id.clone();
    let created_at = job.created_at.clone();

    let meta_json = serde_json::to_string(&json!({
        "_combo_metadata": combo_metadata,
        "_combo_count": combo_count,
    }))
    .unwrap_or_default();
    job.combo_metadata_json = Some(meta_json);
    store.insert(job);

    let simc_binary = match resolve_simc_binary_for_request(simc_path.get_ref(), options) {
        Ok(path) => path,
        Err(detail) => return HttpResponse::BadRequest().json(json!({ "detail": detail })),
    };

    spawn_staged_sim(
        store.get_ref().clone(),
        simc_binary,
        options.to_json_with_sim_type("trinket_tier_heatmap"),
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

async fn create_external_buff_matrix_sim(
    simc_input: String,
    options: &SimOptions,
    store: web::Data<Arc<dyn JobStorage>>,
    simc_path: web::Data<PathBuf>,
    log_buffer: web::Data<Arc<LogBuffer>>,
) -> HttpResponse {
    let (generated_input, combo_count, combo_metadata) =
        match build_external_buff_matrix_input(&simc_input, options) {
            Ok(v) => v,
            Err(detail) => return HttpResponse::BadRequest().json(json!({ "detail": detail })),
        };

    let mut generated_input = inject_expert_fields(&generated_input, options);
    generated_input = apply_shared_simc_options(&generated_input, options, false);
    let resolved_threads = if options.threads == 0 {
        std::thread::available_parallelism()
            .map(|n| n.get() as u32)
            .unwrap_or(4)
    } else {
        options.threads
    };
    generated_input.push_str(&format!("\nthreads={}\n", resolved_threads));

    if let Some(resp) = validate_batch(&options.batch_id, store.get_ref().as_ref()) {
        return resp;
    }

    let mut job = Job::new(
        generated_input.clone(),
        "external_buff_matrix".to_string(),
        options.iterations,
        options.fight_style.clone(),
        options.target_error,
    );
    job.options = Some(options.to_json_with_sim_type("external_buff_matrix"));
    job.batch_id = options.batch_id.clone();
    let job_id = job.id.clone();
    let created_at = job.created_at.clone();

    let meta_json = serde_json::to_string(&json!({
        "_combo_metadata": combo_metadata,
        "_combo_count": combo_count,
    }))
    .unwrap_or_default();
    job.combo_metadata_json = Some(meta_json);
    store.insert(job);

    let simc_binary = match resolve_simc_binary_for_request(simc_path.get_ref(), options) {
        Ok(path) => path,
        Err(detail) => return HttpResponse::BadRequest().json(json!({ "detail": detail })),
    };

    spawn_staged_sim(
        store.get_ref().clone(),
        simc_binary,
        options.to_json_with_sim_type("external_buff_matrix"),
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

async fn create_consumable_matrix_sim(
    simc_input: String,
    options: &SimOptions,
    store: web::Data<Arc<dyn JobStorage>>,
    simc_path: web::Data<PathBuf>,
    log_buffer: web::Data<Arc<LogBuffer>>,
) -> HttpResponse {
    let (generated_input, combo_count, combo_metadata) =
        match build_consumable_matrix_input(&simc_input, options) {
            Ok(v) => v,
            Err(detail) => return HttpResponse::BadRequest().json(json!({ "detail": detail })),
        };

    let mut generated_input = inject_expert_fields(&generated_input, options);
    let resolved_threads = if options.threads == 0 {
        std::thread::available_parallelism()
            .map(|n| n.get() as u32)
            .unwrap_or(4)
    } else {
        options.threads
    };
    generated_input.push_str(&format!("\nthreads={}\n", resolved_threads));

    if let Some(resp) = validate_batch(&options.batch_id, store.get_ref().as_ref()) {
        return resp;
    }

    let mut job = Job::new(
        generated_input.clone(),
        "consumable_matrix".to_string(),
        options.iterations,
        options.fight_style.clone(),
        options.target_error,
    );
    job.options = Some(options.to_json_with_sim_type("consumable_matrix"));
    job.batch_id = options.batch_id.clone();
    let job_id = job.id.clone();
    let created_at = job.created_at.clone();

    let meta_json = serde_json::to_string(&json!({
        "_combo_metadata": combo_metadata,
        "_combo_count": combo_count,
    }))
    .unwrap_or_default();
    job.combo_metadata_json = Some(meta_json);
    store.insert(job);

    let simc_binary = match resolve_simc_binary_for_request(simc_path.get_ref(), options) {
        Ok(path) => path,
        Err(detail) => return HttpResponse::BadRequest().json(json!({ "detail": detail })),
    };

    spawn_staged_sim(
        store.get_ref().clone(),
        simc_binary,
        options.to_json_with_sim_type("consumable_matrix"),
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

pub(super) async fn create_top_gear_sim(
    req: web::Json<TopGearRequest>,
    store: web::Data<Arc<dyn JobStorage>>,
    simc_path: web::Data<PathBuf>,
    log_buffer: web::Data<Arc<LogBuffer>>,
) -> HttpResponse {
    let mut simc_input = if req.max_upgrade {
        game_data::upgrade_simc_input(&req.simc_input)
    } else {
        req.simc_input.clone()
    };

    if crate::types::class_data::detect_class(&simc_input).is_none() {
        return HttpResponse::BadRequest().json(json!({
            "detail": "Could not detect character class from SimC input. Ensure the input starts with a character name line (e.g. warrior=\"Name\")."
        }));
    }

    simc_input = apply_spec_override(
        &apply_talent_override(&simc_input, &req.options.talents),
        &req.options.spec_override,
    );
    simc_input = crate::talent_normalize::normalize_simc_talents(&simc_input);

    let parse_result = addon_parser::parse_simc_input(&simc_input);

    // Always resolve catalyst charges — needed for constraints even with per-item converts
    let currency_id_sim = crate::item_db::catalyst_currency_id();
    let catalyst_charges = req
        .catalyst_charges
        .or_else(|| crate::addon_parser::parse_catalyst_charges(&req.simc_input, currency_id_sim));

    // Always resolve with catalyst when charges exist so items get the is_catalyst flag
    let resolved = if req.catalyst || catalyst_charges.is_some() {
        gear_resolver::resolve_gear_with_catalyst(&parse_result, catalyst_charges)
    } else {
        gear_resolver::resolve_gear(&parse_result)
    };
    let base_profile = resolved.base_profile.clone();

    let mut items_by_slot: HashMap<String, Vec<crate::types::ResolvedItem>> =
        if let Some(ref ibs) = req.items_by_slot {
            ibs.clone()
        } else {
            resolve_to_items_by_slot(&resolved)
        };

    if req.max_upgrade {
        items_by_slot = game_data::upgrade_items_by_slot(items_by_slot);
    }

    if req.copy_enchants {
        items_by_slot = game_data::apply_copy_enchants_to_map(items_by_slot);
    }

    // Build talent builds list: normalize each talent string
    let talent_builds: Vec<(String, String)> = req
        .talent_builds
        .iter()
        .map(|tb| {
            let normalized = crate::talent_normalize::normalize_simc_talents(&format!(
                "talents={}",
                tb.talent_string
            ));
            let ts = normalized
                .strip_prefix("talents=")
                .unwrap_or(&tb.talent_string)
                .to_string();
            (tb.name.clone(), ts)
        })
        .collect();

    let (generated_input, combo_count, combo_metadata) =
        match profileset_generator::generate_top_gear_input_with_talents(
            &base_profile,
            &items_by_slot,
            &req.selected_items,
            req.max_combinations,
            &talent_builds,
            catalyst_charges,
        ) {
            Ok(r) => r,
            Err(e) => {
                return HttpResponse::BadRequest().json(json!({"detail": e.to_string()}));
            }
        };

    if combo_count == 0 && req.talent_builds.len() <= 1 {
        return HttpResponse::BadRequest().json(json!({
            "detail": "No alternative items selected. Select at least one non-equipped item or multiple talent builds."
        }));
    }

    let mut generated_input = inject_expert_fields(&generated_input, &req.options);
    generated_input = apply_shared_simc_options(&generated_input, &req.options, true);

    let resolved_threads = if req.options.threads == 0 {
        std::thread::available_parallelism()
            .map(|n| n.get() as u32)
            .unwrap_or(4)
    } else {
        req.options.threads
    };
    generated_input.push_str(&format!("\nthreads={}\n", resolved_threads));

    if let Some(resp) = validate_batch(&req.options.batch_id, store.get_ref().as_ref()) {
        return resp;
    }

    let mut job = Job::new(
        generated_input.clone(),
        "top_gear".to_string(),
        req.options.iterations,
        req.options.fight_style.clone(),
        req.options.target_error,
    );
    job.options = Some(req.options.to_json_with_sim_type("top_gear"));
    let job_id = job.id.clone();
    let created_at = job.created_at.clone();

    // Store combo metadata on the job
    let meta_json = serde_json::to_string(&json!({
        "_combo_metadata": combo_metadata,
        "_combo_count": combo_count,
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

pub(super) async fn get_top_gear_combo_count(req: web::Json<TopGearRequest>) -> HttpResponse {
    let mut simc_input = if req.max_upgrade {
        game_data::upgrade_simc_input(&req.simc_input)
    } else {
        req.simc_input.clone()
    };
    simc_input = apply_spec_override(
        &apply_talent_override(&simc_input, &req.options.talents),
        &req.options.spec_override,
    );
    simc_input = crate::talent_normalize::normalize_simc_talents(&simc_input);

    let parse_result = addon_parser::parse_simc_input(&simc_input);

    // Always resolve catalyst charges — needed for constraints even with per-item converts
    let currency_id = crate::item_db::catalyst_currency_id();
    let catalyst_charges = req
        .catalyst_charges
        .or_else(|| crate::addon_parser::parse_catalyst_charges(&req.simc_input, currency_id));

    // Always resolve with catalyst when charges exist so items get the is_catalyst flag
    let resolved = if req.catalyst || catalyst_charges.is_some() {
        gear_resolver::resolve_gear_with_catalyst(&parse_result, catalyst_charges)
    } else {
        gear_resolver::resolve_gear(&parse_result)
    };
    let base_profile = resolved.base_profile.clone();

    let mut items_by_slot: HashMap<String, Vec<crate::types::ResolvedItem>> =
        if let Some(ref ibs) = req.items_by_slot {
            ibs.clone()
        } else {
            resolve_to_items_by_slot(&resolved)
        };

    if req.max_upgrade {
        items_by_slot = game_data::upgrade_items_by_slot(items_by_slot);
    }
    if req.copy_enchants {
        items_by_slot = game_data::apply_copy_enchants_to_map(items_by_slot);
    }

    let talent_builds: Vec<(String, String)> = req
        .talent_builds
        .iter()
        .map(|tb| {
            let normalized = crate::talent_normalize::normalize_simc_talents(&format!(
                "talents={}",
                tb.talent_string
            ));
            let ts = normalized
                .strip_prefix("talents=")
                .unwrap_or(&tb.talent_string)
                .to_string();
            (tb.name.clone(), ts)
        })
        .collect();

    match profileset_generator::generate_top_gear_input_with_talents(
        &base_profile,
        &items_by_slot,
        &req.selected_items,
        req.max_combinations,
        &talent_builds,
        catalyst_charges,
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

pub(super) async fn create_droptimizer_sim(
    req: web::Json<DroptimizerRequest>,
    store: web::Data<Arc<dyn JobStorage>>,
    simc_path: web::Data<PathBuf>,
    log_buffer: web::Data<Arc<LogBuffer>>,
) -> HttpResponse {
    let simc_input = apply_spec_override(
        &apply_talent_override(&req.simc_input, &req.options.talents),
        &req.options.spec_override,
    );
    let simc_input = crate::talent_normalize::normalize_simc_talents(&simc_input);
    let parse_result = addon_parser::parse_simc_input(&simc_input);
    let base_profile = parse_result.base_profile.clone();

    let (generated_input, combo_count, combo_metadata) = profileset_generator::generate_droptimizer_input(
        &base_profile,
        &req.drop_items,
        req.copy_enchants,
    );

    if combo_count == 0 {
        return HttpResponse::BadRequest().json(json!({
            "detail": "No items selected. Select at least one drop item."
        }));
    }

    let mut generated_input = inject_expert_fields(&generated_input, &req.options);
    generated_input = apply_shared_simc_options(&generated_input, &req.options, true);

    let resolved_threads = if req.options.threads == 0 {
        std::thread::available_parallelism()
            .map(|n| n.get() as u32)
            .unwrap_or(4)
    } else {
        req.options.threads
    };
    generated_input.push_str(&format!("\nthreads={}\n", resolved_threads));

    if let Some(resp) = validate_batch(&req.options.batch_id, store.get_ref().as_ref()) {
        return resp;
    }

    let mut job = Job::new(
        generated_input.clone(),
        "droptimizer".to_string(),
        req.options.iterations,
        req.options.fight_style.clone(),
        req.options.target_error,
    );
    job.options = Some(req.options.to_json_with_sim_type("droptimizer"));
    let job_id = job.id.clone();
    let created_at = job.created_at.clone();

    let meta_json = serde_json::to_string(&json!({
        "_combo_metadata": combo_metadata,
        "_combo_count": combo_count,
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
