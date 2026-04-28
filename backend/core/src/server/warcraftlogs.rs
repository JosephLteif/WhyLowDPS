use crate::server::auth_handlers::{verify_jwt, BlizzardAuthState};
use crate::storage::{WarcraftLogsParseFilter, WarcraftLogsStoredParse};
use actix_web::{web, HttpRequest, HttpResponse};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::time::{SystemTime, UNIX_EPOCH};
use std::sync::{Mutex, OnceLock};
use std::sync::Arc;

#[derive(Deserialize)]
pub struct WarcraftLogsQuery {
    pub region: Option<String>,
    pub debug_raw: Option<bool>,
    pub mode: Option<String>,
    pub refresh: Option<bool>,
    pub season_start_ms: Option<i64>,
    pub season_end_ms: Option<i64>,
    pub selected_expansion: Option<String>,
    pub selected_season: Option<String>,
    pub selected_raid_name: Option<String>,
    pub raid_group_filter: Option<String>,
}

fn normalize_optional_filter(value: Option<&str>) -> Option<String> {
    let v = value?.trim();
    if v.is_empty() || v.eq_ignore_ascii_case("all") {
        None
    } else {
        Some(v.to_string())
    }
}

#[derive(Serialize, Deserialize, Clone)]
struct WarcraftLogsParse {
    expansion: Option<String>,
    season: Option<String>,
    raid_name: Option<String>,
    raid_group: Option<String>,
    zone_name: String,
    encounter_name: String,
    difficulty: String,
    percentile: Option<f64>,
    dps: Option<f64>,
    median_percentile: Option<f64>,
    attempts: Option<i64>,
    kills: Option<i64>,
    fastest_kill_seconds: Option<f64>,
    all_stars_points: Option<f64>,
    all_stars_rank: Option<i64>,
    report_code: Option<String>,
    report_title: Option<String>,
    report_end_time: Option<i64>,
    start_time: Option<i64>,
    locked_in: Option<bool>,
}

fn parse_dedupe_key(row: &WarcraftLogsParse) -> String {
    format!(
        "{}::{}::{}::{}::{}::{:.3}::{:.3}::{:.3}::{}",
        row.zone_name.to_lowercase(),
        row.encounter_name.to_lowercase(),
        row.difficulty.to_lowercase(),
        row.start_time.unwrap_or(0),
        row.report_code.clone().unwrap_or_default().to_lowercase(),
        row.percentile.unwrap_or(-1.0),
        row.dps.unwrap_or(-1.0),
        row.fastest_kill_seconds.unwrap_or(-1.0),
        row.kills.unwrap_or(-1)
    )
}

fn to_stored_parse(mode: ParseMode, row: &WarcraftLogsParse) -> WarcraftLogsStoredParse {
    WarcraftLogsStoredParse {
        mode: match mode {
            ParseMode::Raid => "raid".to_string(),
            ParseMode::MythicPlus => "mythic_plus".to_string(),
        },
        dedupe_key: parse_dedupe_key(row),
        expansion: row.expansion.clone(),
        season: row.season.clone(),
        raid_name: row.raid_name.clone(),
        raid_group: row.raid_group.clone(),
        zone_name: row.zone_name.clone(),
        encounter_name: row.encounter_name.clone(),
        difficulty: row.difficulty.clone(),
        percentile: row.percentile,
        dps: row.dps,
        median_percentile: row.median_percentile,
        attempts: row.attempts,
        kills: row.kills,
        fastest_kill_seconds: row.fastest_kill_seconds,
        all_stars_points: row.all_stars_points,
        all_stars_rank: row.all_stars_rank,
        report_code: row.report_code.clone(),
        report_title: row.report_title.clone(),
        report_end_time: row.report_end_time,
        start_time: row.start_time,
        locked_in: row.locked_in,
    }
}

fn from_stored_parse(row: &WarcraftLogsStoredParse) -> WarcraftLogsParse {
    WarcraftLogsParse {
        expansion: row.expansion.clone(),
        season: row.season.clone(),
        raid_name: row.raid_name.clone(),
        raid_group: row.raid_group.clone(),
        zone_name: row.zone_name.clone(),
        encounter_name: row.encounter_name.clone(),
        difficulty: row.difficulty.clone(),
        percentile: row.percentile,
        dps: row.dps,
        median_percentile: row.median_percentile,
        attempts: row.attempts,
        kills: row.kills,
        fastest_kill_seconds: row.fastest_kill_seconds,
        all_stars_points: row.all_stars_points,
        all_stars_rank: row.all_stars_rank,
        report_code: row.report_code.clone(),
        report_title: row.report_title.clone(),
        report_end_time: row.report_end_time,
        start_time: row.start_time,
        locked_in: row.locked_in,
    }
}

#[derive(Deserialize)]
struct WarcraftLogsTokenResponse {
    access_token: String,
}

#[derive(Deserialize)]
pub struct WarcraftLogsPath {
    pub realm: String,
    pub name: String,
}

fn normalize_realm_slug(raw: &str) -> String {
    raw.trim()
        .to_lowercase()
        .replace('\'', "")
        .replace(' ', "-")
}

fn normalize_character_name(raw: &str) -> String {
    raw.trim().to_lowercase()
}

const WCL_ENDPOINT_CACHE_TTL_MS: i64 = 20 * 60 * 1000;

#[derive(Clone)]
struct WarcraftLogsEndpointCacheEntry {
    fetched_at_ms: i64,
    payload: Value,
}

static WCL_ENDPOINT_CACHE: OnceLock<Mutex<HashMap<String, WarcraftLogsEndpointCacheEntry>>> =
    OnceLock::new();

fn wcl_endpoint_cache() -> &'static Mutex<HashMap<String, WarcraftLogsEndpointCacheEntry>> {
    WCL_ENDPOINT_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn now_epoch_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn normalize_epoch_ms(ts: i64) -> Option<i64> {
    if ts <= 0 {
        return None;
    }
    // Accept seconds and milliseconds.
    if ts < 10_000_000_000 {
        return Some(ts.saturating_mul(1000));
    }
    Some(ts)
}

fn extract_time_field_ms(value: &Value, keys: &[&str]) -> Option<i64> {
    let obj = value.as_object()?;
    for key in keys {
        if let Some(raw) = obj.get(*key) {
            let parsed = parse_i64(Some(raw))
                .or_else(|| parse_string(Some(raw)).and_then(|s| s.parse::<i64>().ok()));
            if let Some(ms) = parsed.and_then(normalize_epoch_ms) {
                return Some(ms);
            }
        }
    }
    None
}

