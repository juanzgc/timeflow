import { NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { compTransactions } from "@/drizzle/schema";
import { auth } from "@/auth";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: idStr } = await params;
  const employeeId = parseInt(idStr, 10);
  if (isNaN(employeeId)) {
    return NextResponse.json({ error: "Invalid employee id" }, { status: 400 });
  }

  const records = await db
    .select()
    .from(compTransactions)
    .where(eq(compTransactions.employeeId, employeeId))
    .orderBy(desc(compTransactions.createdAt));

  return NextResponse.json(records);
}
