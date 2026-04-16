use rusqlite::{params, Connection};
use std::sync::Mutex;

use super::JobStorage;
use crate::models::{extract_result_summary, Job, JobStatus, JobSummary, SavedRoute};

pub struct SqliteStorage {
    conn: Mutex<Connection>,
    max_jobs: Mutex<usize>,
}

impl SqliteStorage {
    pub fn new(path: &str) -> Self {
        let conn = Connection::open(path).expect("Failed to open SQLite database");
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY,
                status TEXT NOT NULL DEFAULT 'pending',
                sim_type TEXT NOT NULL,
                simc_input TEXT NOT NULL,
                result_json TEXT,
                combo_metadata_json TEXT,
                error_message TEXT,
                progress_pct INTEGER NOT NULL DEFAULT 0,
                progress_stage TEXT,
                progress_detail TEXT,
                stages_completed TEXT NOT NULL DEFAULT '[]',
                iterations INTEGER NOT NULL,
                fight_style TEXT NOT NULL,
                target_error REAL NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS app_cache (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS user_configs (
                user_id TEXT NOT NULL,
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                PRIMARY KEY (user_id, key)
            );
            CREATE TABLE IF NOT EXISTS dungeon_routes (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                dungeon TEXT NOT NULL,
                level INTEGER,
                pull_count INTEGER,
                timer_seconds INTEGER,
                affixes TEXT,
                route_data TEXT NOT NULL,
                created_at TEXT NOT NULL
            );",
        )
        .expect("Failed to create tables");

        // Migrate: add columns if missing
        let _ = conn.execute_batch(
            "ALTER TABLE jobs ADD COLUMN html_report TEXT;
             ALTER TABLE jobs ADD COLUMN text_output TEXT;",
        );
        let _ = conn.execute_batch("ALTER TABLE jobs ADD COLUMN raw_json TEXT;");
        let _ = conn.execute_batch("ALTER TABLE jobs ADD COLUMN batch_id TEXT;");
        let _ = conn.execute_batch("ALTER TABLE jobs ADD COLUMN linked_region TEXT;");
        let _ = conn.execute_batch("ALTER TABLE jobs ADD COLUMN linked_realm TEXT;");
        let _ = conn.execute_batch("ALTER TABLE jobs ADD COLUMN linked_name TEXT;");
        let _ = conn.execute_batch("ALTER TABLE dungeon_routes ADD COLUMN level INTEGER;");
        let _ = conn.execute_batch("ALTER TABLE dungeon_routes ADD COLUMN pull_count INTEGER;");
        let _ = conn.execute_batch("ALTER TABLE dungeon_routes ADD COLUMN timer_seconds INTEGER;");
        let _ = conn.execute_batch("ALTER TABLE dungeon_routes ADD COLUMN affixes TEXT;");

        let max_jobs = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'max_jobs'",
                [],
                |row| {
                    let s: String = row.get(0)?;
                    Ok(s.parse::<usize>().unwrap_or(*super::MAX_JOBS))
                },
            )
            .unwrap_or(*super::MAX_JOBS);

        Self {
            conn: Mutex::new(conn),
            max_jobs: Mutex::new(max_jobs),
        }
    }

    fn status_to_str(status: &JobStatus) -> &'static str {
        match status {
            JobStatus::Pending => "pending",
            JobStatus::Running => "running",
            JobStatus::Done => "done",
            JobStatus::Failed => "failed",
            JobStatus::Cancelled => "cancelled",
        }
    }

    fn str_to_status(s: &str) -> JobStatus {
        match s {
            "running" => JobStatus::Running,
            "done" => JobStatus::Done,
            "failed" => JobStatus::Failed,
            "cancelled" => JobStatus::Cancelled,
            _ => JobStatus::Pending,
        }
    }

    fn row_to_job(row: &rusqlite::Row) -> rusqlite::Result<Job> {
        let status_str: String = row.get(1)?;
        let stages_str: String = row.get(10)?;
        let stages: Vec<String> = serde_json::from_str(&stages_str).unwrap_or_default();

        Ok(Job {
            id: row.get(0)?,
            status: SqliteStorage::str_to_status(&status_str),
            sim_type: row.get(2)?,
            simc_input: row.get(3)?,
            result_json: row.get(4)?,
            combo_metadata_json: row.get(5)?,
            error_message: row.get(6)?,
            progress_pct: row.get::<_, u8>(7)?,
            progress_stage: row.get(8)?,
            progress_detail: row.get(9)?,
            stages_completed: stages,
            iterations: row.get::<_, u32>(11)?,
            fight_style: row.get(12)?,
            target_error: row.get(13)?,
            created_at: row.get(14)?,
            raw_json: row.get(15).ok().flatten(),
            html_report: row.get(16).ok().flatten(),
            text_output: row.get(17).ok().flatten(),
            batch_id: row.get(18).ok().flatten(),
            linked_region: row.get(19).ok().flatten(),
            linked_realm: row.get(20).ok().flatten(),
            linked_name: row.get(21).ok().flatten(),
        })
    }
}

