//! Game data facade — re-exports item_db lookups and contains drop-resolver logic.

mod catalyst;
mod drop_queries;
mod drops;
pub(crate) mod instance_drops;

pub use drop_queries::{get_drops_by_instances, get_drops_by_type};
pub use instance_drops::{get_instance_drops, get_instances};

// ---- Re-exports from item_db ----

pub use crate::item_db::{
    apply_copy_enchants, apply_copy_enchants_to_map, catalyst_currency_id, catalyst_tier_item,
    get_currency_info, get_enchant_info, get_gem_info, get_inventory_type, get_item_armor_subclass,
    get_item_info, get_item_limit_categories, get_upgrade_cost_between, get_upgrade_options,
    get_upgrade_tracks, is_catalyst_tier_item, list_embellishments_for_item, load, talent_tree,
    upgrade_bonus_ids_to_max, upgrade_items_by_slot, upgrade_simc_input, CatalystTierItem,
    UpgradeOption,
};

pub use crate::types::class_data::{quality_name, QUALITY_NAMES};

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game_data::drops::*;
    use crate::item_db::state;
    use crate::types::class_data::{self, ClassDef, SpecDef};
    use crate::types::{GameItem, GameItemStat, ItemSource};
    use serde_json::{json, Value};
    use std::collections::{HashMap, HashSet};
    use std::fs;
    use std::sync::Arc;

    struct GameDataSnapshot {
        instances: Vec<Value>,
        drops_by_encounter: Arc<HashMap<i64, Vec<GameItem>>>,
        season_config: Value,
        upgrade_tracks: Arc<HashMap<state::UpgradeTrackKey, state::UpgradeTrackValue>>,
        bonuses: Arc<HashMap<u64, crate::types::BonusData>>,
        catalyst: Arc<state::CatalystData>,
        current_season_id: u64,
        items: Arc<HashMap<u64, GameItem>>,
    }

    impl GameDataSnapshot {
        fn capture() -> Self {
            Self {
                instances: state::INSTANCES.read().unwrap().clone(),
                drops_by_encounter: state::DROPS_BY_ENCOUNTER.read().unwrap().clone(),
                season_config: state::SEASON_CONFIG.read().unwrap().clone(),
                upgrade_tracks: state::UPGRADE_TRACKS.read().unwrap().clone(),
                bonuses: state::BONUSES.read().unwrap().clone(),
                catalyst: state::CATALYST.read().unwrap().clone(),
                current_season_id: *state::CURRENT_SEASON_ID.read().unwrap(),
                items: state::ITEMS.read().unwrap().clone(),
            }
        }

        fn restore(self) {
            *state::INSTANCES.write().unwrap() = self.instances;
            *state::DROPS_BY_ENCOUNTER.write().unwrap() = self.drops_by_encounter;
            *state::SEASON_CONFIG.write().unwrap() = self.season_config;
            *state::UPGRADE_TRACKS.write().unwrap() = self.upgrade_tracks;
            *state::BONUSES.write().unwrap() = self.bonuses;
            *state::CATALYST.write().unwrap() = self.catalyst;
            *state::CURRENT_SEASON_ID.write().unwrap() = self.current_season_id;
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

    fn game_item(
        id: u64,
        name: &str,
        quality: u64,
        ilevel: i64,
        item_class: i64,
        subclass: i64,
        inventory_type: i64,
    ) -> GameItem {
        GameItem {
            id,
            name: name.to_string(),
            icon: format!("icon_{id}"),
            quality,
            base_ilevel: Some(ilevel),
            class: Some(item_class),
            subclass: Some(subclass),
            inventory_type: Some(inventory_type),
            set_id: None,
            has_sockets: false,
            socket_info: None,
            classes: None,
            specs: None,
            stats: None,
            bonus_lists: Vec::new(),
            sources: None,
            profession: None,
        }
    }

    fn install_class_fixture() {
        *class_data::CLASSES.write().unwrap() = Arc::new(vec![ClassDef {
            name: "warrior".to_string(),
            aliases: vec![],
            max_armor: 4,
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

    fn install_track_fixture() {
        *state::UPGRADE_TRACKS.write().unwrap() = Arc::new(HashMap::from([
            (
                ("LfrTrack".to_string(), 4_u64, 6_u64),
                (610_u64, 8001_u64, 3_u64),
            ),
            (
                ("NormalTrack".to_string(), 4_u64, 6_u64),
                (620_u64, 8002_u64, 4_u64),
            ),
            (
                ("HeroTrack".to_string(), 4_u64, 6_u64),
                (630_u64, 8003_u64, 4_u64),
            ),
            (
                ("MythTrack".to_string(), 4_u64, 6_u64),
                (640_u64, 8004_u64, 5_u64),
            ),
            (
                ("Champion".to_string(), 1_u64, 6_u64),
                (615_u64, 8010_u64, 4_u64),
            ),
        ]));
        *state::SEASON_CONFIG.write().unwrap() = json!({
            "raidDifficulties": [
                {"key":"lfr","track":"LfrTrack"},
                {"key":"normal","track":"NormalTrack"},
                {"key":"heroic","track":"HeroTrack"},
                {"key":"mythic","track":"MythTrack"}
            ],
            "encounterUpgradeLevel": {"2001": 4},
            "dungeonNormal": {"ilvl": 600, "quality": 3},
            "dungeonDifficultyTracks": {
                "heroic": {"track":"HeroTrack","level":4},
                "mythic": {"track":"MythTrack","level":4}
            },
            "worldBossTrack":"Champion",
            "worldBossLevel":1
        });
    }

    #[test]
    fn helper_scoring_and_key_functions_cover_branch_logic() {
        assert!(restrictions_match_active_specs(&[], &[], None));
        assert!(!restrictions_match_active_specs(&[72], &[], Some(1)));
        assert!(restrictions_match_active_specs(&[72], &[72], Some(1)));
        assert!(restrictions_match_active_specs(&[1], &[], Some(1)));
        assert!(!restrictions_match_active_specs(&[2], &[], Some(1)));

        let mut item = game_item(1, "  Edge   Case  ", 4, 620, 2, 4, 13);
        item.stats = Some(vec![GameItemStat { id: 4, alloc: None }]);
        assert!(item_matches_primary_stats(&item, &HashSet::from([4])));
        assert!(!item_matches_primary_stats(&item, &HashSet::from([5])));
        item.stats = None;
        assert!(item_matches_primary_stats(&item, &HashSet::from([5])));
        item.stats = Some(vec![GameItemStat {
            id: 999,
            alloc: None,
        }]);
        assert!(item_matches_primary_stats(&item, &HashSet::from([5])));

        assert!(primary_stat_filtered_slot(2, 13));
        assert!(primary_stat_filtered_slot(4, 12));
        assert!(!primary_stat_filtered_slot(4, 1));
        assert_eq!(
            normalize_drop_key_part("  Multi   Space  Name "),
            "multi space name"
        );
        assert_eq!(
            canonical_drop_key(7, &game_item(9, " Name ", 4, 1, 2, 3, 4)),
            "7|4|2|3|name"
        );

        let score =
            drop_candidate_score(&game_item(9, "X", 4, 620, 2, 4, 13), true, true, true, true);
        assert!(score > 40620);
        let value = json!({
            "quality": 4,
            "ilevel": 620,
            "can_catalyst": true,
            "is_catalyst": true,
            "difficulty_info": {"mythic": {"ilvl": 640}},
            "dungeon_info": {"heroic": {"ilvl": 630}}
        });
        assert!(drop_value_score(&value) > 40620);
        assert_eq!(
            drop_value_dedupe_key(
                "Head",
                &json!({
                    "name":"  Alpha   Helm ",
                    "encounter":"  BOSS ",
                    "instance_name":" Raid One ",
                    "inventory_type":1
                })
            ),
            "head|alpha helm|boss|raid one|1"
        );
    }

    #[test]
    fn merge_and_finalize_slot_map_dedupes_and_orders_entries() {
        let mut merged: HashMap<String, HashMap<String, (i64, Value)>> = HashMap::new();
        merge_drop_map_into(
            &mut merged,
            &serde_json::Map::from_iter([(
                "Head".to_string(),
                json!([
                    {"name":"Alpha Helm","encounter":"Boss","instance_name":"Raid","inventory_type":1,"quality":4,"ilevel":620},
                    {"name":"Alpha Helm","encounter":"Boss","instance_name":"Raid","inventory_type":1,"quality":4,"ilevel":625}
                ]),
            )]),
        );

        let ordered = finalize_slot_map(merged);
        let head = ordered
            .get("Head")
            .and_then(Value::as_array)
            .expect("head slot");
        assert_eq!(head.len(), 1);
        assert_eq!(head[0].get("ilevel").and_then(Value::as_i64), Some(625));

        let custom = finalize_slot_map(HashMap::from([(
            "Custom Slot".to_string(),
            HashMap::from([(
                "k".to_string(),
                (1_i64, json!({"name":"Custom","ilevel":500})),
            )]),
        )]));
        assert!(custom.contains_key("Custom Slot"));
    }

    #[test]
    fn get_instances_uses_wow_content_files_with_mplus_bucket() {
        let _state_guard = state::TEST_STATE_LOCK
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        let snapshot = GameDataSnapshot::capture();
        let temp = tempfile::tempdir().expect("temp dir");
        let wow_dir = temp.path().join("wow");
        fs::create_dir_all(&wow_dir).expect("wow dir");
        fs::write(
            wow_dir.join("wow-instances.json"),
            serde_json::to_string(&json!([
                {"id": 9001, "name": "AppData Raid", "type": "raid", "expansionId": 516},
                {"id": 9002, "name": "AppData Dungeon", "type": "dungeon", "expansionId": 516}
            ]))
            .expect("instances json"),
        )
        .expect("write instances");
        fs::write(
            wow_dir.join("wow-encounters.json"),
            serde_json::to_string(&json!([
                {"id": 9101, "instanceId": 9001, "name": "Raid Boss"},
                {"id": 9102, "instanceId": 9002, "name": "Dungeon Boss"}
            ]))
            .expect("encounters json"),
        )
        .expect("write encounters");
        fs::write(
            wow_dir.join("wow-seasons.json"),
            serde_json::to_string(&json!([
                {"slug": "appdata-season", "name": "AppData Season", "expansionId": 516, "mythicPlusDungeonIds": [9002]}
            ]))
            .expect("seasons json"),
        )
        .expect("write seasons");
        fs::write(wow_dir.join("wow-mythic-plus-dungeons.json"), "[]")
            .expect("write mplus mappings");
        crate::item_db::loader::load_instances(temp.path());

        let rows = get_instances();
        assert!(rows
            .iter()
            .any(|row| row.get("name").and_then(Value::as_str) == Some("AppData Raid")));

        let mplus_bucket = rows
            .iter()
            .find(|row| row.get("name").and_then(Value::as_str) == Some("Mythic+ Dungeons"))
            .expect("mplus bucket");
        assert_eq!(
            mplus_bucket.get("type").and_then(Value::as_str),
            Some("mplus-chest")
        );
        let mplus_ids: Vec<i64> = mplus_bucket
            .get("encounters")
            .and_then(Value::as_array)
            .expect("mplus encounters")
            .iter()
            .filter_map(|encounter| encounter.get("id").and_then(Value::as_i64))
            .collect();
        assert_eq!(mplus_ids, vec![9002]);

        let serialized = serde_json::to_string(&rows).expect("instances json");
        assert!(!serialized.contains("wowheadUrl"));
        assert!(!serialized.contains("raiderIoUrl"));
        assert!(!serialized.contains("warcraftLogsUrl"));
        snapshot.restore();
    }

    #[test]
    fn drop_queries_cover_raid_profession_catalyst_and_multi_instance_paths() {
        let _state_guard = state::TEST_STATE_LOCK
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        let _class_guard = class_data::TEST_CLASS_DATA_LOCK
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        let snapshot = GameDataSnapshot::capture();
        let class_snapshot = ClassSnapshot::capture();

        install_class_fixture();
        install_track_fixture();
        *state::CURRENT_SEASON_ID.write().unwrap() = 13;
        *state::BONUSES.write().unwrap() = Arc::new(HashMap::new());

        let mut catalyst = state::CatalystData::default();
        catalyst.tier_items.insert(
            (1, 1),
            state::CatalystTierItem {
                item_id: 90001,
                name: "Tier Warhelm".to_string(),
                icon: "tier_icon".to_string(),
                has_set: true,
                bonus_ids: vec![12345],
            },
        );
        catalyst.tier_item_ids.insert(90001);
        *state::CATALYST.write().unwrap() = Arc::new(catalyst);

        *state::ITEMS.write().unwrap() = Arc::new(HashMap::from([(
            90001,
            game_item(90001, "Tier Warhelm", 4, 630, 4, 4, 1),
        )]));

        *state::INSTANCES.write().unwrap() = vec![
            json!({"id": 100, "name":"Raid Alpha", "type":"raid", "encounters":[{"id":1001,"name":"Boss Alpha"}]}),
            json!({"id": 11, "name":"World Bosses", "type":"raid", "encounters":[{"id":1101,"name":"WB Alpha"}]}),
            json!({"id": 200, "name":"Leatherworking Workshop", "type":"profession", "encounters":[{"id":2001,"name":"Pattern"}]}),
            json!({"id": 30, "name":"Dungeon Prime", "type":"dungeon", "encounters":[{"id":3001,"name":"Final Boss"}], "active_rotation": true}),
            json!({"id": -1, "name":"Mythic Plus", "type":"mythic_plus", "encounters":[{"id":30,"name":"Dungeon Prime"}]}),
            json!({"id": -2, "name":"Meta Pool", "type":"pool", "encounters":[{"id":30,"name":"Dungeon Prime"}]}),
        ];

        let mut raid_good = game_item(5001, "Warhelm of Strength", 4, 620, 4, 4, 1);
        raid_good.specs = Some(vec![72]);
        raid_good.stats = Some(vec![GameItemStat { id: 4, alloc: None }]);

        let raid_bad_armor = game_item(5002, "Leather Hat", 4, 619, 4, 2, 1);
        let mut raid_bad_trinket = game_item(5003, "Int Trinket", 4, 621, 4, 0, 12);
        raid_bad_trinket.stats = Some(vec![GameItemStat { id: 5, alloc: None }]);
        let mut raid_good_trinket = game_item(5004, "Strength Trinket", 4, 622, 4, 0, 12);
        raid_good_trinket.stats = Some(vec![GameItemStat { id: 4, alloc: None }]);

        let mut world_boss_item = game_item(5101, "World Helm", 4, 615, 4, 4, 1);
        world_boss_item.specs = Some(vec![72]);

        let mut profession_item = game_item(5201, "Forged Breastplate", 5, 625, 4, 4, 5);
        profession_item.stats = Some(vec![GameItemStat { id: 4, alloc: None }]);
        profession_item.sources = Some(vec![ItemSource {
            encounter_id: Some(2001),
            instance_id: Some(30),
        }]);

        let mut meta_item = game_item(5301, "Meta Axe", 4, 624, 2, 4, 13);
        meta_item.stats = Some(vec![GameItemStat { id: 4, alloc: None }]);

        *state::DROPS_BY_ENCOUNTER.write().unwrap() = Arc::new(HashMap::from([
            (
                1001_i64,
                vec![
                    raid_good,
                    raid_bad_armor,
                    raid_bad_trinket,
                    raid_good_trinket,
                ],
            ),
            (1101_i64, vec![world_boss_item]),
            (2001_i64, vec![profession_item]),
            (30_i64, vec![meta_item]),
        ]));

        let raid = get_instance_drops(100, Some("warrior"), Some("fury")).expect("raid drops");
        let raid_head = raid
            .get("Head")
            .and_then(Value::as_array)
            .expect("head slot");
        assert_eq!(raid_head.len(), 1);
        assert_eq!(
            raid_head[0].get("item_id").and_then(Value::as_u64),
            Some(5001)
        );
        assert_eq!(
            raid_head[0].get("can_catalyst").and_then(Value::as_bool),
            Some(true)
        );
        assert!(raid_head[0].get("difficulty_info").is_some());
        let raid_trinkets = raid
            .get("Trinket")
            .and_then(Value::as_array)
            .expect("trinket slot");
        assert_eq!(raid_trinkets.len(), 1);
        assert_eq!(
            raid_trinkets[0].get("item_id").and_then(Value::as_u64),
            Some(5004)
        );

        let world_boss = get_instance_drops(11, Some("warrior"), Some("fury")).expect("wb drops");
        let wb_head = world_boss
            .get("Head")
            .and_then(Value::as_array)
            .and_then(|arr| arr.first())
            .expect("wb head");
        assert_eq!(
            wb_head.get("instance_name").and_then(Value::as_str),
            Some("World Bosses")
        );
        assert!(wb_head
            .get("difficulty_info")
            .and_then(Value::as_object)
            .is_some_and(|obj| obj.contains_key("normal")));

        let profession = get_drops_by_type("profession", Some("warrior"), Some("fury"))
            .expect("profession drops");
        let prof_head_or_chest = profession
            .values()
            .find_map(|v| v.as_array())
            .and_then(|arr| arr.first())
            .expect("profession item");
        assert!(prof_head_or_chest.get("difficulty_info").is_some());
        assert_eq!(
            prof_head_or_chest
                .get("mplus_rotation")
                .and_then(Value::as_bool),
            Some(true)
        );

        let catalyst =
            get_drops_by_type("catalyst", Some("warrior"), Some("fury")).expect("catalyst drops");
        let catalyst_head = catalyst
            .get("Head")
            .and_then(Value::as_array)
            .and_then(|arr| arr.first())
            .expect("catalyst head");
        assert_eq!(
            catalyst_head.get("item_id").and_then(Value::as_u64),
            Some(90001)
        );
        assert_eq!(
            catalyst_head.get("is_catalyst").and_then(Value::as_bool),
            Some(true)
        );

        // Remove tier item from item DB to cover catalyst fallback naming branch.
        *state::ITEMS.write().unwrap() = Arc::new(HashMap::new());
        let catalyst_fallback = get_drops_by_type("catalyst", Some("warrior"), Some("fury"))
            .expect("catalyst fallback");
        let catalyst_fallback_head = catalyst_fallback
            .get("Head")
            .and_then(Value::as_array)
            .and_then(|arr| arr.first())
            .expect("catalyst fallback head");
        assert_eq!(
            catalyst_fallback_head.get("name").and_then(Value::as_str),
            Some("Tier Warhelm")
        );

        let multi = get_drops_by_instances(&[100, 100, 11], Some("warrior"), Some("fury"))
            .expect("multi drops");
        assert!(multi.contains_key("Head"));

        let meta = get_instance_drops(-2, Some("warrior"), Some("fury")).expect("meta drops");
        let meta_weapon = meta
            .get("Main Hand")
            .and_then(Value::as_array)
            .and_then(|arr| arr.first())
            .expect("meta weapon");
        assert_eq!(
            meta_weapon.get("instance_name").and_then(Value::as_str),
            Some("Dungeon Prime")
        );
        assert_eq!(
            meta_weapon.get("instance_id").and_then(Value::as_i64),
            Some(30)
        );

        assert!(get_instance_drops(9999, Some("warrior"), Some("fury")).is_none());
        assert!(get_drops_by_type("unknown", Some("warrior"), Some("fury")).is_none());
        assert!(get_drops_by_instances(&[], Some("warrior"), Some("fury")).is_none());
        assert!(get_drops_by_type("catalyst", None, Some("fury")).is_none());
        assert!(get_drops_by_type("catalyst", Some("warrior"), None).is_some());

        class_snapshot.restore();
        snapshot.restore();
    }
}
