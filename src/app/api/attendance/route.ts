import { NextResponse } from "next/server";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { employees, groups, dailyAttendance } from "@/drizzle/schema";
import { auth } from "@/auth";
import { calculateAttendance } from "@/lib/engine/attendance-calculator";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  const groupId = searchParams.get("groupId");

  if (!startDate || !endDate) {
    return NextResponse.json(
      { error: "startDate and endDate are required" },
      { status: 400 },
    );
  }

  await calculateAttendance({ startDate, endDate });

  // Build conditions
  const conditions = [
    eq(employees.isActive, true),
    gte(dailyAttendance.workDate, startDate),
    lte(dailyAttendance.workDate, endDate),
  ];

  if (groupId) {
    conditions.push(eq(employees.groupId, parseInt(groupId, 10)));
  }

  // Get summary per employee for the date range
  const rows = await db
    .select({
      employeeId: employees.id,
      empCode: employees.empCode,
      firstName: employees.firstName,
      lastName: employees.lastName,
      groupId: employees.groupId,
      groupName: groups.name,
      daysPresent: sql<number>`count(case when ${dailyAttendance.clockIn} is not null then 1 end)::int`,
      totalWorkedMins: sql<number>`coalesce(sum(${dailyAttendance.totalWorkedMins}), 0)::int`,
      totalLateMins: sql<number>`coalesce(sum(${dailyAttendance.lateMinutes}), 0)::int`,
      totalExcessMins: sql<number>`coalesce(sum(${dailyAttendance.excessHedMins} + ${dailyAttendance.excessHenMins}), 0)::int`,
      totalNocturnoMins: sql<number>`coalesce(sum(${dailyAttendance.minsNocturno}), 0)::int`,
      totalFestivoMins: sql<number>`coalesce(sum(${dailyAttendance.minsFestivoDay} + ${dailyAttendance.minsFestivoNight}), 0)::int`,
    })
    .from(employees)
    .leftJoin(groups, eq(employees.groupId, groups.id))
    .innerJoin(
      dailyAttendance,
      eq(dailyAttendance.employeeId, employees.id),
    )
    .where(and(...conditions))
    .groupBy(employees.id, employees.empCode, employees.firstName, employees.lastName, employees.groupId, groups.name)
    .orderBy(employees.firstName);

  // Also get totals for summary cards
  const totalWorked = rows.reduce((s, r) => s + r.totalWorkedMins, 0);
  const totalLate = rows.reduce((s, r) => s + r.totalLateMins, 0);
  const totalExcess = rows.reduce((s, r) => s + r.totalExcessMins, 0);

  return NextResponse.json({
    summary: { totalWorkedMins: totalWorked, totalLateMins: totalLate, totalExcessMins: totalExcess },
    employees: rows,
  });
}
