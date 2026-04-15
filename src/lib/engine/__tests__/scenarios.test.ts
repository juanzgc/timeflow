/**
 * End-to-end scenario tests matching the Phase 3 spec exactly.
 * Each test runs Layer 2 (normalize) + Layer 3 (classify) or Layer 4 (reconcile)
 * and asserts the exact numbers from the spec.
 */

import { describe, it, expect } from "vitest";
import { normalizePunches } from "../punch-normalizer";
import { classifyDay } from "../daily-classifier";
import { reconcilePeriod, applyCompDecision, type DailyRecord } from "../period-reconciler";
import { minutesBetween } from "../time-utils";
import { colombiaStartOfDay, colSetHours, colHours, colMinutes } from "@/lib/timezone";

function d(dateStr: string, time: string): Date {
  const [h, m] = time.split(":").map(Number);
  return colSetHours(colombiaStartOfDay(dateStr), h, m, 0);
}

describe("Scenario 1: Regular day, on time, no excess", () => {
  it("classifies correctly", () => {
    // Schedule: Mon (7h limit), 8:00-15:00
    // Punch in: 7:55, Punch out: 15:00
    const workDate = colombiaStartOfDay("2026-04-13");
    const norm = normalizePunches(
      d("2026-04-13", "07:55"),
      d("2026-04-13", "15:00"),
      "08:00",
      "15:00",
      workDate,
      false,
    );

    expect(colHours(norm.effectiveIn)).toBe(8);
    expect(colMinutes(norm.effectiveIn)).toBe(0);
    expect(colHours(norm.effectiveOut!)).toBe(15);
    expect(colMinutes(norm.effectiveOut!)).toBe(0);
    expect(norm.lateMinutes).toBe(0);

    const cls = classifyDay(
      norm.effectiveIn,
      norm.effectiveOut!,
      workDate,
      [{ start: "08:00", end: "15:00", crossesMidnight: false }],
      0,
      420,
    );

    expect(cls.totalWorkedMins).toBe(420);
    expect(cls.minsOrdinaryDay).toBe(420);
    expect(cls.minsNocturno).toBe(0);
    expect(cls.excessHedMins).toBe(0);
  });
});

describe("Scenario 2: Late arrival", () => {
  it("classifies correctly", () => {
    // Schedule: Mon (7h), 10:00-17:00
    // Punch in: 10:22, Punch out: 17:00
    const workDate = colombiaStartOfDay("2026-04-13");
    const norm = normalizePunches(
      d("2026-04-13", "10:22"),
      d("2026-04-13", "17:00"),
      "10:00",
      "17:00",
      workDate,
      false,
    );

    expect(colHours(norm.effectiveIn)).toBe(10);
    expect(colMinutes(norm.effectiveIn)).toBe(22);
    expect(norm.lateMinutes).toBe(22);

    const cls = classifyDay(
      norm.effectiveIn,
      norm.effectiveOut!,
      workDate,
      [{ start: "10:00", end: "17:00", crossesMidnight: false }],
      0,
      420,
    );

    expect(cls.totalWorkedMins).toBe(398); // 6h 38m
    expect(cls.excessHedMins).toBe(0); // under daily limit
  });
});

describe("Scenario 3: Clock-out after schedule, 15-min floor (no credit)", () => {
  it("12 min excess rounds to 0", () => {
    const workDate = colombiaStartOfDay("2026-04-13");
    const norm = normalizePunches(
      d("2026-04-13", "10:00"),
      d("2026-04-13", "17:12"),
      "10:00",
      "17:00",
      workDate,
      false,
    );

    // effective_out should be 17:00 (12 min excess → floor = 0)
    expect(colHours(norm.effectiveOut!)).toBe(17);
    expect(colMinutes(norm.effectiveOut!)).toBe(0);

    const cls = classifyDay(
      norm.effectiveIn,
      norm.effectiveOut!,
      workDate,
      [{ start: "10:00", end: "17:00", crossesMidnight: false }],
      0,
      420,
    );

    expect(cls.totalWorkedMins).toBe(420);
    expect(cls.excessHedMins).toBe(0);
  });
});

describe("Scenario 4: Clock-out after schedule, 15-min earned", () => {
  it("15 min excess rounds to 15", () => {
    const workDate = colombiaStartOfDay("2026-04-13");
    const norm = normalizePunches(
      d("2026-04-13", "10:00"),
      d("2026-04-13", "17:15"),
      "10:00",
      "17:00",
      workDate,
      false,
    );

    expect(colHours(norm.effectiveOut!)).toBe(17);
    expect(colMinutes(norm.effectiveOut!)).toBe(15);

    const cls = classifyDay(
      norm.effectiveIn,
      norm.effectiveOut!,
      workDate,
      [{ start: "10:00", end: "17:00", crossesMidnight: false }],
      0,
      420,
    );

    expect(cls.totalWorkedMins).toBe(435); // 7h 15m
    expect(cls.excessHedMins).toBe(15); // all diurno (before 7 PM)
  });
});

