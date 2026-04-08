//! Single source of truth for all WoW class, spec, and gear slot constants.
//!
//! Every module in the codebase imports from here. Nothing else defines these.

use regex::Regex;
use serde::{Deserialize, Serialize};
use once_cell::sync::OnceCell;


// ---- Gear Slots ----

pub const GEAR_SLOTS: &[&str] = &[
    "head",
    "neck",
    "shoulder",
    "back",
    "chest",
    "wrist",
    "hands",
    "waist",
    "legs",
    "feet",
    "finger1",
    "finger2",
    "trinket1",
    "trinket2",
    "main_hand",
    "off_hand",
];

/// Armor-type-restricted slots (head, shoulder, chest, wrist, hands, waist, legs, feet).
/// Slots like neck, back, finger, trinket, and weapons are NOT armor-type restricted.
pub const ARMOR_SLOTS: &[&str] = &[
    "head", "shoulder", "chest", "wrist", "hands", "waist", "legs", "feet",
];

/// Armor inventory types where subclass filtering applies.
pub const ARMOR_INVENTORY_TYPES: &[u64] = &[1, 3, 5, 6, 7, 8, 9, 10, 20];

/// Paired slots — single source for both `paired_slot()` and `UNIQUE_SLOT_PAIRS`.
const PAIRED_SLOTS: &[(&str, &str)] = &[("finger1", "finger2"), ("trinket1", "trinket2")];

pub const UNIQUE_SLOT_PAIRS: &[(&str, &str)] = PAIRED_SLOTS;

pub fn paired_slot(slot: &str) -> Option<&'static str> {
    PAIRED_SLOTS.iter().find_map(|(a, b)| {
        if *a == slot {
            Some(*b)
        } else if *b == slot {
            Some(*a)
        } else {
            None
        }
    })
}

pub const SLOT_DISPLAY_ORDER: &[&str] = &[
    "Main Hand",
    "Off Hand",
    "Head",
    "Neck",
    "Shoulder",
    "Back",
    "Chest",
    "Wrist",
    "Hands",
    "Waist",
    "Legs",
    "Feet",
    "Finger",
    "Trinket",
];

/// Human-readable slot name from inventory_type (for drop display).
pub fn inventory_type_display_slot(inv_type: u64) -> &'static str {
    match inv_type {
        1 => "Head",
        2 => "Neck",
        3 => "Shoulder",
        4 => "Shirt",
        5 | 20 => "Chest",
        6 => "Waist",
        7 => "Legs",
        8 => "Feet",
        9 => "Wrist",
        10 => "Hands",
        11 => "Finger",
        12 => "Trinket",
        13 | 15 | 17 | 21 | 26 => "Main Hand",
        14 | 22 | 23 => "Off Hand",
        16 => "Back",
        19 => "Tabard",
        _ => "Other",
    }
}

// ---- Class & Spec Data Table ----
//
// All class/spec metadata lives here. The lookup functions below derive from
// this single table instead of maintaining parallel match blocks.

/// Per-spec metadata.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct SpecDef {
    pub name: String,
    pub id: u64,
    pub weapon_subclasses: Vec<u64>,
    pub can_dual_wield: bool,
    pub can_use_shield: bool,
    pub can_use_offhand: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct ClassDef {
    pub name: String,
    pub aliases: Vec<String>,
    pub max_armor: u64,
    pub weapons: Vec<u64>,
    pub specs: Vec<SpecDef>,
}

pub static CLASSES: OnceCell<Vec<ClassDef>> = OnceCell::new();


// ---- Lookup Helpers ----


fn find_class(name: &str) -> Option<ClassDef> {
    let n = name.to_lowercase();
    CLASSES
        .get()?
        .iter()
        .find(|c| c.name == n || c.aliases.iter().any(|a| a == &n))
        .cloned()
}



pub fn can_dual_wield(spec: &str) -> bool {
    CLASSES
        .get()
        .map(|cs| cs.iter().flat_map(|c| c.specs.iter()).any(|s| s.name == spec && s.can_dual_wield))
        .unwrap_or(false)
}




/// Max armor subclass: 1=Cloth, 2=Leather, 3=Mail, 4=Plate.
pub fn class_max_armor(class_name: &str) -> Option<u64> {
    find_class(class_name).map(|c| c.max_armor)
}


/// Weapon subclass IDs each class can equip (broad filter for drop tables).
pub fn class_allowed_weapons(class_name: &str) -> Option<Vec<u64>> {
    find_class(class_name).map(|c| c.weapons)
}



/// Per-spec weapon eligibility. Returns the full `SpecDef` which includes
/// `weapon_subclasses`, `can_use_shield`, `can_use_offhand`, and more.
pub fn spec_weapon_profile(class_name: &str, spec: &str) -> Option<SpecDef> {
    let class = find_class(class_name)?;
    class.specs.into_iter().find(|s| s.name == spec)
}


