# Phase 6 — Testing & Validation (Detailed Specification)

## Overview

Validate the entire system against real BioTime data before going live. Pull 1-2 weeks of historical punches, create test schedules for 2-3 employees, run the calculation engine, and manually verify every number — recargos, overtime, punch normalization, comp time, and Siigo export output. Fix any discrepancies, then clean up test data and go live.

---

## Goals

1. Confirm punch sync pulls all data correctly from BioTime
2. Confirm punch resolver assigns punches to correct business days
3. Confirm punch normalization rules (clock-in cap, clock-out 15-min floor)
4. Confirm minute classification (ordinary, nocturno, festivo day, festivo night)
5. Confirm daily excess pool tagging (HED vs HEN from tail-end of shift)
6. Confirm period reconciliation (expected vs actual, 15-min floor, cheapest-first)
7. Confirm comp time ledger (banking, debiting, time owed, offset)
8. Confirm Siigo export output matches expected values
9. Confirm readable summary Excel has correct data on all 5 sheets
10. Identify and fix any edge cases unique to this restaurant's operations

---

## Prerequisites

Before starting Phase 6, all of the following must be working:

- [ ] BioTime connection via Cloudflare Tunnel
- [ ] Transaction sync (manual + cron)
- [ ] Employee sync
- [ ] Schedule editor (create shifts for past weeks)
- [ ] Calculation engine (all 4 layers)
- [ ] Payroll period creation + reconciliation
- [ ] Siigo export generation
- [ ] Summary export generation

---

## Step-by-Step Process

### Step 1: Pull Historical Data

**1.1 Initial full sync**

Trigger a full BioTime sync with no `last_sync_time` filter. This pulls ALL historical transactions.

```
POST /api/biotime/sync
```

Monitor progress. For a restaurant with 15-30 employees and 2-3 months of data, expect 5,000-15,000 transaction records. This should complete in under 2 minutes.

**1.2 Verify transaction count**

After sync, verify the data matches BioTime:

```sql
-- Total transactions synced
SELECT COUNT(*) FROM punch_logs WHERE source = 'biotime';

-- Transactions per employee
SELECT emp_code, COUNT(*) as punch_count,
       MIN(punch_time) as earliest,
       MAX(punch_time) as latest
FROM punch_logs
GROUP BY emp_code
ORDER BY emp_code;

-- Date range covered
SELECT MIN(punch_time) as first_punch, MAX(punch_time) as last_punch
FROM punch_logs;
```

Compare the total count against BioTime's own transaction report (BioTime → Reports → Transaction). They should match.

**1.3 Verify employee sync**

```sql
-- All employees
SELECT id, emp_code, first_name, last_name, group_id, monthly_salary, cedula
FROM employees
ORDER BY emp_code;
```

Confirm:
- All active employees from BioTime are present
- Employee names match BioTime
- Identify 2-3 employees to use for testing (ideally pick employees with varied schedules — one day shift, one night shift, one split shift if possible)

**1.4 Set up test employees**

For the 2-3 selected employees, fill in the required fields that BioTime doesn't provide:

```sql
-- Example: set group, salary, cédula, rest day
UPDATE employees SET
  group_id = 1,              -- Kitchen
  monthly_salary = 2000000,  -- $2,000,000 COP
  cedula = '1017234567',
  rest_day = 1               -- Tuesday (0=Mon..6=Sun)
WHERE emp_code = '1001';

UPDATE employees SET
  group_id = 3,              -- Bar
  monthly_salary = 1800000,
  cedula = '1023456789',
  rest_day = 2               -- Wednesday
WHERE emp_code = '1002';

UPDATE employees SET
  group_id = 2,              -- Servers
  monthly_salary = 1900000,
  cedula = '1034567890',
  rest_day = 0               -- Monday
WHERE emp_code = '1003';
```

Or do this through the UI: Employees → click employee → Edit → fill in fields.

---

### Step 2: Select Test Period

**2.1 Choose a 1-week date range from the historical data**