impl JobStorage for SqliteStorage {
    fn insert(&self, job: Job) {
        let conn = self.conn.lock().unwrap();
        let stages_json = serde_json::to_string(&job.stages_completed).unwrap();
        conn.execute(
            "INSERT INTO jobs (id, status, sim_type, simc_input, result_json, combo_metadata_json,
             error_message, progress_pct, progress_stage, progress_detail, stages_completed,
             iterations, fight_style, target_error, created_at, batch_id, raw_json, html_report, text_output, linked_region, linked_realm, linked_name)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)",
            params![
                job.id,
                Self::status_to_str(&job.status),
                job.sim_type,
                job.simc_input,
                job.result_json,
                job.combo_metadata_json,
                job.error_message,
                job.progress_pct,
                job.progress_stage,
                job.progress_detail,
                stages_json,
                job.iterations,
                job.fight_style,
                job.target_error,
                job.created_at,
                job.batch_id,
                job.raw_json,
                job.html_report,
                job.text_output,
                job.linked_region,
                job.linked_realm,
                job.linked_name,
            ],
        )
        .expect("Failed to insert job");

        // Garbage collect oldest jobs beyond limit
        let limit = *self.max_jobs.lock().unwrap();
        conn.execute(
            "DELETE FROM jobs WHERE id NOT IN (SELECT id FROM jobs ORDER BY created_at DESC LIMIT ?1)",
            params![limit as u32],
        ).ok();
    }

    fn get(&self, id: &str) -> Option<Job> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT id, status, sim_type, simc_input, result_json, combo_metadata_json,
             error_message, progress_pct, progress_stage, progress_detail, stages_completed,
             iterations, fight_style, target_error, created_at, raw_json, html_report, text_output, batch_id, linked_region, linked_realm, linked_name
             FROM jobs WHERE id = ?1",
            params![id],
            Self::row_to_job,
        )
        .ok()
    }

    fn list_recent(
        &self,
        limit: usize,
        player: Option<&str>,
        realm: Option<&str>,
        linked_only: bool,
        unlinked_only: bool,
    ) -> Vec<JobSummary> {
        let conn = self.conn.lock().unwrap();
        let fetch_limit = if player.is_some() || realm.is_some() {
            std::cmp::max(200, limit) as u32
        } else {
            limit as u32
        };
        let mut stmt = conn.prepare(
            "SELECT id, status, sim_type, created_at, fight_style, iterations, error_message, result_json, simc_input, batch_id,
             raw_json, html_report, text_output, combo_metadata_json, linked_region, linked_realm, linked_name
             FROM jobs ORDER BY created_at DESC LIMIT ?1"
        ).unwrap();
        let all: Vec<JobSummary> = stmt
            .query_map(params![fetch_limit], |row| {
                let status_str: String = row.get(1)?;
                let result_json: Option<String> = row.get(7)?;
                let simc_input: String = row.get::<_, String>(8).unwrap_or_default();
                let s = extract_result_summary(&result_json, &simc_input);

                let mut size_bytes = simc_input.len() as u64;
                size_bytes += result_json.as_ref().map(|s| s.len()).unwrap_or(0) as u64;
                size_bytes += row
                    .get::<_, Option<String>>(10)?
                    .as_ref()
                    .map(|s| s.len())
                    .unwrap_or(0) as u64;
                size_bytes += row
                    .get::<_, Option<String>>(11)?
                    .as_ref()
                    .map(|s| s.len())
                    .unwrap_or(0) as u64;
                size_bytes += row
                    .get::<_, Option<String>>(12)?
                    .as_ref()
                    .map(|s| s.len())
                    .unwrap_or(0) as u64;
                size_bytes += row
                    .get::<_, Option<String>>(13)?
                    .as_ref()
                    .map(|s| s.len())
                    .unwrap_or(0) as u64;

                let linked_region: Option<String> = row.get(14).ok().flatten();
                let linked_realm: Option<String> = row.get(15).ok().flatten();
                let linked_name: Option<String> = row.get(16).ok().flatten();

                Ok(JobSummary {
                    id: row.get(0)?,
                    status: Self::str_to_status(&status_str),
                    sim_type: row.get(2)?,
                    created_at: row.get(3)?,
                    fight_style: row.get(4)?,
                    iterations: row.get::<_, u32>(5)?,
                    error_message: row.get(6)?,
                    player_name: linked_name.clone().or_else(|| s.player_name.clone()),
                    player_class: s.player_class,
                    realm: linked_realm.clone().or_else(|| s.realm.clone()),
                    dps: s.dps,
                    batch_id: row.get(9).ok().flatten(),
                    size_bytes,
                    upgrades: s.upgrades,
                    downgrades: s.downgrades,
                    linked_region,
                    linked_realm,
                    linked_name,
                })
            })
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        if player.is_none() && realm.is_none() && !unlinked_only {
            return all;
        }
        all.into_iter()
            .filter(|j| {
                if unlinked_only
                    && (j.linked_name.is_some()
                        || j.linked_realm.is_some()
                        || j.linked_region.is_some())
                {
                    return false;
                }

                if linked_only {
                    if let Some(p) = player {
                        if j.linked_name.as_deref() != Some(p) {
                            return false;
                        }
                    }
                    if let Some(r) = realm {
                        if j.linked_realm.as_deref() != Some(r) {
                            return false;
                        }
                    }
                } else {
                    if let Some(p) = player {
                        if j.player_name.as_deref() != Some(p) {
                            return false;
                        }
                    }
                    if let Some(r) = realm {
                        if j.realm.as_deref() != Some(r) {
                            return false;
                        }
                    }
                }
                true
            })
            .take(limit)
            .collect()
    }

    fn update_status(&self, id: &str, status: JobStatus) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE jobs SET status = ?1 WHERE id = ?2",
            params![Self::status_to_str(&status), id],
        )
        .ok();
    }

    fn update_progress(&self, id: &str, pct: u8, stage: &str, detail: &str) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE jobs SET progress_pct = ?1, progress_stage = ?2, progress_detail = ?3 WHERE id = ?4",
            params![pct, stage, detail, id],
        ).ok();
    }

    fn complete_stage(&self, id: &str, summary: &str) {
        let conn = self.conn.lock().unwrap();
        let current: Option<String> = conn
            .query_row(
                "SELECT stages_completed FROM jobs WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .ok();

        if let Some(stages_str) = current {
            let mut stages: Vec<String> = serde_json::from_str(&stages_str).unwrap_or_default();
            stages.push(summary.to_string());
            let updated = serde_json::to_string(&stages).unwrap();
            conn.execute(
                "UPDATE jobs SET stages_completed = ?1 WHERE id = ?2",
                params![updated, id],
            )
            .ok();
        }
    }

    fn set_result(&self, id: &str, result: String, raw_json: Option<String>) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE jobs SET result_json = ?1, raw_json = ?2, status = 'done' WHERE id = ?3",
            params![result, raw_json, id],
        )
        .ok();
    }

    fn set_error(&self, id: &str, error: String) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE jobs SET error_message = ?1, status = 'failed' WHERE id = ?2",
            params![error, id],
        )
        .ok();
    }

    fn set_report_files(&self, id: &str, html: Option<String>, text: Option<String>) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE jobs SET html_report = ?1, text_output = ?2 WHERE id = ?3",
            params![html, text, id],
        )
        .ok();
    }

    fn count_batch(&self, batch_id: &str) -> usize {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT COUNT(*) FROM jobs WHERE batch_id = ?1",
            params![batch_id],
            |row| row.get::<_, usize>(0),
        )
        .unwrap_or(0)
    }

    fn delete(&self, id: &str) {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM jobs WHERE id = ?1", params![id])
            .ok();
    }

    fn get_storage_size(&self) -> u64 {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT SUM(
                LENGTH(CAST(simc_input AS BLOB)) +
                IFNULL(LENGTH(CAST(result_json AS BLOB)), 0) +
                IFNULL(LENGTH(CAST(raw_json AS BLOB)), 0) +
                IFNULL(LENGTH(CAST(html_report AS BLOB)), 0) +
                IFNULL(LENGTH(CAST(text_output AS BLOB)), 0) +
                IFNULL(LENGTH(CAST(combo_metadata_json AS BLOB)), 0)
            ) FROM jobs",
            [],
            |row| {
                row.get::<_, Option<f64>>(0)
                    .map(|v| v.unwrap_or(0.0) as u64)
            },
        )
        .unwrap_or(0)
    }

    fn clear_history(&self) {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM jobs", []).ok();
        conn.execute("VACUUM", []).ok();
    }

    fn get_max_jobs(&self) -> usize {
        *self.max_jobs.lock().unwrap()
    }

    fn set_max_jobs(&self, limit: usize) {
        let mut mj = self.max_jobs.lock().unwrap();
        *mj = limit;
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('max_jobs', ?1)
             ON CONFLICT(key) DO UPDATE SET value = ?1",
            params![limit.to_string()],
        )
        .ok();

        conn.execute(
            "DELETE FROM jobs WHERE id NOT IN (SELECT id FROM jobs ORDER BY created_at DESC LIMIT ?1)",
            params![limit as u32],
        )
        .ok();
    }

    fn set_cache(&self, key: &str, value: String) {
        let conn = self.conn.lock().unwrap();
        let updated_at = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO app_cache (key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = ?3",
            params![key, value, updated_at],
        )
        .ok();
    }

    fn get_cache(&self, key: &str) -> Option<String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT value FROM app_cache WHERE key = ?1",
            params![key],
            |row| row.get::<_, String>(0),
        )
        .ok()
    }

    fn remove_cache(&self, key: &str) {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM app_cache WHERE key = ?1", params![key])
            .ok();
    }

    fn link_character(
        &self,
        id: &str,
        region: Option<String>,
        realm: Option<String>,
        name: Option<String>,
    ) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE jobs SET linked_region = ?1, linked_realm = ?2, linked_name = ?3 WHERE id = ?4",
            params![region, realm, name, id],
        )
        .ok();
    }

    fn set_user_config(&self, user_id: &str, key: &str, value: &str) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO user_configs (user_id, key, value) VALUES (?1, ?2, ?3)
             ON CONFLICT(user_id, key) DO UPDATE SET value = ?3",
            params![user_id, key, value],
        )
        .ok();
    }

    fn get_user_config(&self, user_id: &str, key: &str) -> Option<String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT value FROM user_configs WHERE user_id = ?1 AND key = ?2",
            params![user_id, key],
            |row| row.get::<_, String>(0),
        )
        .ok()
    }

    fn remove_user_config(&self, user_id: &str, key: &str) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM user_configs WHERE user_id = ?1 AND key = ?2",
            params![user_id, key],
        )
        .ok();
    }

    fn save_route(&self, route: SavedRoute) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO dungeon_routes (id, name, dungeon, level, pull_count, timer_seconds, affixes, route_data, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(id) DO UPDATE SET name = ?2, dungeon = ?3, level = ?4, pull_count = ?5, timer_seconds = ?6, affixes = ?7, route_data = ?8",
            params![
                route.id,
                route.name,
                route.dungeon,
                route.level,
                route.pull_count,
                route.timer_seconds,
                route.affixes,
                route.route_data,
                route.created_at,
            ],
        )
        .expect("Failed to save route");
    }

    fn list_routes(&self) -> Vec<SavedRoute> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT id, name, dungeon, level, pull_count, timer_seconds, affixes, route_data, created_at FROM dungeon_routes ORDER BY created_at DESC")
            .unwrap();
        stmt.query_map([], |row| {
            Ok(SavedRoute {
                id: row.get(0)?,
                name: row.get(1)?,
                dungeon: row.get(2)?,
                level: row.get(3)?,
                pull_count: row.get(4)?,
                timer_seconds: row.get(5)?,
                affixes: row.get(6)?,
                route_data: row.get(7)?,
                created_at: row.get(8)?,
            })
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect()
    }

    fn delete_route(&self, id: &str) {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM dungeon_routes WHERE id = ?1", params![id])
            .ok();
    }
}
