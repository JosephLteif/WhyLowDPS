//! Gear Resolver — takes flat parsed items + character info + item DB
//! and returns a fully enriched, slot-resolved gear layout.

use std::collections::{HashMap, HashSet};

pub mod catalyst;
pub mod eligibility;

pub use catalyst::{build_catalyst_item, slot_to_inv_type};

use crate::item_db;
use crate::types::class_data::{ARMOR_SLOTS, GEAR_SLOTS};
use crate::types::*;
use eligibility::{dedup_key, eligible_slots, enrich, make_uid};

fn restrictions_match_active_spec(
    item_restrictions: &[u64],
    active_spec_ids: &[u64],
    active_class_id: Option<u64>,
) -> bool {
    if item_restrictions.is_empty() {
        return true;
    }
    let has_spec_entries = item_restrictions.iter().any(|id| *id > 13);
    if has_spec_entries {
        return !active_spec_ids.is_empty()
            && active_spec_ids
                .iter()
                .any(|sid| item_restrictions.contains(sid));
    }
    active_class_id.is_some_and(|cid| item_restrictions.contains(&cid))
}

fn item_matches_primary_stats(item: &GameItem, allowed_primary: &HashSet<u64>) -> bool {
    if allowed_primary.is_empty() {
        return true;
    }
    let Some(stats) = &item.stats else {
        // Keep items without explicit primary stat tokens (many proc trinkets).
        return true;
    };

    let mut saw_primary_token = false;
    for stat in stats {
        let expanded = crate::types::class_data::expand_primary_stat(stat.id);
        if expanded.is_empty() {
            continue;
        }
        saw_primary_token = true;
        if expanded.iter().any(|id| allowed_primary.contains(id)) {
            return true;
        }
    }

    !saw_primary_token
}

fn primary_stat_filtered_slot(item_class: i64, inv_type: i64) -> bool {
    item_class == 2 || inv_type == 12 || inv_type == 14 || inv_type == 23
}

fn mark_off_spec_items(
    slots: &mut HashMap<String, SlotResolution>,
    class_name: &str,
    spec_name: &str,
) {
    let class_name = class_name.trim();
    let spec_name = spec_name.split(',').next().unwrap_or(spec_name).trim();
    if class_name.is_empty() || spec_name.is_empty() {
        return;
    }

    let active_spec_ids = crate::types::class_data::class_spec_ids(class_name, Some(spec_name));
    if active_spec_ids.is_empty() {
        return;
    }
    let active_class_id = crate::types::class_data::class_wow_id(class_name);
    let spec_profile = crate::types::class_data::spec_weapon_profile(class_name, spec_name);
    let allowed_weapons = crate::types::class_data::class_allowed_weapons(class_name);
    let allowed_primary: HashSet<u64> = spec_profile
        .as_ref()
        .map(|p| p.primary_stats.iter().copied().collect())
        .unwrap_or_default();

    let mut cache: HashMap<u64, bool> = HashMap::new();
    let mut compute_off_spec = |item_id: u64| -> bool {
        if let Some(flag) = cache.get(&item_id).copied() {
            return flag;
        }

        let off_spec = item_db::get_raw_item(item_id).is_some_and(|raw| {
            let restrictions = raw.restriction_ids();
            if !restrictions_match_active_spec(&restrictions, &active_spec_ids, active_class_id) {
                return true;
            }

            let item_class = raw.class.unwrap_or(0);
            let inv_type = raw.inventory_type.unwrap_or(0);
            let weapon_sub = raw.subclass.unwrap_or(0) as u64;

            if item_class == 2 || inv_type == 14 || inv_type == 23 {
                if let Some(profile) = &spec_profile {
                    let can_use = if item_class == 2 {
                        profile.weapon_subclasses.contains(&weapon_sub)
                    } else if inv_type == 14 {
                        profile.can_use_shield
                    } else {
                        profile.can_use_offhand
                    };
                    if !can_use {
                        return true;
                    }
                } else if let Some(weapons) = &allowed_weapons {
                    if item_class == 2 && !weapons.contains(&weapon_sub) {
                        return true;
                    }
                }
            }

            if primary_stat_filtered_slot(item_class, inv_type)
                && !item_matches_primary_stats(&raw, &allowed_primary)
            {
                return true;
            }

            false
        });

        cache.insert(item_id, off_spec);
        off_spec
    };

    for slot in slots.values_mut() {
        if let Some(eq) = slot.equipped.as_mut() {
            eq.off_spec = compute_off_spec(eq.item_id);
        }
        for alt in &mut slot.alternatives {
            alt.off_spec = compute_off_spec(alt.item_id);
        }
    }
}

