//! Game data facade — re-exports item_db lookups and contains drop-resolver logic.

use serde_json::Value;
use std::collections::HashMap;

use crate::item_db;
use crate::types::class_data;

// ---- Re-exports from item_db ----

pub use crate::item_db::{
    apply_copy_enchants, apply_copy_enchants_to_map, catalyst_currency_id, catalyst_tier_item,
    get_currency_info, get_enchant_info, get_gem_info, get_inventory_type, get_item_armor_subclass,
    get_item_info, get_item_limit_categories, get_upgrade_cost_between, get_upgrade_options,
    get_upgrade_tracks, is_catalyst_tier_item, load, talent_tree, upgrade_bonus_ids_to_max,
    upgrade_items_by_slot, upgrade_simc_input, CatalystTierItem, UpgradeOption,
};

pub use crate::types::class_data::{quality_name, QUALITY_NAMES};

pub fn get_instances() -> Vec<Value> {
    item_db::instances()
        .into_iter()
        .map(|mut inst| {
            if let Some(obj) = inst.as_object_mut() {
                let image_url = obj
                    .get("image_url")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .or_else(|| {
                        obj.get("image_background")
                            .and_then(|v| v.as_str())
                            .map(|slug| {
                                format!(
                                    "https://www.raidbots.com/static/images/EncounterJournal/orig/{}.png",
                                    slug
                                )
                            })
                    })
                    .or_else(|| {
                        obj.get("image_button")
                            .and_then(|v| v.as_str())
                            .map(|slug| {
                                format!(
                                    "https://www.raidbots.com/static/images/EncounterJournal/orig/{}.png",
                                    slug
                                )
                            })
                    });

                if let Some(url) = image_url {
                    obj.insert("image_url".to_string(), Value::String(url));
                }
            }
            inst
        })
        .collect()
}

// ---- Drop Resolver ----

