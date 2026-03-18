-- ============================================================
-- Migration 007 — Instructor buffer time between lessons
-- Adds a configurable buffer (in minutes) between booked slots.
-- Default 30 minutes. Editable by instructor and admin.
-- Safe to re-run: uses IF NOT EXISTS.
-- ============================================================

ALTER TABLE instructors
  ADD COLUMN IF NOT EXISTS buffer_minutes INTEGER NOT NULL DEFAULT 30;
