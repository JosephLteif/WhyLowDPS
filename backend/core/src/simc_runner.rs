use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};
use tempfile::TempDir;
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::sync::Semaphore;

use crate::error::{AppError, Result};
use crate::types::simc::SimcOutput;

mod patterns {
    use super::*;
    pub static PROGRESS_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(\d+)/(\d+)").unwrap());
    pub static HEADER_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^###\s+(Combo \d+)").unwrap());
}

// ---- Process Registry (for cancellation) ----

static RUNNING_PROCESSES: Lazy<Mutex<HashMap<String, u32>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static CANCELLED_JOBS: Lazy<Mutex<HashSet<String>>> = Lazy::new(|| Mutex::new(HashSet::new()));
static SYSINFO: Lazy<Mutex<System>> = Lazy::new(|| Mutex::new(System::new_all()));
static SIMC_ADMISSION: Lazy<Arc<Semaphore>> = Lazy::new(|| {
    let default_limit = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1)
        .max(1);
    let limit = std::env::var("MAX_CONCURRENT_SIMULATIONS")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(default_limit);
    Arc::new(Semaphore::new(limit))
});

struct CancellationGuard<'a> {
    job_id: &'a str,
}

impl<'a> CancellationGuard<'a> {
    fn new(job_id: &'a str) -> Self {
        Self { job_id }
    }
}

impl Drop for CancellationGuard<'_> {
    fn drop(&mut self) {
        cleanup_cancelled_job(self.job_id);
    }
}

pub fn get_process_stats(job_id: &str) -> Option<(f32, u64)> {
    let pid_u32 = RUNNING_PROCESSES.lock().unwrap().get(job_id).copied()?;
    let mut sys = SYSINFO.lock().unwrap();
    let pid = Pid::from_u32(pid_u32);
    sys.refresh_processes_specifics(
        ProcessesToUpdate::Some(&[pid]),
        true,
        ProcessRefreshKind::everything(),
    );
    sys.process(pid).map(|p| (p.cpu_usage(), p.memory()))
}

pub fn cleanup_cancelled_job(job_id: &str) {
    CANCELLED_JOBS.lock().unwrap().remove(job_id);
}

pub fn kill_job(job_id: &str) -> bool {
    CANCELLED_JOBS.lock().unwrap().insert(job_id.to_string());
    if let Some(pid_u32) = RUNNING_PROCESSES.lock().unwrap().remove(job_id) {
        let mut sys = SYSINFO.lock().unwrap();
        let pid = Pid::from_u32(pid_u32);
        sys.refresh_processes_specifics(
            ProcessesToUpdate::Some(&[pid]),
            true,
            ProcessRefreshKind::everything(),
        );
        if let Some(process) = sys.process(pid) {
            process.kill()
        } else {
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                let _ = std::process::Command::new("taskkill")
                    .args(["/F", "/T", "/PID", &pid_u32.to_string()])
                    .creation_flags(0x08000000)
                    .output();
            }
            #[cfg(unix)]
            {
                let _ = std::process::Command::new("kill")
                    .args(["-9", &pid_u32.to_string()])
                    .output();
            }
            true
        }
    } else {
        false
    }
}

#[cfg(windows)]
extern "system" {
    fn OpenProcess(access: u32, inherit: i32, pid: u32) -> *mut std::ffi::c_void;
    fn SetProcessAffinityMask(h: *mut std::ffi::c_void, mask: usize) -> i32;
    fn CloseHandle(h: *mut std::ffi::c_void) -> i32;
}

#[cfg(windows)]
fn set_process_affinity(pid: u32, threads: u32) {
    const PROCESS_SET_INFORMATION: u32 = 0x0200;
    const PROCESS_QUERY_INFORMATION: u32 = 0x0400;
    unsafe {
        let h = OpenProcess(PROCESS_SET_INFORMATION | PROCESS_QUERY_INFORMATION, 0, pid);
        if !h.is_null() {
            let mask: usize = if threads as usize >= usize::BITS as usize {
                usize::MAX
            } else {
                (1usize << threads as usize) - 1
            };
            SetProcessAffinityMask(h, mask);
            CloseHandle(h);
        }
    }
}

const SIMC_IDLE_TIMEOUT_SECS: u64 = 600;
const SIMC_TOTAL_TIMEOUT_SECS: u64 = 1800;

fn timeout_for_next_output(now: Instant, total_deadline: Instant) -> Duration {
    Duration::from_secs(SIMC_IDLE_TIMEOUT_SECS).min(total_deadline.saturating_duration_since(now))
}

async fn acquire_simc_slot() -> Result<tokio::sync::OwnedSemaphorePermit> {
    SIMC_ADMISSION
        .clone()
        .acquire_owned()
        .await
        .map_err(|_| AppError::SimcError("simulation admission is unavailable".into()))
}

fn resolve_threads(options: &Value) -> u32 {
    let max = std::thread::available_parallelism()
        .map(|n| n.get() as u32)
        .unwrap_or(4);
    let requested = options.get("threads").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
    if requested == 0 {
        max
    } else {
        requested.min(max).max(1)
    }
}

const OVERRIDES: &[&str] = &[
    "override.bloodlust=1",
    "override.arcane_intellect=1",
    "override.power_word_fortitude=1",
    "override.battle_shout=1",
    "override.mystic_touch=1",
    "override.chaos_brand=1",
    "override.skyfury=1",
    "override.mark_of_the_wild=1",
    "override.hunters_mark=1",
    "override.bleeding=1",
];

const SIM_OPTIONS: &[&str] = &[
    "report_details=1",
    "single_actor_batch=1",
    "optimize_expressions=1",
    "temporary_enchant=",
    "scale_only=strength,intellect,agility,crit,mastery,vers,haste,weapon_dps,weapon_offhand_dps",
];

const STAGES: &[Stage] = &[
    Stage {
        name: "Low",
        target_error: 1.0,
        keep_top: 0.5,
        min_keep: 10,
    },
    Stage {
        name: "Medium",
        target_error: 0.2,
        keep_top: 0.3,
        min_keep: 5,
    },
    Stage {
        name: "High",
        target_error: 0.05,
        keep_top: 1.0,
        min_keep: 1,
    },
];

