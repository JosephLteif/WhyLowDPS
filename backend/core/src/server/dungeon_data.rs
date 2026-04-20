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
