# TimeFlow — BioTime Dashboard Architecture Plan

## 1. Project Summary

**What:** A custom Next.js dashboard that replaces ZKTeco BioTime's native interface for a single-location restaurant (~15–30 employees) in Medellín, Colombia.

**Core capabilities:**
- Pull punch logs from BioTime via its REST API (over Cloudflare Tunnel)
- Manage weekly schedules by group (Kitchen, Servers, Bar, Admin)
- Automatically calculate: hours worked, overtime, lateness, early departures
- Apply all Colombian labor surcharges (nocturno, extra, festivo)
- Output pay period summaries ready for payroll (flexible dates)

**Users:** Admin/managers only (no employee self-service portal)

---

## 2. Colombian Labor Law Engine — 2026 Rules

This is the heart of the system. Every minute worked must be classified correctly.

### 2.1 Jornada Laboral (Working Hours)

| Period | Max Weekly Hours | Monthly Hours | Hourly Rate |
|---|---|---|---|
| Until July 14, 2026 | 44 hrs | 220 hrs | Salary ÷ 220 |
| From July 15, 2026 | 42 hrs | 210 hrs | Salary ÷ 210 |

The system must handle the transition date automatically. Daily max is 9 hours without overtime surcharge (flexible distribution). Max overtime: 2 hrs/day, 12 hrs/week.

### 2.2 Day vs Night (Ley 2466 de 2025, effective Dec 25, 2025)

| Franja | Hours |
|---|---|
| Diurna | 6:00 AM → 7:00 PM |
| Nocturna | 7:00 PM → 6:00 AM |

**Critical change:** Before Ley 2466, nocturna started at 9:00 PM. Now it starts at 7:00 PM. This is already in effect.

### 2.3 Surcharge Table (% over hora ordinaria)

| Concept | Code | Surcharge % | Notes |
|---|---|---|---|
| Hora ordinaria diurna | HOD | 0% | Base rate |
| Recargo nocturno | RN | +35% | 7PM–6AM, ordinary hours |
| Recargo festivo diurno | RF | +80%* | Holiday, 6AM–7PM, ordinary hours |
| Recargo festivo nocturno | RFN | +115%* | Holiday, 7PM–6AM (80% + 35%) |
| Hora extra diurna | HED | +25% | Beyond jornada, 6AM–7PM |
| Hora extra nocturna | HEN | +75% | Beyond jornada, 7PM–6AM |

*Festivo rate until Jun 30, 2026 = 80%. From Jul 1, 2026 = 90%. From Jul 1, 2027 = 100%.

Overtime on a holiday is paid as regular HED or HEN — NOT at a combined
festivo+extra rate. The festivo component is already covered separately by
the recargo (RF or RFN), which applies to ALL hours on a holiday including
any that later become overtime. No combined HEDF/HENF rates needed.

### 2.4 Dominical — NOT APPLICABLE

Per Ley 2466 de 2025, the employer may designate any day as the employee's
mandatory rest day (día de descanso obligatorio). Each employee's rest day is
set to a day they are already scheduled off. Since no one works on their
designated rest day, **dominical surcharges never trigger**.

Sundays are treated as regular weekdays in all calculations. Only the 18
national holidays (festivos) trigger the festivo surcharge.

Each employee's designated rest day is stored in the employees table for
legal compliance and contract documentation.

### 2.5 Colombian Holidays 2026 (18 festivos)

These will be hardcoded for 2026 and easily updatable per year:

```
Jan 1   - Año Nuevo
Jan 12  - Reyes Magos (Emiliani)
Mar 23  - San José (Emiliani)
Apr 2   - Jueves Santo
Apr 3   - Viernes Santo
May 1   - Día del Trabajo
May 18  - Ascensión del Señor (Emiliani)
Jun 8   - Corpus Christi (Emiliani)
Jun 15  - Sagrado Corazón (Emiliani)
Jun 29  - San Pedro y San Pablo (Emiliani)
Jul 20  - Independencia
Aug 7   - Batalla de Boyacá
Aug 17  - Asunción de la Virgen (Emiliani)
Oct 12  - Día de la Raza (Emiliani)
Nov 2   - Todos los Santos (Emiliani)
Nov 16  - Independencia de Cartagena (Emiliani)
Dec 8   - Inmaculada Concepción
Dec 25  - Navidad
```

### 2.6 Daily Scheduled Limits & Period-Based Overtime

**Configurable daily limits** (stored in settings, editable):

| Day | Max ordinary hours | Notes |
|---|---|---|
| Sunday – Thursday | 7 hours | Lower daily target |
| Friday – Saturday | 8 hours | Heavier weekend days |

These limits apply until July 14, 2026. From July 15, 2026 (42h/week):

| Day | Max ordinary hours | Notes |
|---|---|---|
| All days | 7 hours | Uniform after reduction |

**CRITICAL: Overtime is determined per PAY PERIOD, not weekly or daily.**

Pay periods have custom start/end dates set by the manager (roughly
biweekly but flexible — e.g., Mar 28 to Apr 12 = 16 days). The engine
calculates expected hours from the schedule and compares to actual hours
across the entire period.

```
EXPECTED HOURS for a period:
  For each day in the period:
    - If employee is SCHEDULED to work → add daily limit (7h or 8h)
    - If day off, rest day, or comp day → add 0h
  period_expected = sum of all daily expected hours

  Example: Mar 28 (Fri) to Apr 12 (Sat) = 16 days
    Employee works 12 of those days, has 4 days off
    Scheduled: 4 Fri/Sat days (8h each) + 8 Sun-Thu days (7h each)
    period_expected = (4 × 8) + (8 × 7) = 32 + 56 = 88h
```

Daily excess hours (above the daily limit) are tracked but NOT automatically
classified as overtime. The engine uses a two-pass system:

```
PASS 1 — Daily (runs each day, results are PROVISIONAL for extras):
  1. Classify every worked minute by:
     - Time of day: diurno (6AM–7PM) vs nocturno (7PM–6AM)
     - Day type: regular day vs national holiday (festivo)
     - Sundays are treated as regular days (no dominical surcharge)
  2. Calculate RECARGOS immediately (these are FINAL):
     - Nocturno minutes on regular day × 0.35 factor (RN)
     - Festivo diurno minutes × 0.80 factor (RF, date-aware)
     - Festivo nocturno minutes × 1.15 factor (RFN, date-aware)
  3. Flag daily excess as "potential overtime" (NOT yet payable)
     - Tag each excess minute as HED (diurno) or HEN (nocturno) only
     - Holiday status does NOT affect the excess tag — festivo is
       already covered by recargos in step 2

PASS 2 — Period reconciliation (runs when manager finalizes payroll):
  1. Sum total ACTUAL worked hours across all days in the period
  2. Calculate period_expected from schedule (sum of daily limits)
  3. overtime_raw = actual_total - period_expected
  4. IF overtime_raw > 0:
     - overtime_owed = floor_to_15min(overtime_raw)
         → 88h 12min actual, 88h expected → 12 min raw → floor = 0 → NO overtime
         → 90h actual, 88h expected → 120 min raw → floor = 120 min payable
     - IF overtime_owed > 0:
       - Collect ALL daily excess hours across the period into a pool:
           Pool example: [3h HEN (Apr 1), 2h HED (Apr 5), 1h HED (Apr 10)]
       - Consume cheapest first: HED (×1.25) → HEN (×1.75)
           e.g., 2h overtime owed, pool has 3h HED + 3h HEN
           → Pay 2h HED at ×1.25, discard rest
       - Manager then decides: pay or bank as comp time (or split)
  5. IF overtime_raw ≤ 0 OR overtime after rounding = 0:
     - Zero overtime payable
     - All daily excess flags are cleared
     - Manager successfully offset the excess via schedule adjustments

IMPORTANT: Recargos (Pass 1) are INDEPENDENT of overtime (Pass 2).
  - Nocturno recargo applies even if no overtime is generated
  - Festivo recargo applies even if no overtime is generated
  - These are about WHEN you work, not HOW MUCH
```

