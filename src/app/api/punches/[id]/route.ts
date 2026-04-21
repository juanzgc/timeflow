import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { punchLogs, punchCorrections } from "@/drizzle/schema";
import { auth } from "@/auth";
import { recalcAndInvalidate } from "@/lib/attendance/invalidate";
import { getBusinessDay, formatDateISO } from "@/lib/engine/time-utils";

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
  // workDate = business day (6am–6am), not calendar date. A pre-6am punch
  // belongs to the PREVIOUS business day. Using raw `getDate()` would also
  // introduce a server-local-timezone bug on non-UTC-5 hosts.
  const workDate = formatDateISO(getBusinessDay(newPunchDate));

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

    const oldWorkDate = formatDateISO(getBusinessDay(original.punchTime));
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
