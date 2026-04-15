# Phase 1B — BioTime API Client (Detailed Specification)

## Overview

Build a robust BioTime API client with automatic token management, retry logic, paginated data fetching, and a 10-minute cron sync. This client is the single interface between TimeFlow and the BioTime server — no other part of the app talks to BioTime directly.

---

## File Structure

```
src/lib/biotime/
├── client.ts              # Core HTTP client with token retry interceptor
├── auth.ts                # Token management (get, refresh, re-auth)
├── employees.ts           # Employee sync logic
├── transactions.ts        # Punch log sync logic
├── terminals.ts           # Device info (for settings page)
├── types.ts               # TypeScript interfaces for all BioTime responses
└── __tests__/
    ├── client.test.ts
    ├── auth.test.ts
    ├── employees.test.ts
    └── transactions.test.ts

src/app/api/biotime/
├── sync/route.ts          # POST — cron-triggered sync endpoint
├── test-connection/route.ts  # POST — test connection from settings page
├── employees/route.ts     # POST — manual employee sync trigger
└── status/route.ts        # GET — connection status + last sync time
```

---

## Core Client (`client.ts`)

### Purpose
A single `request()` method that every BioTime call goes through. Handles auth headers, token refresh on 401, and error normalization.

### Interface

```typescript
interface BioTimeClientConfig {
  baseUrl: string;        // e.g., "https://biotime.zelavi.co"
  username: string;
  password: string;
}

interface BioTimeRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  params?: Record<string, string>;     // query params
  body?: Record<string, unknown>;      // JSON body
  timeout?: number;                     // ms, default 15000
}

interface BioTimeResponse<T> {
  data: T;
  status: number;
}

interface BioTimeError {
  status: number;
  message: string;
  endpoint: string;
  isAuthError: boolean;
  isNetworkError: boolean;
}
```

### Implementation

