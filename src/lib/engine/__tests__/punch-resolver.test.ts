import { describe, it, expect } from "vitest";
import { resolvePunches, type PunchLog, type ShiftSchedule } from "../punch-resolver";
import { colombiaStartOfDay, colSetHours, colHours, colDate } from "@/lib/timezone";

function punch(dateStr: string, time: string): PunchLog {
  const [h, m] = time.split(":").map(Number);
  return { empCode: "1001", punchTime: colSetHours(colombiaStartOfDay(dateStr), h, m, 0), punchState: null };
}

describe("resolvePunches", () => {
  const scheduleMap = new Map<number, ShiftSchedule>();

  it("groups two punches on the same business day", () => {
    const punches = [
      punch("2026-04-13", "08:00"),
      punch("2026-04-13", "17:00"),
    ];
    const result = resolvePunches("1001", 1, punches, scheduleMap);
    expect(result).toHaveLength(1);
    expect(colHours(result[0].clockIn!)).toBe(8);
    expect(colHours(result[0].clockOut!)).toBe(17);
    expect(result[0].isMissingPunch).toBe(false);
  });

  it("marks single punch as missing", () => {
    const punches = [punch("2026-04-13", "08:00")];
    const result = resolvePunches("1001", 1, punches, scheduleMap);
    expect(result).toHaveLength(1);
    expect(result[0].isMissingPunch).toBe(true);
    expect(result[0].clockOut).toBeNull();
  });

  it("attributes pre-6AM punch to previous business day", () => {
    const punches = [
      punch("2026-04-13", "22:00"),
      punch("2026-04-14", "05:55"),
    ];
    const result = resolvePunches("1001", 1, punches, scheduleMap);
    // Both punches belong to Apr 13 (22:00 is after 6AM = Apr 13,
    // 05:55 is before 6AM = previous day = Apr 13)
    expect(result).toHaveLength(1);
    expect(colDate(result[0].workDate)).toBe(13);
    expect(colHours(result[0].clockIn!)).toBe(22);
    expect(colHours(result[0].clockOut!)).toBe(5);
  });

  it("uses schedule to resolve 6:00-6:30 AM punch for midnight-crossing shift", () => {
    const schedMap = new Map<number, ShiftSchedule>();
    // Monday (0) has a midnight-crossing shift
    schedMap.set(0, {
      dayOfWeek: 0,
      shiftStart: "22:00",
      shiftEnd: "06:00",
      crossesMidnight: true,
    });

    const punches = [
      punch("2026-04-13", "22:00"), // Mon 10PM — business day = Mon
      punch("2026-04-14", "06:05"), // Tue 6:05AM — normally Tue, but Mon had midnight shift
    ];
    const result = resolvePunches("1001", 1, punches, schedMap);
    // 06:05 is within the grace window and Mon has crossesMidnight → attribute to Mon
    expect(result).toHaveLength(1);
    expect(colDate(result[0].workDate)).toBe(13); // Monday
  });

  it("ignores middle punches (uses first and last)", () => {
    const punches = [
      punch("2026-04-13", "08:00"),
      punch("2026-04-13", "12:30"),
      punch("2026-04-13", "17:00"),
    ];
    const result = resolvePunches("1001", 1, punches, scheduleMap);
    expect(result).toHaveLength(1);
    expect(colHours(result[0].clockIn!)).toBe(8);
    expect(colHours(result[0].clockOut!)).toBe(17);
    expect(result[0].allPunches).toHaveLength(3);
  });
});

// ─── punchState-based pairing ───────────────────────────────────────────────
// Rule: within a business day, clockIn = first Entrada (state "0"), clockOut
// = last Salida (state "1"). Multiple Salidas/Entradas on the same day are a
// valid real-world case. Null-state rows fall back to time-order.

