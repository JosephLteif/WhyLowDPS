use crate::types::{BonusData, EnchantData, GameItem};
use once_cell::sync::Lazy;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::RwLock;

// ---- Upgrade Tracks (ranked) ----

/// Ranked upgrade tracks, lowest to highest.
pub const TRACK_RANKS: &[&str] = &[
    "Explorer",
    "Adventurer",
    "Veteran",
    "Champion",
    "Hero",
    "Myth",
];

use std::sync::Arc;
#[cfg(test)]
use std::sync::Mutex;

// ---- Static Data Stores ----

pub static ITEMS: Lazy<RwLock<Arc<HashMap<u64, GameItem>>>> =
    Lazy::new(|| RwLock::new(Arc::new(HashMap::new())));
pub static ENCHANTS: Lazy<RwLock<Arc<HashMap<u64, EnchantData>>>> =
    Lazy::new(|| RwLock::new(Arc::new(HashMap::new())));
pub static ENCHANTS_BY_ITEM_ID: Lazy<RwLock<Arc<HashMap<u64, EnchantData>>>> =
    Lazy::new(|| RwLock::new(Arc::new(HashMap::new())));
pub static BONUSES: Lazy<RwLock<Arc<HashMap<u64, BonusData>>>> =
    Lazy::new(|| RwLock::new(Arc::new(HashMap::new())));
pub static UPGRADE_MAX: Lazy<RwLock<Arc<HashMap<u64, u64>>>> =
    Lazy::new(|| RwLock::new(Arc::new(HashMap::new())));
pub static INSTANCES: Lazy<RwLock<Vec<Value>>> = Lazy::new(|| RwLock::new(Vec::new()));
pub type DropMap = HashMap<i64, Vec<GameItem>>;
pub static DROPS_BY_ENCOUNTER: Lazy<RwLock<Arc<DropMap>>> =
    Lazy::new(|| RwLock::new(Arc::new(HashMap::new())));

pub type UpgradeTrackKey = (String, u64, u64);
pub type UpgradeTrackValue = (u64, u64, u64);
pub static UPGRADE_TRACKS: Lazy<RwLock<Arc<HashMap<UpgradeTrackKey, UpgradeTrackValue>>>> =
    Lazy::new(|| RwLock::new(Arc::new(HashMap::new())));

pub type UpgradeCostMap = HashMap<u64, HashMap<u64, u64>>;
/// Per-step upgrade costs: bonus_id → HashMap<currency_id, amount>
pub static UPGRADE_STEP_COSTS: Lazy<RwLock<Arc<UpgradeCostMap>>> =
    Lazy::new(|| RwLock::new(Arc::new(HashMap::new())));

/// Squish era → curve ID mapping.
pub static SQUISH_ERAS: Lazy<RwLock<Arc<HashMap<u64, u64>>>> =
    Lazy::new(|| RwLock::new(Arc::new(HashMap::new())));

pub type ItemCurveMap = HashMap<u64, Vec<(u64, u64)>>;
/// Item curves: curve_id → sorted Vec<(old_ilevel, new_ilevel)>.
pub static ITEM_CURVES: Lazy<RwLock<Arc<ItemCurveMap>>> =
    Lazy::new(|| RwLock::new(Arc::new(HashMap::new())));

/// Current season ID (highest seasonId found in upgrade bonuses).
pub static CURRENT_SEASON_ID: Lazy<RwLock<u64>> = Lazy::new(|| RwLock::new(0));

pub type CurrencyInfoMap = HashMap<u64, (String, String)>;
/// Currency metadata: currency_id → (name, icon)
pub static CURRENCY_INFO: Lazy<RwLock<Arc<CurrencyInfoMap>>> =
    Lazy::new(|| RwLock::new(Arc::new(HashMap::new())));

