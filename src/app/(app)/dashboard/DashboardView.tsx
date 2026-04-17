"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
  AlertTriangleIcon,
  CheckIcon,
  PencilIcon,
  TrendingUpIcon,
  TrendingDownIcon,
  RefreshCwIcon,
  InfoIcon,
  ArrowRightIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  formatMins,
  formatMinsAsHours,
  formatTime,
  formatDateFull,
  formatPeriodRange,
} from "@/lib/format";
import { COL_TZ } from "@/lib/timezone";
import type {
  TodayData,
  TodayAttendanceRow,
  CompBalanceRow,
  PeriodTrackerData,
  DashboardAlerts,
} from "@/lib/dashboard/queries";

const GROUP_COLORS: Record<string, string> = {
  Kitchen: "var(--group-kitchen)",
  Servers: "var(--group-servers)",
  Bar: "var(--group-bar)",
  Admin: "var(--group-admin)",
};

const REFRESH_INTERVAL_MS = 60_000;

type Props = {
  today: TodayData;
  periodData: PeriodTrackerData;
  compBalances: CompBalanceRow[];
  alerts: DashboardAlerts;
};

export default function DashboardView({
  today,
  periodData,
  compBalances,
  alerts,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [activeGroup, setActiveGroup] = useState("all");
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const id = setInterval(() => {
      startTransition(() => router.refresh());
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [router]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await fetch("/api/biotime/sync", { method: "POST" });
      startTransition(() => router.refresh());
    } finally {
      setSyncing(false);
    }
  };

  const { kpis, attendance, date: dateStr } = today;

  const filtered =
    activeGroup === "all"
      ? attendance
      : attendance.filter((r) => r.groupName === activeGroup);

  const groups = [
    ...new Set(attendance.map((r) => r.groupName).filter(Boolean)),
  ] as string[];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-[-0.04em]">
            Panel
          </h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {formatDateFull(dateStr)}
            {alerts.activePeriod &&
              ` — Período: ${formatPeriodRange(alerts.activePeriod.periodStart, alerts.activePeriod.periodEnd)}`}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleSync}
          disabled={syncing}
          className="gap-1.5"
        >
          <RefreshCwIcon className={`size-3.5 ${syncing ? "animate-spin" : ""}`} />
          Sincronizar
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            label: "Presentes hoy",
            value: String(kpis.present),
            sub: `de ${kpis.totalEmployees} empleados`,
            trend: kpis.trends.present,
            accent: "var(--primary)",
          },
          {
            label: "A tiempo",
            value: `${kpis.onTimePercent}%`,
            sub: `${kpis.onTime} empleados`,
            trend: kpis.trends.onTimePercent,
            accent: "var(--success)",
          },
          {
            label: "Llegadas tarde",
            value: String(kpis.late),
            sub: "hoy",
            trend: -kpis.trends.late,
            accent: "var(--warning)",
          },
          {
            label: "Marcaciones faltantes",
            value: String(kpis.missingPunch),
            sub: "requieren atención",
            trend: 0,
            accent: "var(--nocturno)",
          },
        ].map((kpi) => (
          <Card key={kpi.label} className="relative overflow-hidden">
            <div
              className="absolute top-0 right-0 left-0 h-0.5 opacity-60"
              style={{
                background: `linear-gradient(90deg, ${kpi.accent}, transparent)`,
              }}
            />
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                {kpi.label}
                {kpi.trend !== 0 && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold"
                    style={{
                      color: kpi.trend > 0 ? "var(--success-text)" : "var(--danger-text)",
                      background: kpi.trend > 0 ? "var(--success-bg)" : "var(--danger-bg)",
                    }}
                  >
                    {kpi.trend > 0 ? (
                      <TrendingUpIcon className="size-3" />
                    ) : (
                      <TrendingDownIcon className="size-3" />
                    )}
                    {kpi.trend > 0 ? "+" : ""}
                    {kpi.trend}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-[32px] font-extrabold tracking-[-0.04em]">
                {kpi.value}
              </div>
              <p className="text-xs text-muted-foreground/70">{kpi.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Alert Banners */}
      {alerts.missingPunches.length > 0 && (
        <div className="rounded-xl border border-warning/15 bg-warning-bg p-4">
          <div className="mb-2 flex items-center gap-2">
            <div className="flex size-6 items-center justify-center rounded-lg bg-warning/20">
              <AlertTriangleIcon className="size-3.5 text-warning-text" />
            </div>
            <span className="text-[13px] font-bold text-warning-text">
              Marcaciones faltantes
            </span>
            <span className="ml-auto rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-semibold text-warning-text">
              {alerts.missingPunches.length}
            </span>
          </div>
          {alerts.missingPunches.map((mp) => (
            <div
              key={mp.employeeId}
              className="flex items-center justify-between border-t border-warning/15 py-2"
            >
              <span className="text-[12.5px] font-medium text-warning-text">
                {mp.name} — {mp.detail}
              </span>
              <Link
                href={`/employees/${mp.employeeId}?tab=attendance&date=${mp.date}&fix=${mp.detail === "no clock-in" ? "clock-in" : mp.detail === "no clock-out" ? "clock-out" : "both"}`}
              >
                <Button
                  variant="outline"
                  size="xs"
                  className="border-warning/20 bg-white text-warning-text"
                >
                  Corregir
                </Button>
              </Link>
            </div>
          ))}
        </div>
      )}

      {alerts.overduePeriods.length > 0 && (
        <div className="rounded-xl border border-danger/15 bg-danger-bg p-4">
          <div className="flex items-center gap-2">
            <AlertTriangleIcon className="size-4 text-danger-text" />
            <span className="text-[13px] font-bold text-danger-text">
              Período{" "}
              {formatPeriodRange(
                alerts.overduePeriods[0].periodStart,
                alerts.overduePeriods[0].periodEnd,
              )}{" "}
              ha terminado y no está finalizado.
            </span>
            <Link href="/payroll" className="ml-auto">
              <Button variant="outline" size="xs" className="border-danger/20 bg-white text-danger-text">
                Ir a Nómina <ArrowRightIcon className="ml-1 size-3" />
              </Button>
            </Link>
          </div>
        </div>
      )}

      {!alerts.hasActivePeriod && (
        <div className="rounded-xl border border-info/15 bg-info-bg p-4">
          <div className="flex items-center gap-2">
            <InfoIcon className="size-4 text-info-text" />
            <span className="text-[13px] font-bold text-info-text">
              No hay período de nómina activo.
            </span>
            <Link href="/payroll" className="ml-auto">
              <Button variant="outline" size="xs" className="border-info/20 bg-white text-info-text">
                Crear período <ArrowRightIcon className="ml-1 size-3" />
              </Button>
            </Link>
          </div>
        </div>
      )}

      {alerts.missingSalaryCount > 0 && (
        <div className="rounded-xl border border-warning/15 bg-warning-bg p-4">
          <div className="flex items-center gap-2">
            <AlertTriangleIcon className="size-4 text-warning-text" />
            <span className="text-[13px] font-bold text-warning-text">
              {alerts.missingSalaryCount}{" "}
              {alerts.missingSalaryCount !== 1 ? "empleados" : "empleado"} sin salario
            </span>
            <span className="text-[11px] text-warning-text/70">
              — no se pueden calcular costos
            </span>
            <Link href="/employees" className="ml-auto">
              <Button variant="outline" size="xs" className="border-warning/20 bg-white text-warning-text">
                Editar empleados <ArrowRightIcon className="ml-1 size-3" />
              </Button>
            </Link>
          </div>
        </div>
      )}

      {alerts.missingCedulaCount > 0 && (
        <div className="rounded-xl border border-foreground/5 bg-secondary/50 p-4">
          <div className="flex items-center gap-2">
            <InfoIcon className="size-4 text-muted-foreground" />
            <span className="text-[13px] font-medium text-muted-foreground">
              {alerts.missingCedulaCount}{" "}
              {alerts.missingCedulaCount !== 1 ? "empleados" : "empleado"} sin cédula
            </span>
            <span className="text-[11px] text-muted-foreground/70">
              — La exportación Siigo será bloqueada
            </span>
            <Link href="/employees" className="ml-auto">
              <Button variant="outline" size="xs" className="text-muted-foreground">
                Editar <ArrowRightIcon className="ml-1 size-3" />
              </Button>
            </Link>
          </div>
        </div>
      )}

      {alerts.syncStale && (
        <div className="rounded-xl border border-warning/15 bg-warning-bg p-4">
          <div className="flex items-center gap-2">
            <AlertTriangleIcon className="size-4 text-warning-text" />
            <span className="text-[13px] font-bold text-warning-text">
              Sincronización BioTime desactualizada
            </span>
            <span className="text-[11px] text-warning-text/70">
              — última sincronización{" "}
              {alerts.lastSyncTime
                ? new Date(alerts.lastSyncTime).toLocaleTimeString("es-CO", {
                    timeZone: COL_TZ,
                  })
                : "nunca"}
            </span>
            <Button
              variant="outline"
              size="xs"
              className="ml-auto border-warning/20 bg-white text-warning-text"
              onClick={handleSync}
              disabled={syncing}
            >
              Sincronizar
            </Button>
          </div>
        </div>
      )}

      {/* Group Filter Tabs */}
      <div className="flex items-center gap-1 rounded-lg bg-card p-1 shadow-sm ring-1 ring-foreground/5 w-fit">
        <button
          onClick={() => setActiveGroup("all")}
          className={`rounded-md px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
            activeGroup === "all"
              ? "bg-secondary text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Todos
        </button>
        {groups.map((g) => (
          <button
            key={g}
            onClick={() => setActiveGroup(g)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
              activeGroup === g
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
            style={
              activeGroup === g
                ? {
                    backgroundColor: `color-mix(in srgb, ${GROUP_COLORS[g] ?? "gray"} 10%, transparent)`,
                  }
                : undefined
            }
          >
            <span
              className="size-1.5 rounded-full"
              style={{ backgroundColor: GROUP_COLORS[g] }}
            />
            {g}
          </button>
        ))}
      </div>

      {/* Today's Attendance Table */}
      <Card>
        <CardHeader className="border-b px-5 py-3.5">
          <CardTitle className="flex items-center justify-between text-sm font-bold tracking-[-0.01em]">
            Marcaciones de hoy
            <span className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
              {`${kpis.present}/${kpis.totalEmployees} presentes`}
              {kpis.totalEmployees > 0 && (
                <div className="h-1 w-14 overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{
                      width: `${Math.round((kpis.present / kpis.totalEmployees) * 100)}%`,
                    }}
                  />
                </div>
              )}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
              Sin datos de marcación para hoy
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Empleado</TableHead>
                  <TableHead className="w-24">Grupo</TableHead>
                  <TableHead className="w-24">Entrada</TableHead>
                  <TableHead className="w-24">Salida</TableHead>
                  <TableHead className="w-20">Trabajado</TableHead>
                  <TableHead className="w-20">Tardanza</TableHead>
                  <TableHead className="w-20">Exceso</TableHead>
                  <TableHead className="w-24">Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) => (
                  <AttendanceRow key={row.id} row={row} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Period Tracker + Comp Balances */}
      <div className="grid gap-3 lg:grid-cols-2">
        {/* Period Hours */}
        <Card>
          <CardHeader className="border-b px-5 py-3.5">
            <CardTitle className="flex items-center justify-between text-sm font-bold tracking-[-0.01em]">
              Horas del período
              {periodData.period && (
                <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
                  {formatPeriodRange(
                    periodData.period.periodStart,
                    periodData.period.periodEnd,
                  )}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5">
            {!periodData.period ? (
              <div className="flex h-20 items-center justify-center text-xs text-muted-foreground">
                Sin período activo
              </div>
            ) : periodData.employees.length === 0 ? (
              <div className="flex h-20 items-center justify-center text-xs text-muted-foreground">
                Sin datos de empleados
              </div>
            ) : (
              <div className="space-y-3">
                {periodData.employees.map((emp) => {
                  const expectedH = Math.round(emp.totalExpectedMins / 60);
                  const actualH = Math.round(emp.totalWorkedMins / 60);
                  const pct =
                    emp.totalExpectedMins > 0
                      ? Math.min(
                          (emp.totalWorkedMins / emp.totalExpectedMins) * 100,
                          110,
                        )
                      : 0;
                  const isOver = emp.totalWorkedMins > emp.totalExpectedMins;
                  return (
                    <div key={emp.id}>
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="font-medium text-secondary-foreground">
                          {emp.firstName} {emp.lastName.charAt(0)}.
                        </span>
                        <span className="font-mono text-[11.5px] font-semibold">
                          <span className={isOver ? "text-warning-text" : ""}>
                            {actualH}h
                          </span>
                          <span className="font-normal text-muted-foreground">
                            {" "}
                            / {expectedH}h
                          </span>
                        </span>
                      </div>
                      <div className="h-1 overflow-hidden rounded-full bg-secondary">
                        <div
                          className="h-full rounded-full transition-all duration-300"
                          style={{
                            width: `${Math.min(pct, 100)}%`,
                            backgroundColor: isOver
                              ? "var(--warning)"
                              : "var(--primary)",
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
                <Link
                  href="/payroll"
                  className="mt-2 inline-flex items-center text-xs font-semibold text-primary hover:underline"
                >
                  Ver nómina <ArrowRightIcon className="ml-1 size-3" />
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Comp Balances */}
        <Card>
          <CardHeader className="border-b px-5 py-3.5">
            <CardTitle className="text-sm font-bold tracking-[-0.01em]">
              Saldos de tiempo compensatorio
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5">
            {compBalances.length === 0 ? (
              <div className="flex h-20 items-center justify-center text-xs text-muted-foreground">
                Sin datos de compensatorio
              </div>
            ) : (
              <div className="space-y-0">
                {compBalances.map((emp, i) => (
                  <div
                    key={emp.id}
                    className={`flex items-center justify-between py-2 ${i > 0 ? "border-t border-foreground/5" : ""}`}
                  >
                    <Link
                      href={`/employees/${emp.id}`}
                      className="text-[12.5px] font-medium text-secondary-foreground hover:text-foreground"
                    >
                      {emp.firstName} {emp.lastName.charAt(0)}.
                    </Link>
                    <span
                      className="rounded-full px-2.5 py-0.5 font-mono text-[13px] font-bold"
                      style={{
                        color:
                          emp.compBalance > 0
                            ? "var(--success-text)"
                            : emp.compBalance < 0
                              ? "var(--danger-text)"
                              : "var(--muted-foreground)",
                        backgroundColor:
                          emp.compBalance > 0
                            ? "var(--success-bg)"
                            : emp.compBalance < 0
                              ? "var(--danger-bg)"
                              : "transparent",
                        border:
                          emp.compBalance !== 0
                            ? `1px solid ${emp.compBalance > 0 ? "var(--success)" : "var(--danger)"}15`
                            : "none",
                      }}
                    >
                      {formatMinsAsHours(emp.compBalance)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function AttendanceRow({ row }: { row: TodayAttendanceRow }) {
  const gc = row.groupName ? GROUP_COLORS[row.groupName] : undefined;
  const excess = (row.excessHedMins ?? 0) + (row.excessHenMins ?? 0);
  return (
    <TableRow className={row.isMissingPunch ? "border-l-2 border-l-warning" : ""}>
      <TableCell>
        <Link
          href={`/employees/${row.id}`}
          className="flex items-center gap-2.5"
        >
          <div
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-[11.5px] font-bold"
            style={{
              backgroundColor: gc
                ? `color-mix(in srgb, ${gc} 10%, transparent)`
                : "var(--secondary)",
              color: gc ?? "var(--foreground)",
            }}
          >
            {row.firstName[0]}
            {row.lastName[0]}
          </div>
          <div>
            <div className="text-[13px] font-semibold tracking-[-0.01em]">
              {row.firstName} {row.lastName}
            </div>
            <div className="text-[11px] text-muted-foreground">
              #{row.empCode}
            </div>
          </div>
        </Link>
      </TableCell>
      <TableCell>
        {row.groupName && gc ? (
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
            style={{
              backgroundColor: `color-mix(in srgb, ${gc} 10%, transparent)`,
              color: gc,
            }}
          >
            <span
              className="size-1.5 rounded-full"
              style={{ backgroundColor: gc }}
            />
            {row.groupName}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="font-mono text-[13px] font-medium text-secondary-foreground">
        <span className="inline-flex items-center gap-1">
          {row.clockIn ? formatTime(row.clockIn) : "—"}
          {row.isClockInManual && <PencilIcon className="size-3 text-warning" />}
        </span>
      </TableCell>
      <TableCell className="font-mono text-[13px] font-medium text-secondary-foreground">
        <span className="inline-flex items-center gap-1">
          {row.clockOut ? formatTime(row.clockOut) : "—"}
          {row.isClockOutManual && <PencilIcon className="size-3 text-warning" />}
        </span>
      </TableCell>
      <TableCell className="font-mono text-[13px] font-semibold">
        {row.totalWorkedMins ? formatMins(row.totalWorkedMins) : "—"}
      </TableCell>
      <TableCell>
        {(row.lateMinutes ?? 0) > 0 ? (
          <span className="inline-block rounded-full border border-warning/15 bg-warning-bg px-2 py-0.5 text-[11px] font-semibold text-warning-text">
            {row.lateMinutes} min
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell>
        {excess > 0 ? (
          <span className="inline-block rounded-full border border-nocturno/15 bg-nocturno-bg px-2 py-0.5 text-[11px] font-semibold text-nocturno-text">
            +{formatMins(excess)}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell>
        <StatusBadge status={row.status} />
      </TableCell>
    </TableRow>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-xs text-muted-foreground">—</span>;

  const config: Record<
    string,
    { color: string; bg: string; icon?: React.ReactNode; label: string }
  > = {
    "on-time": {
      color: "var(--success-text)",
      bg: "var(--success-bg)",
      icon: <CheckIcon className="size-3" />,
      label: "A tiempo",
    },
    late: {
      color: "var(--warning-text)",
      bg: "var(--warning-bg)",
      icon: <AlertTriangleIcon className="size-3" />,
      label: "Tarde",
    },
    absent: {
      color: "var(--danger-text)",
      bg: "var(--danger-bg)",
      label: "Ausente",
    },
    "day-off": {
      color: "var(--muted-foreground)",
      bg: "var(--secondary)",
      label: "Descanso",
    },
    "comp-day-off": {
      color: "var(--info-text)",
      bg: "var(--info-bg)",
      label: "COMP",
    },
  };

  const c = config[status] ?? {
    color: "var(--muted-foreground)",
    bg: "var(--secondary)",
    label: status,
  };

  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-semibold"
      style={{ color: c.color }}
    >
      {c.icon}
      {c.label}
    </span>
  );
}
