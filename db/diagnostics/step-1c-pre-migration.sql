-- Step 1c pre-migration diagnostics
-- Per PER-INSTRUCTOR-CREDITS-PLAN.md §Step 1c (L346-385).
-- Run BEFORE invoking /api/migrate-step-1c on prod.
--
-- These queries predict what the backfill will see. Compare the counts here
-- to the per-pass counts the endpoint returns (and to step-1c-post-migration.sql)
-- to confirm the backfill behaved as predicted.

-- ── 1. migration_markers table exists, marker NOT yet inserted ───────────────
-- Expect: table exists (from the db/migration.sql ALTER), zero matching rows.
SELECT 'table exists' AS check,
       EXISTS (SELECT 1 FROM information_schema.tables
                WHERE table_name = 'migration_markers') AS result;

SELECT 'marker not yet inserted' AS check,
       NOT EXISTS (SELECT 1 FROM migration_markers
                    WHERE key = 'per_instructor_credits_step_1c_backfill') AS result;

-- ── 2. Total NULL list_price_source rows (the backfill scope) ────────────────
-- Expect: every booking created before #170 (commit 084537d, 2026-05-20).
-- Bookings created after that PR landed already have non-NULL source.
SELECT COUNT(*) AS rows_to_backfill
  FROM lesson_bookings
 WHERE list_price_source IS NULL;

-- ── 3. Pass 1 (free-trial / zero-minute) — predicted row count ───────────────
-- Expect: free trials + demo bookings + payment-disabled-school bookings.
-- Currently small (free trial usage is low; demo instructor is rare).
SELECT COUNT(*) AS pass1_zero_minute_rows
  FROM lesson_bookings
 WHERE list_price_source IS NULL
   AND minutes_deducted = 0;

-- ── 4. Pass 2 (live-compute backfill) — predicted row count ──────────────────
-- Expect: the bulk of historical rows. Anything with a non-anonymised learner,
-- a still-existing lesson type, and minutes_deducted > 0.
SELECT COUNT(*) AS pass2_live_compute_rows
  FROM lesson_bookings lb
  LEFT JOIN learner_users lu ON lu.id = lb.learner_id
  LEFT JOIN lesson_types  lt ON lt.id = lb.lesson_type_id
 WHERE lb.list_price_source IS NULL
   AND lb.minutes_deducted > 0
   AND lb.learner_id IS NOT NULL
   AND lu.id IS NOT NULL
   AND lt.id IS NOT NULL;

-- ── 5. Pass 3 (unknown) — predicted row count ────────────────────────────────
-- Expect: small. Anonymised learners, deleted lesson types, orphan rows.
-- These get list_price_source = 'unknown', list_price_pence stays NULL.
SELECT COUNT(*) AS pass3_unknown_rows
  FROM lesson_bookings lb
  LEFT JOIN learner_users lu ON lu.id = lb.learner_id
  LEFT JOIN lesson_types  lt ON lt.id = lb.lesson_type_id
 WHERE lb.list_price_source IS NULL
   AND lb.minutes_deducted > 0
   AND (lb.learner_id IS NULL OR lu.id IS NULL OR lt.id IS NULL);

-- ── 6. Sanity: pass counts sum to total NULL rows ────────────────────────────
-- Expect: TRUE. If FALSE, the WHERE clauses above have a gap.
WITH counts AS (
  SELECT
    (SELECT COUNT(*) FROM lesson_bookings WHERE list_price_source IS NULL) AS total_null,
    (SELECT COUNT(*) FROM lesson_bookings WHERE list_price_source IS NULL AND minutes_deducted = 0) AS p1,
    (SELECT COUNT(*)
       FROM lesson_bookings lb
       LEFT JOIN learner_users lu ON lu.id = lb.learner_id
       LEFT JOIN lesson_types  lt ON lt.id = lb.lesson_type_id
      WHERE lb.list_price_source IS NULL
        AND lb.minutes_deducted > 0
        AND lb.learner_id IS NOT NULL
        AND lu.id IS NOT NULL
        AND lt.id IS NOT NULL) AS p2,
    (SELECT COUNT(*)
       FROM lesson_bookings lb
       LEFT JOIN learner_users lu ON lu.id = lb.learner_id
       LEFT JOIN lesson_types  lt ON lt.id = lb.lesson_type_id
      WHERE lb.list_price_source IS NULL
        AND lb.minutes_deducted > 0
        AND (lb.learner_id IS NULL OR lu.id IS NULL OR lt.id IS NULL)) AS p3
)
SELECT total_null, p1, p2, p3, (p1 + p2 + p3) AS pass_sum,
       (total_null = p1 + p2 + p3) AS sum_matches
  FROM counts;

-- ── 7. Sanity: confirm fresh writers (post-#170) already populate the column ─
-- Expect: zero NULL rows among bookings created today (sanity check that
-- Step 1b is actually working). If non-zero, Step 1b has a regression and
-- 1c will not be sufficient — investigate before running the backfill.
SELECT COUNT(*) AS recent_nulls_should_be_zero
  FROM lesson_bookings
 WHERE list_price_source IS NULL
   AND created_at >= NOW() - INTERVAL '1 day';
