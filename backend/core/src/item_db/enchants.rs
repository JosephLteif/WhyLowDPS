use super::state::*;
use futures_util::stream::{self, StreamExt};
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::RwLock;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
#[serde(default)]
struct GemEffectInfo {
    label: String,
    category: String,
    #[serde(rename = "primaryStat")]
    primary_stat: Option<String>,
    #[serde(rename = "primaryAmount")]
    primary_amount: Option<u64>,
    #[serde(rename = "secondaryStat")]
    secondary_stat: Option<String>,
    #[serde(rename = "secondaryAmount")]
    secondary_amount: Option<u64>,
    #[serde(rename = "isPvp")]
    is_pvp: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
#[serde(default)]
struct EnchantEffectInfo {
    #[serde(rename = "effectKey")]
    effect_key: Option<String>,
    #[serde(rename = "effectAmounts")]
    effect_amounts: Vec<f64>,
}

static GEM_EFFECT_CACHE: Lazy<RwLock<HashMap<u64, Option<GemEffectInfo>>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));
static ENCHANT_EFFECT_CACHE: Lazy<RwLock<HashMap<u64, Option<EnchantEffectInfo>>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));
static GEM_TOOLTIP_CLIENT: Lazy<reqwest::Client> = Lazy::new(|| {
    reqwest::Client::builder()
        .user_agent("WhyLowDps/2.4 Gem Metadata")
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
});
static GEM_TOOLTIP_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"\+<!--gem\d+-->(\d+)\s+<!---->\s*([^<&]+)"#).unwrap());
static GEM_PVP_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r#">\s*PVP\s*<"#).unwrap());
static GEM_XML_TOOLTIP_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"(?s)<htmlTooltip><!\[CDATA\[(.*?)\]\]></htmlTooltip>"#).unwrap());
static GEM_SPECIAL_LINE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"(?s)<!--nameDescStats--><br\s*/?>(.*?)<!--i\?"#).unwrap()
});
static GEM_HTML_COMMENT_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"(?s)<!--.*?-->"#).unwrap());
static GEM_HTML_TAG_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?s)<[^>]+>"#).unwrap());
static GEM_WHITESPACE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"\s+"#).unwrap());
static GEM_SPECIAL_AND_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"\s+and\s+\+"#).unwrap());
static ENCHANT_TOOLTIP_CLIENT: Lazy<reqwest::Client> = Lazy::new(|| {
    reqwest::Client::builder()
        .user_agent("WhyLowDps/2.4 Enchant Metadata")
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
});
static ENCHANT_XML_TOOLTIP_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"(?s)<htmlTooltip><!\[CDATA\[(.*?)\]\]></htmlTooltip>"#).unwrap());
static ENCHANT_USE_TEXT_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"(?is)\bUse:\s*(.*?)(?:Requires Level|Max Stack:|Sell Price:|$)"#).unwrap());
static ENCHANT_PREFIX_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"(?is)^permanently enchants .*?(?:,| to )\s*"#).unwrap()
});
static ENCHANT_RESTRICTION_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"(?is)\b(?:Cannot be applied|Requires Level)\b.*$"#).unwrap()
});
static ENCHANT_NUMBER_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"\d+(?:\.\d+)?"#).unwrap());
static ENCHANT_KEY_NUMBER_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"\b\d+(?:\.\d+)?%?\b"#).unwrap());

