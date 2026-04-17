import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { settings } from "@/drizzle/schema";
import { getBioTimeClient } from "@/lib/biotime/client";
import { syncEmployees } from "@/lib/biotime/employees";
import { syncTransactions } from "@/lib/biotime/transactions";
import { markConnected, markDisconnected } from "@/lib/biotime/auth";
import { recalculateAffectedDays } from "@/lib/biotime/recalculate";
import { invalidateAttendance } from "@/lib/attendance/invalidate";
import { auth } from "@/auth";

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

// ─── POST /api/biotime/sync ─────────────────────────────────────────────────

export async function POST(request: Request) {
  // Auth: accept cron secret OR authenticated session
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  const hasCronAuth = cronSecret && authHeader === `Bearer ${cronSecret}`;

  if (!hasCronAuth) {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
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
      invalidateAttendance();
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
