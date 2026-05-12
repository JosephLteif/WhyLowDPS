use actix_web::{web, HttpResponse};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::Path;

use super::types::*;
use crate::addon_parser;
use crate::game_data;
use crate::gear_resolver;

fn read_runtime_array(root: Option<&Path>, file_names: &[&str]) -> Option<Vec<Value>> {
    let root = root?;
    for file_name in file_names {
        let path = root.join(file_name);
        let Ok(file) = std::fs::File::open(path) else {
            continue;
        };
        if let Ok(values) = serde_json::from_reader(std::io::BufReader::new(file)) {
            return Some(values);
        }
    }
    None
}

fn enchant_name(entry: &Value) -> String {
    entry
        .get("itemName")
        .and_then(|v| v.as_str())
        .or_else(|| entry.get("displayName").and_then(|v| v.as_str()))
        .unwrap_or_default()
        .to_string()
}

fn enchant_icon(entry: &Value) -> String {
    entry
        .get("itemIcon")
        .and_then(|v| v.as_str())
        .or_else(|| entry.get("spellIcon").and_then(|v| v.as_str()))
        .unwrap_or("inv_misc_questionmark")
        .to_string()
}

fn enchant_info_from_files(root: Option<&Path>, enchant_id: u64) -> Option<Value> {
    read_runtime_array(root, &["enchantments.json", "enchantments-all.json"])?
        .into_iter()
        .find(|entry| {
            entry.get("id").and_then(|v| v.as_u64()) == Some(enchant_id)
                || entry.get("itemId").and_then(|v| v.as_u64()) == Some(enchant_id)
        })
        .map(|entry| {
            json!({
                "enchant_id": enchant_id,
                "name": enchant_name(&entry),
                "icon": enchant_icon(&entry),
                "item_id": entry.get("itemId").and_then(|v| v.as_u64()).unwrap_or(0),
                "quality": entry.get("quality").and_then(|v| v.as_u64()).unwrap_or(3),
            })
        })
}

fn gem_info_from_files(root: Option<&Path>, gem_id: u64) -> Option<Value> {
    if let Some(gems) = read_runtime_array(root, &["gems.json"]) {
        if let Some(entry) = gems
            .into_iter()
            .find(|entry| entry.get("id").and_then(|v| v.as_u64()) == Some(gem_id))
        {
            return Some(json!({
                "gem_id": gem_id,
                "name": entry.get("name").and_then(|v| v.as_str()).unwrap_or_default(),
                "icon": entry.get("icon").and_then(|v| v.as_str()).unwrap_or("inv_misc_questionmark"),
                "quality": entry.get("quality").and_then(|v| v.as_u64()).unwrap_or(3),
            }));
        }
    }

    read_runtime_array(root, &["enchantments.json", "enchantments-all.json"])?
        .into_iter()
        .find(|entry| {
            entry.get("itemId").and_then(|v| v.as_u64()) == Some(gem_id)
                || entry.get("id").and_then(|v| v.as_u64()) == Some(gem_id)
        })
        .map(|entry| {
            json!({
                "gem_id": gem_id,
                "name": enchant_name(&entry),
                "icon": enchant_icon(&entry),
                "quality": entry.get("quality").and_then(|v| v.as_u64()).unwrap_or(3),
            })
        })
}

