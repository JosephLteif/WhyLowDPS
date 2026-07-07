use super::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(super) enum TrinketRolePool {
    Dps,
    Tank,
    Healer,
}

pub(super) fn spec_id_to_role_pool(spec_id: u64) -> TrinketRolePool {
    match spec_id {
        66 | 73 | 104 | 250 | 268 | 581 => TrinketRolePool::Tank,
        65 | 105 | 257 | 264 | 270 | 1468 => TrinketRolePool::Healer,
        _ => TrinketRolePool::Dps,
    }
}

fn class_id_supports_role_pool(class_id: u64, role: TrinketRolePool) -> bool {
    match class_id {
        1 => matches!(role, TrinketRolePool::Dps | TrinketRolePool::Tank),
        2 => true,
        3 => matches!(role, TrinketRolePool::Dps),
        4 => matches!(role, TrinketRolePool::Dps),
        5 => matches!(role, TrinketRolePool::Dps | TrinketRolePool::Healer),
        6 => matches!(role, TrinketRolePool::Dps | TrinketRolePool::Tank),
        7 => matches!(role, TrinketRolePool::Dps | TrinketRolePool::Healer),
        8 => matches!(role, TrinketRolePool::Dps),
        9 => matches!(role, TrinketRolePool::Dps),
        10 => true,
        11 => true,
        12 => matches!(role, TrinketRolePool::Dps | TrinketRolePool::Tank),
        13 => matches!(role, TrinketRolePool::Dps | TrinketRolePool::Healer),
        _ => true,
    }
}

pub(super) fn selected_heatmap_role_pools(
    role_pools: &str,
    active_spec_id: Option<u64>,
) -> HashSet<TrinketRolePool> {
    let mut explicit: HashSet<TrinketRolePool> = HashSet::new();
    let mut has_auto = false;
    for token in role_pools.split(',') {
        match token.trim().to_lowercase().as_str() {
            "all" | "any" => {
                explicit.insert(TrinketRolePool::Dps);
                explicit.insert(TrinketRolePool::Tank);
                explicit.insert(TrinketRolePool::Healer);
            }
            "dps" => {
                explicit.insert(TrinketRolePool::Dps);
            }
            "tank" => {
                explicit.insert(TrinketRolePool::Tank);
            }
            "healer" | "heal" => {
                explicit.insert(TrinketRolePool::Healer);
            }
            "auto" | "" => {
                has_auto = true;
            }
            _ => {}
        }
    }
    if !explicit.is_empty() {
        return explicit;
    }
    if has_auto {
        return HashSet::from([spec_id_to_role_pool(active_spec_id.unwrap_or(0))]);
    }
    HashSet::from([
        TrinketRolePool::Dps,
        TrinketRolePool::Tank,
        TrinketRolePool::Healer,
    ])
}

pub(super) fn mplus_rotation_instance_ids() -> HashSet<i64> {
    crate::item_db::instances()
        .into_iter()
        .find(|inst| inst.get("id").and_then(|v| v.as_i64()) == Some(-1))
        .and_then(|inst| inst.get("encounters").and_then(|v| v.as_array()).cloned())
        .unwrap_or_default()
        .into_iter()
        .filter_map(|e| e.get("id").and_then(|v| v.as_i64()))
        .collect()
}

pub(super) fn item_has_mplus_rotation_source(
    item: &crate::types::GameItem,
    mplus_ids: &HashSet<i64>,
) -> bool {
    item.sources.as_ref().is_some_and(|sources| {
        sources.iter().any(|src| {
            src.instance_id == Some(-1)
                || src.instance_id.is_some_and(|iid| mplus_ids.contains(&iid))
        })
    })
}