**Manager workflow for overtime avoidance:**
```
Apr 1 (Tue): Employee stays late, works 10h instead of 7h (+3h excess)
         ↓
Manager sees the excess in the dashboard
         ↓
Manager has until the period ends (Apr 12) to offset
         ↓
Manager reduces a later day in the period: Apr 8 from 7h to 4h
         ↓
Period total: actual matches expected → 0h overtime
         ↓
BUT: Apr 1's nocturno hours (if any fell after 7PM) still get recargo
```

### 2.7 Calculation Flow (per employee, per day)

```
INPUT:
  - punch_in, punch_out (single pair from BioTime)
  - schedule: shift segments (could be split), breaks, gap duration
  - employee monthly salary
  - date → is it Sunday? Holiday? Both?
  - daily_limit: 7h (Sun-Thu) or 8h (Fri-Sat)

STEP 0: Normalize punch times (BEFORE any calculation)
  - CLOCK-IN RULE:
      effective_start = max(scheduled_start, actual_punch_in)
      → Early arrival (before schedule): pay starts at scheduled time
      → Late arrival (after schedule): pay starts at actual punch time
      → Late minutes = max(0, actual_punch_in - scheduled_start)

  - CLOCK-OUT RULE (two cases):
      IF actual_punch_out <= scheduled_end:
        effective_end = actual_punch_out  (exact, no rounding)
        early_leave_mins = scheduled_end - actual_punch_out
      
      IF actual_punch_out > scheduled_end:
        overtime_raw = actual_punch_out - scheduled_end
        overtime_rounded = floor_to_15min(overtime_raw)
        effective_end = scheduled_end + overtime_rounded
        → Only full 15-minute blocks beyond schedule count
        → 5:05pm with 5pm end → 5min over → floor(5) = 0 → pay to 5:00pm
        → 5:12pm with 5pm end → 12min over → floor(12) = 0 → pay to 5:00pm
        → 5:15pm with 5pm end → 15min over → floor(15) = 15 → pay to 5:15pm
        → 5:29pm with 5pm end → 29min over → floor(29) = 15 → pay to 5:15pm

STEP 1: Compute total minutes worked (using normalized times from Step 0)
  - elapsed = effective_end - effective_start
  - Subtract scheduled gap (turno partido):
      e.g., scheduled 12-4pm / 6-10pm → gap = 2h
  - Subtract scheduled breaks (if any)
  - worked_minutes = elapsed - gap - breaks

STEP 2: Split worked time into time segments
  - Each minute classified as diurno (6AM–7PM) or nocturno (7PM–6AM)
  - For midnight-crossing shifts: split at calendar midnight for
    festivo boundary (a shift Sat→Sun crossing midnight into a
    holiday only triggers festivo for the post-midnight hours)
  - For turno partido: the gap hours are excluded from worked time
    but the time-of-day classification considers the actual clock times
    of each segment

STEP 3: Apply day type (per calendar date after midnight split)
  - Regular day (including Sundays) → base surcharges only
  - National holiday (festivo) → festivo surcharges
  - Sunday that is also a holiday → festivo surcharge (not dominical)

STEP 4: Calculate RECARGOS (final, independent of overtime)
  - Nocturno minutes on regular day → RN (×0.35)
  - Diurno minutes on festivo → RF (×0.80)
  - Nocturno minutes on festivo → RFN (×1.15)

STEP 5: Flag daily excess (provisional, pending period reconciliation)
  - excess = max(0, worked_minutes - daily_limit_minutes)
  - Store which minutes are excess and their time/day classification
  - These are NOT yet overtime — just flagged

STEP 6: Period reconciliation (runs when manager creates/recalculates payroll)
  - Sum all worked_minutes across all days in the pay period
  - Sum all daily_limit_mins for scheduled work days = period_expected
  - overtime_raw = actual_total - period_expected
  - If overtime_raw > 0:
      overtime_owed = floor_to_15min(overtime_raw)
      Collect excess pool from all daily records in the period
      Consume cheapest first: HED (×1.25) → HEN (×1.75)
      
      6a. Check employee's comp_balance:
          IF comp_balance < 0 (employee owes time):
            offset = min(overtime_owed, abs(comp_balance))
            overtime_available = overtime_owed - offset
            comp_balance += offset  (moves toward zero)
            Log 'owed_offset' transaction: +offset mins
          ELSE:
            overtime_available = overtime_owed
      
      6b. Manager decides (on overtime_available only):
          - How many hours to bank as comp → comp_balance increases
          - Remainder is paid → goes to Siigo as HED/HEN
  
  - If overtime_raw ≤ 0:
      Zero overtime payable, clear all excess flags
      If manager records time owed (e.g., unexplained absence):
        Log 'time_owed' transaction: -X mins → comp_balance decreases

STEP 7: Calculate costs
  - hora_ordinaria = salary / monthly_hours (220 or 210)
  - Recargo costs = hora_ordinaria × factor × hours (always paid)
  - Overtime costs = hora_ordinaria × factor × hours (only if period excess, after comp)
  - Total surcharges = sum of all recargo + overtime costs

STEP 8: Lateness & early departure (already computed in Step 0)
  - late_minutes = max(0, actual_punch_in - scheduled_start)
  - early_leave_minutes = scheduled_end - actual_punch_out (only if left early)
  - Both stored in daily_attendance for reporting and dashboards
```

### 2.8 Compensatory Time & Time Owed System

The comp balance is a **signed ledger** per employee:
- **Positive balance** = company owes employee time (banked OT)
- **Negative balance** = employee owes company time (under-worked, excess comp taken)
- **Zero** = settled

**How balance goes positive (company owes employee):**
- Manager banks overtime as comp instead of paying it
- Manager decides per employee, per period: how many OT hours to bank
  vs pay. Can split (e.g., bank 5h, pay 3h from an 8h OT period).
- Balance carries indefinitely — no expiration.

**How balance goes negative (employee owes company):**
- Employee takes a comp day but has insufficient balance
- Employee under-worked during a period (absent, left early) and manager
  records time owed
- Manager manually creates a time-owed entry

**How negative balance gets resolved:**
- When an employee has a negative balance AND earns overtime in a future
  period, the OT offsets the debt FIRST before any banking or payment.

**Rules:**
- When a comp day off is scheduled, the full scheduled hours for that day
  are debited from the balance (typically 7h). Balance can go negative.
- Comp days do NOT inflate period hours. Actual worked hours are what
  matters for overtime calculation.
- The employee's monthly salary continues as normal regardless of balance.

