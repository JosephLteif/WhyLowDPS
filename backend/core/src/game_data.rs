//! Game data facade — re-exports item_db lookups and contains drop-resolver logic.

use serde_json::Value;
use std::collections::{HashMap, HashSet};

use crate::item_db;
use crate::types::class_data;

// ---- Re-exports from item_db ----

pub use crate::item_db::{
    apply_copy_enchants, apply_copy_enchants_to_map, catalyst_currency_id, catalyst_tier_item,
    get_currency_info, get_enchant_info, get_gem_info, get_inventory_type, get_item_armor_subclass,
    get_item_info, get_item_limit_categories, get_upgrade_cost_between, get_upgrade_options,
    get_upgrade_tracks, is_catalyst_tier_item, list_embellishments_for_item, load, talent_tree,
    upgrade_bonus_ids_to_max, upgrade_items_by_slot, upgrade_simc_input, CatalystTierItem,
    UpgradeOption,
};

pub use crate::types::class_data::{quality_name, QUALITY_NAMES};

/// Values <= 13 are class IDs; values > 13 are spec IDs.
fn restrictions_match_active_specs(
    item_restrictions: &[u64],
    allowed_specs: &[u64],
    allowed_class_id: Option<u64>,
) -> bool {
    if item_restrictions.is_empty() {
        return true;
    }

    let has_spec_entries = item_restrictions.iter().any(|id| *id > 13);
    if has_spec_entries {
        // When explicit spec IDs exist, do not fall back to class IDs.
        return !allowed_specs.is_empty()
            && allowed_specs.iter().any(|s| item_restrictions.contains(s));
    }

    allowed_class_id.is_some_and(|cid| item_restrictions.contains(&cid))
}

