import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { punchLogs, settings } from "@/drizzle/schema";
import type { BioTimeClient } from "./client";
import type { BioTimeTransaction, TransactionSyncResult } from "./types";
import { colFullYear, colMonth, colDate, colHours, colMinutes } from "@/lib/timezone";

/** Parse a BioTime timestamp (no timezone) as Colombia time (UTC-5). */
function parseColombia(timestamp: string): Date {
  // BioTime sends "YYYY-MM-DD HH:mm:ss" with no offset — it's Colombia local time.
  // Append the offset so it's parsed correctly regardless of server timezone.
  return new Date(timestamp.replace(" ", "T") + "-05:00");
}

/**
 * Format a Date (or ISO string) as Colombia local time for BioTime API params.
 * BioTime expects timestamps in Colombia local time (no offset suffix).
 */
function formatForBioTime(d: Date): string {
  const y = colFullYear(d);
  const mo = String(colMonth(d) + 1).padStart(2, "0");
  const day = String(colDate(d)).padStart(2, "0");
  const h = String(colHours(d)).padStart(2, "0");
  const mi = String(colMinutes(d)).padStart(2, "0");
  const s = "00";
  return `${y}-${mo}-${day} ${h}:${mi}:${s}`;
}

/**
 * Sync transactions from BioTime.
 * - First sync (no last_sync_time): fetches ALL transactions
 * - Incremental: uses last_sync_time as start_time
 * - Skips duplicates via biotimeId check
 * - Tracks affected days for recalculation
 */
export async function syncTransactions(
  client: BioTimeClient,
): Promise<TransactionSyncResult> {
  // Get last sync time
  const lastSyncRow = await db
    .select()
    .from(settings)
    .where(eq(settings.key, "last_sync_time"))
    .limit(1);

  const lastSync = lastSyncRow[0]?.value;

  // Build time params
  const params: Record<string, string> = {
    page_size: "5000",
  };

  if (lastSync) {
    // Incremental: fetch from last sync time to now.
    // Both must be Colombia local time — BioTime operates in local time.
    // lastSync is stored as UTC ISO string, so parse it and convert.
    params.start_time = formatForBioTime(new Date(lastSync));
    params.end_time = formatForBioTime(new Date());
  }
  // If no lastSync, omit time params to fetch ALL transactions

  const remote = await client.fetchAllPages<BioTimeTransaction>(
    "/iclock/api/transactions/",
    params,
  );

  let inserted = 0;
  let skipped = 0;
  const affectedDaysSet = new Set<string>();

  for (const tx of remote) {
    // Check duplicate by biotime_id
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
      punchTime: parseColombia(tx.punch_time),
      punchState: tx.punch_state,
      verifyType: tx.verify_type,
      terminalSn: tx.terminal_sn,
      biotimeId: tx.id,
      source: "biotime",
    });
    inserted++;

    // Track affected day: empCode:YYYY-MM-DD
    const businessDay = extractBusinessDay(tx.punch_time);
    affectedDaysSet.add(`${tx.emp_code}:${businessDay}`);
  }

  return {
    total: remote.length,
    inserted,
    skipped,
    affectedDays: Array.from(affectedDaysSet),
  };
}

/**
 * Extract the business day (YYYY-MM-DD) from a punch timestamp.
 * Punches between midnight and 6 AM are considered part of the previous day
 * (to handle midnight-crossing shifts).
 */
export function extractBusinessDay(punchTime: string): string {
  // Work directly from the Colombia local time string to avoid timezone issues.
  // BioTime format: "YYYY-MM-DD HH:mm:ss"
  const [datePart, timePart] = punchTime.split(" ");
  const hour = parseInt(timePart.split(":")[0], 10);

  // If punch is between 00:00–05:59, it belongs to the previous business day
  if (hour < 6) {
    const d = new Date(datePart + "T12:00:00"); // noon to avoid any DST edge cases
    d.setDate(d.getDate() - 1);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  return datePart;
}
