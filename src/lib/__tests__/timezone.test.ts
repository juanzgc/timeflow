import { describe, it, expect } from "vitest";
import {
  colHours,
  colMinutes,
  colDate,
  colMonth,
  colFullYear,
  colDay,
  colombiaDate,
  todayColombiaISO,
  formatColombiaDateISO,
  colombiaStartOfDay,
  colSetHours,
  colAddDays,
  COL_TZ,
} from "../timezone";

describe("timezone module", () => {
  describe("colombiaDate", () => {
    it("creates a Date representing Colombia midnight", () => {
      // 2026-04-14 00:00 COT = 2026-04-14 05:00 UTC
      const d = colombiaDate(2026, 3, 14);
      expect(d.getUTCHours()).toBe(5);
      expect(d.getUTCDate()).toBe(14);
      expect(d.getUTCMonth()).toBe(3);
      expect(d.getUTCFullYear()).toBe(2026);
    });

    it("creates a Date with specific Colombia-local time", () => {
      // 2026-04-14 08:30 COT = 2026-04-14 13:30 UTC
      const d = colombiaDate(2026, 3, 14, 8, 30);
      expect(d.getUTCHours()).toBe(13);
      expect(d.getUTCMinutes()).toBe(30);
    });

    it("handles Colombia 23:00 correctly (next UTC day)", () => {
      // 2026-04-14 23:00 COT = 2026-04-15 04:00 UTC
      const d = colombiaDate(2026, 3, 14, 23, 0);
      expect(d.getUTCDate()).toBe(15);
      expect(d.getUTCHours()).toBe(4);
    });
  });

  describe("getters", () => {
    it("extracts Colombia-local components regardless of server timezone", () => {
      // 2026-04-15 03:00 UTC = 2026-04-14 22:00 COT
      const d = new Date(Date.UTC(2026, 3, 15, 3, 0, 0));
      expect(colFullYear(d)).toBe(2026);
      expect(colMonth(d)).toBe(3);
      expect(colDate(d)).toBe(14); // Still April 14 in Colombia
      expect(colHours(d)).toBe(22);
      expect(colMinutes(d)).toBe(0);
      expect(colDay(d)).toBe(2); // Tuesday
    });
  });

  describe("colombiaStartOfDay", () => {
    it("parses YYYY-MM-DD as Colombia midnight", () => {
      const d = colombiaStartOfDay("2026-04-14");
      expect(colHours(d)).toBe(0);
      expect(colMinutes(d)).toBe(0);
      expect(colDate(d)).toBe(14);
      expect(colMonth(d)).toBe(3);
      expect(colFullYear(d)).toBe(2026);
    });
  });

  describe("formatColombiaDateISO", () => {
    it("formats a Date as YYYY-MM-DD using Colombia local date", () => {
      // 2026-04-15 03:00 UTC = 2026-04-14 22:00 COT → should format as 2026-04-14
      const d = new Date(Date.UTC(2026, 3, 15, 3, 0, 0));
      expect(formatColombiaDateISO(d)).toBe("2026-04-14");
    });

    it("roundtrips with colombiaStartOfDay", () => {
      const d = colombiaStartOfDay("2026-12-31");
      expect(formatColombiaDateISO(d)).toBe("2026-12-31");
    });
  });

  describe("colSetHours", () => {
    it("sets Colombia-local hours on a date", () => {
      const midnight = colombiaStartOfDay("2026-04-14");
      const d = colSetHours(midnight, 17, 30);
      expect(colHours(d)).toBe(17);
      expect(colMinutes(d)).toBe(30);
      expect(colDate(d)).toBe(14);
    });
  });

  describe("colAddDays", () => {
    it("adds days preserving time", () => {
      const d = colombiaDate(2026, 3, 14, 22, 0);
      const next = colAddDays(d, 1);
      expect(colDate(next)).toBe(15);
      expect(colHours(next)).toBe(22);
    });

    it("subtracts days", () => {
      const d = colombiaDate(2026, 3, 14, 8, 0);
      const prev = colAddDays(d, -1);
      expect(colDate(prev)).toBe(13);
      expect(colHours(prev)).toBe(8);
    });

    it("crosses month boundary", () => {
      const d = colombiaDate(2026, 3, 30, 12, 0); // Apr 30
      const next = colAddDays(d, 1);
      expect(colMonth(next)).toBe(4); // May
      expect(colDate(next)).toBe(1);
    });
  });

  describe("COL_TZ constant", () => {
    it("is the correct IANA timezone", () => {
      expect(COL_TZ).toBe("America/Bogota");
    });
  });

  describe("todayColombiaISO", () => {
    it("returns a string in YYYY-MM-DD format", () => {
      const result = todayColombiaISO();
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
});
