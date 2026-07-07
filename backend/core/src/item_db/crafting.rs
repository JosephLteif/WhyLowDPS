use super::state::{
    CraftingReagentData, CraftingSlotData, ItemLimitMap, CRAFTING_LIMIT_CATS, CRAFTING_REAGENTS,
    CRAFTING_SLOTS, ITEMS,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::{Arc, RwLock};

static EMBELLISHMENT_OPTIONS_CACHE: once_cell::sync::Lazy<RwLock<HashMap<u64, Vec<Value>>>> =
    once_cell::sync::Lazy::new(|| RwLock::new(HashMap::new()));
static EMBELLISHMENT_INV_TYPE_CACHE: once_cell::sync::Lazy<RwLock<HashMap<i64, Vec<Value>>>> =
    once_cell::sync::Lazy::new(|| RwLock::new(HashMap::new()));

fn is_embellishment_slot(name: &str) -> bool {
    name.to_ascii_lowercase().contains("embellishment")
}

fn is_current_season_bonus(bonus_id: u64) -> bool {
    if bonus_id == 0 {
        return false;
    }
    let current_season = crate::item_db::current_season_id();
    let bonuses = super::state::BONUSES.read().unwrap();
    let Some(bonus) = bonuses.get(&bonus_id) else {
        // Keep unknown bonus ids eligible; crafting data sometimes ships before bonus metadata.
        return true;
    };
    let Some(upgrade) = bonus.upgrade.as_ref() else {
        return true;
    };
    let Some(season_id) = upgrade.season_id else {
        return true;
    };
    if current_season == 0 {
        return true;
    }
    season_id == current_season
}

fn reagent_matches_current_season(reagent: &CraftingReagentData) -> bool {
    if reagent.crafting_bonus_ids.is_empty() {
        return false;
    }
    reagent
        .crafting_bonus_ids
        .iter()
        .any(|bid| is_current_season_bonus(*bid))
}

fn reagent_item_levels(
    reagent: &CraftingReagentData,
    bonuses: &HashMap<u64, crate::types::BonusData>,
) -> Vec<u64> {
    reagent
        .crafting_bonus_ids
        .iter()
        .filter_map(|bid| bonuses.get(bid))
        .filter_map(|bonus| bonus.ilevel.as_ref().and_then(|ilevel| ilevel.amount))
        .collect()
}

fn current_track_ilevel(track_name: Option<String>, level: Option<u64>) -> Option<u64> {
    let track_name = track_name?;
    let level = level?;
    let tracks = crate::item_db::upgrade_tracks();
    tracks.iter().find_map(
        |((name, current_level, _max_level), (ilvl, _bonus_id, _quality))| {
            (name == &track_name && *current_level == level).then_some(*ilvl)
        },
    )
}

pub fn derive_crafted_item_levels(item_id: u64) -> Vec<u64> {
    let item = {
        let items = ITEMS.read().unwrap();
        items.get(&item_id).cloned()
    };
    let Some(item) = item else {
        return Vec::new();
    };
    let Some(profession) = item.profession.as_ref() else {
        return Vec::new();
    };

    let bonuses = super::state::BONUSES.read().unwrap();
    let slots = CRAFTING_SLOTS.read().unwrap();
    let reagents = CRAFTING_REAGENTS.read().unwrap();

    let mut levels: Vec<u64> = item
        .bonus_lists
        .iter()
        .copied()
        .filter(|bonus_id| !crate::item_db::is_upgrade_bonus(*bonus_id))
        .filter_map(|bonus_id| bonuses.get(&bonus_id))
        .filter_map(|bonus| bonus.ilevel.as_ref().and_then(|ilevel| ilevel.amount))
        .collect();
    let mut has_current_season_upgrade_reagent = false;

    for slot_ref in &profession.optional_crafting_slots {
        let Some(slot) = slots.get(&slot_ref.id) else {
            continue;
        };
        let latest_slot_expansion = slot
            .reagent_ids
            .iter()
            .filter_map(|reagent_id| reagents.get(reagent_id))
            .filter_map(|reagent| reagent.expansion)
            .max()
            .unwrap_or(0);

        for reagent_id in &slot.reagent_ids {
            let Some(reagent) = reagents.get(reagent_id) else {
                continue;
            };
            if !reagent_matches_current_season(reagent) {
                continue;
            }
            if latest_slot_expansion > 0
                && reagent.expansion.unwrap_or(latest_slot_expansion) != latest_slot_expansion
            {
                continue;
            }
            let reagent_levels = reagent_item_levels(reagent, &bonuses);
            if !reagent_levels.is_empty() {
                has_current_season_upgrade_reagent = true;
                levels.extend(reagent_levels);
            }
        }
    }

    levels.sort_unstable();
    levels.dedup();

    let champion_start =
        current_track_ilevel(crate::item_db::difficulty_track_name("normal"), Some(1));
    let myth_start = current_track_ilevel(crate::item_db::difficulty_track_name("mythic"), Some(1));
    let myth_apex = crate::item_db::difficulty_track_name("mythic").and_then(|track_name| {
        let tracks = crate::item_db::upgrade_tracks();
        let max_level = tracks
            .keys()
            .filter_map(|(name, _level, max)| (name == &track_name).then_some(*max))
            .max()?;
        (max_level > 1)
            .then_some(max_level - 1)
            .and_then(|apex_level| current_track_ilevel(Some(track_name), Some(apex_level)))
    });

    let has_full_current_season_crafted_ladder = champion_start
        .zip(myth_start)
        .is_some_and(|(champion, myth)| levels.contains(&champion) && levels.contains(&myth));

    if has_full_current_season_crafted_ladder {
        if let Some(apex) = myth_apex {
            if apex > levels.last().copied().unwrap_or(0) {
                levels.push(apex);
            }
        }
    }

    if has_current_season_upgrade_reagent {
        if let Some(champion_floor) =
            current_track_ilevel(crate::item_db::difficulty_track_name("normal"), Some(1))
        {
            if champion_floor > levels.last().copied().unwrap_or(0) {
                levels.push(champion_floor);
            }
        }
    }

    levels.sort_unstable();
    levels.dedup();
    levels
}

pub fn load_crafting(data_dir: &Path) {
    let path = data_dir.join("crafting.json");
    if !path.exists() {
        *CRAFTING_SLOTS.write().unwrap() = Arc::new(HashMap::new());
        *CRAFTING_REAGENTS.write().unwrap() = Arc::new(HashMap::new());
        *CRAFTING_LIMIT_CATS.write().unwrap() = Arc::new(HashMap::new());
        EMBELLISHMENT_OPTIONS_CACHE.write().unwrap().clear();
        EMBELLISHMENT_INV_TYPE_CACHE.write().unwrap().clear();
        return;
    }

    let file = match fs::File::open(&path) {
        Ok(f) => f,
        Err(_) => return,
    };

    let data: Value =
        serde_json::from_reader(std::io::BufReader::new(file)).unwrap_or_else(|_| json!({}));

    let mut slots: HashMap<u64, CraftingSlotData> = HashMap::new();
    let raw_slots = data
        .get("slots")
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();
    for (key, slot_value) in raw_slots {
        let Ok(mut slot) = serde_json::from_value::<CraftingSlotData>(slot_value) else {
            continue;
        };
        let slot_id = if slot.reagent_slot_id > 0 {
            slot.reagent_slot_id
        } else {
            key.parse::<u64>().unwrap_or(0)
        };
        if slot_id == 0 {
            continue;
        }
        slot.reagent_slot_id = slot_id;
        slots.insert(slot_id, slot);
    }

    let mut reagents: HashMap<u64, CraftingReagentData> = HashMap::new();
    let mut crafting_limits: ItemLimitMap = HashMap::new();
    let raw_reagents = data
        .get("reagents")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    for reagent_value in raw_reagents {
        let Ok(mut reagent) = serde_json::from_value::<CraftingReagentData>(reagent_value) else {
            continue;
        };
        if reagent.id == 0 {
            continue;
        }
        if reagent.item_id.unwrap_or(0) == 0 {
            reagent.item_id = Some(reagent.id);
        }

        if let Some(limit) = &reagent.item_limit {
            if limit.category > 0 && limit.quantity > 0 {
                for bonus_id in &reagent.crafting_bonus_ids {
                    crafting_limits.insert(*bonus_id, (limit.category, limit.quantity));
                }
            }
        }

        reagents.insert(reagent.id, reagent);
    }

    *CRAFTING_SLOTS.write().unwrap() = Arc::new(slots);
    *CRAFTING_REAGENTS.write().unwrap() = Arc::new(reagents);
    *CRAFTING_LIMIT_CATS.write().unwrap() = Arc::new(crafting_limits);
    EMBELLISHMENT_OPTIONS_CACHE.write().unwrap().clear();
    EMBELLISHMENT_INV_TYPE_CACHE.write().unwrap().clear();
}

pub fn get_crafting_limit_categories() -> HashMap<u64, (u64, u64)> {
    CRAFTING_LIMIT_CATS.read().unwrap().as_ref().clone()
}

pub fn list_embellishments_for_item(item_id: u64) -> Vec<Value> {
    if let Some(cached) = EMBELLISHMENT_OPTIONS_CACHE.read().unwrap().get(&item_id) {
        return cached.clone();
    }

    let item = {
        let items = ITEMS.read().unwrap();
        items.get(&item_id).cloned()
    };
    let Some(item) = item else {
        let options = Vec::new();
        EMBELLISHMENT_OPTIONS_CACHE
            .write()
            .unwrap()
            .insert(item_id, options.clone());
        return options;
    };
    let Some(profession) = item.profession.as_ref() else {
        let options = Vec::new();
        EMBELLISHMENT_OPTIONS_CACHE
            .write()
            .unwrap()
            .insert(item_id, options.clone());
        return options;
    };

    let collect_for_slots = |slot_ids: &[u64]| -> HashMap<String, CraftingReagentData> {
        let slots = CRAFTING_SLOTS.read().unwrap();
        let reagents = CRAFTING_REAGENTS.read().unwrap();
        let mut by_item_id: HashMap<String, CraftingReagentData> = HashMap::new();

        for slot_id in slot_ids {
            if *slot_id == 0 {
                continue;
            }
            let Some(slot) = slots.get(slot_id) else {
                continue;
            };
            if !is_embellishment_slot(&slot.name) {
                continue;
            }

            for reagent_id in &slot.reagent_ids {
                let Some(reagent) = reagents.get(reagent_id) else {
                    continue;
                };
                if !reagent.reagent_type.is_empty() && reagent.reagent_type != "item" {
                    continue;
                }
                if reagent.crafting_bonus_ids.is_empty() {
                    continue;
                }

                let key = format!(
                    "{}|{}",
                    reagent.name.to_ascii_lowercase(),
                    reagent
                        .crafting_bonus_ids
                        .iter()
                        .map(|id| id.to_string())
                        .collect::<Vec<_>>()
                        .join("/")
                );
                let should_replace = by_item_id
                    .get(&key)
                    .is_none_or(|existing| reagent.quality > existing.quality);
                if should_replace {
                    by_item_id.insert(key, reagent.clone());
                }
            }
        }
        by_item_id
    };

    let mut slot_ids: Vec<u64> = profession
        .optional_crafting_slots
        .iter()
        .map(|s| s.id)
        .collect();
    let mut by_item_id = collect_for_slots(&slot_ids);

    // Fallback: if direct optional slots failed, infer from other crafted items of the same
    // inventory type (e.g. neck/ring) so user can still choose valid embellishments.
    let mut fallback_from_inventory_cache = false;
    if by_item_id.is_empty() {
        let inv_type = item.inventory_type.unwrap_or(0);
        if let Some(options) = EMBELLISHMENT_INV_TYPE_CACHE.read().unwrap().get(&inv_type) {
            EMBELLISHMENT_OPTIONS_CACHE
                .write()
                .unwrap()
                .insert(item_id, options.clone());
            return options.clone();
        } else {
            let items = ITEMS.read().unwrap();
            for candidate in items.values() {
                if candidate.id == item.id {
                    continue;
                }
                if candidate.inventory_type.unwrap_or(0) != inv_type {
                    continue;
                }
                let Some(c_prof) = candidate.profession.as_ref() else {
                    continue;
                };
                for s in &c_prof.optional_crafting_slots {
                    slot_ids.push(s.id);
                }
            }
            by_item_id = collect_for_slots(&slot_ids);
            fallback_from_inventory_cache = true;
        }
    }

    // Keep latest expansion options when expansion metadata exists.
    let latest_expansion = by_item_id
        .values()
        .filter_map(|r| r.expansion)
        .max()
        .unwrap_or(0);
    if latest_expansion > 0 {
        by_item_id
            .retain(|_, reagent| reagent.expansion.unwrap_or(latest_expansion) == latest_expansion);
    }

    let mut options: Vec<Value> = by_item_id
        .into_values()
        .map(|reagent| {
            let mut value = json!({
                "id": reagent.id,
                "item_id": reagent.item_id.unwrap_or(reagent.id),
                "name": reagent.name,
                "icon": reagent.icon,
                "quality": reagent.quality,
                "bonus_ids": reagent.crafting_bonus_ids,
            });
            if let Some(limit) = reagent.item_limit {
                if limit.category > 0 {
                    value["item_limit_category"] = json!(limit.category);
                }
                if limit.quantity > 0 {
                    value["item_limit_quantity"] = json!(limit.quantity);
                }
            }
            value
        })
        .collect();

    options.sort_by(|a, b| {
        let an = a.get("name").and_then(|v| v.as_str()).unwrap_or("");
        let bn = b.get("name").and_then(|v| v.as_str()).unwrap_or("");
        an.cmp(bn)
    });

    EMBELLISHMENT_OPTIONS_CACHE
        .write()
        .unwrap()
        .insert(item_id, options.clone());
    if fallback_from_inventory_cache {
        let inv_type = item.inventory_type.unwrap_or(0);
        EMBELLISHMENT_INV_TYPE_CACHE
            .write()
            .unwrap()
            .insert(inv_type, options.clone());
    }

    options
}

fn missive_tokens_from_name(name: &str) -> Option<Vec<&'static str>> {
    let n = name.to_ascii_lowercase();
    if n.contains("aurora") {
        return Some(vec!["mastery", "versatility"]);
    }
    if n.contains("feverflare") {
        return Some(vec!["crit", "mastery"]);
    }
    if n.contains("fireflash") {
        return Some(vec!["crit", "haste"]);
    }
    if n.contains("harmonious") {
        return Some(vec!["haste", "versatility"]);
    }
    if n.contains("peerless") {
        return Some(vec!["crit", "versatility"]);
    }
    if n.contains("quickblade") {
        return Some(vec!["haste", "mastery"]);
    }
    None
}

