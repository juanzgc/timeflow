import { describe, it, expect } from "vitest";
import { normalizePunches } from "../punch-normalizer";
import { colombiaStartOfDay, colSetHours, colHours, colMinutes } from "@/lib/timezone";

function d(dateStr: string, time: string): Date {
  const [h, m] = time.split(":").map(Number);
  return colSetHours(colombiaStartOfDay(dateStr), h, m, 0);
}

describe("normalizePunches", () => {
  const workDate = colombiaStartOfDay("2026-04-13"); // Monday

  it("caps early arrival to schedule start", () => {
    const result = normalizePunches(
      d("2026-04-13", "07:55"),
      d("2026-04-13", "15:00"),
      "08:00",
      "15:00",
      workDate,
      false,
    );
    expect(colHours(result.effectiveIn)).toBe(8);
    expect(colMinutes(result.effectiveIn)).toBe(0);
    expect(result.lateMinutes).toBe(0);
  });

  it("uses actual time for late arrival", () => {
    const result = normalizePunches(
      d("2026-04-13", "10:22"),
      d("2026-04-13", "17:00"),
      "10:00",
      "17:00",
      workDate,
      false,
    );
    expect(colHours(result.effectiveIn)).toBe(10);
    expect(colMinutes(result.effectiveIn)).toBe(22);
    expect(result.lateMinutes).toBe(22);
  });

  it("floors excess to 15-min blocks — 12 min rounds to 0", () => {
    const result = normalizePunches(
      d("2026-04-13", "10:00"),
      d("2026-04-13", "17:12"),
      "10:00",
      "17:00",
      workDate,
      false,
    );
    // 12 min excess → floor(12) = 0 → effective = 17:00
    expect(colHours(result.effectiveOut!)).toBe(17);
    expect(colMinutes(result.effectiveOut!)).toBe(0);
  });

  it("floors excess to 15-min blocks — 15 min rounds to 15", () => {
    const result = normalizePunches(
      d("2026-04-13", "10:00"),
      d("2026-04-13", "17:15"),
      "10:00",
      "17:00",
      workDate,
      false,
    );
    expect(colHours(result.effectiveOut!)).toBe(17);
    expect(colMinutes(result.effectiveOut!)).toBe(15);
  });

  it("floors excess to 15-min blocks — 29 min rounds to 15", () => {
    const result = normalizePunches(
      d("2026-04-13", "10:00"),
      d("2026-04-13", "17:29"),
      "10:00",
      "17:00",
      workDate,
      false,
    );
    expect(colHours(result.effectiveOut!)).toBe(17);
    expect(colMinutes(result.effectiveOut!)).toBe(15);
  });

  it("floors early leave to previous 15-min block", () => {
    const result = normalizePunches(
      d("2026-04-13", "10:00"),
      d("2026-04-13", "16:58"),
      "10:00",
      "17:00",
      workDate,
      false,
    );
    // 16:58 floors to 16:45 — only complete 15-min blocks are payable
    expect(colHours(result.effectiveOut!)).toBe(16);
    expect(colMinutes(result.effectiveOut!)).toBe(45);
    expect(result.earlyLeaveMinutes).toBe(15);
  });

  it("leaves effective_out unchanged when clock-out is already on a 15-min boundary", () => {
    const result = normalizePunches(
      d("2026-04-13", "10:00"),
      d("2026-04-13", "16:45"),
      "10:00",
      "17:00",
      workDate,
      false,
    );
    expect(colHours(result.effectiveOut!)).toBe(16);
    expect(colMinutes(result.effectiveOut!)).toBe(45);
    expect(result.earlyLeaveMinutes).toBe(15);
  });

  it("example from bug report: 10:24 PM clock-out floors to 10:15 PM", () => {
    const result = normalizePunches(
      d("2026-04-13", "16:06"),
      d("2026-04-13", "22:24"),
      "16:00",
      "23:00",
      workDate,
      false,
    );
    expect(colHours(result.effectiveOut!)).toBe(22);
    expect(colMinutes(result.effectiveOut!)).toBe(15);
    expect(result.earlyLeaveMinutes).toBe(45);
  });

  it("handles midnight-crossing shift", () => {
    const result = normalizePunches(
      d("2026-04-13", "16:55"),
      d("2026-04-14", "01:10"),
      "17:00",
      "01:00",
      workDate,
      true,
    );
    // Early arrival capped to 17:00
    expect(colHours(result.effectiveIn)).toBe(17);
    // 10 min excess past 01:00 → floor(10) = 0 → effective = 01:00
    expect(colHours(result.effectiveOut!)).toBe(1);
    expect(colMinutes(result.effectiveOut!)).toBe(0);
  });

  it("handles missing clock-out", () => {
    const result = normalizePunches(
      d("2026-04-13", "08:00"),
      null,
      "08:00",
      "15:00",
      workDate,
      false,
    );
    expect(result.effectiveOut).toBeNull();
    expect(result.earlyLeaveMinutes).toBe(0);
  });
});
