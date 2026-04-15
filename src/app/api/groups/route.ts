import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { groups, employees } from "@/drizzle/schema";
import { auth } from "@/auth";

// GET /api/groups — list all groups with employee count
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db
    .select({
      id: groups.id,
      name: groups.name,
      createdAt: groups.createdAt,
      employeeCount: sql<number>`count(${employees.id})::int`,
    })
    .from(groups)
    .leftJoin(
      employees,
      sql`${employees.groupId} = ${groups.id} AND ${employees.isActive} = true`,
    )
    .groupBy(groups.id)
    .orderBy(groups.name);

  return NextResponse.json(rows);
}

// POST /api/groups — create a new group
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const name = (body.name as string)?.trim();
  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const [row] = await db.insert(groups).values({ name }).returning();
  return NextResponse.json(row, { status: 201 });
}
