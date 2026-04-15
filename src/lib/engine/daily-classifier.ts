/**
 * Layer 3: Daily Classifier
 *
 * Takes effective_in / effective_out + schedule context and classifies every
 * worked minute into surcharge buckets:
 *   - minsOrdinaryDay:  diurno on regular day (no surcharge)
 *   - minsNocturno:     nocturno on regular day (recargo 35%)
 *   - minsFestivoDay:   diurno on holiday (recargo 80%)
 *   - minsFestivoNight: nocturno on holiday (recargo 115%)
 *
 * Also calculates the daily excess pool (provisional, for period reconciliation).
 */

import {
  minutesBetween,
  combineDateAndTime,
  combineDateAndTimeWithCrossing,
  getMidnight,
  DIURNO_START_MINS,
  DIURNO_END_MINS,
} from "./time-utils";
import { isHolidayDate } from "./colombian-labor";
import { colHours, colMinutes, colFullYear, colMonth, colDate, colombiaDate, colAddDays } from "@/lib/timezone";

export interface DailyClassification {
  totalWorkedMins: number;
  minsOrdinaryDay: number;
  minsNocturno: number;
  minsFestivoDay: number;
  minsFestivoNight: number;
  excessHedMins: number;
  excessHenMins: number;
  dayType: "regular" | "holiday";
  dailyLimitMins: number;
}

export interface ShiftSegment {
  start: string; // "HH:MM"
  end: string; // "HH:MM"
  crossesMidnight: boolean;
}

/**
 * Classify a day's worked time into surcharge buckets.
 *
 * @param effectiveIn   Start of payable time
 * @param effectiveOut  End of payable time
 * @param workDate      The business day (date only)
 * @param segments      Shift segments (1 for regular, 2 for split)
 * @param scheduledBreakMins  Total unpaid break minutes
 * @param dailyLimitMins  Ordinary hour limit (420 or 480)
 */
export function classifyDay(
  effectiveIn: Date,
  effectiveOut: Date,
  workDate: Date,
  segments: ShiftSegment[],
  scheduledBreakMins: number,
  dailyLimitMins: number,
): DailyClassification {
  const dayType = isHolidayDate(workDate) ? "holiday" : "regular";

  // Build actual worked segments by clipping effective times to schedule segments
  const workedSegments = buildWorkedSegments(
    effectiveIn,
    effectiveOut,
    workDate,
    segments,
  );

  // Calculate total elapsed across all worked segments
  let totalElapsed = 0;
  for (const seg of workedSegments) {
    totalElapsed += minutesBetween(seg.start, seg.end);
  }

  const totalWorkedMins = Math.max(0, totalElapsed - scheduledBreakMins);

  // Classify each worked segment by time-of-day and day-type
  let minsOrdinaryDay = 0;
  let minsNocturno = 0;
  let minsFestivoDay = 0;
  let minsFestivoNight = 0;

  for (const seg of workedSegments) {
    const classified = classifySegment(seg.start, seg.end, workDate);
    minsOrdinaryDay += classified.ordinaryDay;
    minsNocturno += classified.nocturno;
    minsFestivoDay += classified.festivoDay;
    minsFestivoNight += classified.festivoNight;
  }

  // Subtract break proportionally from the largest bucket
  if (scheduledBreakMins > 0) {
    const total = minsOrdinaryDay + minsNocturno + minsFestivoDay + minsFestivoNight;
    if (total > 0) {
      const ratio = (total - scheduledBreakMins) / total;
      minsOrdinaryDay = Math.round(minsOrdinaryDay * ratio);
      minsNocturno = Math.round(minsNocturno * ratio);
      minsFestivoDay = Math.round(minsFestivoDay * ratio);
      minsFestivoNight = Math.round(minsFestivoNight * ratio);
    }
  }

  // Calculate daily excess pool
  const excessMins = Math.max(0, totalWorkedMins - dailyLimitMins);
  let excessHedMins = 0;
  let excessHenMins = 0;

  if (excessMins > 0) {
    // Excess comes from the tail end of the shift
    const tailClassified = classifyTail(workedSegments, excessMins, workDate);
    excessHedMins = tailClassified.diurno;
    excessHenMins = tailClassified.nocturno;
  }

  return {
    totalWorkedMins,
    minsOrdinaryDay,
    minsNocturno,
    minsFestivoDay,
    minsFestivoNight,
    excessHedMins,
    excessHenMins,
    dayType,
    dailyLimitMins,
  };
}

