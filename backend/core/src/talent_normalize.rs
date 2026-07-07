//! Normalize WoW talent export strings for SimC compatibility.
//!
//! WoW's talent export may omit freeNode talents and subtree selector nodes.
//! SimC requires these to be present. This module decodes the talent string,
//! adds missing free nodes and subtree selectors, and re-encodes.

use regex::Regex;

use crate::item_db;

const BASE64: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BITS_PER_CHAR: usize = 6;

fn to_bits(s: &str) -> Vec<bool> {
    let mut bits = Vec::new();
    for ch in s.bytes() {
        let val = BASE64.iter().position(|&b| b == ch);
        if let Some(val) = val {
            for bit in 0..BITS_PER_CHAR {
                bits.push((val >> bit) & 1 == 1);
            }
        }
    }
    bits
}

fn read_bits(bits: &[bool], pos: usize, width: usize) -> (u64, usize) {
    let mut value = 0u64;
    for i in 0..width {
        if pos + i < bits.len() && bits[pos + i] {
            value |= 1 << i;
        }
    }
    (value, pos + width)
}

struct BitWriter {
    bits: Vec<bool>,
}

impl BitWriter {
    fn new() -> Self {
        Self { bits: Vec::new() }
    }

    fn write(&mut self, value: u64, width: usize) {
        for i in 0..width {
            self.bits.push((value >> i) & 1 == 1);
        }
    }

    fn to_base64(&self) -> String {
        let mut bits = self.bits.clone();
        while !bits.len().is_multiple_of(BITS_PER_CHAR) {
            bits.push(false);
        }
        let mut result = String::new();
        for chunk in bits.chunks(BITS_PER_CHAR) {
            let mut val = 0usize;
            for (bit, &set) in chunk.iter().enumerate() {
                if set {
                    val |= 1 << bit;
                }
            }
            result.push(BASE64[val] as char);
        }
        result
    }
}

#[derive(Clone)]
struct NodeSelection {
    ranks: u64,
    choice_index: i32,
}

/// Normalize all `talents=` lines in a simc input string.
pub fn normalize_simc_talents(simc_input: &str) -> String {
    let re = Regex::new(r"(?m)^((?:profileset\.[^\n]*\+?=)?talents=)(.+)$").unwrap();
    re.replace_all(simc_input, |caps: &regex::Captures| {
        let prefix = &caps[1];
        let talent_str = caps[2].trim();
        match normalize_talent_string(talent_str) {
            Some(normalized) => format!("{}{}", prefix, normalized),
            None => caps[0].to_string(),
        }
    })
    .to_string()
}

