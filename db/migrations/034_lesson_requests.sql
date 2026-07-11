-- Lesson requests ("request to book") - July 2026
-- Mirrors the lesson-request block in db/migration.sql as a discrete migration
-- for environments that apply numbered migration files rather than the
-- monolithic schema file.

ALTER TABLE instructors ADD COLUMN IF NOT EXISTS request_to_book BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS lesson_requests (
  id                  SERIAL PRIMARY KEY,
  school_id           INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  instructor_id       INTEGER NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
  learner_id          INTEGER REFERENCES learner_users(id) ON DELETE SET NULL,
  guest_email         TEXT,
  guest_name          TEXT,
  guest_phone         TEXT,
  scheduled_date      DATE NOT NULL,
  start_time          TIME NOT NULL,
  end_time            TIME NOT NULL,
  lesson_type_id      INTEGER REFERENCES lesson_types(id),
  pickup_address      TEXT,
  transmission_type   TEXT,
  payment_method      TEXT NOT NULL CHECK (payment_method IN ('card_hold', 'credit')),
  stripe_session_id   TEXT,
  payment_intent_id   TEXT,
  amount_pence        INTEGER,
  credits_minutes     INTEGER,
  hold_transaction_id INTEGER REFERENCES credit_transactions(id),
  list_price_pence    INTEGER,
  list_price_source   TEXT,
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','accepted','declined','expired','withdrawn')),
  booking_id          INTEGER REFERENCES lesson_bookings(id),
  decline_reason      TEXT,
  expires_at          TIMESTAMPTZ NOT NULL,
  decided_at          TIMESTAMPTZ,
  released_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_requests_school      ON lesson_requests(school_id);
CREATE INDEX IF NOT EXISTS idx_requests_instructor  ON lesson_requests(instructor_id, status);
CREATE INDEX IF NOT EXISTS idx_requests_learner     ON lesson_requests(learner_id) WHERE learner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_requests_lesson_type ON lesson_requests(lesson_type_id) WHERE lesson_type_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_requests_booking     ON lesson_requests(booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_requests_hold_tx     ON lesson_requests(hold_transaction_id) WHERE hold_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_requests_expiry      ON lesson_requests(expires_at) WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS uq_request_slot
  ON lesson_requests(instructor_id, scheduled_date, start_time) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_requests_unreleased
  ON lesson_requests(decided_at) WHERE released_at IS NULL AND status <> 'pending';

ALTER TABLE credit_transactions DROP CONSTRAINT IF EXISTS credit_transactions_type_check;
ALTER TABLE credit_transactions
  ADD CONSTRAINT credit_transactions_type_check CHECK (
    type IN (
      'purchase',
      'refund',
      'slot_purchase',
      'edit_adjustment',
      'admin_add',
      'admin_remove',
      'referral_bonus',
      'referral_reward',
      'free_trial',
      'legacy_grandfather',
      'request_hold',
      'request_refund'
    )
  );
