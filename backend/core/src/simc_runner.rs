use regex::Regex;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Mutex;
use tempfile::TempDir;
use once_cell::sync::Lazy;
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};
use std::time::Duration;

use crate::error::{AppError, Result};
use crate::types::simc::SimcOutput;

mod patterns {
    use super::*;
    pub static PROGRESS_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(\d+)/(\d+)").unwrap());
    pub static HEADER_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^###\s+(Combo \d+)").unwrap());
    pub static ENCHANT_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(enchant_id=\d+)").unwrap());
}

// ---- Process Registry (for cancellation) ----

static RUNNING_PROCESSES: Lazy<Mutex<HashMap<String, u32>>> = Lazy::new(|| Mutex::new(HashMap::new()));
static CANCELLED_JOBS: Lazy<Mutex<HashSet<String>>> = Lazy::new(|| Mutex::new(HashSet::new()));
static SYSINFO: Lazy<Mutex<System>> = Lazy::new(|| Mutex::new(System::new_all()));

pub fn get_process_stats(job_id: &str) -> Option<(f32, u64)> {
    let pid_u32 = RUNNING_PROCESSES.lock().unwrap().get(job_id).copied()?;
    let mut sys = SYSINFO.lock().unwrap();
    let pid = Pid::from_u32(pid_u32);
    sys.refresh_processes_specifics(ProcessesToUpdate::Some(&[pid]), true, ProcessRefreshKind::everything());
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
        sys.refresh_processes_specifics(ProcessesToUpdate::Some(&[pid]), true, ProcessRefreshKind::everything());
        if let Some(process) = sys.process(pid) {
            process.kill()
        } else {
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                let _ = std::process::Command::new("taskkill").args(["/F", "/T", "/PID", &pid_u32.to_string()]).creation_flags(0x08000000).output();
            }
            #[cfg(unix)]
            {
                let _ = std::process::Command::new("kill").args(["-9", &pid_u32.to_string()]).output();
            }
            true
        }
    } else { false }
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
            let mask: usize = if threads as usize >= usize::BITS as usize { usize::MAX } else { (1usize << threads as usize) - 1 };
            SetProcessAffinityMask(h, mask);
            CloseHandle(h);
        }
    }
}

const SIMC_TIMEOUT_SECS: u64 = 600;

fn resolve_threads(options: &Value) -> u32 {
    let max = std::thread::available_parallelism().map(|n| n.get() as u32).unwrap_or(4);
    let requested = options.get("threads").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
    if requested == 0 { max } else { requested.min(max).max(1) }
}

const OVERRIDES: &[&str] = &[
    "override.bloodlust=1", "override.arcane_intellect=1", "override.power_word_fortitude=1",
    "override.battle_shout=1", "override.mystic_touch=1", "override.chaos_brand=1",
    "override.skyfury=1", "override.mark_of_the_wild=1", "override.hunters_mark=1", "override.bleeding=1",
];

const SIM_OPTIONS: &[&str] = &[
    "report_details=1", "single_actor_batch=1", "optimize_expressions=1", "temporary_enchant=",
    "scale_only=strength,intellect,agility,crit,mastery,vers,haste,weapon_dps,weapon_offhand_dps",
];

const STAGES: &[Stage] = &[
    Stage { name: "Low", target_error: 1.0, keep_top: 0.5, min_keep: 10 },
    Stage { name: "Medium", target_error: 0.2, keep_top: 0.3, min_keep: 5 },
    Stage { name: "High", target_error: 0.05, keep_top: 1.0, min_keep: 1 },
];

