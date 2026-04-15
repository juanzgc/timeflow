import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { settings } from "@/drizzle/schema";
import { auth } from "@/auth";
import { COLOMBIAN_HOLIDAYS_2026 } from "@/lib/holidays";

type Holiday = { date: string; name: string };

const DEFAULT_HOLIDAY_NAMES: Record<string, string> = {
  "2026-01-01": "Año Nuevo",
  "2026-01-12": "Reyes Magos",
  "2026-03-23": "San José",
  "2026-04-02": "Jueves Santo",
  "2026-04-03": "Viernes Santo",
  "2026-05-01": "Día del Trabajo",
  "2026-05-18": "Ascensión del Señor",
  "2026-06-08": "Corpus Christi",
  "2026-06-15": "Sagrado Corazón",
  "2026-06-29": "San Pedro y San Pablo",
  "2026-07-20": "Independencia",
  "2026-08-07": "Batalla de Boyacá",
  "2026-08-17": "Asunción de la Virgen",
  "2026-10-12": "Día de la Raza",
  "2026-11-02": "Todos los Santos",
  "2026-11-16": "Independencia de Cartagena",
  "2026-12-08": "Inmaculada Concepción",
  "2026-12-25": "Navidad",
};

/** POST /api/settings/holidays/reset?year=2026 — reset to Colombian defaults */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get("year") ?? "2026", 10);

  let holidays: Holiday[] = [];
  if (year === 2026) {
    holidays = COLOMBIAN_HOLIDAYS_2026.map((d) => ({
      date: d,
      name: DEFAULT_HOLIDAY_NAMES[d] ?? "",
    }));
  }

  const key = `holidays_${year}`;
  await db
    .insert(settings)
    .values({ key, value: JSON.stringify(holidays) })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: JSON.stringify(holidays) },
    });

  return NextResponse.json(holidays);
}
