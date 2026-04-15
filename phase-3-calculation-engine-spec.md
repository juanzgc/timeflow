# Phase 3 — Calculation Engine (Detailed Specification)

## Overview

Build the Colombian labor law calculation engine that processes raw punch logs + schedules into fully classified daily attendance records with recargos, excess pools, and period-level overtime reconciliation. This is the most complex and critical phase — every peso on the payroll depends on this math being correct.

---

## Architecture

The engine is split into 4 layers, each building on the previous:

```
Layer 1: Punch Resolver
  Raw punch logs → matched to schedule → clock_in / clock_out per business day

Layer 2: Punch Normalizer  
  clock_in / clock_out → effective_in / effective_out (applying rounding rules)

Layer 3: Daily Classifier
  effective times + schedule → minute-by-minute classification
  → recargos (final), excess pool (provisional), lateness

Layer 4: Period Reconciler
  Sum daily records across pay period → overtime determination
  → cheapest-first consumption → comp offset → final payable amounts
```

---

## Files to Create

```
src/lib/engine/
├── index.ts                    # Main entry point: processDay(), reconcilePeriod()
├── punch-resolver.ts           # Layer 1: Match punches to business days
├── punch-normalizer.ts         # Layer 2: Apply clock-in/out rounding rules
├── daily-classifier.ts         # Layer 3: Classify minutes, calculate recargos
├── period-reconciler.ts        # Layer 4: Period overtime, cheapest-first, comp
├── colombian-labor.ts          # Surcharge rates, date-aware configuration
├── time-utils.ts               # Time math helpers
└── __tests__/
    ├── punch-resolver.test.ts
    ├── punch-normalizer.test.ts
    ├── daily-classifier.test.ts
    ├── period-reconciler.test.ts
    └── scenarios.test.ts       # Full end-to-end scenario tests
```

---

## Layer 1: Punch Resolver (`punch-resolver.ts`)

### Purpose
Take raw punch logs from the database and determine which punches belong to which business day, producing a single clock_in and clock_out per employee per business day.

### Business Day Definition
A business day runs from **6:00 AM to 5:59 AM the next calendar day**. A shift is attributed to the calendar date on which it started.

```
Example timeline:
  6:00 AM Mon ──────────────────────── 5:59 AM Tue = "Monday"
  6:00 AM Tue ──────────────────────── 5:59 AM Wed = "Tuesday"

Employee punches in Mon 5:00 PM, out Tue 3:00 AM → this is "Monday's" shift
Employee punches in Tue 8:00 AM, out Tue 5:00 PM → this is "Tuesday's" shift
```

### Algorithm

```typescript
interface ResolvedPunches {
  employeeId: number;
  empCode: string;
  workDate: Date;           // the business day this belongs to
  clockIn: Date | null;
  clockOut: Date | null;
  isMissingPunch: boolean;  // only one punch found
  allPunches: Date[];       // all raw punches in this window
}

function resolvePunches(
  empCode: string,
  punches: PunchLog[],      // all punches for this employee in date range
  scheduleMap: Map<string, Shift[]>  // schedule keyed by "empCode-dayOfWeek"
): ResolvedPunches[]
```

**Steps:**

1. Sort all punches by punch_time ascending
2. Group punches into business days using the 6AM boundary:
   - For each punch, determine its business day:
     - If punch time is between 6:00 AM and 5:59 AM next day, it belongs to the date at 6:00 AM
     - Specifically: if punch hour >= 6, business day = punch date
     - If punch hour < 6, business day = punch date - 1 day (it's the previous day's shift)
3. For each business day with punches:
   - clock_in = first punch in the business day window
   - clock_out = last punch in the business day window
   - If only one punch exists, set isMissingPunch = true
   - If clock_in equals clock_out (same single punch), set clock_out = null

**Edge cases:**

```
Case: Employee punches at 5:55 AM
  → Hour < 6, so business day = previous day
  → This is the tail end of yesterday's shift

Case: Employee punches at 6:05 AM
  → Hour >= 6, so business day = today
  → This is the start of today's shift

Case: Employee punches in at 10 PM, punches out at 6:05 AM
  → Punch in (10 PM, hour >= 6) → business day = today
  → Punch out (6:05 AM, hour >= 6) → business day = tomorrow
  → These are in DIFFERENT business days!
  → Need schedule context to resolve: if employee is scheduled for
    a midnight-crossing shift today, the 6:05 AM punch belongs to today

Case: Three punches in one business day (e.g., 8:00 AM, 12:30 PM, 5:00 PM)
  → clock_in = 8:00 AM (first)
  → clock_out = 5:00 PM (last)
  → Middle punch ignored (we don't track lunch punches)
```

**Schedule-aware midnight resolution:**

When a punch falls right around 6:00 AM, the resolver checks the employee's schedule:
- If the employee has a midnight-crossing shift scheduled for the previous day (e.g., 10 PM - 6 AM), punches before 6:30 AM are attributed to the previous business day
- The 30-minute grace window (6:00-6:30 AM) handles employees who clock out slightly after 6 AM at the end of a night shift
- This is configurable via settings: `business_day_start_hour` = 6

---