describe("Scenario 5: Night shift crossing midnight", () => {
  it("classifies nocturno and diurno correctly", () => {
    // Schedule: Sat (8h), 17:00-01:00 crosses midnight
    // Sunday is regular (not a holiday)
    // Punch in: 16:55, Punch out: 01:10
    const workDate = colombiaStartOfDay("2026-04-18"); // Saturday
    const norm = normalizePunches(
      d("2026-04-18", "16:55"),
      d("2026-04-19", "01:10"),
      "17:00",
      "01:00",
      workDate,
      true,
    );

    expect(colHours(norm.effectiveIn)).toBe(17); // capped at schedule
    expect(colHours(norm.effectiveOut!)).toBe(1); // 10 min excess → floor = 0
    expect(colMinutes(norm.effectiveOut!)).toBe(0);

    const cls = classifyDay(
      norm.effectiveIn,
      norm.effectiveOut!,
      workDate,
      [{ start: "17:00", end: "01:00", crossesMidnight: true }],
      0,
      480,
    );

    expect(cls.totalWorkedMins).toBe(480);
    // 17:00-19:00 = 120 min diurno regular
    expect(cls.minsOrdinaryDay).toBe(120);
    // 19:00-01:00 = 360 min nocturno regular (Sun is not a holiday)
    expect(cls.minsNocturno).toBe(360);
    expect(cls.minsFestivoDay).toBe(0);
    expect(cls.minsFestivoNight).toBe(0);
    expect(cls.excessHedMins).toBe(0);
    expect(cls.excessHenMins).toBe(0);
  });
});

describe("Scenario 6: Night shift crossing into a holiday", () => {
  it("splits pre/post midnight by day type", () => {
    // Schedule: Dec 24 (Thu, 7h), 17:00-00:00
    // Dec 25 is Navidad (holiday)
    // Punch in: 17:00, Punch out: 01:15 (Dec 25)
    const workDate = colombiaStartOfDay("2026-12-24");
    const norm = normalizePunches(
      d("2026-12-24", "17:00"),
      d("2026-12-25", "01:15"),
      "17:00",
      "00:00",
      workDate,
      true,
    );

    // Schedule end = 00:00 (next day). Excess = 75 min.
    // floorTo15Min(75) = 75 (75 is exactly 5 × 15-min blocks).
    // effective_out = 00:00 + 75 min = 01:15
    expect(colHours(norm.effectiveOut!)).toBe(1);
    expect(colMinutes(norm.effectiveOut!)).toBe(15);

    const totalMins = minutesBetween(norm.effectiveIn, norm.effectiveOut!);
    expect(totalMins).toBe(495); // 17:00 to 01:15 = 8h 15m

    const cls = classifyDay(
      norm.effectiveIn,
      norm.effectiveOut!,
      workDate,
      [{ start: "17:00", end: "00:00", crossesMidnight: true }],
      0,
      420,
    );

    expect(cls.totalWorkedMins).toBe(495);

    // Pre-midnight (Dec 24, regular):
    //   17:00-19:00 = 120 min ordinary diurno
    //   19:00-00:00 = 300 min nocturno
    expect(cls.minsOrdinaryDay).toBe(120);
    expect(cls.minsNocturno).toBe(300);

    // Post-midnight (Dec 25, holiday):
    //   00:00-01:15 = 75 min festivo nocturno
    expect(cls.minsFestivoDay).toBe(0);
    expect(cls.minsFestivoNight).toBe(75);

    // Excess = 495 - 420 = 75 min from the tail (00:00-01:15, nocturno)
    expect(cls.excessHenMins).toBe(75);
    expect(cls.excessHedMins).toBe(0);
  });
});

