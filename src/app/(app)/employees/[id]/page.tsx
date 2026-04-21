"use client";

import { Suspense, useEffect, useState, useCallback, useMemo } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  ArrowLeftIcon,
  PencilIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CalendarIcon,
  ClockIcon,
  ExternalLinkIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";
import Link from "next/link";
import {
  formatMins,
  formatMinsAsHours,
  formatTime,
  formatTimestamp,
  formatDateMedium,
  formatDateShort,
  getDayName,
  currentWeekMonday,
  currentWeekSunday,
  formatCOP,
} from "@/lib/format";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { PunchCorrectionModal } from "@/components/attendance/PunchCorrectionModal";
import { EditEmployeeModal } from "@/components/employees/EditEmployeeModal";
import { ResyncEmployeeModal } from "@/components/employees/ResyncEmployeeModal";

const DAY_LABELS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const DAY_LABELS_SHORT = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

const GROUP_COLORS: Record<string, string> = {
  Kitchen: "var(--group-kitchen)",
  Servers: "var(--group-servers)",
  Bar: "var(--group-bar)",
  Admin: "var(--group-admin)",
};

type EmployeeData = {
  employee: {
    id: number;
    empCode: string;
    cedula: string | null;
    firstName: string;
    lastName: string;
    groupId: number | null;
    groupName: string | null;
    monthlySalary: string | null;
    restDay: number;
    restDayName: string;
    isActive: boolean;
    biotimeId: number | null;
    horaOrdinaria: number;
    divisor: number;
  };
  stats: {
    today: {
      status: string;
      totalWorkedMins?: number;
      clockIn?: string | null;
      clockOut?: string | null;
      lateMinutes?: number;
      isMissingPunch?: boolean;
    };
    period: {
      periodId: number;
      periodStart: string;
      periodEnd: string;
      totalExpectedMins: number;
      totalWorkedMins: number;
      overtimeMins: number;
      status: string;
    } | null;
    compBalance: number;
    punctuality: {
      percent: number;
      daysOnTime: number;
      daysWorked: number;
    };
  };
};

type DailyRecord = {
  id: number;
  workDate: string;
  status: string | null;
  clockIn: string | null;
  clockOut: string | null;
  effectiveIn: string | null;
  effectiveOut: string | null;
  totalWorkedMins: number;
  lateMinutes: number;
  earlyLeaveMins: number;
  minsOrdinaryDay: number;
  minsNocturno: number;
  minsFestivoDay: number;
  minsFestivoNight: number;
  excessHedMins: number;
  excessHenMins: number;
  dailyLimitMins: number;
  dayType: string | null;
  isClockInManual: boolean;
  isClockOutManual: boolean;
  isMissingPunch: boolean;
  scheduledStart: string | null;
  scheduledEnd: string | null;
};

type AttendanceData = {
  records: DailyRecord[];
  summary: {
    daysWorked: number;
    daysAbsent: number;
    daysOff: number;
    totalWorkedMins: number;
    totalLateMins: number;
    totalExcessMins: number;
    totalNocturnoMins: number;
    totalFestivoMins: number;
    totalOrdinaryMins: number;
  };
};

type CompTransaction = {
  id: number;
  transactionDate: string;
  type: string;
  minutes: number;
  balanceAfter: number;
  note: string | null;
  createdBy: string;
  createdAt: string;
};

type Correction = {
  id: number;
  workDate: string;
  action: string;
  oldValue: string | null;
  newValue: string | null;
  reason: string;
  correctedBy: string;
  correctedAt: string;
};

type ScheduleData = {
  weekStart: string;
  groupName: string | null;
  scheduleExists: boolean;
  shifts: Array<{
    dayOfWeek: number;
    dayName: string;
    shiftType: string;
    shiftStart?: string;
    shiftEnd?: string;
    crossesMidnight?: boolean;
    breakMinutes?: number;
    isSplit?: boolean;
    isRestDay?: boolean;
    compDebitMins?: number;
    hours: number;
    segments?: Array<{
      shiftStart: string;
      shiftEnd: string;
      crossesMidnight: boolean;
      breakMinutes: number;
    }>;
  }>;
  totalHours: number;
  editUrl: string | null;
};

type GroupOption = { id: number; name: string };

// ─── Helper: week navigation ─────────────────────────────────────────────

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function getMondayOf(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  return d.toISOString().slice(0, 10);
}

function getSundayOf(dateStr: string): string {
  return addDays(getMondayOf(dateStr), 6);
}

// ─── Main Component ──────────────────────────────────────────────────────

export default function EmployeeDetailPage() {
  return (
    <Suspense>
      <EmployeeDetailContent />
    </Suspense>
  );
}

function EmployeeDetailContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const isSuperadmin = session?.user?.role === "superadmin";
  const id = params.id as string;

  // Query param deep links
  const tabParam = searchParams.get("tab");
  const dateParam = searchParams.get("date");
  const fixParam = searchParams.get("fix");

  const [data, setData] = useState<EmployeeData | null>(null);
  const [attendanceData, setAttendanceData] = useState<AttendanceData | null>(null);
  const [compTxs, setCompTxs] = useState<CompTransaction[]>([]);
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [scheduleData, setScheduleData] = useState<ScheduleData | null>(null);
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [attendanceLoading, setAttendanceLoading] = useState(false);

  // Date range state
  const initialMonday = dateParam ? getMondayOf(dateParam) : currentWeekMonday();
  const initialSunday = dateParam ? getSundayOf(dateParam) : currentWeekSunday();
  const [startDate, setStartDate] = useState(initialMonday);
  const [endDate, setEndDate] = useState(initialSunday);

  // Schedule week
  const [scheduleWeek, setScheduleWeek] = useState(currentWeekMonday());

  // Modal state
  const [correctionModal, setCorrectionModal] = useState<{
    isOpen: boolean;
    record: DailyRecord | null;
    action: "add_in" | "add_out" | "edit_in" | "edit_out" | "add_both";
  }>({ isOpen: false, record: null, action: "add_both" });

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [resyncOpen, setResyncOpen] = useState(false);

  // Delete attendance state
  const [deleteTarget, setDeleteTarget] = useState<DailyRecord | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);

  // Active tab
  const [activeTab, setActiveTab] = useState(tabParam || "attendance");

  // Fetch employee profile + stats
  const fetchEmployee = useCallback(async () => {
    const res = await fetch(`/api/employees/${id}`);
    if (res.ok) {
      const d = await res.json();
      setData(d);
    }
    setLoading(false);
  }, [id]);

  // Fetch attendance
  const fetchAttendance = useCallback(async () => {
    setAttendanceLoading(true);
    const res = await fetch(
      `/api/employees/${id}/attendance?startDate=${startDate}&endDate=${endDate}`,
    );
    if (res.ok) {
      setAttendanceData(await res.json());
    }
    setAttendanceLoading(false);
  }, [id, startDate, endDate]);

  // Fetch comp transactions
  const fetchCompTxs = useCallback(async () => {
    const res = await fetch(`/api/employees/${id}/comp-transactions`);
    if (res.ok) {
      setCompTxs(await res.json());
    }
  }, [id]);

  // Fetch corrections
  const fetchCorrections = useCallback(async () => {
    const res = await fetch(`/api/employees/${id}/corrections`);
    if (res.ok) {
      setCorrections(await res.json());
    }
  }, [id]);

  // Fetch schedule
  const fetchSchedule = useCallback(async () => {
    const res = await fetch(`/api/employees/${id}/schedule?weekStart=${scheduleWeek}`);
    if (res.ok) {
      setScheduleData(await res.json());
    }
  }, [id, scheduleWeek]);

  // Fetch groups for edit modal
  const fetchGroups = useCallback(async () => {
    const res = await fetch("/api/groups");
    if (res.ok) {
      setGroups(await res.json());
    }
  }, []);

  useEffect(() => {
    fetchEmployee();
    fetchCompTxs();
    fetchCorrections();
    fetchGroups();
  }, [fetchEmployee, fetchCompTxs, fetchCorrections, fetchGroups]);

  useEffect(() => {
    fetchAttendance();
  }, [fetchAttendance]);

  useEffect(() => {
    fetchSchedule();
  }, [fetchSchedule]);

  // Auto-open correction modal from query params
  useEffect(() => {
    if (fixParam && dateParam && data && attendanceData) {
      const record = attendanceData.records.find((r) => r.workDate === dateParam);
      if (record || fixParam === "both") {
        const actionMap: Record<string, "add_in" | "add_out" | "edit_in" | "edit_out" | "add_both"> = {
          "clock-in": "add_in",
          "clock-out": "add_out",
          "edit-in": "edit_in",
          "edit-out": "edit_out",
          both: "add_both",
        };
        setCorrectionModal({
          isOpen: true,
          record: record || {
            id: 0,
            workDate: dateParam,
            status: "absent",
            clockIn: null,
            clockOut: null,
            effectiveIn: null,
            effectiveOut: null,
            totalWorkedMins: 0,
            lateMinutes: 0,
            earlyLeaveMins: 0,
            minsOrdinaryDay: 0,
            minsNocturno: 0,
            minsFestivoDay: 0,
            minsFestivoNight: 0,
            excessHedMins: 0,
            excessHenMins: 0,
            dailyLimitMins: 0,
            dayType: null,
            isClockInManual: false,
            isClockOutManual: false,
            isMissingPunch: false,
            scheduledStart: null,
            scheduledEnd: null,
          },
          action: actionMap[fixParam] || "add_both",
        });
      }
    }
  }, [fixParam, dateParam, data, attendanceData]);

  // Week navigation
  const goToPrevWeek = () => {
    setStartDate(addDays(startDate, -7));
    setEndDate(addDays(endDate, -7));
  };
  const goToNextWeek = () => {
    setStartDate(addDays(startDate, 7));
    setEndDate(addDays(endDate, 7));
  };
  const goToThisWeek = () => {
    setStartDate(currentWeekMonday());
    setEndDate(currentWeekSunday());
  };
  const goToPeriod = () => {
    if (data?.stats.period) {
      setStartDate(data.stats.period.periodStart);
      setEndDate(data.stats.period.periodEnd);
    }
  };

  const handleCorrectionSaved = () => {
    fetchAttendance();
    fetchCorrections();
    fetchEmployee();
  };

  const handleEditSaved = () => {
    fetchEmployee();
  };

  const openCorrectionModal = (record: DailyRecord, action: "add_in" | "add_out" | "edit_in" | "edit_out" | "add_both") => {
    setCorrectionModal({ isOpen: true, record, action });
  };

  if (loading || !data) {
    return (
      <div className="space-y-4">
        <div className="h-6 w-32 animate-pulse rounded bg-muted" />
        <div className="h-20 animate-pulse rounded-xl bg-muted" />
        <div className="grid gap-3 sm:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  const { employee: emp, stats } = data;
  const gc = emp.groupName ? GROUP_COLORS[emp.groupName] : undefined;

  return (
    <div className="space-y-5">
      {/* Back link */}
      <Link
        href="/employees"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon className="size-3.5" />
        Volver a empleados
      </Link>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div
            className="flex size-14 items-center justify-center rounded-xl text-lg font-bold"
            style={{
              backgroundColor: gc
                ? `color-mix(in srgb, ${gc} 12%, transparent)`
                : "var(--secondary)",
              color: gc ?? "var(--foreground)",
            }}
          >
            {emp.firstName[0]}
            {emp.lastName[0]}
          </div>
          <div>
            <h1 className="text-[22px] font-extrabold tracking-[-0.04em]">
              {emp.firstName} {emp.lastName}
            </h1>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              {emp.groupName && (
                <span
                  className="mr-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                  style={{
                    backgroundColor: gc
                      ? `color-mix(in srgb, ${gc} 10%, transparent)`
                      : "var(--secondary)",
                    color: gc ?? "var(--foreground)",
                  }}
                >
                  {emp.groupName}
                </span>
              )}
              #{emp.empCode}
              {emp.cedula ? (
                <> · Cédula: {emp.cedula}</>
              ) : (
                <span className="ml-1 text-warning-text">· Cédula: Sin asignar</span>
              )}
            </p>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              {emp.monthlySalary ? (
                <>Salario: {formatCOP(Number(emp.monthlySalary))}</>
              ) : (
                <span className="text-warning-text">Salario: Sin asignar</span>
              )}
              {" · "}Día de descanso: {emp.restDayName}
              {emp.horaOrdinaria > 0 && (
                <> · Hora Ordinaria: {formatCOP(emp.horaOrdinaria)} (divisor: {emp.divisor})</>
              )}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => setEditModalOpen(true)}>
          Editar empleado
        </Button>
      </div>

      {/* ── Stat Cards ──────────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-4">
        {/* Today */}
        <StatCard
          title="Hoy"
          gradient={getTodayGradient(stats.today.status)}
        >
          {stats.today.status === "on-time" && (
            <>
              <div className="text-2xl font-extrabold tracking-[-0.04em]">
                {formatMins(stats.today.totalWorkedMins ?? 0)}
              </div>
              <StatusPill status="on-time" />
            </>
          )}
          {stats.today.status === "late" && (
            <>
              <div className="text-2xl font-extrabold tracking-[-0.04em]">
                {formatMins(stats.today.totalWorkedMins ?? 0)}
              </div>
              <span className="text-[11px] font-semibold text-warning-text">
                Tarde ({stats.today.lateMinutes}m)
              </span>
            </>
          )}
          {stats.today.status === "absent" && <StatusPill status="absent" />}
          {stats.today.status === "day-off" && (
            <span className="text-sm text-muted-foreground">Descanso</span>
          )}
          {stats.today.status === "comp-day-off" && (
            <span className="text-sm text-info-text">Día compensatorio</span>
          )}
          {stats.today.isMissingPunch && (
            <span className="text-[11px] font-semibold text-warning-text">Marcación faltante</span>
          )}
          {stats.today.status === "not-scheduled" && !stats.today.isMissingPunch && (
            <span className="text-sm text-muted-foreground">Sin horario</span>
          )}
          {stats.today.status === null && stats.today.clockIn && !stats.today.clockOut && (
            <>
              <div className="text-2xl font-extrabold tracking-[-0.04em]">
                {formatMins(stats.today.totalWorkedMins ?? 0)} hasta ahora
              </div>
              <span className="text-[11px] font-semibold text-info-text">Trabajando</span>
            </>
          )}
        </StatCard>

        {/* Period */}
        <StatCard
          title="Período actual"
          gradient="linear-gradient(90deg, var(--primary), transparent)"
        >
          {stats.period ? (
            <>
              <div className="text-2xl font-extrabold tracking-[-0.04em]">
                {formatMins(stats.period.totalWorkedMins)} / {formatMins(stats.period.totalExpectedMins)}
              </div>
              {stats.period.overtimeMins > 0 ? (
                <span className="text-[11px] font-semibold text-warning-text">
                  +{formatMins(stats.period.overtimeMins)} HE
                </span>
              ) : stats.period.totalWorkedMins < stats.period.totalExpectedMins ? (
                <span className="text-[11px] font-semibold text-info-text">
                  -{formatMins(stats.period.totalExpectedMins - stats.period.totalWorkedMins)}
                </span>
              ) : null}
            </>
          ) : (
            <span className="text-sm text-muted-foreground">Sin período activo</span>
          )}
        </StatCard>

        {/* Comp Balance */}
        <StatCard
          title="Saldo compensatorio"
          gradient={`linear-gradient(90deg, ${stats.compBalance >= 0 ? "var(--success)" : "var(--danger)"}, transparent)`}
        >
          <div
            className="text-2xl font-extrabold tracking-[-0.04em]"
            style={{
              color:
                stats.compBalance > 0
                  ? "var(--success-text)"
                  : stats.compBalance < 0
                    ? "var(--danger-text)"
                    : undefined,
            }}
          >
            {formatMinsAsHours(stats.compBalance)}
          </div>
        </StatCard>

        {/* Punctuality */}
        <StatCard
          title="Puntualidad"
          gradient={`linear-gradient(90deg, ${stats.punctuality.percent >= 90 ? "var(--success)" : stats.punctuality.percent >= 70 ? "var(--warning)" : "var(--danger)"}, transparent)`}
        >
          <div
            className="text-2xl font-extrabold tracking-[-0.04em]"
            style={{
              color:
                stats.punctuality.percent >= 90
                  ? "var(--success-text)"
                  : stats.punctuality.percent >= 70
                    ? "var(--warning-text)"
                    : "var(--danger-text)",
            }}
          >
            {stats.punctuality.percent}% a tiempo
          </div>
          <span className="text-[10px] text-muted-foreground">
            {stats.punctuality.daysOnTime} de {stats.punctuality.daysWorked} días este período
          </span>
        </StatCard>
      </div>

      {/* ── Tabs ────────────────────────────────────────────────────────── */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList variant="line">
          <TabsTrigger value="attendance">Historial de marcaciones</TabsTrigger>
          <TabsTrigger value="schedule">Horario</TabsTrigger>
          <TabsTrigger value="comp">Transacciones compensatorias</TabsTrigger>
          <TabsTrigger value="corrections">Registro de correcciones</TabsTrigger>
        </TabsList>

        {/* ── Attendance Tab ───────────────────────────────────────────── */}
        <TabsContent value="attendance">
          {/* Date range controls */}
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon-sm" onClick={goToPrevWeek}>
                <ChevronLeftIcon className="size-4" />
              </Button>
              <span className="text-sm font-medium">
                {formatDateShort(startDate)} – {formatDateShort(endDate)}
              </span>
              <Button variant="ghost" size="icon-sm" onClick={goToNextWeek}>
                <ChevronRightIcon className="size-4" />
              </Button>
            </div>
            <div className="flex items-center gap-1.5">
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="h-7 w-36 text-xs"
              />
              <span className="text-xs text-muted-foreground">a</span>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="h-7 w-36 text-xs"
              />
            </div>
            <div className="flex gap-1">
              <Button variant="outline" size="xs" onClick={goToThisWeek}>
                Esta semana
              </Button>
              {stats.period && (
                <Button variant="outline" size="xs" onClick={goToPeriod}>
                  Período
                </Button>
              )}
            </div>
          </div>

          {/* Attendance Table */}
          <Card className="mt-4">
            <CardContent className="p-0">
              {attendanceLoading ? (
                <div className="flex h-24 items-center justify-center text-xs text-muted-foreground">
                  Cargando marcaciones...
                </div>
              ) : !attendanceData || attendanceData.records.length === 0 ? (
                <div className="flex h-24 items-center justify-center text-xs text-muted-foreground">
                  Sin registros de marcación para este rango
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[120px]">Fecha</TableHead>
                        <TableHead className="w-[90px]">Estado</TableHead>
                        <TableHead className="w-[100px]">Entrada</TableHead>
                        <TableHead className="w-[100px]">Salida</TableHead>
                        <TableHead className="w-[100px]">Efec. In</TableHead>
                        <TableHead className="w-[100px]">Efec. Out</TableHead>
                        <TableHead className="w-[70px]">Trabajado</TableHead>
                        <TableHead className="w-[60px]">Tardanza</TableHead>
                        <TableHead className="w-[60px]">Ordinario</TableHead>
                        <TableHead className="w-[60px]">Nocturno</TableHead>
                        <TableHead className="w-[60px]">Festivo D</TableHead>
                        <TableHead className="w-[60px]">Festivo N</TableHead>
                        <TableHead className="w-[60px]">Extra D</TableHead>
                        <TableHead className="w-[60px]">Extra N</TableHead>
                        <TableHead className="w-[80px]">Acciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {attendanceData.records.map((r) => (
                        <AttendanceRow
                          key={r.workDate}
                          record={r}
                          employeeName={`${emp.firstName} ${emp.lastName}`}
                          highlightDate={dateParam}
                          onOpenCorrection={openCorrectionModal}
                          onDelete={setDeleteTarget}
                        />
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Summary Row */}
          {attendanceData && attendanceData.summary && (
            <div className="mt-3 rounded-lg border bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">Totales del período:</span>{" "}
              {attendanceData.summary.daysWorked} días trabajados
              {" · "}{formatMins(attendanceData.summary.totalWorkedMins)} total
              {attendanceData.summary.totalLateMins > 0 && (
                <>{" · "}<span className="text-warning-text">{formatMins(attendanceData.summary.totalLateMins)} tardanza</span></>
              )}
              {attendanceData.summary.totalExcessMins > 0 && (
                <>{" · "}{formatMins(attendanceData.summary.totalExcessMins)} exceso</>
              )}
              <br />
              Nocturno: {formatMins(attendanceData.summary.totalNocturnoMins)}
              {" · "}Festivo: {formatMins(attendanceData.summary.totalFestivoMins)}
              {" · "}Ordinario: {formatMins(attendanceData.summary.totalOrdinaryMins)}
            </div>
          )}
        </TabsContent>

        {/* ── Schedule Tab ─────────────────────────────────────────────── */}
        <TabsContent value="schedule">
          <div className="mt-4 flex items-center gap-2">
            <Button variant="ghost" size="icon-sm" onClick={() => setScheduleWeek(addDays(scheduleWeek, -7))}>
              <ChevronLeftIcon className="size-4" />
            </Button>
            <span className="text-sm font-medium">
              Semana del {formatDateShort(scheduleWeek)} – {formatDateShort(addDays(scheduleWeek, 6))}
            </span>
            <Button variant="ghost" size="icon-sm" onClick={() => setScheduleWeek(addDays(scheduleWeek, 7))}>
              <ChevronRightIcon className="size-4" />
            </Button>
          </div>

          <Card className="mt-4">
            <CardContent className="p-0">
              {!scheduleData ? (
                <div className="flex h-24 items-center justify-center text-xs text-muted-foreground">
                  Cargando horario...
                </div>
              ) : !scheduleData.scheduleExists ? (
                <div className="flex h-24 flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
                  <span>Sin horario para esta semana</span>
                  {scheduleData.editUrl && (
                    <Link href={scheduleData.editUrl} className="text-primary hover:underline">
                      Crear horario →
                    </Link>
                  )}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Día</TableHead>
                      <TableHead>Turno</TableHead>
                      <TableHead>Horas</TableHead>
                      <TableHead>Tipo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {scheduleData.shifts.map((s) => (
                      <TableRow
                        key={s.dayOfWeek}
                        className={
                          s.shiftType === "day_off"
                            ? "text-muted-foreground"
                            : s.shiftType === "comp_day_off"
                              ? "text-info-text"
                              : ""
                        }
                      >
                        <TableCell className="text-xs font-medium">
                          {DAY_LABELS_SHORT[s.dayOfWeek]} {addDays(scheduleWeek, s.dayOfWeek).slice(5)}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {s.shiftType === "regular" ? (
                            s.isSplit && s.segments ? (
                              <div className="flex flex-col gap-0.5">
                                {s.segments.map((seg, i) => (
                                  <span key={i}>{formatShiftTime(seg.shiftStart)} – {formatShiftTime(seg.shiftEnd)}</span>
                                ))}
                              </div>
                            ) : (
                              <span className={s.crossesMidnight ? "text-nocturno-text" : ""}>
                                {formatShiftTime(s.shiftStart!)} – {formatShiftTime(s.shiftEnd!)}
                              </span>
                            )
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {s.hours > 0 ? `${s.hours}h` : "—"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {s.shiftType === "regular" && "Regular"}
                          {s.shiftType === "day_off" && (
                            <span>Descanso{s.isRestDay ? ` (${emp.restDayName})` : ""}</span>
                          )}
                          {s.shiftType === "comp_day_off" && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-info-bg px-2 py-0.5 text-[10px] font-semibold text-info-text">
                              COMP {s.compDebitMins ? `(-${formatMins(s.compDebitMins)})` : ""}
                            </span>
                          )}
                          {s.shiftType === "none" && "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                    {/* Total row */}
                    <TableRow className="border-t-2 font-semibold">
                      <TableCell className="text-xs" />
                      <TableCell className="text-right text-xs">Total</TableCell>
                      <TableCell className="font-mono text-xs">{scheduleData.totalHours}h</TableCell>
                      <TableCell className="text-xs">
                        {scheduleData.shifts.filter((s) => s.shiftType === "regular").length} regulares
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {scheduleData?.editUrl && (
            <div className="mt-3">
              <Link
                href={scheduleData.editUrl}
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <ExternalLinkIcon className="size-3" />
                Editar en el editor de horarios
              </Link>
            </div>
          )}
        </TabsContent>

        {/* ── Comp Transactions Tab ────────────────────────────────────── */}
        <TabsContent value="comp">
          <Card className="mt-4">
            <CardContent className="p-0">
              {compTxs.length === 0 ? (
                <div className="flex h-24 items-center justify-center text-xs text-muted-foreground">
                  Sin transacciones compensatorias
                </div>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Fecha</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Minutos</TableHead>
                        <TableHead>Saldo</TableHead>
                        <TableHead>Nota</TableHead>
                        <TableHead>Por</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {compTxs.map((tx) => (
                        <TableRow key={tx.id}>
                          <TableCell className="text-xs font-medium">
                            {formatDateMedium(tx.transactionDate)}
                          </TableCell>
                          <TableCell>
                            <CompTypeBadge type={tx.type} />
                          </TableCell>
                          <TableCell className="font-mono text-xs font-semibold">
                            {tx.minutes > 0 ? "+" : ""}
                            {formatMins(tx.minutes)}
                          </TableCell>
                          <TableCell
                            className="font-mono text-xs font-bold"
                            style={{
                              color:
                                tx.balanceAfter > 0
                                  ? "var(--success-text)"
                                  : tx.balanceAfter < 0
                                    ? "var(--danger-text)"
                                    : undefined,
                            }}
                          >
                            {formatMinsAsHours(tx.balanceAfter)}
                          </TableCell>
                          <TableCell className="max-w-48 truncate text-xs text-muted-foreground">
                            {tx.note ?? "—"}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {tx.createdBy}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <div className="border-t px-4 py-2">
                    <span className="text-xs font-semibold">
                      Saldo actual:{" "}
                      <span
                        className="font-mono"
                        style={{
                          color:
                            stats.compBalance > 0
                              ? "var(--success-text)"
                              : stats.compBalance < 0
                                ? "var(--danger-text)"
                                : undefined,
                        }}
                      >
                        {formatMinsAsHours(stats.compBalance)}
                      </span>
                    </span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Corrections Log Tab ──────────────────────────────────────── */}
        <TabsContent value="corrections">
          <Card className="mt-4">
            <CardContent className="p-0">
              {corrections.length === 0 ? (
                <div className="flex h-24 items-center justify-center text-xs text-muted-foreground">
                  Sin correcciones registradas
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Acción</TableHead>
                      <TableHead>Valor anterior</TableHead>
                      <TableHead>Valor nuevo</TableHead>
                      <TableHead>Razón</TableHead>
                      <TableHead>Por</TableHead>
                      <TableHead>Cuándo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {corrections.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="text-xs font-medium">
                          {formatDateMedium(c.workDate)}
                        </TableCell>
                        <TableCell>
                          <CorrectionActionBadge action={c.action} />
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {c.oldValue ? formatTime(c.oldValue) : "—"}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {c.newValue ? formatTime(c.newValue) : "—"}
                        </TableCell>
                        <TableCell className="max-w-48 truncate text-xs text-muted-foreground">
                          {c.reason}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {c.correctedBy}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          <div>{formatDateMedium(c.correctedAt)}</div>
                          <div className="font-mono text-[10px] text-muted-foreground/70">
                            {formatTimestamp(c.correctedAt)}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Quick Actions ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3 border-t pt-4">
        {stats.period && (
          <Link href={`/payroll/${stats.period.periodId}`}>
            <Button variant="outline" size="sm">
              <ExternalLinkIcon className="size-3.5" />
              Ver en nómina
            </Button>
          </Link>
        )}
        <Link href={`/schedules/${currentWeekMonday()}/${emp.groupId || 1}`}>
          <Button variant="outline" size="sm">
            <CalendarIcon className="size-3.5" />
            Ver horario
          </Button>
        </Link>
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            await fetch("/api/biotime/sync", { method: "POST" });
            fetchEmployee();
            fetchAttendance();
          }}
        >
          <RefreshCwIcon className="size-3.5" />
          Sincronizar desde BioTime
        </Button>
        {isSuperadmin && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setResyncOpen(true)}
            title="Borra y reemplaza las marcaciones del empleado en un rango con las de BioTime (destructivo)"
          >
            <Trash2Icon className="size-3.5" />
            Forzar re-sync (rango)
          </Button>
        )}
      </div>

      {/* ── Modals ─────────────────────────────────────────────────────── */}
      {correctionModal.isOpen && correctionModal.record && (
        <PunchCorrectionModal
          isOpen={correctionModal.isOpen}
          onClose={() => setCorrectionModal({ isOpen: false, record: null, action: "add_both" })}
          onSaved={handleCorrectionSaved}
          employeeId={emp.id}
          employeeName={`${emp.firstName} ${emp.lastName}`}
          workDate={correctionModal.record.workDate}
          existingClockIn={correctionModal.record.clockIn}
          existingClockOut={correctionModal.record.clockOut}
          scheduledStart={correctionModal.record.scheduledStart}
          scheduledEnd={correctionModal.record.scheduledEnd}
          action={correctionModal.action}
        />
      )}

      {editModalOpen && (
        <EditEmployeeModal
          isOpen={editModalOpen}
          onClose={() => setEditModalOpen(false)}
          onSaved={handleEditSaved}
          employee={emp}
          groups={groups}
        />
      )}

      {resyncOpen && isSuperadmin && (
        <ResyncEmployeeModal
          isOpen={resyncOpen}
          onClose={() => {
            setResyncOpen(false);
            fetchEmployee();
            fetchAttendance();
          }}
          employeeId={emp.id}
          employeeName={`${emp.firstName} ${emp.lastName}`}
        />
      )}

      {/* Delete Attendance Dialog */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            setDeleteReason("");
            setDeleteError("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Eliminar registro de marcación</DialogTitle>
            <DialogDescription>
              ¿Eliminar registro de marcación del{" "}
              <strong>{deleteTarget ? formatDateMedium(deleteTarget.workDate) : ""}</strong>
              ? Esto elimina todos los datos de marcación del día y no se puede deshacer.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label className="text-xs">Razón (obligatoria)</Label>
              <Input
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
                placeholder="¿Por qué se debe eliminar este registro?"
                className="mt-1 h-8 text-sm"
                autoFocus
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                Sincronización errónea · Registro fantasma · Entrada duplicada
              </p>
            </div>

            {deleteError && (
              <div className="rounded-md bg-danger-bg p-2 text-xs text-danger-text">
                {deleteError}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteTarget(null);
                setDeleteReason("");
                setDeleteError("");
              }}
              disabled={deleting}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                setDeleteError("");
                if (deleteReason.length < 5) {
                  setDeleteError("La razón debe tener al menos 5 caracteres");
                  return;
                }
                setDeleting(true);
                try {
                  const res = await fetch(`/api/employees/${id}/attendance`, {
                    method: "DELETE",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      workDate: deleteTarget!.workDate,
                      reason: deleteReason,
                    }),
                  });
                  if (!res.ok) {
                    const data = await res.json();
                    setDeleteError(data.error || "Error al eliminar");
                    return;
                  }
                  setDeleteTarget(null);
                  setDeleteReason("");
                  setDeleteError("");
                  handleCorrectionSaved();
                } catch {
                  setDeleteError("Error de red");
                } finally {
                  setDeleting(false);
                }
              }}
              disabled={deleting}
            >
              {deleting ? "Eliminando..." : "Eliminar registro"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Attendance Row Component ─────────────────────────────────────────────

function AttendanceRow({
  record: r,
  employeeName,
  highlightDate,
  onOpenCorrection,
  onDelete,
}: {
  record: DailyRecord;
  employeeName: string;
  highlightDate: string | null;
  onOpenCorrection: (record: DailyRecord, action: "add_in" | "add_out" | "edit_in" | "edit_out" | "add_both") => void;
  onDelete: (record: DailyRecord) => void;
}) {
  const isHighlighted = highlightDate === r.workDate;
  const isDayOff = r.status === "day-off" || r.status === "comp-day-off";
  const isAbsent = r.status === "absent";
  const isMissing = r.isMissingPunch || r.status === null;
  let rowClass = "";
  if (isHighlighted) rowClass = "animate-pulse bg-primary/5";
  else if (isAbsent) rowClass = "bg-danger-bg/30";
  else if (isDayOff) rowClass = "bg-muted/30";
  else if (r.status === "comp-day-off") rowClass = "bg-info-bg/30";
  else if (isMissing) rowClass = "border-l-[3px] border-l-warning bg-warning-bg/20";
  else if (r.status === "unscheduled") rowClass = "bg-yellow-50/50";

  return (
    <TableRow className={`${rowClass} [&>td]:py-3`}>
      <TableCell className="text-xs font-medium">
        <span className="flex items-center gap-1.5">
          {r.dayType === "holiday" && (
            <span className="size-1.5 rounded-full bg-danger" />
          )}
          {getDayName(r.workDate)}, {r.workDate.slice(5)}
        </span>
      </TableCell>
      <TableCell>
        <StatusPill status={r.status} isMissing={r.isMissingPunch} />
      </TableCell>
      <TableCell className="relative font-mono text-xs">
        {isDayOff ? (
          "—"
        ) : (
          <>
            <span className="group/cell inline-flex items-center gap-1">
              {r.clockIn ? formatTime(r.clockIn) : "—"}
              {r.isClockInManual && <PencilIcon className="size-2.5 text-warning" />}
              {!isDayOff && (
                <button
                  onClick={() => onOpenCorrection(r, r.clockIn ? "edit_in" : (!r.clockOut ? "add_both" : "add_in"))}
                  className="invisible size-4 rounded hover:bg-muted group-hover/cell:visible"
                >
                  <PencilIcon className="size-3 text-muted-foreground" />
                </button>
              )}
            </span>
            {r.scheduledStart && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger className="absolute bottom-1 left-2 cursor-default text-[10px] leading-tight text-muted-foreground/70">
                    {formatShiftTime(r.scheduledStart)}
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Inicio programado</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </>
        )}
      </TableCell>
      <TableCell className="relative font-mono text-xs">
        {isDayOff ? (
          "—"
        ) : (
          <>
            <span className="group/cell inline-flex items-center gap-1">
              {r.clockOut ? formatTime(r.clockOut) : "—"}
              {r.isClockOutManual && <PencilIcon className="size-2.5 text-warning" />}
              {!isDayOff && (
                <button
                  onClick={() => onOpenCorrection(r, r.clockOut ? "edit_out" : (!r.clockIn ? "add_both" : "add_out"))}
                  className="invisible size-4 rounded hover:bg-muted group-hover/cell:visible"
                >
                  <PencilIcon className="size-3 text-muted-foreground" />
                </button>
              )}
            </span>
            {r.scheduledEnd && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger className="absolute bottom-1 left-2 cursor-default text-[10px] leading-tight text-muted-foreground/70">
                    {formatShiftTime(r.scheduledEnd)}
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Fin programado</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </>
        )}
      </TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground">
        {isDayOff ? "—" : r.effectiveIn ? formatTime(r.effectiveIn) : "—"}
      </TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground">
        {isDayOff ? "—" : r.effectiveOut ? formatTime(r.effectiveOut) : "—"}
      </TableCell>
      <TableCell className="font-mono text-xs font-semibold">
        {isDayOff ? "—" : formatMins(r.totalWorkedMins)}
      </TableCell>
      <TableCell className="text-xs">
        {r.lateMinutes > 0 ? (
          <span className="rounded-full bg-warning-bg px-1.5 py-0.5 text-[10px] font-semibold text-warning-text">
            {r.lateMinutes}m
          </span>
        ) : isDayOff ? (
          "—"
        ) : (
          "—"
        )}
      </TableCell>
      <TableCell className="font-mono text-xs">
        {isDayOff ? "—" : formatMins(r.minsOrdinaryDay)}
      </TableCell>
      <MinBadge value={isDayOff ? 0 : r.minsNocturno} type="nocturno" />
      <MinBadge value={isDayOff ? 0 : r.minsFestivoDay} type="festivo" />
      <MinBadge value={isDayOff ? 0 : r.minsFestivoNight} type="festivo" />
      <MinBadge value={isDayOff ? 0 : r.excessHedMins} type="warning" />
      <MinBadge value={isDayOff ? 0 : r.excessHenMins} type="nocturno" />
      <TableCell className="text-xs">
        <span className="group/cell inline-flex items-center gap-1">
          {isMissing && !r.clockOut && r.clockIn && (
            <Button
              variant="outline"
              size="xs"
              className="text-[10px]"
              onClick={() => onOpenCorrection(r, "add_out")}
            >
              Corregir salida
            </Button>
          )}
          {isMissing && !r.clockIn && r.clockOut && (
            <Button
              variant="outline"
              size="xs"
              className="text-[10px]"
              onClick={() => onOpenCorrection(r, "add_in")}
            >
              Corregir entrada
            </Button>
          )}
          {isAbsent && (
            <Button
              variant="outline"
              size="xs"
              className="text-[10px]"
              onClick={() => onOpenCorrection(r, "add_both")}
            >
              Sí asistió
            </Button>
          )}
          {!isDayOff && (
            <button
              onClick={() => onDelete(r)}
              className="invisible size-5 rounded p-0.5 hover:bg-danger-bg group-hover/cell:visible"
              title="Eliminar registro de marcación"
            >
              <Trash2Icon className="size-3.5 text-danger-text" />
            </button>
          )}
        </span>
      </TableCell>
    </TableRow>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────

function StatCard({
  title,
  gradient,
  children,
}: {
  title: string;
  gradient: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="relative overflow-hidden">
      <div
        className="absolute top-0 right-0 left-0 h-0.5 opacity-60"
        style={{ background: gradient }}
      />
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">{children}</CardContent>
    </Card>
  );
}

function StatusPill({ status, isMissing }: { status: string | null; isMissing?: boolean }) {
  if (isMissing) {
    return (
      <span className="inline-block rounded-full bg-warning-bg px-2 py-0.5 text-[10px] font-semibold text-warning-text">
        Marcación faltante
      </span>
    );
  }
  if (!status) return <span className="text-xs text-muted-foreground">—</span>;
  const map: Record<string, { color: string; bg: string; label: string }> = {
    "on-time": { color: "var(--success-text)", bg: "var(--success-bg)", label: "A tiempo" },
    late: { color: "var(--warning-text)", bg: "var(--warning-bg)", label: "Tarde" },
    absent: { color: "var(--danger-text)", bg: "var(--danger-bg)", label: "Ausente" },
    "day-off": { color: "var(--muted-foreground)", bg: "var(--secondary)", label: "Descanso" },
    "comp-day-off": { color: "var(--info-text)", bg: "var(--info-bg)", label: "Comp" },
    unscheduled: { color: "var(--warning-text)", bg: "var(--warning-bg)", label: "Sin horario" },
    missing_punch: { color: "var(--warning-text)", bg: "var(--warning-bg)", label: "Faltante" },
  };
  const c = map[status] ?? { color: "var(--muted-foreground)", bg: "var(--secondary)", label: status };
  return (
    <span
      className="inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ color: c.color, backgroundColor: c.bg }}
    >
      {c.label}
    </span>
  );
}

function CompTypeBadge({ type }: { type: string }) {
  const map: Record<string, { color: string; bg: string; label: string }> = {
    ot_banked: { color: "var(--success-text)", bg: "var(--success-bg)", label: "HE Acumuladas" },
    comp_day_taken: { color: "var(--info-text)", bg: "var(--info-bg)", label: "Día comp." },
    time_owed: { color: "var(--danger-text)", bg: "var(--danger-bg)", label: "Tiempo adeudado" },
    owed_offset: { color: "var(--warning-text)", bg: "var(--warning-bg)", label: "Compensación" },
  };
  const c = map[type] ?? { color: "var(--muted-foreground)", bg: "var(--secondary)", label: type };
  return (
    <span
      className="inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ color: c.color, backgroundColor: c.bg }}
    >
      {c.label}
    </span>
  );
}

function CorrectionActionBadge({ action }: { action: string }) {
  const isEdit = action.startsWith("edit");
  const isDelete = action.startsWith("delete");
  const label = action.replace(/_/g, " ");
  return (
    <span
      className="inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize"
      style={{
        color: isDelete
          ? "var(--danger-text)"
          : isEdit
            ? "var(--warning-text)"
            : "var(--info-text)",
        backgroundColor: isDelete
          ? "var(--danger-bg)"
          : isEdit
            ? "var(--warning-bg)"
            : "var(--info-bg)",
      }}
    >
      {label}
    </span>
  );
}

function MinBadge({
  value,
  type,
}: {
  value: number;
  type: "nocturno" | "festivo" | "warning";
}) {
  const colors = {
    nocturno: { color: "var(--nocturno-text)", bg: "var(--nocturno-bg)" },
    festivo: { color: "var(--danger-text)", bg: "var(--danger-bg)" },
    warning: { color: "var(--warning-text)", bg: "var(--warning-bg)" },
  };
  const c = colors[type];
  return (
    <TableCell className="text-xs">
      {value > 0 ? (
        <span
          className="rounded px-1.5 py-0.5 font-mono"
          style={{ color: c.color, backgroundColor: c.bg }}
        >
          {formatMins(value)}
        </span>
      ) : (
        "—"
      )}
    </TableCell>
  );
}

function getTodayGradient(status: string): string {
  switch (status) {
    case "on-time":
      return "linear-gradient(90deg, var(--success), transparent)";
    case "late":
      return "linear-gradient(90deg, var(--warning), transparent)";
    case "absent":
      return "linear-gradient(90deg, var(--danger), transparent)";
    default:
      return "linear-gradient(90deg, var(--muted-foreground), transparent)";
  }
}

function formatShiftTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}
