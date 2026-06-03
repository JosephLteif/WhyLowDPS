use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DungeonAffix {
    pub id: u32,
    pub name: String,
    pub description: String,
    pub icon: Option<String>,
    pub wowhead_url: Option<String>,
    pub spell_id: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DungeonInfo {
    pub id: u32,
    pub name: String,
    pub description: Option<String>,
    pub zone: Option<String>,
    pub slug: Option<String>,
    pub short_name: Option<String>,
    pub wowhead_id: Option<u32>,
    pub num_bosses: Option<u32>,
    pub expansion: Option<u32>,
    pub expansion_name: Option<String>,
    pub map_id: Option<u32>,
    pub challenge_mode_id: Option<u32>,
    pub minimum_level: Option<u32>,
    pub keystone_timer_ms: Option<u32>,
    pub keystone_upgrades: Vec<u32>,
    pub encounters: Vec<String>,
    pub blizzard_href: Option<String>,
    pub image_url: Option<String>,
    pub linked_code: Option<String>,
    pub blizzard_api_data: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DungeonSeasonData {
    pub season_id: u32,
    pub season_name: String,
    pub current_affixes: Vec<DungeonAffix>,
    pub rotation_dungeons: Vec<DungeonInfo>,
}

pub trait DungeonDataSource: Send + Sync {
    fn get_current_affixes(&self) -> Result<Vec<DungeonAffix>, String>;
    fn get_rotation_dungeons(&self) -> Result<Vec<DungeonInfo>, String>;
    fn get_season_info(&self) -> Result<DungeonSeasonData, String>;
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn dungeon_data_models_round_trip_optional_fields() {
        let affix = DungeonAffix {
            id: 9,
            name: "Tyrannical".to_string(),
            description: "Bosses are tougher.".to_string(),
            icon: Some("spell_nature_stoneclawtotem".to_string()),
            wowhead_url: Some("https://wowhead.com/affix=9".to_string()),
            spell_id: Some(409967),
        };
        let dungeon = DungeonInfo {
            id: 505,
            name: "Ara-Kara".to_string(),
            description: Some("Spider city".to_string()),
            zone: Some("Azj-Kahet".to_string()),
            slug: Some("ara-kara".to_string()),
            short_name: Some("AK".to_string()),
            wowhead_id: Some(12714),
            num_bosses: Some(3),
            expansion: Some(10),
            expansion_name: Some("The War Within".to_string()),
            map_id: Some(2345),
            challenge_mode_id: Some(678),
            minimum_level: Some(80),
            keystone_timer_ms: Some(1_800_000),
            keystone_upgrades: vec![1, 2, 3],
            encounters: vec!["First Boss".to_string(), "Second Boss".to_string()],
            blizzard_href: Some("https://example.com/dungeon".to_string()),
            image_url: Some("https://cdn.example.com/dungeon.png".to_string()),
            linked_code: Some("arakara".to_string()),
            blizzard_api_data: Some(json!({"id": 505, "extra": true})),
        };
        let season = DungeonSeasonData {
            season_id: 14,
            season_name: "Season 14".to_string(),
            current_affixes: vec![affix.clone()],
            rotation_dungeons: vec![dungeon.clone()],
        };

        let serialized = serde_json::to_value(&season).expect("serialize season");
        let parsed: DungeonSeasonData =
            serde_json::from_value(serialized).expect("deserialize season");

        assert_eq!(parsed.season_id, 14);
        assert_eq!(parsed.current_affixes[0].spell_id, Some(409967));
        assert_eq!(
            parsed.rotation_dungeons[0].short_name.as_deref(),
            Some("AK")
        );
        assert_eq!(
            parsed.rotation_dungeons[0]
                .blizzard_api_data
                .as_ref()
                .and_then(|value| value.get("extra"))
                .and_then(Value::as_bool),
            Some(true)
        );
    }

    #[test]
    fn dungeon_info_defaults_to_empty_lists_when_deserializing_minimal_payload() {
        let parsed: DungeonInfo = serde_json::from_value(json!({
            "id": 1,
            "name": "Minimal Dungeon",
            "keystone_upgrades": [],
            "encounters": []
        }))
        .expect("deserialize minimal dungeon");

        assert_eq!(parsed.id, 1);
        assert_eq!(parsed.name, "Minimal Dungeon");
        assert!(parsed.keystone_upgrades.is_empty());
        assert!(parsed.encounters.is_empty());
        assert!(parsed.zone.is_none());
        assert!(parsed.blizzard_api_data.is_none());
    }
}
