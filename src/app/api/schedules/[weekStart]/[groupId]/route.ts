import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  weeklySchedules,
  shifts,
  employees,
  groups,
  compTransactions,
} from "@/drizzle/schema";
import { auth } from "@/auth";
import { getHolidaysInRange } from "@/lib/holidays";
import { getDailyLimitMins } from "@/lib/schedule-utils";

// GET /api/schedules/[weekStart]/[groupId] — full schedule with shifts and employees
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ weekStart: string; groupId: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { weekStart, groupId } = await params;
  const gid = Number(groupId);

  // Get group info
  const [group] = await db
    .select()
    .from(groups)
    .where(eq(groups.id, gid))
    .limit(1);

  if (!group) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }

  // Get or info about the schedule
  const [schedule] = await db
    .select()
    .from(weeklySchedules)
    .where(
      and(
        eq(weeklySchedules.weekStart, weekStart),
        eq(weeklySchedules.groupId, gid),
      ),
    )
    .limit(1);

  // Get employees in this group
  const groupEmployees = await db
    .select({
      id: employees.id,
      empCode: employees.empCode,
      firstName: employees.firstName,
      lastName: employees.lastName,
      restDay: employees.restDay,
    })
    .from(employees)
    .where(and(eq(employees.groupId, gid), eq(employees.isActive, true)))
    .orderBy(employees.firstName, employees.lastName);

  // Get comp balances for employees
  const employeesWithBalance = await Promise.all(
    groupEmployees.map(async (emp) => {
      const [balance] = await db
        .select({
          balance: sql<number>`coalesce(
            (select balance_after from ${compTransactions}
             where ${compTransactions.employeeId} = ${emp.id}
             order by ${compTransactions.createdAt} desc limit 1),
            0
          )::int`,
        })
        .from(sql`(select 1) as _dummy`);
      return { ...emp, compBalance: balance?.balance ?? 0 };
    }),
  );

  // Get shifts for this schedule
  let scheduleShifts: typeof shifts.$inferSelect[] = [];
  if (schedule) {
    scheduleShifts = await db
      .select()
      .from(shifts)
      .where(eq(shifts.scheduleId, schedule.id));
  }

  // Calculate holidays for the week
  const mondayDate = new Date(weekStart + "T12:00:00");
  const sundayDate = new Date(mondayDate);
  sundayDate.setDate(sundayDate.getDate() + 6);
  const holidays = getHolidaysInRange(mondayDate, sundayDate);

  // Daily limits
  const dailyLimits: Record<string, number> = {};
  for (let i = 0; i < 7; i++) {
    dailyLimits[String(i)] = getDailyLimitMins(i);
  }

  return NextResponse.json({
    schedule: schedule
      ? {
          id: schedule.id,
          weekStart: schedule.weekStart,
          groupId: schedule.groupId,
          groupName: group.name,
        }
      : null,
    employees: employeesWithBalance,
    shifts: scheduleShifts,
    holidays,
    dailyLimits,
  });
}
