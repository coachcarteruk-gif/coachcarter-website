-- Additive and inactive until an explicitly configured school enables the questionnaire.
CREATE UNIQUE INDEX IF NOT EXISTS uq_trial_enquiry_school ON enquiries(school_id,id);
CREATE TABLE IF NOT EXISTS trial_requests (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  enquiry_id INTEGER NOT NULL,
  submission_key UUID NOT NULL,
  contact_key TEXT NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  postcode_area TEXT NOT NULL CHECK(length(postcode_area)<=8),
  availability JSONB NOT NULL CHECK(jsonb_typeof(availability)='array'),
  questionnaire JSONB NOT NULL CHECK(jsonb_typeof(questionnaire)='object'),
  funnel_context JSONB NOT NULL,
  reason TEXT NOT NULL CHECK(reason IN ('qualification','no_suitable_slots')),
  UNIQUE(school_id,id), UNIQUE(school_id,submission_key), UNIQUE(school_id,contact_key),
  FOREIGN KEY(school_id,enquiry_id) REFERENCES enquiries(school_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_trial_request_enquiry ON trial_requests(school_id,enquiry_id);
CREATE INDEX IF NOT EXISTS idx_trial_request_submitted ON trial_requests(school_id,submitted_at);
CREATE TABLE IF NOT EXISTS trial_request_bookings (
  school_id INTEGER NOT NULL REFERENCES schools(id),
  request_id BIGINT NOT NULL,
  booking_id INTEGER NOT NULL,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(school_id,request_id), UNIQUE(school_id,booking_id),
  FOREIGN KEY(school_id,request_id) REFERENCES trial_requests(school_id,id) ON DELETE CASCADE,
  FOREIGN KEY(school_id,booking_id) REFERENCES lesson_bookings(school_id,id)
);
ALTER TABLE trial_booking_intakes ADD COLUMN IF NOT EXISTS questionnaire JSONB;
ALTER TABLE trial_booking_intakes ADD COLUMN IF NOT EXISTS test_time_snapshot TEXT;
CREATE OR REPLACE FUNCTION guard_trial_request_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Trial request evidence is immutable';
END $$;
DROP TRIGGER IF EXISTS trial_request_immutable ON trial_requests;
CREATE TRIGGER trial_request_immutable BEFORE UPDATE ON trial_requests FOR EACH ROW EXECUTE FUNCTION guard_trial_request_evidence();
DROP TRIGGER IF EXISTS trial_request_booking_immutable ON trial_request_bookings;
CREATE TRIGGER trial_request_booking_immutable BEFORE UPDATE ON trial_request_bookings FOR EACH ROW EXECUTE FUNCTION guard_trial_request_evidence();
-- Allow a later manual booking to carry a real earlier request's original date.
DO $$ DECLARE c RECORD; BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='trial_booking_intakes'::regclass
    AND contype='c' AND pg_get_constraintdef(oid) LIKE '%test_date_snapshot >= booking_local_date%'
  LOOP EXECUTE format('ALTER TABLE trial_booking_intakes DROP CONSTRAINT %I',c.conname); END LOOP;
END $$;
CREATE OR REPLACE FUNCTION guard_trial_booking_intake() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE origin_date DATE;
BEGIN
  IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Trial intake is immutable'; END IF;
  IF NOT EXISTS (SELECT 1 FROM lesson_bookings b WHERE b.school_id=NEW.school_id AND b.id=NEW.booking_id
    AND b.learner_id=NEW.learner_id AND b.instructor_id=NEW.instructor_id AND b.rescheduled_from IS NULL) THEN
    RAISE EXCEPTION 'Invalid trial intake association';
  END IF;
  NEW.booking_local_date := (NEW.booked_at AT TIME ZONE NEW.school_timezone)::date;
  origin_date := COALESCE((NEW.questionnaire->>'captured_local_date')::date,NEW.booking_local_date);
  IF origin_date>NEW.booking_local_date OR NEW.test_date_snapshot<origin_date THEN RAISE EXCEPTION 'Invalid intake date'; END IF;
  NEW.segment := CASE WHEN NEW.test_booked IS FALSE THEN 'not_booked'
    WHEN NEW.test_booked IS NOT TRUE OR NEW.test_date_snapshot IS NULL THEN 'unknown'
    WHEN NEW.test_date_snapshot <= (origin_date+interval '4 months')::date THEN 'within_4_calendar_months'
    ELSE 'over_4_calendar_months' END;
  NEW.segment_version := 'test_date_v1';
  RETURN NEW;
END $$;
DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT rolname,oid FROM pg_roles WHERE has_table_privilege(oid,'public.enquiries','SELECT') LOOP
    EXECUTE format('GRANT SELECT ON trial_requests,trial_request_bookings TO %I',r.rolname);
    IF has_table_privilege(r.oid,'public.enquiries','INSERT') THEN
      EXECUTE format('GRANT INSERT ON trial_requests,trial_request_bookings TO %I',r.rolname);
      EXECUTE format('GRANT USAGE,SELECT ON SEQUENCE trial_requests_id_seq TO %I',r.rolname);
    END IF;
    IF has_table_privilege(r.oid,'public.enquiries','DELETE') THEN
      EXECUTE format('GRANT DELETE ON trial_requests,trial_request_bookings TO %I',r.rolname);
    END IF;
  END LOOP;
END $$;
