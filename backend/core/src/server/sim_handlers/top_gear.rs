use super::*;

struct TopGearGeneration {
    generated_input: String,
    combo_count: usize,
    combo_metadata: HashMap<String, Vec<Value>>,
}

fn generate_top_gear_profilesets(req: &TopGearRequest) -> crate::error::Result<TopGearGeneration> {
    let mut simc_input = if req.max_upgrade {
        game_data::upgrade_simc_input(&req.simc_input)
    } else {
        req.simc_input.clone()
    };

    simc_input = apply_spec_override(
        &apply_talent_override(&simc_input, &req.options.talents),
        &req.options.spec_override,
    );
    simc_input = crate::talent_normalize::normalize_simc_talents(&simc_input);

    let parse_result = addon_parser::parse_simc_input(&simc_input);

    let currency_id_sim = crate::item_db::catalyst_currency_id();
    let catalyst_charges = req
        .catalyst_charges
        .or_else(|| crate::addon_parser::parse_catalyst_charges(&req.simc_input, currency_id_sim));

    let resolved = if req.catalyst || catalyst_charges.is_some() {
        gear_resolver::resolve_gear_with_catalyst(&parse_result, catalyst_charges)
    } else {
        gear_resolver::resolve_gear(&parse_result)
    };
    let base_profile = resolved.base_profile.clone();

    let mut items_by_slot: HashMap<String, Vec<crate::types::ResolvedItem>> =
        if let Some(ref ibs) = req.items_by_slot {
            ibs.clone()
        } else {
            resolve_to_items_by_slot(&resolved)
        };

    if req.max_upgrade {
        items_by_slot = game_data::upgrade_items_by_slot(items_by_slot);
    }

    if req.copy_enchants {
        items_by_slot = game_data::apply_copy_enchants_to_map(items_by_slot);
    }

    let talent_builds: Vec<(String, String)> = req
        .talent_builds
        .iter()
        .map(|tb| {
            let normalized = crate::talent_normalize::normalize_simc_talents(&format!(
                "talents={}",
                tb.talent_string
            ));
            let ts = normalized
                .strip_prefix("talents=")
                .unwrap_or(&tb.talent_string)
                .to_string();
            (tb.name.clone(), ts)
        })
        .collect();

    let consumables = top_gear_consumables_from_options(&req.options);
    let (generated_input, combo_count, combo_metadata) =
        profileset_generator::generate_top_gear_input_with_talents(
            &base_profile,
            &items_by_slot,
            &req.selected_items,
            req.max_combinations,
            &talent_builds,
            catalyst_charges,
            consumables.as_ref(),
        )?;

    Ok(TopGearGeneration {
        generated_input,
        combo_count,
        combo_metadata,
    })
}

pub(in crate::server) async fn create_top_gear_sim(
    req: web::Json<TopGearRequest>,
    store: web::Data<Arc<dyn JobStorage>>,
    simc_path: web::Data<PathBuf>,
    log_buffer: web::Data<Arc<LogBuffer>>,
) -> HttpResponse {
    let simc_input = if req.max_upgrade {
        game_data::upgrade_simc_input(&req.simc_input)
    } else {
        req.simc_input.clone()
    };

    if crate::types::class_data::detect_class(&simc_input).is_none() {
        return HttpResponse::BadRequest().json(json!({
            "detail": "Could not detect character class from SimC input. Ensure the input starts with a character name line (e.g. warrior=\"Name\")."
        }));
    }

    let TopGearGeneration {
        generated_input,
        combo_count,
        combo_metadata,
    } = match generate_top_gear_profilesets(&req) {
        Ok(r) => r,
        Err(e) => {
            return HttpResponse::BadRequest().json(json!({"detail": e.to_string()}));
        }
    };

    if combo_count == 0 && req.talent_builds.len() <= 1 {
        return HttpResponse::BadRequest().json(json!({
            "detail": "No alternative items selected. Select at least one non-equipped item or multiple talent builds."
        }));
    }

    let mut generated_input = inject_expert_fields(&generated_input, &req.options);
    generated_input = apply_shared_simc_options(&generated_input, &req.options, true);

    let resolved_threads = if req.options.threads == 0 {
        std::thread::available_parallelism()
            .map(|n| n.get() as u32)
            .unwrap_or(4)
    } else {
        req.options.threads
    };
    generated_input.push_str(&format!("\nthreads={}\n", resolved_threads));

    if let Some(resp) = validate_batch(&req.options.batch_id, store.get_ref().as_ref()) {
        return resp;
    }

    let mut job = Job::new(
        generated_input.clone(),
        "top_gear".to_string(),
        req.options.iterations,
        req.options.fight_style.clone(),
        req.options.target_error,
    );
    job.options = Some(req.options.to_json_with_sim_type("top_gear"));
    let job_id = job.id.clone();
    let created_at = job.created_at.clone();

    let meta_json = serde_json::to_string(&json!({
        "_combo_metadata": combo_metadata,
        "_combo_count": combo_count,
    }))
    .unwrap_or_default();

    job.combo_metadata_json = Some(meta_json);
    job.batch_id = req.options.batch_id.clone();
    store.insert(job);

    let simc_binary = match resolve_simc_binary_for_request(simc_path.get_ref(), &req.options) {
        Ok(path) => path,
        Err(detail) => return HttpResponse::BadRequest().json(json!({ "detail": detail })),
    };

    spawn_staged_sim(
        store.get_ref().clone(),
        simc_binary,
        req.options.to_json(),
        job_id.clone(),
        generated_input,
        combo_count,
        log_buffer.get_ref().clone(),
    );

    HttpResponse::Ok().json(SimResponse {
        id: job_id,
        status: "pending".to_string(),
        created_at,
    })
}

pub(in crate::server) async fn get_top_gear_combo_count(
    req: web::Json<TopGearRequest>,
) -> HttpResponse {
    match generate_top_gear_profilesets(&req) {
        Ok(generation) => HttpResponse::Ok().json(json!({ "combo_count": generation.combo_count })),
        Err(e) => {
            let e_str = e.to_string();
            let count: usize = e_str
                .split('(')
                .nth(1)
                .and_then(|s| s.split(')').next())
                .and_then(|s| s.parse().ok())
                .unwrap_or(0);
            HttpResponse::Ok().json(json!({ "combo_count": count, "error": e_str }))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::MemoryStorage;
    use actix_web::body::to_bytes;

    fn top_gear_request(value: serde_json::Value) -> TopGearRequest {
        serde_json::from_value(value).expect("top gear request")
    }

    #[actix_web::test]
    async fn create_top_gear_rejects_input_without_detectable_class() {
        let store: Arc<dyn JobStorage> = Arc::new(MemoryStorage::new());
        let req = top_gear_request(json!({
            "simc_input": "not a character profile",
            "selected_items": {},
            "items_by_slot": null
        }));

        let resp = create_top_gear_sim(
            web::Json(req),
            web::Data::new(store),
            web::Data::new(PathBuf::from("simc")),
            web::Data::new(Arc::new(LogBuffer::new())),
        )
        .await;

        assert_eq!(resp.status(), 400);
        let body = to_bytes(resp.into_body()).await.expect("response body");
        let payload: serde_json::Value = serde_json::from_slice(&body).expect("json body");
        assert!(payload
            .get("detail")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .contains("Could not detect character class"));
    }
}
