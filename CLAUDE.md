# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TimeFlow is a Next.js dashboard replacing ZKTeco BioTime's native interface for a single-location restaurant (~15–30 employees) in Medellín, Colombia. It pulls punch logs from BioTime via REST API, manages weekly schedules by employee group, calculates hours/overtime with Colombian labor law surcharges, and generates payroll summaries. Admin/managers only — no employee portal.

The full architecture plan is in `timeflow-architecture-plan.md`. Read it before implementing any feature.

## Commands

```bash
pnpm dev          # Start development server
pnpm build        # Production build
pnpm start        # Start production server
pnpm lint         # Run ESLint

# Database (Docker)
docker compose up -d   # Start local PostgreSQL on port 5433

# Drizzle ORM
pnpm db:generate   # Generate migrations from schema changes
pnpm db:migrate    # Apply migrations
pnpm db:studio     # Open Drizzle Studio GUI
pnpm db:seed       # Seed groups, admin user, and default settings
```

## Tech Stack

- **Next.js 16.2.3** (App Router) — has breaking changes from earlier versions; read `node_modules/next/dist/docs/` before writing code
- **React 19** with Server Components
- **TypeScript** (strict mode)
- **Drizzle ORM** with `postgres` driver → PostgreSQL 16
- **NextAuth v5 beta** (database sessions for instant revocation)
- **Tailwind CSS v4** via PostCSS plugin
- **pnpm** package manager

## Next.js 16 Breaking Changes

- `params` and `searchParams` in pages/layouts/routes are **Promises** — must be awaited
- `cookies()` and `headers()` must be awaited
- Middleware is now `proxy.ts` with `export function proxy()` (not `middleware.ts`)
- Turbopack is the default bundler
- ESLint uses flat config (already configured)

## Architecture

### Path Alias
`@/*` maps to `./src/*` (configured in tsconfig.json).

### Route Groups
- `src/app/(app)/` — authenticated pages with sidebar layout (dashboard, attendance, schedules, employees, payroll, settings)
- `src/app/login/` — public login page
- `src/app/api/` — API routes (auth, biotime sync)

### Auth
NextAuth v5 with credentials provider and database sessions (`src/auth.ts`). Custom adapter in `src/lib/auth/adapter.ts` uses the `admin_users` and `sessions` tables directly. Instant revocation: setting `is_active=false` on a user causes session lookup to fail and delete the session. Route protection via `src/proxy.ts`.

### Database
Local PostgreSQL runs via Docker Compose on **port 5433**. Connection string is in `.env.local` via `DATABASE_URL`. Schema defined in `src/drizzle/schema.ts` (12 tables). DB connection uses global singleton pattern in `src/lib/db.ts` to prevent pool exhaustion during dev hot reloads.

### BioTime Integration
Client in `src/lib/biotime-client.ts`. REST API accessed through Cloudflare Tunnel. JWT auth with auto-refresh on 401. Sync triggered via POST `/api/biotime/sync`.

### Colombian Labor Law Engine
The core business logic. Every minute worked is classified by time-of-day (diurno 6AM–7PM / nocturno 7PM–6AM) and day type (regular / festivo). Surcharges: RN +35%, RF +80% (until Jun 30 2026, then +90%), RFN +115%, HED +25%, HEN +75%. Jornada transitions from 44h/week to 42h/week on July 15, 2026. Sundays are regular workdays; only the 18 national holidays trigger festivo surcharges. See `timeflow-architecture-plan.md` §2 for full rules.

### Two-Pass Calculation
1. **Daily pass:** Classify each punch pair's minutes into recargo buckets (HOD, RN, RF, RFN), detect lateness/early departure, calculate daily excess over scheduled hours.
2. **Period reconciliation:** Sum worked hours vs expected for the pay period, determine overtime (HED/HEN) payable, apply comp time decisions.

### Compensatory Time
Signed ledger system — positive balance means company owes employee time off, negative means employee owes hours. OT can be banked as comp time instead of paid. Comp days debit the balance.

### Employee Groups
Kitchen, Servers, Bar, Admin — each group gets weekly schedule templates. Shifts support split shifts and midnight crossings.
