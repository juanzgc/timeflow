import { NextResponse } from "next/server";
import { and, eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { employees, payrollPeriods } from "@/drizzle/schema";
import { auth } from "@/auth";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Find the most recent draft period
  const [latestPeriod] = await db
    .select({
      periodStart: payrollPeriods.periodStart,
      periodEnd: payrollPeriods.periodEnd,
    })
    .from(payrollPeriods)
    .where(eq(payrollPeriods.status, "draft"))
    .orderBy(desc(payrollPeriods.periodStart))
    .limit(1);

  if (!latestPeriod) {
    return NextResponse.json({ period: null, employees: [] });
  }

  const rows = await db
    .select({
      id: employees.id,
      firstName: employees.firstName,
      lastName: employees.lastName,
      totalExpectedMins: payrollPeriods.totalExpectedMins,
      totalWorkedMins: payrollPeriods.totalWorkedMins,
    })
    .from(employees)
    .innerJoin(
      payrollPeriods,
      and(
        eq(payrollPeriods.employeeId, employees.id),
        eq(payrollPeriods.periodStart, latestPeriod.periodStart),
        eq(payrollPeriods.periodEnd, latestPeriod.periodEnd),
        eq(payrollPeriods.status, "draft"),
      ),
    )
    .where(eq(employees.isActive, true));

  return NextResponse.json({
    period: {
      periodStart: latestPeriod.periodStart,
      periodEnd: latestPeriod.periodEnd,
    },
    employees: rows,
  });
}
