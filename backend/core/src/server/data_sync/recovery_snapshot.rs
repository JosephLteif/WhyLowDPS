use super::catalog::DataFileEntry;
use chrono::{DateTime, Duration, Utc};
use futures_util::StreamExt;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::time::Instant;

const RECOVERY_MANIFEST_URL: &str = "https://github.com/JosephLteif/whylowdps-game-data/releases/download/recovery-latest/manifest.json";
const RECOVERY_RELEASE_BASE_URL: &str =
    "https://github.com/JosephLteif/whylowdps-game-data/releases/download/recovery-latest";
const MAX_RECOVERY_SNAPSHOT_AGE: Duration = Duration::hours(24);

#[derive(Debug, Clone)]
pub(super) struct RepairProgress {
    pub(super) current: usize,
    pub(super) total: usize,
    pub(super) detail: String,
    pub(super) downloaded_bytes: u64,
    pub(super) total_bytes: u64,
    pub(super) speed_bytes_per_sec: u64,
}

#[derive(Debug, Deserialize)]
struct RecoveryManifest {
    schema_version: u32,
    generated_at: DateTime<Utc>,
    archive: RecoveryArchive,
    files: Vec<RecoveryFile>,
}

#[derive(Debug, Deserialize)]
struct RecoveryArchive {
    name: String,
    sha256: String,
    size: u64,
}

#[derive(Debug, Deserialize)]
struct RecoveryFile {
    path: String,
    sha256: String,
    size: u64,
}

pub(super) async fn restore_missing_raidbots_files<F>(
    client: &reqwest::Client,
    root: &Path,
    entries: &[DataFileEntry],
    mut report_progress: F,
) -> Result<Vec<String>, String>
where
    F: FnMut(RepairProgress),
{
    let manifest_response = client
        .get(RECOVERY_MANIFEST_URL)
        .header("User-Agent", "WhyLowDps/recovery")
        .send()
        .await
        .map_err(|err| format!("Failed to download recovery manifest: {err}"))?
        .error_for_status()
        .map_err(|err| format!("Recovery manifest request failed: {err}"))?;
    let manifest: RecoveryManifest = manifest_response
        .json()
        .await
        .map_err(|err| format!("Failed to parse recovery manifest: {err}"))?;

    validate_manifest(&manifest, Utc::now(), entries)?;
    std::fs::create_dir_all(root)
        .map_err(|err| format!("Failed to create recovery root {}: {err}", root.display()))?;
    let staging = tempfile::tempdir_in(root)
        .map_err(|err| format!("Failed to create recovery staging directory: {err}"))?;
    let archive_path = staging.path().join("recovery.zip");

    report_progress(RepairProgress {
        current: 0,
        total: entries.len(),
        detail: "Downloading verified recovery snapshot".to_string(),
        downloaded_bytes: 0,
        total_bytes: manifest.archive.size,
        speed_bytes_per_sec: 0,
    });

    let archive_response = client
        .get(format!(
            "{}/{}",
            RECOVERY_RELEASE_BASE_URL, manifest.archive.name
        ))
        .header("User-Agent", "WhyLowDps/recovery")
        .send()
        .await
        .map_err(|err| format!("Failed to download recovery archive: {err}"))?
        .error_for_status()
        .map_err(|err| format!("Recovery archive request failed: {err}"))?;
    let started = Instant::now();
    let mut downloaded_bytes = 0_u64;
    let mut archive_file = std::fs::File::create(&archive_path)
        .map_err(|err| format!("Failed to create recovery archive file: {err}"))?;
    let mut stream = archive_response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|err| format!("Failed to read recovery archive: {err}"))?;
        downloaded_bytes = downloaded_bytes.saturating_add(chunk.len() as u64);
        if downloaded_bytes > manifest.archive.size {
            return Err("Recovery archive exceeds the manifest size".to_string());
        }
        archive_file
            .write_all(&chunk)
            .map_err(|err| format!("Failed to save recovery archive: {err}"))?;
        let elapsed = started.elapsed().as_secs_f64();
        report_progress(RepairProgress {
            current: 0,
            total: entries.len(),
            detail: "Downloading verified recovery snapshot".to_string(),
            downloaded_bytes,
            total_bytes: manifest.archive.size,
            speed_bytes_per_sec: if elapsed > 0.0 {
                (downloaded_bytes as f64 / elapsed) as u64
            } else {
                0
            },
        });
    }
    archive_file
        .flush()
        .map_err(|err| format!("Failed to finish recovery archive: {err}"))?;

    let archive = std::fs::read(&archive_path)
        .map_err(|err| format!("Failed to read recovery archive: {err}"))?;
    validate_archive(&manifest, &archive)?;
    let restored = apply_verified_archive(root, &manifest, &archive, entries)?;

    report_progress(RepairProgress {
        current: restored.len(),
        total: entries.len(),
        detail: "Applied verified recovery snapshot".to_string(),
        downloaded_bytes,
        total_bytes: manifest.archive.size,
        speed_bytes_per_sec: 0,
    });
    Ok(restored)
}

