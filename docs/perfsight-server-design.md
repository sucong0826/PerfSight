## PerfSightServer 设计文档（PerfSight 2.0）

> **目标**：将 PerfSight 从“本地桌面端单机工具”升级为“团队级性能测试平台（可上传、可检索、可对比、可分享、可自动化）”。  
> **核心驱动**：ChromeOS / Android / iOS 等平台无法依赖桌面端采集器，必须通过 Server 统一承接数据与展示。  
> **AI**：后置，但 Server 必须从一开始就保存足够的元数据与可复现数据集（Dataset），为 AI 分析提供稳定输入。

---

## 1. 需求与范围

### 1.1 必须满足（MVP）
- **上传与持久化**
  - 接收 Client 上传的报告数据（优先复用现有 Dataset：`export_report_dataset` 的 JSON）
  - 支持 ChromeOS Extension 的实时流式上报（WebSocket）
- **Web 查看**
  - Report 列表 / 详情页（图表展示）
  - 基础过滤：`release / scenario / tags / build_id / 时间范围 / 平台`
- **对比（Compare）**
  - 最少支持 2 个 report 的对比视图（与你们现有 Compare 的概念一致）
- **归档/分组**
  - 以 tag `release:<version>` 作为“目录”（Release Folder）组织报告

### 1.2 增强（V1）
- **鉴权与权限**
  - API Token（最小可用），后续可接 OAuth（GitHub/Google）
  - 多项目隔离（project / environment）
- **趋势**
  - 同场景 across releases 的趋势看板（CPU/Memory/自定义指标）
- **CI/自动化入口**
  - CLI / Runner 自动上传并打标签

### 1.3 后置（V2）
- **AI 分析**
  - 规则/阈值判定 → AI 解释与归因建议
  - 回归检测（同场景 baseline 对比）

---

## 2. 总体架构

### 2.1 组件划分
- **Ingest Gateway**
  - HTTP：上传 Dataset（JSON/zip）
  - WebSocket：接收实时指标流（ChromeOS Extension / future agents）
- **API Service**
  - Report / Project / Tag / Compare 查询与管理
- **Storage**
  - 元数据：Postgres（JSONB）
  - 大对象：对象存储（S3/MinIO）或文件系统（MVP）
- **Web UI**
  - Reports 列表/详情/对比/筛选（浏览器可访问）
- **Worker（可选）**
  - 异步任务：分析/聚合/索引/AI

### 2.2 架构拓扑（逻辑图）

```mermaid
graph TD
  subgraph Clients
    EXT[ChromeOS Extension]
    DESKTOP[PerfSight Desktop (Tauri)]
    ANDROID[Android Agent/Runner]
    IOS[iOS Runner]
  end

  subgraph Server["PerfSightServer"]
    ING[Ingest (HTTP/WS)]
    API[REST API]
    UI[Web UI]
    WORKER[Worker/Jobs]
    DB[(Postgres)]
    OBJ[(Object Storage)]
  end

  EXT -->|WSS /ws| ING
  DESKTOP -->|HTTPS upload dataset| ING
  ANDROID -->|HTTPS upload dataset| ING
  IOS -->|HTTPS upload dataset| ING

  ING --> DB
  ING --> OBJ
  API --> DB
  UI --> API
  WORKER --> DB
  WORKER --> OBJ
```

---

## 3. 数据契约（Dataset Schema）

### 3.1 统一输入：Dataset（推荐复用）
Server 以“Dataset”为基本落盘单位。  
建议沿用你们现有结构（示意）：

- `schema_version`
- `exported_at`
- `report`
  - `id`（server 生成）
  - `created_at`
  - `title`
  - `metrics: BatchMetric[]`
  - `analysis`（可选：server 生成/覆盖）
  - `meta`（关键：test_context/env/collection/definitions）

### 3.2 元数据（必须字段）
为了支持过滤/归档/对比/趋势，MVP 就要稳定保存这些字段：
- `meta.test_context`
  - `scenario_name`
  - `build_id`
  - `tags[]`（含 `release:<version>`）
  - `notes`
