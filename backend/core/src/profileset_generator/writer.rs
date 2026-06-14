use super::parser::extract_spec_id_from_talent_string;
use crate::types::class_data::GEAR_SLOTS;
use crate::types::{class_data, ResolvedItem};
use serde_json::{json, Value};
use std::collections::HashMap;

pub struct ProfilesetWriterContext<'a> {
    pub lines: &'a mut Vec<String>,
    pub combo_metadata: &'a mut HashMap<String, Vec<Value>>,
    pub talents: &'a [(String, String)],
    pub equipped_gear: &'a HashMap<String, String>,
    pub slot_item_lists: &'a HashMap<String, Vec<ResolvedItem>>,
    pub original_spec: &'a str,
    pub base_actor_spec: &'a str,
}

pub fn write_base_actor(
    lines: &mut Vec<String>,
    combo_metadata: &mut HashMap<String, Vec<Value>>,
    base_lines: &[String],
    equipped_gear: &HashMap<String, String>,
    talents: &[(String, String)],
    spec: &str,
    slot_item_lists: &HashMap<String, Vec<ResolvedItem>>,
) -> String {
    lines.push("# Base Actor".to_string());
    lines.extend(base_lines.iter().cloned());

    let base_talent = &talents[0].1;
    lines.push("### Combo 1".to_string());
    for slot in GEAR_SLOTS {
        if let Some(val) = equipped_gear.get(*slot) {
            lines.push(format!("{}={}", slot, val));
        } else if *slot == "off_hand" {
            lines.push("off_hand=,".to_string());
        }
    }

    let base_spec = extract_spec_id_from_talent_string(base_talent)
        .and_then(class_data::spec_id_to_name)
        .unwrap_or_else(|| spec.to_string());

    if !base_talent.is_empty() {
        lines.push(format!("talents={}", base_talent));
        if base_spec != spec {
            lines.push(format!("spec={}", base_spec));
        }
    }
    lines.push(String::new());

    let baseline_name = if talents.len() > 1 {
        format!("Currently Equipped ({})", talents[0].0)
    } else {
        "Currently Equipped".to_string()
    };
    combo_metadata.insert(baseline_name, build_baseline_meta(slot_item_lists, talents));

    base_spec
}

pub fn write_all_profilesets(
    mut ctx: ProfilesetWriterContext,
    valid_combos: &[HashMap<String, ResolvedItem>],
) {
    let mut combo_number = 2;
    for (t_idx, (t_name, t_str)) in ctx.talents.iter().cloned().enumerate() {
        let is_first_talent = t_idx == 0;

        if !is_first_talent {
            write_combo(
                &mut ctx,
                combo_number,
                &t_name,
                &t_str,
                &HashMap::new(),
                true,
            );
            combo_number += 1;
        }

        for gear_set in valid_combos {
            write_combo(&mut ctx, combo_number, &t_name, &t_str, gear_set, false);
            combo_number += 1;
        }
    }
}

pub fn append_consumable_metadata(
    combo_metadata: &mut HashMap<String, Vec<Value>>,
    combo_name: &str,
    flask: &str,
    food: &str,
    potion: &str,
    augmentation: &str,
    temporary_enchant: &str,
) {
    let mut labels: Vec<String> = Vec::new();
    if !flask.is_empty() {
        labels.push(format!("Flask: {}", flask));
    }
    if !food.is_empty() {
        labels.push(format!("Food: {}", food));
    }
    if !potion.is_empty() {
        labels.push(format!("Potion: {}", potion));
    }
    if !augmentation.is_empty() {
        labels.push(format!("Augmentation: {}", augmentation));
    }
    if !temporary_enchant.is_empty() {
        labels.push(format!("Temp Enchant: {}", temporary_enchant));
    }
    if labels.is_empty() {
        return;
    }
    let entry = json!({
        "consumable_set": labels.join(" | "),
        "consumable_flask": flask,
        "consumable_food": food,
        "consumable_potion": potion,
        "consumable_augmentation": augmentation,
        "consumable_temporary_enchant": temporary_enchant,
        "heatmap_kind": "consumable",
    });
    if let Some(existing) = combo_metadata.get_mut(combo_name) {
        existing.push(entry);
    } else {
        combo_metadata.insert(combo_name.to_string(), vec![entry]);
    }
}

