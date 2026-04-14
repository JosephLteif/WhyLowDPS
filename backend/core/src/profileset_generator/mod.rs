use once_cell::sync::Lazy;
use serde_json::{json, Value};
use std::collections::HashMap;

use crate::error::Result;
use crate::types::ResolvedItem;

pub mod combinator;
pub mod parser;
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
    generate_top_gear_input_with_talents(
        base_profile,
        items_by_slot,
        selected_items,
        max_combos_override,
        &[],
        None,
    )
}

pub fn generate_top_gear_input_with_talents(
    base_profile: &str,
    items_by_slot: &HashMap<String, Vec<ResolvedItem>>,
    selected_items: &HashMap<String, Vec<String>>,
    max_combos_override: Option<usize>,
    talent_builds: &[(String, String)],
    catalyst_charges: Option<u32>,
) -> ProfilesetResult {
    let (base_lines, equipped_gear, talents_string, spec) =
        parser::parse_base_profile(base_profile);
    let slot_item_lists =
        combinator::build_slot_candidates(base_profile, items_by_slot, selected_items);
    let varying_slots = get_varying_slots(&slot_item_lists);

    if varying_slots.is_empty() && talent_builds.len() <= 1 {
        return Ok((base_profile.to_string(), 0, HashMap::new()));
    }

    let option_lists: Vec<&Vec<ResolvedItem>> = varying_slots
        .iter()
        .map(|slot| slot_item_lists.get(slot).unwrap())
        .collect();
    let all_combos = combinator::generate_cartesian_product(&option_lists);
    let valid_combos = combinator::filter_valid_combos(
        &all_combos,
        &varying_slots,
        &option_lists,
        &slot_item_lists,
        &spec,
        catalyst_charges,
    );

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

    let base_actor_spec = writer::write_base_actor(
        &mut lines,
        &mut combo_metadata,
        &base_lines,
        &equipped_gear,
        &effective_talents,
        &spec,
        &slot_item_lists,
    );
    writer::write_all_profilesets(
        writer::ProfilesetWriterContext {
            lines: &mut lines,
            combo_metadata: &mut combo_metadata,
            talents: &effective_talents,
            equipped_gear: &equipped_gear,
            slot_item_lists: &slot_item_lists,
            original_spec: &spec,
            base_actor_spec: &base_actor_spec,
        },
        &valid_combos,
    );

    Ok((lines.join("\n"), total_combo_count, combo_metadata))
}

