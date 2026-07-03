use serde_json::Value;

pub fn list_missives() -> Vec<Value> {
    super::crafting::list_current_missives()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::item_db::state::{BONUSES, CRAFTING_REAGENTS, CURRENT_SEASON_ID};
    use crate::types::{BonusData, BonusUpgrade};
    use std::collections::HashMap;
    use std::sync::Arc;

    struct StateSnapshot {
        bonuses: Arc<HashMap<u64, BonusData>>,
        crafting_reagents: Arc<HashMap<u64, crate::item_db::state::CraftingReagentData>>,
        current_season_id: u64,
    }

    impl StateSnapshot {
        fn capture() -> Self {
            Self {
                bonuses: BONUSES.read().unwrap().clone(),
                crafting_reagents: CRAFTING_REAGENTS.read().unwrap().clone(),
                current_season_id: *CURRENT_SEASON_ID.read().unwrap(),
            }
        }

        fn restore(self) {
            *BONUSES.write().unwrap() = self.bonuses;
            *CRAFTING_REAGENTS.write().unwrap() = self.crafting_reagents;
            *CURRENT_SEASON_ID.write().unwrap() = self.current_season_id;
        }
    }

    #[test]
    fn list_missives_delegates_to_crafting_missive_listing() {
        let _lock = crate::item_db::state::TEST_STATE_LOCK.lock().unwrap();
        let snapshot = StateSnapshot::capture();

        *CURRENT_SEASON_ID.write().unwrap() = 12;
        *BONUSES.write().unwrap() = Arc::new(HashMap::from([(
            1_u64,
            BonusData {
                crafted_stats: vec![32, 36],
                upgrade: Some(BonusUpgrade {
                    season_id: Some(12),
                    ..BonusUpgrade::default()
                }),
                ..BonusData::default()
            },
        )]));
        *CRAFTING_REAGENTS.write().unwrap() = Arc::new(HashMap::from([(
            77_u64,
            crate::item_db::state::CraftingReagentData {
                id: 77,
                name: "Delegated Missive".to_string(),
                icon: "delegated_icon".to_string(),
                quality: 2,
                item_id: Some(7070),
                crafting_bonus_ids: vec![1],
                reagent_type: "item".to_string(),
                expansion: Some(10),
                ..crate::item_db::state::CraftingReagentData::default()
            },
        )]));

        let direct = crate::item_db::crafting::list_current_missives();
        let delegated = list_missives();

        assert_eq!(delegated, direct);
        assert_eq!(delegated[0]["token"], "crit/haste");

        snapshot.restore();
    }
}