pub fn list_gems() -> Vec<Value> {
    // Prefer enchantments dataset for gems (slot=socket), because the equippable
    // item index can omit gem items.
    let enchants_map = ENCHANTS.read().unwrap();
    let mut by_item_id: HashMap<u64, Value> = HashMap::new();
    let current_gem_expansion = enchants_map
        .values()
        .filter(|e| e.slot.as_deref() == Some("socket"))
        .filter(|e| e.socket_type.as_deref().unwrap_or("PRISMATIC") == "PRISMATIC")
        .filter_map(|e| e.expansion)
        .max()
        .unwrap_or(0);

    for e in enchants_map.values() {
        if e.slot.as_deref() != Some("socket") {
            continue;
        }
        if e.socket_type.as_deref().unwrap_or("PRISMATIC") != "PRISMATIC" {
            continue;
        }
        if current_gem_expansion > 0 && e.expansion.unwrap_or(0) != current_gem_expansion {
            continue;
        }
        let item_id = e.item_id.unwrap_or(e.id);
        if item_id == 0 {
            continue;
        }
        let quality = e.quality.unwrap_or(3);
        let candidate = json!({
            "id": e.id,
            "item_id": item_id,
            "name": e.item_name.clone().or(e.display_name.clone()).unwrap_or_default(),
            "icon": e.item_icon.clone().or(e.spell_icon.clone()).unwrap_or_else(|| "inv_misc_questionmark".to_string()),
            "quality": quality,
            "craftingQuality": e.crafting_quality,
            "expansion": e.expansion,
            "socketType": e.socket_type,
        });

        match by_item_id.get(&item_id) {
            Some(existing) => {
                let existing_quality = existing
                    .get("quality")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                if quality > existing_quality {
                    by_item_id.insert(item_id, candidate);
                }
            }
            None => {
                by_item_id.insert(item_id, candidate);
            }
        }
    }

    if !by_item_id.is_empty() {
        let mut values: Vec<Value> = by_item_id.into_values().collect();
        values.sort_by(|a, b| {
            let an = a.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let bn = b.get("name").and_then(|v| v.as_str()).unwrap_or("");
            an.cmp(bn)
        });
        return values;
    }

    // Fallback: old behavior from the item dataset.
    let items_map = ITEMS.read().unwrap();
    items_map
        .values()
        .filter(|v| v.class.unwrap_or(0) == 3 && v.quality >= 3)
        .map(|v| {
            json!({
                "item_id": v.id,
                "name": v.name,
                "icon": v.icon,
                "quality": v.quality,
            })
        })
        .collect()
}

fn normalize_gem_stat(stat: &str) -> Option<(&'static str, &'static str)> {
    let normalized = stat.trim().trim_end_matches(" and").to_ascii_lowercase();
    match normalized.as_str() {
        "critical strike" => Some(("crit", "Crit")),
        "haste" => Some(("haste", "Haste")),
        "mastery" => Some(("mast", "Mast")),
        "versatility" => Some(("vers", "Vers")),
        "primary stat" => Some(("special", "Primary Stat")),
        _ => None,
    }
}

