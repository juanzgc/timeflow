import { describe, it, expect } from "vitest";
import { extractBusinessDay } from "../transactions";

describe("extractBusinessDay", () => {
  // extractBusinessDay expects BioTime format: "YYYY-MM-DD HH:mm:ss" (space separator)
  it("returns same date for daytime punch", () => {
    expect(extractBusinessDay("2026-04-14 08:30:00")).toBe("2026-04-14");
  });

  it("returns same date for punch at exactly 06:00", () => {
    expect(extractBusinessDay("2026-04-14 06:00:00")).toBe("2026-04-14");
  });

  it("returns previous date for punch at 05:59 (before 6 AM)", () => {
    expect(extractBusinessDay("2026-04-14 05:59:00")).toBe("2026-04-13");
  });

  it("returns previous date for punch at midnight", () => {
    expect(extractBusinessDay("2026-04-14 00:00:00")).toBe("2026-04-13");
  });

  it("returns previous date for punch at 3 AM", () => {
    expect(extractBusinessDay("2026-04-14 03:00:00")).toBe("2026-04-13");
  });

  it("handles month boundary (early AM on the 1st)", () => {
    expect(extractBusinessDay("2026-05-01 02:00:00")).toBe("2026-04-30");
  });

  it("handles year boundary", () => {
    expect(extractBusinessDay("2027-01-01 01:30:00")).toBe("2026-12-31");
  });

  it("returns same date for evening punch", () => {
    expect(extractBusinessDay("2026-04-14 22:45:00")).toBe("2026-04-14");
  });

  it("returns same date for afternoon punch", () => {
    expect(extractBusinessDay("2026-04-14 14:00:00")).toBe("2026-04-14");
  });
});
