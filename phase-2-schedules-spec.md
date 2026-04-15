# Phase 2 — Schedule Management (Detailed Specification)

## Overview

Build the weekly schedule editor where managers assign shifts to employees by group. This is the core operational tool — everything downstream (attendance calculation, overtime, payroll) depends on accurate schedules.

---

## Pages & Routes

### 1. Schedule List Page — `/schedules`

**Purpose:** Landing page showing all schedules, organized by week and group.

**Layout:**
- Header: "Schedules" title + "Create Schedule" button (primary, accent color)
- Week navigator: left/right arrows to move between weeks, showing "Week of Apr 13 – Apr 19, 2026"
- Below the week navigator: 4 group cards (Kitchen, Servers, Bar, Admin)
- Each group card shows:
  - Group name with colored dot (Kitchen=#e87040, Servers=#00b899, Bar=#7c5bbd, Admin=#3e93de)
  - Number of employees in that group
  - Schedule status for that week: "Not created", "Draft", "Complete"
  - Click → navigates to `/schedules/[weekStart]/[groupId]`

**API Routes needed:**
- `GET /api/schedules?weekStart=2026-04-13` — returns all weekly_schedules for that week
- `GET /api/groups` — returns all groups with employee count

**Behavior:**
- Default view: current week (Monday of this week)
- If no schedule exists for a group+week, show "Not created" with a "Create" button
- Clicking a group card opens the schedule editor for that group+week
- Week navigation: clicking arrows changes the weekStart parameter

---

### 2. Schedule Editor Page — `/schedules/[weekStart]/[groupId]`

**Purpose:** The main grid where managers assign shifts for every employee in a group for a specific week.

**Layout:**

```
┌─────────────────────────────────────────────────────────────────┐
│ ← Back to Schedules                                             │
│                                                                 │
│ Kitchen Schedule — Week of Apr 13 – 19, 2026          [Actions] │
│                                                                 │
│ ┌──────────┬────────┬────────┬────────┬────────┬────────┬──────┐│
│ │ Employee │ Mon 13 │ Tue 14 │ Wed 15 │ Thu 16 │ Fri 17 │Sat 18││
│ │          │  (7h)  │  (7h)  │  (7h)  │  (7h)  │  (8h)  │ (8h) ││
│ ├──────────┼────────┼────────┼────────┼────────┼────────┼──────┤│
│ │Carlos R. │ 8-17   │ 8-17   │ 8-17   │  OFF   │ 8-17   │ 8-14 ││
│ │  44h/44h │        │        │        │        │        │      ││
│ ├──────────┼────────┼────────┼────────┼────────┼────────┼──────┤│
│ │Valentina │ 17-2   │ 17-2   │  OFF   │ 17-2   │ 17-2   │ 17-2 ││
│ │  40h/44h │        │        │        │        │        │      ││
│ ├──────────┼────────┼────────┼────────┼────────┼────────┼──────┤│
│ │Santiago  │ 12-16  │ 12-16  │ 12-16  │ 12-16  │ 12-16  │ 12-16││
│ │  48h/44h │ 18-22  │ 18-22  │ 18-22  │ 18-22  │ 18-22  │ 18-22││
│ └──────────┴────────┴────────┴────────┴────────┴────────┴──────┘│
│                                                                 │
│ Weekly Summary: 3 employees │ Avg 44h │ ⚠️ 1 over expected      │
└─────────────────────────────────────────────────────────────────┘
```

**Column Headers:**
- Show day name + date
- Show daily limit underneath in parentheses: (7h) for Sun-Thu, (8h) for Fri-Sat
- Highlight holidays with a festivo indicator (use danger/red background on the header)
- Show Sunday column with label "Sun 19" (no special styling — Sundays are regular days)

**Employee Row:**
- Left column: employee name + weekly scheduled hours vs expected hours
  - Green text if within expected
  - Amber text if above expected (overtime will be generated)
  - Show as "44h / 44h" format (scheduled / expected)
- Each cell is a clickable area for that employee+day

**Cell States:**
- Empty cell → no shift assigned, shows "+" on hover to add
- Regular shift → shows time range in monospace, neutral background (e.g., "8-17")
- Night shift → purple background/text (shift end < shift start, e.g., "17-2")
- Split shift → two time ranges stacked vertically with small gap (e.g., "12-16" / "18-22"), teal accent
- Day off → shows "OFF" in muted text
- Comp day off → shows "COMP" in blue pill badge, shows debit amount
- Holiday → cell background has subtle red tint regardless of shift type

**Actions dropdown (top right):**
- "Copy from previous week" — copies all shifts from the prior week's schedule for this group
- "Clear all shifts" — removes all shifts (with confirmation dialog)
- "Delete schedule" — deletes the entire weekly_schedule record (with confirmation)

---

## Shift Modal

When a user clicks a cell (or the "+" on an empty cell), the **Shift Modal** opens.

**Modal Title:** "Carlos Restrepo — Monday, Apr 13"

**Modal Fields:**

### Shift Type Selector (radio buttons or segmented control)
- **Regular shift** (default) — shows time pickers
- **Day off** — no additional fields, saves with shift_type='day_off'
- **Comp day off** — shows comp balance info, saves with shift_type='comp_day_off'

### When "Regular shift" is selected:

**Segment 1 (always shown):**
- Start time: time picker (15-min increments: 6:00, 6:15, 6:30... or free input)
- End time: time picker
- Break (minutes): number input, default 0
- "Crosses midnight" checkbox — auto-checked when end time < start time, but editable

**Split shift toggle:**
- Default OFF
- When toggled ON, shows Segment 2:
  - Start time 2: time picker
  - End time 2: time picker
  - Break 2 (minutes): number input, default 0

**Calculated summary (shown live as user changes times):**
- Total scheduled hours for this day
- "Segment 1: 4h | Gap: 2h | Segment 2: 4h | Total: 8h"
- Daily limit for this day: 7h or 8h
- Excess: "+1h" (if over daily limit, shown in amber)

### When "Comp day off" is selected:

**Show:**
- Employee's current comp balance: "+14h" (or "-3h" if they owe time)
- Hours to debit: auto-filled with that day's daily limit (7h or 8h), editable
- Balance after debit: calculated live
- Warning if balance would go negative: "This will put Carlos at -3h (owes time)"

### Modal Footer:
- Cancel button (secondary)
- Save button (primary, accent)
- Delete shift button (danger, only shown when editing existing shift)

---

## API Routes

### GET /api/groups
Returns all groups with employee count.
```json
{
  "groups": [
    { "id": 1, "name": "Kitchen", "employeeCount": 8 },
    { "id": 2, "name": "Servers", "employeeCount": 6 },
    { "id": 3, "name": "Bar", "employeeCount": 5 },
    { "id": 4, "name": "Admin", "employeeCount": 3 }
  ]
}
```

### GET /api/schedules?weekStart=2026-04-13
Returns weekly schedules for all groups for a given week.
```json
{
  "schedules": [
    { "id": 1, "weekStart": "2026-04-13", "groupId": 1, "groupName": "Kitchen", "shiftCount": 42 },
    { "id": 2, "weekStart": "2026-04-13", "groupId": 2, "groupName": "Servers", "shiftCount": 30 }
  ]
}
```

### GET /api/schedules/[weekStart]/[groupId]
Returns the full schedule with all shifts and employees for a specific group+week.
```json
{
  "schedule": {
    "id": 1,
    "weekStart": "2026-04-13",
    "groupId": 1,
    "groupName": "Kitchen"
  },
  "employees": [
    {
      "id": 1,
      "empCode": "1001",
      "firstName": "Carlos",
      "lastName": "Restrepo",
      "compBalance": 840
    }
  ],
  "shifts": [
    {
      "id": 10,
      "employeeId": 1,
      "dayOfWeek": 0,
      "shiftType": "regular",
      "shiftStart": "08:00",
      "shiftEnd": "17:00",
      "crossesMidnight": false,
      "breakMinutes": 0,
      "isSplit": false,
      "splitPairId": null,
      "compDebitMins": 0
    }
  ],
  "holidays": ["2026-04-17"],
  "dailyLimits": {
    "0": 420, "1": 420, "2": 420, "3": 420,
    "4": 480, "5": 480, "6": 420
  }
}
```

### POST /api/schedules
Creates a new weekly_schedule record.
```json
{
  "weekStart": "2026-04-13",
  "groupId": 1
}
```

### POST /api/shifts
Creates a new shift.
```json
{
  "scheduleId": 1,
  "employeeId": 1,
  "dayOfWeek": 0,
  "shiftType": "regular",
  "shiftStart": "08:00",
  "shiftEnd": "17:00",
  "crossesMidnight": false,
  "breakMinutes": 0,
  "isSplit": false
}
```
For split shifts, two separate POST calls are made. The first returns the shift ID, the second includes `splitPairId` pointing to the first.

For comp_day_off:
```json
{
  "scheduleId": 1,
  "employeeId": 1,
  "dayOfWeek": 3,
  "shiftType": "comp_day_off",
  "compDebitMins": 420
}
```
This also creates a `comp_transactions` entry with type='comp_day_taken', minutes=-420.

### PUT /api/shifts/[id]
Updates an existing shift. Same body as POST.

### DELETE /api/shifts/[id]
Deletes a shift. If the shift is a comp_day_off, also reverses the comp_transaction (creates an offsetting entry).

### POST /api/schedules/[weekStart]/[groupId]/copy-previous
Copies all shifts from the previous week's schedule for this group into the current week.
- If a schedule for the previous week doesn't exist, return 404 with message
- If shifts already exist for the current week, return 409 conflict with message
- On success, creates new weekly_schedule (if needed) and copies all shifts

---

## Validation Rules (enforced in API)

### On shift save (POST/PUT /api/shifts):

**1. No overlapping shifts**
For any two shifts on the same day for the same employee:
- shift2.start must be >= shift1.end
- REJECT: 12:00-16:00 + 14:00-18:00 (overlap)
- REJECT: 12:00-16:00 + 14:00-15:00 (contained)
- ALLOW: 12:00-16:00 + 18:00-22:00 (gap)
- ALLOW: 12:00-16:00 + 16:00-20:00 (back-to-back)
- Error message: "This shift overlaps with the existing {start}-{end} shift"

**2. Shift end must be after shift start (unless crosses midnight)**
- REJECT: start=14:00, end=12:00, crossesMidnight=false
- ALLOW: start=22:00, end=02:00, crossesMidnight=true
- Error message: "End time must be after start time"

**3. Max 2 shifts per employee per day**
- Regular shifts count. Day off and comp day off count as 1.
- REJECT: trying to add a 3rd shift segment
- Error message: "Maximum 2 shift segments per day (turno partido)"

**4. Minimum 30-minute gap for split shifts**
- If two shifts on same day, gap between first.end and second.start must be >= 30 min
- Error message: "Split shifts must have at least a 30-minute gap"

**5. Auto-detect crosses_midnight**
- If shiftEnd < shiftStart (e.g., start=22:00, end=02:00), auto-set crossesMidnight=true
- If shiftEnd >= shiftStart, auto-set crossesMidnight=false

**6. Comp day off balance warning (not blocking)**
- If shift_type='comp_day_off' and employee's comp balance < debit amount:
  - Return the shift successfully BUT include a warning in response
  - Warning: "Employee balance will go negative: {current_balance} - {debit} = {new_balance}"
  - The UI shows this warning but allows the save

### Display-only warnings (not blocking, shown in UI):

**7. Weekly hours exceed expected**
- Sum all shift hours for the employee in this week
- Calculate expected: count of scheduled work days × daily limit (7h or 8h)
- If scheduled > expected: show amber warning on employee row
- "Carlos is scheduled for 48h this week (expected: 44h) — 4h overtime will be generated"

**8. Holiday shift warning**
- If a shift is assigned on a date that is a Colombian holiday:
- Show festivo indicator on the cell
- Tooltip: "This is a holiday (Día del Trabajo). Festivo recargos will apply."

---

## Components to Build

### File: `src/components/schedules/WeekNavigator.tsx`
- Left/right arrow buttons to change week
- Displays "Week of Apr 13 – Apr 19, 2026"
- Prop: `weekStart: Date`, `onWeekChange: (date: Date) => void`
- Helper function: `getMonday(date)` — returns the Monday of the week containing the date

### File: `src/components/schedules/GroupCard.tsx`
- Shows group name, colored dot, employee count, schedule status
- Clickable — navigates to schedule editor
- Props: `group`, `scheduleStatus`, `weekStart`

### File: `src/components/schedules/ShiftGrid.tsx`
- The main 7-column grid (Mon-Sun) with employee rows
- Handles rendering of all cell types (regular, night, split, off, comp)
- Shows weekly hour totals per employee
- Holiday column highlighting
- Props: `employees`, `shifts`, `holidays`, `dailyLimits`, `onCellClick`

### File: `src/components/schedules/ShiftCell.tsx`
- Single cell in the grid
- Renders differently based on shift type
- Shows "+" on hover for empty cells
- Props: `shift`, `isHoliday`, `onClick`

### File: `src/components/schedules/ShiftModal.tsx`
- Modal dialog for creating/editing shifts
- Shift type selector (regular / day off / comp day off)
- Time pickers, break input, split shift toggle
- Live calculation of total hours, excess, comp balance
- Validation error display
- Props: `employee`, `dayOfWeek`, `date`, `existingShift`, `compBalance`, `dailyLimit`, `onSave`, `onDelete`, `onClose`

### File: `src/components/schedules/ScheduleActions.tsx`
- Dropdown with "Copy from previous week", "Clear all", "Delete schedule"
- Confirmation dialogs for destructive actions
- Props: `scheduleId`, `weekStart`, `groupId`, `onAction`

---

## Helper Functions

### File: `src/lib/schedule-utils.ts`

```typescript
// Get Monday of the week containing the given date
getMonday(date: Date): Date

// Get the daily limit in minutes for a given day of week
// 0=Monday..6=Sunday
// Sun(6)-Thu(0-3) = 420 (7h), Fri(4)-Sat(5) = 480 (8h)
getDailyLimitMins(dayOfWeek: number): number

// Calculate total scheduled minutes for a shift (handles midnight crossing)
getShiftDurationMins(start: string, end: string, crossesMidnight: boolean, breakMins: number): number

// Calculate gap between two shifts in minutes
getGapBetweenShifts(shift1End: string, shift2Start: string): number

// Check if two shifts overlap
doShiftsOverlap(shift1Start: string, shift1End: string, shift1CrossesMidnight: boolean,
                shift2Start: string, shift2End: string, shift2CrossesMidnight: boolean): boolean

// Get total scheduled hours for an employee in a week
getWeeklyScheduledMins(shifts: Shift[]): number

// Get expected hours for a week based on scheduled work days
getWeeklyExpectedMins(shifts: Shift[], dailyLimits: Record<number, number>): number

// Check if a date is a Colombian holiday
isHoliday(date: Date): boolean

// Get all holidays for a date range
getHolidaysInRange(start: Date, end: Date): Date[]

// Format time for display (24h to readable)
formatShiftTime(time: string): string  // "17:00" → "5 PM" or "17:00" depending on preference
```

---

## Colombian Holidays 2026 (hardcoded)

```typescript
// src/lib/holidays.ts
export const COLOMBIAN_HOLIDAYS_2026 = [
  "2026-01-01", // Año Nuevo
  "2026-01-12", // Reyes Magos (Emiliani)
  "2026-03-23", // San José (Emiliani)
  "2026-04-02", // Jueves Santo
  "2026-04-03", // Viernes Santo
  "2026-05-01", // Día del Trabajo
  "2026-05-18", // Ascensión del Señor (Emiliani)
  "2026-06-08", // Corpus Christi (Emiliani)
  "2026-06-15", // Sagrado Corazón (Emiliani)
  "2026-06-29", // San Pedro y San Pablo (Emiliani)
  "2026-07-20", // Independencia
  "2026-08-07", // Batalla de Boyacá
  "2026-08-17", // Asunción de la Virgen (Emiliani)
  "2026-10-12", // Día de la Raza (Emiliani)
  "2026-11-02", // Todos los Santos (Emiliani)
  "2026-11-16", // Independencia de Cartagena (Emiliani)
  "2026-12-08", // Inmaculada Concepción
  "2026-12-25", // Navidad
];
```

---

## Data Flow Example

### Creating a turno partido (split shift):

1. Manager clicks cell for "Santiago — Monday"
2. ShiftModal opens, manager selects "Regular shift"
3. Enters Segment 1: 12:00 - 16:00, break: 0
4. Toggles "Split shift" ON
5. Enters Segment 2: 18:00 - 22:00, break: 0
6. Modal shows: "Seg 1: 4h | Gap: 2h | Seg 2: 4h | Total: 8h | Daily limit: 7h | Excess: +1h"
7. Manager clicks Save
8. API calls:
   a. POST /api/shifts → creates shift 1 (12:00-16:00, isSplit=true), returns id=50
   b. POST /api/shifts → creates shift 2 (18:00-22:00, isSplit=true, splitPairId=50)
9. Grid refreshes, cell shows two stacked time ranges

### Creating a comp day off:

1. Manager clicks cell for "Mariana — Thursday"
2. ShiftModal opens, manager selects "Comp day off"
3. Modal shows: "Balance: +14h | Debit: 7h | After: +7h"
4. Manager clicks Save
5. API calls:
   a. POST /api/shifts → creates shift with shiftType='comp_day_off', compDebitMins=420
   b. API internally creates comp_transaction: type='comp_day_taken', minutes=-420, balanceAfter=420
6. Grid refreshes, cell shows "COMP" blue pill

### Copying from previous week:

1. Manager clicks Actions → "Copy from previous week"
2. Confirmation dialog: "This will copy all shifts from Apr 6–12 to Apr 13–19 for Kitchen. Continue?"
3. Manager confirms
4. API: POST /api/schedules/2026-04-13/1/copy-previous
5. Backend:
   a. Finds weekly_schedule for weekStart=2026-04-06, groupId=1
   b. Creates weekly_schedule for weekStart=2026-04-13, groupId=1 (if not exists)
   c. Copies all shifts, updating scheduleId to the new schedule
   d. Does NOT copy comp_day_off shifts (those are one-time)
   e. Returns new shifts
6. Grid refreshes with copied shifts

---

## Edge Cases to Handle

1. **Employee with no shifts in the week** — show all 7 cells empty with "+" on hover. Employee row still shows "0h / 44h" in amber.

2. **Schedule for a holiday week** — multiple cells might be holidays. Each holiday cell has a subtle red background tint. If the manager assigns a shift on a holiday, the cell shows the shift time WITH the holiday tint.

3. **Employee transferred between groups mid-week** — not supported in v1. An employee belongs to one group. If they need to move, update their group in employee settings and create shifts manually.

4. **Shift spanning past 6 AM** — a shift like 10pm-7am technically crosses the business day boundary. The shift is stored on the day it starts. The attendance engine handles the 6AM boundary logic, not the schedule. The schedule just stores start/end times.

5. **Delete a comp day off** — when deleting a comp_day_off shift, the API must create an offsetting comp_transaction (type='owed_offset' or reverse the original debit) to restore the employee's balance.

6. **Two employees, same cell data** — different employees can have identical shifts. Each shift row is tied to a specific employee_id, so there's no collision.

7. **Week with no Sunday column** — always show 7 columns (Mon-Sun). If the business operates 7 days, all columns are usable. The "rest day" concept is per-employee (stored in employees.rest_day), not per-schedule.

---

## Testing Checklist

After building, verify:
- [ ] Can create a weekly schedule for a group
- [ ] Can add regular shifts with time pickers
- [ ] Night shifts auto-detect crosses_midnight
- [ ] Split shifts create two linked records
- [ ] Comp day off shows balance and creates transaction
- [ ] Copy from previous week works
- [ ] Overlap validation rejects invalid shifts
- [ ] Max 2 shifts per day enforced
- [ ] 30-min gap enforced for split shifts
- [ ] Weekly hours total shows correctly per employee
- [ ] Holiday dates are visually indicated
- [ ] Delete shift works (including comp balance reversal)
- [ ] Empty cells show "+" on hover
- [ ] Mobile responsive (horizontal scroll on grid)
