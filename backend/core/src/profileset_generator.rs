use regex::Regex;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

use crate::error::Result;
use crate::profileset::validation;
use crate::types::class_data::{self, ARMOR_SLOTS, GEAR_SLOTS};
use crate::game_data;
use once_cell::sync::Lazy;

mod patterns {
    use super::*;
    pub static GEAR_RE: Lazy<Regex> = Lazy::new(|| {
        let pattern = format!(r"^({})=(.*)", super::GEAR_SLOTS.join("|"));
        Regex::new(&pattern).unwrap()
    });
    pub static TALENTS_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^talents=(.+)").unwrap());
    pub static SPEC_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^spec=(\w+)").unwrap());
}

type ProfilesetResult = Result<(String, usize, HashMap<String, Vec<Value>>)>;

const BASE64: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Extract the specId from a talent export string header (bits 8-23).
fn extract_spec_id_from_talent_string(talent_str: &str) -> Option<u64> {
    let mut bits = Vec::new();
    for ch in talent_str.bytes() {
        let val = BASE64.iter().position(|&b| b == ch)?;
        for bit in 0..6 {
            bits.push((val >> bit) & 1);
        }
        if bits.len() >= 24 {
            break;
        }
    }
    if bits.len() < 24 {
        return None;
    }
    let mut spec_id = 0u64;
    for i in 0..16 {
        if bits[8 + i] == 1 {
            spec_id |= 1 << i;
        }
    }
    Some(spec_id)
}

/// Maximum gear combinations for Top Gear. Override with MAX_COMBINATIONS env var.
pub static MAX_COMBINATIONS: Lazy<usize> = Lazy::new(|| {
    if let Ok(val) = std::env::var("MAX_COMBINATIONS") {
        if let Ok(n) = val.parse() {
            return n;
        }
    }
    500
});

/// Build a UID from a legacy item JSON Value.
fn make_item_uid(item: &Value) -> String {
    if let Some(uid) = item.get("uid").and_then(|v| v.as_str()) {
        return uid.to_string();
    }
    let item_id = item.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
    let mut bonus_ids: Vec<u64> = item
        .get("bonus_ids")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|b| b.as_u64()).collect())
        .unwrap_or_default();
    bonus_ids.sort();
    let bonus_key = bonus_ids.iter().map(|b| b.to_string()).collect::<Vec<_>>().join(":");
    let origin = item.get("origin").and_then(|v| v.as_str()).unwrap_or("bags");
    let slot = item.get("slot").and_then(|v| v.as_str()).unwrap_or("");
    let enchant_id = item.get("enchant_id").and_then(|v| v.as_u64()).unwrap_or(0);
    let gem_id = item.get("gem_id").and_then(|v| v.as_u64()).unwrap_or(0);
    format!("{}:{}:{}:e{}:g{}:{}", item_id, bonus_key, origin, enchant_id, gem_id, slot)
}

/// Build a slot-agnostic identity key.
fn make_item_identity(item: &Value) -> String {
    if let Some(uid) = item.get("uid").and_then(|v| v.as_str()) {
        return uid_identity(uid);
    }
    let item_id = item.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
    let mut bonus_ids: Vec<u64> = item
        .get("bonus_ids")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|b| b.as_u64()).collect())
        .unwrap_or_default();
    bonus_ids.sort();
    let bonus_key = bonus_ids.iter().map(|b| b.to_string()).collect::<Vec<_>>().join(":");
    let origin = item.get("origin").and_then(|v| v.as_str()).unwrap_or("bags");
    let enchant_id = item.get("enchant_id").and_then(|v| v.as_u64()).unwrap_or(0);
    let gem_id = item.get("gem_id").and_then(|v| v.as_u64()).unwrap_or(0);
    format!("{}:{}:{}:e{}:g{}", item_id, bonus_key, origin, enchant_id, gem_id)
}

fn uid_identity(uid: &str) -> String {
    uid.rsplit_once(':').map(|(prefix, _)| prefix.to_string()).unwrap_or_else(|| uid.to_string())
}

pub fn generate_top_gear_input(
    base_profile: &str,
    items_by_slot: &HashMap<String, Vec<Value>>,
    selected_items: &HashMap<String, Vec<String>>,
    max_combos_override: Option<usize>,
) -> ProfilesetResult {
    generate_top_gear_input_with_talents(base_profile, items_by_slot, selected_items, max_combos_override, &[], None)
}

