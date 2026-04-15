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

/** DELETE /api/settings/holidays/[date]?year=2026 — remove a holiday */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ date: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { date } = await params;
  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get("year") ?? "2026", 10);

  const key = `holidays_${year}`;
  const [row] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, key))
    .limit(1);

  let holidays: Holiday[];
  if (row?.value) {
    holidays = JSON.parse(row.value);
  } else if (year === 2026) {
    holidays = COLOMBIAN_HOLIDAYS_2026.map((d) => ({
      date: d,
      name: DEFAULT_HOLIDAY_NAMES[d] ?? "",
    }));
  } else {
    holidays = [];
  }

  holidays = holidays.filter((h) => h.date !== date);

  await db
    .insert(settings)
    .values({ key, value: JSON.stringify(holidays) })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: JSON.stringify(holidays) },
    });

  return NextResponse.json(holidays);
}
