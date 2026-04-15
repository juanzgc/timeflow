# Phase 4 — Dashboard & Reporting (Detailed Specification)

## Overview

Build the three core views that managers use daily: the Dashboard (at-a-glance overview), the Attendance Log (detailed daily records), and the Payroll page (period reconciliation + comp decisions). All data comes from the calculation engine built in Phase 3.

---

## Pages & Routes

```
/dashboard          → Main dashboard (default landing page)
/attendance         → Attendance log with date range + filters
/employees          → Employee directory with stats
/employees/[id]     → Individual employee detail + history
/payroll            → Pay period management
/payroll/[periodId] → Period detail with comp decisions + export
```

---

## Page 1: Dashboard (`/dashboard`)

### Purpose
The manager opens this every morning to see: who's here, who's late, who's missing, any alerts that need action, and how the current period is tracking.

### Layout (top to bottom)

#### 1.1 Header
```
Dashboard                                          [Sync now ↻] [JD]
Monday, April 14, 2026 — Period: Mar 28 – Apr 12
```
- "Sync now" button triggers manual BioTime sync
- Show last sync timestamp on hover/tooltip
- Period shown is the most recent active (draft) payroll period, or "No active period" if none exists

#### 1.2 KPI Cards (4 columns)

| Card | Value Source | Trend |
|---|---|---|
| Present Today | Count of employees with clock_in today | vs same day last week |
| On Time | % of present employees with lateMinutes = 0 | vs last week avg |
| Late Arrivals | Count with lateMinutes > 0 | vs last week |
| Missing Punches | Count with is_missing_punch = true | — |

**Data query:**
```sql
SELECT 
  COUNT(*) FILTER (WHERE clock_in IS NOT NULL) as present,
  COUNT(*) FILTER (WHERE clock_in IS NOT NULL AND late_minutes = 0) as on_time,
  COUNT(*) FILTER (WHERE late_minutes > 0) as late,
  COUNT(*) FILTER (WHERE is_missing_punch = true) as missing_punch
FROM daily_attendance
WHERE work_date = CURRENT_DATE
```

For trends, run the same query for the equivalent day last week and calculate the difference.

#### 1.3 Alert Banners (conditional, shown only when relevant)

**Missing Punch Alert** (warning style, amber background)
- Shown when any employee has is_missing_punch = true for today
- Lists each employee: "Valentina Ospina — no clock-out"
- Each row has a "Fix" button → opens the PunchCorrectionModal for that employee+date
- Sorted by most recent first

**Period Overdue Alert** (danger style, red background)
- Shown when the most recent payroll period's end date has passed and status is still 'draft'
- "Period Mar 28 – Apr 12 has ended and is not finalized. [Go to Payroll →]"

**No Active Period Alert** (info style, blue background)
- Shown when no payroll period exists with status 'draft'
- "No active pay period. [Create Period →]"

#### 1.4 Group Filter Tabs
- Segmented control: All | Kitchen | Servers | Bar | Admin
- Filters the attendance table and period tracker below
- Default: "All"
- Persists within the session (not URL-based)

#### 1.5 Today's Attendance Table

Full table of all employees for today, filtered by selected group.

**Columns:**
| Column | Source | Display |
|---|---|---|
| Employee | employees.firstName + lastName | Name + #empCode below |
| Group | groups.name via employees.groupId | Colored dot + name in pill |
| Clock In | daily_attendance.clockIn | Monospace time, ✏️ if isClockInManual |
| Clock Out | daily_attendance.clockOut | Monospace time, ✏️ if isClockOutManual, "—" if null |
| Worked | daily_attendance.totalWorkedMins | "7h 25m" format |
| Late | daily_attendance.lateMinutes | Amber pill if > 0, "—" if 0 |
| Excess | excessHedMins + excessHenMins | Purple pill with "+45m", "—" if 0 |
| Status | daily_attendance.status | Green "On time", Amber "Late", Red "Absent", Blue "COMP", Gray "Day off" |

