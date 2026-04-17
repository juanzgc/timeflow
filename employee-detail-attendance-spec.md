# Employee Detail & Attendance Management — Full Specification

## Overview

The employee detail page (`/employees/[id]`) is the single hub for all employee-related actions: viewing attendance, fixing problems, seeing schedules, tracking comp time, and auditing corrections. Every path in the app that relates to a specific employee leads here.

This document also covers the "calculate on read" pattern that ensures attendance data is always fresh, the sync-if-stale guard, and the complete punch correction flow.

---

## Part A: Data Freshness Architecture

### A.1 The Problem

`daily_attendance` is a derived table — a cache of calculations from punch logs + schedules. It goes stale when:
- New punches arrive from BioTime (sync)
- A schedule is created or edited
- A punch is manually added or corrected
- An employee's group or rest day changes

Trying to trigger recalculation from every source is fragile and has already caused bugs (the internal fetch() auth failure, missing absent records).

### A.2 The Solution: Calculate on Read

Every API endpoint that returns attendance data runs the calculation engine BEFORE querying the table. This guarantees the data is fresh when viewed.

```
User opens any page showing attendance
         ↓
Step 1: syncIfStale(5) — sync from BioTime if last sync > 5 min ago
         ↓
Step 2: calculateAttendance({ startDate, endDate }) — recalculate daily_attendance
         ↓
Step 3: Query daily_attendance — now guaranteed fresh
         ↓
Return results
```

### A.3 syncIfStale Helper

```typescript
// src/lib/biotime/sync-if-stale.ts

import { db } from "@/lib/db";
import { settings } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { getBioTimeClient } from "./client";
import { syncTransactions } from "./transactions";

/**
 * Sync new punches from BioTime if the last sync is older than maxAgeMinutes.
 * Fails silently if BioTime is unreachable — the page still loads with
 * existing data, and the "Last sync" indicator shows the staleness.
 *
 * @returns true if a sync was performed, false if skipped or failed
 */
export async function syncIfStale(maxAgeMinutes: number = 5): Promise<boolean> {
  try {
    const [row] = await db
      .select()
      .from(settings)
      .where(eq(settings.key, "last_sync_time"))
      .limit(1);

    if (row?.value) {
      const minutesAgo = (Date.now() - new Date(row.value).getTime()) / 60000;
      if (minutesAgo < maxAgeMinutes) return false; // fresh enough
    }

    // Acquire sync lock to prevent concurrent syncs
    const [lockRow] = await db
      .select()
      .from(settings)
      .where(eq(settings.key, "sync_in_progress"))
      .limit(1);

    if (lockRow?.value === "true") return false; // another sync running

    const client = await getBioTimeClient();
    await syncTransactions(client);
    return true;
  } catch {
    // BioTime unreachable — continue with existing data
    return false;
  }
}
```

### A.4 Endpoints That Use This Pattern

| Endpoint | syncIfStale | calculateAttendance scope |
|---|---|---|
| `GET /api/dashboard/today` | Yes | All employees, today only |
| `GET /api/attendance` | Yes | All employees, requested date range |
| `GET /api/attendance/[employeeId]` | Yes | Single employee, requested date range |
| `GET /api/employees/[id]/attendance` | Yes | Single employee, requested date range |
| `POST /api/payroll` (create period) | Yes | All employees, full period range |
| `POST /api/payroll/[id]/recalculate` | Yes | All employees, full period range |

### A.5 Trigger-Based Recalculation (Keep As Backup)

These still call `calculateAttendance` after writes, so dashboard auto-refresh shows recent data without a page visit:

| Trigger | Scope |
|---|---|
| BioTime cron sync (every 10 min) | Affected employee+date combos |
| POST /api/punches (manual punch) | Single employee, single date |
| PUT /api/punches/[id] (edit punch) | Single employee, single date |
| POST /api/shifts (create/edit shift) | Single employee, shift date |
| DELETE /api/shifts/[id] | Single employee, shift date |

---

## Part B: Employee Detail Page (`/employees/[id]`)

