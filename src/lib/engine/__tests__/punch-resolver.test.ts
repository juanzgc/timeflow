import { describe, it, expect } from "vitest";
import { resolvePunches, type PunchLog, type ShiftSchedule } from "../punch-resolver";

function punch(dateStr: string, time: string): PunchLog {
  const [h, m] = time.split(":").map(Number);
  const date = new Date(dateStr + "T00:00:00");
  date.setHours(h, m, 0, 0);
  return { empCode: "1001", punchTime: date, punchState: null };
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
    expect(result[0].clockIn!.getHours()).toBe(8);
    expect(result[0].clockOut!.getHours()).toBe(17);
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
    expect(result[0].workDate.getDate()).toBe(13);
    expect(result[0].clockIn!.getHours()).toBe(22);
    expect(result[0].clockOut!.getHours()).toBe(5);
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
    expect(result[0].workDate.getDate()).toBe(13); // Monday
  });

  it("ignores middle punches (uses first and last)", () => {
    const punches = [
      punch("2026-04-13", "08:00"),
      punch("2026-04-13", "12:30"),
      punch("2026-04-13", "17:00"),
    ];
    const result = resolvePunches("1001", 1, punches, scheduleMap);
    expect(result).toHaveLength(1);
    expect(result[0].clockIn!.getHours()).toBe(8);
    expect(result[0].clockOut!.getHours()).toBe(17);
    expect(result[0].allPunches).toHaveLength(3);
  });
});