// ─── Internal helpers ──────────────────────────────────────────────────────

interface WorkedSegment {
  start: Date;
  end: Date;
}

/**
 * Build the actual worked time segments by clipping effective times
 * to the scheduled shift segments. For a regular (non-split) shift,
 * this produces one segment. For a turno partido, two segments with
 * the gap excluded.
 */
function buildWorkedSegments(
  effectiveIn: Date,
  effectiveOut: Date,
  workDate: Date,
  shiftSegments: ShiftSegment[],
): WorkedSegment[] {
  if (shiftSegments.length <= 1) {
    // Single shift — one worked segment
    return [{ start: effectiveIn, end: effectiveOut }];
  }

  // Split shift — clip to each segment
  const result: WorkedSegment[] = [];

  for (const seg of shiftSegments) {
    const segStart = seg.crossesMidnight
      ? combineDateAndTime(workDate, seg.start)
      : combineDateAndTime(workDate, seg.start);
    const segEnd = seg.crossesMidnight
      ? combineDateAndTimeWithCrossing(workDate, seg.end, true)
      : combineDateAndTime(workDate, seg.end);

    // Clip effective times to this segment
    const clippedStart = new Date(
      Math.max(effectiveIn.getTime(), segStart.getTime()),
    );
    const clippedEnd = new Date(
      Math.min(effectiveOut.getTime(), segEnd.getTime()),
    );

    if (clippedEnd.getTime() > clippedStart.getTime()) {
      result.push({ start: clippedStart, end: clippedEnd });
    }
  }

  return result;
}

interface SegmentClassification {
  ordinaryDay: number;
  nocturno: number;
  festivoDay: number;
  festivoNight: number;
}

/**
 * Classify a single continuous time segment into surcharge buckets.
 * Splits at midnight (for holiday boundaries) and at 7PM/6AM (for nocturno).
 */
function classifySegment(
  start: Date,
  end: Date,
  workDate: Date,
): SegmentClassification {
  const result: SegmentClassification = {
    ordinaryDay: 0,
    nocturno: 0,
    festivoDay: 0,
    festivoNight: 0,
  };

  if (end.getTime() <= start.getTime()) return result;

  // Check if this segment crosses calendar midnight
  const midnight = getMidnight(workDate);

  if (start.getTime() < midnight.getTime() && end.getTime() > midnight.getTime()) {
    // Split at midnight — pre-midnight gets workDate's day type,
    // post-midnight gets (workDate + 1)'s day type
    const pre = classifySubSegment(start, midnight, workDate);
    const nextDay = colAddDays(workDate, 1);
    const post = classifySubSegment(midnight, end, nextDay);

    result.ordinaryDay = pre.ordinaryDay + post.ordinaryDay;
    result.nocturno = pre.nocturno + post.nocturno;
    result.festivoDay = pre.festivoDay + post.festivoDay;
    result.festivoNight = pre.festivoNight + post.festivoNight;
  } else {
    // Determine which calendar day this segment falls on
    const segDate =
      start.getTime() >= midnight.getTime()
        ? colombiaDate(colFullYear(workDate), colMonth(workDate), colDate(workDate) + 1)
        : workDate;
    const sub = classifySubSegment(start, end, segDate);
    result.ordinaryDay = sub.ordinaryDay;
    result.nocturno = sub.nocturno;
    result.festivoDay = sub.festivoDay;
    result.festivoNight = sub.festivoNight;
  }

  return result;
}

/**
 * Classify a sub-segment that does NOT cross calendar midnight.
 * All minutes get the day type of `calendarDate`.
 * Splits at diurno/nocturno boundaries (6AM, 7PM).
 */
