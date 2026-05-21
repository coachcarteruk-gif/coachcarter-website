-- Pre-migration verification for /api/migrate-step-2c-grandfather (Plan A).
-- Run these against the live DB (or a PITR branch) before POSTing the
-- migration endpoint. The goal is to understand exactly which rows the
-- predicate will touch, and confirm Group A pairs from the first prod fire
-- match expectations.
--
-- Run with the standard Neon SQL Editor; no parameters needed.

-- ── 1. Does the column already exist? ────────────────────────────────────
SELECT EXISTS (
  SELECT 1 FROM information_schema.columns
   WHERE table_schema='public'
     AND table_name='learner_credit_balances'
     AND column_name='grandfathered_at'
) AS grandfathered_at_present;

-- ── 2. How many LCB rows are currently grandfathered (before this run)? ──
-- Expected on a fresh prod DB: 0. If non-zero, the migration is being
-- re-run; review which rows are flagged before continuing.
SELECT
  COUNT(*) FILTER (WHERE grandfathered_at IS NOT NULL) AS already_grandfathered,
  COUNT(*) FILTER (WHERE grandfathered_at IS NULL)     AS not_yet_grandfathered,
  COUNT(*)                                             AS total_lcb_rows
FROM learner_credit_balances
WHERE school_id = 1;

-- ── 3. The candidate set the migration would touch ───────────────────────
-- This is the exact UPDATE WHERE the endpoint will run with. Eyeball each
-- row before posting:
--   • balance_minutes > 0 (something to grandfather)
--   • no per-pair credit_transactions row (the pure-legacy shape)
--   • not already grandfathered
SELECT
  lcb.learner_id,
  lcb.instructor_id,
  lcb.balance_minutes,
  lcb.grandfathered_at,
  lcb.updated_at,
  lu.email,
  lu.name,
  COALESCE((
    SELECT COUNT(*)::int FROM credit_transactions ct
     WHERE ct.school_id     = lcb.school_id
       AND ct.learner_id    = lcb.learner_id
       AND ct.instructor_id = lcb.instructor_id
  ), 0) AS scoped_ct_count,
  COALESCE((
    SELECT SUM(ct.minutes)::int FROM credit_transactions ct
     WHERE ct.school_id     = lcb.school_id
       AND ct.learner_id    = lcb.learner_id
       AND ct.instructor_id = lcb.instructor_id
  ), 0) AS scoped_ct_minutes
FROM learner_credit_balances lcb
LEFT JOIN learner_users lu ON lu.id = lcb.learner_id
WHERE lcb.school_id        = 1
  AND lcb.balance_minutes  > 0
  AND lcb.grandfathered_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM credit_transactions ct
     WHERE ct.school_id     = lcb.school_id
       AND ct.learner_id    = lcb.learner_id
       AND ct.instructor_id = lcb.instructor_id
  )
ORDER BY lcb.balance_minutes DESC, lcb.learner_id, lcb.instructor_id;

-- ── 4. Step 2c marker correlation — supporting evidence only ─────────────
-- The candidates above, filtered to those whose lcb.updated_at sits within
-- ±60s of the per_instructor_credits_step_2c marker.completed_at. This is
-- NOT used in the predicate (Step 2c's backfill INSERT and marker write
-- weren't in a single transaction), but a near-100% match is a strong
-- audit signal that the candidates are indeed Step 2c artefacts.
SELECT
  COUNT(*) AS candidates_within_step_2c_marker_window
FROM learner_credit_balances lcb
JOIN migration_markers mm ON mm.key = 'per_instructor_credits_step_2c'
WHERE lcb.school_id        = 1
  AND lcb.balance_minutes  > 0
  AND lcb.grandfathered_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM credit_transactions ct
     WHERE ct.school_id     = lcb.school_id
       AND ct.learner_id    = lcb.learner_id
       AND ct.instructor_id = lcb.instructor_id
  )
  AND lcb.updated_at BETWEEN mm.completed_at - interval '60 seconds'
                         AND mm.completed_at + interval '60 seconds';

-- ── 5. Mixed-state rows we are deliberately NOT grandfathering ───────────
-- Pairs where LCB > 0 AND credit_transactions exists for the pair. Plan A
-- leaves these to the divergence cron. After they're manually resolved
-- the operator may UPDATE grandfathered_at by hand if appropriate.
SELECT
  lcb.learner_id,
  lcb.instructor_id,
  lcb.balance_minutes,
  COALESCE((
    SELECT SUM(ct.minutes)::int FROM credit_transactions ct
     WHERE ct.school_id     = lcb.school_id
       AND ct.learner_id    = lcb.learner_id
       AND ct.instructor_id = lcb.instructor_id
  ), 0) AS scoped_ct_minutes
FROM learner_credit_balances lcb
WHERE lcb.school_id        = 1
  AND lcb.balance_minutes  > 0
  AND lcb.grandfathered_at IS NULL
  AND EXISTS (
    SELECT 1 FROM credit_transactions ct
     WHERE ct.school_id     = lcb.school_id
       AND ct.learner_id    = lcb.learner_id
       AND ct.instructor_id = lcb.instructor_id
  )
ORDER BY lcb.balance_minutes DESC;
