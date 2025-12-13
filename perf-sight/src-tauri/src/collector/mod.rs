pub mod cdp;

use crate::models::{MetricPoint, ProcessInfo}; 
use self::cdp::{BrowserProcessInfo, CdpClient, CdpTarget};
use chrono::Utc;
use sysinfo::{Pid, System};
use std::collections::HashMap;
use std::time::Instant;

#[cfg(target_os = "macos")]
fn macos_phys_footprint_bytes(pid: u32) -> Option<u64> {
    // Uses proc_pid_rusage(RUSAGE_INFO_V4) which includes ri_phys_footprint.
    // This is the closest match to Chrome Task Manager "Memory footprint" on macOS.
    //
    // IMPORTANT: Don't define the struct manually. If the layout/size is wrong, the kernel
    // can write past the buffer and cause EXC_BAD_ACCESS/SIGSEGV later.
    use std::mem::MaybeUninit;

    let mut info = MaybeUninit::<libc::rusage_info_v4>::zeroed();

    // RUSAGE_INFO_V4 == 4 (from macOS headers). Keep as a literal to avoid libc API drift.
    const RUSAGE_INFO_V4: libc::c_int = 4;

    // libc defines proc_pid_rusage(pid, flavor, buffer: *mut rusage_info_t),
    // where rusage_info_t is itself a raw pointer type. So the function expects a
    // pointer-to-pointer. We point it at our struct buffer.
    let mut buf: libc::rusage_info_t = info.as_mut_ptr().cast::<libc::c_void>();
    let rc = unsafe { libc::proc_pid_rusage(pid as libc::c_int, RUSAGE_INFO_V4, &mut buf) };

    if rc == 0 {
        let info = unsafe { info.assume_init() };
        let footprint = info.ri_phys_footprint as u64;
        if footprint > 0 { Some(footprint) } else { None }
    } else {
        None
    }
}

pub trait ResourceCollector {
    fn update(&mut self); 
    fn scan_processes(&mut self, mode: &str) -> Vec<ProcessInfo>;
    fn collect_process(&self, pid: u32) -> Option<MetricPoint>;
}

pub struct GeneralCollector {
    system: System,
    // Cache: Virtual PID -> WebSocket URL
    cdp_sessions: HashMap<u32, String>,
    mode: String,

    // Browser Task Manager-aligned process info fetched from browser WS (/json/version).
    browser_procinfo: HashMap<u32, BrowserProcessInfo>,
    // For CPU% calculation from cpuTime deltas.
    prev_cpu_time: HashMap<u32, (f64, Instant)>,
    // Computed CPU% from CDP cpuTime deltas (closest to Chrome Task Manager CPU column).
    browser_cpu_pct: HashMap<u32, f32>,
}

impl GeneralCollector {
    pub fn new(mode: String) -> Self {
        let mut sys = System::new_all();
        sys.refresh_all();
        Self { 
            system: sys,
            cdp_sessions: HashMap::new(),
            mode,
            browser_procinfo: HashMap::new(),
            prev_cpu_time: HashMap::new(),
            browser_cpu_pct: HashMap::new(),
        }
    }
}

impl ResourceCollector for GeneralCollector {
    fn update(&mut self) {
        // sysinfo's CPU% (system and per-process) is computed from deltas between refreshes.
        // On some platforms, `refresh_all()` doesn't reliably update per-process CPU usage
        // unless processes/cpu are refreshed explicitly.
        //
        // Keep the same `System` instance and refresh at a reasonable interval (we use 1s).
        self.system.refresh_cpu();
        self.system.refresh_processes();

        if self.mode == "browser" {
            if let Ok(map) = CdpClient::get_browser_process_info() {
                self.browser_procinfo = map;

                // Update CPU% cache based on cpuTime deltas.
                let now = Instant::now();
                let cpu_count = std::thread::available_parallelism()
                    .map(|n| n.get())
                    .unwrap_or(1) as f64;
                let mut next_cpu = HashMap::new();
                for (pid, info) in self.browser_procinfo.iter() {
                    let cpu_time = info.cpu_time;
                    if let Some((prev_time, prev_instant)) = self.prev_cpu_time.get(pid) {
                        let dt = now.duration_since(*prev_instant).as_secs_f64();
                        if dt > 0.0 {
                            let dcpu = cpu_time - *prev_time;
                            // cpuTime is CPU seconds; CPU% over wall time:
                            // 100% == one fully utilized core; can exceed 100% with multi-threading.
                            // Chrome Task Manager typically normalizes by total logical CPUs (percent of total CPU capacity).
                            let pct = ((dcpu / dt) * 100.0 / cpu_count).max(0.0);
                            next_cpu.insert(*pid, pct as f32);
                        }
                    }
                    self.prev_cpu_time.insert(*pid, (cpu_time, now));
                }
                self.browser_cpu_pct = next_cpu;
            }
        }
    }

