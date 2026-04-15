import { NextResponse } from "next/server";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  employees,
  dailyAttendance,
  payrollPeriods,
  compTransactions,
} from "@/drizzle/schema";
import { auth } from "@/auth";
import { reconcilePeriod, type DailyRecord } from "@/lib/engine/period-reconciler";
import { colombiaStartOfDay } from "@/lib/timezone";

/**
 * GET /api/payroll
 * List all payroll periods with aggregated stats.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db
    .select({
      periodStart: payrollPeriods.periodStart,
      periodEnd: payrollPeriods.periodEnd,
      status: payrollPeriods.status,
      employeeCount: sql<number>`count(*)::int`,
      totalSurcharges: sql<number>`coalesce(sum(${payrollPeriods.totalSurcharges}::numeric), 0)::float`,
      firstId: sql<number>`min(${payrollPeriods.id})::int`,
    })
    .from(payrollPeriods)
    .groupBy(payrollPeriods.periodStart, payrollPeriods.periodEnd, payrollPeriods.status)
    .orderBy(desc(payrollPeriods.periodStart));

  return NextResponse.json(rows);
}

/**
 * POST /api/payroll/reconcile
 * Run period reconciliation for all active employees.
 *
 * Body: { periodStart: string, periodEnd: string, status?: string }
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { periodStart, periodEnd, status = "draft" } = body;

  if (!periodStart || !periodEnd) {
    return NextResponse.json(
      { error: "periodStart and periodEnd are required" },
      { status: 400 },
    );
  }

  // Check for overlapping periods (skip test periods)
  if (status !== "test") {
    const overlapping = await db
      .select({
        periodStart: payrollPeriods.periodStart,
        periodEnd: payrollPeriods.periodEnd,
      })
      .from(payrollPeriods)
      .where(
        and(
          lte(payrollPeriods.periodStart, periodEnd),
          gte(payrollPeriods.periodEnd, periodStart),
          sql`${payrollPeriods.status} != 'test'`,
        ),
      )
      .limit(1);

    if (overlapping.length > 0) {
      return NextResponse.json(
        {
          error: `Period overlaps with existing period ${overlapping[0].periodStart} – ${overlapping[0].periodEnd}`,
        },
        { status: 409 },
      );
    }
  }

  // Get all active employees
  const allEmployees = await db
    .select()
    .from(employees)
    .where(eq(employees.isActive, true));

  const results = [];

  for (const emp of allEmployees) {
    if (!emp.monthlySalary) continue;

    // Get daily attendance records for this employee in the period
    const records = await db
      .select()
      .from(dailyAttendance)
      .where(
        and(
          eq(dailyAttendance.employeeId, emp.id),
          gte(dailyAttendance.workDate, periodStart),
          lte(dailyAttendance.workDate, periodEnd),
        ),
      );

    // Get comp balance start (from last transaction before this period)
    const [lastTx] = await db
      .select({ balanceAfter: compTransactions.balanceAfter })
      .from(compTransactions)
      .where(
        and(
          eq(compTransactions.employeeId, emp.id),
          lte(compTransactions.transactionDate, periodStart),
        ),
      )
      .orderBy(desc(compTransactions.createdAt))
      .limit(1);

    const compBalanceStart = lastTx?.balanceAfter ?? 0;

    // Map DB records to engine's DailyRecord type
    const dailyRecords: DailyRecord[] = records.map((r) => ({
      workDate: colombiaStartOfDay(r.workDate),
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
      colombiaStartOfDay(periodStart),
      compBalanceStart,
    );

    // Upsert payroll period record
    await db
      .insert(payrollPeriods)
      .values({
        periodStart,
        periodEnd,
        employeeId: emp.id,
        status,
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
        createdBy: session.user.name ?? "admin",
      })
      .onConflictDoUpdate({
        target: [
          payrollPeriods.periodStart,
          payrollPeriods.periodEnd,
          payrollPeriods.employeeId,
        ],
        set: {
          status,
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
        },
      });

    results.push({
      employeeId: emp.id,
      name: `${emp.firstName} ${emp.lastName}`,
      totalExpectedMins: recon.totalExpectedMins,
      totalWorkedMins: recon.totalWorkedMins,
      overtimeOwedMins: recon.overtimeOwedMins,
      rnMins: recon.rnMins,
      rfMins: recon.rfMins,
      rfnMins: recon.rfnMins,
      compBalanceStart,
      otAvailableAfterOffset: recon.otAvailableAfterOffset,
      totalRecargosCost: recon.totalRecargosCost,
      status: recon.otAvailableAfterOffset > 0 ? "needs_comp_decision" : "complete",
    });
  }

  return NextResponse.json({ employees: results });
}
