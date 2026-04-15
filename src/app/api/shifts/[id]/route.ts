import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { shifts, weeklySchedules, compTransactions } from "@/drizzle/schema";
import { auth } from "@/auth";
import { doShiftsOverlap, getGapBetweenShifts } from "@/lib/schedule-utils";
import { todayColombiaISO } from "@/lib/timezone";
import { calculateAttendance } from "@/lib/engine/attendance-calculator";

// PUT /api/shifts/[id] — update a shift
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const {
    shiftType,
    shiftStart,
    shiftEnd,
    crossesMidnight,
    breakMinutes,
    isSplit,
    splitPairId,
    compDebitMins,
  } = body;

  // Get the existing shift
  const [existing] = await db
    .select()
    .from(shifts)
    .where(eq(shifts.id, Number(id)))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Shift not found" }, { status: 404 });
  }

  // For regular shifts, validate overlap against sibling shifts
  if ((shiftType ?? existing.shiftType) === "regular" && shiftStart && shiftEnd) {
    const autoCrosses = shiftEnd < shiftStart;
    const effectiveCrosses = crossesMidnight ?? autoCrosses;

    // Reject shifts longer than 12 hours (likely a time entry mistake)
    const startMins = timeToMins(shiftStart);
    const endMins = timeToMins(shiftEnd);
    const durationMins = effectiveCrosses
      ? 1440 - startMins + endMins
      : endMins - startMins;
    if (durationMins > 720) {
      return NextResponse.json(
        { error: `Shift duration is ${Math.floor(durationMins / 60)}h ${durationMins % 60}m — maximum is 12 hours. Check that the times are correct.` },
        { status: 400 },
      );
    }

    const siblings = await db
      .select()
      .from(shifts)
      .where(
        and(
          eq(shifts.scheduleId, existing.scheduleId),
          eq(shifts.employeeId, existing.employeeId),
          eq(shifts.dayOfWeek, existing.dayOfWeek),
        ),
      );

    for (const sib of siblings) {
      if (sib.id === existing.id) continue;
      if (sib.shiftStart && sib.shiftEnd) {
        if (
          doShiftsOverlap(
            sib.shiftStart,
            sib.shiftEnd,
            sib.crossesMidnight,
            shiftStart,
            shiftEnd,
            effectiveCrosses,
          )
        ) {
          return NextResponse.json(
            {
              error: `This shift overlaps with the existing ${sib.shiftStart}-${sib.shiftEnd} shift`,
            },
            { status: 400 },
          );
        }

        // Gap check
        const sibEnd = timeToMins(sib.shiftEnd);
        const newStart = timeToMins(shiftStart);
        if (newStart > sibEnd) {
          const gap = getGapBetweenShifts(sib.shiftEnd, shiftStart);
          if (gap < 30) {
            return NextResponse.json(
              { error: "Split shifts must have at least a 30-minute gap" },
              { status: 400 },
            );
          }
        } else {
          const gap = getGapBetweenShifts(shiftEnd, sib.shiftStart!);
          if (gap < 30) {
            return NextResponse.json(
              { error: "Split shifts must have at least a 30-minute gap" },
              { status: 400 },
            );
          }
        }
      }
    }

    const [row] = await db
      .update(shifts)
      .set({
        shiftType: shiftType ?? existing.shiftType,
        shiftStart,
        shiftEnd,
        crossesMidnight: effectiveCrosses,
        breakMinutes: breakMinutes ?? existing.breakMinutes,
        isSplit: isSplit ?? existing.isSplit,
        splitPairId: splitPairId ?? existing.splitPairId,
      })
      .where(eq(shifts.id, Number(id)))
      .returning();

    await recalculateForShift(existing.scheduleId, existing.employeeId, existing.dayOfWeek);
    return NextResponse.json(row);
  }

  // Non-regular or partial update
  const updates: Record<string, unknown> = {};
  if (shiftType !== undefined) updates.shiftType = shiftType;
  if (shiftStart !== undefined) updates.shiftStart = shiftStart;
  if (shiftEnd !== undefined) updates.shiftEnd = shiftEnd;
  if (crossesMidnight !== undefined) updates.crossesMidnight = crossesMidnight;
  if (breakMinutes !== undefined) updates.breakMinutes = breakMinutes;
  if (isSplit !== undefined) updates.isSplit = isSplit;
  if (splitPairId !== undefined) updates.splitPairId = splitPairId;
  if (compDebitMins !== undefined) updates.compDebitMins = compDebitMins;

  const [row] = await db
    .update(shifts)
    .set(updates)
    .where(eq(shifts.id, Number(id)))
    .returning();

  await recalculateForShift(existing.scheduleId, existing.employeeId, existing.dayOfWeek);
  return NextResponse.json(row);
}

