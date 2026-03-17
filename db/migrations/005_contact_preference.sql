-- ============================================================
-- Migration 005 — Learner contact preference
-- Adds a boolean flag for learners to request their instructor
-- contacts them before the lesson.
-- Safe to re-run: uses IF NOT EXISTS.
-- ============================================================

ALTER TABLE learner_users
  ADD COLUMN IF NOT EXISTS prefer_contact_before BOOLEAN NOT NULL DEFAULT FALSE;