/// Map spec name → numeric spec ID.
pub fn class_spec_ids(class_name: &str, spec_name: Option<&str>) -> Vec<u64> {
    let class = match find_class(class_name) {
        Some(c) => c,
        None => return vec![],
    };
    match spec_name {
        Some(name) => class
            .specs
            .iter()
            .filter(|s| s.name == name)
            .map(|s| s.id)
            .collect(),
        None => class.specs.iter().map(|s| s.id).collect(),
    }
}

// ---- Inventory Type → Gear Slots ----

/// Map an item's inventory_type to eligible gear slot names.
pub fn inv_type_to_slots(inv_type: u64, spec: &str) -> Vec<&'static str> {
    match inv_type {
        1 => vec!["head"],
        2 => vec!["neck"],
        3 => vec!["shoulder"],
        5 | 20 => vec!["chest"],
        6 => vec!["waist"],
        7 => vec!["legs"],
        8 => vec!["feet"],
        9 => vec!["wrist"],
        10 => vec!["hands"],
        11 => vec!["finger1", "finger2"],
        12 => vec!["trinket1", "trinket2"],
        13 => {
            if can_dual_wield(spec) {
                vec!["main_hand", "off_hand"]
            } else {
                vec!["main_hand"]
            }
        }
        14 => vec!["off_hand"], // Shield
        16 => vec!["back"],
        17 => {
            // Two-hand: Fury warriors can equip in both slots (Titan's Grip)
            if spec == "fury" {
                vec!["main_hand", "off_hand"]
            } else {
                vec!["main_hand"]
            }
        }
        15 | 21 | 26 => vec!["main_hand"], // Ranged, Main-hand only
        22 | 23 => vec!["off_hand"],       // Off-hand, Held
        _ => vec![],
    }
}

/// Map a numeric spec ID to the SimC spec name (e.g., 254 → "marksmanship").
pub fn spec_id_to_name(spec_id: u64) -> Option<String> {
    CLASSES
        .get()?
        .iter()
        .flat_map(|c| c.specs.iter())
        .find(|s| s.id == spec_id)
        .map(|s| s.name.clone())
}



/// Map a SimC class name to its WoW numeric class ID.
pub fn class_wow_id(class_name: &str) -> Option<u64> {
    let n = class_name.to_lowercase();
    // WoW class IDs: warrior=1, paladin=2, hunter=3, rogue=4, priest=5,
    // death_knight=6, shaman=7, mage=8, warlock=9, monk=10, druid=11,
    // demon_hunter=12, evoker=13
    const WOW_IDS: &[(&str, u64)] = &[
        ("warrior", 1),
        ("paladin", 2),
        ("hunter", 3),
        ("rogue", 4),
        ("priest", 5),
        ("death_knight", 6),
        ("deathknight", 6),
        ("shaman", 7),
        ("mage", 8),
        ("warlock", 9),
        ("monk", 10),
        ("druid", 11),
        ("demon_hunter", 12),
        ("demonhunter", 12),
        ("evoker", 13),
    ];
    WOW_IDS
        .iter()
        .find(|(name, _)| *name == n)
        .map(|(_, id)| *id)
}

// ---- Detection ----

/// Detect the character class from a simc input string.
pub fn detect_class(simc_input: &str) -> Option<String> {
    let classes = CLASSES.get()?;
    let names: Vec<String> = classes
        .iter()
        .flat_map(|c| std::iter::once(c.name.clone()).chain(c.aliases.iter().cloned()))
        .collect();
    let pattern = format!(r#"^({})\s*="#, names.join("|"));
    let class_re = Regex::new(&pattern).unwrap();
    for line in simc_input.lines() {
        if let Some(caps) = class_re.captures(line.trim()) {
            return Some(caps[1].to_string());
        }
    }
    None
}


/// Detect the spec from a simc input string.
pub fn detect_spec(simc_input: &str) -> Option<String> {
    let spec_re = Regex::new(r"^spec=(\w+)").unwrap();
    for line in simc_input.lines() {
        if let Some(caps) = spec_re.captures(line.trim()) {
            return Some(caps[1].to_lowercase());
        }
    }
    None
}

// ---- Quality ----

pub const QUALITY_NAMES: &[(u64, &str)] = &[
    (0, "poor"),
    (1, "common"),
    (2, "uncommon"),
    (3, "rare"),
    (4, "epic"),
    (5, "legendary"),
    (6, "artifact"),
    (7, "heirloom"),
];

pub fn quality_name(quality: u64) -> String {
    QUALITY_NAMES
        .iter()
        .find(|(q, _)| *q == quality)
        .map(|(_, name)| name.to_string())
        .unwrap_or_else(|| "common".to_string())
}


pub fn quality_color(quality: u64) -> &'static str {
    match quality {
        0 => "#9d9d9d", // poor
        1 => "#ffffff", // common
        2 => "#1eff00", // uncommon
        3 => "#0070dd", // rare
        4 => "#a335ee", // epic
        5 => "#ff8000", // legendary
        6 => "#e6cc80", // artifact
        7 => "#00ccff", // heirloom
        _ => "#ffffff",
    }
}

// ---- Utilities ----

pub fn title_case(s: &str) -> String {
    s.split_whitespace()
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                Some(c) => format!("{}{}", c.to_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}
