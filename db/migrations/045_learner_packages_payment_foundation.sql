-- Learner Packages Phase 2: durable test-mode payment-attempt evidence only.
--
-- This migration deliberately creates no package purchase, entitlement,
-- balance, enrolment, booking allocation, refund, reward, earning, transfer,
-- or payout rows. The purchasing feature flag is not seeded and therefore
-- remains strictly disabled for every school.

CREATE UNIQUE INDEX IF NOT EXISTS uq_package_versions_id_school_product
  ON package_product_versions(id, school_id, product_id);

CREATE TABLE IF NOT EXISTS package_purchase_attempts (
  id                         UUID PRIMARY KEY,
  school_id                  INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  -- Present while the learner account exists; one-way nullification is the
  -- only permitted snapshot change so retained financial evidence is GDPR-safe.
  learner_id                 INTEGER,
  product_id                 BIGINT NOT NULL,
  product_version_id         BIGINT NOT NULL,
  product_slug               TEXT NOT NULL,
  product_name               TEXT NOT NULL,
  product_description        TEXT NOT NULL DEFAULT '',
  product_snapshot           JSONB NOT NULL,
  amount_pence               INTEGER NOT NULL,
  currency                   TEXT NOT NULL DEFAULT 'GBP',
  customer_terms_version     TEXT NOT NULL,
  stripe_mode                TEXT NOT NULL DEFAULT 'test',
  status                     TEXT NOT NULL DEFAULT 'created',
  client_request_id          UUID NOT NULL,
  idempotency_key            TEXT NOT NULL,
  stripe_checkout_session_id TEXT,
  stripe_payment_intent_id   TEXT,
  stripe_charge_id           TEXT,
  stripe_checkout_url        TEXT,
  provider_expires_at        TIMESTAMPTZ,
  review_after               TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  submission_started_at      TIMESTAMPTZ,
  checkout_created_at        TIMESTAMPTZ,
  paid_at                    TIMESTAMPTZ,
  failed_at                  TIMESTAMPTZ,
  expired_at                 TIMESTAMPTZ,
  review_required_at         TIMESTAMPTZ,
  refunded_at                TIMESTAMPTZ,
  last_provider_event_id     TEXT,
  last_provider_event_type   TEXT,
  last_provider_event_created_at TIMESTAMPTZ,
  failure_code               TEXT,
  failure_message            TEXT,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, learner_id, client_request_id),
  UNIQUE (idempotency_key),
  UNIQUE (stripe_checkout_session_id),
  UNIQUE (stripe_payment_intent_id),
  FOREIGN KEY (learner_id, school_id)
    REFERENCES learner_users(id, school_id) ON DELETE SET NULL (learner_id),
  FOREIGN KEY (product_id, school_id)
    REFERENCES package_products(id, school_id),
  FOREIGN KEY (product_version_id, school_id, product_id)
    REFERENCES package_product_versions(id, school_id, product_id),
  CHECK (jsonb_typeof(product_snapshot) = 'object'),
  CHECK (amount_pence BETWEEN 50 AND 1000000),
  CHECK (currency = 'GBP'),
  CHECK (stripe_mode = 'test'),
  CHECK (status IN (
    'created', 'submitting', 'pending', 'paid', 'failed', 'expired',
    'review_required', 'refunded'
  )),
  CHECK (char_length(BTRIM(product_slug)) BETWEEN 1 AND 120),
  CHECK (char_length(BTRIM(product_name)) BETWEEN 1 AND 240),
  CHECK (char_length(BTRIM(customer_terms_version)) BETWEEN 1 AND 120),
  CHECK (idempotency_key ~ '^cc-package-test-checkout-[0-9a-f-]{36}$'),
  CHECK (stripe_checkout_session_id IS NULL OR stripe_checkout_session_id ~ '^cs_test_[A-Za-z0-9_]+$'),
  CHECK (stripe_payment_intent_id IS NULL OR stripe_payment_intent_id ~ '^pi_[A-Za-z0-9_]+$'),
  CHECK (stripe_charge_id IS NULL OR stripe_charge_id ~ '^ch_[A-Za-z0-9_]+$'),
  CHECK (failure_code IS NULL OR failure_code ~ '^[A-Z0-9_]{1,100}$'),
  CHECK (failure_message IS NULL OR char_length(failure_message) <= 500),
  CHECK (stripe_checkout_url IS NULL OR char_length(stripe_checkout_url) <= 4096)
);

