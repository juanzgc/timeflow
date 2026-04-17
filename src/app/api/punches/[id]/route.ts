import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { punchLogs, punchCorrections } from "@/drizzle/schema";
import { auth } from "@/auth";
import { recalcAndInvalidate } from "@/lib/attendance/invalidate";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "Invalid punch id" }, { status: 400 });
  }

  const body = await request.json();
  const { punchTime, reason, employeeId } = body;

  if (!punchTime || !reason) {
    return NextResponse.json(
      { error: "punchTime and reason are required" },
      { status: 400 },
    );
  }

  // Get original punch
  const [original] = await db
    .select()
    .from(punchLogs)
    .where(eq(punchLogs.id, id))
    .limit(1);

  if (!original) {
    return NextResponse.json({ error: "Punch not found" }, { status: 404 });
  }

  const newPunchDate = new Date(punchTime);
  const workDate = `${newPunchDate.getFullYear()}-${String(newPunchDate.getMonth() + 1).padStart(2, "0")}-${String(newPunchDate.getDate()).padStart(2, "0")}`;

  // Update punch
  const [updated] = await db
    .update(punchLogs)
    .set({ punchTime: newPunchDate })
    .where(eq(punchLogs.id, id))
    .returning();

  // Insert correction record
  if (employeeId) {
    await db.insert(punchCorrections).values({
      employeeId,
      workDate,
      action: original.punchState === "1" ? "edit_out" : "edit_in",
      oldValue: original.punchTime,
      newValue: newPunchDate,
      reason,
      correctedBy: session.user.name ?? "admin",
    });

    const oldDate = original.punchTime;
    const oldWorkDate = `${oldDate.getFullYear()}-${String(oldDate.getMonth() + 1).padStart(2, "0")}-${String(oldDate.getDate()).padStart(2, "0")}`;
    const startDate = oldWorkDate < workDate ? oldWorkDate : workDate;
    const endDate = oldWorkDate < workDate ? workDate : oldWorkDate;

    try {
      await recalcAndInvalidate({ employeeId, startDate, endDate });
    } catch {
      // Non-fatal
    }
  }

  return NextResponse.json(updated);
}
