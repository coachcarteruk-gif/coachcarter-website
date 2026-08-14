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
