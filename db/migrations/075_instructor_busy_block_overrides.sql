-- Instructor-confirmed busy blocks apply only to this pencilled offer's slot.
-- Existing offers retain an empty snapshot; no historical agreement is inferred.
ALTER TABLE lesson_offers
  ADD COLUMN IF NOT EXISTS busy_block_overrides JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE lesson_offers DROP CONSTRAINT IF EXISTS lesson_offers_busy_block_overrides_array;
ALTER TABLE lesson_offers ADD CONSTRAINT lesson_offers_busy_block_overrides_array
  CHECK (jsonb_typeof(busy_block_overrides) = 'array');

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
       AND NOT (COALESCE(to_jsonb(NEW)->'busy_block_overrides', '[]'::jsonb)
         @> jsonb_build_array(jsonb_build_object('id', busy.id,
           'start_time', busy.start_time::text, 'end_time', busy.end_time::text)))
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
