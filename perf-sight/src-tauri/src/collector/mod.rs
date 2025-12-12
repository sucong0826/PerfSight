pub mod cdp;

use crate::models::{MetricPoint, ProcessInfo}; 
use self::cdp::{CdpClient, CdpTarget};
use chrono::Utc;
use sysinfo::{Pid, System};
use std::collections::HashMap;

pub trait ResourceCollector {
    fn update(&mut self); 
    fn scan_processes(&mut self, mode: &str) -> Vec<ProcessInfo>;
    fn collect_process(&self, pid: u32) -> Option<MetricPoint>;
}

pub struct GeneralCollector {
    system: System,
    // Cache: Virtual PID -> WebSocket URL
    cdp_sessions: HashMap<u32, String>,
}

impl GeneralCollector {
    pub fn new() -> Self {
        let mut sys = System::new_all();
        sys.refresh_all();
        Self { 
            system: sys,
            cdp_sessions: HashMap::new()
        }
    }
}

impl ResourceCollector for GeneralCollector {
    fn update(&mut self) {
        self.system.refresh_all();
    }

    fn scan_processes(&mut self, mode: &str) -> Vec<ProcessInfo> {
        if mode == "browser" {
            // Browser Mode: Fetch from CDP
            if let Ok(targets) = CdpClient::get_targets() {
                // Filter for pages
                let pages: Vec<CdpTarget> = targets.into_iter()
                    .filter(|t| t.r#type == "page" && t.ws_url.is_some())
                    .collect();
                
                let mut results = Vec::new();
                self.cdp_sessions.clear();

                for (i, target) in pages.iter().enumerate() {
                    let mut pid = 0;
                    
                    // Try to get real PID via CDP
                    if let Some(ws) = &target.ws_url {
                        if let Some(real_pid) = CdpClient::get_pid(ws) {
                            pid = real_pid;
                        }
                    }

                    // Fallback to virtual PID
                    if pid == 0 {
                        pid = 90000 + i as u32; 
                    }
                    
                    if let Some(ws) = &target.ws_url {
                        self.cdp_sessions.insert(pid, ws.clone());
                    }

                    // Try to get OS info if PID is real
                    let mut memory = 0;
                    let mut cpu = 0.0;
                    if pid < 90000 {
                        if let Some(proc) = self.system.process(Pid::from(pid as usize)) {
                            memory = proc.memory();
                            cpu = proc.cpu_usage();
                        }
                    }

                    results.push(ProcessInfo {
                        pid,
                        name: "Chrome Tab".to_string(),
                        memory_usage: memory,
                        cpu_usage: cpu,
                        proc_type: "Tab".to_string(),
                        title: Some(target.title.clone()),
                        url: Some(target.url.clone()),
                    });
                }
                // If CDP returns targets, we use them EXCLUSIVELY in this simple mode
                if !results.is_empty() {
                    return results;
                }
            }
            // If CDP fetch fails or empty, fall through to system scan (or return empty)
        } 
        
        // System Mode: Default sysinfo logic
        self.system.refresh_processes();
        let mut results = Vec::new();
        
        for (pid, process) in self.system.processes() {
            let name = process.name().to_lowercase();
            // Match common browser executables
            let is_chrome_like = name.contains("chrome") || name.contains("edge") || name.contains("safari") || name.contains("firefox");
            
            if is_chrome_like {
                let cmd_args = process.cmd();
                let args_str = cmd_args.join(" ");
                
                let mut p_type = "Browser".to_string();
                let mut title = None;
                let url = None;

                // 1. Identify Type via Args
                if args_str.contains("--type=gpu-process") {
                    p_type = "GPU".to_string();
                    title = Some("GPU Process".to_string());
                } else if args_str.contains("--type=renderer") {
                    p_type = "Renderer".to_string();
                    title = Some("Renderer / Tab".to_string());
                } else if args_str.contains("--type=utility") {
                    p_type = "Utility".to_string();
                }

                results.push(ProcessInfo {
                    pid: pid.as_u32(),
                    name: name,
                    memory_usage: process.memory(),
                    cpu_usage: process.cpu_usage(),
                    proc_type: p_type,
                    title: title,
                    url: url,
                });
            }
        }
        results
    }

    fn collect_process(&self, pid: u32) -> Option<MetricPoint> {
        let mut point = MetricPoint {
            timestamp: Utc::now(),
            pid,
            cpu_usage: 0.0,
            memory_rss: 0,
            gpu_usage: None,
            js_heap_size: None,
        };

        // 1. Get Sysinfo Metrics (if PID is likely real)
        // Virtual PIDs start at 90000
        if pid < 90000 {
            let sys_pid = Pid::from(pid as usize);
            if let Some(process) = self.system.process(sys_pid) {
                point.cpu_usage = process.cpu_usage();
                point.memory_rss = process.memory();
            }
        }

        // 2. Get CDP Metrics (if session exists)
        if let Some(ws_url) = self.cdp_sessions.get(&pid) {
            point.js_heap_size = CdpClient::get_js_heap(ws_url);
        }

        // If we have neither Sysinfo nor CDP data (e.g. invalid PID and failed WS), return None?
        // But we might have initialized with partial data. 
        // If it's a virtual PID and WS failed, we return 0s.
        
        Some(point)
    }
}

pub fn create_collector() -> Box<dyn ResourceCollector + Send> {
    Box::new(GeneralCollector::new())
}
