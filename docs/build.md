## Dev build (macOS / Windows / Linux)

PerfSight is a **Tauri v2** app:

- **Frontend**: Vite + React (`perf-sight/`)
- **Backend**: Rust/Tauri (`perf-sight/src-tauri/`)
- **Sidecar**: Python collector bundled as a Tauri sidecar (`perf-sight/src-tauri/python/collector.py`)

### Prerequisites (all platforms)

- **Node.js**: 20+
- **Rust toolchain**: stable (via `rustup`)
- **Python**: 3.9+ (needed to build the sidecar)

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

## Keep GitHub and GitLab in sync

GitHub is the source for client builds; GitLab is the source for internal server
deployment. The local remotes are `origin` (GitHub) and `gitlab` (internal
GitLab). After committing changes, run:

```bash
bash scripts/push-to-both.sh main
```

The script syncs the committed branch tree; commit intended changes first. It
pushes the branch to GitHub, then creates one snapshot commit on GitLab whose
parent is GitLab's current branch. GitLab gets the latest source tree without
receiving GitHub's old commit history. The script checks the snapshot for
GitLab-prohibited file extensions and never force-pushes. If GitLab rejects the
sync, GitHub is current and the script reports that GitLab remains behind.

For a client release, create a version tag on the release commit and push that
specific tag with the branch:

```bash
git tag v0.1.9
bash scripts/push-to-both.sh main --tag v0.1.9
```

The GitHub tag triggers the client release workflow; release tags stay on GitHub.
GitLab receives a snapshot commit with the same source tree and a
`Source-Commit` trailer that identifies the corresponding GitHub commit. Older
GitHub history contains generated collector binaries, so pushing that complete
history would send those old files even though they were later deleted. The
snapshot avoids transmitting that history, and still rejects prohibited files
if they exist in the current committed tree.

The release and build jobs run repository code on GitHub-hosted machines. The
build job has read-only repository permissions; only the release job receives
permission to publish GitHub release assets. The sync helper sends built
installers over a pinned SSH host entry and does not need deployment secrets.

## Build the client with GitHub Actions

`.github/workflows/release.yml` uses GitHub-hosted Apple Silicon
`macos-latest` and Windows x64 `windows-latest` runners to call the native build
scripts. A tag matching `v*`
builds Apple Silicon macOS and Windows x64 packages, stores job artifacts, and
creates a draft GitHub Release with the installers. You can also run the
workflow manually to build job artifacts without creating a release.

The packages are `PerfSight-macos-arm64.zip` and
`PerfSight-windows-x64.msi`. The GitHub Release also includes `SHA256SUMS`.
Download the two installers manually and copy them to the PerfSight checkout on
the server. After placing both files in its root `artifacts/` directory, sync
them to device-management:

```bash
DEVICE_MANAGEMENT_UPLOAD_DIR=/opt/device-management/server/uploads/perfsight \
  bash scripts/sync-client-artifacts.sh
```

The sync script creates `SHA256SUMS`. If device-management is on another host,
set `DEVICE_MANAGEMENT_SSH_TARGET=deploy-user@device-management-host`; it uses
the server user's SSH key and pinned `known_hosts` entry.

The device-management deployment script creates and preserves the static
download directory. The device detail page serves the packages through its
existing `/api/uploads` route after the site frontend is deployed.

## Deploy the Server from GitLab

On the internal server, update the PerfSight checkout from its GitLab remote,
then rebuild and restart the service. Set `DEPLOY_REMOTE` to the remote name
that points to GitLab (`origin` if the server clone came directly from GitLab,
or `gitlab` if the clone has both remotes). Run this from the repository root:

```bash
DEPLOY_REMOTE=origin
git pull --ff-only "$DEPLOY_REMOTE" main
cd perfsight-server
npm ci
npx prisma generate
npx prisma migrate deploy
npm run build
sudo systemctl restart perfsight-server
sudo systemctl is-active perfsight-server
```

Keep the server's `.env` on the server and out of Git. The Caddy HTTP listener
and UFW allowlist remain server configuration and are not changed by this code
deployment.

The current packages are not code-signed or notarized. macOS Gatekeeper and
Windows SmartScreen may show an initial security prompt. Signing identities
and notarization credentials are intentionally not stored in this repository.