fn item_matches_primary_stats(
    item: &crate::types::GameItem,
    allowed_primary: &HashSet<u64>,
) -> bool {
    if allowed_primary.is_empty() {
        return true;
    }

    let Some(stats) = &item.stats else {
        // Keep items with no explicit primary stat token (many proc trinkets).
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

    // If the item had primary tokens but none matched the active spec set, reject it.
    !saw_primary_token
}

fn primary_stat_filtered_slot(item_class: i64, inv_type: i64) -> bool {
    item_class == 2 || inv_type == 12 || inv_type == 14 || inv_type == 23
}

fn normalize_drop_key_part(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase()
}

fn canonical_drop_key(encounter_scope_id: i64, item: &crate::types::GameItem) -> String {
    format!(
        "{}|{}|{}|{}|{}",
        encounter_scope_id,
        item.inventory_type.unwrap_or(0),
        item.class.unwrap_or(0),
        item.subclass.unwrap_or(0),
        normalize_drop_key_part(&item.name)
    )
}

fn drop_candidate_score(
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

fn drop_value_dedupe_key(slot: &str, item: &Value) -> String {
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

fn drop_value_score(item: &Value) -> i64 {
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

fn upsert_slot_candidate(
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

fn merge_drop_map_into(
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

fn finalize_slot_map(
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

pub fn get_instances() -> Vec<Value> {
    item_db::instances()
        .into_iter()
        .map(|mut inst| {
            if let Some(obj) = inst.as_object_mut() {
                let instance_id = obj.get("id").and_then(|v| v.as_i64()).unwrap_or_default();

                // Route all instance images through the backend proxy so Blizzard API
                // remains the primary source regardless of stale upstream image_url values.
                if instance_id > 0 {
                    obj.insert(
                        "image_url".to_string(),
                        Value::String(format!("/api/data/images/instance/{}", instance_id)),
                    );
                }

                // Do the same for encounter images to avoid direct Raidbots URLs in clients.
                if let Some(encounters) = obj.get_mut("encounters").and_then(|v| v.as_array_mut()) {
                    for encounter in encounters {
                        let Some(enc_obj) = encounter.as_object_mut() else {
                            continue;
                        };
                        let encounter_id = enc_obj
                            .get("id")
                            .and_then(|v| v.as_i64())
                            .unwrap_or_default();
                        if encounter_id > 0 {
                            enc_obj.insert(
                                "image_url".to_string(),
                                Value::String(format!(
                                    "/api/data/images/encounter/{}",
                                    encounter_id
                                )),
                            );
                        }
                    }
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
    let allowed_class_id = class_name.and_then(class_data::class_wow_id);
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
    let allowed_primary_stats: HashSet<u64> = if let Some(cn) = class_name {
        if !active_spec_names.is_empty() {
            active_spec_names
                .iter()
                .filter_map(|spec| class_data::spec_weapon_profile(cn, spec))
                .flat_map(|profile| profile.primary_stats)
                .collect()
        } else {
            class_data::class_primary_stats(cn)
                .unwrap_or_default()
                .into_iter()
                .collect()
        }
    } else {
        HashSet::new()
    };
    let main_spec_primary_stats: HashSet<u64> =
        if let (Some(cn), Some(main_spec)) = (class_name, active_spec_names.first().copied()) {
            class_data::spec_weapon_profile(cn, main_spec)
                .map(|profile| profile.primary_stats.into_iter().collect())
                .unwrap_or_default()
        } else {
            HashSet::new()
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

    // Current Mythic+ rotation pool is encoded as the encounter list on instance -1,
    // where each encounter id is a dungeon instance id.
    let mplus_pool_instance_ids: std::collections::HashSet<i64> = instances
        .iter()
        .find(|inst| inst.get("id").and_then(|v| v.as_i64()) == Some(-1))
        .and_then(|inst| inst.get("encounters").and_then(|v| v.as_array()).cloned())
        .unwrap_or_default()
        .into_iter()
        .filter_map(|e| e.get("id").and_then(|v| v.as_i64()))
        .collect();

    let drops_map = item_db::drops_by_encounter();
    let armor_slot_types = class_data::ARMOR_INVENTORY_TYPES;
    let mut by_slot: HashMap<String, HashMap<String, (i64, Value)>> = HashMap::new();

    for eid in encounter_ids.keys() {
        if let Some(items_list) = drops_map.get(eid) {
            for item in items_list {
                let item_id = item.id;

                let inv_type = item.inventory_type.unwrap_or(0);
                let item_class = item.class.unwrap_or(0);
                let has_mplus_source = item.sources.as_ref().is_some_and(|sources| {
                    sources.iter().any(|src| {
                        src.instance_id == Some(-1)
                            || src
                                .instance_id
                                .is_some_and(|iid| mplus_pool_instance_ids.contains(&iid))
                    })
                });

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

                // Filter spec/class restrictions when present on the item.
                let item_restrictions = item.restriction_ids();
                if !restrictions_match_active_specs(
                    &item_restrictions,
                    &allowed_specs,
                    allowed_class_id,
                ) {
                    continue;
                }

                // Filter fixed-primary weapons/trinkets/off-hands by active spec primary stat.
                if primary_stat_filtered_slot(item_class, inv_type)
                    && !allowed_primary_stats.is_empty()
                    && !item_matches_primary_stats(item, &allowed_primary_stats)
                {
                    continue;
                }

                let slot = class_data::inventory_type_display_slot(inv_type as u64);

                let source_instance_name = if is_meta {
                    encounter_to_instance.get(eid).cloned().unwrap_or_default()
                } else {
                    instance_name.clone()
                };
                let source_instance_id = if is_meta { *eid } else { instance_id };
                let source_type_name = if is_meta {
                    encounter_to_type.get(eid).cloned().unwrap_or_default()
                } else {
                    instance
                        .get("type")
                        .and_then(|t| t.as_str())
                        .unwrap_or("")
                        .to_string()
                };
                let is_world_boss_source =
                    source_instance_name.to_lowercase().contains("world boss");

                // Compute per-difficulty info from upgrade tracks (raids)
                let upgrade_lvl = raid_progression_levels
                    .get(eid)
                    .copied()
                    .or_else(|| item_db::encounter_upgrade_level(*eid));
                let tracks = item_db::upgrade_tracks();
                let tm = item_db::upgrade_track_max();
                let mut diff_info = serde_json::Map::new();
                if is_world_boss_source {
                    // World bosses are capped lower than full raid difficulty tiers.
                    // Prefer config overrides when present; default to Champion 1.
                    let cfg = item_db::season_cfg();
                    let wb_track = cfg
                        .get("worldBossTrack")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Champion")
                        .to_string();
                    let wb_level = cfg
                        .get("worldBossLevel")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(1);
                    if let Some(&(ilvl, bonus_id, quality)) =
                        tracks.get(&(wb_track.clone(), wb_level, tm))
                    {
                        diff_info.insert(
                            "normal".to_string(),
                            serde_json::json!({
                                "ilvl": ilvl, "bonus_id": bonus_id, "quality": quality,
                                "track": wb_track, "level": wb_level, "max_level": tm,
                            }),
                        );
                    }
                } else {
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
                }

                // Compute per-difficulty info for dungeons/M+ / Professions
                let mut dungeon_info = serde_json::Map::new();
                let source_type_lower = source_type_name.to_lowercase();
                let source_inst_lower = source_instance_name.to_lowercase();
                let encounter_name = encounter_ids.get(eid).cloned().unwrap_or_default();
                let encounter_lower = encounter_name.to_lowercase();

                let is_profession_source = source_type_lower.contains("profession")
                    || source_inst_lower.contains("leatherworking")
                    || source_inst_lower.contains("blacksmithing")
                    || source_inst_lower.contains("tailoring")
                    || source_inst_lower.contains("engineering")
                    || source_inst_lower.contains("inscription")
                    || source_inst_lower.contains("jewelcrafting")
                    || source_inst_lower.contains("alchemy")
                    || source_inst_lower.contains("enchanting")
                    || encounter_lower.contains("leatherworking")
                    || encounter_lower.contains("blacksmithing")
                    || encounter_lower.contains("tailoring")
                    || encounter_lower.contains("engineering")
                    || encounter_lower.contains("inscription")
                    || encounter_lower.contains("jewelcrafting")
                    || encounter_lower.contains("alchemy")
                    || encounter_lower.contains("enchanting");

                let is_pvp_crafted = is_profession_source
                    && (item.name.contains("Competitor") || source_type_lower.contains("pvp"));

                if is_profession_source && !is_pvp_crafted {
                    diff_info.clear();
                    // Crafted items follow raid tracks (Champion, Hero, Myth)
                    for diff in &["normal", "heroic", "mythic"] {
                        if let Some(track) = item_db::difficulty_track_name(diff) {
                            let effective_level = upgrade_lvl.unwrap_or(1);
                            if let Some(&(ilvl, bonus_id, _)) =
                                tracks.get(&(track.clone(), effective_level, tm))
                            {
                                diff_info.insert(
                                    diff.to_string(),
                                    serde_json::json!({
                                        "ilvl": ilvl, "bonus_id": bonus_id, "quality": 5,
                                        "track": track, "level": effective_level, "max_level": tm,
                                    }),
                                );
                            }
                        }
                    }
                } else if upgrade_lvl.is_none() {
                    dungeon_info.insert("normal".to_string(), serde_json::json!({
                        "ilvl": item_db::dungeon_normal_ilvl(), "bonus_id": 0, "quality": item_db::dungeon_normal_quality(),
                    }));

                    let sc = item_db::season_cfg();
                    if let Some(ddt) = sc
                        .get("dungeonDifficultyTracks")
                        .and_then(|v| v.as_object())
                    {
                        for (diff_key, entry) in ddt {
                            // Non-rotation dungeons should not receive M+ / vault tiers.
                            if !has_mplus_source && diff_key != "heroic" && diff_key != "mythic" {
                                continue;
                            }
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
                let item_specs: Vec<u64> = item.restriction_ids();
                let is_catalyst = is_catalyst_tier_item(item_id);
                let can_catalyst = allowed_class_id
                    .and_then(|cid| catalyst_tier_item(cid, inv_type as u64))
                    .is_some()
                    && !is_catalyst;

                let mut item_json = serde_json::json!({
                    "item_id": item_id,
                    "name": item.name,
                    "icon": item.icon,
                    "quality": item.quality,
                    "ilevel": item.base_ilevel.unwrap_or(0),
                    "inventory_type": inv_type,
                    "encounter": encounter_name,
                    "encounter_id": *eid,
                    "instance_name": source_instance_name,
                    "instance_id": source_instance_id,
                    "source_type": source_type_name,
                    "is_catalyst": is_catalyst,
                    "can_catalyst": can_catalyst,
                });
                let socket_count = item
                    .socket_info
                    .as_ref()
                    .map(|si| si.sockets.len() as u64)
                    .unwrap_or_else(|| if item.has_sockets { 1 } else { 0 });
                if socket_count > 0 {
                    item_json["socket_count"] = serde_json::json!(socket_count);
                }
                if !item.bonus_lists.is_empty() {
                    item_json["bonus_lists"] = serde_json::json!(item.bonus_lists);
                    let crafted_base_bonus_ids: Vec<u64> = item
                        .bonus_lists
                        .iter()
                        .copied()
                        .filter(|bid| !item_db::is_upgrade_bonus(*bid))
                        .collect();
                    item_json["crafted_base_bonus_ids"] = serde_json::json!(crafted_base_bonus_ids);
                }
                let crafted_levels = item_db::derive_crafted_item_levels(item.id);
                if !crafted_levels.is_empty() {
                    item_json["crafted_levels"] = serde_json::json!(crafted_levels);
                }

                if let Some(stats) = &item.stats {
                    item_json["stats"] = serde_json::json!(stats);
                }

                let mut missive_count = 0;
                if is_profession_source {
                    let secondary_count = item
                        .stats
                        .as_ref()
                        .map(|stats| {
                            stats
                                .iter()
                                .filter(|s| [24, 25, 32, 36, 40, 49].contains(&s.id))
                                .count()
                        })
                        .unwrap_or(0);
                    if secondary_count > 0 {
                        missive_count = secondary_count as u64;
                    } else {
                        // In Retail, Epic+ (Quality 4+) or Jewelry always have 2 stats.
                        // Competitor's gear and high-ilevel profession gear also often have 2.
                        missive_count = if inv_type == 2
                            || inv_type == 11
                            || item.quality >= 4
                            || item.name.contains("Competitor")
                            || item.base_ilevel.unwrap_or(0) >= 200
                        {
                            2
                        } else {
                            1
                        };
                    }
                }
                if missive_count > 0 {
                    item_json["missive_count"] = serde_json::json!(missive_count);
                }
                let embellishments = item_db::list_embellishments_for_item(item_id);
                if !embellishments.is_empty() {
                    item_json["embellishment_options"] = serde_json::json!(embellishments);
                }

                if has_mplus_source {
                    item_json["mplus_rotation"] = serde_json::json!(true);
                } else if source_type_name == "dungeon" || source_type_name == "expansion-dungeon" {
                    item_json["mplus_rotation"] = serde_json::json!(false);
                }

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
                    if !item_specs.is_empty() {
                        if !restrictions_match_active_specs(
                            &item_specs,
                            &main_spec_ids,
                            allowed_class_id,
                        ) {
                            main_can_use = false;
                        }
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

                    if main_can_use
                        && primary_stat_filtered_slot(item_class, inv_type)
                        && !main_spec_primary_stats.is_empty()
                        && !item_matches_primary_stats(item, &main_spec_primary_stats)
                    {
                        main_can_use = false;
                    }

                    if !main_can_use {
                        item_json["off_spec"] = serde_json::json!(true);
                    }
                }
                let has_diff_info = !diff_info.is_empty();
                let has_dungeon_info = !dungeon_info.is_empty();
                if has_diff_info {
                    item_json["difficulty_info"] = Value::Object(diff_info);
                }
                if has_dungeon_info {
                    item_json["dungeon_info"] = Value::Object(dungeon_info);
                }
                let dedupe_key = canonical_drop_key(*eid, item);
                let score = drop_candidate_score(
                    item,
                    can_catalyst,
                    is_catalyst,
                    has_diff_info,
                    has_dungeon_info,
                );
                upsert_slot_candidate(&mut by_slot, slot, dedupe_key, score, item_json);
            }
        }
    }

    let ordered = finalize_slot_map(by_slot);

    if ordered.is_empty() {
        None
    } else {
        Some(ordered)
    }
}

fn get_catalyst_drops(
    class_name: Option<&str>,
    spec_name: Option<&str>,
) -> Option<serde_json::Map<String, Value>> {
    let mut raid_drops = get_drops_by_type("raid", class_name, spec_name)?;
    let class_id = class_name.and_then(class_data::class_wow_id)?;

    for (_, items) in raid_drops.iter_mut() {
        if let Some(arr) = items.as_array_mut() {
            let mut new_arr = Vec::new();
            for item in arr.drain(..) {
                let mut obj = item.as_object().unwrap().clone();
                if obj
                    .get("can_catalyst")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false)
                {
                    let inv_type = obj
                        .get("inventory_type")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);
                    if let Some(tier_info) = item_db::catalyst_tier_item(class_id, inv_type) {
                        obj.insert("item_id".to_string(), serde_json::json!(tier_info.item_id));

                        if let Some(info) = item_db::get_item_info(tier_info.item_id, None) {
                            obj.insert("name".to_string(), serde_json::json!(info.name));
                            obj.insert("icon".to_string(), serde_json::json!(info.icon));
                            obj.insert("quality".to_string(), serde_json::json!(info.quality));
                        } else {
                            obj.insert("name".to_string(), serde_json::json!(tier_info.name));
                            obj.insert("icon".to_string(), serde_json::json!(tier_info.icon));
                        }

                        obj.insert("is_catalyst".to_string(), serde_json::json!(true));
                        obj.insert("can_catalyst".to_string(), serde_json::json!(false));

                        new_arr.push(serde_json::Value::Object(obj));
                    }
                }
            }
            *arr = new_arr;
        }
    }

    raid_drops.retain(|_, v| v.as_array().map_or(false, |arr| !arr.is_empty()));

    if raid_drops.is_empty() {
        None
    } else {
        Some(raid_drops)
    }
}

pub fn get_drops_by_type(
    instance_type: &str,
    class_name: Option<&str>,
    spec_name: Option<&str>,
) -> Option<serde_json::Map<String, Value>> {
    if instance_type == "catalyst" {
        return get_catalyst_drops(class_name, spec_name);
    }

    let instances = item_db::instances();
    let mut merged: HashMap<String, HashMap<String, (i64, Value)>> = HashMap::new();
    for inst in instances {
        let itype = inst.get("type").and_then(|t| t.as_str()).unwrap_or("");
        let matches = if instance_type == "profession" {
            itype.to_lowercase().contains("profession")
        } else {
            itype == instance_type
        };
        if !matches {
            continue;
        }
        let inst_id = inst.get("id").and_then(|id| id.as_i64()).unwrap_or(0);
        if let Some(drops) = get_instance_drops(inst_id, class_name, spec_name) {
            merge_drop_map_into(&mut merged, &drops);
        }
    }

    let ordered = finalize_slot_map(merged);

    if ordered.is_empty() {
        None
    } else {
        Some(ordered)
    }
}

pub fn get_drops_by_instances(
    instance_ids: &[i64],
    class_name: Option<&str>,
    spec_name: Option<&str>,
) -> Option<serde_json::Map<String, Value>> {
    let mut seen_ids = HashSet::new();
    let mut merged: HashMap<String, HashMap<String, (i64, Value)>> = HashMap::new();

    for instance_id in instance_ids {
        if !seen_ids.insert(*instance_id) {
            continue;
        }
        if let Some(drops) = get_instance_drops(*instance_id, class_name, spec_name) {
            merge_drop_map_into(&mut merged, &drops);
        }
    }

    let ordered = finalize_slot_map(merged);
    if ordered.is_empty() {
        None
    } else {
        Some(ordered)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::item_db::state;
    use crate::types::class_data::{self, ClassDef, SpecDef};
    use crate::types::{GameItem, GameItemStat, ItemSource};
    use serde_json::json;
    use std::sync::Arc;

    struct GameDataSnapshot {
        instances: Vec<Value>,
        drops_by_encounter: Arc<HashMap<i64, Vec<GameItem>>>,
        season_config: Value,
        upgrade_tracks: Arc<HashMap<state::UpgradeTrackKey, state::UpgradeTrackValue>>,
        bonuses: Arc<HashMap<u64, crate::types::BonusData>>,
        catalyst: Arc<state::CatalystData>,
        current_season_id: u64,
        items: Arc<HashMap<u64, GameItem>>,
    }

    impl GameDataSnapshot {
        fn capture() -> Self {
            Self {
                instances: state::INSTANCES.read().unwrap().clone(),
                drops_by_encounter: state::DROPS_BY_ENCOUNTER.read().unwrap().clone(),
                season_config: state::SEASON_CONFIG.read().unwrap().clone(),
                upgrade_tracks: state::UPGRADE_TRACKS.read().unwrap().clone(),
                bonuses: state::BONUSES.read().unwrap().clone(),
                catalyst: state::CATALYST.read().unwrap().clone(),
                current_season_id: *state::CURRENT_SEASON_ID.read().unwrap(),
                items: state::ITEMS.read().unwrap().clone(),
            }
        }

        fn restore(self) {
            *state::INSTANCES.write().unwrap() = self.instances;
            *state::DROPS_BY_ENCOUNTER.write().unwrap() = self.drops_by_encounter;
            *state::SEASON_CONFIG.write().unwrap() = self.season_config;
            *state::UPGRADE_TRACKS.write().unwrap() = self.upgrade_tracks;
            *state::BONUSES.write().unwrap() = self.bonuses;
            *state::CATALYST.write().unwrap() = self.catalyst;
            *state::CURRENT_SEASON_ID.write().unwrap() = self.current_season_id;
            *state::ITEMS.write().unwrap() = self.items;
        }
    }

    struct ClassSnapshot {
        classes: Arc<Vec<ClassDef>>,
        trait_spec_ids: HashMap<String, Vec<u64>>,
        class_wow_ids: HashMap<String, u64>,
        spec_to_wow_class: HashMap<u64, u64>,
    }

    impl ClassSnapshot {
        fn capture() -> Self {
            Self {
                classes: class_data::CLASSES.read().unwrap().clone(),
                trait_spec_ids: class_data::CLASS_TRAIT_SPEC_IDS.read().unwrap().clone(),
                class_wow_ids: class_data::CLASS_WOW_IDS.read().unwrap().clone(),
                spec_to_wow_class: class_data::SPEC_TO_WOW_CLASS.read().unwrap().clone(),
            }
        }

        fn restore(self) {
            *class_data::CLASSES.write().unwrap() = self.classes;
            *class_data::CLASS_TRAIT_SPEC_IDS.write().unwrap() = self.trait_spec_ids;
            *class_data::CLASS_WOW_IDS.write().unwrap() = self.class_wow_ids;
            *class_data::SPEC_TO_WOW_CLASS.write().unwrap() = self.spec_to_wow_class;
        }
    }

    fn game_item(
        id: u64,
        name: &str,
        quality: u64,
        ilevel: i64,
        item_class: i64,
        subclass: i64,
        inventory_type: i64,
    ) -> GameItem {
        GameItem {
            id,
            name: name.to_string(),
            icon: format!("icon_{id}"),
            quality,
            base_ilevel: Some(ilevel),
            class: Some(item_class),
            subclass: Some(subclass),
            inventory_type: Some(inventory_type),
            set_id: None,
            has_sockets: false,
            socket_info: None,
            classes: None,
            specs: None,
            stats: None,
            bonus_lists: Vec::new(),
            sources: None,
            profession: None,
        }
    }

    fn install_class_fixture() {
        *class_data::CLASSES.write().unwrap() = Arc::new(vec![ClassDef {
            name: "warrior".to_string(),
            aliases: vec![],
            max_armor: 4,
            weapons: vec![4],
            specs: vec![
                SpecDef {
                    name: "fury".to_string(),
                    id: 72,
                    weapon_subclasses: vec![4],
                    primary_stats: vec![4],
                    can_dual_wield: true,
                    can_use_shield: false,
                    can_use_offhand: false,
                },
                SpecDef {
                    name: "protection".to_string(),
                    id: 73,
                    weapon_subclasses: vec![4],
                    primary_stats: vec![4],
                    can_dual_wield: false,
                    can_use_shield: true,
                    can_use_offhand: true,
                },
            ],
        }]);
        class_data::set_class_trait_spec_ids(HashMap::from([("warrior".to_string(), vec![72, 73])]));
        class_data::set_class_wow_ids(HashMap::from([("warrior".to_string(), 1)]));
        class_data::set_spec_to_wow_class(HashMap::from([(72, 1), (73, 1)]));
    }

    fn install_track_fixture() {
        *state::UPGRADE_TRACKS.write().unwrap() = Arc::new(HashMap::from([
            (("LfrTrack".to_string(), 4_u64, 6_u64), (610_u64, 8001_u64, 3_u64)),
            (("NormalTrack".to_string(), 4_u64, 6_u64), (620_u64, 8002_u64, 4_u64)),
            (("HeroTrack".to_string(), 4_u64, 6_u64), (630_u64, 8003_u64, 4_u64)),
            (("MythTrack".to_string(), 4_u64, 6_u64), (640_u64, 8004_u64, 5_u64)),
            (("Champion".to_string(), 1_u64, 6_u64), (615_u64, 8010_u64, 4_u64)),
        ]));
        *state::SEASON_CONFIG.write().unwrap() = json!({
            "raidDifficulties": [
                {"key":"lfr","track":"LfrTrack"},
                {"key":"normal","track":"NormalTrack"},
                {"key":"heroic","track":"HeroTrack"},
                {"key":"mythic","track":"MythTrack"}
            ],
            "encounterUpgradeLevel": {"2001": 4},
            "dungeonNormal": {"ilvl": 600, "quality": 3},
            "dungeonDifficultyTracks": {
                "heroic": {"track":"HeroTrack","level":4},
                "mythic": {"track":"MythTrack","level":4}
            },
            "worldBossTrack":"Champion",
            "worldBossLevel":1
        });
    }

    #[test]
    fn helper_scoring_and_key_functions_cover_branch_logic() {
        assert!(restrictions_match_active_specs(&[], &[], None));
        assert!(!restrictions_match_active_specs(&[72], &[], Some(1)));
        assert!(restrictions_match_active_specs(&[72], &[72], Some(1)));
        assert!(restrictions_match_active_specs(&[1], &[], Some(1)));
        assert!(!restrictions_match_active_specs(&[2], &[], Some(1)));

        let mut item = game_item(1, "  Edge   Case  ", 4, 620, 2, 4, 13);
        item.stats = Some(vec![GameItemStat { id: 4, alloc: None }]);
        assert!(item_matches_primary_stats(&item, &HashSet::from([4])));
        assert!(!item_matches_primary_stats(&item, &HashSet::from([5])));
        item.stats = None;
        assert!(item_matches_primary_stats(&item, &HashSet::from([5])));
        item.stats = Some(vec![GameItemStat { id: 999, alloc: None }]);
        assert!(item_matches_primary_stats(&item, &HashSet::from([5])));

        assert!(primary_stat_filtered_slot(2, 13));
        assert!(primary_stat_filtered_slot(4, 12));
        assert!(!primary_stat_filtered_slot(4, 1));
        assert_eq!(normalize_drop_key_part("  Multi   Space  Name "), "multi space name");
        assert_eq!(
            canonical_drop_key(7, &game_item(9, " Name ", 4, 1, 2, 3, 4)),
            "7|4|2|3|name"
        );

        let score = drop_candidate_score(&game_item(9, "X", 4, 620, 2, 4, 13), true, true, true, true);
        assert!(score > 40620);
        let value = json!({
            "quality": 4,
            "ilevel": 620,
            "can_catalyst": true,
            "is_catalyst": true,
            "difficulty_info": {"mythic": {"ilvl": 640}},
            "dungeon_info": {"heroic": {"ilvl": 630}}
        });
        assert!(drop_value_score(&value) > 40620);
        assert_eq!(
            drop_value_dedupe_key("Head", &json!({
                "name":"  Alpha   Helm ",
                "encounter":"  BOSS ",
                "instance_name":" Raid One ",
                "inventory_type":1
            })),
            "head|alpha helm|boss|raid one|1"
        );
    }

    #[test]
    fn merge_and_finalize_slot_map_dedupes_and_orders_entries() {
        let mut merged: HashMap<String, HashMap<String, (i64, Value)>> = HashMap::new();
        merge_drop_map_into(
            &mut merged,
            &serde_json::Map::from_iter([(
                "Head".to_string(),
                json!([
                    {"name":"Alpha Helm","encounter":"Boss","instance_name":"Raid","inventory_type":1,"quality":4,"ilevel":620},
                    {"name":"Alpha Helm","encounter":"Boss","instance_name":"Raid","inventory_type":1,"quality":4,"ilevel":625}
                ]),
            )]),
        );

        let ordered = finalize_slot_map(merged);
        let head = ordered
            .get("Head")
            .and_then(Value::as_array)
            .expect("head slot");
        assert_eq!(head.len(), 1);
        assert_eq!(head[0].get("ilevel").and_then(Value::as_i64), Some(625));

        let custom = finalize_slot_map(HashMap::from([(
            "Custom Slot".to_string(),
            HashMap::from([(
                "k".to_string(),
                (1_i64, json!({"name":"Custom","ilevel":500})),
            )]),
        )]));
        assert!(custom.contains_key("Custom Slot"));
    }

    #[test]
    fn get_instances_rewrites_proxy_image_urls_for_instances_and_encounters() {
        let _state_guard = state::TEST_STATE_LOCK
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        let snapshot = GameDataSnapshot::capture();
        *state::INSTANCES.write().unwrap() = vec![json!({
            "id": 55,
            "name": "Raid 55",
            "encounters": [{"id": 551, "name":"Boss", "image_url":"https://old"}]
        })];

        let rows = get_instances();
        assert_eq!(
            rows[0].get("image_url").and_then(Value::as_str),
            Some("/api/data/images/instance/55")
        );
        let encounter_image = rows[0]
            .get("encounters")
            .and_then(Value::as_array)
            .and_then(|arr| arr[0].get("image_url"))
            .and_then(Value::as_str);
        assert_eq!(encounter_image, Some("/api/data/images/encounter/551"));
        snapshot.restore();
    }

    #[test]
    fn drop_queries_cover_raid_profession_catalyst_and_multi_instance_paths() {
        let _state_guard = state::TEST_STATE_LOCK
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        let _class_guard = class_data::TEST_CLASS_DATA_LOCK
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        let snapshot = GameDataSnapshot::capture();
        let class_snapshot = ClassSnapshot::capture();

        install_class_fixture();
        install_track_fixture();
        *state::CURRENT_SEASON_ID.write().unwrap() = 13;
        *state::BONUSES.write().unwrap() = Arc::new(HashMap::new());

        let mut catalyst = state::CatalystData::default();
        catalyst.tier_items.insert(
            (1, 1),
            state::CatalystTierItem {
                item_id: 90001,
                name: "Tier Warhelm".to_string(),
                icon: "tier_icon".to_string(),
                has_set: true,
                bonus_ids: vec![12345],
            },
        );
        catalyst.tier_item_ids.insert(90001);
        *state::CATALYST.write().unwrap() = Arc::new(catalyst);

        *state::ITEMS.write().unwrap() = Arc::new(HashMap::from([(
            90001,
            game_item(90001, "Tier Warhelm", 4, 630, 4, 4, 1),
        )]));

        *state::INSTANCES.write().unwrap() = vec![
            json!({"id": 100, "name":"Raid Alpha", "type":"raid", "encounters":[{"id":1001,"name":"Boss Alpha"}]}),
            json!({"id": 11, "name":"World Bosses", "type":"raid", "encounters":[{"id":1101,"name":"WB Alpha"}]}),
            json!({"id": 200, "name":"Leatherworking Workshop", "type":"profession", "encounters":[{"id":2001,"name":"Pattern"}]}),
            json!({"id": 30, "name":"Dungeon Prime", "type":"dungeon", "encounters":[{"id":3001,"name":"Final Boss"}], "active_rotation": true}),
            json!({"id": -1, "name":"Mythic Plus", "type":"mythic_plus", "encounters":[{"id":30,"name":"Dungeon Prime"}]}),
            json!({"id": -2, "name":"Meta Pool", "type":"pool", "encounters":[{"id":30,"name":"Dungeon Prime"}]}),
        ];

        let mut raid_good = game_item(5001, "Warhelm of Strength", 4, 620, 4, 4, 1);
        raid_good.specs = Some(vec![72]);
        raid_good.stats = Some(vec![GameItemStat { id: 4, alloc: None }]);

        let raid_bad_armor = game_item(5002, "Leather Hat", 4, 619, 4, 2, 1);
        let mut raid_bad_trinket = game_item(5003, "Int Trinket", 4, 621, 4, 0, 12);
        raid_bad_trinket.stats = Some(vec![GameItemStat { id: 5, alloc: None }]);
        let mut raid_good_trinket = game_item(5004, "Strength Trinket", 4, 622, 4, 0, 12);
        raid_good_trinket.stats = Some(vec![GameItemStat { id: 4, alloc: None }]);

        let mut world_boss_item = game_item(5101, "World Helm", 4, 615, 4, 4, 1);
        world_boss_item.specs = Some(vec![72]);

        let mut profession_item = game_item(5201, "Forged Breastplate", 5, 625, 4, 4, 5);
        profession_item.stats = Some(vec![GameItemStat { id: 4, alloc: None }]);
        profession_item.sources = Some(vec![ItemSource {
            encounter_id: Some(2001),
            instance_id: Some(30),
        }]);

        let mut meta_item = game_item(5301, "Meta Axe", 4, 624, 2, 4, 13);
        meta_item.stats = Some(vec![GameItemStat { id: 4, alloc: None }]);

        *state::DROPS_BY_ENCOUNTER.write().unwrap() = Arc::new(HashMap::from([
            (1001_i64, vec![raid_good, raid_bad_armor, raid_bad_trinket, raid_good_trinket]),
            (1101_i64, vec![world_boss_item]),
            (2001_i64, vec![profession_item]),
            (30_i64, vec![meta_item]),
        ]));

        let raid = get_instance_drops(100, Some("warrior"), Some("fury")).expect("raid drops");
        let raid_head = raid
            .get("Head")
            .and_then(Value::as_array)
            .expect("head slot");
        assert_eq!(raid_head.len(), 1);
        assert_eq!(raid_head[0].get("item_id").and_then(Value::as_u64), Some(5001));
        assert_eq!(
            raid_head[0].get("can_catalyst").and_then(Value::as_bool),
            Some(true)
        );
        assert!(raid_head[0].get("difficulty_info").is_some());
        let raid_trinkets = raid
            .get("Trinket")
            .and_then(Value::as_array)
            .expect("trinket slot");
        assert_eq!(raid_trinkets.len(), 1);
        assert_eq!(
            raid_trinkets[0].get("item_id").and_then(Value::as_u64),
            Some(5004)
        );

        let world_boss = get_instance_drops(11, Some("warrior"), Some("fury")).expect("wb drops");
        let wb_head = world_boss
            .get("Head")
            .and_then(Value::as_array)
            .and_then(|arr| arr.first())
            .expect("wb head");
        assert_eq!(wb_head.get("instance_name").and_then(Value::as_str), Some("World Bosses"));
        assert!(wb_head
            .get("difficulty_info")
            .and_then(Value::as_object)
            .is_some_and(|obj| obj.contains_key("normal")));

        let profession =
            get_drops_by_type("profession", Some("warrior"), Some("fury")).expect("profession drops");
        let prof_head_or_chest = profession
            .values()
            .find_map(|v| v.as_array())
            .and_then(|arr| arr.first())
            .expect("profession item");
        assert!(prof_head_or_chest.get("difficulty_info").is_some());
        assert_eq!(
            prof_head_or_chest
                .get("mplus_rotation")
                .and_then(Value::as_bool),
            Some(true)
        );

        let catalyst =
            get_drops_by_type("catalyst", Some("warrior"), Some("fury")).expect("catalyst drops");
        let catalyst_head = catalyst
            .get("Head")
            .and_then(Value::as_array)
            .and_then(|arr| arr.first())
            .expect("catalyst head");
        assert_eq!(
            catalyst_head.get("item_id").and_then(Value::as_u64),
            Some(90001)
        );
        assert_eq!(
            catalyst_head.get("is_catalyst").and_then(Value::as_bool),
            Some(true)
        );

        // Remove tier item from item DB to cover catalyst fallback naming branch.
        *state::ITEMS.write().unwrap() = Arc::new(HashMap::new());
        let catalyst_fallback = get_drops_by_type("catalyst", Some("warrior"), Some("fury"))
            .expect("catalyst fallback");
        let catalyst_fallback_head = catalyst_fallback
            .get("Head")
            .and_then(Value::as_array)
            .and_then(|arr| arr.first())
            .expect("catalyst fallback head");
        assert_eq!(
            catalyst_fallback_head.get("name").and_then(Value::as_str),
            Some("Tier Warhelm")
        );

        let multi = get_drops_by_instances(&[100, 100, 11], Some("warrior"), Some("fury"))
            .expect("multi drops");
        assert!(multi.contains_key("Head"));

        let meta = get_instance_drops(-2, Some("warrior"), Some("fury")).expect("meta drops");
        let meta_weapon = meta
            .get("Main Hand")
            .and_then(Value::as_array)
            .and_then(|arr| arr.first())
            .expect("meta weapon");
        assert_eq!(
            meta_weapon.get("instance_name").and_then(Value::as_str),
            Some("Dungeon Prime")
        );
        assert_eq!(
            meta_weapon.get("instance_id").and_then(Value::as_i64),
            Some(30)
        );

        assert!(get_instance_drops(9999, Some("warrior"), Some("fury")).is_none());
        assert!(get_drops_by_type("unknown", Some("warrior"), Some("fury")).is_none());
        assert!(get_drops_by_instances(&[], Some("warrior"), Some("fury")).is_none());
        assert!(get_drops_by_type("catalyst", None, Some("fury")).is_none());
        assert!(get_drops_by_type("catalyst", Some("warrior"), None).is_some());

        class_snapshot.restore();
        snapshot.restore();
    }
}
