"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { colMonth, colDate, colFullYear, colDay, colAddDays, colombiaDate } from "@/lib/timezone";

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function formatWeekRange(monday: Date): string {
  const sunday = colAddDays(monday, 6);

  const mMonth = MONTH_NAMES[colMonth(monday)];
  const sMonth = MONTH_NAMES[colMonth(sunday)];
  const mDay = colDate(monday);
  const sDay = colDate(sunday);
  const year = colFullYear(monday);

  if (colMonth(monday) === colMonth(sunday)) {
    return `Week of ${mMonth} ${mDay} – ${sDay}, ${year}`;
  }
  return `Week of ${mMonth} ${mDay} – ${sMonth} ${sDay}, ${year}`;
}

export function WeekNavigator({
  weekStart,
  onWeekChange,
}: {
  weekStart: Date;
  onWeekChange: (date: Date) => void;
}) {
  const goBack = () => {
    onWeekChange(colAddDays(weekStart, -7));
  };

  const goForward = () => {
    onWeekChange(colAddDays(weekStart, 7));
  };

  const goToday = () => {
    const today = new Date();
    const day = colDay(today);
    const diff = day === 0 ? -6 : 1 - day;
    const monday = colAddDays(today, diff);
    onWeekChange(colombiaDate(colFullYear(monday), colMonth(monday), colDate(monday)));
  };

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="icon" className="size-8" onClick={goBack}>
        <ChevronLeftIcon className="size-4" />
      </Button>
      <span className="min-w-[240px] text-center text-[13px] font-semibold">
        {formatWeekRange(weekStart)}
      </span>
      <Button
        variant="outline"
        size="icon"
        className="size-8"
        onClick={goForward}
      >
        <ChevronRightIcon className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="ml-1 text-xs"
        onClick={goToday}
      >
        Today
      </Button>
    </div>
  );
}
