-- 029: Instructor busy blocks
-- Allows instructors to block a specific time range on a specific date
-- without changing recurring weekly availability or full-day blackouts.

CREATE TABLE IF NOT EXISTS instructor_busy_blocks (
  id              SERIAL PRIMARY KEY,
  instructor_id   INTEGER NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
  school_id       INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  block_date      DATE NOT NULL,
  start_time      TIME NOT NULL,
  end_time        TIME NOT NULL,
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (start_time < end_time)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_instructor_busy_block_slot
  ON instructor_busy_blocks(instructor_id, school_id, block_date, start_time, end_time);

CREATE INDEX IF NOT EXISTS idx_instructor_busy_blocks_lookup
  ON instructor_busy_blocks(school_id, instructor_id, block_date);
