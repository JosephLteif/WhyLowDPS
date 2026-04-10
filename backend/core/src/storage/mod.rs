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

use crate::models::{Job, JobStatus, JobSummary};
use once_cell::sync::Lazy;

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
    // User configuration storage
    fn set_user_config(&self, user_id: &str, key: &str, value: &str);
    fn get_user_config(&self, user_id: &str, key: &str) -> Option<String>;
    fn remove_user_config(&self, user_id: &str, key: &str);
}