struct Stage { name: &'static str, target_error: f64, keep_top: f64, min_keep: usize }

#[allow(clippy::too_many_arguments)]
async fn run_simc_subprocess(
    simc_path: &Path, job_id: &str, simc_input: &str, fight_style: &str, target_error: f64,
    iterations: u32, threads: u32, desired_targets: u32, max_time: u32,
    calculate_scale_factors: bool, single_actor_batch: bool, stage_name: &str, generate_html: bool,
    on_p: impl Fn(usize, usize), on_l: impl Fn(&str),
) -> Result<SimcOutput> {
    let suffix = if stage_name.is_empty() { String::new() } else { format!("_{}", stage_name) };
    let tmp_dir = TempDir::with_prefix(format!("simc_{}{}_", job_id, suffix)).map_err(AppError::IoError)?;
    let input_file = tmp_dir.path().join("input.simc");
    let output_file = tmp_dir.path().join("output.json");
    let html_file = tmp_dir.path().join("report.html");

    std::fs::write(&input_file, simc_input).map_err(AppError::IoError)?;
    if !simc_path.exists() { return Err(AppError::SimcError(format!("simc binary not found at: {}", simc_path.display()))); }

    #[cfg(windows)]
    let _ = std::fs::remove_file(format!("{}:Zone.Identifier", simc_path.display()));

    let mut cmd = Command::new(simc_path);
    #[cfg(windows)]
    cmd.creation_flags(0x08000000 | 0x00004000);
    
    let is_dungeon = simc_input.lines().any(|l| l.trim() == "fight_style=DungeonRoute" || l.trim() == "fight_style=\"DungeonRoute\"");
    cmd.arg(input_file.to_str().unwrap_or("")).arg(format!("json2={}", output_file.display()));
    if generate_html { cmd.arg(format!("html={}", html_file.display())); }
    cmd.arg(format!("iterations={}", iterations)).arg(format!("target_error={}", target_error)).arg(format!("threads={}", threads));
    cmd.arg(format!("calculate_scale_factors={}", if calculate_scale_factors { "1" } else { "0" }));

    if is_dungeon { cmd.arg(format!("desired_targets={}", desired_targets)); }
    else {
        cmd.arg(format!("fight_style={}", fight_style)).arg(format!("desired_targets={}", desired_targets)).arg(format!("max_time={}", max_time));
        for opt in OVERRIDES { cmd.arg(*opt); }
    }
    for opt in SIM_OPTIONS {
        if opt.starts_with("single_actor_batch=") && !single_actor_batch { continue; }
        cmd.arg(*opt);
    }
    
    cmd.stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| AppError::SimcError(format!("Failed to spawn simc: {}", e)))?;
    if let Some(pid) = child.id() {
        RUNNING_PROCESSES.lock().unwrap().insert(job_id.to_string(), pid);
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

    loop {
        match tokio::time::timeout(Duration::from_secs(SIMC_TIMEOUT_SECS), rx.recv()).await {
            Ok(Some((is_err, line))) => {
                on_l(&line);
                if let Some(caps) = patterns::PROGRESS_RE.captures(&line) {
                    if let (Ok(curr), Ok(total)) = (caps[1].parse::<usize>(), caps[2].parse::<usize>()) {
                        if total > 1 && curr <= total { on_p(curr, total); }
                    }
                }
                if is_err { err_collected.push(line); } else { out_collected.push(line); }
            }
            Ok(None) => break,
            Err(_) => {
                let _ = child.kill().await;
                RUNNING_PROCESSES.lock().unwrap().remove(job_id);
                return Err(AppError::SimcError(format!("simc timed out after {}s", SIMC_TIMEOUT_SECS)));
            }
        }
    }

    let status = child.wait().await.map_err(|e| AppError::IoError(e))?;
    RUNNING_PROCESSES.lock().unwrap().remove(job_id);

    if !status.success() {
        let msg = if !err_collected.is_empty() { err_collected.join("\n") } else { out_collected.join("\n") };
        return Err(AppError::SimcError(format!("simc failed (exit {:?}): {}", status.code(), msg)));
    }

    if !output_file.exists() { return Err(AppError::SimcError("simc produced no JSON output".into())); }
    let json_text = std::fs::read_to_string(&output_file).map_err(AppError::IoError)?;
    let json: Value = serde_json::from_str(&json_text).map_err(|e| AppError::SimcError(e.to_string()))?;
    
    Ok(SimcOutput {
        json,
        html_report: if generate_html { std::fs::read_to_string(&html_file).ok() } else { None },
        text_output: if out_collected.is_empty() { None } else { Some(out_collected.join("\n")) },
    })
}

fn spawn_reader<R: AsyncReadExt + Unpin + Send + 'static>(mut reader: R, is_err: bool, tx: tokio::sync::mpsc::Sender<(bool, String)>) {
    tokio::spawn(async move {
        let mut buf = [0u8; 1024];
        let mut line = String::new();
        while let Ok(n) = reader.read(&mut buf).await {
            if n == 0 { break; }
            let chunk = String::from_utf8_lossy(&buf[..n]);
            for c in chunk.chars() {
                if c == '\n' || c == '\r' {
                    let trim = line.trim().to_string();
                    if !trim.is_empty() { let _ = tx.send((is_err, trim)).await; }
                    line.clear();
                } else { line.push(c); }
            }
        }
        let trim = line.trim().to_string();
        if !trim.is_empty() { let _ = tx.send((is_err, trim)).await; }
    });
}

fn get_profileset_results(raw: &Value) -> Vec<Value> {
    raw.get("sim").and_then(|s| s.get("profilesets")).and_then(|p| p.get("results")).and_then(|r| r.as_array()).cloned().unwrap_or_default()
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
            if in_kept { out.push(line); }
            continue;
        }
        if line.trim().starts_with("profileset.") || (current.is_some() && line.trim().starts_with('#')) {
            if in_kept { out.push(line); }
            continue;
        }
        out.push(line);
        current = None;
        in_kept = true;
    }
    out.join("\n")
}

