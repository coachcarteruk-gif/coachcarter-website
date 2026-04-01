-- Migration 021: Waiting List
-- Learners join waitlist for desired time slots; notified on cancellations.
-- Entries auto-expire after 14 days (checked on-read).

CREATE TABLE IF NOT EXISTS waitlist (
  id                   SERIAL PRIMARY KEY,
  learner_id           INTEGER NOT NULL REFERENCES learner_users(id) ON DELETE CASCADE,
  instructor_id        INTEGER REFERENCES instructors(id) ON DELETE CASCADE,
  preferred_day        SMALLINT CHECK (preferred_day BETWEEN 0 AND 6),
  preferred_start_time TIME,
  preferred_end_time   TIME,
  lesson_type_id       INTEGER REFERENCES lesson_types(id),
  status               TEXT NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active','notified','booked','expired')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at           TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '14 days'),
  notified_at          TIMESTAMPTZ,
  CONSTRAINT chk_waitlist_times CHECK (
    (preferred_start_time IS NULL AND preferred_end_time IS NULL)
    OR (preferred_start_time IS NOT NULL AND preferred_end_time IS NOT NULL
        AND preferred_end_time > preferred_start_time)
  )
);

CREATE INDEX IF NOT EXISTS idx_waitlist_active
  ON waitlist(status, preferred_day)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_waitlist_learner
  ON waitlist(learner_id);
