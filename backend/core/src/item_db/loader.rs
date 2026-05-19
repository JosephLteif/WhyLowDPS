use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

use super::state::*;
use crate::types::class_data;
use crate::types::{class_data::ClassDef, class_data::SpecDef, BonusData, EnchantData, GameItem};
use std::sync::Arc;

pub fn load_items(data_dir: &Path) {
    let compact = data_dir.join("equippable-items.json");
    let full = data_dir.join("equippable-items-full.json");
    let path = if compact.exists() {
        compact
    } else if full.exists() {
        full
    } else {
        return;
    };

    let file = match fs::File::open(&path) {
        Ok(f) => f,
        Err(e) => {
            eprintln!("Failed to open items file {}: {}", path.display(), e);
            return;
        }
    };

    let data: Vec<GameItem> = serde_json::from_reader(std::io::BufReader::new(file))
        .unwrap_or_else(|e| {
            eprintln!("Failed to deserialize items JSON: {}", e);
            Vec::new()
        });

    let map: HashMap<u64, GameItem> = data.into_iter().map(|v| (v.id, v)).collect();
    println!("Loaded {} items", map.len());
    *ITEMS.write().unwrap() = Arc::new(map);
}

pub fn load_enchants(data_dir: &Path) {
    let path = data_dir.join("enchantments.json");
    if !path.exists() {
        return;
    }

    let file = match fs::File::open(&path) {
        Ok(f) => f,
        Err(_) => return,
    };

    let data: Vec<EnchantData> =
        serde_json::from_reader(std::io::BufReader::new(file)).unwrap_or_default();

    let by_id: HashMap<u64, EnchantData> = data.iter().map(|v| (v.id, v.clone())).collect();

    let by_item_id: HashMap<u64, EnchantData> = data
        .into_iter()
        .filter_map(|v| {
            let item_id = v.item_id?;
            Some((item_id, v))
        })
        .collect();

    println!("Loaded {} enchants", by_id.len());
    *ENCHANTS.write().unwrap() = Arc::new(by_id);
    *ENCHANTS_BY_ITEM_ID.write().unwrap() = Arc::new(by_item_id);
}

pub fn load_bonuses(data_dir: &Path) {
    let path = data_dir.join("bonuses.json");
    if !path.exists() {
        return;
    }

    let file = match fs::File::open(&path) {
        Ok(f) => f,
        Err(_) => return,
    };

    let raw: HashMap<String, BonusData> =
        serde_json::from_reader(std::io::BufReader::new(file)).unwrap_or_default();

    let map: HashMap<u64, BonusData> = raw
        .into_iter()
        .filter_map(|(k, v)| {
            let id = k.parse::<u64>().ok()?;
            Some((id, v))
        })
        .collect();

    let mut groups: HashMap<u64, Vec<(u64, u64)>> = HashMap::new();
    let mut max_season_id: u64 = 0;

    for (bid, bonus) in &map {
        if let Some(upgrade) = &bonus.upgrade {
            if let (Some(group), Some(level)) = (upgrade.group, upgrade.level) {
                groups.entry(group).or_default().push((*bid, level));
            }
            if let Some(sid) = upgrade.season_id {
                if sid > max_season_id {
                    max_season_id = sid;
                }
            }
        }
    }

    *CURRENT_SEASON_ID.write().unwrap() = max_season_id;
    let mut upgrade_max: HashMap<u64, u64> = HashMap::new();
    for members in groups.values() {
        let max_bonus_id = members
            .iter()
            .max_by_key(|(_, level)| *level)
            .map(|(id, _)| *id)
            .unwrap_or(0);
        for (bid, _) in members {
            upgrade_max.insert(*bid, max_bonus_id);
        }
    }

    println!(
        "Loaded {} bonuses, {} upgrade groups",
        map.len(),
        groups.len()
    );
    *BONUSES.write().unwrap() = Arc::new(map);
    *UPGRADE_MAX.write().unwrap() = Arc::new(upgrade_max);
}

pub fn load_bus_and_seasons(data_dir: &Path) {
    let bus_path = data_dir.join("bonus-upgrade-sets.json");
    let seasons_path = data_dir.join("seasons.json");
    if !bus_path.exists() {
        return;
    }

    let bus_file = match fs::File::open(&bus_path) {
        Ok(f) => f,
        Err(_) => return,
    };

    let bus_raw: HashMap<String, Vec<Value>> =
        serde_json::from_reader(std::io::BufReader::new(bus_file)).unwrap_or_default();

    let mut active_groups: Option<Vec<u64>> = None;
    if seasons_path.exists() {
        let s_file = match fs::File::open(&seasons_path) {
            Ok(f) => f,
            Err(_) => {
                *BONUSES.write().unwrap() = Arc::new(HashMap::new());
                return;
            }
        };
        let seasons: Vec<Value> =
            serde_json::from_reader(std::io::BufReader::new(s_file)).unwrap_or_default();

        if let Some(active) = seasons
            .iter()
            .find(|s| s.get("active").and_then(|a| a.as_bool()).unwrap_or(false))
        {
            let groups: Vec<u64> = active
                .get("bonusListGroups")
                .and_then(|g| g.as_array())
                .map(|arr| arr.iter().filter_map(|v| v.as_u64()).collect())
                .unwrap_or_default();
            active_groups = Some(groups);
        }
    }

    let bonuses_map = BONUSES.read().unwrap();
    let mut tracks: HashMap<UpgradeTrackKey, UpgradeTrackValue> = HashMap::new();
    let mut step_costs: HashMap<u64, HashMap<u64, u64>> = HashMap::new();
    let mut currencies: HashMap<u64, (String, String)> = HashMap::new();

    for (group_id_str, entries) in &bus_raw {
        let group_id: u64 = group_id_str.parse().unwrap_or(0);
        if let Some(ref ag) = active_groups {
            if !ag.contains(&group_id) {
                continue;
            }
        }
        for entry in entries {
            let name = entry.get("name").and_then(|n| n.as_str()).unwrap_or("");
            let level = entry.get("level").and_then(|l| l.as_u64()).unwrap_or(0);
            let max_level = entry.get("max").and_then(|m| m.as_u64()).unwrap_or(0);
            let ilvl = entry.get("itemLevel").and_then(|i| i.as_u64()).unwrap_or(0);
            let bonus_id = entry.get("bonusId").and_then(|b| b.as_u64()).unwrap_or(0);

            let quality = bonuses_map
                .get(&bonus_id)
                .and_then(|b| b.quality)
                .unwrap_or(4);

            if !name.is_empty() && level > 0 && max_level > 0 && ilvl > 0 {
                tracks.insert(
                    (name.to_string(), level, max_level),
                    (ilvl, bonus_id, quality),
                );
            }

            if bonus_id > 0 {
                if let Some(currency) = entry.get("currency") {
                    let cid = currency.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
                    let amount = currency.get("amount").and_then(|v| v.as_u64()).unwrap_or(0);
                    if cid > 0 && amount > 0 {
                        step_costs.entry(bonus_id).or_default().insert(cid, amount);
                        currencies.entry(cid).or_insert_with(|| {
                            let n = currency
                                .get("name")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            let i = currency
                                .get("icon")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            (n, i)
                        });
                    }
                }
            }
        }
    }

    println!("Indexed {} upgrade track entries", tracks.len());
    *UPGRADE_TRACKS.write().unwrap() = Arc::new(tracks);
    *UPGRADE_STEP_COSTS.write().unwrap() = Arc::new(step_costs);
    *CURRENCY_INFO.write().unwrap() = Arc::new(currencies);
}

