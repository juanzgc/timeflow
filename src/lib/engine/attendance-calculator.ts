/**
 * Attendance Calculator — Schedule-Driven Engine
 *
 * Core calculation logic extracted from the API route so it can be called
 * directly (no HTTP concerns). Used by:
 *   - POST /api/attendance/calculate (thin wrapper)
 *   - POST /api/attendance/recalculate (thin wrapper)
 *   - POST /api/biotime/sync (direct call after sync)
 *
 * Algorithm:
 *   Phase A — Gather data (punches, schedules, shifts)
 *   Phase B — Resolve punches via engine Layer 1
 *   Phase C — Schedule-driven loop (each date in range)
 *   Phase D — Orphan punches (punch days with no schedule)
 */

import { and, eq, gte, lte, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  employees,
  punchLogs,
  punchCorrections,
  shifts,
  weeklySchedules,
  dailyAttendance,
} from "@/drizzle/schema";
import { resolvePunches, type PunchLog, type ShiftSchedule } from "./punch-resolver";
import { normalizePunches } from "./punch-normalizer";
import { classifyDay, type ShiftSegment } from "./daily-classifier";
import { getDailyLimitForDate } from "./colombian-labor";
import { formatDateISO, getDayOfWeek, parseTimeToMinutes } from "./time-utils";
import { colombiaStartOfDay, colAddDays } from "@/lib/timezone";
import { getMonday } from "@/lib/schedule-utils";

// ─── Public types ───────────────────────────────────────────────────────────

export interface AttendanceOptions {
  employeeId?: number; // omit = all active employees
  startDate: string;   // "YYYY-MM-DD"
  endDate: string;     // "YYYY-MM-DD"
}

export interface AttendanceResult {
  employeeId: number;
  name: string;
  workDate: string;
  status: string;
  totalWorkedMins: number;
  minsNocturno?: number;
  excessHedMins?: number;
  excessHenMins?: number;
}

// ─── Main entry point ───────────────────────────────────────────────────────

export async function calculateAttendance(
  options: AttendanceOptions,
): Promise<AttendanceResult[]> {
  const { employeeId, startDate, endDate } = options;

  // Get employee(s) to process
  let emps: (typeof employees.$inferSelect)[];
  if (employeeId) {
    const [emp] = await db
      .select()
      .from(employees)
      .where(eq(employees.id, employeeId))
      .limit(1);
    if (!emp) return [];
    emps = [emp];
  } else {
    emps = await db
      .select()
      .from(employees)
      .where(eq(employees.isActive, true));
  }

  const allResults: AttendanceResult[] = [];
  for (const emp of emps) {
    const empResults = await calculateForEmployee(emp, startDate, endDate);
    allResults.push(...empResults);
  }
  return allResults;
}

// ─── Per-employee calculation ───────────────────────────────────────────────

