import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { settings } from "@/drizzle/schema";

// ─── Token management ───────────────────────────────────────────────────────

export async function loadToken(): Promise<string | null> {
  const rows = await db
    .select()
    .from(settings)
    .where(eq(settings.key, "biotime_token"))
    .limit(1);
  return rows[0]?.value || null;
}

export async function saveToken(token: string): Promise<void> {
  await db
    .insert(settings)
    .values({ key: "biotime_token", value: token })
    .onConflictDoUpdate({ target: settings.key, set: { value: token } });
}

// ─── Credentials ────────────────────────────────────────────────────────────

export interface BioTimeCredentials {
  url: string;
  username: string;
  password: string;
}

/** Read credentials from settings table, falling back to env vars. */
export async function getCredentials(): Promise<BioTimeCredentials> {
  const keys = ["biotime_url", "biotime_username", "biotime_password"] as const;
  const rows = await db
    .select()
    .from(settings)
    .where(
      // drizzle doesn't have inArray for text PKs easily, so fetch all and filter
      eq(settings.key, keys[0]),
    );

  // Fetch all three
  const urlRow = rows[0]?.value;
  const usernameRow = await db
    .select()
    .from(settings)
    .where(eq(settings.key, "biotime_username"))
    .limit(1);
  const passwordRow = await db
    .select()
    .from(settings)
    .where(eq(settings.key, "biotime_password"))
    .limit(1);

  const url = urlRow || process.env.BIOTIME_URL;
  const username = usernameRow[0]?.value || process.env.BIOTIME_USERNAME;
  const password = passwordRow[0]?.value || process.env.BIOTIME_PASSWORD;

  if (!url || !username || !password) {
    throw new Error("BioTime credentials not configured");
  }

  return { url, username, password };
}

/** Read just the base URL from settings or env. */
export async function getBaseUrl(): Promise<string> {
  const rows = await db
    .select()
    .from(settings)
    .where(eq(settings.key, "biotime_url"))
    .limit(1);

  const url = rows[0]?.value || process.env.BIOTIME_URL;
  if (!url) throw new Error("BioTime URL not configured");
  return url;
}

// ─── Authentication ─────────────────────────────────────────────────────────

/** Authenticate with BioTime and return a JWT token. */
export async function authenticate(
  baseUrl: string,
  username: string,
  password: string,
): Promise<string> {
  const res = await fetch(`${baseUrl}/jwt-api-token-auth/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`BioTime auth failed: ${res.status} ${res.statusText} — ${body}`);
  }

  const data = (await res.json()) as { token: string };
  return data.token;
}

/** Refresh a BioTime JWT token. */
export async function refreshToken(
  baseUrl: string,
  currentToken: string,
): Promise<string> {
  const res = await fetch(`${baseUrl}/jwt-api-token-refresh/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: currentToken }),
  });

  if (!res.ok) {
    throw new Error(`BioTime token refresh failed: ${res.status}`);
  }

  const data = (await res.json()) as { token: string };
  return data.token;
}

// ─── Connection status helpers ──────────────────────────────────────────────

export async function markConnected(): Promise<void> {
  await db
    .insert(settings)
    .values({ key: "biotime_connected", value: "true" })
    .onConflictDoUpdate({ target: settings.key, set: { value: "true" } });
  await db
    .insert(settings)
    .values({ key: "biotime_last_error", value: "" })
    .onConflictDoUpdate({ target: settings.key, set: { value: "" } });
}

export async function markDisconnected(errorMsg: string): Promise<void> {
  await db
    .insert(settings)
    .values({ key: "biotime_connected", value: "false" })
    .onConflictDoUpdate({ target: settings.key, set: { value: "false" } });
  await db
    .insert(settings)
    .values({ key: "biotime_last_error", value: errorMsg })
    .onConflictDoUpdate({ target: settings.key, set: { value: errorMsg } });
}