pub fn load_instances(data_dir: &Path) {
    let path = data_dir.join("instances.json");
    if !path.exists() {
        return;
    }

    let file = match fs::File::open(&path) {
        Ok(f) => f,
        Err(_) => return,
    };
    let data: Vec<Value> =
        serde_json::from_reader(std::io::BufReader::new(file)).unwrap_or_default();
    let mut inst = INSTANCES.write().unwrap();
    *inst = data;
}

pub fn load_encounter_drops() {
    let mut drops: HashMap<i64, Vec<GameItem>> = HashMap::new();
    let items_map = ITEMS.read().unwrap();
    for item in items_map.values() {
        if let Some(sources) = &item.sources {
            for src in sources {
                if let Some(eid) = src.encounter_id {
                    drops.entry(eid).or_default().push(item.clone());
                }
            }
        }
    }
    *DROPS_BY_ENCOUNTER.write().unwrap() = Arc::new(drops);
}

fn inferred_season_label() -> String {
    if let Some(name) = get_runtime_metadata()
        .get("season_name")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        return name.to_string();
    }

    let season_id = *CURRENT_SEASON_ID.read().unwrap();
    if season_id > 0 {
        format!("Season {}", season_id)
    } else {
        "Current Season".to_string()
    }
}

fn read_active_season_metadata(data_dir: &Path) -> (Option<String>, Option<u64>, Option<u64>) {
    let path = data_dir.join("seasons.json");
    if !path.exists() {
        return (None, None, None);
    }

    let file = match fs::File::open(&path) {
        Ok(f) => f,
        Err(_) => return (None, None, None),
    };
    let seasons: Vec<Value> =
        serde_json::from_reader(std::io::BufReader::new(file)).unwrap_or_default();

    let active = seasons
        .iter()
        .find(|s| s.get("active").and_then(|v| v.as_bool()) == Some(true))
        .or_else(|| seasons.first());

    let season_name = active
        .and_then(|s| s.get("name"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let catalyst_currency = active
        .and_then(|s| s.get("itemConversionCurrency"))
        .and_then(|v| v.as_u64());
    let conversion_group_id = active
        .and_then(|s| s.get("itemConversionId"))
        .and_then(|v| v.as_u64());

    (season_name, catalyst_currency, conversion_group_id)
}

fn read_conversion_bonus_id(data_dir: &Path, preferred_group_id: Option<u64>) -> Option<u64> {
    let path = data_dir.join("item-conversions.json");
    if !path.exists() {
        return None;
    }
    let file = fs::File::open(&path).ok()?;
    let data: HashMap<String, Value> =
        serde_json::from_reader(std::io::BufReader::new(file)).ok()?;

    let selected_group = preferred_group_id
        .and_then(|id| data.get(&id.to_string()))
        .or_else(|| {
            data.iter()
                .filter_map(|(k, v)| k.parse::<u64>().ok().map(|id| (id, v)))
                .max_by_key(|(id, _)| *id)
                .map(|(_, v)| v)
        })?;

    selected_group
        .get("bonusIds")
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.iter().find_map(|v| v.as_u64()))
}

fn track_rank_index(name: &str) -> usize {
    TRACK_RANKS
        .iter()
        .position(|rank| rank.eq_ignore_ascii_case(name))
        .unwrap_or(usize::MAX / 2)
}

fn available_track_names() -> Vec<String> {
    let tracks = UPGRADE_TRACKS.read().unwrap();
    let mut seen = HashSet::<String>::new();
    let mut names: Vec<String> = tracks
        .keys()
        .filter_map(|(name, _, _)| {
            let key = name.to_ascii_lowercase();
            if seen.insert(key) {
                Some(name.clone())
            } else {
                None
            }
        })
        .collect();
    names.sort_by_key(|name| track_rank_index(name));
    names
}

fn pick_track_name(preferred: &str, available_tracks: &[String]) -> String {
    if let Some(exact) = available_tracks
        .iter()
        .find(|name| name.eq_ignore_ascii_case(preferred))
    {
        return exact.clone();
    }
    if available_tracks.is_empty() {
        return preferred.to_string();
    }

    let preferred_rank = track_rank_index(preferred);
    available_tracks
        .iter()
        .min_by_key(|name| track_rank_index(name).abs_diff(preferred_rank))
        .cloned()
        .unwrap_or_else(|| preferred.to_string())
}

fn track_max_level(track_name: &str) -> u64 {
    let tracks = UPGRADE_TRACKS.read().unwrap();
    tracks
        .keys()
        .filter(|(name, _, _)| name.eq_ignore_ascii_case(track_name))
        .map(|(_, _, max)| *max)
        .max()
        .unwrap_or(0)
}

fn clamp_level(level: u64, max_level: u64) -> u64 {
    if max_level == 0 {
        level
    } else {
        level.clamp(1, max_level)
    }
}

fn slugify_key(label: &str) -> String {
    label
        .trim()
        .to_ascii_lowercase()
        .replace([' ', '_'], "-")
        .replace("--", "-")
}

fn localized_or_string(value: &Value) -> Option<String> {
    if let Some(s) = value.as_str() {
        let trimmed = s.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    let obj = value.as_object()?;
    if let Some(en) = obj.get("en_US").and_then(|v| v.as_str()) {
        let trimmed = en.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    obj.values().find_map(|v| {
        v.as_str().and_then(|s| {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        })
    })
}

fn parse_u64_flexible(value: &Value) -> Option<u64> {
    if let Some(v) = value.as_u64() {
        return Some(v);
    }
    let s = value.as_str()?.trim();
    if s.is_empty() {
        return None;
    }
    let head = s.split('/').next().unwrap_or("").trim();
    if !head.is_empty() {
        if let Ok(v) = head.parse::<u64>() {
            return Some(v);
        }
    }
    let digits: String = s.chars().take_while(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() {
        None
    } else {
        digits.parse::<u64>().ok()
    }
}

fn runtime_track_name(value: &Value) -> Option<String> {
    if let Some(s) = localized_or_string(value) {
        return Some(s);
    }
    let obj = value.as_object()?;
    if let Some(name) = obj.get("name").and_then(localized_or_string) {
        return Some(name);
    }
    if let Some(label) = obj.get("label").and_then(localized_or_string) {
        return Some(label);
    }
    obj.get("track").and_then(localized_or_string)
}

fn parse_runtime_difficulty_entry(
    entry: &Value,
    idx: usize,
    available_tracks: &[String],
) -> Option<Value> {
    let obj = entry.as_object()?;
    let label = obj
        .get("label")
        .or_else(|| obj.get("name"))
        .or_else(|| obj.get("difficultyLabel"))
        .and_then(localized_or_string)
        .unwrap_or_default();
    let key = obj
        .get("key")
        .and_then(localized_or_string)
        .or_else(|| {
            obj.get("id")
                .and_then(parse_u64_flexible)
                .map(|n| n.to_string())
        })
        .unwrap_or_else(|| {
            if label.is_empty() {
                format!("runtime-{}", idx)
            } else {
                slugify_key(&label)
            }
        });
    let label = if label.is_empty() { key.clone() } else { label };

    let track_raw = [
        "track",
        "trackName",
        "track_name",
        "upgradeTrack",
        "upgrade_track",
        "upgradeTrackName",
        "upgrade_track_name",
    ]
    .iter()
    .find_map(|k| obj.get(*k).and_then(runtime_track_name))
    .unwrap_or_default();
    if track_raw.trim().is_empty() {
        return None;
    }
    let track = pick_track_name(track_raw.trim(), available_tracks);
    let max_level = track_max_level(&track);
    let requested_level = [
        "level",
        "upgradeLevel",
        "upgrade_level",
        "trackLevel",
        "track_level",
    ]
    .iter()
    .find_map(|k| obj.get(*k).and_then(parse_u64_flexible))
    .unwrap_or(1);
    let level = clamp_level(requested_level.max(1), max_level);
    let sort_order = ["sortOrder", "sort_order", "order", "position"]
        .iter()
        .find_map(|k| obj.get(*k).and_then(parse_u64_flexible))
        .unwrap_or(100 + idx as u64);

    let mut out = serde_json::Map::new();
    out.insert("key".to_string(), json!(key));
    out.insert("label".to_string(), json!(label));
    out.insert("track".to_string(), json!(track));
    out.insert("level".to_string(), json!(level));
    out.insert("sortOrder".to_string(), json!(sort_order));
    if let Some(v) = obj.get("fixedIlvl").and_then(parse_u64_flexible) {
        out.insert("fixedIlvl".to_string(), json!(v));
    }
    if let Some(v) = obj.get("fixedQuality").and_then(parse_u64_flexible) {
        out.insert("fixedQuality".to_string(), json!(v));
    }
    Some(Value::Object(out))
}

fn parse_runtime_difficulty_entries(entries: &[Value], available_tracks: &[String]) -> Vec<Value> {
    entries
        .iter()
        .enumerate()
        .filter_map(|(idx, entry)| parse_runtime_difficulty_entry(entry, idx, available_tracks))
        .collect()
}

fn parse_runtime_difficulty_map(
    entries: &Map<String, Value>,
    available_tracks: &[String],
) -> Vec<Value> {
    entries
        .iter()
        .enumerate()
        .filter_map(|(idx, (key, value))| {
            let mut entry_obj = value.as_object().cloned()?;
            entry_obj
                .entry("key".to_string())
                .or_insert_with(|| json!(key.clone()));
            parse_runtime_difficulty_entry(&Value::Object(entry_obj), idx, available_tracks)
        })
        .collect()
}

fn is_difficulty_container_key(key: &str) -> bool {
    let k = key.to_ascii_lowercase();
    k.contains("dungeon_difficult")
        || k.contains("mplus_difficult")
        || k.contains("keystone_difficult")
        || k == "difficulty_overrides"
        || k == "dungeon_difficulty_overrides"
        || k == "mplusdifficultyoverrides"
}

fn collect_runtime_difficulty_entries(
    container: &Value,
    available_tracks: &[String],
    out: &mut Vec<Value>,
    depth: usize,
) {
    if depth > 8 {
        return;
    }
    let Some(obj) = container.as_object() else {
        return;
    };

    for (key, value) in obj {
        if is_difficulty_container_key(key) {
            if let Some(arr) = value.as_array() {
                out.extend(parse_runtime_difficulty_entries(arr, available_tracks));
            }
            if let Some(map) = value.as_object() {
                out.extend(parse_runtime_difficulty_map(map, available_tracks));
            }
        }
        collect_runtime_difficulty_entries(value, available_tracks, out, depth + 1);
    }
}

fn runtime_mplus_difficulty_overrides(available_tracks: &[String]) -> Vec<Value> {
    let runtime = get_runtime_metadata();
    let mut collected: Vec<Value> = Vec::new();
    collect_runtime_difficulty_entries(&runtime, available_tracks, &mut collected, 0);
    collected
}

fn merge_mplus_difficulties(base: Vec<Value>, overrides: Vec<Value>) -> Vec<Value> {
    let mut merged: HashMap<String, Value> = HashMap::new();
    for entry in base {
        if let Some(key) = entry.get("key").and_then(|v| v.as_str()) {
            merged.insert(key.to_string(), entry);
        }
    }
    for entry in overrides {
        if let Some(key) = entry.get("key").and_then(|v| v.as_str()) {
            merged.insert(key.to_string(), entry);
        }
    }

    let mut values: Vec<Value> = merged.into_values().collect();
    values.sort_by(|a, b| {
        let sa = a.get("sortOrder").and_then(|v| v.as_u64()).unwrap_or(999);
        let sb = b.get("sortOrder").and_then(|v| v.as_u64()).unwrap_or(999);
        sa.cmp(&sb).then_with(|| {
            a.get("key")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .cmp(b.get("key").and_then(|v| v.as_str()).unwrap_or(""))
        })
    });
    values
}

fn generated_season_config(data_dir: &Path) -> Value {
    let (season_name_from_file, catalyst_currency_from_file, conversion_group_id) =
        read_active_season_metadata(data_dir);
    let season_name = season_name_from_file.unwrap_or_else(inferred_season_label);
    let catalyst_currency_id = catalyst_currency_from_file.unwrap_or(3378);
    let tier_set_bonus_id = read_conversion_bonus_id(data_dir, conversion_group_id).unwrap_or(20);

    let available_tracks = available_track_names();
    let adventurer_track = pick_track_name("Adventurer", &available_tracks);
    let veteran_track = pick_track_name("Veteran", &available_tracks);
    let champion_track = pick_track_name("Champion", &available_tracks);
    let hero_track = pick_track_name("Hero", &available_tracks);
    let myth_track = pick_track_name("Myth", &available_tracks);

    let adventurer_max = track_max_level(&adventurer_track);
    let champion_max = track_max_level(&champion_track);
    let hero_max = track_max_level(&hero_track);
    let myth_max = track_max_level(&myth_track);

    let heroic_level = clamp_level(2, adventurer_max);
    let mythic_zero_level = clamp_level(1, champion_max);
    let mplus2_level = clamp_level(2, champion_max);
    let mplus4_level = clamp_level(3, champion_max);
    let mplus5_level = clamp_level(4, champion_max);
    let mplus6_level = clamp_level(5, champion_max);
    let mplus7_level = clamp_level(1, hero_max);
    let mplus8_level = clamp_level(2, hero_max);
    let mplus10_level = clamp_level(3, hero_max);
    let vault79_level = clamp_level(4, hero_max);
    let vault10_level = clamp_level(1, myth_max);
    let base_mplus_difficulties = vec![
        json!({ "key": "heroic",    "label": "Heroic",     "track": adventurer_track, "level": heroic_level, "sortOrder": 1 }),
        json!({ "key": "mythic",    "label": "Mythic 0",   "track": champion_track,   "level": mythic_zero_level, "sortOrder": 2 }),
        json!({ "key": "mythic+2",  "label": "+2",         "track": champion_track,   "level": mplus2_level, "sortOrder": 3 }),
        json!({ "key": "mythic+3",  "label": "+3",         "track": champion_track,   "level": mplus2_level, "sortOrder": 4 }),
        json!({ "key": "mythic+4",  "label": "+4",         "track": champion_track,   "level": mplus4_level, "sortOrder": 5 }),
        json!({ "key": "mythic+5",  "label": "+5",         "track": champion_track,   "level": mplus5_level, "sortOrder": 6 }),
        json!({ "key": "mythic+6",  "label": "+6",         "track": champion_track,   "level": mplus6_level, "sortOrder": 7 }),
        json!({ "key": "mythic+7",  "label": "+7",         "track": hero_track,       "level": mplus7_level, "sortOrder": 8 }),
        json!({ "key": "mythic+8",  "label": "+8",         "track": hero_track,       "level": mplus8_level, "sortOrder": 9 }),
        json!({ "key": "mythic+9",  "label": "+9",         "track": hero_track,       "level": mplus8_level, "sortOrder": 10 }),
        json!({ "key": "mythic+10", "label": "+10",        "track": hero_track,       "level": mplus10_level, "sortOrder": 11 }),
        json!({ "key": "vault+7-9", "label": "Vault +7-9", "track": hero_track,       "level": vault79_level, "sortOrder": 12 }),
        json!({ "key": "vault+10",  "label": "Vault +10",  "track": myth_track,       "level": vault10_level, "sortOrder": 13 }),
    ];
    let runtime_overrides = runtime_mplus_difficulty_overrides(&available_tracks);
    let mplus_difficulties = merge_mplus_difficulties(base_mplus_difficulties, runtime_overrides);
    let default_mplus_difficulty = if mplus_difficulties
        .iter()
        .any(|d| d.get("key").and_then(|v| v.as_str()) == Some("mythic+10"))
    {
        "mythic+10".to_string()
    } else {
        mplus_difficulties
            .first()
            .and_then(|v| v.get("key"))
            .and_then(|v| v.as_str())
            .unwrap_or("mythic")
            .to_string()
    };

    let mut dungeon_difficulty_tracks = serde_json::Map::new();
    for difficulty in &mplus_difficulties {
        let Some(key) = difficulty.get("key").and_then(|v| v.as_str()) else {
            continue;
        };
        let Some(track) = difficulty.get("track").and_then(|v| v.as_str()) else {
            continue;
        };
        let Some(level) = difficulty.get("level").and_then(|v| v.as_u64()) else {
            continue;
        };
        dungeon_difficulty_tracks
            .insert(key.to_string(), json!({ "track": track, "level": level }));
    }

    json!({
      "season": season_name,
      "raidDifficulties": [
        { "key": "lfr",    "label": "Raid Finder", "track": veteran_track,  "level": 1, "sortOrder": 1 },
        { "key": "normal", "label": "Normal",      "track": champion_track, "level": 2, "sortOrder": 2 },
        { "key": "heroic", "label": "Heroic",      "track": hero_track,     "level": 3, "sortOrder": 3 },
        { "key": "mythic", "label": "Mythic",      "track": myth_track,     "level": 4, "sortOrder": 4 }
      ],
      "dungeonCategories": [
        {
          "key": "mplus",
          "label": "Mythic+",
          "poolInstanceId": -1,
          "defaultDifficulty": default_mplus_difficulty,
          "difficulties": mplus_difficulties
        },
        {
          "key": "normal-dungeons",
          "label": "Dungeons",
          "poolInstanceId": -32,
          "defaultDifficulty": "heroic",
          "difficulties": [
            { "key": "normal", "label": "Normal", "track": null, "level": 0, "sortOrder": 1, "fixedIlvl": 214, "fixedQuality": 3 },
            { "key": "heroic", "label": "Heroic", "track": adventurer_track, "level": heroic_level, "sortOrder": 2 },
            { "key": "mythic", "label": "Mythic", "track": champion_track, "level": mythic_zero_level, "sortOrder": 3 }
          ]
        }
      ],
      "encounterOverrides": [],
      "instanceOverrides": [],
      "raidDifficultyTracks": {
        "lfr": veteran_track,
        "normal": champion_track,
        "heroic": hero_track,
        "mythic": myth_track
      },
      "encounterUpgradeLevel": {},
      "dungeonNormal": { "ilvl": 214, "quality": 3 },
      "dungeonDifficultyTracks": dungeon_difficulty_tracks,
      "worldBossTrack": champion_track,
      "worldBossLevel": mythic_zero_level,
      "tierSetBonusId": tier_set_bonus_id,
      "catalyst_currency_id": catalyst_currency_id
    })
}

pub fn load_season_config(data_dir: &Path) {
    *SEASON_CONFIG.write().unwrap() = generated_season_config(data_dir);
}

pub fn load_item_limit_categories(data_dir: &Path) {
    // Start with crafting-derived limit categories (embellishments, tinker-like effects).
    let mut lookup: HashMap<u64, (u64, u64)> = super::crafting::get_crafting_limit_categories();

    let path = data_dir.join("item-limit-categories.json");
    if path.exists() {
        let file = match fs::File::open(&path) {
            Ok(f) => f,
            Err(_) => {
                *ITEM_LIMIT_CATS.write().unwrap() = Arc::new(lookup);
                return;
            }
        };
        let raw: HashMap<String, Value> =
            serde_json::from_reader(std::io::BufReader::new(file)).unwrap_or_default();

        let cats: HashMap<u64, u64> = raw
            .into_iter()
            .filter_map(|(k, v): (String, Value)| {
                let id = k.parse::<u64>().ok()?;
                let qty = v.get("quantity")?.as_u64()?;
                Some((id, qty))
            })
            .collect();

        let bonuses = BONUSES.read().unwrap();
        for (bid, bonus) in bonuses.iter() {
            if let Some(cat_id) = bonus.item_limit_category {
                if let Some(&qty) = cats.get(&cat_id) {
                    lookup.insert(*bid, (cat_id, qty));
                }
            }
        }
    }

    *ITEM_LIMIT_CATS.write().unwrap() = Arc::new(lookup);
}

pub fn load_talents(data_dir: &Path) {
    let path = data_dir.join("talents.json");
    if !path.exists() {
        return;
    }

    let file = match fs::File::open(&path) {
        Ok(f) => f,
        Err(_) => return,
    };
    let data: Vec<Value> =
        serde_json::from_reader(std::io::BufReader::new(file)).unwrap_or_default();

    let map: HashMap<u64, Value> = data
        .into_iter()
        .filter_map(|v| {
            let spec_id = v.get("specId")?.as_u64()?;
            Some((spec_id, v))
        })
        .collect();
    *TALENT_TREES.write().unwrap() = Arc::new(map);
}

pub fn load_squish_data(data_dir: &Path) {
    let era_path = data_dir.join("item-squish-era.json");
    if era_path.exists() {
        let file = match fs::File::open(&era_path) {
            Ok(f) => f,
            Err(_) => return,
        };
        let data: Vec<Value> =
            serde_json::from_reader(std::io::BufReader::new(file)).unwrap_or_default();
        let map: HashMap<u64, u64> = data
            .iter()
            .filter_map(|entry| {
                let id = entry.get("id")?.as_u64()?;
                let curve_id = entry.get("curveId")?.as_u64()?;
                if curve_id > 0 {
                    Some((id, curve_id))
                } else {
                    None
                }
            })
            .collect();
        *SQUISH_ERAS.write().unwrap() = Arc::new(map);
    }

    let curve_path = data_dir.join("item-curves.json");
    if curve_path.exists() {
        let file = match fs::File::open(&curve_path) {
            Ok(f) => f,
            Err(_) => return,
        };
        let data: HashMap<String, Value> =
            serde_json::from_reader(std::io::BufReader::new(file)).unwrap_or_default();
        let map: HashMap<u64, Vec<(u64, u64)>> = data
            .into_iter()
            .filter_map(|(key, val)| {
                let curve_id = key.parse::<u64>().ok()?;
                let points = val.get("points")?.as_array()?;
                let mut pts: Vec<(u64, u64)> = points
                    .iter()
                    .filter_map(|p| {
                        let old = p.get("playerLevel")?.as_u64()?;
                        let new = p.get("itemLevel")?.as_u64()?;
                        Some((old, new))
                    })
                    .collect();
                pts.sort_by_key(|(old, _)| *old);
                Some((curve_id, pts))
            })
            .collect();
        *ITEM_CURVES.write().unwrap() = Arc::new(map);
    }
}

pub fn load_catalyst_conversions(data_dir: &Path) {
    let path = data_dir.join("item-conversions.json");
    if !path.exists() {
        return;
    }

    let file = match fs::File::open(&path) {
        Ok(f) => f,
        Err(_) => return,
    };
    let data: HashMap<String, Value> =
        serde_json::from_reader(std::io::BufReader::new(file)).unwrap_or_default();

    let (_, _, preferred_group_id) = read_active_season_metadata(data_dir);
    let selected_group_id = preferred_group_id
        .filter(|id| data.contains_key(&id.to_string()))
        .or_else(|| data.iter().filter_map(|(k, _)| k.parse::<u64>().ok()).max());

    if let Some(group_id) = selected_group_id {
        if let Some(group) = data.get(&group_id.to_string()) {
            let mut tier_items: HashMap<(u64, u64), CatalystTierItem> = HashMap::new();
            let mut tier_item_ids: HashSet<u64> = HashSet::new();

            if let Some(items) = group.get("items").and_then(|v| v.as_array()) {
                // For now, we'll keep catalyst items as Value in the internal loop
                // but we should eventually type them too if they map to GameItem.
                // Catalyst data is often a subset or different shape.
                for item in items {
                    let item_id = match item.get("id").and_then(|v| v.as_u64()) {
                        Some(id) => id,
                        None => continue,
                    };
                    let mut inv_type = match item.get("inventoryType").and_then(|v| v.as_u64()) {
                        Some(t) => t,
                        None => continue,
                    };
                    if inv_type == 20 {
                        inv_type = 5;
                    }
                    let has_set = item.get("itemSetId").and_then(|v| v.as_u64()).is_some();
                    if has_set {
                        tier_item_ids.insert(item_id);
                    }
                    let bonus_ids: Vec<u64> = item
                        .get("bonusLists")
                        .and_then(|v| v.as_array())
                        .map(|arr| arr.iter().filter_map(|v| v.as_u64()).collect())
                        .unwrap_or_default();

                    let tier_item = CatalystTierItem {
                        item_id,
                        name: item
                            .get("name")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                        icon: item
                            .get("icon")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                        has_set,
                        bonus_ids,
                    };

                    let classes = item
                        .get("allowableClasses")
                        .and_then(|v| v.as_array())
                        .map(|arr| arr.iter().filter_map(|v| v.as_u64()).collect::<Vec<_>>())
                        .unwrap_or_default();

                    for class_id in &classes {
                        tier_items.insert((*class_id, inv_type), tier_item.clone());
                    }
                }
            }

            let catalyst_currency_id = super::season_cfg()
                .get("catalyst_currency_id")
                .and_then(|v| v.as_u64())
                .unwrap_or(3378);

            *CATALYST.write().unwrap() = Arc::new(CatalystData {
                tier_items,
                tier_item_ids,
                catalyst_currency_id,
            });
        }
    }
}

pub fn load_classes(data_dir: &Path) {
    class_data::set_class_trait_spec_ids(HashMap::new());
    class_data::set_class_wow_ids(HashMap::new());
    class_data::set_spec_to_wow_class(HashMap::new());

    // Primary source: class-traits.json (contains authoritative class -> spec ID mapping).
    let traits_path = data_dir.join("class-traits.json");
    let mut class_id_map: HashMap<String, u64> = HashMap::new();
    let mut spec_class_map: HashMap<u64, u64> = HashMap::new();
    let trait_map: HashMap<String, Vec<u64>> = if traits_path.exists() {
        fs::read_to_string(&traits_path)
            .ok()
            .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
            .and_then(|root| root.as_array().cloned())
            .map(|rows| {
                let mut out: HashMap<String, Vec<u64>> = HashMap::new();
                for row in rows {
                    let class_id = row.get("classId").and_then(|v| v.as_u64()).unwrap_or(0);
                    let class_name = row
                        .get("className")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_lowercase().replace(' ', "_"));
                    let Some(class_name) = class_name else {
                        continue;
                    };
                    let specs = row
                        .get("specs")
                        .and_then(|v| v.as_array())
                        .map(|arr| arr.iter().filter_map(|v| v.as_u64()).collect::<Vec<_>>())
                        .unwrap_or_default();
                    if specs.is_empty() {
                        continue;
                    }
                    if class_id > 0 {
                        class_id_map.insert(class_name.clone(), class_id);
                        for sid in &specs {
                            spec_class_map.insert(*sid, class_id);
                        }
                    }
                    let entry = out.entry(class_name).or_default();
                    for spec_id in specs {
                        if !entry.contains(&spec_id) {
                            entry.push(spec_id);
                        }
                    }
                }
                out
            })
            .unwrap_or_default()
    } else {
        HashMap::new()
    };
    if !trait_map.is_empty() || !class_id_map.is_empty() || !spec_class_map.is_empty() {
        println!(
            "Loaded class trait spec map for {} classes",
            trait_map.len()
        );
        class_data::set_class_trait_spec_ids(trait_map);
        class_data::set_class_wow_ids(class_id_map);
        class_data::set_spec_to_wow_class(spec_class_map);
    }

    // Enrich with spec names from talents.json to avoid hardcoded class/spec tables.
    let mut spec_name_by_id: HashMap<u64, String> = HashMap::new();
    if let Ok(file) = fs::File::open(data_dir.join("talents.json")) {
        let data: Vec<Value> =
            serde_json::from_reader(std::io::BufReader::new(file)).unwrap_or_default();
        for row in data {
            let sid = row.get("specId").and_then(|v| v.as_u64()).unwrap_or(0);
            let sname = row
                .get("specName")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            if sid > 0 && !sname.is_empty() {
                spec_name_by_id.insert(sid, sname.to_string());
            }
        }
    }

    let mut classes: Vec<ClassDef> = Vec::new();
    for (class_name, spec_ids) in class_data::CLASS_TRAIT_SPEC_IDS.read().unwrap().iter() {
        let mut specs: Vec<SpecDef> = spec_ids
            .iter()
            .map(|sid| SpecDef {
                name: spec_name_by_id
                    .get(sid)
                    .cloned()
                    .unwrap_or_else(|| format!("spec_{}", sid)),
                id: *sid,
                weapon_subclasses: Vec::new(),
                primary_stats: Vec::new(),
                can_dual_wield: false,
                can_use_shield: false,
                can_use_offhand: false,
            })
            .collect();
        specs.sort_by_key(|s| s.id);

        let aliases = match class_name.as_str() {
            "death_knight" => vec!["deathknight".to_string()],
            "demon_hunter" => vec!["demonhunter".to_string()],
            _ => Vec::new(),
        };

        classes.push(ClassDef {
            name: class_name.clone(),
            aliases,
            max_armor: 0,
            weapons: Vec::new(),
            specs,
        });
    }
    classes.sort_by(|a, b| a.name.cmp(&b.name));
    *class_data::CLASSES.write().unwrap() = Arc::new(classes);
}

pub fn derive_class_profiles_from_items() {
    let items = ITEMS.read().unwrap().clone();
    if items.is_empty() {
        return;
    }

    let mut classes = class_data::CLASSES.read().unwrap().as_ref().clone();
    if classes.is_empty() {
        return;
    }

    let mut class_idx_by_id: HashMap<u64, usize> = HashMap::new();
    for (idx, class_def) in classes.iter().enumerate() {
        if let Some(cid) = class_data::class_wow_id(&class_def.name) {
            class_idx_by_id.insert(cid, idx);
        }
    }
    if class_idx_by_id.is_empty() {
        return;
    }

    let mut spec_idx_by_id: HashMap<u64, (usize, usize)> = HashMap::new();
    for (ci, class_def) in classes.iter().enumerate() {
        for (si, spec) in class_def.specs.iter().enumerate() {
            spec_idx_by_id.insert(spec.id, (ci, si));
        }
    }

    let mut class_weapon_sets: Vec<HashSet<u64>> = vec![HashSet::new(); classes.len()];
    let mut class_primary_counts: Vec<HashMap<u64, u64>> = vec![HashMap::new(); classes.len()];
    let mut class_max_armor: Vec<u64> = vec![0; classes.len()];
    let mut spec_weapon_sets: Vec<Vec<HashSet<u64>>> = classes
        .iter()
        .map(|c| (0..c.specs.len()).map(|_| HashSet::new()).collect())
        .collect();
    let mut spec_primary_counts: Vec<Vec<HashMap<u64, u64>>> = classes
        .iter()
        .map(|c| (0..c.specs.len()).map(|_| HashMap::new()).collect())
        .collect();
    let mut spec_can_shield: Vec<Vec<bool>> = classes
        .iter()
        .map(|c| (0..c.specs.len()).map(|_| false).collect())
        .collect();
    let mut spec_can_offhand: Vec<Vec<bool>> = classes
        .iter()
        .map(|c| (0..c.specs.len()).map(|_| false).collect())
        .collect();
    let mut spec_can_dual: Vec<Vec<bool>> = classes
        .iter()
        .map(|c| (0..c.specs.len()).map(|_| false).collect())
        .collect();

    for item in items.values() {
        let inv_type = item.inventory_type.unwrap_or(0) as u64;
        let item_class = item.class.unwrap_or(0) as u64;
        let sub = item.subclass.unwrap_or(0) as u64;
        let item_primary_stats: HashSet<u64> = item
            .stats
            .as_ref()
            .map(|stats| {
                let mut out = HashSet::<u64>::new();
                for stat in stats {
                    if matches!(stat.id, 3..=5) {
                        out.insert(stat.id);
                    }
                }
                out
            })
            .unwrap_or_default();

        let mut explicit_class_ids: HashSet<u64> = item
            .classes
            .as_ref()
            .map(|v| v.iter().copied().collect())
            .unwrap_or_default();
        if let Some(specs) = &item.specs {
            for id in specs {
                if *id > 0 && *id <= 13 {
                    explicit_class_ids.insert(*id);
                }
            }
        }

        for class_id in explicit_class_ids {
            if let Some(&ci) = class_idx_by_id.get(&class_id) {
                if item_class == 2 {
                    class_weapon_sets[ci].insert(sub);
                }
                for primary in &item_primary_stats {
                    *class_primary_counts[ci].entry(*primary).or_insert(0) += 1;
                }
                if item_class == 4
                    && class_data::ARMOR_INVENTORY_TYPES.contains(&inv_type)
                    && inv_type != 2
                    && sub > 0
                {
                    class_max_armor[ci] = class_max_armor[ci].max(sub);
                }
            }
        }

        if let Some(specs) = &item.specs {
            for spec_id in specs.iter().copied().filter(|sid| *sid > 13) {
                if let Some(&(ci, si)) = spec_idx_by_id.get(&spec_id) {
                    if item_class == 2 {
                        class_weapon_sets[ci].insert(sub);
                        spec_weapon_sets[ci][si].insert(sub);
                        if inv_type == 22 {
                            spec_can_dual[ci][si] = true;
                        }
                    }
                    for primary in &item_primary_stats {
                        *class_primary_counts[ci].entry(*primary).or_insert(0) += 1;
                        *spec_primary_counts[ci][si].entry(*primary).or_insert(0) += 1;
                    }
                    if inv_type == 14 {
                        spec_can_shield[ci][si] = true;
                    }
                    if inv_type == 23 {
                        spec_can_offhand[ci][si] = true;
                    }
                }
            }
        }
    }

    let dominant_primary_stats = |counts: &HashMap<u64, u64>| -> Vec<u64> {
        let max_count = counts.values().copied().max().unwrap_or(0);
        if max_count == 0 {
            return Vec::new();
        }
        let mut out: Vec<u64> = counts
            .iter()
            .filter_map(|(stat, count)| {
                if *count == max_count {
                    Some(*stat)
                } else {
                    None
                }
            })
            .collect();
        out.sort_unstable();
        out
    };

    for ci in 0..classes.len() {
        let mut class_weapons: Vec<u64> = class_weapon_sets[ci].iter().copied().collect();
        class_weapons.sort_unstable();
        classes[ci].weapons = class_weapons;
        classes[ci].max_armor = class_max_armor[ci];

        for si in 0..classes[ci].specs.len() {
            let mut spec_weapons: Vec<u64> = spec_weapon_sets[ci][si].iter().copied().collect();
            spec_weapons.sort_unstable();
            classes[ci].specs[si].weapon_subclasses = spec_weapons;

            let spec_primaries: Vec<u64> = if spec_primary_counts[ci][si].is_empty() {
                dominant_primary_stats(&class_primary_counts[ci])
            } else {
                dominant_primary_stats(&spec_primary_counts[ci][si])
            };
            classes[ci].specs[si].primary_stats = spec_primaries;

            classes[ci].specs[si].can_use_shield = spec_can_shield[ci][si];
            classes[ci].specs[si].can_use_offhand = spec_can_offhand[ci][si];
            classes[ci].specs[si].can_dual_wield = spec_can_dual[ci][si];
        }
    }

    *class_data::CLASSES.write().unwrap() = Arc::new(classes);
}

pub fn load_consumables(data_dir: &Path) {
    fn read_array(path: &Path) -> Vec<Value> {
        if !path.exists() {
            return Vec::new();
        }
        let file = match fs::File::open(path) {
            Ok(f) => f,
            Err(_) => return Vec::new(),
        };
        serde_json::from_reader(std::io::BufReader::new(file)).unwrap_or_default()
    }

    let flasks = read_array(&data_dir.join("flasks.json"));
    let foods = read_array(&data_dir.join("foods.json"));
    let potions = read_array(&data_dir.join("potions.json"));
    let augments = read_array(&data_dir.join("augments.json"));
    let temp_enchants = read_array(&data_dir.join("temp-enchants.json"));

    *FLASK_OPTIONS_RAW.write().unwrap() = Arc::new(flasks);
    *FOOD_OPTIONS_RAW.write().unwrap() = Arc::new(foods);
    *POTION_OPTIONS_RAW.write().unwrap() = Arc::new(potions);
    *AUGMENT_OPTIONS_RAW.write().unwrap() = Arc::new(augments);
    *TEMP_ENCHANT_OPTIONS_RAW.write().unwrap() = Arc::new(temp_enchants);
}

pub fn get_runtime_metadata() -> Value {
    use crate::item_db::state::RUNTIME_DATA;
    RUNTIME_DATA.read().unwrap().clone()
}

pub fn set_runtime_data(data: Value) {
    use crate::item_db::state::RUNTIME_DATA;
    *RUNTIME_DATA.write().unwrap() = data;
}

pub fn hydrate_runtime_metadata(runtime_path: &Path) {
    if !runtime_path.exists() {
        set_runtime_data(json!({}));
        return;
    }
    let data: Value = match fs::read_to_string(runtime_path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_else(|_| json!({})),
        Err(_) => {
            set_runtime_data(json!({}));
            return;
        }
    };

    // Store for later access
    set_runtime_data(data.clone());

    if let Some(media_map) = data.get("instance_media_urls").and_then(|v| v.as_object()) {
        let mut inst = INSTANCES.write().unwrap();
        for instance in inst.iter_mut() {
            let Some(id) = instance.get("id").and_then(|v| v.as_i64()) else {
                continue;
            };
            if let Some(url) = media_map
                .get(&id.to_string())
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
            {
                if let Some(obj) = instance.as_object_mut() {
                    obj.insert("image_url".to_string(), Value::String(url));
                }
            }
        }
    }

    if let Some(mplus) = data.get("mplus_rotation").and_then(|v| v.as_array()) {
        let rotation_ids: Vec<i64> = mplus.iter().filter_map(|v| v.as_i64()).collect();
        // Update instances with 'active_rotation' flag in memory
        let mut inst = INSTANCES.write().unwrap();
        for dungeon in inst.iter_mut() {
            if let Some(id) = dungeon.get("id").and_then(|v| v.as_i64()) {
                if rotation_ids.contains(&id) {
                    dungeon
                        .as_object_mut()
                        .map(|obj| obj.insert("active_rotation".to_string(), Value::Bool(true)));
                } else if dungeon.get("type") == Some(&Value::String("dungeon".to_string())) {
                    dungeon
                        .as_object_mut()
                        .map(|obj| obj.insert("active_rotation".to_string(), Value::Bool(false)));
                }
            }
        }
    }
}
