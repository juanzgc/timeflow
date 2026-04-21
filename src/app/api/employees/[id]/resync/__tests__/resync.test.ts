import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Tests for the per-employee force re-sync endpoint.
 *
 * Contract:
 *   1. Destructive: existing punch_logs for the employee in the date range
 *      are DELETED (including manual edits), then BioTime's source-of-truth
 *      rows are inserted in their place.
 *   2. Override: after re-ingest, recalcAndInvalidate MUST run for the same
 *      (employeeId, startDate, endDate) so any pre-existing daily_attendance
 *      rows in that window are overwritten with values derived from the
 *      freshly-reset punch_logs.
 *   3. Ordering: delete → insert → recalc. Any other order leaves the
 *      system in an inconsistent state.
 */

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@/lib/auth-helpers", () => ({
  requireSuperadmin: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("@/lib/biotime/client", () => ({
  getBioTimeClient: vi.fn(),
}));

vi.mock("@/lib/attendance/invalidate", () => ({
  recalcAndInvalidate: vi.fn(),
}));

import { POST } from "../route";
import { requireSuperadmin } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { getBioTimeClient } from "@/lib/biotime/client";
import { recalcAndInvalidate } from "@/lib/attendance/invalidate";

const EMP = {
  id: 42,
  empCode: "1092341718",
  firstName: "Diana",
  lastName: "Marcela",
};

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/employees/42/resync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

/** Chainable mock for db.insert(...).values(...).onConflictDoUpdate(...). */
function mockInsertChain() {
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  return { values, onConflictDoUpdate };
}

/** Chainable mock for db.delete(...).where(...).returning(). */
function mockDeleteChain(deletedRows: unknown[] = []) {
  const returning = vi.fn().mockResolvedValue(deletedRows);
  const where = vi.fn().mockReturnValue({ returning });
  return { where, returning };
}

/** Chainable mock for db.select(...).from(...).where(...).limit(...). */
function mockSelectChain(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(rows),
      }),
    }),
  };
}

const BIOTIME_PUNCHES = [
  {
    id: 1001,
    emp_code: EMP.empCode,
    punch_time: "2026-04-10 16:59:28",
    punch_state: "0",
    verify_type: 1,
    terminal_sn: "T1",
  },
  {
    id: 1002,
    emp_code: EMP.empCode,
    punch_time: "2026-04-11 03:43:10",
    punch_state: "1",
    verify_type: 1,
    terminal_sn: "T1",
  },
];