struct Stage {
    name: &'static str,
    target_error: f64,
    keep_top: f64,
    min_keep: usize,
}

fn should_apply_default_overrides(sim_type: &str, raid_buff_customized: bool) -> bool {
    sim_type != "external_buff_matrix" && sim_type != "consumable_matrix" && !raid_buff_customized
}

fn is_dungeon_route_input(simc_input: &str) -> bool {
    simc_input.lines().any(|line| {
        line.trim() == "fight_style=DungeonRoute" || line.trim() == "fight_style=\"DungeonRoute\""
    })
}

#[allow(clippy::too_many_arguments)]
fn build_simc_cli_args(
    input_file: &Path,
    output_file: &Path,
    html_file: Option<&Path>,
    fight_style: &str,
    target_error: f64,
    iterations: u32,
    threads: u32,
    desired_targets: u32,
    max_time: u32,
    calculate_scale_factors: bool,
    dps_plot: Option<(String, u32, u32, u32)>,
    single_actor_batch: bool,
    apply_default_overrides: bool,
    is_dungeon_route: bool,
) -> Vec<String> {
    let mut args = Vec::new();
    args.push(input_file.to_string_lossy().to_string());
    args.push(format!("json2={}", output_file.display()));
    if let Some(html) = html_file {
        args.push(format!("html={}", html.display()));
    }

    args.push(format!("iterations={}", iterations));
    args.push(format!("target_error={}", target_error));
    args.push(format!("threads={}", threads));
    args.push(format!(
        "calculate_scale_factors={}",
        if calculate_scale_factors { "1" } else { "0" }
    ));

    if let Some((stat, points, step, plot_iterations)) = dps_plot {
        args.push(format!("dps_plot_stat={}", stat));
        args.push(format!("dps_plot_points={}", points));
        args.push(format!("dps_plot_step={}", step));
        args.push(format!("dps_plot_iterations={}", plot_iterations));
    }

    if is_dungeon_route {
        args.push(format!("desired_targets={}", desired_targets));
    } else {
        args.push(format!("fight_style={}", fight_style));
        args.push(format!("desired_targets={}", desired_targets));
        args.push(format!("max_time={}", max_time));
        if apply_default_overrides {
            for opt in OVERRIDES {
                args.push((*opt).to_string());
            }
        }
    }

    for opt in SIM_OPTIONS {
        if opt.starts_with("single_actor_batch=") && !single_actor_batch {
            continue;
        }
        args.push((*opt).to_string());
    }

    args
}

fn stage_keep_count(total: usize, keep_top: f64, min_keep: usize) -> usize {
    std::cmp::max(min_keep, (total as f64 * keep_top) as usize)
}

fn sort_profilesets_descending(results: &[Value]) -> Vec<Value> {
    let mut sorted = results.to_vec();
    sorted.sort_by(|a, b| {
        let mean_cmp = b
            .get("mean")
            .and_then(|v| v.as_f64())
            .partial_cmp(&a.get("mean").and_then(|v| v.as_f64()))
            .unwrap_or(std::cmp::Ordering::Equal);
        if mean_cmp != std::cmp::Ordering::Equal {
            return mean_cmp;
        }
        let left = a.get("name").and_then(|n| n.as_str()).unwrap_or("");
        let right = b.get("name").and_then(|n| n.as_str()).unwrap_or("");
        left.cmp(right)
    });
    sorted
}

fn compute_stage_keep_and_eliminated(
    profilesets: &[Value],
    keep_count: usize,
) -> (HashSet<String>, HashMap<String, Value>) {
    let sorted = sort_profilesets_descending(profilesets);
    let keep_set: HashSet<String> = sorted
        .iter()
        .take(keep_count)
        .filter_map(|ps| {
            ps.get("name")
                .and_then(|n| n.as_str())
                .map(|s| s.to_string())
        })
        .collect();

    let mut eliminated = HashMap::new();
    for ps in &sorted {
        let name = ps.get("name").and_then(|n| n.as_str()).unwrap_or("");
        if !name.is_empty() && !keep_set.contains(name) {
            eliminated.insert(name.to_string(), ps.clone());
        }
    }

    (keep_set, eliminated)
}

