"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ChevronDownIcon, ChevronRightIcon, PencilIcon, RefreshCwIcon } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { formatMins, formatTime, getDayName } from "@/lib/format";
import type {
  EmployeeSummaryRow,
  DailyRecord,
  GroupRow,
} from "@/lib/attendance/queries";
import { recalcAttendanceAction } from "./actions";

const GROUP_COLORS: Record<string, string> = {
  Kitchen: "var(--group-kitchen)",
  Servers: "var(--group-servers)",
  Bar: "var(--group-bar)",
  Admin: "var(--group-admin)",
};

type Props = {
  startDate: string;
  endDate: string;
  groupId: string;
  groups: GroupRow[];
  employees: EmployeeSummaryRow[];
  recordsByEmployee: Record<number, DailyRecord[]>;
};

export default function AttendanceView({
  startDate,
  endDate,
  groupId,
  groups,
  employees,
  recordsByEmployee,
}: Props) {
  const filteredEmployees =
    groupId === "all"
      ? employees
      : groupId === "unassigned"
        ? employees.filter((e) => !e.groupId)
        : employees.filter((e) => e.groupId === Number(groupId));

  const summary = {
    totalWorkedMins: filteredEmployees.reduce((s, r) => s + r.totalWorkedMins, 0),
    totalLateMins: filteredEmployees.reduce((s, r) => s + r.totalLateMins, 0),
    totalExcessMins: filteredEmployees.reduce((s, r) => s + r.totalExcessMins, 0),
  };

  const unassignedCount = employees.filter((e) => !e.groupId).length;
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [recalcing, setRecalcing] = useState(false);
  const [recalcMessage, setRecalcMessage] = useState<
    { kind: "success" | "error"; text: string } | null
  >(null);

  async function handleRecalculate() {
    setRecalcing(true);
    setRecalcMessage(null);
    try {
      const result = await recalcAttendanceAction(startDate, endDate);
      if ("error" in result) {
        setRecalcMessage({ kind: "error", text: result.error });
        return;
      }
      setRecalcMessage({
        kind: "success",
        text: `Recalculados ${result.processed} días`,
      });
      startTransition(() => router.refresh());
    } catch (err) {
      setRecalcMessage({
        kind: "error",
        text: err instanceof Error ? err.message : "Error recalculando",
      });
    } finally {
      setRecalcing(false);
    }
  }

  function updateFilter(next: { startDate?: string; endDate?: string; groupId?: string }) {
    const params = new URLSearchParams();
    const s = next.startDate ?? startDate;
    const e = next.endDate ?? endDate;
    const g = next.groupId ?? groupId;
    params.set("startDate", s);
    params.set("endDate", e);
    if (g !== "all") params.set("groupId", g);
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  }

  const toggleExpand = (empId: number) => {
    setExpandedId((current) => (current === empId ? null : empId));
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-[22px] font-extrabold tracking-[-0.04em]">
          Registro de marcaciones
        </h1>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          Registros diarios de marcación con detalles de entrada/salida y clasificación de recargos.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
            Inicio
          </label>
          <Input
            type="date"
            value={startDate}
            onChange={(e) => updateFilter({ startDate: e.target.value })}
            className="h-9 w-40 text-xs"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
            Fin
          </label>
          <Input
            type="date"
            value={endDate}
            onChange={(e) => updateFilter({ endDate: e.target.value })}
            className="h-9 w-40 text-xs"
          />
        </div>
        <div className="ml-auto flex items-center gap-3">
          {recalcMessage && (
            <span
              className={`text-[11px] font-medium ${
                recalcMessage.kind === "success"
                  ? "text-success"
                  : "text-danger"
              }`}
            >
              {recalcMessage.text}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleRecalculate}
            disabled={recalcing || pending}
            className="h-9"
          >
            <RefreshCwIcon
              className={`size-3.5 ${recalcing ? "animate-spin" : ""}`}
            />
            {recalcing ? "Recalculando..." : "Recalcular"}
          </Button>
        </div>
      </div>

      {/* Group filter tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto">
        <FilterTab
          label="Todos"
          count={employees.length}
          active={groupId === "all"}
          onClick={() => updateFilter({ groupId: "all" })}
        />
        {groups.map((g) => (
          <FilterTab
            key={g.id}
            label={g.name}
            count={employees.filter((e) => e.groupId === g.id).length}
            color={GROUP_COLORS[g.name]}
            active={groupId === String(g.id)}
            onClick={() => updateFilter({ groupId: String(g.id) })}
          />
        ))}
        <FilterTab
          label="Sin asignar"
          count={unassignedCount}
          active={groupId === "unassigned"}
          onClick={() => updateFilter({ groupId: "unassigned" })}
        />
      </div>

      {/* Summary Cards */}
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          {
            label: "Total horas trabajadas",
            value: formatMins(summary.totalWorkedMins),
            accent: "var(--primary)",
          },
          {
            label: "Total minutos tarde",
            value: formatMins(summary.totalLateMins),
            accent: "var(--warning)",
          },
          {
            label: "Total horas extra",
            value: formatMins(summary.totalExcessMins),
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
      <Card className={pending ? "opacity-60 transition-opacity" : "transition-opacity"}>
        <CardHeader className="border-b px-5 py-3.5">
          <CardTitle className="text-sm font-bold tracking-[-0.01em]">
            Marcaciones por empleado
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              ({filteredEmployees.length})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {filteredEmployees.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
              Sin registros de marcación para este rango de fechas
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Empleado</TableHead>
                  <TableHead className="w-20">Días</TableHead>
                  <TableHead className="w-24">Total horas</TableHead>
                  <TableHead className="w-20">Prom/Día</TableHead>
                  <TableHead className="w-20">Tardanza</TableHead>
                  <TableHead className="w-20">Exceso</TableHead>
                  <TableHead className="w-20">Nocturno</TableHead>
                  <TableHead className="w-20">Festivo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEmployees.map((emp) => {
                  const isExpanded = expandedId === emp.employeeId;
                  const gc = emp.groupName
                    ? GROUP_COLORS[emp.groupName]
                    : undefined;
                  const avgPerDay =
                    emp.daysPresent > 0
                      ? Math.round(emp.totalWorkedMins / emp.daysPresent)
                      : 0;
                  const records = recordsByEmployee[emp.employeeId] ?? [];
                  return (
                    <Fragment key={emp.employeeId}>
                      <TableRow
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
                        <TableRow>
                          <TableCell colSpan={9} className="bg-muted/30 p-0">
                            <DailyBreakdown records={records} />
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
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
        Sin registros
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-foreground/5">
            {[
              "Fecha",
              "Estado",
              "Entrada",
              "Salida",
              "Efec. In",
              "Efec. Out",
              "Trabajado",
              "Tardanza",
              "Ordinario",
              "Nocturno",
              "Festivo D",
              "Festivo N",
              "Extra D",
              "Extra N",
            ].map((h) => (
              <th
                key={h}
                className="px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
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
              <td className="px-3 py-3 font-medium">
                <span className="flex items-center gap-1.5">
                  {r.dayType === "holiday" && (
                    <span className="size-1.5 rounded-full bg-danger" />
                  )}
                  {getDayName(r.workDate)} {r.workDate.slice(5)}
                </span>
              </td>
              <td className="px-3 py-3">
                <DayStatusBadge status={r.status} />
              </td>
              <td className="relative px-3 py-3 font-mono">
                <span className="inline-flex items-center gap-1">
                  {r.clockIn ? formatTime(r.clockIn) : "—"}
                  {r.isClockInManual && (
                    <PencilIcon className="size-2.5 text-warning" />
                  )}
                </span>
                {r.scheduledStart && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger className="absolute bottom-1 left-3 cursor-default text-[10px] leading-tight text-muted-foreground/70">
                        {formatShiftTime(r.scheduledStart)}
                      </TooltipTrigger>
                      <TooltipContent side="bottom">Inicio programado</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </td>
              <td className="relative px-3 py-3 font-mono">
                <span className="inline-flex items-center gap-1">
                  {r.clockOut ? formatTime(r.clockOut) : "—"}
                  {r.isClockOutManual && (
                    <PencilIcon className="size-2.5 text-warning" />
                  )}
                </span>
                {r.scheduledEnd && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger className="absolute bottom-1 left-3 cursor-default text-[10px] leading-tight text-muted-foreground/70">
                        {formatShiftTime(r.scheduledEnd)}
                      </TooltipTrigger>
                      <TooltipContent side="bottom">Fin programado</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </td>
              <td className="px-3 py-3 font-mono text-muted-foreground">
                {r.effectiveIn ? formatTime(r.effectiveIn) : "—"}
              </td>
              <td className="px-3 py-3 font-mono text-muted-foreground">
                {r.effectiveOut ? formatTime(r.effectiveOut) : "—"}
              </td>
              <td className="px-3 py-3 font-mono font-semibold">
                {formatMins(r.totalWorkedMins)}
              </td>
              <td className="px-3 py-3">
                {r.lateMinutes > 0 ? (
                  <span className="text-warning-text">{r.lateMinutes}m</span>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-3 py-3 font-mono">{formatMins(r.minsOrdinaryDay)}</td>
              <td className="px-3 py-3">
                {r.minsNocturno > 0 ? (
                  <span className="rounded bg-nocturno-bg px-1.5 py-0.5 font-mono text-nocturno-text">
                    {formatMins(r.minsNocturno)}
                  </span>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-3 py-3">
                {r.minsFestivoDay > 0 ? (
                  <span className="rounded bg-danger-bg px-1.5 py-0.5 font-mono text-danger-text">
                    {formatMins(r.minsFestivoDay)}
                  </span>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-3 py-3">
                {r.minsFestivoNight > 0 ? (
                  <span className="rounded bg-danger-bg px-1.5 py-0.5 font-mono text-danger-text">
                    {formatMins(r.minsFestivoNight)}
                  </span>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-3 py-3">
                {r.excessHedMins > 0 ? (
                  <span className="rounded bg-warning-bg px-1.5 py-0.5 font-mono text-warning-text">
                    {formatMins(r.excessHedMins)}
                  </span>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-3 py-3">
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
    "on-time": { color: "var(--success-text)", bg: "var(--success-bg)", label: "A tiempo" },
    late: { color: "var(--warning-text)", bg: "var(--warning-bg)", label: "Tarde" },
    absent: { color: "var(--danger-text)", bg: "var(--danger-bg)", label: "Ausente" },
    "day-off": { color: "var(--muted-foreground)", bg: "var(--secondary)", label: "Descanso" },
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

function formatShiftTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function FilterTab({
  label,
  count,
  color,
  active,
  onClick,
}: {
  label: string;
  count: number;
  color?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors ${
        active
          ? "bg-foreground text-background"
          : "bg-card text-muted-foreground shadow-sm hover:text-foreground"
      }`}
    >
      {color && !active && (
        <span
          className="size-2 rounded-full"
          style={{ backgroundColor: color }}
        />
      )}
      {label}
      <span
        className={`text-[11px] ${active ? "text-background/60" : "text-muted-foreground/60"}`}
      >
        {count}
      </span>
    </button>
  );
}
