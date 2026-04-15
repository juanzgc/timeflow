import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { payrollPeriods, employees, groups, compTransactions } from "@/drizzle/schema";
import { auth } from "@/auth";

export async function GET(
  _request: Request,
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

  // Get the reference period to find its date range
  const [refPeriod] = await db
    .select()
    .from(payrollPeriods)
    .where(eq(payrollPeriods.id, periodId))
    .limit(1);

  if (!refPeriod) {
    return NextResponse.json({ error: "Period not found" }, { status: 404 });
  }

  // Get all employee records for this period range
  const records = await db
    .select({
      period: payrollPeriods,
      firstName: employees.firstName,
      lastName: employees.lastName,
      empCode: employees.empCode,
      groupName: groups.name,
    })
    .from(payrollPeriods)
    .innerJoin(employees, eq(payrollPeriods.employeeId, employees.id))
    .leftJoin(groups, eq(employees.groupId, groups.id))
    .where(
      and(
        eq(payrollPeriods.periodStart, refPeriod.periodStart),
        eq(payrollPeriods.periodEnd, refPeriod.periodEnd),
      ),
    )
    .orderBy(employees.firstName);

  return NextResponse.json({
    periodStart: refPeriod.periodStart,
    periodEnd: refPeriod.periodEnd,
    status: refPeriod.status,
    records: records.map((r) => ({
      ...r.period,
      firstName: r.firstName,
      lastName: r.lastName,
      empCode: r.empCode,
      groupName: r.groupName,
    })),
  });
}

export async function DELETE(
  _request: Request,
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

  const [period] = await db
    .select()
    .from(payrollPeriods)
    .where(eq(payrollPeriods.id, periodId))
    .limit(1);

  if (!period) {
    return NextResponse.json({ error: "Period not found" }, { status: 404 });
  }

  if (period.status === "finalized" || period.status === "exported") {
    return NextResponse.json(
      { error: "Cannot delete finalized or exported periods" },
      { status: 409 },
    );
  }

  // Delete comp transactions for this period range
  const periodIds = await db
    .select({ id: payrollPeriods.id })
    .from(payrollPeriods)
    .where(
      and(
        eq(payrollPeriods.periodStart, period.periodStart),
        eq(payrollPeriods.periodEnd, period.periodEnd),
      ),
    );

  for (const p of periodIds) {
    await db
      .delete(compTransactions)
      .where(eq(compTransactions.sourcePeriodId, p.id));
  }

  // Delete all payroll period records for this range
  await db
    .delete(payrollPeriods)
    .where(
      and(
        eq(payrollPeriods.periodStart, period.periodStart),
        eq(payrollPeriods.periodEnd, period.periodEnd),
      ),
    );

  return NextResponse.json({ deleted: true });
}
