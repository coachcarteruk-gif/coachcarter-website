-- Optional instructor-created unpaid hold for one existing learner and one slot.
-- The ordinary lesson-offer contract remains unchanged when pencilled = FALSE.
ALTER TABLE lesson_offers
  ADD COLUMN IF NOT EXISTS pencilled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE lesson_offers
  ADD COLUMN IF NOT EXISTS checkout_attempt_id UUID;
ALTER TABLE lesson_offers
  ADD COLUMN IF NOT EXISTS checkout_attempt_started_at TIMESTAMPTZ;
ALTER TABLE lesson_offers
  ADD COLUMN IF NOT EXISTS checkout_attempt_payload JSONB;

ALTER TABLE lesson_offers
  DROP CONSTRAINT IF EXISTS lesson_offers_pencilled_shape_check;
ALTER TABLE lesson_offers
  ADD CONSTRAINT lesson_offers_pencilled_shape_check CHECK (
    pencilled = FALSE OR (
      kind = 'manual'
      AND (status <> 'pending' OR learner_id IS NOT NULL)
      AND scheduled_date IS NOT NULL
      AND start_time IS NOT NULL
      AND end_time IS NOT NULL
      AND start_time < end_time
      AND extension_booking_id IS NULL
      AND COALESCE(max_repeat_weeks, 1) = 1
      AND offer_price_pence > 0
    )
  );

CREATE INDEX IF NOT EXISTS idx_lesson_offers_pencilled_learner_pending
  ON lesson_offers(school_id, learner_id, expires_at)
  WHERE pencilled = TRUE AND status = 'pending';

ALTER TABLE refund_events DROP CONSTRAINT IF EXISTS refund_events_refund_type_check;
ALTER TABLE refund_events
  ADD CONSTRAINT refund_events_refund_type_check CHECK (
    refund_type IN ('credit_purchase', 'repeat_offer_partial', 'direct_slot', 'direct_offer',
                    'manual_record', 'booking_extension_unfulfilled',
                    'pencilled_offer_unfulfilled')
  );

-- All writers of calendar-shaped rows share this key before an active pencil
-- is checked or mutated. The application takes the same lock during pencil
-- creation and fulfilment. Ordinary rows are otherwise left unchanged.
CREATE OR REPLACE FUNCTION lock_pencilled_slot_day(
  p_school_id INTEGER,
  p_instructor_id INTEGER,
  p_date DATE
) RETURNS VOID AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(
    p_school_id,
    hashtext(p_instructor_id::text || ':' || p_date::text)
  );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION guard_calendar_row_against_pencilled_offer()
RETURNS TRIGGER AS $$
DECLARE
  v_school_id INTEGER;
  v_instructor_id INTEGER;
  v_date DATE;
  v_old_school_id INTEGER;
  v_old_instructor_id INTEGER;
  v_old_date DATE;
  v_start TIME;
  v_end TIME;
  v_active BOOLEAN;
