/**
 * Layer 2: Punch Normalizer
 *
 * Converts raw clock_in/clock_out to payable effective_in/effective_out
 * by applying business rules:
 *   - Clock-in: pay from the LATER of scheduled start or actual arrival,
 *     rounded UP to the next 15-min boundary if late
 *   - Clock-out before schedule: floored DOWN to previous 15-min boundary
 *     (only complete 15-min blocks are payable)
 *   - Clock-out after schedule: only full 15-min blocks count
 *
 * For split shifts: normalize against segment 1 start and segment 2 end.
 */

import {
  combineDateAndTime,
  combineDateAndTimeWithCrossing,
  minutesBetween,
  floorTo15Min,
  ceilTo15Min,
} from "./time-utils";

export interface NormalizedPunches {
  clockIn: Date;
  clockOut: Date | null;
  effectiveIn: Date;
  effectiveOut: Date | null;
  lateMinutes: number;
  earlyLeaveMinutes: number;
}

/**
 * Normalize a pair of punches against the schedule.
 *
 * @param clockIn       Raw clock-in time
 * @param clockOut      Raw clock-out time (null if missing)
 * @param scheduledStart  "HH:MM" of the (first) segment start
 * @param scheduledEnd    "HH:MM" of the (last) segment end
 * @param workDate        The business day
 * @param crossesMidnight Whether the shift's end is on the next calendar day
 */
export function normalizePunches(
  clockIn: Date,
  clockOut: Date | null,
  scheduledStart: string,
  scheduledEnd: string,
  workDate: Date,
  crossesMidnight: boolean,
): NormalizedPunches {
  // Build scheduled start/end as absolute Date objects
  const schedStart = combineDateAndTime(workDate, scheduledStart);
  const schedEnd = crossesMidnight
    ? combineDateAndTimeWithCrossing(workDate, scheduledEnd, true)
    : combineDateAndTime(workDate, scheduledEnd);

  // --- Effective In ---
  // Pay from the LATER of scheduled start or actual arrival.
  // Late arrivals are rounded UP to the next 15-min boundary
  // (only complete 15-min blocks are payable).
  const lateMinutes = Math.max(0, minutesBetween(schedStart, clockIn));

  let effectiveIn: Date;
  if (lateMinutes > 0) {
    const roundedLate = ceilTo15Min(lateMinutes);
    effectiveIn = new Date(schedStart.getTime() + roundedLate * 60000);
  } else {
    effectiveIn = new Date(schedStart);
  }

  // --- Effective Out ---
  if (clockOut === null) {
    return {
      clockIn,
      clockOut: null,
      effectiveIn,
      effectiveOut: null,
      lateMinutes,
      earlyLeaveMinutes: 0,
    };
  }

  let effectiveOut: Date;
  let earlyLeaveMinutes = 0;

  if (clockOut.getTime() <= schedEnd.getTime()) {
    // Clock-out at or before scheduled end — floor to previous 15-min block
    // (only complete blocks are payable, matching the overtime tail rule).
    const clockOutEpochMins = Math.floor(clockOut.getTime() / 60000);
    const flooredEpochMins = Math.floor(clockOutEpochMins / 15) * 15;
    effectiveOut = new Date(flooredEpochMins * 60000);
    earlyLeaveMinutes = Math.max(0, minutesBetween(effectiveOut, schedEnd));
  } else {
    // Clock-out AFTER scheduled end — apply 15-min floor
    const excessRawMins = minutesBetween(schedEnd, clockOut);
    const excessRounded = floorTo15Min(excessRawMins);
    effectiveOut = new Date(schedEnd.getTime() + excessRounded * 60000);
  }

  return {
    clockIn,
    clockOut,
    effectiveIn,
    effectiveOut,
    lateMinutes,
    earlyLeaveMinutes,
  };
}
