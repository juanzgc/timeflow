import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { settings } from "@/drizzle/schema";
import { getBioTimeClient } from "./client";
import { syncTransactions } from "./transactions";
import { markConnected } from "./auth";
import { recalculateAffectedDays } from "./recalculate";
import { invalidateAttendance } from "@/lib/attendance/invalidate";

/**
 * Sync BioTime transactions if the last sync is older than `maxAgeMinutes`.
 *
 * Designed for read paths — silently skips if:
 *   - Another sync is already in progress
 *   - Data is fresh enough (< maxAgeMinutes)
 *   - BioTime is unreachable (swallows error, returns false)
 *
 * Returns `true` if a sync was performed, `false` otherwise.
 */
export async function syncIfStale(maxAgeMinutes = 5): Promise<boolean> {
  try {
    // If a full sync is already running, don't fight with it
    const [lockRow] = await db
      .select()
      .from(settings)
      .where(eq(settings.key, "sync_in_progress"))
      .limit(1);

    if (lockRow?.value === "true") {
      return false;
    }

    // Check freshness
    const [syncRow] = await db
      .select()
      .from(settings)
      .where(eq(settings.key, "last_sync_time"))
      .limit(1);

    if (syncRow?.value) {
      const lastSync = new Date(syncRow.value).getTime();
      const ageMs = Date.now() - lastSync;
      if (ageMs < maxAgeMinutes * 60 * 1000) {
        return false; // fresh enough
      }
    }

    // Stale — sync transactions only (no employee sync, that's heavier)
    const client = await getBioTimeClient();
    const result = await syncTransactions(client);

    // Update last_sync_time
    const now = new Date().toISOString();
    await db
      .insert(settings)
      .values({ key: "last_sync_time", value: now })
      .onConflictDoUpdate({ target: settings.key, set: { value: now } });

    await markConnected();

    if (result.affectedDays.length > 0) {
      await recalculateAffectedDays(result.affectedDays);
      invalidateAttendance();
    }

    return true;
  } catch {
    // BioTime unreachable — page still loads with existing data
    return false;
  }
}
