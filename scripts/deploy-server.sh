#!/usr/bin/env bash
set -Eeuo pipefail

SERVICE_NAME="perfsight-server"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

fail() {
  printf 'Deploy error: %s\n' "$1" >&2
  exit 1
}

if [[ -n "${PERFSIGHT_SERVER_DIR:-}" ]]; then
  requested_dir="$PERFSIGHT_SERVER_DIR"
elif [[ -f "${PWD}/package.json" && -f "${PWD}/prisma/schema.prisma" ]]; then
  requested_dir="$PWD"
else
  requested_dir="${REPO_ROOT}/perfsight-server"
fi

[[ -d "$requested_dir" ]] || fail "Server directory does not exist: $requested_dir"
SERVER_DIR="$(cd -- "$requested_dir" && pwd -P)" \
  || fail "Could not resolve server directory: $requested_dir"

for required_file in package.json package-lock.json prisma/schema.prisma; do
  [[ -f "${SERVER_DIR}/${required_file}" ]] \
    || fail "Missing ${required_file} in server directory: ${SERVER_DIR}"
done

command -v npm >/dev/null 2>&1 || fail "npm was not found on PATH."
command -v npx >/dev/null 2>&1 || fail "npx was not found on PATH."
command -v systemctl >/dev/null 2>&1 || fail "systemctl was not found."

sudo -v || fail "Could not obtain sudo authorization."

exec_start="$(sudo systemctl show --property=ExecStart --value "$SERVICE_NAME")" \
  || fail "Could not inspect systemd service: ${SERVICE_NAME}"
[[ -n "$exec_start" ]] || fail "systemd service is missing or has no ExecStart: ${SERVICE_NAME}"
printf '%s\n' "$exec_start" | grep -F -- "${SERVER_DIR}/dist/index.js" >/dev/null \
  || fail "The service runs from a different directory. Expected ${SERVER_DIR}/dist/index.js; actual ExecStart: ${exec_start}"

cd "$SERVER_DIR"
printf 'Deploying %s from %s\n' "$SERVICE_NAME" "$SERVER_DIR"

npm ci
npx prisma generate
npx prisma migrate deploy
npm run build

sudo systemctl restart "$SERVICE_NAME"
if ! sudo systemctl is-active --quiet "$SERVICE_NAME"; then
  sudo systemctl --no-pager --full status "$SERVICE_NAME" || true
  fail "${SERVICE_NAME} did not become active after restart."
fi

printf 'Deployment complete: %s is active.\n' "$SERVICE_NAME"
