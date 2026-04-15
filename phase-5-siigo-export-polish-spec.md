# Phase 5 — Siigo Export & Polish (Detailed Specification)

## Overview

Build the Siigo Nube export system (two Excel files per period), the concept code mapping UI, edge case handling for missing/incomplete data, an alert system for managers, and mobile-responsive polish across all pages.

---

## Part A: Siigo Export System

### A.1 Export Architecture

```
Finalized payroll_period
         ↓
Export Engine (server-side, runs in API route)
         ↓
    ┌────┴────┐
    │         │
    ▼         ▼
Siigo File   Summary File
(.xlsx)      (.xlsx, 5 sheets)
    │         │
    └────┬────┘
         ▼
   ZIP download
   novedades_2026_mar28-apr12.zip
```

Both files are generated server-side using **ExcelJS** library. Install:
```bash
pnpm add exceljs
```

### A.2 File 1: Siigo-Ready Import

**Filename:** `novedades_siigo_{periodStart}_{periodEnd}.xlsx`
Example: `novedades_siigo_2026-03-28_2026-04-12.xlsx`

**Purpose:** Upload directly into Siigo Nube → Nómina Electrónica → Novedades → "Subir formato de Excel"

**Sheet name:** "Novedades"

**Column structure (must match Siigo's expected format exactly):**

| Column | Header | Type | Description | Example |
|---|---|---|---|---|
| A | Identificación | Text | Employee cédula (from employees.cedula) | 1017234567 |
| B | Concepto | Text | Siigo concept code (from mapping) | HED |
| C | Horas | Number (2 decimals) | Hours (minutes ÷ 60, rounded to 2 decimals) | 4.50 |
| D | Valor | Number (0 decimals) | Calculated value in COP (optional — Siigo can auto-calc) | 45000 |

**Rows generated per employee:**
Only include rows where minutes > 0. Skip zero-value concepts entirely.

```
For each employee in the finalized period:
  If rnMins > 0:     → row with concept "RN",  hours = rnMins/60,  valor = rnCost
  If rfMins > 0:     → row with concept "RF",  hours = rfMins/60,  valor = rfCost
  If rfnMins > 0:    → row with concept "RFN", hours = rfnMins/60, valor = rfnCost
  If hedMins > 0:    → row with concept "HED", hours = hedMins/60, valor = hedCost
  If henMins > 0:    → row with concept "HEN", hours = henMins/60, valor = henCost
```

**CRITICAL:** Only PAID overtime goes here. Banked comp hours are excluded. Recargos are always included regardless of comp decisions.

**Concept code mapping:**
The internal codes (RN, RF, RFN, HED, HEN) may not match the exact codes configured in the user's Siigo instance. The mapping is stored in the `settings` table and configurable via the Settings page:

```
settings key                    | default value | description
siigo_concept_hed               | HED           | Hora extra diurna
siigo_concept_hen               | HEN           | Hora extra nocturna
siigo_concept_rn                | RN            | Recargo nocturno
siigo_concept_rf                | RF            | Recargo festivo diurno
siigo_concept_rfn               | RFN           | Recargo festivo nocturno
siigo_include_valor             | true          | Include calculated value column
siigo_identification_field      | cedula        | Which employee field to use (cedula or emp_code)
```

**Excel formatting:**
- No colors, no borders, no merged cells — plain data that Siigo can parse
- Header row in row 1 (Siigo expects headers)
- Data starts from row 2
- Column A: text format (prevent leading-zero cédula truncation)
- Column C: number format "0.00"
- Column D: number format "#,##0" (Colombian thousands separator)

**Validation before export:**
- All employees in the period must have a cédula set
- If any employee is missing cédula: block export with error listing which employees need it
- All concept code mappings must be configured
- Period must be in 'finalized' status

### A.3 File 2: Readable Summary

**Filename:** `resumen_nomina_{periodStart}_{periodEnd}.xlsx`
Example: `resumen_nomina_2026-03-28_2026-04-12.xlsx`

**Purpose:** Human-readable report for the manager and accountant. Contains full detail that Siigo doesn't need but the business does.

**5 sheets:**

---

#### Sheet 1: "Resumen" (Summary per employee)

One row per employee with all period totals.

| Column | Header | Format | Source |
|---|---|---|---|
| A | Empleado | text | firstName + lastName |
| B | Cédula | text | employees.cedula |
| C | Código | text | employees.empCode |
| D | Grupo | text | groups.name |
| E | Salario Mensual | COP | employees.monthlySalary |
| F | Valor Hora | COP | payroll_periods.horaOrdinariaValue |
| G | Días Programados | integer | payroll_periods.daysScheduled |
| H | Días Trabajados | integer | payroll_periods.daysWorked |
| I | Días Ausente | integer | payroll_periods.daysAbsent |
| J | Horas Esperadas | "Xh Ym" | payroll_periods.totalExpectedMins |
| K | Horas Trabajadas | "Xh Ym" | payroll_periods.totalWorkedMins |
| L | Minutos Tarde | integer | payroll_periods.totalLateMins |
| M | Recargo Nocturno (h) | decimal | payroll_periods.rnMins / 60 |
| N | Recargo Nocturno ($) | COP | payroll_periods.rnCost |
| O | Recargo Festivo D (h) | decimal | payroll_periods.rfMins / 60 |
| P | Recargo Festivo D ($) | COP | payroll_periods.rfCost |
| Q | Recargo Festivo N (h) | decimal | payroll_periods.rfnMins / 60 |
| R | Recargo Festivo N ($) | COP | payroll_periods.rfnCost |
| S | Total Recargos ($) | COP | payroll_periods.totalRecargosCost |
| T | HE Generadas (h) | decimal | overtimeOwedMins / 60 |
| U | HE Compensadas (h) | decimal | otBankedMins / 60 |
| V | HE Pagadas Diurna (h) | decimal | hedMins / 60 |
| W | HE Pagadas Diurna ($) | COP | hedCost |
| X | HE Pagadas Nocturna (h) | decimal | henMins / 60 |
| Y | HE Pagadas Nocturna ($) | COP | henCost |
| Z | Total Extras ($) | COP | totalExtrasCost |
| AA | Total Recargos + Extras ($) | COP | totalSurcharges |
| AB | Balance Comp Inicio | "Xh" | compBalanceStart / 60 |
| AC | Balance Comp Fin | "Xh" | compBalanceEnd / 60 |

**Formatting:**
- Header row: bold, light gray background, frozen row
- COP columns: "#,##0" format with $ prefix
- Hour columns: "0.00" format
- Alternating row colors (very subtle gray/white)
- Last row: TOTALS in bold

---

#### Sheet 2: "Detalle Diario" (Daily detail)

One row per employee per day in the period.

| Column | Header | Source |
|---|---|---|
| A | Empleado | firstName + lastName |
| B | Código | empCode |
| C | Fecha | workDate formatted as "YYYY-MM-DD" |
| D | Día | day name ("Lunes", "Martes", etc.) |
| E | Festivo | "Sí" if holiday, blank if not |
| F | Estado | status (translated: "A tiempo", "Tarde", "Ausente", "Descanso", "Compensatorio") |
| G | Entrada Real | clockIn time |
| H | Salida Real | clockOut time |
| I | Entrada Efectiva | effectiveIn time |
| J | Salida Efectiva | effectiveOut time |
| K | Corrección | "Sí" if isClockInManual or isClockOutManual |
| L | Programado Inicio | scheduledStart |
| M | Programado Fin | scheduledEnd |
| N | Turno Partido | "Sí" if isSplitShift |
| O | Mins Trabajados | totalWorkedMins |
| P | Mins Tarde | lateMinutes |
| Q | Mins Salida Temprana | earlyLeaveMins |
| R | Ordinario Diurno (min) | minsOrdinaryDay |
| S | Nocturno (min) | minsNocturno |
| T | Festivo Diurno (min) | minsFestivoDay |
| U | Festivo Nocturno (min) | minsFestivoNight |
| V | Exceso Diurno (min) | excessHedMins |
| W | Exceso Nocturno (min) | excessHenMins |
| X | Límite Diario (min) | dailyLimitMins |

**Formatting:**
- Sorted by employee name, then by date
- Holiday rows: light red background tint
- Late rows: light amber background tint
- Absent rows: light red text
- Frozen header row + frozen first 2 columns (employee + code)

---

#### Sheet 3: "Costos" (Cost breakdown)

Detailed cost calculation per employee showing the math.

| Column | Header | Source |
|---|---|---|
| A | Empleado | name |
| B | Salario | monthlySalary |
| C | Divisor | 220 or 210 |
| D | Valor Hora | monthlySalary / divisor |
| E | Concepto | "RN" / "RF" / "RFN" / "HED" / "HEN" |
| F | Horas | minutes / 60 |
| G | Factor | 0.35 / 0.80 / 1.15 / 1.25 / 1.75 |
| H | Cálculo | "valor_hora × factor × horas" |
| I | Costo | calculated amount in COP |

Multiple rows per employee (one per concept with hours > 0). This sheet shows the complete math so the accountant can verify any number.

**Example rows for Carlos Restrepo:**
```
Carlos Restrepo | $2,000,000 | 220 | $9,091 | RN  | 10.0 | ×0.35 | $9,091 × 0.35 × 10.0 | $31,819
Carlos Restrepo | $2,000,000 | 220 | $9,091 | HED |  1.5 | ×1.25 | $9,091 × 1.25 × 1.5  | $17,045
Carlos Restrepo | $2,000,000 | 220 | $9,091 | HEN |  1.5 | ×1.75 | $9,091 × 1.75 × 1.5  | $23,864
```

**Formatting:**
- Group rows by employee with a subtle separator
- Factor column: formatted as "×0.35", "×1.25" etc.
- Cálculo column: shows the formula as text for transparency

---

#### Sheet 4: "Festivos" (Holiday tracking)

Holidays that fell within the period and which employees worked them.

| Column | Header |
|---|---|
| A | Fecha | holiday date |
| B | Festivo | holiday name |
| C | Empleado | employee who worked that day |
| D | Horas Diurnas | minsFestivoDay / 60 |
| E | Horas Nocturnas | minsFestivoNight / 60 |
| F | Costo Recargo | rfCost + rfnCost for that day |

If no holidays in the period: single row "No hubo festivos en este período"

---

#### Sheet 5: "Compensatorio" (Comp time ledger)

Comp balance movements during the period per employee.

| Column | Header |
|---|---|
| A | Empleado | name |
| B | Balance Inicio | compBalanceStart formatted as hours |
| C | Offset Deuda | compOffsetMins formatted as hours (+ if debt cleared) |
| D | HE Compensadas | compCreditedMins formatted as hours |
| E | Días Comp Tomados | compDebitedMins formatted as hours |
| F | Tiempo Adeudado | compOwedMins formatted as hours |
| G | Balance Final | compBalanceEnd formatted as hours |
| H | Estado | "Positivo" / "Cero" / "Negativo (debe)" |

**Formatting:**
- Positive balances: green text
- Negative balances: red text
- Zero: gray text
- Footer row with totals

---

### A.4 Export API Routes

```
GET /api/payroll/[periodId]/export/siigo
```
- Validates: period is finalized, all employees have cédula, concept codes mapped
- Returns: .xlsx file as download (Content-Disposition: attachment)
- Sets period status to 'exported' after successful generation

```
GET /api/payroll/[periodId]/export/summary
```
- No validation requirements (can export draft for review)
- Returns: .xlsx file as download

```
GET /api/payroll/[periodId]/export/both
```
- Generates both files, bundles in ZIP
- Returns: .zip file as download

### A.5 Export Implementation

```typescript
// src/lib/export/siigo-export.ts

import ExcelJS from 'exceljs';

interface SiigoExportConfig {
  conceptHed: string;    // from settings
  conceptHen: string;
  conceptRn: string;
  conceptRf: string;
  conceptRfn: string;
  includeValor: boolean;
  identificationField: 'cedula' | 'emp_code';
}

async function generateSiigoExcel(
  periodId: number,
  config: SiigoExportConfig
): Promise<ExcelJS.Workbook>

// src/lib/export/summary-export.ts

async function generateSummaryExcel(
  periodId: number
): Promise<ExcelJS.Workbook>

// src/lib/export/zip-bundle.ts

async function generateExportZip(
  periodId: number
): Promise<Buffer>
```

---

## Part B: Settings Page — Concept Code Mapping

### B.1 Settings Page (`/settings`)

The settings page has multiple sections. Add a new section for Siigo configuration.

### B.2 Settings Layout

```
Settings
├── BioTime Connection (already built in Phase 1)
│   ├── Server URL
│   ├── Username / Password
│   ├── Connection status
│   └── [Test Connection] [Save]
│
├── Daily Limits & Overtime
│   ├── Sun–Thu daily limit: [420] min (7h)
│   ├── Fri–Sat daily limit: [480] min (8h)
│   ├── Business day start hour: [6] (6 AM)
│   └── [Save]
│
├── Siigo Export Configuration          ← NEW
│   ├── Identification field: [Cédula ▾] or [Código empleado ▾]
│   ├── Include calculated value: [✓]
│   ├── Concept Code Mapping:
│   │   ├── Hora extra diurna:         [HED    ]  → Siigo group 005
│   │   ├── Hora extra nocturna:       [HEN    ]  → Siigo group 006
│   │   ├── Recargo nocturno:          [RN     ]  → Siigo group 009
│   │   ├── Recargo festivo diurno:    [RF     ]  → Siigo group 010
│   │   └── Recargo festivo nocturno:  [RFN    ]  → Siigo group 011
│   └── [Save]
│
├── Holiday Management
│   ├── Year selector: [2026 ▾]
│   ├── Holiday list with add/remove
│   │   ├── Jan 1 — Año Nuevo                    [✕]
│   │   ├── Jan 12 — Reyes Magos                  [✕]
│   │   ├── ...
│   │   └── Dec 25 — Navidad                      [✕]
│   ├── [+ Add Holiday] → date picker + name input
│   └── [Reset to Default] → reloads Colombian 2026 holidays
│
└── Admin Users
    ├── User list
    │   ├── admin (superadmin) — Active ✓  [Edit] [Disable]
    │   └── manager1 (admin) — Active ✓    [Edit] [Disable]
    ├── [+ Add User] → username, email, password, role
    └── Disable user → sets is_active=false, deletes sessions
```

### B.3 Settings API Routes

```
GET  /api/settings                    → all settings as key-value object
PUT  /api/settings                    → bulk update settings
GET  /api/settings/holidays?year=2026 → holidays for a year
POST /api/settings/holidays           → add a holiday
DELETE /api/settings/holidays/[date]  → remove a holiday
POST /api/settings/holidays/reset     → reset to Colombian defaults for year
GET  /api/admin-users                 → list admin users
POST /api/admin-users                 → create admin user
PUT  /api/admin-users/[id]            → update admin user
PUT  /api/admin-users/[id]/disable    → disable + delete sessions
```

### B.4 Holiday Storage

Holidays are stored in the `settings` table as a JSON array:

```
key: "holidays_2026"
value: '[
  {"date":"2026-01-01","name":"Año Nuevo"},
  {"date":"2026-01-12","name":"Reyes Magos"},
  ...
]'
```

The hardcoded `COLOMBIAN_HOLIDAYS_2026` array in `src/lib/holidays.ts` is used as the default seed. The settings override takes precedence at runtime.

```typescript
// Updated src/lib/holidays.ts
export async function getHolidays(year: number): Promise<Holiday[]> {
  // 1. Check settings table for holidays_{year}
  const stored = await db.select().from(settings).where(eq(settings.key, `holidays_${year}`));
  if (stored.length > 0 && stored[0].value) {
    return JSON.parse(stored[0].value);
  }
  // 2. Fall back to hardcoded defaults
  return getDefaultHolidays(year);
}
```

---

## Part C: Edge Case Handling

### C.1 Missing Clock-Out Resolution

**Current state:** If an employee has clock_in but no clock_out, the daily_attendance record has `is_missing_punch = true` and NO calculations are done (totalWorkedMins = 0).

**Enhancement:** Add a "Resolve Missing Punches" workflow before period finalization.

**Flow:**
```
Manager opens payroll period → clicks "Finalize"
         ↓
System checks: are there any daily_attendance records in this period
with is_missing_punch = true?
         ↓
If YES → block finalization, show modal:
  "Cannot finalize — X days have missing punches:
   
   Carlos Restrepo — Apr 8 — clocked in at 8:00 AM, no clock-out
   Valentina Ospina — Apr 10 — clocked in at 5:00 PM, no clock-out
   
   [Go to Attendance →] to resolve these first."
         ↓
If NO → proceed with finalization
```

**Bulk resolution helper:**
Add a "Missing Punches" tab or filter on the Attendance page that shows ONLY records with `is_missing_punch = true`, grouped by date. Each row has a quick "Add clock-out" button that opens the PunchCorrectionModal pre-filled for that employee+date.

### C.2 Employee Without Schedule

**Scenario:** An employee has punches but no schedule for that day (manager forgot to create the schedule).

**Handling:**
- Daily classifier detects: no shift record found for employee_id + workDate
- Sets `status = 'unscheduled'` on the daily_attendance record
- All calculations still run, but using DEFAULT schedule assumptions:
  - scheduledStart = clockIn time (assume they were on time)
  - scheduledEnd = clockIn + dailyLimitMins
  - No gap, no break
- A warning flag is set: `is_unscheduled = true` (add this to daily_attendance)
- The dashboard shows these in an "Unscheduled Shifts" alert

**Add to daily_attendance schema:**
```sql
is_unscheduled BOOLEAN DEFAULT FALSE  -- punches exist but no schedule
```

### C.3 Employee Without Salary

**Scenario:** Employee was synced from BioTime but salary hasn't been set yet.

**Handling:**
- Daily classification runs normally (minutes are classified)
- Cost calculation in the period reconciler skips this employee
- Period record is created with all minute totals but zero costs
- Warning on payroll page: "Carlos Restrepo has no salary set. Costs cannot be calculated. [Edit Employee →]"
- Block Siigo export if any employee has null salary

### C.4 Employee Without Cédula

**Scenario:** Employee has salary and calculations but no cédula for Siigo export.

**Handling:**
- All calculations run normally
- Siigo export validation checks all employees have cédula
- If missing: block export with specific error listing employees
- Does NOT block period finalization (you can finalize without cédula)

### C.5 Overlapping Pay Periods

**Scenario:** Manager accidentally creates a period that overlaps with an existing one.

**Handling:**
- On period creation, check for overlapping date ranges per employee:
  ```sql
  SELECT * FROM payroll_periods 
  WHERE employee_id = ? 
    AND period_start <= ? -- new period end
    AND period_end >= ?   -- new period start
    AND status != 'test'
  ```
- If overlap found: block creation with error "Period overlaps with existing period [Start – End]"
- Test periods are excluded from overlap checks

### C.6 Retroactive Schedule Changes

**Scenario:** Manager changes a schedule for a past date after attendance has already been calculated.

**Handling:**
- When a shift is updated or deleted for a past date:
  1. Show warning: "This date has already been calculated. Changing the schedule will trigger a recalculation."
  2. On confirm: update the shift, then automatically recalculate daily_attendance for the affected employee+date
  3. If a payroll period includes this date and is in 'draft' status: recalculate the period too
  4. If the period is 'finalized': block the change with "Cannot modify schedule for a finalized period"

### C.7 BioTime Sync Gaps

**Scenario:** BioTime server was offline for 2 hours, then comes back. The sync catches up.

**Handling:**
- The sync uses `last_sync_time` from settings
- When sync resumes, it fetches all transactions from `last_sync_time` to now
- This may span multiple hours — could be thousands of transactions
- Process in batches of 500 to avoid timeouts
- After inserting all new punch_logs, recalculate daily_attendance for all affected employee+date combos
- Update `last_sync_time` to now only AFTER all processing is complete
- If sync fails midway: `last_sync_time` is NOT updated, so the next sync will retry from the same point

### C.8 Duplicate Punches from BioTime

**Scenario:** BioTime sends the same transaction twice (same biotime_id).

**Handling:**
- `punch_logs.biotime_id` has a UNIQUE constraint
- INSERT with ON CONFLICT DO NOTHING
- Duplicate silently ignored, no error

### C.9 Zero-Hour Work Days

**Scenario:** Employee clocked in and out within minutes (e.g., forgot something, came back, or testing the device).

**Handling:**
- If totalWorkedMins < 15 (less than 15 minutes): treat as a false punch
- Set status = 'false-punch', do NOT count toward attendance
- Show in dashboard alerts: "Carlos Restrepo — Apr 14 — clocked in/out within 3 minutes (possible false punch)"
- Manager can dismiss or keep

**Add to daily_attendance status options:**
```
'on-time' | 'late' | 'absent' | 'day-off' | 'comp-day-off' | 'false-punch' | 'unscheduled'
```

---

## Part D: Alert System

### D.1 Alert Types

Alerts are NOT stored in the database — they're computed on each dashboard load from the current data state. This keeps them always up-to-date without sync issues.

| Alert | Priority | Condition | Action |
|---|---|---|---|
| Missing Punch | High (red) | daily_attendance.is_missing_punch = true for today or yesterday | [Fix] → PunchCorrectionModal |
| Unscheduled Shift | High (amber) | daily_attendance.is_unscheduled = true for today | [Create Schedule →] |
| False Punch | Medium (amber) | daily_attendance.status = 'false-punch' for today | [Dismiss] or [Review] |
| Period Overdue | High (red) | payroll_period with end_date < today and status = 'draft' | [Go to Payroll →] |
| No Active Period | Medium (blue) | No payroll_period with status = 'draft' | [Create Period →] |
| Missing Salary | Medium (amber) | Employee with is_active=true and monthly_salary is null | [Edit Employee →] |
| Missing Cédula | Low (gray) | Employee with is_active=true and cedula is null | [Edit Employee →] |
| High Comp Balance | Low (blue) | Employee with comp_balance > 2520 (42h) | Informational only |
| Negative Comp Balance | Medium (amber) | Employee with comp_balance < 0 | Informational only |
| BioTime Sync Stale | Medium (amber) | last_sync_time > 30 minutes ago | [Sync Now] |

### D.2 Alert API

```
GET /api/dashboard/alerts
```

Response:
```json
{
  "alerts": [
    {
      "type": "missing_punch",
      "priority": "high",
      "title": "Missing Punches",
      "count": 2,
      "items": [
        {
          "employeeId": 2,
          "employeeName": "Valentina Ospina",
          "date": "2026-04-14",
          "detail": "No clock-out",
          "action": "fix_punch"
        }
      ]
    },
    {
      "type": "period_overdue",
      "priority": "high",
      "title": "Period Overdue",
      "count": 1,
      "items": [
        {
          "periodId": 5,
          "periodRange": "Mar 28 – Apr 12",
          "detail": "Ended 2 days ago, still in draft",
          "action": "go_to_payroll"
        }
      ]
    }
  ]
}
```

### D.3 Alert Display

**Dashboard:** alerts appear as colored banners between the KPI cards and the attendance table. Each alert type gets its own banner. Banners are collapsible.

**Layout:**
```
[!] Missing Punches (2)                                    [Collapse ▾]
    Valentina Ospina — Apr 14 — No clock-out        [Fix]
    Diego Ríos — Apr 14 — No clock-in               [Fix]

[!] Period Overdue                                         [Collapse ▾]
    Period Mar 28 – Apr 12 ended 2 days ago          [Go to Payroll →]
```

**Priority-based ordering:**
1. High (red/amber background)
2. Medium (amber/blue background)
3. Low (gray/blue background)

**Dismissible:** Some alerts (false-punch, informational) can be dismissed for the session. Others (missing punch, period overdue) persist until resolved.

---

## Part E: Mobile Responsive Polish

### E.1 Breakpoint System

```css
/* Tailwind breakpoints */
sm: 640px    /* phone landscape */
md: 768px    /* tablet portrait */
lg: 1024px   /* tablet landscape / small laptop */
xl: 1280px   /* desktop */
2xl: 1536px  /* large desktop */
```

### E.2 Sidebar

**Desktop (≥ 1024px):** Full sidebar, always visible, 240px wide
**Tablet (768-1023px):** Collapsed sidebar, 64px wide, icons only. Hover to expand with overlay.
**Mobile (< 768px):** Sidebar hidden. Hamburger menu in top-left. Tap to open as full-screen overlay.

```typescript
// src/components/layout/Sidebar.tsx

// State
const [isExpanded, setIsExpanded] = useState(false);
const isMobile = useMediaQuery('(max-width: 767px)');
const isTablet = useMediaQuery('(min-width: 768px) and (max-width: 1023px)');

// Collapsed mode: show only icons, 64px wide
// Expanded mode: full 240px with labels
// Mobile: overlay with backdrop
```

### E.3 Tables → Cards on Mobile

All tables should have a mobile-friendly alternative. Use the `useMediaQuery` hook to switch between table and card views.

**Desktop:** Standard table with columns
**Mobile:** Each row becomes a card:

```
┌─────────────────────────────┐
│ CR  Carlos Restrepo         │
│     Kitchen · #1001         │
│                             │
│  In: 8:00 AM   Out: 5:12 PM│
│  Worked: 8h 45m             │
│  Late: 0    Excess: +45m    │
│  Status: On time ✓          │
└─────────────────────────────┘
```

### E.4 Schedule Grid on Mobile

The 7-column grid doesn't fit on mobile. Options:
- Horizontal scroll with sticky first column (employee names)
- Or switch to a day-by-day view: select a day, see all employees for that day

**Recommendation:** Horizontal scroll with sticky column. It's simpler and matches how managers think about the schedule.

```css
.schedule-grid-wrapper {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
.schedule-grid .employee-column {
  position: sticky;
  left: 0;
  z-index: 10;
  background: white;
}
```

### E.5 Payroll Table on Mobile

The payroll table has many columns. On mobile:
- Show only: Employee, Worked, OT Earned, Bank Input, Total Surcharges
- Tap row to expand full detail in a card/accordion

### E.6 Touch Interactions

- All clickable areas: minimum 44px × 44px touch target
- Swipe left on attendance row → quick action: [Edit Clock-Out]
- Pull-to-refresh on dashboard → trigger BioTime sync

---

## Components to Build

```
src/lib/export/
├── siigo-export.ts          → Siigo Excel generator
├── summary-export.ts        → Readable summary Excel generator
└── zip-bundle.ts            → ZIP both files together

src/components/settings/
├── SettingsPage.tsx          → full settings layout with sections
├── BioTimeSettings.tsx       → connection config (already exists)
├── DailyLimitsSettings.tsx   → daily limit inputs
├── SiigoSettings.tsx         → concept code mapping + export config
├── HolidaySettings.tsx       → holiday list with add/remove/reset
└── AdminUserSettings.tsx     → user management + disable

src/components/alerts/
├── AlertBanner.tsx           → single alert banner (collapsible)
├── AlertContainer.tsx        → stacks all alerts by priority
└── MissingPunchAlert.tsx     → specific missing punch alert with Fix buttons

src/components/layout/
├── Sidebar.tsx               → responsive sidebar (update existing)
├── MobileMenu.tsx            → hamburger overlay for mobile
└── ResponsiveTable.tsx       → table that switches to cards on mobile
```

---

## API Routes Summary

```
# Export
GET  /api/payroll/[periodId]/export/siigo     → Siigo Excel download
GET  /api/payroll/[periodId]/export/summary   → Summary Excel download
GET  /api/payroll/[periodId]/export/both      → ZIP download

# Settings
GET  /api/settings                            → all settings
PUT  /api/settings                            → bulk update
GET  /api/settings/holidays?year=2026         → holidays list
POST /api/settings/holidays                   → add holiday
DELETE /api/settings/holidays/[date]          → remove holiday
POST /api/settings/holidays/reset             → reset to defaults

# Admin Users
GET    /api/admin-users                       → list users
POST   /api/admin-users                       → create user
PUT    /api/admin-users/[id]                  → update user
PUT    /api/admin-users/[id]/disable          → disable + kill sessions

# Alerts
GET  /api/dashboard/alerts                    → computed alerts
```

---

## Testing Checklist

### Siigo Export
- [ ] Export only includes rows where minutes > 0
- [ ] Concept codes match settings configuration
- [ ] Cédula column is text format (no leading zero truncation)
- [ ] Hours are rounded to 2 decimal places
- [ ] COP values use Colombian number formatting
- [ ] Only PAID overtime in export (banked hours excluded)
- [ ] Recargos always included regardless of comp decisions
- [ ] Export blocked when employee missing cédula
- [ ] Export blocked when period not finalized
- [ ] Export sets period status to 'exported'

### Readable Summary
- [ ] Sheet 1 (Resumen): all columns present with correct totals
- [ ] Sheet 2 (Detalle): one row per employee per day, correct minute buckets
- [ ] Sheet 3 (Costos): formula shown for each concept, math is correct
- [ ] Sheet 4 (Festivos): only holidays in the period, correct employees
- [ ] Sheet 5 (Compensatorio): balance tracks correctly start→end
- [ ] Formatting: frozen headers, alternating rows, COP format

### Settings
- [ ] Concept code mapping saves and loads correctly
- [ ] Holiday list shows all 18 Colombian holidays
- [ ] Can add custom holiday with date + name
- [ ] Can remove a holiday
- [ ] Reset restores default Colombian holidays
- [ ] Daily limits save and affect calculations
- [ ] Admin user creation works
- [ ] Disabling user kills their sessions immediately

### Edge Cases
- [ ] Missing clock-out blocks period finalization
- [ ] Unscheduled shift uses default schedule assumptions
- [ ] Employee without salary shows warning, costs are zero
- [ ] Employee without cédula blocks Siigo export only
- [ ] Overlapping periods are rejected
- [ ] Retroactive schedule change triggers recalculation
- [ ] BioTime sync gap catches up correctly
- [ ] Duplicate punches silently ignored
- [ ] False punches (< 15 min) flagged correctly

### Alerts
- [ ] Missing punch alert shows on dashboard
- [ ] Period overdue alert shows when applicable
- [ ] Stale sync alert shows after 30 min without sync
- [ ] Alert actions navigate to correct pages
- [ ] Alerts ordered by priority

### Mobile
- [ ] Sidebar collapses on tablet, hidden on mobile
- [ ] Tables switch to card view on mobile
- [ ] Schedule grid scrolls horizontally with sticky column
- [ ] All touch targets ≥ 44px
- [ ] Payroll table shows reduced columns on mobile