**Row behavior:**
- Hover: subtle background highlight
- Click on clock-in or clock-out cell → opens PunchCorrectionModal
- Click on employee name → navigates to `/employees/[id]`
- Rows with is_missing_punch = true have a subtle amber left border

**Sorting:**
- Default: status (absent first, then late, then on-time)
- Clickable column headers for custom sorting

**Data query:**
```sql
SELECT 
  e.id, e.emp_code, e.first_name, e.last_name, e.group_id,
  g.name as group_name,
  da.clock_in, da.clock_out, da.effective_in, da.effective_out,
  da.total_worked_mins, da.late_minutes, da.early_leave_mins,
  da.excess_hed_mins, da.excess_hen_mins,
  da.status, da.day_type, da.is_missing_punch,
  da.is_clock_in_manual, da.is_clock_out_manual
FROM employees e
LEFT JOIN groups g ON e.group_id = g.id
LEFT JOIN daily_attendance da ON da.employee_id = e.id AND da.work_date = CURRENT_DATE
WHERE e.is_active = true
ORDER BY 
  CASE da.status 
    WHEN 'absent' THEN 1 
    WHEN 'late' THEN 2 
    WHEN 'on-time' THEN 3 
    WHEN 'day-off' THEN 4 
    WHEN 'comp-day-off' THEN 5 
    ELSE 6 
  END
```

#### 1.6 Period Hours Tracker

Shows each employee's running total for the current pay period vs their expected hours.

**Layout:** Card with employee rows, each showing:
```
Carlos R.          91h / 88h expected  [====████████=====] 103%
Valentina O.       82h / 88h expected  [====█████         ]  93%
Andrés G.          96h / 96h expected  [====██████████====] 100%
```

- Progress bar: teal if ≤ 100%, amber if > 100%
- Shows "No active period" if no draft payroll period exists
- Right side: link to "View Payroll →"

**Data query:**
```sql
SELECT 
  e.id, e.first_name, e.last_name,
  pp.total_expected_mins, pp.total_worked_mins
FROM employees e
LEFT JOIN payroll_periods pp ON pp.employee_id = e.id 
  AND pp.status = 'draft'
  AND pp.period_start = (SELECT MAX(period_start) FROM payroll_periods WHERE status = 'draft')
WHERE e.is_active = true
```

#### 1.7 Comp Balances Card

Shows each employee's compensatory time balance.

**Layout:** Card with employee rows:
```
Carlos R.           +14h    (green pill)
Valentina O.         -3h    (red pill)
Andrés G.            +7h    (green pill)
Mariana L.            0h    (gray text)
```

- Positive: green pill (company owes employee)
- Negative: red pill (employee owes company)
- Zero: gray text
- Click employee → navigates to `/employees/[id]`

**Data query:**
```sql
SELECT 
  e.id, e.first_name, e.last_name,
  COALESCE(
    (SELECT balance_after FROM comp_transactions 
     WHERE employee_id = e.id 
     ORDER BY created_at DESC LIMIT 1),
    0
  ) as comp_balance
FROM employees e
WHERE e.is_active = true
ORDER BY comp_balance DESC
```

---

## Page 2: Attendance Log (`/attendance`)

### Purpose
Detailed attendance records across a date range, with drill-down into daily breakdowns including minute-by-minute classification.

### Layout

#### 2.1 Header + Filters
```
Attendance Log                                    [Export CSV]
┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐
│ Start: Apr 7  │ │ End: Apr 13  │ │ Group: All Groups ▾  │
└──────────────┘ └──────────────┘ └──────────────────────┘
```

- Date range picker (start + end), defaults to current week (Mon–Sun)
- Group filter dropdown
- Export CSV button — exports the visible table data

#### 2.2 Summary Cards (3 columns, for the selected date range)

| Card | Value |
|---|---|
| Total Hours Worked | Sum of all totalWorkedMins across all employees in range |
| Total Late Minutes | Sum of all lateMinutes |
| Total Excess Hours | Sum of all excessHedMins + excessHenMins |

#### 2.3 Attendance Table

One row per employee, summarizing the date range.

