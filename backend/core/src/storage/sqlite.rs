use rusqlite::{params, Connection};
use std::sync::Mutex;

use super::JobStorage;
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
        let _ =
            conn.execute_batch("ALTER TABLE jobs ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;");
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
        if *mj == limit {
            return;
        }
        *mj = limit;
        drop(mj);
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

}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Job, JobStatus};
    use crate::storage::JobStorage;
    use tempfile::TempDir;

    fn create_storage() -> (TempDir, SqliteStorage) {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("whylowdps-tests.db");
        let storage = SqliteStorage::new(path.to_string_lossy().as_ref());
        (dir, storage)
    }

    fn make_job(
        id: &str,
        created_at: &str,
        simc_input: &str,
        result_json: Option<&str>,
        pinned: bool,
    ) -> Job {
        Job {
            id: id.to_string(),
            status: JobStatus::Pending,
            sim_type: "quick".to_string(),
            simc_input: simc_input.to_string(),
            options: None,
            result_json: result_json.map(str::to_string),
            raw_json: None,
            combo_metadata_json: None,
            error_message: None,
            progress_pct: 0,
            progress_stage: None,
            progress_detail: None,
            stages_completed: Vec::new(),
            iterations: 2000,
            fight_style: "Patchwerk".to_string(),
            target_error: 0.1,
            created_at: created_at.to_string(),
            html_report: None,
            text_output: None,
            batch_id: None,
            linked_region: None,
            linked_realm: None,
            linked_name: None,
            pinned,
        }
    }

    #[test]
    fn sqlite_history_filters_support_linked_unlinked_and_pinned_views() {
        let (_dir, storage) = create_storage();
        storage.insert(make_job(
            "linked",
            "2026-02-03T00:00:00Z",
            "mage=\"Alice\"\nserver=illidan\n",
            Some(r#"{"player_name":"Alice","player_class":"Mage","dps":1234.0}"#),
            false,
        ));
        storage.insert(make_job(
            "unlinked",
            "2026-02-02T00:00:00Z",
            "warrior=\"Bob\"\nserver=stormrage\n",
            Some(r#"{"player_name":"Bob","player_class":"Warrior","dps":999.0}"#),
            false,
        ));
        storage.link_character(
            "linked",
            Some("us".to_string()),
            Some("illidan".to_string()),
            Some("Alice".to_string()),
        );
        storage.set_pinned("linked", true);

        let linked_only = storage.list_recent(10, Some("Alice"), Some("illidan"), true, false, false);
        assert_eq!(linked_only.len(), 1);
        assert_eq!(linked_only[0].id, "linked");
        assert_eq!(linked_only[0].linked_name.as_deref(), Some("Alice"));

        let unlinked_only = storage.list_recent(10, None, None, false, true, false);
        assert_eq!(unlinked_only.len(), 1);
        assert_eq!(unlinked_only[0].id, "unlinked");

        let pinned_only = storage.list_recent(10, None, None, false, false, true);
        assert_eq!(pinned_only.len(), 1);
        assert_eq!(pinned_only[0].id, "linked");
    }

    #[test]
    fn sqlite_retention_keeps_pinned_jobs_when_max_jobs_is_small() {
        let (_dir, storage) = create_storage();
        storage.set_max_jobs(1);

        storage.insert(make_job(
            "pinned",
            "2026-02-01T00:00:00Z",
            "mage=\"Pinned\"\nserver=illidan\n",
            None,
            true,
        ));
        storage.insert(make_job(
            "old-unpinned",
            "2026-02-02T00:00:00Z",
            "mage=\"Old\"\nserver=illidan\n",
            None,
            false,
        ));
        storage.insert(make_job(
            "new-unpinned",
            "2026-02-03T00:00:00Z",
            "mage=\"New\"\nserver=illidan\n",
            None,
            false,
        ));

        assert!(storage.get("pinned").is_some());
        assert!(storage.get("old-unpinned").is_none());
        assert!(storage.get("new-unpinned").is_some());
    }

    #[test]
    fn sqlite_job_state_updates_cover_progress_result_errors_and_reports() {
        let (_dir, storage) = create_storage();
        storage.insert(make_job(
            "job-1",
            "2026-02-01T00:00:00Z",
            "evoker=\"Scaler\"\nserver=tichondrius\n",
            None,
            false,
        ));

        storage.update_status("job-1", JobStatus::Running);
        storage.update_progress("job-1", 55, "simulating", "stage-2");
        storage.complete_stage("job-1", "parsed profile");
        storage.set_result(
            "job-1",
            r#"{"player_name":"Scaler","dps":7777.7}"#.to_string(),
            Some(r#"{"raw":"ok"}"#.to_string()),
        );
        storage.set_report_files(
            "job-1",
            Some("<html>report</html>".to_string()),
            Some("text output".to_string()),
        );

        let job = storage.get("job-1").expect("job should exist");
        assert_eq!(job.status, JobStatus::Done);
        assert_eq!(job.progress_pct, 55);
        assert_eq!(job.progress_stage.as_deref(), Some("simulating"));
        assert_eq!(job.stages_completed, vec!["parsed profile".to_string()]);
        assert_eq!(job.raw_json.as_deref(), Some(r#"{"raw":"ok"}"#));
        assert_eq!(job.html_report.as_deref(), Some("<html>report</html>"));
        assert_eq!(job.text_output.as_deref(), Some("text output"));

        storage.set_error("job-1", "sim crashed".to_string());
        let failed = storage.get("job-1").expect("job should exist");
        assert_eq!(failed.status, JobStatus::Failed);
        assert_eq!(failed.error_message.as_deref(), Some("sim crashed"));
    }

    #[test]
    fn sqlite_cache_and_user_config_round_trip_and_delete() {
        let (_dir, storage) = create_storage();
        storage.set_cache("api:foo", "cached".to_string());
        assert_eq!(storage.get_cache("api:foo").as_deref(), Some("cached"));
        storage.remove_cache("api:foo");
        assert!(storage.get_cache("api:foo").is_none());

        storage.set_user_config("u1", "discord_link_hidden", "true");
        assert_eq!(
            storage.get_user_config("u1", "discord_link_hidden").as_deref(),
            Some("true")
        );
        storage.remove_user_config("u1", "discord_link_hidden");
        assert!(storage.get_user_config("u1", "discord_link_hidden").is_none());
    }

    #[test]
    fn sqlite_routes_and_profiles_support_user_crud_filters_and_sorting() {
        let (_dir, storage) = create_storage();
        storage.save_route(SavedRoute {
            id: "r-old".to_string(),
            name: "Old Route".to_string(),
            dungeon: "Ara-Kara".to_string(),
            level: Some(10),
            pull_count: Some(12),
            timer_seconds: Some(1800),
            affixes: Some("Fortified".to_string()),
            route_data: "OLD".to_string(),
            created_at: "2026-01-01T00:00:00Z".to_string(),
        });
        storage.save_route(SavedRoute {
            id: "r-new".to_string(),
            name: "New Route".to_string(),
            dungeon: "Ara-Kara".to_string(),
            level: Some(12),
            pull_count: Some(14),
            timer_seconds: Some(1750),
            affixes: Some("Tyrannical".to_string()),
            route_data: "NEW".to_string(),
            created_at: "2026-01-02T00:00:00Z".to_string(),
        });

        let routes = storage.list_routes();
        assert_eq!(routes.len(), 2);
        assert_eq!(routes[0].id, "r-new");
        assert_eq!(routes[1].id, "r-old");
        storage.delete_route("r-old");
        assert_eq!(storage.list_routes().len(), 1);

        storage.save_character_profile(SavedCharacterProfile {
            id: "p1".to_string(),
            name: "MyMain".to_string(),
            realm: "Illidan".to_string(),
            region: "US".to_string(),
            class: Some("Mage".to_string()),
            spec: Some("Arcane".to_string()),
            simc_input: "mage=\"MyMain\"".to_string(),
            created_at: "2026-01-01T00:00:00Z".to_string(),
        });
        storage.save_character_profile(SavedCharacterProfile {
            id: "p2".to_string(),
            name: "Alt".to_string(),
            realm: "Stormrage".to_string(),
            region: "US".to_string(),
            class: Some("Priest".to_string()),
            spec: Some("Shadow".to_string()),
            simc_input: "priest=\"Alt\"".to_string(),
            created_at: "2026-01-02T00:00:00Z".to_string(),
        });

        let filtered = storage.list_character_profiles(Some("mymain"), Some("illidan"), Some("us"));
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].id, "p1");
        storage.delete_character_profile("p1");
        assert_eq!(storage.list_character_profiles(Some("mymain"), None, None).len(), 0);
    }
}
