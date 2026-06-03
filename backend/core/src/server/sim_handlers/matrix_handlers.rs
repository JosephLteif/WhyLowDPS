use super::*;

pub(super) async fn create_external_buff_matrix_sim(
    simc_input: String,
    options: &SimOptions,
    store: web::Data<Arc<dyn JobStorage>>,
    simc_path: web::Data<PathBuf>,
    log_buffer: web::Data<Arc<LogBuffer>>,
) -> HttpResponse {
    let (generated_input, combo_count, combo_metadata) =
        match build_external_buff_matrix_input(&simc_input, options) {
            Ok(v) => v,
            Err(detail) => return HttpResponse::BadRequest().json(json!({ "detail": detail })),
        };

    let mut generated_input = inject_expert_fields(&generated_input, options);
    generated_input = apply_shared_simc_options(&generated_input, options, false);
    let resolved_threads = if options.threads == 0 {
        std::thread::available_parallelism()
            .map(|n| n.get() as u32)
            .unwrap_or(4)
    } else {
        options.threads
    };
    generated_input.push_str(&format!("\nthreads={}\n", resolved_threads));

    if let Some(resp) = validate_batch(&options.batch_id, store.get_ref().as_ref()) {
        return resp;
    }

    let mut job = Job::new(
        generated_input.clone(),
        "external_buff_matrix".to_string(),
        options.iterations,
        options.fight_style.clone(),
        options.target_error,
    );
    job.options = Some(options.to_json_with_sim_type("external_buff_matrix"));
    job.batch_id = options.batch_id.clone();
    let job_id = job.id.clone();
    let created_at = job.created_at.clone();

    let meta_json = serde_json::to_string(&json!({
        "_combo_metadata": combo_metadata,
        "_combo_count": combo_count,
    }))
    .unwrap_or_default();
    job.combo_metadata_json = Some(meta_json);
    store.insert(job);

    let simc_binary = match resolve_simc_binary_for_request(simc_path.get_ref(), options) {
        Ok(path) => path,
        Err(detail) => return HttpResponse::BadRequest().json(json!({ "detail": detail })),
    };

    spawn_staged_sim(
        store.get_ref().clone(),
        simc_binary,
        options.to_json_with_sim_type("external_buff_matrix"),
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

pub(super) async fn create_consumable_matrix_sim(
    simc_input: String,
    options: &SimOptions,
    store: web::Data<Arc<dyn JobStorage>>,
    simc_path: web::Data<PathBuf>,
    log_buffer: web::Data<Arc<LogBuffer>>,
) -> HttpResponse {
    let (generated_input, combo_count, combo_metadata) =
        match build_consumable_matrix_input(&simc_input, options) {
            Ok(v) => v,
            Err(detail) => return HttpResponse::BadRequest().json(json!({ "detail": detail })),
        };

    let mut generated_input = inject_expert_fields(&generated_input, options);
    let resolved_threads = if options.threads == 0 {
        std::thread::available_parallelism()
            .map(|n| n.get() as u32)
            .unwrap_or(4)
    } else {
        options.threads
    };
    generated_input.push_str(&format!("\nthreads={}\n", resolved_threads));

    if let Some(resp) = validate_batch(&options.batch_id, store.get_ref().as_ref()) {
        return resp;
    }

    let mut job = Job::new(
        generated_input.clone(),
        "consumable_matrix".to_string(),
        options.iterations,
        options.fight_style.clone(),
        options.target_error,
    );
    job.options = Some(options.to_json_with_sim_type("consumable_matrix"));
    job.batch_id = options.batch_id.clone();
    let job_id = job.id.clone();
    let created_at = job.created_at.clone();

    let meta_json = serde_json::to_string(&json!({
        "_combo_metadata": combo_metadata,
        "_combo_count": combo_count,
    }))
    .unwrap_or_default();
    job.combo_metadata_json = Some(meta_json);
    store.insert(job);

    let simc_binary = match resolve_simc_binary_for_request(simc_path.get_ref(), options) {
        Ok(path) => path,
        Err(detail) => return HttpResponse::BadRequest().json(json!({ "detail": detail })),
    };

    spawn_staged_sim(
        store.get_ref().clone(),
        simc_binary,
        options.to_json_with_sim_type("consumable_matrix"),
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