Pick a week where the test employees have consistent punch data. Ideally:
- A full Mon-Sun week (7 days)
- All 2-3 test employees have punches for most days
- At least one day with a late arrival
- At least one day with overtime (stayed past schedule)
- Bonus: if the week includes a holiday (festivo), that tests recargo classification

**2.2 Examine the raw punches for that week**

```sql
-- See all punches for test employees during the test week
SELECT pl.emp_code, e.first_name, e.last_name,
       pl.punch_time, pl.punch_state, pl.terminal_sn
FROM punch_logs pl
JOIN employees e ON e.emp_code = pl.emp_code
WHERE pl.emp_code IN ('1001', '1002', '1003')
  AND pl.punch_time >= '2026-04-06 06:00:00'
  AND pl.punch_time < '2026-04-13 06:00:00'
ORDER BY pl.emp_code, pl.punch_time;
```

**2.3 Document the raw data**

Create a spreadsheet or document with the raw punches. This is your "source of truth" for manual verification.

```
Employee    | Date     | Punch In   | Punch Out  | Notes
Carlos R.   | Apr 6    | 7:55 AM    | 5:12 PM    | Early arrival, stayed 12 min past
Carlos R.   | Apr 7    | 8:22 AM    | 5:00 PM    | 22 min late
Carlos R.   | Apr 8    | 10:00 AM   | 5:15 PM    | Exact, 15 min past
...
Valentina O.| Apr 6    | 4:55 PM    | 1:10 AM    | Night shift
...
```

---

### Step 3: Create Test Schedules

**3.1 Build schedules for the test week**

Using the Schedule Editor (built in Phase 2), create a weekly schedule for each test employee's group for the test week.

Assign shifts that are realistic for the restaurant. Examples:

**Employee 1 — Carlos (Kitchen, day shift):**
```
Mon: 8:00 AM - 3:00 PM (7h, daily limit 7h)
Tue: OFF (rest day)
Wed: 8:00 AM - 3:00 PM
Thu: 8:00 AM - 3:00 PM
Fri: 8:00 AM - 4:00 PM (8h, daily limit 8h)
Sat: 8:00 AM - 4:00 PM
Sun: 8:00 AM - 3:00 PM
```

**Employee 2 — Valentina (Bar, night shift):**
```
Mon: 5:00 PM - 12:00 AM (7h, crosses midnight)
Tue: 5:00 PM - 12:00 AM
Wed: OFF (rest day)
Thu: 5:00 PM - 12:00 AM
Fri: 5:00 PM - 1:00 AM (8h, crosses midnight)
Sat: 5:00 PM - 1:00 AM
Sun: 5:00 PM - 12:00 AM
```

**Employee 3 — Andrés (Servers, split shift):**
```
Mon: OFF (rest day)
Tue: 12:00 PM - 4:00 PM / 6:00 PM - 10:00 PM (8h, turno partido)
Wed: 12:00 PM - 4:00 PM / 6:00 PM - 10:00 PM
Thu: 12:00 PM - 4:00 PM / 6:00 PM - 10:00 PM
Fri: 12:00 PM - 4:00 PM / 6:00 PM - 10:00 PM
Sat: 12:00 PM - 4:00 PM / 6:00 PM - 10:00 PM
Sun: 12:00 PM - 4:00 PM / 6:00 PM - 10:00 PM
```

**3.2 Document the expected schedule**

Write down each employee's expected hours for the week:

```
Employee    | Days Scheduled | Expected Hours
Carlos R.   | 6 days         | 5×7h + 1×8h... wait, depends on day-of-week:
              Mon(7h) + Wed(7h) + Thu(7h) + Fri(8h) + Sat(8h) + Sun(7h) = 44h
Valentina O.| 6 days         | Mon(7h) + Tue(7h) + Thu(7h) + Fri(8h) + Sat(8h) + Sun(7h) = 44h
Andrés G.   | 6 days         | Tue(7h) + Wed(7h) + Thu(7h) + Fri(8h) + Sat(8h) + Sun(7h) = 44h
```

---

### Step 4: Run Daily Calculations

