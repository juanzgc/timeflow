import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { employees, groups, weeklySchedules, shifts } from "@/drizzle/schema";
import { auth } from "@/auth";

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

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
  const weekStart = searchParams.get("weekStart");

  if (!weekStart) {
    return NextResponse.json({ error: "weekStart is required" }, { status: 400 });
  }

  // Get employee with group
  const [emp] = await db
    .select({
      id: employees.id,
      groupId: employees.groupId,
      groupName: groups.name,
      restDay: employees.restDay,
    })
    .from(employees)
    .leftJoin(groups, eq(employees.groupId, groups.id))
    .where(eq(employees.id, employeeId))
    .limit(1);

  if (!emp) {
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  }

  if (!emp.groupId) {
    return NextResponse.json({
      weekStart,
      groupName: null,
      scheduleExists: false,
      shifts: [],
      totalHours: 0,
      editUrl: null,
    });
  }

  // Find schedule for this week + group
  const [schedule] = await db
    .select()
    .from(weeklySchedules)
    .where(
      and(
        eq(weeklySchedules.weekStart, weekStart),
        eq(weeklySchedules.groupId, emp.groupId),
      ),
    )
    .limit(1);

  if (!schedule) {
    return NextResponse.json({
      weekStart,
      groupName: emp.groupName,
      scheduleExists: false,
      shifts: [],
      totalHours: 0,
      editUrl: `/schedules/${weekStart}/${emp.groupId}`,
    });
  }

  // Get shifts for this employee in this schedule
  const empShifts = await db
    .select()
    .from(shifts)
    .where(
      and(
        eq(shifts.scheduleId, schedule.id),
        eq(shifts.employeeId, employeeId),
      ),
    )
    .orderBy(shifts.dayOfWeek, shifts.shiftStart);

  // Build response for all 7 days
  const dayShifts = [];
  let totalHours = 0;

  for (let dow = 0; dow < 7; dow++) {
    const dayEntries = empShifts.filter((s) => s.dayOfWeek === dow);

    if (dayEntries.length === 0) {
      // Check if this is the employee's rest day
      if (dow === emp.restDay) {
        dayShifts.push({
          dayOfWeek: dow,
          dayName: DAY_NAMES[dow],
          shiftType: "day_off",
          isRestDay: true,
          hours: 0,
        });
      } else {
        dayShifts.push({
          dayOfWeek: dow,
          dayName: DAY_NAMES[dow],
          shiftType: "none",
          hours: 0,
        });
      }
      continue;
    }

    const primary = dayEntries[0];

    if (primary.shiftType === "day_off") {
      dayShifts.push({
        dayOfWeek: dow,
        dayName: DAY_NAMES[dow],
        shiftType: "day_off",
        isRestDay: dow === emp.restDay,
        hours: 0,
      });
      continue;
    }

    if (primary.shiftType === "comp_day_off") {
      dayShifts.push({
        dayOfWeek: dow,
        dayName: DAY_NAMES[dow],
        shiftType: "comp_day_off",
        compDebitMins: primary.compDebitMins,
        hours: 0,
      });
      continue;
    }

    // Regular shift(s)
    const isSplit = dayEntries.length > 1;
    let hours = 0;

    for (const s of dayEntries) {
      if (s.shiftStart && s.shiftEnd) {
        const startMins = parseTime(s.shiftStart);
        const endMins = parseTime(s.shiftEnd);
        const dur = s.crossesMidnight
          ? 1440 - startMins + endMins
          : endMins - startMins;
        hours += (dur - s.breakMinutes) / 60;
      }
    }

    totalHours += hours;

    dayShifts.push({
      dayOfWeek: dow,
      dayName: DAY_NAMES[dow],
      shiftType: "regular",
      shiftStart: primary.shiftStart,
      shiftEnd: dayEntries[dayEntries.length - 1].shiftEnd,
      crossesMidnight: dayEntries[dayEntries.length - 1].crossesMidnight,
      breakMinutes: dayEntries.reduce((s, e) => s + e.breakMinutes, 0),
      isSplit,
      hours: Math.round(hours * 10) / 10,
      ...(isSplit
        ? {
            segments: dayEntries.map((s) => ({
              shiftStart: s.shiftStart,
              shiftEnd: s.shiftEnd,
              crossesMidnight: s.crossesMidnight,
              breakMinutes: s.breakMinutes,
            })),
          }
        : {}),
    });
  }

  return NextResponse.json({
    weekStart,
    groupName: emp.groupName,
    scheduleExists: true,
    shifts: dayShifts,
    totalHours: Math.round(totalHours * 10) / 10,
    editUrl: `/schedules/${weekStart}/${emp.groupId}`,
  });
}

function parseTime(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
