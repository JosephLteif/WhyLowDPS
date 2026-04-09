use super::state::*;
use regex::Regex;
use serde_json::{json, Value};
use std::collections::HashMap;

pub fn list_gems() -> Vec<Value> {
    let items_map = ITEMS.read().unwrap();
    items_map
        .values()
        .filter(|v| {
            // Gem criteria: itemClass=3, quality >= 3
            v.class.unwrap_or(0) == 3 && v.quality >= 3
        })
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
    let item = ITEMS.read().unwrap().get(&gem_id)?.clone();
    Some(json!({
        "gem_id": gem_id,
        "name": item.name,
        "icon": item.icon,
        "quality": item.quality,
    }))
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
