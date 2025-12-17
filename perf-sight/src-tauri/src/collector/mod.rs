pub mod cdp;

use crate::models::{MetricPoint, ProcessInfo}; 
use self::cdp::{BrowserProcessInfo, CdpClient, CdpTarget};
use chrono::Utc;
use sysinfo::{Pid, System};
use std::collections::HashMap;
use std::time::Instant;

fn os_cpu_pct_for_task_manager(raw_sysinfo_cpu_pct: f32) -> f32 {
    // sysinfo's Process::cpu_usage() can exceed 100% on multi-core machines.
    //
    // For alignment:
    // - Windows Task Manager usually shows 0-100% of total CPU capacity -> normalize by CPU count.
    // - macOS Activity Monitor commonly shows per-core summed CPU% (can exceed 100%) -> do NOT normalize.
    #[cfg(target_os = "windows")]
    {
        let cpu_count = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(1) as f32;
        return raw_sysinfo_cpu_pct / cpu_count;
    }

    #[cfg(not(target_os = "windows"))]
    {
        raw_sysinfo_cpu_pct
    }
}

#[cfg(target_os = "macos")]
fn macos_total_memory_bytes() -> Option<u64> {
    // Prefer sysctl hw.memsize on macOS; it's stable and avoids relying on sysinfo refresh state.
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
    if rc == 0 && memsize > 0 {
        Some(memsize)
    } else {
        None
    }
}

#[cfg(target_os = "macos")]
fn macos_rusage_v4(pid: u32) -> Option<libc::rusage_info_v4> {
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
        Some(unsafe { info.assume_init() })
    } else {
        None
    }
}

#[cfg(target_os = "macos")]
fn macos_activity_monitor_memory_bytes(pid: u32) -> Option<u64> {
    // Activity Monitor "Memory" is closest to the kernel's phys_footprint (rusage ri_phys_footprint).
    // However, on some systems / processes we observed clearly invalid values (tens of GB).
    // In those cases, fall back to ri_resident_size (still OS-backed and usually much closer than RSS).
    let info = macos_rusage_v4(pid)?;
    let phys = info.ri_phys_footprint as u64;
    let resident = info.ri_resident_size as u64;

    // Hard sanity guard: anything above 1 TB is not plausible for a single process footprint.
    let one_tb: u64 = 1024_u64 * 1024 * 1024 * 1024;
    let total_mem_bytes = macos_total_memory_bytes().unwrap_or(0);

    let phys_plausible = phys > 0
        && phys < one_tb
        && (total_mem_bytes == 0 || phys <= total_mem_bytes.saturating_mul(2));

    if phys_plausible {
        return Some(phys);
    }

    // If phys_footprint looks wrong but resident is present, use resident as a safer fallback.
    if resident > 0 && resident < one_tb {
        eprintln!(
            "WARN: using resident_size instead of phys_footprint for pid {} (phys={} bytes, resident={} bytes, system_total={} bytes)",
            pid, phys, resident, total_mem_bytes
        );
        return Some(resident);
    }

    None
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
                            // sysinfo (0.30+) returns memory in bytes.
                            memory = proc.memory();
                            cpu = proc.cpu_usage();
                        }
                    }

                    results.push(ProcessInfo {
                        pid,
                        alias: None,
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
                        alias: None,
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
                    alias: None,
                    name: name,
                    // sysinfo returns memory in bytes.
                    memory_usage: process.memory(),
                    cpu_usage: os_cpu_pct_for_task_manager(process.cpu_usage()),
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
            let sys_pid = Pid::from(pid as usize);
            if let Some(process) = self.system.process(sys_pid) {
                point.cpu_os_usage = os_cpu_pct_for_task_manager(process.cpu_usage());
                // Default primary CPU to OS unless overridden by Chrome-aligned value in browser mode.
                point.cpu_usage = point.cpu_os_usage;
                // sysinfo returns memory in bytes, but we add a defensive macOS sanity normalization
                // to avoid regressions if a platform/build reports KiB unexpectedly.
                let rss_raw = process.memory();
                #[cfg(target_os = "macos")]
                {
                    let total = macos_total_memory_bytes().unwrap_or(0);
                    if total > 0 && rss_raw > total.saturating_mul(4) {
                        let rss_kib_as_bytes = rss_raw / 1024;
                        if rss_kib_as_bytes <= total.saturating_mul(4) {
                            eprintln!(
                                "WARN: sysinfo process.memory() looks like KiB; normalizing to bytes for pid {} (raw={}, normalized={})",
                                pid, rss_raw, rss_kib_as_bytes
                            );
                            point.memory_rss = rss_kib_as_bytes;
                        } else {
                            point.memory_rss = rss_raw;
                        }
                    } else {
                        point.memory_rss = rss_raw;
                    }
                }
                #[cfg(not(target_os = "macos"))]
                {
                    point.memory_rss = rss_raw;
                }
            }
        }

        // macOS note:
        // We intentionally do NOT emit Activity Monitor "footprint" as the default System API memory
        // because it confuses users and doesn't match Activity Monitor's "Inspect Process -> Real Memory Size".
        // For System API, we treat memory as RSS ("real memory") via sysinfo.
        // We only use rusage-based footprint as a best-effort fallback for Chrome-aligned browser metrics.

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
            if pid < 90000 {
                // Always capture footprint as a separate field so the frontend can choose it.
                point.memory_footprint = macos_activity_monitor_memory_bytes(pid);
                // And if CDP didn't provide private memory, fall back to footprint.
                if point.memory_private.is_none() {
                    point.memory_private = point.memory_footprint;
                }
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
