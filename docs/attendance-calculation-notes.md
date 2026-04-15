# Attendance Calculation Notes

## Split-Shift Overtime Bug (Fixed April 2026)

### Example Record

| Field | Value | Colombia Time |
|-------|-------|---------------|
| clockIn | 2026-04-11T16:18:24Z | 11:18 AM |
| clockOut | 2026-04-12T03:47:37Z | 10:47 PM |
| effectiveIn | 2026-04-11T16:18:24Z | 11:18 AM |
| effectiveOut | 2026-04-12T03:45:00Z | 10:45 PM |
| schedule | 11:00–21:00 | split shift, 120-min gap |
| dailyLimit | 480 min (8h) | |

### What the system produced (wrong)

- totalWorkedMins: **462** (7h 42m)
- minsOrdinaryDay: 342
- minsNocturno: 120 (only 19:00–21:00)
- excessHedMins: 0
- excessHenMins: 0

### What the correct calculation should be

- totalWorkedMins: **567** (9h 27m) — or **555** (9h 15m) if late clock-in rounding is applied
- minsNocturno (total): 225 (19:00–22:45)
- Excess over daily limit: 87 min (or 75 with rounding) — all nocturno → HEN
- Recargo nocturno (non-OT): 138 min (or 150 with rounding)

### Root Cause

`buildWorkedSegments()` in `daily-classifier.ts` clipped the effective times to each schedule segment boundary. For split shifts, the last segment's end was capped at `segEnd` (21:00), discarding any overtime minutes beyond the schedule.

```ts
// BUG: capped overtime away
const clippedEnd = new Date(
  Math.min(effectiveOut.getTime(), segEnd.getTime()),
);
```

Single shifts didn't have this problem because they returned `[{ start: effectiveIn, end: effectiveOut }]` without any clipping.

### Fix

For the last segment in a split shift, use `effectiveOut` directly instead of capping at `segEnd`. Non-last segments still cap at their `segEnd` to properly exclude the gap between segments.

---

## 15-Minute Rounding for Late Clock-Ins (Pending Decision)

### Current Behavior

The punch normalizer applies 15-minute floor rounding to **overtime** (clock-out after schedule) but does **not** round late arrivals:

| Scenario | Current Rule | Example |
|----------|-------------|---------|
| **Overtime (clock-out after schedule)** | Floor to 15-min blocks | 107 min extra → 105 min paid (7 full blocks) |
| **Late arrival (clock-in after schedule)** | Exact — no rounding | 18 min late → pay starts at 11:18 exactly |

### Discrepancy with Manual Payroll

Manual payroll records for the example above show 555 min (9h 15m) of total work, which implies the effective clock-in was rounded from 11:18 to **11:30** — the next 15-minute boundary.

| Method | effectiveIn | totalWorked | Nocturno | HEN (OT) | RN (recargo) |
|--------|-------------|-------------|----------|-----------|---------------|
| System (no rounding) | 11:18 | 567 min (9h 27m) | 225 | 87 | 138 |
| Manual records (rounded) | 11:30 | 555 min (9h 15m) | 225 | 75 (1h 15m) | 150 (2h 30m) |

### How the Rounding Works

The principle is the same at both ends of the shift: **only complete 15-minute blocks are payable**.

**Overtime (end of shift)** — round **down** (floor):
- Employee clocks out 107 min after schedule → `floor(107 / 15) × 15 = 105`
- The trailing 2 minutes don't form a complete block → not paid

**Late arrival (start of shift)** — round **up** (ceiling):
- Employee arrives 18 min after schedule start → next 15-min boundary is 30 min
- Or equivalently: `ceil(18 / 15) × 15 = 30` → effectiveIn = schedStart + 30 = 11:30
- The 12 minutes between 11:18 and 11:30 don't form a complete block → not paid

Both rules favor the employer: partial 15-minute intervals are not compensated. This is a common practice in Colombian payroll processing where time is tracked in 15-minute increments.

### If Implementing

The change would go in `punch-normalizer.ts`. The current effectiveIn logic:

```ts
// Current: exact arrival, no rounding
const effectiveIn =
  clockIn.getTime() > schedStart.getTime() ? new Date(clockIn) : new Date(schedStart);
```

Would become:

```ts
// Round late arrivals to the next 15-min boundary
if (clockIn.getTime() > schedStart.getTime()) {
  const lateMins = minutesBetween(schedStart, clockIn);
  const roundedLate = ceilTo15Min(lateMins); // ceil(n/15)*15
  effectiveIn = new Date(schedStart.getTime() + roundedLate * 60000);
} else {
  effectiveIn = new Date(schedStart);
}
```

A `ceilTo15Min` utility would need to be added alongside the existing `floorTo15Min`:

```ts
export function ceilTo15Min(minutes: number): number {
  return Math.ceil(minutes / 15) * 15;
}
```

**Note:** `lateMinutes` should still reflect the raw lateness (18 min), not the rounded value, so that attendance reports show the actual arrival deviation. The rounding only affects payable time.