pub fn generate_top_gear_input_with_talents(
    base_profile: &str,
    items_by_slot: &HashMap<String, Vec<Value>>,
    selected_items: &HashMap<String, Vec<String>>,
    max_combos_override: Option<usize>,
    talent_builds: &[(String, String)],
    catalyst_charges: Option<u32>,
) -> ProfilesetResult {
    let (base_lines, equipped_gear, talents_string, spec) = parse_base_profile(base_profile);
    let slot_item_lists = build_slot_candidates(base_profile, items_by_slot, selected_items);
    let varying_slots = get_varying_slots(&slot_item_lists);

    if varying_slots.is_empty() && talent_builds.len() <= 1 {
        return Ok((base_profile.to_string(), 0, HashMap::new()));
    }

    let option_lists: Vec<&Vec<Value>> = varying_slots.iter().map(|slot| slot_item_lists.get(slot).unwrap()).collect();
    let all_combos = generate_cartesian_product(&option_lists);
    let valid_combos = filter_valid_combos(&all_combos, &varying_slots, &option_lists, &slot_item_lists, &spec, catalyst_charges);

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

    let base_actor_spec = write_base_actor(&mut lines, &mut combo_metadata, &base_lines, &equipped_gear, &effective_talents, &spec, &slot_item_lists);
    write_all_profilesets(&mut lines, &mut combo_metadata, &valid_combos, &effective_talents, &equipped_gear, &slot_item_lists, &spec, &base_actor_spec);

    Ok((lines.join("\n"), total_combo_count, combo_metadata))
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

fn write_base_actor(
    lines: &mut Vec<String>,
    combo_metadata: &mut HashMap<String, Vec<Value>>,
    base_lines: &[String],
    equipped_gear: &HashMap<String, String>,
    talents: &[(String, String)],
    spec: &str,
    slot_item_lists: &HashMap<String, Vec<Value>>,
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
        .map(|s| s.to_string())
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

fn build_baseline_meta(slot_item_lists: &HashMap<String, Vec<Value>>, talents: &[(String, String)]) -> Vec<Value> {
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
        let spec_name = extract_spec_id_from_talent_string(&talents[0].1).and_then(class_data::spec_id_to_name);
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

fn write_all_profilesets(
    lines: &mut Vec<String>,
    combo_metadata: &mut HashMap<String, Vec<Value>>,
    valid_combos: &[HashMap<String, Value>],
    talents: &[(String, String)],
    equipped_gear: &HashMap<String, String>,
    slot_item_lists: &HashMap<String, Vec<Value>>,
    original_spec: &str,
    base_actor_spec: &str,
) {
    let mut combo_number = 2;
    for (t_idx, (t_name, t_str)) in talents.iter().enumerate() {
        let is_first_talent = t_idx == 0;
        
        // If not first talent, we need a baseline gear combo for this talent
        if !is_first_talent {
            write_combo(lines, combo_metadata, combo_number, t_name, t_str, &HashMap::new(), equipped_gear, slot_item_lists, original_spec, base_actor_spec, true);
            combo_number += 1;
        }

        for gear_set in valid_combos {
            write_combo(lines, combo_metadata, combo_number, t_name, t_str, gear_set, equipped_gear, slot_item_lists, original_spec, base_actor_spec, false);
            combo_number += 1;
        }
    }
}

fn write_combo(
    lines: &mut Vec<String>,
    combo_metadata: &mut HashMap<String, Vec<Value>>,
    combo_number: usize,
    talent_name: &str,
    talent_str: &str,
    gear_set: &HashMap<String, Value>,
    equipped_gear: &HashMap<String, String>,
    slot_item_lists: &HashMap<String, Vec<Value>>,
    original_spec: &str,
    base_actor_spec: &str,
    is_baseline_gear: bool,
) {
    let combo_name = format!("Combo {}", combo_number);
    lines.push(format!("### {}", combo_name));

    if is_baseline_gear {
        for slot in GEAR_SLOTS {
            if let Some(val) = equipped_gear.get(*slot) {
                lines.push(format!("profileset.\"{}\"+={}={}", combo_name, slot, val));
            } else if *slot == "off_hand" {
                lines.push(format!("profileset.\"{}\"+=off_hand=,", combo_name));
            }
        }
    } else {
        let mh_is_2h = validation::main_hand_is_two_hand(gear_set, original_spec);
        for slot in GEAR_SLOTS {
            if *slot == "off_hand" && mh_is_2h {
                lines.push(format!("profileset.\"{}\"+=off_hand=,", combo_name));
                continue;
            }
            if let Some(item) = gear_set.get(*slot) {
                let simc = item.get("simc_string").and_then(|s| s.as_str()).unwrap_or("");
                lines.push(format!("profileset.\"{}\"+={}={}", combo_name, slot, simc));
            } else if *slot == "off_hand" {
                lines.push(format!("profileset.\"{}\"+=off_hand=,", combo_name));
            }
        }
    }

    if !talent_str.is_empty() {
        lines.push(format!("profileset.\"{}\"+=talents={}", combo_name, talent_str));
        if let Some(t_spec_id) = extract_spec_id_from_talent_string(talent_str) {
            if let Some(t_spec_name) = class_data::spec_id_to_name(t_spec_id) {
                if t_spec_name != base_actor_spec {
                    lines.push(format!("profileset.\"{}\"+=spec={}", combo_name, t_spec_name));
                }
            }
        }
    }
    lines.push(String::new());

    combo_metadata.insert(combo_name, build_combo_meta(gear_set, talent_name, talent_str, slot_item_lists, is_baseline_gear));
}

fn build_combo_meta(
    gear_set: &HashMap<String, Value>,
    talent_name: &str,
    talent_str: &str,
    slot_item_lists: &HashMap<String, Vec<Value>>,
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
                m["is_kept"] = json!(item.get("is_equipped").and_then(|v| v.as_bool()).unwrap_or(false));
                meta.push(m);
            }
        }
        for slot in GEAR_SLOTS {
            if paired_display_slots.contains(slot) { continue; }
            if let Some(item) = gear_set.get(*slot) {
                if !item.get("is_equipped").and_then(|v| v.as_bool()).unwrap_or(true) {
                    meta.push(item_meta(item, slot));
                }
            }
        }
    }

    if !talent_name.is_empty() {
        let spec_name = extract_spec_id_from_talent_string(talent_str).and_then(class_data::spec_id_to_name);
        if meta.is_empty() {
            meta.push(json!({"talent_build": talent_name, "talent_spec": spec_name, "is_kept": true}));
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

fn parse_base_profile(base_profile: &str) -> (Vec<String>, HashMap<String, String>, String, String) {
    let mut non_gear_lines = Vec::new();
    let mut equipped_gear = HashMap::new();
    let mut talents = String::new();
    let mut spec = String::new();

    for line in base_profile.lines() {
        let stripped = line.trim();
        if stripped.is_empty() { continue; }

        if let Some(caps) = patterns::TALENTS_RE.captures(stripped) {
            talents = caps[1].to_string();
            continue;
        }
        if let Some(caps) = patterns::SPEC_RE.captures(stripped) {
            spec = caps[1].to_lowercase();
        }
        if let Some(caps) = patterns::GEAR_RE.captures(stripped) {
            equipped_gear.insert(caps[1].to_lowercase(), caps[2].to_string());
            continue;
        }
        non_gear_lines.push(stripped.to_string());
    }
    (non_gear_lines, equipped_gear, talents, spec)
}

fn item_meta(item: &Value, slot: &str) -> Value {
    let mut meta = json!({
        "slot": slot,
        "item_id": item.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0),
        "ilevel": item.get("ilevel").and_then(|v| v.as_u64()).unwrap_or(0),
        "name": item.get("name").and_then(|v| v.as_str()).unwrap_or(""),
        "bonus_ids": item.get("bonus_ids").cloned().unwrap_or(json!([])),
        "enchant_id": item.get("enchant_id").and_then(|v| v.as_u64()).unwrap_or(0),
        "gem_id": item.get("gem_id").and_then(|v| v.as_u64()).unwrap_or(0),
        "is_kept": item.get("is_equipped").and_then(|v| v.as_bool()).unwrap_or(false),
        "origin": item.get("origin").and_then(|v| v.as_str()).unwrap_or("bags"),
    });
    if item.get("is_catalyst").and_then(|v| v.as_bool()).unwrap_or(false) {
        meta["is_catalyst"] = json!(true);
    }
    meta
}

pub fn generate_droptimizer_input(base_profile: &str, drop_items: &[Value]) -> (String, usize, HashMap<String, Value>) {
    let (base_lines, equipped_gear, talents, spec) = parse_base_profile(base_profile);
    let mut lines = Vec::new();
    let mut combo_metadata = HashMap::new();

    lines.push("# Base Actor".to_string());
    lines.extend(base_lines);
    lines.push("### Combo 1".to_string());
    for slot in GEAR_SLOTS {
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

    let enchant_re = Regex::new(r"(enchant_id=\d+)").unwrap();
    let mut combo_idx = 2;
    for item in drop_items {
        let item_id = item.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
        let ilevel = item.get("ilevel").and_then(|v| v.as_u64()).unwrap_or(0);
        let name = item.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let encounter = item.get("encounter").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let bids: Vec<u64> = item.get("bonus_ids").and_then(|v| v.as_array()).map(|a| a.iter().filter_map(|b| b.as_u64()).collect()).unwrap_or_default();
        let mut slots = class_data::inv_type_to_slots(item.get("inventory_type").and_then(|v| v.as_u64()).unwrap_or(0), &spec);

        if has_2h && !(spec == "fury" && item.get("inventory_type") == Some(&json!(17))) {
            slots.retain(|s| *s != "off_hand");
        }

        if slots.is_empty() { continue; }

        let mut base_simc = format!(",id={},ilevel={}", item_id, ilevel);
        if !bids.is_empty() {
            base_simc.push_str(&format!(",bonus_id={}", bids.iter().map(|b| b.to_string()).collect::<Vec<_>>().join("/")));
        }

        for slot in &slots {
            let mut simc = base_simc.clone();
            if let Some(eq) = equipped_gear.get(*slot) {
                if let Some(caps) = enchant_re.captures(eq) {
                    simc.push_str(&format!(",{}", &caps[1]));
                }
            }

            let c_name = format!("Combo {}", combo_idx);
            lines.push(format!("### {}", c_name));
            lines.push(format!("profileset.\"{}\"+={}={}", c_name, slot, simc));
            if item.get("inventory_type") == Some(&json!(17)) && *slot == "main_hand" && spec != "fury" {
                lines.push(format!("profileset.\"{}\"+=off_hand=,", c_name));
            }
            if !talents.is_empty() { lines.push(format!("profileset.\"{}\"+=talents={}", c_name, talents)); }
            lines.push(String::new());

            combo_metadata.insert(c_name, json!([{"slot": slot, "item_id": item_id, "ilevel": ilevel, "name": name, "bonus_ids": bids, "enchant_id": 0, "gem_id": 0, "is_kept": false, "encounter": encounter}]));
            combo_idx += 1;
        }
    }

    (lines.join("\n"), combo_idx - 2, combo_metadata)
}

pub fn generate_upgrade_compare_input(
    base_profile: &str,
    upgraded_options_by_slot: &HashMap<String, Vec<Value>>,
    upgrade_budget: &HashMap<u64, u64>,
    max_combos_override: Option<usize>,
) -> ProfilesetResult {
    let (base_lines, equipped_gear, talents_string, _spec) = parse_base_profile(base_profile);
    let mut slots: Vec<String> = upgraded_options_by_slot.keys().filter(|s| !upgraded_options_by_slot[*s].is_empty()).cloned().collect();
    slots.sort();
    if slots.is_empty() { return Err(crate::error::AppError::SimcError("No upgradeable equipped items were selected.".to_string())); }

    let limit = max_combos_override.unwrap_or(*MAX_COMBINATIONS);

    struct Combo { choices: Vec<(String, usize)> }
    struct DfsCtx<'a> {
        slots: &'a [String],
        options: &'a HashMap<String, Vec<Value>>,
        budget: &'a HashMap<u64, u64>,
        limit: usize,
        best_spend: u64,
        retained: Vec<Combo>,
        spent: HashMap<u64, u64>,
        current: Vec<(String, usize)>,
    }

    impl DfsCtx<'_> {
        fn within_budget(&self, cost: &HashMap<u64, u64>) -> bool {
            cost.iter().all(|(cid, amount)| self.spent.get(cid).copied().unwrap_or(0) + amount <= self.budget.get(cid).copied().unwrap_or(0))
        }

        fn dfs(&mut self, idx: usize) {
            if idx == self.slots.len() {
                let total: u64 = self.spent.values().sum();
                if total > self.best_spend { self.best_spend = total; self.retained.clear(); }
                if total >= self.best_spend { self.retained.push(Combo { choices: self.current.clone() }); }
                return;
            }

            let slot = self.slots[idx].clone();
            let slot_opts = self.options.get(&slot).unwrap();

            self.current.push((slot.clone(), 0));
            self.dfs(idx + 1);
            self.current.pop();

            for (i, opt) in slot_opts.iter().enumerate() {
                let costs: HashMap<u64, u64> = opt.get("upgrade_costs").and_then(|v| serde_json::from_value(v.clone()).ok()).unwrap_or_default();
                if !self.within_budget(&costs) { continue; }
                for (cid, amount) in &costs { *self.spent.entry(*cid).or_insert(0) += amount; }
                self.current.push((slot.clone(), i + 1));
                self.dfs(idx + 1);
                self.current.pop();
                for (cid, amount) in &costs {
                    let e = self.spent.entry(*cid).or_insert(0);
                    *e = e.saturating_sub(*amount);
                }
                if self.retained.len() > self.limit * 2 { return; }
            }
        }
    }

    let mut ctx = DfsCtx { slots: &slots, options: upgraded_options_by_slot, budget: upgrade_budget, limit, best_spend: 0, retained: Vec::new(), spent: HashMap::new(), current: Vec::new() };
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
    for slot in GEAR_SLOTS {
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
            if let Some(simc) = opt.get("simc_string").and_then(|v| v.as_str()) {
                lines.push(format!("profileset.\"{}\"+={}={}", c_name, slot, simc));
            }
            let mut m = item_meta(opt, slot);
            m["is_kept"] = json!(false);
            m["upgrade_levels"] = opt.get("upgrade_levels").cloned().unwrap_or(json!(0));
            items_meta.push(m);
        }
        if !talents_string.is_empty() { lines.push(format!("profileset.\"{}\"+=talents={}", c_name, talents_string)); }
        lines.push(String::new());
        combo_metadata.insert(c_name, items_meta);
        combo_idx += 1;
    }

    Ok((lines.join("\n"), combo_idx - 2, combo_metadata))
}