**4.1 Trigger calculation for the test period**

```
POST /api/attendance/calculate
{
  "employeeId": 1,         // Carlos
  "startDate": "2026-04-06",
  "endDate": "2026-04-12"
}
```

Repeat for employees 2 and 3.

Or calculate all at once if the API supports it:
```
POST /api/attendance/calculate
{
  "startDate": "2026-04-06",
  "endDate": "2026-04-12"
}
```

**4.2 Verify each daily_attendance record**

For EACH employee and EACH day, verify the following against your manual calculations:

```sql
SELECT
  e.first_name, e.last_name,
  da.work_date,
  da.clock_in, da.clock_out,
  da.effective_in, da.effective_out,
  da.total_worked_mins,
  da.late_minutes, da.early_leave_mins,
  da.mins_ordinary_day, da.mins_nocturno,
  da.mins_festivo_day, da.mins_festivo_night,
  da.excess_hed_mins, da.excess_hen_mins,
  da.daily_limit_mins,
  da.day_type, da.status,
  da.is_missing_punch
FROM daily_attendance da
JOIN employees e ON e.id = da.employee_id
WHERE da.employee_id IN (1, 2, 3)
  AND da.work_date >= '2026-04-06'
  AND da.work_date <= '2026-04-12'
ORDER BY da.employee_id, da.work_date;
```

---

### Step 5: Manual Verification Worksheets

For each employee, create a verification worksheet. Calculate everything by hand and compare against the system.

#### 5.1 Punch Normalization Verification

For each day, verify:

```
┌──────────────────────────────────────────────────────────────────────┐
│ Employee: Carlos Restrepo                                            │
│ Date: Monday, Apr 6                                                  │
│ Schedule: 8:00 AM - 3:00 PM (7h daily limit)                        │
│                                                                      │
│ Raw Punches:                                                         │
│   Clock In:  7:55 AM                                                 │
│   Clock Out: 5:12 PM                                                 │
│                                                                      │
│ CLOCK-IN NORMALIZATION:                                              │
│   Rule: effective_in = max(scheduled_start, actual_arrival)          │
│   max(8:00 AM, 7:55 AM) = 8:00 AM ✓                                │
│   Late minutes: max(0, 7:55 AM - 8:00 AM) = 0 ✓                    │
│                                                                      │
│ CLOCK-OUT NORMALIZATION:                                             │
│   Scheduled end: 3:00 PM                                            │
│   Actual: 5:12 PM (AFTER schedule)                                   │
│   Excess raw: 5:12 PM - 3:00 PM = 132 minutes                      │
│   Excess floored: floor(132 / 15) * 15 = 120 minutes                │
│   effective_out = 3:00 PM + 120 min = 5:00 PM ✓                    │
│                                                                      │
│ System says:                                                         │
│   effective_in = 8:00 AM        ✓ MATCH                             │
│   effective_out = 5:00 PM       ✓ MATCH                             │
│   late_minutes = 0              ✓ MATCH                             │
│   total_worked = 540 min (9h)   ✓ MATCH                             │
└──────────────────────────────────────────────────────────────────────┘
```

#### 5.2 Minute Classification Verification

For each day, verify the 4-bucket classification:

```
┌──────────────────────────────────────────────────────────────────────┐
│ Employee: Carlos Restrepo                                            │
│ Date: Monday, Apr 6                                                  │
│ Effective: 8:00 AM - 5:00 PM (540 min worked)                       │
│ Day type: Regular (not a holiday)                                    │
│                                                                      │
│ TIME SEGMENTS:                                                       │
│   8:00 AM - 5:00 PM = 540 min                                       │
│                                                                      │
│ CLASSIFICATION:                                                      │
│   8:00 AM - 5:00 PM → all within diurno (6AM-7PM)                  │
│   Day type = regular                                                 │
│   → All 540 min → minsOrdinaryDay                                   │
│                                                                      │
│ System says:                                                         │
│   minsOrdinaryDay = 540     ✓ MATCH                                 │
│   minsNocturno = 0          ✓ MATCH                                 │
│   minsFestivoDay = 0        ✓ MATCH                                 │
│   minsFestivoNight = 0      ✓ MATCH                                 │
│   SUM = 540                 ✓ equals totalWorkedMins                 │
└──────────────────────────────────────────────────────────────────────┘
```

