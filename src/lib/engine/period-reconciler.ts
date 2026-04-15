/**
 * Layer 4: Period Reconciler
 *
 * Takes all daily_attendance records within a pay period and determines:
 *   - Total expected vs actual hours
 *   - Whether overtime exists (after 15-min floor)
 *   - Which excess hours to pay (cheapest-first from pool)
 *   - Comp time offset (if employee has negative balance)
 *   - Final payable amounts
 */

import { floorTo15Min } from "./time-utils";
import { getSurchargeConfig } from "./colombian-labor";

export interface DailyRecord {
  workDate: Date;
  status: string | null; // 'on-time' | 'late' | 'absent' | 'day-off' | 'comp-day-off'
  totalWorkedMins: number;
  minsOrdinaryDay: number;
  minsNocturno: number;
  minsFestivoDay: number;
  minsFestivoNight: number;
  excessHedMins: number;
  excessHenMins: number;
  lateMinutes: number;
  earlyLeaveMins: number;
  dailyLimitMins: number;
  dayType: string | null; // 'regular' | 'holiday'
}

export interface PeriodReconciliation {
  // Input summary
  totalExpectedMins: number;
  totalWorkedMins: number;
  totalOrdinaryMins: number;
  daysScheduled: number;
  daysWorked: number;
  daysAbsent: number;

  // Recargos (always paid, from daily records)
  rnMins: number;
  rfMins: number;
  rfnMins: number;
  rnCost: number;
  rfCost: number;
  rfnCost: number;

  // Overtime determination
  overtimeRawMins: number;
  overtimeOwedMins: number;

  // Excess pool
  poolHedMins: number;
  poolHenMins: number;

  // Consumed from pool (cheapest-first)
  otEarnedHedMins: number;
  otEarnedHenMins: number;

  // After comp offset
  owedOffsetMins: number;
  otAvailableAfterOffset: number;

  // After manager decision (initially 0; set via API)
  otBankedMins: number;
  hedMins: number;
  henMins: number;
  hedCost: number;
  henCost: number;

  // Comp balance
  compBalanceStart: number;
  compCreditedMins: number;
  compDebitedMins: number;
  compOwedMins: number;
  compOffsetMins: number;
  compBalanceEnd: number;

  // Totals
  totalRecargosCost: number;
  totalExtrasCost: number;
  totalSurcharges: number;

  // Metadata
  horaOrdinariaValue: number;
  totalLateMins: number;
  totalEarlyLeaveMins: number;
  holidaysWorked: number;
}

/**
 * Reconcile a pay period for a single employee.
 *
 * @param dailyRecords     All daily_attendance records in the period
 * @param monthlySalary    Employee monthly salary (COP)
 * @param periodStart      First date of the period
 * @param compBalanceStart Comp time balance at the start of this period
 * @param compDebitedMins  Total comp_day_off debits in this period (from shifts)
 */
