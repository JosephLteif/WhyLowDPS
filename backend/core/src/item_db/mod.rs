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
pub mod missives;
pub mod state;
pub mod upgrades;

pub use state::CatalystTierItem;

// Re-exports for convenience

pub use crafting::*;
pub use enchants::*;
pub use missives::*;
pub use upgrades::*;

// ---- Load ----

pub fn load(data_dir: &Path) {
    let _load_guard = state::LOAD_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
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
pub use bonuses::{
    is_minimum_track, resolve_bonuses, resolve_extra_effects, track_rank, upgrade_track_max,
};
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
    let mut extra_effects: Vec<String> = Vec::new();
    let mut bonus_debug = None;
    if let Some(bids) = bonus_ids {
        let resolved = bonuses::resolve_bonuses(bids, &bonuses());
        extra_effects = bonuses::resolve_extra_effects(bids, &bonuses());
        bonus_debug = Some(bonuses::resolve_bonus_debug(bids, &bonuses()));
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
        extra_effects,
        bonus_debug,
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

    let latest_expansion = matching
        .iter()
        .filter_map(|e| e.expansion)
        .max()
        .unwrap_or(0);
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use std::collections::HashMap;
    use std::sync::Arc;

    struct StateSnapshot {
        items: Arc<HashMap<u64, GameItem>>,
        enchants: Arc<HashMap<u64, EnchantData>>,
        enchants_by_item_id: Arc<HashMap<u64, EnchantData>>,
        bonuses: Arc<HashMap<u64, BonusData>>,
        item_limit_cats: Arc<HashMap<u64, (u64, u64)>>,
        instances: Vec<Value>,
    }

    impl StateSnapshot {
        fn capture() -> Self {
            Self {
                items: state::ITEMS.read().unwrap().clone(),
                enchants: state::ENCHANTS.read().unwrap().clone(),
                enchants_by_item_id: state::ENCHANTS_BY_ITEM_ID.read().unwrap().clone(),
                bonuses: state::BONUSES.read().unwrap().clone(),
                item_limit_cats: state::ITEM_LIMIT_CATS.read().unwrap().clone(),
                instances: state::INSTANCES.read().unwrap().clone(),
            }
        }

        fn restore(self) {
            *state::ITEMS.write().unwrap() = self.items;
            *state::ENCHANTS.write().unwrap() = self.enchants;
            *state::ENCHANTS_BY_ITEM_ID.write().unwrap() = self.enchants_by_item_id;
            *state::BONUSES.write().unwrap() = self.bonuses;
            *state::ITEM_LIMIT_CATS.write().unwrap() = self.item_limit_cats;
            *state::INSTANCES.write().unwrap() = self.instances;
        }
    }

    fn game_item_with_inventory(id: u64, inventory_type: i64) -> GameItem {
        GameItem {
            id,
            name: "Item".to_string(),
            icon: "inv_misc_questionmark".to_string(),
            quality: 4,
            base_ilevel: Some(600),
            class: Some(2),
            subclass: Some(0),
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
    fn instances_and_mplus_filters_reflect_runtime_instance_flags() {
        let _lock = crate::item_db::state::TEST_STATE_LOCK.lock().unwrap();
        let snapshot = StateSnapshot::capture();

        *state::INSTANCES.write().unwrap() = vec![
            serde_json::json!({
                "id": 1, "name": "Dungeon A", "type": "dungeon", "expansion": 1, "active_rotation": true
            }),
            serde_json::json!({
                "id": 2, "name": "Dungeon B", "type": "dungeon", "expansion": 1, "active_rotation": false
            }),
            serde_json::json!({
                "id": 3, "name": "M+ C", "type": "mythic_plus", "expansion": 1
            }),
        ];

        let all = list_instances();
        assert_eq!(all.len(), 3);
        let mplus = get_mplus_dungeons();
        let ids: Vec<i64> = mplus.iter().map(|d| d.id).collect();
        assert!(ids.contains(&1));
        assert!(ids.contains(&3));
        assert!(!ids.contains(&2));

        snapshot.restore();
    }

    #[test]
    fn bonus_filters_and_item_limit_categories_use_current_maps() {
        let _lock = crate::item_db::state::TEST_STATE_LOCK.lock().unwrap();
        let snapshot = StateSnapshot::capture();

        *state::BONUSES.write().unwrap() = Arc::new(HashMap::from([
            (
                7001_u64,
                BonusData {
                    ilevel: Some(crate::types::BonusIlevel {
                        amount: Some(10),
                        priority: Some(0),
                    }),
                    ..BonusData::default()
                },
            ),
            (7002_u64, BonusData::default()),
        ]));
        *state::ITEM_LIMIT_CATS.write().unwrap() = Arc::new(HashMap::from([
            (7001_u64, (11_u64, 2_u64)),
            (7002_u64, (11_u64, 2_u64)),
        ]));

        assert_eq!(filter_ilevel_bonus_ids(&[7001, 7002, 9999]), vec![7001]);
        let cats = get_item_limit_categories(&[7001, 9999]);
        assert_eq!(cats.get(&11), Some(&2));

        snapshot.restore();
    }

    #[test]
    fn inventory_and_enchant_info_lookups_support_primary_and_fallback_maps() {
        let _lock = crate::item_db::state::TEST_STATE_LOCK.lock().unwrap();
        let snapshot = StateSnapshot::capture();

        *state::ITEMS.write().unwrap() = Arc::new(HashMap::from([(
            9001_u64,
            game_item_with_inventory(9001, 13),
        )]));
        assert_eq!(get_inventory_type(9001), Some(13));
        assert_eq!(get_inventory_type(9999), None);

        *state::ENCHANTS.write().unwrap() = Arc::new(HashMap::from([(
            501_u64,
            EnchantData {
                id: 501,
                item_name: Some("Authority".to_string()),
                item_icon: Some("inv_sword".to_string()),
                quality: Some(4),
                ..EnchantData::default()
            },
        )]));
        let direct = get_enchant_info(501).expect("enchant lookup should work");
        assert_eq!(direct["name"], "Authority");
        assert_eq!(direct["icon"], "inv_sword");

        *state::ENCHANTS.write().unwrap() = Arc::new(HashMap::new());
        *state::ENCHANTS_BY_ITEM_ID.write().unwrap() = Arc::new(HashMap::from([(
            9002_u64,
            EnchantData {
                id: 777,
                display_name: Some("Fallback Enchant".to_string()),
                spell_icon: Some("spell_nature".to_string()),
                quality: Some(3),
                ..EnchantData::default()
            },
        )]));
        let fallback = get_enchant_info(9002).expect("item-id fallback lookup should work");
        assert_eq!(fallback["name"], "Fallback Enchant");
        assert_eq!(fallback["icon"], "spell_nature");

        snapshot.restore();
    }
}
