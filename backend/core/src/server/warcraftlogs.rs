use crate::server::auth_handlers::{verify_jwt, BlizzardAuthState};
use actix_web::{web, HttpRequest, HttpResponse};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;

#[derive(Deserialize)]
pub struct WarcraftLogsQuery {
    pub region: Option<String>,
    pub debug_raw: Option<bool>,
}

#[derive(Serialize)]
struct WarcraftLogsParse {
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

fn parse_parses(
    zone_rankings: &Value,
    report_index: &std::collections::HashMap<String, (String, i64)>,
    fallback_difficulty: Option<&str>,
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
        let normalized_difficulty = if matches!(row_difficulty.as_str(), "LFR" | "Normal" | "Heroic" | "Mythic")
        {
            row_difficulty.clone()
        } else if let Some(fallback) = fallback_difficulty {
            fallback.to_string()
        } else if default_difficulty != "Unknown" {
            default_difficulty.clone()
        } else {
            row_difficulty
        };

        let locked_in = parse_bool(row.get("lockedIn"))
            .or_else(|| parse_bool(row.get("locked_in")))
            .or_else(|| parse_bool(row.get("isLockedIn")));

        parses.push(WarcraftLogsParse {
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
    let claims = match verify_jwt(&req, &auth_state.jwt_secret) {
        Some(c) => c,
        None => {
            return HttpResponse::Ok().json(json!({
                "configured": false,
                "needs_credentials": true,
                "parses": [],
                "message": "Please sign in and set your Warcraft Logs Client ID and Client Secret in Settings > Integrations."
            }))
        }
    };

    let client_id = store
        .get_user_config(&claims.sub, "warcraftlogs_client_id")
        .unwrap_or_default();
    let client_secret = store
        .get_user_config(&claims.sub, "warcraftlogs_client_secret")
        .unwrap_or_default();

    if client_id.trim().is_empty() || client_secret.trim().is_empty() {
        return HttpResponse::Ok().json(json!({
            "configured": false,
            "needs_credentials": true,
            "parses": [],
            "message": "Warcraft Logs credentials are missing. Add Client ID and Client Secret in Settings > Integrations."
        }));
    }

    let region = map_region(query.region.as_deref());
    let realm = normalize_realm_slug(&path.realm);
    let name = path.name.trim().to_string();

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
query CharacterReports($name: String!, $serverSlug: String!, $serverRegion: String!) {
  characterData {
    character(name: $name, serverSlug: $serverSlug, serverRegion: $serverRegion) {
      name
      recentReports(limit: 20, page: 1) {
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

    let graphql_hosts = [
        "https://www.warcraftlogs.com/api/v2/client",
        "https://warcraftlogs.com/api/v2/client",
        "https://classic.warcraftlogs.com/api/v2/client",
    ];

    let mut last_error: Option<String> = None;

    let mut report_body: Option<Value> = None;
    for host in graphql_hosts {
        let graphql_payload = json!({
            "query": graphql_query_reports,
            "variables": {
                "name": name,
                "serverSlug": realm,
                "serverRegion": region
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
                        report_body = Some(v);
                        break;
                    }
                    last_error = Some(format!("{} reports query returned GraphQL errors", host));
                }
                Err(err) => {
                    last_error = Some(format!("{} returned an invalid JSON response: {}", host, err));
                }
            },
            Ok(resp) => {
                let status = resp.status().as_u16();
                last_error = Some(format!("{} returned status {}", host, status));
                if status != 404 {
                    break;
                }
            }
            Err(err) => {
                last_error = Some(format!("{} request failed: {}", host, err));
            }
        }
    }

    let report_body = match report_body {
        Some(v) => v,
        None => {
            return HttpResponse::Ok().json(json!({
                "configured": true,
                "needs_credentials": false,
                "parses": [],
                "error": last_error.unwrap_or_else(|| "Failed to fetch Warcraft Logs reports.".to_string())
            }))
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
    let mut debug_raw_payloads: Vec<Value> = Vec::new();
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
                        if !has_graphql_errors {
                            if debug_raw {
                                debug_raw_payloads.push(json!({
                                    "bucket": bucket_label,
                                    "difficulty_candidate": candidate,
                                    "host": host,
                                    "response": v.clone(),
                                }));
                            }
                            body_for_candidate = Some(v);
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
            let Some(body) = body_for_candidate else {
                continue;
            };
            if body.get("errors").is_some() {
                continue;
            }
            let Some(zone_rankings) = extract_zone_rankings(&body) else {
                continue;
            };
            let mut parses = parse_parses(&zone_rankings, &report_index, Some(bucket_label));
            parses.retain(|row| row.difficulty.eq_ignore_ascii_case(bucket_label));
            if parses.is_empty() {
                continue;
            }
            bucket_rows = parses;
            break;
        }

        for row in bucket_rows {
            let dedupe_key = format!(
                "{}::{}::{}::{}::{}",
                row.zone_name.to_lowercase(),
                row.encounter_name.to_lowercase(),
                row.difficulty.to_lowercase(),
                row.start_time.unwrap_or(0),
                row.report_code.clone().unwrap_or_default().to_lowercase()
            );
            if seen_rows.insert(dedupe_key) {
                combined_parses.push(row);
            }
        }
    }

    if combined_parses.is_empty() {
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
                    if resp.status().as_u16() != 404 {
                        break;
                    }
                }
                Err(_err) => {}
            }
        }
        if let Some(body) = fallback_body {
            if body.get("errors").is_none() {
                if let Some(zone_rankings) = extract_zone_rankings(&body) {
                    let mut parses = parse_parses(&zone_rankings, &report_index, None);
                    parses.retain(|row| {
                        matches!(row.difficulty.as_str(), "LFR" | "Normal" | "Heroic" | "Mythic")
                    });
                    combined_parses.append(&mut parses);
                }
            }
        }
    }

    if combined_parses.is_empty() {
        return HttpResponse::Ok().json(json!({
            "configured": true,
            "needs_credentials": false,
            "parses": [],
            "message": "No Warcraft Logs parse data found for this character."
        }));
    }

    let mut payload = json!({
        "configured": true,
        "needs_credentials": false,
        "parses": combined_parses
    });
    if debug_raw {
        payload["debug_raw"] = Value::Array(debug_raw_payloads);
    }
    HttpResponse::Ok().json(payload)
}
