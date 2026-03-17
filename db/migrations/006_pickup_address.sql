-- ============================================================
-- Migration 006 — Learner pickup address
-- Adds a text field for the learner's pickup address.
-- The phone column already exists from migration 001.
-- Safe to re-run: uses IF NOT EXISTS.
-- ============================================================

ALTER TABLE learner_users
  ADD COLUMN IF NOT EXISTS pickup_address TEXT;
