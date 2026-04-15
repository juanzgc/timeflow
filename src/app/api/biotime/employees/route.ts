import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getBioTimeClient } from "@/lib/biotime/client";
import { syncEmployees } from "@/lib/biotime/employees";
import { markConnected, markDisconnected } from "@/lib/biotime/auth";

/**
 * POST /api/biotime/employees
 * Manual trigger for employee-only sync.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const client = await getBioTimeClient();
    const result = await syncEmployees(client);
    await markConnected();

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Employee sync failed";
    await markDisconnected(message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
