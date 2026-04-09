use crate::game_data;
use crate::types::class_data::UNIQUE_SLOT_PAIRS;
use crate::types::{ItemOrigin, ResolvedItem};
use std::collections::{HashMap, HashSet};

/// Vault constraint: at most one vault item across all slots.
pub fn validate_vault_constraint(gear_set: &HashMap<String, ResolvedItem>) -> bool {
    let mut vault_item_ids: HashSet<u64> = HashSet::new();
    for item in gear_set.values() {
        if item.origin == ItemOrigin::Vault {
            vault_item_ids.insert(item.item_id);
            if vault_item_ids.len() > 1 {
                return false;
            }
        }
    }
    true
}

/// Catalyst constraint: at most `max_charges` catalyst items per combination.
pub fn validate_catalyst_constraint(
    gear_set: &HashMap<String, ResolvedItem>,
    max_charges: u32,
) -> bool {
    let count = gear_set.values().filter(|item| item.is_catalyst).count();
    count as u32 <= max_charges
}

/// Weapon constraint: a two-hander in main_hand cannot be paired with an off_hand item,
/// unless the spec is fury (Titan's Grip).
pub fn validate_weapon_constraint(gear_set: &HashMap<String, ResolvedItem>, spec: &str) -> bool {
    if spec == "fury" {
        return true;
    }
    let Some(mh) = gear_set.get("main_hand") else {
        return true;
    };
    if mh.item_id == 0 {
        return true;
    }
    let inv_type = game_data::get_inventory_type(mh.item_id).unwrap_or(0);
    if inv_type != 17 {
        return true;
    }
    // Main hand is a two-hander — off_hand must be empty
    let oh = gear_set.get("off_hand");
    match oh {
        None => true,
        Some(oh_item) => oh_item.item_id == 0,
    }
}

/// Validate unique-equipped constraints (e.g. rings, trinkets).
pub fn validate_unique_equipped(gear_set: &HashMap<String, ResolvedItem>) -> bool {
    for (slot1, slot2) in UNIQUE_SLOT_PAIRS {
        let item1 = gear_set.get(*slot1);
        let item2 = gear_set.get(*slot2);
        if let (Some(i1), Some(i2)) = (item1, item2) {
            if i1.item_id != 0 && i2.item_id != 0 && i1.item_id == i2.item_id {
                return false;
            }
        }
    }
    true
}

/// Validate item limit categories (e.g. max 2 embellished items).
pub fn validate_item_limits(gear_set: &HashMap<String, ResolvedItem>) -> bool {
    let mut category_counts: HashMap<u64, u64> = HashMap::new();
    let mut category_limits: HashMap<u64, u64> = HashMap::new();

    for item in gear_set.values() {
        for (cat_id, max_qty) in game_data::get_item_limit_categories(&item.bonus_ids) {
            *category_counts.entry(cat_id).or_insert(0) += 1;
            category_limits.insert(cat_id, max_qty);
        }
    }

    for (cat_id, count) in &category_counts {
        if let Some(&limit) = category_limits.get(cat_id) {
            if *count > limit {
                return false;
            }
        }
    }
    true
}

pub fn main_hand_is_two_hand(gear_set: &HashMap<String, ResolvedItem>, spec: &str) -> bool {
    if spec == "fury" {
        return false;
    }
    let Some(mh) = gear_set.get("main_hand") else {
        return false;
    };
    if mh.item_id == 0 {
        return false;
    }
    let inv_type = game_data::get_item_info(mh.item_id, Some(&mh.bonus_ids))
        .map(|info| info.inventory_type)
        .unwrap_or(0);
    inv_type == 17
}
