
use tauri::{AppHandle, Emitter, State, Manager};
use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::{CommandEvent, CommandChild};
use crate::models::{CollectionConfig, ProcessInfo, BatchMetric, MetricPoint, ProcessAlias, LogMetricConfig};
use crate::collector::create_collector;
use crate::database::{Database, ReportSummary, ReportDetail, TagStat};
use chrono::{DateTime, Utc, TimeZone};
use serde_json::json;
use serde_json::Value;
#[cfg(target_os = "macos")]
use std::time::Duration;
use base64::Engine;
use tauri::path::BaseDirectory;
use serde::{Deserialize, Serialize};
use regex::Regex;

#[derive(Clone)]
pub struct CollectionState {
    // Child process handle to write to stdin or kill
    pub child: Arc<Mutex<Option<CommandChild>>>,
    pub is_running: Arc<Mutex<bool>>,
    pub buffer: Arc<Mutex<Vec<BatchMetric>>>,
    pub target_pids: Arc<Mutex<Vec<u32>>>,
    pub mode: Arc<Mutex<String>>,
    pub interval_ms: Arc<Mutex<u64>>,
    pub started_at: Arc<Mutex<Option<String>>>,
    pub process_snapshot: Arc<Mutex<Vec<ProcessInfo>>>,
    pub process_aliases: Arc<Mutex<Vec<ProcessAlias>>>,
    pub app_version: Arc<Mutex<String>>,
    pub test_context: Arc<Mutex<Option<Value>>>,
    pub stop_after_seconds: Arc<Mutex<Option<u64>>>,
    // Store compiled regexes for log metrics: (Config, Regex)
    pub log_metrics: Arc<Mutex<Vec<(LogMetricConfig, Regex)>>>,
}

impl CollectionState {
    pub fn new() -> Self {
        Self {
            child: Arc::new(Mutex::new(None)),
            is_running: Arc::new(Mutex::new(false)),
            buffer: Arc::new(Mutex::new(Vec::new())),
            target_pids: Arc::new(Mutex::new(Vec::new())),
            mode: Arc::new(Mutex::new("system".to_string())),
            interval_ms: Arc::new(Mutex::new(1000)),
            started_at: Arc::new(Mutex::new(None)),
            process_snapshot: Arc::new(Mutex::new(Vec::new())),
            process_aliases: Arc::new(Mutex::new(Vec::new())),
            app_version: Arc::new(Mutex::new("unknown".to_string())),
            test_context: Arc::new(Mutex::new(None)),
            stop_after_seconds: Arc::new(Mutex::new(None)),
            log_metrics: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

#[derive(serde::Serialize)]
pub struct CollectionStatus {
    pub is_running: bool,
    pub target_pids: Vec<u32>,
    pub mode: String,
    pub interval_ms: u64,
    pub started_at: Option<String>,
    pub test_context: Option<Value>,
    pub process_aliases: Vec<ProcessAlias>,
    pub stop_after_seconds: Option<u64>,
}

#[tauri::command]
pub fn get_collection_status(state: State<'_, CollectionState>) -> Result<CollectionStatus, String> {
    Ok(CollectionStatus {
        is_running: *safe_lock(&state.is_running),
        target_pids: safe_lock(&state.target_pids).clone(),
        mode: safe_lock(&state.mode).clone(),
        interval_ms: *safe_lock(&state.interval_ms),
        started_at: safe_lock(&state.started_at).clone(),
        test_context: safe_lock(&state.test_context).clone(),
        process_aliases: safe_lock(&state.process_aliases).clone(),
        stop_after_seconds: *safe_lock(&state.stop_after_seconds),
    })
}

// Struct for arguments
#[derive(serde::Deserialize)]
pub struct ProcessListArgs {
    mode: String,
}

// Helper to handle mutex poisoning gracefully
pub fn safe_lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    match mutex.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            eprintln!("WARNING: Mutex was poisoned! Recovering...");
            poisoned.into_inner()
        }
    }
}

// Websocket ingest (Chrome extension): only valid in Browser API mode.
// This avoids mixing Chrome Task Manager memory (private/footprint) into System API runs.
pub fn process_websocket_metric_payload(app: &AppHandle, data: Value, state: &CollectionState) {
    if safe_lock(&state.mode).as_str() != "browser" {
        return;
    }
    process_metric_payload(app, data, state);
}

