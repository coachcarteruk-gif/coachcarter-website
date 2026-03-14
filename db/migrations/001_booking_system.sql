-- ============================================================
-- Migration 001 — Booking & Credit System
-- Coach Carter Website
-- ============================================================
-- Run this once against your Neon database.
-- Safe to re-run: uses IF NOT EXISTS / IF EXISTS throughout.
-- ============================================================


-- ── 1. Add credit balance to existing learner accounts ───────────────────────

ALTER TABLE learner_users
  ADD COLUMN IF NOT EXISTS credit_balance INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS phone TEXT;

-- Ensure balance never goes negative at the DB level
ALTER TABLE learner_users
  DROP CONSTRAINT IF EXISTS chk_credit_balance_non_negative;

ALTER TABLE learner_users
  ADD CONSTRAINT chk_credit_balance_non_negative
  CHECK (credit_balance >= 0);


-- ── 2. Instructors ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS instructors (
  id            SERIAL PRIMARY KEY,
  name          TEXT    NOT NULL,
  email         TEXT    UNIQUE NOT NULL,
  phone         TEXT,
  bio           TEXT,
  photo_url     TEXT,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ── 3. Instructor weekly availability windows ────────────────────────────────
-- Recurring windows — e.g. "every Monday 09:00–17:00"
-- day_of_week: 0 = Sunday … 6 = Saturday (matches JS getDay())

CREATE TABLE IF NOT EXISTS instructor_availability (
  id             SERIAL PRIMARY KEY,
  instructor_id  INTEGER NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
  day_of_week    SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time     TIME NOT NULL,
  end_time       TIME NOT NULL,
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_availability_times CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_instructor_availability_instructor
  ON instructor_availability(instructor_id);


-- ── 4. Bookings ───────────────────────────────────────────────────────────────
-- Each row is one 1.5-hour lesson slot.
-- status: 'confirmed' | 'completed' | 'cancelled'

CREATE TABLE IF NOT EXISTS lesson_bookings (
  id              SERIAL PRIMARY KEY,
  learner_id      INTEGER NOT NULL REFERENCES learner_users(id) ON DELETE RESTRICT,
  instructor_id   INTEGER NOT NULL REFERENCES instructors(id)   ON DELETE RESTRICT,
  scheduled_date  DATE    NOT NULL,
  start_time      TIME    NOT NULL,
  end_time        TIME    NOT NULL,               -- always start_time + 90 min
  status          TEXT    NOT NULL DEFAULT 'confirmed'
                    CHECK (status IN ('confirmed','completed','cancelled')),
  cancelled_at    TIMESTAMPTZ,
  credit_returned BOOLEAN NOT NULL DEFAULT FALSE, -- TRUE once credit refunded
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_booking_times   CHECK (end_time > start_time),
  CONSTRAINT chk_booking_90_min  CHECK (
    EXTRACT(EPOCH FROM (end_time - start_time)) = 5400  -- 90 × 60 seconds
  )
);

CREATE INDEX IF NOT EXISTS idx_lesson_bookings_learner
  ON lesson_bookings(learner_id);

CREATE INDEX IF NOT EXISTS idx_lesson_bookings_instructor_date
  ON lesson_bookings(instructor_id, scheduled_date);

-- Prevent double-booking an instructor into the same slot
CREATE UNIQUE INDEX IF NOT EXISTS uq_instructor_slot
  ON lesson_bookings(instructor_id, scheduled_date, start_time)
  WHERE status != 'cancelled';


-- ── 5. Transactions ───────────────────────────────────────────────────────────
-- Records every credit purchase and refund.
-- type: 'purchase' | 'refund'

CREATE TABLE IF NOT EXISTS credit_transactions (
  id                    SERIAL PRIMARY KEY,
  learner_id            INTEGER NOT NULL REFERENCES learner_users(id) ON DELETE RESTRICT,
  type                  TEXT    NOT NULL CHECK (type IN ('purchase','refund')),
  credits               INTEGER NOT NULL,          -- positive for purchase, positive for refund
  amount_pence          INTEGER NOT NULL,           -- e.g. 4500 = £45.00
  payment_method        TEXT,                       -- 'card' | 'klarna'
  stripe_payment_intent TEXT,
  stripe_session_id     TEXT,
  booking_id            INTEGER REFERENCES lesson_bookings(id), -- populated for refunds
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_transactions_learner
  ON credit_transactions(learner_id);


-- ── Done ─────────────────────────────────────────────────────────────────────
-- Tables created:
--   instructors
--   instructor_availability
--   lesson_bookings
--   credit_transactions
--
-- Tables modified:
--   learner_users  →  + credit_balance (INTEGER, default 0)
--                     + phone (TEXT, nullable)
-- ============================================================
