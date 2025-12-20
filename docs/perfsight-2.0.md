## PerfSight 2.0

> **状态**：规划中（2.0 阶段工作清单）  
> **核心目标**：把 PerfSight 从“桌面端工具 + 手动操作”为主，升级为“可规模化的团队性能测试平台（可上传、可协作、可自动化、可多端）”。  
> **首要优先级**：**ChromeOS 支持（贴近项目实际、最急需）**。  

---

## 2.0 的范围（你提出的 4 大需求）

### 2.0-A：AI 分析（放到最后做，但现在就要为 AI 做准备）
- **最终形态**：报告生成后自动给出“是否回归/原因/建议/可行动项”，并能对比基线与趋势。
- **2.0 阶段的策略**：先做确定性（统计/规则/阈值）分析，再接入 LLM 做“解释与建议”，避免 AI 变成不稳定的裁判。
- **为 AI 提前铺路的数据契约（必须）**
  - **场景维度**：scenario、tags、build id、release、notes
  - **环境维度**：OS/设备型号/浏览器渠道/版本、扩展版本、App 版本
  - **阈值与基线**：每个指标的 SLO/阈值、baseline report（同场景上一版本）
  - **自定义指标**：业务指标（Inference Time/FPS 等）要有单位与语义说明

---

### 2.0-B：PerfSightServer（Backend + Web）
> **目标**：任何人查看 Test Report 不需要安装 PerfSight 桌面端；测试结束后自动上传到 Server，统一检索、对比、共享。

- **MVP 必备**
  - **Upload API**：接收 report dataset（复用现有 `export_report_dataset` 产物）
  - **Report Web UI**：列表/详情/图表/下载 dataset
  - **筛选维度**：release、scenario、tags、build id、时间范围、平台
  - **Compare**：两份报告对比（你们已有 compare 方向，可直接迁移）
- **V1 增强**
  - 权限与组织（团队/项目隔离）
  - 趋势看板（同场景 across releases）
  - Server 端分析（先规则，后 AI）
- **存储建议**
  - **短期**：Postgres(JSONB) 存 meta + 指标摘要；对象存储（S3/兼容）存大 dataset
  - **中期**：将时间序列拆表或引入 TSDB（仅在数据量与查询压力上来后再做）

---

### 2.0-C：Multiple OS Support（ChromeOS / iOS / Android）
> **策略**：不要强求“一套技术覆盖三端”。按平台能力边界拆解，逐端交付。

- **ChromeOS（优先）**：尽量延续你们现在的 Browser API 思路（Task Manager 对齐）+ Server 化
- **iOS（最难）**：无 Chrome 扩展生态 → 走“WebKit + 自动化 + 系统指标（MetricKit/Instruments）+ Server”
- **Android**：走“设备侧采集（Perfetto/dumpsys）+ 页面自定义指标 + Server”

---

### 2.0-D：从半自动到全自动（Test Orchestrator）
> **目标**：从“手动切场景/重启浏览器/肉眼看 Task Manager”变成“一键/CI 自动跑完并产出报告 + 上传 + 对比 + 告警”。

- **建议路线**
  - **编排层**：Playwright/Puppeteer（桌面端或 CI）负责打开/关闭浏览器、跑场景脚本
  - **采集层**：PerfSight（本地）或 Server（远端）接收指标
  - **产物层**：自动打标签（release/scenario/build）并上传 Server

---

### 2.0-E：Hybrid 模式（Browser API + System API 同时采集/对齐）
> **目标**：允许同一次 Performance Test **同时**采集两类数据源，并在同一份 Report 中展示与对比：  
> - **Browser API**：Chrome Task Manager 对齐（例如 Chrome GPU Process 的 CPU/Memory）  
> - **System API**：OS Task Manager / Activity Monitor 对齐（同 PID 的 CPU/Memory 等）  
>
> 典型场景：测试 **GPU Process** 时，希望同时观察“Chrome 视角”和“系统视角”的资源开销，以便做交叉验证与归因。

