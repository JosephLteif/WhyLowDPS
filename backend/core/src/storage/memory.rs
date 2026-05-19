use std::collections::HashMap;
use std::sync::Mutex;

use super::JobStorage;
use crate::models::{
    extract_result_summary, Job, JobStatus, JobSummary, SavedCharacterProfile, SavedRoute,
};

pub struct MemoryStorage {
    jobs: Mutex<HashMap<String, Job>>,
    max_jobs: Mutex<usize>,
    cache: Mutex<HashMap<String, String>>,
    user_configs: Mutex<HashMap<(String, String), String>>,
    routes: Mutex<HashMap<String, SavedRoute>>,
    character_profiles: Mutex<HashMap<String, SavedCharacterProfile>>,
}

impl Default for MemoryStorage {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryStorage {
    pub fn new() -> Self {
        Self {
            jobs: Mutex::new(HashMap::new()),
            max_jobs: Mutex::new(*super::MAX_JOBS),
            cache: Mutex::new(HashMap::new()),
            user_configs: Mutex::new(HashMap::new()),
            routes: Mutex::new(HashMap::new()),
            character_profiles: Mutex::new(HashMap::new()),
        }
    }
}

impl JobStorage for MemoryStorage {
    fn insert(&self, job: Job) {
        let mut jobs = self.jobs.lock().unwrap();
        jobs.insert(job.id.clone(), job);
        let limit = *self.max_jobs.lock().unwrap();
        if jobs.len() > limit {
            let mut entries: Vec<(String, String)> = jobs
                .iter()
                .filter(|(_, j)| !j.pinned)
                .map(|(id, j)| (id.clone(), j.created_at.clone()))
                .collect();
            entries.sort_by(|a, b| a.1.cmp(&b.1));
            let unpinned_count = entries.len();
            let to_remove = unpinned_count.saturating_sub(limit);
            for (id, _) in entries.into_iter().take(to_remove) {
                jobs.remove(&id);
            }
        }
    }

    fn get(&self, id: &str) -> Option<Job> {
        self.jobs.lock().unwrap().get(id).cloned()
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
        let jobs = self.jobs.lock().unwrap();
        let mut entries: Vec<&Job> = jobs.values().collect();
        entries.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        let mut results: Vec<JobSummary> = Vec::new();
        for j in entries {
            if results.len() >= limit {
                break;
            }
            let s = extract_result_summary(&j.result_json, &j.simc_input);
            let linked_region = j.linked_region.clone();
            let linked_realm = j.linked_realm.clone();
            let linked_name = j.linked_name.clone();

            let player_name = linked_name.clone().or_else(|| s.player_name.clone());
            let current_realm = linked_realm.clone().or_else(|| s.realm.clone());

            if unlinked_only
                && (linked_name.is_some() || linked_realm.is_some() || linked_region.is_some())
            {
                continue;
            }
            if pinned_only && !j.pinned {
                continue;
            }

            if linked_only {
                if let Some(p) = player {
                    if linked_name.as_deref() != Some(p) {
                        continue;
                    }
                }
                if let Some(r) = realm {
                    if linked_realm.as_deref() != Some(r) {
                        continue;
                    }
                }
            } else {
                if let Some(p) = player {
                    if player_name.as_deref() != Some(p) {
                        continue;
                    }
                }
                if let Some(r) = realm {
                    if current_realm.as_deref() != Some(r) {
                        continue;
                    }
                }
            }

            results.push(JobSummary {
                id: j.id.clone(),
                status: j.status.clone(),
                sim_type: j.sim_type.clone(),
                created_at: j.created_at.clone(),
                fight_style: j.fight_style.clone(),
                iterations: j.iterations,
                error_message: j.error_message.clone(),
                player_name,
                player_class: s.player_class,
                realm: current_realm,
                dps: s.dps,
                batch_id: j.batch_id.clone(),
                size_bytes: j.estimate_size(),
                upgrades: s.upgrades,
                downgrades: s.downgrades,
                linked_region,
                linked_realm,
                linked_name,
                pinned: j.pinned,
            });
        }
        results
    }

