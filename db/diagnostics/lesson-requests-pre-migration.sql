-- Lesson requests ("request to book") — PRE-migration checks
-- Run against prod BEFORE /api/migrate. All checks should pass trivially:
-- the migration only adds a new table, a new boolean column, and widens the
-- credit_transactions type CHECK to a superset. Nothing rewrites data.

-- 1. Table must not exist yet (expect: NULL)
SELECT to_regclass('public.lesson_requests') AS lesson_requests_table;

-- 2. Toggle column must not exist yet (expect: 0 rows)
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'instructors' AND column_name = 'request_to_book';

-- 3. Current live definition of the CT type constraint (record it; the
--    migration drops + re-adds with 'request_hold'/'request_refund' appended)
SELECT pg_get_constraintdef(oid) AS current_def
  FROM pg_constraint
 WHERE conname = 'credit_transactions_type_check';

-- 4. No rows already using the new types (expect: 0 — would indicate the
--    constraint was hot-patched wider than the repo again)
SELECT COUNT(*) AS rows_with_new_types
  FROM credit_transactions
 WHERE type IN ('request_hold', 'request_refund');

-- 5. Distinct types in use must all be inside the NEW list, or the re-add
--    will fail mid-migration (expect: 0 rows)
SELECT type, COUNT(*)
  FROM credit_transactions
 WHERE type NOT IN (
   'purchase','refund','slot_purchase','edit_adjustment','admin_add',
   'admin_remove','referral_bonus','referral_reward','free_trial',
   'legacy_grandfather','request_hold','request_refund')
 GROUP BY type;
