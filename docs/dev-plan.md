PerfSight 开发计划与路线图 (Development Roadmap)

Phase 1: 核心采集与 MVP (当前阶段)

目标: 在本地跑通流程，能够查看实时曲线，支持基础的系统级和浏览器级监控。

[x] P0: 项目脚手架搭建

Tauri v2 + React + Vite 环境配置。

解决依赖版本冲突 (npm vs cargo)。

[x] P0: System Level 采集

集成 sysinfo。

获取进程列表、CPU、Memory RSS。

[x] P0: 基础 UI 开发

进程选择器。

实时折线图 (Recharts)。

[ ] P1: Browser Level 初步集成 (Chromium) (进行中)

集成 reqwest 连接 CDP HTTP 接口 (Chrome/Edge)。

获取 Tab 列表并与 OS 进程匹配。

获取 JS Heap Size。

[ ] P1: 数据导出

支持将测试结果导出为 JSON/CSV 文件。

Phase 2: 深度采集与精准度 (下个阶段)

目标: 提高数据精确度，支持 GPU 监控，解决“混合模式”下的数据对齐问题。

P0: GPU 监控 (Native)

Windows: 引入 windows-rs crate，使用 PDH (Performance Data Helper) 读取 GPU 引擎使用率。

macOS: 研究 IOKit 绑定，读取 GPU 负载。

P1: 精准 CDP 匹配 (WebSocket)

从 HTTP 轮询升级为 WebSocket 长连接，大幅降低采集延迟。

使用 SystemInfo.getProcessInfo CDP 命令准确映射 Tab ID 到 PID。

P2: 多进程聚合与并发监控 (新增)

场景: Web App 通常由多个进程组成 (Main + GPU + Renderer + Utility)。

功能: 
1. 支持同时选择多个进程进行监听（例如：勾选 Renderer 和 GPU 进程）。
2. 支持“聚合视图”：计算选定进程组的总 CPU/内存消耗。
3. 支持“对比视图”：在同一图表中绘制多条曲线，对比不同进程的开销。

Phase 3: 多浏览器支持与标准化 (新增)

目标: 突破 Chromium 限制，支持 Firefox 和 Safari 的元数据关联（通过 BiDi 获取 URL/Title 来匹配 OS 进程）。

P1: Firefox 支持 (WebDriver BiDi)

技术路径: 使用 WebDriver BiDi 替代 CDP 获取 Firefox 的 Tab 列表和 URL。

资源监控: 仍使用 sysinfo 监控 firefox.exe 进程，BiDi 仅用于识别 Tab 身份。

Web Vitals: 通过 BiDi 的 script.evaluate 获取 window.performance 数据。

P2: Safari 支持 (WebKit Adapter/BiDi)

现状: 等待 Safari 对 BiDi 的支持成熟，或使用 safaridriver 的 REST API 获取基础信息。

策略: 针对 macOS 优化 Safari 进程树的识别逻辑（Safari 的进程模型与 Chrome 不同，Render Process 通常名为 com.apple.WebKit.WebContent）。

Phase 4: Server 端与自动化

目标: 实现远程控制和历史数据存储。

P0: Server 基础架构

搭建 Python FastAPI 服务。

配置 PostgreSQL + TimescaleDB。

P1: 客户端-服务端通信

实现 WebSocket 心跳与指令下发。

实现测试报告自动上传。

P2: 自动化测试集成

支持命令行启动 (CLI Mode)，便于集成到 CI/CD 流水线 (Jenkins/GitHub Actions)。

Phase 5: AI 分析与多平台 (原 Phase 4)

目标: 智能化分析，支持更多操作系统。

P1: 智能分析报告与量化评分 (新增)

1. 自动生成测试报告，包含核心指标统计值（平均值、峰值、P95/P99 分位值）。
2. 提供“性能评分”模型：基于行业标准（如 RAIL 模型）或历史基线，对 CPU/内存/FPS 进行打分 (0-100)。
3. 利用 AI 对比历史版本，自动标记性能退化 (Regression)。

P2: 移动端支持

探索 Android (ADB) 和 iOS (usbmuxd) 的采集方案。