    fn update_status(&self, id: &str, status: JobStatus) {
        if let Some(job) = self.jobs.lock().unwrap().get_mut(id) {
            job.status = status;
        }
    }

    fn update_progress(&self, id: &str, pct: u8, stage: &str, detail: &str) {
        if let Some(job) = self.jobs.lock().unwrap().get_mut(id) {
            job.progress_pct = pct;
            job.progress_stage = Some(stage.to_string());
            job.progress_detail = Some(detail.to_string());
        }
    }

    fn complete_stage(&self, id: &str, summary: &str) {
        if let Some(job) = self.jobs.lock().unwrap().get_mut(id) {
            job.stages_completed.push(summary.to_string());
        }
    }

    fn set_result(&self, id: &str, result: String, raw_json: Option<String>) {
        if let Some(job) = self.jobs.lock().unwrap().get_mut(id) {
            job.result_json = Some(result);
            job.raw_json = raw_json;
            job.status = JobStatus::Done;
        }
    }

    fn set_error(&self, id: &str, error: String) {
        if let Some(job) = self.jobs.lock().unwrap().get_mut(id) {
            job.error_message = Some(error);
            job.status = JobStatus::Failed;
        }
    }

    fn set_report_files(&self, id: &str, html: Option<String>, text: Option<String>) {
        if let Some(job) = self.jobs.lock().unwrap().get_mut(id) {
            job.html_report = html;
            job.text_output = text;
        }
    }

    fn count_batch(&self, batch_id: &str) -> usize {
        self.jobs
            .lock()
            .unwrap()
            .values()
            .filter(|j| j.batch_id.as_deref() == Some(batch_id))
            .count()
    }

    fn delete(&self, id: &str) {
        self.jobs.lock().unwrap().remove(id);
    }

    fn get_storage_size(&self) -> u64 {
        let jobs = self.jobs.lock().unwrap();
        jobs.values().map(|j| j.estimate_size()).sum()
    }

    fn clear_history(&self) {
        self.jobs.lock().unwrap().clear();
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

        let mut jobs = self.jobs.lock().unwrap();
        if jobs.len() > limit {
            let mut entries: Vec<(String, String)> = jobs
                .iter()
                .filter(|(_, j)| !j.pinned)
                .map(|(id, j)| (id.clone(), j.created_at.clone()))
                .collect();
            entries.sort_by(|a, b| a.1.cmp(&b.1));
            let unpinned_count = entries.len();
            let to_remove = unpinned_count.saturating_sub(limit);
            for (id, _) in entries.into_iter().take(to_remove) {
                jobs.remove(&id);
            }
        }
    }

    fn set_cache(&self, key: &str, value: String) {
        let mut cache = self.cache.lock().unwrap();
        cache.insert(key.to_string(), value);
    }

    fn get_cache(&self, key: &str) -> Option<String> {
        let cache = self.cache.lock().unwrap();
        cache.get(key).cloned()
    }

    fn remove_cache(&self, key: &str) {
        let mut cache = self.cache.lock().unwrap();
        cache.remove(key);
    }

    fn link_character(
        &self,
        id: &str,
        region: Option<String>,
        realm: Option<String>,
        name: Option<String>,
    ) {
        if let Some(job) = self.jobs.lock().unwrap().get_mut(id) {
            job.linked_region = region;
            job.linked_realm = realm;
            job.linked_name = name;
        }
    }

    fn set_pinned(&self, id: &str, pinned: bool) {
        if let Some(job) = self.jobs.lock().unwrap().get_mut(id) {
            job.pinned = pinned;
        }
    }

    fn set_user_config(&self, user_id: &str, key: &str, value: &str) {
        let mut configs = self.user_configs.lock().unwrap();
        configs.insert((user_id.to_string(), key.to_string()), value.to_string());
    }

    fn get_user_config(&self, user_id: &str, key: &str) -> Option<String> {
        let configs = self.user_configs.lock().unwrap();
        configs
            .get(&(user_id.to_string(), key.to_string()))
            .cloned()
    }

