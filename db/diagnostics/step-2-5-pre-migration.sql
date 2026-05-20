-- Step 2.5 pre-migration diagnostics
-- Per PER-INSTRUCTOR-CREDITS-PLAN.md §Step 2 (free-trial writer + CHECK widening).
-- Run BEFORE invoking /api/migrate-step-2-5 on prod.
--
-- Step 2.5 widens credit_transactions_type_check to allow 'free_trial', and
-- enables the deferred free-trial writer in slots.js handleBookFreeTrial.
-- This script confirms that:
--   1. The Step 2c marker exists (Step 2.5 ships AFTER Step 2c).
--   2. The current CHECK constraint does NOT include 'free_trial'.
--   3. There are no existing rows of type 'free_trial' (impossible — would
--      indicate someone wrote one manually around the constraint).
--   4. The Step 2.5 marker is NOT yet present.

-- ── 1. migration_markers table exists, Step 2c done, Step 2.5 not done ───────
SELECT 'step_2c marker present' AS check,
       EXISTS (SELECT 1 FROM migration_markers
                WHERE key = 'per_instructor_credits_step_2c') AS result;

SELECT 'step_2_5 marker not yet present' AS check,
       NOT EXISTS (SELECT 1 FROM migration_markers
                    WHERE key = 'per_instructor_credits_step_2_5') AS result;

-- ── 2. Current CHECK constraint definition ───────────────────────────────────
-- Expect: 8 allowed values (purchase, refund, slot_purchase, edit_adjustment,
-- admin_add, admin_remove, referral_bonus, referral_reward). 'free_trial' NOT
-- present.
SELECT pg_get_constraintdef(c.oid) AS current_constraint_def
  FROM pg_constraint c
  JOIN pg_class      t ON t.oid = c.conrelid
 WHERE t.relname = 'credit_transactions'
   AND c.conname = 'credit_transactions_type_check';

-- ── 3. No existing 'free_trial' rows (sanity) ────────────────────────────────
-- Expect: 0. The CHECK would have blocked any insert with type='free_trial',
-- so this should be impossible. A non-zero count means the constraint was
-- bypassed via DROP/recreate, which would warrant a closer look.
SELECT COUNT(*) AS existing_free_trial_rows
  FROM credit_transactions
 WHERE type = 'free_trial';

-- ── 4. Free-trial booking volume — predicts post-deploy write rate ───────────
-- Expect: a small ongoing rate; this is the population that will start
-- getting credit_transactions + BCS rows post-deploy. None of these
-- bookings currently HAVE a BCS row.
SELECT COUNT(*) AS total_free_trial_bookings,
       MIN(scheduled_date::text) AS earliest,
       MAX(scheduled_date::text) AS latest
  FROM lesson_bookings lb
  JOIN lesson_types  lt ON lt.id = lb.lesson_type_id
 WHERE lt.slug = 'trial';

-- ── 5. No existing BCS rows for free-trial bookings (sanity) ─────────────────
-- Expect: 0. Confirms no writer is currently inserting BCS rows for trials.
SELECT COUNT(*) AS existing_bcs_rows_for_trials
  FROM booking_credit_sources bcs
  JOIN lesson_bookings lb ON lb.id = bcs.booking_id
  JOIN lesson_types    lt ON lt.id = lb.lesson_type_id
 WHERE lt.slug = 'trial';