#[tauri::command]
pub async fn export_report_pdf(
    app_handle: AppHandle,
    report_id: i64,
    filename: Option<String>,
    pdf_base64: String
) -> Result<String, String> {
    // Accept either raw base64 or a data URL.
    let b64 = pdf_base64
        .strip_prefix("data:application/pdf;base64,")
        .unwrap_or(pdf_base64.as_str());
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| format!("base64 decode failed: {e}"))?;

    let mut dir = app_handle
        .path()
        .resolve("", BaseDirectory::Download)
        .ok();
    if dir.is_none() {
        dir = app_handle.path().app_local_data_dir().ok();
    }
    let dir = dir.ok_or("Failed to resolve output directory")?;
    if !dir.exists() {
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }

    let name = filename
        .and_then(|s| {
            let t = s.trim().to_string();
            if t.is_empty() { None } else { Some(t) }
        })
        .unwrap_or_else(|| format!("PerfSight_Report_{}.pdf", report_id));
    let path = dir.join(name);

    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ReportDatasetV1 {
    pub schema_version: u32,
    pub exported_at: String,
    pub report: ReportDetail,
}

#[tauri::command]
pub fn export_report_dataset(
    app_handle: AppHandle,
    db: State<'_, Database>,
    report_id: i64
) -> Result<String, String> {
    let report = db.get_report_detail(report_id).map_err(|e| e.to_string())?;
    let dataset = ReportDatasetV1 {
        schema_version: 1,
        exported_at: Utc::now().to_rfc3339(),
        report,
    };
    let json_str = serde_json::to_string_pretty(&dataset).map_err(|e| e.to_string())?;

    let mut dir = app_handle.path().resolve("", BaseDirectory::Download).ok();
    if dir.is_none() {
        dir = app_handle.path().app_local_data_dir().ok();
    }
    let dir = dir.ok_or("Failed to resolve output directory")?;
    if !dir.exists() {
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    let filename = format!("PerfSight_Report_{}_Dataset.json", report_id);
    let path = dir.join(filename);
    std::fs::write(&path, json_str.as_bytes()).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn import_report_dataset(
    db: State<'_, Database>,
    dataset_json: String
) -> Result<i64, String> {
    // Accept either pretty json or wrapped dataset.
    let v: Value = serde_json::from_str(&dataset_json).map_err(|e| format!("Invalid JSON: {e}"))?;
    let schema_version = v.get("schema_version").and_then(|x| x.as_u64()).unwrap_or(0);
    if schema_version != 1 {
        return Err(format!("Unsupported dataset schema_version: {}", schema_version));
    }
    let report_v = v.get("report").ok_or("Missing report field")?;
    let report: ReportDetail = serde_json::from_value(report_v.clone()).map_err(|e| e.to_string())?;

    // Preserve original created_at/title/metrics/meta. (analysis will be recomputed on read)
    let new_id = db
        .import_report(&report.created_at, &report.title, &report.metrics, &report.meta)
        .map_err(|e| e.to_string())?;
    Ok(new_id)
}

// Helper to push a custom metric derived from logs
pub fn push_custom_metric(
    app: &AppHandle,
    state: &CollectionState,
    pid: u32,
    timestamp: DateTime<Utc>,
    name: String,
    value: f64
) {
    // Emit for live preview regardless of run state
    
    let mut custom = HashMap::new();
    custom.insert(name, value);
    
    let point = MetricPoint {
        timestamp,
        pid,
        cpu_usage: 0.0,
        cpu_os_usage: 0.0,
        cpu_chrome_usage: None,
        memory_rss: 0,
        memory_footprint: None,
        gpu_usage: None,
        js_heap_size: None,
        memory_private: None,
        custom_metrics: Some(custom),
    };
    
    let mut metrics = HashMap::new();
    metrics.insert(pid, point);
    let batch = BatchMetric { timestamp, metrics };
    
    let _ = app.emit("new-metric-batch", &batch);
    
    // Only save if running
    if *safe_lock(&state.is_running) {
        safe_lock(&state.buffer).push(batch);
    }
}

// Helper to process metric payload from Sidecar or WebSocket
pub fn process_metric_payload(
    app: &AppHandle,
    data: Value,
    state: &CollectionState
) {
    if data["type"] == "data" {
        let ts_ms = data["timestamp"].as_i64().unwrap_or(0);
        let timestamp = Utc.timestamp_millis_opt(ts_ms).unwrap();
        let target_pids = safe_lock(&state.target_pids);

        // Get total memory (bytes) for sanity checks.
        // sysinfo has had unit differences across versions (KiB vs bytes) and may return 0 until refreshed.
        let mut sys = sysinfo::System::new();
        sys.refresh_memory();
        let total_mem_raw = sys.total_memory() as u64;
        let total_mem_bytes: f64 = if total_mem_raw == 0 {
            0.0
        } else if total_mem_raw < 1024 * 1024 * 1024 {
            // Likely KiB
            (total_mem_raw.saturating_mul(1024)) as f64
        } else {
            total_mem_raw as f64
        };
        
        let mut metrics = HashMap::new();
        if let Some(obj) = data["metrics"].as_object() {
            for (pid_str, val) in obj {
                if !val.is_null() {
                    let pid = pid_str.parse::<u32>().unwrap_or(0);
                    
                    // Strict filtering: Only record requested PIDs
                    if !target_pids.contains(&pid) {
                        continue;
                    }

                    let cpu = val["cpu"].as_f64().unwrap_or(0.0) as f32;
                    let mem_raw = val["memory"].as_f64().unwrap_or(0.0);

                    // Websocket payloads (from perf-sight-extension) should send memory in MB.
                    // Guard against occasional unit flips (bytes vs MB) and glitch spikes.
                    let mem_bytes_from_mb = mem_raw * 1024.0 * 1024.0;
                    let treated_as_bytes = total_mem_bytes > 0.0
                        && mem_bytes_from_mb > total_mem_bytes * 8.0
                        && mem_raw > 0.0
                        && mem_raw <= total_mem_bytes * 8.0;
                    let mut mem_bytes: f64 = if treated_as_bytes {
                        // mem_raw looks like bytes already.
                        mem_raw
                    } else {
                        mem_bytes_from_mb
                    };

                    // Spike clamp: if this PID's memory suddenly jumps to an implausible value
                    // compared to the previous sample, treat it as a glitch and keep previous.
                    {
                        let buffer = safe_lock(&state.buffer);
                        if let Some(last) = buffer.last() {
                            if let Some(prev) = last.metrics.get(&pid) {
                                let prev_bytes = prev.memory_rss as f64;
                                let delta = mem_bytes - prev_bytes;

                                // Typical Chrome processes shouldn't jump by hundreds of MB to multiple GB in 1 tick.
                                // We clamp when the jump is both:
                                // - multiplicatively large, and
                                // - absolutely large (to avoid clamping legitimate small changes).
                                //
                                // Also clamp if it exceeds near-total system memory (definitely wrong).
                                let clamp =
                                    (prev_bytes > 0.0
                                        && mem_bytes > prev_bytes * 6.0
                                        && delta > 512.0 * 1024.0 * 1024.0) // > 512MB jump
                                    || (prev_bytes > 0.0
                                        && delta > 2.0 * 1024.0 * 1024.0 * 1024.0) // > 2GB jump
                                    || (total_mem_bytes > 0.0 && mem_bytes > total_mem_bytes * 0.90);

                                if pid == 78937 {
                                    eprintln!(
                                        "DEBUG pid=78937 mem websocket ts_ms={} raw_memory_field={} treated_as_bytes={} prev={}MB current={}MB delta={}MB total_mem={}GB clamp={}",
                                        ts_ms,
                                        mem_raw,
                                        treated_as_bytes,
                                        (prev_bytes / 1024.0 / 1024.0).round(),
                                        (mem_bytes / 1024.0 / 1024.0).round(),
                                        (delta / 1024.0 / 1024.0).round(),
                                        if total_mem_bytes > 0.0 {
                                            (total_mem_bytes / 1024.0 / 1024.0 / 1024.0).round()
                                        } else {
                                            -1.0
                                        },
                                        clamp
                                    );
                                }

                                if clamp {
                                    eprintln!(
                                        "WARN: dropping suspicious websocket memory spike pid={} prev={}MB current={}MB raw_memory_field={} total_mem={}GB",
                                        pid,
                                        (prev_bytes / 1024.0 / 1024.0).round(),
                                        (mem_bytes / 1024.0 / 1024.0).round(),
                                        mem_raw,
                                        if total_mem_bytes > 0.0 {
                                            (total_mem_bytes / 1024.0 / 1024.0 / 1024.0).round()
                                        } else {
                                            -1.0
                                        }
                                    );
                                    mem_bytes = prev_bytes;
                                }
                            }
                        }
                    }
                    
                    metrics.insert(pid, MetricPoint {
                        timestamp,
                        pid,
                        cpu_usage: cpu,
                        cpu_os_usage: cpu,
                        cpu_chrome_usage: None,
                        // Websocket provides Chrome "private memory" (Task Manager memory footprint), not RSS.
                        // Populate memory_private so the frontend can label/choose it correctly.
                        memory_rss: mem_bytes.max(0.0) as u64,
                        memory_footprint: None,
                        gpu_usage: None,
                        js_heap_size: None,
                        memory_private: Some(mem_bytes.max(0.0) as u64),
                        custom_metrics: None,
                    });
                }
            }
        }
        
        if !metrics.is_empty() {
            let is_running = *safe_lock(&state.is_running);
            let batch = BatchMetric { timestamp, metrics };

            if is_running {
                // Merge logic for recording
                let mut buffer = safe_lock(&state.buffer);
                if let Some(last) = buffer.last_mut() {
                    if last.timestamp == timestamp {
                        for (pid, mp) in batch.metrics.clone() {
                            last.metrics.insert(pid, mp);
                        }
                        let merged = last.clone();
                        drop(buffer);
                        let _ = app.emit("new-metric-batch", &merged);
                        return;
                    }
                }
                buffer.push(batch.clone());
            }
            
            // Emit for live preview (if not merged above)
            let _ = app.emit("new-metric-batch", &batch);
        }
    }
}

#[tauri::command]
pub async fn get_process_list(
    app_handle: AppHandle,
    args: Option<ProcessListArgs>
) -> Result<Vec<ProcessInfo>, String> {
    let mode = args.map(|a| a.mode).unwrap_or("system".to_string());

    if mode == "browser" {
        println!("Scanning Chrome processes via Sidecar...");
        let sidecar = app_handle.shell().sidecar("collector").map_err(|e| e.to_string())?;
        let (mut rx, mut child) = sidecar.spawn().map_err(|e| e.to_string())?;
        
        let cmd = json!({ "action": "scan_chrome" }).to_string() + "\n";
        child.write(cmd.as_bytes()).map_err(|e| e.to_string())?;
        
        let mut processes = Vec::new();
        // Simple timeout logic could be added, but sidecar is fast
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line_bytes) => {
                    let line = String::from_utf8_lossy(&line_bytes);
                    if let Ok(data) = serde_json::from_str::<Value>(&line) {
                        if data["type"] == "process_list" {
                            if let Some(arr) = data["data"].as_array() {
                                for p in arr {
                                    processes.push(ProcessInfo {
                                        pid: p["pid"].as_u64().unwrap_or(0) as u32,
                                        alias: None,
                                        name: p["name"].as_str().unwrap_or("chrome").to_string(),
                                        memory_usage: p["memory"].as_u64().unwrap_or(0),
                                        cpu_usage: 0.0,
                                        proc_type: p["proc_type"].as_str().unwrap_or("Unknown").to_string(),
                                        title: None,
                                        url: None,
                                    });
                                }
                            }
                            return Ok(processes);
                        }
                    }
                }
                _ => {}
            }
        }
        return Err("Sidecar closed without returning list".to_string());
    }

    // System mode: Use existing Rust collector
    let res = tokio::task::spawn_blocking(move || {
        let mut collector = create_collector(&mode);
        collector.scan_processes(&mode)
    }).await.map_err(|e| e.to_string())?;
    
    Ok(res)
}

