use super::parser::extract_spec_id_from_talent_string;
use crate::types::class_data::GEAR_SLOTS;
use crate::types::{class_data, ResolvedItem};
use serde_json::{json, Value};
use std::collections::HashMap;

pub struct ProfilesetWriterContext<'a> {
    pub lines: &'a mut Vec<String>,
    pub combo_metadata: &'a mut HashMap<String, Vec<Value>>,
    pub talents: &'a [(String, String)],
    pub equipped_gear: &'a HashMap<String, String>,
    pub slot_item_lists: &'a HashMap<String, Vec<ResolvedItem>>,
    pub original_spec: &'a str,
    pub base_actor_spec: &'a str,
}

pub fn write_base_actor(
    lines: &mut Vec<String>,
    combo_metadata: &mut HashMap<String, Vec<Value>>,
    base_lines: &[String],
    equipped_gear: &HashMap<String, String>,
    talents: &[(String, String)],
    spec: &str,
    slot_item_lists: &HashMap<String, Vec<ResolvedItem>>,
) -> String {
    lines.push("# Base Actor".to_string());
    lines.extend(base_lines.iter().cloned());

    let base_talent = &talents[0].1;
    lines.push("### Combo 1".to_string());
    for slot in GEAR_SLOTS {
        if let Some(val) = equipped_gear.get(*slot) {
            lines.push(format!("{}={}", slot, val));
        } else if *slot == "off_hand" {
            lines.push("off_hand=,".to_string());
        }
    }

    let base_spec = extract_spec_id_from_talent_string(base_talent)
        .and_then(class_data::spec_id_to_name)
        .unwrap_or_else(|| spec.to_string());

    if !base_talent.is_empty() {
        lines.push(format!("talents={}", base_talent));
        if base_spec != spec {
            lines.push(format!("spec={}", base_spec));
        }
    }
    lines.push(String::new());

    let baseline_name = if talents.len() > 1 {
        format!("Currently Equipped ({})", talents[0].0)
    } else {
        "Currently Equipped".to_string()
    };
    combo_metadata.insert(baseline_name, build_baseline_meta(slot_item_lists, talents));

    base_spec
}

pub fn write_all_profilesets(
    mut ctx: ProfilesetWriterContext,
    valid_combos: &[HashMap<String, ResolvedItem>],
) {
    let mut combo_number = 2;
    for (t_idx, (t_name, t_str)) in ctx.talents.iter().cloned().enumerate() {
        let is_first_talent = t_idx == 0;

        if !is_first_talent {
            write_combo(
                &mut ctx,
                combo_number,
                &t_name,
                &t_str,
                &HashMap::new(),
                true,
            );
            combo_number += 1;
        }

        for gear_set in valid_combos {
            write_combo(
                &mut ctx,
                combo_number,
                &t_name,
                &t_str,
                gear_set,
                false,
            );
            combo_number += 1;
        }
    }
}

pub fn write_combo(
    ctx: &mut ProfilesetWriterContext,
    combo_number: usize,
    talent_name: &str,
    talent_str: &str,
    gear_set: &HashMap<String, ResolvedItem>,
    is_baseline_gear: bool,
) {
    let combo_name = format!("Combo {}", combo_number);
    ctx.lines.push(format!("### {}", combo_name));

    if is_baseline_gear {
        for slot in GEAR_SLOTS {
            if let Some(val) = ctx.equipped_gear.get(*slot) {
                ctx.lines.push(format!("profileset.\"{}\"+={}={}", combo_name, slot, val));
            } else if *slot == "off_hand" {
                ctx.lines.push(format!("profileset.\"{}\"+=off_hand=,", combo_name));
            }
        }
    } else {
        let mh_is_2h =
            crate::profileset::validation::main_hand_is_two_hand(gear_set, ctx.original_spec);
        for slot in GEAR_SLOTS {
            if *slot == "off_hand" && mh_is_2h {
                ctx.lines.push(format!("profileset.\"{}\"+=off_hand=,", combo_name));
                continue;
            }
            if let Some(item) = gear_set.get(*slot) {
                ctx.lines.push(format!(
                    "profileset.\"{}\"+={}={}",
                    combo_name, slot, item.simc_string
                ));
            } else if *slot == "off_hand" {
                ctx.lines.push(format!("profileset.\"{}\"+=off_hand=,", combo_name));
            }
        }
    }

    if !talent_str.is_empty() {
        ctx.lines.push(format!(
            "profileset.\"{}\"+=talents={}",
            combo_name, talent_str
        ));
        if let Some(t_spec_id) = extract_spec_id_from_talent_string(talent_str) {
            if let Some(t_spec_name) = class_data::spec_id_to_name(t_spec_id) {
                if t_spec_name != ctx.base_actor_spec {
                    ctx.lines.push(format!(
                        "profileset.\"{}\"+=spec={}",
                        combo_name, t_spec_name
                    ));
                }
            }
        }
    }
    ctx.lines.push(String::new());

    ctx.combo_metadata.insert(
        combo_name,
        build_combo_meta(
            gear_set,
            talent_name,
            talent_str,
            ctx.slot_item_lists,
            is_baseline_gear,
        ),
    );
}

