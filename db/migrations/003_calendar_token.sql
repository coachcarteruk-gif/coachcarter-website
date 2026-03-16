-- Migration 003: Add calendar_token to learner_users
-- This token is used for the iCal subscription feed so Apple Calendar
-- can poll /api/calendar?action=feed&token=X without needing a JWT.

ALTER TABLE learner_users
ADD COLUMN IF NOT EXISTS calendar_token TEXT UNIQUE;

-- Index for fast lookup when the feed is polled
CREATE INDEX IF NOT EXISTS idx_learner_calendar_token
ON learner_users (calendar_token)
WHERE calendar_token IS NOT NULL;