**Flow (positive balance — normal comp):**
```
PERIOD RECONCILIATION produces: 8h overtime
         ↓
Employee comp balance: +0h (settled)
         ↓
MANAGER DECISION (before payroll closes):
  - "Bank 5h, pay 3h" for Carlos
         ↓
  BANKED: +5h → comp_balance: +5h
  PAID:   3h flows into payroll as HED/HEN (Siigo export)
         ↓
FUTURE PERIOD:
  Manager schedules Carlos OFF on a Monday (comp day)
  → -7h debited → comp_balance: -2h (Carlos now owes 2h)
```

**Flow (negative balance — offset by future OT):**
```
Carlos has comp_balance: -2h (owes 2h from previous period)
         ↓
PERIOD RECONCILIATION produces: 5h overtime
         ↓
AUTOMATIC OFFSET FIRST:
  → 2h of OT offsets the -2h debt → comp_balance: 0h
  → Remaining OT available: 5h - 2h = 3h
         ↓
MANAGER DECISION (on remaining 3h):
  - "Bank 1h, pay 2h"
  → BANKED: +1h → comp_balance: +1h
  → PAID: 2h to Siigo
```

**Payroll impact:**
```
Period summary shows per employee:
  - Comp balance start:                -2h (employee owed 2h)
  - Overtime earned this period:        5h
  - Offset against debt:               +2h (auto, clears the -2h)
  - Overtime available after offset:    3h
  - Overtime banked (comp):            -1h
  - Overtime paid (to Siigo):           2h  ← only this goes to export
  - Comp days taken this period:        0
  - Comp balance end:                  +1h
```

---

## 3. Data Model

### 3.1 Database Schema (PostgreSQL)

