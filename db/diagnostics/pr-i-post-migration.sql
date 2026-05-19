-- PR-I post-migration diagnostics (audit #15 — cron overlap guards)
--
-- Run after hitting /api/migrate. Expected: cron_locks table + index both
-- present; row count starts at 0 and grows by ~1 per active cron run.

-- 1. cron_locks table exists (expect: 1)
SELECT 'cron_locks_exists' AS check, COUNT(*)::int AS row_count
  FROM information_schema.tables
 WHERE table_schema = 'public'
   AND table_name   = 'cron_locks';

-- 2. cron_locks index exists (expect: 1)
SELECT 'idx_cron_locks_expires_at_exists' AS check, COUNT(*)::int AS row_count
  FROM pg_indexes
 WHERE schemaname = 'public'
   AND indexname  = 'idx_cron_locks_expires_at';

-- 3. Currently held locks (expect: 0..N; should clear quickly).
-- Stale rows here = a cron crashed or was killed. They'll auto-clear when
-- expires_at passes NOW(), which the acquire path treats as releasable.
SELECT lock_key,
       acquired_at,
       expires_at,
       (expires_at < NOW()) AS is_expired,
       AGE(NOW(), acquired_at) AS held_for
  FROM cron_locks
 ORDER BY acquired_at DESC;

-- 4. Column shape sanity check
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name   = 'cron_locks'
 ORDER BY ordinal_position;
