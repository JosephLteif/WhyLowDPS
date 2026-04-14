use super::bonuses::upgrade_track_max;
use super::state::*;
use serde_json::{json, Value};
use std::collections::HashMap;

pub fn encounter_upgrade_level(encounter_id: i64) -> Option<u64> {
    let cfg = super::season_cfg();

    // Current config shape: explicit encounter -> upgrade level map.
    if let Some(map) = cfg.get("encounterUpgradeLevel").and_then(|v| v.as_object()) {
        if let Some(level) = map.get(&encounter_id.to_string()).and_then(|v| v.as_u64()) {
            return Some(level);
        }
    }

    // Legacy fallback shape.
    if let Some(raid_diffs) = cfg.get("raidDifficulties").and_then(|v| v.as_array()) {
        for diff in raid_diffs {
            let encounters = match diff.get("encounters").and_then(|v| v.as_array()) {
                Some(v) => v,
                None => continue,
            };
            for e in encounters {
                if e.as_i64() == Some(encounter_id) {
                    if let Some(level) = diff.get("upgradeLevel").and_then(|v| v.as_u64()) {
                        return Some(level);
                    }
                }
            }
        }
    }
    None
}

pub fn difficulty_track_name(difficulty: &str) -> Option<String> {
    let cfg = super::season_cfg();
    let raid_diffs = cfg.get("raidDifficulties")?.as_array()?;
    for diff in raid_diffs {
        let key = diff.get("key").and_then(|n| n.as_str());
        let legacy_name = diff.get("name").and_then(|n| n.as_str());
        if key == Some(difficulty) || legacy_name == Some(difficulty) {
            return diff
                .get("track")
                .and_then(|t| t.as_str())
                .map(|s| s.to_string());
        }
    }
    None
}

pub fn dungeon_normal_ilvl() -> u64 {
    super::season_cfg()
        .get("dungeonNormalIlvl")
        .and_then(|v| v.as_u64())
        .unwrap_or(554)
}

pub fn dungeon_normal_quality() -> u64 {
    super::season_cfg()
        .get("dungeonNormalQuality")
        .and_then(|v| v.as_u64())
        .unwrap_or(3)
}

pub fn get_upgrade_tracks() -> Value {
    let tracks = UPGRADE_TRACKS.read().unwrap();
    let mut result = Vec::new();
    let mut tracks_vec: Vec<_> = tracks.iter().collect();
    tracks_vec.sort_by(|((n1, l1, m1), _), ((n2, l2, m2), _)| {
        n1.cmp(n2).then(l1.cmp(l2)).then(m1.cmp(m2))
    });

    for ((name, level, max), (ilvl, bonus_id, quality)) in tracks_vec {
        result.push(json!({
            "name": name,
            "level": level,
            "max": max,
            "itemLevel": ilvl,
            "bonus_id": bonus_id,
            "quality": quality,
        }));
    }
    json!(result)
}

