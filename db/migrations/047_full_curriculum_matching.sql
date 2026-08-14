-- Full Curriculum matching, instructor assignment and agreed availability.
--
-- This migration is additive and inert. It creates no bookings, Lesson Credit,
-- refunds, earnings, transfers or payouts, and it enables no feature flag.

CREATE UNIQUE INDEX IF NOT EXISTS uq_full_curriculum_enrolment_learner_scope
  ON full_curriculum_enrolments(id, school_id, learner_id);

CREATE TABLE IF NOT EXISTS full_curriculum_matching_records (
  id                         BIGSERIAL PRIMARY KEY,
  school_id                  INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  enrolment_id               BIGINT NOT NULL,
  learner_id                 INTEGER,
  status                     TEXT NOT NULL DEFAULT 'pending',
  initial_instructor_id      INTEGER,
  current_instructor_id      INTEGER,
  assigned_at                TIMESTAMPTZ,
  accepted_at                TIMESTAMPTZ,
  accepted_by_instructor_id  INTEGER,
  started_at                 TIMESTAMPTZ,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, enrolment_id),
  FOREIGN KEY (enrolment_id, school_id, learner_id)
    REFERENCES full_curriculum_enrolments(id, school_id, learner_id),
  FOREIGN KEY (initial_instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  FOREIGN KEY (current_instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  FOREIGN KEY (accepted_by_instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  CHECK (status IN ('pending', 'assigned', 'accepted', 'started')),
  CHECK (
    (status = 'pending' AND current_instructor_id IS NULL AND assigned_at IS NULL)
    OR
    (status IN ('assigned', 'accepted', 'started') AND current_instructor_id IS NOT NULL AND assigned_at IS NOT NULL)
  ),
  CHECK (
    (status IN ('pending', 'assigned') AND accepted_at IS NULL AND accepted_by_instructor_id IS NULL)
    OR
    (status = 'accepted' AND accepted_at IS NOT NULL AND accepted_by_instructor_id IS NOT NULL)
    OR
    (status = 'started' AND ((accepted_at IS NULL AND accepted_by_instructor_id IS NULL)
      OR (accepted_at IS NOT NULL AND accepted_by_instructor_id IS NOT NULL)))
  ),
  CHECK ((status = 'started' AND started_at IS NOT NULL) OR (status <> 'started' AND started_at IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_full_curriculum_matching_queue
  ON full_curriculum_matching_records(school_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_full_curriculum_matching_instructor
  ON full_curriculum_matching_records(school_id, current_instructor_id, status)
  WHERE current_instructor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_full_curriculum_matching_initial_instructor
  ON full_curriculum_matching_records(school_id, initial_instructor_id)
  WHERE initial_instructor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_full_curriculum_matching_acceptor
  ON full_curriculum_matching_records(school_id, accepted_by_instructor_id)
  WHERE accepted_by_instructor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_full_curriculum_matching_learner
  ON full_curriculum_matching_records(school_id, learner_id)
  WHERE learner_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS full_curriculum_assignment_events (
  id                     BIGSERIAL PRIMARY KEY,
  school_id              INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  matching_record_id     BIGINT NOT NULL,
  enrolment_id           BIGINT NOT NULL,
  previous_instructor_id INTEGER,
  instructor_id          INTEGER NOT NULL,
  event_type             TEXT NOT NULL,
  actor_type              TEXT NOT NULL,
  actor_id                INTEGER NOT NULL,
  reason                  TEXT NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  FOREIGN KEY (matching_record_id, school_id)
    REFERENCES full_curriculum_matching_records(id, school_id),
  FOREIGN KEY (enrolment_id, school_id)
    REFERENCES full_curriculum_enrolments(id, school_id),
  FOREIGN KEY (previous_instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  CHECK (event_type IN ('assigned', 'self_assigned', 'accepted', 'reassigned')),
  CHECK (actor_type IN ('admin', 'superadmin', 'instructor', 'instructor_admin')),
  CHECK (char_length(BTRIM(reason)) BETWEEN 2 AND 1000),
  CHECK (event_type <> 'reassigned' OR previous_instructor_id IS NOT NULL),
  CHECK (event_type = 'reassigned' OR previous_instructor_id IS NULL OR previous_instructor_id = instructor_id)
);

CREATE INDEX IF NOT EXISTS idx_full_curriculum_assignment_timeline
  ON full_curriculum_assignment_events(school_id, enrolment_id, id);
CREATE INDEX IF NOT EXISTS idx_full_curriculum_assignment_instructor
  ON full_curriculum_assignment_events(school_id, instructor_id, id);
CREATE INDEX IF NOT EXISTS idx_full_curriculum_assignment_matching
  ON full_curriculum_assignment_events(school_id, matching_record_id, id);
CREATE INDEX IF NOT EXISTS idx_full_curriculum_assignment_previous_instructor
  ON full_curriculum_assignment_events(school_id, previous_instructor_id, id)
  WHERE previous_instructor_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS full_curriculum_availability_versions (
  id                     BIGSERIAL PRIMARY KEY,
  school_id              INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  matching_record_id     BIGINT NOT NULL,
  enrolment_id           BIGINT NOT NULL,
  instructor_id          INTEGER NOT NULL,
  version_number         INTEGER NOT NULL,
  timezone               TEXT NOT NULL,
  actor_type              TEXT NOT NULL,
  actor_id                INTEGER NOT NULL,
  reason                  TEXT NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, enrolment_id, version_number),
  FOREIGN KEY (matching_record_id, school_id)
    REFERENCES full_curriculum_matching_records(id, school_id),
  FOREIGN KEY (enrolment_id, school_id)
    REFERENCES full_curriculum_enrolments(id, school_id),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  CHECK (version_number > 0),
  CHECK (char_length(BTRIM(timezone)) BETWEEN 1 AND 100),
  CHECK (actor_type IN ('admin', 'superadmin', 'instructor', 'instructor_admin')),
  CHECK (char_length(BTRIM(reason)) BETWEEN 2 AND 1000)
);

CREATE INDEX IF NOT EXISTS idx_full_curriculum_availability_timeline
  ON full_curriculum_availability_versions(school_id, enrolment_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_full_curriculum_availability_instructor
  ON full_curriculum_availability_versions(school_id, instructor_id, version_number DESC);

CREATE TABLE IF NOT EXISTS full_curriculum_availability_windows (
  id                      BIGSERIAL PRIMARY KEY,
  school_id               INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  availability_version_id BIGINT NOT NULL,
  weekday                 SMALLINT NOT NULL,
  local_start_time        TIME NOT NULL,
  local_end_time          TIME NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, availability_version_id, weekday, local_start_time, local_end_time),
  FOREIGN KEY (availability_version_id, school_id)
    REFERENCES full_curriculum_availability_versions(id, school_id),
  CHECK (weekday BETWEEN 1 AND 7),
  CHECK (local_end_time > local_start_time)
);

CREATE INDEX IF NOT EXISTS idx_full_curriculum_availability_windows_version
  ON full_curriculum_availability_windows(school_id, availability_version_id, weekday, local_start_time);

CREATE OR REPLACE FUNCTION validate_full_curriculum_matching_record()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.school_id IS DISTINCT FROM OLD.school_id
       OR NEW.enrolment_id IS DISTINCT FROM OLD.enrolment_id
       OR (NEW.learner_id IS DISTINCT FROM OLD.learner_id
           AND NOT (OLD.learner_id IS NOT NULL AND NEW.learner_id IS NULL))
       OR (OLD.initial_instructor_id IS NOT NULL
           AND NEW.initial_instructor_id IS DISTINCT FROM OLD.initial_instructor_id)
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Full Curriculum matching identity is immutable'
        USING ERRCODE = '55000';
    END IF;
    IF NOT (
      (OLD.status = 'pending' AND NEW.status IN ('pending', 'assigned', 'accepted'))
      OR (OLD.status = 'assigned' AND NEW.status IN ('assigned', 'accepted', 'started'))
      OR (OLD.status = 'accepted' AND NEW.status IN ('assigned', 'accepted', 'started'))
      OR (OLD.status = 'started' AND NEW.status = 'started')
    ) OR (OLD.started_at IS NOT NULL AND NEW.started_at IS DISTINCT FROM OLD.started_at) THEN
      RAISE EXCEPTION 'Invalid Full Curriculum matching transition'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.current_instructor_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.current_instructor_id IS DISTINCT FROM OLD.current_instructor_id OR NEW.status IS DISTINCT FROM OLD.status)
     AND NOT EXISTS (
    SELECT 1 FROM instructors i
     WHERE i.id = NEW.current_instructor_id
       AND i.school_id = NEW.school_id
       AND i.active = TRUE
  ) THEN
    RAISE EXCEPTION 'Full Curriculum assignment requires an active same-school instructor'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.initial_instructor_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.initial_instructor_id IS DISTINCT FROM OLD.initial_instructor_id)
     AND NOT EXISTS (
    SELECT 1 FROM instructors i
     WHERE i.id = NEW.initial_instructor_id
       AND i.school_id = NEW.school_id
       AND i.active = TRUE
  ) THEN
    RAISE EXCEPTION 'Initial Full Curriculum assignment requires an active same-school instructor'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.accepted_by_instructor_id IS NOT NULL
     AND NEW.accepted_by_instructor_id IS DISTINCT FROM NEW.current_instructor_id THEN
    RAISE EXCEPTION 'Only the currently assigned instructor may accept a Full Curriculum assignment'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_full_curriculum_matching_record
  ON full_curriculum_matching_records;
CREATE TRIGGER trg_validate_full_curriculum_matching_record
BEFORE INSERT OR UPDATE ON full_curriculum_matching_records
FOR EACH ROW EXECUTE FUNCTION validate_full_curriculum_matching_record();

CREATE OR REPLACE FUNCTION validate_full_curriculum_availability_timezone()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.timezone) THEN
    RAISE EXCEPTION 'Invalid IANA timezone for Full Curriculum availability'
      USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM full_curriculum_matching_records m
      JOIN instructors i
        ON i.id = NEW.instructor_id AND i.school_id = NEW.school_id AND i.active = TRUE
     WHERE m.id = NEW.matching_record_id
       AND m.school_id = NEW.school_id
       AND m.enrolment_id = NEW.enrolment_id
       AND m.current_instructor_id = NEW.instructor_id
  ) THEN
    RAISE EXCEPTION 'Availability requires the active currently assigned same-school instructor'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validate_full_curriculum_assignment_event()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM full_curriculum_matching_records m
      JOIN instructors i
        ON i.id = NEW.instructor_id AND i.school_id = NEW.school_id AND i.active = TRUE
     WHERE m.id = NEW.matching_record_id
       AND m.school_id = NEW.school_id
       AND m.enrolment_id = NEW.enrolment_id
       AND m.current_instructor_id = NEW.instructor_id
  ) THEN
    RAISE EXCEPTION 'Assignment evidence must match the active current same-school instructor and enrolment'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_full_curriculum_assignment_event
  ON full_curriculum_assignment_events;
CREATE TRIGGER trg_validate_full_curriculum_assignment_event
BEFORE INSERT ON full_curriculum_assignment_events
FOR EACH ROW EXECUTE FUNCTION validate_full_curriculum_assignment_event();

DROP TRIGGER IF EXISTS trg_validate_full_curriculum_availability_timezone
  ON full_curriculum_availability_versions;
CREATE TRIGGER trg_validate_full_curriculum_availability_timezone
BEFORE INSERT ON full_curriculum_availability_versions
FOR EACH ROW EXECUTE FUNCTION validate_full_curriculum_availability_timezone();

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'full_curriculum_assignment_events',
    'full_curriculum_availability_versions',
    'full_curriculum_availability_windows'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_append_only ON %I', table_name, table_name);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_full_curriculum_evidence_change()',
      table_name,
      table_name
    );
  END LOOP;
END $$;

INSERT INTO full_curriculum_matching_records (
  school_id, enrolment_id, learner_id, status, created_at, updated_at
)
SELECT e.school_id, e.id, e.learner_id, 'pending', e.created_at, NOW()
  FROM full_curriculum_enrolments e
 WHERE e.programme_start_at IS NULL
ON CONFLICT (school_id, enrolment_id) DO NOTHING;
