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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlusIcon, TrashIcon, EyeIcon, AlertTriangleIcon, InfoIcon, ArrowRightIcon } from "lucide-react";
import Link from "next/link";
import { formatCOP, formatPeriodRange } from "@/lib/format";
import { flushCacheAction } from "@/lib/actions/flush-cache";

type AlertData = {
  missingPunches: { employeeId: number; name: string; date?: string; detail: string }[];
  activePeriod: { periodStart: string; periodEnd: string } | null;
  missingSalary?: { employeeId: number; name: string }[];
  missingSalaryCount?: number;
  missingCedulaCount?: number;
};

type MissingPunch = {
  employeeId: number;
  name: string;
  workDate: string;
  detail: string;
};

type CreateError = {
  error: string;
  missingPunches?: MissingPunch[];
} | null;

type Period = {
  periodStart: string;
  periodEnd: string;
  status: string;
  employeeCount: number;
  totalSurcharges: number;
  firstId: number;
};

export default function PayrollPage() {
  const [periods, setPeriods] = useState<Period[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newStart, setNewStart] = useState("");
  const [newEnd, setNewEnd] = useState("");
  const [newStatus, setNewStatus] = useState<"draft" | "test">("draft");
  const [creating, setCreating] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [alerts, setAlerts] = useState<AlertData | null>(null);
  const [createError, setCreateError] = useState<CreateError>(null);

  const fetchPeriods = useCallback(async () => {
    setLoading(true);
    const [periodsRes, alertsRes] = await Promise.all([
      fetch("/api/payroll"),
      fetch("/api/dashboard/alerts"),
    ]);
    if (periodsRes.ok) {
      setPeriods(await periodsRes.json());
    }
    if (alertsRes.ok) {
      setAlerts(await alertsRes.json());
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchPeriods();
  }, [fetchPeriods]);

  const handleCreate = async () => {
    if (!newStart || !newEnd) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/payroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          periodStart: newStart,
          periodEnd: newEnd,
          status: newStatus,
        }),
      });
      if (res.ok) {
        await flushCacheAction(["attendance"]);
        setCreateOpen(false);
        setNewStart("");
        setNewEnd("");
        setCreateError(null);
        fetchPeriods();
      } else {
        const data = await res.json();
        setCreateError(data);
      }
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (periodId: number) => {
    setDeleting(true);
    try {
      await fetch(`/api/payroll/${periodId}`, { method: "DELETE" });
      await flushCacheAction(["attendance"]);
      setDeleteId(null);
      fetchPeriods();
    } finally {
      setDeleting(false);
    }
  };

  const daysInPeriod = (start: string, end: string) => {
    const s = new Date(start + "T00:00:00");
    const e = new Date(end + "T00:00:00");
    return Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
  };

  const statusStyle = (status: string) => {
    const map: Record<string, { color: string; bg: string }> = {
      draft: { color: "var(--muted-foreground)", bg: "var(--secondary)" },
      finalized: { color: "var(--success-text)", bg: "var(--success-bg)" },
      exported: { color: "var(--info-text)", bg: "var(--info-bg)" },
      test: { color: "var(--warning-text)", bg: "var(--warning-bg)" },
    };
    return map[status] ?? map.draft;
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-[-0.04em]">
            Nómina
          </h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Resumen de períodos de nómina con desglose de recargos y decisiones de compensatorio.
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) setCreateError(null); }}>
          <DialogTrigger render={<Button size="sm" className="gap-1.5" />}>
            <PlusIcon className="size-4" />
            Crear período
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Crear período de nómina</DialogTitle>
              <DialogDescription>
                Esto ejecutará la conciliación para todos los empleados activos en el rango de fechas.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Inicio del período
                </label>
                <Input
                  type="date"
                  value={newStart}
                  onChange={(e) => setNewStart(e.target.value)}
                  className="text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Fin del período
                </label>
                <Input
                  type="date"
                  value={newEnd}
                  onChange={(e) => setNewEnd(e.target.value)}
                  className="text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Tipo
                </label>
                <div className="flex gap-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="periodType"
                      checked={newStatus === "draft"}
                      onChange={() => setNewStatus("draft")}
                      className="accent-primary"
                    />
                    Regular
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="periodType"
                      checked={newStatus === "test"}
                      onChange={() => setNewStatus("test")}
                      className="accent-primary"
                    />
                    Prueba
                  </label>
                </div>
              </div>
            </div>
            {createError && (
              <div className="rounded-lg border border-danger/15 bg-danger-bg p-3">
                <p className="text-[12.5px] font-bold text-danger-text">
                  {createError.error}
                </p>
                {createError.missingPunches && createError.missingPunches.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    {createError.missingPunches.map((mp, i) => (
                      <div
                        key={`${mp.employeeId}-${mp.workDate}-${i}`}
                        className="flex items-center justify-between border-t border-danger/10 pt-1.5"
                      >
                        <span className="text-[11.5px] text-danger-text">
                          {mp.name} — {mp.workDate} — {mp.detail}
                        </span>
                        <Link
                          href={`/employees/${mp.employeeId}?tab=attendance&date=${mp.workDate}&fix=${mp.detail === "Sin marcación entrada" ? "clock-in" : mp.detail === "Sin marcación salida" ? "clock-out" : "both"}`}
                        >
                          <Button
                            variant="outline"
                            size="xs"
                            className="border-danger/20 bg-white text-danger-text"
                          >
                            Corregir
                          </Button>
                        </Link>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <DialogFooter>
              <Button onClick={handleCreate} disabled={creating || !newStart || !newEnd}>
                {creating ? "Creando..." : "Crear"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Alert Banners */}
      {alerts && (alerts.missingSalaryCount ?? 0) > 0 && (
        <div className="rounded-xl border border-warning/15 bg-warning-bg p-4">
          <div className="flex items-center gap-2">
            <AlertTriangleIcon className="size-4 text-warning-text" />
            <span className="text-[13px] font-bold text-warning-text">
              {alerts.missingSalaryCount} empleado{(alerts.missingSalaryCount ?? 0) !== 1 && "s"} sin salario
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

      {(() => {
        if (!alerts?.activePeriod || alerts.missingPunches.length === 0) return null;
        const { periodStart, periodEnd } = alerts.activePeriod;
        const filtered = alerts.missingPunches.filter(
          (mp) => mp.date && mp.date >= periodStart && mp.date <= periodEnd,
        );
        if (filtered.length === 0) return null;
        return (
          <div className="rounded-xl border border-warning/15 bg-warning-bg p-4">
            <div className="mb-2 flex items-center gap-2">
              <div className="flex size-6 items-center justify-center rounded-lg bg-warning/20">
                <AlertTriangleIcon className="size-3.5 text-warning-text" />
              </div>
              <span className="text-[13px] font-bold text-warning-text">
                {filtered.length} marcación{filtered.length !== 1 ? "es faltantes" : " faltante"} en el período actual
              </span>
              <span className="ml-auto rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-semibold text-warning-text">
                {formatPeriodRange(periodStart, periodEnd)}
              </span>
            </div>
            {filtered.map((mp, i) => (
              <div
                key={`${mp.employeeId}-${mp.date}-${i}`}
                className="flex items-center justify-between border-t border-warning/15 py-2"
              >
                <span className="text-[12.5px] font-medium text-warning-text">
                  {mp.name} — {mp.date} — {mp.detail}
                </span>
                <Link
                  href={`/employees/${mp.employeeId}?tab=attendance&date=${mp.date}&fix=${mp.detail === "Sin marcación entrada" ? "clock-in" : mp.detail === "Sin marcación salida" ? "clock-out" : "both"}`}
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
        );
      })()}

      {alerts && (alerts.missingCedulaCount ?? 0) > 0 && (
        <div className="rounded-xl border border-foreground/5 bg-secondary/50 p-4">
          <div className="flex items-center gap-2">
            <InfoIcon className="size-4 text-muted-foreground" />
            <span className="text-[13px] font-medium text-muted-foreground">
              {alerts.missingCedulaCount} empleado{(alerts.missingCedulaCount ?? 0) !== 1 && "s"} sin cédula
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

      {/* Period List */}
      <Card>
        <CardHeader className="border-b px-5 py-3.5">
          <CardTitle className="text-sm font-bold tracking-[-0.01em]">
            Períodos de nómina
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              ({periods.length})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
              Cargando...
            </div>
          ) : periods.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
              No hay períodos de nómina creados.
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCreateOpen(true)}
              >
                Crear período
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Período</TableHead>
                  <TableHead className="w-16">Días</TableHead>
                  <TableHead className="w-24">Empleados</TableHead>
                  <TableHead className="w-24">Estado</TableHead>
                  <TableHead className="w-32">Total recargos</TableHead>
                  <TableHead className="w-28">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {periods.map((p) => {
                  const ss = statusStyle(p.status);
                  return (
                    <TableRow key={`${p.periodStart}-${p.periodEnd}`}>
                      <TableCell className="text-[13px] font-semibold">
                        {formatPeriodRange(p.periodStart, p.periodEnd)}
                      </TableCell>
                      <TableCell className="text-xs">
                        {daysInPeriod(p.periodStart, p.periodEnd)}
                      </TableCell>
                      <TableCell className="text-xs">
                        {p.employeeCount}
                      </TableCell>
                      <TableCell>
                        <span
                          className="inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize"
                          style={{ color: ss.color, backgroundColor: ss.bg }}
                        >
                          {p.status}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-xs font-semibold">
                        {formatCOP(p.totalSurcharges)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Link href={`/payroll/${p.firstId}`}>
                            <Button variant="ghost" size="icon-xs">
                              <EyeIcon className="size-3.5" />
                            </Button>
                          </Link>
                          {(p.status === "draft" || p.status === "test") && (
                            <Dialog
                              open={deleteId === p.firstId}
                              onOpenChange={(open) =>
                                setDeleteId(open ? p.firstId : null)
                              }
                            >
                              <DialogTrigger
                                render={
                                  <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    className="text-danger hover:text-danger"
                                  />
                                }
                              >
                                <TrashIcon className="size-3.5" />
                              </DialogTrigger>
                              <DialogContent>
                                <DialogHeader>
                                  <DialogTitle>Eliminar período</DialogTitle>
                                  <DialogDescription>
                                    Esto eliminará todos los registros de nómina de{" "}
                                    {formatPeriodRange(p.periodStart, p.periodEnd)}.
                                    Las transacciones compensatorias serán revertidas.
                                  </DialogDescription>
                                </DialogHeader>
                                <DialogFooter>
                                  <Button
                                    variant="outline"
                                    onClick={() => setDeleteId(null)}
                                  >
                                    Cancelar
                                  </Button>
                                  <Button
                                    variant="destructive"
                                    onClick={() => handleDelete(p.firstId)}
                                    disabled={deleting}
                                  >
                                    {deleting ? "Eliminando..." : "Eliminar"}
                                  </Button>
                                </DialogFooter>
                              </DialogContent>
                            </Dialog>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
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