```typescript
class BioTimeClient {
  private baseUrl: string;
  private token: string | null = null;
  private isRefreshing: boolean = false;

  constructor(private config: BioTimeClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, ''); // strip trailing slash
  }

  // ─── Main request method ───────────────────────────────────
  async request<T>(path: string, options: BioTimeRequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, timeout = 15000 } = options;

    // 1. Ensure we have a token
    if (!this.token) {
      this.token = await this.loadToken();
    }
    if (!this.token) {
      this.token = await this.authenticate();
    }
    if (!this.token) {
      throw this.createError(0, 'No token available — authentication failed', path);
    }

    // 2. Build URL with query params
    const url = this.buildUrl(path, params);

    // 3. First attempt
    let response = await this.fetchWithTimeout(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `JWT ${this.token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    }, timeout);

    // 4. Handle 401 — token expired
    if (response.status === 401) {
      const newToken = await this.handleTokenExpiry();
      if (!newToken) {
        await this.markDisconnected();
        throw this.createError(401, 'Authentication failed after retry', path);
      }

      // 5. Retry with new token (once only)
      response = await this.fetchWithTimeout(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `JWT ${newToken}`,
        },
        body: body ? JSON.stringify(body) : undefined,
      }, timeout);
    }

    // 6. Handle non-OK responses
    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw this.createError(response.status, errorBody || response.statusText, path);
    }

    // 7. Parse and return
    return response.json();
  }

  // ─── Token retry flow ──────────────────────────────────────
  private async handleTokenExpiry(): Promise<string | null> {
    // Prevent concurrent refresh attempts
    if (this.isRefreshing) {
      // Wait for the other refresh to complete
      await this.waitForRefresh();
      return this.token;
    }

    this.isRefreshing = true;
    try {
      // Step A: Try refresh (fast, doesn't need credentials)
      const refreshed = await this.refreshToken();
      if (refreshed) {
        this.token = refreshed;
        await this.saveToken(refreshed);
        return refreshed;
      }

      // Step B: Refresh failed — full re-auth with credentials
      const newToken = await this.authenticate();
      if (newToken) {
        this.token = newToken;
        await this.saveToken(newToken);
        return newToken;
      }

      // Step C: Everything failed
      return null;
    } finally {
      this.isRefreshing = false;
    }
  }

  // ─── Helpers ───────────────────────────────────────────────
  private buildUrl(path: string, params?: Record<string, string>): string {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.set(key, value);
      });
    }
    return url.toString();
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw this.createError(0, `Request timed out after ${timeoutMs}ms`, url);
      }
      throw this.createError(0, `Network error: ${err}`, url);
    } finally {
      clearTimeout(timer);
    }
  }

  private createError(status: number, message: string, endpoint: string): BioTimeError {
    return {
      status,
      message,
      endpoint,
      isAuthError: status === 401 || status === 403,
      isNetworkError: status === 0,
    };
  }

  private async waitForRefresh(): Promise<void> {
    // Poll until isRefreshing becomes false
    let attempts = 0;
    while (this.isRefreshing && attempts < 50) {
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }
  }
}
```

---

## Auth Module (`auth.ts`)

### Token Storage

Tokens and credentials are stored in the `settings` table:

```
key                  | value
biotime_url          | https://biotime.zelavi.co
biotime_username     | admin
biotime_password     | (encrypted or plain — see security note)
biotime_token        | eyJ0eXAiOiJKV1Qi...
biotime_connected    | true
biotime_last_error   | (empty or error message)
```

### Authentication

```typescript
async function authenticate(): Promise<string | null> {
  const { username, password } = await getCredentials();

  const response = await fetch(`${baseUrl}/jwt-api-token-auth/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  if (!response.ok) {
    await updateSetting('biotime_last_error', `Auth failed: ${response.status}`);
    return null;
  }

  const data = await response.json();
  // data = { "token": "eyJ0eXAi..." }

  await saveToken(data.token);
  await updateSetting('biotime_connected', 'true');
  await updateSetting('biotime_last_error', '');
  return data.token;
}
```

### Token Refresh

```typescript
async function refreshToken(): Promise<string | null> {
  const currentToken = await loadToken();
  if (!currentToken) return null;

  const response = await fetch(`${baseUrl}/jwt-api-token-refresh/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: currentToken }),
  });

  if (!response.ok) {
    // Token too old to refresh — caller will try full re-auth
    return null;
  }

  const data = await response.json();
  // data = { "token": "eyJnew..." }
  return data.token;
}
```

### Load/Save Token

```typescript
async function loadToken(): Promise<string | null> {
  const result = await db
    .select()
    .from(settings)
    .where(eq(settings.key, 'biotime_token'));
  return result[0]?.value || null;
}

async function saveToken(token: string): Promise<void> {
  await db
    .insert(settings)
    .values({ key: 'biotime_token', value: token })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: token },
    });
}

async function getCredentials(): Promise<{ username: string; password: string }> {
  const rows = await db
    .select()
    .from(settings)
    .where(
      inArray(settings.key, ['biotime_username', 'biotime_password'])
    );
  const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
  return {
    username: map['biotime_username'] || '',
    password: map['biotime_password'] || '',
  };
}
```

### Security Note

For v1, the BioTime password is stored as plaintext in the settings table. This is acceptable because:
- The database is private (Railway, not publicly accessible)
- Only 1-2 admin users have access to the app
- The BioTime API itself only accepts plaintext credentials

For future hardening:
- Encrypt the password at rest using `crypto.createCipheriv` with a key from `BIOTIME_ENCRYPTION_KEY` env var
- Decrypt on each API call
- This is a Phase 7+ improvement, not blocking for launch

---

## Employee Sync (`employees.ts`)

### Purpose
Fetch all employees from BioTime and sync to the local `employees` table. New employees are created, existing ones are updated.

### BioTime Employee Response

```typescript
interface BioTimeEmployee {
  id: number;                // BioTime internal ID
  emp_code: string;          // Employee code (unique)
  first_name: string;
  last_name: string;
  department: {
    id: number;
    dept_code: string;
    dept_name: string;
  } | null;
  position: {
    id: number;
    position_code: string;
    position_name: string;
  } | null;
  area: { id: number; area_name: string } | null;
  hire_date: string | null;
  is_active: boolean;        // BioTime status, NOT our is_active
}