/// Resolve a flat list of parsed items into a slot-organized, enriched gear set.
pub fn resolve_gear(parse_result: &ParseResult) -> ResolveGearResponse {
    resolve_gear_impl(parse_result, None)
}

/// Resolve gear with optional catalyst alternative generation.
pub fn resolve_gear_with_catalyst(
    parse_result: &ParseResult,
    catalyst_charges: Option<u32>,
) -> ResolveGearResponse {
    resolve_gear_impl(parse_result, catalyst_charges)
}

fn resolve_gear_impl(
    parse_result: &ParseResult,
    catalyst_charges: Option<u32>,
) -> ResolveGearResponse {
    let character = &parse_result.character;
    let spec = character.spec.as_deref().unwrap_or("");
    let class_name = character.class_name.as_deref().unwrap_or("");
    let max_armor = character.max_armor();
    let allowed_weapons = crate::types::class_data::class_allowed_weapons(class_name);
    let can_dw = character.can_dual_wield();
    let can_use_offhand = character.can_use_offhand();

    let mut slots: HashMap<String, SlotResolution> = HashMap::new();
    let mut excluded: Vec<ExcludedItem> = Vec::new();
    let mut seen_per_slot: HashMap<String, HashSet<String>> = HashMap::new();

    let equipped_items: Vec<&RawParsedItem> = parse_result
        .items
        .iter()
        .filter(|i| i.origin == ItemOrigin::Equipped)
        .collect();
    let other_items: Vec<&RawParsedItem> = parse_result
        .items
        .iter()
        .filter(|i| i.origin != ItemOrigin::Equipped)
        .collect();

    let equipped_by_slot: HashMap<String, &RawParsedItem> = equipped_items
        .iter()
        .map(|i| (i.raw_slot.clone(), *i))
        .collect();

    // Step 1: Place equipped items
    for item in &equipped_items {
        if item.item_id == 0 {
            continue;
        }
        let slot = &item.raw_slot;
        if !GEAR_SLOTS.contains(&slot.as_str()) {
            continue;
        }

        seen_per_slot
            .entry(slot.clone())
            .or_default()
            .insert(dedup_key(item));
        let resolved = enrich(item, slot);
        slots
            .entry(slot.clone())
            .or_insert_with(|| SlotResolution {
                equipped: None,
                alternatives: Vec::new(),
            })
            .equipped = Some(resolved);
    }

    // Step 2: Dual-wield and Pair crossover
    if can_dw {
        handle_dw_crossover(&equipped_items, &mut slots, &mut seen_per_slot);
    }
    handle_pair_crossover(&equipped_by_slot, &mut slots);

    // Step 3: Place non-equipped items
    for item in &other_items {
        if item.item_id == 0 {
            continue;
        }
        let item_eligible = eligible_slots(item, spec);
        if item_eligible.is_empty() {
            continue;
        }

        let armor_excluded = max_armor.is_some_and(|max| {
            item_db::get_item_armor_subclass(item.item_id).is_some_and(|sub| sub > 0 && sub > max)
        });

        let weapon_excluded = allowed_weapons.as_ref().is_some_and(|weapons| {
            if let Some(item_info) = item_db::get_item_info(item.item_id, Some(&item.bonus_ids)) {
                let ic = item_info.item_class;
                let isc = item_info.item_subclass;
                ic == 2 && !weapons.contains(&(isc as u64))
            } else {
                false
            }
        });

        for slot in &item_eligible {
            if !GEAR_SLOTS.contains(&slot.as_str()) {
                continue;
            }

            if armor_excluded && ARMOR_SLOTS.contains(&slot.as_str()) {
                excluded.push(ExcludedItem {
                    uid: make_uid(item, slot),
                    item_id: item.item_id,
                    name: item.name.clone(),
                    reason: "Wrong armor type".to_string(),
                });
                continue;
            }

            if weapon_excluded && matches!(slot.as_str(), "main_hand" | "off_hand") {
                excluded.push(ExcludedItem {
                    uid: make_uid(item, slot),
                    item_id: item.item_id,
                    name: item.name.clone(),
                    reason: "Wrong weapon type".to_string(),
                });
                continue;
            }

            let dk = dedup_key(item);
            if !seen_per_slot.entry(slot.clone()).or_default().insert(dk) {
                continue;
            }

            slots
                .entry(slot.clone())
                .or_insert_with(|| SlotResolution {
                    equipped: None,
                    alternatives: Vec::new(),
                })
                .alternatives
                .push(enrich(item, slot));
        }
    }

    // Sort and finalize
    for slot_res in slots.values_mut() {
        slot_res
            .alternatives
            .sort_by_key(|item| std::cmp::Reverse(item.ilevel));
    }

    if let Some(class_id) = crate::types::class_data::class_wow_id(class_name) {
        catalyst::mark_catalyst_eligible(&mut slots, class_id);
        if catalyst_charges.is_some() {
            catalyst::generate_catalyst_alternatives(&mut slots, class_id);
        }
    }

    mark_off_spec_items(&mut slots, class_name, spec);

    ResolveGearResponse {
        character: CharacterResolveInfo {
            class_name: character.class_name.clone(),
            spec: character.spec.clone(),
            can_dual_wield: can_dw,
            can_use_offhand,
        },
        base_profile: parse_result.base_profile.clone(),
        slots,
        excluded,
        talent_loadouts: parse_result.talent_loadouts.clone(),
        catalyst_charges,
    }
}

