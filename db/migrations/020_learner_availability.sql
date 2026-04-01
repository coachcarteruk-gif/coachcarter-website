-- Migration 020: Learner Weekly Availability
-- Mirrors instructor_availability: recurring day_of_week + time range windows.
-- Learners declare when they're typically free, used for waitlist matching.

CREATE TABLE IF NOT EXISTS learner_availability (
  id            SERIAL PRIMARY KEY,
  learner_id    INTEGER NOT NULL REFERENCES learner_users(id) ON DELETE CASCADE,
  day_of_week   SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time    TIME NOT NULL,
  end_time      TIME NOT NULL,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_learner_avail_times CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_learner_availability_learner
  ON learner_availability(learner_id);

CREATE INDEX IF NOT EXISTS idx_learner_availability_day
  ON learner_availability(day_of_week)
  WHERE active = true;
