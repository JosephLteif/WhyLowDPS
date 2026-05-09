//! Pure data loading and lookup for items, enchants, gems, bonuses, and upgrades.
//!
//! No filtering, no class logic. Just load JSON files and provide accessors.

use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;

pub mod bonuses;
pub mod crafting;
pub mod enchants;
pub mod loader;
pub mod state;
pub mod missives;
pub mod upgrades;

pub use state::CatalystTierItem;

// Re-exports for convenience

pub use enchants::*;
pub use crafting::*;
pub use missives::*;
pub use upgrades::*;

// ---- Load ----

pub fn load(data_dir: &Path) {
    loader::load_classes(data_dir);
    loader::load_items(data_dir);
    loader::derive_class_profiles_from_items();

    loader::load_enchants(data_dir);
    crafting::load_crafting(data_dir);
    loader::load_bonuses(data_dir);
    loader::load_bus_and_seasons(data_dir);
    loader::load_instances(data_dir);
    loader::hydrate_runtime_metadata(&data_dir.join("blizzard-runtime-data.json"));
    loader::load_encounter_drops();
    loader::load_season_config(data_dir);
    loader::load_item_limit_categories(data_dir);
    loader::load_talents(data_dir);
    loader::load_squish_data(data_dir);
    loader::load_catalyst_conversions(data_dir);
    loader::load_consumables(data_dir);
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

pub fn get_runtime_data() -> Value {
    loader::get_runtime_metadata()
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct InstanceInfo {
    pub id: i64,
    pub name: String,
    pub zone: Option<String>,
    pub instance_type: String,
    pub boss_count: Option<i32>,
    pub expansion: i32,
    pub active_rotation: Option<bool>,
}

pub fn list_instances() -> Vec<InstanceInfo> {
    let inst = state::INSTANCES.read().unwrap();
    inst.iter()
        .filter_map(|v| {
            let id = v.get("id")?.as_i64()?;
            let name = v.get("name")?.as_str()?.to_string();
            let zone = v
                .get("zone")
                .and_then(|z| z.as_str())
                .map(|s| s.to_string());
            let instance_type = v
                .get("type")
                .and_then(|t| t.as_str())
                .map(|s| s.to_string())
                .unwrap_or_else(|| "dungeon".to_string());
            let boss_count = v
                .get("bossCount")
                .and_then(|b| b.as_i64())
                .map(|n| n as i32);
            let expansion = v.get("expansion").and_then(|e| e.as_i64()).unwrap_or(0) as i32;
            let active_rotation = v.get("active_rotation").and_then(|a| a.as_bool());

            Some(InstanceInfo {
                id,
                name,
                zone,
                instance_type,
                boss_count,
                expansion,
                active_rotation,
            })
        })
        .collect()
}

pub fn get_mplus_dungeons() -> Vec<InstanceInfo> {
    list_instances()
        .into_iter()
        .filter(|i| {
            i.instance_type == "mythic_plus"
                || (i.instance_type == "dungeon" && i.active_rotation == Some(true))
        })
        .collect()
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

pub fn is_upgrade_bonus(bonus_id: u64) -> bool {
    state::BONUSES
        .read()
        .unwrap()
        .get(&bonus_id)
        .and_then(|b| b.upgrade.as_ref())
        .is_some()
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

pub fn flask_options_raw() -> Arc<Vec<Value>> {
    state::FLASK_OPTIONS_RAW.read().unwrap().clone()
}

pub fn food_options_raw() -> Arc<Vec<Value>> {
    state::FOOD_OPTIONS_RAW.read().unwrap().clone()
}

pub fn potion_options_raw() -> Arc<Vec<Value>> {
    state::POTION_OPTIONS_RAW.read().unwrap().clone()
}

pub fn augment_options_raw() -> Arc<Vec<Value>> {
    state::AUGMENT_OPTIONS_RAW.read().unwrap().clone()
}

pub fn temp_enchant_options_raw() -> Arc<Vec<Value>> {
    state::TEMP_ENCHANT_OPTIONS_RAW.read().unwrap().clone()
}

// Re-exports from bonuses
pub use bonuses::{is_minimum_track, resolve_bonuses, track_rank, upgrade_track_max};
pub use upgrades::describe_upgrade_from_bonus_ids;

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
    let build = |id: u64, enchant: &EnchantData| {
        let name = enchant
            .item_name
            .as_ref()
            .or(enchant.display_name.as_ref())
            .cloned()
            .unwrap_or_default();
        let icon = enchant
            .item_icon
            .clone()
            .or(enchant.spell_icon.clone())
            .unwrap_or_else(|| "inv_misc_questionmark".to_string());

        serde_json::json!({
            "enchant_id": id,
            "name": name,
            "icon": icon,
            "item_id": enchant.item_id.unwrap_or(0),
            "quality": enchant.quality.unwrap_or(3),
        })
    };

    if let Some(enchant) = enchants().get(&enchant_id).cloned() {
        return Some(build(enchant_id, &enchant));
    }
    if let Some(enchant) = enchants_by_item_id().get(&enchant_id).cloned() {
        return Some(build(enchant_id, &enchant));
    }
    None
}

pub fn list_enchants_for_slot(inv_type: u64) -> Vec<Value> {
    let mask = 1u64 << inv_type;
    let enchants_map = enchants();
    let mut matching: Vec<_> = enchants_map
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
        .cloned()
        .collect();

    let latest_expansion = matching.iter().filter_map(|e| e.expansion).max().unwrap_or(0);
    if latest_expansion > 0 {
        matching.retain(|e| e.expansion.unwrap_or(0) == latest_expansion);
    }

    matching
        .into_iter()
        .map(|e| {
            let name = e
                .item_name
                .as_ref()
                .or(e.display_name.as_ref())
                .cloned()
                .unwrap_or_default();
            serde_json::json!({
                "id": e.id,
                "enchant_id": e.id,
                "name": name,
                "displayName": e.display_name,
                "baseDisplayName": e.base_display_name,
                "categoryName": e.category_name,
                "itemId": e.item_id,
                "itemName": e.item_name,
                "itemIcon": e.item_icon,
                "spellIcon": e.spell_icon,
                "quality": e.quality.unwrap_or(3),
                "expansion": e.expansion,
                "craftingQuality": e.crafting_quality,
                "slot": e.slot,
            })
        })
        .collect()
}
