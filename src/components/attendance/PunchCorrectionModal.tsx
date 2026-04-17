"use client";

import { useState, useMemo } from "react";
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
import { formatDateFull, formatTime } from "@/lib/format";

type CorrectionAction = "add_in" | "add_out" | "edit_in" | "edit_out" | "add_both";

interface PunchCorrectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  employeeId: number;
  employeeName: string;
  workDate: string; // "YYYY-MM-DD"
  existingClockIn: string | null;
  existingClockOut: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  action?: CorrectionAction;
}

export function PunchCorrectionModal({
  isOpen,
  onClose,
  onSaved,
  employeeId,
  employeeName,
  workDate,
  existingClockIn,
  existingClockOut,
  scheduledStart,
  scheduledEnd,
  action = "add_both",
}: PunchCorrectionModalProps) {
  const [clockInTime, setClockInTime] = useState("");
  const [clockOutTime, setClockOutTime] = useState("");
  const [editClockIn, setEditClockIn] = useState(action === "edit_in" || action === "add_in" || action === "add_both");
  const [editClockOut, setEditClockOut] = useState(action === "edit_out" || action === "add_out" || action === "add_both");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const clockInEditable = action === "add_in" || action === "edit_in" || action === "add_both";
  const clockOutEditable = action === "add_out" || action === "edit_out" || action === "add_both";

  // Preview calculation
  const preview = useMemo(() => {
    const inTime = clockInEditable && clockInTime ? clockInTime : (existingClockIn ? extractTime(existingClockIn) : null);
    const outTime = clockOutEditable && clockOutTime ? clockOutTime : (existingClockOut ? extractTime(existingClockOut) : null);

    if (!inTime || !outTime) return null;

    const inMins = parseTimeTo15Min(inTime);
    let outMins = parseTimeTo15Min(outTime);

    // For midnight-crossing shifts, add 1440 (24h) to the clock-out minutes
    const shiftCrossesMidnight = scheduledStart && scheduledEnd
      && parseTime24(scheduledEnd) < parseTime24(scheduledStart);
    if (shiftCrossesMidnight && outMins < inMins) {
      outMins += 1440;
    }

    if (outMins <= inMins) return null;

    const workedMins = outMins - inMins;
    const schedStartMins = scheduledStart ? parseTime24(scheduledStart) : null;
    const lateMins = schedStartMins !== null && inMins > schedStartMins ? inMins - schedStartMins : 0;

    return {
      workedMins,
      lateMins,
      workedDisplay: `${Math.floor(workedMins / 60)}h ${workedMins % 60}m`,
      lateDisplay: lateMins > 0 ? `${lateMins} min` : "Ninguna",
    };
  }, [clockInTime, clockOutTime, existingClockIn, existingClockOut, clockInEditable, clockOutEditable, scheduledStart, scheduledEnd]);

  const handleSave = async () => {
    setError("");

    if (reason.length < 5) {
      setError("La razón debe tener al menos 5 caracteres");
      return;
    }

    const corrections: Array<{
      action: string;
      oldValue: string | null;
      newValue: string;
      reason: string;
    }> = [];

    if (clockInEditable && clockInTime) {
      const newValue = buildTimestamp(workDate, clockInTime);
      corrections.push({
        action: existingClockIn ? "edit_in" : "add_in",
        oldValue: existingClockIn,
        newValue,
        reason,
      });
    }

    if (clockOutEditable && clockOutTime) {
      const nextDay = isClockOutNextDay(clockOutTime, scheduledStart, scheduledEnd);
      const newValue = buildTimestamp(workDate, clockOutTime, nextDay);
      corrections.push({
        action: existingClockOut ? "edit_out" : "add_out",
        oldValue: existingClockOut,
        newValue,
        reason,
      });
    }

    if (corrections.length === 0) {
      setError("Ingrese al menos un valor de hora");
      return;
    }

    // Validate clock-out after clock-in (skip for midnight-crossing shifts)
    if (corrections.length === 2 || (clockInTime && clockOutTime)) {
      const inT = clockInTime || (existingClockIn ? extractTime(existingClockIn) : "");
      const outT = clockOutTime || (existingClockOut ? extractTime(existingClockOut) : "");
      const shiftCrossesMidnight = scheduledStart && scheduledEnd
        && parseTime24(scheduledEnd) < parseTime24(scheduledStart);
      if (inT && outT && !shiftCrossesMidnight && parseTimeTo15Min(outT) <= parseTimeTo15Min(inT)) {
        setError("La salida debe ser después de la entrada");
        return;
      }
    }

    setSaving(true);
    try {
      const res = await fetch("/api/punches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, workDate, corrections }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Error al guardar la corrección");
        return;
      }

      onSaved();
      onClose();
    } catch {
      setError("Error de red");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Corrección de marcación</DialogTitle>
          <DialogDescription>
            {employeeName} — {formatDateFull(workDate)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Clock In Section */}
          <div className="rounded-lg border p-3">
            <div className="mb-2 text-xs font-semibold text-muted-foreground">Entrada</div>
            {!clockInEditable ? (
              existingClockIn ? (
                <div className="font-mono text-sm">
                  Actual: {formatTime(existingClockIn)}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">Faltante</div>
              )
            ) : (
              <div>
                {existingClockIn ? (
                  <div className="mb-1 text-xs text-muted-foreground">
                    Actual: {formatTime(existingClockIn)}
                  </div>
                ) : (
                  <div className="mb-1 flex items-center gap-1 text-xs text-warning-text">
                    <span>Faltante</span>
                  </div>
                )}
                <Label className="text-xs">Nueva hora</Label>
                <Input
                  type="time"
                  value={clockInTime}
                  onChange={(e) => setClockInTime(e.target.value)}
                  className="mt-1 h-8 w-40 font-mono text-sm"
                  autoFocus={clockInEditable}
                />
              </div>
            )}
          </div>

          {/* Clock Out Section */}
          <div className="rounded-lg border p-3">
            <div className="mb-2 text-xs font-semibold text-muted-foreground">Salida</div>
            {!clockOutEditable ? (
              existingClockOut ? (
                <div className="font-mono text-sm">
                  Actual: {formatTime(existingClockOut)}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">Faltante</div>
              )
            ) : (
              <div>
                {existingClockOut ? (
                  <div className="mb-1 text-xs text-muted-foreground">
                    Actual: {formatTime(existingClockOut)}
                  </div>
                ) : (
                  <div className="mb-1 flex items-center gap-1 text-xs text-warning-text">
                    <span>Faltante</span>
                  </div>
                )}
                <Label className="text-xs">Nueva hora</Label>
                <Input
                  type="time"
                  value={clockOutTime}
                  onChange={(e) => setClockOutTime(e.target.value)}
                  className="mt-1 h-8 w-40 font-mono text-sm"
                  autoFocus={clockOutEditable && !clockInEditable}
                />
              </div>
            )}
          </div>

          {/* Schedule Context */}
          {(scheduledStart || scheduledEnd) && (
            <div className="rounded-lg border border-dashed p-3">
              <div className="mb-1 text-xs font-semibold text-muted-foreground">Contexto del horario</div>
              <div className="text-sm">
                Programado: {scheduledStart ?? "?"} – {scheduledEnd ?? "?"}
              </div>
            </div>
          )}

          {/* Reason */}
          <div>
            <Label className="text-xs">Razón (obligatoria)</Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="¿Por qué se necesita esta corrección?"
              className="mt-1 h-8 text-sm"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              Olvidó marcar · Error del dispositivo · Confirmado por supervisor
            </p>
          </div>

          {/* Preview */}
          {preview && (
            <div className="rounded-lg bg-muted/50 p-3">
              <div className="mb-1 text-xs font-semibold text-muted-foreground">Vista previa</div>
              <div className="flex gap-4 text-sm">
                <span>Trabajado: <strong className="font-mono">{preview.workedDisplay}</strong></span>
                <span>Tardanza: <strong className="font-mono">{preview.lateDisplay}</strong></span>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="rounded-md bg-danger-bg p-2 text-xs text-danger-text">{error}</div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Guardando..." : "Guardar corrección"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function extractTime(ts: string): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function parseTimeTo15Min(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function parseTime24(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function buildTimestamp(date: string, time: string, nextDay = false): string {
  if (nextDay) {
    const d = new Date(date + "T12:00:00");
    d.setDate(d.getDate() + 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}T${time}:00-05:00`;
  }
  return `${date}T${time}:00-05:00`;
}

function isClockOutNextDay(
  clockOutTime: string,
  scheduledStart: string | null,
  scheduledEnd: string | null,
): boolean {
  if (!scheduledStart || !scheduledEnd) return false;
  const startMins = parseTime24(scheduledStart);
  const endMins = parseTime24(scheduledEnd);
  // Shift crosses midnight when end < start (e.g., 18:00-02:00)
  if (endMins >= startMins) return false;
  const outMins = parseTime24(clockOutTime);
  // Clock-out is in the post-midnight window (before the scheduled end boundary)
  return outMins < startMins;
}
