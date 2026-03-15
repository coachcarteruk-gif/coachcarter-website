-- ============================================================
-- Migration 002 — Admin Users
-- Coach Carter Website
-- ============================================================
-- Run this once against your Neon database.
-- Safe to re-run: uses IF NOT EXISTS throughout.
-- ============================================================

CREATE TABLE IF NOT EXISTS admin_users (
  id            SERIAL PRIMARY KEY,
  name          TEXT    NOT NULL,
  email         TEXT    UNIQUE NOT NULL,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'admin'
                  CHECK (role IN ('admin', 'superadmin')),
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Done. Table created: admin_users
-- ============================================================