fn stat_id_to_token(stat_id: u64) -> Option<&'static str> {
    match stat_id {
        32 => Some("crit"),
        36 => Some("haste"),
        49 => Some("mastery"),
        40 => Some("versatility"),
        _ => None,
    }
}

fn stat_token_to_label(token: &str) -> Option<&'static str> {
    match token {
        "crit" => Some("Critical Strike"),
        "haste" => Some("Haste"),
        "mastery" => Some("Mastery"),
        "versatility" => Some("Versatility"),
        _ => None,
    }
}

pub fn list_current_missives() -> Vec<Value> {
    let reagents = CRAFTING_REAGENTS.read().unwrap();
    let bonuses = super::state::BONUSES.read().unwrap();
    let mut by_token: HashMap<String, Value> = HashMap::new();

    for reagent in reagents.values() {
        if !reagent_matches_current_season(reagent) {
            continue;
        }
        let mut stat_tokens: Vec<&'static str> = reagent
            .crafting_bonus_ids
            .iter()
            .filter_map(|bonus_id| bonuses.get(bonus_id))
            .flat_map(|bonus| bonus.crafted_stats.iter().copied())
            .filter_map(stat_id_to_token)
            .collect();

        if stat_tokens.is_empty() {
            let lname = reagent.name.to_ascii_lowercase();
            if !lname.contains("missive") {
                continue;
            }
            let Some(tokens_from_name) = missive_tokens_from_name(&reagent.name) else {
                continue;
            };
            stat_tokens = tokens_from_name;
        }

        stat_tokens.sort_unstable();
        stat_tokens.dedup();
        let token = stat_tokens.join("/");
        let labels: Vec<&str> = stat_tokens
            .iter()
            .filter_map(|t| stat_token_to_label(t))
            .collect();
        if labels.is_empty() {
            continue;
        }
        let label = labels.join(" / ");
        let payload = json!({
            "token": token,
            "label": label,
            "bonus_ids": reagent.crafting_bonus_ids,
            "item_id": reagent.item_id.unwrap_or(reagent.id),
            "icon": reagent.icon,
            "quality": reagent.quality,
            "stat_count": stat_tokens.len(),
        });
        let should_replace = by_token.get(&token).is_none_or(|existing| {
            existing
                .get("quality")
                .and_then(|v| v.as_u64())
                .unwrap_or(0)
                < reagent.quality
        });
        if should_replace {
            by_token.insert(token, payload);
        }
    }

    if by_token.is_empty() {
        return vec![
            json!({ "token": "crit/haste", "label": "Critical Strike / Haste", "bonus_ids": [] }),
            json!({ "token": "crit/mastery", "label": "Critical Strike / Mastery", "bonus_ids": [] }),
            json!({ "token": "crit/versatility", "label": "Critical Strike / Versatility", "bonus_ids": [] }),
            json!({ "token": "haste/mastery", "label": "Haste / Mastery", "bonus_ids": [] }),
            json!({ "token": "haste/versatility", "label": "Haste / Versatility", "bonus_ids": [] }),
            json!({ "token": "mastery/versatility", "label": "Mastery / Versatility", "bonus_ids": [] }),
        ];
    }

    let mut out: Vec<Value> = by_token.into_values().collect();
    out.sort_by(|a, b| {
        let an = a.get("label").and_then(|v| v.as_str()).unwrap_or("");
        let bn = b.get("label").and_then(|v| v.as_str()).unwrap_or("");
        an.cmp(bn)
    });
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::item_db::state::{BONUSES, CRAFTING_REAGENTS, CURRENT_SEASON_ID};
    use crate::types::{BonusData, BonusUpgrade};

    struct StateSnapshot {
        bonuses: Arc<HashMap<u64, crate::types::BonusData>>,
        crafting_reagents: Arc<HashMap<u64, CraftingReagentData>>,
        current_season_id: u64,
    }

    impl StateSnapshot {
        fn capture() -> Self {
            Self {
                bonuses: BONUSES.read().unwrap().clone(),
                crafting_reagents: CRAFTING_REAGENTS.read().unwrap().clone(),
                current_season_id: *CURRENT_SEASON_ID.read().unwrap(),
            }
        }

        fn restore(self) {
            *BONUSES.write().unwrap() = self.bonuses;
            *CRAFTING_REAGENTS.write().unwrap() = self.crafting_reagents;
            *CURRENT_SEASON_ID.write().unwrap() = self.current_season_id;
        }
    }

    fn reagent(
        id: u64,
        name: &str,
        quality: u64,
        item_id: Option<u64>,
        bonus_ids: Vec<u64>,
    ) -> CraftingReagentData {
        CraftingReagentData {
            id,
            name: name.to_string(),
            icon: format!("icon_{id}"),
            quality,
            item_id,
            crafting_bonus_ids: bonus_ids,
            reagent_type: "item".to_string(),
            expansion: Some(10),
            ..CraftingReagentData::default()
        }
    }

    #[test]
    fn list_current_missives_prefers_highest_quality_and_sorts_labels() {
        let _lock = crate::item_db::state::TEST_STATE_LOCK.lock().unwrap();
        let snapshot = StateSnapshot::capture();

        *CURRENT_SEASON_ID.write().unwrap() = 5;
        *BONUSES.write().unwrap() = Arc::new(HashMap::from([
            (
                100_u64,
                BonusData {
                    crafted_stats: vec![36, 32],
                    upgrade: Some(BonusUpgrade {
                        season_id: Some(5),
                        ..BonusUpgrade::default()
                    }),
                    ..BonusData::default()
                },
            ),
            (
                101_u64,
                BonusData {
                    crafted_stats: vec![40, 49],
                    upgrade: Some(BonusUpgrade {
                        season_id: Some(5),
                        ..BonusUpgrade::default()
                    }),
                    ..BonusData::default()
                },
            ),
            (
                102_u64,
                BonusData {
                    crafted_stats: vec![32, 49],
                    upgrade: Some(BonusUpgrade {
                        season_id: Some(4),
                        ..BonusUpgrade::default()
                    }),
                    ..BonusData::default()
                },
            ),
        ]));
        *CRAFTING_REAGENTS.write().unwrap() = Arc::new(HashMap::from([
            (
                1_u64,
                reagent(1, "Lower Fireflash Missive", 1, Some(2001), vec![100]),
            ),
            (
                2_u64,
                reagent(2, "Better Fireflash Missive", 3, Some(2002), vec![100]),
            ),
            (3_u64, reagent(3, "Aurora Missive", 2, None, vec![101])),
            (4_u64, reagent(4, "Stale Missive", 5, Some(2004), vec![102])),
        ]));

        let missives = list_current_missives();

        assert_eq!(missives.len(), 2);
        assert_eq!(missives[0]["token"], "crit/haste");
        assert_eq!(missives[0]["label"], "Critical Strike / Haste");
        assert_eq!(missives[0]["quality"], 3);
        assert_eq!(missives[0]["item_id"], 2002);

        assert_eq!(missives[1]["token"], "mastery/versatility");
        assert_eq!(missives[1]["label"], "Mastery / Versatility");
        assert_eq!(missives[1]["item_id"], 3);

        snapshot.restore();
    }

    #[test]
    fn list_current_missives_falls_back_to_name_tokens_and_defaults_when_empty() {
        let _lock = crate::item_db::state::TEST_STATE_LOCK.lock().unwrap();
        let snapshot = StateSnapshot::capture();

        *CURRENT_SEASON_ID.write().unwrap() = 9;
        *BONUSES.write().unwrap() = Arc::new(HashMap::from([(
            300_u64,
            BonusData {
                crafted_stats: vec![],
                upgrade: Some(BonusUpgrade {
                    season_id: Some(9),
                    ..BonusUpgrade::default()
                }),
                ..BonusData::default()
            },
        )]));
        *CRAFTING_REAGENTS.write().unwrap() = Arc::new(HashMap::from([(
            30_u64,
            reagent(30, "Peerless Missive", 4, Some(3030), vec![300]),
        )]));

        let missives = list_current_missives();
        assert_eq!(missives.len(), 1);
        assert_eq!(missives[0]["token"], "crit/versatility");
        assert_eq!(missives[0]["label"], "Critical Strike / Versatility");
        assert_eq!(missives[0]["quality"], 4);

        *CRAFTING_REAGENTS.write().unwrap() = Arc::new(HashMap::new());
        let defaults = list_current_missives();
        assert_eq!(defaults.len(), 6);
        assert_eq!(defaults[0]["token"], "crit/haste");
        assert_eq!(defaults[5]["token"], "mastery/versatility");

        snapshot.restore();
    }
}
