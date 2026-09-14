-- Booking-credit attribution is accounting history. A duration correction must
-- be able to retire an incorrect active attribution and append a corrected row
-- for the same booking/source pair without rewriting the original values.
--
-- The original table constraint made the pair unique forever, including after
-- refunded_at had retired the old row. Replace it with active-row uniqueness:
-- exactly one current attribution per booking/source pair, while preserving
-- returned/superseded history. Runtime INSERTs use conflict-agnostic
-- ON CONFLICT DO NOTHING so Postgres can infer this partial arbiter safely.

DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT constraint_row.conname
    INTO constraint_name
    FROM pg_constraint constraint_row
   WHERE constraint_row.conrelid = 'booking_credit_sources'::regclass
     AND constraint_row.contype = 'u'
     AND pg_get_constraintdef(constraint_row.oid) = 'UNIQUE (booking_id, credit_transaction_id)'
   LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE booking_credit_sources DROP CONSTRAINT %I',
      constraint_name
    );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bcs_active_booking_source
  ON booking_credit_sources(booking_id, credit_transaction_id)
  WHERE refunded_at IS NULL;
