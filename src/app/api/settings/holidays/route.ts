import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
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

async function getHolidaysForYear(year: number): Promise<Holiday[]> {
  const key = `holidays_${year}`;
  const [row] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, key))
    .limit(1);

  if (row?.value) {
    return JSON.parse(row.value);
  }

  // Return defaults for 2026
  if (year === 2026) {
    return COLOMBIAN_HOLIDAYS_2026.map((d) => ({
      date: d,
      name: DEFAULT_HOLIDAY_NAMES[d] ?? "",
    }));
  }

  return [];
}

/** GET /api/settings/holidays?year=2026 */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get("year") ?? "2026", 10);

  const holidays = await getHolidaysForYear(year);
  return NextResponse.json(holidays);
}

/** POST /api/settings/holidays — add a holiday */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { date, name, year = 2026 } = body;

  if (!date || !name) {
    return NextResponse.json(
      { error: "date and name are required" },
      { status: 400 },
    );
  }

  const holidays = await getHolidaysForYear(year);

  // Check if already exists
  if (holidays.some((h) => h.date === date)) {
    return NextResponse.json(
      { error: "Holiday already exists for this date" },
      { status: 409 },
    );
  }

  holidays.push({ date, name });
  holidays.sort((a, b) => a.date.localeCompare(b.date));

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
