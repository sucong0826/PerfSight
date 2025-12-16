## Dev build (macOS / Windows / Linux)

PerfSight is a **Tauri v2** app:

- **Frontend**: Vite + React (`perf-sight/`)
- **Backend**: Rust/Tauri (`perf-sight/src-tauri/`)
- **Sidecar**: Python collector bundled as a Tauri sidecar (`perf-sight/src-tauri/python/collector.py`)

### Prerequisites (all platforms)

- **Node.js**: 20+
- **Rust toolchain**: stable (via `rustup`)
- **Python**: 3.10+ (needed to build the sidecar)

### 1) Install frontend deps

```bash
cd perf-sight
npm install
```

### 2) Run dev (this auto-builds the sidecar if missing)

```bash
cd perf-sight
npm run tauri dev
```

#### What happens under the hood

`src-tauri/tauri.conf.json` is configured so that:

- `beforeDevCommand` runs `npm run dev:tauri`
- `dev:tauri` runs:
  - `npm run sidecar:ensure` (builds `src-tauri/binaries/collector-<target-triple>` if missing)
  - `vite`

If you ever want to build the sidecar manually:

```bash
cd perf-sight
npm run sidecar:ensure
```

### Common dev failure: missing sidecar binary

If you see:

`resource path binaries/collector-<target-triple> doesn't exist`

Run:

```bash
cd perf-sight
npm run sidecar:ensure
```

This builds the correct file under:

- `perf-sight/src-tauri/binaries/collector-aarch64-apple-darwin` (Apple Silicon)
- `perf-sight/src-tauri/binaries/collector-x86_64-apple-darwin` (Intel mac)
- `perf-sight/src-tauri/binaries/collector-x86_64-unknown-linux-gnu` (Linux)
- `perf-sight/src-tauri/binaries/collector-x86_64-pc-windows-msvc.exe` (Windows)

## Production build (local)

### Build release binaries

```bash
cd perf-sight
npm run tauri build
```

This uses `beforeBuildCommand = npm run build:tauri`, which ensures the sidecar exists and then runs `tsc && vite build`.

## CI build (GitHub Actions)

This repo’s release workflow is **not triggered by branch pushes**.

It runs on:

- **tag push**: `v*` (e.g. `v0.1.2`)
- **manual**: Actions → Release → “Run workflow”

### Trigger a release build via tag

```bash
git tag v0.1.2
git push origin v0.1.2
```

### Notes

- **Windows MSI requires a `.ico`**: ensure `src-tauri/tauri.conf.json` includes `icons/icon.ico`.
- **Linux (WebKitGTK)**: GitHub Actions uses Ubuntu 24.04 and installs `libwebkit2gtk-4.1-dev` + `libjavascriptcoregtk-4.1-dev`.


