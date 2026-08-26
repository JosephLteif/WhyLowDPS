use actix_web::{web, HttpRequest, HttpResponse};
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
    req: HttpRequest,
    auth: web::Data<Arc<crate::server::auth_handlers::BlizzardAuthState>>,
    body: web::Json<CreateRouteRequest>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    let owner_id = crate::server::auth_handlers::request_owner_id(
        &req,
        auth.get_ref(),
        store.get_ref().as_ref(),
    );
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
    store.save_route_owned(&owner_id, route.clone());
    HttpResponse::Ok().json(route)
}

pub async fn list_routes(
    req: HttpRequest,
    auth: web::Data<Arc<crate::server::auth_handlers::BlizzardAuthState>>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    let owner_id = crate::server::auth_handlers::request_owner_id(
        &req,
        auth.get_ref(),
        store.get_ref().as_ref(),
    );
    let routes = store.list_routes_owned(&owner_id);
    HttpResponse::Ok().json(routes)
}

pub async fn delete_route(
    req: HttpRequest,
    auth: web::Data<Arc<crate::server::auth_handlers::BlizzardAuthState>>,
    id: web::Path<String>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    let owner_id = crate::server::auth_handlers::request_owner_id(
        &req,
        auth.get_ref(),
        store.get_ref().as_ref(),
    );
    store.delete_route_owned(&owner_id, &id);
    HttpResponse::Ok().json(serde_json::json!({ "status": "deleted" }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::{JobStorage, MemoryStorage};
    use actix_web::body::to_bytes;
    use actix_web::test::TestRequest;
    use serde_json::Value;

    fn test_store() -> web::Data<Arc<dyn JobStorage>> {
        web::Data::new(Arc::new(MemoryStorage::new()) as Arc<dyn JobStorage>)
    }

    fn test_auth() -> web::Data<Arc<crate::server::auth_handlers::BlizzardAuthState>> {
        web::Data::new(Arc::new(
            crate::server::auth_handlers::BlizzardAuthState::new(
                None,
                None,
                "http://localhost/callback".to_string(),
                "test-secret".to_string(),
            ),
        ))
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

        let created = save_route(
            TestRequest::default().to_http_request(),
            test_auth(),
            web::Json(req),
            store.clone(),
        )
        .await;
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

        let listed = list_routes(
            TestRequest::default().to_http_request(),
            test_auth(),
            store.clone(),
        )
        .await;
        let listed_bytes = to_bytes(listed.into_body()).await.expect("list body");
        let rows: Vec<Value> = serde_json::from_slice(&listed_bytes).expect("list json");
        assert_eq!(rows.len(), 1);
        assert_eq!(
            rows[0].get("name").and_then(Value::as_str),
            Some("Weekly Push")
        );

        let deleted = delete_route(
            TestRequest::default().to_http_request(),
            test_auth(),
            web::Path::from(route_id),
            store.clone(),
        )
        .await;
        assert_eq!(deleted.status(), 200);

        let listed_after =
            list_routes(TestRequest::default().to_http_request(), test_auth(), store).await;
        let listed_after_bytes = to_bytes(listed_after.into_body())
            .await
            .expect("list body after delete");
        let rows_after: Vec<Value> =
            serde_json::from_slice(&listed_after_bytes).expect("list json after delete");
        assert!(rows_after.is_empty());
    }
}