**Columns:**
| Column | Description |
|---|---|
| Employee | Name + group badge |
| Days Present | Count of days with clock_in |
| Total Hours | Sum of totalWorkedMins, formatted as "Xh Ym" |
| Avg / Day | Total hours ÷ days present |
| Total Late | Sum of lateMinutes, amber pill |
| Total Excess | Sum of excess minutes, purple pill |
| Nocturno Hours | Sum of minsNocturno, formatted |
| Festivo Hours | Sum of minsFestivoDay + minsFestivoNight |

**Row behavior:**
- Click row → expands inline to show daily breakdown

#### 2.4 Expanded Daily Breakdown (inline, below the clicked row)

When a row is expanded, show a sub-table with one row per day in the range:

**Sub-columns:**
| Column | Description |
|---|---|
| Date | Work date, with day name. Holiday dates shown with red dot |
| Status | On-time / Late / Absent / Day-off / Comp |
| Clock In | Raw time + ✏️ if manual. Click to edit |
| Clock Out | Raw time + ✏️ if manual. Click to edit |
| Effective In | After normalization |
| Effective Out | After normalization |
| Worked | Total minutes formatted |
| Late | Minutes late |
| Ordinary | minsOrdinaryDay formatted |
| Nocturno | minsNocturno formatted, indigo badge |
| Festivo D | minsFestivoDay, red badge |
| Festivo N | minsFestivoNight, red badge |
| Excess D | excessHedMins, amber badge |
| Excess N | excessHenMins, purple badge |

**Visual indicators:**
- Days where the employee was absent: entire row has light red background
- Days that are holidays: date column has a red festivo dot
- Manual corrections: ✏️ icon next to the relevant time, clickable to view correction log

#### 2.5 Correction Log Drawer

Clicking the ✏️ icon on a manually corrected time opens a slide-out drawer showing:
```
Correction History — Carlos Restrepo, Apr 14

Apr 14, 3:22 PM — admin
  Action: Edit clock-out
  Old value: —
  New value: 11:00 PM
  Reason: "Forgot to punch out, confirmed by supervisor"
```

Source: `punch_corrections` table filtered by employee_id + work_date.

**API Routes:**
```
GET /api/attendance?startDate=2026-04-07&endDate=2026-04-13&groupId=1
GET /api/attendance/[employeeId]?startDate=2026-04-07&endDate=2026-04-13
GET /api/corrections?employeeId=1&workDate=2026-04-14
```

---

## Page 3: Employees (`/employees`)

### Purpose
Employee directory with quick stats and management actions.

### Layout

#### 3.1 Header
```
Employees                    [Sync from BioTime ↻] [Add Employee]
```

#### 3.2 Filters
```
┌──────────────────────┐ ┌──────────────────┐ ┌──────────────┐
│ Search: name or code │ │ Group: All ▾     │ │ Status: All ▾│
└──────────────────────┘ └──────────────────┘ └──────────────┘
```

#### 3.3 Employee Cards Grid

Grid of cards (3-4 per row, responsive), each showing:

```
┌─────────────────────────────────────┐
│ CR   Carlos Restrepo                │
│      Kitchen · #1001                │
│                                     │
│  Today        This Period    Comp   │
│  7h 25m       91h / 88h     +14h   │
│                                     │
│  Status: On time ✓                  │
│                                     │
│  [View Details]                     │
└─────────────────────────────────────┘
```

- Avatar: initials with group-colored background
- Group name with colored dot
- Today's hours (from daily_attendance)
- Period hours vs expected (from payroll_periods)
- Comp balance (from comp_transactions)
- Current status badge
- Click "View Details" → `/employees/[id]`

---

## Page 4: Employee Detail (`/employees/[id]`)

### Purpose
Complete profile and history for a single employee.

### Layout

#### 4.1 Header
```
← Back to Employees

Carlos Restrepo                              [Edit Employee]
Kitchen · #1001 · Cédula: 1017234567
Monthly Salary: $2,000,000 · Rest Day: Tuesday
```

