use once_cell::sync::Lazy;
use regex::Regex;
use std::collections::HashMap;

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

pub fn parse_base_profile(
    base_profile: &str,
) -> (Vec<String>, HashMap<String, String>, String, String) {
    let mut non_gear_lines = Vec::new();
    let mut equipped_gear = HashMap::new();
    let mut talents = String::new();
    let mut spec = String::new();

    for line in base_profile.lines() {
        let stripped = line.trim();
        if stripped.is_empty() {
            continue;
        }

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

#[cfg(test)]
mod tests {
    use super::*;

    fn encode_talent_header_with_spec_id(spec_id: u64) -> String {
        let mut bits = [0u8; 24];
        for i in 0..16 {
            if ((spec_id >> i) & 1) == 1 {
                bits[8 + i] = 1;
            }
        }

        let mut out = String::new();
        for chunk in 0..4 {
            let mut value = 0u8;
            for bit in 0..6 {
                value |= bits[chunk * 6 + bit] << bit;
            }
            out.push(BASE64[value as usize] as char);
        }
        out
    }

    #[test]
    fn extract_spec_id_from_talent_string_decodes_header_bits() {
        let talent = encode_talent_header_with_spec_id(577);
        assert_eq!(extract_spec_id_from_talent_string(&talent), Some(577));
    }

    #[test]
    fn extract_spec_id_from_talent_string_rejects_invalid_base64_chars() {
        assert_eq!(extract_spec_id_from_talent_string("!bad"), None);
        assert_eq!(extract_spec_id_from_talent_string("A"), None);
    }

    #[test]
    fn parse_base_profile_separates_gear_talents_and_other_lines() {
        let profile = r#"
mage="Testmage"
spec=arcane
talents=ABCD
head=id=1111,bonus_id=1/2
finger1=id=2222
off_hand=id=3333
race=night_elf
"#;

        let (non_gear, equipped, talents, spec) = parse_base_profile(profile);

        assert_eq!(talents, "ABCD");
        assert_eq!(spec, "arcane");
        assert_eq!(
            equipped.get("head"),
            Some(&"id=1111,bonus_id=1/2".to_string())
        );
        assert_eq!(equipped.get("finger1"), Some(&"id=2222".to_string()));
        assert_eq!(equipped.get("off_hand"), Some(&"id=3333".to_string()));
        assert!(non_gear.contains(&"mage=\"Testmage\"".to_string()));
        assert!(non_gear.contains(&"spec=arcane".to_string()));
        assert!(non_gear.contains(&"race=night_elf".to_string()));
        assert!(!non_gear.iter().any(|line| line.starts_with("head=")));
    }

    #[test]
    fn parse_base_profile_uses_last_spec_and_talent_lines() {
        let profile = r#"
  mage="Testmage"
  spec=frost
  talents=OLD
  spec=arcane
  talents=NEW
  head=id=1111
"#;

        let (non_gear, equipped, talents, spec) = parse_base_profile(profile);

        assert_eq!(talents, "NEW");
        assert_eq!(spec, "arcane");
        assert_eq!(equipped.get("head"), Some(&"id=1111".to_string()));
        assert!(non_gear.contains(&"mage=\"Testmage\"".to_string()));
        assert!(non_gear.contains(&"spec=frost".to_string()));
        assert!(non_gear.contains(&"spec=arcane".to_string()));
        assert!(!non_gear.iter().any(|line| line.starts_with("talents=")));
    }
}
