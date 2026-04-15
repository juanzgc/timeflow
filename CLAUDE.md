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
NextAuth v5 with credentials provider and JWT session strategy (`src/auth.ts`). Instant revocation: the `jwt` callback checks `is_active` on every token refresh — disabling a user in `admin_users` causes the next request to return an empty session. Route protection via `src/proxy.ts`.

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

## Design System

Reference file: `timeflow-design-system-v2.jsx`. All UI must follow these tokens.

**Fonts:** Plus Jakarta Sans (body/heading, `--font-sans`) + JetBrains Mono (mono values, `--font-mono`). Configured via `next/font/google` in root layout.

**Aesthetic:** Linear / Vercel / Raycast — cool-toned, shadow-driven depth, vibrant accents. Cards use `shadow-sm`/`shadow-md` for elevation rather than heavy borders.

**Key color tokens (all in `globals.css`):**
- Primary (teal-cyan): `#00b899` — buttons, active states, accent glow
- Page bg: `#f5f5f7`, Card bg: `#ffffff`
- Sidebar: dark panel (`#101014`) with teal accent bar on active items
- Text: primary `#111118`, secondary `#555568`, tertiary `#9494a3`, quaternary `#bbbbc6`
- Status: success `#00a86b`, warning `#e59500`, danger `#e5484d`, info `#3e93de`
- Domain: nocturno `#7c5cbf`, festivo `#e5484d`, overtime `#e59500`
- Groups: kitchen `#e87040`, servers `#00b899`, bar `#7c5cbf`, admin `#3e93de`

**Typography patterns:**
- Page headings: `text-[22px] font-extrabold tracking-[-0.04em]`
- Card titles: `text-sm font-bold tracking-[-0.01em]`
- KPI values: `text-[32px] font-extrabold tracking-[-0.04em]`
- Labels/meta: `text-xs font-medium text-muted-foreground`
- Mono values (times, hours): `font-mono font-medium`

**Pill badges:** `rounded-full px-2.5 py-0.5 text-[11px] font-semibold` with status-colored bg/text/border (e.g. `bg-success-bg text-success-text`).

**Shadows:** `shadow-sm` (cards), `shadow-md` (elevated/hover), `shadow-lg` (modals). All defined in `@theme` block.

**Radius:** sm=6px, md=8px, lg=12px, xl=16px. Cards use `rounded-xl`.
