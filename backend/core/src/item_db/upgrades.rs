use super::state::*;
use serde_json::{json, Value};
use std::collections::HashMap;

pub fn encounter_upgrade_level(encounter_id: i64) -> Option<u64> {
    let cfg = super::season_cfg();
    if cfg.get("upgradeRulesAvailable").and_then(Value::as_bool) == Some(false) {
        return None;
    }

    // Current config shape: explicit encounter -> upgrade level map.
    if let Some(map) = cfg.get("encounterUpgradeLevel").and_then(|v| v.as_object()) {
        if let Some(level) = map.get(&encounter_id.to_string()).and_then(|v| v.as_u64()) {
            return Some(level);
        }
    }

    // Legacy fallback shape.
    if let Some(raid_diffs) = cfg.get("raidDifficulties").and_then(|v| v.as_array()) {
        for diff in raid_diffs {
            let encounters = match diff.get("encounters").and_then(|v| v.as_array()) {
                Some(v) => v,
                None => continue,
            };
            for e in encounters {
                if e.as_i64() == Some(encounter_id) {
                    if let Some(level) = diff.get("upgradeLevel").and_then(|v| v.as_u64()) {
                        return Some(level);
                    }
                }
            }
        }
    }
    None
}

pub fn difficulty_track_name(difficulty: &str) -> Option<String> {
    let cfg = super::season_cfg();
    if cfg.get("upgradeRulesAvailable").and_then(Value::as_bool) == Some(false) {
        return None;
    }
    let raid_diffs = cfg.get("raidDifficulties")?.as_array()?;
    for diff in raid_diffs {
        let key = diff.get("key").and_then(|n| n.as_str());
        let legacy_name = diff.get("name").and_then(|n| n.as_str());
        if key == Some(difficulty) || legacy_name == Some(difficulty) {
            return diff
                .get("track")
                .and_then(|t| t.as_str())
                .map(|s| s.to_string());
        }
    }
    None
}

pub fn dungeon_normal_ilvl() -> u64 {
    let cfg = super::season_cfg();
    cfg.get("dungeonNormal")
        .and_then(|v| v.get("ilvl"))
        .and_then(|v| v.as_u64())
        .or_else(|| cfg.get("dungeonNormalIlvl").and_then(|v| v.as_u64()))
        .unwrap_or(0)
}

pub fn dungeon_normal_quality() -> u64 {
    let cfg = super::season_cfg();
    cfg.get("dungeonNormal")
        .and_then(|v| v.get("quality"))
        .and_then(|v| v.as_u64())
        .or_else(|| cfg.get("dungeonNormalQuality").and_then(|v| v.as_u64()))
        .unwrap_or(3)
}

pub fn get_upgrade_tracks() -> Value {
    if super::season_cfg()
        .get("upgradeRulesAvailable")
        .and_then(Value::as_bool)
        == Some(false)
    {
        return json!([]);
    }
    let tracks = UPGRADE_TRACKS.read().unwrap();
    let mut result = Vec::new();
    let mut tracks_vec: Vec<_> = tracks.iter().collect();
    tracks_vec.sort_by(|((n1, l1, m1), _), ((n2, l2, m2), _)| {
        n1.cmp(n2).then(l1.cmp(l2)).then(m1.cmp(m2))
    });

    for ((name, level, max), (ilvl, bonus_id, quality)) in tracks_vec {
        result.push(json!({
            "name": name,
            "level": level,
            "max": max,
            "itemLevel": ilvl,
            "bonus_id": bonus_id,
            "quality": quality,
        }));
    }
    json!(result)
}

