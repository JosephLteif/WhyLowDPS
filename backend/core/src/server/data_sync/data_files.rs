use actix_web::{web, HttpResponse};
use serde::Serialize;
use serde_json::json;
use std::path::PathBuf;

use super::catalog::{data_file_catalog, resolve_runtime_path, DataFileEntryType, DataFileSource};
use super::image_helpers::is_previewable_file;
use super::zones_index::resolve_data_file_read_path;

#[derive(Debug, Clone, Serialize)]
pub struct DataFileState {
    pub key: String,
    pub label: String,
    pub section: String,
    pub relative_path: String,
    pub resolved_path: String,
    pub required: bool,
    pub downloadable: bool,
    pub exists: bool,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct DataFilePreviewResponse {
    pub key: String,
    pub label: String,
    pub relative_path: String,
    pub resolved_path: String,
    pub content: String,
    pub truncated: bool,
}

pub async fn get_data_file_states(data_dir: web::Data<Option<PathBuf>>) -> HttpResponse {
    let catalog = match data_file_catalog() {
        Ok(entries) => entries,
        Err(err) => {
            return HttpResponse::InternalServerError().json(json!({
                "detail": err,
            }));
        }
    };

    let Some(root) = data_dir.get_ref().clone() else {
        let empty_files: Vec<DataFileState> = Vec::new();
        return HttpResponse::Ok().json(json!({
            "base_path": null,
            "available": false,
            "files": empty_files,
        }));
    };

    let files: Vec<DataFileState> = catalog
        .iter()
        .map(|entry| {
            let path = if entry.entry_type == DataFileEntryType::Directory {
                resolve_runtime_path(&root, entry)
            } else {
                resolve_data_file_read_path(&root, entry)
            };
            let metadata = std::fs::metadata(&path).ok();
            let is_dir = entry.entry_type == DataFileEntryType::Directory
                || metadata.as_ref().map(|m| m.is_dir()).unwrap_or(false);
            let size_bytes = if is_dir {
                0
            } else {
                metadata.as_ref().map(|m| m.len()).unwrap_or(0)
            };
            DataFileState {
                key: entry.key.clone(),
                label: entry.label.clone(),
                section: entry.section.clone(),
                relative_path: entry.local_path.clone(),
                resolved_path: path.display().to_string(),
                required: entry.required,
                downloadable: entry.entry_type == DataFileEntryType::File
                    && ((entry.source == DataFileSource::Raidbots && entry.remote_path.is_some())
                        || (entry.source == DataFileSource::Local && entry.bundled_path.is_some())),
                exists: metadata.is_some(),
                size_bytes,
            }
        })
        .collect();

    HttpResponse::Ok().json(json!({
        "base_path": root,
        "available": true,
        "files": files,
    }))
}

pub async fn get_data_file_content(
    path: web::Path<String>,
    data_dir: web::Data<Option<PathBuf>>,
) -> HttpResponse {
    let key = path.into_inner();
    let catalog = match data_file_catalog() {
        Ok(entries) => entries,
        Err(err) => {
            return HttpResponse::InternalServerError().json(json!({
                "detail": err,
            }));
        }
    };
    let Some(root) = data_dir.get_ref().clone() else {
        return HttpResponse::BadRequest().json(json!({"detail": "Data directory is unavailable"}));
    };

    let Some(entry) = catalog.iter().find(|e| e.key == key) else {
        return HttpResponse::NotFound().json(json!({"detail": "Unknown data file key"}));
    };

    if entry.entry_type == DataFileEntryType::Directory {
        return HttpResponse::BadRequest()
            .json(json!({"detail": "Directories do not have file content"}));
    }

    if !is_previewable_file(&entry.local_path) {
        return HttpResponse::BadRequest()
            .json(json!({"detail": "This file type is not previewable"}));
    }

    let path = resolve_data_file_read_path(&root, entry);

    let metadata = match std::fs::metadata(&path) {
        Ok(metadata) => metadata,
        Err(_) => return HttpResponse::NotFound().json(json!({"detail": "File not found"})),
    };

    if metadata.is_dir() {
        return HttpResponse::BadRequest()
            .json(json!({"detail": "Directories do not have file content"}));
    }

    let content = match std::fs::read_to_string(&path) {
        Ok(content) => content,
        Err(err) => {
            return HttpResponse::InternalServerError()
                .json(json!({"detail": format!("Failed to read file: {}", err)}));
        }
    };
    let no_truncate_keys = ["runtime_wowhead_zones_index"];
    let should_truncate = !no_truncate_keys.contains(&entry.key.as_str());
    let max_preview_len = 250_000usize;
    let truncated = should_truncate && content.len() > max_preview_len;
    let preview = if truncated {
        content.chars().take(max_preview_len).collect::<String>()
    } else {
        content
    };

    HttpResponse::Ok().json(DataFilePreviewResponse {
        key: entry.key.clone(),
        label: entry.label.clone(),
        relative_path: entry.local_path.clone(),
        resolved_path: path.display().to_string(),
        content: preview,
        truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::body::to_bytes;
    use serde_json::Value;

    #[actix_web::test]
    async fn data_file_states_report_unavailable_when_data_dir_is_missing() {
        let resp = get_data_file_states(web::Data::new(None)).await;
        assert_eq!(resp.status(), 200);

        let body = to_bytes(resp.into_body()).await.expect("states body");
        let payload: Value = serde_json::from_slice(&body).expect("states json");
        assert_eq!(payload["available"].as_bool(), Some(false));
        assert!(payload["base_path"].is_null());
        assert!(payload["files"].as_array().is_some_and(Vec::is_empty));
    }

    #[actix_web::test]
    async fn data_file_states_report_existing_files_with_size_and_flags() {
        let temp = tempfile::tempdir().expect("temp dir");
        std::fs::write(temp.path().join("metadata.json"), "{}").expect("write metadata");

        let resp = get_data_file_states(web::Data::new(Some(temp.path().to_path_buf()))).await;
        assert_eq!(resp.status(), 200);

        let body = to_bytes(resp.into_body()).await.expect("states body");
        let payload: Value = serde_json::from_slice(&body).expect("states json");
        assert_eq!(payload["available"].as_bool(), Some(true));

        let metadata = payload["files"]
            .as_array()
            .expect("files array")
            .iter()
            .find(|file| file.get("key").and_then(Value::as_str) == Some("metadata"))
            .expect("metadata state");
        assert_eq!(metadata["exists"].as_bool(), Some(true));
        assert_eq!(metadata["required"].as_bool(), Some(true));
        assert_eq!(metadata["downloadable"].as_bool(), Some(true));
        assert_eq!(metadata["size_bytes"].as_u64(), Some(2));
        assert!(metadata["resolved_path"]
            .as_str()
            .is_some_and(|path| path.ends_with("metadata.json")));
    }

    #[actix_web::test]
    async fn data_file_content_rejects_missing_dir_unknown_key_and_directories() {
        let missing_dir = get_data_file_content(
            web::Path::from("metadata".to_string()),
            web::Data::new(None),
        )
        .await;
        assert_eq!(missing_dir.status(), 400);

        let temp = tempfile::tempdir().expect("temp dir");
        let unknown = get_data_file_content(
            web::Path::from("does_not_exist".to_string()),
            web::Data::new(Some(temp.path().to_path_buf())),
        )
        .await;
        assert_eq!(unknown.status(), 404);

        std::fs::create_dir_all(temp.path().join("instance-images")).expect("create image dir");
        let directory = get_data_file_content(
            web::Path::from("instance_images_dir".to_string()),
            web::Data::new(Some(temp.path().to_path_buf())),
        )
        .await;
        assert_eq!(directory.status(), 400);
    }

    #[actix_web::test]
    async fn data_file_content_truncates_previewable_files_except_zones_index() {
        let temp = tempfile::tempdir().expect("temp dir");
        let long_metadata = "x".repeat(250_100);
        std::fs::write(temp.path().join("metadata.json"), &long_metadata).expect("write metadata");
        std::fs::write(
            temp.path().join("zones-encounters-index.json"),
            "z".repeat(250_100),
        )
        .expect("write zones index");

        let metadata = get_data_file_content(
            web::Path::from("metadata".to_string()),
            web::Data::new(Some(temp.path().to_path_buf())),
        )
        .await;
        assert_eq!(metadata.status(), 200);
        let body = to_bytes(metadata.into_body()).await.expect("metadata body");
        let payload: Value = serde_json::from_slice(&body).expect("metadata json");
        assert_eq!(payload["truncated"].as_bool(), Some(true));
        assert_eq!(payload["content"].as_str().map(str::len), Some(250_000));

        let zones = get_data_file_content(
            web::Path::from("runtime_wowhead_zones_index".to_string()),
            web::Data::new(Some(temp.path().to_path_buf())),
        )
        .await;
        assert_eq!(zones.status(), 200);
        let body = to_bytes(zones.into_body()).await.expect("zones body");
        let payload: Value = serde_json::from_slice(&body).expect("zones json");
        assert_eq!(payload["truncated"].as_bool(), Some(false));
        assert_eq!(payload["content"].as_str().map(str::len), Some(250_100));
    }
}