pub type ItemLimitMap = HashMap<u64, (u64, u64)>;
/// Item limit categories: bonus_id → (category_id, max_quantity)
pub static ITEM_LIMIT_CATS: Lazy<RwLock<Arc<ItemLimitMap>>> =
    Lazy::new(|| RwLock::new(Arc::new(HashMap::new())));
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
#[serde(default)]
pub struct CraftingSlotData {
    #[serde(rename = "reagentSlotId")]
    pub reagent_slot_id: u64,
    pub name: String,
    #[serde(rename = "reagentIds")]
    pub reagent_ids: Vec<u64>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
#[serde(default)]
pub struct CraftingItemLimit {
    pub category: u64,
    pub quantity: u64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
#[serde(default)]
pub struct CraftingReagentData {
    pub id: u64,
    pub name: String,
    pub icon: String,
    pub quality: u64,
    #[serde(rename = "itemId")]
    pub item_id: Option<u64>,
    #[serde(rename = "craftingBonusIds")]
    pub crafting_bonus_ids: Vec<u64>,
    #[serde(rename = "itemLimit")]
    pub item_limit: Option<CraftingItemLimit>,
    #[serde(rename = "reagentType")]
    pub reagent_type: String,
    #[serde(default)]
    pub expansion: Option<u64>,
}

pub static CRAFTING_SLOTS: Lazy<RwLock<Arc<HashMap<u64, CraftingSlotData>>>> =
    Lazy::new(|| RwLock::new(Arc::new(HashMap::new())));
pub static CRAFTING_REAGENTS: Lazy<RwLock<Arc<HashMap<u64, CraftingReagentData>>>> =
    Lazy::new(|| RwLock::new(Arc::new(HashMap::new())));
pub static CRAFTING_LIMIT_CATS: Lazy<RwLock<Arc<ItemLimitMap>>> =
    Lazy::new(|| RwLock::new(Arc::new(HashMap::new())));

pub static SEASON_CONFIG: Lazy<RwLock<Value>> = Lazy::new(|| RwLock::new(serde_json::json!({})));
pub static TALENT_TREES: Lazy<RwLock<Arc<HashMap<u64, Value>>>> =
    Lazy::new(|| RwLock::new(Arc::new(HashMap::new())));
pub static FLASK_OPTIONS_RAW: Lazy<RwLock<Arc<Vec<Value>>>> =
    Lazy::new(|| RwLock::new(Arc::new(Vec::new())));
pub static FOOD_OPTIONS_RAW: Lazy<RwLock<Arc<Vec<Value>>>> =
    Lazy::new(|| RwLock::new(Arc::new(Vec::new())));
pub static POTION_OPTIONS_RAW: Lazy<RwLock<Arc<Vec<Value>>>> =
    Lazy::new(|| RwLock::new(Arc::new(Vec::new())));
pub static AUGMENT_OPTIONS_RAW: Lazy<RwLock<Arc<Vec<Value>>>> =
    Lazy::new(|| RwLock::new(Arc::new(Vec::new())));
pub static TEMP_ENCHANT_OPTIONS_RAW: Lazy<RwLock<Arc<Vec<Value>>>> =
    Lazy::new(|| RwLock::new(Arc::new(Vec::new())));

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
pub struct CatalystTierItem {
    pub item_id: u64,
    pub name: String,
    pub icon: String,
    pub has_set: bool,
    #[serde(default)]
    pub bonus_ids: Vec<u64>,
}

/// Catalyst conversion data for the current season.
#[derive(Default)]
pub struct CatalystData {
    /// Maps (wow_class_id, inventory_type) → tier item info.
    pub tier_items: HashMap<(u64, u64), CatalystTierItem>,
    /// Set of all tier item IDs (for "is this already a tier piece?" checks).
    pub tier_item_ids: HashSet<u64>,
    /// Currency ID for catalyst charges (e.g. 3378 for Midnight Catalyst).
    pub catalyst_currency_id: u64,
}

pub static CATALYST: Lazy<RwLock<Arc<CatalystData>>> =
    Lazy::new(|| RwLock::new(Arc::new(CatalystData::default())));

pub static RUNTIME_DATA: Lazy<RwLock<Value>> = Lazy::new(|| RwLock::new(serde_json::json!({})));

pub static EMPTY_SEASON_CONFIG: once_cell::sync::Lazy<Value> =
    once_cell::sync::Lazy::new(|| serde_json::json!({}));

#[cfg(test)]
pub static TEST_STATE_LOCK: once_cell::sync::Lazy<Mutex<()>> =
    once_cell::sync::Lazy::new(|| Mutex::new(()));

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::Arc;

    #[test]
    fn track_ranks_are_ordered_from_lowest_to_highest() {
        assert_eq!(
            TRACK_RANKS,
            &[
                "Explorer",
                "Adventurer",
                "Veteran",
                "Champion",
                "Hero",
                "Myth",
            ]
        );
    }

    #[test]
    fn crafting_slot_data_deserializes_camel_case_fields() {
        let slot: CraftingSlotData = serde_json::from_value(json!({
            "reagentSlotId": 123,
            "name": "Embellishment",
            "reagentIds": [1, 2, 3]
        }))
        .expect("slot json");

        assert_eq!(slot.reagent_slot_id, 123);
        assert_eq!(slot.name, "Embellishment");
        assert_eq!(slot.reagent_ids, vec![1, 2, 3]);
    }

