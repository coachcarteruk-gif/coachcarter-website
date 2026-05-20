-- Step 2.5 post-migration diagnostics
-- Per PER-INSTRUCTOR-CREDITS-PLAN.md §Step 2 (free-trial writer + CHECK widening).
-- Run AFTER /api/migrate-step-2-5 returns ok=true on prod, and again after
-- the slots.js writer code is deployed and at least one fresh free-trial
-- booking has been created.

-- ── 1. Marker written ────────────────────────────────────────────────────────
SELECT key, completed_at::text AS completed_at, notes
  FROM migration_markers
 WHERE key = 'per_instructor_credits_step_2_5';

-- ── 2. Updated CHECK constraint includes 'free_trial' ────────────────────────
-- Expect: pg_get_constraintdef output contains 'free_trial'.
SELECT pg_get_constraintdef(c.oid) AS new_constraint_def,
       (pg_get_constraintdef(c.oid) LIKE '%free_trial%') AS includes_free_trial
  FROM pg_constraint c
  JOIN pg_class      t ON t.oid = c.conrelid
 WHERE t.relname = 'credit_transactions'
   AND c.conname = 'credit_transactions_type_check';

-- ── 3. Confirm INSERT with type='free_trial' now succeeds (smoke) ────────────
-- Run only on a non-prod branch; this would create real data on prod.
-- Commented out by default.
--
-- BEGIN;
-- INSERT INTO credit_transactions (learner_id, type, credits, amount_pence, school_id, source)
-- VALUES (1, 'free_trial', 0, 0, 1, 'free_trial');
-- ROLLBACK;

-- ── 4. Post-deploy: free-trial bookings now have credit_transactions + BCS rows ──
-- Run this only AFTER the slots.js writer code is deployed AND at least one
-- fresh free-trial booking has been created. Old (pre-writer) trial bookings
-- will still have no BCS row.
SELECT
  COUNT(*) FILTER (WHERE bcs.id IS NOT NULL) AS bookings_with_bcs,
  COUNT(*) FILTER (WHERE bcs.id IS NULL)     AS bookings_without_bcs,
  COUNT(*)                                    AS total_trial_bookings
  FROM lesson_bookings lb
  JOIN lesson_types  lt  ON lt.id = lb.lesson_type_id
  LEFT JOIN booking_credit_sources bcs ON bcs.booking_id = lb.id
 WHERE lt.slug = 'trial';

-- ── 5. Sample the newest free-trial credit_transactions row ──────────────────
-- Expect (post-deploy): type='free_trial', source='free_trial', amount_pence=0,
-- credits=0, minutes=duration_minutes (NOT 0), instructor_id matches booking,
-- absorbed_by='platform'.
SELECT ct.id,
       ct.type,
       ct.source,
       ct.amount_pence,
       ct.credits,
       ct.minutes,
       ct.instructor_id,
       ct.absorbed_by,
       ct.created_at::text AS created_at
  FROM credit_transactions ct
 WHERE ct.type = 'free_trial'
 ORDER BY ct.created_at DESC
 LIMIT 3;

-- ── 6. Sample BCS rows for free-trial bookings ───────────────────────────────
-- Expect (post-deploy): one BCS row per fresh trial booking, pointing at the
-- zero-value credit_transactions row from query 5. minutes_drawn = trial
-- duration, contribution_pence = 0, stripe_fee_pence = 0, absorbed_by='platform'.
SELECT bcs.id,
       bcs.booking_id,
       bcs.credit_transaction_id,
       bcs.minutes_drawn,
       bcs.rate_pence_per_minute,
       bcs.contribution_pence,
       bcs.stripe_fee_pence,
       bcs.absorbed_by
  FROM booking_credit_sources bcs
  JOIN credit_transactions ct ON ct.id = bcs.credit_transaction_id
 WHERE ct.type = 'free_trial'
 ORDER BY bcs.created_at DESC
 LIMIT 3;
