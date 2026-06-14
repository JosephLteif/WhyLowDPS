use serde::Deserialize;
use std::path::{Path, PathBuf};

use super::EMBEDDED_DATA_MANIFEST;

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(super) enum DataFileSource {
    Raidbots,
    Blizzard,
    Local,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub(super) enum DataFileEntryType {
    #[default]
    File,
    Directory,
}

#[derive(Debug, Clone, Deserialize)]
struct DataManifest {
    files: Vec<DataManifestEntry>,
}

#[derive(Debug, Clone, Deserialize)]
struct DataManifestEntry {
    key: String,
    label: String,
    section: String,
    source: DataFileSource,
    remote_path: Option<String>,
    local_path: String,
    required: bool,
    #[serde(default)]
    entry_type: DataFileEntryType,
    bundled_path: Option<String>,
}

#[derive(Clone)]
pub(super) struct DataFileEntry {
    pub(super) key: String,
    pub(super) label: String,
    pub(super) section: String,
    pub(super) source: DataFileSource,
    pub(super) remote_path: Option<String>,
    pub(super) local_path: String,
    pub(super) required: bool,
    pub(super) entry_type: DataFileEntryType,
    pub(super) bundled_path: Option<String>,
}

impl From<DataManifestEntry> for DataFileEntry {
    fn from(value: DataManifestEntry) -> Self {
        Self {
            key: value.key,
            label: value.label,
            section: value.section,
            source: value.source,
            remote_path: value.remote_path,
            local_path: value.local_path,
            required: value.required,
            entry_type: value.entry_type,
            bundled_path: value.bundled_path,
        }
    }
}

fn data_manifest_path() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("resources")
        .join("data-manifest.json")
}

pub(super) fn data_file_catalog() -> Result<Vec<DataFileEntry>, String> {
    let manifest_path = data_manifest_path();
    let content = match std::fs::read_to_string(&manifest_path) {
        Ok(content) => content,
        Err(err) => {
            // Release bundles don't have the source checkout path; use embedded manifest fallback.
            eprintln!(
                "Failed to read data manifest at {}: {}. Falling back to embedded manifest.",
                manifest_path.display(),
                err
            );
            EMBEDDED_DATA_MANIFEST.to_string()
        }
    };
    let parsed: DataManifest = serde_json::from_str(&content).map_err(|err| {
        format!(
            "Failed to parse data manifest at {}: {}",
            manifest_path.display(),
            err
        )
    })?;
    Ok(parsed.files.into_iter().map(DataFileEntry::from).collect())
}

pub(super) fn resolve_catalog_path(root: &Path, entry: &DataFileEntry) -> PathBuf {
    let runtime = root.join(&entry.local_path);
    for candidate in path_variants_with_json_alias(&runtime) {
        if candidate.exists() {
            return candidate;
        }
    }

    if let Some(bundled_path) = &entry.bundled_path {
        let dev_bundled = Path::new(env!("CARGO_MANIFEST_DIR")).join(bundled_path);
        for candidate in path_variants_with_json_alias(&dev_bundled) {
            if candidate.exists() {
                return candidate;
            }
        }

        if let Some(exe_dir) = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        {
            if let Some(file_name) = Path::new(bundled_path).file_name() {
                let exe_bundled = exe_dir.join("resources").join(file_name);
                for candidate in path_variants_with_json_alias(&exe_bundled) {
                    if candidate.exists() {
                        return candidate;
                    }
                }
            }
        }
    }

    runtime
}

pub(super) fn resolve_runtime_path(root: &Path, entry: &DataFileEntry) -> PathBuf {
    let runtime = root.join(&entry.local_path);
    for candidate in path_variants_with_json_alias(&runtime) {
        if candidate.exists() {
            return candidate;
        }
    }
    runtime
}

fn resolve_bundled_path(entry: &DataFileEntry) -> Option<PathBuf> {
    let bundled_path = entry.bundled_path.as_ref()?;

    let dev_bundled = Path::new(env!("CARGO_MANIFEST_DIR")).join(bundled_path);
    for candidate in path_variants_with_json_alias(&dev_bundled) {
        if candidate.exists() {
            return Some(candidate);
        }
    }

    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))?;
    let file_name = Path::new(bundled_path).file_name()?;
    let exe_bundled = exe_dir.join("resources").join(file_name);
    path_variants_with_json_alias(&exe_bundled)
        .into_iter()
        .find(|candidate| candidate.exists())
}

