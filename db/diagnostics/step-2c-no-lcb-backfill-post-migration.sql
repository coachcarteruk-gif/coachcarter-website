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
-- For every learner that B3 just backfilled, drift at the pair should be 0.
-- If any are non-zero, the predicate manufactured drift somewhere.
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
  0 - (COALESCE(p.minutes, 0) - COALESCE(bd.minutes, 0))           AS drift
FROM backfilled_pairs bp
LEFT JOIN purchases     p  ON p.learner_id  = bp.learner_id AND p.instructor_id  = bp.instructor_id
LEFT JOIN booking_draws bd ON bd.learner_id = bp.learner_id AND bd.instructor_id = bp.instructor_id
ORDER BY bp.learner_id, bp.instructor_id;

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
-- pre-migration. Expected reduction: one pair per row from query (2) above.
-- Residual drift should be the Simon (11, 6) cross-instructor pair only.
