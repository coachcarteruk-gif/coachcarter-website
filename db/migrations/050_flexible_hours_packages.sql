-- Learner Packages: school-wide Flexible Hours.
-- Additive and inert. No school purchasing gate is enabled by this migration.
-- Units are exactly 30 minutes; all financial/product snapshots are immutable.

ALTER TABLE lesson_bookings
  DROP CONSTRAINT IF EXISTS lesson_bookings_list_price_source_check;
ALTER TABLE lesson_bookings
  ADD CONSTRAINT lesson_bookings_list_price_source_check
  CHECK (list_price_source IS NULL OR list_price_source IN (
    'stripe_metadata', 'live_compute_insert', 'live_compute_backfill', 'unknown',
    'flexible_package_frozen_rate'
  ));
ALTER TABLE lesson_bookings
  ADD COLUMN IF NOT EXISTS flexible_package_booking_request_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS uq_flexible_package_booking_request
  ON lesson_bookings(school_id, learner_id, flexible_package_booking_request_id)
  WHERE flexible_package_booking_request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION seed_flexible_hours_package_catalogue(target_school_id INTEGER)
RETURNS VOID AS $$
DECLARE
  flexible_15_id BIGINT;
  flexible_30_id BIGINT;
  next_30_version INTEGER;
BEGIN
  INSERT INTO package_products (school_id, slug, product_type, visible, active, sort_order)
  VALUES (target_school_id, 'flexible-15-hours', 'flexible_hours', TRUE, TRUE, 9)
  ON CONFLICT (school_id, slug) DO NOTHING;

  INSERT INTO package_products (school_id, slug, product_type, visible, active, sort_order)
  VALUES (target_school_id, 'flexible-30-hours', 'flexible_hours', TRUE, TRUE, 10)
  ON CONFLICT (school_id, slug) DO NOTHING;

  SELECT id INTO flexible_15_id
    FROM package_products
   WHERE school_id = target_school_id AND slug = 'flexible-15-hours';
  SELECT id INTO flexible_30_id
    FROM package_products
   WHERE school_id = target_school_id AND slug = 'flexible-30-hours';

  INSERT INTO package_product_versions (
    school_id, product_id, version_number, price_pence, currency, content,
    customer_terms_version, effective_from
  )
  SELECT target_school_id, flexible_15_id, 1, 81000, 'GBP',
    jsonb_build_object(
      'name', '15-hour Flexible Hours package',
      'short_description', 'Fifteen school-wide lesson hours, usable with any eligible active instructor.',
      'intent', 'flexible_hours',
      'highlights', jsonb_build_array('15 school-wide hours', 'GBP 54 per hour', 'No expiry', 'Used in exact 30-minute units'),
      'not_included', jsonb_build_array('Transfer to another learner', 'A permanently assigned instructor'),
      'entitlement', jsonb_build_object('hours', 15, 'unit_minutes', 30, 'units', 30, 'scope', 'school'),
      'refund_basis', 'Unused units are refundable at GBP 27 per 30-minute unit. CoachCarter absorbs the original Stripe fee.',
      'consumer_rights', jsonb_build_object(
        'disclosure_version', 'flexible-hours-consumer-rights-v1',
        'checkout_acknowledgement', 'I have read and accept the Flexible Hours terms, cancellation rules and unused-value refund basis.',
        'immediate_access_request', 'I expressly request immediate access to my Flexible Hours during the 14-day cancellation period and understand that properly used or late-cancelled value may be deducted.'
      ),
      'checkout_disclosure', 'Pay by Bank. Access is created only after verified signed webhook confirmation.'
    ),
    'flexible-hours-v1', TIMESTAMPTZ '2026-08-16 00:00:00+00'
  WHERE flexible_15_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM package_product_versions
       WHERE school_id = target_school_id
         AND product_id = flexible_15_id
         AND customer_terms_version = 'flexible-hours-v1'
    );

  IF flexible_30_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM package_product_versions
     WHERE school_id = target_school_id
       AND product_id = flexible_30_id
       AND customer_terms_version = 'flexible-hours-v1'
  ) THEN
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO next_30_version
      FROM package_product_versions
     WHERE school_id = target_school_id AND product_id = flexible_30_id;

    INSERT INTO package_product_versions (
      school_id, product_id, version_number, price_pence, currency, content,
      customer_terms_version, effective_from
    ) VALUES (
      target_school_id, flexible_30_id, next_30_version, 159000, 'GBP',
      jsonb_build_object(
        'name', '30-hour Flexible Hours package',
        'short_description', 'Thirty school-wide lesson hours, usable with any eligible active instructor.',
        'intent', 'flexible_hours',
        'highlights', jsonb_build_array('30 school-wide hours', 'GBP 53 per hour', 'No expiry', 'Used in exact 30-minute units'),
        'not_included', jsonb_build_array('Transfer to another learner', 'A permanently assigned instructor'),
        'entitlement', jsonb_build_object('hours', 30, 'unit_minutes', 30, 'units', 60, 'scope', 'school'),
        'refund_basis', 'Unused units are refundable at GBP 26.50 per 30-minute unit. CoachCarter absorbs the original Stripe fee.',
        'consumer_rights', jsonb_build_object(
          'disclosure_version', 'flexible-hours-consumer-rights-v1',
          'checkout_acknowledgement', 'I have read and accept the Flexible Hours terms, cancellation rules and unused-value refund basis.',
          'immediate_access_request', 'I expressly request immediate access to my Flexible Hours during the 14-day cancellation period and understand that properly used or late-cancelled value may be deducted.'
        ),
        'checkout_disclosure', 'Pay by Bank. Access is created only after verified signed webhook confirmation.'
      ),
      'flexible-hours-v1', TIMESTAMPTZ '2026-08-16 00:00:00+00'
    );
  END IF;
