-- Instructor-controlled spacing for learner-facing slot start times.
-- Existing instructors keep the current 30-minute behaviour.

ALTER TABLE instructors
  ADD COLUMN IF NOT EXISTS slot_start_interval_minutes INTEGER NOT NULL DEFAULT 30;

ALTER TABLE instructors
  DROP CONSTRAINT IF EXISTS chk_instructors_slot_start_interval_minutes;

ALTER TABLE instructors
  ADD CONSTRAINT chk_instructors_slot_start_interval_minutes
  CHECK (slot_start_interval_minutes IN (30, 60));
