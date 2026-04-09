use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

use super::state::*;
use crate::types::{GameItem, EnchantData, BonusData};
use crate::types::class_data;
use std::sync::Arc;



pub fn load_items(data_dir: &Path) {
    let path = data_dir.join("equippable-items-full.json");
    if !path.exists() { return; }
    
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

    
    let map: HashMap<u64, GameItem> = data
        .into_iter()
        .map(|v| (v.id, v))
        .collect();
    println!("Loaded {} items", map.len());
    *ITEMS.write().unwrap() = Arc::new(map);
}

pub fn load_enchants(data_dir: &Path) {
    let path = data_dir.join("enchantments.json");
    if !path.exists() { return; }
    
    let file = match fs::File::open(&path) {
        Ok(f) => f,
        Err(_) => return,
    };
    
    let data: Vec<EnchantData> = serde_json::from_reader(std::io::BufReader::new(file))
        .unwrap_or_default();
    
    let by_id: HashMap<u64, EnchantData> = data
        .iter()
        .map(|v| (v.id, v.clone()))
        .collect();
    
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
    if !path.exists() { return; }
    
    let file = match fs::File::open(&path) {
        Ok(f) => f,
        Err(_) => return,
    };
    
    let raw: HashMap<String, BonusData> = serde_json::from_reader(std::io::BufReader::new(file))
        .unwrap_or_default();
    
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
                if sid > max_season_id { max_season_id = sid; }
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
    
    println!("Loaded {} bonuses, {} upgrade groups", map.len(), groups.len());
    *BONUSES.write().unwrap() = Arc::new(map);
    *UPGRADE_MAX.write().unwrap() = Arc::new(upgrade_max);
}


