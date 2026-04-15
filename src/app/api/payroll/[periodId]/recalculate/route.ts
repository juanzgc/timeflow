import { NextResponse } from "next/server";
import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  employees,
  dailyAttendance,
  payrollPeriods,
  compTransactions,
} from "@/drizzle/schema";
import { auth } from "@/auth";
import { reconcilePeriod, type DailyRecord } from "@/lib/engine/period-reconciler";

export async function POST(
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

  const [refPeriod] = await db
    .select()
    .from(payrollPeriods)
    .where(eq(payrollPeriods.id, periodId))
    .limit(1);

  if (!refPeriod) {
    return NextResponse.json({ error: "Period not found" }, { status: 404 });
  }

  if (refPeriod.status === "finalized") {
    return NextResponse.json(
      { error: "Cannot recalculate finalized period" },
      { status: 409 },
    );
  }

  // Get all records for this period range
  const allPeriodRecords = await db
    .select()
    .from(payrollPeriods)
    .where(
      and(
        eq(payrollPeriods.periodStart, refPeriod.periodStart),
        eq(payrollPeriods.periodEnd, refPeriod.periodEnd),
      ),
    );

  let updatedCount = 0;

  for (const pp of allPeriodRecords) {
    // Get the employee
    const [emp] = await db
      .select()
      .from(employees)
      .where(eq(employees.id, pp.employeeId))
      .limit(1);

    if (!emp || !emp.monthlySalary) continue;

    // Get daily attendance records
    const records = await db
      .select()
      .from(dailyAttendance)
      .where(
        and(
          eq(dailyAttendance.employeeId, emp.id),
          gte(dailyAttendance.workDate, refPeriod.periodStart),
          lte(dailyAttendance.workDate, refPeriod.periodEnd),
        ),
      );

    // Get comp balance start
    const [lastTx] = await db
      .select({ balanceAfter: compTransactions.balanceAfter })
      .from(compTransactions)
      .where(
        and(
          eq(compTransactions.employeeId, emp.id),
          lte(compTransactions.transactionDate, refPeriod.periodStart),
        ),
      )
      .orderBy(compTransactions.createdAt)
      .limit(1);

    const compBalanceStart = lastTx?.balanceAfter ?? 0;

    const dailyRecords: DailyRecord[] = records.map((r) => ({
      workDate: new Date(r.workDate + "T00:00:00"),
      status: r.status,
      totalWorkedMins: r.totalWorkedMins,
      minsOrdinaryDay: r.minsOrdinaryDay,
      minsNocturno: r.minsNocturno,
      minsFestivoDay: r.minsFestivoDay,
      minsFestivoNight: r.minsFestivoNight,
      excessHedMins: r.excessHedMins,
      excessHenMins: r.excessHenMins,
      lateMinutes: r.lateMinutes,
      earlyLeaveMins: r.earlyLeaveMins,
      dailyLimitMins: r.dailyLimitMins,
      dayType: r.dayType,
    }));

    const recon = reconcilePeriod(
      dailyRecords,
      Number(emp.monthlySalary),
      new Date(refPeriod.periodStart + "T00:00:00"),
      compBalanceStart,
    );

    await db
      .update(payrollPeriods)
      .set({
        totalExpectedMins: recon.totalExpectedMins,
        totalWorkedMins: recon.totalWorkedMins,
        totalOrdinaryMins: recon.totalOrdinaryMins,
        totalLateMins: recon.totalLateMins,
        totalEarlyLeaveMins: recon.totalEarlyLeaveMins,
        daysScheduled: recon.daysScheduled,
        daysWorked: recon.daysWorked,
        daysAbsent: recon.daysAbsent,
        rnMins: recon.rnMins,
        rnCost: String(recon.rnCost),
        rfMins: recon.rfMins,
        rfCost: String(recon.rfCost),
        rfnMins: recon.rfnMins,
        rfnCost: String(recon.rfnCost),
        poolHedMins: recon.poolHedMins,
        poolHenMins: recon.poolHenMins,
        overtimeRawMins: recon.overtimeRawMins,
        overtimeOwedMins: recon.overtimeOwedMins,
        otEarnedHedMins: recon.otEarnedHedMins,
        otEarnedHenMins: recon.otEarnedHenMins,
        owedOffsetMins: recon.owedOffsetMins,
        otBankedMins: recon.otBankedMins,
        hedMins: recon.hedMins,
        hedCost: String(recon.hedCost),
        henMins: recon.henMins,
        henCost: String(recon.henCost),
        totalRecargosCost: String(recon.totalRecargosCost),
        totalExtrasCost: String(recon.totalExtrasCost),
        totalSurcharges: String(recon.totalSurcharges),
        compBalanceStart: recon.compBalanceStart,
        compCreditedMins: recon.compCreditedMins,
        compDebitedMins: recon.compDebitedMins,
        compOwedMins: recon.compOwedMins,
        compOffsetMins: recon.compOffsetMins,
        compBalanceEnd: recon.compBalanceEnd,
        holidaysWorked: recon.holidaysWorked,
        horaOrdinariaValue: String(recon.horaOrdinariaValue),
        monthlySalary: emp.monthlySalary,
      })
      .where(eq(payrollPeriods.id, pp.id));

    updatedCount++;
  }

  return NextResponse.json({ recalculated: updatedCount });
}