## Layer 2: Punch Normalizer (`punch-normalizer.ts`)

### Purpose
Apply the business rules that convert raw clock-in/out times to payable effective times.

```typescript
interface NormalizedPunches {
  clockIn: Date;              // raw from BioTime/manual
  clockOut: Date | null;      // raw
  effectiveIn: Date;          // after normalization
  effectiveOut: Date | null;  // after normalization
  lateMinutes: number;
  earlyLeaveMinutes: number;
}

function normalizePunches(
  clockIn: Date,
  clockOut: Date | null,
  scheduledStart: string,     // "08:00" - from shift record
  scheduledEnd: string,       // "17:00" - from shift record
  workDate: Date
): NormalizedPunches
```

### Rule 1: Clock-In — pay from the LATER of scheduled start or actual arrival

```
effective_in = max(scheduled_start, actual_clock_in)

Examples (schedule starts at 10:00 AM):
  Punch 9:50 AM  → effective_in = 10:00 AM  (early, capped at schedule)
  Punch 10:00 AM → effective_in = 10:00 AM  (exact)
  Punch 10:05 AM → effective_in = 10:05 AM  (late, use actual)
  Punch 10:22 AM → effective_in = 10:22 AM  (late, use actual)

Late minutes = max(0, actual_clock_in - scheduled_start)
  9:50 → 0 min late
  10:05 → 5 min late
  10:22 → 22 min late
```

### Rule 2: Clock-Out — depends on whether before or after schedule end

**If clock-out is BEFORE or AT scheduled end:**
```
effective_out = actual_clock_out  (exact, no rounding)
early_leave_minutes = scheduled_end - actual_clock_out

Examples (schedule ends at 5:00 PM):
  Punch 4:58 PM → effective_out = 4:58 PM  (2 min early)
  Punch 5:00 PM → effective_out = 5:00 PM  (exact)
```

**If clock-out is AFTER scheduled end:**
```
excess_raw = actual_clock_out - scheduled_end
excess_rounded = floor_to_15min(excess_raw)
effective_out = scheduled_end + excess_rounded

Only full 15-minute blocks beyond the schedule count.

Examples (schedule ends at 5:00 PM):
  Punch 5:05 PM  → 5 min excess  → floor(5)  = 0  → effective = 5:00 PM
  Punch 5:12 PM  → 12 min excess → floor(12) = 0  → effective = 5:00 PM
  Punch 5:14 PM  → 14 min excess → floor(14) = 0  → effective = 5:00 PM
  Punch 5:15 PM  → 15 min excess → floor(15) = 15 → effective = 5:15 PM
  Punch 5:29 PM  → 29 min excess → floor(29) = 15 → effective = 5:15 PM
  Punch 5:30 PM  → 30 min excess → floor(30) = 30 → effective = 5:30 PM
  Punch 6:10 PM  → 70 min excess → floor(70) = 60 → effective = 6:00 PM
```

### Floor-to-15min function:

```typescript
function floorTo15Min(minutes: number): number {
  return Math.floor(minutes / 15) * 15;
}
```

### Split shift handling:

For turno partido (e.g., scheduled 12:00-16:00 / 18:00-22:00):
- The employee only punches ONCE at the start of segment 1 and ONCE at the end of segment 2
- No intermediate punches during the gap
- effective_in = normalized against segment 1's start (12:00)
- effective_out = normalized against segment 2's end (22:00)
- The gap is subtracted from worked time in Layer 3, not here
- Late minutes = calculated against segment 1's start only
- Early leave = calculated against segment 2's end only

```
Example: Schedule 12:00-16:00 / 18:00-22:00
  Punch in: 12:05 PM  → effective_in = 12:05 PM (5 min late vs segment 1 start)
  Punch out: 10:12 PM → effective_out = 10:00 PM (12 min excess, floor = 0)
```

---

## Layer 3: Daily Classifier (`daily-classifier.ts`)

### Purpose
Take effective_in/effective_out + schedule and classify every worked minute into surcharge buckets. Calculate recargos (final) and build the excess pool (provisional).

```typescript
interface DailyClassification {
  // Total worked time
  totalWorkedMins: number;

  // Hour classification (in minutes)
  minsOrdinaryDay: number;    // Regular diurno, no surcharge
  minsNocturno: number;       // 7PM-6AM on regular day, recargo 35%
  minsFestivoDay: number;     // 6AM-7PM on holiday, recargo 80%
  minsFestivoNight: number;   // 7PM-6AM on holiday, recargo 115%

  // Excess pool (provisional — not yet overtime)
  excessHedMins: number;      // Excess diurno minutes
  excessHenMins: number;      // Excess nocturno minutes

  // Day info
  dayType: 'regular' | 'holiday';
  dailyLimitMins: number;     // 420 (7h) or 480 (8h)
}

function classifyDay(
  effectiveIn: Date,
  effectiveOut: Date,
  workDate: Date,
  scheduledGapMins: number,     // turno partido gap to subtract
  scheduledBreakMins: number,   // unpaid break to subtract
  dailyLimitMins: number,       // 420 or 480
  crossesMidnight: boolean
): DailyClassification
```

### Step 1: Calculate total worked minutes

