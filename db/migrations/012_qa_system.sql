-- Q&A system: learners ask questions, instructors answer
CREATE TABLE IF NOT EXISTS qa_questions (
  id            SERIAL PRIMARY KEY,
  learner_id    INTEGER NOT NULL REFERENCES learner_users(id) ON DELETE CASCADE,
  booking_id    INTEGER REFERENCES lesson_bookings(id) ON DELETE SET NULL,
  session_id    INTEGER REFERENCES driving_sessions(id) ON DELETE SET NULL,
  title         TEXT NOT NULL,
  body          TEXT,
  status        TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'answered', 'closed')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qa_questions_learner ON qa_questions(learner_id);
CREATE INDEX IF NOT EXISTS idx_qa_questions_status ON qa_questions(status);

CREATE TABLE IF NOT EXISTS qa_answers (
  id            SERIAL PRIMARY KEY,
  question_id   INTEGER NOT NULL REFERENCES qa_questions(id) ON DELETE CASCADE,
  author_type   TEXT NOT NULL CHECK (author_type IN ('learner', 'instructor')),
  author_id     INTEGER NOT NULL,
  body          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qa_answers_question ON qa_answers(question_id);