pub fn get_instance_drops(
    instance_id: i64,
    class_name: Option<&str>,
    spec_name: Option<&str>,
) -> Option<serde_json::Map<String, Value>> {
    let instances = item_db::instances();
    let instance = instances
        .iter()
        .find(|i| i.get("id").and_then(|id| id.as_i64()) == Some(instance_id))?;

    let allowed_weapons = class_name.and_then(class_data::class_allowed_weapons);
    let active_spec_names: Vec<&str> = spec_name
        .map(|s| s.split(',').map(|s| s.trim()).collect())
        .unwrap_or_default();
    let allowed_specs: Vec<u64> = match (class_name, spec_name) {
        (Some(c), Some(specs)) => specs
            .split(',')
            .flat_map(|s| class_data::class_spec_ids(c, Some(s.trim())))
            .collect(),
        (Some(c), None) => class_data::class_spec_ids(c, None),
        _ => Vec::new(),
    };

    let instance_name = instance
        .get("name")
        .and_then(|n| n.as_str())
        .unwrap_or("")
        .to_string();
    let is_meta = instance_id < 0;

    let encounters = instance.get("encounters")?.as_array()?;
    let encounter_ids: HashMap<i64, String> = encounters
        .iter()
        .filter_map(|e| {
            let id = e.get("id")?.as_i64()?;
            let name = e.get("name")?.as_str()?.to_string();
            Some((id, name))
        })
        .collect();

    // Build encounter->level progression for all raid instances.
    // This keeps raid loot tiers aligned with boss order even if config overrides drift.
    let raid_progression_levels: HashMap<i64, u64> = instances
        .iter()
        .filter(|inst| {
            inst.get("type").and_then(|t| t.as_str()) == Some("raid")
                && inst.get("id").and_then(|id| id.as_i64()).unwrap_or(0) > 0
        })
        .flat_map(|inst| {
            let raid_encounters = inst
                .get("encounters")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            let total = raid_encounters.len();
            raid_encounters
                .into_iter()
                .enumerate()
                .filter_map(move |(idx, e)| {
                    let id = e.get("id")?.as_i64()?;
                    let pos = idx + 1;
                    let level = if total <= 1 {
                        4
                    } else if pos == 1 {
                        1
                    } else if pos <= 3 {
                        2
                    } else if pos <= 5 {
                        3
                    } else {
                        4
                    };
                    Some((id, level))
                })
        })
        .collect();

    // For meta-instances (pools), the encounter IDs are actually instance IDs.
    // Map each encounter ID to the instance name by direct ID lookup.
    let (encounter_to_instance, encounter_to_type): (HashMap<i64, String>, HashMap<i64, String>) =
        if is_meta {
        let mut map = HashMap::new();
        let mut tmap = HashMap::new();
        for inst in &instances {
            let iid = inst.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
            if iid <= 0 {
                continue;
            }
            if encounter_ids.contains_key(&iid) {
                let iname = inst
                    .get("name")
                    .and_then(|n| n.as_str())
                    .unwrap_or("")
                    .to_string();
                let itype = inst
                    .get("type")
                    .and_then(|t| t.as_str())
                    .unwrap_or("")
                    .to_string();
                map.insert(iid, iname);
                tmap.insert(iid, itype);
            }
        }
        (map, tmap)
    } else {
        (HashMap::new(), HashMap::new())
    };

    let drops_map = item_db::drops_by_encounter();
    let armor_slot_types = class_data::ARMOR_INVENTORY_TYPES;
    let mut by_slot: HashMap<&str, Vec<Value>> = HashMap::new();
    let mut seen: std::collections::HashSet<u64> = std::collections::HashSet::new();

    for eid in encounter_ids.keys() {
        if let Some(items_list) = drops_map.get(eid) {
            for item in items_list {
                let item_id = item.id;
                if !seen.insert(item_id) {
                    continue;
                }

                let inv_type = item.inventory_type.unwrap_or(0);
                let item_class = item.class.unwrap_or(0);

                // Filter by armor type
                if let Some(cn) = class_name {
                    if armor_slot_types.contains(&(inv_type as u64))
                        && item_class == 4
                        && (inv_type as u64) != 2
                    {
                        let sub = item.subclass.unwrap_or(0);
                        let max = class_data::class_max_armor(cn).unwrap_or(0);
                        if sub != 0 && (sub as u64) != max {
                            continue;
                        }
                    }
                }

                // Filter by weapon/shield/off-hand eligibility per active spec
                let weapon_sub = item.subclass.unwrap_or(0);

                if item_class == 2 || inv_type == 14 || inv_type == 23 {
                    // Weapon, shield, or held off-hand — check spec profiles
                    if let Some(cn) = class_name {
                        if !active_spec_names.is_empty() {
                            let any_spec_can_use = active_spec_names.iter().any(|spec| {
                                if let Some(profile) = class_data::spec_weapon_profile(cn, spec) {
                                    if item_class == 2 {
                                        profile.weapon_subclasses.contains(&(weapon_sub as u64))
                                    } else if inv_type == 14 {
                                        profile.can_use_shield
                                    } else {
                                        profile.can_use_offhand
                                    }
                                } else {
                                    // Unknown spec — fall back to class-level check
                                    if let Some(weapons) = &allowed_weapons {
                                        item_class != 2 || weapons.contains(&(weapon_sub as u64))
                                    } else {
                                        true
                                    }
                                }
                            });

                            if !any_spec_can_use {
                                continue;
                            }
                        } else if let Some(weapons) = &allowed_weapons {
                            // No spec info — fall back to class-level weapon check
                            if item_class == 2 && !weapons.contains(&(weapon_sub as u64)) {
                                continue;
                            }
                        }
                    }
                }

                // Filter spec restrictions (items with explicit spec lists)
                if let Some(specs) = &item.classes {
                    if !allowed_specs.is_empty() && !allowed_specs.iter().any(|s| specs.contains(s))
                    {
                        continue;
                    }
                }

                let slot = class_data::inventory_type_display_slot(inv_type as u64);

                // Compute per-difficulty info from upgrade tracks (raids)
                let upgrade_lvl = raid_progression_levels
                    .get(eid)
                    .copied()
                    .or_else(|| item_db::encounter_upgrade_level(*eid));
                let tracks = item_db::upgrade_tracks();
                let tm = item_db::upgrade_track_max();
                let mut diff_info = serde_json::Map::new();
                for diff in &["lfr", "normal", "heroic", "mythic"] {
                    if let Some(track) = item_db::difficulty_track_name(diff) {
                        // Use per-encounter raid progression (or configured overrides).
                        let effective_level = upgrade_lvl.unwrap_or(1);
                        if let Some(&(ilvl, bonus_id, quality)) =
                            tracks.get(&(track.clone(), effective_level, tm))
                        {
                            diff_info.insert(
                                diff.to_string(),
                                serde_json::json!({
                                    "ilvl": ilvl, "bonus_id": bonus_id, "quality": quality,
                                    "track": track, "level": effective_level, "max_level": tm,
                                }),
                            );
                        }
                    }
                }

                // Compute per-difficulty info for dungeons/M+
                let mut dungeon_info = serde_json::Map::new();
                if upgrade_lvl.is_none() {
                    dungeon_info.insert("normal".to_string(), serde_json::json!({
                        "ilvl": item_db::dungeon_normal_ilvl(), "bonus_id": 0, "quality": item_db::dungeon_normal_quality(),
                    }));

                    let sc = item_db::season_cfg();
                    if let Some(ddt) = sc
                        .get("dungeonDifficultyTracks")
                        .and_then(|v| v.as_object())
                    {
                        for (diff_key, entry) in ddt {
                            let track = entry.get("track").and_then(|v| v.as_str()).unwrap_or("");
                            let level = entry.get("level").and_then(|v| v.as_u64()).unwrap_or(0);
                            if let Some(&(ilvl, bonus_id, quality)) =
                                tracks.get(&(track.to_string(), level, tm))
                            {
                                dungeon_info.insert(
                                    diff_key.clone(),
                                    serde_json::json!({
                                        "ilvl": ilvl, "bonus_id": bonus_id, "quality": quality,
                                        "track": track, "level": level, "max_level": tm,
                                    }),
                                );
                            }
                        }
                    }
                }

                // Include item's spec restriction list (if any) for frontend off-spec indicators
                let item_specs: Vec<u64> = item.classes.clone().unwrap_or_default();

                let item_instance = if is_meta {
                    encounter_to_instance.get(eid).cloned().unwrap_or_default()
                } else {
                    instance_name.clone()
                };
                let item_source_type = if is_meta {
                    encounter_to_type.get(eid).cloned().unwrap_or_default()
                } else {
                    instance
                        .get("type")
                        .and_then(|t| t.as_str())
                        .unwrap_or("")
                        .to_string()
                };

                let mut item_json = serde_json::json!({
                    "item_id": item_id,
                    "name": item.name,
                    "icon": item.icon,
                    "quality": item.quality,
                    "ilevel": item.base_ilevel.unwrap_or(0),
                    "inventory_type": inv_type,
                    "encounter": encounter_ids.get(eid).cloned().unwrap_or_default(),
                    "instance_name": item_instance,
                    "source_type": item_source_type,
                });

                if !item_specs.is_empty() {
                    item_json["specs"] = serde_json::json!(item_specs);
                }

                // Compute off-spec flag: can the main spec use this item?
                if let (Some(cn), Some(main_spec)) =
                    (class_name, active_spec_names.first().copied())
                {
                    let main_spec_ids = class_data::class_spec_ids(cn, Some(main_spec));
                    let mut main_can_use = true;

                    // Check spec restrictions (if item has a specs list)
                    if !item_specs.is_empty()
                        && !main_spec_ids.iter().any(|id| item_specs.contains(id))
                    {
                        main_can_use = false;
                    }

                    // Check weapon/shield/offhand eligibility
                    if main_can_use && (item_class == 2 || inv_type == 14 || inv_type == 23) {
                        if let Some(profile) = class_data::spec_weapon_profile(cn, main_spec) {
                            main_can_use = if item_class == 2 {
                                profile.weapon_subclasses.contains(&(weapon_sub as u64))
                            } else if inv_type == 14 {
                                profile.can_use_shield
                            } else {
                                profile.can_use_offhand
                            };
                        }
                    }

                    if !main_can_use {
                        item_json["off_spec"] = serde_json::json!(true);
                    }
                }
                if !diff_info.is_empty() {
                    item_json["difficulty_info"] = Value::Object(diff_info);
                }
                if !dungeon_info.is_empty() {
                    item_json["dungeon_info"] = Value::Object(dungeon_info);
                }
                by_slot.entry(slot).or_default().push(item_json);
            }
        }
    }

    let mut ordered = serde_json::Map::new();
    for &slot in class_data::SLOT_DISPLAY_ORDER {
        if let Some(mut slot_items) = by_slot.remove(slot) {
            slot_items.sort_by(|a, b| {
                b.get("ilevel")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0)
                    .cmp(&a.get("ilevel").and_then(|v| v.as_u64()).unwrap_or(0))
            });
            ordered.insert(slot.to_string(), Value::Array(slot_items));
        }
    }
    for (slot, mut slot_items) in by_slot {
        slot_items.sort_by(|a, b| {
            b.get("ilevel")
                .and_then(|v| v.as_u64())
                .unwrap_or(0)
                .cmp(&a.get("ilevel").and_then(|v| v.as_u64()).unwrap_or(0))
        });
        ordered.insert(slot.to_string(), Value::Array(slot_items));
    }

    if ordered.is_empty() {
        None
    } else {
        Some(ordered)
    }
}

