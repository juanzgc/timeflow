"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { ChevronDownIcon, ChevronRightIcon, PencilIcon } from "lucide-react";
import {
  formatMins,
  formatTime,
  getDayName,
  currentWeekMonday,
  currentWeekSunday,
} from "@/lib/format";

const GROUP_COLORS: Record<string, string> = {
  Kitchen: "var(--group-kitchen)",
  Servers: "var(--group-servers)",
  Bar: "var(--group-bar)",
  Admin: "var(--group-admin)",
};

type EmployeeSummary = {
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

type DailyRecord = {
  id: number;
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
};

type Group = { id: number; name: string };

export default function AttendancePage() {
  const [startDate, setStartDate] = useState(currentWeekMonday);
  const [endDate, setEndDate] = useState(currentWeekSunday);
  const [groupId, setGroupId] = useState<string>("all");
  const [groups, setGroups] = useState<Group[]>([]);
  const [summary, setSummary] = useState<{
    totalWorkedMins: number;
    totalLateMins: number;
    totalExcessMins: number;
  } | null>(null);
  const [employees, setEmployees] = useState<EmployeeSummary[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [dailyRecords, setDailyRecords] = useState<DailyRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchGroups = useCallback(async () => {
    const res = await fetch("/api/groups");
    setGroups(await res.json());
  }, []);

  const fetchAttendance = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ startDate, endDate });
    if (groupId !== "all") params.set("groupId", groupId);
    const res = await fetch(`/api/attendance?${params}`);
    const data = await res.json();
    setSummary(data.summary);
    setEmployees(data.employees);
    setLoading(false);
  }, [startDate, endDate, groupId]);

  useEffect(() => {
    fetchGroups(); // eslint-disable-line react-hooks/set-state-in-effect -- initial data fetch
  }, [fetchGroups]);

  useEffect(() => {
    fetchAttendance(); // eslint-disable-line react-hooks/set-state-in-effect -- data fetch on filter change
  }, [fetchAttendance]);

  const toggleExpand = async (empId: number) => {
    if (expandedId === empId) {
      setExpandedId(null);
      setDailyRecords([]);
      return;
    }
    setExpandedId(empId);
    const res = await fetch(
      `/api/attendance/${empId}?startDate=${startDate}&endDate=${endDate}`,
    );
    setDailyRecords(await res.json());
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-[22px] font-extrabold tracking-[-0.04em]">
          Attendance Log
        </h1>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          Daily attendance records with punch details and recargo classification.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
            Start
          </label>
          <Input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="h-9 w-40 text-xs"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
            End
          </label>
          <Input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="h-9 w-40 text-xs"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
            Group
          </label>
          <Select value={groupId} onValueChange={(v) => setGroupId(v ?? "all")}>
            <SelectTrigger className="h-9 w-40 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Groups</SelectItem>
              {groups.map((g) => (
                <SelectItem key={g.id} value={String(g.id)}>
                  {g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          {
            label: "Total Hours Worked",
            value: summary ? formatMins(summary.totalWorkedMins) : "--",
            accent: "var(--primary)",
          },
          {
            label: "Total Late Minutes",
            value: summary ? formatMins(summary.totalLateMins) : "--",
            accent: "var(--warning)",
          },
          {
            label: "Total Excess Hours",
            value: summary ? formatMins(summary.totalExcessMins) : "--",
            accent: "var(--nocturno)",
          },
        ].map((card) => (
          <Card key={card.label} className="relative overflow-hidden">
            <div
              className="absolute top-0 right-0 left-0 h-0.5 opacity-60"
              style={{
                background: `linear-gradient(90deg, ${card.accent}, transparent)`,
              }}
            />
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                {card.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-extrabold tracking-[-0.04em]">
                {card.value}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Attendance Table */}
      <Card>
        <CardHeader className="border-b px-5 py-3.5">
          <CardTitle className="text-sm font-bold tracking-[-0.01em]">
            Employee Attendance
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              ({employees.length})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
              Loading...
            </div>
          ) : employees.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
              No attendance records for this date range
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Employee</TableHead>
                  <TableHead className="w-20">Days</TableHead>
                  <TableHead className="w-24">Total Hours</TableHead>
                  <TableHead className="w-20">Avg/Day</TableHead>
                  <TableHead className="w-20">Late</TableHead>
                  <TableHead className="w-20">Excess</TableHead>
                  <TableHead className="w-20">Nocturno</TableHead>
                  <TableHead className="w-20">Festivo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {employees.map((emp) => {
                  const isExpanded = expandedId === emp.employeeId;
                  const gc = emp.groupName
                    ? GROUP_COLORS[emp.groupName]
                    : undefined;
                  const avgPerDay =
                    emp.daysPresent > 0
                      ? Math.round(emp.totalWorkedMins / emp.daysPresent)
                      : 0;
                  return (
                    <>
                      <TableRow
                        key={emp.employeeId}
                        className="cursor-pointer"
                        onClick={() => toggleExpand(emp.employeeId)}
                      >
                        <TableCell className="pr-0">
                          {isExpanded ? (
                            <ChevronDownIcon className="size-4 text-muted-foreground" />
                          ) : (
                            <ChevronRightIcon className="size-4 text-muted-foreground" />
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2.5">
                            <div
                              className="flex size-7 shrink-0 items-center justify-center rounded-md text-[10px] font-bold"
                              style={{
                                backgroundColor: gc
                                  ? `color-mix(in srgb, ${gc} 10%, transparent)`
                                  : "var(--secondary)",
                                color: gc ?? "var(--foreground)",
                              }}
                            >
                              {emp.firstName[0]}
                              {emp.lastName[0]}
                            </div>
                            <div>
                              <span className="text-[13px] font-semibold">
                                {emp.firstName} {emp.lastName}
                              </span>
                              {emp.groupName && gc && (
                                <span
                                  className="ml-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                                  style={{
                                    backgroundColor: `color-mix(in srgb, ${gc} 10%, transparent)`,
                                    color: gc,
                                  }}
                                >
                                  {emp.groupName}
                                </span>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs font-medium">
                          {emp.daysPresent}
                        </TableCell>
                        <TableCell className="font-mono text-xs font-semibold">
                          {formatMins(emp.totalWorkedMins)}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {formatMins(avgPerDay)}
                        </TableCell>
                        <TableCell>
                          {emp.totalLateMins > 0 ? (
                            <span className="inline-block rounded-full border border-warning/15 bg-warning-bg px-2 py-0.5 text-[11px] font-semibold text-warning-text">
                              {formatMins(emp.totalLateMins)}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              —
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {emp.totalExcessMins > 0 ? (
                            <span className="inline-block rounded-full border border-nocturno/15 bg-nocturno-bg px-2 py-0.5 text-[11px] font-semibold text-nocturno-text">
                              +{formatMins(emp.totalExcessMins)}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              —
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {emp.totalNocturnoMins > 0 ? (
                            <span className="font-mono text-xs font-medium text-nocturno-text">
                              {formatMins(emp.totalNocturnoMins)}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              —
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {emp.totalFestivoMins > 0 ? (
                            <span className="font-mono text-xs font-medium text-danger-text">
                              {formatMins(emp.totalFestivoMins)}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              —
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow key={`${emp.employeeId}-detail`}>
                          <TableCell colSpan={9} className="bg-muted/30 p-0">
                            <DailyBreakdown records={dailyRecords} />
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DailyBreakdown({ records }: { records: DailyRecord[] }) {
  if (records.length === 0) {
    return (
      <div className="flex h-16 items-center justify-center text-xs text-muted-foreground">
        Loading daily records...
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-foreground/5">
            {[
              "Date",
              "Status",
              "Clock In",
              "Clock Out",
              "Eff. In",
              "Eff. Out",
              "Worked",
              "Late",
              "Ordinary",
              "Nocturno",
              "Festivo D",
              "Festivo N",
              "Excess D",
              "Excess N",
            ].map((h) => (
              <th
                key={h}
                className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr
              key={r.workDate}
              className={`border-b border-foreground/5 ${r.status === "absent" ? "bg-danger-bg/30" : ""}`}
            >
              <td className="px-3 py-2 font-medium">
                <span className="flex items-center gap-1.5">
                  {r.dayType === "holiday" && (
                    <span className="size-1.5 rounded-full bg-danger" />
                  )}
                  {getDayName(r.workDate)} {r.workDate.slice(5)}
                </span>
              </td>
              <td className="px-3 py-2">
                <DayStatusBadge status={r.status} />
              </td>
              <td className="px-3 py-2 font-mono">
                <span className="inline-flex items-center gap-1">
                  {r.clockIn ? formatTime(r.clockIn) : "—"}
                  {r.isClockInManual && (
                    <PencilIcon className="size-2.5 text-warning" />
                  )}
                </span>
              </td>
              <td className="px-3 py-2 font-mono">
                <span className="inline-flex items-center gap-1">
                  {r.clockOut ? formatTime(r.clockOut) : "—"}
                  {r.isClockOutManual && (
                    <PencilIcon className="size-2.5 text-warning" />
                  )}
                </span>
              </td>
              <td className="px-3 py-2 font-mono text-muted-foreground">
                {r.effectiveIn ? formatTime(r.effectiveIn) : "—"}
              </td>
              <td className="px-3 py-2 font-mono text-muted-foreground">
                {r.effectiveOut ? formatTime(r.effectiveOut) : "—"}
              </td>
              <td className="px-3 py-2 font-mono font-semibold">
                {formatMins(r.totalWorkedMins)}
              </td>
              <td className="px-3 py-2">
                {r.lateMinutes > 0 ? (
                  <span className="text-warning-text">{r.lateMinutes}m</span>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-3 py-2 font-mono">{formatMins(r.minsOrdinaryDay)}</td>
              <td className="px-3 py-2">
                {r.minsNocturno > 0 ? (
                  <span className="rounded bg-nocturno-bg px-1.5 py-0.5 font-mono text-nocturno-text">
                    {formatMins(r.minsNocturno)}
                  </span>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-3 py-2">
                {r.minsFestivoDay > 0 ? (
                  <span className="rounded bg-danger-bg px-1.5 py-0.5 font-mono text-danger-text">
                    {formatMins(r.minsFestivoDay)}
                  </span>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-3 py-2">
                {r.minsFestivoNight > 0 ? (
                  <span className="rounded bg-danger-bg px-1.5 py-0.5 font-mono text-danger-text">
                    {formatMins(r.minsFestivoNight)}
                  </span>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-3 py-2">
                {r.excessHedMins > 0 ? (
                  <span className="rounded bg-warning-bg px-1.5 py-0.5 font-mono text-warning-text">
                    {formatMins(r.excessHedMins)}
                  </span>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-3 py-2">
                {r.excessHenMins > 0 ? (
                  <span className="rounded bg-nocturno-bg px-1.5 py-0.5 font-mono text-nocturno-text">
                    {formatMins(r.excessHenMins)}
                  </span>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DayStatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  const map: Record<string, { color: string; bg: string; label: string }> = {
    "on-time": { color: "var(--success-text)", bg: "var(--success-bg)", label: "On time" },
    late: { color: "var(--warning-text)", bg: "var(--warning-bg)", label: "Late" },
    absent: { color: "var(--danger-text)", bg: "var(--danger-bg)", label: "Absent" },
    "day-off": { color: "var(--muted-foreground)", bg: "var(--secondary)", label: "Day off" },
    "comp-day-off": { color: "var(--info-text)", bg: "var(--info-bg)", label: "Comp" },
  };
  const c = map[status] ?? { color: "var(--muted-foreground)", bg: "var(--secondary)", label: status };
  return (
    <span
      className="inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ color: c.color, backgroundColor: c.bg }}
    >
      {c.label}
    </span>
  );
}