#[tauri::command]
pub async fn start_collection(
    app_handle: AppHandle,
    state: State<'_, CollectionState>,
    config: CollectionConfig
) -> Result<String, String> {
    println!("Starting collection...");
    
    // Save target PIDs for filtering
    *safe_lock(&state.target_pids) = config.target_pids.clone();
    *safe_lock(&state.mode) = config.mode.clone();
    *safe_lock(&state.interval_ms) = config.interval_ms;
    *safe_lock(&state.started_at) = Some(Utc::now().to_rfc3339());
    *safe_lock(&state.app_version) = app_handle.package_info().version.to_string();
    *safe_lock(&state.test_context) = config
        .test_context
        .as_ref()
        .map(|tc| serde_json::to_value(tc).unwrap_or_else(|_| json!({})));
    *safe_lock(&state.process_aliases) = config.process_aliases.clone().unwrap_or_default();
    *safe_lock(&state.stop_after_seconds) = config.stop_after_seconds;

    // Compile regexes for log metrics
    if let Some(configs) = config.log_metric_configs {
        let mut compiled = Vec::new();
        for cfg in configs {
            match Regex::new(&cfg.pattern) {
                Ok(re) => compiled.push((cfg, re)),
                Err(e) => eprintln!("Invalid regex pattern '{}': {}", cfg.pattern, e),
            }
        }
        *safe_lock(&state.log_metrics) = compiled;
    } else {
        safe_lock(&state.log_metrics).clear();
    }

    // Capture a process snapshot for the selected PIDs (best effort).
    let snapshot = tokio::task::spawn_blocking({
        let mode = config.mode.clone();
        let pids = config.target_pids.clone();
        let aliases = config.process_aliases.clone().unwrap_or_default();
        move || {
            let alias_map: std::collections::HashMap<u32, String> = aliases
                .into_iter()
                .map(|a| (a.pid, a.alias))
                .collect();
            let mut collector = create_collector(&mode);
            let list = collector.scan_processes(&mode);
            list.into_iter()
                .filter(|p| pids.contains(&p.pid))
                .map(|mut p| {
                    if let Some(a) = alias_map.get(&p.pid) {
                        let s = a.trim();
                        if !s.is_empty() {
                            p.alias = Some(s.to_string());
                        }
                    }
                    p
                })
                .collect::<Vec<ProcessInfo>>()
        }
    })
    .await
    .ok()
    .unwrap_or_default();
    *safe_lock(&state.process_snapshot) = snapshot;

    *safe_lock(&state.is_running) = true;
    safe_lock(&state.buffer).clear();

    // macOS System API: use native Rust collector for accurate CPU + RSS ("Real Memory Size").
    // This avoids psutil RSS/normalization mismatches.
    #[cfg(target_os = "macos")]
    if config.mode != "browser" {
        let app_handle_clone = app_handle.clone();
        let state_clone = state.inner().clone();
        let mode = config.mode.clone();
        let interval_ms = config.interval_ms;
        let pids = config.target_pids.clone();

        tauri::async_runtime::spawn_blocking(move || {
            let mut collector = create_collector(&mode);
            while *safe_lock(&state_clone.is_running) {
                collector.update();

                let mut metrics = HashMap::new();
                for pid in &pids {
                    if let Some(m) = collector.collect_process(*pid) {
                        metrics.insert(*pid, m);
                    }
                }

                if !metrics.is_empty() {
                    let batch = BatchMetric { timestamp: Utc::now(), metrics };
                    let _ = app_handle_clone.emit("new-metric-batch", &batch);
                    safe_lock(&state_clone.buffer).push(batch);
                }

                std::thread::sleep(Duration::from_millis(interval_ms));
            }
        });

        return Ok("Started".to_string());
    }
    
    let mut child_guard = safe_lock(&state.child);
    
    // 1. Ensure sidecar is running
    if child_guard.is_none() {
        println!("Spawning collector sidecar...");
        let sidecar = app_handle.shell().sidecar("collector").map_err(|e| e.to_string())?;
        let (mut rx, child) = sidecar.spawn().map_err(|e| e.to_string())?;
        
        *child_guard = Some(child);
        
        // Spawn listener task (Reads Stdout)
        let app_handle_clone = app_handle.clone();
        let state_clone = state.inner().clone();
        
        tauri::async_runtime::spawn(async move {
            println!("Sidecar listener thread started.");
            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stdout(line_bytes) => {
                        let line = String::from_utf8_lossy(&line_bytes);
                        // println!("Sidecar Output: {}", line); // Debug
                        
                        if let Ok(data) = serde_json::from_str::<Value>(&line) {
                            process_metric_payload(&app_handle_clone, data, &state_clone);
                        }
                    }
                    CommandEvent::Stderr(line_bytes) => {
                        let line = String::from_utf8_lossy(&line_bytes);
                        eprintln!("Sidecar Log: {}", line);
                    }
                    _ => {}
                }
            }
            println!("Sidecar listener exited.");
        });
    }

    // 2. Send Start Command to Sidecar
    // Only start sidecar collection if we are NOT in browser mode (or if we want hybrid, but currently sidecar reports 0 for chrome)
    if config.mode != "browser" {
        if let Some(child) = child_guard.as_mut() {
            let cmd = json!({
                "action": "start",
                "pids": config.target_pids,
                "interval": config.interval_ms as f64 / 1000.0
            });
            let cmd_str = cmd.to_string() + "\n";
            println!("Sending command to sidecar: {}", cmd_str);
            child.write(cmd_str.as_bytes()).map_err(|e| e.to_string())?;
        }
    } else {
        println!("Browser mode: Skipping Sidecar collection (relying on Extension).");
    }

    Ok("Started".to_string())
}