pub fn build_baseline_meta(
    slot_item_lists: &HashMap<String, Vec<ResolvedItem>>,
    talents: &[(String, String)],
) -> Vec<Value> {
    let paired_display_slots = ["finger1", "finger2", "trinket1", "trinket2"];
    let mut meta = Vec::new();
    for slot in &paired_display_slots {
        if let Some(items) = slot_item_lists.get(*slot) {
            if !items.is_empty() {
                meta.push(item_meta(&items[0], slot));
            }
        }
    }

    if talents.len() > 1 {
        let name = &talents[0].0;
        let spec_name =
            extract_spec_id_from_talent_string(&talents[0].1).and_then(class_data::spec_id_to_name);
        if meta.is_empty() {
            meta.push(json!({"talent_build": name, "talent_spec": spec_name, "is_kept": true}));
        } else {
            for item in &mut meta {
                item["talent_build"] = json!(name);
                item["talent_spec"] = json!(spec_name);
            }
        }
    }
    meta
}

pub fn build_combo_meta(
    gear_set: &HashMap<String, ResolvedItem>,
    talent_name: &str,
    talent_str: &str,
    slot_item_lists: &HashMap<String, Vec<ResolvedItem>>,
    is_baseline: bool,
) -> Vec<Value> {
    let paired_display_slots = ["finger1", "finger2", "trinket1", "trinket2"];
    let mut meta = Vec::new();

    if is_baseline {
        for slot in &paired_display_slots {
            if let Some(items) = slot_item_lists.get(*slot) {
                if !items.is_empty() {
                    let mut m = item_meta(&items[0], slot);
                    m["is_kept"] = json!(true);
                    meta.push(m);
                }
            }
        }
    } else {
        for slot in &paired_display_slots {
            if let Some(item) = gear_set.get(*slot) {
                let mut m = item_meta(item, slot);
                m["is_kept"] = json!(item.origin == crate::types::ItemOrigin::Equipped);
                meta.push(m);
            }
        }
        for slot in GEAR_SLOTS {
            if paired_display_slots.contains(slot) {
                continue;
            }
            if let Some(item) = gear_set.get(*slot) {
                if item.origin != crate::types::ItemOrigin::Equipped {
                    meta.push(item_meta(item, slot));
                }
            }
        }
    }

    if !talent_name.is_empty() {
        let spec_name =
            extract_spec_id_from_talent_string(talent_str).and_then(class_data::spec_id_to_name);
        if meta.is_empty() {
            meta.push(
                json!({"talent_build": talent_name, "talent_spec": spec_name, "is_kept": true}),
            );
        } else {
            for item in &mut meta {
                item["talent_build"] = json!(talent_name);
                item["talent_spec"] = json!(spec_name);
            }
        }
    }

    if !is_baseline && !gear_set.contains_key("off_hand") {
        meta.push(json!({"slot": "off_hand", "item_id": 0, "ilevel": 0, "name": "", "bonus_ids": [], "enchant_id": 0, "gem_id": 0, "is_kept": false, "origin": "system"}));
    }

    meta
}

pub fn item_meta(item: &ResolvedItem, slot: &str) -> Value {
    let mut meta = json!({
        "slot": slot,
        "item_id": item.item_id,
        "ilevel": item.ilevel,
        "name": item.name,
        "bonus_ids": item.bonus_ids,
        "enchant_id": item.enchant_id,
        "gem_id": item.gem_id,
        "is_kept": item.origin == crate::types::ItemOrigin::Equipped,
        "origin": item.origin.as_str(),
    });
    if item.is_catalyst {
        meta["is_catalyst"] = json!(true);
    }
    meta
}
