"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { ShiftGrid } from "@/components/schedules/ShiftGrid";
import { ShiftModal, type ShiftSaveData } from "@/components/schedules/ShiftModal";
import { ScheduleActions } from "@/components/schedules/ScheduleActions";
import { minsToHoursDisplay, getWeeklyScheduledMins, getDailyLimitMins } from "@/lib/schedule-utils";
import { flushCacheAction } from "@/lib/actions/flush-cache";

type Employee = {
  id: number;
  empCode: string;
  firstName: string;
  lastName: string;
  restDay: number;
  compBalance: number;
};

type Shift = {
  id: number;
  scheduleId: number;
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

type ScheduleData = {
  schedule: {
    id: number;
    weekStart: string;
    groupId: number;
    groupName: string;
  } | null;
  employees: Employee[];
  shifts: Shift[];
  holidays: string[];
  dailyLimits: Record<string, number>;
};

type ModalState = {
  employeeId: number;
  dayOfWeek: number;
  date: string;
} | null;

const MONTH_NAMES = [
  "ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic",
];

export default function ScheduleEditorPage() {
  const params = useParams<{ weekStart: string; groupId: string }>();
  const router = useRouter();
  const weekStart = params.weekStart;
  const groupId = params.groupId;

  const [data, setData] = useState<ScheduleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<ModalState>(null);

  const fetchData = useCallback(async () => {
    const res = await fetch(`/api/schedules/${weekStart}/${groupId}`);
    const json = await res.json();
    setData(json);
    setLoading(false);
  }, [weekStart, groupId]);

  useEffect(() => {
    fetchData(); // eslint-disable-line react-hooks/set-state-in-effect -- initial data fetch
  }, [fetchData]);

  // Ensure schedule exists (create if needed) before any shift operations
  const ensureSchedule = async (): Promise<number> => {
    if (data?.schedule?.id) return data.schedule.id;

    const res = await fetch("/api/schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weekStart, groupId: Number(groupId) }),
    });
    const json = await res.json();
    if (res.status === 409 && json.id) return json.id;
    if (!res.ok) throw new Error(json.error ?? "Error al crear el horario");
    return json.id;
  };

  const handleCellClick = (
    employeeId: number,
    dayOfWeek: number,
    date: string,
  ) => {
    setModal({ employeeId, dayOfWeek, date });
  };

  const handleSave = async (saveData: ShiftSaveData) => {
    const scheduleId = await ensureSchedule();
    if (!modal) return;

    const { employeeId, dayOfWeek } = modal;

    // Get existing shifts for this cell
    const existingShifts = (data?.shifts ?? []).filter(
      (s) => s.employeeId === employeeId && s.dayOfWeek === dayOfWeek,
    );

    if (existingShifts.length > 0) {
      // Delete existing shifts first
      for (const s of existingShifts) {
        await fetch(`/api/shifts/${s.id}`, { method: "DELETE" });
      }
    }

    if (saveData.shiftType === "day_off") {
      const res = await fetch("/api/shifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduleId,
          employeeId,
          dayOfWeek,
          shiftType: "day_off",
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error);
      }
    } else if (saveData.shiftType === "comp_day_off") {
      const res = await fetch("/api/shifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduleId,
          employeeId,
          dayOfWeek,
          shiftType: "comp_day_off",
          compDebitMins: saveData.compDebitMins,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error);
      }
    } else {
      // Regular shift
      const crosses1 = (saveData.shiftEnd ?? "") < (saveData.shiftStart ?? "");

      const res1 = await fetch("/api/shifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduleId,
          employeeId,
          dayOfWeek,
          shiftType: "regular",
          shiftStart: saveData.shiftStart,
          shiftEnd: saveData.shiftEnd,
          crossesMidnight: crosses1,
          breakMinutes: saveData.breakMinutes ?? 0,
          isSplit: saveData.isSplit ?? false,
        }),
      });
      if (!res1.ok) {
        const err = await res1.json();
        throw new Error(err.error);
      }

      // If split shift, create second segment
      if (saveData.isSplit && saveData.shiftStart2 && saveData.shiftEnd2) {
        const shift1 = await res1.json();
        const crosses2 = saveData.shiftEnd2 < saveData.shiftStart2;

        const res2 = await fetch("/api/shifts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scheduleId,
            employeeId,
            dayOfWeek,
            shiftType: "regular",
            shiftStart: saveData.shiftStart2,
            shiftEnd: saveData.shiftEnd2,
            crossesMidnight: crosses2,
            breakMinutes: saveData.breakMinutes2 ?? 0,
            isSplit: true,
            splitPairId: shift1.id,
          }),
        });
        if (!res2.ok) {
          const err = await res2.json();
          throw new Error(err.error);
        }
      }
    }

    setModal(null);
    await flushCacheAction(["attendance", "comp-balances"]);
    fetchData();
  };

  const handleDelete = async (shiftIds: number[]) => {
    for (const id of shiftIds) {
      await fetch(`/api/shifts/${id}`, { method: "DELETE" });
    }
    setModal(null);
    await flushCacheAction(["attendance", "comp-balances"]);
    fetchData();
  };

  const handleCopyPrevious = async () => {
    const res = await fetch(
      `/api/schedules/${weekStart}/${groupId}/copy-previous`,
      { method: "POST" },
    );
    if (!res.ok) {
      const err = await res.json();
      alert(err.error);
      return;
    }
    await flushCacheAction(["attendance", "comp-balances"]);
    fetchData();
  };

  const handleClearAll = async () => {
    if (!data?.schedule?.id) return;
    // Delete all shifts for this schedule
    for (const s of data.shifts) {
      await fetch(`/api/shifts/${s.id}`, { method: "DELETE" });
    }
    await flushCacheAction(["attendance", "comp-balances"]);
    fetchData();
  };

  const handleDeleteSchedule = async () => {
    // Clear shifts first, then we'd need a schedule DELETE endpoint
    // For now, just clear all shifts
    await handleClearAll();
    router.push("/schedules");
  };

  if (loading || !data) {
    return (
      <div className="flex h-64 items-center justify-center text-xs text-muted-foreground">
        Cargando horario...
      </div>
    );
  }

  const mondayDate = new Date(weekStart + "T12:00:00");
  const sundayDate = new Date(mondayDate);
  sundayDate.setDate(sundayDate.getDate() + 6);

  const weekLabel = `${MONTH_NAMES[mondayDate.getMonth()]} ${mondayDate.getDate()} – ${sundayDate.getDate()}, ${mondayDate.getFullYear()}`;

  // Summary stats
  const totalEmployees = data.employees.length;
  const totalScheduledMins = data.employees.reduce((sum, emp) => {
    const empShifts = data.shifts
      .filter((s) => s.employeeId === emp.id)
      .map((s) => ({
        dayOfWeek: s.dayOfWeek,
        shiftType: s.shiftType,
        shiftStart: s.shiftStart,
        shiftEnd: s.shiftEnd,
        crossesMidnight: s.crossesMidnight,
        breakMinutes: s.breakMinutes,
      }));
    return sum + getWeeklyScheduledMins(empShifts);
  }, 0);
  const avgMins =
    totalEmployees > 0 ? Math.round(totalScheduledMins / totalEmployees) : 0;

  // Modal data
  const modalEmployee = modal
    ? data.employees.find((e) => e.id === modal.employeeId)
    : null;
  const modalShifts = modal
    ? data.shifts.filter(
        (s) =>
          s.employeeId === modal.employeeId &&
          s.dayOfWeek === modal.dayOfWeek,
      )
    : [];
  const modalDailyLimit =
    modal
      ? (data.dailyLimits[String(modal.dayOfWeek)] ??
          getDailyLimitMins(modal.dayOfWeek))
      : 420;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <Link
            href="/schedules"
            className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeftIcon className="size-3" />
            Volver a horarios
          </Link>
          <h1 className="text-[22px] font-extrabold tracking-[-0.04em]">
            Horario {data.schedule?.groupName ?? "Nuevo"}
          </h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Semana del {weekLabel}
          </p>
        </div>
        <ScheduleActions
          weekStart={weekStart}
          groupName={data.schedule?.groupName ?? ""}
          scheduleId={data.schedule?.id ?? null}
          onCopyPrevious={handleCopyPrevious}
          onClearAll={handleClearAll}
          onDelete={handleDeleteSchedule}
        />
      </div>

      {/* Grid */}
      <Card className="overflow-hidden p-0">
        <ShiftGrid
          weekStart={mondayDate}
          employees={data.employees}
          shifts={data.shifts}
          holidays={data.holidays}
          dailyLimits={data.dailyLimits}
          onCellClick={handleCellClick}
        />
      </Card>

      {/* Summary bar */}
      <div className="flex items-center gap-6 text-xs text-muted-foreground">
        <span>
          <span className="font-semibold text-foreground">
            {totalEmployees}
          </span>{" "}
          empleados
        </span>
        <span>
          Prom{" "}
          <span className="font-mono font-semibold text-foreground">
            {minsToHoursDisplay(avgMins)}
          </span>
          /semana
        </span>
        <span>
          Total{" "}
          <span className="font-mono font-semibold text-foreground">
            {minsToHoursDisplay(totalScheduledMins)}
          </span>
        </span>
      </div>

      {/* Shift Modal */}
      {modal && modalEmployee && (
        <ShiftModal
          open
          employeeName={`${modalEmployee.firstName} ${modalEmployee.lastName}`}
          dayOfWeek={modal.dayOfWeek}
          date={modal.date}
          dailyLimit={modalDailyLimit}
          compBalance={modalEmployee.compBalance}
          existingShifts={modalShifts}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