fn merge_eliminated_profilesets(final_json: &mut Value, eliminated: HashMap<String, Value>) {
    if eliminated.is_empty() {
        return;
    }
    if let Some(results) = final_json
        .get_mut("sim")
        .and_then(|s| s.get_mut("profilesets"))
        .and_then(|p| p.get_mut("results"))
        .and_then(|r| r.as_array_mut())
    {
        for (_, val) in eliminated {
            results.push(val);
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn run_simc_subprocess(
    simc_path: &Path,
    job_id: &str,
    simc_input: &str,
    fight_style: &str,
    target_error: f64,
    iterations: u32,
    threads: u32,
    desired_targets: u32,
    max_time: u32,
    calculate_scale_factors: bool,
    dps_plot: Option<(String, u32, u32, u32)>,
    single_actor_batch: bool,
    apply_default_overrides: bool,
    stage_name: &str,
    generate_html: bool,
    on_p: impl Fn(usize, usize),
    on_l: impl Fn(&str),
) -> Result<SimcOutput> {
    let suffix = if stage_name.is_empty() {
        String::new()
    } else {
        format!("_{}", stage_name)
    };
    let tmp_dir =
        TempDir::with_prefix(format!("simc_{}{}_", job_id, suffix)).map_err(AppError::IoError)?;
    let input_file = tmp_dir.path().join("input.simc");
    let output_file = tmp_dir.path().join("output.json");
    let html_file = tmp_dir.path().join("report.html");

    std::fs::write(&input_file, simc_input).map_err(AppError::IoError)?;
    if !simc_path.exists() {
        return Err(AppError::SimcError(format!(
            "simc binary not found at: {}",
            simc_path.display()
        )));
    }

    #[cfg(windows)]
    let _ = std::fs::remove_file(format!("{}:Zone.Identifier", simc_path.display()));

    let mut cmd = Command::new(simc_path);
    #[cfg(windows)]
    cmd.creation_flags(0x08000000 | 0x00004000);

    let args = build_simc_cli_args(
        &input_file,
        &output_file,
        if generate_html {
            Some(&html_file)
        } else {
            None
        },
        fight_style,
        target_error,
        iterations,
        threads,
        desired_targets,
        max_time,
        calculate_scale_factors,
        dps_plot,
        single_actor_batch,
        apply_default_overrides,
        is_dungeon_route_input(simc_input),
    );
    cmd.args(args);

    cmd.stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::SimcError(format!("Failed to spawn simc: {}", e)))?;
    if let Some(pid) = child.id() {
        RUNNING_PROCESSES
            .lock()
            .unwrap()
            .insert(job_id.to_string(), pid);
        if CANCELLED_JOBS.lock().unwrap().contains(job_id) {
            let _ = child.kill().await;
            RUNNING_PROCESSES.lock().unwrap().remove(job_id);
            return Err(AppError::SimcError("Job cancelled".into()));
        }
        #[cfg(windows)]
        set_process_affinity(pid, threads);
    }

    let (tx, mut rx) = tokio::sync::mpsc::channel::<(bool, String)>(256);
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    spawn_reader(stdout, false, tx.clone());
    spawn_reader(stderr, true, tx);

    let mut out_collected = Vec::new();
    let mut err_collected = Vec::new();
    let total_deadline = Instant::now() + Duration::from_secs(SIMC_TOTAL_TIMEOUT_SECS);

    loop {
        match tokio::time::timeout(
            timeout_for_next_output(Instant::now(), total_deadline),
            rx.recv(),
        )
        .await
        {
            Ok(Some((is_err, line))) => {
                on_l(&line);
                if let Some(caps) = patterns::PROGRESS_RE.captures(&line) {
                    if let (Ok(curr), Ok(total)) =
                        (caps[1].parse::<usize>(), caps[2].parse::<usize>())
                    {
                        if total > 1 && curr <= total {
                            on_p(curr, total);
                        }
                    }
                }
                if is_err {
                    err_collected.push(line);
                } else {
                    out_collected.push(line);
                }
            }
            Ok(None) => break,
            Err(_) => {
                let _ = child.kill().await;
                RUNNING_PROCESSES.lock().unwrap().remove(job_id);
                let timeout_kind = if Instant::now() >= total_deadline {
                    "total"
                } else {
                    "idle-output"
                };
                return Err(AppError::SimcError(format!(
                    "simc {} timeout (idle={}s total={}s)",
                    timeout_kind, SIMC_IDLE_TIMEOUT_SECS, SIMC_TOTAL_TIMEOUT_SECS
                )));
            }
        }
    }

    let status = match child.wait().await {
        Ok(status) => status,
        Err(error) => {
            RUNNING_PROCESSES.lock().unwrap().remove(job_id);
            return Err(AppError::IoError(error));
        }
    };
    RUNNING_PROCESSES.lock().unwrap().remove(job_id);

    if !status.success() {
        let msg = if !err_collected.is_empty() {
            err_collected.join("\n")
        } else {
            out_collected.join("\n")
        };
        return Err(AppError::SimcError(format!(
            "simc failed (exit {:?}): {}",
            status.code(),
            msg
        )));
    }

    if !output_file.exists() {
        return Err(AppError::SimcError("simc produced no JSON output".into()));
    }
    let json_text = std::fs::read_to_string(&output_file).map_err(AppError::IoError)?;
    let json: Value =
        serde_json::from_str(&json_text).map_err(|e| AppError::SimcError(e.to_string()))?;

    Ok(SimcOutput {
        json,
        html_report: if generate_html {
            std::fs::read_to_string(&html_file).ok()
        } else {
            None
        },
        text_output: if out_collected.is_empty() {
            None
        } else {
            Some(out_collected.join("\n"))
        },
    })
}

fn spawn_reader<R: AsyncReadExt + Unpin + Send + 'static>(
    mut reader: R,
    is_err: bool,
    tx: tokio::sync::mpsc::Sender<(bool, String)>,
) {
    tokio::spawn(async move {
        let mut buf = [0u8; 1024];
        let mut line = String::new();
        while let Ok(n) = reader.read(&mut buf).await {
            if n == 0 {
                break;
            }
            let chunk = String::from_utf8_lossy(&buf[..n]);
            for c in chunk.chars() {
                if c == '\n' || c == '\r' {
                    let trim = line.trim().to_string();
                    if !trim.is_empty() {
                        let _ = tx.send((is_err, trim)).await;
                    }
                    line.clear();
                } else {
                    line.push(c);
                }
            }
        }
        let trim = line.trim().to_string();
        if !trim.is_empty() {
            let _ = tx.send((is_err, trim)).await;
        }
    });
}

fn get_profileset_results(raw: &Value) -> Vec<Value> {
    raw.get("sim")
        .and_then(|s| s.get("profilesets"))
        .and_then(|p| p.get("results"))
        .and_then(|r| r.as_array())
        .cloned()
        .unwrap_or_default()
}

pub fn filter_simc_input(input: &str, keep: &HashSet<String>) -> String {
    let mut out = Vec::new();
    let mut current = None;
    let mut in_kept = true;
    for line in input.lines() {
        if let Some(caps) = patterns::HEADER_RE.captures(line) {
            let name = caps[1].to_string();
            in_kept = keep.contains(&name);
            current = Some(name);
            if in_kept {
                out.push(line);
            }
            continue;
        }
        if line.trim().starts_with("profileset.")
            || (current.is_some() && line.trim().starts_with('#'))
        {
            if in_kept {
                out.push(line);
            }
            continue;
        }
        out.push(line);
        current = None;
        in_kept = true;
    }
    out.join("\n")
}

pub async fn run_simc(
    simc_path: &Path,
    job_id: &str,
    simc_input: &str,
    options: &Value,
    on_p: impl Fn(usize, usize),
    on_l: impl Fn(&str),
) -> Result<SimcOutput> {
    let _admission = acquire_simc_slot().await?;
    let _cancellation = CancellationGuard::new(job_id);
    let f = options
        .get("fight_style")
        .and_then(|v| v.as_str())
        .unwrap_or("Patchwerk");
    let e = options
        .get("target_error")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.2);
    let i = options
        .get("iterations")
        .and_then(|v| v.as_u64())
        .unwrap_or(1000) as u32;
    let sim_type = options
        .get("sim_type")
        .and_then(|v| v.as_str())
        .unwrap_or("quick");
    let is_stat_weights = sim_type == "stat_weights";
    let is_stat_plot = sim_type == "stat_plot";
    let raid_buff_customized = options
        .get("raid_buff_customized")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let apply_default_overrides = should_apply_default_overrides(sim_type, raid_buff_customized);
    let t = resolve_threads(options);
    let d = options
        .get("desired_targets")
        .and_then(|v| v.as_u64())
        .unwrap_or(1) as u32;
    let m = options
        .get("max_time")
        .and_then(|v| v.as_u64())
        .unwrap_or(300) as u32;
    let b = options
        .get("single_actor_batch")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let dps_plot = if is_stat_plot {
        let stat = options
            .get("dps_plot_stat")
            .and_then(|v| v.as_str())
            .unwrap_or("haste_rating")
            .trim()
            .to_string();
        let points = options
            .get("dps_plot_points")
            .and_then(|v| v.as_u64())
            .unwrap_or(10) as u32;
        let step = options
            .get("dps_plot_step")
            .and_then(|v| v.as_u64())
            .unwrap_or(100) as u32;
        let plot_iterations = options
            .get("dps_plot_iterations")
            .and_then(|v| v.as_u64())
            .unwrap_or(i as u64) as u32;

        if stat.is_empty() {
            None
        } else {
            Some((stat, points.max(1), step.max(1), plot_iterations.max(1)))
        }
    } else {
        None
    };

    run_simc_subprocess(
        simc_path,
        job_id,
        simc_input,
        f,
        e,
        i,
        t,
        d,
        m,
        is_stat_weights,
        dps_plot,
        b,
        apply_default_overrides,
        "",
        true,
        on_p,
        on_l,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
pub async fn run_simc_staged(
    simc_path: &Path,
    job_id: &str,
    simc_input: &str,
    options: &Value,
    combo_count: usize,
    on_p: impl Fn(u8, &str, &str),
    on_sc: impl Fn(&str),
    on_l: impl Fn(&str) + Clone,
) -> Result<SimcOutput> {
    let _admission = acquire_simc_slot().await?;
    let _cancellation = CancellationGuard::new(job_id);
    let f = options
        .get("fight_style")
        .and_then(|v| v.as_str())
        .unwrap_or("Patchwerk");
    let user_iter = options
        .get("iterations")
        .and_then(|v| v.as_u64())
        .unwrap_or(1000) as u32;
    let threads = resolve_threads(options);
    let desired = options
        .get("desired_targets")
        .and_then(|v| v.as_u64())
        .unwrap_or(1) as u32;
    let max_t = options
        .get("max_time")
        .and_then(|v| v.as_u64())
        .unwrap_or(300) as u32;
    let batch = options
        .get("single_actor_batch")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let sim_type = options
        .get("sim_type")
        .and_then(|v| v.as_str())
        .unwrap_or("top_gear");
    let raid_buff_customized = options
        .get("raid_buff_customized")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let apply_default_overrides = should_apply_default_overrides(sim_type, raid_buff_customized);

    if combo_count < 10 {
        on_p(5, "Simulating", &format!("{} combos", combo_count));
        let error = options
            .get("target_error")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.2);
        return run_simc_subprocess(
            simc_path,
            job_id,
            simc_input,
            f,
            error,
            user_iter,
            threads,
            desired,
            max_t,
            false,
            None,
            batch,
            apply_default_overrides,
            "direct",
            false,
            |c, t| {
                on_p(
                    5 + ((c as f64 / t as f64) * 90.0) as u8,
                    "Simulating",
                    &format!("{}/{} profilesets", c, t),
                );
            },
            on_l,
        )
        .await;
    }

    let mut current_input = simc_input.to_string();
    let mut remaining = combo_count;
    let mut result = None;
    let mut eliminated = HashMap::new();

    let stage_iters = [
        std::cmp::max(100, user_iter / 10),
        std::cmp::max(500, user_iter / 2),
        user_iter,
    ];
    let stage_ranges = [(10, 40), (40, 70), (70, 95)];

    for (idx, stage) in STAGES.iter().enumerate() {
        let (start, end) = stage_ranges[idx];
        on_p(
            start,
            &format!("Stage {} of {}", idx + 1, STAGES.len()),
            &format!("{} combos · {}", remaining, stage.name),
        );

        let res = run_simc_subprocess(
            simc_path,
            job_id,
            &current_input,
            f,
            stage.target_error,
            stage_iters[idx],
            threads,
            desired,
            max_t,
            false,
            None,
            batch,
            apply_default_overrides,
            &stage.name.to_lowercase(),
            false,
            |c, t| {
                on_p(
                    start + ((c as f64 / t as f64) * (end - start) as f64) as u8,
                    &format!("Stage {} of {}", idx + 1, STAGES.len()),
                    &format!("{}/{} profilesets · {}", c, t, stage.name),
                );
            },
            on_l.clone(),
        )
        .await?;

        result = Some(res);
        if idx == STAGES.len() - 1 {
            on_sc(&format!("{} · done", stage.name));
            break;
        }

        let profilesets = get_profileset_results(&result.as_ref().unwrap().json);
        if profilesets.is_empty() {
            break;
        }

        let keep = stage_keep_count(profilesets.len(), stage.keep_top, stage.min_keep);
        if keep >= profilesets.len() {
            continue;
        }

        let (keep_set, stage_eliminated) = compute_stage_keep_and_eliminated(&profilesets, keep);
        eliminated.extend(stage_eliminated);
        current_input = filter_simc_input(&current_input, &keep_set);
        remaining = keep_set.len();
        on_sc(&format!("{} · kept {}", stage.name, remaining));
    }

    let mut final_res = result.unwrap();
    merge_eliminated_profilesets(&mut final_res.json, eliminated);
    Ok(final_res)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::path::{Path, PathBuf};
    use std::sync::{Arc, Mutex};

    #[test]
    fn should_apply_default_overrides_follows_sim_type_and_customization() {
        assert!(should_apply_default_overrides("quick", false));
        assert!(!should_apply_default_overrides("quick", true));
        assert!(!should_apply_default_overrides("consumable_matrix", false));
        assert!(!should_apply_default_overrides(
            "external_buff_matrix",
            false
        ));
        assert!(should_apply_default_overrides("top_gear", false));
    }

    #[test]
    fn resolve_threads_defaults_and_clamps() {
        let max_threads = std::thread::available_parallelism()
            .map(|n| n.get() as u32)
            .unwrap_or(4);

        assert_eq!(resolve_threads(&json!({})), max_threads);
        assert_eq!(resolve_threads(&json!({"threads": 0})), max_threads);
        assert_eq!(resolve_threads(&json!({"threads": 1})), 1);
        assert_eq!(resolve_threads(&json!({"threads": 999999})), max_threads);
        assert_eq!(resolve_threads(&json!({"threads": "bad"})), max_threads);
    }

    #[test]
    fn dungeon_route_detection_supports_exact_trimmed_forms_only() {
        assert!(is_dungeon_route_input("fight_style=DungeonRoute\n"));
        assert!(is_dungeon_route_input("  fight_style=DungeonRoute  \n"));
        assert!(is_dungeon_route_input("fight_style=\"DungeonRoute\"\n"));
        assert!(!is_dungeon_route_input("fight_style=Patchwerk\n"));
        assert!(!is_dungeon_route_input("fight_style = DungeonRoute\n"));
    }

    #[test]
    fn build_simc_cli_args_non_dungeon_includes_expected_options() {
        let args = build_simc_cli_args(
            Path::new("input.simc"),
            Path::new("output.json"),
            Some(Path::new("report.html")),
            "Patchwerk",
            0.2,
            1000,
            8,
            1,
            300,
            true,
            Some(("haste_rating".to_string(), 10, 100, 500)),
            true,
            true,
            false,
        );

        assert!(args.contains(&"input.simc".to_string()));
        assert!(args.iter().any(|arg| arg == "json2=output.json"));
        assert!(args.iter().any(|arg| arg == "html=report.html"));
        assert!(args.iter().any(|arg| arg == "iterations=1000"));
        assert!(args.iter().any(|arg| arg == "target_error=0.2"));
        assert!(args.iter().any(|arg| arg == "threads=8"));
        assert!(args.iter().any(|arg| arg == "calculate_scale_factors=1"));
        assert!(args.iter().any(|arg| arg == "dps_plot_stat=haste_rating"));
        assert!(args.iter().any(|arg| arg == "dps_plot_points=10"));
        assert!(args.iter().any(|arg| arg == "dps_plot_step=100"));
        assert!(args.iter().any(|arg| arg == "dps_plot_iterations=500"));
        assert!(args.iter().any(|arg| arg == "fight_style=Patchwerk"));
        assert!(args.iter().any(|arg| arg == "desired_targets=1"));
        assert!(args.iter().any(|arg| arg == "max_time=300"));
        assert!(args.iter().any(|arg| arg == "override.bloodlust=1"));
        assert!(args.iter().any(|arg| arg == "single_actor_batch=1"));
        assert!(args.iter().any(|arg| arg == "report_details=1"));
    }

    #[test]
    fn build_simc_cli_args_non_dungeon_can_skip_default_overrides_and_batch_flag() {
        let args = build_simc_cli_args(
            Path::new("input.simc"),
            Path::new("output.json"),
            None,
            "Patchwerk",
            0.2,
            1000,
            8,
            1,
            300,
            false,
            None,
            false,
            false,
            false,
        );

        assert!(!args.iter().any(|arg| arg.starts_with("html=")));
        assert!(args.iter().any(|arg| arg == "calculate_scale_factors=0"));
        assert!(!args.iter().any(|arg| arg.starts_with("override.")));
        assert!(!args.iter().any(|arg| arg == "single_actor_batch=1"));
    }

    #[test]
    fn build_simc_cli_args_dungeon_route_omits_fight_style_max_time_and_overrides() {
        let args = build_simc_cli_args(
            Path::new("input.simc"),
            Path::new("output.json"),
            None,
            "Patchwerk",
            0.2,
            1000,
            8,
            3,
            400,
            false,
            None,
            false,
            true,
            true,
        );

        assert!(args.iter().any(|arg| arg == "desired_targets=3"));
        assert!(!args.iter().any(|arg| arg.starts_with("fight_style=")));
        assert!(!args.iter().any(|arg| arg.starts_with("max_time=")));
        assert!(!args.iter().any(|arg| arg.starts_with("override.")));
        assert!(!args.iter().any(|arg| arg == "single_actor_batch=1"));
    }

    #[test]
    fn stage_keep_count_respects_minimum_and_fraction() {
        assert_eq!(stage_keep_count(100, 0.3, 5), 30);
        assert_eq!(stage_keep_count(6, 0.3, 5), 5);
        assert_eq!(stage_keep_count(1, 1.0, 1), 1);
        assert_eq!(stage_keep_count(0, 0.5, 10), 10);
    }

    #[test]
    fn sort_profilesets_descending_orders_by_mean_then_name() {
        let sorted = sort_profilesets_descending(&[
            json!({"name": "Combo B", "mean": 100.0}),
            json!({"name": "Combo A", "mean": 100.0}),
            json!({"name": "Combo C", "mean": 95.0}),
            json!({"name": "Combo D"}),
        ]);

        let names = sorted
            .iter()
            .map(|v| v["name"].as_str().unwrap_or(""))
            .collect::<Vec<_>>();

        assert_eq!(names, vec!["Combo A", "Combo B", "Combo C", "Combo D"]);
    }

    #[test]
    fn compute_stage_keep_and_eliminated_is_deterministic_for_ties() {
        let profilesets = vec![
            json!({"name": "Combo B", "mean": 100.0}),
            json!({"name": "Combo A", "mean": 100.0}),
            json!({"name": "Combo C", "mean": 95.0}),
        ];

        let (keep_set, eliminated) = compute_stage_keep_and_eliminated(&profilesets, 2);

        assert_eq!(
            keep_set,
            HashSet::from(["Combo A".to_string(), "Combo B".to_string()])
        );
        assert_eq!(eliminated.len(), 1);
        assert!(eliminated.contains_key("Combo C"));
    }

    #[test]
    fn compute_stage_keep_and_eliminated_ignores_entries_without_names_for_sets() {
        let profilesets = vec![
            json!({"name": "Combo A", "mean": 100.0}),
            json!({"mean": 90.0}),
            json!({"name": "", "mean": 80.0}),
        ];

        let (keep_set, eliminated) = compute_stage_keep_and_eliminated(&profilesets, 1);

        assert_eq!(keep_set, HashSet::from(["Combo A".to_string()]));
        assert!(eliminated.is_empty());
    }

    #[test]
    fn merge_eliminated_profilesets_appends_to_existing_results() {
        let mut raw = json!({
            "sim": {
                "profilesets": {
                    "results": [
                        {"name": "Combo 1", "mean": 100.0}
                    ]
                }
            }
        });

        merge_eliminated_profilesets(
            &mut raw,
            HashMap::from([(
                "Combo 2".to_string(),
                json!({"name": "Combo 2", "mean": 90.0}),
            )]),
        );

        let results = raw["sim"]["profilesets"]["results"].as_array().unwrap();

        assert_eq!(results.len(), 2);
        assert!(results
            .iter()
            .any(|entry| entry["name"] == json!("Combo 2")));
    }

    #[test]
    fn merge_eliminated_profilesets_noops_when_map_or_result_path_is_empty() {
        let mut raw = json!({});
        merge_eliminated_profilesets(&mut raw, HashMap::new());
        assert_eq!(raw, json!({}));

        merge_eliminated_profilesets(
            &mut raw,
            HashMap::from([("Combo 1".to_string(), json!({"name": "Combo 1"}))]),
        );
        assert_eq!(raw, json!({}));
    }

    #[test]
    fn get_profileset_results_returns_results_or_empty_vec() {
        let raw = json!({
            "sim": {
                "profilesets": {
                    "results": [
                        {"name": "Combo 1"},
                        {"name": "Combo 2"}
                    ]
                }
            }
        });

        assert_eq!(get_profileset_results(&raw).len(), 2);
        assert!(get_profileset_results(&json!({})).is_empty());
        assert!(
            get_profileset_results(&json!({"sim": {"profilesets": {"results": "bad"}}})).is_empty()
        );
    }

    #[test]
    fn filter_simc_input_keeps_only_selected_profilesets() {
        let input = r#"
mage="Tester"
### Combo 1
profileset."Combo 1"+=head=id=1
# keep comment
### Combo 2
profileset."Combo 2"+=head=id=2
# drop comment
fight_style=Patchwerk
"#;

        let keep = HashSet::from(["Combo 1".to_string()]);
        let filtered = filter_simc_input(input, &keep);

        assert!(filtered.contains("profileset.\"Combo 1\""));
        assert!(filtered.contains("# keep comment"));
        assert!(!filtered.contains("profileset.\"Combo 2\""));
        assert!(!filtered.contains("# drop comment"));
        assert!(filtered.contains("fight_style=Patchwerk"));
    }

    #[test]
    fn filter_simc_input_keeps_base_lines_and_resets_after_dropped_profileset() {
        let input = r#"
warrior="Tester"
### Combo 1
profileset."Combo 1"+=head=id=1
### Combo 2
profileset."Combo 2"+=head=id=2
iterations=1000
profileset."not attached to combo"+=bad=1
"#;

        let keep = HashSet::from(["Combo 1".to_string()]);
        let filtered = filter_simc_input(input, &keep);

        assert!(filtered.contains("warrior=\"Tester\""));
        assert!(filtered.contains("profileset.\"Combo 1\""));
        assert!(!filtered.contains("profileset.\"Combo 2\""));
        assert!(filtered.contains("iterations=1000"));
        assert!(filtered.contains("profileset.\"not attached to combo\"+=bad=1"));
    }

    #[test]
    fn filter_simc_input_with_empty_keep_removes_all_combo_blocks() {
        let input = r#"
mage="Tester"
### Combo 1
profileset."Combo 1"+=head=id=1
# comment
### Combo 2
profileset."Combo 2"+=head=id=2
fight_style=Patchwerk
"#;

        let filtered = filter_simc_input(input, &HashSet::new());

        assert!(filtered.contains("mage=\"Tester\""));
        assert!(!filtered.contains("### Combo 1"));
        assert!(!filtered.contains("profileset.\"Combo 1\""));
        assert!(!filtered.contains("### Combo 2"));
        assert!(!filtered.contains("profileset.\"Combo 2\""));
        assert!(filtered.contains("fight_style=Patchwerk"));
    }

    #[tokio::test]
    async fn spawn_reader_emits_trimmed_non_empty_stdout_lines() {
        let (tx, mut rx) = tokio::sync::mpsc::channel(8);

        spawn_reader(
            tokio::io::BufReader::new(" one \n\n two\rthree".as_bytes()),
            false,
            tx,
        );

        let first = rx.recv().await.expect("first line");
        let second = rx.recv().await.expect("second line");
        let third = rx.recv().await.expect("third line");

        assert_eq!(first, (false, "one".to_string()));
        assert_eq!(second, (false, "two".to_string()));
        assert_eq!(third, (false, "three".to_string()));
        assert!(rx.recv().await.is_none());
    }

    #[tokio::test]
    async fn spawn_reader_marks_stderr_lines() {
        let (tx, mut rx) = tokio::sync::mpsc::channel(8);

        spawn_reader(tokio::io::BufReader::new("err line\n".as_bytes()), true, tx);

        assert_eq!(
            rx.recv().await.expect("stderr line"),
            (true, "err line".to_string())
        );
        assert!(rx.recv().await.is_none());
    }

    #[test]
    fn kill_job_without_registered_process_marks_job_cancelled_and_returns_false() {
        let job_id = "test-kill-missing";
        cleanup_cancelled_job(job_id);

        assert!(!kill_job(job_id));

        assert!(CANCELLED_JOBS.lock().unwrap().contains(job_id));
        cleanup_cancelled_job(job_id);
        assert!(!CANCELLED_JOBS.lock().unwrap().contains(job_id));
    }

    #[test]
    fn cancellation_guard_clears_marker_when_scope_ends() {
        let job_id = "guard-cleanup-job";
        cleanup_cancelled_job(job_id);
        kill_job(job_id);
        assert!(CANCELLED_JOBS.lock().unwrap().contains(job_id));

        {
            let _guard = CancellationGuard::new(job_id);
            assert!(CANCELLED_JOBS.lock().unwrap().contains(job_id));
        }

        assert!(!CANCELLED_JOBS.lock().unwrap().contains(job_id));
    }

    #[test]
    fn subprocess_timeout_uses_the_earlier_idle_or_total_deadline() {
        let now = std::time::Instant::now();
        let total_deadline = now + Duration::from_secs(SIMC_IDLE_TIMEOUT_SECS + 5);

        assert_eq!(
            timeout_for_next_output(now, total_deadline),
            Duration::from_secs(SIMC_IDLE_TIMEOUT_SECS)
        );

        let near_deadline = total_deadline - Duration::from_secs(1);
        assert!(timeout_for_next_output(near_deadline, total_deadline) <= Duration::from_secs(1));
    }

    #[test]
    fn get_process_stats_returns_none_for_unknown_job() {
        assert_eq!(get_process_stats("missing-job"), None);
    }

    #[tokio::test]
    async fn run_simc_returns_error_when_binary_is_missing() {
        let dir = tempfile::tempdir().expect("temp dir");
        let missing = dir.path().join("missing-simc");

        let err = run_simc(
            &missing,
            "missing-binary-job",
            "warrior=\"Tester\"\n",
            &json!({}),
            |_, _| {},
            |_| {},
        )
        .await
        .expect_err("missing binary should fail");

        assert!(err.to_string().contains("simc binary not found"));
    }

    #[tokio::test]
    async fn run_simc_subprocess_errors_when_json_output_is_missing_or_invalid() {
        let script = fake_simc_script("bad-json", "bad-json");

        let err = run_simc_subprocess(
            &script,
            "no-json-job",
            "warrior=\"Tester\"\n",
            "Patchwerk",
            0.2,
            100,
            1,
            1,
            300,
            false,
            None,
            true,
            true,
            "",
            false,
            |_, _| {},
            |_| {},
        )
        .await
        .expect_err("missing json should fail");

        let msg = err.to_string();
        assert!(
            msg.contains("simc produced no JSON output")
                || msg.contains("expected ident")
                || msg.contains("EOF while parsing")
                || msg.contains("JSON"),
            "unexpected error: {msg}"
        );
    }

    #[tokio::test]
    async fn run_simc_subprocess_returns_error_for_invalid_json_output() {
        let script = fake_simc_script("bad-json", "bad-json");

        let err = run_simc_subprocess(
            &script,
            "bad-json-job",
            "warrior=\"Tester\"\n",
            "Patchwerk",
            0.2,
            100,
            1,
            1,
            300,
            false,
            None,
            true,
            true,
            "",
            false,
            |_, _| {},
            |_| {},
        )
        .await
        .expect_err("bad json should fail");

        assert!(err.to_string().contains("expected ident") || err.to_string().contains("JSON"));
    }

    #[tokio::test]
    async fn run_simc_subprocess_returns_error_for_nonzero_exit_and_prefers_stderr() {
        let script = fake_simc_script("nonzero", "nonzero");

        let err = run_simc_subprocess(
            &script,
            "nonzero-job",
            "warrior=\"Tester\"\n",
            "Patchwerk",
            0.2,
            100,
            1,
            1,
            300,
            false,
            None,
            true,
            true,
            "",
            false,
            |_, _| {},
            |_| {},
        )
        .await
        .expect_err("nonzero should fail");

        let msg = err.to_string();
        assert!(msg.contains("simc failed"));
        assert!(msg.contains("stderr failure"));
    }

    #[tokio::test]
    async fn run_simc_subprocess_success_reads_json_html_text_and_progress() {
        let script = fake_simc_script("success", "success");

        let progress = Arc::new(Mutex::new(Vec::<(usize, usize)>::new()));
        let logs = Arc::new(Mutex::new(Vec::<String>::new()));

        let p = progress.clone();
        let l = logs.clone();

        let output = run_simc_subprocess(
            &script,
            "success-job",
            "warrior=\"Tester\"\n",
            "Patchwerk",
            0.2,
            100,
            1,
            1,
            300,
            false,
            None,
            true,
            true,
            "",
            true,
            move |current, total| {
                p.lock().unwrap().push((current, total));
            },
            move |line| {
                l.lock().unwrap().push(line.to_string());
            },
        )
        .await
        .expect("successful fake simc");

        assert_eq!(
            output.json["sim"]["profilesets"]["results"][0]["name"],
            json!("Combo 1")
        );
        assert_eq!(
            output
                .html_report
                .as_deref()
                .map(|s| s.replace("\r\n", "\n")),
            Some("<html>report</html>\n".to_string())
        );
        assert!(output.text_output.as_deref().unwrap_or("").contains("done"));
        assert_eq!(*progress.lock().unwrap(), vec![(1, 4), (2, 4)]);
        assert!(logs.lock().unwrap().iter().any(|line| line == "done"));
    }

    #[tokio::test]
    async fn run_simc_wrapper_builds_stat_plot_options_and_succeeds() {
        let script = fake_simc_script("wrapper-stat-plot", "wrapper-stat-plot");

        let output = run_simc(
            &script,
            "wrapper-stat-plot-job",
            "warrior=\"Tester\"\n",
            &json!({
                "sim_type": "stat_plot",
                "dps_plot_stat": " haste_rating ",
                "dps_plot_points": 0,
                "dps_plot_step": 0,
                "dps_plot_iterations": 0,
                "iterations": 100,
                "threads": 1
            }),
            |_, _| {},
            |_| {},
        )
        .await
        .expect("stat plot wrapper should succeed");

        assert_eq!(output.json["ok"], json!(true));
    }

    #[tokio::test]
    async fn run_simc_staged_direct_path_is_used_for_small_combo_counts() {
        let script = fake_simc_script("staged-direct", "staged-direct");

        let progress = Arc::new(Mutex::new(Vec::<String>::new()));
        let p = progress.clone();

        let output = run_simc_staged(
            &script,
            "staged-direct-job",
            "warrior=\"Tester\"\n### Combo 1\nprofileset.\"Combo 1\"+=head=id=1\n",
            &json!({
                "iterations": 100,
                "threads": 1
            }),
            2,
            move |_, phase, detail| {
                p.lock().unwrap().push(format!("{phase}:{detail}"));
            },
            |_| {},
            |_| {},
        )
        .await
        .expect("direct staged run");

        assert_eq!(
            output.json["sim"]["profilesets"]["results"][0]["name"],
            json!("Combo 1")
        );
        assert!(progress
            .lock()
            .unwrap()
            .iter()
            .any(|line| line.contains("2 combos")));
    }

    fn fake_simc_script(name: &str, mode: &str) -> PathBuf {
        let dir = tempfile::tempdir().expect("fake simc dir").keep();

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;

            let path = dir.join(name);

            let body = match mode {
                "no-json" => {
                    r#"#!/usr/bin/env bash
                echo "1/2"
                exit 0
                "#
                }
                "bad-json" => {
                    r#"#!/usr/bin/env bash
                for arg in "$@"; do
                  case "$arg" in
                    json2=*) out="${arg#json2=}" ;;
                  esac
                done
                echo "not-json" > "$out"
                exit 0
                "#
                }
                "nonzero" => {
                    r#"#!/usr/bin/env bash
                echo "stdout failure"
                echo "stderr failure" >&2
                exit 42
                "#
                }
                "success" => {
                    r#"#!/usr/bin/env bash
                for arg in "$@"; do
                  case "$arg" in
                    json2=*) out="${arg#json2=}" ;;
                    html=*) html="${arg#html=}" ;;
                  esac
                done
                echo "1/4"
                echo "2/4"
                echo '{"sim":{"profilesets":{"results":[{"name":"Combo 1","mean":100.0}]}}}' > "$out"
                if [ -n "$html" ]; then
                  echo "<html>report</html>" > "$html"
                fi
                echo "done"
                exit 0
                "#
                }
                "wrapper-stat-plot" => {
                    r#"#!/usr/bin/env bash
                for arg in "$@"; do
                  case "$arg" in
                    json2=*) out="${arg#json2=}" ;;
                    dps_plot_stat=*) saw_stat=1 ;;
                    dps_plot_points=1) saw_points=1 ;;
                    dps_plot_step=1) saw_step=1 ;;
                    dps_plot_iterations=1) saw_iterations=1 ;;
                  esac
                done
                if [ -z "$saw_stat" ] || [ -z "$saw_points" ] || [ -z "$saw_step" ] || [ -z "$saw_iterations" ]; then
                  echo "missing stat plot args" >&2
                  exit 9
                fi
                echo '{"ok":true}' > "$out"
                exit 0
                "#
                }
                "staged-direct" => {
                    r#"#!/usr/bin/env bash
                for arg in "$@"; do
                  case "$arg" in
                    json2=*) out="${arg#json2=}" ;;
                  esac
                done
                echo '{"sim":{"profilesets":{"results":[{"name":"Combo 1","mean":100.0}]}}}' > "$out"
                exit 0
                "#
                }
                other => panic!("unknown fake simc mode: {other}"),
            };

            std::fs::write(&path, body).expect("write fake simc");
            let mut permissions = std::fs::metadata(&path)
                .expect("fake simc metadata")
                .permissions();
            permissions.set_mode(0o755);
            std::fs::set_permissions(&path, permissions).expect("chmod fake simc");

            path
        }

        #[cfg(windows)]
        {
            let path = dir.join(format!("{name}.cmd"));

            let body = match mode {
                "no-json" => {
                    r#"@echo off
                echo 1/2
                exit /b 0
                "#
                }
                "bad-json" => {
                    r#"@echo off
                set "out="
                :loop
                if "%~1"=="" goto done
                set "arg=%~1"
                if "%arg:~0,6%"=="json2=" set "out=%arg:~6%"
                shift
                goto loop
                :done
                echo not-json>"%out%"
                exit /b 0
                "#
                }
                "nonzero" => {
                    r#"@echo off
                echo stdout failure
                echo stderr failure 1>&2
                exit /b 42
                "#
                }
                "success" => {
                    r#"@echo off
                set "out="
                set "html="
                :loop
                if "%~1"=="" goto done
                set "arg=%~1"
                if "%arg:~0,6%"=="json2=" set "out=%arg:~6%"
                if "%arg:~0,5%"=="html=" set "html=%arg:~5%"
                shift
                goto loop
                :done
                echo 1/4
                echo 2/4
                echo {"sim":{"profilesets":{"results":[{"name":"Combo 1","mean":100.0}]}}}>"%out%"
                if not "%html%"=="" echo ^<html^>report^</html^>>"%html%"
                echo done
                exit /b 0
                "#
                }
                "wrapper-stat-plot" => {
                    r#"@echo off
                set "out="
                set "saw_stat="
                set "saw_points="
                set "saw_step="
                set "saw_iterations="
                :loop
                if "%~1"=="" goto done
                set "arg=%~1"
                if "%arg:~0,6%"=="json2=" set "out=%arg:~6%"
                if "%arg:~0,14%"=="dps_plot_stat=" set "saw_stat=1"
                if "%arg%"=="dps_plot_points=1" set "saw_points=1"
                if "%arg%"=="dps_plot_step=1" set "saw_step=1"
                if "%arg%"=="dps_plot_iterations=1" set "saw_iterations=1"
                shift
                goto loop
                :done
                if "%saw_stat%"=="" exit /b 9
                if "%saw_points%"=="" exit /b 9
                if "%saw_step%"=="" exit /b 9
                if "%saw_iterations%"=="" exit /b 9
                echo {"ok":true}>"%out%"
                exit /b 0
                "#
                }
                "staged-direct" => {
                    r#"@echo off
                set "out="
                :loop
                if "%~1"=="" goto done
                set "arg=%~1"
                if "%arg:~0,6%"=="json2=" set "out=%arg:~6%"
                shift
                goto loop
                :done
                echo {"sim":{"profilesets":{"results":[{"name":"Combo 1","mean":100.0}]}}}>"%out%"
                exit /b 0
                "#
                }
                other => panic!("unknown fake simc mode: {other}"),
            };

            std::fs::write(&path, body).expect("write fake simc");
            path
        }
    }
}
