/**
 * Time math utilities for the calculation engine.
 * All times are Colombia time (UTC-5, no daylight saving).
 */

/** Parse "HH:MM" string to minutes since midnight */
export function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** Convert minutes since midnight to "HH:MM" */
export function minutesToTime(mins: number): string {
  const normalized = ((mins % 1440) + 1440) % 1440;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Floor to nearest 15-minute block */
export function floorTo15Min(minutes: number): number {
  return Math.floor(minutes / 15) * 15;
}

/**
 * Get day of week as 0=Monday..6=Sunday.
 * JS Date uses 0=Sunday, 1=Monday, ..., 6=Saturday.
 */
export function getDayOfWeek(date: Date): number {
  const jsDay = date.getDay(); // 0=Sun
  return jsDay === 0 ? 6 : jsDay - 1;
}

/** Calculate minutes between two Dates */
export function minutesBetween(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / 60000);
}

/** Create a Date from a work date + "HH:MM" time string */
export function combineDateAndTime(workDate: Date, time: string): Date {
  const mins = parseTimeToMinutes(time);
  const d = new Date(workDate);
  d.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
  return d;
}

/**
 * Create a Date from workDate + "HH:MM", handling midnight crossover.
 * If crossesMidnight is true and the time is before the shift start,
 * the time is on the next calendar day.
 */
export function combineDateAndTimeWithCrossing(
  workDate: Date,
  time: string,
  isPostMidnight: boolean,
): Date {
  const d = combineDateAndTime(workDate, time);
  if (isPostMidnight) {
    d.setDate(d.getDate() + 1);
  }
  return d;
}

/** Add minutes to a Date, returning a new Date */
export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60000);
}

/** Check if an hour (0-23) is in the nocturno range (19-23, 0-5) */
export function isNocturnoHour(hour: number): boolean {
  return hour >= 19 || hour < 6;
}

/** Diurno: 6:00 AM (360 min) to 7:00 PM (1140 min) */
export const DIURNO_START_MINS = 360; // 6:00 AM
export const DIURNO_END_MINS = 1140; // 7:00 PM (exclusive, nocturno starts here)

/** Business day starts at 6:00 AM */
export const BUSINESS_DAY_START_HOUR = 6;

/**
 * Get the business day date for a given punch time.
 * Business day runs 6:00 AM to 5:59 AM next day.
 * If punch hour < 6, it belongs to the previous calendar day.
 */
export function getBusinessDay(punchTime: Date): Date {
  const d = new Date(punchTime);
  if (d.getHours() < BUSINESS_DAY_START_HOUR) {
    d.setDate(d.getDate() - 1);
  }
  // Return date-only (midnight)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Format Date as "YYYY-MM-DD" */
export function formatDateISO(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Check if two dates are the same calendar day */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Get midnight (start of next calendar day) for a given date */
export function getMidnight(date: Date): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Clamp a value between min and max */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
