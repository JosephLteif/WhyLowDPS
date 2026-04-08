use std::collections::HashMap;
use crate::types::{BonusResolved, BonusData};
use super::state::*;


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
    if let Some(tracks) = UPGRADE_TRACKS.get() {
        let mut counts: HashMap<u64, usize> = HashMap::new();
        for (_, _, max) in tracks.keys() {
            *counts.entry(*max).or_default() += 1;
        }
        counts
            .into_iter()
            .max_by_key(|(_, count)| *count)
            .map(|(max, _)| max)
            .unwrap_or(6)
    } else {
        6
    }
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
                result.sockets = Some(socket as i64);
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


pub fn squish_ilevel(item_id: u64, ilevel: u64) -> u64 {
    let eras = match SQUISH_ERAS.get() { Some(e) => e, None => return ilevel };
    let curves = match ITEM_CURVES.get() { Some(c) => c, None => return ilevel };

    let curve_id = match eras.get(&item_id) { Some(&id) => id, None => return ilevel };
    let points = match curves.get(&curve_id) { Some(p) => p, None => return ilevel };

    for i in 0..points.len() {
        if points[i].0 == ilevel { return points[i].1; }
        if points[i].0 > ilevel {
            if i == 0 { return points[0].1; }
            let (x1, y1) = points[i-1];
            let (x2, y2) = points[i];
            let ratio = (ilevel - x1) as f64 / (x2 - x1) as f64;
            return (y1 as f64 + ratio * (y2 as f64 - y1 as f64)).round() as u64;
        }
    }
    points.last().map(|p| p.1).unwrap_or(ilevel)
}
