-- Instructor Payout v2: inactive, append-only ledger foundation.
--
-- This migration creates accounting structures only. It does not backfill data,
-- activate the v2 engine, create a Stripe transfer, or mutate v1 payout history.
-- Every tenant key is mandatory and deliberately has no DEFAULT.

ALTER TABLE schools
  ADD COLUMN IF NOT EXISTS payout_engine_version TEXT NOT NULL DEFAULT 'v1';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'schools_payout_engine_version_check'
       AND conrelid = 'schools'::regclass
  ) THEN
    ALTER TABLE schools
      ADD CONSTRAINT schools_payout_engine_version_check
      CHECK (payout_engine_version IN ('v1', 'v2'));
  END IF;
END $$;

-- Composite keys make tenant equality enforceable by foreign keys rather than
-- relying on callers to remember a school predicate.
CREATE UNIQUE INDEX IF NOT EXISTS uq_instructors_id_school
  ON instructors(id, school_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_learners_id_school
  ON learner_users(id, school_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bookings_id_school
  ON lesson_bookings(id, school_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_transactions_id_school
  ON credit_transactions(id, school_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_credit_sources_id_school
  ON booking_credit_sources(id, school_id);

CREATE TABLE IF NOT EXISTS payout_funding_sources (
  id                            BIGSERIAL PRIMARY KEY,
  school_id                     INTEGER NOT NULL REFERENCES schools(id),
  learner_id                    INTEGER,
  instructor_id                 INTEGER NOT NULL,
  funding_class                 TEXT NOT NULL,
  credit_transaction_id         INTEGER,
  stripe_checkout_session_id    TEXT,
  stripe_payment_intent_id      TEXT,
  stripe_charge_id              TEXT,
  stripe_balance_transaction_id TEXT,
  currency                      TEXT NOT NULL DEFAULT 'gbp',
  gross_collected_pence         INTEGER NOT NULL,
  stripe_fee_pence              INTEGER NOT NULL,
  payable_pool_pence            INTEGER NOT NULL,
  refundable_pool_pence         INTEGER NOT NULL,
  source_status                 TEXT NOT NULL,
  source_fingerprint            TEXT NOT NULL,
  occurred_at                   TIMESTAMPTZ NOT NULL,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata                      JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (id, school_id),
  UNIQUE (school_id, source_fingerprint),
  FOREIGN KEY (learner_id, school_id)
    REFERENCES learner_users(id, school_id) ON DELETE SET NULL (learner_id),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  FOREIGN KEY (credit_transaction_id, school_id)
    REFERENCES credit_transactions(id, school_id),
  CHECK (funding_class IN (
    'stripe_backed',
    'legacy_pre_connect_settled',
    'platform_goodwill',
    'instructor_goodwill',
    'external_cash_payable',
    'external_cash_settled',
    'free',
    'manual_review'
  )),
  CHECK (source_status IN (
    'pending', 'available', 'refunded', 'disputed', 'exhausted', 'manual_review'
  )),
  CHECK (currency = LOWER(currency) AND char_length(currency) = 3),
  CHECK (gross_collected_pence >= 0),
  CHECK (stripe_fee_pence >= 0 AND stripe_fee_pence <= gross_collected_pence),
  CHECK (payable_pool_pence >= 0),
  CHECK (refundable_pool_pence >= 0),
  CHECK (payable_pool_pence <= gross_collected_pence - stripe_fee_pence),
  CHECK (refundable_pool_pence <= gross_collected_pence - stripe_fee_pence),
  CHECK (source_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (
    funding_class NOT IN (
      'legacy_pre_connect_settled',
      'instructor_goodwill',
      'external_cash_settled',
      'free',
      'manual_review'
    ) OR payable_pool_pence = 0
  ),
  CHECK (
    funding_class <> 'manual_review'
    OR (source_status = 'manual_review' AND payable_pool_pence = 0)
  ),
  CHECK (
    funding_class <> 'stripe_backed'
    OR payable_pool_pence = 0
    OR (
      NULLIF(BTRIM(stripe_payment_intent_id), '') IS NOT NULL
      AND NULLIF(BTRIM(stripe_charge_id), '') IS NOT NULL
      AND NULLIF(BTRIM(stripe_balance_transaction_id), '') IS NOT NULL
      AND metadata->>'fee_evidence' = 'stripe_balance_transaction'
    )
  ),
  CHECK (
    funding_class NOT IN ('platform_goodwill', 'external_cash_payable')
    OR payable_pool_pence = 0
    OR (
      metadata ? 'evidence_reference'
      AND NULLIF(BTRIM(metadata->>'evidence_reference'), '') IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_funding_source_session
  ON payout_funding_sources(school_id, stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_funding_source_payment_intent
  ON payout_funding_sources(school_id, stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_funding_source_charge
  ON payout_funding_sources(school_id, stripe_charge_id)
  WHERE stripe_charge_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_funding_source_balance_tx
  ON payout_funding_sources(school_id, stripe_balance_transaction_id)
  WHERE stripe_balance_transaction_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_funding_source_credit_tx
  ON payout_funding_sources(school_id, credit_transaction_id)
  WHERE credit_transaction_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_funding_source_session_global_guard
  ON payout_funding_sources(stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_funding_source_payment_intent_global_guard
  ON payout_funding_sources(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_funding_source_charge_global_guard
  ON payout_funding_sources(stripe_charge_id)
  WHERE stripe_charge_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_funding_source_balance_tx_global_guard
  ON payout_funding_sources(stripe_balance_transaction_id)
  WHERE stripe_balance_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payout_funding_sources_school_instructor
  ON payout_funding_sources(school_id, instructor_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_payout_funding_sources_learner
  ON payout_funding_sources(school_id, learner_id) WHERE learner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payout_funding_sources_credit_tx
  ON payout_funding_sources(school_id, credit_transaction_id)
  WHERE credit_transaction_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS payout_source_import_runs (
  id                    BIGSERIAL PRIMARY KEY,
  school_id             INTEGER NOT NULL REFERENCES schools(id),
  import_version        TEXT NOT NULL,
  plan_fingerprint      TEXT NOT NULL,
  candidate_count       INTEGER NOT NULL,
  totals                JSONB NOT NULL,
  operator_identity     TEXT NOT NULL,
  evidence_reference    TEXT NOT NULL,
  created_source_count  INTEGER NOT NULL,
  existing_source_count INTEGER NOT NULL,
  applied_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (id, school_id),
  UNIQUE (school_id, plan_fingerprint),
  CHECK (plan_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (candidate_count >= 0),
  CHECK (created_source_count >= 0),
  CHECK (existing_source_count >= 0),
  CHECK (created_source_count + existing_source_count = candidate_count),
  CHECK (NULLIF(BTRIM(operator_identity), '') IS NOT NULL),
  CHECK (NULLIF(BTRIM(evidence_reference), '') IS NOT NULL),
  CHECK (
    totals ?& ARRAY[
      'gross_collected_pence',
      'stripe_fee_pence',
      'payable_pool_pence',
      'refundable_pool_pence',
      'funding_class_counts'
    ]
  )
);

CREATE INDEX IF NOT EXISTS idx_payout_source_import_runs_school_applied
  ON payout_source_import_runs(school_id, applied_at);

CREATE TABLE IF NOT EXISTS booking_earnings (
  id                                BIGSERIAL PRIMARY KEY,
  school_id                         INTEGER NOT NULL REFERENCES schools(id),
  booking_id                        INTEGER NOT NULL,
  instructor_id                     INTEGER NOT NULL,
  payout_route                      TEXT NOT NULL,
  gross_price_snapshot_pence        INTEGER NOT NULL,
  stripe_fee_snapshot_pence         INTEGER NOT NULL,
  instructor_earning_pence          INTEGER NOT NULL,
  platform_fee_pence                INTEGER NOT NULL,
  franchise_fee_allocation_pence    INTEGER NOT NULL DEFAULT 0,
  commission_rate_snapshot          NUMERIC(7,6),
  earning_status                    TEXT NOT NULL,
  earned_at                         TIMESTAMPTZ NOT NULL,
  blocked_reason                    TEXT,
  calculation_version               TEXT NOT NULL,
  calculation_fingerprint           TEXT NOT NULL,
  calculation_json                  JSONB NOT NULL,
  created_at                        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, booking_id),
  UNIQUE (school_id, calculation_fingerprint),
  FOREIGN KEY (booking_id, school_id)
    REFERENCES lesson_bookings(id, school_id),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  CHECK (payout_route IN ('instructor_direct', 'school')),
  CHECK (gross_price_snapshot_pence >= 0),
  CHECK (stripe_fee_snapshot_pence >= 0),
  CHECK (instructor_earning_pence >= 0),
  CHECK (platform_fee_pence >= 0),
  CHECK (franchise_fee_allocation_pence >= 0),
  CHECK (
    gross_price_snapshot_pence =
      stripe_fee_snapshot_pence +
      instructor_earning_pence +
      platform_fee_pence +
      franchise_fee_allocation_pence
  ),
  CHECK (
    commission_rate_snapshot IS NULL
    OR (commission_rate_snapshot >= 0 AND commission_rate_snapshot <= 1)
  ),
  CHECK (earning_status IN (
    'earned', 'claimed', 'transferring', 'transferred', 'adjusted', 'blocked', 'zero_value'
  )),
  CHECK (
    (earning_status = 'blocked' AND NULLIF(BTRIM(blocked_reason), '') IS NOT NULL)
    OR (earning_status <> 'blocked' AND blocked_reason IS NULL)
  ),
  CHECK (NULLIF(BTRIM(calculation_version), '') IS NOT NULL),
  CHECK (calculation_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (jsonb_typeof(calculation_json) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_booking_earnings_school_instructor
  ON booking_earnings(school_id, instructor_id, earned_at);
CREATE INDEX IF NOT EXISTS idx_booking_earnings_school_status
  ON booking_earnings(school_id, earning_status, earned_at);

CREATE TABLE IF NOT EXISTS booking_earning_sources (
  id                                    BIGSERIAL PRIMARY KEY,
  school_id                             INTEGER NOT NULL REFERENCES schools(id),
  booking_earning_id                    BIGINT NOT NULL,
  funding_source_id                     BIGINT NOT NULL,
  booking_credit_source_id              INTEGER,
  gross_contribution_pence              INTEGER NOT NULL,
  stripe_fee_contribution_pence         INTEGER NOT NULL,
  payable_contribution_pence            INTEGER NOT NULL,
  instructor_earning_contribution_pence INTEGER NOT NULL,
  platform_fee_contribution_pence       INTEGER NOT NULL DEFAULT 0,
  franchise_fee_contribution_pence      INTEGER NOT NULL DEFAULT 0,
  allocation_fingerprint                TEXT NOT NULL,
  created_at                            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, allocation_fingerprint),
  UNIQUE (school_id, booking_earning_id, funding_source_id, booking_credit_source_id),
  FOREIGN KEY (booking_earning_id, school_id)
    REFERENCES booking_earnings(id, school_id),
  FOREIGN KEY (funding_source_id, school_id)
    REFERENCES payout_funding_sources(id, school_id),
  FOREIGN KEY (booking_credit_source_id, school_id)
    REFERENCES booking_credit_sources(id, school_id),
  CHECK (gross_contribution_pence >= 0),
  CHECK (stripe_fee_contribution_pence >= 0),
  CHECK (payable_contribution_pence >= 0),
  CHECK (instructor_earning_contribution_pence >= 0),
  CHECK (platform_fee_contribution_pence >= 0),
  CHECK (franchise_fee_contribution_pence >= 0),
  CHECK (payable_contribution_pence = instructor_earning_contribution_pence),
  CHECK (
    gross_contribution_pence =
      stripe_fee_contribution_pence +
      instructor_earning_contribution_pence +
      platform_fee_contribution_pence +
      franchise_fee_contribution_pence
  ),
  CHECK (allocation_fingerprint ~ '^sha256:[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_booking_earning_sources_earning
  ON booking_earning_sources(school_id, booking_earning_id);
CREATE INDEX IF NOT EXISTS idx_booking_earning_sources_source
  ON booking_earning_sources(school_id, funding_source_id);
CREATE INDEX IF NOT EXISTS idx_booking_earning_sources_bcs
  ON booking_earning_sources(school_id, booking_credit_source_id)
  WHERE booking_credit_source_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS payout_batches (
  id                       BIGSERIAL PRIMARY KEY,
  school_id                INTEGER NOT NULL REFERENCES schools(id),
  instructor_id            INTEGER,
  destination_school_id    INTEGER,
  payout_route             TEXT NOT NULL,
  period_start             DATE NOT NULL,
  period_end               DATE NOT NULL,
  currency                 TEXT NOT NULL DEFAULT 'gbp',
  gross_pence              INTEGER NOT NULL,
  stripe_fees_pence        INTEGER NOT NULL,
  platform_fee_pence       INTEGER NOT NULL,
  franchise_fee_pence      INTEGER NOT NULL DEFAULT 0,
  instructor_amount_pence  INTEGER NOT NULL,
  shortfall_pence          INTEGER NOT NULL DEFAULT 0,
  deposit_deducted_pence   INTEGER NOT NULL DEFAULT 0,
  recovery_deducted_pence  INTEGER NOT NULL DEFAULT 0,
  state                    TEXT NOT NULL,
  calculation_version      TEXT NOT NULL,
  plan_fingerprint         TEXT NOT NULL,
  plan_json                JSONB NOT NULL,
  created_by_type          TEXT NOT NULL,
  created_by_id            INTEGER,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at             TIMESTAMPTZ,
  settled_at               TIMESTAMPTZ,
  failure_reason           TEXT,
  UNIQUE (id, school_id),
  UNIQUE (school_id, plan_fingerprint),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  CHECK (payout_route IN ('instructor_direct', 'school')),
  CHECK (
    (payout_route = 'instructor_direct' AND instructor_id IS NOT NULL AND destination_school_id IS NULL)
    OR
    (payout_route = 'school' AND instructor_id IS NULL AND destination_school_id = school_id)
  ),
  CHECK (period_start <= period_end),
  CHECK (currency = LOWER(currency) AND char_length(currency) = 3),
  CHECK (gross_pence >= 0),
  CHECK (stripe_fees_pence >= 0),
  CHECK (platform_fee_pence >= 0),
  CHECK (franchise_fee_pence >= 0),
  CHECK (instructor_amount_pence >= 0),
  CHECK (shortfall_pence >= 0),
  CHECK (deposit_deducted_pence >= 0),
  CHECK (recovery_deducted_pence >= 0),
  CHECK (
    gross_pence =
      stripe_fees_pence +
      platform_fee_pence +
      franchise_fee_pence +
      instructor_amount_pence +
      shortfall_pence +
      deposit_deducted_pence +
      recovery_deducted_pence
  ),
  CHECK (state IN (
    'planned', 'claimed', 'submitting', 'reconciling', 'transferred', 'bank_paid',
    'blocked', 'failed_confirmed', 'bank_payout_failed'
  )),
  CHECK (NULLIF(BTRIM(calculation_version), '') IS NOT NULL),
  CHECK (plan_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (jsonb_typeof(plan_json) = 'object'),
  CHECK (created_by_type IN ('system', 'admin', 'migration'))
);

CREATE INDEX IF NOT EXISTS idx_payout_batches_school_period
  ON payout_batches(school_id, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_payout_batches_instructor
  ON payout_batches(school_id, instructor_id, state) WHERE instructor_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS payout_batch_earnings (
  id                  BIGSERIAL PRIMARY KEY,
  school_id           INTEGER NOT NULL REFERENCES schools(id),
  payout_batch_id     BIGINT NOT NULL,
  booking_earning_id  BIGINT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, booking_earning_id),
  UNIQUE (school_id, payout_batch_id, booking_earning_id),
  FOREIGN KEY (payout_batch_id, school_id)
    REFERENCES payout_batches(id, school_id),
  FOREIGN KEY (booking_earning_id, school_id)
    REFERENCES booking_earnings(id, school_id)
);

CREATE INDEX IF NOT EXISTS idx_payout_batch_earnings_batch
  ON payout_batch_earnings(school_id, payout_batch_id);

CREATE TABLE IF NOT EXISTS payout_transfers (
  id                            BIGSERIAL PRIMARY KEY,
  school_id                     INTEGER NOT NULL REFERENCES schools(id),
  payout_batch_id               BIGINT NOT NULL,
  instructor_id                 INTEGER,
  destination_school_id         INTEGER,
  stripe_destination_account_id TEXT NOT NULL,
  stripe_source_charge_id       TEXT,
  amount_pence                  INTEGER NOT NULL,
  currency                      TEXT NOT NULL DEFAULT 'gbp',
  idempotency_key               TEXT NOT NULL,
  transfer_group                TEXT NOT NULL,
  plan_fingerprint              TEXT NOT NULL,
  logical_transfer_fingerprint  TEXT NOT NULL,
  stripe_transfer_id            TEXT,
  state                         TEXT NOT NULL,
  request_created_at            TIMESTAMPTZ,
  stripe_created_at             TIMESTAMPTZ,
  reconciled_at                 TIMESTAMPTZ,
  last_error_code               TEXT,
  last_error_message            TEXT,
  metadata                      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (idempotency_key),
  UNIQUE (school_id, logical_transfer_fingerprint),
  FOREIGN KEY (payout_batch_id, school_id)
    REFERENCES payout_batches(id, school_id),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  CHECK (
    (instructor_id IS NOT NULL AND destination_school_id IS NULL)
    OR (instructor_id IS NULL AND destination_school_id = school_id)
  ),
  CHECK (amount_pence > 0),
  CHECK (currency = LOWER(currency) AND char_length(currency) = 3),
  CHECK (char_length(idempotency_key) BETWEEN 1 AND 255),
  CHECK (NULLIF(BTRIM(transfer_group), '') IS NOT NULL),
  CHECK (plan_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (logical_transfer_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (state IN (
    'planned', 'submitting', 'reconciling', 'transferred',
    'failed_confirmed', 'reversed', 'blocked'
  ))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_transfers_stripe_id
  ON payout_transfers(stripe_transfer_id) WHERE stripe_transfer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payout_transfers_batch
  ON payout_transfers(school_id, payout_batch_id);
CREATE INDEX IF NOT EXISTS idx_payout_transfers_destination
  ON payout_transfers(school_id, stripe_destination_account_id, state);

CREATE TABLE IF NOT EXISTS payout_transfer_attempts (
  id                    BIGSERIAL PRIMARY KEY,
  school_id             INTEGER NOT NULL REFERENCES schools(id),
  payout_transfer_id    BIGINT NOT NULL,
  attempt_kind          TEXT NOT NULL,
  outcome               TEXT NOT NULL,
  stripe_request_id     TEXT,
  stripe_transfer_id    TEXT,
  evidence_fingerprint  TEXT NOT NULL,
  evidence_json         JSONB NOT NULL,
  occurred_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, evidence_fingerprint),
  FOREIGN KEY (payout_transfer_id, school_id)
    REFERENCES payout_transfers(id, school_id),
  CHECK (attempt_kind IN ('submission', 'reconciliation')),
  CHECK (outcome IN (
    'started', 'succeeded', 'ambiguous', 'failed_confirmed',
    'found', 'not_found_safe_retry', 'operator_review'
  )),
  CHECK (evidence_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (jsonb_typeof(evidence_json) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_payout_transfer_attempts_transfer
  ON payout_transfer_attempts(school_id, payout_transfer_id, occurred_at);

CREATE TABLE IF NOT EXISTS payout_transfer_sources (
  id                   BIGSERIAL PRIMARY KEY,
  school_id            INTEGER NOT NULL REFERENCES schools(id),
  payout_transfer_id   BIGINT NOT NULL,
  funding_source_id    BIGINT NOT NULL,
  amount_pence         INTEGER NOT NULL,
  source_fingerprint   TEXT NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, source_fingerprint),
  UNIQUE (school_id, payout_transfer_id, funding_source_id),
  FOREIGN KEY (payout_transfer_id, school_id)
    REFERENCES payout_transfers(id, school_id),
  FOREIGN KEY (funding_source_id, school_id)
    REFERENCES payout_funding_sources(id, school_id),
  CHECK (amount_pence > 0),
  CHECK (source_fingerprint ~ '^sha256:[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_payout_transfer_sources_transfer
  ON payout_transfer_sources(school_id, payout_transfer_id);
CREATE INDEX IF NOT EXISTS idx_payout_transfer_sources_source
  ON payout_transfer_sources(school_id, funding_source_id);

CREATE TABLE IF NOT EXISTS payout_adjustments (
  id                    BIGSERIAL PRIMARY KEY,
  school_id             INTEGER NOT NULL REFERENCES schools(id),
  instructor_id         INTEGER NOT NULL,
  booking_id            INTEGER,
  payout_batch_id       BIGINT,
  payout_transfer_id    BIGINT,
  funding_source_id     BIGINT,
  parent_adjustment_id  BIGINT,
  adjustment_type       TEXT NOT NULL,
  amount_pence          INTEGER NOT NULL,
  currency              TEXT NOT NULL DEFAULT 'gbp',
  reason                TEXT NOT NULL,
  evidence_reference    TEXT NOT NULL,
  operator_id           INTEGER,
  status                TEXT NOT NULL,
  adjustment_fingerprint TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_at            TIMESTAMPTZ,
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (id, school_id),
  UNIQUE (school_id, adjustment_fingerprint),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  FOREIGN KEY (booking_id, school_id)
    REFERENCES lesson_bookings(id, school_id),
  FOREIGN KEY (payout_batch_id, school_id)
    REFERENCES payout_batches(id, school_id),
  FOREIGN KEY (payout_transfer_id, school_id)
    REFERENCES payout_transfers(id, school_id),
  FOREIGN KEY (funding_source_id, school_id)
    REFERENCES payout_funding_sources(id, school_id),
  FOREIGN KEY (parent_adjustment_id, school_id)
    REFERENCES payout_adjustments(id, school_id),
  CHECK (adjustment_type IN (
    'opening_correction', 'refund', 'dispute', 'chargeback', 'transfer_reversal',
    'recovery', 'recovery_application', 'write_off', 'platform_funding',
    'external_cash_correction'
  )),
  CHECK (amount_pence <> 0),
  CHECK (currency = LOWER(currency) AND char_length(currency) = 3),
  CHECK (NULLIF(BTRIM(reason), '') IS NOT NULL),
  CHECK (NULLIF(BTRIM(evidence_reference), '') IS NOT NULL),
  CHECK (status IN ('pending', 'applied', 'voided')),
  CHECK (adjustment_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (
    adjustment_type <> 'recovery'
    OR (
      amount_pence < 0
      AND parent_adjustment_id IS NULL
      AND payout_batch_id IS NULL
      AND payout_transfer_id IS NULL
      AND status = 'pending'
      AND applied_at IS NULL
      AND operator_id IS NOT NULL
      AND (metadata->>'recovery_policy' = 'full_available_offset') IS TRUE
      AND (jsonb_typeof(metadata->'source_v1_payout_id') = 'number') IS TRUE
      AND ((metadata->>'source_v1_payout_id')::bigint > 0) IS TRUE
      AND (metadata->>'source_stripe_transfer_id' LIKE 'tr\_%' ESCAPE '\') IS TRUE
      AND (jsonb_typeof(metadata->'source_legacy_booking_ids') = 'array') IS TRUE
      AND (jsonb_array_length(metadata->'source_legacy_booking_ids') > 0) IS TRUE
      AND (jsonb_typeof(metadata->'original_recovery_pence') = 'number') IS TRUE
      AND ((metadata->>'original_recovery_pence')::bigint = ABS(amount_pence)) IS TRUE
    )
  ),
  CHECK (
    adjustment_type <> 'recovery_application'
    OR (
      amount_pence > 0
      AND parent_adjustment_id IS NOT NULL
      AND payout_batch_id IS NOT NULL
      AND status = 'applied'
      AND applied_at IS NOT NULL
      AND (metadata->>'recovery_policy' = 'full_available_offset') IS TRUE
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_payout_adjustments_instructor
  ON payout_adjustments(school_id, instructor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_payout_adjustments_booking
  ON payout_adjustments(school_id, booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payout_adjustments_batch
  ON payout_adjustments(school_id, payout_batch_id) WHERE payout_batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payout_adjustments_transfer
  ON payout_adjustments(school_id, payout_transfer_id) WHERE payout_transfer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payout_adjustments_source
  ON payout_adjustments(school_id, funding_source_id) WHERE funding_source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payout_adjustments_parent
  ON payout_adjustments(school_id, parent_adjustment_id)
  WHERE parent_adjustment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_recovery_application_batch
  ON payout_adjustments(school_id, parent_adjustment_id, payout_batch_id)
  WHERE adjustment_type = 'recovery_application';

CREATE TABLE IF NOT EXISTS stripe_event_receipts (
  id                     BIGSERIAL PRIMARY KEY,
  school_id              INTEGER NOT NULL REFERENCES schools(id),
  stripe_event_id        TEXT NOT NULL,
  event_type             TEXT NOT NULL,
  livemode               BOOLEAN NOT NULL,
  object_id              TEXT,
  connected_account_id   TEXT,
  processing_status      TEXT NOT NULL,
  received_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at           TIMESTAMPTZ,
  last_error             TEXT,
  UNIQUE (id, school_id),
  UNIQUE (school_id, stripe_event_id),
  UNIQUE (stripe_event_id),
  CHECK (processing_status IN ('received', 'processing', 'processed', 'failed', 'manual_review'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_stripe_event_receipts_school_event
  ON stripe_event_receipts(school_id, stripe_event_id);
CREATE INDEX IF NOT EXISTS idx_stripe_event_receipts_school_status
  ON stripe_event_receipts(school_id, processing_status, received_at);
CREATE INDEX IF NOT EXISTS idx_stripe_event_receipts_account
  ON stripe_event_receipts(school_id, connected_account_id)
  WHERE connected_account_id IS NOT NULL;

-- Immutable security anchor for resolving a signed connected-account event to
-- one tenant. An account may belong to one instructor or one school, never
-- both, and the Stripe account identity is globally unique.
CREATE TABLE IF NOT EXISTS payout_v2_connected_account_scopes (
  id                     BIGSERIAL PRIMARY KEY,
  school_id              INTEGER NOT NULL REFERENCES schools(id),
  stripe_account_id      TEXT NOT NULL,
  owner_type             TEXT NOT NULL,
  instructor_id          INTEGER,
  destination_school_id  INTEGER,
  evidence_json          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (stripe_account_id),
  UNIQUE (school_id, owner_type, instructor_id, destination_school_id),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  CHECK (stripe_account_id LIKE 'acct\_%' ESCAPE '\'),
  CHECK (owner_type IN ('instructor', 'school')),
  CHECK (
    (owner_type = 'instructor' AND instructor_id IS NOT NULL AND destination_school_id IS NULL)
    OR
    (owner_type = 'school' AND instructor_id IS NULL AND destination_school_id = school_id)
  ),
  CHECK (jsonb_typeof(evidence_json) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_payout_v2_connected_account_scopes_school
  ON payout_v2_connected_account_scopes(school_id, owner_type);

CREATE TABLE IF NOT EXISTS connected_bank_payouts (
  id                     BIGSERIAL PRIMARY KEY,
  school_id              INTEGER NOT NULL REFERENCES schools(id),
  stripe_account_id      TEXT NOT NULL,
  stripe_payout_id       TEXT NOT NULL,
  payout_batch_id        BIGINT,
  amount_pence           INTEGER NOT NULL,
  currency               TEXT NOT NULL,
  state                  TEXT NOT NULL,
  arrival_estimate       TIMESTAMPTZ,
  stripe_created_at      TIMESTAMPTZ,
  paid_at                TIMESTAMPTZ,
  failed_at              TIMESTAMPTZ,
  failure_code           TEXT,
  failure_message        TEXT,
  evidence_json          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (stripe_payout_id),
  FOREIGN KEY (payout_batch_id, school_id)
    REFERENCES payout_batches(id, school_id),
  CHECK (amount_pence > 0),
  CHECK (currency = LOWER(currency) AND char_length(currency) = 3),
  CHECK (state IN ('created', 'pending', 'in_transit', 'paid', 'failed', 'cancelled', 'manual_review'))
);

CREATE INDEX IF NOT EXISTS idx_connected_bank_payouts_account
  ON connected_bank_payouts(school_id, stripe_account_id, stripe_created_at);
CREATE INDEX IF NOT EXISTS idx_connected_bank_payouts_batch
  ON connected_bank_payouts(school_id, payout_batch_id)
  WHERE payout_batch_id IS NOT NULL;

-- One immutable, PII-minimised evidence envelope per signed Stripe event.
-- The mutable receipt tracks processing; this table preserves what was
-- actually observed and the resulting disposition.
CREATE TABLE IF NOT EXISTS payout_v2_stripe_evidence_events (
  id                     BIGSERIAL PRIMARY KEY,
  school_id              INTEGER NOT NULL REFERENCES schools(id),
  stripe_event_id        TEXT NOT NULL,
  event_type             TEXT NOT NULL,
  livemode               BOOLEAN NOT NULL,
  connected_account_id   TEXT,
  object_type            TEXT NOT NULL,
  object_id              TEXT NOT NULL,
  disposition            TEXT NOT NULL,
  operator_review_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence_fingerprint   TEXT NOT NULL,
  evidence_json          JSONB NOT NULL,
  stripe_created_at      TIMESTAMPTZ,
  received_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (stripe_event_id),
  UNIQUE (school_id, evidence_fingerprint),
  FOREIGN KEY (school_id, stripe_event_id)
    REFERENCES stripe_event_receipts(school_id, stripe_event_id),
  CHECK (object_type IN ('transfer', 'payout', 'charge', 'dispute')),
  CHECK (disposition IN ('applied', 'no_op', 'operator_review')),
  CHECK (jsonb_typeof(operator_review_reasons) = 'array'),
  CHECK (evidence_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (jsonb_typeof(evidence_json) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_payout_v2_stripe_evidence_school_object
  ON payout_v2_stripe_evidence_events(school_id, object_type, object_id);
CREATE INDEX IF NOT EXISTS idx_payout_v2_stripe_evidence_review
  ON payout_v2_stripe_evidence_events(school_id, received_at)
  WHERE disposition = 'operator_review';

-- A transfer, reversal, refund, or dispute event can relate to more than one
-- local transfer. The event envelope is stored once and these exact,
-- append-only links retain each relationship without rewriting history.
CREATE TABLE IF NOT EXISTS payout_v2_stripe_evidence_transfer_links (
  id                       BIGSERIAL PRIMARY KEY,
  school_id                INTEGER NOT NULL REFERENCES schools(id),
  stripe_evidence_event_id BIGINT NOT NULL,
  payout_transfer_id       BIGINT NOT NULL,
  relationship             TEXT NOT NULL,
  identity_status          TEXT NOT NULL,
  evidence_json            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, stripe_evidence_event_id, payout_transfer_id, relationship),
  FOREIGN KEY (stripe_evidence_event_id, school_id)
    REFERENCES payout_v2_stripe_evidence_events(id, school_id),
  FOREIGN KEY (payout_transfer_id, school_id)
    REFERENCES payout_transfers(id, school_id),
  CHECK (relationship IN (
    'transfer_observed', 'transfer_reversal', 'source_refund', 'source_dispute'
  )),
  CHECK (identity_status IN ('matched', 'contradictory', 'operator_review')),
  CHECK (jsonb_typeof(evidence_json) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_payout_v2_evidence_transfer_links_transfer
  ON payout_v2_stripe_evidence_transfer_links(school_id, payout_transfer_id);

-- Exact Stripe balance-transaction evidence linking any number of Payout v2
-- transfers to one connected bank payout. A failed payout and a later payout
-- may both reference the same original transfer, so transfer_id is
-- deliberately not globally unique here.
CREATE TABLE IF NOT EXISTS connected_bank_payout_transfer_links (
  id                         BIGSERIAL PRIMARY KEY,
  school_id                  INTEGER NOT NULL REFERENCES schools(id),
  connected_bank_payout_id   BIGINT NOT NULL,
  payout_transfer_id         BIGINT NOT NULL,
  stripe_balance_transaction_id TEXT NOT NULL,
  amount_pence               INTEGER NOT NULL,
  currency                   TEXT NOT NULL,
  link_fingerprint           TEXT NOT NULL,
  evidence_json              JSONB NOT NULL,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (stripe_balance_transaction_id),
  UNIQUE (school_id, connected_bank_payout_id, payout_transfer_id),
  UNIQUE (school_id, link_fingerprint),
  FOREIGN KEY (connected_bank_payout_id, school_id)
    REFERENCES connected_bank_payouts(id, school_id),
  FOREIGN KEY (payout_transfer_id, school_id)
    REFERENCES payout_transfers(id, school_id),
  CHECK (amount_pence > 0),
  CHECK (currency = LOWER(currency) AND char_length(currency) = 3),
  CHECK (link_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (jsonb_typeof(evidence_json) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_connected_bank_payout_transfer_links_payout
  ON connected_bank_payout_transfer_links(school_id, connected_bank_payout_id);
CREATE INDEX IF NOT EXISTS idx_connected_bank_payout_transfer_links_transfer
  ON connected_bank_payout_transfer_links(school_id, payout_transfer_id);

-- Append-only enforcement. Immutable ledger facts are never updated or
-- deleted. Operational state rows may transition, but are never deleted.
CREATE OR REPLACE FUNCTION payout_v2_reject_change()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is forbidden', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION payout_v2_reject_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% preserves financial history: DELETE is forbidden', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION payout_v2_guard_operational_update()
RETURNS TRIGGER AS $$
DECLARE
  old_facts JSONB := to_jsonb(OLD);
  new_facts JSONB := to_jsonb(NEW);
  allowed_column TEXT;
BEGIN
  FOREACH allowed_column IN ARRAY TG_ARGV LOOP
    old_facts := old_facts - allowed_column;
    new_facts := new_facts - allowed_column;
  END LOOP;
  IF old_facts <> new_facts THEN
    RAISE EXCEPTION '% accounting identity/totals are immutable', TG_TABLE_NAME
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payout_funding_sources_append_only ON payout_funding_sources;
CREATE TRIGGER payout_funding_sources_append_only
  BEFORE UPDATE OR DELETE ON payout_funding_sources
  FOR EACH ROW EXECUTE FUNCTION payout_v2_reject_change();
DROP TRIGGER IF EXISTS payout_source_import_runs_append_only ON payout_source_import_runs;
CREATE TRIGGER payout_source_import_runs_append_only
  BEFORE UPDATE OR DELETE ON payout_source_import_runs
  FOR EACH ROW EXECUTE FUNCTION payout_v2_reject_change();
DROP TRIGGER IF EXISTS booking_earnings_append_only ON booking_earnings;
CREATE TRIGGER booking_earnings_append_only
  BEFORE UPDATE OR DELETE ON booking_earnings
  FOR EACH ROW EXECUTE FUNCTION payout_v2_reject_change();
DROP TRIGGER IF EXISTS booking_earning_sources_append_only ON booking_earning_sources;
CREATE TRIGGER booking_earning_sources_append_only
  BEFORE UPDATE OR DELETE ON booking_earning_sources
  FOR EACH ROW EXECUTE FUNCTION payout_v2_reject_change();
DROP TRIGGER IF EXISTS payout_batch_earnings_append_only ON payout_batch_earnings;
CREATE TRIGGER payout_batch_earnings_append_only
  BEFORE UPDATE OR DELETE ON payout_batch_earnings
  FOR EACH ROW EXECUTE FUNCTION payout_v2_reject_change();
DROP TRIGGER IF EXISTS payout_transfer_sources_append_only ON payout_transfer_sources;
CREATE TRIGGER payout_transfer_sources_append_only
  BEFORE UPDATE OR DELETE ON payout_transfer_sources
  FOR EACH ROW EXECUTE FUNCTION payout_v2_reject_change();
DROP TRIGGER IF EXISTS payout_transfer_attempts_append_only ON payout_transfer_attempts;
CREATE TRIGGER payout_transfer_attempts_append_only
  BEFORE UPDATE OR DELETE ON payout_transfer_attempts
  FOR EACH ROW EXECUTE FUNCTION payout_v2_reject_change();
DROP TRIGGER IF EXISTS payout_adjustments_append_only ON payout_adjustments;
CREATE TRIGGER payout_adjustments_append_only
  BEFORE UPDATE OR DELETE ON payout_adjustments
  FOR EACH ROW EXECUTE FUNCTION payout_v2_reject_change();
DROP TRIGGER IF EXISTS payout_batches_no_delete ON payout_batches;
CREATE TRIGGER payout_batches_no_delete
  BEFORE DELETE ON payout_batches
  FOR EACH ROW EXECUTE FUNCTION payout_v2_reject_delete();
DROP TRIGGER IF EXISTS payout_transfers_no_delete ON payout_transfers;
CREATE TRIGGER payout_transfers_no_delete
  BEFORE DELETE ON payout_transfers
  FOR EACH ROW EXECUTE FUNCTION payout_v2_reject_delete();
DROP TRIGGER IF EXISTS stripe_event_receipts_no_delete ON stripe_event_receipts;
CREATE TRIGGER stripe_event_receipts_no_delete
  BEFORE DELETE ON stripe_event_receipts
  FOR EACH ROW EXECUTE FUNCTION payout_v2_reject_delete();
DROP TRIGGER IF EXISTS connected_bank_payouts_no_delete ON connected_bank_payouts;
CREATE TRIGGER connected_bank_payouts_no_delete
  BEFORE DELETE ON connected_bank_payouts
  FOR EACH ROW EXECUTE FUNCTION payout_v2_reject_delete();
DROP TRIGGER IF EXISTS payout_v2_connected_account_scopes_append_only
  ON payout_v2_connected_account_scopes;
CREATE TRIGGER payout_v2_connected_account_scopes_append_only
  BEFORE UPDATE OR DELETE ON payout_v2_connected_account_scopes
  FOR EACH ROW EXECUTE FUNCTION payout_v2_reject_change();
DROP TRIGGER IF EXISTS payout_v2_stripe_evidence_events_append_only
  ON payout_v2_stripe_evidence_events;
CREATE TRIGGER payout_v2_stripe_evidence_events_append_only
  BEFORE UPDATE OR DELETE ON payout_v2_stripe_evidence_events
  FOR EACH ROW EXECUTE FUNCTION payout_v2_reject_change();
DROP TRIGGER IF EXISTS payout_v2_stripe_evidence_transfer_links_append_only
  ON payout_v2_stripe_evidence_transfer_links;
CREATE TRIGGER payout_v2_stripe_evidence_transfer_links_append_only
  BEFORE UPDATE OR DELETE ON payout_v2_stripe_evidence_transfer_links
  FOR EACH ROW EXECUTE FUNCTION payout_v2_reject_change();
DROP TRIGGER IF EXISTS connected_bank_payout_transfer_links_append_only
  ON connected_bank_payout_transfer_links;
CREATE TRIGGER connected_bank_payout_transfer_links_append_only
  BEFORE UPDATE OR DELETE ON connected_bank_payout_transfer_links
  FOR EACH ROW EXECUTE FUNCTION payout_v2_reject_change();
DROP TRIGGER IF EXISTS payout_batches_immutable_facts ON payout_batches;
CREATE TRIGGER payout_batches_immutable_facts
  BEFORE UPDATE ON payout_batches
  FOR EACH ROW EXECUTE FUNCTION payout_v2_guard_operational_update(
    'state', 'submitted_at', 'settled_at', 'failure_reason'
  );
DROP TRIGGER IF EXISTS payout_transfers_immutable_facts ON payout_transfers;
CREATE TRIGGER payout_transfers_immutable_facts
  BEFORE UPDATE ON payout_transfers
  FOR EACH ROW EXECUTE FUNCTION payout_v2_guard_operational_update(
    'stripe_transfer_id', 'state', 'request_created_at', 'stripe_created_at',
    'reconciled_at', 'last_error_code', 'last_error_message'
  );
DROP TRIGGER IF EXISTS stripe_event_receipts_immutable_facts ON stripe_event_receipts;
CREATE TRIGGER stripe_event_receipts_immutable_facts
  BEFORE UPDATE ON stripe_event_receipts
  FOR EACH ROW EXECUTE FUNCTION payout_v2_guard_operational_update(
    'processing_status', 'processed_at', 'last_error'
  );
DROP TRIGGER IF EXISTS connected_bank_payouts_immutable_facts ON connected_bank_payouts;
CREATE TRIGGER connected_bank_payouts_immutable_facts
  BEFORE UPDATE ON connected_bank_payouts
  FOR EACH ROW EXECUTE FUNCTION payout_v2_guard_operational_update(
    'state', 'arrival_estimate', 'paid_at', 'failed_at', 'failure_code',
    'failure_message', 'evidence_json', 'updated_at'
  );

CREATE OR REPLACE FUNCTION payout_v2_validate_recovery_adjustment()
RETURNS TRIGGER AS $$
DECLARE
  parent_row payout_adjustments%ROWTYPE;
  batch_row payout_batches%ROWTYPE;
  already_applied BIGINT;
BEGIN
  IF NEW.adjustment_type <> 'recovery_application' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO parent_row
    FROM payout_adjustments
   WHERE id = NEW.parent_adjustment_id
     AND school_id = NEW.school_id
   FOR UPDATE;

  IF NOT FOUND
    OR parent_row.adjustment_type <> 'recovery'
    OR parent_row.status <> 'pending'
    OR parent_row.amount_pence >= 0
    OR parent_row.instructor_id <> NEW.instructor_id
    OR parent_row.currency <> NEW.currency
  THEN
    RAISE EXCEPTION 'recovery application does not match an active school-scoped recovery'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO batch_row
    FROM payout_batches
   WHERE id = NEW.payout_batch_id
     AND school_id = NEW.school_id;

  IF NOT FOUND
    OR batch_row.payout_route <> 'instructor_direct'
    OR batch_row.instructor_id <> NEW.instructor_id
    OR batch_row.currency <> NEW.currency
    OR batch_row.state NOT IN ('planned', 'claimed')
  THEN
    RAISE EXCEPTION 'recovery application does not match an eligible school-scoped payout batch'
      USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(SUM(amount_pence), 0)
    INTO already_applied
    FROM payout_adjustments
   WHERE school_id = NEW.school_id
     AND parent_adjustment_id = NEW.parent_adjustment_id
     AND adjustment_type = 'recovery_application';

  IF already_applied + NEW.amount_pence > ABS(parent_row.amount_pence) THEN
    RAISE EXCEPTION 'recovery applications exceed the original recovery obligation'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payout_adjustments_recovery_guard ON payout_adjustments;
CREATE TRIGGER payout_adjustments_recovery_guard
  BEFORE INSERT ON payout_adjustments
  FOR EACH ROW EXECUTE FUNCTION payout_v2_validate_recovery_adjustment();

CREATE OR REPLACE FUNCTION payout_v2_validate_batch_recovery_totals()
RETURNS TRIGGER AS $$
DECLARE
  target_batch_id BIGINT;
  target_school_id INTEGER;
  batch_row payout_batches%ROWTYPE;
  applied_pence BIGINT;
BEGIN
  target_school_id := NEW.school_id;
  IF TG_TABLE_NAME = 'payout_batches' THEN
    target_batch_id := NEW.id;
  ELSE
    target_batch_id := NEW.payout_batch_id;
  END IF;
  IF target_batch_id IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO batch_row
    FROM payout_batches
   WHERE id = target_batch_id
     AND school_id = target_school_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT COALESCE(SUM(amount_pence), 0)
    INTO applied_pence
    FROM payout_adjustments
   WHERE school_id = batch_row.school_id
     AND payout_batch_id = batch_row.id
     AND adjustment_type = 'recovery_application';

  IF applied_pence <> batch_row.recovery_deducted_pence THEN
    RAISE EXCEPTION 'payout batch % recovery applications do not conserve recovery deduction', batch_row.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payout_batches_recovery_totals_guard ON payout_batches;
CREATE CONSTRAINT TRIGGER payout_batches_recovery_totals_guard
  AFTER INSERT ON payout_batches
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION payout_v2_validate_batch_recovery_totals();
DROP TRIGGER IF EXISTS payout_adjustments_recovery_totals_guard ON payout_adjustments;
CREATE CONSTRAINT TRIGGER payout_adjustments_recovery_totals_guard
  AFTER INSERT ON payout_adjustments
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION payout_v2_validate_batch_recovery_totals();

CREATE OR REPLACE FUNCTION payout_v2_validate_source_allocation()
RETURNS TRIGGER AS $$
DECLARE
  source_class TEXT;
BEGIN
  SELECT funding_class INTO source_class
    FROM payout_funding_sources
   WHERE id = NEW.funding_source_id
     AND school_id = NEW.school_id;

  IF source_class IN (
    'legacy_pre_connect_settled',
    'instructor_goodwill',
    'external_cash_settled',
    'free',
    'manual_review'
  ) AND (
    NEW.payable_contribution_pence <> 0
    OR NEW.instructor_earning_contribution_pence <> 0
  ) THEN
    RAISE EXCEPTION 'funding class % cannot contribute to instructor payout', source_class
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS booking_earning_sources_class_guard ON booking_earning_sources;
CREATE TRIGGER booking_earning_sources_class_guard
  BEFORE INSERT ON booking_earning_sources
  FOR EACH ROW EXECUTE FUNCTION payout_v2_validate_source_allocation();

CREATE OR REPLACE FUNCTION payout_v2_validate_earning_totals()
RETURNS TRIGGER AS $$
DECLARE
  earning booking_earnings%ROWTYPE;
  totals RECORD;
  target_id BIGINT;
  target_school_id INTEGER;
BEGIN
  target_school_id := NEW.school_id;
  IF TG_TABLE_NAME = 'booking_earnings' THEN
    target_id := NEW.id;
  ELSE
    target_id := NEW.booking_earning_id;
  END IF;
  SELECT * INTO earning
    FROM booking_earnings
   WHERE id = target_id
     AND school_id = target_school_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT
    COALESCE(SUM(gross_contribution_pence), 0) AS gross,
    COALESCE(SUM(stripe_fee_contribution_pence), 0) AS stripe_fee,
    COALESCE(SUM(instructor_earning_contribution_pence), 0) AS instructor,
    COALESCE(SUM(platform_fee_contribution_pence), 0) AS platform,
    COALESCE(SUM(franchise_fee_contribution_pence), 0) AS franchise
  INTO totals
  FROM booking_earning_sources
  WHERE booking_earning_id = earning.id
    AND school_id = earning.school_id;

  IF totals.gross <> earning.gross_price_snapshot_pence
    OR totals.stripe_fee <> earning.stripe_fee_snapshot_pence
    OR totals.instructor <> earning.instructor_earning_pence
    OR totals.platform <> earning.platform_fee_pence
    OR totals.franchise <> earning.franchise_fee_allocation_pence
  THEN
    RAISE EXCEPTION 'booking earning % source allocations do not conserve totals', earning.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS booking_earning_sources_totals_guard ON booking_earning_sources;
CREATE CONSTRAINT TRIGGER booking_earning_sources_totals_guard
  AFTER INSERT ON booking_earning_sources
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION payout_v2_validate_earning_totals();
DROP TRIGGER IF EXISTS booking_earnings_totals_guard ON booking_earnings;
CREATE CONSTRAINT TRIGGER booking_earnings_totals_guard
  AFTER INSERT ON booking_earnings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION payout_v2_validate_earning_totals();

CREATE OR REPLACE FUNCTION payout_v2_validate_source_caps()
RETURNS TRIGGER AS $$
DECLARE
  source_row payout_funding_sources%ROWTYPE;
  allocated BIGINT;
  transferred BIGINT;
  target_id BIGINT;
  target_school_id INTEGER;
BEGIN
  target_school_id := NEW.school_id;
  target_id := NEW.funding_source_id;
  SELECT * INTO source_row
    FROM payout_funding_sources
   WHERE id = target_id
     AND school_id = target_school_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT COALESCE(SUM(payable_contribution_pence), 0)
    INTO allocated
    FROM booking_earning_sources
   WHERE funding_source_id = source_row.id
     AND school_id = source_row.school_id;
  SELECT COALESCE(SUM(amount_pence), 0)
    INTO transferred
    FROM payout_transfer_sources
   WHERE funding_source_id = source_row.id
     AND school_id = source_row.school_id;

  IF allocated > source_row.payable_pool_pence THEN
    RAISE EXCEPTION 'funding source % allocations exceed payable pool', source_row.id
      USING ERRCODE = '23514';
  END IF;
  IF transferred > allocated OR transferred > source_row.payable_pool_pence THEN
    RAISE EXCEPTION 'funding source % transfers exceed allocated payable value', source_row.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS booking_earning_sources_cap_guard ON booking_earning_sources;
CREATE CONSTRAINT TRIGGER booking_earning_sources_cap_guard
  AFTER INSERT ON booking_earning_sources
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION payout_v2_validate_source_caps();
DROP TRIGGER IF EXISTS payout_transfer_sources_cap_guard ON payout_transfer_sources;
CREATE CONSTRAINT TRIGGER payout_transfer_sources_cap_guard
  AFTER INSERT ON payout_transfer_sources
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION payout_v2_validate_source_caps();

CREATE OR REPLACE FUNCTION payout_v2_validate_transfer_totals()
RETURNS TRIGGER AS $$
DECLARE
  transfer_row payout_transfers%ROWTYPE;
  sourced_pence BIGINT;
  target_transfer_id BIGINT;
  target_school_id INTEGER;
BEGIN
  target_school_id := NEW.school_id;
  IF TG_TABLE_NAME = 'payout_transfers' THEN
    target_transfer_id := NEW.id;
  ELSE
    target_transfer_id := NEW.payout_transfer_id;
  END IF;

  SELECT * INTO transfer_row
    FROM payout_transfers
   WHERE id = target_transfer_id
     AND school_id = target_school_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT COALESCE(SUM(amount_pence), 0)
    INTO sourced_pence
    FROM payout_transfer_sources
   WHERE payout_transfer_id = transfer_row.id
     AND school_id = transfer_row.school_id;

  IF sourced_pence <> transfer_row.amount_pence THEN
    RAISE EXCEPTION 'payout transfer % source allocations do not equal transfer amount', transfer_row.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payout_transfers_totals_guard ON payout_transfers;
CREATE CONSTRAINT TRIGGER payout_transfers_totals_guard
  AFTER INSERT ON payout_transfers
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION payout_v2_validate_transfer_totals();
DROP TRIGGER IF EXISTS payout_transfer_sources_totals_guard ON payout_transfer_sources;
CREATE CONSTRAINT TRIGGER payout_transfer_sources_totals_guard
  AFTER INSERT ON payout_transfer_sources
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION payout_v2_validate_transfer_totals();

-- Slice 6: inactive protected-balance and operator-control evidence.
CREATE TABLE IF NOT EXISTS payout_v2_liquidity_config_versions (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER REFERENCES schools(id),
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('global', 'school')),
  risk_reserve_pence INTEGER NOT NULL CHECK (risk_reserve_pence >= 0),
  effective_at TIMESTAMPTZ NOT NULL,
  reason TEXT NOT NULL CHECK (NULLIF(BTRIM(reason), '') IS NOT NULL),
  operator_id INTEGER NOT NULL,
  config_fingerprint TEXT NOT NULL UNIQUE
    CHECK (config_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  evidence_json JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(evidence_json) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((scope_kind = 'global' AND school_id IS NULL)
      OR (scope_kind = 'school' AND school_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_v2_liquidity_config_global_effective
  ON payout_v2_liquidity_config_versions(effective_at) WHERE scope_kind = 'global';
CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_v2_liquidity_config_school_effective
  ON payout_v2_liquidity_config_versions(school_id, effective_at) WHERE scope_kind = 'school';
CREATE INDEX IF NOT EXISTS idx_payout_v2_liquidity_config_latest
  ON payout_v2_liquidity_config_versions(scope_kind, school_id, effective_at DESC);

CREATE TABLE IF NOT EXISTS payout_v2_refund_obligation_events (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  refund_event_id INTEGER,
  logical_identity TEXT NOT NULL,
  sequence_no INTEGER NOT NULL CHECK (sequence_no > 0),
  state TEXT NOT NULL CHECK (state IN ('approved', 'executed', 'voided')),
  amount_pence INTEGER NOT NULL CHECK (amount_pence > 0),
  evidence_status TEXT NOT NULL
    CHECK (evidence_status IN ('complete', 'contradictory', 'manual_review')),
  reason TEXT NOT NULL CHECK (NULLIF(BTRIM(reason), '') IS NOT NULL),
  operator_id INTEGER NOT NULL,
  external_refund_identity TEXT,
  event_fingerprint TEXT NOT NULL UNIQUE
    CHECK (event_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  evidence_json JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(evidence_json) = 'object'),
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, logical_identity, sequence_no),
  FOREIGN KEY (refund_event_id, school_id) REFERENCES refund_events(id, school_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_v2_refund_obligation_external
  ON payout_v2_refund_obligation_events(external_refund_identity)
  WHERE external_refund_identity IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payout_v2_refund_obligation_latest
  ON payout_v2_refund_obligation_events(school_id, logical_identity, sequence_no DESC, id DESC);

CREATE TABLE IF NOT EXISTS payout_v2_protected_balance_snapshots (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER REFERENCES schools(id),
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('global', 'school')),
  snapshot_identity TEXT NOT NULL UNIQUE,
  calculation_version TEXT NOT NULL,
  calculation_fingerprint TEXT NOT NULL UNIQUE
    CHECK (calculation_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  position_fingerprint TEXT NOT NULL
    CHECK (position_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  input_timestamp TIMESTAMPTZ NOT NULL,
  stripe_available_pence INTEGER NOT NULL,
  stripe_pending_pence INTEGER NOT NULL,
  protected_free_cash_pence INTEGER NOT NULL,
  transfer_readiness_pence INTEGER NOT NULL,
  calculation_json JSONB NOT NULL CHECK (jsonb_typeof(calculation_json) = 'object'),
  blocker_codes JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(blocker_codes) = 'array'),
  authority_class TEXT NOT NULL CHECK (authority_class IN ('cron', 'superadmin', 'scoped_operator')),
  evidence_fingerprint TEXT NOT NULL UNIQUE
    CHECK (evidence_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((scope_kind = 'global' AND school_id IS NULL)
      OR (scope_kind = 'school' AND school_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_payout_v2_protected_snapshots_scope
  ON payout_v2_protected_balance_snapshots(scope_kind, school_id, input_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_payout_v2_protected_snapshots_negative
  ON payout_v2_protected_balance_snapshots(input_timestamp DESC)
  WHERE protected_free_cash_pence < 0;

CREATE TABLE IF NOT EXISTS payout_v2_operator_evidence (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER REFERENCES schools(id),
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('global', 'school')),
  evidence_type TEXT NOT NULL CHECK (evidence_type IN (
    'withdrawal_preflight', 'withdrawal_record', 'mutation_refusal',
    'mutation_approval', 'alert_result'
  )),
  logical_identity TEXT NOT NULL UNIQUE,
  external_identity TEXT,
  authority_class TEXT NOT NULL CHECK (authority_class IN ('cron', 'superadmin', 'scoped_operator')),
  operator_id INTEGER,
  reason TEXT NOT NULL CHECK (NULLIF(BTRIM(reason), '') IS NOT NULL),
  confirmation_fingerprint TEXT
    CHECK (confirmation_fingerprint IS NULL OR confirmation_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  expected_calculation_fingerprint TEXT
    CHECK (expected_calculation_fingerprint IS NULL OR expected_calculation_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  calculation_fingerprint TEXT
    CHECK (calculation_fingerprint IS NULL OR calculation_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  proposed_amount_pence INTEGER CHECK (proposed_amount_pence IS NULL OR proposed_amount_pence > 0),
  before_protected_balance_pence INTEGER,
  after_protected_balance_pence INTEGER,
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'refused', 'recorded', 'failed')),
  refusal_codes JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(refusal_codes) = 'array'),
  alert_emission_status TEXT
    CHECK (alert_emission_status IS NULL OR alert_emission_status IN (
      'not_required', 'deduplicated', 'emitted', 'failed'
    )),
  alert_deduplication_identity TEXT,
  evidence_fingerprint TEXT NOT NULL UNIQUE
    CHECK (evidence_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  evidence_json JSONB NOT NULL CHECK (jsonb_typeof(evidence_json) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((scope_kind = 'global' AND school_id IS NULL)
      OR (scope_kind = 'school' AND school_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_v2_operator_external_identity
  ON payout_v2_operator_evidence(external_identity) WHERE external_identity IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payout_v2_operator_evidence_scope
  ON payout_v2_operator_evidence(scope_kind, school_id, created_at DESC);

CREATE TABLE IF NOT EXISTS payout_v2_protected_balance_alert_events (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER REFERENCES schools(id),
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('global', 'school')),
  alert_identity TEXT NOT NULL CHECK (alert_identity ~ '^sha256:[0-9a-f]{64}$'),
  event_identity TEXT NOT NULL UNIQUE,
  phase TEXT NOT NULL CHECK (phase IN ('claim', 'result')),
  classification TEXT NOT NULL CHECK (classification IN (
    'ordinary_liability_growth', 'observed_external_manual_dashboard_withdrawal',
    'missing_stripe_balance_evidence', 'stale_stripe_balance_evidence',
    'unexplained_balance_movement'
  )),
  status TEXT NOT NULL CHECK (status IN ('claimed', 'emitted', 'failed')),
  calculation_fingerprint TEXT NOT NULL
    CHECK (calculation_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  position_fingerprint TEXT NOT NULL
    CHECK (position_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  protected_free_cash_pence INTEGER NOT NULL,
  blocker_codes JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(blocker_codes) = 'array'),
  transport_reference TEXT,
  failure_code TEXT,
  event_fingerprint TEXT NOT NULL UNIQUE
    CHECK (event_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  evidence_json JSONB NOT NULL CHECK (jsonb_typeof(evidence_json) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((scope_kind = 'global' AND school_id IS NULL)
      OR (scope_kind = 'school' AND school_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_payout_v2_protected_alert_scope
  ON payout_v2_protected_balance_alert_events(scope_kind, school_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payout_v2_protected_alert_identity
  ON payout_v2_protected_balance_alert_events(alert_identity, phase);

DROP TRIGGER IF EXISTS payout_v2_liquidity_config_versions_append_only ON payout_v2_liquidity_config_versions;
CREATE TRIGGER payout_v2_liquidity_config_versions_append_only
  BEFORE UPDATE OR DELETE ON payout_v2_liquidity_config_versions
  FOR EACH ROW EXECUTE FUNCTION payout_v2_reject_change();
DROP TRIGGER IF EXISTS payout_v2_refund_obligation_events_append_only ON payout_v2_refund_obligation_events;
CREATE TRIGGER payout_v2_refund_obligation_events_append_only
  BEFORE UPDATE OR DELETE ON payout_v2_refund_obligation_events
  FOR EACH ROW EXECUTE FUNCTION payout_v2_reject_change();
DROP TRIGGER IF EXISTS payout_v2_protected_balance_snapshots_append_only ON payout_v2_protected_balance_snapshots;
CREATE TRIGGER payout_v2_protected_balance_snapshots_append_only
  BEFORE UPDATE OR DELETE ON payout_v2_protected_balance_snapshots
  FOR EACH ROW EXECUTE FUNCTION payout_v2_reject_change();
DROP TRIGGER IF EXISTS payout_v2_operator_evidence_append_only ON payout_v2_operator_evidence;
CREATE TRIGGER payout_v2_operator_evidence_append_only
  BEFORE UPDATE OR DELETE ON payout_v2_operator_evidence
  FOR EACH ROW EXECUTE FUNCTION payout_v2_reject_change();
DROP TRIGGER IF EXISTS payout_v2_protected_balance_alert_events_append_only ON payout_v2_protected_balance_alert_events;
CREATE TRIGGER payout_v2_protected_balance_alert_events_append_only
  BEFORE UPDATE OR DELETE ON payout_v2_protected_balance_alert_events
  FOR EACH ROW EXECUTE FUNCTION payout_v2_reject_change();

-- Slice 7: inactive controlled-cutover preparation evidence.
--
-- These tables do not activate v2, schedule work, or call Stripe. They preserve
-- the explicit owner/operator decisions and two-cycle shadow evidence required
-- before a future, separately authorised engine transition.
CREATE TABLE IF NOT EXISTS payout_v2_cutover_config_versions (
  id BIGSERIAL PRIMARY KEY,
  contract_version TEXT NOT NULL CHECK (NULLIF(BTRIM(contract_version), '') IS NOT NULL),
  school_id INTEGER NOT NULL REFERENCES schools(id),
  version_no INTEGER NOT NULL CHECK (version_no > 0),
  payout_route TEXT NOT NULL CHECK (payout_route IN ('instructor_direct', 'school')),
  first_live_instructor_id INTEGER NOT NULL,
  first_live_cap_pence INTEGER NOT NULL CHECK (first_live_cap_pence > 0),
  mutation_operator_id INTEGER NOT NULL,
  mutation_operator_authority_class TEXT NOT NULL
    CHECK (mutation_operator_authority_class IN ('superadmin', 'scoped_operator')),
  operator_allowed_operations JSONB NOT NULL
    CHECK (jsonb_typeof(operator_allowed_operations) = 'array'),
  risk_reserve_config_fingerprint TEXT NOT NULL
    CHECK (risk_reserve_config_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  protected_balance_calculation_fingerprint TEXT NOT NULL
    CHECK (protected_balance_calculation_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  protected_balance_scope_kind TEXT NOT NULL
    CHECK (protected_balance_scope_kind = 'global'),
  route_evidence_reference TEXT NOT NULL
    CHECK (NULLIF(BTRIM(route_evidence_reference), '') IS NOT NULL),
  external_cash_classification TEXT NOT NULL
    CHECK (external_cash_classification = 'complete'),
  external_cash_evidence_reference TEXT NOT NULL
    CHECK (NULLIF(BTRIM(external_cash_evidence_reference), '') IS NOT NULL),
  setmore_classification TEXT NOT NULL
    CHECK (setmore_classification IN ('complete', 'not_applicable')),
  setmore_evidence_reference TEXT NOT NULL
    CHECK (NULLIF(BTRIM(setmore_evidence_reference), '') IS NOT NULL),
  owner_approved_by TEXT NOT NULL CHECK (NULLIF(BTRIM(owner_approved_by), '') IS NOT NULL),
  owner_approved_at TIMESTAMPTZ NOT NULL,
  owner_approval_reference TEXT NOT NULL
    CHECK (NULLIF(BTRIM(owner_approval_reference), '') IS NOT NULL),
  rollback_criteria JSONB NOT NULL CHECK (jsonb_typeof(rollback_criteria) = 'object'),
  config_fingerprint TEXT NOT NULL UNIQUE
    CHECK (config_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, version_no),
  FOREIGN KEY (first_live_instructor_id, school_id)
    REFERENCES instructors(id, school_id)
);
CREATE INDEX IF NOT EXISTS idx_payout_v2_cutover_config_latest
  ON payout_v2_cutover_config_versions(school_id, version_no DESC);

CREATE TABLE IF NOT EXISTS payout_v2_shadow_cycle_evidence (
  id BIGSERIAL PRIMARY KEY,
  contract_version TEXT NOT NULL CHECK (NULLIF(BTRIM(contract_version), '') IS NOT NULL),
  school_id INTEGER NOT NULL REFERENCES schools(id),
  cycle_ordinal INTEGER NOT NULL CHECK (cycle_ordinal IN (1, 2)),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  shadow_statement_fingerprint TEXT NOT NULL
    CHECK (shadow_statement_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  v1_preview_fingerprint TEXT NOT NULL
    CHECK (v1_preview_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  comparison_fingerprint TEXT NOT NULL
    CHECK (comparison_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  unexplained_difference_count INTEGER NOT NULL CHECK (unexplained_difference_count >= 0),
  ambiguous_source_count INTEGER NOT NULL CHECK (ambiguous_source_count >= 0),
  decision TEXT NOT NULL CHECK (decision IN ('accepted', 'rejected')),
  owner_approved_by TEXT NOT NULL CHECK (NULLIF(BTRIM(owner_approved_by), '') IS NOT NULL),
  owner_approved_at TIMESTAMPTZ NOT NULL,
  evidence_reference TEXT NOT NULL CHECK (NULLIF(BTRIM(evidence_reference), '') IS NOT NULL),
  evidence_fingerprint TEXT NOT NULL UNIQUE
    CHECK (evidence_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, cycle_ordinal),
  CHECK (period_start <= period_end),
  CHECK (
    decision <> 'accepted'
    OR (unexplained_difference_count = 0 AND ambiguous_source_count = 0)
  )
);
CREATE INDEX IF NOT EXISTS idx_payout_v2_shadow_cycle_school
  ON payout_v2_shadow_cycle_evidence(school_id, cycle_ordinal);

CREATE TABLE IF NOT EXISTS payout_v2_cutover_readiness_snapshots (
  id BIGSERIAL PRIMARY KEY,
  contract_version TEXT NOT NULL CHECK (NULLIF(BTRIM(contract_version), '') IS NOT NULL),
  school_id INTEGER NOT NULL REFERENCES schools(id),
  config_version_id BIGINT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ready', 'blocked')),
  readiness_fingerprint TEXT NOT NULL UNIQUE
    CHECK (readiness_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  payout_engine_version TEXT NOT NULL CHECK (payout_engine_version IN ('v1', 'v2')),
  protected_balance_calculation_fingerprint TEXT NOT NULL
    CHECK (protected_balance_calculation_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  protected_balance_position_fingerprint TEXT NOT NULL
    CHECK (protected_balance_position_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  shadow_cycle_fingerprints JSONB NOT NULL
    CHECK (jsonb_typeof(shadow_cycle_fingerprints) = 'array'),
  blocker_codes JSONB NOT NULL CHECK (jsonb_typeof(blocker_codes) = 'array'),
  diagnostics_json JSONB NOT NULL CHECK (jsonb_typeof(diagnostics_json) = 'object'),
  evidence_json JSONB NOT NULL CHECK (jsonb_typeof(evidence_json) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  FOREIGN KEY (config_version_id, school_id)
    REFERENCES payout_v2_cutover_config_versions(id, school_id),
  CHECK (status <> 'ready' OR blocker_codes = '[]'::jsonb)
);
CREATE INDEX IF NOT EXISTS idx_payout_v2_cutover_readiness_latest
  ON payout_v2_cutover_readiness_snapshots(school_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS payout_v2_cutover_events (
  id BIGSERIAL PRIMARY KEY,
  contract_version TEXT NOT NULL CHECK (NULLIF(BTRIM(contract_version), '') IS NOT NULL),
  school_id INTEGER NOT NULL REFERENCES schools(id),
  sequence_no INTEGER NOT NULL CHECK (sequence_no > 0),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'capped_batch_dry_run', 'engine_transition', 'post_batch_reconciliation',
    'incident_opened', 'incident_resolved', 'rollback_started', 'rollback_completed'
  )),
  status TEXT NOT NULL CHECK (status IN ('recorded', 'blocked', 'open', 'resolved')),
  event_identity TEXT NOT NULL UNIQUE
    CHECK (NULLIF(BTRIM(event_identity), '') IS NOT NULL),
  config_version_id BIGINT,
  readiness_fingerprint TEXT
    CHECK (readiness_fingerprint IS NULL OR readiness_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  payout_batch_id BIGINT,
  plan_fingerprint TEXT
    CHECK (plan_fingerprint IS NULL OR plan_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  authority_class TEXT NOT NULL
    CHECK (authority_class IN ('cron', 'superadmin', 'scoped_operator')),
  operator_id INTEGER,
  reason TEXT NOT NULL CHECK (NULLIF(BTRIM(reason), '') IS NOT NULL),
  event_fingerprint TEXT NOT NULL UNIQUE
    CHECK (event_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  evidence_json JSONB NOT NULL CHECK (jsonb_typeof(evidence_json) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, sequence_no),
  FOREIGN KEY (config_version_id, school_id)
    REFERENCES payout_v2_cutover_config_versions(id, school_id),
  FOREIGN KEY (payout_batch_id, school_id)
    REFERENCES payout_batches(id, school_id),
  CHECK (
    event_type <> 'engine_transition'
    OR (
      status = 'recorded'
      AND config_version_id IS NOT NULL
      AND readiness_fingerprint IS NOT NULL
      AND operator_id IS NOT NULL
    )
  )
);
CREATE INDEX IF NOT EXISTS idx_payout_v2_cutover_events_school
  ON payout_v2_cutover_events(school_id, sequence_no DESC);
CREATE INDEX IF NOT EXISTS idx_payout_v2_cutover_events_open_incident
  ON payout_v2_cutover_events(school_id, event_type, created_at DESC)
  WHERE status = 'open';

DROP TRIGGER IF EXISTS payout_v2_cutover_config_versions_append_only ON payout_v2_cutover_config_versions;
CREATE TRIGGER payout_v2_cutover_config_versions_append_only
  BEFORE UPDATE OR DELETE ON payout_v2_cutover_config_versions
  FOR EACH ROW EXECUTE FUNCTION payout_v2_reject_change();
DROP TRIGGER IF EXISTS payout_v2_shadow_cycle_evidence_append_only ON payout_v2_shadow_cycle_evidence;
CREATE TRIGGER payout_v2_shadow_cycle_evidence_append_only
  BEFORE UPDATE OR DELETE ON payout_v2_shadow_cycle_evidence
  FOR EACH ROW EXECUTE FUNCTION payout_v2_reject_change();
DROP TRIGGER IF EXISTS payout_v2_cutover_readiness_snapshots_append_only ON payout_v2_cutover_readiness_snapshots;
CREATE TRIGGER payout_v2_cutover_readiness_snapshots_append_only
  BEFORE UPDATE OR DELETE ON payout_v2_cutover_readiness_snapshots
  FOR EACH ROW EXECUTE FUNCTION payout_v2_reject_change();
DROP TRIGGER IF EXISTS payout_v2_cutover_events_append_only ON payout_v2_cutover_events;
CREATE TRIGGER payout_v2_cutover_events_append_only
  BEFORE UPDATE OR DELETE ON payout_v2_cutover_events
  FOR EACH ROW EXECUTE FUNCTION payout_v2_reject_change();
