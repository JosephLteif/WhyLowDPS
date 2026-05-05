use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use super::types::SimOptions;
use crate::log_buffer::LogBuffer;
use crate::models::JobStatus;
use crate::result_parser;
use crate::simc_runner;
use crate::storage::{self, JobStorage};
use crate::types::ResolveGearResponse;

/// Sanitize user-provided custom SimC input by stripping dangerous directives.
pub(super) fn sanitize_custom_simc(input: &str) -> String {
    let blocked = regex::Regex::new(r"(?mi)^\s*(output|html|json2?|xml)\s*=").unwrap();
    input
        .lines()
        .filter(|line| !blocked.is_match(line))
        .collect::<Vec<_>>()
        .join("\n")
}

fn sanitize_simc_token(input: &str) -> Option<String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return None;
    }
    let ok = trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.' | '/' | ':' | '+'));
    if ok {
        Some(trimmed.to_string())
    } else {
        None
    }
}

pub(super) fn apply_shared_simc_options(
    simc_input: &str,
    options: &SimOptions,
    include_external_buffs: bool,
) -> String {
    let mut extra_lines: Vec<String> = Vec::new();

    if include_external_buffs {
        if options.raid_buff_customized {
            extra_lines.push(format!(
                "override.bloodlust={}",
                if options.raid_buff_bloodlust { 1 } else { 0 }
            ));
            extra_lines.push(format!(
                "override.arcane_intellect={}",
                if options.raid_buff_arcane_intellect {
                    1
                } else {
                    0
                }
            ));
            extra_lines.push(format!(
                "override.power_word_fortitude={}",
                if options.raid_buff_power_word_fortitude {
                    1
                } else {
                    0
                }
            ));
            extra_lines.push(format!(
                "override.battle_shout={}",
                if options.raid_buff_battle_shout { 1 } else { 0 }
            ));
            extra_lines.push(format!(
                "override.mark_of_the_wild={}",
                if options.raid_buff_mark_of_the_wild {
                    1
                } else {
                    0
                }
            ));
            extra_lines.push(format!(
                "override.hunters_mark={}",
                if options.raid_buff_hunters_mark { 1 } else { 0 }
            ));
            extra_lines.push(format!(
                "override.bleeding={}",
                if options.raid_buff_bleeding { 1 } else { 0 }
            ));
            extra_lines.push(format!(
                "override.mystic_touch={}",
                if options.external_buff_mystic_touch {
                    1
                } else {
                    0
                }
            ));
            extra_lines.push(format!(
                "override.chaos_brand={}",
                if options.external_buff_chaos_brand {
                    1
                } else {
                    0
                }
            ));
            extra_lines.push(format!(
                "override.skyfury={}",
                if options.external_buff_skyfury { 1 } else { 0 }
            ));
            extra_lines.push(format!(
                "override.blessing_of_the_bronze={}",
                if options.external_buff_blessing_of_bronze {
                    1
                } else {
                    0
                }
            ));
        } else {
            if options.external_buff_chaos_brand {
                extra_lines.push("override.chaos_brand=1".to_string());
            }
            if options.external_buff_mystic_touch {
                extra_lines.push("override.mystic_touch=1".to_string());
            }
            if options.external_buff_skyfury {
                extra_lines.push("override.skyfury=1".to_string());
            }
            if options.external_buff_blessing_of_bronze {
                extra_lines.push("override.blessing_of_the_bronze=1".to_string());
            }
        }

        if options.external_buff_power_infusion {
            extra_lines.push("external_buffs.power_infusion=0/120/240".to_string());
        }
        if options.external_buff_augmentation {
            extra_lines.push("dragonflight.brilliance_party=1".to_string());
        }
    }

    if let Some(v) = sanitize_simc_token(&options.consumable_flask) {
        extra_lines.push(format!("flask={}", v));
    }
    if let Some(v) = sanitize_simc_token(&options.consumable_food) {
        extra_lines.push(format!("food={}", v));
    }
    if let Some(v) = sanitize_simc_token(&options.consumable_potion) {
        extra_lines.push(format!("potion={}", v));
    }
    if let Some(v) = sanitize_simc_token(&options.consumable_augmentation) {
        extra_lines.push(format!("augmentation={}", v));
    }
    if let Some(v) = sanitize_simc_token(&options.consumable_temporary_enchant) {
        if !v.starts_with("off_hand:") {
            extra_lines.push(format!("temporary_enchant={}", v));
        }
    }

    if extra_lines.is_empty() {
        return simc_input.to_string();
    }

    let shared_opts = format!("\n# Shared Sim Options\n{}\n", extra_lines.join("\n"));

    if let Some(idx) = simc_input.find("### Combo 1") {
        let mut out = String::new();
        out.push_str(&simc_input[..idx]);
        out.push_str(&shared_opts);
        out.push_str(&simc_input[idx..]);
        out
    } else {
        let mut out = simc_input.to_string();
        out.push_str(&shared_opts);
        out
    }
}