export function reconcilePeriod(
  dailyRecords: DailyRecord[],
  monthlySalary: number,
  periodStart: Date,
  compBalanceStart: number,
  compDebitedMins: number = 0,
): PeriodReconciliation {
  const config = getSurchargeConfig(periodStart);
  const horaOrdinariaValue = monthlySalary / config.monthlyHoursDivisor;

  // Step 1: Calculate expected hours and counts
  let totalExpectedMins = 0;
  let daysScheduled = 0;
  let daysWorked = 0;
  let daysAbsent = 0;

  for (const rec of dailyRecords) {
    if (rec.status === "on-time" || rec.status === "late") {
      totalExpectedMins += rec.dailyLimitMins;
      daysScheduled++;
      daysWorked++;
    } else if (rec.status === "absent") {
      totalExpectedMins += rec.dailyLimitMins;
      daysScheduled++;
      daysAbsent++;
    }
    // day-off and comp-day-off contribute 0 expected
  }

  // Step 2: Sum actual hours and recargos
  let totalWorkedMins = 0;
  let totalOrdinaryMins = 0;
  let rnMins = 0;
  let rfMins = 0;
  let rfnMins = 0;
  let totalLateMins = 0;
  let totalEarlyLeaveMins = 0;
  let holidaysWorked = 0;
  let poolHedMins = 0;
  let poolHenMins = 0;

  for (const rec of dailyRecords) {
    totalWorkedMins += rec.totalWorkedMins;
    totalOrdinaryMins += rec.minsOrdinaryDay;
    rnMins += rec.minsNocturno;
    rfMins += rec.minsFestivoDay;
    rfnMins += rec.minsFestivoNight;
    totalLateMins += rec.lateMinutes;
    totalEarlyLeaveMins += rec.earlyLeaveMins;
    poolHedMins += rec.excessHedMins;
    poolHenMins += rec.excessHenMins;

    if (rec.dayType === "holiday" && rec.totalWorkedMins > 0) {
      holidaysWorked++;
    }
  }

  // Step 3: Calculate recargo costs
  const rnCost = (rnMins / 60) * horaOrdinariaValue * config.nocturnoRate;
  const rfCost = (rfMins / 60) * horaOrdinariaValue * config.festivoRate;
  const rfnCost =
    (rfnMins / 60) *
    horaOrdinariaValue *
    (config.festivoRate + config.nocturnoRate);
  const totalRecargosCost = rnCost + rfCost + rfnCost;

  // Step 4: Determine overtime
  const overtimeRawMins = totalWorkedMins - totalExpectedMins;
  const overtimeOwedMins =
    overtimeRawMins > 0 ? floorTo15Min(overtimeRawMins) : 0;

  // Step 5: Consume excess pool (cheapest-first: HED before HEN)
  let otEarnedHedMins = 0;
  let otEarnedHenMins = 0;

  if (overtimeOwedMins > 0) {
    otEarnedHedMins = Math.min(overtimeOwedMins, poolHedMins);
    const remaining = overtimeOwedMins - otEarnedHedMins;
    otEarnedHenMins = Math.min(remaining, poolHenMins);
  }

  // Step 6: Comp time offset
  let owedOffsetMins = 0;
  let otAvailableAfterOffset = overtimeOwedMins;

  if (compBalanceStart < 0) {
    owedOffsetMins = Math.min(overtimeOwedMins, Math.abs(compBalanceStart));
    otAvailableAfterOffset = overtimeOwedMins - owedOffsetMins;
  }

  // Step 7: Manager decision defaults (will be set later via API)
  const otBankedMins = 0;
  const otPaidMins = otAvailableAfterOffset - otBankedMins;

  // Split paid OT back into HED/HEN proportionally
  let hedMins = 0;
  let henMins = 0;

  const earnedTotal = otEarnedHedMins + otEarnedHenMins;
  if (otPaidMins > 0 && earnedTotal > 0) {
    const hedRatio = otEarnedHedMins / earnedTotal;
    hedMins = Math.round(otPaidMins * hedRatio);
    henMins = otPaidMins - hedMins;
  }

  // Step 8: Calculate paid OT costs
  const hedCost =
    (hedMins / 60) * horaOrdinariaValue * config.extraDiurnaRate;
  const henCost =
    (henMins / 60) * horaOrdinariaValue * config.extraNocturnaRate;
  const totalExtrasCost = hedCost + henCost;

  // Step 9: Comp balance tracking
  const compCreditedMins = otBankedMins;
  const compOwedMins = 0; // any time_owed in this period (future feature)
  const compOffsetMins = owedOffsetMins;
  const compBalanceEnd =
    compBalanceStart +
    compOffsetMins +
    compCreditedMins -
    compDebitedMins -
    compOwedMins;

  return {
    totalExpectedMins,
    totalWorkedMins,
    totalOrdinaryMins,
    daysScheduled,
    daysWorked,
    daysAbsent,
    rnMins,
    rfMins,
    rfnMins,
    rnCost: Math.round(rnCost),
    rfCost: Math.round(rfCost),
    rfnCost: Math.round(rfnCost),
    overtimeRawMins,
    overtimeOwedMins,
    poolHedMins,
    poolHenMins,
    otEarnedHedMins,
    otEarnedHenMins,
    owedOffsetMins,
    otAvailableAfterOffset,
    otBankedMins,
    hedMins,
    henMins,
    hedCost: Math.round(hedCost),
    henCost: Math.round(henCost),
    compBalanceStart,
    compCreditedMins,
    compDebitedMins,
    compOwedMins,
    compOffsetMins,
    compBalanceEnd,
    totalRecargosCost: Math.round(totalRecargosCost),
    totalExtrasCost: Math.round(totalExtrasCost),
    totalSurcharges: Math.round(totalRecargosCost + totalExtrasCost),
    horaOrdinariaValue: Math.round(horaOrdinariaValue * 100) / 100,
    totalLateMins,
    totalEarlyLeaveMins,
    holidaysWorked,
  };
}

/**
 * Apply the manager's comp decision to a reconciliation result.
 * Returns updated reconciliation with final hedMins/henMins/costs.
 */
export function applyCompDecision(
  recon: PeriodReconciliation,
  bankMins: number,
): PeriodReconciliation {
  const otPaidMins = recon.otAvailableAfterOffset - bankMins;
  const earnedTotal = recon.otEarnedHedMins + recon.otEarnedHenMins;

  let hedMins = 0;
  let henMins = 0;
  if (otPaidMins > 0 && earnedTotal > 0) {
    const hedRatio = recon.otEarnedHedMins / earnedTotal;
    hedMins = Math.round(otPaidMins * hedRatio);
    henMins = otPaidMins - hedMins;
  }

  const config = getSurchargeConfig(new Date());
  const hedCost =
    (hedMins / 60) * recon.horaOrdinariaValue * config.extraDiurnaRate;
  const henCost =
    (henMins / 60) * recon.horaOrdinariaValue * config.extraNocturnaRate;
  const totalExtrasCost = hedCost + henCost;

  const compCreditedMins = bankMins;
  const compBalanceEnd =
    recon.compBalanceStart +
    recon.compOffsetMins +
    compCreditedMins -
    recon.compDebitedMins -
    recon.compOwedMins;

  return {
    ...recon,
    otBankedMins: bankMins,
    hedMins,
    henMins,
    hedCost: Math.round(hedCost),
    henCost: Math.round(henCost),
    totalExtrasCost: Math.round(totalExtrasCost),
    totalSurcharges: Math.round(recon.totalRecargosCost + totalExtrasCost),
    compCreditedMins,
    compBalanceEnd,
  };
}
