//! Pure data loading and lookup for items, enchants, gems, bonuses, and upgrades.
//!
//! No filtering, no class logic. Just load JSON files and provide accessors.

use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;

pub mod state;
pub mod loader;
pub mod bonuses;
pub mod upgrades;
pub mod enchants;

pub use state::CatalystTierItem;
use state::*;

// Re-exports for convenience

pub use upgrades::*;
pub use enchants::*;


// ---- Load ----

pub fn load(data_dir: &Path) {
    loader::load_items(data_dir);
    loader::load_enchants(data_dir);
    loader::load_bonuses(data_dir);
    loader::load_bus_and_seasons(data_dir);
    loader::load_instances(data_dir);
    loader::load_encounter_drops();
    loader::load_season_config(data_dir);
    loader::load_item_limit_categories(data_dir);
    loader::load_talents(data_dir);
    loader::load_squish_data(data_dir);
    loader::load_catalyst_conversions(data_dir);
}

// ---- Accessors ----

use crate::types::{class_data, ItemInfo, GameItem, EnchantData, BonusData};

// ---- Accessors ----

pub fn items() -> &'static HashMap<u64, GameItem> {
    state::ITEMS.get().expect("Game data not loaded")
}

pub fn enchants() -> &'static HashMap<u64, EnchantData> {
    state::ENCHANTS.get().expect("Game data not loaded")
}

pub fn enchants_by_item_id() -> &'static HashMap<u64, EnchantData> {
    state::ENCHANTS_BY_ITEM_ID.get().expect("Game data not loaded")
}

pub fn bonuses() -> &'static HashMap<u64, BonusData> {
    state::BONUSES.get().expect("Game data not loaded")
}

pub fn instances() -> &'static Vec<Value> {
    state::INSTANCES.get().expect("Game data not loaded")
}

pub fn drops_by_encounter() -> &'static HashMap<i64, Vec<GameItem>> {
    state::DROPS_BY_ENCOUNTER.get().expect("Game data not loaded")
}


pub fn talent_tree(spec_id: u64) -> Option<&'static Value> {
    state::TALENT_TREES.get()?.get(&spec_id)
}

pub fn talent_trees_for_class(spec_id: u64) -> Vec<&'static Value> {
    let trees: &HashMap<u64, Value> = match state::TALENT_TREES.get() {
        Some(t) => t,
        None => return Vec::new(),
    };
    let class_id = match trees.get(&spec_id) {
        Some(t) => t.get("classId").and_then(|v| v.as_u64()),
        None => return Vec::new(),
    };
    let class_id = match class_id {
        Some(id) => id,
        None => return Vec::new(),
    };
    trees
        .values()
        .filter(|t| t.get("classId").and_then(|v| v.as_u64()) == Some(class_id))
        .collect()
}

pub fn catalyst_tier_item(class_id: u64, inv_type: u64) -> Option<&'static CatalystTierItem> {
    let cat = state::CATALYST.get()?;
    let inv = if inv_type == 20 { 5 } else { inv_type };
    cat.tier_items.get(&(class_id, inv))
}

pub fn is_catalyst_tier_item(item_id: u64) -> bool {
    state::CATALYST.get().map(|c| c.tier_item_ids.contains(&item_id)).unwrap_or(false)
}

pub fn filter_ilevel_bonus_ids(bonus_ids: &[u64]) -> Vec<u64> {
    let bonuses: &HashMap<u64, BonusData> = match state::BONUSES.get() { Some(b) => b, None => return vec![] };
    bonus_ids.iter().filter(|&&bid| bonuses.get(&bid).and_then(|b| b.ilevel.as_ref()).and_then(|il| il.amount).is_some()).copied().collect()
}

pub fn current_season_id() -> u64 {
    state::CURRENT_SEASON_ID.get().copied().unwrap_or(0)
}

pub fn catalyst_currency_id() -> u64 {
    state::CATALYST.get().map(|c| c.catalyst_currency_id).unwrap_or(3378)
}

pub fn tier_set_bonus_id() -> u64 {
    state::SEASON_CONFIG.get()
        .and_then(|c| c.get("tierSetBonusId"))
        .and_then(|v| v.as_u64())
        .unwrap_or(20)
}

pub fn upgrade_tracks() -> Option<&'static HashMap<state::UpgradeTrackKey, state::UpgradeTrackValue>> {

    state::UPGRADE_TRACKS.get()
}

