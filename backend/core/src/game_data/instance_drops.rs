use serde_json::Value;
use std::collections::{HashMap, HashSet};

use super::drops::{
    canonical_drop_key, drop_candidate_score, finalize_slot_map, item_matches_primary_stats,
    primary_stat_filtered_slot, restrictions_match_active_specs, upsert_slot_candidate,
};
use crate::item_db::{self, catalyst_tier_item, is_catalyst_tier_item};
use crate::types::class_data;

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
                    if !item_specs.is_empty()
                        && !restrictions_match_active_specs(
                            &item_specs,
                            &main_spec_ids,
                            allowed_class_id,
                        )
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
