-- PR-L post-migration verification
-- Run AFTER GET /api/migrate?secret=... to confirm both columns landed.

-- ── 1. Both columns should now exist, nullable TIMESTAMPTZ ─────────────────────
-- Expect two rows, one per table. is_nullable = 'YES', data_type =
-- 'timestamp with time zone'.
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE column_name = 'calendar_token_rotated_at'
  AND table_name IN ('learner_users', 'instructors')
ORDER BY table_name;

-- ── 2. No backfill: every existing token has NULL rotated_at ───────────────────
-- Expect both counts to equal the matching token counts from the pre-migration
-- diagnostic. Future activity will populate these:
--   - lazy-issue path stamps NOW() on first generation
--   - rotate-token endpoint stamps NOW() on each rotation
SELECT
  (SELECT COUNT(*) FROM learner_users WHERE calendar_token IS NOT NULL AND calendar_token_rotated_at IS NULL) AS learner_unrotated,
  (SELECT COUNT(*) FROM instructors   WHERE calendar_token IS NOT NULL AND calendar_token_rotated_at IS NULL) AS instructor_unrotated;
