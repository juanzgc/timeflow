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

// ─── Background sync runner ─────────────────────────────────────────────────

async function runSync(): Promise<void> {
  const startedAt = new Date();
  console.info(
    `[biotime-sync-async][info] Sync started at ${startedAt.toISOString()}`,
  );

  try {
    const client = await getBioTimeClient();

    const employeeResult = await syncEmployees(client);
    const transactionResult = await syncTransactions(client);

    const now = new Date().toISOString();
    await db
      .insert(settings)
      .values({ key: "last_sync_time", value: now })
      .onConflictDoUpdate({ target: settings.key, set: { value: now } });

    await markConnected();

    if (transactionResult.affectedDays.length > 0) {
      await recalculateAffectedDays(transactionResult.affectedDays);
      invalidateAttendance();
    }

    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt.getTime();
    console.info(
      `[biotime-sync-async][info] Sync finished at ${finishedAt.toISOString()} (${durationMs}ms)`,
      { employees: employeeResult, transactions: transactionResult },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown sync error";
    await markDisconnected(message);
    console.error(
      `[biotime-sync-async][error] Sync failed: ${message}`,
      error,
    );
  } finally {
    await releaseLock();
  }
}

// ─── POST /api/biotime/sync-async ───────────────────────────────────────────

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

  // Fire-and-forget: kick off the sync without awaiting it.
  void runSync();

  return NextResponse.json({ success: true, queued: true }, { status: 202 });
}
