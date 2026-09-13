-- Flexible Hours allocations are append-only. A historical allocation that is
-- returned after a duration correction must therefore be followed by a new
-- allocation against the same source and booking; rewriting the original row
-- would destroy the frozen-value evidence.
--
-- Migration 050's unique (school_id, source_id, booking_id) constraint made
-- that safe history-preserving repair impossible. Drop only that exact unique
-- constraint and retain a normal lookup index. Runtime writers still serialize
-- source allocation under row/advisory locks and allocation returns remain
-- exactly-once through UNIQUE(allocation_id).

DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT constraint_row.conname
    INTO constraint_name
    FROM pg_constraint constraint_row
   WHERE constraint_row.conrelid = 'flexible_package_booking_allocations'::regclass
     AND constraint_row.contype = 'u'
     AND pg_get_constraintdef(constraint_row.oid) = 'UNIQUE (school_id, source_id, booking_id)'
   LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE flexible_package_booking_allocations DROP CONSTRAINT %I',
      constraint_name
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_flexible_allocations_source_booking
  ON flexible_package_booking_allocations(school_id, source_id, booking_id);