describe("Scenario 7: Turno partido (split shift)", () => {
  it("correctly handles split shift with gap subtraction", () => {
    // Schedule: Mon (7h), 12:00-16:00 / 18:00-22:00, gap = 2h
    // Punch in: 12:05, Punch out: 22:00
    const workDate = colombiaStartOfDay("2026-04-13");
    const norm = normalizePunches(
      d("2026-04-13", "12:05"),
      d("2026-04-13", "22:00"),
      "12:00",
      "22:00",
      workDate,
      false,
    );

    expect(colHours(norm.effectiveIn)).toBe(12);
    expect(colMinutes(norm.effectiveIn)).toBe(5);
    expect(norm.lateMinutes).toBe(5);
    expect(colHours(norm.effectiveOut!)).toBe(22);
    expect(colMinutes(norm.effectiveOut!)).toBe(0);

    const cls = classifyDay(
      norm.effectiveIn,
      norm.effectiveOut!,
      workDate,
      [
        { start: "12:00", end: "16:00", crossesMidnight: false },
        { start: "18:00", end: "22:00", crossesMidnight: false },
      ],
      0, // break = 0 (gap handled by segments)
      420,
    );

    // Segment 1: 12:05-16:00 = 235 min, all diurno
    // Segment 2: 18:00-22:00 = 240 min
    //   18:00-19:00 = 60 min diurno
    //   19:00-22:00 = 180 min nocturno
    // Total = 235 + 240 = 475 min (gap excluded by segment clipping)
    expect(cls.totalWorkedMins).toBe(475);

    expect(cls.minsOrdinaryDay).toBe(295); // 235 + 60
    expect(cls.minsNocturno).toBe(180);

    // Excess = 475 - 420 = 55 min
    // Last 55 min of shift = 21:05-22:00, all nocturno
    expect(cls.excessHenMins).toBe(55);
    expect(cls.excessHedMins).toBe(0);
  });
});

