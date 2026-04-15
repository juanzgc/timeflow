import { NextResponse } from "next/server";
import { and, eq, desc, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { employees, dailyAttendance, payrollPeriods } from "@/drizzle/schema";
import { auth } from "@/auth";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  // Missing punches for today
  const missingPunches = await db
    .select({
      employeeId: employees.id,
      firstName: employees.firstName,
      lastName: employees.lastName,
      clockIn: dailyAttendance.clockIn,
      clockOut: dailyAttendance.clockOut,
    })
    .from(dailyAttendance)
    .innerJoin(employees, eq(dailyAttendance.employeeId, employees.id))
    .where(
      and(
        eq(dailyAttendance.workDate, todayStr),
        eq(dailyAttendance.isMissingPunch, true),
      ),
    );

  // Check for overdue periods (end date passed, still draft)
  const overduePeriods = await db
    .selectDistinctOn([payrollPeriods.periodStart, payrollPeriods.periodEnd], {
      periodStart: payrollPeriods.periodStart,
      periodEnd: payrollPeriods.periodEnd,
    })
    .from(payrollPeriods)
    .where(
      and(
        eq(payrollPeriods.status, "draft"),
        lt(payrollPeriods.periodEnd, todayStr),
      ),
    )
    .orderBy(payrollPeriods.periodStart, payrollPeriods.periodEnd);

  // Check if any draft period exists
  const [activePeriod] = await db
    .select({
      periodStart: payrollPeriods.periodStart,
      periodEnd: payrollPeriods.periodEnd,
    })
    .from(payrollPeriods)
    .where(eq(payrollPeriods.status, "draft"))
    .orderBy(desc(payrollPeriods.periodStart))
    .limit(1);

  return NextResponse.json({
    missingPunches: missingPunches.map((mp) => ({
      employeeId: mp.employeeId,
      name: `${mp.firstName} ${mp.lastName}`,
      detail: !mp.clockIn ? "no clock-in" : !mp.clockOut ? "no clock-out" : "missing punch",
    })),
    overduePeriods,
    hasActivePeriod: !!activePeriod,
    activePeriod,
  });
}