    #[test]
    fn crafting_slot_data_defaults_missing_fields() {
        let slot: CraftingSlotData = serde_json::from_value(json!({})).expect("slot json");

        assert_eq!(slot.reagent_slot_id, 0);
        assert_eq!(slot.name, "");
        assert!(slot.reagent_ids.is_empty());
    }

    #[test]
    fn crafting_reagent_data_deserializes_full_shape() {
        let reagent: CraftingReagentData = serde_json::from_value(json!({
            "id": 42,
            "name": "Spark",
            "icon": "spell_fire",
            "quality": 3,
            "itemId": 9001,
            "craftingBonusIds": [100, 200],
            "itemLimit": {
                "category": 7,
                "quantity": 1
            },
            "reagentType": "spark",
            "expansion": 10
        }))
        .expect("reagent json");

        assert_eq!(reagent.id, 42);
        assert_eq!(reagent.name, "Spark");
        assert_eq!(reagent.icon, "spell_fire");
        assert_eq!(reagent.quality, 3);
        assert_eq!(reagent.item_id, Some(9001));
        assert_eq!(reagent.crafting_bonus_ids, vec![100, 200]);
        assert_eq!(reagent.reagent_type, "spark");
        assert_eq!(reagent.expansion, Some(10));

        let limit = reagent.item_limit.expect("item limit");
        assert_eq!(limit.category, 7);
        assert_eq!(limit.quantity, 1);
    }

    #[test]
    fn crafting_reagent_data_defaults_missing_optional_fields() {
        let reagent: CraftingReagentData = serde_json::from_value(json!({
            "id": 42,
            "name": "Spark",
            "icon": "spell_fire",
            "quality": 3,
            "reagentType": "spark"
        }))
        .expect("reagent json");

        assert_eq!(reagent.item_id, None);
        assert!(reagent.crafting_bonus_ids.is_empty());
        assert!(reagent.item_limit.is_none());
        assert_eq!(reagent.expansion, None);
    }

    #[test]
    fn crafting_reagent_data_defaults_entire_missing_shape() {
        let reagent: CraftingReagentData = serde_json::from_value(json!({})).expect("reagent json");

        assert_eq!(reagent.id, 0);
        assert_eq!(reagent.name, "");
        assert_eq!(reagent.icon, "");
        assert_eq!(reagent.quality, 0);
        assert_eq!(reagent.item_id, None);
        assert!(reagent.crafting_bonus_ids.is_empty());
        assert!(reagent.item_limit.is_none());
        assert_eq!(reagent.reagent_type, "");
        assert_eq!(reagent.expansion, None);
    }

    #[test]
    fn catalyst_tier_item_defaults_bonus_ids() {
        let item: CatalystTierItem = serde_json::from_value(json!({
            "item_id": 1,
            "name": "Tier Helm",
            "icon": "helm",
            "has_set": true
        }))
        .expect("tier item json");

        assert_eq!(item.item_id, 1);
        assert_eq!(item.name, "Tier Helm");
        assert_eq!(item.icon, "helm");
        assert!(item.has_set);
        assert!(item.bonus_ids.is_empty());
    }

    #[test]
    fn catalyst_data_default_is_empty_and_currency_zero() {
        let catalyst = CatalystData::default();

        assert!(catalyst.tier_items.is_empty());
        assert!(catalyst.tier_item_ids.is_empty());
        assert_eq!(catalyst.catalyst_currency_id, 0);
    }