END;
$$ LANGUAGE plpgsql;

SELECT seed_flexible_hours_package_catalogue(id) FROM schools;

CREATE OR REPLACE FUNCTION seed_flexible_hours_packages_for_new_school()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM seed_flexible_hours_package_catalogue(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_seed_flexible_hours_packages_for_new_school ON schools;
CREATE TRIGGER trg_seed_flexible_hours_packages_for_new_school
AFTER INSERT ON schools
FOR EACH ROW EXECUTE FUNCTION seed_flexible_hours_packages_for_new_school();

CREATE TABLE IF NOT EXISTS flexible_package_purchase_attempts (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  learner_id INTEGER,
  product_id BIGINT NOT NULL,
  product_version_id BIGINT NOT NULL,
  product_slug TEXT NOT NULL,
  product_snapshot JSONB NOT NULL,
  amount_pence INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'GBP',
  total_units INTEGER NOT NULL,
  unit_minutes INTEGER NOT NULL DEFAULT 30,
  rate_pence_per_unit INTEGER NOT NULL,
  customer_terms_version TEXT NOT NULL,
  disclosure_version TEXT NOT NULL,
  adult_age_confirmed BOOLEAN NOT NULL,
  terms_accepted BOOLEAN NOT NULL,
  immediate_access_requested BOOLEAN NOT NULL,
  stripe_mode TEXT NOT NULL DEFAULT 'live',
  status TEXT NOT NULL DEFAULT 'created',
  client_request_id UUID NOT NULL,
  idempotency_key TEXT NOT NULL,
  stripe_payment_method_configuration_id TEXT NOT NULL,
  stripe_checkout_session_id TEXT,
  stripe_payment_intent_id TEXT,
  stripe_charge_id TEXT,
  stripe_checkout_url TEXT,
  provider_expires_at TIMESTAMPTZ,
  review_after TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  checkout_created_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  expired_at TIMESTAMPTZ,
  review_required_at TIMESTAMPTZ,
  failure_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, learner_id, client_request_id),
  UNIQUE (idempotency_key),
  UNIQUE (stripe_checkout_session_id),
  UNIQUE (stripe_payment_intent_id),
  FOREIGN KEY (learner_id, school_id) REFERENCES learner_users(id, school_id) ON DELETE SET NULL (learner_id),
  FOREIGN KEY (product_id, school_id) REFERENCES package_products(id, school_id),
  FOREIGN KEY (product_version_id, school_id, product_id) REFERENCES package_product_versions(id, school_id, product_id),
  CHECK (product_slug IN ('flexible-15-hours', 'flexible-30-hours')),
  CHECK (jsonb_typeof(product_snapshot) = 'object'),
  CHECK (amount_pence IN (81000, 159000)),
  CHECK (currency = 'GBP'),
  CHECK (unit_minutes = 30),
  CHECK ((total_units = 30 AND amount_pence = 81000 AND rate_pence_per_unit = 2700)
      OR (total_units = 60 AND amount_pence = 159000 AND rate_pence_per_unit = 2650)),
  CHECK (adult_age_confirmed = TRUE AND terms_accepted = TRUE AND immediate_access_requested = TRUE),
  CHECK (stripe_mode = 'live'),
  CHECK (status IN ('created','submitting','pending','paid','failed','expired','review_required'))
);

