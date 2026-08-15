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
