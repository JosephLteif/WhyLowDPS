use actix_web::{web, HttpResponse};
use serde::Deserialize;
use std::sync::Arc;
use uuid::Uuid;

use crate::models::SavedRoute;
use crate::storage::JobStorage;

#[derive(Deserialize)]
pub struct CreateRouteRequest {
    pub name: String,
    pub dungeon: String,
    pub level: Option<i32>,
    pub pull_count: Option<i32>,
    pub timer_seconds: Option<i32>,
    pub affixes: Option<String>,
    pub route_data: String,
}

pub async fn save_route(
    body: web::Json<CreateRouteRequest>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    let route = SavedRoute {
        id: Uuid::new_v4().to_string(),
        name: body.name.clone(),
        dungeon: body.dungeon.clone(),
        level: body.level,
        pull_count: body.pull_count,
        timer_seconds: body.timer_seconds,
        affixes: body.affixes.clone(),
        route_data: body.route_data.clone(),
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    store.save_route(route.clone());
    HttpResponse::Ok().json(route)
}

pub async fn list_routes(store: web::Data<Arc<dyn JobStorage>>) -> HttpResponse {
    let routes = store.list_routes();
    HttpResponse::Ok().json(routes)
}

pub async fn delete_route(
    id: web::Path<String>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    store.delete_route(&id);
    HttpResponse::Ok().json(serde_json::json!({ "status": "deleted" }))
}
