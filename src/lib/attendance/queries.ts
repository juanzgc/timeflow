import { unstable_cache } from "next/cache";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { dailyAttendance, employees, groups } from "@/drizzle/schema";
import { ATTENDANCE_TAG } from "./invalidate";

export type EmployeeSummaryRow = {
  employeeId: number;
  empCode: string;
  firstName: string;
  lastName: string;
  groupId: number | null;
  groupName: string | null;
  daysPresent: number;
  totalWorkedMins: number;
  totalLateMins: number;
  totalExcessMins: number;
  totalNocturnoMins: number;
  totalFestivoMins: number;
};

export type AttendanceSummary = {
  totalWorkedMins: number;
  totalLateMins: number;
  totalExcessMins: number;
};

export type DailyRecord = {
  id: number;
  employeeId: number;
  workDate: string;
  status: string | null;
  clockIn: string | null;
  clockOut: string | null;
  effectiveIn: string | null;
  effectiveOut: string | null;
  totalWorkedMins: number;
  lateMinutes: number;
  earlyLeaveMins: number;
  minsOrdinaryDay: number;
  minsNocturno: number;
  minsFestivoDay: number;
  minsFestivoNight: number;
  excessHedMins: number;
  excessHenMins: number;
  dayType: string | null;
  isClockInManual: boolean;
  isClockOutManual: boolean;
  isMissingPunch: boolean;
  scheduledStart: string | null;
  scheduledEnd: string | null;
};

export type GroupRow = {
  id: number;
  name: string;
};

const CACHE_OPTS = { tags: [ATTENDANCE_TAG], revalidate: 300 };

async function fetchEmployeesSummary(
  startDate: string,
  endDate: string,
  groupId: number | null,
): Promise<EmployeeSummaryRow[]> {
  const conditions = [
    eq(employees.isActive, true),
    gte(dailyAttendance.workDate, startDate),
    lte(dailyAttendance.workDate, endDate),
  ];

  if (groupId !== null) {
    conditions.push(eq(employees.groupId, groupId));
  }

  return db
    .select({
      employeeId: employees.id,
      empCode: employees.empCode,
      firstName: employees.firstName,
      lastName: employees.lastName,
      groupId: employees.groupId,
      groupName: groups.name,
      daysPresent: sql<number>`count(case when ${dailyAttendance.clockIn} is not null then 1 end)::int`,
      totalWorkedMins: sql<number>`coalesce(sum(${dailyAttendance.totalWorkedMins}), 0)::int`,
      totalLateMins: sql<number>`coalesce(sum(${dailyAttendance.lateMinutes}), 0)::int`,
      totalExcessMins: sql<number>`coalesce(sum(${dailyAttendance.excessHedMins} + ${dailyAttendance.excessHenMins}), 0)::int`,
      totalNocturnoMins: sql<number>`coalesce(sum(${dailyAttendance.minsNocturno}), 0)::int`,
      totalFestivoMins: sql<number>`coalesce(sum(${dailyAttendance.minsFestivoDay} + ${dailyAttendance.minsFestivoNight}), 0)::int`,
    })
    .from(employees)
    .leftJoin(groups, eq(employees.groupId, groups.id))
    .innerJoin(dailyAttendance, eq(dailyAttendance.employeeId, employees.id))
    .where(and(...conditions))
    .groupBy(
      employees.id,
      employees.empCode,
      employees.firstName,
      employees.lastName,
      employees.groupId,
      groups.name,
    )
    .orderBy(employees.firstName);
}

export const getEmployeesSummary = unstable_cache(
  fetchEmployeesSummary,
  ["attendance-employees-summary"],
  CACHE_OPTS,
);

async function fetchDailyRecords(
  startDate: string,
  endDate: string,
): Promise<DailyRecord[]> {
  const rows = await db
    .select({
      id: dailyAttendance.id,
      employeeId: dailyAttendance.employeeId,
      workDate: dailyAttendance.workDate,
      status: dailyAttendance.status,
      clockIn: dailyAttendance.clockIn,
      clockOut: dailyAttendance.clockOut,
      effectiveIn: dailyAttendance.effectiveIn,
      effectiveOut: dailyAttendance.effectiveOut,
      totalWorkedMins: dailyAttendance.totalWorkedMins,
      lateMinutes: dailyAttendance.lateMinutes,
      earlyLeaveMins: dailyAttendance.earlyLeaveMins,
      minsOrdinaryDay: dailyAttendance.minsOrdinaryDay,
      minsNocturno: dailyAttendance.minsNocturno,
      minsFestivoDay: dailyAttendance.minsFestivoDay,
      minsFestivoNight: dailyAttendance.minsFestivoNight,
      excessHedMins: dailyAttendance.excessHedMins,
      excessHenMins: dailyAttendance.excessHenMins,
      dayType: dailyAttendance.dayType,
      isClockInManual: dailyAttendance.isClockInManual,
      isClockOutManual: dailyAttendance.isClockOutManual,
      isMissingPunch: dailyAttendance.isMissingPunch,
      scheduledStart: dailyAttendance.scheduledStart,
      scheduledEnd: dailyAttendance.scheduledEnd,
    })
    .from(dailyAttendance)
    .innerJoin(employees, eq(dailyAttendance.employeeId, employees.id))
    .where(
      and(
        eq(employees.isActive, true),
        gte(dailyAttendance.workDate, startDate),
        lte(dailyAttendance.workDate, endDate),
      ),
    )
    .orderBy(dailyAttendance.employeeId, dailyAttendance.workDate);

  return rows.map((r) => ({
    ...r,
    clockIn: r.clockIn ? r.clockIn.toISOString() : null,
    clockOut: r.clockOut ? r.clockOut.toISOString() : null,
    effectiveIn: r.effectiveIn ? r.effectiveIn.toISOString() : null,
    effectiveOut: r.effectiveOut ? r.effectiveOut.toISOString() : null,
  }));
}

export const getDailyRecords = unstable_cache(
  fetchDailyRecords,
  ["attendance-daily-records"],
  CACHE_OPTS,
);

async function fetchGroups(): Promise<GroupRow[]> {
  return db
    .select({ id: groups.id, name: groups.name })
    .from(groups)
    .orderBy(groups.name);
}

export const getGroups = unstable_cache(fetchGroups, ["attendance-groups"], {
  tags: ["groups"],
  revalidate: 3600,
});

export function computeTotals(rows: EmployeeSummaryRow[]): AttendanceSummary {
  return {
    totalWorkedMins: rows.reduce((s, r) => s + r.totalWorkedMins, 0),
    totalLateMins: rows.reduce((s, r) => s + r.totalLateMins, 0),
    totalExcessMins: rows.reduce((s, r) => s + r.totalExcessMins, 0),
  };
}

export function groupRecordsByEmployee(
  records: DailyRecord[],
): Record<number, DailyRecord[]> {
  const map: Record<number, DailyRecord[]> = {};
  for (const r of records) {
    if (!map[r.employeeId]) map[r.employeeId] = [];
    map[r.employeeId].push(r);
  }
  return map;
}
