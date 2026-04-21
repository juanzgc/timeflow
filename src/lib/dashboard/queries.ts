import { unstable_cache } from "next/cache";
import { and, desc, eq, gt, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  compTransactions,
  dailyAttendance,
  employees,
  groups,
  payrollPeriods,
  settings,
} from "@/drizzle/schema";
import {
  ATTENDANCE_TAG,
  COMP_BALANCES_TAG,
  EMPLOYEES_TAG,
} from "@/lib/attendance/invalidate";
import { colHours } from "@/lib/timezone";

// ─── Types ──────────────────────────────────────────────────────────────────

export type TodayAttendanceRow = {
  id: number;
  empCode: string;
  firstName: string;
  lastName: string;
  groupId: number | null;
  groupName: string | null;
  clockIn: string | null;
  clockOut: string | null;
  totalWorkedMins: number | null;
  lateMinutes: number | null;
  earlyLeaveMins: number | null;
  excessHedMins: number | null;
  excessHenMins: number | null;
  status: string | null;
  isMissingPunch: boolean;
  isClockInManual: boolean;
  isClockOutManual: boolean;
};

export type TodayKPIs = {
  totalEmployees: number;
  present: number;
  onTime: number;
  onTimePercent: number;
  late: number;
  missingPunch: number;
  trends: { present: number; onTimePercent: number; late: number };
};

export type TodayData = {
  date: string;
  kpis: TodayKPIs;
  attendance: TodayAttendanceRow[];
};

export type CompBalanceRow = {
  id: number;
  firstName: string;
  lastName: string;
  compBalance: number;
};

export type PeriodTrackerData = {
  period: { periodStart: string; periodEnd: string } | null;
  employees: {
    id: number;
    firstName: string;
    lastName: string;
    totalExpectedMins: number;
    totalWorkedMins: number;
  }[];
};

export type DashboardAlerts = {
  missingPunches: {
    employeeId: number;
    name: string;
    date?: string;
    detail: string;
  }[];
  overduePeriods: { periodStart: string; periodEnd: string }[];
  hasActivePeriod: boolean;
  activePeriod: { periodStart: string; periodEnd: string } | null;
  missingSalary: { employeeId: number; name: string }[];
  missingSalaryCount: number;
  missingCedulaCount: number;
  highCompBalances: { employeeId: number; name: string; hours: number }[];
  negativeCompBalances: { employeeId: number; name: string; hours: number }[];
  syncStale: boolean;
  lastSyncTime: string | null;
};

// ─── Today's Attendance (cached) ────────────────────────────────────────────

async function fetchTodayAttendance(
  todayStr: string,
  lastWeekStr: string,
): Promise<TodayData> {
  const rows = await db
    .select({
      id: employees.id,
      empCode: employees.empCode,
      firstName: employees.firstName,
      lastName: employees.lastName,
      groupId: employees.groupId,
      groupName: groups.name,
      clockIn: dailyAttendance.clockIn,
      clockOut: dailyAttendance.clockOut,
      totalWorkedMins: dailyAttendance.totalWorkedMins,
      lateMinutes: dailyAttendance.lateMinutes,
      earlyLeaveMins: dailyAttendance.earlyLeaveMins,
      excessHedMins: dailyAttendance.excessHedMins,
      excessHenMins: dailyAttendance.excessHenMins,
      status: dailyAttendance.status,
      isMissingPunch: dailyAttendance.isMissingPunch,
      isClockInManual: dailyAttendance.isClockInManual,
      isClockOutManual: dailyAttendance.isClockOutManual,
    })
    .from(employees)
    .leftJoin(groups, eq(employees.groupId, groups.id))
    .leftJoin(
      dailyAttendance,
      and(
        eq(dailyAttendance.employeeId, employees.id),
        eq(dailyAttendance.workDate, todayStr),
      ),
    )
    .where(eq(employees.isActive, true))
    .orderBy(
      sql`CASE ${dailyAttendance.status}
        WHEN 'absent' THEN 1
        WHEN 'late' THEN 2
        WHEN 'on-time' THEN 3
        WHEN 'day-off' THEN 4
        WHEN 'comp-day-off' THEN 5
        ELSE 6
      END`,
    );

  const serialized: TodayAttendanceRow[] = rows.map((r) => ({
    ...r,
    clockIn: r.clockIn ? r.clockIn.toISOString() : null,
    clockOut: r.clockOut ? r.clockOut.toISOString() : null,
    isMissingPunch: r.isMissingPunch ?? false,
    isClockInManual: r.isClockInManual ?? false,
    isClockOutManual: r.isClockOutManual ?? false,
  }));

  const totalEmployees = serialized.length;
  const present = serialized.filter((r) => r.clockIn !== null).length;
  const onTime = serialized.filter(
    (r) => r.clockIn !== null && (r.lateMinutes ?? 0) === 0,
  ).length;
  const late = serialized.filter((r) => (r.lateMinutes ?? 0) > 0).length;

  const lastWeekRows = await db
    .select({
      clockIn: dailyAttendance.clockIn,
      lateMinutes: dailyAttendance.lateMinutes,
    })
    .from(dailyAttendance)
    .innerJoin(
      employees,
      and(eq(dailyAttendance.employeeId, employees.id), eq(employees.isActive, true)),
    )
    .where(eq(dailyAttendance.workDate, lastWeekStr));

  const lwPresent = lastWeekRows.filter((r) => r.clockIn !== null).length;
  const lwOnTime = lastWeekRows.filter(
    (r) => r.clockIn !== null && (r.lateMinutes ?? 0) === 0,
  ).length;
  const lwLate = lastWeekRows.filter((r) => (r.lateMinutes ?? 0) > 0).length;

  const kpis: TodayKPIs = {
    totalEmployees,
    present,
    onTime,
    onTimePercent: present > 0 ? Math.round((onTime / present) * 100) : 0,
    late,
    missingPunch: 0,
    trends: {
      present: present - lwPresent,
      onTimePercent:
        present > 0
          ? Math.round((onTime / present) * 100) -
            (lwPresent > 0 ? Math.round((lwOnTime / lwPresent) * 100) : 0)
          : 0,
      late: late - lwLate,
    },
  };

  return { date: todayStr, kpis, attendance: serialized };
}

