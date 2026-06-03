use actix_web::{web, HttpResponse};
use serde::Deserialize;
use serde_json::json;
use std::path::PathBuf;

use super::zones_index::{load_cached_zones_index, normalize_zone_name};
use super::WowheadZonesIndexSummary;

#[derive(Debug, Deserialize)]
pub struct WowheadZoneMatchQuery {
    pub instance_id: Option<String>,
    pub wowhead_id: Option<String>,
    pub name: Option<String>,
    pub is_raid: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct WowheadZonesSummaryQuery {
    pub kind: Option<String>,
}

pub async fn get_wowhead_zones_index(data_dir: web::Data<Option<PathBuf>>) -> HttpResponse {
    let Some(root) = data_dir.get_ref().clone() else {
        return HttpResponse::BadRequest().json(json!({"detail": "Data directory is unavailable"}));
    };
    match load_cached_zones_index(&root) {
        Ok(cached) => HttpResponse::Ok().json(cached.value),
        Err(err) if err.contains("not found") => {
            HttpResponse::NotFound().json(json!({ "detail": err }))
        }
        Err(err) => HttpResponse::InternalServerError().json(json!({ "detail": err })),
    }
}

pub async fn get_wowhead_zones_index_summary(
    data_dir: web::Data<Option<PathBuf>>,
    query: web::Query<WowheadZonesSummaryQuery>,
) -> HttpResponse {
    let Some(root) = data_dir.get_ref().clone() else {
        return HttpResponse::BadRequest().json(json!({"detail": "Data directory is unavailable"}));
    };
    let kind = query
        .kind
        .as_deref()
        .unwrap_or("all")
        .trim()
        .to_ascii_lowercase();
    match load_cached_zones_index(&root) {
        Ok(cached) => {
            let response = match kind.as_str() {
                "raid" => WowheadZonesIndexSummary {
                    zones: Vec::new(),
                    raids: cached.summary.raids,
                },
                "dungeon" => WowheadZonesIndexSummary {
                    zones: cached.summary.zones,
                    raids: Vec::new(),
                },
                _ => cached.summary,
            };
            HttpResponse::Ok().json(response)
        }
        Err(err) if err.contains("not found") => {
            HttpResponse::NotFound().json(json!({ "detail": err }))
        }
        Err(err) => HttpResponse::InternalServerError().json(json!({ "detail": err })),
    }
}

pub async fn get_wowhead_zone_match(
    data_dir: web::Data<Option<PathBuf>>,
    query: web::Query<WowheadZoneMatchQuery>,
) -> HttpResponse {
    let Some(root) = data_dir.get_ref().clone() else {
        return HttpResponse::BadRequest().json(json!({"detail": "Data directory is unavailable"}));
    };
    let cached = match load_cached_zones_index(&root) {
        Ok(cached) => cached,
        Err(err) if err.contains("not found") => {
            return HttpResponse::NotFound().json(json!({ "detail": err }));
        }
        Err(err) => {
            return HttpResponse::InternalServerError().json(json!({ "detail": err }));
        }
    };

    let zones = cached
        .value
        .get("zones")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let parse_positive_u32 = |value: Option<&String>| -> Option<u32> {
        value
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .and_then(|s| s.parse::<u32>().ok())
            .filter(|id| *id > 0)
    };
    let wowhead_id = parse_positive_u32(query.wowhead_id.as_ref());
    let instance_id = parse_positive_u32(query.instance_id.as_ref());
    let normalized_name = query
        .name
        .as_ref()
        .map(|s| normalize_zone_name(s))
        .filter(|s| !s.is_empty());

    let matched = zones.iter().find(|zone| {
        if let Some(is_raid) = query.is_raid {
            let zone_is_raid = zone
                .get("is_raid")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            if zone_is_raid != is_raid {
                return false;
            }
        }
        let zone_id = zone.get("id").and_then(|v| v.as_u64()).map(|n| n as u32);
        if wowhead_id.is_some() && zone_id == wowhead_id {
            return true;
        }
        if let Some(ref name_key) = normalized_name {
            let zone_name_key = zone
                .get("name")
                .and_then(|v| v.as_str())
                .map(normalize_zone_name)
                .unwrap_or_default();
            if !zone_name_key.is_empty() && &zone_name_key == name_key {
                return true;
            }
        }
        if let Some(inst_id) = instance_id {
            if zone_id == Some(inst_id) {
                return true;
            }
            if let Some(url) = zone.get("url").and_then(|v| v.as_str()) {
                if url.contains(&format!("zone={}", inst_id)) {
                    return true;
                }
            }
        }
        false
    });

    HttpResponse::Ok().json(json!({ "zone": matched.cloned() }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::body::to_bytes;
    use serde_json::Value;

    #[actix_web::test]
    async fn wowhead_zone_handlers_require_available_data_dir() {
        let index = get_wowhead_zones_index(web::Data::new(None)).await;
        assert_eq!(index.status(), 400);

        let summary = get_wowhead_zones_index_summary(
            web::Data::new(None),
            web::Query(WowheadZonesSummaryQuery { kind: None }),
        )
        .await;
        assert_eq!(summary.status(), 400);

        let matched = get_wowhead_zone_match(
            web::Data::new(None),
            web::Query(WowheadZoneMatchQuery {
                instance_id: None,
                wowhead_id: None,
                name: None,
                is_raid: None,
            }),
        )
        .await;
        assert_eq!(matched.status(), 400);
    }

    #[actix_web::test]
    async fn wowhead_zone_handlers_distinguish_missing_and_invalid_cache_files() {
        let temp = tempfile::tempdir().expect("temp dir");

        let missing =
            get_wowhead_zones_index(web::Data::new(Some(temp.path().to_path_buf()))).await;
        assert_eq!(missing.status(), 404);

        std::fs::write(temp.path().join("zones-encounters-index.json"), "{bad json")
            .expect("write invalid zones file");
        let invalid = get_wowhead_zones_index_summary(
            web::Data::new(Some(temp.path().to_path_buf())),
            web::Query(WowheadZonesSummaryQuery {
                kind: Some("raid".to_string()),
            }),
        )
        .await;
        assert_eq!(invalid.status(), 500);
    }

    #[actix_web::test]
    async fn wowhead_zone_summary_and_match_cover_dungeon_filter_and_empty_inputs() {
        let temp = tempfile::tempdir().expect("temp dir");
        std::fs::write(
            temp.path().join("zones-encounters-index.json"),
            serde_json::to_vec(&json!({
                "zones": [
                    {"id": 11, "name": "Dungeon One", "is_raid": false, "url": "https://wowhead.com/zone=111"},
                    {"id": 22, "name": "Raid One", "is_raid": true}
                ]
            }))
            .expect("zones json"),
        )
        .expect("write zones index");

        let summary = get_wowhead_zones_index_summary(
            web::Data::new(Some(temp.path().to_path_buf())),
            web::Query(WowheadZonesSummaryQuery {
                kind: Some("dungeon".to_string()),
            }),
        )
        .await;
        assert_eq!(summary.status(), 200);
        let body = to_bytes(summary.into_body()).await.expect("summary body");
        let payload: Value = serde_json::from_slice(&body).expect("summary json");
        assert_eq!(payload["zones"].as_array().map(Vec::len), Some(2));
        assert!(payload["raids"].as_array().is_some_and(Vec::is_empty));

        let empty_match = get_wowhead_zone_match(
            web::Data::new(Some(temp.path().to_path_buf())),
            web::Query(WowheadZoneMatchQuery {
                instance_id: Some("  ".to_string()),
                wowhead_id: Some("0".to_string()),
                name: Some("".to_string()),
                is_raid: None,
            }),
        )
        .await;
        assert_eq!(empty_match.status(), 200);
        let body = to_bytes(empty_match.into_body()).await.expect("match body");
        let payload: Value = serde_json::from_slice(&body).expect("match json");
        assert!(payload["zone"].is_null());
    }
}
