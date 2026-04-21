import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Tests for DELETE /api/employees/[id]/attendance.
 *
 * Regression guard: the delete must scope punch_logs removal to the BUSINESS
 * day (06:00 COT → next-day 06:00 COT), not the calendar day. A prior bug
 * used `[workDate 00:00, workDate+2 00:00]` which bled into the adjacent
 * business day's punches — e.g. deleting BD Apr 9 (whose sole punch was a
 * 00:01 Apr 10 Salida) also wiped the 16:59 Apr 10 Entrada belonging to
 * BD Apr 10.
 */

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("@/lib/attendance/invalidate", () => ({
  invalidateAttendance: vi.fn(),
}));

vi.mock("@/lib/engine/attendance-calculator", () => ({
  calculateAttendance: vi.fn(),
}));

import { DELETE } from "../route";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { punchLogs } from "@/drizzle/schema";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/employees/42/attendance", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

/** Chainable select: returns attendance record first, then employee. */
function setupSelects(attendanceRow: unknown, employeeRow: unknown) {
  const selectMock = vi.mocked(db.select);
  selectMock.mockReturnValueOnce({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(attendanceRow ? [attendanceRow] : []),
      }),
    }),
  } as never);
  selectMock.mockReturnValueOnce({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(employeeRow ? [employeeRow] : []),
      }),
    }),
  } as never);
}

/** Capture the where-clause passed to db.delete(punchLogs).where(...). */
type CapturedDelete = {
  table: unknown;
  where: unknown;
};
function setupDeleteCapture(): { captures: CapturedDelete[] } {
  const captures: CapturedDelete[] = [];

  vi.mocked(db.delete).mockImplementation((table: unknown) => {
    const chain = {
      where: vi.fn().mockImplementation((clause: unknown) => {
        captures.push({ table, where: clause });
        return Promise.resolve(undefined) as never;
      }),
    };
    return chain as never;
  });

  return { captures };
}

/**
 * Walk an arbitrary object graph (drizzle SQL builder has circular refs)
 * and collect every Date's ISO string. Skips cycles via a WeakSet.
 */
function collectDates(root: unknown): string[] {
  const seen = new WeakSet<object>();
  const out: string[] = [];

  function walk(v: unknown): void {
    if (v === null || v === undefined) return;
    if (v instanceof Date) {
      out.push(v.toISOString());
      return;
    }
    if (typeof v !== "object") return;
    if (seen.has(v as object)) return;
    seen.add(v as object);

    if (Array.isArray(v)) {
      for (const item of v) walk(item);
      return;
    }
    for (const key of Object.keys(v)) {
      walk((v as Record<string, unknown>)[key]);
    }
  }

  walk(root);
  return out;
}

