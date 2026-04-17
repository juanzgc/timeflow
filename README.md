# TimeFlow

Next.js dashboard replacing ZKTeco BioTime's native interface for a single-location restaurant in Medellin, Colombia. Pulls punch logs from BioTime via REST API, manages weekly schedules by employee group, calculates hours/overtime with Colombian labor law surcharges, and generates payroll summaries.

## Local Development

```bash
pnpm install          # Install dependencies
docker compose up -d  # Start local PostgreSQL on port 5433
pnpm db:migrate       # Apply migrations
pnpm db:seed          # Seed groups, admin user, and default settings
pnpm dev              # Start development server at http://localhost:3000
```

## Deployment Guide (Railway)

### Architecture

Three services in one Railway project:

| Service | Type | Purpose |
|---|---|---|
| **timeflow-app** | Web service (always-on) | Next.js app — UI + API routes |
| **timeflow-db** | PostgreSQL plugin | Managed Postgres database |
| **timeflow-cron** | Cron service | BioTime sync every 10 minutes |

```
┌─────────────────── Railway Project ───────────────────┐
│                                                        │
│  ┌──────────────┐     private network     ┌─────────┐ │
│  │ Cron Service  │────── HTTP POST ──────→│ Next.js  │ │
│  │ */10 * * * *  │   /api/biotime/sync     │   App   │ │
│  └──────────────┘                          └────┬────┘ │
│                                                  │      │
│                                            ┌─────┴────┐ │
│                                            │ Postgres  │ │
│                                            │   (DB)    │ │
│                                            └──────────┘ │
└──────────────────────┬─────────────────────────────────┘
                       │ HTTPS (Cloudflare Tunnel)
                       ▼
                ┌──────────────┐
                │   BioTime    │
                │   Server     │
                └──────────────┘
```

### 1. Create the Railway Project

1. Go to [railway.app](https://railway.app) and create a new project
2. Add a **PostgreSQL** service (Railway provisions it instantly)
3. Add a **Web Service** from your GitHub repo — this is the main Next.js app
4. Add a **second service** from the same repo — this becomes the cron job

### 2. Environment Variables

Set these on **both** the web service and the cron service. Use Railway reference variables (e.g. `${{Postgres.DATABASE_URL}}`) to share the database connection automatically.

```
DATABASE_URL=${{Postgres.DATABASE_URL}}
NEXTAUTH_SECRET=<generate a random 32+ char string>
NEXTAUTH_URL=https://<your-railway-domain>.railway.app
BIOTIME_URL=https://biotime.zelavi.co
BIOTIME_USERNAME=<biotime username>
BIOTIME_PASSWORD=<biotime password>
CRON_SECRET=<generate a random secret>
```

### 3. Web Service Configuration

In the web service settings:

- **Build command:** `pnpm install && pnpm db:migrate && pnpm build`
- **Start command:** `pnpm start`
- **Port:** Auto-detected (3000)

The `db:migrate` in the build step ensures migrations run on every deploy before the app starts.

### 4. Cron Service (BioTime Sync)

Railway cron services are separate processes that start, execute, and exit. They cannot run a persistent web server. Instead, a small script calls the sync endpoint on the web service over Railway's private network.

The cron script lives at `scripts/cron-sync.ts`:

```typescript
const APP_URL = process.env.RAILWAY_PRIVATE_DOMAIN
  ? `http://${process.env.RAILWAY_PRIVATE_DOMAIN}:3000`
  : 'http://localhost:3000';

async function main() {
  const res = await fetch(`${APP_URL}/api/biotime/sync`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
  if (!res.ok) { console.error(await res.json()); process.exit(1); }
  console.log('[cron] Sync complete:', await res.json());
  process.exit(0);
}

main().catch(() => process.exit(1));
```

Cron service settings:

- **Start command:** `npx tsx scripts/cron-sync.ts`
- **Cron schedule:** `*/10 * * * *` (every 10 minutes, UTC)

### 5. Initial Setup (First Deploy)

After the first successful deploy, run the seed command once:

```bash
railway run pnpm db:seed
```

This creates the default groups, admin user, and initial settings.

### 6. GitHub Integration

#### Auto-deploy from `main`

1. In Railway, go to your web service → **Settings → Source**
2. Connect to your GitHub repo
3. Set the **deploy branch** to `main`
4. Every push to `main` triggers an automatic build + deploy
5. Do the same for the cron service (same repo, same branch)

Railway handles zero-downtime deploys — the new instance starts, health checks pass, then the old one is drained.

#### CI with GitHub Actions

A GitHub Actions workflow at `.github/workflows/ci.yml` runs lint and tests on every push and pull request:

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  lint-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm test
```

To gate deploys on CI: in Railway, go to **Settings → Check Suites** and require the GitHub Actions check to pass before deploying.

#### PR Preview Environments (Optional)

Railway supports PR deploy previews — each pull request gets a temporary environment with its own URL and database. Enable in **Settings → Environments → Enable PR environments**.

### Resilience

- **Missed cron run:** Each sync uses `last_sync_time` from the settings table as its starting point, so it always picks up where it left off. No data is lost.
- **BioTime offline:** Sync fails gracefully. The dashboard shows "Last sync: X min ago" and a stale alert if > 30 minutes.
- **Stale-check fallback:** When users load pages, `syncIfStale()` checks if data is older than 5 minutes and does a lightweight transaction sync. This covers gaps even if cron misses a cycle.
- **Concurrent sync prevention:** A DB-based lock (`sync_in_progress` setting) prevents overlapping syncs.

### Cost

~$5-8/month total:

- **Web service:** ~$5/mo (hobby plan)
- **PostgreSQL:** Included for small datasets
- **Cron service:** Minimal — runs for a few seconds every 10 minutes
