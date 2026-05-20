-- Step 1c post-migration diagnostics
-- Per PER-INSTRUCTOR-CREDITS-PLAN.md §Step 1c (L346-385).
-- Run AFTER /api/migrate-step-1c (no dry_run) returns ok:true.
--
-- Compare the per-tag counts here to the endpoint's response body. Any
-- discrepancy means a row mutated between the endpoint completing and this
-- script running — investigate before merging the next step.

-- ── 1. Marker row inserted ───────────────────────────────────────────────────
-- Expect: exactly one row with key='per_instructor_credits_step_1c_backfill'.
-- Step 2's DDL guard checks for this exact key.
SELECT key, completed_at, notes
  FROM migration_markers
 WHERE key = 'per_instructor_credits_step_1c_backfill';

-- ── 2. Zero NULL list_price_source rows remain ───────────────────────────────
-- Expect: 0. The endpoint refuses to write the marker if any are still NULL,
-- so this is also TRUE by transitivity if (1) returned a row — but check
-- independently in case of a race with a freshly-inserted booking.
SELECT COUNT(*) AS remaining_null_should_be_zero
  FROM lesson_bookings
 WHERE list_price_source IS NULL;

-- ── 3. Per-tag distribution ──────────────────────────────────────────────────
-- Expect: rows now distributed across the four valid tags.
-- - 'stripe_metadata' rows are only from Step 1b (post-#170 webhook writes).
-- - 'live_compute_insert' rows are only from Step 1b (post-#170 live-compute
--   paths: handleBook, free trial, reschedule carrying forward).
-- - 'live_compute_backfill' rows are everything Step 1c touched in passes 1+2.
-- - 'unknown' rows are pass 3 (anonymised learners, deleted lesson types).
SELECT list_price_source, COUNT(*) AS rows
  FROM lesson_bookings
 GROUP BY list_price_source
 ORDER BY list_price_source NULLS LAST;

-- ── 4. live_compute_backfill rows have list_price_pence populated ────────────
-- Expect: 0 rows. Pass 1 sets 0, Pass 2 sets a computed value — neither
-- leaves list_price_pence NULL.
SELECT COUNT(*) AS bad_backfill_rows
  FROM lesson_bookings
 WHERE list_price_source = 'live_compute_backfill'
   AND list_price_pence IS NULL;

-- ── 5. unknown rows have list_price_pence NULL (deliberate) ──────────────────
-- Expect: every 'unknown' row has NULL list_price_pence. Anything else means
-- the operator widget's review-and-approve queue won't display correctly.
SELECT COUNT(*) AS unknown_with_value_should_be_zero
  FROM lesson_bookings
 WHERE list_price_source = 'unknown'
   AND list_price_pence IS NOT NULL;

-- ── 6. Spot-check: a live_compute_backfill price looks plausible ─────────────
-- Pick the 10 most recent live_compute_backfill rows; eyeball that prices fall
-- in the expected range (£20-£200, i.e. 2000-20000 pence) for normal lessons.
SELECT id, scheduled_date, minutes_deducted, list_price_pence
  FROM lesson_bookings
 WHERE list_price_source = 'live_compute_backfill'
   AND minutes_deducted > 0
 ORDER BY id DESC
 LIMIT 10;