function setupInsert() {
  vi.mocked(db.insert).mockReturnValue({
    values: vi.fn().mockResolvedValue(undefined),
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({
    user: { name: "tester", role: "admin" },
  } as never);
  setupInsert();
});

describe("DELETE /api/employees/[id]/attendance — business-day window", () => {
  it("calls db.delete(punchLogs) exactly once (the destructive punch-log delete)", async () => {
    setupSelects(
      { id: 1, clockIn: new Date("2026-04-10T00:01:00-05:00"), clockOut: null },
      { empCode: "1092341718" },
    );
    const { captures } = setupDeleteCapture();

    const res = await DELETE(
      makeRequest({ workDate: "2026-04-09", reason: "orphan salida cleanup" }),
      makeParams("42"),
    );

    expect(res.status).toBe(200);
    // Two delete calls: one for punch_logs (by empCode+time window), one for
    // dailyAttendance (by record.id). Assert both happened.
    expect(captures).toHaveLength(2);
    // The first delete targets punch_logs (by positional order in the handler).
    expect(captures[0].table).toBe(punchLogs);
  });

  it("confines the punch-log delete to one business day — does NOT reach into the next BD's morning punches", async () => {
    // Scenario: Diana BD Apr 9 has only a 00:01 Apr 10 Salida. The punches
    // in the DB also include Apr 10 16:59 Entrada (BD Apr 10) and
    // Apr 11 03:43 Salida (also BD Apr 10). Only the 00:01 Apr 10 row
    // should be eligible for deletion when we ask to delete BD Apr 9.
    //
    // We assert this indirectly: the SQL clause the handler constructs must
    // reference the 06:00-aligned window. Drizzle's where-clause is an
    // opaque SQL builder object, so we inspect its serialized form.
    setupSelects(
      { id: 1, clockIn: new Date("2026-04-10T00:01:00-05:00"), clockOut: null },
      { empCode: "1092341718" },
    );
    const { captures } = setupDeleteCapture();

    await DELETE(
      makeRequest({ workDate: "2026-04-09", reason: "orphan salida cleanup" }),
      makeParams("42"),
    );

    const [punchLogDelete] = captures;
    const dates = collectDates(punchLogDelete.where);

    // Apr 9 06:00 COT == Apr 9 11:00 UTC
    expect(dates).toContain("2026-04-09T11:00:00.000Z");
    // Apr 10 06:00 COT == Apr 10 11:00 UTC
    expect(dates).toContain("2026-04-10T11:00:00.000Z");
    // Negative: must NOT reference Apr 11 00:00 (the old calendar-day + 2 bound)
    expect(dates).not.toContain("2026-04-11T05:00:00.000Z");
  });

  it("for BD Apr 10 (midnight-crossing), the window is [Apr 10 06:00 COT, Apr 11 06:00 COT) — captures the Apr 11 03:43 Salida but NOT the Apr 11 17:59 Entrada", async () => {
    setupSelects(
      {
        id: 2,
        clockIn: new Date("2026-04-10T16:59:00-05:00"),
        clockOut: new Date("2026-04-11T03:43:00-05:00"),
      },
      { empCode: "1092341718" },
    );
    const { captures } = setupDeleteCapture();

    await DELETE(
      makeRequest({ workDate: "2026-04-10", reason: "remove BD Apr 10" }),
      makeParams("42"),
    );

    const [punchLogDelete] = captures;
    const dates = collectDates(punchLogDelete.where);

    // Lower bound: Apr 10 06:00 COT = 11:00 UTC
    expect(dates).toContain("2026-04-10T11:00:00.000Z");
    // Upper bound (exclusive): Apr 11 06:00 COT = 11:00 UTC
    expect(dates).toContain("2026-04-11T11:00:00.000Z");
    // Negative: must NOT reference the old buggy bound Apr 12 00:00 COT = 05:00 UTC
    expect(dates).not.toContain("2026-04-12T05:00:00.000Z");
  });
});

describe("DELETE /api/employees/[id]/attendance — validation + auth", () => {
  it("returns 400 when workDate is missing (no destructive op)", async () => {
    const { captures } = setupDeleteCapture();
    const res = await DELETE(
      makeRequest({ reason: "missing workDate" }),
      makeParams("42"),
    );
    expect(res.status).toBe(400);
    expect(captures).toHaveLength(0);
  });

  it("returns 400 when reason is < 5 chars (no destructive op)", async () => {
    const { captures } = setupDeleteCapture();
    const res = await DELETE(
      makeRequest({ workDate: "2026-04-09", reason: "x" }),
      makeParams("42"),
    );
    expect(res.status).toBe(400);
    expect(captures).toHaveLength(0);
  });

  it("returns 401 when unauthenticated (no destructive op)", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const { captures } = setupDeleteCapture();
    const res = await DELETE(
      makeRequest({ workDate: "2026-04-09", reason: "unauthenticated attempt" }),
      makeParams("42"),
    );
    expect(res.status).toBe(401);
    expect(captures).toHaveLength(0);
  });
});
