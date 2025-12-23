# PerfSight Server 开发进度

> 最后更新: 2024-12-22

## 📌 当前状态

**Phase S1 (Server MVP)** - 进行中

| 功能 | 状态 | 说明 |
|------|------|------|
| HTTP Ingest (`POST /api/v1/datasets`) | ✅ 完成 | 接收 Desktop 上传的 dataset JSON |
| 列表 API (`GET /api/v1/runs`) | ✅ 完成 | 支持 release/scenario/platform/buildId 过滤 |
| 详情 API (`GET /api/v1/runs/:id`) | ✅ 完成 | 返回完整 metrics + meta |
| 删除 API (`DELETE /api/v1/runs/:id`) | ✅ 完成 | |
| 过滤选项 API (`GET /api/v1/filters`) | ✅ 完成 | 返回可用的 releases/scenarios/platforms |
| Tags API (`GET /api/v1/tags`) | ✅ 完成 | 统计所有 tags |
| Compare API (`POST /api/v1/compare`) | ✅ 完成 | 对比多个 runs |
| Web UI - 列表页 | ✅ 完成 | 过滤、删除、导入、多选 |
| Web UI - 详情页 | ✅ 完成 | 与 Desktop 对齐 |
| Web UI - Import Dataset | ✅ 完成 | 从 JSON 文件导入 |
| Web UI - Compare 页面 | ✅ 完成 | 多报告对比、进程选择、图表 |
| Comparison Bundle 导出 | ✅ 完成 | Client 导出 bundle JSON |
| Comparison Bundle 导入 | ✅ 完成 | Client/Server 导入 bundle，自动跳转 Compare |
| Desktop - Upload to Server | ✅ 完成 | ReportDetail 页面增加上传按钮 |
| WebSocket Ingest (ChromeOS) | ⏳ 待开发 | Phase S1 优先 |
| Token 鉴权 | ⏳ 待开发 | |

---

## 🏗️ 技术架构

```
perfsight-server/
├── src/
│   ├── index.ts          # Express 入口 (port 3001)
│   ├── db.ts             # Prisma 连接
│   └── routes/
│       └── api.ts        # REST API 路由
├── public/
│   └── index.html        # Web UI (React + Chart.js via CDN)
├── prisma/
│   ├── schema.prisma     # 数据库 Schema
│   └── perfsight.db      # SQLite 数据库
└── package.json
```

### 技术栈
- **Server**: Node.js + Express + TypeScript
- **Database**: SQLite (via Prisma) - MVP 阶段
- **Web UI**: React 18 + Chart.js (CDN inline)
- **Frontend Build**: 无构建，直接 Babel in-browser 转译

### 数据模型

```prisma
model Run {
  id              String    @id @default(uuid())
  originalId      Int?      // 原始 report ID
  title           String
  reportDate      DateTime
  
  // 索引字段（从 meta 提取）
  release         String?
  scenario        String?
  buildId         String?
  platform        String?
  browser         String?
  mode            String?
  tags            String    @default("[]")  // JSON array
  durationSeconds Int?
  
  // 完整 dataset
  datasetJson     String    // ReportDatasetV1 JSON
  
  // 预计算统计
  avgCpu          Float?
  avgMemMb        Float?
  p95Cpu          Float?
  p95MemMb        Float?
}
```

---

## 📡 API 接口

### 上传 Dataset
```bash
POST /api/v1/datasets
Content-Type: application/json

{
  "schema_version": 1,
  "exported_at": "2024-12-22T...",
  "report": {
    "id": 1,
    "created_at": "...",
    "title": "...",
    "metrics": [...],
    "analysis": {...},
    "meta": {...}
  }
}
```

### 列表
```bash
GET /api/v1/runs?release=6.7.0&scenario=startup&platform=macos&limit=50&offset=0
```

### 详情
```bash
GET /api/v1/runs/:id
```

### 对比
```bash
POST /api/v1/compare
Content-Type: application/json
{ "ids": ["uuid1", "uuid2"] }
```

---

## 🖥️ Web UI 功能

### 列表页
- [x] 报告列表（卡片式）
- [x] 过滤：release / scenario / platform / buildId
- [x] 删除报告
- [x] **Import Dataset** 按钮（从 JSON 文件导入）
- [x] **多选** 支持（checkbox）
- [x] **Compare** 按钮（选中 2+ 报告后出现）

