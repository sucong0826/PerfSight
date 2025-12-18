
use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};

use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessInfo {
    pub pid: u32,
    #[serde(default)]
    pub alias: Option<String>,
    pub name: String,
    pub memory_usage: u64, // bytes
    pub cpu_usage: f32,    // percentage
    // New fields
    pub proc_type: String, // Browser, GPU, Renderer, Utility, Other
    pub title: Option<String>,
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetricPoint {
    pub timestamp: DateTime<Utc>,
    pub pid: u32,
    /// Selected/primary CPU% (kept for backward compatibility with older UI).
    /// - system mode: OS CPU%
    /// - browser mode: Chrome Task Manager-aligned CPU% when available, else OS CPU%
    pub cpu_usage: f32,
    /// OS-level CPU% for this PID (sysinfo).
    pub cpu_os_usage: f32,
    /// Chrome Task Manager-aligned CPU% derived from CDP cpuTime deltas (when available).
    pub cpu_chrome_usage: Option<f32>,
    pub memory_rss: u64,
    /// OS task-manager style memory footprint (macOS: phys_footprint), when available.
    pub memory_footprint: Option<u64>,
    pub gpu_usage: Option<f32>, 
    pub js_heap_size: Option<u64>, // Browser Metric
    // Browser Task Manager-aligned metric (when available via CDP SystemInfo.getProcessInfo)
    // Typically reported as "Memory footprint" / private memory.
    pub memory_private: Option<u64>,
    // Dynamic metrics extracted from Console Logs or Custom Events (e.g. "Inference Time", "FPS")
    pub custom_metrics: Option<HashMap<String, f64>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessAlias {
    pub pid: u32,
    pub alias: String,
}

#[derive(Debug, Deserialize)]
pub struct CollectionConfig {
    pub target_pids: Vec<u32>,
    pub interval_ms: u64,
    pub mode: String, // "system" | "browser"
    pub test_context: Option<TestContext>,
    pub process_aliases: Option<Vec<ProcessAlias>>,
    /// Optional: auto-stop after N seconds and generate report.
    pub stop_after_seconds: Option<u64>,
    pub log_metric_configs: Option<Vec<LogMetricConfig>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogMetricConfig {
    pub name: String,
    pub pattern: String,
    pub unit: Option<String>,
    pub target_pid: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestContext {
    pub scenario_name: Option<String>,
    pub build_id: Option<String>,
    pub tags: Option<Vec<String>>,
    pub notes: Option<String>,
}

// New Batch Metric for broadcasting
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchMetric {
    pub timestamp: DateTime<Utc>,
    pub metrics: HashMap<u32, MetricPoint>, // Map<PID, Metric>
}

// CDP JSON Structures (http://localhost:9222/json/list)
#[derive(Debug, Deserialize, Clone)]
pub struct CdpTarget {
    pub id: String,
    pub title: String,
    pub r#type: String, // "page", "iframe", "service_worker"
    pub url: String,
    #[serde(rename = "webSocketDebuggerUrl")]
    pub web_socket_debugger_url: Option<String>,
}