fn list_gems_from_files(root: Option<&Path>) -> Option<Vec<Value>> {
    if let Some(enchantments) =
        read_runtime_array(root, &["enchantments.json", "enchantments-all.json"])
    {
        let current_expansion = enchantments
            .iter()
            .filter(|entry| entry.get("slot").and_then(|v| v.as_str()) == Some("socket"))
            .filter(|entry| {
                entry
                    .get("socketType")
                    .and_then(|v| v.as_str())
                    .unwrap_or("PRISMATIC")
                    == "PRISMATIC"
            })
            .filter_map(|entry| entry.get("expansion").and_then(|v| v.as_u64()))
            .max()
            .unwrap_or(0);
        let mut by_item_id: HashMap<u64, Value> = HashMap::new();
        for entry in enchantments {
            if entry.get("slot").and_then(|v| v.as_str()) != Some("socket") {
                continue;
            }
            if entry
                .get("socketType")
                .and_then(|v| v.as_str())
                .unwrap_or("PRISMATIC")
                != "PRISMATIC"
            {
                continue;
            }
            if current_expansion > 0
                && entry.get("expansion").and_then(|v| v.as_u64()) != Some(current_expansion)
            {
                continue;
            }
            let item_id = entry
                .get("itemId")
                .and_then(|v| v.as_u64())
                .or_else(|| entry.get("id").and_then(|v| v.as_u64()))
                .unwrap_or(0);
            if item_id == 0 {
                continue;
            }
            let candidate = json!({
                "id": entry.get("id").and_then(|v| v.as_u64()).unwrap_or(item_id),
                "item_id": item_id,
                "name": enchant_name(&entry),
                "icon": enchant_icon(&entry),
                "quality": entry.get("quality").and_then(|v| v.as_u64()).unwrap_or(3),
                "craftingQuality": entry.get("craftingQuality").and_then(|v| v.as_u64()),
                "expansion": entry.get("expansion").and_then(|v| v.as_u64()),
                "socketType": entry.get("socketType").and_then(|v| v.as_str()),
            });
            let candidate_score = candidate
                .get("quality")
                .and_then(|v| v.as_u64())
                .unwrap_or(0)
                * 10
                + candidate
                    .get("craftingQuality")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
            let existing_score = by_item_id
                .get(&item_id)
                .and_then(|existing| {
                    Some(
                        existing
                            .get("quality")
                            .and_then(|v| v.as_u64())
                            .unwrap_or(0)
                            * 10
                            + existing
                                .get("craftingQuality")
                                .and_then(|v| v.as_u64())
                                .unwrap_or(0),
                    )
                })
                .unwrap_or(0);
            if candidate_score > existing_score {
                by_item_id.insert(item_id, candidate);
            }
        }
        if !by_item_id.is_empty() {
            let mut values: Vec<Value> = by_item_id.into_values().collect();
            values.sort_by(|a, b| {
                a.get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .cmp(b.get("name").and_then(|v| v.as_str()).unwrap_or(""))
            });
            return Some(values);
        }
    }

    let gems = read_runtime_array(root, &["gems.json"])?;
    let current_expansion = gems
        .iter()
        .filter_map(|entry| entry.get("expansion").and_then(|v| v.as_u64()))
        .max()
        .unwrap_or(0);
    let mut values: Vec<Value> = gems
        .into_iter()
        .filter(|entry| {
            current_expansion == 0
                || entry.get("expansion").and_then(|v| v.as_u64()) == Some(current_expansion)
        })
        .map(|entry| {
            let item_id = entry.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
            json!({
                "id": item_id,
                "item_id": item_id,
                "name": entry.get("name").and_then(|v| v.as_str()).unwrap_or_default(),
                "icon": entry.get("icon").and_then(|v| v.as_str()).unwrap_or("inv_misc_questionmark"),
                "quality": entry.get("quality").and_then(|v| v.as_u64()).unwrap_or(3),
                "craftingQuality": entry.get("craftingQuality").and_then(|v| v.as_u64()),
                "expansion": entry.get("expansion").and_then(|v| v.as_u64()),
                "socketType": entry.get("socket").and_then(|v| v.as_str()),
            })
        })
        .collect();
    values.sort_by(|a, b| {
        a.get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .cmp(b.get("name").and_then(|v| v.as_str()).unwrap_or(""))
    });
    Some(values)
}

