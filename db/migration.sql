-- CoachCarter Database Migration
-- Idempotent — safe to run multiple times.
-- Every table and column the application expects is defined here.

-- ══════════════════════════════════════════════════════════════════════════════
-- LEARNER USERS
-- ══════════════════════════════════════════════════════════════════════════════
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

-- ══════════════════════════════════════════════════════════════════════════════
-- MAGIC LINK TOKENS
-- ══════════════════════════════════════════════════════════════════════════════
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

-- ══════════════════════════════════════════════════════════════════════════════
-- INSTRUCTORS
-- ══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS instructors (
  id             SERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  email          TEXT UNIQUE NOT NULL,
  phone          TEXT,
  bio            TEXT,
  photo_url      TEXT,
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  buffer_minutes INTEGER DEFAULT 30,
  calendar_token TEXT UNIQUE,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════════════════════════
-- INSTRUCTOR LOGIN TOKENS
-- ══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS instructor_login_tokens (
  id            SERIAL PRIMARY KEY,
  instructor_id INTEGER NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
  token         TEXT NOT NULL UNIQUE,
  expires_at    TIMESTAMPTZ NOT NULL,
  used          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════════════════════════
-- INSTRUCTOR AVAILABILITY
-- ══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS instructor_availability (
  id            SERIAL PRIMARY KEY,
  instructor_id INTEGER NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
  day_of_week   INTEGER NOT NULL,
  start_time    TIME NOT NULL,
  end_time      TIME NOT NULL,
  active        BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════════════════════════
-- INSTRUCTOR BLACKOUT DATES
-- ══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS instructor_blackout_dates (
  id            SERIAL PRIMARY KEY,
  instructor_id INTEGER NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
  blackout_date DATE NOT NULL,
  reason        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_blackout_date UNIQUE (instructor_id, blackout_date)
);

-- ══════════════════════════════════════════════════════════════════════════════
-- LESSON BOOKINGS
-- ══════════════════════════════════════════════════════════════════════════════
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

-- ══════════════════════════════════════════════════════════════════════════════
-- SLOT RESERVATIONS (temporary holds during Stripe checkout)
-- ══════════════════════════════════════════════════════════════════════════════
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

-- ══════════════════════════════════════════════════════════════════════════════
-- CREDIT TRANSACTIONS
-- ══════════════════════════════════════════════════════════════════════════════
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

-- ══════════════════════════════════════════════════════════════════════════════
-- DRIVING SESSIONS (lesson logs)
-- ══════════════════════════════════════════════════════════════════════════════
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

-- ══════════════════════════════════════════════════════════════════════════════
-- SKILL RATINGS
-- ══════════════════════════════════════════════════════════════════════════════
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

-- ══════════════════════════════════════════════════════════════════════════════
-- ADMIN USERS
-- ══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS admin_users (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'admin',
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════════════════════════
-- SITE CONFIG
-- ══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS site_config (
  id         INTEGER PRIMARY KEY DEFAULT 1,
  config     JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════════════════════════
-- ENQUIRIES
-- ══════════════════════════════════════════════════════════════════════════════
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

-- ══════════════════════════════════════════════════════════════════════════════
-- GUARANTEE PRICING
-- ══════════════════════════════════════════════════════════════════════════════
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

-- ══════════════════════════════════════════════════════════════════════════════
-- GOOGLE REVIEWS CACHE
-- ══════════════════════════════════════════════════════════════════════════════
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

-- ══════════════════════════════════════════════════════════════════════════════
-- Q&A
-- ══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS qa_questions (
  id         SERIAL PRIMARY KEY,
  learner_id INTEGER NOT NULL,
  booking_id INTEGER,
  session_id INTEGER,
  title      TEXT NOT NULL,
  body       TEXT,
  status     TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS qa_answers (
  id          SERIAL PRIMARY KEY,
  question_id INTEGER NOT NULL,
  author_type TEXT NOT NULL,
  author_id   INTEGER NOT NULL,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════════════════════════
-- LEARNER ONBOARDING
-- ══════════════════════════════════════════════════════════════════════════════
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

-- ══════════════════════════════════════════════════════════════════════════════
-- QUIZ RESULTS
-- ══════════════════════════════════════════════════════════════════════════════
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

-- ══════════════════════════════════════════════════════════════════════════════
-- MOCK TESTS
-- ══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS mock_tests (
  id                     SERIAL PRIMARY KEY,
  learner_id             INTEGER NOT NULL REFERENCES learner_users(id) ON DELETE CASCADE,
  started_at             TIMESTAMPTZ DEFAULT NOW(),
  completed_at           TIMESTAMPTZ,
  result                 TEXT,
  total_driving_faults   INTEGER DEFAULT 0,
  total_serious_faults   INTEGER DEFAULT 0,
  total_dangerous_faults INTEGER DEFAULT 0,
  notes                  TEXT
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

-- ══════════════════════════════════════════════════════════════════════════════
-- AVAILABILITY SUBMISSIONS (public enquiry form)
-- ══════════════════════════════════════════════════════════════════════════════
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

-- ══════════════════════════════════════════════════════════════════════════════
-- INSTRUCTOR LEARNER NOTES (per instructor-learner pair)
-- ══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS instructor_learner_notes (
  id              SERIAL PRIMARY KEY,
  instructor_id   INTEGER NOT NULL REFERENCES instructors(id),
  learner_id      INTEGER NOT NULL REFERENCES learner_users(id),
  notes           TEXT,
  test_date       DATE,
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(instructor_id, learner_id)
);

-- ══════════════════════════════════════════════════════════════════════════════
-- FEATURE 2: RESCHEDULING
-- ══════════════════════════════════════════════════════════════════════════════
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS rescheduled_from INTEGER REFERENCES lesson_bookings(id);
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS reschedule_count INTEGER DEFAULT 0;

-- ══════════════════════════════════════════════════════════════════════════════
-- FEATURE 10: SCHEDULING LEAD TIME
-- ══════════════════════════════════════════════════════════════════════════════
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS min_booking_notice_hours INTEGER DEFAULT 24;
