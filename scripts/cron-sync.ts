/**
 * Railway Cron Job — BioTime Sync
 *
 * This script is executed by Railway's cron service every 10 minutes.
 * It calls the sync endpoint on the main web service over Railway's
 * private network, then exits.
 *
 * Start command: npx tsx scripts/cron-sync.ts
 */

const APP_URL = process.env.RAILWAY_PRIVATE_DOMAIN
  ? `http://${process.env.RAILWAY_PRIVATE_DOMAIN}:3000`
  : "http://localhost:3000";

const CRON_SECRET = process.env.CRON_SECRET;

async function main() {
  if (!CRON_SECRET) {
    console.error("[cron] CRON_SECRET env var is not set");
    process.exit(1);
  }

  console.log(
    `[cron] Triggering sync at ${new Date().toISOString()} → ${APP_URL}/api/biotime/sync`,
  );

  const res = await fetch(`${APP_URL}/api/biotime/sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CRON_SECRET}`,
      "Content-Type": "application/json",
    },
  });

  const body = await res.json();

  if (!res.ok) {
    console.error(`[cron] Sync failed (${res.status}):`, JSON.stringify(body));
    process.exit(1);
  }

  console.log("[cron] Sync complete:", JSON.stringify(body));
  process.exit(0);
}

main().catch((err) => {
  console.error("[cron] Fatal error:", err);
  process.exit(1);
});