### B.1 Page Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ ← Back to Employees                                [Edit Employee]  │
│                                                                      │
│  ┌────┐                                                              │
│  │ CR │  Carlos Restrepo                                             │
│  └────┘  Kitchen · #1001 · Cédula: 1017234567                       │
│          Salary: $2,000,000 · Rest Day: Tuesday                     │
│          Hora Ordinaria: $9,091 (divisor: 220)                      │
│                                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐    │
│  │ Today    │  │ Period   │  │ Comp     │  │ Punctuality      │    │
│  │ 7h 25m   │  │ 91h/88h  │  │ +14h     │  │ 94% on time     │    │
│  │ On time ✓│  │ +3h OT   │  │          │  │ this period     │    │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────────┘    │
│                                                                      │
│  ┌─────────────────┬────────────────┬───────────────┬──────────────┐ │
│  │  Attendance     │  Schedule      │  Comp Time    │  Corrections │ │
│  │  History ●      │  This Week     │  Transactions │  Log         │ │
│  └─────────────────┴────────────────┴───────────────┴──────────────┘ │
│                                                                      │
│  [Tab content below]                                                 │
│                                                                      │
│  ─────────────────────────────────────────────────────────────────── │
│  [View in Payroll →]  [View Schedule →]  [Sync from BioTime ↻]     │
└──────────────────────────────────────────────────────────────────────┘
```

### B.2 Header — Employee Profile

**Data source:** `GET /api/employees/[id]`

**Fields displayed:**
- Avatar: initials with group-colored background
- Full name: `firstName lastName`
- Group: colored dot + name in pill badge
- Employee code: `#empCode`
- Cédula: from `employees.cedula` (show "Not set" in amber if null)
- Monthly salary: formatted as COP (show "Not set" in amber if null)
- Rest day: day name derived from `employees.restDay` (0=Monday..6=Sunday)
- Hora ordinaria: calculated `monthlySalary / divisor` (220 or 210 depending on date)

**Edit Employee button** opens `EditEmployeeModal` (see section B.8).

### B.3 Header — Stat Cards

4 cards in a row, each providing at-a-glance context.

#### Card 1: Today

**Data source:** `daily_attendance` for today

| State | Display |
|---|---|
| Worked and on time | "7h 25m" + green "On time ✓" badge |
| Worked but late | "6h 38m" + amber "Late (22 min)" badge |
| Clocked in, no clock-out yet | "4h 10m so far" + blue "Working" badge |
| Missing punch | amber "Missing clock-out" badge |
| Day off | "Day off" in gray |
| Comp day off | "Comp day" in blue |
| Absent (scheduled but no punch) | red "Absent" badge |
| No schedule today | gray "Not scheduled" |

#### Card 2: Current Period

**Data source:** `payroll_periods` with status='draft' for this employee, or calculated on the fly

| Field | Display |
|---|---|
| Hours worked vs expected | "91h / 88h" |
| Overtime indicator | "+3h OT" in amber if over expected |
| Under hours | "-6h" in blue if under expected |
| No active period | "No active period" in gray |

#### Card 3: Comp Balance

**Data source:** latest `comp_transactions.balanceAfter` for this employee

| Balance | Display |
|---|---|
| Positive | "+14h" in green pill (company owes employee) |
| Negative | "-3h" in red pill (employee owes company) |
| Zero | "0h" in gray |
| No transactions | "0h" in gray |

#### Card 4: Punctuality

**Data source:** calculated from `daily_attendance` records in current period

```
punctuality = (days on time / days worked) × 100

Display: "94% on time" + "this period" subtitle
Color: green if ≥ 90%, amber if 70-89%, red if < 70%

Also show: "17 of 18 days on time" as subtitle
```

### B.4 Tab 1: Attendance History

This is the primary tab and the most complex. It's where managers view daily records and fix problems.

#### Date Range

```
┌──────────────────────────────────────────────────────────────────┐
│  Showing: Apr 7 – Apr 13, 2026          [← Prev Week] [Next →] │
│           ┌──────────┐  ┌──────────┐                            │
│           │ Start    │  │ End      │    [This Week] [Period]    │
│           └──────────┘  └──────────┘                            │
└──────────────────────────────────────────────────────────────────┘
```

- Default: current week (Mon-Sun)
- Quick buttons: "This Week", "Period" (current active pay period dates)
- Prev/Next arrows move by week
- Custom date range via start/end pickers

#### Data Loading

On load (and on date range change):
1. Call `syncIfStale(5)`
2. Call `calculateAttendance({ employeeId, startDate, endDate })`
3. Fetch `GET /api/employees/[id]/attendance?startDate&endDate`
4. Show loading skeleton while processing

#### Attendance Table

One row per day in the range. ALL days shown — including days off, comp days, and days with no schedule.

**Columns:**

| Column | Width | Description | Format |
|---|---|---|---|
| Date | 120px | Work date + day name | "Mon, Apr 7" |
| Status | 90px | Status badge | Colored pill |
| Clock In | 100px | Raw clock-in time | Monospace + pencil icon |
| Clock Out | 100px | Raw clock-out time | Monospace + pencil icon |
| Effective In | 100px | After normalization | Monospace, muted color |
| Effective Out | 100px | After normalization | Monospace, muted color |
| Worked | 70px | Total worked | "7h 25m" bold monospace |
| Late | 60px | Minutes late | Amber pill or "—" |
| Ordinary | 60px | minsOrdinaryDay | "7h 0m" |
| Nocturno | 60px | minsNocturno | Purple pill |
| Festivo D | 60px | minsFestivoDay | Red pill |
| Festivo N | 60px | minsFestivoNight | Red pill |
| Excess D | 60px | excessHedMins | Amber pill |
| Excess N | 60px | excessHenMins | Purple pill |
| Actions | 80px | Fix / edit actions | Buttons |

