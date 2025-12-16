use serde::{Deserialize, Serialize};
use serde_json::json;
use tungstenite::{client, Message};
use url::Url;
use std::net::TcpStream;
use std::time::Duration;

#[derive(Debug, Deserialize)]
struct CdpVersionInfo {
    #[serde(rename = "webSocketDebuggerUrl")]
    pub ws_url: Option<String>,
}

#[derive(Debug, Clone)]
pub struct BrowserProcessInfo {
    pub cpu_time: f64,
    pub private_mem_bytes: Option<u64>,
    pub proc_type: String,
}

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

    fn get_browser_ws_url() -> Result<String, String> {
        let url = "http://localhost:9222/json/version";
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(2))
            .build()
            .map_err(|e| e.to_string())?;

        let resp = client.get(url).send().map_err(|e| e.to_string())?;
        let version: CdpVersionInfo = resp.json().map_err(|e| e.to_string())?;
        version
            .ws_url
            .ok_or_else(|| "Missing webSocketDebuggerUrl in /json/version".to_string())
    }

    /// Fetch browser-level process info (same source Chrome Task Manager uses internally).
    /// Returns a map keyed by OS process id.
    pub fn get_browser_process_info() -> Result<std::collections::HashMap<u32, BrowserProcessInfo>, String> {
        let ws_url = Self::get_browser_ws_url()?;
        let (mut socket, _) = Self::connect_ws(&ws_url).ok_or_else(|| "Failed to connect to browser websocket".to_string())?;
        let total_mem_bytes = sysinfo::System::new().total_memory().max(1);

        let _ = socket.send(Message::Text(
            json!({ "id": 101, "method": "SystemInfo.getProcessInfo" }).to_string().into(),
        ));

        for _ in 0..10 {
            if let Ok(Message::Text(text)) = socket.read() {
                let v: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
                if v["id"] == 101 {
                    let mut out = std::collections::HashMap::new();
                    if let Some(infos) = v["result"]["processInfo"].as_array() {
                        for info in infos {
                            let id = info["id"].as_u64().unwrap_or(0) as u32;
                            if id == 0 {
                                continue;
                            }
                            let cpu_time = info["cpuTime"].as_f64().unwrap_or(0.0);
                            let proc_type_raw = info["type"].as_str().unwrap_or("other").to_string();
                            let proc_type_norm = proc_type_raw.to_lowercase();
                            let proc_type = match proc_type_norm.as_str() {
                                "gpu" => "GPU".to_string(),
                                "renderer" => "Renderer".to_string(),
                                "browser" => "Browser".to_string(),
                                "utility" => "Utility".to_string(),
                                _ => {
                                    // Some builds return fully-qualified service names like
                                    // "network.mojom.NetworkService" / "storage.mojom.StorageService".
                                    if proc_type_norm.contains("network") || proc_type_norm.contains("storage") || proc_type_norm.contains("service") {
                                        "Utility".to_string()
                                    } else {
                                        "Other".to_string()
                                    }
                                }
                            };

                            // CDP docs say privateMemorySize is in KB, but some builds appear to return bytes.
                            // Choose the interpretation that yields a plausible value relative to system RAM.
                            let private_mem_bytes = info
                                .get("privateMemorySize")
                                .and_then(|m| m.as_u64())
                                .and_then(|raw| {
                                    let as_kib_bytes = raw.saturating_mul(1024);
                                    let as_bytes = raw;
                                    let plaus_kib = as_kib_bytes <= total_mem_bytes.saturating_mul(4);
                                    let plaus_bytes = as_bytes <= total_mem_bytes.saturating_mul(4);
                                    match (plaus_kib, plaus_bytes) {
                                        (true, false) => Some(as_kib_bytes),
                                        (false, true) => Some(as_bytes),
                                        (true, true) => Some(as_kib_bytes), // prefer spec unit
                                        (false, false) => None,
                                    }
                                });

                            out.insert(
                                id,
                                BrowserProcessInfo {
                                    cpu_time,
                                    private_mem_bytes,
                                    proc_type,
                                },
                            );
                        }
                    }
                    return Ok(out);
                }
            }
        }

        Err("Timed out waiting for SystemInfo.getProcessInfo response".to_string())
    }

    /// Debug helper: return the raw `result.processInfo` array from CDP `SystemInfo.getProcessInfo`.
    /// This is useful to align fields/units with Chrome Task Manager across platforms/versions.
    pub fn get_browser_process_info_raw() -> Result<serde_json::Value, String> {
        let ws_url = Self::get_browser_ws_url()?;
        let (mut socket, _) = Self::connect_ws(&ws_url)
            .ok_or_else(|| "Failed to connect to browser websocket".to_string())?;

        let _ = socket.send(Message::Text(
            json!({ "id": 201, "method": "SystemInfo.getProcessInfo" }).to_string().into(),
        ));

        for _ in 0..10 {
            if let Ok(Message::Text(text)) = socket.read() {
                let v: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
                if v["id"] == 201 {
                    return Ok(v["result"]["processInfo"].clone());
                }
            }
        }

        Err("Timed out waiting for SystemInfo.getProcessInfo response".to_string())
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

        // Best-effort PID mapping for a Page target:
        // 1) Prefer Page.getProcessId (returns the renderer OS processId for this page).
        // 2) Fallback to SystemInfo.getProcessInfo and pick a renderer entry (imprecise).

        // 1. Page.enable
        let _ = socket.send(Message::Text(
            json!({ "id": 10, "method": "Page.enable" }).to_string().into(),
        ));
        let _ = socket.read(); // consume any ack/event

        // 2. Page.getProcessId (preferred)
        let _ = socket.send(Message::Text(
            json!({ "id": 11, "method": "Page.getProcessId" }).to_string().into(),
        ));

        for _ in 0..5 {
            if let Ok(Message::Text(text)) = socket.read() {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                    if v["id"] == 11 {
                        if let Some(pid) = v["result"]["processId"].as_u64() {
                            return Some(pid as u32);
                        }
                        break; // got response but no pid, fallback below
                    }
                }
            }
        }

        // 3. Fallback: SystemInfo.getProcessInfo (imprecise on a Page target)
        let _ = socket.send(Message::Text(
            json!({ "id": 12, "method": "SystemInfo.getProcessInfo" }).to_string().into(),
        ));

        for _ in 0..8 {
            if let Ok(Message::Text(text)) = socket.read() {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                    if v["id"] == 12 {
                        if let Some(infos) = v["result"]["processInfo"].as_array() {
                            for info in infos {
                                let t = info["type"].as_str().unwrap_or("").to_lowercase();
                                if t == "renderer" {
                                    if let Some(id) = info["id"].as_u64() {
                                        return Some(id as u32);
                                    }
                                }
                            }
                        }
                        break;
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