function statefulPunch(
  dateStr: string,
  time: string,
  state: "0" | "1" | null,
): PunchLog {
  const [h, m] = time.split(":").map(Number);
  return {
    empCode: "1001",
    punchTime: colSetHours(colombiaStartOfDay(dateStr), h, m, 0),
    punchState: state,
  };
}

describe("resolvePunches — punchState pairing", () => {
  const scheduleMap = new Map<number, ShiftSchedule>();

  it("orphan Salida: clockOut set, clockIn null, isMissingPunch true (Diana Apr 9 scenario)", () => {
    // A single Salida on a business day means the employee left without ever
    // being recorded as arriving. Treating it as a clockIn (old behavior)
    // would mislabel a departure as an arrival.
    const punches = [statefulPunch("2026-04-10", "00:01", "1")];
    // 00:01 is pre-6AM → business day Apr 9
    const result = resolvePunches("1001", 1, punches, scheduleMap);
    expect(result).toHaveLength(1);
    expect(colDate(result[0].workDate)).toBe(9);
    expect(result[0].clockIn).toBeNull();
    expect(result[0].clockOut).not.toBeNull();
    expect(colHours(result[0].clockOut!)).toBe(0);
    expect(result[0].isMissingPunch).toBe(true);
  });

  it("orphan Entrada: clockIn set, clockOut null, isMissingPunch true", () => {
    const punches = [statefulPunch("2026-04-13", "08:00", "0")];
    const result = resolvePunches("1001", 1, punches, scheduleMap);
    expect(result).toHaveLength(1);
    expect(result[0].clockIn).not.toBeNull();
    expect(colHours(result[0].clockIn!)).toBe(8);
    expect(result[0].clockOut).toBeNull();
    expect(result[0].isMissingPunch).toBe(true);
  });

  it("two Salidas in a day (with one Entrada): clockOut takes the LAST Salida", () => {
    // Realistic scenario: employee clocked in, stepped out (Salida), came
    // back through without re-clocking in, then final Salida at end of shift.
    const punches = [
      statefulPunch("2026-04-13", "08:00", "0"), // Entrada
      statefulPunch("2026-04-13", "12:00", "1"), // Salida (step out)
      statefulPunch("2026-04-13", "17:00", "1"), // Salida (final)
    ];
    const result = resolvePunches("1001", 1, punches, scheduleMap);
    expect(result).toHaveLength(1);
    expect(colHours(result[0].clockIn!)).toBe(8);
    expect(colHours(result[0].clockOut!)).toBe(17); // last Salida wins
    expect(result[0].isMissingPunch).toBe(false);
    expect(result[0].allPunches).toHaveLength(3);
  });

  it("two Entradas in a day (with one Salida): clockIn takes the FIRST Entrada", () => {
    const punches = [
      statefulPunch("2026-04-13", "08:00", "0"), // Entrada (real arrival)
      statefulPunch("2026-04-13", "08:05", "0"), // Entrada (accidental re-scan)
      statefulPunch("2026-04-13", "17:00", "1"), // Salida
    ];
    const result = resolvePunches("1001", 1, punches, scheduleMap);
    expect(result).toHaveLength(1);
    expect(colHours(result[0].clockIn!)).toBe(8); // first Entrada wins
    expect(colHours(result[0].clockOut!)).toBe(17);
    expect(result[0].isMissingPunch).toBe(false);
  });

  it("two Salidas only (no Entrada): clockOut = last Salida, clockIn null", () => {
    const punches = [
      statefulPunch("2026-04-13", "12:00", "1"),
      statefulPunch("2026-04-13", "17:00", "1"),
    ];
    const result = resolvePunches("1001", 1, punches, scheduleMap);
    expect(result).toHaveLength(1);
    expect(result[0].clockIn).toBeNull();
    expect(colHours(result[0].clockOut!)).toBe(17);
    expect(result[0].isMissingPunch).toBe(true);
  });

  it("two Entradas only (no Salida): clockIn = first Entrada, clockOut null", () => {
    const punches = [
      statefulPunch("2026-04-13", "08:00", "0"),
      statefulPunch("2026-04-13", "09:00", "0"),
    ];
    const result = resolvePunches("1001", 1, punches, scheduleMap);
    expect(result).toHaveLength(1);
    expect(colHours(result[0].clockIn!)).toBe(8);
    expect(result[0].clockOut).toBeNull();
    expect(result[0].isMissingPunch).toBe(true);
  });

  it("picks first Entrada even when a Salida appears earlier in time (state overrides order)", () => {
    // Weird but legal: a Salida at 07:55 (leftover from prior day?) followed
    // by a proper Entrada at 08:00. The Entrada is the real clock-in.
    const punches = [
      statefulPunch("2026-04-13", "07:55", "1"),
      statefulPunch("2026-04-13", "08:00", "0"),
      statefulPunch("2026-04-13", "17:00", "1"),
    ];
    const result = resolvePunches("1001", 1, punches, scheduleMap);
    expect(result).toHaveLength(1);
    expect(colHours(result[0].clockIn!)).toBe(8); // the Entrada at 08:00
    expect(colHours(result[0].clockOut!)).toBe(17); // last Salida
  });

  it("null-state rows fall back to time-order (legacy/manual data)", () => {
    // No state info anywhere on the day → use first=IN, last=OUT.
    const punches = [
      statefulPunch("2026-04-13", "08:00", null),
      statefulPunch("2026-04-13", "17:00", null),
    ];
    const result = resolvePunches("1001", 1, punches, scheduleMap);
    expect(result).toHaveLength(1);
    expect(colHours(result[0].clockIn!)).toBe(8);
    expect(colHours(result[0].clockOut!)).toBe(17);
    expect(result[0].isMissingPunch).toBe(false);
  });

  it("null-state single punch falls back to clockIn (legacy behavior preserved)", () => {
    const punches = [statefulPunch("2026-04-13", "08:00", null)];
    const result = resolvePunches("1001", 1, punches, scheduleMap);
    expect(result).toHaveLength(1);
    expect(colHours(result[0].clockIn!)).toBe(8);
    expect(result[0].clockOut).toBeNull();
    expect(result[0].isMissingPunch).toBe(true);
  });

  it("mixed state + null-state on same day: the authoritative states drive pairing, null rows are ignored for pairing", () => {
    // A null-state row is "unknown" — if any IN/OUT state exists on the day,
    // trust the stateful rows and don't let the null contaminate pairing.
    const punches = [
      statefulPunch("2026-04-13", "07:00", null), // unknown — ignored
      statefulPunch("2026-04-13", "08:00", "0"), // Entrada
      statefulPunch("2026-04-13", "17:00", "1"), // Salida
    ];
    const result = resolvePunches("1001", 1, punches, scheduleMap);
    expect(result).toHaveLength(1);
    expect(colHours(result[0].clockIn!)).toBe(8);
    expect(colHours(result[0].clockOut!)).toBe(17);
    expect(result[0].isMissingPunch).toBe(false);
  });

  it("Diana Apr 10 full scenario: Entrada 16:59 + Salida 03:43 next day → pairs into BD Apr 10", () => {
    // Regression test for the original bug report: 5pm-1am shift,
    // employee clocked in 16:59 Apr 10, clocked out 03:43 Apr 11.
    // Pre-6AM Apr 11 punch rolls into BD Apr 10.
    const punches = [
      statefulPunch("2026-04-10", "16:59", "0"),
      statefulPunch("2026-04-11", "03:43", "1"),
    ];
    const result = resolvePunches("1001", 1, punches, scheduleMap);
    expect(result).toHaveLength(1);
    expect(colDate(result[0].workDate)).toBe(10);
    expect(colHours(result[0].clockIn!)).toBe(16);
    expect(colHours(result[0].clockOut!)).toBe(3);
    expect(result[0].isMissingPunch).toBe(false);
  });
});
