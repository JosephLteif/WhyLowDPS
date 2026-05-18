use super::state::*;
use crate::types::{BonusData, BonusResolved, ItemBonusDebug};
use serde_json::Value;
use std::collections::HashMap;

pub fn track_rank(track: &str) -> Option<usize> {
    TRACK_RANKS.iter().position(|&t| track.starts_with(t))
}

pub fn is_minimum_track(upgrade: &str, minimum: &str) -> bool {
    match (track_rank(upgrade), track_rank(minimum)) {
        (Some(item), Some(min)) => item >= min,
        _ => false,
    }
}

pub fn upgrade_track_max() -> u64 {
    let tracks = UPGRADE_TRACKS.read().unwrap();
    let mut counts: HashMap<u64, usize> = HashMap::new();
    for (_, _, max) in tracks.keys() {
        *counts.entry(*max).or_default() += 1;
    }
    counts
        .into_iter()
        .max_by_key(|(_, count)| *count)
        .map(|(max, _)| max)
        .unwrap_or(6)
}

pub fn resolve_bonuses(bonus_ids: &[u64], bonuses_map: &HashMap<u64, BonusData>) -> BonusResolved {
    let mut result = BonusResolved::default();
    let mut upgrade_ilevel: Option<i64> = None;
    let mut level_offset: i64 = 0;
    let mut ilevel_priority: i64 = -1;

    for bid in bonus_ids {
        if let Some(bonus) = bonuses_map.get(bid) {
            if let Some(q) = bonus.quality {
                result.quality = Some(q as i64);
            }
            if let Some(il_obj) = &bonus.ilevel {
                let priority = il_obj.priority.unwrap_or(0);
                if priority >= ilevel_priority {
                    if let Some(amount) = il_obj.amount {
                        result.ilevel = Some(amount as i64);
                        ilevel_priority = priority;
                    }
                }
            }
            if let Some(offset) = &bonus.offset {
                level_offset += offset.amount.unwrap_or(0);
            }
            if let Some(tag) = &bonus.tag {
                let tag_str: &str = tag;
                result.tag = Some(tag_str.to_string());
            }
            if let Some(socket) = bonus.socket {
                result.sockets = Some(socket);
            }
            if let Some(upgrade) = &bonus.upgrade {
                if let Some(full_name) = &upgrade.full_name {
                    let name_str: &str = full_name;
                    result.upgrade = Some(name_str.to_string());
                }
                if let Some(il) = upgrade.ilevel {
                    upgrade_ilevel = Some(il as i64);
                }
                if let Some(sid) = upgrade.season_id {
                    result.season_id = Some(sid as i64);
                }
            }
        }
    }

    if let Some(il) = upgrade_ilevel {
        result.ilevel = Some(il);
    }

    if level_offset != 0 {
        if let Some(il) = result.ilevel {
            result.ilevel = Some((il + level_offset).max(0));
        }
    }

    result
}

fn map_raw_stat_to_effect_name(raw: &str) -> Option<&'static str> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "runspeed" | "speed" => Some("Speed"),
        "leech" => Some("Leech"),
        "avoidance" => Some("Avoidance"),
        "indestructible" => Some("Indestructible"),
        _ => None,
    }
}

fn map_bonus_id_to_effect_name(bid: u64) -> Option<&'static str> {
    match bid {
        42 => Some("Speed"),
        43 => Some("Indestructible"),
        // Common tertiary ids observed across datasets.
        40 => Some("Leech"),
        41 => Some("Avoidance"),
        _ => None,
    }
}

fn push_effect_if_any(raw: &str, effects: &mut Vec<String>) -> bool {
    if let Some(name) = map_raw_stat_to_effect_name(raw) {
        let label = name.to_string();
        if !effects.contains(&label) {
            effects.push(label);
        }
        return true;
    }
    false
}

