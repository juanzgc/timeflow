import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { punchLogs, punchCorrections, employees } from "@/drizzle/schema";
import { auth } from "@/auth";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { employeeId, punchTime, punchState, reason } = body;

  if (!employeeId || !punchTime || !reason) {
    return NextResponse.json(
      { error: "employeeId, punchTime, and reason are required" },
      { status: 400 },
    );
  }

  // Get employee
  const [emp] = await db
    .select()
    .from(employees)
    .where(eq(employees.id, employeeId))
    .limit(1);

  if (!emp) {
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  }

  const punchDate = new Date(punchTime);
  const workDate = `${punchDate.getFullYear()}-${String(punchDate.getMonth() + 1).padStart(2, "0")}-${String(punchDate.getDate()).padStart(2, "0")}`;

  // Insert manual punch log
  const [inserted] = await db
    .insert(punchLogs)
    .values({
      empCode: emp.empCode,
      punchTime: punchDate,
      punchState: punchState ?? null,
      source: "manual",
      createdBy: session.user.name ?? "admin",
      note: reason,
    })
    .returning();

  // Insert correction record
  await db.insert(punchCorrections).values({
    employeeId,
    workDate,
    action: punchState === "1" ? "add_out" : "add_in",
    newValue: punchDate,
    reason,
    correctedBy: session.user.name ?? "admin",
  });

  return NextResponse.json(inserted, { status: 201 });
}
