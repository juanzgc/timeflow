-- Floor daily_attendance.effective_out down to the nearest 15-minute mark.
-- Examples: 10:47 → 10:45, 10:59 → 10:45, 11:00 → 11:00, 11:14 → 11:00.
--
-- Run (dry-run first):
--   docker compose exec postgres psql -U timeflow -d timeflow \
--     -f scripts/floor-effective-out-15min.sql
--
-- NOTE: this only rewrites effective_out. Derived fields (total_worked_mins,
-- mins_ordinary_day, mins_nocturno, etc.) will be stale until the affected
-- days are recalculated via the attendance engine.

BEGIN;

-- 1. Preview rows that will change (effective_out not already on :00/:15/:30/:45).
SELECT
  da.id,
  e.first_name || ' ' || e.last_name AS employee,
  da.work_date,
  da.effective_out                                    AS old_effective_out,
  date_bin('15 minutes'::interval,
           da.effective_out,
           TIMESTAMP '2000-01-01')                    AS new_effective_out
FROM daily_attendance da
JOIN employees e ON e.id = da.employee_id
WHERE da.effective_out IS NOT NULL
  AND EXTRACT(MINUTE FROM da.effective_out)::int % 15 <> 0
     OR EXTRACT(SECOND FROM da.effective_out)::int <> 0
ORDER BY da.work_date DESC, employee;

-- 2. Apply the floor.
UPDATE daily_attendance
SET effective_out = date_bin('15 minutes'::interval,
                             effective_out,
                             TIMESTAMP '2000-01-01')
WHERE effective_out IS NOT NULL
  AND (EXTRACT(MINUTE FROM effective_out)::int % 15 <> 0
       OR EXTRACT(SECOND FROM effective_out)::int <> 0);

-- Review the preview above. Swap ROLLBACK for COMMIT to persist, then
-- recalc the affected days so derived minutes are consistent.
ROLLBACK;
