CREATE UNIQUE INDEX IF NOT EXISTS uq_post_trial_discount_quotes_id_school
  ON post_trial_discount_quotes(id, school_id);

ALTER TABLE package_purchase_attempts
  ADD COLUMN IF NOT EXISTS base_product_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS post_trial_quote_id UUID,
  ADD COLUMN IF NOT EXISTS post_trial_quote JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS post_trial_provider_initiated_at TIMESTAMPTZ;

ALTER TABLE learner_package_purchases
  ADD COLUMN IF NOT EXISTS base_product_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS post_trial_quote_id UUID,
  ADD COLUMN IF NOT EXISTS post_trial_quote JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS post_trial_provider_initiated_at TIMESTAMPTZ;

ALTER TABLE flexible_package_purchase_attempts
  ADD COLUMN IF NOT EXISTS base_product_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS post_trial_quote_id UUID,
  ADD COLUMN IF NOT EXISTS post_trial_quote JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS post_trial_provider_initiated_at TIMESTAMPTZ;

ALTER TABLE flexible_package_purchases
  ADD COLUMN IF NOT EXISTS base_product_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS post_trial_quote_id UUID,
  ADD COLUMN IF NOT EXISTS post_trial_quote JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS post_trial_provider_initiated_at TIMESTAMPTZ;

ALTER TABLE package_purchase_attempts
  DROP CONSTRAINT IF EXISTS package_purchase_attempts_post_trial_quote_fkey;
ALTER TABLE package_purchase_attempts
  ADD CONSTRAINT package_purchase_attempts_post_trial_quote_fkey
  FOREIGN KEY (post_trial_quote_id, school_id)
  REFERENCES post_trial_discount_quotes(id, school_id);

ALTER TABLE learner_package_purchases
  DROP CONSTRAINT IF EXISTS learner_package_purchases_post_trial_quote_fkey;
ALTER TABLE learner_package_purchases
  ADD CONSTRAINT learner_package_purchases_post_trial_quote_fkey
  FOREIGN KEY (post_trial_quote_id, school_id)
  REFERENCES post_trial_discount_quotes(id, school_id);

ALTER TABLE flexible_package_purchase_attempts
  DROP CONSTRAINT IF EXISTS flexible_package_attempts_post_trial_quote_fkey;
ALTER TABLE flexible_package_purchase_attempts
  ADD CONSTRAINT flexible_package_attempts_post_trial_quote_fkey
  FOREIGN KEY (post_trial_quote_id, school_id)
  REFERENCES post_trial_discount_quotes(id, school_id);

ALTER TABLE flexible_package_purchases
  DROP CONSTRAINT IF EXISTS flexible_package_purchases_post_trial_quote_fkey;
ALTER TABLE flexible_package_purchases
  ADD CONSTRAINT flexible_package_purchases_post_trial_quote_fkey
  FOREIGN KEY (post_trial_quote_id, school_id)
  REFERENCES post_trial_discount_quotes(id, school_id);

CREATE INDEX IF NOT EXISTS idx_package_attempts_post_trial_quote
  ON package_purchase_attempts(post_trial_quote_id) WHERE post_trial_quote_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_package_purchases_post_trial_quote
  ON learner_package_purchases(post_trial_quote_id) WHERE post_trial_quote_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_flexible_attempts_post_trial_quote
  ON flexible_package_purchase_attempts(post_trial_quote_id) WHERE post_trial_quote_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_flexible_purchases_post_trial_quote
  ON flexible_package_purchases(post_trial_quote_id) WHERE post_trial_quote_id IS NOT NULL;

ALTER TABLE flexible_package_purchase_attempts
  ALTER COLUMN rate_pence_per_unit TYPE NUMERIC(16,6);
ALTER TABLE flexible_package_purchases
  ALTER COLUMN rate_pence_per_unit TYPE NUMERIC(16,6);

ALTER TABLE flexible_package_purchase_attempts
  DROP CONSTRAINT IF EXISTS flexible_package_purchase_attempts_amount_pence_check,
  DROP CONSTRAINT IF EXISTS flexible_package_purchase_attempts_terms_check;
ALTER TABLE flexible_package_purchase_attempts
  ADD CONSTRAINT flexible_package_purchase_attempts_amount_pence_check
    CHECK (amount_pence BETWEEN 50 AND 1000000),
  ADD CONSTRAINT flexible_package_purchase_attempts_terms_check
    CHECK (total_units IN (20, 30, 60)
       AND rate_pence_per_unit > 0
       AND amount_pence = ROUND(total_units * rate_pence_per_unit));

ALTER TABLE flexible_package_booking_allocations
  DROP CONSTRAINT IF EXISTS flexible_package_booking_allocations_check1;
ALTER TABLE flexible_package_booking_allocations
  ADD CONSTRAINT flexible_package_booking_allocations_check1
    CHECK (units_allocated > 0 AND unit_minutes = 30
       AND rate_pence_per_unit > 0 AND contribution_pence >= 0);

