-- Lesson requests ("request to book") — POST-migration verification

-- 1. Table exists (expect: 'lesson_requests')
SELECT to_regclass('public.lesson_requests') AS lesson_requests_table;

-- 2. Toggle column exists with correct default (expect: 1 row, default false)
SELECT column_name, column_default, is_nullable
  FROM information_schema.columns
 WHERE table_name = 'instructors' AND column_name = 'request_to_book';

-- 3. CT type constraint includes the two new types (expect def containing
--    'request_hold' and 'request_refund')
SELECT pg_get_constraintdef(oid) AS new_def
  FROM pg_constraint
 WHERE conname = 'credit_transactions_type_check';

-- 4. All expected indexes exist (expect: 8 rows incl. uq_request_slot)
SELECT indexname FROM pg_indexes
 WHERE tablename = 'lesson_requests'
 ORDER BY indexname;

-- 5. uq_request_slot is UNIQUE and partial on status='pending'
SELECT indexdef FROM pg_indexes
 WHERE indexname = 'uq_request_slot';

-- 6. school_id NOT NULL with default 1
SELECT column_name, column_default, is_nullable
  FROM information_schema.columns
 WHERE table_name = 'lesson_requests' AND column_name = 'school_id';
