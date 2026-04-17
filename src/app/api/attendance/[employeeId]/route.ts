import { NextResponse } from "next/server";
import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { dailyAttendance } from "@/drizzle/schema";
import { auth } from "@/auth";
import { calculateAttendance } from "@/lib/engine/attendance-calculator";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ employeeId: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { employeeId: empIdStr } = await params;
  const employeeId = parseInt(empIdStr, 10);
  if (isNaN(employeeId)) {
    return NextResponse.json({ error: "Invalid employeeId" }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");

  if (!startDate || !endDate) {
    return NextResponse.json(
      { error: "startDate and endDate are required" },
      { status: 400 },
    );
  }

  await calculateAttendance({ startDate, endDate });

  const records = await db
    .select()
    .from(dailyAttendance)
    .where(
      and(
        eq(dailyAttendance.employeeId, employeeId),
        gte(dailyAttendance.workDate, startDate),
        lte(dailyAttendance.workDate, endDate),
      ),
    )
    .orderBy(dailyAttendance.workDate);

  return NextResponse.json(records);
}
