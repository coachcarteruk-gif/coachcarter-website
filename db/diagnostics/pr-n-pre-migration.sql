-- PR-N pre-migration diagnostics
-- Audit: REMEDIATION_PLAN_TRIAGED.md item #19 (notification_log table)
-- Run BEFORE merging PR-N and triggering /api/migrate.
--
-- Pure additive migration: one new table + four indexes. No data backfill,
-- no FK changes on existing tables. Safe to re-run (CREATE TABLE IF NOT
-- EXISTS + CREATE INDEX IF NOT EXISTS).

-- ── 1. Table should NOT yet exist ─────────────────────────────────────────────
-- Expect zero rows.
SELECT table_name
FROM information_schema.tables
WHERE table_name = 'notification_log';

-- ── 2. Sanity: confirm referenced parent tables exist ─────────────────────────
-- Expect three rows (learner_users, instructors, schools).
SELECT table_name
FROM information_schema.tables
WHERE table_name IN ('learner_users', 'instructors', 'schools')
ORDER BY table_name;

-- ── 3. Confirm no name collision on indexes ───────────────────────────────────
-- Expect zero rows.
SELECT indexname
FROM pg_indexes
WHERE indexname IN (
  'idx_notif_log_school',
  'idx_notif_log_learner',
  'idx_notif_log_recipient',
  'idx_notif_log_failed'
);
