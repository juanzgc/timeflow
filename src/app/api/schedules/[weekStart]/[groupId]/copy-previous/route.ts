import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { weeklySchedules, shifts } from "@/drizzle/schema";
import { auth } from "@/auth";
import { recalcAndInvalidate } from "@/lib/attendance/invalidate";

// POST /api/schedules/[weekStart]/[groupId]/copy-previous
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ weekStart: string; groupId: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { weekStart, groupId } = await params;
  const gid = Number(groupId);

  // Calculate previous week's Monday
  const currentMonday = new Date(weekStart + "T12:00:00");
  const prevMonday = new Date(currentMonday);
  prevMonday.setDate(prevMonday.getDate() - 7);
  const prevWeekStart = prevMonday.toISOString().split("T")[0];

  // Find previous week's schedule
  const [prevSchedule] = await db
    .select()
    .from(weeklySchedules)
    .where(
      and(
        eq(weeklySchedules.weekStart, prevWeekStart),
        eq(weeklySchedules.groupId, gid),
      ),
    )
    .limit(1);

  if (!prevSchedule) {
    return NextResponse.json(
      { error: `No schedule found for previous week (${prevWeekStart})` },
      { status: 404 },
    );
  }

  // Check if current week already has shifts
  const [currentSchedule] = await db
    .select()
    .from(weeklySchedules)
    .where(
      and(
        eq(weeklySchedules.weekStart, weekStart),
        eq(weeklySchedules.groupId, gid),
      ),
    )
    .limit(1);

  if (currentSchedule) {
    const existingShifts = await db
      .select({ id: shifts.id })
      .from(shifts)
      .where(eq(shifts.scheduleId, currentSchedule.id))
      .limit(1);

    if (existingShifts.length > 0) {
      return NextResponse.json(
        { error: "Current week already has shifts. Clear them first to copy." },
        { status: 409 },
      );
    }
  }

  // Create schedule for current week if needed
  let scheduleId: number;
  if (currentSchedule) {
    scheduleId = currentSchedule.id;
  } else {
    const [newSchedule] = await db
      .insert(weeklySchedules)
      .values({
        weekStart,
        groupId: gid,
        createdBy: session.user.name ?? "admin",
      })
      .returning();
    scheduleId = newSchedule.id;
  }

  // Get previous week's shifts (exclude comp_day_off — those are one-time)
  const prevShifts = await db
    .select()
    .from(shifts)
    .where(eq(shifts.scheduleId, prevSchedule.id));

  const regularShifts = prevShifts.filter(
    (s) => s.shiftType !== "comp_day_off",
  );

  // Copy shifts (without split pair links — we'll fix them after)
  const oldToNewId = new Map<number, number>();
  const copied: typeof shifts.$inferSelect[] = [];

  for (const s of regularShifts) {
    const [newShift] = await db
      .insert(shifts)
      .values({
        scheduleId,
        employeeId: s.employeeId,
        dayOfWeek: s.dayOfWeek,
        shiftType: s.shiftType,
        shiftStart: s.shiftStart,
        shiftEnd: s.shiftEnd,
        crossesMidnight: s.crossesMidnight,
        breakMinutes: s.breakMinutes,
        isSplit: s.isSplit,
        // splitPairId will be updated below
      })
      .returning();
    oldToNewId.set(s.id, newShift.id);
    copied.push(newShift);
  }

  // Fix split pair links
  for (const s of regularShifts) {
    if (s.splitPairId && oldToNewId.has(s.splitPairId)) {
      const newId = oldToNewId.get(s.id)!;
      const newPairId = oldToNewId.get(s.splitPairId)!;
      await db
        .update(shifts)
        .set({ splitPairId: newPairId })
        .where(eq(shifts.id, newId));
    }
  }

  // Recalculate attendance for every affected employee across the target week
  const weekEnd = new Date(currentMonday);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const weekEndStr = weekEnd.toISOString().split("T")[0];
  const affectedEmployeeIds = [...new Set(regularShifts.map((s) => s.employeeId))];
  for (const employeeId of affectedEmployeeIds) {
    try {
      await recalcAndInvalidate({
        employeeId,
        startDate: weekStart,
        endDate: weekEndStr,
      });
    } catch {
      // Best-effort
    }
  }

  return NextResponse.json({
    success: true,
    scheduleId,
    copiedCount: copied.length,
  });
}
