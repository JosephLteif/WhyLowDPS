use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

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

use regex::Regex;
use serde::{Deserialize, Serialize};

// ---- Logic Constants ----

pub static CLASSES: Lazy<RwLock<Arc<Vec<ClassDef>>>> =
    Lazy::new(|| RwLock::new(Arc::new(Vec::new())));
pub static CLASS_TRAIT_SPEC_IDS: Lazy<RwLock<HashMap<String, Vec<u64>>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));

pub fn set_class_trait_spec_ids(map: HashMap<String, Vec<u64>>) {
    *CLASS_TRAIT_SPEC_IDS.write().unwrap() = map;
}

// ---- Lookup Helpers ----

fn find_class(name: &str) -> Option<ClassDef> {
    let n = name.to_lowercase();
    CLASSES
        .read()
        .unwrap()
        .iter()
        .find(|c| c.name == n || c.aliases.iter().any(|a| a == &n))
        .cloned()
}

fn normalize_class_name(raw: &str) -> String {
    let n = raw.trim().to_lowercase().replace([' ', '-'], "_");
    match n.as_str() {
        "deathknight" => "death_knight".to_string(),
        "demonhunter" => "demon_hunter".to_string(),
        _ => n,
    }
}

fn normalize_spec_name(raw: &str) -> String {
    let mut n = raw.trim().to_lowercase().replace([' ', '-'], "_");
    n = match n.as_str() {
        "beastmastery" => "beast_mastery".to_string(),
        "frostdk" | "frost_death_knight" => "frost".to_string(),
        "holypriest" | "holy_priest" => "holy".to_string(),
        "restorationshaman" | "restoration_shaman" => "restoration".to_string(),
        _ => n,
    };

    for suffix in [
        "_death_knight",
        "_demon_hunter",
        "_demonhunter",
        "_hunter",
        "_mage",
        "_monk",
        "_paladin",
        "_priest",
        "_rogue",
        "_shaman",
        "_warlock",
        "_warrior",
        "_druid",
        "_evoker",
    ] {
        if let Some(stripped) = n.strip_suffix(suffix) {
            n = stripped.to_string();
            break;
        }
    }

    n
}

fn fallback_class_spec_pairs(class_name: &str) -> &'static [(&'static str, u64)] {
    match class_name {
        "death_knight" => &[("blood", 250), ("frost", 251), ("unholy", 252)],
        "demon_hunter" => &[("havoc", 577), ("vengeance", 581)],
        "druid" => &[
            ("balance", 102),
            ("feral", 103),
            ("guardian", 104),
            ("restoration", 105),
        ],
        "evoker" => &[
            ("devastation", 1467),
            ("preservation", 1468),
            ("augmentation", 1473),
        ],
        "hunter" => &[
            ("beast_mastery", 253),
            ("marksmanship", 254),
            ("survival", 255),
        ],
        "mage" => &[("arcane", 62), ("fire", 63), ("frost", 64)],
        "monk" => &[
            ("brewmaster", 268),
            ("mistweaver", 270),
            ("windwalker", 269),
        ],
        "paladin" => &[("holy", 65), ("protection", 66), ("retribution", 70)],
        "priest" => &[("discipline", 256), ("holy", 257), ("shadow", 258)],
        "rogue" => &[("assassination", 259), ("outlaw", 260), ("subtlety", 261)],
        "shaman" => &[
            ("elemental", 262),
            ("enhancement", 263),
            ("restoration", 264),
        ],
        "warlock" => &[
            ("affliction", 265),
            ("demonology", 266),
            ("destruction", 267),
        ],
        "warrior" => &[("arms", 71), ("fury", 72), ("protection", 73)],
        _ => &[],
    }
}

