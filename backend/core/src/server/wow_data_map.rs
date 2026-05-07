use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

pub const WOW_DATA_MAP_FILE: &str = "wow-data-map.json";
pub const WOW_DATA_MAP_OVERRIDES_FILE: &str = "wow-data-map.overrides.json";
pub const WOWHEAD_ZONE_INDEX_FILE: &str = "zones-encounters-index.json";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WowDataMapStats {
    pub dungeons: usize,
    pub bosses: usize,
    pub unmatched_bosses: usize,
    pub low_confidence_fields: usize,
    pub overrides_applied: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WowheadZoneEntry {
    pub id: i64,
    pub name: String,
    pub instance: i64,
    pub expansion: Option<i64>,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub encounters: Vec<WowheadEncounterEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WowheadEncounterEntry {
    pub npc_id: i64,
    pub name: String,
    pub url: String,
    #[serde(default)]
    pub ability_spell_ids: Vec<i64>,
    #[serde(default)]
    pub ability_spell_urls: Vec<String>,
}

fn normalize_name(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut prev_space = false;
    for ch in input.chars() {
        let keep = ch.is_ascii_alphanumeric();
        if keep {
            out.push(ch.to_ascii_lowercase());
            prev_space = false;
        } else if !prev_space {
            out.push(' ');
            prev_space = true;
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn field(value: Value, source: &str, confidence: &str, overridden: bool) -> Value {
    json!({
        "value": value,
        "source": source,
        "confidence": confidence,
        "overridden": overridden
    })
}

fn warning(code: &str, message: &str) -> Value {
    json!({"code": code, "message": message})
}

fn as_i64_flexible(v: Option<&Value>) -> Option<i64> {
    let value = v?;
    if let Some(n) = value.as_i64() {
        return Some(n);
    }
    if let Some(s) = value.as_str() {
        return s.trim().parse::<i64>().ok();
    }
    None
}

fn wowhead_url(kind: &str, id: i64) -> Option<String> {
    if id <= 0 {
        return None;
    }
    match kind {
        "dungeon" => Some(format!("https://www.wowhead.com/zone={id}")),
        "encounter" => Some(format!("https://www.wowhead.com/npc={id}")),
        "spell" => Some(format!("https://www.wowhead.com/spell={id}")),
        "item" => Some(format!("https://www.wowhead.com/item={id}")),
        _ => None,
    }
}

fn read_wowhead_zone_index(data_dir: &Path) -> Vec<WowheadZoneEntry> {
    let runtime_path = data_dir.join(WOWHEAD_ZONE_INDEX_FILE);
    let bundled_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../resources")
        .join(WOWHEAD_ZONE_INDEX_FILE);
    let v = read_json_file(&runtime_path)
        .or_else(|_| read_json_file(&bundled_path))
        .unwrap_or_else(|_| Value::Null);
    v.get("zones")
        .and_then(|z| z.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|entry| serde_json::from_value::<WowheadZoneEntry>(entry.clone()).ok())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}


fn read_json_file(path: &Path) -> Result<Value, String> {
    let content = fs::read_to_string(path)
        .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse {}: {}", path.display(), e))
}

fn read_optional_json_file(path: &Path) -> Option<Value> {
    if !path.exists() {
        return None;
    }
    read_json_file(path).ok()
}

fn collect_item_ids(value: &Value, out: &mut Vec<u64>) {
    if let Some(id) = value.as_u64() {
        out.push(id);
        return;
    }
    if let Some(obj) = value.as_object() {
        for key in ["itemId", "item_id", "id"] {
            if let Some(id) = obj.get(key).and_then(|v| v.as_u64()) {
                out.push(id);
                return;
            }
        }
    }
    if let Some(arr) = value.as_array() {
        for v in arr {
            collect_item_ids(v, out);
        }
    }
}

fn parse_encounter_items(encounter_items: &Value) -> HashMap<i64, Vec<u64>> {
    let mut map: HashMap<i64, Vec<u64>> = HashMap::new();
    let Some(obj) = encounter_items.as_object() else {
        return map;
    };

    for (k, v) in obj {
        let Ok(enc_id) = k.parse::<i64>() else {
            continue;
        };
        let mut ids = Vec::new();
        collect_item_ids(v, &mut ids);
        ids.sort_unstable();
        ids.dedup();
        if !ids.is_empty() {
            map.insert(enc_id, ids);
        }
    }
    map
}

fn extract_encounter_ids_from_instance(instance: &Value) -> Vec<(i64, String)> {
    let mut result = Vec::new();
    if let Some(encounters) = instance.get("encounters").and_then(|v| v.as_array()) {
        for enc in encounters {
            let id = enc.get("id").and_then(|v| v.as_i64()).unwrap_or_default();
            let name = enc
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown Boss")
                .to_string();
            result.push((id, name));
        }
    }
    result
}

fn find_instance_for_dungeon<'a>(
    dungeon_id: i64,
    dungeon_name: &str,
    instances: &'a [Value],
) -> (Option<&'a Value>, &'static str, &'static str) {
    if let Some(inst) = instances
        .iter()
        .find(|i| i.get("id").and_then(|v| v.as_i64()) == Some(dungeon_id))
    {
        return (Some(inst), "instances.id", "high");
    }

    let wanted = normalize_name(dungeon_name);
    if let Some(inst) = instances.iter().find(|i| {
        i.get("name")
            .and_then(|v| v.as_str())
            .map(normalize_name)
            .as_deref()
            == Some(wanted.as_str())
    }) {
        return (Some(inst), "instances.name_fallback", "medium");
    }

    (None, "runtime_only", "low")
}

fn apply_overrides(mut map: Value, overrides: Option<Value>) -> (Value, usize) {
    let Some(overrides) = overrides else {
        return (map, 0);
    };
    let mut applied = 0usize;

    let Some(dungeons) = map.get_mut("dungeons").and_then(|v| v.as_array_mut()) else {
        return (map, applied);
    };

    let dungeon_overrides = overrides
        .get("dungeons")
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();

    let boss_overrides = overrides
        .get("bosses")
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();

    for dungeon in dungeons {
        let Some(dungeon_obj) = dungeon.as_object_mut() else {
            continue;
        };
        let dungeon_id = dungeon_obj
            .get("dungeon_id")
            .and_then(|v| v.get("value"))
            .and_then(|v| v.as_i64())
            .unwrap_or_default();

        if let Some(ov) = dungeon_overrides.get(&dungeon_id.to_string()).and_then(|v| v.as_object())
        {
            if let Some(name) = ov.get("name").and_then(|v| v.as_str()) {
                dungeon_obj.insert(
                    "name".to_string(),
                    field(Value::String(name.to_string()), "override", "high", true),
                );
                applied += 1;
            }
            if let Some(slug) = ov.get("slug").and_then(|v| v.as_str()) {
                dungeon_obj.insert(
                    "slug".to_string(),
                    field(Value::String(slug.to_string()), "override", "high", true),
                );
                applied += 1;
            }
        }

        if let Some(bosses) = dungeon_obj.get_mut("bosses").and_then(|v| v.as_array_mut()) {
            for boss in bosses {
                let Some(boss_obj) = boss.as_object_mut() else {
                    continue;
                };
                let encounter_id = boss_obj
                    .get("encounter_id")
                    .and_then(|v| v.get("value"))
                    .and_then(|v| v.as_i64())
                    .unwrap_or_default();
                let key = format!("{}:{}", dungeon_id, encounter_id);
                if let Some(ov) = boss_overrides.get(&key).and_then(|v| v.as_object()) {
                    if let Some(name) = ov.get("name").and_then(|v| v.as_str()) {
                        boss_obj.insert(
                            "name".to_string(),
                            field(Value::String(name.to_string()), "override", "high", true),
                        );
                        applied += 1;
                    }
                    if let Some(spells) = ov.get("spell_ids").and_then(|v| v.as_array()) {
                        let vals: Vec<Value> = spells.iter().filter_map(|v| v.as_u64()).map(Value::from).collect();
                        boss_obj.insert(
                            "spell_ids".to_string(),
                            field(Value::Array(vals), "override", "high", true),
                        );
                        applied += 1;
                    }
                    if let Some(npcs) = ov.get("npc_ids").and_then(|v| v.as_array()) {
                        let vals: Vec<Value> = npcs.iter().filter_map(|v| v.as_u64()).map(Value::from).collect();
                        boss_obj.insert(
                            "npc_ids".to_string(),
                            field(Value::Array(vals), "override", "high", true),
                        );
                        applied += 1;
                    }
                }
            }
        }
    }

    (map, applied)
}

pub fn generate_wow_data_map(data_dir: &Path) -> Result<(Value, WowDataMapStats), String> {
    let runtime = read_json_file(&data_dir.join("blizzard-runtime-data.json"))?;
    let instances_value = read_json_file(&data_dir.join("instances.json"))?;
    let encounter_items = read_json_file(&data_dir.join("encounter-items.json"))?;
    let overrides = read_optional_json_file(&data_dir.join(WOW_DATA_MAP_OVERRIDES_FILE));

    let instances = instances_value
        .as_array()
        .ok_or("instances.json must be an array")?
        .clone();

    let loot_map = parse_encounter_items(&encounter_items);
    let wowhead_zones = read_wowhead_zone_index(data_dir);
    let mut wowhead_by_name: HashMap<String, WowheadZoneEntry> = HashMap::new();
    for z in wowhead_zones {
        wowhead_by_name.insert(normalize_name(&z.name), z);
    }

    let dungeon_details = runtime
        .get("dungeon_details")
        .and_then(|v| v.as_array())
        .ok_or("blizzard-runtime-data.json missing dungeon_details")?;

    let rotation_ids: HashSet<i64> = runtime
        .get("mplus_rotation")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_i64()).collect())
        .unwrap_or_default();

    // TODO: Restore dynamic expansion detection from runtime dungeon metadata once
    // Blizzard payload coverage is fully reliable in all environments.
    let current_expansion: i64 = 11;

    let mut stats = WowDataMapStats::default();
    let mut out_dungeons: Vec<Value> = Vec::new();

    let mut filtered: Vec<&Value> = dungeon_details
        .iter()
        .filter(|d| as_i64_flexible(d.get("expansion")) == Some(current_expansion))
        .collect();

    if filtered.is_empty() {
        let mut target_ids: HashSet<i64> = HashSet::new();
        for inst in &instances {
            let inst_type = inst
                .get("type")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if inst_type != "expansion-dungeon" && inst_type != "mplus-chest" {
                continue;
            }
            if let Some(encs) = inst.get("encounters").and_then(|v| v.as_array()) {
                for enc in encs {
                    if let Some(id) = enc.get("id").and_then(|v| v.as_i64()) {
                        if id > 0 {
                            target_ids.insert(id);
                        }
                    }
                }
            }
        }

        let mut fallback_instances: Vec<&Value> = instances
            .iter()
            .filter(|instance| {
                let id = instance.get("id").and_then(|v| v.as_i64()).unwrap_or_default();
                let instance_type = instance
                    .get("type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_ascii_lowercase();
                id > 0 && instance_type == "dungeon" && (target_ids.is_empty() || target_ids.contains(&id))
            })
            .collect();

        fallback_instances.sort_by_key(|d| {
            d.get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_ascii_lowercase()
        });

        for instance in fallback_instances {
            let instance_type = instance
                .get("type")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if instance_type == "raid" || instance_type == "world_boss" {
                continue;
            }

            let dungeon_id = instance.get("id").and_then(|v| v.as_i64()).unwrap_or_default();
            let dungeon_name = instance
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown Dungeon")
                .to_string();
            let slug = normalize_name(&dungeon_name).replace(' ', "-");
            let matched_wowhead = wowhead_by_name.get(&normalize_name(&dungeon_name));
            let wow_id = matched_wowhead.map(|z| z.id).unwrap_or_default();
            let wow_url = if wow_id > 0 {
                Some(format!("https://www.wowhead.com/zone={}", wow_id))
            } else {
                None
            };

            let mut bosses = Vec::new();
            for (encounter_id, encounter_name) in extract_encounter_ids_from_instance(instance) {
                let loot_ids: Vec<u64> = if encounter_id > 0 {
                    loot_map.get(&encounter_id).cloned().unwrap_or_default()
                } else {
                    Vec::new()
                };
                bosses.push(json!({
                    "encounter_id": field(Value::from(encounter_id), "instances.json", if encounter_id > 0 { "high" } else { "medium" }, false),
                    "name": field(Value::String(encounter_name), "instances.json", "high", false),
                    "npc_ids": field(Value::Array(Vec::new()), "unavailable", "low", false),
                    "spell_ids": field(Value::Array(Vec::new()), "unavailable", "low", false),
                    "loot_item_ids": field(Value::Array(loot_ids.into_iter().map(Value::from).collect()), "encounter-items.json", if encounter_id > 0 { "high" } else { "low" }, false),
                    "wowhead_url": field(
                        wowhead_url("encounter", encounter_id).map(Value::String).unwrap_or(Value::Null),
                        if encounter_id > 0 { "derived.encounter_id" } else { "unavailable" },
                        if encounter_id > 0 { "high" } else { "low" },
                        false
                    ),
                    "source_meta": {"match_source": "instances.fallback", "scope": "current_expansion"},
                    "warnings": [
                        warning("boss.npc_ids_unavailable", "Structured npc ids unavailable in current pipeline sources"),
                        warning("boss.spell_ids_unavailable", "Structured spell ids unavailable in current pipeline sources")
                    ],
                    "confidence": if encounter_id > 0 { "high" } else { "medium" },
                }));
                stats.bosses += 1;
            }

            out_dungeons.push(json!({
                "dungeon_id": field(Value::from(dungeon_id), "instances.json", "high", false),
                "name": field(Value::String(dungeon_name), "instances.json", "high", false),
                "slug": field(Value::String(slug), "instances.json", "high", false),
                "expansion": field(Value::from(current_expansion), "hardcoded", "high", false),
                "season_tags": field(Value::Array(vec![Value::String("current_expansion".to_string())]), "instances.json", "high", false),
                "wowhead_id": field(
                    if wow_id > 0 { Value::from(wow_id) } else { Value::Null },
                    if wow_id > 0 { "wowhead.scrape.zones" } else { "unavailable" },
                    if wow_id > 0 { "high" } else { "low" },
                    false
                ),
                "wowhead_url": field(
                    wow_url.map(Value::String).unwrap_or(Value::Null),
                    if wow_id > 0 { "wowhead.scrape.zones" } else { "unavailable" },
                    if wow_id > 0 { "high" } else { "low" },
                    false
                ),
                "source_meta": {"match_source": "instances.fallback", "scope": "current_expansion"},
                "warnings": [
                    warning("dungeon.runtime_details_empty", "Runtime dungeon_details was empty; generated from instances fallback using expansion-dungeon/mplus-chest roster"),
                    if wow_id <= 0 { warning("dungeon.wowhead_id_missing", "No Wowhead zone id match found by normalized name") } else { warning("dungeon.wowhead_matched", "Matched Wowhead zone id from scraped zones index") }
                ],
                "confidence": "medium",
                "bosses": bosses,
            }));
            stats.dungeons += 1;
        }
    }

    filtered.sort_by_key(|d| {
        d.get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_ascii_lowercase()
    });

    for dungeon in filtered {
        let mut warnings = Vec::new();
        let dungeon_id = dungeon.get("id").and_then(|v| v.as_i64()).unwrap_or_default();
        let dungeon_name = dungeon
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown Dungeon")
            .to_string();
        let slug = dungeon
            .get("slug")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| normalize_name(&dungeon_name).replace(' ', "-"));
        let matched_wowhead = wowhead_by_name.get(&normalize_name(&dungeon_name));
        let wow_id = matched_wowhead.map(|z| z.id).unwrap_or_default();
        let wow_url = if wow_id > 0 {
            Some(format!("https://www.wowhead.com/zone={}", wow_id))
        } else {
            None
        };

        let (instance_match, match_source, match_conf) =
            find_instance_for_dungeon(dungeon_id, &dungeon_name, &instances);

        if instance_match.is_none() {
            warnings.push(warning(
                "dungeon.instance_not_found",
                "No matching instance entry found by id or name",
            ));
            stats.low_confidence_fields += 1;
        }

        let mut bosses = Vec::new();
        if let Some(instance) = instance_match {
            let mut encounter_rows = extract_encounter_ids_from_instance(instance);

            if encounter_rows.is_empty() {
                if let Some(detail_names) = dungeon.get("encounters").and_then(|v| v.as_array()) {
                    for n in detail_names {
                        if let Some(name) = n.as_str() {
                            encounter_rows.push((0, name.to_string()));
                        }
                    }
                }
            }

            for (encounter_id, encounter_name) in encounter_rows {
                let mut boss_warnings = Vec::new();
                let confidence = if encounter_id > 0 { "high" } else { "medium" };
                if encounter_id <= 0 {
                    boss_warnings.push(warning(
                        "boss.encounter_id_missing",
                        "Encounter id missing; boss mapped by name fallback within dungeon",
                    ));
                    stats.low_confidence_fields += 1;
                    stats.unmatched_bosses += 1;
                }

                let loot_ids: Vec<u64> = if encounter_id > 0 {
                    loot_map.get(&encounter_id).cloned().unwrap_or_default()
                } else {
                    Vec::new()
                };

                if encounter_id > 0 && loot_ids.is_empty() {
                    boss_warnings.push(warning(
                        "boss.loot_missing",
                        "No loot item ids found for encounter",
                    ));
                }

                boss_warnings.push(warning(
                    "boss.npc_ids_unavailable",
                    "Structured npc ids unavailable in current pipeline sources",
                ));
                boss_warnings.push(warning(
                    "boss.spell_ids_unavailable",
                    "Structured spell ids unavailable in current pipeline sources",
                ));

                let boss_obj = json!({
                    "encounter_id": field(Value::from(encounter_id), match_source, confidence, false),
                    "name": field(Value::String(encounter_name), match_source, confidence, false),
                    "npc_ids": field(Value::Array(Vec::new()), "unavailable", "low", false),
                    "spell_ids": field(Value::Array(Vec::new()), "unavailable", "low", false),
                    "loot_item_ids": field(Value::Array(loot_ids.into_iter().map(Value::from).collect()), "encounter-items.json", if encounter_id > 0 { "high" } else { "low" }, false),
                    "wowhead_url": field(
                        wowhead_url("encounter", encounter_id).map(Value::String).unwrap_or(Value::Null),
                        if encounter_id > 0 { "derived.encounter_id" } else { "unavailable" },
                        if encounter_id > 0 { "high" } else { "low" },
                        false
                    ),
                    "source_meta": {
                        "match_source": match_source,
                        "scope": "current_expansion",
                    },
                    "warnings": boss_warnings,
                    "confidence": confidence,
                });
                stats.bosses += 1;
                bosses.push(boss_obj);
            }
        } else {
            warnings.push(warning(
                "dungeon.bosses_unresolved",
                "No instance match found, bosses unresolved",
            ));
        }

        let season_tags: Vec<Value> = if rotation_ids.contains(&dungeon_id) {
            vec![Value::String("current_mplus_rotation".to_string())]
        } else {
            vec![Value::String("current_expansion".to_string())]
        };

        let dungeon_conf = if instance_match.is_some() {
            match_conf
        } else {
            "low"
        };

        out_dungeons.push(json!({
            "dungeon_id": field(Value::from(dungeon_id), "blizzard-runtime-data.json", "high", false),
            "name": field(Value::String(dungeon_name), "blizzard-runtime-data.json", "high", false),
            "slug": field(Value::String(slug), "blizzard-runtime-data.json", "high", false),
            "expansion": field(Value::from(current_expansion), "blizzard-runtime-data.json", "high", false),
            "season_tags": field(Value::Array(season_tags), "blizzard-runtime-data.json", "high", false),
            "wowhead_id": field(
                if wow_id > 0 { Value::from(wow_id) } else { Value::Null },
                if wow_id > 0 { "wowhead.scrape.zones" } else { "unavailable" },
                if wow_id > 0 { "high" } else { "low" },
                false
            ),
            "wowhead_url": field(
                wow_url.map(Value::String).unwrap_or(Value::Null),
                if wow_id > 0 { "wowhead.scrape.zones" } else { "unavailable" },
                if wow_id > 0 { "high" } else { "low" },
                false,
            ),
            "source_meta": {
                "match_source": match_source,
                "scope": "current_expansion",
            },
            "warnings": warnings,
            "confidence": dungeon_conf,
            "bosses": bosses,
        }));
        stats.dungeons += 1;
    }

    let mut map = json!({
        "generated_at": chrono::Utc::now().to_rfc3339(),
        "schema_version": 1,
        "scope": "current_expansion",
        "sources": [
            "blizzard-runtime-data.json",
            "instances.json",
            "encounter-items.json"
        ],
        "dungeons": out_dungeons,
    });

    let (map_with_overrides, applied) = apply_overrides(map.take(), overrides);
    stats.overrides_applied = applied;

    Ok((map_with_overrides, stats))
}

pub fn write_wow_data_map(data_dir: &Path) -> Result<WowDataMapStats, String> {
    let (map, stats) = generate_wow_data_map(data_dir)?;
    let out_path = data_dir.join(WOW_DATA_MAP_FILE);
    fs::write(&out_path, serde_json::to_string_pretty(&map).map_err(|e| e.to_string())?)
        .map_err(|e| format!("Failed to write {}: {}", out_path.display(), e))?;

    println!(
        "wow-data-map: dungeons={}, bosses={}, unmatched_bosses={}, low_confidence_fields={}, overrides_applied={}",
        stats.dungeons,
        stats.bosses,
        stats.unmatched_bosses,
        stats.low_confidence_fields,
        stats.overrides_applied
    );

    Ok(stats)
}

pub fn load_wow_data_map(data_dir: &Path) -> Result<Value, String> {
    read_json_file(&data_dir.join(WOW_DATA_MAP_FILE))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_name() {
        assert_eq!(normalize_name("The Stonevault"), "the stonevault");
        assert_eq!(normalize_name("Ara-Kara, City of Echoes"), "ara kara city of echoes");
    }

    #[test]
    fn test_parse_encounter_items() {
        let v = json!({
            "123": [{"itemId": 10}, {"id": 11}],
            "124": [12, 13]
        });
        let m = parse_encounter_items(&v);
        assert_eq!(m.get(&123).cloned().unwrap_or_default(), vec![10, 11]);
        assert_eq!(m.get(&124).cloned().unwrap_or_default(), vec![12, 13]);
    }

    #[test]
    fn test_apply_overrides() {
        let map = json!({
            "dungeons": [{
                "dungeon_id": {"value": 1},
                "name": {"value": "Old"},
                "bosses": [{
                    "encounter_id": {"value": 2},
                    "name": {"value": "Boss"},
                    "spell_ids": {"value": []},
                    "npc_ids": {"value": []}
                }]
            }]
        });
        let ov = json!({
            "dungeons": {"1": {"name": "New"}},
            "bosses": {"1:2": {"name": "New Boss", "spell_ids": [9]}}
        });
        let (updated, count) = apply_overrides(map, Some(ov));
        assert!(count >= 2);
        let d0 = &updated["dungeons"][0];
        assert_eq!(d0["name"]["value"], "New");
        assert_eq!(d0["bosses"][0]["name"]["value"], "New Boss");
        assert_eq!(d0["bosses"][0]["spell_ids"]["value"][0], 9);
    }
}