fn auto_mplus_season_window_ms() -> (Option<i64>, Option<i64>) {
    let runtime = crate::item_db::get_runtime_data();
    let season = runtime.get("season_api_data").cloned().unwrap_or(Value::Null);
    let start = extract_time_field_ms(
        &season,
        &[
            "start_timestamp",
            "startTime",
            "start_time",
            "season_start",
            "seasonStart",
        ],
    );
    let end = extract_time_field_ms(
        &season,
        &[
            "end_timestamp",
            "endTime",
            "end_time",
            "season_end",
            "seasonEnd",
        ],
    );
    (start, end)
}

fn map_region(raw: Option<&str>) -> &'static str {
    match raw.unwrap_or("us").trim().to_lowercase().as_str() {
        "us" => "US",
        "eu" => "EU",
        "kr" => "KR",
        "tw" => "TW",
        "cn" => "CN",
        _ => "US",
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ParseMode {
    Raid,
    MythicPlus,
}

fn parse_mode(raw: Option<&str>) -> ParseMode {
    match raw.unwrap_or("raid").trim().to_lowercase().as_str() {
        "mythic_plus" | "mythic-plus" | "mplus" | "mythic+" => ParseMode::MythicPlus,
        _ => ParseMode::Raid,
    }
}

fn extract_zone_rankings(value: &Value) -> Option<Value> {
    let raw = value
        .get("data")?
        .get("characterData")?
        .get("character")?
        .get("zoneRankings")?
        .clone();

    if let Some(s) = raw.as_str() {
        return serde_json::from_str::<Value>(s).ok();
    }
    Some(raw)
}

fn parse_number(v: Option<&Value>) -> Option<f64> {
    match v {
        Some(Value::Number(n)) => n.as_f64(),
        Some(Value::String(s)) => {
            let raw = s.trim().to_lowercase();
            if raw.is_empty() {
                return None;
            }
            let normalized = raw.replace(',', "");
            if let Ok(v) = normalized.parse::<f64>() {
                return Some(v);
            }
            let (factor, body) = if let Some(stripped) = normalized.strip_suffix('k') {
                (1000.0, stripped)
            } else if let Some(stripped) = normalized.strip_suffix('m') {
                (1_000_000.0, stripped)
            } else {
                (1.0, normalized.as_str())
            };
            body.parse::<f64>().ok().map(|v| v * factor)
        }
        _ => None,
    }
}

fn parse_i64(v: Option<&Value>) -> Option<i64> {
    match v {
        Some(Value::Number(n)) => n.as_i64(),
        Some(Value::String(s)) => s.parse::<i64>().ok(),
        _ => None,
    }
}

fn parse_string(v: Option<&Value>) -> Option<String> {
    match v {
        Some(Value::String(s)) => {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        None => None,
        _ => None,
    }
}

fn parse_bool(v: Option<&Value>) -> Option<bool> {
    match v {
        Some(Value::Bool(b)) => Some(*b),
        Some(Value::String(s)) => {
            let lower = s.trim().to_lowercase();
            if lower == "true" || lower == "1" {
                Some(true)
            } else if lower == "false" || lower == "0" {
                Some(false)
            } else {
                None
            }
        }
        Some(Value::Number(n)) => n.as_i64().map(|x| x != 0),
        _ => None,
    }
}

fn extract_season_label_from_text(values: &[&str]) -> Option<String> {
    for value in values {
        let lower = value.to_lowercase();
        if let Some(idx) = lower.find("season") {
            let rest = &lower[idx + "season".len()..];
            let digits: String = rest
                .chars()
                .skip_while(|c| c.is_whitespace() || *c == '-' || *c == '_')
                .take_while(|c| c.is_ascii_digit())
                .collect();
            if !digits.is_empty() {
                return Some(format!("Season {}", digits));
            }
        }
        for token in lower.split(|c: char| !c.is_ascii_alphanumeric()) {
            if let Some(digits) = token.strip_prefix('s') {
                if !digits.is_empty() && digits.chars().all(|c| c.is_ascii_digit()) {
                    return Some(format!("Season {}", digits));
                }
            }
        }
    }
    None
}

fn classify_wcl_metadata(
    mode: ParseMode,
    zone_name: &str,
    encounter_name: &str,
    difficulty: &str,
    report_title: Option<&str>,
) -> (Option<String>, Option<String>, Option<String>, Option<String>) {
    let title = report_title.unwrap_or("");
    let season = extract_season_label_from_text(&[zone_name, encounter_name, difficulty, title]);
    match mode {
        ParseMode::MythicPlus => (None, season, None, None),
        ParseMode::Raid => {
            let raid_name = if zone_name.trim().is_empty() || zone_name.eq_ignore_ascii_case("raid") {
                None
            } else {
                Some(zone_name.to_string())
            };
            (None, None, raid_name.clone(), raid_name)
        }
    }
}

fn difficulty_label(v: Option<&Value>) -> String {
    let raw = match v {
        Some(Value::Object(map)) => {
            let inner = map
                .get("id")
                .or_else(|| map.get("value"))
                .or_else(|| map.get("difficulty"))
                .or_else(|| map.get("code"))
                .or_else(|| map.get("name"))
                .or_else(|| map.get("type"));
            return difficulty_label(inner);
        }
        Some(Value::String(s)) => {
            let lowered = s.trim().to_lowercase();
            if lowered.is_empty() {
                return "Unknown".to_string();
            }
            if lowered.contains("raid_finder") || lowered == "lfr" || lowered.contains("finder") {
                return "LFR".to_string();
            }
            if lowered.contains("normal") {
                return "Normal".to_string();
            }
            if lowered.contains("heroic") {
                return "Heroic".to_string();
            }
            if lowered.contains("mythic") {
                return "Mythic".to_string();
            }
            lowered.parse::<i64>().ok()
        }
        _ => parse_i64(v),
    };

    match raw {
        // Retail raid difficulty IDs (WCL/WoW)
        Some(17) => "LFR".to_string(),
        Some(14) => "Normal".to_string(),
        Some(15) => "Heroic".to_string(),
        Some(16) => "Mythic".to_string(),
        // Lower legacy IDs are ambiguous across contexts; let caller fallback bucket decide.
        Some(1) | Some(2) | Some(3) | Some(4) | Some(5) => "Unknown".to_string(),
        Some(other) => format!("Difficulty {}", other),
        None => "Unknown".to_string(),
    }
}

fn parse_report_index(character_node: &Value) -> std::collections::HashMap<String, (String, i64)> {
    let mut out = std::collections::HashMap::new();
    let reports = character_node
        .get("recentReports")
        .and_then(|v| v.get("data"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    for report in reports {
        let code = report
            .get("code")
            .and_then(Value::as_str)
            .map(|s| s.trim().to_string());
        let title = report
            .get("title")
            .and_then(Value::as_str)
            .map(|s| s.to_string())
            .unwrap_or_default();
        let end_time = parse_i64(report.get("endTime")).unwrap_or(0);
        if let Some(c) = code.filter(|s| !s.is_empty()) {
            out.insert(c, (title, end_time));
        }
    }

    out
}

fn parse_report_fights(
    report_node: &Value,
    report_code: &str,
    mode: ParseMode,
    requested_character_name: &str,
    requested_realm_slug: &str,
) -> Vec<WarcraftLogsParse> {
    let report_title = parse_string(report_node.get("title"));
    let report_start_time = parse_i64(report_node.get("startTime"));
    let report_end_time = parse_i64(report_node.get("endTime"));
    let zone_name = parse_string(report_node.get("zone").and_then(|z| z.get("name")))
        .unwrap_or_else(|| match mode {
            ParseMode::Raid => "Raid".to_string(),
            ParseMode::MythicPlus => "Dungeon".to_string(),
        });
    let fights = report_node
        .get("fights")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    // Report fights are report-scoped, not character-scoped.
    // Only keep fights where the requested character appears in fight participants.
    let requested_name_norm = normalize_character_name(requested_character_name);
    let requested_realm_norm = normalize_realm_slug(requested_realm_slug);
    let mut character_actor_ids: HashSet<i64> = HashSet::new();
    let actors = report_node
        .get("masterData")
        .and_then(|v| v.get("actors"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    for actor in actors {
        let Some(actor_id) = parse_i64(actor.get("id")) else {
            continue;
        };
        let actor_name = parse_string(actor.get("name")).unwrap_or_default();
        let actor_server = parse_string(actor.get("server")).unwrap_or_default();
        if normalize_character_name(&actor_name) == requested_name_norm
            && normalize_realm_slug(&actor_server) == requested_realm_norm
        {
            character_actor_ids.insert(actor_id);
        }
    }

    let mut out = Vec::new();
    for fight in fights {
        if character_actor_ids.is_empty() {
            continue;
        }
        let participant_ids = fight
            .get("friendlyPlayers")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let has_character_participation = participant_ids.iter().any(|v| {
            parse_i64(Some(v))
                .map(|id| character_actor_ids.contains(&id))
                .unwrap_or(false)
        });
        if !has_character_participation {
            continue;
        }

        let encounter_name = parse_string(fight.get("name"))
            .or_else(|| parse_string(fight.get("encounterName")))
            .or_else(|| parse_string(fight.get("encounter_name")))
            .or_else(|| {
                fight
                    .get("encounter")
                    .and_then(|v| parse_string(v.get("name")))
            })
            .unwrap_or_else(|| "Encounter".to_string());

        let keystone_level = parse_i64(fight.get("keystoneLevel"))
            .or_else(|| parse_i64(fight.get("keystone_level")));
        let encounter_id = parse_i64(fight.get("encounterID"))
            .or_else(|| parse_i64(fight.get("encounterId")))
            .unwrap_or(0);
        let fight_difficulty = parse_i64(fight.get("difficulty"));
        let difficulty = match mode {
            ParseMode::Raid => {
                if keystone_level.is_some() || encounter_id == 0 || fight_difficulty.is_none() {
                    continue;
                }
                let raid_diff = match parse_i64(fight.get("difficulty")) {
                    Some(17) | Some(1) => "LFR".to_string(),
                    Some(14) | Some(3) => "Normal".to_string(),
                    Some(15) | Some(4) => "Heroic".to_string(),
                    Some(16) | Some(5) => "Mythic".to_string(),
                    _ => difficulty_label(fight.get("difficulty")),
                };
                if !matches!(raid_diff.as_str(), "LFR" | "Normal" | "Heroic" | "Mythic") {
                    continue;
                }
                raid_diff
            }
            ParseMode::MythicPlus => {
                if keystone_level.is_none() {
                    continue;
                }
                let level = keystone_level.unwrap_or(0);
                if level <= 0 || level > 40 {
                    continue;
                }
                format!("M+{}", level)
            }
        };

        let raw_start_time = parse_i64(fight.get("startTime"))
            .or_else(|| parse_i64(fight.get("start_time")));
        let raw_end_time = parse_i64(fight.get("endTime"))
            .or_else(|| parse_i64(fight.get("end_time")));

        // WCL report fights often return times relative to report start; convert to epoch ms.
        let start_time = match (raw_start_time, report_start_time) {
            (Some(ts), Some(base)) if ts > 0 && ts < 10_000_000_000 => Some(base + ts),
            (v, _) => v,
        };
        let end_time = match (raw_end_time, report_start_time) {
            (Some(ts), Some(base)) if ts > 0 && ts < 10_000_000_000 => Some(base + ts),
            (Some(ts), _) => Some(ts),
            (None, _) => report_end_time,
        };
        let fastest_kill_seconds = match (start_time, end_time) {
            (Some(start), Some(end)) if end > start => Some((end - start) as f64 / 1000.0),
            _ => None,
        };

        let kill = parse_bool(fight.get("kill"))
            .or_else(|| parse_bool(fight.get("killed")))
            .unwrap_or(false);

        let (expansion, season, raid_name, raid_group) = classify_wcl_metadata(
            mode,
            &zone_name,
            &encounter_name,
            &difficulty,
            report_title.as_deref(),
        );
        out.push(WarcraftLogsParse {
            expansion,
            season,
            raid_name,
            raid_group,
            zone_name: zone_name.clone(),
            encounter_name,
            difficulty,
            percentile: None,
            dps: None,
            median_percentile: None,
            attempts: Some(1),
            kills: Some(if kill { 1 } else { 0 }),
            fastest_kill_seconds,
            all_stars_points: None,
            all_stars_rank: None,
            report_code: Some(report_code.to_string()),
            report_title: report_title.clone(),
            report_end_time,
            start_time,
            locked_in: Some(true),
        });
    }

    out
}

fn parse_parses(
    zone_rankings: &Value,
    report_index: &std::collections::HashMap<String, (String, i64)>,
    fallback_difficulty: Option<&str>,
    mode: ParseMode,
) -> Vec<WarcraftLogsParse> {
    let rankings = zone_rankings
        .get("rankings")
        .and_then(Value::as_array)
        .cloned()
        .or_else(|| zone_rankings.as_array().cloned())
        .unwrap_or_default();

    let default_zone_name = parse_string(zone_rankings.get("zoneName"))
        .or_else(|| parse_string(zone_rankings.get("zone")))
        .or_else(|| {
            zone_rankings
                .get("zone")
                .and_then(|z| z.get("name"))
                .and_then(Value::as_str)
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| "Raid".to_string());
    let default_difficulty = difficulty_label(zone_rankings.get("difficulty"));

    let mut parses = Vec::new();
    for row in rankings {
        let zone_name = parse_string(row.get("zoneName"))
            .or_else(|| parse_string(row.get("zone")))
            .or_else(|| parse_string(row.get("zone_name")))
            .or_else(|| {
                row.get("zone")
                    .and_then(|z| z.get("name"))
                    .and_then(Value::as_str)
                    .map(|s| s.to_string())
            })
            .unwrap_or_else(|| default_zone_name.clone());

        let encounter_name = parse_string(row.get("name"))
            .or_else(|| parse_string(row.get("encounterName")))
            .or_else(|| parse_string(row.get("encounter_name")))
            .or_else(|| parse_string(row.get("boss")))
            .or_else(|| {
                row.get("encounter")
                    .and_then(|v| v.get("name"))
                    .and_then(Value::as_str)
                    .map(|s| s.to_string())
            })
            .or_else(|| {
                row.get("fight")
                    .and_then(|v| v.get("name"))
                    .and_then(Value::as_str)
                    .map(|s| s.to_string())
            })
            .unwrap_or_else(|| "Encounter".to_string());

        let percentile = parse_number(row.get("rankPercent"))
            .or_else(|| parse_number(row.get("percentile")))
            .or_else(|| parse_number(row.get("bestPercent")))
            .or_else(|| parse_number(row.get("best_percent")));
        let median_percentile = parse_number(row.get("medianPercent"))
            .or_else(|| parse_number(row.get("median_percent")))
            .or_else(|| parse_number(row.get("median")));

        let dps = parse_number(row.get("latestAmount"))
            .or_else(|| parse_number(row.get("latestDps")))
            .or_else(|| parse_number(row.get("amount")))
            .or_else(|| parse_number(row.get("total")))
            .or_else(|| parse_number(row.get("dps")))
            .or_else(|| parse_number(row.get("bestAmount")))
            .or_else(|| parse_number(row.get("bestDps")))
            .or_else(|| parse_number(row.get("highestDps")))
            .or_else(|| parse_number(row.get("topDps")));
        let attempts = parse_i64(row.get("attempts"))
            .or_else(|| parse_i64(row.get("totalPulls")))
            .or_else(|| parse_i64(row.get("pulls")))
            .or_else(|| parse_i64(row.get("totalAttempts")))
            .or_else(|| parse_i64(row.get("tries")));
        let kills = parse_i64(row.get("kills"))
            .or_else(|| parse_i64(row.get("totalKills")))
            .or_else(|| parse_i64(row.get("killCount")));
        let fastest_ms = parse_number(row.get("fastestKill"))
            .or_else(|| parse_number(row.get("fastest")))
            .or_else(|| parse_number(row.get("bestDuration")))
            .or_else(|| parse_number(row.get("duration")));
        let fastest_kill_seconds = fastest_ms.map(|v| if v > 1000.0 { v / 1000.0 } else { v });
        let all_stars_points = parse_number(row.get("points"))
            .or_else(|| parse_number(row.get("allStarsPoints")))
            .or_else(|| parse_number(row.get("all_stars_points")));
        let all_stars_rank = parse_i64(row.get("rank"))
            .or_else(|| parse_i64(row.get("allStarsRank")))
            .or_else(|| parse_i64(row.get("all_stars_rank")));

        let report_code = row
            .get("reportID")
            .and_then(Value::as_str)
            .or_else(|| row.get("reportCode").and_then(Value::as_str))
            .or_else(|| row.get("code").and_then(Value::as_str))
            .map(|s| s.to_string());

        let start_time = parse_i64(row.get("startTime")).or_else(|| parse_i64(row.get("fightStart")));
        let (report_title, report_end_time) = report_code
            .as_ref()
            .and_then(|code| report_index.get(code))
            .map(|(title, end)| (Some(title.clone()), Some(*end)))
            .unwrap_or((None, None));

        let row_difficulty = difficulty_label(row.get("difficulty"));
        let normalized_difficulty = match mode {
            ParseMode::Raid => {
                if matches!(row_difficulty.as_str(), "LFR" | "Normal" | "Heroic" | "Mythic") {
                    row_difficulty.clone()
                } else if let Some(fallback) = fallback_difficulty {
                    fallback.to_string()
                } else if default_difficulty != "Unknown" {
                    default_difficulty.clone()
                } else {
                    row_difficulty
                }
            }
            ParseMode::MythicPlus => {
                // Normalize Mythic+ key representation to a stable "M+N" format.
                let key_level = parse_i64(row.get("keystoneLevel"))
                    .or_else(|| parse_i64(row.get("keystone_level")))
                    .or_else(|| parse_i64(row.get("difficulty")))
                    .or_else(|| parse_i64(row.get("keyLevel")))
                    .or_else(|| parse_i64(row.get("key_level")));
                if let Some(n) = key_level.filter(|n| *n > 0 && *n <= 50) {
                    format!("M+{}", n)
                } else {
                    // Keep original label so frontend can still parse keys from textual fields.
                    row_difficulty
                }
            }
        };

        let locked_in = parse_bool(row.get("lockedIn"))
            .or_else(|| parse_bool(row.get("locked_in")))
            .or_else(|| parse_bool(row.get("isLockedIn")));

        let (expansion, season, raid_name, raid_group) = classify_wcl_metadata(
            mode,
            &zone_name,
            &encounter_name,
            &normalized_difficulty,
            report_title.as_deref(),
        );
        parses.push(WarcraftLogsParse {
            expansion,
            season,
            raid_name,
            raid_group,
            zone_name,
            encounter_name,
            difficulty: normalized_difficulty,
            percentile,
            dps,
            median_percentile,
            attempts: attempts.or(kills),
            kills,
            fastest_kill_seconds,
            all_stars_points,
            all_stars_rank,
            report_code,
            report_title,
            report_end_time,
            start_time,
            locked_in,
        });
    }

    parses.sort_by(|a, b| {
        b.start_time
            .unwrap_or(0)
            .cmp(&a.start_time.unwrap_or(0))
            .then_with(|| {
                b.percentile
                    .unwrap_or(0.0)
                    .partial_cmp(&a.percentile.unwrap_or(0.0))
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
    });
    parses.truncate(200);
    parses
}

pub async fn proxy_character_raid_parses(
    req: HttpRequest,
    path: web::Path<WarcraftLogsPath>,
    query: web::Query<WarcraftLogsQuery>,
    auth_state: web::Data<Arc<BlizzardAuthState>>,
    store: web::Data<Arc<dyn crate::storage::JobStorage>>,
) -> HttpResponse {
    let debug_raw = query.debug_raw.unwrap_or(false);
    let mode = parse_mode(query.mode.as_deref());
    let claims = match verify_jwt(&req, &auth_state.jwt_secret) {
        Some(c) => c,
        None => {
            let mut payload = json!({
                "configured": false,
                "needs_credentials": true,
                "parses": [],
                "message": "Please sign in and set your Warcraft Logs Client ID and Client Secret in Settings > Integrations."
            });
            if debug_raw {
                payload["debug_meta"] = json!({
                    "reason": "missing_jwt_or_signin",
                    "requested_mode": query.mode.clone().unwrap_or_else(|| "raid".to_string()),
                    "requested_region": query.region.clone().unwrap_or_else(|| "us".to_string()),
                });
                payload["debug_raw"] = json!([]);
            }
            return HttpResponse::Ok().json(payload)
        }
    };

    let client_id = store
        .get_user_config(&claims.sub, "warcraftlogs_client_id")
        .unwrap_or_default();
    let client_secret = store
        .get_user_config(&claims.sub, "warcraftlogs_client_secret")
        .unwrap_or_default();

    if client_id.trim().is_empty() || client_secret.trim().is_empty() {
        let mut payload = json!({
            "configured": false,
            "needs_credentials": true,
            "parses": [],
            "message": "Warcraft Logs credentials are missing. Add Client ID and Client Secret in Settings > Integrations."
        });
        if debug_raw {
            payload["debug_meta"] = json!({
                "reason": "missing_warcraftlogs_credentials",
                "has_client_id": !client_id.trim().is_empty(),
                "has_client_secret": !client_secret.trim().is_empty(),
            });
            payload["debug_raw"] = json!([]);
        }
        return HttpResponse::Ok().json(payload);
    }

    let region = map_region(query.region.as_deref());
    let realm = normalize_realm_slug(&path.realm);
    let name = path.name.trim().to_string();
    let parse_filter = WarcraftLogsParseFilter {
        expansion: normalize_optional_filter(query.selected_expansion.as_deref()),
        season: normalize_optional_filter(query.selected_season.as_deref()),
        raid_name: normalize_optional_filter(query.selected_raid_name.as_deref()),
        raid_group: normalize_optional_filter(query.raid_group_filter.as_deref()),
    };
    let force_refresh = query.refresh.unwrap_or(false);
    let cache_key = format!(
        "{}::{}::{}::{}::{}",
        claims.sub,
        match mode {
            ParseMode::Raid => "raid",
            ParseMode::MythicPlus => "mythic_plus",
        },
        region,
        realm,
        name.to_lowercase()
    );

    if !debug_raw && !force_refresh {
        if let Ok(cache) = wcl_endpoint_cache().lock() {
            if let Some(entry) = cache.get(&cache_key) {
                let now = now_epoch_ms();
                if now - entry.fetched_at_ms <= WCL_ENDPOINT_CACHE_TTL_MS {
                    return HttpResponse::Ok().json(entry.payload.clone());
                }
            }
        }
        let db_rows = store.get_wcl_parses_filtered(
            &claims.sub,
            &region.to_lowercase(),
            &realm,
            &name.to_lowercase(),
            match mode {
                ParseMode::Raid => "raid",
                ParseMode::MythicPlus => "mythic_plus",
            },
            &parse_filter,
        );
        if !db_rows.is_empty() {
            let payload = json!({
                "configured": true,
                "needs_credentials": false,
                "parses": db_rows.iter().map(from_stored_parse).collect::<Vec<_>>()
            });
            if let Ok(mut cache) = wcl_endpoint_cache().lock() {
                cache.insert(
                    cache_key.clone(),
                    WarcraftLogsEndpointCacheEntry {
                        fetched_at_ms: now_epoch_ms(),
                        payload: payload.clone(),
                    },
                );
            }
            return HttpResponse::Ok().json(payload);
        }
    }

    let client = reqwest::Client::new();
    let token_res = client
        .post("https://www.warcraftlogs.com/oauth/token")
        .basic_auth(client_id.trim(), Some(client_secret.trim()))
        .form(&[("grant_type", "client_credentials")])
        .send()
        .await;

    let token = match token_res {
        Ok(resp) if resp.status().is_success() => match resp.json::<WarcraftLogsTokenResponse>().await {
            Ok(parsed) => parsed.access_token,
            Err(_) => {
                return HttpResponse::Ok().json(json!({
                    "configured": true,
                    "needs_credentials": false,
                    "parses": [],
                    "error": "Unable to parse Warcraft Logs OAuth token response."
                }))
            }
        },
        Ok(resp) => {
            let status = resp.status().as_u16();
            return HttpResponse::Ok().json(json!({
                "configured": true,
                "needs_credentials": false,
                "parses": [],
                "error": format!("Warcraft Logs OAuth failed with status {}.", status)
            }));
        }
        Err(err) => {
            return HttpResponse::Ok().json(json!({
                "configured": true,
                "needs_credentials": false,
                "parses": [],
                "error": format!("Warcraft Logs OAuth request failed: {}", err)
            }))
        }
    };

    let graphql_query_reports = r#"
query CharacterReports($name: String!, $serverSlug: String!, $serverRegion: String!, $startTime: Float, $endTime: Float, $page: Int!) {
  characterData {
    character(name: $name, serverSlug: $serverSlug, serverRegion: $serverRegion) {
      name
      recentReports(limit: 100, page: $page, startTime: $startTime, endTime: $endTime) {
        data {
          code
          title
          endTime
        }
      }
    }
  }
}
"#;

    let graphql_query_by_difficulty = r#"
query CharacterParsesByDifficulty($name: String!, $serverSlug: String!, $serverRegion: String!, $difficulty: Int) {
  characterData {
    character(name: $name, serverSlug: $serverSlug, serverRegion: $serverRegion) {
      zoneRankings(difficulty: $difficulty)
    }
  }
}
"#;

    let graphql_query_report_fights = r#"
query ReportFights($code: String!) {
  reportData {
    report(code: $code) {
      title
      startTime
      endTime
      zone {
        name
      }
      masterData {
        actors {
          id
          name
          server
          type
          subType
        }
      }
      fights {
        id
        encounterID
        name
        difficulty
        keystoneLevel
        friendlyPlayers
        kill
        startTime
        endTime
      }
    }
  }
}
"#;

    // Use retail endpoints for retail raid and Mythic+ data.
    let graphql_hosts = ["https://www.warcraftlogs.com/api/v2/client"];

    let mut last_error: Option<String> = None;
    let mut debug_raw_payloads: Vec<Value> = Vec::new();

    let requested_season_start_ms = query.season_start_ms.filter(|v| *v > 0);
    let requested_season_end_ms = query.season_end_ms.filter(|v| *v > 0);
    let (auto_season_start_ms, auto_season_end_ms) = if mode == ParseMode::MythicPlus {
        auto_mplus_season_window_ms()
    } else {
        (None, None)
    };
    let season_start_ms = requested_season_start_ms.or(auto_season_start_ms);
    let season_end_ms = requested_season_end_ms.or(auto_season_end_ms);
    let stored_existing = store.get_wcl_parses(
        &claims.sub,
        &region.to_lowercase(),
        &realm,
        &name.to_lowercase(),
        match mode {
            ParseMode::Raid => "raid",
            ParseMode::MythicPlus => "mythic_plus",
        },
    );
    let now_ms = now_epoch_ms();
    let last_known_report_end_ms = stored_existing
        .iter()
        .filter_map(|r| r.report_end_time.and_then(normalize_epoch_ms))
        .filter(|ts| *ts <= now_ms + 24 * 60 * 60 * 1000)
        .max();
    let incremental_start_ms = if mode == ParseMode::MythicPlus {
        last_known_report_end_ms.map(|v| v + 1)
    } else {
        None
    };
    let start_time_ms = if debug_raw {
        season_start_ms
    } else if force_refresh {
        season_start_ms
    } else {
        incremental_start_ms.or(season_start_ms)
    };
    let end_time_ms = season_end_ms;

    let mut report_body: Option<Value> = None;
    let mut merged_reports: Vec<Value> = Vec::new();
    let mut merged_template: Option<Value> = None;
    for page in 1..=50_i64 {
        let mut page_body: Option<Value> = None;
        for host in graphql_hosts {
            let graphql_payload = json!({
                "query": graphql_query_reports,
                "variables": {
                    "name": name,
                    "serverSlug": realm,
                    "serverRegion": region,
                    "startTime": start_time_ms,
                    "endTime": end_time_ms,
                    "page": page
                }
            });

            let attempt = client
                .post(host)
                .bearer_auth(&token)
                .header("accept", "application/json")
                .json(&graphql_payload)
                .send()
                .await;

            match attempt {
                Ok(resp) if resp.status().is_success() => match resp.json::<Value>().await {
                    Ok(v) => {
                        let has_graphql_errors = v
                            .get("errors")
                            .and_then(Value::as_array)
                            .map(|arr| !arr.is_empty())
                            .unwrap_or(false);
                        if debug_raw {
                            debug_raw_payloads.push(json!({
                                "bucket": "reports-index",
                                "host": host,
                                "page": page,
                                "variables": {
                                    "name": name,
                                    "serverSlug": realm,
                                    "serverRegion": region,
                                    "startTime": start_time_ms,
                                    "endTime": end_time_ms,
                                    "page": page,
                                },
                                "response": v.clone(),
                            }));
                        }
                        if !has_graphql_errors {
                            page_body = Some(v);
                            break;
                        }
                        if debug_raw {
                            debug_raw_payloads.push(json!({
                                "bucket": "reports-index",
                                "host": host,
                                "page": page,
                                "graphql_errors": v.get("errors").cloned().unwrap_or(Value::Null),
                            }));
                        }
                        last_error = Some(format!("{} reports query returned GraphQL errors", host));
                    }
                    Err(err) => {
                        if debug_raw {
                            debug_raw_payloads.push(json!({
                                "bucket": "reports-index",
                                "host": host,
                                "page": page,
                                "error": format!("invalid_json: {}", err),
                            }));
                        }
                        last_error = Some(format!("{} returned an invalid JSON response: {}", host, err));
                    }
                },
                Ok(resp) => {
                    let status = resp.status().as_u16();
                    if debug_raw {
                        debug_raw_payloads.push(json!({
                            "bucket": "reports-index",
                            "host": host,
                            "page": page,
                            "status": status,
                        }));
                    }
                    last_error = Some(format!("{} returned status {}", host, status));
                }
                Err(err) => {
                    if debug_raw {
                        debug_raw_payloads.push(json!({
                            "bucket": "reports-index",
                            "host": host,
                            "page": page,
                            "error": format!("request_failed: {}", err),
                        }));
                    }
                    last_error = Some(format!("{} request failed: {}", host, err));
                }
            }
        }

        let Some(body) = page_body else {
            break;
        };
        if merged_template.is_none() {
            merged_template = Some(body.clone());
        }
        let page_reports = body
            .get("data")
            .and_then(|v| v.get("characterData"))
            .and_then(|v| v.get("character"))
            .and_then(|v| v.get("recentReports"))
            .and_then(|v| v.get("data"))
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        if page_reports.is_empty() {
            break;
        }
        let count = page_reports.len();
        merged_reports.extend(page_reports);
        if count < 100 {
            break;
        }
    }
    if let Some(mut body) = merged_template {
        if let Some(data) = body
            .get_mut("data")
            .and_then(|v| v.get_mut("characterData"))
            .and_then(|v| v.get_mut("character"))
            .and_then(|v| v.get_mut("recentReports"))
            .and_then(|v| v.get_mut("data"))
        {
            *data = Value::Array(merged_reports);
        }
        report_body = Some(body);
    }

    let report_body = match report_body {
        Some(v) => v,
        None => {
            if !debug_raw {
                let stored = store.get_wcl_parses_filtered(
                    &claims.sub,
                    &region.to_lowercase(),
                    &realm,
                    &name.to_lowercase(),
                    match mode {
                        ParseMode::Raid => "raid",
                        ParseMode::MythicPlus => "mythic_plus",
                    },
                    &parse_filter,
                );
                if !stored.is_empty() {
                    return HttpResponse::Ok().json(json!({
                        "configured": true,
                        "needs_credentials": false,
                        "parses": stored.iter().map(from_stored_parse).collect::<Vec<_>>()
                    }));
                }
            }
            let mut payload = json!({
                "configured": true,
                "needs_credentials": false,
                "parses": [],
                "error": last_error.unwrap_or_else(|| "Failed to fetch Warcraft Logs reports.".to_string())
            });
            if debug_raw {
                payload["debug_raw"] = Value::Array(debug_raw_payloads.clone());
                payload["debug_meta"] = json!({
                    "requested_region": query.region.clone().unwrap_or_else(|| "us".to_string()),
                    "resolved_region": region,
                    "requested_mode": query.mode.clone().unwrap_or_else(|| "raid".to_string()),
                    "resolved_mode": match mode {
                        ParseMode::Raid => "raid",
                        ParseMode::MythicPlus => "mythic_plus",
                    },
                    "character": {
                        "realm_slug": realm,
                        "name": name,
                    },
                    "graphql_hosts": graphql_hosts,
                });
            }
            return HttpResponse::Ok().json(payload)
        }
    };

    let character_node = report_body
        .get("data")
        .and_then(|v| v.get("characterData"))
        .and_then(|v| v.get("character"))
        .cloned()
        .unwrap_or(Value::Null);
    let report_index = parse_report_index(&character_node);

    let mut combined_parses: Vec<WarcraftLogsParse> = Vec::new();
    let mut seen_rows = std::collections::HashSet::<String>::new();
    if mode == ParseMode::Raid {
        let buckets: Vec<(&str, Vec<Option<i64>>)> = vec![
            ("LFR", vec![Some(1), Some(17)]),
            ("Normal", vec![Some(3), Some(14), Some(2)]),
            ("Heroic", vec![Some(4), Some(15)]),
            ("Mythic", vec![Some(5), Some(16)]),
        ];

        for (bucket_label, candidates) in buckets {
            let mut bucket_rows: Vec<WarcraftLogsParse> = Vec::new();
            for candidate in candidates {
                let mut body_for_candidate: Option<Value> = None;
                for host in graphql_hosts {
                    let graphql_payload = json!({
                        "query": graphql_query_by_difficulty,
                        "variables": {
                            "name": name,
                            "serverSlug": realm,
                            "serverRegion": region,
                            "difficulty": candidate
                        }
                    });
                    let attempt = client
                        .post(host)
                        .bearer_auth(&token)
                        .header("accept", "application/json")
                        .json(&graphql_payload)
                        .send()
                        .await;
                    match attempt {
                        Ok(resp) if resp.status().is_success() => match resp.json::<Value>().await {
                        Ok(v) => {
                            let has_graphql_errors = v
                                .get("errors")
                                .and_then(Value::as_array)
                                .map(|arr| !arr.is_empty())
                                .unwrap_or(false);
                            if debug_raw {
                                debug_raw_payloads.push(json!({
                                    "bucket": bucket_label,
                                    "difficulty_candidate": candidate,
                                    "host": host,
                                    "response": v.clone(),
                                }));
                            }
                            if !has_graphql_errors {
                                body_for_candidate = Some(v);
                                break;
                            }
                            }
                            Err(err) => {
                                if debug_raw {
                                    debug_raw_payloads.push(json!({
                                        "bucket": bucket_label,
                                        "difficulty_candidate": candidate,
                                        "host": host,
                                        "error": format!("invalid_json: {}", err),
                                    }));
                                }
                            }
                        },
                        Ok(resp) => {
                            if debug_raw {
                                debug_raw_payloads.push(json!({
                                    "bucket": bucket_label,
                                    "difficulty_candidate": candidate,
                                    "host": host,
                                    "status": resp.status().as_u16(),
                                }));
                            }
                        }
                        Err(err) => {
                            if debug_raw {
                                debug_raw_payloads.push(json!({
                                    "bucket": bucket_label,
                                    "difficulty_candidate": candidate,
                                    "host": host,
                                    "error": format!("request_failed: {}", err),
                                }));
                            }
                        }
                    }
                }
                let Some(body) = body_for_candidate else {
                    continue;
                };
                if body.get("errors").is_some() {
                    continue;
                }
                let Some(zone_rankings) = extract_zone_rankings(&body) else {
                    continue;
                };
            let mut parses = parse_parses(&zone_rankings, &report_index, Some(bucket_label), mode);
                parses.retain(|row| row.difficulty.eq_ignore_ascii_case(bucket_label));
                if parses.is_empty() {
                    continue;
                }
                bucket_rows = parses;
                break;
            }

            for row in bucket_rows {
                let dedupe_key = parse_dedupe_key(&row);
                if seen_rows.insert(dedupe_key) {
                    combined_parses.push(row);
                }
            }
        }
    }

    if mode == ParseMode::Raid && combined_parses.is_empty() {
        let mut fallback_body: Option<Value> = None;
        for host in graphql_hosts {
            let graphql_payload = json!({
                "query": graphql_query_by_difficulty,
                "variables": {
                    "name": name,
                    "serverSlug": realm,
                    "serverRegion": region,
                    "difficulty": Value::Null
                }
            });
            let attempt = client
                .post(host)
                .bearer_auth(&token)
                .header("accept", "application/json")
                .json(&graphql_payload)
                .send()
                .await;
            match attempt {
                Ok(resp) if resp.status().is_success() => match resp.json::<Value>().await {
                    Ok(v) => {
                        let has_graphql_errors = v
                            .get("errors")
                            .and_then(Value::as_array)
                .map(|arr| !arr.is_empty())
                .unwrap_or(false);
            if !has_graphql_errors {
                if debug_raw {
                    debug_raw_payloads.push(json!({
                        "bucket": "fallback-all",
                        "difficulty_candidate": Value::Null,
                        "host": host,
                        "response": v.clone(),
                    }));
                }
                fallback_body = Some(v);
                break;
            }
                    }
                    Err(_err) => {}
                },
                Ok(resp) => {
                    if debug_raw {
                        debug_raw_payloads.push(json!({
                            "bucket": "fallback-all",
                            "difficulty_candidate": Value::Null,
                            "host": host,
                            "status": resp.status().as_u16(),
                        }));
                    }
                }
                Err(err) => {
                    if debug_raw {
                        debug_raw_payloads.push(json!({
                            "bucket": "fallback-all",
                            "difficulty_candidate": Value::Null,
                            "host": host,
                            "error": format!("request_failed: {}", err),
                        }));
                    }
                }
            }
        }
        if let Some(body) = fallback_body {
            if body.get("errors").is_none() {
                if let Some(zone_rankings) = extract_zone_rankings(&body) {
                    let mut parses = parse_parses(&zone_rankings, &report_index, None, mode);
                    if mode == ParseMode::Raid {
                        parses.retain(|row| {
                            matches!(row.difficulty.as_str(), "LFR" | "Normal" | "Heroic" | "Mythic")
                        });
                    } else {
                        parses.retain(|row| {
                            !matches!(row.difficulty.as_str(), "LFR" | "Normal" | "Heroic" | "Mythic")
                        });
                    }
                    combined_parses.append(&mut parses);
                }
            }
        }
    }

    // Add per-report fight rows so the frontend can expand bosses into recent parse history.
    // zoneRankings provides aggregate rows only; report fights provide the per-attempt timeline.
    if !report_index.is_empty() {
        for (report_code, _) in &report_index {
            let mut report_body: Option<Value> = None;
            for host in graphql_hosts {
                let graphql_payload = json!({
                    "query": graphql_query_report_fights,
                    "variables": {
                        "code": report_code
                    }
                });
                let attempt = client
                    .post(host)
                    .bearer_auth(&token)
                    .header("accept", "application/json")
                    .json(&graphql_payload)
                    .send()
                    .await;

                match attempt {
                    Ok(resp) if resp.status().is_success() => match resp.json::<Value>().await {
                        Ok(v) => {
                            let has_graphql_errors = v
                                .get("errors")
                                .and_then(Value::as_array)
                                .map(|arr| !arr.is_empty())
                                .unwrap_or(false);
                            if debug_raw {
                                debug_raw_payloads.push(json!({
                                    "bucket": "report-fights",
                                    "report_code": report_code,
                                    "host": host,
                                    "response": v.clone(),
                                }));
                            }
                            if !has_graphql_errors {
                                report_body = Some(v);
                                break;
                            }
                        }
                        Err(_err) => {}
                    },
                    Ok(resp) => {
                        if resp.status().as_u16() != 404 {
                            break;
                        }
                    }
                    Err(_err) => {}
                }
            }

            let Some(body) = report_body else {
                continue;
            };
            let Some(report_node) = body
                .get("data")
                .and_then(|v| v.get("reportData"))
                .and_then(|v| v.get("report"))
            else {
                continue;
            };

            let report_fights = parse_report_fights(report_node, report_code, mode, &name, &realm);
            for row in report_fights {
                let dedupe_key = parse_dedupe_key(&row);
                if seen_rows.insert(dedupe_key) {
                    combined_parses.push(row);
                }
            }
        }
    }

    if combined_parses.is_empty() {
        if !debug_raw {
            let stored = store.get_wcl_parses_filtered(
                &claims.sub,
                &region.to_lowercase(),
                &realm,
                &name.to_lowercase(),
                match mode {
                    ParseMode::Raid => "raid",
                    ParseMode::MythicPlus => "mythic_plus",
                },
                &parse_filter,
            );
            if !stored.is_empty() {
                return HttpResponse::Ok().json(json!({
                    "configured": true,
                    "needs_credentials": false,
                    "parses": stored.iter().map(from_stored_parse).collect::<Vec<_>>()
                }));
            }
        }
        return HttpResponse::Ok().json(json!({
            "configured": true,
            "needs_credentials": false,
            "parses": [],
            "message": "No Warcraft Logs parse data found for this character."
        }));
    }

    if !debug_raw {
        let store_rows: Vec<WarcraftLogsStoredParse> =
            combined_parses.iter().map(|r| to_stored_parse(mode, r)).collect();
        store.upsert_wcl_parses(
            &claims.sub,
            &region.to_lowercase(),
            &realm,
            &name.to_lowercase(),
            match mode {
                ParseMode::Raid => "raid",
                ParseMode::MythicPlus => "mythic_plus",
            },
            &store_rows,
        );
        let stored = store.get_wcl_parses_filtered(
            &claims.sub,
            &region.to_lowercase(),
            &realm,
            &name.to_lowercase(),
            match mode {
                ParseMode::Raid => "raid",
                ParseMode::MythicPlus => "mythic_plus",
            },
            &parse_filter,
        );
        if !stored.is_empty() {
            combined_parses = stored.iter().map(from_stored_parse).collect();
        }
    }

    let mut payload = json!({
        "configured": true,
        "needs_credentials": false,
        "parses": combined_parses
    });
    if debug_raw {
        let generated_at_ms = now_epoch_ms();
        payload["debug_meta"] = json!({
            "requested_region": query.region.clone().unwrap_or_else(|| "us".to_string()),
            "resolved_region": region,
            "requested_mode": query.mode.clone().unwrap_or_else(|| "raid".to_string()),
            "resolved_mode": match mode {
                ParseMode::Raid => "raid",
                ParseMode::MythicPlus => "mythic_plus",
            },
            "character": {
                "realm_slug": realm,
                "name": name,
            },
            "graphql_hosts": graphql_hosts,
            "recent_report_count": report_index.len(),
            "report_window": {
                "start_time_ms": start_time_ms,
                "end_time_ms": end_time_ms,
                "season_start_ms": season_start_ms,
                "season_end_ms": season_end_ms,
                "requested_season_start_ms": requested_season_start_ms,
                "requested_season_end_ms": requested_season_end_ms,
                "auto_season_start_ms": auto_season_start_ms,
                "auto_season_end_ms": auto_season_end_ms,
                "last_known_report_end_ms": last_known_report_end_ms,
                "incremental_applied": mode == ParseMode::MythicPlus && !force_refresh,
            },
            "returned_parse_count": combined_parses.len(),
            "generated_at_ms": generated_at_ms,
        });
        payload["debug_raw"] = Value::Array(debug_raw_payloads);
    }

    if !debug_raw {
        if let Ok(mut cache) = wcl_endpoint_cache().lock() {
            cache.insert(
                cache_key,
                WarcraftLogsEndpointCacheEntry {
                    fetched_at_ms: now_epoch_ms(),
                    payload: payload.clone(),
                },
            );
        }
    }

    HttpResponse::Ok().json(payload)
}
