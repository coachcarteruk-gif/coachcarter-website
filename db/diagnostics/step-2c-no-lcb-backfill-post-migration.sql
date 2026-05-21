-- Post-migration verification for /api/migrate-step-2c-no-lcb-backfill
-- (Plan B3). Run these against the live DB after POSTing the migration
-- endpoint. Confirms the synthetic CTs landed and the cron's drift count
-- has dropped.

-- ── 1. Marker landed ───────────────────────────────────────────────────
SELECT key, completed_at::text, notes
  FROM migration_markers
 WHERE key = 'per_instructor_credits_step_2c_no_lcb_backfill';

-- ── 2. New legacy_grandfather CT rows from B3 ──────────────────────────
-- These are the synthetic CTs B3 just wrote. Identified by source =
-- 'reconciliation', payment_method = 'migration', and created_at ≈
-- marker.completed_at. Each should match a candidate pair from B3's
-- pre-migration query.
SELECT
  ct.id,
  ct.learner_id,
  ct.instructor_id,
  lu.name                       AS learner_name,
  i.name                        AS instructor_name,
  ct.minutes,
  ct.amount_pence,
  ct.created_at::text
FROM credit_transactions ct
LEFT JOIN learner_users lu ON lu.id = ct.learner_id
LEFT JOIN instructors  i  ON i.id  = ct.instructor_id
WHERE ct.type           = 'legacy_grandfather'
  AND ct.source         = 'reconciliation'
  AND ct.payment_method = 'migration'
  AND ct.created_at >= (
    SELECT completed_at FROM migration_markers
     WHERE key = 'per_instructor_credits_step_2c_no_lcb_backfill'
  )
ORDER BY ct.minutes DESC, ct.learner_id, ct.instructor_id;