Night shift example:

```
┌──────────────────────────────────────────────────────────────────────┐
│ Employee: Valentina Ospina                                           │
│ Date: Monday, Apr 6                                                  │
│ Schedule: 5:00 PM - 12:00 AM (7h, crosses midnight)                 │
│ Effective: 5:00 PM - 12:00 AM (420 min)                             │
│ Day type: Regular. Apr 7 = Regular.                                  │
│                                                                      │
│ SEGMENTS (split at midnight + nocturno boundary):                    │
│   5:00 PM - 7:00 PM = 120 min → diurno + regular → minsOrdinaryDay │
│   7:00 PM - 12:00 AM = 300 min → nocturno + regular → minsNocturno │
│                                                                      │
│ No midnight split needed (clock out AT midnight, not after)          │
│                                                                      │
│ System says:                                                         │
│   minsOrdinaryDay = 120     ✓ MATCH                                 │
│   minsNocturno = 300        ✓ MATCH                                 │
│   minsFestivoDay = 0        ✓ MATCH                                 │
│   minsFestivoNight = 0      ✓ MATCH                                 │
│   SUM = 420                 ✓ equals totalWorkedMins                 │
└──────────────────────────────────────────────────────────────────────┘
```

#### 5.3 Excess Pool Verification

For each day with excess (worked > daily limit):

```
┌──────────────────────────────────────────────────────────────────────┐
│ Employee: Carlos Restrepo                                            │
│ Date: Monday, Apr 6                                                  │
│ Worked: 540 min. Daily limit: 420 min (Mon = 7h)                    │
│ Excess: 540 - 420 = 120 min                                         │
│                                                                      │
│ TAIL-END CLASSIFICATION:                                             │
│   Last 120 min of shift = 3:00 PM - 5:00 PM                        │
│   3:00-5:00 PM = diurno (before 7 PM)                               │
│   → excessHedMins = 120, excessHenMins = 0                          │
│                                                                      │
│ System says:                                                         │
│   excessHedMins = 120       ✓ MATCH                                 │
│   excessHenMins = 0         ✓ MATCH                                 │
└──────────────────────────────────────────────────────────────────────┘
```

#### 5.4 Invariant Checks

For EVERY daily_attendance record, verify these invariants hold:

```
INVARIANT 1: Minute bucket sum equals total worked
  minsOrdinaryDay + minsNocturno + minsFestivoDay + minsFestivoNight
  == totalWorkedMins

INVARIANT 2: Excess doesn't exceed total excess
  excessHedMins + excessHenMins
  == max(0, totalWorkedMins - dailyLimitMins)

INVARIANT 3: effective_in >= scheduled_start (for non-late arrivals)
  If lateMinutes == 0: effectiveIn == scheduledStart

INVARIANT 4: effective_in == clockIn (for late arrivals)
  If lateMinutes > 0: effectiveIn == clockIn

INVARIANT 5: No negative values
  All minute fields >= 0
```

Run this validation query:

```sql
-- Check invariant 1: minute buckets sum to total
SELECT employee_id, work_date,
  total_worked_mins,
  (mins_ordinary_day + mins_nocturno + mins_festivo_day + mins_festivo_night) as bucket_sum,
  CASE WHEN total_worked_mins != (mins_ordinary_day + mins_nocturno + mins_festivo_day + mins_festivo_night)
    THEN 'MISMATCH' ELSE 'OK' END as check_1
FROM daily_attendance
WHERE employee_id IN (1, 2, 3)
  AND work_date >= '2026-04-06'
  AND work_date <= '2026-04-12'
  AND is_missing_punch = false;

-- Check invariant 2: excess pool equals overage
SELECT employee_id, work_date,
  total_worked_mins, daily_limit_mins,
  (excess_hed_mins + excess_hen_mins) as excess_total,
  GREATEST(0, total_worked_mins - daily_limit_mins) as expected_excess,
  CASE WHEN (excess_hed_mins + excess_hen_mins) != GREATEST(0, total_worked_mins - daily_limit_mins)
    THEN 'MISMATCH' ELSE 'OK' END as check_2
FROM daily_attendance
WHERE employee_id IN (1, 2, 3)
  AND work_date >= '2026-04-06'
  AND work_date <= '2026-04-12'
  AND is_missing_punch = false;
```