```sql
-- Admin users (for NextAuth database sessions)
CREATE TABLE admin_users (
  id              INTEGER PRIMARY KEY,
  username        TEXT UNIQUE NOT NULL,
  email           TEXT UNIQUE,
  password_hash   TEXT NOT NULL,
  display_name    TEXT,
  role            TEXT DEFAULT 'admin',   -- 'admin', 'superadmin'
  is_active       BOOLEAN DEFAULT TRUE,   -- set false to revoke access instantly
  last_login      TIMESTAMP,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);

-- NextAuth sessions (database strategy for instant revocation)
CREATE TABLE sessions (
  id              TEXT PRIMARY KEY,        -- session token
  user_id         INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  expires         TIMESTAMP NOT NULL,
  created_at      TIMESTAMP DEFAULT NOW()
);
-- When admin sets is_active=false on a user:
--   DELETE FROM sessions WHERE user_id = <disabled_user_id>
-- Next page load → no session found → redirected to login

-- Employee groups
CREATE TABLE groups (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,        -- 'Kitchen', 'Servers', 'Bar', 'Admin'
  created_at  TIMESTAMP DEFAULT NOW()
);

-- Employees (synced from BioTime)
CREATE TABLE employees (
  id              INTEGER PRIMARY KEY,
  emp_code        TEXT UNIQUE NOT NULL,   -- BioTime emp_code
  cedula          TEXT,                   -- Colombian ID (for Siigo export)
  first_name      TEXT NOT NULL,
  last_name       TEXT NOT NULL,
  group_id        INTEGER REFERENCES groups(id),
  monthly_salary  DECIMAL(12,2),
  rest_day        INTEGER DEFAULT 0,     -- Designated rest day (0=Mon..6=Sun)
  is_active       BOOLEAN DEFAULT TRUE,
  biotime_id      INTEGER,                -- BioTime internal ID
  synced_at       TIMESTAMP,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);

-- Weekly schedule definition
CREATE TABLE weekly_schedules (
  id              INTEGER PRIMARY KEY,
  week_start      DATE NOT NULL,          -- Monday of the week
  group_id        INTEGER REFERENCES groups(id),
  created_by      TEXT,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW(),
  UNIQUE(week_start, group_id)
);

-- Individual shifts within a weekly schedule
CREATE TABLE shifts (
  id              INTEGER PRIMARY KEY,
  schedule_id     INTEGER REFERENCES weekly_schedules(id) ON DELETE CASCADE,
  employee_id     INTEGER REFERENCES employees(id),
  day_of_week     INTEGER NOT NULL,       -- 0=Monday, 6=Sunday
  shift_type      TEXT DEFAULT 'regular', -- 'regular', 'day_off', 'comp_day_off'
  shift_start     TIME,                   -- null for day_off / comp_day_off
  shift_end       TIME,                   -- null for day_off / comp_day_off
  crosses_midnight BOOLEAN DEFAULT FALSE,
  break_minutes   INTEGER DEFAULT 0,
  is_split        BOOLEAN DEFAULT FALSE,  -- first segment of split shift
  split_pair_id   INTEGER REFERENCES shifts(id), -- links split segments
  comp_debit_mins INTEGER DEFAULT 0,      -- hours debited from comp balance (comp_day_off only)
  UNIQUE(schedule_id, employee_id, day_of_week, shift_start)
);
-- APPLICATION-LEVEL VALIDATIONS (enforced in API before insert/update):
--
-- 1. No overlapping shifts: for any two shifts on the same day for the
--    same employee, shift2.start must be >= shift1.end
--    REJECT: 12:00-16:00 + 14:00-18:00 (14:00 falls within first shift)
--    REJECT: 12:00-16:00 + 14:00-15:00 (contained within first shift)
--    ALLOW:  12:00-16:00 + 18:00-22:00 (gap between segments)
--    ALLOW:  12:00-16:00 + 16:00-20:00 (back-to-back, no overlap)
--
-- 2. Shift end must be after shift start (unless crosses_midnight)
--    REJECT: start=14:00, end=12:00, crosses_midnight=false
--    ALLOW:  start=22:00, end=02:00, crosses_midnight=true
--
-- 3. Max 2 shifts per employee per day (turno partido = 2 segments)
--
-- 4. Shift2 start must leave a gap of at least 30 min after shift1 end
--    (practical minimum for a turno partido break)

-- Raw punch logs (synced from BioTime + manual entries)
CREATE TABLE punch_logs (
  id              INTEGER PRIMARY KEY,
  emp_code        TEXT NOT NULL,
  punch_time      TIMESTAMP NOT NULL,
  punch_state     TEXT,                   -- '0'=in, '1'=out
  verify_type     INTEGER,
  terminal_sn     TEXT,
  biotime_id      INTEGER UNIQUE,         -- BioTime transaction ID (null for manual)
  source          TEXT DEFAULT 'biotime', -- 'biotime' or 'manual'
  created_by      TEXT,                   -- admin username (for manual entries)
  note            TEXT,                   -- reason for manual entry
  synced_at       TIMESTAMP DEFAULT NOW()
);

-- Audit log for all manual punch changes
CREATE TABLE punch_corrections (
  id              INTEGER PRIMARY KEY,
  employee_id     INTEGER REFERENCES employees(id),
  work_date       DATE NOT NULL,
  action          TEXT NOT NULL,          -- 'add_in', 'add_out', 'edit_in', 'edit_out'
  old_value       TIMESTAMP,             -- previous time (null for new entries)
  new_value       TIMESTAMP NOT NULL,    -- corrected time
  reason          TEXT NOT NULL,          -- manager must provide a reason
  corrected_by    TEXT NOT NULL,          -- admin username
  corrected_at    TIMESTAMP DEFAULT NOW()
);

-- Calculated daily attendance (derived)
CREATE TABLE daily_attendance (
  id                  INTEGER PRIMARY KEY,
  employee_id         INTEGER REFERENCES employees(id),
  work_date           DATE NOT NULL,
  -- Raw punches (from BioTime or manual)
  clock_in            TIMESTAMP,
  clock_out           TIMESTAMP,
  -- Effective times (after normalization rules)
  effective_in        TIMESTAMP,          -- max(scheduled_start, clock_in)
  effective_out       TIMESTAMP,          -- scheduled_end + floor_15(excess)
  -- Manual correction flags
  is_clock_in_manual  BOOLEAN DEFAULT FALSE,
  is_clock_out_manual BOOLEAN DEFAULT FALSE,
  is_missing_punch    BOOLEAN DEFAULT FALSE,  -- flagged when only 1 punch exists
  -- Schedule context (denormalized from shifts for self-contained record)
  scheduled_start     TIME,
  scheduled_end       TIME,
  scheduled_gap_mins  INTEGER DEFAULT 0,  -- turno partido gap to subtract
  scheduled_break_mins INTEGER DEFAULT 0, -- unpaid break to subtract
  crosses_midnight    BOOLEAN DEFAULT FALSE,
  is_split_shift      BOOLEAN DEFAULT FALSE,
  -- Calculations
  total_worked_mins   INTEGER DEFAULT 0,
  late_minutes        INTEGER DEFAULT 0,
  early_leave_mins    INTEGER DEFAULT 0,
  -- Hour classification (in minutes)
  mins_ordinary_day   INTEGER DEFAULT 0,  -- Regular diurno (no surcharge)
  mins_nocturno       INTEGER DEFAULT 0,  -- RN: nocturno recargo (×0.35)
  mins_festivo_day    INTEGER DEFAULT 0,  -- RF: festivo diurno (×0.80)
  mins_festivo_night  INTEGER DEFAULT 0,  -- RFN: festivo nocturno (×1.15)
  -- Status
  day_type            TEXT,               -- 'regular', 'holiday'
  status              TEXT,               -- 'on-time', 'late', 'absent', 'day-off', 'comp-day-off'
  -- Daily excess pool (provisional, for period reconciliation)
  -- Only 2 buckets: day or night (holiday status irrelevant for extras)
  excess_hed_mins     INTEGER DEFAULT 0,  -- excess diurno (×1.25 if paid)
  excess_hen_mins     INTEGER DEFAULT 0,  -- excess nocturno (×1.75 if paid)
  daily_limit_mins    INTEGER DEFAULT 0,  -- 420 (7h) or 480 (8h)
  is_processed        BOOLEAN DEFAULT FALSE,
  UNIQUE(employee_id, work_date)
);

-- Pay period summaries (flexible dates, roughly biweekly)
-- This is the SINGLE reconciliation unit for overtime, comp, and Siigo export
CREATE TABLE payroll_periods (
  id              INTEGER PRIMARY KEY,
  period_start    DATE NOT NULL,          -- manager-defined start (e.g., Mar 28)
  period_end      DATE NOT NULL,          -- manager-defined end (e.g., Apr 12)
  employee_id     INTEGER REFERENCES employees(id),
  status          TEXT DEFAULT 'draft',   -- 'draft', 'finalized', 'exported', 'test'
                                         -- 'test' periods can't be exported to Siigo

  -- Time totals
  total_expected_mins   INTEGER DEFAULT 0,  -- sum of daily limits for scheduled days
  total_worked_mins     INTEGER DEFAULT 0,  -- sum of actual worked minutes
  total_ordinary_mins   INTEGER DEFAULT 0,  -- worked mins within expected
  total_late_mins       INTEGER DEFAULT 0,
  total_early_leave_mins INTEGER DEFAULT 0,
  days_scheduled        INTEGER DEFAULT 0,  -- number of work days in period
  days_worked           INTEGER DEFAULT 0,  -- number of days actually worked
  days_absent           INTEGER DEFAULT 0,

  -- RECARGOS (always paid, independent of overtime)
  -- These map to Siigo concept groups 009, 010, 011
  rn_mins               INTEGER DEFAULT 0,   -- Recargo nocturno (×0.35)
  rn_cost               DECIMAL(12,2) DEFAULT 0,
  rf_mins               INTEGER DEFAULT 0,   -- Recargo festivo diurno (×0.80)
  rf_cost               DECIMAL(12,2) DEFAULT 0,
  rfn_mins              INTEGER DEFAULT 0,   -- Recargo festivo nocturno (×1.15)
  rfn_cost              DECIMAL(12,2) DEFAULT 0,

  -- OVERTIME (period-level reconciliation, cheapest-first)
  -- Excess pool (collected from all daily records in the period)
  pool_hed_mins         INTEGER DEFAULT 0,   -- total daily excess: diurno
  pool_hen_mins         INTEGER DEFAULT 0,   -- total daily excess: nocturno
  -- Overtime after reconciliation
  overtime_raw_mins     INTEGER DEFAULT 0,   -- actual - expected (before floor)
  overtime_owed_mins    INTEGER DEFAULT 0,   -- after floor_to_15min
  -- Overtime consumed from pool (cheapest-first)
  ot_earned_hed_mins    INTEGER DEFAULT 0,   -- extra diurna from pool
  ot_earned_hen_mins    INTEGER DEFAULT 0,   -- extra nocturna from pool

  -- COMP TIME & TIME OWED (manager decision before export)
  -- Step 1: If employee has negative balance (owes time), OT offsets it first
  owed_offset_mins      INTEGER DEFAULT 0,   -- OT used to clear negative balance
  -- Step 2: Remaining OT after offset → manager decides bank vs pay
  ot_banked_mins        INTEGER DEFAULT 0,   -- hours banked as comp time
  -- Step 3: Remaining OT after offset + bank → paid out
  -- PAID overtime (after offset + comp deduction) — this goes to Siigo
  -- Maps to Siigo concept groups 005, 006
  hed_mins              INTEGER DEFAULT 0,   -- Paid extra diurna (×1.25)
  hed_cost              DECIMAL(12,2) DEFAULT 0,
  hen_mins              INTEGER DEFAULT 0,   -- Paid extra nocturna (×1.75)
  hen_cost              DECIMAL(12,2) DEFAULT 0,

  -- Totals
  total_recargos_cost   DECIMAL(12,2) DEFAULT 0,  -- rn + rf + rfn
  total_extras_cost     DECIMAL(12,2) DEFAULT 0,  -- hed + hen (paid only)
  total_surcharges      DECIMAL(12,2) DEFAULT 0,  -- recargos + extras

  -- Compensatory balance tracking (signed: positive = owed to employee)
  comp_balance_start    INTEGER DEFAULT 0,   -- balance at start of period (can be negative)
  comp_credited_mins    INTEGER DEFAULT 0,   -- OT banked this period (+)
  comp_debited_mins     INTEGER DEFAULT 0,   -- comp days taken this period (-)
  comp_owed_mins        INTEGER DEFAULT 0,   -- time owed added this period (-)
  comp_offset_mins      INTEGER DEFAULT 0,   -- owed time offset by OT this period (+)
  comp_balance_end      INTEGER DEFAULT 0,   -- balance at end of period (can be negative)

  -- Holiday tracking
  holidays_worked       INTEGER DEFAULT 0,

  -- Metadata
  hora_ordinaria_value  DECIMAL(8,2),    -- salary ÷ 220 or ÷ 210
  monthly_salary        DECIMAL(12,2),
  created_by            TEXT,
  created_at            TIMESTAMP DEFAULT NOW(),
  finalized_at          TIMESTAMP,

  UNIQUE(period_start, period_end, employee_id)
);

-- App settings
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
-- e.g. ('biotime_url', 'http://192.168.1.100:8090')
-- e.g. ('biotime_token', 'eyJ...')
-- e.g. ('sync_interval_minutes', '10')
-- e.g. ('daily_limit_sun_thu', '420')   -- 7 hours in minutes
-- e.g. ('daily_limit_fri_sat', '480')   -- 8 hours in minutes

-- Compensatory time balance ledger (signed values)
-- Positive = company owes employee (banked OT)
-- Negative = employee owes company (took more than earned, or under-worked)
CREATE TABLE comp_transactions (
  id              INTEGER PRIMARY KEY,
  employee_id     INTEGER REFERENCES employees(id),
  transaction_date DATE NOT NULL,
  type            TEXT NOT NULL,          -- 'ot_banked', 'comp_day_taken',
                                         -- 'time_owed', 'owed_offset'
  minutes         INTEGER NOT NULL,       -- SIGNED: +420 = banked 7h,
                                         --         -420 = took 7h off,
                                         --         -180 = owes 3h
  balance_after   INTEGER NOT NULL,       -- running balance (can be negative)
  -- Context
  source_period_id INTEGER REFERENCES payroll_periods(id),
  source_shift_id INTEGER REFERENCES shifts(id), -- comp_day_off shift
  note            TEXT,
  created_by      TEXT NOT NULL,
  created_at      TIMESTAMP DEFAULT NOW()
);
-- TRANSACTION TYPES:
--   'ot_banked'      +mins  Manager banks OT as comp time
--   'comp_day_taken' -mins  Employee takes a comp day off
--   'time_owed'      -mins  Employee under-worked, owes time
--   'owed_offset'    +mins  Time owed was offset against OT in a later period

-- Current balance is derived from comp_transactions, not stored separately:
--   SELECT balance_after FROM comp_transactions
--   WHERE employee_id = ? ORDER BY created_at DESC LIMIT 1;
-- This avoids sync issues between two tables. For 15-30 employees,
-- this query is instant.
```

