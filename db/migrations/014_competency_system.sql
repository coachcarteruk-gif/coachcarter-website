-- ============================================================================
-- 014: Competency Record System
-- ============================================================================
-- Adds fault tracking to skill_ratings, plus new tables for mock tests
-- and quiz result persistence. All keyed to DL25-aligned skill_key values
-- from competency-config.js.
-- ============================================================================

-- ── 1. Expand skill_ratings with fault counts ───────────────────────────────
-- Existing columns: id, session_id, user_id, tier, skill_key, rating, note, created_at
-- New columns allow each skill rating to also record fault counts from that session.
ALTER TABLE skill_ratings ADD COLUMN IF NOT EXISTS driving_faults  INTEGER DEFAULT 0;
ALTER TABLE skill_ratings ADD COLUMN IF NOT EXISTS serious_faults  INTEGER DEFAULT 0;
ALTER TABLE skill_ratings ADD COLUMN IF NOT EXISTS dangerous_faults INTEGER DEFAULT 0;

-- ── 2. Mock test records ────────────────────────────────────────────────────
-- One row per mock test attempt. Stores aggregate totals and pass/fail result.
CREATE TABLE IF NOT EXISTS mock_tests (
  id                    SERIAL PRIMARY KEY,
  learner_id            INTEGER NOT NULL REFERENCES learner_users(id) ON DELETE CASCADE,
  started_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at          TIMESTAMPTZ,
  result                TEXT CHECK (result IN ('pass', 'fail')),
  total_driving_faults  INTEGER NOT NULL DEFAULT 0,
  total_serious_faults  INTEGER NOT NULL DEFAULT 0,
  total_dangerous_faults INTEGER NOT NULL DEFAULT 0,
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mock_tests_learner
  ON mock_tests (learner_id, started_at DESC);

-- ── 3. Mock test faults (per-skill, per-part) ──────────────────────────────
-- Records individual fault tallies for each skill within each 10-minute part.
CREATE TABLE IF NOT EXISTS mock_test_faults (
  id               SERIAL PRIMARY KEY,
  mock_test_id     INTEGER NOT NULL REFERENCES mock_tests(id) ON DELETE CASCADE,
  part             INTEGER NOT NULL CHECK (part BETWEEN 1 AND 3),
  skill_key        TEXT NOT NULL,
  driving_faults   INTEGER NOT NULL DEFAULT 0,
  serious_faults   INTEGER NOT NULL DEFAULT 0,
  dangerous_faults INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_mock_test_faults_test
  ON mock_test_faults (mock_test_id, part);

-- ── 4. Quiz results (per-question persistence) ─────────────────────────────
-- Saves every quiz answer so we can calculate per-skill accuracy over time.
CREATE TABLE IF NOT EXISTS quiz_results (
  id              SERIAL PRIMARY KEY,
  learner_id      INTEGER NOT NULL REFERENCES learner_users(id) ON DELETE CASCADE,
  question_id     INTEGER NOT NULL,
  skill_key       TEXT NOT NULL,
  correct         BOOLEAN NOT NULL,
  learner_answer  TEXT,
  correct_answer  TEXT,
  answered_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quiz_results_learner_skill
  ON quiz_results (learner_id, skill_key, answered_at DESC);

-- ── 5. Learner competency snapshot (optional: for fast dashboard reads) ─────
-- Denormalised cache of each learner's latest readiness score per skill.
-- Updated by the API after each session log, quiz, or mock test.
CREATE TABLE IF NOT EXISTS competency_snapshots (
  id              SERIAL PRIMARY KEY,
  learner_id      INTEGER NOT NULL REFERENCES learner_users(id) ON DELETE CASCADE,
  skill_key       TEXT NOT NULL,
  lesson_avg      NUMERIC(4,2),          -- average of last 3 lesson ratings (1.00–3.00)
  quiz_accuracy   NUMERIC(5,2),          -- percentage correct (0.00–100.00)
  quiz_attempts   INTEGER DEFAULT 0,
  fault_count_d   INTEGER DEFAULT 0,     -- lifetime driving faults for this skill
  fault_count_s   INTEGER DEFAULT 0,     -- lifetime serious faults
  fault_count_x   INTEGER DEFAULT 0,     -- lifetime dangerous faults
  readiness_score INTEGER DEFAULT 0,     -- combined 0–100 score
  last_practised  TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (learner_id, skill_key)
);

CREATE INDEX IF NOT EXISTS idx_competency_snapshots_learner
  ON competency_snapshots (learner_id);