---

### Step 6: Create Test Payroll Period

**6.1 Create the period**

```
POST /api/payroll
{
  "periodStart": "2026-04-06",
  "periodEnd": "2026-04-12",
  "status": "test"
}
```

Mark it as `"test"` so it can't be accidentally exported to Siigo.

**6.2 Verify period reconciliation**

For each employee, verify:

```
┌──────────────────────────────────────────────────────────────────────┐
│ PERIOD RECONCILIATION — Carlos Restrepo                              │
│ Period: Apr 6 – Apr 12 (7 calendar days, 6 scheduled)               │
│                                                                      │
│ EXPECTED HOURS:                                                      │
│   Mon(7h) + Wed(7h) + Thu(7h) + Fri(8h) + Sat(8h) + Sun(7h) = 44h │
│   totalExpectedMins = 2640                                           │
│                                                                      │
│ ACTUAL HOURS (sum of daily totalWorkedMins):                         │
│   Mon: 540 + Wed: 420 + Thu: 420 + Fri: 480 + Sat: 510 + Sun: 420  │
│   totalWorkedMins = 2790                                             │
│                                                                      │
│ OVERTIME:                                                            │
│   overtimeRaw = 2790 - 2640 = 150 min                               │
│   overtimeOwed = floorTo15Min(150) = 150 min (2h 30m)               │
│                                                                      │
│ EXCESS POOL (from all daily records):                                │
│   poolHedMins = 120 (Mon) + 30 (Sat) = 150                          │
│   poolHenMins = 0                                                    │
│                                                                      │
│ CHEAPEST-FIRST:                                                      │
│   Need 150 min from pool                                             │
│   HED available: 150. Consume 150 min HED.                          │
│   HEN available: 0. Consume 0 min HEN.                              │
│   otEarnedHedMins = 150                                              │
│   otEarnedHenMins = 0                                                │
│                                                                      │
│ RECARGOS (from daily, always paid):                                  │
│   rnMins = 0 (Carlos works day shift, no nocturno)                   │
│   rfMins = 0 (no holidays in this week)                              │
│   rfnMins = 0                                                        │
│                                                                      │
│ COSTS:                                                               │
│   horaOrdinaria = $2,000,000 / 220 = $9,091                         │
│   rnCost  = 0                                                        │
│   rfCost  = 0                                                        │
│   rfnCost = 0                                                        │
│   hedCost = (150/60) × $9,091 × 1.25 = $28,409                      │
│   henCost = 0                                                        │
│   totalRecargos = $0                                                 │
│   totalExtras = $28,409                                              │
│   totalSurcharges = $28,409                                          │
│                                                                      │
│ System says:                                                         │
│   totalExpectedMins = 2640    ✓ MATCH                                │
│   totalWorkedMins = 2790      ✓ MATCH                                │
│   overtimeOwedMins = 150      ✓ MATCH                                │
│   otEarnedHedMins = 150       ✓ MATCH                                │
│   otEarnedHenMins = 0         ✓ MATCH                                │
│   hedCost = $28,409           ✓ MATCH                                │
│   totalSurcharges = $28,409   ✓ MATCH                                │
└──────────────────────────────────────────────────────────────────────┘
```

**6.3 Verify recargos for night shift employee**

