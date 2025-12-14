
use tauri::{AppHandle, Emitter, State};
use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::{CommandEvent, CommandChild};
use crate::models::{CollectionConfig, ProcessInfo, BatchMetric, MetricPoint};
use crate::collector::create_collector;
use crate::database::{Database, ReportSummary, ReportDetail};
use chrono::{Utc, TimeZone};
use serde_json::json;
use serde_json::Value;

#[derive(Clone)]
pub struct CollectionState {
    // Child process handle to write to stdin or kill
    pub child: Arc<Mutex<Option<CommandChild>>>,
    pub is_running: Arc<Mutex<bool>>,
    pub buffer: Arc<Mutex<Vec<BatchMetric>>>,
    pub target_pids: Arc<Mutex<Vec<u32>>>,
}

impl CollectionState {
    pub fn new() -> Self {
        Self {
            child: Arc::new(Mutex::new(None)),
            is_running: Arc::new(Mutex::new(false)),
            buffer: Arc::new(Mutex::new(Vec::new())),
            target_pids: Arc::new(Mutex::new(Vec::new())),
        }
    }
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

// Helper to process metric payload from Sidecar or WebSocket
pub fn process_metric_payload(
    app: &AppHandle,
    data: Value,
    state: &CollectionState
) {
    // Only process data if collection is running
    if !*safe_lock(&state.is_running) {
        return;
    }

    if data["type"] == "data" {
        let ts_ms = data["timestamp"].as_i64().unwrap_or(0);
        let timestamp = Utc.timestamp_millis_opt(ts_ms).unwrap();
        let target_pids = safe_lock(&state.target_pids);
        
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
                    let mem = val["memory"].as_f64().unwrap_or(0.0);
                    
                    metrics.insert(pid, MetricPoint {
                        timestamp,
                        pid,
                        cpu_usage: cpu,
                        cpu_os_usage: cpu,
                        cpu_chrome_usage: None,
                        memory_rss: (mem * 1024.0 * 1024.0) as u64,
                        memory_footprint: None,
                        gpu_usage: None,
                        js_heap_size: None,
                        memory_private: None,
                    });
                }
            }
        }
        
        if !metrics.is_empty() {
            let batch = BatchMetric { timestamp, metrics };
            let _ = app.emit("new-metric-batch", &batch);
            safe_lock(&state.buffer).push(batch);
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
    println!("Starting collection (Sidecar Mode)...");
    
    // Save target PIDs for filtering
    *safe_lock(&state.target_pids) = config.target_pids.clone();
    
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
    
    *safe_lock(&state.is_running) = true;
    safe_lock(&state.buffer).clear();
    
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
        let title = format!("Test Run - {}", Utc::now().format("%Y-%m-%d %H:%M:%S"));
        println!("Buffer size: {}. Writing to DB...", buffer.len());
        
        db.save_report(&title, &buffer).map_err(|e| e.to_string())?;
        buffer.clear();
        println!("Report saved successfully.");
        return Ok("Stopped and Saved Report".to_string());
    }
    
    println!("Stopped (No Data).");
    Ok("Stopped (No Data)".to_string())
}

#[tauri::command]
pub fn get_reports(db: State<'_, Database>) -> Result<Vec<ReportSummary>, String> {
    db.get_all_reports().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_report_detail(db: State<'_, Database>, id: i64) -> Result<ReportDetail, String> {
    db.get_report_detail(id).map_err(|e| e.to_string())
}