### 3.2 Key Design Decisions

- **Schedules are per-group, per-week.** A manager selects a group and a week, then assigns shifts to each employee in that group for that week.
- **Split shifts** are stored as two linked rows in the `shifts` table via `split_pair_id`. The calculation engine sums both segments.
- **Midnight-crossing shifts** are flagged with `crosses_midnight = true`. A shift from 18:00 to 02:00 means the end time is on the following calendar day.
- **BioTime punch logs are immutable** — raw data from BioTime is never modified. Manual entries are added separately with `source = 'manual'`.
- **Manual corrections** are always logged in `punch_corrections` with the admin's name, old/new values, and a mandatory reason. This creates a full audit trail.
- **Missing punch detection** — if only one punch exists for a business day, the record is flagged as `is_missing_punch = true` and shows an alert in the dashboard for the manager to resolve.
- **Auto-recalculation** — any manual punch addition or edit triggers an automatic recalculation of:
  1. That day's `daily_attendance` record (recargos, excess pool, lateness)
  2. The affected `payroll_periods` record if it exists (overtime reconciliation)
- **Pay periods** have custom start/end dates set by the manager. They are the single reconciliation unit for overtime, comp decisions, and Siigo export.
- **Compensatory time & time owed** are managed via a signed ledger (`comp_transactions`). Positive entries = company owes employee (banked OT). Negative entries = employee owes company (comp days taken, time owed). The current balance is derived from the last transaction's `balance_after` field — no separate cache table needed. When an employee with a negative balance earns overtime, the OT auto-offsets the debt before any banking or payment. Comp days count as 0 actual hours for period overtime calculation.

### 3.3 Manual Correction Flow

```
Manager sees alert: "Carlos Restrepo — missing clock-out on Apr 13"
         ↓
Opens employee's attendance detail for that day
         ↓
Clicks "Add clock-out" or "Edit clock-in/out"
         ↓
Modal appears:
  - Current value (if editing): shown but read-only
  - New time: time picker
  - Reason: required text field (e.g., "Forgot to punch, left at 11pm per supervisor")
         ↓
Saves → punch_corrections audit log created
      → punch_logs entry added/updated (source = 'manual')
      → daily_attendance recalculated automatically
      → payroll_period recalculated automatically (if exists)
      → Toast notification: "Attendance recalculated for Carlos, Apr 13"
```

---

## 4. Next.js Project Structure

```
timeflow/
├── app/
│   ├── layout.tsx                    # Root layout with sidebar nav
│   ├── page.tsx                      # Dashboard (redirect to /dashboard)
│   ├── dashboard/
│   │   └── page.tsx                  # KPI cards, charts, today's activity
│   ├── attendance/
│   │   └── page.tsx                  # Attendance log with date range filter
│   ├── schedules/
│   │   ├── page.tsx                  # Schedule list by group & week
│   │   └── [weekStart]/
│   │       └── [groupId]/
│   │           └── page.tsx          # Schedule editor (drag & drop shifts)
│   ├── employees/
│   │   ├── page.tsx                  # Employee grid with group filter
│   │   └── [id]/
│   │       └── page.tsx              # Individual attendance history
│   ├── payroll/
│   │   └── page.tsx                  # Pay period summary + export
│   ├── settings/
│   │   └── page.tsx                  # BioTime connection, holidays config
│   └── api/
│       ├── biotime/
│       │   ├── sync/route.ts         # Trigger sync (employees + transactions)
│       │   ├── employees/route.ts    # Proxy to BioTime employee API
│       │   └── transactions/route.ts # Proxy to BioTime transaction API
│       ├── employees/route.ts        # CRUD local employees
│       ├── schedules/route.ts        # CRUD weekly schedules
│       ├── shifts/route.ts           # CRUD individual shifts
│       ├── punches/
│       │   ├── route.ts              # Add manual punch entry
│       │   ├── [id]/route.ts         # Edit existing punch time
│       │   └── corrections/route.ts  # Get audit log of corrections
│       ├── attendance/
│       │   ├── route.ts              # Get/calculate attendance
│       │   └── recalculate/route.ts  # Reprocess attendance for date range
│       ├── payroll/
│       │   ├── route.ts              # Get payroll summary
│       │   └── export/route.ts       # Export to Excel
│       └── settings/route.ts         # App settings
│
├── lib/
│   ├── biotime-client.ts             # BioTime API wrapper (server-side only)
│   ├── colombian-labor.ts            # Surcharge calculation engine
│   ├── attendance-engine.ts          # Core attendance processor
│   ├── holidays.ts                   # Colombian holidays by year
│   ├── db.ts                         # Drizzle ORM connection + client
│   └── utils.ts                      # Date helpers, time parsing
│
├── components/
│   ├── layout/
│   │   ├── Sidebar.tsx
│   │   └── Header.tsx
│   ├── dashboard/
│   │   ├── KPICards.tsx
│   │   ├── AttendanceChart.tsx
│   │   └── TodayActivity.tsx
│   ├── schedules/
│   │   ├── WeekSelector.tsx
│   │   ├── GroupTabs.tsx
│   │   ├── ShiftGrid.tsx             # Weekly grid editor
│   │   └── ShiftModal.tsx            # Add/edit a single shift
│   ├── attendance/
│   │   ├── AttendanceTable.tsx
│   │   ├── DayBreakdown.tsx
│   │   ├── PunchCorrectionModal.tsx  # Add/edit clock-in/out with reason
│   │   ├── MissingPunchAlert.tsx     # Banner for incomplete punch records
│   │   └── CorrectionLog.tsx         # Audit trail viewer
│   ├── payroll/
│   │   ├── PayrollSummary.tsx
│   │   └── SurchargeBreakdown.tsx
│   └── ui/                           # Shared components (badges, buttons, etc.)
│
├── drizzle/
│   ├── schema.ts                     # Drizzle table definitions
│   └── migrations/                   # Auto-generated SQL migration files
│
└── package.json
```

