-- Migration 004: Instructor portal support
-- Adds magic-link login tokens for instructor authentication

CREATE TABLE IF NOT EXISTS instructor_login_tokens (
  id            SERIAL PRIMARY KEY,
  instructor_id INTEGER NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
  token         TEXT    NOT NULL UNIQUE,
  expires_at    TIMESTAMPTZ NOT NULL,
  used          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_instructor_login_tokens_token
  ON instructor_login_tokens (token)
  WHERE used = FALSE;

CREATE INDEX IF NOT EXISTS idx_instructor_login_tokens_instructor
  ON instructor_login_tokens (instructor_id);
