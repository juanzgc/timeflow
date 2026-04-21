"use server";

import { updateTag } from "next/cache";
import { auth } from "@/auth";
import {
  ATTENDANCE_TAG,
  EMPLOYEES_TAG,
  COMP_BALANCES_TAG,
} from "@/lib/attendance/invalidate";

export type CacheTag = "attendance" | "employees" | "comp-balances";

const TAG_MAP: Record<CacheTag, string> = {
  attendance: ATTENDANCE_TAG,
  employees: EMPLOYEES_TAG,
  "comp-balances": COMP_BALANCES_TAG,
};

/**
 * Read-your-own-writes cache flush. Call from the client after a successful
 * mutation fetch() so the next render serves fresh data immediately instead
 * of the stale-while-revalidate copy that revalidateTag would leave behind.
 */
export async function flushCacheAction(tags: CacheTag[]): Promise<void> {
  const session = await auth();
  if (!session?.user) return;
  for (const tag of tags) {
    updateTag(TAG_MAP[tag]);
  }
}
