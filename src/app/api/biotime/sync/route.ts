import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { employees, punchLogs, settings } from "@/drizzle/schema";
import { fetchEmployees, fetchTransactions } from "@/lib/biotime-client";

// POST /api/biotime/sync — trigger full sync (employees + transactions)
export async function POST(request: Request) {
  // Verify API key for cron access (or session for manual trigger)
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    // If no cron secret configured, skip this check (dev mode)
    if (cronSecret !== "") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const employeeResult = await syncEmployees();
    const transactionResult = await syncTransactions();

    // Update last sync time
    const now = new Date().toISOString();
    await db
      .insert(settings)
      .values({ key: "last_sync_time", value: now })
      .onConflictDoUpdate({ target: settings.key, set: { value: now } });

    return NextResponse.json({
      success: true,
      employees: employeeResult,
      transactions: transactionResult,
      syncedAt: now,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown sync error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function syncEmployees() {
  const remote = await fetchEmployees();
  let created = 0;
  let updated = 0;

  for (const emp of remote) {
    const existing = await db
      .select()
      .from(employees)
      .where(eq(employees.empCode, emp.emp_code))
      .limit(1);

    if (existing.length) {
      await db
        .update(employees)
        .set({
          firstName: emp.first_name,
          lastName: emp.last_name,
          biotimeId: emp.id,
          syncedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(employees.empCode, emp.emp_code));
      updated++;
    } else {
      await db.insert(employees).values({
        empCode: emp.emp_code,
        firstName: emp.first_name,
        lastName: emp.last_name,
        biotimeId: emp.id,
        syncedAt: new Date(),
      });
      created++;
    }
  }

  return { total: remote.length, created, updated };
}

async function syncTransactions() {
  // Get last sync time
  const lastSyncRow = await db
    .select()
    .from(settings)
    .where(eq(settings.key, "last_sync_time"))
    .limit(1);

  const lastSync = lastSyncRow[0]?.value;

  // Default to 24 hours ago if no previous sync
  const startTime =
    lastSync || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const endTime = new Date().toISOString();

  const remote = await fetchTransactions(startTime, endTime);
  let inserted = 0;
  let skipped = 0;

  for (const tx of remote) {
    // Skip if already synced (by biotime_id)
    const existing = await db
      .select({ id: punchLogs.id })
      .from(punchLogs)
      .where(eq(punchLogs.biotimeId, tx.id))
      .limit(1);

    if (existing.length) {
      skipped++;
      continue;
    }

    await db.insert(punchLogs).values({
      empCode: tx.emp_code,
      punchTime: new Date(tx.punch_time),
      punchState: tx.punch_state,
      verifyType: tx.verify_type,
      terminalSn: tx.terminal_sn,
      biotimeId: tx.id,
      source: "biotime",
    });
    inserted++;
  }

  return { total: remote.length, inserted, skipped };
}