fn build_slot_candidates(base_profile: &str, items_by_slot: &HashMap<String, Vec<Value>>, selected_items: &HashMap<String, Vec<String>>) -> HashMap<String, Vec<Value>> {
    let mut slot_item_lists = HashMap::new();
    for slot in GEAR_SLOTS {
        let slot_str = slot.to_string();
        let slot_items = match items_by_slot.get(&slot_str) { Some(items) => items, None => continue };
        let selected_uids: HashSet<String> = selected_items.get(&slot_str).cloned().unwrap_or_default().into_iter().collect();
        let mut selected_identities: HashSet<String> = selected_uids.iter().map(|uid| uid_identity(uid)).collect();
        if let Some(paired) = class_data::paired_slot(&slot_str) {
            if let Some(p_uids) = selected_items.get(paired) {
                selected_identities.extend(p_uids.iter().map(|uid| uid_identity(uid)));
            }
        }

        let mut candidates = Vec::new();
        for item in slot_items {
            let uid = make_item_uid(item);
            let identity = make_item_identity(item);
            if selected_uids.contains(&uid) || selected_identities.contains(&identity) {
                candidates.push(item.clone());
            }
        }

        if let Some(eq) = slot_items.iter().find(|it| it.get("is_equipped").and_then(|v| v.as_bool()).unwrap_or(false)) {
            if !candidates.iter().any(|c| c.get("item_id") == eq.get("item_id") && c.get("is_equipped").and_then(|v| v.as_bool()).unwrap_or(false)) {
                candidates.insert(0, eq.clone());
            }
        }
        if !candidates.is_empty() { slot_item_lists.insert(slot_str, candidates); }
    }
    apply_armor_filtering(base_profile, &mut slot_item_lists);
    slot_item_lists
}

