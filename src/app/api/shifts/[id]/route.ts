import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { shifts, compTransactions } from "@/drizzle/schema";
import { auth } from "@/auth";
import { doShiftsOverlap, getGapBetweenShifts } from "@/lib/schedule-utils";

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
      .orderBy(compTransactions.createdAt)
      .limit(1);

    const currentBalance = lastTx?.balanceAfter ?? 0;
    const newBalance = currentBalance + existing.compDebitMins;

    await db.insert(compTransactions).values({
      employeeId: existing.employeeId,
      transactionDate: new Date().toISOString().split("T")[0],
      type: "owed_offset",
      minutes: existing.compDebitMins,
      balanceAfter: newBalance,
      sourceShiftId: shiftId,
      createdBy: session.user.name ?? "admin",
      note: "Reversed comp day off deletion",
    });
  }

  // If this shift has a split pair, also delete the pair
  if (existing.splitPairId) {
    await db.delete(shifts).where(eq(shifts.id, existing.splitPairId));
  }
  // Also delete any shifts that reference this one as their splitPairId
  await db.delete(shifts).where(eq(shifts.splitPairId, shiftId));

  await db.delete(shifts).where(eq(shifts.id, shiftId));

  return NextResponse.json({ success: true });
}

function timeToMins(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}
