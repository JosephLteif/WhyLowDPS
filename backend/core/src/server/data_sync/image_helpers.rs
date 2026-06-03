use actix_web::{http::StatusCode, HttpResponse};
use serde_json::{json, Value};
use std::path::Path;

pub(super) fn is_previewable_file(relative_path: &str) -> bool {
    matches!(
        Path::new(relative_path)
            .extension()
            .and_then(|ext| ext.to_str()),
        Some("json" | "txt" | "lua" | "csv" | "xml" | "tsv")
    )
}

pub(super) fn is_http_url(url: &str) -> bool {
    let lowered = url.to_ascii_lowercase();
    lowered.starts_with("https://") || lowered.starts_with("http://")
}

pub(super) fn is_allowed_remote_image_url(url: &str) -> bool {
    let Ok(parsed) = reqwest::Url::parse(url) else {
        return false;
    };
    let Some(host) = parsed.host_str() else {
        return false;
    };
    let host = host.to_ascii_lowercase();
    host == "blizzard.com"
        || host.ends_with(".blizzard.com")
        || host == "battle.net"
        || host.ends_with(".battle.net")
        || host == "worldofwarcraft.com"
        || host.ends_with(".worldofwarcraft.com")
}

pub(super) fn infer_image_extension(url: &str) -> &'static str {
    let Ok(parsed) = reqwest::Url::parse(url) else {
        return "jpg";
    };
    let path = parsed.path().to_ascii_lowercase();
    if path.ends_with(".png") {
        return "png";
    }
    if path.ends_with(".webp") {
        return "webp";
    }
    if path.ends_with(".gif") {
        return "gif";
    }
    if path.ends_with(".jpeg") {
        return "jpeg";
    }
    "jpg"
}

pub(super) fn content_type_for_extension(ext: &str) -> &'static str {
    match ext {
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "jpeg" | "jpg" => "image/jpeg",
        _ => "application/octet-stream",
    }
}

pub(super) fn image_error_response(status: StatusCode, reason: &str) -> HttpResponse {
    HttpResponse::build(status).json(json!({
        "detail": format!("Image unavailable: {}", reason),
        "reason": reason,
    }))
}

pub(super) fn localized_str(value: Option<&Value>) -> Option<String> {
    let value = value?;
    if let Some(raw) = value.as_str() {
        return Some(raw.to_string());
    }
    if let Some(obj) = value.as_object() {
        if let Some(en) = obj.get("en_US").and_then(|v| v.as_str()) {
            return Some(en.to_string());
        }
        if let Some(any) = obj.values().find_map(|v| v.as_str()) {
            return Some(any.to_string());
        }
    }
    None
}

pub(super) fn normalize_lookup_key(input: &str) -> String {
    input
        .to_ascii_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect()
}

pub(super) fn best_blizzard_asset_url(media_json: &Value) -> Option<String> {
    let assets = media_json.get("assets").and_then(|v| v.as_array())?;
    let preferred_keys = ["tile", "splash", "header", "main", "icon", "image"];
    for key in preferred_keys {
        if let Some(url) = assets.iter().find_map(|asset| {
            let matches_key = asset
                .get("key")
                .and_then(|v| v.as_str())
                .map(|k| k.eq_ignore_ascii_case(key))
                .unwrap_or(false);
            if !matches_key {
                return None;
            }
            asset
                .get("value")
                .and_then(|v| v.as_str())
                .map(str::to_string)
        }) {
            return Some(url);
        }
    }
    assets.iter().find_map(|asset| {
        asset
            .get("value")
            .and_then(|v| v.as_str())
            .map(str::to_string)
    })
}

pub(super) fn media_url_from_entity_payload(entity_json: &Value) -> Option<String> {
    if let Some(url) = entity_json
        .get("media")
        .and_then(best_blizzard_asset_url)
        .filter(|url| is_allowed_remote_image_url(url))
    {
        return Some(url);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn image_url_helpers_allow_only_expected_remote_hosts() {
        assert!(is_http_url("HTTP://example.com/image.jpg"));
        assert!(is_allowed_remote_image_url(
            "https://render.worldofwarcraft.com/us/icon.jpg"
        ));
        assert!(is_allowed_remote_image_url(
            "https://assets.blizzard.com/wow/media.png"
        ));

        assert!(!is_http_url("file:///tmp/icon.jpg"));
        assert!(!is_allowed_remote_image_url(
            "https://example.com/render.worldofwarcraft.com/icon.jpg"
        ));
        assert!(!is_allowed_remote_image_url("not a url"));
    }

    #[test]
    fn image_extension_helpers_use_url_path_and_known_content_types() {
        assert_eq!(
            infer_image_extension("https://render.worldofwarcraft.com/us/icon.PNG?x=1"),
            "png"
        );
        assert_eq!(
            infer_image_extension("https://render.worldofwarcraft.com/us/icon.webp"),
            "webp"
        );
        assert_eq!(infer_image_extension("bad url"), "jpg");
        assert_eq!(content_type_for_extension("png"), "image/png");
        assert_eq!(content_type_for_extension("jpeg"), "image/jpeg");
        assert_eq!(
            content_type_for_extension("bin"),
            "application/octet-stream"
        );
    }

    #[test]
    fn localized_and_lookup_helpers_normalize_api_values() {
        assert_eq!(
            localized_str(Some(&json!("Raw Name"))),
            Some("Raw Name".to_string())
        );
        assert_eq!(
            localized_str(Some(&json!({ "de_DE": "Anderer", "en_US": "English" }))),
            Some("English".to_string())
        );
        assert_eq!(
            localized_str(Some(&json!({ "de_DE": "Anderer" }))),
            Some("Anderer".to_string())
        );
        assert_eq!(localized_str(Some(&json!(123))), None);
        assert_eq!(
            normalize_lookup_key("Ara-Kara, City of Echoes!"),
            "arakaracityofechoes"
        );
    }

    #[test]
    fn media_asset_helpers_prefer_tile_and_reject_untrusted_hosts() {
        let media = json!({
            "assets": [
                { "key": "image", "value": "https://render.worldofwarcraft.com/us/fallback.jpg" },
                { "key": "tile", "value": "https://render.worldofwarcraft.com/us/tile.jpg" }
            ]
        });
        assert_eq!(
            best_blizzard_asset_url(&media),
            Some("https://render.worldofwarcraft.com/us/tile.jpg".to_string())
        );

        assert_eq!(
            media_url_from_entity_payload(&json!({ "media": media })),
            Some("https://render.worldofwarcraft.com/us/tile.jpg".to_string())
        );
        assert_eq!(
            media_url_from_entity_payload(&json!({
                "media": { "assets": [{ "key": "tile", "value": "https://example.com/tile.jpg" }] }
            })),
            None
        );
    }
}
