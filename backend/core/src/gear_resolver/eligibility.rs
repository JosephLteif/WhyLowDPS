use crate::item_db;
use crate::types::class_data;
use crate::types::*;

/// Build a stable UID for deduplication: "item_id:sorted_bonus_ids:origin:raw_slot"
pub fn make_uid(item: &RawParsedItem, slot: &str) -> String {
    let mut sorted = item.bonus_ids.clone();
    sorted.sort();
    let bonus_key = sorted
        .iter()
        .map(|b| b.to_string())
        .collect::<Vec<_>>()
        .join(":");
    format!(
        "{}:{}:{}:e{}:g{}:{}",
        item.item_id,
        bonus_key,
        item.origin.as_str(),
        item.enchant_id,
        item.gem_id,
        slot
    )
}

/// Dedup key: item_id + sorted bonus_ids (ignores origin/slot).
pub fn dedup_key(item: &RawParsedItem) -> String {
    let mut sorted = item.bonus_ids.clone();
    sorted.sort();
    let bonus_key = sorted
        .iter()
        .map(|b| b.to_string())
        .collect::<Vec<_>>()
        .join(":");
    format!(
        "{}:{}:e{}:g{}",
        item.item_id, bonus_key, item.enchant_id, item.gem_id
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

    let ilevel = if !upgrade.is_empty() && db_ilevel > 0 {
        db_ilevel
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
        season_id,
        inventory_type,
        is_catalyst: false,
        can_catalyst: false,
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
