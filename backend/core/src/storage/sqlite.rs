use rusqlite::{params, Connection};
use std::sync::Mutex;

use super::{JobStorage, WarcraftLogsParseFilter, WarcraftLogsStoredParse};
use crate::models::{
    extract_result_summary, Job, JobStatus, JobSummary, SavedCharacterProfile, SavedRoute,
};

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
                options TEXT,
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
                created_at TEXT NOT NULL,
                pinned INTEGER NOT NULL DEFAULT 0
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
            );
            CREATE TABLE IF NOT EXISTS character_profiles (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                realm TEXT NOT NULL,
                region TEXT NOT NULL,
                class TEXT,
                spec TEXT,
                simc_input TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS wcl_characters (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                region TEXT NOT NULL,
                realm_slug TEXT NOT NULL,
                character_name TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(user_id, region, realm_slug, character_name)
            );
            CREATE TABLE IF NOT EXISTS wcl_reports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                character_id INTEGER NOT NULL,
                report_code TEXT NOT NULL,
                title TEXT,
                report_end_time INTEGER,
                zone_name TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(character_id, report_code),
                FOREIGN KEY(character_id) REFERENCES wcl_characters(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS wcl_parses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                character_id INTEGER NOT NULL,
                report_id INTEGER,
                mode TEXT NOT NULL,
                dedupe_key TEXT NOT NULL,
                expansion TEXT,
                season TEXT,
                raid_name TEXT,
                raid_group TEXT,
                zone_name TEXT NOT NULL,
                encounter_name TEXT NOT NULL,
                difficulty TEXT NOT NULL,
                percentile REAL,
                dps REAL,
                median_percentile REAL,
                attempts INTEGER,
                kills INTEGER,
                fastest_kill_seconds REAL,
                all_stars_points REAL,
                all_stars_rank INTEGER,
                start_time INTEGER,
                locked_in INTEGER,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(character_id, mode, dedupe_key),
                FOREIGN KEY(character_id) REFERENCES wcl_characters(id) ON DELETE CASCADE,
                FOREIGN KEY(report_id) REFERENCES wcl_reports(id) ON DELETE SET NULL
            );",
        )
        .expect("Failed to create tables");

        // Migrate: add columns if missing
        let _ = conn.execute_batch(
            "ALTER TABLE jobs ADD COLUMN html_report TEXT;
             ALTER TABLE jobs ADD COLUMN text_output TEXT;",
        );
        let _ = conn.execute_batch("ALTER TABLE jobs ADD COLUMN raw_json TEXT;");
        let _ = conn.execute_batch("ALTER TABLE jobs ADD COLUMN options TEXT;");
        let _ = conn.execute_batch("ALTER TABLE jobs ADD COLUMN batch_id TEXT;");
        let _ = conn.execute_batch("ALTER TABLE jobs ADD COLUMN linked_region TEXT;");
        let _ = conn.execute_batch("ALTER TABLE jobs ADD COLUMN linked_realm TEXT;");
        let _ = conn.execute_batch("ALTER TABLE jobs ADD COLUMN linked_name TEXT;");
        let _ = conn.execute_batch("ALTER TABLE jobs ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;");
        let _ = conn.execute_batch("ALTER TABLE dungeon_routes ADD COLUMN level INTEGER;");
        let _ = conn.execute_batch("ALTER TABLE dungeon_routes ADD COLUMN pull_count INTEGER;");
        let _ = conn.execute_batch("ALTER TABLE dungeon_routes ADD COLUMN timer_seconds INTEGER;");
        let _ = conn.execute_batch("ALTER TABLE dungeon_routes ADD COLUMN affixes TEXT;");
        let _ = conn.execute_batch("ALTER TABLE wcl_parses ADD COLUMN expansion TEXT;");
        let _ = conn.execute_batch("ALTER TABLE wcl_parses ADD COLUMN season TEXT;");
        let _ = conn.execute_batch("ALTER TABLE wcl_parses ADD COLUMN raid_name TEXT;");
        let _ = conn.execute_batch("ALTER TABLE wcl_parses ADD COLUMN raid_group TEXT;");

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
        let stages_str: String = row.get(11)?;
        let stages: Vec<String> = serde_json::from_str(&stages_str).unwrap_or_default();
        let options_json: Option<String> = row.get(4)?;
        let options = options_json.and_then(|s| serde_json::from_str(&s).ok());

        Ok(Job {
            id: row.get(0)?,
            status: SqliteStorage::str_to_status(&status_str),
            sim_type: row.get(2)?,
            simc_input: row.get(3)?,
            options,
            result_json: row.get(5)?,
            combo_metadata_json: row.get(6)?,
            error_message: row.get(7)?,
            progress_pct: row.get::<_, u8>(8)?,
            progress_stage: row.get(9)?,
            progress_detail: row.get(10)?,
            stages_completed: stages,
            iterations: row.get::<_, u32>(12)?,
            fight_style: row.get(13)?,
            target_error: row.get(14)?,
            created_at: row.get(15)?,
            raw_json: row.get(16).ok().flatten(),
            html_report: row.get(17).ok().flatten(),
            text_output: row.get(18).ok().flatten(),
            batch_id: row.get(19).ok().flatten(),
            linked_region: row.get(20).ok().flatten(),
            linked_realm: row.get(21).ok().flatten(),
            linked_name: row.get(22).ok().flatten(),
            pinned: row.get::<_, i64>(23).unwrap_or(0) != 0,
        })
    }
}