function classifySubSegment(
  start: Date,
  end: Date,
  calendarDate: Date,
): SegmentClassification {
  const result: SegmentClassification = {
    ordinaryDay: 0,
    nocturno: 0,
    festivoDay: 0,
    festivoNight: 0,
  };

  const isHoliday = isHolidayDate(calendarDate);
  const totalMins = minutesBetween(start, end);
  if (totalMins <= 0) return result;

  // Get minute-of-day for start and end (Colombia local time)
  const startMins = colHours(start) * 60 + colMinutes(start);
  const endMins = startMins + totalMins;

  // Split at nocturno boundaries within this sub-segment
  // Nocturno: 0-360 (midnight-6AM) and 1140-1440 (7PM-midnight)
  // Diurno: 360-1140 (6AM-7PM)
  // We iterate through boundaries and classify each chunk

  const boundaries = [
    DIURNO_START_MINS, // 360 = 6AM: nocturno→diurno
    DIURNO_END_MINS,   // 1140 = 7PM: diurno→nocturno
  ];

  // Add boundaries that fall within our range
  const cuts = [startMins];
  for (const b of boundaries) {
    if (b > startMins && b < endMins) {
      cuts.push(b);
    }
  }
  cuts.push(endMins);
  cuts.sort((a, b) => a - b);

  for (let i = 0; i < cuts.length - 1; i++) {
    const chunkStart = cuts[i];
    const chunkEnd = cuts[i + 1];
    const chunkMins = chunkEnd - chunkStart;
    if (chunkMins <= 0) continue;

    // Determine if this chunk is diurno or nocturno
    // A minute at `chunkStart` is diurno if 360 <= chunkStart < 1140
    const isDiurno =
      chunkStart >= DIURNO_START_MINS && chunkStart < DIURNO_END_MINS;

    if (isHoliday) {
      if (isDiurno) {
        result.festivoDay += chunkMins;
      } else {
        result.festivoNight += chunkMins;
      }
    } else {
      if (isDiurno) {
        result.ordinaryDay += chunkMins;
      } else {
        result.nocturno += chunkMins;
      }
    }
  }

  return result;
}

/**
 * Classify the last N minutes of the worked segments (the "tail").
 * Used to determine whether daily excess is diurno (HED) or nocturno (HEN).
 * Returns only diurno/nocturno split — day type doesn't matter for excess tagging.
 */
function classifyTail(
  workedSegments: WorkedSegment[],
  tailMins: number,
  workDate: Date,
): { diurno: number; nocturno: number } {
  let remaining = tailMins;
  let diurno = 0;
  let nocturno = 0;

  // Walk backwards through segments
  for (let i = workedSegments.length - 1; i >= 0 && remaining > 0; i--) {
    const seg = workedSegments[i];
    const segMins = minutesBetween(seg.start, seg.end);
    const take = Math.min(remaining, segMins);

    // Take from the end of this segment
    const tailStart = new Date(seg.end.getTime() - take * 60000);
    const tailEnd = seg.end;

    // Classify these tail minutes by time-of-day only
    const midnight = getMidnight(workDate);

    // Handle potential midnight crossing in the tail
    if (
      tailStart.getTime() < midnight.getTime() &&
      tailEnd.getTime() > midnight.getTime()
    ) {
      // Split at midnight
      const preMins = minutesBetween(tailStart, midnight);
      const postMins = minutesBetween(midnight, tailEnd);
      diurno += classifyTimeOfDay(tailStart, preMins);
      nocturno += preMins - classifyTimeOfDay(tailStart, preMins);
      diurno += classifyTimeOfDay(midnight, postMins);
      nocturno += postMins - classifyTimeOfDay(midnight, postMins);
    } else {
      const d = classifyTimeOfDay(tailStart, take);
      diurno += d;
      nocturno += take - d;
    }

    remaining -= take;
  }

  return { diurno, nocturno };
}

/**
 * Count how many of the next `mins` minutes starting from `start` are diurno.
 * The rest are nocturno.
 */
function classifyTimeOfDay(start: Date, mins: number): number {
  const startMins = colHours(start) * 60 + colMinutes(start);
  const endMins = startMins + mins;

  let diurno = 0;
  const cuts = [startMins];
  if (DIURNO_START_MINS > startMins && DIURNO_START_MINS < endMins)
    cuts.push(DIURNO_START_MINS);
  if (DIURNO_END_MINS > startMins && DIURNO_END_MINS < endMins)
    cuts.push(DIURNO_END_MINS);
  cuts.push(endMins);
  cuts.sort((a, b) => a - b);

  for (let i = 0; i < cuts.length - 1; i++) {
    const cs = cuts[i];
    const ce = cuts[i + 1];
    const isDiurno = cs >= DIURNO_START_MINS && cs < DIURNO_END_MINS;
    if (isDiurno) diurno += ce - cs;
  }

  return diurno;
}
