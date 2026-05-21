-- Pre-migration verification for /api/migrate-step-2c-reattribute (Plan B1).
-- Run these against the live DB (or a PITR branch) before POSTing the
-- migration endpoint. The goal is to understand exactly which rows the
-- predicate will touch and the Shape B math per learner before applying.
--
-- Run with the standard Neon SQL Editor; no parameters needed.

-- ── 1. Marker prereq check ──────────────────────────────────────────────
-- The reattribute endpoint requires per_instructor_credits_step_2c_grandfather
-- to be present. Confirm before running.
SELECT key, completed_at::text
  FROM migration_markers
 WHERE key IN ('per_instructor_credits_step_2c',
               'per_instructor_credits_step_2c_grandfather',
               'per_instructor_credits_step_2c_reattribute')
 ORDER BY completed_at;

-- ── 2. Target instructor sanity check ───────────────────────────────────
-- Confirm instructor_id = 4 is Fraser's real row (not deleted, in school 1).
-- If this returns 0 rows the migration will 409.
SELECT id, name, email, school_id, stripe_account_id IS NOT NULL AS has_stripe,
       payouts_paused, payouts_start_date::text
  FROM instructors
 WHERE id = 4 AND school_id = 1;

-- ── 3. Seed instructor confirmation ─────────────────────────────────────
-- The source row Step 2c targeted by mistake. Should be a "James Carter"-
-- style seed row with no Stripe account, no bookings, no real activity.
SELECT id, name, email, school_id, stripe_account_id IS NOT NULL AS has_stripe
  FROM instructors WHERE id = 1;

-- ── 4. Candidate count + total minutes to move ──────────────────────────
SELECT
  COUNT(*)                              AS candidate_count,
  COALESCE(SUM(balance_minutes), 0)::int AS total_minutes_to_move
FROM learner_credit_balances
WHERE school_id = 1
  AND instructor_id = 1
  AND grandfathered_at IS NOT NULL;

-- ── 5. Per-learner Shape B breakdown ────────────────────────────────────
-- For each candidate, compute:
--   moved_balance_minutes        = the LCB balance being moved
--   active_draw_minutes_at_4     = booking_draws at (learner, 4) using
--                                  the cron's predicate exactly
--   synthetic_ct_minutes         = moved + active_draws (this is what
--                                  the migration will write)
--   expected_post_drift          = always 0 (Shape B math)
--
-- The active_draws subquery MIRRORS api/cron-credit-reconcile.js's
-- booking_draws CTE in full mode. If it ever diverges, the migration
-- manufactures new drift.
SELECT
  lcb.learner_id,
  lu.name                     AS learner_name,
  lu.email                    AS learner_email,
  lcb.balance_minutes         AS moved_balance_minutes,
  COALESCE((
    SELECT SUM(lb.minutes_deducted)::int
      FROM lesson_bookings lb
     WHERE lb.school_id = lcb.school_id
       AND lb.learner_id = lcb.learner_id
       AND lb.instructor_id = 4
       AND lb.credit_returned = FALSE
       AND lb.minutes_deducted IS NOT NULL
       AND lb.minutes_deducted > 0
       AND NOT EXISTS (
         SELECT 1 FROM booking_credit_sources bcs2
          WHERE bcs2.booking_id = lb.id
       )
  ), 0)                       AS active_draw_minutes_at_4,
  lcb.balance_minutes + COALESCE((
    SELECT SUM(lb.minutes_deducted)::int
      FROM lesson_bookings lb
     WHERE lb.school_id = lcb.school_id
       AND lb.learner_id = lcb.learner_id
       AND lb.instructor_id = 4
       AND lb.credit_returned = FALSE
       AND lb.minutes_deducted IS NOT NULL
       AND lb.minutes_deducted > 0
       AND NOT EXISTS (
         SELECT 1 FROM booking_credit_sources bcs2
          WHERE bcs2.booking_id = lb.id
       )
  ), 0)                       AS synthetic_ct_minutes,
  lcb.grandfathered_at::text  AS grandfathered_at
FROM learner_credit_balances lcb
LEFT JOIN learner_users lu ON lu.id = lcb.learner_id
WHERE lcb.school_id = 1
  AND lcb.instructor_id = 1
  AND lcb.grandfathered_at IS NOT NULL
ORDER BY lcb.balance_minutes DESC, lcb.learner_id;

-- ── 6. Conflict analysis on (learner_id, instructor_id = 4) ─────────────
-- If non-empty, the migration will MERGE into existing LCB(L, 4) rows.
-- Watched-stays-watched rule: if either side has grandfathered_at NULL,
-- the merged row's grandfathered_at becomes NULL (active row wins).
SELECT
  lcb_src.learner_id,
  lcb_src.balance_minutes      AS incoming_balance,
  lcb_src.grandfathered_at::text AS incoming_grandfathered_at,
  lcb_tgt.balance_minutes      AS existing_target_balance,
  lcb_tgt.grandfathered_at::text AS existing_target_grandfathered_at,
  lcb_src.balance_minutes + lcb_tgt.balance_minutes AS merged_balance,
  CASE
    WHEN lcb_src.grandfathered_at IS NULL OR lcb_tgt.grandfathered_at IS NULL
      THEN 'NULL (active-wins)'
    WHEN lcb_tgt.grandfathered_at < lcb_src.grandfathered_at
      THEN lcb_tgt.grandfathered_at::text || ' (existing earlier)'
    ELSE lcb_src.grandfathered_at::text || ' (incoming earlier)'
  END AS merged_grandfathered_at
FROM learner_credit_balances lcb_src
JOIN learner_credit_balances lcb_tgt
  ON lcb_tgt.learner_id = lcb_src.learner_id
 AND lcb_tgt.instructor_id = 4
WHERE lcb_src.school_id = 1
  AND lcb_src.instructor_id = 1
  AND lcb_src.grandfathered_at IS NOT NULL
ORDER BY lcb_src.learner_id;

-- ── 7. Snapshot of the current cron drift state ──────────────────────────
-- This is what we expect to reduce by candidate_count after running the
-- migration (each candidate that had a pre-existing drift pair gets
-- silenced; pairs whose only drift source was the wrong-instructor
-- attribution disappear; cross-instructor cases remain visible).
-- Re-run the cron-credit-reconcile-manual.sql diagnostics post-migration.

-- ── 8. Existing legacy_grandfather CT rows (should be 0 pre-migration) ──
SELECT COUNT(*) AS legacy_grandfather_cts_present
  FROM credit_transactions
 WHERE type = 'legacy_grandfather';

-- ── 9. CHECK constraint state ───────────────────────────────────────────
-- The migration widens credit_transactions_type_check to include
-- 'legacy_grandfather'. Confirm current allowlist before/after.
SELECT pg_get_constraintdef(oid) AS def
  FROM pg_constraint
 WHERE conrelid = 'credit_transactions'::regclass
   AND conname  = 'credit_transactions_type_check';
