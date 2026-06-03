use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

use crate::server::types::SimOptions;

struct ExternalBuffScenario {
    label: String,
    lines: Vec<String>,
}

struct ConsumableScenario {
    label: String,
    category: String,
    token: String,
    lines: Vec<String>,
}

pub(super) type ComboMetadata = HashMap<String, Vec<Value>>;
pub(super) type MatrixBuildResult = Result<(String, usize, ComboMetadata), String>;

pub(super) fn sanitize_matrix_token(input: &str) -> Option<String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return None;
    }
    let ok = trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.' | '/' | ':' | '+'));
    if ok {
        Some(trimmed.to_string())
    } else {
        None
    }
}

pub(super) fn top_gear_consumables_from_options(
    options: &SimOptions,
) -> Option<crate::profileset_generator::TopGearConsumableMatrix> {
    let sanitize = |items: &[String]| -> Vec<String> {
        items
            .iter()
            .filter_map(|raw| sanitize_matrix_token(raw))
            .filter(|token| !token.trim().is_empty())
            .collect()
    };

    let flasks = sanitize(&options.consumable_matrix_flasks);
    let foods = sanitize(&options.consumable_matrix_foods);
    let potions = sanitize(&options.consumable_matrix_potions);
    let augmentations = sanitize(&options.consumable_matrix_augmentations);
    let temporary_enchants = sanitize(&options.consumable_matrix_temporary_enchants)
        .into_iter()
        .filter(|token| !token.starts_with("off_hand:"))
        .collect::<Vec<_>>();

    if flasks.is_empty()
        && foods.is_empty()
        && potions.is_empty()
        && augmentations.is_empty()
        && temporary_enchants.is_empty()
    {
        return None;
    }

    Some(crate::profileset_generator::TopGearConsumableMatrix {
        flasks,
        foods,
        potions,
        augmentations,
        temporary_enchants,
    })
}

fn raid_buff_line(buff_key: &str) -> Option<&'static str> {
    match buff_key {
        "bloodlust" => Some("override.bloodlust=1"),
        "arcane_intellect" => Some("override.arcane_intellect=1"),
        "power_word_fortitude" => Some("override.power_word_fortitude=1"),
        "battle_shout" => Some("override.battle_shout=1"),
        "mark_of_the_wild" => Some("override.mark_of_the_wild=1"),
        "hunters_mark" => Some("override.hunters_mark=1"),
        "bleeding" => Some("override.bleeding=1"),
        "chaos_brand" => Some("override.chaos_brand=1"),
        "mystic_touch" => Some("override.mystic_touch=1"),
        "skyfury" => Some("override.skyfury=1"),
        "power_infusion" => Some("external_buffs.power_infusion=0/120/240"),
        "blessing_of_bronze" => Some("override.blessing_of_the_bronze=1"),
        _ => None,
    }
}