pub fn write_combo(
    ctx: &mut ProfilesetWriterContext,
    combo_number: usize,
    talent_name: &str,
    talent_str: &str,
    gear_set: &HashMap<String, ResolvedItem>,
    is_baseline_gear: bool,
) {
    let combo_name = format!("Combo {}", combo_number);
    ctx.lines.push(format!("### {}", combo_name));

    if is_baseline_gear {
        for slot in GEAR_SLOTS {
            if let Some(val) = ctx.equipped_gear.get(*slot) {
                ctx.lines
                    .push(format!("profileset.\"{}\"+={}={}", combo_name, slot, val));
            } else if *slot == "off_hand" {
                ctx.lines
                    .push(format!("profileset.\"{}\"+=off_hand=,", combo_name));
            }
        }
    } else {
        let mh_is_2h =
            crate::profileset::validation::main_hand_is_two_hand(gear_set, ctx.original_spec);
        for slot in GEAR_SLOTS {
            if *slot == "off_hand" && mh_is_2h {
                ctx.lines
                    .push(format!("profileset.\"{}\"+=off_hand=,", combo_name));
                continue;
            }
            if let Some(item) = gear_set.get(*slot) {
                ctx.lines.push(format!(
                    "profileset.\"{}\"+={}={}",
                    combo_name, slot, item.simc_string
                ));
            } else if *slot == "off_hand" {
                ctx.lines
                    .push(format!("profileset.\"{}\"+=off_hand=,", combo_name));
            }
        }
    }

    if !talent_str.is_empty() {
        ctx.lines.push(format!(
            "profileset.\"{}\"+=talents={}",
            combo_name, talent_str
        ));
        if let Some(t_spec_id) = extract_spec_id_from_talent_string(talent_str) {
            if let Some(t_spec_name) = class_data::spec_id_to_name(t_spec_id) {
                if t_spec_name != ctx.base_actor_spec {
                    ctx.lines.push(format!(
                        "profileset.\"{}\"+=spec={}",
                        combo_name, t_spec_name
                    ));
                }
            }
        }
    }
    ctx.lines.push(String::new());

    ctx.combo_metadata.insert(
        combo_name,
        build_combo_meta(
            gear_set,
            talent_name,
            talent_str,
            ctx.slot_item_lists,
            is_baseline_gear,
        ),
    );
}

pub fn build_baseline_meta(
    slot_item_lists: &HashMap<String, Vec<ResolvedItem>>,
    talents: &[(String, String)],
) -> Vec<Value> {
    let mut meta = Vec::new();
    for slot in GEAR_SLOTS {
        if let Some(items) = slot_item_lists.get(*slot) {
            if !items.is_empty() {
                meta.push(item_meta(&items[0], slot));
            }
        }
    }

    if talents.len() > 1 {
        let name = &talents[0].0;
        let spec_name =
            extract_spec_id_from_talent_string(&talents[0].1).and_then(class_data::spec_id_to_name);
        if meta.is_empty() {
            meta.push(json!({"talent_build": name, "talent_spec": spec_name, "is_kept": true}));
        } else {
            for item in &mut meta {
                item["talent_build"] = json!(name);
                item["talent_spec"] = json!(spec_name);
            }
        }
    }
    meta
}

pub fn build_combo_meta(
    gear_set: &HashMap<String, ResolvedItem>,
    talent_name: &str,
    talent_str: &str,
    slot_item_lists: &HashMap<String, Vec<ResolvedItem>>,
    is_baseline: bool,
) -> Vec<Value> {
    let paired_display_slots = ["finger1", "finger2", "trinket1", "trinket2"];
    let mut meta = Vec::new();

    if is_baseline {
        for slot in GEAR_SLOTS {
            if let Some(items) = slot_item_lists.get(*slot) {
                if !items.is_empty() {
                    let mut m = item_meta(&items[0], slot);
                    m["is_kept"] = json!(true);
                    meta.push(m);
                }
            }
        }
    } else {
        for slot in &paired_display_slots {
            if let Some(item) = gear_set.get(*slot) {
                let mut m = item_meta(item, slot);
                m["is_kept"] = json!(item.origin == crate::types::ItemOrigin::Equipped);
                meta.push(m);
            }
        }
        for slot in GEAR_SLOTS {
            if paired_display_slots.contains(slot) {
                continue;
            }
            if let Some(item) = gear_set.get(*slot) {
                if item.origin != crate::types::ItemOrigin::Equipped {
                    meta.push(item_meta(item, slot));
                }
            }
        }
    }

    if !talent_name.is_empty() {
        let spec_name =
            extract_spec_id_from_talent_string(talent_str).and_then(class_data::spec_id_to_name);
        if meta.is_empty() {
            meta.push(
                json!({"talent_build": talent_name, "talent_spec": spec_name, "is_kept": true}),
            );
        } else {
            for item in &mut meta {
                item["talent_build"] = json!(talent_name);
                item["talent_spec"] = json!(spec_name);
            }
        }
    }

    if !is_baseline && !gear_set.contains_key("off_hand") {
        meta.push(json!({"slot": "off_hand", "item_id": 0, "ilevel": 0, "name": "", "bonus_ids": [], "enchant_id": 0, "gem_id": 0, "is_kept": false, "origin": "system"}));
    }

    meta
}

