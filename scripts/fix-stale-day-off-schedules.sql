-- Find daily_attendance rows where status is day-off / comp-day-off
-- but scheduled_start / scheduled_end were left behind from a prior shift.
--
-- Run (dry-run first):
--   docker compose exec postgres psql -U timeflow -d timeflow \
--     -f scripts/fix-stale-day-off-schedules.sql

BEGIN;

-- 1. Preview affected rows
SELECT
  da.id,
  e.first_name || ' ' || e.last_name AS employee,
  da.work_date,
  da.status,
  da.scheduled_start,
  da.scheduled_end
FROM daily_attendance da
JOIN employees e ON e.id = da.employee_id
WHERE da.status IN ('day-off', 'comp-day-off')
  AND (da.scheduled_start IS NOT NULL OR da.scheduled_end IS NOT NULL)
ORDER BY da.work_date DESC, employee;

-- 2. Clear the stale scheduled times
UPDATE daily_attendance
SET scheduled_start = NULL,
    scheduled_end   = NULL
WHERE status IN ('day-off', 'comp-day-off')
  AND (scheduled_start IS NOT NULL OR scheduled_end IS NOT NULL);

-- Inspect the output above. If the preview looks correct, replace ROLLBACK
-- with COMMIT to persist the fix.
ROLLBACK;
