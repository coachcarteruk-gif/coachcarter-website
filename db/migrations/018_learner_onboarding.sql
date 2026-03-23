-- ============================================================================
-- 015: Learner Onboarding Profile
-- ============================================================================
-- Stores prior driving experience and initial self-assessment data
-- collected during the onboarding flow. Feeds into the AI system prompt
-- and My Progress page from day one.
-- ============================================================================

CREATE TABLE IF NOT EXISTS learner_onboarding (
  id                  SERIAL PRIMARY KEY,
  learner_id          INTEGER UNIQUE NOT NULL REFERENCES learner_users(id) ON DELETE CASCADE,
  prior_hours_pro     INTEGER DEFAULT 0,        -- hours with a professional instructor
  prior_hours_private INTEGER DEFAULT 0,        -- hours of private practice
  previous_tests      INTEGER DEFAULT 0,        -- number of previous driving tests
  transmission        TEXT DEFAULT 'manual',     -- 'manual' or 'automatic'
  test_booked         BOOLEAN DEFAULT FALSE,
  test_date           DATE,
  main_concerns       TEXT,                      -- free text: "roundabouts and dual carriageways"
  completed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_learner_onboarding_learner
  ON learner_onboarding (learner_id);
