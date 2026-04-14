CREATE TABLE "admin_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"email" text,
	"password_hash" text NOT NULL,
	"display_name" text,
	"role" text DEFAULT 'admin' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_username_unique" UNIQUE("username"),
	CONSTRAINT "admin_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "comp_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"transaction_date" date NOT NULL,
	"type" text NOT NULL,
	"minutes" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"source_period_id" integer,
	"source_shift_id" integer,
	"note" text,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_attendance" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"work_date" date NOT NULL,
	"clock_in" timestamp,
	"clock_out" timestamp,
	"effective_in" timestamp,
	"effective_out" timestamp,
	"is_clock_in_manual" boolean DEFAULT false NOT NULL,
	"is_clock_out_manual" boolean DEFAULT false NOT NULL,
	"is_missing_punch" boolean DEFAULT false NOT NULL,
	"scheduled_start" time,
	"scheduled_end" time,
	"scheduled_gap_mins" integer DEFAULT 0 NOT NULL,
	"scheduled_break_mins" integer DEFAULT 0 NOT NULL,
	"crosses_midnight" boolean DEFAULT false NOT NULL,
	"is_split_shift" boolean DEFAULT false NOT NULL,
	"total_worked_mins" integer DEFAULT 0 NOT NULL,
	"late_minutes" integer DEFAULT 0 NOT NULL,
	"early_leave_mins" integer DEFAULT 0 NOT NULL,
	"mins_ordinary_day" integer DEFAULT 0 NOT NULL,
	"mins_nocturno" integer DEFAULT 0 NOT NULL,
	"mins_festivo_day" integer DEFAULT 0 NOT NULL,
	"mins_festivo_night" integer DEFAULT 0 NOT NULL,
	"day_type" text,
	"status" text,
	"excess_hed_mins" integer DEFAULT 0 NOT NULL,
	"excess_hen_mins" integer DEFAULT 0 NOT NULL,
	"daily_limit_mins" integer DEFAULT 0 NOT NULL,
	"is_processed" boolean DEFAULT false NOT NULL,
	CONSTRAINT "daily_attendance_employee_id_work_date_unique" UNIQUE("employee_id","work_date")
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" serial PRIMARY KEY NOT NULL,
	"emp_code" text NOT NULL,
	"cedula" text,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"group_id" integer,
	"monthly_salary" numeric(12, 2),
	"rest_day" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"biotime_id" integer,
	"synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "employees_emp_code_unique" UNIQUE("emp_code")
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_periods" (
	"id" serial PRIMARY KEY NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"employee_id" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"total_expected_mins" integer DEFAULT 0 NOT NULL,
	"total_worked_mins" integer DEFAULT 0 NOT NULL,
	"total_ordinary_mins" integer DEFAULT 0 NOT NULL,
	"total_late_mins" integer DEFAULT 0 NOT NULL,
	"total_early_leave_mins" integer DEFAULT 0 NOT NULL,
	"days_scheduled" integer DEFAULT 0 NOT NULL,
	"days_worked" integer DEFAULT 0 NOT NULL,
	"days_absent" integer DEFAULT 0 NOT NULL,
	"rn_mins" integer DEFAULT 0 NOT NULL,
	"rn_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"rf_mins" integer DEFAULT 0 NOT NULL,
	"rf_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"rfn_mins" integer DEFAULT 0 NOT NULL,
	"rfn_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"pool_hed_mins" integer DEFAULT 0 NOT NULL,
	"pool_hen_mins" integer DEFAULT 0 NOT NULL,
	"overtime_raw_mins" integer DEFAULT 0 NOT NULL,
	"overtime_owed_mins" integer DEFAULT 0 NOT NULL,
	"ot_earned_hed_mins" integer DEFAULT 0 NOT NULL,
	"ot_earned_hen_mins" integer DEFAULT 0 NOT NULL,
	"owed_offset_mins" integer DEFAULT 0 NOT NULL,
	"ot_banked_mins" integer DEFAULT 0 NOT NULL,
	"hed_mins" integer DEFAULT 0 NOT NULL,
	"hed_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"hen_mins" integer DEFAULT 0 NOT NULL,
	"hen_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_recargos_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_extras_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_surcharges" numeric(12, 2) DEFAULT '0' NOT NULL,
	"comp_balance_start" integer DEFAULT 0 NOT NULL,
	"comp_credited_mins" integer DEFAULT 0 NOT NULL,
	"comp_debited_mins" integer DEFAULT 0 NOT NULL,
	"comp_owed_mins" integer DEFAULT 0 NOT NULL,
	"comp_offset_mins" integer DEFAULT 0 NOT NULL,
	"comp_balance_end" integer DEFAULT 0 NOT NULL,
	"holidays_worked" integer DEFAULT 0 NOT NULL,
	"hora_ordinaria_value" numeric(8, 2),
	"monthly_salary" numeric(12, 2),
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"finalized_at" timestamp,
	CONSTRAINT "payroll_periods_period_start_period_end_employee_id_unique" UNIQUE("period_start","period_end","employee_id")
);
--> statement-breakpoint
CREATE TABLE "punch_corrections" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"work_date" date NOT NULL,
	"action" text NOT NULL,
	"old_value" timestamp,
	"new_value" timestamp NOT NULL,
	"reason" text NOT NULL,
	"corrected_by" text NOT NULL,
	"corrected_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "punch_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"emp_code" text NOT NULL,
	"punch_time" timestamp NOT NULL,
	"punch_state" text,
	"verify_type" integer,
	"terminal_sn" text,
	"biotime_id" integer,
	"source" text DEFAULT 'biotime' NOT NULL,
	"created_by" text,
	"note" text,
	"synced_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "punch_logs_biotime_id_unique" UNIQUE("biotime_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"expires" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text
);
--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" serial PRIMARY KEY NOT NULL,
	"schedule_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"day_of_week" integer NOT NULL,
	"shift_type" text DEFAULT 'regular' NOT NULL,
	"shift_start" time,
	"shift_end" time,
	"crosses_midnight" boolean DEFAULT false NOT NULL,
	"break_minutes" integer DEFAULT 0 NOT NULL,
	"is_split" boolean DEFAULT false NOT NULL,
	"split_pair_id" integer,
	"comp_debit_mins" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "shifts_schedule_id_employee_id_day_of_week_shift_start_unique" UNIQUE("schedule_id","employee_id","day_of_week","shift_start")
);
--> statement-breakpoint
CREATE TABLE "weekly_schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"week_start" date NOT NULL,
	"group_id" integer NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "weekly_schedules_week_start_group_id_unique" UNIQUE("week_start","group_id")
);
--> statement-breakpoint
ALTER TABLE "comp_transactions" ADD CONSTRAINT "comp_transactions_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comp_transactions" ADD CONSTRAINT "comp_transactions_source_period_id_payroll_periods_id_fk" FOREIGN KEY ("source_period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comp_transactions" ADD CONSTRAINT "comp_transactions_source_shift_id_shifts_id_fk" FOREIGN KEY ("source_shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_attendance" ADD CONSTRAINT "daily_attendance_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punch_corrections" ADD CONSTRAINT "punch_corrections_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_admin_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_schedule_id_weekly_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."weekly_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_schedules" ADD CONSTRAINT "weekly_schedules_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;