**Row Styling:**

| Status | Row Style |
|---|---|
| on-time | Default white background |
| late | Default background, amber status badge |
| absent | Light red background tint |
| day-off | Light gray background, all time columns show "—" |
| comp-day-off | Light blue background, shows "COMP" in status |
| missing punch | Amber left border (3px), amber background tint |
| unscheduled | Light yellow background |
| Holiday date | Small red dot next to the date |

**Actions Column:**

| Row State | Actions Available |
|---|---|
| Missing clock-out | [Fix Clock-Out] button (primary style) |
| Missing clock-in | [Fix Clock-In] button |
| Absent | [Was Present] button — opens modal to add both in + out |
| Normal (has both punches) | Pencil icon on clock-in cell, pencil icon on clock-out cell |
| Day off | No actions |
| Comp day off | No actions |

**Pencil Icon Behavior:**
- Appears on hover over the clock-in or clock-out cell
- Click opens PunchCorrectionModal pre-filled for editing that specific time
- Shown only when a value exists (edit existing), or when it's the missing value (add new)

#### Summary Row (below the table)

```
Period Totals: 6 days worked · 44h 25m total · 22 min late · 1h 45m excess
               Nocturno: 0h · Festivo: 0h · Ordinary: 42h 40m
```

### B.5 Tab 2: This Week's Schedule

Read-only view of what this employee is scheduled for.

```
Week of Apr 13 – Apr 19, 2026                    [← Prev]  [Next →]

┌─────────┬──────────────────────┬──────────┬──────────────────────┐
│ Day     │ Shift                │ Hours    │ Type                 │
├─────────┼──────────────────────┼──────────┼──────────────────────┤
│ Mon 13  │ 8:00 AM – 3:00 PM   │ 7h       │ Regular              │
│ Tue 14  │ —                    │ —        │ Rest Day (Tuesday)   │
│ Wed 15  │ 8:00 AM – 3:00 PM   │ 7h       │ Regular              │
│ Thu 16  │ 8:00 AM – 3:00 PM   │ 7h       │ Regular              │
│ Fri 17  │ 8:00 AM – 4:00 PM   │ 8h       │ Regular              │
│ Sat 18  │ 8:00 AM – 4:00 PM   │ 8h       │ Regular              │
│ Sun 19  │ —                    │ —        │ COMP (-7h)           │
├─────────┼──────────────────────┼──────────┼──────────────────────┤
│         │              Total   │ 44h      │ 5 regular + 1 comp   │
└─────────┴──────────────────────┴──────────┴──────────────────────┘

[Edit in Schedule Editor →]
```

**Special row types:**
- Rest day: gray text, shows which day is the employee's designated rest day
- Comp day off: blue COMP badge, shows debit amount "(-7h)"
- Split shift: shows both segments stacked: "12:00 – 4:00 PM / 6:00 – 10:00 PM"
- Night shift: purple text for times that cross midnight: "5:00 PM – 1:00 AM"
- Holiday: red dot next to date + "Festivo" label
- No schedule exists: "No schedule for this week" with [Create Schedule →] link

**Data source:** `GET /api/employees/[id]/schedule?weekStart=2026-04-13`

This route queries `weeklySchedules` + `shifts` for the employee's group and filters to shifts assigned to this employee.

### B.6 Tab 3: Comp Transactions

Full ledger of all compensatory time movements for this employee.

```
┌──────────┬────────────────┬──────────┬──────────┬──────────────────────────────────────┬───────┐
│ Date     │ Type           │ Minutes  │ Balance  │ Note                                 │ By    │
├──────────┼────────────────┼──────────┼──────────┼──────────────────────────────────────┼───────┤
│ Apr 12   │ OT Banked      │ +5h 0m   │ +14h 0m  │ Banked from period Mar 28–Apr 12    │ admin │
│ Apr 10   │ Comp Day       │ -7h 0m   │ +9h 0m   │ Monday off                          │ admin │
│ Apr 1    │ OT Banked      │ +8h 0m   │ +16h 0m  │ Banked from period Mar 14–27        │ admin │
│ Mar 20   │ Time Owed      │ -2h 0m   │ +8h 0m   │ Unexplained absence Mar 18          │ admin │
│ Mar 14   │ OT Banked      │ +10h 0m  │ +10h 0m  │ Banked from period Feb 28–Mar 13    │ admin │
│ Mar 5    │ Offset         │ +3h 0m   │ 0h 0m    │ Cleared debt from OT                │ admin │
│ Feb 28   │ Time Owed      │ -3h 0m   │ -3h 0m   │ Unexcused absence Feb 25            │ admin │
└──────────┴────────────────┴──────────┴──────────┴──────────────────────────────────────┴───────┘

Current Balance: +14h 0m
```