```
┌──────────────────────────────────────────────────────────────────────┐
│ PERIOD RECONCILIATION — Valentina Ospina (night shift)               │
│                                                                      │
│ RECARGOS (sum of daily minsNocturno):                                │
│   Mon: 300 + Tue: 300 + Thu: 300 + Fri: 360 + Sat: 360 + Sun: 300  │
│   rnMins = 1920 min (32h nocturno)                                   │
│                                                                      │
│ RECARGO COST:                                                        │
│   horaOrdinaria = $1,800,000 / 220 = $8,182                         │
│   rnCost = (1920/60) × $8,182 × 0.35 = $91,636                      │
│                                                                      │
│ IMPORTANT: Recargos are paid REGARDLESS of overtime.                 │
│ Even if Valentina has zero overtime, she gets $91,636 in nocturno    │
│ recargos because she WORKED during nocturno hours.                   │
│                                                                      │
│ System says:                                                         │
│   rnMins = 1920               ✓ MATCH                                │
│   rnCost = $91,636            ✓ MATCH                                │
└──────────────────────────────────────────────────────────────────────┘
```

---

### Step 7: Test Comp Time Flow

**7.1 Simulate a comp banking decision**

On the test payroll period, set a bank decision for one employee:

```
PUT /api/payroll/{periodId}/comp-decision
{
  "decisions": [
    { "employeeId": 1, "bankMins": 60 }
  ]
}
```

Verify:
```
Carlos has 150 min OT.
Manager banks 60 min.
Paid OT = 90 min.
Comp balance: 0 + 60 = +60 min.

Check payroll_periods:
  otBankedMins = 60
  hedMins = 90 (proportional from pool)
  compBalanceEnd = 60

Check comp_transactions:
  No transaction yet — comp_transactions are only created on FINALIZE.
```

**7.2 Simulate finalization**

```
POST /api/payroll/{periodId}/finalize
```

Verify:
```
Check comp_transactions:
  type = 'ot_banked'
  employee_id = 1
  minutes = +60
  balance_after = 60

Check payroll_periods:
  status = 'finalized'
  finalized_at = (timestamp)
```

**7.3 Test negative balance offset**

Create a second test period. First, manually create a comp day off for Carlos in the second period to make his balance go negative:

1. In the schedule editor, add a comp_day_off for Carlos on a day in the new period
2. This debits 420 min (7h) from his balance
3. Balance: 60 - 420 = -360 min (owes 6h)

Now create the second test period and run reconciliation. If Carlos earned overtime in this period, verify that the offset happens automatically:

```
compBalanceStart = -360
overtimeOwed = 180 min (example)

owedOffsetMins = min(180, 360) = 180
otAvailableAfterOffset = 0

Carlos earned 3h OT but it ALL goes to clearing his debt.
compBalanceEnd = -360 + 180 = -180 (still owes 3h)
No OT available for banking or payment.
```

---

### Step 8: Test Siigo Export

**8.1 Generate Siigo export**

Finalize the test period (if not already), then:

```
GET /api/payroll/{periodId}/export/siigo
```

Since the period has `status = 'test'`, this should be BLOCKED. Verify:
- API returns 400 or 403 with message "Test periods cannot be exported to Siigo"

**8.2 Change to a non-test period for export testing**

Either create a new non-test period with the same dates, or temporarily change the test period status to 'finalized' in the database for testing purposes. Then generate both exports:

```
GET /api/payroll/{periodId}/export/both
```

**8.3 Verify Siigo file**

Open `novedades_siigo_*.xlsx` and check:

```
EXPECTED ROWS:
  Cédula      | Concepto | Horas | Valor
  1017234567  | HED      | 1.50  | 17,045    ← Carlos, paid diurno extra
  1023456789  | RN       | 32.00 | 91,636    ← Valentina, nocturno recargo
  ...

VERIFY:
  [ ] Only rows where minutes > 0
  [ ] Concept codes match settings (HED, HEN, RN, RF, RFN)
  [ ] Cédula is text format (no leading zero truncation)
  [ ] Hours = minutes / 60, rounded to 2 decimals
  [ ] Valor matches calculated cost
  [ ] Banked comp hours NOT included (only paid OT)
  [ ] Recargos ALWAYS included
```