pub(super) fn build_external_buff_matrix_input(
    simc_input: &str,
    options: &SimOptions,
) -> MatrixBuildResult {
    let (base_lines, equipped_gear, talents, _spec) =
        crate::profileset_generator::parser::parse_base_profile(simc_input);

    let mut scenarios: Vec<ExternalBuffScenario> = Vec::new();
    if options.external_buff_chaos_brand {
        scenarios.push(ExternalBuffScenario {
            label: "Chaos Brand".to_string(),
            lines: vec!["override.chaos_brand=1".to_string()],
        });
    }
    if options.external_buff_mystic_touch {
        scenarios.push(ExternalBuffScenario {
            label: "Mystic Touch".to_string(),
            lines: vec!["override.mystic_touch=1".to_string()],
        });
    }
    if options.external_buff_skyfury {
        scenarios.push(ExternalBuffScenario {
            label: "Skyfury".to_string(),
            lines: vec!["override.skyfury=1".to_string()],
        });
    }
    if options.external_buff_power_infusion {
        scenarios.push(ExternalBuffScenario {
            label: "Power Infusion".to_string(),
            lines: vec!["external_buffs.power_infusion=0/120/240".to_string()],
        });
    }
    if options.external_buff_blessing_of_bronze {
        scenarios.push(ExternalBuffScenario {
            label: "Blessing of Bronze".to_string(),
            lines: vec!["override.blessing_of_the_bronze=1".to_string()],
        });
    }
    if options.external_buff_augmentation {
        scenarios.push(ExternalBuffScenario {
            label: "Augmentation Evoker Buffs".to_string(),
            lines: vec![
                "override.blessing_of_the_bronze=1".to_string(),
                "dragonflight.brilliance_party=1".to_string(),
            ],
        });
    }

    if scenarios.is_empty() {
        return Err("Select at least one external buff for the matrix.".to_string());
    }

    let mut lines: Vec<String> = Vec::new();
    let mut combo_metadata: ComboMetadata = HashMap::new();
    lines.push("optimal_raid=0".to_string());
    lines.push(String::new());
    lines.push("# Base Actor".to_string());
    lines.extend(base_lines);
    lines.push("### Combo 1".to_string());
    for slot in crate::types::class_data::GEAR_SLOTS {
        if let Some(gear) = equipped_gear.get(*slot) {
            lines.push(format!("{}={}", slot, gear));
        } else if *slot == "off_hand" {
            lines.push("off_hand=,".to_string());
        }
    }
    if !talents.is_empty() {
        lines.push(format!("talents={}", talents));
    }
    lines.push(String::new());

    let mut combo_index = 2usize;
    for scenario in scenarios {
        let combo_name = format!("External Buff {} | {}", combo_index - 1, scenario.label);
        lines.push(format!("### {}", combo_name));
        for line in scenario.lines {
            lines.push(format!("profileset.\"{}\"+={}", combo_name, line));
        }
        if !talents.is_empty() {
            lines.push(format!(
                "profileset.\"{}\"+=talents={}",
                combo_name, talents
            ));
        }
        lines.push(String::new());

        combo_metadata.insert(
            combo_name.clone(),
            vec![json!({
                "external_buff": scenario.label,
                "heatmap_kind": "external_buff",
                "is_kept": false
            })],
        );
        combo_index += 1;
    }

    Ok((
        lines.join("\n"),
        combo_index.saturating_sub(2),
        combo_metadata,
    ))
}

