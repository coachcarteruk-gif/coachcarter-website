-- Post-migration verification for /api/migrate-step-2c-reattribute (Plan B1).
-- Run immediately after POSTing the migration endpoint. Confirms the
-- atomic CTE landed every step: marker written, source rows moved + deleted,
-- synthetic CTs inserted, drift reconciled.

-- ── 1. Marker landed ────────────────────────────────────────────────────
SELECT key, completed_at::text, notes
  FROM migration_markers
 WHERE key = 'per_instructor_credits_step_2c_reattribute';

-- ── 2. Source-instructor LCB rows are gone ──────────────────────────────
-- Should return zero rows. If non-zero AND grandfathered, the move
-- partially failed — investigate.
SELECT learner_id, balance_minutes, grandfathered_at::text
  FROM learner_credit_balances
 WHERE school_id = 1
   AND instructor_id = 1
   AND grandfathered_at IS NOT NULL;

-- Non-grandfathered LCB rows at instructor=1 should also be 0 (none
-- existed pre-migration on prod). If any appear, they're unrelated to
-- this migration but worth investigating.
SELECT COUNT(*) AS non_grandfathered_lcb_at_seed_instructor
  FROM learner_credit_balances
 WHERE school_id = 1
   AND instructor_id = 1
   AND grandfathered_at IS NULL;

-- ── 3. Target-instructor LCB rows now hold the moved balance ────────────
SELECT
  COUNT(*)::int                                       AS lcb_rows_at_4,
  COALESCE(SUM(balance_minutes), 0)::int              AS total_balance_at_4,
  COUNT(*) FILTER (WHERE grandfathered_at IS NOT NULL) AS grandfathered_rows_at_4
FROM learner_credit_balances
WHERE school_id = 1 AND instructor_id = 4;

-- ── 4. Synthetic CT rows written ────────────────────────────────────────
-- One row per moved learner. Shape: type='legacy_grandfather',
-- source='reconciliation', payment_method='migration', instructor_id=4,
-- minutes = (moved LCB balance) + (active draws at (L, 4)).
SELECT
  ct.learner_id,
  lu.name                AS learner_name,
  ct.minutes             AS synthetic_ct_minutes,
  ct.created_at::text    AS created_at,
  ct.type, ct.source, ct.payment_method, ct.amount_pence, ct.credits
FROM credit_transactions ct
LEFT JOIN learner_users lu ON lu.id = ct.learner_id
WHERE ct.type = 'legacy_grandfather'
  AND ct.source = 'reconciliation'
  AND ct.instructor_id = 4
ORDER BY ct.created_at, ct.learner_id;

-- ── 5. Per-learner reconciliation check ──────────────────────────────────
-- For every learner that got a synthetic CT, verify Shape B math:
--   actual_lcb(L, 4) + Σmin_deducted(L, 4)  =  ΣCT_minutes(L, 4)
-- Equivalent: drift = actual_lcb - (ΣCT - Σmd) = 0.
WITH per_learner AS (
  SELECT
    ct.learner_id,
    (SELECT COALESCE(SUM(c2.minutes), 0)::int
       FROM credit_transactions c2
      WHERE c2.school_id = 1 AND c2.learner_id = ct.learner_id AND c2.instructor_id = 4) AS ct_minutes,
    (SELECT COALESCE(SUM(lb.minutes_deducted), 0)::int
       FROM lesson_bookings lb
      WHERE lb.school_id = 1
        AND lb.learner_id = ct.learner_id
        AND lb.instructor_id = 4
        AND lb.credit_returned = FALSE
        AND lb.minutes_deducted IS NOT NULL
        AND lb.minutes_deducted > 0
        AND NOT EXISTS (SELECT 1 FROM booking_credit_sources b WHERE b.booking_id = lb.id)
     ) AS draws_minutes,
    (SELECT COALESCE(balance_minutes, 0)::int
       FROM learner_credit_balances
      WHERE learner_id = ct.learner_id AND instructor_id = 4) AS lcb_minutes
  FROM credit_transactions ct
  WHERE ct.type = 'legacy_grandfather' AND ct.instructor_id = 4
  GROUP BY ct.learner_id
)
SELECT
  learner_id,
  lcb_minutes,
  ct_minutes,
  draws_minutes,
  lcb_minutes - (ct_minutes - draws_minutes) AS drift_minutes,
  CASE WHEN lcb_minutes - (ct_minutes - draws_minutes) = 0 THEN 'CLEAN ✓' ELSE 'DRIFT' END AS status
FROM per_learner
ORDER BY ABS(lcb_minutes - (ct_minutes - draws_minutes)) DESC, learner_id;

-- ── 6. CHECK constraint widened ──────────────────────────────────────────
SELECT pg_get_constraintdef(oid) AS def
  FROM pg_constraint
 WHERE conrelid = 'credit_transactions'::regclass
   AND conname  = 'credit_transactions_type_check';

-- ── 7. Live cron snapshot ────────────────────────────────────────────────
-- Hit /api/cron-credit-reconcile (or run cron-credit-reconcile-manual.sql).
-- Expected: drift_count drops by (number of pre-migration Group B pairs
-- whose drift source was the wrong-instructor attribution). Cross-
-- instructor pairs (e.g. learner 11 / Simon=6) remain visible — those
-- represent real cross-instructor consumption questions, not migration
-- artifacts.

-- ── 8. learner_users.balance_minutes unchanged ──────────────────────────
-- Sanity: SUM(LCB per learner) should equal learner_users.balance_minutes
-- for all moved learners. The move kept totals within each learner
-- constant, so the pooled shadow is undisturbed even without the Step 4
-- sync trigger installed.
SELECT
  lu.id, lu.name, lu.balance_minutes,
  COALESCE((SELECT SUM(balance_minutes)::int
              FROM learner_credit_balances WHERE learner_id = lu.id), 0) AS lcb_sum,
  lu.balance_minutes - COALESCE((SELECT SUM(balance_minutes)::int
              FROM learner_credit_balances WHERE learner_id = lu.id), 0) AS pooled_vs_lcb_drift
FROM learner_users lu
WHERE lu.id IN (
  SELECT DISTINCT learner_id FROM credit_transactions
   WHERE type = 'legacy_grandfather' AND instructor_id = 4
)
ORDER BY pooled_vs_lcb_drift DESC;
