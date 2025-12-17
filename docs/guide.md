# PerfSight Guide (Development & Usage)

This guide covers:

- Development environment setup (macOS / Windows / Linux)
- Two collection modes: **System API** vs **Browser API**
- How to run Browser API with **Chrome Stable** (and why Canary/Dev is sometimes required)
- Troubleshooting (Sidecar, CDP 9222, Extension `chrome.processes`)
- Report Dataset export/import and PDF export

---

## 1. Repo layout (minimum you need to know)

- **Frontend**: `perf-sight/` (Vite + React)
- **Backend**: `perf-sight/src-tauri/` (Rust / Tauri v2)
- **Sidecar**: `perf-sight/src-tauri/python/collector.py` (packaged via PyInstaller into `src-tauri/binaries/collector-<target-triple>`)
- **Chrome Extension**: `perf-sight-extension/` (pushes Chrome Task Manager-like process metrics to a local WebSocket)

---

## 2. Development setup (All Platforms)

### 2.1 Prerequisites

- **Node.js**: 20+
- **Rust**: stable (recommended via `rustup`)
- **Python**: 3.10+ (needed to build the sidecar)

### 2.2 Install dependencies

```bash
cd perf-sight
npm install
```

### 2.3 Start dev (Tauri Dev)

```bash
cd perf-sight
npm run tauri dev
```

#### What happens with the sidecar?

`perf-sight/src-tauri/tauri.conf.json` is configured so that:

- `beforeDevCommand`: `npm run dev:tauri`
- `dev:tauri` runs `npm run sidecar:ensure` first (builds `src-tauri/binaries/collector-<target-triple>` if missing), then starts `vite`

If you see an error like:

`resource path binaries/collector-<target-triple> doesn't exist`

Run this once:

```bash
cd perf-sight
npm run sidecar:ensure
```

---

## 3. Usage: System API mode (recommended default)

**Use this when** you want OS-level per-process CPU/RSS (closer to Activity Monitor / Task Manager process numbers).

### 3.1 How to

- In Dashboard, select one or more process PIDs
- Set mode to **System**
- Click Start
- Optional: set a timer (minutes) to auto-stop and generate a report
- After Stop, a report is created and can be viewed/compared/exported in Reports

### 3.2 Metrics (quick glossary)

- **CPU (OS)**: OS-level per-process CPU usage (via `sysinfo`)
- **Memory (RSS)**: OS resident memory (closest to “real memory size” style definitions)

---

## 4. Usage: Browser API mode (Chrome-focused)

Browser API mode aims to be closer to **Chrome Task Manager (Shift+Esc)**:

- Get each Chrome process **OS PID**
- Get Task Manager-like **CPU / Private Memory**
- Associate processes with tabs / types (Renderer/GPU/Utility) when possible

Browser API mode relies on two paths:

1. **CDP (Chrome DevTools Protocol)**: PerfSight calls `http://localhost:9222` to fetch targets and uses some CDP APIs (e.g., JS Heap / process info)
2. **Chrome Extension**: uses `chrome.processes` to read Task Manager-level metrics and pushes them to PerfSight via a local WebSocket (default `ws://127.0.0.1:23333`)

---

## 5. Chrome Canary/Dev vs Stable: using Browser API on Stable

### 5.1 Why Canary/Dev is often recommended

PerfSight’s extension uses `chrome.processes` (including `onUpdatedWithMemory`). This API is often **experimental / restricted**:

- It’s more likely to work on **Canary/Dev**
- On **Stable**, it may require extra flags, or be unavailable (depends on Chrome version/policies)

### 5.2 Recommended way to launch Chrome Stable

#### Required: enable the CDP port

PerfSight connects to `http://localhost:9222` by default, so Chrome must be launched with:

- `--remote-debugging-port=9222`

#### May be required: enable experimental extension APIs

If `chrome.processes` is not available on Stable, try adding:

- `--enable-experimental-extension-apis`

#### macOS (recommended: use a separate profile)

```bash
open -na "Google Chrome" --args \
  --remote-debugging-port=9222 \
  --enable-experimental-extension-apis \
  --user-data-dir="/tmp/perfsight-chrome"
```

#### Windows

```bat
chrome.exe --remote-debugging-port=9222 --enable-experimental-extension-apis
```

#### Linux

```bash
google-chrome --remote-debugging-port=9222 --enable-experimental-extension-apis
```

### 5.3 Install the extension (Developer mode)

- Open `chrome://extensions`
- Enable **Developer mode**
- Click **Load unpacked**
- Select the repo folder: `perf-sight-extension/`

### 5.4 How to verify the extension is working

1. Open the extension’s Service Worker console
2. Check logs for continuous output like “Sending N process metrics to PerfSight...”
3. If you see messages indicating `chrome.processes` is not supported / flags are required, your Stable build likely doesn’t expose the API (or the flags didn’t take effect)

> Note: if Stable cannot enable `chrome.processes`, we can implement a **CDP-only** Browser mode (no extension). This improves deployability, but reduces Task Manager-level parity.

---

## 6. Dataset (report data) and PDF

### 6.1 Dataset Export/Import

- Export Dataset: export **raw metrics + meta_json** for sharing and reproducibility
- Import Dataset: import on another machine to restore the report inside PerfSight

### 6.2 PDF Export

- PDFs are “text-first report + charts as appendix”
- If native saving is unavailable, the app falls back to frontend saving

---

## 7. Troubleshooting

### 7.1 Missing sidecar (`collector`)

Symptom:

- `resource path binaries/collector-<target-triple> doesn't exist`

Fix:

```bash
cd perf-sight
npm run sidecar:ensure
```

### 7.2 CDP not reachable (9222)

Symptom:

- PerfSight 提示 connection failed / `http://localhost:9222` 不通

Fix:

- Ensure Chrome is started with `--remote-debugging-port=9222`
- Visit `http://localhost:9222/json/version` and confirm `webSocketDebuggerUrl` exists

### 7.3 Extension has data but PerfSight shows nothing

Check:

- The extension’s `host_permissions` must allow `ws://127.0.0.1:23333/*`
- Ensure PerfSight’s backend WebSocket server is running (it starts with the app)
- Ensure the current PerfSight mode matches the data source (avoid mixing System/Browser streams)

---

## 8. CI / Release (GitHub Actions)

The release workflow is not triggered on every push. It typically runs via:

- tag push: `v*` (e.g., `v0.1.2`)
- or manual workflow dispatch

```bash
git tag v0.1.2
git push origin v0.1.2
```


