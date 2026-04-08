use crate::types::{class_data, BonusResolved, ItemInfo, GameItem, EnchantData, BonusData};
use std::collections::{HashMap, HashSet};
use once_cell::sync::OnceCell;
use serde_json::Value;

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

// ---- Static Data Stores ----

pub static ITEMS: OnceCell<HashMap<u64, GameItem>> = OnceCell::new();
pub static ENCHANTS: OnceCell<HashMap<u64, EnchantData>> = OnceCell::new();
pub static ENCHANTS_BY_ITEM_ID: OnceCell<HashMap<u64, EnchantData>> = OnceCell::new();
pub static BONUSES: OnceCell<HashMap<u64, BonusData>> = OnceCell::new();
pub static UPGRADE_MAX: OnceCell<HashMap<u64, u64>> = OnceCell::new();
pub static INSTANCES: OnceCell<Vec<Value>> = OnceCell::new();
pub static DROPS_BY_ENCOUNTER: OnceCell<HashMap<i64, Vec<GameItem>>> = OnceCell::new();

pub type UpgradeTrackKey = (String, u64, u64);
pub type UpgradeTrackValue = (u64, u64, u64);
pub static UPGRADE_TRACKS: OnceCell<HashMap<UpgradeTrackKey, UpgradeTrackValue>> = OnceCell::new();

/// Per-step upgrade costs: bonus_id → HashMap<currency_id, amount>
pub static UPGRADE_STEP_COSTS: OnceCell<HashMap<u64, HashMap<u64, u64>>> = OnceCell::new();
/// Squish era → curve ID mapping.
pub static SQUISH_ERAS: OnceCell<HashMap<u64, u64>> = OnceCell::new();
/// Item curves: curve_id → sorted Vec<(old_ilevel, new_ilevel)>.
pub static ITEM_CURVES: OnceCell<HashMap<u64, Vec<(u64, u64)>>> = OnceCell::new();
/// Current season ID (highest seasonId found in upgrade bonuses).
pub static CURRENT_SEASON_ID: OnceCell<u64> = OnceCell::new();
/// Currency metadata: currency_id → (name, icon)
pub static CURRENCY_INFO: OnceCell<HashMap<u64, (String, String)>> = OnceCell::new();
/// Item limit categories: bonus_id → (category_id, max_quantity)
pub static ITEM_LIMIT_CATS: OnceCell<HashMap<u64, (u64, u64)>> = OnceCell::new();
pub static SEASON_CONFIG: OnceCell<Value> = OnceCell::new();
pub static TALENT_TREES: OnceCell<HashMap<u64, Value>> = OnceCell::new();


/// Catalyst item info for a specific class + slot combination.
#[derive(Debug, Clone)]
pub struct CatalystTierItem {
    pub item_id: u64,
    pub name: String,
    pub icon: String,
    /// Whether this item is part of a tier set (has itemSetId).
    pub has_set: bool,
}

/// Catalyst conversion data for the current season.
pub struct CatalystData {
    /// Maps (wow_class_id, inventory_type) → tier item info.
    pub tier_items: HashMap<(u64, u64), CatalystTierItem>,
    /// Set of all tier item IDs (for "is this already a tier piece?" checks).
    pub tier_item_ids: HashSet<u64>,
    /// Currency ID for catalyst charges (e.g. 3378 for Midnight Catalyst).
    pub catalyst_currency_id: u64,
}

pub static CATALYST: OnceCell<CatalystData> = OnceCell::new();

pub static EMPTY_SEASON_CONFIG: once_cell::sync::Lazy<Value> =
    once_cell::sync::Lazy::new(|| serde_json::json!({}));
