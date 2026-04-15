import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { payrollPeriods, compTransactions } from "@/drizzle/schema";
import { auth } from "@/auth";
import { applyCompDecision } from "@/lib/engine/period-reconciler";
import type { PeriodReconciliation } from "@/lib/engine/period-reconciler";
import { colombiaStartOfDay } from "@/lib/timezone";

/**
 * PUT /api/payroll/[periodId]/comp-decision
 * Manager sets how many OT minutes to bank per employee.
 *
 * Body: { decisions: [{ employeeId: number, bankMins: number }] }
 */
export async function PUT(
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
  const { decisions } = body;

  if (!Array.isArray(decisions) || decisions.length === 0) {
    return NextResponse.json(
      { error: "decisions array is required" },
      { status: 400 },
    );
  }

  const results = [];

  for (const decision of decisions) {
    const { employeeId, bankMins } = decision;

    if (!employeeId || bankMins == null || bankMins < 0) {
      results.push({ employeeId, error: "Invalid decision" });
      continue;
    }

    // Find the payroll period record for this employee
    const [period] = await db
      .select()
      .from(payrollPeriods)
      .where(
        and(
          eq(payrollPeriods.id, periodId),
          eq(payrollPeriods.employeeId, employeeId),
        ),
      )
      .limit(1);

    if (!period) {
      // Try finding by periodId alone (the periodId IS the record id, one per employee)
      const [periodByIdOnly] = await db
        .select()
        .from(payrollPeriods)
        .where(eq(payrollPeriods.id, periodId))
        .limit(1);

      if (!periodByIdOnly) {
        results.push({ employeeId, error: "Period not found" });
        continue;
      }

      // Find this employee's record in the same period range
      const [empPeriod] = await db
        .select()
        .from(payrollPeriods)
        .where(
          and(
            eq(payrollPeriods.periodStart, periodByIdOnly.periodStart),
            eq(payrollPeriods.periodEnd, periodByIdOnly.periodEnd),
            eq(payrollPeriods.employeeId, employeeId),
          ),
        )
        .limit(1);

      if (!empPeriod) {
        results.push({ employeeId, error: "Employee period not found" });
        continue;
      }

      // Use empPeriod
      const updated = await applyAndSave(empPeriod, bankMins, session.user.name ?? "admin");
      results.push(updated);
      continue;
    }

    if (period.status === "finalized") {
      results.push({ employeeId, error: "Period is already finalized" });
      continue;
    }

    const updated = await applyAndSave(period, bankMins, session.user.name ?? "admin");
    results.push(updated);
  }

  return NextResponse.json({ results });
}

async function applyAndSave(
  period: typeof payrollPeriods.$inferSelect,
  bankMins: number,
  createdBy: string,
) {
  // Validate bankMins doesn't exceed available OT
  const otAvailable =
    period.overtimeOwedMins - period.owedOffsetMins;
  const clampedBankMins = Math.min(bankMins, otAvailable);

  // Build a PeriodReconciliation from the DB record to feed into applyCompDecision
  const recon: PeriodReconciliation = {
    totalExpectedMins: period.totalExpectedMins,
    totalWorkedMins: period.totalWorkedMins,
    totalOrdinaryMins: period.totalOrdinaryMins,
    daysScheduled: period.daysScheduled,
    daysWorked: period.daysWorked,
    daysAbsent: period.daysAbsent,
    rnMins: period.rnMins,
    rfMins: period.rfMins,
    rfnMins: period.rfnMins,
    rnCost: Number(period.rnCost),
    rfCost: Number(period.rfCost),
    rfnCost: Number(period.rfnCost),
    overtimeRawMins: period.overtimeRawMins,
    overtimeOwedMins: period.overtimeOwedMins,
    poolHedMins: period.poolHedMins,
    poolHenMins: period.poolHenMins,
    otEarnedHedMins: period.otEarnedHedMins,
    otEarnedHenMins: period.otEarnedHenMins,
    owedOffsetMins: period.owedOffsetMins,
    otAvailableAfterOffset: period.overtimeOwedMins - period.owedOffsetMins,
    otBankedMins: period.otBankedMins,
    hedMins: period.hedMins,
    henMins: period.henMins,
    hedCost: Number(period.hedCost),
    henCost: Number(period.henCost),
    compBalanceStart: period.compBalanceStart,
    compCreditedMins: period.compCreditedMins,
    compDebitedMins: period.compDebitedMins,
    compOwedMins: period.compOwedMins,
    compOffsetMins: period.compOffsetMins,
    compBalanceEnd: period.compBalanceEnd,
    totalRecargosCost: Number(period.totalRecargosCost),
    totalExtrasCost: Number(period.totalExtrasCost),
    totalSurcharges: Number(period.totalSurcharges),
    horaOrdinariaValue: Number(period.horaOrdinariaValue),
    totalLateMins: period.totalLateMins,
    totalEarlyLeaveMins: period.totalEarlyLeaveMins,
    holidaysWorked: period.holidaysWorked,
  };

  const updated = applyCompDecision(recon, clampedBankMins, colombiaStartOfDay(period.periodStart));

  // Update the payroll period record
  await db
    .update(payrollPeriods)
    .set({
      otBankedMins: updated.otBankedMins,
      hedMins: updated.hedMins,
      hedCost: String(updated.hedCost),
      henMins: updated.henMins,
      henCost: String(updated.henCost),
      totalExtrasCost: String(updated.totalExtrasCost),
      totalSurcharges: String(updated.totalSurcharges),
      compCreditedMins: updated.compCreditedMins,
      compBalanceEnd: updated.compBalanceEnd,
    })
    .where(eq(payrollPeriods.id, period.id));

  // Record comp transaction if banking mins
  if (clampedBankMins > 0) {
    await db.insert(compTransactions).values({
      employeeId: period.employeeId,
      transactionDate: period.periodEnd,
      type: "ot_banked",
      minutes: clampedBankMins,
      balanceAfter: updated.compBalanceEnd,
      sourcePeriodId: period.id,
      note: `Banked ${clampedBankMins} mins OT as comp time`,
      createdBy,
    });
  }

  return {
    employeeId: period.employeeId,
    bankMins: clampedBankMins,
    hedMins: updated.hedMins,
    henMins: updated.henMins,
    hedCost: updated.hedCost,
    henCost: updated.henCost,
    totalExtrasCost: updated.totalExtrasCost,
    totalSurcharges: updated.totalSurcharges,
    compBalanceEnd: updated.compBalanceEnd,
  };
}
