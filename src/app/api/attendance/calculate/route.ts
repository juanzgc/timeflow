import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { calculateAttendance } from "@/lib/engine/attendance-calculator";

/**
 * POST /api/attendance/calculate
 * Triggers daily attendance calculation for a date range.
 *
 * Body: { startDate: string, endDate: string, employeeId?: number }
 * If employeeId is omitted, calculates for ALL active employees.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { employeeId, startDate, endDate } = body;

  if (!startDate || !endDate) {
    return NextResponse.json(
      { error: "startDate and endDate are required" },
      { status: 400 },
    );
  }

  const results = await calculateAttendance({ employeeId, startDate, endDate });

  return NextResponse.json({ processed: results.length, results });
}
