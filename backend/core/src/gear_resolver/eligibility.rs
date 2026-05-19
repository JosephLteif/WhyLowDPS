use crate::item_db;
use crate::types::class_data;
use crate::types::*;

/// Build a stable UID for deduplication:
/// "item_id:sorted_bonus_ids:origin:i<ilevel>:e<enchant>:g<gem>:raw_slot"
pub fn make_uid(item: &RawParsedItem, slot: &str) -> String {
    let mut sorted = item.bonus_ids.clone();
    sorted.sort();
    let bonus_key = sorted
        .iter()
        .map(|b| b.to_string())
        .collect::<Vec<_>>()
        .join(":");
    format!(
        "{}:{}:{}:i{}:e{}:g{}:{}",
        item.item_id,
        bonus_key,
        item.origin.as_str(),
        item.ilevel,
        item.enchant_id,
        item.gem_id,
        slot
    )
}

/// Dedup key used within a slot list.
/// Keep origin so tagged variants (e.g. vault vs bags) remain distinct.
pub fn dedup_key(item: &RawParsedItem) -> String {
    let mut sorted = item.bonus_ids.clone();
    sorted.sort();
    let bonus_key = sorted
        .iter()
        .map(|b| b.to_string())
        .collect::<Vec<_>>()
        .join(":");
    format!(
        "{}:{}:{}:i{}:e{}:g{}",
        item.item_id,
        bonus_key,
        item.origin.as_str(),
        item.ilevel,
        item.enchant_id,
        item.gem_id
    )
}

/// Enrich a raw item with display info from the item DB.
pub fn enrich(item: &RawParsedItem, slot: &str) -> ResolvedItem {
    let info = item_db::get_item_info(item.item_id, Some(&item.bonus_ids));
    let resolved = item_db::resolve_bonuses(&item.bonus_ids, &item_db::bonuses());

    let season_id = resolved.season_id.unwrap_or(0);

    let (name, icon, quality, tag, upgrade, sockets, db_ilevel) = if let Some(ref info) = info {
        (
            info.name.clone(),
            info.icon.clone(),
            info.quality,
            info.tag.clone(),
            info.upgrade.clone(),
            info.sockets,
            info.ilevel,
        )
    } else {
        let name = if item.name.is_empty() {
            format!("Item {}", item.item_id)
        } else {
            item.name.clone()
        };
        (
            name,
            "inv_misc_questionmark".to_string(),
            resolved.quality.unwrap_or(1),
            resolved.tag.unwrap_or_default(),
            resolved.upgrade.unwrap_or_default(),
            resolved.sockets.unwrap_or(0),
            resolved.ilevel.unwrap_or(0),
        )
    };

    // Preserve explicit SimC ilevel overrides (e.g. seasonal modifiers like Ascendant Voidcore).
    // For normal upgraded items, DB ilevel and parsed ilevel usually match; when they differ,
    // prefer the higher explicit ilevel if present.
    let ilevel = if item.ilevel > 0 && db_ilevel > 0 {
        std::cmp::max(item.ilevel, db_ilevel)
    } else if item.ilevel > 0 {
        item.ilevel
    } else {
        db_ilevel
    };

    let enchant_name = if item.enchant_id > 0 {
        item_db::enchants()
            .get(&item.enchant_id)
            .and_then(|e| e.item_name.as_ref().or(e.display_name.as_ref()).cloned())
            .unwrap_or_default()
    } else {
        String::new()
    };

    let (gem_name, gem_icon) = if item.gem_id > 0 {
        item_db::items()
            .get(&item.gem_id)
            .map(|g| (g.name.clone(), g.icon.clone()))
            .unwrap_or_default()
    } else {
        (String::new(), String::new())
    };

    let inventory_type = info
        .as_ref()
        .map(|i| i.inventory_type)
        .unwrap_or_else(|| item_db::get_inventory_type(item.item_id).unwrap_or(0));

    ResolvedItem {
        uid: make_uid(item, slot),
        slot: slot.to_string(),
        item_id: item.item_id,
        ilevel,
        simc_string: item.simc_string.clone(),
        origin: item.origin,
        bonus_ids: item.bonus_ids.clone(),
        enchant_id: item.enchant_id,
        gem_id: item.gem_id,
        name,
        icon,
        quality,
        quality_color: class_data::quality_color(quality as u64).to_string(),
        tag,
        upgrade,
        sockets,
        enchant_name,
        gem_name,
        gem_icon,
        encounter: String::new(),
        instance_name: String::new(),
        source_type: String::new(),
        encounter_id: 0,
        instance_id: 0,
        season_id,
        inventory_type,
        is_catalyst: false,
        can_catalyst: false,
        item_limit_categories: item_db::get_item_limit_categories(&item.bonus_ids),
        ..Default::default()
    }
}