impl JobStorage for SqliteStorage {
    fn insert(&self, job: Job) {
        let conn = self.conn.lock().unwrap();
        let stages_json = serde_json::to_string(&job.stages_completed).unwrap();
        let options_json = job
            .options
            .as_ref()
            .map(|o| serde_json::to_string(o).unwrap());
        conn.execute(
            "INSERT INTO jobs (id, status, sim_type, simc_input, options, result_json, combo_metadata_json,
             error_message, progress_pct, progress_stage, progress_detail, stages_completed,
             iterations, fight_style, target_error, created_at, batch_id, raw_json, html_report, text_output, linked_region, linked_realm, linked_name, pinned)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24)",
            params![
                job.id,
                Self::status_to_str(&job.status),
                job.sim_type,
                job.simc_input,
                options_json,
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
                if job.pinned { 1 } else { 0 },
            ],
        )
        .expect("Failed to insert job");

        // Garbage collect oldest jobs beyond limit
        let limit = *self.max_jobs.lock().unwrap();
        conn.execute(
            "DELETE FROM jobs WHERE pinned = 0 AND id NOT IN (SELECT id FROM jobs WHERE pinned = 0 ORDER BY created_at DESC LIMIT ?1)",
            params![limit as u32],
        ).ok();
    }

    fn get(&self, id: &str) -> Option<Job> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT id, status, sim_type, simc_input, options, result_json, combo_metadata_json,
             error_message, progress_pct, progress_stage, progress_detail, stages_completed,
             iterations, fight_style, target_error, created_at, raw_json, html_report, text_output, batch_id, linked_region, linked_realm, linked_name, pinned
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
        pinned_only: bool,
    ) -> Vec<JobSummary> {
        let conn = self.conn.lock().unwrap();
        let fetch_limit = if player.is_some() || realm.is_some() {
            std::cmp::max(200, limit) as u32
        } else {
            limit as u32
        };
        let mut stmt = conn.prepare(
            "SELECT id, status, sim_type, created_at, fight_style, iterations, error_message, result_json, simc_input, batch_id,
             raw_json, html_report, text_output, combo_metadata_json, linked_region, linked_realm, linked_name, pinned
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
                let pinned = row.get::<_, i64>(17).unwrap_or(0) != 0;

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
                    pinned,
                })
            })
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        if player.is_none() && realm.is_none() && !unlinked_only && !pinned_only {
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
                if pinned_only && !j.pinned {
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
            "DELETE FROM jobs WHERE pinned = 0 AND id NOT IN (SELECT id FROM jobs WHERE pinned = 0 ORDER BY created_at DESC LIMIT ?1)",
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

    fn set_pinned(&self, id: &str, pinned: bool) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE jobs SET pinned = ?1 WHERE id = ?2",
            params![if pinned { 1 } else { 0 }, id],
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

    fn save_character_profile(&self, profile: SavedCharacterProfile) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO character_profiles (id, name, realm, region, class, spec, simc_input, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(id) DO UPDATE SET name = ?2, realm = ?3, region = ?4, class = ?5, spec = ?6, simc_input = ?7",
            params![
                profile.id,
                profile.name,
                profile.realm,
                profile.region,
                profile.class,
                profile.spec,
                profile.simc_input,
                profile.created_at,
            ],
        )
        .expect("Failed to save character profile");
    }

    fn list_character_profiles(
        &self,
        name: Option<&str>,
        realm: Option<&str>,
        region: Option<&str>,
    ) -> Vec<SavedCharacterProfile> {
        let conn = self.conn.lock().unwrap();
        let mut sql = "SELECT id, name, realm, region, class, spec, simc_input, created_at FROM character_profiles WHERE 1=1".to_string();
        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        if let Some(n) = name {
            sql.push_str(" AND LOWER(name) = LOWER(?)");
            params_vec.push(Box::new(n.to_string()));
        }
        if let Some(r) = realm {
            sql.push_str(" AND LOWER(realm) = LOWER(?)");
            params_vec.push(Box::new(r.to_string()));
        }
        if let Some(reg) = region {
            sql.push_str(" AND LOWER(region) = LOWER(?)");
            params_vec.push(Box::new(reg.to_string()));
        }
        sql.push_str(" ORDER BY created_at DESC");

        let mut stmt = conn.prepare(&sql).unwrap();
        let params_refs: Vec<&dyn rusqlite::ToSql> =
            params_vec.iter().map(|p| p.as_ref()).collect();
        stmt.query_map(params_refs.as_slice(), |row| {
            Ok(SavedCharacterProfile {
                id: row.get(0)?,
                name: row.get(1)?,
                realm: row.get(2)?,
                region: row.get(3)?,
                class: row.get(4)?,
                spec: row.get(5)?,
                simc_input: row.get(6)?,
                created_at: row.get(7)?,
            })
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect()
    }

    fn delete_character_profile(&self, id: &str) {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM character_profiles WHERE id = ?1", params![id])
            .ok();
    }

    fn upsert_wcl_parses(
        &self,
        user_id: &str,
        region: &str,
        realm: &str,
        name: &str,
        mode: &str,
        rows: &[WarcraftLogsStoredParse],
    ) {
        let now = chrono::Utc::now().to_rfc3339();
        let region_l = region.to_lowercase();
        let realm_l = realm.to_lowercase();
        let name_l = name.to_lowercase();
        let mode_l = mode.to_lowercase();
        let conn = self.conn.lock().unwrap();
        let tx = match conn.unchecked_transaction() {
            Ok(tx) => tx,
            Err(_) => return,
        };

        let _ = tx.execute(
            "INSERT INTO wcl_characters (user_id, region, realm_slug, character_name, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(user_id, region, realm_slug, character_name)
             DO UPDATE SET updated_at = excluded.updated_at",
            params![user_id, region_l, realm_l, name_l, now, now],
        );

        let character_id: i64 = match tx.query_row(
            "SELECT id FROM wcl_characters WHERE user_id = ?1 AND region = ?2 AND realm_slug = ?3 AND character_name = ?4",
            params![user_id, region_l, realm_l, name_l],
            |row| row.get(0),
        ) {
            Ok(id) => id,
            Err(_) => {
                let _ = tx.rollback();
                return;
            }
        };

        for row in rows {
            let mut report_id: Option<i64> = None;
            if let Some(report_code) = row.report_code.as_ref().filter(|s| !s.trim().is_empty()) {
                let _ = tx.execute(
                    "INSERT INTO wcl_reports (character_id, report_code, title, report_end_time, zone_name, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                     ON CONFLICT(character_id, report_code)
                     DO UPDATE SET title = COALESCE(excluded.title, wcl_reports.title),
                                   report_end_time = COALESCE(excluded.report_end_time, wcl_reports.report_end_time),
                                   zone_name = COALESCE(excluded.zone_name, wcl_reports.zone_name),
                                   updated_at = excluded.updated_at",
                    params![
                        character_id,
                        report_code,
                        row.report_title,
                        row.report_end_time,
                        row.zone_name,
                        now,
                        now
                    ],
                );
                report_id = tx
                    .query_row(
                        "SELECT id FROM wcl_reports WHERE character_id = ?1 AND report_code = ?2",
                        params![character_id, report_code],
                        |r| r.get(0),
                    )
                    .ok();
            }

            let _ = tx.execute(
                "INSERT INTO wcl_parses (
                    character_id, report_id, mode, dedupe_key, expansion, season, raid_name, raid_group,
                    zone_name, encounter_name, difficulty,
                    percentile, dps, median_percentile, attempts, kills, fastest_kill_seconds,
                    all_stars_points, all_stars_rank, start_time, locked_in, created_at, updated_at
                 ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
                    ?9, ?10, ?11, ?12, ?13, ?14, ?15,
                    ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23
                 )
                 ON CONFLICT(character_id, mode, dedupe_key) DO NOTHING",
                params![
                    character_id,
                    report_id,
                    mode_l,
                    row.dedupe_key,
                    row.expansion,
                    row.season,
                    row.raid_name,
                    row.raid_group,
                    row.zone_name,
                    row.encounter_name,
                    row.difficulty,
                    row.percentile,
                    row.dps,
                    row.median_percentile,
                    row.attempts,
                    row.kills,
                    row.fastest_kill_seconds,
                    row.all_stars_points,
                    row.all_stars_rank,
                    row.start_time,
                    row.locked_in.map(|b| if b { 1_i64 } else { 0_i64 }),
                    now,
                    now
                ],
            );
        }

        let _ = tx.commit();
    }

    fn get_wcl_parses(
        &self,
        user_id: &str,
        region: &str,
        realm: &str,
        name: &str,
        mode: &str,
    ) -> Vec<WarcraftLogsStoredParse> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = match conn.prepare(
            "SELECT
                p.mode, p.dedupe_key, p.expansion, p.season, p.raid_name, p.raid_group,
                p.zone_name, p.encounter_name, p.difficulty,
                p.percentile, p.dps, p.median_percentile, p.attempts, p.kills, p.fastest_kill_seconds,
                p.all_stars_points, p.all_stars_rank, r.report_code, r.title, r.report_end_time,
                p.start_time, p.locked_in
             FROM wcl_parses p
             JOIN wcl_characters c ON c.id = p.character_id
             LEFT JOIN wcl_reports r ON r.id = p.report_id
             WHERE c.user_id = ?1
               AND c.region = ?2
               AND c.realm_slug = ?3
               AND c.character_name = ?4
               AND p.mode = ?5
             ORDER BY p.start_time DESC, p.id DESC",
        ) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };

        stmt.query_map(
            params![
                user_id,
                region.to_lowercase(),
                realm.to_lowercase(),
                name.to_lowercase(),
                mode.to_lowercase()
            ],
            |row| {
                Ok(WarcraftLogsStoredParse {
                    mode: row.get(0)?,
                    dedupe_key: row.get(1)?,
                    expansion: row.get(2)?,
                    season: row.get(3)?,
                    raid_name: row.get(4)?,
                    raid_group: row.get(5)?,
                    zone_name: row.get(6)?,
                    encounter_name: row.get(7)?,
                    difficulty: row.get(8)?,
                    percentile: row.get(9)?,
                    dps: row.get(10)?,
                    median_percentile: row.get(11)?,
                    attempts: row.get(12)?,
                    kills: row.get(13)?,
                    fastest_kill_seconds: row.get(14)?,
                    all_stars_points: row.get(15)?,
                    all_stars_rank: row.get(16)?,
                    report_code: row.get(17)?,
                    report_title: row.get(18)?,
                    report_end_time: row.get(19)?,
                    start_time: row.get(20)?,
                    locked_in: row
                        .get::<_, Option<i64>>(21)?
                        .map(|v| v != 0),
                })
            },
        )
        .ok()
        .into_iter()
        .flat_map(|iter| iter.filter_map(|r| r.ok()))
        .collect()
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