export const getTodayAttendance = unstable_cache(
  fetchTodayAttendance,
  ["dashboard-today"],
  { tags: [ATTENDANCE_TAG, EMPLOYEES_TAG], revalidate: 300 },
);

// ─── Comp Balances (cached) ─────────────────────────────────────────────────

async function fetchCompBalances(): Promise<CompBalanceRow[]> {
  // One query: latest balanceAfter per active employee.
  const rows = await db
    .select({
      id: employees.id,
      firstName: employees.firstName,
      lastName: employees.lastName,
      balance: sql<number | null>`(
        SELECT ${compTransactions.balanceAfter}
        FROM ${compTransactions}
        WHERE ${compTransactions.employeeId} = ${employees.id}
        ORDER BY ${compTransactions.createdAt} DESC
        LIMIT 1
      )`,
    })
    .from(employees)
    .where(eq(employees.isActive, true));

  const results = rows.map((r) => ({
    id: r.id,
    firstName: r.firstName,
    lastName: r.lastName,
    compBalance: r.balance ?? 0,
  }));

  results.sort((a, b) => b.compBalance - a.compBalance);
  return results;
}

export const getCompBalances = unstable_cache(
  fetchCompBalances,
  ["dashboard-comp-balances"],
  { tags: [COMP_BALANCES_TAG, EMPLOYEES_TAG], revalidate: 300 },
);

// ─── Period Tracker (LIVE — payroll) ────────────────────────────────────────

export async function getPeriodTracker(): Promise<PeriodTrackerData> {
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
    return { period: null, employees: [] };
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

  return { period: latestPeriod, employees: rows };
}

// ─── Dashboard Alerts (mixed — cached subqueries where safe) ────────────────

const HARD_CUTOFF = "2026-04-12";

async function fetchMissingPunches(cutoffDate: string, openDateStr: string) {
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
}

const getMissingPunchesCached = unstable_cache(
  fetchMissingPunches,
  ["dashboard-missing-punches"],
  { tags: [ATTENDANCE_TAG], revalidate: 300 },
);

async function fetchEmployeeInfoAlerts() {
  const [missingSalaryRows, missingSalaryCount, missingCedulaCount] =
    await Promise.all([
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
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(employees)
        .where(
          and(
            eq(employees.isActive, true),
            sql`${employees.monthlySalary} IS NULL`,
          ),
        ),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(employees)
        .where(
          and(eq(employees.isActive, true), sql`${employees.cedula} IS NULL`),
        ),
    ]);

  return {
    missingSalaryRows,
    missingSalaryCount: missingSalaryCount[0]?.count ?? 0,
    missingCedulaCount: missingCedulaCount[0]?.count ?? 0,
  };
}

