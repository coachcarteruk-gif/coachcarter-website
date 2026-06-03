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
-- INSTRUCTOR BLACKOUT DATES (supports date ranges via blackout_date + end_date)
-- ══════════════════════════════════════════════════════════════════════════════
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

-- Track reason for cancellation (e.g. 'Cancelled in Setmore', 'learner_request')
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

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

-- ── Stripe Connect & Instructor Payouts ──
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS stripe_account_id TEXT;
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS stripe_onboarding_complete BOOLEAN DEFAULT FALSE;
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS payouts_paused BOOLEAN DEFAULT FALSE;
-- Date floor for auto-payouts. NULL = no floor (legacy behaviour). When set, only bookings on
-- or after this date are swept by the Friday cron — protects against backfilled bookings being
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

-- ── Fix lesson_bookings status constraint to include all valid statuses ──
ALTER TABLE lesson_bookings DROP CONSTRAINT IF EXISTS lesson_bookings_status_check;
ALTER TABLE lesson_bookings ADD CONSTRAINT lesson_bookings_status_check
  CHECK (status IN ('confirmed', 'completed', 'cancelled', 'rescheduled', 'awaiting_confirmation', 'disputed', 'no_show'));

-- ── Sync credit_transactions.type CHECK with values the codebase actually writes ──
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
-- trials). PER-INSTRUCTOR-CREDITS-PLAN.md §Step 2.
--
-- Step 2c Plan B1 (May 2026) added 'legacy_grandfather' for the synthetic
-- CT rows emitted by /api/migrate-step-2c-reattribute. One synthetic CT
-- per moved grandfathered LCB row, paired with source='reconciliation'
-- and payment_method='migration'. Lets the divergence cron's
-- expected = ΣCT − Σmin_deducted formula reconcile against the moved
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
    'legacy_grandfather'
  ));

-- ── Weekly franchise fee model (alternative to commission_rate) ──
-- When non-NULL, platform takes this fixed amount per week instead of per-lesson commission.
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS weekly_franchise_fee_pence INTEGER DEFAULT NULL;
-- Audit trail: actual franchise fee deducted for each payout (may be less than configured if gross was lower)
ALTER TABLE instructor_payouts ADD COLUMN IF NOT EXISTS franchise_fee_pence INTEGER DEFAULT NULL;

-- ── Shortfall tracking (plan item 1.3) + £250 vehicle deposit deduction (plan item 2.10) ──
-- shortfall_pence: positive value = amount instructor owes CCL from this period (rolls forward to next positive payout).
-- shortfall_recovered_from_payout_id: NULL until the shortfall is recovered; set to the recovering payout's id when cleared.
-- deposit_deducted_pence: £250 (25000) deducted from week-1 Full-Franchise payouts; stores actual amount when revenue can't cover full amount.
ALTER TABLE instructor_payouts ADD COLUMN IF NOT EXISTS shortfall_pence INTEGER NOT NULL DEFAULT 0;
ALTER TABLE instructor_payouts ADD COLUMN IF NOT EXISTS shortfall_recovered_from_payout_id INTEGER REFERENCES instructor_payouts(id);
ALTER TABLE instructor_payouts ADD COLUMN IF NOT EXISTS deposit_deducted_pence INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_instructor_payouts_unrecovered_shortfall
  ON instructor_payouts (instructor_id, period_end)
  WHERE status = 'completed' AND shortfall_pence > 0 AND shortfall_recovered_from_payout_id IS NULL;

-- ── Setmore sync ──────────────────────────────────────────────────────────────

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

-- ══════════════════════════════════════════════════════════════════════════════
-- MULTI-TENANT: SCHOOLS
-- ══════════════════════════════════════════════════════════════════════════════

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

-- ══════════════════════════════════════════════════════════════════════════════
-- MULTI-TENANT: SCHOOL PAYOUTS
-- ══════════════════════════════════════════════════════════════════════════════

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

