-- Test Swaps Marketplace (June 2026)
-- Idempotent schema slice. The central db/migration.sql remains deploy source.

ALTER TABLE learner_users ADD COLUMN IF NOT EXISTS test_centre TEXT;

CREATE TABLE IF NOT EXISTS test_swap_listings (
  id           SERIAL PRIMARY KEY,
  school_id    INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  learner_id   INTEGER NOT NULL REFERENCES learner_users(id) ON DELETE CASCADE,
  test_date    DATE NOT NULL,
  test_time    TEXT NOT NULL,
  test_centre  TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  CONSTRAINT test_swap_listings_status_check
    CHECK (status IN ('active', 'accepted_in_principle', 'completed', 'cancelled'))
);

CREATE TABLE IF NOT EXISTS test_swap_windows (
  id         SERIAL PRIMARY KEY,
  listing_id INTEGER NOT NULL REFERENCES test_swap_listings(id) ON DELETE CASCADE,
  school_id  INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  start_date DATE NOT NULL,
  end_date   DATE NOT NULL,
  CONSTRAINT test_swap_windows_range_check CHECK (start_date <= end_date)
);

CREATE TABLE IF NOT EXISTS test_swap_unavailable_dates (
  id               SERIAL PRIMARY KEY,
  listing_id        INTEGER NOT NULL REFERENCES test_swap_listings(id) ON DELETE CASCADE,
  school_id         INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  unavailable_date  DATE NOT NULL
);

CREATE TABLE IF NOT EXISTS test_swap_requests (
  id                             SERIAL PRIMARY KEY,
  school_id                      INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  listing_id                     INTEGER NOT NULL REFERENCES test_swap_listings(id) ON DELETE CASCADE,
  requester_learner_id           INTEGER NOT NULL REFERENCES learner_users(id) ON DELETE CASCADE,
  requester_test_date_snapshot   DATE NOT NULL,
  requester_test_time_snapshot   TEXT NOT NULL,
  requester_test_centre_snapshot TEXT NOT NULL,
  status                         TEXT NOT NULL DEFAULT 'pending',
  created_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at                    TIMESTAMPTZ,
  declined_at                    TIMESTAMPTZ,
  withdrawn_at                   TIMESTAMPTZ,
  completed_at                   TIMESTAMPTZ,
  CONSTRAINT test_swap_requests_status_check
    CHECK (status IN ('pending', 'accepted', 'declined', 'withdrawn', 'completed'))
);

CREATE INDEX IF NOT EXISTS idx_test_swap_listings_school_status_centre
  ON test_swap_listings(school_id, status, lower(test_centre), test_date);
CREATE INDEX IF NOT EXISTS idx_test_swap_listings_learner
  ON test_swap_listings(learner_id, school_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_test_swap_one_open_listing_per_learner
  ON test_swap_listings(learner_id, school_id)
  WHERE status IN ('active', 'accepted_in_principle');

CREATE INDEX IF NOT EXISTS idx_test_swap_windows_listing
  ON test_swap_windows(listing_id, school_id);
CREATE INDEX IF NOT EXISTS idx_test_swap_unavailable_listing
  ON test_swap_unavailable_dates(listing_id, school_id);

CREATE INDEX IF NOT EXISTS idx_test_swap_requests_listing_status
  ON test_swap_requests(listing_id, school_id, status);
CREATE INDEX IF NOT EXISTS idx_test_swap_requests_requester
  ON test_swap_requests(requester_learner_id, school_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_test_swap_pending_request_per_listing
  ON test_swap_requests(listing_id, requester_learner_id, school_id)
  WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS uq_test_swap_one_accepted_request_per_listing
  ON test_swap_requests(listing_id, school_id)
  WHERE status = 'accepted';