**Type badges:**
- "OT Banked" → green background, green text
- "Comp Day" → blue background, blue text
- "Time Owed" → red background, red text
- "Offset" → amber background, amber text

**Minutes column:** signed, formatted as hours+minutes. Positive with "+" prefix, negative with "-".

**Balance column:** running balance after each transaction. Green if positive, red if negative, gray if zero.

**Data source:** `GET /api/employees/[id]/comp-transactions`

Read-only — transactions are created by payroll finalization, comp day scheduling, and manager decisions.

### B.7 Tab 4: Corrections Log

Audit trail of every manual punch correction.

```
┌──────────┬─────────────────┬──────────────┬──────────────┬──────────────────────────────────────────────┬───────┬─────────────────┐
│ Date     │ Action          │ Old Value    │ New Value    │ Reason                                       │ By    │ When            │
├──────────┼─────────────────┼──────────────┼──────────────┼──────────────────────────────────────────────┼───────┼─────────────────┤
│ Apr 14   │ Added clock-out │ —            │ 11:00 PM     │ Forgot to punch, confirmed by supervisor     │ admin │ Apr 15, 9:22 AM │
│ Apr 8    │ Edited clock-in │ 7:45 AM      │ 8:00 AM      │ Device error, actual arrival was 8:00 AM     │ admin │ Apr 8, 2:15 PM  │
│ Mar 22   │ Added clock-in  │ —            │ 10:00 AM     │ Device was offline in the morning             │ admin │ Mar 22, 5:30 PM │
│ Mar 15   │ Added clock-out │ —            │ 6:00 PM      │ Battery died on device, left at 6 PM         │ admin │ Mar 16, 8:00 AM │
│ Mar 10   │ Added clock-in  │ —            │ 8:00 AM      │ Employee used wrong finger                   │ admin │ Mar 10, 12:30 PM│
│          │ Added clock-out │ —            │ 3:00 PM      │ Employee used wrong finger                   │ admin │ Mar 10, 12:30 PM│
└──────────┴─────────────────┴──────────────┴──────────────┴──────────────────────────────────────────────┴───────┴─────────────────┘
```

**Action badges:**
- "Added clock-in" → blue
- "Added clock-out" → blue
- "Edited clock-in" → amber
- "Edited clock-out" → amber

**Data source:** `GET /api/employees/[id]/corrections`

Read-only — corrections are created via the PunchCorrectionModal.

### B.8 Edit Employee Modal

Opened by the [Edit Employee] button in the header.

```
┌────────────────────────────────────────────────────────┐
│  Edit Employee — Carlos Restrepo                   [✕] │
│                                                        │
│  Group                                                 │
│  ┌────────────────────────────────────────────────┐    │
│  │ Kitchen                                    ▾   │    │
│  └────────────────────────────────────────────────┘    │
│                                                        │
│  Monthly Salary (COP)                                  │
│  ┌────────────────────────────────────────────────┐    │
│  │ 2000000                                        │    │
│  └────────────────────────────────────────────────┘    │
│                                                        │
│  Cédula                                                │
│  ┌────────────────────────────────────────────────┐    │
│  │ 1017234567                                     │    │
│  └────────────────────────────────────────────────┘    │
│                                                        │
│  Rest Day                                              │
│  ┌────────────────────────────────────────────────┐    │
│  │ Tuesday                                    ▾   │    │
│  └────────────────────────────────────────────────┘    │
│                                                        │
│  Status                                                │
│  ┌────────────────────────────────────────────────┐    │
│  │ ● Active                                       │    │
│  └────────────────────────────────────────────────┘    │
│  ⚠ Deactivating will hide this employee from all      │
│    schedules and reports. Existing records preserved.  │
│                                                        │
│                          [Cancel]  [Save Changes]      │
└────────────────────────────────────────────────────────┘
```

**Fields:**
- Group: dropdown (Kitchen, Servers, Bar, Admin)
- Monthly Salary: number input, formatted as COP on blur
- Cédula: text input (prevents leading zero truncation)
- Rest Day: dropdown (Monday through Sunday)
- Status: toggle Active/Inactive with warning text

**On save:** `PUT /api/employees/[id]` with changed fields only.

**Validation:**
- Salary must be > 0 if provided
- Cédula should be numeric, 6-12 digits (soft validation — warn but allow save)
- Changing group does NOT retroactively reassign schedules — warn: "Changing group affects future schedules only. Existing schedule assignments are preserved."

### B.9 Quick Actions (Bottom of Page)

```
[View in Payroll →]  [View Schedule →]  [Sync from BioTime ↻]
```

- **View in Payroll:** navigates to `/payroll/[periodId]` for the current draft period. If no draft period exists, shows "No active period" tooltip.
- **View Schedule:** navigates to `/schedules/[weekStart]/[groupId]` for the current week + this employee's group
- **Sync from BioTime:** calls `POST /api/biotime/employees` to re-sync this employee's name/data from BioTime. Shows success/error toast.

---

