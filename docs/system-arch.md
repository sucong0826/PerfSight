PerfSight 系统设计与架构文档 (System Design Document)

1. 系统概述

PerfSight 是一款端到端（End-to-End）的 Web 应用性能测试与监控工具。它采用 C/S 架构，旨在从“外部观察者”（操作系统）和“内部参与者”（浏览器内核）两个维度，精确采集 Web App 的资源消耗（CPU/GPU/内存/电量）。

2. 总体架构图

系统主要由 Client (采集端) 和 Server (数据存储与管理端) 两部分组成。

graph TD
    subgraph "Target Environment (User PC)"
        OS[Operating System Kernel]
        Chrome[Chrome / Edge Browser]
        Chrome -->|Remote Debugging (CDP)| Agent
        OS -->|SysCall / WinAPI / Mach| Agent
    end

    subgraph "PerfSight Client (Tauri)"
        direction TB
        
        subgraph "Frontend (React)"
            UI[Dashboard UI]
            Charts[Real-time Charts]
            Control[Control Panel]
        end
        
        subgraph "Backend (Rust)"
            CMD[Command Handler]
            Collector[Hybrid Collector]
            SysMod[System Module (sysinfo)]
            BrowserMod[Browser Module (reqwest/ws)]
            Uploader[Data Uploader]
        end
        
        UI <-->|Tauri IPC (Invoke/Emit)| CMD
        CMD --> Collector
        Collector -->|Get Proc Info| SysMod
        Collector -->|Get Tab/Heap| BrowserMod
        SysMod -.->|Read| OS
        BrowserMod -.->|HTTP/WS :9222| Chrome
        Collector -->|Metric Data| Uploader
    end

    subgraph "PerfSight Server (Backend)"
        API[API Gateway (FastAPI)]
        Storage[(Data Storage)]
        
        Uploader -->|HTTP/WebSocket| API
        API --> Storage
    end


3. 核心模块设计 (Client 端)

客户端采用 Tauri v2 框架，利用 Rust 的高性能和内存安全特性作为采集核心，React 作为交互界面。

3.1 混合采集引擎 (Hybrid Collector)

这是 PerfSight 的核心差异化功能，它合并了两个数据源：

System Level (OS 视角)

技术栈: sysinfo crate (Rust)。

数据:

PID (进程ID)

CPU Usage (内核时间 + 用户时间)

Memory RSS (物理内存占用)

优势: 真实反映设备负载，包含 GPU 进程和渲染进程的实际开销。

Browser Level (CDP 视角)

技术栈: reqwest / tungstenite (Rust) 连接 Chrome DevTools Protocol。

数据:

Tab Title / URL (识别具体的 Web App)

JS Heap Size (V8 引擎堆内存)

DOM Nodes Count (DOM 复杂度)

优势: 能够区分同一个浏览器实例下的不同 Tab，获取业务相关的性能指标。

3.2 数据流向 (Data Flow)

用户操作: 前端点击 "Start Test"（支持多选进程）。

指令下发: React 通过 invoke('start_collection', { pids: [u32], mode }) 调用 Rust。

采集循环: Rust 开启异步线程 (tokio::spawn)，每 interval_ms (如 1000ms) 执行一次采集。
- 遍历所有目标 PID，分别采集系统资源。
- 如果开启 Browser 模式，尝试获取对应 Tab 的 CDP 数据。

数据聚合: Collector 将单次采集的所有进程数据打包为 `BatchMetric`。

实时推送: Rust 通过 app_handle.emit('new-metric-batch', data) 将批量数据推送到前端。

数据上传: 采集结束后或定期（Batch），Client 将 MetricPoint 序列化并发送至 Server 端进行持久化存储。

4. 服务端设计 (Server Side)

目标: 提供数据的持久化存储，便于后续的历史回溯、对比分析和生成报告。

4.1 核心职责
- **接收数据**: 提供 REST API 或 WebSocket 接口接收 Client 上传的测试数据。
- **数据存储**: 将测试元数据（Test Metadata）和时序指标数据（Time-series Metrics）保存到数据库。
- **管理能力**: 管理测试用例、项目归属及历史记录。

4.2 存储设计概念 (Storage Concept)
*具体技术选型（如 PostgreSQL/TimescaleDB/InfluxDB）待定，设计上保持灵活。*

主要包含两类数据：

1.  **Session Metadata (测试会话元数据)**
    *   `session_id`: 唯一标识一次测试运行。
    *   `app_name`: 被测应用名称。
    *   `browser_version`: 浏览器版本信息。
    *   `os_info`: 操作系统信息。
    *   `start_time` / `end_time`: 测试起止时间。
    *   `tags`: 标签（如 "v1.2.0", "regression", "smoke-test"）。

2.  **Metric Data (指标数据)**
    *   `session_id`: 关联到具体的测试会话。
    *   `timestamp`: 采集时间点。
    *   `metrics`: JSON 结构，存储所有采集到的指标（CPU, Memory, JS Heap, GPU 等）。
        *   设计为灵活的 JSON/BSON 格式，以便未来扩展新的指标类型（如 FPS, Network Usage）而无需修改表结构。

5. 数据模型 (Client)

5.1 进程信息 (ProcessInfo)

用于在列表中展示和选择目标。

struct ProcessInfo {
    pid: u32,
    name: String,       // e.g., "chrome.exe"
    proc_type: String,  // "Renderer", "GPU", "Browser"
    title: Option<String>, // e.g., "YouTube - Video" (仅 Browser 模式)
    cpu_usage: f32,
    memory_usage: u64,
}


5.2 性能指标点 (MetricPoint)

单进程数据点：
struct MetricPoint {
    timestamp: DateTime<Utc>,
    pid: u32,
    cpu_usage: f32,      // System Level
    memory_rss: u64,     // System Level
    js_heap_size: Option<u64>, // Browser Level
    gpu_usage: Option<f32>,    // System Level (Phase 2)
}

5.3 批量指标 (BatchMetric) - 用于支持多进程并发监控

struct BatchMetric {
    timestamp: DateTime<Utc>,
    points: Vec<MetricPoint>, // 包含所有监控进程的数据点
}