pub(super) fn restore_local_file_from_bundle(
    root: &Path,
    entry: &DataFileEntry,
) -> Result<(), String> {
    let source = resolve_bundled_path(entry).ok_or_else(|| {
        format!(
            "Bundled source is unavailable for {} ({})",
            entry.key, entry.local_path
        )
    })?;
    let target = root.join(&entry.local_path);
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory for {}: {}", target.display(), e))?;
    }
    std::fs::copy(&source, &target).map_err(|e| {
        format!(
            "Failed to restore {} from bundled copy {}: {}",
            target.display(),
            source.display(),
            e
        )
    })?;
    Ok(())
}

pub(super) fn path_variants_with_json_alias(path: &Path) -> Vec<PathBuf> {
    let mut out = vec![path.to_path_buf()];
    match path.extension().and_then(|ext| ext.to_str()) {
        Some("json") => {
            out.push(path.with_extension(""));
        }
        None => {
            out.push(path.with_extension("json"));
        }
        _ => {}
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn test_entry(local_path: &str) -> DataFileEntry {
        DataFileEntry {
            key: "test".to_string(),
            label: "Test".to_string(),
            section: "Test".to_string(),
            source: DataFileSource::Raidbots,
            remote_path: Some(local_path.to_string()),
            local_path: local_path.to_string(),
            required: true,
            entry_type: DataFileEntryType::File,
            bundled_path: None,
        }
    }

    #[test]
    fn path_variants_adds_extensionless_alias_for_json_files() {
        let variants = path_variants_with_json_alias(Path::new("metadata.json"));

        assert_eq!(
            variants,
            vec![PathBuf::from("metadata.json"), PathBuf::from("metadata")]
        );
    }

    #[test]
    fn path_variants_adds_json_alias_for_extensionless_files() {
        let variants = path_variants_with_json_alias(Path::new("metadata"));

        assert_eq!(
            variants,
            vec![PathBuf::from("metadata"), PathBuf::from("metadata.json")]
        );
    }

    #[test]
    fn resolve_runtime_path_prefers_existing_json_alias() {
        let temp = tempfile::tempdir().expect("temp dir");
        std::fs::write(temp.path().join("metadata"), "{}").expect("write alias");
        let entry = test_entry("metadata.json");

        let resolved = resolve_runtime_path(temp.path(), &entry);

        assert_eq!(resolved, temp.path().join("metadata"));
    }

    #[test]
    fn resolve_catalog_path_falls_back_to_existing_bundled_file() {
        let temp = tempfile::tempdir().expect("temp dir");
        let bundled = Path::new(env!("CARGO_MANIFEST_DIR")).join("../resources/data-manifest.json");
        let entry = DataFileEntry {
            key: "manifest".to_string(),
            label: "Manifest".to_string(),
            section: "Test".to_string(),
            source: DataFileSource::Local,
            remote_path: None,
            local_path: "missing/data-manifest.json".to_string(),
            required: true,
            entry_type: DataFileEntryType::File,
            bundled_path: Some("../resources/data-manifest.json".to_string()),
        };

        let resolved = resolve_catalog_path(temp.path(), &entry);

        assert_eq!(resolved, bundled);
        assert!(resolved.exists());
    }

    #[test]
    fn restore_local_file_from_bundle_copies_bundled_source_into_runtime_root() {
        let temp = tempfile::tempdir().expect("temp dir");
        let entry = DataFileEntry {
            key: "manifest_copy".to_string(),
            label: "Manifest Copy".to_string(),
            section: "Test".to_string(),
            source: DataFileSource::Local,
            remote_path: None,
            local_path: "nested/copied-manifest.json".to_string(),
            required: true,
            entry_type: DataFileEntryType::File,
            bundled_path: Some("../resources/data-manifest.json".to_string()),
        };

        restore_local_file_from_bundle(temp.path(), &entry).expect("restore bundled file");

        let copied = temp.path().join("nested").join("copied-manifest.json");
        assert!(copied.exists());
        assert_eq!(
            fs::read_to_string(&copied).expect("copied manifest"),
            fs::read_to_string(
                Path::new(env!("CARGO_MANIFEST_DIR")).join("../resources/data-manifest.json")
            )
            .expect("source manifest")
        );
    }
}