/// Inject expert mode fields at the correct positions in the SimC profile.
///
/// For profileset sims (has `# Base Actor` and `### Combo` markers):
///   {header} → # Base Actor → {base lines} → {base_player} → ### Combo 1 →
///   {gear} → {raid_actors} → ### Combo 2..N → {post_combos} → {footer}
///
/// For quick sim (no markers):
///   {header} → {raw input} → {base_player} → {raid_actors} → {post_combos} → {footer}
pub(super) fn inject_expert_fields(simc_input: &str, options: &SimOptions) -> String {
    let header = sanitize_custom_simc(&options.simc_header);
    let base_player = sanitize_custom_simc(&options.simc_base_player);
    let custom_apl = sanitize_custom_simc(&options.custom_apl);
    let raid_actors = sanitize_custom_simc(&options.simc_raid_actors);
    let post_combos = sanitize_custom_simc(&options.simc_post_combos);
    let footer = sanitize_custom_simc(&options.simc_footer);

    let all_empty = header.trim().is_empty()
        && base_player.trim().is_empty()
        && custom_apl.trim().is_empty()
        && raid_actors.trim().is_empty()
        && post_combos.trim().is_empty()
        && footer.trim().is_empty();

    if all_empty {
        return simc_input.to_string();
    }

    let lines: Vec<&str> = simc_input.lines().collect();
    let has_base_actor = lines.iter().any(|l| l.trim() == "# Base Actor");

    if !has_base_actor {
        // Quick Sim: no markers, just concatenate in order
        let mut parts: Vec<&str> = Vec::new();
        if !header.trim().is_empty() {
            parts.push("# Header");
            parts.push(&header);
            parts.push("");
        }
        parts.push(simc_input);
        if !base_player.trim().is_empty() {
            parts.push("");
            parts.push("# Base Player Customization");
            parts.push(&base_player);
        }
        if !custom_apl.trim().is_empty() {
            parts.push("");
            parts.push("# Custom APL");
            parts.push(&custom_apl);
        }
        if !raid_actors.trim().is_empty() {
            parts.push("");
            parts.push("# Raid Actors");
            parts.push(&raid_actors);
        }
        if !post_combos.trim().is_empty() {
            parts.push("");
            parts.push("# Post Combination Actors");
            parts.push(&post_combos);
        }
        if !footer.trim().is_empty() {
            parts.push("");
            parts.push("# Footer");
            parts.push(&footer);
        }
        return parts.join("\n");
    }

    // Profileset sim: find markers and inject at the right positions
    let mut result: Vec<String> = Vec::new();
    let mut i = 0;
    let mut injected_base_player = false;
    let mut injected_raid_actors = false;
    let mut _last_combo_end = 0;

    while i < lines.len() {
        let trimmed = lines[i].trim();

        // Inject header before "# Base Actor"
        if trimmed == "# Base Actor" && !header.trim().is_empty() {
            result.push("# Header".to_string());
            result.push(header.clone());
            result.push(String::new());
        }

        // Inject base_player and custom_apl before "### Combo 1"
        if trimmed == "### Combo 1" && !injected_base_player {
            if !base_player.trim().is_empty() {
                result.push("# Base Player Customization".to_string());
                result.push(base_player.clone());
                result.push(String::new());
            }
            if !custom_apl.trim().is_empty() {
                result.push("# Custom APL".to_string());
                result.push(custom_apl.clone());
                result.push(String::new());
            }
            injected_base_player = true;
        }

        // Inject raid_actors before "### Combo 2"
        if trimmed == "### Combo 2" && !raid_actors.trim().is_empty() && !injected_raid_actors {
            result.push("# Raid Actors".to_string());
            result.push(raid_actors.clone());
            result.push(String::new());
            injected_raid_actors = true;
        }

        result.push(lines[i].to_string());

        // Track end of combo blocks
        if trimmed.starts_with("### Combo") {
            _last_combo_end = result.len();
            // Scan ahead to find end of this combo block
            i += 1;
            while i < lines.len() {
                let next = lines[i].trim();
                if next.starts_with("### Combo") {
                    break; // start of next combo, don't consume
                }
                result.push(lines[i].to_string());
                _last_combo_end = result.len();
                i += 1;
            }
            continue;
        }

        i += 1;
    }

    // If raid_actors wasn't injected (only 1 combo / no Combo 2), inject after Combo 1 block
    if !injected_raid_actors && !raid_actors.trim().is_empty() {
        result.push(String::new());
        result.push("# Raid Actors".to_string());
        result.push(raid_actors);
    }

    // Post combos after all profilesets
    if !post_combos.trim().is_empty() {
        result.push(String::new());
        result.push("# Post Combination Actors".to_string());
        result.push(post_combos);
    }

    // Footer at the very end
    if !footer.trim().is_empty() {
        result.push(String::new());
        result.push("# Footer".to_string());
        result.push(footer);
    }

    result.join("\n")
}

