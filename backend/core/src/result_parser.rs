use regex::Regex;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

use crate::types::class_data::title_case;

fn extract_version(raw: &Value) -> String {
    let version = raw.get("version").and_then(|v| v.as_str()).unwrap_or("");
    let git_rev = raw
        .get("git_revision")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let git_branch = raw.get("git_branch").and_then(|v| v.as_str()).unwrap_or("");
    let build_date = raw.get("build_date").and_then(|v| v.as_str()).unwrap_or("");

    let mut parts: Vec<String> = Vec::new();
    if !version.is_empty() {
        parts.push(format!("SimC {}", version));
    }
    if !git_branch.is_empty() {
        parts.push(git_branch.to_string());
    }
    if !git_rev.is_empty() {
        parts.push(git_rev.chars().take(7).collect());
    }
    if !build_date.is_empty() {
        parts.push(build_date.to_string());
    }

    if parts.is_empty() {
        "Unknown".to_string()
    } else {
        parts.join(" / ")
    }
}

/// Read portion_aps from a stat entry (can be an object with `mean` or a bare number).
fn extract_portion_aps(stat: &Value) -> f64 {
    match stat.get("portion_aps") {
        Some(v) if v.is_object() => v.get("mean").and_then(|m| m.as_f64()).unwrap_or(0.0),
        Some(v) => v.as_f64().unwrap_or(0.0),
        None => 0.0,
    }
}

fn normalize_plot_stat_key(key: &str) -> String {
    key.trim().to_lowercase().replace(' ', "_")
}

fn parse_stat_plots(raw: &Value) -> Option<Value> {
    let dps_plot = raw
        .get("sim")
        .and_then(|s| s.get("dps_plot"))
        .and_then(|p| p.as_array())?;

    let mut out = serde_json::Map::new();

    for player_entry in dps_plot {
        let player_data = match player_entry.get("data").and_then(|d| d.as_array()) {
            Some(v) => v,
            None => continue,
        };
        for block in player_data {
            let block_obj = match block.as_object() {
                Some(v) => v,
                None => continue,
            };
            for (stat_name, points_value) in block_obj {
                let points = match points_value.as_array() {
                    Some(v) => v,
                    None => continue,
                };
                let mut parsed_points: Vec<Value> = Vec::new();
                for p in points {
                    let delta = p
                        .get("rating")
                        .or_else(|| p.get("delta"))
                        .and_then(|v| v.as_f64())
                        .unwrap_or(0.0);
                    let dps = p.get("dps").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    if dps <= 0.0 {
                        continue;
                    }
                    parsed_points.push(json!({
                        "delta": delta,
                        "dps": round1(dps),
                    }));
                }
                if !parsed_points.is_empty() {
                    parsed_points.sort_by(|a, b| {
                        let ad = a.get("delta").and_then(|v| v.as_f64()).unwrap_or(0.0);
                        let bd = b.get("delta").and_then(|v| v.as_f64()).unwrap_or(0.0);
                        ad.partial_cmp(&bd).unwrap_or(std::cmp::Ordering::Equal)
                    });
                    out.insert(normalize_plot_stat_key(stat_name), json!(parsed_points));
                }
            }
        }
    }

    if out.is_empty() {
        None
    } else {
        Some(Value::Object(out))
    }
}

fn parse_series_points(value: Option<&Value>) -> Vec<Value> {
    let points = match value.and_then(|v| v.as_array()) {
        Some(v) => v,
        None => return Vec::new(),
    };

    points
        .iter()
        .enumerate()
        .filter_map(|(idx, point)| {
            if let Some(v) = point.as_f64() {
                return Some(json!({
                    "t": round2(idx as f64),
                    "v": round1(v),
                }));
            }

            let obj = point.as_object()?;
            let time = obj
                .get("x")
                .or_else(|| obj.get("time"))
                .and_then(|v| v.as_f64())
                .unwrap_or(idx as f64);
            let value = obj
                .get("v")
                .or_else(|| obj.get("value"))
                .or_else(|| obj.get("dps"))
                .and_then(|v| v.as_f64())?;
            Some(json!({
                "t": round2(time),
                "v": round1(value),
            }))
        })
        .collect()
}

