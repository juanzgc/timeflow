import { NextResponse } from "next/server";
import { and, eq, gte, lt, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { dailyAttendance, employees, punchLogs, punchCorrections } from "@/drizzle/schema";
import { auth } from "@/auth";
import { calculateAttendance } from "@/lib/engine/attendance-calculator";
import { invalidateAttendance } from "@/lib/attendance/invalidate";
import { colombiaStartOfDay, colAddDays, colSetHours } from "@/lib/timezone";
import { BUSINESS_DAY_START_HOUR } from "@/lib/engine/time-utils";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: idStr } = await params;
  const employeeId = parseInt(idStr, 10);
  if (isNaN(employeeId)) {
    return NextResponse.json({ error: "Invalid employee id" }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");

  if (!startDate || !endDate) {
    return NextResponse.json(
      { error: "startDate and endDate are required" },
      { status: 400 },
    );
  }

  try {
    await calculateAttendance({ employeeId, startDate, endDate });
  } catch {
    // Continue with existing data
  }

  const records = await db
    .select()
    .from(dailyAttendance)
    .where(
      and(
        eq(dailyAttendance.employeeId, employeeId),
        gte(dailyAttendance.workDate, startDate),
        lte(dailyAttendance.workDate, endDate),
      ),
    )
    .orderBy(dailyAttendance.workDate);

  // Calculate summary
  const summary = {
    daysWorked: 0,
    daysAbsent: 0,
    daysOff: 0,
    totalWorkedMins: 0,
    totalLateMins: 0,
    totalExcessMins: 0,
    totalNocturnoMins: 0,
    totalFestivoMins: 0,
    totalOrdinaryMins: 0,
  };

  for (const r of records) {
    if (r.status === "on-time" || r.status === "late") {
      summary.daysWorked++;
    } else if (r.status === "absent") {
      summary.daysAbsent++;
    } else if (r.status === "day-off" || r.status === "comp-day-off") {
      summary.daysOff++;
    }
    summary.totalWorkedMins += r.totalWorkedMins;
    summary.totalLateMins += r.lateMinutes;
    summary.totalExcessMins += r.excessHedMins + r.excessHenMins;
    summary.totalNocturnoMins += r.minsNocturno;
    summary.totalFestivoMins += r.minsFestivoDay + r.minsFestivoNight;
    summary.totalOrdinaryMins += r.minsOrdinaryDay;
  }

  return NextResponse.json({ records, summary });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: idStr } = await params;
  const employeeId = parseInt(idStr, 10);
  if (isNaN(employeeId)) {
    return NextResponse.json({ error: "Invalid employee id" }, { status: 400 });
  }

  let body: { workDate?: string; reason?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { workDate, reason } = body;
  if (!workDate) {
    return NextResponse.json({ error: "workDate is required" }, { status: 400 });
  }
  if (!reason || reason.length < 5) {
    return NextResponse.json(
      { error: "Reason is required and must be at least 5 characters" },
      { status: 400 },
    );
  }

  // Fetch the attendance record
  const [record] = await db
    .select()
    .from(dailyAttendance)
    .where(
      and(
        eq(dailyAttendance.employeeId, employeeId),
        eq(dailyAttendance.workDate, workDate),
      ),
    )
    .limit(1);

  if (!record) {
    return NextResponse.json(
      { error: "Attendance record not found" },
      { status: 404 },
    );
  }

  // Look up employee empCode for punch log deletion
  const [emp] = await db
    .select({ empCode: employees.empCode })
    .from(employees)
    .where(eq(employees.id, employeeId))
    .limit(1);

  if (!emp) {
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  }

  // Delete punch logs that belong to this business day only. Business day
  // runs 06:00 COT → next-day 06:00 COT, so a "clock-out next day" tail
  // (e.g. 03:43 on the calendar day after) is included, while the next
  // business day's clock-in at 16:59 is NOT. A previous calendar-day-based
  // window bled into the adjacent BD and wiped its punches.
  const dayStart = colSetHours(
    colombiaStartOfDay(workDate),
    BUSINESS_DAY_START_HOUR,
  );
  const dayEndExclusive = colSetHours(
    colAddDays(colombiaStartOfDay(workDate), 1),
    BUSINESS_DAY_START_HOUR,
  );

  await db
    .delete(punchLogs)
    .where(
      and(
        eq(punchLogs.empCode, emp.empCode),
        gte(punchLogs.punchTime, dayStart),
        lt(punchLogs.punchTime, dayEndExclusive),
      ),
    );

  // Insert audit records in punch_corrections
  const correctedBy = session.user.name ?? session.user.email ?? "admin";

  if (record.clockIn) {
    await db.insert(punchCorrections).values({
      employeeId,
      workDate,
      action: "delete_in",
      oldValue: record.clockIn,
      newValue: null,
      reason,
      correctedBy,
    });
  }

  if (record.clockOut) {
    await db.insert(punchCorrections).values({
      employeeId,
      workDate,
      action: "delete_out",
      oldValue: record.clockOut,
      newValue: null,
      reason,
      correctedBy,
    });
  }

  // Delete the daily_attendance row
  await db
    .delete(dailyAttendance)
    .where(eq(dailyAttendance.id, record.id));

  invalidateAttendance();

  return NextResponse.json({ success: true });
}
