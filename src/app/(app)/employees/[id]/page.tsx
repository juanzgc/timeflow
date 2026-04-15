"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { ArrowLeftIcon, PencilIcon } from "lucide-react";
import Link from "next/link";
import {
  formatMins,
  formatMinsAsHours,
  formatTime,
  formatDateMedium,
  getDayName,
  currentWeekMonday,
  currentWeekSunday,
} from "@/lib/format";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const GROUP_COLORS: Record<string, string> = {
  Kitchen: "var(--group-kitchen)",
  Servers: "var(--group-servers)",
  Bar: "var(--group-bar)",
  Admin: "var(--group-admin)",
};

type Employee = {
  id: number;
  empCode: string;
  cedula: string | null;
  firstName: string;
  lastName: string;
  groupId: number | null;
  groupName: string | null;
  monthlySalary: string | null;
  restDay: number;
  isActive: boolean;
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
};

type CompTransaction = {
  id: number;
  transactionDate: string;
  type: string;
  minutes: number;
  balanceAfter: number;
  note: string | null;
  createdBy: string;
  createdAt: string;
};

type Correction = {
  id: number;
  workDate: string;
  action: string;
  oldValue: string | null;
  newValue: string;
  reason: string;
  correctedBy: string;
  correctedAt: string;
};

