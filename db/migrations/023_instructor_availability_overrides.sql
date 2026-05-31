-- 023: Date-specific instructor availability overrides
-- Allows an instructor to add one-off available windows without changing
-- their recurring weekly availability pattern.

CREATE TABLE IF NOT EXISTS schools (
  id                         SERIAL PRIMARY KEY,
  name                       TEXT NOT NULL,
  slug                       TEXT UNIQUE NOT NULL,
  logo_url                   TEXT,
  contact_email              TEXT,
  contact_phone              TEXT,
  website_url                TEXT,
  primary_colour             TEXT DEFAULT '#f97316',
  secondary_colour           TEXT DEFAULT '#1e3a5f',
  accent_colour              TEXT DEFAULT '#3b82f6',
  stripe_account_id          TEXT,
  stripe_onboarding_complete BOOLEAN DEFAULT FALSE,
  platform_fee_pct           NUMERIC(5,2) DEFAULT 0.00,
  config                     JSONB DEFAULT '{}',
  active                     BOOLEAN DEFAULT TRUE,
  created_at                 TIMESTAMPTZ DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO schools (id, name, slug, contact_email, contact_phone, primary_colour, secondary_colour, accent_colour)
VALUES (1, 'CoachCarter Driving School', 'coachcarter', 'fraser@coachcarter.uk', NULL, '#f97316', '#1e3a5f', '#3b82f6')
ON CONFLICT (id) DO NOTHING;

UPDATE schools
   SET config = config || '{"payments_enabled": true}'::jsonb
 WHERE id = 1 AND (config IS NULL OR NOT (config ? 'payments_enabled'));

SELECT setval('schools_id_seq', GREATEST(nextval('schools_id_seq'), 2));

ALTER TABLE instructors ADD COLUMN IF NOT EXISTS school_id INTEGER REFERENCES schools(id);
UPDATE instructors SET school_id = 1 WHERE school_id IS NULL;
ALTER TABLE instructors ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE instructors ALTER COLUMN school_id SET DEFAULT 1;

ALTER TABLE instructor_availability ADD COLUMN IF NOT EXISTS school_id INTEGER REFERENCES schools(id);
UPDATE instructor_availability SET school_id = 1 WHERE school_id IS NULL;
ALTER TABLE instructor_availability ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE instructor_availability ALTER COLUMN school_id SET DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_instructor_availability_school ON instructor_availability(school_id);

ALTER TABLE instructor_blackout_dates ADD COLUMN IF NOT EXISTS school_id INTEGER REFERENCES schools(id);
UPDATE instructor_blackout_dates SET school_id = 1 WHERE school_id IS NULL;
ALTER TABLE instructor_blackout_dates ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE instructor_blackout_dates ALTER COLUMN school_id SET DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_instructor_blackout_dates_school ON instructor_blackout_dates(school_id);

ALTER TABLE instructor_external_events ADD COLUMN IF NOT EXISTS school_id INTEGER REFERENCES schools(id);
UPDATE instructor_external_events SET school_id = 1 WHERE school_id IS NULL;
ALTER TABLE instructor_external_events ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE instructor_external_events ALTER COLUMN school_id SET DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_instructor_external_events_school ON instructor_external_events(school_id);

CREATE TABLE IF NOT EXISTS instructor_availability_overrides (
  id              SERIAL PRIMARY KEY,
  instructor_id   INTEGER NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
  school_id       INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  override_date   DATE NOT NULL,
  start_time      TIME NOT NULL,
  end_time        TIME NOT NULL,
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
