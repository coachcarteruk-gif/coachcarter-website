-- ============================================================
-- Migration 010 — Add calendar_token to instructors
-- ============================================================
-- Allows instructors to subscribe to a webcal feed of their lessons.
-- Safe to re-run: uses IF NOT EXISTS.
-- ============================================================

ALTER TABLE instructors
ADD COLUMN IF NOT EXISTS calendar_token TEXT UNIQUE;

CREATE INDEX IF NOT EXISTS idx_instructor_calendar_token
ON instructors (calendar_token)
WHERE calendar_token IS NOT NULL;
