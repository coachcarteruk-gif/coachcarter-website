-- Post-migration verification for /api/migrate-step-2c-grandfather (Plan A).
-- Run after POSTing the endpoint to confirm the expected rows landed and
-- nothing else was touched.

-- ── 1. Marker landed ─────────────────────────────────────────────────────
SELECT key, completed_at, notes
  FROM migration_markers
 WHERE key = 'per_instructor_credits_step_2c_grandfather';

-- ── 2. How many rows are now grandfathered? ──────────────────────────────
-- Compare against the candidate_count reported by the dry-run pre-flight.
-- The two should match exactly (modulo any races where a Phase-2A writer
-- inserted a per-pair CT row between dry-run and POST — those rows would
-- legitimately be excluded by the UPDATE-time re-evaluation).
SELECT
  COUNT(*) FILTER (WHERE grandfathered_at IS NOT NULL) AS now_grandfathered,
  COUNT(*) FILTER (WHERE grandfathered_at IS NULL)     AS not_grandfathered,
  COUNT(*)                                             AS total_lcb_rows
FROM learner_credit_balances
WHERE school_id = 1;

-- ── 3. Sample of newly-grandfathered rows ────────────────────────────────
-- All rows updated in this run (grandfathered_at within the last hour).
SELECT
  lcb.learner_id,
  lcb.instructor_id,
  lcb.balance_minutes,
  lcb.grandfathered_at,
  lu.email,
  lu.name
FROM learner_credit_balances lcb
LEFT JOIN learner_users lu ON lu.id = lcb.learner_id
WHERE lcb.school_id = 1
  AND lcb.grandfathered_at > NOW() - interval '1 hour'
ORDER BY lcb.balance_minutes DESC;

-- ── 4. Invariant: every grandfathered row still has zero ledger ──────────
-- Any grandfathered row whose per-pair credit_transactions is non-empty
-- means a Phase-2A writer landed a CT row mid-migration. Worth checking,
-- but not necessarily an error: the cron's truth table will continue to
-- flag the row if expected_balance ≠ 0, so suppression remains conditional.
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
WHERE lcb.school_id = 1
  AND lcb.grandfathered_at IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM credit_transactions ct
     WHERE ct.school_id     = lcb.school_id
       AND ct.learner_id    = lcb.learner_id
       AND ct.instructor_id = lcb.instructor_id
  )
ORDER BY lcb.balance_minutes DESC;

-- ── 5. Trigger a dry-run of the cron to confirm Group A pairs cleared ────
-- (Run separately via curl — the cron isn't a SQL query. Expected response
-- shape after this migration:
--    drift_count: <much smaller>
--    grandfathered_count: <≈ rows_updated from the migration>
--
--   curl -H "Authorization: Bearer $CRON_SECRET" \
--        https://www.coachcarter.uk/api/cron-credit-reconcile
-- )