/// Convert ResolveGearResponse slots into the items_by_slot ResolvedItem format
/// used by profileset_generator and game_data functions.
pub(super) fn resolve_to_items_by_slot(
    resolved: &ResolveGearResponse,
) -> HashMap<String, Vec<crate::types::ResolvedItem>> {
    let mut items_by_slot: HashMap<String, Vec<crate::types::ResolvedItem>> = HashMap::new();
    for (slot, slot_res) in &resolved.slots {
        let mut items: Vec<crate::types::ResolvedItem> = Vec::new();
        if let Some(eq) = &slot_res.equipped {
            items.push(eq.clone());
        }
        for alt in &slot_res.alternatives {
            items.push(alt.clone());
        }
        if !items.is_empty() {
            items_by_slot.insert(slot.clone(), items);
        }
    }
    items_by_slot
}

/// Replace the talents= line in a simc input string with a new talent string.
pub(super) fn apply_talent_override(simc_input: &str, talents: &str) -> String {
    if talents.is_empty() {
        return simc_input.to_string();
    }
    let re = regex::Regex::new(r"(?m)^talents=.+$").unwrap();
    if re.is_match(simc_input) {
        re.replace(simc_input, format!("talents={}", talents))
            .to_string()
    } else {
        format!("{}\ntalents={}", simc_input, talents)
    }
}

/// Replace the spec= line in a simc input string.
pub(super) fn apply_spec_override(simc_input: &str, spec: &str) -> String {
    if spec.is_empty() {
        return simc_input.to_string();
    }
    let re = regex::Regex::new(r"(?m)^spec=.+$").unwrap();
    if re.is_match(simc_input) {
        re.replace(simc_input, format!("spec={}", spec)).to_string()
    } else {
        format!("{}\nspec={}", simc_input, spec)
    }
}

/// Extract server= (realm), region= and talents= from a simc input string and inject it into a parsed result.
pub(super) fn inject_realm(parsed: &mut Value, simc_input: &str) {
    for line in simc_input.lines() {
        let trimmed = line.trim();
        if let Some(val) = trimmed.strip_prefix("server=") {
            parsed["realm"] = json!(val.trim_matches('"'));
        }
        if let Some(val) = trimmed.strip_prefix("region=") {
            parsed["region"] = json!(val.trim_matches('"'));
        }
        if let Some(val) = trimmed.strip_prefix("talents=") {
            parsed["talent_string"] = json!(val.trim_matches('"'));
        }
    }
}