    fn remove_user_config(&self, user_id: &str, key: &str) {
        let mut configs = self.user_configs.lock().unwrap();
        configs.remove(&(user_id.to_string(), key.to_string()));
    }

    fn save_route(&self, route: SavedRoute) {
        let mut routes = self.routes.lock().unwrap();
        routes.insert(route.id.clone(), route);
    }

    fn list_routes(&self) -> Vec<SavedRoute> {
        let routes = self.routes.lock().unwrap();
        let mut results: Vec<SavedRoute> = routes.values().cloned().collect();
        results.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        results
    }

    fn delete_route(&self, id: &str) {
        let mut routes = self.routes.lock().unwrap();
        routes.remove(id);
    }

    fn save_character_profile(&self, profile: SavedCharacterProfile) {
        let mut profiles = self.character_profiles.lock().unwrap();
        profiles.insert(profile.id.clone(), profile);
    }

    fn list_character_profiles(
        &self,
        name: Option<&str>,
        realm: Option<&str>,
        region: Option<&str>,
    ) -> Vec<SavedCharacterProfile> {
        let profiles = self.character_profiles.lock().unwrap();
        profiles
            .values()
            .filter(|p| {
                if let Some(n) = name {
                    if p.name.to_lowercase() != n.to_lowercase() {
                        return false;
                    }
                }
                if let Some(r) = realm {
                    if p.realm.to_lowercase() != r.to_lowercase() {
                        return false;
                    }
                }
                if let Some(reg) = region {
                    if p.region.to_lowercase() != reg.to_lowercase() {
                        return false;
                    }
                }
                true
            })
            .cloned()
            .collect()
    }

    fn delete_character_profile(&self, id: &str) {
        let mut profiles = self.character_profiles.lock().unwrap();
        profiles.remove(id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Job, JobStatus, SavedCharacterProfile, SavedRoute};
    use crate::storage::JobStorage;

    fn make_job(
        id: &str,
        created_at: &str,
        simc_input: &str,
        result_json: Option<&str>,
        pinned: bool,
        linked: Option<(&str, &str, &str)>,
    ) -> Job {
        let (linked_region, linked_realm, linked_name) = match linked {
            Some((region, realm, name)) => (
                Some(region.to_string()),
                Some(realm.to_string()),
                Some(name.to_string()),
            ),
            None => (None, None, None),
        };

        Job {
            id: id.to_string(),
            status: JobStatus::Done,
            sim_type: "quick".to_string(),
            simc_input: simc_input.to_string(),
            options: None,
            result_json: result_json.map(str::to_string),
            raw_json: None,
            combo_metadata_json: None,
            error_message: None,
            progress_pct: 100,
            progress_stage: None,
            progress_detail: None,
            stages_completed: Vec::new(),
            iterations: 10000,
            fight_style: "Patchwerk".to_string(),
            target_error: 0.1,
            created_at: created_at.to_string(),
            html_report: None,
            text_output: None,
            batch_id: None,
            linked_region,
            linked_realm,
            linked_name,
            pinned,
        }
    }

    #[test]
    fn user_can_filter_history_for_linked_and_unlinked_character_views() {
        let storage = MemoryStorage::new();
        let linked_result = r#"{"player_name":"Alice","player_class":"Mage","dps":154321.0}"#;
        let unlinked_result = r#"{"player_name":"Bob","player_class":"Warrior","dps":123456.0}"#;

        storage.insert(make_job(
            "job-linked",
            "2026-01-03T00:00:00Z",
            "mage=\"Alice\"\nserver=illidan\n",
            Some(linked_result),
            false,
            Some(("us", "illidan", "Alice")),
        ));
        storage.insert(make_job(
            "job-unlinked",
            "2026-01-02T00:00:00Z",
            "warrior=\"Bob\"\nserver=stormrage\n",
            Some(unlinked_result),
            false,
            None,
        ));

        let linked = storage.list_recent(
            10,
            Some("Alice"),
            Some("illidan"),
            true,
            false,
            false,
        );
        assert_eq!(linked.len(), 1);
        assert_eq!(linked[0].id, "job-linked");
        assert_eq!(linked[0].linked_name.as_deref(), Some("Alice"));
        assert_eq!(linked[0].player_name.as_deref(), Some("Alice"));

        let unlinked = storage.list_recent(10, None, None, false, true, false);
        assert_eq!(unlinked.len(), 1);
        assert_eq!(unlinked[0].id, "job-unlinked");
        assert!(unlinked[0].linked_name.is_none());
        assert_eq!(unlinked[0].player_name.as_deref(), Some("Bob"));
    }

    #[test]
    fn pinned_jobs_survive_retention_as_user_adds_more_runs() {
        let storage = MemoryStorage::new();
        storage.set_max_jobs(2);

        storage.insert(make_job(
            "job-pinned",
            "2026-01-01T00:00:00Z",
            "mage=\"Pinned\"\nserver=illidan\n",
            None,
            true,
            None,
        ));
        storage.insert(make_job(
            "job-old-unpinned",
            "2026-01-02T00:00:00Z",
            "mage=\"Old\"\nserver=illidan\n",
            None,
            false,
            None,
        ));
        storage.insert(make_job(
            "job-mid-unpinned",
            "2026-01-03T00:00:00Z",
            "mage=\"Mid\"\nserver=illidan\n",
            None,
            false,
            None,
        ));
        storage.insert(make_job(
            "job-new-unpinned",
            "2026-01-04T00:00:00Z",
            "mage=\"New\"\nserver=illidan\n",
            None,
            false,
            None,
        ));

        assert!(storage.get("job-pinned").is_some());
        assert!(storage.get("job-old-unpinned").is_none());
        assert!(storage.get("job-mid-unpinned").is_some());
        assert!(storage.get("job-new-unpinned").is_some());
    }

    #[test]
    fn user_can_filter_saved_profiles_case_insensitively() {
        let storage = MemoryStorage::new();
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

        let results = storage.list_character_profiles(Some("mymain"), Some("illidan"), Some("us"));
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "p1");
    }