```
elapsed = effectiveOut - effectiveIn (in minutes)
totalWorkedMins = elapsed - scheduledGapMins - scheduledBreakMins
```

Example:
```
effective_in = 12:05 PM, effective_out = 10:00 PM
elapsed = 595 minutes
gap = 120 minutes (2h turno partido gap)
break = 0
totalWorkedMins = 595 - 120 - 0 = 475 minutes (7h 55m)
```

### Step 2: Build a timeline of worked segments

Create a list of time segments the employee actually worked, excluding gaps:

For a regular shift (no split):
```
segments = [(effectiveIn, effectiveOut)]
```

For a turno partido (split shift):
```
Using schedule: segment1 = 12:00-16:00, segment2 = 18:00-22:00
effective_in = 12:05, effective_out = 22:00

segments = [
  (12:05, 16:00),   // segment 1 (adjusted for late arrival)
  (18:00, 22:00)    // segment 2
]
```

The gap between segments (16:00-18:00) is excluded. The segments are derived from the schedule's shift times, not from intermediate punches.

**How to build segments for turno partido:**
- If the shift is a split shift (isSplit=true), get both shift records via splitPairId
- Segment 1: max(effectiveIn, shift1Start) to min(effectiveOut, shift1End)
- Segment 2: max(effectiveIn, shift2Start) to min(effectiveOut, shift2End)
- If effectiveOut is before shift2Start, segment 2 has 0 minutes (employee left during gap)
- If effectiveIn is after shift1End, segment 1 has 0 minutes (employee arrived during gap)

### Step 3: Classify each minute by time-of-day

For each segment, split it at the diurno/nocturno boundaries:
- **Diurno:** 6:00 AM to 7:00 PM
- **Nocturno:** 7:00 PM to 6:00 AM

```
Example: Segment 5:00 PM to 3:00 AM (crosses midnight)

Split at 7:00 PM (nocturno boundary):
  5:00 PM – 7:00 PM = 120 min diurno
  7:00 PM – 3:00 AM = 480 min nocturno

Example: Segment 12:05 PM to 4:00 PM
  All diurno (within 6AM-7PM): 235 min diurno

Example: Segment 10:00 PM to 6:00 AM
  All nocturno (within 7PM-6AM): 480 min nocturno
```

### Step 4: Classify by day type (regular vs holiday)

Check if the work date is a Colombian holiday. Also handle midnight-crossing shifts where post-midnight hours fall on a different calendar date:

**For shifts that do NOT cross midnight:**
- All minutes get the day type of the work date
- If workDate is a holiday → all minutes are festivo

**For shifts that DO cross midnight:**
- Split at calendar midnight (12:00 AM)
- Pre-midnight minutes → day type of workDate
- Post-midnight minutes → day type of workDate + 1 day
- This matters when workDate is regular but the next day is a holiday (or vice versa)

```
Example: Work date = Dec 24 (regular), shift 5:00 PM to 3:00 AM
  Dec 25 is Navidad (holiday)

  Pre-midnight (Dec 24): 5:00 PM – 12:00 AM = 420 min, regular day
    5:00–7:00 PM = 120 min → ordinary diurno (minsOrdinaryDay)
    7:00 PM–12:00 AM = 300 min → nocturno recargo (minsNocturno)

  Post-midnight (Dec 25): 12:00 AM – 3:00 AM = 180 min, holiday
    12:00–3:00 AM = 180 min → festivo nocturno (minsFestivoNight)

Example: Work date = regular Saturday, shift 5:00 PM to 3:00 AM Sunday
  Sunday is a REGULAR day (not a holiday, no dominical surcharge)

  Pre-midnight: 5:00–7:00 PM = 120 min ordinary diurno
                7:00 PM–12:00 AM = 300 min nocturno
  Post-midnight: 12:00–3:00 AM = 180 min nocturno
  
  ALL nocturno (no festivo) — Sunday is just a regular day
```

### Step 5: Combine time-of-day + day type into final buckets

Each minute falls into exactly ONE of these 4 buckets:

| Time of Day | Regular Day | Holiday |
|---|---|---|
| Diurno (6AM-7PM) | `minsOrdinaryDay` (no surcharge) | `minsFestivoDay` (recargo 80%) |
| Nocturno (7PM-6AM) | `minsNocturno` (recargo 35%) | `minsFestivoNight` (recargo 80%+35% = 115%) |

### Step 6: Calculate daily excess pool

```
excessMins = max(0, totalWorkedMins - dailyLimitMins)

If excessMins > 0:
  The excess minutes need to be tagged as diurno or nocturno.
  
  Strategy: excess comes from the END of the work day (the employee
  stayed late, so the extra time is at the tail end of their shift).
  
  Take the last `excessMins` minutes of the shift and classify them:
  - If those minutes were diurno → excessHedMins
  - If those minutes were nocturno → excessHenMins
  - If mixed, split proportionally

If totalWorkedMins <= dailyLimitMins:
  excessHedMins = 0
  excessHenMins = 0
```

