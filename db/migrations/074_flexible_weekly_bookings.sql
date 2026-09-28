-- A weekly batch is still a set of ordinary, independently managed package
-- bookings. Its immutable retry receipt lives in flexible_package_state_events.
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS flexible_package_weekly_request_id UUID;
CREATE INDEX IF NOT EXISTS idx_flexible_weekly_bookings
  ON lesson_bookings(school_id, learner_id, flexible_package_weekly_request_id)
  WHERE flexible_package_weekly_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_flexible_weekly_request
  ON flexible_package_state_events(school_id, learner_id, (detail->>'client_request_id'))
  WHERE event_type = 'weekly_bookings_created';

-- All booking/hold writers share this lock, so a different start time cannot
-- race a weekly batch's overlap recheck. Only overlaps involving a new weekly
-- package booking are newly refused; no historical rows are rewritten.
CREATE OR REPLACE FUNCTION guard_flexible_weekly_overlap() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  row_data JSONB := to_jsonb(NEW);
  is_booking BOOLEAN := TG_TABLE_NAME = 'lesson_bookings';
  row_date DATE := (row_data->>'scheduled_date')::date;
  weekly BOOLEAN := row_data->>'flexible_package_weekly_request_id' IS NOT NULL;
BEGIN
  IF is_booking THEN
    IF NEW.status NOT IN ('scheduled','chargeable') THEN RETURN NEW; END IF;
    -- Existing rescheduling inserts the replacement before terminalising the
    -- old booking in the same transaction. Carry protection to its replacement.
    IF NEW.payment_method='flexible_package' AND NEW.rescheduled_from IS NOT NULL THEN
      SELECT b.flexible_package_weekly_request_id INTO NEW.flexible_package_weekly_request_id
        FROM lesson_bookings b WHERE b.id=NEW.rescheduled_from AND b.school_id=NEW.school_id
          AND b.learner_id=NEW.learner_id AND b.payment_method='flexible_package';
      weekly := NEW.flexible_package_weekly_request_id IS NOT NULL;
    END IF;
  ELSIF TG_TABLE_NAME = 'slot_reservations' THEN
    IF NEW.expires_at <= NOW() THEN RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME = 'recurring_slot_block_items' THEN
    IF NEW.status <> 'held' OR NOT EXISTS (
      SELECT 1 FROM recurring_slot_blocks b WHERE b.id=NEW.block_id
        AND b.school_id=NEW.school_id AND b.status='pending_payment' AND b.expires_at>NOW()
    ) THEN RETURN NEW; END IF;
  ELSE
    IF NEW.status <> 'pending' OR NEW.expires_at <= NOW() THEN RETURN NEW; END IF;
  END IF;
  IF NEW.instructor_id IS NULL OR row_date IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('flexible-weekly:' || NEW.school_id::text || ':' || NEW.instructor_id::text, 0));
  IF EXISTS (
    SELECT 1 FROM lesson_bookings b
    WHERE b.school_id=NEW.school_id AND b.instructor_id=NEW.instructor_id
      AND b.scheduled_date=row_date AND b.status IN ('scheduled','chargeable')
      AND b.start_time<NEW.end_time AND b.end_time>NEW.start_time
      AND (NOT is_booking OR b.id<>NEW.id)
      AND NOT (is_booking AND weekly AND b.id=COALESCE((row_data->>'rescheduled_from')::integer,0)
        AND b.learner_id=(row_data->>'learner_id')::integer)
      AND (weekly OR b.flexible_package_weekly_request_id IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'Flexible weekly slot unavailable' USING ERRCODE='23P01';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION check_flexible_weekly_replacement() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- The temporary overlap allowed above must be gone when rescheduling commits.
  IF EXISTS (
    SELECT 1 FROM lesson_bookings replacement JOIN lesson_bookings previous
      ON previous.id=replacement.rescheduled_from AND previous.school_id=replacement.school_id
    WHERE replacement.id=NEW.id AND replacement.school_id=NEW.school_id
      AND replacement.flexible_package_weekly_request_id IS NOT NULL
      AND replacement.status IN ('scheduled','chargeable')
      AND previous.status IN ('scheduled','chargeable')
  ) THEN RAISE EXCEPTION 'Weekly replacement source is still active' USING ERRCODE='23P01'; END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS check_flexible_weekly_replacement ON lesson_bookings;
CREATE CONSTRAINT TRIGGER check_flexible_weekly_replacement AFTER INSERT OR UPDATE
  ON lesson_bookings DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_flexible_weekly_replacement();

DROP TRIGGER IF EXISTS guard_flexible_weekly_booking ON lesson_bookings;
CREATE TRIGGER guard_flexible_weekly_booking BEFORE INSERT OR UPDATE OF school_id,instructor_id,scheduled_date,start_time,end_time,status,flexible_package_weekly_request_id
  ON lesson_bookings FOR EACH ROW EXECUTE FUNCTION guard_flexible_weekly_overlap();
DROP TRIGGER IF EXISTS guard_flexible_weekly_reservation ON slot_reservations;
CREATE TRIGGER guard_flexible_weekly_reservation BEFORE INSERT OR UPDATE OF school_id,instructor_id,scheduled_date,start_time,end_time,expires_at
  ON slot_reservations FOR EACH ROW EXECUTE FUNCTION guard_flexible_weekly_overlap();
DROP TRIGGER IF EXISTS guard_flexible_weekly_offer ON lesson_offers;
CREATE TRIGGER guard_flexible_weekly_offer BEFORE INSERT OR UPDATE OF school_id,instructor_id,scheduled_date,start_time,end_time,status,expires_at
  ON lesson_offers FOR EACH ROW EXECUTE FUNCTION guard_flexible_weekly_overlap();
DROP TRIGGER IF EXISTS guard_flexible_weekly_request ON lesson_requests;
CREATE TRIGGER guard_flexible_weekly_request BEFORE INSERT OR UPDATE OF school_id,instructor_id,scheduled_date,start_time,end_time,status,expires_at
  ON lesson_requests FOR EACH ROW EXECUTE FUNCTION guard_flexible_weekly_overlap();
DROP TRIGGER IF EXISTS guard_flexible_weekly_hold ON recurring_slot_block_items;
CREATE TRIGGER guard_flexible_weekly_hold BEFORE INSERT OR UPDATE OF school_id,instructor_id,scheduled_date,start_time,end_time,status
  ON recurring_slot_block_items FOR EACH ROW EXECUTE FUNCTION guard_flexible_weekly_overlap();
