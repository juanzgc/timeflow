import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { employees, settings } from "@/drizzle/schema";
import { getBioTimeClient } from "@/lib/biotime/client";
import { syncEmployees } from "@/lib/biotime/employees";
import { syncTransactions } from "@/lib/biotime/transactions";
import { markConnected, markDisconnected } from "@/lib/biotime/auth";
import { calculateAttendance } from "@/lib/engine/attendance-calculator";

// ─── Concurrency lock helpers ───────────────────────────────────────────────

async function acquireLock(): Promise<boolean> {
  const row = await db
    .select()
    .from(settings)
    .where(eq(settings.key, "sync_in_progress"))
    .limit(1);

  if (row[0]?.value === "true") {
    return false; // already running
  }

  await db
    .insert(settings)
    .values({ key: "sync_in_progress", value: "true" })
    .onConflictDoUpdate({ target: settings.key, set: { value: "true" } });

  return true;
}

async function releaseLock(): Promise<void> {
  await db
    .insert(settings)
    .values({ key: "sync_in_progress", value: "false" })
    .onConflictDoUpdate({ target: settings.key, set: { value: "false" } });
}

// ─── Recalculate affected days ──────────────────────────────────────────────

async function recalculateAffectedDays(
  affectedDays: string[],
): Promise<void> {
  // Group affected days by empCode
  const byEmployee = new Map<string, Set<string>>();
  for (const entry of affectedDays) {
    const [empCode, date] = entry.split(":");
    if (!byEmployee.has(empCode)) byEmployee.set(empCode, new Set());
    byEmployee.get(empCode)!.add(date);
  }

  for (const [empCode, dates] of byEmployee) {
    // Look up employee ID
    const [emp] = await db
      .select({ id: employees.id })
      .from(employees)
      .where(eq(employees.empCode, empCode))
      .limit(1);

    if (!emp) continue;

    const sortedDates = Array.from(dates).sort();
    const startDate = sortedDates[0];
    const endDate = sortedDates[sortedDates.length - 1];

    // Call engine directly — no HTTP, no auth needed
    try {
      await calculateAttendance({
        employeeId: emp.id,
        startDate,
        endDate,
      });
    } catch {
      // Best-effort recalculation — don't fail the sync
    }
  }
}

// ─── POST /api/biotime/sync ─────────────────────────────────────────────────

export async function POST(request: Request) {
  // Auth: accept cron secret or session cookie
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && cronSecret !== "" && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Concurrency lock
  const acquired = await acquireLock();
  if (!acquired) {
    return NextResponse.json(
      { error: "Sync already in progress" },
      { status: 409 },
    );
  }

  try {
    const client = await getBioTimeClient();

    const employeeResult = await syncEmployees(client);
    const transactionResult = await syncTransactions(client);

    // Update last sync time
    const now = new Date().toISOString();
    await db
      .insert(settings)
      .values({ key: "last_sync_time", value: now })
      .onConflictDoUpdate({ target: settings.key, set: { value: now } });

    await markConnected();

    // Recalculate attendance for affected days (best-effort, direct engine call)
    if (transactionResult.affectedDays.length > 0) {
      await recalculateAffectedDays(transactionResult.affectedDays);
    }

    return NextResponse.json({
      success: true,
      employees: employeeResult,
      transactions: transactionResult,
      syncedAt: now,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown sync error";
    await markDisconnected(message);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await releaseLock();
  }
}