fn handle_dw_crossover(
    equipped: &[&RawParsedItem],
    slots: &mut HashMap<String, SlotResolution>,
    seen: &mut HashMap<String, HashSet<String>>,
) {
    let mh = equipped.iter().find(|i| i.raw_slot == "main_hand");
    let oh = equipped.iter().find(|i| i.raw_slot == "off_hand");

    let crossover = |item: &RawParsedItem,
                     target_slot: &str,
                     slots: &mut HashMap<String, SlotResolution>,
                     seen: &mut HashMap<String, HashSet<String>>| {
        if item.item_id > 0 && item_db::get_inventory_type(item.item_id) == Some(13) {
            let dk = dedup_key(item);
            if seen.entry(target_slot.to_string()).or_default().insert(dk) {
                let mut resolved = enrich(item, target_slot);
                resolved.origin = ItemOrigin::Equipped;
                slots
                    .entry(target_slot.to_string())
                    .or_default()
                    .alternatives
                    .push(resolved);
            }
        }
    };

    if let Some(m) = mh {
        crossover(m, "off_hand", slots, seen);
    }
    if let Some(o) = oh {
        crossover(o, "main_hand", slots, seen);
    }
}

fn handle_pair_crossover(
    equipped_by_slot: &HashMap<String, &RawParsedItem>,
    slots: &mut HashMap<String, SlotResolution>,
) {
    for &slot_name in &["finger1", "trinket1"] {
        let other = if slot_name == "finger1" {
            "finger2"
        } else {
            "trinket2"
        };
        if let Some(eq) = equipped_by_slot.get(slot_name) {
            if eq.item_id > 0 {
                slots
                    .entry(other.to_string())
                    .or_default()
                    .alternatives
                    .push(enrich(eq, other));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::item_db::state;
    use crate::types::class_data::{self, ClassDef, SpecDef};
    use std::sync::Arc;

    struct ItemSnapshot {
        items: Arc<HashMap<u64, GameItem>>,
    }

    impl ItemSnapshot {
        fn capture() -> Self {
            Self {
                items: state::ITEMS.read().unwrap().clone(),
            }
        }

        fn restore(self) {
            *state::ITEMS.write().unwrap() = self.items;
        }
    }

    struct ClassSnapshot {
        classes: Arc<Vec<ClassDef>>,
        trait_spec_ids: HashMap<String, Vec<u64>>,
        class_wow_ids: HashMap<String, u64>,
        spec_to_wow_class: HashMap<u64, u64>,
    }

    impl ClassSnapshot {
        fn capture() -> Self {
            Self {
                classes: class_data::CLASSES.read().unwrap().clone(),
                trait_spec_ids: class_data::CLASS_TRAIT_SPEC_IDS.read().unwrap().clone(),
                class_wow_ids: class_data::CLASS_WOW_IDS.read().unwrap().clone(),
                spec_to_wow_class: class_data::SPEC_TO_WOW_CLASS.read().unwrap().clone(),
            }
        }

        fn restore(self) {
            *class_data::CLASSES.write().unwrap() = self.classes;
            *class_data::CLASS_TRAIT_SPEC_IDS.write().unwrap() = self.trait_spec_ids;
            *class_data::CLASS_WOW_IDS.write().unwrap() = self.class_wow_ids;
            *class_data::SPEC_TO_WOW_CLASS.write().unwrap() = self.spec_to_wow_class;
        }
    }

    fn raw_item(item_id: u64, raw_slot: &str, origin: ItemOrigin) -> RawParsedItem {
        RawParsedItem {
            raw_slot: raw_slot.to_string(),
            simc_string: format!("{raw_slot}=item={item_id}"),
            item_id,
            ilevel: 600,
            name: format!("Item {item_id}"),
            bonus_ids: Vec::new(),
            enchant_id: 0,
            gem_id: 0,
            origin,
        }
    }

    fn db_item(
        id: u64,
        item_class: i64,
        subclass: i64,
        inventory_type: i64,
        specs: Option<Vec<u64>>,
    ) -> GameItem {
        GameItem {
            id,
            name: format!("Item {id}"),
            icon: format!("icon_{id}"),
            quality: 4,
            base_ilevel: Some(600),
            class: Some(item_class),
            subclass: Some(subclass),
            inventory_type: Some(inventory_type),
            set_id: None,
            has_sockets: false,
            socket_info: None,
            classes: None,
            specs,
            stats: None,
            bonus_lists: Vec::new(),
            sources: None,
            profession: None,
        }
    }

    fn parse_result(items: Vec<RawParsedItem>, class_name: &str, spec: &str) -> ParseResult {
        ParseResult {
            items,
            character: CharacterInfo {
                class_name: Some(class_name.to_string()),
                spec: Some(spec.to_string()),
            },
            base_profile: format!("{class_name}=\"Tester\""),
            talent_loadouts: Vec::new(),
        }
    }

    fn install_class_fixture() {
        *class_data::CLASSES.write().unwrap() = Arc::new(vec![ClassDef {
            name: "warrior".to_string(),
            aliases: Vec::new(),
            max_armor: 1,
            weapons: vec![4],
            specs: vec![
                SpecDef {
                    name: "fury".to_string(),
                    id: 72,
                    weapon_subclasses: vec![4],
                    primary_stats: vec![4],
                    can_dual_wield: true,
                    can_use_shield: false,
                    can_use_offhand: false,
                },
                SpecDef {
                    name: "protection".to_string(),
                    id: 73,
                    weapon_subclasses: vec![4],
                    primary_stats: vec![4],
                    can_dual_wield: false,
                    can_use_shield: true,
                    can_use_offhand: true,
                },
            ],
        }]);
        class_data::set_class_trait_spec_ids(HashMap::from([(
            "warrior".to_string(),
            vec![72, 73],
        )]));
        class_data::set_class_wow_ids(HashMap::from([("warrior".to_string(), 1)]));
        class_data::set_spec_to_wow_class(HashMap::from([(72, 1), (73, 1)]));
    }

    #[test]
    fn resolve_gear_adds_dual_wield_and_pair_slot_crossover_alternatives() {
        let _state_guard = state::TEST_STATE_LOCK
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        let _class_guard = class_data::TEST_CLASS_DATA_LOCK
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        let item_snapshot = ItemSnapshot::capture();
        let class_snapshot = ClassSnapshot::capture();

        install_class_fixture();
        *state::ITEMS.write().unwrap() = Arc::new(HashMap::from([
            (100, db_item(100, 2, 4, 13, None)),
            (200, db_item(200, 4, 0, 11, None)),
            (300, db_item(300, 4, 0, 12, None)),
        ]));

        let resolved = resolve_gear(&parse_result(
            vec![
                raw_item(100, "main_hand", ItemOrigin::Equipped),
                raw_item(200, "finger1", ItemOrigin::Equipped),
                raw_item(300, "trinket1", ItemOrigin::Equipped),
            ],
            "warrior",
            "fury",
        ));

        assert_eq!(
            resolved
                .slots
                .get("off_hand")
                .and_then(|slot| slot.alternatives.first())
                .map(|item| item.item_id),
            Some(100)
        );
        assert_eq!(
            resolved
                .slots
                .get("finger2")
                .and_then(|slot| slot.alternatives.first())
                .map(|item| item.item_id),
            Some(200)
        );
        assert_eq!(
            resolved
                .slots
                .get("trinket2")
                .and_then(|slot| slot.alternatives.first())
                .map(|item| item.item_id),
            Some(300)
        );

        class_snapshot.restore();
        item_snapshot.restore();
    }

    #[test]
    fn resolve_gear_excludes_wrong_armor_and_marks_off_spec_restricted_items() {
        let _state_guard = state::TEST_STATE_LOCK
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        let _class_guard = class_data::TEST_CLASS_DATA_LOCK
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        let item_snapshot = ItemSnapshot::capture();
        let class_snapshot = ClassSnapshot::capture();

        install_class_fixture();
        *state::ITEMS.write().unwrap() = Arc::new(HashMap::from([
            (400, db_item(400, 4, 2, 1, None)),
            (500, db_item(500, 4, 1, 1, Some(vec![73]))),
            (501, db_item(501, 4, 1, 1, Some(vec![72]))),
        ]));

        let resolved = resolve_gear(&parse_result(
            vec![
                raw_item(501, "head", ItemOrigin::Equipped),
                raw_item(400, "head", ItemOrigin::Bags),
                raw_item(500, "head", ItemOrigin::Bags),
            ],
            "warrior",
            "fury",
        ));

        assert_eq!(resolved.excluded.len(), 1);
        assert_eq!(resolved.excluded[0].item_id, 400);
        assert_eq!(resolved.excluded[0].reason, "Wrong armor type");
        assert_eq!(
            resolved
                .slots
                .get("head")
                .and_then(|slot| slot.alternatives.iter().find(|item| item.item_id == 500))
                .map(|item| item.off_spec),
            Some(true)
        );
        assert_eq!(
            resolved
                .slots
                .get("head")
                .and_then(|slot| slot.equipped.as_ref())
                .map(|item| item.off_spec),
            Some(false)
        );

        class_snapshot.restore();
        item_snapshot.restore();
    }
}