fn parse_buff_uptimes(player: &Value) -> Vec<Value> {
    let buffs = match player.get("buffs").and_then(|v| v.as_array()) {
        Some(v) => v,
        None => return Vec::new(),
    };

    let mut out = Vec::new();
    for buff in buffs {
        let uptime = buff.get("uptime").and_then(|v| v.as_f64()).unwrap_or(0.0);
        if uptime <= 0.0 {
            continue;
        }
        let mut entry = json!({
            "name": buff
                .get("spell_name")
                .or_else(|| buff.get("name"))
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown"),
            "uptime_pct": round2(uptime),
        });
        if let Some(spell_id) = buff.get("spell").and_then(|v| v.as_u64()) {
            if spell_id > 0 {
                entry["spell_id"] = json!(spell_id);
            }
        }
        if buff.get("cooldown").is_some() {
            entry["is_cooldown"] = json!(true);
        }
        out.push(entry);
    }

    out.sort_by(|a, b| {
        let av = a.get("uptime_pct").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let bv = b.get("uptime_pct").and_then(|v| v.as_f64()).unwrap_or(0.0);
        bv.partial_cmp(&av).unwrap_or(std::cmp::Ordering::Equal)
    });

    out
}

fn pick_resource_key(resource_timelines: &Value) -> Option<String> {
    let obj = resource_timelines.as_object()?;
    if obj.is_empty() {
        return None;
    }

    let preferred = [
        "mana",
        "energy",
        "rage",
        "focus",
        "runic_power",
        "insanity",
        "soul_shard",
        "holy_power",
        "combo_points",
        "maelstrom",
        "fury",
        "astral_power",
        "chi",
    ];

    for key in preferred {
        if obj.contains_key(key) {
            return Some(key.to_string());
        }
    }

    obj.keys().next().cloned()
}

