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
