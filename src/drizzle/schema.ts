import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  date,
  time,
  decimal,
  unique,
} from "drizzle-orm/pg-core";

// ─── admin_users ────────────────────────────────────────────────────────────
export const adminUsers = pgTable("admin_users", {
  id: serial("id").primaryKey(),
  username: text("username").unique().notNull(),
  email: text("email").unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name"),
  role: text("role").default("admin").notNull(), // 'admin' | 'superadmin'
  isActive: boolean("is_active").default(true).notNull(),
  lastLogin: timestamp("last_login"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── sessions (NextAuth database sessions) ──────────────────────────────────
export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(), // session token
  userId: integer("user_id")
    .references(() => adminUsers.id, { onDelete: "cascade" })
    .notNull(),
  expires: timestamp("expires").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── groups ─────────────────────────────────────────────────────────────────
export const groups = pgTable("groups", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(), // 'Kitchen', 'Servers', 'Bar', 'Admin'
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── employees (synced from BioTime) ──────────────────────────────────────────
export const employees = pgTable("employees", {
  id: serial("id").primaryKey(),
  empCode: text("emp_code").unique().notNull(),
  cedula: text("cedula"),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  groupId: integer("group_id").references(() => groups.id),
  monthlySalary: decimal("monthly_salary", { precision: 12, scale: 2 }),
  restDay: integer("rest_day").default(0).notNull(), // 0=Mon..6=Sun
  isActive: boolean("is_active").default(true).notNull(),
  biotimeId: integer("biotime_id"),
  syncedAt: timestamp("synced_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── weekly_schedules ───────────────────────────────────────────────────────
export const weeklySchedules = pgTable(
  "weekly_schedules",
  {
    id: serial("id").primaryKey(),
    weekStart: date("week_start").notNull(), // Monday of the week
    groupId: integer("group_id")
      .references(() => groups.id)
      .notNull(),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [unique().on(t.weekStart, t.groupId)],
);

// ─── shifts ─────────────────────────────────────────────────────────────────
export const shifts = pgTable(
  "shifts",
  {
    id: serial("id").primaryKey(),
    scheduleId: integer("schedule_id")
      .references(() => weeklySchedules.id, { onDelete: "cascade" })
      .notNull(),
    employeeId: integer("employee_id")
      .references(() => employees.id)
      .notNull(),
    dayOfWeek: integer("day_of_week").notNull(), // 0=Monday, 6=Sunday
    shiftType: text("shift_type").default("regular").notNull(), // 'regular' | 'day_off' | 'comp_day_off'
    shiftStart: time("shift_start"), // null for day_off/comp_day_off
    shiftEnd: time("shift_end"),
    crossesMidnight: boolean("crosses_midnight").default(false).notNull(),
    breakMinutes: integer("break_minutes").default(0).notNull(),
    isSplit: boolean("is_split").default(false).notNull(),
    splitPairId: integer("split_pair_id"),
    compDebitMins: integer("comp_debit_mins").default(0).notNull(),
  },
  (t) => [unique().on(t.scheduleId, t.employeeId, t.dayOfWeek, t.shiftStart)],
);

// ─── punch_logs ─────────────────────────────────────────────────────────────
export const punchLogs = pgTable("punch_logs", {
  id: serial("id").primaryKey(),
  empCode: text("emp_code").notNull(),
  punchTime: timestamp("punch_time").notNull(),
  punchState: text("punch_state"), // '0'=in, '1'=out
  verifyType: integer("verify_type"),
  terminalSn: text("terminal_sn"),
  biotimeId: integer("biotime_id").unique(), // null for manual entries
  source: text("source").default("biotime").notNull(), // 'biotime' | 'manual'
  createdBy: text("created_by"), // admin username for manual entries
  note: text("note"),
  syncedAt: timestamp("synced_at").defaultNow().notNull(),
});

// ─── punch_corrections ─────────────────────────────────────────────────────
export const punchCorrections = pgTable("punch_corrections", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id")
    .references(() => employees.id)
    .notNull(),
  workDate: date("work_date").notNull(),
  action: text("action").notNull(), // 'add_in' | 'add_out' | 'edit_in' | 'edit_out'
  oldValue: timestamp("old_value"),
  newValue: timestamp("new_value").notNull(),
  reason: text("reason").notNull(),
  correctedBy: text("corrected_by").notNull(),
  correctedAt: timestamp("corrected_at").defaultNow().notNull(),
});

// ─── daily_attendance ───────────────────────────────────────────────────────
export const dailyAttendance = pgTable(
  "daily_attendance",
  {
    id: serial("id").primaryKey(),
    employeeId: integer("employee_id")
      .references(() => employees.id)
      .notNull(),
    workDate: date("work_date").notNull(),

    // Raw punches
    clockIn: timestamp("clock_in"),
    clockOut: timestamp("clock_out"),

    // Effective times (after normalization)
    effectiveIn: timestamp("effective_in"),
    effectiveOut: timestamp("effective_out"),

    // Manual correction flags
    isClockInManual: boolean("is_clock_in_manual").default(false).notNull(),
    isClockOutManual: boolean("is_clock_out_manual").default(false).notNull(),
    isMissingPunch: boolean("is_missing_punch").default(false).notNull(),

    // Schedule context (denormalized)
    scheduledStart: time("scheduled_start"),
    scheduledEnd: time("scheduled_end"),
    scheduledGapMins: integer("scheduled_gap_mins").default(0).notNull(),
    scheduledBreakMins: integer("scheduled_break_mins").default(0).notNull(),
    crossesMidnight: boolean("crosses_midnight").default(false).notNull(),
    isSplitShift: boolean("is_split_shift").default(false).notNull(),

    // Calculations
    totalWorkedMins: integer("total_worked_mins").default(0).notNull(),
    lateMinutes: integer("late_minutes").default(0).notNull(),
    earlyLeaveMins: integer("early_leave_mins").default(0).notNull(),

    // Hour classification (minutes)
    minsOrdinaryDay: integer("mins_ordinary_day").default(0).notNull(),
    minsNocturno: integer("mins_nocturno").default(0).notNull(),
    minsFestivoDay: integer("mins_festivo_day").default(0).notNull(),
    minsFestivoNight: integer("mins_festivo_night").default(0).notNull(),

    // Status
    dayType: text("day_type"), // 'regular' | 'holiday'
    status: text("status"), // 'on-time' | 'late' | 'absent' | 'day-off' | 'comp-day-off'

    // Daily excess pool (provisional, for period reconciliation)
    excessHedMins: integer("excess_hed_mins").default(0).notNull(),
    excessHenMins: integer("excess_hen_mins").default(0).notNull(),
    dailyLimitMins: integer("daily_limit_mins").default(0).notNull(),
    isProcessed: boolean("is_processed").default(false).notNull(),
  },
  (t) => [unique().on(t.employeeId, t.workDate)],
);

// ─── payroll_periods ────────────────────────────────────────────────────────
export const payrollPeriods = pgTable(
  "payroll_periods",
  {
    id: serial("id").primaryKey(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    employeeId: integer("employee_id")
      .references(() => employees.id)
      .notNull(),
    status: text("status").default("draft").notNull(), // 'draft' | 'finalized' | 'exported' | 'test'

    // Time totals
    totalExpectedMins: integer("total_expected_mins").default(0).notNull(),
    totalWorkedMins: integer("total_worked_mins").default(0).notNull(),
    totalOrdinaryMins: integer("total_ordinary_mins").default(0).notNull(),
    totalLateMins: integer("total_late_mins").default(0).notNull(),
    totalEarlyLeaveMins: integer("total_early_leave_mins").default(0).notNull(),
    daysScheduled: integer("days_scheduled").default(0).notNull(),
    daysWorked: integer("days_worked").default(0).notNull(),
    daysAbsent: integer("days_absent").default(0).notNull(),

    // Recargos (always paid, independent of overtime)
    rnMins: integer("rn_mins").default(0).notNull(),
    rnCost: decimal("rn_cost", { precision: 12, scale: 2 }).default("0").notNull(),
    rfMins: integer("rf_mins").default(0).notNull(),
    rfCost: decimal("rf_cost", { precision: 12, scale: 2 }).default("0").notNull(),
    rfnMins: integer("rfn_mins").default(0).notNull(),
    rfnCost: decimal("rfn_cost", { precision: 12, scale: 2 }).default("0").notNull(),

    // Overtime — excess pool
    poolHedMins: integer("pool_hed_mins").default(0).notNull(),
    poolHenMins: integer("pool_hen_mins").default(0).notNull(),

    // Overtime — after reconciliation
    overtimeRawMins: integer("overtime_raw_mins").default(0).notNull(),
    overtimeOwedMins: integer("overtime_owed_mins").default(0).notNull(),

    // Overtime consumed from pool (cheapest-first)
    otEarnedHedMins: integer("ot_earned_hed_mins").default(0).notNull(),
    otEarnedHenMins: integer("ot_earned_hen_mins").default(0).notNull(),

    // Comp time & time owed
    owedOffsetMins: integer("owed_offset_mins").default(0).notNull(),
    otBankedMins: integer("ot_banked_mins").default(0).notNull(),

    // Paid overtime (after offset + comp deduction)
    hedMins: integer("hed_mins").default(0).notNull(),
    hedCost: decimal("hed_cost", { precision: 12, scale: 2 }).default("0").notNull(),
    henMins: integer("hen_mins").default(0).notNull(),
    henCost: decimal("hen_cost", { precision: 12, scale: 2 }).default("0").notNull(),

    // Totals
    totalRecargosCost: decimal("total_recargos_cost", { precision: 12, scale: 2 })
      .default("0")
      .notNull(),
    totalExtrasCost: decimal("total_extras_cost", { precision: 12, scale: 2 })
      .default("0")
      .notNull(),
    totalSurcharges: decimal("total_surcharges", { precision: 12, scale: 2 })
      .default("0")
      .notNull(),

    // Compensatory balance tracking
    compBalanceStart: integer("comp_balance_start").default(0).notNull(),
    compCreditedMins: integer("comp_credited_mins").default(0).notNull(),
    compDebitedMins: integer("comp_debited_mins").default(0).notNull(),
    compOwedMins: integer("comp_owed_mins").default(0).notNull(),
    compOffsetMins: integer("comp_offset_mins").default(0).notNull(),
    compBalanceEnd: integer("comp_balance_end").default(0).notNull(),

    // Holiday tracking
    holidaysWorked: integer("holidays_worked").default(0).notNull(),

    // Metadata
    horaOrdinariaValue: decimal("hora_ordinaria_value", { precision: 8, scale: 2 }),
    monthlySalary: decimal("monthly_salary", { precision: 12, scale: 2 }),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    finalizedAt: timestamp("finalized_at"),
  },
  (t) => [unique().on(t.periodStart, t.periodEnd, t.employeeId)],
);

// ─── comp_transactions ──────────────────────────────────────────────────────
export const compTransactions = pgTable("comp_transactions", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id")
    .references(() => employees.id)
    .notNull(),
  transactionDate: date("transaction_date").notNull(),
  type: text("type").notNull(), // 'ot_banked' | 'comp_day_taken' | 'time_owed' | 'owed_offset'
  minutes: integer("minutes").notNull(), // signed
  balanceAfter: integer("balance_after").notNull(), // signed
  sourcePeriodId: integer("source_period_id").references(() => payrollPeriods.id),
  sourceShiftId: integer("source_shift_id").references(() => shifts.id),
  note: text("note"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── settings ───────────────────────────────────────────────────────────────
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value"),
});
