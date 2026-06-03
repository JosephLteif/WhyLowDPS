use serde_json::Value;
use std::collections::{HashMap, HashSet};

use crate::types::class_data;

/// Values <= 13 are class IDs; values > 13 are spec IDs.
pub(super) fn restrictions_match_active_specs(
    item_restrictions: &[u64],
    allowed_specs: &[u64],
    allowed_class_id: Option<u64>,
) -> bool {
    if item_restrictions.is_empty() {
        return true;
    }

    let has_spec_entries = item_restrictions.iter().any(|id| *id > 13);
    if has_spec_entries {
        return !allowed_specs.is_empty()
            && allowed_specs.iter().any(|s| item_restrictions.contains(s));
    }

    allowed_class_id.is_some_and(|cid| item_restrictions.contains(&cid))
}

pub(super) fn item_matches_primary_stats(
    item: &crate::types::GameItem,
    allowed_primary: &HashSet<u64>,
) -> bool {
    if allowed_primary.is_empty() {
        return true;
    }

    let Some(stats) = &item.stats else {
        return true;
    };

    let mut saw_primary_token = false;
    for stat in stats {
        let expanded = class_data::expand_primary_stat(stat.id);
        if expanded.is_empty() {
            continue;
        }
        saw_primary_token = true;
        if expanded.iter().any(|id| allowed_primary.contains(id)) {
            return true;
        }
    }

    !saw_primary_token
}

pub(super) fn primary_stat_filtered_slot(item_class: i64, inv_type: i64) -> bool {
    item_class == 2 || inv_type == 12 || inv_type == 14 || inv_type == 23
}

pub(super) fn normalize_drop_key_part(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase()
}

pub(super) fn canonical_drop_key(encounter_scope_id: i64, item: &crate::types::GameItem) -> String {
    format!(
        "{}|{}|{}|{}|{}",
        encounter_scope_id,
        item.inventory_type.unwrap_or(0),
        item.class.unwrap_or(0),
        item.subclass.unwrap_or(0),
        normalize_drop_key_part(&item.name)
    )
}

pub(super) fn drop_candidate_score(
    item: &crate::types::GameItem,
    can_catalyst: bool,
    is_catalyst: bool,
    has_diff_info: bool,
    has_dungeon_info: bool,
) -> i64 {
    let mut score = (item.quality as i64) * 10_000 + item.base_ilevel.unwrap_or(0);
    if can_catalyst {
        score += 500;
    }
    if is_catalyst {
        score += 250;
    }
    if has_diff_info {
        score += 100;
    }
    if has_dungeon_info {
        score += 100;
    }
    score
}

pub(super) fn drop_value_dedupe_key(slot: &str, item: &Value) -> String {
    let name = item
        .get("name")
        .and_then(|v| v.as_str())
        .map(normalize_drop_key_part)
        .unwrap_or_default();
    let encounter = item
        .get("encounter")
        .and_then(|v| v.as_str())
        .map(normalize_drop_key_part)
        .unwrap_or_default();
    let instance = item
        .get("instance_name")
        .and_then(|v| v.as_str())
        .map(normalize_drop_key_part)
        .unwrap_or_default();
    let inv_type = item
        .get("inventory_type")
        .and_then(|v| v.as_i64())
        .unwrap_or_default();

    format!(
        "{}|{}|{}|{}|{}",
        normalize_drop_key_part(slot),
        name,
        encounter,
        instance,
        inv_type
    )
}

pub(super) fn drop_value_score(item: &Value) -> i64 {
    let quality = item
        .get("quality")
        .and_then(|v| v.as_i64())
        .unwrap_or_default();
    let ilevel = item
        .get("ilevel")
        .and_then(|v| v.as_i64())
        .unwrap_or_default();
    let can_catalyst = item
        .get("can_catalyst")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let is_catalyst = item
        .get("is_catalyst")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let has_diff_info = item
        .get("difficulty_info")
        .and_then(|v| v.as_object())
        .is_some_and(|obj| !obj.is_empty());
    let has_dungeon_info = item
        .get("dungeon_info")
        .and_then(|v| v.as_object())
        .is_some_and(|obj| !obj.is_empty());

    let mut score = quality * 10_000 + ilevel;
    if can_catalyst {
        score += 500;
    }
    if is_catalyst {
        score += 250;
    }
    if has_diff_info {
        score += 100;
    }
    if has_dungeon_info {
        score += 100;
    }
    score
}

pub(super) fn upsert_slot_candidate(
    by_slot: &mut HashMap<String, HashMap<String, (i64, Value)>>,
    slot: &str,
    dedupe_key: String,
    score: i64,
    item_json: Value,
) {
    let slot_map = by_slot.entry(slot.to_string()).or_default();
    let should_replace = match slot_map.get(&dedupe_key) {
        Some((existing_score, _)) => score >= *existing_score,
        None => true,
    };

    if should_replace {
        slot_map.insert(dedupe_key, (score, item_json));
    }
}

pub(super) fn merge_drop_map_into(
    merged: &mut HashMap<String, HashMap<String, (i64, Value)>>,
    drops: &serde_json::Map<String, Value>,
) {
    for (slot, items) in drops {
        let Some(arr) = items.as_array() else {
            continue;
        };
        for item in arr {
            let key = drop_value_dedupe_key(slot, item);
            let score = drop_value_score(item);
            upsert_slot_candidate(merged, slot, key, score, item.clone());
        }
    }
}

pub(super) fn finalize_slot_map(
    mut by_slot: HashMap<String, HashMap<String, (i64, Value)>>,
) -> serde_json::Map<String, Value> {
    let mut ordered = serde_json::Map::new();

    for &slot in class_data::SLOT_DISPLAY_ORDER {
        if let Some(slot_items) = by_slot.remove(slot) {
            let mut values: Vec<Value> = slot_items.into_values().map(|(_, item)| item).collect();
            values.sort_by(|a, b| {
                b.get("ilevel")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0)
                    .cmp(&a.get("ilevel").and_then(|v| v.as_u64()).unwrap_or(0))
            });
            ordered.insert(slot.to_string(), Value::Array(values));
        }
    }

    for (slot, slot_items) in by_slot {
        let mut values: Vec<Value> = slot_items.into_values().map(|(_, item)| item).collect();
        values.sort_by(|a, b| {
            b.get("ilevel")
                .and_then(|v| v.as_u64())
                .unwrap_or(0)
                .cmp(&a.get("ilevel").and_then(|v| v.as_u64()).unwrap_or(0))
        });
        ordered.insert(slot, Value::Array(values));
    }

    ordered
}
