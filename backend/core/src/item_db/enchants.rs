use super::state::*;
use regex::Regex;
use serde_json::{json, Value};
use std::collections::HashMap;

pub fn list_gems() -> Vec<Value> {
    // Prefer enchantments dataset for gems (slot=socket), because the equippable
    // item index can omit gem items.
    let enchants_map = ENCHANTS.read().unwrap();
    let mut by_item_id: HashMap<u64, Value> = HashMap::new();

    for e in enchants_map.values() {
        if e.slot.as_deref() != Some("socket") {
            continue;
        }
        let item_id = e.item_id.unwrap_or(e.id);
        if item_id == 0 {
            continue;
        }
        let quality = e.quality.unwrap_or(3);
        let candidate = json!({
            "id": e.id,
            "item_id": item_id,
            "name": e.item_name.clone().or(e.display_name.clone()).unwrap_or_default(),
            "icon": e.item_icon.clone().or(e.spell_icon.clone()).unwrap_or_else(|| "inv_misc_questionmark".to_string()),
            "quality": quality,
            "craftingQuality": e.crafting_quality,
        });

        match by_item_id.get(&item_id) {
            Some(existing) => {
                let existing_quality = existing
                    .get("quality")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                if quality > existing_quality {
                    by_item_id.insert(item_id, candidate);
                }
            }
            None => {
                by_item_id.insert(item_id, candidate);
            }
        }
    }

    if !by_item_id.is_empty() {
        let mut values: Vec<Value> = by_item_id.into_values().collect();
        values.sort_by(|a, b| {
            let an = a.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let bn = b.get("name").and_then(|v| v.as_str()).unwrap_or("");
            an.cmp(bn)
        });
        return values;
    }

    // Fallback: old behavior from the item dataset.
    let items_map = ITEMS.read().unwrap();
    items_map
        .values()
        .filter(|v| v.class.unwrap_or(0) == 3 && v.quality >= 3)
        .map(|v| {
            json!({
                "item_id": v.id,
                "name": v.name,
                "icon": v.icon,
                "quality": v.quality,
            })
        })
        .collect()
}

pub fn get_gem_info(gem_id: u64) -> Option<Value> {
    if let Some(item) = ITEMS.read().unwrap().get(&gem_id).cloned() {
        return Some(json!({
            "gem_id": gem_id,
            "name": item.name,
            "icon": item.icon,
            "quality": item.quality,
        }));
    }

    // Fallback: find the gem in enchantments dataset by item_id (preferred) or id.
    if let Some(e) = ENCHANTS_BY_ITEM_ID.read().unwrap().get(&gem_id).cloned() {
        return Some(json!({
            "gem_id": gem_id,
            "name": e.item_name.or(e.display_name).unwrap_or_default(),
            "icon": e.item_icon.or(e.spell_icon).unwrap_or_else(|| "inv_misc_questionmark".to_string()),
            "quality": e.quality.unwrap_or(3),
        }));
    }
    if let Some(e) = ENCHANTS.read().unwrap().get(&gem_id).cloned() {
        return Some(json!({
            "gem_id": gem_id,
            "name": e.item_name.or(e.display_name).unwrap_or_default(),
            "icon": e.item_icon.or(e.spell_icon).unwrap_or_else(|| "inv_misc_questionmark".to_string()),
            "quality": e.quality.unwrap_or(3),
        }));
    }

    None
}

pub fn apply_copy_enchants(source_simc: &str, target_simc: &str) -> String {
    let re_enchant = Regex::new(r",enchant_id=(\d+)").unwrap();
    let re_gem = Regex::new(r",gem_id=(\d+)").unwrap();

    let enchant = re_enchant
        .captures(source_simc)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str());
    let gem = re_gem
        .captures(source_simc)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str());

    let mut result = target_simc.to_string();

    // Remove existing
    result = re_enchant.replace_all(&result, "").to_string();
    result = re_gem.replace_all(&result, "").to_string();

    // Add new
    if let Some(e) = enchant {
        result.push_str(&format!(",enchant_id={}", e));
    }
    if let Some(g) = gem {
        result.push_str(&format!(",gem_id={}", g));
    }

    result
}

use crate::types::ResolvedItem;

pub fn apply_copy_enchants_to_map(
    mut items_by_slot: HashMap<String, Vec<ResolvedItem>>,
) -> HashMap<String, Vec<ResolvedItem>> {
    // Find equipped items to use as sources
    let mut sources: HashMap<String, (u64, u64, String, String)> = HashMap::new();
    for list in items_by_slot.values() {
        if let Some(eq) = list
            .iter()
            .find(|i: &&ResolvedItem| i.origin == crate::types::ItemOrigin::Equipped)
        {
            sources.insert(
                eq.slot.clone(),
                (
                    eq.enchant_id,
                    eq.gem_id,
                    eq.enchant_name.clone(),
                    eq.gem_name.clone(),
                ),
            );
        }
    }

    for (slot, list) in items_by_slot.iter_mut() {
        if let Some(&(eid, gid, ref ename, ref gname)) = sources.get(slot) {
            let ename_str: &str = ename;
            let gname_str: &str = gname;
            for item in list {
                if item.origin != crate::types::ItemOrigin::Equipped {
                    item.enchant_id = eid;
                    item.gem_id = gid;
                    item.enchant_name = ename_str.to_string();
                    item.gem_name = gname_str.to_string();

                    // Update simc_string
                    item.simc_string = apply_copy_enchants(
                        &format!(",enchant_id={},gem_id={}", eid, gid),
                        &item.simc_string,
                    );
                }
            }
        }
    }
    items_by_slot
}
