"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ResyncResult = {
  success: boolean;
  employee: { id: number; empCode: string; name: string };
  dateRange: { startDate: string; endDate: string };
  biotime: { fetched: number; deleted: number; inserted: number };
  attendance: { daysCalculated: number };
};

interface ResyncEmployeeModalProps {
  isOpen: boolean;
  onClose: () => void;
  employeeId: number;
  employeeName: string;
}

export function ResyncEmployeeModal({
  isOpen,
  onClose,
  employeeId,
  employeeName,
}: ResyncEmployeeModalProps) {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ResyncResult | null>(null);

  const reset = () => {
    setStartDate("");
    setEndDate("");
    setError("");
    setResult(null);
    setRunning(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleRun = async () => {
    setError("");
    setResult(null);

    if (!startDate || !endDate) {
      setError("Fecha de inicio y fin son obligatorias");
      return;
    }
    if (startDate > endDate) {
      setError("La fecha de inicio debe ser anterior o igual a la fecha de fin");
      return;
    }

    setRunning(true);
    try {
      const res = await fetch(`/api/employees/${employeeId}/resync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate, endDate }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Error en la re-sincronización");
        return;
      }
      setResult(data as ResyncResult);
    } catch {
      setError("Error de red");
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Forzar re-sincronización</DialogTitle>
          <DialogDescription>
            {employeeName} — <strong>acción destructiva</strong>: borra todas las
            marcaciones del empleado en el rango (incluyendo ediciones manuales)
            y las reemplaza con las que BioTime tenga como fuente de verdad.
            Luego recalcula la asistencia del rango.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Fecha de inicio</Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                disabled={running || result !== null}
                className="mt-1 h-8 font-mono text-sm"
                required
              />
            </div>
            <div>
              <Label className="text-xs">Fecha de fin</Label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                disabled={running || result !== null}
                className="mt-1 h-8 font-mono text-sm"
                required
              />
            </div>
          </div>

          {error && (
            <div className="rounded-md bg-danger-bg p-2 text-xs text-danger-text">
              {error}
            </div>
          )}

          {result && (
            <div className="space-y-2 rounded-lg border border-success bg-success-bg p-3 text-xs">
              <div className="font-semibold text-success-text">
                Re-sincronización completada
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono">
                <span className="text-muted-foreground">Traídas de BioTime:</span>
                <span>{result.biotime.fetched}</span>
                <span className="text-muted-foreground">Borradas:</span>
                <span>{result.biotime.deleted}</span>
                <span className="text-muted-foreground">Insertadas:</span>
                <span>{result.biotime.inserted}</span>
                <span className="text-muted-foreground">Días recalculados:</span>
                <span>{result.attendance.daysCalculated}</span>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          {result ? (
            <Button onClick={handleClose}>Cerrar</Button>
          ) : (
            <>
              <Button variant="outline" onClick={handleClose} disabled={running}>
                Cancelar
              </Button>
              <Button onClick={handleRun} disabled={running}>
                {running ? "Ejecutando..." : "Forzar re-sync"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
