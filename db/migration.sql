-- CoachCarter Database Migration
-- Idempotent â€” safe to run multiple times.
-- Every table and column the application expects is defined here.

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- LEARNER USERS
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
CREATE TABLE IF NOT EXISTS learner_users (
  id                    SERIAL PRIMARY KEY,
  name                  TEXT,
  email                 TEXT UNIQUE,
  phone                 TEXT,
  password_hash         TEXT,
  current_tier          INTEGER DEFAULT 1,
  credit_balance        INTEGER DEFAULT 0,
  pickup_address        TEXT,
  prefer_contact_before BOOLEAN DEFAULT FALSE,
  test_date             DATE,
  test_time             TEXT,
  calendar_token        TEXT UNIQUE,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure phone uniqueness (safe if constraint already exists)
DO $$ BEGIN
  ALTER TABLE learner_users ADD CONSTRAINT learner_users_phone_unique UNIQUE (phone);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Ensure email is nullable (phone-based signups have no email)
ALTER TABLE learner_users ALTER COLUMN email DROP NOT NULL;

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- MAGIC LINK TOKENS
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
CREATE TABLE IF NOT EXISTS magic_link_tokens (
  id         SERIAL PRIMARY KEY,
  token      TEXT UNIQUE NOT NULL,
  email      TEXT,
  phone      TEXT,
  method     TEXT NOT NULL DEFAULT 'email',
  expires_at TIMESTAMPTZ NOT NULL,
  used       BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- INSTRUCTORS
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
CREATE TABLE IF NOT EXISTS instructors (
  id             SERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  email          TEXT UNIQUE NOT NULL,
  phone          TEXT,
  bio            TEXT,
  photo_url      TEXT,
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  buffer_minutes INTEGER DEFAULT 30,
  slot_start_interval_minutes INTEGER NOT NULL DEFAULT 30,
  calendar_token TEXT UNIQUE,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE instructors ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- INSTRUCTOR LOGIN TOKENS
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
CREATE TABLE IF NOT EXISTS instructor_login_tokens (
  id            SERIAL PRIMARY KEY,
  instructor_id INTEGER NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
  token         TEXT NOT NULL UNIQUE,
  expires_at    TIMESTAMPTZ NOT NULL,
  used          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- INSTRUCTOR AVAILABILITY
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
CREATE TABLE IF NOT EXISTS instructor_availability (
  id            SERIAL PRIMARY KEY,
  instructor_id INTEGER NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
  day_of_week   INTEGER NOT NULL,
  start_time    TIME NOT NULL,
  end_time      TIME NOT NULL,
  active        BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- INSTRUCTOR BLACKOUT DATES (supports date ranges via blackout_date + end_date)
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
CREATE TABLE IF NOT EXISTS instructor_blackout_dates (
  id            SERIAL PRIMARY KEY,
  instructor_id INTEGER NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
  blackout_date DATE NOT NULL,
  end_date      DATE,
  reason        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Migrate existing single-day blackouts: add end_date column if missing, backfill
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'instructor_blackout_dates' AND column_name = 'blackout_date'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'instructor_blackout_dates' AND column_name = 'end_date'
  ) THEN
    ALTER TABLE instructor_blackout_dates ADD COLUMN end_date DATE;
  END IF;

  -- Backfill end_date for existing single-day rows
  UPDATE instructor_blackout_dates SET end_date = blackout_date WHERE end_date IS NULL;

  -- Make end_date NOT NULL
  ALTER TABLE instructor_blackout_dates ALTER COLUMN end_date SET NOT NULL;
  ALTER TABLE instructor_blackout_dates ALTER COLUMN end_date SET DEFAULT CURRENT_DATE;

  -- Drop old unique constraint if it exists (no longer valid for ranges)
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'uq_blackout_date' AND table_name = 'instructor_blackout_dates'
  ) THEN
    ALTER TABLE instructor_blackout_dates DROP CONSTRAINT uq_blackout_date;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_blackout_ranges
  ON instructor_blackout_dates(instructor_id, blackout_date, end_date);

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- LESSON BOOKINGS
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
CREATE TABLE IF NOT EXISTS lesson_bookings (
  id               SERIAL PRIMARY KEY,
  learner_id       INTEGER NOT NULL REFERENCES learner_users(id) ON DELETE CASCADE,
  instructor_id    INTEGER NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
  scheduled_date   DATE NOT NULL,
  start_time       TIME NOT NULL,
  end_time         TIME NOT NULL,
  status           TEXT NOT NULL DEFAULT 'confirmed',
  instructor_notes TEXT,
  cancelled_at     TIMESTAMPTZ,
  credit_returned  BOOLEAN DEFAULT FALSE,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_booking_slot UNIQUE (instructor_id, scheduled_date, start_time)
);

-- Ensure instructor_notes column exists (may be missing if table was created before it was added)
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS instructor_notes TEXT;

-- Track reason for cancellation (e.g. 'Cancelled in Setmore', 'learner_request')
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- SLOT RESERVATIONS (temporary holds during Stripe checkout)
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
CREATE TABLE IF NOT EXISTS slot_reservations (
  id                SERIAL PRIMARY KEY,
  learner_id        INTEGER NOT NULL,
  instructor_id     INTEGER NOT NULL,
  scheduled_date    DATE NOT NULL,
  start_time        TIME NOT NULL,
  end_time          TIME NOT NULL,
  stripe_session_id TEXT,
  expires_at        TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- CREDIT TRANSACTIONS
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
CREATE TABLE IF NOT EXISTS credit_transactions (
  id                SERIAL PRIMARY KEY,
  learner_id        INTEGER NOT NULL REFERENCES learner_users(id) ON DELETE CASCADE,
  type              TEXT NOT NULL,
  credits           INTEGER NOT NULL,
  amount_pence      INTEGER DEFAULT 0,
  payment_method    TEXT,
  stripe_session_id TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- DRIVING SESSIONS (lesson logs)
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
CREATE TABLE IF NOT EXISTS driving_sessions (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER NOT NULL,
  session_date     DATE NOT NULL,
  duration_minutes INTEGER,
  session_type     TEXT DEFAULT 'instructor',
  notes            TEXT,
  booking_id       INTEGER,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- SKILL RATINGS
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
CREATE TABLE IF NOT EXISTS skill_ratings (
  id               SERIAL PRIMARY KEY,
  session_id       INTEGER NOT NULL,
  user_id          INTEGER NOT NULL,
  tier             INTEGER NOT NULL,
  skill_key        TEXT NOT NULL,
  rating           TEXT NOT NULL,
  note             TEXT,
  driving_faults   INTEGER DEFAULT 0,
  serious_faults   INTEGER DEFAULT 0,
  dangerous_faults INTEGER DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- ADMIN USERS
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
CREATE TABLE IF NOT EXISTS admin_users (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'admin',
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- SITE CONFIG
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
CREATE TABLE IF NOT EXISTS site_config (
  id         INTEGER PRIMARY KEY DEFAULT 1,
  config     JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- ENQUIRIES
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
CREATE TABLE IF NOT EXISTS enquiries (
  id                SERIAL PRIMARY KEY,
  name              VARCHAR(255) NOT NULL,
  email             VARCHAR(255) NOT NULL,
  phone             VARCHAR(50) NOT NULL,
  enquiry_type      VARCHAR(100) NOT NULL,
  message           TEXT,
  marketing_consent BOOLEAN DEFAULT FALSE,
  submitted_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  status            VARCHAR(50) DEFAULT 'new'
);

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- GUARANTEE PRICING
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
CREATE TABLE IF NOT EXISTS guarantee_pricing (
  id            INTEGER PRIMARY KEY DEFAULT 1,
  base_price    INTEGER NOT NULL DEFAULT 1500,
  current_price INTEGER NOT NULL DEFAULT 1500,
  increment     INTEGER NOT NULL DEFAULT 100,
  cap           INTEGER NOT NULL DEFAULT 3000,
  purchases     INTEGER NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Seed guarantee pricing if missing
INSERT INTO guarantee_pricing (id, base_price, current_price, increment, cap, purchases)
VALUES (1, 1500, 1500, 100, 3000, 0)
ON CONFLICT (id) DO NOTHING;

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- GOOGLE REVIEWS CACHE
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
CREATE TABLE IF NOT EXISTS google_reviews (
  id               SERIAL PRIMARY KEY,
  review_id        TEXT UNIQUE NOT NULL,
  author_name      TEXT NOT NULL,
  rating           SMALLINT NOT NULL,
  text             TEXT,
  relative_time    TEXT,
  publish_time     TIMESTAMPTZ,
  profile_photo_url TEXT,
  cached_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS google_reviews_meta (
  id              INTEGER PRIMARY KEY DEFAULT 1,
  last_fetched_at TIMESTAMPTZ,
  place_id        TEXT,
  place_name      TEXT,
  overall_rating  NUMERIC(2,1),
  total_reviews   INTEGER
);

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- LEARNER ONBOARDING
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
CREATE TABLE IF NOT EXISTS learner_onboarding (
  id                 SERIAL PRIMARY KEY,
  learner_id         INTEGER NOT NULL UNIQUE REFERENCES learner_users(id) ON DELETE CASCADE,
  prior_hours_pro    INTEGER DEFAULT 0,
  prior_hours_private INTEGER DEFAULT 0,
  previous_tests     INTEGER DEFAULT 0,
  transmission       TEXT DEFAULT 'manual',
  test_booked        BOOLEAN DEFAULT FALSE,
  test_date          DATE,
  main_concerns      TEXT,
  completed_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- QUIZ RESULTS
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
CREATE TABLE IF NOT EXISTS quiz_results (
  id             SERIAL PRIMARY KEY,
  learner_id     INTEGER NOT NULL REFERENCES learner_users(id) ON DELETE CASCADE,
  question_id    TEXT NOT NULL,
  skill_key      TEXT NOT NULL,
  correct        BOOLEAN NOT NULL,
  learner_answer TEXT,
  correct_answer TEXT,
  answered_at    TIMESTAMPTZ DEFAULT NOW()
);

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- MOCK TESTS
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
CREATE TABLE IF NOT EXISTS mock_tests (
  id                     SERIAL PRIMARY KEY,
  learner_id             INTEGER NOT NULL REFERENCES learner_users(id) ON DELETE CASCADE,
  started_at             TIMESTAMPTZ DEFAULT NOW(),
  completed_at           TIMESTAMPTZ,
  result                 TEXT,
  total_driving_faults   INTEGER DEFAULT 0,
  total_serious_faults   INTEGER DEFAULT 0,
  total_dangerous_faults INTEGER DEFAULT 0,
  notes                  TEXT,
  supervisor_notes       JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS mock_test_faults (
  id               SERIAL PRIMARY KEY,
  mock_test_id     INTEGER NOT NULL REFERENCES mock_tests(id) ON DELETE CASCADE,
  part             INTEGER NOT NULL,
  skill_key        TEXT NOT NULL,
  sub_key          TEXT,
  driving_faults   INTEGER DEFAULT 0,
  serious_faults   INTEGER DEFAULT 0,
  dangerous_faults INTEGER DEFAULT 0
);

-- Ensure sub_key column exists (may be missing on older DBs)
DO $$ BEGIN
  ALTER TABLE mock_test_faults ADD COLUMN sub_key TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- AVAILABILITY SUBMISSIONS (public enquiry form)
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
CREATE TABLE IF NOT EXISTS availability_submissions (
  id                   SERIAL PRIMARY KEY,
  customer_email       TEXT NOT NULL,
  booking_reference    TEXT,
  preferred_days       TEXT[],
  available_days       TEXT[],
  frequency_preference TEXT,
  additional_notes     TEXT,
  status               TEXT DEFAULT 'pending',
  submitted_at         TIMESTAMPTZ DEFAULT NOW()
);

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- INSTRUCTOR LEARNER NOTES (per instructor-learner pair)
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
CREATE TABLE IF NOT EXISTS instructor_learner_notes (
  id              SERIAL PRIMARY KEY,
  instructor_id   INTEGER NOT NULL REFERENCES instructors(id),
  learner_id      INTEGER NOT NULL REFERENCES learner_users(id),
  notes           TEXT,
  test_date       DATE,
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(instructor_id, learner_id)
);

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- FEATURE 2: RESCHEDULING
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS rescheduled_from INTEGER REFERENCES lesson_bookings(id);
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS reschedule_count INTEGER DEFAULT 0;

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- FEATURE 10: SCHEDULING LEAD TIME
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS min_booking_notice_hours INTEGER DEFAULT 24;
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS max_booking_days_ahead INTEGER DEFAULT 84;
ALTER TABLE instructors DROP CONSTRAINT IF EXISTS chk_instructors_max_booking_days_ahead;
ALTER TABLE instructors ADD CONSTRAINT chk_instructors_max_booking_days_ahead
  CHECK (max_booking_days_ahead BETWEEN 1 AND 84);
ALTER TABLE instructors
  ADD COLUMN IF NOT EXISTS slot_start_interval_minutes INTEGER NOT NULL DEFAULT 30;
ALTER TABLE instructors
  DROP CONSTRAINT IF EXISTS chk_instructors_slot_start_interval_minutes;
ALTER TABLE instructors
  ADD CONSTRAINT chk_instructors_slot_start_interval_minutes
  CHECK (slot_start_interval_minutes IN (30, 60));

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- FEATURE 5: INSTRUCTOR-INITIATED BOOKING
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS created_by TEXT DEFAULT 'learner';
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'credit';

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- FEATURE 7: PER-BOOKING ADDRESSES
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS pickup_address TEXT;
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS dropoff_address TEXT;

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- FEATURE 8: CALENDAR START HOUR
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS calendar_start_hour INTEGER DEFAULT 7;

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- FEATURE 3: MULTIPLE LESSON TYPES & DURATIONS
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

-- Lesson types lookup table
CREATE TABLE IF NOT EXISTS lesson_types (
  id               SERIAL PRIMARY KEY,
  name             TEXT NOT NULL,
  slug             TEXT NOT NULL UNIQUE,
  duration_minutes INTEGER NOT NULL DEFAULT 90,
  price_pence      INTEGER NOT NULL DEFAULT 8250,
  colour           TEXT DEFAULT '#3b82f6',
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order       INTEGER DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Seed initial types
INSERT INTO lesson_types (name, slug, duration_minutes, price_pence, colour, sort_order)
VALUES
  ('Standard Lesson', 'standard', 90, 8250, '#3b82f6', 1),
  ('2-Hour Lesson',   '2hr',     120, 11000, '#8b5cf6', 2)
ON CONFLICT (slug) DO NOTHING;

-- Hours-based balance (stored as minutes internally)
ALTER TABLE learner_users ADD COLUMN IF NOT EXISTS balance_minutes INTEGER DEFAULT 0;
ALTER TABLE learner_users ADD COLUMN IF NOT EXISTS learner_category TEXT;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'chk_learner_users_learner_category'
       AND conrelid = 'learner_users'::regclass
  ) THEN
    ALTER TABLE learner_users
      ADD CONSTRAINT chk_learner_users_learner_category
      CHECK (learner_category IS NULL OR learner_category IN ('regular', 'sporadic', 'inactive', 'passed'));
  END IF;
END $$;
ALTER TABLE learner_users ADD COLUMN IF NOT EXISTS primary_instructor_id INTEGER REFERENCES instructors(id);
CREATE INDEX IF NOT EXISTS idx_learner_users_primary_instructor ON learner_users(primary_instructor_id);

-- Migrate existing credit balances: 1 credit = 90 minutes
DO $$ BEGIN
  UPDATE learner_users SET balance_minutes = credit_balance * 90
  WHERE balance_minutes = 0 AND credit_balance > 0;
END $$;

-- Link bookings to lesson types
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS lesson_type_id INTEGER REFERENCES lesson_types(id);
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS minutes_deducted INTEGER;

-- Backfill existing bookings as standard lesson
DO $$ BEGIN
  UPDATE lesson_bookings SET lesson_type_id = (SELECT id FROM lesson_types WHERE slug = 'standard')
  WHERE lesson_type_id IS NULL;
END $$;

-- Track minutes in credit transactions
ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS minutes INTEGER DEFAULT 0;

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- LESSON REMINDERS (Feature 1)
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS reminder_hours INTEGER DEFAULT 24;
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS daily_schedule_email BOOLEAN DEFAULT true;

CREATE TABLE IF NOT EXISTS sent_reminders (
  id             SERIAL PRIMARY KEY,
  booking_id     INTEGER REFERENCES lesson_bookings(id) ON DELETE CASCADE,
  reminder_type  TEXT NOT NULL,
  sent_at        TIMESTAMPTZ DEFAULT NOW(),
  channel        TEXT NOT NULL,
  UNIQUE(booking_id, reminder_type)
);

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- RECURRING/REPEAT BOOKINGS (Feature 6)
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS series_id UUID;

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- INSTRUCTOR EARNINGS (Feature â€“ Earnings Dashboard)
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(4,3) DEFAULT 0.850;

-- Instructor profile enhancement â€” qualifications, vehicle, service area, languages
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS adi_grade TEXT;
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS pass_rate NUMERIC(4,1);
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS years_experience INTEGER;
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS specialisms JSONB DEFAULT '[]';
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS vehicle_make TEXT;
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS vehicle_model TEXT;
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS transmission_type TEXT DEFAULT 'manual';
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS dual_controls BOOLEAN DEFAULT true;
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS service_areas JSONB DEFAULT '[]';
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS languages JSONB DEFAULT '["English"]';

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- POST-LESSON CONFIRMATION (Feature â€“ Dual Confirmation System)
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
CREATE TABLE IF NOT EXISTS lesson_confirmations (
  id                SERIAL PRIMARY KEY,
  booking_id        INTEGER NOT NULL REFERENCES lesson_bookings(id) ON DELETE CASCADE,
  confirmed_by_role TEXT NOT NULL CHECK (confirmed_by_role IN ('instructor', 'learner')),
  lesson_happened   BOOLEAN NOT NULL,
  late_party        TEXT CHECK (late_party IS NULL OR late_party IN ('instructor', 'learner')),
  late_minutes      INTEGER CHECK (late_minutes IS NULL OR late_minutes > 0),
  notes             TEXT,
  auto_confirmed    BOOLEAN DEFAULT FALSE,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(booking_id, confirmed_by_role)
);

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- DEMO EARNINGS DATA (seed Simon Edwards' diary for dashboard demo)
-- Safe to re-run: ON CONFLICT DO NOTHING.
-- To clean up: DELETE FROM lesson_bookings WHERE instructor_notes = 'demo-seed';
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
DO $$
DECLARE
  v_instructor_id INTEGER;
  v_learner_id    INTEGER;
  v_lesson_type   INTEGER;
  v_week_start    DATE;
  v_day           DATE;
BEGIN
  SELECT id INTO v_instructor_id FROM instructors WHERE LOWER(name) LIKE '%simon%edwards%' LIMIT 1;
  IF v_instructor_id IS NULL THEN RAISE NOTICE 'Instructor "Simon Edwards" not found â€” skipping seed.'; RETURN; END IF;

  SELECT id INTO v_learner_id FROM learner_users WHERE LOWER(name) LIKE '%fraser%' LIMIT 1;
  IF v_learner_id IS NULL THEN SELECT id INTO v_learner_id FROM learner_users WHERE credit_balance > 0 OR balance_minutes > 0 ORDER BY credit_balance DESC LIMIT 1; END IF;
  IF v_learner_id IS NULL THEN SELECT id INTO v_learner_id FROM learner_users ORDER BY id LIMIT 1; END IF;
  IF v_learner_id IS NULL THEN RAISE NOTICE 'No learners found â€” skipping seed.'; RETURN; END IF;

  SELECT id INTO v_lesson_type FROM lesson_types WHERE slug = 'standard' LIMIT 1;
  IF v_lesson_type IS NULL THEN v_lesson_type := 1; END IF;

  -- 4 weeks ago (completed)
  v_week_start := date_trunc('week', CURRENT_DATE)::date - 28;
  INSERT INTO lesson_bookings (learner_id, instructor_id, scheduled_date, start_time, end_time, status, lesson_type_id, instructor_notes) VALUES
    (v_learner_id, v_instructor_id, v_week_start,     '09:00', '10:30', 'completed', v_lesson_type, 'demo-seed'),
    (v_learner_id, v_instructor_id, v_week_start + 1, '10:00', '11:30', 'completed', v_lesson_type, 'demo-seed'),
    (v_learner_id, v_instructor_id, v_week_start + 2, '14:00', '15:30', 'completed', v_lesson_type, 'demo-seed'),
    (v_learner_id, v_instructor_id, v_week_start + 4, '09:00', '10:30', 'completed', v_lesson_type, 'demo-seed')
  ON CONFLICT (instructor_id, scheduled_date, start_time) DO NOTHING;

  -- 3 weeks ago (completed)
  v_week_start := date_trunc('week', CURRENT_DATE)::date - 21;
  INSERT INTO lesson_bookings (learner_id, instructor_id, scheduled_date, start_time, end_time, status, lesson_type_id, instructor_notes) VALUES
    (v_learner_id, v_instructor_id, v_week_start,     '09:00', '10:30', 'completed', v_lesson_type, 'demo-seed'),
    (v_learner_id, v_instructor_id, v_week_start + 1, '11:00', '12:30', 'completed', v_lesson_type, 'demo-seed'),
    (v_learner_id, v_instructor_id, v_week_start + 2, '09:00', '10:30', 'completed', v_lesson_type, 'demo-seed'),
    (v_learner_id, v_instructor_id, v_week_start + 3, '14:00', '15:30', 'completed', v_lesson_type, 'demo-seed'),
    (v_learner_id, v_instructor_id, v_week_start + 4, '10:00', '11:30', 'completed', v_lesson_type, 'demo-seed')
  ON CONFLICT (instructor_id, scheduled_date, start_time) DO NOTHING;

  -- 2 weeks ago (completed)
  v_week_start := date_trunc('week', CURRENT_DATE)::date - 14;
  INSERT INTO lesson_bookings (learner_id, instructor_id, scheduled_date, start_time, end_time, status, lesson_type_id, instructor_notes) VALUES
    (v_learner_id, v_instructor_id, v_week_start,     '09:00', '10:30', 'completed', v_lesson_type, 'demo-seed'),
    (v_learner_id, v_instructor_id, v_week_start + 1, '09:00', '10:30', 'completed', v_lesson_type, 'demo-seed'),
    (v_learner_id, v_instructor_id, v_week_start + 2, '11:00', '12:30', 'completed', v_lesson_type, 'demo-seed'),
    (v_learner_id, v_instructor_id, v_week_start + 4, '14:00', '15:30', 'completed', v_lesson_type, 'demo-seed')
  ON CONFLICT (instructor_id, scheduled_date, start_time) DO NOTHING;

  -- Last week (completed)
  v_week_start := date_trunc('week', CURRENT_DATE)::date - 7;
  INSERT INTO lesson_bookings (learner_id, instructor_id, scheduled_date, start_time, end_time, status, lesson_type_id, instructor_notes) VALUES
    (v_learner_id, v_instructor_id, v_week_start,     '10:00', '11:30', 'completed', v_lesson_type, 'demo-seed'),
    (v_learner_id, v_instructor_id, v_week_start + 1, '09:00', '10:30', 'completed', v_lesson_type, 'demo-seed'),
    (v_learner_id, v_instructor_id, v_week_start + 2, '14:00', '15:30', 'completed', v_lesson_type, 'demo-seed'),
    (v_learner_id, v_instructor_id, v_week_start + 3, '09:00', '10:30', 'completed', v_lesson_type, 'demo-seed'),
    (v_learner_id, v_instructor_id, v_week_start + 4, '11:00', '12:30', 'completed', v_lesson_type, 'demo-seed')
  ON CONFLICT (instructor_id, scheduled_date, start_time) DO NOTHING;

  -- This week (past days = completed, future days = confirmed)
  v_week_start := date_trunc('week', CURRENT_DATE)::date;
  FOR v_day IN SELECT d FROM generate_series(v_week_start, CURRENT_DATE - 1, '1 day'::interval) AS d LOOP
    INSERT INTO lesson_bookings (learner_id, instructor_id, scheduled_date, start_time, end_time, status, lesson_type_id, instructor_notes)
    VALUES (v_learner_id, v_instructor_id, v_day, '09:00', '10:30', 'completed', v_lesson_type, 'demo-seed')
    ON CONFLICT (instructor_id, scheduled_date, start_time) DO NOTHING;
  END LOOP;
  FOR v_day IN SELECT d FROM generate_series(CURRENT_DATE + 1, v_week_start + 4, '1 day'::interval) AS d LOOP
    INSERT INTO lesson_bookings (learner_id, instructor_id, scheduled_date, start_time, end_time, status, lesson_type_id, instructor_notes)
    VALUES (v_learner_id, v_instructor_id, v_day, '10:00', '11:30', 'confirmed', v_lesson_type, 'demo-seed')
    ON CONFLICT (instructor_id, scheduled_date, start_time) DO NOTHING;
  END LOOP;

  RAISE NOTICE 'Demo earnings seed complete!';
END $$;


-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- 020 â€” Learner Weekly Availability
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

CREATE TABLE IF NOT EXISTS learner_availability (
  id            SERIAL PRIMARY KEY,
  learner_id    INTEGER NOT NULL REFERENCES learner_users(id) ON DELETE CASCADE,
  day_of_week   SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time    TIME NOT NULL,
  end_time      TIME NOT NULL,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_learner_avail_times CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_learner_availability_learner
  ON learner_availability(learner_id);

CREATE INDEX IF NOT EXISTS idx_learner_availability_day
  ON learner_availability(day_of_week)
  WHERE active = true;


-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- 021 â€” Waiting List
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

CREATE TABLE IF NOT EXISTS waitlist (
  id                   SERIAL PRIMARY KEY,
  learner_id           INTEGER NOT NULL REFERENCES learner_users(id) ON DELETE CASCADE,
  instructor_id        INTEGER REFERENCES instructors(id) ON DELETE CASCADE,
  preferred_day        SMALLINT CHECK (preferred_day BETWEEN 0 AND 6),
  preferred_start_time TIME,
  preferred_end_time   TIME,
  lesson_type_id       INTEGER REFERENCES lesson_types(id),
  status               TEXT NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active','notified','booked','expired')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at           TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '14 days'),
  notified_at          TIMESTAMPTZ,
  CONSTRAINT chk_waitlist_times CHECK (
    (preferred_start_time IS NULL AND preferred_end_time IS NULL)
    OR (preferred_start_time IS NOT NULL AND preferred_end_time IS NOT NULL
        AND preferred_end_time > preferred_start_time)
  )
);

CREATE INDEX IF NOT EXISTS idx_waitlist_active
  ON waitlist(status, preferred_day)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_waitlist_learner
  ON waitlist(learner_id);

-- 022: Inbound iCal feed sync for instructors
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS ical_feed_url TEXT;
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS ical_last_synced_at TIMESTAMPTZ;
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS ical_sync_error TEXT;

CREATE TABLE IF NOT EXISTS instructor_external_events (
  id              SERIAL PRIMARY KEY,
  instructor_id   INTEGER NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
  event_date      DATE NOT NULL,
  start_time      TIME NOT NULL,
  end_time        TIME NOT NULL,
  is_all_day      BOOLEAN NOT NULL DEFAULT FALSE,
  uid_hash        TEXT NOT NULL,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ext_events_instructor_date
  ON instructor_external_events(instructor_id, event_date);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ext_events_dedup
  ON instructor_external_events(instructor_id, uid_hash);

-- MULTI-TENANT: SCHOOLS (must precede the first school-scoped FK)
CREATE TABLE IF NOT EXISTS schools (
  id                         SERIAL PRIMARY KEY,
  name                       TEXT NOT NULL,
  slug                       TEXT UNIQUE NOT NULL,
  logo_url                   TEXT,
  primary_colour             TEXT DEFAULT '#f97316',
  secondary_colour           TEXT DEFAULT '#1e3a5f',
  accent_colour              TEXT DEFAULT '#3b82f6',
  contact_email              TEXT,
  contact_phone              TEXT,
  website_url                TEXT,
  stripe_account_id          TEXT,
  stripe_onboarding_complete BOOLEAN DEFAULT FALSE,
  platform_fee_pct           NUMERIC(5,2) DEFAULT 0.00,
  config                     JSONB DEFAULT '{}',
  active                     BOOLEAN DEFAULT TRUE,
  created_at                 TIMESTAMPTZ DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ DEFAULT NOW()
);

-- Seed CoachCarter as school #1
INSERT INTO schools (id, name, slug, contact_email, contact_phone, primary_colour, secondary_colour, accent_colour)
VALUES (1, 'CoachCarter Driving School', 'coachcarter', 'fraser@coachcarter.uk', NULL, '#f97316', '#1e3a5f', '#3b82f6')
ON CONFLICT (id) DO NOTHING;

-- Ensure payments_enabled is set for CoachCarter (school #1) so credit deductions fire
UPDATE schools
   SET config = config || '{"payments_enabled": true}'::jsonb
 WHERE id = 1 AND (config IS NULL OR NOT (config ? 'payments_enabled'));

-- Ensure sequence is ahead of seeded id
SELECT setval('schools_id_seq', GREATEST(nextval('schools_id_seq'), 2));
-- End multi-tenant school foundation.

-- Instructor-entered timed busy blocks. These are separate from synced
-- external events so manual blocks are not overwritten by iCal refreshes.
CREATE TABLE IF NOT EXISTS instructor_busy_blocks (
  id              SERIAL PRIMARY KEY,
  instructor_id   INTEGER NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
  school_id       INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  block_date      DATE NOT NULL,
  start_time      TIME NOT NULL,
  end_time        TIME NOT NULL,
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (start_time < end_time)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_instructor_busy_block_slot
  ON instructor_busy_blocks(instructor_id, school_id, block_date, start_time, end_time);

CREATE INDEX IF NOT EXISTS idx_instructor_busy_blocks_lookup
  ON instructor_busy_blocks(school_id, instructor_id, block_date);

-- â”€â”€ Lesson offers (instructor-initiated, pending learner acceptance + payment) â”€â”€
CREATE TABLE IF NOT EXISTS lesson_offers (
  id              SERIAL PRIMARY KEY,
  token           TEXT UNIQUE NOT NULL,
  instructor_id   INTEGER NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
  learner_email   TEXT NOT NULL,
  learner_id      INTEGER REFERENCES learner_users(id),
  scheduled_date  DATE NOT NULL,
  start_time      TIME NOT NULL,
  end_time        TIME NOT NULL,
  lesson_type_id  INTEGER REFERENCES lesson_types(id),
  discount_pct    INTEGER NOT NULL DEFAULT 0 CHECK (discount_pct IN (0, 25, 50, 75, 100)),
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','accepted','expired','cancelled')),
  booking_id      INTEGER REFERENCES lesson_bookings(id),
  stripe_session_id TEXT,
  expires_at      TIMESTAMPTZ NOT NULL,
  accepted_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_offers_token ON lesson_offers(token);
CREATE INDEX IF NOT EXISTS idx_offers_expiry ON lesson_offers(expires_at) WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS uq_offer_slot
  ON lesson_offers(instructor_id, scheduled_date, start_time) WHERE status = 'pending';

-- â”€â”€ Stripe Connect & Instructor Payouts â”€â”€
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS stripe_account_id TEXT;
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS stripe_onboarding_complete BOOLEAN DEFAULT FALSE;
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS payouts_paused BOOLEAN DEFAULT FALSE;
-- Date floor for auto-payouts. NULL = no floor (legacy behaviour). When set, only bookings on
-- or after this date are swept by the Friday cron â€” protects against backfilled bookings being
-- paid out in bulk the moment an instructor completes Stripe Connect onboarding.
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS payouts_start_date DATE DEFAULT NULL;

CREATE TABLE IF NOT EXISTS instructor_payouts (
  id                  SERIAL PRIMARY KEY,
  instructor_id       INTEGER NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
  amount_pence        INTEGER NOT NULL,
  platform_fee_pence  INTEGER NOT NULL DEFAULT 0,
  stripe_transfer_id  TEXT,
  period_start        DATE NOT NULL,
  period_end          DATE NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','processing','completed','failed','skipped')),
  failure_reason      TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  completed_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_payouts_instructor_period
  ON instructor_payouts(instructor_id, period_start);

CREATE TABLE IF NOT EXISTS payout_line_items (
  id                      SERIAL PRIMARY KEY,
  payout_id               INTEGER NOT NULL REFERENCES instructor_payouts(id) ON DELETE CASCADE,
  booking_id              INTEGER NOT NULL REFERENCES lesson_bookings(id),
  price_pence             INTEGER NOT NULL,
  instructor_amount_pence INTEGER NOT NULL,
  commission_rate         NUMERIC(4,3) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_booking
  ON payout_line_items(booking_id);

CREATE INDEX IF NOT EXISTS idx_payout_lines_payout
  ON payout_line_items(payout_id);

-- â”€â”€ Fix lesson_bookings status constraint to include all valid statuses â”€â”€
ALTER TABLE lesson_bookings DROP CONSTRAINT IF EXISTS lesson_bookings_status_check;
ALTER TABLE lesson_bookings ADD CONSTRAINT lesson_bookings_status_check
  CHECK (status IN ('confirmed', 'completed', 'cancelled', 'rescheduled', 'awaiting_confirmation', 'disputed', 'no_show'));

-- â”€â”€ Sync credit_transactions.type CHECK with values the codebase actually writes â”€â”€
-- Original constraint from db/migrations/001_booking_system.sql only allowed
-- ('purchase','refund'). Code has since added: slot_purchase (webhook slot/offer
-- payments), edit_adjustment (booking edits), admin_add/admin_remove (manual
-- adjustments), referral_bonus (referee signup), referral_reward (referrer cron).
-- Inserts with the newer values were silently 23514-erroring on prod (some sites
-- swallowed in try/catch, leaving balance_minutes correct but the audit row
-- missing). Patched live 2026-05-10 after a webhook outage exposed it.
--
-- Step 2.5 (May 2026) added 'free_trial' for the slots.js handleBookFreeTrial
-- writer (zero-value credit_transactions row + BCS attribution for free
-- trials). PER-INSTRUCTOR-CREDITS-PLAN.md Â§Step 2.
--
-- Step 2c Plan B1 (May 2026) added 'legacy_grandfather' for the synthetic
-- CT rows emitted by /api/migrate-step-2c-reattribute. One synthetic CT
-- per moved grandfathered LCB row, paired with source='reconciliation'
-- and payment_method='migration'. Lets the divergence cron's
-- expected = Î£CT âˆ’ Î£min_deducted formula reconcile against the moved
-- legacy pool. See api/migrate-step-2c-reattribute.js header for the
-- forensic.
ALTER TABLE credit_transactions DROP CONSTRAINT IF EXISTS credit_transactions_type_check;
ALTER TABLE credit_transactions ADD CONSTRAINT credit_transactions_type_check
  CHECK (type IN (
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
    'request_refund',
    'instructor_transfer_out',
    'instructor_transfer_in'
  ));
-- 'request_hold' / 'request_refund' (July 2026, LESSON-REQUEST-PLAN.md):
-- credit-funded lesson requests deduct at request time (hold, minutes < 0)
-- and refund in full on decline/expiry/withdrawal (refund, minutes > 0).
-- On accept the hold is refunded and the booking re-deducts through the
-- standard bookCreditFundedSlotsTransaction FIFO path, so the pair always
-- nets zero in the divergence cron's expected = Î£CT âˆ’ draws formula.
-- Neither type is in CREDIT_BOOKING_SOURCE_TYPES â€” they are never drawable
-- FIFO sources.

-- â”€â”€ Weekly franchise fee model (alternative to commission_rate) â”€â”€
-- When non-NULL, platform takes this fixed amount per week instead of per-lesson commission.
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS weekly_franchise_fee_pence INTEGER DEFAULT NULL;
-- Audit trail: actual franchise fee deducted for each payout (may be less than configured if gross was lower)
ALTER TABLE instructor_payouts ADD COLUMN IF NOT EXISTS franchise_fee_pence INTEGER DEFAULT NULL;

-- â”€â”€ Shortfall tracking (plan item 1.3) + Â£250 vehicle deposit deduction (plan item 2.10) â”€â”€
-- shortfall_pence: positive value = amount instructor owes CCL from this period (rolls forward to next positive payout).
-- shortfall_recovered_from_payout_id: NULL until the shortfall is recovered; set to the recovering payout's id when cleared.
-- deposit_deducted_pence: Â£250 (25000) deducted from week-1 Full-Franchise payouts; stores actual amount when revenue can't cover full amount.
ALTER TABLE instructor_payouts ADD COLUMN IF NOT EXISTS shortfall_pence INTEGER NOT NULL DEFAULT 0;
ALTER TABLE instructor_payouts ADD COLUMN IF NOT EXISTS shortfall_recovered_from_payout_id INTEGER REFERENCES instructor_payouts(id);
ALTER TABLE instructor_payouts ADD COLUMN IF NOT EXISTS deposit_deducted_pence INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_instructor_payouts_unrecovered_shortfall
  ON instructor_payouts (instructor_id, period_end)
  WHERE status = 'completed' AND shortfall_pence > 0 AND shortfall_recovered_from_payout_id IS NULL;

-- â”€â”€ Setmore sync â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

-- Additional lesson types from Setmore (3hr active, others inactive)
INSERT INTO lesson_types (name, slug, duration_minutes, price_pence, colour, active, sort_order)
VALUES
  ('3-Hour Lesson', '3hr', 180, 16500, '#ef4444', true, 3),
  ('1-Hour Lesson', '1hr', 60, 5500, '#f59e0b', false, 4),
  ('Free Trial',    'trial', 60, 0, '#10b981', false, 5)
ON CONFLICT (slug) DO NOTHING;

-- Paid 1-hour lessons are active, but application logic treats them as
-- opt-in-only for instructors whose offered_lesson_types is still NULL.
UPDATE lesson_types
   SET name = '1-Hour Lesson',
       duration_minutes = 60,
       price_pence = 5500,
       colour = COALESCE(colour, '#f59e0b'),
       active = true,
       sort_order = COALESCE(sort_order, 4)
 WHERE slug = '1hr';

-- Track which Setmore appointment each booking came from (idempotent sync)
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS setmore_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_setmore_key
  ON lesson_bookings(setmore_key) WHERE setmore_key IS NOT NULL;

-- Link learners to their Setmore customer record
ALTER TABLE learner_users ADD COLUMN IF NOT EXISTS setmore_customer_key TEXT;

-- Track when a welcome email was sent to Setmore-migrated learners
ALTER TABLE learner_users ADD COLUMN IF NOT EXISTS welcome_email_sent_at TIMESTAMPTZ;

-- Link instructors to their Setmore staff record + sync status
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS setmore_staff_key TEXT;

-- Max travel time (minutes) between back-to-back pickups before warning (default 30)
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS max_travel_minutes INTEGER;
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS setmore_last_synced_at TIMESTAMPTZ;
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS setmore_sync_error TEXT;

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- School foundation created above before the first school-scoped FK.
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- MULTI-TENANT: SCHOOL PAYOUTS
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

CREATE TABLE IF NOT EXISTS instructor_availability_overrides (
  id              SERIAL PRIMARY KEY,
  instructor_id   INTEGER NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
  school_id       INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  override_date   DATE NOT NULL,
  start_time      TIME NOT NULL,
  end_time        TIME NOT NULL,
  transmission_type TEXT NOT NULL DEFAULT 'both'
                  CHECK (transmission_type IN ('manual','automatic','both')),
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (start_time < end_time)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_instructor_availability_override_slot
  ON instructor_availability_overrides(instructor_id, school_id, override_date, start_time, end_time);

CREATE INDEX IF NOT EXISTS idx_instructor_availability_overrides_lookup
  ON instructor_availability_overrides(school_id, instructor_id, override_date)
  WHERE active = TRUE;

CREATE TABLE IF NOT EXISTS school_payouts (
  id                 SERIAL PRIMARY KEY,
  school_id          INTEGER NOT NULL REFERENCES schools(id),
  amount_pence       INTEGER NOT NULL,
  platform_fee_pence INTEGER NOT NULL DEFAULT 0,
  stripe_transfer_id TEXT,
  period_start       DATE NOT NULL,
  period_end         DATE NOT NULL,
  booking_ids        INTEGER[] NOT NULL DEFAULT '{}',
  status             TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','processing','completed','failed','skipped')),
  failure_reason     TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  completed_at       TIMESTAMPTZ
);

ALTER TABLE school_payouts ADD COLUMN IF NOT EXISTS booking_ids INTEGER[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_school_payouts_school_period
  ON school_payouts(school_id, period_start);

-- â”€â”€ PR-H (audit #10) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- Normalised line-items table mirroring payout_line_items on the instructor
-- side. The school_payouts.booking_ids array had no per-booking uniqueness
-- across rows, so a crash between INSERT (status='processing') and the Stripe
-- transfer call could leave an orphan 'processing' row holding bookings that
-- the next cron run also considered eligible (the eligibility filter only
-- excluded 'completed' rows). Result: same bookings paid twice.
--
-- UNIQUE(booking_id) on the line-items table makes the second INSERT fail
-- regardless of the parent row's status â€” same shape as uq_payout_booking.

CREATE TABLE IF NOT EXISTS school_payout_line_items (
  id              SERIAL PRIMARY KEY,
  school_payout_id INTEGER NOT NULL REFERENCES school_payouts(id) ON DELETE CASCADE,
  booking_id      INTEGER NOT NULL REFERENCES lesson_bookings(id),
  price_pence     INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_school_payout_booking
  ON school_payout_line_items(booking_id);

CREATE INDEX IF NOT EXISTS idx_school_payout_lines_payout
  ON school_payout_line_items(school_payout_id);

-- Backfill from existing school_payouts.booking_ids arrays. Only the
-- 'completed' rows matter for the eligibility filter â€” historically-paid
-- bookings must not be re-eligible after the code switches to reading from
-- the line-items table. 'processing' and 'failed' rows can be skipped:
--   - 'processing' will be cleared by the rollout sequence below.
--   - 'failed' rows have booking_ids = '{}' per the existing catch block.
-- The ON CONFLICT DO NOTHING keeps the backfill idempotent if /api/migrate
-- is re-run after partial application.
INSERT INTO school_payout_line_items (school_payout_id, booking_id, price_pence)
SELECT sp.id, b_id, 0
FROM school_payouts sp,
     unnest(sp.booking_ids) AS b_id
WHERE sp.status = 'completed'
  AND array_length(sp.booking_ids, 1) > 0
ON CONFLICT (booking_id) DO NOTHING;

-- Clear booking_ids on any stale 'processing' rows so the next cron run
-- doesn't see them as still-held. There is no in-flight payout when
-- migrate runs (the cron is Friday 09:00 only), so this is safe.
UPDATE school_payouts
   SET status = 'failed',
       failure_reason = COALESCE(failure_reason, 'orphaned processing row cleared by PR-H migration'),
       booking_ids = '{}'
 WHERE status = 'processing';

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- MULTI-TENANT: ADD school_id TO ALL TENANT-SCOPED TABLES
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

-- Add school_id column to each table, backfill to 1, set NOT NULL + default
-- Using DO blocks so each ALTER is safe if column already exists

-- 1. learner_users
ALTER TABLE learner_users ADD COLUMN IF NOT EXISTS school_id INTEGER REFERENCES schools(id);
UPDATE learner_users SET school_id = 1 WHERE school_id IS NULL;
ALTER TABLE learner_users ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE learner_users ALTER COLUMN school_id SET DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_learner_users_school ON learner_users(school_id);

-- Learner issue reports and suggestions. Authenticated learner-owned data,
-- surfaced to admins as a lightweight feedback queue.
CREATE TABLE IF NOT EXISTS learner_feedback (
  id          SERIAL PRIMARY KEY,
  school_id   INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  learner_id  INTEGER NOT NULL REFERENCES learner_users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL DEFAULT 'suggestion',
  title       TEXT NOT NULL,
  message     TEXT NOT NULL,
  page_url    TEXT,
  user_agent  TEXT,
  status      TEXT NOT NULL DEFAULT 'open',
  reviewed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT learner_feedback_type_check CHECK (type IN ('issue', 'suggestion')),
  CONSTRAINT learner_feedback_status_check CHECK (status IN ('open', 'reviewed', 'closed'))
);

CREATE INDEX IF NOT EXISTS idx_learner_feedback_school_status
  ON learner_feedback(school_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_learner_feedback_learner
  ON learner_feedback(learner_id, created_at DESC);

-- 2. instructors
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS school_id INTEGER REFERENCES schools(id);
UPDATE instructors SET school_id = 1 WHERE school_id IS NULL;
ALTER TABLE instructors ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE instructors ALTER COLUMN school_id SET DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_instructors_school ON instructors(school_id);

-- 3. instructor_availability
ALTER TABLE instructor_availability ADD COLUMN IF NOT EXISTS school_id INTEGER REFERENCES schools(id);
UPDATE instructor_availability SET school_id = 1 WHERE school_id IS NULL;
ALTER TABLE instructor_availability ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE instructor_availability ALTER COLUMN school_id SET DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_instructor_availability_school ON instructor_availability(school_id);

-- 4. instructor_blackout_dates
ALTER TABLE instructor_blackout_dates ADD COLUMN IF NOT EXISTS school_id INTEGER REFERENCES schools(id);
UPDATE instructor_blackout_dates SET school_id = 1 WHERE school_id IS NULL;
ALTER TABLE instructor_blackout_dates ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE instructor_blackout_dates ALTER COLUMN school_id SET DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_instructor_blackout_dates_school ON instructor_blackout_dates(school_id);

-- 5. instructor_login_tokens
ALTER TABLE instructor_login_tokens ADD COLUMN IF NOT EXISTS school_id INTEGER REFERENCES schools(id);
UPDATE instructor_login_tokens SET school_id = 1 WHERE school_id IS NULL;
ALTER TABLE instructor_login_tokens ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE instructor_login_tokens ALTER COLUMN school_id SET DEFAULT 1;

-- 6. instructor_external_events
ALTER TABLE instructor_external_events ADD COLUMN IF NOT EXISTS school_id INTEGER REFERENCES schools(id);
UPDATE instructor_external_events SET school_id = 1 WHERE school_id IS NULL;
ALTER TABLE instructor_external_events ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE instructor_external_events ALTER COLUMN school_id SET DEFAULT 1;

-- 7. instructor_learner_notes
ALTER TABLE instructor_learner_notes ADD COLUMN IF NOT EXISTS school_id INTEGER REFERENCES schools(id);
UPDATE instructor_learner_notes SET school_id = 1 WHERE school_id IS NULL;
ALTER TABLE instructor_learner_notes ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE instructor_learner_notes ALTER COLUMN school_id SET DEFAULT 1;
ALTER TABLE instructor_learner_notes ADD COLUMN IF NOT EXISTS custom_hourly_rate_pence INTEGER;
ALTER TABLE instructor_learner_notes ADD COLUMN IF NOT EXISTS learner_category TEXT;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'chk_instructor_learner_notes_learner_category'
       AND conrelid = 'instructor_learner_notes'::regclass
  ) THEN
    ALTER TABLE instructor_learner_notes
      ADD CONSTRAINT chk_instructor_learner_notes_learner_category
      CHECK (learner_category IS NULL OR learner_category IN ('regular', 'sporadic', 'inactive', 'passed'));
  END IF;
END $$;
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;

-- One-off cleanup: delete re-imported Setmore duplicates.
-- When edit-booking cleared setmore_key, the sync re-imported the original Setmore appointment.
-- The duplicate is the re-imported one (has setmore_key, created_by='setmore_sync', no edited_at)
-- where a manually edited version already exists for the same learner+instructor+date.
DELETE FROM lesson_bookings dup
WHERE dup.setmore_key IS NOT NULL
  AND dup.created_by = 'setmore_sync'
  AND dup.edited_at IS NULL
  AND dup.id NOT IN (SELECT booking_id FROM payout_line_items)
  AND EXISTS (
    SELECT 1 FROM lesson_bookings edited
    WHERE edited.edited_at IS NOT NULL
      AND edited.instructor_id = dup.instructor_id
      AND edited.scheduled_date = dup.scheduled_date
      AND edited.learner_id = dup.learner_id
      AND edited.id != dup.id
      AND edited.status IN ('confirmed', 'completed', 'awaiting_confirmation')
  );

-- 8. instructor_payouts
ALTER TABLE instructor_payouts ADD COLUMN IF NOT EXISTS school_id INTEGER REFERENCES schools(id);
UPDATE instructor_payouts SET school_id = 1 WHERE school_id IS NULL;
ALTER TABLE instructor_payouts ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE instructor_payouts ALTER COLUMN school_id SET DEFAULT 1;

-- 9. payout_line_items
ALTER TABLE payout_line_items ADD COLUMN IF NOT EXISTS school_id INTEGER REFERENCES schools(id);
UPDATE payout_line_items SET school_id = 1 WHERE school_id IS NULL;
ALTER TABLE payout_line_items ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE payout_line_items ALTER COLUMN school_id SET DEFAULT 1;

-- 10. lesson_bookings
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS school_id INTEGER REFERENCES schools(id);
UPDATE lesson_bookings SET school_id = 1 WHERE school_id IS NULL;
ALTER TABLE lesson_bookings ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE lesson_bookings ALTER COLUMN school_id SET DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_lesson_bookings_school ON lesson_bookings(school_id);

-- 11. slot_reservations
ALTER TABLE slot_reservations ADD COLUMN IF NOT EXISTS school_id INTEGER REFERENCES schools(id);
UPDATE slot_reservations SET school_id = 1 WHERE school_id IS NULL;
ALTER TABLE slot_reservations ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE slot_reservations ALTER COLUMN school_id SET DEFAULT 1;

-- 12. credit_transactions
ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS school_id INTEGER REFERENCES schools(id);
UPDATE credit_transactions SET school_id = 1 WHERE school_id IS NULL;
ALTER TABLE credit_transactions ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE credit_transactions ALTER COLUMN school_id SET DEFAULT 1;

-- 13. lesson_types
ALTER TABLE lesson_types ADD COLUMN IF NOT EXISTS school_id INTEGER REFERENCES schools(id);
UPDATE lesson_types SET school_id = 1 WHERE school_id IS NULL;
ALTER TABLE lesson_types ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE lesson_types ALTER COLUMN school_id SET DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_lesson_types_school ON lesson_types(school_id);

-- 14. lesson_offers
ALTER TABLE lesson_offers ADD COLUMN IF NOT EXISTS school_id INTEGER REFERENCES schools(id);
UPDATE lesson_offers SET school_id = 1 WHERE school_id IS NULL;
ALTER TABLE lesson_offers ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE lesson_offers ALTER COLUMN school_id SET DEFAULT 1;

-- 15. driving_sessions
ALTER TABLE driving_sessions ADD COLUMN IF NOT EXISTS school_id INTEGER REFERENCES schools(id);
UPDATE driving_sessions SET school_id = 1 WHERE school_id IS NULL;
ALTER TABLE driving_sessions ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE driving_sessions ALTER COLUMN school_id SET DEFAULT 1;

-- 16. skill_ratings
ALTER TABLE skill_ratings ADD COLUMN IF NOT EXISTS school_id INTEGER REFERENCES schools(id);
UPDATE skill_ratings SET school_id = 1 WHERE school_id IS NULL;
ALTER TABLE skill_ratings ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE skill_ratings ALTER COLUMN school_id SET DEFAULT 1;

-- 17. learner_onboarding
ALTER TABLE learner_onboarding ADD COLUMN IF NOT EXISTS school_id INTEGER REFERENCES schools(id);
UPDATE learner_onboarding SET school_id = 1 WHERE school_id IS NULL;
ALTER TABLE learner_onboarding ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE learner_onboarding ALTER COLUMN school_id SET DEFAULT 1;

-- 18. quiz_results
ALTER TABLE quiz_results ADD COLUMN IF NOT EXISTS school_id INTEGER REFERENCES schools(id);
UPDATE quiz_results SET school_id = 1 WHERE school_id IS NULL;
ALTER TABLE quiz_results ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE quiz_results ALTER COLUMN school_id SET DEFAULT 1;

-- 19. mock_tests
ALTER TABLE mock_tests ADD COLUMN IF NOT EXISTS school_id INTEGER REFERENCES schools(id);
UPDATE mock_tests SET school_id = 1 WHERE school_id IS NULL;
ALTER TABLE mock_tests ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE mock_tests ALTER COLUMN school_id SET DEFAULT 1;

-- 20. mock_test_faults
ALTER TABLE mock_test_faults ADD COLUMN IF NOT EXISTS school_id INTEGER REFERENCES schools(id);
UPDATE mock_test_faults SET school_id = 1 WHERE school_id IS NULL;
ALTER TABLE mock_test_faults ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE mock_test_faults ALTER COLUMN school_id SET DEFAULT 1;

-- 21. learner_availability
ALTER TABLE learner_availability ADD COLUMN IF NOT EXISTS school_id INTEGER REFERENCES schools(id);
UPDATE learner_availability SET school_id = 1 WHERE school_id IS NULL;
ALTER TABLE learner_availability ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE learner_availability ALTER COLUMN school_id SET DEFAULT 1;

-- 22. waitlist
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS school_id INTEGER REFERENCES schools(id);
UPDATE waitlist SET school_id = 1 WHERE school_id IS NULL;
ALTER TABLE waitlist ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE waitlist ALTER COLUMN school_id SET DEFAULT 1;

-- 25. sent_reminders
ALTER TABLE sent_reminders ADD COLUMN IF NOT EXISTS school_id INTEGER REFERENCES schools(id);
UPDATE sent_reminders SET school_id = 1 WHERE school_id IS NULL;
ALTER TABLE sent_reminders ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE sent_reminders ALTER COLUMN school_id SET DEFAULT 1;

-- 26. lesson_confirmations
ALTER TABLE lesson_confirmations ADD COLUMN IF NOT EXISTS school_id INTEGER REFERENCES schools(id);
UPDATE lesson_confirmations SET school_id = 1 WHERE school_id IS NULL;
ALTER TABLE lesson_confirmations ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE lesson_confirmations ALTER COLUMN school_id SET DEFAULT 1;

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- MULTI-TENANT: ADMIN USERS â€” link to school (NULL = superadmin / platform)
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS school_id INTEGER REFERENCES schools(id);
-- Backfill existing admins to CoachCarter
UPDATE admin_users SET school_id = 1 WHERE school_id IS NULL AND role = 'admin';
-- superadmin rows keep school_id = NULL (platform-level)

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- MULTI-TENANT: INSTRUCTOR ONBOARDING FLAG
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS onboarding_complete BOOLEAN DEFAULT FALSE;
-- Backfill existing instructors as complete
UPDATE instructors SET onboarding_complete = TRUE WHERE onboarding_complete IS NULL OR onboarding_complete = FALSE;

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- INSTRUCTOR BOOKING SLUG (friendly URLs: /book/fraser)
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS slug TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_instructors_slug ON instructors (slug) WHERE slug IS NOT NULL;
-- Backfill slugs from first name (lowercase, alphanumeric + hyphens only)
UPDATE instructors SET slug = LOWER(REGEXP_REPLACE(SPLIT_PART(name, ' ', 1), '[^a-zA-Z0-9]', '', 'g'))
  WHERE slug IS NULL AND name IS NOT NULL;

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- GDPR: COOKIE CONSENTS
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
CREATE TABLE IF NOT EXISTS cookie_consents (
  id           SERIAL PRIMARY KEY,
  visitor_id   TEXT NOT NULL,
  learner_id   INTEGER REFERENCES learner_users(id) ON DELETE SET NULL,
  analytics    BOOLEAN NOT NULL DEFAULT FALSE,
  consented_at TIMESTAMPTZ DEFAULT NOW(),
  ip_hash      TEXT,
  user_agent   TEXT,
  school_id    INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id)
);
CREATE INDEX IF NOT EXISTS idx_cookie_consents_visitor ON cookie_consents(visitor_id);

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- GDPR: AUDIT LOG
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
CREATE TABLE IF NOT EXISTS audit_log (
  id           SERIAL PRIMARY KEY,
  admin_id     INTEGER,
  admin_email  TEXT,
  action       TEXT NOT NULL,
  target_type  TEXT,
  target_id    INTEGER,
  details      JSONB,
  ip_address   TEXT,
  school_id    INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
-- Older production schemas made admin_id NOT NULL even though audit entries
-- can be written by non-admin actors (for example instructor code sign-in).
ALTER TABLE audit_log ALTER COLUMN admin_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_log_school ON audit_log(school_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_target ON audit_log(target_type, target_id);

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- GDPR: DELETION REQUESTS
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
CREATE TABLE IF NOT EXISTS deletion_requests (
  id            SERIAL PRIMARY KEY,
  learner_id    INTEGER NOT NULL REFERENCES learner_users(id),
  token         TEXT NOT NULL UNIQUE,
  status        TEXT NOT NULL DEFAULT 'pending',
  requested_at  TIMESTAMPTZ DEFAULT NOW(),
  confirmed_at  TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  school_id     INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id)
);

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- GDPR: DATA RETENTION COLUMNS
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
ALTER TABLE learner_users ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;
ALTER TABLE learner_users ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
UPDATE learner_users SET last_activity_at = created_at WHERE last_activity_at IS NULL;

ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS school_id INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id);
CREATE INDEX IF NOT EXISTS idx_enquiries_school_id ON enquiries(school_id);

-- Multi-tenancy backfill for availability_submissions (added 2026-04-10)
ALTER TABLE availability_submissions ADD COLUMN IF NOT EXISTS school_id INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id);
CREATE INDEX IF NOT EXISTS idx_availability_submissions_school_id ON availability_submissions(school_id);

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- GDPR: CREDIT TRANSACTIONS â€” allow learner_id NULL for anonymization
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS anonymized BOOLEAN DEFAULT FALSE;

ALTER TABLE credit_transactions DROP CONSTRAINT IF EXISTS credit_transactions_learner_id_fkey;
ALTER TABLE credit_transactions ALTER COLUMN learner_id DROP NOT NULL;
DO $$ BEGIN
  ALTER TABLE credit_transactions ADD CONSTRAINT credit_transactions_learner_id_fkey
    FOREIGN KEY (learner_id) REFERENCES learner_users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- SECURITY: RATE LIMITING
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
CREATE TABLE IF NOT EXISTS rate_limits (
  id            SERIAL PRIMARY KEY,
  key           TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1,
  window_start  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Rate-limit rows are ephemeral. Keep the newest row for each key before
-- enforcing uniqueness so this migration also succeeds on databases where
-- concurrent requests previously created duplicates. The table lock keeps a
-- live request from inserting another duplicate between cleanup and index
-- creation. Ties on window_start keep the row with the greatest id.
DO $$
BEGIN
  LOCK TABLE rate_limits IN ACCESS EXCLUSIVE MODE;

  DELETE FROM rate_limits AS stale
  USING rate_limits AS newest
  WHERE stale.key = newest.key
    AND (
      stale.window_start < newest.window_start
      OR (stale.window_start = newest.window_start AND stale.id < newest.id)
    );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_rate_limits_key_unique
    ON rate_limits(key);
END $$;

-- Superseded by the unique index above. Existing installations may still
-- have this original non-unique index from an earlier migration run.
DROP INDEX IF EXISTS idx_rate_limits_key;

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- PERFORMANCE: FOREIGN KEY INDEXES (HIGH PRIORITY)
-- Missing indexes on frequently queried FK columns. Every JOIN and DELETE
-- CASCADE benefits from these.
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

-- lesson_bookings â€” most queried table, was missing all FK indexes
CREATE INDEX IF NOT EXISTS idx_lesson_bookings_learner_id ON lesson_bookings(learner_id);
CREATE INDEX IF NOT EXISTS idx_lesson_bookings_instructor_id ON lesson_bookings(instructor_id);
CREATE INDEX IF NOT EXISTS idx_lesson_bookings_lesson_type_id ON lesson_bookings(lesson_type_id);

-- Composite: the most common admin/dashboard query pattern
CREATE INDEX IF NOT EXISTS idx_lesson_bookings_school_status_date
  ON lesson_bookings(school_id, status, scheduled_date);

-- Composite: instructor slot availability checks
CREATE INDEX IF NOT EXISTS idx_lesson_bookings_instructor_date
  ON lesson_bookings(instructor_id, scheduled_date, start_time);

-- Composite: learner booking history
CREATE INDEX IF NOT EXISTS idx_lesson_bookings_learner_status
  ON lesson_bookings(learner_id, status);

-- credit_transactions â€” queried on every profile/dashboard load
CREATE INDEX IF NOT EXISTS idx_credit_transactions_learner_id ON credit_transactions(learner_id);

-- driving_sessions â€” progress tracking queries
CREATE INDEX IF NOT EXISTS idx_driving_sessions_user_id ON driving_sessions(user_id);

-- skill_ratings â€” progress tracking queries
CREATE INDEX IF NOT EXISTS idx_skill_ratings_user_id ON skill_ratings(user_id);

-- quiz_results / mock_tests â€” learner progress
CREATE INDEX IF NOT EXISTS idx_quiz_results_learner_id ON quiz_results(learner_id);
CREATE INDEX IF NOT EXISTS idx_mock_tests_learner_id ON mock_tests(learner_id);

-- slot_reservations â€” booking flow
CREATE INDEX IF NOT EXISTS idx_slot_reservations_learner_id ON slot_reservations(learner_id);
CREATE INDEX IF NOT EXISTS idx_slot_reservations_instructor_id ON slot_reservations(instructor_id);

-- instructor notes â€” learner detail page
CREATE INDEX IF NOT EXISTS idx_instructor_learner_notes_learner_id ON instructor_learner_notes(learner_id);
CREATE INDEX IF NOT EXISTS idx_instructor_learner_notes_instructor_id ON instructor_learner_notes(instructor_id);

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- PERFORMANCE: MEDIUM PRIORITY FK INDEXES
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

-- lesson_confirmations â€” joined on booking lookups
CREATE INDEX IF NOT EXISTS idx_lesson_confirmations_booking_id ON lesson_confirmations(booking_id);

-- sent_reminders â€” reminder dedup checks
CREATE INDEX IF NOT EXISTS idx_sent_reminders_booking_id ON sent_reminders(booking_id);

-- lesson_offers â€” offer lookups by learner
CREATE INDEX IF NOT EXISTS idx_lesson_offers_learner_id ON lesson_offers(learner_id);

-- instructor_availability â€” filtered by instructor
CREATE INDEX IF NOT EXISTS idx_instructor_availability_instructor_id ON instructor_availability(instructor_id);

-- instructor_login_tokens â€” token lookup by instructor
CREATE INDEX IF NOT EXISTS idx_instructor_login_tokens_instructor_id ON instructor_login_tokens(instructor_id);

-- magic_link_tokens â€” login lookups by email/phone
CREATE INDEX IF NOT EXISTS idx_magic_link_tokens_email ON magic_link_tokens(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_magic_link_tokens_phone ON magic_link_tokens(phone) WHERE phone IS NOT NULL;
ALTER TABLE magic_link_tokens ADD COLUMN IF NOT EXISTS school_id INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id);

-- admin_users â€” school scoping
CREATE INDEX IF NOT EXISTS idx_admin_users_school_id ON admin_users(school_id) WHERE school_id IS NOT NULL;

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- PERFORMANCE: DEFAULTS & CONSTRAINTS
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

-- Ensure new learners get last_activity_at set automatically
ALTER TABLE learner_users ALTER COLUMN last_activity_at SET DEFAULT NOW();

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- GDPR: TERMS & CONDITIONS ACCEPTANCE
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
ALTER TABLE learner_users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- MOCK TEST MODES & FOCUSED PRACTICE (April 2026)
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

-- Mock test mode split: supervisor vs instructor
ALTER TABLE mock_tests ADD COLUMN IF NOT EXISTS mode TEXT;
ALTER TABLE mock_tests ADD COLUMN IF NOT EXISTS route_id TEXT;
ALTER TABLE mock_tests ADD COLUMN IF NOT EXISTS instructor_id INTEGER REFERENCES instructors(id) ON DELETE SET NULL;
ALTER TABLE mock_tests ADD COLUMN IF NOT EXISTS supervisor_notes JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_mock_tests_instructor ON mock_tests(instructor_id) WHERE instructor_id IS NOT NULL;

-- Supervisor rating on fault records (D/S/X stay 0 in supervisor mode)
ALTER TABLE mock_test_faults ADD COLUMN IF NOT EXISTS supervisor_rating TEXT;

-- Focused practice sessions (companion to driving_sessions)
CREATE TABLE IF NOT EXISTS focused_practice_sessions (
  id              SERIAL PRIMARY KEY,
  session_id      INTEGER NOT NULL REFERENCES driving_sessions(id) ON DELETE CASCADE,
  learner_id      INTEGER NOT NULL REFERENCES learner_users(id) ON DELETE CASCADE,
  school_id       INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  focus_areas     JSONB NOT NULL,
  suggested_areas JSONB,
  reflections     JSONB,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_focused_practice_learner ON focused_practice_sessions(learner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_focused_practice_session ON focused_practice_sessions(session_id);

-- â”€â”€ Flexible offers: nullable slot fields + custom price (April 2026) â”€â”€
-- Allow offers without a pinned slot (learner picks their own time).
-- Existing slot-pinned offers keep working â€” these columns simply become optional.
ALTER TABLE lesson_offers ALTER COLUMN scheduled_date DROP NOT NULL;
ALTER TABLE lesson_offers ALTER COLUMN start_time DROP NOT NULL;
ALTER TABLE lesson_offers ALTER COLUMN end_time DROP NOT NULL;

-- Custom price in pence: instructor sets exact amount instead of rigid discount tiers.
-- NULL means use the discount_pct calculation (backward compat with existing offers).
ALTER TABLE lesson_offers ADD COLUMN IF NOT EXISTS offer_price_pence INTEGER;

-- Replace uq_offer_slot: only enforce slot uniqueness on slot-pinned offers.
-- (Flexible offers have no date/time so cannot conflict on a slot.)
DROP INDEX IF EXISTS uq_offer_slot;
CREATE UNIQUE INDEX IF NOT EXISTS uq_offer_slot
  ON lesson_offers(instructor_id, scheduled_date, start_time)
  WHERE status = 'pending' AND scheduled_date IS NOT NULL;

-- Allow link-only offers (no email required) and store learner name on offer
ALTER TABLE lesson_offers ADD COLUMN IF NOT EXISTS learner_name TEXT;
ALTER TABLE lesson_offers ALTER COLUMN learner_email DROP NOT NULL;

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- REFERRAL SYSTEM (April 2026)
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

-- Referral codes â€” one per learner, unique per school
CREATE TABLE IF NOT EXISTS referrals (
  id          SERIAL PRIMARY KEY,
  learner_id  INTEGER NOT NULL REFERENCES learner_users(id) ON DELETE CASCADE,
  school_id   INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  code        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(code, school_id)
);
CREATE INDEX IF NOT EXISTS idx_referrals_learner_id ON referrals(learner_id);
CREATE INDEX IF NOT EXISTS idx_referrals_school_id ON referrals(school_id);
CREATE INDEX IF NOT EXISTS idx_referrals_code ON referrals(code);

-- Permanent referrer link on learner_users
ALTER TABLE learner_users ADD COLUMN IF NOT EXISTS referred_by INTEGER REFERENCES learner_users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_learner_users_referred_by ON learner_users(referred_by);

-- Carry referral code through magic link signup flow
ALTER TABLE magic_link_tokens ADD COLUMN IF NOT EXISTS referral_code TEXT;

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- REMOVED: Q&A feature (April 2026)
-- Tables dropped entirely; see db/migrations/014_qa_system.sql for history.
-- Idempotent DROPs so repeated migrate runs are safe.
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
DROP TABLE IF EXISTS qa_answers;
DROP TABLE IF EXISTS qa_questions;

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- INSTRUCTOR OFFERED LESSON TYPES (April 2026)
-- NULL = instructor offers all active lesson types (backward compat default)
-- Explicit array of slugs e.g. '["standard","2hr"]' restricts which types
-- appear on the instructor's public booking page.
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS offered_lesson_types JSONB DEFAULT NULL;

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- FREE TRIAL: guest_phone on lesson_bookings (April 2026)
-- Stores the raw phone number submitted on the free-trial form so the
-- one-trial guard can match it even when the learner_users row ends up
-- with phone=NULL (phone-collision fallback during INSERT).
-- NULL for all non-free-trial bookings.
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS guest_phone TEXT;
CREATE INDEX IF NOT EXISTS idx_lesson_bookings_guest_phone ON lesson_bookings(guest_phone) WHERE guest_phone IS NOT NULL;

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- REFERRAL REWARDS â€” per-booking idempotency (April 2026)
-- Reward model: recurring. Every completed paid lesson by a referred learner
-- generates floor(duration/3) minutes of credit for the referrer.
-- Issued by api/cron-referral-rewards.js after a 7-day grace window.
-- The column is the idempotency key â€” once stamped, the booking will never
-- be rewarded again, even if the cron re-runs.
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS referral_rewarded_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_lesson_bookings_referral_pending
  ON lesson_bookings(scheduled_date, status)
  WHERE referral_rewarded_at IS NULL AND status = 'completed';

-- Backfill: any referee whose referrer already received a referral_reward credit
-- transaction under the old purchase-time logic â€” mark their EARLIEST completed
-- non-free-trial booking as already-rewarded, so the new cron does not double-pay.
-- Idempotent: only stamps bookings where referral_rewarded_at IS NULL.
UPDATE lesson_bookings lb
   SET referral_rewarded_at = NOW()
  FROM (
    SELECT DISTINCT lu.id AS referee_id
      FROM learner_users lu
      JOIN credit_transactions ct ON ct.learner_id = lu.referred_by
     WHERE lu.referred_by IS NOT NULL
       AND ct.type = 'referral_reward'
  ) referees
 WHERE lb.learner_id = referees.referee_id
   AND lb.status = 'completed'
   AND lb.payment_method <> 'free'
   AND lb.referral_rewarded_at IS NULL
   AND lb.id = (
     SELECT MIN(lb2.id) FROM lesson_bookings lb2
      WHERE lb2.learner_id = referees.referee_id
        AND lb2.status = 'completed'
        AND lb2.payment_method <> 'free'
   );

-- Seed CoachCarter referral config (school 1). Idempotent: only sets keys
-- that are missing, so admin overrides via update-referral-config persist.
UPDATE schools
   SET config = config || jsonb_build_object(
     'referral_enabled', COALESCE(config->'referral_enabled', 'true'::jsonb),
     'referral_reward_minutes', COALESCE(config->'referral_reward_minutes', '30'::jsonb),
     'referral_welcome_bonus_minutes', COALESCE(config->'referral_welcome_bonus_minutes', '90'::jsonb)
   )
 WHERE id = 1;

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- REFERRAL CLICK LOG (April 2026)
-- One row per visit to /r/<code>. Pre-signup, so referee_id is unknown here.
-- Used for: (a) attribution debugging ("my friend used my link and I got
-- nothing"), (b) light abuse detection (one IP hammering one code), (c) giving
-- the referrer some signal that their link is being clicked even before
-- anyone signs up. ip_hash (not raw IP) keeps this GDPR-friendly.
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
CREATE TABLE IF NOT EXISTS referral_clicks (
  id            SERIAL PRIMARY KEY,
  referral_code TEXT NOT NULL,
  school_id     INTEGER NOT NULL REFERENCES schools(id) DEFAULT 1,
  ip_hash       TEXT,
  user_agent    TEXT,
  referer       TEXT,
  clicked_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_referral_clicks_code ON referral_clicks(referral_code);
CREATE INDEX IF NOT EXISTS idx_referral_clicks_school ON referral_clicks(school_id);
CREATE INDEX IF NOT EXISTS idx_referral_clicks_clicked_at ON referral_clicks(clicked_at);

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- BULK CREDIT PRICING (April 2026, tiers revised May 2026)
-- Per-school config moved from a hardcoded constant in api/credits.js to
-- schools.config.pricing.bulk_hourly_pence + bulk_discount_tiers. This seed
-- sets CoachCarter's bulk-credit pricing: Â£55/hr with 12hr/24hr/36hr â†’
-- 2.5%/5%/7.5%. Idempotent: only sets the keys if they're not already present,
-- so any admin edit via the editor persists across migration re-runs.
--
-- New schools onboarding via InstructorBook get NO bulk pricing seeded. They
-- fall back to their standard 90-min lesson type's hourly rate (= no bulk
-- discount), which is the safe default â€” admin must opt in to bulk discounts
-- via the editor.
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
UPDATE schools
   SET config = jsonb_set(
         jsonb_set(
           COALESCE(config, '{}'::jsonb),
           '{pricing}',
           COALESCE(config->'pricing', '{}'::jsonb) || jsonb_build_object(
             'bulk_hourly_pence',
             COALESCE(config->'pricing'->'bulk_hourly_pence', '5500'::jsonb)
           ),
           true
         ),
         '{pricing,bulk_discount_tiers}',
         COALESCE(
           config->'pricing'->'bulk_discount_tiers',
           '[{"min_hours":12,"discount_pct":2.5},{"min_hours":24,"discount_pct":5},{"min_hours":36,"discount_pct":7.5}]'::jsonb
         ),
         true
       )
 WHERE id = 1
   AND (config->'pricing'->'bulk_hourly_pence' IS NULL
        OR config->'pricing'->'bulk_discount_tiers' IS NULL);

-- One-time correction (May 2026): replace the original 4/8/12 seed for
-- CoachCarter (school_id=1) with the intended 2.5/5/7.5 tiers. Gated on the
-- exact old values so it only runs once and never clobbers a later admin
-- edit. After the first successful run this is a no-op.
UPDATE schools
   SET config = jsonb_set(
         config,
         '{pricing,bulk_discount_tiers}',
         '[{"min_hours":12,"discount_pct":2.5},{"min_hours":24,"discount_pct":5},{"min_hours":36,"discount_pct":7.5}]'::jsonb,
         true
       )
 WHERE id = 1
   AND config->'pricing'->'bulk_discount_tiers'
       = '[{"min_hours":12,"discount_pct":4},{"min_hours":24,"discount_pct":8},{"min_hours":36,"discount_pct":12}]'::jsonb;

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- PASSWORD AUTH (May 2026)
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- Replaces magic-link login for learners + instructors. Magic links are kept
-- only for password reset (via 6-digit email code) and as a one-time migration
-- path for existing accounts with no password set.
--
-- Admins already have password auth â€” see `admin_users.password_hash`.
--
-- learner_users.password_hash already exists (April 2026, kept nullable when
-- magic links replaced passwords). Just add email_verified.
--
-- instructors needs both password_hash + email_verified (was magic-link only).
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

-- learner_users: add email_verified (password_hash already exists)
ALTER TABLE learner_users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE learner_users ADD COLUMN IF NOT EXISTS password_set_at TIMESTAMPTZ;

-- instructors: add password_hash + email_verified
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS password_set_at TIMESTAMPTZ;
-- Set TRUE when an admin (re)sets an instructor's password. The instructor
-- is forced through a change-password screen on next login, after which
-- this is cleared. Prevents the admin-typed password from lingering.
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT FALSE;

-- admin_users: add email_verified for parity (password_hash already NOT NULL)
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT TRUE;
-- Existing admins were created via SQL/superadmin â†’ email is implicitly verified.

-- magic_link_tokens: add purpose column to distinguish migration / reset / login
-- ('login' is the legacy default; new flows use 'reset' or 'set-password')
ALTER TABLE magic_link_tokens ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'login';

-- magic_link_tokens: add a short 6-digit email_code column. The existing
-- `token` column stays as the long URL nonce (kept for password-reset emails
-- and backwards compat). The short code lives here so we don't collide on
-- the global UNIQUE constraint on `token` when two emails happen to draw
-- the same 6 digits. Lookups use (email, email_code, purpose, used=false)
-- which is scoped, not global.
ALTER TABLE magic_link_tokens ADD COLUMN IF NOT EXISTS email_code TEXT;

-- Role column lets us scope codes per role (a learner + instructor can share
-- the same email but live in different tables). Default 'learner' for legacy
-- rows, since pre-existing email magic-links were learner-only.
ALTER TABLE magic_link_tokens ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'learner';

-- Index for fast lookup of unused tokens by email + purpose (used by reset flow)
CREATE INDEX IF NOT EXISTS idx_magic_link_tokens_email_purpose
  ON magic_link_tokens(email, purpose) WHERE used = false;
CREATE INDEX IF NOT EXISTS idx_magic_link_tokens_email_code
  ON magic_link_tokens(email, email_code, role, purpose) WHERE used = false;

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- May 2026: retire the waitlist
--
-- Replaced by `learner_availability` driving cancellation notifications via
-- api/_notify-availability.js. Weekly availability is now the single primitive
-- for "ping me when something opens up". See CLAUDE.md.
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
DROP TABLE IF EXISTS waitlist CASCADE;

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- May 2026: broadcast offers (PR 2a)
--
-- Extend lesson_offers to support 1-slot-to-many-learners broadcasts. When a
-- booking is cancelled <48h before lesson start and the instructor opted in,
-- _notify-availability.js mints a "batch" of offers (one row per matching
-- learner) at 25% off. First learner to accept wins; siblings get superseded
-- and notified that the slot is no longer available.
--
-- Manual 1:1 offers (the existing "Offer a lesson" feature) are unchanged â€”
-- new rows simply default to kind='manual'.
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

-- Distinguish manual (1:1) offers from broadcast (1:many).
ALTER TABLE lesson_offers ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'manual'
  CHECK (kind IN ('manual','broadcast'));

-- Group all rows in one fan-out together. NULL for manual offers.
ALTER TABLE lesson_offers ADD COLUMN IF NOT EXISTS batch_id UUID;

-- Why the broadcast was sent. NULL for manual offers.
ALTER TABLE lesson_offers ADD COLUMN IF NOT EXISTS trigger TEXT
  CHECK (trigger IS NULL OR trigger IN ('cancellation','instructor_manual'));

-- New status value: a sibling lost the race and was superseded.
ALTER TABLE lesson_offers DROP CONSTRAINT IF EXISTS lesson_offers_status_check;
ALTER TABLE lesson_offers ADD CONSTRAINT lesson_offers_status_check
  CHECK (status IN ('pending','accepted','expired','cancelled','superseded'));

-- Replace per-slot uniqueness so it only applies to manual offers. Broadcasts
-- intentionally have many pending rows for the same slot (one per recipient).
DROP INDEX IF EXISTS uq_offer_slot;
CREATE UNIQUE INDEX IF NOT EXISTS uq_offer_slot_manual
  ON lesson_offers(instructor_id, scheduled_date, start_time)
  WHERE status = 'pending' AND scheduled_date IS NOT NULL AND kind = 'manual';

-- Lookup: "find all pending siblings of this batch" (used in supersede logic).
CREATE INDEX IF NOT EXISTS idx_offers_batch
  ON lesson_offers(batch_id) WHERE batch_id IS NOT NULL;

-- Lookup: "find pending broadcast offers on this slot" (used in normal-booking
-- hook to supersede broadcasts when a learner books via the regular flow).
CREATE INDEX IF NOT EXISTS idx_offers_slot_pending_broadcast
  ON lesson_offers(instructor_id, scheduled_date, start_time)
  WHERE status = 'pending' AND kind = 'broadcast';

-- Per-instructor opt-in for cancellation auto-broadcasts. Default OFF so nothing
-- changes for existing instructors until they explicitly enable it.
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS broadcast_offers_enabled
  BOOLEAN NOT NULL DEFAULT FALSE;

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- Lesson offers: optional weekly-repeat series (May 2026)
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- Instructors can offer a slot with up to 18 weekly repeats. The learner picks
-- how many on the accept page (1..max_repeat_weeks). On payment the webhook
-- creates a series sharing one series_id, skipping any clashing weeks (existing
-- booking, blackout, no availability) up to a 18-week lookahead from the
-- original date.
--
-- This is the only path that may create bookings beyond the global 12-week
-- (84-day) advance cap â€” the instructor explicitly opted in by setting it.
ALTER TABLE lesson_offers ADD COLUMN IF NOT EXISTS max_repeat_weeks INTEGER
  CHECK (max_repeat_weeks IS NULL OR max_repeat_weeks BETWEEN 1 AND 18);

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- Balance audit trail (May 2026)
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- DB-level safety net for every change to learner_users.balance_minutes /
-- credit_balance. Catches what credit_transactions misses â€” namely booking
-- deductions, cancel refunds, free-offer credits, and (the original motivation)
-- raw SQL run outside the app. Triggered by an investigation on 2026-05-10
-- where a learner had 270 mins on their account with zero credit_transactions
-- rows and zero audit_log entries.
--
-- One row is written for every UPDATE/INSERT/DELETE on learner_users where
-- balance_minutes or credit_balance actually changed. The trigger captures
-- session_user (Postgres role) and application_name (set by the connection),
-- which together distinguish app traffic from raw SQL.
CREATE TABLE IF NOT EXISTS balance_audit (
  id                     BIGSERIAL PRIMARY KEY,
  learner_id             INTEGER NOT NULL,
  op                     TEXT NOT NULL CHECK (op IN ('INSERT', 'UPDATE', 'DELETE')),
  old_balance_minutes    INTEGER,
  new_balance_minutes    INTEGER,
  old_credit_balance     INTEGER,
  new_credit_balance     INTEGER,
  delta_minutes          INTEGER,
  delta_credits          INTEGER,
  db_session_user        TEXT,
  application_name       TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_balance_audit_learner_created
  ON balance_audit(learner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_balance_audit_created
  ON balance_audit(created_at DESC);

CREATE OR REPLACE FUNCTION trg_balance_audit() RETURNS TRIGGER
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  old_bm INTEGER;
  new_bm INTEGER;
  old_cb INTEGER;
  new_cb INTEGER;
BEGIN
  IF TG_OP = 'INSERT' THEN
    old_bm := NULL; old_cb := NULL;
    new_bm := NEW.balance_minutes; new_cb := NEW.credit_balance;
    IF COALESCE(new_bm, 0) = 0 AND COALESCE(new_cb, 0) = 0 THEN
      RETURN NEW;
    END IF;
    INSERT INTO public.balance_audit (learner_id, op, old_balance_minutes, new_balance_minutes,
      old_credit_balance, new_credit_balance, delta_minutes, delta_credits,
      db_session_user, application_name)
    VALUES (NEW.id, 'INSERT', NULL, new_bm, NULL, new_cb,
      COALESCE(new_bm, 0), COALESCE(new_cb, 0),
      session_user, pg_catalog.current_setting('application_name', true));
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    old_bm := OLD.balance_minutes; new_bm := NEW.balance_minutes;
    old_cb := OLD.credit_balance;  new_cb := NEW.credit_balance;
    IF old_bm IS NOT DISTINCT FROM new_bm AND old_cb IS NOT DISTINCT FROM new_cb THEN
      RETURN NEW;
    END IF;
    INSERT INTO public.balance_audit (learner_id, op, old_balance_minutes, new_balance_minutes,
      old_credit_balance, new_credit_balance, delta_minutes, delta_credits,
      db_session_user, application_name)
    VALUES (NEW.id, 'UPDATE', old_bm, new_bm, old_cb, new_cb,
      COALESCE(new_bm, 0) - COALESCE(old_bm, 0),
      COALESCE(new_cb, 0) - COALESCE(old_cb, 0),
      session_user, pg_catalog.current_setting('application_name', true));
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.balance_audit (learner_id, op, old_balance_minutes, new_balance_minutes,
      old_credit_balance, new_credit_balance, delta_minutes, delta_credits,
      db_session_user, application_name)
    VALUES (OLD.id, 'DELETE', OLD.balance_minutes, NULL, OLD.credit_balance, NULL,
      -COALESCE(OLD.balance_minutes, 0), -COALESCE(OLD.credit_balance, 0),
      session_user, pg_catalog.current_setting('application_name', true));
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

ALTER FUNCTION public.trg_balance_audit() OWNER TO neondb_owner;
REVOKE ALL ON FUNCTION public.trg_balance_audit() FROM PUBLIC;

DROP TRIGGER IF EXISTS balance_audit_trigger ON learner_users;
CREATE TRIGGER balance_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON learner_users
  FOR EACH ROW EXECUTE FUNCTION trg_balance_audit();

-- â”€â”€ Collapse booking statuses from 7 to 3 (May 2026) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- See BOOKING-STATUS-RESTRUCTURE-PLAN.md and docs/booking-statuses.md.
-- Pre-migration audit (2026-05-15): 17 â†’ scheduled, 52 â†’ chargeable,
-- 46 â†’ refunded, 0 unmapped, 0 NULLs, 0 disputed rows requiring review.
--
-- Mapping:
--   confirmed, awaiting_confirmation       â†’ scheduled
--   completed, no_show, disputed           â†’ chargeable
--   cancelled, rescheduled                 â†’ refunded
--
-- Idempotent: the DROP CONSTRAINT and CASE are safe to re-run. The CASE's
-- ELSE clause preserves any value that already matches the new vocabulary,
-- so running this block twice is a no-op on the second run.
--
-- Slot-uniqueness predicate swap: the legacy partial index
-- `uq_instructor_slot` (db/migrations/001_booking_system.sql) had
-- `WHERE status != 'cancelled'`, which kept multi-cancel and
-- cancel-then-rebook history rows out of the uniqueness check. With the
-- collapse, `cancelled` AND `rescheduled` both map to `refunded` â€” under
-- the old predicate the rebook-row + the renamed cancellation row would
-- both be visible to the index and trigger a duplicate-key error during
-- the UPDATE below. Drop the index before the UPDATE and recreate it
-- with the new vocabulary predicate (`!= 'refunded'`) afterwards.
DROP INDEX IF EXISTS uq_instructor_slot;
ALTER TABLE lesson_bookings DROP CONSTRAINT IF EXISTS uq_booking_slot;

ALTER TABLE lesson_bookings DROP CONSTRAINT IF EXISTS lesson_bookings_status_check;

UPDATE lesson_bookings SET status = CASE status
  WHEN 'confirmed'             THEN 'scheduled'
  WHEN 'awaiting_confirmation' THEN 'scheduled'
  WHEN 'completed'             THEN 'chargeable'
  WHEN 'no_show'               THEN 'chargeable'
  WHEN 'disputed'              THEN 'chargeable'
  WHEN 'cancelled'             THEN 'refunded'
  WHEN 'rescheduled'           THEN 'refunded'
  ELSE status
END
WHERE status IN ('confirmed','awaiting_confirmation','completed','no_show','disputed','cancelled','rescheduled');

ALTER TABLE lesson_bookings ADD CONSTRAINT lesson_bookings_status_check
  CHECK (status IN ('scheduled', 'chargeable', 'refunded'));

-- Re-create the slot-uniqueness partial index with the new vocabulary.
-- Semantic preserved: a refunded slot is free for someone else to take.
CREATE UNIQUE INDEX IF NOT EXISTS uq_instructor_slot
  ON lesson_bookings(instructor_id, scheduled_date, start_time)
  WHERE status != 'refunded';

-- Late-cancel-under-48h flag. See docs/booking-statuses.md.
-- TRUE means: learner cancelled inside the 48h window, credit was forfeited,
-- booking stays `scheduled` until the cron flips it to `chargeable`.
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS credit_forfeited BOOLEAN NOT NULL DEFAULT FALSE;

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- STRIPE-FEE PASS-THROUGH (Step 4f.a of INSTRUCTOR-PAYMENTS-PLAN.md)
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- The instructor absorbs the Stripe processing fee on each payment they receive
-- (decision A3: net-of-Stripe at the booking level). We snapshot the fee that
-- Stripe actually charged at webhook time, then subtract it from the instructor
-- contribution at payout time.
--
-- credit_transactions.stripe_fee_pence is the CANONICAL source-of-truth row:
-- it's the fee Stripe reported for the underlying charge.
--
-- lesson_bookings.stripe_fee_pence is the ATTRIBUTED SHARE for that booking.
-- For single-lesson bookings it equals the credit_transaction's fee. For bulk
-- packs it's the pro-rata share by minutes drawn (Step 4g's draw logic owns
-- the split via booking_credit_sources).
--
-- All three columns are nullable. NULL is treated as zero by the payout code.
--
-- stripe_fee_source records provenance:
--   'balance_transaction' â€” canonical, from Stripe API at webhook time
--   'estimated'           â€” computed locally, awaiting reconciliation
--   NULL                  â€” no fee (e.g. credit-redemption with no fresh charge)
ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS stripe_fee_pence INTEGER;
ALTER TABLE lesson_bookings    ADD COLUMN IF NOT EXISTS stripe_fee_pence INTEGER;
ALTER TABLE lesson_bookings    ADD COLUMN IF NOT EXISTS stripe_fee_source TEXT;

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- STRIPE-FEE PASS-THROUGH â€” payout historical breakdown (Step 4f.d)
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- Capture the Stripe fees that were subtracted from each weekly payout so the
-- breakdown is queryable historically (matches the 4-line earnings UI:
-- gross â†’ Stripe fees â†’ franchise fee / commission â†’ net).
--
-- Stripe fees come off totalGross BEFORE the franchise/deposit/shortfall math
-- runs. They never enter the carry-forward shortfall ledger â€” they're a
-- pass-through cost, not a debt to the platform.
ALTER TABLE instructor_payouts ADD COLUMN IF NOT EXISTS stripe_fees_pence INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payout_line_items  ADD COLUMN IF NOT EXISTS stripe_fee_pence  INTEGER NOT NULL DEFAULT 0;

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- TEST-ACCOUNT FLAG (for liability accuracy on the platform-balance widget)
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- Phantom liability discovered 2026-05-16: 7 of 20 learner rows with positive
-- balance were Fraser's own test accounts (~Â£4,872.50 of false credit liability),
-- inflating the platform-balance widget's "owed to learners" figure by ~60%.
--
-- New explicit flag â€” heuristics on email/name would bite when a real learner
-- happens to have "test" in their name. Default FALSE keeps live learners untouched.
-- Excluded from BOTH the learner_credit_pence and scheduled_float_pence
-- calculations in api/admin.js handlePlatformBalance.
--
-- To flag new test accounts going forward, set the column via SQL:
--   UPDATE learner_users SET is_test_account = TRUE WHERE id = <X>;
-- (Admin UI deferred until pain shows up â€” manual SQL is fine while only Fraser
-- creates test accounts.)
ALTER TABLE learner_users ADD COLUMN IF NOT EXISTS is_test_account BOOLEAN NOT NULL DEFAULT FALSE;

-- One-time flag of the 7 known test rows identified in the 2026-05-16 audit.
-- ON CONFLICT DO NOTHING isn't applicable here; using id-based UPDATE which is
-- safely idempotent (flagging an already-flagged row is a no-op).
UPDATE learner_users SET is_test_account = TRUE WHERE id IN (
  15,  -- fraser carter / coachcarteruk@gmail.com (admin account, 1860min / Â£1705)
  14,  -- Fraser Learner Test / frasercarter95@gmail.com (1710min / Â£1567.50)
  24,  -- Fraser / no email (orphan, 1650min / Â£1512.50)
  52,  -- Test Learner / coachcarteruk+testlearner@gmail.com (630min / Â£577.50)
  53,  -- Test Delete / coachcarteruk+testdelete@gmail.com (450min / Â£412.50)
  54,  -- Test Empty / coachcarteruk+testempty@gmail.com (450min / Â£412.50)
  10   -- fraser@coachcarter.uk (90min / Â£82.50)
);
-- NOT flagged: id=42 Phil Carter â€” almost certainly a real family member
-- with a real booking pattern. Leave as live liability.

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- PLATFORM BALANCE SNAPSHOTS (widget alert layer, 2026-05-17)
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- Daily snapshot of the Next Payout Preview widget's state plus trailing-30d
-- cash flow. Two purposes:
--   1. Trigger A â€” if a real payout fails inside the next 24h despite the most
--      recent snapshot reporting status='green', the widget was lying. Alert.
--   2. Trigger B â€” coarse Option A bias check: if trailing-30d payout outflow
--      exceeds trailing-30d Stripe inflow by more than a calibrated floor, the
--      cron is bleeding the float (likely the bulk-pack list-rate overpay bias
--      tracked in project_credit_funded_default.md). Alert.
-- Written daily by api/cron-balance-snapshot.js (Vercel cron). Read by the
-- failure-path branch in api/_payout-helpers.js (Trigger A) and at the end of
-- the snapshot cron itself (Trigger B).
CREATE TABLE IF NOT EXISTS platform_balance_snapshots (
  id                                   SERIAL PRIMARY KEY,
  captured_at                          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status                               TEXT NOT NULL CHECK (status IN ('green','red')),
  available_pence                      INTEGER NOT NULL,
  pending_pence                        INTEGER NOT NULL,
  total_payout_pence                   INTEGER NOT NULL,
  balance_after_payout_pence           INTEGER NOT NULL,
  refund_exposure_pence                INTEGER NOT NULL,
  payout_preview_json                  JSONB,
  trailing_30d_stripe_inflow_pence     INTEGER NOT NULL DEFAULT 0,
  trailing_30d_payout_outflow_pence    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_pbs_captured_at
  ON platform_balance_snapshots(captured_at DESC);

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- STRIPE SESSION IDEMPOTENCY (PR-G, audit #07 + #11)
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- Two related races the app-level check-then-insert pattern can't catch:
--
--   1. credit_transactions: webhook handler (api/webhook.js) AND verify-session
--      (api/credits.js) both watch the same Stripe checkout completion event.
--      Stripe retries on 5xx, and a learner hitting /success while the webhook
--      is still in flight produces two concurrent INSERTs against the same
--      stripe_session_id. The SELECT-then-INSERT idempotency check passes on
--      both. Result: duplicate transactions, doubled credits.
--
--   2. slot_reservations: two learners clicking the same slot at the same time
--      both pass the existence check (no reservation yet), both create Stripe
--      sessions, both INSERT. The ON CONFLICT DO NOTHING in the existing INSERT
--      is a no-op because no unique constraint backs it. Result: two paid
--      learners for one slot â€” the later booking insert fails on
--      uq_instructor_slot but the loser has already paid Stripe.
--
-- Fix: add the DB-level uniqueness the app code thought it had. Code-side
-- catches the duplicate-key error and degrades gracefully (already_processed
-- for credits; 409 + Stripe session expire for reservations).
--
-- Both are wrapped in idempotent DO blocks so a re-run is safe.

DO $$ BEGIN
  -- credit_transactions: stripe_session_id is nullable (non-Stripe transactions
  -- like referral rewards leave it NULL). Partial unique index keeps NULLs
  -- unrestricted while enforcing uniqueness on the Stripe-funded rows.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname  = 'uq_credit_tx_session'
  ) THEN
    CREATE UNIQUE INDEX uq_credit_tx_session
      ON credit_transactions(stripe_session_id)
      WHERE stripe_session_id IS NOT NULL;
  END IF;
EXCEPTION WHEN unique_violation THEN
  -- Existing duplicates block the index. Surfaced as a migration error so
  -- the operator runs the cleanup query in PR-G's migration notes first.
  RAISE EXCEPTION 'uq_credit_tx_session: duplicate stripe_session_id values exist. Run the cleanup query in PR-G before retrying.';
END $$;

DO $$ BEGIN
  -- slot_reservations: one active reservation per slot. The expires_at
  -- predicate can't go in the index (NOW() is non-immutable), but the
  -- existing DELETE-expired pass before INSERT removes stale rows, so a
  -- fresh INSERT only ever races against a still-live one. The new
  -- ON CONFLICT clause in api/slots.js relies on this exact name.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname  = 'uq_slot_reservation_slot'
  ) THEN
    CREATE UNIQUE INDEX uq_slot_reservation_slot
      ON slot_reservations(instructor_id, scheduled_date, start_time);
  END IF;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'uq_slot_reservation_slot: duplicate slot reservations exist. Run the cleanup query in PR-G before retrying.';
END $$;

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- CRON OVERLAP GUARDS (PR-I, audit #15)
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- Lease-based advisory locking for cron entry points. The Neon HTTP driver
-- opens a fresh connection per query, so pg_advisory_lock (session-scoped)
-- can't span the multiple round-trips a cron run makes. App-level lease
-- table works over HTTP and self-recovers from crashed runs via expires_at.
--
-- See api/_cron-lock.js for the acquire/release logic and the per-cron
-- lock keys + lease lengths. One row per active lock; rows are deleted on
-- normal completion and otherwise expire on their lease.

CREATE TABLE IF NOT EXISTS cron_locks (
  lock_key    TEXT PRIMARY KEY,
  owner       TEXT NOT NULL,                          -- random nonce identifying the holder
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL                    -- lease expiry; reclaimable once past
);

CREATE INDEX IF NOT EXISTS idx_cron_locks_expires_at
  ON cron_locks(expires_at);

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- PR-K: GDPR â€” anonymise lesson_bookings instead of cascade-deleting (May 2026)
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- lesson_bookings are financial records (paid lessons, payout line items,
-- credit ledger). CLAUDE.md GDPR rule 7 requires anonymisation, not hard
-- delete, for 7-year tax retention.
--
-- Three deletion paths (learner self-delete, admin delete, retention cron) all
-- relied on the inline `ON DELETE CASCADE` FK on lesson_bookings.learner_id
-- to hard-delete bookings when the learner row was deleted. Replace that with
-- ON DELETE SET NULL, mirroring what credit_transactions does (lines
-- 1185-1195 above), and add an explicit `learner_anonymized` flag so an
-- anonymised booking is distinguishable from a never-attached one.
--
-- The shared cascade helper lives in api/_gdpr.js â€” all three call sites
-- now go through it.
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS learner_anonymized BOOLEAN DEFAULT FALSE;

ALTER TABLE lesson_bookings DROP CONSTRAINT IF EXISTS lesson_bookings_learner_id_fkey;
ALTER TABLE lesson_bookings ALTER COLUMN learner_id DROP NOT NULL;
DO $$ BEGIN
  ALTER TABLE lesson_bookings ADD CONSTRAINT lesson_bookings_learner_id_fkey
    FOREIGN KEY (learner_id) REFERENCES learner_users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- PR-L: calendar_token rotation timestamps (May 2026)
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- `calendar_token` on learner_users and instructors is a long-lived secret that
-- grants read access to the user's lesson schedule via the iCal feed. Lazy-
-- issued on first feed-url request and stored forever. If it leaks (URL
-- shared / browser history / accidental screen share), there was no way to
-- invalidate it short of manual DB intervention.
--
-- Add a `calendar_token_rotated_at` timestamp so:
--   1. Users can self-rotate via POST /api/calendar?action=rotate-token (and
--      the instructor equivalent), invalidating the old token immediately.
--   2. The profile UI can display "last rotated on â€¦" so users know to rotate
--      if a leak is suspected.
--
-- Nullable: pre-PR-L tokens have no rotation history. The rotate endpoint
-- writes NOW() when it rotates; the issue path also writes NOW() when it
-- first generates the token (so freshly-issued tokens have a known birth).
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
ALTER TABLE learner_users ADD COLUMN IF NOT EXISTS calendar_token_rotated_at TIMESTAMPTZ;
ALTER TABLE instructors   ADD COLUMN IF NOT EXISTS calendar_token_rotated_at TIMESTAMPTZ;

-- Test Swaps Marketplace (June 2026)
ALTER TABLE learner_users ADD COLUMN IF NOT EXISTS test_centre TEXT;
ALTER TABLE learner_users ADD COLUMN IF NOT EXISTS free_trial_allowed BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE learner_users ADD COLUMN IF NOT EXISTS free_trial_completed_at TIMESTAMPTZ;
ALTER TABLE learner_users ADD COLUMN IF NOT EXISTS test_instructor_booked BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE learner_users ADD COLUMN IF NOT EXISTS admin_control_notes TEXT;

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

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- PR-N: notification_log (May 2026)
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- Source-of-truth for every email / SMS / WhatsApp attempt the platform makes.
-- Before this, every send was fire-and-forget: Twilio errors were console.warn'd
-- and emailer failures were swallowed by per-call-site try/catches that only
-- forwarded the user-visible error. When a learner says "I never got the
-- reminder", support had no way to confirm whether we actually tried.
--
-- Wrapping at the helper layer (api/_whatsapp.js::sendWhatsApp and
-- api/_auth-helpers.js::createTransporter's sendMail wrapper) gives blanket
-- coverage: every send across the codebase is logged automatically. Call sites
-- may attach _log metadata (purpose / learner_id / instructor_id / school_id)
-- to enrich the row; if omitted, the wrapper records what it can derive from
-- the recipient address/number plus a coarse purpose='other'.
--
-- Status is 'sent' on success or 'failed' with the error message. Records are
-- kept for 90 days then purged by cron-retention (operational log, not GDPR
-- data â€” purpose strings are coarse, payload_summary is the subject/first
-- 80 chars, never the full message body).
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
CREATE TABLE IF NOT EXISTS notification_log (
  id                SERIAL PRIMARY KEY,
  channel           TEXT NOT NULL CHECK (channel IN ('email','sms','whatsapp')),
  purpose           TEXT NOT NULL,
  recipient         TEXT NOT NULL,
  learner_id        INTEGER REFERENCES learner_users(id) ON DELETE SET NULL,
  instructor_id     INTEGER REFERENCES instructors(id)   ON DELETE SET NULL,
  payload_summary   TEXT,
  delivery_status   TEXT NOT NULL CHECK (delivery_status IN ('sent','failed','skipped')),
  error_message     TEXT,
  school_id         INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notif_log_school    ON notification_log(school_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_log_learner   ON notification_log(learner_id, created_at DESC) WHERE learner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notif_log_recipient ON notification_log(recipient, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_log_failed    ON notification_log(created_at DESC) WHERE delivery_status = 'failed';

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- Credits Step 1a: list_price_pence keystone column (May 2026)
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- Per PER-INSTRUCTOR-CREDITS-PLAN.md Â§Step 1a. Snapshots the list price (in
-- pence) at booking creation time, plus a provenance tag describing how the
-- snapshot was sourced. Schema-only deploy â€” no writer code yet. Both columns
-- nullable; Step 1b (writer wiring in every INSERT path) and Step 1c (backfill
-- with source tagging) follow in later PRs.
--
-- `list_price_source` values:
--   'stripe_metadata'        â€” read from Stripe session metadata at webhook time
--   'live_compute_insert'    â€” computed via getEffectiveRatePencePerMinute at INSERT
--   'live_compute_backfill'  â€” computed by Step 1c backfill against historical rate
--   'unknown'                â€” pre-backfill rows that could not be classified
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS list_price_pence INTEGER;
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS list_price_source TEXT
  CHECK (list_price_source IS NULL OR list_price_source IN
    ('stripe_metadata', 'live_compute_insert', 'live_compute_backfill', 'unknown'));

ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS social_video_consent BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS social_video_age_confirmed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS social_video_discount_pct INTEGER NOT NULL DEFAULT 0
  CHECK (social_video_discount_pct IN (0, 5));

-- Test date lesson booking metadata. These rows remain normal bookings for
-- lifecycle/payout purposes; the purpose flag only labels the practical-test
-- warm-up/test reservation and snapshots the learner's saved test details.
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS booking_purpose TEXT NOT NULL DEFAULT 'lesson';
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS test_start_time TEXT;
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS test_centre TEXT;
ALTER TABLE lesson_bookings DROP CONSTRAINT IF EXISTS chk_lesson_bookings_booking_purpose;
ALTER TABLE lesson_bookings ADD CONSTRAINT chk_lesson_bookings_booking_purpose
  CHECK (booking_purpose IN ('lesson', 'test_date'));
CREATE INDEX IF NOT EXISTS idx_lesson_bookings_test_date_purpose
  ON lesson_bookings(school_id, booking_purpose, scheduled_date)
  WHERE booking_purpose = 'test_date';

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- Credits Step 3a: instructors.hourly_rate_pence column (May 2026)
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- Per PER-INSTRUCTOR-CREDITS-PLAN.md Â§Step 3 (L668-670). Per-instructor
-- hourly rate, level 2 of the three-level pricing fallback:
--   1. instructor_learner_notes.custom_hourly_rate_pence  (per-learner-pair)
--   2. instructors.hourly_rate_pence                       (per-instructor) â† NEW
--   3. schools.config.pricing.bulk_hourly_pence            (school default)
--
-- Nullable. NULL means "inherit school default" (level 3) â€” so no behavioural
-- change for any existing instructor until an admin sets a value explicitly.
-- CHECK bound (1..50000 pence) mirrors validateBulkPricingConfig in
-- api/_pricing-helpers.js so admin-set values are bounded consistently.
-- Schema-only deploy; the helper that consumes this column ships in Step 3b.
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS hourly_rate_pence INTEGER
  CHECK (hourly_rate_pence IS NULL OR (hourly_rate_pence > 0 AND hourly_rate_pence <= 50000));

-- Credits Thread B: per-instructor opt-in for school-wide bulk discount tiers.
-- New instructors default OFF; Fraser is grandfathered ON because his live
-- CoachCarter offer already includes bulk packages. Use identity fields rather
-- than a fragile id: historical credit backfills confused fixture id=1 with
-- Fraser's real instructor row (currently id=4 in production).
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS bulk_tiers_enabled BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE instructors
   SET bulk_tiers_enabled = TRUE
 WHERE school_id = 1
   AND active = TRUE
   AND (
     LOWER(email) IN ('fraser@coachcarter.uk', 'coachcarteruk@gmail.com')
     OR LOWER(name) IN ('fraser carter', 'fraser')
     OR LOWER(slug) = 'fraser'
   );

-- Instructors may opt in to learner-consented social-media lesson filming.
-- Learners can then opt in per booking for the snapshotted 5% discount.
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS social_video_opt_in BOOLEAN NOT NULL DEFAULT FALSE;

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- Credits Step 1c: migration_markers table (May 2026)
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- Per PER-INSTRUCTOR-CREDITS-PLAN.md Â§Step 1c (L357-385). Operational ordering
-- table so future migrations can refuse to run until a prerequisite backfill
-- has completed. Specifically: Step 2's schema PR will wrap its DDL in a
-- DO-block that checks for the 'per_instructor_credits_step_1c_backfill' key.
-- If missing â†’ RAISE EXCEPTION halts the migration.
--
-- The table is created here (schema-only); marker rows are inserted by the
-- corresponding migration endpoint after it confirms the backfill completed
-- successfully. /api/migrate-step-1c is the only writer in this PR; future
-- migrations get their own keys.
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
CREATE TABLE IF NOT EXISTS migration_markers (
  key          TEXT PRIMARY KEY,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes        TEXT
);

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- Credits Step 2a: credit_transactions Phase 1 schema (May 2026)
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- Per PER-INSTRUCTOR-CREDITS-PLAN.md Â§Step 2 sub-phase 2a (L425-439). Adds the
-- columns that Phase 2A will read/write. All nullable, all additive, no
-- behavioural change. Existing rows read `source = 'stripe'` via the PG11+
-- missing-value fast-path; sub-phase 2b (run via /api/migrate-step-2b) then
-- defensively backfills and adds NOT NULL on `source`.
--
-- Column purposes:
--   - instructor_id                     : which instructor these credits belong to (Phase 2A)
--   - effective_rate_pence_per_minute   : rate snapshot at purchase time (Step 3 fallback)
--   - source                            : provenance tag ('stripe'|'free_trial'|'reconciliation'|'goodwill')
--   - absorbed_by                       : who eats the cost when source is non-Stripe ('platform'|'instructor')
--   - stripe_payment_intent_id          : reconciliation idempotency key (uniq index added in 2c)
--   - stripe_charge_id                  : reconciliation alt key (uniq index added in 2c)
--
-- NOT NULL constraints and unique indexes ship in sub-phases 2b/2c. The new
-- tables (learner_credit_balances, booking_credit_sources, credit_source_adjustments)
-- ship in sub-phase 2c. PHASE_2A_IMPLEMENTED stays false until Step 4.
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
ALTER TABLE credit_transactions
  ADD COLUMN IF NOT EXISTS instructor_id INTEGER REFERENCES instructors(id);
ALTER TABLE credit_transactions
  ADD COLUMN IF NOT EXISTS effective_rate_pence_per_minute INTEGER;
ALTER TABLE credit_transactions
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'stripe'
    CHECK (source IS NULL OR source IN ('stripe', 'free_trial', 'reconciliation', 'goodwill'));
ALTER TABLE credit_transactions
  ADD COLUMN IF NOT EXISTS absorbed_by TEXT
    CHECK (absorbed_by IS NULL OR absorbed_by IN ('platform', 'instructor'));
ALTER TABLE credit_transactions
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT;
ALTER TABLE credit_transactions
  ADD COLUMN IF NOT EXISTS stripe_charge_id TEXT;

-- CLAUDE.md security rule #6: every new FK column gets an index. Partial
-- because most historical rows have instructor_id NULL until Step 4 backfills.
CREATE INDEX IF NOT EXISTS idx_credit_tx_instructor
  ON credit_transactions(instructor_id)
  WHERE instructor_id IS NOT NULL;

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- Credits Step 2c: unique indexes + per-instructor balance / FIFO / refund tables (May 2026)
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- Per PER-INSTRUCTOR-CREDITS-PLAN.md Â§Step 2 sub-phase 2c (L468-532). Adds the
-- two reconciliation-idempotency unique indexes plus the three new tables that
-- Phase 2A code (Step 4) will read/write:
--
--   - learner_credit_balances    : per (learner, instructor) balance ledger.
--   - booking_credit_sources     : FIFO attribution â€” which credit_transactions
--                                  row(s) funded each lesson_bookings row.
--   - credit_source_adjustments  : cash-refund / dispute-clawback ledger
--                                  (immutable source totals + additive history).
--
-- All additive. PHASE_2A_IMPLEMENTED stays false; no writer reads these tables
-- until Step 4. The LCB backfill from learner_users.balance_minutes lives in
-- /api/migrate-step-2c (data mutation, not schema), mirroring the Step 1c
-- precedent. Sync trigger ships in Step 4 Phase B (not here).
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

-- Unique partial indexes for Stripe-payment idempotency in Step 5 reconciliation.
-- Partial WHERE is load-bearing: historical rows have these NULL (plan Â§Step 2
-- decision A â€” no historical Stripe-ID backfill).
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_tx_payment_intent
  ON credit_transactions(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_tx_charge
  ON credit_transactions(stripe_charge_id)
  WHERE stripe_charge_id IS NOT NULL;

-- Per-instructor balance ledger.
CREATE TABLE IF NOT EXISTS learner_credit_balances (
  id              SERIAL PRIMARY KEY,
  learner_id      INTEGER NOT NULL REFERENCES learner_users(id) ON DELETE CASCADE,
  instructor_id   INTEGER NOT NULL REFERENCES instructors(id),
  school_id       INTEGER NOT NULL REFERENCES schools(id) DEFAULT 1,
  balance_minutes INTEGER NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (learner_id, instructor_id)
);
CREATE INDEX IF NOT EXISTS idx_lcb_learner    ON learner_credit_balances(learner_id);
CREATE INDEX IF NOT EXISTS idx_lcb_instructor ON learner_credit_balances(instructor_id);

-- Step 4.5 Plan A: grandfather flag for legacy LCB rows created by Step 2c's
-- mechanical balance_minutes-copy backfill. NULL = normal row, subject to
-- full drift detection. Non-NULL = legacy origin; the divergence cron
-- conditionally suppresses these only when there are NO per-pair ledger
-- rows in any source CTE (purchases, booking draws, BCS, CSA). Any
-- per-pair ledger row â€” even one whose net is zero (e.g. +60 purchase
-- + -60 booking draw) â€” re-asserts drift on grandfathered rows. Backfill
-- via /api/migrate-step-2c-grandfather. See docs/credits-grandfather.md
-- "Mechanical grandfathering" section.
ALTER TABLE learner_credit_balances
  ADD COLUMN IF NOT EXISTS grandfathered_at TIMESTAMPTZ;

-- Step 2c Plan B1 re-attribution: data-only migration (no DDL). The Step 2c
-- backfill targeted instructor_id = 1 (a seed "James Carter" fixture row)
-- by mistake; Fraser's real account is instructor_id = 4. Run
-- /api/migrate-step-2c-reattribute after /api/migrate-step-2c-grandfather
-- to move the 21 grandfathered LCB rows from (learner, 1) to (learner, 4).
-- See docs/credits-grandfather.md "Re-attribution" section and
-- api/migrate-step-2c-reattribute.js for the full forensic.

-- FIFO attribution snapshots. credit_transaction_id NOT NULL â€” free-trial /
-- goodwill / referral grants all create their own (zero-value) credit_transactions
-- row so this column is never NULL.
CREATE TABLE IF NOT EXISTS booking_credit_sources (
  id                    SERIAL PRIMARY KEY,
  booking_id            INTEGER NOT NULL REFERENCES lesson_bookings(id) ON DELETE CASCADE,
  credit_transaction_id INTEGER NOT NULL REFERENCES credit_transactions(id),
  school_id             INTEGER NOT NULL REFERENCES schools(id) DEFAULT 1,
  minutes_drawn         INTEGER NOT NULL CHECK (minutes_drawn > 0),
  rate_pence_per_minute INTEGER NOT NULL,
  contribution_pence    INTEGER NOT NULL,
  stripe_fee_pence      INTEGER NOT NULL DEFAULT 0,
  absorbed_by           TEXT CHECK (absorbed_by IS NULL OR absorbed_by IN ('platform', 'instructor')),
  refunded_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (booking_id, credit_transaction_id)
);
CREATE INDEX IF NOT EXISTS idx_bcs_booking   ON booking_credit_sources(booking_id);
CREATE INDEX IF NOT EXISTS idx_bcs_credit_tx ON booking_credit_sources(credit_transaction_id);
CREATE INDEX IF NOT EXISTS idx_bcs_active
  ON booking_credit_sources(credit_transaction_id)
  WHERE refunded_at IS NULL;

-- Step 5 groundwork (May 2026): BCS is a tenant-scoped financial attribution
-- table. The table already exists in production from Step 2c, so add and
-- backfill school_id idempotently before enforcing NOT NULL.
ALTER TABLE booking_credit_sources ADD COLUMN IF NOT EXISTS school_id INTEGER;
UPDATE booking_credit_sources bcs
   SET school_id = COALESCE(
         (SELECT lb.school_id FROM lesson_bookings lb WHERE lb.id = bcs.booking_id),
         (SELECT ct.school_id FROM credit_transactions ct WHERE ct.id = bcs.credit_transaction_id),
         1
       )
 WHERE bcs.school_id IS NULL;
ALTER TABLE booking_credit_sources ALTER COLUMN school_id SET DEFAULT 1;
ALTER TABLE booking_credit_sources ALTER COLUMN school_id SET NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'booking_credit_sources_school_id_fkey'
       AND conrelid = 'booking_credit_sources'::regclass
  ) THEN
    ALTER TABLE booking_credit_sources
      ADD CONSTRAINT booking_credit_sources_school_id_fkey
      FOREIGN KEY (school_id) REFERENCES schools(id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_bcs_school ON booking_credit_sources(school_id);

-- Recurring weekly lesson block foundation (June 2026).
-- Confirmed credit-funded blocks create lesson_bookings immediately. Later
-- bank-payment slices can use pending_payment + held item rows to block slots
-- without treating them as paid bookings.
CREATE TABLE IF NOT EXISTS recurring_slot_blocks (
  id                         SERIAL PRIMARY KEY,
  school_id                  INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  learner_id                 INTEGER NOT NULL REFERENCES learner_users(id) ON DELETE CASCADE,
  instructor_id              INTEGER NOT NULL REFERENCES instructors(id),
  anchor_booking_id          INTEGER REFERENCES lesson_bookings(id),
  lesson_type_id             INTEGER REFERENCES lesson_types(id),
  status                     TEXT NOT NULL CHECK (status IN ('pending_payment', 'confirmed', 'payment_failed', 'expired', 'released')),
  funding_method             TEXT NOT NULL CHECK (funding_method IN ('lesson_credit', 'bank_payment')),
  selected_lessons           INTEGER NOT NULL CHECK (selected_lessons BETWEEN 1 AND 12),
  duration_minutes           INTEGER NOT NULL CHECK (duration_minutes > 0),
  start_time                 TIME NOT NULL,
  end_time                   TIME NOT NULL,
  price_per_lesson_pence     INTEGER NOT NULL CHECK (price_per_lesson_pence >= 0),
  total_price_pence          INTEGER NOT NULL CHECK (total_price_pence >= 0),
  price_source               TEXT,
  expires_at                 TIMESTAMPTZ,
  confirmed_at               TIMESTAMPTZ,
  released_at                TIMESTAMPTZ,
  stripe_payment_intent_id   TEXT,
  stripe_checkout_session_id TEXT,
  metadata                   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_recurring_blocks_school_status
  ON recurring_slot_blocks(school_id, status);
CREATE INDEX IF NOT EXISTS idx_recurring_blocks_learner
  ON recurring_slot_blocks(learner_id, school_id);
CREATE INDEX IF NOT EXISTS idx_recurring_blocks_instructor
  ON recurring_slot_blocks(instructor_id, school_id);
CREATE INDEX IF NOT EXISTS idx_recurring_blocks_anchor
  ON recurring_slot_blocks(anchor_booking_id)
  WHERE anchor_booking_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS recurring_slot_block_items (
  id                SERIAL PRIMARY KEY,
  block_id          INTEGER NOT NULL REFERENCES recurring_slot_blocks(id) ON DELETE CASCADE,
  school_id         INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  instructor_id     INTEGER NOT NULL REFERENCES instructors(id),
  lesson_booking_id INTEGER REFERENCES lesson_bookings(id),
  scheduled_date    DATE NOT NULL,
  start_time        TIME NOT NULL,
  end_time          TIME NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('held', 'booked', 'released')),
  price_pence       INTEGER NOT NULL CHECK (price_pence >= 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (block_id, scheduled_date, start_time)
);
CREATE INDEX IF NOT EXISTS idx_recurring_items_block
  ON recurring_slot_block_items(block_id);
CREATE INDEX IF NOT EXISTS idx_recurring_items_school_status
  ON recurring_slot_block_items(school_id, status, scheduled_date);
CREATE INDEX IF NOT EXISTS idx_recurring_items_instructor_slot
  ON recurring_slot_block_items(instructor_id, scheduled_date, start_time);
CREATE UNIQUE INDEX IF NOT EXISTS uq_recurring_held_slot
  ON recurring_slot_block_items(instructor_id, scheduled_date, start_time)
  WHERE status = 'held';

-- Cash-refund / dispute-clawback / admin-correction ledger. Additive â€” never
-- mutate credit_transactions.minutes or amount_pence because BCS snapshots
-- depend on those historical facts.
CREATE TABLE IF NOT EXISTS credit_source_adjustments (
  id                    SERIAL PRIMARY KEY,
  credit_transaction_id INTEGER NOT NULL REFERENCES credit_transactions(id),
  kind                  TEXT NOT NULL CHECK (kind IN ('cash_refund', 'admin_correction', 'dispute_clawback')),
  minutes_adjusted      INTEGER NOT NULL,
  pence_adjusted        INTEGER NOT NULL,
  reason                TEXT NOT NULL,
  stripe_refund_id      TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  created_by            INTEGER REFERENCES admin_users(id),
  UNIQUE (stripe_refund_id)
);
CREATE INDEX IF NOT EXISTS idx_csa_credit_tx ON credit_source_adjustments(credit_transaction_id);

-- Refund ledger foundation (May 2026). Preview is read-only for now; these
-- tables are the accounting substrate for a later explicitly approved
-- execute-refund slice.
CREATE TABLE IF NOT EXISTS refund_events (
  id                                  SERIAL PRIMARY KEY,
  school_id                           INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  learner_id                          INTEGER REFERENCES learner_users(id),
  created_by                          INTEGER REFERENCES admin_users(id),
  refund_type                         TEXT NOT NULL CHECK (
    refund_type IN ('credit_purchase', 'repeat_offer_partial', 'direct_slot', 'direct_offer', 'manual_record')
  ),
  status                              TEXT NOT NULL CHECK (status IN ('previewed', 'manual_review', 'blocked', 'executed')),
  gross_refund_pence                  INTEGER NOT NULL CHECK (gross_refund_pence >= 0),
  processing_fee_withheld_pence       INTEGER NOT NULL CHECK (processing_fee_withheld_pence >= 0),
  net_refund_pence                    INTEGER NOT NULL CHECK (net_refund_pence >= 0),
  stripe_payment_intent_id            TEXT,
  stripe_charge_id                    TEXT,
  stripe_refund_id                    TEXT,
  stripe_balance_transaction_id       TEXT,
  idempotency_key                     TEXT,
  reason                              TEXT NOT NULL,
  metadata                            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at                          TIMESTAMPTZ DEFAULT NOW(),
  CHECK (processing_fee_withheld_pence <= gross_refund_pence),
  CHECK (net_refund_pence = gross_refund_pence - processing_fee_withheld_pence)
);
DO $$
DECLARE
  existing_status_constraint TEXT;
BEGIN
  IF to_regclass('public.refund_events') IS NOT NULL THEN
    SELECT conname
      INTO existing_status_constraint
      FROM pg_constraint
     WHERE conrelid = 'public.refund_events'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%status%'
       AND pg_get_constraintdef(oid) ILIKE '%previewed%'
     LIMIT 1;

    IF existing_status_constraint IS NOT NULL THEN
      EXECUTE format('ALTER TABLE refund_events DROP CONSTRAINT %I', existing_status_constraint);
    END IF;

    ALTER TABLE refund_events
      ADD CONSTRAINT refund_events_status_check
      CHECK (status IN ('previewed', 'manual_review', 'blocked', 'executed'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_refund_events_school ON refund_events(school_id);
CREATE INDEX IF NOT EXISTS idx_refund_events_learner ON refund_events(learner_id);
CREATE INDEX IF NOT EXISTS idx_refund_events_created_by ON refund_events(created_by);
CREATE INDEX IF NOT EXISTS idx_refund_events_payment_intent
  ON refund_events(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_refund_events_charge
  ON refund_events(stripe_charge_id)
  WHERE stripe_charge_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_refund_events_refund
  ON refund_events(stripe_refund_id)
  WHERE stripe_refund_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_refund_events_idempotency_key
  ON refund_events(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_refund_events_id_school
  ON refund_events(id, school_id);

CREATE TABLE IF NOT EXISTS refund_event_lines (
  id                                  SERIAL PRIMARY KEY,
  school_id                           INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  refund_event_id                     INTEGER NOT NULL REFERENCES refund_events(id),
  credit_transaction_id               INTEGER REFERENCES credit_transactions(id),
  booking_credit_source_id            INTEGER REFERENCES booking_credit_sources(id),
  lesson_booking_id                   INTEGER REFERENCES lesson_bookings(id),
  credit_source_adjustment_id         INTEGER REFERENCES credit_source_adjustments(id),
  gross_pence_removed                 INTEGER NOT NULL CHECK (gross_pence_removed >= 0),
  source_fee_pence_used               INTEGER NOT NULL CHECK (source_fee_pence_used >= 0),
  fee_withheld_pence                  INTEGER NOT NULL CHECK (fee_withheld_pence >= 0),
  net_refund_pence                    INTEGER NOT NULL CHECK (net_refund_pence >= 0),
  minutes_adjusted                    INTEGER NOT NULL DEFAULT 0 CHECK (minutes_adjusted >= 0),
  created_at                          TIMESTAMPTZ DEFAULT NOW(),
  CHECK (fee_withheld_pence <= gross_pence_removed),
  CHECK (net_refund_pence = gross_pence_removed - fee_withheld_pence)
);
CREATE INDEX IF NOT EXISTS idx_refund_event_lines_school ON refund_event_lines(school_id);
CREATE INDEX IF NOT EXISTS idx_refund_event_lines_event ON refund_event_lines(refund_event_id);
CREATE INDEX IF NOT EXISTS idx_refund_event_lines_credit_tx ON refund_event_lines(credit_transaction_id);
CREATE INDEX IF NOT EXISTS idx_refund_event_lines_bcs ON refund_event_lines(booking_credit_source_id);
CREATE INDEX IF NOT EXISTS idx_refund_event_lines_booking ON refund_event_lines(lesson_booking_id);
CREATE INDEX IF NOT EXISTS idx_refund_event_lines_csa ON refund_event_lines(credit_source_adjustment_id);

CREATE TABLE IF NOT EXISTS refund_event_notes (
  id                                  SERIAL PRIMARY KEY,
  school_id                           INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  refund_event_id                     INTEGER NOT NULL,
  created_by                          INTEGER REFERENCES admin_users(id),
  note_type                           TEXT NOT NULL CHECK (
    note_type IN ('operator_note', 'evidence', 'incident', 'repair_decision')
  ),
  incident_status                     TEXT NOT NULL DEFAULT 'not_applicable' CHECK (
    incident_status IN ('open', 'watching', 'resolved', 'not_applicable')
  ),
  body                                TEXT NOT NULL,
  evidence_reference                  TEXT,
  metadata                            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at                          TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT refund_event_notes_event_school_fk
    FOREIGN KEY (refund_event_id, school_id) REFERENCES refund_events(id, school_id),
  CHECK (note_type = 'incident' OR incident_status = 'not_applicable')
);
DO $$
BEGIN
  IF to_regclass('public.refund_event_notes') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
         FROM pg_constraint
        WHERE conrelid = 'public.refund_event_notes'::regclass
          AND conname = 'refund_event_notes_event_school_fk'
     ) THEN
    ALTER TABLE refund_event_notes
      ADD CONSTRAINT refund_event_notes_event_school_fk
      FOREIGN KEY (refund_event_id, school_id) REFERENCES refund_events(id, school_id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_refund_event_notes_school
  ON refund_event_notes(school_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_refund_event_notes_event
  ON refund_event_notes(refund_event_id, created_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_refund_event_notes_incident
  ON refund_event_notes(school_id, incident_status, created_at DESC)
  WHERE note_type = 'incident';

-- LESSON BOOKING TRANSMISSION TYPE
-- Individual lessons are concrete manual/automatic bookings, even when an
-- instructor profile supports both.
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS transmission_type TEXT;

UPDATE lesson_bookings lb
   SET transmission_type = CASE
     WHEN COALESCE(i.transmission_type, 'manual') = 'automatic' THEN 'automatic'
     ELSE 'manual'
   END
  FROM instructors i
 WHERE i.id = lb.instructor_id
   AND (lb.transmission_type IS NULL OR lb.transmission_type NOT IN ('manual','automatic'));

UPDATE lesson_bookings
   SET transmission_type = 'manual'
 WHERE transmission_type IS NULL
    OR transmission_type NOT IN ('manual','automatic');

ALTER TABLE lesson_bookings ALTER COLUMN transmission_type SET DEFAULT 'manual';
ALTER TABLE lesson_bookings ALTER COLUMN transmission_type SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_lesson_bookings_transmission_type'
  ) THEN
    ALTER TABLE lesson_bookings
      ADD CONSTRAINT chk_lesson_bookings_transmission_type
      CHECK (transmission_type IN ('manual','automatic'));
  END IF;
END $$;

-- WEEKLY AVAILABILITY TRANSMISSION TYPE
-- Recurring availability windows may be manual, automatic, or both. Existing
-- dual-car instructors keep both until they choose a tighter weekly pattern.
ALTER TABLE instructor_availability ADD COLUMN IF NOT EXISTS transmission_type TEXT;

UPDATE instructor_availability ia
   SET transmission_type = CASE
     WHEN COALESCE(i.transmission_type, 'manual') IN ('automatic', 'both')
       THEN COALESCE(i.transmission_type, 'manual')
     ELSE 'manual'
   END
  FROM instructors i
 WHERE i.id = ia.instructor_id
   AND i.school_id = ia.school_id
   AND (ia.transmission_type IS NULL OR ia.transmission_type NOT IN ('manual','automatic','both'));

UPDATE instructor_availability
   SET transmission_type = 'manual'
 WHERE transmission_type IS NULL
    OR transmission_type NOT IN ('manual','automatic','both');

ALTER TABLE instructor_availability ALTER COLUMN transmission_type SET DEFAULT 'both';
ALTER TABLE instructor_availability ALTER COLUMN transmission_type SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_instructor_availability_transmission_type'
      AND conrelid = 'instructor_availability'::regclass
  ) THEN
    ALTER TABLE instructor_availability
      ADD CONSTRAINT chk_instructor_availability_transmission_type
      CHECK (transmission_type IN ('manual','automatic','both'));
  END IF;
END $$;

-- PUBLIC TENANT RESOLUTION
-- Public endpoints should resolve their school from the request host or
-- ?school=slug instead of silently defaulting to school_id=1. The insert gate
-- prevents onboarding a second school until legacy public defaults have been
-- audited and explicitly marked complete.
ALTER TABLE schools ADD COLUMN IF NOT EXISTS primary_host TEXT;

UPDATE schools
   SET primary_host = 'www.coachcarter.uk'
 WHERE id = 1
   AND (primary_host IS NULL OR TRIM(primary_host) = '');

CREATE UNIQUE INDEX IF NOT EXISTS uq_schools_primary_host_lower
  ON schools (LOWER(primary_host))
  WHERE primary_host IS NOT NULL;

CREATE OR REPLACE FUNCTION assert_public_endpoints_tenant_resolved()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.id <> 1 AND NOT EXISTS (
    SELECT 1 FROM migration_markers
     WHERE key = 'public_endpoints_tenant_resolved'
  ) THEN
    RAISE EXCEPTION 'Cannot create school id=% - public endpoints still have legacy school_id=1 defaults. Sweep public tenant resolution and insert migration marker public_endpoints_tenant_resolved first.', NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_schools_require_tenant_resolution ON schools;
CREATE TRIGGER trg_schools_require_tenant_resolution
  BEFORE INSERT ON schools
  FOR EACH ROW EXECUTE FUNCTION assert_public_endpoints_tenant_resolved();

-- Admin learner broadcasts (June 2026)
-- Campaign-level and per-recipient ledger for simple, manually triggered
-- school-scoped SMS broadcasts to global learner categories.
CREATE TABLE IF NOT EXISTS learner_broadcasts (
  id                  SERIAL PRIMARY KEY,
  school_id           INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  label               TEXT NOT NULL,
  message_body        TEXT NOT NULL,
  selected_categories TEXT[] NOT NULL,
  created_by          INTEGER REFERENCES admin_users(id),
  status              TEXT NOT NULL DEFAULT 'sending' CHECK (
    status IN ('sending', 'sent', 'partial_failed', 'failed')
  ),
  recipient_count     INTEGER NOT NULL DEFAULT 0 CHECK (recipient_count >= 0),
  skipped_count       INTEGER NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
  sent_count          INTEGER NOT NULL DEFAULT 0 CHECK (sent_count >= 0),
  failed_count        INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  completed_at        TIMESTAMPTZ,
  CONSTRAINT chk_learner_broadcast_categories CHECK (
    cardinality(selected_categories) > 0
    AND selected_categories <@ ARRAY['regular', 'sporadic', 'inactive', 'passed']::text[]
  ),
  CONSTRAINT uq_learner_broadcast_id_school UNIQUE (id, school_id)
);
CREATE INDEX IF NOT EXISTS idx_learner_broadcasts_school_created
  ON learner_broadcasts(school_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_learner_broadcasts_created_by
  ON learner_broadcasts(created_by, created_at DESC)
  WHERE created_by IS NOT NULL;

CREATE TABLE IF NOT EXISTS learner_broadcast_recipients (
  id                SERIAL PRIMARY KEY,
  school_id         INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  broadcast_id      INTEGER NOT NULL,
  learner_id        INTEGER REFERENCES learner_users(id),
  learner_name      TEXT,
  learner_email     TEXT,
  phone             TEXT,
  learner_category  TEXT,
  status            TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  skip_reason       TEXT,
  error_message     TEXT,
  sent_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT learner_broadcast_recipients_broadcast_school_fk
    FOREIGN KEY (broadcast_id, school_id) REFERENCES learner_broadcasts(id, school_id),
  CONSTRAINT chk_learner_broadcast_recipient_category CHECK (
    learner_category IS NULL
    OR learner_category IN ('regular', 'sporadic', 'inactive', 'passed')
  )
);
CREATE INDEX IF NOT EXISTS idx_learner_broadcast_recipients_school
  ON learner_broadcast_recipients(school_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_learner_broadcast_recipients_broadcast
  ON learner_broadcast_recipients(broadcast_id, status, learner_name);
CREATE INDEX IF NOT EXISTS idx_learner_broadcast_recipients_learner
  ON learner_broadcast_recipients(learner_id, created_at DESC)
  WHERE learner_id IS NOT NULL;

-- Free-trial cancellation repair (June 2026)
-- A self-serve free trial has no learner credit or instructor payout to
-- preserve. Early versions of the shared learner cancel handler treated
-- minutes_deducted=0 as a late no-refund cancellation, leaving already
-- cancelled trial rows scheduled and still blocking the instructor calendar.
UPDATE lesson_bookings
   SET status = 'refunded',
       credit_returned = FALSE,
       credit_forfeited = FALSE
 WHERE status = 'scheduled'
   AND cancelled_at IS NOT NULL
   AND created_by = 'free_trial_self_serve'
   AND payment_method = 'free'
   AND COALESCE(minutes_deducted, 0) = 0;

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- Lesson requests â€” "request to book" (July 2026)
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- LESSON-REQUEST-PLAN.md. Per-instructor toggle: when ON, learners request a
-- slot instead of instantly booking it. Payment is held, not taken â€” card
-- requests use a Stripe manual-capture authorization (captured on accept,
-- cancelled on decline/expiry), credit requests deduct via a 'request_hold'
-- credit_transactions row and refund in full via 'request_refund'.
-- A pending request blocks the slot (uq_request_slot) exactly like a pending
-- lesson_offer. Requests expire at min(created + 48h, lesson start âˆ’ 2h).
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS request_to_book BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS lesson_requests (
  id                  SERIAL PRIMARY KEY,
  school_id           INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  instructor_id       INTEGER NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
  -- ON DELETE SET NULL + guest columns: GDPR deletion anonymises rather than
  -- breaking FK chains (mirrors lesson_bookings.learner_id, May 2026).
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
  -- card_hold path
  stripe_session_id   TEXT,
  payment_intent_id   TEXT,
  amount_pence        INTEGER,
  -- credit path: minutes deducted at request time + the hold ledger row
  credits_minutes     INTEGER,
  hold_transaction_id INTEGER REFERENCES credit_transactions(id),
  -- price snapshot at request time (what the booking will record on accept)
  list_price_pence    INTEGER,
  list_price_source   TEXT,
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','accepted','declined','expired','withdrawn')),
  booking_id          INTEGER REFERENCES lesson_bookings(id),
  decline_reason      TEXT,
  expires_at          TIMESTAMPTZ NOT NULL,
  decided_at          TIMESTAMPTZ,
  -- Set when the held payment was actually released back to the learner:
  -- credits refunded ('request_refund' CT written) or Stripe PaymentIntent
  -- cancelled. Accept sets it too (hold refunded before the booking draws).
  -- A decided request with released_at IS NULL is a crashed decision â€” the
  -- expire cron sweeps and retries the release, so no learner is ever left
  -- charged-but-unbooked.
  released_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- CLAUDE.md security rule #6: every FK column indexed.
CREATE INDEX IF NOT EXISTS idx_requests_school      ON lesson_requests(school_id);
CREATE INDEX IF NOT EXISTS idx_requests_instructor  ON lesson_requests(instructor_id, status);
CREATE INDEX IF NOT EXISTS idx_requests_learner     ON lesson_requests(learner_id) WHERE learner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_requests_lesson_type ON lesson_requests(lesson_type_id) WHERE lesson_type_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_requests_booking     ON lesson_requests(booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_requests_hold_tx     ON lesson_requests(hold_transaction_id) WHERE hold_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_requests_expiry      ON lesson_requests(expires_at) WHERE status = 'pending';
-- One pending request per slot â€” this partial unique index IS the slot lock
-- (same pattern as uq_offer_slot on lesson_offers).
CREATE UNIQUE INDEX IF NOT EXISTS uq_request_slot
  ON lesson_requests(instructor_id, scheduled_date, start_time) WHERE status = 'pending';
-- Sweep target for the expire cron's crashed-decision retry (see released_at).
CREATE INDEX IF NOT EXISTS idx_requests_unreleased
  ON lesson_requests(decided_at) WHERE released_at IS NULL AND status <> 'pending';

-- Shared instructor ideas board.
-- Notes are visible only to instructors belonging to the same school.
CREATE UNIQUE INDEX IF NOT EXISTS uq_instructors_id_school
  ON instructors(id, school_id);

CREATE TABLE IF NOT EXISTS instructor_notes (
  id            BIGSERIAL PRIMARY KEY,
  school_id     INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  instructor_id INTEGER NOT NULL,
  content       TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id) ON DELETE CASCADE,
  CHECK (char_length(BTRIM(content)) BETWEEN 1 AND 2000)
);

CREATE INDEX IF NOT EXISTS idx_instructor_notes_school_feed
  ON instructor_notes(school_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_instructor_notes_instructor
  ON instructor_notes(instructor_id, school_id);

-- Curriculum MVP: school-scoped topic graph and named conversations.
-- Safe to re-run. Nothing in this section deletes curriculum history.
CREATE TABLE IF NOT EXISTS curriculum_topics (
  id                    BIGSERIAL PRIMARY KEY,
  school_id             INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  name                  TEXT NOT NULL,
  name_normalized       TEXT NOT NULL,
  description           TEXT,
  parent_topic_id       BIGINT,
  created_by_type       TEXT NOT NULL CHECK (created_by_type IN ('instructor', 'admin')),
  created_by_id         BIGINT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at           TIMESTAMPTZ,
  archived_by_admin_id  BIGINT,
  merged_into_topic_id  BIGINT,
  UNIQUE (id, school_id),
  CHECK (char_length(BTRIM(name)) BETWEEN 1 AND 120),
  CHECK (description IS NULL OR char_length(description) <= 1200),
  CHECK (parent_topic_id IS NULL OR parent_topic_id <> id),
  CHECK (merged_into_topic_id IS NULL OR merged_into_topic_id <> id),
  FOREIGN KEY (parent_topic_id, school_id)
    REFERENCES curriculum_topics(id, school_id),
  FOREIGN KEY (merged_into_topic_id, school_id)
    REFERENCES curriculum_topics(id, school_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_curriculum_topics_active_name
  ON curriculum_topics(school_id, name_normalized)
  WHERE archived_at IS NULL AND merged_into_topic_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_curriculum_topics_school_parent
  ON curriculum_topics(school_id, parent_topic_id, name_normalized);
CREATE INDEX IF NOT EXISTS idx_curriculum_topics_school_activity
  ON curriculum_topics(school_id, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_curriculum_topics_merged
  ON curriculum_topics(merged_into_topic_id, school_id)
  WHERE merged_into_topic_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS curriculum_topic_connections (
  id               BIGSERIAL PRIMARY KEY,
  school_id        INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  left_topic_id    BIGINT NOT NULL,
  right_topic_id   BIGINT NOT NULL,
  label            TEXT,
  created_by_type  TEXT NOT NULL CHECK (created_by_type IN ('instructor', 'admin')),
  created_by_id    BIGINT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (left_topic_id < right_topic_id),
  CHECK (label IS NULL OR char_length(label) <= 180),
  FOREIGN KEY (left_topic_id, school_id)
    REFERENCES curriculum_topics(id, school_id),
  FOREIGN KEY (right_topic_id, school_id)
    REFERENCES curriculum_topics(id, school_id),
  UNIQUE (school_id, left_topic_id, right_topic_id)
);
CREATE INDEX IF NOT EXISTS idx_curriculum_connections_left
  ON curriculum_topic_connections(school_id, left_topic_id);
CREATE INDEX IF NOT EXISTS idx_curriculum_connections_right
  ON curriculum_topic_connections(school_id, right_topic_id);

CREATE TABLE IF NOT EXISTS curriculum_contributions (
  id                      BIGSERIAL PRIMARY KEY,
  school_id               INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  topic_id                 BIGINT NOT NULL,
  prompt_key               TEXT NOT NULL CHECK (prompt_key IN (
    'understand', 'demonstrate', 'mistakes', 'approaches',
    'prerequisites', 'ready', 'thoughts'
  )),
  parent_contribution_id   BIGINT,
  response_type            TEXT CHECK (response_type IS NULL OR response_type IN (
    'build_on', 'alternative', 'example', 'question', 'connect_topic'
  )),
  linked_topic_id          BIGINT,
  author_type              TEXT NOT NULL CHECK (author_type IN ('instructor', 'admin')),
  author_id                BIGINT NOT NULL,
  body                     TEXT NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at                TIMESTAMPTZ,
  UNIQUE (id, school_id),
  CHECK (char_length(BTRIM(body)) BETWEEN 1 AND 5000),
  CHECK (
    (parent_contribution_id IS NULL AND response_type IS NULL)
    OR parent_contribution_id IS NOT NULL
  ),
  CONSTRAINT curriculum_contribution_link_contract CHECK (
    (response_type = 'connect_topic' AND linked_topic_id IS NOT NULL)
    OR (response_type IS DISTINCT FROM 'connect_topic' AND linked_topic_id IS NULL)
  ),
  FOREIGN KEY (topic_id, school_id)
    REFERENCES curriculum_topics(id, school_id),
  FOREIGN KEY (parent_contribution_id, school_id)
    REFERENCES curriculum_contributions(id, school_id),
  FOREIGN KEY (linked_topic_id, school_id)
    REFERENCES curriculum_topics(id, school_id)
);
DO $$ BEGIN
  ALTER TABLE curriculum_contributions
    ADD CONSTRAINT curriculum_contribution_link_contract CHECK (
      (response_type = 'connect_topic' AND linked_topic_id IS NOT NULL)
      OR (response_type IS DISTINCT FROM 'connect_topic' AND linked_topic_id IS NULL)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS idx_curriculum_contributions_topic_prompt
  ON curriculum_contributions(school_id, topic_id, prompt_key, created_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_curriculum_contributions_parent
  ON curriculum_contributions(parent_contribution_id, school_id)
  WHERE parent_contribution_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_curriculum_contributions_author
  ON curriculum_contributions(school_id, author_type, author_id);

CREATE TABLE IF NOT EXISTS curriculum_structural_suggestions (
  id                    BIGSERIAL PRIMARY KEY,
  school_id             INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  topic_id               BIGINT NOT NULL,
  suggestion_type       TEXT NOT NULL CHECK (suggestion_type IN (
    'rename', 'move', 'archive', 'merge', 'connection', 'other'
  )),
  details                TEXT NOT NULL,
  suggested_by_type      TEXT NOT NULL CHECK (suggested_by_type IN ('instructor', 'admin')),
  suggested_by_id        BIGINT NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at            TIMESTAMPTZ,
  reviewed_by_admin_id   BIGINT,
  review_note            TEXT,
  UNIQUE (id, school_id),
  CHECK (char_length(BTRIM(details)) BETWEEN 1 AND 2000),
  CHECK (review_note IS NULL OR char_length(review_note) <= 1200),
  FOREIGN KEY (topic_id, school_id)
    REFERENCES curriculum_topics(id, school_id)
);
CREATE INDEX IF NOT EXISTS idx_curriculum_suggestions_school_status
  ON curriculum_structural_suggestions(school_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_curriculum_suggestions_topic
  ON curriculum_structural_suggestions(school_id, topic_id, created_at DESC);

INSERT INTO curriculum_topics (
  school_id, name, name_normalized, description, created_by_type, created_by_id
)
SELECT
  s.id,
  seed.name,
  LOWER(seed.name),
  seed.description,
  'admin',
  0
FROM schools s
CROSS JOIN (
  VALUES
    ('Controls', 'Explore how learners understand and use the vehicle controls.'),
    ('Junctions', 'Explore observation, judgement, positioning, and decision-making at junctions.'),
    ('Manoeuvres', 'Explore the skills, teaching approaches, and judgement involved in manoeuvres.')
) AS seed(name, description)
ON CONFLICT (school_id, name_normalized)
  WHERE archived_at IS NULL AND merged_into_topic_id IS NULL
DO NOTHING;

-- Instructor Payout v2: inactive, append-only ledger foundation.
--
-- This migration creates accounting structures only. It does not backfill data,
-- activate the v2 engine, create a Stripe transfer, or mutate v1 payout history.
-- Every tenant key is mandatory and deliberately has no DEFAULT.

ALTER TABLE schools
  ADD COLUMN IF NOT EXISTS payout_engine_version TEXT NOT NULL DEFAULT 'v1';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'schools_payout_engine_version_check'
       AND conrelid = 'schools'::regclass
  ) THEN
    ALTER TABLE schools
      ADD CONSTRAINT schools_payout_engine_version_check
      CHECK (payout_engine_version IN ('v1', 'v2'));
  END IF;
END $$;

-- Composite keys make tenant equality enforceable by foreign keys rather than
-- relying on callers to remember a school predicate.
CREATE UNIQUE INDEX IF NOT EXISTS uq_instructors_id_school
  ON instructors(id, school_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_learners_id_school
  ON learner_users(id, school_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bookings_id_school
  ON lesson_bookings(id, school_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_transactions_id_school
  ON credit_transactions(id, school_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_credit_sources_id_school
  ON booking_credit_sources(id, school_id);

CREATE TABLE IF NOT EXISTS payout_funding_sources (
  id                            BIGSERIAL PRIMARY KEY,
  school_id                     INTEGER NOT NULL REFERENCES schools(id),
  learner_id                    INTEGER,
  instructor_id                 INTEGER NOT NULL,
  funding_class                 TEXT NOT NULL,
  credit_transaction_id         INTEGER,
  stripe_checkout_session_id    TEXT,
  stripe_payment_intent_id      TEXT,
  stripe_charge_id              TEXT,
  stripe_balance_transaction_id TEXT,
  currency                      TEXT NOT NULL DEFAULT 'gbp',
  gross_collected_pence         INTEGER NOT NULL,
  stripe_fee_pence              INTEGER NOT NULL,
  payable_pool_pence            INTEGER NOT NULL,
  refundable_pool_pence         INTEGER NOT NULL,
  source_status                 TEXT NOT NULL,
  source_fingerprint            TEXT NOT NULL,
  occurred_at                   TIMESTAMPTZ NOT NULL,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata                      JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (id, school_id),
  UNIQUE (school_id, source_fingerprint),
  FOREIGN KEY (learner_id, school_id)
    REFERENCES learner_users(id, school_id) ON DELETE SET NULL (learner_id),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  FOREIGN KEY (credit_transaction_id, school_id)
    REFERENCES credit_transactions(id, school_id),
  CHECK (funding_class IN (
    'stripe_backed',
    'legacy_pre_connect_settled',
    'platform_goodwill',
    'instructor_goodwill',
    'external_cash_payable',
    'external_cash_settled',
    'free',
    'manual_review'
  )),
  CHECK (source_status IN (
    'pending', 'available', 'refunded', 'disputed', 'exhausted', 'manual_review'
  )),
  CHECK (currency = LOWER(currency) AND char_length(currency) = 3),
  CHECK (gross_collected_pence >= 0),
  CHECK (stripe_fee_pence >= 0 AND stripe_fee_pence <= gross_collected_pence),
  CHECK (payable_pool_pence >= 0),
  CHECK (refundable_pool_pence >= 0),
  CHECK (payable_pool_pence <= gross_collected_pence - stripe_fee_pence),
  CHECK (refundable_pool_pence <= gross_collected_pence - stripe_fee_pence),
  CHECK (source_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (
    funding_class NOT IN (
      'legacy_pre_connect_settled',
      'instructor_goodwill',
      'external_cash_settled',
      'free',
      'manual_review'
    ) OR payable_pool_pence = 0
  ),
  CHECK (
    funding_class <> 'manual_review'
    OR (source_status = 'manual_review' AND payable_pool_pence = 0)
  ),
  CHECK (
    funding_class <> 'stripe_backed'
    OR payable_pool_pence = 0
    OR (
      NULLIF(BTRIM(stripe_payment_intent_id), '') IS NOT NULL
      AND NULLIF(BTRIM(stripe_charge_id), '') IS NOT NULL
      AND NULLIF(BTRIM(stripe_balance_transaction_id), '') IS NOT NULL
      AND metadata->>'fee_evidence' = 'stripe_balance_transaction'
    )
  ),
  CHECK (
    funding_class NOT IN ('platform_goodwill', 'external_cash_payable')
    OR payable_pool_pence = 0
    OR (
      metadata ? 'evidence_reference'
      AND NULLIF(BTRIM(metadata->>'evidence_reference'), '') IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_funding_source_session
  ON payout_funding_sources(school_id, stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_funding_source_payment_intent
  ON payout_funding_sources(school_id, stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_funding_source_charge
  ON payout_funding_sources(school_id, stripe_charge_id)
  WHERE stripe_charge_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_funding_source_balance_tx
  ON payout_funding_sources(school_id, stripe_balance_transaction_id)
  WHERE stripe_balance_transaction_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_funding_source_credit_tx
  ON payout_funding_sources(school_id, credit_transaction_id)
  WHERE credit_transaction_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_funding_source_session_global_guard
  ON payout_funding_sources(stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_funding_source_payment_intent_global_guard
  ON payout_funding_sources(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_funding_source_charge_global_guard
  ON payout_funding_sources(stripe_charge_id)
  WHERE stripe_charge_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_funding_source_balance_tx_global_guard
  ON payout_funding_sources(stripe_balance_transaction_id)
  WHERE stripe_balance_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payout_funding_sources_school_instructor
  ON payout_funding_sources(school_id, instructor_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_payout_funding_sources_learner
  ON payout_funding_sources(school_id, learner_id) WHERE learner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payout_funding_sources_credit_tx
  ON payout_funding_sources(school_id, credit_transaction_id)
  WHERE credit_transaction_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS payout_source_import_runs (
  id                    BIGSERIAL PRIMARY KEY,
  school_id             INTEGER NOT NULL REFERENCES schools(id),
  import_version        TEXT NOT NULL,
  plan_fingerprint      TEXT NOT NULL,
  candidate_count       INTEGER NOT NULL,
  totals                JSONB NOT NULL,
  operator_identity     TEXT NOT NULL,
  evidence_reference    TEXT NOT NULL,
  created_source_count  INTEGER NOT NULL,
  existing_source_count INTEGER NOT NULL,
  applied_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (id, school_id),
  UNIQUE (school_id, plan_fingerprint),
  CHECK (plan_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (candidate_count >= 0),
  CHECK (created_source_count >= 0),
  CHECK (existing_source_count >= 0),
  CHECK (created_source_count + existing_source_count = candidate_count),
  CHECK (NULLIF(BTRIM(operator_identity), '') IS NOT NULL),
  CHECK (NULLIF(BTRIM(evidence_reference), '') IS NOT NULL),
  CHECK (
    totals ?& ARRAY[
      'gross_collected_pence',
      'stripe_fee_pence',
      'payable_pool_pence',
      'refundable_pool_pence',
      'funding_class_counts'
    ]
  )
);

CREATE INDEX IF NOT EXISTS idx_payout_source_import_runs_school_applied
  ON payout_source_import_runs(school_id, applied_at);

CREATE TABLE IF NOT EXISTS booking_earnings (
  id                                BIGSERIAL PRIMARY KEY,
  school_id                         INTEGER NOT NULL REFERENCES schools(id),
  booking_id                        INTEGER NOT NULL,
  instructor_id                     INTEGER NOT NULL,
  payout_route                      TEXT NOT NULL,
  gross_price_snapshot_pence        INTEGER NOT NULL,
  stripe_fee_snapshot_pence         INTEGER NOT NULL,
  instructor_earning_pence          INTEGER NOT NULL,
  platform_fee_pence                INTEGER NOT NULL,
  franchise_fee_allocation_pence    INTEGER NOT NULL DEFAULT 0,
  commission_rate_snapshot          NUMERIC(7,6),
  earning_status                    TEXT NOT NULL,
  earned_at                         TIMESTAMPTZ NOT NULL,
  blocked_reason                    TEXT,
  calculation_version               TEXT NOT NULL,
  calculation_fingerprint           TEXT NOT NULL,
  calculation_json                  JSONB NOT NULL,
  created_at                        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, booking_id),
  UNIQUE (school_id, calculation_fingerprint),
  FOREIGN KEY (booking_id, school_id)
    REFERENCES lesson_bookings(id, school_id),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  CHECK (payout_route IN ('instructor_direct', 'school')),
  CHECK (gross_price_snapshot_pence >= 0),
  CHECK (stripe_fee_snapshot_pence >= 0),
  CHECK (instructor_earning_pence >= 0),
  CHECK (platform_fee_pence >= 0),
  CHECK (franchise_fee_allocation_pence >= 0),
  CHECK (
    gross_price_snapshot_pence =
      stripe_fee_snapshot_pence +
      instructor_earning_pence +
      platform_fee_pence +
      franchise_fee_allocation_pence
  ),
  CHECK (
    commission_rate_snapshot IS NULL
    OR (commission_rate_snapshot >= 0 AND commission_rate_snapshot <= 1)
  ),
  CHECK (earning_status IN (
    'earned', 'claimed', 'transferring', 'transferred', 'adjusted', 'blocked', 'zero_value'
  )),
  CHECK (
    (earning_status = 'blocked' AND NULLIF(BTRIM(blocked_reason), '') IS NOT NULL)
    OR (earning_status <> 'blocked' AND blocked_reason IS NULL)
  ),
  CHECK (NULLIF(BTRIM(calculation_version), '') IS NOT NULL),
  CHECK (calculation_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (jsonb_typeof(calculation_json) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_booking_earnings_school_instructor
  ON booking_earnings(school_id, instructor_id, earned_at);
CREATE INDEX IF NOT EXISTS idx_booking_earnings_school_status
  ON booking_earnings(school_id, earning_status, earned_at);

CREATE TABLE IF NOT EXISTS booking_earning_sources (
  id                                    BIGSERIAL PRIMARY KEY,
  school_id                             INTEGER NOT NULL REFERENCES schools(id),
  booking_earning_id                    BIGINT NOT NULL,
  funding_source_id                     BIGINT NOT NULL,
  booking_credit_source_id              INTEGER,
  gross_contribution_pence              INTEGER NOT NULL,
  stripe_fee_contribution_pence         INTEGER NOT NULL,
  payable_contribution_pence            INTEGER NOT NULL,
  instructor_earning_contribution_pence INTEGER NOT NULL,
  platform_fee_contribution_pence       INTEGER NOT NULL DEFAULT 0,
  franchise_fee_contribution_pence      INTEGER NOT NULL DEFAULT 0,
  allocation_fingerprint                TEXT NOT NULL,
  created_at                            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, allocation_fingerprint),
  UNIQUE (school_id, booking_earning_id, funding_source_id, booking_credit_source_id),
  FOREIGN KEY (booking_earning_id, school_id)
    REFERENCES booking_earnings(id, school_id),
  FOREIGN KEY (funding_source_id, school_id)
    REFERENCES payout_funding_sources(id, school_id),
  FOREIGN KEY (booking_credit_source_id, school_id)
    REFERENCES booking_credit_sources(id, school_id),
  CHECK (gross_contribution_pence >= 0),
  CHECK (stripe_fee_contribution_pence >= 0),
  CHECK (payable_contribution_pence >= 0),
  CHECK (instructor_earning_contribution_pence >= 0),
  CHECK (platform_fee_contribution_pence >= 0),
  CHECK (franchise_fee_contribution_pence >= 0),
  CHECK (payable_contribution_pence = instructor_earning_contribution_pence),
  CHECK (
    gross_contribution_pence =
      stripe_fee_contribution_pence +
      instructor_earning_contribution_pence +
      platform_fee_contribution_pence +
      franchise_fee_contribution_pence
  ),
  CHECK (allocation_fingerprint ~ '^sha256:[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_booking_earning_sources_earning
  ON booking_earning_sources(school_id, booking_earning_id);
CREATE INDEX IF NOT EXISTS idx_booking_earning_sources_source
  ON booking_earning_sources(school_id, funding_source_id);
CREATE INDEX IF NOT EXISTS idx_booking_earning_sources_bcs
  ON booking_earning_sources(school_id, booking_credit_source_id)
  WHERE booking_credit_source_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS payout_batches (
  id                       BIGSERIAL PRIMARY KEY,
  school_id                INTEGER NOT NULL REFERENCES schools(id),
  instructor_id            INTEGER,
  destination_school_id    INTEGER,
  payout_route             TEXT NOT NULL,
  period_start             DATE NOT NULL,
  period_end               DATE NOT NULL,
  currency                 TEXT NOT NULL DEFAULT 'gbp',
  gross_pence              INTEGER NOT NULL,
  stripe_fees_pence        INTEGER NOT NULL,
  platform_fee_pence       INTEGER NOT NULL,
  franchise_fee_pence      INTEGER NOT NULL DEFAULT 0,
  instructor_amount_pence  INTEGER NOT NULL,
  shortfall_pence          INTEGER NOT NULL DEFAULT 0,
  deposit_deducted_pence   INTEGER NOT NULL DEFAULT 0,
  recovery_deducted_pence  INTEGER NOT NULL DEFAULT 0,
  state                    TEXT NOT NULL,
  calculation_version      TEXT NOT NULL,
  plan_fingerprint         TEXT NOT NULL,
  plan_json                JSONB NOT NULL,
  created_by_type          TEXT NOT NULL,
  created_by_id            INTEGER,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at             TIMESTAMPTZ,
  settled_at               TIMESTAMPTZ,
  failure_reason           TEXT,
  UNIQUE (id, school_id),
  UNIQUE (school_id, plan_fingerprint),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  CHECK (payout_route IN ('instructor_direct', 'school')),
  CHECK (
    (payout_route = 'instructor_direct' AND instructor_id IS NOT NULL AND destination_school_id IS NULL)
    OR
    (payout_route = 'school' AND instructor_id IS NULL AND destination_school_id = school_id)
  ),
  CHECK (period_start <= period_end),
  CHECK (currency = LOWER(currency) AND char_length(currency) = 3),
  CHECK (gross_pence >= 0),
  CHECK (stripe_fees_pence >= 0),
  CHECK (platform_fee_pence >= 0),
  CHECK (franchise_fee_pence >= 0),
  CHECK (instructor_amount_pence >= 0),
  CHECK (shortfall_pence >= 0),
  CHECK (deposit_deducted_pence >= 0),
  CHECK (recovery_deducted_pence >= 0),
  CHECK (
    gross_pence =
      stripe_fees_pence +
      platform_fee_pence +
      franchise_fee_pence +
      instructor_amount_pence +
      shortfall_pence +
      deposit_deducted_pence +
      recovery_deducted_pence
  ),
  CHECK (state IN (
    'planned', 'claimed', 'submitting', 'reconciling', 'transferred', 'bank_paid',
    'blocked', 'failed_confirmed', 'bank_payout_failed'
  )),
  CHECK (NULLIF(BTRIM(calculation_version), '') IS NOT NULL),
  CHECK (plan_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (jsonb_typeof(plan_json) = 'object'),
  CHECK (created_by_type IN ('system', 'admin', 'migration'))
);

CREATE INDEX IF NOT EXISTS idx_payout_batches_school_period
  ON payout_batches(school_id, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_payout_batches_instructor
  ON payout_batches(school_id, instructor_id, state) WHERE instructor_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS payout_batch_earnings (
  id                  BIGSERIAL PRIMARY KEY,
  school_id           INTEGER NOT NULL REFERENCES schools(id),
  payout_batch_id     BIGINT NOT NULL,
  booking_earning_id  BIGINT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, booking_earning_id),
  UNIQUE (school_id, payout_batch_id, booking_earning_id),
  FOREIGN KEY (payout_batch_id, school_id)
    REFERENCES payout_batches(id, school_id),
  FOREIGN KEY (booking_earning_id, school_id)
    REFERENCES booking_earnings(id, school_id)
);

CREATE INDEX IF NOT EXISTS idx_payout_batch_earnings_batch
  ON payout_batch_earnings(school_id, payout_batch_id);

CREATE TABLE IF NOT EXISTS payout_transfers (
  id                            BIGSERIAL PRIMARY KEY,
  school_id                     INTEGER NOT NULL REFERENCES schools(id),
  payout_batch_id               BIGINT NOT NULL,
  instructor_id                 INTEGER,
  destination_school_id         INTEGER,
  stripe_destination_account_id TEXT NOT NULL,
  stripe_source_charge_id       TEXT,
  amount_pence                  INTEGER NOT NULL,
  currency                      TEXT NOT NULL DEFAULT 'gbp',
  idempotency_key               TEXT NOT NULL,
  transfer_group                TEXT NOT NULL,
  plan_fingerprint              TEXT NOT NULL,
  logical_transfer_fingerprint  TEXT NOT NULL,
  stripe_transfer_id            TEXT,
  state                         TEXT NOT NULL,
  request_created_at            TIMESTAMPTZ,
  stripe_created_at             TIMESTAMPTZ,
  reconciled_at                 TIMESTAMPTZ,
  last_error_code               TEXT,
  last_error_message            TEXT,
  metadata                      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (idempotency_key),
  UNIQUE (school_id, logical_transfer_fingerprint),
  FOREIGN KEY (payout_batch_id, school_id)
    REFERENCES payout_batches(id, school_id),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  CHECK (
    (instructor_id IS NOT NULL AND destination_school_id IS NULL)
    OR (instructor_id IS NULL AND destination_school_id = school_id)
  ),
  CHECK (amount_pence > 0),
  CHECK (currency = LOWER(currency) AND char_length(currency) = 3),
  CHECK (char_length(idempotency_key) BETWEEN 1 AND 255),
  CHECK (NULLIF(BTRIM(transfer_group), '') IS NOT NULL),
  CHECK (plan_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (logical_transfer_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (state IN (
    'planned', 'submitting', 'reconciling', 'transferred',
    'failed_confirmed', 'reversed', 'blocked'
  ))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_transfers_stripe_id
  ON payout_transfers(stripe_transfer_id) WHERE stripe_transfer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payout_transfers_batch
  ON payout_transfers(school_id, payout_batch_id);
CREATE INDEX IF NOT EXISTS idx_payout_transfers_destination
  ON payout_transfers(school_id, stripe_destination_account_id, state);

CREATE TABLE IF NOT EXISTS payout_transfer_attempts (
  id                    BIGSERIAL PRIMARY KEY,
  school_id             INTEGER NOT NULL REFERENCES schools(id),
  payout_transfer_id    BIGINT NOT NULL,
  attempt_kind          TEXT NOT NULL,
  outcome               TEXT NOT NULL,
  stripe_request_id     TEXT,
  stripe_transfer_id    TEXT,
  evidence_fingerprint  TEXT NOT NULL,
  evidence_json         JSONB NOT NULL,
  occurred_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, evidence_fingerprint),
  FOREIGN KEY (payout_transfer_id, school_id)
    REFERENCES payout_transfers(id, school_id),
  CHECK (attempt_kind IN ('submission', 'reconciliation')),
  CHECK (outcome IN (
    'started', 'succeeded', 'ambiguous', 'failed_confirmed',
    'found', 'not_found_safe_retry', 'operator_review'
  )),
  CHECK (evidence_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (jsonb_typeof(evidence_json) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_payout_transfer_attempts_transfer
  ON payout_transfer_attempts(school_id, payout_transfer_id, occurred_at);

CREATE TABLE IF NOT EXISTS payout_transfer_sources (
  id                   BIGSERIAL PRIMARY KEY,
  school_id            INTEGER NOT NULL REFERENCES schools(id),
  payout_transfer_id   BIGINT NOT NULL,
  funding_source_id    BIGINT NOT NULL,
  amount_pence         INTEGER NOT NULL,
  source_fingerprint   TEXT NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, source_fingerprint),
  UNIQUE (school_id, payout_transfer_id, funding_source_id),
  FOREIGN KEY (payout_transfer_id, school_id)
    REFERENCES payout_transfers(id, school_id),
  FOREIGN KEY (funding_source_id, school_id)
    REFERENCES payout_funding_sources(id, school_id),
  CHECK (amount_pence > 0),
  CHECK (source_fingerprint ~ '^sha256:[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_payout_transfer_sources_transfer
  ON payout_transfer_sources(school_id, payout_transfer_id);
CREATE INDEX IF NOT EXISTS idx_payout_transfer_sources_source
  ON payout_transfer_sources(school_id, funding_source_id);

CREATE TABLE IF NOT EXISTS payout_adjustments (
  id                    BIGSERIAL PRIMARY KEY,
  school_id             INTEGER NOT NULL REFERENCES schools(id),
  instructor_id         INTEGER NOT NULL,
  booking_id            INTEGER,
  payout_batch_id       BIGINT,
  payout_transfer_id    BIGINT,
  funding_source_id     BIGINT,
  parent_adjustment_id  BIGINT,
  adjustment_type       TEXT NOT NULL,
  amount_pence          INTEGER NOT NULL,
  currency              TEXT NOT NULL DEFAULT 'gbp',
  reason                TEXT NOT NULL,
  evidence_reference    TEXT NOT NULL,
  operator_id           INTEGER,
  status                TEXT NOT NULL,
  adjustment_fingerprint TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_at            TIMESTAMPTZ,
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (id, school_id),
  UNIQUE (school_id, adjustment_fingerprint),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  FOREIGN KEY (booking_id, school_id)
    REFERENCES lesson_bookings(id, school_id),
  FOREIGN KEY (payout_batch_id, school_id)
    REFERENCES payout_batches(id, school_id),
  FOREIGN KEY (payout_transfer_id, school_id)
    REFERENCES payout_transfers(id, school_id),
  FOREIGN KEY (funding_source_id, school_id)
    REFERENCES payout_funding_sources(id, school_id),
  FOREIGN KEY (parent_adjustment_id, school_id)
    REFERENCES payout_adjustments(id, school_id),
  CHECK (adjustment_type IN (
    'opening_correction', 'refund', 'dispute', 'chargeback', 'transfer_reversal',
    'recovery', 'recovery_application', 'write_off', 'platform_funding',
    'external_cash_correction'
  )),
  CHECK (amount_pence <> 0),
  CHECK (currency = LOWER(currency) AND char_length(currency) = 3),
  CHECK (NULLIF(BTRIM(reason), '') IS NOT NULL),
  CHECK (NULLIF(BTRIM(evidence_reference), '') IS NOT NULL),
  CHECK (status IN ('pending', 'applied', 'voided')),
  CHECK (adjustment_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (
    adjustment_type <> 'recovery'
    OR (
      amount_pence < 0
      AND parent_adjustment_id IS NULL
      AND payout_batch_id IS NULL
      AND payout_transfer_id IS NULL
      AND status = 'pending'
      AND applied_at IS NULL
      AND operator_id IS NOT NULL
      AND (metadata->>'recovery_policy' = 'full_available_offset') IS TRUE
      AND (jsonb_typeof(metadata->'source_v1_payout_id') = 'number') IS TRUE
      AND ((metadata->>'source_v1_payout_id')::bigint > 0) IS TRUE
      AND (metadata->>'source_stripe_transfer_id' LIKE 'tr\_%' ESCAPE '\') IS TRUE
      AND (jsonb_typeof(metadata->'source_legacy_booking_ids') = 'array') IS TRUE
      AND (jsonb_array_length(metadata->'source_legacy_booking_ids') > 0) IS TRUE
      AND (jsonb_typeof(metadata->'original_recovery_pence') = 'number') IS TRUE
      AND ((metadata->>'original_recovery_pence')::bigint = ABS(amount_pence)) IS TRUE
    )
  ),
  CHECK (
    adjustment_type <> 'recovery_application'
    OR (
      amount_pence > 0
      AND parent_adjustment_id IS NOT NULL
      AND payout_batch_id IS NOT NULL
      AND status = 'applied'
      AND applied_at IS NOT NULL
      AND (metadata->>'recovery_policy' = 'full_available_offset') IS TRUE
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_payout_adjustments_instructor
  ON payout_adjustments(school_id, instructor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_payout_adjustments_booking
  ON payout_adjustments(school_id, booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payout_adjustments_batch
  ON payout_adjustments(school_id, payout_batch_id) WHERE payout_batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payout_adjustments_transfer
  ON payout_adjustments(school_id, payout_transfer_id) WHERE payout_transfer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payout_adjustments_source
  ON payout_adjustments(school_id, funding_source_id) WHERE funding_source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payout_adjustments_parent
  ON payout_adjustments(school_id, parent_adjustment_id)
  WHERE parent_adjustment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_recovery_application_batch
  ON payout_adjustments(school_id, parent_adjustment_id, payout_batch_id)
  WHERE adjustment_type = 'recovery_application';

CREATE TABLE IF NOT EXISTS stripe_event_receipts (
  id                     BIGSERIAL PRIMARY KEY,
  school_id              INTEGER NOT NULL REFERENCES schools(id),
  stripe_event_id        TEXT NOT NULL,
  event_type             TEXT NOT NULL,
  livemode               BOOLEAN NOT NULL,
  object_id              TEXT,
  connected_account_id   TEXT,
  processing_status      TEXT NOT NULL,
  received_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at           TIMESTAMPTZ,
  last_error             TEXT,
  UNIQUE (id, school_id),
  UNIQUE (school_id, stripe_event_id),
  UNIQUE (stripe_event_id),
  CHECK (processing_status IN ('received', 'processing', 'processed', 'failed', 'manual_review'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_stripe_event_receipts_school_event
  ON stripe_event_receipts(school_id, stripe_event_id);
CREATE INDEX IF NOT EXISTS idx_stripe_event_receipts_school_status
  ON stripe_event_receipts(school_id, processing_status, received_at);
CREATE INDEX IF NOT EXISTS idx_stripe_event_receipts_account
  ON stripe_event_receipts(school_id, connected_account_id)
  WHERE connected_account_id IS NOT NULL;

-- Immutable security anchor for resolving a signed connected-account event to
-- one tenant. An account may belong to one instructor or one school, never
-- both, and the Stripe account identity is globally unique.
CREATE TABLE IF NOT EXISTS payout_v2_connected_account_scopes (
  id                     BIGSERIAL PRIMARY KEY,
  school_id              INTEGER NOT NULL REFERENCES schools(id),
  stripe_account_id      TEXT NOT NULL,
  owner_type             TEXT NOT NULL,
  instructor_id          INTEGER,
  destination_school_id  INTEGER,
  evidence_json          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (stripe_account_id),
  UNIQUE (school_id, owner_type, instructor_id, destination_school_id),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  CHECK (stripe_account_id LIKE 'acct\_%' ESCAPE '\'),
  CHECK (owner_type IN ('instructor', 'school')),
  CHECK (
    (owner_type = 'instructor' AND instructor_id IS NOT NULL AND destination_school_id IS NULL)
    OR
    (owner_type = 'school' AND instructor_id IS NULL AND destination_school_id = school_id)
  ),
  CHECK (jsonb_typeof(evidence_json) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_payout_v2_connected_account_scopes_school
  ON payout_v2_connected_account_scopes(school_id, owner_type);

CREATE TABLE IF NOT EXISTS connected_bank_payouts (
  id                     BIGSERIAL PRIMARY KEY,
  school_id              INTEGER NOT NULL REFERENCES schools(id),
  stripe_account_id      TEXT NOT NULL,
  stripe_payout_id       TEXT NOT NULL,
  payout_batch_id        BIGINT,
  amount_pence           INTEGER NOT NULL,
  currency               TEXT NOT NULL,
  state                  TEXT NOT NULL,
  arrival_estimate       TIMESTAMPTZ,
  stripe_created_at      TIMESTAMPTZ,
  paid_at                TIMESTAMPTZ,
  failed_at              TIMESTAMPTZ,
  failure_code           TEXT,
  failure_message        TEXT,
  evidence_json          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (stripe_payout_id),
  FOREIGN KEY (payout_batch_id, school_id)
    REFERENCES payout_batches(id, school_id),
  CHECK (amount_pence > 0),
  CHECK (currency = LOWER(currency) AND char_length(currency) = 3),
  CHECK (state IN ('created', 'pending', 'in_transit', 'paid', 'failed', 'cancelled', 'manual_review'))
);

CREATE INDEX IF NOT EXISTS idx_connected_bank_payouts_account
  ON connected_bank_payouts(school_id, stripe_account_id, stripe_created_at);
CREATE INDEX IF NOT EXISTS idx_connected_bank_payouts_batch
  ON connected_bank_payouts(school_id, payout_batch_id)
  WHERE payout_batch_id IS NOT NULL;

-- One immutable, PII-minimised evidence envelope per signed Stripe event.
-- The mutable receipt tracks processing; this table preserves what was
-- actually observed and the resulting disposition.
CREATE TABLE IF NOT EXISTS payout_v2_stripe_evidence_events (
  id                     BIGSERIAL PRIMARY KEY,
  school_id              INTEGER NOT NULL REFERENCES schools(id),
  stripe_event_id        TEXT NOT NULL,
  event_type             TEXT NOT NULL,
  livemode               BOOLEAN NOT NULL,
  connected_account_id   TEXT,
  object_type            TEXT NOT NULL,
  object_id              TEXT NOT NULL,
  disposition            TEXT NOT NULL,
  operator_review_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence_fingerprint   TEXT NOT NULL,
  evidence_json          JSONB NOT NULL,
  stripe_created_at      TIMESTAMPTZ,
  received_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (stripe_event_id),
  UNIQUE (school_id, evidence_fingerprint),
  FOREIGN KEY (school_id, stripe_event_id)
    REFERENCES stripe_event_receipts(school_id, stripe_event_id),
  CHECK (object_type IN ('transfer', 'payout', 'charge', 'dispute')),
  CHECK (disposition IN ('applied', 'no_op', 'operator_review')),
  CHECK (jsonb_typeof(operator_review_reasons) = 'array'),
  CHECK (evidence_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (jsonb_typeof(evidence_json) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_payout_v2_stripe_evidence_school_object
  ON payout_v2_stripe_evidence_events(school_id, object_type, object_id);
CREATE INDEX IF NOT EXISTS idx_payout_v2_stripe_evidence_review
  ON payout_v2_stripe_evidence_events(school_id, received_at)
  WHERE disposition = 'operator_review';

-- A transfer, reversal, refund, or dispute event can relate to more than one
-- local transfer. The event envelope is stored once and these exact,
-- append-only links retain each relationship without rewriting history.
CREATE TABLE IF NOT EXISTS payout_v2_stripe_evidence_transfer_links (
  id                       BIGSERIAL PRIMARY KEY,
  school_id                INTEGER NOT NULL REFERENCES schools(id),
  stripe_evidence_event_id BIGINT NOT NULL,
  payout_transfer_id       BIGINT NOT NULL,
  relationship             TEXT NOT NULL,
  identity_status          TEXT NOT NULL,
  evidence_json            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, stripe_evidence_event_id, payout_transfer_id, relationship),
  FOREIGN KEY (stripe_evidence_event_id, school_id)
    REFERENCES payout_v2_stripe_evidence_events(id, school_id),
  FOREIGN KEY (payout_transfer_id, school_id)
    REFERENCES payout_transfers(id, school_id),
  CHECK (relationship IN (
    'transfer_observed', 'transfer_reversal', 'source_refund', 'source_dispute'
  )),
  CHECK (identity_status IN ('matched', 'contradictory', 'operator_review')),
  CHECK (jsonb_typeof(evidence_json) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_payout_v2_evidence_transfer_links_transfer
  ON payout_v2_stripe_evidence_transfer_links(school_id, payout_transfer_id);

-- Exact Stripe balance-transaction evidence linking any number of Payout v2
-- transfers to one connected bank payout. A failed payout and a later payout
-- may both reference the same original transfer, so transfer_id is
-- deliberately not globally unique here.
CREATE TABLE IF NOT EXISTS connected_bank_payout_transfer_links (
  id                         BIGSERIAL PRIMARY KEY,
  school_id                  INTEGER NOT NULL REFERENCES schools(id),
  connected_bank_payout_id   BIGINT NOT NULL,
  payout_transfer_id         BIGINT NOT NULL,
  stripe_balance_transaction_id TEXT NOT NULL,
  amount_pence               INTEGER NOT NULL,
  currency                   TEXT NOT NULL,
  link_fingerprint           TEXT NOT NULL,
  evidence_json              JSONB NOT NULL,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (stripe_balance_transaction_id),
  UNIQUE (school_id, connected_bank_payout_id, payout_transfer_id),
  UNIQUE (school_id, link_fingerprint),
  FOREIGN KEY (connected_bank_payout_id, school_id)
    REFERENCES connected_bank_payouts(id, school_id),
  FOREIGN KEY (payout_transfer_id, school_id)
    REFERENCES payout_transfers(id, school_id),
  CHECK (amount_pence > 0),
  CHECK (currency = LOWER(currency) AND char_length(currency) = 3),
  CHECK (link_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (jsonb_typeof(evidence_json) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_connected_bank_payout_transfer_links_payout
  ON connected_bank_payout_transfer_links(school_id, connected_bank_payout_id);
CREATE INDEX IF NOT EXISTS idx_connected_bank_payout_transfer_links_transfer
  ON connected_bank_payout_transfer_links(school_id, payout_transfer_id);

-- Append-only enforcement. Immutable ledger facts are never updated or
-- deleted. Operational state rows may transition, but are never deleted.
CREATE OR REPLACE FUNCTION payout_v2_reject_change()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is forbidden', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION payout_v2_reject_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% preserves financial history: DELETE is forbidden', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION payout_v2_guard_operational_update()
RETURNS TRIGGER AS $$
DECLARE
  old_facts JSONB := to_jsonb(OLD);
  new_facts JSONB := to_jsonb(NEW);
  allowed_column TEXT;
BEGIN
  FOREACH allowed_column IN ARRAY TG_ARGV LOOP
    old_facts := old_facts - allowed_column;
    new_facts := new_facts - allowed_column;
  END LOOP;
  IF old_facts <> new_facts THEN
    RAISE EXCEPTION '% accounting identity/totals are immutable', TG_TABLE_NAME
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payout_funding_sources_append_only ON payout_funding_sources;
CREATE TRIGGER payout_funding_sources_append_only
  BEFORE UPDATE OR DELETE ON payout_funding_sources
  FOR EACH ROW EXECUTE FUNCTION payout_v2_reject_change();
DROP TRIGGER IF EXISTS payout_source_import_runs_append_only ON payout_source_import_runs;
CREATE TRIGGER payout_source_import_runs_append_only
  BEFORE UPDATE OR DELETE ON payout_source_import_runs
  FOR EACH ROW EXECUTE FUNCTION payout_v2_reject_change();
DROP TRIGGER IF EXISTS booking_earnings_append_only ON booking_earnings;
CREATE TRIGGER booking_earnings_append_only
  BEFORE UPDATE OR DELETE ON booking_earnings
  FOR EACH ROW EXECUTE FUNCTION payout_v2_reject_change();
DROP TRIGGER IF EXISTS booking_earning_sources_append_only ON booking_earning_sources;
CREATE TRIGGER booking_earning_sources_append_only
  BEFORE UPDATE OR DELETE ON booking_earning_sources
  FOR EACH ROW EXECUTE FUNCTION payout_v2_reject_change();
DROP TRIGGER IF EXISTS payout_batch_earnings_append_only ON payout_batch_earnings;
CREATE TRIGGER payout_batch_earnings_append_only
  BEFORE UPDATE OR DELETE ON payout_batch_earnings
  FOR EACH ROW EXECUTE FUNCTION payout_v2_reject_change();
DROP TRIGGER IF EXISTS payout_transfer_sources_append_only ON payout_transfer_sources;
CREATE TRIGGER payout_transfer_sources_append_only
  BEFORE UPDATE OR DELETE ON payout_transfer_sources
  FOR EACH ROW EXECUTE FUNCTION payout_v2_reject_change();
DROP TRIGGER IF EXISTS payout_transfer_attempts_append_only ON payout_transfer_attempts;
CREATE TRIGGER payout_transfer_attempts_append_only
  BEFORE UPDATE OR DELETE ON payout_transfer_attempts
  FOR EACH ROW EXECUTE FUNCTION payout_v2_reject_change();
DROP TRIGGER IF EXISTS payout_adjustments_append_only ON payout_adjustments;
CREATE TRIGGER payout_adjustments_append_only
  BEFORE UPDATE OR DELETE ON payout_adjustments
  FOR EACH ROW EXECUTE FUNCTION payout_v2_reject_change();
DROP TRIGGER IF EXISTS payout_batches_no_delete ON payout_batches;
CREATE TRIGGER payout_batches_no_delete
  BEFORE DELETE ON payout_batches
  FOR EACH ROW EXECUTE FUNCTION payout_v2_reject_delete();
DROP TRIGGER IF EXISTS payout_transfers_no_delete ON payout_transfers;
CREATE TRIGGER payout_transfers_no_delete
  BEFORE DELETE ON payout_transfers
  FOR EACH ROW EXECUTE FUNCTION payout_v2_reject_delete();
DROP TRIGGER IF EXISTS stripe_event_receipts_no_delete ON stripe_event_receipts;
CREATE TRIGGER stripe_event_receipts_no_delete
  BEFORE DELETE ON stripe_event_receipts
  FOR EACH ROW EXECUTE FUNCTION payout_v2_reject_delete();
DROP TRIGGER IF EXISTS connected_bank_payouts_no_delete ON connected_bank_payouts;
CREATE TRIGGER connected_bank_payouts_no_delete
  BEFORE DELETE ON connected_bank_payouts
  FOR EACH ROW EXECUTE FUNCTION payout_v2_reject_delete();
DROP TRIGGER IF EXISTS payout_v2_connected_account_scopes_append_only
  ON payout_v2_connected_account_scopes;
CREATE TRIGGER payout_v2_connected_account_scopes_append_only
  BEFORE UPDATE OR DELETE ON payout_v2_connected_account_scopes
  FOR EACH ROW EXECUTE FUNCTION payout_v2_reject_change();
DROP TRIGGER IF EXISTS payout_v2_stripe_evidence_events_append_only
  ON payout_v2_stripe_evidence_events;
CREATE TRIGGER payout_v2_stripe_evidence_events_append_only
  BEFORE UPDATE OR DELETE ON payout_v2_stripe_evidence_events
  FOR EACH ROW EXECUTE FUNCTION payout_v2_reject_change();
DROP TRIGGER IF EXISTS payout_v2_stripe_evidence_transfer_links_append_only
  ON payout_v2_stripe_evidence_transfer_links;
CREATE TRIGGER payout_v2_stripe_evidence_transfer_links_append_only
  BEFORE UPDATE OR DELETE ON payout_v2_stripe_evidence_transfer_links
  FOR EACH ROW EXECUTE FUNCTION payout_v2_reject_change();
DROP TRIGGER IF EXISTS connected_bank_payout_transfer_links_append_only
  ON connected_bank_payout_transfer_links;
CREATE TRIGGER connected_bank_payout_transfer_links_append_only
  BEFORE UPDATE OR DELETE ON connected_bank_payout_transfer_links
  FOR EACH ROW EXECUTE FUNCTION payout_v2_reject_change();
DROP TRIGGER IF EXISTS payout_batches_immutable_facts ON payout_batches;
CREATE TRIGGER payout_batches_immutable_facts
  BEFORE UPDATE ON payout_batches
  FOR EACH ROW EXECUTE FUNCTION payout_v2_guard_operational_update(
    'state', 'submitted_at', 'settled_at', 'failure_reason'
  );
DROP TRIGGER IF EXISTS payout_transfers_immutable_facts ON payout_transfers;
CREATE TRIGGER payout_transfers_immutable_facts
  BEFORE UPDATE ON payout_transfers
  FOR EACH ROW EXECUTE FUNCTION payout_v2_guard_operational_update(
    'stripe_transfer_id', 'state', 'request_created_at', 'stripe_created_at',
    'reconciled_at', 'last_error_code', 'last_error_message'
  );
DROP TRIGGER IF EXISTS stripe_event_receipts_immutable_facts ON stripe_event_receipts;
CREATE TRIGGER stripe_event_receipts_immutable_facts
  BEFORE UPDATE ON stripe_event_receipts
  FOR EACH ROW EXECUTE FUNCTION payout_v2_guard_operational_update(
    'processing_status', 'processed_at', 'last_error'
  );
DROP TRIGGER IF EXISTS connected_bank_payouts_immutable_facts ON connected_bank_payouts;
CREATE TRIGGER connected_bank_payouts_immutable_facts
  BEFORE UPDATE ON connected_bank_payouts
  FOR EACH ROW EXECUTE FUNCTION payout_v2_guard_operational_update(
    'state', 'arrival_estimate', 'paid_at', 'failed_at', 'failure_code',
    'failure_message', 'evidence_json', 'updated_at'
  );

CREATE OR REPLACE FUNCTION payout_v2_validate_recovery_adjustment()
RETURNS TRIGGER AS $$
DECLARE
  parent_row payout_adjustments%ROWTYPE;
  batch_row payout_batches%ROWTYPE;
  already_applied BIGINT;
BEGIN
  IF NEW.adjustment_type <> 'recovery_application' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO parent_row
    FROM payout_adjustments
   WHERE id = NEW.parent_adjustment_id
     AND school_id = NEW.school_id
   FOR UPDATE;

  IF NOT FOUND
    OR parent_row.adjustment_type <> 'recovery'
    OR parent_row.status <> 'pending'
    OR parent_row.amount_pence >= 0
    OR parent_row.instructor_id <> NEW.instructor_id
    OR parent_row.currency <> NEW.currency
  THEN
    RAISE EXCEPTION 'recovery application does not match an active school-scoped recovery'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO batch_row
    FROM payout_batches
   WHERE id = NEW.payout_batch_id
     AND school_id = NEW.school_id;

  IF NOT FOUND
    OR batch_row.payout_route <> 'instructor_direct'
    OR batch_row.instructor_id <> NEW.instructor_id
    OR batch_row.currency <> NEW.currency
    OR batch_row.state NOT IN ('planned', 'claimed')
  THEN
    RAISE EXCEPTION 'recovery application does not match an eligible school-scoped payout batch'
      USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(SUM(amount_pence), 0)
    INTO already_applied
    FROM payout_adjustments
   WHERE school_id = NEW.school_id
     AND parent_adjustment_id = NEW.parent_adjustment_id
     AND adjustment_type = 'recovery_application';

  IF already_applied + NEW.amount_pence > ABS(parent_row.amount_pence) THEN
    RAISE EXCEPTION 'recovery applications exceed the original recovery obligation'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payout_adjustments_recovery_guard ON payout_adjustments;
CREATE TRIGGER payout_adjustments_recovery_guard
  BEFORE INSERT ON payout_adjustments
  FOR EACH ROW EXECUTE FUNCTION payout_v2_validate_recovery_adjustment();

CREATE OR REPLACE FUNCTION payout_v2_validate_batch_recovery_totals()
RETURNS TRIGGER AS $$
DECLARE
  target_batch_id BIGINT;
  target_school_id INTEGER;
  batch_row payout_batches%ROWTYPE;
  applied_pence BIGINT;
BEGIN
  target_school_id := NEW.school_id;
  IF TG_TABLE_NAME = 'payout_batches' THEN
    target_batch_id := NEW.id;
  ELSE
    target_batch_id := NEW.payout_batch_id;
  END IF;
  IF target_batch_id IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO batch_row
    FROM payout_batches
   WHERE id = target_batch_id
     AND school_id = target_school_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT COALESCE(SUM(amount_pence), 0)
    INTO applied_pence
    FROM payout_adjustments
   WHERE school_id = batch_row.school_id
     AND payout_batch_id = batch_row.id
     AND adjustment_type = 'recovery_application';

  IF applied_pence <> batch_row.recovery_deducted_pence THEN
    RAISE EXCEPTION 'payout batch % recovery applications do not conserve recovery deduction', batch_row.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payout_batches_recovery_totals_guard ON payout_batches;
CREATE CONSTRAINT TRIGGER payout_batches_recovery_totals_guard
  AFTER INSERT ON payout_batches
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION payout_v2_validate_batch_recovery_totals();
DROP TRIGGER IF EXISTS payout_adjustments_recovery_totals_guard ON payout_adjustments;
CREATE CONSTRAINT TRIGGER payout_adjustments_recovery_totals_guard
  AFTER INSERT ON payout_adjustments
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION payout_v2_validate_batch_recovery_totals();

CREATE OR REPLACE FUNCTION payout_v2_validate_source_allocation()
RETURNS TRIGGER AS $$
DECLARE
  source_class TEXT;
BEGIN
  SELECT funding_class INTO source_class
    FROM payout_funding_sources
   WHERE id = NEW.funding_source_id
     AND school_id = NEW.school_id;

  IF source_class IN (
    'legacy_pre_connect_settled',
    'instructor_goodwill',
    'external_cash_settled',
    'free',
    'manual_review'
  ) AND (
    NEW.payable_contribution_pence <> 0
    OR NEW.instructor_earning_contribution_pence <> 0
  ) THEN
    RAISE EXCEPTION 'funding class % cannot contribute to instructor payout', source_class
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS booking_earning_sources_class_guard ON booking_earning_sources;
CREATE TRIGGER booking_earning_sources_class_guard
  BEFORE INSERT ON booking_earning_sources
  FOR EACH ROW EXECUTE FUNCTION payout_v2_validate_source_allocation();

CREATE OR REPLACE FUNCTION payout_v2_validate_earning_totals()
RETURNS TRIGGER AS $$
DECLARE
  earning booking_earnings%ROWTYPE;
  totals RECORD;
  target_id BIGINT;
  target_school_id INTEGER;
BEGIN
  target_school_id := NEW.school_id;
  IF TG_TABLE_NAME = 'booking_earnings' THEN
    target_id := NEW.id;
  ELSE
    target_id := NEW.booking_earning_id;
  END IF;
  SELECT * INTO earning
    FROM booking_earnings
   WHERE id = target_id
     AND school_id = target_school_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT
    COALESCE(SUM(gross_contribution_pence), 0) AS gross,
    COALESCE(SUM(stripe_fee_contribution_pence), 0) AS stripe_fee,
    COALESCE(SUM(instructor_earning_contribution_pence), 0) AS instructor,
    COALESCE(SUM(platform_fee_contribution_pence), 0) AS platform,
    COALESCE(SUM(franchise_fee_contribution_pence), 0) AS franchise
  INTO totals
  FROM booking_earning_sources
  WHERE booking_earning_id = earning.id
    AND school_id = earning.school_id;

  IF totals.gross <> earning.gross_price_snapshot_pence
    OR totals.stripe_fee <> earning.stripe_fee_snapshot_pence
    OR totals.instructor <> earning.instructor_earning_pence
    OR totals.platform <> earning.platform_fee_pence
    OR totals.franchise <> earning.franchise_fee_allocation_pence
  THEN
    RAISE EXCEPTION 'booking earning % source allocations do not conserve totals', earning.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS booking_earning_sources_totals_guard ON booking_earning_sources;
CREATE CONSTRAINT TRIGGER booking_earning_sources_totals_guard
  AFTER INSERT ON booking_earning_sources
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION payout_v2_validate_earning_totals();
DROP TRIGGER IF EXISTS booking_earnings_totals_guard ON booking_earnings;
CREATE CONSTRAINT TRIGGER booking_earnings_totals_guard
  AFTER INSERT ON booking_earnings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION payout_v2_validate_earning_totals();

CREATE OR REPLACE FUNCTION payout_v2_validate_source_caps()
RETURNS TRIGGER AS $$
DECLARE
  source_row payout_funding_sources%ROWTYPE;
  allocated BIGINT;
  transferred BIGINT;
  target_id BIGINT;
  target_school_id INTEGER;
BEGIN
  target_school_id := NEW.school_id;
  target_id := NEW.funding_source_id;
  SELECT * INTO source_row
    FROM payout_funding_sources
   WHERE id = target_id
     AND school_id = target_school_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT COALESCE(SUM(payable_contribution_pence), 0)
    INTO allocated
    FROM booking_earning_sources
   WHERE funding_source_id = source_row.id
     AND school_id = source_row.school_id;
  SELECT COALESCE(SUM(amount_pence), 0)
    INTO transferred
    FROM payout_transfer_sources
   WHERE funding_source_id = source_row.id
     AND school_id = source_row.school_id;

  IF allocated > source_row.payable_pool_pence THEN
    RAISE EXCEPTION 'funding source % allocations exceed payable pool', source_row.id
      USING ERRCODE = '23514';
  END IF;
  IF transferred > allocated OR transferred > source_row.payable_pool_pence THEN
    RAISE EXCEPTION 'funding source % transfers exceed allocated payable value', source_row.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS booking_earning_sources_cap_guard ON booking_earning_sources;
CREATE CONSTRAINT TRIGGER booking_earning_sources_cap_guard
  AFTER INSERT ON booking_earning_sources
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION payout_v2_validate_source_caps();
DROP TRIGGER IF EXISTS payout_transfer_sources_cap_guard ON payout_transfer_sources;
CREATE CONSTRAINT TRIGGER payout_transfer_sources_cap_guard
  AFTER INSERT ON payout_transfer_sources
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION payout_v2_validate_source_caps();

CREATE OR REPLACE FUNCTION payout_v2_validate_transfer_totals()
RETURNS TRIGGER AS $$
DECLARE
  transfer_row payout_transfers%ROWTYPE;
  sourced_pence BIGINT;
  target_transfer_id BIGINT;
  target_school_id INTEGER;
BEGIN
  target_school_id := NEW.school_id;
  IF TG_TABLE_NAME = 'payout_transfers' THEN
    target_transfer_id := NEW.id;
  ELSE
    target_transfer_id := NEW.payout_transfer_id;
  END IF;

  SELECT * INTO transfer_row
    FROM payout_transfers
   WHERE id = target_transfer_id
     AND school_id = target_school_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT COALESCE(SUM(amount_pence), 0)
    INTO sourced_pence
    FROM payout_transfer_sources
   WHERE payout_transfer_id = transfer_row.id
     AND school_id = transfer_row.school_id;

  IF sourced_pence <> transfer_row.amount_pence THEN
    RAISE EXCEPTION 'payout transfer % source allocations do not equal transfer amount', transfer_row.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payout_transfers_totals_guard ON payout_transfers;
CREATE CONSTRAINT TRIGGER payout_transfers_totals_guard
  AFTER INSERT ON payout_transfers
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION payout_v2_validate_transfer_totals();
DROP TRIGGER IF EXISTS payout_transfer_sources_totals_guard ON payout_transfer_sources;
CREATE CONSTRAINT TRIGGER payout_transfer_sources_totals_guard
  AFTER INSERT ON payout_transfer_sources
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION payout_v2_validate_transfer_totals();

-- Slice 6: inactive protected-balance and operator-control evidence.
CREATE TABLE IF NOT EXISTS payout_v2_liquidity_config_versions (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER REFERENCES schools(id),
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('global', 'school')),
  risk_reserve_pence INTEGER NOT NULL CHECK (risk_reserve_pence >= 0),
  effective_at TIMESTAMPTZ NOT NULL,
  reason TEXT NOT NULL CHECK (NULLIF(BTRIM(reason), '') IS NOT NULL),
  operator_id INTEGER NOT NULL,
  config_fingerprint TEXT NOT NULL UNIQUE
    CHECK (config_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  evidence_json JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(evidence_json) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((scope_kind = 'global' AND school_id IS NULL)
      OR (scope_kind = 'school' AND school_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_v2_liquidity_config_global_effective
  ON payout_v2_liquidity_config_versions(effective_at) WHERE scope_kind = 'global';
CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_v2_liquidity_config_school_effective
  ON payout_v2_liquidity_config_versions(school_id, effective_at) WHERE scope_kind = 'school';
CREATE INDEX IF NOT EXISTS idx_payout_v2_liquidity_config_latest
  ON payout_v2_liquidity_config_versions(scope_kind, school_id, effective_at DESC);

CREATE TABLE IF NOT EXISTS payout_v2_refund_obligation_events (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  refund_event_id INTEGER,
  logical_identity TEXT NOT NULL,
  sequence_no INTEGER NOT NULL CHECK (sequence_no > 0),
  state TEXT NOT NULL CHECK (state IN ('approved', 'executed', 'voided')),
  amount_pence INTEGER NOT NULL CHECK (amount_pence > 0),
  evidence_status TEXT NOT NULL
    CHECK (evidence_status IN ('complete', 'contradictory', 'manual_review')),
  reason TEXT NOT NULL CHECK (NULLIF(BTRIM(reason), '') IS NOT NULL),
  operator_id INTEGER NOT NULL,
  external_refund_identity TEXT,
  event_fingerprint TEXT NOT NULL UNIQUE
    CHECK (event_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  evidence_json JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(evidence_json) = 'object'),
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, logical_identity, sequence_no),
  FOREIGN KEY (refund_event_id, school_id) REFERENCES refund_events(id, school_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_v2_refund_obligation_external
  ON payout_v2_refund_obligation_events(external_refund_identity)
  WHERE external_refund_identity IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payout_v2_refund_obligation_latest
  ON payout_v2_refund_obligation_events(school_id, logical_identity, sequence_no DESC, id DESC);

CREATE TABLE IF NOT EXISTS payout_v2_protected_balance_snapshots (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER REFERENCES schools(id),
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('global', 'school')),
  snapshot_identity TEXT NOT NULL UNIQUE,
  calculation_version TEXT NOT NULL,
  calculation_fingerprint TEXT NOT NULL UNIQUE
    CHECK (calculation_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  position_fingerprint TEXT NOT NULL
    CHECK (position_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  input_timestamp TIMESTAMPTZ NOT NULL,
  stripe_available_pence INTEGER NOT NULL,
  stripe_pending_pence INTEGER NOT NULL,
  protected_free_cash_pence INTEGER NOT NULL,
  transfer_readiness_pence INTEGER NOT NULL,
  calculation_json JSONB NOT NULL CHECK (jsonb_typeof(calculation_json) = 'object'),
  blocker_codes JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(blocker_codes) = 'array'),
  authority_class TEXT NOT NULL CHECK (authority_class IN ('cron', 'superadmin', 'scoped_operator')),
  evidence_fingerprint TEXT NOT NULL UNIQUE
    CHECK (evidence_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((scope_kind = 'global' AND school_id IS NULL)
      OR (scope_kind = 'school' AND school_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_payout_v2_protected_snapshots_scope
  ON payout_v2_protected_balance_snapshots(scope_kind, school_id, input_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_payout_v2_protected_snapshots_negative
  ON payout_v2_protected_balance_snapshots(input_timestamp DESC)
  WHERE protected_free_cash_pence < 0;

CREATE TABLE IF NOT EXISTS payout_v2_operator_evidence (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER REFERENCES schools(id),
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('global', 'school')),
  evidence_type TEXT NOT NULL CHECK (evidence_type IN (
    'withdrawal_preflight', 'withdrawal_record', 'mutation_refusal',
    'mutation_approval', 'alert_result'
  )),
  logical_identity TEXT NOT NULL UNIQUE,
  external_identity TEXT,
  authority_class TEXT NOT NULL CHECK (authority_class IN ('cron', 'superadmin', 'scoped_operator')),
  operator_id INTEGER,
  reason TEXT NOT NULL CHECK (NULLIF(BTRIM(reason), '') IS NOT NULL),
  confirmation_fingerprint TEXT
    CHECK (confirmation_fingerprint IS NULL OR confirmation_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  expected_calculation_fingerprint TEXT
    CHECK (expected_calculation_fingerprint IS NULL OR expected_calculation_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  calculation_fingerprint TEXT
    CHECK (calculation_fingerprint IS NULL OR calculation_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  proposed_amount_pence INTEGER CHECK (proposed_amount_pence IS NULL OR proposed_amount_pence > 0),
  before_protected_balance_pence INTEGER,
  after_protected_balance_pence INTEGER,
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'refused', 'recorded', 'failed')),
  refusal_codes JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(refusal_codes) = 'array'),
  alert_emission_status TEXT
    CHECK (alert_emission_status IS NULL OR alert_emission_status IN (
      'not_required', 'deduplicated', 'emitted', 'failed'
    )),
  alert_deduplication_identity TEXT,
  evidence_fingerprint TEXT NOT NULL UNIQUE
    CHECK (evidence_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  evidence_json JSONB NOT NULL CHECK (jsonb_typeof(evidence_json) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((scope_kind = 'global' AND school_id IS NULL)
      OR (scope_kind = 'school' AND school_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_v2_operator_external_identity
  ON payout_v2_operator_evidence(external_identity) WHERE external_identity IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payout_v2_operator_evidence_scope
  ON payout_v2_operator_evidence(scope_kind, school_id, created_at DESC);

CREATE TABLE IF NOT EXISTS payout_v2_protected_balance_alert_events (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER REFERENCES schools(id),
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('global', 'school')),
  alert_identity TEXT NOT NULL CHECK (alert_identity ~ '^sha256:[0-9a-f]{64}$'),
  event_identity TEXT NOT NULL UNIQUE,
  phase TEXT NOT NULL CHECK (phase IN ('claim', 'result')),
  classification TEXT NOT NULL CHECK (classification IN (
    'ordinary_liability_growth', 'observed_external_manual_dashboard_withdrawal',
    'missing_stripe_balance_evidence', 'stale_stripe_balance_evidence',
    'unexplained_balance_movement'
  )),
  status TEXT NOT NULL CHECK (status IN ('claimed', 'emitted', 'failed')),
  calculation_fingerprint TEXT NOT NULL
    CHECK (calculation_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  position_fingerprint TEXT NOT NULL
    CHECK (position_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  protected_free_cash_pence INTEGER NOT NULL,
  blocker_codes JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(blocker_codes) = 'array'),
  transport_reference TEXT,
  failure_code TEXT,
  event_fingerprint TEXT NOT NULL UNIQUE
    CHECK (event_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  evidence_json JSONB NOT NULL CHECK (jsonb_typeof(evidence_json) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((scope_kind = 'global' AND school_id IS NULL)
      OR (scope_kind = 'school' AND school_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_payout_v2_protected_alert_scope
  ON payout_v2_protected_balance_alert_events(scope_kind, school_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payout_v2_protected_alert_identity
  ON payout_v2_protected_balance_alert_events(alert_identity, phase);

DROP TRIGGER IF EXISTS payout_v2_liquidity_config_versions_append_only ON payout_v2_liquidity_config_versions;
CREATE TRIGGER payout_v2_liquidity_config_versions_append_only
  BEFORE UPDATE OR DELETE ON payout_v2_liquidity_config_versions
  FOR EACH ROW EXECUTE FUNCTION payout_v2_reject_change();
DROP TRIGGER IF EXISTS payout_v2_refund_obligation_events_append_only ON payout_v2_refund_obligation_events;
CREATE TRIGGER payout_v2_refund_obligation_events_append_only
  BEFORE UPDATE OR DELETE ON payout_v2_refund_obligation_events
  FOR EACH ROW EXECUTE FUNCTION payout_v2_reject_change();
DROP TRIGGER IF EXISTS payout_v2_protected_balance_snapshots_append_only ON payout_v2_protected_balance_snapshots;
CREATE TRIGGER payout_v2_protected_balance_snapshots_append_only
  BEFORE UPDATE OR DELETE ON payout_v2_protected_balance_snapshots
  FOR EACH ROW EXECUTE FUNCTION payout_v2_reject_change();
DROP TRIGGER IF EXISTS payout_v2_operator_evidence_append_only ON payout_v2_operator_evidence;
CREATE TRIGGER payout_v2_operator_evidence_append_only
  BEFORE UPDATE OR DELETE ON payout_v2_operator_evidence
  FOR EACH ROW EXECUTE FUNCTION payout_v2_reject_change();
DROP TRIGGER IF EXISTS payout_v2_protected_balance_alert_events_append_only ON payout_v2_protected_balance_alert_events;
CREATE TRIGGER payout_v2_protected_balance_alert_events_append_only
  BEFORE UPDATE OR DELETE ON payout_v2_protected_balance_alert_events
  FOR EACH ROW EXECUTE FUNCTION payout_v2_reject_change();

-- Slice 7: inactive controlled-cutover preparation evidence.
--
-- These tables do not activate v2, schedule work, or call Stripe. They preserve
-- the explicit owner/operator decisions and two-cycle shadow evidence required
-- before a future, separately authorised engine transition.
CREATE TABLE IF NOT EXISTS payout_v2_cutover_config_versions (
  id BIGSERIAL PRIMARY KEY,
  contract_version TEXT NOT NULL CHECK (NULLIF(BTRIM(contract_version), '') IS NOT NULL),
  school_id INTEGER NOT NULL REFERENCES schools(id),
  version_no INTEGER NOT NULL CHECK (version_no > 0),
  payout_route TEXT NOT NULL CHECK (payout_route IN ('instructor_direct', 'school')),
  first_live_instructor_id INTEGER NOT NULL,
  first_live_cap_pence INTEGER NOT NULL CHECK (first_live_cap_pence > 0),
  mutation_operator_id INTEGER NOT NULL,
  mutation_operator_authority_class TEXT NOT NULL
    CHECK (mutation_operator_authority_class IN ('superadmin', 'scoped_operator')),
  operator_allowed_operations JSONB NOT NULL
    CHECK (jsonb_typeof(operator_allowed_operations) = 'array'),
  risk_reserve_config_fingerprint TEXT NOT NULL
    CHECK (risk_reserve_config_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  protected_balance_calculation_fingerprint TEXT NOT NULL
    CHECK (protected_balance_calculation_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  protected_balance_scope_kind TEXT NOT NULL
    CHECK (protected_balance_scope_kind = 'global'),
  route_evidence_reference TEXT NOT NULL
    CHECK (NULLIF(BTRIM(route_evidence_reference), '') IS NOT NULL),
  external_cash_classification TEXT NOT NULL
    CHECK (external_cash_classification = 'complete'),
  external_cash_evidence_reference TEXT NOT NULL
    CHECK (NULLIF(BTRIM(external_cash_evidence_reference), '') IS NOT NULL),
  setmore_classification TEXT NOT NULL
    CHECK (setmore_classification IN ('complete', 'not_applicable')),
  setmore_evidence_reference TEXT NOT NULL
    CHECK (NULLIF(BTRIM(setmore_evidence_reference), '') IS NOT NULL),
  owner_approved_by TEXT NOT NULL CHECK (NULLIF(BTRIM(owner_approved_by), '') IS NOT NULL),
  owner_approved_at TIMESTAMPTZ NOT NULL,
  owner_approval_reference TEXT NOT NULL
    CHECK (NULLIF(BTRIM(owner_approval_reference), '') IS NOT NULL),
  rollback_criteria JSONB NOT NULL CHECK (jsonb_typeof(rollback_criteria) = 'object'),
  config_fingerprint TEXT NOT NULL UNIQUE
    CHECK (config_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, version_no),
  FOREIGN KEY (first_live_instructor_id, school_id)
    REFERENCES instructors(id, school_id)
);
CREATE INDEX IF NOT EXISTS idx_payout_v2_cutover_config_latest
  ON payout_v2_cutover_config_versions(school_id, version_no DESC);

CREATE TABLE IF NOT EXISTS payout_v2_shadow_cycle_evidence (
  id BIGSERIAL PRIMARY KEY,
  contract_version TEXT NOT NULL CHECK (NULLIF(BTRIM(contract_version), '') IS NOT NULL),
  school_id INTEGER NOT NULL REFERENCES schools(id),
  cycle_ordinal INTEGER NOT NULL CHECK (cycle_ordinal IN (1, 2)),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  shadow_statement_fingerprint TEXT NOT NULL
    CHECK (shadow_statement_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  v1_preview_fingerprint TEXT NOT NULL
    CHECK (v1_preview_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  comparison_fingerprint TEXT NOT NULL
    CHECK (comparison_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  unexplained_difference_count INTEGER NOT NULL CHECK (unexplained_difference_count >= 0),
  ambiguous_source_count INTEGER NOT NULL CHECK (ambiguous_source_count >= 0),
  decision TEXT NOT NULL CHECK (decision IN ('accepted', 'rejected')),
  owner_approved_by TEXT NOT NULL CHECK (NULLIF(BTRIM(owner_approved_by), '') IS NOT NULL),
  owner_approved_at TIMESTAMPTZ NOT NULL,
  evidence_reference TEXT NOT NULL CHECK (NULLIF(BTRIM(evidence_reference), '') IS NOT NULL),
  evidence_fingerprint TEXT NOT NULL UNIQUE
    CHECK (evidence_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, cycle_ordinal),
  CHECK (period_start <= period_end),
  CHECK (
    decision <> 'accepted'
    OR (unexplained_difference_count = 0 AND ambiguous_source_count = 0)
  )
);
CREATE INDEX IF NOT EXISTS idx_payout_v2_shadow_cycle_school
  ON payout_v2_shadow_cycle_evidence(school_id, cycle_ordinal);

CREATE TABLE IF NOT EXISTS payout_v2_cutover_readiness_snapshots (
  id BIGSERIAL PRIMARY KEY,
  contract_version TEXT NOT NULL CHECK (NULLIF(BTRIM(contract_version), '') IS NOT NULL),
  school_id INTEGER NOT NULL REFERENCES schools(id),
  config_version_id BIGINT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ready', 'blocked')),
  readiness_fingerprint TEXT NOT NULL UNIQUE
    CHECK (readiness_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  payout_engine_version TEXT NOT NULL CHECK (payout_engine_version IN ('v1', 'v2')),
  protected_balance_calculation_fingerprint TEXT NOT NULL
    CHECK (protected_balance_calculation_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  protected_balance_position_fingerprint TEXT NOT NULL
    CHECK (protected_balance_position_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  shadow_cycle_fingerprints JSONB NOT NULL
    CHECK (jsonb_typeof(shadow_cycle_fingerprints) = 'array'),
  blocker_codes JSONB NOT NULL CHECK (jsonb_typeof(blocker_codes) = 'array'),
  diagnostics_json JSONB NOT NULL CHECK (jsonb_typeof(diagnostics_json) = 'object'),
  evidence_json JSONB NOT NULL CHECK (jsonb_typeof(evidence_json) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  FOREIGN KEY (config_version_id, school_id)
    REFERENCES payout_v2_cutover_config_versions(id, school_id),
  CHECK (status <> 'ready' OR blocker_codes = '[]'::jsonb)
);
CREATE INDEX IF NOT EXISTS idx_payout_v2_cutover_readiness_latest
  ON payout_v2_cutover_readiness_snapshots(school_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS payout_v2_cutover_events (
  id BIGSERIAL PRIMARY KEY,
  contract_version TEXT NOT NULL CHECK (NULLIF(BTRIM(contract_version), '') IS NOT NULL),
  school_id INTEGER NOT NULL REFERENCES schools(id),
  sequence_no INTEGER NOT NULL CHECK (sequence_no > 0),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'capped_batch_dry_run', 'engine_transition', 'post_batch_reconciliation',
    'incident_opened', 'incident_resolved', 'rollback_started', 'rollback_completed'
  )),
  status TEXT NOT NULL CHECK (status IN ('recorded', 'blocked', 'open', 'resolved')),
  event_identity TEXT NOT NULL UNIQUE
    CHECK (NULLIF(BTRIM(event_identity), '') IS NOT NULL),
  config_version_id BIGINT,
  readiness_fingerprint TEXT
    CHECK (readiness_fingerprint IS NULL OR readiness_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  payout_batch_id BIGINT,
  plan_fingerprint TEXT
    CHECK (plan_fingerprint IS NULL OR plan_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  authority_class TEXT NOT NULL
    CHECK (authority_class IN ('cron', 'superadmin', 'scoped_operator')),
  operator_id INTEGER,
  reason TEXT NOT NULL CHECK (NULLIF(BTRIM(reason), '') IS NOT NULL),
  event_fingerprint TEXT NOT NULL UNIQUE
    CHECK (event_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  evidence_json JSONB NOT NULL CHECK (jsonb_typeof(evidence_json) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, sequence_no),
  FOREIGN KEY (config_version_id, school_id)
    REFERENCES payout_v2_cutover_config_versions(id, school_id),
  FOREIGN KEY (payout_batch_id, school_id)
    REFERENCES payout_batches(id, school_id),
  CHECK (
    event_type <> 'engine_transition'
    OR (
      status = 'recorded'
      AND config_version_id IS NOT NULL
      AND readiness_fingerprint IS NOT NULL
      AND operator_id IS NOT NULL
    )
  )
);
CREATE INDEX IF NOT EXISTS idx_payout_v2_cutover_events_school
  ON payout_v2_cutover_events(school_id, sequence_no DESC);
CREATE INDEX IF NOT EXISTS idx_payout_v2_cutover_events_open_incident
  ON payout_v2_cutover_events(school_id, event_type, created_at DESC)
  WHERE status = 'open';

DROP TRIGGER IF EXISTS payout_v2_cutover_config_versions_append_only ON payout_v2_cutover_config_versions;
CREATE TRIGGER payout_v2_cutover_config_versions_append_only
  BEFORE UPDATE OR DELETE ON payout_v2_cutover_config_versions
  FOR EACH ROW EXECUTE FUNCTION payout_v2_reject_change();
DROP TRIGGER IF EXISTS payout_v2_shadow_cycle_evidence_append_only ON payout_v2_shadow_cycle_evidence;
CREATE TRIGGER payout_v2_shadow_cycle_evidence_append_only
  BEFORE UPDATE OR DELETE ON payout_v2_shadow_cycle_evidence
  FOR EACH ROW EXECUTE FUNCTION payout_v2_reject_change();
DROP TRIGGER IF EXISTS payout_v2_cutover_readiness_snapshots_append_only ON payout_v2_cutover_readiness_snapshots;
CREATE TRIGGER payout_v2_cutover_readiness_snapshots_append_only
  BEFORE UPDATE OR DELETE ON payout_v2_cutover_readiness_snapshots
  FOR EACH ROW EXECUTE FUNCTION payout_v2_reject_change();
DROP TRIGGER IF EXISTS payout_v2_cutover_events_append_only ON payout_v2_cutover_events;
CREATE TRIGGER payout_v2_cutover_events_append_only
  BEFORE UPDATE OR DELETE ON payout_v2_cutover_events
  FOR EACH ROW EXECUTE FUNCTION payout_v2_reject_change();

-- Stripe Connect Simon launch: inert Slice 1 schema foundation.
--
-- DDL only. This migration does not seed launch configuration or agreements,
-- classify historic payments, activate a payout engine, write application
-- evidence, call Stripe, schedule work, or move money. Every tenant key and
-- commercial/Stripe identity is explicit; none has a school/currency/mode
-- default.

CREATE UNIQUE INDEX IF NOT EXISTS uq_refund_events_id_school_launch
  ON refund_events(id, school_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_users_id_school_launch
  ON admin_users(id, school_id);

-- Nullable bridges into the existing evidence and calendar tables. Existing
-- rows remain valid and are not backfilled.
ALTER TABLE payout_funding_sources
  ADD COLUMN IF NOT EXISTS stripe_payment_created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stripe_funds_available_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_origin TEXT,
  ADD COLUMN IF NOT EXISTS source_booking_id INTEGER,
  ADD COLUMN IF NOT EXISTS lesson_payment_contract_id UUID,
  ADD COLUMN IF NOT EXISTS evidence_completeness TEXT,
  ADD COLUMN IF NOT EXISTS contradiction_code TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payout_funding_sources_launch_origin_check'
      AND conrelid = 'payout_funding_sources'::regclass
  ) THEN
    ALTER TABLE payout_funding_sources
      ADD CONSTRAINT payout_funding_sources_launch_origin_check
      CHECK (payment_origin IS NULL OR payment_origin IN (
        'direct_slot', 'test_date_direct', 'one_off_offer', 'captured_request'
      ));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payout_funding_sources_evidence_completeness_check'
      AND conrelid = 'payout_funding_sources'::regclass
  ) THEN
    ALTER TABLE payout_funding_sources
      ADD CONSTRAINT payout_funding_sources_evidence_completeness_check
      CHECK (evidence_completeness IS NULL OR evidence_completeness IN (
        'pending', 'complete', 'contradictory'
      ));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payout_funding_sources_contradiction_check'
      AND conrelid = 'payout_funding_sources'::regclass
  ) THEN
    ALTER TABLE payout_funding_sources
      ADD CONSTRAINT payout_funding_sources_contradiction_check
      CHECK (
        (evidence_completeness = 'contradictory'
          AND NULLIF(BTRIM(contradiction_code), '') IS NOT NULL)
        OR (evidence_completeness IS DISTINCT FROM 'contradictory'
          AND contradiction_code IS NULL)
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payout_funding_sources_source_booking_school_fk'
      AND conrelid = 'payout_funding_sources'::regclass
  ) THEN
    ALTER TABLE payout_funding_sources
      ADD CONSTRAINT payout_funding_sources_source_booking_school_fk
      FOREIGN KEY (source_booking_id, school_id)
      REFERENCES lesson_bookings(id, school_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_payout_funding_sources_launch_booking
  ON payout_funding_sources(school_id, source_booking_id)
  WHERE source_booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payout_funding_sources_launch_evidence
  ON payout_funding_sources(school_id, evidence_completeness, stripe_payment_created_at)
  WHERE evidence_completeness IS NOT NULL;

CREATE TABLE IF NOT EXISTS stripe_connect_launch_configs (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  cutover_at TIMESTAMPTZ NOT NULL,
  accounting_version TEXT NOT NULL,
  mode TEXT NOT NULL,
  created_by_admin_id INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  activated_at TIMESTAMPTZ,
  paused_at TIMESTAMPTZ,
  pause_reason TEXT,
  UNIQUE (id, school_id),
  UNIQUE (school_id),
  FOREIGN KEY (created_by_admin_id, school_id)
    REFERENCES admin_users(id, school_id),
  CHECK (accounting_version = 'simon_launch_v1'),
  CHECK (mode IN ('disabled', 'shadow', 'approval_pending', 'live', 'paused')),
  CHECK (mode NOT IN ('live', 'paused') OR activated_at IS NOT NULL),
  CHECK (
    (mode = 'paused' AND paused_at IS NOT NULL
      AND NULLIF(BTRIM(pause_reason), '') IS NOT NULL)
    OR (mode <> 'paused' AND paused_at IS NULL AND pause_reason IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS stripe_connect_launch_events (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  launch_config_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  mode_before TEXT,
  mode_after TEXT,
  actor_type TEXT NOT NULL,
  actor_admin_id INTEGER,
  reason TEXT NOT NULL,
  evidence_json JSONB NOT NULL,
  idempotency_identity TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  event_fingerprint TEXT NOT NULL,
  UNIQUE (id, school_id),
  UNIQUE (school_id, idempotency_identity),
  UNIQUE (school_id, event_fingerprint),
  FOREIGN KEY (launch_config_id, school_id)
    REFERENCES stripe_connect_launch_configs(id, school_id),
  FOREIGN KEY (actor_admin_id, school_id)
    REFERENCES admin_users(id, school_id),
  CHECK (event_type IN (
    'mode_changed', 'first_run_approved', 'paused', 'resumed',
    'legacy_engine_disabled'
  )),
  CHECK (mode_before IS NULL OR mode_before IN (
    'disabled', 'shadow', 'approval_pending', 'live', 'paused'
  )),
  CHECK (mode_after IS NULL OR mode_after IN (
    'disabled', 'shadow', 'approval_pending', 'live', 'paused'
  )),
  CHECK (actor_type IN ('system', 'admin')),
  CHECK ((actor_type = 'admin' AND actor_admin_id IS NOT NULL)
      OR (actor_type = 'system' AND actor_admin_id IS NULL)),
  CHECK (NULLIF(BTRIM(reason), '') IS NOT NULL),
  CHECK (jsonb_typeof(evidence_json) = 'object'),
  CHECK (event_fingerprint ~ '^sha256:[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_stripe_launch_events_config
  ON stripe_connect_launch_events(school_id, launch_config_id, occurred_at);

CREATE TABLE IF NOT EXISTS instructor_payout_agreement_versions (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  instructor_id INTEGER NOT NULL,
  version_number INTEGER NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  status TEXT NOT NULL,
  split_bps INTEGER NOT NULL,
  weekly_franchise_fee_minor BIGINT NOT NULL,
  currency TEXT NOT NULL,
  accepted_at TIMESTAMPTZ,
  acceptance_evidence_reference TEXT,
  document_version TEXT NOT NULL,
  connect_scope_id BIGINT,
  stripe_configuration_id TEXT,
  created_by_admin_id INTEGER NOT NULL,
  approved_by_admin_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL,
  approved_at TIMESTAMPTZ,
  agreement_fingerprint TEXT NOT NULL,
  UNIQUE (id, school_id),
  UNIQUE (school_id, instructor_id, version_number),
  UNIQUE (school_id, agreement_fingerprint),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  FOREIGN KEY (connect_scope_id, school_id)
    REFERENCES payout_v2_connected_account_scopes(id, school_id),
  FOREIGN KEY (created_by_admin_id, school_id)
    REFERENCES admin_users(id, school_id),
  FOREIGN KEY (approved_by_admin_id, school_id)
    REFERENCES admin_users(id, school_id),
  CHECK (version_number > 0),
  CHECK (ends_at IS NULL OR ends_at > starts_at),
  CHECK (status IN ('draft', 'active', 'paused', 'ended')),
  CHECK (split_bps BETWEEN 0 AND 10000),
  CHECK (weekly_franchise_fee_minor >= 0),
  CHECK (currency = LOWER(currency) AND char_length(currency) = 3),
  CHECK (NULLIF(BTRIM(document_version), '') IS NOT NULL),
  CHECK (agreement_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (
    status = 'draft'
    OR (
      accepted_at IS NOT NULL
      AND NULLIF(BTRIM(acceptance_evidence_reference), '') IS NOT NULL
      AND approved_by_admin_id IS NOT NULL
      AND approved_at IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_payout_agreements_instructor_effective
  ON instructor_payout_agreement_versions(school_id, instructor_id, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_payout_agreements_connect_scope
  ON instructor_payout_agreement_versions(school_id, connect_scope_id)
  WHERE connect_scope_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS lesson_payment_contracts (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  learner_id INTEGER NOT NULL,
  instructor_id INTEGER NOT NULL,
  funding_source_id BIGINT NOT NULL,
  origin TEXT NOT NULL,
  regime TEXT NOT NULL,
  stripe_payment_created_at TIMESTAMPTZ NOT NULL,
  gross_amount_minor BIGINT NOT NULL,
  stripe_fee_minor BIGINT,
  currency TEXT NOT NULL,
  split_bps INTEGER,
  agreement_version_id UUID,
  stripe_payment_intent_id TEXT NOT NULL,
  stripe_charge_id TEXT NOT NULL,
  stripe_balance_transaction_id TEXT,
  stripe_funds_available_at TIMESTAMPTZ,
  evidence_status TEXT NOT NULL,
  ineligibility_code TEXT,
  contradiction_code TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  fingerprint TEXT NOT NULL,
  UNIQUE (id, school_id),
  UNIQUE (school_id, funding_source_id),
  UNIQUE (school_id, stripe_payment_intent_id),
  UNIQUE (school_id, stripe_charge_id),
  UNIQUE (school_id, fingerprint),
  FOREIGN KEY (learner_id, school_id)
    REFERENCES learner_users(id, school_id),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  FOREIGN KEY (funding_source_id, school_id)
    REFERENCES payout_funding_sources(id, school_id),
  FOREIGN KEY (agreement_version_id, school_id)
    REFERENCES instructor_payout_agreement_versions(id, school_id),
  CHECK (origin IN (
    'direct_slot', 'test_date_direct', 'one_off_offer', 'captured_request'
  )),
  CHECK (regime IN ('legacy', 'launch')),
  CHECK (gross_amount_minor > 0),
  CHECK (stripe_fee_minor IS NULL OR (
    stripe_fee_minor >= 0 AND stripe_fee_minor <= gross_amount_minor
  )),
  CHECK (currency = LOWER(currency) AND char_length(currency) = 3),
  CHECK (split_bps IS NULL OR split_bps BETWEEN 0 AND 10000),
  CHECK (NULLIF(BTRIM(stripe_payment_intent_id), '') IS NOT NULL),
  CHECK (NULLIF(BTRIM(stripe_charge_id), '') IS NOT NULL),
  CHECK (evidence_status IN ('pending', 'complete', 'contradictory', 'ineligible')),
  CHECK (fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (
    evidence_status <> 'complete'
    OR (
      stripe_fee_minor IS NOT NULL
      AND stripe_balance_transaction_id IS NOT NULL
      AND stripe_funds_available_at IS NOT NULL
      AND agreement_version_id IS NOT NULL
      AND split_bps IS NOT NULL
      AND completed_at IS NOT NULL
      AND ineligibility_code IS NULL
      AND contradiction_code IS NULL
    )
  ),
  CHECK (
    (evidence_status = 'ineligible'
      AND NULLIF(BTRIM(ineligibility_code), '') IS NOT NULL)
    OR (evidence_status <> 'ineligible' AND ineligibility_code IS NULL)
  ),
  CHECK (
    (evidence_status = 'contradictory'
      AND NULLIF(BTRIM(contradiction_code), '') IS NOT NULL)
    OR (evidence_status <> 'contradictory' AND contradiction_code IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_lesson_payment_contracts_pi_global
  ON lesson_payment_contracts(stripe_payment_intent_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_lesson_payment_contracts_charge_global
  ON lesson_payment_contracts(stripe_charge_id);
CREATE INDEX IF NOT EXISTS idx_lesson_payment_contracts_instructor_created
  ON lesson_payment_contracts(school_id, instructor_id, stripe_payment_created_at);
CREATE INDEX IF NOT EXISTS idx_lesson_payment_contracts_learner
  ON lesson_payment_contracts(school_id, learner_id);
CREATE INDEX IF NOT EXISTS idx_lesson_payment_contracts_agreement
  ON lesson_payment_contracts(school_id, agreement_version_id)
  WHERE agreement_version_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payout_funding_sources_contract_school_fk'
      AND conrelid = 'payout_funding_sources'::regclass
  ) THEN
    ALTER TABLE payout_funding_sources
      ADD CONSTRAINT payout_funding_sources_contract_school_fk
      FOREIGN KEY (lesson_payment_contract_id, school_id)
      REFERENCES lesson_payment_contracts(id, school_id);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_funding_sources_launch_contract
  ON payout_funding_sources(school_id, lesson_payment_contract_id)
  WHERE lesson_payment_contract_id IS NOT NULL;

ALTER TABLE lesson_bookings
  ADD COLUMN IF NOT EXISTS lesson_payment_contract_id UUID,
  ADD COLUMN IF NOT EXISTS slot_released_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS slot_release_reason TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'lesson_bookings_launch_contract_school_fk'
      AND conrelid = 'lesson_bookings'::regclass
  ) THEN
    ALTER TABLE lesson_bookings
      ADD CONSTRAINT lesson_bookings_launch_contract_school_fk
      FOREIGN KEY (lesson_payment_contract_id, school_id)
      REFERENCES lesson_payment_contracts(id, school_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'lesson_bookings_slot_release_check'
      AND conrelid = 'lesson_bookings'::regclass
  ) THEN
    ALTER TABLE lesson_bookings
      ADD CONSTRAINT lesson_bookings_slot_release_check
      CHECK (
        (slot_released_at IS NULL AND slot_release_reason IS NULL)
        OR (slot_released_at IS NOT NULL
          AND NULLIF(BTRIM(slot_release_reason), '') IS NOT NULL)
      );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_lesson_bookings_active_launch_contract
  ON lesson_bookings(school_id, lesson_payment_contract_id)
  WHERE lesson_payment_contract_id IS NOT NULL
    AND status IN ('scheduled', 'chargeable');
CREATE INDEX IF NOT EXISTS idx_lesson_bookings_launch_contract
  ON lesson_bookings(school_id, lesson_payment_contract_id)
  WHERE lesson_payment_contract_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS lesson_outcome_revisions (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  booking_id INTEGER NOT NULL,
  lesson_payment_contract_id UUID,
  instructor_id INTEGER NOT NULL,
  revision_number INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  supersedes_revision_id UUID,
  replacement_booking_id INTEGER,
  actor_type TEXT NOT NULL,
  actor_instructor_id INTEGER NOT NULL,
  actor_admin_id INTEGER,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  idempotency_key TEXT NOT NULL,
  reason_code TEXT,
  outcome_fingerprint TEXT NOT NULL,
  UNIQUE (id, school_id),
  UNIQUE (school_id, booking_id, revision_number),
  UNIQUE (school_id, idempotency_key),
  UNIQUE (school_id, outcome_fingerprint),
  FOREIGN KEY (booking_id, school_id)
    REFERENCES lesson_bookings(id, school_id),
  FOREIGN KEY (lesson_payment_contract_id, school_id)
    REFERENCES lesson_payment_contracts(id, school_id),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  FOREIGN KEY (supersedes_revision_id, school_id)
    REFERENCES lesson_outcome_revisions(id, school_id),
  FOREIGN KEY (replacement_booking_id, school_id)
    REFERENCES lesson_bookings(id, school_id),
  FOREIGN KEY (actor_instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  FOREIGN KEY (actor_admin_id, school_id)
    REFERENCES admin_users(id, school_id),
  CHECK (revision_number > 0),
  CHECK (outcome IN (
    'delivered', 'late_learner_cancel_or_no_show',
    'instructor_non_delivery', 'rescheduled'
  )),
  CHECK ((revision_number = 1 AND supersedes_revision_id IS NULL)
      OR (revision_number > 1 AND supersedes_revision_id IS NOT NULL)),
  CHECK ((outcome = 'rescheduled' AND replacement_booking_id IS NOT NULL)
      OR (outcome <> 'rescheduled' AND replacement_booking_id IS NULL)),
  CHECK (actor_type IN ('instructor', 'admin_impersonating_instructor')),
  CHECK ((actor_type = 'instructor' AND actor_admin_id IS NULL)
      OR (actor_type = 'admin_impersonating_instructor' AND actor_admin_id IS NOT NULL)),
  CHECK (outcome_fingerprint ~ '^sha256:[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_lesson_outcome_contract
  ON lesson_outcome_revisions(school_id, lesson_payment_contract_id, revision_number)
  WHERE lesson_payment_contract_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lesson_outcome_instructor
  ON lesson_outcome_revisions(school_id, instructor_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_lesson_outcome_supersedes
  ON lesson_outcome_revisions(school_id, supersedes_revision_id)
  WHERE supersedes_revision_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lesson_outcome_replacement
  ON lesson_outcome_revisions(school_id, replacement_booking_id)
  WHERE replacement_booking_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS lesson_issue_tokens (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  booking_id INTEGER NOT NULL,
  learner_id INTEGER,
  token_digest TEXT NOT NULL,
  nonce TEXT NOT NULL,
  purpose TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  UNIQUE (id, school_id),
  UNIQUE (token_digest),
  UNIQUE (school_id, nonce),
  FOREIGN KEY (booking_id, school_id)
    REFERENCES lesson_bookings(id, school_id),
  FOREIGN KEY (learner_id, school_id)
    REFERENCES learner_users(id, school_id) ON DELETE SET NULL (learner_id),
  CHECK (token_digest ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (purpose = 'lesson_issue_report'),
  CHECK (expires_at > created_at),
  CHECK (consumed_at IS NULL OR revoked_at IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_lesson_issue_tokens_booking
  ON lesson_issue_tokens(school_id, booking_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_lesson_issue_tokens_learner
  ON lesson_issue_tokens(school_id, learner_id)
  WHERE learner_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS lesson_issue_reports (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  booking_id INTEGER NOT NULL,
  learner_id INTEGER,
  token_id UUID NOT NULL,
  category TEXT NOT NULL,
  learner_text TEXT,
  reported_at TIMESTAMPTZ NOT NULL,
  cutoff_classification TEXT NOT NULL,
  applicable_run_id UUID,
  acknowledgement_delivery_state TEXT NOT NULL,
  idempotency_fingerprint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (id, school_id),
  UNIQUE (school_id, token_id),
  UNIQUE (school_id, idempotency_fingerprint),
  FOREIGN KEY (booking_id, school_id)
    REFERENCES lesson_bookings(id, school_id),
  FOREIGN KEY (learner_id, school_id)
    REFERENCES learner_users(id, school_id) ON DELETE SET NULL (learner_id),
  FOREIGN KEY (token_id, school_id)
    REFERENCES lesson_issue_tokens(id, school_id),
  CHECK (category IN (
    'lesson_not_delivered', 'lesson_details_incorrect', 'cancellation_disputed',
    'reschedule_disputed', 'other'
  )),
  CHECK (cutoff_classification IN (
    'before_lock', 'after_lock', 'no_applicable_run'
  )),
  CHECK ((cutoff_classification = 'no_applicable_run' AND applicable_run_id IS NULL)
      OR (cutoff_classification <> 'no_applicable_run' AND applicable_run_id IS NOT NULL)),
  CHECK (acknowledgement_delivery_state IN (
    'pending', 'sent', 'failed', 'not_required'
  )),
  CHECK (idempotency_fingerprint ~ '^sha256:[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_lesson_issue_reports_booking
  ON lesson_issue_reports(school_id, booking_id, reported_at);
CREATE INDEX IF NOT EXISTS idx_lesson_issue_reports_run
  ON lesson_issue_reports(school_id, applicable_run_id)
  WHERE applicable_run_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS lesson_issue_actions (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  issue_report_id UUID NOT NULL,
  action_type TEXT NOT NULL,
  actor_admin_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  evidence_reference TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  idempotency_identity TEXT NOT NULL,
  action_fingerprint TEXT NOT NULL,
  UNIQUE (id, school_id),
  UNIQUE (school_id, idempotency_identity),
  UNIQUE (school_id, action_fingerprint),
  FOREIGN KEY (issue_report_id, school_id)
    REFERENCES lesson_issue_reports(id, school_id),
  FOREIGN KEY (actor_admin_id, school_id)
    REFERENCES admin_users(id, school_id),
  CHECK (action_type IN (
    'review_started', 'information_requested', 'resolved_upheld',
    'resolved_not_upheld', 'financial_correction_referred'
  )),
  CHECK (NULLIF(BTRIM(reason), '') IS NOT NULL),
  CHECK (action_fingerprint ~ '^sha256:[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_lesson_issue_actions_report
  ON lesson_issue_actions(school_id, issue_report_id, occurred_at);

CREATE TABLE IF NOT EXISTS refund_intents (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  learner_id INTEGER NOT NULL,
  instructor_id INTEGER NOT NULL,
  booking_id INTEGER NOT NULL,
  payment_contract_id UUID NOT NULL,
  funding_source_id BIGINT NOT NULL,
  refund_policy TEXT NOT NULL,
  gross_amount_minor BIGINT NOT NULL,
  stripe_fee_minor BIGINT NOT NULL,
  fee_absorbed_by_platform_minor BIGINT NOT NULL,
  refund_amount_minor BIGINT NOT NULL,
  currency TEXT NOT NULL,
  stripe_payment_intent_id TEXT NOT NULL,
  stripe_charge_id TEXT NOT NULL,
  stripe_refund_id TEXT,
  stable_identity TEXT NOT NULL,
  stripe_idempotency_key TEXT NOT NULL,
  state TEXT NOT NULL,
  cancellation_committed_at TIMESTAMPTZ NOT NULL,
  source_batch_id UUID,
  source_earning_id UUID,
  refund_event_id INTEGER,
  actor_type TEXT NOT NULL,
  actor_admin_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  last_error_class TEXT,
  last_error_code TEXT,
  intent_fingerprint TEXT NOT NULL,
  UNIQUE (id, school_id),
  UNIQUE (school_id, stable_identity),
  UNIQUE (stripe_idempotency_key),
  UNIQUE (school_id, payment_contract_id, refund_policy),
  UNIQUE (school_id, intent_fingerprint),
  FOREIGN KEY (learner_id, school_id)
    REFERENCES learner_users(id, school_id),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  FOREIGN KEY (booking_id, school_id)
    REFERENCES lesson_bookings(id, school_id),
  FOREIGN KEY (payment_contract_id, school_id)
    REFERENCES lesson_payment_contracts(id, school_id),
  FOREIGN KEY (funding_source_id, school_id)
    REFERENCES payout_funding_sources(id, school_id),
  FOREIGN KEY (refund_event_id, school_id)
    REFERENCES refund_events(id, school_id),
  FOREIGN KEY (actor_admin_id, school_id)
    REFERENCES admin_users(id, school_id),
  CHECK (refund_policy IN (
    'learner_early', 'instructor_non_delivery', 'dispute_or_operator_correction'
  )),
  CHECK (gross_amount_minor > 0),
  CHECK (stripe_fee_minor BETWEEN 0 AND gross_amount_minor),
  CHECK (fee_absorbed_by_platform_minor BETWEEN 0 AND stripe_fee_minor),
  CHECK (refund_amount_minor BETWEEN 0 AND gross_amount_minor),
  CHECK (currency = LOWER(currency) AND char_length(currency) = 3),
  CHECK (state IN (
    'planned', 'submitting', 'reconciling', 'succeeded',
    'failed_confirmed', 'manual_review'
  )),
  CHECK (actor_type IN ('system', 'learner', 'instructor', 'admin')),
  CHECK ((actor_type = 'admin' AND actor_admin_id IS NOT NULL)
      OR (actor_type <> 'admin' AND actor_admin_id IS NULL)),
  CHECK (intent_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (
    refund_policy <> 'learner_early'
    OR (
      refund_amount_minor = gross_amount_minor - stripe_fee_minor
      AND fee_absorbed_by_platform_minor = 0
    )
  ),
  CHECK (
    refund_policy <> 'instructor_non_delivery'
    OR (
      refund_amount_minor = gross_amount_minor
      AND fee_absorbed_by_platform_minor = stripe_fee_minor
    )
  ),
  CHECK (state <> 'succeeded' OR (
    stripe_refund_id IS NOT NULL AND refund_event_id IS NOT NULL
  ))
);

CREATE INDEX IF NOT EXISTS idx_refund_intents_booking
  ON refund_intents(school_id, booking_id, state);
CREATE INDEX IF NOT EXISTS idx_refund_intents_contract
  ON refund_intents(school_id, payment_contract_id, state);
CREATE UNIQUE INDEX IF NOT EXISTS uq_refund_intents_stripe_refund
  ON refund_intents(stripe_refund_id)
  WHERE stripe_refund_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS refund_attempts (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  refund_intent_id UUID NOT NULL,
  attempt_number INTEGER NOT NULL,
  request_fingerprint TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  stripe_request_id TEXT,
  response_classification TEXT NOT NULL,
  sanitized_error_code TEXT,
  observed_stripe_refund_id TEXT,
  observed_refund_status TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (id, school_id),
  UNIQUE (school_id, refund_intent_id, attempt_number),
  UNIQUE (school_id, request_fingerprint),
  FOREIGN KEY (refund_intent_id, school_id)
    REFERENCES refund_intents(id, school_id),
  CHECK (attempt_number > 0),
  CHECK (request_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (response_classification IN (
    'success', 'definite_failure', 'ambiguous'
  )),
  CHECK (completed_at IS NULL OR completed_at >= started_at)
);

CREATE INDEX IF NOT EXISTS idx_refund_attempts_intent
  ON refund_attempts(school_id, refund_intent_id, attempt_number);

CREATE TABLE IF NOT EXISTS connect_account_state_events (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  instructor_id INTEGER NOT NULL,
  connect_scope_id BIGINT NOT NULL,
  stripe_account_id TEXT NOT NULL,
  stripe_event_id TEXT,
  event_type TEXT NOT NULL,
  event_context TEXT NOT NULL,
  requirements_summary JSONB NOT NULL,
  transfers_capability_status TEXT NOT NULL,
  dashboard_type TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  payload_fingerprint TEXT NOT NULL,
  evidence_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (id, school_id),
  UNIQUE (school_id, payload_fingerprint),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  FOREIGN KEY (connect_scope_id, school_id)
    REFERENCES payout_v2_connected_account_scopes(id, school_id),
  CHECK (stripe_account_id LIKE 'acct\_%' ESCAPE '\'),
  CHECK (NULLIF(BTRIM(event_type), '') IS NOT NULL),
  CHECK (NULLIF(BTRIM(event_context), '') IS NOT NULL),
  CHECK (jsonb_typeof(requirements_summary) = 'object'),
  CHECK (transfers_capability_status IN (
    'inactive', 'pending', 'active', 'restricted', 'unknown'
  )),
  CHECK (dashboard_type IN ('express', 'full', 'none', 'unknown')),
  CHECK (payload_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (jsonb_typeof(evidence_json) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_connect_state_events_stripe_event
  ON connect_account_state_events(stripe_event_id)
  WHERE stripe_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_connect_state_events_latest
  ON connect_account_state_events(school_id, instructor_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_connect_state_events_scope
  ON connect_account_state_events(school_id, connect_scope_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS payout_runs (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  accounting_version TEXT NOT NULL,
  scheduled_occurrence_id UUID,
  lock_at TIMESTAMPTZ NOT NULL,
  transfer_at TIMESTAMPTZ NOT NULL,
  service_window_start TIMESTAMPTZ NOT NULL,
  service_window_end TIMESTAMPTZ NOT NULL,
  state TEXT NOT NULL,
  first_live BOOLEAN NOT NULL,
  approval_admin_id INTEGER,
  approved_at TIMESTAMPTZ,
  approval_evidence_reference TEXT,
  planner_version TEXT NOT NULL,
  planner_fingerprint TEXT NOT NULL,
  gross_minor BIGINT NOT NULL,
  stripe_fee_minor BIGINT NOT NULL,
  net_minor BIGINT NOT NULL,
  instructor_share_minor BIGINT NOT NULL,
  platform_share_minor BIGINT NOT NULL,
  obligation_applied_minor BIGINT NOT NULL,
  transfer_minor BIGINT NOT NULL,
  held_minor BIGINT NOT NULL,
  currency TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  locked_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  reconciled_at TIMESTAMPTZ,
  last_error_code TEXT,
  UNIQUE (id, school_id),
  UNIQUE (school_id, accounting_version, lock_at),
  UNIQUE (school_id, planner_fingerprint),
  FOREIGN KEY (approval_admin_id, school_id)
    REFERENCES admin_users(id, school_id),
  CHECK (accounting_version = 'simon_launch_v1'),
  CHECK (transfer_at > lock_at),
  CHECK (service_window_end > service_window_start),
  CHECK (state IN (
    'planned', 'shadowed', 'approval_pending', 'locked', 'transferring',
    'transferred', 'reconciling', 'failed_confirmed', 'paused'
  )),
  CHECK (planner_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (gross_minor >= 0 AND stripe_fee_minor >= 0 AND net_minor >= 0),
  CHECK (instructor_share_minor >= 0 AND platform_share_minor >= 0),
  CHECK (obligation_applied_minor >= 0 AND transfer_minor >= 0 AND held_minor >= 0),
  CHECK (gross_minor = stripe_fee_minor + net_minor),
  CHECK (net_minor = instructor_share_minor + platform_share_minor),
  CHECK (instructor_share_minor = obligation_applied_minor + transfer_minor + held_minor),
  CHECK (currency = LOWER(currency) AND char_length(currency) = 3),
  CHECK (
    NOT first_live
    OR state IN ('planned', 'shadowed', 'approval_pending', 'paused')
    OR (approval_admin_id IS NOT NULL AND approved_at IS NOT NULL
      AND NULLIF(BTRIM(approval_evidence_reference), '') IS NOT NULL)
  ),
  CHECK (state NOT IN (
    'locked', 'transferring', 'transferred', 'reconciling', 'failed_confirmed'
  ) OR locked_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_payout_runs_state
  ON payout_runs(school_id, state, lock_at);

CREATE TABLE IF NOT EXISTS instructor_payout_batches (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  payout_run_id UUID NOT NULL,
  instructor_id INTEGER NOT NULL,
  agreement_version_id UUID NOT NULL,
  connect_scope_id BIGINT,
  currency TEXT NOT NULL,
  gross_minor BIGINT NOT NULL,
  stripe_fee_minor BIGINT NOT NULL,
  net_minor BIGINT NOT NULL,
  instructor_share_minor BIGINT NOT NULL,
  platform_share_minor BIGINT NOT NULL,
  opening_obligation_minor BIGINT NOT NULL,
  new_obligation_minor BIGINT NOT NULL,
  applied_obligation_minor BIGINT NOT NULL,
  closing_obligation_minor BIGINT NOT NULL,
  transfer_planned_minor BIGINT NOT NULL,
  transfer_submitted_minor BIGINT NOT NULL,
  held_minor BIGINT NOT NULL,
  state TEXT NOT NULL,
  batch_fingerprint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  locked_at TIMESTAMPTZ NOT NULL,
  submitted_at TIMESTAMPTZ,
  reconciled_at TIMESTAMPTZ,
  last_error_code TEXT,
  UNIQUE (id, school_id),
  UNIQUE (school_id, payout_run_id, instructor_id),
  UNIQUE (school_id, batch_fingerprint),
  FOREIGN KEY (payout_run_id, school_id)
    REFERENCES payout_runs(id, school_id),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  FOREIGN KEY (agreement_version_id, school_id)
    REFERENCES instructor_payout_agreement_versions(id, school_id),
  FOREIGN KEY (connect_scope_id, school_id)
    REFERENCES payout_v2_connected_account_scopes(id, school_id),
  CHECK (currency = LOWER(currency) AND char_length(currency) = 3),
  CHECK (gross_minor >= 0 AND stripe_fee_minor >= 0 AND net_minor >= 0),
  CHECK (instructor_share_minor >= 0 AND platform_share_minor >= 0),
  CHECK (opening_obligation_minor >= 0 AND new_obligation_minor >= 0),
  CHECK (applied_obligation_minor >= 0 AND closing_obligation_minor >= 0),
  CHECK (transfer_planned_minor >= 0 AND transfer_submitted_minor >= 0),
  CHECK (held_minor >= 0),
  CHECK (gross_minor = stripe_fee_minor + net_minor),
  CHECK (net_minor = instructor_share_minor + platform_share_minor),
  CHECK (opening_obligation_minor + new_obligation_minor
    = applied_obligation_minor + closing_obligation_minor),
  CHECK (instructor_share_minor
    = applied_obligation_minor + transfer_planned_minor + held_minor),
  CHECK (transfer_submitted_minor <= transfer_planned_minor),
  CHECK (state IN (
    'locked', 'transfer_pending', 'held_connect_not_ready', 'transferring',
    'transferred', 'reconciling', 'failed_confirmed', 'zero_value'
  )),
  CHECK (batch_fingerprint ~ '^sha256:[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_instructor_payout_batches_instructor
  ON instructor_payout_batches(school_id, instructor_id, locked_at DESC);
CREATE INDEX IF NOT EXISTS idx_instructor_payout_batches_run
  ON instructor_payout_batches(school_id, payout_run_id, state);

CREATE TABLE IF NOT EXISTS instructor_payout_obligations (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  instructor_id INTEGER NOT NULL,
  agreement_version_id UUID NOT NULL,
  obligation_type TEXT NOT NULL,
  type_rank INTEGER NOT NULL,
  incurred_at TIMESTAMPTZ NOT NULL,
  original_amount_minor BIGINT NOT NULL,
  currency TEXT NOT NULL,
  source_payout_run_id UUID,
  source_dispute_id UUID,
  source_payment_contract_id UUID,
  idempotency_identity TEXT NOT NULL,
  evidence_fingerprint TEXT NOT NULL,
  created_actor_type TEXT NOT NULL,
  created_admin_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (id, school_id),
  UNIQUE (school_id, idempotency_identity),
  UNIQUE (school_id, evidence_fingerprint),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  FOREIGN KEY (agreement_version_id, school_id)
    REFERENCES instructor_payout_agreement_versions(id, school_id),
  FOREIGN KEY (source_payout_run_id, school_id)
    REFERENCES payout_runs(id, school_id),
  FOREIGN KEY (source_payment_contract_id, school_id)
    REFERENCES lesson_payment_contracts(id, school_id),
  FOREIGN KEY (created_admin_id, school_id)
    REFERENCES admin_users(id, school_id),
  CHECK (obligation_type IN ('weekly_franchise_fee', 'final_dispute_loss')),
  CHECK ((obligation_type = 'final_dispute_loss' AND type_rank = 1)
      OR (obligation_type = 'weekly_franchise_fee' AND type_rank = 2)),
  CHECK (original_amount_minor > 0),
  CHECK (currency = LOWER(currency) AND char_length(currency) = 3),
  CHECK ((obligation_type = 'weekly_franchise_fee'
      AND source_payout_run_id IS NOT NULL
      AND source_dispute_id IS NULL
      AND source_payment_contract_id IS NULL)
    OR (obligation_type = 'final_dispute_loss'
      AND source_payout_run_id IS NULL
      AND source_dispute_id IS NOT NULL
      AND source_payment_contract_id IS NOT NULL)),
  CHECK (evidence_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (created_actor_type IN ('system', 'admin')),
  CHECK ((created_actor_type = 'admin' AND created_admin_id IS NOT NULL)
      OR (created_actor_type = 'system' AND created_admin_id IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_instructor_obligation_weekly_source
  ON instructor_payout_obligations(school_id, instructor_id, source_payout_run_id)
  WHERE obligation_type = 'weekly_franchise_fee';
CREATE UNIQUE INDEX IF NOT EXISTS uq_instructor_obligation_dispute_source
  ON instructor_payout_obligations(school_id, source_dispute_id)
  WHERE obligation_type = 'final_dispute_loss';
CREATE INDEX IF NOT EXISTS idx_instructor_obligations_order
  ON instructor_payout_obligations(school_id, instructor_id, incurred_at, type_rank, id);

CREATE TABLE IF NOT EXISTS instructor_payout_obligation_applications (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  obligation_id UUID NOT NULL,
  instructor_id INTEGER NOT NULL,
  application_type TEXT NOT NULL,
  amount_minor BIGINT NOT NULL,
  source_batch_id UUID,
  source_payment_contract_id UUID,
  reverses_application_id UUID,
  external_reference TEXT,
  actor_type TEXT NOT NULL,
  actor_admin_id INTEGER,
  reason TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  idempotency_identity TEXT NOT NULL,
  application_fingerprint TEXT NOT NULL,
  UNIQUE (id, school_id),
  UNIQUE (school_id, idempotency_identity),
  UNIQUE (school_id, application_fingerprint),
  FOREIGN KEY (obligation_id, school_id)
    REFERENCES instructor_payout_obligations(id, school_id),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  FOREIGN KEY (source_batch_id, school_id)
    REFERENCES instructor_payout_batches(id, school_id),
  FOREIGN KEY (source_payment_contract_id, school_id)
    REFERENCES lesson_payment_contracts(id, school_id),
  FOREIGN KEY (reverses_application_id, school_id)
    REFERENCES instructor_payout_obligation_applications(id, school_id),
  FOREIGN KEY (actor_admin_id, school_id)
    REFERENCES admin_users(id, school_id),
  CHECK (application_type IN (
    'batch_earnings', 'manual_repayment', 'manual_clearance',
    'write_off', 'reversal'
  )),
  CHECK (amount_minor > 0),
  CHECK ((application_type = 'batch_earnings' AND source_batch_id IS NOT NULL)
      OR application_type <> 'batch_earnings'),
  CHECK ((application_type = 'reversal' AND reverses_application_id IS NOT NULL)
      OR (application_type <> 'reversal' AND reverses_application_id IS NULL)),
  CHECK (actor_type IN ('system', 'admin')),
  CHECK ((actor_type = 'admin' AND actor_admin_id IS NOT NULL)
      OR (actor_type = 'system' AND actor_admin_id IS NULL)),
  CHECK (NULLIF(BTRIM(reason), '') IS NOT NULL),
  CHECK (application_fingerprint ~ '^sha256:[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_obligation_applications_obligation
  ON instructor_payout_obligation_applications(school_id, obligation_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_obligation_applications_batch
  ON instructor_payout_obligation_applications(school_id, source_batch_id)
  WHERE source_batch_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS stripe_launch_booking_earnings (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  payout_run_id UUID NOT NULL,
  payout_batch_id UUID NOT NULL,
  payment_contract_id UUID NOT NULL,
  outcome_revision_id UUID NOT NULL,
  instructor_id INTEGER NOT NULL,
  service_date DATE NOT NULL,
  gross_minor BIGINT NOT NULL,
  stripe_fee_minor BIGINT NOT NULL,
  net_minor BIGINT NOT NULL,
  split_bps INTEGER NOT NULL,
  instructor_share_minor BIGINT NOT NULL,
  platform_share_minor BIGINT NOT NULL,
  currency TEXT NOT NULL,
  accounting_version TEXT NOT NULL,
  earning_fingerprint TEXT NOT NULL,
  locked_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (id, school_id),
  UNIQUE (school_id, payment_contract_id),
  UNIQUE (school_id, outcome_revision_id),
  UNIQUE (school_id, earning_fingerprint),
  FOREIGN KEY (payout_run_id, school_id)
    REFERENCES payout_runs(id, school_id),
  FOREIGN KEY (payout_batch_id, school_id)
    REFERENCES instructor_payout_batches(id, school_id),
  FOREIGN KEY (payment_contract_id, school_id)
    REFERENCES lesson_payment_contracts(id, school_id),
  FOREIGN KEY (outcome_revision_id, school_id)
    REFERENCES lesson_outcome_revisions(id, school_id),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  CHECK (gross_minor > 0),
  CHECK (stripe_fee_minor BETWEEN 0 AND gross_minor),
  CHECK (net_minor >= 0),
  CHECK (split_bps BETWEEN 0 AND 10000),
  CHECK (instructor_share_minor >= 0 AND platform_share_minor >= 0),
  CHECK (gross_minor = stripe_fee_minor + net_minor),
  CHECK (net_minor = instructor_share_minor + platform_share_minor),
  CHECK (currency = LOWER(currency) AND char_length(currency) = 3),
  CHECK (accounting_version = 'simon_launch_v1'),
  CHECK (earning_fingerprint ~ '^sha256:[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_stripe_launch_earnings_batch
  ON stripe_launch_booking_earnings(school_id, payout_batch_id, service_date);
CREATE INDEX IF NOT EXISTS idx_stripe_launch_earnings_instructor
  ON stripe_launch_booking_earnings(school_id, instructor_id, locked_at);

CREATE TABLE IF NOT EXISTS stripe_launch_transfer_intents (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  payout_batch_id UUID NOT NULL,
  instructor_id INTEGER NOT NULL,
  connect_scope_id BIGINT NOT NULL,
  source_payment_contract_id UUID NOT NULL,
  stripe_source_charge_id TEXT NOT NULL,
  stripe_destination_account_id TEXT NOT NULL,
  amount_minor BIGINT NOT NULL,
  currency TEXT NOT NULL,
  stable_identity TEXT NOT NULL,
  stripe_idempotency_key TEXT NOT NULL,
  plan_fingerprint TEXT NOT NULL,
  state TEXT NOT NULL,
  stripe_transfer_id TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  submitted_at TIMESTAMPTZ,
  reconciled_at TIMESTAMPTZ,
  last_error_code TEXT,
  UNIQUE (id, school_id),
  UNIQUE (school_id, stable_identity),
  UNIQUE (stripe_idempotency_key),
  UNIQUE (school_id, plan_fingerprint),
  FOREIGN KEY (payout_batch_id, school_id)
    REFERENCES instructor_payout_batches(id, school_id),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  FOREIGN KEY (connect_scope_id, school_id)
    REFERENCES payout_v2_connected_account_scopes(id, school_id),
  FOREIGN KEY (source_payment_contract_id, school_id)
    REFERENCES lesson_payment_contracts(id, school_id),
  CHECK (stripe_source_charge_id LIKE 'ch\_%' ESCAPE '\'),
  CHECK (stripe_destination_account_id LIKE 'acct\_%' ESCAPE '\'),
  CHECK (amount_minor > 0),
  CHECK (currency = LOWER(currency) AND char_length(currency) = 3),
  CHECK (plan_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (state IN (
    'planned', 'submitting', 'reconciling', 'transferred',
    'failed_confirmed', 'blocked'
  )),
  CHECK (state <> 'transferred' OR stripe_transfer_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_stripe_launch_transfer_id
  ON stripe_launch_transfer_intents(stripe_transfer_id)
  WHERE stripe_transfer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stripe_launch_transfers_batch
  ON stripe_launch_transfer_intents(school_id, payout_batch_id, state);
CREATE INDEX IF NOT EXISTS idx_stripe_launch_transfers_contract
  ON stripe_launch_transfer_intents(school_id, source_payment_contract_id);

CREATE TABLE IF NOT EXISTS stripe_launch_transfer_attempts (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  transfer_intent_id UUID NOT NULL,
  attempt_number INTEGER NOT NULL,
  attempt_kind TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  response_classification TEXT NOT NULL,
  stripe_request_id TEXT,
  observed_transfer_id TEXT,
  sanitized_error_code TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (id, school_id),
  UNIQUE (school_id, transfer_intent_id, attempt_number),
  UNIQUE (school_id, request_fingerprint),
  FOREIGN KEY (transfer_intent_id, school_id)
    REFERENCES stripe_launch_transfer_intents(id, school_id),
  CHECK (attempt_number > 0),
  CHECK (attempt_kind IN ('submission', 'reconciliation')),
  CHECK (request_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (response_classification IN (
    'success', 'definite_failure', 'ambiguous', 'found',
    'not_found_safe_retry', 'operator_review'
  ))
);

CREATE INDEX IF NOT EXISTS idx_stripe_launch_transfer_attempts_intent
  ON stripe_launch_transfer_attempts(school_id, transfer_intent_id, attempt_number);

CREATE TABLE IF NOT EXISTS payout_batch_earning_dispositions (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  payout_batch_id UUID NOT NULL,
  booking_earning_id UUID NOT NULL,
  disposition_type TEXT NOT NULL,
  amount_minor BIGINT NOT NULL,
  obligation_application_id UUID,
  transfer_intent_id UUID,
  disposition_fingerprint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (id, school_id),
  UNIQUE (school_id, disposition_fingerprint),
  FOREIGN KEY (payout_batch_id, school_id)
    REFERENCES instructor_payout_batches(id, school_id),
  FOREIGN KEY (booking_earning_id, school_id)
    REFERENCES stripe_launch_booking_earnings(id, school_id),
  FOREIGN KEY (obligation_application_id, school_id)
    REFERENCES instructor_payout_obligation_applications(id, school_id),
  FOREIGN KEY (transfer_intent_id, school_id)
    REFERENCES stripe_launch_transfer_intents(id, school_id),
  CHECK (disposition_type IN (
    'obligation_application', 'transfer_allocation', 'held_connect_not_ready'
  )),
  CHECK (amount_minor > 0),
  CHECK ((disposition_type = 'obligation_application'
      AND obligation_application_id IS NOT NULL AND transfer_intent_id IS NULL)
    OR (disposition_type = 'transfer_allocation'
      AND obligation_application_id IS NULL AND transfer_intent_id IS NOT NULL)
    OR (disposition_type = 'held_connect_not_ready'
      AND obligation_application_id IS NULL AND transfer_intent_id IS NULL)),
  CHECK (disposition_fingerprint ~ '^sha256:[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_payout_dispositions_earning
  ON payout_batch_earning_dispositions(school_id, booking_earning_id);
CREATE INDEX IF NOT EXISTS idx_payout_dispositions_batch
  ON payout_batch_earning_dispositions(school_id, payout_batch_id, disposition_type);
CREATE INDEX IF NOT EXISTS idx_payout_dispositions_transfer
  ON payout_batch_earning_dispositions(school_id, transfer_intent_id)
  WHERE transfer_intent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS payout_statements (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  payout_batch_id UUID NOT NULL,
  instructor_id INTEGER NOT NULL,
  statement_number TEXT NOT NULL,
  display_period_start TIMESTAMPTZ NOT NULL,
  display_period_end TIMESTAMPTZ NOT NULL,
  currency TEXT NOT NULL,
  canonical_statement_json JSONB NOT NULL,
  statement_fingerprint TEXT NOT NULL,
  transfer_status_wording TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL,
  durable_storage_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (id, school_id),
  UNIQUE (school_id, payout_batch_id),
  UNIQUE (school_id, statement_number),
  UNIQUE (school_id, statement_fingerprint),
  FOREIGN KEY (payout_batch_id, school_id)
    REFERENCES instructor_payout_batches(id, school_id),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  CHECK (display_period_end > display_period_start),
  CHECK (currency = LOWER(currency) AND char_length(currency) = 3),
  CHECK (jsonb_typeof(canonical_statement_json) = 'object'),
  CHECK (statement_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (transfer_status_wording IN (
    'locked', 'transfer_scheduled', 'transferred_to_stripe',
    'held_connect_not_ready', 'reconciling', 'failed_under_review', 'zero_value'
  ))
);

CREATE INDEX IF NOT EXISTS idx_payout_statements_instructor
  ON payout_statements(school_id, instructor_id, generated_at DESC);

CREATE TABLE IF NOT EXISTS payout_statement_delivery_attempts (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  payout_statement_id UUID NOT NULL,
  attempt_number INTEGER NOT NULL,
  recipient_identity TEXT NOT NULL,
  channel TEXT NOT NULL,
  template_version TEXT NOT NULL,
  statement_fingerprint TEXT NOT NULL,
  provider_message_id TEXT,
  outcome TEXT NOT NULL,
  error_code TEXT,
  attempted_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  delivery_fingerprint TEXT NOT NULL,
  UNIQUE (id, school_id),
  UNIQUE (school_id, payout_statement_id, attempt_number),
  UNIQUE (school_id, delivery_fingerprint),
  FOREIGN KEY (payout_statement_id, school_id)
    REFERENCES payout_statements(id, school_id),
  CHECK (attempt_number > 0),
  CHECK (channel IN ('email')),
  CHECK (statement_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (outcome IN ('pending', 'sent', 'failed', 'delivered')),
  CHECK (completed_at IS NULL OR completed_at >= attempted_at),
  CHECK (delivery_fingerprint ~ '^sha256:[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_statement_delivery_attempts_statement
  ON payout_statement_delivery_attempts(school_id, payout_statement_id, attempt_number);

CREATE TABLE IF NOT EXISTS payment_disputes (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  payment_contract_id UUID NOT NULL,
  stripe_dispute_id TEXT NOT NULL,
  stripe_charge_id TEXT NOT NULL,
  stripe_payment_intent_id TEXT NOT NULL,
  current_state TEXT NOT NULL,
  disputed_amount_minor BIGINT NOT NULL,
  final_principal_lost_minor BIGINT,
  currency TEXT NOT NULL,
  reason TEXT,
  response_deadline TIMESTAMPTZ,
  current_fingerprint TEXT NOT NULL,
  opened_at TIMESTAMPTZ NOT NULL,
  terminal_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (id, school_id),
  UNIQUE (stripe_dispute_id),
  UNIQUE (school_id, current_fingerprint),
  FOREIGN KEY (payment_contract_id, school_id)
    REFERENCES lesson_payment_contracts(id, school_id),
  CHECK (stripe_dispute_id LIKE 'dp\_%' ESCAPE '\'),
  CHECK (stripe_charge_id LIKE 'ch\_%' ESCAPE '\'),
  CHECK (disputed_amount_minor > 0),
  CHECK (final_principal_lost_minor IS NULL OR
    final_principal_lost_minor BETWEEN 0 AND disputed_amount_minor),
  CHECK (currency = LOWER(currency) AND char_length(currency) = 3),
  CHECK (current_state IN (
    'open', 'needs_response', 'under_review', 'won', 'lost', 'closed_manual'
  )),
  CHECK (current_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (current_state NOT IN ('won', 'lost', 'closed_manual') OR terminal_at IS NOT NULL),
  CHECK (current_state <> 'lost' OR final_principal_lost_minor IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_payment_disputes_contract
  ON payment_disputes(school_id, payment_contract_id, current_state);
CREATE INDEX IF NOT EXISTS idx_payment_disputes_deadline
  ON payment_disputes(school_id, response_deadline)
  WHERE current_state IN ('open', 'needs_response', 'under_review');

CREATE TABLE IF NOT EXISTS payment_dispute_events (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  payment_dispute_id UUID NOT NULL,
  stripe_event_id TEXT NOT NULL,
  stripe_event_type TEXT NOT NULL,
  stripe_created_at TIMESTAMPTZ NOT NULL,
  observed_state TEXT NOT NULL,
  evidence_fingerprint TEXT NOT NULL,
  evidence_json JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  UNIQUE (id, school_id),
  UNIQUE (stripe_event_id),
  UNIQUE (school_id, evidence_fingerprint),
  FOREIGN KEY (payment_dispute_id, school_id)
    REFERENCES payment_disputes(id, school_id),
  CHECK (observed_state IN (
    'open', 'needs_response', 'under_review', 'won', 'lost', 'closed_manual'
  )),
  CHECK (evidence_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (jsonb_typeof(evidence_json) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_payment_dispute_events_dispute
  ON payment_dispute_events(school_id, payment_dispute_id, stripe_created_at);

CREATE TABLE IF NOT EXISTS dispute_evidence_pack_versions (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  payment_dispute_id UUID NOT NULL,
  version_number INTEGER NOT NULL,
  included_record_ids JSONB NOT NULL,
  document_hashes JSONB NOT NULL,
  evidence_snapshot JSONB NOT NULL,
  created_by_admin_id INTEGER NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL,
  external_submission_reference TEXT,
  external_submission_status TEXT NOT NULL,
  pack_fingerprint TEXT NOT NULL,
  UNIQUE (id, school_id),
  UNIQUE (school_id, payment_dispute_id, version_number),
  UNIQUE (school_id, pack_fingerprint),
  FOREIGN KEY (payment_dispute_id, school_id)
    REFERENCES payment_disputes(id, school_id),
  FOREIGN KEY (created_by_admin_id, school_id)
    REFERENCES admin_users(id, school_id),
  CHECK (version_number > 0),
  CHECK (jsonb_typeof(included_record_ids) = 'object'),
  CHECK (jsonb_typeof(document_hashes) = 'object'),
  CHECK (jsonb_typeof(evidence_snapshot) = 'object'),
  CHECK (external_submission_status IN (
    'not_submitted', 'submitted_manually', 'accepted', 'rejected'
  )),
  CHECK (pack_fingerprint ~ '^sha256:[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_dispute_evidence_versions_dispute
  ON dispute_evidence_pack_versions(school_id, payment_dispute_id, version_number);

CREATE TABLE IF NOT EXISTS dispute_notification_attempts (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  payment_dispute_id UUID NOT NULL,
  logical_notice_identity TEXT NOT NULL,
  notice_type TEXT NOT NULL,
  channel TEXT NOT NULL,
  recipient_identity TEXT NOT NULL,
  outcome TEXT NOT NULL,
  provider_message_id TEXT,
  error_code TEXT,
  attempted_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  notification_fingerprint TEXT NOT NULL,
  UNIQUE (id, school_id),
  UNIQUE (school_id, logical_notice_identity),
  UNIQUE (school_id, notification_fingerprint),
  FOREIGN KEY (payment_dispute_id, school_id)
    REFERENCES payment_disputes(id, school_id),
  CHECK (notice_type IN (
    'opened', 'updated', 'deadline_three_days', 'deadline_twenty_four_hours',
    'won', 'lost'
  )),
  CHECK (channel = 'email'),
  CHECK (outcome IN ('pending', 'sent', 'failed', 'delivered')),
  CHECK (completed_at IS NULL OR completed_at >= attempted_at),
  CHECK (notification_fingerprint ~ '^sha256:[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_dispute_notifications_dispute
  ON dispute_notification_attempts(school_id, payment_dispute_id, attempted_at);

CREATE TABLE IF NOT EXISTS financial_job_occurrences (
  id UUID PRIMARY KEY,
  school_id INTEGER REFERENCES schools(id),
  scope_kind TEXT NOT NULL,
  job_kind TEXT NOT NULL,
  scheduled_local_label TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  scheduled_at_utc TIMESTAMPTZ NOT NULL,
  state TEXT NOT NULL,
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  result_fingerprint TEXT,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (id, school_id),
  CHECK ((scope_kind = 'global' AND school_id IS NULL)
      OR (scope_kind = 'school' AND school_id IS NOT NULL)),
  CHECK (job_kind IN (
    'outcome_digest', 'weekly_lock', 'weekly_transfer', 'refund_reconcile',
    'transfer_reconcile', 'dispute_deadline_reminder'
  )),
  CHECK (time_zone = 'Europe/London'),
  CHECK (state IN (
    'pending', 'leased', 'running', 'completed', 'failed_retryable',
    'failed_confirmed', 'missed_manual_review'
  )),
  CHECK (attempt_count >= 0),
  CHECK ((state IN ('leased', 'running')
      AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (state NOT IN ('leased', 'running'))),
  CHECK (result_fingerprint IS NULL OR result_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (completed_at IS NULL OR started_at IS NULL OR completed_at >= started_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_job_occurrence_global
  ON financial_job_occurrences(job_kind, scheduled_at_utc)
  WHERE scope_kind = 'global';
CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_job_occurrence_school
  ON financial_job_occurrences(school_id, job_kind, scheduled_at_utc)
  WHERE scope_kind = 'school';
CREATE INDEX IF NOT EXISTS idx_financial_job_occurrences_due
  ON financial_job_occurrences(state, scheduled_at_utc);

-- Complete the issue/run and dispute/obligation tenant-safe links after both
-- sides exist.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'lesson_issue_reports_run_school_fk'
      AND conrelid = 'lesson_issue_reports'::regclass
  ) THEN
    ALTER TABLE lesson_issue_reports
      ADD CONSTRAINT lesson_issue_reports_run_school_fk
      FOREIGN KEY (applicable_run_id, school_id)
      REFERENCES payout_runs(id, school_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'instructor_obligations_dispute_school_fk'
      AND conrelid = 'instructor_payout_obligations'::regclass
  ) THEN
    ALTER TABLE instructor_payout_obligations
      ADD CONSTRAINT instructor_obligations_dispute_school_fk
      FOREIGN KEY (source_dispute_id, school_id)
      REFERENCES payment_disputes(id, school_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'refund_intents_source_batch_school_fk'
      AND conrelid = 'refund_intents'::regclass
  ) THEN
    ALTER TABLE refund_intents
      ADD CONSTRAINT refund_intents_source_batch_school_fk
      FOREIGN KEY (source_batch_id, school_id)
      REFERENCES instructor_payout_batches(id, school_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'refund_intents_source_earning_school_fk'
      AND conrelid = 'refund_intents'::regclass
  ) THEN
    ALTER TABLE refund_intents
      ADD CONSTRAINT refund_intents_source_earning_school_fk
      FOREIGN KEY (source_earning_id, school_id)
      REFERENCES stripe_launch_booking_earnings(id, school_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payout_runs_occurrence_fk'
      AND conrelid = 'payout_runs'::regclass
  ) THEN
    ALTER TABLE payout_runs
      ADD CONSTRAINT payout_runs_occurrence_fk
      FOREIGN KEY (scheduled_occurrence_id, school_id)
      REFERENCES financial_job_occurrences(id, school_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_refund_intents_source_batch
  ON refund_intents(school_id, source_batch_id) WHERE source_batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_refund_intents_source_earning
  ON refund_intents(school_id, source_earning_id) WHERE source_earning_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_instructor_obligations_dispute
  ON instructor_payout_obligations(school_id, source_dispute_id)
  WHERE source_dispute_id IS NOT NULL;

-- Shared append-only and immutable-fact guards.
CREATE OR REPLACE FUNCTION stripe_launch_reject_change()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is forbidden', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION stripe_launch_reject_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% preserves launch financial history: DELETE is forbidden', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION stripe_launch_guard_operational_update()
RETURNS TRIGGER AS $$
DECLARE
  old_facts JSONB := to_jsonb(OLD);
  new_facts JSONB := to_jsonb(NEW);
  allowed_column TEXT;
BEGIN
  FOREACH allowed_column IN ARRAY TG_ARGV LOOP
    old_facts := old_facts - allowed_column;
    new_facts := new_facts - allowed_column;
  END LOOP;
  IF old_facts <> new_facts THEN
    RAISE EXCEPTION '% immutable identity, scope, or financial facts changed', TG_TABLE_NAME
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION stripe_launch_guard_config_update()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.school_id <> NEW.school_id
    OR OLD.cutover_at <> NEW.cutover_at
    OR OLD.accounting_version <> NEW.accounting_version
    OR OLD.created_by_admin_id <> NEW.created_by_admin_id
    OR OLD.created_at <> NEW.created_at
  THEN
    RAISE EXCEPTION 'launch configuration identity and cutover are immutable'
      USING ERRCODE = '55000';
  END IF;
  IF NOT (
    (OLD.mode = NEW.mode)
    OR (OLD.mode = 'disabled' AND NEW.mode IN ('shadow', 'approval_pending'))
    OR (OLD.mode = 'shadow' AND NEW.mode IN ('approval_pending', 'paused'))
    OR (OLD.mode = 'approval_pending' AND NEW.mode IN ('live', 'paused'))
    OR (OLD.mode = 'live' AND NEW.mode = 'paused')
    OR (OLD.mode = 'paused' AND NEW.mode IN ('live', 'approval_pending'))
  ) THEN
    RAISE EXCEPTION 'invalid launch mode transition % -> %', OLD.mode, NEW.mode
      USING ERRCODE = '23514';
  END IF;
  IF OLD.mode = 'live' AND NEW.mode = 'shadow' THEN
    RAISE EXCEPTION 'live launch classification cannot return to shadow'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION stripe_launch_guard_agreement_write()
RETURNS TRIGGER AS $$
DECLARE
  overlap_exists BOOLEAN;
BEGIN
  PERFORM pg_advisory_xact_lock(NEW.school_id, NEW.instructor_id);
  SELECT EXISTS (
    SELECT 1
    FROM instructor_payout_agreement_versions other
    WHERE other.school_id = NEW.school_id
      AND other.instructor_id = NEW.instructor_id
      AND other.id <> NEW.id
      AND other.status IN ('active', 'paused')
      AND NEW.status IN ('active', 'paused')
      AND tstzrange(other.starts_at, other.ends_at, '[)')
        && tstzrange(NEW.starts_at, NEW.ends_at, '[)')
  ) INTO overlap_exists;
  IF overlap_exists THEN
    RAISE EXCEPTION 'payout agreement effective ranges overlap'
      USING ERRCODE = '23P01';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status <> 'draft' THEN
      IF to_jsonb(OLD) - ARRAY['status', 'ends_at']::text[]
        <> to_jsonb(NEW) - ARRAY['status', 'ends_at']::text[]
      THEN
        RAISE EXCEPTION 'activated payout agreement facts are immutable'
          USING ERRCODE = '55000';
      END IF;
      IF NOT ((OLD.status = NEW.status)
        OR (OLD.status = 'active' AND NEW.status IN ('paused', 'ended'))
        OR (OLD.status = 'paused' AND NEW.status IN ('active', 'ended')))
      THEN
        RAISE EXCEPTION 'invalid payout agreement state transition'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION stripe_launch_guard_contract_update()
RETURNS TRIGGER AS $$
DECLARE
  immutable_columns TEXT[] := ARRAY[
    'id', 'school_id', 'learner_id', 'instructor_id', 'funding_source_id',
    'origin', 'regime', 'stripe_payment_created_at', 'gross_amount_minor',
    'currency', 'stripe_payment_intent_id', 'stripe_charge_id', 'created_at',
    'fingerprint'
  ];
  column_name TEXT;
BEGIN
  IF OLD.evidence_status <> 'pending' THEN
    RAISE EXCEPTION 'completed/terminal lesson payment contract is immutable'
      USING ERRCODE = '55000';
  END IF;
  FOREACH column_name IN ARRAY immutable_columns LOOP
    IF to_jsonb(OLD)->column_name IS DISTINCT FROM to_jsonb(NEW)->column_name THEN
      RAISE EXCEPTION 'lesson payment contract identity changed: %', column_name
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
  IF (OLD.stripe_fee_minor IS NOT NULL AND OLD.stripe_fee_minor IS DISTINCT FROM NEW.stripe_fee_minor)
    OR (OLD.split_bps IS NOT NULL AND OLD.split_bps IS DISTINCT FROM NEW.split_bps)
    OR (OLD.agreement_version_id IS NOT NULL AND OLD.agreement_version_id IS DISTINCT FROM NEW.agreement_version_id)
    OR (OLD.stripe_balance_transaction_id IS NOT NULL AND OLD.stripe_balance_transaction_id IS DISTINCT FROM NEW.stripe_balance_transaction_id)
    OR (OLD.stripe_funds_available_at IS NOT NULL AND OLD.stripe_funds_available_at IS DISTINCT FROM NEW.stripe_funds_available_at)
  THEN
    RAISE EXCEPTION 'known lesson payment evidence cannot be replaced'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.evidence_status NOT IN ('pending', 'complete', 'contradictory', 'ineligible') THEN
    RAISE EXCEPTION 'invalid lesson payment evidence transition'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION stripe_launch_validate_contract_regime()
RETURNS TRIGGER AS $$
DECLARE
  config_row stripe_connect_launch_configs%ROWTYPE;
BEGIN
  SELECT * INTO config_row
  FROM stripe_connect_launch_configs
  WHERE school_id = NEW.school_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lesson payment contract requires explicit school launch configuration'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.regime <> (CASE
    WHEN NEW.stripe_payment_created_at >= config_row.cutover_at THEN 'launch'
    ELSE 'legacy'
  END) THEN
    RAISE EXCEPTION 'lesson payment regime does not match immutable Stripe creation time'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION stripe_launch_guard_payout_source_update()
RETURNS TRIGGER AS $$
DECLARE
  old_facts JSONB;
  new_facts JSONB;
  fill_column TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payout_funding_sources is append-only: DELETE is forbidden'
      USING ERRCODE = '55000';
  END IF;
  old_facts := to_jsonb(OLD) - ARRAY[
    'stripe_payment_created_at', 'stripe_funds_available_at', 'payment_origin',
    'source_booking_id', 'lesson_payment_contract_id', 'evidence_completeness',
    'contradiction_code'
  ]::text[];
  new_facts := to_jsonb(NEW) - ARRAY[
    'stripe_payment_created_at', 'stripe_funds_available_at', 'payment_origin',
    'source_booking_id', 'lesson_payment_contract_id', 'evidence_completeness',
    'contradiction_code'
  ]::text[];
  IF old_facts <> new_facts THEN
    RAISE EXCEPTION 'payout funding source historic facts are immutable'
      USING ERRCODE = '55000';
  END IF;
  FOREACH fill_column IN ARRAY ARRAY[
    'stripe_payment_created_at', 'stripe_funds_available_at', 'payment_origin',
    'source_booking_id', 'lesson_payment_contract_id'
  ] LOOP
    IF to_jsonb(OLD)->fill_column IS NOT NULL
      AND to_jsonb(OLD)->fill_column IS DISTINCT FROM to_jsonb(NEW)->fill_column
    THEN
      RAISE EXCEPTION 'known payout source launch evidence cannot be replaced: %', fill_column
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
  IF OLD.evidence_completeness IS NOT NULL
    AND OLD.evidence_completeness <> 'pending'
    AND OLD.evidence_completeness IS DISTINCT FROM NEW.evidence_completeness
  THEN
    RAISE EXCEPTION 'terminal payout source evidence classification is immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payout_funding_sources_append_only ON payout_funding_sources;
CREATE TRIGGER payout_funding_sources_append_only
  BEFORE UPDATE OR DELETE ON payout_funding_sources
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_guard_payout_source_update();

CREATE OR REPLACE FUNCTION stripe_launch_validate_outcome_insert()
RETURNS TRIGGER AS $$
DECLARE
  booking_row lesson_bookings%ROWTYPE;
  prior_row lesson_outcome_revisions%ROWTYPE;
  replacement_row lesson_bookings%ROWTYPE;
BEGIN
  SELECT * INTO booking_row
  FROM lesson_bookings
  WHERE id = NEW.booking_id AND school_id = NEW.school_id
  FOR UPDATE;
  IF NOT FOUND OR booking_row.instructor_id <> NEW.instructor_id
    OR NEW.actor_instructor_id <> NEW.instructor_id
    OR booking_row.lesson_payment_contract_id IS DISTINCT FROM NEW.lesson_payment_contract_id
  THEN
    RAISE EXCEPTION 'outcome does not match school-scoped booking ownership/contract'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.revision_number > 1 THEN
    SELECT * INTO prior_row
    FROM lesson_outcome_revisions
    WHERE id = NEW.supersedes_revision_id AND school_id = NEW.school_id;
    IF NOT FOUND OR prior_row.booking_id <> NEW.booking_id
      OR prior_row.revision_number <> NEW.revision_number - 1
    THEN
      RAISE EXCEPTION 'outcome revision chain is not contiguous'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.outcome IN ('delivered', 'late_learner_cancel_or_no_show')
    AND ((booking_row.scheduled_date + booking_row.end_time)
      AT TIME ZONE 'Europe/London') > NEW.occurred_at
  THEN
    RAISE EXCEPTION 'payable outcome cannot be recorded before lesson end'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.outcome = 'rescheduled' THEN
    SELECT * INTO replacement_row
    FROM lesson_bookings
    WHERE id = NEW.replacement_booking_id AND school_id = NEW.school_id;
    IF NOT FOUND OR replacement_row.id = booking_row.id
      OR replacement_row.instructor_id <> booking_row.instructor_id
      OR replacement_row.lesson_payment_contract_id IS DISTINCT FROM booking_row.lesson_payment_contract_id
    THEN
      RAISE EXCEPTION 'rescheduled outcome requires real same-instructor contract replacement'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  IF EXISTS (
    SELECT 1 FROM stripe_launch_booking_earnings e
    WHERE e.school_id = NEW.school_id
      AND e.payment_contract_id = NEW.lesson_payment_contract_id
  ) THEN
    RAISE EXCEPTION 'outcome cannot change after launch earning lock'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION stripe_launch_validate_refund_attempt()
RETURNS TRIGGER AS $$
DECLARE
  intent_row refund_intents%ROWTYPE;
BEGIN
  SELECT * INTO intent_row FROM refund_intents
  WHERE id = NEW.refund_intent_id AND school_id = NEW.school_id
  FOR UPDATE;
  IF NOT FOUND OR NEW.idempotency_key <> intent_row.stripe_idempotency_key THEN
    RAISE EXCEPTION 'refund attempt must reuse the intent idempotency key'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION stripe_launch_validate_transfer_attempt()
RETURNS TRIGGER AS $$
DECLARE
  intent_row stripe_launch_transfer_intents%ROWTYPE;
BEGIN
  SELECT * INTO intent_row FROM stripe_launch_transfer_intents
  WHERE id = NEW.transfer_intent_id AND school_id = NEW.school_id
  FOR UPDATE;
  IF NOT FOUND OR NEW.idempotency_key <> intent_row.stripe_idempotency_key THEN
    RAISE EXCEPTION 'transfer attempt must reuse the intent idempotency key'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION stripe_launch_validate_obligation_application()
RETURNS TRIGGER AS $$
DECLARE
  obligation_row instructor_payout_obligations%ROWTYPE;
  reversed_row instructor_payout_obligation_applications%ROWTYPE;
  reduced BIGINT;
  reversed BIGINT;
BEGIN
  SELECT * INTO obligation_row
  FROM instructor_payout_obligations
  WHERE id = NEW.obligation_id AND school_id = NEW.school_id
  FOR UPDATE;
  IF NOT FOUND OR obligation_row.instructor_id <> NEW.instructor_id THEN
    RAISE EXCEPTION 'obligation application scope/instructor mismatch'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.application_type = 'reversal' THEN
    SELECT * INTO reversed_row
    FROM instructor_payout_obligation_applications
    WHERE id = NEW.reverses_application_id AND school_id = NEW.school_id;
    IF NOT FOUND OR reversed_row.obligation_id <> NEW.obligation_id
      OR reversed_row.application_type = 'reversal'
      OR NEW.amount_minor > reversed_row.amount_minor
    THEN
      RAISE EXCEPTION 'obligation reversal is not bounded to a prior application'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  SELECT
    COALESCE(SUM(amount_minor) FILTER (WHERE application_type <> 'reversal'), 0),
    COALESCE(SUM(amount_minor) FILTER (WHERE application_type = 'reversal'), 0)
  INTO reduced, reversed
  FROM instructor_payout_obligation_applications
  WHERE obligation_id = NEW.obligation_id AND school_id = NEW.school_id;
  IF NEW.application_type = 'reversal' THEN reversed := reversed + NEW.amount_minor;
  ELSE reduced := reduced + NEW.amount_minor;
  END IF;
  IF reversed > reduced OR reduced - reversed > obligation_row.original_amount_minor THEN
    RAISE EXCEPTION 'obligation applications exceed immutable principal'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION stripe_launch_validate_obligation_insert()
RETURNS TRIGGER AS $$
DECLARE
  run_row payout_runs%ROWTYPE;
  agreement_row instructor_payout_agreement_versions%ROWTYPE;
  dispute_row payment_disputes%ROWTYPE;
  earning_row stripe_launch_booking_earnings%ROWTYPE;
  expected_loss BIGINT;
BEGIN
  IF NEW.obligation_type = 'weekly_franchise_fee' THEN
    SELECT * INTO run_row FROM payout_runs
    WHERE id = NEW.source_payout_run_id AND school_id = NEW.school_id;
    SELECT * INTO agreement_row FROM instructor_payout_agreement_versions
    WHERE id = NEW.agreement_version_id AND school_id = NEW.school_id;
    IF run_row.id IS NULL OR agreement_row.id IS NULL
      OR agreement_row.instructor_id <> NEW.instructor_id
      OR agreement_row.currency <> NEW.currency
      OR agreement_row.weekly_franchise_fee_minor <> NEW.original_amount_minor
      OR NOT (agreement_row.starts_at <= run_row.lock_at
        AND (agreement_row.ends_at IS NULL OR agreement_row.ends_at > run_row.lock_at))
    THEN
      RAISE EXCEPTION 'weekly obligation does not match the agreement active at lock'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT * INTO dispute_row FROM payment_disputes
    WHERE id = NEW.source_dispute_id AND school_id = NEW.school_id;
    SELECT * INTO earning_row FROM stripe_launch_booking_earnings
    WHERE payment_contract_id = NEW.source_payment_contract_id
      AND school_id = NEW.school_id;
    IF dispute_row.id IS NULL OR earning_row.id IS NULL
      OR dispute_row.current_state <> 'lost'
      OR dispute_row.payment_contract_id <> NEW.source_payment_contract_id
      OR earning_row.instructor_id <> NEW.instructor_id
      OR earning_row.currency <> NEW.currency
    THEN
      RAISE EXCEPTION 'final dispute obligation lacks matching terminal loss/earning evidence'
        USING ERRCODE = '23514';
    END IF;
    expected_loss := LEAST(
      earning_row.instructor_share_minor,
      (earning_row.instructor_share_minor * dispute_row.final_principal_lost_minor
        + earning_row.gross_minor / 2) / earning_row.gross_minor
    );
    IF NEW.original_amount_minor <> expected_loss THEN
      RAISE EXCEPTION 'final dispute obligation is not the bounded proportional instructor share'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION stripe_launch_validate_disposition_link()
RETURNS TRIGGER AS $$
DECLARE
  earning_row stripe_launch_booking_earnings%ROWTYPE;
  transfer_row stripe_launch_transfer_intents%ROWTYPE;
  application_row instructor_payout_obligation_applications%ROWTYPE;
BEGIN
  SELECT * INTO earning_row FROM stripe_launch_booking_earnings
  WHERE id = NEW.booking_earning_id AND school_id = NEW.school_id;
  IF NOT FOUND OR earning_row.payout_batch_id <> NEW.payout_batch_id THEN
    RAISE EXCEPTION 'earning disposition batch mismatch'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.transfer_intent_id IS NOT NULL THEN
    SELECT * INTO transfer_row FROM stripe_launch_transfer_intents
    WHERE id = NEW.transfer_intent_id AND school_id = NEW.school_id;
    IF NOT FOUND OR transfer_row.payout_batch_id <> NEW.payout_batch_id
      OR transfer_row.source_payment_contract_id <> earning_row.payment_contract_id
    THEN
      RAISE EXCEPTION 'transfer disposition source/batch mismatch'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.obligation_application_id IS NOT NULL THEN
    SELECT * INTO application_row FROM instructor_payout_obligation_applications
    WHERE id = NEW.obligation_application_id AND school_id = NEW.school_id;
    IF NOT FOUND OR application_row.source_batch_id <> NEW.payout_batch_id
      OR application_row.amount_minor <> NEW.amount_minor
    THEN
      RAISE EXCEPTION 'obligation disposition does not match its application'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION stripe_launch_validate_batch_insert()
RETURNS TRIGGER AS $$
DECLARE
  run_row payout_runs%ROWTYPE;
  agreement_row instructor_payout_agreement_versions%ROWTYPE;
  scope_row payout_v2_connected_account_scopes%ROWTYPE;
BEGIN
  SELECT * INTO run_row FROM payout_runs
  WHERE id = NEW.payout_run_id AND school_id = NEW.school_id;
  SELECT * INTO agreement_row FROM instructor_payout_agreement_versions
  WHERE id = NEW.agreement_version_id AND school_id = NEW.school_id;
  IF run_row.id IS NULL OR agreement_row.id IS NULL
    OR agreement_row.instructor_id <> NEW.instructor_id
    OR agreement_row.currency <> NEW.currency
    OR run_row.currency <> NEW.currency
    OR NEW.locked_at <> run_row.lock_at
    OR agreement_row.status NOT IN ('active', 'paused')
    OR agreement_row.starts_at > run_row.lock_at
    OR (agreement_row.ends_at IS NOT NULL AND agreement_row.ends_at <= run_row.lock_at)
  THEN
    RAISE EXCEPTION 'payout batch does not match its run/agreement snapshot'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.connect_scope_id IS NOT NULL THEN
    SELECT * INTO scope_row FROM payout_v2_connected_account_scopes
    WHERE id = NEW.connect_scope_id AND school_id = NEW.school_id;
    IF scope_row.id IS NULL OR scope_row.owner_type <> 'instructor'
      OR scope_row.instructor_id <> NEW.instructor_id
    THEN
      RAISE EXCEPTION 'payout batch Connect scope does not belong to instructor'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION stripe_launch_validate_earning_insert()
RETURNS TRIGGER AS $$
DECLARE
  run_row payout_runs%ROWTYPE;
  batch_row instructor_payout_batches%ROWTYPE;
  contract_row lesson_payment_contracts%ROWTYPE;
  outcome_row lesson_outcome_revisions%ROWTYPE;
  latest_revision INTEGER;
BEGIN
  SELECT * INTO run_row FROM payout_runs
  WHERE id = NEW.payout_run_id AND school_id = NEW.school_id;
  SELECT * INTO batch_row FROM instructor_payout_batches
  WHERE id = NEW.payout_batch_id AND school_id = NEW.school_id;
  SELECT * INTO contract_row FROM lesson_payment_contracts
  WHERE id = NEW.payment_contract_id AND school_id = NEW.school_id;
  SELECT * INTO outcome_row FROM lesson_outcome_revisions
  WHERE id = NEW.outcome_revision_id AND school_id = NEW.school_id;
  SELECT MAX(revision_number) INTO latest_revision FROM lesson_outcome_revisions
  WHERE school_id = NEW.school_id
    AND lesson_payment_contract_id = NEW.payment_contract_id;
  IF run_row.id IS NULL OR batch_row.id IS NULL OR contract_row.id IS NULL
    OR outcome_row.id IS NULL
    OR batch_row.payout_run_id <> NEW.payout_run_id
    OR batch_row.instructor_id <> NEW.instructor_id
    OR contract_row.instructor_id <> NEW.instructor_id
    OR outcome_row.instructor_id <> NEW.instructor_id
    OR outcome_row.lesson_payment_contract_id <> NEW.payment_contract_id
    OR outcome_row.revision_number <> latest_revision
    OR outcome_row.outcome NOT IN ('delivered', 'late_learner_cancel_or_no_show')
    OR outcome_row.occurred_at >= run_row.lock_at
    OR contract_row.evidence_status <> 'complete'
    OR contract_row.regime <> 'launch'
    OR contract_row.gross_amount_minor <> NEW.gross_minor
    OR contract_row.stripe_fee_minor <> NEW.stripe_fee_minor
    OR contract_row.split_bps <> NEW.split_bps
    OR contract_row.currency <> NEW.currency
    OR batch_row.currency <> NEW.currency
  THEN
    RAISE EXCEPTION 'launch earning lacks one exact eligible contract/outcome/batch'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION stripe_launch_validate_transfer_insert()
RETURNS TRIGGER AS $$
DECLARE
  batch_row instructor_payout_batches%ROWTYPE;
  contract_row lesson_payment_contracts%ROWTYPE;
  scope_row payout_v2_connected_account_scopes%ROWTYPE;
BEGIN
  SELECT * INTO batch_row FROM instructor_payout_batches
  WHERE id = NEW.payout_batch_id AND school_id = NEW.school_id;
  SELECT * INTO contract_row FROM lesson_payment_contracts
  WHERE id = NEW.source_payment_contract_id AND school_id = NEW.school_id;
  SELECT * INTO scope_row FROM payout_v2_connected_account_scopes
  WHERE id = NEW.connect_scope_id AND school_id = NEW.school_id;
  IF batch_row.id IS NULL OR contract_row.id IS NULL OR scope_row.id IS NULL
    OR batch_row.instructor_id <> NEW.instructor_id
    OR contract_row.instructor_id <> NEW.instructor_id
    OR contract_row.currency <> NEW.currency
    OR batch_row.currency <> NEW.currency
    OR contract_row.stripe_charge_id <> NEW.stripe_source_charge_id
    OR scope_row.owner_type <> 'instructor'
    OR scope_row.instructor_id <> NEW.instructor_id
    OR scope_row.stripe_account_id <> NEW.stripe_destination_account_id
  THEN
    RAISE EXCEPTION 'transfer intent source, recipient, currency, or batch mismatch'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION stripe_launch_validate_refund_intent_insert()
RETURNS TRIGGER AS $$
DECLARE
  contract_row lesson_payment_contracts%ROWTYPE;
  booking_row lesson_bookings%ROWTYPE;
  already_claimed BIGINT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(
    NEW.school_id::TEXT || ':refund:' || NEW.payment_contract_id::TEXT, 0
  ));
  SELECT * INTO contract_row FROM lesson_payment_contracts
  WHERE id = NEW.payment_contract_id AND school_id = NEW.school_id;
  SELECT * INTO booking_row FROM lesson_bookings
  WHERE id = NEW.booking_id AND school_id = NEW.school_id;
  IF contract_row.id IS NULL OR booking_row.id IS NULL
    OR contract_row.learner_id <> NEW.learner_id
    OR contract_row.instructor_id <> NEW.instructor_id
    OR contract_row.funding_source_id <> NEW.funding_source_id
    OR contract_row.gross_amount_minor <> NEW.gross_amount_minor
    OR contract_row.stripe_fee_minor <> NEW.stripe_fee_minor
    OR contract_row.currency <> NEW.currency
    OR contract_row.stripe_payment_intent_id <> NEW.stripe_payment_intent_id
    OR contract_row.stripe_charge_id <> NEW.stripe_charge_id
    OR booking_row.lesson_payment_contract_id <> NEW.payment_contract_id
  THEN
    RAISE EXCEPTION 'refund intent does not match immutable contract/booking evidence'
      USING ERRCODE = '23514';
  END IF;
  SELECT COALESCE(SUM(refund_amount_minor), 0) INTO already_claimed
  FROM refund_intents
  WHERE school_id = NEW.school_id
    AND payment_contract_id = NEW.payment_contract_id;
  IF already_claimed + NEW.refund_amount_minor > contract_row.gross_amount_minor THEN
    RAISE EXCEPTION 'refund intents exceed immutable contract gross amount'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION stripe_launch_validate_issue_report_insert()
RETURNS TRIGGER AS $$
DECLARE
  token_row lesson_issue_tokens%ROWTYPE;
BEGIN
  SELECT * INTO token_row FROM lesson_issue_tokens
  WHERE id = NEW.token_id AND school_id = NEW.school_id
  FOR UPDATE;
  IF token_row.id IS NULL OR token_row.booking_id <> NEW.booking_id
    OR token_row.learner_id IS DISTINCT FROM NEW.learner_id
    OR token_row.expires_at < NEW.reported_at
    OR token_row.revoked_at IS NOT NULL
    OR token_row.consumed_at IS NOT NULL
  THEN
    RAISE EXCEPTION 'lesson issue report token is invalid, expired, or consumed'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION stripe_launch_validate_contract_completion()
RETURNS TRIGGER AS $$
DECLARE
  target_contract_id UUID;
  target_school_id INTEGER;
  contract_row lesson_payment_contracts%ROWTYPE;
  booking_count BIGINT;
  source_count BIGINT;
BEGIN
  IF TG_TABLE_NAME = 'lesson_payment_contracts' THEN
    target_contract_id := NEW.id;
    target_school_id := NEW.school_id;
  ELSE
    target_contract_id := NEW.lesson_payment_contract_id;
    target_school_id := NEW.school_id;
  END IF;
  IF target_contract_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO contract_row FROM lesson_payment_contracts
  WHERE id = target_contract_id AND school_id = target_school_id;
  IF NOT FOUND OR contract_row.evidence_status <> 'complete' THEN RETURN NULL; END IF;
  SELECT COUNT(*) INTO booking_count FROM lesson_bookings
  WHERE school_id = target_school_id
    AND lesson_payment_contract_id = target_contract_id
    AND status IN ('scheduled', 'chargeable');
  IF booking_count <> 1 THEN
    RAISE EXCEPTION 'complete launch contract must have exactly one active booking link'
      USING ERRCODE = '23514';
  END IF;
  SELECT COUNT(*) INTO source_count FROM payout_funding_sources
  WHERE id = contract_row.funding_source_id
    AND school_id = target_school_id
    AND lesson_payment_contract_id = target_contract_id
    AND source_booking_id = (
      SELECT id FROM lesson_bookings
      WHERE school_id = target_school_id
        AND lesson_payment_contract_id = target_contract_id
        AND status IN ('scheduled', 'chargeable')
      LIMIT 1
    );
  IF source_count <> 1 THEN
    RAISE EXCEPTION 'complete launch contract must match its funding source and active booking'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION stripe_launch_validate_earning_dispositions()
RETURNS TRIGGER AS $$
DECLARE
  target_id UUID;
  target_school INTEGER;
  earning_row stripe_launch_booking_earnings%ROWTYPE;
  disposed BIGINT;
BEGIN
  target_school := NEW.school_id;
  IF TG_TABLE_NAME = 'stripe_launch_booking_earnings' THEN target_id := NEW.id;
  ELSE target_id := NEW.booking_earning_id;
  END IF;
  SELECT * INTO earning_row FROM stripe_launch_booking_earnings
  WHERE id = target_id AND school_id = target_school;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT COALESCE(SUM(amount_minor), 0) INTO disposed
  FROM payout_batch_earning_dispositions
  WHERE booking_earning_id = target_id AND school_id = target_school;
  IF disposed <> earning_row.instructor_share_minor THEN
    RAISE EXCEPTION 'earning dispositions do not conserve instructor share'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION stripe_launch_validate_transfer_total()
RETURNS TRIGGER AS $$
DECLARE
  target_id UUID;
  target_school INTEGER;
  transfer_row stripe_launch_transfer_intents%ROWTYPE;
  allocated BIGINT;
BEGIN
  target_school := NEW.school_id;
  IF TG_TABLE_NAME = 'stripe_launch_transfer_intents' THEN target_id := NEW.id;
  ELSE target_id := NEW.transfer_intent_id;
  END IF;
  IF target_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO transfer_row FROM stripe_launch_transfer_intents
  WHERE id = target_id AND school_id = target_school;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT COALESCE(SUM(amount_minor), 0) INTO allocated
  FROM payout_batch_earning_dispositions
  WHERE transfer_intent_id = target_id AND school_id = target_school;
  IF allocated <> transfer_row.amount_minor THEN
    RAISE EXCEPTION 'transfer allocations do not equal immutable transfer amount'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION stripe_launch_validate_batch_totals()
RETURNS TRIGGER AS $$
DECLARE
  target_id UUID;
  target_school INTEGER;
  batch_row instructor_payout_batches%ROWTYPE;
  earning_totals RECORD;
  disposition_totals RECORD;
  application_total BIGINT;
  new_obligation_total BIGINT;
BEGIN
  target_school := NEW.school_id;
  IF TG_TABLE_NAME = 'instructor_payout_batches' THEN
    target_id := NEW.id;
  ELSIF TG_TABLE_NAME = 'instructor_payout_obligation_applications' THEN
    target_id := NEW.source_batch_id;
  ELSIF TG_TABLE_NAME = 'instructor_payout_obligations' THEN
    SELECT id INTO target_id FROM instructor_payout_batches
    WHERE school_id = NEW.school_id
      AND payout_run_id = NEW.source_payout_run_id
      AND instructor_id = NEW.instructor_id;
  ELSE
    target_id := NEW.payout_batch_id;
  END IF;
  IF target_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO batch_row FROM instructor_payout_batches
  WHERE id = target_id AND school_id = target_school;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT COALESCE(SUM(gross_minor),0) gross,
    COALESCE(SUM(stripe_fee_minor),0) stripe_fee,
    COALESCE(SUM(net_minor),0) net,
    COALESCE(SUM(instructor_share_minor),0) instructor_share,
    COALESCE(SUM(platform_share_minor),0) platform_share
  INTO earning_totals
  FROM stripe_launch_booking_earnings
  WHERE payout_batch_id = target_id AND school_id = target_school;
  SELECT
    COALESCE(SUM(amount_minor) FILTER (WHERE disposition_type = 'obligation_application'),0) obligation,
    COALESCE(SUM(amount_minor) FILTER (WHERE disposition_type = 'transfer_allocation'),0) transfer,
    COALESCE(SUM(amount_minor) FILTER (WHERE disposition_type = 'held_connect_not_ready'),0) held
  INTO disposition_totals
  FROM payout_batch_earning_dispositions
  WHERE payout_batch_id = target_id AND school_id = target_school;
  SELECT COALESCE(SUM(amount_minor),0) INTO application_total
  FROM instructor_payout_obligation_applications
  WHERE source_batch_id = target_id AND school_id = target_school
    AND application_type = 'batch_earnings';
  SELECT COALESCE(SUM(original_amount_minor),0) INTO new_obligation_total
  FROM instructor_payout_obligations
  WHERE source_payout_run_id = batch_row.payout_run_id
    AND school_id = target_school
    AND instructor_id = batch_row.instructor_id;
  IF earning_totals.gross <> batch_row.gross_minor
    OR earning_totals.stripe_fee <> batch_row.stripe_fee_minor
    OR earning_totals.net <> batch_row.net_minor
    OR earning_totals.instructor_share <> batch_row.instructor_share_minor
    OR earning_totals.platform_share <> batch_row.platform_share_minor
    OR disposition_totals.obligation <> batch_row.applied_obligation_minor
    OR disposition_totals.transfer <> batch_row.transfer_planned_minor
    OR disposition_totals.held <> batch_row.held_minor
    OR application_total <> batch_row.applied_obligation_minor
    OR new_obligation_total <> batch_row.new_obligation_minor
  THEN
    RAISE EXCEPTION 'instructor payout batch child rows do not conserve locked totals'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION stripe_launch_validate_run_totals()
RETURNS TRIGGER AS $$
DECLARE
  target_id UUID;
  target_school INTEGER;
  run_row payout_runs%ROWTYPE;
  totals RECORD;
BEGIN
  target_school := NEW.school_id;
  IF TG_TABLE_NAME = 'payout_runs' THEN target_id := NEW.id;
  ELSE target_id := NEW.payout_run_id;
  END IF;
  SELECT * INTO run_row FROM payout_runs
  WHERE id = target_id AND school_id = target_school;
  IF NOT FOUND OR run_row.state IN ('planned', 'shadowed', 'approval_pending') THEN RETURN NULL; END IF;
  SELECT COALESCE(SUM(gross_minor),0) gross,
    COALESCE(SUM(stripe_fee_minor),0) stripe_fee,
    COALESCE(SUM(net_minor),0) net,
    COALESCE(SUM(instructor_share_minor),0) instructor_share,
    COALESCE(SUM(platform_share_minor),0) platform_share,
    COALESCE(SUM(applied_obligation_minor),0) obligation,
    COALESCE(SUM(transfer_planned_minor),0) transfer,
    COALESCE(SUM(held_minor),0) held
  INTO totals FROM instructor_payout_batches
  WHERE payout_run_id = target_id AND school_id = target_school;
  IF totals.gross <> run_row.gross_minor
    OR totals.stripe_fee <> run_row.stripe_fee_minor
    OR totals.net <> run_row.net_minor
    OR totals.instructor_share <> run_row.instructor_share_minor
    OR totals.platform_share <> run_row.platform_share_minor
    OR totals.obligation <> run_row.obligation_applied_minor
    OR totals.transfer <> run_row.transfer_minor
    OR totals.held <> run_row.held_minor
  THEN
    RAISE EXCEPTION 'payout run batches do not conserve locked totals'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION stripe_launch_guard_state_transition()
RETURNS TRIGGER AS $$
DECLARE
  old_state TEXT := to_jsonb(OLD)->>TG_ARGV[0];
  new_state TEXT := to_jsonb(NEW)->>TG_ARGV[0];
  allowed BOOLEAN := FALSE;
BEGIN
  IF old_state = new_state THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'refund_intents' THEN
    allowed := (old_state = 'planned' AND new_state IN ('submitting','manual_review'))
      OR (old_state = 'submitting' AND new_state IN ('succeeded','reconciling','failed_confirmed'))
      OR (old_state = 'reconciling' AND new_state IN ('succeeded','failed_confirmed','manual_review'))
      OR (old_state = 'failed_confirmed' AND new_state IN ('submitting','manual_review'));
  ELSIF TG_TABLE_NAME = 'stripe_launch_transfer_intents' THEN
    allowed := (old_state = 'planned' AND new_state IN ('submitting','blocked'))
      OR (old_state = 'submitting' AND new_state IN ('transferred','reconciling','failed_confirmed'))
      OR (old_state = 'reconciling' AND new_state IN ('transferred','failed_confirmed'))
      OR (old_state = 'failed_confirmed' AND new_state = 'submitting');
  ELSIF TG_TABLE_NAME = 'payment_disputes' THEN
    allowed := old_state IN ('open','needs_response','under_review')
      AND new_state IN ('open','needs_response','under_review','won','lost','closed_manual');
  ELSIF TG_TABLE_NAME = 'financial_job_occurrences' THEN
    allowed := (old_state = 'pending' AND new_state IN ('leased','missed_manual_review'))
      OR (old_state = 'leased' AND new_state IN ('running','pending','failed_retryable'))
      OR (old_state = 'running' AND new_state IN ('completed','failed_retryable','failed_confirmed'))
      OR (old_state = 'failed_retryable' AND new_state = 'leased');
  ELSIF TG_TABLE_NAME = 'payout_runs' THEN
    allowed := (old_state = 'planned' AND new_state IN ('shadowed','approval_pending','locked','paused'))
      OR (old_state = 'shadowed' AND new_state IN ('approval_pending','paused'))
      OR (old_state = 'approval_pending' AND new_state IN ('locked','paused'))
      OR (old_state = 'locked' AND new_state IN ('transferring','paused'))
      OR (old_state = 'transferring' AND new_state IN ('transferred','reconciling','failed_confirmed','paused'))
      OR (old_state = 'reconciling' AND new_state IN ('transferred','failed_confirmed','paused'))
      OR (old_state = 'failed_confirmed' AND new_state IN ('transferring','paused'))
      OR (old_state = 'paused' AND new_state IN ('approval_pending','locked','transferring'));
  ELSIF TG_TABLE_NAME = 'instructor_payout_batches' THEN
    allowed := (old_state IN ('locked','zero_value','held_connect_not_ready')
        AND new_state IN ('transfer_pending','transferring','held_connect_not_ready'))
      OR (old_state = 'transfer_pending' AND new_state IN ('transferring','held_connect_not_ready'))
      OR (old_state = 'transferring' AND new_state IN ('transferred','reconciling','failed_confirmed'))
      OR (old_state = 'reconciling' AND new_state IN ('transferred','failed_confirmed'))
      OR (old_state = 'failed_confirmed' AND new_state = 'transferring');
  END IF;
  IF NOT allowed THEN
    RAISE EXCEPTION 'invalid % state transition % -> %', TG_TABLE_NAME, old_state, new_state
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Append-only evidence tables.
DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'stripe_connect_launch_events', 'lesson_outcome_revisions',
    'lesson_issue_reports', 'lesson_issue_actions', 'refund_attempts',
    'connect_account_state_events', 'instructor_payout_obligations',
    'instructor_payout_obligation_applications', 'stripe_launch_booking_earnings',
    'stripe_launch_transfer_attempts', 'payout_batch_earning_dispositions',
    'payout_statements', 'payout_statement_delivery_attempts',
    'payment_dispute_events', 'dispute_evidence_pack_versions',
    'dispute_notification_attempts'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I',
      table_name || '_append_only', table_name);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION stripe_launch_reject_change()',
      table_name || '_append_only', table_name);
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS stripe_connect_launch_configs_no_delete ON stripe_connect_launch_configs;
CREATE TRIGGER stripe_connect_launch_configs_no_delete
  BEFORE DELETE ON stripe_connect_launch_configs
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_reject_delete();
DROP TRIGGER IF EXISTS stripe_connect_launch_configs_update_guard ON stripe_connect_launch_configs;
CREATE TRIGGER stripe_connect_launch_configs_update_guard
  BEFORE UPDATE ON stripe_connect_launch_configs
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_guard_config_update();

DROP TRIGGER IF EXISTS payout_agreements_write_guard ON instructor_payout_agreement_versions;
CREATE TRIGGER payout_agreements_write_guard
  BEFORE INSERT OR UPDATE ON instructor_payout_agreement_versions
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_guard_agreement_write();
DROP TRIGGER IF EXISTS payout_agreements_no_delete ON instructor_payout_agreement_versions;
CREATE TRIGGER payout_agreements_no_delete
  BEFORE DELETE ON instructor_payout_agreement_versions
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_reject_delete();

DROP TRIGGER IF EXISTS lesson_payment_contracts_regime_guard ON lesson_payment_contracts;
CREATE TRIGGER lesson_payment_contracts_regime_guard
  BEFORE INSERT OR UPDATE ON lesson_payment_contracts
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_validate_contract_regime();
DROP TRIGGER IF EXISTS lesson_payment_contracts_update_guard ON lesson_payment_contracts;
CREATE TRIGGER lesson_payment_contracts_update_guard
  BEFORE UPDATE ON lesson_payment_contracts
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_guard_contract_update();
DROP TRIGGER IF EXISTS lesson_payment_contracts_no_delete ON lesson_payment_contracts;
CREATE TRIGGER lesson_payment_contracts_no_delete
  BEFORE DELETE ON lesson_payment_contracts
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_reject_delete();

DROP TRIGGER IF EXISTS lesson_outcome_revisions_insert_guard ON lesson_outcome_revisions;
CREATE TRIGGER lesson_outcome_revisions_insert_guard
  BEFORE INSERT ON lesson_outcome_revisions
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_validate_outcome_insert();

DROP TRIGGER IF EXISTS lesson_issue_tokens_no_delete ON lesson_issue_tokens;
CREATE TRIGGER lesson_issue_tokens_no_delete
  BEFORE DELETE ON lesson_issue_tokens
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_reject_delete();
DROP TRIGGER IF EXISTS lesson_issue_tokens_immutable_facts ON lesson_issue_tokens;
CREATE TRIGGER lesson_issue_tokens_immutable_facts
  BEFORE UPDATE ON lesson_issue_tokens
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_guard_operational_update('consumed_at', 'revoked_at');
DROP TRIGGER IF EXISTS lesson_issue_reports_insert_guard ON lesson_issue_reports;
CREATE TRIGGER lesson_issue_reports_insert_guard
  BEFORE INSERT ON lesson_issue_reports
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_validate_issue_report_insert();

DROP TRIGGER IF EXISTS refund_intents_no_delete ON refund_intents;
CREATE TRIGGER refund_intents_no_delete
  BEFORE DELETE ON refund_intents
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_reject_delete();
DROP TRIGGER IF EXISTS refund_intents_immutable_facts ON refund_intents;
CREATE TRIGGER refund_intents_immutable_facts
  BEFORE UPDATE ON refund_intents
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_guard_operational_update(
    'state', 'stripe_refund_id', 'refund_event_id', 'updated_at',
    'last_error_class', 'last_error_code'
  );
DROP TRIGGER IF EXISTS refund_intents_state_guard ON refund_intents;
CREATE TRIGGER refund_intents_state_guard
  BEFORE UPDATE ON refund_intents
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_guard_state_transition('state');
DROP TRIGGER IF EXISTS refund_intents_insert_guard ON refund_intents;
CREATE TRIGGER refund_intents_insert_guard
  BEFORE INSERT ON refund_intents
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_validate_refund_intent_insert();
DROP TRIGGER IF EXISTS refund_attempts_insert_guard ON refund_attempts;
CREATE TRIGGER refund_attempts_insert_guard
  BEFORE INSERT ON refund_attempts
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_validate_refund_attempt();

DROP TRIGGER IF EXISTS payout_runs_no_delete ON payout_runs;
CREATE TRIGGER payout_runs_no_delete
  BEFORE DELETE ON payout_runs
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_reject_delete();
DROP TRIGGER IF EXISTS payout_runs_immutable_facts ON payout_runs;
CREATE TRIGGER payout_runs_immutable_facts
  BEFORE UPDATE ON payout_runs
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_guard_operational_update(
    'state', 'approved_at', 'approval_admin_id', 'approval_evidence_reference',
    'locked_at', 'submitted_at', 'reconciled_at', 'last_error_code'
  );
DROP TRIGGER IF EXISTS payout_runs_state_guard ON payout_runs;
CREATE TRIGGER payout_runs_state_guard
  BEFORE UPDATE ON payout_runs
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_guard_state_transition('state');

DROP TRIGGER IF EXISTS instructor_payout_batches_no_delete ON instructor_payout_batches;
CREATE TRIGGER instructor_payout_batches_no_delete
  BEFORE DELETE ON instructor_payout_batches
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_reject_delete();
DROP TRIGGER IF EXISTS instructor_payout_batches_immutable_facts ON instructor_payout_batches;
CREATE TRIGGER instructor_payout_batches_immutable_facts
  BEFORE UPDATE ON instructor_payout_batches
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_guard_operational_update(
    'state', 'transfer_submitted_minor', 'submitted_at', 'reconciled_at', 'last_error_code'
  );
DROP TRIGGER IF EXISTS instructor_payout_batches_state_guard ON instructor_payout_batches;
CREATE TRIGGER instructor_payout_batches_state_guard
  BEFORE UPDATE ON instructor_payout_batches
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_guard_state_transition('state');
DROP TRIGGER IF EXISTS instructor_payout_batches_insert_guard ON instructor_payout_batches;
CREATE TRIGGER instructor_payout_batches_insert_guard
  BEFORE INSERT ON instructor_payout_batches
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_validate_batch_insert();

DROP TRIGGER IF EXISTS stripe_launch_booking_earnings_insert_guard
  ON stripe_launch_booking_earnings;
CREATE TRIGGER stripe_launch_booking_earnings_insert_guard
  BEFORE INSERT ON stripe_launch_booking_earnings
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_validate_earning_insert();

DROP TRIGGER IF EXISTS stripe_launch_transfer_intents_no_delete ON stripe_launch_transfer_intents;
CREATE TRIGGER stripe_launch_transfer_intents_no_delete
  BEFORE DELETE ON stripe_launch_transfer_intents
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_reject_delete();
DROP TRIGGER IF EXISTS stripe_launch_transfer_intents_immutable_facts ON stripe_launch_transfer_intents;
CREATE TRIGGER stripe_launch_transfer_intents_immutable_facts
  BEFORE UPDATE ON stripe_launch_transfer_intents
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_guard_operational_update(
    'state', 'stripe_transfer_id', 'submitted_at', 'reconciled_at', 'last_error_code'
  );
DROP TRIGGER IF EXISTS stripe_launch_transfer_intents_state_guard ON stripe_launch_transfer_intents;
CREATE TRIGGER stripe_launch_transfer_intents_state_guard
  BEFORE UPDATE ON stripe_launch_transfer_intents
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_guard_state_transition('state');
DROP TRIGGER IF EXISTS stripe_launch_transfer_intents_insert_guard
  ON stripe_launch_transfer_intents;
CREATE TRIGGER stripe_launch_transfer_intents_insert_guard
  BEFORE INSERT ON stripe_launch_transfer_intents
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_validate_transfer_insert();
DROP TRIGGER IF EXISTS stripe_launch_transfer_attempts_insert_guard ON stripe_launch_transfer_attempts;
CREATE TRIGGER stripe_launch_transfer_attempts_insert_guard
  BEFORE INSERT ON stripe_launch_transfer_attempts
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_validate_transfer_attempt();

DROP TRIGGER IF EXISTS payment_disputes_no_delete ON payment_disputes;
CREATE TRIGGER payment_disputes_no_delete
  BEFORE DELETE ON payment_disputes
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_reject_delete();
DROP TRIGGER IF EXISTS payment_disputes_immutable_facts ON payment_disputes;
CREATE TRIGGER payment_disputes_immutable_facts
  BEFORE UPDATE ON payment_disputes
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_guard_operational_update(
    'current_state', 'final_principal_lost_minor', 'response_deadline',
    'current_fingerprint', 'terminal_at', 'updated_at'
  );
DROP TRIGGER IF EXISTS payment_disputes_state_guard ON payment_disputes;
CREATE TRIGGER payment_disputes_state_guard
  BEFORE UPDATE ON payment_disputes
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_guard_state_transition('current_state');

DROP TRIGGER IF EXISTS financial_job_occurrences_no_delete ON financial_job_occurrences;
CREATE TRIGGER financial_job_occurrences_no_delete
  BEFORE DELETE ON financial_job_occurrences
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_reject_delete();
DROP TRIGGER IF EXISTS financial_job_occurrences_immutable_facts ON financial_job_occurrences;
CREATE TRIGGER financial_job_occurrences_immutable_facts
  BEFORE UPDATE ON financial_job_occurrences
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_guard_operational_update(
    'state', 'lease_owner', 'lease_expires_at', 'attempt_count', 'started_at',
    'completed_at', 'result_fingerprint', 'error_code', 'updated_at'
  );
DROP TRIGGER IF EXISTS financial_job_occurrences_state_guard ON financial_job_occurrences;
CREATE TRIGGER financial_job_occurrences_state_guard
  BEFORE UPDATE ON financial_job_occurrences
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_guard_state_transition('state');

DROP TRIGGER IF EXISTS obligation_applications_insert_guard
  ON instructor_payout_obligation_applications;
CREATE TRIGGER obligation_applications_insert_guard
  BEFORE INSERT ON instructor_payout_obligation_applications
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_validate_obligation_application();
DROP TRIGGER IF EXISTS obligations_insert_guard ON instructor_payout_obligations;
CREATE TRIGGER obligations_insert_guard
  BEFORE INSERT ON instructor_payout_obligations
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_validate_obligation_insert();
DROP TRIGGER IF EXISTS payout_dispositions_insert_guard ON payout_batch_earning_dispositions;
CREATE TRIGGER payout_dispositions_insert_guard
  BEFORE INSERT ON payout_batch_earning_dispositions
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_validate_disposition_link();

-- Deferred cross-row integrity. Parent and child rows may be inserted in either
-- order inside one transaction, but commit fails unless exact pence conserves.
DROP TRIGGER IF EXISTS lesson_contract_completion_guard ON lesson_payment_contracts;
CREATE CONSTRAINT TRIGGER lesson_contract_completion_guard
  AFTER INSERT OR UPDATE ON lesson_payment_contracts
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_validate_contract_completion();
DROP TRIGGER IF EXISTS lesson_booking_contract_completion_guard ON lesson_bookings;
CREATE CONSTRAINT TRIGGER lesson_booking_contract_completion_guard
  AFTER INSERT OR UPDATE OF lesson_payment_contract_id, status ON lesson_bookings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_validate_contract_completion();

DROP TRIGGER IF EXISTS launch_earning_disposition_totals_guard ON stripe_launch_booking_earnings;
CREATE CONSTRAINT TRIGGER launch_earning_disposition_totals_guard
  AFTER INSERT ON stripe_launch_booking_earnings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_validate_earning_dispositions();
DROP TRIGGER IF EXISTS launch_disposition_earning_totals_guard ON payout_batch_earning_dispositions;
CREATE CONSTRAINT TRIGGER launch_disposition_earning_totals_guard
  AFTER INSERT ON payout_batch_earning_dispositions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_validate_earning_dispositions();

DROP TRIGGER IF EXISTS launch_transfer_totals_guard ON stripe_launch_transfer_intents;
CREATE CONSTRAINT TRIGGER launch_transfer_totals_guard
  AFTER INSERT ON stripe_launch_transfer_intents
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_validate_transfer_total();
DROP TRIGGER IF EXISTS launch_disposition_transfer_totals_guard ON payout_batch_earning_dispositions;
CREATE CONSTRAINT TRIGGER launch_disposition_transfer_totals_guard
  AFTER INSERT ON payout_batch_earning_dispositions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_validate_transfer_total();

DROP TRIGGER IF EXISTS launch_batch_totals_guard ON instructor_payout_batches;
CREATE CONSTRAINT TRIGGER launch_batch_totals_guard
  AFTER INSERT ON instructor_payout_batches
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_validate_batch_totals();
DROP TRIGGER IF EXISTS launch_earning_batch_totals_guard ON stripe_launch_booking_earnings;
CREATE CONSTRAINT TRIGGER launch_earning_batch_totals_guard
  AFTER INSERT ON stripe_launch_booking_earnings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_validate_batch_totals();
DROP TRIGGER IF EXISTS launch_disposition_batch_totals_guard ON payout_batch_earning_dispositions;
CREATE CONSTRAINT TRIGGER launch_disposition_batch_totals_guard
  AFTER INSERT ON payout_batch_earning_dispositions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_validate_batch_totals();
DROP TRIGGER IF EXISTS launch_obligation_batch_totals_guard ON instructor_payout_obligations;
CREATE CONSTRAINT TRIGGER launch_obligation_batch_totals_guard
  AFTER INSERT ON instructor_payout_obligations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_validate_batch_totals();
DROP TRIGGER IF EXISTS launch_application_batch_totals_guard
  ON instructor_payout_obligation_applications;
CREATE CONSTRAINT TRIGGER launch_application_batch_totals_guard
  AFTER INSERT ON instructor_payout_obligation_applications
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_validate_batch_totals();

DROP TRIGGER IF EXISTS launch_run_totals_guard ON payout_runs;
CREATE CONSTRAINT TRIGGER launch_run_totals_guard
  AFTER INSERT OR UPDATE ON payout_runs
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_validate_run_totals();
DROP TRIGGER IF EXISTS launch_batch_run_totals_guard ON instructor_payout_batches;
CREATE CONSTRAINT TRIGGER launch_batch_run_totals_guard
  AFTER INSERT ON instructor_payout_batches
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_validate_run_totals();

-- Stripe Connect Simon launch: forward-only correction for the Slice 1
-- payout-source fill-once guard.
--
-- PostgreSQL JSONB extraction with -> returns a JSON null value for an SQL
-- NULL column. JSON null is itself non-NULL to SQL, so migration 039's guard
-- rejected the first legitimate NULL-to-value fill. Text extraction with ->>
-- returns SQL NULL and preserves the intended append-only rule: a launch fact
-- may be filled once, but can never be replaced afterward.

CREATE OR REPLACE FUNCTION stripe_launch_guard_payout_source_update()
RETURNS TRIGGER AS $$
DECLARE
  old_facts JSONB;
  new_facts JSONB;
  fill_column TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payout_funding_sources is append-only: DELETE is forbidden'
      USING ERRCODE = '55000';
  END IF;
  old_facts := to_jsonb(OLD) - ARRAY[
    'stripe_payment_created_at', 'stripe_funds_available_at', 'payment_origin',
    'source_booking_id', 'lesson_payment_contract_id', 'evidence_completeness',
    'contradiction_code'
  ]::text[];
  new_facts := to_jsonb(NEW) - ARRAY[
    'stripe_payment_created_at', 'stripe_funds_available_at', 'payment_origin',
    'source_booking_id', 'lesson_payment_contract_id', 'evidence_completeness',
    'contradiction_code'
  ]::text[];
  IF old_facts <> new_facts THEN
    RAISE EXCEPTION 'payout funding source historic facts are immutable'
      USING ERRCODE = '55000';
  END IF;
  FOREACH fill_column IN ARRAY ARRAY[
    'stripe_payment_created_at', 'stripe_funds_available_at', 'payment_origin',
    'source_booking_id', 'lesson_payment_contract_id'
  ] LOOP
    IF to_jsonb(OLD)->>fill_column IS NOT NULL
      AND to_jsonb(OLD)->fill_column IS DISTINCT FROM to_jsonb(NEW)->fill_column
    THEN
      RAISE EXCEPTION 'known payout source launch evidence cannot be replaced: %', fill_column
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
  IF OLD.evidence_completeness IS NOT NULL
    AND OLD.evidence_completeness <> 'pending'
    AND OLD.evidence_completeness IS DISTINCT FROM NEW.evidence_completeness
  THEN
    RAISE EXCEPTION 'terminal payout source evidence classification is immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Stripe Connect Simon launch Slice 4: Accounts v2 onboarding readiness.
-- Additive and inert: no account, link, agreement, payout, or provider action
-- is activated by this migration.

CREATE TABLE IF NOT EXISTS connect_v2_account_creation_intents (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  instructor_id INTEGER NOT NULL,
  stripe_mode TEXT NOT NULL,
  configuration_type TEXT NOT NULL,
  dashboard_type TEXT NOT NULL,
  stable_identity TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  state TEXT NOT NULL,
  provider_account_id TEXT,
  connect_scope_id BIGINT,
  last_error_class TEXT,
  created_by_user_id INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (id, school_id),
  UNIQUE (school_id, instructor_id, stripe_mode, configuration_type),
  UNIQUE (stable_identity),
  UNIQUE (idempotency_key),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  FOREIGN KEY (connect_scope_id, school_id)
    REFERENCES payout_v2_connected_account_scopes(id, school_id),
  CHECK (stripe_mode IN ('test', 'live')),
  CHECK (configuration_type = 'recipient'),
  CHECK (dashboard_type = 'express'),
  CHECK (stable_identity ~ '^cc:connect-v2:[0-9]+:[0-9]+:(test|live):recipient$'),
  CHECK (idempotency_key ~ '^cc-connect-v2-[0-9a-f-]{36}$'),
  CHECK (request_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (state IN (
    'planned', 'submitting', 'reconciling', 'succeeded',
    'failed_confirmed', 'manual_review'
  )),
  CHECK (provider_account_id IS NULL OR provider_account_id LIKE 'acct\_%' ESCAPE '\'),
  CHECK (last_error_class IS NULL OR last_error_class IN (
    'invalid_request', 'authentication', 'permission', 'idempotency',
    'network', 'rate_limit', 'api', 'unknown'
  ))
);

CREATE INDEX IF NOT EXISTS idx_connect_v2_creation_intents_school_state
  ON connect_v2_account_creation_intents(school_id, state, updated_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_v2_scope_instructor_owner
  ON payout_v2_connected_account_scopes(school_id, instructor_id)
  WHERE owner_type = 'instructor';
CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_v2_scope_school_owner
  ON payout_v2_connected_account_scopes(school_id, destination_school_id)
  WHERE owner_type = 'school';

CREATE TABLE IF NOT EXISTS connect_v2_account_creation_attempts (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  instructor_id INTEGER NOT NULL,
  intent_id UUID NOT NULL,
  attempt_number INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  provider_account_id TEXT,
  provider_request_id TEXT,
  error_class TEXT,
  evidence_json JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  UNIQUE (id, school_id),
  UNIQUE (school_id, intent_id, attempt_number),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  FOREIGN KEY (intent_id, school_id)
    REFERENCES connect_v2_account_creation_intents(id, school_id),
  CHECK (attempt_number > 0),
  CHECK (outcome IN (
    'provider_succeeded', 'provider_failed_confirmed',
    'provider_ambiguous', 'reconciled_existing', 'reconcile_no_match',
    'reconcile_multiple_matches'
  )),
  CHECK (provider_account_id IS NULL OR provider_account_id LIKE 'acct\_%' ESCAPE '\'),
  CHECK (jsonb_typeof(evidence_json) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_connect_v2_creation_attempts_intent
  ON connect_v2_account_creation_attempts(school_id, intent_id, occurred_at);

CREATE TABLE IF NOT EXISTS connect_v2_account_link_events (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  instructor_id INTEGER NOT NULL,
  connect_scope_id BIGINT NOT NULL,
  stripe_account_id TEXT NOT NULL,
  action TEXT NOT NULL,
  state_fingerprint TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  evidence_json JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  UNIQUE (id, school_id),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  FOREIGN KEY (connect_scope_id, school_id)
    REFERENCES payout_v2_connected_account_scopes(id, school_id),
  CHECK (stripe_account_id LIKE 'acct\_%' ESCAPE '\'),
  CHECK (action IN ('created', 'refresh_validated', 'return_validated')),
  CHECK (state_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (jsonb_typeof(evidence_json) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_connect_v2_link_events_scope
  ON connect_v2_account_link_events(school_id, connect_scope_id, occurred_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_connect_v2_link_event_state_action
  ON connect_v2_account_link_events(school_id, state_fingerprint, action);

CREATE OR REPLACE FUNCTION connect_v2_forbid_append_only_change()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is forbidden', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION connect_v2_guard_creation_intent_update()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'connect account creation intents cannot be deleted'
      USING ERRCODE = '55000';
  END IF;
  IF to_jsonb(OLD) - ARRAY[
      'state', 'provider_account_id', 'connect_scope_id',
      'last_error_class', 'updated_at'
    ]::text[]
    <> to_jsonb(NEW) - ARRAY[
      'state', 'provider_account_id', 'connect_scope_id',
      'last_error_class', 'updated_at'
    ]::text[]
  THEN
    RAISE EXCEPTION 'connect account creation identity is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF OLD.provider_account_id IS NOT NULL
    AND OLD.provider_account_id IS DISTINCT FROM NEW.provider_account_id
  THEN
    RAISE EXCEPTION 'connect provider account identity cannot be replaced'
      USING ERRCODE = '55000';
  END IF;
  IF OLD.connect_scope_id IS NOT NULL
    AND OLD.connect_scope_id IS DISTINCT FROM NEW.connect_scope_id
  THEN
    RAISE EXCEPTION 'connect account scope cannot be replaced'
      USING ERRCODE = '55000';
  END IF;
  IF NOT (
    OLD.state = NEW.state
    OR (OLD.state = 'planned' AND NEW.state = 'submitting')
    OR (OLD.state = 'submitting' AND NEW.state IN ('planned', 'reconciling', 'succeeded', 'failed_confirmed', 'manual_review'))
    OR (OLD.state = 'reconciling' AND NEW.state IN ('succeeded', 'manual_review'))
  ) THEN
    RAISE EXCEPTION 'invalid connect account creation state transition'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS connect_v2_creation_intents_guard
  ON connect_v2_account_creation_intents;
CREATE TRIGGER connect_v2_creation_intents_guard
  BEFORE UPDATE OR DELETE ON connect_v2_account_creation_intents
  FOR EACH ROW EXECUTE FUNCTION connect_v2_guard_creation_intent_update();

DROP TRIGGER IF EXISTS connect_v2_creation_attempts_append_only
  ON connect_v2_account_creation_attempts;
CREATE TRIGGER connect_v2_creation_attempts_append_only
  BEFORE UPDATE OR DELETE ON connect_v2_account_creation_attempts
  FOR EACH ROW EXECUTE FUNCTION connect_v2_forbid_append_only_change();

DROP TRIGGER IF EXISTS connect_v2_link_events_append_only
  ON connect_v2_account_link_events;
CREATE TRIGGER connect_v2_link_events_append_only
  BEFORE UPDATE OR DELETE ON connect_v2_account_link_events
  FOR EACH ROW EXECUTE FUNCTION connect_v2_forbid_append_only_change();

-- Once accepted, the commercial and acceptance facts of a draft are frozen.
-- Approval may only fill the approval/linkage fields and move draft -> active.
CREATE OR REPLACE FUNCTION stripe_launch_guard_agreement_write()
RETURNS TRIGGER AS $$
DECLARE
  overlap_exists BOOLEAN;
BEGIN
  PERFORM pg_advisory_xact_lock(NEW.school_id, NEW.instructor_id);
  SELECT EXISTS (
    SELECT 1
    FROM instructor_payout_agreement_versions other
    WHERE other.school_id = NEW.school_id
      AND other.instructor_id = NEW.instructor_id
      AND other.id <> NEW.id
      AND other.status IN ('active', 'paused')
      AND NEW.status IN ('active', 'paused')
      AND tstzrange(other.starts_at, other.ends_at, '[)')
        && tstzrange(NEW.starts_at, NEW.ends_at, '[)')
  ) INTO overlap_exists;
  IF overlap_exists THEN
    RAISE EXCEPTION 'payout agreement effective ranges overlap'
      USING ERRCODE = '23P01';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status <> 'draft' THEN
      IF to_jsonb(OLD) - ARRAY['status', 'ends_at']::text[]
        <> to_jsonb(NEW) - ARRAY['status', 'ends_at']::text[]
      THEN
        RAISE EXCEPTION 'activated payout agreement facts are immutable'
          USING ERRCODE = '55000';
      END IF;
      IF NOT ((OLD.status = NEW.status)
        OR (OLD.status = 'active' AND NEW.status IN ('paused', 'ended'))
        OR (OLD.status = 'paused' AND NEW.status IN ('active', 'ended')))
      THEN
        RAISE EXCEPTION 'invalid payout agreement state transition'
          USING ERRCODE = '23514';
      END IF;
    ELSIF OLD.accepted_at IS NOT NULL THEN
      IF to_jsonb(OLD) - ARRAY[
          'status', 'connect_scope_id', 'stripe_configuration_id',
          'approved_by_admin_id', 'approved_at'
        ]::text[]
        <> to_jsonb(NEW) - ARRAY[
          'status', 'connect_scope_id', 'stripe_configuration_id',
          'approved_by_admin_id', 'approved_at'
        ]::text[]
      THEN
        RAISE EXCEPTION 'accepted payout agreement facts are immutable'
          USING ERRCODE = '55000';
      END IF;
      IF NEW.status NOT IN ('draft', 'active') THEN
        RAISE EXCEPTION 'invalid accepted agreement state transition'
          USING ERRCODE = '23514';
      END IF;
    ELSIF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'unaccepted payout agreement cannot be activated'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 042: learner cross-instructor reschedule entitlement transfers
-- ═══════════════════════════════════════════════════════════════════════════
-- Learner reschedule: explicit cross-instructor entitlement transfer.
-- The source purchase remains immutable. A paired negative/positive ledger
-- entry moves the consumed lesson entitlement between instructor scopes, and
-- the replacement booking draws from the new instructor-scoped entry.

ALTER TABLE credit_transactions
  ADD COLUMN IF NOT EXISTS transferred_from_credit_transaction_id INTEGER;

ALTER TABLE credit_transactions
  ADD COLUMN IF NOT EXISTS instructor_transfer_group_id UUID;

CREATE INDEX IF NOT EXISTS idx_credit_tx_transferred_from
  ON credit_transactions(transferred_from_credit_transaction_id, school_id)
  WHERE transferred_from_credit_transaction_id IS NOT NULL;

ALTER TABLE credit_transactions
  DROP CONSTRAINT IF EXISTS credit_transactions_transferred_from_school_fkey;
ALTER TABLE credit_transactions
  ADD CONSTRAINT credit_transactions_transferred_from_school_fkey
  FOREIGN KEY (transferred_from_credit_transaction_id, school_id)
  REFERENCES credit_transactions(id, school_id);

CREATE INDEX IF NOT EXISTS idx_credit_tx_instructor_transfer_group
  ON credit_transactions(instructor_transfer_group_id)
  WHERE instructor_transfer_group_id IS NOT NULL;

ALTER TABLE credit_transactions
  DROP CONSTRAINT IF EXISTS credit_transactions_type_check;
ALTER TABLE credit_transactions
  ADD CONSTRAINT credit_transactions_type_check
  CHECK (type IN (
    'purchase', 'refund', 'slot_purchase', 'edit_adjustment',
    'admin_add', 'admin_remove', 'referral_bonus', 'referral_reward',
    'free_trial', 'legacy_grandfather', 'request_hold', 'request_refund',
    'instructor_transfer_out', 'instructor_transfer_in'
  ));

ALTER TABLE credit_transactions
  DROP CONSTRAINT IF EXISTS credit_transactions_source_check;
ALTER TABLE credit_transactions
  ADD CONSTRAINT credit_transactions_source_check
  CHECK (source IS NULL OR source IN (
    'stripe', 'free_trial', 'reconciliation', 'goodwill', 'instructor_transfer'
  ));

ALTER TABLE credit_transactions
  DROP CONSTRAINT IF EXISTS credit_transactions_instructor_transfer_check;
ALTER TABLE credit_transactions
  ADD CONSTRAINT credit_transactions_instructor_transfer_check CHECK (
    (type NOT IN ('instructor_transfer_out', 'instructor_transfer_in')
      AND instructor_transfer_group_id IS NULL
      AND transferred_from_credit_transaction_id IS NULL)
    OR
    (type = 'instructor_transfer_out'
      AND minutes < 0
      AND instructor_transfer_group_id IS NOT NULL
      AND transferred_from_credit_transaction_id IS NOT NULL)
    OR
    (type = 'instructor_transfer_in'
      AND minutes > 0
      AND instructor_transfer_group_id IS NOT NULL
      AND transferred_from_credit_transaction_id IS NOT NULL)
  );

-- ============================================================================
-- Migration 043: Simon interim v1 hardening (additive and inert)
-- ============================================================================
-- Simon interim v1 hardening.
--
-- Additive and inert. This migration creates no control, account, invitation,
-- approval, payout, transfer, or funding-evidence rows. Runtime behaviour only
-- changes for an instructor after a separately authorised, school-scoped
-- interim_v1_instructor_controls row is created through the hardened command.

CREATE UNIQUE INDEX IF NOT EXISTS uq_instructor_payouts_id_school_interim_v1
  ON instructor_payouts(id, school_id);

CREATE TABLE IF NOT EXISTS connect_v1_account_creation_intents (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  instructor_id INTEGER NOT NULL,
  payouts_start_date DATE NOT NULL,
  stable_identity TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  state TEXT NOT NULL,
  provider_account_id TEXT,
  last_error_class TEXT,
  created_by_admin_id INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, instructor_id),
  UNIQUE (stable_identity),
  UNIQUE (idempotency_key),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  FOREIGN KEY (created_by_admin_id)
    REFERENCES admin_users(id),
  CHECK (stable_identity ~ '^cc:connect-v1:[0-9]+:[0-9]+:live:express$'),
  CHECK (idempotency_key ~ '^cc-connect-v1-[0-9a-f-]{36}$'),
  CHECK (request_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (state IN (
    'planned', 'submitting', 'reconciling', 'succeeded',
    'failed_confirmed', 'manual_review'
  )),
  CHECK (provider_account_id IS NULL OR provider_account_id LIKE 'acct\_%' ESCAPE '\'),
  CHECK (last_error_class IS NULL OR last_error_class IN (
    'card', 'invalid_request', 'authentication', 'permission', 'idempotency',
    'network', 'rate_limit', 'api', 'unknown'
  ))
);

CREATE INDEX IF NOT EXISTS idx_connect_v1_intents_school_state
  ON connect_v1_account_creation_intents(school_id, state, updated_at);

CREATE TABLE IF NOT EXISTS connect_v1_account_creation_attempts (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  instructor_id INTEGER NOT NULL,
  intent_id UUID NOT NULL,
  attempt_number INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  provider_account_id TEXT,
  provider_request_id TEXT,
  error_class TEXT,
  evidence_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, intent_id, attempt_number),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  FOREIGN KEY (intent_id, school_id)
    REFERENCES connect_v1_account_creation_intents(id, school_id),
  CHECK (attempt_number > 0),
  CHECK (outcome IN (
    'provider_succeeded', 'provider_failed_confirmed', 'provider_ambiguous',
    'reconciled_existing', 'reconcile_no_match', 'reconcile_multiple_matches'
  )),
  CHECK (provider_account_id IS NULL OR provider_account_id LIKE 'acct\_%' ESCAPE '\'),
  CHECK (jsonb_typeof(evidence_json) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_connect_v1_attempts_intent
  ON connect_v1_account_creation_attempts(school_id, intent_id, occurred_at);

CREATE TABLE IF NOT EXISTS interim_v1_instructor_controls (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  instructor_id INTEGER NOT NULL,
  account_creation_intent_id UUID NOT NULL,
  payouts_start_date DATE NOT NULL,
  funding_policy TEXT NOT NULL,
  created_by_admin_id INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, instructor_id),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  FOREIGN KEY (account_creation_intent_id, school_id)
    REFERENCES connect_v1_account_creation_intents(id, school_id),
  FOREIGN KEY (created_by_admin_id)
    REFERENCES admin_users(id),
  CHECK (funding_policy = 'exact_direct_slot_stripe')
);

CREATE INDEX IF NOT EXISTS idx_interim_v1_controls_school_start
  ON interim_v1_instructor_controls(school_id, payouts_start_date, instructor_id);

CREATE TABLE IF NOT EXISTS interim_v1_funding_evidence (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  instructor_id INTEGER NOT NULL,
  learner_id INTEGER NOT NULL,
  booking_id INTEGER NOT NULL,
  credit_transaction_id INTEGER NOT NULL,
  booking_credit_source_id INTEGER NOT NULL,
  payment_origin TEXT NOT NULL,
  provider_livemode BOOLEAN NOT NULL,
  stripe_checkout_session_id TEXT,
  stripe_payment_intent_id TEXT,
  stripe_payment_intent_status TEXT,
  stripe_charge_id TEXT,
  stripe_charge_paid BOOLEAN,
  stripe_charge_captured BOOLEAN,
  stripe_charge_payment_intent_id TEXT,
  stripe_balance_transaction_id TEXT,
  stripe_balance_transaction_source_id TEXT,
  stripe_balance_transaction_type TEXT,
  stripe_balance_transaction_amount_pence INTEGER,
  stripe_balance_transaction_currency TEXT,
  stripe_balance_transaction_status TEXT,
  stripe_payment_created_at TIMESTAMPTZ,
  stripe_funds_available_at TIMESTAMPTZ,
  gross_collected_pence INTEGER,
  stripe_fee_pence INTEGER,
  currency TEXT,
  evidence_status TEXT NOT NULL,
  contradiction_code TEXT,
  evidence_fingerprint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, booking_id),
  UNIQUE (school_id, credit_transaction_id),
  UNIQUE (school_id, booking_credit_source_id),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  FOREIGN KEY (learner_id, school_id)
    REFERENCES learner_users(id, school_id),
  FOREIGN KEY (booking_id, school_id)
    REFERENCES lesson_bookings(id, school_id),
  FOREIGN KEY (credit_transaction_id, school_id)
    REFERENCES credit_transactions(id, school_id),
  FOREIGN KEY (booking_credit_source_id, school_id)
    REFERENCES booking_credit_sources(id, school_id),
  CHECK (payment_origin = 'direct_slot'),
  CHECK (currency IS NULL OR (currency = LOWER(currency) AND char_length(currency) = 3)),
  CHECK (gross_collected_pence IS NULL OR gross_collected_pence > 0),
  CHECK (stripe_fee_pence IS NULL OR (
    stripe_fee_pence >= 0
    AND gross_collected_pence IS NOT NULL
    AND stripe_fee_pence <= gross_collected_pence
  )),
  CHECK (evidence_status IN ('pending', 'complete', 'contradictory')),
  CHECK (
    evidence_status <> 'complete'
    OR (
      provider_livemode = TRUE
      AND stripe_checkout_session_id LIKE 'cs\_%' ESCAPE '\'
      AND stripe_payment_intent_id LIKE 'pi\_%' ESCAPE '\'
      AND stripe_payment_intent_status = 'succeeded'
      AND stripe_charge_id LIKE 'ch\_%' ESCAPE '\'
      AND stripe_charge_paid = TRUE
      AND stripe_charge_captured = TRUE
      AND stripe_charge_payment_intent_id = stripe_payment_intent_id
      AND stripe_balance_transaction_id LIKE 'txn\_%' ESCAPE '\'
      AND stripe_balance_transaction_source_id = stripe_charge_id
      AND stripe_balance_transaction_type = 'charge'
      AND stripe_balance_transaction_amount_pence = gross_collected_pence
      AND stripe_balance_transaction_currency = 'gbp'
      AND stripe_balance_transaction_status IN ('available', 'pending')
      AND stripe_payment_created_at IS NOT NULL
      AND stripe_funds_available_at IS NOT NULL
      AND gross_collected_pence IS NOT NULL
      AND stripe_fee_pence IS NOT NULL
      AND currency = 'gbp'
      AND contradiction_code IS NULL
    )
  ),
  CHECK (
    (evidence_status = 'contradictory' AND NULLIF(BTRIM(contradiction_code), '') IS NOT NULL)
    OR (evidence_status <> 'contradictory' AND contradiction_code IS NULL)
  ),
  CHECK (evidence_fingerprint ~ '^sha256:[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_interim_v1_evidence_session
  ON interim_v1_funding_evidence(stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_interim_v1_evidence_payment_intent
  ON interim_v1_funding_evidence(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_interim_v1_evidence_charge
  ON interim_v1_funding_evidence(stripe_charge_id)
  WHERE stripe_charge_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_interim_v1_evidence_balance_tx
  ON interim_v1_funding_evidence(stripe_balance_transaction_id)
  WHERE stripe_balance_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_interim_v1_evidence_instructor_status
  ON interim_v1_funding_evidence(school_id, instructor_id, evidence_status, stripe_payment_created_at);

CREATE TABLE IF NOT EXISTS interim_v1_payout_approvals (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  instructor_id INTEGER NOT NULL,
  preview_fingerprint TEXT NOT NULL,
  approved_amount_pence INTEGER NOT NULL,
  state TEXT NOT NULL,
  approved_by_admin_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  evidence_reference TEXT NOT NULL,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE (id, school_id),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  FOREIGN KEY (approved_by_admin_id)
    REFERENCES admin_users(id),
  CHECK (preview_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (approved_amount_pence > 0),
  CHECK (state IN (
    'approved', 'submitting', 'reconciling', 'completed',
    'failed_confirmed', 'cancelled'
  )),
  CHECK (NULLIF(BTRIM(reason), '') IS NOT NULL),
  CHECK (NULLIF(BTRIM(evidence_reference), '') IS NOT NULL),
  CHECK ((state = 'completed' AND completed_at IS NOT NULL)
    OR (state <> 'completed' AND completed_at IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_interim_v1_open_approval
  ON interim_v1_payout_approvals(school_id, instructor_id)
  WHERE state IN ('approved', 'submitting', 'reconciling');

CREATE TABLE IF NOT EXISTS interim_v1_transfer_intents (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  instructor_id INTEGER NOT NULL,
  approval_id UUID NOT NULL,
  payout_id INTEGER NOT NULL,
  preview_fingerprint TEXT NOT NULL,
  amount_pence INTEGER NOT NULL,
  currency TEXT NOT NULL,
  destination_account_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  state TEXT NOT NULL,
  stripe_transfer_id TEXT,
  last_provider_request_id TEXT,
  last_error_class TEXT,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE (id, school_id),
  UNIQUE (school_id, approval_id),
  UNIQUE (school_id, payout_id),
  UNIQUE (idempotency_key),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  FOREIGN KEY (approval_id, school_id)
    REFERENCES interim_v1_payout_approvals(id, school_id),
  FOREIGN KEY (payout_id, school_id)
    REFERENCES instructor_payouts(id, school_id),
  CHECK (preview_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (amount_pence > 0),
  CHECK (currency = 'gbp'),
  CHECK (destination_account_id LIKE 'acct\_%' ESCAPE '\'),
  CHECK (idempotency_key ~ '^cc-interim-v1-transfer-[0-9a-f-]{36}$'),
  CHECK (state IN (
    'planned', 'submitting', 'reconciling', 'completed',
    'failed_confirmed', 'manual_review'
  )),
  CHECK (stripe_transfer_id IS NULL OR stripe_transfer_id LIKE 'tr\_%' ESCAPE '\'),
  CHECK ((state = 'completed' AND stripe_transfer_id IS NOT NULL AND completed_at IS NOT NULL)
    OR (state <> 'completed' AND completed_at IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_interim_v1_transfer_state
  ON interim_v1_transfer_intents(school_id, state, updated_at);

CREATE TABLE IF NOT EXISTS interim_v1_transfer_attempts (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  instructor_id INTEGER NOT NULL,
  transfer_intent_id UUID NOT NULL,
  attempt_number INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  stripe_transfer_id TEXT,
  provider_request_id TEXT,
  error_class TEXT,
  error_code TEXT,
  evidence_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, transfer_intent_id, attempt_number),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  FOREIGN KEY (transfer_intent_id, school_id)
    REFERENCES interim_v1_transfer_intents(id, school_id),
  CHECK (attempt_number > 0),
  CHECK (outcome IN (
    'provider_succeeded', 'provider_failed_confirmed', 'provider_ambiguous',
    'reconciled_existing', 'reconcile_no_match', 'reconcile_multiple_matches'
  )),
  CHECK (stripe_transfer_id IS NULL OR stripe_transfer_id LIKE 'tr\_%' ESCAPE '\'),
  CHECK (jsonb_typeof(evidence_json) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_interim_v1_transfer_attempts_intent
  ON interim_v1_transfer_attempts(school_id, transfer_intent_id, occurred_at);

CREATE OR REPLACE FUNCTION interim_v1_forbid_append_only_change()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is forbidden', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION interim_v1_guard_account_intent_update()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'interim v1 account creation intents cannot be deleted'
      USING ERRCODE = '55000';
  END IF;
  IF to_jsonb(OLD) - ARRAY[
      'state', 'provider_account_id', 'last_error_class', 'updated_at'
    ]::text[]
    <> to_jsonb(NEW) - ARRAY[
      'state', 'provider_account_id', 'last_error_class', 'updated_at'
    ]::text[]
  THEN
    RAISE EXCEPTION 'interim v1 account identity is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF OLD.provider_account_id IS NOT NULL
    AND OLD.provider_account_id IS DISTINCT FROM NEW.provider_account_id
  THEN
    RAISE EXCEPTION 'interim v1 provider account identity cannot be replaced'
      USING ERRCODE = '55000';
  END IF;
  IF NOT (
    OLD.state = NEW.state
    OR (OLD.state = 'planned' AND NEW.state = 'submitting')
    OR (OLD.state = 'submitting' AND NEW.state IN ('reconciling', 'succeeded', 'failed_confirmed', 'manual_review'))
    OR (OLD.state = 'reconciling' AND NEW.state IN ('succeeded', 'manual_review'))
  ) THEN
    RAISE EXCEPTION 'invalid interim v1 account intent transition'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION interim_v1_guard_control_update()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'interim v1 instructor controls cannot be deleted'
      USING ERRCODE = '55000';
  END IF;
  IF to_jsonb(OLD) - 'updated_at' <> to_jsonb(NEW) - 'updated_at' THEN
    RAISE EXCEPTION 'interim v1 instructor control facts are immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION interim_v1_guard_funding_evidence_update()
RETURNS TRIGGER AS $$
DECLARE
  immutable_old JSONB;
  immutable_new JSONB;
  fill_column TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'interim v1 funding evidence cannot be deleted'
      USING ERRCODE = '55000';
  END IF;
  immutable_old := to_jsonb(OLD) - ARRAY[
    'stripe_checkout_session_id', 'stripe_payment_intent_id', 'stripe_payment_intent_status',
    'stripe_charge_id', 'stripe_charge_paid', 'stripe_charge_captured',
    'stripe_charge_payment_intent_id', 'stripe_balance_transaction_id',
    'stripe_balance_transaction_source_id', 'stripe_balance_transaction_type',
    'stripe_balance_transaction_amount_pence', 'stripe_balance_transaction_currency',
    'stripe_balance_transaction_status', 'stripe_payment_created_at',
    'stripe_funds_available_at', 'gross_collected_pence', 'stripe_fee_pence',
    'currency', 'evidence_status', 'contradiction_code',
    'evidence_fingerprint', 'updated_at'
  ]::text[];
  immutable_new := to_jsonb(NEW) - ARRAY[
    'stripe_checkout_session_id', 'stripe_payment_intent_id', 'stripe_payment_intent_status',
    'stripe_charge_id', 'stripe_charge_paid', 'stripe_charge_captured',
    'stripe_charge_payment_intent_id', 'stripe_balance_transaction_id',
    'stripe_balance_transaction_source_id', 'stripe_balance_transaction_type',
    'stripe_balance_transaction_amount_pence', 'stripe_balance_transaction_currency',
    'stripe_balance_transaction_status', 'stripe_payment_created_at',
    'stripe_funds_available_at', 'gross_collected_pence', 'stripe_fee_pence',
    'currency', 'evidence_status', 'contradiction_code',
    'evidence_fingerprint', 'updated_at'
  ]::text[];
  IF immutable_old <> immutable_new THEN
    RAISE EXCEPTION 'interim v1 funding identity is immutable'
      USING ERRCODE = '55000';
  END IF;
  FOREACH fill_column IN ARRAY ARRAY[
    'stripe_checkout_session_id', 'stripe_payment_intent_id', 'stripe_payment_intent_status',
    'stripe_charge_id', 'stripe_charge_paid', 'stripe_charge_captured',
    'stripe_charge_payment_intent_id', 'stripe_balance_transaction_id',
    'stripe_balance_transaction_source_id', 'stripe_balance_transaction_type',
    'stripe_balance_transaction_amount_pence', 'stripe_balance_transaction_currency',
    'stripe_balance_transaction_status', 'stripe_payment_created_at',
    'stripe_funds_available_at', 'gross_collected_pence', 'stripe_fee_pence', 'currency'
  ] LOOP
    IF to_jsonb(OLD)->>fill_column IS NOT NULL
      AND to_jsonb(OLD)->fill_column IS DISTINCT FROM to_jsonb(NEW)->fill_column
    THEN
      RAISE EXCEPTION 'known interim v1 funding evidence cannot be replaced: %', fill_column
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
  IF OLD.evidence_status IN ('complete', 'contradictory')
    AND OLD.evidence_status IS DISTINCT FROM NEW.evidence_status
  THEN
    RAISE EXCEPTION 'terminal interim v1 funding classification is immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION interim_v1_guard_approval_update()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'interim v1 payout approvals cannot be deleted'
      USING ERRCODE = '55000';
  END IF;
  IF to_jsonb(OLD) - ARRAY['state', 'updated_at', 'completed_at']::text[]
    <> to_jsonb(NEW) - ARRAY['state', 'updated_at', 'completed_at']::text[]
  THEN
    RAISE EXCEPTION 'interim v1 approval facts are immutable'
      USING ERRCODE = '55000';
  END IF;
  IF NOT (
    OLD.state = NEW.state
    OR (OLD.state = 'approved' AND NEW.state IN ('submitting', 'cancelled'))
    OR (OLD.state = 'submitting' AND NEW.state IN ('completed', 'reconciling', 'failed_confirmed'))
    OR (OLD.state = 'reconciling' AND NEW.state IN ('completed', 'failed_confirmed'))
  ) THEN
    RAISE EXCEPTION 'invalid interim v1 approval transition'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION interim_v1_guard_transfer_intent_update()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'interim v1 transfer intents cannot be deleted'
      USING ERRCODE = '55000';
  END IF;
  IF to_jsonb(OLD) - ARRAY[
      'state', 'stripe_transfer_id', 'last_provider_request_id',
      'last_error_class', 'last_error_code', 'updated_at', 'completed_at'
    ]::text[]
    <> to_jsonb(NEW) - ARRAY[
      'state', 'stripe_transfer_id', 'last_provider_request_id',
      'last_error_class', 'last_error_code', 'updated_at', 'completed_at'
    ]::text[]
  THEN
    RAISE EXCEPTION 'interim v1 transfer identity is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF OLD.stripe_transfer_id IS NOT NULL
    AND OLD.stripe_transfer_id IS DISTINCT FROM NEW.stripe_transfer_id
  THEN
    RAISE EXCEPTION 'interim v1 Stripe transfer identity cannot be replaced'
      USING ERRCODE = '55000';
  END IF;
  IF NOT (
    OLD.state = NEW.state
    OR (OLD.state = 'planned' AND NEW.state = 'submitting')
    OR (OLD.state = 'submitting' AND NEW.state IN ('completed', 'reconciling', 'failed_confirmed'))
    OR (OLD.state = 'reconciling' AND NEW.state IN ('completed', 'failed_confirmed', 'manual_review'))
  ) THEN
    RAISE EXCEPTION 'invalid interim v1 transfer intent transition'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS connect_v1_account_intents_guard
  ON connect_v1_account_creation_intents;
CREATE TRIGGER connect_v1_account_intents_guard
  BEFORE UPDATE OR DELETE ON connect_v1_account_creation_intents
  FOR EACH ROW EXECUTE FUNCTION interim_v1_guard_account_intent_update();

DROP TRIGGER IF EXISTS connect_v1_account_attempts_append_only
  ON connect_v1_account_creation_attempts;
CREATE TRIGGER connect_v1_account_attempts_append_only
  BEFORE UPDATE OR DELETE ON connect_v1_account_creation_attempts
  FOR EACH ROW EXECUTE FUNCTION interim_v1_forbid_append_only_change();

DROP TRIGGER IF EXISTS interim_v1_controls_guard
  ON interim_v1_instructor_controls;
CREATE TRIGGER interim_v1_controls_guard
  BEFORE UPDATE OR DELETE ON interim_v1_instructor_controls
  FOR EACH ROW EXECUTE FUNCTION interim_v1_guard_control_update();

DROP TRIGGER IF EXISTS interim_v1_funding_evidence_guard
  ON interim_v1_funding_evidence;
CREATE TRIGGER interim_v1_funding_evidence_guard
  BEFORE UPDATE OR DELETE ON interim_v1_funding_evidence
  FOR EACH ROW EXECUTE FUNCTION interim_v1_guard_funding_evidence_update();

DROP TRIGGER IF EXISTS interim_v1_payout_approvals_guard
  ON interim_v1_payout_approvals;
CREATE TRIGGER interim_v1_payout_approvals_guard
  BEFORE UPDATE OR DELETE ON interim_v1_payout_approvals
  FOR EACH ROW EXECUTE FUNCTION interim_v1_guard_approval_update();

DROP TRIGGER IF EXISTS interim_v1_transfer_intents_guard
  ON interim_v1_transfer_intents;
CREATE TRIGGER interim_v1_transfer_intents_guard
  BEFORE UPDATE OR DELETE ON interim_v1_transfer_intents
  FOR EACH ROW EXECUTE FUNCTION interim_v1_guard_transfer_intent_update();

DROP TRIGGER IF EXISTS interim_v1_transfer_attempts_append_only
  ON interim_v1_transfer_attempts;
CREATE TRIGGER interim_v1_transfer_attempts_append_only
  BEFORE UPDATE OR DELETE ON interim_v1_transfer_attempts
  FOR EACH ROW EXECUTE FUNCTION interim_v1_forbid_append_only_change();

-- Learner Packages Phase 1: inert, versioned catalogue only.
-- The strict school feature flag is not seeded, so it defaults off.

CREATE TABLE IF NOT EXISTS package_products (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  slug TEXT NOT NULL,
  product_type TEXT NOT NULL CHECK (product_type IN (
    'flexible_hours', 'guaranteed_phase', 'full_curriculum', 'manoeuvres'
  )),
  prerequisite_product_id BIGINT,
  visible BOOLEAN NOT NULL DEFAULT TRUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, slug),
  CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CHECK (prerequisite_product_id IS NULL OR prerequisite_product_id <> id),
  FOREIGN KEY (prerequisite_product_id, school_id)
    REFERENCES package_products(id, school_id)
);

CREATE INDEX IF NOT EXISTS idx_package_products_school_catalogue
  ON package_products(school_id, active, visible, sort_order, id);

CREATE INDEX IF NOT EXISTS idx_package_products_prerequisite
  ON package_products(prerequisite_product_id, school_id)
  WHERE prerequisite_product_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS package_product_versions (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  product_id BIGINT NOT NULL,
  version_number INTEGER NOT NULL,
  price_pence INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'GBP',
  content JSONB NOT NULL,
  customer_terms_version TEXT NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL,
  created_by_actor_type TEXT CHECK (created_by_actor_type IS NULL OR created_by_actor_type IN ('admin', 'superadmin', 'instructor_admin')),
  created_by_actor_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, product_id, version_number),
  FOREIGN KEY (product_id, school_id)
    REFERENCES package_products(id, school_id),
  CHECK (version_number > 0),
  CHECK (price_pence > 0),
  CHECK (currency = 'GBP'),
  CHECK (jsonb_typeof(content) = 'object'),
  CHECK (char_length(BTRIM(customer_terms_version)) BETWEEN 1 AND 120)
);

CREATE INDEX IF NOT EXISTS idx_package_versions_effective
  ON package_product_versions(school_id, product_id, effective_from DESC, version_number DESC);

CREATE OR REPLACE FUNCTION package_product_versions_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'package product versions are immutable; create a new version instead'
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_package_product_versions_immutable
  ON package_product_versions;
CREATE TRIGGER trg_package_product_versions_immutable
BEFORE UPDATE OR DELETE ON package_product_versions
FOR EACH ROW EXECUTE FUNCTION package_product_versions_immutable();

CREATE OR REPLACE FUNCTION seed_learner_package_catalogue(target_school_id INTEGER)
RETURNS VOID AS $$
BEGIN
  INSERT INTO package_products (school_id, slug, product_type, visible, active, sort_order)
  VALUES
    (target_school_id, 'flexible-30-hours', 'flexible_hours', TRUE, TRUE, 10),
    (target_school_id, 'phase-1-fundamental', 'guaranteed_phase', TRUE, TRUE, 20),
    (target_school_id, 'phase-2-intermediate', 'guaranteed_phase', TRUE, TRUE, 30),
    (target_school_id, 'phase-3-independent', 'guaranteed_phase', TRUE, TRUE, 40),
    (target_school_id, 'full-curriculum', 'full_curriculum', TRUE, TRUE, 50),
    (target_school_id, 'manoeuvres', 'manoeuvres', TRUE, TRUE, 60),
    (target_school_id, 'manoeuvres-challenge', 'manoeuvres', TRUE, TRUE, 70)
  ON CONFLICT (school_id, slug) DO NOTHING;

  UPDATE package_products child
     SET prerequisite_product_id = parent.id,
         updated_at = NOW()
    FROM package_products parent
   WHERE child.school_id = target_school_id
     AND parent.school_id = target_school_id
     AND (
       (child.slug = 'phase-2-intermediate' AND parent.slug = 'phase-1-fundamental')
       OR (child.slug = 'phase-3-independent' AND parent.slug = 'phase-2-intermediate')
     )
     AND child.prerequisite_product_id IS DISTINCT FROM parent.id;

  INSERT INTO package_product_versions (
    school_id, product_id, version_number, price_pence, currency, content,
    customer_terms_version, effective_from
  )
  SELECT
    p.school_id,
    p.id,
    1,
    CASE p.slug
      WHEN 'flexible-30-hours' THEN 165000
      WHEN 'phase-1-fundamental' THEN 75000
      WHEN 'phase-2-intermediate' THEN 45000
      WHEN 'phase-3-independent' THEN 30000
      WHEN 'full-curriculum' THEN 200000
      ELSE 15000
    END,
    'GBP',
    CASE p.slug
      WHEN 'flexible-30-hours' THEN jsonb_build_object(
        'name', '30-hour flexible package',
        'short_description', 'Thirty school-wide lesson hours for ordinary paid lessons.',
        'intent', 'flexible_hours',
        'highlights', jsonb_build_array('30 school-wide hours', 'Use with any eligible active instructor', 'No expiry at launch', 'Used in half-hour units'),
        'not_included', jsonb_build_array('Named-instructor assignment', 'Transfer to another learner'),
        'entitlement', jsonb_build_object('hours', 30, 'unit_minutes', 30, 'units', 60, 'scope', 'school'),
        'refund_basis', 'Unused half-hour units use this version''s frozen hourly basis; final voluntary fee wording remains under review.',
        'checkout_disclosure', 'Comparison only. Purchase and hour activation are not available in Phase 1.'
      )
      WHEN 'phase-1-fundamental' THEN jsonb_build_object(
        'name', 'Phase 1 Fundamental Driving Course',
        'short_description', 'A structured pathway toward the Phase 1 outcome and an independent assessment.',
        'intent', 'outcome_pathway', 'phase', 1,
        'highlights', jsonb_build_array('Normal teaching sessions are 90 minutes', 'Preferred pace of one or two lessons each week', 'Independent assessment required'),
        'scheduling_promise', 'Payment will eventually precede matching; exact dates and instructor are not confirmed from this catalogue.',
        'assessment_requirement', 'Completion requires a pass recorded by a different in-house assessor.',
        'checkout_disclosure', 'Comparison only. Enrolment, matching, teaching and assessment mutations are not available in Phase 1.'
      )
      WHEN 'phase-2-intermediate' THEN jsonb_build_object(
        'name', 'Phase 2 Intermediate Driving Course',
        'short_description', 'The next structured phase after an independently assessed Phase 1 pass.',
        'intent', 'outcome_pathway', 'phase', 2,
        'highlights', jsonb_build_array('Visible now for pathway planning', 'Independent Phase 1 pass required', 'Independent assessment required'),
        'assessment_requirement', 'Completion requires a pass recorded by a different in-house assessor.',
        'checkout_disclosure', 'Comparison only. Phase eligibility and enrolment mutations are not available in Phase 1.'
      )
      WHEN 'phase-3-independent' THEN jsonb_build_object(
        'name', 'Phase 3 Independent Driving Course',
        'short_description', 'The final structured phase after an independently assessed Phase 2 pass.',
        'intent', 'outcome_pathway', 'phase', 3,
        'highlights', jsonb_build_array('Visible now for pathway planning', 'Independent Phase 2 pass required', 'Independent assessment required'),
        'assessment_requirement', 'Completion requires a pass recorded by a different in-house assessor.',
        'checkout_disclosure', 'Comparison only. Phase eligibility and enrolment mutations are not available in Phase 1.'
      )
      WHEN 'full-curriculum' THEN jsonb_build_object(
        'name', 'Full Curriculum Enrolment',
        'short_description', 'One pathway covering Phases 1-3, Manoeuvres, assessments and second-attempt protection.',
        'intent', 'outcome_pathway',
        'highlights', jsonb_build_array('Phases 1-3', 'Test Ready Manoeuvres', 'Assessments and reassessments', 'Up to 10 additional instructor-led hours after an eligible first test failure'),
        'not_included', jsonb_build_array('DVSA test fees', 'Use of an instructor car for the practical test', 'Tuition beyond the second-attempt allowance'),
        'checkout_disclosure', 'Comparison only. Final participation, second-attempt and customer terms must be approved before enrolment opens.'
      )
      WHEN 'manoeuvres' THEN jsonb_build_object(
        'name', 'Manoeuvres',
        'short_description', 'Three directly booked one-hour specialist sessions, with no promotional tasks.',
        'intent', 'manoeuvres', 'variant', 'ordinary',
        'highlights', jsonb_build_array('Three one-hour sessions', 'No promotional obligations', 'Three immutable GBP 50 session units for future accounting'),
        'checkout_disclosure', 'Comparison only. Session units and direct booking are not available in Phase 1.'
      )
      ELSE jsonb_build_object(
        'name', 'Manoeuvres Challenge',
        'short_description', 'The same three specialist sessions with optional promotional tasks and a possible reward.',
        'intent', 'manoeuvres', 'variant', 'challenge',
        'highlights', jsonb_build_array('Three one-hour sessions', 'Promotional participation is optional', 'Qualifying reward choice: original-method refund or programme credit'),
        'not_included', jsonb_build_array('Automatic qualification before final campaign rules', 'CoachCarter reuse of learner content without separate permission'),
        'checkout_disclosure', 'Comparison only. Challenge rules, safeguards, evidence and rewards must be approved before this choice opens.'
      )
    END,
    'learner-packages-catalogue-v1-draft',
    TIMESTAMPTZ '2026-08-13 00:00:00+00'
  FROM package_products p
  WHERE p.school_id = target_school_id
    AND p.slug IN (
      'flexible-30-hours', 'phase-1-fundamental', 'phase-2-intermediate',
      'phase-3-independent', 'full-curriculum', 'manoeuvres', 'manoeuvres-challenge'
    )
  ON CONFLICT (school_id, product_id, version_number) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

SELECT seed_learner_package_catalogue(id) FROM schools;

CREATE OR REPLACE FUNCTION seed_learner_packages_for_new_school()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM seed_learner_package_catalogue(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_seed_learner_packages_for_new_school ON schools;
CREATE TRIGGER trg_seed_learner_packages_for_new_school
AFTER INSERT ON schools
FOR EACH ROW EXECUTE FUNCTION seed_learner_packages_for_new_school();

-- Learner Packages Phase 2: durable test-mode payment-attempt evidence only.
-- Kept in sync with db/migrations/045_learner_packages_payment_foundation.sql.
-- The purchasing flag remains absent/default-off and this schema creates no
-- entitlement, balance, enrolment, refund, reward, earning, or payout rows.

CREATE UNIQUE INDEX IF NOT EXISTS uq_package_versions_id_school_product
  ON package_product_versions(id, school_id, product_id);

CREATE TABLE IF NOT EXISTS package_purchase_attempts (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  -- Present while the learner account exists; one-way nullification is the
  -- only permitted snapshot change so retained financial evidence is GDPR-safe.
  learner_id INTEGER,
  product_id BIGINT NOT NULL,
  product_version_id BIGINT NOT NULL,
  product_slug TEXT NOT NULL,
  product_name TEXT NOT NULL,
  product_description TEXT NOT NULL DEFAULT '',
  product_snapshot JSONB NOT NULL,
  amount_pence INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'GBP',
  customer_terms_version TEXT NOT NULL,
  stripe_mode TEXT NOT NULL DEFAULT 'test',
  status TEXT NOT NULL DEFAULT 'created',
  client_request_id UUID NOT NULL,
  idempotency_key TEXT NOT NULL,
  stripe_checkout_session_id TEXT,
  stripe_payment_intent_id TEXT,
  stripe_charge_id TEXT,
  stripe_checkout_url TEXT,
  provider_expires_at TIMESTAMPTZ,
  review_after TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  submission_started_at TIMESTAMPTZ,
  checkout_created_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  expired_at TIMESTAMPTZ,
  review_required_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  last_provider_event_id TEXT,
  last_provider_event_type TEXT,
  last_provider_event_created_at TIMESTAMPTZ,
  failure_code TEXT,
  failure_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, learner_id, client_request_id),
  UNIQUE (idempotency_key),
  UNIQUE (stripe_checkout_session_id),
  UNIQUE (stripe_payment_intent_id),
  FOREIGN KEY (learner_id, school_id)
    REFERENCES learner_users(id, school_id) ON DELETE SET NULL (learner_id),
  FOREIGN KEY (product_id, school_id) REFERENCES package_products(id, school_id),
  FOREIGN KEY (product_version_id, school_id, product_id)
    REFERENCES package_product_versions(id, school_id, product_id),
  CHECK (jsonb_typeof(product_snapshot) = 'object'),
  CHECK (amount_pence BETWEEN 50 AND 1000000),
  CHECK (currency = 'GBP'),
  CHECK (stripe_mode = 'test'),
  CHECK (status IN ('created','submitting','pending','paid','failed','expired','review_required','refunded')),
  CHECK (char_length(BTRIM(product_slug)) BETWEEN 1 AND 120),
  CHECK (char_length(BTRIM(product_name)) BETWEEN 1 AND 240),
  CHECK (char_length(BTRIM(customer_terms_version)) BETWEEN 1 AND 120),
  CHECK (idempotency_key ~ '^cc-package-test-checkout-[0-9a-f-]{36}$'),
  CHECK (stripe_checkout_session_id IS NULL OR stripe_checkout_session_id ~ '^cs_test_[A-Za-z0-9_]+$'),
  CHECK (stripe_payment_intent_id IS NULL OR stripe_payment_intent_id ~ '^pi_[A-Za-z0-9_]+$'),
  CHECK (stripe_charge_id IS NULL OR stripe_charge_id ~ '^ch_[A-Za-z0-9_]+$'),
  CHECK (failure_code IS NULL OR failure_code ~ '^[A-Z0-9_]{1,100}$'),
  CHECK (failure_message IS NULL OR char_length(failure_message) <= 500),
  CHECK (stripe_checkout_url IS NULL OR char_length(stripe_checkout_url) <= 4096)
);

CREATE INDEX IF NOT EXISTS idx_package_attempts_learner_status
  ON package_purchase_attempts(school_id, learner_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_package_attempts_review_queue
  ON package_purchase_attempts(school_id, review_after, created_at)
  WHERE status IN ('submitting', 'pending', 'review_required');
CREATE INDEX IF NOT EXISTS idx_package_attempts_product_version
  ON package_purchase_attempts(school_id, product_id, product_version_id, created_at DESC);
DROP INDEX IF EXISTS uq_package_attempts_active_product;
CREATE UNIQUE INDEX uq_package_attempts_active_product
  ON package_purchase_attempts(school_id, learner_id, product_id)
  WHERE status IN ('created', 'submitting', 'pending', 'paid', 'review_required');

CREATE TABLE IF NOT EXISTS package_payment_events (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  attempt_id UUID NOT NULL,
  stripe_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  stripe_object_id TEXT NOT NULL,
  livemode BOOLEAN NOT NULL,
  payload_sha256 TEXT NOT NULL,
  provider_created_at TIMESTAMPTZ,
  processing_state TEXT NOT NULL DEFAULT 'processing',
  delivery_count INTEGER NOT NULL DEFAULT 1,
  first_received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  failure_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (stripe_event_id),
  FOREIGN KEY (attempt_id, school_id) REFERENCES package_purchase_attempts(id, school_id),
  CHECK (livemode = FALSE),
  CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (processing_state IN ('processing','processed','failed')),
  CHECK (delivery_count > 0),
  CHECK (failure_code IS NULL OR failure_code ~ '^[A-Z0-9_]{1,100}$')
);
CREATE INDEX IF NOT EXISTS idx_package_payment_events_attempt
  ON package_payment_events(school_id, attempt_id, provider_created_at, id);
CREATE INDEX IF NOT EXISTS idx_package_payment_events_failed
  ON package_payment_events(school_id, last_received_at)
  WHERE processing_state = 'failed';

CREATE TABLE IF NOT EXISTS package_purchase_attempt_state_events (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  attempt_id UUID NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  source TEXT NOT NULL,
  stripe_event_id TEXT,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  FOREIGN KEY (attempt_id, school_id) REFERENCES package_purchase_attempts(id, school_id),
  CHECK (from_status IS NULL OR from_status IN ('created','submitting','pending','paid','failed','expired','review_required','refunded')),
  CHECK (to_status IN ('created','submitting','pending','paid','failed','expired','review_required','refunded')),
  CHECK (source IN ('checkout_api','package_webhook','reconciliation','system')),
  CHECK (jsonb_typeof(detail) = 'object')
);
CREATE INDEX IF NOT EXISTS idx_package_attempt_state_events_attempt
  ON package_purchase_attempt_state_events(school_id, attempt_id, id);

CREATE OR REPLACE FUNCTION guard_package_purchase_attempt_change()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'package purchase attempts are retained financial evidence' USING ERRCODE = '55000';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.school_id IS DISTINCT FROM OLD.school_id
     OR (
       NEW.learner_id IS DISTINCT FROM OLD.learner_id
       AND NOT (OLD.learner_id IS NOT NULL AND NEW.learner_id IS NULL)
     ) OR NEW.product_id IS DISTINCT FROM OLD.product_id
     OR NEW.product_version_id IS DISTINCT FROM OLD.product_version_id OR NEW.product_slug IS DISTINCT FROM OLD.product_slug
     OR NEW.product_name IS DISTINCT FROM OLD.product_name OR NEW.product_description IS DISTINCT FROM OLD.product_description
     OR NEW.product_snapshot IS DISTINCT FROM OLD.product_snapshot OR NEW.amount_pence IS DISTINCT FROM OLD.amount_pence
     OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.customer_terms_version IS DISTINCT FROM OLD.customer_terms_version
     OR NEW.stripe_mode IS DISTINCT FROM OLD.stripe_mode OR NEW.client_request_id IS DISTINCT FROM OLD.client_request_id
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'package purchase attempt snapshots are immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.stripe_checkout_session_id IS NOT NULL AND NEW.stripe_checkout_session_id IS DISTINCT FROM OLD.stripe_checkout_session_id THEN
    RAISE EXCEPTION 'package checkout identity cannot be replaced' USING ERRCODE = '55000';
  END IF;
  IF OLD.stripe_payment_intent_id IS NOT NULL AND NEW.stripe_payment_intent_id IS DISTINCT FROM OLD.stripe_payment_intent_id THEN
    RAISE EXCEPTION 'package payment intent identity cannot be replaced' USING ERRCODE = '55000';
  END IF;
  IF OLD.stripe_charge_id IS NOT NULL AND NEW.stripe_charge_id IS DISTINCT FROM OLD.stripe_charge_id THEN
    RAISE EXCEPTION 'package charge identity cannot be replaced' USING ERRCODE = '55000';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status = 'created' AND NEW.status IN ('submitting','review_required','failed','paid'))
    OR (OLD.status = 'submitting' AND NEW.status IN ('pending','review_required','failed','expired','paid'))
    OR (OLD.status = 'pending' AND NEW.status IN ('review_required','failed','expired','paid'))
    OR (OLD.status = 'failed' AND NEW.status IN ('paid','review_required'))
    OR (OLD.status = 'expired' AND NEW.status IN ('paid','review_required'))
    OR (OLD.status = 'review_required' AND NEW.status IN ('pending','failed','expired','paid'))
    OR (OLD.status = 'paid' AND NEW.status = 'refunded')
  ) THEN
    RAISE EXCEPTION 'invalid package purchase attempt status transition: % -> %', OLD.status, NEW.status USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_guard_package_purchase_attempt_change ON package_purchase_attempts;
CREATE TRIGGER trg_guard_package_purchase_attempt_change
BEFORE UPDATE OR DELETE ON package_purchase_attempts
FOR EACH ROW EXECUTE FUNCTION guard_package_purchase_attempt_change();

CREATE OR REPLACE FUNCTION guard_package_payment_event_change()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'package payment events are retained evidence' USING ERRCODE = '55000';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.school_id IS DISTINCT FROM OLD.school_id
     OR NEW.attempt_id IS DISTINCT FROM OLD.attempt_id OR NEW.stripe_event_id IS DISTINCT FROM OLD.stripe_event_id
     OR NEW.event_type IS DISTINCT FROM OLD.event_type OR NEW.stripe_object_id IS DISTINCT FROM OLD.stripe_object_id
     OR NEW.livemode IS DISTINCT FROM OLD.livemode OR NEW.payload_sha256 IS DISTINCT FROM OLD.payload_sha256
     OR NEW.provider_created_at IS DISTINCT FROM OLD.provider_created_at OR NEW.first_received_at IS DISTINCT FROM OLD.first_received_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'package payment event provider evidence is immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.processing_state IS DISTINCT FROM OLD.processing_state AND NOT (
    (OLD.processing_state = 'processing' AND NEW.processing_state IN ('processed','failed'))
    OR (OLD.processing_state = 'failed' AND NEW.processing_state = 'processing')
  ) THEN
    RAISE EXCEPTION 'invalid package payment event transition: % -> %', OLD.processing_state, NEW.processing_state USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_guard_package_payment_event_change ON package_payment_events;
CREATE TRIGGER trg_guard_package_payment_event_change
BEFORE UPDATE OR DELETE ON package_payment_events
FOR EACH ROW EXECUTE FUNCTION guard_package_payment_event_change();

CREATE OR REPLACE FUNCTION forbid_package_attempt_state_event_change()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'package purchase attempt state events are append-only' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_package_attempt_state_events_append_only ON package_purchase_attempt_state_events;
CREATE TRIGGER trg_package_attempt_state_events_append_only
BEFORE UPDATE OR DELETE ON package_purchase_attempt_state_events
FOR EACH ROW EXECUTE FUNCTION forbid_package_attempt_state_event_change();
-- Learner Packages commercial revision: Full Curriculum test-mode foundation.
--
-- This migration is additive and does not enable either package feature flag.
-- It creates no Lesson Credit, refund, instructor earning, transfer or payout.

CREATE OR REPLACE FUNCTION reconcile_learner_package_catalogue(target_school_id INTEGER)
RETURNS VOID AS $$
DECLARE
  curriculum_product_id BIGINT;
BEGIN
  UPDATE package_products
     SET active = FALSE, visible = FALSE, updated_at = NOW()
   WHERE school_id = target_school_id
     AND slug IN ('phase-1-fundamental', 'phase-2-intermediate', 'phase-3-independent');

  UPDATE package_products
     SET active = TRUE, visible = TRUE, prerequisite_product_id = NULL, updated_at = NOW()
   WHERE school_id = target_school_id
     AND slug = 'full-curriculum'
  RETURNING id INTO curriculum_product_id;

  IF curriculum_product_id IS NOT NULL THEN
    INSERT INTO package_product_versions (
      school_id, product_id, version_number, price_pence, currency, content,
      customer_terms_version, effective_from
    )
    SELECT
      target_school_id,
      curriculum_product_id,
      COALESCE(MAX(version_number), 0) + 1,
      200000,
      'GBP',
      jsonb_build_object(
        'name', 'Full Curriculum',
        'short_description', 'A structured weekly programme to the learner''s verified first practical test, with internal assessment stages and one-retake protection.',
        'intent', 'full_curriculum',
        'highlights', jsonb_build_array(
          'One 90-minute lesson opportunity per programme week',
          'Ends at the verified first-test date or 24 programme weeks, whichever comes first',
          'Internal Phase 1, 2 and 3 progress with an independent assessor',
          'Up to 10 additional lesson hours for one eligible retake'
        ),
        'eligibility', jsonb_build_object(
          'requires_verified_future_dvsa_practical_car_test', true,
          'manual_admin_verification', true,
          'minimum_lead_time_days', null
        ),
        'programme', jsonb_build_object(
          'weekly_opportunity_minutes', 90,
          'maximum_weeks', 24,
          'matching_deadline_days', 7,
          'internal_phases', jsonb_build_array(1, 2, 3),
          'independent_assessor_required', true
        ),
        'retake', jsonb_build_object(
          'maximum_minutes', 600,
          'opens_days_before_second_test', 28,
          'allowed_lesson_minutes', jsonb_build_array(90, 120),
          'expires_when_second_test_begins', true,
          'third_attempt_included', false
        ),
        'not_included', jsonb_build_array(
          'DVSA test fees',
          'Use of an instructor car for the practical test',
          'Automatic extra weeks for learner-requested postponements',
          'Protection for a third test attempt'
        ),
        'checkout_disclosure', 'Test-mode checkout only. Exact lesson dates and instructors are agreed during matching; payment confirmation comes only from Stripe webhook evidence.'
      ),
      'full-curriculum-pilot-v2-test',
      TIMESTAMPTZ '2026-08-13 00:00:00+00'
    FROM package_product_versions
    WHERE school_id = target_school_id
      AND product_id = curriculum_product_id
    HAVING NOT EXISTS (
      SELECT 1
        FROM package_product_versions existing
       WHERE existing.school_id = target_school_id
         AND existing.product_id = curriculum_product_id
         AND existing.customer_terms_version = 'full-curriculum-pilot-v2-test'
    );
  END IF;
END;
$$ LANGUAGE plpgsql;

SELECT reconcile_learner_package_catalogue(id) FROM schools;

CREATE OR REPLACE FUNCTION seed_learner_packages_for_new_school()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM seed_learner_package_catalogue(NEW.id);
  PERFORM reconcile_learner_package_catalogue(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS full_curriculum_test_bookings (
  id                    BIGSERIAL PRIMARY KEY,
  school_id             INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  learner_id            INTEGER,
  attempt_number        INTEGER NOT NULL DEFAULT 1,
  test_date             DATE NOT NULL,
  test_time             TIME NOT NULL,
  test_centre           TEXT,
  verification_status   TEXT NOT NULL DEFAULT 'pending',
  verified_by_actor_type TEXT,
  verified_by_admin_id  INTEGER,
  verified_at           TIMESTAMPTZ,
  verification_reason   TEXT,
  superseded_at         TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (id, school_id, learner_id),
  FOREIGN KEY (learner_id, school_id)
    REFERENCES learner_users(id, school_id) ON DELETE SET NULL (learner_id),
  CHECK (attempt_number IN (1, 2)),
  CHECK (verification_status IN ('pending', 'verified', 'rejected', 'superseded')),
  CHECK (test_centre IS NULL OR char_length(BTRIM(test_centre)) BETWEEN 2 AND 160),
  CHECK (verification_reason IS NULL OR char_length(BTRIM(verification_reason)) BETWEEN 2 AND 1000),
  CHECK (
    (verification_status = 'verified' AND verified_by_actor_type IS NOT NULL AND verified_by_admin_id IS NOT NULL AND verified_at IS NOT NULL)
    OR verification_status <> 'verified'
  ),
  CHECK (verified_by_actor_type IS NULL OR verified_by_actor_type IN ('admin', 'superadmin', 'instructor_admin'))
);

CREATE INDEX IF NOT EXISTS idx_full_curriculum_test_bookings_learner
  ON full_curriculum_test_bookings(school_id, learner_id, attempt_number, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_full_curriculum_test_bookings_verification
  ON full_curriculum_test_bookings(school_id, verification_status, test_date, test_time);
CREATE INDEX IF NOT EXISTS idx_full_curriculum_test_bookings_verifier
  ON full_curriculum_test_bookings(verified_by_admin_id);

ALTER TABLE package_purchase_attempts
  ADD COLUMN IF NOT EXISTS full_curriculum_test_booking_id BIGINT,
  ADD COLUMN IF NOT EXISTS eligibility_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS stripe_payment_method_configuration_id TEXT;

DO $$ BEGIN
  ALTER TABLE package_purchase_attempts
    ADD CONSTRAINT package_attempts_payment_configuration_check
    CHECK (stripe_payment_method_configuration_id IS NULL OR stripe_payment_method_configuration_id ~ '^pmc_[A-Za-z0-9]+$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_package_attempts_full_curriculum_test_booking
  ON package_purchase_attempts(school_id, full_curriculum_test_booking_id)
  WHERE full_curriculum_test_booking_id IS NOT NULL;

DO $$ BEGIN
  ALTER TABLE package_purchase_attempts
    ADD CONSTRAINT package_attempts_full_curriculum_test_booking_fkey
    FOREIGN KEY (full_curriculum_test_booking_id, school_id, learner_id)
    REFERENCES full_curriculum_test_bookings(id, school_id, learner_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS learner_package_purchases (
  id                         BIGSERIAL PRIMARY KEY,
  school_id                  INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  learner_id                 INTEGER,
  attempt_id                 UUID NOT NULL,
  product_id                 BIGINT NOT NULL,
  product_version_id         BIGINT NOT NULL,
  product_slug               TEXT NOT NULL,
  product_snapshot           JSONB NOT NULL,
  amount_pence               INTEGER NOT NULL,
  currency                   TEXT NOT NULL,
  customer_terms_version     TEXT NOT NULL,
  stripe_mode                TEXT NOT NULL,
  stripe_checkout_session_id TEXT NOT NULL,
  stripe_payment_intent_id   TEXT,
  paid_at                    TIMESTAMPTZ NOT NULL,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (attempt_id),
  FOREIGN KEY (learner_id, school_id)
    REFERENCES learner_users(id, school_id) ON DELETE SET NULL (learner_id),
  FOREIGN KEY (attempt_id, school_id)
    REFERENCES package_purchase_attempts(id, school_id),
  FOREIGN KEY (product_id, school_id)
    REFERENCES package_products(id, school_id),
  FOREIGN KEY (product_version_id, school_id, product_id)
    REFERENCES package_product_versions(id, school_id, product_id),
  CHECK (amount_pence > 0),
  CHECK (currency = 'GBP'),
  CHECK (stripe_mode = 'test'),
  CHECK (product_slug = 'full-curriculum'),
  CHECK (jsonb_typeof(product_snapshot) = 'object'),
  CHECK (stripe_checkout_session_id ~ '^cs_test_[A-Za-z0-9_]+$')
);

CREATE INDEX IF NOT EXISTS idx_learner_package_purchases_learner
  ON learner_package_purchases(school_id, learner_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_learner_package_purchases_version
  ON learner_package_purchases(school_id, product_id, product_version_id);

CREATE TABLE IF NOT EXISTS full_curriculum_enrolments (
  id                         BIGSERIAL PRIMARY KEY,
  school_id                  INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  learner_id                 INTEGER,
  purchase_id                BIGINT NOT NULL,
  first_test_booking_id      BIGINT NOT NULL,
  status                     TEXT NOT NULL DEFAULT 'paid_matching',
  current_phase              INTEGER NOT NULL DEFAULT 1,
  matching_deadline          TIMESTAMPTZ NOT NULL,
  programme_start_at         TIMESTAMPTZ,
  original_first_test_at     TIMESTAMPTZ NOT NULL,
  current_first_test_at      TIMESTAMPTZ NOT NULL,
  twenty_four_week_cap_at    TIMESTAMPTZ,
  base_entitlement_end_at    TIMESTAMPTZ,
  approved_entitlement_end_at TIMESTAMPTZ,
  start_set_by_actor_type    TEXT,
  start_set_by_actor_id      INTEGER,
  start_set_at               TIMESTAMPTZ,
  completed_at               TIMESTAMPTZ,
  withdrawn_at               TIMESTAMPTZ,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (purchase_id),
  FOREIGN KEY (learner_id, school_id)
    REFERENCES learner_users(id, school_id) ON DELETE SET NULL (learner_id),
  FOREIGN KEY (purchase_id, school_id)
    REFERENCES learner_package_purchases(id, school_id),
  FOREIGN KEY (first_test_booking_id, school_id)
    REFERENCES full_curriculum_test_bookings(id, school_id),
  CHECK (status IN ('paid_matching', 'active', 'assessment_pending', 'retake_pending', 'retake_active', 'completed', 'withdrawn')),
  CHECK (current_phase BETWEEN 1 AND 3),
  CHECK (status <> 'paid_matching' OR programme_start_at IS NULL),
  CHECK (status NOT IN ('active', 'assessment_pending', 'retake_pending', 'retake_active', 'completed') OR programme_start_at IS NOT NULL),
  CHECK (
    (programme_start_at IS NULL AND twenty_four_week_cap_at IS NULL
      AND base_entitlement_end_at IS NULL AND approved_entitlement_end_at IS NULL
      AND start_set_by_actor_type IS NULL AND start_set_by_actor_id IS NULL AND start_set_at IS NULL)
    OR
    (programme_start_at IS NOT NULL AND twenty_four_week_cap_at IS NOT NULL
      AND base_entitlement_end_at IS NOT NULL AND approved_entitlement_end_at IS NOT NULL
      AND start_set_by_actor_type IS NOT NULL AND start_set_by_actor_id IS NOT NULL AND start_set_at IS NOT NULL)
  ),
  CHECK (programme_start_at IS NULL OR original_first_test_at > programme_start_at),
  CHECK (base_entitlement_end_at IS NULL OR base_entitlement_end_at = LEAST(original_first_test_at, twenty_four_week_cap_at)),
  CHECK (approved_entitlement_end_at IS NULL OR approved_entitlement_end_at >= base_entitlement_end_at),
  CHECK (start_set_by_actor_type IS NULL OR start_set_by_actor_type IN ('admin', 'superadmin', 'instructor', 'instructor_admin'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_full_curriculum_active_learner
  ON full_curriculum_enrolments(school_id, learner_id)
  WHERE learner_id IS NOT NULL
    AND status IN ('paid_matching', 'active', 'assessment_pending', 'retake_pending', 'retake_active');
CREATE INDEX IF NOT EXISTS idx_full_curriculum_enrolments_matching
  ON full_curriculum_enrolments(school_id, status, matching_deadline);
CREATE INDEX IF NOT EXISTS idx_full_curriculum_enrolments_test_booking
  ON full_curriculum_enrolments(school_id, first_test_booking_id);

CREATE TABLE IF NOT EXISTS full_curriculum_weekly_opportunities (
  id                    BIGSERIAL PRIMARY KEY,
  school_id             INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  enrolment_id          BIGINT NOT NULL,
  programme_week        INTEGER NOT NULL,
  week_start_at         TIMESTAMPTZ NOT NULL,
  week_end_at           TIMESTAMPTZ NOT NULL,
  opportunity_minutes   INTEGER NOT NULL DEFAULT 90,
  status                TEXT NOT NULL DEFAULT 'available',
  status_reason          TEXT,
  updated_by_actor_type  TEXT,
  updated_by_actor_id    INTEGER,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, enrolment_id, programme_week),
  FOREIGN KEY (enrolment_id, school_id)
    REFERENCES full_curriculum_enrolments(id, school_id),
  CHECK (programme_week > 0),
  CHECK (opportunity_minutes = 90),
  CHECK (week_end_at > week_start_at),
  CHECK (status IN ('available', 'booked', 'used', 'used_late_cancel', 'unused', 'replacement_required', 'waived'))
);

CREATE INDEX IF NOT EXISTS idx_full_curriculum_weeks_window
  ON full_curriculum_weekly_opportunities(school_id, enrolment_id, week_start_at, week_end_at);

CREATE TABLE IF NOT EXISTS full_curriculum_progress_events (
  id                  BIGSERIAL PRIMARY KEY,
  school_id           INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  enrolment_id        BIGINT NOT NULL,
  phase_number        INTEGER,
  event_type          TEXT NOT NULL,
  actor_type          TEXT NOT NULL,
  actor_id            INTEGER,
  detail              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  FOREIGN KEY (enrolment_id, school_id)
    REFERENCES full_curriculum_enrolments(id, school_id),
  CHECK (phase_number IS NULL OR phase_number BETWEEN 1 AND 3),
  CHECK (event_type IN (
    'enrolment_created', 'matching_completed', 'programme_started', 'ready_for_assessment',
    'assessment_passed', 'assessment_not_passed', 'phase_advanced',
    'weekly_outcome', 'test_date_changed', 'extension_approved',
    'retake_activated', 'retake_consumed', 'completed', 'withdrawn'
  )),
  CHECK (actor_type IN ('system', 'admin', 'superadmin', 'instructor', 'instructor_admin')),
  CHECK (jsonb_typeof(detail) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_full_curriculum_progress_timeline
  ON full_curriculum_progress_events(school_id, enrolment_id, id);

CREATE TABLE IF NOT EXISTS full_curriculum_assessments (
  id                     BIGSERIAL PRIMARY KEY,
  school_id              INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  enrolment_id           BIGINT NOT NULL,
  phase_number           INTEGER NOT NULL,
  teaching_instructor_id INTEGER NOT NULL,
  assessor_instructor_id INTEGER NOT NULL,
  outcome                TEXT NOT NULL,
  improvement_areas      TEXT,
  recorded_by_actor_type TEXT NOT NULL,
  recorded_by_actor_id   INTEGER,
  assessed_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  FOREIGN KEY (enrolment_id, school_id)
    REFERENCES full_curriculum_enrolments(id, school_id),
  FOREIGN KEY (teaching_instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  FOREIGN KEY (assessor_instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  CHECK (phase_number BETWEEN 1 AND 3),
  CHECK (teaching_instructor_id <> assessor_instructor_id),
  CHECK (outcome IN ('passed', 'improvement_required')),
  CHECK (outcome = 'passed' OR char_length(BTRIM(COALESCE(improvement_areas, ''))) >= 2),
  CHECK (recorded_by_actor_type IN ('admin', 'superadmin', 'instructor', 'instructor_admin'))
);

CREATE INDEX IF NOT EXISTS idx_full_curriculum_assessments_enrolment
  ON full_curriculum_assessments(school_id, enrolment_id, phase_number, assessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_full_curriculum_assessments_teacher
  ON full_curriculum_assessments(school_id, teaching_instructor_id, assessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_full_curriculum_assessments_assessor
  ON full_curriculum_assessments(school_id, assessor_instructor_id, assessed_at DESC);

CREATE TABLE IF NOT EXISTS full_curriculum_test_date_changes (
  id                    BIGSERIAL PRIMARY KEY,
  school_id             INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  enrolment_id          BIGINT NOT NULL,
  old_test_at           TIMESTAMPTZ NOT NULL,
  new_test_at           TIMESTAMPTZ NOT NULL,
  cause                 TEXT NOT NULL,
  reason                TEXT NOT NULL,
  recorded_by_actor_type TEXT NOT NULL,
  recorded_by_admin_id  INTEGER NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  FOREIGN KEY (enrolment_id, school_id)
    REFERENCES full_curriculum_enrolments(id, school_id),
  CHECK (new_test_at <> old_test_at),
  CHECK (cause IN ('learner_requested', 'dvsa', 'exceptional')),
  CHECK (char_length(BTRIM(reason)) BETWEEN 2 AND 1000),
  CHECK (recorded_by_actor_type IN ('admin', 'superadmin', 'instructor_admin'))
);

CREATE INDEX IF NOT EXISTS idx_full_curriculum_test_date_changes_enrolment
  ON full_curriculum_test_date_changes(school_id, enrolment_id, id);
CREATE INDEX IF NOT EXISTS idx_full_curriculum_test_date_changes_admin
  ON full_curriculum_test_date_changes(recorded_by_admin_id);

CREATE TABLE IF NOT EXISTS full_curriculum_extensions (
  id                    BIGSERIAL PRIMARY KEY,
  school_id             INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  enrolment_id          BIGINT NOT NULL,
  previous_end_at       TIMESTAMPTZ NOT NULL,
  approved_end_at       TIMESTAMPTZ NOT NULL,
  reason_type           TEXT NOT NULL,
  reason                TEXT NOT NULL,
  approved_by_actor_type TEXT NOT NULL,
  approved_by_admin_id  INTEGER NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  FOREIGN KEY (enrolment_id, school_id)
    REFERENCES full_curriculum_enrolments(id, school_id),
  CHECK (approved_end_at > previous_end_at),
  CHECK (reason_type IN ('dvsa_change', 'exceptional_circumstance', 'coachcarter_replacement')),
  CHECK (char_length(BTRIM(reason)) BETWEEN 2 AND 1000),
  CHECK (approved_by_actor_type IN ('admin', 'superadmin', 'instructor_admin'))
);

CREATE INDEX IF NOT EXISTS idx_full_curriculum_extensions_enrolment
  ON full_curriculum_extensions(school_id, enrolment_id, id);
CREATE INDEX IF NOT EXISTS idx_full_curriculum_extensions_admin
  ON full_curriculum_extensions(approved_by_admin_id);

CREATE TABLE IF NOT EXISTS full_curriculum_booking_allocations (
  id                     BIGSERIAL PRIMARY KEY,
  school_id              INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  enrolment_id           BIGINT NOT NULL,
  weekly_opportunity_id  BIGINT,
  lesson_booking_id      INTEGER NOT NULL,
  instructor_id          INTEGER NOT NULL,
  allocation_type        TEXT NOT NULL,
  allocated_minutes      INTEGER NOT NULL,
  created_by_actor_type  TEXT NOT NULL,
  created_by_actor_id    INTEGER,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, lesson_booking_id),
  FOREIGN KEY (enrolment_id, school_id)
    REFERENCES full_curriculum_enrolments(id, school_id),
  FOREIGN KEY (weekly_opportunity_id, school_id)
    REFERENCES full_curriculum_weekly_opportunities(id, school_id),
  FOREIGN KEY (lesson_booking_id, school_id)
    REFERENCES lesson_bookings(id, school_id),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  CHECK (allocation_type IN ('base_lesson', 'assessment', 'retake_lesson')),
  CHECK (
    (allocation_type = 'base_lesson' AND allocated_minutes = 90)
    OR (allocation_type = 'assessment' AND allocated_minutes > 0)
    OR (allocation_type = 'retake_lesson' AND allocated_minutes IN (90, 120))
  ),
  CHECK (created_by_actor_type IN ('admin', 'superadmin', 'instructor', 'instructor_admin'))
);

CREATE INDEX IF NOT EXISTS idx_full_curriculum_allocations_enrolment
  ON full_curriculum_booking_allocations(school_id, enrolment_id, created_at);
CREATE INDEX IF NOT EXISTS idx_full_curriculum_allocations_week
  ON full_curriculum_booking_allocations(school_id, weekly_opportunity_id)
  WHERE weekly_opportunity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_full_curriculum_allocations_instructor
  ON full_curriculum_booking_allocations(school_id, instructor_id, created_at);

CREATE TABLE IF NOT EXISTS full_curriculum_retake_allowances (
  id                    BIGSERIAL PRIMARY KEY,
  school_id             INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  enrolment_id          BIGINT NOT NULL,
  second_test_booking_id BIGINT NOT NULL,
  total_minutes         INTEGER NOT NULL DEFAULT 600,
  opens_at              TIMESTAMPTZ NOT NULL,
  expires_at            TIMESTAMPTZ NOT NULL,
  failed_first_test_evidence TEXT NOT NULL,
  activated_by_actor_type TEXT NOT NULL,
  activated_by_admin_id INTEGER NOT NULL,
  activated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, enrolment_id),
  FOREIGN KEY (enrolment_id, school_id)
    REFERENCES full_curriculum_enrolments(id, school_id),
  FOREIGN KEY (second_test_booking_id, school_id)
    REFERENCES full_curriculum_test_bookings(id, school_id),
  CHECK (total_minutes = 600),
  CHECK (opens_at = expires_at - INTERVAL '28 days'),
  CHECK (expires_at > opens_at),
  CHECK (char_length(BTRIM(failed_first_test_evidence)) BETWEEN 2 AND 1000),
  CHECK (activated_by_actor_type IN ('admin', 'superadmin', 'instructor_admin'))
);

CREATE INDEX IF NOT EXISTS idx_full_curriculum_retake_window
  ON full_curriculum_retake_allowances(school_id, opens_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_full_curriculum_retake_second_test
  ON full_curriculum_retake_allowances(school_id, second_test_booking_id);
CREATE INDEX IF NOT EXISTS idx_full_curriculum_retake_admin
  ON full_curriculum_retake_allowances(activated_by_admin_id);

CREATE TABLE IF NOT EXISTS full_curriculum_retake_window_events (
  id                         BIGSERIAL PRIMARY KEY,
  school_id                  INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  allowance_id               BIGINT NOT NULL,
  new_second_test_booking_id BIGINT NOT NULL,
  previous_opens_at          TIMESTAMPTZ NOT NULL,
  previous_expires_at        TIMESTAMPTZ NOT NULL,
  new_opens_at               TIMESTAMPTZ NOT NULL,
  new_expires_at             TIMESTAMPTZ NOT NULL,
  cause                      TEXT NOT NULL,
  reason                     TEXT NOT NULL,
  recorded_by_actor_type     TEXT NOT NULL,
  recorded_by_admin_id       INTEGER NOT NULL,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  FOREIGN KEY (allowance_id, school_id)
    REFERENCES full_curriculum_retake_allowances(id, school_id),
  FOREIGN KEY (new_second_test_booking_id, school_id)
    REFERENCES full_curriculum_test_bookings(id, school_id),
  CHECK (cause IN ('dvsa', 'exceptional')),
  CHECK (new_opens_at = new_expires_at - INTERVAL '28 days'),
  CHECK (new_expires_at > new_opens_at),
  CHECK (char_length(BTRIM(reason)) BETWEEN 2 AND 1000),
  CHECK (recorded_by_actor_type IN ('admin', 'superadmin', 'instructor_admin'))
);

CREATE INDEX IF NOT EXISTS idx_full_curriculum_retake_window_events_allowance
  ON full_curriculum_retake_window_events(school_id, allowance_id, id);
CREATE INDEX IF NOT EXISTS idx_full_curriculum_retake_window_events_test_booking
  ON full_curriculum_retake_window_events(school_id, new_second_test_booking_id);

CREATE TABLE IF NOT EXISTS full_curriculum_retake_movements (
  id                    BIGSERIAL PRIMARY KEY,
  school_id             INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  allowance_id          BIGINT NOT NULL,
  booking_allocation_id BIGINT NOT NULL,
  movement_type         TEXT NOT NULL DEFAULT 'consume',
  minutes               INTEGER NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, booking_allocation_id),
  FOREIGN KEY (allowance_id, school_id)
    REFERENCES full_curriculum_retake_allowances(id, school_id),
  FOREIGN KEY (booking_allocation_id, school_id)
    REFERENCES full_curriculum_booking_allocations(id, school_id),
  CHECK (movement_type = 'consume'),
  CHECK (minutes IN (90, 120))
);

CREATE INDEX IF NOT EXISTS idx_full_curriculum_retake_movements_allowance
  ON full_curriculum_retake_movements(school_id, allowance_id, id);

-- Mutable enforcement state derived from the append-only movement ledger.
-- The unique allowance row is the serialization point for concurrent usage.
CREATE TABLE IF NOT EXISTS full_curriculum_retake_usage_counters (
  school_id        INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  allowance_id     BIGINT NOT NULL,
  consumed_minutes INTEGER NOT NULL DEFAULT 0,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (school_id, allowance_id),
  FOREIGN KEY (allowance_id, school_id)
    REFERENCES full_curriculum_retake_allowances(id, school_id),
  CHECK (consumed_minutes BETWEEN 0 AND 600)
);

CREATE INDEX IF NOT EXISTS idx_full_curriculum_retake_usage_allowance
  ON full_curriculum_retake_usage_counters(allowance_id, school_id);

INSERT INTO full_curriculum_retake_usage_counters (
  school_id, allowance_id, consumed_minutes, updated_at
)
SELECT m.school_id, m.allowance_id, SUM(m.minutes)::integer, NOW()
  FROM full_curriculum_retake_movements m
 GROUP BY m.school_id, m.allowance_id
ON CONFLICT (school_id, allowance_id) DO UPDATE
  SET consumed_minutes = EXCLUDED.consumed_minutes,
      updated_at = NOW();

CREATE OR REPLACE FUNCTION reserve_full_curriculum_retake_minutes()
RETURNS TRIGGER AS $$
DECLARE
  reserved_minutes INTEGER;
BEGIN
  INSERT INTO full_curriculum_retake_usage_counters (
    school_id, allowance_id, consumed_minutes, updated_at
  ) VALUES (
    NEW.school_id, NEW.allowance_id, NEW.minutes, NOW()
  )
  ON CONFLICT (school_id, allowance_id) DO UPDATE
    SET consumed_minutes = full_curriculum_retake_usage_counters.consumed_minutes
                           + EXCLUDED.consumed_minutes,
        updated_at = NOW()
    WHERE full_curriculum_retake_usage_counters.consumed_minutes
          + EXCLUDED.consumed_minutes <= 600
  RETURNING consumed_minutes INTO reserved_minutes;

  IF reserved_minutes IS NULL THEN
    RAISE EXCEPTION 'Full Curriculum retake allowance would exceed its minute cap'
      USING ERRCODE = '23514',
            CONSTRAINT = 'full_curriculum_retake_usage_cap';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reserve_full_curriculum_retake_minutes
  ON full_curriculum_retake_movements;
CREATE TRIGGER trg_reserve_full_curriculum_retake_minutes
BEFORE INSERT ON full_curriculum_retake_movements
FOR EACH ROW EXECUTE FUNCTION reserve_full_curriculum_retake_minutes();

CREATE OR REPLACE FUNCTION forbid_full_curriculum_evidence_change()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% is append-only retained evidence', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'full_curriculum_progress_events',
    'full_curriculum_assessments',
    'full_curriculum_test_date_changes',
    'full_curriculum_extensions',
    'full_curriculum_booking_allocations',
    'full_curriculum_retake_allowances',
    'full_curriculum_retake_window_events',
    'full_curriculum_retake_movements'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_append_only ON %I', table_name, table_name);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_full_curriculum_evidence_change()',
      table_name,
      table_name
    );
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION guard_learner_package_purchase_change()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'learner package purchases are retained financial evidence'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.school_id IS DISTINCT FROM OLD.school_id
     OR (NEW.learner_id IS DISTINCT FROM OLD.learner_id
         AND NOT (OLD.learner_id IS NOT NULL AND NEW.learner_id IS NULL))
     OR NEW.attempt_id IS DISTINCT FROM OLD.attempt_id
     OR NEW.product_id IS DISTINCT FROM OLD.product_id
     OR NEW.product_version_id IS DISTINCT FROM OLD.product_version_id
     OR NEW.product_slug IS DISTINCT FROM OLD.product_slug
     OR NEW.product_snapshot IS DISTINCT FROM OLD.product_snapshot
     OR NEW.amount_pence IS DISTINCT FROM OLD.amount_pence
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.customer_terms_version IS DISTINCT FROM OLD.customer_terms_version
     OR NEW.stripe_mode IS DISTINCT FROM OLD.stripe_mode
     OR NEW.stripe_checkout_session_id IS DISTINCT FROM OLD.stripe_checkout_session_id
     OR NEW.stripe_payment_intent_id IS DISTINCT FROM OLD.stripe_payment_intent_id
     OR NEW.paid_at IS DISTINCT FROM OLD.paid_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'learner package purchase evidence is immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_learner_package_purchase_change
  ON learner_package_purchases;
CREATE TRIGGER trg_guard_learner_package_purchase_change
BEFORE UPDATE OR DELETE ON learner_package_purchases
FOR EACH ROW EXECUTE FUNCTION guard_learner_package_purchase_change();

CREATE OR REPLACE FUNCTION guard_full_curriculum_test_booking_change()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Full Curriculum test booking evidence is retained'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.school_id IS DISTINCT FROM OLD.school_id
     OR (NEW.learner_id IS DISTINCT FROM OLD.learner_id
         AND NOT (OLD.learner_id IS NOT NULL AND NEW.learner_id IS NULL))
     OR NEW.attempt_number IS DISTINCT FROM OLD.attempt_number
     OR NEW.test_date IS DISTINCT FROM OLD.test_date
     OR NEW.test_time IS DISTINCT FROM OLD.test_time
     OR (NEW.test_centre IS DISTINCT FROM OLD.test_centre
         AND NOT (OLD.learner_id IS NOT NULL AND NEW.learner_id IS NULL AND NEW.test_centre IS NULL))
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Full Curriculum test booking facts are immutable'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.verification_status IS DISTINCT FROM OLD.verification_status
     AND NOT (OLD.verification_status = 'pending' AND NEW.verification_status IN ('verified', 'rejected', 'superseded')) THEN
    RAISE EXCEPTION 'Invalid Full Curriculum verification transition'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_full_curriculum_test_booking_change
  ON full_curriculum_test_bookings;
CREATE TRIGGER trg_guard_full_curriculum_test_booking_change
BEFORE UPDATE OR DELETE ON full_curriculum_test_bookings
FOR EACH ROW EXECUTE FUNCTION guard_full_curriculum_test_booking_change();

CREATE OR REPLACE FUNCTION guard_package_attempt_full_curriculum_identity()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.full_curriculum_test_booking_id IS DISTINCT FROM OLD.full_curriculum_test_booking_id
    OR NEW.eligibility_snapshot IS DISTINCT FROM OLD.eligibility_snapshot
    OR NEW.stripe_payment_method_configuration_id IS DISTINCT FROM OLD.stripe_payment_method_configuration_id
  ) THEN
    RAISE EXCEPTION 'Full Curriculum purchase eligibility snapshot is immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_package_attempt_full_curriculum_identity
  ON package_purchase_attempts;
CREATE TRIGGER trg_guard_package_attempt_full_curriculum_identity
BEFORE UPDATE ON package_purchase_attempts
FOR EACH ROW EXECUTE FUNCTION guard_package_attempt_full_curriculum_identity();

-- Full Curriculum matching, instructor assignment and agreed availability.
--
-- This migration is additive and inert. It creates no bookings, Lesson Credit,
-- refunds, earnings, transfers or payouts, and it enables no feature flag.

CREATE UNIQUE INDEX IF NOT EXISTS uq_full_curriculum_enrolment_learner_scope
  ON full_curriculum_enrolments(id, school_id, learner_id);

CREATE TABLE IF NOT EXISTS full_curriculum_matching_records (
  id                         BIGSERIAL PRIMARY KEY,
  school_id                  INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  enrolment_id               BIGINT NOT NULL,
  learner_id                 INTEGER,
  status                     TEXT NOT NULL DEFAULT 'pending',
  initial_instructor_id      INTEGER,
  current_instructor_id      INTEGER,
  assigned_at                TIMESTAMPTZ,
  accepted_at                TIMESTAMPTZ,
  accepted_by_instructor_id  INTEGER,
  started_at                 TIMESTAMPTZ,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, enrolment_id),
  FOREIGN KEY (enrolment_id, school_id, learner_id)
    REFERENCES full_curriculum_enrolments(id, school_id, learner_id),
  FOREIGN KEY (initial_instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  FOREIGN KEY (current_instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  FOREIGN KEY (accepted_by_instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  CHECK (status IN ('pending', 'assigned', 'accepted', 'started')),
  CHECK (
    (status = 'pending' AND current_instructor_id IS NULL AND assigned_at IS NULL)
    OR
    (status IN ('assigned', 'accepted', 'started') AND current_instructor_id IS NOT NULL AND assigned_at IS NOT NULL)
  ),
  CHECK (
    (status IN ('pending', 'assigned') AND accepted_at IS NULL AND accepted_by_instructor_id IS NULL)
    OR
    (status = 'accepted' AND accepted_at IS NOT NULL AND accepted_by_instructor_id IS NOT NULL)
    OR
    (status = 'started' AND ((accepted_at IS NULL AND accepted_by_instructor_id IS NULL)
      OR (accepted_at IS NOT NULL AND accepted_by_instructor_id IS NOT NULL)))
  ),
  CHECK ((status = 'started' AND started_at IS NOT NULL) OR (status <> 'started' AND started_at IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_full_curriculum_matching_queue
  ON full_curriculum_matching_records(school_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_full_curriculum_matching_instructor
  ON full_curriculum_matching_records(school_id, current_instructor_id, status)
  WHERE current_instructor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_full_curriculum_matching_initial_instructor
  ON full_curriculum_matching_records(school_id, initial_instructor_id)
  WHERE initial_instructor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_full_curriculum_matching_acceptor
  ON full_curriculum_matching_records(school_id, accepted_by_instructor_id)
  WHERE accepted_by_instructor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_full_curriculum_matching_learner
  ON full_curriculum_matching_records(school_id, learner_id)
  WHERE learner_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS full_curriculum_assignment_events (
  id                     BIGSERIAL PRIMARY KEY,
  school_id              INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  matching_record_id     BIGINT NOT NULL,
  enrolment_id           BIGINT NOT NULL,
  previous_instructor_id INTEGER,
  instructor_id          INTEGER NOT NULL,
  event_type             TEXT NOT NULL,
  actor_type              TEXT NOT NULL,
  actor_id                INTEGER NOT NULL,
  reason                  TEXT NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  FOREIGN KEY (matching_record_id, school_id)
    REFERENCES full_curriculum_matching_records(id, school_id),
  FOREIGN KEY (enrolment_id, school_id)
    REFERENCES full_curriculum_enrolments(id, school_id),
  FOREIGN KEY (previous_instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  CHECK (event_type IN ('assigned', 'self_assigned', 'accepted', 'reassigned')),
  CHECK (actor_type IN ('admin', 'superadmin', 'instructor', 'instructor_admin')),
  CHECK (char_length(BTRIM(reason)) BETWEEN 2 AND 1000),
  CHECK (event_type <> 'reassigned' OR previous_instructor_id IS NOT NULL),
  CHECK (event_type = 'reassigned' OR previous_instructor_id IS NULL OR previous_instructor_id = instructor_id)
);

CREATE INDEX IF NOT EXISTS idx_full_curriculum_assignment_timeline
  ON full_curriculum_assignment_events(school_id, enrolment_id, id);
CREATE INDEX IF NOT EXISTS idx_full_curriculum_assignment_instructor
  ON full_curriculum_assignment_events(school_id, instructor_id, id);
CREATE INDEX IF NOT EXISTS idx_full_curriculum_assignment_matching
  ON full_curriculum_assignment_events(school_id, matching_record_id, id);
CREATE INDEX IF NOT EXISTS idx_full_curriculum_assignment_previous_instructor
  ON full_curriculum_assignment_events(school_id, previous_instructor_id, id)
  WHERE previous_instructor_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS full_curriculum_availability_versions (
  id                     BIGSERIAL PRIMARY KEY,
  school_id              INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  matching_record_id     BIGINT NOT NULL,
  enrolment_id           BIGINT NOT NULL,
  instructor_id          INTEGER NOT NULL,
  version_number         INTEGER NOT NULL,
  timezone               TEXT NOT NULL,
  actor_type              TEXT NOT NULL,
  actor_id                INTEGER NOT NULL,
  reason                  TEXT NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, enrolment_id, version_number),
  FOREIGN KEY (matching_record_id, school_id)
    REFERENCES full_curriculum_matching_records(id, school_id),
  FOREIGN KEY (enrolment_id, school_id)
    REFERENCES full_curriculum_enrolments(id, school_id),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  CHECK (version_number > 0),
  CHECK (char_length(BTRIM(timezone)) BETWEEN 1 AND 100),
  CHECK (actor_type IN ('admin', 'superadmin', 'instructor', 'instructor_admin')),
  CHECK (char_length(BTRIM(reason)) BETWEEN 2 AND 1000)
);

CREATE INDEX IF NOT EXISTS idx_full_curriculum_availability_timeline
  ON full_curriculum_availability_versions(school_id, enrolment_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_full_curriculum_availability_instructor
  ON full_curriculum_availability_versions(school_id, instructor_id, version_number DESC);

CREATE TABLE IF NOT EXISTS full_curriculum_availability_windows (
  id                      BIGSERIAL PRIMARY KEY,
  school_id               INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  availability_version_id BIGINT NOT NULL,
  weekday                 SMALLINT NOT NULL,
  local_start_time        TIME NOT NULL,
  local_end_time          TIME NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, availability_version_id, weekday, local_start_time, local_end_time),
  FOREIGN KEY (availability_version_id, school_id)
    REFERENCES full_curriculum_availability_versions(id, school_id),
  CHECK (weekday BETWEEN 1 AND 7),
  CHECK (local_end_time > local_start_time)
);

CREATE INDEX IF NOT EXISTS idx_full_curriculum_availability_windows_version
  ON full_curriculum_availability_windows(school_id, availability_version_id, weekday, local_start_time);

CREATE OR REPLACE FUNCTION validate_full_curriculum_matching_record()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.school_id IS DISTINCT FROM OLD.school_id
       OR NEW.enrolment_id IS DISTINCT FROM OLD.enrolment_id
       OR (NEW.learner_id IS DISTINCT FROM OLD.learner_id
           AND NOT (OLD.learner_id IS NOT NULL AND NEW.learner_id IS NULL))
       OR (OLD.initial_instructor_id IS NOT NULL
           AND NEW.initial_instructor_id IS DISTINCT FROM OLD.initial_instructor_id)
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Full Curriculum matching identity is immutable'
        USING ERRCODE = '55000';
    END IF;
    IF NOT (
      (OLD.status = 'pending' AND NEW.status IN ('pending', 'assigned', 'accepted'))
      OR (OLD.status = 'assigned' AND NEW.status IN ('assigned', 'accepted', 'started'))
      OR (OLD.status = 'accepted' AND NEW.status IN ('assigned', 'accepted', 'started'))
      OR (OLD.status = 'started' AND NEW.status = 'started')
    ) OR (OLD.started_at IS NOT NULL AND NEW.started_at IS DISTINCT FROM OLD.started_at) THEN
      RAISE EXCEPTION 'Invalid Full Curriculum matching transition'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.current_instructor_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.current_instructor_id IS DISTINCT FROM OLD.current_instructor_id OR NEW.status IS DISTINCT FROM OLD.status)
     AND NOT EXISTS (
    SELECT 1 FROM instructors i
     WHERE i.id = NEW.current_instructor_id
       AND i.school_id = NEW.school_id
       AND i.active = TRUE
  ) THEN
    RAISE EXCEPTION 'Full Curriculum assignment requires an active same-school instructor'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.initial_instructor_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.initial_instructor_id IS DISTINCT FROM OLD.initial_instructor_id)
     AND NOT EXISTS (
    SELECT 1 FROM instructors i
     WHERE i.id = NEW.initial_instructor_id
       AND i.school_id = NEW.school_id
       AND i.active = TRUE
  ) THEN
    RAISE EXCEPTION 'Initial Full Curriculum assignment requires an active same-school instructor'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.accepted_by_instructor_id IS NOT NULL
     AND NEW.accepted_by_instructor_id IS DISTINCT FROM NEW.current_instructor_id THEN
    RAISE EXCEPTION 'Only the currently assigned instructor may accept a Full Curriculum assignment'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_full_curriculum_matching_record
  ON full_curriculum_matching_records;
CREATE TRIGGER trg_validate_full_curriculum_matching_record
BEFORE INSERT OR UPDATE ON full_curriculum_matching_records
FOR EACH ROW EXECUTE FUNCTION validate_full_curriculum_matching_record();

CREATE OR REPLACE FUNCTION validate_full_curriculum_availability_timezone()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.timezone) THEN
    RAISE EXCEPTION 'Invalid IANA timezone for Full Curriculum availability'
      USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM full_curriculum_matching_records m
      JOIN instructors i
        ON i.id = NEW.instructor_id AND i.school_id = NEW.school_id AND i.active = TRUE
     WHERE m.id = NEW.matching_record_id
       AND m.school_id = NEW.school_id
       AND m.enrolment_id = NEW.enrolment_id
       AND m.current_instructor_id = NEW.instructor_id
  ) THEN
    RAISE EXCEPTION 'Availability requires the active currently assigned same-school instructor'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validate_full_curriculum_assignment_event()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM full_curriculum_matching_records m
      JOIN instructors i
        ON i.id = NEW.instructor_id AND i.school_id = NEW.school_id AND i.active = TRUE
     WHERE m.id = NEW.matching_record_id
       AND m.school_id = NEW.school_id
       AND m.enrolment_id = NEW.enrolment_id
       AND m.current_instructor_id = NEW.instructor_id
  ) THEN
    RAISE EXCEPTION 'Assignment evidence must match the active current same-school instructor and enrolment'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_full_curriculum_assignment_event
  ON full_curriculum_assignment_events;
CREATE TRIGGER trg_validate_full_curriculum_assignment_event
BEFORE INSERT ON full_curriculum_assignment_events
FOR EACH ROW EXECUTE FUNCTION validate_full_curriculum_assignment_event();

DROP TRIGGER IF EXISTS trg_validate_full_curriculum_availability_timezone
  ON full_curriculum_availability_versions;
CREATE TRIGGER trg_validate_full_curriculum_availability_timezone
BEFORE INSERT ON full_curriculum_availability_versions
FOR EACH ROW EXECUTE FUNCTION validate_full_curriculum_availability_timezone();

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'full_curriculum_assignment_events',
    'full_curriculum_availability_versions',
    'full_curriculum_availability_windows'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_append_only ON %I', table_name, table_name);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_full_curriculum_evidence_change()',
      table_name,
      table_name
    );
  END LOOP;
END $$;

INSERT INTO full_curriculum_matching_records (
  school_id, enrolment_id, learner_id, status, created_at, updated_at
)
SELECT e.school_id, e.id, e.learner_id, 'pending', e.created_at, NOW()
  FROM full_curriculum_enrolments e
 WHERE e.programme_start_at IS NULL
ON CONFLICT (school_id, enrolment_id) DO NOTHING;
-- Full Curriculum consumer-rights, withdrawal and manual-refund evidence.
--
-- This migration is additive and inert. It does not enable purchasing, issue
-- a refund, call Stripe, create Lesson Credit, or change payout behaviour.

CREATE TABLE IF NOT EXISTS full_curriculum_consumer_contract_evidence (
  id                              BIGSERIAL PRIMARY KEY,
  school_id                       INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  attempt_id                      UUID NOT NULL,
  learner_id                      INTEGER,
  customer_terms_version          TEXT NOT NULL,
  policy_version                  TEXT NOT NULL,
  disclosure_version              TEXT NOT NULL,
  refund_calculation_version      TEXT NOT NULL,
  disclosure_snapshot             JSONB NOT NULL,
  disclosure_sha256               TEXT NOT NULL,
  checkout_acknowledgement_sha256 TEXT NOT NULL,
  early_start_requested           BOOLEAN NOT NULL,
  start_request_text              TEXT NOT NULL,
  start_request_sha256            TEXT NOT NULL,
  actor_type                      TEXT NOT NULL DEFAULT 'learner',
  actor_id                        INTEGER,
  acknowledged_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, attempt_id),
  FOREIGN KEY (attempt_id, school_id)
    REFERENCES package_purchase_attempts(id, school_id),
  FOREIGN KEY (learner_id, school_id)
    REFERENCES learner_users(id, school_id) ON DELETE SET NULL (learner_id),
  CHECK (jsonb_typeof(disclosure_snapshot) = 'object'),
  CHECK (disclosure_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (checkout_acknowledgement_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (start_request_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (actor_type = 'learner'),
  CHECK (char_length(BTRIM(customer_terms_version)) BETWEEN 1 AND 120),
  CHECK (char_length(BTRIM(policy_version)) BETWEEN 1 AND 120),
  CHECK (char_length(BTRIM(disclosure_version)) BETWEEN 1 AND 120),
  CHECK (char_length(BTRIM(refund_calculation_version)) BETWEEN 1 AND 120),
  CHECK (char_length(BTRIM(start_request_text)) BETWEEN 20 AND 4000)
);

CREATE INDEX IF NOT EXISTS idx_full_curriculum_contract_evidence_learner
  ON full_curriculum_consumer_contract_evidence(school_id, learner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS full_curriculum_contract_events (
  id                  BIGSERIAL PRIMARY KEY,
  school_id           INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  attempt_id          UUID NOT NULL,
  purchase_id         BIGINT,
  enrolment_id        BIGINT,
  event_type          TEXT NOT NULL,
  actor_type          TEXT NOT NULL,
  actor_id            INTEGER,
  detail              JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at         TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  FOREIGN KEY (attempt_id, school_id)
    REFERENCES package_purchase_attempts(id, school_id),
  FOREIGN KEY (purchase_id, school_id)
    REFERENCES learner_package_purchases(id, school_id),
  FOREIGN KEY (enrolment_id, school_id)
    REFERENCES full_curriculum_enrolments(id, school_id),
  CHECK (event_type IN (
    'checkout_evidence_recorded', 'contract_formed',
    'durable_confirmation_queued', 'durable_confirmation_delivered',
    'durable_confirmation_failed', 'cooling_off_hold_released'
  )),
  CHECK (actor_type IN ('learner', 'system', 'admin', 'superadmin', 'instructor_admin')),
  CHECK (jsonb_typeof(detail) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_full_curriculum_contract_events_attempt
  ON full_curriculum_contract_events(school_id, attempt_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_full_curriculum_contract_formed_event
  ON full_curriculum_contract_events(school_id, attempt_id, event_type)
  WHERE event_type IN ('checkout_evidence_recorded', 'contract_formed');

ALTER TABLE full_curriculum_enrolments
  ADD COLUMN IF NOT EXISTS early_start_requested BOOLEAN,
  ADD COLUMN IF NOT EXISTS contract_formed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cooling_off_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS service_may_start_at TIMESTAMPTZ;

ALTER TABLE full_curriculum_enrolments
  DROP CONSTRAINT IF EXISTS full_curriculum_enrolments_status_check;
ALTER TABLE full_curriculum_enrolments
  ADD CONSTRAINT full_curriculum_enrolments_status_check
  CHECK (status IN (
    'cooling_off_hold', 'paid_matching', 'active', 'assessment_pending',
    'retake_pending', 'retake_active', 'completed', 'withdrawn'
  ));

DROP INDEX IF EXISTS uq_full_curriculum_active_learner;
CREATE UNIQUE INDEX uq_full_curriculum_active_learner
  ON full_curriculum_enrolments(school_id, learner_id)
  WHERE learner_id IS NOT NULL
    AND status IN (
      'cooling_off_hold', 'paid_matching', 'active', 'assessment_pending',
      'retake_pending', 'retake_active'
    );

DO $$ BEGIN
  ALTER TABLE full_curriculum_enrolments
    ADD CONSTRAINT full_curriculum_enrolments_consumer_timing_check
    CHECK (
      (contract_formed_at IS NULL AND cooling_off_expires_at IS NULL AND service_may_start_at IS NULL)
      OR
      (contract_formed_at IS NOT NULL AND cooling_off_expires_at IS NOT NULL
       AND service_may_start_at IS NOT NULL
       AND cooling_off_expires_at > contract_formed_at
       AND service_may_start_at >= contract_formed_at)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE full_curriculum_enrolments
    ADD CONSTRAINT full_curriculum_enrolments_cooling_hold_check
    CHECK (status <> 'cooling_off_hold' OR (
      early_start_requested = FALSE
      AND programme_start_at IS NULL
      AND service_may_start_at = cooling_off_expires_at
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE full_curriculum_progress_events
  DROP CONSTRAINT IF EXISTS full_curriculum_progress_events_actor_type_check;
ALTER TABLE full_curriculum_progress_events
  ADD CONSTRAINT full_curriculum_progress_events_actor_type_check
  CHECK (actor_type IN (
    'system', 'learner', 'admin', 'superadmin', 'instructor', 'instructor_admin'
  ));

CREATE TABLE IF NOT EXISTS full_curriculum_termination_requests (
  id                    UUID PRIMARY KEY,
  school_id             INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  enrolment_id          BIGINT NOT NULL,
  learner_id            INTEGER,
  request_kind          TEXT NOT NULL,
  channel               TEXT NOT NULL,
  reason                TEXT,
  actor_type            TEXT NOT NULL,
  actor_id              INTEGER,
  received_at           TIMESTAMPTZ NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, enrolment_id, id),
  FOREIGN KEY (enrolment_id, school_id)
    REFERENCES full_curriculum_enrolments(id, school_id),
  FOREIGN KEY (learner_id, school_id)
    REFERENCES learner_users(id, school_id) ON DELETE SET NULL (learner_id),
  CHECK (request_kind IN (
    'learner_cancellation', 'matching_failure', 'provider_nonfulfilment'
  )),
  CHECK (channel IN ('self_service', 'email', 'post', 'phone', 'admin_recorded')),
  CHECK (actor_type IN ('learner', 'admin', 'superadmin', 'instructor_admin')),
  CHECK (reason IS NULL OR char_length(BTRIM(reason)) BETWEEN 2 AND 1000)
);

CREATE INDEX IF NOT EXISTS idx_full_curriculum_termination_enrolment
  ON full_curriculum_termination_requests(school_id, enrolment_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_full_curriculum_termination_learner
  ON full_curriculum_termination_requests(school_id, learner_id, received_at DESC);

CREATE TABLE IF NOT EXISTS full_curriculum_refund_cases (
  id                         UUID PRIMARY KEY,
  school_id                  INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  enrolment_id               BIGINT NOT NULL,
  purchase_id                BIGINT NOT NULL,
  learner_id                 INTEGER,
  termination_request_id     UUID NOT NULL,
  classification             TEXT NOT NULL,
  status                     TEXT NOT NULL DEFAULT 'calculated',
  calculation_version        TEXT NOT NULL,
  calculation_fingerprint    TEXT NOT NULL,
  calculation_snapshot       JSONB NOT NULL,
  original_payment_pence     INTEGER NOT NULL,
  previous_refund_pence      INTEGER NOT NULL DEFAULT 0,
  deduction_pence            INTEGER NOT NULL DEFAULT 0,
  refund_due_pence           INTEGER NOT NULL,
  stripe_fee_absorbed_pence  INTEGER,
  reviewed_by_admin_id       INTEGER,
  reviewed_at                TIMESTAMPTZ,
  approved_by_admin_id       INTEGER,
  approved_at                TIMESTAMPTZ,
  provider_refund_id         TEXT,
  provider_status            TEXT,
  provider_recorded_at       TIMESTAMPTZ,
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, termination_request_id),
  UNIQUE (school_id, calculation_fingerprint),
  UNIQUE (provider_refund_id),
  FOREIGN KEY (enrolment_id, school_id)
    REFERENCES full_curriculum_enrolments(id, school_id),
  FOREIGN KEY (purchase_id, school_id)
    REFERENCES learner_package_purchases(id, school_id),
  FOREIGN KEY (termination_request_id, school_id)
    REFERENCES full_curriculum_termination_requests(id, school_id),
  FOREIGN KEY (learner_id, school_id)
    REFERENCES learner_users(id, school_id) ON DELETE SET NULL (learner_id),
  CHECK (classification IN (
    'cooling_off_cancellation', 'voluntary_withdrawal',
    'matching_failure', 'provider_nonfulfilment'
  )),
  CHECK (status IN (
    'calculated', 'manual_review', 'reviewed', 'approved', 'rejected',
    'provider_succeeded', 'provider_failed'
  )),
  CHECK (calculation_fingerprint ~ '^[0-9a-f]{64}$'),
  CHECK (jsonb_typeof(calculation_snapshot) = 'object'),
  CHECK (original_payment_pence > 0),
  CHECK (previous_refund_pence BETWEEN 0 AND original_payment_pence),
  CHECK (deduction_pence BETWEEN 0 AND original_payment_pence - previous_refund_pence),
  CHECK (refund_due_pence = original_payment_pence - previous_refund_pence - deduction_pence),
  CHECK (stripe_fee_absorbed_pence IS NULL OR stripe_fee_absorbed_pence >= 0),
  CHECK (approved_by_admin_id IS NULL OR reviewed_by_admin_id IS DISTINCT FROM approved_by_admin_id),
  CHECK (provider_refund_id IS NULL OR provider_refund_id ~ '^re_[A-Za-z0-9_]+$'),
  CHECK (provider_status IS NULL OR provider_status IN ('succeeded', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_full_curriculum_refund_cases_queue
  ON full_curriculum_refund_cases(school_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_full_curriculum_refund_cases_learner
  ON full_curriculum_refund_cases(school_id, learner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS full_curriculum_refund_lines (
  id                 BIGSERIAL PRIMARY KEY,
  school_id          INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  refund_case_id     UUID NOT NULL,
  line_number        INTEGER NOT NULL,
  line_type          TEXT NOT NULL,
  quantity           INTEGER NOT NULL,
  unit_value_pence   INTEGER,
  cap_pence          INTEGER NOT NULL,
  deduction_pence    INTEGER NOT NULL,
  evidence_snapshot  JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, refund_case_id, line_number),
  FOREIGN KEY (refund_case_id, school_id)
    REFERENCES full_curriculum_refund_cases(id, school_id),
  CHECK (line_number > 0),
  CHECK (line_type IN (
    'base_teaching', 'retake_teaching', 'completed_assessment',
    'matching_admin', 'stripe_fee', 'corrective_adjustment'
  )),
  CHECK (quantity >= 0),
  CHECK (unit_value_pence IS NULL OR unit_value_pence >= 0),
  CHECK (cap_pence >= 0),
  CHECK (deduction_pence >= 0),
  CHECK (jsonb_typeof(evidence_snapshot) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_full_curriculum_refund_lines_case
  ON full_curriculum_refund_lines(school_id, refund_case_id, line_number);

CREATE TABLE IF NOT EXISTS full_curriculum_refund_case_events (
  id                 BIGSERIAL PRIMARY KEY,
  school_id          INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  refund_case_id     UUID NOT NULL,
  from_status        TEXT,
  to_status          TEXT NOT NULL,
  actor_type         TEXT NOT NULL,
  actor_id           INTEGER,
  detail             JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  FOREIGN KEY (refund_case_id, school_id)
    REFERENCES full_curriculum_refund_cases(id, school_id),
  CHECK (actor_type IN ('learner', 'system', 'admin', 'superadmin', 'instructor_admin')),
  CHECK (jsonb_typeof(detail) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_full_curriculum_refund_case_events_case
  ON full_curriculum_refund_case_events(school_id, refund_case_id, id);

CREATE OR REPLACE FUNCTION guard_full_curriculum_consumer_identity()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% is retained consumer/financial evidence', TG_TABLE_NAME
      USING ERRCODE = '55000';
  END IF;
  IF NEW IS DISTINCT FROM OLD THEN
    IF OLD.learner_id IS NOT NULL AND NEW.learner_id IS NULL THEN
      NEW := OLD;
      NEW.learner_id := NULL;
      IF OLD.actor_type = 'learner' THEN
        NEW.actor_id := NULL;
      END IF;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION '% evidence is immutable', TG_TABLE_NAME
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_full_curriculum_contract_evidence_immutable
  ON full_curriculum_consumer_contract_evidence;
CREATE TRIGGER trg_full_curriculum_contract_evidence_immutable
BEFORE UPDATE OR DELETE ON full_curriculum_consumer_contract_evidence
FOR EACH ROW EXECUTE FUNCTION guard_full_curriculum_consumer_identity();

DROP TRIGGER IF EXISTS trg_full_curriculum_termination_immutable
  ON full_curriculum_termination_requests;
CREATE TRIGGER trg_full_curriculum_termination_immutable
BEFORE UPDATE OR DELETE ON full_curriculum_termination_requests
FOR EACH ROW EXECUTE FUNCTION guard_full_curriculum_consumer_identity();

CREATE OR REPLACE FUNCTION guard_full_curriculum_refund_case_change()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Full Curriculum refund cases are retained financial evidence'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.school_id IS DISTINCT FROM OLD.school_id
     OR (NEW.learner_id IS DISTINCT FROM OLD.learner_id
         AND NOT (OLD.learner_id IS NOT NULL AND NEW.learner_id IS NULL))
     OR NEW.enrolment_id IS DISTINCT FROM OLD.enrolment_id
     OR NEW.purchase_id IS DISTINCT FROM OLD.purchase_id
     OR NEW.termination_request_id IS DISTINCT FROM OLD.termination_request_id
     OR NEW.classification IS DISTINCT FROM OLD.classification
     OR NEW.calculation_version IS DISTINCT FROM OLD.calculation_version
     OR NEW.calculation_fingerprint IS DISTINCT FROM OLD.calculation_fingerprint
     OR NEW.calculation_snapshot IS DISTINCT FROM OLD.calculation_snapshot
     OR NEW.original_payment_pence IS DISTINCT FROM OLD.original_payment_pence
     OR NEW.previous_refund_pence IS DISTINCT FROM OLD.previous_refund_pence
     OR NEW.deduction_pence IS DISTINCT FROM OLD.deduction_pence
     OR NEW.refund_due_pence IS DISTINCT FROM OLD.refund_due_pence
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Full Curriculum refund calculation evidence is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status IN ('calculated', 'manual_review') AND NEW.status IN ('reviewed', 'rejected'))
    OR (OLD.status = 'reviewed' AND NEW.status IN ('approved', 'rejected'))
    OR (OLD.status = 'approved' AND NEW.status IN ('provider_succeeded', 'provider_failed'))
    OR (OLD.status = 'provider_failed' AND NEW.status = 'provider_succeeded')
  ) THEN
    RAISE EXCEPTION 'Invalid Full Curriculum refund case transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;
  IF NEW.approved_by_admin_id IS NOT NULL
     AND NEW.approved_by_admin_id = NEW.reviewed_by_admin_id THEN
    RAISE EXCEPTION 'Full Curriculum refund approval requires a second admin'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_full_curriculum_refund_case_change
  ON full_curriculum_refund_cases;
CREATE TRIGGER trg_guard_full_curriculum_refund_case_change
BEFORE UPDATE OR DELETE ON full_curriculum_refund_cases
FOR EACH ROW EXECUTE FUNCTION guard_full_curriculum_refund_case_change();

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'full_curriculum_contract_events',
    'full_curriculum_refund_lines',
    'full_curriculum_refund_case_events'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_append_only ON %I', table_name, table_name);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_full_curriculum_evidence_change()',
      table_name,
      table_name
    );
  END LOOP;
END $$;

-- Full Curriculum owner-certified controlled-pilot safeguards.
--
-- This migration is additive and inert. It grants nobody access, changes no
-- feature flag, creates no Checkout and calls no payment or refund provider.

ALTER TABLE full_curriculum_consumer_contract_evidence
  ADD COLUMN IF NOT EXISTS adult_age_confirmed BOOLEAN;

ALTER TABLE full_curriculum_consumer_contract_evidence
  DROP CONSTRAINT IF EXISTS full_curriculum_contract_evidence_adult_check;
ALTER TABLE full_curriculum_consumer_contract_evidence
  ADD CONSTRAINT full_curriculum_contract_evidence_adult_check
  CHECK (adult_age_confirmed IS NULL OR adult_age_confirmed = TRUE);

CREATE TABLE IF NOT EXISTS full_curriculum_pilot_access (
  id                         UUID PRIMARY KEY,
  school_id                  INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  learner_id                 INTEGER NOT NULL,
  certification_version      TEXT NOT NULL,
  granted_by_admin_id        INTEGER NOT NULL,
  granted_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  grant_reason               TEXT NOT NULL,
  active                     BOOLEAN NOT NULL DEFAULT TRUE,
  revoked_by_admin_id        INTEGER,
  revoked_at                 TIMESTAMPTZ,
  revocation_reason          TEXT,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  FOREIGN KEY (learner_id, school_id)
    REFERENCES learner_users(id, school_id) ON DELETE CASCADE,
  FOREIGN KEY (granted_by_admin_id, school_id)
    REFERENCES admin_users(id, school_id),
  FOREIGN KEY (revoked_by_admin_id, school_id)
    REFERENCES admin_users(id, school_id),
  CHECK (char_length(BTRIM(certification_version)) BETWEEN 1 AND 120),
  CHECK (char_length(BTRIM(grant_reason)) BETWEEN 2 AND 1000),
  CHECK (
    (active = TRUE AND revoked_by_admin_id IS NULL AND revoked_at IS NULL AND revocation_reason IS NULL)
    OR
    (active = FALSE AND revoked_by_admin_id IS NOT NULL AND revoked_at IS NOT NULL
      AND char_length(BTRIM(revocation_reason)) BETWEEN 2 AND 1000)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_full_curriculum_one_active_pilot_learner
  ON full_curriculum_pilot_access(school_id)
  WHERE active = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_full_curriculum_active_pilot_learner
  ON full_curriculum_pilot_access(school_id, learner_id)
  WHERE active = TRUE;

CREATE INDEX IF NOT EXISTS idx_full_curriculum_pilot_access_history
  ON full_curriculum_pilot_access(school_id, learner_id, granted_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_full_curriculum_owner_certified_terms
  ON package_product_versions(school_id, product_id)
  WHERE customer_terms_version = 'full-curriculum-owner-certified-v1';

-- Fraser's 15 August 2026 owner-certified values for the School 1 controlled
-- pilot. This is a new immutable version; no existing version is rewritten.
WITH target AS (
  SELECT product.id AS product_id, product.school_id
    FROM package_products product
   WHERE product.school_id = 1
     AND product.slug = 'full-curriculum'
     AND product.active = TRUE
), current_version AS (
  SELECT target.school_id, target.product_id, version.price_pence,
         version.currency, version.content, version.effective_from
    FROM target
    JOIN LATERAL (
      SELECT candidate.*
        FROM package_product_versions candidate
       WHERE candidate.school_id = target.school_id
         AND candidate.product_id = target.product_id
       ORDER BY candidate.effective_from DESC, candidate.version_number DESC
       LIMIT 1
    ) version ON TRUE
)
INSERT INTO package_product_versions (
  school_id, product_id, version_number, price_pence, currency, content,
  customer_terms_version, effective_from
)
SELECT current.school_id, current.product_id,
       (SELECT COALESCE(MAX(existing.version_number), 0) + 1
          FROM package_product_versions existing
         WHERE existing.school_id = current.school_id
           AND existing.product_id = current.product_id),
       current.price_pence, current.currency,
       current.content || jsonb_build_object(
         'checkout_disclosure', 'Adults-only controlled pilot. You have a 14-day cancellation period. Matching and administration have no deductible value, and CoachCarter absorbs the original Stripe fee.',
         'controlled_pilot', jsonb_build_object(
           'adult_only', TRUE,
           'one_active_learner_per_school', TRUE,
           'owner_certification_version', 'full-curriculum-owner-self-certification-v1'
         ),
         'consumer_rights', jsonb_build_object(
           'policy_version', 'full-curriculum-consumer-rights-v1',
           'disclosure_version', 'full-curriculum-checkout-disclosure-v1',
           'refund_calculation_version', 'full-curriculum-refund-v1',
           'cooling_off_days', 14,
           'valuation_basis', 'purchase_price_allocation',
           'rounding_rule', 'whole_pence_deductions_down',
           'matching_admin_deduction_pence', 0,
           'stripe_fee_customer_deduction_pence', 0,
           'teaching_deductions', jsonb_build_object(
             'base_90_minutes_pence', 6000,
             'base_cap_pence', 144000,
             'retake_90_minutes_pence', 6000,
             'retake_120_minutes_pence', 8000,
             'retake_cap_pence', 40000
           ),
           'assessment_deductions', jsonb_build_object(
             'each_completed_pence', 5000,
             'cap_pence', 15000
           )
         )
       ),
       'full-curriculum-owner-certified-v1',
       GREATEST(NOW(), current.effective_from)
  FROM current_version current
 WHERE NOT EXISTS (
   SELECT 1 FROM package_product_versions existing
    WHERE existing.school_id = current.school_id
      AND existing.product_id = current.product_id
      AND existing.customer_terms_version = 'full-curriculum-owner-certified-v1'
 );

CREATE UNIQUE INDEX IF NOT EXISTS uq_full_curriculum_durable_confirmation_delivered
  ON full_curriculum_contract_events(school_id, attempt_id, event_type)
  WHERE event_type = 'durable_confirmation_delivered';

-- Learner Packages: school-wide Flexible Hours.
-- Additive and inert. No school purchasing gate is enabled by this migration.
-- Units are exactly 30 minutes; all financial/product snapshots are immutable.

ALTER TABLE lesson_bookings
  DROP CONSTRAINT IF EXISTS lesson_bookings_list_price_source_check;
ALTER TABLE lesson_bookings
  ADD CONSTRAINT lesson_bookings_list_price_source_check
  CHECK (list_price_source IS NULL OR list_price_source IN (
    'stripe_metadata', 'live_compute_insert', 'live_compute_backfill', 'unknown',
    'flexible_package_frozen_rate'
  ));
ALTER TABLE lesson_bookings
  ADD COLUMN IF NOT EXISTS flexible_package_booking_request_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS uq_flexible_package_booking_request
  ON lesson_bookings(school_id, learner_id, flexible_package_booking_request_id)
  WHERE flexible_package_booking_request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION seed_flexible_hours_package_catalogue(target_school_id INTEGER)
RETURNS VOID AS $$
DECLARE
  flexible_15_id BIGINT;
  flexible_30_id BIGINT;
  next_30_version INTEGER;
BEGIN
  INSERT INTO package_products (school_id, slug, product_type, visible, active, sort_order)
  VALUES (target_school_id, 'flexible-15-hours', 'flexible_hours', TRUE, TRUE, 9)
  ON CONFLICT (school_id, slug) DO NOTHING;

  INSERT INTO package_products (school_id, slug, product_type, visible, active, sort_order)
  VALUES (target_school_id, 'flexible-30-hours', 'flexible_hours', TRUE, TRUE, 10)
  ON CONFLICT (school_id, slug) DO NOTHING;

  SELECT id INTO flexible_15_id
    FROM package_products
   WHERE school_id = target_school_id AND slug = 'flexible-15-hours';
  SELECT id INTO flexible_30_id
    FROM package_products
   WHERE school_id = target_school_id AND slug = 'flexible-30-hours';

  INSERT INTO package_product_versions (
    school_id, product_id, version_number, price_pence, currency, content,
    customer_terms_version, effective_from
  )
  SELECT target_school_id, flexible_15_id, 1, 81000, 'GBP',
    jsonb_build_object(
      'name', '15-hour Flexible Hours package',
      'short_description', 'Fifteen school-wide lesson hours, usable with any eligible active instructor.',
      'intent', 'flexible_hours',
      'highlights', jsonb_build_array('15 school-wide hours', 'GBP 54 per hour', 'No expiry', 'Used in exact 30-minute units'),
      'not_included', jsonb_build_array('Transfer to another learner', 'A permanently assigned instructor'),
      'entitlement', jsonb_build_object('hours', 15, 'unit_minutes', 30, 'units', 30, 'scope', 'school'),
      'refund_basis', 'Unused units are refundable at GBP 27 per 30-minute unit. CoachCarter absorbs the original Stripe fee.',
      'consumer_rights', jsonb_build_object(
        'disclosure_version', 'flexible-hours-consumer-rights-v1',
        'checkout_acknowledgement', 'I have read and accept the Flexible Hours terms, cancellation rules and unused-value refund basis.',
        'immediate_access_request', 'I expressly request immediate access to my Flexible Hours during the 14-day cancellation period and understand that properly used or late-cancelled value may be deducted.'
      ),
      'checkout_disclosure', 'Pay by Bank. Access is created only after verified signed webhook confirmation.'
    ),
    'flexible-hours-v1', TIMESTAMPTZ '2026-08-16 00:00:00+00'
  WHERE flexible_15_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM package_product_versions
       WHERE school_id = target_school_id
         AND product_id = flexible_15_id
         AND customer_terms_version = 'flexible-hours-v1'
    );

  IF flexible_30_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM package_product_versions
     WHERE school_id = target_school_id
       AND product_id = flexible_30_id
       AND customer_terms_version = 'flexible-hours-v1'
  ) THEN
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO next_30_version
      FROM package_product_versions
     WHERE school_id = target_school_id AND product_id = flexible_30_id;

    INSERT INTO package_product_versions (
      school_id, product_id, version_number, price_pence, currency, content,
      customer_terms_version, effective_from
    ) VALUES (
      target_school_id, flexible_30_id, next_30_version, 159000, 'GBP',
      jsonb_build_object(
        'name', '30-hour Flexible Hours package',
        'short_description', 'Thirty school-wide lesson hours, usable with any eligible active instructor.',
        'intent', 'flexible_hours',
        'highlights', jsonb_build_array('30 school-wide hours', 'GBP 53 per hour', 'No expiry', 'Used in exact 30-minute units'),
        'not_included', jsonb_build_array('Transfer to another learner', 'A permanently assigned instructor'),
        'entitlement', jsonb_build_object('hours', 30, 'unit_minutes', 30, 'units', 60, 'scope', 'school'),
        'refund_basis', 'Unused units are refundable at GBP 26.50 per 30-minute unit. CoachCarter absorbs the original Stripe fee.',
        'consumer_rights', jsonb_build_object(
          'disclosure_version', 'flexible-hours-consumer-rights-v1',
          'checkout_acknowledgement', 'I have read and accept the Flexible Hours terms, cancellation rules and unused-value refund basis.',
          'immediate_access_request', 'I expressly request immediate access to my Flexible Hours during the 14-day cancellation period and understand that properly used or late-cancelled value may be deducted.'
        ),
        'checkout_disclosure', 'Pay by Bank. Access is created only after verified signed webhook confirmation.'
      ),
      'flexible-hours-v1', TIMESTAMPTZ '2026-08-16 00:00:00+00'
    );
  END IF;
END;
$$ LANGUAGE plpgsql;

SELECT seed_flexible_hours_package_catalogue(id) FROM schools;

CREATE OR REPLACE FUNCTION seed_flexible_hours_packages_for_new_school()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM seed_flexible_hours_package_catalogue(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_seed_flexible_hours_packages_for_new_school ON schools;
CREATE TRIGGER trg_seed_flexible_hours_packages_for_new_school
AFTER INSERT ON schools
FOR EACH ROW EXECUTE FUNCTION seed_flexible_hours_packages_for_new_school();

CREATE TABLE IF NOT EXISTS flexible_package_purchase_attempts (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  learner_id INTEGER,
  product_id BIGINT NOT NULL,
  product_version_id BIGINT NOT NULL,
  product_slug TEXT NOT NULL,
  product_snapshot JSONB NOT NULL,
  amount_pence INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'GBP',
  total_units INTEGER NOT NULL,
  unit_minutes INTEGER NOT NULL DEFAULT 30,
  rate_pence_per_unit INTEGER NOT NULL,
  customer_terms_version TEXT NOT NULL,
  disclosure_version TEXT NOT NULL,
  adult_age_confirmed BOOLEAN NOT NULL,
  terms_accepted BOOLEAN NOT NULL,
  immediate_access_requested BOOLEAN NOT NULL,
  stripe_mode TEXT NOT NULL DEFAULT 'live',
  status TEXT NOT NULL DEFAULT 'created',
  client_request_id UUID NOT NULL,
  idempotency_key TEXT NOT NULL,
  stripe_payment_method_configuration_id TEXT NOT NULL,
  stripe_checkout_session_id TEXT,
  stripe_payment_intent_id TEXT,
  stripe_charge_id TEXT,
  stripe_checkout_url TEXT,
  provider_expires_at TIMESTAMPTZ,
  review_after TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  checkout_created_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  expired_at TIMESTAMPTZ,
  review_required_at TIMESTAMPTZ,
  failure_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, learner_id, client_request_id),
  UNIQUE (idempotency_key),
  UNIQUE (stripe_checkout_session_id),
  UNIQUE (stripe_payment_intent_id),
  FOREIGN KEY (learner_id, school_id) REFERENCES learner_users(id, school_id) ON DELETE SET NULL (learner_id),
  FOREIGN KEY (product_id, school_id) REFERENCES package_products(id, school_id),
  FOREIGN KEY (product_version_id, school_id, product_id) REFERENCES package_product_versions(id, school_id, product_id),
  CHECK (product_slug IN ('flexible-15-hours', 'flexible-30-hours')),
  CHECK (jsonb_typeof(product_snapshot) = 'object'),
  CHECK (amount_pence IN (81000, 159000)),
  CHECK (currency = 'GBP'),
  CHECK (unit_minutes = 30),
  CHECK ((total_units = 30 AND amount_pence = 81000 AND rate_pence_per_unit = 2700)
      OR (total_units = 60 AND amount_pence = 159000 AND rate_pence_per_unit = 2650)),
  CHECK (adult_age_confirmed = TRUE AND terms_accepted = TRUE AND immediate_access_requested = TRUE),
  CHECK (stripe_mode = 'live'),
  CHECK (status IN ('created','submitting','pending','paid','failed','expired','review_required'))
);

CREATE INDEX IF NOT EXISTS idx_flexible_attempts_learner
  ON flexible_package_purchase_attempts(school_id, learner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_flexible_attempts_review
  ON flexible_package_purchase_attempts(school_id, status, review_after);
CREATE UNIQUE INDEX IF NOT EXISTS uq_flexible_attempt_active_product
  ON flexible_package_purchase_attempts(school_id, learner_id, product_id)
  WHERE status IN ('created','submitting','pending','review_required');

CREATE TABLE IF NOT EXISTS flexible_package_payment_events (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  attempt_id UUID NOT NULL,
  stripe_event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  stripe_object_id TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  provider_created_at TIMESTAMPTZ,
  processing_state TEXT NOT NULL DEFAULT 'processing',
  delivery_count INTEGER NOT NULL DEFAULT 1,
  first_received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  failure_code TEXT,
  UNIQUE (id, school_id),
  FOREIGN KEY (attempt_id, school_id) REFERENCES flexible_package_purchase_attempts(id, school_id),
  CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (processing_state IN ('processing','processed','failed')),
  CHECK (delivery_count > 0)
);

CREATE INDEX IF NOT EXISTS idx_flexible_payment_events_attempt
  ON flexible_package_payment_events(school_id, attempt_id, provider_created_at, id);

CREATE TABLE IF NOT EXISTS flexible_package_purchases (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  learner_id INTEGER,
  attempt_id UUID NOT NULL,
  product_id BIGINT NOT NULL,
  product_version_id BIGINT NOT NULL,
  product_slug TEXT NOT NULL,
  product_snapshot JSONB NOT NULL,
  amount_pence INTEGER NOT NULL,
  currency TEXT NOT NULL,
  total_units INTEGER NOT NULL,
  unit_minutes INTEGER NOT NULL,
  rate_pence_per_unit INTEGER NOT NULL,
  customer_terms_version TEXT NOT NULL,
  stripe_checkout_session_id TEXT NOT NULL,
  stripe_payment_intent_id TEXT,
  paid_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (attempt_id),
  FOREIGN KEY (learner_id, school_id) REFERENCES learner_users(id, school_id) ON DELETE SET NULL (learner_id),
  FOREIGN KEY (attempt_id, school_id) REFERENCES flexible_package_purchase_attempts(id, school_id),
  FOREIGN KEY (product_id, school_id) REFERENCES package_products(id, school_id),
  FOREIGN KEY (product_version_id, school_id, product_id) REFERENCES package_product_versions(id, school_id, product_id),
  CHECK (product_slug IN ('flexible-15-hours','flexible-30-hours')),
  CHECK (currency = 'GBP' AND unit_minutes = 30),
  CHECK (jsonb_typeof(product_snapshot) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_flexible_purchases_learner
  ON flexible_package_purchases(school_id, learner_id, paid_at DESC);

CREATE TABLE IF NOT EXISTS flexible_package_sources (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  learner_id INTEGER,
  purchase_id BIGINT NOT NULL,
  product_version_id BIGINT NOT NULL,
  initial_units INTEGER NOT NULL,
  unit_minutes INTEGER NOT NULL DEFAULT 30,
  rate_pence_per_unit INTEGER NOT NULL,
  original_value_pence INTEGER NOT NULL,
  original_stripe_fee_pence INTEGER,
  stripe_fee_evidence JSONB,
  available_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (purchase_id),
  FOREIGN KEY (learner_id, school_id) REFERENCES learner_users(id, school_id) ON DELETE SET NULL (learner_id),
  FOREIGN KEY (purchase_id, school_id) REFERENCES flexible_package_purchases(id, school_id),
  FOREIGN KEY (product_version_id, school_id) REFERENCES package_product_versions(id, school_id),
  CHECK (initial_units > 0 AND unit_minutes = 30 AND rate_pence_per_unit > 0),
  CHECK (original_value_pence = initial_units * rate_pence_per_unit),
  CHECK (original_stripe_fee_pence IS NULL OR original_stripe_fee_pence >= 0),
  CHECK (stripe_fee_evidence IS NULL OR jsonb_typeof(stripe_fee_evidence) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_flexible_sources_fifo
  ON flexible_package_sources(school_id, learner_id, available_at, id);

CREATE TABLE IF NOT EXISTS flexible_package_booking_allocations (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  learner_id INTEGER,
  source_id BIGINT NOT NULL,
  booking_id INTEGER NOT NULL,
  instructor_id INTEGER NOT NULL,
  units_allocated INTEGER NOT NULL,
  unit_minutes INTEGER NOT NULL DEFAULT 30,
  rate_pence_per_unit INTEGER NOT NULL,
  contribution_pence INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, source_id, booking_id),
  FOREIGN KEY (learner_id, school_id) REFERENCES learner_users(id, school_id) ON DELETE SET NULL (learner_id),
  FOREIGN KEY (source_id, school_id) REFERENCES flexible_package_sources(id, school_id),
  FOREIGN KEY (booking_id, school_id) REFERENCES lesson_bookings(id, school_id),
  FOREIGN KEY (instructor_id, school_id) REFERENCES instructors(id, school_id),
  CHECK (units_allocated > 0 AND unit_minutes = 30 AND rate_pence_per_unit > 0),
  CHECK (contribution_pence = units_allocated * rate_pence_per_unit)
);

CREATE INDEX IF NOT EXISTS idx_flexible_allocations_booking
  ON flexible_package_booking_allocations(school_id, booking_id);
CREATE INDEX IF NOT EXISTS idx_flexible_allocations_instructor
  ON flexible_package_booking_allocations(school_id, instructor_id, created_at);

CREATE TABLE IF NOT EXISTS flexible_package_allocation_returns (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  allocation_id BIGINT NOT NULL,
  booking_id INTEGER NOT NULL,
  units_returned INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT 'learner_cancelled_48h_plus',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (allocation_id),
  FOREIGN KEY (allocation_id, school_id) REFERENCES flexible_package_booking_allocations(id, school_id),
  FOREIGN KEY (booking_id, school_id) REFERENCES lesson_bookings(id, school_id),
  CHECK (units_returned > 0),
  CHECK (reason IN ('learner_cancelled_48h_plus','admin_eligible_cancellation'))
);

CREATE INDEX IF NOT EXISTS idx_flexible_returns_booking
  ON flexible_package_allocation_returns(school_id, booking_id);

CREATE OR REPLACE FUNCTION validate_flexible_package_allocation_return()
RETURNS TRIGGER AS $$
DECLARE allocation flexible_package_booking_allocations%ROWTYPE;
BEGIN
  SELECT * INTO allocation
    FROM flexible_package_booking_allocations
   WHERE id = NEW.allocation_id;
  IF NOT FOUND
     OR allocation.school_id <> NEW.school_id
     OR allocation.booking_id <> NEW.booking_id
     OR allocation.units_allocated <> NEW.units_returned THEN
    RAISE EXCEPTION 'Flexible Hours return must exactly match its allocation'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_flexible_allocation_return_exact
  ON flexible_package_allocation_returns;
CREATE TRIGGER trg_flexible_allocation_return_exact
  BEFORE INSERT ON flexible_package_allocation_returns
  FOR EACH ROW EXECUTE FUNCTION validate_flexible_package_allocation_return();

CREATE TABLE IF NOT EXISTS flexible_package_source_reductions (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  learner_id INTEGER,
  source_id BIGINT NOT NULL,
  units_reduced INTEGER NOT NULL,
  rate_pence_per_unit INTEGER NOT NULL,
  gross_refund_pence INTEGER NOT NULL,
  stripe_fee_deduction_pence INTEGER NOT NULL DEFAULT 0,
  learner_refund_pence INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'manual_original_method_refund',
  provider_refund_id TEXT,
  evidence_reference TEXT NOT NULL,
  recorded_by_admin_id INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (provider_refund_id),
  FOREIGN KEY (learner_id, school_id) REFERENCES learner_users(id, school_id) ON DELETE SET NULL (learner_id),
  FOREIGN KEY (source_id, school_id) REFERENCES flexible_package_sources(id, school_id),
  FOREIGN KEY (recorded_by_admin_id) REFERENCES admin_users(id),
  CHECK (units_reduced > 0 AND rate_pence_per_unit > 0),
  CHECK (gross_refund_pence = units_reduced * rate_pence_per_unit),
  CHECK (stripe_fee_deduction_pence = 0),
  CHECK (learner_refund_pence = gross_refund_pence),
  CHECK (kind IN ('manual_original_method_refund','admin_correction'))
);

CREATE INDEX IF NOT EXISTS idx_flexible_reductions_source
  ON flexible_package_source_reductions(school_id, source_id, created_at);

CREATE TABLE IF NOT EXISTS flexible_package_state_events (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  learner_id INTEGER,
  event_type TEXT NOT NULL,
  attempt_id UUID,
  purchase_id BIGINT,
  source_id BIGINT,
  booking_id INTEGER,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  FOREIGN KEY (learner_id, school_id) REFERENCES learner_users(id, school_id) ON DELETE SET NULL (learner_id),
  FOREIGN KEY (attempt_id, school_id) REFERENCES flexible_package_purchase_attempts(id, school_id),
  FOREIGN KEY (purchase_id, school_id) REFERENCES flexible_package_purchases(id, school_id),
  FOREIGN KEY (source_id, school_id) REFERENCES flexible_package_sources(id, school_id),
  FOREIGN KEY (booking_id, school_id) REFERENCES lesson_bookings(id, school_id),
  CHECK (jsonb_typeof(detail) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_flexible_state_events_scope
  ON flexible_package_state_events(school_id, learner_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_flexible_state_events_exception
  ON flexible_package_state_events(school_id, event_type, created_at DESC);

CREATE OR REPLACE VIEW flexible_package_source_remaining AS
SELECT s.id AS source_id, s.school_id, s.learner_id, s.purchase_id,
       s.initial_units, s.unit_minutes, s.rate_pence_per_unit,
       GREATEST(0, s.initial_units
         - COALESCE((SELECT SUM(r.units_reduced) FROM flexible_package_source_reductions r
                      WHERE r.source_id = s.id AND r.school_id = s.school_id), 0)
         - COALESCE((SELECT SUM(a.units_allocated)
                       FROM flexible_package_booking_allocations a
                      WHERE a.source_id = s.id AND a.school_id = s.school_id
                        AND NOT EXISTS (
                          SELECT 1 FROM flexible_package_allocation_returns ar
                           WHERE ar.allocation_id = a.id AND ar.school_id = a.school_id
                        )), 0)
       )::INTEGER AS remaining_units,
       GREATEST(0, s.initial_units
         - COALESCE((SELECT SUM(r.units_reduced) FROM flexible_package_source_reductions r
                      WHERE r.source_id = s.id AND r.school_id = s.school_id), 0)
         - COALESCE((SELECT SUM(a.units_allocated)
                       FROM flexible_package_booking_allocations a
                      WHERE a.source_id = s.id AND a.school_id = s.school_id
                        AND NOT EXISTS (
                          SELECT 1 FROM flexible_package_allocation_returns ar
                           WHERE ar.allocation_id = a.id AND ar.school_id = a.school_id
                        )), 0)
       )::INTEGER * s.rate_pence_per_unit AS refundable_value_pence,
       s.available_at, s.created_at
  FROM flexible_package_sources s;

CREATE OR REPLACE VIEW flexible_package_balances AS
SELECT school_id, learner_id,
       COALESCE(SUM(remaining_units), 0)::INTEGER AS remaining_units,
       COALESCE(SUM(remaining_units * unit_minutes), 0)::INTEGER AS remaining_minutes,
       COALESCE(SUM(refundable_value_pence), 0)::INTEGER AS refundable_value_pence
  FROM flexible_package_source_remaining
 WHERE learner_id IS NOT NULL
 GROUP BY school_id, learner_id;

CREATE OR REPLACE FUNCTION forbid_flexible_package_evidence_change()
RETURNS TRIGGER AS $$
BEGIN
  -- Financial evidence is retained for seven years, but GDPR erasure must be
  -- able to detach the learner identity without changing any financial fact.
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(OLD) ? 'learner_id')
     AND (to_jsonb(OLD) -> 'learner_id') <> 'null'::jsonb
     AND (to_jsonb(NEW) -> 'learner_id') = 'null'::jsonb
     AND (to_jsonb(NEW) - 'learner_id') = (to_jsonb(OLD) - 'learner_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'flexible_package_purchases', 'flexible_package_sources',
    'flexible_package_booking_allocations', 'flexible_package_allocation_returns',
    'flexible_package_source_reductions', 'flexible_package_state_events'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_append_only ON %I', table_name, table_name);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_flexible_package_evidence_change()',
      table_name, table_name
    );
  END LOOP;
END $$;

-- ============================================================
-- Migration 051: Flexible Hours credit-flow alignment
-- ============================================================
DROP INDEX IF EXISTS uq_flexible_attempt_active_product;
CREATE UNIQUE INDEX IF NOT EXISTS uq_flexible_attempt_active_learner
  ON flexible_package_purchase_attempts(school_id, learner_id)
  WHERE status IN ('created','submitting','pending','review_required');

ALTER TABLE flexible_package_allocation_returns
  DROP CONSTRAINT IF EXISTS flexible_package_allocation_returns_reason_check;
ALTER TABLE flexible_package_allocation_returns
  ADD CONSTRAINT flexible_package_allocation_returns_reason_check
  CHECK (reason IN (
    'learner_cancelled_48h_plus',
    'admin_eligible_cancellation',
    'rescheduled_48h_plus'
  ));
