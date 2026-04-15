/**
 * Phase 6 — Testing & Validation
 *
 * End-to-end verification scenarios matching the Phase 6 spec exactly.
 * Tests three employee archetypes:
 *   Carlos  — Kitchen, day shift (8 AM - 3 PM / 4 PM)
 *   Valentina — Bar, night shift (5 PM - 12 AM / 1 AM, crosses midnight)
 *   Andrés  — Servers, split shift (12 PM-4 PM / 6 PM-10 PM)
 *
 * Each scenario verifies:
 *   1. Punch normalization (clock-in cap, clock-out 15-min floor)
 *   2. Minute classification (4 buckets, 7PM nocturno boundary)
 *   3. Daily excess pool (tail-end HED/HEN tagging)
 *   4. Period reconciliation (cheapest-first, comp offset)
 *   5. All 5 invariants from the spec
 */

import { describe, it, expect } from "vitest";
import { normalizePunches } from "../punch-normalizer";
import { classifyDay, type ShiftSegment } from "../daily-classifier";
import {
  reconcilePeriod,
  applyCompDecision,
  type DailyRecord,
} from "../period-reconciler";
import { minutesBetween } from "../time-utils";
import { colombiaStartOfDay, colSetHours, colHours, colMinutes } from "@/lib/timezone";

// ─── Helpers ───────────────────────────────────────────────────────────────

function d(dateStr: string, time: string): Date {
  const [h, m] = time.split(":").map(Number);
  return colSetHours(colombiaStartOfDay(dateStr), h, m, 0);
}

/** Run the full normalize → classify pipeline for a day */
function processDay(params: {
  workDate: string;
  clockIn: string;
  clockOut: string;
  clockOutDate?: string;
  scheduledStart: string;
  scheduledEnd: string;
  crossesMidnight: boolean;
  dailyLimitMins: number;
  segments?: ShiftSegment[];
  breakMins?: number;
}) {
  const workDate = colombiaStartOfDay(params.workDate);
  const clockOutDate = params.clockOutDate ?? params.workDate;

  const norm = normalizePunches(
    d(params.workDate, params.clockIn),
    d(clockOutDate, params.clockOut),
    params.scheduledStart,
    params.scheduledEnd,
    workDate,
    params.crossesMidnight,
  );

  const segments: ShiftSegment[] = params.segments ?? [
    {
      start: params.scheduledStart,
      end: params.scheduledEnd,
      crossesMidnight: params.crossesMidnight,
    },
  ];

  const cls = classifyDay(
    norm.effectiveIn,
    norm.effectiveOut!,
    workDate,
    segments,
    params.breakMins ?? 0,
    params.dailyLimitMins,
  );

  return { norm, cls };
}

/** Assert invariant 1: bucket sum equals total worked */
function assertBucketSum(cls: {
  totalWorkedMins: number;
  minsOrdinaryDay: number;
  minsNocturno: number;
  minsFestivoDay: number;
  minsFestivoNight: number;
}) {
  const sum =
    cls.minsOrdinaryDay +
    cls.minsNocturno +
    cls.minsFestivoDay +
    cls.minsFestivoNight;
  expect(sum).toBe(cls.totalWorkedMins);
}

/** Assert invariant 2: excess pool equals overage */
function assertExcessPool(cls: {
  totalWorkedMins: number;
  excessHedMins: number;
  excessHenMins: number;
  dailyLimitMins: number;
}) {
  const expectedExcess = Math.max(0, cls.totalWorkedMins - cls.dailyLimitMins);
  expect(cls.excessHedMins + cls.excessHenMins).toBe(expectedExcess);
}

