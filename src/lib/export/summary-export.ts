import ExcelJS from "exceljs";
import { and, eq, asc } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  payrollPeriods,
  employees,
  groups,
  dailyAttendance,
} from "@/drizzle/schema";
import { COL_TZ } from "@/lib/timezone";

/** Format minutes as "Xh Ym" */
function fmtHM(mins: number): string {
  if (mins === 0) return "0h";
  const h = Math.floor(Math.abs(mins) / 60);
  const m = Math.abs(mins) % 60;
  const sign = mins < 0 ? "-" : "";
  return m > 0 ? `${sign}${h}h ${m}m` : `${sign}${h}h`;
}

/** Spanish day name */
const DAY_NAMES = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
];

function getDayName(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  // Use toLocaleDateString to get day index in Colombia timezone
  const dayIdx = new Date(d).toLocaleDateString("en-US", { weekday: "short", timeZone: COL_TZ });
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return DAY_NAMES[dayMap[dayIdx] ?? d.getDay()];
}

/** Status translation */
function translateStatus(status: string | null): string {
  const map: Record<string, string> = {
    "on-time": "A tiempo",
    late: "Tarde",
    absent: "Ausente",
    "day-off": "Descanso",
    "comp-day-off": "Compensatorio",
    "false-punch": "Falsa marca",
    unscheduled: "Sin horario",
  };
  return status ? (map[status] ?? status) : "";
}

/** Format time as HH:MM AM/PM */
function fmtTime(ts: Date | null): string {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString("es-CO", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: COL_TZ,
  });
}

/** Apply header style */
function styleHeader(ws: ExcelJS.Worksheet) {
  const row = ws.getRow(1);
  row.font = { bold: true, size: 10 };
  row.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFF0F0F0" },
  };
  ws.views = [{ state: "frozen", ySplit: 1, xSplit: 0 }];
}

/** Apply alternating row colors */
function styleAlternating(ws: ExcelJS.Worksheet, startRow: number) {
  for (let i = startRow; i <= ws.rowCount; i++) {
    if (i % 2 === 0) {
      ws.getRow(i).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFFAFAFA" },
      };
    }
  }
}

const COP_FMT = '"$"#,##0';
const HOUR_FMT = "0.00";