fn normalize_talent_string(talent_str: &str) -> Option<String> {
    let bits = to_bits(talent_str);
    if bits.len() < 152 {
        return None; // too short for header
    }

    let (version, mut pos) = read_bits(&bits, 0, 8);
    let (spec_id, new_pos) = read_bits(&bits, pos, 16);
    pos = new_pos;
    pos += 128; // skip hash

    let tree = item_db::talent_tree(spec_id)?;

    // Build full node order and metadata from talent tree + all sibling specs
    let full_node_order: Vec<u64> = tree
        .get("fullNodeOrder")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_u64()).collect())
        .unwrap_or_default();

    if full_node_order.is_empty() {
        return None;
    }

    // Collect node metadata from all sibling specs
    let siblings = item_db::talent_trees_for_class(spec_id);
    let mut node_max_ranks: std::collections::HashMap<u64, u64> = std::collections::HashMap::new();
    let mut node_is_free: std::collections::HashMap<u64, bool> = std::collections::HashMap::new();
    let mut node_is_choice: std::collections::HashMap<u64, bool> = std::collections::HashMap::new();

    for sibling in &siblings {
        for key in &["classNodes", "specNodes", "heroNodes"] {
            if let Some(nodes) = sibling.get(key).and_then(|v| v.as_array()) {
                for node in nodes {
                    let id = node.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
                    if id == 0 {
                        continue;
                    }
                    let mr = node.get("maxRanks").and_then(|v| v.as_u64()).unwrap_or(1);
                    node_max_ranks.insert(id, mr);
                    let free = node
                        .get("freeNode")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);
                    if free {
                        node_is_free.insert(id, true);
                    }
                    let ntype = node.get("type").and_then(|v| v.as_str()).unwrap_or("");
                    let entries_len = node
                        .get("entries")
                        .and_then(|v| v.as_array())
                        .map(|a| a.len())
                        .unwrap_or(0);
                    if (ntype == "choice" || ntype == "subtree") && entries_len > 1 {
                        node_is_choice.insert(id, true);
                    }
                }
            }
        }
        // SubTree selector nodes
        if let Some(nodes) = sibling.get("subTreeNodes").and_then(|v| v.as_array()) {
            for node in nodes {
                let id = node.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
                if id == 0 {
                    continue;
                }
                node_max_ranks.entry(id).or_insert(1);
                let entries_len = node
                    .get("entries")
                    .and_then(|v| v.as_array())
                    .map(|a| a.len())
                    .unwrap_or(0);
                if entries_len > 1 {
                    node_is_choice.insert(id, true);
                }
            }
        }
    }

    // Decode selections
    let mut selections: std::collections::HashMap<u64, NodeSelection> =
        std::collections::HashMap::new();
    for &node_id in &full_node_order {
        if pos >= bits.len() {
            break;
        }
        let (is_sel, new_pos) = read_bits(&bits, pos, 1);
        pos = new_pos;
        if is_sel == 0 {
            continue;
        }

        let (is_purch, new_pos) = read_bits(&bits, pos, 1);
        pos = new_pos;
        if is_purch == 0 {
            // Free/granted node
            selections.insert(
                node_id,
                NodeSelection {
                    ranks: *node_max_ranks.get(&node_id).unwrap_or(&1),
                    choice_index: -1,
                },
            );
            continue;
        }

        let mut ranks = *node_max_ranks.get(&node_id).unwrap_or(&1);
        let (is_partial, new_pos) = read_bits(&bits, pos, 1);
        pos = new_pos;
        if is_partial == 1 {
            let (r, new_pos) = read_bits(&bits, pos, 6);
            pos = new_pos;
            ranks = r;
        }

        let mut choice_index: i32 = -1;
        let (is_choice_bit, new_pos) = read_bits(&bits, pos, 1);
        pos = new_pos;
        if is_choice_bit == 1 {
            let (ci, new_pos) = read_bits(&bits, pos, 2);
            pos = new_pos;
            choice_index = ci as i32;
        }

        selections.insert(
            node_id,
            NodeSelection {
                ranks,
                choice_index,
            },
        );
    }

    // Auto-grant freeNode talents (only from this spec's tree, not siblings)
    let mut changed = false;
    for key in &["classNodes", "specNodes", "heroNodes"] {
        if let Some(nodes) = tree.get(key).and_then(|v| v.as_array()) {
            for node in nodes {
                let id = node.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
                let free = node
                    .get("freeNode")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                if free && id != 0 && !selections.contains_key(&id) {
                    let mr = node.get("maxRanks").and_then(|v| v.as_u64()).unwrap_or(1);
                    selections.insert(
                        id,
                        NodeSelection {
                            ranks: mr,
                            choice_index: -1,
                        },
                    );
                    changed = true;
                }
            }
        }
    }

    // Fix subtree selectors: add if missing, fix choiceIndex if -1 (this spec only)
    if let Some(st_nodes) = tree.get("subTreeNodes").and_then(|v| v.as_array()) {
        for st_node in st_nodes {
            let id = st_node.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
            if id == 0 {
                continue;
            }
            let sel = selections.get(&id);
            if sel.is_some() && sel.unwrap().choice_index >= 0 {
                continue;
            }
            // Infer from selected hero nodes
            if let Some(entries) = st_node.get("entries").and_then(|v| v.as_array()) {
                for (i, entry) in entries.iter().enumerate() {
                    if let Some(nodes) = entry.get("nodes").and_then(|v| v.as_array()) {
                        let any_selected = nodes.iter().any(|n| {
                            n.as_u64()
                                .map(|nid| selections.contains_key(&nid))
                                .unwrap_or(false)
                        });
                        if any_selected {
                            selections.insert(
                                id,
                                NodeSelection {
                                    ranks: 1,
                                    choice_index: i as i32,
                                },
                            );
                            changed = true;
                            break;
                        }
                    }
                }
            }
        }
    }

    if !changed {
        return None; // no changes needed
    }

    // Re-encode
    let mut writer = BitWriter::new();
    writer.write(version, 8);
    writer.write(spec_id, 16);
    // Zero hash (128 bits)
    for _ in 0..16 {
        writer.write(0, 8);
    }

    for &node_id in &full_node_order {
        let sel = match selections.get(&node_id) {
            Some(s) => s,
            None => {
                writer.write(0, 1);
                continue;
            }
        };

        writer.write(1, 1); // isSelected

        if *node_is_free.get(&node_id).unwrap_or(&false) {
            writer.write(0, 1); // isPurchased = false
            continue;
        }

        writer.write(1, 1); // isPurchased

        let max = *node_max_ranks.get(&node_id).unwrap_or(&1);
        let is_partial = sel.ranks < max;
        writer.write(if is_partial { 1 } else { 0 }, 1);
        if is_partial {
            writer.write(sel.ranks, 6);
        }

        let is_choice = *node_is_choice.get(&node_id).unwrap_or(&false);
        writer.write(if is_choice { 1 } else { 0 }, 1);
        if is_choice {
            writer.write(sel.choice_index.max(0) as u64, 2);
        }
    }

    Some(writer.to_base64())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};
    use std::collections::HashMap;
    use std::sync::Arc;

    struct StateSnapshot {
        talent_trees: Arc<HashMap<u64, Value>>,
    }

    impl StateSnapshot {
        fn capture() -> Self {
            Self {
                talent_trees: crate::item_db::state::TALENT_TREES.read().unwrap().clone(),
            }
        }

        fn restore(self) {
            *crate::item_db::state::TALENT_TREES.write().unwrap() = self.talent_trees;
        }
    }

    fn install_test_talent_trees() {
        let current_tree = json!({
            "classId": 7,
            "fullNodeOrder": [100, 300, 400],
            "classNodes": [
                {
                    "id": 100,
                    "maxRanks": 2,
                    "freeNode": true,
                    "entries": [{}]
                }
            ],
            "specNodes": [],
            "heroNodes": [
                {
                    "id": 400,
                    "maxRanks": 1,
                    "entries": [{}]
                }
            ],
            "subTreeNodes": [
                {
                    "id": 300,
                    "entries": [
                        { "nodes": [400] },
                        { "nodes": [401] }
                    ]
                }
            ]
        });
        let sibling_tree = json!({
            "classId": 7,
            "fullNodeOrder": [100, 300, 401],
            "classNodes": [
                {
                    "id": 100,
                    "maxRanks": 2,
                    "freeNode": true,
                    "entries": [{}]
                }
            ],
            "specNodes": [],
            "heroNodes": [
                {
                    "id": 401,
                    "maxRanks": 1,
                    "entries": [{}]
                }
            ],
            "subTreeNodes": [
                {
                    "id": 300,
                    "entries": [
                        { "nodes": [400] },
                        { "nodes": [401] }
                    ]
                }
            ]
        });

        *crate::item_db::state::TALENT_TREES.write().unwrap() = Arc::new(HashMap::from([
            (42_u64, current_tree),
            (43_u64, sibling_tree),
        ]));
    }

    fn encode_talent_string(spec_id: u64, selections: &[(u64, NodeSelection)]) -> String {
        let mut writer = BitWriter::new();
        writer.write(1, 8);
        writer.write(spec_id, 16);
        for _ in 0..16 {
            writer.write(0, 8);
        }

        let selection_map: HashMap<u64, NodeSelection> = selections
            .iter()
            .map(|(node_id, selection)| (*node_id, selection.clone()))
            .collect();

        for node_id in [100_u64, 300_u64, 400_u64] {
            let Some(selection) = selection_map.get(&node_id) else {
                writer.write(0, 1);
                continue;
            };

            writer.write(1, 1);

            match node_id {
                100 => {
                    writer.write(0, 1);
                }
                300 => {
                    writer.write(1, 1);
                    writer.write(0, 1);
                    writer.write(1, 1);
                    writer.write(selection.choice_index.max(0) as u64, 2);
                }
                400 => {
                    writer.write(1, 1);
                    writer.write(0, 1);
                    writer.write(0, 1);
                }
                _ => unreachable!(),
            }
        }

        writer.to_base64()
    }

    fn decode_test_nodes(talent_str: &str) -> HashMap<u64, NodeSelection> {
        let bits = to_bits(talent_str);
        let (_, mut pos) = read_bits(&bits, 0, 8);
        let (_, new_pos) = read_bits(&bits, pos, 16);
        pos = new_pos + 128;

        let mut selections = HashMap::new();
        for node_id in [100_u64, 300_u64, 400_u64] {
            let (is_selected, next_pos) = read_bits(&bits, pos, 1);
            pos = next_pos;
            if is_selected == 0 {
                continue;
            }

            let (is_purchased, next_pos) = read_bits(&bits, pos, 1);
            pos = next_pos;
            if is_purchased == 0 {
                selections.insert(
                    node_id,
                    NodeSelection {
                        ranks: 2,
                        choice_index: -1,
                    },
                );
                continue;
            }

            let (is_partial, next_pos) = read_bits(&bits, pos, 1);
            pos = next_pos;
            let ranks = if is_partial == 1 {
                let (ranks, next_pos) = read_bits(&bits, pos, 6);
                pos = next_pos;
                ranks
            } else {
                1
            };

            let (is_choice, next_pos) = read_bits(&bits, pos, 1);
            pos = next_pos;
            let choice_index = if is_choice == 1 {
                let (choice_index, next_pos) = read_bits(&bits, pos, 2);
                pos = next_pos;
                choice_index as i32
            } else {
                -1
            };

            selections.insert(
                node_id,
                NodeSelection {
                    ranks,
                    choice_index,
                },
            );
        }

        selections
    }

    #[test]
    fn normalize_talent_string_adds_missing_free_node_and_subtree_selector() {
        let _lock = crate::item_db::state::TEST_STATE_LOCK.lock().unwrap();
        let snapshot = StateSnapshot::capture();
        install_test_talent_trees();

        let encoded = encode_talent_string(
            42,
            &[(
                400,
                NodeSelection {
                    ranks: 1,
                    choice_index: -1,
                },
            )],
        );

        let normalized = normalize_talent_string(&encoded).expect("talents should normalize");
        let decoded = decode_test_nodes(&normalized);

        assert_eq!(decoded.get(&100).map(|sel| sel.ranks), Some(2));
        assert_eq!(decoded.get(&300).map(|sel| sel.choice_index), Some(0));
        assert_eq!(decoded.get(&400).map(|sel| sel.ranks), Some(1));

        snapshot.restore();
    }

    #[test]
    fn normalize_talent_string_returns_none_when_no_adjustment_is_needed() {
        let _lock = crate::item_db::state::TEST_STATE_LOCK.lock().unwrap();
        let snapshot = StateSnapshot::capture();
        install_test_talent_trees();

        let encoded = encode_talent_string(
            42,
            &[
                (
                    100,
                    NodeSelection {
                        ranks: 2,
                        choice_index: -1,
                    },
                ),
                (
                    300,
                    NodeSelection {
                        ranks: 1,
                        choice_index: 0,
                    },
                ),
                (
                    400,
                    NodeSelection {
                        ranks: 1,
                        choice_index: -1,
                    },
                ),
            ],
        );

        assert_eq!(normalize_talent_string(&encoded), None);

        snapshot.restore();
    }

    #[test]
    fn normalize_simc_talents_updates_base_and_profileset_lines_only_when_supported() {
        let _lock = crate::item_db::state::TEST_STATE_LOCK.lock().unwrap();
        let snapshot = StateSnapshot::capture();
        install_test_talent_trees();

        let encoded = encode_talent_string(
            42,
            &[(
                400,
                NodeSelection {
                    ranks: 1,
                    choice_index: -1,
                },
            )],
        );
        let input = format!(
            "warrior=\"Tester\"\ntalents={}\nprofileset.\"Alt\"+=talents={}\ntrinket1=id=1\nprofileset.\"Keep\"+=talents=short\n",
            encoded, encoded
        );

        let output = normalize_simc_talents(&input);
        let mut lines = output.lines();

        let normalized_main = lines
            .nth(1)
            .and_then(|line| line.strip_prefix("talents="))
            .expect("main talents line");
        let normalized_profileset = lines
            .next()
            .and_then(|line| line.strip_prefix("profileset.\"Alt\"+=talents="))
            .expect("profileset talents line");

        assert_ne!(normalized_main, encoded);
        assert_eq!(normalized_main, normalized_profileset);
        assert!(output.contains("profileset.\"Keep\"+=talents=short"));

        snapshot.restore();
    }
}
