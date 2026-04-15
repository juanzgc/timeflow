import ExcelJS from "exceljs";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { payrollPeriods, employees, settings } from "@/drizzle/schema";

export interface SiigoExportConfig {
  conceptHed: string;
  conceptHen: string;
  conceptRn: string;
  conceptRf: string;
  conceptRfn: string;
  includeValor: boolean;
  identificationField: "cedula" | "emp_code";
}

/** Load Siigo export configuration from settings table */
export async function getSiigoConfig(): Promise<SiigoExportConfig> {
  const rows = await db
    .select()
    .from(settings)
    .where(
      inArray(settings.key, [
        "siigo_concept_hed",
        "siigo_concept_hen",
        "siigo_concept_rn",
        "siigo_concept_rf",
        "siigo_concept_rfn",
        "siigo_include_valor",
        "siigo_identification_field",
      ]),
    );

  const map: Record<string, string> = {};
  for (const r of rows) {
    map[r.key] = r.value ?? "";
  }

  return {
    conceptHed: map["siigo_concept_hed"] || "HED",
    conceptHen: map["siigo_concept_hen"] || "HEN",
    conceptRn: map["siigo_concept_rn"] || "RN",
    conceptRf: map["siigo_concept_rf"] || "RF",
    conceptRfn: map["siigo_concept_rfn"] || "RFN",
    includeValor: map["siigo_include_valor"] !== "false",
    identificationField:
      (map["siigo_identification_field"] as "cedula" | "emp_code") || "cedula",
  };
}

/** Validate that all employees have required identification */
export async function validateSiigoExport(
  periodStart: string,
  periodEnd: string,
  config: SiigoExportConfig,
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];

  const records = await db
    .select({
      firstName: employees.firstName,
      lastName: employees.lastName,
      cedula: employees.cedula,
      empCode: employees.empCode,
    })
    .from(payrollPeriods)
    .innerJoin(employees, eq(payrollPeriods.employeeId, employees.id))
    .where(
      and(
        eq(payrollPeriods.periodStart, periodStart),
        eq(payrollPeriods.periodEnd, periodEnd),
      ),
    );

  for (const r of records) {
    if (config.identificationField === "cedula" && !r.cedula) {
      errors.push(`${r.firstName} ${r.lastName} — missing cédula`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Generate the Siigo-ready import Excel file */
export async function generateSiigoExcel(
  periodStart: string,
  periodEnd: string,
  config: SiigoExportConfig,
): Promise<ExcelJS.Workbook> {
  const records = await db
    .select({
      cedula: employees.cedula,
      empCode: employees.empCode,
      rnMins: payrollPeriods.rnMins,
      rnCost: payrollPeriods.rnCost,
      rfMins: payrollPeriods.rfMins,
      rfCost: payrollPeriods.rfCost,
      rfnMins: payrollPeriods.rfnMins,
      rfnCost: payrollPeriods.rfnCost,
      hedMins: payrollPeriods.hedMins,
      hedCost: payrollPeriods.hedCost,
      henMins: payrollPeriods.henMins,
      henCost: payrollPeriods.henCost,
    })
    .from(payrollPeriods)
    .innerJoin(employees, eq(payrollPeriods.employeeId, employees.id))
    .where(
      and(
        eq(payrollPeriods.periodStart, periodStart),
        eq(payrollPeriods.periodEnd, periodEnd),
      ),
    );

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Novedades");

  // Headers
  const headers = ["Identificación", "Concepto", "Horas"];
  if (config.includeValor) headers.push("Valor");
  ws.addRow(headers);

  // Column formats
  ws.getColumn(1).numFmt = "@"; // text
  ws.getColumn(3).numFmt = "0.00";
  if (config.includeValor) ws.getColumn(4).numFmt = "#,##0";

  const conceptMap: [string, string, string][] = [
    ["rnMins", "rnCost", config.conceptRn],
    ["rfMins", "rfCost", config.conceptRf],
    ["rfnMins", "rfnCost", config.conceptRfn],
    ["hedMins", "hedCost", config.conceptHed],
    ["henMins", "henCost", config.conceptHen],
  ];

  for (const r of records) {
    const id =
      config.identificationField === "cedula"
        ? r.cedula ?? ""
        : r.empCode ?? "";

    for (const [minsKey, costKey, concept] of conceptMap) {
      const mins = r[minsKey as keyof typeof r] as number;
      if (mins > 0) {
        const hours = Math.round((mins / 60) * 100) / 100;
        const cost = Math.round(Number(r[costKey as keyof typeof r]));
        const row: (string | number)[] = [id, concept, hours];
        if (config.includeValor) row.push(cost);
        ws.addRow(row);
      }
    }
  }

  return wb;
}
