-- Add the 10-hour Flexible Hours payment-convenience package.
-- Product versions remain immutable; this migration creates a new stable
-- product identity and its first approved version for every school.

CREATE OR REPLACE FUNCTION seed_flexible_10_hour_package_catalogue(target_school_id INTEGER)
RETURNS VOID AS $$
DECLARE
  flexible_10_id BIGINT;
BEGIN
  INSERT INTO package_products (school_id, slug, product_type, visible, active, sort_order)
  VALUES (target_school_id, 'flexible-10-hours', 'flexible_hours', TRUE, TRUE, 8)
  ON CONFLICT (school_id, slug) DO NOTHING;

  SELECT id INTO flexible_10_id
    FROM package_products
   WHERE school_id = target_school_id AND slug = 'flexible-10-hours';

  INSERT INTO package_product_versions (
    school_id, product_id, version_number, price_pence, currency, content,
    customer_terms_version, effective_from
  )
  SELECT target_school_id, flexible_10_id, 1, 55000, 'GBP',
    jsonb_build_object(
      'name', '10-hour Flexible Hours package',
      'short_description', 'For learners who prefer one payment over 10 separate payments when booking.',
      'intent', 'flexible_hours',
      'highlights', jsonb_build_array('10 school-wide hours', 'GBP 55 per hour', 'No expiry', 'Used in exact 30-minute units'),
      'not_included', jsonb_build_array('Transfer to another learner', 'A permanently assigned instructor'),
      'entitlement', jsonb_build_object('hours', 10, 'unit_minutes', 30, 'units', 20, 'scope', 'school'),
      'refund_basis', 'Unused units are refundable at GBP 27.50 per 30-minute unit. CoachCarter absorbs the original Stripe fee.',
      'consumer_rights', jsonb_build_object(
        'disclosure_version', 'flexible-hours-consumer-rights-v1',
        'checkout_acknowledgement', 'I have read and accept the Flexible Hours terms, cancellation rules and unused-value refund basis.',
        'immediate_access_request', 'I expressly request immediate access to my Flexible Hours during the 14-day cancellation period and understand that properly used or late-cancelled value may be deducted.'
      ),
      'checkout_disclosure', 'Pay by Bank. Access is created only after verified signed webhook confirmation.'
    ),
    'flexible-hours-v1', TIMESTAMPTZ '2026-08-18 00:00:00+00'
  WHERE flexible_10_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM package_product_versions
       WHERE school_id = target_school_id
         AND product_id = flexible_10_id
         AND customer_terms_version = 'flexible-hours-v1'
    );
END;
$$ LANGUAGE plpgsql;

SELECT seed_flexible_10_hour_package_catalogue(id) FROM schools;

CREATE OR REPLACE FUNCTION seed_flexible_hours_packages_for_new_school()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM seed_flexible_hours_package_catalogue(NEW.id);
  PERFORM seed_flexible_10_hour_package_catalogue(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Replace only the three closed product-contract checks. Existing rows remain
-- valid; the new terms add one exact slug/amount/unit-rate combination.
DO $$
DECLARE
  constraint_row RECORD;
BEGIN
  FOR constraint_row IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'flexible_package_purchase_attempts'::regclass
       AND contype = 'c'
       AND (
         pg_get_constraintdef(oid) LIKE '%product_slug%'
         OR pg_get_constraintdef(oid) LIKE '%amount_pence%'
       )
  LOOP
    EXECUTE format(
      'ALTER TABLE flexible_package_purchase_attempts DROP CONSTRAINT %I',
      constraint_row.conname
    );
  END LOOP;
END $$;

ALTER TABLE flexible_package_purchase_attempts
  ADD CONSTRAINT flexible_package_purchase_attempts_product_slug_check
    CHECK (product_slug IN ('flexible-10-hours', 'flexible-15-hours', 'flexible-30-hours')),
  ADD CONSTRAINT flexible_package_purchase_attempts_amount_pence_check
    CHECK (amount_pence IN (55000, 81000, 159000)),
  ADD CONSTRAINT flexible_package_purchase_attempts_terms_check
    CHECK ((total_units = 20 AND amount_pence = 55000 AND rate_pence_per_unit = 2750)
        OR (total_units = 30 AND amount_pence = 81000 AND rate_pence_per_unit = 2700)
        OR (total_units = 60 AND amount_pence = 159000 AND rate_pence_per_unit = 2650));

ALTER TABLE flexible_package_purchases
  DROP CONSTRAINT IF EXISTS flexible_package_purchases_product_slug_check;
ALTER TABLE flexible_package_purchases
  ADD CONSTRAINT flexible_package_purchases_product_slug_check
  CHECK (product_slug IN ('flexible-10-hours', 'flexible-15-hours', 'flexible-30-hours'));
