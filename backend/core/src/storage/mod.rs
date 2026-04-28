pub mod memory;
#[cfg(feature = "postgres")]
pub mod postgres;
#[cfg(feature = "web")]
pub mod sqlite;

pub use memory::MemoryStorage;
#[cfg(feature = "postgres")]
pub use postgres::PostgresStorage;
#[cfg(feature = "web")]
pub use sqlite::SqliteStorage;

use crate::models::{Job, JobStatus, JobSummary, SavedCharacterProfile, SavedRoute};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WarcraftLogsStoredParse {
    pub mode: String,
    pub dedupe_key: String,
    pub expansion: Option<String>,
    pub season: Option<String>,
    pub raid_name: Option<String>,
    pub raid_group: Option<String>,
    pub zone_name: String,
    pub encounter_name: String,
    pub difficulty: String,
    pub percentile: Option<f64>,
    pub dps: Option<f64>,
    pub median_percentile: Option<f64>,
    pub attempts: Option<i64>,
    pub kills: Option<i64>,
    pub fastest_kill_seconds: Option<f64>,
    pub all_stars_points: Option<f64>,
    pub all_stars_rank: Option<i64>,
    pub report_code: Option<String>,
    pub report_title: Option<String>,
    pub report_end_time: Option<i64>,
    pub start_time: Option<i64>,
    pub locked_in: Option<bool>,
}

#[derive(Debug, Clone, Default)]
pub struct WarcraftLogsParseFilter {
    pub expansion: Option<String>,
    pub season: Option<String>,
    pub raid_name: Option<String>,
    pub raid_group: Option<String>,
}

/// Maximum number of jobs to retain. Oldest jobs are deleted on insert.
/// Override with MAX_JOBS env var. Defaults: desktop=50, web=200.
pub static MAX_JOBS: Lazy<usize> = Lazy::new(|| {
    if let Ok(val) = std::env::var("MAX_JOBS") {
        if let Ok(n) = val.parse() {
            return n;
        }
    }
    if cfg!(feature = "desktop") {
        50
    } else {
        200
    }
});

/// Maximum scenarios per batch. Set to 0 to disable batch submissions.
/// Override with MAX_SCENARIOS env var. Default: 10.
pub static MAX_SCENARIOS: Lazy<usize> = Lazy::new(|| {
    if let Ok(val) = std::env::var("MAX_SCENARIOS") {
        if let Ok(n) = val.parse() {
            return n;
        }
    }
    10
});

/// Trait for job persistence — implemented by in-memory store (desktop) and SQLite (web).
pub trait JobStorage: Send + Sync {
    fn insert(&self, job: Job);
    fn get(&self, id: &str) -> Option<Job>;
    fn list_recent(
        &self,
        limit: usize,
        player: Option<&str>,
        realm: Option<&str>,
        linked_only: bool,
        unlinked_only: bool,
        pinned_only: bool,
    ) -> Vec<JobSummary>;
    fn update_status(&self, id: &str, status: JobStatus);
    fn update_progress(&self, id: &str, pct: u8, stage: &str, detail: &str);
    fn complete_stage(&self, id: &str, summary: &str);
    fn set_result(&self, id: &str, result: String, raw_json: Option<String>);
    fn set_error(&self, id: &str, error: String);
    fn set_report_files(&self, id: &str, html: Option<String>, text: Option<String>);
    fn count_batch(&self, batch_id: &str) -> usize;
    fn delete(&self, id: &str);
    fn get_storage_size(&self) -> u64;
    fn clear_history(&self);
    fn get_max_jobs(&self) -> usize;
    fn set_max_jobs(&self, limit: usize);
    // Cache methods for app-level storage (e.g. blizzard API proxy)
    fn set_cache(&self, key: &str, value: String);
    fn get_cache(&self, key: &str) -> Option<String>;
    fn remove_cache(&self, key: &str);
    // Explicit linking
    fn link_character(
        &self,
        id: &str,
        region: Option<String>,
        realm: Option<String>,
        name: Option<String>,
    );
    fn set_pinned(&self, id: &str, pinned: bool);
    // User configuration storage
    fn set_user_config(&self, user_id: &str, key: &str, value: &str);
    fn get_user_config(&self, user_id: &str, key: &str) -> Option<String>;
    fn remove_user_config(&self, user_id: &str, key: &str);

    // Dungeon routes
    fn save_route(&self, route: SavedRoute);
    fn list_routes(&self) -> Vec<SavedRoute>;
    fn delete_route(&self, id: &str);

    // Character profiles
    fn save_character_profile(&self, profile: SavedCharacterProfile);
    fn list_character_profiles(
        &self,
        name: Option<&str>,
        realm: Option<&str>,
        region: Option<&str>,
    ) -> Vec<SavedCharacterProfile>;
    fn delete_character_profile(&self, id: &str);

    // Warcraft Logs durable parse storage
    fn upsert_wcl_parses(
        &self,
        _user_id: &str,
        _region: &str,
        _realm: &str,
        _name: &str,
        _mode: &str,
        _rows: &[WarcraftLogsStoredParse],
    ) {
    }
    fn get_wcl_parses(
        &self,
        _user_id: &str,
        _region: &str,
        _realm: &str,
        _name: &str,
        _mode: &str,
    ) -> Vec<WarcraftLogsStoredParse> {
        Vec::new()
    }
    fn get_wcl_parses_filtered(
        &self,
        user_id: &str,
        region: &str,
        realm: &str,
        name: &str,
        mode: &str,
        filter: &WarcraftLogsParseFilter,
    ) -> Vec<WarcraftLogsStoredParse> {
        let mut rows = self.get_wcl_parses(user_id, region, realm, name, mode);
        if let Some(expansion) = filter.expansion.as_ref() {
            rows.retain(|r| r.expansion.as_ref() == Some(expansion));
        }
        if let Some(season) = filter.season.as_ref() {
            rows.retain(|r| r.season.as_ref() == Some(season));
        }
        if let Some(raid_name) = filter.raid_name.as_ref() {
            rows.retain(|r| r.raid_name.as_ref() == Some(raid_name));
        }
        if let Some(raid_group) = filter.raid_group.as_ref() {
            rows.retain(|r| r.raid_group.as_ref() == Some(raid_group));
        }
        rows
    }
}
