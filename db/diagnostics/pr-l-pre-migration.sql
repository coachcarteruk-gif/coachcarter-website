-- PR-L pre-migration diagnostics
-- Audit: REMEDIATION_PLAN_TRIAGED.md item #17 (calendar_token rotation)
-- Run BEFORE merging PR-L and triggering /api/migrate.
--
-- The migration is a pure additive change: two nullable TIMESTAMPTZ columns,
-- one on `learner_users`, one on `instructors`. No data backfill. No
-- constraint changes. Safe to re-run.

-- ── 1. Columns should NOT yet exist on either table ────────────────────────────
-- Expect zero rows from each query before the migration.
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'learner_users' AND column_name = 'calendar_token_rotated_at';

SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'instructors' AND column_name = 'calendar_token_rotated_at';

-- ── 2. Sanity: confirm calendar_token columns already exist (we're augmenting,
--    not replacing). Expect one row from each.
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE column_name = 'calendar_token'
  AND table_name IN ('learner_users', 'instructors')
ORDER BY table_name;

-- ── 3. Snapshot: how many existing tokens will get the "pre-rotation" label?
-- Existing tokens have NULL rotated_at after the migration — the UI shows them
-- as "Active (pre-rotation)" until the user rotates or the lazy-issue path
-- re-touches them.
SELECT
  (SELECT COUNT(*) FROM learner_users WHERE calendar_token IS NOT NULL) AS learner_tokens,
  (SELECT COUNT(*) FROM instructors   WHERE calendar_token IS NOT NULL) AS instructor_tokens;