    #[test]
    fn user_can_save_and_remove_local_settings() {
        let storage = MemoryStorage::new();
        storage.set_user_config("user-1", "discord_link_hidden", "true");
        assert_eq!(
            storage.get_user_config("user-1", "discord_link_hidden").as_deref(),
            Some("true")
        );

        storage.remove_user_config("user-1", "discord_link_hidden");
        assert!(
            storage
                .get_user_config("user-1", "discord_link_hidden")
                .is_none()
        );
    }

    #[test]
    fn user_can_save_list_and_delete_dungeon_routes() {
        let storage = MemoryStorage::new();
        storage.save_route(SavedRoute {
            id: "route-old".to_string(),
            name: "Old Route".to_string(),
            dungeon: "Ara-Kara".to_string(),
            level: Some(10),
            pull_count: Some(12),
            timer_seconds: Some(1800),
            affixes: Some("Fortified".to_string()),
            route_data: "ROUTE_DATA_OLD".to_string(),
            created_at: "2026-01-01T00:00:00Z".to_string(),
        });
        storage.save_route(SavedRoute {
            id: "route-new".to_string(),
            name: "New Route".to_string(),
            dungeon: "Ara-Kara".to_string(),
            level: Some(12),
            pull_count: Some(14),
            timer_seconds: Some(1780),
            affixes: Some("Tyrannical".to_string()),
            route_data: "ROUTE_DATA_NEW".to_string(),
            created_at: "2026-01-02T00:00:00Z".to_string(),
        });

        let listed = storage.list_routes();
        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].id, "route-new");
        assert_eq!(listed[1].id, "route-old");

        storage.delete_route("route-old");
        let listed_after_delete = storage.list_routes();
        assert_eq!(listed_after_delete.len(), 1);
        assert_eq!(listed_after_delete[0].id, "route-new");
    }
}
