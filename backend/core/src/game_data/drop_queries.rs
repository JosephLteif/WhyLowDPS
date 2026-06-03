use serde_json::Value;
use std::collections::{HashMap, HashSet};

use super::catalyst::get_catalyst_drops;
use super::drops::{finalize_slot_map, merge_drop_map_into};
use crate::item_db;

pub fn get_drops_by_type(
    instance_type: &str,
    class_name: Option<&str>,
    spec_name: Option<&str>,
) -> Option<serde_json::Map<String, Value>> {
    if instance_type == "catalyst" {
        return get_catalyst_drops(class_name, spec_name);
    }

    let instances = item_db::instances();
    let mut merged: HashMap<String, HashMap<String, (i64, Value)>> = HashMap::new();
    for inst in instances {
        let itype = inst.get("type").and_then(|t| t.as_str()).unwrap_or("");
        let matches = if instance_type == "profession" {
            itype.to_lowercase().contains("profession")
        } else {
            itype == instance_type
        };
        if !matches {
            continue;
        }
        let inst_id = inst.get("id").and_then(|id| id.as_i64()).unwrap_or(0);
        if let Some(drops) = super::get_instance_drops(inst_id, class_name, spec_name) {
            merge_drop_map_into(&mut merged, &drops);
        }
    }

    let ordered = finalize_slot_map(merged);

    if ordered.is_empty() {
        None
    } else {
        Some(ordered)
    }
}

pub fn get_drops_by_instances(
    instance_ids: &[i64],
    class_name: Option<&str>,
    spec_name: Option<&str>,
) -> Option<serde_json::Map<String, Value>> {
    let mut seen_ids = HashSet::new();
    let mut merged: HashMap<String, HashMap<String, (i64, Value)>> = HashMap::new();

    for instance_id in instance_ids {
        if !seen_ids.insert(*instance_id) {
            continue;
        }
        if let Some(drops) = super::get_instance_drops(*instance_id, class_name, spec_name) {
            merge_drop_map_into(&mut merged, &drops);
        }
    }

    let ordered = finalize_slot_map(merged);
    if ordered.is_empty() {
        None
    } else {
        Some(ordered)
    }
}
