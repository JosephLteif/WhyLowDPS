use super::*;

pub(in crate::server) async fn create_droptimizer_sim(
    req: web::Json<DroptimizerRequest>,
    store: web::Data<Arc<dyn JobStorage>>,
    simc_path: web::Data<PathBuf>,
    log_buffer: web::Data<Arc<LogBuffer>>,
) -> HttpResponse {
    let simc_input = apply_spec_override(
        &apply_talent_override(&req.simc_input, &req.options.talents),
        &req.options.spec_override,
    );
    let simc_input = crate::talent_normalize::normalize_simc_talents(&simc_input);
    let parse_result = addon_parser::parse_simc_input(&simc_input);
    let base_profile = parse_result.base_profile.clone();

    let (generated_input, combo_count, combo_metadata) =
        profileset_generator::generate_droptimizer_input(
            &base_profile,
            &req.drop_items,
            req.copy_enchants,
        );

    if combo_count == 0 {
        return HttpResponse::BadRequest().json(json!({
            "detail": "No items selected. Select at least one drop item."
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
        "droptimizer".to_string(),
        req.options.iterations,
        req.options.fight_style.clone(),
        req.options.target_error,
    );
    job.options = Some(req.options.to_json_with_sim_type("droptimizer"));
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