fn parse_timeline_and_apl(player: &Value) -> Option<(Value, Value)> {
    let collected = player.get("collected_data")?;
    let action_seq = collected.get("action_sequence")?;
    let action_obj = action_seq.as_object();
    let action_rows = action_seq.as_array();

    let time_col = action_obj
        .and_then(|obj| obj.get("time"))
        .and_then(|v| v.as_array());
    let spell_name_col = action_obj
        .and_then(|obj| obj.get("spell_name"))
        .and_then(|v| v.as_array());
    let name_col = action_obj
        .and_then(|obj| obj.get("name"))
        .and_then(|v| v.as_array());
    let id_col = action_obj
        .and_then(|obj| obj.get("id"))
        .and_then(|v| v.as_array());
    let target_col = action_obj
        .and_then(|obj| obj.get("target"))
        .and_then(|v| v.as_array());
    let queue_failed_col = action_obj
        .and_then(|obj| obj.get("queue_failed"))
        .and_then(|v| v.as_array());
    let resources_col = action_obj
        .and_then(|obj| obj.get("resources"))
        .and_then(|v| v.as_array());
    let resources_max_col = action_obj
        .and_then(|obj| obj.get("resources_max"))
        .and_then(|v| v.as_array());

    let event_count = if let Some(times) = time_col {
        times.len()
    } else if let Some(rows) = action_rows {
        rows.len()
    } else {
        0
    };

    if event_count == 0 {
        return None;
    }

    let resource_timelines = collected
        .get("resource_timelines")
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();
    let mut resource_series_map = serde_json::Map::new();
    for (key, value) in &resource_timelines {
        let series = parse_series_points(value.get("data"));
        if !series.is_empty() {
            resource_series_map.insert(key.clone(), json!(series));
        }
    }
    let resource_key = pick_resource_key(&Value::Object(resource_timelines.clone()));
    let resource_series = resource_key
        .as_ref()
        .and_then(|k| resource_series_map.get(k))
        .and_then(|v| v.as_array())
        .cloned()
        .map(Value::Array)
        .unwrap_or_else(|| json!([]));

    let dps_series = parse_series_points(collected.get("timeline_dmg").and_then(|v| v.get("data")));

    let mut cooldown_spell_ids: HashSet<u64> = HashSet::new();
    if let Some(buffs) = player.get("buffs").and_then(|v| v.as_array()) {
        for buff in buffs {
            if buff.get("cooldown").is_some() {
                if let Some(spell_id) = buff.get("spell").and_then(|v| v.as_u64()) {
                    if spell_id > 0 {
                        cooldown_spell_ids.insert(spell_id);
                    }
                }
            }
        }
    }

    let max_events = 2000usize;
    let mut events: Vec<Value> = Vec::new();
    let mut cooldown_events: Vec<Value> = Vec::new();
    let mut action_counts: HashMap<String, (u64, u64)> = HashMap::new();
    let mut queue_failures = 0u64;
    let mut deltas: Vec<f64> = Vec::new();
    let mut last_t: Option<f64> = None;

    for idx in 0..event_count.min(max_events) {
        let row_obj = action_rows
            .and_then(|rows| rows.get(idx))
            .and_then(|row| row.as_object());

        let t = row_obj
            .and_then(|row| row.get("time"))
            .and_then(|v| v.as_f64())
            .or_else(|| time_col.and_then(|a| a.get(idx)).and_then(|v| v.as_f64()))
            .unwrap_or(0.0);

        let ev_name = row_obj
            .and_then(|row| row.get("spell_name"))
            .or_else(|| row_obj.and_then(|row| row.get("name")))
            .and_then(|v| v.as_str())
            .or_else(|| {
                spell_name_col
                    .and_then(|a| a.get(idx))
                    .or_else(|| name_col.and_then(|a| a.get(idx)))
                    .and_then(|v| v.as_str())
            })
            .unwrap_or("Unknown");

        let spell_id = row_obj
            .and_then(|row| row.get("id"))
            .and_then(|v| v.as_u64())
            .or_else(|| id_col.and_then(|a| a.get(idx)).and_then(|v| v.as_u64()))
            .unwrap_or(0);

        let ev_target = row_obj
            .and_then(|row| row.get("target"))
            .and_then(|v| v.as_str())
            .or_else(|| target_col.and_then(|a| a.get(idx)).and_then(|v| v.as_str()))
            .unwrap_or("");

        let q_failed = row_obj
            .and_then(|row| row.get("queue_failed"))
            .and_then(|v| v.as_bool())
            .or_else(|| {
                queue_failed_col
                    .and_then(|a| a.get(idx))
                    .and_then(|v| v.as_bool())
            })
            .unwrap_or(false);

        let resources_entry = row_obj
            .and_then(|row| row.get("resources"))
            .or_else(|| resources_col.and_then(|a| a.get(idx)));
        let resources_max_entry = row_obj
            .and_then(|row| row.get("resources_max"))
            .or_else(|| resources_max_col.and_then(|a| a.get(idx)));

        if q_failed {
            queue_failures += 1;
        }
        if let Some(prev_t) = last_t {
            let delta = t - prev_t;
            if delta > 0.0 {
                deltas.push(delta);
            }
        }
        last_t = Some(t);

        if !ev_name.is_empty() {
            let counter = action_counts
                .entry(ev_name.to_string())
                .or_insert((0, spell_id));
            counter.0 += 1;
            if counter.1 == 0 && spell_id > 0 {
                counter.1 = spell_id;
            }
        }

        let mut event = json!({
            "t": round2(t),
            "spell_name": ev_name,
            "target": ev_target,
            "queue_failed": q_failed,
        });
        if spell_id > 0 {
            event["spell_id"] = json!(spell_id);
        }

        if let Some(resource_name) = resource_key.as_ref() {
            let resource_val = resources_entry
                .and_then(|v| v.get(resource_name))
                .and_then(|v| v.as_f64());
            let resource_max_val = resources_max_entry
                .and_then(|v| v.get(resource_name))
                .and_then(|v| v.as_f64());
            if let Some(v) = resource_val {
                event["resource"] = json!({
                    "type": resource_name,
                    "value": round1(v),
                    "max": round1(resource_max_val.unwrap_or(0.0)),
                });
            }
        }

        if spell_id > 0 && cooldown_spell_ids.contains(&spell_id) {
            cooldown_events.push(event.clone());
        }
        events.push(event);
    }

    let total_actions = events.len() as u64;
    let unique_actions = action_counts.len() as u64;
    let mut top_actions: Vec<Value> = action_counts
        .into_iter()
        .map(|(name, (count, spell_id))| {
            let mut entry = json!({
                "name": name,
                "count": count,
                "share_pct": if total_actions > 0 {
                    round2((count as f64 / total_actions as f64) * 100.0)
                } else {
                    0.0
                },
            });
            if spell_id > 0 {
                entry["spell_id"] = json!(spell_id);
            }
            entry
        })
        .collect();
    top_actions.sort_by(|a, b| {
        let av = a.get("count").and_then(|v| v.as_u64()).unwrap_or(0);
        let bv = b.get("count").and_then(|v| v.as_u64()).unwrap_or(0);
        bv.cmp(&av)
    });
    if top_actions.len() > 10 {
        top_actions.truncate(10);
    }

    let mut timeline = json!({
        "events": events,
        "cooldown_events": cooldown_events,
        "dps_series": dps_series,
        "buff_uptimes": parse_buff_uptimes(player),
        "event_count": event_count,
        "events_truncated": event_count > max_events,
    });
    if !resource_series
        .as_array()
        .map(|a| a.is_empty())
        .unwrap_or(true)
    {
        timeline["resource_series"] = resource_series;
    }
    if !resource_series_map.is_empty() {
        timeline["resource_series_map"] = Value::Object(resource_series_map);
    }
    if let Some(resource_name) = resource_key {
        timeline["resource_type"] = json!(resource_name);
    }

    let mut apl_analysis = json!({
        "total_actions": total_actions,
        "unique_actions": unique_actions,
        "queue_failures": queue_failures,
        "top_actions": top_actions,
    });
    if !deltas.is_empty() {
        let avg = deltas.iter().sum::<f64>() / deltas.len() as f64;
        let min = deltas.iter().copied().fold(f64::INFINITY, f64::min);
        let max = deltas.iter().copied().fold(f64::NEG_INFINITY, f64::max);
        apl_analysis["gcd_spacing"] = json!({
            "avg": round3(avg),
            "min": round3(min),
            "max": round3(max),
        });
    }

    Some((timeline, apl_analysis))
}

