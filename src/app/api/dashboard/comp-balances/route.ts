import { NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { employees, compTransactions } from "@/drizzle/schema";
import { auth } from "@/auth";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get latest comp balance for each active employee using a lateral join approach
  // We'll use a subquery for each employee
  const activeEmps = await db
    .select({
      id: employees.id,
      firstName: employees.firstName,
      lastName: employees.lastName,
    })
    .from(employees)
    .where(eq(employees.isActive, true));

  const results = [];
  for (const emp of activeEmps) {
    const [latest] = await db
      .select({ balanceAfter: compTransactions.balanceAfter })
      .from(compTransactions)
      .where(eq(compTransactions.employeeId, emp.id))
      .orderBy(desc(compTransactions.createdAt))
      .limit(1);

    results.push({
      id: emp.id,
      firstName: emp.firstName,
      lastName: emp.lastName,
      compBalance: latest?.balanceAfter ?? 0,
    });
  }

  // Sort by balance descending
  results.sort((a, b) => b.compBalance - a.compBalance);

  return NextResponse.json(results);
}