    fn scan_processes(&mut self, mode: &str) -> Vec<ProcessInfo> {
        if mode == "browser" {
            // Preload browser process info so Browser-level processes (GPU/Browser/Utility) can be selectable.
            if let Ok(map) = CdpClient::get_browser_process_info() {
                self.browser_procinfo = map;
            }

            // Browser Mode: Fetch from CDP
            if let Ok(targets) = CdpClient::get_targets() {
                // Filter for pages
                let pages: Vec<CdpTarget> = targets.into_iter()
                    .filter(|t| t.r#type == "page" && t.ws_url.is_some())
                    .collect();
                
                let mut results = Vec::new();
                self.cdp_sessions.clear();
                let mut seen_pids: std::collections::HashSet<u32> = std::collections::HashSet::new();

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
                            // sysinfo returns memory in KiB; frontend expects bytes.
                            memory = proc.memory().saturating_mul(1024);
                            cpu = proc.cpu_usage();
                        }
                    }

                    results.push(ProcessInfo {
                        pid,
                        name: "Chrome Tab".to_string(),
                        memory_usage: memory,
                        cpu_usage: cpu,
                        // Treat the selected "tab" as its backing renderer process.
                        proc_type: "Renderer".to_string(),
                        title: Some(target.title.clone()),
                        url: Some(target.url.clone()),
                    });
                    if pid < 90000 {
                        seen_pids.insert(pid);
                    }
                }

                // Add browser-level non-tab processes (GPU/Browser/Utility) so users can monitor them in Browser API mode.
                for (pid, info) in self.browser_procinfo.iter() {
                    if seen_pids.contains(pid) {
                        continue;
                    }
                    if info.proc_type == "Renderer" {
                        continue; // already represented by tabs; avoids list explosion
                    }
                    results.push(ProcessInfo {
                        pid: *pid,
                        name: "Chrome".to_string(),
                        memory_usage: info.private_mem_bytes.unwrap_or(0),
                        cpu_usage: 0.0,
                        proc_type: info.proc_type.clone(),
                        title: Some(format!("{} Process", info.proc_type)),
                        url: None,
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
        let cpu_count = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(1) as f32;
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
                    // sysinfo returns memory in KiB; frontend expects bytes.
                    memory_usage: process.memory().saturating_mul(1024),
                    // Normalize to 0-100% of total CPU capacity to match common task managers.
                    cpu_usage: process.cpu_usage() / cpu_count,
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
            cpu_os_usage: 0.0,
            cpu_chrome_usage: None,
            memory_rss: 0,
            memory_footprint: None,
            gpu_usage: None,
            js_heap_size: None,
            memory_private: None,
        };

        // 1. Get Sysinfo Metrics (if PID is likely real)
        // Virtual PIDs start at 90000
        if pid < 90000 {
            let cpu_count = std::thread::available_parallelism()
                .map(|n| n.get())
                .unwrap_or(1) as f32;
            let sys_pid = Pid::from(pid as usize);
            if let Some(process) = self.system.process(sys_pid) {
                // sysinfo process cpu_usage() can exceed 100% on multi-core machines.
                // Normalize to 0-100% of total CPU capacity for closer alignment with OS task managers.
                point.cpu_os_usage = process.cpu_usage() / cpu_count;
                // Default primary CPU to OS unless overridden by Chrome-aligned value in browser mode.
                point.cpu_usage = point.cpu_os_usage;
                // sysinfo returns memory in KiB; frontend expects bytes.
                point.memory_rss = process.memory().saturating_mul(1024);
            }
        }

        // OS Task Manager memory footprint (macOS)
        #[cfg(target_os = "macos")]
        if pid < 90000 {
            point.memory_footprint = macos_phys_footprint_bytes(pid);
        }

        // 2. Get CDP Metrics (if session exists)
        if let Some(ws_url) = self.cdp_sessions.get(&pid) {
            point.js_heap_size = CdpClient::get_js_heap(ws_url);
        }

        // 3. Browser Task Manager-aligned CPU% + Memory footprint (if available)
        // Note: This uses CDP SystemInfo.getProcessInfo (browser-level) and is the closest
        // we can get to matching Chrome Task Manager's CPU column.
        if self.mode == "browser" {
            if let Some(pct) = self.browser_cpu_pct.get(&pid) {
                point.cpu_chrome_usage = Some(*pct);
                // Default primary CPU to Chrome-aligned CPU in browser mode.
                point.cpu_usage = *pct;
            }
            if let Some(info) = self.browser_procinfo.get(&pid) {
                point.memory_private = info.private_mem_bytes;
            }

            // On macOS, Chrome Task Manager "Memory footprint" aligns better with phys_footprint
            // than RSS or CDP privateMemorySize (which may be absent depending on Chrome build).
            #[cfg(target_os = "macos")]
            if point.memory_private.is_none() && pid < 90000 {
                point.memory_private = macos_phys_footprint_bytes(pid);
            }
        }

        // If we have neither Sysinfo nor CDP data (e.g. invalid PID and failed WS), return None?
        // But we might have initialized with partial data. 
        // If it's a virtual PID and WS failed, we return 0s.
        
        Some(point)
    }
}

pub fn create_collector(mode: &str) -> Box<dyn ResourceCollector + Send> {
    Box::new(GeneralCollector::new(mode.to_string()))
}