fn validate_manifest(
    manifest: &RecoveryManifest,
    now: DateTime<Utc>,
    entries: &[DataFileEntry],
) -> Result<(), String> {
    if manifest.schema_version != 1 {
        return Err(format!(
            "Unsupported recovery manifest schema version {}",
            manifest.schema_version
        ));
    }
    if manifest.generated_at > now
        || now.signed_duration_since(manifest.generated_at) > MAX_RECOVERY_SNAPSHOT_AGE
    {
        return Err("Recovery manifest is not fresh".to_string());
    }
    if !is_safe_relative_path(&manifest.archive.name) || !is_valid_sha256(&manifest.archive.sha256)
    {
        return Err("Recovery manifest archive is invalid".to_string());
    }

    let mut requested = HashSet::new();
    for entry in entries {
        if !is_safe_relative_path(&entry.local_path) || !requested.insert(entry.local_path.as_str())
        {
            return Err(format!(
                "Invalid requested recovery path {}",
                entry.local_path
            ));
        }
    }

    let mut file_paths = HashSet::new();
    for file in &manifest.files {
        if !is_safe_relative_path(&file.path)
            || !is_valid_sha256(&file.sha256)
            || !file_paths.insert(file.path.as_str())
        {
            return Err("Recovery manifest file entry is invalid".to_string());
        }
    }
    for path in requested {
        if manifest
            .files
            .iter()
            .filter(|file| file.path == path)
            .count()
            != 1
        {
            return Err(format!(
                "Recovery manifest is missing requested path {path}"
            ));
        }
    }
    Ok(())
}

fn validate_archive(manifest: &RecoveryManifest, archive: &[u8]) -> Result<(), String> {
    if archive.len() as u64 != manifest.archive.size {
        return Err("Recovery archive size does not match manifest".to_string());
    }
    if !sha256_matches(archive, &manifest.archive.sha256) {
        return Err("Recovery archive checksum does not match manifest".to_string());
    }
    Ok(())
}

