import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { calculateAttendance } from "@/lib/engine/attendance-calculator";

/**
 * POST /api/attendance/recalculate
 * Recalculates attendance for a single employee + date.
 *
 * Body: { employeeId: number, workDate: string }
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { employeeId, workDate } = body;

  if (!employeeId || !workDate) {
    return NextResponse.json(
      { error: "employeeId and workDate are required" },
      { status: 400 },
    );
  }

  const results = await calculateAttendance({
    employeeId,
    startDate: workDate,
    endDate: workDate,
  });

  return NextResponse.json({ processed: results.length, results });
}
