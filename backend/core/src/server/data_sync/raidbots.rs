use std::io;
use std::path::Path;
use std::time::Duration;
use serde_json::Value;

pub(super) fn raidbots_file_progress(
    index: usize,
    total_files: usize,
    file_name: &str,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    elapsed: Duration,
) -> String {
    let elapsed_ms = elapsed.as_millis() as u64;
    let speed_bytes_per_sec = downloaded_bytes
        .saturating_mul(1000)
        .checked_div(elapsed_ms)
        .unwrap_or(0);
    format!(
        "Files:{}:{}:{}:{}:{}:{}:{}",
        index,
        total_files,
        file_name,
        downloaded_bytes,
        total_bytes.unwrap_or(0),
        elapsed_ms,
        speed_bytes_per_sec
    )
}

pub(super) fn stage_raidbots_files(
    staging_root: &Path,
    final_root: &Path,
    files: &[String],
    metadata_text: &str,
) -> Result<(), String> {
    for file_name in files {
        let staged = staging_root.join(file_name);
        let final_path = final_root.join(file_name);
        if let Some(parent) = final_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                format!(
                    "Failed to create final directory for {}: {}",
                    final_path.display(),
                    e
                )
            })?;
        }

        match std::fs::rename(&staged, &final_path) {
            Ok(_) => {}
            Err(err) if err.kind() == io::ErrorKind::CrossesDevices => {
                std::fs::copy(&staged, &final_path).map_err(|copy_err| {
                    format!(
                        "Failed to copy staged file {} to {}: {}",
                        staged.display(),
                        final_path.display(),
                        copy_err
                    )
                })?;
                std::fs::remove_file(&staged).ok();
            }
            Err(err) => {
                return Err(format!(
                    "Failed to move staged file {} to {}: {}",
                    staged.display(),
                    final_path.display(),
                    err
                ));
            }
        }
    }

    std::fs::write(final_root.join("metadata.json"), metadata_text)
        .map_err(|e| format!("Failed to write metadata.json: {}", e))?;
    Ok(())
}

fn read_snapshot_json(root: &Path, name: &str) -> Result<Value, String> {
    let path = root.join(name);
    let content = std::fs::read_to_string(&path)
        .map_err(|err| format!("Missing required Raidbots file {name}: {err}"))?;
    serde_json::from_str(&content)
        .map_err(|err| format!("Invalid JSON in Raidbots file {name}: {err}"))
}

