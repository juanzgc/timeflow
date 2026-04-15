import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { shifts, compTransactions } from "@/drizzle/schema";
import { auth } from "@/auth";
import { doShiftsOverlap, getGapBetweenShifts } from "@/lib/schedule-utils";

// POST /api/shifts — create a new shift
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const {
    scheduleId,
    employeeId,
    dayOfWeek,
    shiftType = "regular",
    shiftStart,
    shiftEnd,
    crossesMidnight,
    breakMinutes = 0,
    isSplit = false,
    splitPairId,
    compDebitMins = 0,
  } = body;

  if (!scheduleId || !employeeId || dayOfWeek === undefined) {
    return NextResponse.json(
      { error: "scheduleId, employeeId, and dayOfWeek are required" },
      { status: 400 },
    );
  }

  // Get existing shifts for this employee on this day
  const existing = await db
    .select()
    .from(shifts)
    .where(
      and(
        eq(shifts.scheduleId, scheduleId),
        eq(shifts.employeeId, employeeId),
        eq(shifts.dayOfWeek, dayOfWeek),
      ),
    );

  // Validation: max 2 shifts per day
  if (existing.length >= 2) {
    return NextResponse.json(
      { error: "Maximum 2 shift segments per day (turno partido)" },
      { status: 400 },
    );
  }

  // For day_off or comp_day_off, can't have existing regular shifts
  if (
    (shiftType === "day_off" || shiftType === "comp_day_off") &&
    existing.length > 0
  ) {
    return NextResponse.json(
      { error: "Cannot add day off — shifts already exist for this day" },
      { status: 400 },
    );
  }

  // For regular shifts, validate times
  if (shiftType === "regular") {
    if (!shiftStart || !shiftEnd) {
      return NextResponse.json(
        { error: "Start and end times are required for regular shifts" },
        { status: 400 },
      );
    }

    // Auto-detect crosses midnight
    const autoCrosses = shiftEnd < shiftStart;

    // Validate time direction
    if (shiftEnd <= shiftStart && !autoCrosses && crossesMidnight === false) {
      return NextResponse.json(
        { error: "End time must be after start time" },
        { status: 400 },
      );
    }

    const effectiveCrosses = crossesMidnight ?? autoCrosses;

    // Check overlap with existing shifts
    for (const ex of existing) {
      if (ex.shiftStart && ex.shiftEnd) {
        if (
          doShiftsOverlap(
            ex.shiftStart,
            ex.shiftEnd,
            ex.crossesMidnight,
            shiftStart,
            shiftEnd,
            effectiveCrosses,
          )
        ) {
          return NextResponse.json(
            {
              error: `This shift overlaps with the existing ${ex.shiftStart}-${ex.shiftEnd} shift`,
            },
            { status: 400 },
          );
        }

        // Check 30-minute gap for split shifts
        // Determine order: which shift comes first
        const existingStartMins = timeToMins(ex.shiftEnd);
        const newStartMins = timeToMins(shiftStart);
        if (newStartMins > existingStartMins) {
          // New shift is after existing
          const gap = getGapBetweenShifts(ex.shiftEnd, shiftStart);
          if (gap < 30) {
            return NextResponse.json(
              { error: "Split shifts must have at least a 30-minute gap" },
              { status: 400 },
            );
          }
        } else {
          // New shift is before existing
          const gap = getGapBetweenShifts(shiftEnd, ex.shiftStart);
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
      .insert(shifts)
      .values({
        scheduleId,
        employeeId,
        dayOfWeek,
        shiftType,
        shiftStart,
        shiftEnd,
        crossesMidnight: effectiveCrosses,
        breakMinutes,
        isSplit,
        splitPairId: splitPairId ?? null,
      })
      .returning();

    return NextResponse.json(row, { status: 201 });
  }

  // day_off or comp_day_off
  const [row] = await db
    .insert(shifts)
    .values({
      scheduleId,
      employeeId,
      dayOfWeek,
      shiftType,
      compDebitMins: shiftType === "comp_day_off" ? compDebitMins : 0,
    })
    .returning();

  // Create comp transaction for comp_day_off
  let warning: string | undefined;
  if (shiftType === "comp_day_off" && compDebitMins > 0) {
    // Get current balance
    const [lastTx] = await db
      .select({ balanceAfter: compTransactions.balanceAfter })
      .from(compTransactions)
      .where(eq(compTransactions.employeeId, employeeId))
      .orderBy(compTransactions.createdAt)
      .limit(1);

    const currentBalance = lastTx?.balanceAfter ?? 0;
    const newBalance = currentBalance - compDebitMins;

    await db.insert(compTransactions).values({
      employeeId,
      transactionDate: new Date().toISOString().split("T")[0],
      type: "comp_day_taken",
      minutes: -compDebitMins,
      balanceAfter: newBalance,
      sourceShiftId: row.id,
      createdBy: session.user.name ?? "admin",
    });

    if (newBalance < 0) {
      warning = `Employee balance will go negative: ${currentBalance} - ${compDebitMins} = ${newBalance}`;
    }
  }

  return NextResponse.json({ ...row, warning }, { status: 201 });
}

function timeToMins(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}
