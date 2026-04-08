use regex::Regex;
use once_cell::sync::Lazy;
use std::collections::HashMap;

use crate::types::class_data;

pub mod patterns {
    use super::*;
    use crate::types::class_data::GEAR_SLOTS;

    pub static GEAR_RE: Lazy<Regex> = Lazy::new(|| {
        let pattern = format!(r"^({})=(.*)", GEAR_SLOTS.join("|"));
        Regex::new(&pattern).unwrap()
    });
    pub static TALENTS_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^talents=(.+)").unwrap());
    pub static SPEC_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^spec=(\w+)").unwrap());
}

const BASE64: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Extract the specId from a talent export string header (bits 8-23).
pub fn extract_spec_id_from_talent_string(talent_str: &str) -> Option<u64> {
    let mut bits = Vec::new();
    for ch in talent_str.bytes() {
        let val = BASE64.iter().position(|&b| b == ch)?;
        for bit in 0..6 {
            bits.push((val >> bit) & 1);
        }
        if bits.len() >= 24 {
            break;
        }
    }
    if bits.len() < 24 {
        return None;
    }
    let mut spec_id = 0u64;
    for i in 0..16 {
        if bits[8 + i] == 1 {
            spec_id |= 1 << i;
        }
    }
    Some(spec_id)
}

pub fn parse_base_profile(base_profile: &str) -> (Vec<String>, HashMap<String, String>, String, String) {
    let mut non_gear_lines = Vec::new();
    let mut equipped_gear = HashMap::new();
    let mut talents = String::new();
    let mut spec = String::new();

    for line in base_profile.lines() {
        let stripped = line.trim();
        if stripped.is_empty() { continue; }

        if let Some(caps) = patterns::TALENTS_RE.captures(stripped) {
            talents = caps[1].to_string();
            continue;
        }
        if let Some(caps) = patterns::SPEC_RE.captures(stripped) {
            spec = caps[1].to_lowercase();
        }
        if let Some(caps) = patterns::GEAR_RE.captures(stripped) {
            equipped_gear.insert(caps[1].to_lowercase(), caps[2].to_string());
            continue;
        }
        non_gear_lines.push(stripped.to_string());
    }
    (non_gear_lines, equipped_gear, talents, spec)
}