pub fn upgrade_bonus_ids_to_max(bonus_ids: &[u64]) -> Vec<u64> {
    let max_map = UPGRADE_MAX.read().unwrap();

    let mut result = Vec::new();
    for &bid in bonus_ids {
        if let Some(&max_bid) = max_map.get(&bid) {
            result.push(max_bid);
        } else {
            result.push(bid);
        }
    }
    result
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct UpgradeOption {
    pub level: u64,
    pub max_level: u64,
    pub ilevel: u64,
    pub bonus_id: u64,
    pub quality: u64,
    pub name: String,
    pub cumulative_costs: HashMap<u64, u64>,
}

fn parse_track_name_and_max(full_name: &str) -> Option<(String, u64)> {
    let mut parts = full_name.split_whitespace();
    let name = parts.next()?.to_string();
    let rank = parts.next()?;
    let max_level = rank.split_once('/')?.1.parse().ok()?;
    Some((name, max_level))
}

pub fn get_upgrade_options(bonus_ids: &[u64]) -> Vec<UpgradeOption> {
    let bonuses = BONUSES.read().unwrap();
    let tracks = UPGRADE_TRACKS.read().unwrap();

    let mut current_track: Option<(String, u64, u64, Option<u64>)> = None;
    for &bid in bonus_ids {
        if let Some(bonus) = bonuses.get(&bid) {
            if let Some(upgrade) = &bonus.upgrade {
                if let (Some(full_name), Some(group), Some(level)) =
                    (&upgrade.full_name, upgrade.group, upgrade.level)
                {
                    let track_name = full_name
                        .split_whitespace()
                        .next()
                        .map(str::to_string)
                        .unwrap_or_default();
                    if track_name.is_empty() {
                        continue;
                    }
                    let max_level = parse_track_name_and_max(full_name).map(|(_, max)| max);
                    current_track = Some((track_name, group, level, max_level));
                    break;
                }
            }
        }
    }

    let (track_name, group_id, current_level, max_level_hint) = match current_track {
        Some(t) => t,
        None => return vec![],
    };

    // The same track names are reused between seasons. Use the equipped
    // bonus's own `X/Y` metadata instead of the globally most common max.
    let max_level = max_level_hint.unwrap_or_else(|| {
        bonuses
            .values()
            .filter_map(|bonus| bonus.upgrade.as_ref())
            .filter(|upgrade| {
                upgrade.group == Some(group_id)
                    && upgrade
                        .full_name
                        .as_deref()
                        .is_some_and(|name| name.starts_with(&format!("{} ", track_name)))
            })
            .filter_map(|upgrade| upgrade.level)
            .max()
            .or_else(|| {
                tracks
                    .keys()
                    .filter(|(name, _, _)| name == &track_name)
                    .map(|(_, _, max)| *max)
                    .max()
            })
            .unwrap_or(current_level)
    });

    let costs_map = UPGRADE_STEP_COSTS.read().unwrap();
    build_upgrade_options(
        bonus_ids,
        &bonuses,
        &tracks,
        &costs_map,
        &track_name,
        group_id,
        current_level,
        max_level,
    )
}

fn build_upgrade_options(
    bonus_ids: &[u64],
    bonuses: &HashMap<u64, crate::types::BonusData>,
    tracks: &HashMap<UpgradeTrackKey, UpgradeTrackValue>,
    costs_map: &HashMap<u64, HashMap<u64, u64>>,
    track_name: &str,
    group_id: u64,
    current_level: u64,
    max_level: u64,
) -> Vec<UpgradeOption> {
    let mut options = Vec::new();
    // Include the current level as the first option so UIs can identify
    // which existing bonus_id should be replaced when applying an upgrade.
    for l in current_level..=max_level {
        let metadata_bonus = bonuses
            .iter()
            .filter_map(|(bid, bonus)| {
                let upgrade = bonus.upgrade.as_ref()?;
                if upgrade.group != Some(group_id) || upgrade.level != Some(l) {
                    return None;
                }
                let full_name = upgrade.full_name.as_deref()?;
                full_name
                    .starts_with(&format!("{} ", track_name))
                    .then_some((*bid, bonus))
            })
            .min_by_key(|(bid, _)| *bid);
        let current_bonus = bonus_ids.iter().find_map(|bid| {
            bonuses.get(bid).and_then(|bonus| {
                bonus.upgrade.as_ref().and_then(|upgrade| {
                    (upgrade.group == Some(group_id) && upgrade.level == Some(l))
                        .then_some((*bid, bonus))
                })
            })
        });
        let bonus = current_bonus.or(metadata_bonus);
        let track_value = tracks.get(&(track_name.to_string(), l, max_level)).copied();

        let (bonus_id, bonus_ilevel, bonus_quality, bonus_name) = match bonus {
            Some((bid, bonus)) => {
                let upgrade = bonus.upgrade.as_ref();
                (
                    bid,
                    upgrade.and_then(|value| value.ilevel),
                    bonus.quality,
                    upgrade.and_then(|value| value.full_name.clone()),
                )
            }
            None => (0, None, None, None),
        };
        let (track_ilevel, track_bonus_id, track_quality) = track_value.unwrap_or((0, 0, 4));
        let Some(ilevel) = bonus_ilevel.or((track_ilevel > 0).then_some(track_ilevel)) else {
            continue;
        };
        let resolved_bonus_id = if bonus_id > 0 {
            bonus_id
        } else {
            track_bonus_id
        };
        if resolved_bonus_id == 0 {
            continue;
        }

        // Calculate cumulative costs from current_level to l.
        let mut cumulative_costs = HashMap::new();
        for (bid, bonus) in bonuses.iter() {
            if bonus.upgrade.as_ref().is_some_and(|upgrade| {
                upgrade.group == Some(group_id)
                    && upgrade
                        .level
                        .is_some_and(|level| level > current_level && level <= l)
            }) {
                if let Some(step_cost) = costs_map.get(bid) {
                    for (&cid, &amount) in step_cost {
                        *cumulative_costs.entry(cid).or_default() += amount;
                    }
                }
            }
        }

        options.push(UpgradeOption {
            level: l,
            max_level,
            ilevel,
            bonus_id: resolved_bonus_id,
            quality: bonus_quality.unwrap_or(track_quality),
            name: bonus_name.unwrap_or_else(|| format!("{} {}/{}", track_name, l, max_level)),
            cumulative_costs,
        });
    }
    options
}

pub fn describe_upgrade_from_bonus_ids(bonus_ids: &[u64]) -> Option<String> {
    let bonuses = BONUSES.read().unwrap();
    for &bid in bonus_ids {
        let bonus = bonuses.get(&bid)?;
        let upgrade = bonus.upgrade.as_ref()?;
        let full_name = upgrade.full_name.as_ref()?;
        if !full_name.trim().is_empty() {
            return Some(full_name.trim().to_string());
        }
    }
    None
}

pub fn get_upgrade_cost_between(from_bonus_id: u64, to_bonus_id: u64) -> HashMap<u64, u64> {
    let bonuses = BONUSES.read().unwrap();
    let costs_map = UPGRADE_STEP_COSTS.read().unwrap();

    let mut from_info = None;
    let mut to_info = None;

    if let Some(bonus) = bonuses.get(&from_bonus_id) {
        if let Some(u) = &bonus.upgrade {
            if let (Some(g), Some(l)) = (u.group, u.level) {
                from_info = Some((g, l));
            }
        }
    }
    if let Some(bonus) = bonuses.get(&to_bonus_id) {
        if let Some(u) = &bonus.upgrade {
            if let (Some(g), Some(l)) = (u.group, u.level) {
                to_info = Some((g, l));
            }
        }
    }

    let (group, start_level, end_level) = match (from_info, to_info) {
        (Some((g1, l1)), Some((g2, l2))) if g1 == g2 && l2 > l1 => (g1, l1, l2),
        _ => return HashMap::new(),
    };

    let mut total_costs = HashMap::new();
    for bid in bonuses.keys() {
        if let Some(bonus) = bonuses.get(bid) {
            if let Some(u) = &bonus.upgrade {
                if u.group == Some(group)
                    && u.level.is_some_and(|l| l > start_level && l <= end_level)
                {
                    if let Some(step_cost) = costs_map.get(bid) {
                        for (&cid, &amt) in step_cost {
                            *total_costs.entry(cid).or_default() += amt;
                        }
                    }
                }
            }
        }
    }
    total_costs
}

pub fn get_currency_info(currency_id: u64) -> Option<(String, String)> {
    CURRENCY_INFO.read().unwrap().get(&currency_id).cloned()
}

pub fn upgrade_simc_input(input: &str) -> String {
    let mut output = String::new();
    for line in input.lines() {
        if line.starts_with("#") || line.trim().is_empty() {
            output.push_str(line);
            output.push('\n');
            continue;
        }
        if let Some(idx) = line.find(",bonus_id=") {
            let prefix = &line[..idx + 10];
            let rest = &line[idx + 10..];
            let end_idx = rest.find(',').unwrap_or(rest.len());
            let bonus_str = &rest[..end_idx];
            let suffix = &rest[end_idx..];

            let bids: Vec<u64> = bonus_str
                .split('/')
                .filter_map(|s| s.parse().ok())
                .collect();
            let upgraded = upgrade_bonus_ids_to_max(&bids);
            let upgraded_str = upgraded
                .iter()
                .map(|b| b.to_string())
                .collect::<Vec<_>>()
                .join("/");

            output.push_str(prefix);
            output.push_str(&upgraded_str);
            output.push_str(suffix);
        } else {
            output.push_str(line);
        }
        output.push('\n');
    }
    output
}

use crate::types::ResolvedItem;

pub fn upgrade_items_by_slot(
    mut items: HashMap<String, Vec<ResolvedItem>>,
) -> HashMap<String, Vec<ResolvedItem>> {
    for (_slot, list) in items.iter_mut() {
        for item in list {
            let upgraded_bids = upgrade_bonus_ids_to_max(&item.bonus_ids);
            if upgraded_bids != item.bonus_ids {
                item.bonus_ids = upgraded_bids;
                // Update simc_string to match new bonus IDs
                let mut parts: Vec<String> = vec![format!("item={}", item.item_id)];
                let mut bids_sorted = item.bonus_ids.clone();
                bids_sorted.sort();
                parts.push(format!(
                    "bonus_id={}",
                    bids_sorted
                        .iter()
                        .map(|b| b.to_string())
                        .collect::<Vec<_>>()
                        .join("/")
                ));
                if item.enchant_id > 0 {
                    parts.push(format!("enchant_id={}", item.enchant_id));
                }
                if item.gem_id > 0 {
                    parts.push(format!("gem_id={}", item.gem_id));
                }
                item.simc_string = parts.join(",");

                // Re-resolve display info (ilevel, etc)
                if let Some(info) = super::get_item_info(item.item_id, Some(&item.bonus_ids)) {
                    item.ilevel = info.ilevel;
                    item.quality = info.quality;
                    item.tag = info.tag;
                    item.upgrade = info.upgrade;
                    item.sockets = info.sockets;
                }
            }
        }
    }
    items
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{BonusData, BonusUpgrade};
    use std::collections::HashMap;
    use std::sync::Arc;

    struct StateSnapshot {
        upgrade_max: Arc<HashMap<u64, u64>>,
        bonuses: Arc<HashMap<u64, BonusData>>,
        tracks: Arc<HashMap<UpgradeTrackKey, UpgradeTrackValue>>,
        step_costs: Arc<UpgradeCostMap>,
        season_config: Value,
    }

    impl StateSnapshot {
        fn capture() -> Self {
            Self {
                upgrade_max: UPGRADE_MAX.read().unwrap().clone(),
                bonuses: BONUSES.read().unwrap().clone(),
                tracks: UPGRADE_TRACKS.read().unwrap().clone(),
                step_costs: UPGRADE_STEP_COSTS.read().unwrap().clone(),
                season_config: SEASON_CONFIG.read().unwrap().clone(),
            }
        }

        fn restore(self) {
            *UPGRADE_MAX.write().unwrap() = self.upgrade_max;
            *BONUSES.write().unwrap() = self.bonuses;
            *UPGRADE_TRACKS.write().unwrap() = self.tracks;
            *UPGRADE_STEP_COSTS.write().unwrap() = self.step_costs;
            *SEASON_CONFIG.write().unwrap() = self.season_config;
        }
    }

    #[test]
    fn user_upgrade_all_items_in_simc_profile_rewrites_bonus_ids_to_max() {
        let _lock = crate::item_db::state::TEST_STATE_LOCK.lock().unwrap();
        let snapshot = StateSnapshot::capture();

        *UPGRADE_MAX.write().unwrap() = Arc::new(HashMap::from([(1001_u64, 2001_u64)]));

        let input = r#"
mage="Tester"
head=item=212345,bonus_id=1001/8888,enchant_id=123
trinket1=item=299999,bonus_id=7777
"#;
        let upgraded = upgrade_simc_input(input);

        assert!(upgraded.contains("bonus_id=2001/8888"));
        assert!(upgraded.contains("bonus_id=7777"));
        snapshot.restore();
    }

    #[test]
    fn user_upgrade_options_show_progressive_costs_for_selected_item_track() {
        let _lock = crate::item_db::state::TEST_STATE_LOCK.lock().unwrap();
        let snapshot = StateSnapshot::capture();

        let mut bonuses = HashMap::new();
        bonuses.insert(
            101_u64,
            BonusData {
                upgrade: Some(BonusUpgrade {
                    full_name: Some("Hero 1/4".to_string()),
                    group: Some(77),
                    level: Some(1),
                    ..BonusUpgrade::default()
                }),
                ..BonusData::default()
            },
        );
        bonuses.insert(
            102_u64,
            BonusData {
                upgrade: Some(BonusUpgrade {
                    full_name: Some("Hero 2/4".to_string()),
                    group: Some(77),
                    level: Some(2),
                    ..BonusUpgrade::default()
                }),
                ..BonusData::default()
            },
        );
        bonuses.insert(
            103_u64,
            BonusData {
                upgrade: Some(BonusUpgrade {
                    full_name: Some("Hero 3/4".to_string()),
                    group: Some(77),
                    level: Some(3),
                    ..BonusUpgrade::default()
                }),
                ..BonusData::default()
            },
        );
        *BONUSES.write().unwrap() = Arc::new(bonuses);

        *UPGRADE_TRACKS.write().unwrap() = Arc::new(HashMap::from([
            (
                ("Hero".to_string(), 1_u64, 4_u64),
                (623_u64, 101_u64, 4_u64),
            ),
            (
                ("Hero".to_string(), 2_u64, 4_u64),
                (626_u64, 102_u64, 4_u64),
            ),
            (
                ("Hero".to_string(), 3_u64, 4_u64),
                (629_u64, 103_u64, 4_u64),
            ),
        ]));

        *UPGRADE_STEP_COSTS.write().unwrap() = Arc::new(HashMap::from([
            (102_u64, HashMap::from([(3008_u64, 15_u64)])),
            (
                103_u64,
                HashMap::from([(3008_u64, 15_u64), (3009_u64, 5_u64)]),
            ),
        ]));

        let options = get_upgrade_options(&[101_u64]);
        assert_eq!(options.len(), 3);
        assert_eq!(options[0].name, "Hero 1/4");
        assert!(options[0].cumulative_costs.is_empty());

        assert_eq!(options[1].name, "Hero 2/4");
        assert_eq!(options[1].cumulative_costs.get(&3008), Some(&15));

        assert_eq!(options[2].name, "Hero 3/4");
        assert_eq!(options[2].cumulative_costs.get(&3008), Some(&30));
        assert_eq!(options[2].cumulative_costs.get(&3009), Some(&5));

        let between = get_upgrade_cost_between(101, 103);
        assert_eq!(between.get(&3008), Some(&30));
        assert_eq!(between.get(&3009), Some(&5));
        snapshot.restore();
    }

    #[test]
    fn user_upgrade_options_follow_equipped_season_metadata() {
        let _lock = crate::item_db::state::TEST_STATE_LOCK.lock().unwrap();
        let snapshot = StateSnapshot::capture();

        let mut bonuses = HashMap::new();
        for (group, max_level, first_bonus_id, first_ilevel) in [
            (77_u64, 4_u64, 101_u64, 600_u64),
            (88_u64, 8_u64, 201_u64, 700_u64),
        ] {
            for level in 1..=max_level {
                let bonus_id = first_bonus_id + level - 1;
                bonuses.insert(
                    bonus_id,
                    BonusData {
                        quality: Some(4),
                        upgrade: Some(BonusUpgrade {
                            full_name: Some(format!("Hero {level}/{max_level}")),
                            group: Some(group),
                            level: Some(level),
                            ilevel: Some(first_ilevel + level),
                            ..BonusUpgrade::default()
                        }),
                        ..BonusData::default()
                    },
                );
            }
        }
        *BONUSES.write().unwrap() = Arc::new(bonuses);
        *UPGRADE_TRACKS.write().unwrap() = Arc::new(HashMap::new());
        *UPGRADE_STEP_COSTS.write().unwrap() = Arc::new(
            (102_u64..=104)
                .map(|bonus_id| (bonus_id, HashMap::from([(3008_u64, 10_u64)])))
                .chain(
                    (202_u64..=208).map(|bonus_id| (bonus_id, HashMap::from([(4000_u64, 5_u64)]))),
                )
                .collect(),
        );

        let old_season = get_upgrade_options(&[101]);
        assert_eq!(old_season.len(), 4);
        assert_eq!(old_season.last().unwrap().ilevel, 604);
        assert_eq!(
            old_season.last().unwrap().cumulative_costs.get(&3008),
            Some(&30)
        );

        let new_season = get_upgrade_options(&[201]);
        assert_eq!(new_season.len(), 8);
        assert_eq!(new_season.last().unwrap().max_level, 8);
        assert_eq!(new_season.last().unwrap().ilevel, 708);
        assert_eq!(
            new_season.last().unwrap().cumulative_costs.get(&4000),
            Some(&35)
        );

        snapshot.restore();
    }

    #[test]
    fn user_upgrade_config_reads_current_and_legacy_season_shapes() {
        let _lock = crate::item_db::state::TEST_STATE_LOCK.lock().unwrap();
        let snapshot = StateSnapshot::capture();

        *SEASON_CONFIG.write().unwrap() = json!({
            "encounterUpgradeLevel": { "3200": 4 },
            "raidDifficulties": [
                { "key": "heroic", "name": "Heroic", "track": "Hero" }
            ],
            "dungeonNormal": { "ilvl": 603, "quality": 4 }
        });

        assert_eq!(encounter_upgrade_level(3200), Some(4));
        assert_eq!(difficulty_track_name("heroic").as_deref(), Some("Hero"));
        assert_eq!(dungeon_normal_ilvl(), 603);
        assert_eq!(dungeon_normal_quality(), 4);

        *SEASON_CONFIG.write().unwrap() = json!({
            "raidDifficulties": [
                { "name": "Mythic", "track": "Myth", "upgradeLevel": 6, "encounters": [4101, 4102] }
            ],
            "dungeonNormalIlvl": 597,
            "dungeonNormalQuality": 3
        });

        assert_eq!(encounter_upgrade_level(4102), Some(6));
        assert_eq!(difficulty_track_name("Mythic").as_deref(), Some("Myth"));
        assert_eq!(dungeon_normal_ilvl(), 597);
        assert_eq!(dungeon_normal_quality(), 3);

        snapshot.restore();
    }
}
