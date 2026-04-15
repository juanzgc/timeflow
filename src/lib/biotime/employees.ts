import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { employees } from "@/drizzle/schema";
import type { BioTimeClient } from "./client";
import type { BioTimeEmployee, EmployeeSyncResult } from "./types";

/**
 * Sync employees from BioTime.
 * - Creates new employees found in BioTime
 * - Updates firstName, lastName, biotimeId, syncedAt for existing ones
 * - Never touches: groupId, monthlySalary, cedula, restDay, isActive
 */
export async function syncEmployees(
  client: BioTimeClient,
): Promise<EmployeeSyncResult> {
  const remote = await client.fetchAllPages<BioTimeEmployee>(
    "/personnel/api/employees/",
  );

  let created = 0;
  let updated = 0;

  for (const emp of remote) {
    const existing = await db
      .select()
      .from(employees)
      .where(eq(employees.empCode, emp.emp_code))
      .limit(1);

    if (existing.length) {
      await db
        .update(employees)
        .set({
          firstName: emp.first_name,
          lastName: emp.last_name,
          biotimeId: emp.id,
          syncedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(employees.empCode, emp.emp_code));
      updated++;
    } else {
      await db.insert(employees).values({
        empCode: emp.emp_code,
        firstName: emp.first_name,
        lastName: emp.last_name,
        biotimeId: emp.id,
        syncedAt: new Date(),
      });
      created++;
    }
  }

  return { total: remote.length, created, updated };
}
