use serde_json::{json, Value};
use std::path::Path;

use super::super::types::EnchantOptionsQuery;

pub(super) fn read_runtime_array(root: Option<&Path>, file_names: &[&str]) -> Option<Vec<Value>> {
    let root = root?;
    for file_name in file_names {
        let path = root.join(file_name);
        let Ok(file) = std::fs::File::open(path) else {
            continue;
        };
        if let Ok(values) = serde_json::from_reader(std::io::BufReader::new(file)) {
            return Some(values);
        }
    }
    None
}

pub(super) fn enchant_name(entry: &Value) -> String {
    entry
        .get("itemName")
        .and_then(|v| v.as_str())
        .or_else(|| entry.get("displayName").and_then(|v| v.as_str()))
        .unwrap_or_default()
        .to_string()
}

pub(super) fn enchant_icon(entry: &Value) -> String {
    entry
        .get("itemIcon")
        .and_then(|v| v.as_str())
        .or_else(|| entry.get("spellIcon").and_then(|v| v.as_str()))
        .unwrap_or("inv_misc_questionmark")
        .to_string()
}

pub(super) fn enchant_info_from_files(root: Option<&Path>, enchant_id: u64) -> Option<Value> {
    read_runtime_array(root, &["enchantments.json", "enchantments-all.json"])?
        .into_iter()
        .find(|entry| {
            entry.get("id").and_then(|v| v.as_u64()) == Some(enchant_id)
                || entry.get("itemId").and_then(|v| v.as_u64()) == Some(enchant_id)
        })
        .map(|entry| {
            json!({
                "enchant_id": enchant_id,
                "name": enchant_name(&entry),
                "icon": enchant_icon(&entry),
                "item_id": entry.get("itemId").and_then(|v| v.as_u64()).unwrap_or(0),
                "quality": entry.get("quality").and_then(|v| v.as_u64()).unwrap_or(3),
            })
        })
}

pub(super) fn gem_info_from_files(root: Option<&Path>, gem_id: u64) -> Option<Value> {
    if let Some(gems) = read_runtime_array(root, &["gems.json"]) {
        if let Some(entry) = gems
            .into_iter()
            .find(|entry| entry.get("id").and_then(|v| v.as_u64()) == Some(gem_id))
        {
            return Some(json!({
                "gem_id": gem_id,
                "name": entry.get("name").and_then(|v| v.as_str()).unwrap_or_default(),
                "icon": entry.get("icon").and_then(|v| v.as_str()).unwrap_or("inv_misc_questionmark"),
                "quality": entry.get("quality").and_then(|v| v.as_u64()).unwrap_or(3),
            }));
        }
    }

    read_runtime_array(root, &["enchantments.json", "enchantments-all.json"])?
        .into_iter()
        .find(|entry| {
            entry.get("itemId").and_then(|v| v.as_u64()) == Some(gem_id)
                || entry.get("id").and_then(|v| v.as_u64()) == Some(gem_id)
        })
        .map(|entry| {
            json!({
                "gem_id": gem_id,
                "name": enchant_name(&entry),
                "icon": enchant_icon(&entry),
                "quality": entry.get("quality").and_then(|v| v.as_u64()).unwrap_or(3),
            })
        })
}

pub(super) fn list_enchants_for_slot_from_files(
    root: Option<&Path>,
    inv_type: u64,
) -> Option<Vec<Value>> {
    let mask = 1u64 << inv_type;
    let mut matching: Vec<Value> =
        read_runtime_array(root, &["enchantments.json", "enchantments-all.json"])?
            .into_iter()
            .filter(|entry| entry.get("slot").and_then(|v| v.as_str()) != Some("socket"))
            .filter(|entry| {
                let Some(reqs) = entry.get("equipRequirements") else {
                    return false;
                };
                let type_mask = reqs
                    .get("invTypeMask")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                if type_mask == 0 {
                    let item_class = reqs.get("itemClass").and_then(|v| v.as_u64()).unwrap_or(0);
                    if inv_type == 13 || inv_type == 17 || inv_type == 21 || inv_type == 22 {
                        return item_class == 2;
                    }
                    return false;
                }
                (type_mask & mask) != 0
            })
            .collect();

    let latest_expansion = matching
        .iter()
        .filter_map(|entry| entry.get("expansion").and_then(|v| v.as_u64()))
        .max()
        .unwrap_or(0);
    if latest_expansion > 0 {
        matching.retain(|entry| {
            entry.get("expansion").and_then(|v| v.as_u64()) == Some(latest_expansion)
        });
    }

    Some(
        matching
            .into_iter()
            .map(|entry| {
                let id = entry.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
                json!({
                    "id": id,
                    "enchant_id": id,
                    "name": enchant_name(&entry),
                    "displayName": entry.get("displayName").cloned(),
                    "baseDisplayName": entry.get("baseDisplayName").cloned(),
                    "categoryName": entry.get("categoryName").cloned(),
                    "itemId": entry.get("itemId").cloned(),
                    "itemName": entry.get("itemName").cloned(),
                    "itemIcon": entry.get("itemIcon").cloned(),
                    "spellIcon": entry.get("spellIcon").cloned(),
                    "quality": entry.get("quality").and_then(|v| v.as_u64()).unwrap_or(3),
                    "expansion": entry.get("expansion").cloned(),
                    "craftingQuality": entry.get("craftingQuality").cloned(),
                    "slot": entry.get("slot").cloned(),
                })
            })
            .collect(),
    )
}

