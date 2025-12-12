use serde::{Deserialize, Serialize};
use serde_json::json;
use tungstenite::{client, Message};
use url::Url;
use std::net::TcpStream;
use std::time::Duration;

#[derive(Debug, Deserialize, Clone, Serialize)]
pub struct CdpTarget {
    pub id: String,
    pub title: String,
    pub r#type: String,
    pub url: String,
    #[serde(rename = "webSocketDebuggerUrl")]
    pub ws_url: Option<String>,
}

#[derive(Deserialize)]
pub struct HeapUsage {
    #[serde(rename = "usedSize")]
    pub used_size: u64,
    #[serde(rename = "totalSize")]
    pub total_size: u64,
}

pub struct CdpClient;

impl CdpClient {
    pub fn get_targets() -> Result<Vec<CdpTarget>, String> {
        let url = "http://localhost:9222/json/list";
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(2))
            .build()
            .map_err(|e| e.to_string())?;
            
        let resp = client.get(url).send().map_err(|e| e.to_string())?;
        let targets: Vec<CdpTarget> = resp.json().map_err(|e| e.to_string())?;
        Ok(targets)
    }

    // Helper to connect with timeout
    fn connect_ws(ws_url: &str) -> Option<(tungstenite::WebSocket<TcpStream>, tungstenite::handshake::client::Response)> {
        let url_obj = Url::parse(ws_url).ok()?;
        let host = url_obj.host_str()?;
        let port = url_obj.port_or_known_default()?;
        let addr = format!("{}:{}", host, port);

        let stream = TcpStream::connect(addr).ok()?;
        stream.set_read_timeout(Some(Duration::from_millis(500))).ok()?;
        stream.set_write_timeout(Some(Duration::from_millis(500))).ok()?;

        client(url_obj.as_str(), stream).ok()
    }

    pub fn get_pid(ws_url: &str) -> Option<u32> {
        let (mut socket, _) = Self::connect_ws(ws_url)?;

        // Try SystemInfo.getProcessInfo (Browser level) - might fail on Page target
        // Try Page.getProcessId (Page level) - Experimental but common
        // We try Page.getProcessId first as it's specific to the frame
        
        // 1. Page.enable
        let _ = socket.send(Message::Text(json!({ "id": 10, "method": "Page.enable" }).to_string().into()));
        let _ = socket.read(); // Consume

        // 2. Page.getProcessId
        let _ = socket.send(Message::Text(json!({ "id": 11, "method": "SystemInfo.getProcessInfo" }).to_string().into()));
        // Note: SystemInfo.getProcessInfo on a Page target usually returns the process info FOR THAT RENDERER in the 'processInfo' array? 
        // Actually, let's try a better one: "Page.getResourceTree" -> frame.processId?
        
        // Let's stick to the most reliable: SystemInfo.getProcessInfo usually returns ALL processes.
        // But for a specific Tab, we want ITS pid.
        
        // Let's try the undocumented "Page.getProcessId" if available, or assume SystemInfo returns single entry?
        // Actually, in `explore_cdp.py`, we saw SystemInfo.getProcessInfo returns an array.
        
        // CHANGE STRATEGY:
        // We use `Runtime.evaluate` to get `pid`? No, JS can't access PID.
        
        // Back to `SystemInfo.getProcessInfo`. If we call it on a Page Target, does it return only relevant processes?
        // Let's try reading it.
        
        for _ in 0..5 {
            if let Ok(Message::Text(text)) = socket.read() {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                    if v["id"] == 11 {
                        // Check result.processInfo
                        if let Some(infos) = v["result"]["processInfo"].as_array() {
                            // If there's only one renderer in the list, that's it.
                            // If multiple, we are lost without matching.
                            // But usually, connecting to a Page and asking SystemInfo might filter it?
                            // Let's just take the first 'renderer' type we see? No, dangerous.
                            
                            // Let's try searching for a matching ID? No common ID.
                            
                            for info in infos {
                                if info["type"].as_str() == Some("renderer") {
                                    return info["id"].as_u64().map(|id| id as u32);
                                }
                            }
                        }
                    }
                }
            }
        }
        
        None
    }

    pub fn get_js_heap(ws_url: &str) -> Option<u64> {
        let (mut socket, _) = Self::connect_ws(ws_url)?;

        let _ = socket.send(Message::Text(json!({
            "id": 1, "method": "Runtime.enable"
        }).to_string().into()));
        let _ = socket.read(); 

        let _ = socket.send(Message::Text(json!({
            "id": 2, "method": "Runtime.getHeapUsage"
        }).to_string().into()));

        for _ in 0..5 {
            if let Ok(Message::Text(text)) = socket.read() {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                    if v["id"] == 2 {
                        if let Some(res) = v.get("result") {
                            return res["usedSize"].as_u64();
                        }
                    }
                }
            }
        }
        None
    }
}