interface BioTimePaginatedResponse<T> {
  count: number;
  next: string | null;       // URL for next page, null if last
  previous: string | null;
  data: T[];
}
```

### Sync Algorithm

```typescript
async function syncEmployees(): Promise<SyncResult> {
  const client = await getBioTimeClient();
  const syncedAt = new Date();
  let created = 0;
  let updated = 0;
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const response = await client.request<BioTimePaginatedResponse<BioTimeEmployee>>(
      '/personnel/api/employees/',
      { params: { page: String(page), page_size: '100' } }
    );

    for (const emp of response.data) {
      const existing = await db
        .select()
        .from(employees)
        .where(eq(employees.empCode, emp.emp_code))
        .limit(1);

      if (existing.length > 0) {
        // Update existing — only sync name and biotime fields
        // Do NOT overwrite: group, salary, cedula, rest_day (manager-set fields)
        await db
          .update(employees)
          .set({
            firstName: emp.first_name,
            lastName: emp.last_name,
            biotimeId: emp.id,
            syncedAt,
            updatedAt: new Date(),
          })
          .where(eq(employees.empCode, emp.emp_code));
        updated++;
      } else {
        // Create new — no group, salary, or cedula yet
        await db.insert(employees).values({
          empCode: emp.emp_code,
          firstName: emp.first_name,
          lastName: emp.last_name,
          biotimeId: emp.id,
          isActive: true,
          syncedAt,
        });
        created++;
      }
    }

    hasMore = response.next !== null;
    page++;
  }

  return { created, updated, syncedAt };
}
```

**IMPORTANT:** The sync only updates `firstName`, `lastName`, `biotimeId`, and `syncedAt`. It NEVER touches `groupId`, `monthlySalary`, `cedula`, `restDay`, or `isActive` — those are manager-controlled fields. This prevents BioTime from overwriting business data.

---

## Transaction Sync (`transactions.ts`)

### Purpose
Fetch new punch transactions from BioTime since the last sync and insert into `punch_logs`.

### BioTime Transaction Response

```typescript
interface BioTimeTransaction {
  id: number;                // BioTime transaction ID (our biotime_id)
  emp_code: string;
  punch_time: string;        // "2026-04-14 17:30:22" (local time, no timezone)
  punch_state: string;       // "0" = check-in, "1" = check-out
  verify_type: number;       // 1=fingerprint, 4=face, 15=palm, etc.
  terminal_sn: string;       // device serial number
  terminal_alias: string;
  area_alias: string;
  upload_time: string;       // when BioTime received it
}
```

### Sync Algorithm

```typescript
interface TransactionSyncResult {
  fetched: number;           // total transactions from BioTime
  inserted: number;          // new punch_logs created
  skipped: number;           // duplicates (already existed)
  affectedDays: Set<string>; // "empCode:YYYY-MM-DD" pairs for recalculation
  syncedAt: Date;
}

async function syncTransactions(): Promise<TransactionSyncResult> {
  const client = await getBioTimeClient();
  const lastSync = await getLastSyncTime();
  const now = new Date();
  const result: TransactionSyncResult = {
    fetched: 0,
    inserted: 0,
    skipped: 0,
    affectedDays: new Set(),
    syncedAt: now,
  };

  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const params: Record<string, string> = {
      page: String(page),
      page_size: '500',
    };

    // Only filter by start_time if we have a previous sync
    if (lastSync) {
      params.start_time = formatBioTimeDate(lastSync);
    }
    params.end_time = formatBioTimeDate(now);

    const response = await client.request<BioTimePaginatedResponse<BioTimeTransaction>>(
      '/iclock/api/transactions/',
      { params }
    );

    result.fetched += response.data.length;

    for (const txn of response.data) {
      // Parse the punch time (BioTime sends local time, no timezone)
      const punchTime = parseBioTimeDate(txn.punch_time);

      // Determine the business day for this punch
      const businessDay = getBusinessDay(punchTime);
      result.affectedDays.add(`${txn.emp_code}:${formatDate(businessDay)}`);

      // Insert (skip duplicates via unique biotime_id)
      try {
        await db.insert(punchLogs).values({
          empCode: txn.emp_code,
          punchTime,
          punchState: txn.punch_state,
          verifyType: txn.verify_type,
          terminalSn: txn.terminal_sn,
          biotimeId: txn.id,
          source: 'biotime',
          syncedAt: now,
        });
        result.inserted++;
      } catch (err) {
        // Unique constraint violation = duplicate, skip silently
        if (isDuplicateError(err)) {
          result.skipped++;
        } else {
          throw err;
        }
      }
    }

    hasMore = response.next !== null;
    page++;
  }

  // Update last sync time only after ALL transactions are processed
  await updateSetting('last_sync_time', now.toISOString());

  return result;
}
```

### Date Parsing

BioTime sends timestamps without timezone info in the format `"2026-04-14 17:30:22"`. These are already in Colombia local time (UTC-5).

```typescript
// Parse BioTime date string to Date object
function parseBioTimeDate(dateStr: string): Date {
  // "2026-04-14 17:30:22" → treat as local Colombia time
  // Append the Colombia timezone offset
  return new Date(`${dateStr.replace(' ', 'T')}-05:00`);
}

