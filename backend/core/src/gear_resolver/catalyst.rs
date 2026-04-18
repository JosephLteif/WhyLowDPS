use crate::item_db;
use crate::types::class_data;
use crate::types::*;
use std::collections::HashMap;

/// Inventory type for each slot (used for catalyst item lookup).
pub fn slot_to_inv_type(slot: &str) -> Option<u64> {
    match slot {
        "head" => Some(1),
        "shoulder" => Some(3),
        "chest" => Some(5),
        "hands" => Some(10),
        "legs" => Some(7),
        "back" => Some(16),
        "wrist" => Some(9),
        "feet" => Some(8),
        "waist" => Some(6),
        "finger1" | "finger2" => Some(11),
        "main_hand" => Some(21),
        "off_hand" => Some(22),
        _ => None,
    }
}

/// Check if an item is on veteran track or higher.
pub fn is_minimum_veteran(upgrade: &str) -> bool {
    item_db::is_minimum_track(upgrade, "Veteran")
}

/// Build a catalyst variant of a source item for a given slot.
pub fn build_catalyst_item(
    source: &ResolvedItem,
    tier_info: &item_db::CatalystTierItem,
    slot: &str,
) -> ResolvedItem {
    let tier_item_id = tier_info.item_id;
    // Catalyst outputs are alternatives; if source was equipped, mark as Bags
    // so Top Gear does not treat converted gear as baseline.
    let catalyst_origin = if source.origin == ItemOrigin::Equipped {
        ItemOrigin::Bags
    } else {
        source.origin
    };

    // Build catalyst bonus_ids: keep only ilevel-related bonuses from the source,
    // then add the tier set marker bonus for tier set items.
    let mut catalyst_bonus_ids = item_db::filter_ilevel_bonus_ids(&source.bonus_ids);
    if tier_info.has_set {
        catalyst_bonus_ids.push(item_db::tier_set_bonus_id());
    }
    catalyst_bonus_ids.sort();

    // Build simc_string
    let bonus_str = catalyst_bonus_ids
        .iter()
        .map(|b| b.to_string())
        .collect::<Vec<_>>()
        .join("/");
    let mut simc_parts = vec![format!(",id={}", tier_item_id)];
    if !bonus_str.is_empty() {
        simc_parts.push(format!(",bonus_id={}", bonus_str));
    }
    if source.enchant_id > 0 {
        simc_parts.push(format!(",enchant_id={}", source.enchant_id));
    }
    if source.gem_id > 0 {
        simc_parts.push(format!(",gem_id={}", source.gem_id));
    }
    let new_simc = simc_parts.join("");

    // Enrich from the tier item
    let (name, icon, quality, tag, upgrade) =
        if let Some(info) = item_db::get_item_info(tier_item_id, Some(&catalyst_bonus_ids)) {
            (info.name, info.icon, info.quality, info.tag, info.upgrade)
        } else {
            (
                tier_info.name.clone(),
                tier_info.icon.clone(),
                4,
                String::new(),
                String::new(),
            )
        };

    let bonus_key = catalyst_bonus_ids
        .iter()
        .map(|b| b.to_string())
        .collect::<Vec<_>>()
        .join(":");
    let uid = format!(
        "{}:{}:{}:{}",
        tier_item_id,
        bonus_key,
        catalyst_origin.as_str(),
        slot
    );

    ResolvedItem {
        uid,
        slot: slot.to_string(),
        item_id: tier_item_id,
        ilevel: source.ilevel,
        simc_string: new_simc,
        origin: catalyst_origin,
        bonus_ids: catalyst_bonus_ids,
        enchant_id: source.enchant_id,
        gem_id: source.gem_id,
        name,
        icon,
        quality,
        quality_color: class_data::quality_color(quality as u64).to_string(),
        tag,
        upgrade,
        sockets: 0,
        enchant_name: source.enchant_name.clone(),
        gem_name: source.gem_name.clone(),
        gem_icon: source.gem_icon.clone(),
        encounter: source.encounter.clone(),
        instance_name: source.instance_name.clone(),
        source_type: source.source_type.clone(),
        season_id: source.season_id,
        inventory_type: source.inventory_type,
        is_catalyst: true,
        can_catalyst: false,
        ..Default::default()
    }
}

