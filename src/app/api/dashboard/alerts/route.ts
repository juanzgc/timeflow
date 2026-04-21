import { NextResponse } from "next/server";
import { and, eq, desc, lt, gt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  employees,
  dailyAttendance,
  payrollPeriods,
  compTransactions,
  settings,
} from "@/drizzle/schema";
import { auth } from "@/auth";
import { todayColombiaISO, colHours } from "@/lib/timezone";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date();
  const todayStr = todayColombiaISO();

  // Find the latest finalized/exported payroll period end date to use as cutoff.
  // Missing punches before this date are irrelevant — payroll already ran.
  const HARD_CUTOFF = "2026-04-12";
  const [latestFinalizedRow] = await db
    .select({ periodEnd: payrollPeriods.periodEnd })
    .from(payrollPeriods)
    .where(
      sql`${payrollPeriods.status} IN ('finalized', 'exported')`,
    )
    .orderBy(desc(payrollPeriods.periodEnd))
    .limit(1);

  const payrollCutoff = latestFinalizedRow?.periodEnd ?? null;
  const cutoffDate = payrollCutoff && payrollCutoff > HARD_CUTOFF ? payrollCutoff : HARD_CUTOFF;

  const [
    missingPunches,
    overduePeriods,
    activePeriodRow,
    missingSalaryRows,
    missingSalaryCount,
    misssingCedulaCount,
    lastSyncRow,
  ] = await Promise.all([
    // Missing punches — only after cutoff and not for today (day isn't over
    // until 6 AM next day, matching the business-day boundary).
    // Before 6 AM Colombia time: also exclude yesterday (its business day is
    // still open).
    (() => {
      const hour = colHours(today);
      // Latest date whose business day is still open
      const openDate = hour < 6
        ? new Date(today.getTime() - 24 * 60 * 60 * 1000)  // yesterday
        : today;
      const openDateStr = openDate.toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
      return db
        .select({
          employeeId: employees.id,
          firstName: employees.firstName,
          lastName: employees.lastName,
          workDate: dailyAttendance.workDate,
          clockIn: dailyAttendance.clockIn,
          clockOut: dailyAttendance.clockOut,
        })
        .from(dailyAttendance)
        .innerJoin(employees, eq(dailyAttendance.employeeId, employees.id))
        .where(
          and(
            eq(dailyAttendance.isMissingPunch, true),
            gt(dailyAttendance.workDate, cutoffDate),
            lt(dailyAttendance.workDate, openDateStr),
          ),
        );
    })(),

    // Overdue periods (end date passed, still draft)
    db
      .selectDistinctOn(
        [payrollPeriods.periodStart, payrollPeriods.periodEnd],
        {
          periodStart: payrollPeriods.periodStart,
          periodEnd: payrollPeriods.periodEnd,
        },
      )
      .from(payrollPeriods)
      .where(
        and(
          eq(payrollPeriods.status, "draft"),
          lt(payrollPeriods.periodEnd, todayStr),
        ),
      )
      .orderBy(payrollPeriods.periodStart, payrollPeriods.periodEnd),

    // Active draft period
    db
      .select({
        periodStart: payrollPeriods.periodStart,
        periodEnd: payrollPeriods.periodEnd,
      })
      .from(payrollPeriods)
      .where(eq(payrollPeriods.status, "draft"))
      .orderBy(desc(payrollPeriods.periodStart))
      .limit(1),

    // Employees missing salary
    db
      .select({
        id: employees.id,
        firstName: employees.firstName,
        lastName: employees.lastName,
      })
      .from(employees)
      .where(
        and(
          eq(employees.isActive, true),
          sql`${employees.monthlySalary} IS NULL`,
        ),
      ),

    // Count missing salary
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(employees)
      .where(
        and(
          eq(employees.isActive, true),
          sql`${employees.monthlySalary} IS NULL`,
        ),
      ),

    // Count missing cedula
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(employees)
      .where(
        and(eq(employees.isActive, true), sql`${employees.cedula} IS NULL`),
      ),

    // Last sync time
    db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, "last_sync_time"))
      .limit(1),
  ]);

  // High comp balances (> 42h = 2520 min) and negative comp balances
  const compRows = await db
    .select({
      employeeId: compTransactions.employeeId,
      balanceAfter: compTransactions.balanceAfter,
      firstName: employees.firstName,
      lastName: employees.lastName,
    })
    .from(compTransactions)
    .innerJoin(employees, eq(compTransactions.employeeId, employees.id))
    .where(eq(employees.isActive, true))
    .orderBy(desc(compTransactions.createdAt));

  // Get latest comp balance per employee
  const latestComp = new Map<
    number,
    { balance: number; name: string }
  >();
  for (const row of compRows) {
    if (!latestComp.has(row.employeeId)) {
      latestComp.set(row.employeeId, {
        balance: row.balanceAfter,
        name: `${row.firstName} ${row.lastName}`,
      });
    }
  }

  const highCompBalances: { employeeId: number; name: string; hours: number }[] = [];
  const negativeCompBalances: { employeeId: number; name: string; hours: number }[] = [];
  for (const [empId, data] of latestComp) {
    if (data.balance > 2520) {
      highCompBalances.push({
        employeeId: empId,
        name: data.name,
        hours: Math.round((data.balance / 60) * 10) / 10,
      });
    }
    if (data.balance < 0) {
      negativeCompBalances.push({
        employeeId: empId,
        name: data.name,
        hours: Math.round((data.balance / 60) * 10) / 10,
      });
    }
  }

  // Check if BioTime sync is stale (> 30 minutes)
  let syncStale = false;
  const lastSync = lastSyncRow[0]?.value;
  if (lastSync) {
    const lastSyncDate = new Date(lastSync);
    const diffMs = today.getTime() - lastSyncDate.getTime();
    syncStale = diffMs > 30 * 60 * 1000;
  } else {
    syncStale = true; // never synced
  }

  return NextResponse.json({
    missingPunches: missingPunches.map((mp) => ({
      employeeId: mp.employeeId,
      name: `${mp.firstName} ${mp.lastName}`,
      date: mp.workDate,
      detail: !mp.clockIn
        ? "Sin marcación entrada"
        : !mp.clockOut
          ? "Sin marcación salida"
          : "Marcación faltante",
    })),
    overduePeriods,
    hasActivePeriod: activePeriodRow.length > 0,
    activePeriod: activePeriodRow[0] ?? null,
    missingSalary: missingSalaryRows.map((e) => ({
      employeeId: e.id,
      name: `${e.firstName} ${e.lastName}`,
    })),
    missingSalaryCount: missingSalaryCount[0]?.count ?? 0,
    missingCedulaCount: misssingCedulaCount[0]?.count ?? 0,
    highCompBalances,
    negativeCompBalances,
    syncStale,
    lastSyncTime: lastSync || null,
  });
}