fn apply_verified_archive(
    root: &Path,
    manifest: &RecoveryManifest,
    archive: &[u8],
    entries: &[DataFileEntry],
) -> Result<Vec<String>, String> {
    validate_manifest(manifest, Utc::now(), entries)?;
    validate_archive(manifest, archive)?;

    let requested: HashMap<&str, (&DataFileEntry, &RecoveryFile)> = entries
        .iter()
        .map(|entry| {
            let file = manifest
                .files
                .iter()
                .find(|file| file.path == entry.local_path)
                .expect("validated recovery manifest must have requested path");
            (entry.local_path.as_str(), (entry, file))
        })
        .collect();
    if entries
        .iter()
        .any(|entry| root.join(&entry.local_path).exists())
    {
        return Err("Recovery target is no longer missing".to_string());
    }

    let staging = tempfile::tempdir_in(root)
        .map_err(|err| format!("Failed to create recovery staging directory: {err}"))?;
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(archive))
        .map_err(|err| format!("Failed to open recovery archive: {err}"))?;
    let mut archive_paths = HashSet::new();
    for index in 0..zip.len() {
        let mut file = zip
            .by_index(index)
            .map_err(|err| format!("Failed to read recovery archive entry: {err}"))?;
        let path = file.name().to_string();
        if file.is_dir() || !is_safe_relative_path(&path) {
            return Err("Recovery archive contains an unsafe path".to_string());
        }
        if !archive_paths.insert(path.clone()) {
            return Err(format!("Recovery archive contains duplicate path {path}"));
        }
        let Some((_, expected)) = requested.get(path.as_str()) else {
            return Err(format!("Recovery archive contains unrequested path {path}"));
        };
        if file.size() != expected.size {
            return Err(format!("Recovery archive size mismatch for {path}"));
        }

        let staged_path = staging.path().join(&path);
        if let Some(parent) = staged_path.parent() {
            std::fs::create_dir_all(parent).map_err(|err| {
                format!(
                    "Failed to create recovery staging directory {}: {err}",
                    parent.display()
                )
            })?;
        }
        let mut staged_file = std::fs::File::create(&staged_path)
            .map_err(|err| format!("Failed to stage recovery file {path}: {err}"))?;
        let mut hasher = Sha256::new();
        let mut written = 0_u64;
        let mut buffer = [0_u8; 32 * 1024];
        loop {
            let count = file
                .read(&mut buffer)
                .map_err(|err| format!("Failed to read recovery file {path}: {err}"))?;
            if count == 0 {
                break;
            }
            written = written.saturating_add(count as u64);
            if written > expected.size {
                return Err(format!("Recovery archive size mismatch for {path}"));
            }
            hasher.update(&buffer[..count]);
            staged_file
                .write_all(&buffer[..count])
                .map_err(|err| format!("Failed to stage recovery file {path}: {err}"))?;
        }
        if written != expected.size || format!("{:x}", hasher.finalize()) != expected.sha256 {
            return Err(format!("Recovery archive checksum mismatch for {path}"));
        }
    }

    if archive_paths.len() != requested.len() {
        return Err("Recovery archive is missing requested files".to_string());
    }
    let mut published = Vec::with_capacity(entries.len());
    let mut created_directories = Vec::new();
    for entry in entries {
        let final_path = root.join(&entry.local_path);
        if let Err(err) = publish_staged_file(
            staging.path(),
            &entry.local_path,
            &final_path,
            &mut created_directories,
        ) {
            let rollback_err = rollback_live_changes(&published, &created_directories);
            return Err(match rollback_err {
                Ok(()) => err,
                Err(rollback_err) => format!("{err}; recovery rollback failed: {rollback_err}"),
            });
        }
        published.push(final_path);
    }
    Ok(entries.iter().map(|entry| entry.key.clone()).collect())
}

fn publish_staged_file(
    staging_root: &Path,
    relative_path: &str,
    final_path: &Path,
    created_directories: &mut Vec<PathBuf>,
) -> Result<(), String> {
    let staged = staging_root.join(relative_path);
    if let Some(parent) = final_path.parent() {
        create_final_directory(parent, created_directories)?;
    }
    if final_path.exists() {
        return Err(format!(
            "Refusing to replace existing recovery target {}",
            final_path.display()
        ));
    }
    match std::fs::hard_link(&staged, final_path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => Err(format!(
            "Refusing to replace existing recovery target {}",
            final_path.display()
        )),
        Err(_) => copy_staged_file_without_replacing(&staged, final_path),
    }
}

fn create_final_directory(
    directory: &Path,
    created_directories: &mut Vec<PathBuf>,
) -> Result<(), String> {
    let mut missing = Vec::new();
    let mut current = directory;
    while !current.exists() {
        missing.push(current.to_path_buf());
        current = current.parent().ok_or_else(|| {
            format!(
                "Recovery target directory {} has no parent",
                directory.display()
            )
        })?;
    }
    if !current.is_dir() {
        return Err(format!(
            "Recovery target directory {} is not a directory",
            current.display()
        ));
    }
    for path in missing.into_iter().rev() {
        match std::fs::create_dir(&path) {
            Ok(()) => created_directories.push(path),
            Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists && path.is_dir() => {}
            Err(err) => {
                return Err(format!(
                    "Failed to create final directory for {}: {err}",
                    path.display()
                ));
            }
        }
    }
    Ok(())
}

fn copy_staged_file_without_replacing(staged: &Path, final_path: &Path) -> Result<(), String> {
    let mut source = std::fs::File::open(staged).map_err(|err| {
        format!(
            "Failed to open staged recovery file {}: {err}",
            staged.display()
        )
    })?;
    let mut destination = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(final_path)
        .map_err(|err| {
            format!(
                "Failed to create recovery target {} without replacing it: {err}",
                final_path.display()
            )
        })?;
    if let Err(err) = std::io::copy(&mut source, &mut destination) {
        drop(destination);
        std::fs::remove_file(final_path).ok();
        return Err(format!(
            "Failed to copy staged recovery file {} to {}: {err}",
            staged.display(),
            final_path.display()
        ));
    }
    Ok(())
}

