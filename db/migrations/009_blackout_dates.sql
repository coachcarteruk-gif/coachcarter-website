-- ============================================================
-- Migration 009 — Instructor Blackout Dates
-- ============================================================
-- Allows instructors to block specific dates (holidays, sick days, etc.)
-- so no slots are generated on those dates.
-- Safe to re-run: uses IF NOT EXISTS throughout.
-- ============================================================

CREATE TABLE IF NOT EXISTS instructor_blackout_dates (
  id             SERIAL PRIMARY KEY,
  instructor_id  INTEGER NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
  blackout_date  DATE    NOT NULL,
  reason         TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_blackout_date UNIQUE (instructor_id, blackout_date)
);

CREATE INDEX IF NOT EXISTS idx_blackout_dates_instructor
  ON instructor_blackout_dates(instructor_id, blackout_date);