// Format Date to BioTime query parameter
function formatBioTimeDate(date: Date): string {
  // BioTime expects: "2026-04-14 17:30:22"
  const pad = (n: number) => String(n).padStart(2, '0');
  // Convert to Colombia time
  const co = new Date(date.toLocaleString('en-US', { timeZone: 'America/Bogota' }));
  return `${co.getFullYear()}-${pad(co.getMonth() + 1)}-${pad(co.getDate())} ` +
         `${pad(co.getHours())}:${pad(co.getMinutes())}:${pad(co.getSeconds())}`;
}

// Determine business day for a punch
// Business day starts at 6 AM
// Punch at 5:55 AM → business day = yesterday
// Punch at 6:05 AM → business day = today
function getBusinessDay(punchTime: Date): Date {
  const coTime = new Date(punchTime.toLocaleString('en-US', { timeZone: 'America/Bogota' }));
  const hour = coTime.getHours();
  
  if (hour < 6) {
    // Before 6 AM → belongs to previous day
    coTime.setDate(coTime.getDate() - 1);
  }
  
  // Return just the date (no time)
  return new Date(coTime.getFullYear(), coTime.getMonth(), coTime.getDate());
}
```

### First-Time Sync

On the very first sync (`last_sync_time` is empty), the client fetches ALL transactions:
- No `start_time` filter — gets everything BioTime has
- This could be months of data
- Processes in pages of 500
- May take 1-2 minutes for a large dataset
- Show progress in the UI: "Syncing... 1,500 / 3,200 transactions"

### Incremental Sync

Every subsequent sync (cron or manual):
- `start_time` = last_sync_time (inclusive)
- `end_time` = now
- Typically returns 0-20 transactions per 10-minute window
- Completes in < 2 seconds

---

## Terminal Info (`terminals.ts`)

### Purpose
Fetch device information for the settings page. Useful for verifying connectivity and showing which devices are registered.

```typescript
interface BioTimeTerminal {
  id: number;
  sn: string;              // serial number
  alias: string;           // display name
  ip_address: string;
  terminal_name: string;
  is_active: boolean;
  last_activity: string;
}

async function getTerminals(): Promise<BioTimeTerminal[]> {
  const client = await getBioTimeClient();
  const response = await client.request<BioTimePaginatedResponse<BioTimeTerminal>>(
    '/iclock/api/terminals/',
    { params: { page_size: '50' } }
  );
  return response.data;
}
```

---

## API Routes

### POST `/api/biotime/sync`

Main sync endpoint — called by Railway Cron every 10 minutes and by the manual "Sync now" button.

```typescript
// src/app/api/biotime/sync/route.ts

