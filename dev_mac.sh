#!/usr/bin/env bash
set -euo pipefail

# 1) Build Python Sidecar (collector)
echo "Building Python Sidecar (collector)..." 

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY_DIR="$ROOT_DIR/perf-sight/src-tauri/python"
BIN_DIR="$ROOT_DIR/perf-sight/src-tauri/binaries"

cd "$PY_DIR"

python3 -m pip install pyinstaller

if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR: python3 not found. Please install Python 3 first."
  exit 1
fi

# Build with PyInstaller (requires: pip install pyinstaller)
python3 -m PyInstaller --onefile --name collector collector.py

mkdir -p "$BIN_DIR"

ARCH="$(uname -m)"
case "$ARCH" in
  arm64)
    TARGET_NAME="collector-aarch64-apple-darwin"
    ;;
  x86_64)
    TARGET_NAME="collector-x86_64-apple-darwin"
    ;;
  *)
    echo "ERROR: Unsupported macOS arch: $ARCH"
    exit 1
    ;;
esac

# Move output to Tauri expected binaries directory.
# PyInstaller output path: dist/collector
if [[ ! -f "dist/collector" ]]; then
  echo "ERROR: PyInstaller output not found at dist/collector"
  exit 1
fi

mv -f "dist/collector" "$BIN_DIR/$TARGET_NAME"
chmod +x "$BIN_DIR/$TARGET_NAME"

echo "Sidecar built: $BIN_DIR/$TARGET_NAME"

# 2) Start Tauri dev
echo "Starting PerfSight Dev..."
cd "$ROOT_DIR/perf-sight"
npm run tauri dev

