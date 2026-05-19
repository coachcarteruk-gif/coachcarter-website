-- PR-K pre-migration diagnostics
-- Audit: REMEDIATION_PLAN_TRIAGED.md item #16
-- Run BEFORE merging PR-K and triggering /api/migrate.
--
-- This migration:
--   1. Adds lesson_bookings.learner_anonymized BOOLEAN DEFAULT FALSE
--   2. Drops the existing ON DELETE CASCADE FK on lesson_bookings.learner_id
--   3. Makes lesson_bookings.learner_id nullable
--   4. Re-adds the FK as ON DELETE SET NULL
--
-- All four steps are idempotent and safe to re-run.

-- ── 1. Confirm the current FK behaviour is what we expect ──────────────────────
-- Should return one row with delete_rule = 'CASCADE'. After migration this
-- becomes 'SET NULL'.
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

-- ── 2. Confirm column is currently NOT NULL ────────────────────────────────────
-- Should return is_nullable = 'NO'. After migration this becomes 'YES'.
SELECT column_name, is_nullable, data_type
FROM information_schema.columns
WHERE table_name = 'lesson_bookings' AND column_name = 'learner_id';

-- ── 3. Confirm column does NOT yet exist ───────────────────────────────────────
-- Should return zero rows. After migration this returns one row.
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'lesson_bookings' AND column_name = 'learner_anonymized';

-- ── 4. Sanity counts — should be stable across the migration ───────────────────
-- These row counts should not change after the migration (no data deleted).
SELECT
  (SELECT COUNT(*) FROM lesson_bookings)                          AS total_bookings,
  (SELECT COUNT(*) FROM lesson_bookings WHERE learner_id IS NULL) AS bookings_with_null_learner;

-- Expected: total_bookings unchanged before/after; bookings_with_null_learner = 0 before, possibly >0 after future learner deletes.
