-- Reversible, instructor-specific learner archiving.
--
-- This deliberately lives on the instructor/learner relationship rather than
-- learner_users.archived_at. The latter is a GDPR retention state that can
-- lead to deletion; this field only hides a learner from one instructor's
-- active lists and pickers while preserving every record.

ALTER TABLE instructor_learner_notes
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_instructor_learner_notes_archived
  ON instructor_learner_notes(instructor_id, school_id, learner_id)
  WHERE archived_at IS NOT NULL;
