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
    #[serde(default = "default_simc_channel")]
    pub simc_channel: String,
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
    #[serde(default = "default_heatmap_target_ilevel")]
    pub heatmap_target_ilevel: i64,
    #[serde(default = "default_heatmap_trinket_sources")]
    pub heatmap_trinket_sources: String,
    #[serde(default = "default_heatmap_lock_trinket_slot")]
    pub heatmap_lock_trinket_slot: String,
    #[serde(default = "default_heatmap_role_pools")]
    pub heatmap_role_pools: String,
    #[serde(default)]
    pub heatmap_ignore_spec_restrictions: bool,
    #[serde(default)]
    pub external_buff_chaos_brand: bool,
    #[serde(default)]
    pub external_buff_mystic_touch: bool,
    #[serde(default)]
    pub external_buff_skyfury: bool,
    #[serde(default)]
    pub external_buff_power_infusion: bool,
    #[serde(default)]
    pub external_buff_blessing_of_bronze: bool,
    #[serde(default)]
    pub external_buff_augmentation: bool,
    #[serde(default)]
    pub raid_buff_customized: bool,
    #[serde(default)]
    pub raid_buff_bloodlust: bool,
    #[serde(default)]
    pub raid_buff_arcane_intellect: bool,
    #[serde(default)]
    pub raid_buff_power_word_fortitude: bool,
    #[serde(default)]
    pub raid_buff_mark_of_the_wild: bool,
    #[serde(default)]
    pub raid_buff_battle_shout: bool,
    #[serde(default)]
    pub raid_buff_hunters_mark: bool,
    #[serde(default)]
    pub raid_buff_bleeding: bool,
    #[serde(default)]
    pub consumable_flask: String,
    #[serde(default)]
    pub consumable_food: String,
    #[serde(default)]
    pub consumable_potion: String,
    #[serde(default)]
    pub consumable_augmentation: String,
    #[serde(default)]
    pub consumable_temporary_enchant: String,
    #[serde(default)]
    pub consumable_matrix_flasks: Vec<String>,
    #[serde(default)]
    pub consumable_matrix_foods: Vec<String>,
    #[serde(default)]
    pub consumable_matrix_potions: Vec<String>,
    #[serde(default)]
    pub consumable_matrix_augmentations: Vec<String>,
    #[serde(default)]
    pub consumable_matrix_temporary_enchants: Vec<String>,
    #[serde(default)]
    pub consumable_matrix_raid_buffs: Vec<String>,
    #[serde(default)]
    pub baseline_live_stats: Option<Value>,
}

impl SimOptions {
    pub(super) fn has_raid_actors(&self) -> bool {
        !sanitize_custom_simc(&self.simc_raid_actors)
            .trim()
            .is_empty()
    }

