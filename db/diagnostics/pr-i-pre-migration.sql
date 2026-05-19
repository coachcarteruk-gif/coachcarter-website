-- PR-I pre-migration diagnostics (audit #15 — cron overlap guards)
--
-- Run this before applying the cron_locks migration. Expected output: zero
-- rows on every query. If the table already exists (from a partial migration
-- attempt or a hand-rolled prototype), the migration's CREATE TABLE IF NOT
-- EXISTS is a no-op — so this script is purely informational.

-- 1. cron_locks table existence (expect: 0 rows pre-migration)
SELECT 'cron_locks_exists' AS check, COUNT(*)::int AS row_count
  FROM information_schema.tables
 WHERE table_schema = 'public'
   AND table_name   = 'cron_locks';

-- 2. cron_locks index existence (expect: 0 rows pre-migration)
SELECT 'idx_cron_locks_expires_at_exists' AS check, COUNT(*)::int AS row_count
  FROM pg_indexes
 WHERE schemaname = 'public'
   AND indexname  = 'idx_cron_locks_expires_at';
