#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
ARTIFACTS_DIR="${REPO_ROOT}/artifacts"
REMOTE_DIR="/opt/device-management/server/uploads/perfsight"
LOCAL_UPLOAD_DIR="${DEVICE_MANAGEMENT_UPLOAD_DIR:-${REMOTE_DIR}}"

fail() {
  printf 'Sync error: %s\n' "$1" >&2
  exit 1
}

macos_package="${ARTIFACTS_DIR}/PerfSight-macos-arm64.zip"
windows_package="${ARTIFACTS_DIR}/PerfSight-windows-x64.msi"
[[ -s "$macos_package" ]] || fail "Missing build artifact: $macos_package"
[[ -s "$windows_package" ]] || fail "Missing build artifact: $windows_package"

if command -v sha256sum >/dev/null 2>&1; then
  (
    cd "$ARTIFACTS_DIR"
    sha256sum PerfSight-macos-arm64.zip PerfSight-windows-x64.msi > SHA256SUMS
  )
elif command -v shasum >/dev/null 2>&1; then
  (
    cd "$ARTIFACTS_DIR"
    shasum -a 256 PerfSight-macos-arm64.zip PerfSight-windows-x64.msi > SHA256SUMS
  )
else
  fail "Install sha256sum or shasum to create the package checksum file."
fi

if [[ -n "${DEVICE_MANAGEMENT_SSH_TARGET:-}" ]]; then
  [[ "$DEVICE_MANAGEMENT_SSH_TARGET" =~ ^[A-Za-z0-9_][A-Za-z0-9._-]*@[A-Za-z0-9][A-Za-z0-9.-]*$ ]] \
    || fail "DEVICE_MANAGEMENT_SSH_TARGET must use the form deploy-user@host."

  remote_host="${DEVICE_MANAGEMENT_SSH_TARGET#*@}"
  ssh-keygen -F "$remote_host" >/dev/null \
    || fail "The target host is not present in the current user's known_hosts file."

  ssh_options=(
    -o BatchMode=yes
    -o StrictHostKeyChecking=yes
  )
  ssh "${ssh_options[@]}" "$DEVICE_MANAGEMENT_SSH_TARGET" \
    "test -d '${REMOTE_DIR}'" \
    || fail "Create ${REMOTE_DIR} on the device-management host and grant the SSH user write access first."
  scp "${ssh_options[@]}" -- \
    "$macos_package" \
    "$windows_package" \
    "${ARTIFACTS_DIR}/SHA256SUMS" \
    "${DEVICE_MANAGEMENT_SSH_TARGET}:${REMOTE_DIR}/"
  ssh "${ssh_options[@]}" "$DEVICE_MANAGEMENT_SSH_TARGET" \
    "chmod 0644 '${REMOTE_DIR}/PerfSight-macos-arm64.zip' '${REMOTE_DIR}/PerfSight-windows-x64.msi' '${REMOTE_DIR}/SHA256SUMS'"
  printf 'Synced client installers to %s:%s\n' "$DEVICE_MANAGEMENT_SSH_TARGET" "$REMOTE_DIR"
  exit 0
fi

[[ "$LOCAL_UPLOAD_DIR" == /* ]] || fail "DEVICE_MANAGEMENT_UPLOAD_DIR must be an absolute path."
[[ "$LOCAL_UPLOAD_DIR" != *"/../"* && "$LOCAL_UPLOAD_DIR" != */.. ]] \
  || fail "DEVICE_MANAGEMENT_UPLOAD_DIR must not contain parent-directory traversal."
[[ -d "$LOCAL_UPLOAD_DIR" ]] \
  || fail "Destination directory does not exist: $LOCAL_UPLOAD_DIR. Create it with the device-management deployment permissions first."

install -m 0644 "$macos_package" "$windows_package" "${ARTIFACTS_DIR}/SHA256SUMS" "$LOCAL_UPLOAD_DIR/"
printf 'Synced client installers to %s\n' "$LOCAL_UPLOAD_DIR"
