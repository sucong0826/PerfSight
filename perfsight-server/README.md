# PerfSight Server

Team-level performance testing platform for viewing and comparing test reports.

## Quick Start

```bash
# 1. Install dependencies
cd perfsight-server
npm install

# 2. Add any non-default desktop app origins, comma-separated, when needed.
export PERFSIGHT_CORS_ORIGINS="tauri://localhost,http://tauri.localhost,https://tauri.localhost,http://localhost:1420,http://127.0.0.1:1420"

# 3. Initialize or upgrade the database
npx prisma generate
npx prisma migrate deploy

# 4. Start the Server
npm run dev
```

Server will be available at:
- **Web UI**: http://localhost:3001
- **API**: http://localhost:3001/api/v1

The Server binds to all interfaces so desktop clients on the LAN can reach it. Desktop clients accept HTTPS, or the approved internal HTTP endpoint `http://10.100.53.70:8080`. HTTP is unencrypted and should only be used on a trusted, restricted test network. The Server has no login or API token: anyone who can reach it can view, upload, import, or delete reports. Restrict access at the network layer.

### Internal-only HTTP through Caddy

When port 80 is occupied, Caddy can expose the Server as plain HTTP on a separate port while keeping the Node service bound to loopback:

```caddyfile
{
    auto_https disable_redirects
}

http://10.100.53.70:8080 {
    reverse_proxy 127.0.0.1:3001
}
```

Allow TCP 8080 only from the approved test computers in UFW, then configure each desktop client with `http://10.100.53.70:8080`. Do not expose this listener to untrusted networks.

## Connect PerfSight Desktop clients

1. Start the Server and make its HTTPS or approved internal HTTP URL reachable from each test computer.
2. In PerfSight Dashboard on each test computer, open **Server** and enter that URL.
3. Add the same `campaign:<id>` tag to every machine in a coordinated test batch.
4. Start and stop each test. PerfSight saves the report locally and uploads it automatically after a successful stop.
5. Open the Server site directly. Filter by device name or campaign ID, then open or compare reports.

Each desktop installation sends a stable client ID. Repeated uploads of the same report from that installation are idempotent, and separate installations can use the same local report number without colliding.

Uploads retain process names and aliases for analysis but remove process window titles and URLs, which may contain user content.

The current transport uploads completed report datasets over HTTP or HTTPS, depending on the configured Server URL. Live streaming ingest from multiple desktops is a later phase; the extension WebSocket currently terminates on the local desktop app.

## API Reference

### Upload Dataset
```bash
POST /api/v1/datasets
Content-Type: application/json

{
  "schema_version": 1,
  "exported_at": "2024-12-22T...",
  "report": { ... }
}
```

### List Runs
```bash
GET /api/v1/runs?release=6.7.0&scenario=startup&platform=macos&sort=newest&limit=50
```

`sort` accepts `newest` (default), `oldest`, `device-asc`, or `device-desc`. The Server site also lets you group the list by date or device.

### Get Run Detail
```bash
GET /api/v1/runs/:id
```

### Edit Run Title
```bash
PATCH /api/v1/runs/:id
Content-Type: application/json

{ "title": "Updated report title" }
```

Titles must contain 1 to 500 characters. The update is reflected in the run list and report details.

### Compare Runs
```bash
POST /api/v1/compare
Content-Type: application/json

{ "ids": ["uuid1", "uuid2"] }
```

## Upload from PerfSight Desktop

1. Open a test report in PerfSight Desktop
2. Click the **"Upload to Server"** button (green)
3. Configure server URL if needed (click ⚙ icon)
4. View uploaded report at http://localhost:3001

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3001 | Server port |
| `HOST` | `0.0.0.0` | Network interface to bind; use `127.0.0.1` for a local-only preview |
| `PERFSIGHT_CORS_ORIGINS` | Tauri and local Vite origins | Comma-separated browser origins permitted to call the API |

## Production Build

```bash
npm run build
npm start
```

## Database

Using SQLite for MVP. Database file: `prisma/perfsight.db`

To reset database:
```bash
rm prisma/perfsight.db
npx prisma migrate dev
```