pub fn generate_droptimizer_input(
    base_profile: &str,
    drop_items: &[ResolvedItem],
) -> (String, usize, HashMap<String, Value>) {
    fn infer_token_slot(item_name: &str) -> Option<&'static str> {
        let n = item_name.to_lowercase();
        if n.contains("hungering") {
            Some("hands")
        } else if n.contains("unraveled") {
            Some("shoulder")
        } else if n.contains("corrupted") {
            Some("legs")
        } else if n.contains("fanatical") {
            Some("head")
        } else {
            None
        }
    }

    fn build_item_simc_string(item: &ResolvedItem) -> String {
        let mut simc = if !item.simc_string.trim().is_empty() {
            let raw = item.simc_string.trim().to_string();
            if raw.starts_with(',') {
                raw
            } else {
                format!(",{}", raw)
            }
        } else {
            if item.item_id == 0 {
                return String::new();
            }
            if item.bonus_ids.is_empty() {
                format!(",id={}", item.item_id)
            } else {
                let joined = item
                    .bonus_ids
                    .iter()
                    .map(|b| b.to_string())
                    .collect::<Vec<_>>()
                    .join("/");
                format!(",id={},bonus_id={}", item.item_id, joined)
            }
        };

        // Enforce the resolved ilvl from drop finder so SimC does not downgrade
        // items that lack explicit ilvl in their serialized form.
        if item.ilevel > 0 && !simc.contains("ilevel=") {
            simc.push_str(&format!(",ilevel={}", item.ilevel));
        }
        simc
    }

    let (base_lines, equipped_gear, talents, spec) = parser::parse_base_profile(base_profile);
    let class_id = crate::types::class_data::detect_class(base_profile)
        .and_then(|c| crate::types::class_data::class_wow_id(&c));
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
    if !talents.is_empty() {
        lines.push(format!("talents={}", talents));
    }
    lines.push(String::new());

    let has_2h = {
        let oh = equipped_gear.get("off_hand").map(|s| s.trim());
        oh.is_none() || oh == Some("") || oh == Some(",")
    };

    let mut combo_idx = 2;
    for item in drop_items {
        let mut candidates: Vec<(String, ResolvedItem)> = Vec::new();
        let mut slots =
            crate::types::class_data::inv_type_to_slots(item.inventory_type as u64, &spec);

        if has_2h && !(spec == "fury" && item.inventory_type == 17) {
            slots.retain(|s| *s != "off_hand");
        }

        if !slots.is_empty() {
            for slot in &slots {
                candidates.push(((*slot).to_string(), item.clone()));
            }
        } else if let Some(cid) = class_id {
            // Some drop-finder entries (e.g. tier tokens in "Other") do not provide
            // an equippable inventory_type. Infer the single token slot from the item name
            // and simulate only that resulting tier piece.
            if let Some(slot) = infer_token_slot(&item.name) {
                if let Some(inv_type) = crate::gear_resolver::slot_to_inv_type(slot) {
                    if let Some(tier_info) = crate::item_db::catalyst_tier_item(cid, inv_type) {
                        let converted =
                            crate::gear_resolver::build_catalyst_item(item, &tier_info, slot);
                        candidates.push((slot.to_string(), converted));
                    }
                }
            }
        }

        for (slot, candidate_item) in candidates {
            let mut simc = build_item_simc_string(&candidate_item);
            if simc.is_empty() {
                continue;
            }
            if let Some(eq) = equipped_gear.get(slot.as_str()) {
                // Restore only enchant/gem IDs from equipped gear.
                // Do NOT append the whole suffix because it may include old bonus_id values.
                for part in eq.split(',') {
                    let p = part.trim();
                    if p.starts_with("enchant_id=") || p.starts_with("gem_id=") {
                        simc.push(',');
                        simc.push_str(p);
                    }
                }
            }

            let c_name = format!("Combo {}", combo_idx);
            lines.push(format!("### {}", c_name));
            lines.push(format!("profileset.\"{}\"+={}={}", c_name, slot, simc));
            if candidate_item.inventory_type == 17 && slot == "main_hand" && spec != "fury" {
                lines.push(format!("profileset.\"{}\"+=off_hand=,", c_name));
            }
            if !talents.is_empty() {
                lines.push(format!("profileset.\"{}\"+=talents={}", c_name, talents));
            }
            lines.push(String::new());

            combo_metadata.insert(
                c_name,
                json!([{
                    "slot": slot,
                    "item_id": candidate_item.item_id,
                    "ilevel": candidate_item.ilevel,
                    "name": candidate_item.name,
                    "bonus_ids": candidate_item.bonus_ids,
                    "enchant_id": 0,
                    "gem_id": 0,
                    "is_kept": false,
                    "origin": "bags",
                    "encounter": candidate_item.encounter,
                    "instance_name": candidate_item.instance_name,
                    "source_type": candidate_item.source_type
                }]),
            );
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
    upgrade_mode: &str,
) -> ProfilesetResult {
    let (base_lines, equipped_gear, talents_string, _spec) =
        parser::parse_base_profile(base_profile);
    let mut slots: Vec<String> = upgraded_options_by_slot
        .keys()
        .filter(|s| !upgraded_options_by_slot[*s].is_empty())
        .cloned()
        .collect();
    slots.sort();
    if slots.is_empty() {
        return Err(crate::error::AppError::SimcError(
            "No upgradeable equipped items were selected.".to_string(),
        ));
    }

    let limit = max_combos_override.unwrap_or(*MAX_COMBINATIONS);

    // Filter out options without upgrade costs for DFS
    let mut options_with_costs = HashMap::new();
    for (slot, opts) in upgraded_options_by_slot {
        let opts_v: Vec<Value> = opts
            .iter()
            .map(|o| serde_json::to_value(o).unwrap())
            .collect();
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
        current: Vec::new(),
        retain_all: upgrade_mode == "all_levels",
    };
    ctx.dfs(0);

    let retained = ctx.retained;
    if retained.len() > limit {
        return Err(crate::error::AppError::SimcError(format!(
            "Too many upgrade combinations ({}). Maximum is {}. Please deselect some items.",
            retained.len(),
            limit
        )));
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
    if !talents_string.is_empty() {
        lines.push(format!("talents={}", talents_string));
    }
    lines.push(String::new());

    let mut combo_idx = 2;
    for combo in &retained {
        if combo.choices.iter().all(|(_, idx)| *idx == 0) {
            continue;
        }
        let c_name = format!("Combo {}", combo_idx);
        let mut items_meta = Vec::new();
        lines.push(format!("### {}", c_name));
        for (slot, c_idx) in &combo.choices {
            if *c_idx == 0 {
                continue;
            }
            let opt = &upgraded_options_by_slot[slot][*c_idx - 1];
            lines.push(format!(
                "profileset.\"{}\"+={}={}",
                c_name, slot, opt.simc_string
            ));

            let mut m = writer::item_meta(opt, slot);
            // Upgrade items are never "kept" in the sense of being currently equipped baseline
            m["is_kept"] = json!(false);
            // UpgradedItem usually has extra fields like upgrade_levels, but ResolvedItem doesn't have it natively.
            // We might need to handle this differently if it's crucial for the UI.
            items_meta.push(m);
        }
        if !talents_string.is_empty() {
            lines.push(format!(
                "profileset.\"{}\"+=talents={}",
                c_name, talents_string
            ));
        }
        lines.push(String::new());
        combo_metadata.insert(c_name, items_meta);
        combo_idx += 1;
    }

    Ok((lines.join("\n"), combo_idx - 2, combo_metadata))
}

fn get_varying_slots(slot_item_lists: &HashMap<String, Vec<ResolvedItem>>) -> Vec<String> {
    let mut varying = slot_item_lists
        .iter()
        .filter(|(_, items)| items.len() > 1)
        .map(|(s, _)| s.clone())
        .collect::<Vec<_>>();
    varying.sort();
    varying
}

fn get_effective_talents(
    talent_builds: &[(String, String)],
    base_talents: &str,
) -> Vec<(String, String)> {
    if talent_builds.is_empty() {
        vec![("".to_string(), base_talents.to_string())]
    } else {
        talent_builds.to_vec()
    }
}

fn calculate_total_combo_count(gear_combo_count: usize, talent_count: usize) -> usize {
    if talent_count > 1 {
        (gear_combo_count + 1) * talent_count - 1
    } else {
        gear_combo_count
    }
}
