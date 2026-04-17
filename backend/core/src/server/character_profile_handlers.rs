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
        body.realm.to_lowercase().replace(' ', "-").replace('\'', ""),
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