use std::sync::Mutex;

use tokio_postgres::{Client, NoTls};

use super::{JobStorage, WarcraftLogsParseFilter, WarcraftLogsStoredParse};
use crate::models::{
    extract_result_summary, Job, JobStatus, JobSummary, SavedCharacterProfile, SavedRoute,
};

pub struct PostgresStorage {
    client: Mutex<Client>,
    rt: tokio::runtime::Runtime,
    max_jobs: Mutex<usize>,
}

impl PostgresStorage {
    /// Connect to PostgreSQL and create the jobs table if needed.
    pub async fn new(url: &str) -> Self {
        let (client, connection) = tokio_postgres::connect(url, NoTls)
            .await
            .expect("Failed to connect to PostgreSQL");

        let rt = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .expect("Failed to create Tokio runtime for PostgresStorage");

        rt.spawn(async move {
            if let Err(e) = connection.await {
                eprintln!("PostgreSQL connection error: {}", e);
            }
        });

        // Smoke test to ensure connection is live
        if let Err(e) = client.query("SELECT 1", &[]).await {
            eprintln!(
                "PostgreSQL smoke test failed: {}. Storage may be unavailable.",
                e
            );
        }

        let _ = client
            .batch_execute(
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
                target_error DOUBLE PRECISION NOT NULL,
                created_at TEXT NOT NULL,
                pinned BOOLEAN NOT NULL DEFAULT FALSE
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
                id BIGSERIAL PRIMARY KEY,
                user_id TEXT NOT NULL,
                region TEXT NOT NULL,
                realm_slug TEXT NOT NULL,
                character_name TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(user_id, region, realm_slug, character_name)
            );
            CREATE TABLE IF NOT EXISTS wcl_reports (
                id BIGSERIAL PRIMARY KEY,
                character_id BIGINT NOT NULL REFERENCES wcl_characters(id) ON DELETE CASCADE,
                report_code TEXT NOT NULL,
                title TEXT,
                report_end_time BIGINT,
                zone_name TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(character_id, report_code)
            );
            CREATE TABLE IF NOT EXISTS wcl_parses (
                id BIGSERIAL PRIMARY KEY,
                character_id BIGINT NOT NULL REFERENCES wcl_characters(id) ON DELETE CASCADE,
                report_id BIGINT REFERENCES wcl_reports(id) ON DELETE SET NULL,
                mode TEXT NOT NULL,
                dedupe_key TEXT NOT NULL,
                expansion TEXT,
                season TEXT,
                raid_name TEXT,
                raid_group TEXT,
                zone_name TEXT NOT NULL,
                encounter_name TEXT NOT NULL,
                difficulty TEXT NOT NULL,
                percentile DOUBLE PRECISION,
                dps DOUBLE PRECISION,
                median_percentile DOUBLE PRECISION,
                attempts BIGINT,
                kills BIGINT,
                fastest_kill_seconds DOUBLE PRECISION,
                all_stars_points DOUBLE PRECISION,
                all_stars_rank BIGINT,
                start_time BIGINT,
                locked_in BOOLEAN,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(character_id, mode, dedupe_key)
            );",
            )
            .await;

        // Migrate: add columns if missing
        let _ = client
            .batch_execute(
                "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS html_report TEXT;
             ALTER TABLE jobs ADD COLUMN IF NOT EXISTS text_output TEXT;
             ALTER TABLE jobs ADD COLUMN IF NOT EXISTS options TEXT;
             ALTER TABLE jobs ADD COLUMN IF NOT EXISTS raw_json TEXT;
             ALTER TABLE jobs ADD COLUMN IF NOT EXISTS batch_id TEXT;
             ALTER TABLE jobs ADD COLUMN IF NOT EXISTS linked_region TEXT;
             ALTER TABLE jobs ADD COLUMN IF NOT EXISTS linked_realm TEXT;
             ALTER TABLE jobs ADD COLUMN IF NOT EXISTS linked_name TEXT;
             ALTER TABLE jobs ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE;
             ALTER TABLE wcl_parses ADD COLUMN IF NOT EXISTS expansion TEXT;
             ALTER TABLE wcl_parses ADD COLUMN IF NOT EXISTS season TEXT;
             ALTER TABLE wcl_parses ADD COLUMN IF NOT EXISTS raid_name TEXT;
             ALTER TABLE wcl_parses ADD COLUMN IF NOT EXISTS raid_group TEXT;",
            )
            .await;

