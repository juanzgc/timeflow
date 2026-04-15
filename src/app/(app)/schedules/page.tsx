"use client";

import { useEffect, useState, useCallback } from "react";
import { WeekNavigator } from "@/components/schedules/WeekNavigator";
import { GroupCard } from "@/components/schedules/GroupCard";
import { getMonday, formatDateISO } from "@/lib/schedule-utils";
import { CalendarDaysIcon } from "lucide-react";

type Group = {
  id: number;
  name: string;
  employeeCount: number;
};

type ScheduleRow = {
  id: number;
  weekStart: string;
  groupId: number;
  groupName: string;
  shiftCount: number;
};

export default function SchedulesPage() {
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()));
  const [groups, setGroups] = useState<Group[]>([]);
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const weekStr = formatDateISO(weekStart);
    const [grpRes, schRes] = await Promise.all([
      fetch("/api/groups"),
      fetch(`/api/schedules?weekStart=${weekStr}`),
    ]);
    const grpData = await grpRes.json();
    const schData = await schRes.json();
    setGroups(grpData);
    setSchedules(schData.schedules ?? []);
    setLoading(false);
  }, [weekStart]);

  useEffect(() => {
    fetchData(); // eslint-disable-line react-hooks/set-state-in-effect -- initial data fetch
  }, [fetchData]);

  const getScheduleForGroup = (groupId: number) =>
    schedules.find((s) => s.groupId === groupId) ?? null;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-[-0.04em]">
            Schedules
          </h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Weekly schedule management by employee group.
          </p>
        </div>
      </div>

      <WeekNavigator weekStart={weekStart} onWeekChange={setWeekStart} />

      {loading ? (
        <div className="flex h-48 items-center justify-center text-xs text-muted-foreground">
          Loading...
        </div>
      ) : groups.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-muted-foreground">
          <CalendarDaysIcon className="size-8 opacity-30" />
          <p className="text-xs">
            No groups found. Create groups and assign employees first.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {groups.map((group) => {
            const schInfo = getScheduleForGroup(group.id);
            return (
              <GroupCard
                key={group.id}
                group={group}
                weekStart={weekStart}
                scheduleInfo={
                  schInfo
                    ? { id: schInfo.id, shiftCount: schInfo.shiftCount }
                    : null
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
