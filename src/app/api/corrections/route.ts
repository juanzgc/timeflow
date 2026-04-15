import { NextResponse } from "next/server";
import { and, eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { punchCorrections, employees } from "@/drizzle/schema";
import { auth } from "@/auth";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const employeeId = searchParams.get("employeeId");
  const workDate = searchParams.get("workDate");

  const conditions = [];
  if (employeeId) {
    conditions.push(eq(punchCorrections.employeeId, parseInt(employeeId, 10)));
  }
  if (workDate) {
    conditions.push(eq(punchCorrections.workDate, workDate));
  }

  const rows = await db
    .select({
      id: punchCorrections.id,
      employeeId: punchCorrections.employeeId,
      firstName: employees.firstName,
      lastName: employees.lastName,
      workDate: punchCorrections.workDate,
      action: punchCorrections.action,
      oldValue: punchCorrections.oldValue,
      newValue: punchCorrections.newValue,
      reason: punchCorrections.reason,
      correctedBy: punchCorrections.correctedBy,
      correctedAt: punchCorrections.correctedAt,
    })
    .from(punchCorrections)
    .innerJoin(employees, eq(punchCorrections.employeeId, employees.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(punchCorrections.correctedAt));

  return NextResponse.json(rows);
}