fn list_enchants_for_slot_from_files(root: Option<&Path>, inv_type: u64) -> Option<Vec<Value>> {
    let mask = 1u64 << inv_type;
    let mut matching: Vec<Value> =
        read_runtime_array(root, &["enchantments.json", "enchantments-all.json"])?
            .into_iter()
            .filter(|entry| entry.get("slot").and_then(|v| v.as_str()) != Some("socket"))
            .filter(|entry| {
                let Some(reqs) = entry.get("equipRequirements") else {
                    return false;
                };
                let type_mask = reqs
                    .get("invTypeMask")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                if type_mask == 0 {
                    let item_class = reqs.get("itemClass").and_then(|v| v.as_u64()).unwrap_or(0);
                    if inv_type == 13 || inv_type == 17 || inv_type == 21 || inv_type == 22 {
                        return item_class == 2;
                    }
                    return false;
                }
                (type_mask & mask) != 0
            })
            .collect();

    let latest_expansion = matching
        .iter()
        .filter_map(|entry| entry.get("expansion").and_then(|v| v.as_u64()))
        .max()
        .unwrap_or(0);
    if latest_expansion > 0 {
        matching.retain(|entry| {
            entry.get("expansion").and_then(|v| v.as_u64()) == Some(latest_expansion)
        });
    }

    Some(
        matching
            .into_iter()
            .map(|entry| {
                let id = entry.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
                json!({
                    "id": id,
                    "enchant_id": id,
                    "name": enchant_name(&entry),
                    "displayName": entry.get("displayName").cloned(),
                    "baseDisplayName": entry.get("baseDisplayName").cloned(),
                    "categoryName": entry.get("categoryName").cloned(),
                    "itemId": entry.get("itemId").cloned(),
                    "itemName": entry.get("itemName").cloned(),
                    "itemIcon": entry.get("itemIcon").cloned(),
                    "spellIcon": entry.get("spellIcon").cloned(),
                    "quality": entry.get("quality").and_then(|v| v.as_u64()).unwrap_or(3),
                    "expansion": entry.get("expansion").cloned(),
                    "craftingQuality": entry.get("craftingQuality").cloned(),
                    "slot": entry.get("slot").cloned(),
                })
            })
            .collect(),
    )
}

fn current_season_label() -> String {
    crate::item_db::season_cfg()
        .get("season")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .or_else(|| {
            crate::item_db::get_runtime_data()
                .get("season_name")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
        })
        .unwrap_or_default()
}

fn query_item_season_id(query: &EnchantOptionsQuery) -> i64 {
    if query.season_id > 0 {
        return query.season_id;
    }

    let bonus_ids: Vec<u64> = if query.bonus_ids.is_empty() {
        Vec::new()
    } else {
        query
            .bonus_ids
            .split(',')
            .filter_map(|s| s.trim().parse::<u64>().ok())
            .collect()
    };

    if bonus_ids.is_empty() {
        return 0;
    }

    crate::item_db::resolve_bonuses(&bonus_ids, &crate::item_db::bonuses())
        .season_id
        .unwrap_or(0)
}

fn slot_has_active_expansion_enchants(query: &EnchantOptionsQuery) -> bool {
    let normalized = query.slot.trim().to_ascii_lowercase();
    let season_label = current_season_label().to_ascii_lowercase();
    let current_season_id = crate::item_db::current_season_id() as i64;
    let item_season_id = query_item_season_id(query);

    // Midnight current-season gear no longer supports the old TWW cloak/bracer enchants.
    if season_label.contains("midnight")
        && current_season_id > 0
        && item_season_id == current_season_id
        && matches!(normalized.as_str(), "back" | "wrist")
    {
        return false;
    }

    true
}

pub(super) async fn get_item_info(
    path: web::Path<u64>,
    query: web::Query<BonusIdsQuery>,
) -> HttpResponse {
    let item_id = path.into_inner();
    let bonus_list: Vec<u64> = if query.bonus_ids.is_empty() {
        Vec::new()
    } else {
        query
            .bonus_ids
            .split(',')
            .filter_map(|s| s.trim().parse().ok())
            .collect()
    };

    let bonus_ref = if bonus_list.is_empty() {
        None
    } else {
        Some(bonus_list.as_slice())
    };

    let result = game_data::get_item_info(item_id, bonus_ref)
        .unwrap_or_else(|| crate::types::ItemInfo::unknown(item_id));

    HttpResponse::Ok().json(result)
}

pub(super) async fn get_item_info_batch(req: web::Json<ItemInfoBatchRequest>) -> HttpResponse {
    let mut items_list = req.items.clone();
    if items_list.is_empty() && !req.item_ids.is_empty() {
        items_list = req
            .item_ids
            .iter()
            .map(|iid| json!({"item_id": iid}))
            .collect();
    }

    if items_list.is_empty() || items_list.len() > 100 {
        return HttpResponse::BadRequest().json(json!({"detail": "Provide 1-100 items"}));
    }

    let mut seen = std::collections::HashSet::new();
    let mut unique_items: Vec<(u64, Vec<u64>)> = Vec::new();

    for item in &items_list {
        let iid = item.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
        let bonus: Vec<u64> = item
            .get("bonus_ids")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|b| b.as_u64()).collect())
            .unwrap_or_default();
        let mut sorted_bonus = bonus.clone();
        sorted_bonus.sort();
        let key = format!(
            "{}:{}",
            iid,
            sorted_bonus
                .iter()
                .map(|b| b.to_string())
                .collect::<Vec<_>>()
                .join(":")
        );
        if seen.insert(key) {
            unique_items.push((iid, bonus));
        }
    }

    let mut results: HashMap<String, crate::types::ItemInfo> = HashMap::new();
    for (iid, bonus) in &unique_items {
        let bonus_ref = if bonus.is_empty() {
            None
        } else {
            Some(bonus.as_slice())
        };
        let info = game_data::get_item_info(*iid, bonus_ref)
            .unwrap_or_else(|| crate::types::ItemInfo::unknown(*iid));
        results.insert(iid.to_string(), info);
    }

    HttpResponse::Ok().json(results)
}