#### 4.2 Stats Row (4 cards)
| Card | Value |
|---|---|
| Comp Balance | +14h (from comp_transactions) |
| This Period | 91h / 88h worked vs expected |
| Avg Daily | 7.6h average across current period |
| Late This Period | 27 min total |

#### 4.3 Tabs
```
[Attendance History] [Comp Transactions] [Corrections Log]
```

#### Tab: Attendance History
- Date range picker (default: current period)
- Same daily breakdown table as the attendance page, but for this employee only
- Includes all columns: date, status, in/out, effective, worked, late, all minute buckets

#### Tab: Comp Transactions
- Full ledger of all comp_transactions for this employee
- Columns: Date | Type | Minutes | Balance After | Note | By
- Type badges: "OT Banked" (green), "Comp Day" (blue), "Time Owed" (red), "Offset" (amber)
- Running balance shown in rightmost column

```
Date        Type         Minutes    Balance    Note                           By
Apr 12      OT Banked    +300       +840       Banked 5h from period Mar 28   admin
Apr 10      Comp Day     -420       +540       Monday off (7h debit)          admin
Apr 1       OT Banked    +480       +960       Banked 8h from period Mar 14   admin
Mar 20      Time Owed    -120       +480       Unexplained absence Mar 18     admin
```

#### Tab: Corrections Log
- All punch_corrections for this employee, newest first
- Columns: Date | Action | Old Value | New Value | Reason | By | When

**API Routes:**
```
GET /api/employees
GET /api/employees/[id]
PUT /api/employees/[id]  (update salary, group, rest day, etc.)
GET /api/employees/[id]/attendance?startDate=...&endDate=...
GET /api/employees/[id]/comp-transactions
GET /api/employees/[id]/corrections
```

---

## Page 5: Payroll (`/payroll`)

### Purpose
Manage pay periods — create, view, reconcile, make comp decisions, export to Siigo.

### Layout

#### 5.1 Header
```
Payroll                                        [Create Period]
```

#### 5.2 Period List

Table of all payroll periods, newest first.

**Columns:**
| Column | Description |
|---|---|
| Period | "Mar 28 – Apr 12" date range |
| Days | Number of calendar days |
| Employees | Count of employee records |
| Status | Draft (gray) / Finalized (green) / Exported (blue) / Test (amber) |
| Total Surcharges | Sum of totalSurcharges across all employees |
| Actions | [View] [Export] [Delete] |

- Click row or [View] → navigates to `/payroll/[periodId]`
- [Export] only enabled for finalized periods
- [Delete] only for draft/test periods, with confirmation

#### 5.3 Create Period Modal

Triggered by "Create Period" button.

**Fields:**
- Period Start: date picker
- Period End: date picker
- Type: Regular / Test (radio)
- "This will create records for X active employees"
- [Create] button

**On create:**
1. Creates payroll_periods records for each active employee
2. Runs the period reconciler for each employee
3. Navigates to `/payroll/[periodId]`

---

## Page 6: Period Detail (`/payroll/[periodId]`)

### Purpose
The most important operational page — where the manager reviews overtime, makes comp decisions, and exports to Siigo.

### Layout

#### 6.1 Header
```
← Back to Payroll

Period: Mar 28 – Apr 12, 2026              Status: Draft
16 days · 22 employees                     [Finalize Period] [Export]
```

- [Finalize Period] → confirmation dialog → locks the period
- [Export] → generates both Siigo + readable Excel files
- [Export] only available when status = 'finalized'

#### 6.2 Period Summary Cards (5 columns)

| Card | Value |
|---|---|
| Total Expected | Sum of totalExpectedMins across all employees |
| Total Worked | Sum of totalWorkedMins |
| Total Overtime | Sum of overtimeOwedMins |
| Total Recargos | Sum of totalRecargosCost (formatted as COP) |
| Total Extras | Sum of totalExtrasCost (formatted as COP) |

#### 6.3 Employee Payroll Table

One row per employee with full breakdown.