#[tauri::command]
pub async fn stop_collection(
    state: State<'_, CollectionState>,
    db: State<'_, Database>
) -> Result<String, String> {
    println!("Stopping collection...");
    
    // 1. Send Stop Command
    let mut child_guard = safe_lock(&state.child);
    if let Some(child) = child_guard.as_mut() {
        let cmd = json!({ "action": "stop" }).to_string() + "\n";
        let _ = child.write(cmd.as_bytes());
    }
    
    *safe_lock(&state.is_running) = false;
    
    // 2. Save Report
    let mut buffer = safe_lock(&state.buffer);
    if !buffer.is_empty() {
        let default_title = format!("Test Run - {}", Utc::now().format("%Y-%m-%d %H:%M:%S"));
        let title = match safe_lock(&state.test_context)
            .as_ref()
            .and_then(|v| v.get("scenario_name"))
            .and_then(|v| v.as_str())
            .map(|s| s.trim())
        {
            Some(s) if !s.is_empty() => s.to_string(),
            _ => default_title,
        };
        println!("Buffer size: {}. Writing to DB...", buffer.len());

        // Build metadata for AI-friendly analysis.
        let ended_at = Utc::now().to_rfc3339();
        let started_at = safe_lock(&state.started_at).clone();
        let mode = safe_lock(&state.mode).clone();
        let interval_ms = *safe_lock(&state.interval_ms);
        let target_pids = safe_lock(&state.target_pids).clone();
        let process_snapshot = safe_lock(&state.process_snapshot).clone();
        let app_version = safe_lock(&state.app_version).clone();
        let test_context = safe_lock(&state.test_context).clone();
        let stop_after_seconds = *safe_lock(&state.stop_after_seconds);

        let cpu_count = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1);
        let mut sys = sysinfo::System::new_all();
        sys.refresh_all();
        let total_mem_bytes = sys.total_memory(); // bytes (sysinfo 0.30)
        let os_version = sysinfo::System::os_version();
        let long_os_version = sysinfo::System::long_os_version();
        let device_name = sysinfo::System::host_name();
        let cpu_physical_cores = sys.physical_core_count();
        let cpu_brand = sys.cpus().first().map(|c| c.brand().to_string());
        let cpu_vendor = sys.cpus().first().map(|c| c.vendor_id().to_string());
        let cpu_frequency_mhz = sys.cpus().first().map(|c| c.frequency());

        let duration_seconds = if let Some(first) = buffer.first() {
            if let Some(last) = buffer.last() {
                let d = (last.timestamp - first.timestamp).num_seconds();
                if d > 0 { d as u64 } else { 0 }
            } else { 0 }
        } else { 0 };

        let meta = json!({
            "schema_version": 1,
            "app": { "version": app_version },
            "versions": {
                "os_version": os_version,
                "os_long_version": long_os_version
            },
            "definitions": {
                "units": {
                    "cpu": "percent",
                    "memory": "bytes"
                },
                "system": {
                    "cpu": "OS process CPU% (sysinfo). On Windows normalized to 0-100 total capacity; on macOS/Linux may exceed 100 for multi-core.",
                    "memory": "RSS / Real Memory Size (resident set size) in bytes"
                },
                "browser": {
                    "cpu": "Chrome Task Manager-aligned CPU% when cpuch_* is present; otherwise falls back to OS CPU%",
                    "memory": "Chrome private/footprint memory in bytes when pmem_* is present; otherwise falls back to RSS"
                }
            },
            "env": {
                "os": std::env::consts::OS,
                "arch": std::env::consts::ARCH,
                "device_name": device_name,
                "cpu_logical_cores": cpu_count,
                "cpu_physical_cores": cpu_physical_cores,
                "cpu_brand": cpu_brand,
                "cpu_vendor": cpu_vendor,
                "cpu_frequency_mhz": cpu_frequency_mhz,
                "total_memory_bytes": total_mem_bytes,
                "gpu": { "name": null }
            },
            "collection": {
                "mode": mode,
                "metric_standard": if mode == "browser" { "chrome" } else { "os" },
                "interval_ms": interval_ms,
                "target_pids": target_pids,
                "started_at": started_at,
                "ended_at": ended_at,
                "duration_seconds": duration_seconds,
                "stop_after_seconds": stop_after_seconds
            },
            "test_context": test_context,
            "process_aliases": safe_lock(&state.process_aliases).clone(),
            "process_snapshot": process_snapshot
        });

        db.save_report(&title, &buffer, &meta).map_err(|e| e.to_string())?;
        buffer.clear();
        println!("Report saved successfully.");

        // Reset run state after saving.
        safe_lock(&state.target_pids).clear();
        *safe_lock(&state.mode) = "system".to_string();
        *safe_lock(&state.interval_ms) = 1000;
        *safe_lock(&state.started_at) = None;
        safe_lock(&state.process_snapshot).clear();
        safe_lock(&state.process_aliases).clear();
        *safe_lock(&state.test_context) = None;
        safe_lock(&state.log_metrics).clear();
        return Ok("Stopped and Saved Report".to_string());
    }
    
    println!("Stopped (No Data).");
    // Reset run state even if no data.
    safe_lock(&state.target_pids).clear();
    *safe_lock(&state.mode) = "system".to_string();
    *safe_lock(&state.interval_ms) = 1000;
    *safe_lock(&state.started_at) = None;
    safe_lock(&state.process_snapshot).clear();
    safe_lock(&state.process_aliases).clear();
    *safe_lock(&state.test_context) = None;
    safe_lock(&state.log_metrics).clear();
    Ok("Stopped (No Data)".to_string())
}

