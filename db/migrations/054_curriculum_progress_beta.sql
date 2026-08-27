-- Booked-lesson curriculum progress live beta.
-- Schema only: the feature remains off unless a school's exact JSON boolean
-- config.features.curriculum_progress_beta is true.

CREATE UNIQUE INDEX IF NOT EXISTS uq_lesson_bookings_id_school
  ON lesson_bookings(id, school_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_driving_sessions_id_school
  ON driving_sessions(id, school_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_driving_sessions_booking
  ON driving_sessions(booking_id)
  WHERE booking_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_learner_users_id_school
  ON learner_users(id, school_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_instructors_id_school
  ON instructors(id, school_id);

CREATE TABLE IF NOT EXISTS curriculum_review_submissions (
  id                 BIGSERIAL PRIMARY KEY,
  school_id          INTEGER NOT NULL REFERENCES schools(id),
  session_id         INTEGER NOT NULL,
  booking_id         INTEGER NOT NULL,
  learner_id         INTEGER NOT NULL,
  instructor_id      INTEGER NOT NULL,
  assessor_role      TEXT NOT NULL CHECK (assessor_role IN ('instructor', 'learner')),
  client_request_id  TEXT NOT NULL CHECK (char_length(client_request_id) BETWEEN 8 AND 100),
  note               TEXT CHECK (note IS NULL OR char_length(note) <= 1000),
  submitted_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, assessor_role, client_request_id),
  FOREIGN KEY (session_id, school_id) REFERENCES driving_sessions(id, school_id) ON DELETE CASCADE,
  FOREIGN KEY (booking_id, school_id) REFERENCES lesson_bookings(id, school_id) ON DELETE CASCADE,
  FOREIGN KEY (learner_id, school_id) REFERENCES learner_users(id, school_id) ON DELETE CASCADE,
  FOREIGN KEY (instructor_id, school_id) REFERENCES instructors(id, school_id)
);

CREATE INDEX IF NOT EXISTS idx_curriculum_submissions_booking_role
  ON curriculum_review_submissions(school_id, booking_id, assessor_role, submitted_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_curriculum_submissions_learner
  ON curriculum_review_submissions(school_id, learner_id, submitted_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_curriculum_submissions_instructor
  ON curriculum_review_submissions(school_id, instructor_id, submitted_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS curriculum_rating_events (
  id                    BIGSERIAL PRIMARY KEY,
  school_id             INTEGER NOT NULL REFERENCES schools(id),
  submission_id         BIGINT NOT NULL,
  session_id            INTEGER NOT NULL,
  booking_id            INTEGER NOT NULL,
  learner_id            INTEGER NOT NULL,
  instructor_id         INTEGER NOT NULL,
  curriculum_item_key   TEXT NOT NULL CHECK (char_length(curriculum_item_key) BETWEEN 3 AND 32),
  assessor_role         TEXT NOT NULL CHECK (assessor_role IN ('instructor', 'learner')),
  score                 SMALLINT NOT NULL CHECK (score BETWEEN 1 AND 3),
  note                  TEXT CHECK (note IS NULL OR char_length(note) <= 500),
  assessed_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (submission_id, curriculum_item_key),
  CONSTRAINT curriculum_rating_events_item_type_check CHECK (
    curriculum_item_key NOT IN (
      'SET-01', 'SET-02', 'SET-03',
      'VEH-01', 'VEH-02', 'VEH-03', 'VEH-04', 'VEH-05', 'VEH-06', 'VEH-07'
    )
  ),
  FOREIGN KEY (submission_id, school_id) REFERENCES curriculum_review_submissions(id, school_id) ON DELETE CASCADE,
  FOREIGN KEY (session_id, school_id) REFERENCES driving_sessions(id, school_id) ON DELETE CASCADE,
  FOREIGN KEY (booking_id, school_id) REFERENCES lesson_bookings(id, school_id) ON DELETE CASCADE,
  FOREIGN KEY (learner_id, school_id) REFERENCES learner_users(id, school_id) ON DELETE CASCADE,
  FOREIGN KEY (instructor_id, school_id) REFERENCES instructors(id, school_id)
);

CREATE INDEX IF NOT EXISTS idx_curriculum_ratings_latest
  ON curriculum_rating_events(school_id, learner_id, curriculum_item_key, assessor_role, assessed_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_curriculum_ratings_booking
  ON curriculum_rating_events(school_id, booking_id, assessed_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS curriculum_completion_events (
  id                         BIGSERIAL PRIMARY KEY,
  school_id                  INTEGER NOT NULL REFERENCES schools(id),
  learner_id                 INTEGER NOT NULL,
  curriculum_item_key        TEXT NOT NULL CHECK (char_length(curriculum_item_key) BETWEEN 3 AND 32),
  completed_by_instructor_id INTEGER NOT NULL,
  session_id                 INTEGER,
  booking_id                 INTEGER,
  completed_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, learner_id, curriculum_item_key),
  CONSTRAINT curriculum_completion_events_item_type_check CHECK (
    curriculum_item_key IN (
      'SET-01', 'SET-02', 'SET-03',
      'VEH-01', 'VEH-02', 'VEH-03', 'VEH-04', 'VEH-05', 'VEH-06', 'VEH-07'
    )
  ),
  FOREIGN KEY (learner_id, school_id) REFERENCES learner_users(id, school_id) ON DELETE CASCADE,
  FOREIGN KEY (completed_by_instructor_id, school_id) REFERENCES instructors(id, school_id),
  FOREIGN KEY (session_id, school_id) REFERENCES driving_sessions(id, school_id) ON DELETE CASCADE,
  FOREIGN KEY (booking_id, school_id) REFERENCES lesson_bookings(id, school_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_curriculum_completions_learner
  ON curriculum_completion_events(school_id, learner_id, completed_at DESC);
