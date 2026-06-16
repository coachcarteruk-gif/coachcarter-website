-- Learner feedback queue: authenticated issue reports and suggestions.
CREATE TABLE IF NOT EXISTS learner_feedback (
  id          SERIAL PRIMARY KEY,
  school_id   INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  learner_id  INTEGER NOT NULL REFERENCES learner_users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL DEFAULT 'suggestion',
  title       TEXT NOT NULL,
  message     TEXT NOT NULL,
  page_url    TEXT,
  user_agent  TEXT,
  status      TEXT NOT NULL DEFAULT 'open',
  reviewed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT learner_feedback_type_check CHECK (type IN ('issue', 'suggestion')),
  CONSTRAINT learner_feedback_status_check CHECK (status IN ('open', 'reviewed', 'closed'))
);

CREATE INDEX IF NOT EXISTS idx_learner_feedback_school_status
  ON learner_feedback(school_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_learner_feedback_learner
  ON learner_feedback(learner_id, created_at DESC);