fn rollback_live_changes(
    published: &[PathBuf],
    created_directories: &[PathBuf],
) -> Result<(), String> {
    let mut errors = Vec::new();
    for path in published.iter().rev() {
        if let Err(err) = std::fs::remove_file(path) {
            errors.push(format!("failed to remove {}: {err}", path.display()));
        }
    }
    for path in created_directories.iter().rev() {
        if let Err(err) = std::fs::remove_dir(path) {
            errors.push(format!("failed to remove {}: {err}", path.display()));
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

fn is_safe_relative_path(path: &str) -> bool {
    !path.is_empty()
        && !path.contains("//")
        && !path.ends_with('/')
        && path.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-' | '/')
        })
        && Path::new(path)
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
}

fn is_valid_sha256(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn sha256_matches(bytes: &[u8], expected: &str) -> bool {
    format!("{:x}", Sha256::digest(bytes)).eq_ignore_ascii_case(expected)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::server::data_sync::catalog::{DataFileEntry, DataFileEntryType, DataFileSource};
    use chrono::{Duration, Utc};
    use sha2::{Digest, Sha256};
    use std::io::Write;

    fn entry(key: &str, local_path: &str) -> DataFileEntry {
        DataFileEntry {
            key: key.to_string(),
            label: key.to_string(),
            section: "Test".to_string(),
            source: DataFileSource::Raidbots,
            remote_path: Some(local_path.to_string()),
            local_path: local_path.to_string(),
            required: true,
            entry_type: DataFileEntryType::File,
            bundled_path: None,
        }
    }

    fn sha256(bytes: &[u8]) -> String {
        format!("{:x}", Sha256::digest(bytes))
    }

    fn zip_bytes(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        for (path, contents) in files {
            writer
                .start_file::<_, ()>(path, zip::write::FileOptions::default())
                .expect("start archive entry");
            writer.write_all(contents).expect("write archive entry");
        }
        writer.finish().expect("finish archive").into_inner()
    }

    fn zip_bytes_with_duplicate_unrequested_entry() -> Vec<u8> {
        let mut archive = zip_bytes(&[
            ("items.json", b"[]"),
            ("bonus-one.json", b"first"),
            ("bonus-two.json", b"second"),
        ]);
        for index in 0..=archive.len() - b"bonus-two.json".len() {
            if archive[index..].starts_with(b"bonus-two.json") {
                archive[index..index + b"bonus-two.json".len()].copy_from_slice(b"bonus-one.json");
            }
        }
        archive
    }

    fn manifest_at(generated_at: chrono::DateTime<Utc>) -> RecoveryManifest {
        RecoveryManifest {
            schema_version: 1,
            generated_at,
            archive: RecoveryArchive {
                name: "snapshot.zip".to_string(),
                sha256: sha256(b"archive"),
                size: 7,
            },
            files: Vec::new(),
        }
    }

    fn manifest_for(archive: &[u8], files: &[(&str, &[u8])]) -> RecoveryManifest {
        RecoveryManifest {
            schema_version: 1,
            generated_at: Utc::now(),
            archive: RecoveryArchive {
                name: "snapshot.zip".to_string(),
                sha256: sha256(archive),
                size: archive.len() as u64,
            },
            files: files
                .iter()
                .map(|(path, contents)| RecoveryFile {
                    path: (*path).to_string(),
                    sha256: sha256(contents),
                    size: contents.len() as u64,
                })
                .collect(),
        }
    }

    #[test]
    fn rejects_stale_manifest_before_archive_is_applied() {
        assert!(validate_manifest(
            &manifest_at(Utc::now() - Duration::hours(25)),
            Utc::now(),
            &[entry("items", "items.json")]
        )
        .is_err());
    }

    #[test]
    fn rejects_traversal_before_creating_a_live_file() {
        let root = tempfile::tempdir().expect("root");
        let archive = zip_bytes(&[("../items.json", b"replacement")]);

        assert!(apply_verified_archive(
            root.path(),
            &manifest_for(&archive, &[("items.json", b"replacement")]),
            &archive,
            &[entry("items", "items.json")]
        )
        .is_err());
        assert!(!root.path().join("items.json").exists());
    }

    #[test]
    fn stages_verified_missing_files() {
        let root = tempfile::tempdir().expect("root");
        let archive = zip_bytes(&[("items.json", b"[]")]);

        assert_eq!(
            apply_verified_archive(
                root.path(),
                &manifest_for(&archive, &[("items.json", b"[]")]),
                &archive,
                &[entry("items", "items.json")]
            )
            .expect("apply archive"),
            vec!["items"]
        );
        assert_eq!(
            std::fs::read(root.path().join("items.json")).expect("restored file"),
            b"[]"
        );
    }

    #[test]
    fn rejects_archive_with_invalid_checksum_or_size() {
        let archive = zip_bytes(&[("items.json", b"[]")]);
        let mut manifest = manifest_for(&archive, &[("items.json", b"[]")]);
        manifest.archive.sha256 = sha256(b"other archive");

        assert!(validate_archive(&manifest, &archive).is_err());
    }

    #[test]
    fn rejects_payload_with_invalid_checksum_or_size_before_apply() {
        let root = tempfile::tempdir().expect("root");
        let archive = zip_bytes(&[("items.json", b"replacement")]);

        assert!(apply_verified_archive(
            root.path(),
            &manifest_for(&archive, &[("items.json", b"expected")]),
            &archive,
            &[entry("items", "items.json")]
        )
        .is_err());
        assert!(!root.path().join("items.json").exists());
    }

    #[test]
    fn rejects_missing_or_duplicate_requested_manifest_entries() {
        let archive = zip_bytes(&[("items.json", b"[]")]);
        let requested = [entry("items", "items.json")];
        let missing = manifest_for(&archive, &[]);
        let duplicate = manifest_for(&archive, &[("items.json", b"[]"), ("items.json", b"[]")]);

        assert!(validate_manifest(&missing, Utc::now(), &requested).is_err());
        assert!(validate_manifest(&duplicate, Utc::now(), &requested).is_err());
    }

    #[test]
    fn rejects_unexpected_archive_entries() {
        let root = tempfile::tempdir().expect("root");
        let archive = zip_bytes(&[("items.json", b"[]"), ("bonuses.json", b"new")]);

        assert!(apply_verified_archive(
            root.path(),
            &manifest_for(&archive, &[("items.json", b"[]")]),
            &archive,
            &[entry("items", "items.json")]
        )
        .is_err());
        assert!(!root.path().join("items.json").exists());
    }

    #[test]
    fn rejects_duplicate_unrequested_archive_entries() {
        let root = tempfile::tempdir().expect("root");
        let archive = zip_bytes_with_duplicate_unrequested_entry();

        assert!(apply_verified_archive(
            root.path(),
            &manifest_for(&archive, &[("items.json", b"[]")]),
            &archive,
            &[entry("items", "items.json")]
        )
        .is_err());
        assert!(!root.path().join("items.json").exists());
    }

    #[test]
    fn rejects_alternate_separator_paths() {
        let archive = zip_bytes(&[("items//items.json", b"[]")]);
        let entries = [entry("items", "items//items.json")];

        assert!(validate_manifest(
            &manifest_for(&archive, &[("items//items.json", b"[]")]),
            Utc::now(),
            &entries
        )
        .is_err());
    }

    #[test]
    fn rolls_back_earlier_moves_when_a_later_move_fails() {
        let root = tempfile::tempdir().expect("root");
        std::fs::write(root.path().join("blocked"), b"existing").expect("block directory");
        let archive = zip_bytes(&[("items.json", b"[]"), ("blocked/bonuses.json", b"{}")]);
        let entries = [
            entry("items", "items.json"),
            entry("bonuses", "blocked/bonuses.json"),
        ];

        assert!(apply_verified_archive(
            root.path(),
            &manifest_for(
                &archive,
                &[("items.json", b"[]"), ("blocked/bonuses.json", b"{}")]
            ),
            &archive,
            &entries
        )
        .is_err());
        assert!(!root.path().join("items.json").exists());
        assert_eq!(
            std::fs::read(root.path().join("blocked")).unwrap(),
            b"existing"
        );
    }
}
