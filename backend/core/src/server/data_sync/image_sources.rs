use once_cell::sync::Lazy;
use serde_json::Value;
use std::path::{Path, PathBuf};
use tokio::sync::Mutex;

use super::image_helpers::{
    best_blizzard_asset_url, is_allowed_remote_image_url, is_http_url, localized_str,
    normalize_lookup_key,
};
use super::IMAGE_CACHE_VERSION;

pub(super) fn find_cached_image_file(
    images_dir: &Path,
    image_type: &str,
    id: u64,
) -> Option<PathBuf> {
    let candidates = [
        format!("{}-{}-{}.jpg", image_type, id, IMAGE_CACHE_VERSION),
        format!("{}-{}-{}.jpeg", image_type, id, IMAGE_CACHE_VERSION),
        format!("{}-{}-{}.png", image_type, id, IMAGE_CACHE_VERSION),
        format!("{}-{}-{}.webp", image_type, id, IMAGE_CACHE_VERSION),
        format!("{}-{}-{}.gif", image_type, id, IMAGE_CACHE_VERSION),
    ];

    for candidate in candidates {
        let path = images_dir.join(candidate);
        if path.exists() {
            return Some(path);
        }
    }

    None
}

pub(super) fn find_runtime_image_url(image_type: &str, id: u64) -> Option<String> {
    let runtime = crate::item_db::get_runtime_data();
    if let Some(details) = runtime.get("dungeon_details").and_then(|v| v.as_array()) {
        for detail in details {
            if image_type == "instance" && detail.get("id").and_then(|v| v.as_u64()) == Some(id) {
                if let Some(url) = detail
                    .get("image_url")
                    .and_then(|v| v.as_str())
                    .filter(|url| is_http_url(url))
                {
                    return Some(url.to_string());
                }
            }
            if image_type == "encounter" {
                let Some(raw_payload) = detail.get("blizzard_api_data") else {
                    continue;
                };
                if let Some(encounters) = raw_payload.get("encounters").and_then(|v| v.as_array()) {
                    for encounter in encounters {
                        if encounter.get("id").and_then(|v| v.as_u64()) == Some(id) {
                            if let Some(url) = encounter
                                .get("image_url")
                                .and_then(|v| v.as_str())
                                .filter(|url| is_http_url(url))
                            {
                                return Some(url.to_string());
                            }
                        }
                    }
                }
            }
        }
    }

    None
}

pub(super) fn journal_instance_candidates(instance_id: u64) -> Vec<u64> {
    let mut candidates = vec![instance_id];
    let runtime = crate::item_db::get_runtime_data();
    let Some(details) = runtime.get("dungeon_details").and_then(|v| v.as_array()) else {
        return candidates;
    };

    for detail in details {
        if detail.get("id").and_then(|v| v.as_u64()) != Some(instance_id) {
            continue;
        }
        if let Some(map_id) = detail.get("map_id").and_then(|v| v.as_u64()) {
            candidates.push(map_id);
        }
        if let Some(cm_id) = detail.get("challenge_mode_id").and_then(|v| v.as_u64()) {
            candidates.push(cm_id);
        }
        if let Some(href) = detail.get("blizzard_href").and_then(|v| v.as_str()) {
            if let Some(parsed) = href
                .split("/journal-instance/")
                .nth(1)
                .and_then(|tail| tail.split('?').next())
                .and_then(|raw| raw.parse::<u64>().ok())
            {
                candidates.push(parsed);
            }
        }
        if let Some(raw) = detail.get("blizzard_api_data") {
            if let Some(key_href) = raw
                .get("key")
                .and_then(|k| k.get("href"))
                .and_then(|h| h.as_str())
            {
                if let Some(parsed) = key_href
                    .split("/journal-instance/")
                    .nth(1)
                    .and_then(|tail| tail.split('?').next())
                    .and_then(|raw| raw.parse::<u64>().ok())
                {
                    candidates.push(parsed);
                }
            }
            if let Some(map_id) = raw
                .get("instance_map")
                .and_then(|m| m.get("id"))
                .and_then(|v| v.as_u64())
            {
                candidates.push(map_id);
            }
        }
    }

    candidates.sort_unstable();
    candidates.dedup();
    candidates
}

#[derive(Clone)]
struct JournalIndexCache {
    fetched_at: chrono::DateTime<chrono::Utc>,
    entries: Vec<(u64, String)>,
}

static JOURNAL_INDEX_CACHE: Lazy<Mutex<Option<JournalIndexCache>>> = Lazy::new(|| Mutex::new(None));

