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

-- Ensure instructor_notes column exists (may be missing if table was created before it was added)
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS instructor_notes TEXT;

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

-- ══════════════════════════════════════════════════════════════════════════════
-- FEATURE 5: INSTRUCTOR-INITIATED BOOKING
-- ══════════════════════════════════════════════════════════════════════════════
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS created_by TEXT DEFAULT 'learner';
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'credit';

-- ══════════════════════════════════════════════════════════════════════════════
-- FEATURE 7: PER-BOOKING ADDRESSES
-- ══════════════════════════════════════════════════════════════════════════════
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS pickup_address TEXT;
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS dropoff_address TEXT;

-- ══════════════════════════════════════════════════════════════════════════════
-- FEATURE 8: CALENDAR START HOUR
-- ══════════════════════════════════════════════════════════════════════════════
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS calendar_start_hour INTEGER DEFAULT 7;

-- ══════════════════════════════════════════════════════════════════════════════
-- FEATURE 3: MULTIPLE LESSON TYPES & DURATIONS
-- ══════════════════════════════════════════════════════════════════════════════

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

-- ══════════════════════════════════════════════════════════════════════════════
-- LESSON REMINDERS (Feature 1)
-- ══════════════════════════════════════════════════════════════════════════════
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

-- ══════════════════════════════════════════════════════════════════════════════
-- RECURRING/REPEAT BOOKINGS (Feature 6)
-- ══════════════════════════════════════════════════════════════════════════════
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS series_id UUID;

-- ══════════════════════════════════════════════════════════════════════════════
-- INSTRUCTOR EARNINGS (Feature – Earnings Dashboard)
-- ══════════════════════════════════════════════════════════════════════════════
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(4,3) DEFAULT 0.850;

-- Instructor profile enhancement — qualifications, vehicle, service area, languages
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

-- ══════════════════════════════════════════════════════════════════════════════
-- POST-LESSON CONFIRMATION (Feature – Dual Confirmation System)
-- ══════════════════════════════════════════════════════════════════════════════
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

-- ══════════════════════════════════════════════════════════════════════════════
-- DEMO EARNINGS DATA (seed Simon Edwards' diary for dashboard demo)
-- Safe to re-run: ON CONFLICT DO NOTHING.
-- To clean up: DELETE FROM lesson_bookings WHERE instructor_notes = 'demo-seed';
-- ══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_instructor_id INTEGER;
  v_learner_id    INTEGER;
  v_lesson_type   INTEGER;
  v_week_start    DATE;
  v_day           DATE;
BEGIN
  SELECT id INTO v_instructor_id FROM instructors WHERE LOWER(name) LIKE '%simon%edwards%' LIMIT 1;
  IF v_instructor_id IS NULL THEN RAISE NOTICE 'Instructor "Simon Edwards" not found — skipping seed.'; RETURN; END IF;

  SELECT id INTO v_learner_id FROM learner_users WHERE LOWER(name) LIKE '%fraser%' LIMIT 1;
  IF v_learner_id IS NULL THEN SELECT id INTO v_learner_id FROM learner_users WHERE credit_balance > 0 OR balance_minutes > 0 ORDER BY credit_balance DESC LIMIT 1; END IF;
  IF v_learner_id IS NULL THEN SELECT id INTO v_learner_id FROM learner_users ORDER BY id LIMIT 1; END IF;
  IF v_learner_id IS NULL THEN RAISE NOTICE 'No learners found — skipping seed.'; RETURN; END IF;

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


-- ══════════════════════════════════════════════════════════════════════════════
-- 020 — Learner Weekly Availability
-- ══════════════════════════════════════════════════════════════════════════════

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


-- ══════════════════════════════════════════════════════════════════════════════
-- 021 — Waiting List
-- ══════════════════════════════════════════════════════════════════════════════

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

-- ── Lesson offers (instructor-initiated, pending learner acceptance + payment) ──
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
