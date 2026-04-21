import { NextResponse } from "next/server";
import { and, eq, gte, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { employees, punchLogs } from "@/drizzle/schema";
import { requireSuperadmin } from "@/lib/auth-helpers";
import { getBioTimeClient } from "@/lib/biotime/client";
import { parseColombia, formatForBioTime } from "@/lib/biotime/transactions";
import type { BioTimeTransaction } from "@/lib/biotime/types";
import { recalcAndInvalidate } from "@/lib/attendance/invalidate";
import { colombiaStartOfDay, colAddDays, colSetHours } from "@/lib/timezone";
import { BUSINESS_DAY_START_HOUR } from "@/lib/engine/time-utils";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, response } = await requireSuperadmin();
  if (response) return response;
  void session;

  const { id: idStr } = await params;
  const employeeId = parseInt(idStr, 10);
  if (isNaN(employeeId)) {
    return NextResponse.json({ error: "Invalid employee id" }, { status: 400 });
  }

  let body: { startDate?: string; endDate?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { startDate, endDate } = body;

  if (!startDate || !endDate) {
    return NextResponse.json(
      { error: "startDate and endDate are required (YYYY-MM-DD)" },
      { status: 400 },
    );
  }

  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
    return NextResponse.json(
      { error: "Dates must be in YYYY-MM-DD format" },
      { status: 400 },
    );
  }

  if (startDate > endDate) {
    return NextResponse.json(
      { error: "startDate must be <= endDate" },
      { status: 400 },
    );
  }

  const [emp] = await db
    .select()
    .from(employees)
    .where(eq(employees.id, employeeId))
    .limit(1);

  if (!emp) {
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  }

  // Business-day window: BD[startDate] through BD[endDate], inclusive.
  // Each business day runs 06:00 COT to 06:00 COT next calendar day, so the
  // half-open window is [startDate 06:00 COT, endDate+1 06:00 COT). This is
  // what captures "clock-out next day" tails (e.g. a 03:43 Apr 13 punch that
  // belongs to BD Apr 12) without leaking the 00:00–06:00 head of the
  // pre-range business day (BD[startDate-1]).
  const rangeStart = colSetHours(
    colombiaStartOfDay(startDate),
    BUSINESS_DAY_START_HOUR,
  );
  const rangeEndExclusive = colSetHours(
    colAddDays(colombiaStartOfDay(endDate), 1),
    BUSINESS_DAY_START_HOUR,
  );
  const fromTs = formatForBioTime(rangeStart);
  const toTs = formatForBioTime(rangeEndExclusive);

  let remote: BioTimeTransaction[];
  try {
    const client = await getBioTimeClient();
    remote = await client.fetchAllPages<BioTimeTransaction>(
      "/iclock/api/transactions/",
      {
        page_size: "5000",
        start_time: fromTs,
        end_time: toTs,
        emp_code: emp.empCode,
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "BioTime fetch failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // Defensive filter — don't trust the API to honor emp_code
  const forEmployee = remote.filter((tx) => tx.emp_code === emp.empCode);

  // Destructive re-sync: wipe all existing punch_logs for this employee in the
  // range (both biotime-sourced and manual), then re-insert BioTime's
  // source-of-truth. This is what lets the tool "fix errors" — any stray
  // manual edits or stale rows are erased so the recalc reflects BioTime
  // exactly.
  const deleted = await db
    .delete(punchLogs)
    .where(
      and(
        eq(punchLogs.empCode, emp.empCode),
        gte(punchLogs.punchTime, rangeStart),
        lt(punchLogs.punchTime, rangeEndExclusive),
      ),
    )
    .returning({ id: punchLogs.id });

  let inserted = 0;

  for (const tx of forEmployee) {
    // onConflictDoUpdate as a safety net: if a concurrent process re-inserted
    // a row with the same biotime_id between our delete and insert, overwrite
    // it with the freshly-fetched values rather than silently skipping.
    await db
      .insert(punchLogs)
      .values({
        empCode: tx.emp_code,
        punchTime: parseColombia(tx.punch_time),
        punchState: tx.punch_state,
        verifyType: tx.verify_type,
        terminalSn: tx.terminal_sn,
        biotimeId: tx.id,
        source: "biotime",
      })
      .onConflictDoUpdate({
        target: punchLogs.biotimeId,
        set: {
          empCode: tx.emp_code,
          punchTime: parseColombia(tx.punch_time),
          punchState: tx.punch_state,
          verifyType: tx.verify_type,
          terminalSn: tx.terminal_sn,
          source: "biotime",
        },
      });

    inserted++;
  }

  const attendanceResults = await recalcAndInvalidate({
    employeeId,
    startDate,
    endDate,
  });

  return NextResponse.json({
    success: true,
    employee: {
      id: emp.id,
      empCode: emp.empCode,
      name: `${emp.firstName} ${emp.lastName}`,
    },
    dateRange: { startDate, endDate },
    biotime: {
      fetched: forEmployee.length,
      deleted: deleted.length,
      inserted,
    },
    attendance: {
      daysCalculated: attendanceResults.length,
    },
  });
}