/// Validate the cross-file invariants needed before replacing the last good
/// snapshot. The checks intentionally stay structural so a new season can
/// continue working without embedding season-specific IDs.
pub(super) fn validate_raidbots_snapshot(staging_root: &Path) -> Result<(), String> {
    let seasons = read_snapshot_json(staging_root, "seasons.json")?;
    let seasons = seasons
        .as_array()
        .or_else(|| seasons.get("seasons").and_then(Value::as_array))
        .ok_or_else(|| "Raidbots seasons.json is not an array".to_string())?;
    let active: Vec<&Value> = seasons
        .iter()
        .filter(|season| season.get("active").and_then(Value::as_bool) == Some(true))
        .collect();
    if active.len() != 1 {
        return Err(format!(
            "Raidbots snapshot must contain exactly one active season (found {})",
            active.len()
        ));
    }
    let active_short_name = active[0]
        .get("shortName")
        .or_else(|| active[0].get("short_name"))
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "Active Raidbots season has no short name".to_string())?;

    let instances = read_snapshot_json(staging_root, "instances.json")?;
    let instances = instances
        .as_array()
        .or_else(|| instances.get("instances").and_then(Value::as_array))
        .ok_or_else(|| "Raidbots instances.json is not an array".to_string())?;
    if !instances.iter().any(|instance| {
        instance.get("id").and_then(Value::as_i64) == Some(-1)
            && instance.get("type").and_then(Value::as_str) == Some("dungeon")
    }) {
        return Err("Raidbots snapshot is missing the Mythic+ pool".to_string());
    }
    if !instances.iter().any(|instance| {
        let id = instance.get("id").and_then(Value::as_i64).unwrap_or(0);
        let type_name = instance.get("type").and_then(Value::as_str).unwrap_or_default();
        let name = instance.get("name").and_then(Value::as_str).unwrap_or_default();
        id < 0
            && format!("{type_name} {name}")
                .to_ascii_lowercase()
                .contains(&active_short_name.to_ascii_lowercase())
    }) {
        return Err(format!(
            "Raidbots snapshot has no current-season instance pool for {active_short_name}"
        ));
    }

    for required in ["talents.json", "class-traits.json", "bonuses.json"] {
        let value = read_snapshot_json(staging_root, required)?;
        let nonempty = value.as_array().is_some_and(|items| !items.is_empty())
            || value.as_object().is_some_and(|object| !object.is_empty());
        if !nonempty {
            return Err(format!("Raidbots file {required} is empty"));
        }
    }

    let conversion_id = active[0]
        .get("itemConversionId")
        .and_then(Value::as_u64);
    if conversion_id.is_some() && !staging_root.join("item-conversions.json").exists() {
        return Err("Active season has no item-conversions.json payload".to_string());
    }
    if let Ok(conversions) = read_snapshot_json(staging_root, "item-conversions.json") {
        let nonempty = conversions.as_array().is_some_and(|items| !items.is_empty())
            || conversions.as_object().is_some_and(|object| !object.is_empty());
        if !nonempty {
            return Err("Raidbots item-conversions.json is empty".to_string());
        }
        if let Some(conversion_id) = conversion_id {
            let key = conversion_id.to_string();
            let Some(group) = conversions
                .as_object()
                .and_then(|object| object.get(&key))
                .and_then(Value::as_object)
            else {
                return Err(format!("Active season conversion group is missing: {conversion_id}"));
            };
            if !group
                .get("bonusIds")
                .and_then(Value::as_array)
                .is_some_and(|bonus_ids| !bonus_ids.is_empty())
            {
                return Err(format!(
                    "Active season conversion group has no bonus IDs: {conversion_id}"
                ));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn raidbots_file_progress_formats_counts_and_speed() {
        assert_eq!(
            raidbots_file_progress(
                2,
                5,
                "items.json",
                4_096,
                Some(8_192),
                Duration::from_millis(2_000),
            ),
            "Files:2:5:items.json:4096:8192:2000:2048"
        );
        assert_eq!(
            raidbots_file_progress(1, 1, "metadata.json", 99, None, Duration::ZERO),
            "Files:1:1:metadata.json:99:0:0:0"
        );
    }

    #[test]
    fn stage_raidbots_files_moves_files_and_writes_metadata() {
        let staging = tempfile::tempdir().expect("staging dir");
        let final_dir = tempfile::tempdir().expect("final dir");
        std::fs::create_dir_all(staging.path().join("items")).expect("staging child dir");
        std::fs::write(staging.path().join("items").join("items.json"), "[]").expect("staged file");

        stage_raidbots_files(
            staging.path(),
            final_dir.path(),
            &["items/items.json".to_string()],
            "{\"ok\":true}",
        )
        .expect("stage files");

        assert_eq!(
            std::fs::read_to_string(final_dir.path().join("items").join("items.json"))
                .expect("final file"),
            "[]"
        );
        assert_eq!(
            std::fs::read_to_string(final_dir.path().join("metadata.json")).expect("metadata"),
            "{\"ok\":true}"
        );
        assert!(!staging.path().join("items").join("items.json").exists());
    }

    #[test]
    fn rejects_snapshots_without_exactly_one_active_season() {
        let temp = tempfile::tempdir().expect("snapshot dir");
        std::fs::write(temp.path().join("seasons.json"), "[]").expect("seasons");
        let error = validate_raidbots_snapshot(temp.path()).expect_err("snapshot should fail");
        assert!(error.contains("exactly one active season"));
    }
}