pub(super) fn current_season_label() -> String {
    crate::item_db::season_cfg()
        .get("season")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .or_else(|| {
            crate::item_db::get_runtime_data()
                .get("season_name")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
        })
        .unwrap_or_default()
}

pub(super) fn slot_has_active_expansion_enchants(query: &EnchantOptionsQuery) -> bool {
    let normalized = query.slot.trim().to_ascii_lowercase();
    let season_label = current_season_label().to_ascii_lowercase();

    if season_label.contains("midnight") && matches!(normalized.as_str(), "back" | "wrist") {
        return false;
    }

    true
}

pub(super) fn is_ranged_inventory_type(inv_type: u64) -> bool {
    matches!(inv_type, 15 | 21 | 26)
}

pub(super) fn normalized_spec_name(raw: &str) -> String {
    raw.trim().to_ascii_lowercase().replace([' ', '-'], "_")
}

pub(super) fn is_healer_spec(spec: &str) -> bool {
    matches!(
        normalized_spec_name(spec).as_str(),
        "restoration" | "holy" | "discipline" | "mistweaver" | "preservation"
    )
}

pub(super) fn is_tank_spec(spec: &str) -> bool {
    matches!(
        normalized_spec_name(spec).as_str(),
        "blood" | "protection" | "guardian" | "vengeance" | "brewmaster"
    )
}

pub(super) fn spec_primary_stats(class_name: &str, spec: &str) -> Vec<u64> {
    crate::types::class_data::spec_weapon_profile(class_name, spec)
        .map(|profile| profile.primary_stats)
        .unwrap_or_default()
}