ALTER TABLE flexible_package_source_reductions
  DROP CONSTRAINT IF EXISTS flexible_package_source_reductions_check1;
ALTER TABLE flexible_package_source_reductions
  ADD CONSTRAINT flexible_package_source_reductions_check1
    CHECK (units_reduced > 0 AND rate_pence_per_unit > 0
       AND gross_refund_pence >= 0
       AND stripe_fee_deduction_pence >= 0
       AND learner_refund_pence = gross_refund_pence - stripe_fee_deduction_pence);

CREATE OR REPLACE VIEW flexible_package_source_remaining AS
SELECT s.id AS source_id, s.school_id, s.learner_id, s.purchase_id,
       s.initial_units, s.unit_minutes, s.rate_pence_per_unit,
       remainder.units AS remaining_units,
       GREATEST(0, s.original_value_pence
         - COALESCE(spent.value_pence, 0)
         - COALESCE(reduced.value_pence, 0))::integer AS refundable_value_pence,
       s.available_at, s.created_at
  FROM flexible_package_sources s
  CROSS JOIN LATERAL (
    SELECT GREATEST(0, ROUND((s.initial_units
      - COALESCE((SELECT SUM(r.units_reduced) FROM flexible_package_source_reductions r
                   WHERE r.source_id=s.id AND r.school_id=s.school_id),0)
      - COALESCE((SELECT SUM(a.units_allocated) FROM flexible_package_booking_allocations a
                   WHERE a.source_id=s.id AND a.school_id=s.school_id
                     AND NOT EXISTS (SELECT 1 FROM flexible_package_allocation_returns ar
                       WHERE ar.allocation_id=a.id AND ar.school_id=a.school_id)),0)
    ) * 30)) / 30 AS units
  ) remainder
  LEFT JOIN LATERAL (
    SELECT SUM(a.contribution_pence)::integer AS value_pence
      FROM flexible_package_booking_allocations a
     WHERE a.source_id=s.id AND a.school_id=s.school_id
       AND NOT EXISTS (SELECT 1 FROM flexible_package_allocation_returns ar
         WHERE ar.allocation_id=a.id AND ar.school_id=a.school_id)
  ) spent ON TRUE
  LEFT JOIN LATERAL (
    SELECT SUM(r.gross_refund_pence)::integer AS value_pence
      FROM flexible_package_source_reductions r
     WHERE r.source_id=s.id AND r.school_id=s.school_id
  ) reduced ON TRUE;

ALTER TABLE package_purchase_attempts
  DROP CONSTRAINT IF EXISTS package_purchase_attempts_post_trial_snapshot_check;
ALTER TABLE package_purchase_attempts
  ADD CONSTRAINT package_purchase_attempts_post_trial_snapshot_check
    CHECK (jsonb_typeof(post_trial_quote) = 'object'
       AND (post_trial_quote_id IS NOT NULL OR post_trial_quote = '{}'::jsonb)
       AND (post_trial_quote_id IS NULL OR (
         base_product_snapshot IS NOT NULL
         AND amount_pence = (post_trial_quote->>'pricePence')::integer)));
ALTER TABLE learner_package_purchases
  DROP CONSTRAINT IF EXISTS learner_package_purchases_post_trial_snapshot_check;
ALTER TABLE learner_package_purchases
  ADD CONSTRAINT learner_package_purchases_post_trial_snapshot_check
    CHECK (jsonb_typeof(post_trial_quote) = 'object'
       AND (post_trial_quote_id IS NOT NULL OR post_trial_quote = '{}'::jsonb)
       AND (post_trial_quote_id IS NULL OR (
         base_product_snapshot IS NOT NULL
         AND amount_pence = (post_trial_quote->>'pricePence')::integer)));
ALTER TABLE flexible_package_purchase_attempts
  DROP CONSTRAINT IF EXISTS flexible_package_attempts_post_trial_snapshot_check;
ALTER TABLE flexible_package_purchase_attempts
  ADD CONSTRAINT flexible_package_attempts_post_trial_snapshot_check
    CHECK (jsonb_typeof(post_trial_quote) = 'object'
       AND (post_trial_quote_id IS NOT NULL OR post_trial_quote = '{}'::jsonb)
       AND (post_trial_quote_id IS NULL OR (
         base_product_snapshot IS NOT NULL
         AND amount_pence = (post_trial_quote->>'pricePence')::integer)));
ALTER TABLE flexible_package_purchases
  DROP CONSTRAINT IF EXISTS flexible_package_purchases_post_trial_snapshot_check;
ALTER TABLE flexible_package_purchases
  ADD CONSTRAINT flexible_package_purchases_post_trial_snapshot_check
    CHECK (jsonb_typeof(post_trial_quote) = 'object'
       AND (post_trial_quote_id IS NOT NULL OR post_trial_quote = '{}'::jsonb)
       AND (post_trial_quote_id IS NULL OR (
         base_product_snapshot IS NOT NULL
         AND amount_pence = (post_trial_quote->>'pricePence')::integer)));