fn get_varying_slots(slot_item_lists: &HashMap<String, Vec<Value>>) -> Vec<String> {
    let mut varying = slot_item_lists.iter().filter(|(_, items)| items.len() > 1).map(|(s, _)| s.clone()).collect::<Vec<_>>();
    varying.sort();
    varying
}

fn generate_cartesian_product(option_lists: &[&Vec<Value>]) -> Vec<Vec<usize>> {
    let mut all = vec![vec![]];
    for opts in option_lists {
        let mut new = Vec::new();
        for combo in &all {
            for i in 0..opts.len() {
                let mut c = combo.clone();
                c.push(i);
                new.push(c);
            }
        }
        all = new;
    }
    all
}

fn filter_valid_combos(all_combos: &[Vec<usize>], varying_slots: &[String], option_lists: &[&Vec<Value>], slot_item_lists: &HashMap<String, Vec<Value>>, spec: &str, catalyst_charges: Option<u32>) -> Vec<HashMap<String, Value>> {
    let mut valid = Vec::new();
    let mut seen = HashSet::new();
    for indices in all_combos {
        let gear_set = build_gear_set_from_combo(indices, varying_slots, option_lists, slot_item_lists, spec);
        if is_valid_gear_set(&gear_set, spec, catalyst_charges) && !is_baseline_gear_set(&gear_set) {
            let key = gear_set_identity_key(&gear_set);
            if seen.insert(key) { valid.push(gear_set); }
        }
    }
    valid
}

