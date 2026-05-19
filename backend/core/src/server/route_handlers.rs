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
    async fn save_route_lists_then_deletes_route() {
        let store = test_store();
        let req = CreateRouteRequest {
            name: "Weekly Push".to_string(),
            dungeon: "Operation: Floodgate".to_string(),
            level: Some(12),
            pull_count: Some(34),
            timer_seconds: Some(1950),
            affixes: Some("Tyrannical,Spiteful,Volcanic".to_string()),
            route_data: "{\"pulls\":[1,2,3]}".to_string(),
        };

        let created = save_route(web::Json(req), store.clone()).await;
        assert_eq!(created.status(), 200);
        let created_bytes = to_bytes(created.into_body()).await.expect("create body");
        let created_json: Value = serde_json::from_slice(&created_bytes).expect("create json");
        let route_id = created_json
            .get("id")
            .and_then(Value::as_str)
            .expect("route id")
            .to_string();
        assert_eq!(
            created_json.get("dungeon").and_then(Value::as_str),
            Some("Operation: Floodgate")
        );

        let listed = list_routes(store.clone()).await;
        let listed_bytes = to_bytes(listed.into_body()).await.expect("list body");
        let rows: Vec<Value> = serde_json::from_slice(&listed_bytes).expect("list json");
        assert_eq!(rows.len(), 1);
        assert_eq!(
            rows[0].get("name").and_then(Value::as_str),
            Some("Weekly Push")
        );

        let deleted = delete_route(web::Path::from(route_id), store.clone()).await;
        assert_eq!(deleted.status(), 200);

        let listed_after = list_routes(store).await;
        let listed_after_bytes = to_bytes(listed_after.into_body())
            .await
            .expect("list body after delete");
        let rows_after: Vec<Value> =
            serde_json::from_slice(&listed_after_bytes).expect("list json after delete");
        assert!(rows_after.is_empty());
    }
}
