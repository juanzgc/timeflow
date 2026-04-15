"use client";

import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getShiftDurationMins,
  getGapBetweenShifts,
  minsToHoursDisplay,
  DAY_NAMES_SHORT,
} from "@/lib/schedule-utils";
import { Trash2Icon } from "lucide-react";
import { colMonth, colDate } from "@/lib/timezone";

type Shift = {
  id: number;
  shiftType: string;
  shiftStart: string | null;
  shiftEnd: string | null;
  crossesMidnight: boolean;
  breakMinutes: number;
  isSplit: boolean;
  splitPairId: number | null;
  compDebitMins: number;
};

type ShiftModalProps = {
  open: boolean;
  employeeName: string;
  dayOfWeek: number;
  date: string;
  dailyLimit: number;
  compBalance: number;
  existingShifts: Shift[];
  onSave: (data: ShiftSaveData) => Promise<void>;
  onDelete: (shiftIds: number[]) => Promise<void>;
  onClose: () => void;
};

export type ShiftSaveData = {
  shiftType: "regular" | "day_off" | "comp_day_off";
  // Segment 1
  shiftStart?: string;
  shiftEnd?: string;
  breakMinutes?: number;
  // Segment 2 (split)
  isSplit?: boolean;
  shiftStart2?: string;
  shiftEnd2?: string;
  breakMinutes2?: number;
  // Comp
  compDebitMins?: number;
};

