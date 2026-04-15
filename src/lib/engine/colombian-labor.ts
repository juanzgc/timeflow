/**
 * Colombian labor law configuration.
 * Date-aware surcharge rates, daily limits, and holiday checking.
 */

import { isHoliday as checkHoliday } from "@/lib/holidays";
import { getDayOfWeek, formatDateISO } from "./time-utils";

export interface SurchargeConfig {
  nocturnoRate: number; // always 0.35
  festivoRate: number; // 0.80, 0.90, or 1.00
  extraDiurnaRate: number; // always 1.25 (total multiplier)
  extraNocturnaRate: number; // always 1.75 (total multiplier)
  monthlyHoursDivisor: number; // 220 or 210
}

/** Get surcharge configuration for a given date */
export function getSurchargeConfig(date: Date): SurchargeConfig {
  const nocturnoRate = 0.35;
  const extraDiurnaRate = 1.25;
  const extraNocturnaRate = 1.75;

  // Festivo rate (Ley 2466 de 2025, gradual increase)
  let festivoRate: number;
  if (date < new Date("2026-07-01")) {
    festivoRate = 0.80;
  } else if (date < new Date("2027-07-01")) {
    festivoRate = 0.90;
  } else {
    festivoRate = 1.00;
  }

  // Monthly hours divisor (Ley 2101 de 2021, jornada reduction)
  let monthlyHoursDivisor: number;
  if (date < new Date("2026-07-15")) {
    monthlyHoursDivisor = 220; // 44h/week
  } else {
    monthlyHoursDivisor = 210; // 42h/week
  }

  return {
    nocturnoRate,
    festivoRate,
    extraDiurnaRate,
    extraNocturnaRate,
    monthlyHoursDivisor,
  };
}

/**
 * Get the daily ordinary-hour limit in minutes for a given day+date.
 * Before July 15 2026: Fri(4)/Sat(5) = 480min (8h), others = 420min (7h).
 * From July 15 2026: all days = 420min (7h).
 */
export function getDailyLimitMins(dayOfWeek: number, date: Date): number {
  if (date >= new Date("2026-07-15")) {
    return 420; // 7h for all days after jornada reduction
  }
  // Before July 15, 2026
  if (dayOfWeek === 4 || dayOfWeek === 5) {
    return 480; // Fri/Sat = 8h
  }
  return 420; // others = 7h
}

/** Get daily limit using a Date (extracts day of week automatically) */
export function getDailyLimitForDate(date: Date): number {
  return getDailyLimitMins(getDayOfWeek(date), date);
}

/** Check if a Date is a Colombian holiday */
export function isHolidayDate(date: Date): boolean {
  return checkHoliday(formatDateISO(date));
}

/** Calculate hora ordinaria value (cost per hour of base pay) */
export function getHoraOrdinaria(
  monthlySalary: number,
  date: Date,
): number {
  const config = getSurchargeConfig(date);
  return monthlySalary / config.monthlyHoursDivisor;
}
