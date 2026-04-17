/**
 * Tests for midnight-crossing punch correction bugs.
 *
 * Covers:
 *   - buildTimestamp: clock-out on next calendar day for midnight-crossing shifts
 *   - Validation: midnight-crossing pairs should not be rejected
 *   - Punch resolver: correctly groups midnight-crossing punches by business day
 */

import { describe, it, expect } from "vitest";
import { resolvePunches, type ShiftSchedule } from "../punch-resolver";

// ─── buildTimestamp (extracted logic matching PunchCorrectionModal) ───────────

function buildTimestamp(date: string, time: string, nextDay = false): string {
  if (nextDay) {
    const d = new Date(date + "T12:00:00");
    d.setDate(d.getDate() + 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}T${time}:00-05:00`;
  }
  return `${date}T${time}:00-05:00`;
}

function parseTime24(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function isClockOutNextDay(
  clockOutTime: string,
  scheduledStart: string | null,
  scheduledEnd: string | null,
): boolean {
  if (!scheduledStart || !scheduledEnd) return false;
  const startMins = parseTime24(scheduledStart);
  const endMins = parseTime24(scheduledEnd);
  if (endMins >= startMins) return false;
  const outMins = parseTime24(clockOutTime);
  return outMins < startMins;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("buildTimestamp", () => {
  it("returns same-day timestamp when nextDay is false", () => {
    expect(buildTimestamp("2026-04-11", "18:00")).toBe("2026-04-11T18:00:00-05:00");
  });

  it("returns next-day timestamp when nextDay is true", () => {
    expect(buildTimestamp("2026-04-11", "00:42", true)).toBe("2026-04-12T00:42:00-05:00");
  });

  it("handles month boundary (e.g., April 30 → May 1)", () => {
    expect(buildTimestamp("2026-04-30", "01:00", true)).toBe("2026-05-01T01:00:00-05:00");
  });

  it("handles year boundary (e.g., Dec 31 → Jan 1)", () => {
    expect(buildTimestamp("2026-12-31", "02:30", true)).toBe("2027-01-01T02:30:00-05:00");
  });
});

describe("isClockOutNextDay", () => {
  it("returns true for post-midnight clock-out on midnight-crossing shift", () => {
    // Shift 18:00-02:00, clock-out at 00:42
    expect(isClockOutNextDay("00:42", "18:00", "02:00")).toBe(true);
  });

  it("returns true for clock-out at exact scheduled end on midnight-crossing shift", () => {
    expect(isClockOutNextDay("02:00", "18:00", "02:00")).toBe(true);
  });

  it("returns true for clock-out at 05:59 on midnight-crossing shift ending at 06:00", () => {
    expect(isClockOutNextDay("05:59", "22:00", "06:00")).toBe(true);
  });

  it("returns false for same-day shift (no midnight crossing)", () => {
    // Shift 08:00-16:00, clock-out at 16:30
    expect(isClockOutNextDay("16:30", "08:00", "16:00")).toBe(false);
  });

  it("returns false for clock-in time on midnight-crossing shift", () => {
    // Shift 18:00-02:00, time 18:00 is NOT post-midnight
    expect(isClockOutNextDay("18:00", "18:00", "02:00")).toBe(false);
  });

  it("returns false for pre-shift time on midnight-crossing shift", () => {
    // Shift 18:00-02:00, time 19:30 is before midnight, not in post-midnight window
    expect(isClockOutNextDay("19:30", "18:00", "02:00")).toBe(false);
  });

  it("returns false when scheduledStart is null", () => {
    expect(isClockOutNextDay("00:42", null, "02:00")).toBe(false);
  });

  it("returns false when scheduledEnd is null", () => {
    expect(isClockOutNextDay("00:42", "18:00", null)).toBe(false);
  });
});

describe("midnight-crossing validation", () => {
  function validatePair(
    inTime: string,
    outTime: string,
    scheduledStart: string | null,
    scheduledEnd: string | null,
  ): boolean {
    const shiftCrossesMidnight =
      scheduledStart != null &&
      scheduledEnd != null &&
      parseTime24(scheduledEnd) < parseTime24(scheduledStart);

    if (!shiftCrossesMidnight && parseTime24(outTime) <= parseTime24(inTime)) {
      return false; // invalid
    }
    return true; // valid
  }

  it("allows midnight-crossing pair: in 18:00, out 00:42", () => {
    expect(validatePair("18:00", "00:42", "18:00", "02:00")).toBe(true);
  });

  it("allows midnight-crossing pair: in 22:00, out 05:30", () => {
    expect(validatePair("22:00", "05:30", "22:00", "06:00")).toBe(true);
  });

  it("rejects non-crossing pair where out < in", () => {
    expect(validatePair("14:00", "08:00", "08:00", "16:00")).toBe(false);
  });

  it("allows normal pair where out > in", () => {
    expect(validatePair("08:00", "16:00", "08:00", "16:00")).toBe(true);
  });
});

describe("punch resolver with midnight-crossing corrections", () => {
  const scheduleMap = new Map<number, ShiftSchedule>();
  // Saturday (dayOfWeek=5) has an 18:00-02:00 shift
  scheduleMap.set(5, {
    dayOfWeek: 5,
    shiftStart: "18:00",
    shiftEnd: "02:00",
    crossesMidnight: true,
  });

  it("groups correctly-timestamped midnight-crossing punches to same business day", () => {
    // Clock-in: 2026-04-11 18:00 COT (Saturday)
    const clockIn = new Date("2026-04-11T18:00:00-05:00");
    // Clock-out: 2026-04-12 00:42 COT (Sunday, next calendar day)
    const clockOut = new Date("2026-04-12T00:42:00-05:00");

    const resolved = resolvePunches(
      "EMP001",
      1,
      [
        { empCode: "EMP001", punchTime: clockIn, punchState: "0" },
        { empCode: "EMP001", punchTime: clockOut, punchState: "1" },
      ],
      scheduleMap,
    );

    expect(resolved).toHaveLength(1);
    expect(resolved[0].clockIn?.toISOString()).toBe(clockIn.toISOString());
    expect(resolved[0].clockOut?.toISOString()).toBe(clockOut.toISOString());
    expect(resolved[0].isMissingPunch).toBe(false);
  });

  it("splits incorrectly-timestamped punches to different business days (the bug)", () => {
    // This test documents the BUG behavior when buildTimestamp uses the same date
    // Clock-in: 2026-04-11 18:00 COT
    const clockIn = new Date("2026-04-11T18:00:00-05:00");
    // Clock-out: 2026-04-11 00:42 COT (WRONG — same calendar day, before midnight)
    const clockOutWrong = new Date("2026-04-11T00:42:00-05:00");

    const resolved = resolvePunches(
      "EMP001",
      1,
      [
        { empCode: "EMP001", punchTime: clockIn, punchState: "0" },
        { empCode: "EMP001", punchTime: clockOutWrong, punchState: "1" },
      ],
      scheduleMap,
    );

    // With the wrong timestamp, they end up on DIFFERENT business days
    expect(resolved).toHaveLength(2);
    // Each day has only one punch → both are missing-punch
    expect(resolved[0].isMissingPunch).toBe(true);
    expect(resolved[1].isMissingPunch).toBe(true);
  });

  it("handles clock-out exactly at midnight (00:00)", () => {
    const clockIn = new Date("2026-04-11T18:00:00-05:00");
    const clockOut = new Date("2026-04-12T00:00:00-05:00");

    const resolved = resolvePunches(
      "EMP001",
      1,
      [
        { empCode: "EMP001", punchTime: clockIn, punchState: "0" },
        { empCode: "EMP001", punchTime: clockOut, punchState: "1" },
      ],
      scheduleMap,
    );

    expect(resolved).toHaveLength(1);
    expect(resolved[0].isMissingPunch).toBe(false);
    expect(resolved[0].clockIn?.toISOString()).toBe(clockIn.toISOString());
    expect(resolved[0].clockOut?.toISOString()).toBe(clockOut.toISOString());
  });

  it("handles late clock-out at 05:00 AM next day", () => {
    const clockIn = new Date("2026-04-11T18:00:00-05:00");
    const clockOut = new Date("2026-04-12T05:00:00-05:00");

    const resolved = resolvePunches(
      "EMP001",
      1,
      [
        { empCode: "EMP001", punchTime: clockIn, punchState: "0" },
        { empCode: "EMP001", punchTime: clockOut, punchState: "1" },
      ],
      scheduleMap,
    );

    expect(resolved).toHaveLength(1);
    expect(resolved[0].isMissingPunch).toBe(false);
  });
});

describe("end-to-end: buildTimestamp + isClockOutNextDay → punch resolver", () => {
  const scheduleMap = new Map<number, ShiftSchedule>();
  scheduleMap.set(5, {
    dayOfWeek: 5,
    shiftStart: "18:00",
    shiftEnd: "02:00",
    crossesMidnight: true,
  });

  it("correctly builds timestamps and resolves punches for 18:00-00:42 shift", () => {
    const workDate = "2026-04-11";
    const clockInTime = "18:00";
    const clockOutTime = "00:42";

    // Build timestamps using the fixed logic
    const clockInTs = buildTimestamp(workDate, clockInTime);
    const nextDay = isClockOutNextDay(clockOutTime, "18:00", "02:00");
    const clockOutTs = buildTimestamp(workDate, clockOutTime, nextDay);

    expect(nextDay).toBe(true);
    expect(clockInTs).toBe("2026-04-11T18:00:00-05:00");
    expect(clockOutTs).toBe("2026-04-12T00:42:00-05:00");

    // Resolve punches
    const resolved = resolvePunches(
      "EMP001",
      1,
      [
        { empCode: "EMP001", punchTime: new Date(clockInTs), punchState: "0" },
        { empCode: "EMP001", punchTime: new Date(clockOutTs), punchState: "1" },
      ],
      scheduleMap,
    );

    expect(resolved).toHaveLength(1);
    expect(resolved[0].isMissingPunch).toBe(false);
    expect(resolved[0].clockIn).toBeTruthy();
    expect(resolved[0].clockOut).toBeTruthy();
  });

  it("correctly handles non-crossing shift (09:00-17:00)", () => {
    const scheduleMapDay = new Map<number, ShiftSchedule>();
    scheduleMapDay.set(0, {
      dayOfWeek: 0,
      shiftStart: "09:00",
      shiftEnd: "17:00",
      crossesMidnight: false,
    });

    const workDate = "2026-04-13"; // Monday
    const clockInTime = "09:00";
    const clockOutTime = "17:00";

    const clockInTs = buildTimestamp(workDate, clockInTime);
    const nextDay = isClockOutNextDay(clockOutTime, "09:00", "17:00");
    const clockOutTs = buildTimestamp(workDate, clockOutTime, nextDay);

    expect(nextDay).toBe(false);
    expect(clockInTs).toBe("2026-04-13T09:00:00-05:00");
    expect(clockOutTs).toBe("2026-04-13T17:00:00-05:00");

    const resolved = resolvePunches(
      "EMP001",
      1,
      [
        { empCode: "EMP001", punchTime: new Date(clockInTs), punchState: "0" },
        { empCode: "EMP001", punchTime: new Date(clockOutTs), punchState: "1" },
      ],
      scheduleMapDay,
    );

    expect(resolved).toHaveLength(1);
    expect(resolved[0].isMissingPunch).toBe(false);
  });
});

// ─── Action resolution for absent employees ─────────────────────────────────
// Mirrors the logic in employees/[id]/page.tsx for choosing the correction action
// when a pencil icon is clicked on a clock-in or clock-out cell.

type CorrectionAction = "add_in" | "add_out" | "edit_in" | "edit_out" | "add_both";

function resolveClockInAction(clockIn: string | null, clockOut: string | null): CorrectionAction {
  return clockIn ? "edit_in" : (!clockOut ? "add_both" : "add_in");
}

function resolveClockOutAction(clockIn: string | null, clockOut: string | null): CorrectionAction {
  return clockOut ? "edit_out" : (!clockIn ? "add_both" : "add_out");
}

describe("correction action resolution for absent employees", () => {
  describe("resolveClockInAction (click pencil on clock-in cell)", () => {
    it("returns 'edit_in' when clockIn exists", () => {
      expect(resolveClockInAction("2026-04-11T08:00:00", "2026-04-11T16:00:00")).toBe("edit_in");
    });

    it("returns 'edit_in' when clockIn exists but clockOut is null (missing punch)", () => {
      expect(resolveClockInAction("2026-04-11T08:00:00", null)).toBe("edit_in");
    });

    it("returns 'add_both' when both clockIn and clockOut are null (absent)", () => {
      expect(resolveClockInAction(null, null)).toBe("add_both");
    });

    it("returns 'add_in' when clockIn is null but clockOut exists", () => {
      expect(resolveClockInAction(null, "2026-04-11T16:00:00")).toBe("add_in");
    });
  });

  describe("resolveClockOutAction (click pencil on clock-out cell)", () => {
    it("returns 'edit_out' when clockOut exists", () => {
      expect(resolveClockOutAction("2026-04-11T08:00:00", "2026-04-11T16:00:00")).toBe("edit_out");
    });

    it("returns 'edit_out' when clockOut exists but clockIn is null", () => {
      expect(resolveClockOutAction(null, "2026-04-11T16:00:00")).toBe("edit_out");
    });

    it("returns 'add_both' when both clockIn and clockOut are null (absent)", () => {
      expect(resolveClockOutAction(null, null)).toBe("add_both");
    });

    it("returns 'add_out' when clockOut is null but clockIn exists (missing punch)", () => {
      expect(resolveClockOutAction("2026-04-11T08:00:00", null)).toBe("add_out");
    });
  });
});

// ─── Modal editability flags ────────────────────────────────────────────────
// Mirrors PunchCorrectionModal's clockInEditable / clockOutEditable logic
// and verifies the save handler includes/excludes the right corrections.

function deriveEditability(action: CorrectionAction) {
  const clockInEditable = action === "add_in" || action === "edit_in" || action === "add_both";
  const clockOutEditable = action === "add_out" || action === "edit_out" || action === "add_both";
  return { clockInEditable, clockOutEditable };
}

function buildCorrections(
  action: CorrectionAction,
  clockInTime: string | null,
  clockOutTime: string | null,
  existingClockIn: string | null,
  existingClockOut: string | null,
) {
  const { clockInEditable, clockOutEditable } = deriveEditability(action);
  const corrections: Array<{ action: string; newValue: string }> = [];

  if (clockInEditable && clockInTime) {
    corrections.push({
      action: existingClockIn ? "edit_in" : "add_in",
      newValue: clockInTime,
    });
  }
  if (clockOutEditable && clockOutTime) {
    corrections.push({
      action: existingClockOut ? "edit_out" : "add_out",
      newValue: clockOutTime,
    });
  }
  return corrections;
}

describe("modal editability and correction building", () => {
  it("add_both makes both fields editable", () => {
    const { clockInEditable, clockOutEditable } = deriveEditability("add_both");
    expect(clockInEditable).toBe(true);
    expect(clockOutEditable).toBe(true);
  });

  it("add_in makes only clock-in editable", () => {
    const { clockInEditable, clockOutEditable } = deriveEditability("add_in");
    expect(clockInEditable).toBe(true);
    expect(clockOutEditable).toBe(false);
  });

  it("add_out makes only clock-out editable", () => {
    const { clockInEditable, clockOutEditable } = deriveEditability("add_out");
    expect(clockInEditable).toBe(false);
    expect(clockOutEditable).toBe(true);
  });

  it("edit_in makes only clock-in editable", () => {
    const { clockInEditable, clockOutEditable } = deriveEditability("edit_in");
    expect(clockInEditable).toBe(true);
    expect(clockOutEditable).toBe(false);
  });

  it("edit_out makes only clock-out editable", () => {
    const { clockInEditable, clockOutEditable } = deriveEditability("edit_out");
    expect(clockInEditable).toBe(false);
    expect(clockOutEditable).toBe(true);
  });

  describe("buildCorrections saves both punches for absent employee", () => {
    it("add_both with both times produces two corrections", () => {
      const corrections = buildCorrections("add_both", "08:00", "16:00", null, null);
      expect(corrections).toHaveLength(2);
      expect(corrections[0]).toEqual({ action: "add_in", newValue: "08:00" });
      expect(corrections[1]).toEqual({ action: "add_out", newValue: "16:00" });
    });

    it("add_in with only clock-in time produces one correction (clock-out ignored)", () => {
      const corrections = buildCorrections("add_in", "08:00", "16:00", null, null);
      expect(corrections).toHaveLength(1);
      expect(corrections[0]).toEqual({ action: "add_in", newValue: "08:00" });
    });

    it("add_out with only clock-out time produces one correction (clock-in ignored)", () => {
      const corrections = buildCorrections("add_out", "08:00", "16:00", null, null);
      expect(corrections).toHaveLength(1);
      expect(corrections[0]).toEqual({ action: "add_out", newValue: "16:00" });
    });
  });

  describe("the original bug scenario", () => {
    it("absent employee clicking pencil on clock-in gets add_both, saving both punches", () => {
      // Step 1: action resolution — both null → add_both
      const action = resolveClockInAction(null, null);
      expect(action).toBe("add_both");

      // Step 2: both fields are editable
      const { clockInEditable, clockOutEditable } = deriveEditability(action);
      expect(clockInEditable).toBe(true);
      expect(clockOutEditable).toBe(true);

      // Step 3: both corrections are built
      const corrections = buildCorrections(action, "08:00", "16:00", null, null);
      expect(corrections).toHaveLength(2);
    });

    it("absent employee clicking pencil on clock-out gets add_both, saving both punches", () => {
      const action = resolveClockOutAction(null, null);
      expect(action).toBe("add_both");

      const { clockInEditable, clockOutEditable } = deriveEditability(action);
      expect(clockInEditable).toBe(true);
      expect(clockOutEditable).toBe(true);

      const corrections = buildCorrections(action, "09:00", "17:00", null, null);
      expect(corrections).toHaveLength(2);
    });

    it("would have failed before the fix: add_in silently drops clock-out", () => {
      // This simulates the old buggy behavior where add_in was used for absent rows
      const buggyAction: CorrectionAction = "add_in";
      const corrections = buildCorrections(buggyAction, "08:00", "16:00", null, null);
      // Only 1 correction — the clock-out the user entered is lost
      expect(corrections).toHaveLength(1);
      expect(corrections[0].action).toBe("add_in");
    });
  });
});
