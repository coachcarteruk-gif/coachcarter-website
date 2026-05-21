-- Step 5 BCS school_id post-migration diagnostics.
-- Read-only. Run after applying db/migration.sql.

SELECT
  c.column_name,
  c.is_nullable,
  c.column_default,
  c.data_type
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND c.table_name = 'booking_credit_sources'
  AND c.column_name = 'school_id';

SELECT
  conname,
  pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'booking_credit_sources'::regclass
  AND conname = 'booking_credit_sources_school_id_fkey';

SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'booking_credit_sources'
  AND indexname = 'idx_bcs_school';

SELECT
  COUNT(*)::int AS null_school_id_rows
FROM booking_credit_sources
WHERE school_id IS NULL;

SELECT
  bcs.id AS bcs_id,
  bcs.booking_id,
  bcs.credit_transaction_id,
  bcs.school_id AS bcs_school_id,
  lb.school_id AS booking_school_id,
  ct.school_id AS credit_transaction_school_id
FROM booking_credit_sources bcs
JOIN lesson_bookings lb ON lb.id = bcs.booking_id
LEFT JOIN credit_transactions ct ON ct.id = bcs.credit_transaction_id
WHERE bcs.school_id IS DISTINCT FROM COALESCE(lb.school_id, ct.school_id, 1)
ORDER BY bcs.id
LIMIT 50;
