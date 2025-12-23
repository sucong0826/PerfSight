# PerfSight Client 开发进度（本次 Session）

> 记录范围：PerfSight 桌面端（Tauri + React）与本地 DB（SQLite/rusqlite）相关改动。  
> 更新时间：2025-12-23（按本次对话/编码 session 汇总）

---

### 目标回顾

- **拆分系统**：将 **Test Report** 与 **Test Comparison** 拆成两个独立系统（Comparison 是独立产物，可导入/导出/管理）。
- **工程化对比**：Comparison 详情页支持 baseline、进程选择（CPU/Mem 两套）、统计与 driver 分析。
- **规模化筛选**：支持通过 tags 快速选出一组（例如 16 个）reports 进行对比；支持在同一 comparison 内做 **Tag Group A/B/多组** 的动态对比。
- **开发体验**：修复 Windows 下 `tauri dev` 的端口/锁文件问题，降低启动“抽风”。

---

## ✅ 已完成（按模块）

### 1) Comparison 产物体系（DB + Tauri 命令）

- **新增 DB 表**
  - `comparisons`：比较产物（title/folder_path/report_ids/baseline/config/meta）
  - `comparison_folders`：Comparison 文件夹树
- **新增 DB 数据结构**
  - `ComparisonSummary` / `ComparisonDetail` / `ComparisonFolderStats`
- **新增/更新 DB 方法**
  - Comparison CRUD：create/list/detail/update/delete
  - Comparison folder tree：list/create/rename/delete + stats
  - `update_comparison_report_ids`：更新 comparison 的 `report_ids_json`
  - `update_comparison_meta_patch`：合并更新 comparison meta，并同步 folder_path
- **新增/更新 Tauri commands（部分）**
  - `create_comparison`, `get_comparisons`, `get_comparison_detail`
  - `update_comparison_config`（保存 baseline + pid selections）
  - `update_comparison_reports`（基于 tag 过滤等替换 report_ids）
  - `update_comparison_meta`（保存 tags/folder 等 meta）
  - `export_comparison_bundle_json`（导出 comparison bundle）
  - `import_comparison_bundle`：导入 bundle 后**落库创建 Comparison**并返回 `comparison_id`

涉及文件：
- `perf-sight/src-tauri/src/database.rs`
- `perf-sight/src-tauri/src/commands.rs`
- `perf-sight/src-tauri/src/lib.rs`

---

### 2) UI：新增 Comparisons 页面与路由

- 新增：
  - `perf-sight/src/pages/Comparisons.tsx`：Comparison 列表 + folder tree + import/export + move/delete
  - `perf-sight/src/pages/ComparisonDetail.tsx`：Comparison 详情页（持续迭代）
- `perf-sight/src/App.tsx`：
  - 左侧增加 **Comparisons** tab
  - 新路由：`/comparisons`、`/comparison/:id`

---

### 3) Reports → Create Comparison（替换旧 compare 入口）

- `Reports.tsx`：
  - 多选后从 **Compare** 改为 **Create Comparison**
  - 创建成功后跳转 `/comparison/:id`
  - Comparison bundle import 后跳转新的 comparison（优先用 `comparison_id`，保留 legacy fallback）

涉及文件：
- `perf-sight/src/pages/Reports.tsx`

---

### 4) ComparisonDetail：工程化增强（A1/A2/A3）

- **A1 Drivers 展开 & 跳转定位**
  - Drivers 支持 Top2/Top6 切换
  - 点击 driver → 跳转 `ReportDetail` 并 `focusPid` 定位到 PID 卡片
  - `ReportDetail` 增加 `id="pid-card-<pid>"` 并滚动高亮
- **A2 Delta 表增强**
  - 增加更多统计列（p50/p90/p95/p99/max/stddev、阈值比例等）
  - 支持 Copy CSV / Copy Markdown
  - baseline 行显示绝对值，target 行显示 delta
- **A3 可编辑 meta（title/tags/folder）**
  - 详情页可编辑并落库

涉及文件：
- `perf-sight/src/pages/ComparisonDetail.tsx`
- `perf-sight/src/pages/ReportDetail.tsx`
- `perf-sight/src-tauri/src/database.rs`（meta patch）
- `perf-sight/src-tauri/src/commands.rs`（update_comparison_meta 等）

---

### 5) 动态 Tag Group 对比（在同一 comparison 内分组）

- 支持：A/B 默认组，**Add Group** 增加更多组，Remove 额外组
- 每组：
  - tags 使用 **下拉多选**（选项来自“当前 comparison 的 reports tags 聚合”）
  - mode 支持 ALL/ANY
- 结果：
  - 多组结果表格
  - baseline group 选择（delta 相对 baseline 展示）
- **作用域**：严格限定在当前 comparison（bundle 的那 16 个 reports）内，不会混入全库其他 report

涉及文件：
- `perf-sight/src/pages/ComparisonDetail.tsx`

---

### 6) UI 大重构：左侧竖向参数面板 + 主面板只显示数据

- 将以下“参数/配置”移动到左侧 panel：
  - Report Set（按 tags）
  - Baseline report
  - Tag Groups（多组动态对比）
  - PID selection
  - Meta 编辑
  - CPU/Mem view、Advanced toggle、Export/Save/Autosave
- 主面板只展示：
  - Tag group results
  - Charts（CPU 或 Mem）
  - Advanced（Delta/DataQuality/Drivers）

涉及文件：
- `perf-sight/src/pages/ComparisonDetail.tsx`

---

## 🧰 开发体验/稳定性修复

### 1) Windows `tauri dev` 端口/锁文件问题

- 新增端口清理脚本：
  - `perf-sight/scripts/kill_ports.mjs`：释放 1420（避免 Vite port 占用）
- 新增进程清理脚本：
  - `perf-sight/scripts/kill_process.mjs`：按进程名清理 `perf-sight.exe`（带“启动时间保护”，避免误杀当前实例）
- `perf-sight/package.json`
  - `dev:tauri` 先 kill 1420 + 尝试清理残留 `perf-sight.exe`
  - **不再强杀 23333**（避免竞态）

### 2) ws_server 端口占用（23333）稳定性

- `ws_server.rs`
  - 23333 被占用时自动 fallback 到 23334/23335...
  - 日志打印实际监听端口

涉及文件：
- `perf-sight/scripts/kill_ports.mjs`
- `perf-sight/scripts/kill_process.mjs`
- `perf-sight/package.json`
- `perf-sight/src-tauri/src/ws_server.rs`

---

## 🐞 关键 bug 修复记录

- **Tauri invoke 参数结构错误**
  - 报错：`missing required key args`
  - 修复：前端 `invoke` 按命令签名统一传 `{ args: {...} }`
  - 涉及：`ComparisonDetail.tsx`、`Reports.tsx`
- **ComparisonDetail.tsx 源码残留 diff 符号**
  - 报错：`Unexpected token`（Vite/Babel）
  - 修复：清理误插入的 `+`

---

## 🔜 待办（建议下一步）

- **Tag Group 结果增强**
  - 展示每组命中的 report IDs（可复制）
  - 按 CPU/Mem 维度给出 Top3 “最差 report”（定位问题用）
- **WS 端口 fallback 与 extension 配置联动（dev）**
  - 当前 fallback 端口可能导致 extension ws URL 需要手动改
  - 可选：在 UI/Console 明确提示当前 ws 端口，或提供一键复制
- **Comparison 动态结果保存**
  - 将 Tag Group 对比结果/配置一键保存到 comparison meta（便于复现/分享）