- `meta.collection`
  - `mode`（system/browser/hybrid）
  - `metric_standard`（os/chrome）
  - `interval_ms`
  - `started_at` / `ended_at` / `duration_seconds`
- `meta.env`
  - `os` / `arch` / `device_name`
  - `browser_channel` / `browser_version`（ChromeOS 尤其关键）
  - `extension_version` / `app_version`

### 3.3 指标模型（BatchMetric）
- 时间序列以 `BatchMetric(timestamp, metrics{pid->MetricPoint})` 形式保存（与你们现有一致）
- `MetricPoint` 支持：
  - OS：`cpu_os_usage`, `memory_rss`, `memory_footprint`
  - Chrome：`cpu_chrome_usage`, `memory_private`
  - Custom：`custom_metrics{key->value}`

> Hybrid 模式：同一 PID 在同一窗口可能同时存在 OS 与 Chrome 字段；Server 不应覆盖，必须并存。

---

## 4. 存储设计

### 4.1 MVP（最快落地）
- **runs 元数据**：SQLite/Postgres（二选一；推荐直接 Postgres）
- **dataset 原文**：文件系统（`data/runs/<id>.json`）或对象存储
- **索引字段冗余**：将 `release/scenario/build_id/tags/created_at` 冗余到 runs 表，避免每次解析大 JSON

### 4.2 V1（可规模化）
- Postgres 表设计（建议）：
  - `projects`
  - `runs`（一条 report/run 的索引字段 + 指向 artifact）
  - `artifacts`（dataset JSON 存储位置：s3_key 或 db jsonb）
  - `tags`（可选：或直接 runs.tags JSONB）
  - `run_metrics_summary`（可选：预计算 avg/max/p95 等）

---

## 5. 接口设计（API + WebSocket）

### 5.1 HTTP API（建议 v1）
- `POST /api/v1/datasets`：上传 dataset（JSON 或 zip）
- `GET /api/v1/runs`：列表（支持 query：release/scenario/tags/build/timeRange/platform）
- `GET /api/v1/runs/:id`：详情（返回 meta + metrics 或返回 signed url）
- `GET /api/v1/runs/:id/download`：下载 dataset
- `POST /api/v1/compare`：对比（ids=[a,b]）
- `GET /api/v1/tags`：tags 统计（用于过滤面板）

### 5.2 WebSocket Ingest（ChromeOS Extension）
建议将“每次连接 = 一个 run”，并在握手参数/首帧带上 meta：
- 连接：`wss://server/ws?scenario=...&release=...&build=...&tags=a,b`
- 首帧：`{type:"hello", token, client:{platform:"chromeos", ext_version:"..."}}`
- 数据帧：
  - `{type:"data", timestamp, metrics:{pid:{cpu,memory}}}`
  - `{type:"console_log"|"custom_metric", data:{...}}`
- 结束：
  - `{type:"stop"}` 或 socket close 触发落盘

---

## 6. 安全与权限

### 6.1 MVP
- **API Token**：Header `Authorization: Bearer <token>`（或 query token）
- **TLS**：ChromeOS 推荐 WSS/HTTPS
- **CORS**：仅开放 Web UI 域名

### 6.2 V1
- OAuth 登录（可选）
- RBAC：project 维度权限
- Signed URL：下载 dataset 使用短期签名链接

---

## 7. 可观测性与运维
- 请求日志：ingest 的 run_id、payload size、来源平台
- 指标：QPS、WS 连接数、落盘耗时、失败率
- 追踪：run 的生命周期（start → ingest → finalize）

---

## 8. 部署形态

### 8.1 MVP
- 单机 Docker（Server + 本地 data 目录）

### 8.2 V1
- Server（容器）+ Postgres + S3/MinIO + Nginx/Caddy（TLS/WSS）

---

## 9. 与现有 PerfSight 的集成点
- Desktop 端：Stop 后自动 `export_report_dataset` → 上传 Server
- ChromeOS：Extension 直连 Server（无需 Desktop）
- Release Folder：统一用 tag `release:<version>`（你们已实现本地端归档逻辑，可迁移到 Server）


