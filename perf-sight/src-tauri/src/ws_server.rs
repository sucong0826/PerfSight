use std::net::TcpListener;
use std::thread;
use tungstenite::accept;
use tauri::{AppHandle, Manager, State, Emitter};
use crate::commands::{CollectionState, process_websocket_metric_payload, push_custom_metric, safe_lock};
use serde_json::Value;
use chrono::{Utc, TimeZone};

fn bind_ws_listener_with_fallback() -> Option<(TcpListener, u16)> {
    // Prefer 23333, but if busy, try a small range (dev-friendly).
    // This avoids flaky `tauri dev` on Windows when a previous instance still holds the port.
    let base: u16 = 23333;
    let max_tries: u16 = 30;
    for i in 0..max_tries {
        let port = base + i;
        let addr = format!("127.0.0.1:{}", port);
        match TcpListener::bind(&addr) {
            Ok(l) => return Some((l, port)),
            Err(e) => {
                if e.kind() == std::io::ErrorKind::AddrInUse {
                    continue;
                }
                eprintln!("Failed to bind WebSocket server on {}: {}", addr, e);
                return None;
            }
        }
    }
    None
}

pub fn start_server(app_handle: AppHandle) {
    thread::spawn(move || {
        // Listen on localhost only for security.
        // Dev-friendly: if 23333 is busy, fall back to 23334/23335... and print the actual port.
        let (listener, port) = match bind_ws_listener_with_fallback() {
            Some(x) => x,
            None => {
                eprintln!("Failed to bind WebSocket server on 127.0.0.1:23333..");
                return;
            }
        };

        println!("WebSocket Server listening on 127.0.0.1:{}", port);
        let _ = app_handle.emit("ws-server-port", port);
        
        for stream in listener.incoming() {
            if let Ok(stream) = stream {
                let app = app_handle.clone();
                
                thread::spawn(move || {
                    if let Ok(mut websocket) = accept(stream) {
                        println!("New Extension Connection!");
                        
                        loop {
                            match websocket.read() {
                                Ok(msg) => {
                                    if msg.is_text() || msg.is_binary() {
                                        if let Ok(text) = msg.to_text() {
                                            if let Ok(data) = serde_json::from_str::<Value>(text) {
                                                if data["type"] == "console_log" {
                                                    // Log parsing logic
                                                    let log_data = &data["data"];
                                                    let content = log_data["content"].as_str().unwrap_or("");
                                                    let pid = log_data["pid"].as_u64().unwrap_or(0) as u32;
                                                    let ts_ms = log_data["timestamp"].as_i64().unwrap_or(Utc::now().timestamp_millis());
                                                    let timestamp = Utc.timestamp_millis_opt(ts_ms).unwrap();

                                                    let state: State<CollectionState> = app.state();
                                                    let configs = safe_lock(&state.inner().log_metrics);
                                                    
                                                    for (cfg, re) in configs.iter() {
                                                        if let Some(caps) = re.captures(content) {
                                                            // Assume the first capture group is the value
                                                            if let Some(val_match) = caps.get(1) {
                                                                if let Ok(val) = val_match.as_str().parse::<f64>() {
                                                                    // Use configured PID if present, otherwise use log PID
                                                                    let effective_pid = cfg.target_pid.unwrap_or(pid);
                                                                    
                                                                    push_custom_metric(&app, state.inner(), effective_pid, timestamp, cfg.name.clone(), val);
                                                                    // println!("Captured Custom Metric: {} = {} (PID {})", cfg.name, val, effective_pid);
                                                                }
                                                            }
                                                        }
                                                    }
                                                } else {
                                                    let state: State<CollectionState> = app.state();
                                                    process_websocket_metric_payload(&app, data, state.inner());
                                                }
                                            }
                                        }
                                    }
                                }
                                Err(_) => {
                                    println!("Extension Disconnected");
                                    break;
                                }
                            }
                        }
                    }
                });
            }
        }
    });
}

