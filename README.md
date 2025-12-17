# PerfSight

PerfSight is a **Tauri v2** desktop app for collecting and analyzing performance test data (CPU / Memory / JS Heap, etc.). It supports Test Reports, report comparison, PDF export, and dataset export/import for sharing and reproducibility.

## Quick Start (Dev)

### Prerequisites

- **Node.js**: 20+
- **Rust**: stable (via `rustup`)
- **Python**: 3.10+ (used to build the Tauri sidecar: `collector`)

### Run (dev)

```bash
cd perf-sight
npm install
npm run tauri dev
```

For a full guide (Windows/macOS/Linux setup, System vs Browser mode, Chrome Stable vs Canary, troubleshooting), see:

- `docs/guide.md`


