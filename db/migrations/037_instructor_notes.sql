-- Shared instructor ideas board.
-- Notes are visible only to instructors belonging to the same school.

CREATE UNIQUE INDEX IF NOT EXISTS uq_instructors_id_school
  ON instructors(id, school_id);

CREATE TABLE IF NOT EXISTS instructor_notes (
  id            BIGSERIAL PRIMARY KEY,
  school_id     INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  instructor_id INTEGER NOT NULL,
  content       TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id) ON DELETE CASCADE,
  CHECK (char_length(BTRIM(content)) BETWEEN 1 AND 2000)
);

CREATE INDEX IF NOT EXISTS idx_instructor_notes_school_feed
  ON instructor_notes(school_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_instructor_notes_instructor
  ON instructor_notes(instructor_id, school_id);
