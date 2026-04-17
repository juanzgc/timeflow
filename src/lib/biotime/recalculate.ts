import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { employees } from "@/drizzle/schema";
import { calculateAttendance } from "@/lib/engine/attendance-calculator";

/**
 * Recalculate attendance for a list of "empCode:date" entries produced by a
 * BioTime transaction sync. Best-effort — errors per employee are swallowed
 * so a single bad row doesn't fail the whole sync.
 */
export async function recalculateAffectedDays(
  affectedDays: string[],
): Promise<void> {
  const byEmployee = new Map<string, Set<string>>();
  for (const entry of affectedDays) {
    const [empCode, date] = entry.split(":");
    if (!byEmployee.has(empCode)) byEmployee.set(empCode, new Set());
    byEmployee.get(empCode)!.add(date);
  }

  for (const [empCode, dates] of byEmployee) {
    const [emp] = await db
      .select({ id: employees.id })
      .from(employees)
      .where(eq(employees.empCode, empCode))
      .limit(1);

    if (!emp) continue;

    const sortedDates = Array.from(dates).sort();
    try {
      await calculateAttendance({
        employeeId: emp.id,
        startDate: sortedDates[0],
        endDate: sortedDates[sortedDates.length - 1],
      });
    } catch {
      // Best-effort — don't fail the sync
    }
  }
}