pub(super) fn runtime_dungeon_name_candidates(instance_id: u64) -> Vec<String> {
    let mut names = Vec::new();

    for instance in crate::item_db::instances() {
        if instance.get("id").and_then(|v| v.as_u64()) != Some(instance_id) {
            continue;
        }
        if let Some(name) = instance.get("name").and_then(|v| v.as_str()) {
            names.push(name.to_string());
        }
        if let Some(short_name) = instance.get("short_name").and_then(|v| v.as_str()) {
            names.push(short_name.to_string());
        }
    }

    let runtime = crate::item_db::get_runtime_data();
    if let Some(details) = runtime.get("dungeon_details").and_then(|v| v.as_array()) {
        for detail in details {
            if detail.get("id").and_then(|v| v.as_u64()) != Some(instance_id) {
                continue;
            }
            if let Some(name) = detail.get("name").and_then(|v| v.as_str()) {
                names.push(name.to_string());
            }
            if let Some(short_name) = detail.get("short_name").and_then(|v| v.as_str()) {
                names.push(short_name.to_string());
            }
            if let Some(raw) = detail.get("blizzard_api_data") {
                if let Some(name) = localized_str(raw.get("name")) {
                    names.push(name);
                }
                if let Some(short_name) = localized_str(raw.get("short_name")) {
                    names.push(short_name);
                }
            }
        }
    }

    names.sort_unstable();
    names.dedup();
    names
}

pub(super) async fn journal_index_entries_with_token(
    client: &reqwest::Client,
    token: &str,
) -> Vec<(u64, String)> {
    {
        let cache = JOURNAL_INDEX_CACHE.lock().await;
        if let Some(cached) = cache.as_ref() {
            let age = chrono::Utc::now().signed_duration_since(cached.fetched_at);
            if age.num_hours() < 6 {
                return cached.entries.clone();
            }
        }
    }

    let index_url = "https://us.api.blizzard.com/data/wow/journal-instance/index?namespace=static-us&locale=en_US";
    let response = match client.get(index_url).bearer_auth(token).send().await {
        Ok(res) => res,
        Err(_) => return Vec::new(),
    };
    if !response.status().is_success() {
        return Vec::new();
    }
    let payload: Value = match response.json().await {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };

    let mut entries = Vec::new();
    if let Some(instances) = payload.get("instances").and_then(|v| v.as_array()) {
        for item in instances {
            let Some(id) = item.get("id").and_then(|v| v.as_u64()) else {
                continue;
            };
            let Some(name) = localized_str(item.get("name")) else {
                continue;
            };
            entries.push((id, name));
        }
    }

    let mut cache = JOURNAL_INDEX_CACHE.lock().await;
    *cache = Some(JournalIndexCache {
        fetched_at: chrono::Utc::now(),
        entries: entries.clone(),
    });

    entries
}

pub(super) async fn journal_instance_id_from_names_with_token(
    client: &reqwest::Client,
    token: &str,
    names: &[String],
) -> Option<u64> {
    if names.is_empty() {
        return None;
    }
    let entries = journal_index_entries_with_token(client, token).await;
    if entries.is_empty() {
        return None;
    }

    let normalized_names: Vec<String> = names
        .iter()
        .map(|name| normalize_lookup_key(name))
        .filter(|v| !v.is_empty())
        .collect();

    for target in &normalized_names {
        if let Some((id, _)) = entries
            .iter()
            .find(|(_, name)| normalize_lookup_key(name) == *target)
        {
            return Some(*id);
        }
    }

    for target in &normalized_names {
        if let Some((id, _)) = entries.iter().find(|(_, name)| {
            let candidate = normalize_lookup_key(name);
            candidate.contains(target) || target.contains(&candidate)
        }) {
            return Some(*id);
        }
    }

    None
}

