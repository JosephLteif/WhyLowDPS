use serde_json::{json, Value};
use std::collections::HashMap;
use once_cell::sync::Lazy;

use crate::error::Result;
use crate::types::ResolvedItem;

pub mod parser;
pub mod combinator;
pub mod writer;

type ProfilesetResult = Result<(String, usize, HashMap<String, Vec<Value>>)>;

pub static MAX_COMBINATIONS: Lazy<usize> = Lazy::new(|| {
    if let Ok(val) = std::env::var("MAX_COMBINATIONS") {
        if let Ok(n) = val.parse() {
            return n;
        }
    }
    500
});

pub fn generate_top_gear_input(
    base_profile: &str,
    items_by_slot: &HashMap<String, Vec<ResolvedItem>>,
    selected_items: &HashMap<String, Vec<String>>,
    max_combos_override: Option<usize>,
) -> ProfilesetResult {
    generate_top_gear_input_with_talents(base_profile, items_by_slot, selected_items, max_combos_override, &[], None)
}

pub fn generate_top_gear_input_with_talents(
    base_profile: &str,
    items_by_slot: &HashMap<String, Vec<ResolvedItem>>,
    selected_items: &HashMap<String, Vec<String>>,
    max_combos_override: Option<usize>,
    talent_builds: &[(String, String)],
    catalyst_charges: Option<u32>,
) -> ProfilesetResult {
    let (base_lines, equipped_gear, talents_string, spec) = parser::parse_base_profile(base_profile);
    let slot_item_lists = combinator::build_slot_candidates(base_profile, items_by_slot, selected_items);
    let varying_slots = get_varying_slots(&slot_item_lists);

    if varying_slots.is_empty() && talent_builds.len() <= 1 {
        return Ok((base_profile.to_string(), 0, HashMap::new()));
    }

    let option_lists: Vec<&Vec<ResolvedItem>> = varying_slots.iter().map(|slot| slot_item_lists.get(slot).unwrap()).collect();
    let all_combos = combinator::generate_cartesian_product(&option_lists);
    let valid_combos = combinator::filter_valid_combos(&all_combos, &varying_slots, &option_lists, &slot_item_lists, &spec, catalyst_charges);

    let gear_combo_count = valid_combos.len();
    let effective_talents = get_effective_talents(talent_builds, &talents_string);
    let total_combo_count = calculate_total_combo_count(gear_combo_count, effective_talents.len());

    let limit = max_combos_override.unwrap_or(*MAX_COMBINATIONS);
    if total_combo_count > limit {
        return Err(crate::error::AppError::SimcError(format!(
            "Too many combinations ({}). Maximum is {}. Please deselect some items.",
            total_combo_count, limit
        )));
    }

    if gear_combo_count == 0 && effective_talents.len() <= 1 {
        return Ok((base_profile.to_string(), 0, HashMap::new()));
    }

    let mut lines = Vec::new();
    let mut combo_metadata = HashMap::new();

    let base_actor_spec = writer::write_base_actor(&mut lines, &mut combo_metadata, &base_lines, &equipped_gear, &effective_talents, &spec, &slot_item_lists);
    writer::write_all_profilesets(&mut lines, &mut combo_metadata, &valid_combos, &effective_talents, &equipped_gear, &slot_item_lists, &spec, &base_actor_spec);

    Ok((lines.join("\n"), total_combo_count, combo_metadata))
}

pub fn generate_droptimizer_input(base_profile: &str, drop_items: &[ResolvedItem]) -> (String, usize, HashMap<String, Value>) {
    let (base_lines, equipped_gear, talents, spec) = parser::parse_base_profile(base_profile);
    let mut lines = Vec::new();
    let mut combo_metadata = HashMap::new();

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
    if !talents.is_empty() { lines.push(format!("talents={}", talents)); }
    lines.push(String::new());

    let has_2h = {
        let oh = equipped_gear.get("off_hand").map(|s| s.trim());
        oh.is_none() || oh == Some("") || oh == Some(",")
    };

    let mut combo_idx = 2;
    for item in drop_items {
        let mut slots = crate::types::class_data::inv_type_to_slots(item.inventory_type, &spec);

        if has_2h && !(spec == "fury" && item.inventory_type == 17) {
            slots.retain(|s| *s != "off_hand");
        }

        if slots.is_empty() { continue; }

        for slot in &slots {
            let mut simc = item.simc_string.clone();
            if let Some(eq) = equipped_gear.get(*slot) {
                // Restore enchants from equipped gear
                if let Some(idx) = eq.find(",enchant_id=") {
                    simc.push_str(&eq[idx..]);
                }
            }

            let c_name = format!("Combo {}", combo_idx);
            lines.push(format!("### {}", c_name));
            lines.push(format!("profileset.\"{}\"+={}={}", c_name, slot, simc));
            if item.inventory_type == 17 && *slot == "main_hand" && spec != "fury" {
                lines.push(format!("profileset.\"{}\"+=off_hand=,", c_name));
            }
            if !talents.is_empty() { lines.push(format!("profileset.\"{}\"+=talents={}", c_name, talents)); }
            lines.push(String::new());

            combo_metadata.insert(c_name, json!([{"slot": slot, "item_id": item.item_id, "ilevel": item.ilevel, "name": item.name, "bonus_ids": item.bonus_ids, "enchant_id": 0, "gem_id": 0, "is_kept": false, "origin": "bags"}]));
            combo_idx += 1;
        }
    }

    (lines.join("\n"), combo_idx - 2, combo_metadata)
}