pub fn season_cfg() -> &'static Value {
    state::SEASON_CONFIG.get().unwrap_or(&state::EMPTY_SEASON_CONFIG)
}

// Re-exports from bonuses
pub use bonuses::{resolve_bonuses, track_rank, is_minimum_track, upgrade_track_max};


// ---- Item Lookups ----

pub fn get_item_limit_categories(bonus_ids: &[u64]) -> HashMap<u64, u64> {
    let cats: &HashMap<u64, (u64, u64)> = match state::ITEM_LIMIT_CATS.get() { Some(c) => c, None => return HashMap::new() };
    let mut result: HashMap<u64, u64> = HashMap::new();
    for bid in bonus_ids {
        if let Some(&(cat_id, qty)) = cats.get(bid) { result.insert(cat_id, qty); }
    }
    result
}

pub fn get_inventory_type(item_id: u64) -> Option<u64> {
    get_raw_item(item_id).and_then(|i| i.inventory_type)
}


pub(crate) fn get_raw_item(item_id: u64) -> Option<&'static GameItem> {
    items().get(&item_id)
}


pub fn get_item_armor_subclass(item_id: u64) -> Option<u64> {
    get_raw_item(item_id).map(|i| {
        if i.class.unwrap_or(0) == 4 {
            i.subclass.unwrap_or(0)
        } else {
            0
        }
    })
}


pub fn get_item_info(item_id: u64, bonus_ids: Option<&[u64]>) -> Option<ItemInfo> {
    let item = get_raw_item(item_id)?;
    let mut quality = item.quality;
    let mut ilevel = item.base_ilevel.unwrap_or(0);

    let mut tag = String::new();
    let mut sockets: u64 = 0;
    let mut upgrade = String::new();

    let mut bonus_set_ilevel = false;
    if let Some(bids) = bonus_ids {
        let resolved = bonuses::resolve_bonuses(bids, bonuses());
        if let Some(q) = resolved.quality { quality = q; }
        if let Some(i) = resolved.ilevel { ilevel = i; bonus_set_ilevel = true; }
        if let Some(t) = resolved.tag { tag = t; }
        if let Some(s) = resolved.sockets { sockets = s; }
        if let Some(u) = resolved.upgrade { upgrade = u; }
    }

    if !bonus_set_ilevel {
        ilevel = bonuses::squish_ilevel(item_id, ilevel);
    }

    let armor_subclass = if item.class.unwrap_or(0) == 4 {
        item.subclass.unwrap_or(0)
    } else {
        0
    };

    Some(ItemInfo {
        item_id,
        name: item.name.clone(),
        icon: item.icon.clone(),
        ilevel,
        quality,
        quality_name: class_data::quality_name(quality).to_string(),
        tag,
        upgrade,
        sockets,
        armor_subclass,
        inventory_type: item.inventory_type.unwrap_or(0),
        item_class: item.class.unwrap_or(0),
        item_subclass: item.subclass.unwrap_or(0),
    })
}


pub fn get_enchant_info(enchant_id: u64) -> Option<Value> {
    let enchant = enchants().get(&enchant_id)?;
    let name = enchant.item_name.as_ref().or(enchant.display_name.as_ref()).cloned().unwrap_or_default();
    Some(serde_json::json!({ "enchant_id": enchant_id, "name": name }))
}

pub fn list_enchants_for_slot(inv_type: u64) -> Vec<Value> {
    let mask = 1u64 << inv_type;
    let enchants_map: &HashMap<u64, EnchantData> = match state::ENCHANTS.get() { Some(m) => m, None => return vec![] };
    
    enchants_map.values().filter(|e| {

        if let Some(reqs) = &e.requirements {
            let type_mask = reqs.inv_type_mask.unwrap_or(0);
            if type_mask == 0 {
                let item_class = reqs.item_class.unwrap_or(0);
                if inv_type == 13 || inv_type == 17 || inv_type == 21 || inv_type == 22 { return item_class == 2; }
                return false;
            }
            (type_mask & mask) != 0
        } else {
            false
        }
    }).map(|e| {
        let name = e.item_name.as_ref().or(e.display_name.as_ref()).cloned().unwrap_or_default();
        serde_json::json!({ "enchant_id": e.id, "name": name })
    }).collect()
}