**Example:**
```
Schedule: 10:00 AM - 5:00 PM (7h daily limit)
Effective: 10:00 AM - 6:00 PM (8h worked, after 15-min floor)
Excess: 60 min

The excess 60 min = 5:00 PM - 6:00 PM (tail end of shift)
  5:00-6:00 PM is diurno (before 7 PM)
  → excessHedMins = 60, excessHenMins = 0

Schedule: 5:00 PM - 12:00 AM (7h daily limit)
Effective: 5:00 PM - 1:00 AM (8h worked)
Excess: 60 min

The excess 60 min = 12:00 AM - 1:00 AM (tail end of shift)
  12:00-1:00 AM is nocturno (after 7 PM)
  → excessHedMins = 0, excessHenMins = 60

Schedule: 3:00 PM - 10:00 PM (7h daily limit)
Effective: 3:00 PM - 11:30 PM (8.5h worked)
Excess: 90 min

The excess 90 min = 10:00 PM - 11:30 PM (tail end)
  10:00-11:30 PM is nocturno
  → excessHedMins = 0, excessHenMins = 90

Schedule: 12:00 PM - 7:00 PM (7h daily limit)
Effective: 12:00 PM - 8:00 PM (8h worked)
Excess: 60 min

The excess 60 min = 7:00 PM - 8:00 PM (tail end)
  7:00-8:00 PM is nocturno (starts at 7PM)
  → excessHedMins = 0, excessHenMins = 60

Schedule: 10:00 AM - 5:00 PM (7h daily limit)  
Effective: 10:00 AM - 7:30 PM (9.5h worked)
Excess: 150 min

The excess 150 min = 5:00 PM - 7:30 PM (tail end)
  5:00-7:00 PM = 120 min diurno
  7:00-7:30 PM = 30 min nocturno
  → excessHedMins = 120, excessHenMins = 30
```

### Step 7: Write to daily_attendance

All calculated values are written to the `daily_attendance` table for the employee + work_date. This is an upsert — if a record already exists (from a previous calculation), it's updated.

---

## Layer 4: Period Reconciler (`period-reconciler.ts`)

### Purpose
Take all daily_attendance records within a pay period and determine:
- Total expected vs actual hours
- Whether overtime exists (after 15-min floor)
- Which excess hours to pay (cheapest-first)
- Comp time offset (if employee has negative balance)
- Manager's bank vs pay decision
- Final payable amounts for Siigo export

```typescript
interface PeriodReconciliation {
  // Input summary
  totalExpectedMins: number;
  totalWorkedMins: number;
  daysScheduled: number;
  daysWorked: number;
  daysAbsent: number;

  // Recargos (always paid, summed from daily records)
  rnMins: number;         // total nocturno recargo minutes
  rfMins: number;         // total festivo diurno minutes
  rfnMins: number;        // total festivo nocturno minutes
  rnCost: number;
  rfCost: number;
  rfnCost: number;

  // Overtime
  overtimeRawMins: number;     // actual - expected (can be negative)
  overtimeOwedMins: number;    // after floor_to_15min (0 if raw <= 0)
  
  // Excess pool (from all daily records)
  poolHedMins: number;
  poolHenMins: number;

  // Overtime consumed from pool (cheapest-first)
  otEarnedHedMins: number;
  otEarnedHenMins: number;

  // After comp offset
  owedOffsetMins: number;      // OT used to clear negative balance
  otAvailableAfterOffset: number;

  // After manager decision (set later via API)
  otBankedMins: number;
  hedMins: number;             // paid diurno extra
  henMins: number;             // paid nocturno extra
  hedCost: number;
  henCost: number;

  // Comp balance tracking
  compBalanceStart: number;
  compCreditedMins: number;
  compDebitedMins: number;
  compOwedMins: number;
  compOffsetMins: number;
  compBalanceEnd: number;

  // Totals
  totalRecargosCost: number;
  totalExtrasCost: number;
  totalSurcharges: number;

  // Metadata
  horaOrdinariaValue: number;
  totalLateMins: number;
  totalEarlyLeaveMins: number;
  holidaysWorked: number;
}

function reconcilePeriod(
  employeeId: number,
  periodStart: Date,
  periodEnd: Date,
  dailyRecords: DailyAttendance[],
  monthlySalary: number,
  compBalanceStart: number       // from last comp_transaction
): PeriodReconciliation
```

### Step 1: Calculate expected hours

```
For each day in the period (periodStart to periodEnd inclusive):
  Look up the daily_attendance record for this employee + date
  
  If status is 'day-off' or 'comp-day-off' or 'absent' or no record:
    expectedMins += 0 (rest days don't contribute)
  
  If status is 'on-time' or 'late' (employee was scheduled and worked):
    expectedMins += dailyLimitMins (420 or 480 depending on day of week)

daysScheduled = count of days with a schedule (not day-off)
daysWorked = count of days with actual punches
daysAbsent = daysScheduled - daysWorked
```

**Important:** Expected hours are based on days the employee was SCHEDULED to work, not calendar days. If Carlos was scheduled for 12 days in a 16-day period, his expected is based on those 12 days.

### Step 2: Sum actual hours and recargos