pub fn item_meta(item: &ResolvedItem, slot: &str) -> Value {
    let resolved_upgrade = if item.upgrade.trim().is_empty() {
        crate::item_db::describe_upgrade_from_bonus_ids(&item.bonus_ids).unwrap_or_default()
    } else {
        item.upgrade.clone()
    };
    let mut meta = json!({
        "slot": slot,
        "item_id": item.item_id,
        "ilevel": item.ilevel,
        "name": item.name,
        "tag": item.tag,
        "upgrade": resolved_upgrade,
        "bonus_ids": item.bonus_ids,
        "enchant_id": item.enchant_id,
        "gem_id": item.gem_id,
        "is_kept": item.origin == crate::types::ItemOrigin::Equipped,
        "origin": item.origin.as_str(),
    });
    if !item.encounter.is_empty() {
        meta["encounter"] = json!(item.encounter);
    }
    if !item.instance_name.is_empty() {
        meta["instance_name"] = json!(item.instance_name);
    }
    if !item.source_type.is_empty() {
        meta["source_type"] = json!(item.source_type);
    }
    if item.encounter_id > 0 {
        meta["encounter_id"] = json!(item.encounter_id);
    }
    if item.instance_id > 0 {
        meta["instance_id"] = json!(item.instance_id);
    }
    if item.is_catalyst {
        meta["is_catalyst"] = json!(true);
    }
    if !item.upgrade_costs.is_empty() {
        meta["upgrade_costs"] = json!(item.upgrade_costs);
    }
    meta
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::ItemOrigin;

    fn make_item(
        slot: &str,
        item_id: u64,
        origin: ItemOrigin,
        simc_string: &str,
        ilevel: i64,
    ) -> ResolvedItem {
        ResolvedItem {
            uid: format!("{slot}-{item_id}"),
            slot: slot.to_string(),
            item_id,
            origin,
            simc_string: simc_string.to_string(),
            ilevel,
            name: format!("Item {item_id}"),
            quality: 4,
            quality_color: "#a335ee".to_string(),
            ..ResolvedItem::default()
        }
    }

    #[test]
    fn write_base_actor_outputs_base_combo_and_metadata() {
        let mut lines = Vec::new();
        let mut metadata = HashMap::new();
        let base_lines = vec!["mage=Test".to_string(), "spec=arcane".to_string()];
        let equipped = HashMap::from([
            ("head".to_string(), "id=111".to_string()),
            ("main_hand".to_string(), "id=222".to_string()),
        ]);
        let talents = vec![("Default".to_string(), "AAAA".to_string())];
        let slot_items = HashMap::from([(
            "head".to_string(),
            vec![make_item("head", 111, ItemOrigin::Equipped, ",id=111", 620)],
        )]);

        let base_spec = write_base_actor(
            &mut lines,
            &mut metadata,
            &base_lines,
            &equipped,
            &talents,
            "arcane",
            &slot_items,
        );

        assert_eq!(base_spec, "arcane");
        assert!(lines.iter().any(|l| l == "# Base Actor"));
        assert!(lines.iter().any(|l| l == "### Combo 1"));
        assert!(lines.iter().any(|l| l == "head=id=111"));
        assert!(lines.iter().any(|l| l == "off_hand=,"));
        assert!(lines.iter().any(|l| l == "talents=AAAA"));
        assert!(metadata.contains_key("Currently Equipped"));
    }

    #[test]
    fn append_consumable_metadata_skips_empty_and_appends_values() {
        let mut metadata: HashMap<String, Vec<Value>> = HashMap::new();
        append_consumable_metadata(&mut metadata, "Combo 2", "", "", "", "", "");
        assert!(!metadata.contains_key("Combo 2"));

        append_consumable_metadata(
            &mut metadata,
            "Combo 2",
            "Flask of Alchemical Chaos",
            "Feast",
            "Potion of Power",
            "",
            "",
        );

        let entries = metadata.get("Combo 2").expect("combo metadata exists");
        assert_eq!(entries.len(), 1);
        assert_eq!(
            entries[0].get("consumable_set").and_then(Value::as_str),
            Some("Flask: Flask of Alchemical Chaos | Food: Feast | Potion: Potion of Power")
        );
    }

    #[test]
    fn write_combo_for_baseline_gear_uses_equipped_values() {
        let mut lines = Vec::new();
        let mut metadata = HashMap::new();
        let mut ctx = ProfilesetWriterContext {
            lines: &mut lines,
            combo_metadata: &mut metadata,
            talents: &[("Default".to_string(), "AAAA".to_string())],
            equipped_gear: &HashMap::from([
                ("head".to_string(), "id=111".to_string()),
                ("main_hand".to_string(), "id=222".to_string()),
            ]),
            slot_item_lists: &HashMap::new(),
            original_spec: "arcane",
            base_actor_spec: "arcane",
        };

        write_combo(&mut ctx, 2, "Default", "AAAA", &HashMap::new(), true);

        assert!(lines
            .iter()
            .any(|l| l == "profileset.\"Combo 2\"+=head=id=111"));
        assert!(lines
            .iter()
            .any(|l| l == "profileset.\"Combo 2\"+=off_hand=,"));
        assert!(lines
            .iter()
            .any(|l| l == "profileset.\"Combo 2\"+=talents=AAAA"));
        assert!(metadata.contains_key("Combo 2"));
    }

    #[test]
    fn write_combo_for_alternative_gear_writes_item_lines_and_empty_off_hand() {
        let mut lines = Vec::new();
        let mut metadata = HashMap::new();
        let mut ctx = ProfilesetWriterContext {
            lines: &mut lines,
            combo_metadata: &mut metadata,
            talents: &[("Alt".to_string(), String::new())],
            equipped_gear: &HashMap::new(),
            slot_item_lists: &HashMap::new(),
            original_spec: "arcane",
            base_actor_spec: "arcane",
        };

        let gear_set = HashMap::from([(
            "main_hand".to_string(),
            make_item(
                "main_hand",
                9001,
                ItemOrigin::Bags,
                "id=9001,bonus_id=1",
                626,
            ),
        )]);

        write_combo(&mut ctx, 3, "Alt", "", &gear_set, false);

        assert!(lines
            .iter()
            .any(|l| l == "profileset.\"Combo 3\"+=main_hand=id=9001,bonus_id=1"));
        assert!(lines
            .iter()
            .any(|l| l == "profileset.\"Combo 3\"+=off_hand=,"));
        assert!(metadata.contains_key("Combo 3"));
    }

    #[test]
    fn build_combo_meta_non_baseline_adds_missing_off_hand_marker() {
        let gear_set = HashMap::from([
            (
                "finger1".to_string(),
                make_item("finger1", 1001, ItemOrigin::Equipped, ",id=1001", 620),
            ),
            (
                "finger2".to_string(),
                make_item("finger2", 1002, ItemOrigin::Bags, ",id=1002", 623),
            ),
            (
                "head".to_string(),
                make_item("head", 2001, ItemOrigin::Bags, ",id=2001", 626),
            ),
        ]);

        let meta = build_combo_meta(&gear_set, "Raid", "AAAA", &HashMap::new(), false);

        assert!(meta.iter().any(|entry| {
            entry.get("slot").and_then(Value::as_str) == Some("off_hand")
                && entry.get("origin").and_then(Value::as_str) == Some("system")
        }));
        assert!(meta
            .iter()
            .filter(|entry| entry.get("slot").and_then(Value::as_str) != Some("off_hand"))
            .all(|entry| entry.get("talent_build").and_then(Value::as_str) == Some("Raid")));
    }

    #[test]
    fn item_meta_includes_optional_source_catalyst_and_upgrade_cost_fields() {
        let mut item = make_item("head", 3001, ItemOrigin::Bags, ",id=3001", 626);
        item.encounter = "Boss".to_string();
        item.instance_name = "Raid".to_string();
        item.source_type = "raid".to_string();
        item.encounter_id = 101;
        item.instance_id = 202;
        item.is_catalyst = true;
        item.upgrade_costs = HashMap::from([(3008, 12), (3009, 4)]);

        let meta = item_meta(&item, "head");

        assert_eq!(meta.get("encounter").and_then(Value::as_str), Some("Boss"));
        assert_eq!(
            meta.get("instance_name").and_then(Value::as_str),
            Some("Raid")
        );
        assert_eq!(
            meta.get("source_type").and_then(Value::as_str),
            Some("raid")
        );
        assert_eq!(meta.get("encounter_id").and_then(Value::as_i64), Some(101));
        assert_eq!(meta.get("instance_id").and_then(Value::as_i64), Some(202));
        assert_eq!(meta.get("is_catalyst").and_then(Value::as_bool), Some(true));
        assert_eq!(
            meta.get("upgrade_costs")
                .and_then(|value| value.get("3008"))
                .and_then(Value::as_u64),
            Some(12)
        );
    }
}
