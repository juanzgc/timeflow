/**
 * Formatting utilities for TimeFlow.
 * Used across all dashboard/reporting pages.
 */

import { COL_TZ, todayColombiaISO, colDay, colAddDays, formatColombiaDateISO } from "@/lib/timezone";

/** Convert minutes to "Xh Ym" display string. */
export function formatMins(mins: number): string {
  if (mins === 0) return "0m";
  const h = Math.floor(Math.abs(mins) / 60);
  const m = Math.abs(mins) % 60;
  const sign = mins < 0 ? "-" : "";
  if (h === 0) return `${sign}${m}m`;
  if (m === 0) return `${sign}${h}h`;
  return `${sign}${h}h ${m}m`;
}

/** Convert minutes to compact hours string like "+14h" or "-3h". */
export function formatMinsAsHours(mins: number): string {
  const h = Math.round(mins / 60);
  if (h === 0) return "0h";
  return `${h > 0 ? "+" : ""}${h}h`;
}

/** Format COP currency. */
export function formatCOP(amount: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(amount);
}

/** Format a Date or ISO string as "Monday, April 14, 2026". */
export function formatDateFull(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d + "T12:00:00") : d;
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: COL_TZ,
  });
}

/** Format as "Apr 14, 2026". */
export function formatDateMedium(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d + "T12:00:00") : d;
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: COL_TZ,
  });
}

/** Format as "Apr 14". */
export function formatDateShort(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d + "T12:00:00") : d;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: COL_TZ });
}

/** Format period range as "Mar 28 – Apr 12, 2026". */
export function formatPeriodRange(start: string, end: string): string {
  return `${formatDateShort(start)} – ${formatDateMedium(end)}`;
}

/** Format a timestamp as "8:00 AM" or "5:12 PM". */
export function formatTime(ts: Date | string | null): string {
  if (!ts) return "—";
  const date = typeof ts === "string" ? new Date(ts) : ts;
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: COL_TZ,
  });
}

/** Get day name from ISO date string. */
export function getDayName(d: string): string {
  const date = new Date(d + "T12:00:00");
  return date.toLocaleDateString("en-US", { weekday: "short", timeZone: COL_TZ });
}

/** Get YYYY-MM-DD string for today in Colombia timezone. */
export function todayISO(): string {
  return todayColombiaISO();
}

/** Get Monday of the current week as YYYY-MM-DD. */
export function currentWeekMonday(): string {
  const d = new Date();
  const day = colDay(d); // 0=Sun
  const diff = day === 0 ? 6 : day - 1;
  const monday = colAddDays(d, -diff);
  return formatColombiaDateISO(monday);
}

/** Get Sunday of the current week as YYYY-MM-DD. */
export function currentWeekSunday(): string {
  const d = new Date();
  const day = colDay(d); // 0=Sun
  const diff = day === 0 ? 0 : 7 - day;
  const sunday = colAddDays(d, diff);
  return formatColombiaDateISO(sunday);
}
