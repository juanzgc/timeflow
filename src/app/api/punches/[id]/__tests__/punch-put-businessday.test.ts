import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Tests for PUT /api/punches/[id].
 *
 * Regression guard: `workDate` for the correction audit entry AND the recalc
 * range must be computed from the punch's BUSINESS DAY, not its calendar
 * date. A prior bug used server-local `.getDate()/.getMonth()/.getFullYear()`
 * on the timestamp, which:
 *   (a) broke on non-UTC-5 server timezones (would shift by up to 24h), and
 *   (b) misattributed pre-6am punches — e.g. a 03:43 Apr 11 clock-out whose
 *       true business day is Apr 10 would record workDate="2026-04-11" and
 *       trigger a recalc on Apr 11, leaving BD Apr 10 stale.
 */

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
  },
}));

vi.mock("@/lib/attendance/invalidate", () => ({
  recalcAndInvalidate: vi.fn(),
}));

import { PUT } from "../route";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { recalcAndInvalidate } from "@/lib/attendance/invalidate";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/punches/101", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function setupOriginalPunch(punch: {
  id: number;
  empCode: string;
  punchTime: Date;
  punchState: string | null;
}) {
  vi.mocked(db.select).mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([punch]),
      }),
    }),
  } as never);
}

function setupUpdateAndInsert() {
  vi.mocked(db.update).mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 101, punchTime: new Date() }]),
      }),
    }),
  } as never);
  vi.mocked(db.insert).mockReturnValue({
    values: vi.fn().mockResolvedValue(undefined),
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({
    user: { name: "tester" },
  } as never);
  setupUpdateAndInsert();
  vi.mocked(recalcAndInvalidate).mockResolvedValue([]);
});

describe("PUT /api/punches/[id] — business-day workDate", () => {
  it("pre-6AM clock-out (03:43 Apr 11) resolves to business day Apr 10, not calendar day Apr 11", async () => {
    setupOriginalPunch({
      id: 101,
      empCode: "1092341718",
      punchTime: new Date("2026-04-11T03:43:00-05:00"),
      punchState: "1",
    });

    const res = await PUT(
      makeRequest({
        punchTime: "2026-04-11T03:50:00-05:00", // same BD, slight time change
        reason: "keystroke correction",
        employeeId: 42,
      }),
      makeParams("101"),
    );

    expect(res.status).toBe(200);

    // Audit entry: workDate must be the business day (Apr 10), not Apr 11
    const insertValuesCall = vi
      .mocked(db.insert)
      .mock.results[0].value.values.mock.calls[0][0];
    expect(insertValuesCall.workDate).toBe("2026-04-10");

    // Recalc must target BD Apr 10 (both old and new are BD Apr 10)
    expect(recalcAndInvalidate).toHaveBeenCalledWith({
      employeeId: 42,
      startDate: "2026-04-10",
      endDate: "2026-04-10",
    });
  });

  it("post-6AM clock-in (16:59 Apr 10) uses calendar day Apr 10 as business day", async () => {
    setupOriginalPunch({
      id: 101,
      empCode: "1092341718",
      punchTime: new Date("2026-04-10T16:59:00-05:00"),
      punchState: "0",
    });

    await PUT(
      makeRequest({
        punchTime: "2026-04-10T17:00:00-05:00",
        reason: "tiny adjustment",
        employeeId: 42,
      }),
      makeParams("101"),
    );

    const insertValuesCall = vi
      .mocked(db.insert)
      .mock.results[0].value.values.mock.calls[0][0];
    expect(insertValuesCall.workDate).toBe("2026-04-10");

    expect(recalcAndInvalidate).toHaveBeenCalledWith({
      employeeId: 42,
      startDate: "2026-04-10",
      endDate: "2026-04-10",
    });
  });

  it("edit that moves a punch across business days recalculates BOTH BDs (not just one)", async () => {
    // Original punch: 03:43 Apr 11 = BD Apr 10.
    // New punch: 14:00 Apr 12 = BD Apr 12.
    // Recalc range MUST span Apr 10 → Apr 12 so both days are rebuilt.
    setupOriginalPunch({
      id: 101,
      empCode: "1092341718",
      punchTime: new Date("2026-04-11T03:43:00-05:00"),
      punchState: "1",
    });

    await PUT(
      makeRequest({
        punchTime: "2026-04-12T14:00:00-05:00",
        reason: "moved to different day",
        employeeId: 42,
      }),
      makeParams("101"),
    );

    expect(recalcAndInvalidate).toHaveBeenCalledWith({
      employeeId: 42,
      startDate: "2026-04-10",
      endDate: "2026-04-12",
    });
  });

  it("workDate is computed Colombia-aware — a pre-6AM punch never rolls into the next day under a non-UTC-5 server (verified by literal Apr 10 assertion)", async () => {
    // If the handler used server-local getDate/getMonth, then on a UTC
    // server "2026-04-11T03:43:00-05:00" (= 08:43 UTC Apr 11) would
    // produce workDate="2026-04-11" instead of "2026-04-10". Asserting
    // "2026-04-10" literally catches that regression.
    setupOriginalPunch({
      id: 101,
      empCode: "1092341718",
      punchTime: new Date("2026-04-11T03:43:00-05:00"),
      punchState: "1",
    });

    await PUT(
      makeRequest({
        punchTime: "2026-04-11T03:45:00-05:00",
        reason: "TZ safety check",
        employeeId: 42,
      }),
      makeParams("101"),
    );

    const insertValuesCall = vi
      .mocked(db.insert)
      .mock.results[0].value.values.mock.calls[0][0];
    expect(insertValuesCall.workDate).toBe("2026-04-10");
  });
});
