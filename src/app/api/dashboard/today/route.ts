import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { employees, groups, dailyAttendance } from "@/drizzle/schema";
import { auth } from "@/auth";
import { todayColombiaISO, colAddDays, formatColombiaDateISO } from "@/lib/timezone";
import { syncIfStale } from "@/lib/biotime/sync-if-stale";
import { calculateAttendance } from "@/lib/engine/attendance-calculator";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date();
  const todayStr = todayColombiaISO();

  // Sync BioTime if stale, then recalculate all employees for today
  await syncIfStale(5);
  await calculateAttendance({ startDate: todayStr, endDate: todayStr });

  // Get all active employees with their group and today's attendance
  const rows = await db
    .select({
      id: employees.id,
      empCode: employees.empCode,
      firstName: employees.firstName,
      lastName: employees.lastName,
      groupId: employees.groupId,
      groupName: groups.name,
      clockIn: dailyAttendance.clockIn,
      clockOut: dailyAttendance.clockOut,
      effectiveIn: dailyAttendance.effectiveIn,
      effectiveOut: dailyAttendance.effectiveOut,
      totalWorkedMins: dailyAttendance.totalWorkedMins,
      lateMinutes: dailyAttendance.lateMinutes,
      earlyLeaveMins: dailyAttendance.earlyLeaveMins,
      excessHedMins: dailyAttendance.excessHedMins,
      excessHenMins: dailyAttendance.excessHenMins,
      status: dailyAttendance.status,
      dayType: dailyAttendance.dayType,
      isMissingPunch: dailyAttendance.isMissingPunch,
      isClockInManual: dailyAttendance.isClockInManual,
      isClockOutManual: dailyAttendance.isClockOutManual,
    })
    .from(employees)
    .leftJoin(groups, eq(employees.groupId, groups.id))
    .leftJoin(
      dailyAttendance,
      and(
        eq(dailyAttendance.employeeId, employees.id),
        eq(dailyAttendance.workDate, todayStr),
      ),
    )
    .where(eq(employees.isActive, true))
    .orderBy(
      sql`CASE ${dailyAttendance.status}
        WHEN 'absent' THEN 1
        WHEN 'late' THEN 2
        WHEN 'on-time' THEN 3
        WHEN 'day-off' THEN 4
        WHEN 'comp-day-off' THEN 5
        ELSE 6
      END`,
    );

  // Calculate KPIs
  const totalEmployees = rows.length;
  const present = rows.filter((r) => r.clockIn !== null).length;
  const onTime = rows.filter((r) => r.clockIn !== null && (r.lateMinutes ?? 0) === 0).length;
  const late = rows.filter((r) => (r.lateMinutes ?? 0) > 0).length;
  const missingPunch = rows.filter((r) => r.isMissingPunch).length;

  // Calculate last week same day for trends
  const lastWeekDate = colAddDays(today, -7);
  const lastWeekStr = formatColombiaDateISO(lastWeekDate);

  const lastWeekRows = await db
    .select({
      clockIn: dailyAttendance.clockIn,
      lateMinutes: dailyAttendance.lateMinutes,
    })
    .from(dailyAttendance)
    .innerJoin(employees, and(eq(dailyAttendance.employeeId, employees.id), eq(employees.isActive, true)))
    .where(eq(dailyAttendance.workDate, lastWeekStr));

  const lwPresent = lastWeekRows.filter((r) => r.clockIn !== null).length;
  const lwOnTime = lastWeekRows.filter((r) => r.clockIn !== null && (r.lateMinutes ?? 0) === 0).length;
  const lwLate = lastWeekRows.filter((r) => (r.lateMinutes ?? 0) > 0).length;

  return NextResponse.json({
    date: todayStr,
    kpis: {
      totalEmployees,
      present,
      onTime,
      onTimePercent: present > 0 ? Math.round((onTime / present) * 100) : 0,
      late,
      missingPunch,
      trends: {
        present: present - lwPresent,
        onTimePercent: present > 0
          ? Math.round((onTime / present) * 100) - (lwPresent > 0 ? Math.round((lwOnTime / lwPresent) * 100) : 0)
          : 0,
        late: late - lwLate,
      },
    },
    attendance: rows,
  });
}