export async function generateSummaryExcel(
  periodStart: string,
  periodEnd: string,
): Promise<ExcelJS.Workbook> {
  // Fetch payroll records
  const records = await db
    .select({
      period: payrollPeriods,
      firstName: employees.firstName,
      lastName: employees.lastName,
      empCode: employees.empCode,
      cedula: employees.cedula,
      groupName: groups.name,
      monthlySalary: employees.monthlySalary,
    })
    .from(payrollPeriods)
    .innerJoin(employees, eq(payrollPeriods.employeeId, employees.id))
    .leftJoin(groups, eq(employees.groupId, groups.id))
    .where(
      and(
        eq(payrollPeriods.periodStart, periodStart),
        eq(payrollPeriods.periodEnd, periodEnd),
      ),
    )
    .orderBy(employees.firstName);

  // Fetch daily attendance for the period
  const dailyRows = await db
    .select({
      da: dailyAttendance,
      firstName: employees.firstName,
      lastName: employees.lastName,
      empCode: employees.empCode,
    })
    .from(dailyAttendance)
    .innerJoin(employees, eq(dailyAttendance.employeeId, employees.id))
    .where(
      and(
        eq(dailyAttendance.workDate, dailyAttendance.workDate), // always true, needed for range
      ),
    )
    .orderBy(employees.firstName, asc(dailyAttendance.workDate));

  // Filter daily rows to the period range
  const filteredDaily = dailyRows.filter((r) => {
    return r.da.workDate >= periodStart && r.da.workDate <= periodEnd;
  });

  const wb = new ExcelJS.Workbook();

  // ── Sheet 1: Resumen ─────────────────────────────────────────
  const ws1 = wb.addWorksheet("Resumen");
  ws1.addRow([
    "Empleado",
    "Cédula",
    "Código",
    "Grupo",
    "Salario Mensual",
    "Valor Hora",
    "Días Programados",
    "Días Trabajados",
    "Días Ausente",
    "Horas Esperadas",
    "Horas Trabajadas",
    "Minutos Tarde",
    "Recargo Nocturno (h)",
    "Recargo Nocturno ($)",
    "Recargo Festivo D (h)",
    "Recargo Festivo D ($)",
    "Recargo Festivo N (h)",
    "Recargo Festivo N ($)",
    "Total Recargos ($)",
    "HE Generadas (h)",
    "HE Compensadas (h)",
    "HE Pagadas Diurna (h)",
    "HE Pagadas Diurna ($)",
    "HE Pagadas Nocturna (h)",
    "HE Pagadas Nocturna ($)",
    "Total Extras ($)",
    "Total Recargos + Extras ($)",
    "Balance Comp Inicio",
    "Balance Comp Fin",
  ]);
  styleHeader(ws1);

  // COP columns: E, F, N, P, R, S, W, Y, Z, AA
  for (const col of [5, 6, 14, 16, 18, 19, 23, 25, 26, 27]) {
    ws1.getColumn(col).numFmt = COP_FMT;
  }
  // Hour columns: M, O, Q, T, U, V, X
  for (const col of [13, 15, 17, 20, 21, 22, 24]) {
    ws1.getColumn(col).numFmt = HOUR_FMT;
  }

  let totRn = 0,
    totRnCost = 0,
    totRf = 0,
    totRfCost = 0,
    totRfn = 0,
    totRfnCost = 0;
  let totRecargos = 0,
    totHed = 0,
    totHedCost = 0,
    totHen = 0,
    totHenCost = 0;
  let totExtras = 0,
    totSurcharges = 0;

  for (const r of records) {
    const p = r.period;
    const rnH = p.rnMins / 60;
    const rfH = p.rfMins / 60;
    const rfnH = p.rfnMins / 60;
    const hedH = p.hedMins / 60;
    const henH = p.henMins / 60;

    totRn += rnH;
    totRnCost += Number(p.rnCost);
    totRf += rfH;
    totRfCost += Number(p.rfCost);
    totRfn += rfnH;
    totRfnCost += Number(p.rfnCost);
    totRecargos += Number(p.totalRecargosCost);
    totHed += hedH;
    totHedCost += Number(p.hedCost);
    totHen += henH;
    totHenCost += Number(p.henCost);
    totExtras += Number(p.totalExtrasCost);
    totSurcharges += Number(p.totalSurcharges);

    ws1.addRow([
      `${r.firstName} ${r.lastName}`,
      r.cedula ?? "",
      r.empCode,
      r.groupName ?? "",
      Number(r.monthlySalary ?? 0),
      Number(p.horaOrdinariaValue ?? 0),
      p.daysScheduled,
      p.daysWorked,
      p.daysAbsent,
      fmtHM(p.totalExpectedMins),
      fmtHM(p.totalWorkedMins),
      p.totalLateMins,
      rnH,
      Number(p.rnCost),
      rfH,
      Number(p.rfCost),
      rfnH,
      Number(p.rfnCost),
      Number(p.totalRecargosCost),
      p.overtimeOwedMins / 60,
      p.otBankedMins / 60,
      hedH,
      Number(p.hedCost),
      henH,
      Number(p.henCost),
      Number(p.totalExtrasCost),
      Number(p.totalSurcharges),
      fmtHM(p.compBalanceStart),
      fmtHM(p.compBalanceEnd),
    ]);
  }

  // Totals row
  const totRow = ws1.addRow([
    "TOTALES",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    totRn,
    totRnCost,
    totRf,
    totRfCost,
    totRfn,
    totRfnCost,
    totRecargos,
    "",
    "",
    totHed,
    totHedCost,
    totHen,
    totHenCost,
    totExtras,
    totSurcharges,
  ]);
  totRow.font = { bold: true };

  styleAlternating(ws1, 2);

  // ── Sheet 2: Detalle Diario ──────────────────────────────────
  const ws2 = wb.addWorksheet("Detalle Diario");
  ws2.addRow([
    "Empleado",
    "Código",
    "Fecha",
    "Día",
    "Festivo",
    "Estado",
    "Entrada Real",
    "Salida Real",
    "Entrada Efectiva",
    "Salida Efectiva",
    "Corrección",
    "Programado Inicio",
    "Programado Fin",
    "Turno Partido",
    "Mins Trabajados",
    "Mins Tarde",
    "Mins Salida Temprana",
    "Ordinario Diurno (min)",
    "Nocturno (min)",
    "Festivo Diurno (min)",
    "Festivo Nocturno (min)",
    "Extra Diurno (min)",
    "Extra Nocturno (min)",
    "Límite Diario (min)",
  ]);
  styleHeader(ws2);
  ws2.views = [{ state: "frozen", ySplit: 1, xSplit: 2 }];

  for (const r of filteredDaily) {
    const da = r.da;
    const isHoliday = da.dayType === "holiday";
    const isCorrection = da.isClockInManual || da.isClockOutManual;

    const row = ws2.addRow([
      `${r.firstName} ${r.lastName}`,
      r.empCode,
      da.workDate,
      getDayName(da.workDate),
      isHoliday ? "Sí" : "",
      translateStatus(da.status),
      fmtTime(da.clockIn),
      fmtTime(da.clockOut),
      fmtTime(da.effectiveIn),
      fmtTime(da.effectiveOut),
      isCorrection ? "Sí" : "",
      da.scheduledStart ?? "",
      da.scheduledEnd ?? "",
      da.isSplitShift ? "Sí" : "",
      da.totalWorkedMins,
      da.lateMinutes,
      da.earlyLeaveMins,
      da.minsOrdinaryDay,
      da.minsNocturno,
      da.minsFestivoDay,
      da.minsFestivoNight,
      da.excessHedMins,
      da.excessHenMins,
      da.dailyLimitMins,
    ]);

    if (isHoliday) {
      row.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFFFF0F0" },
      };
    } else if (da.status === "late") {
      row.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFFFFBF0" },
      };
    } else if (da.status === "absent") {
      row.font = { color: { argb: "FFE5484D" } };
    }
  }

  // ── Sheet 3: Costos ──────────────────────────────────────────
  const ws3 = wb.addWorksheet("Costos");
  ws3.addRow([
    "Empleado",
    "Salario",
    "Divisor",
    "Valor Hora",
    "Concepto",
    "Horas",
    "Factor",
    "Cálculo",
    "Costo",
  ]);
  styleHeader(ws3);
  ws3.getColumn(2).numFmt = COP_FMT;
  ws3.getColumn(4).numFmt = COP_FMT;
  ws3.getColumn(6).numFmt = HOUR_FMT;
  ws3.getColumn(9).numFmt = COP_FMT;

  const conceptDefs: {
    key: string;
    minsField: string;
    costField: string;
    factor: number;
  }[] = [
    { key: "RN", minsField: "rnMins", costField: "rnCost", factor: 0.35 },
    { key: "RF", minsField: "rfMins", costField: "rfCost", factor: 0.8 },
    { key: "RFN", minsField: "rfnMins", costField: "rfnCost", factor: 1.15 },
    { key: "HED", minsField: "hedMins", costField: "hedCost", factor: 1.25 },
    { key: "HEN", minsField: "henMins", costField: "henCost", factor: 1.75 },
  ];

  for (const r of records) {
    const p = r.period;
    const salary = Number(r.monthlySalary ?? 0);
    const divisor = 220; // TODO: use 210 after July 15 2026
    const valorHora = Number(p.horaOrdinariaValue ?? salary / divisor);
    const name = `${r.firstName} ${r.lastName}`;

    for (const c of conceptDefs) {
      const mins = p[c.minsField as keyof typeof p] as number;
      if (mins > 0) {
        const hours = Math.round((mins / 60) * 100) / 100;
        const cost = Number(p[c.costField as keyof typeof p]);
        ws3.addRow([
          name,
          salary,
          divisor,
          valorHora,
          c.key,
          hours,
          `\u00D7${c.factor}`,
          `$${Math.round(valorHora).toLocaleString("es-CO")} \u00D7 ${c.factor} \u00D7 ${hours}`,
          cost,
        ]);
      }
    }
  }
  styleAlternating(ws3, 2);

  // ── Sheet 4: Festivos ────────────────────────────────────────
  const ws4 = wb.addWorksheet("Festivos");
  ws4.addRow([
    "Fecha",
    "Festivo",
    "Empleado",
    "Horas Diurnas",
    "Horas Nocturnas",
    "Costo Recargo",
  ]);
  styleHeader(ws4);
  ws4.getColumn(4).numFmt = HOUR_FMT;
  ws4.getColumn(5).numFmt = HOUR_FMT;
  ws4.getColumn(6).numFmt = COP_FMT;

  const holidayRows = filteredDaily.filter(
    (r) => r.da.dayType === "holiday" && r.da.totalWorkedMins > 0,
  );

  if (holidayRows.length === 0) {
    ws4.addRow(["No hubo festivos en este período"]);
  } else {
    for (const r of holidayRows) {
      const da = r.da;
      ws4.addRow([
        da.workDate,
        getDayName(da.workDate),
        `${r.firstName} ${r.lastName}`,
        da.minsFestivoDay / 60,
        da.minsFestivoNight / 60,
        0, // individual day cost would need per-day calculation; summed from daily
      ]);
    }
  }

  // ── Sheet 5: Compensatorio ───────────────────────────────────
  const ws5 = wb.addWorksheet("Compensatorio");
  ws5.addRow([
    "Empleado",
    "Balance Inicio",
    "Offset Deuda",
    "HE Compensadas",
    "Días Comp Tomados",
    "Tiempo Adeudado",
    "Balance Final",
    "Estado",
  ]);
  styleHeader(ws5);

  for (const r of records) {
    const p = r.period;
    const estado =
      p.compBalanceEnd > 0
        ? "Positivo"
        : p.compBalanceEnd < 0
          ? "Negativo (debe)"
          : "Cero";

    const row = ws5.addRow([
      `${r.firstName} ${r.lastName}`,
      fmtHM(p.compBalanceStart),
      fmtHM(p.compOffsetMins),
      fmtHM(p.compCreditedMins),
      fmtHM(p.compDebitedMins),
      fmtHM(p.compOwedMins),
      fmtHM(p.compBalanceEnd),
      estado,
    ]);

    if (p.compBalanceEnd > 0) {
      row.font = { color: { argb: "FF00A86B" } };
    } else if (p.compBalanceEnd < 0) {
      row.font = { color: { argb: "FFE5484D" } };
    } else {
      row.font = { color: { argb: "FF999999" } };
    }
  }

  return wb;
}