export default function EmployeeDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [employee, setEmployee] = useState<Employee | null>(null);
  const [attendance, setAttendance] = useState<DailyRecord[]>([]);
  const [compTxs, setCompTxs] = useState<CompTransaction[]>([]);
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [startDate, setStartDate] = useState(currentWeekMonday);
  const [endDate, setEndDate] = useState(currentWeekSunday);
  const [compBalance, setCompBalance] = useState(0);

  const fetchEmployee = useCallback(async () => {
    const res = await fetch(`/api/employees/${id}`);
    if (res.ok) {
      const data = await res.json();
      setEmployee(data);
    }
  }, [id]);

  const fetchAttendance = useCallback(async () => {
    const res = await fetch(
      `/api/employees/${id}/attendance?startDate=${startDate}&endDate=${endDate}`,
    );
    if (res.ok) {
      const data = await res.json();
      setAttendance(data);
    }
  }, [id, startDate, endDate]);

  const fetchCompTxs = useCallback(async () => {
    const res = await fetch(`/api/employees/${id}/comp-transactions`);
    if (res.ok) {
      const data = await res.json();
      setCompTxs(data);
      if (data.length > 0) {
        setCompBalance(data[0].balanceAfter);
      }
    }
  }, [id]);

  const fetchCorrections = useCallback(async () => {
    const res = await fetch(`/api/employees/${id}/corrections`);
    if (res.ok) {
      setCorrections(await res.json());
    }
  }, [id]);

  useEffect(() => {
    fetchEmployee(); // eslint-disable-line react-hooks/set-state-in-effect -- initial data fetch
    fetchCompTxs();
    fetchCorrections();
  }, [fetchEmployee, fetchCompTxs, fetchCorrections]);

  useEffect(() => {
    fetchAttendance(); // eslint-disable-line react-hooks/set-state-in-effect -- data fetch on date change
  }, [fetchAttendance]);

  // Derive period stats from attendance
  const periodStats = useMemo(() => {
    if (attendance.length === 0) return null;
    const totalWorked = attendance.reduce((s, r) => s + r.totalWorkedMins, 0);
    const totalLate = attendance.reduce((s, r) => s + r.lateMinutes, 0);
    const daysPresent = attendance.filter((r) => r.totalWorkedMins > 0).length;
    return {
      totalWorkedMins: totalWorked,
      totalExpectedMins: daysPresent * 480,
      totalLateMins: totalLate,
    };
  }, [attendance]);

  if (!employee) {
    return (
      <div className="flex h-64 items-center justify-center text-xs text-muted-foreground">
        Loading...
      </div>
    );
  }

  const gc = employee.groupName ? GROUP_COLORS[employee.groupName] : undefined;

  return (
    <div className="space-y-5">
      {/* Back link */}
      <Link
        href="/employees"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon className="size-3.5" />
        Back to Employees
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div
            className="flex size-14 items-center justify-center rounded-xl text-lg font-bold"
            style={{
              backgroundColor: gc
                ? `color-mix(in srgb, ${gc} 12%, transparent)`
                : "var(--secondary)",
              color: gc ?? "var(--foreground)",
            }}
          >
            {employee.firstName[0]}
            {employee.lastName[0]}
          </div>
          <div>
            <h1 className="text-[22px] font-extrabold tracking-[-0.04em]">
              {employee.firstName} {employee.lastName}
            </h1>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              {employee.groupName && (
                <span
                  className="mr-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                  style={{
                    backgroundColor: gc
                      ? `color-mix(in srgb, ${gc} 10%, transparent)`
                      : "var(--secondary)",
                    color: gc ?? "var(--foreground)",
                  }}
                >
                  {employee.groupName}
                </span>
              )}
              #{employee.empCode}
              {employee.cedula && ` · Cedula: ${employee.cedula}`}
            </p>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              {employee.monthlySalary &&
                `Salary: $${Number(employee.monthlySalary).toLocaleString("es-CO")}`}
              {" · "}Rest Day: {DAY_LABELS[employee.restDay]}
            </p>
          </div>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid gap-3 sm:grid-cols-4">
        <Card className="relative overflow-hidden">
          <div
            className="absolute top-0 right-0 left-0 h-0.5 opacity-60"
            style={{
              background: `linear-gradient(90deg, ${compBalance >= 0 ? "var(--success)" : "var(--danger)"}, transparent)`,
            }}
          />
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Comp Balance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className="text-2xl font-extrabold tracking-[-0.04em]"
              style={{
                color:
                  compBalance > 0
                    ? "var(--success-text)"
                    : compBalance < 0
                      ? "var(--danger-text)"
                      : undefined,
              }}
            >
              {formatMinsAsHours(compBalance)}
            </div>
          </CardContent>
        </Card>
        <Card className="relative overflow-hidden">
          <div
            className="absolute top-0 right-0 left-0 h-0.5 opacity-60"
            style={{ background: "linear-gradient(90deg, var(--primary), transparent)" }}
          />
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Period Hours
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-extrabold tracking-[-0.04em]">
              {periodStats
                ? formatMins(periodStats.totalWorkedMins)
                : "--"}
            </div>
          </CardContent>
        </Card>
        <Card className="relative overflow-hidden">
          <div
            className="absolute top-0 right-0 left-0 h-0.5 opacity-60"
            style={{ background: "linear-gradient(90deg, var(--info), transparent)" }}
          />
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Avg Daily
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-extrabold tracking-[-0.04em]">
              {periodStats && attendance.length > 0
                ? formatMins(
                    Math.round(
                      periodStats.totalWorkedMins /
                        Math.max(
                          attendance.filter((r) => r.totalWorkedMins > 0).length,
                          1,
                        ),
                    ),
                  )
                : "--"}
            </div>
          </CardContent>
        </Card>
        <Card className="relative overflow-hidden">
          <div
            className="absolute top-0 right-0 left-0 h-0.5 opacity-60"
            style={{ background: "linear-gradient(90deg, var(--warning), transparent)" }}
          />
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Late This Period
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-extrabold tracking-[-0.04em]">
              {periodStats ? formatMins(periodStats.totalLateMins) : "--"}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="attendance">
        <TabsList variant="line">
          <TabsTrigger value="attendance">Attendance History</TabsTrigger>
          <TabsTrigger value="comp">Comp Transactions</TabsTrigger>
          <TabsTrigger value="corrections">Corrections Log</TabsTrigger>
        </TabsList>

        {/* Attendance History Tab */}
        <TabsContent value="attendance">
          <div className="mt-4 flex items-end gap-3">
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
          </div>

          <Card className="mt-4">
            <CardContent className="p-0">
              {attendance.length === 0 ? (
                <div className="flex h-24 items-center justify-center text-xs text-muted-foreground">
                  No attendance records
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Clock In</TableHead>
                        <TableHead>Clock Out</TableHead>
                        <TableHead>Eff. In</TableHead>
                        <TableHead>Eff. Out</TableHead>
                        <TableHead>Worked</TableHead>
                        <TableHead>Late</TableHead>
                        <TableHead>Ordinary</TableHead>
                        <TableHead>Nocturno</TableHead>
                        <TableHead>Festivo D</TableHead>
                        <TableHead>Festivo N</TableHead>
                        <TableHead>Excess D</TableHead>
                        <TableHead>Excess N</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {attendance.map((r) => (
                        <TableRow
                          key={r.workDate}
                          className={r.status === "absent" ? "bg-danger-bg/30" : ""}
                        >
                          <TableCell className="text-xs font-medium">
                            <span className="flex items-center gap-1.5">
                              {r.dayType === "holiday" && (
                                <span className="size-1.5 rounded-full bg-danger" />
                              )}
                              {getDayName(r.workDate)} {r.workDate.slice(5)}
                            </span>
                          </TableCell>
                          <TableCell>
                            <StatusPill status={r.status} />
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            <span className="inline-flex items-center gap-1">
                              {r.clockIn ? formatTime(r.clockIn) : "—"}
                              {r.isClockInManual && (
                                <PencilIcon className="size-2.5 text-warning" />
                              )}
                            </span>
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            <span className="inline-flex items-center gap-1">
                              {r.clockOut ? formatTime(r.clockOut) : "—"}
                              {r.isClockOutManual && (
                                <PencilIcon className="size-2.5 text-warning" />
                              )}
                            </span>
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {r.effectiveIn ? formatTime(r.effectiveIn) : "—"}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {r.effectiveOut ? formatTime(r.effectiveOut) : "—"}
                          </TableCell>
                          <TableCell className="font-mono text-xs font-semibold">
                            {formatMins(r.totalWorkedMins)}
                          </TableCell>
                          <TableCell className="text-xs">
                            {r.lateMinutes > 0 ? (
                              <span className="text-warning-text">
                                {r.lateMinutes}m
                              </span>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {formatMins(r.minsOrdinaryDay)}
                          </TableCell>
                          <MinBadge value={r.minsNocturno} type="nocturno" />
                          <MinBadge value={r.minsFestivoDay} type="festivo" />
                          <MinBadge value={r.minsFestivoNight} type="festivo" />
                          <MinBadge value={r.excessHedMins} type="warning" />
                          <MinBadge value={r.excessHenMins} type="nocturno" />
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Comp Transactions Tab */}
        <TabsContent value="comp">
          <Card className="mt-4">
            <CardContent className="p-0">
              {compTxs.length === 0 ? (
                <div className="flex h-24 items-center justify-center text-xs text-muted-foreground">
                  No comp transactions
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Minutes</TableHead>
                      <TableHead>Balance</TableHead>
                      <TableHead>Note</TableHead>
                      <TableHead>By</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {compTxs.map((tx) => (
                      <TableRow key={tx.id}>
                        <TableCell className="text-xs font-medium">
                          {formatDateMedium(tx.transactionDate)}
                        </TableCell>
                        <TableCell>
                          <CompTypeBadge type={tx.type} />
                        </TableCell>
                        <TableCell className="font-mono text-xs font-semibold">
                          {tx.minutes > 0 ? "+" : ""}
                          {tx.minutes}
                        </TableCell>
                        <TableCell
                          className="font-mono text-xs font-bold"
                          style={{
                            color:
                              tx.balanceAfter > 0
                                ? "var(--success-text)"
                                : tx.balanceAfter < 0
                                  ? "var(--danger-text)"
                                  : undefined,
                          }}
                        >
                          {formatMinsAsHours(tx.balanceAfter)}
                        </TableCell>
                        <TableCell className="max-w-48 truncate text-xs text-muted-foreground">
                          {tx.note ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {tx.createdBy}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Corrections Log Tab */}
        <TabsContent value="corrections">
          <Card className="mt-4">
            <CardContent className="p-0">
              {corrections.length === 0 ? (
                <div className="flex h-24 items-center justify-center text-xs text-muted-foreground">
                  No corrections recorded
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Old Value</TableHead>
                      <TableHead>New Value</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>By</TableHead>
                      <TableHead>When</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {corrections.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="text-xs font-medium">
                          {formatDateMedium(c.workDate)}
                        </TableCell>
                        <TableCell className="text-xs font-semibold capitalize">
                          {c.action.replace(/_/g, " ")}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {c.oldValue ? formatTime(c.oldValue) : "—"}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {formatTime(c.newValue)}
                        </TableCell>
                        <TableCell className="max-w-48 truncate text-xs text-muted-foreground">
                          {c.reason}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {c.correctedBy}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDateMedium(c.correctedAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatusPill({ status }: { status: string | null }) {
  if (!status) return <span className="text-xs text-muted-foreground">—</span>;
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

function CompTypeBadge({ type }: { type: string }) {
  const map: Record<string, { color: string; bg: string; label: string }> = {
    ot_banked: { color: "var(--success-text)", bg: "var(--success-bg)", label: "OT Banked" },
    comp_day_taken: { color: "var(--info-text)", bg: "var(--info-bg)", label: "Comp Day" },
    time_owed: { color: "var(--danger-text)", bg: "var(--danger-bg)", label: "Time Owed" },
    owed_offset: { color: "var(--warning-text)", bg: "var(--warning-bg)", label: "Offset" },
  };
  const c = map[type] ?? { color: "var(--muted-foreground)", bg: "var(--secondary)", label: type };
  return (
    <span
      className="inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ color: c.color, backgroundColor: c.bg }}
    >
      {c.label}
    </span>
  );
}

function MinBadge({
  value,
  type,
}: {
  value: number;
  type: "nocturno" | "festivo" | "warning";
}) {
  const colors = {
    nocturno: { color: "var(--nocturno-text)", bg: "var(--nocturno-bg)" },
    festivo: { color: "var(--danger-text)", bg: "var(--danger-bg)" },
    warning: { color: "var(--warning-text)", bg: "var(--warning-bg)" },
  };
  const c = colors[type];
  return (
    <TableCell className="text-xs">
      {value > 0 ? (
        <span
          className="rounded px-1.5 py-0.5 font-mono"
          style={{ color: c.color, backgroundColor: c.bg }}
        >
          {formatMins(value)}
        </span>
      ) : (
        "—"
      )}
    </TableCell>
  );
}
