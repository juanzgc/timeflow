import { describe, it, expect } from "vitest";
import { classifyDay } from "../daily-classifier";

function d(dateStr: string, time: string): Date {
  const [h, m] = time.split(":").map(Number);
  const date = new Date(dateStr + "T00:00:00");
  date.setHours(h, m, 0, 0);
  return date;
}

describe("classifyDay", () => {
  it("classifies a regular daytime shift correctly", () => {
    // Schedule: 8:00-15:00 (7h), all diurno, regular day
    const result = classifyDay(
      d("2026-04-13", "08:00"), // Mon
      d("2026-04-13", "15:00"),
      new Date("2026-04-13T00:00:00"),
      [{ start: "08:00", end: "15:00", crossesMidnight: false }],
      0,
      420,
    );
    expect(result.totalWorkedMins).toBe(420);
    expect(result.minsOrdinaryDay).toBe(420);
    expect(result.minsNocturno).toBe(0);
    expect(result.minsFestivoDay).toBe(0);
    expect(result.minsFestivoNight).toBe(0);
    expect(result.excessHedMins).toBe(0);
    expect(result.excessHenMins).toBe(0);
    expect(result.dayType).toBe("regular");
  });

  it("classifies nocturno hours for evening shift", () => {
    // Schedule: 17:00-01:00 (8h), crosses midnight, regular Sat
    const result = classifyDay(
      d("2026-04-18", "17:00"), // Sat
      d("2026-04-19", "01:00"),
      new Date("2026-04-18T00:00:00"),
      [{ start: "17:00", end: "01:00", crossesMidnight: true }],
      0,
      480,
    );
    expect(result.totalWorkedMins).toBe(480);
    // 17:00-19:00 = 120 min diurno
    expect(result.minsOrdinaryDay).toBe(120);
    // 19:00-01:00 = 360 min nocturno (Sun is regular, not holiday)
    expect(result.minsNocturno).toBe(360);
    expect(result.excessHedMins).toBe(0);
    expect(result.excessHenMins).toBe(0);
  });

  it("tags excess from the tail end of the shift", () => {
    // Schedule: 10:00-17:00 (7h limit), effective 10:00-18:00 (8h)
    const result = classifyDay(
      d("2026-04-13", "10:00"),
      d("2026-04-13", "18:00"),
      new Date("2026-04-13T00:00:00"),
      [{ start: "10:00", end: "17:00", crossesMidnight: false }],
      0,
      420,
    );
    expect(result.totalWorkedMins).toBe(480);
    // Excess = 60 min from 17:00-18:00 (diurno, before 19:00)
    expect(result.excessHedMins).toBe(60);
    expect(result.excessHenMins).toBe(0);
  });

  it("tags nocturno excess when tail crosses 19:00", () => {
    // Schedule: 12:00-19:00 (7h limit), effective 12:00-20:00 (8h)
    const result = classifyDay(
      d("2026-04-13", "12:00"),
      d("2026-04-13", "20:00"),
      new Date("2026-04-13T00:00:00"),
      [{ start: "12:00", end: "19:00", crossesMidnight: false }],
      0,
      420,
    );
    expect(result.totalWorkedMins).toBe(480);
    // Excess = 60 min from 19:00-20:00 (nocturno)
    expect(result.excessHedMins).toBe(0);
    expect(result.excessHenMins).toBe(60);
  });

  it("classifies holiday hours as festivo", () => {
    // May 1, 2026 is Día del Trabajo
    const result = classifyDay(
      d("2026-05-01", "08:00"),
      d("2026-05-01", "15:00"),
      new Date("2026-05-01T00:00:00"),
      [{ start: "08:00", end: "15:00", crossesMidnight: false }],
      0,
      420,
    );
    expect(result.dayType).toBe("holiday");
    expect(result.minsFestivoDay).toBe(420);
    expect(result.minsOrdinaryDay).toBe(0);
  });
});