**8.4 Verify summary file**

Open `resumen_nomina_*.xlsx` and check all 5 sheets:

```
SHEET 1 — Resumen:
  [ ] One row per employee
  [ ] Totals row at bottom
  [ ] All COP values formatted correctly
  [ ] Comp balance start/end are correct

SHEET 2 — Detalle Diario:
  [ ] One row per employee per day
  [ ] Minute buckets sum to totalWorkedMins for each row
  [ ] Holiday days marked with "Sí"
  [ ] Manual corrections marked with "Sí"

SHEET 3 — Costos:
  [ ] Formula column shows the math
  [ ] Factor column shows correct surcharge rates
  [ ] Cost = horaOrdinaria × factor × hours

SHEET 4 — Festivos:
  [ ] Lists only holidays within the period
  [ ] Shows which employees worked each holiday
  [ ] If no holidays: shows "No hubo festivos en este período"

SHEET 5 — Compensatorio:
  [ ] Balance start matches previous period end (or 0 if first period)
  [ ] All movements tracked (offset, credited, debited, owed)
  [ ] Balance end = start + offset + credited - debited - owed
```

---

### Step 9: Edge Case Scenarios

Run through each of these scenarios using the real data or manual punch entries:

#### 9.1 Missing punch

1. Find or create a day where an employee has only a clock-in
2. Verify: `is_missing_punch = true`, `totalWorkedMins = 0`
3. Add a manual clock-out via the UI
4. Verify: record recalculates, `is_missing_punch = false`, all values populated

#### 9.2 Employee arrives early (clock-in before schedule)

1. Find a day where the employee punched in before their scheduled start
2. Verify: `effectiveIn = scheduledStart` (capped), `lateMinutes = 0`

#### 9.3 Clock-out exactly at schedule end

1. Find a day where clock-out matches schedule end exactly
2. Verify: `effectiveOut = scheduledEnd`, `excessHedMins = 0`, `excessHenMins = 0`

#### 9.4 Clock-out 14 minutes after schedule (below 15-min floor)

1. Find or create: clock-out 14 min after schedule
2. Verify: `effectiveOut = scheduledEnd` (14 min discarded)

#### 9.5 Clock-out exactly 15 minutes after schedule

1. Find or create: clock-out exactly 15 min after schedule
2. Verify: `effectiveOut = scheduledEnd + 15 min` (earned)

#### 9.6 Night shift crossing midnight

1. Verify a night shift (e.g., 5 PM - 1 AM)
2. Check: pre-midnight minutes classified by work date, post-midnight by next date
3. If next date is different day type (regular vs holiday), verify correct split

#### 9.7 Zero overtime despite daily excess

1. Create a scenario where one day has excess but period total ≤ expected
2. Verify: `overtimeOwedMins = 0`, excess pool is discarded

#### 9.8 Period with no scheduled days

1. Create a period where the employee has no shifts (all OFF)
2. Verify: `totalExpectedMins = 0`, `overtimeOwedMins = 0`

---

### Step 10: Cleanup and Go Live

**10.1 Delete test data**

```sql
-- Delete test payroll periods
DELETE FROM payroll_periods WHERE status = 'test';

-- Delete test comp transactions linked to test periods
DELETE FROM comp_transactions WHERE source_period_id IN (
  SELECT id FROM payroll_periods WHERE status = 'test'
);

-- Optionally delete test schedules (or keep them if they match reality)
-- Be careful not to delete schedules needed for live operation
```

Or use the UI: Payroll → find test period → Delete (which reverses comp transactions automatically).

**10.2 Verify clean state**

```sql
-- No test periods remain
SELECT COUNT(*) FROM payroll_periods WHERE status = 'test';
-- Should return 0

-- Comp balances are clean
SELECT e.first_name, e.last_name,
  COALESCE(
    (SELECT balance_after FROM comp_transactions 
     WHERE employee_id = e.id ORDER BY created_at DESC LIMIT 1),
    0
  ) as balance
FROM employees e WHERE e.is_active = true;
-- All should be 0 (no real comp activity yet)
```

