import { NextResponse } from "next/server";
import { auth } from "@/auth";

/**
 * POST /api/attendance/recalculate
 * Recalculates attendance for a single employee + date.
 * Delegates to the main calculate endpoint with a 1-day range.
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

  // Forward to the calculate endpoint with a 1-day range
  const url = new URL("/api/attendance/calculate", request.url);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: request.headers.get("cookie") ?? "",
    },
    body: JSON.stringify({
      employeeId,
      startDate: workDate,
      endDate: workDate,
    }),
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