pub fn upgrade_bonus_ids_to_max(bonus_ids: &[u64]) -> Vec<u64> {
    let max_map = UPGRADE_MAX.read().unwrap();

    let mut result = Vec::new();
    for &bid in bonus_ids {
        if let Some(&max_bid) = max_map.get(&bid) {
            result.push(max_bid);
        } else {
            result.push(bid);
        }
    }
    result
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct UpgradeOption {
    pub level: u64,
    pub max_level: u64,
    pub ilevel: u64,
    pub bonus_id: u64,
    pub quality: u64,
    pub name: String,
    pub cumulative_costs: HashMap<u64, u64>,
}

pub fn get_upgrade_options(bonus_ids: &[u64]) -> Vec<UpgradeOption> {
    let bonuses = BONUSES.read().unwrap();
    let tracks = UPGRADE_TRACKS.read().unwrap();
    let max_level = upgrade_track_max();

    let mut current_track: Option<(String, u64, u64)> = None;
    for &bid in bonus_ids {
        if let Some(bonus) = bonuses.get(&bid) {
            if let Some(upgrade) = &bonus.upgrade {
                if let (Some(full_name), Some(group), Some(level)) =
                    (&upgrade.full_name, upgrade.group, upgrade.level)
                {
                    if let Some(pos) = full_name.find(' ') {
                        let name = &full_name[..pos];
                        current_track = Some((name.to_string(), group, level));
                        break;
                    }
                }
            }
        }
    }

    let (track_name, group_id, current_level) = match current_track {
        Some(t) => t,
        None => return vec![],
    };

    let mut options = Vec::new();
    // Include the current level as the first option so UIs can identify
    // which existing bonus_id should be replaced when applying an upgrade.
    for l in current_level..=max_level {
        if let Some(&(ilvl, bonus_id, quality)) = tracks.get(&(track_name.clone(), l, max_level)) {
            // Calculate cumulative costs from current_level to l
            let mut cumulative_costs = HashMap::new();
            {
                let costs_map = UPGRADE_STEP_COSTS.read().unwrap();
                for bid in bonuses.keys() {
                    if let Some(b) = bonuses.get(bid) {
                        if let Some(u) = &b.upgrade {
                            if u.group == Some(group_id)
                                && u.level.is_some_and(|lvl| lvl > current_level && lvl <= l)
                            {
                                if let Some(step_cost) = costs_map.get(bid) {
                                    for (&cid, &amt) in step_cost {
                                        *cumulative_costs.entry(cid).or_default() += amt;
                                    }
                                }
                            }
                        }
                    }
                }
            }

            options.push(UpgradeOption {
                level: l,
                max_level,
                ilevel: ilvl,
                bonus_id,
                quality,
                name: format!("{} {}/{}", track_name, l, max_level),
                cumulative_costs,
            });
        }
    }
    options
}

pub fn get_upgrade_cost_between(from_bonus_id: u64, to_bonus_id: u64) -> HashMap<u64, u64> {
    let bonuses = BONUSES.read().unwrap();
    let costs_map = UPGRADE_STEP_COSTS.read().unwrap();

    let mut from_info = None;
    let mut to_info = None;

    if let Some(bonus) = bonuses.get(&from_bonus_id) {
        if let Some(u) = &bonus.upgrade {
            if let (Some(g), Some(l)) = (u.group, u.level) {
                from_info = Some((g, l));
            }
        }
    }
    if let Some(bonus) = bonuses.get(&to_bonus_id) {
        if let Some(u) = &bonus.upgrade {
            if let (Some(g), Some(l)) = (u.group, u.level) {
                to_info = Some((g, l));
            }
        }
    }

    let (group, start_level, end_level) = match (from_info, to_info) {
        (Some((g1, l1)), Some((g2, l2))) if g1 == g2 && l2 > l1 => (g1, l1, l2),
        _ => return HashMap::new(),
    };

    let mut total_costs = HashMap::new();
    for bid in bonuses.keys() {
        if let Some(bonus) = bonuses.get(bid) {
            if let Some(u) = &bonus.upgrade {
                if u.group == Some(group)
                    && u.level.is_some_and(|l| l > start_level && l <= end_level)
                {
                    if let Some(step_cost) = costs_map.get(bid) {
                        for (&cid, &amt) in step_cost {
                            *total_costs.entry(cid).or_default() += amt;
                        }
                    }
                }
            }
        }
    }
    total_costs
}

pub fn get_currency_info(currency_id: u64) -> Option<(String, String)> {
    CURRENCY_INFO.read().unwrap().get(&currency_id).cloned()
}

pub fn upgrade_simc_input(input: &str) -> String {
    let mut output = String::new();
    for line in input.lines() {
        if line.starts_with("#") || line.trim().is_empty() {
            output.push_str(line);
            output.push('\n');
            continue;
        }
        if let Some(idx) = line.find(",bonus_id=") {
            let prefix = &line[..idx + 10];
            let rest = &line[idx + 10..];
            let end_idx = rest.find(',').unwrap_or(rest.len());
            let bonus_str = &rest[..end_idx];
            let suffix = &rest[end_idx..];

            let bids: Vec<u64> = bonus_str
                .split('/')
                .filter_map(|s| s.parse().ok())
                .collect();
            let upgraded = upgrade_bonus_ids_to_max(&bids);
            let upgraded_str = upgraded
                .iter()
                .map(|b| b.to_string())
                .collect::<Vec<_>>()
                .join("/");

            output.push_str(prefix);
            output.push_str(&upgraded_str);
            output.push_str(suffix);
        } else {
            output.push_str(line);
        }
        output.push('\n');
    }
    output
}

use crate::types::ResolvedItem;

pub fn upgrade_items_by_slot(
    mut items: HashMap<String, Vec<ResolvedItem>>,
) -> HashMap<String, Vec<ResolvedItem>> {
    for list in items.values_mut() {
        for item in list {
            let upgraded_bids = upgrade_bonus_ids_to_max(&item.bonus_ids);
            if upgraded_bids != item.bonus_ids {
                item.bonus_ids = upgraded_bids;
                // Update simc_string to match new bonus IDs
                let mut parts: Vec<String> = vec![format!("item={}", item.item_id)];
                parts.push(format!(
                    "bonus_id={}",
                    item.bonus_ids
                        .iter()
                        .map(|b| b.to_string())
                        .collect::<Vec<_>>()
                        .join("/")
                ));
                if item.enchant_id > 0 {
                    parts.push(format!("enchant_id={}", item.enchant_id));
                }
                if item.gem_id > 0 {
                    parts.push(format!("gem_id={}", item.gem_id));
                }
                item.simc_string = parts.join(",");

                // Re-resolve display info (ilevel, etc)
                if let Some(info) = super::get_item_info(item.item_id, Some(&item.bonus_ids)) {
                    item.ilevel = info.ilevel;
                    item.quality = info.quality;
                    item.tag = info.tag;
                    item.upgrade = info.upgrade;
                    item.sockets = info.sockets;
                }
            }
        }
    }
    items
}