pub(super) async fn get_enchant_info(
    path: web::Path<u64>,
    data_dir: web::Data<Option<std::path::PathBuf>>,
) -> HttpResponse {
    let enchant_id = path.into_inner();
    let root = data_dir.get_ref().as_deref();
    let result = enchant_info_from_files(root, enchant_id)
        .or_else(|| game_data::get_enchant_info(enchant_id))
        .unwrap_or_else(|| {
            json!({"enchant_id": enchant_id, "name": "", "icon": "", "item_id": 0, "quality": 3})
        });
    HttpResponse::Ok().json(result)
}

pub(super) async fn get_gem_info(
    path: web::Path<u64>,
    data_dir: web::Data<Option<std::path::PathBuf>>,
) -> HttpResponse {
    let gem_id = path.into_inner();
    let root = data_dir.get_ref().as_deref();
    let result = gem_info_from_files(root, gem_id)
        .or_else(|| game_data::get_gem_info(gem_id))
        .unwrap_or_else(|| json!({"gem_id": gem_id, "name": "", "icon": "", "quality": 3}));
    HttpResponse::Ok().json(result)
}

pub(super) async fn list_enchant_options(
    query: web::Query<EnchantOptionsQuery>,
    data_dir: web::Data<Option<std::path::PathBuf>>,
) -> HttpResponse {
    if !slot_has_active_expansion_enchants(&query) {
        return HttpResponse::Ok().json(Vec::<Value>::new());
    }

    let inv_type = match gear_resolver::slot_to_inv_type(&query.slot) {
        Some(t) => t,
        None => {
            return HttpResponse::BadRequest()
                .json(json!({"detail": "Invalid slot for enchantments"}))
        }
    };
    let root = data_dir.get_ref().as_deref();
    let mut options = list_enchants_for_slot_from_files(root, inv_type)
        .unwrap_or_else(|| crate::item_db::list_enchants_for_slot(inv_type));
    let is_death_knight = matches!(
        query.class_name.trim().to_ascii_lowercase().as_str(),
        "death_knight" | "deathknight" | "dk"
    );
    if !is_death_knight {
        options.retain(|opt| {
            opt.get("categoryName")
                .and_then(|v| v.as_str())
                .is_none_or(|category| !category.eq_ignore_ascii_case("runes"))
        });
    }
    HttpResponse::Ok().json(options)
}

pub(super) async fn list_gem_options(
    data_dir: web::Data<Option<std::path::PathBuf>>,
) -> HttpResponse {
    let root = data_dir.get_ref().as_deref();
    let options = list_gems_from_files(root).unwrap_or_else(crate::item_db::list_gems);
    HttpResponse::Ok().json(options)
}

pub(super) async fn list_embellishment_options(
    query: web::Query<EmbellishmentOptionsQuery>,
) -> HttpResponse {
    let options = crate::item_db::list_embellishments_for_item(query.item_id);
    HttpResponse::Ok().json(options)
}

pub(super) async fn list_missive_options() -> HttpResponse {
    let options = crate::item_db::list_missives();
    HttpResponse::Ok().json(options)
}

pub(super) async fn get_max_upgrade_ilevels(body: web::Json<Vec<Value>>) -> HttpResponse {
    let mut results: HashMap<String, u64> = HashMap::new();
    for item in body.iter().take(200) {
        let item_id = item.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
        let bonus_ids: Vec<u64> = item
            .get("bonus_ids")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_u64()).collect())
            .unwrap_or_default();
        let upgraded = game_data::upgrade_bonus_ids_to_max(&bonus_ids);
        if let Some(info) = game_data::get_item_info(item_id, Some(&upgraded)) {
            let ilevel = info.ilevel;
            let mut sorted_ids = bonus_ids.clone();
            sorted_ids.sort();
            let key = format!(
                "{}:{}",
                item_id,
                sorted_ids
                    .iter()
                    .map(|b| b.to_string())
                    .collect::<Vec<_>>()
                    .join(",")
            );
            results.insert(key, ilevel as u64);
        }
    }
    HttpResponse::Ok().json(results)
}

