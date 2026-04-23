//! Gear Resolver — takes flat parsed items + character info + item DB
//! and returns a fully enriched, slot-resolved gear layout.

use std::collections::{HashMap, HashSet};

pub mod catalyst;
pub mod eligibility;

pub use catalyst::{build_catalyst_item, slot_to_inv_type};

use crate::item_db;
use crate::types::class_data::{ARMOR_SLOTS, GEAR_SLOTS};
use crate::types::*;
use eligibility::{dedup_key, eligible_slots, enrich, make_uid};

fn restrictions_match_active_spec(
    item_restrictions: &[u64],
    active_spec_ids: &[u64],
    active_class_id: Option<u64>,
) -> bool {
    if item_restrictions.is_empty() {
        return true;
    }
    let has_spec_entries = item_restrictions.iter().any(|id| *id > 13);
    if has_spec_entries {
        return !active_spec_ids.is_empty()
            && active_spec_ids
                .iter()
                .any(|sid| item_restrictions.contains(sid));
    }
    active_class_id.is_some_and(|cid| item_restrictions.contains(&cid))
}

fn item_matches_primary_stats(item: &GameItem, allowed_primary: &HashSet<u64>) -> bool {
    if allowed_primary.is_empty() {
        return true;
    }
    let Some(stats) = &item.stats else {
        // Keep items without explicit primary stat tokens (many proc trinkets).
        return true;
    };

    let mut saw_primary_token = false;
    for stat in stats {
        let expanded = crate::types::class_data::expand_primary_stat(stat.id);
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

fn primary_stat_filtered_slot(item_class: i64, inv_type: i64) -> bool {
    item_class == 2 || inv_type == 12 || inv_type == 14 || inv_type == 23
}

fn mark_off_spec_items(
    slots: &mut HashMap<String, SlotResolution>,
    class_name: &str,
    spec_name: &str,
) {
    let class_name = class_name.trim();
    let spec_name = spec_name
        .split(',')
        .next()
        .unwrap_or(spec_name)
        .trim();
    if class_name.is_empty() || spec_name.is_empty() {
        return;
    }

    let active_spec_ids = crate::types::class_data::class_spec_ids(class_name, Some(spec_name));
    if active_spec_ids.is_empty() {
        return;
    }
    let active_class_id = crate::types::class_data::class_wow_id(class_name);
    let spec_profile = crate::types::class_data::spec_weapon_profile(class_name, spec_name);
    let allowed_weapons = crate::types::class_data::class_allowed_weapons(class_name);
    let allowed_primary: HashSet<u64> = spec_profile
        .as_ref()
        .map(|p| p.primary_stats.iter().copied().collect())
        .unwrap_or_default();

    let mut cache: HashMap<u64, bool> = HashMap::new();
    let mut compute_off_spec = |item_id: u64| -> bool {
        if let Some(flag) = cache.get(&item_id).copied() {
            return flag;
        }

        let off_spec = item_db::get_raw_item(item_id).is_some_and(|raw| {
            let restrictions = raw.restriction_ids();
            if !restrictions_match_active_spec(&restrictions, &active_spec_ids, active_class_id) {
                return true;
            }

            let item_class = raw.class.unwrap_or(0);
            let inv_type = raw.inventory_type.unwrap_or(0);
            let weapon_sub = raw.subclass.unwrap_or(0) as u64;

            if item_class == 2 || inv_type == 14 || inv_type == 23 {
                if let Some(profile) = &spec_profile {
                    let can_use = if item_class == 2 {
                        profile.weapon_subclasses.contains(&weapon_sub)
                    } else if inv_type == 14 {
                        profile.can_use_shield
                    } else {
                        profile.can_use_offhand
                    };
                    if !can_use {
                        return true;
                    }
                } else if let Some(weapons) = &allowed_weapons {
                    if item_class == 2 && !weapons.contains(&weapon_sub) {
                        return true;
                    }
                }
            }

            if primary_stat_filtered_slot(item_class, inv_type)
                && !item_matches_primary_stats(&raw, &allowed_primary)
            {
                return true;
            }

            false
        });

        cache.insert(item_id, off_spec);
        off_spec
    };

    for slot in slots.values_mut() {
        if let Some(eq) = slot.equipped.as_mut() {
            eq.off_spec = compute_off_spec(eq.item_id);
        }
        for alt in &mut slot.alternatives {
            alt.off_spec = compute_off_spec(alt.item_id);
        }
    }
}

/// Resolve a flat list of parsed items into a slot-organized, enriched gear set.
pub fn resolve_gear(parse_result: &ParseResult) -> ResolveGearResponse {
    resolve_gear_impl(parse_result, None)
}

/// Resolve gear with optional catalyst alternative generation.
pub fn resolve_gear_with_catalyst(
    parse_result: &ParseResult,
    catalyst_charges: Option<u32>,
) -> ResolveGearResponse {
    resolve_gear_impl(parse_result, catalyst_charges)
}

fn resolve_gear_impl(
    parse_result: &ParseResult,
    catalyst_charges: Option<u32>,
) -> ResolveGearResponse {
    let character = &parse_result.character;
    let spec = character.spec.as_deref().unwrap_or("");
    let class_name = character.class_name.as_deref().unwrap_or("");
    let max_armor = character.max_armor();
    let allowed_weapons = crate::types::class_data::class_allowed_weapons(class_name);
    let can_dw = character.can_dual_wield();

    let mut slots: HashMap<String, SlotResolution> = HashMap::new();
    let mut excluded: Vec<ExcludedItem> = Vec::new();
    let mut seen_per_slot: HashMap<String, HashSet<String>> = HashMap::new();

    let equipped_items: Vec<&RawParsedItem> = parse_result
        .items
        .iter()
        .filter(|i| i.origin == ItemOrigin::Equipped)
        .collect();
    let other_items: Vec<&RawParsedItem> = parse_result
        .items
        .iter()
        .filter(|i| i.origin != ItemOrigin::Equipped)
        .collect();

    let equipped_by_slot: HashMap<String, &RawParsedItem> = equipped_items
        .iter()
        .map(|i| (i.raw_slot.clone(), *i))
        .collect();

    // Step 1: Place equipped items
    for item in &equipped_items {
        if item.item_id == 0 {
            continue;
        }
        let slot = &item.raw_slot;
        if !GEAR_SLOTS.contains(&slot.as_str()) {
            continue;
        }

        seen_per_slot
            .entry(slot.clone())
            .or_default()
            .insert(dedup_key(item));
        let resolved = enrich(item, slot);
        slots
            .entry(slot.clone())
            .or_insert_with(|| SlotResolution {
                equipped: None,
                alternatives: Vec::new(),
            })
            .equipped = Some(resolved);
    }

    // Step 2: Dual-wield and Pair crossover
    if can_dw {
        handle_dw_crossover(&equipped_items, &mut slots, &mut seen_per_slot);
    }
    handle_pair_crossover(&equipped_by_slot, &mut slots);

    // Step 3: Place non-equipped items
    for item in &other_items {
        if item.item_id == 0 {
            continue;
        }
        let item_eligible = eligible_slots(item, spec);
        if item_eligible.is_empty() {
            continue;
        }

        let armor_excluded = max_armor.is_some_and(|max| {
            item_db::get_item_armor_subclass(item.item_id).is_some_and(|sub| sub > 0 && sub > max)
        });

        let weapon_excluded = allowed_weapons.as_ref().is_some_and(|weapons| {
            if let Some(item_info) = item_db::get_item_info(item.item_id, Some(&item.bonus_ids)) {
                let ic = item_info.item_class;
                let isc = item_info.item_subclass;
                ic == 2 && !weapons.contains(&(isc as u64))
            } else {
                false
            }
        });

        for slot in &item_eligible {
            if !GEAR_SLOTS.contains(&slot.as_str()) {
                continue;
            }

            if armor_excluded && ARMOR_SLOTS.contains(&slot.as_str()) {
                excluded.push(ExcludedItem {
                    uid: make_uid(item, slot),
                    item_id: item.item_id,
                    name: item.name.clone(),
                    reason: "Wrong armor type".to_string(),
                });
                continue;
            }

            if weapon_excluded && matches!(slot.as_str(), "main_hand" | "off_hand") {
                excluded.push(ExcludedItem {
                    uid: make_uid(item, slot),
                    item_id: item.item_id,
                    name: item.name.clone(),
                    reason: "Wrong weapon type".to_string(),
                });
                continue;
            }

            let dk = dedup_key(item);
            if !seen_per_slot.entry(slot.clone()).or_default().insert(dk) {
                continue;
            }

            slots
                .entry(slot.clone())
                .or_insert_with(|| SlotResolution {
                    equipped: None,
                    alternatives: Vec::new(),
                })
                .alternatives
                .push(enrich(item, slot));
        }
    }

    // Sort and finalize
    for slot_res in slots.values_mut() {
        slot_res
            .alternatives
            .sort_by(|a, b| b.ilevel.cmp(&a.ilevel));
    }

    if let Some(class_id) = crate::types::class_data::class_wow_id(class_name) {
        catalyst::mark_catalyst_eligible(&mut slots, class_id);
        if catalyst_charges.is_some() {
            catalyst::generate_catalyst_alternatives(&mut slots, class_id);
        }
    }

    mark_off_spec_items(&mut slots, class_name, spec);

    ResolveGearResponse {
        character: CharacterResolveInfo {
            class_name: character.class_name.clone(),
            spec: character.spec.clone(),
            can_dual_wield: can_dw,
        },
        base_profile: parse_result.base_profile.clone(),
        slots,
        excluded,
        talent_loadouts: parse_result.talent_loadouts.clone(),
        catalyst_charges,
    }
}

fn handle_dw_crossover(
    equipped: &[&RawParsedItem],
    slots: &mut HashMap<String, SlotResolution>,
    seen: &mut HashMap<String, HashSet<String>>,
) {
    let mh = equipped.iter().find(|i| i.raw_slot == "main_hand");
    let oh = equipped.iter().find(|i| i.raw_slot == "off_hand");

    let crossover = |item: &RawParsedItem,
                     target_slot: &str,
                     slots: &mut HashMap<String, SlotResolution>,
                     seen: &mut HashMap<String, HashSet<String>>| {
        if item.item_id > 0 && item_db::get_inventory_type(item.item_id) == Some(13) {
            let dk = dedup_key(item);
            if seen.entry(target_slot.to_string()).or_default().insert(dk) {
                let mut resolved = enrich(item, target_slot);
                resolved.origin = ItemOrigin::Equipped;
                slots
                    .entry(target_slot.to_string())
                    .or_default()
                    .alternatives
                    .push(resolved);
            }
        }
    };

    if let Some(m) = mh {
        crossover(m, "off_hand", slots, seen);
    }
    if let Some(o) = oh {
        crossover(o, "main_hand", slots, seen);
    }
}

fn handle_pair_crossover(
    equipped_by_slot: &HashMap<String, &RawParsedItem>,
    slots: &mut HashMap<String, SlotResolution>,
) {
    for &slot_name in &["finger1", "trinket1"] {
        let other = if slot_name == "finger1" {
            "finger2"
        } else {
            "trinket2"
        };
        if let Some(eq) = equipped_by_slot.get(slot_name) {
            if eq.item_id > 0 {
                slots
                    .entry(other.to_string())
                    .or_default()
                    .alternatives
                    .push(enrich(eq, other));
            }
        }
    }
}