pub fn generate_upgrade_compare_input(
    base_profile: &str,
    upgraded_options_by_slot: &HashMap<String, Vec<ResolvedItem>>,
    upgrade_budget: &HashMap<u64, u64>,
    max_combos_override: Option<usize>,
) -> ProfilesetResult {
    let (base_lines, equipped_gear, talents_string, _spec) = parser::parse_base_profile(base_profile);
    let mut slots: Vec<String> = upgraded_options_by_slot.keys().filter(|s| !upgraded_options_by_slot[*s].is_empty()).cloned().collect();
    slots.sort();
    if slots.is_empty() { return Err(crate::error::AppError::SimcError("No upgradeable equipped items were selected.".to_string())); }

    let limit = max_combos_override.unwrap_or(*MAX_COMBINATIONS);

    // Filter out options without upgrade costs for DFS
    let mut options_with_costs = HashMap::new();
    for (slot, opts) in upgraded_options_by_slot {
        let opts_v: Vec<Value> = opts.iter().map(|o| serde_json::to_value(o).unwrap()).collect();
        options_with_costs.insert(slot.clone(), opts_v);
    }

    let mut ctx = combinator::UpgradeDfsCtx { 
        slots: &slots, 
        options: &options_with_costs, 
        budget: upgrade_budget, 
        limit, 
        best_spend: 0, 
        retained: Vec::new(), 
        spent: HashMap::new(), 
        current: Vec::new() 
    };
    ctx.dfs(0);

    let retained = ctx.retained;
    if retained.len() > limit {
        return Err(crate::error::AppError::SimcError(format!("Too many upgrade combinations ({}). Maximum is {}. Please deselect some items.", retained.len(), limit)));
    }

    let mut lines = Vec::new();
    let mut combo_metadata = HashMap::new();

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
    if !talents_string.is_empty() { lines.push(format!("talents={}", talents_string)); }
    lines.push(String::new());

    let mut combo_idx = 2;
    for combo in &retained {
        if combo.choices.iter().all(|(_, idx)| *idx == 0) { continue; }
        let c_name = format!("Combo {}", combo_idx);
        let mut items_meta = Vec::new();
        lines.push(format!("### {}", c_name));
        for (slot, c_idx) in &combo.choices {
            if *c_idx == 0 { continue; }
            let opt = &upgraded_options_by_slot[slot][*c_idx - 1];
            lines.push(format!("profileset.\"{}\"+={}={}", c_name, slot, opt.simc_string));
            
            let mut m = writer::item_meta(opt, slot);
            // Upgrade items are never "kept" in the sense of being currently equipped baseline
            m["is_kept"] = json!(false);
            // UpgradedItem usually has extra fields like upgrade_levels, but ResolvedItem doesn't have it natively.
            // We might need to handle this differently if it's crucial for the UI.
            items_meta.push(m);
        }
        if !talents_string.is_empty() { lines.push(format!("profileset.\"{}\"+=talents={}", c_name, talents_string)); }
        lines.push(String::new());
        combo_metadata.insert(c_name, items_meta);
        combo_idx += 1;
    }

    Ok((lines.join("\n"), combo_idx - 2, combo_metadata))
}

fn get_varying_slots(slot_item_lists: &HashMap<String, Vec<ResolvedItem>>) -> Vec<String> {
    let mut varying = slot_item_lists.iter().filter(|(_, items)| items.len() > 1).map(|(s, _)| s.clone()).collect::<Vec<_>>();
    varying.sort();
    varying
}

fn get_effective_talents(talent_builds: &[(String, String)], base_talents: &str) -> Vec<(String, String)> {
    if talent_builds.is_empty() {
        vec![("".to_string(), base_talents.to_string())]
    } else {
        talent_builds.iter().cloned().collect()
    }
}

fn calculate_total_combo_count(gear_combo_count: usize, talent_count: usize) -> usize {
    if talent_count > 1 {
        (gear_combo_count + 1) * talent_count - 1
    } else {
        gear_combo_count
    }
}