## Part C: Punch Correction System

### C.1 PunchCorrectionModal Component

**File:** `src/components/attendance/PunchCorrectionModal.tsx`

**Props:**
```typescript
interface PunchCorrectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;               // callback to refresh data
  employeeId: number;
  employeeName: string;
  workDate: string;                   // "YYYY-MM-DD"
  existingClockIn: string | null;     // ISO timestamp or null
  existingClockOut: string | null;    // ISO timestamp or null
  action?: 'add_in' | 'add_out' | 'edit_in' | 'edit_out' | 'add_both';
}
```

**Modal Layout:**

```
┌────────────────────────────────────────────────────────┐
│  Punch Correction                                  [✕] │
│  Carlos Restrepo — Monday, Apr 14, 2026                │
│                                                        │
│  ┌─ Clock In ────────────────────────────────────────┐ │
│  │  Current: 8:00 AM                                 │ │
│  │  ○ Keep current  ● Edit                           │ │
│  │  New time: [  8:15  ] AM ▾                        │ │
│  └───────────────────────────────────────────────────┘ │
│                                                        │
│  ┌─ Clock Out ───────────────────────────────────────┐ │
│  │  Current: ⚠ Missing                              │ │
│  │  New time: [ 11:00  ] PM ▾                        │ │
│  └───────────────────────────────────────────────────┘ │
│                                                        │
│  ┌─ Schedule Context ────────────────────────────────┐ │
│  │  Scheduled: 8:00 AM – 3:00 PM (7h)               │ │
│  │  Daily limit: 7h                                  │ │
│  └───────────────────────────────────────────────────┘ │
│                                                        │
│  Reason (required)                                     │
│  ┌────────────────────────────────────────────────────┐│
│  │ Forgot to punch out, confirmed with supervisor    ││
│  └────────────────────────────────────────────────────┘│
│                                                        │
│  ┌─ Preview ─────────────────────────────────────────┐ │
│  │  Worked: 7h 15m                                   │ │
│  │  Late: 15 min                                     │ │
│  │  Nocturno: 0h                                     │ │
│  └───────────────────────────────────────────────────┘ │
│                                                        │
│                         [Cancel]  [Save Correction]    │
└────────────────────────────────────────────────────────┘
```

**Sections:**

**Clock In section:**
- If clock-in exists: show current time, radio to keep or edit, new time picker if editing
- If clock-in missing: show "⚠ Missing" in amber, time picker required
- Time picker: 15-minute increments dropdown OR free text input for exact times

**Clock Out section:**
- Same as clock-in but for clock-out
- If action='add_out': this section is pre-focused with empty time picker

**Schedule Context (read-only):**
- Shows the scheduled shift for this day
- Helps the manager make informed corrections ("they were supposed to work until 3 PM")
- If split shift: shows both segments
- If no schedule: shows "No schedule found for this day"

**Reason (required):**
- Text input, minimum 5 characters
- Placeholder: "Why is this correction needed?"
- Examples shown below the field in muted text: "Forgot to punch • Device error • Confirmed by supervisor"

**Preview (live calculation):**
- Updates as the manager changes times
- Shows what the calculated result will be: worked hours, late minutes, nocturno hours
- Runs the normalizer + classifier locally (or calls a lightweight preview API)
- Helps catch mistakes: "Wait, 15h worked? That can't be right"

**Behavior per action mode:**

| Action | Clock In | Clock Out | Pre-focused |
|---|---|---|---|
| `add_in` | Empty, editable | Show existing (read-only) | Clock In time picker |
| `add_out` | Show existing (read-only) | Empty, editable | Clock Out time picker |
| `edit_in` | Show current, editable | Show existing (read-only) | Clock In time picker |
| `edit_out` | Show existing (read-only) | Show current, editable | Clock Out time picker |
| `add_both` | Empty, editable | Empty, editable | Clock In time picker |

### C.2 Save Flow

When the manager clicks [Save Correction]:

```
1. Validate:
   - Reason is provided (≥ 5 chars)
   - Time(s) are provided for the fields being added/edited
   - Clock-out is after clock-in (if both present)
   - Times are within reasonable bounds (not in the future, not > 24h shift)

2. API call: POST /api/punches
   {
     "employeeId": 5,
     "workDate": "2026-04-14",
     "corrections": [
       {
         "action": "add_out",
         "oldValue": null,
         "newValue": "2026-04-14T23:00:00-05:00",
         "reason": "Forgot to punch out, confirmed with supervisor"
       }
     ]
   }

3. API handler:
   a. Insert into punch_logs:
      - empCode, punchTime=newValue, punchState='1' (out), source='manual', createdBy
   b. Insert into punch_corrections:
      - employeeId, workDate, action, oldValue, newValue, reason, correctedBy
   c. Call calculateAttendance({ employeeId, startDate: workDate, endDate: workDate })
   d. Return updated daily_attendance record

4. Client:
   a. Close modal
   b. Show success toast: "Clock-out added for Carlos Restrepo, Apr 14"
   c. Refresh attendance data (call onSaved callback)
```

