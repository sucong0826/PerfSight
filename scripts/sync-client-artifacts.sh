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

macos_name="PerfSight-macos-arm64.zip"
windows_name="PerfSight-windows-x64.msi"
macos_package="${ARTIFACTS_DIR}/${macos_name}"
windows_package="${ARTIFACTS_DIR}/${windows_name}"
macos_bundle="${ARTIFACTS_DIR}/client-macos-arm64.zip"
windows_bundle="${ARTIFACTS_DIR}/client-windows-x64.zip"

stage_dir=""
cleanup() {
  [[ -z "$stage_dir" ]] || rm -rf "$stage_dir"
}
trap cleanup EXIT

extract_bundle_file() {
  local archive="$1"
  local expected_name="$2"
  local destination="$3"
  local entries entry matched_entry match_count

  entries="$(unzip -Z1 "$archive")" || fail "Could not read GitHub artifact ZIP: $archive"
  matched_entry=""
  match_count=0
  while IFS= read -r entry; do
    [[ -n "$entry" && "$entry" != */ ]] || continue
    [[ "$entry" =~ ^[A-Za-z0-9._/-]+$ ]] || fail "Unexpected path in artifact ZIP: $archive"
    case "/${entry}/" in
      *"/../"*|*"/./"*) fail "Unsafe path in artifact ZIP: $archive" ;;
    esac
    if [[ "${entry##*/}" == "$expected_name" ]]; then
      matched_entry="$entry"
      match_count=$((match_count + 1))
    fi
  done <<< "$entries"

  [[ "$match_count" -eq 1 ]] || fail "Expected exactly one ${expected_name} inside $archive; found ${match_count}."
  unzip -p "$archive" "$matched_entry" > "$destination" || fail "Could not extract ${expected_name} from $archive"
  [[ -s "$destination" ]] || fail "Extracted package is empty: ${expected_name}"
}

stage_dir="$(mktemp -d "${TMPDIR:-/tmp}/perfsight-client-artifacts.XXXXXX")" \
  || fail "Could not create a temporary directory for the client packages."

# GitHub Actions downloads are wrapper ZIPs named client-*.zip. Prefer those
# when present so a stale direct installer cannot silently be uploaded instead.
if [[ -e "$macos_bundle" || -e "$windows_bundle" ]]; then
  [[ -s "$macos_bundle" ]] || fail "Missing GitHub artifact bundle: $macos_bundle"
  [[ -s "$windows_bundle" ]] || fail "Missing GitHub artifact bundle: $windows_bundle"
  command -v unzip >/dev/null 2>&1 || fail "Install unzip to unpack GitHub Actions artifact bundles."
  extract_bundle_file "$macos_bundle" "$macos_name" "${stage_dir}/${macos_name}"
  extract_bundle_file "$windows_bundle" "$windows_name" "${stage_dir}/${windows_name}"
  macos_package="${stage_dir}/${macos_name}"
  windows_package="${stage_dir}/${windows_name}"
  printf 'Unpacked GitHub Actions artifacts into the client installers.\n'
else
  [[ -s "$macos_package" ]] || fail "Missing build artifact: $macos_package"
  [[ -s "$windows_package" ]] || fail "Missing build artifact: $windows_package"
  cp "$macos_package" "${stage_dir}/${macos_name}"
  cp "$windows_package" "${stage_dir}/${windows_name}"
  macos_package="${stage_dir}/${macos_name}"
  windows_package="${stage_dir}/${windows_name}"
fi

if command -v sha256sum >/dev/null 2>&1; then
  (
    cd "$stage_dir"
    sha256sum "$macos_name" "$windows_name" > SHA256SUMS
  )
elif command -v shasum >/dev/null 2>&1; then
  (
    cd "$stage_dir"
    shasum -a 256 "$macos_name" "$windows_name" > SHA256SUMS
  )
else
  fail "Install sha256sum or shasum to create the package checksum file."
fi
cp "${stage_dir}/SHA256SUMS" "${ARTIFACTS_DIR}/SHA256SUMS"

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
    "chmod 0644 '${REMOTE_DIR}/${macos_name}' '${REMOTE_DIR}/${windows_name}' '${REMOTE_DIR}/SHA256SUMS'"
  printf 'Synced client installers to %s:%s\n' "$DEVICE_MANAGEMENT_SSH_TARGET" "$REMOTE_DIR"
  exit 0
fi

[[ "$LOCAL_UPLOAD_DIR" == /* ]] || fail "DEVICE_MANAGEMENT_UPLOAD_DIR must be an absolute path."
[[ "$LOCAL_UPLOAD_DIR" != *"/../"* && "$LOCAL_UPLOAD_DIR" != */.. ]] \
  || fail "DEVICE_MANAGEMENT_UPLOAD_DIR must not contain parent-directory traversal."
[[ -d "$LOCAL_UPLOAD_DIR" ]] \
  || fail "Destination directory does not exist: $LOCAL_UPLOAD_DIR. Create it with the device-management deployment permissions first."

install -m 0644 "$macos_package" "$windows_package" "${stage_dir}/SHA256SUMS" "$LOCAL_UPLOAD_DIR/"
printf 'Synced client installers to %s\n' "$LOCAL_UPLOAD_DIR"
