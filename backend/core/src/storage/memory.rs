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
        *mj = limit;

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
