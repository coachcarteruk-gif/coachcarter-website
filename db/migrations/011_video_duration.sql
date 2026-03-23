-- ============================================================
-- Migration 009 — Add duration to videos
-- Stores video length in seconds, fetched from Cloudflare Stream API.
-- Safe to re-run: uses IF NOT EXISTS.
-- ============================================================

ALTER TABLE videos ADD COLUMN IF NOT EXISTS duration_seconds INTEGER;