pub(super) fn item_specs_match_role_pools(
    specs: &[u64],
    selected_pools: &HashSet<TrinketRolePool>,
) -> bool {
    if selected_pools.is_empty() || specs.is_empty() {
        return true;
    }

    let spec_entries: Vec<u64> = specs.iter().copied().filter(|id| *id > 13).collect();
    if !spec_entries.is_empty() {
        return spec_entries
            .iter()
            .any(|sid| selected_pools.contains(&spec_id_to_role_pool(*sid)));
    }

    const KNOWN_CLASS_IDS: &[u64] = &[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
    let class_entries: Vec<u64> = specs
        .iter()
        .copied()
        .filter(|id| KNOWN_CLASS_IDS.contains(id))
        .collect();
    if class_entries.is_empty() {
        return true;
    }

    class_entries.iter().any(|class_id| {
        selected_pools
            .iter()
            .any(|pool| class_id_supports_role_pool(*class_id, *pool))
    })
}

pub(super) fn item_specs_match_active_spec(
    specs: &[u64],
    active_spec_id: Option<u64>,
    ignore_spec_restrictions: bool,
) -> bool {
    if ignore_spec_restrictions {
        return true;
    }
    if specs.is_empty() {
        return true;
    }
    let spec_entries: Vec<u64> = specs.iter().copied().filter(|id| *id > 13).collect();
    if !spec_entries.is_empty() {
        return active_spec_id.is_some_and(|id| spec_entries.contains(&id));
    }

    const KNOWN_CLASS_IDS: &[u64] = &[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
    let class_entries: Vec<u64> = specs
        .iter()
        .copied()
        .filter(|id| KNOWN_CLASS_IDS.contains(id))
        .collect();
    if class_entries.is_empty() {
        return true;
    }

    active_spec_id.is_some_and(|sid| {
        crate::types::class_data::spec_id_to_wow_class_id(sid)
            .is_some_and(|cid| class_entries.contains(&cid))
    })
}

pub(super) fn trinket_json_matches_active_spec(
    trinket: &Value,
    active_spec_id: Option<u64>,
    ignore_spec_restrictions: bool,
    selected_role_pools: &HashSet<TrinketRolePool>,
) -> bool {
    let Some(specs) = trinket.get("specs").and_then(|v| v.as_array()) else {
        return true;
    };
    if specs.is_empty() {
        return true;
    }
    let parsed_specs: Vec<u64> = specs.iter().filter_map(|v| v.as_u64()).collect();
    if parsed_specs.len() != specs.len() {
        return true;
    }
    item_specs_match_active_spec(&parsed_specs, active_spec_id, ignore_spec_restrictions)
        && item_specs_match_role_pools(&parsed_specs, selected_role_pools)
}

pub(super) fn item_id_matches_active_spec(
    item_id: u64,
    active_spec_id: Option<u64>,
    ignore_spec_restrictions: bool,
) -> bool {
    if ignore_spec_restrictions {
        return true;
    }
    let Some(raw) = crate::item_db::get_raw_item(item_id) else {
        return true;
    };
    let item_specs = raw.restriction_ids();
    item_specs_match_active_spec(&item_specs, active_spec_id, ignore_spec_restrictions)
}

pub(super) fn item_id_matches_active_spec_with_lookup(
    item_id: u64,
    active_spec_id: Option<u64>,
    drop_specs_by_item: &HashMap<u64, Vec<u64>>,
    ignore_spec_restrictions: bool,
    selected_role_pools: &HashSet<TrinketRolePool>,
) -> bool {
    if let Some(specs) = drop_specs_by_item.get(&item_id) {
        return item_specs_match_active_spec(specs, active_spec_id, ignore_spec_restrictions)
            && item_specs_match_role_pools(specs, selected_role_pools);
    }
    item_id_matches_active_spec(item_id, active_spec_id, ignore_spec_restrictions)
}

pub(super) fn selected_heatmap_source_types(scope: &str) -> Vec<&'static str> {
    let mut picked: HashSet<&'static str> = HashSet::new();
    for token in scope.split(',') {
        match token.trim().to_lowercase().as_str() {
            "all" => {
                picked.insert("raid");
                picked.insert("dungeon");
                picked.insert("delve");
                picked.insert("pvp");
                picked.insert("profession");
            }
            "raid" | "raids" => {
                picked.insert("raid");
            }
            "dungeon" | "dungeons" => {
                picked.insert("dungeon");
            }
            "delve" | "delves" => {
                picked.insert("delve");
            }
            "pvp" => {
                picked.insert("pvp");
            }
            "profession" | "professions" => {
                picked.insert("profession");
            }
            _ => {}
        }
    }
    if picked.is_empty() {
        picked.insert("raid");
        picked.insert("dungeon");
        picked.insert("delve");
        picked.insert("pvp");
        picked.insert("profession");
    }
    let mut out: Vec<&'static str> = picked.into_iter().collect();
    out.sort_unstable();
    out
}

pub(super) fn normalized_locked_trinket_slot(raw: &str) -> Option<&'static str> {
    match raw.trim().to_lowercase().as_str() {
        "trinket1" => Some("trinket1"),
        "trinket2" => Some("trinket2"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::item_db::state;
    use crate::types::class_data::{self, ClassDef, SpecDef};
    use crate::types::{GameItem, ItemSource};
    use serde_json::json;
    use std::sync::Arc;

    struct StateSnapshot {
        instances: Vec<Value>,
        items: Arc<HashMap<u64, GameItem>>,
        drops_by_encounter: Arc<state::DropMap>,
        catalyst: Arc<state::CatalystData>,
    }

    impl StateSnapshot {
        fn capture() -> Self {
            Self {
                instances: state::INSTANCES.read().unwrap().clone(),
                items: state::ITEMS.read().unwrap().clone(),
                drops_by_encounter: state::DROPS_BY_ENCOUNTER.read().unwrap().clone(),
                catalyst: state::CATALYST.read().unwrap().clone(),
            }
        }

        fn restore(self) {
            *state::INSTANCES.write().unwrap() = self.instances;
            *state::ITEMS.write().unwrap() = self.items;
            *state::DROPS_BY_ENCOUNTER.write().unwrap() = self.drops_by_encounter;
            *state::CATALYST.write().unwrap() = self.catalyst;
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

    fn test_item(id: u64, specs: Option<Vec<u64>>, sources: Option<Vec<ItemSource>>) -> GameItem {
        GameItem {
            id,
            name: format!("Item {id}"),
            icon: "inv_misc_questionmark".to_string(),
            quality: 4,
            base_ilevel: Some(639),
            class: Some(4),
            subclass: Some(0),
            inventory_type: Some(12),
            set_id: None,
            has_sockets: false,
            socket_info: None,
            classes: None,
            specs,
            stats: None,
            bonus_lists: Vec::new(),
            sources,
            profession: None,
        }
    }

    fn install_warrior_fixture() {
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
    fn role_pool_and_scope_selection_normalize_tokens_and_defaults() {
        assert_eq!(spec_id_to_role_pool(66), TrinketRolePool::Tank);
        assert_eq!(spec_id_to_role_pool(1468), TrinketRolePool::Healer);
        assert_eq!(spec_id_to_role_pool(71), TrinketRolePool::Dps);

        assert_eq!(
            selected_heatmap_role_pools("tank, heal", Some(66)),
            HashSet::from([TrinketRolePool::Tank, TrinketRolePool::Healer])
        );
        assert_eq!(
            selected_heatmap_role_pools("auto", Some(65)),
            HashSet::from([TrinketRolePool::Healer])
        );
        assert_eq!(
            selected_heatmap_role_pools("", None),
            HashSet::from([TrinketRolePool::Dps])
        );

        assert_eq!(
            selected_heatmap_source_types("raid, professions, raid"),
            vec!["profession", "raid"]
        );
        assert_eq!(
            selected_heatmap_source_types(""),
            vec!["delve", "dungeon", "profession", "pvp", "raid"]
        );
        assert_eq!(
            normalized_locked_trinket_slot(" Trinket2 "),
            Some("trinket2")
        );
        assert_eq!(normalized_locked_trinket_slot("both"), None);
    }

    #[test]
    fn spec_and_role_matching_cover_spec_class_and_ignore_paths() {
        let dps_only = HashSet::from([TrinketRolePool::Dps]);
        let healer_only = HashSet::from([TrinketRolePool::Healer]);

        assert!(item_specs_match_role_pools(&[577], &dps_only));
        assert!(!item_specs_match_role_pools(&[577], &healer_only));
        assert!(item_specs_match_role_pools(&[2], &healer_only));
        assert!(!item_specs_match_role_pools(&[3], &healer_only));

        assert!(item_specs_match_active_spec(&[577], Some(577), false));
        assert!(!item_specs_match_active_spec(&[577], Some(581), false));
        assert!(item_specs_match_active_spec(&[], Some(62), false));
        assert!(item_specs_match_active_spec(&[577], Some(581), true));

        assert!(trinket_json_matches_active_spec(
            &json!({ "specs": [577] }),
            Some(577),
            false,
            &dps_only
        ));
        assert!(!trinket_json_matches_active_spec(
            &json!({ "specs": [577] }),
            Some(577),
            false,
            &healer_only
        ));
        assert!(trinket_json_matches_active_spec(
            &json!({ "specs": ["bad"] }),
            Some(577),
            false,
            &dps_only
        ));
    }

    #[test]
    fn mplus_and_item_lookup_helpers_use_runtime_state_and_drop_lookup() {
        let _guard = state::TEST_STATE_LOCK
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        let snapshot = StateSnapshot::capture();

        *state::INSTANCES.write().unwrap() = vec![json!({
            "id": -1,
            "encounters": [{ "id": 2001 }, { "id": 2002 }]
        })];

        let item = test_item(
            9001,
            Some(vec![577]),
            Some(vec![
                ItemSource {
                    encounter_id: Some(1),
                    instance_id: Some(2002),
                },
                ItemSource {
                    encounter_id: Some(2),
                    instance_id: Some(3000),
                },
            ]),
        );
        let no_rotation_item = test_item(
            9002,
            Some(vec![577]),
            Some(vec![ItemSource {
                encounter_id: Some(3),
                instance_id: Some(4000),
            }]),
        );
        *state::ITEMS.write().unwrap() = Arc::new(HashMap::from([
            (9001_u64, item.clone()),
            (9002_u64, no_rotation_item.clone()),
        ]));

        let mplus_ids = mplus_rotation_instance_ids();
        assert_eq!(mplus_ids, HashSet::from([2001_i64, 2002_i64]));
        assert!(item_has_mplus_rotation_source(&item, &mplus_ids));
        assert!(!item_has_mplus_rotation_source(
            &no_rotation_item,
            &mplus_ids
        ));

        assert!(item_id_matches_active_spec(9001, Some(577), false));
        assert!(!item_id_matches_active_spec(9001, Some(581), false));

        let role_pools = HashSet::from([TrinketRolePool::Dps]);
        let lookup = HashMap::from([(9002_u64, vec![581_u64])]);
        assert!(!item_id_matches_active_spec_with_lookup(
            9002,
            Some(577),
            &lookup,
            false,
            &role_pools
        ));
        assert!(item_id_matches_active_spec_with_lookup(
            9001,
            Some(577),
            &HashMap::new(),
            false,
            &role_pools
        ));

        snapshot.restore();
    }

    #[test]
    fn build_heatmap_profileset_input_generates_locked_trinket_matrix_from_fallback_drops() {
        let _state_guard = state::TEST_STATE_LOCK
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        let _class_guard = class_data::TEST_CLASS_DATA_LOCK
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        let state_snapshot = StateSnapshot::capture();
        let class_snapshot = ClassSnapshot::capture();

        install_warrior_fixture();

        let mut fixed_one = test_item(9000, Some(vec![72]), None);
        fixed_one.name = "Equipped Lock".to_string();
        fixed_one.base_ilevel = Some(619);

        let mut fixed_two = test_item(9003, Some(vec![72]), None);
        fixed_two.name = "Second Equipped".to_string();
        fixed_two.base_ilevel = Some(615);

        let mut candidate_one = test_item(9101, Some(vec![72]), None);
        candidate_one.name = "Raid Trinket Alpha".to_string();

        let mut candidate_two = test_item(9102, Some(vec![72]), None);
        candidate_two.name = "Raid Trinket Beta".to_string();

        *state::ITEMS.write().unwrap() = Arc::new(HashMap::from([
            (9000_u64, fixed_one),
            (9003_u64, fixed_two),
            (9101_u64, candidate_one.clone()),
            (9102_u64, candidate_two.clone()),
        ]));
        *state::INSTANCES.write().unwrap() = vec![json!({
            "id": 7001,
            "type": "raid",
            "encounters": [{ "id": 8001 }]
        })];
        *state::DROPS_BY_ENCOUNTER.write().unwrap() = Arc::new(HashMap::from([(
            8001_i64,
            vec![candidate_one, candidate_two],
        )]));

        let (generated_input, combo_count, combo_metadata) = build_heatmap_profileset_input(
            "warrior=\"Tester\"\nspec=fury\ntrinket1=id=9000,ilevel=619\ntrinket2=id=9003,ilevel=615\n",
            "warrior",
            true,
            false,
            620,
            "raid",
            "trinket1",
            "auto",
            false,
        )
        .expect("trinket heatmap input");

        assert_eq!(combo_count, 2);
        assert_eq!(combo_metadata.len(), 2);
        assert!(generated_input.contains("profileset.\"Heatmap Trinket 1"));
        assert!(generated_input.contains("profileset.\"Heatmap Trinket 2"));
        assert!(generated_input.contains("trinket2=,id=9101,ilevel=639"));
        assert!(generated_input.contains("trinket2=,id=9102,ilevel=639"));
        assert!(combo_metadata.values().all(|meta| {
            meta.iter().any(|entry| {
                entry.get("heatmap_kind") == Some(&Value::String("trinket".to_string()))
            })
        }));

        class_snapshot.restore();
        state_snapshot.restore();
    }

    #[test]
    fn build_heatmap_profileset_input_generates_tier_piece_combinations() {
        let _state_guard = state::TEST_STATE_LOCK
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        let _class_guard = class_data::TEST_CLASS_DATA_LOCK
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        let state_snapshot = StateSnapshot::capture();
        let class_snapshot = ClassSnapshot::capture();

        install_warrior_fixture();
        *state::ITEMS.write().unwrap() = Arc::new(HashMap::from([
            (1001_u64, {
                let mut item = test_item(1001, Some(vec![72]), None);
                item.name = "Helm of Trials".to_string();
                item.inventory_type = Some(1);
                item.base_ilevel = Some(620);
                item
            }),
            (1002_u64, {
                let mut item = test_item(1002, Some(vec![72]), None);
                item.name = "Chest of Trials".to_string();
                item.inventory_type = Some(5);
                item.base_ilevel = Some(618);
                item
            }),
        ]));
        *state::CATALYST.write().unwrap() = Arc::new(state::CatalystData {
            tier_items: HashMap::from([
                (
                    (1_u64, 1_u64),
                    state::CatalystTierItem {
                        item_id: 99001,
                        name: "Tier Helm".to_string(),
                        icon: "inv_helmet".to_string(),
                        has_set: false,
                        bonus_ids: Vec::new(),
                    },
                ),
                (
                    (1_u64, 5_u64),
                    state::CatalystTierItem {
                        item_id: 99005,
                        name: "Tier Chest".to_string(),
                        icon: "inv_chest".to_string(),
                        has_set: false,
                        bonus_ids: Vec::new(),
                    },
                ),
            ]),
            tier_item_ids: HashSet::from([99001_u64, 99005_u64]),
            catalyst_currency_id: 0,
        });

        let (generated_input, combo_count, combo_metadata) = build_heatmap_profileset_input(
            "warrior=\"Tester\"\nspec=fury\nhead=id=1001,ilevel=620\nchest=id=1002,ilevel=618\n",
            "warrior",
            false,
            true,
            0,
            "",
            "",
            "auto",
            false,
        )
        .expect("tier heatmap input");

        assert_eq!(combo_count, 3);
        assert_eq!(combo_metadata.len(), 3);
        assert!(generated_input.contains("profileset.\"Heatmap Tier 1 | 1p\"+=head=,id=99001"));
        assert!(generated_input.contains("profileset.\"Heatmap Tier 2 | 1p\"+=chest=,id=99005"));
        assert!(generated_input.contains("profileset.\"Heatmap Tier 3 | 2p\"+=head=,id=99001"));
        assert!(generated_input.contains("profileset.\"Heatmap Tier 3 | 2p\"+=chest=,id=99005"));
        assert!(combo_metadata.values().all(|meta| {
            meta.iter()
                .any(|entry| entry.get("heatmap_kind") == Some(&Value::String("tier".to_string())))
        }));

        class_snapshot.restore();
        state_snapshot.restore();
    }
}

#[derive(Clone)]
struct HeatmapTrinketVariant {
    label: String,
    item: crate::types::ResolvedItem,
}

fn append_fallback_trinkets_from_encounter_drops(
    merged_drop_trinkets: &mut Vec<Value>,
    active_spec_id: Option<u64>,
    source_scope: &str,
    ignore_spec_restrictions: bool,
    selected_role_pools: &HashSet<TrinketRolePool>,
) {
    let selected_sources = selected_heatmap_source_types(source_scope);
    let include_raid = selected_sources.contains(&"raid");
    let include_dungeon = selected_sources.contains(&"dungeon");
    if !include_raid && !include_dungeon {
        return;
    }

    let instances = crate::item_db::instances();
    let mut raid_dungeon_encounters: HashSet<i64> = HashSet::new();
    let mut encounter_is_dungeon: HashMap<i64, bool> = HashMap::new();
    let mplus_ids = mplus_rotation_instance_ids();
    for inst in instances {
        let itype = inst.get("type").and_then(|v| v.as_str()).unwrap_or("");
        if itype != "raid" && itype != "dungeon" {
            continue;
        }
        if itype == "raid" && !include_raid {
            continue;
        }
        if itype == "dungeon" && !include_dungeon {
            continue;
        }
        if let Some(encs) = inst.get("encounters").and_then(|v| v.as_array()) {
            for enc in encs {
                if let Some(eid) = enc.get("id").and_then(|v| v.as_i64()) {
                    raid_dungeon_encounters.insert(eid);
                    encounter_is_dungeon.insert(eid, itype == "dungeon");
                }
            }
        }
    }

    let mut seen_item_ids: HashSet<u64> = merged_drop_trinkets
        .iter()
        .filter_map(|v| v.get("item_id").and_then(|id| id.as_u64()))
        .collect();

    let drops_by_encounter = crate::item_db::drops_by_encounter();
    for eid in raid_dungeon_encounters {
        let Some(items) = drops_by_encounter.get(&eid) else {
            continue;
        };
        for item in items {
            if item.inventory_type.unwrap_or(0) != 12 {
                continue;
            }
            if encounter_is_dungeon.get(&eid).copied().unwrap_or(false)
                && !item_has_mplus_rotation_source(item, &mplus_ids)
            {
                continue;
            }
            if !seen_item_ids.insert(item.id) {
                continue;
            }
            let specs = item.restriction_ids();
            if !item_specs_match_active_spec(&specs, active_spec_id, ignore_spec_restrictions) {
                continue;
            }
            if !item_specs_match_role_pools(&specs, selected_role_pools) {
                continue;
            }
            merged_drop_trinkets.push(json!({
                "item_id": item.id,
                "name": item.name,
                "icon": item.icon,
                "quality": item.quality,
                "ilevel": item.base_ilevel.unwrap_or(0),
                "specs": specs,
            }));
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn build_heatmap_profileset_input(
    simc_input: &str,
    class_name: &str,
    include_trinket_matrix: bool,
    include_tier_matrix: bool,
    heatmap_target_ilevel: i64,
    heatmap_trinket_sources: &str,
    heatmap_lock_trinket_slot: &str,
    heatmap_role_pools: &str,
    heatmap_ignore_spec_restrictions: bool,
) -> MatrixBuildResult {
    let parse_result = addon_parser::parse_simc_input(simc_input);
    let base_profile = parse_result.base_profile.clone();
    let resolved = gear_resolver::resolve_gear(&parse_result);

    let mut spec_name = parse_result
        .character
        .spec
        .as_deref()
        .unwrap_or_default()
        .to_string();
    if spec_name.is_empty() {
        spec_name = crate::types::class_data::detect_spec(simc_input).unwrap_or_default();
    }

    let (base_lines, equipped_gear, talents, _spec) =
        crate::profileset_generator::parser::parse_base_profile(&base_profile);

    let mut lines: Vec<String> = Vec::new();
    let mut combo_metadata: ComboMetadata = HashMap::new();

    lines.push("# Base Actor".to_string());
    lines.extend(base_lines);
    // Heatmap baseline must be the actual equipped setup from the input profile.
    // This keeps matrix deltas aligned with Top Gear expectations.
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

    let mut combo_index: usize = 2;

    let target_ilevel = if heatmap_target_ilevel > 0 {
        heatmap_target_ilevel
    } else {
        289
    };

    // ---------- Trinket matrix ----------
    if include_trinket_matrix {
        let mut trinket_variants: Vec<HeatmapTrinketVariant> = Vec::new();
        let mut seen_variant = HashSet::new();

        let mut merged_drop_trinkets: Vec<Value> = Vec::new();
        let class_spec_ids = crate::types::class_data::class_spec_ids(class_name, None);
        let spec_from_name = resolve_active_spec_id(class_name, &spec_name);
        let spec_from_talents =
            crate::profileset_generator::parser::extract_spec_id_from_talent_string(&talents)
                .filter(|sid| class_spec_ids.contains(sid));
        let active_spec_id = spec_from_name.or(spec_from_talents);
        if active_spec_id.is_none() {
            return Err(
                "Could not resolve active spec ID from SimC input; cannot safely filter trinkets."
                    .to_string(),
            );
        }
        let selected_role_pools = selected_heatmap_role_pools(heatmap_role_pools, active_spec_id);

        for source in selected_heatmap_source_types(heatmap_trinket_sources) {
            if let Some(drops) = game_data::get_drops_by_type(source, Some(class_name), None) {
                if let Some(arr) = drops.get("Trinket").and_then(|v| v.as_array()) {
                    for v in arr {
                        merged_drop_trinkets.push(v.clone());
                    }
                }
            }
        }
        append_fallback_trinkets_from_encounter_drops(
            &mut merged_drop_trinkets,
            active_spec_id,
            heatmap_trinket_sources,
            heatmap_ignore_spec_restrictions,
            &selected_role_pools,
        );

        let mut drop_specs_by_item: HashMap<u64, Vec<u64>> = HashMap::new();
        for trinket in &merged_drop_trinkets {
            let item_id = trinket.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
            if item_id == 0 {
                continue;
            }
            let Some(specs_arr) = trinket.get("specs").and_then(|v| v.as_array()) else {
                continue;
            };
            let parsed_specs: Vec<u64> = specs_arr.iter().filter_map(|v| v.as_u64()).collect();
            if parsed_specs.len() != specs_arr.len() {
                continue;
            }
            let entry = drop_specs_by_item.entry(item_id).or_default();
            for spec_id in parsed_specs {
                if !entry.contains(&spec_id) {
                    entry.push(spec_id);
                }
            }
        }

        if cfg!(debug_assertions) {
            let eligible_drop_count = merged_drop_trinkets
                .iter()
                .filter(|t| {
                    trinket_json_matches_active_spec(
                        t,
                        active_spec_id,
                        heatmap_ignore_spec_restrictions,
                        &selected_role_pools,
                    )
                })
                .count();
            println!(
                "[heatmap] class={} spec={} active_spec_id={:?} merged_drops={} eligible_drops={}",
                class_name,
                spec_name,
                active_spec_id,
                merged_drop_trinkets.len(),
                eligible_drop_count
            );
        }

        let mut add_variant = |item: crate::types::ResolvedItem| {
            if item.item_id == 0 || item.ilevel <= 0 {
                return;
            }
            if !item_id_matches_active_spec_with_lookup(
                item.item_id,
                active_spec_id,
                &drop_specs_by_item,
                heatmap_ignore_spec_restrictions,
                &selected_role_pools,
            ) {
                return;
            }
            let bonus_key = if item.bonus_ids.is_empty() {
                "0".to_string()
            } else {
                item.bonus_ids
                    .iter()
                    .map(|b| b.to_string())
                    .collect::<Vec<_>>()
                    .join("-")
            };
            let key = format!("{}:{}:{}", item.item_id, item.ilevel, bonus_key);
            if !seen_variant.insert(key) {
                return;
            }
            trinket_variants.push(HeatmapTrinketVariant {
                label: format!("{} ({})", item.name, item.ilevel),
                item,
            });
        };

        // Intentionally do NOT inject owned/equipped trinkets into this pool.
        // Upgrade Trinkets should reflect the selected drop-source pool only.

        for trinket in merged_drop_trinkets {
            if !trinket_json_matches_active_spec(
                &trinket,
                active_spec_id,
                heatmap_ignore_spec_restrictions,
                &selected_role_pools,
            ) {
                continue;
            }
            let item_id = trinket.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
            if item_id == 0 {
                continue;
            }
            let item_name = trinket
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown Trinket")
                .to_string();
            let item_icon = trinket
                .get("icon")
                .and_then(|v| v.as_str())
                .unwrap_or("inv_misc_questionmark")
                .to_string();
            let source_type = trinket
                .get("source_type")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_lowercase();
            let mut item_quality = trinket.get("quality").and_then(|v| v.as_i64()).unwrap_or(4);
            if source_type.contains("profession") {
                item_quality = 5;
            }
            let is_mplus_rotation = trinket
                .get("mplus_rotation")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            if (source_type == "dungeon" || source_type == "expansion-dungeon")
                && !is_mplus_rotation
            {
                continue;
            }
            let instance_name = trinket
                .get("instance_name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_lowercase();
            let is_world_boss_source = instance_name.contains("world boss")
                || source_type == "world_boss"
                || source_type == "world-boss";

            let difficulty_info = trinket.get("difficulty_info").and_then(|v| v.as_object());
            let dungeon_info = trinket.get("dungeon_info").and_then(|v| v.as_object());
            let mut added_for_item = false;
            let mut add_from_entry = |entry: &serde_json::Map<String, Value>| {
                let ilvl = entry.get("ilvl").and_then(|v| v.as_i64()).unwrap_or(0);
                let bonus_id = entry.get("bonus_id").and_then(|v| v.as_u64()).unwrap_or(0);
                if ilvl <= 0 {
                    return;
                }
                let entry_quality = entry
                    .get("quality")
                    .and_then(|v| v.as_i64())
                    .unwrap_or(item_quality);
                let item = make_resolved_item(
                    "trinket",
                    item_id,
                    ResolvedItemSeed {
                        name: item_name.clone(),
                        icon: item_icon.clone(),
                        quality: entry_quality,
                        ilevel: ilvl,
                        bonus_ids: if bonus_id > 0 { vec![bonus_id] } else { vec![] },
                    },
                    crate::types::ItemOrigin::Bags,
                    12,
                );
                add_variant(item);

                // Also add a "max-upgraded" variant for this drop bonus when applicable.
                // World boss drops are intentionally capped and should not be promoted.
                if bonus_id > 0 && !is_world_boss_source {
                    let max_bonus = crate::item_db::upgrade_bonus_ids_to_max(&[bonus_id]);
                    if max_bonus.len() == 1 && max_bonus[0] != bonus_id {
                        let max_ilvl = crate::item_db::get_item_info(item_id, Some(&max_bonus))
                            .map(|i| i.ilevel)
                            .unwrap_or(ilvl);
                        let upgraded = make_resolved_item(
                            "trinket",
                            item_id,
                            ResolvedItemSeed {
                                name: item_name.clone(),
                                icon: item_icon.clone(),
                                quality: item_quality,
                                ilevel: max_ilvl,
                                bonus_ids: max_bonus,
                            },
                            crate::types::ItemOrigin::Bags,
                            12,
                        );
                        add_variant(upgraded);
                    }
                }
                added_for_item = true;
            };

            if let Some(diff_obj) = difficulty_info {
                for diff_key in ["lfr", "normal", "heroic", "mythic"] {
                    let Some(entry) = diff_obj.get(diff_key).and_then(|v| v.as_object()) else {
                        continue;
                    };
                    add_from_entry(entry);
                }
            }
            if let Some(dungeon_obj) = dungeon_info {
                let mut entries: Vec<&serde_json::Map<String, Value>> =
                    dungeon_obj.values().filter_map(|v| v.as_object()).collect();
                entries
                    .sort_by_key(|entry| entry.get("ilvl").and_then(|v| v.as_i64()).unwrap_or(0));
                for entry in entries {
                    add_from_entry(entry);
                }
            }

            if !added_for_item {
                let ilvl = trinket.get("ilevel").and_then(|v| v.as_i64()).unwrap_or(0);
                if ilvl <= 0 {
                    continue;
                }
                let item = make_resolved_item(
                    "trinket",
                    item_id,
                    ResolvedItemSeed {
                        name: item_name.clone(),
                        icon: item_icon.clone(),
                        quality: item_quality,
                        ilevel: ilvl,
                        bonus_ids: vec![],
                    },
                    crate::types::ItemOrigin::Bags,
                    12,
                );
                add_variant(item);
            }
        }

        // Hard safety pass: nothing reaches SimC unless it matches the active spec.
        let pre_retain_count = trinket_variants.len();
        trinket_variants.retain(|variant| {
            item_id_matches_active_spec_with_lookup(
                variant.item.item_id,
                active_spec_id,
                &drop_specs_by_item,
                heatmap_ignore_spec_restrictions,
                &selected_role_pools,
            )
        });
        if cfg!(debug_assertions) {
            println!(
                "[heatmap] variants_pre_retain={} variants_post_retain={}",
                pre_retain_count,
                trinket_variants.len()
            );
        }

        // Keep one variant per item ID based on target ilvl.
        // Rule: use exact target ilvl when available;
        // else use highest available <= target;
        // else use lowest available > target.
        let mut best_by_item: HashMap<u64, HeatmapTrinketVariant> = HashMap::new();
        for variant in trinket_variants.drain(..) {
            let item_id = variant.item.item_id;
            match best_by_item.get(&item_id) {
                None => {
                    best_by_item.insert(item_id, variant);
                }
                Some(current) => {
                    let cand_ilvl = variant.item.ilevel;
                    let curr_ilvl = current.item.ilevel;

                    let cand_exact = cand_ilvl == target_ilevel;
                    let curr_exact = curr_ilvl == target_ilevel;
                    let cand_under = cand_ilvl <= target_ilevel;
                    let curr_under = curr_ilvl <= target_ilevel;

                    let pick_candidate = if cand_exact != curr_exact {
                        cand_exact
                    } else if cand_under != curr_under {
                        cand_under
                    } else if cand_under {
                        // both <= target: prefer higher ilvl
                        cand_ilvl > curr_ilvl
                    } else {
                        // both > target: prefer lower ilvl
                        cand_ilvl < curr_ilvl
                    };
                    if pick_candidate {
                        best_by_item.insert(item_id, variant);
                    }
                }
            }
        }
        trinket_variants = best_by_item.into_values().collect();

        // Respect the requested target ilvl as an upper bound whenever possible.
        // If we can still build a valid matrix with capped variants, drop entries above target.
        if target_ilevel > 0 {
            let capped: Vec<HeatmapTrinketVariant> = trinket_variants
                .iter()
                .filter(|v| v.item.ilevel <= target_ilevel)
                .cloned()
                .collect();
            if capped.len() >= 2 {
                trinket_variants = capped;
            }
        }

        let locked_slot = normalized_locked_trinket_slot(heatmap_lock_trinket_slot);

        if (locked_slot.is_none() && trinket_variants.len() < 2)
            || (locked_slot.is_some() && trinket_variants.is_empty())
        {
            return Err(
                "Not enough trinket variants were found for a heatmap with this character input."
                    .to_string(),
            );
        }

        trinket_variants.sort_by(|a, b| {
            b.item
                .ilevel
                .cmp(&a.item.ilevel)
                .then_with(|| a.item.name.cmp(&b.item.name))
        });
        trinket_variants.truncate(24);

        if let Some(slot) = locked_slot {
            let Some(fixed_item) = resolved
                .slots
                .get(slot)
                .and_then(|slot_res| slot_res.equipped.clone())
            else {
                return Err(format!(
                    "Could not resolve equipped {} for locked-slot trinket simulation.",
                    slot
                ));
            };
            let fixed = HeatmapTrinketVariant {
                label: format!("{} ({})", fixed_item.name, fixed_item.ilevel),
                item: fixed_item,
            };

            for cand in &trinket_variants {
                if cand.item.item_id == fixed.item.item_id {
                    continue;
                }

                let (t1, t2) = if slot == "trinket1" {
                    (&fixed, cand)
                } else {
                    (cand, &fixed)
                };

                let combo_name = format!(
                    "Heatmap Trinket {} | {} + {}",
                    combo_index - 1,
                    t1.label,
                    t2.label
                );
                lines.push(format!("### {}", combo_name));
                lines.push(format!(
                    "profileset.\"{}\"+=trinket1={}",
                    combo_name, t1.item.simc_string
                ));
                lines.push(format!(
                    "profileset.\"{}\"+=trinket2={}",
                    combo_name, t2.item.simc_string
                ));
                if !talents.is_empty() {
                    lines.push(format!(
                        "profileset.\"{}\"+=talents={}",
                        combo_name, talents
                    ));
                }
                lines.push(String::new());

                combo_metadata.insert(
                    combo_name.clone(),
                    vec![
                        crate::profileset_generator::writer::item_meta(&t1.item, "trinket1"),
                        crate::profileset_generator::writer::item_meta(&t2.item, "trinket2"),
                        json!({"heatmap_kind":"trinket"}),
                    ],
                );
                combo_index += 1;
            }
        } else {
            for i in 0..trinket_variants.len() {
                for j in (i + 1)..trinket_variants.len() {
                    let t1 = &trinket_variants[i];
                    let t2 = &trinket_variants[j];
                    let combo_name = format!(
                        "Heatmap Trinket {} | {} + {}",
                        combo_index - 1,
                        t1.label,
                        t2.label
                    );
                    lines.push(format!("### {}", combo_name));
                    lines.push(format!(
                        "profileset.\"{}\"+=trinket1={}",
                        combo_name, t1.item.simc_string
                    ));
                    lines.push(format!(
                        "profileset.\"{}\"+=trinket2={}",
                        combo_name, t2.item.simc_string
                    ));
                    if !talents.is_empty() {
                        lines.push(format!(
                            "profileset.\"{}\"+=talents={}",
                            combo_name, talents
                        ));
                    }
                    lines.push(String::new());

                    combo_metadata.insert(
                        combo_name.clone(),
                        vec![
                            crate::profileset_generator::writer::item_meta(&t1.item, "trinket1"),
                            crate::profileset_generator::writer::item_meta(&t2.item, "trinket2"),
                            json!({"heatmap_kind":"trinket"}),
                        ],
                    );
                    combo_index += 1;
                }
            }
        }
    }

    // ---------- Tier set matrix ----------
    if include_tier_matrix {
        let class_id = crate::types::class_data::class_wow_id(class_name).unwrap_or(0);
        if class_id > 0 {
            let tier_slots = ["head", "shoulder", "chest", "hands", "legs"];
            let mut tier_options: Vec<(String, crate::types::ResolvedItem)> = Vec::new();

            for slot in tier_slots {
                let Some(slot_res) = resolved.slots.get(slot) else {
                    continue;
                };
                let Some(equipped) = slot_res.equipped.as_ref() else {
                    continue;
                };
                let inv_type = gear_resolver::slot_to_inv_type(slot).unwrap_or(0);
                if inv_type == 0 {
                    continue;
                }
                let Some(tier_info) = crate::item_db::catalyst_tier_item(class_id, inv_type) else {
                    continue;
                };
                let mut converted = gear_resolver::build_catalyst_item(equipped, &tier_info, slot);
                converted.origin = crate::types::ItemOrigin::Bags;
                if converted.item_id == 0 || converted.simc_string.is_empty() {
                    continue;
                }
                tier_options.push((slot.to_string(), converted));
            }

            let n = tier_options.len();
            if n > 0 {
                for mask in 1..(1usize << n) {
                    if combo_index > 320 {
                        break;
                    }
                    let mut changed_meta: Vec<Value> = Vec::new();
                    let mut changed_slots: Vec<String> = Vec::new();
                    let piece_count = mask.count_ones();
                    let combo_name = format!("Heatmap Tier {} | {}p", combo_index - 1, piece_count);
                    lines.push(format!("### {}", combo_name));

                    for (idx, (slot, item)) in tier_options.iter().enumerate() {
                        if (mask & (1usize << idx)) == 0 {
                            continue;
                        }
                        changed_slots.push(slot.clone());
                        lines.push(format!(
                            "profileset.\"{}\"+={}={}",
                            combo_name, slot, item.simc_string
                        ));
                        changed_meta
                            .push(crate::profileset_generator::writer::item_meta(item, slot));
                    }
                    if !talents.is_empty() {
                        lines.push(format!(
                            "profileset.\"{}\"+=talents={}",
                            combo_name, talents
                        ));
                    }
                    lines.push(String::new());

                    changed_meta.push(json!({
                        "heatmap_kind":"tier",
                        "tier_pieces": piece_count,
                        "tier_slots": changed_slots,
                    }));
                    combo_metadata.insert(combo_name.clone(), changed_meta);
                    combo_index += 1;
                }
            }
        }
    }

    let combo_count = combo_index.saturating_sub(2);
    if combo_count == 0 {
        return Err("No heatmap combinations could be generated for this character.".to_string());
    }

    Ok((lines.join("\n"), combo_count, combo_metadata))
}

pub(super) async fn create_trinket_tier_heatmap_sim(
    simc_input: String,
    class_name: String,
    matrix_flags: (bool, bool),
    options: &SimOptions,
    store: web::Data<Arc<dyn JobStorage>>,
    simc_path: web::Data<PathBuf>,
    log_buffer: web::Data<Arc<LogBuffer>>,
) -> HttpResponse {
    let (include_trinket_matrix, include_tier_matrix) = matrix_flags;
    if !include_trinket_matrix && !include_tier_matrix {
        return HttpResponse::BadRequest().json(json!({
            "detail": "Enable at least one matrix option (Trinkets or Tier Sets)."
        }));
    }
    let (generated_input, combo_count, combo_metadata) = match build_heatmap_profileset_input(
        &simc_input,
        &class_name,
        include_trinket_matrix,
        include_tier_matrix,
        options.heatmap_target_ilevel,
        &options.heatmap_trinket_sources,
        &options.heatmap_lock_trinket_slot,
        &options.heatmap_role_pools,
        options.heatmap_ignore_spec_restrictions,
    ) {
        Ok(v) => v,
        Err(detail) => return HttpResponse::BadRequest().json(json!({ "detail": detail })),
    };

    let mut generated_input = inject_expert_fields(&generated_input, options);
    generated_input = apply_shared_simc_options(&generated_input, options, true);

    let resolved_threads = if options.threads == 0 {
        std::thread::available_parallelism()
            .map(|n| n.get() as u32)
            .unwrap_or(4)
    } else {
        options.threads
    };
    generated_input.push_str(&format!("\nthreads={}\n", resolved_threads));

    if let Some(resp) = validate_batch(&options.batch_id, store.get_ref().as_ref()) {
        return resp;
    }

    let mut job = Job::new(
        generated_input.clone(),
        "trinket_tier_heatmap".to_string(),
        options.iterations,
        options.fight_style.clone(),
        options.target_error,
    );
    job.options = Some(options.to_json_with_sim_type("trinket_tier_heatmap"));
    job.batch_id = options.batch_id.clone();
    let job_id = job.id.clone();
    let created_at = job.created_at.clone();

    let meta_json = serde_json::to_string(&json!({
        "_combo_metadata": combo_metadata,
        "_combo_count": combo_count,
    }))
    .unwrap_or_default();
    job.combo_metadata_json = Some(meta_json);
    store.insert(job);

    let simc_binary = match resolve_simc_binary_for_request(simc_path.get_ref(), options) {
        Ok(path) => path,
        Err(detail) => return HttpResponse::BadRequest().json(json!({ "detail": detail })),
    };

    spawn_staged_sim(
        store.get_ref().clone(),
        simc_binary,
        options.to_json_with_sim_type("trinket_tier_heatmap"),
        job_id.clone(),
        generated_input,
        combo_count,
        log_buffer.get_ref().clone(),
    );

    HttpResponse::Ok().json(SimResponse {
        id: job_id,
        status: "pending".to_string(),
        created_at,
    })
}
