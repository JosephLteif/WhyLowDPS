use std::sync::Mutex;

use tokio_postgres::{Client, NoTls};

use super::JobStorage;
use crate::models::{extract_result_summary, Job, JobStatus, JobSummary};

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
            );",
            )
            .await;

        // Migrate: add columns if missing
        let _ = client
            .batch_execute(
                "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS html_report TEXT;
             ALTER TABLE jobs ADD COLUMN IF NOT EXISTS text_output TEXT;
             ALTER TABLE jobs ADD COLUMN IF NOT EXISTS raw_json TEXT;
             ALTER TABLE jobs ADD COLUMN IF NOT EXISTS batch_id TEXT;
             ALTER TABLE jobs ADD COLUMN IF NOT EXISTS linked_region TEXT;
             ALTER TABLE jobs ADD COLUMN IF NOT EXISTS linked_realm TEXT;
             ALTER TABLE jobs ADD COLUMN IF NOT EXISTS linked_name TEXT;",
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
        let stages_str: String = row.get(10);
        let stages: Vec<String> = serde_json::from_str(&stages_str).unwrap_or_default();
        let progress_pct: i32 = row.get(7);
        let iterations: i32 = row.get(11);

        Job {
            id: row.get(0),
            status: Self::str_to_status(&status_str),
            sim_type: row.get(2),
            simc_input: row.get(3),
            result_json: row.get(4),
            combo_metadata_json: row.get(5),
            error_message: row.get(6),
            progress_pct: progress_pct as u8,
            progress_stage: row.get(8),
            progress_detail: row.get(9),
            stages_completed: stages,
            iterations: iterations as u32,
            fight_style: row.get(12),
            target_error: row.get(13),
            created_at: row.get(14),
            raw_json: row.get(15),
            html_report: row.get(16),
            text_output: row.get(17),
            batch_id: row.get(18),
            linked_region: row.get(19),
            linked_realm: row.get(20),
            linked_name: row.get(21),
        }
    }
}

impl JobStorage for PostgresStorage {
    fn insert(&self, job: Job) {
        let stages_json = serde_json::to_string(&job.stages_completed).unwrap();
        let limit = *self.max_jobs.lock().unwrap();
        self.blocking(|client| {
            self.rt.block_on(async {
                if let Err(e) = client.execute(
                    "INSERT INTO jobs (id, status, sim_type, simc_input, result_json, combo_metadata_json,
                     error_message, progress_pct, progress_stage, progress_detail, stages_completed,
                     iterations, fight_style, target_error, created_at, batch_id, raw_json, html_report, text_output, linked_region, linked_realm, linked_name)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)",
                    &[
                        &job.id,
                        &Self::status_to_str(&job.status),
                        &job.sim_type,
                        &job.simc_input,
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
                    ],
                ).await {
                    eprintln!("Failed to insert job: {}. DB may be down.", e);
                }

                // Garbage collect oldest jobs beyond limit
                let _ = client.execute(
                    "DELETE FROM jobs WHERE id NOT IN (SELECT id FROM jobs ORDER BY created_at DESC LIMIT $1)",
                    &[&(limit as i64)],
                ).await;
            });
        });
    }

    fn get(&self, id: &str) -> Option<Job> {
        self.blocking(|client| {
            self.rt.block_on(async {
                client.query_opt(
                    "SELECT id, status, sim_type, simc_input, result_json, combo_metadata_json,
                     error_message, progress_pct, progress_stage, progress_detail, stages_completed,
                     iterations, fight_style, target_error, created_at, raw_json, html_report, text_output, batch_id, linked_region, linked_realm, linked_name
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
                    "SELECT id, status, sim_type, created_at, fight_style, iterations, error_message, result_json, simc_input, batch_id, raw_json, html_report, text_output, combo_metadata_json, linked_region, linked_realm, linked_name
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
                    }
                }).collect();
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
                    "DELETE FROM jobs WHERE id NOT IN (SELECT id FROM jobs ORDER BY created_at DESC LIMIT $1)",
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
}
