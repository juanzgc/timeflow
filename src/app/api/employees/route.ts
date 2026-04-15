import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { employees, groups } from "@/drizzle/schema";
import { auth } from "@/auth";

// GET /api/employees — list employees, optional ?groupId= filter
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const groupId = request.nextUrl.searchParams.get("groupId");

  const query = db
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
    .orderBy(employees.firstName, employees.lastName);

  const rows = groupId
    ? await query.where(eq(employees.groupId, Number(groupId)))
    : await query;

  return NextResponse.json(rows);
}
