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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::item_db::state;
    use crate::types::GameItem;
    use std::sync::Arc;

    struct ItemDataSnapshot {
        items: Arc<HashMap<u64, GameItem>>,
        item_limit_cats: Arc<HashMap<u64, (u64, u64)>>,
    }

    impl ItemDataSnapshot {
        fn capture() -> Self {
            Self {
                items: state::ITEMS.read().unwrap().clone(),
                item_limit_cats: state::ITEM_LIMIT_CATS.read().unwrap().clone(),
            }
        }

        fn restore(self) {
            *state::ITEMS.write().unwrap() = self.items;
            *state::ITEM_LIMIT_CATS.write().unwrap() = self.item_limit_cats;
        }
    }

    fn item(item_id: u64, origin: ItemOrigin, is_catalyst: bool) -> ResolvedItem {
        ResolvedItem {
            item_id,
            origin,
            is_catalyst,
            ..ResolvedItem::default()
        }
    }

    fn game_item(item_id: u64, inventory_type: i64) -> GameItem {
        GameItem {
            id: item_id,
            name: String::new(),
            icon: String::new(),
            quality: 0,
            base_ilevel: None,
            class: None,
            subclass: None,
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

    #[test]
    fn vault_constraint_allows_single_vault_item_but_rejects_multiple() {
        let mut gear = HashMap::new();
        gear.insert("head".to_string(), item(1001, ItemOrigin::Vault, false));
        gear.insert("chest".to_string(), item(1001, ItemOrigin::Vault, false));
        assert!(validate_vault_constraint(&gear));

        gear.insert("legs".to_string(), item(1002, ItemOrigin::Vault, false));
        assert!(!validate_vault_constraint(&gear));
    }

    #[test]
    fn catalyst_constraint_respects_max_charges() {
        let gear = HashMap::from([
            ("head".to_string(), item(2001, ItemOrigin::Equipped, true)),
            ("chest".to_string(), item(2002, ItemOrigin::Equipped, true)),
            ("legs".to_string(), item(2003, ItemOrigin::Equipped, false)),
        ]);

        assert!(validate_catalyst_constraint(&gear, 2));
        assert!(!validate_catalyst_constraint(&gear, 1));
    }

    #[test]
    fn unique_equipped_constraint_rejects_duplicate_ring_or_trinket_ids() {
        let invalid = HashMap::from([
            (
                "finger1".to_string(),
                item(3001, ItemOrigin::Equipped, false),
            ),
            (
                "finger2".to_string(),
                item(3001, ItemOrigin::Equipped, false),
            ),
        ]);
        assert!(!validate_unique_equipped(&invalid));

        let valid = HashMap::from([
            (
                "finger1".to_string(),
                item(3001, ItemOrigin::Equipped, false),
            ),
            (
                "finger2".to_string(),
                item(3002, ItemOrigin::Equipped, false),
            ),
        ]);
        assert!(validate_unique_equipped(&valid));
    }

    #[test]
    fn weapon_constraint_rejects_two_hander_with_offhand_except_for_fury() {
        let _guard = state::TEST_STATE_LOCK.lock().expect("test state lock");
        let snapshot = ItemDataSnapshot::capture();
        *state::ITEMS.write().unwrap() = Arc::new(HashMap::from([(4001, game_item(4001, 17))]));

        let gear = HashMap::from([
            (
                "main_hand".to_string(),
                item(4001, ItemOrigin::Equipped, false),
            ),
            (
                "off_hand".to_string(),
                item(4002, ItemOrigin::Equipped, false),
            ),
        ]);

        assert!(!validate_weapon_constraint(&gear, "arms"));
        assert!(validate_weapon_constraint(&gear, "fury"));

        snapshot.restore();
    }

    #[test]
    fn item_limit_constraint_rejects_over_limit_bonus_categories() {
        let _guard = state::TEST_STATE_LOCK.lock().expect("test state lock");
        let snapshot = ItemDataSnapshot::capture();
        *state::ITEM_LIMIT_CATS.write().unwrap() = Arc::new(HashMap::from([(7001, (9, 1))]));

        let mut first = item(5001, ItemOrigin::Equipped, false);
        first.bonus_ids = vec![7001];
        let mut second = item(5002, ItemOrigin::Equipped, false);
        second.bonus_ids = vec![7001];

        let over_limit = HashMap::from([
            ("head".to_string(), first.clone()),
            ("chest".to_string(), second),
        ]);
        assert!(!validate_item_limits(&over_limit));

        let within_limit = HashMap::from([("head".to_string(), first)]);
        assert!(validate_item_limits(&within_limit));

        snapshot.restore();
    }
}
