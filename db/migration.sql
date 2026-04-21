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

-- ── Weekly franchise fee model (alternative to commission_rate) ──
-- When non-NULL, platform takes this fixed amount per week instead of per-lesson commission.
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS weekly_franchise_fee_pence INTEGER DEFAULT NULL;
-- Audit trail: actual franchise fee deducted for each payout (may be less than configured if gross was lower)
ALTER TABLE instructor_payouts ADD COLUMN IF NOT EXISTS franchise_fee_pence INTEGER DEFAULT NULL;

-- ── Setmore sync ──────────────────────────────────────────────────────────────

-- Additional lesson types from Setmore (3hr active, others inactive)
INSERT INTO lesson_types (name, slug, duration_minutes, price_pence, colour, active, sort_order)
VALUES
  ('3-Hour Lesson', '3hr', 165, 16500, '#ef4444', true, 3),
  ('1-Hour Lesson', '1hr', 60, 5500, '#f59e0b', false, 4),
  ('Free Trial',    'trial', 60, 0, '#10b981', false, 5)
ON CONFLICT (slug) DO NOTHING;

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

-- Ensure sequence is ahead of seeded id
SELECT setval('schools_id_seq', GREATEST(nextval('schools_id_seq'), 2));

-- ══════════════════════════════════════════════════════════════════════════════
-- MULTI-TENANT: SCHOOL PAYOUTS
-- ══════════════════════════════════════════════════════════════════════════════

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