pub fn load_bus_and_seasons(data_dir: &Path) {
    let bus_path = data_dir.join("bonus-upgrade-sets.json");
    let seasons_path = data_dir.join("seasons.json");
    if !bus_path.exists() { return; }
    
    let bus_file = match fs::File::open(&bus_path) {
        Ok(f) => f,
        Err(_) => return,
    };

    let bus_raw: HashMap<String, Vec<Value>> =
        serde_json::from_reader(std::io::BufReader::new(bus_file))
            .unwrap_or_default();

    let mut active_groups: Option<Vec<u64>> = None;
    if seasons_path.exists() {
        let s_file = match fs::File::open(&seasons_path) {
            Ok(f) => f,
            Err(_) => {
                *BONUSES.write().unwrap() = Arc::new(HashMap::new());
                return;
            }
        };
        let seasons: Vec<Value> = serde_json::from_reader(std::io::BufReader::new(s_file))
            .unwrap_or_default();
        
        if let Some(active) = seasons.iter().find(|s| s.get("active").and_then(|a| a.as_bool()).unwrap_or(false)) {
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
            if !ag.contains(&group_id) { continue; }
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
                            let n = currency.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                            let i = currency.get("icon").and_then(|v| v.as_str()).unwrap_or("").to_string();
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
    if !path.exists() { return; }
    
    let data: Vec<Value> = serde_json::from_reader(std::io::BufReader::new(
        fs::File::open(&path).unwrap(),
    )).unwrap_or_default();
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

pub fn load_season_config(data_dir: &Path) {
    let path = data_dir.join("season-config.json");
    let path = if path.exists() { path } else {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("season-config.json")
    };
    if path.exists() {
        let cfg: Value = serde_json::from_reader(std::io::BufReader::new(
            fs::File::open(&path).unwrap(),
        )).unwrap_or(Value::Null);
        let mut sc = SEASON_CONFIG.write().unwrap();
        *sc = cfg;
    }
}

pub fn load_item_limit_categories(data_dir: &Path) {
    let path = data_dir.join("item-limit-categories.json");
    if !path.exists() { return; }
    
    let raw: HashMap<String, Value> = serde_json::from_reader(std::io::BufReader::new(
        fs::File::open(&path).unwrap(),
    )).unwrap_or_default();
    
    let cats: HashMap<u64, u64> = raw
        .into_iter()
        .filter_map(|(k, v): (String, Value)| {
            let id = k.parse::<u64>().ok()?;
            let qty = v.get("quantity")?.as_u64()?;
            Some((id, qty))
        })
        .collect();
        
    let mut lookup: HashMap<u64, (u64, u64)> = HashMap::new();
    let bonuses = BONUSES.read().unwrap();
    for (bid, bonus) in bonuses.iter() {
        if let Some(cat_id) = bonus.item_limit_category {
            if let Some(&qty) = cats.get(&cat_id) {
                lookup.insert(*bid, (cat_id, qty));
            }
        }
    }
    *ITEM_LIMIT_CATS.write().unwrap() = Arc::new(lookup);
}


pub fn load_talents(data_dir: &Path) {
    let path = data_dir.join("talents.json");
    if !path.exists() { return; }
    
    let data: Vec<Value> = serde_json::from_reader(std::io::BufReader::new(
        fs::File::open(&path).unwrap(),
    )).unwrap_or_default();
    
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
        let data: Vec<Value> = serde_json::from_reader(std::io::BufReader::new(
            fs::File::open(&era_path).unwrap(),
        )).unwrap_or_default();
        let map: HashMap<u64, u64> = data
            .iter()
            .filter_map(|entry| {
                let id = entry.get("id")?.as_u64()?;
                let curve_id = entry.get("curveId")?.as_u64()?;
                if curve_id > 0 { Some((id, curve_id)) } else { None }
            })
            .collect();
        *SQUISH_ERAS.write().unwrap() = Arc::new(map);
    }

    let curve_path = data_dir.join("item-curves.json");
    if curve_path.exists() {
        let data: HashMap<String, Value> = serde_json::from_reader(std::io::BufReader::new(
            fs::File::open(&curve_path).unwrap(),
        )).unwrap_or_default();
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
    if !path.exists() { return; }
    
    let data: HashMap<String, Value> = serde_json::from_reader(std::io::BufReader::new(
        fs::File::open(&path).unwrap(),
    )).unwrap_or_default();

    let latest_group = data.iter().filter_map(|(k, _)| k.parse::<u64>().ok()).max();
    if let Some(group_id) = latest_group {
        if let Some(group) = data.get(&group_id.to_string()) {
            let mut tier_items: HashMap<(u64, u64), CatalystTierItem> = HashMap::new();
            let mut tier_item_ids: HashSet<u64> = HashSet::new();

            if let Some(items) = group.get("items").and_then(|v| v.as_array()) {
                // For now, we'll keep catalyst items as Value in the internal loop
                // but we should eventually type them too if they map to GameItem.
                // Catalyst data is often a subset or different shape.
                for item in items {
                    let item_id = match item.get("id").and_then(|v| v.as_u64()) {
                        Some(id) => id, None => continue,
                    };
                    let mut inv_type = match item.get("inventoryType").and_then(|v| v.as_u64()) {
                        Some(t) => t, None => continue,
                    };
                    if inv_type == 20 { inv_type = 5; }
                    let has_set = item.get("itemSetId").and_then(|v| v.as_u64()).is_some();
                    if has_set { tier_item_ids.insert(item_id); }
                    
                    let tier_item = CatalystTierItem {
                        item_id,
                        name: item.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                        icon: item.get("icon").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                        has_set,
                    };
                    
                    let classes = item.get("allowableClasses")
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
    let path = data_dir.join("classes.json");
    if !path.exists() {
        return;
    }

    let file = match fs::File::open(&path) {
        Ok(f) => f,
        Err(e) => {
            eprintln!("Failed to open classes file {}: {}", path.display(), e);
            return;
        }
    };

    let data: Vec<class_data::ClassDef> = serde_json::from_reader(std::io::BufReader::new(file))
        .unwrap_or_else(|e| {
            eprintln!("Failed to deserialize classes JSON: {}", e);
            Vec::new()
        });

    *class_data::CLASSES.write().unwrap() = Arc::new(data);
}


pub fn hydrate_runtime_metadata(runtime_path: &Path) {
    if !runtime_path.exists() { return; }
    let data: Value = match fs::read_to_string(runtime_path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or(Value::Null),
        Err(_) => return,
    };

    if let Some(mplus) = data.get("mplus_rotation").and_then(|v| v.as_array()) {
        let rotation_ids: Vec<i64> = mplus.iter().filter_map(|v| v.as_i64()).collect();
        // Update instances with 'active_rotation' flag in memory
        let mut inst = INSTANCES.write().unwrap();
        for dungeon in inst.iter_mut() {
            if let Some(id) = dungeon.get("id").and_then(|v| v.as_i64()) {
                if rotation_ids.contains(&id) {
                    dungeon.as_object_mut().map(|obj| obj.insert("active_rotation".to_string(), Value::Bool(true)));
                } else if dungeon.get("type") == Some(&Value::String("dungeon".to_string())) {
                     dungeon.as_object_mut().map(|obj| obj.insert("active_rotation".to_string(), Value::Bool(false)));
                }
            }
        }
    }
}
