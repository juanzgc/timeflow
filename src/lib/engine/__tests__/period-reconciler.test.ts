import { describe, it, expect } from "vitest";
import { reconcilePeriod, type DailyRecord } from "../period-reconciler";
import { colombiaStartOfDay } from "@/lib/timezone";

describe("reconcilePeriod", () => {
  it("calculates hora ordinaria correctly for pre-July 2026", () => {
    const records: DailyRecord[] = [
      {
        workDate: colombiaStartOfDay("2026-04-13"),
        status: "on-time",
        totalWorkedMins: 420,
        minsOrdinaryDay: 420,
        minsNocturno: 0,
        minsFestivoDay: 0,
        minsFestivoNight: 0,
        excessHedMins: 0,
        excessHenMins: 0,
        lateMinutes: 0,
        earlyLeaveMins: 0,
        dailyLimitMins: 420,
        dayType: "regular",
      },
    ];

    const result = reconcilePeriod(records, 2_200_000, colombiaStartOfDay("2026-04-07"), 0);
    // 2,200,000 / 220 = 10,000 per hour
    expect(result.horaOrdinariaValue).toBe(10000);
  });

  it("counts absent days correctly", () => {
    const records: DailyRecord[] = [
      {
        workDate: colombiaStartOfDay("2026-04-13"),
        status: "absent",
        totalWorkedMins: 0,
        minsOrdinaryDay: 0,
        minsNocturno: 0,
        minsFestivoDay: 0,
        minsFestivoNight: 0,
        excessHedMins: 0,
        excessHenMins: 0,
        lateMinutes: 0,
        earlyLeaveMins: 0,
        dailyLimitMins: 420,
        dayType: "regular",
      },
      {
        workDate: colombiaStartOfDay("2026-04-14"),
        status: "on-time",
        totalWorkedMins: 420,
        minsOrdinaryDay: 420,
        minsNocturno: 0,
        minsFestivoDay: 0,
        minsFestivoNight: 0,
        excessHedMins: 0,
        excessHenMins: 0,
        lateMinutes: 0,
        earlyLeaveMins: 0,
        dailyLimitMins: 420,
        dayType: "regular",
      },
    ];

    const result = reconcilePeriod(records, 2_000_000, colombiaStartOfDay("2026-04-07"), 0);
    expect(result.daysScheduled).toBe(2);
    expect(result.daysWorked).toBe(1);
    expect(result.daysAbsent).toBe(1);
  });

  it("floors overtime to 15-minute blocks", () => {
    // 7 min of overtime raw → floors to 0
    const records: DailyRecord[] = [
      {
        workDate: colombiaStartOfDay("2026-04-13"),
        status: "on-time",
        totalWorkedMins: 427, // 7 min over
        minsOrdinaryDay: 427,
        minsNocturno: 0,
        minsFestivoDay: 0,
        minsFestivoNight: 0,
        excessHedMins: 7,
        excessHenMins: 0,
        lateMinutes: 0,
        earlyLeaveMins: 0,
        dailyLimitMins: 420,
        dayType: "regular",
      },
    ];

    const result = reconcilePeriod(records, 2_000_000, colombiaStartOfDay("2026-04-07"), 0);
    expect(result.overtimeRawMins).toBe(7);
    expect(result.overtimeOwedMins).toBe(0); // floor(7) = 0
  });

  it("counts holidays worked", () => {
    const records: DailyRecord[] = [
      {
        workDate: colombiaStartOfDay("2026-05-01"),
        status: "on-time",
        totalWorkedMins: 420,
        minsOrdinaryDay: 0,
        minsNocturno: 0,
        minsFestivoDay: 420,
        minsFestivoNight: 0,
        excessHedMins: 0,
        excessHenMins: 0,
        lateMinutes: 0,
        earlyLeaveMins: 0,
        dailyLimitMins: 420,
        dayType: "holiday",
      },
    ];

    const result = reconcilePeriod(records, 2_000_000, colombiaStartOfDay("2026-04-28"), 0);
    expect(result.holidaysWorked).toBe(1);
    expect(result.rfMins).toBe(420);
    expect(result.rfCost).toBeGreaterThan(0);
  });
});
