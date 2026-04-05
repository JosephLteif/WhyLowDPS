use regex::Regex;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum JobStatus {
    Pending,
    Running,
    Done,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Job {
    pub id: String,
    pub status: JobStatus,
    pub sim_type: String,
    pub simc_input: String,
    pub result_json: Option<String>,
    pub raw_json: Option<String>,
    pub combo_metadata_json: Option<String>,
    pub error_message: Option<String>,
    pub progress_pct: u8,
    pub progress_stage: Option<String>,
    pub progress_detail: Option<String>,
    pub stages_completed: Vec<String>,
    pub iterations: u32,
    pub fight_style: String,
    pub target_error: f64,
    pub created_at: String,
    pub html_report: Option<String>,
    pub text_output: Option<String>,
    pub batch_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobSummary {
    pub id: String,
    pub status: JobStatus,
    pub sim_type: String,
    pub created_at: String,
    pub fight_style: String,
    pub iterations: u32,
    pub error_message: Option<String>,
    pub player_name: Option<String>,
    pub player_class: Option<String>,
    pub realm: Option<String>,
    pub dps: Option<f64>,
    pub batch_id: Option<String>,
    pub size_bytes: u64,
    pub upgrades: Option<u32>,
    pub downgrades: Option<u32>,
}

pub struct ResultSummary {
    pub player_name: Option<String>,
    pub player_class: Option<String>,
    pub dps: Option<f64>,
    pub realm: Option<String>,
    pub upgrades: Option<u32>,
    pub downgrades: Option<u32>,
}

pub fn extract_result_summary(result_json: &Option<String>, simc_input: &str) -> ResultSummary {
    let mut summary = ResultSummary {
        player_name: None,
        player_class: None,
        dps: None,
        realm: None,
        upgrades: None,
        downgrades: None,
    };

    // Extract DPS, player name, class from parsed result
    if let Some(json_str) = result_json {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(json_str) {
            summary.player_name = v
                .get("player_name")
                .and_then(|n| n.as_str())
                .map(String::from);
            summary.player_class = v
                .get("player_class")
                .and_then(|c| c.as_str())
                .map(String::from);
            summary.dps = v.get("dps").and_then(|d| d.as_f64());

            if let Some(sim_type) = v.get("type").and_then(|t| t.as_str()) {
                if sim_type == "top_gear" || sim_type == "droptimizer" {
                    if let Some(base_dps) = v.get("base_dps").and_then(|bd| bd.as_f64()) {
                        if let Some(results) = v.get("results").and_then(|r| r.as_array()) {
                            let mut upgrades = 0;
                            let mut downgrades = 0;
                            for r in results {
                                let name = r.get("name").and_then(|n| n.as_str()).unwrap_or("");
                                let delta = r.get("delta").and_then(|d| d.as_f64()).unwrap_or(0.0);

                                if delta == 0.0 && (name.starts_with("Currently Equipped") || name == "Base") {
                                    continue;
                                }

                                if let Some(dps) = r.get("dps").and_then(|d| d.as_f64()) {
                                    if dps > base_dps {
                                        upgrades += 1;
                                    } else {
                                        downgrades += 1;
                                    }
                                }
                            }
                            summary.upgrades = Some(upgrades);
                            summary.downgrades = Some(downgrades);
                        }
                    }
                }
            }
        }
    }

    // Extract realm from simc input (server=quelthalas)
    for line in simc_input.lines() {
        let trimmed = line.trim();
        if let Some(val) = trimmed.strip_prefix("server=") {
            summary.realm = Some(val.to_string());
            break;
        }
    }

    // If player_name not in result yet, extract from simc input (e.g. deathknight="Simpydk")
    if summary.player_name.is_none() {
        let re = Regex::new(
            r#"^(?:warrior|paladin|hunter|rogue|priest|death_knight|deathknight|shaman|mage|warlock|monk|druid|demon_hunter|demonhunter|evoker)\s*=\s*"(.+)""#
        ).unwrap();
        for line in simc_input.lines() {
            if let Some(caps) = re.captures(line.trim()) {
                summary.player_name = Some(caps[1].to_string());
                break;
            }
        }
    }

    summary
}

impl Job {
    pub fn new(
        simc_input: String,
        sim_type: String,
        iterations: u32,
        fight_style: String,
        target_error: f64,
    ) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            status: JobStatus::Pending,
            sim_type,
            simc_input,
            result_json: None,
            raw_json: None,
            combo_metadata_json: None,
            error_message: None,
            progress_pct: 0,
            progress_stage: None,
            progress_detail: None,
            stages_completed: Vec::new(),
            iterations,
            fight_style,
            target_error,
            created_at: chrono::Utc::now().to_rfc3339(),
            html_report: None,
            text_output: None,
            batch_id: None,
        }
    }

    pub fn estimate_size(&self) -> u64 {
        let mut total = self.simc_input.len() as u64;
        total += self.result_json.as_ref().map(|s| s.len()).unwrap_or(0) as u64;
        total += self.raw_json.as_ref().map(|s| s.len()).unwrap_or(0) as u64;
        total += self
            .combo_metadata_json
            .as_ref()
            .map(|s| s.len())
            .unwrap_or(0) as u64;
        total += self.html_report.as_ref().map(|s| s.len()).unwrap_or(0) as u64;
        total += self.text_output.as_ref().map(|s| s.len()).unwrap_or(0) as u64;
        total
    }
}
