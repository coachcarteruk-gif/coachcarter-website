-- Step 5 BCS school_id pre-migration diagnostics.
-- Read-only. Safe to run before applying db/migration.sql.

SELECT
  EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'booking_credit_sources'
       AND column_name = 'school_id'
  ) AS bcs_school_id_exists,
  (
    SELECT COUNT(*)::int
      FROM booking_credit_sources
  ) AS bcs_rows
WHERE EXISTS (
  SELECT 1 FROM information_schema.tables
   WHERE table_schema = 'public'
     AND table_name = 'booking_credit_sources'
);

SELECT
  COALESCE(lb.school_id, ct.school_id, 1) AS expected_bcs_school_id,
  COUNT(*)::int AS row_count
FROM booking_credit_sources bcs
JOIN lesson_bookings lb ON lb.id = bcs.booking_id
LEFT JOIN credit_transactions ct ON ct.id = bcs.credit_transaction_id
GROUP BY COALESCE(lb.school_id, ct.school_id, 1)
ORDER BY expected_bcs_school_id;

SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'booking_credit_sources'
  AND indexname = 'idx_bcs_school';