// DELETE /api/shifts/[id] — delete a shift
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const shiftId = Number(id);

  const [existing] = await db
    .select()
    .from(shifts)
    .where(eq(shifts.id, shiftId))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Shift not found" }, { status: 404 });
  }

  // If this is a comp_day_off, reverse the comp transaction
  if (existing.shiftType === "comp_day_off" && existing.compDebitMins > 0) {
    const [lastTx] = await db
      .select({ balanceAfter: compTransactions.balanceAfter })
      .from(compTransactions)
      .where(eq(compTransactions.employeeId, existing.employeeId))
      .orderBy(desc(compTransactions.createdAt))
      .limit(1);

    const currentBalance = lastTx?.balanceAfter ?? 0;
    const newBalance = currentBalance + existing.compDebitMins;

    await db.insert(compTransactions).values({
      employeeId: existing.employeeId,
      transactionDate: todayColombiaISO(),
      type: "owed_offset",
      minutes: existing.compDebitMins,
      balanceAfter: newBalance,
      sourceShiftId: shiftId,
      createdBy: session.user.name ?? "admin",
      note: `Reversed comp day off deletion (shift #${shiftId})`,
    });
  }

  // Detach comp_transactions that reference this shift (or its split pair)
  // so the FK doesn't block deletion
  await db
    .update(compTransactions)
    .set({ sourceShiftId: null })
    .where(eq(compTransactions.sourceShiftId, shiftId));

  // If this shift has a split pair, also delete the pair
  if (existing.splitPairId) {
    await db
      .update(compTransactions)
      .set({ sourceShiftId: null })
      .where(eq(compTransactions.sourceShiftId, existing.splitPairId));
    await db.delete(shifts).where(eq(shifts.id, existing.splitPairId));
  }
  // Also delete any shifts that reference this one as their splitPairId
  await db.delete(shifts).where(eq(shifts.splitPairId, shiftId));

  await db.delete(shifts).where(eq(shifts.id, shiftId));

  // Recalculate attendance for this employee/date now that the shift is gone
  await recalculateForShift(existing.scheduleId, existing.employeeId, existing.dayOfWeek);

  return NextResponse.json({ success: true });
}

function timeToMins(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** Resolve the actual date from a shift's schedule weekStart + dayOfWeek, then recalculate. */
async function recalculateForShift(scheduleId: number, employeeId: number, dayOfWeek: number): Promise<void> {
  const [schedule] = await db
    .select({ weekStart: weeklySchedules.weekStart })
    .from(weeklySchedules)
    .where(eq(weeklySchedules.id, scheduleId))
    .limit(1);

  if (!schedule) return;

  const monday = new Date(schedule.weekStart + "T12:00:00");
  const target = new Date(monday);
  target.setDate(target.getDate() + dayOfWeek);
  const dateStr = target.toISOString().slice(0, 10);

  try {
    await calculateAttendance({ employeeId, startDate: dateStr, endDate: dateStr });
  } catch {
    // Best-effort — don't fail the shift operation
  }
}
