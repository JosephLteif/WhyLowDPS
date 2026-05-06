pub mod class_data;
pub mod season;
pub mod simc;

use serde::{Deserialize, Serialize};

// ---- Item Origin ----

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ItemOrigin {
    #[default]
    Equipped,
    Bags,
    Vault,
}

impl ItemOrigin {
    pub fn as_str(&self) -> &'static str {
        match self {
            ItemOrigin::Equipped => "equipped",
            ItemOrigin::Bags => "bags",
            ItemOrigin::Vault => "vault",
        }
    }
}

// ---- Raw Parsed Item (output of addon_parser, input to gear_resolver) ----

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawParsedItem {
    pub raw_slot: String,
    pub simc_string: String,
    pub item_id: u64,
    pub ilevel: i64,
    pub name: String,
    pub bonus_ids: Vec<u64>,
    pub enchant_id: u64,
    pub gem_id: u64,
    pub origin: ItemOrigin,
}

// ---- Character Info ----

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharacterInfo {
    pub class_name: Option<String>,
    pub spec: Option<String>,
}

impl CharacterInfo {
    pub fn can_dual_wield(&self) -> bool {
        self.spec.as_deref().is_some_and(class_data::can_dual_wield)
    }

    pub fn can_use_offhand(&self) -> bool {
        match (self.class_name.as_deref(), self.spec.as_deref()) {
            (Some(class_name), Some(spec_name)) => class_data::spec_weapon_profile(class_name, spec_name)
                .is_some_and(|profile| profile.can_use_offhand || profile.can_use_shield),
            _ => false,
        }
    }

    pub fn max_armor(&self) -> Option<u64> {
        self.class_name
            .as_deref()
            .and_then(class_data::class_max_armor)
    }
}

// ---- Talent Loadout ----

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TalentLoadout {
    pub name: String,
    pub talent_string: String,
    pub is_active: bool,
}

// ---- Parse Result (output of addon_parser) ----

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParseResult {
    pub items: Vec<RawParsedItem>,
    pub character: CharacterInfo,
    pub base_profile: String,
    pub talent_loadouts: Vec<TalentLoadout>,
}

// ---- Bonus Resolution Result ----

#[derive(Debug, Clone, Default)]
pub struct BonusResolved {
    pub quality: Option<i64>,
    pub ilevel: Option<i64>,
    pub tag: Option<String>,
    pub sockets: Option<i64>,
    pub upgrade: Option<String>,
    pub season_id: Option<i64>,
}

// ---- Item Info (output of item_db::get_item_info) ----

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItemInfo {
    pub item_id: u64,
    pub name: String,
    pub icon: String,
    pub ilevel: i64,
    pub quality: i64,
    pub quality_name: String,
    pub tag: String,
    pub upgrade: String,
    pub sockets: i64,
    pub armor_subclass: i64,
    pub inventory_type: i64,
    pub item_class: i64,
    pub item_subclass: i64,
}

impl ItemInfo {
    /// Fallback for items not found in the DB.
    pub fn unknown(item_id: u64) -> Self {
        Self {
            item_id,
            name: format!("Item {}", item_id),
            icon: "inv_misc_questionmark".to_string(),
            ilevel: 0,
            quality: 1,
            quality_name: "common".to_string(),
            tag: String::new(),
            upgrade: String::new(),
            sockets: 0,
            armor_subclass: 0,
            inventory_type: 0,
            item_class: 0,
            item_subclass: 0,
        }
    }
}

