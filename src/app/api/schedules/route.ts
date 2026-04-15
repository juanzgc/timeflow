import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { weeklySchedules, shifts, groups, employees } from "@/drizzle/schema";
import { auth } from "@/auth";

// GET /api/schedules?weekStart=2026-04-13 — list schedules for a week
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const weekStart = request.nextUrl.searchParams.get("weekStart");
  if (!weekStart) {
    return NextResponse.json(
      { error: "weekStart query parameter is required" },
      { status: 400 },
    );
  }

  const rows = await db
    .select({
      id: weeklySchedules.id,
      weekStart: weeklySchedules.weekStart,
      groupId: weeklySchedules.groupId,
      groupName: groups.name,
      shiftCount: sql<number>`count(${shifts.id})::int`,
      coveredSlots: sql<number>`count(distinct (${shifts.employeeId}, ${shifts.dayOfWeek}))::int`,
    })
    .from(weeklySchedules)
    .leftJoin(groups, eq(weeklySchedules.groupId, groups.id))
    .leftJoin(shifts, eq(shifts.scheduleId, weeklySchedules.id))
    .where(eq(weeklySchedules.weekStart, weekStart))
    .groupBy(weeklySchedules.id, groups.name);

  // Count active employees per group to determine completeness
  const groupIds = rows.map((r) => r.groupId);
  let employeeCounts: Record<number, number> = {};
  if (groupIds.length > 0) {
    const empRows = await db
      .select({
        groupId: employees.groupId,
        count: sql<number>`count(*)::int`,
      })
      .from(employees)
      .where(and(eq(employees.isActive, true), sql`${employees.groupId} in ${groupIds}`))
      .groupBy(employees.groupId);

    employeeCounts = Object.fromEntries(empRows.map((r) => [r.groupId!, r.count]));
  }

  const schedules = rows.map((r) => ({
    ...r,
    employeeCount: employeeCounts[r.groupId] ?? 0,
  }));

  return NextResponse.json({ schedules });
}

// POST /api/schedules — create a weekly schedule
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { weekStart, groupId } = body;

  if (!weekStart || !groupId) {
    return NextResponse.json(
      { error: "weekStart and groupId are required" },
      { status: 400 },
    );
  }

  // Check if schedule already exists
  const existing = await db
    .select({ id: weeklySchedules.id })
    .from(weeklySchedules)
    .where(
      and(
        eq(weeklySchedules.weekStart, weekStart),
        eq(weeklySchedules.groupId, Number(groupId)),
      ),
    )
    .limit(1);

  if (existing.length) {
    return NextResponse.json(
      { error: "Schedule already exists for this week and group", id: existing[0].id },
      { status: 409 },
    );
  }

  const [row] = await db
    .insert(weeklySchedules)
    .values({
      weekStart,
      groupId: Number(groupId),
      createdBy: session.user.name ?? "admin",
    })
    .returning();

  return NextResponse.json(row, { status: 201 });
}
