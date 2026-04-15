import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { settings } from "@/drizzle/schema";
import { auth } from "@/auth";

/** GET /api/settings — return all settings as key-value object */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db.select().from(settings);
  const result: Record<string, string> = {};
  for (const r of rows) {
    result[r.key] = r.value ?? "";
  }

  return NextResponse.json(result);
}

/** PUT /api/settings — bulk update settings */
export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body: Record<string, string> = await request.json();

  for (const [key, value] of Object.entries(body)) {
    await db
      .insert(settings)
      .values({ key, value })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value },
      });
  }

  return NextResponse.json({ updated: true });
}