### C.3 "Was Present" Flow (Absent → Add Both Punches)

When clicking [Was Present] on an absent row:

1. PunchCorrectionModal opens with `action='add_both'`
2. Both clock-in and clock-out are empty and editable
3. Schedule context shows what the employee was supposed to work
4. Manager enters both times + reason
5. API creates two punch_logs entries (one in, one out) and two punch_corrections entries
6. Recalculation runs, row changes from "Absent" to "On time" or "Late"

---

## Part D: Navigation Flow

### D.1 Dashboard Deep Links

Dashboard missing punch alerts include a [Fix] button that navigates directly to the employee detail page with the correction modal ready:

```
Dashboard Alert:
  "Valentina Ospina — Apr 14 — No clock-out    [Fix]"

[Fix] links to:
  /employees/2?tab=attendance&date=2026-04-14&fix=clock-out
```

**Employee detail page reads these query params:**

| Param | Effect |
|---|---|
| `tab=attendance` | Auto-selects Attendance History tab |
| `date=2026-04-14` | Sets date range to include this date, scrolls to it, highlights the row with a pulse animation |
| `fix=clock-out` | Auto-opens PunchCorrectionModal with action='add_out' for that date |
| `fix=clock-in` | Auto-opens PunchCorrectionModal with action='add_in' |
| `fix=both` | Auto-opens PunchCorrectionModal with action='add_both' |

### D.2 All Navigation Paths to Employee Detail

| Source | Action | Destination |
|---|---|---|
| Dashboard alert [Fix] | Click Fix on missing punch | `/employees/{id}?tab=attendance&date=YYYY-MM-DD&fix=clock-out` |
| Dashboard attendance table | Click employee name | `/employees/{id}?tab=attendance` |
| Dashboard attendance table | Click clock-in/out cell | `/employees/{id}?tab=attendance&date=YYYY-MM-DD&fix=edit-in` |
| Attendance list page | Click employee row | `/employees/{id}?tab=attendance&startDate=X&endDate=Y` |
| Employee list page | Click View Details | `/employees/{id}` |
| Employee card | Click anywhere | `/employees/{id}` |
| Payroll detail table | Click employee name | `/employees/{id}?tab=attendance&startDate=periodStart&endDate=periodEnd` |
| Schedule editor | Click employee name | `/employees/{id}?tab=schedule` |

### D.3 Outbound Navigation from Employee Detail

| Action | Destination |
|---|---|
| [View in Payroll →] | `/payroll/{periodId}` (current draft period) |
| [View Schedule →] | `/schedules/{weekStart}/{groupId}` |
| [Edit in Schedule Editor →] (from schedule tab) | `/schedules/{weekStart}/{groupId}` |
| ← Back to Employees | `/employees` |

---

## Part E: API Routes

### E.1 Employee Profile

```
GET /api/employees/[id]
```

Returns employee profile + stat card data:
```json
{
  "employee": {
    "id": 1,
    "empCode": "1001",
    "firstName": "Carlos",
    "lastName": "Restrepo",
    "groupId": 1,
    "groupName": "Kitchen",
    "cedula": "1017234567",
    "monthlySalary": "2000000",
    "restDay": 1,
    "restDayName": "Tuesday",
    "horaOrdinaria": 9091,
    "divisor": 220,
    "isActive": true,
    "biotimeId": 42
  },
  "stats": {
    "today": {
      "status": "on-time",
      "totalWorkedMins": 445,
      "clockIn": "2026-04-14T08:00:00",
      "clockOut": "2026-04-14T15:25:00",
      "isMissingPunch": false
    },
    "period": {
      "periodStart": "2026-03-28",
      "periodEnd": "2026-04-12",
      "totalExpectedMins": 5280,
      "totalWorkedMins": 5472,
      "overtimeMins": 192,
      "status": "draft"
    },
    "compBalance": 840,
    "punctuality": {
      "percent": 94,
      "daysOnTime": 17,
      "daysWorked": 18
    }
  }
}
```

This endpoint runs `syncIfStale(5)` + `calculateAttendance` for today only (for the today stat card).

### E.2 Employee Attendance History

```
GET /api/employees/[id]/attendance?startDate=2026-04-07&endDate=2026-04-13
```

Runs `syncIfStale(5)` + `calculateAttendance({ employeeId, startDate, endDate })`, then returns:

