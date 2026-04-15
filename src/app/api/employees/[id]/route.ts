import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { employees } from "@/drizzle/schema";
import { auth } from "@/auth";

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