```
totalWorkedMins = sum of all daily totalWorkedMins
rnMins = sum of all daily minsNocturno
rfMins = sum of all daily minsFestivoDay
rfnMins = sum of all daily minsFestivoNight
totalLateMins = sum of all daily lateMinutes
totalEarlyLeaveMins = sum of all daily earlyLeaveMins
holidaysWorked = count of days where dayType = 'holiday' and totalWorkedMins > 0
```

### Step 3: Calculate recargo costs

```
horaOrdinariaValue = monthlySalary / monthlyHours
  where monthlyHours:
    Before July 15, 2026: 220
    From July 15, 2026: 210

Determine festivo rate based on period dates:
  Before July 1, 2026: festivoRate = 0.80
  July 1, 2026 – June 30, 2027: festivoRate = 0.90
  From July 1, 2027: festivoRate = 1.00

rnCost = (rnMins / 60) * horaOrdinariaValue * 0.35
rfCost = (rfMins / 60) * horaOrdinariaValue * festivoRate
rfnCost = (rfnMins / 60) * horaOrdinariaValue * (festivoRate + 0.35)

totalRecargosCost = rnCost + rfCost + rfnCost
```

### Step 4: Determine overtime

```
overtimeRawMins = totalWorkedMins - totalExpectedMins

If overtimeRawMins > 0:
  overtimeOwedMins = floorTo15Min(overtimeRawMins)
Else:
  overtimeOwedMins = 0
```

**Example:**
```
Period: Mar 28 – Apr 12 (16 days)
Employee scheduled 12 days: 8 × 7h (Sun-Thu) + 4 × 8h (Fri-Sat) = 88h expected
Employee actually worked: 91h 12min = 5472 min

overtimeRawMins = 5472 - 5280 = 192 min (3h 12m)
overtimeOwedMins = floorTo15Min(192) = 180 min (3h 0m)
```

### Step 5: Consume excess pool (cheapest-first)

```
Collect pool from all daily records:
  poolHedMins = sum of all daily excessHedMins
  poolHenMins = sum of all daily excessHenMins

If overtimeOwedMins > 0:
  // Consume cheapest first: HED (×1.25) before HEN (×1.75)
  
  otEarnedHedMins = min(overtimeOwedMins, poolHedMins)
  remaining = overtimeOwedMins - otEarnedHedMins
  
  otEarnedHenMins = min(remaining, poolHenMins)
  
  // Verify: otEarnedHedMins + otEarnedHenMins should equal overtimeOwedMins
  // If pool is smaller than owed (shouldn't happen normally), cap at pool total
```

**Example:**
```
overtimeOwedMins = 180 (3h)
poolHedMins = 120 (2h of daytime excess across the period)
poolHenMins = 240 (4h of nighttime excess across the period)

Step 1: consume HED first
  otEarnedHedMins = min(180, 120) = 120
  remaining = 180 - 120 = 60

Step 2: consume HEN for remainder
  otEarnedHenMins = min(60, 240) = 60

Result: Pay 120 min HED (×1.25) + 60 min HEN (×1.75)
  Instead of: 180 min all HEN (×1.75)
  Savings: 60 min × (1.75 - 1.25) × horaOrdinaria = significant
```

### Step 6: Comp time offset

```
If compBalanceStart < 0 (employee owes time):
  owedOffsetMins = min(overtimeOwedMins, abs(compBalanceStart))
  otAvailableAfterOffset = overtimeOwedMins - owedOffsetMins
  
  // Create comp_transaction: type='owed_offset', minutes=+owedOffsetMins
  compBalanceAfterOffset = compBalanceStart + owedOffsetMins

Else:
  owedOffsetMins = 0
  otAvailableAfterOffset = overtimeOwedMins
  compBalanceAfterOffset = compBalanceStart
```

**Example:**
```
compBalanceStart = -120 (employee owes 2h)
overtimeOwedMins = 180 (3h earned this period)

owedOffsetMins = min(180, 120) = 120
otAvailableAfterOffset = 180 - 120 = 60 (1h available for bank/pay)
compBalanceAfterOffset = -120 + 120 = 0 (debt cleared)
```

### Step 7: Manager decision (bank vs pay)

This step is NOT automatic — it requires manager input via the payroll UI.
The reconciler prepares the data, and the manager sets `otBankedMins`.

```
// After manager input:
otBankedMins = (manager's choice, 0 to otAvailableAfterOffset)

// Remaining OT is paid
otPaidMins = otAvailableAfterOffset - otBankedMins

// Split paid OT back into HED/HEN proportionally
// Use the same ratio from the earned pool
hedRatio = otEarnedHedMins / (otEarnedHedMins + otEarnedHenMins)
henRatio = 1 - hedRatio

hedMins = round(otPaidMins * hedRatio)
henMins = otPaidMins - hedMins  // remainder to avoid rounding errors

hedCost = (hedMins / 60) * horaOrdinariaValue * 1.25
henCost = (henMins / 60) * horaOrdinariaValue * 1.75

totalExtrasCost = hedCost + henCost

// Comp balance tracking
compCreditedMins = otBankedMins
compDebitedMins = (sum of comp_day_off debits from shifts in this period)
compOwedMins = (any time_owed transactions in this period)
compOffsetMins = owedOffsetMins
compBalanceEnd = compBalanceStart + compOffsetMins + compCreditedMins 
                 - compDebitedMins - compOwedMins
```

