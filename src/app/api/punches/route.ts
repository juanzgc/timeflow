import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { punchLogs, punchCorrections, employees, dailyAttendance } from "@/drizzle/schema";
import { auth } from "@/auth";
import { calculateAttendance } from "@/lib/engine/attendance-calculator";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { employeeId, workDate, corrections } = body;

  // Support both old format (single punch) and new format (corrections array)
  if (corrections && Array.isArray(corrections)) {
    return handleCorrections(employeeId, workDate, corrections, session.user.name ?? "admin");
  }

  // Legacy single-punch format
  const { punchTime, punchState, reason } = body;

  if (!employeeId || !punchTime || !reason) {
    return NextResponse.json(
      { error: "employeeId, punchTime, and reason are required" },
      { status: 400 },
    );
  }

  const [emp] = await db
    .select()
    .from(employees)
    .where(eq(employees.id, employeeId))
    .limit(1);

  if (!emp) {
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  }

  const punchDate = new Date(punchTime);
  const computedWorkDate =
    `${punchDate.getFullYear()}-${String(punchDate.getMonth() + 1).padStart(2, "0")}-${String(punchDate.getDate()).padStart(2, "0")}`;

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

  await db.insert(punchCorrections).values({
    employeeId,
    workDate: computedWorkDate,
    action: punchState === "1" ? "add_out" : "add_in",
    newValue: punchDate,
    reason,
    correctedBy: session.user.name ?? "admin",
  });

  // Recalculate attendance for this day
  try {
    await calculateAttendance({
      employeeId,
      startDate: computedWorkDate,
      endDate: computedWorkDate,
    });
  } catch {
    // Non-fatal
  }

  return NextResponse.json(inserted, { status: 201 });
}

async function handleCorrections(
  employeeId: number,
  workDate: string,
  corrections: Array<{
    action: string;
    oldValue?: string | null;
    newValue: string;
    reason: string;
  }>,
  correctedBy: string,
) {
  if (!employeeId || !workDate || !corrections.length) {
    return NextResponse.json(
      { error: "employeeId, workDate, and corrections are required" },
      { status: 400 },
    );
  }

  // Validate reason length
  for (const c of corrections) {
    if (!c.reason || c.reason.length < 5) {
      return NextResponse.json(
        { error: "Reason must be at least 5 characters" },
        { status: 400 },
      );
    }
    if (!c.newValue) {
      return NextResponse.json(
        { error: "newValue is required for each correction" },
        { status: 400 },
      );
    }
  }

  const [emp] = await db
    .select()
    .from(employees)
    .where(eq(employees.id, employeeId))
    .limit(1);

  if (!emp) {
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  }

  const results = [];

  for (const c of corrections) {
    const punchDate = new Date(c.newValue);

    // Determine punchState: in actions → '0', out actions → '1'
    const isOut = c.action === "add_out" || c.action === "edit_out";
    const punchState = isOut ? "1" : "0";

    // For edit actions, remove the old punch so the resolver uses the correction
    if ((c.action === "edit_in" || c.action === "edit_out") && c.oldValue) {
      await db
        .delete(punchLogs)
        .where(
          and(
            eq(punchLogs.empCode, emp.empCode),
            eq(punchLogs.punchTime, new Date(c.oldValue)),
          ),
        );
    }

    // Insert punch log
    const [punchLog] = await db
      .insert(punchLogs)
      .values({
        empCode: emp.empCode,
        punchTime: punchDate,
        punchState,
        source: "manual",
        createdBy: correctedBy,
        note: c.reason,
      })
      .returning();

    // Insert correction record
    const [correction] = await db
      .insert(punchCorrections)
      .values({
        employeeId,
        workDate,
        action: c.action,
        oldValue: c.oldValue ? new Date(c.oldValue) : null,
        newValue: punchDate,
        reason: c.reason,
        correctedBy,
      })
      .returning();

    results.push({
      action: c.action,
      punchLogId: punchLog.id,
      correctionId: correction.id,
    });
  }

  // Recalculate attendance for this day
  try {
    await calculateAttendance({
      employeeId,
      startDate: workDate,
      endDate: workDate,
    });
  } catch {
    // Non-fatal
  }

  // Fetch updated attendance record
  const [updated] = await db
    .select()
    .from(dailyAttendance)
    .where(
      and(
        eq(dailyAttendance.employeeId, employeeId),
        eq(dailyAttendance.workDate, workDate),
      ),
    )
    .limit(1);

  return NextResponse.json(
    {
      success: true,
      corrections: results,
      attendance: updated
        ? {
            workDate: updated.workDate,
            status: updated.status,
            totalWorkedMins: updated.totalWorkedMins,
            lateMinutes: updated.lateMinutes,
          }
        : null,
    },
    { status: 201 },
  );
}