// ---- Resolved Item (output of gear_resolver) ----

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ResolvedItem {
    /// Stable identity:
    /// "item_id:sorted_bonus_ids:origin:i<ilevel>:e<enchant>:g<gem>:raw_slot"
    #[serde(default)]
    pub uid: String,
    #[serde(default)]
    pub slot: String,
    #[serde(default)]
    pub item_id: u64,
    #[serde(default)]
    pub ilevel: i64,
    #[serde(default)]
    pub simc_string: String,
    #[serde(default)]
    pub origin: ItemOrigin,
    #[serde(default)]
    pub bonus_ids: Vec<u64>,
    #[serde(default)]
    pub enchant_id: u64,
    #[serde(default)]
    pub gem_id: u64,
    /// Display info from item DB.
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub quality: i64,
    #[serde(default)]
    pub quality_color: String,
    #[serde(default)]
    pub tag: String,
    #[serde(default)]
    pub upgrade: String,
    #[serde(default)]
    pub sockets: i64,
    /// Enchant display name (empty if none).
    #[serde(default)]
    pub enchant_name: String,
    /// Gem display name (empty if none).
    #[serde(default)]
    pub gem_name: String,
    /// Gem icon (empty if none).
    #[serde(default)]
    pub gem_icon: String,
    #[serde(default)]
    pub encounter: String,
    #[serde(default)]
    pub instance_name: String,
    #[serde(default)]
    pub source_type: String,
    #[serde(default, skip_serializing_if = "is_zero_i64")]
    pub encounter_id: i64,
    #[serde(default, skip_serializing_if = "is_zero_i64")]
    pub instance_id: i64,
    /// Season ID from upgrade track (0 if none).
    #[serde(default, skip_serializing_if = "is_zero_i64")]
    pub season_id: i64,
    #[serde(default)]
    pub inventory_type: i64,
    /// Whether this item is a catalyst-generated tier alternative.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub is_catalyst: bool,
    /// Whether this item can be converted via Revival Catalyst.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub can_catalyst: bool,
    /// Whether this item may not be intended for the active spec.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub off_spec: bool,
    /// Upgrade costs from the baseline equipped item (if this is an upgrade option).
    #[serde(default, skip_serializing_if = "std::collections::HashMap::is_empty")]
    pub upgrade_costs: std::collections::HashMap<u64, u64>,
    /// Item-limit categories consumed by this item, keyed by category id with the max quantity.
    #[serde(default, skip_serializing_if = "std::collections::HashMap::is_empty")]
    pub item_limit_categories: std::collections::HashMap<u64, u64>,
}

fn is_zero_i64(v: &i64) -> bool {
    *v == 0
}

// ---- Slot Resolution ----

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SlotResolution {
    pub equipped: Option<ResolvedItem>,
    pub alternatives: Vec<ResolvedItem>,
}

