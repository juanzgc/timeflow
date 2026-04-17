"use client";

import { PlusIcon } from "lucide-react";

type Shift = {
  id: number;
  shiftType: string;
  shiftStart: string | null;
  shiftEnd: string | null;
  crossesMidnight: boolean;
  isSplit: boolean;
  splitPairId: number | null;
  compDebitMins: number;
  breakMinutes: number;
};

function formatTime(t: string): string {
  const [h, m] = t.split(":");
  const hour = parseInt(h);
  const min = m === "00" ? "" : `:${m}`;
  return `${hour}${min}`;
}

export function ShiftCell({
  shifts,
  isHoliday,
  onClick,
}: {
  shifts: Shift[];
  isHoliday: boolean;
  onClick: () => void;
}) {
  const holidayBg = isHoliday ? "bg-festivo-bg/50" : "";

  // No shifts — empty cell
  if (shifts.length === 0) {
    return (
      <button
        onClick={onClick}
        className={`group flex h-full min-h-[52px] w-full items-center justify-center rounded-md border border-transparent transition-colors hover:border-border hover:bg-muted/50 ${holidayBg}`}
      >
        <PlusIcon className="size-4 text-muted-foreground/30 transition-opacity group-hover:text-muted-foreground/70" />
      </button>
    );
  }

  const shift = shifts[0];

  // Day off
  if (shift.shiftType === "day_off") {
    return (
      <button
        onClick={onClick}
        className={`flex h-full min-h-[52px] w-full items-center justify-center rounded-md transition-colors hover:bg-muted/50 ${holidayBg}`}
      >
        <span className="text-[11px] font-medium text-muted-foreground/60">
          DESC
        </span>
      </button>
    );
  }

  // Comp day off
  if (shift.shiftType === "comp_day_off") {
    return (
      <button
        onClick={onClick}
        className={`flex h-full min-h-[52px] w-full flex-col items-center justify-center gap-0.5 rounded-md transition-colors hover:bg-muted/50 ${holidayBg}`}
      >
        <span className="rounded-full bg-info-bg px-2 py-0.5 text-[10px] font-semibold text-info-text">
          COMP
        </span>
        <span className="text-[10px] text-muted-foreground/50">
          -{Math.round(shift.compDebitMins / 60)}h
        </span>
      </button>
    );
  }

  // Regular shift(s)
  const isNight = shift.crossesMidnight;

  // Check if there are two segments (split shift)
  const isSplitShift = shifts.length === 2;

  if (isSplitShift) {
    const s1 = shifts[0];
    const s2 = shifts[1];
    return (
      <button
        onClick={onClick}
        className={`flex h-full min-h-[52px] w-full flex-col items-center justify-center gap-0.5 rounded-md border border-transparent transition-colors hover:border-primary/20 hover:bg-primary/5 ${holidayBg}`}
        style={{ borderLeftColor: "var(--primary)", borderLeftWidth: 2 }}
      >
        <span className="font-mono text-[11px] font-medium">
          {formatTime(s1.shiftStart!)}-{formatTime(s1.shiftEnd!)}
        </span>
        <span className="font-mono text-[11px] font-medium">
          {formatTime(s2.shiftStart!)}-{formatTime(s2.shiftEnd!)}
        </span>
      </button>
    );
  }

  // Single regular shift
  return (
    <button
      onClick={onClick}
      className={`flex h-full min-h-[52px] w-full items-center justify-center rounded-md border border-transparent transition-colors hover:border-primary/20 hover:bg-primary/5 ${holidayBg} ${isNight ? "bg-nocturno-bg/50" : ""}`}
    >
      <span
        className={`font-mono text-[12px] font-medium ${isNight ? "text-nocturno-text" : ""}`}
      >
        {formatTime(shift.shiftStart!)}-{formatTime(shift.shiftEnd!)}
      </span>
    </button>
  );
}
