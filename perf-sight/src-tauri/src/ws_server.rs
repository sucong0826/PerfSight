use std::net::TcpListener;
use std::thread;
use tungstenite::accept;
use tauri::{AppHandle, Manager, State};
use crate::commands::{CollectionState, process_metric_payload};
use serde_json::Value;

pub fn start_server(app_handle: AppHandle) {
    thread::spawn(move || {
        // Listen on localhost only for security
        let listener = match TcpListener::bind("127.0.0.1:23333") {
            Ok(l) => l,
            Err(e) => {
                eprintln!("Failed to bind WebSocket server: {}", e);
                return;
            }
        };
        
        println!("WebSocket Server listening on 127.0.0.1:23333");
        
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
                                                let state: State<CollectionState> = app.state();
                                                process_metric_payload(&app, data, state.inner());
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