pub(super) fn build_consumable_matrix_input(
    simc_input: &str,
    options: &SimOptions,
) -> MatrixBuildResult {
    let (base_lines, equipped_gear, talents, _spec) =
        crate::profileset_generator::parser::parse_base_profile(simc_input);

    let mut scenarios: Vec<ConsumableScenario> = Vec::new();
    let mut seen = HashSet::<String>::new();

    for raw in &options.consumable_matrix_flasks {
        if let Some(token) = sanitize_matrix_token(raw) {
            let dedupe_key = format!("flask:{}", token);
            if !seen.insert(dedupe_key) {
                continue;
            }
            scenarios.push(ConsumableScenario {
                label: format!("Flask: {}", token),
                category: "flask".to_string(),
                token: token.clone(),
                lines: vec![format!("flask={}", token)],
            });
        }
    }
    for raw in &options.consumable_matrix_foods {
        if let Some(token) = sanitize_matrix_token(raw) {
            let dedupe_key = format!("food:{}", token);
            if !seen.insert(dedupe_key) {
                continue;
            }
            scenarios.push(ConsumableScenario {
                label: format!("Food: {}", token),
                category: "food".to_string(),
                token: token.clone(),
                lines: vec![format!("food={}", token)],
            });
        }
    }
    for raw in &options.consumable_matrix_potions {
        if let Some(token) = sanitize_matrix_token(raw) {
            let dedupe_key = format!("potion:{}", token);
            if !seen.insert(dedupe_key) {
                continue;
            }
            scenarios.push(ConsumableScenario {
                label: format!("Potion: {}", token),
                category: "potion".to_string(),
                token: token.clone(),
                lines: vec![format!("potion={}", token)],
            });
        }
    }
    for raw in &options.consumable_matrix_augmentations {
        if let Some(token) = sanitize_matrix_token(raw) {
            let dedupe_key = format!("augmentation:{}", token);
            if !seen.insert(dedupe_key) {
                continue;
            }
            scenarios.push(ConsumableScenario {
                label: format!("Augmentation: {}", token),
                category: "augmentation".to_string(),
                token: token.clone(),
                lines: vec![format!("augmentation={}", token)],
            });
        }
    }
    for raw in &options.consumable_matrix_temporary_enchants {
        if let Some(token) = sanitize_matrix_token(raw) {
            if token.starts_with("off_hand:") {
                continue;
            }
            let dedupe_key = format!("temporary_enchant:{}", token);
            if !seen.insert(dedupe_key) {
                continue;
            }
            scenarios.push(ConsumableScenario {
                label: format!("Temp Enchant: {}", token),
                category: "temporary_enchant".to_string(),
                token: token.clone(),
                lines: vec![format!("temporary_enchant={}", token)],
            });
        }
    }
    for raw in &options.consumable_matrix_raid_buffs {
        let key = raw.trim();
        if key.is_empty() {
            continue;
        }
        if let Some(line) = raid_buff_line(key) {
            let dedupe_key = format!("raid_buff:{}", key);
            if !seen.insert(dedupe_key) {
                continue;
            }
            scenarios.push(ConsumableScenario {
                label: format!("Raid Buff: {}", key),
                category: "raid_buff".to_string(),
                token: key.to_string(),
                lines: vec![line.to_string()],
            });
        }
    }

    if scenarios.is_empty() {
        return Err("Select at least one consumable or raid buff to compare.".to_string());
    }

    let mut lines: Vec<String> = Vec::new();
    let mut combo_metadata: ComboMetadata = HashMap::new();
    lines.push(String::new());
    lines.push("# Base Actor".to_string());

    let base_lines_filtered: Vec<String> = base_lines
        .into_iter()
        .filter(|line| {
            let l = line.trim().to_lowercase();
            if l.starts_with("food=")
                || l.starts_with("flask=")
                || l.starts_with("potion=")
                || l.starts_with("augmentation=")
                || l.starts_with("temporary_enchant=")
                || l.starts_with("feast=")
            {
                return false;
            }
            if l.starts_with("optimal_raid=") || l.starts_with("party_buffs=") {
                return false;
            }
            if l.starts_with("override.bloodlust=")
                || l.starts_with("override.arcane_intellect=")
                || l.starts_with("override.power_word_fortitude=")
                || l.starts_with("override.battle_shout=")
                || l.starts_with("override.mark_of_the_wild=")
                || l.starts_with("override.hunters_mark=")
                || l.starts_with("override.bleeding=")
                || l.starts_with("override.chaos_brand=")
                || l.starts_with("override.mystic_touch=")
                || l.starts_with("override.skyfury=")
                || l.starts_with("override.blessing_of_the_bronze=")
                || l.starts_with("external_buffs.power_infusion=")
            {
                return false;
            }
            true
        })
        .collect();

    lines.extend(base_lines_filtered);
    lines.push("optimal_raid=0".to_string());
    lines.push("party_buffs=0".to_string());
    lines.push("flask=".to_string());
    lines.push("food=".to_string());
    lines.push("potion=".to_string());
    lines.push("augmentation=".to_string());
    lines.push("temporary_enchant=".to_string());
    lines.push("override.bloodlust=0".to_string());
    lines.push("override.arcane_intellect=0".to_string());
    lines.push("override.power_word_fortitude=0".to_string());
    lines.push("override.battle_shout=0".to_string());
    lines.push("override.mark_of_the_wild=0".to_string());
    lines.push("override.hunters_mark=0".to_string());
    lines.push("override.bleeding=0".to_string());
    lines.push("override.chaos_brand=0".to_string());
    lines.push("override.mystic_touch=0".to_string());
    lines.push("override.skyfury=0".to_string());
    lines.push("override.blessing_of_the_bronze=0".to_string());
    lines.push("external_buffs.power_infusion=".to_string());

    lines.push("### Combo 1".to_string());
    for slot in crate::types::class_data::GEAR_SLOTS {
        if let Some(gear) = equipped_gear.get(*slot) {
            lines.push(format!("{}={}", slot, gear));
        } else if *slot == "off_hand" {
            lines.push("off_hand=,".to_string());
        }
    }
    if !talents.is_empty() {
        lines.push(format!("talents={}", talents));
    }
    lines.push(String::new());

    let mut combo_index = 2usize;
    for scenario in scenarios {
        let combo_name = format!("Consumable {} | {}", combo_index - 1, scenario.label);
        lines.push(format!("### {}", combo_name));
        for line in scenario.lines {
            lines.push(format!("profileset.\"{}\"+={}", combo_name, line));
        }
        if !talents.is_empty() {
            lines.push(format!(
                "profileset.\"{}\"+=talents={}",
                combo_name, talents
            ));
        }
        lines.push(String::new());
        combo_metadata.insert(
            combo_name.clone(),
            vec![json!({
                "consumable_category": scenario.category,
                "consumable_token": scenario.token,
                "heatmap_kind": "consumable",
                "is_kept": false
            })],
        );
        combo_index += 1;
    }

    Ok((
        lines.join("\n"),
        combo_index.saturating_sub(2),
        combo_metadata,
    ))
}
#[test]
fn sanitize_matrix_token_accepts_only_simc_safe_tokens() {
    assert_eq!(
        sanitize_matrix_token("  main_hand:123/bonus+foo  "),
        Some("main_hand:123/bonus+foo".to_string())
    );

    assert_eq!(
        sanitize_matrix_token("abc.DEF-123_foo/bar+baz:slot"),
        Some("abc.DEF-123_foo/bar+baz:slot".to_string())
    );
    assert_eq!(sanitize_matrix_token(""), None);
    assert_eq!(sanitize_matrix_token("   "), None);
    assert_eq!(sanitize_matrix_token("bad token"), None);
    assert_eq!(sanitize_matrix_token("bad;token"), None);
    assert_eq!(sanitize_matrix_token("bad=token"), None);
    assert_eq!(sanitize_matrix_token("bad,token"), None);
}