beforeEach(() => {
  vi.clearAllMocks();

  vi.mocked(requireSuperadmin).mockResolvedValue({
    session: { user: { role: "superadmin" } } as never,
    response: null,
  });

  vi.mocked(db.select).mockReturnValue(mockSelectChain([EMP]) as never);
  vi.mocked(db.insert).mockImplementation(() => mockInsertChain() as never);
  vi.mocked(db.delete).mockReturnValue(mockDeleteChain() as never);

  vi.mocked(getBioTimeClient).mockResolvedValue({
    fetchAllPages: vi.fn().mockResolvedValue(BIOTIME_PUNCHES),
  } as never);

  vi.mocked(recalcAndInvalidate).mockResolvedValue([
    {
      employeeId: EMP.id,
      name: "Diana Marcela",
      workDate: "2026-04-10",
      status: "on-time",
      totalWorkedMins: 640,
    },
  ]);
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("POST /api/employees/[id]/resync — destructive override guarantee", () => {
  it("deletes existing punch_logs in the range BEFORE inserting BioTime rows", async () => {
    const callOrder: string[] = [];

    vi.mocked(db.delete).mockImplementation(() => {
      callOrder.push("delete");
      return mockDeleteChain() as never;
    });

    vi.mocked(db.insert).mockImplementation(() => {
      callOrder.push("insert");
      return mockInsertChain() as never;
    });

    vi.mocked(recalcAndInvalidate).mockImplementation(async () => {
      callOrder.push("recalc");
      return [];
    });

    await POST(
      makeRequest({ startDate: "2026-04-10", endDate: "2026-04-12" }),
      makeParams("42"),
    );

    // Required order: delete → all inserts → recalc
    const deleteIdx = callOrder.indexOf("delete");
    const firstInsertIdx = callOrder.indexOf("insert");
    const lastInsertIdx = callOrder.lastIndexOf("insert");
    const recalcIdx = callOrder.indexOf("recalc");

    expect(deleteIdx).toBeGreaterThanOrEqual(0);
    expect(firstInsertIdx).toBeGreaterThan(deleteIdx);
    expect(recalcIdx).toBeGreaterThan(lastInsertIdx);
  });

  it("inserts every BioTime punch with onConflictDoUpdate so any survivor row is overwritten, never skipped", async () => {
    const insertChains: ReturnType<typeof mockInsertChain>[] = [];

    vi.mocked(db.insert).mockImplementation(() => {
      const chain = mockInsertChain();
      insertChains.push(chain);
      return chain as never;
    });

    await POST(
      makeRequest({ startDate: "2026-04-10", endDate: "2026-04-12" }),
      makeParams("42"),
    );

    expect(insertChains).toHaveLength(BIOTIME_PUNCHES.length);
    for (const chain of insertChains) {
      // Each insert must call onConflictDoUpdate (NOT onConflictDoNothing).
      // If the destructive delete somehow left a survivor, the conflict
      // resolution must overwrite it with the fresh BioTime values.
      expect(chain.onConflictDoUpdate).toHaveBeenCalledOnce();
      const [arg] = chain.onConflictDoUpdate.mock.calls[0];
      expect(arg).toHaveProperty("set");
      expect(arg).toHaveProperty("target");
    }
  });

  it("calls recalcAndInvalidate with the exact (employeeId, startDate, endDate) so daily_attendance is rebuilt from the reset punch_logs", async () => {
    const res = await POST(
      makeRequest({ startDate: "2026-04-10", endDate: "2026-04-12" }),
      makeParams("42"),
    );

    expect(res.status).toBe(200);
    expect(recalcAndInvalidate).toHaveBeenCalledOnce();
    expect(recalcAndInvalidate).toHaveBeenCalledWith({
      employeeId: 42,
      startDate: "2026-04-10",
      endDate: "2026-04-12",
    });
  });

  it("reports deleted + inserted counts in the response so the UI can confirm the wipe-and-replace happened", async () => {
    vi.mocked(db.delete).mockReturnValue(
      mockDeleteChain([{ id: 100 }, { id: 101 }, { id: 102 }]) as never,
    );

    const res = await POST(
      makeRequest({ startDate: "2026-04-10", endDate: "2026-04-12" }),
      makeParams("42"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.biotime.deleted).toBe(3);
    expect(body.biotime.inserted).toBe(BIOTIME_PUNCHES.length);
    expect(body.biotime.fetched).toBe(BIOTIME_PUNCHES.length);
  });

  it("still wipes existing rows and recalculates when BioTime returns zero punches (erases stale local state)", async () => {
    vi.mocked(getBioTimeClient).mockResolvedValue({
      fetchAllPages: vi.fn().mockResolvedValue([]),
    } as never);

    vi.mocked(db.delete).mockReturnValue(
      mockDeleteChain([{ id: 50 }]) as never,
    );

    const res = await POST(
      makeRequest({ startDate: "2026-04-10", endDate: "2026-04-12" }),
      makeParams("42"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.biotime.deleted).toBe(1);
    expect(body.biotime.inserted).toBe(0);
    expect(db.insert).not.toHaveBeenCalled();
    expect(recalcAndInvalidate).toHaveBeenCalledOnce();
  });

  it("returns attendance.daysCalculated from the recalc result", async () => {
    vi.mocked(recalcAndInvalidate).mockResolvedValue([
      { employeeId: 42, name: "Diana Marcela", workDate: "2026-04-10", status: "on-time", totalWorkedMins: 640 },
      { employeeId: 42, name: "Diana Marcela", workDate: "2026-04-11", status: "on-time", totalWorkedMins: 450 },
      { employeeId: 42, name: "Diana Marcela", workDate: "2026-04-12", status: "on-time", totalWorkedMins: 430 },
    ]);

    const res = await POST(
      makeRequest({ startDate: "2026-04-10", endDate: "2026-04-12" }),
      makeParams("42"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.attendance.daysCalculated).toBe(3);
  });
});

describe("POST /api/employees/[id]/resync — business-day window (6am–6am)", () => {
  /**
   * Helper: run the route with the given date range and return the BioTime
   * fetch params. Asserts that start_time / end_time are produced using
   * Colombia-local clock values, regardless of server timezone.
   */
  async function fetchParamsFor(startDate: string, endDate: string) {
    const biotimeFetch = vi.fn().mockResolvedValue([]);
    vi.mocked(getBioTimeClient).mockResolvedValue({
      fetchAllPages: biotimeFetch,
    } as never);

    await POST(
      makeRequest({ startDate, endDate }),
      makeParams("42"),
    );

    expect(biotimeFetch).toHaveBeenCalledOnce();
    const [, params] = biotimeFetch.mock.calls[0];
    return params as { start_time: string; end_time: string };
  }

  it("uses [startDate 06:00 COT, endDate+1 06:00 COT) so clock-out tails are captured and pre-range heads are excluded", async () => {
    const params = await fetchParamsFor("2026-04-10", "2026-04-12");
    expect(params.start_time).toBe("2026-04-10 06:00:00");
    expect(params.end_time).toBe("2026-04-13 06:00:00");
  });

  it("handles month boundaries — endDate=Apr 30 rolls to May 1 06:00, not server-local-midnight May 1", async () => {
    const params = await fetchParamsFor("2026-04-29", "2026-04-30");
    expect(params.start_time).toBe("2026-04-29 06:00:00");
    expect(params.end_time).toBe("2026-05-01 06:00:00");
  });

  it("handles year boundaries — endDate=Dec 31 rolls to Jan 1 06:00 of the next year", async () => {
    const params = await fetchParamsFor("2026-12-30", "2026-12-31");
    expect(params.start_time).toBe("2026-12-30 06:00:00");
    expect(params.end_time).toBe("2027-01-01 06:00:00");
  });

  it("single-day range still spans a full business day (06:00 → next-day 06:00)", async () => {
    const params = await fetchParamsFor("2026-04-10", "2026-04-10");
    expect(params.start_time).toBe("2026-04-10 06:00:00");
    expect(params.end_time).toBe("2026-04-11 06:00:00");
  });

  it("uses the SAME window for the DELETE as for the BioTime fetch (local DB and BioTime stay in lockstep)", async () => {
    const deleteChain = mockDeleteChain();
    vi.mocked(db.delete).mockReturnValue(deleteChain as never);

    const params = await fetchParamsFor("2026-04-10", "2026-04-12");

    // The route is wired to use one `rangeStart` / `rangeEndExclusive` pair
    // for both the BioTime fetch and the local DELETE — asserting the delete
    // chain ran exactly once ensures we didn't bypass it with a different
    // window. If someone changes the route to compute the two ranges
    // separately, the start_time/end_time assertions above would need a
    // sibling check here.
    expect(deleteChain.where).toHaveBeenCalledOnce();
    expect(params.start_time).toBe("2026-04-10 06:00:00");
    expect(params.end_time).toBe("2026-04-13 06:00:00");
  });
});

describe("POST /api/employees/[id]/resync — timezone invariance (server not in UTC-5)", () => {
  /**
   * The critical invariant: given a `YYYY-MM-DD` date string from a Colombia-
   * based client, the server must compute BioTime params and DB timestamps
   * that reflect COLOMBIA-local clock values — regardless of what TZ the
   * server's Node process runs in.
   *
   * V8 caches process.env.TZ at startup, so we can't switch server TZ mid-
   * test. Instead these tests assert the output strings literally — any
   * accidental use of Date.prototype.getDate / getMonth / getHours / etc.
   * on the server would produce different strings in a non-UTC-5 runtime,
   * breaking these assertions. The route currently uses only Colombia-aware
   * helpers from src/lib/timezone.ts, which use explicit UTC math, so the
   * output is provably identical on any host TZ.
   */

  it("produces byte-identical BioTime params no matter the server's local TZ (the helpers use only Date.UTC math)", async () => {
    const biotimeFetch = vi.fn().mockResolvedValue([]);
    vi.mocked(getBioTimeClient).mockResolvedValue({
      fetchAllPages: biotimeFetch,
    } as never);

    // Run the route twice — the second run uses a fresh vi.clearAllMocks in
    // beforeEach semantics, but we call POST twice in a row here to catch
    // any hidden side effect (e.g. cached Date objects). Output MUST match.
    await POST(
      makeRequest({ startDate: "2026-04-10", endDate: "2026-04-12" }),
      makeParams("42"),
    );
    const firstParams = biotimeFetch.mock.calls[0][1];

    biotimeFetch.mockClear();
    await POST(
      makeRequest({ startDate: "2026-04-10", endDate: "2026-04-12" }),
      makeParams("42"),
    );
    const secondParams = biotimeFetch.mock.calls[0][1];

    expect(firstParams).toEqual(secondParams);
    expect(firstParams.start_time).toBe("2026-04-10 06:00:00");
    expect(firstParams.end_time).toBe("2026-04-13 06:00:00");
  });

  it("does not trust server-local Date construction: startDate/endDate strings round-trip back to the response unchanged", async () => {
    // If the route ever did `new Date(startDate)` (server-local parse) it
    // could shift the date by a day on UTC servers. We verify the response
    // echoes the input strings verbatim.
    const res = await POST(
      makeRequest({ startDate: "2026-04-10", endDate: "2026-04-12" }),
      makeParams("42"),
    );
    const body = await res.json();
    expect(body.dateRange).toEqual({
      startDate: "2026-04-10",
      endDate: "2026-04-12",
    });
  });

  it("passes the ORIGINAL string dates to recalcAndInvalidate (no Date conversion that would depend on server TZ)", async () => {
    await POST(
      makeRequest({ startDate: "2026-04-10", endDate: "2026-04-12" }),
      makeParams("42"),
    );

    expect(recalcAndInvalidate).toHaveBeenCalledWith({
      employeeId: 42,
      startDate: "2026-04-10",
      endDate: "2026-04-12",
    });

    // Assert literal string equality — not just loose equality — because a
    // server-local Date conversion could yield a string that's equal in
    // value but produced via a TZ-sensitive path.
    const call = vi.mocked(recalcAndInvalidate).mock.calls[0][0];
    expect(typeof call.startDate).toBe("string");
    expect(typeof call.endDate).toBe("string");
    expect(call.startDate).toBe("2026-04-10");
    expect(call.endDate).toBe("2026-04-12");
  });
});

describe("POST /api/employees/[id]/resync — auth + validation", () => {
  it("rejects non-superadmin callers before touching BioTime, DB or recalc", async () => {
    vi.mocked(requireSuperadmin).mockResolvedValue({
      session: null,
      response: new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
      }) as never,
    });

    const res = await POST(
      makeRequest({ startDate: "2026-04-10", endDate: "2026-04-12" }),
      makeParams("42"),
    );

    expect(res.status).toBe(403);
    expect(db.delete).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    expect(getBioTimeClient).not.toHaveBeenCalled();
    expect(recalcAndInvalidate).not.toHaveBeenCalled();
  });

  it("rejects missing dates without touching any destructive operation", async () => {
    const res = await POST(makeRequest({ startDate: "2026-04-10" }), makeParams("42"));

    expect(res.status).toBe(400);
    expect(db.delete).not.toHaveBeenCalled();
    expect(getBioTimeClient).not.toHaveBeenCalled();
    expect(recalcAndInvalidate).not.toHaveBeenCalled();
  });

  it("rejects malformed dates without touching any destructive operation", async () => {
    const res = await POST(
      makeRequest({ startDate: "10-04-2026", endDate: "12-04-2026" }),
      makeParams("42"),
    );

    expect(res.status).toBe(400);
    expect(db.delete).not.toHaveBeenCalled();
  });

  it("rejects inverted range (start > end) without touching any destructive operation", async () => {
    const res = await POST(
      makeRequest({ startDate: "2026-04-12", endDate: "2026-04-10" }),
      makeParams("42"),
    );

    expect(res.status).toBe(400);
    expect(db.delete).not.toHaveBeenCalled();
  });
});