### 4.1 Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 14+ (App Router) | Full-stack, SSR, API routes |
| Database | PostgreSQL (Railway) | Managed, zero-config, included in plan |
| ORM | Drizzle ORM | Type-safe, SQL-like syntax, lightweight, plain SQL migrations |
| Styling | Tailwind CSS | Fast, consistent, customizable |
| Charts | Recharts | React-native, lightweight |
| Tables | TanStack Table | Sorting, filtering, pagination |
| Export | ExcelJS | Generate .xlsx for Siigo + readable summaries |
| Cron/Sync | Railway Cron | Triggers API route every 10 min for BioTime sync |
| Auth | NextAuth v5 (credentials + DB sessions) | Admin login with instant revocation |
| Hosting | Railway ($5-8/mo) | App + DB + cron in one platform, GitHub deploy |
| BioTime Tunnel | Cloudflare Tunnel (free) | HTTPS + hides BioTime public IP |

### 4.2 Deployment Architecture

```
┌─────────────────────────────────────────────────┐
│  RAILWAY (cloud)                                │
│                                                 │
│  ┌──────────────┐    ┌──────────────────────┐   │
│  │  PostgreSQL   │◄──│  Next.js App          │   │
│  │  (managed)    │   │  - Dashboard UI       │   │
│  └──────────────┘    │  - API routes         │   │
│                      │  - Calculation engine  │   │
│                      └──────────┬─────────────┘   │
│                                 │                 │
│  ┌──────────────┐               │                 │
│  │ Railway Cron  │──triggers────┘                 │
│  │ (every 10min) │  POST /api/biotime/sync        │
│  └──────────────┘                                 │
└─────────────────────────────────┬─────────────────┘
                                  │ HTTPS
                                  ▼
                    ┌──────────────────────────┐
                    │  CLOUDFLARE TUNNEL        │
                    │  biotime.yourdomain.com   │
                    │  (HTTPS ─► HTTP locally)  │
                    └──────────────┬───────────┘
                                  │ HTTP (local)
                                  ▼
                    ┌──────────────────────────┐
                    │  BIOTIME SERVER           │
                    │  Restaurant LAN           │
                    │  127.0.0.1:8090           │
                    └──────────────────────────┘
```

**How it works:**
1. Cloudflare Tunnel runs on the BioTime Windows server as a lightweight service
2. It creates a secure HTTPS endpoint (e.g., `biotime.yourdomain.com`) that
   routes to `127.0.0.1:8090` internally — no port forwarding needed
3. The Railway-hosted Next.js app calls `https://biotime.yourdomain.com/...`
   for all BioTime API requests — encrypted end-to-end
4. The public IP and port 8090 can then be firewalled off entirely

---

## 5. BioTime Integration Flow

### 5.0 Cloudflare Tunnel Setup (one-time, on BioTime Windows server)

```
1. Create a free Cloudflare account + add your domain
2. Install cloudflared on the BioTime Windows server:
     winget install cloudflare.cloudflared
3. Authenticate:
     cloudflared tunnel login
4. Create a tunnel:
     cloudflared tunnel create biotime
5. Configure route (in config.yml):
     tunnel: <tunnel-id>
     ingress:
       - hostname: biotime.yourdomain.com
         service: http://127.0.0.1:8090
       - service: http_status:404
6. Route DNS:
     cloudflared tunnel route dns biotime biotime.yourdomain.com
7. Install as Windows service (runs on startup):
     cloudflared service install
     
Result: https://biotime.yourdomain.com → securely routes to local BioTime
        Public IP port 8090 can now be firewalled off
```

### 5.1 Connection (one-time setup in TimeFlow Settings page)

```
Admin enters:
  - BioTime URL: https://biotime.yourdomain.com (Cloudflare Tunnel URL)
  - Username: admin
  - Password: ********
         ↓
POST https://biotime.yourdomain.com/jwt-api-token-auth/
         ↓
Receive JWT token → store encrypted in settings table
         ↓
Test connection: GET https://biotime.yourdomain.com/iclock/api/terminals/
         ↓
If success → mark as connected
```

### 5.2 Employee Sync

```
GET {url}/personnel/api/employees/?page_size=100
         ↓
For each BioTime employee:
  - If emp_code exists locally → update name, department
  - If new → create local record (unassigned group, no salary)
  - Admin then assigns group + salary manually
```

### 5.3 Transaction Sync (Railway Cron, every 10 minutes)

```
Railway Cron triggers: POST /api/biotime/sync (every 10 min)
         ↓
GET {url}/iclock/api/transactions/
    ?start_time={last_sync_time}
    &end_time={now}
    &page_size=5000
         ↓
For each transaction:
  - Check if biotime_id already exists in punch_logs
  - If new → insert into punch_logs
         ↓
Trigger attendance recalculation for affected dates
```

### 5.4 Important BioTime API Details

- **Pagination:** API returns paginated results. Use `page` and `page_size` params. Check `next` field for more pages.
- **Auth header:** `Authorization: JWT {token}` or `Authorization: Token {token}`
- **Transaction fields we use:** `emp_code`, `punch_time`, `punch_state` (0=in, 1=out), `terminal_sn`
- **Rate limiting:** No documented rate limits, but batch requests sensibly
- **Token refresh:** JWT tokens expire. Catch 401 errors and re-authenticate automatically.

---

## 6. Schedule Management UI

### 6.1 Workflow

```
Manager opens Schedules page
         ↓
Selects: Week (Mon–Sun date picker) + Group (Kitchen/Servers/Bar/Admin)
         ↓
Sees a 7-column grid (Mon→Sun), rows = employees in that group
         ↓
Clicks a cell → Shift Modal opens:
  - Start time (time picker)
  - End time (time picker)
  - Break minutes (number input)
  - Split shift toggle:
      If enabled → second start/end time pair appears
  - "Crosses midnight" auto-detected from times
         ↓
Saves → shift row created in DB
         ↓
Can copy previous week's schedule as starting point (optional convenience)
```

### 6.2 Schedule Grid Visual

```
              Mon 4/13   Tue 4/14   Wed 4/15   Thu 4/16   Fri 4/17   Sat 4/18   Sun 4/19
Carlos R.    [8-17]     [8-17]     [COMP 🔄]  [OFF]      [8-17]     [8-14]     [OFF]
Valentina O. [9-18]     [9-18]     [OFF]      [9-18]     [9-18]     [9-14]     [OFF]
Santiago M.  [11-15     [11-15     [11-15     [11-15     [11-15     [11-15     [OFF]
              19-23]     19-23]     19-23]     19-23]     19-23]     19-23]
              ↑ split shift              ↑ comp day off (7h debited from balance)
```

