import { revalidateTag } from "next/cache";
import {
  calculateAttendance,
  type AttendanceOptions,
  type AttendanceResult,
} from "@/lib/engine/attendance-calculator";

export const ATTENDANCE_TAG = "attendance";
export const EMPLOYEES_TAG = "employees";
export const COMP_BALANCES_TAG = "comp-balances";

export async function recalcAndInvalidate(
  options: AttendanceOptions,
): Promise<AttendanceResult[]> {
  const results = await calculateAttendance(options);
  revalidateTag(ATTENDANCE_TAG);
  return results;
}

export function invalidateAttendance(): void {
  revalidateTag(ATTENDANCE_TAG);
}

export function invalidateEmployees(): void {
  revalidateTag(EMPLOYEES_TAG);
}

export function invalidateCompBalances(): void {
  revalidateTag(COMP_BALANCES_TAG);
}
