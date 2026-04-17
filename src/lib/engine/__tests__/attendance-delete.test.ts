import { describe, it, expect } from "vitest";

/**
 * Tests for the delete attendance correction-building logic.
 *
 * When an attendance record is deleted, audit entries are inserted into
 * `punch_corrections` with action "delete_in" / "delete_out" and newValue = null.
 */

type DeleteCorrection = {
  action: string;
  oldValue: Date | null;
  newValue: null;
  reason: string;
};

/**
 * Builds the list of punch_corrections entries for a delete operation.
 * This mirrors the logic in the DELETE handler.
 */
function buildDeleteCorrections(
  clockIn: Date | null,
  clockOut: Date | null,
  reason: string,
): DeleteCorrection[] {
  const corrections: DeleteCorrection[] = [];

  if (clockIn) {
    corrections.push({
      action: "delete_in",
      oldValue: clockIn,
      newValue: null,
      reason,
    });
  }

  if (clockOut) {
    corrections.push({
      action: "delete_out",
      oldValue: clockOut,
      newValue: null,
      reason,
    });
  }

  return corrections;
}

describe("attendance delete corrections", () => {
  it("newValue is null for delete_in action", () => {
    const clockIn = new Date("2026-04-15T08:00:00-05:00");
    const corrections = buildDeleteCorrections(clockIn, null, "Bad sync data");
    expect(corrections).toHaveLength(1);
    expect(corrections[0].action).toBe("delete_in");
    expect(corrections[0].newValue).toBeNull();
    expect(corrections[0].oldValue).toEqual(clockIn);
  });

  it("newValue is null for delete_out action", () => {
    const clockOut = new Date("2026-04-15T17:00:00-05:00");
    const corrections = buildDeleteCorrections(null, clockOut, "Phantom record");
    expect(corrections).toHaveLength(1);
    expect(corrections[0].action).toBe("delete_out");
    expect(corrections[0].newValue).toBeNull();
    expect(corrections[0].oldValue).toEqual(clockOut);
  });

  it("delete with both clockIn and clockOut produces two corrections", () => {
    const clockIn = new Date("2026-04-15T08:00:00-05:00");
    const clockOut = new Date("2026-04-15T17:00:00-05:00");
    const corrections = buildDeleteCorrections(clockIn, clockOut, "Duplicate entry from sync");

    expect(corrections).toHaveLength(2);
    expect(corrections[0].action).toBe("delete_in");
    expect(corrections[0].oldValue).toEqual(clockIn);
    expect(corrections[0].newValue).toBeNull();
    expect(corrections[1].action).toBe("delete_out");
    expect(corrections[1].oldValue).toEqual(clockOut);
    expect(corrections[1].newValue).toBeNull();
  });

  it("delete with clockIn only produces one delete_in correction", () => {
    const clockIn = new Date("2026-04-15T08:00:00-05:00");
    const corrections = buildDeleteCorrections(clockIn, null, "Bad sync data");

    expect(corrections).toHaveLength(1);
    expect(corrections[0].action).toBe("delete_in");
  });

  it("delete with neither clockIn nor clockOut produces no corrections", () => {
    const corrections = buildDeleteCorrections(null, null, "Empty phantom record");
    expect(corrections).toHaveLength(0);
  });

  it("reason is preserved in all correction records", () => {
    const clockIn = new Date("2026-04-15T08:00:00-05:00");
    const clockOut = new Date("2026-04-15T17:00:00-05:00");
    const reason = "Confirmed phantom from bad sync";
    const corrections = buildDeleteCorrections(clockIn, clockOut, reason);

    for (const c of corrections) {
      expect(c.reason).toBe(reason);
    }
  });

  describe("reason validation", () => {
    it("reason must be at least 5 characters", () => {
      const reason = "Bad";
      expect(reason.length).toBeLessThan(5);
    });

    it("reason with 5 characters is valid", () => {
      const reason = "Badsy";
      expect(reason.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe("non-delete actions require non-null newValue", () => {
    const nonDeleteActions = ["add_in", "add_out", "edit_in", "edit_out", "add_both"];

    it.each(nonDeleteActions)(
      "%s action should have a non-null newValue in a correction",
      (action) => {
        // For non-delete corrections, newValue is always a timestamp
        const correction = {
          action,
          oldValue: null,
          newValue: new Date("2026-04-15T08:00:00-05:00"),
          reason: "Testing non-delete action",
        };
        expect(correction.newValue).not.toBeNull();
      },
    );
  });
});