/// Spawn a staged (top-gear / droptimizer) simulation in a background task.
pub(super) fn spawn_staged_sim(
    store: Arc<dyn JobStorage>,
    simc: PathBuf,
    options: Value,
    job_id: String,
    simc_input: String,
    combo_count: usize,
    log_buffer: Arc<LogBuffer>,
) {
    tokio::spawn(async move {
        store.update_status(&job_id, JobStatus::Running);
        let store_progress = store.clone();
        let store_stages = store.clone();
        let jid_progress = job_id.clone();
        let jid_stages = job_id.clone();
        let logs = log_buffer.clone();
        let jid_logs = job_id.clone();
        match simc_runner::run_simc_staged(
            &simc,
            &job_id,
            &simc_input,
            &options,
            combo_count,
            move |pct, stage, detail| {
                store_progress.update_progress(&jid_progress, pct, stage, detail);
            },
            move |summary| {
                store_stages.complete_stage(&jid_stages, summary);
            },
            move |line| {
                logs.push_line(&jid_logs, line.to_string());
            },
        )
        .await
        {
            Ok(output) => {
                let job_snap = store.get(&job_id);
                let combo_meta_val: Option<Value> = job_snap
                    .as_ref()
                    .and_then(|j| j.combo_metadata_json.as_ref())
                    .and_then(|s| serde_json::from_str(s).ok());

                let meta: Option<HashMap<String, Vec<Value>>> = combo_meta_val
                    .as_ref()
                    .and_then(|v| v.get("_combo_metadata").cloned())
                    .and_then(|v| serde_json::from_value(v).ok());

                let mut parsed = result_parser::parse_top_gear_result(&output.json, meta.as_ref());

                // Inject currencies if present in job metadata
                if let Some(currencies) = combo_meta_val.as_ref().and_then(|v| v.get("currencies"))
                {
                    if let Some(obj) = parsed.as_object_mut() {
                        obj.insert("currencies".to_string(), currencies.clone());
                    }
                }

                if let Some(baseline_live_stats) = job_snap
                    .as_ref()
                    .and_then(|j| j.options.as_ref())
                    .and_then(|options| options.get("baseline_live_stats"))
                    .filter(|stats| !stats.is_null())
                {
                    if let Some(obj) = parsed.as_object_mut() {
                        obj.insert(
                            "baseline_live_stats".to_string(),
                            baseline_live_stats.clone(),
                        );
                    }
                }

                inject_realm(&mut parsed, &simc_input);
                let result_str = serde_json::to_string(&parsed).unwrap_or_default();
                let raw_str = serde_json::to_string(&output.json).ok();
                store.set_result(&job_id, result_str, raw_str);
                store.set_report_files(&job_id, output.html_report, output.text_output);
            }
            Err(e) => {
                // Don't overwrite cancelled status with a generic error
                let is_cancelled = store
                    .get(&job_id)
                    .map(|j| j.status == JobStatus::Cancelled)
                    .unwrap_or(false);
                if !is_cancelled {
                    store.set_error(&job_id, e.to_string());
                }
            }
        }
        log_buffer.remove(&job_id);
    });
}

/// Validate batch_id against MAX_SCENARIOS. Returns an error response if rejected.
pub(super) fn validate_batch(
    batch_id: &Option<String>,
    store: &dyn JobStorage,
) -> Option<actix_web::HttpResponse> {
    let bid = match batch_id {
        Some(b) if !b.is_empty() => b,
        _ => return None,
    };
    let max = *storage::MAX_SCENARIOS;
    if max == 0 {
        return Some(actix_web::HttpResponse::BadRequest().json(json!({
            "detail": "Batch scenarios are disabled on this server."
        })));
    }
    if store.count_batch(bid) >= max {
        return Some(actix_web::HttpResponse::BadRequest().json(json!({
            "detail": format!("Batch limit reached ({max} scenarios max).")
        })));
    }
    None
}
