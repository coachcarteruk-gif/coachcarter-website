-- Paid booking extensions reuse the existing lesson-offer acceptance surface,
-- but settle onto an existing booking instead of creating an adjacent booking.
ALTER TABLE lesson_offers
  ADD COLUMN IF NOT EXISTS extension_booking_id INTEGER,
  ADD COLUMN IF NOT EXISTS extension_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS extension_base_list_price_pence INTEGER;

ALTER TABLE lesson_offers
  DROP CONSTRAINT IF EXISTS lesson_offers_extension_booking_school_fkey;
ALTER TABLE lesson_offers
  ADD CONSTRAINT lesson_offers_extension_booking_school_fkey
  FOREIGN KEY (extension_booking_id, school_id)
  REFERENCES lesson_bookings(id, school_id);

ALTER TABLE lesson_offers
  DROP CONSTRAINT IF EXISTS lesson_offers_extension_shape_check;
ALTER TABLE lesson_offers
  ADD CONSTRAINT lesson_offers_extension_shape_check CHECK (
    (extension_booking_id IS NULL AND extension_minutes IS NULL AND extension_base_list_price_pence IS NULL)
    OR
    (extension_booking_id IS NOT NULL
      AND extension_minutes IS NOT NULL
      AND extension_base_list_price_pence IS NOT NULL
      AND extension_minutes BETWEEN 30 AND 180 AND extension_minutes % 30 = 0
      AND extension_base_list_price_pence >= 0)
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_lesson_offers_pending_extension
  ON lesson_offers(extension_booking_id)
  WHERE status = 'pending' AND extension_booking_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lesson_offers_extension_booking
  ON lesson_offers(extension_booking_id)
  WHERE extension_booking_id IS NOT NULL;

-- A paid extension that loses an invalidation race is refunded through the
-- existing append-only refund ledger. The processing state is the durable
-- provider-call intent; manual_review records a failed automatic attempt.
ALTER TABLE refund_events DROP CONSTRAINT IF EXISTS refund_events_refund_type_check;
ALTER TABLE refund_events
  ADD CONSTRAINT refund_events_refund_type_check CHECK (
    refund_type IN ('credit_purchase', 'repeat_offer_partial', 'direct_slot', 'direct_offer',
                    'manual_record', 'booking_extension_unfulfilled')
  );

ALTER TABLE refund_events DROP CONSTRAINT IF EXISTS refund_events_status_check;
ALTER TABLE refund_events
  ADD CONSTRAINT refund_events_status_check CHECK (
    status IN ('previewed', 'processing', 'manual_review', 'blocked', 'executed')
  );