    #[test]
    fn static_maps_are_empty_by_default() {
        let _guard = TEST_STATE_LOCK.lock().expect("test state lock");

        assert!(ITEMS.read().expect("items").is_empty());
        assert!(ENCHANTS.read().expect("enchants").is_empty());
        assert!(ENCHANTS_BY_ITEM_ID
            .read()
            .expect("enchants by item id")
            .is_empty());
        assert!(BONUSES.read().expect("bonuses").is_empty());
        assert!(UPGRADE_MAX.read().expect("upgrade max").is_empty());
        assert!(DROPS_BY_ENCOUNTER.read().expect("drops").is_empty());
        assert!(UPGRADE_TRACKS.read().expect("upgrade tracks").is_empty());
        assert!(UPGRADE_STEP_COSTS
            .read()
            .expect("upgrade step costs")
            .is_empty());
        assert!(SQUISH_ERAS.read().expect("squish eras").is_empty());
        assert!(ITEM_CURVES.read().expect("item curves").is_empty());
        assert!(CURRENCY_INFO.read().expect("currency info").is_empty());
        assert!(ITEM_LIMIT_CATS.read().expect("item limit cats").is_empty());
        assert!(CRAFTING_SLOTS.read().expect("crafting slots").is_empty());
        assert!(CRAFTING_REAGENTS
            .read()
            .expect("crafting reagents")
            .is_empty());
        assert!(CRAFTING_LIMIT_CATS
            .read()
            .expect("crafting limit cats")
            .is_empty());
        assert!(TALENT_TREES.read().expect("talent trees").is_empty());
        assert!(FLASK_OPTIONS_RAW.read().expect("flasks").is_empty());
        assert!(FOOD_OPTIONS_RAW.read().expect("food").is_empty());
        assert!(POTION_OPTIONS_RAW.read().expect("potions").is_empty());
        assert!(AUGMENT_OPTIONS_RAW.read().expect("augments").is_empty());
        assert!(TEMP_ENCHANT_OPTIONS_RAW
            .read()
            .expect("temp enchants")
            .is_empty());
    }

    #[test]
    fn static_values_are_empty_by_default() {
        let _guard = TEST_STATE_LOCK.lock().expect("test state lock");

        assert!(INSTANCES.read().expect("instances").is_empty());
        assert_eq!(*CURRENT_SEASON_ID.read().expect("season id"), 0);
        assert_eq!(*SEASON_CONFIG.read().expect("season config"), json!({}));
        assert_eq!(*RUNTIME_DATA.read().expect("runtime data"), json!({}));
        assert_eq!(*EMPTY_SEASON_CONFIG, json!({}));
    }

    #[test]
    fn catalyst_static_can_be_replaced_and_restored() {
        let _guard = TEST_STATE_LOCK.lock().expect("test state lock");

        let original = CATALYST.read().expect("catalyst").clone();

        let mut data = CatalystData {
            catalyst_currency_id: 3378,
            ..Default::default()
        };
        data.tier_item_ids.insert(111);

        data.tier_items.insert(
            (7, 1),
            CatalystTierItem {
                item_id: 111,
                name: "Tier Helm".to_string(),
                icon: "helm".to_string(),
                has_set: true,
                bonus_ids: vec![1, 2],
            },
        );

        {
            let mut catalyst = CATALYST.write().expect("catalyst write");
            *catalyst = Arc::new(data);
        }

        let catalyst = CATALYST.read().expect("catalyst");

        assert_eq!(catalyst.catalyst_currency_id, 3378);
        assert!(catalyst.tier_item_ids.contains(&111));
        assert_eq!(
            catalyst.tier_items.get(&(7, 1)).map(|item| item.item_id),
            Some(111)
        );

        drop(catalyst);

        {
            let mut catalyst = CATALYST.write().expect("catalyst restore");
            *catalyst = original;
        }
    }

    #[test]
    fn option_raw_vectors_can_be_replaced_and_restored() {
        let _guard = TEST_STATE_LOCK.lock().expect("test state lock");

        let original = FLASK_OPTIONS_RAW.read().expect("flasks").clone();

        {
            let mut flasks = FLASK_OPTIONS_RAW.write().expect("flasks write");
            *flasks = Arc::new(vec![json!({ "id": 1, "name": "Flask" })]);
        }

        assert_eq!(
            FLASK_OPTIONS_RAW.read().expect("flasks")[0]["name"].as_str(),
            Some("Flask")
        );

        {
            let mut flasks = FLASK_OPTIONS_RAW.write().expect("flasks restore");
            *flasks = original;
        }
    }

    #[test]
    fn season_and_runtime_json_can_be_updated_and_restored() {
        let _guard = TEST_STATE_LOCK.lock().expect("test state lock");

        let original_season = SEASON_CONFIG.read().expect("season config").clone();
        let original_runtime = RUNTIME_DATA.read().expect("runtime data").clone();

        {
            *SEASON_CONFIG.write().expect("season config write") = json!({ "season": 15 });
            *RUNTIME_DATA.write().expect("runtime data write") = json!({ "generated_at": "test" });
        }

        assert_eq!(
            SEASON_CONFIG.read().expect("season config")["season"].as_u64(),
            Some(15)
        );
        assert_eq!(
            RUNTIME_DATA.read().expect("runtime data")["generated_at"].as_str(),
            Some("test")
        );

        {
            *SEASON_CONFIG.write().expect("season config restore") = original_season;
            *RUNTIME_DATA.write().expect("runtime data restore") = original_runtime;
        }
    }
}
