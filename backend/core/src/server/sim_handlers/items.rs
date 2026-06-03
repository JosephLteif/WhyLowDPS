pub(super) struct ResolvedItemSeed {
    pub(super) name: String,
    pub(super) icon: String,
    pub(super) quality: i64,
    pub(super) ilevel: i64,
    pub(super) bonus_ids: Vec<u64>,
}

pub(super) fn build_simc_item_string(item_id: u64, bonus_ids: &[u64], ilevel: i64) -> String {
    if bonus_ids.is_empty() {
        if ilevel > 0 {
            format!(",id={},ilevel={}", item_id, ilevel)
        } else {
            format!(",id={}", item_id)
        }
    } else {
        let joined = bonus_ids
            .iter()
            .map(|b| b.to_string())
            .collect::<Vec<_>>()
            .join("/");
        if ilevel > 0 {
            format!(",id={},bonus_id={},ilevel={}", item_id, joined, ilevel)
        } else {
            format!(",id={},bonus_id={}", item_id, joined)
        }
    }
}

pub(super) fn make_resolved_item(
    slot: &str,
    item_id: u64,
    seed: ResolvedItemSeed,
    origin: crate::types::ItemOrigin,
    inventory_type: i64,
) -> crate::types::ResolvedItem {
    let uid_bonus = if seed.bonus_ids.is_empty() {
        "0".to_string()
    } else {
        seed.bonus_ids
            .iter()
            .map(|b| b.to_string())
            .collect::<Vec<_>>()
            .join("-")
    };
    let simc_string = build_simc_item_string(item_id, &seed.bonus_ids, seed.ilevel);
    crate::types::ResolvedItem {
        uid: format!(
            "{}:{}:{}:{}",
            item_id,
            uid_bonus,
            origin.as_str(),
            slot.to_lowercase()
        ),
        slot: slot.to_string(),
        item_id,
        ilevel: seed.ilevel,
        simc_string,
        origin,
        bonus_ids: seed.bonus_ids,
        enchant_id: 0,
        gem_id: 0,
        name: seed.name,
        icon: seed.icon,
        quality: seed.quality,
        quality_color: crate::types::class_data::quality_color(seed.quality as u64).to_string(),
        tag: String::new(),
        upgrade: String::new(),
        sockets: 0,
        enchant_name: String::new(),
        gem_name: String::new(),
        gem_icon: String::new(),
        encounter: String::new(),
        instance_name: String::new(),
        source_type: String::new(),
        season_id: crate::item_db::current_season_id() as i64,
        inventory_type,
        is_catalyst: false,
        can_catalyst: false,
        ..Default::default()
    }
}

pub(super) fn fallback_spec_id_by_name(spec_name: &str) -> Option<u64> {
    match spec_name {
        "arcane" => Some(62),
        "fire" => Some(63),
        "frost" => Some(64),
        "holy" => Some(65),
        "protection" => None,
        "retribution" => Some(70),
        "arms" => Some(71),
        "fury" => Some(72),
        "balance" => Some(102),
        "feral" => Some(103),
        "guardian" => Some(104),
        "restoration" => None,
        "devastation" => Some(1467),
        "preservation" => Some(1468),
        "augmentation" => Some(1473),
        "blood" => Some(250),
        "frost_death_knight" | "frostdk" => Some(251),
        "unholy" => Some(252),
        "beast_mastery" | "beastmastery" => Some(253),
        "marksmanship" => Some(254),
        "survival" => Some(255),
        "discipline" => Some(256),
        "holy_priest" | "holypriest" => Some(257),
        "shadow" => Some(258),
        "assassination" => Some(259),
        "outlaw" => Some(260),
        "subtlety" => Some(261),
        "elemental" => Some(262),
        "enhancement" => Some(263),
        "restoration_shaman" | "restorationshaman" => Some(264),
        "affliction" => Some(265),
        "demonology" => Some(266),
        "destruction" => Some(267),
        "brewmaster" => Some(268),
        "windwalker" => Some(269),
        "mistweaver" => Some(270),
        "havoc" => Some(577),
        "vengeance" => Some(581),
        _ => None,
    }
}

pub(super) fn resolve_active_spec_id(class_name: &str, spec_name: &str) -> Option<u64> {
    if let Some(id) = crate::types::class_data::class_spec_ids(class_name, Some(spec_name))
        .into_iter()
        .next()
    {
        return Some(id);
    }

    match (class_name, spec_name) {
        ("paladin", "protection") => return Some(66),
        ("warrior", "protection") => return Some(73),
        ("druid", "restoration") => return Some(105),
        ("shaman", "restoration") => return Some(264),
        ("priest", "holy") => return Some(257),
        _ => {}
    }

    fallback_spec_id_by_name(spec_name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::ItemOrigin;

    #[test]
    fn build_simc_item_string_includes_bonus_ids_and_positive_ilevel_only() {
        assert_eq!(build_simc_item_string(123, &[], 0), ",id=123");
        assert_eq!(build_simc_item_string(123, &[], 489), ",id=123,ilevel=489");
        assert_eq!(
            build_simc_item_string(123, &[111, 222], 0),
            ",id=123,bonus_id=111/222"
        );
        assert_eq!(
            build_simc_item_string(123, &[111, 222], 489),
            ",id=123,bonus_id=111/222,ilevel=489"
        );
    }

    #[test]
    fn make_resolved_item_uses_stable_uid_simc_string_and_metadata() {
        let item = make_resolved_item(
            "MainHand",
            19019,
            ResolvedItemSeed {
                name: "Thunderfury".to_string(),
                icon: "inv_sword_39".to_string(),
                quality: 5,
                ilevel: 500,
                bonus_ids: vec![111, 222],
            },
            ItemOrigin::Vault,
            13,
        );

        assert_eq!(item.uid, "19019:111-222:vault:mainhand");
        assert_eq!(item.slot, "MainHand");
        assert_eq!(item.simc_string, ",id=19019,bonus_id=111/222,ilevel=500");
        assert_eq!(item.bonus_ids, vec![111, 222]);
        assert_eq!(item.origin, ItemOrigin::Vault);
        assert_eq!(item.inventory_type, 13);
        assert_eq!(item.name, "Thunderfury");
        assert_eq!(item.icon, "inv_sword_39");
        assert_eq!(item.quality, 5);
        assert_eq!(item.season_id, crate::item_db::current_season_id() as i64);
    }

    #[test]
    fn resolve_active_spec_id_disambiguates_duplicate_spec_names_by_class() {
        assert_eq!(resolve_active_spec_id("paladin", "protection"), Some(66));
        assert_eq!(resolve_active_spec_id("warrior", "protection"), Some(73));
        assert_eq!(resolve_active_spec_id("priest", "holy"), Some(257));
        assert_eq!(resolve_active_spec_id("mage", "frost"), Some(64));
        assert_eq!(resolve_active_spec_id("unknown", "unknown"), None);
    }

    #[test]
    fn fallback_spec_id_by_name_covers_legacy_aliases_and_ambiguous_names() {
        assert_eq!(fallback_spec_id_by_name("frostdk"), Some(251));
        assert_eq!(fallback_spec_id_by_name("frost_death_knight"), Some(251));
        assert_eq!(fallback_spec_id_by_name("beastmastery"), Some(253));
        assert_eq!(fallback_spec_id_by_name("holy_priest"), Some(257));
        assert_eq!(fallback_spec_id_by_name("restoration_shaman"), Some(264));

        assert_eq!(fallback_spec_id_by_name("protection"), None);
        assert_eq!(fallback_spec_id_by_name("restoration"), None);
    }
}
