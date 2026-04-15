import { NextResponse } from "next/server";
import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { dailyAttendance } from "@/drizzle/schema";
import { auth } from "@/auth";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: idStr } = await params;
  const employeeId = parseInt(idStr, 10);
  if (isNaN(employeeId)) {
    return NextResponse.json({ error: "Invalid employee id" }, { status: 400 });
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