#[test]
fn top_gear_consumables_from_options_returns_none_when_all_inputs_are_empty_or_invalid() {
    let mut options: SimOptions = serde_json::from_value(json!({})).expect("options");

    options.consumable_matrix_flasks = vec!["".to_string(), "bad token".to_string()];
    options.consumable_matrix_foods = vec![" ".to_string()];
    options.consumable_matrix_potions = vec!["bad;token".to_string()];
    options.consumable_matrix_augmentations = vec![];
    options.consumable_matrix_temporary_enchants =
        vec!["off_hand:123".to_string(), "bad token".to_string()];

    assert!(top_gear_consumables_from_options(&options).is_none());
}

#[test]
fn top_gear_consumables_from_options_sanitizes_and_drops_offhand_temp_enchants() {
    let mut options: SimOptions = serde_json::from_value(json!({})).expect("options");

    options.consumable_matrix_flasks = vec![" flask_a ".to_string(), "bad token".to_string()];
    options.consumable_matrix_foods = vec!["food-a".to_string()];
    options.consumable_matrix_potions = vec!["potion.1".to_string()];
    options.consumable_matrix_augmentations = vec!["aug/1".to_string()];
    options.consumable_matrix_temporary_enchants =
        vec!["main_hand:123".to_string(), "off_hand:456".to_string()];

    let matrix = top_gear_consumables_from_options(&options).expect("matrix");

    assert_eq!(matrix.flasks, vec!["flask_a"]);
    assert_eq!(matrix.foods, vec!["food-a"]);
    assert_eq!(matrix.potions, vec!["potion.1"]);
    assert_eq!(matrix.augmentations, vec!["aug/1"]);
    assert_eq!(matrix.temporary_enchants, vec!["main_hand:123"]);
}

#[test]
fn build_external_buff_matrix_requires_selection() {
    let options: SimOptions = serde_json::from_value(json!({})).expect("options");

    assert_eq!(
        build_external_buff_matrix_input("warrior=\"Tester\"\nspec=fury\n", &options).unwrap_err(),
        "Select at least one external buff for the matrix."
    );
}