/// Extract ability stats from a player or pet stats array into the abilities list.
/// If `pet_name` is Some, abilities are prefixed with the pet name.
fn extract_stats_into(abilities: &mut Vec<Value>, stats: Option<&Value>, pet_name: Option<&str>) {
    let stats = match stats.and_then(|s| s.as_array()) {
        Some(s) => s,
        None => return,
    };
    for stat in stats {
        let raw_name = stat.get("name").and_then(|n| n.as_str()).unwrap_or("");
        if raw_name.is_empty() {
            continue;
        }

        // Get DPS from portion_aps (object with mean, or bare number).
        // Sum parent + children to get total DPS for this ability group.
        let parent_dps = extract_portion_aps(stat);
        let children_arr = stat.get("children").and_then(|c| c.as_array());
        let mut children_dps_total = 0.0;
        if let Some(children) = children_arr {
            for child in children {
                children_dps_total += extract_portion_aps(child);
            }
        }
        let dps_contribution = parent_dps + children_dps_total;

        if dps_contribution <= 0.0 {
            continue;
        }

        let school = stat
            .get("school")
            .and_then(|s| s.as_str())
            .unwrap_or("physical");
        let display_name = match pet_name {
            Some(pn) => format!("{}: {}", title_case(&pn.replace('_', " ")), raw_name),
            None => raw_name.to_string(),
        };

        // Resolve spell_id: prefer parent, fall back to first child
        let mut spell_id = stat.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
        if spell_id == 0 {
            if let Some(children) = children_arr {
                if let Some(child) = children.first() {
                    spell_id = child.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
                }
            }
        }

        let mut ability = json!({
            "name": display_name,
            "portion_dps": round1(dps_contribution),
            "school": school,
        });
        if spell_id > 0 {
            ability["spell_id"] = json!(spell_id);
        }

        // Emit children when the parent has multiple sub-abilities.
        // If the parent itself does damage alongside children, include
        // the parent's own contribution as the first child entry.
        if let Some(children) = children_arr {
            let mut child_entries: Vec<Value> = Vec::new();

            // Parent's own damage as first sub-entry
            if parent_dps > 0.0 {
                let mut parent_entry = json!({
                    "name": raw_name,
                    "portion_dps": round1(parent_dps),
                    "school": school,
                });
                if spell_id > 0 {
                    parent_entry["spell_id"] = json!(spell_id);
                }
                child_entries.push(parent_entry);
            }

            for child in children {
                let child_dps = extract_portion_aps(child);
                if child_dps <= 0.0 {
                    continue;
                }
                let child_name = child.get("name").and_then(|n| n.as_str()).unwrap_or("");
                let child_school = child
                    .get("school")
                    .and_then(|s| s.as_str())
                    .unwrap_or(school);
                let child_spell_id = child.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
                let mut entry = json!({
                    "name": child_name,
                    "portion_dps": round1(child_dps),
                    "school": child_school,
                });
                if child_spell_id > 0 {
                    entry["spell_id"] = json!(child_spell_id);
                }
                child_entries.push(entry);
            }

            if child_entries.len() > 1 {
                ability["children"] = json!(child_entries);
            }
        }

        abilities.push(ability);
    }
}

