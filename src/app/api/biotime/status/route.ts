import { NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { settings } from "@/drizzle/schema";
import { auth } from "@/auth";
import type { BioTimeStatus } from "@/lib/biotime/types";

const STALE_THRESHOLD_MINUTES = 30;

/**
 * GET /api/biotime/status
 * Returns current BioTime connection status and sync info.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const keys = [
    "biotime_connected",
    "last_sync_time",
    "biotime_last_error",
    "sync_in_progress",
  ];

  const rows = await db
    .select()
    .from(settings)
    .where(inArray(settings.key, keys));

  const map = new Map(rows.map((r) => [r.key, r.value]));

  const connected = map.get("biotime_connected") === "true";
  const lastSync = map.get("last_sync_time") || null;
  const lastError = map.get("biotime_last_error") || null;
  const syncInProgress = map.get("sync_in_progress") === "true";

  let minutesAgo: number | null = null;
  let isStale = false;

  if (lastSync) {
    const elapsed = Date.now() - new Date(lastSync).getTime();
    minutesAgo = Math.round(elapsed / 60_000);
    isStale = minutesAgo > STALE_THRESHOLD_MINUTES;
  }

  const status: BioTimeStatus = {
    connected,
    lastSync,
    minutesAgo,
    isStale,
    lastError: lastError || null,
    syncInProgress,
  };

  return NextResponse.json(status);
}