fn collect_effects_from_raw_stats(raw_stats: Option<&Value>, effects: &mut Vec<String>) -> bool {
    let Some(value) = raw_stats else {
        return false;
    };
    let mut found = false;
    match value {
        Value::String(s) => {
            found |= push_effect_if_any(s, effects);
        }
        Value::Array(arr) => {
            for entry in arr {
                match entry {
                    Value::String(s) => {
                        found |= push_effect_if_any(s, effects);
                    }
                    Value::Object(map) => {
                        if let Some(stat) = map.get("stat").and_then(|v| v.as_str()) {
                            found |= push_effect_if_any(stat, effects);
                        }
                        for key in map.keys() {
                            found |= push_effect_if_any(key, effects);
                        }
                    }
                    _ => {}
                }
            }
        }
        Value::Object(map) => {
            if let Some(stat) = map.get("stat").and_then(|v| v.as_str()) {
                found |= push_effect_if_any(stat, effects);
            }
            for key in map.keys() {
                found |= push_effect_if_any(key, effects);
            }
        }
        _ => {}
    }
    found
}

pub fn resolve_extra_effects(
    bonus_ids: &[u64],
    bonuses_map: &HashMap<u64, BonusData>,
) -> Vec<String> {
    let mut effects: Vec<String> = Vec::new();

    for bid in bonus_ids {
        let Some(bonus) = bonuses_map.get(bid) else {
            if let Some(name) = map_bonus_id_to_effect_name(*bid) {
                let label = name.to_string();
                if !effects.contains(&label) {
                    effects.push(label);
                }
            }
            continue;
        };
        if let Some(name) = map_bonus_id_to_effect_name(*bid) {
            let label = name.to_string();
            if !effects.contains(&label) {
                effects.push(label);
            }
            continue;
        }
        let found_from_raw = collect_effects_from_raw_stats(bonus.raw_stats.as_ref(), &mut effects);
        if found_from_raw {
            continue;
        }
        let tag = bonus
            .tag
            .as_ref()
            .map(|t| t.to_ascii_lowercase())
            .unwrap_or_default();
        for (needle, label) in [
            ("leech", "Leech"),
            ("speed", "Speed"),
            ("avoidance", "Avoidance"),
            ("indestructible", "Indestructible"),
        ] {
            if tag.contains(needle) {
                let label = label.to_string();
                if !effects.contains(&label) {
                    effects.push(label);
                }
            }
        }
    }

    effects
}

pub fn resolve_bonus_debug(
    bonus_ids: &[u64],
    bonuses_map: &HashMap<u64, BonusData>,
) -> ItemBonusDebug {
    let mut debug = ItemBonusDebug {
        bonus_ids: bonus_ids.to_vec(),
        ..ItemBonusDebug::default()
    };

    for bid in bonus_ids {
        let Some(bonus) = bonuses_map.get(bid) else {
            debug.unknown_bonus_ids.push(*bid);
            continue;
        };
        let is_server_side = bonus.serverside.unwrap_or(false);
        if is_server_side {
            debug.server_side_bonus_ids.push(*bid);
        }
        let mut tmp = Vec::new();
        let has_user_facing_raw =
            collect_effects_from_raw_stats(bonus.raw_stats.as_ref(), &mut tmp);
        let has_user_facing_tag = bonus
            .tag
            .as_ref()
            .map(|t| {
                let low = t.to_ascii_lowercase();
                low.contains("speed")
                    || low.contains("leech")
                    || low.contains("avoidance")
                    || low.contains("indestructible")
            })
            .unwrap_or(false);
        if is_server_side && !has_user_facing_raw && !has_user_facing_tag {
            debug.ignored_server_side_bonus_ids.push(*bid);
        }
    }

    debug
}

pub fn squish_ilevel(item_id: u64, ilevel: u64) -> u64 {
    let eras = SQUISH_ERAS.read().unwrap();
    let curves = ITEM_CURVES.read().unwrap();

    let curve_id = match eras.get(&item_id) {
        Some(&id) => id,
        None => return ilevel,
    };
    let points = match curves.get(&curve_id) {
        Some(p) => p,
        None => return ilevel,
    };

    for i in 0..points.len() {
        if points[i].0 == ilevel {
            return points[i].1;
        }
        if points[i].0 > ilevel {
            if i == 0 {
                return points[0].1;
            }
            let (x1, y1) = points[i - 1];
            let (x2, y2) = points[i];
            let ratio = (ilevel - x1) as f64 / (x2 - x1) as f64;
            return (y1 as f64 + ratio * (y2 as f64 - y1 as f64)).round() as u64;
        }
    }
    points.last().map(|p| p.1).unwrap_or(ilevel)
}