pub(super) async fn media_url_from_media_href(
    client: &reqwest::Client,
    token: &str,
    media_href: &str,
) -> Option<String> {
    let media_url = if media_href.contains("locale=") {
        media_href.to_string()
    } else if media_href.contains('?') {
        format!("{media_href}&locale=en_US")
    } else {
        format!("{media_href}?locale=en_US")
    };

    println!("[image-api] GET Blizzard media href: {}", media_url);
    let media_res = client
        .get(&media_url)
        .bearer_auth(token)
        .send()
        .await
        .ok()?;
    println!(
        "[image-api] Blizzard media href status: {} ({})",
        media_res.status(),
        media_url
    );
    if !media_res.status().is_success() {
        return None;
    }
    let media_json: Value = media_res.json().await.ok()?;
    let selected =
        best_blizzard_asset_url(&media_json).filter(|url| is_allowed_remote_image_url(url));
    if let Some(url) = &selected {
        println!("[image-api] Selected Blizzard media asset: {}", url);
    } else {
        println!("[image-api] No allowed Blizzard media asset in payload");
    }
    selected
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::item_db::state;
    use serde_json::json;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::mpsc;
    use std::thread;
    use tempfile::tempdir;

    #[test]
    fn find_cached_image_file_returns_first_existing_supported_extension() {
        let dir = tempdir().expect("temp image dir");
        let target = dir
            .path()
            .join(format!("instance-42-{}.png", IMAGE_CACHE_VERSION));
        std::fs::write(&target, b"png").expect("write cached image");
        std::fs::write(
            dir.path()
                .join(format!("instance-42-{}.webp", IMAGE_CACHE_VERSION)),
            b"webp",
        )
        .expect("write second cached image");

        let found = find_cached_image_file(dir.path(), "instance", 42).expect("cached image");
        assert_eq!(found, target);
    }

    #[test]
    fn runtime_image_lookups_and_journal_candidates_use_runtime_metadata() {
        let _guard = state::TEST_STATE_LOCK.lock().unwrap();
        let prev_runtime = state::RUNTIME_DATA.read().unwrap().clone();

        *state::RUNTIME_DATA.write().unwrap() = json!({
            "dungeon_details": [{
                "id": 321,
                "map_id": 654,
                "challenge_mode_id": 987,
                "blizzard_href": "https://us.api.blizzard.com/data/wow/journal-instance/4321?namespace=dynamic-us",
                "image_url": "https://cdn.example.com/dungeon.png",
                "blizzard_api_data": {
                    "key": {
                        "href": "https://us.api.blizzard.com/data/wow/journal-instance/8765?namespace=dynamic-us"
                    },
                    "instance_map": { "id": 654 },
                    "encounters": [{
                        "id": 555,
                        "image_url": "https://cdn.example.com/encounter.png"
                    }]
                }
            }]
        });

        assert_eq!(
            find_runtime_image_url("instance", 321),
            Some("https://cdn.example.com/dungeon.png".to_string())
        );
        assert_eq!(
            find_runtime_image_url("encounter", 555),
            Some("https://cdn.example.com/encounter.png".to_string())
        );
        assert_eq!(
            journal_instance_candidates(321),
            vec![321, 654, 987, 4321, 8765]
        );

        *state::RUNTIME_DATA.write().unwrap() = prev_runtime;
    }

    #[test]
    fn runtime_dungeon_name_candidates_merge_instance_and_runtime_names() {
        let _guard = state::TEST_STATE_LOCK.lock().unwrap();
        let prev_runtime = state::RUNTIME_DATA.read().unwrap().clone();
        let prev_instances = state::INSTANCES.read().unwrap().clone();

        *state::INSTANCES.write().unwrap() = vec![json!({
            "id": 77,
            "name": "Operation: Floodgate",
            "short_name": "Floodgate"
        })];
        *state::RUNTIME_DATA.write().unwrap() = json!({
            "dungeon_details": [{
                "id": 77,
                "name": "Operation: Floodgate",
                "short_name": "Floodgate",
                "blizzard_api_data": {
                    "name": {"en_US": "Operation: Floodgate"},
                    "short_name": {"en_US": "Op Flood"}
                }
            }]
        });

        assert_eq!(
            runtime_dungeon_name_candidates(77),
            vec![
                "Floodgate".to_string(),
                "Op Flood".to_string(),
                "Operation: Floodgate".to_string()
            ]
        );

        *state::RUNTIME_DATA.write().unwrap() = prev_runtime;
        *state::INSTANCES.write().unwrap() = prev_instances;
    }

    #[tokio::test]
    async fn journal_lookup_helpers_use_cached_entries_for_exact_and_partial_matches() {
        let mut cache = JOURNAL_INDEX_CACHE.lock().await;
        *cache = Some(JournalIndexCache {
            fetched_at: chrono::Utc::now(),
            entries: vec![
                (101, "Operation: Floodgate".to_string()),
                (202, "The MOTHERLODE!!".to_string()),
            ],
        });
        drop(cache);

        let client = reqwest::Client::new();
        let exact = journal_index_entries_with_token(&client, "ignored").await;
        assert_eq!(
            exact,
            vec![
                (101, "Operation: Floodgate".to_string()),
                (202, "The MOTHERLODE!!".to_string())
            ]
        );

        let exact_id = journal_instance_id_from_names_with_token(
            &client,
            "ignored",
            &["operation floodgate".to_string()],
        )
        .await;
        assert_eq!(exact_id, Some(101));

        let partial_id = journal_instance_id_from_names_with_token(
            &client,
            "ignored",
            &["motherlode".to_string()],
        )
        .await;
        assert_eq!(partial_id, Some(202));

        *JOURNAL_INDEX_CACHE.lock().await = None;
    }

    #[tokio::test]
    async fn media_url_from_media_href_appends_locale_and_filters_assets() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind listener");
        let addr = listener.local_addr().expect("listener addr");
        let (tx, rx) = mpsc::channel();

        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept request");
            let mut buffer = [0_u8; 4096];
            let read = stream.read(&mut buffer).expect("read request");
            let request = String::from_utf8_lossy(&buffer[..read]).to_string();
            let first_line = request.lines().next().unwrap_or_default().to_string();
            tx.send(first_line).expect("send request line");

            let body = r#"{"assets":[{"key":"tile","value":"https://render.worldofwarcraft.com/us/tile.jpg"},{"key":"icon","value":"https://example.com/icon.jpg"}]}"#;
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            stream
                .write_all(response.as_bytes())
                .expect("write response");
        });

        let client = reqwest::Client::new();
        let url = format!("http://{}/media/path", addr);
        let selected = media_url_from_media_href(&client, "token", &url).await;

        assert_eq!(
            selected,
            Some("https://render.worldofwarcraft.com/us/tile.jpg".to_string())
        );
        let request_line = rx.recv().expect("request line");
        assert!(request_line.contains("/media/path?locale=en_US"));

        server.join().expect("server join");
    }
}