pub(super) async fn list_upgrade_tracks() -> HttpResponse {
    HttpResponse::Ok().json(game_data::get_upgrade_tracks())
}

pub(super) async fn list_consumable_options(
    query: web::Query<ConsumableOptionsQuery>,
    data_dir: web::Data<Option<std::path::PathBuf>>,
) -> HttpResponse {
    fn normalize(raw: &[Value], main_hand_prefix: bool) -> Vec<Value> {
        raw.iter()
            .filter_map(|entry| {
                let value = entry.get("value").and_then(|v| v.as_str())?;
                let short_name = entry
                    .get("shortName")
                    .and_then(|v| v.as_str())
                    .or_else(|| entry.get("name").and_then(|v| v.as_str()))
                    .unwrap_or(value);
                let icon = entry.get("icon").and_then(|v| v.as_str()).unwrap_or("");
                let item_id = entry.get("itemId").and_then(|v| v.as_u64());
                let crafting_quality = entry.get("craftingQuality").and_then(|v| v.as_u64());
                let expansion = entry.get("expansion").and_then(|v| v.as_i64());
                let token = if main_hand_prefix {
                    format!("main_hand:{}", value)
                } else {
                    value.to_string()
                };
                let key = if main_hand_prefix {
                    format!("main_hand_{}", value)
                } else {
                    value.to_string()
                };
                Some(json!({
                    "key": key,
                    "label": short_name,
                    "token": token,
                    "icon": icon,
                    "itemId": item_id,
                    "craftingQuality": crafting_quality,
                    "expansion": expansion,
                }))
            })
            .collect()
    }

    let root = data_dir.get_ref().as_deref();
    let flasks_raw = read_runtime_array(root, &["flasks.json"])
        .unwrap_or_else(|| crate::item_db::flask_options_raw().as_ref().clone());
    let foods_raw = read_runtime_array(root, &["foods.json"])
        .unwrap_or_else(|| crate::item_db::food_options_raw().as_ref().clone());
    let potions_raw = read_runtime_array(root, &["potions.json"])
        .unwrap_or_else(|| crate::item_db::potion_options_raw().as_ref().clone());
    let augments_raw = read_runtime_array(root, &["augments.json"])
        .unwrap_or_else(|| crate::item_db::augment_options_raw().as_ref().clone());
    let temp_enchants_raw = read_runtime_array(root, &["temp-enchants.json"])
        .unwrap_or_else(|| crate::item_db::temp_enchant_options_raw().as_ref().clone());

    let mut flasks = normalize(&flasks_raw, false);
    let mut foods = normalize(&foods_raw, false);
    let mut potions = normalize(&potions_raw, false);
    let mut augments = normalize(&augments_raw, false);
    let mut temp_enchants = normalize(&temp_enchants_raw, true);

    fn keep_expansion_only(items: &mut Vec<Value>, expansion: i64) {
        items.retain(|v| v.get("expansion").and_then(|e| e.as_i64()) == Some(expansion));
    }

    let target_expansion = if query.expansion > 0 {
        Some(query.expansion)
    } else {
        [&flasks, &foods, &potions, &augments, &temp_enchants]
            .iter()
            .flat_map(|items| {
                items
                    .iter()
                    .filter_map(|v| v.get("expansion").and_then(|e| e.as_i64()))
            })
            .max()
    };

    if let Some(expansion) = target_expansion {
        keep_expansion_only(&mut flasks, expansion);
        keep_expansion_only(&mut foods, expansion);
        keep_expansion_only(&mut potions, expansion);
        keep_expansion_only(&mut augments, expansion);
        keep_expansion_only(&mut temp_enchants, expansion);
    }

    HttpResponse::Ok().json(json!({
        "flasks": flasks,
        "foods": foods,
        "potions": potions,
        "augments": augments,
        "temp_enchants": temp_enchants,
    }))
}