describe("Scenario 8: Period reconciliation — cheapest-first", () => {
  it("consumes HED before HEN", () => {
    // Period: Apr 7-13 (7 days), employee scheduled 6 days
    // Expected: 4×7h (Mon-Thu) + 2×8h (Fri-Sat) = 44h = 2640 min
    const dailyRecords: DailyRecord[] = [
      {
        workDate: colombiaStartOfDay("2026-04-07"),
        status: "on-time",
        totalWorkedMins: 600,
        minsOrdinaryDay: 300,
        minsNocturno: 300,
        minsFestivoDay: 0,
        minsFestivoNight: 0,
        excessHedMins: 60,
        excessHenMins: 120,
        lateMinutes: 0,
        earlyLeaveMins: 0,
        dailyLimitMins: 420,
        dayType: "regular",
      },
      {
        workDate: colombiaStartOfDay("2026-04-08"),
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
      {
        workDate: colombiaStartOfDay("2026-04-09"),
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
      {
        workDate: colombiaStartOfDay("2026-04-10"),
        status: "on-time",
        totalWorkedMins: 360,
        minsOrdinaryDay: 360,
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
        workDate: colombiaStartOfDay("2026-04-11"),
        status: "on-time",
        totalWorkedMins: 480,
        minsOrdinaryDay: 480,
        minsNocturno: 0,
        minsFestivoDay: 0,
        minsFestivoNight: 0,
        excessHedMins: 0,
        excessHenMins: 0,
        lateMinutes: 0,
        earlyLeaveMins: 0,
        dailyLimitMins: 480,
        dayType: "regular",
      },
      {
        workDate: colombiaStartOfDay("2026-04-12"),
        status: "on-time",
        totalWorkedMins: 540,
        minsOrdinaryDay: 420,
        minsNocturno: 120,
        minsFestivoDay: 0,
        minsFestivoNight: 0,
        excessHedMins: 30,
        excessHenMins: 30,
        lateMinutes: 0,
        earlyLeaveMins: 0,
        dailyLimitMins: 480,
        dayType: "regular",
      },
    ];

    const result = reconcilePeriod(
      dailyRecords,
      2_000_000, // monthly salary
      colombiaStartOfDay("2026-04-07"),
      0, // comp balance start
    );

    expect(result.totalWorkedMins).toBe(2820);
    expect(result.totalExpectedMins).toBe(2640);
    expect(result.overtimeRawMins).toBe(180);
    expect(result.overtimeOwedMins).toBe(180); // floor(180) = 180

    expect(result.poolHedMins).toBe(90);
    expect(result.poolHenMins).toBe(150);

    // Cheapest-first: consume HED (×1.25) before HEN (×1.75)
    expect(result.otEarnedHedMins).toBe(90);
    expect(result.otEarnedHenMins).toBe(90);
  });
});

describe("Scenario 9: Period reconciliation — comp offset", () => {
  it("offsets negative comp balance from overtime", () => {
    // Same daily records as scenario 8
    const dailyRecords: DailyRecord[] = [
      {
        workDate: colombiaStartOfDay("2026-04-07"),
        status: "on-time",
        totalWorkedMins: 600,
        minsOrdinaryDay: 300,
        minsNocturno: 300,
        minsFestivoDay: 0,
        minsFestivoNight: 0,
        excessHedMins: 60,
        excessHenMins: 120,
        lateMinutes: 0,
        earlyLeaveMins: 0,
        dailyLimitMins: 420,
        dayType: "regular",
      },
      {
        workDate: colombiaStartOfDay("2026-04-08"),
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
      {
        workDate: colombiaStartOfDay("2026-04-09"),
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
      {
        workDate: colombiaStartOfDay("2026-04-10"),
        status: "on-time",
        totalWorkedMins: 360,
        minsOrdinaryDay: 360,
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
        workDate: colombiaStartOfDay("2026-04-11"),
        status: "on-time",
        totalWorkedMins: 480,
        minsOrdinaryDay: 480,
        minsNocturno: 0,
        minsFestivoDay: 0,
        minsFestivoNight: 0,
        excessHedMins: 0,
        excessHenMins: 0,
        lateMinutes: 0,
        earlyLeaveMins: 0,
        dailyLimitMins: 480,
        dayType: "regular",
      },
      {
        workDate: colombiaStartOfDay("2026-04-12"),
        status: "on-time",
        totalWorkedMins: 540,
        minsOrdinaryDay: 420,
        minsNocturno: 120,
        minsFestivoDay: 0,
        minsFestivoNight: 0,
        excessHedMins: 30,
        excessHenMins: 30,
        lateMinutes: 0,
        earlyLeaveMins: 0,
        dailyLimitMins: 480,
        dayType: "regular",
      },
    ];

    const result = reconcilePeriod(
      dailyRecords,
      2_000_000,
      colombiaStartOfDay("2026-04-07"),
      -120, // comp balance: employee owes 2h
    );

    expect(result.overtimeOwedMins).toBe(180);
    expect(result.owedOffsetMins).toBe(120); // min(180, 120)
    expect(result.otAvailableAfterOffset).toBe(60); // 180 - 120

    // Apply manager decision: bank 30, pay 30
    const withDecision = applyCompDecision(result, 30, colombiaStartOfDay("2026-04-07"));
    expect(withDecision.otBankedMins).toBe(30);

    const otPaid = withDecision.otAvailableAfterOffset - 30;
    expect(otPaid).toBe(30);

    // HED ratio = 90 / (90+90) = 0.5
    expect(withDecision.hedMins).toBe(15);
    expect(withDecision.henMins).toBe(15);

    // compBalanceEnd = -120 + 120 (offset) + 30 (banked) = +30
    expect(withDecision.compBalanceEnd).toBe(30);
  });
});

describe("Scenario 10: No overtime — daily excess absorbed by short days", () => {
  it("produces zero overtime when period total matches expected", () => {
    const dailyRecords: DailyRecord[] = [
      {
        workDate: colombiaStartOfDay("2026-04-07"),
        status: "on-time",
        totalWorkedMins: 600,
        minsOrdinaryDay: 300,
        minsNocturno: 300,
        minsFestivoDay: 0,
        minsFestivoNight: 0,
        excessHedMins: 60,
        excessHenMins: 120,
        lateMinutes: 0,
        earlyLeaveMins: 0,
        dailyLimitMins: 420,
        dayType: "regular",
      },
      {
        workDate: colombiaStartOfDay("2026-04-08"),
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
      {
        workDate: colombiaStartOfDay("2026-04-09"),
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
      {
        workDate: colombiaStartOfDay("2026-04-10"),
        status: "on-time",
        totalWorkedMins: 240, // Manager reduced schedule, -180 short
        minsOrdinaryDay: 240,
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
        workDate: colombiaStartOfDay("2026-04-11"),
        status: "on-time",
        totalWorkedMins: 480,
        minsOrdinaryDay: 480,
        minsNocturno: 0,
        minsFestivoDay: 0,
        minsFestivoNight: 0,
        excessHedMins: 0,
        excessHenMins: 0,
        lateMinutes: 0,
        earlyLeaveMins: 0,
        dailyLimitMins: 480,
        dayType: "regular",
      },
      {
        workDate: colombiaStartOfDay("2026-04-12"),
        status: "on-time",
        totalWorkedMins: 480,
        minsOrdinaryDay: 480,
        minsNocturno: 0,
        minsFestivoDay: 0,
        minsFestivoNight: 0,
        excessHedMins: 0,
        excessHenMins: 0,
        lateMinutes: 0,
        earlyLeaveMins: 0,
        dailyLimitMins: 480,
        dayType: "regular",
      },
    ];

    const result = reconcilePeriod(
      dailyRecords,
      2_000_000,
      colombiaStartOfDay("2026-04-07"),
      0,
    );

    // totalWorked = 600+420+420+240+480+480 = 2640
    expect(result.totalWorkedMins).toBe(2640);
    expect(result.totalExpectedMins).toBe(2640);
    expect(result.overtimeRawMins).toBe(0);
    expect(result.overtimeOwedMins).toBe(0);

    // ZERO overtime paid — Monday's excess absorbed by Thursday's shortfall
    expect(result.hedMins).toBe(0);
    expect(result.henMins).toBe(0);
    expect(result.totalExtrasCost).toBe(0);

    // But nocturno recargos from Monday are still paid
    expect(result.rnMins).toBe(300);
    expect(result.rnCost).toBeGreaterThan(0);
  });
});