export async function POST(request: Request) {
  try {
    // 1. Check if a sync is already running (prevent concurrent syncs)
    const lockKey = 'sync_in_progress';
    const lock = await getSetting(lockKey);
    if (lock === 'true') {
      return Response.json(
        { error: 'Sync already in progress' },
        { status: 409 }
      );
    }
    await updateSetting(lockKey, 'true');

    try {
      // 2. Sync transactions
      const txnResult = await syncTransactions();

      // 3. Recalculate daily attendance for affected days
      let recalculated = 0;
      for (const key of txnResult.affectedDays) {
        const [empCode, dateStr] = key.split(':');
        const employee = await getEmployeeByEmpCode(empCode);
        if (employee) {
          await calculateDailyAttendance(employee.id, new Date(dateStr));
          recalculated++;
        }
      }

      // 4. Return results
      return Response.json({
        success: true,
        transactions: {
          fetched: txnResult.fetched,
          inserted: txnResult.inserted,
          skipped: txnResult.skipped,
        },
        recalculated,
        syncedAt: txnResult.syncedAt.toISOString(),
      });
    } finally {
      // Always release the lock
      await updateSetting(lockKey, 'false');
    }
  } catch (err) {
    await updateSetting('sync_in_progress', 'false');
    await updateSetting('biotime_last_error', String(err));

    return Response.json(
      { error: 'Sync failed', detail: String(err) },
      { status: 500 }
    );
  }
}
```

**Concurrency lock:** The `sync_in_progress` setting prevents two syncs from running simultaneously (e.g., cron fires while a manual sync is still running). The lock is always released in a `finally` block.

### POST `/api/biotime/test-connection`

Tests the BioTime connection from the settings page.

```typescript
export async function POST(request: Request) {
  const { url, username, password } = await request.json();

  try {
    // 1. Try to authenticate
    const authResponse = await fetch(`${url}/jwt-api-token-auth/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      signal: AbortSignal.timeout(10000), // 10s timeout
    });

    if (!authResponse.ok) {
      return Response.json({
        connected: false,
        error: `Authentication failed (${authResponse.status})`,
      });
    }

    const { token } = await authResponse.json();

    // 2. Test with a lightweight endpoint
    const terminalResponse = await fetch(`${url}/iclock/api/terminals/?page_size=1`, {
      headers: { 'Authorization': `JWT ${token}` },
      signal: AbortSignal.timeout(10000),
    });

    if (!terminalResponse.ok) {
      return Response.json({
        connected: false,
        error: `API access failed (${terminalResponse.status})`,
      });
    }

    const terminals = await terminalResponse.json();

    // 3. Save settings if connection works
    await updateSetting('biotime_url', url);
    await updateSetting('biotime_username', username);
    await updateSetting('biotime_password', password);
    await updateSetting('biotime_token', token);
    await updateSetting('biotime_connected', 'true');
    await updateSetting('biotime_last_error', '');

    return Response.json({
      connected: true,
      terminalCount: terminals.count,
      message: `Connected successfully. ${terminals.count} device(s) found.`,
    });
  } catch (err) {
    const message = err instanceof Error && err.name === 'TimeoutError'
      ? 'Connection timed out — check the URL and ensure the server is reachable'
      : `Connection failed: ${err}`;

    return Response.json({ connected: false, error: message });
  }
}
```

### POST `/api/biotime/employees`

Manual employee sync trigger.

```typescript
export async function POST() {
  try {
    const result = await syncEmployees();
    return Response.json({
      success: true,
      created: result.created,
      updated: result.updated,
      syncedAt: result.syncedAt.toISOString(),
    });
  } catch (err) {
    return Response.json(
      { error: 'Employee sync failed', detail: String(err) },
      { status: 500 }
    );
  }
}
```

### GET `/api/biotime/status`

Returns connection status for the dashboard.

```typescript
export async function GET() {
  const connected = await getSetting('biotime_connected');
  const lastSync = await getSetting('last_sync_time');
  const lastError = await getSetting('biotime_last_error');
  const syncInProgress = await getSetting('sync_in_progress');

  const lastSyncDate = lastSync ? new Date(lastSync) : null;
  const minutesAgo = lastSyncDate
    ? Math.floor((Date.now() - lastSyncDate.getTime()) / 60000)
    : null;

  return Response.json({
    connected: connected === 'true',
    lastSync: lastSync || null,
    minutesAgo,
    isStale: minutesAgo !== null && minutesAgo > 30,
    lastError: lastError || null,
    syncInProgress: syncInProgress === 'true',
  });
}
```

---

## Railway Cron Configuration

### Setup

In Railway's dashboard, add a **Cron Job** service or use the `railway.json` config:

```json
{
  "cron": {
    "schedule": "*/10 * * * *",
    "endpoint": "/api/biotime/sync",
    "method": "POST"
  }
}
```

Alternatively, use Railway's built-in cron trigger that hits the sync endpoint every 10 minutes.

### Cron Authentication

The sync endpoint should verify that the request is from Railway's cron, not from an external source:

```typescript
// In the sync route handler:
const cronSecret = request.headers.get('x-cron-secret');
const isManualSync = request.headers.get('x-manual-sync') === 'true';

if (!isManualSync && cronSecret !== process.env.CRON_SECRET) {
  return Response.json({ error: 'Unauthorized' }, { status: 401 });
}
```

Add `CRON_SECRET` to Railway's environment variables. The dashboard's "Sync now" button sends the `x-manual-sync` header (authenticated via NextAuth session).

---

## Error Handling Matrix

| Error | Detection | Response | User Impact |
|---|---|---|---|
| BioTime server offline | fetch throws network error | Log error, skip sync | Dashboard shows "Last sync: X min ago" + stale alert if > 30 min |
| Cloudflare Tunnel down | fetch throws network error | Same as above | Same as above |
| Invalid credentials | 401 on auth + refresh | Set biotime_connected=false | Dashboard shows "BioTime disconnected" alert |
| BioTime rate limiting | 429 response | Wait and retry (up to 3 times with exponential backoff) | Sync may be delayed |
| Timeout (> 15s) | AbortSignal fires | Log, retry on next cron cycle | Transparent to user |
| Malformed response | JSON parse fails | Log error, skip this batch | Some transactions may be delayed |
| Database error | Drizzle throws | Log, release sync lock | Toast: "Sync error" |
| Duplicate transaction | Unique constraint on biotime_id | Skip silently (ON CONFLICT DO NOTHING) | None |

---

## Testing

### Unit Tests

**`client.test.ts`:**
- [ ] Successful request with valid token
- [ ] 401 triggers refresh → retry succeeds
- [ ] 401 + refresh fails → re-auth → retry succeeds
- [ ] 401 + refresh fails + re-auth fails → throws error
- [ ] No infinite retry loops (max 1 retry per request)
- [ ] Concurrent requests share the same refresh (no duplicate refreshes)
- [ ] Timeout fires after configured duration
- [ ] Network error produces isNetworkError = true

**`auth.test.ts`:**
- [ ] authenticate() calls correct endpoint with credentials
- [ ] authenticate() saves token to settings
- [ ] refreshToken() sends current token, receives new one
- [ ] refreshToken() returns null on failure
- [ ] loadToken() reads from settings table
- [ ] saveToken() upserts to settings table

**`employees.test.ts`:**
- [ ] New employee creates a record with no group/salary
- [ ] Existing employee updates name but preserves group/salary/cedula
- [ ] Handles pagination (multiple pages)
- [ ] Empty response from BioTime is handled

**`transactions.test.ts`:**
- [ ] First sync (no last_sync_time) fetches all transactions
- [ ] Incremental sync uses last_sync_time as start_time
- [ ] Duplicate biotime_id is skipped silently
- [ ] Business day calculation: punch at 5:55 AM → yesterday
- [ ] Business day calculation: punch at 6:05 AM → today
- [ ] Affected days set is correctly populated
- [ ] last_sync_time is updated only after all processing

### Integration Tests (against real BioTime)

These run manually during Phase 6 testing:
- [ ] Full sync from empty database
- [ ] Incremental sync picks up new punches
- [ ] Token expiry → auto-refresh works
- [ ] Connection test from settings page
- [ ] Device list retrieval

---

## Implementation Sequence

Build in this order:

1. **`types.ts`** — all TypeScript interfaces
2. **`auth.ts`** — token load/save/refresh/authenticate
3. **`client.ts`** — core request method with retry interceptor
4. **`transactions.ts`** — transaction sync with pagination + business day logic
5. **`employees.ts`** — employee sync with upsert logic
6. **`terminals.ts`** — simple device list fetch
7. **`/api/biotime/test-connection`** — settings page connection test
8. **`/api/biotime/sync`** — main sync endpoint with concurrency lock
9. **`/api/biotime/employees`** — manual employee sync
10. **`/api/biotime/status`** — connection status for dashboard
11. **Unit tests** for all modules