### Compare 页面（与 Desktop ReportCompare 对齐）
- [x] Baseline 选择器
- [x] CPU / Memory Tab 切换
- [x] 每报告独立的进程选择（All/None 快捷按钮）
- [x] 汇总统计（Avg/P95/Max + Delta 对比）
- [x] 对齐的 CPU/Memory 图表（Chart.js）
- [x] 每报告详情卡片

### 详情页（与 Desktop 对齐）
- [x] Metadata 完整展示
  - Collection (mode/interval/duration/started/ended)
  - Environment (os/device/arch/cpu/cores/RAM)
  - Targets (PIDs/process snapshot count)
  - Test Context (scenario/build_id/tags/notes)
- [x] Performance Score（带颜色）
- [x] Per-Process Metrics
  - CPU: avg/p50/p90/p95/p99/max/stddev/>30%/>60%
  - Memory: avg/p50/p90/p95/p99/max/stddev/>512MB/growth
- [x] Overall 汇总
- [x] Insights
- [x] CPU/Memory 图表（Chart.js）
- [x] Process Snapshot Table

---

## 🔧 Desktop Client 改动

### ReportDetail.tsx
- [x] 新增 "Upload to Server" 按钮（绿色）
- [x] Server URL 配置弹窗（保存到 localStorage）
- [x] 上传逻辑：构建 dataset JSON → POST /api/v1/datasets

---

## 🚀 启动方式

### Server
```bash
cd perfsight-server
npm install
npx prisma generate
npx prisma migrate dev --name init  # 首次
npm run dev                          # http://localhost:3001
```

### Desktop Client
```bash
cd perf-sight
npm run tauri dev
```

---

## 📋 下一步计划

### Phase S1 剩余
- [ ] WebSocket Ingest (`/ws`) - ChromeOS Extension 实时上报
- [ ] Token 鉴权（静态 token）

### Phase S2
- [x] ~~Web UI - Compare 页面~~ ✅ 已完成
- [ ] 趋势看板（同场景 across releases）
- [ ] Project 隔离

### Phase S3
- [ ] CLI 自动上传
- [ ] Android/iOS 接入

### Phase S4
- [ ] AI 分析

---

## 📦 Comparison Bundle 功能

### 用途
当用户在 Client 中对比多个 Test Report 后，可以将整个对比（包括进程选择、baseline 等配置）导出为一个 Bundle JSON 文件。导入时自动恢复对比视图，无需手动重新选择报告和进程。

### Bundle 格式 (schema_version: 1)
```json
{
  "schema_version": 1,
  "bundle_type": "comparison",
  "exported_at": "2025-12-23T...",
  "comparison_context": {
    "baseline_original_id": 123,
    "cpu_selections_by_id": { "123": [1234, 5678], "456": [9012] },
    "mem_selections_by_id": { "123": [1234, 5678], "456": [9012] }
  },
  "reports": [
    { "id": 123, "created_at": "...", "title": "Report A", "metrics": [...], "meta": {...} },
    { "id": 456, "created_at": "...", "title": "Report B", "metrics": [...], "meta": {...} }
  ]
}
```

### Client 使用
1. 在 Compare 页面点击 **Export Bundle** 按钮
2. 得到 `comparison_bundle_N_reports_YYYY-MM-DD.json` 文件
3. 分享给其他人或导入到 Server

### Client 导入
1. 在 Reports 页面点击 **Import Dataset**
2. 选择 bundle JSON 文件
3. 自动导入所有报告并跳转到 Compare 页面

### Server API
```bash
POST /api/v1/bundles
Content-Type: application/json
# Body: bundle JSON

# Response:
{
  "success": true,
  "imported": [{ "id": "...", "originalId": 123, "title": "Report A" }, ...],
  "comparison": {
    "runIds": ["...", "..."],
    "baselineId": "...",
    "cpuSelections": { "...": [1234, 5678] },
    "memSelections": { "...": [1234, 5678] }
  }
}
```

### Server Web UI 导入
1. 在列表页点击 **Import Dataset**
2. 选择 bundle JSON 文件
3. 自动导入所有报告并跳转到 Compare 页面（携带进程选择配置）

---

## 🐛 已知问题

1. Web UI 使用 CDN inline React，首次加载较慢
2. 暂无鉴权，任何人都可以上传/删除
3. SQLite 不适合高并发，V1 需迁移 Postgres

---

## 📁 相关文件

- 设计文档: `docs/perfsight-server-design.md`
- 开发计划: `docs/perfsight-server-dev-plan.md`
- Server README: `perfsight-server/README.md`