pub fn get_drops_by_type(
    instance_type: &str,
    class_name: Option<&str>,
    spec_name: Option<&str>,
) -> Option<serde_json::Map<String, Value>> {
    let instances = item_db::instances();
    let mut merged: HashMap<&str, Vec<Value>> = HashMap::new();
    let mut seen: std::collections::HashSet<u64> = std::collections::HashSet::new();

    for inst in instances {
        let itype = inst.get("type").and_then(|t| t.as_str()).unwrap_or("");
        if itype != instance_type {
            continue;
        }
        let inst_id = inst.get("id").and_then(|id| id.as_i64()).unwrap_or(0);
        if let Some(drops) = get_instance_drops(inst_id, class_name, spec_name) {
            for (slot, items) in &drops {
                if let Some(arr) = items.as_array() {
                    for item in arr {
                        let item_id = item.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
                        if seen.insert(item_id) {
                            let slot_str = match slot.as_str() {
                                "Head" => "Head",
                                "Neck" => "Neck",
                                "Shoulder" => "Shoulder",
                                "Back" => "Back",
                                "Chest" => "Chest",
                                "Wrist" => "Wrist",
                                "Hands" => "Hands",
                                "Waist" => "Waist",
                                "Legs" => "Legs",
                                "Feet" => "Feet",
                                "Finger" => "Finger",
                                "Trinket" => "Trinket",
                                "One-Hand" => "One-Hand",
                                "Main Hand" => "Main Hand",
                                "Off Hand" => "Off Hand",
                                "Two-Hand" => "Two-Hand",
                                "Held In Off-Hand" => "Held In Off-Hand",
                                "Shield" => "Shield",
                                "Ranged" => "Ranged",
                                _ => "Other",
                            };
                            merged.entry(slot_str).or_default().push(item.clone());
                        }
                    }
                }
            }
        }
    }

    let mut ordered = serde_json::Map::new();
    for &slot in class_data::SLOT_DISPLAY_ORDER {
        if let Some(mut slot_items) = merged.remove(slot) {
            slot_items.sort_by(|a, b| {
                b.get("ilevel")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0)
                    .cmp(&a.get("ilevel").and_then(|v| v.as_u64()).unwrap_or(0))
            });
            ordered.insert(slot.to_string(), Value::Array(slot_items));
        }
    }

    if ordered.is_empty() {
        None
    } else {
        Some(ordered)
    }
}
