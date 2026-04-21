"use server";

import { updateTag } from "next/cache";
import { auth } from "@/auth";
import { calculateAttendance } from "@/lib/engine/attendance-calculator";
import { ATTENDANCE_TAG } from "@/lib/attendance/invalidate";

export async function recalcAttendanceAction(
  startDate: string,
  endDate: string,
): Promise<{ processed: number } | { error: string }> {
  const session = await auth();
  if (!session?.user) return { error: "Unauthorized" };

  if (!startDate || !endDate) {
    return { error: "startDate and endDate are required" };
  }

  const results = await calculateAttendance({ startDate, endDate });
  updateTag(ATTENDANCE_TAG);
  return { processed: results.length };
}