**Columns:**
| Column | Width | Description |
|---|---|---|
| Employee | 160px | Name + group badge |
| Expected | 70px | totalExpectedMins formatted |
| Worked | 70px | totalWorkedMins formatted |
| Late | 60px | totalLateMins |
| RN | 60px | rnMins formatted + rnCost below |
| RF | 60px | rfMins formatted + rfCost below |
| RFN | 60px | rfnMins formatted + rfnCost below |
| OT Earned | 70px | overtimeOwedMins formatted |
| Comp Offset | 70px | owedOffsetMins (if any, shows debt cleared) |
| OT Available | 70px | after offset |
| Bank Hours | 80px | **EDITABLE INPUT** — manager enters hours to bank |
| OT Paid | 70px | calculated: available - banked |
| HED | 60px | hedMins + hedCost |
| HEN | 60px | henMins + henCost |
| Surcharges | 80px | totalSurcharges formatted as COP |
| Comp Balance | 80px | compBalanceEnd (signed, colored) |

**Key interaction: Bank Hours column**
- This is a number input field (not just display)
- Manager types the number of minutes to bank as comp time
- Min: 0, Max: otAvailable for that employee
- As the manager types, the following columns recalculate live:
  - OT Paid = OT Available - Bank Hours
  - HED / HEN split (proportional to pool ratio)
  - HED Cost / HEN Cost
  - Total Surcharges
  - Comp Balance End

**Row styling:**
- Rows with overtime: subtle amber left border
- Rows with negative comp balance: subtle red left border
- Rows with zero overtime: no special styling

**Footer row:**
- Totals for all numeric columns
- Total surcharges in bold

#### 6.4 Comp Balance Summary (below table)

```
Comp Balance Changes This Period:
  Offsets (debt cleared):    +120 min  (1 employee)
  Banked from OT:           +300 min  (3 employees)
  Comp days taken:           -420 min  (1 employee)
  Time owed:                   0 min
  Net change:                  0 min
```

#### 6.5 Period Actions

**Finalize Period:**
- Confirmation: "This will lock all calculations and comp decisions. You can still export after finalizing. Continue?"
- Sets status = 'finalized', sets finalized_at timestamp
- Creates comp_transactions for all banked hours
- Disables the Bank Hours inputs
- Enables the Export button

**Export (after finalization):**
- Generates two files:
  1. `novedades_siigo_2026_mar28-apr12.xlsx` — Siigo import format
  2. `resumen_nomina_2026_mar28-apr12.xlsx` — readable 5-sheet summary
- Both files download as a ZIP or sequential downloads
- Details of export format are in Phase 5 spec

**Delete Period:**
- Only for draft/test periods
- Confirmation: "This will delete all payroll records for this period. Comp transactions will be reversed. Continue?"
- Deletes payroll_periods records
- Reverses any comp_transactions created for this period

---

## API Routes Summary

### Dashboard
```
GET  /api/dashboard/today          → KPI cards + today's attendance
GET  /api/dashboard/period-tracker → current period hours per employee
GET  /api/dashboard/comp-balances  → comp balance per employee
GET  /api/dashboard/alerts         → missing punches, overdue periods
POST /api/biotime/sync             → manual sync trigger
```

### Attendance
```
GET  /api/attendance?startDate&endDate&groupId
     → daily attendance records with employee info
GET  /api/attendance/[employeeId]?startDate&endDate
     → single employee daily records
GET  /api/corrections?employeeId&workDate
     → correction audit log
POST /api/punches
     → add manual punch (creates punch_log + punch_correction + recalculates)
PUT  /api/punches/[id]
     → edit punch time (creates punch_correction + recalculates)
```

### Employees
```
GET    /api/employees?search&groupId&isActive
       → employee list with current stats
GET    /api/employees/[id]
       → single employee with full details
PUT    /api/employees/[id]
       → update employee (salary, group, rest day, cedula)
GET    /api/employees/[id]/attendance?startDate&endDate
       → attendance history
GET    /api/employees/[id]/comp-transactions
       → comp ledger
GET    /api/employees/[id]/corrections
       → all corrections
POST   /api/employees/sync
       → sync employees from BioTime
```