#### 需求拆解
- **并行采集**：同一时间窗口内，Browser API 与 System API 都在采集（避免互相覆盖/冲突）。
- **同 PID 对齐**：以 PID 为主键（或 `browser_pid ↔ os_pid` 映射）合并两路数据。
- **字段不冲突**：Report 中必须保留两路数据源的原始值，避免“二选一覆盖”。

#### 数据模型建议（2.0 方向）
- 在 `MetricPoint` 中明确区分来源（示例）：
  - `cpu_chrome_usage` / `memory_private`（Browser/Chrome 侧）
  - `cpu_os_usage` / `memory_rss`（System/OS 侧）
- 引入 `collection.mode` 扩展：
  - `mode: "hybrid"`（或者 `sources: ["browser","system"]`）

#### 融合/展示策略（建议）
- **Live**：默认展示 Browser（Chrome Task Manager）为主；提供 toggle 叠加/切换 OS 侧曲线。
- **Report**：每个 PID 同时提供两套统计（avg/min/max/p95 等）并可在 Compare 中对齐；明确标注来源（Chrome vs OS）。

#### 风险与注意事项
- 不同来源的采样周期/时间戳可能不一致，需要做时间对齐（bucket / nearest-sample）。
- 某些平台可能无法获得稳定 PID 映射（尤其是跨设备/远端采集），需降级到“仅 browser”或“仅 system”。

## ChromeOS：2.0 第一优先级方案（分两条路线）

### 路线 1（推荐先做）：ChromeOS “Browser-only” MVP（最快落地）
> **目标**：在 ChromeOS 上不依赖桌面端 PerfSight，直接用 **扩展 → Server** 方式产出可查看的报告。

#### 核心思路
- ChromeOS 端安装 `perf-sight-extension`
- 扩展通过 WebSocket/HTTP 将数据**直接发送到 PerfSightServer**
- Server 保存数据集并提供 Web UI 展示

#### 可交付能力（MVP）
- **CPU/Memory（Chrome Task Manager 对齐）**
  - 优先尝试沿用你们现有的 `chrome.processes`/相关 API（需要在 ChromeOS 上验证权限与可用性）
- **自定义业务指标**
  - 继续沿用“console/custom event → extension → server”的提取机制（你们已实现）
- **Report 维度**
  - release / scenario / build id / tags
- **无需安装 PerfSight 桌面端**

#### 关键验证点（必须尽快做 PoC）
- ChromeOS 是否允许扩展使用进程级指标 API（权限/渠道/管理策略差异）
- 扩展到 Server 的网络连通性（同网段/内网/HTTPS/WSS）

#### 风险与降级策略
- **若进程级 API 在 ChromeOS 受限**
  - 降级到“仅自定义指标 + 页面性能（Performance API）”上报（仍然能做业务性能回归）
  - 或引入“远程调试（CDP）+ 近似 CPU 时间”作为替代（但不一定与 Task Manager 完全一致）

---

## 2.0 多端采集策略（Extension vs 系统采集）

> 结论：**PerfSightServer 是 ChromeOS / Android / iOS 的中心**；但三者的“采集端形态”不同。  
> - **Android / iOS**：通常不走 Extension，走系统侧采集 + 自动化 + 上传 Server  
> - **ChromeOS**：在“非特权/正常设备”上，最现实的是走 Extension（Browser-only）上报 Server；Host 级系统采集作为可选增强

### Android（主路线：系统采集 + Server）
- **不依赖 Extension**：Android 没有桌面 Chrome 扩展式采集的现实路径（也不应强行复用）。
- **采集来源**（建议）：Perfetto / `dumpsys meminfo` / `top` / gfxinfo 等（结合业务自定义指标）。
- **交付形态**：设备侧采集（或 PC 端通过 ADB 拉取）→ 上传 PerfSightServer → Web 查看/对比/归档。