async function calculateForEmployee(
  emp: typeof employees.$inferSelect,
  startDate: string,
  endDate: string,
): Promise<AttendanceResult[]> {
  // ── Phase A: Gather data ──────────────────────────────────────────────

  // A1. Fetch punches with ±1 day buffer for midnight crossings
  const bufferStart = colAddDays(colombiaStartOfDay(startDate), -1);
  const bufferEnd = colAddDays(colombiaStartOfDay(endDate), 2);

  const punches = await db
    .select()
    .from(punchLogs)
    .where(
      and(
        eq(punchLogs.empCode, emp.empCode),
        gte(punchLogs.punchTime, bufferStart),
        lte(punchLogs.punchTime, bufferEnd),
      ),
    )
    .orderBy(punchLogs.punchTime);

  // A2. Fetch weekly schedules covering the date range
  const rangeStart = colombiaStartOfDay(startDate);
  const earliestWeekStart = formatDateISO(
    getMonday(colAddDays(rangeStart, -7)),
  );

  const schedules = await db
    .select()
    .from(weeklySchedules)
    .where(
      and(
        eq(weeklySchedules.groupId, emp.groupId ?? -1),
        gte(weeklySchedules.weekStart, earliestWeekStart),
        lte(weeklySchedules.weekStart, endDate),
      ),
    );

  // A3. Batch-fetch shifts for this employee from all schedules
  const allShifts: (typeof shifts.$inferSelect)[] = [];
  if (schedules.length > 0) {
    const scheduleIds = schedules.map((s) => s.id);
    const fetched = await db
      .select()
      .from(shifts)
      .where(
        and(
          inArray(shifts.scheduleId, scheduleIds),
          eq(shifts.employeeId, emp.id),
        ),
      );
    allShifts.push(...fetched);
  }

  // A4. Fetch punch corrections for manual flag detection
  const corrections = await db
    .select()
    .from(punchCorrections)
    .where(
      and(
        eq(punchCorrections.employeeId, emp.id),
        gte(punchCorrections.workDate, startDate),
        lte(punchCorrections.workDate, endDate),
      ),
    );

  const correctionsByDate = new Map<string, { isClockInManual: boolean; isClockOutManual: boolean }>();
  for (const c of corrections) {
    const existing = correctionsByDate.get(c.workDate) ?? { isClockInManual: false, isClockOutManual: false };
    if (c.action === "edit_in" || c.action === "add_in") existing.isClockInManual = true;
    if (c.action === "edit_out" || c.action === "add_out") existing.isClockOutManual = true;
    correctionsByDate.set(c.workDate, existing);
  }

  // A5. Build lookup maps
  const scheduleByWeekStart = new Map(
    schedules.map((s) => [s.weekStart, s]),
  );
  const shiftsByScheduleId = new Map<number, (typeof shifts.$inferSelect)[]>();
  for (const s of allShifts) {
    const arr = shiftsByScheduleId.get(s.scheduleId) ?? [];
    arr.push(s);
    shiftsByScheduleId.set(s.scheduleId, arr);
  }

  // ── Phase B: Resolve punches ──────────────────────────────────────────

  // Build schedule map for punch resolver (regular shifts only)
  const scheduleMap = new Map<number, ShiftSchedule>();
  for (const s of allShifts) {
    if (s.shiftType === "regular" && s.shiftStart && s.shiftEnd) {
      scheduleMap.set(s.dayOfWeek, {
        dayOfWeek: s.dayOfWeek,
        shiftStart: s.shiftStart,
        shiftEnd: s.shiftEnd,
        crossesMidnight: s.crossesMidnight,
      });
    }
  }

  const punchInputs: PunchLog[] = punches.map((p) => ({
    empCode: p.empCode,
    punchTime: p.punchTime,
    punchState: p.punchState,
  }));

  const resolved = resolvePunches(emp.empCode, emp.id, punchInputs, scheduleMap);

  // Build punchByDate map: "YYYY-MM-DD" → ResolvedPunches
  const punchByDate = new Map(
    resolved.map((r) => [formatDateISO(r.workDate), r]),
  );

  // ── Phase C: Schedule-driven loop ─────────────────────────────────────

  const results: AttendanceResult[] = [];
  const processedDates = new Set<string>();

  let cursor = colombiaStartOfDay(startDate);
  const end = colombiaStartOfDay(endDate);

  while (formatDateISO(cursor) <= formatDateISO(end)) {
    const dateStr = formatDateISO(cursor);

    const dow = getDayOfWeek(cursor);

    // Find applicable weekly schedule for this date
    const weekMonday = getMonday(cursor);
    const weekMondayStr = formatDateISO(weekMonday);
    const schedule = scheduleByWeekStart.get(weekMondayStr);

    let dayShiftsAll: (typeof shifts.$inferSelect)[] = [];
    if (schedule) {
      dayShiftsAll = (shiftsByScheduleId.get(schedule.id) ?? []).filter(
        (s) => s.dayOfWeek === dow,
      );
    }

    if (dayShiftsAll.length === 0) {
      // Clean up stale day-off / comp-day-off records left after shift deletion
      const [stale] = await db
        .select({
          id: dailyAttendance.id,
          status: dailyAttendance.status,
          clockIn: dailyAttendance.clockIn,
          clockOut: dailyAttendance.clockOut,
        })
        .from(dailyAttendance)
        .where(
          and(
            eq(dailyAttendance.employeeId, emp.id),
            eq(dailyAttendance.workDate, dateStr),
          ),
        )
        .limit(1);

      if (
        stale &&
        (stale.status === "day-off" || stale.status === "comp-day-off") &&
        !stale.clockIn &&
        !stale.clockOut
      ) {
        await db.delete(dailyAttendance).where(eq(dailyAttendance.id, stale.id));
      }

      // No shifts scheduled — leave for Phase D if punches exist
      cursor = colAddDays(cursor, 1);
      continue;
    }

    // This date has schedule entries — mark as processed so Phase D skips it
    processedDates.add(dateStr);

    // Check shift types for this day
    const dayOffShift = dayShiftsAll.find((s) => s.shiftType === "day_off");
    const compDayOff = dayShiftsAll.find((s) => s.shiftType === "comp_day_off");
    const regularShifts = dayShiftsAll
      .filter((s) => s.shiftType === "regular" && s.shiftStart && s.shiftEnd)
      .sort((a, b) => parseTimeToMinutes(a.shiftStart!) - parseTimeToMinutes(b.shiftStart!));

    if (dayOffShift) {
      // Day off — upsert minimal record
      await upsertMinimalRecord(emp.id, dateStr, "day-off");
      results.push({
        employeeId: emp.id,
        name: `${emp.firstName} ${emp.lastName}`,
        workDate: dateStr,
        status: "day-off",
        totalWorkedMins: 0,
      });
      cursor = colAddDays(cursor, 1);
      continue;
    }

    if (compDayOff) {
      // Comp day off — upsert minimal record
      await upsertMinimalRecord(emp.id, dateStr, "comp-day-off");
      results.push({
        employeeId: emp.id,
        name: `${emp.firstName} ${emp.lastName}`,
        workDate: dateStr,
        status: "comp-day-off",
        totalWorkedMins: 0,
      });
      cursor = colAddDays(cursor, 1);
      continue;
    }

    if (regularShifts.length === 0) {
      // No regular shifts (shouldn't happen but guard)
      cursor = colAddDays(cursor, 1);
      continue;
    }

    // Regular shift(s) — check for punches
    const res = punchByDate.get(dateStr);

    if (!res || (!res.clockIn && !res.clockOut)) {
      // No punches — absent
      const primaryShift = regularShifts[0];
      const lastShift = regularShifts[regularShifts.length - 1];
      await upsertAbsentRecord(emp.id, dateStr, primaryShift.shiftStart!, lastShift.shiftEnd!);
      results.push({
        employeeId: emp.id,
        name: `${emp.firstName} ${emp.lastName}`,
        workDate: dateStr,
        status: "absent",
        totalWorkedMins: 0,
      });
      cursor = colAddDays(cursor, 1);
      continue;
    }

    if (res.isMissingPunch || !res.clockIn || !res.clockOut) {
      // Missing punch
      await db
        .insert(dailyAttendance)
        .values({
          employeeId: emp.id,
          workDate: dateStr,
          clockIn: res.clockIn,
          clockOut: res.clockOut,
          isMissingPunch: true,
          status: null,
          scheduledStart: regularShifts[0].shiftStart,
          scheduledEnd: regularShifts[regularShifts.length - 1].shiftEnd,
        })
        .onConflictDoUpdate({
          target: [dailyAttendance.employeeId, dailyAttendance.workDate],
          set: {
            clockIn: res.clockIn,
            clockOut: res.clockOut,
            isMissingPunch: true,
            status: null,
            scheduledStart: regularShifts[0].shiftStart,
            scheduledEnd: regularShifts[regularShifts.length - 1].shiftEnd,
          },
        });

      results.push({
        employeeId: emp.id,
        name: `${emp.firstName} ${emp.lastName}`,
        workDate: dateStr,
        status: "missing_punch",
        totalWorkedMins: 0,
      });
      cursor = colAddDays(cursor, 1);
      continue;
    }

    // Full pair — normalize → classify → upsert full record
    const primaryShift = regularShifts[0];
    const splitShift = regularShifts.length > 1 ? regularShifts[1] : null;
    const lastShift = splitShift ?? primaryShift;
    const crossesMidnight = lastShift.crossesMidnight;

    // Layer 2: Normalize
    const norm = normalizePunches(
      res.clockIn,
      res.clockOut,
      primaryShift.shiftStart!,
      lastShift.shiftEnd!,
      res.workDate,
      crossesMidnight,
    );

    if (!norm.effectiveOut) {
      results.push({
        employeeId: emp.id,
        name: `${emp.firstName} ${emp.lastName}`,
        workDate: dateStr,
        status: "missing_punch",
        totalWorkedMins: 0,
      });
      cursor = colAddDays(cursor, 1);
      continue;
    }

    // Build segments for classifier
    const segments: ShiftSegment[] = regularShifts.map((s) => ({
      start: s.shiftStart!,
      end: s.shiftEnd!,
      crossesMidnight: s.crossesMidnight,
    }));

    const totalBreakMins = regularShifts.reduce(
      (sum, s) => sum + s.breakMinutes,
      0,
    );

    const dailyLimit = getDailyLimitForDate(res.workDate);

    // Layer 3: Classify
    const cls = classifyDay(
      norm.effectiveIn,
      norm.effectiveOut,
      res.workDate,
      segments,
      totalBreakMins,
      dailyLimit,
    );

    const status = norm.lateMinutes > 0 ? "late" : "on-time";

    // Calculate actual split shift gap
    const scheduledGapMins =
      splitShift
        ? parseTimeToMinutes(splitShift.shiftStart!) -
          parseTimeToMinutes(primaryShift.shiftEnd!)
        : 0;

    // Upsert full record
    await db
      .insert(dailyAttendance)
      .values({
        employeeId: emp.id,
        workDate: dateStr,
        clockIn: res.clockIn,
        clockOut: res.clockOut,
        effectiveIn: norm.effectiveIn,
        effectiveOut: norm.effectiveOut,
        isClockInManual: correctionsByDate.get(dateStr)?.isClockInManual ?? false,
        isClockOutManual: correctionsByDate.get(dateStr)?.isClockOutManual ?? false,
        isMissingPunch: false,
        scheduledStart: primaryShift.shiftStart,
        scheduledEnd: lastShift.shiftEnd,
        scheduledGapMins,
        scheduledBreakMins: totalBreakMins,
        crossesMidnight,
        isSplitShift: regularShifts.length > 1,
        totalWorkedMins: cls.totalWorkedMins,
        lateMinutes: norm.lateMinutes,
        earlyLeaveMins: norm.earlyLeaveMinutes,
        minsOrdinaryDay: cls.minsOrdinaryDay,
        minsNocturno: cls.minsNocturno,
        minsFestivoDay: cls.minsFestivoDay,
        minsFestivoNight: cls.minsFestivoNight,
        dayType: cls.dayType,
        status,
        excessHedMins: cls.excessHedMins,
        excessHenMins: cls.excessHenMins,
        dailyLimitMins: dailyLimit,
        isProcessed: true,
      })
      .onConflictDoUpdate({
        target: [dailyAttendance.employeeId, dailyAttendance.workDate],
        set: {
          clockIn: res.clockIn,
          clockOut: res.clockOut,
          effectiveIn: norm.effectiveIn,
          effectiveOut: norm.effectiveOut,
          isClockInManual: correctionsByDate.get(dateStr)?.isClockInManual ?? false,
          isClockOutManual: correctionsByDate.get(dateStr)?.isClockOutManual ?? false,
          isMissingPunch: false,
          scheduledStart: primaryShift.shiftStart,
          scheduledEnd: lastShift.shiftEnd,
          scheduledGapMins,
          scheduledBreakMins: totalBreakMins,
          crossesMidnight,
          isSplitShift: regularShifts.length > 1,
          totalWorkedMins: cls.totalWorkedMins,
          lateMinutes: norm.lateMinutes,
          earlyLeaveMins: norm.earlyLeaveMinutes,
          minsOrdinaryDay: cls.minsOrdinaryDay,
          minsNocturno: cls.minsNocturno,
          minsFestivoDay: cls.minsFestivoDay,
          minsFestivoNight: cls.minsFestivoNight,
          dayType: cls.dayType,
          status,
          excessHedMins: cls.excessHedMins,
          excessHenMins: cls.excessHenMins,
          dailyLimitMins: dailyLimit,
          isProcessed: true,
        },
      });

    results.push({
      employeeId: emp.id,
      name: `${emp.firstName} ${emp.lastName}`,
      workDate: dateStr,
      status,
      totalWorkedMins: cls.totalWorkedMins,
      minsNocturno: cls.minsNocturno,
      excessHedMins: cls.excessHedMins,
      excessHenMins: cls.excessHenMins,
    });

    cursor = colAddDays(cursor, 1);
  }

  // ── Phase D: Orphan punches ───────────────────────────────────────────
  // Resolved punch days that weren't covered by the schedule loop

  for (const res of resolved) {
    const dateStr = formatDateISO(res.workDate);
    if (dateStr < startDate || dateStr > endDate) continue;
    if (processedDates.has(dateStr)) continue;

    // Orphan punch — no schedule for this day
    await db
      .insert(dailyAttendance)
      .values({
        employeeId: emp.id,
        workDate: dateStr,
        clockIn: res.clockIn,
        clockOut: res.clockOut,
        isMissingPunch: res.isMissingPunch,
        status: "unscheduled",
      })
      .onConflictDoUpdate({
        target: [dailyAttendance.employeeId, dailyAttendance.workDate],
        set: {
          clockIn: res.clockIn,
          clockOut: res.clockOut,
          isMissingPunch: res.isMissingPunch,
          status: "unscheduled",
        },
      });

    results.push({
      employeeId: emp.id,
      name: `${emp.firstName} ${emp.lastName}`,
      workDate: dateStr,
      status: "unscheduled",
      totalWorkedMins: 0,
    });
  }

  return results;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function upsertMinimalRecord(
  employeeId: number,
  workDate: string,
  status: "day-off" | "comp-day-off",
): Promise<void> {
  await db
    .insert(dailyAttendance)
    .values({
      employeeId,
      workDate,
      status,
      totalWorkedMins: 0,
      isMissingPunch: false,
      isProcessed: true,
    })
    .onConflictDoUpdate({
      target: [dailyAttendance.employeeId, dailyAttendance.workDate],
      set: {
        status,
        totalWorkedMins: 0,
        clockIn: null,
        clockOut: null,
        effectiveIn: null,
        effectiveOut: null,
        isMissingPunch: false,
        lateMinutes: 0,
        earlyLeaveMins: 0,
        minsOrdinaryDay: 0,
        minsNocturno: 0,
        minsFestivoDay: 0,
        minsFestivoNight: 0,
        excessHedMins: 0,
        excessHenMins: 0,
        isProcessed: true,
      },
    });
}

async function upsertAbsentRecord(
  employeeId: number,
  workDate: string,
  scheduledStart: string,
  scheduledEnd: string,
): Promise<void> {
  await db
    .insert(dailyAttendance)
    .values({
      employeeId,
      workDate,
      status: "absent",
      totalWorkedMins: 0,
      scheduledStart,
      scheduledEnd,
      isMissingPunch: false,
      isProcessed: true,
    })
    .onConflictDoUpdate({
      target: [dailyAttendance.employeeId, dailyAttendance.workDate],
      set: {
        status: "absent",
        totalWorkedMins: 0,
        scheduledStart,
        scheduledEnd,
        clockIn: null,
        clockOut: null,
        effectiveIn: null,
        effectiveOut: null,
        isClockInManual: false,
        isClockOutManual: false,
        isMissingPunch: false,
        crossesMidnight: false,
        isSplitShift: false,
        dayType: "regular",
        dailyLimitMins: 0,
        lateMinutes: 0,
        earlyLeaveMins: 0,
        minsOrdinaryDay: 0,
        minsNocturno: 0,
        minsFestivoDay: 0,
        minsFestivoNight: 0,
        excessHedMins: 0,
        excessHenMins: 0,
        isProcessed: true,
      },
    });
}