// ---- Full Gear Resolve Result ----

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolveGearResponse {
    pub character: CharacterResolveInfo,
    pub base_profile: String,
    pub slots: std::collections::HashMap<String, SlotResolution>,
    pub excluded: Vec<ExcludedItem>,
    pub talent_loadouts: Vec<TalentLoadout>,
    /// Number of catalyst charges available (None if not detected in addon export).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub catalyst_charges: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharacterResolveInfo {
    pub class_name: Option<String>,
    pub spec: Option<String>,
    pub can_dual_wield: bool,
    pub can_use_offhand: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExcludedItem {
    #[serde(default)]
    pub uid: String,
    #[serde(default)]
    pub item_id: u64,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub reason: String,
}

// ---- Game Data Structs (Strong Typing for item_db) ----

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameItem {
    pub id: u64,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub quality: u64,
    #[serde(rename = "itemLevel")]
    pub base_ilevel: Option<i64>,
    #[serde(rename = "itemClass")]
    pub class: Option<i64>,
    #[serde(rename = "itemSubClass")]
    pub subclass: Option<i64>,
    #[serde(rename = "inventoryType")]
    pub inventory_type: Option<i64>,
    #[serde(rename = "itemSetId")]
    pub set_id: Option<i64>,
    #[serde(default, rename = "hasSockets")]
    pub has_sockets: bool,
    #[serde(default, rename = "socketInfo")]
    pub socket_info: Option<GameItemSocketInfo>,

    #[serde(rename = "allowableClasses")]
    pub classes: Option<Vec<u64>>,
    #[serde(default)]
    pub specs: Option<Vec<u64>>,
    #[serde(default)]
    pub stats: Option<Vec<GameItemStat>>,
    #[serde(default, rename = "bonusLists")]
    pub bonus_lists: Vec<u64>,
    pub sources: Option<Vec<ItemSource>>,
    #[serde(default)]
    pub profession: Option<GameItemProfession>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct GameItemSocketInfo {
    pub sockets: Vec<GameItemSocketEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct GameItemSocketEntry {
    #[serde(rename = "type")]
    pub socket_type: Option<String>,
}

impl GameItem {
    pub fn restriction_ids(&self) -> Vec<u64> {
        let mut out = Vec::new();
        if let Some(specs) = &self.specs {
            for id in specs {
                if !out.contains(id) {
                    out.push(*id);
                }
            }
        }
        if let Some(classes) = &self.classes {
            for id in classes {
                if !out.contains(id) {
                    out.push(*id);
                }
            }
        }
        out
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct GameItemStat {
    pub id: u64,
    pub alloc: Option<u64>,
}

impl Default for GameItemStat {
    fn default() -> Self {
        Self { id: 0, alloc: None }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct GameItemProfession {
    pub id: Option<u64>,
    #[serde(rename = "recipeSpellId")]
    pub recipe_spell_id: Option<u64>,
    #[serde(rename = "optionalCraftingSlots")]
    pub optional_crafting_slots: Vec<GameItemOptionalCraftingSlot>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct GameItemOptionalCraftingSlot {
    pub id: u64,
    pub count: Option<u64>,
    #[serde(rename = "recraftCount")]
    pub recraft_count: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItemSource {
    #[serde(rename = "encounterId")]
    pub encounter_id: Option<i64>,
    #[serde(rename = "instanceId")]
    pub instance_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct EnchantData {
    pub id: u64,
    #[serde(rename = "itemId")]
    pub item_id: Option<u64>,
    #[serde(rename = "itemName")]
    pub item_name: Option<String>,
    #[serde(rename = "displayName")]
    pub display_name: Option<String>,
    #[serde(rename = "baseDisplayName")]
    pub base_display_name: Option<String>,
    #[serde(rename = "itemIcon")]
    pub item_icon: Option<String>,
    #[serde(rename = "spellIcon")]
    pub spell_icon: Option<String>,
    pub slot: Option<String>,
    pub quality: Option<u64>,
    pub expansion: Option<u64>,
    #[serde(rename = "socketType")]
    pub socket_type: Option<String>,
    #[serde(rename = "craftingQuality")]
    pub crafting_quality: Option<u64>,
    #[serde(rename = "categoryName")]
    pub category_name: Option<String>,
    #[serde(rename = "equipRequirements")]
    pub requirements: Option<EnchantRequirements>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct EnchantRequirements {
    #[serde(rename = "invTypeMask")]
    pub inv_type_mask: Option<u64>,
    #[serde(rename = "itemClass")]
    pub item_class: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct BonusData {
    pub quality: Option<u64>,
    #[serde(rename = "itemLevel")]
    pub ilevel: Option<BonusIlevel>,
    #[serde(rename = "levelOffset")]
    pub offset: Option<BonusOffset>,
    pub tag: Option<String>,
    pub socket: Option<i64>,
    pub upgrade: Option<BonusUpgrade>,
    pub item_limit_category: Option<u64>,
    #[serde(rename = "craftedStats")]
    pub crafted_stats: Vec<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct BonusIlevel {
    pub amount: Option<u64>,
    pub priority: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct BonusOffset {
    pub amount: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct BonusUpgrade {
    #[serde(rename = "fullName")]
    pub full_name: Option<String>,
    #[serde(rename = "itemLevel")]
    pub ilevel: Option<u64>,
    #[serde(rename = "seasonId")]
    pub season_id: Option<u64>,
    pub group: Option<u64>,
    pub level: Option<u64>,
}