-- ── 3. Drift reconcile check (BCS-aware variant) ───────────────────────
-- For every learner that B3 just backfilled, drift at the pair should
-- EQUAL the stale_refund_draws_at_pair predicted by the pre-migration
-- diagnostic (NOT zero). Specifically:
--   • Pairs with no stale-refund residual → drift = 0 post-B3.
--   • Pairs with stale-refund residual (cron's booking_draws still
--     counts those rows) → drift = stale_refund_minutes post-B3.
--     This is the refund-bug residual chip #3 will fix; it is NOT a
--     B3 failure mode.
-- On current prod data the expected post-B3 per-pair drift is:
--   (55, 4) → +90  (booking #133 stale-refund residual)
--   (73, 4) →   0
--   (92, 4) →   0
-- If ANY pair has |drift| > its pre-migration stale_refund_draws_at_pair,
-- the predicate has drifted from the cron's booking_draws — investigate
-- immediately.
WITH backfilled_pairs AS (
  SELECT learner_id, instructor_id
    FROM credit_transactions
   WHERE type           = 'legacy_grandfather'
     AND source         = 'reconciliation'
     AND payment_method = 'migration'
     AND created_at >= (
       SELECT completed_at FROM migration_markers
        WHERE key = 'per_instructor_credits_step_2c_no_lcb_backfill'
     )
),
purchases AS (
  SELECT ct.learner_id, ct.instructor_id,
         COALESCE(SUM(ct.minutes), 0)::int AS minutes
    FROM credit_transactions ct
   WHERE ct.school_id = 1 AND ct.instructor_id IS NOT NULL
   GROUP BY ct.learner_id, ct.instructor_id
),
booking_draws AS (
  SELECT lb.learner_id, lb.instructor_id,
         COALESCE(SUM(lb.minutes_deducted), 0)::int AS minutes
    FROM lesson_bookings lb
   WHERE lb.school_id = 1
     AND lb.credit_returned = FALSE
     AND lb.minutes_deducted IS NOT NULL
     AND lb.minutes_deducted > 0
     AND NOT EXISTS (
       SELECT 1 FROM booking_credit_sources bcs2
        WHERE bcs2.booking_id = lb.id
     )
   GROUP BY lb.learner_id, lb.instructor_id
)
SELECT
  bp.learner_id,
  bp.instructor_id,
  COALESCE(p.minutes, 0)                                          AS ct_minutes,
  COALESCE(bd.minutes, 0)                                         AS booking_minutes,
  COALESCE(p.minutes, 0) - COALESCE(bd.minutes, 0)                AS expected,
  0                                                                AS actual_lcb,
  0 - (COALESCE(p.minutes, 0) - COALESCE(bd.minutes, 0))           AS drift,
  -- Stale-refund minutes at the same pair (cron's booking_draws shape +
  -- status='refunded'). drift SHOULD equal this; if it doesn't, the
  -- migration's predicate and the cron's have drifted apart.
  COALESCE((
    SELECT SUM(lb2.minutes_deducted)::int FROM lesson_bookings lb2
     WHERE lb2.school_id = 1
       AND lb2.learner_id = bp.learner_id
       AND lb2.instructor_id = bp.instructor_id
       AND lb2.credit_returned = FALSE
       AND lb2.minutes_deducted IS NOT NULL
       AND lb2.minutes_deducted > 0
       AND lb2.status = 'refunded'
       AND NOT EXISTS (
         SELECT 1 FROM booking_credit_sources bcs2
          WHERE bcs2.booking_id = lb2.id
       )
  ), 0)                                                            AS expected_drift_from_stale_refund
FROM backfilled_pairs bp
LEFT JOIN purchases     p  ON p.learner_id  = bp.learner_id AND p.instructor_id  = bp.instructor_id
LEFT JOIN booking_draws bd ON bd.learner_id = bp.learner_id AND bd.instructor_id = bp.instructor_id
ORDER BY bp.learner_id, bp.instructor_id;
-- Per-pair invariant: drift = expected_drift_from_stale_refund.
-- On current prod data this means:
--   (55, 4) → drift=+90, expected=+90  ✓ (booking #133 awaits chip #3)
--   (73, 4) → drift=  0, expected=  0  ✓
--   (92, 4) → drift=  0, expected=  0  ✓

-- ── 4. Confirm no LCB rows were created ────────────────────────────────
-- B3 MUST NOT touch LCB. If this returns rows, the migration overstepped.
SELECT lcb.learner_id, lcb.instructor_id, lcb.balance_minutes, lcb.updated_at::text
  FROM learner_credit_balances lcb
 WHERE lcb.learner_id IN (
   SELECT learner_id FROM credit_transactions
    WHERE type           = 'legacy_grandfather'
      AND source         = 'reconciliation'
      AND payment_method = 'migration'
      AND created_at >= (
        SELECT completed_at FROM migration_markers
         WHERE key = 'per_instructor_credits_step_2c_no_lcb_backfill'
      )
 );
-- Expected: zero rows. If non-zero: B3 has a bug — investigate immediately.

-- ── 5. Final cron drift count ──────────────────────────────────────────
-- Operator: re-run /api/cron-credit-reconcile and compare drift_count to
-- pre-migration.
--
-- Expected reduction = COUNT(pairs where stale_refund_draws_at_pair = 0
-- in the pre-migration diagnostic). Pairs with stale_refund_draws > 0
-- STAY in the drift report at drift = stale_refund_minutes — that is
-- the refund-bug residual chip #3 will fix, NOT a B3 failure mode.
--
-- On current prod data the expected post-B3 cron state is:
--   pre-B3:  drift_count = 4 (all four no-LCB pairs flagging)
--   post-B3: drift_count = 2
--     • (55, 4) +90  — booking #133 stale-refund residual (clean 720 silenced)
--     • (11, 6) +90  — booking #117 stale-refund residual (refunded-only,
--                       not a B3 candidate; unchanged by B3)
-- After chip #3 lands and flips credit_returned=TRUE on bookings #117
-- and #133, drift_count drops 2 → 0 with no opposite-sign drift.
