export const COLOMBIAN_HOLIDAYS_2026 = [
  "2026-01-01", // Año Nuevo
  "2026-01-12", // Reyes Magos (Emiliani)
  "2026-03-23", // San José (Emiliani)
  "2026-04-02", // Jueves Santo
  "2026-04-03", // Viernes Santo
  "2026-05-01", // Día del Trabajo
  "2026-05-18", // Ascensión del Señor (Emiliani)
  "2026-06-08", // Corpus Christi (Emiliani)
  "2026-06-15", // Sagrado Corazón (Emiliani)
  "2026-06-29", // San Pedro y San Pablo (Emiliani)
  "2026-07-20", // Independencia
  "2026-08-07", // Batalla de Boyacá
  "2026-08-17", // Asunción de la Virgen (Emiliani)
  "2026-10-12", // Día de la Raza (Emiliani)
  "2026-11-02", // Todos los Santos (Emiliani)
  "2026-11-16", // Independencia de Cartagena (Emiliani)
  "2026-12-08", // Inmaculada Concepción
  "2026-12-25", // Navidad
];

const holidaySet = new Set(COLOMBIAN_HOLIDAYS_2026);

/** Check if a date string (YYYY-MM-DD) is a Colombian holiday */
export function isHoliday(dateStr: string): boolean {
  return holidaySet.has(dateStr);
}

/** Get all holidays within a date range (inclusive) as YYYY-MM-DD strings */
export function getHolidaysInRange(start: Date, end: Date): string[] {
  return COLOMBIAN_HOLIDAYS_2026.filter((h) => {
    const d = new Date(h + "T12:00:00");
    return d >= start && d <= end;
  });
}
