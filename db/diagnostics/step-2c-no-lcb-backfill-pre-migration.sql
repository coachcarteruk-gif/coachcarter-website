-- Pre-migration verification for /api/migrate-step-2c-no-lcb-backfill
-- (Plan B3). Run these against the live DB (or a PITR branch) before
-- POSTing the migration endpoint. The goal is to understand exactly which
-- pairs the predicate will touch before applying.
--
-- Run with the standard Neon SQL Editor; no parameters needed.

-- ── 1. Marker prereq check ─────────────────────────────────────────────
-- The no-LCB-backfill endpoint requires per_instructor_credits_step_2c_reattribute
-- (Plan B1) to be present. Confirm before running.
SELECT key, completed_at::text
  FROM migration_markers
 WHERE key IN ('per_instructor_credits_step_2c',
               'per_instructor_credits_step_2c_grandfather',
               'per_instructor_credits_step_2c_reattribute',
               'per_instructor_credits_step_2c_no_lcb_backfill')
 ORDER BY completed_at;

-- ── 2. Candidate pairs (BCS-aware variant) ─────────────────────────────
-- This MUST mirror the cron's booking_draws CTE PLUS the
-- `status != 'refunded'` tightening B3 applies. The cron itself does
-- not filter on status — refunded-but-credit-not-returned rows are an
-- active draw to the cron (and rightly so; that IS the bug chip #3
-- fixes). B3 narrows synthetic CT minutes to status != 'refunded' so
-- the stale-refund residual stays visible.
--
-- If booking_credit_sources exists on the target environment use this
-- query; otherwise drop the BCS NOT EXISTS clause.
--
-- Each row is a pair the migration will INSERT a synthetic
-- legacy_grandfather CT for, with minutes = draws_minutes (clean only).
SELECT
  lb.learner_id,
  lb.instructor_id,
  lu.name                       AS learner_name,
  lu.email                      AS learner_email,
  i.name                        AS instructor_name,
  SUM(lb.minutes_deducted)::int AS clean_draws_minutes,
  COUNT(*)::int                 AS clean_draws_booking_count,
  COALESCE((
    SELECT SUM(lb2.minutes_deducted)::int FROM lesson_bookings lb2
     WHERE lb2.school_id = lb.school_id
       AND lb2.learner_id = lb.learner_id
       AND lb2.instructor_id = lb.instructor_id
       AND lb2.credit_returned = FALSE
       AND lb2.minutes_deducted IS NOT NULL
       AND lb2.minutes_deducted > 0
       AND lb2.status = 'refunded'
  ), 0) AS stale_refund_draws_at_pair,
  COALESCE((
    SELECT COUNT(*)::int FROM credit_transactions ct
     WHERE ct.school_id     = lb.school_id
       AND ct.learner_id    = lb.learner_id
       AND ct.instructor_id IS NULL
  ), 0) AS pooled_ct_rows_for_learner,
  COALESCE((
    SELECT SUM(ct.minutes)::int FROM credit_transactions ct
     WHERE ct.school_id     = lb.school_id
       AND ct.learner_id    = lb.learner_id
       AND ct.instructor_id IS NULL
  ), 0) AS pooled_ct_minutes_for_learner
FROM lesson_bookings lb
LEFT JOIN learner_users lu ON lu.id = lb.learner_id
LEFT JOIN instructors  i  ON i.id  = lb.instructor_id
WHERE lb.school_id = 1
  AND lb.credit_returned = FALSE
  AND lb.minutes_deducted IS NOT NULL
  AND lb.minutes_deducted > 0
  AND lb.status != 'refunded'
  AND NOT EXISTS (
    SELECT 1 FROM booking_credit_sources bcs2
     WHERE bcs2.booking_id = lb.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM learner_credit_balances lcb
     WHERE lcb.learner_id = lb.learner_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM credit_transactions ct
     WHERE ct.school_id     = lb.school_id
       AND ct.learner_id    = lb.learner_id
       AND ct.instructor_id = lb.instructor_id
  )
GROUP BY lb.learner_id, lb.instructor_id, lu.name, lu.email, i.name
HAVING SUM(lb.minutes_deducted) > 0
ORDER BY SUM(lb.minutes_deducted) DESC, lb.learner_id, lb.instructor_id;

-- ── 3. Verify candidate set matches the cron's drift report ────────────
-- Cross-check: every candidate pair should currently appear in the cron's
-- per-pair drift report with drift_minutes = draws_minutes (positive).
-- If a candidate is NOT in the cron drift, the predicates have drifted
-- apart — investigate before applying.
--
-- After the migration, none of these pairs should appear in the drift
-- report (their drift will be 0).

-- ── 4. Existing legacy_grandfather CT count (informational) ────────────
-- After B1 (PR #184) this should be 21 on prod. B3 will add one per
-- candidate pair from (2) above. Step 6 (FIFO grandfather policy) may
-- treat the union later — that's deferred.
SELECT
  COUNT(*)::int                       AS legacy_grandfather_ct_rows,
  COALESCE(SUM(minutes), 0)::int      AS legacy_grandfather_ct_total_minutes
FROM credit_transactions
WHERE type = 'legacy_grandfather';

-- ── 5. Snapshot of the current cron drift state ────────────────────────
-- Re-run the cron-credit-reconcile-manual.sql diagnostics to confirm the
-- current drift_count. After B3 applies, expect drift_count to drop by
-- exactly the candidate_count from query (2).