        let max_jobs = client
            .query_opt("SELECT value FROM settings WHERE key = 'max_jobs'", &[])
            .await
            .unwrap_or(None)
            .and_then(|row| {
                let s: String = row.get(0);
                s.parse::<usize>().ok()
            })
            .unwrap_or(*super::MAX_JOBS);

        Self {
            client: Mutex::new(client),
            rt,
            max_jobs: Mutex::new(max_jobs),
        }
    }

    /// Run a closure with the DB client on a fresh OS thread,
    /// avoiding Tokio's "cannot block within a runtime" restriction.
    /// Handles panics in the closure gracefully.
    fn blocking<F, T>(&self, f: F) -> Option<T>
    where
        F: FnOnce(&Client) -> T + Send,
        T: Send,
    {
        let client = self.client.lock().ok()?;
        std::thread::scope(|s| s.spawn(|| f(&client)).join().ok())
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

    fn row_to_job(row: &tokio_postgres::Row) -> Job {
        let status_str: String = row.get(1);
        let stages_str: String = row.get(11);
        let stages: Vec<String> = serde_json::from_str(&stages_str).unwrap_or_default();
        let progress_pct: i32 = row.get(8);
        let iterations: i32 = row.get(12);
        let options_json: Option<String> = row.get(4);
        let options = options_json.and_then(|s| serde_json::from_str(&s).ok());

        Job {
            id: row.get(0),
            status: Self::str_to_status(&status_str),
            sim_type: row.get(2),
            simc_input: row.get(3),
            options,
            result_json: row.get(5),
            combo_metadata_json: row.get(6),
            error_message: row.get(7),
            progress_pct: progress_pct as u8,
            progress_stage: row.get(9),
            progress_detail: row.get(10),
            stages_completed: stages,
            iterations: iterations as u32,
            fight_style: row.get(13),
            target_error: row.get(14),
            created_at: row.get(15),
            raw_json: row.get(16),
            html_report: row.get(17),
            text_output: row.get(18),
            batch_id: row.get(19),
            linked_region: row.get(20),
            linked_realm: row.get(21),
            linked_name: row.get(22),
            pinned: row.get(23),
        }
    }
}