```json
{
  "records": [
    {
      "workDate": "2026-04-07",
      "dayName": "Monday",
      "isHoliday": false,
      "holidayName": null,
      "status": "on-time",
      "clockIn": "2026-04-07T07:55:00",
      "clockOut": "2026-04-07T17:12:00",
      "effectiveIn": "2026-04-07T08:00:00",
      "effectiveOut": "2026-04-07T17:00:00",
      "scheduledStart": "08:00",
      "scheduledEnd": "15:00",
      "isSplitShift": false,
      "totalWorkedMins": 540,
      "lateMinutes": 0,
      "earlyLeaveMins": 0,
      "minsOrdinaryDay": 540,
      "minsNocturno": 0,
      "minsFestivoDay": 0,
      "minsFestivoNight": 0,
      "excessHedMins": 120,
      "excessHenMins": 0,
      "dailyLimitMins": 420,
      "isMissingPunch": false,
      "isClockInManual": false,
      "isClockOutManual": false
    }
  ],
  "summary": {
    "daysWorked": 6,
    "daysAbsent": 0,
    "daysOff": 1,
    "totalWorkedMins": 2790,
    "totalLateMins": 22,
    "totalExcessMins": 150,
    "totalNocturnoMins": 0,
    "totalFestivoMins": 0
  }
}
```

### E.3 Employee Schedule

```
GET /api/employees/[id]/schedule?weekStart=2026-04-13
```

Returns shifts for this employee's group for the given week:

```json
{
  "weekStart": "2026-04-13",
  "groupName": "Kitchen",
  "scheduleExists": true,
  "shifts": [
    { "dayOfWeek": 0, "dayName": "Monday", "shiftType": "regular", "shiftStart": "08:00", "shiftEnd": "15:00", "crossesMidnight": false, "breakMinutes": 0, "isSplit": false, "hours": 7 },
    { "dayOfWeek": 1, "dayName": "Tuesday", "shiftType": "day_off", "isRestDay": true, "hours": 0 },
    { "dayOfWeek": 2, "dayName": "Wednesday", "shiftType": "regular", "shiftStart": "08:00", "shiftEnd": "15:00", "crossesMidnight": false, "breakMinutes": 0, "isSplit": false, "hours": 7 },
    { "dayOfWeek": 3, "dayName": "Thursday", "shiftType": "regular", "shiftStart": "08:00", "shiftEnd": "15:00", "crossesMidnight": false, "breakMinutes": 0, "isSplit": false, "hours": 7 },
    { "dayOfWeek": 4, "dayName": "Friday", "shiftType": "regular", "shiftStart": "08:00", "shiftEnd": "16:00", "crossesMidnight": false, "breakMinutes": 0, "isSplit": false, "hours": 8 },
    { "dayOfWeek": 5, "dayName": "Saturday", "shiftType": "regular", "shiftStart": "08:00", "shiftEnd": "16:00", "crossesMidnight": false, "breakMinutes": 0, "isSplit": false, "hours": 8 },
    { "dayOfWeek": 6, "dayName": "Sunday", "shiftType": "comp_day_off", "compDebitMins": 420, "hours": 0 }
  ],
  "totalHours": 44,
  "editUrl": "/schedules/2026-04-13/1"
}
```

### E.4 Comp Transactions

```
GET /api/employees/[id]/comp-transactions
```

Returns all comp transactions, newest first:
```json
{
  "transactions": [
    {
      "id": 15,
      "date": "2026-04-12",
      "type": "ot_banked",
      "minutes": 300,
      "balanceAfter": 840,
      "note": "Banked from period Mar 28–Apr 12",
      "createdBy": "admin",
      "createdAt": "2026-04-13T10:30:00"
    }
  ],
  "currentBalance": 840
}
```

### E.5 Corrections Log

```
GET /api/employees/[id]/corrections
```

Returns all corrections, newest first:
```json
{
  "corrections": [
    {
      "id": 8,
      "workDate": "2026-04-14",
      "action": "add_out",
      "oldValue": null,
      "newValue": "2026-04-14T23:00:00",
      "reason": "Forgot to punch out, confirmed with supervisor",
      "correctedBy": "admin",
      "correctedAt": "2026-04-15T09:22:00"
    }
  ]
}
```

### E.6 Punch Correction

```
POST /api/punches
```

Request:
```json
{
  "employeeId": 5,
  "workDate": "2026-04-14",
  "corrections": [
    {
      "action": "add_out",
      "newValue": "2026-04-14T23:00:00-05:00",
      "reason": "Forgot to punch out, confirmed with supervisor"
    }
  ]
}
```

Handler:
1. Validate inputs
2. Look up employee by ID to get empCode
3. For each correction:
   a. Determine punchState: 'add_in'/'edit_in' → '0', 'add_out'/'edit_out' → '1'
   b. For 'edit_in'/'edit_out': find the existing punch_log and capture oldValue
   c. Insert into punch_logs: empCode, punchTime=newValue, punchState, source='manual', createdBy
   d. Insert into punch_corrections: employeeId, workDate, action, oldValue, newValue, reason, correctedBy
4. Call `calculateAttendance({ employeeId, startDate: workDate, endDate: workDate })`
5. Return updated daily_attendance record