fn build_gear_set_from_combo(indices: &[usize], varying_slots: &[String], option_lists: &[&Vec<Value>], slot_item_lists: &HashMap<String, Vec<Value>>, spec: &str) -> HashMap<String, Value> {
    let mut gear_set = HashMap::new();
    for slot in GEAR_SLOTS {
        let s_str = slot.to_string();
        if let Some(items) = slot_item_lists.get(&s_str) {
            let d = items.iter().find(|it| it.get("is_equipped").and_then(|v| v.as_bool()).unwrap_or(false)).unwrap_or(&items[0]);
            gear_set.insert(s_str, d.clone());
        }
    }
    for (i, slot) in varying_slots.iter().enumerate() { gear_set.insert(slot.clone(), option_lists[i][indices[i]].clone()); }
    if validation::main_hand_is_two_hand(&gear_set, spec) { gear_set.remove("off_hand"); }
    gear_set
}

fn is_valid_gear_set(gs: &HashMap<String, Value>, spec: &str, catalyst: Option<u32>) -> bool {
    validation::validate_unique_equipped(gs) && validation::validate_vault_constraint(gs) && validation::validate_weapon_constraint(gs, spec) && validation::validate_item_limits(gs) && catalyst.map_or(true, |c| validation::validate_catalyst_constraint(gs, c))
}