impl JobStorage for PostgresStorage {
    fn insert(&self, job: Job) {
        let stages_json = serde_json::to_string(&job.stages_completed).unwrap();
        let options_json = job
            .options
            .as_ref()
            .map(|o| serde_json::to_string(o).unwrap());
        let limit = *self.max_jobs.lock().unwrap();
        self.blocking(|client| {
            self.rt.block_on(async {
                if let Err(e) = client.execute(
                    "INSERT INTO jobs (id, status, sim_type, simc_input, options, result_json, combo_metadata_json,
                     error_message, progress_pct, progress_stage, progress_detail, stages_completed,
                     iterations, fight_style, target_error, created_at, batch_id, raw_json, html_report, text_output, linked_region, linked_realm, linked_name, pinned)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)",
                    &[
                        &job.id,
                        &Self::status_to_str(&job.status),
                        &job.sim_type,
                        &job.simc_input,
                        &options_json,
                        &job.result_json,
                        &job.combo_metadata_json,
                        &job.error_message,
                        &(job.progress_pct as i32),
                        &job.progress_stage,
                        &job.progress_detail,
                        &stages_json,
                        &(job.iterations as i32),
                        &job.fight_style,
                        &job.target_error,
                        &job.created_at,
                        &job.batch_id,
                        &job.raw_json,
                        &job.html_report,
                        &job.text_output,
                        &job.linked_region,
                        &job.linked_realm,
                        &job.linked_name,
                        &job.pinned,
                    ],
                ).await {
                    eprintln!("Failed to insert job: {}. DB may be down.", e);
                }

                // Garbage collect oldest jobs beyond limit
                let _ = client.execute(
                    "DELETE FROM jobs WHERE pinned = FALSE AND id NOT IN (SELECT id FROM jobs WHERE pinned = FALSE ORDER BY created_at DESC LIMIT $1)",
                    &[&(limit as i64)],
                ).await;
            });
        });
    }

    fn get(&self, id: &str) -> Option<Job> {
        self.blocking(|client| {
            self.rt.block_on(async {
                client.query_opt(
                    "SELECT id, status, sim_type, simc_input, options, result_json, combo_metadata_json,
                     error_message, progress_pct, progress_stage, progress_detail, stages_completed,
                     iterations, fight_style, target_error, created_at, raw_json, html_report, text_output, batch_id, linked_region, linked_realm, linked_name, pinned
                     FROM jobs WHERE id = $1",

                    &[&id],
                ).await.ok().flatten().map(|row| Self::row_to_job(&row))
            })
        }).flatten()
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
        let player = player.map(String::from);
        let realm = realm.map(String::from);
        self.blocking(|client| {
            self.rt.block_on(async {
                let fetch_limit = if player.is_some() || realm.is_some() {
                    std::cmp::max(200, limit as i64)
                } else {
                    limit as i64
                };
                let rows = client.query(
                    "SELECT id, status, sim_type, created_at, fight_style, iterations, error_message, result_json, simc_input, batch_id, raw_json, html_report, text_output, combo_metadata_json, linked_region, linked_realm, linked_name, pinned
                     FROM jobs ORDER BY created_at DESC LIMIT $1",
                    &[&fetch_limit],
                ).await.unwrap_or_default();
                let all: Vec<JobSummary> = rows.iter().map(|row| {
                    let status_str: String = row.get(1);
                    let iterations: i32 = row.get(5);
                    let result_json: Option<String> = row.get(7);
                    let simc_input: String = row.get::<_, Option<String>>(8).unwrap_or_default();
                    let s = extract_result_summary(&result_json, &simc_input);

                    let mut size_bytes = simc_input.len() as u64;
                    size_bytes += result_json.as_ref().map(|s| s.len()).unwrap_or(0) as u64;
                    size_bytes += row.get::<_, Option<String>>(10).as_ref().map(|s| s.len()).unwrap_or(0) as u64; // raw_json
                    size_bytes += row.get::<_, Option<String>>(11).as_ref().map(|s| s.len()).unwrap_or(0) as u64; // html_report
                    size_bytes += row.get::<_, Option<String>>(12).as_ref().map(|s| s.len()).unwrap_or(0) as u64; // text_output
                    size_bytes += row.get::<_, Option<String>>(13).as_ref().map(|s| s.len()).unwrap_or(0) as u64; // combo_metadata_json

                    let linked_region: Option<String> = row.get(14);
                    let linked_realm: Option<String> = row.get(15);
                    let linked_name: Option<String> = row.get(16);
                    let pinned: bool = row.get(17);

                    JobSummary {
                        id: row.get(0),
                        status: Self::str_to_status(&status_str),
                        sim_type: row.get(2),
                        created_at: row.get(3),
                        fight_style: row.get(4),
                        iterations: iterations as u32,
                        error_message: row.get(6),
                        player_name: linked_name.clone().or_else(|| s.player_name.clone()),
                        player_class: s.player_class,
                        realm: linked_realm.clone().or_else(|| s.realm.clone()),
                        dps: s.dps,
                        batch_id: row.get(9),
                        size_bytes,
                        upgrades: s.upgrades,
                        downgrades: s.downgrades,
                        linked_region,
                        linked_realm,
                        linked_name,
                        pinned,
                    }
                }).collect();
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
                            if let Some(ref p) = player {
                                if j.linked_name.as_deref() != Some(p) { return false; }
                            }
                            if let Some(ref r) = realm {
                                if j.linked_realm.as_deref() != Some(r) { return false; }
                            }
                        } else {
                            if let Some(ref p) = player {
                                if j.player_name.as_deref() != Some(p) { return false; }
                            }
                            if let Some(ref r) = realm {
                                if j.realm.as_deref() != Some(r) { return false; }
                            }
                        }
                        true
                    })
                    .take(limit)
                    .collect()
            })
        }).unwrap_or_default()
    }

    fn update_status(&self, id: &str, status: JobStatus) {
        self.blocking(|client| {
            self.rt.block_on(async {
                client
                    .execute(
                        "UPDATE jobs SET status = $1 WHERE id = $2",
                        &[&Self::status_to_str(&status), &id],
                    )
                    .await
                    .ok();
            });
        });
    }

    fn update_progress(&self, id: &str, pct: u8, stage: &str, detail: &str) {
        self.blocking(|client| {
            self.rt.block_on(async {
                client.execute(
                    "UPDATE jobs SET progress_pct = $1, progress_stage = $2, progress_detail = $3 WHERE id = $4",
                    &[&(pct as i32), &stage, &detail, &id],
                ).await.ok();
            });
        });
    }

    fn complete_stage(&self, id: &str, summary: &str) {
        self.blocking(|client| {
            self.rt.block_on(async {
                let row = client
                    .query_opt("SELECT stages_completed FROM jobs WHERE id = $1", &[&id])
                    .await
                    .ok()
                    .flatten();

                if let Some(row) = row {
                    let stages_str: String = row.get(0);
                    let mut stages: Vec<String> =
                        serde_json::from_str(&stages_str).unwrap_or_default();
                    stages.push(summary.to_string());
                    let updated = serde_json::to_string(&stages).unwrap();
                    client
                        .execute(
                            "UPDATE jobs SET stages_completed = $1 WHERE id = $2",
                            &[&updated, &id],
                        )
                        .await
                        .ok();
                }
            });
        });
    }

    fn set_result(&self, id: &str, result: String, raw_json: Option<String>) {
        self.blocking(|client| {
            self.rt.block_on(async {
                client.execute(
                    "UPDATE jobs SET result_json = $1, raw_json = $2, status = 'done' WHERE id = $3",
                    &[&result, &raw_json, &id],
                ).await.ok();
            });
        });
    }

    fn set_error(&self, id: &str, error: String) {
        self.blocking(|client| {
            self.rt.block_on(async {
                client
                    .execute(
                        "UPDATE jobs SET error_message = $1, status = 'failed' WHERE id = $2",
                        &[&error, &id],
                    )
                    .await
                    .ok();
            });
        });
    }

    fn set_report_files(&self, id: &str, html: Option<String>, text: Option<String>) {
        self.blocking(|client| {
            self.rt.block_on(async {
                client
                    .execute(
                        "UPDATE jobs SET html_report = $1, text_output = $2 WHERE id = $3",
                        &[&html, &text, &id],
                    )
                    .await
                    .ok();
            });
        });
    }

    fn count_batch(&self, batch_id: &str) -> usize {
        let bid = batch_id.to_string();
        self.blocking(|client| {
            self.rt.block_on(async {
                client
                    .query_one(
                        "SELECT COUNT(*)::BIGINT FROM jobs WHERE batch_id = $1",
                        &[&bid],
                    )
                    .await
                    .map(|row| row.get::<_, i64>(0) as usize)
                    .unwrap_or(0)
            })
        })
        .unwrap_or(0)
    }

    fn delete(&self, id: &str) {
        self.blocking(|client| {
            self.rt.block_on(async {
                client
                    .execute("DELETE FROM jobs WHERE id = $1", &[&id])
                    .await
                    .ok();
            });
        });
    }

    fn get_storage_size(&self) -> u64 {
        self.blocking(|client| {
            self.rt.block_on(async {
                client
                    .query_one(
                        "SELECT SUM(
                        LENGTH(simc_input) +
                        COALESCE(LENGTH(result_json), 0) +
                        COALESCE(LENGTH(raw_json), 0) +
                        COALESCE(LENGTH(html_report), 0) +
                        COALESCE(LENGTH(text_output), 0) +
                        COALESCE(LENGTH(combo_metadata_json), 0)
                    )::BIGINT FROM jobs",
                        &[],
                    )
                    .await
                    .map(|row| {
                        let v: Option<i64> = row.get(0);
                        v.unwrap_or(0) as u64
                    })
                    .unwrap_or(0)
            })
        })
        .unwrap_or(0)
    }

    fn clear_history(&self) {
        self.blocking(|client| {
            self.rt.block_on(async {
                client.execute("DELETE FROM jobs", &[]).await.ok();
            });
        });
    }

    fn get_max_jobs(&self) -> usize {
        self.max_jobs.lock().map(|l| *l).unwrap_or(*super::MAX_JOBS)
    }

    fn set_max_jobs(&self, limit: usize) {
        if let Ok(mut mj) = self.max_jobs.lock() {
            *mj = limit;
        }
        self.blocking(|client| {
            self.rt.block_on(async {
                client.execute(
                    "INSERT INTO settings (key, value) VALUES ('max_jobs', $1)
                     ON CONFLICT (key) DO UPDATE SET value = $1",
                    &[&limit.to_string()],
                ).await.ok();

                client.execute(
                    "DELETE FROM jobs WHERE pinned = FALSE AND id NOT IN (SELECT id FROM jobs WHERE pinned = FALSE ORDER BY created_at DESC LIMIT $1)",
                    &[&(limit as i64)],
                ).await.ok();
            });
        });
    }

    fn set_cache(&self, key: &str, value: String) {
        let updated_at = chrono::Utc::now().to_rfc3339();
        self.blocking(|client| {
            self.rt.block_on(async {
                client
                    .execute(
                        "INSERT INTO app_cache (key, value, updated_at) VALUES ($1, $2, $3)
                     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = $3",
                        &[&key.to_string(), &value, &updated_at],
                    )
                    .await
                    .ok();
            });
        });
    }

    fn get_cache(&self, key: &str) -> Option<String> {
        self.blocking(|client| {
            self.rt.block_on(async {
                client
                    .query_opt(
                        "SELECT value FROM app_cache WHERE key = $1",
                        &[&key.to_string()],
                    )
                    .await
                    .ok()
                    .flatten()
                    .map(|row| row.get(0))
            })
        })
        .flatten()
    }

    fn remove_cache(&self, key: &str) {
        let key = key.to_string();
        self.blocking(|client| {
            self.rt.block_on(async {
                client
                    .execute("DELETE FROM app_cache WHERE key = $1", &[&key])
                    .await
                    .ok();
            });
        });
    }

    fn link_character(
        &self,
        id: &str,
        region: Option<String>,
        realm: Option<String>,
        name: Option<String>,
    ) {
        self.blocking(|client| {
            self.rt.block_on(async {
                client.execute(
                    "UPDATE jobs SET linked_region = $1, linked_realm = $2, linked_name = $3 WHERE id = $4",
                    &[&region, &realm, &name, &id],
                ).await.ok();
            });
        });
    }

    fn set_pinned(&self, id: &str, pinned: bool) {
        self.blocking(|client| {
            self.rt.block_on(async {
                client
                    .execute("UPDATE jobs SET pinned = $1 WHERE id = $2", &[&pinned, &id])
                    .await
                    .ok();
            });
        });
    }

    fn set_user_config(&self, user_id: &str, key: &str, value: &str) {
        let (user_id, key, value) = (user_id.to_string(), key.to_string(), value.to_string());
        self.blocking(|client| {
            self.rt.block_on(async {
                client
                    .execute(
                        "INSERT INTO user_configs (user_id, key, value) VALUES ($1, $2, $3)
                     ON CONFLICT (user_id, key) DO UPDATE SET value = $3",
                        &[&user_id, &key, &value],
                    )
                    .await
                    .ok();
            });
        });
    }

    fn get_user_config(&self, user_id: &str, key: &str) -> Option<String> {
        let (user_id, key) = (user_id.to_string(), key.to_string());
        self.blocking(|client| {
            self.rt.block_on(async {
                client
                    .query_opt(
                        "SELECT value FROM user_configs WHERE user_id = $1 AND key = $2",
                        &[&user_id, &key],
                    )
                    .await
                    .ok()
                    .flatten()
                    .map(|row| row.get(0))
            })
        })
        .flatten()
    }

    fn remove_user_config(&self, user_id: &str, key: &str) {
        let (user_id, key) = (user_id.to_string(), key.to_string());
        self.blocking(|client| {
            self.rt.block_on(async {
                client
                    .execute(
                        "DELETE FROM user_configs WHERE user_id = $1 AND key = $2",
                        &[&user_id, &key],
                    )
                    .await
                    .ok();
            });
        });
    }

    fn save_route(&self, route: SavedRoute) {
        self.blocking(|client| {
            self.rt.block_on(async {
                client.execute(
                    "INSERT INTO dungeon_routes (id, name, dungeon, level, pull_count, timer_seconds, affixes, route_data, created_at)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                     ON CONFLICT (id) DO UPDATE SET name = $2, dungeon = $3, level = $4, pull_count = $5, timer_seconds = $6, affixes = $7, route_data = $8",
                    &[
                        &route.id,
                        &route.name,
                        &route.dungeon,
                        &route.level,
                        &route.pull_count,
                        &route.timer_seconds,
                        &route.affixes,
                        &route.route_data,
                        &route.created_at,
                    ],
                ).await.ok();
            });
        });
    }

    fn list_routes(&self) -> Vec<SavedRoute> {
        self.blocking(|client| {
            self.rt.block_on(async {
                client
                    .query(
                        "SELECT id, name, dungeon, level, pull_count, timer_seconds, affixes, route_data, created_at FROM dungeon_routes ORDER BY created_at DESC",
                        &[],
                    )
                    .await
                    .ok()
                    .unwrap_or_default()
                    .into_iter()
                    .map(|row| SavedRoute {
                        id: row.get(0),
                        name: row.get(1),
                        dungeon: row.get(2),
                        level: row.get(3),
                        pull_count: row.get(4),
                        timer_seconds: row.get(5),
                        affixes: row.get(6),
                        route_data: row.get(7),
                        created_at: row.get(8),
                    })
                    .collect()
            })
        })
        .unwrap_or_default()
    }

    fn delete_route(&self, id: &str) {
        let id = id.to_string();
        self.blocking(|client| {
            self.rt.block_on(async {
                client
                    .execute("DELETE FROM dungeon_routes WHERE id = $1", &[&id])
                    .await
                    .ok();
            });
        });
    }

    fn save_character_profile(&self, profile: SavedCharacterProfile) {
        self.blocking(|client| {
            self.rt.block_on(async {
                client.execute(
                    "INSERT INTO character_profiles (id, name, realm, region, class, spec, simc_input, created_at)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                     ON CONFLICT (id) DO UPDATE SET name = $2, realm = $3, region = $4, class = $5, spec = $6, simc_input = $7",
                    &[
                        &profile.id,
                        &profile.name,
                        &profile.realm,
                        &profile.region,
                        &profile.class,
                        &profile.spec,
                        &profile.simc_input,
                        &profile.created_at,
                    ],
                ).await.ok();
            });
        });
    }

    fn list_character_profiles(
        &self,
        name: Option<&str>,
        realm: Option<&str>,
        region: Option<&str>,
    ) -> Vec<SavedCharacterProfile> {
        // Build query dynamically - use simpler approach without complex params
        let query_name = name.map(|n| n.to_lowercase());
        let query_realm = realm.map(|r| r.to_lowercase());
        let query_region = region.map(|r| r.to_lowercase());

        self.blocking(|client| {
            self.rt.block_on(async {
                let mut results = Vec::new();
                let rows = client
                    .query(
                        "SELECT id, name, realm, region, class, spec, simc_input, created_at FROM character_profiles ORDER BY created_at DESC",
                        &[],
                    )
                    .await
                    .ok()
                    .unwrap_or_default();

                for row in rows {
                    let n: String = row.get(1);
                    let r: String = row.get(2);
                    let reg: String = row.get(3);

                    let matches = (query_name.is_none() || query_name.as_ref() == Some(&n.to_lowercase()))
                        && (query_realm.is_none() || query_realm.as_ref() == Some(&r.to_lowercase()))
                        && (query_region.is_none() || query_region.as_ref() == Some(&reg.to_lowercase()));

                    if matches {
                        results.push(SavedCharacterProfile {
                            id: row.get(0),
                            name: n,
                            realm: r,
                            region: reg,
                            class: row.get(4),
                            spec: row.get(5),
                            simc_input: row.get(6),
                            created_at: row.get(7),
                        });
                    }
                }
                results
            })
        })
        .unwrap_or_default()
    }

    fn delete_character_profile(&self, id: &str) {
        let id = id.to_string();
        self.blocking(|client| {
            self.rt.block_on(async {
                client
                    .execute("DELETE FROM character_profiles WHERE id = $1", &[&id])
                    .await
                    .ok();
            });
        });
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
        let (user_id, region, realm, name, mode) = (
            user_id.to_string(),
            region.to_lowercase(),
            realm.to_lowercase(),
            name.to_lowercase(),
            mode.to_lowercase(),
        );
        let rows = rows.to_vec();
        self.blocking(|client| {
            self.rt.block_on(async {
                let now = chrono::Utc::now().to_rfc3339();
                let _ = client
                    .execute(
                        "INSERT INTO wcl_characters (user_id, region, realm_slug, character_name, created_at, updated_at)
                         VALUES ($1, $2, $3, $4, $5, $6)
                         ON CONFLICT (user_id, region, realm_slug, character_name)
                         DO UPDATE SET updated_at = EXCLUDED.updated_at",
                        &[&user_id, &region, &realm, &name, &now, &now],
                    )
                    .await;
                let character_id: i64 = match client
                    .query_opt(
                        "SELECT id FROM wcl_characters WHERE user_id=$1 AND region=$2 AND realm_slug=$3 AND character_name=$4",
                        &[&user_id, &region, &realm, &name],
                    )
                    .await
                    .ok()
                    .flatten()
                    .map(|r| r.get(0))
                {
                    Some(id) => id,
                    None => return,
                };

                for row in rows {
                    let mut report_id: Option<i64> = None;
                    if let Some(report_code) = row.report_code.as_ref().filter(|s| !s.trim().is_empty()) {
                        let _ = client.execute(
                            "INSERT INTO wcl_reports (character_id, report_code, title, report_end_time, zone_name, created_at, updated_at)
                             VALUES ($1,$2,$3,$4,$5,$6,$7)
                             ON CONFLICT(character_id, report_code)
                             DO UPDATE SET title = COALESCE(EXCLUDED.title, wcl_reports.title),
                                           report_end_time = COALESCE(EXCLUDED.report_end_time, wcl_reports.report_end_time),
                                           zone_name = COALESCE(EXCLUDED.zone_name, wcl_reports.zone_name),
                                           updated_at = EXCLUDED.updated_at",
                            &[&character_id, report_code, &row.report_title, &row.report_end_time, &row.zone_name, &now, &now],
                        ).await;
                        report_id = client
                            .query_opt(
                                "SELECT id FROM wcl_reports WHERE character_id=$1 AND report_code=$2",
                                &[&character_id, report_code],
                            )
                            .await
                            .ok()
                            .flatten()
                            .map(|r| r.get(0));
                    }

                    let _ = client.execute(
                        "INSERT INTO wcl_parses (
                            character_id, report_id, mode, dedupe_key, expansion, season, raid_name, raid_group,
                            zone_name, encounter_name, difficulty,
                            percentile, dps, median_percentile, attempts, kills, fastest_kill_seconds,
                            all_stars_points, all_stars_rank, start_time, locked_in, created_at, updated_at
                         ) VALUES (
                            $1,$2,$3,$4,$5,$6,$7,$8,
                            $9,$10,$11,$12,$13,$14,$15,
                            $16,$17,$18,$19,$20,$21,$22,$23
                         )
                         ON CONFLICT(character_id, mode, dedupe_key) DO NOTHING",
                        &[
                            &character_id,
                            &report_id,
                            &mode,
                            &row.dedupe_key,
                            &row.expansion,
                            &row.season,
                            &row.raid_name,
                            &row.raid_group,
                            &row.zone_name,
                            &row.encounter_name,
                            &row.difficulty,
                            &row.percentile,
                            &row.dps,
                            &row.median_percentile,
                            &row.attempts,
                            &row.kills,
                            &row.fastest_kill_seconds,
                            &row.all_stars_points,
                            &row.all_stars_rank,
                            &row.start_time,
                            &row.locked_in,
                            &now,
                            &now,
                        ],
                    ).await;
                }
            });
        });
    }

    fn get_wcl_parses(
        &self,
        user_id: &str,
        region: &str,
        realm: &str,
        name: &str,
        mode: &str,
    ) -> Vec<WarcraftLogsStoredParse> {
        let (user_id, region, realm, name, mode) = (
            user_id.to_string(),
            region.to_lowercase(),
            realm.to_lowercase(),
            name.to_lowercase(),
            mode.to_lowercase(),
        );
        self.blocking(|client| {
            self.rt.block_on(async {
                let rows = client
                    .query(
                        "SELECT
                            p.mode, p.dedupe_key, p.expansion, p.season, p.raid_name, p.raid_group,
                            p.zone_name, p.encounter_name, p.difficulty,
                            p.percentile, p.dps, p.median_percentile, p.attempts, p.kills, p.fastest_kill_seconds,
                            p.all_stars_points, p.all_stars_rank, r.report_code, r.title, r.report_end_time,
                            p.start_time, p.locked_in
                         FROM wcl_parses p
                         JOIN wcl_characters c ON c.id = p.character_id
                         LEFT JOIN wcl_reports r ON r.id = p.report_id
                         WHERE c.user_id = $1 AND c.region = $2 AND c.realm_slug = $3 AND c.character_name = $4 AND p.mode = $5
                         ORDER BY p.start_time DESC NULLS LAST, p.id DESC",
                        &[&user_id, &region, &realm, &name, &mode],
                    )
                    .await
                    .unwrap_or_default();
                rows.into_iter()
                    .map(|row| WarcraftLogsStoredParse {
                        mode: row.get(0),
                        dedupe_key: row.get(1),
                        expansion: row.get(2),
                        season: row.get(3),
                        raid_name: row.get(4),
                        raid_group: row.get(5),
                        zone_name: row.get(6),
                        encounter_name: row.get(7),
                        difficulty: row.get(8),
                        percentile: row.get(9),
                        dps: row.get(10),
                        median_percentile: row.get(11),
                        attempts: row.get(12),
                        kills: row.get(13),
                        fastest_kill_seconds: row.get(14),
                        all_stars_points: row.get(15),
                        all_stars_rank: row.get(16),
                        report_code: row.get(17),
                        report_title: row.get(18),
                        report_end_time: row.get(19),
                        start_time: row.get(20),
                        locked_in: row.get(21),
                    })
                    .collect()
            })
        }).unwrap_or_default()
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
