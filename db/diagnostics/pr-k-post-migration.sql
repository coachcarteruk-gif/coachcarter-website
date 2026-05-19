-- PR-K post-migration verification
-- Run AFTER GET /api/migrate?secret=... to confirm the migration landed.

-- ── 1. FK should now be ON DELETE SET NULL ─────────────────────────────────────
-- Expect one row with delete_rule = 'SET NULL'.
SELECT
  conname                                            AS constraint_name,
  pg_get_constraintdef(c.oid)                        AS definition,
  CASE c.confdeltype
    WHEN 'c' THEN 'CASCADE'
    WHEN 'n' THEN 'SET NULL'
    WHEN 'a' THEN 'NO ACTION'
    WHEN 'r' THEN 'RESTRICT'
    WHEN 'd' THEN 'SET DEFAULT'
  END                                                AS delete_rule
FROM pg_constraint c
JOIN pg_class t      ON t.oid = c.conrelid
WHERE t.relname = 'lesson_bookings'
  AND c.contype = 'f'
  AND pg_get_constraintdef(c.oid) ILIKE '%REFERENCES learner_users%';

-- ── 2. learner_id should now be nullable ───────────────────────────────────────
-- Expect is_nullable = 'YES'.
SELECT column_name, is_nullable, data_type
FROM information_schema.columns
WHERE table_name = 'lesson_bookings' AND column_name = 'learner_id';

-- ── 3. learner_anonymized column should now exist ──────────────────────────────
-- Expect one row, data_type = 'boolean', column_default = 'false'.
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'lesson_bookings' AND column_name = 'learner_anonymized';

-- ── 4. No existing row should be flagged anonymised yet ────────────────────────
-- Expect zero. Future learner deletions will populate this.
SELECT COUNT(*) AS anonymised_count
FROM lesson_bookings
WHERE learner_anonymized = TRUE;