#[test]
fn build_external_buff_matrix_emits_one_profileset_per_selected_buff() {
    let simc = "warrior=\"Tester\"\nspec=fury\ntalents=abc\nmain_hand=item,id=1\n";
    let mut options: SimOptions = serde_json::from_value(json!({})).expect("options");

    options.external_buff_chaos_brand = true;
    options.external_buff_mystic_touch = true;
    options.external_buff_skyfury = true;
    options.external_buff_power_infusion = true;
    options.external_buff_blessing_of_bronze = true;
    options.external_buff_augmentation = true;

    let (input, combo_count, metadata) =
        build_external_buff_matrix_input(simc, &options).expect("matrix input");

    assert_eq!(combo_count, 6);
    assert!(input.contains("optimal_raid=0"));
    assert!(input.contains("# Base Actor"));
    assert!(input.contains("### Combo 1"));
    assert!(input.contains("main_hand=item,id=1"));
    assert!(input.contains("talents=abc"));

    assert!(input.contains("External Buff 1 | Chaos Brand"));
    assert!(input.contains("profileset.\"External Buff 1 | Chaos Brand\"+=override.chaos_brand=1"));

    assert!(input.contains("External Buff 2 | Mystic Touch"));
    assert!(
        input.contains("profileset.\"External Buff 2 | Mystic Touch\"+=override.mystic_touch=1")
    );

    assert!(input.contains("External Buff 3 | Skyfury"));
    assert!(input.contains("profileset.\"External Buff 3 | Skyfury\"+=override.skyfury=1"));

    assert!(input.contains("External Buff 4 | Power Infusion"));
    assert!(input.contains(
        "profileset.\"External Buff 4 | Power Infusion\"+=external_buffs.power_infusion=0/120/240"
    ));

    assert!(input.contains("External Buff 5 | Blessing of Bronze"));
    assert!(input.contains(
        "profileset.\"External Buff 5 | Blessing of Bronze\"+=override.blessing_of_the_bronze=1"
    ));

    assert!(input.contains("External Buff 6 | Augmentation Evoker Buffs"));
    assert!(input.contains("profileset.\"External Buff 6 | Augmentation Evoker Buffs\"+=dragonflight.brilliance_party=1"));

    assert_eq!(metadata.len(), 6);
    assert_eq!(
        metadata["External Buff 4 | Power Infusion"][0]["external_buff"],
        json!("Power Infusion")
    );
    assert_eq!(
        metadata["External Buff 4 | Power Infusion"][0]["heatmap_kind"],
        json!("external_buff")
    );
    assert_eq!(
        metadata["External Buff 4 | Power Infusion"][0]["is_kept"],
        json!(false)
    );
}

#[test]
fn build_external_buff_matrix_inserts_empty_offhand_when_missing() {
    let simc = "warrior=\"Tester\"\nspec=fury\ntalents=abc\nmain_hand=item,id=1\n";
    let mut options: SimOptions = serde_json::from_value(json!({})).expect("options");

    options.external_buff_power_infusion = true;

    let (input, _, _) = build_external_buff_matrix_input(simc, &options).expect("matrix input");

    assert!(input.contains("off_hand=,"));
}

#[test]
fn build_consumable_matrix_requires_selection() {
    let options: SimOptions = serde_json::from_value(json!({})).expect("options");

    assert_eq!(
        build_consumable_matrix_input("warrior=\"Tester\"\nspec=fury\n", &options).unwrap_err(),
        "Select at least one consumable or raid buff to compare."
    );
}

