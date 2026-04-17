import { NextResponse } from "next/server";
import { and, eq, gte, lte, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  employees,
  groups,
  dailyAttendance,
  payrollPeriods,
  compTransactions,
} from "@/drizzle/schema";
import { auth } from "@/auth";
import { calculateAttendance } from "@/lib/engine/attendance-calculator";
import { invalidateEmployees } from "@/lib/attendance/invalidate";
import { getSurchargeConfig } from "@/lib/engine/colombian-labor";
import { todayColombiaISO } from "@/lib/timezone";

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

// GET /api/employees/[id] — single employee with group name + stat cards
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const employeeId = Number(id);

  const [row] = await db
    .select({
      id: employees.id,
      empCode: employees.empCode,
      cedula: employees.cedula,
      firstName: employees.firstName,
      lastName: employees.lastName,
      groupId: employees.groupId,
      groupName: groups.name,
      monthlySalary: employees.monthlySalary,
      restDay: employees.restDay,
      isActive: employees.isActive,
      biotimeId: employees.biotimeId,
    })
    .from(employees)
    .leftJoin(groups, eq(employees.groupId, groups.id))
    .where(eq(employees.id, employeeId))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  }

  // Calculate hora ordinaria
  const today = todayColombiaISO();
  const surchargeConfig = getSurchargeConfig(new Date(today + "T12:00:00"));
  const salary = row.monthlySalary ? Number(row.monthlySalary) : 0;
  const divisor = surchargeConfig.monthlyHoursDivisor;
  const horaOrdinaria = salary > 0 ? Math.round(salary / divisor) : 0;

  try {
    await calculateAttendance({ employeeId, startDate: today, endDate: today });
  } catch {
    // Continue with existing data
  }

  // Get today's attendance
  const [todayRecord] = await db
    .select()
    .from(dailyAttendance)
    .where(
      and(
        eq(dailyAttendance.employeeId, employeeId),
        eq(dailyAttendance.workDate, today),
      ),
    )
    .limit(1);

  // Get current draft period
  const [draftPeriod] = await db
    .select()
    .from(payrollPeriods)
    .where(
      and(
        eq(payrollPeriods.employeeId, employeeId),
        eq(payrollPeriods.status, "draft"),
      ),
    )
    .orderBy(desc(payrollPeriods.createdAt))
    .limit(1);

  // Get comp balance (latest transaction)
  const [latestComp] = await db
    .select()
    .from(compTransactions)
    .where(eq(compTransactions.employeeId, employeeId))
    .orderBy(desc(compTransactions.createdAt))
    .limit(1);

  const compBalance = latestComp?.balanceAfter ?? 0;

  // Calculate punctuality from current period or recent attendance
  let punctuality = { percent: 0, daysOnTime: 0, daysWorked: 0 };
  if (draftPeriod) {
    const periodRecords = await db
      .select()
      .from(dailyAttendance)
      .where(
        and(
          eq(dailyAttendance.employeeId, employeeId),
          gte(dailyAttendance.workDate, draftPeriod.periodStart),
          lte(dailyAttendance.workDate, draftPeriod.periodEnd),
        ),
      );

    const worked = periodRecords.filter(
      (r) => r.status === "on-time" || r.status === "late",
    );
    const onTime = worked.filter((r) => r.status === "on-time");
    punctuality = {
      percent: worked.length > 0 ? Math.round((onTime.length / worked.length) * 100) : 0,
      daysOnTime: onTime.length,
      daysWorked: worked.length,
    };
  }

  // Build today stat
  let todayStat: Record<string, unknown> = { status: "not-scheduled" };
  if (todayRecord) {
    todayStat = {
      status: todayRecord.status ?? (todayRecord.isMissingPunch ? "missing_punch" : "not-scheduled"),
      totalWorkedMins: todayRecord.totalWorkedMins,
      clockIn: todayRecord.clockIn,
      clockOut: todayRecord.clockOut,
      lateMinutes: todayRecord.lateMinutes,
      isMissingPunch: todayRecord.isMissingPunch,
    };
  }

  // Build period stat
  let periodStat: Record<string, unknown> | null = null;
  if (draftPeriod) {
    periodStat = {
      periodId: draftPeriod.id,
      periodStart: draftPeriod.periodStart,
      periodEnd: draftPeriod.periodEnd,
      totalExpectedMins: draftPeriod.totalExpectedMins,
      totalWorkedMins: draftPeriod.totalWorkedMins,
      overtimeMins: Math.max(0, draftPeriod.totalWorkedMins - draftPeriod.totalExpectedMins),
      status: draftPeriod.status,
    };
  }

  return NextResponse.json({
    employee: {
      ...row,
      restDayName: DAY_NAMES[row.restDay],
      horaOrdinaria,
      divisor,
    },
    stats: {
      today: todayStat,
      period: periodStat,
      compBalance,
      punctuality,
    },
  });
}

// PUT /api/employees/[id] — update employee fields
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();

  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (body.groupId !== undefined) {
    updates.groupId = body.groupId === null ? null : Number(body.groupId);
  }
  if (body.monthlySalary !== undefined) {
    updates.monthlySalary = body.monthlySalary;
  }
  if (body.restDay !== undefined) {
    updates.restDay = Number(body.restDay);
  }
  if (body.cedula !== undefined) {
    updates.cedula = body.cedula;
  }
  if (body.isActive !== undefined) {
    updates.isActive = body.isActive;
  }

  const [row] = await db
    .update(employees)
    .set(updates)
    .where(eq(employees.id, Number(id)))
    .returning();

  if (!row) {
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  }

  invalidateEmployees();
  return NextResponse.json(row);
}
