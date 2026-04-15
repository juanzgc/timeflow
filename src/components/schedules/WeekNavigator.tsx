"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function formatWeekRange(monday: Date): string {
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);

  const mMonth = MONTH_NAMES[monday.getMonth()];
  const sMonth = MONTH_NAMES[sunday.getMonth()];
  const mDay = monday.getDate();
  const sDay = sunday.getDate();
  const year = monday.getFullYear();

  if (monday.getMonth() === sunday.getMonth()) {
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
    const prev = new Date(weekStart);
    prev.setDate(prev.getDate() - 7);
    onWeekChange(prev);
  };

  const goForward = () => {
    const next = new Date(weekStart);
    next.setDate(next.getDate() + 7);
    onWeekChange(next);
  };

  const goToday = () => {
    const today = new Date();
    const day = today.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const monday = new Date(today);
    monday.setDate(today.getDate() + diff);
    monday.setHours(0, 0, 0, 0);
    onWeekChange(monday);
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
