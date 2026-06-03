use std::io;
use std::path::Path;
use std::time::Duration;

pub(super) fn raidbots_file_progress(
    index: usize,
    total_files: usize,
    file_name: &str,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    elapsed: Duration,
) -> String {
    let elapsed_ms = elapsed.as_millis() as u64;
    let speed_bytes_per_sec = if elapsed_ms > 0 {
        downloaded_bytes.saturating_mul(1000) / elapsed_ms
    } else {
        0
    };
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
}
