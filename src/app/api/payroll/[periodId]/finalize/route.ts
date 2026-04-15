import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { payrollPeriods } from "@/drizzle/schema";
import { auth } from "@/auth";

/**
 * POST /api/payroll/[periodId]/finalize
 * Locks the period — no more changes allowed after this.
 *
 * Body: { status: "finalized" }
 */
export async function POST(
  request: Request,
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

  const body = await request.json();
  const { status } = body;

  if (status !== "finalized") {
    return NextResponse.json(
      { error: "Status must be 'finalized'" },
      { status: 400 },
    );
  }

  // Get the period to find its date range
  const [period] = await db
    .select()
    .from(payrollPeriods)
    .where(eq(payrollPeriods.id, periodId))
    .limit(1);

  if (!period) {
    return NextResponse.json({ error: "Period not found" }, { status: 404 });
  }

  if (period.status === "finalized") {
    return NextResponse.json(
      { error: "Period is already finalized" },
      { status: 409 },
    );
  }

  // Finalize all employee records in this period range
  const updated = await db
    .update(payrollPeriods)
    .set({
      status: "finalized",
      finalizedAt: new Date(),
    })
    .where(eq(payrollPeriods.id, periodId))
    .returning({
      id: payrollPeriods.id,
      employeeId: payrollPeriods.employeeId,
      status: payrollPeriods.status,
      finalizedAt: payrollPeriods.finalizedAt,
    });

  return NextResponse.json({
    finalized: updated.length,
    records: updated,
  });
}
