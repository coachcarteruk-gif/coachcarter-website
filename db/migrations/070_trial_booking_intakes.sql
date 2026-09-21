-- Additive; activation is separately authorised through school config.
ALTER TABLE learner_users ADD COLUMN IF NOT EXISTS test_booked BOOLEAN;
ALTER TABLE learner_users ADD COLUMN IF NOT EXISTS test_details_updated_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS uq_trial_booking_school_id ON lesson_bookings(school_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_trial_learner_school_id ON learner_users(school_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_trial_instructor_school_id ON instructors(school_id, id);
CREATE TABLE IF NOT EXISTS trial_booking_intakes (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  booking_id INTEGER NOT NULL,
  learner_id INTEGER NOT NULL,
  instructor_id INTEGER NOT NULL,
  booked_at TIMESTAMPTZ NOT NULL,
  booking_local_date DATE NOT NULL,
  school_timezone TEXT NOT NULL,
  test_booked BOOLEAN,
  test_date_snapshot DATE,
  test_centre_snapshot TEXT,
  segment TEXT NOT NULL CHECK (segment IN ('within_4_calendar_months','over_4_calendar_months','not_booked','unknown')),
  segment_version TEXT NOT NULL CHECK (segment_version = 'test_date_v1'),
  entry_page TEXT NOT NULL CHECK (entry_page IN ('test_booked','freetrial','free_direct','unknown')),
  campaign_key TEXT CHECK (campaign_key = 'test_booked_v1'),
  content_version TEXT CHECK (content_version IN ('text_v1','video_v1')),
  analytics_consent_at_booking BOOLEAN NOT NULL,
  UNIQUE (school_id, booking_id),
  FOREIGN KEY (school_id, booking_id) REFERENCES lesson_bookings(school_id, id),
  FOREIGN KEY (school_id, learner_id) REFERENCES learner_users(school_id, id),
  FOREIGN KEY (school_id, instructor_id) REFERENCES instructors(school_id, id),
  CHECK (test_booked IS TRUE OR (test_date_snapshot IS NULL AND test_centre_snapshot IS NULL)),
  CHECK (test_centre_snapshot IS NULL OR length(test_centre_snapshot) <= 160),
  CHECK (test_date_snapshot IS NULL OR test_date_snapshot >= booking_local_date)
);
CREATE INDEX IF NOT EXISTS idx_trial_intake_cohort ON trial_booking_intakes(school_id, booked_at, segment);
CREATE INDEX IF NOT EXISTS idx_trial_intake_learner ON trial_booking_intakes(school_id, learner_id);
CREATE INDEX IF NOT EXISTS idx_trial_intake_instructor ON trial_booking_intakes(school_id, instructor_id);
CREATE INDEX IF NOT EXISTS idx_trial_intake_local_cohort ON trial_booking_intakes(school_id, booking_local_date, instructor_id);
CREATE OR REPLACE FUNCTION guard_trial_booking_intake() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'Trial intake is immutable'; END IF;
  -- Snapshot must describe its original same-school booking, not a replacement.
  IF NOT EXISTS (SELECT 1 FROM lesson_bookings b WHERE b.school_id = NEW.school_id
    AND b.id = NEW.booking_id AND b.learner_id = NEW.learner_id
    AND b.instructor_id = NEW.instructor_id AND b.rescheduled_from IS NULL) THEN
    RAISE EXCEPTION 'Invalid trial intake association';
  END IF;
  NEW.booking_local_date := (NEW.booked_at AT TIME ZONE NEW.school_timezone)::date;
  NEW.segment := CASE WHEN NEW.test_booked IS FALSE THEN 'not_booked'
    WHEN NEW.test_booked IS NOT TRUE OR NEW.test_date_snapshot IS NULL THEN 'unknown'
    WHEN NEW.test_date_snapshot <= (NEW.booking_local_date + interval '4 months')::date THEN 'within_4_calendar_months'
    ELSE 'over_4_calendar_months' END;
  NEW.segment_version := 'test_date_v1';
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trial_booking_intake_guard ON trial_booking_intakes;
CREATE TRIGGER trial_booking_intake_guard BEFORE INSERT OR UPDATE ON trial_booking_intakes
FOR EACH ROW EXECUTE FUNCTION guard_trial_booking_intake();

-- Preserve inherited runtime access without granting profile readers mutations.
DO $trial_intake_access$
DECLARE reader RECORD;
BEGIN
  FOR reader IN SELECT r.oid, r.rolname FROM pg_roles r
    WHERE has_table_privilege(r.oid, 'public.lesson_bookings', 'SELECT')
      AND has_table_privilege(r.oid, 'public.learner_users', 'SELECT')
  LOOP
    EXECUTE format('GRANT SELECT ON public.trial_booking_intakes TO %I', reader.rolname);
    IF has_table_privilege(reader.oid, 'public.lesson_bookings', 'INSERT') THEN
      EXECUTE format('GRANT INSERT ON public.trial_booking_intakes TO %I', reader.rolname);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.trial_booking_intakes_id_seq TO %I', reader.rolname);
    END IF;
    IF has_table_privilege(reader.oid, 'public.learner_users', 'DELETE') THEN
      EXECUTE format('GRANT DELETE ON public.trial_booking_intakes TO %I', reader.rolname);
    END IF;
  END LOOP;
END $trial_intake_access$;
