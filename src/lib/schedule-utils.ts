/** Get Monday of the week containing the given date */
export function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Format a Date as YYYY-MM-DD */
export function formatDateISO(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Get array of 7 dates (Mon-Sun) for a week starting on the given Monday */
export function getWeekDates(monday: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    return d;
  });
}

/**
 * Daily limit in minutes for a given day of week.
 * 0=Monday..6=Sunday
 * Sun(6)–Thu(0–3) = 420min (7h), Fri(4)–Sat(5) = 480min (8h)
 */
export function getDailyLimitMins(dayOfWeek: number): number {
  return dayOfWeek === 4 || dayOfWeek === 5 ? 480 : 420;
}

/** Parse a time string "HH:MM" to total minutes from midnight */
function timeToMins(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** Calculate shift duration in minutes, accounting for midnight crossing */
export function getShiftDurationMins(
  start: string,
  end: string,
  crossesMidnight: boolean,
  breakMins: number,
): number {
  const s = timeToMins(start);
  const e = timeToMins(end);
  let duration = crossesMidnight ? 1440 - s + e : e - s;
  duration -= breakMins;
  return Math.max(0, duration);
}

/** Calculate gap in minutes between shift1.end and shift2.start */
export function getGapBetweenShifts(
  shift1End: string,
  shift2Start: string,
): number {
  return timeToMins(shift2Start) - timeToMins(shift1End);
}

/** Check if two shifts overlap (both on the same calendar day) */
export function doShiftsOverlap(
  s1Start: string,
  s1End: string,
  s1Midnight: boolean,
  s2Start: string,
  s2End: string,
  s2Midnight: boolean,
): boolean {
  // Convert to absolute minute ranges on a 0–1440+ timeline
  const a0 = timeToMins(s1Start);
  const a1 = s1Midnight ? 1440 + timeToMins(s1End) : timeToMins(s1End);
  const b0 = timeToMins(s2Start);
  const b1 = s2Midnight ? 1440 + timeToMins(s2End) : timeToMins(s2End);

  // Two ranges overlap if one starts before the other ends
  return a0 < b1 && b0 < a1;
}

export type ShiftForCalc = {
  dayOfWeek: number;
  shiftType: string;
  shiftStart: string | null;
  shiftEnd: string | null;
  crossesMidnight: boolean;
  breakMinutes: number;
};

/** Get total scheduled minutes for an employee from an array of shifts */
export function getWeeklyScheduledMins(shifts: ShiftForCalc[]): number {
  return shifts.reduce((sum, s) => {
    if (s.shiftType !== "regular" || !s.shiftStart || !s.shiftEnd) return sum;
    return (
      sum +
      getShiftDurationMins(
        s.shiftStart,
        s.shiftEnd,
        s.crossesMidnight,
        s.breakMinutes,
      )
    );
  }, 0);
}

/** Get expected minutes for a week based on which days have shifts */
export function getWeeklyExpectedMins(
  shifts: ShiftForCalc[],
  dailyLimits: Record<number, number>,
): number {
  // Collect days that have work scheduled (regular shifts)
  const workDays = new Set<number>();
  for (const s of shifts) {
    if (s.shiftType === "regular") {
      workDays.add(s.dayOfWeek);
    }
  }
  let total = 0;
  for (const d of workDays) {
    total += dailyLimits[d] ?? getDailyLimitMins(d);
  }
  return total;
}

/** Format time for display: "08:00" → "8:00", "17:00" → "17:00" */
export function formatShiftTime(time: string): string {
  const [h, m] = time.split(":");
  return `${parseInt(h)}:${m}`;
}

/** Format minutes to hours display: 420 → "7h", 510 → "8h 30m" */
export function minsToHoursDisplay(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Short day names (0=Mon..6=Sun) */
export const DAY_NAMES_SHORT = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
];