pub fn can_dual_wield(spec: &str) -> bool {
    CLASSES
        .read()
        .unwrap()
        .iter()
        .flat_map(|c| c.specs.iter())
        .any(|s| s.name == spec && s.can_dual_wield)
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
    let cn = normalize_class_name(class_name);
    let normalized_spec = spec_name.map(normalize_spec_name);

    if let Some(trait_ids) = CLASS_TRAIT_SPEC_IDS.read().unwrap().get(&cn).cloned() {
        return match normalized_spec.clone() {
            Some(name) => fallback_class_spec_pairs(&cn)
                .iter()
                .find(|(spec, _)| *spec == name)
                .map(|(_, id)| {
                    if trait_ids.contains(id) {
                        vec![*id]
                    } else {
                        vec![]
                    }
                })
                .unwrap_or_default(),
            None => trait_ids,
        };
    }

    if let Some(class) = find_class(&cn) {
        return match normalized_spec {
            Some(name) => class
                .specs
                .iter()
                .filter(|s| normalize_spec_name(&s.name) == name)
                .map(|s| s.id)
                .collect(),
            None => class.specs.iter().map(|s| s.id).collect(),
        };
    }

    // Fallback for environments where rich class metadata is unavailable.
    match normalized_spec {
        Some(name) => fallback_class_spec_pairs(&cn)
            .iter()
            .filter(|(spec, _)| *spec == name)
            .map(|(_, id)| *id)
            .collect(),
        None => fallback_class_spec_pairs(&cn)
            .iter()
            .map(|(_, id)| *id)
            .collect(),
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
    if let Some(name) = CLASSES
        .read()
        .unwrap()
        .iter()
        .flat_map(|c| c.specs.iter())
        .find(|s| s.id == spec_id)
        .map(|s| s.name.clone())
    {
        return Some(name);
    }

    for class_name in [
        "death_knight",
        "demon_hunter",
        "druid",
        "evoker",
        "hunter",
        "mage",
        "monk",
        "paladin",
        "priest",
        "rogue",
        "shaman",
        "warlock",
        "warrior",
    ] {
        if let Some((name, _)) = fallback_class_spec_pairs(class_name)
            .iter()
            .find(|(_, id)| *id == spec_id)
        {
            return Some((*name).to_string());
        }
    }

    None
}

/// Map a SimC class name to its WoW numeric class ID.
pub fn class_wow_id(class_name: &str) -> Option<u64> {
    let n = normalize_class_name(class_name);
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

/// Resolve a numeric spec ID to its parent WoW class ID.
pub fn spec_id_to_wow_class_id(spec_id: u64) -> Option<u64> {
    const MAP: &[(u64, u64)] = &[
        (71, 1),
        (72, 1),
        (73, 1),
        (65, 2),
        (66, 2),
        (70, 2),
        (253, 3),
        (254, 3),
        (255, 3),
        (259, 4),
        (260, 4),
        (261, 4),
        (256, 5),
        (257, 5),
        (258, 5),
        (250, 6),
        (251, 6),
        (252, 6),
        (262, 7),
        (263, 7),
        (264, 7),
        (62, 8),
        (63, 8),
        (64, 8),
        (265, 9),
        (266, 9),
        (267, 9),
        (268, 10),
        (269, 10),
        (270, 10),
        (102, 11),
        (103, 11),
        (104, 11),
        (105, 11),
        (577, 12),
        (581, 12),
        (1467, 13),
        (1468, 13),
        (1473, 13),
    ];
    MAP.iter()
        .find(|(sid, _)| *sid == spec_id)
        .map(|(_, cid)| *cid)
}

// ---- Detection ----

/// Detect the character class from a simc input string.
pub fn detect_class(simc_input: &str) -> Option<String> {
    let classes = CLASSES.read().unwrap();
    let mut names: Vec<String> = classes
        .iter()
        .flat_map(|c| std::iter::once(c.name.clone()).chain(c.aliases.iter().cloned()))
        .collect();

    // Fallback list for environments where class metadata failed to load.
    if names.is_empty() {
        names = vec![
            "warrior".to_string(),
            "paladin".to_string(),
            "hunter".to_string(),
            "rogue".to_string(),
            "priest".to_string(),
            "death_knight".to_string(),
            "deathknight".to_string(),
            "shaman".to_string(),
            "mage".to_string(),
            "warlock".to_string(),
            "monk".to_string(),
            "druid".to_string(),
            "demon_hunter".to_string(),
            "demonhunter".to_string(),
            "evoker".to_string(),
        ];
    }

    // Escape names to avoid regex metacharacter surprises and match case-insensitively.
    let escaped = names
        .iter()
        .map(|n| regex::escape(n))
        .collect::<Vec<_>>()
        .join("|");
    let pattern = format!(r#"(?i)^({})\s*="#, escaped);
    let class_re = Regex::new(&pattern).unwrap();

    for line in simc_input.lines() {
        // Be tolerant of clipboard-introduced leading markers (BOM, zero-width, bidi marks).
        let normalized = line
            .trim()
            .trim_start_matches('\u{feff}')
            .trim_start_matches('\u{200b}')
            .trim_start_matches('\u{200e}')
            .trim_start_matches('\u{200f}');

        if let Some(caps) = class_re.captures(normalized) {
            return Some(caps[1].to_lowercase());
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
