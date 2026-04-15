import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { employees, groups } from "@/drizzle/schema";
import { auth } from "@/auth";

// GET /api/employees/[id] — single employee with group name
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const [row] = await db
    .select({
      id: employees.id,
      empCode: employees.empCode,
      cedula: employees.cedula,
      firstName: employees.firstName,
      lastName: employees.lastName,
      groupId: employees.groupId,
      groupName: groups.name,
      monthlySalary: employees.monthlySalary,
      restDay: employees.restDay,
      isActive: employees.isActive,
    })
    .from(employees)
    .leftJoin(groups, eq(employees.groupId, groups.id))
    .where(eq(employees.id, Number(id)))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  }

  return NextResponse.json(row);
}

// PUT /api/employees/[id] — update employee fields (groupId, salary, restDay, cedula)
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

  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (body.groupId !== undefined) {
    updates.groupId = body.groupId === null ? null : Number(body.groupId);
  }
  if (body.monthlySalary !== undefined) {
    updates.monthlySalary = body.monthlySalary;
  }
  if (body.restDay !== undefined) {
    updates.restDay = Number(body.restDay);
  }
  if (body.cedula !== undefined) {
    updates.cedula = body.cedula;
  }

  const [row] = await db
    .update(employees)
    .set(updates)
    .where(eq(employees.id, Number(id)))
    .returning();

  if (!row) {
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  }

  return NextResponse.json(row);
}