### Step 8: Final totals

```
totalSurcharges = totalRecargosCost + totalExtrasCost
```

### Step 9: Write to payroll_periods

Upsert the payroll_periods record with all calculated values. Set status to 'draft' (manager hasn't finalized yet).

---

## Colombian Labor Configuration (`colombian-labor.ts`)

### Date-aware surcharge rates

```typescript
interface SurchargeConfig {
  nocturnoRate: number;           // always 0.35
  festivoRate: number;            // 0.80, 0.90, or 1.00
  extraDiurnaRate: number;        // always 1.25
  extraNocturnaRate: number;      // always 1.75
  monthlyHoursDivisor: number;    // 220 or 210
}

function getSurchargeConfig(date: Date): SurchargeConfig {
  const nocturnoRate = 0.35;  // always
  const extraDiurnaRate = 1.25;  // always
  const extraNocturnaRate = 1.75;  // always

  // Festivo rate (Ley 2466 de 2025, gradual increase)
  let festivoRate: number;
  if (date < new Date('2026-07-01')) {
    festivoRate = 0.80;
  } else if (date < new Date('2027-07-01')) {
    festivoRate = 0.90;
  } else {
    festivoRate = 1.00;
  }

  // Monthly hours divisor (Ley 2101 de 2021, jornada reduction)
  let monthlyHoursDivisor: number;
  if (date < new Date('2026-07-15')) {
    monthlyHoursDivisor = 220;  // 44h/week
  } else {
    monthlyHoursDivisor = 210;  // 42h/week
  }

  return { nocturnoRate, festivoRate, extraDiurnaRate, extraNocturnaRate, monthlyHoursDivisor };
}
```

### Daily limits

```typescript
function getDailyLimitMins(dayOfWeek: number, date: Date): number {
  // dayOfWeek: 0=Monday, 6=Sunday
  
  if (date >= new Date('2026-07-15')) {
    return 420;  // 7h for all days after jornada reduction
  }
  
  // Before July 15, 2026:
  // Fri=4, Sat=5 → 480 min (8h)
  // All others → 420 min (7h)
  if (dayOfWeek === 4 || dayOfWeek === 5) {
    return 480;
  }
  return 420;
}
```

### Time boundaries

```typescript
const DIURNO_START_HOUR = 6;   // 6:00 AM
const DIURNO_END_HOUR = 19;    // 7:00 PM
const NOCTURNO_START_HOUR = 19; // 7:00 PM
const NOCTURNO_END_HOUR = 6;    // 6:00 AM
const BUSINESS_DAY_START_HOUR = 6; // 6:00 AM
```

---

## Time Utilities (`time-utils.ts`)

```typescript
// Parse "HH:MM" string to minutes since midnight
function parseTimeToMinutes(time: string): number
// e.g., "17:30" → 1050

// Convert minutes since midnight to "HH:MM"
function minutesToTime(mins: number): string
// e.g., 1050 → "17:30"

// Floor to nearest 15-minute block
function floorTo15Min(minutes: number): number
// e.g., 14 → 0, 15 → 15, 29 → 15, 30 → 30

// Get the Monday of the week containing the given date
function getMonday(date: Date): Date

// Check if a date is a Colombian holiday
function isHoliday(date: Date): boolean

// Get day of week as 0=Monday..6=Sunday (JS Date uses 0=Sunday)
function getDayOfWeek(date: Date): number
// Converts JS Sunday=0 to our Monday=0 format

// Calculate minutes between two Date objects
function minutesBetween(start: Date, end: Date): number

// Create a Date from a work date + time string
function combineDateAndTime(workDate: Date, time: string): Date
// e.g., (2026-04-14, "17:30") → 2026-04-14T17:30:00

// Add minutes to a Date
function addMinutes(date: Date, minutes: number): Date

// Check if a time is in the nocturno range (7PM-6AM)
function isNocturno(hour: number): boolean
// 19-23, 0-5 → true; 6-18 → false
```

---

## API Routes

### POST /api/attendance/calculate
Triggers calculation for a specific employee and date range.

```json
// Request
{
  "employeeId": 1,
  "startDate": "2026-04-07",
  "endDate": "2026-04-13"
}

// Response
{
  "processed": 7,
  "results": [
    {
      "workDate": "2026-04-07",
      "status": "on-time",
      "totalWorkedMins": 420,
      "minsNocturno": 0,
      "excessHedMins": 0,
      "excessHenMins": 0
    }
  ]
}
```

### POST /api/attendance/recalculate
Recalculates attendance for a specific day (triggered after manual punch correction).

```json
{
  "employeeId": 1,
  "workDate": "2026-04-14"
}
```

### POST /api/payroll/reconcile
Runs period reconciliation for all employees in a period.

```json
// Request
{
  "periodStart": "2026-03-28",
  "periodEnd": "2026-04-12",
  "status": "draft"
}

// Response
{
  "periodId": 5,
  "employees": [
    {
      "employeeId": 1,
      "name": "Carlos Restrepo",
      "totalExpectedMins": 5280,
      "totalWorkedMins": 5472,
      "overtimeOwedMins": 180,
      "rnMins": 600,
      "rfMins": 0,
      "rfnMins": 0,
      "compBalanceStart": 0,
      "otAvailableAfterOffset": 180,
      "totalRecargosCost": 15909,
      "status": "needs_comp_decision"
    }
  ]
}
```

### PUT /api/payroll/[periodId]/comp-decision
Manager sets how many OT hours to bank per employee.

```json
{
  "decisions": [
    { "employeeId": 1, "bankMins": 60 },
    { "employeeId": 2, "bankMins": 0 },
    { "employeeId": 3, "bankMins": 120 }
  ]
}
```

### POST /api/payroll/[periodId]/finalize
Locks the period — no more changes. Recalculates final costs.

```json
{
  "status": "finalized"
}
```

---

## Cron Sync Integration

The BioTime sync cron (every 10 minutes) should trigger daily attendance recalculation for any dates affected by new punches:

```typescript
// In the sync handler (already built in Phase 1):
async function syncAndCalculate() {
  // 1. Fetch new transactions from BioTime
  const newPunches = await fetchNewTransactions();
  
  // 2. Insert into punch_logs
  await insertPunchLogs(newPunches);
  
  // 3. Determine which employee+date combos were affected
  const affectedDays = new Set<string>();
  for (const punch of newPunches) {
    const businessDay = getBusinessDay(punch.punchTime);
    affectedDays.add(`${punch.empCode}-${businessDay}`);
  }
  
  // 4. Recalculate daily attendance for each affected day
  for (const key of affectedDays) {
    const [empCode, dateStr] = key.split('-');
    await calculateDailyAttendance(empCode, new Date(dateStr));
  }
}
```

---

## Test Scenarios

### File: `__tests__/scenarios.test.ts`

Write tests for each of these scenarios. Each test provides punches + schedule and asserts the exact output.

### Scenario 1: Regular day, on time, no excess
```
Schedule: Mon (daily limit 7h), 8:00 AM - 3:00 PM
Punch in: 7:55 AM, Punch out: 3:00 PM
Expected:
  effective_in = 8:00 AM (capped at schedule)
  effective_out = 3:00 PM
  totalWorkedMins = 420 (7h)
  minsOrdinaryDay = 420
  minsNocturno = 0
  excessHedMins = 0
  lateMinutes = 0
  status = 'on-time'
```

### Scenario 2: Late arrival
```
Schedule: Mon (7h), 10:00 AM - 5:00 PM
Punch in: 10:22 AM, Punch out: 5:00 PM
Expected:
  effective_in = 10:22 AM
  effective_out = 5:00 PM
  totalWorkedMins = 398 (6h 38m)
  lateMinutes = 22
  excessHedMins = 0 (under daily limit)
  status = 'late'
```

### Scenario 3: Clock-out after schedule, 15-min floor
```
Schedule: Mon (7h), 10:00 AM - 5:00 PM
Punch in: 10:00 AM, Punch out: 5:12 PM
Expected:
  effective_out = 5:00 PM (12 min excess, floor = 0)
  totalWorkedMins = 420
  excessHedMins = 0
```

### Scenario 4: Clock-out after schedule, 15-min earned
```
Schedule: Mon (7h), 10:00 AM - 5:00 PM
Punch in: 10:00 AM, Punch out: 5:15 PM
Expected:
  effective_out = 5:15 PM
  totalWorkedMins = 435 (7h 15m)
  excessHedMins = 15 (all diurno, before 7 PM)
```

### Scenario 5: Night shift crossing midnight
```
Schedule: Sat (8h), 5:00 PM - 1:00 AM (crosses midnight)
Sunday is a regular day (not a holiday)
Punch in: 4:55 PM, Punch out: 1:10 AM
Expected:
  effective_in = 5:00 PM (capped)
  effective_out = 1:00 AM (10 min excess, floor = 0)
  totalWorkedMins = 480 (8h)
  minsOrdinaryDay = 120 (5-7 PM, diurno regular)
  minsNocturno = 360 (7 PM - 1 AM, nocturno regular)
  minsFestivoDay = 0
  minsFestivoNight = 0
  excessHedMins = 0
  excessHenMins = 0
```

### Scenario 6: Night shift crossing into a holiday
```
Schedule: Dec 24 (Thu, 7h), 5:00 PM - 12:00 AM
Dec 25 is Navidad (holiday)
Punch in: 5:00 PM, Punch out: 1:15 AM (Dec 25)
Expected:
  effective_out = 1:15 AM (75 min excess, floor = 60 → 1:00 AM? NO)
  Wait — schedule end is 12:00 AM. Clock out is 1:15 AM.
  excess_raw = 75 min. floor(75) = 60.
  effective_out = 12:00 AM + 60 min = 1:00 AM
  totalWorkedMins = 420 + 60 = 480 (8h)
  
  Pre-midnight (Dec 24, regular):
    5:00-7:00 PM = 120 min ordinary diurno
    7:00 PM-12:00 AM = 300 min nocturno
  Post-midnight (Dec 25, holiday):
    12:00-1:00 AM = 60 min festivo nocturno

  minsOrdinaryDay = 120
  minsNocturno = 300
  minsFestivoDay = 0
  minsFestivoNight = 60
  excessHenMins = 60 (the excess hour is nocturno, tagged HEN not HENF)
```

### Scenario 7: Turno partido (split shift)
```
Schedule: Mon (7h), 12:00 PM - 4:00 PM / 6:00 PM - 10:00 PM
Gap: 2h (4 PM - 6 PM)
Punch in: 12:05 PM, Punch out: 10:00 PM
Expected:
  effective_in = 12:05 PM (5 min late)
  effective_out = 10:00 PM (exact, no excess)
  elapsed = 595 min
  gap = 120 min
  totalWorkedMins = 475 min (7h 55m)
  minsOrdinaryDay = 475 (all within 6AM-7PM? No!)
  
  Segment 1: 12:05 PM - 4:00 PM = 235 min, all diurno
  Segment 2: 6:00 PM - 10:00 PM = 240 min
    6:00-7:00 PM = 60 min diurno
    7:00-10:00 PM = 180 min nocturno
  
  minsOrdinaryDay = 235 + 60 = 295
  minsNocturno = 180
  lateMinutes = 5
  excessHedMins = max(0, 475 - 420) = 55 min excess
    Last 55 min of shift = 9:05 PM - 10:00 PM = nocturno
  excessHenMins = 55
```

### Scenario 8: Period reconciliation — cheapest-first
```
Period: Apr 7-13 (7 days)
Employee scheduled 6 days, off 1 day
Expected hours: 4 × 7h (Mon-Thu) + 2 × 8h (Fri-Sat) = 44h = 2640 min

Daily records:
  Mon: worked 600 min, excess HED=60, HEN=120
  Tue: worked 420 min, excess 0
  Wed: worked 420 min, excess 0
  Thu: worked 360 min, excess 0 (left 1h early)
  Fri: worked 480 min, excess 0
  Sat: worked 540 min, excess HED=30, HEN=30
  Sun: OFF

totalWorkedMins = 600+420+420+360+480+540 = 2820
overtimeRaw = 2820 - 2640 = 180 min
overtimeOwed = floorTo15Min(180) = 180 min (3h)

Pool: HED=90, HEN=150

Cheapest-first:
  otEarnedHedMins = min(180, 90) = 90
  remaining = 180 - 90 = 90
  otEarnedHenMins = min(90, 150) = 90

Pay 90 min HED (×1.25) + 90 min HEN (×1.75)
```

### Scenario 9: Period reconciliation — comp offset
```
Same as scenario 8, but employee has comp_balance = -120 (owes 2h)

overtimeOwed = 180 min
owedOffsetMins = min(180, 120) = 120
otAvailableAfterOffset = 180 - 120 = 60 min

Manager decides to bank 30, pay 30:
  otBankedMins = 30
  otPaidMins = 30
  
  hedRatio = 90/(90+90) = 0.5
  hedMins = 15
  henMins = 15

compBalanceEnd = -120 + 120 (offset) + 30 (banked) = +30
```

### Scenario 10: No overtime — daily excess absorbed
```
Period: Apr 7-13 (7 days)
Expected: 44h = 2640 min

Daily records:
  Mon: worked 600 min (+180 excess, HED=60, HEN=120)
  Tue: worked 420 min
  Wed: worked 420 min
  Thu: worked 240 min (-180 short, manager reduced schedule)
  Fri: worked 480 min
  Sat: worked 480 min
  Sun: OFF

totalWorkedMins = 600+420+420+240+480+480 = 2640
overtimeRaw = 2640 - 2640 = 0
overtimeOwed = 0

Result: ZERO overtime paid
  Monday's +180 excess is fully absorbed by Thursday's -180
  Recargos from Monday's nocturno hours are still paid (independent)
```

---

## Important Implementation Notes

1. **All monetary values in Colombian pesos (COP)** — use integer arithmetic or DECIMAL(12,2) to avoid floating point issues. Round to nearest peso at the final cost step, not during intermediate calculations.

2. **Time zone** — all times are in Colombia time (UTC-5, no daylight saving). BioTime stores times in local time. Ensure no UTC conversion happens.

3. **Immutability of raw punches** — never modify punch_logs. All corrections create new manual entries. The resolver always works from the full set of punches.

4. **Idempotent calculations** — running the daily classifier twice for the same employee+date should produce the same result. Use upsert (INSERT ON CONFLICT UPDATE) for daily_attendance records.

5. **Missing punch handling** — if only clock_in exists (no clock_out), set isMissingPunch=true and DO NOT calculate worked hours. The record stays incomplete until the manager adds the missing punch.

6. **Order of operations matters for the period reconciler:**
   a. Sum recargos (always paid, from daily records)
   b. Calculate overtime (actual vs expected, floor to 15min)
   c. Consume from excess pool (cheapest-first)
   d. Apply comp offset (if negative balance)
   e. Wait for manager's bank decision
   f. Calculate paid OT costs
   g. Update comp balance

7. **The excess pool can be larger than overtime owed.** If an employee has 6h of daily excess across the period but only 2h of period-level overtime, only 2h from the pool gets consumed. The rest is discarded — those were days the employee worked more but the manager offset it elsewhere in the period.