    pub(super) fn to_json(&self) -> Value {
        let mut v = json!({
            "fight_style": self.fight_style,
            "target_error": self.target_error,
            "iterations": self.iterations,
            "desired_targets": self.desired_targets,
            "max_time": self.max_time,
            "threads": self.threads,
            "simc_channel": self.simc_channel,
            "single_actor_batch": !self.has_raid_actors(),
            "dps_plot_stat": self.dps_plot_stat,
            "dps_plot_points": self.dps_plot_points,
            "dps_plot_step": self.dps_plot_step,
            "dps_plot_iterations": self.dps_plot_iterations,
            "include_timeline": self.include_timeline,
            "include_trinket_matrix": self.include_trinket_matrix,
            "include_tier_matrix": self.include_tier_matrix,
            "heatmap_target_ilevel": self.heatmap_target_ilevel,
            "external_buff_chaos_brand": self.external_buff_chaos_brand,
            "external_buff_mystic_touch": self.external_buff_mystic_touch,
            "external_buff_skyfury": self.external_buff_skyfury,
            "external_buff_power_infusion": self.external_buff_power_infusion,
            "external_buff_blessing_of_bronze": self.external_buff_blessing_of_bronze,
            "external_buff_augmentation": self.external_buff_augmentation,
            "raid_buff_customized": self.raid_buff_customized,
            "raid_buff_bloodlust": self.raid_buff_bloodlust,
            "raid_buff_arcane_intellect": self.raid_buff_arcane_intellect,
            "raid_buff_power_word_fortitude": self.raid_buff_power_word_fortitude,
            "raid_buff_mark_of_the_wild": self.raid_buff_mark_of_the_wild,
            "raid_buff_battle_shout": self.raid_buff_battle_shout,
            "raid_buff_hunters_mark": self.raid_buff_hunters_mark,
            "raid_buff_bleeding": self.raid_buff_bleeding,
            "consumable_flask": self.consumable_flask,
            "consumable_food": self.consumable_food,
            "consumable_potion": self.consumable_potion,
            "consumable_augmentation": self.consumable_augmentation,
            "consumable_temporary_enchant": self.consumable_temporary_enchant,
            "consumable_matrix_flasks": self.consumable_matrix_flasks,
            "consumable_matrix_foods": self.consumable_matrix_foods,
            "consumable_matrix_potions": self.consumable_matrix_potions,
            "consumable_matrix_augmentations": self.consumable_matrix_augmentations,
            "consumable_matrix_temporary_enchants": self.consumable_matrix_temporary_enchants,
            "consumable_matrix_raid_buffs": self.consumable_matrix_raid_buffs,
        });
        if let Some(stats) = &self.baseline_live_stats {
            v["baseline_live_stats"] = stats.clone();
        }
        v
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
    #[serde(default = "default_copy_enchants")]
    pub copy_enchants: bool,
    #[serde(flatten)]
    pub options: SimOptions,
}

#[derive(Debug, Deserialize)]
pub struct UpgradeCompareRequest {
    pub simc_input: String,
    pub selected_slots: Vec<String>,
    #[serde(default = "default_upgrade_depth")]
    pub upgrade_depth: String,
    #[serde(default = "default_budget_mode")]
    pub budget_mode: String,
    #[serde(default)]
    pub upgrade_budget_override: HashMap<u64, u64>,
    #[serde(default)]
    pub max_combinations: Option<usize>,
    #[serde(flatten)]
    pub options: SimOptions,
}

fn default_upgrade_depth() -> String {
    "highest_only".to_string()
}

fn default_budget_mode() -> String {
    "max_affordability".to_string()
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
pub(super) struct ConsumableOptionsQuery {
    #[serde(default)]
    pub expansion: i64,
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
    #[serde(default)]
    pub pinned_only: bool,
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
pub(super) struct MultiDropsQuery {
    #[serde(default)]
    pub ids: String,
    #[serde(default)]
    pub class_name: String,
    #[serde(default)]
    pub spec: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct EnchantOptionsQuery {
    pub slot: String,
    #[serde(default)]
    pub class_name: String,
    #[serde(default)]
    pub spec: String,
    #[serde(default)]
    pub item_id: u64,
}

#[derive(Debug, Deserialize)]
pub(super) struct EmbellishmentOptionsQuery {
    pub item_id: u64,
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
fn default_simc_channel() -> String {
    "bundled".to_string()
}
fn default_copy_enchants() -> bool {
    true
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
fn default_heatmap_target_ilevel() -> i64 {
    289
}
fn default_heatmap_trinket_sources() -> String {
    "all".to_string()
}
fn default_heatmap_lock_trinket_slot() -> String {
    "".to_string()
}
fn default_heatmap_role_pools() -> String {
    "auto".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sim_options(value: Value) -> SimOptions {
        serde_json::from_value(value).expect("sim options")
    }

    #[test]
    fn sim_options_deserialize_expected_defaults() {
        let req: SimRequest = serde_json::from_value(json!({
            "simc_input": "warrior=tester"
        }))
        .expect("sim request");

        assert_eq!(req.sim_type, "quick");
        assert!(!req.max_upgrade);
        assert_eq!(req.options.iterations, 1000);
        assert_eq!(req.options.fight_style, "Patchwerk");
        assert_eq!(req.options.target_error, 0.05);
        assert_eq!(req.options.desired_targets, 1);
        assert_eq!(req.options.max_time, 300);
        assert_eq!(req.options.simc_channel, "bundled");
        assert!(req.options.include_timeline);
        assert!(!req.options.include_trinket_matrix);
        assert!(req.options.include_tier_matrix);
    }

    #[test]
    fn raid_actor_detection_ignores_sanitized_output_only_sections() {
        let blocked_only = sim_options(json!({
            "simc_raid_actors": "output=/tmp/raid.simc\nhtml=raid.html\njson=raid.json"
        }));
        assert!(!blocked_only.has_raid_actors());

        let safe_actor = sim_options(json!({
            "simc_raid_actors": "priest=helper\noutput=/tmp/raid.simc"
        }));
        assert!(safe_actor.has_raid_actors());
    }

    #[test]
    fn sim_options_json_includes_job_metadata_without_secret_custom_text() {
        let options = sim_options(json!({
            "iterations": 5000,
            "simc_channel": "nightly",
            "simc_raid_actors": "priest=helper\nhtml=raid.html",
            "baseline_live_stats": {"dps": 12345},
            "consumable_matrix_flasks": ["flask_a"]
        }));

        let serialized = options.to_json_with_sim_type("top_gear");

        assert_eq!(
            serialized.get("sim_type").and_then(Value::as_str),
            Some("top_gear")
        );
        assert_eq!(
            serialized.get("iterations").and_then(Value::as_u64),
            Some(5000)
        );
        assert_eq!(
            serialized.get("simc_channel").and_then(Value::as_str),
            Some("nightly")
        );
        assert_eq!(
            serialized
                .get("single_actor_batch")
                .and_then(Value::as_bool),
            Some(false)
        );
        assert_eq!(
            serialized
                .get("baseline_live_stats")
                .and_then(|value| value.get("dps"))
                .and_then(Value::as_u64),
            Some(12345)
        );
        assert!(serialized.get("simc_raid_actors").is_none());
        assert_eq!(
            serialized
                .get("consumable_matrix_flasks")
                .and_then(Value::as_array)
                .and_then(|values| values.first())
                .and_then(Value::as_str),
            Some("flask_a")
        );
    }

    #[test]
    fn top_gear_request_defaults_match_expected_batch_behavior() {
        let req: TopGearRequest = serde_json::from_value(json!({
            "simc_input": "mage=tester",
            "selected_items": {
                "head": ["head-1"]
            }
        }))
        .expect("top gear request");

        assert!(!req.max_upgrade);
        assert!(!req.copy_enchants);
        assert_eq!(req.max_combinations, None);
        assert!(req.talent_builds.is_empty());
        assert!(!req.catalyst);
        assert_eq!(req.catalyst_charges, None);
        assert_eq!(req.options.heatmap_target_ilevel, 289);
        assert_eq!(req.options.heatmap_trinket_sources, "all");
        assert_eq!(req.options.heatmap_role_pools, "auto");
    }

    #[test]
    fn droptimizer_and_upgrade_compare_requests_apply_declared_defaults() {
        let drop_req: DroptimizerRequest = serde_json::from_value(json!({
            "simc_input": "mage=tester",
            "drop_items": []
        }))
        .expect("droptimizer request");
        assert!(drop_req.copy_enchants);
        assert_eq!(drop_req.options.simc_channel, "bundled");

        let upgrade_req: UpgradeCompareRequest = serde_json::from_value(json!({
            "simc_input": "mage=tester",
            "selected_slots": ["head"]
        }))
        .expect("upgrade compare request");
        assert_eq!(upgrade_req.upgrade_depth, "highest_only");
        assert_eq!(upgrade_req.budget_mode, "max_affordability");
        assert!(upgrade_req.upgrade_budget_override.is_empty());
        assert_eq!(upgrade_req.max_combinations, None);
    }

    #[test]
    fn backend_query_types_default_missing_optional_parameters() {
        let item_batch: ItemInfoBatchRequest =
            serde_json::from_value(json!({})).expect("item info batch query");
        assert!(item_batch.items.is_empty());
        assert!(item_batch.item_ids.is_empty());

        let bonus_ids: BonusIdsQuery = serde_json::from_value(json!({})).expect("bonus ids query");
        assert_eq!(bonus_ids.bonus_ids, "");

        let consumables: ConsumableOptionsQuery =
            serde_json::from_value(json!({})).expect("consumables query");
        assert_eq!(consumables.expansion, 0);

        let list_sims: ListSimsQuery = serde_json::from_value(json!({})).expect("list sims query");
        assert_eq!(list_sims.player, "");
        assert_eq!(list_sims.realm, "");
        assert!(!list_sims.linked_only);
        assert!(!list_sims.unlinked_only);
        assert!(!list_sims.pinned_only);

        let logs: LogsQuery = serde_json::from_value(json!({})).expect("logs query");
        assert_eq!(logs.after, 0);
    }
}
