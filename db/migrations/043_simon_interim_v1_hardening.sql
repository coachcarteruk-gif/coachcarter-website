-- Simon interim v1 hardening.
--
-- Additive and inert. This migration creates no control, account, invitation,
-- approval, payout, transfer, or funding-evidence rows. Runtime behaviour only
-- changes for an instructor after a separately authorised, school-scoped
-- interim_v1_instructor_controls row is created through the hardened command.

CREATE UNIQUE INDEX IF NOT EXISTS uq_instructor_payouts_id_school_interim_v1
  ON instructor_payouts(id, school_id);

CREATE TABLE IF NOT EXISTS connect_v1_account_creation_intents (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  instructor_id INTEGER NOT NULL,
  payouts_start_date DATE NOT NULL,
  stable_identity TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  state TEXT NOT NULL,
  provider_account_id TEXT,
  last_error_class TEXT,
  created_by_admin_id INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, instructor_id),
  UNIQUE (stable_identity),
  UNIQUE (idempotency_key),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  FOREIGN KEY (created_by_admin_id)
    REFERENCES admin_users(id),
  CHECK (stable_identity ~ '^cc:connect-v1:[0-9]+:[0-9]+:live:express$'),
  CHECK (idempotency_key ~ '^cc-connect-v1-[0-9a-f-]{36}$'),
  CHECK (request_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (state IN (
    'planned', 'submitting', 'reconciling', 'succeeded',
    'failed_confirmed', 'manual_review'
  )),
  CHECK (provider_account_id IS NULL OR provider_account_id LIKE 'acct\_%' ESCAPE '\'),
  CHECK (last_error_class IS NULL OR last_error_class IN (
    'card', 'invalid_request', 'authentication', 'permission', 'idempotency',
    'network', 'rate_limit', 'api', 'unknown'
  ))
);

CREATE INDEX IF NOT EXISTS idx_connect_v1_intents_school_state
  ON connect_v1_account_creation_intents(school_id, state, updated_at);

CREATE TABLE IF NOT EXISTS connect_v1_account_creation_attempts (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  instructor_id INTEGER NOT NULL,
  intent_id UUID NOT NULL,
  attempt_number INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  provider_account_id TEXT,
  provider_request_id TEXT,
  error_class TEXT,
  evidence_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, intent_id, attempt_number),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  FOREIGN KEY (intent_id, school_id)
    REFERENCES connect_v1_account_creation_intents(id, school_id),
  CHECK (attempt_number > 0),
  CHECK (outcome IN (
    'provider_succeeded', 'provider_failed_confirmed', 'provider_ambiguous',
    'reconciled_existing', 'reconcile_no_match', 'reconcile_multiple_matches'
  )),
  CHECK (provider_account_id IS NULL OR provider_account_id LIKE 'acct\_%' ESCAPE '\'),
  CHECK (jsonb_typeof(evidence_json) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_connect_v1_attempts_intent
  ON connect_v1_account_creation_attempts(school_id, intent_id, occurred_at);

CREATE TABLE IF NOT EXISTS interim_v1_instructor_controls (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  instructor_id INTEGER NOT NULL,
  account_creation_intent_id UUID NOT NULL,
  payouts_start_date DATE NOT NULL,
  funding_policy TEXT NOT NULL,
  created_by_admin_id INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, instructor_id),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  FOREIGN KEY (account_creation_intent_id, school_id)
    REFERENCES connect_v1_account_creation_intents(id, school_id),
  FOREIGN KEY (created_by_admin_id)
    REFERENCES admin_users(id),
  CHECK (funding_policy = 'exact_direct_slot_stripe')
);

CREATE INDEX IF NOT EXISTS idx_interim_v1_controls_school_start
  ON interim_v1_instructor_controls(school_id, payouts_start_date, instructor_id);

CREATE TABLE IF NOT EXISTS interim_v1_funding_evidence (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  instructor_id INTEGER NOT NULL,
  learner_id INTEGER NOT NULL,
  booking_id INTEGER NOT NULL,
  credit_transaction_id INTEGER NOT NULL,
  booking_credit_source_id INTEGER NOT NULL,
  payment_origin TEXT NOT NULL,
  provider_livemode BOOLEAN NOT NULL,
  stripe_checkout_session_id TEXT,
  stripe_payment_intent_id TEXT,
  stripe_payment_intent_status TEXT,
  stripe_charge_id TEXT,
  stripe_charge_paid BOOLEAN,
  stripe_charge_captured BOOLEAN,
  stripe_charge_payment_intent_id TEXT,
  stripe_balance_transaction_id TEXT,
  stripe_balance_transaction_source_id TEXT,
  stripe_balance_transaction_type TEXT,
  stripe_balance_transaction_amount_pence INTEGER,
  stripe_balance_transaction_currency TEXT,
  stripe_balance_transaction_status TEXT,
  stripe_payment_created_at TIMESTAMPTZ,
  stripe_funds_available_at TIMESTAMPTZ,
  gross_collected_pence INTEGER,
  stripe_fee_pence INTEGER,
  currency TEXT,
  evidence_status TEXT NOT NULL,
  contradiction_code TEXT,
  evidence_fingerprint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, booking_id),
  UNIQUE (school_id, credit_transaction_id),
  UNIQUE (school_id, booking_credit_source_id),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  FOREIGN KEY (learner_id, school_id)
    REFERENCES learner_users(id, school_id),
  FOREIGN KEY (booking_id, school_id)
    REFERENCES lesson_bookings(id, school_id),
  FOREIGN KEY (credit_transaction_id, school_id)
    REFERENCES credit_transactions(id, school_id),
  FOREIGN KEY (booking_credit_source_id, school_id)
    REFERENCES booking_credit_sources(id, school_id),
  CHECK (payment_origin = 'direct_slot'),
  CHECK (currency IS NULL OR (currency = LOWER(currency) AND char_length(currency) = 3)),
  CHECK (gross_collected_pence IS NULL OR gross_collected_pence > 0),
  CHECK (stripe_fee_pence IS NULL OR (
    stripe_fee_pence >= 0
    AND gross_collected_pence IS NOT NULL
    AND stripe_fee_pence <= gross_collected_pence
  )),
  CHECK (evidence_status IN ('pending', 'complete', 'contradictory')),
  CHECK (
    evidence_status <> 'complete'
    OR (
      provider_livemode = TRUE
      AND stripe_checkout_session_id LIKE 'cs\_%' ESCAPE '\'
      AND stripe_payment_intent_id LIKE 'pi\_%' ESCAPE '\'
      AND stripe_payment_intent_status = 'succeeded'
      AND stripe_charge_id LIKE 'ch\_%' ESCAPE '\'
      AND stripe_charge_paid = TRUE
      AND stripe_charge_captured = TRUE
      AND stripe_charge_payment_intent_id = stripe_payment_intent_id
      AND stripe_balance_transaction_id LIKE 'txn\_%' ESCAPE '\'
      AND stripe_balance_transaction_source_id = stripe_charge_id
      AND stripe_balance_transaction_type = 'charge'
      AND stripe_balance_transaction_amount_pence = gross_collected_pence
      AND stripe_balance_transaction_currency = 'gbp'
      AND stripe_balance_transaction_status IN ('available', 'pending')
      AND stripe_payment_created_at IS NOT NULL
      AND stripe_funds_available_at IS NOT NULL
      AND gross_collected_pence IS NOT NULL
      AND stripe_fee_pence IS NOT NULL
      AND currency = 'gbp'
      AND contradiction_code IS NULL
    )
  ),
  CHECK (
    (evidence_status = 'contradictory' AND NULLIF(BTRIM(contradiction_code), '') IS NOT NULL)
    OR (evidence_status <> 'contradictory' AND contradiction_code IS NULL)
  ),
  CHECK (evidence_fingerprint ~ '^sha256:[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_interim_v1_evidence_session
  ON interim_v1_funding_evidence(stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_interim_v1_evidence_payment_intent
  ON interim_v1_funding_evidence(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_interim_v1_evidence_charge
  ON interim_v1_funding_evidence(stripe_charge_id)
  WHERE stripe_charge_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_interim_v1_evidence_balance_tx
  ON interim_v1_funding_evidence(stripe_balance_transaction_id)
  WHERE stripe_balance_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_interim_v1_evidence_instructor_status
  ON interim_v1_funding_evidence(school_id, instructor_id, evidence_status, stripe_payment_created_at);

CREATE TABLE IF NOT EXISTS interim_v1_payout_approvals (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  instructor_id INTEGER NOT NULL,
  preview_fingerprint TEXT NOT NULL,
  approved_amount_pence INTEGER NOT NULL,
  state TEXT NOT NULL,
  approved_by_admin_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  evidence_reference TEXT NOT NULL,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE (id, school_id),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  FOREIGN KEY (approved_by_admin_id)
    REFERENCES admin_users(id),
  CHECK (preview_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (approved_amount_pence > 0),
  CHECK (state IN (
    'approved', 'submitting', 'reconciling', 'completed',
    'failed_confirmed', 'cancelled'
  )),
  CHECK (NULLIF(BTRIM(reason), '') IS NOT NULL),
  CHECK (NULLIF(BTRIM(evidence_reference), '') IS NOT NULL),
  CHECK ((state = 'completed' AND completed_at IS NOT NULL)
    OR (state <> 'completed' AND completed_at IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_interim_v1_open_approval
  ON interim_v1_payout_approvals(school_id, instructor_id)
  WHERE state IN ('approved', 'submitting', 'reconciling');

CREATE TABLE IF NOT EXISTS interim_v1_transfer_intents (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  instructor_id INTEGER NOT NULL,
  approval_id UUID NOT NULL,
  payout_id INTEGER NOT NULL,
  preview_fingerprint TEXT NOT NULL,
  amount_pence INTEGER NOT NULL,
  currency TEXT NOT NULL,
  destination_account_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  state TEXT NOT NULL,
  stripe_transfer_id TEXT,
  last_provider_request_id TEXT,
  last_error_class TEXT,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE (id, school_id),
  UNIQUE (school_id, approval_id),
  UNIQUE (school_id, payout_id),
  UNIQUE (idempotency_key),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  FOREIGN KEY (approval_id, school_id)
    REFERENCES interim_v1_payout_approvals(id, school_id),
  FOREIGN KEY (payout_id, school_id)
    REFERENCES instructor_payouts(id, school_id),
  CHECK (preview_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (amount_pence > 0),
  CHECK (currency = 'gbp'),
  CHECK (destination_account_id LIKE 'acct\_%' ESCAPE '\'),
  CHECK (idempotency_key ~ '^cc-interim-v1-transfer-[0-9a-f-]{36}$'),
  CHECK (state IN (
    'planned', 'submitting', 'reconciling', 'completed',
    'failed_confirmed', 'manual_review'
  )),
  CHECK (stripe_transfer_id IS NULL OR stripe_transfer_id LIKE 'tr\_%' ESCAPE '\'),
  CHECK ((state = 'completed' AND stripe_transfer_id IS NOT NULL AND completed_at IS NOT NULL)
    OR (state <> 'completed' AND completed_at IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_interim_v1_transfer_state
  ON interim_v1_transfer_intents(school_id, state, updated_at);

CREATE TABLE IF NOT EXISTS interim_v1_transfer_attempts (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  instructor_id INTEGER NOT NULL,
  transfer_intent_id UUID NOT NULL,
  attempt_number INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  stripe_transfer_id TEXT,
  provider_request_id TEXT,
  error_class TEXT,
  error_code TEXT,
  evidence_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, transfer_intent_id, attempt_number),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  FOREIGN KEY (transfer_intent_id, school_id)
    REFERENCES interim_v1_transfer_intents(id, school_id),
  CHECK (attempt_number > 0),
  CHECK (outcome IN (
    'provider_succeeded', 'provider_failed_confirmed', 'provider_ambiguous',
    'reconciled_existing', 'reconcile_no_match', 'reconcile_multiple_matches'
  )),
  CHECK (stripe_transfer_id IS NULL OR stripe_transfer_id LIKE 'tr\_%' ESCAPE '\'),
  CHECK (jsonb_typeof(evidence_json) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_interim_v1_transfer_attempts_intent
  ON interim_v1_transfer_attempts(school_id, transfer_intent_id, occurred_at);

CREATE OR REPLACE FUNCTION interim_v1_forbid_append_only_change()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is forbidden', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION interim_v1_guard_account_intent_update()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'interim v1 account creation intents cannot be deleted'
      USING ERRCODE = '55000';
  END IF;
  IF to_jsonb(OLD) - ARRAY[
      'state', 'provider_account_id', 'last_error_class', 'updated_at'
    ]::text[]
    <> to_jsonb(NEW) - ARRAY[
      'state', 'provider_account_id', 'last_error_class', 'updated_at'
    ]::text[]
  THEN
    RAISE EXCEPTION 'interim v1 account identity is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF OLD.provider_account_id IS NOT NULL
    AND OLD.provider_account_id IS DISTINCT FROM NEW.provider_account_id
  THEN
    RAISE EXCEPTION 'interim v1 provider account identity cannot be replaced'
      USING ERRCODE = '55000';
  END IF;
  IF NOT (
    OLD.state = NEW.state
    OR (OLD.state = 'planned' AND NEW.state = 'submitting')
    OR (OLD.state = 'submitting' AND NEW.state IN ('reconciling', 'succeeded', 'failed_confirmed', 'manual_review'))
    OR (OLD.state = 'reconciling' AND NEW.state IN ('succeeded', 'manual_review'))
  ) THEN
    RAISE EXCEPTION 'invalid interim v1 account intent transition'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION interim_v1_guard_control_update()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'interim v1 instructor controls cannot be deleted'
      USING ERRCODE = '55000';
  END IF;
  IF to_jsonb(OLD) - 'updated_at' <> to_jsonb(NEW) - 'updated_at' THEN
    RAISE EXCEPTION 'interim v1 instructor control facts are immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION interim_v1_guard_funding_evidence_update()
RETURNS TRIGGER AS $$
DECLARE
  immutable_old JSONB;
  immutable_new JSONB;
  fill_column TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'interim v1 funding evidence cannot be deleted'
      USING ERRCODE = '55000';
  END IF;
  immutable_old := to_jsonb(OLD) - ARRAY[
    'stripe_checkout_session_id', 'stripe_payment_intent_id', 'stripe_payment_intent_status',
    'stripe_charge_id', 'stripe_charge_paid', 'stripe_charge_captured',
    'stripe_charge_payment_intent_id', 'stripe_balance_transaction_id',
    'stripe_balance_transaction_source_id', 'stripe_balance_transaction_type',
    'stripe_balance_transaction_amount_pence', 'stripe_balance_transaction_currency',
    'stripe_balance_transaction_status', 'stripe_payment_created_at',
    'stripe_funds_available_at', 'gross_collected_pence', 'stripe_fee_pence',
    'currency', 'evidence_status', 'contradiction_code',
    'evidence_fingerprint', 'updated_at'
  ]::text[];
  immutable_new := to_jsonb(NEW) - ARRAY[
    'stripe_checkout_session_id', 'stripe_payment_intent_id', 'stripe_payment_intent_status',
    'stripe_charge_id', 'stripe_charge_paid', 'stripe_charge_captured',
    'stripe_charge_payment_intent_id', 'stripe_balance_transaction_id',
    'stripe_balance_transaction_source_id', 'stripe_balance_transaction_type',
    'stripe_balance_transaction_amount_pence', 'stripe_balance_transaction_currency',
    'stripe_balance_transaction_status', 'stripe_payment_created_at',
    'stripe_funds_available_at', 'gross_collected_pence', 'stripe_fee_pence',
    'currency', 'evidence_status', 'contradiction_code',
    'evidence_fingerprint', 'updated_at'
  ]::text[];
  IF immutable_old <> immutable_new THEN
    RAISE EXCEPTION 'interim v1 funding identity is immutable'
      USING ERRCODE = '55000';
  END IF;
  FOREACH fill_column IN ARRAY ARRAY[
    'stripe_checkout_session_id', 'stripe_payment_intent_id', 'stripe_payment_intent_status',
    'stripe_charge_id', 'stripe_charge_paid', 'stripe_charge_captured',
    'stripe_charge_payment_intent_id', 'stripe_balance_transaction_id',
    'stripe_balance_transaction_source_id', 'stripe_balance_transaction_type',
    'stripe_balance_transaction_amount_pence', 'stripe_balance_transaction_currency',
    'stripe_balance_transaction_status', 'stripe_payment_created_at',
    'stripe_funds_available_at', 'gross_collected_pence', 'stripe_fee_pence', 'currency'
  ] LOOP
    IF to_jsonb(OLD)->>fill_column IS NOT NULL
      AND to_jsonb(OLD)->fill_column IS DISTINCT FROM to_jsonb(NEW)->fill_column
    THEN
      RAISE EXCEPTION 'known interim v1 funding evidence cannot be replaced: %', fill_column
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
  IF OLD.evidence_status IN ('complete', 'contradictory')
    AND OLD.evidence_status IS DISTINCT FROM NEW.evidence_status
  THEN
    RAISE EXCEPTION 'terminal interim v1 funding classification is immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION interim_v1_guard_approval_update()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'interim v1 payout approvals cannot be deleted'
      USING ERRCODE = '55000';
  END IF;
  IF to_jsonb(OLD) - ARRAY['state', 'updated_at', 'completed_at']::text[]
    <> to_jsonb(NEW) - ARRAY['state', 'updated_at', 'completed_at']::text[]
  THEN
    RAISE EXCEPTION 'interim v1 approval facts are immutable'
      USING ERRCODE = '55000';
  END IF;
  IF NOT (
    OLD.state = NEW.state
    OR (OLD.state = 'approved' AND NEW.state IN ('submitting', 'cancelled'))
    OR (OLD.state = 'submitting' AND NEW.state IN ('completed', 'reconciling', 'failed_confirmed'))
    OR (OLD.state = 'reconciling' AND NEW.state IN ('completed', 'failed_confirmed'))
  ) THEN
    RAISE EXCEPTION 'invalid interim v1 approval transition'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION interim_v1_guard_transfer_intent_update()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'interim v1 transfer intents cannot be deleted'
      USING ERRCODE = '55000';
  END IF;
  IF to_jsonb(OLD) - ARRAY[
      'state', 'stripe_transfer_id', 'last_provider_request_id',
      'last_error_class', 'last_error_code', 'updated_at', 'completed_at'
    ]::text[]
    <> to_jsonb(NEW) - ARRAY[
      'state', 'stripe_transfer_id', 'last_provider_request_id',
      'last_error_class', 'last_error_code', 'updated_at', 'completed_at'
    ]::text[]
  THEN
    RAISE EXCEPTION 'interim v1 transfer identity is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF OLD.stripe_transfer_id IS NOT NULL
    AND OLD.stripe_transfer_id IS DISTINCT FROM NEW.stripe_transfer_id
  THEN
    RAISE EXCEPTION 'interim v1 Stripe transfer identity cannot be replaced'
      USING ERRCODE = '55000';
  END IF;
  IF NOT (
    OLD.state = NEW.state
    OR (OLD.state = 'planned' AND NEW.state = 'submitting')
    OR (OLD.state = 'submitting' AND NEW.state IN ('completed', 'reconciling', 'failed_confirmed'))
    OR (OLD.state = 'reconciling' AND NEW.state IN ('completed', 'failed_confirmed', 'manual_review'))
  ) THEN
    RAISE EXCEPTION 'invalid interim v1 transfer intent transition'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS connect_v1_account_intents_guard
  ON connect_v1_account_creation_intents;
CREATE TRIGGER connect_v1_account_intents_guard
  BEFORE UPDATE OR DELETE ON connect_v1_account_creation_intents
  FOR EACH ROW EXECUTE FUNCTION interim_v1_guard_account_intent_update();

DROP TRIGGER IF EXISTS connect_v1_account_attempts_append_only
  ON connect_v1_account_creation_attempts;
CREATE TRIGGER connect_v1_account_attempts_append_only
  BEFORE UPDATE OR DELETE ON connect_v1_account_creation_attempts
  FOR EACH ROW EXECUTE FUNCTION interim_v1_forbid_append_only_change();

DROP TRIGGER IF EXISTS interim_v1_controls_guard
  ON interim_v1_instructor_controls;
CREATE TRIGGER interim_v1_controls_guard
  BEFORE UPDATE OR DELETE ON interim_v1_instructor_controls
  FOR EACH ROW EXECUTE FUNCTION interim_v1_guard_control_update();

DROP TRIGGER IF EXISTS interim_v1_funding_evidence_guard
  ON interim_v1_funding_evidence;
CREATE TRIGGER interim_v1_funding_evidence_guard
  BEFORE UPDATE OR DELETE ON interim_v1_funding_evidence
  FOR EACH ROW EXECUTE FUNCTION interim_v1_guard_funding_evidence_update();

DROP TRIGGER IF EXISTS interim_v1_payout_approvals_guard
  ON interim_v1_payout_approvals;
CREATE TRIGGER interim_v1_payout_approvals_guard
  BEFORE UPDATE OR DELETE ON interim_v1_payout_approvals
  FOR EACH ROW EXECUTE FUNCTION interim_v1_guard_approval_update();

DROP TRIGGER IF EXISTS interim_v1_transfer_intents_guard
  ON interim_v1_transfer_intents;
CREATE TRIGGER interim_v1_transfer_intents_guard
  BEFORE UPDATE OR DELETE ON interim_v1_transfer_intents
  FOR EACH ROW EXECUTE FUNCTION interim_v1_guard_transfer_intent_update();

DROP TRIGGER IF EXISTS interim_v1_transfer_attempts_append_only
  ON interim_v1_transfer_attempts;
CREATE TRIGGER interim_v1_transfer_attempts_append_only
  BEFORE UPDATE OR DELETE ON interim_v1_transfer_attempts
  FOR EACH ROW EXECUTE FUNCTION interim_v1_forbid_append_only_change();
