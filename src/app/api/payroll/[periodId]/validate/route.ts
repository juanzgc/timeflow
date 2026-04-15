import { NextResponse } from "next/server";
import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { payrollPeriods, dailyAttendance, employees } from "@/drizzle/schema";
import { auth } from "@/auth";

interface InvariantResult {
  employeeId: number;
  employeeName: string;
  workDate: string;
  checks: {
    bucketSum: "PASS" | "FAIL";
    excessPool: "PASS" | "FAIL" | "N/A";
    effectiveInNonLate: "PASS" | "FAIL" | "N/A";
    effectiveInLate: "PASS" | "FAIL" | "N/A";
    noNegatives: "PASS" | "FAIL";
  };
  details?: string[];
}

interface PeriodValidationResult {
  employeeId: number;
  employeeName: string;
  checks: {
    expectedHours: "PASS" | "FAIL";
    overtimeFloor: "PASS" | "FAIL";
    cheapestFirst: "PASS" | "FAIL";
    recargoCosts: "PASS" | "FAIL";
  };
  details?: string[];
}

/**
 * GET /api/payroll/[periodId]/validate
 * Runs the 5 daily invariant checks and period reconciliation checks
 * from the Phase 6 spec against actual data.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ periodId: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { periodId: periodIdStr } = await params;
  const periodId = parseInt(periodIdStr, 10);
  if (isNaN(periodId)) {
    return NextResponse.json({ error: "Invalid periodId" }, { status: 400 });
  }

  // Get the period date range
  const [refPeriod] = await db
    .select()
    .from(payrollPeriods)
    .where(eq(payrollPeriods.id, periodId))
    .limit(1);

  if (!refPeriod) {
    return NextResponse.json({ error: "Period not found" }, { status: 404 });
  }

  // Get all daily attendance records in the period
  const records = await db
    .select({
      da: dailyAttendance,
      firstName: employees.firstName,
      lastName: employees.lastName,
    })
    .from(dailyAttendance)
    .innerJoin(employees, eq(dailyAttendance.employeeId, employees.id))
    .where(
      and(
        gte(dailyAttendance.workDate, refPeriod.periodStart),
        lte(dailyAttendance.workDate, refPeriod.periodEnd),
        eq(dailyAttendance.isMissingPunch, false),
        eq(dailyAttendance.isProcessed, true),
      ),
    );

  // Run daily invariant checks
  const dailyResults: InvariantResult[] = [];
  let dailyPassCount = 0;
  let dailyFailCount = 0;

  for (const row of records) {
    const da = row.da;
    const details: string[] = [];
    const checks = {
      bucketSum: "PASS" as "PASS" | "FAIL",
      excessPool: "N/A" as "PASS" | "FAIL" | "N/A",
      effectiveInNonLate: "N/A" as "PASS" | "FAIL" | "N/A",
      effectiveInLate: "N/A" as "PASS" | "FAIL" | "N/A",
      noNegatives: "PASS" as "PASS" | "FAIL",
    };

    // Invariant 1: Minute bucket sum equals total worked
    const bucketSum =
      da.minsOrdinaryDay + da.minsNocturno + da.minsFestivoDay + da.minsFestivoNight;
    if (bucketSum !== da.totalWorkedMins) {
      checks.bucketSum = "FAIL";
      details.push(
        `Bucket sum ${bucketSum} != totalWorkedMins ${da.totalWorkedMins}`,
      );
    }

    // Invariant 2: Excess pool equals overage
    const expectedExcess = Math.max(0, da.totalWorkedMins - da.dailyLimitMins);
    const actualExcess = da.excessHedMins + da.excessHenMins;
    if (expectedExcess > 0 || actualExcess > 0) {
      checks.excessPool = actualExcess === expectedExcess ? "PASS" : "FAIL";
      if (checks.excessPool === "FAIL") {
        details.push(
          `Excess pool ${actualExcess} != expected ${expectedExcess} (worked=${da.totalWorkedMins}, limit=${da.dailyLimitMins})`,
        );
      }
    }

    // Invariant 3: effective_in >= scheduled_start for non-late
    if (da.lateMinutes === 0 && da.effectiveIn && da.scheduledStart) {
      const effInTime = `${String(da.effectiveIn.getHours()).padStart(2, "0")}:${String(da.effectiveIn.getMinutes()).padStart(2, "0")}`;
      checks.effectiveInNonLate =
        effInTime === da.scheduledStart ? "PASS" : "FAIL";
      if (checks.effectiveInNonLate === "FAIL") {
        details.push(
          `Non-late effectiveIn ${effInTime} != scheduledStart ${da.scheduledStart}`,
        );
      }
    }

    // Invariant 4: effective_in == clockIn for late arrivals
    if (da.lateMinutes > 0 && da.effectiveIn && da.clockIn) {
      checks.effectiveInLate =
        da.effectiveIn.getTime() === da.clockIn.getTime() ? "PASS" : "FAIL";
      if (checks.effectiveInLate === "FAIL") {
        details.push(
          `Late effectiveIn ${da.effectiveIn.toISOString()} != clockIn ${da.clockIn.toISOString()}`,
        );
      }
    }

    // Invariant 5: No negative values
    const negFields = [
      { name: "totalWorkedMins", val: da.totalWorkedMins },
      { name: "lateMinutes", val: da.lateMinutes },
      { name: "earlyLeaveMins", val: da.earlyLeaveMins },
      { name: "minsOrdinaryDay", val: da.minsOrdinaryDay },
      { name: "minsNocturno", val: da.minsNocturno },
      { name: "minsFestivoDay", val: da.minsFestivoDay },
      { name: "minsFestivoNight", val: da.minsFestivoNight },
      { name: "excessHedMins", val: da.excessHedMins },
      { name: "excessHenMins", val: da.excessHenMins },
      { name: "dailyLimitMins", val: da.dailyLimitMins },
    ];
    for (const f of negFields) {
      if (f.val < 0) {
        checks.noNegatives = "FAIL";
        details.push(`Negative value: ${f.name} = ${f.val}`);
      }
    }

    const allPass = Object.values(checks).every(
      (v) => v === "PASS" || v === "N/A",
    );
    if (allPass) dailyPassCount++;
    else dailyFailCount++;

    // Only include failures in detailed output (to keep response manageable)
    if (!allPass) {
      dailyResults.push({
        employeeId: da.employeeId,
        employeeName: `${row.firstName} ${row.lastName}`,
        workDate: da.workDate,
        checks,
        details,
      });
    }
  }

  // Get all payroll period records
  const periodRecords = await db
    .select({
      pp: payrollPeriods,
      firstName: employees.firstName,
      lastName: employees.lastName,
    })
    .from(payrollPeriods)
    .innerJoin(employees, eq(payrollPeriods.employeeId, employees.id))
    .where(
      and(
        eq(payrollPeriods.periodStart, refPeriod.periodStart),
        eq(payrollPeriods.periodEnd, refPeriod.periodEnd),
      ),
    );

  // Run period-level checks
  const periodResults: PeriodValidationResult[] = [];
  let periodPassCount = 0;
  let periodFailCount = 0;

  for (const row of periodRecords) {
    const pp = row.pp;
    const details: string[] = [];
    const checks = {
      expectedHours: "PASS" as "PASS" | "FAIL",
      overtimeFloor: "PASS" as "PASS" | "FAIL",
      cheapestFirst: "PASS" as "PASS" | "FAIL",
      recargoCosts: "PASS" as "PASS" | "FAIL",
    };

    // Check overtime floor (15-min increment)
    if (pp.overtimeOwedMins > 0 && pp.overtimeOwedMins % 15 !== 0) {
      checks.overtimeFloor = "FAIL";
      details.push(
        `overtimeOwedMins ${pp.overtimeOwedMins} is not a 15-min multiple`,
      );
    }

    // Check cheapest-first: HED consumed before HEN
    if (pp.overtimeOwedMins > 0) {
      // If there's HED available in pool, it should be fully consumed before HEN
      const hedConsumed = pp.otEarnedHedMins;
      const henConsumed = pp.otEarnedHenMins;
      if (hedConsumed < pp.poolHedMins && henConsumed > 0) {
        checks.cheapestFirst = "FAIL";
        details.push(
          `HED not fully consumed (${hedConsumed}/${pp.poolHedMins}) but HEN consumed ${henConsumed}`,
        );
      }
      // Total consumed should equal overtime owed
      if (hedConsumed + henConsumed !== pp.overtimeOwedMins) {
        // This can happen if pool < owed — that's OK if pool is exhausted
        if (hedConsumed + henConsumed < pp.overtimeOwedMins) {
          const poolTotal = pp.poolHedMins + pp.poolHenMins;
          if (hedConsumed + henConsumed !== poolTotal && poolTotal < pp.overtimeOwedMins) {
            // Pool was smaller than owed, that's acceptable
          } else if (hedConsumed + henConsumed !== pp.overtimeOwedMins) {
            checks.cheapestFirst = "FAIL";
            details.push(
              `Consumed ${hedConsumed + henConsumed} != overtimeOwed ${pp.overtimeOwedMins}`,
            );
          }
        }
      }
    }

    // Check recargo costs are non-negative
    if (
      Number(pp.rnCost) < 0 ||
      Number(pp.rfCost) < 0 ||
      Number(pp.rfnCost) < 0
    ) {
      checks.recargoCosts = "FAIL";
      details.push(
        `Negative recargo cost: RN=${pp.rnCost}, RF=${pp.rfCost}, RFN=${pp.rfnCost}`,
      );
    }

    // Check expected hours: totalExpected should be > 0 if days scheduled
    if (pp.daysScheduled > 0 && pp.totalExpectedMins === 0) {
      checks.expectedHours = "FAIL";
      details.push(
        `${pp.daysScheduled} days scheduled but totalExpectedMins = 0`,
      );
    }

    const allPass = Object.values(checks).every((v) => v === "PASS");
    if (allPass) periodPassCount++;
    else periodFailCount++;

    if (!allPass) {
      periodResults.push({
        employeeId: pp.employeeId,
        employeeName: `${row.firstName} ${row.lastName}`,
        checks,
        details,
      });
    }
  }

  const overallPass = dailyFailCount === 0 && periodFailCount === 0;

  return NextResponse.json({
    period: {
      periodStart: refPeriod.periodStart,
      periodEnd: refPeriod.periodEnd,
      status: refPeriod.status,
    },
    overall: overallPass ? "PASS" : "FAIL",
    daily: {
      totalRecords: records.length,
      passed: dailyPassCount,
      failed: dailyFailCount,
      failures: dailyResults,
    },
    period_reconciliation: {
      totalRecords: periodRecords.length,
      passed: periodPassCount,
      failed: periodFailCount,
      failures: periodResults,
    },
  });
}
