/**
 * Layer 1: Punch Resolver
 *
 * Takes raw punch logs and determines which punches belong to which business
 * day, producing a single clock_in and clock_out per employee per business day.
 *
 * Business day: 6:00 AM to 5:59 AM next calendar day.
 * A shift is attributed to the calendar date on which it started.
 */

import {
  getBusinessDay,
  formatDateISO,
  BUSINESS_DAY_START_HOUR,
} from "./time-utils";
import { colHours, colMinutes, colAddDays, colDay, colombiaStartOfDay } from "@/lib/timezone";

export interface PunchLog {
  empCode: string;
  punchTime: Date;
  punchState: string | null; // "0"=in, "1"=out
}

export interface ShiftSchedule {
  dayOfWeek: number; // 0=Mon..6=Sun
  shiftStart: string; // "HH:MM"
  shiftEnd: string;
  crossesMidnight: boolean;
}

export interface ResolvedPunches {
  employeeId: number;
  empCode: string;
  workDate: Date; // the business day
  clockIn: Date | null;
  clockOut: Date | null;
  isMissingPunch: boolean;
  allPunches: Date[];
}

/**
 * Resolve an array of punches for a single employee into business-day records.
 *
 * @param empCode - Employee code
 * @param employeeId - Employee DB id
 * @param punches - All punches for this employee in the date range, sorted by punchTime
 * @param scheduleMap - Map of "dayOfWeek" → ShiftSchedule for this employee
 */
export function resolvePunches(
  empCode: string,
  employeeId: number,
  punches: PunchLog[],
  scheduleMap: Map<number, ShiftSchedule>,
): ResolvedPunches[] {
  if (punches.length === 0) return [];

  // Sort by punch time
  const sorted = [...punches].sort(
    (a, b) => a.punchTime.getTime() - b.punchTime.getTime(),
  );

  // Group punches into business days — keep state alongside time so we can
  // pair by punchState (first Entrada / last Salida), not by time-order.
  type DayPunch = { time: Date; state: string | null };
  const dayMap = new Map<string, DayPunch[]>();

  for (const punch of sorted) {
    let businessDay = getBusinessDay(punch.punchTime);

    // Schedule-aware midnight resolution:
    // If the punch is between 6:00 AM and 6:30 AM, check if the employee
    // had a midnight-crossing shift the previous day. If so, attribute
    // this punch to the previous business day.
    const hour = colHours(punch.punchTime);
    const minute = colMinutes(punch.punchTime);

    if (
      hour === BUSINESS_DAY_START_HOUR &&
      minute <= 30
    ) {
      // Check previous day's schedule for midnight-crossing shift
      const prevDay = colAddDays(businessDay, -1);
      const prevDow = colDay(prevDay) === 0 ? 6 : colDay(prevDay) - 1;
      const prevSchedule = scheduleMap.get(prevDow);

      if (prevSchedule?.crossesMidnight) {
        // This punch is the tail end of yesterday's shift
        businessDay = prevDay;
      }
    }

    const key = formatDateISO(businessDay);
    const existing = dayMap.get(key) ?? [];
    existing.push({ time: punch.punchTime, state: punch.punchState });
    dayMap.set(key, existing);
  }

  // Convert grouped punches to resolved records
  const results: ResolvedPunches[] = [];

  for (const [dateStr, dayPunches] of dayMap) {
    const workDate = colombiaStartOfDay(dateStr);
    // Sort ascending within the day
    dayPunches.sort((a, b) => a.time.getTime() - b.time.getTime());

    // Pair by punchState:
    //   clockIn  = first Entrada (state === "0") of the day
    //   clockOut = last  Salida  (state === "1") of the day
    // Multiple Salidas/Entradas on the same day are a valid real-world case
    // (e.g. brief step-outs that result in extra Salidas); the first IN /
    // last OUT is what matters for payroll.
    const firstEntrada = dayPunches.find((p) => p.state === "0");
    const lastSalida = [...dayPunches].reverse().find((p) => p.state === "1");

    let clockIn: Date | null = firstEntrada?.time ?? null;
    let clockOut: Date | null = lastSalida?.time ?? null;

    // Fallback for null-state rows (legacy data or manual entries without an
    // explicit IN/OUT flag). If no authoritative state on the day, fall back
    // to the time-order heuristic (first = IN, last = OUT) so we don't drop
    // the record entirely.
    const hasAnyState = dayPunches.some((p) => p.state === "0" || p.state === "1");
    if (!hasAnyState) {
      clockIn = dayPunches[0].time;
      clockOut =
        dayPunches.length > 1 ? dayPunches[dayPunches.length - 1].time : null;
    }

    const isMissingPunch = clockIn === null || clockOut === null;

    results.push({
      employeeId,
      empCode,
      workDate,
      clockIn,
      clockOut,
      isMissingPunch,
      allPunches: dayPunches.map((p) => p.time),
    });
  }

  // Sort results by work date
  results.sort((a, b) => a.workDate.getTime() - b.workDate.getTime());

  return results;
}