BEGIN
  v_school_id := NEW.school_id;
  v_instructor_id := NEW.instructor_id;
  v_start := NEW.start_time;
  v_end := NEW.end_time;
  IF TG_TABLE_NAME = 'instructor_busy_blocks' THEN
    v_date := NEW.block_date;
    IF TG_OP = 'UPDATE' THEN
      v_old_school_id := OLD.school_id;
      v_old_instructor_id := OLD.instructor_id;
      v_old_date := OLD.block_date;
    END IF;
  ELSE
    v_date := NEW.scheduled_date;
    IF TG_OP = 'UPDATE' THEN
      v_old_school_id := OLD.school_id;
      v_old_instructor_id := OLD.instructor_id;
      v_old_date := OLD.scheduled_date;
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'lesson_bookings' THEN
    v_active := NEW.status IN ('scheduled', 'chargeable');
  ELSIF TG_TABLE_NAME = 'lesson_requests' THEN
    v_active := NEW.status = 'pending' AND NEW.expires_at > clock_timestamp();
  ELSIF TG_TABLE_NAME = 'slot_reservations' THEN
    v_active := NEW.expires_at > clock_timestamp();
  ELSIF TG_TABLE_NAME = 'recurring_slot_block_items' THEN
    v_active := NEW.status IN ('held', 'booked');
  ELSIF TG_TABLE_NAME = 'lesson_offers' THEN
    v_active := NEW.status = 'pending' AND NEW.expires_at > clock_timestamp();
  ELSIF TG_TABLE_NAME = 'instructor_busy_blocks' THEN
    v_active := TRUE;
  ELSE
    v_active := FALSE;
  END IF;
  IF NOT v_active THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE'
     AND (v_old_school_id, v_old_instructor_id, v_old_date)
         IS DISTINCT FROM (v_school_id, v_instructor_id, v_date) THEN
    IF (v_old_school_id, v_old_instructor_id, v_old_date)
       < (v_school_id, v_instructor_id, v_date) THEN
      PERFORM lock_pencilled_slot_day(v_old_school_id, v_old_instructor_id, v_old_date);
      PERFORM lock_pencilled_slot_day(v_school_id, v_instructor_id, v_date);
    ELSE
      PERFORM lock_pencilled_slot_day(v_school_id, v_instructor_id, v_date);
      PERFORM lock_pencilled_slot_day(v_old_school_id, v_old_instructor_id, v_old_date);
    END IF;
  ELSE
    PERFORM lock_pencilled_slot_day(v_school_id, v_instructor_id, v_date);
  END IF;
  IF TG_TABLE_NAME = 'lesson_offers'
     AND COALESCE((to_jsonb(NEW)->>'pencilled')::boolean, FALSE) = TRUE
     AND EXISTS (
    SELECT 1 FROM lesson_bookings booking
     WHERE booking.school_id=v_school_id AND booking.instructor_id=v_instructor_id
       AND booking.scheduled_date=v_date AND booking.status IN ('scheduled','chargeable')
       AND booking.start_time<v_end AND booking.end_time>v_start
    UNION ALL
    SELECT 1 FROM lesson_requests request
     WHERE request.school_id=v_school_id AND request.instructor_id=v_instructor_id
       AND request.scheduled_date=v_date AND request.status='pending'
       AND request.expires_at>clock_timestamp()
       AND request.start_time<v_end AND request.end_time>v_start
    UNION ALL
    SELECT 1 FROM slot_reservations reservation
     WHERE reservation.school_id=v_school_id AND reservation.instructor_id=v_instructor_id
       AND reservation.scheduled_date=v_date AND reservation.expires_at>clock_timestamp()
       AND reservation.start_time<v_end AND reservation.end_time>v_start
    UNION ALL
    SELECT 1 FROM recurring_slot_block_items item
     WHERE item.school_id=v_school_id AND item.instructor_id=v_instructor_id
       AND item.scheduled_date=v_date AND item.status IN ('held','booked')
       AND item.start_time<v_end AND item.end_time>v_start
    UNION ALL
    SELECT 1 FROM instructor_busy_blocks busy
     WHERE busy.school_id=v_school_id AND busy.instructor_id=v_instructor_id
       AND busy.block_date=v_date
       AND busy.start_time<v_end AND busy.end_time>v_start
  ) THEN
    RAISE EXCEPTION 'pencilled offer conflicts with active calendar row'
      USING ERRCODE = '23P01';
  END IF;
  IF EXISTS (
    SELECT 1 FROM lesson_offers offer
     WHERE offer.school_id = v_school_id
       AND offer.instructor_id = v_instructor_id
       AND offer.scheduled_date = v_date
       AND offer.pencilled = TRUE
       AND offer.status = 'pending'
       AND offer.expires_at > clock_timestamp()
       AND (TG_TABLE_NAME <> 'lesson_offers' OR offer.id <> NEW.id)
       AND offer.start_time < v_end
       AND offer.end_time > v_start
  ) THEN
    RAISE EXCEPTION 'active pencilled offer conflicts with calendar row'
      USING ERRCODE = '23P01';
  END IF;
  -- If this writer waited behind a pencilled-offer fulfilment, the pencil is
  -- accepted by the time the advisory lock is released and is therefore no
  -- longer caught by the active-pending check above. Protect only bookings
  -- created by accepted pencils; ordinary booking-vs-booking behaviour stays
  -- unchanged. Exclude the linked booking itself so its normal updates work.
  IF EXISTS (
    SELECT 1
      FROM lesson_offers offer
      JOIN lesson_bookings booking
        ON booking.id = offer.booking_id
       AND booking.school_id = offer.school_id
     WHERE offer.school_id = v_school_id
       AND offer.pencilled = TRUE
       AND offer.status = 'accepted'
       AND booking.instructor_id = v_instructor_id
       AND booking.scheduled_date = v_date
       AND booking.status IN ('scheduled','chargeable')
       AND (TG_TABLE_NAME <> 'lesson_bookings' OR booking.id <> NEW.id)
       AND booking.start_time < v_end
       AND booking.end_time > v_start
  ) THEN
    RAISE EXCEPTION 'fulfilled pencilled offer conflicts with calendar row'
      USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_booking_pencilled_guard ON lesson_bookings;
CREATE TRIGGER trg_booking_pencilled_guard
  BEFORE INSERT OR UPDATE OF school_id, instructor_id, scheduled_date, start_time, end_time, status
  ON lesson_bookings FOR EACH ROW EXECUTE FUNCTION guard_calendar_row_against_pencilled_offer();

DROP TRIGGER IF EXISTS trg_request_pencilled_guard ON lesson_requests;
CREATE TRIGGER trg_request_pencilled_guard
  BEFORE INSERT OR UPDATE OF school_id, instructor_id, scheduled_date, start_time, end_time, status, expires_at
  ON lesson_requests FOR EACH ROW EXECUTE FUNCTION guard_calendar_row_against_pencilled_offer();

DROP TRIGGER IF EXISTS trg_reservation_pencilled_guard ON slot_reservations;
CREATE TRIGGER trg_reservation_pencilled_guard
  BEFORE INSERT OR UPDATE OF school_id, instructor_id, scheduled_date, start_time, end_time, expires_at
  ON slot_reservations FOR EACH ROW EXECUTE FUNCTION guard_calendar_row_against_pencilled_offer();

DROP TRIGGER IF EXISTS trg_recurring_item_pencilled_guard ON recurring_slot_block_items;
CREATE TRIGGER trg_recurring_item_pencilled_guard
  BEFORE INSERT OR UPDATE OF school_id, instructor_id, scheduled_date, start_time, end_time, status
  ON recurring_slot_block_items FOR EACH ROW EXECUTE FUNCTION guard_calendar_row_against_pencilled_offer();

DROP TRIGGER IF EXISTS trg_offer_pencilled_guard ON lesson_offers;
CREATE TRIGGER trg_offer_pencilled_guard
  BEFORE INSERT OR UPDATE OF school_id, instructor_id, scheduled_date, start_time, end_time, status, expires_at
  ON lesson_offers FOR EACH ROW EXECUTE FUNCTION guard_calendar_row_against_pencilled_offer();

DROP TRIGGER IF EXISTS trg_busy_block_pencilled_guard ON instructor_busy_blocks;
CREATE TRIGGER trg_busy_block_pencilled_guard
  BEFORE INSERT OR UPDATE OF school_id, instructor_id, block_date, start_time, end_time
  ON instructor_busy_blocks FOR EACH ROW EXECUTE FUNCTION guard_calendar_row_against_pencilled_offer();
