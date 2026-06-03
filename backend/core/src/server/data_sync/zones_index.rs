use once_cell::sync::Lazy;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::Mutex as StdMutex;

use super::catalog::{path_variants_with_json_alias, resolve_catalog_path, DataFileEntry};
use super::{
    WowheadRaidZoneSummary, WowheadZoneNameId, WowheadZonesIndexSummary, ZONES_INDEX_ENTRY_KEY,
    ZONES_INDEX_FILE_NAME,
};

#[derive(Debug, Clone)]
pub(super) struct CachedZonesIndex {
    pub(super) path: PathBuf,
    pub(super) modified_unix_secs: Option<u64>,
    pub(super) value: Value,
    pub(super) summary: WowheadZonesIndexSummary,
}

static ZONES_INDEX_CACHE: Lazy<StdMutex<Option<CachedZonesIndex>>> =
    Lazy::new(|| StdMutex::new(None));

fn push_unique_path(paths: &mut Vec<PathBuf>, candidate: PathBuf) {
    if !paths.iter().any(|path| path == &candidate) {
        paths.push(candidate);
    }
}

fn extend_unique_paths(paths: &mut Vec<PathBuf>, candidates: Vec<PathBuf>) {
    for candidate in candidates {
        push_unique_path(paths, candidate);
    }
}

fn zones_index_candidate_paths(root: &Path) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    extend_unique_paths(
        &mut candidates,
        path_variants_with_json_alias(&root.join(ZONES_INDEX_FILE_NAME)),
    );

    candidates
}

pub(super) fn resolve_zones_index_path(root: &Path) -> PathBuf {
    zones_index_candidate_paths(root)
        .into_iter()
        .find(|path| path.exists())
        .unwrap_or_else(|| root.join(ZONES_INDEX_FILE_NAME))
}

pub(super) fn resolve_data_file_read_path(root: &Path, entry: &DataFileEntry) -> PathBuf {
    if entry.key == ZONES_INDEX_ENTRY_KEY {
        return resolve_zones_index_path(root);
    }
    resolve_catalog_path(root, entry)
}

fn zones_index_mtime_unix_secs(path: &Path) -> Option<u64> {
    let modified = std::fs::metadata(path).ok()?.modified().ok()?;
    modified
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|d| d.as_secs())
}

fn build_zones_index_summary(zones_index: &Value) -> WowheadZonesIndexSummary {
    let zones = zones_index
        .get("zones")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let mut zone_ids = Vec::new();
    let mut raids = Vec::new();
    for zone in zones {
        let id = zone.get("id").and_then(|v| v.as_u64()).map(|n| n as u32);
        let name = zone
            .get("name")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        if let Some(zone_id) = id {
            if !name.is_empty() {
                zone_ids.push(WowheadZoneNameId {
                    id: zone_id,
                    name: name.clone(),
                });
            }
            let is_raid = zone
                .get("is_raid")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            if is_raid && !name.is_empty() {
                let expansion = zone
                    .get("expansion")
                    .and_then(|v| v.as_u64())
                    .map(|n| n as u32);
                let encounters = zone
                    .get("encounters")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|enc| enc.get("name").and_then(|n| n.as_str()))
                            .map(|s| s.trim().to_string())
                            .filter(|s| !s.is_empty())
                            .collect::<Vec<String>>()
                    })
                    .unwrap_or_default();
                raids.push(WowheadRaidZoneSummary {
                    id: zone_id,
                    name,
                    expansion,
                    encounters,
                });
            }
        }
    }
    raids.sort_by(|a, b| a.name.cmp(&b.name));
    WowheadZonesIndexSummary {
        zones: zone_ids,
        raids,
    }
}

pub(super) fn normalize_zone_name(name: &str) -> String {
    name.to_ascii_lowercase()
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .collect()
}

pub(super) fn load_cached_zones_index(root: &Path) -> Result<CachedZonesIndex, String> {
    let path = resolve_zones_index_path(root);
    if !path.exists() {
        return Err("zones-encounters-index file not found in runtime data directory".to_string());
    }
    let modified_unix_secs = zones_index_mtime_unix_secs(&path);

    if let Ok(cache_guard) = ZONES_INDEX_CACHE.lock() {
        if let Some(cache) = cache_guard.as_ref() {
            if cache.path == path && cache.modified_unix_secs == modified_unix_secs {
                return Ok(cache.clone());
            }
        }
    }

    let content = std::fs::read_to_string(&path)
        .map_err(|err| format!("Failed to read {}: {}", path.display(), err))?;
    let value: Value = serde_json::from_str(&content)
        .map_err(|err| format!("Failed to parse {}: {}", path.display(), err))?;
    let summary = build_zones_index_summary(&value);
    let fresh = CachedZonesIndex {
        path,
        modified_unix_secs,
        value,
        summary,
    };

    if let Ok(mut cache_guard) = ZONES_INDEX_CACHE.lock() {
        *cache_guard = Some(fresh.clone());
    }

    Ok(fresh)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn zones_index_summary_includes_zones_and_sorted_raids() {
        let summary = build_zones_index_summary(&json!({
            "zones": [
                {
                    "id": 10,
                    "name": " Beta Raid ",
                    "is_raid": true,
                    "expansion": 11,
                    "encounters": [
                        { "name": " First Boss " },
                        { "name": "" },
                        { "id": 123 }
                    ]
                },
                {
                    "id": 8,
                    "name": "Alpha Raid",
                    "is_raid": true,
                    "encounters": [{ "name": "Second Boss" }]
                },
                {
                    "id": 7,
                    "name": "Dungeon",
                    "is_raid": false
                },
                {
                    "id": 99,
                    "name": "   ",
                    "is_raid": true
                }
            ]
        }));

        assert_eq!(
            summary.zones.iter().map(|zone| zone.id).collect::<Vec<_>>(),
            vec![10, 8, 7]
        );
        assert_eq!(
            summary
                .raids
                .iter()
                .map(|raid| raid.name.as_str())
                .collect::<Vec<_>>(),
            vec!["Alpha Raid", "Beta Raid"]
        );
        assert_eq!(summary.raids[0].encounters, vec!["Second Boss"]);
        assert_eq!(summary.raids[1].expansion, Some(11));
        assert_eq!(summary.raids[1].encounters, vec!["First Boss"]);
    }

    #[test]
    fn normalize_zone_name_keeps_only_ascii_alphanumeric_lowercase() {
        assert_eq!(
            normalize_zone_name("Ara-Kara, City of Echoes!"),
            "arakaracityofechoes"
        );
    }
}