#[test]
fn build_consumable_matrix_emits_all_categories_and_metadata() {
    let simc = "\
warrior=\"Tester\"
spec=fury
talents=abc
main_hand=item,id=1
flask=old
food=old
potion=old
augmentation=old
temporary_enchant=old
feast=1
optimal_raid=1
party_buffs=1
override.bloodlust=1
override.arcane_intellect=1
external_buffs.power_infusion=0/120/240
";

    let mut options: SimOptions = serde_json::from_value(json!({})).expect("options");

    options.consumable_matrix_flasks = vec!["flask_a".to_string(), "flask_a".to_string()];
    options.consumable_matrix_foods = vec!["food_a".to_string()];
    options.consumable_matrix_potions = vec!["potion_a".to_string()];
    options.consumable_matrix_augmentations = vec!["aug_a".to_string()];
    options.consumable_matrix_temporary_enchants =
        vec!["main_hand:123".to_string(), "off_hand:456".to_string()];
    options.consumable_matrix_raid_buffs = vec![
        "bloodlust".to_string(),
        "arcane_intellect".to_string(),
        "unknown".to_string(),
        "bloodlust".to_string(),
    ];

    let (input, combo_count, metadata) =
        build_consumable_matrix_input(simc, &options).expect("matrix input");

    assert_eq!(combo_count, 7);

    assert!(!input.contains("flask=old"));
    assert!(!input.contains("food=old"));
    assert!(!input.contains("potion=old"));
    assert!(!input.contains("augmentation=old"));
    assert!(!input.contains("temporary_enchant=old"));
    assert!(!input.contains("feast=1"));
    assert!(!input.contains("optimal_raid=1"));
    assert!(!input.contains("party_buffs=1"));
    assert!(!input.contains("external_buffs.power_infusion=0/120/240"));

    assert!(input.contains("optimal_raid=0"));
    assert!(input.contains("party_buffs=0"));
    assert!(input.contains("flask="));
    assert!(input.contains("food="));
    assert!(input.contains("potion="));
    assert!(input.contains("augmentation="));
    assert!(input.contains("temporary_enchant="));
    assert!(input.contains("override.bloodlust=0"));
    assert!(input.contains("override.arcane_intellect=0"));
    assert!(input.contains("external_buffs.power_infusion="));

    assert!(input.contains("profileset.\"Consumable 1 | Flask: flask_a\"+=flask=flask_a"));
    assert!(input.contains("profileset.\"Consumable 2 | Food: food_a\"+=food=food_a"));
    assert!(input.contains("profileset.\"Consumable 3 | Potion: potion_a\"+=potion=potion_a"));
    assert!(input.contains("profileset.\"Consumable 4 | Augmentation: aug_a\"+=augmentation=aug_a"));
    assert!(input.contains("profileset.\"Consumable 5 | Temp Enchant: main_hand:123\"+=temporary_enchant=main_hand:123"));
    assert!(
        input.contains("profileset.\"Consumable 6 | Raid Buff: bloodlust\"+=override.bloodlust=1")
    );
    assert!(input.contains(
        "profileset.\"Consumable 7 | Raid Buff: arcane_intellect\"+=override.arcane_intellect=1"
    ));

    assert_eq!(metadata.len(), 7);
    assert_eq!(
        metadata["Consumable 1 | Flask: flask_a"][0]["consumable_category"],
        json!("flask")
    );
    assert_eq!(
        metadata["Consumable 5 | Temp Enchant: main_hand:123"][0]["consumable_category"],
        json!("temporary_enchant")
    );
    assert_eq!(
        metadata["Consumable 6 | Raid Buff: bloodlust"][0]["consumable_token"],
        json!("bloodlust")
    );
    assert_eq!(
        metadata["Consumable 6 | Raid Buff: bloodlust"][0]["heatmap_kind"],
        json!("consumable")
    );
    assert_eq!(
        metadata["Consumable 6 | Raid Buff: bloodlust"][0]["is_kept"],
        json!(false)
    );
}

#[test]
fn build_consumable_matrix_supports_all_known_raid_buffs() {
    let simc = "warrior=\"Tester\"\nspec=fury\ntalents=abc\nmain_hand=item,id=1\n";
    let mut options: SimOptions = serde_json::from_value(json!({})).expect("options");

    options.consumable_matrix_raid_buffs = vec![
        "bloodlust".to_string(),
        "arcane_intellect".to_string(),
        "power_word_fortitude".to_string(),
        "battle_shout".to_string(),
        "mark_of_the_wild".to_string(),
        "hunters_mark".to_string(),
        "bleeding".to_string(),
        "chaos_brand".to_string(),
        "mystic_touch".to_string(),
        "skyfury".to_string(),
        "power_infusion".to_string(),
        "blessing_of_bronze".to_string(),
    ];

    let (input, combo_count, metadata) =
        build_consumable_matrix_input(simc, &options).expect("matrix input");

    assert_eq!(combo_count, 12);
    assert_eq!(metadata.len(), 12);

    assert!(input.contains("override.bloodlust=1"));
    assert!(input.contains("override.arcane_intellect=1"));
    assert!(input.contains("override.power_word_fortitude=1"));
    assert!(input.contains("override.battle_shout=1"));
    assert!(input.contains("override.mark_of_the_wild=1"));
    assert!(input.contains("override.hunters_mark=1"));
    assert!(input.contains("override.bleeding=1"));
    assert!(input.contains("override.chaos_brand=1"));
    assert!(input.contains("override.mystic_touch=1"));
    assert!(input.contains("override.skyfury=1"));
    assert!(input.contains("external_buffs.power_infusion=0/120/240"));
    assert!(input.contains("override.blessing_of_the_bronze=1"));
}