const getEmployeeInfoAlertsCached = unstable_cache(
  fetchEmployeeInfoAlerts,
  ["dashboard-employee-info-alerts"],
  { tags: [EMPLOYEES_TAG], revalidate: 300 },
);

async function fetchCompBalanceAlerts() {
  const rows = await db
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

  const latest = new Map<number, { balance: number; name: string }>();
  for (const r of rows) {
    if (!latest.has(r.employeeId)) {
      latest.set(r.employeeId, {
        balance: r.balanceAfter,
        name: `${r.firstName} ${r.lastName}`,
      });
    }
  }

  const high: { employeeId: number; name: string; hours: number }[] = [];
  const negative: { employeeId: number; name: string; hours: number }[] = [];
  for (const [empId, data] of latest) {
    if (data.balance > 2520) {
      high.push({
        employeeId: empId,
        name: data.name,
        hours: Math.round((data.balance / 60) * 10) / 10,
      });
    }
    if (data.balance < 0) {
      negative.push({
        employeeId: empId,
        name: data.name,
        hours: Math.round((data.balance / 60) * 10) / 10,
      });
    }
  }

  return { high, negative };
}

const getCompBalanceAlertsCached = unstable_cache(
  fetchCompBalanceAlerts,
  ["dashboard-comp-balance-alerts"],
  { tags: [COMP_BALANCES_TAG], revalidate: 300 },
);

export async function getDashboardAlerts(
  todayStr: string,
): Promise<DashboardAlerts> {
  const today = new Date();

  // Business day cutoff logic
  const hour = colHours(today);
  const openDate =
    hour < 6 ? new Date(today.getTime() - 24 * 60 * 60 * 1000) : today;
  const openDateStr = openDate.toLocaleDateString("en-CA", {
    timeZone: "America/Bogota",
  });

  // Payroll cutoff (live — always read fresh)
  const [latestFinalizedRow] = await db
    .select({ periodEnd: payrollPeriods.periodEnd })
    .from(payrollPeriods)
    .where(sql`${payrollPeriods.status} IN ('finalized', 'exported')`)
    .orderBy(desc(payrollPeriods.periodEnd))
    .limit(1);

  const payrollCutoff = latestFinalizedRow?.periodEnd ?? null;
  const cutoffDate =
    payrollCutoff && payrollCutoff > HARD_CUTOFF ? payrollCutoff : HARD_CUTOFF;

  const [
    missingPunches,
    employeeInfo,
    compAlerts,
    overduePeriods,
    activePeriodRow,
    lastSyncRow,
  ] = await Promise.all([
    getMissingPunchesCached(cutoffDate, openDateStr),
    getEmployeeInfoAlertsCached(),
    getCompBalanceAlertsCached(),
    // Payroll queries — live
    db
      .selectDistinctOn([payrollPeriods.periodStart, payrollPeriods.periodEnd], {
        periodStart: payrollPeriods.periodStart,
        periodEnd: payrollPeriods.periodEnd,
      })
      .from(payrollPeriods)
      .where(
        and(
          eq(payrollPeriods.status, "draft"),
          lt(payrollPeriods.periodEnd, todayStr),
        ),
      )
      .orderBy(payrollPeriods.periodStart, payrollPeriods.periodEnd),
    db
      .select({
        periodStart: payrollPeriods.periodStart,
        periodEnd: payrollPeriods.periodEnd,
      })
      .from(payrollPeriods)
      .where(eq(payrollPeriods.status, "draft"))
      .orderBy(desc(payrollPeriods.periodStart))
      .limit(1),
    db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, "last_sync_time"))
      .limit(1),
  ]);

  const lastSync = lastSyncRow[0]?.value;
  let syncStale = true;
  if (lastSync) {
    const diffMs = today.getTime() - new Date(lastSync).getTime();
    syncStale = diffMs > 30 * 60 * 1000;
  }

  return {
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
    missingSalary: employeeInfo.missingSalaryRows.map((e) => ({
      employeeId: e.id,
      name: `${e.firstName} ${e.lastName}`,
    })),
    missingSalaryCount: employeeInfo.missingSalaryCount,
    missingCedulaCount: employeeInfo.missingCedulaCount,
    highCompBalances: compAlerts.high,
    negativeCompBalances: compAlerts.negative,
    syncStale,
    lastSyncTime: lastSync ?? null,
  };
}