#[tauri::command]
pub fn get_reports(db: State<'_, Database>) -> Result<Vec<ReportSummary>, String> {
    db.get_all_reports().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_known_tags(db: State<'_, Database>) -> Result<Vec<TagStat>, String> {
    db.get_known_tags().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_report_detail(db: State<'_, Database>, id: i64) -> Result<ReportDetail, String> {
    db.get_report_detail(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_report(db: State<'_, Database>, id: i64) -> Result<usize, String> {
    db.delete_report(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_reports(db: State<'_, Database>, ids: Vec<i64>) -> Result<usize, String> {
    db.delete_reports(&ids).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_report_title(db: State<'_, Database>, id: i64, title: String) -> Result<usize, String> {
    let t = title.trim().to_string();
    if t.is_empty() {
        return Err("Title cannot be empty".to_string());
    }
    db.update_report_title(id, &t).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn debug_get_macos_rusage(pid: u32) -> Result<Value, String> {
    #[cfg(target_os = "macos")]
    {
        // sysctl hw.memsize
        let hw_memsize = {
            use std::mem::size_of;
            let mut memsize: u64 = 0;
            let mut len = size_of::<u64>();
            let name = b"hw.memsize\0";
            let rc = unsafe {
                libc::sysctlbyname(
                    name.as_ptr().cast(),
                    (&mut memsize as *mut u64).cast(),
                    (&mut len as *mut usize).cast(),
                    std::ptr::null_mut(),
                    0,
                )
            };
            if rc == 0 { memsize } else { 0 }
        };

        let mut info = std::mem::MaybeUninit::<libc::rusage_info_v4>::zeroed();
        const RUSAGE_INFO_V4: libc::c_int = 4;
        let mut buf: libc::rusage_info_t = info.as_mut_ptr().cast::<libc::c_void>();
        let rc = unsafe { libc::proc_pid_rusage(pid as libc::c_int, RUSAGE_INFO_V4, &mut buf) };
        if rc != 0 {
            return Err(format!("proc_pid_rusage failed rc={}", rc));
        }
        let info = unsafe { info.assume_init() };

        Ok(json!({
            "pid": pid,
            "hw_memsize_bytes": hw_memsize,
            "ri_phys_footprint": info.ri_phys_footprint,
            "ri_resident_size": info.ri_resident_size,
            "ri_wired_size": info.ri_wired_size,
            "ri_lifetime_max_phys_footprint": info.ri_lifetime_max_phys_footprint,
            "ri_interval_max_phys_footprint": info.ri_interval_max_phys_footprint
        }))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = pid;
        Err("debug_get_macos_rusage is only available on macOS".to_string())
    }
}