### iOS（主路线：系统采集 + Server）
- **不依赖 Extension**：iOS 上 Chrome 为 WebKit 壳，且无 Chrome Extension 生态。
- **采集来源**（建议）：MetricKit / Instruments（结合业务自定义指标、自动化脚本）。
- **交付形态**：XCUITest/Appium 跑场景 → 采集 → 上传 PerfSightServer → Web 查看/对比/归档。

### ChromeOS（主路线：Extension + Server；增强：Host Agent）
- **主路线（推荐）**：Extension（`chrome.processes` + console/custom event）→ PerfSightServer  
  - 目标是对齐 **Chrome Task Manager** 视角（更贴近你们实际需求）。
- **可选增强（受控设备）**：Host Agent / 特权通道采集 Host 级进程指标（接近 Crosh/Host top 视角）  
  - 前提：Dev Mode 或企业策略允许（可部署/可运维），不作为 MVP 的硬依赖。

---

### 路线 2（更强但更难）：ChromeOS Host 级指标（穿透容器/系统隔离）
> 对应你现有草案 `docs/chromeos-native-profiler-design.md` 的方向：尝试获取 Host 上 chrome/GPU/renderer 的真实资源开销，实现“像 Crosh 那样”的系统观测与自动化。

#### 难点（现实约束）
- Crostini 容器内无法直接看到 Host 进程与 /proc（你文档里已描述）
- Host 侧能力通常需要：
  - 受管设备（企业策略）
  - debug/开发者模式
  - 或特权通道（SSH/系统扩展/Telemetry）

#### 2.0 的建议定位
- 先把“路线 1”做成可用工具，立刻服务项目
- Host 级指标作为 **2.1/2.2** 的增强：以“可选的特权部署”方式提供（对受管设备/实验室设备启用）

---

## 2.0 里程碑（建议）

### Milestone 2.0.1（ChromeOS MVP）
- PerfSightServer：Upload + Report Web UI + 基础筛选（release/scenario/tags）
- ChromeOS：扩展直连 Server 上报（CPU/Mem + 自定义指标）
- 一键生成并分享报告链接

### Milestone 2.0.2（ChromeOS 自动化）
- 场景脚本化（runner）：一键跑场景并自动上传
- 基线对比（同场景 across releases）

### Milestone 2.0.3（多端扩展）
- Android：设备侧采集 + 上报
- iOS：WebKit 指标链路 + 上报（不追求 Chrome Task Manager 对齐）

### Milestone 2.0.4（AI 分析）
- 规则/阈值分析稳定后接 AI 解释层
- Server 端统一计算与归档

---

## ChromeOS 近期行动清单（建议你我下一步马上做）

### Step 1：ChromeOS 能力验证（1-2 天）
- 验证扩展 API 在 ChromeOS 的可用性（进程级指标/权限/渠道）
- 验证网络：扩展 → Server 的 WSS/HTTPS 可达

### Step 2：PerfSightServer MVP（最小闭环）
- Upload API（接收 dataset 或 WebSocket 流）
- Web UI（列表/详情/筛选/对比）

### Step 3：ChromeOS 扩展直连 Server
- 在扩展增加 Server endpoint 配置（URL、token）
- 采集 + 上报 + 在 Web UI 展示

#### 2.0.1 MVP（已开始落地的实现建议）
- **Server**：仓库新增 `perfsight-server/`（Express + ws），提供：
  - WebSocket：`/ws`（每个连接视为一个 run，断开时落盘）
  - API：`/api/runs`、`/api/runs/:id`
- **Extension**：新增 `options_page`，可配置 WebSocket URL（支持 `ws://` / `wss://`），用于 ChromeOS 直连 Server

---

## 附：名词约定（建议）
- **Release Folder**：用 tag `release:<version>` 表示（例如 `release:6.7.0`）
- **Scenario**：一次可复现的操作脚本/测试场景（登录/滚动/推理等）
- **Dataset**：可上传/可复现的报告包（metrics + meta + 定义）


