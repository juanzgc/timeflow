import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { payrollPeriods } from "@/drizzle/schema";
import { auth } from "@/auth";
import {
  generateSiigoExcel,
  getSiigoConfig,
  validateSiigoExport,
} from "@/lib/export/siigo-export";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ periodId: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { periodId: periodIdStr } = await params;
  const periodId = parseInt(periodIdStr, 10);
  if (isNaN(periodId)) {
    return NextResponse.json({ error: "Invalid periodId" }, { status: 400 });
  }

  const [period] = await db
    .select()
    .from(payrollPeriods)
    .where(eq(payrollPeriods.id, periodId))
    .limit(1);

  if (!period) {
    return NextResponse.json({ error: "Period not found" }, { status: 404 });
  }

  if (period.status === "test") {
    return NextResponse.json(
      { error: "Test periods cannot be exported to Siigo" },
      { status: 403 },
    );
  }

  if (period.status !== "finalized" && period.status !== "exported") {
    return NextResponse.json(
      { error: "Period must be finalized before export" },
      { status: 409 },
    );
  }

  const config = await getSiigoConfig();
  const validation = await validateSiigoExport(
    period.periodStart,
    period.periodEnd,
    config,
  );

  if (!validation.valid) {
    return NextResponse.json(
      { error: "Missing employee data", details: validation.errors },
      { status: 422 },
    );
  }

  const wb = await generateSiigoExcel(
    period.periodStart,
    period.periodEnd,
    config,
  );
  const buffer = await wb.xlsx.writeBuffer();

  // Set period status to exported
  await db
    .update(payrollPeriods)
    .set({ status: "exported" })
    .where(
      and(
        eq(payrollPeriods.periodStart, period.periodStart),
        eq(payrollPeriods.periodEnd, period.periodEnd),
      ),
    );

  const filename = `novedades_siigo_${period.periodStart}_${period.periodEnd}.xlsx`;
  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
