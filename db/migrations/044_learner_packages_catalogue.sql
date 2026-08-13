-- Learner Packages Phase 1: inert, versioned catalogue only.
-- This creates no purchase, payment, entitlement, booking, refund, reward,
-- enrolment, earning, or payout rows. The strict feature flag remains absent
-- (and therefore false) until an audited admin explicitly enables it.

CREATE TABLE IF NOT EXISTS package_products (
  id                       BIGSERIAL PRIMARY KEY,
  school_id                INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  slug                     TEXT NOT NULL,
  product_type             TEXT NOT NULL CHECK (product_type IN (
    'flexible_hours', 'guaranteed_phase', 'full_curriculum', 'manoeuvres'
  )),
  prerequisite_product_id  BIGINT,
  visible                  BOOLEAN NOT NULL DEFAULT TRUE,
  active                   BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order               INTEGER NOT NULL DEFAULT 0,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
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
  id                     BIGSERIAL PRIMARY KEY,
  school_id              INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  product_id             BIGINT NOT NULL,
  version_number         INTEGER NOT NULL,
  price_pence            INTEGER NOT NULL,
  currency               TEXT NOT NULL DEFAULT 'GBP',
  content                JSONB NOT NULL,
  customer_terms_version TEXT NOT NULL,
  effective_from         TIMESTAMPTZ NOT NULL,
  created_by_actor_type  TEXT CHECK (created_by_actor_type IS NULL OR created_by_actor_type IN ('admin', 'superadmin', 'instructor_admin')),
  created_by_actor_id    BIGINT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
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
