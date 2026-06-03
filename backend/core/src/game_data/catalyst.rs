use serde_json::Value;

use crate::item_db;
use crate::types::class_data;

pub(super) fn get_catalyst_drops(
    class_name: Option<&str>,
    spec_name: Option<&str>,
) -> Option<serde_json::Map<String, Value>> {
    let mut raid_drops = super::get_drops_by_type("raid", class_name, spec_name)?;
    let class_id = class_name.and_then(class_data::class_wow_id)?;

    for (_, items) in raid_drops.iter_mut() {
        if let Some(arr) = items.as_array_mut() {
            let mut new_arr = Vec::new();
            for item in arr.drain(..) {
                let mut obj = item.as_object().unwrap().clone();
                if obj
                    .get("can_catalyst")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false)
                {
                    let inv_type = obj
                        .get("inventory_type")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);
                    if let Some(tier_info) = item_db::catalyst_tier_item(class_id, inv_type) {
                        obj.insert("item_id".to_string(), serde_json::json!(tier_info.item_id));

                        if let Some(info) = item_db::get_item_info(tier_info.item_id, None) {
                            obj.insert("name".to_string(), serde_json::json!(info.name));
                            obj.insert("icon".to_string(), serde_json::json!(info.icon));
                            obj.insert("quality".to_string(), serde_json::json!(info.quality));
                        } else {
                            obj.insert("name".to_string(), serde_json::json!(tier_info.name));
                            obj.insert("icon".to_string(), serde_json::json!(tier_info.icon));
                        }

                        obj.insert("is_catalyst".to_string(), serde_json::json!(true));
                        obj.insert("can_catalyst".to_string(), serde_json::json!(false));

                        new_arr.push(serde_json::Value::Object(obj));
                    }
                }
            }
            *arr = new_arr;
        }
    }

    raid_drops.retain(|_, v| v.as_array().is_some_and(|arr| !arr.is_empty()));

    if raid_drops.is_empty() {
        None
    } else {
        Some(raid_drops)
    }
}