pub(super) async fn resolve_gear(req: web::Json<ResolveGearRequest>) -> HttpResponse {
    let simc_input = if req.max_upgrade {
        game_data::upgrade_simc_input(&req.simc_input)
    } else {
        req.simc_input.clone()
    };
    let parse_result = addon_parser::parse_simc_input(&simc_input);
    // Always parse catalyst charges so the frontend can show the toggle
    let currency_id = crate::item_db::catalyst_currency_id();
    let catalyst_charges =
        crate::addon_parser::parse_catalyst_charges(&req.simc_input, currency_id);
    let mut resolved = if req.catalyst && catalyst_charges.is_some() {
        gear_resolver::resolve_gear_with_catalyst(&parse_result, catalyst_charges)
    } else {
        gear_resolver::resolve_gear(&parse_result)
    };
    resolved.catalyst_charges = catalyst_charges;
    HttpResponse::Ok().json(resolved)
}

pub(super) async fn catalyst_convert(
    req: web::Json<super::types::CatalystConvertRequest>,
) -> HttpResponse {
    let class_id = match crate::types::class_data::class_wow_id(&req.class_name) {
        Some(id) => id,
        None => return HttpResponse::BadRequest().json(json!({"detail": "Unknown class"})),
    };
    let inv_type = match gear_resolver::slot_to_inv_type(&req.slot) {
        Some(t) => t,
        None => {
            return HttpResponse::BadRequest()
                .json(json!({"detail": "Slot not eligible for catalyst"}))
        }
    };
    let tier_info = match crate::item_db::catalyst_tier_item(class_id, inv_type) {
        Some(t) => t,
        None => {
            return HttpResponse::BadRequest()
                .json(json!({"detail": "No catalyst tier item for this class/slot"}))
        }
    };
    let catalyst_item = gear_resolver::build_catalyst_item(&req.item, &tier_info, &req.slot);
    HttpResponse::Ok().json(catalyst_item)
}

pub(super) async fn get_talent_tree(path: web::Path<u64>) -> HttpResponse {
    let spec_id = path.into_inner();
    let tree = match game_data::talent_tree(spec_id) {
        Some(t) => t,
        None => return HttpResponse::NotFound().json(json!({"detail": "Talent tree not found"})),
    };

    // Build fullNodeMaxRanks by combining all specs of the same class.
    // The fullNodeOrder covers ALL nodes across all specs, but each spec's
    // node arrays only include its own subset. The decoder needs maxRanks
    // for every node in fullNodeOrder to correctly parse the bit stream.
    let mut max_ranks: HashMap<u64, u64> = HashMap::new();
    for (key, nodes_key) in [
        ("classNodes", "classNodes"),
        ("specNodes", "specNodes"),
        ("heroNodes", "heroNodes"),
    ] {
        for sibling in crate::item_db::talent_trees_for_class(spec_id) {
            if let Some(nodes) = sibling.get(nodes_key).and_then(|v| v.as_array()) {
                for node in nodes {
                    if let (Some(id), Some(mr)) = (
                        node.get("id").and_then(|v| v.as_u64()),
                        node.get("maxRanks").and_then(|v| v.as_u64()),
                    ) {
                        max_ranks.insert(id, mr);
                    }
                }
            }
        }
        let _ = key; // suppress unused warning
    }
    // SubTree nodes (maxRanks defaults to 1)
    for sibling in crate::item_db::talent_trees_for_class(spec_id) {
        if let Some(nodes) = sibling.get("subTreeNodes").and_then(|v| v.as_array()) {
            for node in nodes {
                if let Some(id) = node.get("id").and_then(|v| v.as_u64()) {
                    max_ranks.entry(id).or_insert(1);
                }
            }
        }
    }

    let mut response = tree.clone();
    if let Some(obj) = response.as_object_mut() {
        obj.insert("fullNodeMaxRanks".to_string(), json!(max_ranks));
    }
    HttpResponse::Ok().json(response)
}

pub(super) async fn get_season_config() -> HttpResponse {
    use crate::types::season::*;
    let cfg = crate::item_db::season_cfg();
    let runtime = crate::item_db::get_runtime_data();

    let season = runtime
        .get("season_name")
        .and_then(|s| s.as_str())
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.to_string())
        .or_else(|| {
            cfg.get("season")
                .and_then(|s| s.as_str())
                .map(|s| s.to_string())
        })
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| {
            let season_id = crate::item_db::current_season_id();
            if season_id > 0 {
                format!("Season {}", season_id)
            } else {
                "Current Season".to_string()
            }
        });

    let raid_difficulties: Vec<DifficultyDef> = cfg
        .get("raidDifficulties")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    let dungeon_categories: Vec<DungeonCategory> = cfg
        .get("dungeonCategories")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    HttpResponse::Ok().json(SeasonConfigResponse {
        season,
        raid_difficulties,
        dungeon_categories,
    })
}