**10.3 Set up production data**

1. Fill in salary, cédula, rest day, and group for ALL employees (not just test ones)
2. Configure Siigo concept codes in Settings
3. Verify holiday list is correct for current year
4. Create the first real payroll period
5. Start scheduling shifts for the current week

**10.4 Go live checklist**

- [ ] All employees have: group, salary, cédula, rest day
- [ ] BioTime sync is running automatically (check Railway cron logs)
- [ ] Cloudflare Tunnel is running as Windows service
- [ ] Siigo concept codes are configured
- [ ] Holidays for 2026 are loaded and verified
- [ ] Daily limits are correct (7h Sun-Thu, 8h Fri-Sat)
- [ ] First real payroll period is created
- [ ] Current week's schedule is built for all groups
- [ ] Dashboard shows correct data for today
- [ ] Admin user password has been changed from default

---

## Verification Summary Template

Use this template to track all verifications:

```
PHASE 6 VERIFICATION LOG
Date: ___________
Tester: ___________

SYNC VERIFICATION
  Total transactions synced: _____ / Expected: _____     [ ] PASS [ ] FAIL
  Employee count matches BioTime: _____                   [ ] PASS [ ] FAIL

PUNCH NORMALIZATION (per employee, per day)
  Employee: _____________ Days tested: _____
    Clock-in cap:              [ ] PASS [ ] FAIL
    Clock-out 15-min floor:    [ ] PASS [ ] FAIL
    Late minutes:              [ ] PASS [ ] FAIL
    Early leave minutes:       [ ] PASS [ ] FAIL

MINUTE CLASSIFICATION
  Invariant 1 (buckets = total):  [ ] PASS [ ] FAIL
  Invariant 2 (excess = overage): [ ] PASS [ ] FAIL
  Nocturno split at 7 PM:        [ ] PASS [ ] FAIL
  Midnight split for festivos:    [ ] PASS [ ] FAIL  (or N/A)

PERIOD RECONCILIATION
  Expected hours calculation:     [ ] PASS [ ] FAIL
  Overtime 15-min floor:          [ ] PASS [ ] FAIL
  Cheapest-first consumption:     [ ] PASS [ ] FAIL
  Recargo costs:                  [ ] PASS [ ] FAIL
  Overtime costs:                 [ ] PASS [ ] FAIL
  Total surcharges:               [ ] PASS [ ] FAIL

COMP TIME
  Banking creates transaction:    [ ] PASS [ ] FAIL
  Comp day debits balance:        [ ] PASS [ ] FAIL
  Negative balance offset:        [ ] PASS [ ] FAIL  (or N/A)

SIIGO EXPORT
  Correct rows generated:         [ ] PASS [ ] FAIL
  Concept codes match settings:   [ ] PASS [ ] FAIL
  Hours and values correct:       [ ] PASS [ ] FAIL
  Test period export blocked:     [ ] PASS [ ] FAIL

SUMMARY EXPORT
  Sheet 1 (Resumen):              [ ] PASS [ ] FAIL
  Sheet 2 (Detalle Diario):       [ ] PASS [ ] FAIL
  Sheet 3 (Costos):               [ ] PASS [ ] FAIL
  Sheet 4 (Festivos):             [ ] PASS [ ] FAIL
  Sheet 5 (Compensatorio):        [ ] PASS [ ] FAIL

EDGE CASES
  Missing punch:                  [ ] PASS [ ] FAIL
  Early arrival capped:           [ ] PASS [ ] FAIL
  14-min excess discarded:        [ ] PASS [ ] FAIL
  15-min excess earned:           [ ] PASS [ ] FAIL
  Night shift classification:     [ ] PASS [ ] FAIL
  Zero OT despite daily excess:   [ ] PASS [ ] FAIL

OVERALL RESULT: [ ] PASS — ready for production
                [ ] FAIL — issues logged below

ISSUES:
1. ___________________________________________________________
2. ___________________________________________________________
3. ___________________________________________________________
```