// ═══════════════════════════════════════════════════════════════════════════
// CARLOS — Day Shift (Kitchen)
// Schedule: Mon 8-15, Tue OFF, Wed 8-15, Thu 8-15, Fri 8-16, Sat 8-16, Sun 8-15
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 6: Carlos — Day Shift Verification", () => {
  describe("Punch Normalization", () => {
    it("caps early arrival at schedule start", () => {
      // Raw: 7:55 → 15:00. Schedule: 8:00 - 15:00
      const { norm } = processDay({
        workDate: "2026-04-06",
        clockIn: "07:55",
        clockOut: "15:00",
        scheduledStart: "08:00",
        scheduledEnd: "15:00",
        crossesMidnight: false,
        dailyLimitMins: 420,
      });

      expect(colHours(norm.effectiveIn)).toBe(8);
      expect(colMinutes(norm.effectiveIn)).toBe(0);
      expect(norm.lateMinutes).toBe(0);
      expect(colHours(norm.effectiveOut!)).toBe(15);
      expect(colMinutes(norm.effectiveOut!)).toBe(0);
    });

    it("records late arrival correctly (22 min)", () => {
      const { norm } = processDay({
        workDate: "2026-04-08",
        clockIn: "08:22",
        clockOut: "15:00",
        scheduledStart: "08:00",
        scheduledEnd: "15:00",
        crossesMidnight: false,
        dailyLimitMins: 420,
      });

      expect(colHours(norm.effectiveIn)).toBe(8);
      expect(colMinutes(norm.effectiveIn)).toBe(22);
      expect(norm.lateMinutes).toBe(22);
    });

    it("discards 12-min excess (below 15-min floor)", () => {
      const { norm } = processDay({
        workDate: "2026-04-06",
        clockIn: "08:00",
        clockOut: "15:12",
        scheduledStart: "08:00",
        scheduledEnd: "15:00",
        crossesMidnight: false,
        dailyLimitMins: 420,
      });

      expect(colHours(norm.effectiveOut!)).toBe(15);
      expect(colMinutes(norm.effectiveOut!)).toBe(0);
    });

    it("credits exactly 15-min excess", () => {
      const { norm, cls } = processDay({
        workDate: "2026-04-06",
        clockIn: "08:00",
        clockOut: "15:15",
        scheduledStart: "08:00",
        scheduledEnd: "15:00",
        crossesMidnight: false,
        dailyLimitMins: 420,
      });

      expect(colHours(norm.effectiveOut!)).toBe(15);
      expect(colMinutes(norm.effectiveOut!)).toBe(15);
      expect(cls.totalWorkedMins).toBe(435);
      expect(cls.excessHedMins).toBe(15);
    });

    it("credits 2h excess from 5:12 PM clock-out (Mon, 8-15 schedule)", () => {
      // Excess: 5:12 PM - 3:00 PM = 132 min, floor(132/15)*15 = 120 min
      const { norm, cls } = processDay({
        workDate: "2026-04-06",
        clockIn: "07:55",
        clockOut: "17:12",
        scheduledStart: "08:00",
        scheduledEnd: "15:00",
        crossesMidnight: false,
        dailyLimitMins: 420,
      });

      expect(colHours(norm.effectiveIn)).toBe(8);
      expect(colHours(norm.effectiveOut!)).toBe(17);
      expect(colMinutes(norm.effectiveOut!)).toBe(0);
      expect(cls.totalWorkedMins).toBe(540); // 8:00 - 17:00 = 9h
      expect(cls.excessHedMins).toBe(120); // all diurno (15:00-17:00)
      expect(cls.excessHenMins).toBe(0);
    });
  });

  describe("Minute Classification", () => {
    it("all-diurno day: entire shift → minsOrdinaryDay", () => {
      const { cls } = processDay({
        workDate: "2026-04-06", // Monday, regular
        clockIn: "08:00",
        clockOut: "15:00",
        scheduledStart: "08:00",
        scheduledEnd: "15:00",
        crossesMidnight: false,
        dailyLimitMins: 420,
      });

      expect(cls.minsOrdinaryDay).toBe(420);
      expect(cls.minsNocturno).toBe(0);
      expect(cls.minsFestivoDay).toBe(0);
      expect(cls.minsFestivoNight).toBe(0);
      assertBucketSum(cls);
      assertExcessPool(cls);
    });

    it("day shift with excess: tail classified as HED", () => {
      const { cls } = processDay({
        workDate: "2026-04-06",
        clockIn: "07:55",
        clockOut: "17:12",
        scheduledStart: "08:00",
        scheduledEnd: "15:00",
        crossesMidnight: false,
        dailyLimitMins: 420,
      });

      // 8:00 - 17:00 = 540 min, all before 7PM → all diurno
      expect(cls.minsOrdinaryDay).toBe(540);
      expect(cls.minsNocturno).toBe(0);
      assertBucketSum(cls);

      // Excess = 540 - 420 = 120 min, from 15:00-17:00 (diurno) → HED
      expect(cls.excessHedMins).toBe(120);
      expect(cls.excessHenMins).toBe(0);
      assertExcessPool(cls);
    });
  });

  describe("Period Reconciliation", () => {
    it("matches spec calculation for Carlos week", () => {
      // Carlos: Mon(7h) + Wed(7h) + Thu(7h) + Fri(8h) + Sat(8h) + Sun(7h) = 44h
      const dailyRecords: DailyRecord[] = [
        // Mon: 8:00-17:00 = 540 min, limit 420
        {
          workDate: new Date("2026-04-06"),
          status: "on-time",
          totalWorkedMins: 540,
          minsOrdinaryDay: 540,
          minsNocturno: 0,
          minsFestivoDay: 0,
          minsFestivoNight: 0,
          excessHedMins: 120,
          excessHenMins: 0,
          lateMinutes: 0,
          earlyLeaveMins: 0,
          dailyLimitMins: 420,
          dayType: "regular",
        },
        // Tue: OFF (rest day) — not included
        // Wed: 8:00-15:00 = 420 min
        {
          workDate: new Date("2026-04-08"),
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
        // Thu: 8:00-15:00 = 420 min
        {
          workDate: new Date("2026-04-09"),
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
        // Fri: 8:00-16:00 = 480 min, limit 480
        {
          workDate: new Date("2026-04-10"),
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
        // Sat: 8:00-16:30 = 510 min, limit 480
        {
          workDate: new Date("2026-04-11"),
          status: "on-time",
          totalWorkedMins: 510,
          minsOrdinaryDay: 510,
          minsNocturno: 0,
          minsFestivoDay: 0,
          minsFestivoNight: 0,
          excessHedMins: 30,
          excessHenMins: 0,
          lateMinutes: 0,
          earlyLeaveMins: 0,
          dailyLimitMins: 480,
          dayType: "regular",
        },
        // Sun: 8:00-15:00 = 420 min
        {
          workDate: new Date("2026-04-12"),
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

      const result = reconcilePeriod(
        dailyRecords,
        2_000_000,
        new Date("2026-04-06"),
        0,
      );

      expect(result.totalExpectedMins).toBe(2640); // 44h
      expect(result.totalWorkedMins).toBe(2790); // 46h 30m
      expect(result.overtimeRawMins).toBe(150);
      expect(result.overtimeOwedMins).toBe(150); // floor(150/15)*15 = 150

      // Pool: Mon(120 HED) + Sat(30 HED) = 150 HED, 0 HEN
      expect(result.poolHedMins).toBe(150);
      expect(result.poolHenMins).toBe(0);

      // Cheapest-first: 150 min from HED pool
      expect(result.otEarnedHedMins).toBe(150);
      expect(result.otEarnedHenMins).toBe(0);

      // All recargos = 0 (day shift, no holidays)
      expect(result.rnMins).toBe(0);
      expect(result.rfMins).toBe(0);
      expect(result.rfnMins).toBe(0);
      expect(result.totalRecargosCost).toBe(0);

      // OT cost: (150/60) × (2,000,000/220) × 1.25
      const horaOrd = 2_000_000 / 220;
      const expectedHedCost = Math.round((150 / 60) * horaOrd * 1.25);
      expect(result.hedCost).toBe(expectedHedCost);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// VALENTINA — Night Shift (Bar)
// Schedule: Mon 17-00, Tue 17-00, Wed OFF, Thu 17-00, Fri 17-01, Sat 17-01, Sun 17-00
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 6: Valentina — Night Shift Verification", () => {
  describe("Minute Classification", () => {
    it("splits diurno/nocturno at 7 PM", () => {
      // Mon: 17:00-00:00 = 420 min
      //   17:00-19:00 = 120 min ordinary diurno
      //   19:00-00:00 = 300 min nocturno
      const { cls } = processDay({
        workDate: "2026-04-06",
        clockIn: "16:55",
        clockOut: "00:00",
        clockOutDate: "2026-04-07",
        scheduledStart: "17:00",
        scheduledEnd: "00:00",
        crossesMidnight: true,
        dailyLimitMins: 420,
      });

      expect(cls.totalWorkedMins).toBe(420);
      expect(cls.minsOrdinaryDay).toBe(120);
      expect(cls.minsNocturno).toBe(300);
      expect(cls.minsFestivoDay).toBe(0);
      expect(cls.minsFestivoNight).toBe(0);
      assertBucketSum(cls);
      assertExcessPool(cls);
    });

    it("night shift with excess — HEN tagging", () => {
      // Fri: 17:00-01:00 = 480 min (scheduled), actual: 17:00-01:30 next day
      // Excess = 30 min. floor(30/15)*15 = 30 min. effective_out = 01:30
      // Actually, effective_out = 01:00 + 30 = 01:30
      const { norm, cls } = processDay({
        workDate: "2026-04-10",
        clockIn: "16:55",
        clockOut: "01:30",
        clockOutDate: "2026-04-11",
        scheduledStart: "17:00",
        scheduledEnd: "01:00",
        crossesMidnight: true,
        dailyLimitMins: 480,
      });

      expect(colHours(norm.effectiveIn)).toBe(17);
      expect(colHours(norm.effectiveOut!)).toBe(1);
      expect(colMinutes(norm.effectiveOut!)).toBe(30);

      expect(cls.totalWorkedMins).toBe(510);
      // 17:00-19:00 = 120 ordinary
      // 19:00-01:30 = 390 nocturno
      expect(cls.minsOrdinaryDay).toBe(120);
      expect(cls.minsNocturno).toBe(390);
      assertBucketSum(cls);

      // Excess = 510 - 480 = 30 min, tail is nocturno → HEN
      expect(cls.excessHenMins).toBe(30);
      expect(cls.excessHedMins).toBe(0);
      assertExcessPool(cls);
    });
  });

  describe("Period Reconciliation — Nocturno Recargos", () => {
    it("calculates recargos correctly for night shift employee", () => {
      // Val: Mon(7h) + Tue(7h) + Thu(7h) + Fri(8h) + Sat(8h) + Sun(7h) = 44h
      // Each day has nocturno hours: 300, 300, 300, 360, 360, 300 = 1920 min
      const dailyRecords: DailyRecord[] = [
        // Mon: 17:00-00:00 = 420 min (120 ord + 300 noc)
        {
          workDate: new Date("2026-04-06"),
          status: "on-time",
          totalWorkedMins: 420,
          minsOrdinaryDay: 120,
          minsNocturno: 300,
          minsFestivoDay: 0,
          minsFestivoNight: 0,
          excessHedMins: 0,
          excessHenMins: 0,
          lateMinutes: 0,
          earlyLeaveMins: 0,
          dailyLimitMins: 420,
          dayType: "regular",
        },
        // Tue: 17:00-00:00 = 420 min
        {
          workDate: new Date("2026-04-07"),
          status: "on-time",
          totalWorkedMins: 420,
          minsOrdinaryDay: 120,
          minsNocturno: 300,
          minsFestivoDay: 0,
          minsFestivoNight: 0,
          excessHedMins: 0,
          excessHenMins: 0,
          lateMinutes: 0,
          earlyLeaveMins: 0,
          dailyLimitMins: 420,
          dayType: "regular",
        },
        // Wed: OFF
        // Thu: 17:00-00:00 = 420 min
        {
          workDate: new Date("2026-04-09"),
          status: "on-time",
          totalWorkedMins: 420,
          minsOrdinaryDay: 120,
          minsNocturno: 300,
          minsFestivoDay: 0,
          minsFestivoNight: 0,
          excessHedMins: 0,
          excessHenMins: 0,
          lateMinutes: 0,
          earlyLeaveMins: 0,
          dailyLimitMins: 420,
          dayType: "regular",
        },
        // Fri: 17:00-01:00 = 480 min (120 ord + 360 noc)
        {
          workDate: new Date("2026-04-10"),
          status: "on-time",
          totalWorkedMins: 480,
          minsOrdinaryDay: 120,
          minsNocturno: 360,
          minsFestivoDay: 0,
          minsFestivoNight: 0,
          excessHedMins: 0,
          excessHenMins: 0,
          lateMinutes: 0,
          earlyLeaveMins: 0,
          dailyLimitMins: 480,
          dayType: "regular",
        },
        // Sat: 17:00-01:00 = 480 min
        {
          workDate: new Date("2026-04-11"),
          status: "on-time",
          totalWorkedMins: 480,
          minsOrdinaryDay: 120,
          minsNocturno: 360,
          minsFestivoDay: 0,
          minsFestivoNight: 0,
          excessHedMins: 0,
          excessHenMins: 0,
          lateMinutes: 0,
          earlyLeaveMins: 0,
          dailyLimitMins: 480,
          dayType: "regular",
        },
        // Sun: 17:00-00:00 = 420 min
        {
          workDate: new Date("2026-04-12"),
          status: "on-time",
          totalWorkedMins: 420,
          minsOrdinaryDay: 120,
          minsNocturno: 300,
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

      const result = reconcilePeriod(
        dailyRecords,
        1_800_000,
        new Date("2026-04-06"),
        0,
      );

      expect(result.totalExpectedMins).toBe(2640);
      expect(result.totalWorkedMins).toBe(2640);
      expect(result.overtimeOwedMins).toBe(0); // no overtime

      // Recargos: always paid regardless of overtime
      expect(result.rnMins).toBe(1920); // 32h nocturno
      expect(result.rfMins).toBe(0);
      expect(result.rfnMins).toBe(0);

      // rnCost = (1920/60) × ($1,800,000/220) × 0.35
      const horaOrd = 1_800_000 / 220;
      const expectedRnCost = Math.round((1920 / 60) * horaOrd * 0.35);
      expect(result.rnCost).toBe(expectedRnCost);
      expect(result.totalRecargosCost).toBe(expectedRnCost);

      // No overtime → no extras
      expect(result.totalExtrasCost).toBe(0);
      expect(result.totalSurcharges).toBe(expectedRnCost);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ANDRÉS — Split Shift (Servers)
// Schedule: Mon OFF, Tue-Sun 12-16 / 18-22 (turno partido)
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 6: Andrés — Split Shift Verification", () => {
  describe("Minute Classification", () => {
    it("correctly handles split shift with gap subtraction", () => {
      // Tue: 12:00-16:00 / 18:00-22:00, limit 7h
      // Punch: 12:00-22:00
      const { cls } = processDay({
        workDate: "2026-04-07", // Tuesday
        clockIn: "12:00",
        clockOut: "22:00",
        scheduledStart: "12:00",
        scheduledEnd: "22:00",
        crossesMidnight: false,
        dailyLimitMins: 420,
        segments: [
          { start: "12:00", end: "16:00", crossesMidnight: false },
          { start: "18:00", end: "22:00", crossesMidnight: false },
        ],
      });

      // Segment 1: 12:00-16:00 = 240 min, all diurno
      // Segment 2: 18:00-22:00 = 240 min
      //   18:00-19:00 = 60 diurno
      //   19:00-22:00 = 180 nocturno
      // Total = 480 min (gap excluded by segment clipping)
      expect(cls.totalWorkedMins).toBe(480);
      expect(cls.minsOrdinaryDay).toBe(300); // 240 + 60
      expect(cls.minsNocturno).toBe(180);
      assertBucketSum(cls);

      // Excess = 480 - 420 = 60 min from tail (21:00-22:00, nocturno)
      expect(cls.excessHenMins).toBe(60);
      expect(cls.excessHedMins).toBe(0);
      assertExcessPool(cls);
    });

    it("handles late arrival with split shift", () => {
      const { norm, cls } = processDay({
        workDate: "2026-04-07",
        clockIn: "12:05",
        clockOut: "22:00",
        scheduledStart: "12:00",
        scheduledEnd: "22:00",
        crossesMidnight: false,
        dailyLimitMins: 420,
        segments: [
          { start: "12:00", end: "16:00", crossesMidnight: false },
          { start: "18:00", end: "22:00", crossesMidnight: false },
        ],
      });

      expect(norm.lateMinutes).toBe(5);
      // Segment 1: 12:05-16:00 = 235 min
      // Segment 2: 18:00-22:00 = 240 min
      // Total = 475 min
      expect(cls.totalWorkedMins).toBe(475);
      expect(cls.minsOrdinaryDay).toBe(295); // 235 + 60
      expect(cls.minsNocturno).toBe(180);
      assertBucketSum(cls);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EDGE CASES — spec §9
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 6: Edge Cases", () => {
  describe("§9.2 Early arrival (clock-in before schedule)", () => {
    it("effective_in = scheduled_start, late_minutes = 0", () => {
      const { norm } = processDay({
        workDate: "2026-04-06",
        clockIn: "07:30",
        clockOut: "15:00",
        scheduledStart: "08:00",
        scheduledEnd: "15:00",
        crossesMidnight: false,
        dailyLimitMins: 420,
      });

      expect(colHours(norm.effectiveIn)).toBe(8);
      expect(colMinutes(norm.effectiveIn)).toBe(0);
      expect(norm.lateMinutes).toBe(0);
    });
  });

  describe("§9.3 Clock-out exactly at schedule end", () => {
    it("no excess, no rounding", () => {
      const { norm, cls } = processDay({
        workDate: "2026-04-06",
        clockIn: "08:00",
        clockOut: "15:00",
        scheduledStart: "08:00",
        scheduledEnd: "15:00",
        crossesMidnight: false,
        dailyLimitMins: 420,
      });

      expect(colHours(norm.effectiveOut!)).toBe(15);
      expect(colMinutes(norm.effectiveOut!)).toBe(0);
      expect(cls.excessHedMins).toBe(0);
      expect(cls.excessHenMins).toBe(0);
    });
  });

  describe("§9.4 Clock-out 14 min after schedule (below floor)", () => {
    it("14 min excess is discarded", () => {
      const { norm, cls } = processDay({
        workDate: "2026-04-06",
        clockIn: "08:00",
        clockOut: "15:14",
        scheduledStart: "08:00",
        scheduledEnd: "15:00",
        crossesMidnight: false,
        dailyLimitMins: 420,
      });

      expect(colHours(norm.effectiveOut!)).toBe(15);
      expect(colMinutes(norm.effectiveOut!)).toBe(0);
      expect(cls.totalWorkedMins).toBe(420);
      expect(cls.excessHedMins).toBe(0);
    });
  });

  describe("§9.5 Clock-out exactly 15 min after schedule", () => {
    it("15 min excess is earned", () => {
      const { norm, cls } = processDay({
        workDate: "2026-04-06",
        clockIn: "08:00",
        clockOut: "15:15",
        scheduledStart: "08:00",
        scheduledEnd: "15:00",
        crossesMidnight: false,
        dailyLimitMins: 420,
      });

      expect(colHours(norm.effectiveOut!)).toBe(15);
      expect(colMinutes(norm.effectiveOut!)).toBe(15);
      expect(cls.totalWorkedMins).toBe(435);
      expect(cls.excessHedMins).toBe(15);
    });
  });

  describe("§9.7 Zero overtime despite daily excess", () => {
    it("excess absorbed by short days — no OT paid", () => {
      const dailyRecords: DailyRecord[] = [
        // Mon: worked 540 (limit 420), excess = 120 min
        {
          workDate: new Date("2026-04-06"),
          status: "on-time",
          totalWorkedMins: 540,
          minsOrdinaryDay: 540,
          minsNocturno: 0,
          minsFestivoDay: 0,
          minsFestivoNight: 0,
          excessHedMins: 120,
          excessHenMins: 0,
          lateMinutes: 0,
          earlyLeaveMins: 0,
          dailyLimitMins: 420,
          dayType: "regular",
        },
        // Wed: normal 420
        {
          workDate: new Date("2026-04-08"),
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
        // Thu: short day 300 min (-120 from limit)
        {
          workDate: new Date("2026-04-09"),
          status: "on-time",
          totalWorkedMins: 300,
          minsOrdinaryDay: 300,
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
        // Fri: 480
        {
          workDate: new Date("2026-04-10"),
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
        // Sat: 480
        {
          workDate: new Date("2026-04-11"),
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
        // Sun: 420
        {
          workDate: new Date("2026-04-12"),
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

      const result = reconcilePeriod(
        dailyRecords,
        2_000_000,
        new Date("2026-04-06"),
        0,
      );

      // Total: 540+420+300+480+480+420 = 2640
      // Expected: 420+420+420+480+480+420 = 2640
      expect(result.totalWorkedMins).toBe(2640);
      expect(result.totalExpectedMins).toBe(2640);
      expect(result.overtimeRawMins).toBe(0);
      expect(result.overtimeOwedMins).toBe(0);

      // ZERO OT paid — Monday's excess absorbed by Thursday's shortfall
      expect(result.hedMins).toBe(0);
      expect(result.henMins).toBe(0);
      expect(result.totalExtrasCost).toBe(0);
    });
  });

  describe("§9.8 Period with no scheduled days", () => {
    it("empty period produces zero everything", () => {
      const result = reconcilePeriod(
        [],
        2_000_000,
        new Date("2026-04-06"),
        0,
      );

      expect(result.totalExpectedMins).toBe(0);
      expect(result.totalWorkedMins).toBe(0);
      expect(result.overtimeOwedMins).toBe(0);
      expect(result.daysScheduled).toBe(0);
      expect(result.daysWorked).toBe(0);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// COMP TIME FLOW — spec §7
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 6: Comp Time Flow", () => {
  it("§7.1 banking decision: bank 60 of 150 OT min", () => {
    // Carlos has 150 min OT
    const dailyRecords: DailyRecord[] = [
      {
        workDate: new Date("2026-04-06"),
        status: "on-time",
        totalWorkedMins: 540,
        minsOrdinaryDay: 540,
        minsNocturno: 0,
        minsFestivoDay: 0,
        minsFestivoNight: 0,
        excessHedMins: 120,
        excessHenMins: 0,
        lateMinutes: 0,
        earlyLeaveMins: 0,
        dailyLimitMins: 420,
        dayType: "regular",
      },
      {
        workDate: new Date("2026-04-08"),
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
        workDate: new Date("2026-04-09"),
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
        workDate: new Date("2026-04-10"),
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
        workDate: new Date("2026-04-11"),
        status: "on-time",
        totalWorkedMins: 510,
        minsOrdinaryDay: 510,
        minsNocturno: 0,
        minsFestivoDay: 0,
        minsFestivoNight: 0,
        excessHedMins: 30,
        excessHenMins: 0,
        lateMinutes: 0,
        earlyLeaveMins: 0,
        dailyLimitMins: 480,
        dayType: "regular",
      },
      {
        workDate: new Date("2026-04-12"),
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

    const recon = reconcilePeriod(
      dailyRecords,
      2_000_000,
      new Date("2026-04-06"),
      0,
    );

    expect(recon.overtimeOwedMins).toBe(150);
    expect(recon.otAvailableAfterOffset).toBe(150);

    // Manager banks 60 min
    const withDecision = applyCompDecision(recon, 60, colombiaStartOfDay("2026-04-06"));

    expect(withDecision.otBankedMins).toBe(60);
    // Paid OT = 150 - 60 = 90 min, all HED
    expect(withDecision.hedMins).toBe(90);
    expect(withDecision.henMins).toBe(0);
    // Comp balance: 0 + 60 = +60
    expect(withDecision.compBalanceEnd).toBe(60);
  });

  it("§7.3 negative balance offset: OT clears debt first", () => {
    // Employee owes 360 min (took comp day off), earned 180 min OT
    const dailyRecords: DailyRecord[] = [
      {
        workDate: new Date("2026-04-13"),
        status: "on-time",
        totalWorkedMins: 600,
        minsOrdinaryDay: 600,
        minsNocturno: 0,
        minsFestivoDay: 0,
        minsFestivoNight: 0,
        excessHedMins: 180,
        excessHenMins: 0,
        lateMinutes: 0,
        earlyLeaveMins: 0,
        dailyLimitMins: 420,
        dayType: "regular",
      },
      {
        workDate: new Date("2026-04-14"),
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
        workDate: new Date("2026-04-15"),
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
        workDate: new Date("2026-04-16"),
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
        workDate: new Date("2026-04-17"),
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
        workDate: new Date("2026-04-18"),
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
      new Date("2026-04-13"),
      -360, // owes 6h
    );

    expect(result.overtimeOwedMins).toBe(180);
    expect(result.owedOffsetMins).toBe(180); // min(180, 360)
    expect(result.otAvailableAfterOffset).toBe(0); // all goes to clearing debt

    // No OT available for banking or payment
    expect(result.hedMins).toBe(0);
    expect(result.henMins).toBe(0);
    expect(result.totalExtrasCost).toBe(0);

    // Comp balance: -360 + 180 (offset) = -180 (still owes 3h)
    expect(result.compBalanceEnd).toBe(-180);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// INVARIANT CHECKS — spec §5.4
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 6: Invariant Validation", () => {
  const testCases = [
    {
      name: "Day shift regular day",
      workDate: "2026-04-06",
      clockIn: "08:00",
      clockOut: "15:00",
      schedStart: "08:00",
      schedEnd: "15:00",
      cross: false,
      limit: 420,
    },
    {
      name: "Day shift with excess",
      workDate: "2026-04-06",
      clockIn: "08:00",
      clockOut: "17:30",
      schedStart: "08:00",
      schedEnd: "15:00",
      cross: false,
      limit: 420,
    },
    {
      name: "Night shift no excess",
      workDate: "2026-04-06",
      clockIn: "17:00",
      clockOut: "00:00",
      clockOutDate: "2026-04-07",
      schedStart: "17:00",
      schedEnd: "00:00",
      cross: true,
      limit: 420,
    },
    {
      name: "Night shift with excess",
      workDate: "2026-04-10",
      clockIn: "17:00",
      clockOut: "01:45",
      clockOutDate: "2026-04-11",
      schedStart: "17:00",
      schedEnd: "01:00",
      cross: true,
      limit: 480,
    },
    {
      name: "Late arrival day shift",
      workDate: "2026-04-06",
      clockIn: "08:15",
      clockOut: "15:00",
      schedStart: "08:00",
      schedEnd: "15:00",
      cross: false,
      limit: 420,
    },
  ];

  for (const tc of testCases) {
    describe(tc.name, () => {
      const result = processDay({
        workDate: tc.workDate,
        clockIn: tc.clockIn,
        clockOut: tc.clockOut,
        clockOutDate: (tc as { clockOutDate?: string }).clockOutDate,
        scheduledStart: tc.schedStart,
        scheduledEnd: tc.schedEnd,
        crossesMidnight: tc.cross,
        dailyLimitMins: tc.limit,
      });

      it("invariant 1: bucket sum = totalWorkedMins", () => {
        assertBucketSum(result.cls);
      });

      it("invariant 2: excess pool = max(0, worked - limit)", () => {
        assertExcessPool(result.cls);
      });

      it("invariant 5: no negative values", () => {
        expect(result.cls.totalWorkedMins).toBeGreaterThanOrEqual(0);
        expect(result.cls.minsOrdinaryDay).toBeGreaterThanOrEqual(0);
        expect(result.cls.minsNocturno).toBeGreaterThanOrEqual(0);
        expect(result.cls.minsFestivoDay).toBeGreaterThanOrEqual(0);
        expect(result.cls.minsFestivoNight).toBeGreaterThanOrEqual(0);
        expect(result.cls.excessHedMins).toBeGreaterThanOrEqual(0);
        expect(result.cls.excessHenMins).toBeGreaterThanOrEqual(0);
        expect(result.norm.lateMinutes).toBeGreaterThanOrEqual(0);
        expect(result.norm.earlyLeaveMinutes).toBeGreaterThanOrEqual(0);
      });
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// FESTIVO VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 6: Holiday (Festivo) Classification", () => {
  it("night shift crossing into holiday: pre-midnight regular, post-midnight festivo", () => {
    // Dec 24 (Thu) → Dec 25 (Navidad = festivo)
    // Schedule: 17:00-00:00, crosses midnight
    // Punch: 17:00-01:15 (excess = 75 min, floor=75)
    const workDate = colombiaStartOfDay("2026-12-24");
    const norm = normalizePunches(
      d("2026-12-24", "17:00"),
      d("2026-12-25", "01:15"),
      "17:00",
      "00:00",
      workDate,
      true,
    );

    expect(colHours(norm.effectiveOut!)).toBe(1);
    expect(colMinutes(norm.effectiveOut!)).toBe(15);

    const totalMins = minutesBetween(norm.effectiveIn, norm.effectiveOut!);
    expect(totalMins).toBe(495); // 8h 15m

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

    assertBucketSum(cls);

    // Excess = 495 - 420 = 75 min from tail (nocturno)
    expect(cls.excessHenMins).toBe(75);
    expect(cls.excessHedMins).toBe(0);
    assertExcessPool(cls);
  });

  it("full-day holiday: all minutes classified as festivo", () => {
    // Jun 29 2026 = Sagrado Corazón (holiday)
    const { cls } = processDay({
      workDate: "2026-06-29",
      clockIn: "08:00",
      clockOut: "15:00",
      scheduledStart: "08:00",
      scheduledEnd: "15:00",
      crossesMidnight: false,
      dailyLimitMins: 420,
    });

    expect(cls.totalWorkedMins).toBe(420);
    expect(cls.minsFestivoDay).toBe(420);
    expect(cls.minsOrdinaryDay).toBe(0);
    expect(cls.minsNocturno).toBe(0);
    expect(cls.minsFestivoNight).toBe(0);
    expect(cls.dayType).toBe("holiday");
    assertBucketSum(cls);
  });
});