When adding a shift, manager selects from:
- **Regular shift** — time picker for start/end
- **Day off** — no hours, regular rest day
- **Comp day off** — paid day off, debits from comp balance
  Shows: current balance, hours to debit, balance after

### 6.3 Schedule Validations

- Total period hours per employee should not exceed expected hours for the pay period
- Show warning (not error) if it does — it means overtime will be generated
- Flag holiday dates with a different color and 💰 indicator (surcharge applies)
- No more than 2 hours daily overtime allowed (legal limit)
- Comp day off: warn if employee's balance is insufficient to cover the debit

---

## 7. Dashboard Views

### 7.1 Main Dashboard

- **KPI Cards:** Present today, On time, Late, Absent, Total OT hours, Avg daily hours
- **Weekly attendance bar chart** (present vs late per day)
- **Hours distribution pie** (ordinary vs nocturno vs extra vs festivo)
- **Today's activity table** — all employees, clock in/out, status, lateness
- **Period hours tracker** — running total per employee vs expected hours for the current pay period, color-coded:
  - Green: on track (actual ≤ expected)
  - Yellow: approaching expected (within 4h)
  - Red: over expected (overtime will be generated)
- **Daily excess alerts** — flags employees who worked over their daily limit today, so the manager can adjust upcoming shifts to compensate before the week ends
- **Missing punch alerts** — flags employees with only a clock-in or only a clock-out, with a quick-action button to add the missing punch directly from the dashboard
- **Comp balance overview** — shows each employee's banked compensatory hours, highlighting anyone with a significant balance that should be scheduled off

### 7.2 Attendance Page

- Date range filter (default: current week)
- Group filter tabs
- Per-employee rows: date, in, out, worked, late, OT, surcharge breakdown
- Manual correction indicator: ✏️ icon on any punch that was manually added/edited
- Click any clock-in/out cell to open the PunchCorrectionModal
- Click to expand → minute-by-minute classification with color coding:
  - Blue = ordinary diurno
  - Indigo = nocturno
  - Orange = extra
  - Red = festivo
- Correction log link: view full audit trail for any employee/date

### 7.3 Payroll Page

- Period selector: manager inputs custom start and end dates (e.g., Mar 28 – Apr 12)
- Create new period or select existing draft/finalized period
- Summary table per employee:
  - Base salary (proportional to period)
  - Hours breakdown: ordinary diurno, nocturno, festivo day, festivo night
  - Overtime earned (total HED + HEN before comp)
  - **Comp action per employee:** manager inputs how many OT hours to bank
    → remaining hours auto-calculated as paid
  - Overtime paid (after comp deduction) — this goes to Siigo
  - Recargo costs (RN, RF, RFN)
  - Total surcharges
  - Comp balance: start → credited → debited → end
  - Late minutes total
- **Export to Excel button** — generates both Siigo-ready and readable files
- **Lock period button** — finalizes comp decisions, prevents further changes

---

## 8. Punch Model & Business Day Logic

### 8.1 Single Punch-In / Punch-Out

Employees punch **once at arrival** and **once at departure**. There are NO intermediate punches for:
- Lunch breaks
- Turno partido (split shift) gaps

The **schedule** defines unpaid time, not the punches. The engine works like this:

```
Example: Turno partido scheduled 12:00–4:00pm / 6:00–10:00pm

  Punch IN:  12:02 PM
  Punch OUT: 10:15 PM
  
  Total elapsed:  10h 13m
  Scheduled gap:  2h 00m (4:00pm → 6:00pm, from schedule)
  Scheduled break: 0m (no break within each segment)
  ─────────────────────────
  Worked time:    8h 13m
```

### 8.2 Business Day Boundary: 6:00 AM

A "work day" runs from **6:00 AM to 5:59 AM the next calendar day**. Any shift is attributed to the calendar date on which it **started**.

```
Example: Employee punches in Monday 5:00 PM, out Tuesday 3:00 AM
  → This is "Monday's shift" in all reports and tables
  → Total worked: 10 hours (minus scheduled breaks)
```

This aligns naturally with the legal nocturna boundary (7PM–6AM).

### 8.3 Surcharge Splitting at Calendar Midnight

Although the shift is stored as ONE record on the starting date, the **surcharge calculation must split at calendar midnight** when a holiday boundary is crossed:

```
Example: Dec 24 (regular) shift 5:00 PM → Dec 25 (Navidad, festivo) 3:00 AM

  Segment 1 (Dec 24):  5:00 PM → 12:00 AM = 7 hours
    - 5:00–7:00 PM: 2h ordinary diurno (no surcharge)
    - 7:00 PM–12:00 AM: 5h recargo nocturno (RN, +35%)

  Segment 2 (Dec 25, festivo):  12:00 AM → 3:00 AM = 3 hours
    - 12:00–3:00 AM: 3h festivo nocturno (RFN, +80% + 35% = +115%)
    
  The shift displays as "Dec 24" but correctly applies festivo surcharges
  to the post-midnight hours that fall on Dec 25.

Example: Regular Saturday shift 5:00 PM → Regular Sunday 3:00 AM

  ALL 10 hours are treated the same — Sunday has NO dominical surcharge.
    - 5:00–7:00 PM: 2h ordinary diurno (no surcharge)
    - 7:00 PM–3:00 AM: 8h recargo nocturno (RN, +35%)
    
  No midnight split needed — both days are regular days.
```

---

## 9. Recargo vs Hora Extra — Critical Distinction

For employees with **salario fijo mensual**, the monthly salary already covers all ordinary hours. This creates two different payment models:

### 9.1 Recargos (ordinary hours in special conditions)

The hours are already PAID via the salary. You only pay the **surcharge percentage** as an additional amount.

| Type | Additional Payment | Factor |
|---|---|---|
| Recargo nocturno (RN) | hora_ordinaria × 0.35 | ×0.35 |
| Recargo festivo diurno (RF) | hora_ordinaria × 0.80* | ×0.80* |
| Recargo festivo nocturno (RFN) | hora_ordinaria × (0.80 + 0.35)* | ×1.15* |

*Using current rate (until Jun 30 2026). Becomes 0.90 from Jul 1 2026.

Note: Dominical (Sunday) surcharges are NOT applicable — rest days are
designated to days employees don't work. Only the 18 national holidays
trigger festivo surcharges.

### 9.2 Horas Extras (beyond contracted hours)

These hours are NOT included in the salary. You pay the **full hour + surcharge**.

| Type | Payment | Factor |
|---|---|---|
| Extra diurna (HED) | hora_ordinaria × 1.25 | ×1.25 |
| Extra nocturna (HEN) | hora_ordinaria × 1.75 | ×1.75 |

Only two extra types. Overtime on a holiday is still HED or HEN — the
festivo recargo (RF/RFN) already covers the holiday component separately.

### 9.3 Hora Ordinaria Calculation

```
Until July 14, 2026:  hora_ordinaria = monthly_salary ÷ 220
From July 15, 2026:   hora_ordinaria = monthly_salary ÷ 210
```

---

## 10. Siigo Nube (Pro/Plus) Export

### 10.1 Two Export Files

The system will generate TWO Excel files per quincena:

**File 1: Siigo-Ready Import (`novedades_siigo_YYYY_QN.xlsx`)**

Matches Siigo Nube's novedades Excel upload format:

