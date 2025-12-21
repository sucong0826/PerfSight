## PerfSightServer 开发计划（2.0 阶段）

> **目标**：以最小闭环优先，先让 ChromeOS 能产出“可查看、可分享”的报告；再把 Desktop/移动端接入；最后上 AI。  
> **原则**：先 Dataset 统一、先索引/过滤、再优化存储与分析。

---

## Phase S0（0~2 天）：能力验证与技术选型定稿

### 产出
- 确认 Server 端技术栈（MVP 建议 Node/Express + ws；V1 可升级为 TypeScript/更完整框架）
- 定义 Dataset Schema 版本与兼容策略
- 定义 WebSocket 消息协议（hello/data/log/stop）

### 验收
- ChromeOS Extension 可通过 WSS 连接到内网/公网 Server（握手成功）

---

## Phase S1（1~2 周）：Server MVP（ChromeOS 优先）

### S1.1 Ingest（WS + HTTP）
- [ ] WSS `/ws`：每连接一个 run（支持 query meta：scenario/release/build/tags）
- [ ] HTTP `POST /api/v1/datasets`：接收 Desktop 上传 dataset
- [ ] Token 鉴权（静态 token 即可）
- [ ] Run finalize：stop/断开连接后落盘保存

### S1.2 Storage（MVP）
- [ ] 文件存储（data/runs/*.json）或 Postgres（建议直接 Postgres）
- [ ] runs 索引字段：created_at、release、scenario、tags、build_id、platform

### S1.3 Web UI（最小可用）
- [ ] runs 列表
- [ ] runs 详情（先 JSON 下载 + 简易图表；或复用现有前端图表组件）
- [ ] 过滤：release/scenario/tags/build_id/时间范围
- [ ] 分享：可复制链接（公开/带 token 视策略）

### 验收标准
- ChromeOS：装扩展 → 配置 Server → 跑 1 次场景 → Server 上能看到 run 列表与详情
- Desktop：导出 dataset → 上传 → Server 上可查看

---

## Phase S2（2~4 周）：V1（团队可用 + 对比/趋势）

### S2.1 数据索引与对比
- [ ] Compare API：`/api/v1/compare?ids=a,b`
- [ ] 同场景基线选择（baseline run）
- [ ] 趋势：同 scenario + release 维度趋势图（至少 CPU/Mem/自定义指标）

### S2.2 权限与项目隔离
- [ ] project 概念（每个 run 归属一个 project）
- [ ] Token 按 project 隔离
- [ ] （可选）OAuth 登录

### S2.3 运维与观测
- [ ] 运行指标：连接数、落盘耗时、payload 大小
- [ ] 结构化日志：run_id、client_platform、release、scenario

### 验收标准
- 团队成员无需安装 PerfSight Desktop，只通过 Web 即可查看/对比报告
- 同场景 across releases 可快速定位回归

---

## Phase S3（4~8 周）：自动化与多端接入

### S3.1 自动化 Runner
- [ ] CLI：上传 dataset + 打标签（release/scenario/build）
- [ ] Playwright 场景脚本跑完自动上传

### S3.2 Android/iOS 接入
- [ ] Android：接入系统采集结果（Perfetto/dumpsys）→ 转换为 Dataset → 上传
- [ ] iOS：MetricKit/Instruments → 转换为 Dataset → 上传

### 验收标准
- 至少一个 Android 或 iOS 场景能被全自动跑通并在 Server 侧可视化

---

## Phase S4（后置）：AI 分析

### 路线
- 先规则/阈值（deterministic）判定是否回归
- 再 AI：解释与建议、归因分析、生成摘要

### 验收
- 对同场景两份报告给出稳定的回归结论与可执行建议（可追溯）

---

## 风险与对策（简版）
- **ChromeOS API 权限差异**：先 PoC 验证 `chrome.processes` 可用性；不可用则降级到自定义指标/Performance API。
- **数据量膨胀**：MVP 保留原始 dataset，同时做 summary 预计算；必要时引入对象存储。
- **时间对齐/多源融合（hybrid）**：先统一 timestamp bucket，再做 nearest-sample。


