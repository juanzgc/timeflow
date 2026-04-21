"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
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
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  ArrowLeftIcon,
  DownloadIcon,
  FileSpreadsheetIcon,
  LockIcon,
  PackageIcon,
  RefreshCwIcon,
} from "lucide-react";
import Link from "next/link";
import { formatMins, formatCOP, formatPeriodRange, formatMinsAsHours } from "@/lib/format";
import { flushCacheAction } from "@/lib/actions/flush-cache";

const GROUP_COLORS: Record<string, string> = {
  Kitchen: "var(--group-kitchen)",
  Servers: "var(--group-servers)",
  Bar: "var(--group-bar)",
  Admin: "var(--group-admin)",
};

type PeriodRecord = {
  id: number;
  employeeId: number;
  firstName: string;
  lastName: string;
  empCode: string;
  groupName: string | null;
  totalExpectedMins: number;
  totalWorkedMins: number;
  totalLateMins: number;
  totalEarlyLeaveMins: number;
  rnMins: number;
  rnCost: string;
  rfMins: number;
  rfCost: string;
  rfnMins: number;
  rfnCost: string;
  overtimeOwedMins: number;
  owedOffsetMins: number;
  otBankedMins: number;
  hedMins: number;
  hedCost: string;
  henMins: number;
  henCost: string;
  totalRecargosCost: string;
  totalExtrasCost: string;
  totalSurcharges: string;
  compBalanceStart: number;
  compBalanceEnd: number;
  poolHedMins: number;
  poolHenMins: number;
  status: string;
  horaOrdinariaValue: string | null;
};

type BankDecision = Record<number, number>; // employeeId -> bankMins

