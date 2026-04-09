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
        let mut selected_identities: HashSet<String> =
            selected_uids.iter().map(|uid| uid_identity(uid)).collect();
        if let Some(paired) = class_data::paired_slot(&slot_str) {
            if let Some(p_uids) = selected_items.get(paired) {
                selected_identities.extend(p_uids.iter().map(|uid| uid_identity(uid)));
            }
        }

        let mut candidates = Vec::new();
        for item in slot_items {
            let uid = &item.uid;
            let identity = uid_identity(uid);
            if selected_uids.contains(uid) || selected_identities.contains(&identity) {
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
        && catalyst.is_none_or(|c| validation::validate_catalyst_constraint(gs, c))
}

pub fn is_baseline_gear_set(gs: &HashMap<String, ResolvedItem>) -> bool {
    GEAR_SLOTS.iter().all(|slot| {
        gs.get(*slot)
            .is_none_or(|i| i.origin == ItemOrigin::Equipped)
    })
}

pub fn gear_set_identity_key(gs: &HashMap<String, ResolvedItem>) -> String {
    GEAR_SLOTS
        .iter()
        .map(|slot| {
            if let Some(i) = gs.get(*slot) {
                let mut bids = i.bonus_ids.clone();
                bids.sort();
                let b_key = bids
                    .iter()
                    .map(|b| b.to_string())
                    .collect::<Vec<_>>()
                    .join(":");
                format!(
                    "{}={}:{}:e{}:g{}",
                    slot, i.item_id, b_key, i.enchant_id, i.gem_id
                )
            } else {
                format!("{}=none", slot)
            }
        })
        .collect::<Vec<_>>()
        .join("|")
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
