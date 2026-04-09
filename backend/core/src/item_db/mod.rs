//! Pure data loading and lookup for items, enchants, gems, bonuses, and upgrades.
//!
//! No filtering, no class logic. Just load JSON files and provide accessors.

use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;

pub mod bonuses;
pub mod enchants;
pub mod loader;
pub mod state;
pub mod upgrades;

pub use state::CatalystTierItem;

// Re-exports for convenience

pub use enchants::*;
pub use upgrades::*;

// ---- Load ----

pub fn load(data_dir: &Path) {
    loader::load_classes(data_dir);
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

use crate::types::{class_data, BonusData, EnchantData, GameItem, ItemInfo};
use std::sync::Arc;

pub fn items() -> Arc<HashMap<u64, GameItem>> {
    state::ITEMS.read().unwrap().clone()
}

pub fn enchants() -> Arc<HashMap<u64, EnchantData>> {
    state::ENCHANTS.read().unwrap().clone()
}

pub fn enchants_by_item_id() -> Arc<HashMap<u64, EnchantData>> {
    state::ENCHANTS_BY_ITEM_ID.read().unwrap().clone()
}

pub fn bonuses() -> Arc<HashMap<u64, BonusData>> {
    state::BONUSES.read().unwrap().clone()
}

pub fn instances() -> Vec<Value> {
    state::INSTANCES.read().unwrap().clone()
}

pub fn drops_by_encounter() -> Arc<HashMap<i64, Vec<GameItem>>> {
    state::DROPS_BY_ENCOUNTER.read().unwrap().clone()
}

pub fn talent_tree(spec_id: u64) -> Option<Value> {
    state::TALENT_TREES.read().unwrap().get(&spec_id).cloned()
}

pub fn talent_trees_for_class(spec_id: u64) -> Vec<Value> {
    let trees = state::TALENT_TREES.read().unwrap();
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
        .cloned()
        .collect()
}

pub fn catalyst_tier_item(class_id: u64, inv_type: u64) -> Option<CatalystTierItem> {
    let cat = state::CATALYST.read().unwrap();
    let inv = if inv_type == 20 { 5 } else { inv_type };
    cat.tier_items.get(&(class_id, inv)).cloned()
}

pub fn is_catalyst_tier_item(item_id: u64) -> bool {
    state::CATALYST
        .read()
        .unwrap()
        .tier_item_ids
        .contains(&item_id)
}

pub fn filter_ilevel_bonus_ids(bonus_ids: &[u64]) -> Vec<u64> {
    let bonuses = bonuses();
    bonus_ids
        .iter()
        .filter(|&&bid| {
            bonuses
                .get(&bid)
                .and_then(|b| b.ilevel.as_ref())
                .and_then(|il| il.amount)
                .is_some()
        })
        .copied()
        .collect()
}

pub fn current_season_id() -> u64 {
    *state::CURRENT_SEASON_ID.read().unwrap()
}

pub fn catalyst_currency_id() -> u64 {
    state::CATALYST.read().unwrap().catalyst_currency_id
}

pub fn tier_set_bonus_id() -> u64 {
    season_cfg()
        .get("tierSetBonusId")
        .and_then(|v| v.as_u64())
        .unwrap_or(20)
}

pub fn upgrade_tracks() -> Arc<HashMap<state::UpgradeTrackKey, state::UpgradeTrackValue>> {
    state::UPGRADE_TRACKS.read().unwrap().clone()
}

pub fn season_cfg() -> Value {
    state::SEASON_CONFIG.read().unwrap().clone()
}

// Re-exports from bonuses
pub use bonuses::{is_minimum_track, resolve_bonuses, track_rank, upgrade_track_max};

pub use loader::hydrate_runtime_metadata;

// ---- Item Lookups ----

pub fn get_item_limit_categories(bonus_ids: &[u64]) -> HashMap<u64, u64> {
    let cats = state::ITEM_LIMIT_CATS.read().unwrap();
    let mut result: HashMap<u64, u64> = HashMap::new();
    for bid in bonus_ids {
        if let Some(&(cat_id, qty)) = cats.get(bid) {
            result.insert(cat_id, qty);
        }
    }
    result
}

pub fn get_inventory_type(item_id: u64) -> Option<i64> {
    get_raw_item(item_id).and_then(|i| i.inventory_type)
}

pub(crate) fn get_raw_item(item_id: u64) -> Option<GameItem> {
    items().get(&item_id).cloned()
}

pub fn get_item_armor_subclass(item_id: u64) -> Option<u64> {
    get_raw_item(item_id).map(|i| {
        if i.class.unwrap_or(0) == 4 {
            i.subclass.unwrap_or(0) as u64
        } else {
            0
        }
    })
}

pub fn get_item_info(item_id: u64, bonus_ids: Option<&[u64]>) -> Option<ItemInfo> {
    let item = get_raw_item(item_id)?;
    let mut quality = item.quality as i64;
    let mut ilevel = item.base_ilevel.unwrap_or(0);

    let mut tag = String::new();
    let mut sockets: i64 = 0;
    let mut upgrade = String::new();

    let mut bonus_set_ilevel = false;
    if let Some(bids) = bonus_ids {
        let resolved = bonuses::resolve_bonuses(bids, &bonuses());
        if let Some(q) = resolved.quality {
            quality = q;
        }
        if let Some(i) = resolved.ilevel {
            ilevel = i;
            bonus_set_ilevel = true;
        }

        if let Some(t) = resolved.tag {
            tag = t;
        }
        if let Some(s) = resolved.sockets {
            sockets = s;
        }
        if let Some(u) = resolved.upgrade {
            upgrade = u;
        }
    }

    if !bonus_set_ilevel {
        ilevel = bonuses::squish_ilevel(item_id, ilevel as u64) as i64;
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
        quality_name: class_data::quality_name(quality as u64),
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
    let enchants = enchants();
    let enchant = enchants.get(&enchant_id)?;
    let name = enchant
        .item_name
        .as_ref()
        .or(enchant.display_name.as_ref())
        .cloned()
        .unwrap_or_default();
    Some(serde_json::json!({ "enchant_id": enchant_id, "name": name }))
}

pub fn list_enchants_for_slot(inv_type: u64) -> Vec<Value> {
    let mask = 1u64 << inv_type;
    let enchants_map = enchants();

    enchants_map
        .values()
        .filter(|e| {
            if let Some(reqs) = &e.requirements {
                let type_mask = reqs.inv_type_mask.unwrap_or(0);
                if type_mask == 0 {
                    let item_class = reqs.item_class.unwrap_or(0);
                    if inv_type == 13 || inv_type == 17 || inv_type == 21 || inv_type == 22 {
                        return item_class == 2;
                    }
                    return false;
                }
                (type_mask & mask) != 0
            } else {
                false
            }
        })
        .map(|e| {
            let name = e
                .item_name
                .as_ref()
                .or(e.display_name.as_ref())
                .cloned()
                .unwrap_or_default();
            serde_json::json!({ "enchant_id": e.id, "name": name })
        })
        .collect()
}