Response:
```json
{
  "success": true,
  "corrections": [
    { "action": "add_out", "punchLogId": 1234, "correctionId": 8 }
  ],
  "attendance": {
    "workDate": "2026-04-14",
    "status": "late",
    "totalWorkedMins": 435,
    "lateMinutes": 5
  }
}
```

### E.7 Edit Employee

```
PUT /api/employees/[id]
```

Request (partial — only changed fields):
```json
{
  "groupId": 2,
  "monthlySalary": "2200000",
  "cedula": "1017234567",
  "restDay": 3
}
```

---

## Part F: Components to Build

```
src/components/employees/
├── EmployeeHeader.tsx          → profile info + avatar + edit button
├── EmployeeStatCards.tsx        → 4 stat cards (today, period, comp, punctuality)
├── EmployeeTabs.tsx             → tab navigation with query param support
├── AttendanceHistoryTab.tsx     → date range + attendance table + summary
├── AttendanceRow.tsx            → single day row with actions + pencil icons
├── ScheduleTab.tsx              → weekly schedule read-only view
├── CompTransactionsTab.tsx      → comp ledger table
├── CorrectionsTab.tsx           → corrections audit table
├── EditEmployeeModal.tsx        → edit profile fields
└── QuickActions.tsx             → bottom action links

src/components/attendance/
├── PunchCorrectionModal.tsx     → the main correction modal
├── TimePickerInput.tsx          → time picker with 15-min increments
├── CorrectionPreview.tsx        → live preview of calculated result
└── MissingPunchBanner.tsx       → inline banner for missing punch rows
```

---

## Part G: Testing Checklist

### Employee Detail Page
- [ ] Header shows correct employee profile info
- [ ] "Not set" warning for missing salary or cédula
- [ ] 4 stat cards show correct values
- [ ] Today card handles all states (on-time, late, absent, day-off, working, not scheduled)
- [ ] Period card shows correct worked vs expected
- [ ] Comp balance displays correctly (positive/negative/zero)
- [ ] Punctuality percentage is accurate
- [ ] Edit Employee modal saves all fields
- [ ] Group change shows warning about future-only effect
- [ ] Quick action links navigate correctly

### Attendance History Tab
- [ ] syncIfStale runs on load
- [ ] calculateAttendance runs for the date range
- [ ] All days in range shown (including off days, absent, comp)
- [ ] Row styling matches status (absent=red tint, day-off=gray, etc.)
- [ ] Holiday dates show festivo indicator
- [ ] Manual correction pencil icon shows on hover
- [ ] Missing punch rows show [Fix] button
- [ ] Absent rows show [Was Present] button
- [ ] Summary row calculates correctly
- [ ] Date range picker works (prev/next week, custom, period shortcut)
- [ ] Scrolls to and highlights date from query param

### Schedule Tab
- [ ] Shows current week by default
- [ ] Week navigation works
- [ ] Regular, day-off, comp-day-off, split shift, night shift all display correctly
- [ ] Rest day is labeled
- [ ] Holiday dates are marked
- [ ] "No schedule" empty state with create link
- [ ] Edit in Schedule Editor link navigates correctly
- [ ] Weekly total hours calculated correctly

### Comp Transactions Tab
- [ ] All transactions shown, newest first
- [ ] Type badges are color-coded
- [ ] Minutes formatted as signed hours+minutes
- [ ] Balance column shows running balance
- [ ] Current balance shown at bottom

### Corrections Tab
- [ ] All corrections shown, newest first
- [ ] Action badges are color-coded
- [ ] Old/new values formatted correctly
- [ ] Reason is displayed

### PunchCorrectionModal
- [ ] Opens with correct pre-filled action
- [ ] Existing times shown read-only when not being edited
- [ ] Missing times show "⚠ Missing" indicator
- [ ] Time picker works with 15-min increments
- [ ] Reason is required (≥ 5 chars)
- [ ] Preview updates live as times change
- [ ] Save creates punch_log + punch_correction
- [ ] Save triggers recalculation
- [ ] Success toast shown after save
- [ ] Data refreshes after save (row updates)
- [ ] Clock-out must be after clock-in validation
- [ ] Times can't be in the future

### Dashboard Integration
- [ ] [Fix] button navigates to correct employee + date + action
- [ ] Employee detail auto-opens correction modal from query params
- [ ] After fixing, dashboard alert disappears on next load
- [ ] Attendance table row clicks navigate to employee detail

### Calculate on Read
- [ ] GET /api/attendance runs syncIfStale + calculateAttendance
- [ ] GET /api/employees/[id]/attendance runs syncIfStale + calculateAttendance
- [ ] GET /api/dashboard/today runs syncIfStale + calculateAttendance
- [ ] POST /api/payroll runs syncIfStale + calculateAttendance
- [ ] BioTime offline doesn't break any page (graceful degradation)
- [ ] syncIfStale skips if last sync < 5 minutes ago
- [ ] syncIfStale respects concurrency lock
