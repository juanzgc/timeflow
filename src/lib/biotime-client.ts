import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { settings } from "@/drizzle/schema";

interface BioTimeConfig {
  url: string;
  token: string;
}

interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface BioTimeEmployee {
  id: number;
  emp_code: string;
  first_name: string;
  last_name: string;
  department?: { id: number; dept_name: string };
}

export interface BioTimeTransaction {
  id: number;
  emp_code: string;
  punch_time: string;
  punch_state: string; // '0'=in, '1'=out
  verify_type: number;
  terminal_sn: string;
}

// ─── Token management ───────────────────────────────────────────────────────

async function getConfig(): Promise<BioTimeConfig> {
  const rows = await db
    .select()
    .from(settings)
    .where(eq(settings.key, "biotime_url"))
    .limit(1);

  const tokenRows = await db
    .select()
    .from(settings)
    .where(eq(settings.key, "biotime_token"))
    .limit(1);

  const url = rows[0]?.value;
  if (!url) throw new Error("BioTime URL not configured");

  return { url, token: tokenRows[0]?.value ?? "" };
}

async function saveToken(token: string) {
  await db
    .insert(settings)
    .values({ key: "biotime_token", value: token })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: token },
    });
}

async function authenticate(): Promise<string> {
  const url = process.env.BIOTIME_URL;
  const username = process.env.BIOTIME_USERNAME;
  const password = process.env.BIOTIME_PASSWORD;

  if (!url || !username || !password) {
    throw new Error("BioTime credentials not configured in environment");
  }

  const res = await fetch(`${url}/jwt-api-token-auth/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  if (!res.ok) {
    throw new Error(`BioTime auth failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { token: string };
  await saveToken(data.token);
  return data.token;
}

// ─── API request helper ─────────────────────────────────────────────────────

async function apiFetch<T>(
  path: string,
  params?: Record<string, string>,
): Promise<T> {
  const config = await getConfig();
  let token = config.token;

  // If no token stored, authenticate first
  if (!token) {
    token = await authenticate();
  }

  const url = new URL(path, config.url);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }

  let res = await fetch(url.toString(), {
    headers: { Authorization: `JWT ${token}` },
  });

  // Token expired — re-authenticate and retry once
  if (res.status === 401) {
    token = await authenticate();
    res = await fetch(url.toString(), {
      headers: { Authorization: `JWT ${token}` },
    });
  }

  if (!res.ok) {
    throw new Error(
      `BioTime API error: ${res.status} ${res.statusText} (${path})`,
    );
  }

  return res.json() as Promise<T>;
}

// ─── Paginated fetcher ──────────────────────────────────────────────────────

async function fetchAllPages<T>(
  path: string,
  params?: Record<string, string>,
): Promise<T[]> {
  const all: T[] = [];
  const pageSize = "100";

  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const data = await apiFetch<PaginatedResponse<T>>(path, {
      ...params,
      page: String(page),
      page_size: pageSize,
    });

    all.push(...data.results);
    hasMore = data.next !== null;
    page++;
  }

  return all;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function fetchEmployees(): Promise<BioTimeEmployee[]> {
  return fetchAllPages<BioTimeEmployee>("/personnel/api/employees/");
}

export async function fetchTransactions(
  startTime: string,
  endTime: string,
): Promise<BioTimeTransaction[]> {
  return fetchAllPages<BioTimeTransaction>("/iclock/api/transactions/", {
    start_time: startTime,
    end_time: endTime,
    page_size: "5000",
  });
}

export async function testConnection(): Promise<boolean> {
  try {
    await apiFetch("/iclock/api/terminals/?page_size=1");
    return true;
  } catch {
    return false;
  }
}
