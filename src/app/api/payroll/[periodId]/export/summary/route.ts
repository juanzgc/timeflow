import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { payrollPeriods } from "@/drizzle/schema";
import { auth } from "@/auth";
import { generateSummaryExcel } from "@/lib/export/summary-export";

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

  const wb = await generateSummaryExcel(period.periodStart, period.periodEnd);
  const buffer = await wb.xlsx.writeBuffer();

  const filename = `resumen_nomina_${period.periodStart}_${period.periodEnd}.xlsx`;
  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