fn decode_html_entities(input: &str) -> String {
    input
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

fn collapse_tooltip_text(raw: &str) -> String {
    let without_comments = GEM_HTML_COMMENT_RE.replace_all(raw, "");
    let without_tags = GEM_HTML_TAG_RE.replace_all(&without_comments, " ");
    let decoded = decode_html_entities(&without_tags);
    GEM_WHITESPACE_RE.replace_all(&decoded, " ").trim().to_string()
}

fn extract_special_gem_label(tooltip: &str) -> Option<String> {
    let raw = GEM_SPECIAL_LINE_RE
        .captures(tooltip)
        .and_then(|capture| capture.get(1))
        .map(|capture| capture.as_str())?;
    let without_comments = GEM_HTML_COMMENT_RE.replace_all(raw, "");
    let without_tags = GEM_HTML_TAG_RE.replace_all(&without_comments, " ");
    let decoded = decode_html_entities(&without_tags);
    let collapsed = GEM_WHITESPACE_RE.replace_all(&decoded, " ");
    let cleaned = collapsed.trim().trim_start_matches('+').trim().to_string();
    if cleaned.is_empty() {
        return None;
    }
    Some(
        GEM_SPECIAL_AND_RE
            .replace(&cleaned, " + ")
            .trim()
            .to_string(),
    )
}

fn parse_gem_effect_info(name: &str, tooltip: &str) -> GemEffectInfo {
    let is_pvp = GEM_PVP_RE.is_match(tooltip) || name.to_ascii_lowercase().contains("heliotrope");
    let mut stats: Vec<(u64, String, String)> = GEM_TOOLTIP_RE
        .captures_iter(tooltip)
        .filter_map(|capture| {
            let amount = capture.get(1)?.as_str().parse::<u64>().ok()?;
            let stat_name = capture
                .get(2)?
                .as_str()
                .split(" and +")
                .next()
                .unwrap_or_default()
                .trim();
            let (key, label) = normalize_gem_stat(stat_name)?;
            Some((amount, key.to_string(), label.to_string()))
        })
        .collect();

    stats.sort_by(|a, b| b.0.cmp(&a.0));

    let primary = stats.first().cloned();
    let secondary = stats.get(1).cloned();

    let category = primary
        .as_ref()
        .map(|(_, key, _)| key.clone())
        .unwrap_or_else(|| "special".to_string());
    let special_label = if category == "special" {
        extract_special_gem_label(tooltip)
    } else {
        None
    };

    let label = match (primary.as_ref(), secondary.as_ref(), special_label.as_ref()) {
        (_, _, Some(label)) => label.clone(),
        (
            Some((primary_amount, _, primary_label)),
            Some((secondary_amount, _, secondary_label)),
            None,
        ) => {
            format!(
                "{} {} & {} {}",
                primary_amount, primary_label, secondary_amount, secondary_label
            )
        }
        (Some((primary_amount, _, primary_label)), None, None) => {
            format!("{} {}", primary_amount, primary_label)
        }
        _ => {
            if name.len() > 28 {
                format!("{}...", &name[..28])
            } else {
                name.to_string()
            }
        }
    };

    GemEffectInfo {
        label,
        category,
        primary_stat: primary.as_ref().map(|(_, key, _)| key.clone()),
        primary_amount: primary.as_ref().map(|(amount, _, _)| *amount),
        secondary_stat: secondary.as_ref().map(|(_, key, _)| key.clone()),
        secondary_amount: secondary.as_ref().map(|(amount, _, _)| *amount),
        is_pvp,
    }
}

async fn fetch_gem_effect_info(item_id: u64, name: &str) -> Option<GemEffectInfo> {
    let url = format!("https://www.wowhead.com/item={}&xml", item_id);
    let response = GEM_TOOLTIP_CLIENT.get(url).send().await.ok()?;
    let payload = response.text().await.ok()?;
    let tooltip = GEM_XML_TOOLTIP_RE
        .captures(&payload)
        .and_then(|capture| capture.get(1))
        .map(|capture| capture.as_str())?;
    Some(parse_gem_effect_info(name, tooltip))
}

fn parse_enchant_effect_info(tooltip: &str) -> Option<EnchantEffectInfo> {
    let plain_tooltip = collapse_tooltip_text(tooltip);
    let use_text = ENCHANT_USE_TEXT_RE
        .captures(&plain_tooltip)
        .and_then(|capture| capture.get(1))
        .map(|capture| capture.as_str().trim().to_string())?;

    let without_restrictions = ENCHANT_RESTRICTION_RE.replace(&use_text, "").trim().to_string();
    let first_sentence = without_restrictions
        .split('.')
        .map(str::trim)
        .find(|sentence| !sentence.is_empty())
        .unwrap_or_default()
        .to_string();
    if first_sentence.is_empty() {
        return None;
    }

    let effect_text = ENCHANT_PREFIX_RE
        .replace(&first_sentence, "")
        .trim()
        .trim_end_matches('.')
        .trim()
        .to_string();
    if effect_text.is_empty() {
        return None;
    }

    let effect_key = ENCHANT_KEY_NUMBER_RE
        .replace_all(&effect_text.to_ascii_lowercase(), "#")
        .replace('%', " percent")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if effect_key.is_empty() {
        return None;
    }

    let effect_amounts = ENCHANT_NUMBER_RE
        .captures_iter(&effect_text)
        .filter_map(|capture| capture.get(0))
        .filter_map(|capture| capture.as_str().parse::<f64>().ok())
        .collect::<Vec<_>>();

    Some(EnchantEffectInfo {
        effect_key: Some(effect_key),
        effect_amounts,
    })
}

async fn fetch_enchant_effect_info(item_id: u64) -> Option<EnchantEffectInfo> {
    let url = format!("https://www.wowhead.com/item={}&xml", item_id);
    let response = ENCHANT_TOOLTIP_CLIENT.get(url).send().await.ok()?;
    let payload = response.text().await.ok()?;
    let tooltip = ENCHANT_XML_TOOLTIP_RE
        .captures(&payload)
        .and_then(|capture| capture.get(1))
        .map(|capture| capture.as_str())?;
    parse_enchant_effect_info(tooltip)
}

pub async fn enrich_enchants_with_effects(options: Vec<Value>) -> Vec<Value> {
    let missing: Vec<u64> = {
        let cache = ENCHANT_EFFECT_CACHE.read().unwrap();
        options
            .iter()
            .filter_map(|option| option.get("itemId").and_then(|value| value.as_u64()))
            .filter(|item_id| *item_id > 0)
            .filter(|item_id| match cache.get(item_id) {
                Some(Some(effect)) => effect.effect_key.is_none(),
                Some(None) => true,
                None => true,
            })
            .collect()
    };

    if !missing.is_empty() {
        let fetched: Vec<(u64, Option<EnchantEffectInfo>)> = stream::iter(missing.into_iter())
            .map(|item_id| async move { (item_id, fetch_enchant_effect_info(item_id).await) })
            .buffer_unordered(8)
            .collect()
            .await;

        if !fetched.is_empty() {
            let mut cache = ENCHANT_EFFECT_CACHE.write().unwrap();
            for (item_id, effect) in fetched {
                cache.insert(item_id, effect);
            }
        }
    }

    let cache = ENCHANT_EFFECT_CACHE.read().unwrap();
    options
        .into_iter()
        .map(|mut option| {
            let item_id = option
                .get("itemId")
                .and_then(|value| value.as_u64())
                .unwrap_or(0);
            if let Some(Some(effect)) = cache.get(&item_id) {
                if let Some(obj) = option.as_object_mut() {
                    obj.insert("effectKey".to_string(), json!(effect.effect_key));
                    obj.insert("effectAmounts".to_string(), json!(effect.effect_amounts));
                }
            }
            option
        })
        .collect()
}

pub async fn list_gems_with_effects() -> Vec<Value> {
    let gems = list_gems();
    let missing: Vec<(u64, String)> = {
        let cache = GEM_EFFECT_CACHE.read().unwrap();
        gems.iter()
            .filter_map(|gem| {
                let item_id = gem
                    .get("item_id")
                    .and_then(|value| value.as_u64())
                    .unwrap_or(0);
                let name = gem
                    .get("name")
                    .and_then(|value| value.as_str())
                    .unwrap_or_default()
                    .to_string();
                if item_id == 0 || name.is_empty() {
                    return None;
                }
                match cache.get(&item_id) {
                    Some(None) => Some((item_id, name)),
                    Some(Some(effect))
                        if effect.category == "special"
                            && (!effect.is_pvp)
                            && (effect.primary_stat.is_none()
                                || effect.label.is_empty()
                                || effect.label == name) =>
                    {
                        Some((item_id, name))
                    }
                    Some(_) => None,
                    None => Some((item_id, name)),
                }
            })
            .collect()
    };

    if !missing.is_empty() {
        let fetched: Vec<(u64, Option<GemEffectInfo>)> = stream::iter(missing.into_iter())
            .map(|(item_id, name)| async move {
                let effect = fetch_gem_effect_info(item_id, &name).await;
                (item_id, effect)
            })
            .buffer_unordered(8)
            .collect()
            .await;

        if !fetched.is_empty() {
            let mut cache = GEM_EFFECT_CACHE.write().unwrap();
            for (key, effect) in fetched {
                cache.insert(key, effect);
            }
        }
    }

    let cache = GEM_EFFECT_CACHE.read().unwrap();
    gems.into_iter()
        .map(|mut gem| {
            let item_id = gem
                .get("item_id")
                .and_then(|value| value.as_u64())
                .unwrap_or(0);
            if let Some(Some(effect)) = cache.get(&item_id) {
                if let Some(obj) = gem.as_object_mut() {
                    obj.insert("label".to_string(), json!(effect.label));
                    obj.insert("category".to_string(), json!(effect.category));
                    obj.insert("primaryStat".to_string(), json!(effect.primary_stat));
                    obj.insert("primaryAmount".to_string(), json!(effect.primary_amount));
                    obj.insert("secondaryStat".to_string(), json!(effect.secondary_stat));
                    obj.insert(
                        "secondaryAmount".to_string(),
                        json!(effect.secondary_amount),
                    );
                    obj.insert("isPvp".to_string(), json!(effect.is_pvp));
                }
            }
            gem
        })
        .collect()
}

pub fn get_gem_info(gem_id: u64) -> Option<Value> {
    if let Some(item) = ITEMS.read().unwrap().get(&gem_id).cloned() {
        return Some(json!({
            "gem_id": gem_id,
            "name": item.name,
            "icon": item.icon,
            "quality": item.quality,
        }));
    }

    // Fallback: find the gem in enchantments dataset by item_id (preferred) or id.
    if let Some(e) = ENCHANTS_BY_ITEM_ID.read().unwrap().get(&gem_id).cloned() {
        return Some(json!({
            "gem_id": gem_id,
            "name": e.item_name.or(e.display_name).unwrap_or_default(),
            "icon": e.item_icon.or(e.spell_icon).unwrap_or_else(|| "inv_misc_questionmark".to_string()),
            "quality": e.quality.unwrap_or(3),
        }));
    }
    if let Some(e) = ENCHANTS.read().unwrap().get(&gem_id).cloned() {
        return Some(json!({
            "gem_id": gem_id,
            "name": e.item_name.or(e.display_name).unwrap_or_default(),
            "icon": e.item_icon.or(e.spell_icon).unwrap_or_else(|| "inv_misc_questionmark".to_string()),
            "quality": e.quality.unwrap_or(3),
        }));
    }

    None
}

pub fn apply_copy_enchants(source_simc: &str, target_simc: &str) -> String {
    let re_enchant = Regex::new(r",enchant_id=(\d+)").unwrap();
    let re_gem = Regex::new(r",gem_id=(\d+)").unwrap();

    let enchant = re_enchant
        .captures(source_simc)
        .and_then(|c| c.get(1))
        .and_then(|m| m.as_str().parse::<u64>().ok())
        .filter(|value| *value > 0);
    let gem = re_gem
        .captures(source_simc)
        .and_then(|c| c.get(1))
        .and_then(|m| m.as_str().parse::<u64>().ok())
        .filter(|value| *value > 0);

    let mut result = target_simc.to_string();

    // Remove existing
    result = re_enchant.replace_all(&result, "").to_string();
    result = re_gem.replace_all(&result, "").to_string();

    // Add new
    if let Some(e) = enchant {
        result.push_str(&format!(",enchant_id={}", e));
    }
    if let Some(g) = gem {
        result.push_str(&format!(",gem_id={}", g));
    }

    result
}

use crate::types::ResolvedItem;

pub fn apply_copy_enchants_to_map(
    mut items_by_slot: HashMap<String, Vec<ResolvedItem>>,
) -> HashMap<String, Vec<ResolvedItem>> {
    // Find equipped items to use as sources
    let mut sources: HashMap<String, (u64, u64, String, String)> = HashMap::new();
    for list in items_by_slot.values() {
        if let Some(eq) = list
            .iter()
            .find(|i: &&ResolvedItem| i.origin == crate::types::ItemOrigin::Equipped)
        {
            sources.insert(
                eq.slot.clone(),
                (
                    eq.enchant_id,
                    eq.gem_id,
                    eq.enchant_name.clone(),
                    eq.gem_name.clone(),
                ),
            );
        }
    }

    for (slot, list) in items_by_slot.iter_mut() {
        if let Some(&(eid, gid, ref ename, ref gname)) = sources.get(slot) {
            let ename_str: &str = ename;
            let gname_str: &str = gname;
            for item in list {
                if item.origin != crate::types::ItemOrigin::Equipped {
                    // Only copy from equipped when the target item is missing data.
                    // This preserves explicit enchant/gem choices made by the user.
                    if !item.prevent_copy_enchant && item.enchant_id == 0 && eid > 0 {
                        item.enchant_id = eid;
                        item.enchant_name = ename_str.to_string();
                    }
                    if !item.prevent_copy_gem && item.gem_id == 0 && gid > 0 {
                        item.gem_id = gid;
                        item.gem_name = gname_str.to_string();
                    }

                    // Update simc_string
                    item.simc_string = apply_copy_enchants(
                        &format!(",enchant_id={},gem_id={}", item.enchant_id, item.gem_id),
                        &item.simc_string,
                    );
                }
            }
        }
    }
    items_by_slot
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{EnchantData, GameItem};
    use std::sync::Arc;

    struct StateSnapshot {
        items: Arc<HashMap<u64, GameItem>>,
        enchants: Arc<HashMap<u64, EnchantData>>,
        enchants_by_item_id: Arc<HashMap<u64, EnchantData>>,
    }

    impl StateSnapshot {
        fn capture() -> Self {
            Self {
                items: ITEMS.read().unwrap().clone(),
                enchants: ENCHANTS.read().unwrap().clone(),
                enchants_by_item_id: ENCHANTS_BY_ITEM_ID.read().unwrap().clone(),
            }
        }

        fn restore(self) {
            *ITEMS.write().unwrap() = self.items;
            *ENCHANTS.write().unwrap() = self.enchants;
            *ENCHANTS_BY_ITEM_ID.write().unwrap() = self.enchants_by_item_id;
        }
    }

    fn enchant(
        id: u64,
        item_id: Option<u64>,
        item_name: &str,
        quality: u64,
        expansion: u64,
    ) -> EnchantData {
        EnchantData {
            id,
            item_id,
            item_name: Some(item_name.to_string()),
            item_icon: Some(format!("icon_{id}")),
            slot: Some("socket".to_string()),
            quality: Some(quality),
            expansion: Some(expansion),
            socket_type: Some("PRISMATIC".to_string()),
            crafting_quality: Some(quality),
            ..EnchantData::default()
        }
    }

    fn gem_item(id: u64, name: &str, quality: u64) -> GameItem {
        GameItem {
            id,
            name: name.to_string(),
            icon: format!("gem_{id}"),
            quality,
            base_ilevel: None,
            class: Some(3),
            subclass: None,
            inventory_type: None,
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

    #[test]
    fn list_gems_prefers_current_prismatic_enchant_dataset_and_highest_quality() {
        let _lock = crate::item_db::state::TEST_STATE_LOCK.lock().unwrap();
        let snapshot = StateSnapshot::capture();

        *ENCHANTS.write().unwrap() = Arc::new(HashMap::from([
            (1_u64, enchant(1, Some(1001), "Lower Ruby", 2, 10)),
            (2_u64, enchant(2, Some(1001), "Higher Ruby", 4, 10)),
            (3_u64, enchant(3, Some(1002), "Amber", 3, 10)),
            (4_u64, enchant(4, Some(1003), "Old Emerald", 5, 9)),
            (
                5_u64,
                EnchantData {
                    slot: Some("socket".to_string()),
                    socket_type: Some("TINKER".to_string()),
                    expansion: Some(10),
                    ..enchant(5, Some(1004), "Ignored Tinker", 5, 10)
                },
            ),
        ]));
        *ITEMS.write().unwrap() = Arc::new(HashMap::from([(2001_u64, gem_item(2001, "Fallback Gem", 5))]));

        let gems = list_gems();

        assert_eq!(gems.len(), 2);
        assert_eq!(gems[0]["name"], "Amber");
        assert_eq!(gems[1]["name"], "Higher Ruby");
        assert_eq!(gems[1]["item_id"], 1001);
        assert_eq!(gems[1]["quality"], 4);

        snapshot.restore();
    }

    #[test]
    fn list_gems_and_get_gem_info_fall_back_to_item_and_item_id_maps() {
        let _lock = crate::item_db::state::TEST_STATE_LOCK.lock().unwrap();
        let snapshot = StateSnapshot::capture();

        *ENCHANTS.write().unwrap() = Arc::new(HashMap::new());
        *ITEMS.write().unwrap() = Arc::new(HashMap::from([
            (3001_u64, gem_item(3001, "Ruby", 4)),
            (3002_u64, gem_item(3002, "Uncommon", 2)),
        ]));
        *ENCHANTS_BY_ITEM_ID.write().unwrap() = Arc::new(HashMap::from([(
            4001_u64,
            EnchantData {
                id: 91,
                item_name: Some("Fallback Sapphire".to_string()),
                spell_icon: Some("spell_icon".to_string()),
                quality: Some(3),
                ..EnchantData::default()
            },
        )]));

        let gems = list_gems();
        assert_eq!(gems.len(), 1);
        assert_eq!(gems[0]["item_id"], 3001);
        assert_eq!(gems[0]["name"], "Ruby");

        let from_items = get_gem_info(3001).expect("item dataset gem");
        assert_eq!(from_items["name"], "Ruby");
        assert_eq!(from_items["icon"], "gem_3001");

        let from_enchants = get_gem_info(4001).expect("enchant fallback gem");
        assert_eq!(from_enchants["name"], "Fallback Sapphire");
        assert_eq!(from_enchants["icon"], "spell_icon");

        snapshot.restore();
    }

    #[test]
    fn tooltip_parsers_extract_expected_effect_shapes() {
        assert_eq!(normalize_gem_stat("  Mastery and"), Some(("mast", "Mast")));
        assert_eq!(decode_html_entities("&lt;test&amp;value&gt;"), "<test&value>");
        assert_eq!(
            collapse_tooltip_text("<!--x--><div>Use:&nbsp;+123 Haste</div>"),
            "Use: +123 Haste"
        );
        assert_eq!(
            extract_special_gem_label("<!--nameDescStats--><br /> +Stormbringer and +Static Charge <!--i?"),
            Some("Stormbringer + Static Charge".to_string())
        );

        let gem = parse_gem_effect_info(
            "Versatile Emerald",
            "+<!--gem1-->400 <!----> Versatility <br /> +<!--gem2-->200 <!----> Mastery",
        );
        assert_eq!(gem.label, "400 Vers & 200 Mast");
        assert_eq!(gem.category, "vers");
        assert_eq!(gem.primary_stat.as_deref(), Some("vers"));
        assert_eq!(gem.secondary_stat.as_deref(), Some("mast"));

        let enchant = parse_enchant_effect_info(
            "<div>Use: Permanently enchants a weapon to grant 150 Haste and 90 Mastery. Requires Level 80</div>",
        )
        .expect("parsed enchant effect");
        assert_eq!(
            enchant.effect_key.as_deref(),
            Some("grant # haste and # mastery")
        );
        assert_eq!(enchant.effect_amounts, vec![150.0, 90.0]);
    }

    #[test]
    fn apply_copy_enchants_replaces_existing_ids_with_source_values() {
        let updated = apply_copy_enchants(
            "head=id=1,enchant_id=555,gem_id=777",
            "head=id=2,enchant_id=10,gem_id=20",
        );
        assert_eq!(updated, "head=id=2,enchant_id=555,gem_id=777");

        let removed = apply_copy_enchants("head=id=1", "head=id=2,enchant_id=10,gem_id=20");
        assert_eq!(removed, "head=id=2");
    }
}
