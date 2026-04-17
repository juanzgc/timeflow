"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { UsersIcon, ChevronRightIcon } from "lucide-react";
import { formatDateISO } from "@/lib/schedule-utils";

const GROUP_COLORS: Record<string, string> = {
  Kitchen: "#e87040",
  Servers: "#00b899",
  Bar: "#7c5cbf",
  Admin: "#3e93de",
};

type ScheduleInfo = {
  id: number;
  shiftCount: number;
  coveredSlots: number;
  employeeCount: number;
} | null;

export function GroupCard({
  group,
  weekStart,
  scheduleInfo,
}: {
  group: { id: number; name: string; employeeCount: number };
  weekStart: Date;
  scheduleInfo: ScheduleInfo;
}) {
  const color = GROUP_COLORS[group.name] ?? "var(--primary)";
  const weekStr = formatDateISO(weekStart);

  const requiredSlots = (scheduleInfo?.employeeCount ?? group.employeeCount) * 7;
  const status = !scheduleInfo
    ? "No creado"
    : scheduleInfo.coveredSlots >= requiredSlots && requiredSlots > 0
      ? "Completo"
      : "Borrador";

  const statusStyle =
    status === "Completo"
      ? { color: "var(--success-text)", backgroundColor: "var(--success-bg)" }
      : status === "Borrador"
        ? { color: "var(--warning-text)", backgroundColor: "var(--warning-bg)" }
        : { color: "var(--muted-foreground)", backgroundColor: "var(--muted)" };

  return (
    <Link href={`/schedules/${weekStr}/${group.id}`}>
      <Card className="group relative overflow-hidden transition-shadow hover:shadow-md">
        <div
          className="absolute top-0 left-0 right-0 h-0.5 opacity-60"
          style={{
            background: `linear-gradient(90deg, ${color}, transparent)`,
          }}
        />
        <CardContent className="flex items-center gap-4 p-4">
          <div
            className="flex size-10 items-center justify-center rounded-lg"
            style={{ backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)` }}
          >
            <UsersIcon className="size-5" style={{ color }} />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: color }}
              />
              <span className="text-sm font-bold tracking-[-0.01em]">
                {group.name}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {group.employeeCount} empleado{group.employeeCount !== 1 ? "s" : ""}
            </p>
          </div>
          <Badge
            variant="secondary"
            className="text-[11px] font-semibold"
            style={statusStyle}
          >
            {status}
          </Badge>
          <ChevronRightIcon className="size-4 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5" />
        </CardContent>
      </Card>
    </Link>
  );
}