/// Determine eligible slots for an item using the item DB's inventory_type.
pub fn eligible_slots(item: &RawParsedItem, spec: &str) -> Vec<String> {
    if let Some(inv_type) = item_db::get_inventory_type(item.item_id) {
        if inv_type > 0 {
            return class_data::inv_type_to_slots(inv_type as u64, spec)
                .into_iter()
                .map(|s| s.to_string())
                .collect();
        }
    }
    let mut slots = vec![item.raw_slot.clone()];
    if let Some(paired) = class_data::paired_slot(&item.raw_slot) {
        slots.push(paired.to_string());
    }
    slots
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::item_db::state;
    use crate::types::{GameItem, ItemOrigin};
    use std::collections::HashMap;
    use std::sync::Arc;

    fn raw_item(item_id: u64, raw_slot: &str) -> RawParsedItem {
        RawParsedItem {
            raw_slot: raw_slot.to_string(),
            simc_string: format!("{raw_slot}=id={item_id}"),
            item_id,
            ilevel: 0,
            name: String::new(),
            bonus_ids: vec![200, 100],
            enchant_id: 15,
            gem_id: 23,
            origin: ItemOrigin::Bags,
        }
    }

    fn with_items_state<T>(items: HashMap<u64, GameItem>, f: impl FnOnce() -> T) -> T {
        let _guard = state::TEST_STATE_LOCK.lock().unwrap();
        let prev_items = state::ITEMS.read().unwrap().clone();
        *state::ITEMS.write().unwrap() = Arc::new(items);
        let result = f();
        *state::ITEMS.write().unwrap() = prev_items;
        result
    }

    #[test]
    fn make_uid_sorts_bonus_ids_and_keeps_slot() {
        let item = raw_item(12345, "finger1");
        let uid = make_uid(&item, "finger2");
        assert_eq!(uid, "12345:100:200:bags:i0:e15:g23:finger2");
    }

    #[test]
    fn dedup_key_is_slot_independent_but_origin_sensitive() {
        let bag_item = raw_item(12345, "finger1");
        let mut equipped_item = raw_item(12345, "finger1");
        equipped_item.origin = ItemOrigin::Equipped;

        let bag_key = dedup_key(&bag_item);
        let equipped_key = dedup_key(&equipped_item);
        assert_eq!(bag_key, "12345:100:200:bags:i0:e15:g23");
        assert_eq!(equipped_key, "12345:100:200:equipped:i0:e15:g23");
        assert_ne!(bag_key, equipped_key);
    }

    #[test]
    fn enrich_uses_item_db_info_and_preserves_higher_explicit_ilevel() {
        let mut item = raw_item(9001, "head");
        item.ilevel = 626;
        item.bonus_ids = Vec::new();
        item.enchant_id = 0;
        item.gem_id = 0;

        let db_item = GameItem {
            id: 9001,
            name: "Tier Helm".to_string(),
            icon: "inv_helm_plate_raidwarrior_p_01".to_string(),
            quality: 4,
            base_ilevel: Some(619),
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
        };

        with_items_state(HashMap::from([(9001, db_item)]), || {
            let enriched = enrich(&item, "head");
            assert_eq!(enriched.item_id, 9001);
            assert_eq!(enriched.name, "Tier Helm");
            assert_eq!(enriched.icon, "inv_helm_plate_raidwarrior_p_01");
            assert_eq!(enriched.inventory_type, 1);
            assert_eq!(enriched.ilevel, 626);
            assert_eq!(enriched.uid, "9001::bags:i626:e0:g0:head");
        });
    }

    #[test]
    fn eligible_slots_falls_back_to_raw_slot_and_pairing_when_db_missing() {
        let item = raw_item(999_999_999, "finger1");
        let slots = eligible_slots(&item, "arcane");
        assert_eq!(slots, vec!["finger1".to_string(), "finger2".to_string()]);
    }
}