export function ShiftModal({
  open,
  employeeName,
  dayOfWeek,
  date,
  dailyLimit,
  compBalance,
  existingShifts,
  onSave,
  onDelete,
  onClose,
}: ShiftModalProps) {
  const isEditing = existingShifts.length > 0;
  const primaryShift = existingShifts[0];
  const secondShift = existingShifts.length > 1 ? existingShifts[1] : null;

  const [shiftType, setShiftType] = useState<
    "regular" | "day_off" | "comp_day_off"
  >(
    (primaryShift?.shiftType as "regular" | "day_off" | "comp_day_off") ??
      "regular",
  );

  const [start1, setStart1] = useState(primaryShift?.shiftStart ?? "08:00");
  const [end1, setEnd1] = useState(primaryShift?.shiftEnd ?? "17:00");
  const [break1, setBreak1] = useState(primaryShift?.breakMinutes ?? 0);

  const [isSplit, setIsSplit] = useState(
    isEditing ? existingShifts.length > 1 : false,
  );
  const [start2, setStart2] = useState(secondShift?.shiftStart ?? "18:00");
  const [end2, setEnd2] = useState(secondShift?.shiftEnd ?? "22:00");
  const [break2, setBreak2] = useState(secondShift?.breakMinutes ?? 0);

  const [compDebit, setCompDebit] = useState(
    primaryShift?.compDebitMins ?? dailyLimit,
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const crosses1 = end1 < start1;
  const crosses2 = end2 < start2;

  const seg1Mins = useMemo(
    () =>
      shiftType === "regular"
        ? getShiftDurationMins(start1, end1, crosses1, break1)
        : 0,
    [shiftType, start1, end1, crosses1, break1],
  );

  const seg2Mins = useMemo(
    () =>
      shiftType === "regular" && isSplit
        ? getShiftDurationMins(start2, end2, crosses2, break2)
        : 0,
    [shiftType, isSplit, start2, end2, crosses2, break2],
  );

  const totalMins = seg1Mins + seg2Mins;
  const excess = totalMins - dailyLimit;

  const MAX_SEGMENT_MINS = 720; // 12 hours
  const seg1TooLong = shiftType === "regular" && seg1Mins > MAX_SEGMENT_MINS;
  const seg2TooLong = shiftType === "regular" && isSplit && seg2Mins > MAX_SEGMENT_MINS;
  const shiftTooLong = seg1TooLong || seg2TooLong;

  const gap = useMemo(() => {
    if (!isSplit) return 0;
    return getGapBetweenShifts(end1, start2);
  }, [isSplit, end1, start2]);

  // Format date for title
  const dateObj = new Date(date + "T12:00:00");
  const monthNames = [
    "Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec",
  ];
  const dateLabel = `${DAY_NAMES_SHORT[dayOfWeek]}, ${monthNames[colMonth(dateObj)]} ${colDate(dateObj)}`;

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      await onSave({
        shiftType,
        shiftStart: shiftType === "regular" ? start1 : undefined,
        shiftEnd: shiftType === "regular" ? end1 : undefined,
        breakMinutes: shiftType === "regular" ? break1 : undefined,
        isSplit: shiftType === "regular" ? isSplit : undefined,
        shiftStart2:
          shiftType === "regular" && isSplit ? start2 : undefined,
        shiftEnd2:
          shiftType === "regular" && isSplit ? end2 : undefined,
        breakMinutes2:
          shiftType === "regular" && isSplit ? break2 : undefined,
        compDebitMins:
          shiftType === "comp_day_off" ? compDebit : undefined,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setSaving(true);
    try {
      await onDelete(existingShifts.map((s) => s.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base font-bold">
            {employeeName} — {dateLabel}
          </DialogTitle>
        </DialogHeader>

        {/* Shift type selector */}
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {(["regular", "day_off", "comp_day_off"] as const).map((type) => (
            <button
              key={type}
              onClick={() => setShiftType(type)}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                shiftType === type
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {type === "regular"
                ? "Regular"
                : type === "day_off"
                  ? "Day Off"
                  : "Comp Day Off"}
            </button>
          ))}
        </div>

        {/* Regular shift fields */}
        {shiftType === "regular" && (
          <div className="space-y-4">
            {/* Segment 1 */}
            <div className="space-y-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                {isSplit ? "Segment 1" : "Shift Times"}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Start</Label>
                  <Input
                    type="time"
                    value={start1}
                    onChange={(e) => setStart1(e.target.value)}
                    className="font-mono text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs">End</Label>
                  <Input
                    type="time"
                    value={end1}
                    onChange={(e) => setEnd1(e.target.value)}
                    className="font-mono text-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Break (min)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={break1}
                    onChange={(e) => setBreak1(Number(e.target.value))}
                    className="font-mono text-sm"
                  />
                </div>
                <div className="flex items-end">
                  {crosses1 && (
                    <span className="rounded-full bg-nocturno-bg px-2 py-1 text-[10px] font-semibold text-nocturno-text">
                      Crosses midnight
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Split shift toggle */}
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={isSplit}
                onChange={(e) => setIsSplit(e.target.checked)}
                className="size-3.5 rounded accent-primary"
              />
              <span className="text-xs font-medium">
                Split shift (turno partido)
              </span>
            </label>

            {/* Segment 2 */}
            {isSplit && (
              <div className="space-y-3 border-l-2 border-primary/20 pl-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                  Segment 2
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Start</Label>
                    <Input
                      type="time"
                      value={start2}
                      onChange={(e) => setStart2(e.target.value)}
                      className="font-mono text-sm"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">End</Label>
                    <Input
                      type="time"
                      value={end2}
                      onChange={(e) => setEnd2(e.target.value)}
                      className="font-mono text-sm"
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Break (min)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={break2}
                    onChange={(e) => setBreak2(Number(e.target.value))}
                    className="w-24 font-mono text-sm"
                  />
                </div>
              </div>
            )}

            {/* Live calculation summary */}
            <div className="rounded-lg bg-muted/50 p-3">
              <div className="space-y-1 text-xs">
                {isSplit ? (
                  <p className="text-muted-foreground">
                    Seg 1:{" "}
                    <span className="font-mono font-medium text-foreground">
                      {minsToHoursDisplay(seg1Mins)}
                    </span>{" "}
                    | Gap:{" "}
                    <span
                      className={`font-mono font-medium ${gap < 30 ? "text-danger" : "text-foreground"}`}
                    >
                      {gap}m
                    </span>{" "}
                    | Seg 2:{" "}
                    <span className="font-mono font-medium text-foreground">
                      {minsToHoursDisplay(seg2Mins)}
                    </span>
                  </p>
                ) : null}
                <p className="text-muted-foreground">
                  Total:{" "}
                  <span className="font-mono font-semibold text-foreground">
                    {minsToHoursDisplay(totalMins)}
                  </span>{" "}
                  | Daily limit:{" "}
                  <span className="font-mono font-medium">
                    {minsToHoursDisplay(dailyLimit)}
                  </span>
                </p>
                {excess > 0 && !shiftTooLong && (
                  <p className="font-semibold text-warning-text">
                    +{minsToHoursDisplay(excess)} excess (overtime)
                  </p>
                )}
                {shiftTooLong && (
                  <p className="font-semibold text-danger">
                    {seg1TooLong ? "Segment 1" : "Segment 2"} exceeds 12 hours ({minsToHoursDisplay(seg1TooLong ? seg1Mins : seg2Mins)}) — check that the times are correct
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Comp day off fields */}
        {shiftType === "comp_day_off" && (
          <div className="space-y-3">
            <div className="rounded-lg bg-info-bg/50 p-3 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Current balance:</span>
                <span
                  className={`font-mono font-semibold ${compBalance >= 0 ? "text-success-text" : "text-danger-text"}`}
                >
                  {compBalance >= 0 ? "+" : ""}
                  {minsToHoursDisplay(Math.abs(compBalance))}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">
                  Hours to debit:
                </Label>
                <Input
                  type="number"
                  min={0}
                  value={Math.round(compDebit / 60)}
                  onChange={(e) =>
                    setCompDebit(Number(e.target.value) * 60)
                  }
                  className="w-20 font-mono text-sm"
                />
              </div>
              <div className="mt-2 flex justify-between border-t pt-2">
                <span className="text-muted-foreground">Balance after:</span>
                <span
                  className={`font-mono font-semibold ${compBalance - compDebit >= 0 ? "text-success-text" : "text-danger-text"}`}
                >
                  {compBalance - compDebit >= 0 ? "+" : ""}
                  {minsToHoursDisplay(Math.abs(compBalance - compDebit))}
                </span>
              </div>
            </div>
            {compBalance - compDebit < 0 && (
              <p className="text-xs font-medium text-warning-text">
                This will put {employeeName.split(" ")[0]} at{" "}
                {minsToHoursDisplay(Math.abs(compBalance - compDebit))} negative
                (owes time)
              </p>
            )}
          </div>
        )}

        {/* Day off — no additional fields */}
        {shiftType === "day_off" && (
          <p className="py-4 text-center text-xs text-muted-foreground">
            No scheduled hours for this day.
          </p>
        )}

        {error && (
          <p className="text-xs font-medium text-danger">{error}</p>
        )}

        <DialogFooter className="gap-2">
          {isEditing && (
            <Button
              variant="outline"
              size="sm"
              className="mr-auto text-danger hover:bg-danger-bg hover:text-danger-text"
              onClick={handleDelete}
              disabled={saving}
            >
              <Trash2Icon className="mr-1 size-3.5" />
              Delete
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving || shiftTooLong}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