### Payroll
```
GET    /api/payroll
       → list all periods
POST   /api/payroll
       → create new period (runs reconciler for all employees)
GET    /api/payroll/[periodId]
       → period detail with all employee records
PUT    /api/payroll/[periodId]/comp-decision
       → save manager's bank decisions for all employees
POST   /api/payroll/[periodId]/finalize
       → lock period + create comp transactions
DELETE /api/payroll/[periodId]
       → delete draft/test period + reverse comp transactions
POST   /api/payroll/[periodId]/recalculate
       → re-run reconciler (useful if punches were corrected)
GET    /api/payroll/[periodId]/export/siigo
       → generate Siigo Excel
GET    /api/payroll/[periodId]/export/summary
       → generate readable Excel
```

---

## Components to Build

### Shared / Reusable
```
src/components/ui/
├── Badge.tsx              → status badges (on-time, late, absent, etc.)
├── GroupBadge.tsx          → group name with colored dot
├── TimeBadge.tsx           → monospace time display with optional edit icon
├── CompBalanceBadge.tsx    → signed comp balance (+14h green, -3h red)
├── ProgressBar.tsx         → horizontal bar for period hours tracking
├── DateRangePicker.tsx     → start/end date inputs
├── Modal.tsx               → reusable modal wrapper
├── ConfirmDialog.tsx       → confirmation dialog with message + confirm/cancel
├── EmptyState.tsx          → "No data" placeholder
├── LoadingSpinner.tsx      → loading indicator
└── CurrencyDisplay.tsx     → format COP amounts ($2,000,000)
```

### Dashboard
```
src/components/dashboard/
├── KPICards.tsx            → 4-card grid with trends
├── AlertBanners.tsx        → missing punches + overdue period alerts
├── TodayAttendanceTable.tsx → full attendance table with actions
├── PeriodTracker.tsx       → hours progress bars per employee
└── CompBalanceCard.tsx     → comp balance list
```

### Attendance
```
src/components/attendance/
├── AttendanceFilters.tsx    → date range + group filter
├── AttendanceSummary.tsx    → 3 summary cards
├── AttendanceTable.tsx      → main table with expandable rows
├── DailyBreakdownRow.tsx    → expanded sub-table per employee
├── PunchCorrectionModal.tsx → add/edit punch with reason (from Phase 2)
├── MissingPunchAlert.tsx    → inline alert for missing punches
└── CorrectionDrawer.tsx     → slide-out correction history
```

### Employees
```
src/components/employees/
├── EmployeeGrid.tsx         → card grid with search/filter
├── EmployeeCard.tsx         → individual card with stats
├── EmployeeDetail.tsx       → full profile header + stats
├── EmployeeTabs.tsx         → tab navigation
├── AttendanceHistoryTab.tsx  → attendance sub-table
├── CompTransactionsTab.tsx   → comp ledger table
├── CorrectionsTab.tsx        → corrections audit table
└── EditEmployeeModal.tsx     → edit salary, group, rest day, cedula
```

### Payroll
```
src/components/payroll/
├── PeriodList.tsx           → table of all periods
├── CreatePeriodModal.tsx    → date picker + type selector
├── PeriodHeader.tsx         → period info + action buttons
├── PeriodSummaryCards.tsx   → 5 summary cards
├── PayrollTable.tsx         → main table with bank inputs
├── PayrollRow.tsx           → single employee row with live calculations
├── CompSummary.tsx          → comp balance changes summary
├── FinalizeDialog.tsx       → finalize confirmation
└── DeletePeriodDialog.tsx   → delete confirmation
```

---

## Data Formatting Standards

Apply consistently across ALL components:

### Time/Duration
```
Minutes to display:
  420 min → "7h 0m"
  475 min → "7h 55m"
  90 min  → "1h 30m"
  0 min   → "0m"
  
Clock times (from timestamps):
  Use monospace font (JetBrains Mono)
  24h format: "17:00", "02:30"
  Or 12h format: "5:00 PM", "2:30 AM" (pick one, be consistent)
```

