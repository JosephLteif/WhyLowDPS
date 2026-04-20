use crate::item_db::get_runtime_data;
use crate::server::dungeon_data::{
    DungeonAffix, DungeonDataSource, DungeonInfo, DungeonSeasonData,
};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::future::Future;
use std::thread;
use std::time::Duration;
use tokio::runtime::{Builder, Handle};

const RAIDER_AFFIXES_URL: &str = "https://raider.io/api/v1/mythic-plus/affixes?region=us&locale=en";

#[derive(Debug, Clone, Deserialize)]
struct RaiderAffixesResponse {
    leaderboard_url: Option<String>,
    #[serde(default)]
    affix_details: Vec<RaiderAffixDetail>,
}

#[derive(Debug, Clone, Deserialize)]
struct RaiderAffixDetail {
    id: Option<u32>,
    name: Option<String>,
    description: Option<String>,
    icon_url: Option<String>,
    wowhead_url: Option<String>,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DungeonDetail {
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

pub struct BlizzardDungeonSource {
    runtime_data: serde_json::Value,
    dungeon_cache: HashMap<u32, DungeonDetail>,
}

impl BlizzardDungeonSource {
    pub fn new() -> Self {
        let runtime_data = get_runtime_data();
        let dungeon_cache = Self::load_dungeon_details(&runtime_data);
        Self {
            runtime_data,
            dungeon_cache,
        }
    }

    fn run_async<T, F>(fut: F) -> Result<T, String>
    where
        T: Send + 'static,
        F: Future<Output = Result<T, String>> + Send + 'static,
    {
        if Handle::try_current().is_ok() {
            // Actix workers may run on a current-thread Tokio runtime where block_in_place panics.
            // Run the async work on a dedicated thread with its own runtime instead.
            let join = thread::spawn(move || {
                let runtime = Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .map_err(|e| format!("failed to create async runtime: {}", e))?;
                runtime.block_on(fut)
            });
            match join.join() {
                Ok(result) => result,
                Err(_) => Err("raider fetch thread panicked".to_string()),
            }
        } else {
            let runtime = Builder::new_current_thread()
                .enable_all()
                .build()
                .map_err(|e| format!("failed to create async runtime: {}", e))?;
            runtime.block_on(fut)
        }
    }

    fn http_client() -> Option<Client> {
        Client::builder()
            .timeout(Duration::from_secs(8))
            .user_agent("whylowdps/raider-sync")
            .build()
            .ok()
    }

    fn map_affix_spell_id(affix_id: u32, affix_name: &str) -> Option<u32> {
        match affix_id {
            9 => Some(409967),   // Tyrannical
            10 => Some(409968),  // Fortified
            11 => Some(226510),  // Bursting (legacy, retained for tooltip support)
            12 => Some(240447),  // Grievous
            13 => Some(240443),  // Volcanic
            134 => Some(373724), // Thundering
            147 => Some(408556), // Xal'atath's Guile
            160 => Some(461866), // Xal'atath's Bargain: Devour
            162 => Some(462771), // Xal'atath's Bargain: Pulsar
            _ => {
                let lower = affix_name.to_ascii_lowercase();
                if lower.contains("tyrannical") {
                    Some(409967)
                } else if lower.contains("fortified") {
                    Some(409968)
                } else {
                    None
                }
            }
        }
    }

    fn infer_season_name_from_raider_url(url: &str) -> Option<String> {
        let marker = "/season-";
        let idx = url.find(marker)?;
        let tail = &url[(idx + marker.len())..];
        let slug = tail.split('/').next()?;
        let mut parts = slug.split('-');
        let expansion_code = parts.next()?.to_ascii_lowercase();
        let season_num_raw = parts.next()?;
        let season_num = season_num_raw.parse::<u32>().ok()?;

        let expansion_name = match expansion_code.as_str() {
            "mn" => "Midnight",
            "tww" => "The War Within",
            "df" => "Dragonflight",
            "sl" => "Shadowlands",
            "bfa" => "Battle for Azeroth",
            "legion" => "Legion",
            _ => {
                let upper = expansion_code.to_ascii_uppercase();
                if upper.is_empty() {
                    return None;
                }
                return Some(format!("{} Season {}", upper, season_num));
            }
        };

        Some(format!("{} Season {}", expansion_name, season_num))
    }

    fn load_dungeon_details(runtime: &serde_json::Value) -> HashMap<u32, DungeonDetail> {
        let mut cache = HashMap::new();

        if let Some(dungeons) = runtime.get("dungeon_details").and_then(|d| d.as_array()) {
            for d in dungeons {
                let id = match d.get("id").and_then(|v| v.as_u64()) {
                    Some(n) => n as u32,
                    None => continue,
                };
                let name = match d.get("name").and_then(|v| v.as_str()) {
                    Some(s) => s.to_string(),
                    None => continue,
                };
                let description = d
                    .get("description")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let zone = d
                    .get("zone")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let slug = d
                    .get("slug")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let short_name = d
                    .get("short_name")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let wowhead_id = d
                    .get("wowhead_id")
                    .and_then(|v| v.as_u64())
                    .map(|n| n as u32);
                let num_bosses = d
                    .get("num_bosses")
                    .and_then(|v| v.as_u64())
                    .map(|n| n as u32);
                let expansion = d
                    .get("expansion")
                    .and_then(|v| v.as_u64())
                    .map(|n| n as u32);
                let expansion_name = d
                    .get("expansion_name")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let map_id = d.get("map_id").and_then(|v| v.as_u64()).map(|n| n as u32);
                let challenge_mode_id = d
                    .get("challenge_mode_id")
                    .and_then(|v| v.as_u64())
                    .map(|n| n as u32);
                let minimum_level = d
                    .get("minimum_level")
                    .and_then(|v| v.as_u64())
                    .map(|n| n as u32);
                let keystone_timer_ms = d
                    .get("keystone_timer_ms")
                    .and_then(|v| v.as_u64())
                    .map(|n| n as u32);
                let keystone_upgrades = d
                    .get("keystone_upgrades")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|n| n.as_u64())
                            .map(|n| n as u32)
                            .collect::<Vec<u32>>()
                    })
                    .unwrap_or_default();
                let encounters = d
                    .get("encounters")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|n| n.as_str().map(|s| s.to_string()))
                            .collect::<Vec<String>>()
                    })
                    .unwrap_or_default();
                let blizzard_href = d
                    .get("blizzard_href")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let image_url = d
                    .get("image_url")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let linked_code = d
                    .get("linked_code")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let blizzard_api_data = d.get("blizzard_api_data").cloned();

                cache.insert(
                    id,
                    DungeonDetail {
                        id,
                        name,
                        description,
                        zone,
                        slug,
                        short_name,
                        wowhead_id,
                        num_bosses,
                        expansion,
                        expansion_name,
                        map_id,
                        challenge_mode_id,
                        minimum_level,
                        keystone_timer_ms,
                        keystone_upgrades,
                        encounters,
                        blizzard_href,
                        image_url,
                        linked_code,
                        blizzard_api_data,
                    },
                );
            }
        }

        cache
    }

    fn get_cached_affixes(&self) -> Vec<DungeonAffix> {
        self.runtime_data
            .get("current_affixes")
            .and_then(|a| a.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| {
                        Some(DungeonAffix {
                            id: v.get("id")?.as_u64()?.try_into().ok()?,
                            name: v.get("name")?.as_str()?.to_string(),
                            description: v.get("description")?.as_str()?.to_string(),
                            icon: v
                                .get("icon")
                                .and_then(|i| i.as_str())
                                .map(|s| s.to_string()),
                            wowhead_url: v
                                .get("wowhead_url")
                                .and_then(|w| w.as_str())
                                .map(|s| s.to_string()),
                            spell_id: v
                                .get("spell_id")
                                .and_then(|s| s.as_u64())
                                .and_then(|n| n.try_into().ok()),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    fn fetch_raider_affixes(&self) -> Result<(Vec<DungeonAffix>, Option<String>), String> {
        Self::run_async(async {
            let client =
                Self::http_client().ok_or_else(|| "failed to create http client".to_string())?;
            let response = client
                .get(RAIDER_AFFIXES_URL)
                .send()
                .await
                .map_err(|e| format!("raider affix request failed: {}", e))?;

            if !response.status().is_success() {
                return Err(format!(
                    "raider affix request failed with status {}",
                    response.status()
                ));
            }

            let payload: RaiderAffixesResponse = response
                .json()
                .await
                .map_err(|e| format!("raider affix response parse failed: {}", e))?;
            let season_name = payload
                .leaderboard_url
                .as_deref()
                .and_then(Self::infer_season_name_from_raider_url);

            let affixes: Vec<DungeonAffix> = payload
                .affix_details
                .into_iter()
                .filter_map(|affix| {
                    let id = affix.id?;
                    let name = affix.name?;
                    if name.trim().is_empty() {
                        return None;
                    }
                    let description = affix.description.unwrap_or_default();
                    let icon = affix.icon_url;
                    let wowhead_url = affix.wowhead_url;
                    let spell_id = Self::map_affix_spell_id(id, &name);

                    Some(DungeonAffix {
                        id,
                        name,
                        description,
                        icon,
                        wowhead_url,
                        spell_id,
                    })
                })
                .collect();

            if affixes.is_empty() {
                return Err("raider affix response had no affixes".to_string());
            }

            Ok((affixes, season_name))
        })
    }

    fn get_cached_season(&self) -> Option<(u32, String)> {
        let season_id = self
            .runtime_data
            .get("current_season_id")
            .and_then(|n| n.as_u64())
            .map(|n| n as u32)
            .unwrap_or(crate::item_db::current_season_id() as u32);
        let season_name = self
            .runtime_data
            .get("season_name")
            .and_then(|n| n.as_str())
            .map(|s| s.to_string())?;

        Some((season_id, season_name))
    }

    fn get_cached_rotation_ids(&self) -> Vec<u32> {
        self.runtime_data
            .get("mplus_rotation")
            .and_then(|r| r.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_u64())
                    .filter_map(|n| n.try_into().ok())
                    .collect()
            })
            .unwrap_or_default()
    }

    fn get_all_dungeon_details(&self) -> Vec<DungeonDetail> {
        let mut details: Vec<_> = self.dungeon_cache.values().cloned().collect();
        details.sort_by_key(|d| d.id);
        details
    }
}

impl Default for BlizzardDungeonSource {
    fn default() -> Self {
        Self::new()
    }
}

impl DungeonDataSource for BlizzardDungeonSource {
    fn get_current_affixes(&self) -> Result<Vec<DungeonAffix>, String> {
        if let Ok((live_affixes, _)) = self.fetch_raider_affixes() {
            return Ok(live_affixes);
        }

        let cached = self.get_cached_affixes();
        if !cached.is_empty() {
            return Ok(cached);
        }

        Ok(vec![
            DungeonAffix {
                id: 1,
                name: "Tyrannical".to_string(),
                description: "Health and damage increased by 15%.".to_string(),
                icon: None,
                wowhead_url: Some("https://wowhead.com/affix=9".to_string()),
                spell_id: Some(409967),
            },
            DungeonAffix {
                id: 2,
                name: "Fortified".to_string(),
                description: "Non-boss health increased by 20% and damage increased by 10%."
                    .to_string(),
                icon: None,
                wowhead_url: Some("https://wowhead.com/affix=10".to_string()),
                spell_id: Some(409968),
            },
            DungeonAffix {
                id: 3,
                name: "Afflicted".to_string(),
                description: "Soulshards roam the dungeon, seeking the nearest player.".to_string(),
                icon: None,
                wowhead_url: Some("https://wowhead.com/affix=124".to_string()),
                spell_id: Some(466033),
            },
            DungeonAffix {
                id: 4,
                name: "Entangling".to_string(),
                description: "Roots periodically trap players.".to_string(),
                icon: None,
                wowhead_url: Some("https://wowhead.com/affix=125".to_string()),
                spell_id: Some(455024),
            },
        ])
    }

    fn get_rotation_dungeons(&self) -> Result<Vec<DungeonInfo>, String> {
        let dungeon_ids = self.get_cached_rotation_ids();

        // First try to get enriched details from cache
        let mut details = self.get_all_dungeon_details();
        if !dungeon_ids.is_empty() {
            let mut order_map = HashMap::new();
            for (idx, id) in dungeon_ids.iter().enumerate() {
                order_map.insert(*id, idx);
            }
            details.retain(|d| order_map.contains_key(&d.id));
            details.sort_by_key(|d| order_map.get(&d.id).copied().unwrap_or(usize::MAX));
        }

        if !details.is_empty() {
            return Ok(details
                .into_iter()
                .map(|d| DungeonInfo {
                    id: d.id,
                    name: d.name,
                    description: d.description,
                    zone: d.zone,
                    slug: d.slug,
                    short_name: d.short_name,
                    wowhead_id: d.wowhead_id,
                    num_bosses: d.num_bosses,
                    expansion: d.expansion,
                    expansion_name: d.expansion_name,
                    map_id: d.map_id,
                    challenge_mode_id: d.challenge_mode_id,
                    minimum_level: d.minimum_level,
                    keystone_timer_ms: d.keystone_timer_ms,
                    keystone_upgrades: d.keystone_upgrades,
                    encounters: d.encounters,
                    blizzard_href: d.blizzard_href,
                    image_url: d.image_url,
                    linked_code: d.linked_code,
                    blizzard_api_data: d.blizzard_api_data,
                })
                .collect());
        }

        // Fall back to item_db instances
        let instances = crate::item_db::list_instances();
        let mut dungeons: Vec<DungeonInfo> = instances
            .into_iter()
            .filter(|instance| {
                instance.instance_type == "mythic_plus" || instance.instance_type == "dungeon"
            })
            .map(|instance| DungeonInfo {
                id: instance.id as u32,
                name: instance.name,
                description: None,
                zone: instance.zone,
                slug: None,
                short_name: None,
                wowhead_id: Some(instance.id as u32),
                num_bosses: instance.boss_count.map(|b| b as u32),
                expansion: Some(instance.expansion as u32),
                expansion_name: None,
                map_id: None,
                challenge_mode_id: None,
                minimum_level: None,
                keystone_timer_ms: None,
                keystone_upgrades: Vec::new(),
                encounters: Vec::new(),
                blizzard_href: None,
                image_url: None,
                linked_code: None,
                blizzard_api_data: None,
            })
            .collect();

        if dungeons.is_empty() {
            dungeons = vec![
                DungeonInfo {
                    id: 1,
                    name: "Siege of Boralus".to_string(),
                    description: None,
                    zone: Some("Darkshore".to_string()),
                    slug: None,
                    short_name: None,
                    wowhead_id: Some(134),
                    num_bosses: Some(4),
                    expansion: Some(7),
                    expansion_name: None,
                    map_id: None,
                    challenge_mode_id: None,
                    minimum_level: None,
                    keystone_timer_ms: None,
                    keystone_upgrades: Vec::new(),
                    encounters: Vec::new(),
                    blizzard_href: None,
                    image_url: None,
                    linked_code: None,
                    blizzard_api_data: None,
                },
                DungeonInfo {
                    id: 2,
                    name: "Atal'zar".to_string(),
                    description: None,
                    zone: Some("Nazmir".to_string()),
                    slug: None,
                    short_name: None,
                    wowhead_id: Some(244),
                    num_bosses: Some(6),
                    expansion: Some(7),
                    expansion_name: None,
                    map_id: None,
                    challenge_mode_id: None,
                    minimum_level: None,
                    keystone_timer_ms: None,
                    keystone_upgrades: Vec::new(),
                    encounters: Vec::new(),
                    blizzard_href: None,
                    image_url: None,
                    linked_code: None,
                    blizzard_api_data: None,
                },
                DungeonInfo {
                    id: 3,
                    name: "The Freehold".to_string(),
                    description: None,
                    zone: Some("Zuldazar".to_string()),
                    slug: None,
                    short_name: None,
                    wowhead_id: Some(245),
                    num_bosses: Some(5),
                    expansion: Some(7),
                    expansion_name: None,
                    map_id: None,
                    challenge_mode_id: None,
                    minimum_level: None,
                    keystone_timer_ms: None,
                    keystone_upgrades: Vec::new(),
                    encounters: Vec::new(),
                    blizzard_href: None,
                    image_url: None,
                    linked_code: None,
                    blizzard_api_data: None,
                },
                DungeonInfo {
                    id: 4,
                    name: "Kings' Rest".to_string(),
                    description: None,
                    zone: Some("Zuldazar".to_string()),
                    slug: None,
                    short_name: None,
                    wowhead_id: Some(246),
                    num_bosses: Some(4),
                    expansion: Some(7),
                    expansion_name: None,
                    map_id: None,
                    challenge_mode_id: None,
                    minimum_level: None,
                    keystone_timer_ms: None,
                    keystone_upgrades: Vec::new(),
                    encounters: Vec::new(),
                    blizzard_href: None,
                    image_url: None,
                    linked_code: None,
                    blizzard_api_data: None,
                },
                DungeonInfo {
                    id: 5,
                    name: "Sethralis".to_string(),
                    description: None,
                    zone: Some("Stormsong Valley".to_string()),
                    slug: None,
                    short_name: None,
                    wowhead_id: Some(247),
                    num_bosses: Some(4),
                    expansion: Some(7),
                    expansion_name: None,
                    map_id: None,
                    challenge_mode_id: None,
                    minimum_level: None,
                    keystone_timer_ms: None,
                    keystone_upgrades: Vec::new(),
                    encounters: Vec::new(),
                    blizzard_href: None,
                    image_url: None,
                    linked_code: None,
                    blizzard_api_data: None,
                },
                DungeonInfo {
                    id: 6,
                    name: "Shrine of the Storm".to_string(),
                    description: None,
                    zone: Some("Vol'dun".to_string()),
                    slug: None,
                    short_name: None,
                    wowhead_id: Some(249),
                    num_bosses: Some(4),
                    expansion: Some(7),
                    expansion_name: None,
                    map_id: None,
                    challenge_mode_id: None,
                    minimum_level: None,
                    keystone_timer_ms: None,
                    keystone_upgrades: Vec::new(),
                    encounters: Vec::new(),
                    blizzard_href: None,
                    image_url: None,
                    linked_code: None,
                    blizzard_api_data: None,
                },
                DungeonInfo {
                    id: 7,
                    name: "Temple of Sethraliss".to_string(),
                    description: None,
                    zone: Some("Zuljan Reach".to_string()),
                    slug: None,
                    short_name: None,
                    wowhead_id: Some(159),
                    num_bosses: Some(4),
                    expansion: Some(8),
                    expansion_name: None,
                    map_id: None,
                    challenge_mode_id: None,
                    minimum_level: None,
                    keystone_timer_ms: None,
                    keystone_upgrades: Vec::new(),
                    encounters: Vec::new(),
                    blizzard_href: None,
                    image_url: None,
                    linked_code: None,
                    blizzard_api_data: None,
                },
                DungeonInfo {
                    id: 8,
                    name: "Murozand".to_string(),
                    description: None,
                    zone: Some("N'Zoth".to_string()),
                    slug: None,
                    short_name: None,
                    wowhead_id: Some(160),
                    num_bosses: Some(4),
                    expansion: Some(8),
                    expansion_name: None,
                    map_id: None,
                    challenge_mode_id: None,
                    minimum_level: None,
                    keystone_timer_ms: None,
                    keystone_upgrades: Vec::new(),
                    encounters: Vec::new(),
                    blizzard_href: None,
                    image_url: None,
                    linked_code: None,
                    blizzard_api_data: None,
                },
                DungeonInfo {
                    id: 9,
                    name: "Return to Kharzet".to_string(),
                    description: None,
                    zone: Some("Kharzet".to_string()),
                    slug: None,
                    short_name: None,
                    wowhead_id: Some(200),
                    num_bosses: Some(4),
                    expansion: Some(8),
                    expansion_name: None,
                    map_id: None,
                    challenge_mode_id: None,
                    minimum_level: None,
                    keystone_timer_ms: None,
                    keystone_upgrades: Vec::new(),
                    encounters: Vec::new(),
                    blizzard_href: None,
                    image_url: None,
                    linked_code: None,
                    blizzard_api_data: None,
                },
                DungeonInfo {
                    id: 10,
                    name: "The Necrotic Wake".to_string(),
                    description: None,
                    zone: Some("Maldraxxus".to_string()),
                    slug: None,
                    short_name: None,
                    wowhead_id: Some(229),
                    num_bosses: Some(4),
                    expansion: Some(9),
                    expansion_name: None,
                    map_id: None,
                    challenge_mode_id: None,
                    minimum_level: None,
                    keystone_timer_ms: None,
                    keystone_upgrades: Vec::new(),
                    encounters: Vec::new(),
                    blizzard_href: None,
                    image_url: None,
                    linked_code: None,
                    blizzard_api_data: None,
                },
                DungeonInfo {
                    id: 11,
                    name: "Plaguefall".to_string(),
                    description: None,
                    zone: Some("Maldraxxus".to_string()),
                    slug: None,
                    short_name: None,
                    wowhead_id: Some(234),
                    num_bosses: Some(4),
                    expansion: Some(9),
                    expansion_name: None,
                    map_id: None,
                    challenge_mode_id: None,
                    minimum_level: None,
                    keystone_timer_ms: None,
                    keystone_upgrades: Vec::new(),
                    encounters: Vec::new(),
                    blizzard_href: None,
                    image_url: None,
                    linked_code: None,
                    blizzard_api_data: None,
                },
                DungeonInfo {
                    id: 12,
                    name: "Halls of Atonement".to_string(),
                    description: None,
                    zone: Some("Maldraxxus".to_string()),
                    slug: None,
                    short_name: None,
                    wowhead_id: Some(235),
                    num_bosses: Some(3),
                    expansion: Some(9),
                    expansion_name: None,
                    map_id: None,
                    challenge_mode_id: None,
                    minimum_level: None,
                    keystone_timer_ms: None,
                    keystone_upgrades: Vec::new(),
                    encounters: Vec::new(),
                    blizzard_href: None,
                    image_url: None,
                    linked_code: None,
                    blizzard_api_data: None,
                },
                DungeonInfo {
                    id: 13,
                    name: "Spires of Ascension".to_string(),
                    description: None,
                    zone: Some("Bastion".to_string()),
                    slug: None,
                    short_name: None,
                    wowhead_id: Some(238),
                    num_bosses: Some(4),
                    expansion: Some(9),
                    expansion_name: None,
                    map_id: None,
                    challenge_mode_id: None,
                    minimum_level: None,
                    keystone_timer_ms: None,
                    keystone_upgrades: Vec::new(),
                    encounters: Vec::new(),
                    blizzard_href: None,
                    image_url: None,
                    linked_code: None,
                    blizzard_api_data: None,
                },
                DungeonInfo {
                    id: 14,
                    name: "Sanguine Depths".to_string(),
                    description: None,
                    zone: Some("Maldraxxus".to_string()),
                    slug: None,
                    short_name: None,
                    wowhead_id: Some(239),
                    num_bosses: Some(4),
                    expansion: Some(9),
                    expansion_name: None,
                    map_id: None,
                    challenge_mode_id: None,
                    minimum_level: None,
                    keystone_timer_ms: None,
                    keystone_upgrades: Vec::new(),
                    encounters: Vec::new(),
                    blizzard_href: None,
                    image_url: None,
                    linked_code: None,
                    blizzard_api_data: None,
                },
                DungeonInfo {
                    id: 15,
                    name: "Theater of Pain".to_string(),
                    description: None,
                    zone: Some("Maldraxxus".to_string()),
                    slug: None,
                    short_name: None,
                    wowhead_id: Some(240),
                    num_bosses: Some(4),
                    expansion: Some(9),
                    expansion_name: None,
                    map_id: None,
                    challenge_mode_id: None,
                    minimum_level: None,
                    keystone_timer_ms: None,
                    keystone_upgrades: Vec::new(),
                    encounters: Vec::new(),
                    blizzard_href: None,
                    image_url: None,
                    linked_code: None,
                    blizzard_api_data: None,
                },
                DungeonInfo {
                    id: 16,
                    name: "Tazavesh: Streets".to_string(),
                    description: None,
                    zone: Some("Mechagon".to_string()),
                    slug: None,
                    short_name: None,
                    wowhead_id: Some(244),
                    num_bosses: Some(5),
                    expansion: Some(9),
                    expansion_name: None,
                    map_id: None,
                    challenge_mode_id: None,
                    minimum_level: None,
                    keystone_timer_ms: None,
                    keystone_upgrades: Vec::new(),
                    encounters: Vec::new(),
                    blizzard_href: None,
                    image_url: None,
                    linked_code: None,
                    blizzard_api_data: None,
                },
                DungeonInfo {
                    id: 17,
                    name: "Tazavesh: So'leah".to_string(),
                    description: None,
                    zone: Some("Mechagon".to_string()),
                    slug: None,
                    short_name: None,
                    wowhead_id: Some(245),
                    num_bosses: Some(4),
                    expansion: Some(9),
                    expansion_name: None,
                    map_id: None,
                    challenge_mode_id: None,
                    minimum_level: None,
                    keystone_timer_ms: None,
                    keystone_upgrades: Vec::new(),
                    encounters: Vec::new(),
                    blizzard_href: None,
                    image_url: None,
                    linked_code: None,
                    blizzard_api_data: None,
                },
            ];
        }

        Ok(dungeons)
    }

    fn get_season_info(&self) -> Result<DungeonSeasonData, String> {
        let mut season = self
            .get_cached_season()
            .unwrap_or((1, "Unknown Season".to_string()));

        let affixes = if let Ok((live_affixes, live_season_name)) = self.fetch_raider_affixes() {
            if let Some(name) = live_season_name {
                season.1 = name;
            }
            live_affixes
        } else {
            self.get_current_affixes()?
        };
        let dungeons = self.get_rotation_dungeons()?;

        Ok(DungeonSeasonData {
            season_id: season.0,
            season_name: season.1,
            current_affixes: affixes,
            rotation_dungeons: dungeons,
        })
    }
}
