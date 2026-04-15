import { NextResponse } from "next/server";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { payrollPeriods, dailyAttendance, employees } from "@/drizzle/schema";
import { auth } from "@/auth";

/**
 * POST /api/payroll/[periodId]/finalize
 * Locks the period — no more changes allowed after this.
 * Blocks if missing punches exist in the period.
 *
 * Body: { status: "finalized" }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ periodId: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { periodId: periodIdStr } = await params;
  const periodId = parseInt(periodIdStr, 10);
  if (isNaN(periodId)) {
    return NextResponse.json({ error: "Invalid periodId" }, { status: 400 });
  }

  const body = await request.json();
  const { status } = body;

  if (status !== "finalized") {
    return NextResponse.json(
      { error: "Status must be 'finalized'" },
      { status: 400 },
    );
  }

  // Get the period to find its date range
  const [period] = await db
    .select()
    .from(payrollPeriods)
    .where(eq(payrollPeriods.id, periodId))
    .limit(1);

  if (!period) {
    return NextResponse.json({ error: "Period not found" }, { status: 404 });
  }

  if (period.status === "finalized") {
    return NextResponse.json(
      { error: "Period is already finalized" },
      { status: 409 },
    );
  }

  // Check for missing punches in the period date range
  const missingPunches = await db
    .select({
      firstName: employees.firstName,
      lastName: employees.lastName,
      workDate: dailyAttendance.workDate,
      clockIn: dailyAttendance.clockIn,
    })
    .from(dailyAttendance)
    .innerJoin(employees, eq(dailyAttendance.employeeId, employees.id))
    .where(
      and(
        eq(dailyAttendance.isMissingPunch, true),
        gte(dailyAttendance.workDate, period.periodStart),
        lte(dailyAttendance.workDate, period.periodEnd),
      ),
    );

  if (missingPunches.length > 0) {
    return NextResponse.json(
      {
        error: "Cannot finalize — missing punches must be resolved first",
        missingPunches: missingPunches.map((mp) => ({
          employee: `${mp.firstName} ${mp.lastName}`,
          date: mp.workDate,
          detail: mp.clockIn ? "No clock-out" : "No clock-in",
        })),
      },
      { status: 422 },
    );
  }

  // Check for employees without salary
  const missingSalary = await db
    .select({
      firstName: employees.firstName,
      lastName: employees.lastName,
    })
    .from(payrollPeriods)
    .innerJoin(employees, eq(payrollPeriods.employeeId, employees.id))
    .where(
      and(
        eq(payrollPeriods.periodStart, period.periodStart),
        eq(payrollPeriods.periodEnd, period.periodEnd),
        sql`${employees.monthlySalary} IS NULL`,
      ),
    );

  // Finalize all employee records in this period range
  const updated = await db
    .update(payrollPeriods)
    .set({
      status: "finalized",
      finalizedAt: new Date(),
    })
    .where(
      and(
        eq(payrollPeriods.periodStart, period.periodStart),
        eq(payrollPeriods.periodEnd, period.periodEnd),
      ),
    )
    .returning({
      id: payrollPeriods.id,
      employeeId: payrollPeriods.employeeId,
      status: payrollPeriods.status,
      finalizedAt: payrollPeriods.finalizedAt,
    });

  return NextResponse.json({
    finalized: updated.length,
    records: updated,
    warnings:
      missingSalary.length > 0
        ? missingSalary.map(
            (e) =>
              `${e.firstName} ${e.lastName} has no salary set. Costs are zero.`,
          )
        : undefined,
  });
}
