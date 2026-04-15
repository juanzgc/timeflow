import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { payrollPeriods } from "@/drizzle/schema";
import { auth } from "@/auth";
import { generateExportZip } from "@/lib/export/zip-bundle";

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
      { error: "Test periods cannot be exported" },
      { status: 403 },
    );
  }

  if (period.status !== "finalized" && period.status !== "exported") {
    return NextResponse.json(
      { error: "Period must be finalized before export" },
      { status: 409 },
    );
  }

  const result = await generateExportZip(period.periodStart, period.periodEnd);

  if (result.errors && result.errors.length > 0) {
    return NextResponse.json(
      { error: "Export validation failed", details: result.errors },
      { status: 422 },
    );
  }

  const filename = `novedades_${period.periodStart}_${period.periodEnd}.zip`;
  return new Response(new Uint8Array(result.buffer), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
