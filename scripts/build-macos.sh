#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
APP_DIR="${REPO_ROOT}/perf-sight"
ARTIFACTS_DIR="${REPO_ROOT}/artifacts"

fail() {
  printf 'Build error: %s\n' "$1" >&2
  exit 1
}

[[ "$(uname -s)" == "Darwin" ]] || fail "Run this script on macOS."
[[ "$(uname -m)" == "arm64" ]] || fail "This build produces the Apple Silicon client and requires an arm64 Mac runner."

for command_name in node npm cargo rustc python3; do
  command -v "$command_name" >/dev/null 2>&1 || fail "Required command '$command_name' was not found on PATH."
done

node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
[[ "$node_major" -ge 20 ]] || fail "Node.js 20 or newer is required."

python_version="$(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
python_major="${python_version%%.*}"
python_minor="${python_version#*.}"
[[ "$python_major" -gt 3 || ( "$python_major" -eq 3 && "$python_minor" -ge 9 ) ]] \
  || fail "Python 3.9 or newer is required to build the collector sidecar."

mkdir -p "$ARTIFACTS_DIR"
rm -f "${ARTIFACTS_DIR}/PerfSight-macos-arm64.zip"

cd "$APP_DIR"
npm ci
npm run tauri -- build --bundles app

bundle_dir="${APP_DIR}/src-tauri/target/release/bundle/macos"
[[ -d "$bundle_dir" ]] || fail "Tauri did not create the macOS app bundle directory."

app_bundle=""
app_count=0
while IFS= read -r -d '' candidate; do
  app_bundle="$candidate"
  app_count=$((app_count + 1))
done < <(find "$bundle_dir" -maxdepth 1 -type d -name '*.app' -print0)

[[ "$app_count" -eq 1 ]] || fail "Expected one .app bundle in $bundle_dir; found $app_count."

ditto -c -k --sequesterRsrc --keepParent \
  "$app_bundle" \
  "${ARTIFACTS_DIR}/PerfSight-macos-arm64.zip"

[[ -s "${ARTIFACTS_DIR}/PerfSight-macos-arm64.zip" ]] || fail "The macOS ZIP was not created."
printf 'Created %s\n' "${ARTIFACTS_DIR}/PerfSight-macos-arm64.zip"