| Column | Description | Example |
|---|---|---|
| Identificación | Employee cédula or NIT | 1017234567 |
| Concepto | Siigo concept code | HED |
| Horas | Number of hours | 4.5 |
| Valor | Calculated value (optional, Siigo can auto-calc) | 45,000 |

Siigo nómina electrónica concept groups used:
- **005**: Hora extra diurna (HED)
- **006**: Hora extra nocturna (HEN)
- **009**: Recargo nocturno (RN)
- **010**: Recargo festivo diurno (RF)
- **011**: Recargo festivo nocturno (RFN)

Groups 007 and 008 (extra diurna/nocturna festiva) are NOT used — overtime
on holidays is reported as regular HED/HEN, with the festivo component
covered by recargo groups 010/011. Exact concept codes must be configured
to match the user's Siigo instance via Settings.

IMPORTANT: Only PAID overtime goes to the Siigo export. Hours banked as
compensatory time are excluded — they appear in the readable summary but
NOT in the Siigo novedades file. Recargos (RN, RF, RFN) are always
exported regardless of comp decisions, since they're separate from overtime.

**File 2: Readable Summary (`resumen_nomina_YYYY_QN.xlsx`)**

Human-readable payroll summary with:
- Sheet 1: Summary per employee (all surcharge totals, worked hours, lateness)
- Sheet 2: Daily detail per employee (date, in, out, worked, late, each surcharge bucket)
- Sheet 3: Cost breakdown (hora ordinaria value, each surcharge type × hours × factor = cost)
- Sheet 4: Holiday tracking (festivos worked per employee, compensatory days if applicable)
- Sheet 5: Comp time ledger (balance brought forward, OT banked, comp days taken, balance carried forward per employee)

---

## 11. Assumptions — CONFIRMED

| Item | Decision |
|---|---|
| Employee–group relationship | One employee → one group |
| Break handling | Unpaid, defined per shift in schedule (not by punches) |
| Split shift gaps | Defined by schedule, not by intermediate punches |
| Punch model | First punch = IN, last punch = OUT for the business day |
| Business day boundary | 6:00 AM (shift attributed to date it started) |
| Pay period dates | Custom start/end set by manager (roughly biweekly, flexible) |
| Overtime boundary | Per pay period — NOT weekly. Expected = sum of daily limits for scheduled days |
| Surcharge splitting | At calendar midnight for festivo accuracy |
| Dominical (Sunday) surcharge | NOT applied — rest days designated to off-days |
| Festivo (holiday) surcharge | Applied on the 18 national holidays |
| Rest day | Stored per employee for legal compliance |
| Compensatory days | System tracks festivo compensatory only |
| Export | Siigo Nube-ready Excel + readable summary Excel |
| Database | PostgreSQL (managed by Railway) |
| Hosting | Railway (~$5-8/mo, app + DB + cron) |
| BioTime security | Cloudflare Tunnel (free, HTTPS, hides public IP) |
| Auth | NextAuth + DB sessions, instant revocation by disabling user |
| Holiday management | Pre-loaded 2026, admin can add/remove |
| Recargo vs Extra | Correctly separated for Siigo concept mapping |
| Overtime rounding | Floor to 15-min blocks at both daily and period level |
| Clock-in rule | Pay from max(scheduled_start, actual_arrival) |
| Clock-out rule | Before sched: exact; After sched: floor 15-min on excess |
| Overtime cost optimization | Cheapest excess bucket consumed first |
| Comp time (tiempo compensatorio) | Manager decides per employee how many OT hours to bank vs pay |
| Comp balance | Signed: positive = owed to employee, negative = employee owes company |
| Comp balance expiration | No expiration — carries indefinitely |
| Comp day debit | Full scheduled hours for that day (typically 7h), can go negative |
| Comp day and period hours | Comp day = 0 actual hours worked, does not inflate period total |
| Time owed offset | Negative balance auto-offsets against future OT before banking/payment |

---

## 12. Implementation Phases

### Phase 1 — Foundation (Week 1–2)
- Cloudflare Tunnel setup on BioTime Windows server
- Railway project setup: Next.js app + PostgreSQL service
- Drizzle ORM schema + migrations + seed with groups
- Docker Compose for local development (PostgreSQL container)
- BioTime API client (auth, employees, transactions) via Cloudflare Tunnel
- Railway Cron job for auto-sync (every 10 min)
- Basic admin auth (NextAuth credentials + database sessions, instant revocation)
- GitHub repo + Railway auto-deploy from main branch

### Phase 2 — Schedules (Week 2–3)
- Group management (Kitchen, Servers, Bar, Admin)
- Weekly schedule editor with shift grid (Mon–Sun)
- Split shift (turno partido) and midnight-crossing support
- Copy-previous-week convenience feature
- Schedule validation warnings (period hour limits, OT flags)

### Phase 3 — Calculation Engine (Week 3–4)
- Colombian labor law module with all surcharges (date-aware for Jul 2026 transitions)
- 6AM business day boundary logic
- Midnight surcharge splitting (festivo accuracy)
- Attendance processor: punch logs + schedule → daily_attendance
- Weekly hour accumulator for overtime detection
- Holiday tracking and festivo surcharge application
- Recargo vs hora extra separation

### Phase 4 — Dashboard & Reporting (Week 4–5)
- Dashboard with KPIs and charts
- Attendance log with drill-down by employee/day
- Payroll pay period summary with surcharge breakdown

### Phase 5 — Siigo Export & Polish (Week 5–6)
- Siigo Nube-ready novedades Excel (mapped to concept groups 005, 006, 009, 010, 011)
- Readable summary Excel (5-sheet workbook)
- Concept code mapping UI in Settings
- Edge cases (missing punches, manual clock-out corrections)
- Alert system (approaching OT limit, chronic lateness)
- Mobile-responsive layout

### Phase 6 — Testing & Validation (Week 6–7)
- Pull historical punch data from BioTime (1-2 weeks)
- Create test schedules for 2-3 employees against real punches
- Create test payroll periods (marked as 'test', non-exportable)
- Manually verify each calculation:
  - Punch normalization (clock-in cap, clock-out 15-min floor)
  - Recargos (nocturno, festivo day, festivo night)
  - Overtime (period expected vs actual, cheapest-first, 15-min floor)
  - Comp time (banking, debiting, time owed offset)
  - Siigo export output (correct concept groups, hours, values)
- Fix any discrepancies, iterate until math matches expectations
- Delete test periods, go live with real data

---

## 13. Key Risks

| Risk | Mitigation |
|---|---|
| BioTime API token expiration | Auto-refresh on 401 with stored credentials |
| Missing punch (employee forgot to clock out) | Flag as "incomplete" — admin can manually set clock-out |
| Split shift detection from raw punches | Match punches to scheduled shift segments by proximity |
| Law changes (surcharge % updates) | Centralized config in `colombian-labor.ts` with date-based rules |
| Jornada change (44→42h on Jul 15, 2026) | Date-aware hourly rate calculation — already built into engine |
| Cloudflare Tunnel goes down | BioTime sync fails gracefully, resumes on reconnect, dashboard shows "last sync" timestamp so manager knows data may be stale |
| BioTime server offline (power, internet) | Same as above — sync catches up automatically when connection restores |
| Railway cron misses a run | Each sync uses `last_sync_time` from settings, so it always picks up from where it left off — no data loss |
