# PerfSight Server

Team-level performance testing platform for viewing and comparing test reports.

## Quick Start

```bash
# 1. Install dependencies
cd perfsight-server
npm install

# 2. Initialize database (first time only)
npx prisma generate
npx prisma migrate dev --name init

# 3. Start development server
npm run dev
```

Server will be available at:
- **Web UI**: http://localhost:3001
- **API**: http://localhost:3001/api/v1

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
GET /api/v1/runs?release=6.7.0&scenario=startup&platform=macos&limit=50
```

### Get Run Detail
```bash
GET /api/v1/runs/:id
```

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

