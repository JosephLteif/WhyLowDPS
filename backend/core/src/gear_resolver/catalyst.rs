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
        "finger" | "finger1" | "finger2" => Some(11),
        "trinket" | "trinket1" | "trinket2" => Some(12),
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
    catalyst_bonus_ids.extend(tier_info.bonus_ids.iter().copied());
    if tier_info.has_set {
        catalyst_bonus_ids.push(item_db::tier_set_bonus_id());
    }
    catalyst_bonus_ids.sort_unstable();
    catalyst_bonus_ids.dedup();

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
        encounter_id: source.encounter_id,
        instance_id: source.instance_id,
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::item_db::state;
    use crate::types::{BonusData, BonusIlevel, GameItem};
    use std::sync::Arc;

    fn make_item(item_id: u64, ilevel: i64, upgrade: &str, origin: ItemOrigin) -> ResolvedItem {
        ResolvedItem {
            uid: format!("head-{item_id}-{ilevel}"),
            slot: "head".to_string(),
            item_id,
            ilevel,
            simc_string: format!("id={item_id}"),
            origin,
            bonus_ids: vec![7001, 7002],
            upgrade: upgrade.to_string(),
            season_id: 13,
            inventory_type: 1,
            ..ResolvedItem::default()
        }
    }

    fn with_catalyst_state<T>(f: impl FnOnce() -> T) -> T {
        let _guard = state::TEST_STATE_LOCK.lock().unwrap();
        let prev_bonuses = state::BONUSES.read().unwrap().clone();
        let prev_catalyst = state::CATALYST.read().unwrap().clone();
        let prev_season = *state::CURRENT_SEASON_ID.read().unwrap();
        let prev_cfg = state::SEASON_CONFIG.read().unwrap().clone();
        let prev_items = state::ITEMS.read().unwrap().clone();

        let mut bonuses = HashMap::new();
        bonuses.insert(
            7001,
            BonusData {
                ilevel: Some(BonusIlevel {
                    amount: Some(10),
                    priority: Some(1),
                }),
                ..BonusData::default()
            },
        );
        bonuses.insert(7002, BonusData::default());
        *state::BONUSES.write().unwrap() = Arc::new(bonuses);

        let mut catalyst = state::CatalystData::default();
        catalyst.tier_items.insert(
            (8, 1),
            state::CatalystTierItem {
                item_id: 99001,
                name: "Tier Helm".to_string(),
                icon: "inv_helm_plate_raidwarrior_p_01".to_string(),
                has_set: true,
                bonus_ids: vec![8888],
            },
        );
        catalyst.tier_item_ids.insert(99001);
        *state::CATALYST.write().unwrap() = Arc::new(catalyst);
        *state::CURRENT_SEASON_ID.write().unwrap() = 13;
        *state::SEASON_CONFIG.write().unwrap() = serde_json::json!({"tierSetBonusId": 2468});
        *state::ITEMS.write().unwrap() = Arc::new(HashMap::from([(
            99001,
            GameItem {
                id: 99001,
                name: "Tier Helm".to_string(),
                icon: "inv_helm_plate_raidwarrior_p_01".to_string(),
                quality: 4,
                base_ilevel: Some(610),
                class: Some(4),
                subclass: Some(4),
                inventory_type: Some(1),
                set_id: None,
                has_sockets: false,
                socket_info: None,
                classes: None,
                specs: None,
                stats: None,
                bonus_lists: Vec::new(),
                sources: None,
                profession: None,
            },
        )]));

        let result = f();

        *state::BONUSES.write().unwrap() = prev_bonuses;
        *state::CATALYST.write().unwrap() = prev_catalyst;
        *state::CURRENT_SEASON_ID.write().unwrap() = prev_season;
        *state::SEASON_CONFIG.write().unwrap() = prev_cfg;
        *state::ITEMS.write().unwrap() = prev_items;
        result
    }

    #[test]
    fn slot_to_inv_type_maps_expected_slots() {
        assert_eq!(slot_to_inv_type("head"), Some(1));
        assert_eq!(slot_to_inv_type("finger2"), Some(11));
        assert_eq!(slot_to_inv_type("trinket1"), Some(12));
        assert_eq!(slot_to_inv_type("unknown"), None);
    }

    #[test]
    fn build_catalyst_item_keeps_ilevel_and_adds_tier_set_bonuses() {
        with_catalyst_state(|| {
            let source = ResolvedItem {
                item_id: 70000,
                ilevel: 626,
                origin: ItemOrigin::Equipped,
                bonus_ids: vec![7002, 7001],
                enchant_id: 44,
                gem_id: 55,
                enchant_name: "Authority".to_string(),
                gem_name: "Masterful Ruby".to_string(),
                gem_icon: "inv_gem".to_string(),
                season_id: 13,
                ..ResolvedItem::default()
            };
            let tier = item_db::catalyst_tier_item(8, 1).expect("tier item");
            let catalyst_item = build_catalyst_item(&source, &tier, "head");

            assert_eq!(catalyst_item.item_id, 99001);
            assert_eq!(catalyst_item.ilevel, 626);
            assert_eq!(catalyst_item.origin, ItemOrigin::Bags);
            assert_eq!(catalyst_item.bonus_ids, vec![2468, 7001, 8888]);
            assert!(catalyst_item.simc_string.contains(",id=99001"));
            assert!(catalyst_item
                .simc_string
                .contains(",bonus_id=2468/7001/8888"));
            assert!(catalyst_item.simc_string.contains(",enchant_id=44"));
            assert!(catalyst_item.simc_string.contains(",gem_id=55"));
            assert!(catalyst_item.is_catalyst);
        });
    }

    #[test]
    fn mark_catalyst_eligible_only_marks_valid_current_season_items() {
        with_catalyst_state(|| {
            let mut slots = HashMap::from([(
                "head".to_string(),
                SlotResolution {
                    equipped: Some(make_item(70010, 620, "Veteran 3/8", ItemOrigin::Equipped)),
                    alternatives: vec![
                        make_item(70011, 620, "Adventurer 8/8", ItemOrigin::Bags),
                        make_item(70012, 620, "Champion 1/8", ItemOrigin::Bags),
                        make_item(99001, 620, "Hero 1/6", ItemOrigin::Bags),
                    ],
                },
            )]);

            if let Some(slot) = slots.get_mut("head") {
                if let Some(item) = slot.alternatives.get_mut(1) {
                    item.season_id = 12;
                }
            }

            mark_catalyst_eligible(&mut slots, 8);

            let slot = slots.get("head").expect("head slot");
            assert!(slot.equipped.as_ref().expect("equipped").can_catalyst);
            assert!(!slot.alternatives[0].can_catalyst);
            assert!(!slot.alternatives[1].can_catalyst);
            assert!(!slot.alternatives[2].can_catalyst);
        });
    }

    #[test]
    fn generate_catalyst_alternatives_adds_best_source_variant() {
        with_catalyst_state(|| {
            let mut slots = HashMap::from([(
                "head".to_string(),
                SlotResolution {
                    equipped: Some(make_item(70010, 620, "Veteran 3/8", ItemOrigin::Equipped)),
                    alternatives: vec![
                        make_item(70020, 628, "Champion 4/8", ItemOrigin::Bags),
                        make_item(70030, 624, "Veteran 8/8", ItemOrigin::Vault),
                    ],
                },
            )]);

            generate_catalyst_alternatives(&mut slots, 8);
            let slot = slots.get("head").expect("head slot");
            let added = slot
                .alternatives
                .iter()
                .find(|item| item.item_id == 99001)
                .expect("generated catalyst");

            assert_eq!(added.ilevel, 628);
            assert!(added.is_catalyst);
        });
    }
}
