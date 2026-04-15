"use client";

import { getWeekDates, formatDateISO, getWeeklyScheduledMins, getWeeklyExpectedMins, minsToHoursDisplay, getDailyLimitMins } from "@/lib/schedule-utils";
import { ShiftCell } from "./ShiftCell";

type Employee = {
  id: number;
  empCode: string;
  firstName: string;
  lastName: string;
  compBalance: number;
};

type Shift = {
  id: number;
  employeeId: number;
  dayOfWeek: number;
  shiftType: string;
  shiftStart: string | null;
  shiftEnd: string | null;
  crossesMidnight: boolean;
  breakMinutes: number;
  isSplit: boolean;
  splitPairId: number | null;
  compDebitMins: number;
};

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function ShiftGrid({
  weekStart,
  employees,
  shifts,
  holidays,
  dailyLimits,
  onCellClick,
}: {
  weekStart: Date;
  employees: Employee[];
  shifts: Shift[];
  holidays: string[];
  dailyLimits: Record<string, number>;
  onCellClick: (employeeId: number, dayOfWeek: number, date: string) => void;
}) {
  const weekDates = getWeekDates(weekStart);
  const holidaySet = new Set(holidays);

  // Group shifts by employeeId and dayOfWeek
  const shiftMap = new Map<string, Shift[]>();
  for (const s of shifts) {
    const key = `${s.employeeId}-${s.dayOfWeek}`;
    const existing = shiftMap.get(key) ?? [];
    existing.push(s);
    shiftMap.set(key, existing);
  }

  // Sort split shifts so the earlier start comes first
  for (const [key, dayShifts] of shiftMap) {
    if (dayShifts.length === 2) {
      dayShifts.sort((a, b) => {
        if (!a.shiftStart || !b.shiftStart) return 0;
        return a.shiftStart.localeCompare(b.shiftStart);
      });
      shiftMap.set(key, dayShifts);
    }
  }

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[800px]">
        {/* Header row */}
        <div className="grid grid-cols-[180px_repeat(7,1fr)] gap-px rounded-t-lg bg-border">
          <div className="rounded-tl-lg bg-card px-3 py-2.5">
            <span className="text-xs font-semibold text-muted-foreground">
              Employee
            </span>
          </div>
          {weekDates.map((date, i) => {
            const dateStr = formatDateISO(date);
            const isHol = holidaySet.has(dateStr);
            const limit = dailyLimits[String(i)] ?? getDailyLimitMins(i);
            return (
              <div
                key={i}
                className={`bg-card px-2 py-2.5 text-center ${i === 6 ? "rounded-tr-lg" : ""} ${isHol ? "bg-festivo-bg/30" : ""}`}
              >
                <div className={`text-xs font-semibold ${isHol ? "text-festivo" : ""}`}>
                  {DAY_NAMES[i]} {date.getDate()}
                </div>
                <div className="text-[10px] text-muted-foreground/60">
                  ({limit / 60}h)
                </div>
              </div>
            );
          })}
        </div>

        {/* Employee rows */}
        {employees.length === 0 ? (
          <div className="flex h-32 items-center justify-center rounded-b-lg border border-t-0 text-xs text-muted-foreground">
            No employees in this group
          </div>
        ) : (
          <div className="grid gap-px rounded-b-lg bg-border">
            {employees.map((emp, empIdx) => {
              // Calculate weekly totals
              const empShifts = shifts.filter((s) => s.employeeId === emp.id);
              const scheduledMins = getWeeklyScheduledMins(
                empShifts.map((s) => ({
                  dayOfWeek: s.dayOfWeek,
                  shiftType: s.shiftType,
                  shiftStart: s.shiftStart,
                  shiftEnd: s.shiftEnd,
                  crossesMidnight: s.crossesMidnight,
                  breakMinutes: s.breakMinutes,
                })),
              );
              const expectedMins = getWeeklyExpectedMins(
                empShifts.map((s) => ({
                  dayOfWeek: s.dayOfWeek,
                  shiftType: s.shiftType,
                  shiftStart: s.shiftStart,
                  shiftEnd: s.shiftEnd,
                  crossesMidnight: s.crossesMidnight,
                  breakMinutes: s.breakMinutes,
                })),
                dailyLimits as unknown as Record<number, number>,
              );
              const isOver = scheduledMins > expectedMins;
              const isLast = empIdx === employees.length - 1;

              return (
                <div
                  key={emp.id}
                  className={`grid grid-cols-[180px_repeat(7,1fr)] gap-px ${isLast ? "rounded-b-lg" : ""}`}
                >
                  {/* Employee name column */}
                  <div
                    className={`flex flex-col justify-center bg-card px-3 py-2 ${isLast ? "rounded-bl-lg" : ""}`}
                  >
                    <span className="text-[13px] font-medium">
                      {emp.firstName} {emp.lastName.charAt(0)}.
                    </span>
                    <span
                      className={`font-mono text-[11px] ${isOver ? "font-semibold text-warning-text" : "text-muted-foreground/60"}`}
                    >
                      {minsToHoursDisplay(scheduledMins)} /{" "}
                      {minsToHoursDisplay(expectedMins)}
                    </span>
                  </div>

                  {/* Day cells */}
                  {weekDates.map((date, dayIdx) => {
                    const dateStr = formatDateISO(date);
                    const cellShifts = shiftMap.get(`${emp.id}-${dayIdx}`) ?? [];
                    const isHol = holidaySet.has(dateStr);

                    return (
                      <div
                        key={dayIdx}
                        className={`bg-card px-1 py-1 ${isLast && dayIdx === 6 ? "rounded-br-lg" : ""}`}
                      >
                        <ShiftCell
                          shifts={cellShifts}
                          isHoliday={isHol}
                          onClick={() => onCellClick(emp.id, dayIdx, dateStr)}
                        />
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