pub async fn run_simc(simc_path: &Path, job_id: &str, simc_input: &str, options: &Value, on_p: impl Fn(usize, usize), on_l: impl Fn(&str)) -> Result<SimcOutput> {
    let f = options.get("fight_style").and_then(|v| v.as_str()).unwrap_or("Patchwerk");
    let e = options.get("target_error").and_then(|v| v.as_f64()).unwrap_or(0.2);
    let i = options.get("iterations").and_then(|v| v.as_u64()).unwrap_or(1000) as u32;
    let s = options.get("sim_type").and_then(|v| v.as_str()) == Some("stat_weights");
    let t = resolve_threads(options);
    let d = options.get("desired_targets").and_then(|v| v.as_u64()).unwrap_or(1) as u32;
    let m = options.get("max_time").and_then(|v| v.as_u64()).unwrap_or(300) as u32;
    let b = options.get("single_actor_batch").and_then(|v| v.as_bool()).unwrap_or(true);

    run_simc_subprocess(simc_path, job_id, simc_input, f, e, i, t, d, m, s, b, "", true, on_p, on_l).await
}

#[allow(clippy::too_many_arguments)]
pub async fn run_simc_staged(
    simc_path: &Path, job_id: &str, simc_input: &str, options: &Value, combo_count: usize,
    on_p: impl Fn(u8, &str, &str), on_sc: impl Fn(&str), on_l: impl Fn(&str) + Clone,
) -> Result<SimcOutput> {
    let f = options.get("fight_style").and_then(|v| v.as_str()).unwrap_or("Patchwerk");
    let user_iter = options.get("iterations").and_then(|v| v.as_u64()).unwrap_or(1000) as u32;
    let threads = resolve_threads(options);
    let desired = options.get("desired_targets").and_then(|v| v.as_u64()).unwrap_or(1) as u32;
    let max_t = options.get("max_time").and_then(|v| v.as_u64()).unwrap_or(300) as u32;
    let batch = options.get("single_actor_batch").and_then(|v| v.as_bool()).unwrap_or(true);

    if combo_count < 10 {
        on_p(5, "Simulating", &format!("{} combos", combo_count));
        let error = options.get("target_error").and_then(|v| v.as_f64()).unwrap_or(0.2);
        return run_simc_subprocess(simc_path, job_id, simc_input, f, error, user_iter, threads, desired, max_t, false, batch, "direct", false, |c, t| {
            on_p(5 + ((c as f64 / t as f64) * 90.0) as u8, "Simulating", &format!("{}/{} profilesets", c, t));
        }, on_l).await;
    }

    let mut current_input = simc_input.to_string();
    let mut remaining = combo_count;
    let mut result = None;
    let mut eliminated = HashMap::new();

    let stage_iters = [std::cmp::max(100, user_iter / 10), std::cmp::max(500, user_iter / 2), user_iter];
    let stage_ranges = [(10, 40), (40, 70), (70, 95)];

    for (idx, stage) in STAGES.iter().enumerate() {
        let (start, end) = stage_ranges[idx];
        on_p(start, &format!("Stage {} of {}", idx + 1, STAGES.len()), &format!("{} combos · {}", remaining, stage.name));

        let res = run_simc_subprocess(simc_path, job_id, &current_input, f, stage.target_error, stage_iters[idx], threads, desired, max_t, false, batch, &stage.name.to_lowercase(), false, |c, t| {
            on_p(start + ((c as f64 / t as f64) * (end - start) as f64) as u8, &format!("Stage {} of {}", idx + 1, STAGES.len()), &format!("{}/{} profilesets · {}", c, t, stage.name));
        }, on_l.clone()).await?;

        result = Some(res);
        if idx == STAGES.len() - 1 { on_sc(&format!("{} · done", stage.name)); break; }

        let profilesets = get_profileset_results(&result.as_ref().unwrap().json);
        if profilesets.is_empty() { break; }

        let keep = std::cmp::max(stage.min_keep, (profilesets.len() as f64 * stage.keep_top) as usize);
        if keep >= profilesets.len() { continue; }

        let mut sorted = profilesets.clone();
        sorted.sort_by(|a, b| b.get("mean").and_then(|v| v.as_f64()).partial_cmp(&a.get("mean").and_then(|v| v.as_f64())).unwrap_or(std::cmp::Ordering::Equal));
        
        let keep_set: HashSet<String> = sorted.iter().take(keep).filter_map(|ps| ps.get("name").and_then(|n| n.as_str()).map(|s| s.to_string())).collect();
        for ps in &sorted {
            let name = ps.get("name").and_then(|n| n.as_str()).unwrap_or("");
            if !name.is_empty() && !keep_set.contains(name) { eliminated.insert(name.to_string(), ps.clone()); }
        }
        current_input = filter_simc_input(&current_input, &keep_set);
        remaining = keep_set.len();
        on_sc(&format!("{} · kept {}", stage.name, remaining));
    }

    let mut final_res = result.unwrap();
    if !eliminated.is_empty() {
        if let Some(results) = final_res.json.get_mut("sim").and_then(|s| s.get_mut("profilesets")).and_then(|p| p.get_mut("results")).and_then(|r| r.as_array_mut()) {
            for (_, val) in eliminated { results.push(val); }
        }
    }
    Ok(final_res)
}