CREATE INDEX IF NOT EXISTS idx_flexible_attempts_learner
  ON flexible_package_purchase_attempts(school_id, learner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_flexible_attempts_review
  ON flexible_package_purchase_attempts(school_id, status, review_after);
CREATE UNIQUE INDEX IF NOT EXISTS uq_flexible_attempt_active_product
  ON flexible_package_purchase_attempts(school_id, learner_id, product_id)
  WHERE status IN ('created','submitting','pending','review_required');

CREATE TABLE IF NOT EXISTS flexible_package_payment_events (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  attempt_id UUID NOT NULL,
  stripe_event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  stripe_object_id TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  provider_created_at TIMESTAMPTZ,
  processing_state TEXT NOT NULL DEFAULT 'processing',
  delivery_count INTEGER NOT NULL DEFAULT 1,
  first_received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  failure_code TEXT,
  UNIQUE (id, school_id),
  FOREIGN KEY (attempt_id, school_id) REFERENCES flexible_package_purchase_attempts(id, school_id),
  CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (processing_state IN ('processing','processed','failed')),
  CHECK (delivery_count > 0)
);

CREATE INDEX IF NOT EXISTS idx_flexible_payment_events_attempt
  ON flexible_package_payment_events(school_id, attempt_id, provider_created_at, id);

CREATE TABLE IF NOT EXISTS flexible_package_purchases (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  learner_id INTEGER,
  attempt_id UUID NOT NULL,
  product_id BIGINT NOT NULL,
  product_version_id BIGINT NOT NULL,
  product_slug TEXT NOT NULL,
  product_snapshot JSONB NOT NULL,
  amount_pence INTEGER NOT NULL,
  currency TEXT NOT NULL,
  total_units INTEGER NOT NULL,
  unit_minutes INTEGER NOT NULL,
  rate_pence_per_unit INTEGER NOT NULL,
  customer_terms_version TEXT NOT NULL,
  stripe_checkout_session_id TEXT NOT NULL,
  stripe_payment_intent_id TEXT,
  paid_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (attempt_id),
  FOREIGN KEY (learner_id, school_id) REFERENCES learner_users(id, school_id) ON DELETE SET NULL (learner_id),
  FOREIGN KEY (attempt_id, school_id) REFERENCES flexible_package_purchase_attempts(id, school_id),
  FOREIGN KEY (product_id, school_id) REFERENCES package_products(id, school_id),
  FOREIGN KEY (product_version_id, school_id, product_id) REFERENCES package_product_versions(id, school_id, product_id),
  CHECK (product_slug IN ('flexible-15-hours','flexible-30-hours')),
  CHECK (currency = 'GBP' AND unit_minutes = 30),
  CHECK (jsonb_typeof(product_snapshot) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_flexible_purchases_learner
  ON flexible_package_purchases(school_id, learner_id, paid_at DESC);

CREATE TABLE IF NOT EXISTS flexible_package_sources (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  learner_id INTEGER,
  purchase_id BIGINT NOT NULL,
  product_version_id BIGINT NOT NULL,
  initial_units INTEGER NOT NULL,
  unit_minutes INTEGER NOT NULL DEFAULT 30,
  rate_pence_per_unit INTEGER NOT NULL,
  original_value_pence INTEGER NOT NULL,
  original_stripe_fee_pence INTEGER,
  stripe_fee_evidence JSONB,
  available_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (purchase_id),
  FOREIGN KEY (learner_id, school_id) REFERENCES learner_users(id, school_id) ON DELETE SET NULL (learner_id),
  FOREIGN KEY (purchase_id, school_id) REFERENCES flexible_package_purchases(id, school_id),
  FOREIGN KEY (product_version_id, school_id) REFERENCES package_product_versions(id, school_id),
  CHECK (initial_units > 0 AND unit_minutes = 30 AND rate_pence_per_unit > 0),
  CHECK (original_value_pence = initial_units * rate_pence_per_unit),
  CHECK (original_stripe_fee_pence IS NULL OR original_stripe_fee_pence >= 0),
  CHECK (stripe_fee_evidence IS NULL OR jsonb_typeof(stripe_fee_evidence) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_flexible_sources_fifo
  ON flexible_package_sources(school_id, learner_id, available_at, id);

CREATE TABLE IF NOT EXISTS flexible_package_booking_allocations (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  learner_id INTEGER,
  source_id BIGINT NOT NULL,
  booking_id INTEGER NOT NULL,
  instructor_id INTEGER NOT NULL,
  units_allocated INTEGER NOT NULL,
  unit_minutes INTEGER NOT NULL DEFAULT 30,
  rate_pence_per_unit INTEGER NOT NULL,
  contribution_pence INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, source_id, booking_id),
  FOREIGN KEY (learner_id, school_id) REFERENCES learner_users(id, school_id) ON DELETE SET NULL (learner_id),
  FOREIGN KEY (source_id, school_id) REFERENCES flexible_package_sources(id, school_id),
  FOREIGN KEY (booking_id, school_id) REFERENCES lesson_bookings(id, school_id),
  FOREIGN KEY (instructor_id, school_id) REFERENCES instructors(id, school_id),
  CHECK (units_allocated > 0 AND unit_minutes = 30 AND rate_pence_per_unit > 0),
  CHECK (contribution_pence = units_allocated * rate_pence_per_unit)
);

CREATE INDEX IF NOT EXISTS idx_flexible_allocations_booking
  ON flexible_package_booking_allocations(school_id, booking_id);
CREATE INDEX IF NOT EXISTS idx_flexible_allocations_instructor
  ON flexible_package_booking_allocations(school_id, instructor_id, created_at);

CREATE TABLE IF NOT EXISTS flexible_package_allocation_returns (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  allocation_id BIGINT NOT NULL,
  booking_id INTEGER NOT NULL,
  units_returned INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT 'learner_cancelled_48h_plus',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (allocation_id),
  FOREIGN KEY (allocation_id, school_id) REFERENCES flexible_package_booking_allocations(id, school_id),
  FOREIGN KEY (booking_id, school_id) REFERENCES lesson_bookings(id, school_id),
  CHECK (units_returned > 0),
  CHECK (reason IN ('learner_cancelled_48h_plus','admin_eligible_cancellation'))
);

CREATE INDEX IF NOT EXISTS idx_flexible_returns_booking
  ON flexible_package_allocation_returns(school_id, booking_id);

CREATE OR REPLACE FUNCTION validate_flexible_package_allocation_return()
RETURNS TRIGGER AS $$
DECLARE allocation flexible_package_booking_allocations%ROWTYPE;
BEGIN
  SELECT * INTO allocation
    FROM flexible_package_booking_allocations
   WHERE id = NEW.allocation_id;
  IF NOT FOUND
     OR allocation.school_id <> NEW.school_id
     OR allocation.booking_id <> NEW.booking_id
     OR allocation.units_allocated <> NEW.units_returned THEN
    RAISE EXCEPTION 'Flexible Hours return must exactly match its allocation'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_flexible_allocation_return_exact
  ON flexible_package_allocation_returns;
CREATE TRIGGER trg_flexible_allocation_return_exact
  BEFORE INSERT ON flexible_package_allocation_returns
  FOR EACH ROW EXECUTE FUNCTION validate_flexible_package_allocation_return();

CREATE TABLE IF NOT EXISTS flexible_package_source_reductions (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  learner_id INTEGER,
  source_id BIGINT NOT NULL,
  units_reduced INTEGER NOT NULL,
  rate_pence_per_unit INTEGER NOT NULL,
  gross_refund_pence INTEGER NOT NULL,
  stripe_fee_deduction_pence INTEGER NOT NULL DEFAULT 0,
  learner_refund_pence INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'manual_original_method_refund',
  provider_refund_id TEXT,
  evidence_reference TEXT NOT NULL,
  recorded_by_admin_id INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (provider_refund_id),
  FOREIGN KEY (learner_id, school_id) REFERENCES learner_users(id, school_id) ON DELETE SET NULL (learner_id),
  FOREIGN KEY (source_id, school_id) REFERENCES flexible_package_sources(id, school_id),
  FOREIGN KEY (recorded_by_admin_id) REFERENCES admin_users(id),
  CHECK (units_reduced > 0 AND rate_pence_per_unit > 0),
  CHECK (gross_refund_pence = units_reduced * rate_pence_per_unit),
  CHECK (stripe_fee_deduction_pence = 0),
  CHECK (learner_refund_pence = gross_refund_pence),
  CHECK (kind IN ('manual_original_method_refund','admin_correction'))
);

CREATE INDEX IF NOT EXISTS idx_flexible_reductions_source
  ON flexible_package_source_reductions(school_id, source_id, created_at);

CREATE TABLE IF NOT EXISTS flexible_package_state_events (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  learner_id INTEGER,
  event_type TEXT NOT NULL,
  attempt_id UUID,
  purchase_id BIGINT,
  source_id BIGINT,
  booking_id INTEGER,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  FOREIGN KEY (learner_id, school_id) REFERENCES learner_users(id, school_id) ON DELETE SET NULL (learner_id),
  FOREIGN KEY (attempt_id, school_id) REFERENCES flexible_package_purchase_attempts(id, school_id),
  FOREIGN KEY (purchase_id, school_id) REFERENCES flexible_package_purchases(id, school_id),
  FOREIGN KEY (source_id, school_id) REFERENCES flexible_package_sources(id, school_id),
  FOREIGN KEY (booking_id, school_id) REFERENCES lesson_bookings(id, school_id),
  CHECK (jsonb_typeof(detail) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_flexible_state_events_scope
  ON flexible_package_state_events(school_id, learner_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_flexible_state_events_exception
  ON flexible_package_state_events(school_id, event_type, created_at DESC);

CREATE OR REPLACE VIEW flexible_package_source_remaining AS
SELECT s.id AS source_id, s.school_id, s.learner_id, s.purchase_id,
       s.initial_units, s.unit_minutes, s.rate_pence_per_unit,
       GREATEST(0, s.initial_units
         - COALESCE((SELECT SUM(r.units_reduced) FROM flexible_package_source_reductions r
                      WHERE r.source_id = s.id AND r.school_id = s.school_id), 0)
         - COALESCE((SELECT SUM(a.units_allocated)
                       FROM flexible_package_booking_allocations a
                      WHERE a.source_id = s.id AND a.school_id = s.school_id
                        AND NOT EXISTS (
                          SELECT 1 FROM flexible_package_allocation_returns ar
                           WHERE ar.allocation_id = a.id AND ar.school_id = a.school_id
                        )), 0)
       )::INTEGER AS remaining_units,
       GREATEST(0, s.initial_units
         - COALESCE((SELECT SUM(r.units_reduced) FROM flexible_package_source_reductions r
                      WHERE r.source_id = s.id AND r.school_id = s.school_id), 0)
         - COALESCE((SELECT SUM(a.units_allocated)
                       FROM flexible_package_booking_allocations a
                      WHERE a.source_id = s.id AND a.school_id = s.school_id
                        AND NOT EXISTS (
                          SELECT 1 FROM flexible_package_allocation_returns ar
                           WHERE ar.allocation_id = a.id AND ar.school_id = a.school_id
                        )), 0)
       )::INTEGER * s.rate_pence_per_unit AS refundable_value_pence,
       s.available_at, s.created_at
  FROM flexible_package_sources s;

CREATE OR REPLACE VIEW flexible_package_balances AS
SELECT school_id, learner_id,
       COALESCE(SUM(remaining_units), 0)::INTEGER AS remaining_units,
       COALESCE(SUM(remaining_units * unit_minutes), 0)::INTEGER AS remaining_minutes,
       COALESCE(SUM(refundable_value_pence), 0)::INTEGER AS refundable_value_pence
  FROM flexible_package_source_remaining
 WHERE learner_id IS NOT NULL
 GROUP BY school_id, learner_id;

CREATE OR REPLACE FUNCTION forbid_flexible_package_evidence_change()
RETURNS TRIGGER AS $$
BEGIN
  -- Financial evidence is retained for seven years, but GDPR erasure must be
  -- able to detach the learner identity without changing any financial fact.
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(OLD) ? 'learner_id')
     AND (to_jsonb(OLD) -> 'learner_id') <> 'null'::jsonb
     AND (to_jsonb(NEW) -> 'learner_id') = 'null'::jsonb
     AND (to_jsonb(NEW) - 'learner_id') = (to_jsonb(OLD) - 'learner_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'flexible_package_purchases', 'flexible_package_sources',
    'flexible_package_booking_allocations', 'flexible_package_allocation_returns',
    'flexible_package_source_reductions', 'flexible_package_state_events'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_append_only ON %I', table_name, table_name);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_flexible_package_evidence_change()',
      table_name, table_name
    );
  END LOOP;
END $$;
