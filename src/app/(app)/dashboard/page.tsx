import { AlertTriangleIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/auth";

const kpis = [
  {
    title: "Present Today",
    value: "--",
    sub: "of -- employees",
    accentColor: "var(--primary)",
  },
  {
    title: "On Time",
    value: "--%",
    sub: "-- employees",
    accentColor: "var(--success)",
  },
  {
    title: "Late Arrivals",
    value: "--",
    sub: "avg -- min late",
    accentColor: "var(--warning)",
  },
  {
    title: "Pending Hours",
    value: "--h",
    sub: "overtime this period",
    accentColor: "var(--nocturno)",
  },
];

export default async function DashboardPage() {
  const session = await auth();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-extrabold tracking-[-0.04em]">
          Dashboard
        </h1>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          Welcome back, {session?.user?.name ?? "Admin"}.
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <Card key={kpi.title} className="relative overflow-hidden">
            <div
              className="absolute top-0 left-0 right-0 h-0.5 opacity-60"
              style={{
                background: `linear-gradient(90deg, ${kpi.accentColor}, transparent)`,
              }}
            />
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                {kpi.title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-[32px] font-extrabold tracking-[-0.04em]">
                {kpi.value}
              </div>
              <p className="text-xs text-muted-foreground/70">{kpi.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Chart placeholders */}
      <div className="grid gap-3 lg:grid-cols-7">
        <Card className="lg:col-span-4">
          <CardHeader className="border-b px-5 py-3.5">
            <CardTitle className="text-sm font-bold tracking-[-0.01em]">
              Weekly Attendance
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5">
            <div className="flex h-48 items-center justify-center text-xs text-muted-foreground">
              Chart will be added in Phase 4
            </div>
          </CardContent>
        </Card>
        <Card className="lg:col-span-3">
          <CardHeader className="border-b px-5 py-3.5">
            <CardTitle className="text-sm font-bold tracking-[-0.01em]">
              Period Hours
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5">
            <div className="flex h-48 items-center justify-center text-xs text-muted-foreground">
              Chart will be added in Phase 4
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Alert + info placeholders */}
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-warning/15 bg-warning-bg p-4">
          <div className="flex items-center gap-2">
            <div className="flex size-6 items-center justify-center rounded-lg bg-warning/20">
              <AlertTriangleIcon className="size-3.5 text-warning-text" />
            </div>
            <span className="text-[13px] font-bold text-warning-text">
              Missing Punches
            </span>
            <span className="ml-auto rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-semibold text-warning-text">
              0
            </span>
          </div>
          <p className="mt-2 text-xs text-warning-text/70">
            No missing punches — data will appear after BioTime sync.
          </p>
        </div>

        <Card>
          <CardHeader className="border-b px-5 py-3.5">
            <CardTitle className="text-sm font-bold tracking-[-0.01em]">
              Comp Time Balances
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5">
            <div className="flex h-20 items-center justify-center text-xs text-muted-foreground">
              Will populate after schedules are created
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