export default function PeriodDetailPage() {
  const params = useParams();
  const periodId = params.periodId as string;

  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [status, setStatus] = useState("");
  const [records, setRecords] = useState<PeriodRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [bankDecisions, setBankDecisions] = useState<BankDecision>({});
  const [saving, setSaving] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeError, setFinalizeError] = useState<{
    message: string;
    missingPunches?: { employee: string; date: string; detail: string }[];
  } | null>(null);

  const fetchPeriod = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/payroll/${periodId}`);
    if (res.ok) {
      const data = await res.json();
      setPeriodStart(data.periodStart);
      setPeriodEnd(data.periodEnd);
      setStatus(data.status);
      setRecords(data.records);
      // Initialize bank decisions from existing data
      const decisions: BankDecision = {};
      for (const r of data.records) {
        decisions[r.employeeId] = r.otBankedMins;
      }
      setBankDecisions(decisions);
    }
    setLoading(false);
  }, [periodId]);

  useEffect(() => {
    fetchPeriod();
  }, [fetchPeriod]);

  // Derived calculations with live bank adjustments
  const enrichedRecords = useMemo(() => {
    return records.map((r) => {
      const otAvailable = Math.max(r.overtimeOwedMins - r.owedOffsetMins, 0);
      const bankMins = Math.min(bankDecisions[r.employeeId] ?? 0, otAvailable);
      const otPaid = otAvailable - bankMins;

      // Proportional HED/HEN split from pool
      const poolTotal = r.poolHedMins + r.poolHenMins;
      let hedMins = 0;
      let henMins = 0;
      if (poolTotal > 0 && otPaid > 0) {
        hedMins = Math.min(Math.round((r.poolHedMins / poolTotal) * otPaid), otPaid);
        henMins = otPaid - hedMins;
      }

      const horaOrdinaria = r.horaOrdinariaValue ? Number(r.horaOrdinariaValue) : 0;
      const hedCost = hedMins * horaOrdinaria * 1.25 / 60;
      const henCost = henMins * horaOrdinaria * 1.75 / 60;
      const totalExtrasCost = hedCost + henCost;
      const totalRecargosCost = Number(r.totalRecargosCost);
      const totalSurcharges = totalRecargosCost + totalExtrasCost;

      return {
        ...r,
        otAvailable,
        bankMins,
        otPaid,
        liveHedMins: hedMins,
        liveHenMins: henMins,
        liveHedCost: hedCost,
        liveHenCost: henCost,
        liveTotalExtrasCost: totalExtrasCost,
        liveTotalSurcharges: totalSurcharges,
      };
    });
  }, [records, bankDecisions]);

  // Summary totals
  const totals = useMemo(() => {
    return enrichedRecords.reduce(
      (acc, r) => ({
        totalExpectedMins: acc.totalExpectedMins + r.totalExpectedMins,
        totalWorkedMins: acc.totalWorkedMins + r.totalWorkedMins,
        overtimeOwedMins: acc.overtimeOwedMins + r.overtimeOwedMins,
        totalRecargosCost: acc.totalRecargosCost + Number(r.totalRecargosCost),
        totalExtrasCost: acc.totalExtrasCost + r.liveTotalExtrasCost,
        totalSurcharges: acc.totalSurcharges + r.liveTotalSurcharges,
      }),
      {
        totalExpectedMins: 0,
        totalWorkedMins: 0,
        overtimeOwedMins: 0,
        totalRecargosCost: 0,
        totalExtrasCost: 0,
        totalSurcharges: 0,
      },
    );
  }, [enrichedRecords]);

  const handleBankChange = (employeeId: number, value: string) => {
    const mins = parseInt(value, 10) || 0;
    setBankDecisions((prev) => ({ ...prev, [employeeId]: mins }));
  };

  const saveDecisions = async () => {
    setSaving(true);
    try {
      const decisions = enrichedRecords
        .filter((r) => r.bankMins > 0)
        .map((r) => ({
          employeeId: r.employeeId,
          bankMins: r.bankMins,
        }));

      if (decisions.length > 0) {
        await fetch(`/api/payroll/${periodId}/comp-decision`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decisions }),
        });
        await flushCacheAction(["comp-balances", "attendance"]);
      }
      await fetchPeriod();
    } finally {
      setSaving(false);
    }
  };

  const handleRecalculate = async () => {
    setRecalculating(true);
    try {
      await fetch(`/api/payroll/${periodId}/recalculate`, { method: "POST" });
      await flushCacheAction(["attendance"]);
      await fetchPeriod();
    } finally {
      setRecalculating(false);
    }
  };

  const handleFinalize = async () => {
    setFinalizing(true);
    setFinalizeError(null);
    try {
      // Save comp decisions first
      await saveDecisions();
      // Then finalize
      const res = await fetch(`/api/payroll/${periodId}/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "finalized" }),
      });
      if (!res.ok) {
        const data = await res.json();
        setFinalizeError({
          message: data.error,
          missingPunches: data.missingPunches,
        });
        return;
      }
      await flushCacheAction(["attendance", "comp-balances"]);
      setFinalizeOpen(false);
      await fetchPeriod();
    } finally {
      setFinalizing(false);
    }
  };

  const isFinalized = status === "finalized" || status === "exported";

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-xs text-muted-foreground">
        Cargando período...
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Back link */}
      <Link
        href="/payroll"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon className="size-3.5" />
        Volver a nómina
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-[-0.04em]">
            Período: {formatPeriodRange(periodStart, periodEnd)}
          </h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {records.length} empleados
            <span
              className="ml-2 inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize"
              style={{
                color:
                  status === "finalized"
                    ? "var(--success-text)"
                    : "var(--muted-foreground)",
                backgroundColor:
                  status === "finalized"
                    ? "var(--success-bg)"
                    : "var(--secondary)",
              }}
            >
              {status}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!isFinalized ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRecalculate}
                disabled={recalculating}
                className="gap-1.5"
              >
                <RefreshCwIcon
                  className={`size-3.5 ${recalculating ? "animate-spin" : ""}`}
                />
                Recalcular
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={saveDecisions}
                disabled={saving}
              >
                {saving ? "Guardando..." : "Guardar decisiones"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  window.open(`/api/payroll/${periodId}/export/summary`)
                }
                className="gap-1.5"
              >
                <FileSpreadsheetIcon className="size-3.5" />
                Resumen
              </Button>
              <Button
                size="sm"
                onClick={() => setFinalizeOpen(true)}
                className="gap-1.5"
              >
                <LockIcon className="size-3.5" />
                Finalizar período
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  window.open(`/api/payroll/${periodId}/export/summary`)
                }
                className="gap-1.5"
              >
                <FileSpreadsheetIcon className="size-3.5" />
                Resumen
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  window.open(`/api/payroll/${periodId}/export/siigo`)
                }
                className="gap-1.5"
              >
                <DownloadIcon className="size-3.5" />
                Exportar Siigo
              </Button>
              <Button
                size="sm"
                onClick={() =>
                  window.open(`/api/payroll/${periodId}/export/both`)
                }
                className="gap-1.5"
              >
                <PackageIcon className="size-3.5" />
                Descargar todo
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-3 sm:grid-cols-5">
        {[
          {
            label: "Total esperado",
            value: formatMins(totals.totalExpectedMins),
            accent: "var(--primary)",
          },
          {
            label: "Total trabajado",
            value: formatMins(totals.totalWorkedMins),
            accent: "var(--primary)",
          },
          {
            label: "Total horas extra",
            value: formatMins(totals.overtimeOwedMins),
            accent: "var(--warning)",
          },
          {
            label: "Total recargos",
            value: formatCOP(totals.totalRecargosCost),
            accent: "var(--nocturno)",
          },
          {
            label: "Total extras",
            value: formatCOP(totals.totalExtrasCost),
            accent: "var(--overtime)",
          },
        ].map((card) => (
          <Card key={card.label} className="relative overflow-hidden">
            <div
              className="absolute top-0 right-0 left-0 h-0.5 opacity-60"
              style={{
                background: `linear-gradient(90deg, ${card.accent}, transparent)`,
              }}
            />
            <CardHeader className="pb-1">
              <CardTitle className="text-[10px] font-medium text-muted-foreground">
                {card.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-lg font-extrabold tracking-[-0.03em]">
                {card.value}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Employee Payroll Table */}
      <Card>
        <CardHeader className="border-b px-5 py-3.5">
          <CardTitle className="flex items-center justify-between text-sm font-bold tracking-[-0.01em]">
            Desglose por empleado
            <span className="font-mono text-xs font-semibold text-primary">
              Total recargos: {formatCOP(totals.totalSurcharges)}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Empleado</TableHead>
                  <TableHead className="w-16">Esperado</TableHead>
                  <TableHead className="w-16">Trabajado</TableHead>
                  <TableHead className="w-14">Tardanza</TableHead>
                  <TableHead className="w-16">RN</TableHead>
                  <TableHead className="w-16">RF</TableHead>
                  <TableHead className="w-16">RFN</TableHead>
                  <TableHead className="w-16">HE Ganadas</TableHead>
                  <TableHead className="w-16">Compensación</TableHead>
                  <TableHead className="w-16">HE Disp.</TableHead>
                  <TableHead className="w-20">Acumular</TableHead>
                  <TableHead className="w-16">HE Pagadas</TableHead>
                  <TableHead className="w-16">HED</TableHead>
                  <TableHead className="w-16">HEN</TableHead>
                  <TableHead className="w-20">Recargos</TableHead>
                  <TableHead className="w-16">Comp</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {enrichedRecords.map((r) => {
                  const gc = r.groupName
                    ? GROUP_COLORS[r.groupName]
                    : undefined;
                  const hasOT = r.overtimeOwedMins > 0;
                  const hasNegComp = r.compBalanceEnd < 0;
                  return (
                    <TableRow
                      key={r.employeeId}
                      className={
                        hasOT
                          ? "border-l-2 border-l-warning"
                          : hasNegComp
                            ? "border-l-2 border-l-danger"
                            : ""
                      }
                    >
                      <TableCell>
                        <Link
                          href={`/employees/${r.employeeId}`}
                          className="flex items-center gap-2"
                        >
                          <div
                            className="flex size-6 shrink-0 items-center justify-center rounded text-[9px] font-bold"
                            style={{
                              backgroundColor: gc
                                ? `color-mix(in srgb, ${gc} 10%, transparent)`
                                : "var(--secondary)",
                              color: gc ?? "var(--foreground)",
                            }}
                          >
                            {r.firstName[0]}
                            {r.lastName[0]}
                          </div>
                          <div className="text-xs font-semibold">
                            {r.firstName} {r.lastName.charAt(0)}.
                          </div>
                        </Link>
                      </TableCell>
                      <TableCell className="font-mono text-[11px]">
                        {formatMins(r.totalExpectedMins)}
                      </TableCell>
                      <TableCell className="font-mono text-[11px] font-semibold">
                        {formatMins(r.totalWorkedMins)}
                      </TableCell>
                      <TableCell className="text-[11px]">
                        {r.totalLateMins > 0 ? (
                          <span className="text-warning-text">
                            {r.totalLateMins}m
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-[11px]">
                        <div className="font-mono">{formatMins(r.rnMins)}</div>
                        <div className="text-[9px] text-muted-foreground">
                          {formatCOP(Number(r.rnCost))}
                        </div>
                      </TableCell>
                      <TableCell className="text-[11px]">
                        <div className="font-mono">{formatMins(r.rfMins)}</div>
                        <div className="text-[9px] text-muted-foreground">
                          {formatCOP(Number(r.rfCost))}
                        </div>
                      </TableCell>
                      <TableCell className="text-[11px]">
                        <div className="font-mono">
                          {formatMins(r.rfnMins)}
                        </div>
                        <div className="text-[9px] text-muted-foreground">
                          {formatCOP(Number(r.rfnCost))}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-[11px] font-semibold">
                        {formatMins(r.overtimeOwedMins)}
                      </TableCell>
                      <TableCell className="text-[11px]">
                        {r.owedOffsetMins > 0 ? (
                          <span className="text-warning-text">
                            {formatMins(r.owedOffsetMins)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-[11px] font-semibold">
                        {formatMins(r.otAvailable)}
                      </TableCell>
                      <TableCell>
                        {isFinalized ? (
                          <span className="font-mono text-[11px]">
                            {formatMins(r.bankMins)}
                          </span>
                        ) : (
                          <Input
                            type="number"
                            min={0}
                            max={r.otAvailable}
                            value={bankDecisions[r.employeeId] ?? 0}
                            onChange={(e) =>
                              handleBankChange(r.employeeId, e.target.value)
                            }
                            className="h-7 w-16 font-mono text-[11px]"
                            disabled={r.otAvailable === 0}
                          />
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-[11px] font-semibold">
                        {formatMins(r.otPaid)}
                      </TableCell>
                      <TableCell className="text-[11px]">
                        <div className="font-mono">
                          {formatMins(r.liveHedMins)}
                        </div>
                        <div className="text-[9px] text-muted-foreground">
                          {formatCOP(r.liveHedCost)}
                        </div>
                      </TableCell>
                      <TableCell className="text-[11px]">
                        <div className="font-mono">
                          {formatMins(r.liveHenMins)}
                        </div>
                        <div className="text-[9px] text-muted-foreground">
                          {formatCOP(r.liveHenCost)}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-[11px] font-bold">
                        {formatCOP(r.liveTotalSurcharges)}
                      </TableCell>
                      <TableCell>
                        <span
                          className="font-mono text-[11px] font-bold"
                          style={{
                            color:
                              r.compBalanceEnd > 0
                                ? "var(--success-text)"
                                : r.compBalanceEnd < 0
                                  ? "var(--danger-text)"
                                  : undefined,
                          }}
                        >
                          {formatMinsAsHours(r.compBalanceEnd)}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="text-xs font-bold">Totales</TableCell>
                  <TableCell className="font-mono text-[11px] font-bold">
                    {formatMins(totals.totalExpectedMins)}
                  </TableCell>
                  <TableCell className="font-mono text-[11px] font-bold">
                    {formatMins(totals.totalWorkedMins)}
                  </TableCell>
                  <TableCell />
                  <TableCell />
                  <TableCell />
                  <TableCell />
                  <TableCell className="font-mono text-[11px] font-bold">
                    {formatMins(totals.overtimeOwedMins)}
                  </TableCell>
                  <TableCell colSpan={6} />
                  <TableCell className="font-mono text-[11px] font-bold text-primary">
                    {formatCOP(totals.totalSurcharges)}
                  </TableCell>
                  <TableCell />
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Finalize Dialog */}
      <Dialog open={finalizeOpen} onOpenChange={setFinalizeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Finalizar período</DialogTitle>
            <DialogDescription>
              Esto bloqueará todos los cálculos y decisiones de compensatorio. Aún podrá exportar después de finalizar. Esta acción no se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          {finalizeError && (
            <div className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-xs">
              <p className="font-semibold text-danger-text">
                {finalizeError.message}
              </p>
              {finalizeError.missingPunches && (
                <ul className="mt-2 space-y-1">
                  {finalizeError.missingPunches.map((mp, i) => (
                    <li key={i} className="text-muted-foreground">
                      {mp.employee} — {mp.date} — {mp.detail}
                    </li>
                  ))}
                </ul>
              )}
              <Link
                href="/attendance"
                className="mt-2 inline-block text-xs font-medium text-primary underline"
              >
                Ir a marcaciones para resolver
              </Link>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setFinalizeOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleFinalize} disabled={finalizing}>
              {finalizing ? "Finalizando..." : "Finalizar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
