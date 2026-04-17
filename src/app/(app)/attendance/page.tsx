import {
  computeTotals,
  getDailyRecords,
  getEmployeesSummary,
  getGroups,
  groupRecordsByEmployee,
} from "@/lib/attendance/queries";
import { currentWeekMonday, currentWeekSunday } from "@/lib/format";
import AttendanceView from "./AttendanceView";

type SearchParams = Promise<{
  startDate?: string;
  endDate?: string;
  groupId?: string;
}>;

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const startDate = sp.startDate ?? currentWeekMonday();
  const endDate = sp.endDate ?? currentWeekSunday();
  const groupId = sp.groupId ?? "all";
  const groupIdNum = groupId === "all" ? null : Number(groupId);

  const [employees, dailyRecords, groups] = await Promise.all([
    getEmployeesSummary(startDate, endDate, groupIdNum),
    getDailyRecords(startDate, endDate),
    getGroups(),
  ]);

  const summary = computeTotals(employees);
  const recordsByEmployee = groupRecordsByEmployee(dailyRecords);

  return (
    <AttendanceView
      startDate={startDate}
      endDate={endDate}
      groupId={groupId}
      groups={groups}
      summary={summary}
      employees={employees}
      recordsByEmployee={recordsByEmployee}
    />
  );
}
