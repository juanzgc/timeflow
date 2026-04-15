/**
 * Colombia timezone utilities.
 *
 * Colombia is always UTC-5 (no DST). All helpers here use UTC arithmetic
 * so that results are correct regardless of the server's local timezone.
 *
 * Core technique: shift a Date by -5 hours, then read UTC methods
 * to get Colombia-local values.
 */

/** IANA timezone string for use with toLocaleX({ timeZone }) */
export const COL_TZ = "America/Bogota";

/** UTC offset for Colombia in milliseconds */
const COL_OFFSET_MS = -5 * 60 * 60 * 1000;

/** Shift a Date so that its UTC fields represent Colombia local time. */
function toColUTC(d: Date): Date {
  return new Date(d.getTime() + COL_OFFSET_MS);
}

// ─── Getters ─────────────────────────────────────────────────────────────

/** Get Colombia-local hour (0-23) from any Date. */
export function colHours(d: Date): number {
  return toColUTC(d).getUTCHours();
}

/** Get Colombia-local minutes (0-59) from any Date. */
export function colMinutes(d: Date): number {
  return toColUTC(d).getUTCMinutes();
}

/** Get Colombia-local day-of-month (1-31) from any Date. */
export function colDate(d: Date): number {
  return toColUTC(d).getUTCDate();
}

/** Get Colombia-local month (0-11) from any Date. */
export function colMonth(d: Date): number {
  return toColUTC(d).getUTCMonth();
}

/** Get Colombia-local full year from any Date. */
export function colFullYear(d: Date): number {
  return toColUTC(d).getUTCFullYear();
}

/** Get Colombia-local day-of-week (0=Sun, 1=Mon, ..., 6=Sat) from any Date. */
export function colDay(d: Date): number {
  return toColUTC(d).getUTCDay();
}

// ─── Factory ─────────────────────────────────────────────────────────────

/**
 * Create a Date from Colombia-local components.
 * e.g. colombiaDate(2026, 3, 14, 8, 0) → 2026-04-14 08:00 COT (= 13:00 UTC)
 *
 * Month is 0-based (0=Jan, 11=Dec) to match JS Date conventions.
 */
export function colombiaDate(
  year: number,
  month: number,
  day: number,
  hours: number = 0,
  minutes: number = 0,
  seconds: number = 0,
): Date {
  const utc = Date.UTC(year, month, day, hours, minutes, seconds);
  return new Date(utc - COL_OFFSET_MS);
}

// ─── Now / Today helpers ─────────────────────────────────────────────────

/** Get current Date (unchanged, but semantically clear). */
export function nowColombia(): Date {
  return new Date();
}

/** Get today's date as "YYYY-MM-DD" in Colombia time. */
export function todayColombiaISO(): string {
  return formatColombiaDateISO(new Date());
}

/** Format any Date as "YYYY-MM-DD" using Colombia-local date. */
export function formatColombiaDateISO(d: Date): string {
  const y = colFullYear(d);
  const m = String(colMonth(d) + 1).padStart(2, "0");
  const day = String(colDate(d)).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ─── Parse ───────────────────────────────────────────────────────────────

/**
 * Parse "YYYY-MM-DD" as midnight Colombia time.
 * Returns a Date whose instant is `YYYY-MM-DDT00:00:00-05:00`.
 */
export function colombiaStartOfDay(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return colombiaDate(y, m - 1, d);
}

// ─── Mutators (return new Dates) ─────────────────────────────────────────

/**
 * Set hours/minutes on a Date in Colombia-local time, returning a new Date.
 * Replaces `d.setHours(h, m, 0, 0)` in a timezone-safe way.
 */
export function colSetHours(d: Date, hours: number, minutes: number = 0, seconds: number = 0): Date {
  const y = colFullYear(d);
  const m = colMonth(d);
  const day = colDate(d);
  return colombiaDate(y, m, day, hours, minutes, seconds);
}

/**
 * Add (or subtract) days from a Date, preserving the Colombia-local time-of-day.
 * Replaces `d.setDate(d.getDate() + n)`.
 */
export function colAddDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 24 * 60 * 60 * 1000);
}