-- ── PR-H (audit #10) ──────────────────────────────────────────────────────────
-- Normalised line-items table mirroring payout_line_items on the instructor
-- side. The school_payouts.booking_ids array had no per-booking uniqueness
-- across rows, so a crash between INSERT (status='processing') and the Stripe
-- transfer call could leave an orphan 'processing' row holding bookings that
-- the next cron run also considered eligible (the eligibility filter only
-- excluded 'completed' rows). Result: same bookings paid twice.
--
-- UNIQUE(booking_id) on the line-items table makes the second INSERT fail
-- regardless of the parent row's status — same shape as uq_payout_booking.

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
-- 'completed' rows matter for the eligibility filter — historically-paid
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

-- ══════════════════════════════════════════════════════════════════════════════
-- MULTI-TENANT: ADD school_id TO ALL TENANT-SCOPED TABLES
-- ══════════════════════════════════════════════════════════════════════════════

-- Add school_id column to each table, backfill to 1, set NOT NULL + default
-- Using DO blocks so each ALTER is safe if column already exists

-- 1. learner_users
ALTER TABLE learner_users ADD COLUMN IF NOT EXISTS school_id INTEGER REFERENCES schools(id);
UPDATE learner_users SET school_id = 1 WHERE school_id IS NULL;
ALTER TABLE learner_users ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE learner_users ALTER COLUMN school_id SET DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_learner_users_school ON learner_users(school_id);

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

-- ══════════════════════════════════════════════════════════════════════════════
-- MULTI-TENANT: ADMIN USERS — link to school (NULL = superadmin / platform)
-- ══════════════════════════════════════════════════════════════════════════════
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS school_id INTEGER REFERENCES schools(id);
-- Backfill existing admins to CoachCarter
UPDATE admin_users SET school_id = 1 WHERE school_id IS NULL AND role = 'admin';
-- superadmin rows keep school_id = NULL (platform-level)

-- ══════════════════════════════════════════════════════════════════════════════
-- MULTI-TENANT: INSTRUCTOR ONBOARDING FLAG
-- ══════════════════════════════════════════════════════════════════════════════
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS onboarding_complete BOOLEAN DEFAULT FALSE;
-- Backfill existing instructors as complete
UPDATE instructors SET onboarding_complete = TRUE WHERE onboarding_complete IS NULL OR onboarding_complete = FALSE;

-- ══════════════════════════════════════════════════════════════════════════════
-- INSTRUCTOR BOOKING SLUG (friendly URLs: /book/fraser)
-- ══════════════════════════════════════════════════════════════════════════════
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS slug TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_instructors_slug ON instructors (slug) WHERE slug IS NOT NULL;
-- Backfill slugs from first name (lowercase, alphanumeric + hyphens only)
UPDATE instructors SET slug = LOWER(REGEXP_REPLACE(SPLIT_PART(name, ' ', 1), '[^a-zA-Z0-9]', '', 'g'))
  WHERE slug IS NULL AND name IS NOT NULL;

-- ══════════════════════════════════════════════════════════════════════════════
-- GDPR: COOKIE CONSENTS
-- ══════════════════════════════════════════════════════════════════════════════
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

-- ══════════════════════════════════════════════════════════════════════════════
-- GDPR: AUDIT LOG
-- ══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS audit_log (
  id           SERIAL PRIMARY KEY,
  admin_id     INTEGER NOT NULL,
  admin_email  TEXT,
  action       TEXT NOT NULL,
  target_type  TEXT,
  target_id    INTEGER,
  details      JSONB,
  ip_address   TEXT,
  school_id    INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_school ON audit_log(school_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_target ON audit_log(target_type, target_id);

-- ══════════════════════════════════════════════════════════════════════════════
-- GDPR: DELETION REQUESTS
-- ══════════════════════════════════════════════════════════════════════════════
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

-- ══════════════════════════════════════════════════════════════════════════════
-- GDPR: DATA RETENTION COLUMNS
-- ══════════════════════════════════════════════════════════════════════════════
ALTER TABLE learner_users ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;
ALTER TABLE learner_users ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
UPDATE learner_users SET last_activity_at = created_at WHERE last_activity_at IS NULL;

ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS school_id INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id);
CREATE INDEX IF NOT EXISTS idx_enquiries_school_id ON enquiries(school_id);

-- Multi-tenancy backfill for availability_submissions (added 2026-04-10)
ALTER TABLE availability_submissions ADD COLUMN IF NOT EXISTS school_id INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id);
CREATE INDEX IF NOT EXISTS idx_availability_submissions_school_id ON availability_submissions(school_id);

-- ══════════════════════════════════════════════════════════════════════════════
-- GDPR: CREDIT TRANSACTIONS — allow learner_id NULL for anonymization
-- ══════════════════════════════════════════════════════════════════════════════
ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS anonymized BOOLEAN DEFAULT FALSE;

ALTER TABLE credit_transactions DROP CONSTRAINT IF EXISTS credit_transactions_learner_id_fkey;
ALTER TABLE credit_transactions ALTER COLUMN learner_id DROP NOT NULL;
DO $$ BEGIN
  ALTER TABLE credit_transactions ADD CONSTRAINT credit_transactions_learner_id_fkey
    FOREIGN KEY (learner_id) REFERENCES learner_users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- SECURITY: RATE LIMITING
-- ══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS rate_limits (
  id            SERIAL PRIMARY KEY,
  key           TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1,
  window_start  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_key ON rate_limits(key);

-- ══════════════════════════════════════════════════════════════════════════════
-- PERFORMANCE: FOREIGN KEY INDEXES (HIGH PRIORITY)
-- Missing indexes on frequently queried FK columns. Every JOIN and DELETE
-- CASCADE benefits from these.
-- ══════════════════════════════════════════════════════════════════════════════

-- lesson_bookings — most queried table, was missing all FK indexes
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

-- credit_transactions — queried on every profile/dashboard load
CREATE INDEX IF NOT EXISTS idx_credit_transactions_learner_id ON credit_transactions(learner_id);

-- driving_sessions — progress tracking queries
CREATE INDEX IF NOT EXISTS idx_driving_sessions_user_id ON driving_sessions(user_id);

-- skill_ratings — progress tracking queries
CREATE INDEX IF NOT EXISTS idx_skill_ratings_user_id ON skill_ratings(user_id);

-- quiz_results / mock_tests — learner progress
CREATE INDEX IF NOT EXISTS idx_quiz_results_learner_id ON quiz_results(learner_id);
CREATE INDEX IF NOT EXISTS idx_mock_tests_learner_id ON mock_tests(learner_id);

-- slot_reservations — booking flow
CREATE INDEX IF NOT EXISTS idx_slot_reservations_learner_id ON slot_reservations(learner_id);
CREATE INDEX IF NOT EXISTS idx_slot_reservations_instructor_id ON slot_reservations(instructor_id);

-- instructor notes — learner detail page
CREATE INDEX IF NOT EXISTS idx_instructor_learner_notes_learner_id ON instructor_learner_notes(learner_id);
CREATE INDEX IF NOT EXISTS idx_instructor_learner_notes_instructor_id ON instructor_learner_notes(instructor_id);

-- ══════════════════════════════════════════════════════════════════════════════
-- PERFORMANCE: MEDIUM PRIORITY FK INDEXES
-- ══════════════════════════════════════════════════════════════════════════════

-- lesson_confirmations — joined on booking lookups
CREATE INDEX IF NOT EXISTS idx_lesson_confirmations_booking_id ON lesson_confirmations(booking_id);

-- sent_reminders — reminder dedup checks
CREATE INDEX IF NOT EXISTS idx_sent_reminders_booking_id ON sent_reminders(booking_id);

-- lesson_offers — offer lookups by learner
CREATE INDEX IF NOT EXISTS idx_lesson_offers_learner_id ON lesson_offers(learner_id);

-- instructor_availability — filtered by instructor
CREATE INDEX IF NOT EXISTS idx_instructor_availability_instructor_id ON instructor_availability(instructor_id);

-- instructor_login_tokens — token lookup by instructor
CREATE INDEX IF NOT EXISTS idx_instructor_login_tokens_instructor_id ON instructor_login_tokens(instructor_id);

-- magic_link_tokens — login lookups by email/phone
CREATE INDEX IF NOT EXISTS idx_magic_link_tokens_email ON magic_link_tokens(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_magic_link_tokens_phone ON magic_link_tokens(phone) WHERE phone IS NOT NULL;
ALTER TABLE magic_link_tokens ADD COLUMN IF NOT EXISTS school_id INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id);

-- admin_users — school scoping
CREATE INDEX IF NOT EXISTS idx_admin_users_school_id ON admin_users(school_id) WHERE school_id IS NOT NULL;

-- ══════════════════════════════════════════════════════════════════════════════
-- PERFORMANCE: DEFAULTS & CONSTRAINTS
-- ══════════════════════════════════════════════════════════════════════════════

-- Ensure new learners get last_activity_at set automatically
ALTER TABLE learner_users ALTER COLUMN last_activity_at SET DEFAULT NOW();

-- ══════════════════════════════════════════════════════════════════════════════
-- GDPR: TERMS & CONDITIONS ACCEPTANCE
-- ══════════════════════════════════════════════════════════════════════════════
ALTER TABLE learner_users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;

-- ══════════════════════════════════════════════════════════════════════════════
-- MOCK TEST MODES & FOCUSED PRACTICE (April 2026)
-- ══════════════════════════════════════════════════════════════════════════════

-- Mock test mode split: supervisor vs instructor
ALTER TABLE mock_tests ADD COLUMN IF NOT EXISTS mode TEXT;
ALTER TABLE mock_tests ADD COLUMN IF NOT EXISTS route_id TEXT;
ALTER TABLE mock_tests ADD COLUMN IF NOT EXISTS instructor_id INTEGER REFERENCES instructors(id) ON DELETE SET NULL;
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

-- ── Flexible offers: nullable slot fields + custom price (April 2026) ──
-- Allow offers without a pinned slot (learner picks their own time).
-- Existing slot-pinned offers keep working — these columns simply become optional.
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

-- ══════════════════════════════════════════════════════════════════════════════
-- REFERRAL SYSTEM (April 2026)
-- ══════════════════════════════════════════════════════════════════════════════

-- Referral codes — one per learner, unique per school
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

-- ══════════════════════════════════════════════════════════════════════════════
-- REMOVED: Q&A feature (April 2026)
-- Tables dropped entirely; see db/migrations/014_qa_system.sql for history.
-- Idempotent DROPs so repeated migrate runs are safe.
-- ══════════════════════════════════════════════════════════════════════════════
DROP TABLE IF EXISTS qa_answers;
DROP TABLE IF EXISTS qa_questions;

-- ══════════════════════════════════════════════════════════════════════════════
-- INSTRUCTOR OFFERED LESSON TYPES (April 2026)
-- NULL = instructor offers all active lesson types (backward compat default)
-- Explicit array of slugs e.g. '["standard","2hr"]' restricts which types
-- appear on the instructor's public booking page.
-- ══════════════════════════════════════════════════════════════════════════════
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS offered_lesson_types JSONB DEFAULT NULL;

-- ══════════════════════════════════════════════════════════════════════════════
-- FREE TRIAL: guest_phone on lesson_bookings (April 2026)
-- Stores the raw phone number submitted on the free-trial form so the
-- one-trial guard can match it even when the learner_users row ends up
-- with phone=NULL (phone-collision fallback during INSERT).
-- NULL for all non-free-trial bookings.
-- ══════════════════════════════════════════════════════════════════════════════
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS guest_phone TEXT;
CREATE INDEX IF NOT EXISTS idx_lesson_bookings_guest_phone ON lesson_bookings(guest_phone) WHERE guest_phone IS NOT NULL;

-- ══════════════════════════════════════════════════════════════════════════════
-- REFERRAL REWARDS — per-booking idempotency (April 2026)
-- Reward model: recurring. Every completed paid lesson by a referred learner
-- generates floor(duration/3) minutes of credit for the referrer.
-- Issued by api/cron-referral-rewards.js after a 7-day grace window.
-- The column is the idempotency key — once stamped, the booking will never
-- be rewarded again, even if the cron re-runs.
-- ══════════════════════════════════════════════════════════════════════════════
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS referral_rewarded_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_lesson_bookings_referral_pending
  ON lesson_bookings(scheduled_date, status)
  WHERE referral_rewarded_at IS NULL AND status = 'completed';

-- Backfill: any referee whose referrer already received a referral_reward credit
-- transaction under the old purchase-time logic — mark their EARLIEST completed
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

-- ══════════════════════════════════════════════════════════════════════════════
-- REFERRAL CLICK LOG (April 2026)
-- One row per visit to /r/<code>. Pre-signup, so referee_id is unknown here.
-- Used for: (a) attribution debugging ("my friend used my link and I got
-- nothing"), (b) light abuse detection (one IP hammering one code), (c) giving
-- the referrer some signal that their link is being clicked even before
-- anyone signs up. ip_hash (not raw IP) keeps this GDPR-friendly.
-- ══════════════════════════════════════════════════════════════════════════════
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

-- ══════════════════════════════════════════════════════════════════════════════
-- BULK CREDIT PRICING (April 2026, tiers revised May 2026)
-- Per-school config moved from a hardcoded constant in api/credits.js to
-- schools.config.pricing.bulk_hourly_pence + bulk_discount_tiers. This seed
-- sets CoachCarter's bulk-credit pricing: £55/hr with 12hr/24hr/36hr →
-- 2.5%/5%/7.5%. Idempotent: only sets the keys if they're not already present,
-- so any admin edit via the editor persists across migration re-runs.
--
-- New schools onboarding via InstructorBook get NO bulk pricing seeded. They
-- fall back to their standard 90-min lesson type's hourly rate (= no bulk
-- discount), which is the safe default — admin must opt in to bulk discounts
-- via the editor.
-- ══════════════════════════════════════════════════════════════════════════════
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

-- ══════════════════════════════════════════════════════════════════════════════
-- PASSWORD AUTH (May 2026)
-- ══════════════════════════════════════════════════════════════════════════════
-- Replaces magic-link login for learners + instructors. Magic links are kept
-- only for password reset (via 6-digit email code) and as a one-time migration
-- path for existing accounts with no password set.
--
-- Admins already have password auth — see `admin_users.password_hash`.
--
-- learner_users.password_hash already exists (April 2026, kept nullable when
-- magic links replaced passwords). Just add email_verified.
--
-- instructors needs both password_hash + email_verified (was magic-link only).
-- ══════════════════════════════════════════════════════════════════════════════

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
-- Existing admins were created via SQL/superadmin → email is implicitly verified.

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

-- ─────────────────────────────────────────────────────────────────────────────
-- May 2026: retire the waitlist
--
-- Replaced by `learner_availability` driving cancellation notifications via
-- api/_notify-availability.js. Weekly availability is now the single primitive
-- for "ping me when something opens up". See CLAUDE.md.
-- ─────────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS waitlist CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- May 2026: broadcast offers (PR 2a)
--
-- Extend lesson_offers to support 1-slot-to-many-learners broadcasts. When a
-- booking is cancelled <48h before lesson start and the instructor opted in,
-- _notify-availability.js mints a "batch" of offers (one row per matching
-- learner) at 25% off. First learner to accept wins; siblings get superseded
-- and notified that the slot is no longer available.
--
-- Manual 1:1 offers (the existing "Offer a lesson" feature) are unchanged —
-- new rows simply default to kind='manual'.
-- ─────────────────────────────────────────────────────────────────────────────

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

-- ─────────────────────────────────────────────────────────────────────────────
-- Lesson offers: optional weekly-repeat series (May 2026)
-- ─────────────────────────────────────────────────────────────────────────────
-- Instructors can offer a slot with up to 18 weekly repeats. The learner picks
-- how many on the accept page (1..max_repeat_weeks). On payment the webhook
-- creates a series sharing one series_id, skipping any clashing weeks (existing
-- booking, blackout, no availability) up to a 18-week lookahead from the
-- original date.
--
-- This is the only path that may create bookings beyond the global 12-week
-- (84-day) advance cap — the instructor explicitly opted in by setting it.
ALTER TABLE lesson_offers ADD COLUMN IF NOT EXISTS max_repeat_weeks INTEGER
  CHECK (max_repeat_weeks IS NULL OR max_repeat_weeks BETWEEN 1 AND 18);

-- ─────────────────────────────────────────────────────────────────────────────
-- Balance audit trail (May 2026)
-- ─────────────────────────────────────────────────────────────────────────────
-- DB-level safety net for every change to learner_users.balance_minutes /
-- credit_balance. Catches what credit_transactions misses — namely booking
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

CREATE OR REPLACE FUNCTION trg_balance_audit() RETURNS TRIGGER AS $$
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
    INSERT INTO balance_audit (learner_id, op, old_balance_minutes, new_balance_minutes,
      old_credit_balance, new_credit_balance, delta_minutes, delta_credits,
      db_session_user, application_name)
    VALUES (NEW.id, 'INSERT', NULL, new_bm, NULL, new_cb,
      COALESCE(new_bm, 0), COALESCE(new_cb, 0),
      session_user, current_setting('application_name', true));
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    old_bm := OLD.balance_minutes; new_bm := NEW.balance_minutes;
    old_cb := OLD.credit_balance;  new_cb := NEW.credit_balance;
    IF old_bm IS NOT DISTINCT FROM new_bm AND old_cb IS NOT DISTINCT FROM new_cb THEN
      RETURN NEW;
    END IF;
    INSERT INTO balance_audit (learner_id, op, old_balance_minutes, new_balance_minutes,
      old_credit_balance, new_credit_balance, delta_minutes, delta_credits,
      db_session_user, application_name)
    VALUES (NEW.id, 'UPDATE', old_bm, new_bm, old_cb, new_cb,
      COALESCE(new_bm, 0) - COALESCE(old_bm, 0),
      COALESCE(new_cb, 0) - COALESCE(old_cb, 0),
      session_user, current_setting('application_name', true));
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO balance_audit (learner_id, op, old_balance_minutes, new_balance_minutes,
      old_credit_balance, new_credit_balance, delta_minutes, delta_credits,
      db_session_user, application_name)
    VALUES (OLD.id, 'DELETE', OLD.balance_minutes, NULL, OLD.credit_balance, NULL,
      -COALESCE(OLD.balance_minutes, 0), -COALESCE(OLD.credit_balance, 0),
      session_user, current_setting('application_name', true));
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS balance_audit_trigger ON learner_users;
CREATE TRIGGER balance_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON learner_users
  FOR EACH ROW EXECUTE FUNCTION trg_balance_audit();

-- ── Collapse booking statuses from 7 to 3 (May 2026) ────────────────────
-- See BOOKING-STATUS-RESTRUCTURE-PLAN.md and docs/booking-statuses.md.
-- Pre-migration audit (2026-05-15): 17 → scheduled, 52 → chargeable,
-- 46 → refunded, 0 unmapped, 0 NULLs, 0 disputed rows requiring review.
--
-- Mapping:
--   confirmed, awaiting_confirmation       → scheduled
--   completed, no_show, disputed           → chargeable
--   cancelled, rescheduled                 → refunded
--
-- Idempotent: the DROP CONSTRAINT and CASE are safe to re-run. The CASE's
-- ELSE clause preserves any value that already matches the new vocabulary,
-- so running this block twice is a no-op on the second run.
--
-- Slot-uniqueness predicate swap: the legacy partial index
-- `uq_instructor_slot` (db/migrations/001_booking_system.sql) had
-- `WHERE status != 'cancelled'`, which kept multi-cancel and
-- cancel-then-rebook history rows out of the uniqueness check. With the
-- collapse, `cancelled` AND `rescheduled` both map to `refunded` — under
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

-- ══════════════════════════════════════════════════════════════════════════════
-- STRIPE-FEE PASS-THROUGH (Step 4f.a of INSTRUCTOR-PAYMENTS-PLAN.md)
-- ══════════════════════════════════════════════════════════════════════════════
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
--   'balance_transaction' — canonical, from Stripe API at webhook time
--   'estimated'           — computed locally, awaiting reconciliation
--   NULL                  — no fee (e.g. credit-redemption with no fresh charge)
ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS stripe_fee_pence INTEGER;
ALTER TABLE lesson_bookings    ADD COLUMN IF NOT EXISTS stripe_fee_pence INTEGER;
ALTER TABLE lesson_bookings    ADD COLUMN IF NOT EXISTS stripe_fee_source TEXT;

-- ══════════════════════════════════════════════════════════════════════════════
-- STRIPE-FEE PASS-THROUGH — payout historical breakdown (Step 4f.d)
-- ══════════════════════════════════════════════════════════════════════════════
-- Capture the Stripe fees that were subtracted from each weekly payout so the
-- breakdown is queryable historically (matches the 4-line earnings UI:
-- gross → Stripe fees → franchise fee / commission → net).
--
-- Stripe fees come off totalGross BEFORE the franchise/deposit/shortfall math
-- runs. They never enter the carry-forward shortfall ledger — they're a
-- pass-through cost, not a debt to the platform.
ALTER TABLE instructor_payouts ADD COLUMN IF NOT EXISTS stripe_fees_pence INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payout_line_items  ADD COLUMN IF NOT EXISTS stripe_fee_pence  INTEGER NOT NULL DEFAULT 0;

-- ══════════════════════════════════════════════════════════════════════════════
-- TEST-ACCOUNT FLAG (for liability accuracy on the platform-balance widget)
-- ══════════════════════════════════════════════════════════════════════════════
-- Phantom liability discovered 2026-05-16: 7 of 20 learner rows with positive
-- balance were Fraser's own test accounts (~£4,872.50 of false credit liability),
-- inflating the platform-balance widget's "owed to learners" figure by ~60%.
--
-- New explicit flag — heuristics on email/name would bite when a real learner
-- happens to have "test" in their name. Default FALSE keeps live learners untouched.
-- Excluded from BOTH the learner_credit_pence and scheduled_float_pence
-- calculations in api/admin.js handlePlatformBalance.
--
-- To flag new test accounts going forward, set the column via SQL:
--   UPDATE learner_users SET is_test_account = TRUE WHERE id = <X>;
-- (Admin UI deferred until pain shows up — manual SQL is fine while only Fraser
-- creates test accounts.)
ALTER TABLE learner_users ADD COLUMN IF NOT EXISTS is_test_account BOOLEAN NOT NULL DEFAULT FALSE;

-- One-time flag of the 7 known test rows identified in the 2026-05-16 audit.
-- ON CONFLICT DO NOTHING isn't applicable here; using id-based UPDATE which is
-- safely idempotent (flagging an already-flagged row is a no-op).
UPDATE learner_users SET is_test_account = TRUE WHERE id IN (
  15,  -- fraser carter / coachcarteruk@gmail.com (admin account, 1860min / £1705)
  14,  -- Fraser Learner Test / frasercarter95@gmail.com (1710min / £1567.50)
  24,  -- Fraser / no email (orphan, 1650min / £1512.50)
  52,  -- Test Learner / coachcarteruk+testlearner@gmail.com (630min / £577.50)
  53,  -- Test Delete / coachcarteruk+testdelete@gmail.com (450min / £412.50)
  54,  -- Test Empty / coachcarteruk+testempty@gmail.com (450min / £412.50)
  10   -- fraser@coachcarter.uk (90min / £82.50)
);
-- NOT flagged: id=42 Phil Carter — almost certainly a real family member
-- with a real booking pattern. Leave as live liability.

-- ══════════════════════════════════════════════════════════════════════════════
-- PLATFORM BALANCE SNAPSHOTS (widget alert layer, 2026-05-17)
-- ══════════════════════════════════════════════════════════════════════════════
-- Daily snapshot of the Next Payout Preview widget's state plus trailing-30d
-- cash flow. Two purposes:
--   1. Trigger A — if a real payout fails inside the next 24h despite the most
--      recent snapshot reporting status='green', the widget was lying. Alert.
--   2. Trigger B — coarse Option A bias check: if trailing-30d payout outflow
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

-- ══════════════════════════════════════════════════════════════════════════════
-- STRIPE SESSION IDEMPOTENCY (PR-G, audit #07 + #11)
-- ══════════════════════════════════════════════════════════════════════════════
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
--      learners for one slot — the later booking insert fails on
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

-- ══════════════════════════════════════════════════════════════════════════════
-- CRON OVERLAP GUARDS (PR-I, audit #15)
-- ══════════════════════════════════════════════════════════════════════════════
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

-- ══════════════════════════════════════════════════════════════════════════════
-- PR-K: GDPR — anonymise lesson_bookings instead of cascade-deleting (May 2026)
-- ══════════════════════════════════════════════════════════════════════════════
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
-- The shared cascade helper lives in api/_gdpr.js — all three call sites
-- now go through it.
-- ══════════════════════════════════════════════════════════════════════════════
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS learner_anonymized BOOLEAN DEFAULT FALSE;

ALTER TABLE lesson_bookings DROP CONSTRAINT IF EXISTS lesson_bookings_learner_id_fkey;
ALTER TABLE lesson_bookings ALTER COLUMN learner_id DROP NOT NULL;
DO $$ BEGIN
  ALTER TABLE lesson_bookings ADD CONSTRAINT lesson_bookings_learner_id_fkey
    FOREIGN KEY (learner_id) REFERENCES learner_users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- PR-L: calendar_token rotation timestamps (May 2026)
-- ══════════════════════════════════════════════════════════════════════════════
-- `calendar_token` on learner_users and instructors is a long-lived secret that
-- grants read access to the user's lesson schedule via the iCal feed. Lazy-
-- issued on first feed-url request and stored forever. If it leaks (URL
-- shared / browser history / accidental screen share), there was no way to
-- invalidate it short of manual DB intervention.
--
-- Add a `calendar_token_rotated_at` timestamp so:
--   1. Users can self-rotate via POST /api/calendar?action=rotate-token (and
--      the instructor equivalent), invalidating the old token immediately.
--   2. The profile UI can display "last rotated on …" so users know to rotate
--      if a leak is suspected.
--
-- Nullable: pre-PR-L tokens have no rotation history. The rotate endpoint
-- writes NOW() when it rotates; the issue path also writes NOW() when it
-- first generates the token (so freshly-issued tokens have a known birth).
-- ══════════════════════════════════════════════════════════════════════════════
ALTER TABLE learner_users ADD COLUMN IF NOT EXISTS calendar_token_rotated_at TIMESTAMPTZ;
ALTER TABLE instructors   ADD COLUMN IF NOT EXISTS calendar_token_rotated_at TIMESTAMPTZ;

-- ══════════════════════════════════════════════════════════════════════════════
-- PR-N: notification_log (May 2026)
-- ══════════════════════════════════════════════════════════════════════════════
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
-- data — purpose strings are coarse, payload_summary is the subject/first
-- 80 chars, never the full message body).
-- ══════════════════════════════════════════════════════════════════════════════
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

-- ══════════════════════════════════════════════════════════════════════════════
-- Credits Step 1a: list_price_pence keystone column (May 2026)
-- ══════════════════════════════════════════════════════════════════════════════
-- Per PER-INSTRUCTOR-CREDITS-PLAN.md §Step 1a. Snapshots the list price (in
-- pence) at booking creation time, plus a provenance tag describing how the
-- snapshot was sourced. Schema-only deploy — no writer code yet. Both columns
-- nullable; Step 1b (writer wiring in every INSERT path) and Step 1c (backfill
-- with source tagging) follow in later PRs.
--
-- `list_price_source` values:
--   'stripe_metadata'        — read from Stripe session metadata at webhook time
--   'live_compute_insert'    — computed via getEffectiveRatePencePerMinute at INSERT
--   'live_compute_backfill'  — computed by Step 1c backfill against historical rate
--   'unknown'                — pre-backfill rows that could not be classified
-- ══════════════════════════════════════════════════════════════════════════════
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS list_price_pence INTEGER;
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS list_price_source TEXT
  CHECK (list_price_source IS NULL OR list_price_source IN
    ('stripe_metadata', 'live_compute_insert', 'live_compute_backfill', 'unknown'));

-- ══════════════════════════════════════════════════════════════════════════════
-- Credits Step 3a: instructors.hourly_rate_pence column (May 2026)
-- ══════════════════════════════════════════════════════════════════════════════
-- Per PER-INSTRUCTOR-CREDITS-PLAN.md §Step 3 (L668-670). Per-instructor
-- hourly rate, level 2 of the three-level pricing fallback:
--   1. instructor_learner_notes.custom_hourly_rate_pence  (per-learner-pair)
--   2. instructors.hourly_rate_pence                       (per-instructor) ← NEW
--   3. schools.config.pricing.bulk_hourly_pence            (school default)
--
-- Nullable. NULL means "inherit school default" (level 3) — so no behavioural
-- change for any existing instructor until an admin sets a value explicitly.
-- CHECK bound (1..50000 pence) mirrors validateBulkPricingConfig in
-- api/_pricing-helpers.js so admin-set values are bounded consistently.
-- Schema-only deploy; the helper that consumes this column ships in Step 3b.
-- ══════════════════════════════════════════════════════════════════════════════
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

-- ══════════════════════════════════════════════════════════════════════════════
-- Credits Step 1c: migration_markers table (May 2026)
-- ══════════════════════════════════════════════════════════════════════════════
-- Per PER-INSTRUCTOR-CREDITS-PLAN.md §Step 1c (L357-385). Operational ordering
-- table so future migrations can refuse to run until a prerequisite backfill
-- has completed. Specifically: Step 2's schema PR will wrap its DDL in a
-- DO-block that checks for the 'per_instructor_credits_step_1c_backfill' key.
-- If missing → RAISE EXCEPTION halts the migration.
--
-- The table is created here (schema-only); marker rows are inserted by the
-- corresponding migration endpoint after it confirms the backfill completed
-- successfully. /api/migrate-step-1c is the only writer in this PR; future
-- migrations get their own keys.
-- ══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS migration_markers (
  key          TEXT PRIMARY KEY,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes        TEXT
);

-- ══════════════════════════════════════════════════════════════════════════════
-- Credits Step 2a: credit_transactions Phase 1 schema (May 2026)
-- ══════════════════════════════════════════════════════════════════════════════
-- Per PER-INSTRUCTOR-CREDITS-PLAN.md §Step 2 sub-phase 2a (L425-439). Adds the
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
-- ══════════════════════════════════════════════════════════════════════════════
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

-- ══════════════════════════════════════════════════════════════════════════════
-- Credits Step 2c: unique indexes + per-instructor balance / FIFO / refund tables (May 2026)
-- ══════════════════════════════════════════════════════════════════════════════
-- Per PER-INSTRUCTOR-CREDITS-PLAN.md §Step 2 sub-phase 2c (L468-532). Adds the
-- two reconciliation-idempotency unique indexes plus the three new tables that
-- Phase 2A code (Step 4) will read/write:
--
--   - learner_credit_balances    : per (learner, instructor) balance ledger.
--   - booking_credit_sources     : FIFO attribution — which credit_transactions
--                                  row(s) funded each lesson_bookings row.
--   - credit_source_adjustments  : cash-refund / dispute-clawback ledger
--                                  (immutable source totals + additive history).
--
-- All additive. PHASE_2A_IMPLEMENTED stays false; no writer reads these tables
-- until Step 4. The LCB backfill from learner_users.balance_minutes lives in
-- /api/migrate-step-2c (data mutation, not schema), mirroring the Step 1c
-- precedent. Sync trigger ships in Step 4 Phase B (not here).
-- ══════════════════════════════════════════════════════════════════════════════

-- Unique partial indexes for Stripe-payment idempotency in Step 5 reconciliation.
-- Partial WHERE is load-bearing: historical rows have these NULL (plan §Step 2
-- decision A — no historical Stripe-ID backfill).
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
-- per-pair ledger row — even one whose net is zero (e.g. +60 purchase
-- + -60 booking draw) — re-asserts drift on grandfathered rows. Backfill
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

-- FIFO attribution snapshots. credit_transaction_id NOT NULL — free-trial /
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

-- Cash-refund / dispute-clawback / admin-correction ledger. Additive — never
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