pub(super) async fn list_instances() -> HttpResponse {
    HttpResponse::Ok().json(game_data::get_instances())
}

pub(super) async fn get_drops_by_type(
    path: web::Path<String>,
    query: web::Query<DropsQuery>,
) -> HttpResponse {
    let instance_type = path.into_inner();
    let class_name = if query.class_name.is_empty() {
        None
    } else {
        Some(query.class_name.as_str())
    };
    let spec = if query.spec.is_empty() {
        None
    } else {
        Some(query.spec.as_str())
    };
    match game_data::get_drops_by_type(&instance_type, class_name, spec) {
        Some(drops) => HttpResponse::Ok().json(drops),
        None => HttpResponse::NotFound()
            .json(json!({"detail": "No drops found for this instance type"})),
    }
}

pub(super) async fn get_instance_drops(
    path: web::Path<i64>,
    query: web::Query<DropsQuery>,
) -> HttpResponse {
    let instance_id = path.into_inner();
    let class_name = if query.class_name.is_empty() {
        None
    } else {
        Some(query.class_name.as_str())
    };
    let spec = if query.spec.is_empty() {
        None
    } else {
        Some(query.spec.as_str())
    };
    match game_data::get_instance_drops(instance_id, class_name, spec) {
        Some(drops) => HttpResponse::Ok().json(drops),
        None => {
            HttpResponse::NotFound().json(json!({"detail": "Instance not found or has no drops"}))
        }
    }
}

pub(super) async fn get_multi_instance_drops(query: web::Query<MultiDropsQuery>) -> HttpResponse {
    let instance_ids: Vec<i64> = query
        .ids
        .split(',')
        .filter_map(|raw| raw.trim().parse::<i64>().ok())
        .collect();

    if instance_ids.is_empty() {
        return HttpResponse::BadRequest()
            .json(json!({"detail": "Provide at least one valid instance id in ids="}));
    }

    let class_name = if query.class_name.is_empty() {
        None
    } else {
        Some(query.class_name.as_str())
    };
    let spec = if query.spec.is_empty() {
        None
    } else {
        Some(query.spec.as_str())
    };

    match game_data::get_drops_by_instances(&instance_ids, class_name, spec) {
        Some(drops) => HttpResponse::Ok().json(drops),
        None => HttpResponse::NotFound()
            .json(json!({"detail": "No drops found for requested instances"})),
    }
}

pub async fn get_dungeon_data() -> HttpResponse {
    use crate::server::dungeon_data::{
        DungeonAffix, DungeonDataSource, DungeonInfo, DungeonSeasonData,
    };
    use crate::server::dungeon_source_blizzard::BlizzardDungeonSource;

    let source = BlizzardDungeonSource::new();

    match source.get_season_info() {
        Ok(data) => HttpResponse::Ok().json(data),
        Err(e) => {
            let fallback_affixes = vec![
                DungeonAffix {
                    id: 1,
                    name: "Tyrannical".to_string(),
                    description: "Health and damage increased by 15%.".to_string(),
                    icon: None,
                    wowhead_url: Some("https://wowhead.com/affix=9".to_string()),
                    spell_id: Some(409967),
                },
                DungeonAffix {
                    id: 2,
                    name: "Fortified".to_string(),
                    description: "Non-boss health increased by 20%.".to_string(),
                    icon: None,
                    wowhead_url: Some("https://wowhead.com/affix=10".to_string()),
                    spell_id: Some(409968),
                },
            ];

            let fallback_data = DungeonSeasonData {
                season_id: 0,
                season_name: "Unknown Season".to_string(),
                current_affixes: fallback_affixes,
                rotation_dungeons: Vec::<DungeonInfo>::new(),
            };

            HttpResponse::Ok().json(json!({
                "error": e,
                "season_id": fallback_data.season_id,
                "season_name": fallback_data.season_name,
                "current_affixes": fallback_data.current_affixes,
                "rotation_dungeons": fallback_data.rotation_dungeons,
            }))
        }
    }
}
