
use tauri::{AppHandle, Emitter, State};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use std::thread::{self, JoinHandle};
use crate::models::{CollectionConfig, ProcessInfo, BatchMetric};
use crate::collector::create_collector;
use chrono::Utc;
use std::collections::HashMap;
use crate::database::Database;
use crate::database::{ReportSummary, ReportDetail};
use std::panic;
use crate::collector::cdp::CdpClient;
use serde_json::Value;

pub struct CollectionState {
    pub handle: Arc<Mutex<Option<JoinHandle<()>>>>,
    pub is_running: Arc<Mutex<bool>>,
    pub buffer: Arc<Mutex<Vec<BatchMetric>>>,
}

impl CollectionState {
    pub fn new() -> Self {
        Self {
            handle: Arc::new(Mutex::new(None)),
            is_running: Arc::new(Mutex::new(false)),
            buffer: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

// Struct for arguments
#[derive(serde::Deserialize)]
pub struct ProcessListArgs {
    mode: String,
}

// Helper to handle mutex poisoning gracefully
fn safe_lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    match mutex.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            eprintln!("WARNING: Mutex was poisoned! Recovering...");
            poisoned.into_inner()
        }
    }
}

#[tauri::command]
pub async fn get_process_list(args: Option<ProcessListArgs>) -> Result<Vec<ProcessInfo>, String> {
    let mode = args.map(|a| a.mode).unwrap_or("system".to_string());

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
    println!("Starting collection (Safe Mode)...");
    
    {
        let mut running = safe_lock(&state.is_running);
        if *running {
            return Ok("Already running".to_string());
        }
        *running = true;
    }

    // Clear buffer explicitly
    safe_lock(&state.buffer).clear();

    let is_running_clone = state.is_running.clone();
    let pids = config.target_pids;
    let interval = config.interval_ms;
    let mode = config.mode.clone();

    let buffer_clone = state.buffer.clone();

    // Spawn thread with panic catching
    let task = thread::spawn(move || {
        let is_running_loop = is_running_clone.clone();
        let result = panic::catch_unwind(panic::AssertUnwindSafe(move || {
            let mut collector = create_collector(&mode);
            println!("Collector created. Loop starting...");

            while *safe_lock(&is_running_loop) {
                // 1. Update
                // println!("Collector update..."); // Verbose
                collector.update();
                
                let mut batch_data = HashMap::new();
                
                // 2. Collect PIDs
                for pid in &pids {
                    if let Some(metric) = collector.collect_process(*pid) {
                         batch_data.insert(*pid, metric);
                    }
                }

                if !batch_data.is_empty() {
                    let batch = BatchMetric {
                        timestamp: Utc::now(),
                        metrics: batch_data,
                    };
                    
                    // 3. Emit event
                    if let Err(e) = app_handle.emit("new-metric-batch", &batch) {
                        eprintln!("Emit error: {}", e);
                    }
                    
                    // 4. Push to buffer
                    {
                        let mut buf = safe_lock(&buffer_clone);
                        buf.push(batch);
                    }
                }

                thread::sleep(Duration::from_millis(interval));
            }
        }));

        if let Err(err) = result {
            eprintln!("CRITICAL: Collection thread panicked! {:?}", err);
            // Ensure we reset running state if possible, though stop_collection handles cleanup
            let mut running = safe_lock(&is_running_clone);
            *running = false;
        } else {
            println!("Collection thread exited gracefully.");
        }
    });

    let mut handle_guard = safe_lock(&state.handle);
    *handle_guard = Some(task);

    Ok("Started".to_string())
}

#[tauri::command]
pub fn stop_collection(
    state: State<'_, CollectionState>,
    db: State<'_, Database>
) -> Result<String, String> {
    println!("Stopping collection...");
    
    // 1. Set flag to false (using safe_lock)
    {
        let mut running = safe_lock(&state.is_running);
        *running = false;
    }
    
    // 2. Wait for thread
    let handle_opt = {
        let mut handle = safe_lock(&state.handle);
        handle.take()
    };

    if let Some(h) = handle_opt {
        println!("Joining collection thread...");
        if let Err(e) = h.join() {
             eprintln!("Error joining thread (it might have panicked): {:?}", e);
        }
        println!("Thread joined.");
    }
    
    // 3. Save Report
    println!("Saving report...");
    let mut buffer = safe_lock(&state.buffer);
    
    if !buffer.is_empty() {
        let title = format!("Test Run - {}", Utc::now().format("%Y-%m-%d %H:%M:%S"));
        println!("Buffer size: {}. Writing to DB...", buffer.len());
        
        if let Err(e) = db.save_report(&title, &buffer) {
             eprintln!("Failed to save report: {}", e);
             return Err(format!("Failed to save report: {}", e));
        }
        
        buffer.clear();
        println!("Report saved successfully.");
        return Ok("Stopped and Saved Report".to_string());
    }
    
    println!("Stopped (No Data in buffer).");
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

#[tauri::command]
pub async fn debug_get_cdp_process_info() -> Result<Value, String> {
    let res = tokio::task::spawn_blocking(move || CdpClient::get_browser_process_info_raw())
        .await
        .map_err(|e| e.to_string())??;
    Ok(res)
}
