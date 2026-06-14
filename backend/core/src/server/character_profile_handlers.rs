use actix_web::{web, HttpResponse};
use serde::Deserialize;
use std::sync::Arc;

use crate::models::SavedCharacterProfile;
use crate::storage::JobStorage;

#[derive(Deserialize)]
pub struct SaveProfileRequest {
    pub name: String,
    pub realm: String,
    pub region: String,
    pub class: Option<String>,
    pub spec: Option<String>,
    pub simc_input: String,
}

pub async fn save_character_profile(
    body: web::Json<SaveProfileRequest>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    // Use deterministic ID based on character identity to avoid duplicates
    let id = format!(
        "{}-{}-{}",
        body.region.to_lowercase(),
        body.realm
            .to_lowercase()
            .replace(' ', "-")
            .replace('\'', ""),
        body.name.to_lowercase()
    );
    let profile = SavedCharacterProfile {
        id,
        name: body.name.clone(),
        realm: body.realm.clone(),
        region: body.region.clone(),
        class: body.class.clone(),
        spec: body.spec.clone(),
        simc_input: body.simc_input.clone(),
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    store.save_character_profile(profile.clone());
    HttpResponse::Ok().json(profile)
}

#[derive(Deserialize)]
pub struct ListProfilesQuery {
    pub name: Option<String>,
    pub realm: Option<String>,
    pub region: Option<String>,
}

pub async fn list_character_profiles(
    query: web::Query<ListProfilesQuery>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    let profiles = store.list_character_profiles(
        query.name.as_deref(),
        query.realm.as_deref(),
        query.region.as_deref(),
    );
    HttpResponse::Ok().json(profiles)
}

pub async fn delete_character_profile(
    id: web::Path<String>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    store.delete_character_profile(&id);
    HttpResponse::Ok().json(serde_json::json!({ "status": "deleted" }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::{JobStorage, MemoryStorage};
    use actix_web::body::to_bytes;
    use serde_json::Value;

    fn test_store() -> web::Data<Arc<dyn JobStorage>> {
        web::Data::new(Arc::new(MemoryStorage::new()) as Arc<dyn JobStorage>)
    }

    #[actix_web::test]
    async fn save_profile_generates_stable_id_and_round_trips_through_list_and_delete() {
        let store = test_store();
        let req = SaveProfileRequest {
            name: "Thrall".to_string(),
            realm: "Area 52".to_string(),
            region: "US".to_string(),
            class: Some("shaman".to_string()),
            spec: Some("enhancement".to_string()),
            simc_input: "shaman=Thrall".to_string(),
        };

        let resp = save_character_profile(web::Json(req), store.clone()).await;
        assert_eq!(resp.status(), 200);
        let bytes = to_bytes(resp.into_body()).await.expect("save body");
        let saved: Value = serde_json::from_slice(&bytes).expect("saved json");
        assert_eq!(saved.get("id").and_then(Value::as_str), Some("us-area-52-thrall"));

        let listed = list_character_profiles(
            web::Query(ListProfilesQuery {
                name: Some("thrall".to_string()),
                realm: Some("area 52".to_string()),
                region: Some("us".to_string()),
            }),
            store.clone(),
        )
        .await;
        let listed_bytes = to_bytes(listed.into_body()).await.expect("list body");
        let rows: Vec<Value> = serde_json::from_slice(&listed_bytes).expect("list json");
        assert_eq!(rows.len(), 1);
        let id = rows[0]
            .get("id")
            .and_then(Value::as_str)
            .expect("saved id")
            .to_string();

        let deleted = delete_character_profile(web::Path::from(id), store.clone()).await;
        assert_eq!(deleted.status(), 200);

        let listed_after = list_character_profiles(
            web::Query(ListProfilesQuery {
                name: None,
                realm: None,
                region: None,
            }),
            store,
        )
        .await;
        let listed_after_bytes = to_bytes(listed_after.into_body())
            .await
            .expect("list body after delete");
        let rows_after: Vec<Value> =
            serde_json::from_slice(&listed_after_bytes).expect("list json after delete");
        assert!(rows_after.is_empty());
    }

    #[actix_web::test]
    async fn save_profile_strips_apostrophes_and_empty_filters_list_all_profiles() {
        let store = test_store();

        let first = SaveProfileRequest {
            name: "Kael".to_string(),
            realm: "Mal'Ganis".to_string(),
            region: "US".to_string(),
            class: Some("mage".to_string()),
            spec: Some("fire".to_string()),
            simc_input: "mage=Kael".to_string(),
        };
        let second = SaveProfileRequest {
            name: "Jaina".to_string(),
            realm: "Proudmoore".to_string(),
            region: "US".to_string(),
            class: Some("mage".to_string()),
            spec: Some("frost".to_string()),
            simc_input: "mage=Jaina".to_string(),
        };

        let first_resp = save_character_profile(web::Json(first), store.clone()).await;
        let first_bytes = to_bytes(first_resp.into_body()).await.expect("first body");
        let first_saved: Value = serde_json::from_slice(&first_bytes).expect("first json");
        assert_eq!(
            first_saved.get("id").and_then(Value::as_str),
            Some("us-malganis-kael")
        );

        let second_resp = save_character_profile(web::Json(second), store.clone()).await;
        assert_eq!(second_resp.status(), 200);

        let listed = list_character_profiles(
            web::Query(ListProfilesQuery {
                name: None,
                realm: None,
                region: None,
            }),
            store,
        )
        .await;
        let listed_bytes = to_bytes(listed.into_body()).await.expect("list body");
        let rows: Vec<Value> = serde_json::from_slice(&listed_bytes).expect("list json");
        assert_eq!(rows.len(), 2);
    }
}
