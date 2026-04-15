import { NextResponse } from "next/server";
import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  employees,
  punchLogs,
  shifts,
  weeklySchedules,
  dailyAttendance,
} from "@/drizzle/schema";
import { auth } from "@/auth";
import { resolvePunches, type PunchLog, type ShiftSchedule } from "@/lib/engine/punch-resolver";
import { normalizePunches } from "@/lib/engine/punch-normalizer";
import { classifyDay, type ShiftSegment } from "@/lib/engine/daily-classifier";
import { getDailyLimitForDate } from "@/lib/engine/colombian-labor";
import { formatDateISO, getDayOfWeek } from "@/lib/engine/time-utils";
import { colombiaStartOfDay, colAddDays } from "@/lib/timezone";

/**
 * POST /api/attendance/calculate
 * Triggers daily attendance calculation for a date range.
 *
 * Body: { startDate: string, endDate: string, employeeId?: number }
 * If employeeId is omitted, calculates for ALL active employees.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { employeeId, startDate, endDate } = body;

  if (!startDate || !endDate) {
    return NextResponse.json(
      { error: "startDate and endDate are required" },
      { status: 400 },
    );
  }

  // Get employee(s) to process
  let emps: (typeof employees.$inferSelect)[];
  if (employeeId) {
    const [emp] = await db
      .select()
      .from(employees)
      .where(eq(employees.id, employeeId))
      .limit(1);
    if (!emp) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }
    emps = [emp];
  } else {
    emps = await db
      .select()
      .from(employees)
      .where(eq(employees.isActive, true));
  }

  const allResults = [];

  for (const emp of emps) {
    const empResults = await calculateForEmployee(emp, startDate, endDate);
    allResults.push(...empResults);
  }

  return NextResponse.json({ processed: allResults.length, results: allResults });
}

/** Calculate attendance for a single employee over a date range. */
async function calculateForEmployee(
  emp: typeof employees.$inferSelect,
  startDate: string,
  endDate: string,
) {
  // Fetch punches for the date range (with a day buffer for midnight crossings)
  const bufferStart = colAddDays(colombiaStartOfDay(startDate), -1);
  const bufferEnd = colAddDays(colombiaStartOfDay(endDate), 2); // +2 days to cover past end-of-day

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

  // Build schedule map for this employee
  const scheduleMap = new Map<number, ShiftSchedule>();
  const start = colombiaStartOfDay(startDate);

  // Find all weekly schedules that cover the date range
  const schedules = await db
    .select()
    .from(weeklySchedules)
    .where(
      and(
        eq(weeklySchedules.groupId, emp.groupId ?? -1),
        gte(weeklySchedules.weekStart, formatDateISO(new Date(start.getTime() - 7 * 86400000))),
        lte(weeklySchedules.weekStart, endDate),
      ),
    );

  // Get shifts from these schedules for this employee
  const allShifts: (typeof shifts.$inferSelect)[] = [];
  for (const sched of schedules) {
    const schedShifts = await db
      .select()
      .from(shifts)
      .where(
        and(
          eq(shifts.scheduleId, sched.id),
          eq(shifts.employeeId, emp.id),
        ),
      );
    allShifts.push(...schedShifts);
  }

  // Build a map: dayOfWeek → shift(s) for the schedule map used by punch resolver
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

  // Layer 1: Resolve punches
  const punchInputs: PunchLog[] = punches.map((p) => ({
    empCode: p.empCode,
    punchTime: p.punchTime,
    punchState: p.punchState,
  }));

  const resolved = resolvePunches(emp.empCode, emp.id, punchInputs, scheduleMap);

  // Process each resolved business day
  const results = [];

  for (const res of resolved) {
    const dateStr = formatDateISO(res.workDate);

    // Check if this date is within our range
    if (dateStr < startDate || dateStr > endDate) continue;

    const dow = getDayOfWeek(res.workDate);

    // Find the shifts for this employee on this day of week
    const dayShifts = allShifts.filter(
      (s) =>
        s.dayOfWeek === dow &&
        s.shiftType === "regular" &&
        s.shiftStart &&
        s.shiftEnd,
    );

    if (dayShifts.length === 0 || res.isMissingPunch || !res.clockIn || !res.clockOut) {
      // No schedule or missing punch — write minimal record
      await db
        .insert(dailyAttendance)
        .values({
          employeeId: emp.id,
          workDate: dateStr,
          clockIn: res.clockIn,
          clockOut: res.clockOut,
          isMissingPunch: res.isMissingPunch,
          status: res.isMissingPunch ? null : "absent",
        })
        .onConflictDoUpdate({
          target: [dailyAttendance.employeeId, dailyAttendance.workDate],
          set: {
            clockIn: res.clockIn,
            clockOut: res.clockOut,
            isMissingPunch: res.isMissingPunch,
            status: res.isMissingPunch ? null : "absent",
          },
        });

      results.push({
        employeeId: emp.id,
        name: `${emp.firstName} ${emp.lastName}`,
        workDate: dateStr,
        status: res.isMissingPunch ? "missing_punch" : "absent",
        totalWorkedMins: 0,
      });
      continue;
    }

    // Determine schedule context for split shifts
    const primaryShift = dayShifts[0];
    const splitShift = dayShifts.length > 1 ? dayShifts[1] : null;

    // Use last segment's end for normalization
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
      continue;
    }

    // Build segments for classifier
    const segments: ShiftSegment[] = dayShifts.map((s) => ({
      start: s.shiftStart!,
      end: s.shiftEnd!,
      crossesMidnight: s.crossesMidnight,
    }));

    // Calculate total break minutes
    const totalBreakMins = dayShifts.reduce((sum, s) => sum + s.breakMinutes, 0);

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

    // Write to daily_attendance (upsert)
    await db
      .insert(dailyAttendance)
      .values({
        employeeId: emp.id,
        workDate: dateStr,
        clockIn: res.clockIn,
        clockOut: res.clockOut,
        effectiveIn: norm.effectiveIn,
        effectiveOut: norm.effectiveOut,
        isClockInManual: false,
        isClockOutManual: false,
        isMissingPunch: false,
        scheduledStart: primaryShift.shiftStart,
        scheduledEnd: lastShift.shiftEnd,
        scheduledGapMins: splitShift ? 0 : 0,
        scheduledBreakMins: totalBreakMins,
        crossesMidnight,
        isSplitShift: dayShifts.length > 1,
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
          isMissingPunch: false,
          scheduledStart: primaryShift.shiftStart,
          scheduledEnd: lastShift.shiftEnd,
          scheduledBreakMins: totalBreakMins,
          crossesMidnight,
          isSplitShift: dayShifts.length > 1,
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
  }

  return results;
}