fn is_baseline_gear_set(gs: &HashMap<String, Value>) -> bool {
    GEAR_SLOTS.iter().all(|slot| gs.get(*slot).and_then(|i| i.get("is_equipped")).and_then(|v| v.as_bool()).unwrap_or(true))
}

fn apply_armor_filtering(profile: &str, slot_item_lists: &mut HashMap<String, Vec<Value>>) {
    if let Some(class) = class_data::detect_class(profile) {
        if let Some(max) = class_data::class_max_armor(class.as_str()) {
            for slot in ARMOR_SLOTS {
                let s_str = slot.to_string();
                if let Some(items) = slot_item_lists.get_mut(&s_str) {
                    items.retain(|i| {
                        if i.get("is_equipped").and_then(|v| v.as_bool()).unwrap_or(false) { return true; }
                        let id = i.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
                        if id == 0 { return true; }
                        game_data::get_item_armor_subclass(id).map_or(true, |s| s <= max || s == 0)
                    });
                }
            }
        }
    }
}

fn gear_set_identity_key(gs: &HashMap<String, Value>) -> String {
    GEAR_SLOTS.iter().map(|slot| {
        if let Some(i) = gs.get(*slot) {
            let id = i.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
            let mut bids: Vec<u64> = i.get("bonus_ids").and_then(|v| v.as_array()).map(|a| a.iter().filter_map(|b| b.as_u64()).collect()).unwrap_or_default();
            bids.sort();
            let b_key = bids.iter().map(|b| b.to_string()).collect::<Vec<_>>().join(":");
            format!("{}={}:{}:e{}:g{}", slot, id, b_key, i.get("enchant_id").and_then(|v| v.as_u64()).unwrap_or(0), i.get("gem_id").and_then(|v| v.as_u64()).unwrap_or(0))
        } else { format!("{}=none", slot) }
    }).collect::<Vec<_>>().join("|")
}
