use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;

use super::helpers::sanitize_custom_simc;

/// Newtype wrapper to avoid colliding with the simc `web::Data<PathBuf>`.
#[derive(Clone)]
pub(super) struct FrontendDir(pub PathBuf);

// ---------- Request / Response types ----------

/// Shared simulation options common to all sim request types.
#[derive(Debug, Deserialize)]
pub struct SimOptions {
    #[serde(default = "default_iterations")]
    pub iterations: u32,
    #[serde(default = "default_fight_style")]
    pub fight_style: String,
    #[serde(default = "default_target_error")]
    pub target_error: f64,
    #[serde(default = "default_desired_targets")]
    pub desired_targets: u32,
    #[serde(default = "default_max_time")]
    pub max_time: u32,
    #[serde(default)]
    pub threads: u32,
    #[serde(default)]
    pub talents: String,
    #[serde(default)]
    pub spec_override: String,
    /// Custom APL and SimC expansion options (e.g., actions=..., midnight.*, use_blizzard_action_list).
    #[serde(default)]
    pub custom_apl: String,
    // Batch grouping
    #[serde(default)]
    pub batch_id: Option<String>,
    // Expert Mode injection points
    #[serde(default)]
    pub simc_header: String,
    #[serde(default)]
    pub simc_base_player: String,
    #[serde(default)]
    pub simc_raid_actors: String,
    #[serde(default)]
    pub simc_post_combos: String,
    #[serde(default)]
    pub simc_footer: String,
    // Stat plotting (optional)
    #[serde(default)]
    pub dps_plot_stat: String,
    #[serde(default)]
    pub dps_plot_points: u32,
    #[serde(default)]
    pub dps_plot_step: u32,
    #[serde(default)]
    pub dps_plot_iterations: u32,
    #[serde(default = "default_include_timeline")]
    pub include_timeline: bool,
    #[serde(default = "default_include_trinket_matrix")]
    pub include_trinket_matrix: bool,
    #[serde(default = "default_include_tier_matrix")]
    pub include_tier_matrix: bool,
}

impl SimOptions {
    pub(super) fn has_raid_actors(&self) -> bool {
        !sanitize_custom_simc(&self.simc_raid_actors)
            .trim()
            .is_empty()
    }

    pub(super) fn to_json(&self) -> Value {
        json!({
            "fight_style": self.fight_style,
            "target_error": self.target_error,
            "iterations": self.iterations,
            "desired_targets": self.desired_targets,
            "max_time": self.max_time,
            "threads": self.threads,
            "single_actor_batch": !self.has_raid_actors(),
            "dps_plot_stat": self.dps_plot_stat,
            "dps_plot_points": self.dps_plot_points,
            "dps_plot_step": self.dps_plot_step,
            "dps_plot_iterations": self.dps_plot_iterations,
            "include_timeline": self.include_timeline,
            "include_trinket_matrix": self.include_trinket_matrix,
            "include_tier_matrix": self.include_tier_matrix,
        })
    }

    pub(super) fn to_json_with_sim_type(&self, sim_type: &str) -> Value {
        let mut v = self.to_json();
        v["sim_type"] = json!(sim_type);
        v
    }
}

#[derive(Debug, Deserialize)]
pub struct SimRequest {
    pub simc_input: String,
    #[serde(default = "default_sim_type")]
    pub sim_type: String,
    #[serde(default)]
    pub max_upgrade: bool,
    #[serde(flatten)]
    pub options: SimOptions,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TalentBuild {
    pub name: String,
    pub talent_string: String,
}

#[derive(Debug, Deserialize)]
pub struct TopGearRequest {
    pub simc_input: String,
    pub selected_items: HashMap<String, Vec<String>>,
    pub items_by_slot: Option<HashMap<String, Vec<crate::types::ResolvedItem>>>,
    #[serde(default)]
    pub max_upgrade: bool,
    #[serde(default)]
    pub copy_enchants: bool,
    #[serde(default)]
    pub max_combinations: Option<usize>,
    #[serde(default)]
    pub talent_builds: Vec<TalentBuild>,
    #[serde(default)]
    pub catalyst: bool,
    #[serde(default)]
    pub catalyst_charges: Option<u32>,
    #[serde(flatten)]
    pub options: SimOptions,
}

#[derive(Debug, Deserialize)]
pub struct DroptimizerRequest {
    pub simc_input: String,
    pub drop_items: Vec<crate::types::ResolvedItem>,
    #[serde(flatten)]
    pub options: SimOptions,
}

#[derive(Debug, Deserialize)]
pub struct UpgradeCompareRequest {
    pub simc_input: String,
    pub selected_slots: Vec<String>,
    #[serde(default)]
    pub max_combinations: Option<usize>,
    #[serde(flatten)]
    pub options: SimOptions,
}

#[derive(Debug, Serialize)]
pub struct SimResponse {
    pub id: String,
    pub status: String,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct ItemInfoBatchRequest {
    #[serde(default)]
    pub items: Vec<Value>,
    #[serde(default)]
    pub item_ids: Vec<u64>,
}

#[derive(Debug, Deserialize)]
pub(super) struct BonusIdsQuery {
    #[serde(default)]
    pub bonus_ids: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct ResolveGearRequest {
    pub simc_input: String,
    #[serde(default)]
    pub max_upgrade: bool,
    #[serde(default)]
    pub catalyst: bool,
}

#[derive(Debug, Deserialize)]
pub(super) struct CatalystConvertRequest {
    pub class_name: String,
    pub slot: String,
    pub item: crate::types::ResolvedItem,
}

#[derive(Debug, Deserialize)]
pub(super) struct ListSimsQuery {
    #[serde(default)]
    pub player: String,
    #[serde(default)]
    pub realm: String,
    #[serde(default)]
    pub linked_only: bool,
    #[serde(default)]
    pub unlinked_only: bool,
}

#[derive(Deserialize)]
pub(super) struct LogsQuery {
    #[serde(default)]
    pub after: usize,
}

#[derive(Debug, Deserialize)]
pub(super) struct DropsQuery {
    #[serde(default)]
    pub class_name: String,
    #[serde(default)]
    pub spec: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct EnchantOptionsQuery {
    pub slot: String,
}

fn default_iterations() -> u32 {
    1000
}
fn default_fight_style() -> String {
    "Patchwerk".to_string()
}
fn default_target_error() -> f64 {
    0.05
}
fn default_sim_type() -> String {
    "quick".to_string()
}
fn default_desired_targets() -> u32 {
    1
}
fn default_max_time() -> u32 {
    300
}
fn default_include_timeline() -> bool {
    true
}
fn default_include_trinket_matrix() -> bool {
    false
}
fn default_include_tier_matrix() -> bool {
    true
}