pub(super) fn filter_spec_incompatible_enchants(
    options: &mut Vec<Value>,
    item_inventory_type: Option<u64>,
    class_name: &str,
    spec: &str,
) {
    let is_ranged_weapon = item_inventory_type.is_some_and(is_ranged_inventory_type);
    let healer_spec = is_healer_spec(spec);
    let tank_spec = is_tank_spec(spec);
    let primary_stats = spec_primary_stats(class_name, spec);
    let uses_intellect = primary_stats.contains(&5);
    let uses_agi_or_str = primary_stats.contains(&3) || primary_stats.contains(&4);

    options.retain(|opt| {
        let name = opt
            .get("itemName")
            .and_then(|v| v.as_str())
            .or_else(|| opt.get("name").and_then(|v| v.as_str()))
            .unwrap_or_default();

        if matches!(name, "Farstrider's Hawkeye" | "Smuggler's Lynxeye") {
            return is_ranged_weapon;
        }
        if name == "Worldsoul Cradle" {
            return healer_spec;
        }
        if name == "Worldsoul Aegis" {
            return tank_spec;
        }

        let effect_key = opt
            .get("effectKey")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_ascii_lowercase();

        if effect_key.contains("agility or strength") {
            return uses_agi_or_str;
        }
        if effect_key.contains("intellect") {
            return uses_intellect;
        }

        true
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn enchant_and_gem_info_read_runtime_files_with_expected_fallback_fields() {
        let dir = tempdir().expect("temp dir");
        std::fs::write(
            dir.path().join("enchantments.json"),
            serde_json::to_vec(&vec![
                json!({
                    "id": 1001,
                    "itemId": 2001,
                    "displayName": "Authority of Frost",
                    "spellIcon": "spell_frost_frostbolt02",
                    "quality": 5
                }),
                json!({
                    "id": 3001,
                    "itemId": 4001,
                    "itemName": "Deadly Ruby",
                    "itemIcon": "inv_jewelcrafting_gem_35",
                    "quality": 4
                }),
            ])
            .expect("enchantments json"),
        )
        .expect("write enchantments");
        std::fs::write(
            dir.path().join("gems.json"),
            serde_json::to_vec(&vec![json!({
                "id": 5001,
                "name": "Quick Sapphire",
                "icon": "inv_misc_gem_sapphire_02",
                "quality": 3
            })])
            .expect("gems json"),
        )
        .expect("write gems");

        let enchant = enchant_info_from_files(Some(dir.path()), 2001).expect("enchant");
        assert_eq!(
            enchant.get("name").and_then(Value::as_str),
            Some("Authority of Frost")
        );
        assert_eq!(
            enchant.get("icon").and_then(Value::as_str),
            Some("spell_frost_frostbolt02")
        );
        assert_eq!(enchant.get("quality").and_then(Value::as_u64), Some(5));

        let gem = gem_info_from_files(Some(dir.path()), 5001).expect("gem");
        assert_eq!(
            gem.get("name").and_then(Value::as_str),
            Some("Quick Sapphire")
        );
        assert_eq!(
            gem.get("icon").and_then(Value::as_str),
            Some("inv_misc_gem_sapphire_02")
        );

        let gem_fallback = gem_info_from_files(Some(dir.path()), 4001).expect("fallback gem");
        assert_eq!(
            gem_fallback.get("name").and_then(Value::as_str),
            Some("Deadly Ruby")
        );
        assert_eq!(gem_fallback.get("quality").and_then(Value::as_u64), Some(4));
    }

    #[test]
    fn list_enchants_for_slot_filters_by_inventory_mask_and_latest_expansion() {
        let dir = tempdir().expect("temp dir");
        std::fs::write(
            dir.path().join("enchantments.json"),
            serde_json::to_vec(&vec![
                json!({
                    "id": 1,
                    "itemName": "Old Blade",
                    "itemIcon": "old_icon",
                    "expansion": 10,
                    "equipRequirements": {"invTypeMask": 1u64 << 13}
                }),
                json!({
                    "id": 2,
                    "itemName": "New Blade",
                    "itemIcon": "new_icon",
                    "expansion": 11,
                    "equipRequirements": {"invTypeMask": 1u64 << 13}
                }),
                json!({
                    "id": 3,
                    "itemName": "Socketed Gem",
                    "slot": "socket",
                    "expansion": 11,
                    "equipRequirements": {"invTypeMask": 1u64 << 13}
                }),
                json!({
                    "id": 4,
                    "itemName": "Shield Enchant",
                    "expansion": 11,
                    "equipRequirements": {"invTypeMask": 1u64 << 14}
                }),
            ])
            .expect("enchantments json"),
        )
        .expect("write enchantments");

        let options =
            list_enchants_for_slot_from_files(Some(dir.path()), 13).expect("weapon enchants");
        assert_eq!(options.len(), 1);
        assert_eq!(
            options[0].get("name").and_then(Value::as_str),
            Some("New Blade")
        );
        assert_eq!(options[0].get("quality").and_then(Value::as_u64), Some(3));
    }

    #[test]
    fn list_enchants_for_weapon_slot_accepts_legacy_weapon_class_requirements() {
        let dir = tempdir().expect("temp dir");
        std::fs::write(
            dir.path().join("enchantments.json"),
            serde_json::to_vec(&vec![
                json!({
                    "id": 10,
                    "itemName": "Legacy Weapon Oil",
                    "expansion": 11,
                    "equipRequirements": {"itemClass": 2}
                }),
                json!({
                    "id": 11,
                    "itemName": "Legacy Armor Thread",
                    "expansion": 11,
                    "equipRequirements": {"itemClass": 4}
                }),
            ])
            .expect("enchantments json"),
        )
        .expect("write enchantments");

        let weapon_options =
            list_enchants_for_slot_from_files(Some(dir.path()), 13).expect("weapon enchants");
        assert_eq!(weapon_options.len(), 1);
        assert_eq!(
            weapon_options[0].get("name").and_then(Value::as_str),
            Some("Legacy Weapon Oil")
        );

        let armor_options =
            list_enchants_for_slot_from_files(Some(dir.path()), 1).expect("armor enchants");
        assert!(armor_options.is_empty());
    }

    #[test]
    fn filter_spec_incompatible_enchants_respects_weapon_role_and_primary_stat_rules() {
        let mut options = vec![
            json!({"name": "Farstrider's Hawkeye"}),
            json!({"name": "Worldsoul Cradle"}),
            json!({"name": "Worldsoul Aegis"}),
            json!({"name": "Neutral Enchant"}),
        ];

        filter_spec_incompatible_enchants(&mut options, Some(15), "mage", "arcane");

        let names: Vec<_> = options
            .iter()
            .filter_map(|option| option.get("name").and_then(Value::as_str))
            .collect();
        assert!(names.contains(&"Farstrider's Hawkeye"));
        assert!(!names.contains(&"Worldsoul Cradle"));
        assert!(!names.contains(&"Worldsoul Aegis"));
        assert!(names.contains(&"Neutral Enchant"));
    }

    #[test]
    fn role_helpers_normalize_common_healer_and_tank_names() {
        assert!(is_healer_spec("holy"));
        assert!(is_healer_spec("mistweaver"));
        assert!(is_tank_spec("protection"));
        assert!(is_tank_spec("guardian"));
        assert_eq!(
            normalized_spec_name("  Preservation Evoker "),
            "preservation_evoker"
        );
    }
}
