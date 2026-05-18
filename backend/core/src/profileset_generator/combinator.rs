use crate::types::class_data::{self, ARMOR_SLOTS, GEAR_SLOTS};
use crate::types::{ItemOrigin, ResolvedItem};
use crate::{game_data, profileset::validation};
use serde_json::Value;
use std::collections::{HashMap, HashSet};

pub fn build_slot_candidates(
    base_profile: &str,
    items_by_slot: &HashMap<String, Vec<ResolvedItem>>,
    selected_items: &HashMap<String, Vec<String>>,
) -> HashMap<String, Vec<ResolvedItem>> {
    let mut slot_item_lists = HashMap::new();
    let bundle_anchor_slots = global_affix_bundle_anchor_slots(items_by_slot);
    for slot in GEAR_SLOTS {
        let slot_str = slot.to_string();
        let slot_items = match items_by_slot.get(&slot_str) {
            Some(items) => items,
            None => continue,
        };
        let selected_uids: HashSet<String> = selected_items
            .get(&slot_str)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .collect();
        let exact_selection_uids: HashSet<String> = slot_items
            .iter()
            .filter(|item| item.exact_selection_only && selected_uids.contains(&item.uid))
            .map(|item| item.uid.clone())
            .collect();
        let mut selected_identities: HashSet<String> =
            selected_uids.iter().map(|uid| uid_identity(uid)).collect();
        let mut selected_core_keys: HashSet<String> = selected_uids
            .iter()
            .filter(|uid| !exact_selection_uids.contains(*uid)).filter_map(|uid| uid_core_key(uid))
            .collect();
        if let Some(paired) = class_data::paired_slot(&slot_str) {
            if let Some(p_uids) = selected_items.get(paired) {
                selected_identities.extend(p_uids.iter().map(|uid| uid_identity(uid)));
                if let Some(paired_items) = items_by_slot.get(paired) {
                    let paired_exact_selection_uids: HashSet<String> = paired_items
                        .iter()
                        .filter(|item| item.exact_selection_only && p_uids.contains(&item.uid))
                        .map(|item| item.uid.clone())
                        .collect();
                    selected_core_keys.extend(
                        p_uids
                            .iter()
                            .filter(|uid| !paired_exact_selection_uids.contains(*uid))
                            .filter_map(|uid| uid_core_key(uid)),
                    );
                } else {
                    selected_core_keys.extend(p_uids.iter().filter_map(|uid| uid_core_key(uid)));
                }
        if let Some(paired) = class_data::paired_slot(&slot_str) {
            if let Some(p_uids) = selected_items.get(paired) {
                selected_identities.extend(p_uids.iter().map(|uid| uid_identity(uid)));
            }
        }

        let mut candidates = Vec::new();
        for item in slot_items {
            let uid = &item.uid;
            let identity = uid_identity(uid);
            let core_key = item_core_key(item);
            let bundle_id = item.global_affix_bundle_id.trim();
            if !bundle_id.is_empty()
                && bundle_anchor_slots
                    .get(bundle_id)
                    .is_some_and(|anchor| anchor != &slot_str)
            {
                continue;
            }
            if selected_uids.contains(uid)
                || selected_identities.contains(&identity)
                || selected_core_keys.contains(&core_key)
            {
                candidates.push(item.clone());
            }
        }

        if let Some(eq) = slot_items
            .iter()
            .find(|it| it.origin == ItemOrigin::Equipped)
        {
            if !candidates
                .iter()
                .any(|c| c.item_id == eq.item_id && c.origin == ItemOrigin::Equipped)
            {
                candidates.insert(0, eq.clone());
            }
        }
        if !candidates.is_empty() {
            slot_item_lists.insert(slot_str, candidates);
        }
    }
    apply_armor_filtering(base_profile, &mut slot_item_lists);
    slot_item_lists
}

pub fn generate_cartesian_product(option_lists: &[&Vec<ResolvedItem>]) -> Vec<Vec<usize>> {
    let mut all = vec![vec![]];
    for opts in option_lists {
        let mut new = Vec::new();
        for combo in &all {
            for i in 0..opts.len() {
                let mut c = combo.clone();
                c.push(i);
                new.push(c);
            }
        }
        all = new;
    }
    all
}

pub fn filter_valid_combos(
    all_combos: &[Vec<usize>],
    varying_slots: &[String],
    option_lists: &[&Vec<ResolvedItem>],
    slot_item_lists: &HashMap<String, Vec<ResolvedItem>>,
    spec: &str,
    catalyst_charges: Option<u32>,
) -> Vec<HashMap<String, ResolvedItem>> {
    let mut valid = Vec::new();
    let mut seen = HashSet::new();
    for indices in all_combos {
        let gear_set =
            build_gear_set_from_combo(indices, varying_slots, option_lists, slot_item_lists, spec);
        if is_valid_gear_set(&gear_set, spec, catalyst_charges) && !is_baseline_gear_set(&gear_set)
        {
            let key = gear_set_identity_key(&gear_set);
            if seen.insert(key) {
                valid.push(gear_set);
            }
        }
    }
    valid
}

pub fn build_gear_set_from_combo(
    indices: &[usize],
    varying_slots: &[String],
    option_lists: &[&Vec<ResolvedItem>],
    slot_item_lists: &HashMap<String, Vec<ResolvedItem>>,
    spec: &str,
) -> HashMap<String, ResolvedItem> {
    let mut gear_set = HashMap::new();
    for slot in GEAR_SLOTS {
        let s_str = slot.to_string();
        if let Some(items) = slot_item_lists.get(&s_str) {
            let d = items
                .iter()
                .find(|it| it.origin == ItemOrigin::Equipped)
                .unwrap_or(&items[0]);
            gear_set.insert(s_str, d.clone());
        }
    }
    for (i, slot) in varying_slots.iter().enumerate() {
        gear_set.insert(slot.clone(), option_lists[i][indices[i]].clone());
    }
    if let Some(bundle_id) = active_global_affix_bundle_id(&gear_set).map(str::to_string) {
        for slot in GEAR_SLOTS {
            let s_str = slot.to_string();
            let Some(items) = slot_item_lists.get(&s_str) else {
                continue;
            };
            let Some(current_item) = gear_set.get(&s_str) else {
                continue;
            };
            let current_identity = bundle_item_identity(current_item);
            if let Some(bundle_item) = items
                .iter()
                .find(|item| {
                    item.global_affix_bundle_id.trim() == bundle_id.as_str()
                        && bundle_item_identity(item) == current_identity
                })
            {
                gear_set.insert(s_str, bundle_item.clone());
            }
        }
    }
    if validation::main_hand_is_two_hand(&gear_set, spec) {
        gear_set.remove("off_hand");
    }
    gear_set
}

pub fn is_valid_gear_set(
    gs: &HashMap<String, ResolvedItem>,
    spec: &str,
    catalyst: Option<u32>,
) -> bool {
    validation::validate_unique_equipped(gs)
        && validation::validate_vault_constraint(gs)
        && validation::validate_weapon_constraint(gs, spec)
        && validation::validate_item_limits(gs)
        && validate_global_affix_bundle(gs)
        && catalyst.is_none_or(|c| validation::validate_catalyst_constraint(gs, c))
}

fn validate_global_affix_bundle(gs: &HashMap<String, ResolvedItem>) -> bool {
    let mut seen_bundle: Option<&str> = None;
    for item in gs.values() {
        let bundle_id = item.global_affix_bundle_id.trim();
        if bundle_id.is_empty() {
            continue;
        }
        match seen_bundle {
            Some(existing) if existing != bundle_id => return false,
            Some(_) => {}
            None => seen_bundle = Some(bundle_id),
        }
    }
    true
}

fn global_affix_bundle_anchor_slots(
    items_by_slot: &HashMap<String, Vec<ResolvedItem>>,
) -> HashMap<String, String> {
    let mut anchors = HashMap::new();
    for slot in GEAR_SLOTS {
        let slot_str = slot.to_string();
        let Some(items) = items_by_slot.get(&slot_str) else {
            continue;
        };
        for item in items {
            let bundle_id = item.global_affix_bundle_id.trim();
            if bundle_id.is_empty() {
                continue;
            }
            anchors
                .entry(bundle_id.to_string())
                .or_insert_with(|| slot_str.clone());
        }
    }
    anchors
}

fn active_global_affix_bundle_id(gs: &HashMap<String, ResolvedItem>) -> Option<&str> {
    gs.values()
        .find_map(|item| {
            let bundle_id = item.global_affix_bundle_id.trim();
            if bundle_id.is_empty() {
                None
            } else {
                Some(bundle_id)
            }
        })
}

pub fn is_baseline_gear_set(gs: &HashMap<String, ResolvedItem>) -> bool {
    GEAR_SLOTS.iter().all(|slot| {
        gs.get(*slot)
            .is_none_or(|i| i.origin == ItemOrigin::Equipped)
    })
}

pub fn gear_set_identity_key(gs: &HashMap<String, ResolvedItem>) -> String {
    let mut parts: Vec<String> = Vec::new();

    // Group paired slots together to make identity position-independent
    let mut finger_items: Vec<String> = Vec::new();
    let mut trinket_items: Vec<String> = Vec::new();

    for slot in GEAR_SLOTS {
        if let Some(i) = gs.get(*slot) {
            let mut bids = i.bonus_ids.clone();
            bids.sort();
            let b_key = bids
                .iter()
                .map(|b| b.to_string())
                .collect::<Vec<_>>()
                .join(":");
            let item_key = format!(
                "{}:{}:i{}:e{}:g{}",
                i.item_id,
                b_key,
                i.ilevel,
                i.enchant_id,
                i.gem_id
            );

            match *slot {
                "finger1" | "finger2" => finger_items.push(item_key),
                "trinket1" | "trinket2" => trinket_items.push(item_key),
                _ => parts.push(format!("{}={}", slot, item_key)),
            }
        } else {
            match *slot {
                "finger1" | "finger2" => finger_items.push("none".to_string()),
                "trinket1" | "trinket2" => trinket_items.push("none".to_string()),
                _ => parts.push(format!("{}=none", slot)),
            }
        }
    }

    finger_items.sort();
    trinket_items.sort();

    parts.push(format!("finger={}", finger_items.join(",")));
    parts.push(format!("trinket={}", trinket_items.join(",")));

    parts.sort();
    parts.join("|")
}

fn apply_armor_filtering(profile: &str, slot_item_lists: &mut HashMap<String, Vec<ResolvedItem>>) {
    if let Some(class) = class_data::detect_class(profile) {
        if let Some(max) = class_data::class_max_armor(class.as_str()) {
            for slot in ARMOR_SLOTS {
                let s_str = slot.to_string();
                if let Some(items) = slot_item_lists.get_mut(&s_str) {
                    items.retain(|i| {
                        if i.origin == ItemOrigin::Equipped {
                            return true;
                        }
                        if i.item_id == 0 {
                            return true;
                        }
                        game_data::get_item_armor_subclass(i.item_id)
                            .is_none_or(|s| s <= max || s == 0)
                    });
                }
            }
        }
    }
}

pub fn uid_identity(uid: &str) -> String {
    uid.rsplit_once(':')
        .map(|(prefix, _)| prefix.to_string())
        .unwrap_or_else(|| uid.to_string())
}

fn uid_core_key(uid: &str) -> Option<String> {
    let parts: Vec<&str> = uid.split(':').collect();
    let item_id = parts.first()?.parse::<u64>().ok()?;
    let origin = parts
        .iter()
        .copied()
        .find(|part| matches!(*part, "equipped" | "bags" | "vault"))?;
    Some(format!("{}:{}", item_id, origin))
}

fn item_core_key(item: &ResolvedItem) -> String {
    format!("{}:{}", item.item_id, item.origin.as_str())
}

fn bundle_item_identity(item: &ResolvedItem) -> String {
    let mut bonus_ids = item.bonus_ids.clone();
    bonus_ids.sort();
    let bonus_key = bonus_ids
        .iter()
        .map(|bonus_id| bonus_id.to_string())
        .collect::<Vec<_>>()
        .join(":");
    format!("{}:{}:{}", item.item_id, bonus_key, item.ilevel)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_item(
        uid: &str,
        slot: &str,
        item_id: u64,
        origin: ItemOrigin,
        enchant_id: u64,
        gem_id: u64,
        bundle_id: &str,
    ) -> ResolvedItem {
        ResolvedItem {
            uid: uid.to_string(),
            slot: slot.to_string(),
            item_id,
            origin,
            enchant_id,
            gem_id,
            global_affix_bundle_id: bundle_id.to_string(),
            quality: 4,
            sockets: if gem_id > 0 { 1 } else { 0 },
            ..ResolvedItem::default()
        }
    }

    #[test]
    fn global_affix_bundles_keep_distinct_ring_pairings() {
        let platinum = make_item("plat-eq", "finger1", 1001, ItemOrigin::Equipped, 501, 701, "");
        let loa = make_item("loa-eq", "finger2", 1002, ItemOrigin::Equipped, 502, 702, "");

        let mut finger1_items = vec![
            platinum.clone(),
            make_item("loa-alt", "finger2", 1002, ItemOrigin::Bags, 502, 702, ""),
        ];
        let mut finger2_items = vec![
            loa.clone(),
            make_item("plat-alt", "finger1", 1001, ItemOrigin::Bags, 501, 701, ""),
        ];

        let mut bundle_index = 1;
        for enchant_id in [601_u64, 602, 603] {
            for gem_id in [801_u64, 802, 803] {
                let bundle_id = bundle_index.to_string();
                let purloined_variant = make_item(
                    &format!("purloined-{bundle_id}"),
                    "finger2",
                    1003,
                    ItemOrigin::Bags,
                    enchant_id,
                    gem_id,
                    &bundle_id,
                );
                finger2_items.push(purloined_variant.clone());
                finger1_items.push(purloined_variant);
                bundle_index += 1;
            }
        }

        let slot_item_lists = HashMap::from([
            ("finger1".to_string(), finger1_items),
            ("finger2".to_string(), finger2_items),
        ]);
        let varying_slots = vec!["finger1".to_string(), "finger2".to_string()];
        let option_lists = vec![
            slot_item_lists.get("finger1").unwrap(),
            slot_item_lists.get("finger2").unwrap(),
        ];
        let all_combos = generate_cartesian_product(&option_lists);
        let valid = filter_valid_combos(
            &all_combos,
            &varying_slots,
            &option_lists,
            &slot_item_lists,
            "arcane",
            None,
        );

        assert_eq!(valid.len(), 19);
    }
}

pub struct UpgradeCombo {
    pub choices: Vec<(String, usize)>,
}
pub struct UpgradeDfsCtx<'a> {
    pub slots: &'a [String],
    pub options: &'a HashMap<String, Vec<Value>>,
    pub budget: &'a HashMap<u64, u64>,
    pub limit: usize,
    pub best_spend: u64,
    pub retained: Vec<UpgradeCombo>,
    pub spent: HashMap<u64, u64>,
    pub current: Vec<(String, usize)>,
    pub retain_all: bool,
}

impl UpgradeDfsCtx<'_> {
    fn within_budget(&self, cost: &HashMap<u64, u64>) -> bool {
        cost.iter().all(|(cid, amount)| {
            self.spent.get(cid).copied().unwrap_or(0) + amount
                <= self.budget.get(cid).copied().unwrap_or(0)
        })
    }

    pub fn dfs(&mut self, idx: usize) {
        if idx == self.slots.len() {
            if self.retain_all {
                self.retained.push(UpgradeCombo {
                    choices: self.current.clone(),
                });
            } else {
                let total: u64 = self.spent.values().sum();
                if total > self.best_spend {
                    self.best_spend = total;
                    self.retained.clear();
                }
                if total >= self.best_spend {
                    self.retained.push(UpgradeCombo {
                        choices: self.current.clone(),
                    });
                }
            }
            return;
        }

        let slot = self.slots[idx].clone();
        let slot_opts = self.options.get(&slot).unwrap();

        self.current.push((slot.clone(), 0));
        self.dfs(idx + 1);
        self.current.pop();

        for (i, opt) in slot_opts.iter().enumerate() {
            let costs: HashMap<u64, u64> = opt
                .get("upgrade_costs")
                .and_then(|v| serde_json::from_value(v.clone()).ok())
                .unwrap_or_default();
            if !self.within_budget(&costs) {
                continue;
            }
            for (cid, amount) in &costs {
                *self.spent.entry(*cid).or_insert(0) += amount;
            }
            self.current.push((slot.clone(), i + 1));
            self.dfs(idx + 1);
            self.current.pop();
            for (cid, amount) in &costs {
                let e = self.spent.entry(*cid).or_insert(0);
                *e = e.saturating_sub(*amount);
            }
            if self.retained.len() > self.limit * 2 {
                return;
            }
        }
    }
}
