-- Instructor-controlled learner advance booking window.
-- This can reduce the learner-facing self-serve window below the platform cap,
-- but cannot extend it past 84 days.

ALTER TABLE instructors
  ADD COLUMN IF NOT EXISTS max_booking_days_ahead INTEGER DEFAULT 84;

ALTER TABLE instructors
  DROP CONSTRAINT IF EXISTS chk_instructors_max_booking_days_ahead;

ALTER TABLE instructors
  ADD CONSTRAINT chk_instructors_max_booking_days_ahead
  CHECK (max_booking_days_ahead BETWEEN 1 AND 84);