CREATE INDEX IF NOT EXISTS idx_package_attempts_learner_status
  ON package_purchase_attempts(school_id, learner_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_package_attempts_review_queue
  ON package_purchase_attempts(school_id, review_after, created_at)
  WHERE status IN ('submitting', 'pending', 'review_required');

CREATE INDEX IF NOT EXISTS idx_package_attempts_product_version
  ON package_purchase_attempts(school_id, product_id, product_version_id, created_at DESC);

DROP INDEX IF EXISTS uq_package_attempts_active_product;
CREATE UNIQUE INDEX uq_package_attempts_active_product
  ON package_purchase_attempts(school_id, learner_id, product_id)
  WHERE status IN ('created', 'submitting', 'pending', 'paid', 'review_required');

CREATE TABLE IF NOT EXISTS package_payment_events (
  id                         BIGSERIAL PRIMARY KEY,
  school_id                  INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  attempt_id                 UUID NOT NULL,
  stripe_event_id            TEXT NOT NULL,
  event_type                 TEXT NOT NULL,
  stripe_object_id           TEXT NOT NULL,
  livemode                   BOOLEAN NOT NULL,
  payload_sha256             TEXT NOT NULL,
  provider_created_at        TIMESTAMPTZ,
  processing_state           TEXT NOT NULL DEFAULT 'processing',
  delivery_count             INTEGER NOT NULL DEFAULT 1,
  first_received_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_received_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at               TIMESTAMPTZ,
  failure_code               TEXT,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (stripe_event_id),
  FOREIGN KEY (attempt_id, school_id)
    REFERENCES package_purchase_attempts(id, school_id),
  CHECK (livemode = FALSE),
  CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (processing_state IN ('processing', 'processed', 'failed')),
  CHECK (delivery_count > 0),
  CHECK (failure_code IS NULL OR failure_code ~ '^[A-Z0-9_]{1,100}$')
);

CREATE INDEX IF NOT EXISTS idx_package_payment_events_attempt
  ON package_payment_events(school_id, attempt_id, provider_created_at, id);

CREATE INDEX IF NOT EXISTS idx_package_payment_events_failed
  ON package_payment_events(school_id, last_received_at)
  WHERE processing_state = 'failed';

CREATE TABLE IF NOT EXISTS package_purchase_attempt_state_events (
  id                  BIGSERIAL PRIMARY KEY,
  school_id           INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  attempt_id          UUID NOT NULL,
  from_status         TEXT,
  to_status           TEXT NOT NULL,
  source              TEXT NOT NULL,
  stripe_event_id     TEXT,
  detail              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  FOREIGN KEY (attempt_id, school_id)
    REFERENCES package_purchase_attempts(id, school_id),
  CHECK (from_status IS NULL OR from_status IN (
    'created', 'submitting', 'pending', 'paid', 'failed', 'expired',
    'review_required', 'refunded'
  )),
  CHECK (to_status IN (
    'created', 'submitting', 'pending', 'paid', 'failed', 'expired',
    'review_required', 'refunded'
  )),
  CHECK (source IN ('checkout_api', 'package_webhook', 'reconciliation', 'system')),
  CHECK (jsonb_typeof(detail) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_package_attempt_state_events_attempt
  ON package_purchase_attempt_state_events(school_id, attempt_id, id);

CREATE OR REPLACE FUNCTION guard_package_purchase_attempt_change()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'package purchase attempts are retained financial evidence'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.school_id IS DISTINCT FROM OLD.school_id
     OR (
       NEW.learner_id IS DISTINCT FROM OLD.learner_id
       AND NOT (OLD.learner_id IS NOT NULL AND NEW.learner_id IS NULL)
     )
     OR NEW.product_id IS DISTINCT FROM OLD.product_id
     OR NEW.product_version_id IS DISTINCT FROM OLD.product_version_id
     OR NEW.product_slug IS DISTINCT FROM OLD.product_slug
     OR NEW.product_name IS DISTINCT FROM OLD.product_name
     OR NEW.product_description IS DISTINCT FROM OLD.product_description
     OR NEW.product_snapshot IS DISTINCT FROM OLD.product_snapshot
     OR NEW.amount_pence IS DISTINCT FROM OLD.amount_pence
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.customer_terms_version IS DISTINCT FROM OLD.customer_terms_version
     OR NEW.stripe_mode IS DISTINCT FROM OLD.stripe_mode
     OR NEW.client_request_id IS DISTINCT FROM OLD.client_request_id
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'package purchase attempt snapshots are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.stripe_checkout_session_id IS NOT NULL
     AND NEW.stripe_checkout_session_id IS DISTINCT FROM OLD.stripe_checkout_session_id THEN
    RAISE EXCEPTION 'package checkout identity cannot be replaced'
      USING ERRCODE = '55000';
  END IF;
  IF OLD.stripe_payment_intent_id IS NOT NULL
     AND NEW.stripe_payment_intent_id IS DISTINCT FROM OLD.stripe_payment_intent_id THEN
    RAISE EXCEPTION 'package payment intent identity cannot be replaced'
      USING ERRCODE = '55000';
  END IF;
  IF OLD.stripe_charge_id IS NOT NULL
     AND NEW.stripe_charge_id IS DISTINCT FROM OLD.stripe_charge_id THEN
    RAISE EXCEPTION 'package charge identity cannot be replaced'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status = 'created' AND NEW.status IN ('submitting', 'review_required', 'failed', 'paid'))
    OR (OLD.status = 'submitting' AND NEW.status IN ('pending', 'review_required', 'failed', 'expired', 'paid'))
    OR (OLD.status = 'pending' AND NEW.status IN ('review_required', 'failed', 'expired', 'paid'))
    OR (OLD.status = 'failed' AND NEW.status IN ('paid', 'review_required'))
    OR (OLD.status = 'expired' AND NEW.status IN ('paid', 'review_required'))
    OR (OLD.status = 'review_required' AND NEW.status IN ('pending', 'failed', 'expired', 'paid'))
    OR (OLD.status = 'paid' AND NEW.status = 'refunded')
  ) THEN
    RAISE EXCEPTION 'invalid package purchase attempt status transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_package_purchase_attempt_change
  ON package_purchase_attempts;
CREATE TRIGGER trg_guard_package_purchase_attempt_change
BEFORE UPDATE OR DELETE ON package_purchase_attempts
FOR EACH ROW EXECUTE FUNCTION guard_package_purchase_attempt_change();

CREATE OR REPLACE FUNCTION guard_package_payment_event_change()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'package payment events are retained evidence'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.school_id IS DISTINCT FROM OLD.school_id
     OR NEW.attempt_id IS DISTINCT FROM OLD.attempt_id
     OR NEW.stripe_event_id IS DISTINCT FROM OLD.stripe_event_id
     OR NEW.event_type IS DISTINCT FROM OLD.event_type
     OR NEW.stripe_object_id IS DISTINCT FROM OLD.stripe_object_id
     OR NEW.livemode IS DISTINCT FROM OLD.livemode
     OR NEW.payload_sha256 IS DISTINCT FROM OLD.payload_sha256
     OR NEW.provider_created_at IS DISTINCT FROM OLD.provider_created_at
     OR NEW.first_received_at IS DISTINCT FROM OLD.first_received_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'package payment event provider evidence is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.processing_state IS DISTINCT FROM OLD.processing_state AND NOT (
    (OLD.processing_state = 'processing' AND NEW.processing_state IN ('processed', 'failed'))
    OR (OLD.processing_state = 'failed' AND NEW.processing_state = 'processing')
  ) THEN
    RAISE EXCEPTION 'invalid package payment event transition: % -> %', OLD.processing_state, NEW.processing_state
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_package_payment_event_change
  ON package_payment_events;
CREATE TRIGGER trg_guard_package_payment_event_change
BEFORE UPDATE OR DELETE ON package_payment_events
FOR EACH ROW EXECUTE FUNCTION guard_package_payment_event_change();

CREATE OR REPLACE FUNCTION forbid_package_attempt_state_event_change()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'package purchase attempt state events are append-only'
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_package_attempt_state_events_append_only
  ON package_purchase_attempt_state_events;
CREATE TRIGGER trg_package_attempt_state_events_append_only
BEFORE UPDATE OR DELETE ON package_purchase_attempt_state_events
FOR EACH ROW EXECUTE FUNCTION forbid_package_attempt_state_event_change();