### Currency (COP)
```
Use Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
  15909 → "$15,909"
  2000000 → "$2,000,000"
```

### Dates
```
Full: "Monday, April 14, 2026"
Medium: "Apr 14, 2026"
Short: "Apr 14"
Period range: "Mar 28 – Apr 12, 2026"
```

### Percentages
```
82.456% → "82%"  (round to integer for display)
```

---

## Real-Time Behavior

### Auto-refresh
- Dashboard KPIs and attendance table auto-refresh every 60 seconds
- Use SWR or React Query with `refreshInterval: 60000`
- Show a subtle "Last updated: 10:42 AM" timestamp

### After BioTime sync
- When sync completes (manual or cron), the dashboard should reflect new data
- Sync endpoint returns affected employee+date pairs
- Client invalidates those specific queries

### After punch correction
- When a punch is added/edited, the daily attendance recalculates
- The API returns the updated daily_attendance record
- Client updates the specific row without full page reload

---

## Responsive Design

### Desktop (≥ 1280px)
- Full sidebar visible
- Tables show all columns
- Cards in 4-column grid

### Tablet (768px – 1279px)
- Sidebar collapses to icon-only mode (expandable on click)
- Tables hide less important columns (effective times, individual minute buckets)
- Cards in 2-column grid

### Mobile (< 768px)
- Sidebar becomes a top hamburger menu
- Tables become card-based layouts (one card per employee)
- KPIs stack vertically (2x2 grid)
- Period tracker becomes a simple list

---

## Error States

### Empty states
- No attendance data: "No attendance records for this date range"
- No payroll periods: "No pay periods created yet. [Create Period →]"
- No employees in group: "No employees in this group. [Manage Groups →]"

### Loading states
- Skeleton loaders for tables (gray pulsing rows)
- Spinner for KPI cards
- "Calculating..." overlay for payroll reconciliation

### Error states  
- BioTime sync failed: toast notification "Sync failed: connection timeout. Will retry in 10 minutes."
- Calculation error: inline error message on affected row "Calculation error — missing schedule for this day"
- API error: toast notification with error message

---

## Testing Checklist

### Dashboard
- [ ] KPI cards show correct counts for today
- [ ] Trend indicators compare to last week
- [ ] Missing punch alert appears when relevant
- [ ] Period overdue alert appears when relevant
- [ ] Group filter works on attendance table
- [ ] Click clock-in/out opens correction modal
- [ ] Period tracker shows correct progress bars
- [ ] Comp balances display correctly (positive green, negative red)
- [ ] Manual sync button triggers sync and refreshes data
- [ ] Auto-refresh updates data every 60s

### Attendance
- [ ] Date range filter works
- [ ] Group filter works
- [ ] Summary cards calculate correctly for selected range
- [ ] Expanding a row shows daily breakdown
- [ ] Daily breakdown shows all minute classification columns
- [ ] Holiday dates show festivo indicator
- [ ] Manual corrections show ✏️ icon
- [ ] Clicking ✏️ opens correction drawer
- [ ] Export CSV generates correct file

### Employees
- [ ] Search by name and code works
- [ ] Group and status filters work
- [ ] Employee cards show today's stats
- [ ] Employee detail shows full profile
- [ ] Attendance history tab works with date range
- [ ] Comp transactions tab shows full ledger
- [ ] Corrections tab shows audit trail
- [ ] Edit employee modal saves changes

### Payroll
- [ ] Period list shows all periods with correct status
- [ ] Create period modal validates dates and creates records
- [ ] Period detail shows all employee rows with calculations
- [ ] Bank Hours input is editable (min 0, max OT available)
- [ ] Changing Bank Hours recalculates OT Paid, HED, HEN, costs live
- [ ] Comp offset shows correctly for employees with negative balance
- [ ] Finalize locks the period and creates comp transactions
- [ ] Delete removes draft/test periods and reverses comp transactions
- [ ] Recalculate re-runs the engine and updates all values
- [ ] Export is only available for finalized periods
- [ ] Test periods cannot be exported