/// Mark all items that are eligible for catalyst conversion with `can_catalyst = true`.
pub fn mark_catalyst_eligible(slots: &mut HashMap<String, SlotResolution>, wow_class_id: u64) {
    let current_season = item_db::current_season_id();

    for (slot_key, slot_res) in slots.iter_mut() {
        let inv_type = match slot_to_inv_type(slot_key) {
            Some(t) => t,
            None => continue,
        };
        let tier_info = match item_db::catalyst_tier_item(wow_class_id, inv_type) {
            Some(t) => t,
            None => continue,
        };

        let check = |item: &ResolvedItem| -> bool {
            !item.is_catalyst
                && item.season_id == current_season as i64
                && is_minimum_veteran(&item.upgrade)
                && item.item_id != tier_info.item_id
        };

        if let Some(ref mut eq) = slot_res.equipped {
            if check(eq) {
                eq.can_catalyst = true;
            }
        }
        for alt in &mut slot_res.alternatives {
            if check(alt) {
                alt.can_catalyst = true;
            }
        }
    }
}

/// Generate catalyst alternatives across all slots.
pub fn generate_catalyst_alternatives(
    slots: &mut HashMap<String, SlotResolution>,
    wow_class_id: u64,
) {
    let slot_keys: Vec<String> = slots.keys().cloned().collect();

    for slot_key in &slot_keys {
        let inv_type = match slot_to_inv_type(slot_key) {
            Some(t) => t,
            None => continue,
        };
        let tier_info = match item_db::catalyst_tier_item(wow_class_id, inv_type) {
            Some(t) => t,
            None => continue,
        };

        let slot_res = match slots.get(slot_key.as_str()) {
            Some(s) => s,
            None => continue,
        };

        let mut sources: Vec<ResolvedItem> = Vec::new();
        if let Some(ref eq) = slot_res.equipped {
            sources.push(eq.clone());
        }
        sources.extend(slot_res.alternatives.iter().cloned());

        let mut existing: HashMap<u64, i64> = HashMap::new();
        if let Some(ref eq) = slot_res.equipped {
            existing.insert(eq.item_id, eq.ilevel);
        }
        for alt in &slot_res.alternatives {
            let entry = existing.entry(alt.item_id).or_insert(0);
            if alt.ilevel > *entry {
                *entry = alt.ilevel;
            }
        }

        let current_season = item_db::current_season_id();
        let mut best: Option<ResolvedItem> = None;

        for source in &sources {
            if source.is_catalyst
                || source.season_id != current_season as i64
                || !is_minimum_veteran(&source.upgrade)
                || source.item_id == tier_info.item_id
            {
                continue;
            }

            let catalyst_item = build_catalyst_item(source, &tier_info, slot_key);

            if let Some(&existing_ilevel) = existing.get(&catalyst_item.item_id) {
                if existing_ilevel >= catalyst_item.ilevel {
                    continue;
                }
            }

            let dominated = if let Some(ref current_best) = best {
                if catalyst_item.ilevel > current_best.ilevel {
                    false
                } else if catalyst_item.ilevel < current_best.ilevel {
                    true
                } else {
                    let new_rank = item_db::track_rank(&catalyst_item.upgrade).unwrap_or(0);
                    let cur_rank = item_db::track_rank(&current_best.upgrade).unwrap_or(0);
                    new_rank <= cur_rank
                }
            } else {
                false
            };

            if !dominated {
                best = Some(catalyst_item);
            }
        }

        if let Some(catalyst_item) = best {
            if let Some(slot_res) = slots.get_mut(slot_key.as_str()) {
                slot_res.alternatives.push(catalyst_item);
            }
        }
    }
}