/// Extract key metrics from raw simc JSON output.
pub fn parse_simc_result(raw: &Value, include_timeline: bool) -> Value {
    let empty = json!({});
    let sim = raw.get("sim").unwrap_or(&empty);
    let players = sim.get("players").and_then(|p| p.as_array());

    let players = match players {
        Some(p) if !p.is_empty() => p,
        _ => return json!({"error": "No player data found in simulation output"}),
    };

    let player = &players[0];
    let empty2 = json!({});
    let empty3 = json!({});
    let collected = player.get("collected_data").unwrap_or(&empty2);
    let dps_data = collected.get("dps").unwrap_or(&empty3);

    let dps_mean = dps_data.get("mean").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let dps_error = dps_data
        .get("mean_std_dev")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);

    let fight_length = sim
        .get("statistics")
        .and_then(|s| s.get("simulation_length"))
        .and_then(|sl| sl.get("mean"))
        .and_then(|m| m.as_f64())
        .unwrap_or(0.0);

    let statistics = sim.get("statistics").unwrap_or(&empty);
    let total_iterations = collected
        .get("dps")
        .and_then(|d| d.get("count"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let elapsed_time = statistics
        .get("elapsed_time_seconds")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let options = sim.get("options").unwrap_or(&empty);
    let target_error = options
        .get("target_error")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let desired_targets = options
        .get("desired_targets")
        .and_then(|v| v.as_u64())
        .unwrap_or(1);
    let error_pct = if dps_mean > 0.0 {
        (dps_error / dps_mean) * 100.0
    } else {
        0.0
    };

    let mut result = json!({
        "player_name": player.get("name").and_then(|n| n.as_str()).unwrap_or("Unknown"),
        "player_class": player.get("specialization")
            .or_else(|| player.get("type"))
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown"),
        "dps": round1(dps_mean),
        "dps_error": round1(dps_error),
        "dps_error_pct": round2(error_pct),
        "fight_length": round1(fight_length),
        "desired_targets": desired_targets,
        "iterations": total_iterations,
        "elapsed_time_seconds": round2(elapsed_time),
        "target_error": target_error,
        "simc_version": extract_version(raw),
        "simc_git_revision": raw.get("git_revision").and_then(|v| v.as_str()).unwrap_or(""),
    });

    // Ability breakdown (player + pets)
    let mut abilities: Vec<Value> = Vec::new();
    extract_stats_into(&mut abilities, player.get("stats"), None);

    // Pet abilities (simc stores these as stats_pets: { pet_name: [stats...] })
    if let Some(stats_pets) = player.get("stats_pets").and_then(|p| p.as_object()) {
        for (pet_name, pet_stats) in stats_pets {
            extract_stats_into(&mut abilities, Some(pet_stats), Some(pet_name));
        }
    }

    if !abilities.is_empty() {
        abilities.sort_by(|a, b| {
            let a_dps = a["portion_dps"].as_f64().unwrap_or(0.0);
            let b_dps = b["portion_dps"].as_f64().unwrap_or(0.0);
            b_dps
                .partial_cmp(&a_dps)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        result["abilities"] = json!(abilities);
    }

    // Stat weights
    if let Some(scaling) = player.get("scale_factors").and_then(|s| s.as_object()) {
        let mut stat_weights: Vec<(String, f64)> = Vec::new();
        for (stat_name, value) in scaling {
            let v = value.as_f64().unwrap_or(0.0);
            if v != 0.0 {
                stat_weights.push((stat_name.clone(), round4(v)));
            }
        }
        if !stat_weights.is_empty() {
            stat_weights.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
            let mut map = serde_json::Map::new();
            for (k, v) in stat_weights {
                map.insert(k, json!(v));
            }
            result["stat_weights"] = Value::Object(map);
        }
    }

    // Stat plotting
    if let Some(stat_plots) = parse_stat_plots(raw) {
        result["stat_plots"] = stat_plots;
    }

    if include_timeline {
        if let Some((timeline, apl_analysis)) = parse_timeline_and_apl(player) {
            result["timeline"] = timeline;
            result["apl_analysis"] = apl_analysis;
        }
    }

    // Equipped gear
    let all_gear = extract_all_gear(player);
    if !all_gear.is_empty() {
        let equipped_gear: serde_json::Map<String, Value> = all_gear.into_iter().collect();
        result["equipped_gear"] = Value::Object(equipped_gear);
    }

    result
}

fn extract_all_gear(player: &Value) -> HashMap<String, Value> {
    let empty = json!({});
    let gear = player.get("gear").unwrap_or(&empty);
    let gear_obj = match gear.as_object() {
        Some(o) => o,
        None => return HashMap::new(),
    };

    let id_re = Regex::new(r"id=(\d+)").unwrap();
    let ilvl_re = Regex::new(r"ilevel=(\d+)").unwrap();
    let bonus_re = Regex::new(r"bonus_id=([0-9/:]+)").unwrap();
    let enchant_re = Regex::new(r"enchant_id=(\d+)").unwrap();
    let gem_re = Regex::new(r"gem_id=(\d+)").unwrap();

    let mut baseline: HashMap<String, Value> = HashMap::new();

    for (raw_slot, data) in gear_obj {
        // simc JSON output uses different slot names than simc input
        let slot = match raw_slot.as_str() {
            "shoulders" => "shoulder".to_string(),
            "wrists" => "wrist".to_string(),
            other => other.to_string(),
        };

        let encoded = data
            .get("encoded_item")
            .and_then(|e| e.as_str())
            .unwrap_or("");

        let item_id: u64 = id_re
            .captures(encoded)
            .and_then(|c| c[1].parse().ok())
            .unwrap_or(0);

        let mut ilevel: u64 = ilvl_re
            .captures(encoded)
            .and_then(|c| c[1].parse().ok())
            .unwrap_or(0);

        if ilevel == 0 {
            ilevel = data.get("ilevel").and_then(|i| i.as_u64()).unwrap_or(0);
        }

        let bonus_ids: Vec<u64> = bonus_re
            .captures(encoded)
            .map(|c| {
                c[1].split(&['/', ':'][..])
                    .filter_map(|s| s.parse().ok())
                    .collect()
            })
            .unwrap_or_default();

        let enchant_id: u64 = enchant_re
            .captures(encoded)
            .and_then(|c| c[1].parse().ok())
            .unwrap_or(0);

        let gem_id: u64 = gem_re
            .captures(encoded)
            .and_then(|c| c[1].parse().ok())
            .unwrap_or(0);

        let name = data
            .get("name")
            .and_then(|n| n.as_str())
            .unwrap_or("")
            .replace('_', " ");
        let name = title_case(&name);

        let mut sorted_bonuses = bonus_ids.clone();
        sorted_bonuses.sort();
        let bonus_key = sorted_bonuses
            .iter()
            .map(|b| b.to_string())
            .collect::<Vec<_>>()
            .join(":");
        let uid = format!(
            "{}:{}:equipped:e{}:g{}:{}",
            item_id, bonus_key, enchant_id, gem_id, slot
        );

        baseline.insert(
            slot.clone(),
            json!({
                "uid": uid,
                "slot": &slot,
                "item_id": item_id,
                "ilevel": ilevel,
                "name": name,
                "bonus_ids": bonus_ids,
                "enchant_id": enchant_id,
                "gem_id": gem_id,
                "is_kept": true,
            }),
        );
    }

    baseline
}

/// Extract profileset results from simc JSON output for Top Gear.
pub fn parse_top_gear_result(
    raw: &Value,
    combo_metadata: Option<&HashMap<String, Vec<Value>>>,
) -> Value {
    let empty_meta = HashMap::new();
    let combo_metadata = combo_metadata.unwrap_or(&empty_meta);

    let empty = json!({});
    let sim = raw.get("sim").unwrap_or(&empty);
    let players = sim.get("players").and_then(|p| p.as_array());

    let players = match players {
        Some(p) if !p.is_empty() => p,
        _ => return json!({"type": "top_gear", "error": "No player data found"}),
    };

    let player = &players[0];
    let empty2 = json!({});
    let collected = player.get("collected_data").unwrap_or(&empty2);
    let base_dps = collected
        .get("dps")
        .and_then(|d| d.get("mean"))
        .and_then(|m| m.as_f64())
        .unwrap_or(0.0);

    let profilesets = sim
        .get("profilesets")
        .and_then(|p| p.get("results"))
        .and_then(|r| r.as_array())
        .cloned()
        .unwrap_or_default();

    let mut results: Vec<Value> = Vec::new();

    for ps in &profilesets {
        let mean_dps = ps.get("mean").and_then(|m| m.as_f64()).unwrap_or(0.0);
        let combo_name = ps.get("name").and_then(|n| n.as_str()).unwrap_or("Unknown");

        let items = combo_metadata.get(combo_name).cloned().unwrap_or_default();

        // Extract talent_build name and spec from items metadata (if present)
        let talent_build = items
            .first()
            .and_then(|it| it.get("talent_build"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let talent_spec = items
            .first()
            .and_then(|it| it.get("talent_spec"))
            .and_then(|v| v.as_str())
            .unwrap_or("");

        let mut entry = json!({
            "name": combo_name,
            "items": items,
            "dps": round1(mean_dps),
            "delta": round1(mean_dps - base_dps),
        });
        if !talent_build.is_empty() {
            entry["talent_build"] = json!(talent_build);
        }
        if !talent_spec.is_empty() {
            entry["talent_spec"] = json!(talent_spec);
        }
        results.push(entry);
    }

    // Add the base (equipped) profile — look for exact or prefixed key
    let baseline_key = combo_metadata
        .keys()
        .find(|k| k.starts_with("Currently Equipped"))
        .cloned();
    let baseline_items = baseline_key
        .as_deref()
        .and_then(|k| combo_metadata.get(k))
        .cloned()
        .unwrap_or_default();

    let baseline_talent = baseline_items
        .first()
        .and_then(|it| it.get("talent_build"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let baseline_talent_spec = baseline_items
        .first()
        .and_then(|it| it.get("talent_spec"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let baseline_items = if baseline_items.is_empty() {
        let all_gear = extract_all_gear(player);
        ["finger1", "finger2", "trinket1", "trinket2"]
            .iter()
            .filter_map(|s| all_gear.get(*s).cloned())
            .collect::<Vec<_>>()
    } else {
        baseline_items
    };

    let mut baseline_entry = json!({
        "name": baseline_key.as_deref().unwrap_or("Currently Equipped"),
        "items": baseline_items,
        "dps": round1(base_dps),
        "delta": 0,
    });
    if !baseline_talent.is_empty() {
        baseline_entry["talent_build"] = json!(baseline_talent);
    }
    if !baseline_talent_spec.is_empty() {
        baseline_entry["talent_spec"] = json!(baseline_talent_spec);
    }
    results.push(baseline_entry);

    results.sort_by(|a, b| {
        let a_dps = a["dps"].as_f64().unwrap_or(0.0);
        let b_dps = b["dps"].as_f64().unwrap_or(0.0);
        b_dps
            .partial_cmp(&a_dps)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    // Extract full equipped gear for gear overview
    let all_gear = extract_all_gear(player);
    let equipped_gear: serde_json::Map<String, Value> = all_gear.into_iter().collect();

    let statistics = sim.get("statistics").unwrap_or(&empty);
    let options = sim.get("options").unwrap_or(&empty);
    let total_iterations = collected
        .get("dps")
        .and_then(|d| d.get("count"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let elapsed_time = statistics
        .get("elapsed_time_seconds")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let fight_length = statistics
        .get("simulation_length")
        .and_then(|sl| sl.get("mean"))
        .and_then(|m| m.as_f64())
        .unwrap_or(0.0);
    let target_error = options
        .get("target_error")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let desired_targets = options
        .get("desired_targets")
        .and_then(|v| v.as_u64())
        .unwrap_or(1);
    let max_time = options
        .get("max_time")
        .and_then(|v| v.as_f64())
        .unwrap_or(300.0);
    let dps_error = collected
        .get("dps")
        .and_then(|d| d.get("mean_std_dev"))
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let error_pct = if base_dps > 0.0 {
        (dps_error / base_dps) * 100.0
    } else {
        0.0
    };

    json!({
        "type": "top_gear",
        "base_dps": round1(base_dps),
        "dps_error": round1(dps_error),
        "dps_error_pct": round2(error_pct),
        "fight_length": round1(fight_length),
        "desired_targets": desired_targets,
        "max_time": round1(max_time),
        "iterations": total_iterations,
        "elapsed_time_seconds": round2(elapsed_time),
        "target_error": target_error,
        "player_name": player.get("name").and_then(|n| n.as_str()).unwrap_or("Unknown"),
        "player_class": player.get("specialization")
            .or_else(|| player.get("type"))
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown"),
        "simc_version": extract_version(raw),
        "simc_git_revision": raw.get("git_revision").and_then(|v| v.as_str()).unwrap_or(""),
        "results": results,
        "equipped_gear": Value::Object(equipped_gear),
    })
}

fn round1(v: f64) -> f64 {
    (v * 10.0).round() / 10.0
}

fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

fn round3(v: f64) -> f64 {
    (v * 1000.0).round() / 1000.0
}

fn round4(v: f64) -> f64 {
    (v * 10000.0).round() / 10000.0
}
