-- Stripe Connect Simon launch: inert Slice 1 schema foundation.
--
-- DDL only. This migration does not seed launch configuration or agreements,
-- classify historic payments, activate a payout engine, write application
-- evidence, call Stripe, schedule work, or move money. Every tenant key and
-- commercial/Stripe identity is explicit; none has a school/currency/mode
-- default.

CREATE UNIQUE INDEX IF NOT EXISTS uq_refund_events_id_school_launch
  ON refund_events(id, school_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_users_id_school_launch
  ON admin_users(id, school_id);

-- Nullable bridges into the existing evidence and calendar tables. Existing
-- rows remain valid and are not backfilled.
ALTER TABLE payout_funding_sources
  ADD COLUMN IF NOT EXISTS stripe_payment_created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stripe_funds_available_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_origin TEXT,
  ADD COLUMN IF NOT EXISTS source_booking_id INTEGER,
  ADD COLUMN IF NOT EXISTS lesson_payment_contract_id UUID,
  ADD COLUMN IF NOT EXISTS evidence_completeness TEXT,
  ADD COLUMN IF NOT EXISTS contradiction_code TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payout_funding_sources_launch_origin_check'
      AND conrelid = 'payout_funding_sources'::regclass
  ) THEN
    ALTER TABLE payout_funding_sources
      ADD CONSTRAINT payout_funding_sources_launch_origin_check
      CHECK (payment_origin IS NULL OR payment_origin IN (
        'direct_slot', 'test_date_direct', 'one_off_offer', 'captured_request'
      ));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payout_funding_sources_evidence_completeness_check'
      AND conrelid = 'payout_funding_sources'::regclass
  ) THEN
    ALTER TABLE payout_funding_sources
      ADD CONSTRAINT payout_funding_sources_evidence_completeness_check
      CHECK (evidence_completeness IS NULL OR evidence_completeness IN (
        'pending', 'complete', 'contradictory'
      ));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payout_funding_sources_contradiction_check'
      AND conrelid = 'payout_funding_sources'::regclass
  ) THEN
    ALTER TABLE payout_funding_sources
      ADD CONSTRAINT payout_funding_sources_contradiction_check
      CHECK (
        (evidence_completeness = 'contradictory'
          AND NULLIF(BTRIM(contradiction_code), '') IS NOT NULL)
        OR (evidence_completeness IS DISTINCT FROM 'contradictory'
          AND contradiction_code IS NULL)
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payout_funding_sources_source_booking_school_fk'
      AND conrelid = 'payout_funding_sources'::regclass
  ) THEN
    ALTER TABLE payout_funding_sources
      ADD CONSTRAINT payout_funding_sources_source_booking_school_fk
      FOREIGN KEY (source_booking_id, school_id)
      REFERENCES lesson_bookings(id, school_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_payout_funding_sources_launch_booking
  ON payout_funding_sources(school_id, source_booking_id)
  WHERE source_booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payout_funding_sources_launch_evidence
  ON payout_funding_sources(school_id, evidence_completeness, stripe_payment_created_at)
  WHERE evidence_completeness IS NOT NULL;

CREATE TABLE IF NOT EXISTS stripe_connect_launch_configs (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  cutover_at TIMESTAMPTZ NOT NULL,
  accounting_version TEXT NOT NULL,
  mode TEXT NOT NULL,
  created_by_admin_id INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  activated_at TIMESTAMPTZ,
  paused_at TIMESTAMPTZ,
  pause_reason TEXT,
  UNIQUE (id, school_id),
  UNIQUE (school_id),
  FOREIGN KEY (created_by_admin_id, school_id)
    REFERENCES admin_users(id, school_id),
  CHECK (accounting_version = 'simon_launch_v1'),
  CHECK (mode IN ('disabled', 'shadow', 'approval_pending', 'live', 'paused')),
  CHECK (mode NOT IN ('live', 'paused') OR activated_at IS NOT NULL),
  CHECK (
    (mode = 'paused' AND paused_at IS NOT NULL
      AND NULLIF(BTRIM(pause_reason), '') IS NOT NULL)
    OR (mode <> 'paused' AND paused_at IS NULL AND pause_reason IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS stripe_connect_launch_events (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  launch_config_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  mode_before TEXT,
  mode_after TEXT,
  actor_type TEXT NOT NULL,
  actor_admin_id INTEGER,
  reason TEXT NOT NULL,
  evidence_json JSONB NOT NULL,
  idempotency_identity TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  event_fingerprint TEXT NOT NULL,
  UNIQUE (id, school_id),
  UNIQUE (school_id, idempotency_identity),
  UNIQUE (school_id, event_fingerprint),
  FOREIGN KEY (launch_config_id, school_id)
    REFERENCES stripe_connect_launch_configs(id, school_id),
  FOREIGN KEY (actor_admin_id, school_id)
    REFERENCES admin_users(id, school_id),
  CHECK (event_type IN (
    'mode_changed', 'first_run_approved', 'paused', 'resumed',
    'legacy_engine_disabled'
  )),
  CHECK (mode_before IS NULL OR mode_before IN (
    'disabled', 'shadow', 'approval_pending', 'live', 'paused'
  )),
  CHECK (mode_after IS NULL OR mode_after IN (
    'disabled', 'shadow', 'approval_pending', 'live', 'paused'
  )),
  CHECK (actor_type IN ('system', 'admin')),
  CHECK ((actor_type = 'admin' AND actor_admin_id IS NOT NULL)
      OR (actor_type = 'system' AND actor_admin_id IS NULL)),
  CHECK (NULLIF(BTRIM(reason), '') IS NOT NULL),
  CHECK (jsonb_typeof(evidence_json) = 'object'),
  CHECK (event_fingerprint ~ '^sha256:[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_stripe_launch_events_config
  ON stripe_connect_launch_events(school_id, launch_config_id, occurred_at);

CREATE TABLE IF NOT EXISTS instructor_payout_agreement_versions (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  instructor_id INTEGER NOT NULL,
  version_number INTEGER NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  status TEXT NOT NULL,
  split_bps INTEGER NOT NULL,
  weekly_franchise_fee_minor BIGINT NOT NULL,
  currency TEXT NOT NULL,
  accepted_at TIMESTAMPTZ,
  acceptance_evidence_reference TEXT,
  document_version TEXT NOT NULL,
  connect_scope_id BIGINT,
  stripe_configuration_id TEXT,
  created_by_admin_id INTEGER NOT NULL,
  approved_by_admin_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL,
  approved_at TIMESTAMPTZ,
  agreement_fingerprint TEXT NOT NULL,
  UNIQUE (id, school_id),
  UNIQUE (school_id, instructor_id, version_number),
  UNIQUE (school_id, agreement_fingerprint),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  FOREIGN KEY (connect_scope_id, school_id)
    REFERENCES payout_v2_connected_account_scopes(id, school_id),
  FOREIGN KEY (created_by_admin_id, school_id)
    REFERENCES admin_users(id, school_id),
  FOREIGN KEY (approved_by_admin_id, school_id)
    REFERENCES admin_users(id, school_id),
  CHECK (version_number > 0),
  CHECK (ends_at IS NULL OR ends_at > starts_at),
  CHECK (status IN ('draft', 'active', 'paused', 'ended')),
  CHECK (split_bps BETWEEN 0 AND 10000),
  CHECK (weekly_franchise_fee_minor >= 0),
  CHECK (currency = LOWER(currency) AND char_length(currency) = 3),
  CHECK (NULLIF(BTRIM(document_version), '') IS NOT NULL),
  CHECK (agreement_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (
    status = 'draft'
    OR (
      accepted_at IS NOT NULL
      AND NULLIF(BTRIM(acceptance_evidence_reference), '') IS NOT NULL
      AND approved_by_admin_id IS NOT NULL
      AND approved_at IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_payout_agreements_instructor_effective
  ON instructor_payout_agreement_versions(school_id, instructor_id, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_payout_agreements_connect_scope
  ON instructor_payout_agreement_versions(school_id, connect_scope_id)
  WHERE connect_scope_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS lesson_payment_contracts (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  learner_id INTEGER NOT NULL,
  instructor_id INTEGER NOT NULL,
  funding_source_id BIGINT NOT NULL,
  origin TEXT NOT NULL,
  regime TEXT NOT NULL,
  stripe_payment_created_at TIMESTAMPTZ NOT NULL,
  gross_amount_minor BIGINT NOT NULL,
  stripe_fee_minor BIGINT,
  currency TEXT NOT NULL,
  split_bps INTEGER,
  agreement_version_id UUID,
  stripe_payment_intent_id TEXT NOT NULL,
  stripe_charge_id TEXT NOT NULL,
  stripe_balance_transaction_id TEXT,
  stripe_funds_available_at TIMESTAMPTZ,
  evidence_status TEXT NOT NULL,
  ineligibility_code TEXT,
  contradiction_code TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  fingerprint TEXT NOT NULL,
  UNIQUE (id, school_id),
  UNIQUE (school_id, funding_source_id),
  UNIQUE (school_id, stripe_payment_intent_id),
  UNIQUE (school_id, stripe_charge_id),
  UNIQUE (school_id, fingerprint),
  FOREIGN KEY (learner_id, school_id)
    REFERENCES learner_users(id, school_id),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  FOREIGN KEY (funding_source_id, school_id)
    REFERENCES payout_funding_sources(id, school_id),
  FOREIGN KEY (agreement_version_id, school_id)
    REFERENCES instructor_payout_agreement_versions(id, school_id),
  CHECK (origin IN (
    'direct_slot', 'test_date_direct', 'one_off_offer', 'captured_request'
  )),
  CHECK (regime IN ('legacy', 'launch')),
  CHECK (gross_amount_minor > 0),
  CHECK (stripe_fee_minor IS NULL OR (
    stripe_fee_minor >= 0 AND stripe_fee_minor <= gross_amount_minor
  )),
  CHECK (currency = LOWER(currency) AND char_length(currency) = 3),
  CHECK (split_bps IS NULL OR split_bps BETWEEN 0 AND 10000),
  CHECK (NULLIF(BTRIM(stripe_payment_intent_id), '') IS NOT NULL),
  CHECK (NULLIF(BTRIM(stripe_charge_id), '') IS NOT NULL),
  CHECK (evidence_status IN ('pending', 'complete', 'contradictory', 'ineligible')),
  CHECK (fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (
    evidence_status <> 'complete'
    OR (
      stripe_fee_minor IS NOT NULL
      AND stripe_balance_transaction_id IS NOT NULL
      AND stripe_funds_available_at IS NOT NULL
      AND agreement_version_id IS NOT NULL
      AND split_bps IS NOT NULL
      AND completed_at IS NOT NULL
      AND ineligibility_code IS NULL
      AND contradiction_code IS NULL
    )
  ),
  CHECK (
    (evidence_status = 'ineligible'
      AND NULLIF(BTRIM(ineligibility_code), '') IS NOT NULL)
    OR (evidence_status <> 'ineligible' AND ineligibility_code IS NULL)
  ),
  CHECK (
    (evidence_status = 'contradictory'
      AND NULLIF(BTRIM(contradiction_code), '') IS NOT NULL)
    OR (evidence_status <> 'contradictory' AND contradiction_code IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_lesson_payment_contracts_pi_global
  ON lesson_payment_contracts(stripe_payment_intent_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_lesson_payment_contracts_charge_global
  ON lesson_payment_contracts(stripe_charge_id);
CREATE INDEX IF NOT EXISTS idx_lesson_payment_contracts_instructor_created
  ON lesson_payment_contracts(school_id, instructor_id, stripe_payment_created_at);
CREATE INDEX IF NOT EXISTS idx_lesson_payment_contracts_learner
  ON lesson_payment_contracts(school_id, learner_id);
CREATE INDEX IF NOT EXISTS idx_lesson_payment_contracts_agreement
  ON lesson_payment_contracts(school_id, agreement_version_id)
  WHERE agreement_version_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payout_funding_sources_contract_school_fk'
      AND conrelid = 'payout_funding_sources'::regclass
  ) THEN
    ALTER TABLE payout_funding_sources
      ADD CONSTRAINT payout_funding_sources_contract_school_fk
      FOREIGN KEY (lesson_payment_contract_id, school_id)
      REFERENCES lesson_payment_contracts(id, school_id);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_funding_sources_launch_contract
  ON payout_funding_sources(school_id, lesson_payment_contract_id)
  WHERE lesson_payment_contract_id IS NOT NULL;

ALTER TABLE lesson_bookings
  ADD COLUMN IF NOT EXISTS lesson_payment_contract_id UUID,
  ADD COLUMN IF NOT EXISTS slot_released_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS slot_release_reason TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'lesson_bookings_launch_contract_school_fk'
      AND conrelid = 'lesson_bookings'::regclass
  ) THEN
    ALTER TABLE lesson_bookings
      ADD CONSTRAINT lesson_bookings_launch_contract_school_fk
      FOREIGN KEY (lesson_payment_contract_id, school_id)
      REFERENCES lesson_payment_contracts(id, school_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'lesson_bookings_slot_release_check'
      AND conrelid = 'lesson_bookings'::regclass
  ) THEN
    ALTER TABLE lesson_bookings
      ADD CONSTRAINT lesson_bookings_slot_release_check
      CHECK (
        (slot_released_at IS NULL AND slot_release_reason IS NULL)
        OR (slot_released_at IS NOT NULL
          AND NULLIF(BTRIM(slot_release_reason), '') IS NOT NULL)
      );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_lesson_bookings_active_launch_contract
  ON lesson_bookings(school_id, lesson_payment_contract_id)
  WHERE lesson_payment_contract_id IS NOT NULL
    AND status IN ('scheduled', 'chargeable');
CREATE INDEX IF NOT EXISTS idx_lesson_bookings_launch_contract
  ON lesson_bookings(school_id, lesson_payment_contract_id)
  WHERE lesson_payment_contract_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS lesson_outcome_revisions (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  booking_id INTEGER NOT NULL,
  lesson_payment_contract_id UUID,
  instructor_id INTEGER NOT NULL,
  revision_number INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  supersedes_revision_id UUID,
  replacement_booking_id INTEGER,
  actor_type TEXT NOT NULL,
  actor_instructor_id INTEGER NOT NULL,
  actor_admin_id INTEGER,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  idempotency_key TEXT NOT NULL,
  reason_code TEXT,
  outcome_fingerprint TEXT NOT NULL,
  UNIQUE (id, school_id),
  UNIQUE (school_id, booking_id, revision_number),
  UNIQUE (school_id, idempotency_key),
  UNIQUE (school_id, outcome_fingerprint),
  FOREIGN KEY (booking_id, school_id)
    REFERENCES lesson_bookings(id, school_id),
  FOREIGN KEY (lesson_payment_contract_id, school_id)
    REFERENCES lesson_payment_contracts(id, school_id),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  FOREIGN KEY (supersedes_revision_id, school_id)
    REFERENCES lesson_outcome_revisions(id, school_id),
  FOREIGN KEY (replacement_booking_id, school_id)
    REFERENCES lesson_bookings(id, school_id),
  FOREIGN KEY (actor_instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  FOREIGN KEY (actor_admin_id, school_id)
    REFERENCES admin_users(id, school_id),
  CHECK (revision_number > 0),
  CHECK (outcome IN (
    'delivered', 'late_learner_cancel_or_no_show',
    'instructor_non_delivery', 'rescheduled'
  )),
  CHECK ((revision_number = 1 AND supersedes_revision_id IS NULL)
      OR (revision_number > 1 AND supersedes_revision_id IS NOT NULL)),
  CHECK ((outcome = 'rescheduled' AND replacement_booking_id IS NOT NULL)
      OR (outcome <> 'rescheduled' AND replacement_booking_id IS NULL)),
  CHECK (actor_type IN ('instructor', 'admin_impersonating_instructor')),
  CHECK ((actor_type = 'instructor' AND actor_admin_id IS NULL)
      OR (actor_type = 'admin_impersonating_instructor' AND actor_admin_id IS NOT NULL)),
  CHECK (outcome_fingerprint ~ '^sha256:[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_lesson_outcome_contract
  ON lesson_outcome_revisions(school_id, lesson_payment_contract_id, revision_number)
  WHERE lesson_payment_contract_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lesson_outcome_instructor
  ON lesson_outcome_revisions(school_id, instructor_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_lesson_outcome_supersedes
  ON lesson_outcome_revisions(school_id, supersedes_revision_id)
  WHERE supersedes_revision_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lesson_outcome_replacement
  ON lesson_outcome_revisions(school_id, replacement_booking_id)
  WHERE replacement_booking_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS lesson_issue_tokens (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  booking_id INTEGER NOT NULL,
  learner_id INTEGER,
  token_digest TEXT NOT NULL,
  nonce TEXT NOT NULL,
  purpose TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  UNIQUE (id, school_id),
  UNIQUE (token_digest),
  UNIQUE (school_id, nonce),
  FOREIGN KEY (booking_id, school_id)
    REFERENCES lesson_bookings(id, school_id),
  FOREIGN KEY (learner_id, school_id)
    REFERENCES learner_users(id, school_id) ON DELETE SET NULL (learner_id),
  CHECK (token_digest ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (purpose = 'lesson_issue_report'),
  CHECK (expires_at > created_at),
  CHECK (consumed_at IS NULL OR revoked_at IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_lesson_issue_tokens_booking
  ON lesson_issue_tokens(school_id, booking_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_lesson_issue_tokens_learner
  ON lesson_issue_tokens(school_id, learner_id)
  WHERE learner_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS lesson_issue_reports (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  booking_id INTEGER NOT NULL,
  learner_id INTEGER,
  token_id UUID NOT NULL,
  category TEXT NOT NULL,
  learner_text TEXT,
  reported_at TIMESTAMPTZ NOT NULL,
  cutoff_classification TEXT NOT NULL,
  applicable_run_id UUID,
  acknowledgement_delivery_state TEXT NOT NULL,
  idempotency_fingerprint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (id, school_id),
  UNIQUE (school_id, token_id),
  UNIQUE (school_id, idempotency_fingerprint),
  FOREIGN KEY (booking_id, school_id)
    REFERENCES lesson_bookings(id, school_id),
  FOREIGN KEY (learner_id, school_id)
    REFERENCES learner_users(id, school_id) ON DELETE SET NULL (learner_id),
  FOREIGN KEY (token_id, school_id)
    REFERENCES lesson_issue_tokens(id, school_id),
  CHECK (category IN (
    'lesson_not_delivered', 'lesson_details_incorrect', 'cancellation_disputed',
    'reschedule_disputed', 'other'
  )),
  CHECK (cutoff_classification IN (
    'before_lock', 'after_lock', 'no_applicable_run'
  )),
  CHECK ((cutoff_classification = 'no_applicable_run' AND applicable_run_id IS NULL)
      OR (cutoff_classification <> 'no_applicable_run' AND applicable_run_id IS NOT NULL)),
  CHECK (acknowledgement_delivery_state IN (
    'pending', 'sent', 'failed', 'not_required'
  )),
  CHECK (idempotency_fingerprint ~ '^sha256:[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_lesson_issue_reports_booking
  ON lesson_issue_reports(school_id, booking_id, reported_at);
CREATE INDEX IF NOT EXISTS idx_lesson_issue_reports_run
  ON lesson_issue_reports(school_id, applicable_run_id)
  WHERE applicable_run_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS lesson_issue_actions (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  issue_report_id UUID NOT NULL,
  action_type TEXT NOT NULL,
  actor_admin_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  evidence_reference TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  idempotency_identity TEXT NOT NULL,
  action_fingerprint TEXT NOT NULL,
  UNIQUE (id, school_id),
  UNIQUE (school_id, idempotency_identity),
  UNIQUE (school_id, action_fingerprint),
  FOREIGN KEY (issue_report_id, school_id)
    REFERENCES lesson_issue_reports(id, school_id),
  FOREIGN KEY (actor_admin_id, school_id)
    REFERENCES admin_users(id, school_id),
  CHECK (action_type IN (
    'review_started', 'information_requested', 'resolved_upheld',
    'resolved_not_upheld', 'financial_correction_referred'
  )),
  CHECK (NULLIF(BTRIM(reason), '') IS NOT NULL),
  CHECK (action_fingerprint ~ '^sha256:[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_lesson_issue_actions_report
  ON lesson_issue_actions(school_id, issue_report_id, occurred_at);

CREATE TABLE IF NOT EXISTS refund_intents (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  learner_id INTEGER NOT NULL,
  instructor_id INTEGER NOT NULL,
  booking_id INTEGER NOT NULL,
  payment_contract_id UUID NOT NULL,
  funding_source_id BIGINT NOT NULL,
  refund_policy TEXT NOT NULL,
  gross_amount_minor BIGINT NOT NULL,
  stripe_fee_minor BIGINT NOT NULL,
  fee_absorbed_by_platform_minor BIGINT NOT NULL,
  refund_amount_minor BIGINT NOT NULL,
  currency TEXT NOT NULL,
  stripe_payment_intent_id TEXT NOT NULL,
  stripe_charge_id TEXT NOT NULL,
  stripe_refund_id TEXT,
  stable_identity TEXT NOT NULL,
  stripe_idempotency_key TEXT NOT NULL,
  state TEXT NOT NULL,
  cancellation_committed_at TIMESTAMPTZ NOT NULL,
  source_batch_id UUID,
  source_earning_id UUID,
  refund_event_id INTEGER,
  actor_type TEXT NOT NULL,
  actor_admin_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  last_error_class TEXT,
  last_error_code TEXT,
  intent_fingerprint TEXT NOT NULL,
  UNIQUE (id, school_id),
  UNIQUE (school_id, stable_identity),
  UNIQUE (stripe_idempotency_key),
  UNIQUE (school_id, payment_contract_id, refund_policy),
  UNIQUE (school_id, intent_fingerprint),
  FOREIGN KEY (learner_id, school_id)
    REFERENCES learner_users(id, school_id),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  FOREIGN KEY (booking_id, school_id)
    REFERENCES lesson_bookings(id, school_id),
  FOREIGN KEY (payment_contract_id, school_id)
    REFERENCES lesson_payment_contracts(id, school_id),
  FOREIGN KEY (funding_source_id, school_id)
    REFERENCES payout_funding_sources(id, school_id),
  FOREIGN KEY (refund_event_id, school_id)
    REFERENCES refund_events(id, school_id),
  FOREIGN KEY (actor_admin_id, school_id)
    REFERENCES admin_users(id, school_id),
  CHECK (refund_policy IN (
    'learner_early', 'instructor_non_delivery', 'dispute_or_operator_correction'
  )),
  CHECK (gross_amount_minor > 0),
  CHECK (stripe_fee_minor BETWEEN 0 AND gross_amount_minor),
  CHECK (fee_absorbed_by_platform_minor BETWEEN 0 AND stripe_fee_minor),
  CHECK (refund_amount_minor BETWEEN 0 AND gross_amount_minor),
  CHECK (currency = LOWER(currency) AND char_length(currency) = 3),
  CHECK (state IN (
    'planned', 'submitting', 'reconciling', 'succeeded',
    'failed_confirmed', 'manual_review'
  )),
  CHECK (actor_type IN ('system', 'learner', 'instructor', 'admin')),
  CHECK ((actor_type = 'admin' AND actor_admin_id IS NOT NULL)
      OR (actor_type <> 'admin' AND actor_admin_id IS NULL)),
  CHECK (intent_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (
    refund_policy <> 'learner_early'
    OR (
      refund_amount_minor = gross_amount_minor - stripe_fee_minor
      AND fee_absorbed_by_platform_minor = 0
    )
  ),
  CHECK (
    refund_policy <> 'instructor_non_delivery'
    OR (
      refund_amount_minor = gross_amount_minor
      AND fee_absorbed_by_platform_minor = stripe_fee_minor
    )
  ),
  CHECK (state <> 'succeeded' OR (
    stripe_refund_id IS NOT NULL AND refund_event_id IS NOT NULL
  ))
);

CREATE INDEX IF NOT EXISTS idx_refund_intents_booking
  ON refund_intents(school_id, booking_id, state);
CREATE INDEX IF NOT EXISTS idx_refund_intents_contract
  ON refund_intents(school_id, payment_contract_id, state);
CREATE UNIQUE INDEX IF NOT EXISTS uq_refund_intents_stripe_refund
  ON refund_intents(stripe_refund_id)
  WHERE stripe_refund_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS refund_attempts (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  refund_intent_id UUID NOT NULL,
  attempt_number INTEGER NOT NULL,
  request_fingerprint TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  stripe_request_id TEXT,
  response_classification TEXT NOT NULL,
  sanitized_error_code TEXT,
  observed_stripe_refund_id TEXT,
  observed_refund_status TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (id, school_id),
  UNIQUE (school_id, refund_intent_id, attempt_number),
  UNIQUE (school_id, request_fingerprint),
  FOREIGN KEY (refund_intent_id, school_id)
    REFERENCES refund_intents(id, school_id),
  CHECK (attempt_number > 0),
  CHECK (request_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (response_classification IN (
    'success', 'definite_failure', 'ambiguous'
  )),
  CHECK (completed_at IS NULL OR completed_at >= started_at)
);

CREATE INDEX IF NOT EXISTS idx_refund_attempts_intent
  ON refund_attempts(school_id, refund_intent_id, attempt_number);

CREATE TABLE IF NOT EXISTS connect_account_state_events (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  instructor_id INTEGER NOT NULL,
  connect_scope_id BIGINT NOT NULL,
  stripe_account_id TEXT NOT NULL,
  stripe_event_id TEXT,
  event_type TEXT NOT NULL,
  event_context TEXT NOT NULL,
  requirements_summary JSONB NOT NULL,
  transfers_capability_status TEXT NOT NULL,
  dashboard_type TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  payload_fingerprint TEXT NOT NULL,
  evidence_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (id, school_id),
  UNIQUE (school_id, payload_fingerprint),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  FOREIGN KEY (connect_scope_id, school_id)
    REFERENCES payout_v2_connected_account_scopes(id, school_id),
  CHECK (stripe_account_id LIKE 'acct\_%' ESCAPE '\'),
  CHECK (NULLIF(BTRIM(event_type), '') IS NOT NULL),
  CHECK (NULLIF(BTRIM(event_context), '') IS NOT NULL),
  CHECK (jsonb_typeof(requirements_summary) = 'object'),
  CHECK (transfers_capability_status IN (
    'inactive', 'pending', 'active', 'restricted', 'unknown'
  )),
  CHECK (dashboard_type IN ('express', 'full', 'none', 'unknown')),
  CHECK (payload_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (jsonb_typeof(evidence_json) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_connect_state_events_stripe_event
  ON connect_account_state_events(stripe_event_id)
  WHERE stripe_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_connect_state_events_latest
  ON connect_account_state_events(school_id, instructor_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_connect_state_events_scope
  ON connect_account_state_events(school_id, connect_scope_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS payout_runs (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  accounting_version TEXT NOT NULL,
  scheduled_occurrence_id UUID,
  lock_at TIMESTAMPTZ NOT NULL,
  transfer_at TIMESTAMPTZ NOT NULL,
  service_window_start TIMESTAMPTZ NOT NULL,
  service_window_end TIMESTAMPTZ NOT NULL,
  state TEXT NOT NULL,
  first_live BOOLEAN NOT NULL,
  approval_admin_id INTEGER,
  approved_at TIMESTAMPTZ,
  approval_evidence_reference TEXT,
  planner_version TEXT NOT NULL,
  planner_fingerprint TEXT NOT NULL,
  gross_minor BIGINT NOT NULL,
  stripe_fee_minor BIGINT NOT NULL,
  net_minor BIGINT NOT NULL,
  instructor_share_minor BIGINT NOT NULL,
  platform_share_minor BIGINT NOT NULL,
  obligation_applied_minor BIGINT NOT NULL,
  transfer_minor BIGINT NOT NULL,
  held_minor BIGINT NOT NULL,
  currency TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  locked_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  reconciled_at TIMESTAMPTZ,
  last_error_code TEXT,
  UNIQUE (id, school_id),
  UNIQUE (school_id, accounting_version, lock_at),
  UNIQUE (school_id, planner_fingerprint),
  FOREIGN KEY (approval_admin_id, school_id)
    REFERENCES admin_users(id, school_id),
  CHECK (accounting_version = 'simon_launch_v1'),
  CHECK (transfer_at > lock_at),
  CHECK (service_window_end > service_window_start),
  CHECK (state IN (
    'planned', 'shadowed', 'approval_pending', 'locked', 'transferring',
    'transferred', 'reconciling', 'failed_confirmed', 'paused'
  )),
  CHECK (planner_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (gross_minor >= 0 AND stripe_fee_minor >= 0 AND net_minor >= 0),
  CHECK (instructor_share_minor >= 0 AND platform_share_minor >= 0),
  CHECK (obligation_applied_minor >= 0 AND transfer_minor >= 0 AND held_minor >= 0),
  CHECK (gross_minor = stripe_fee_minor + net_minor),
  CHECK (net_minor = instructor_share_minor + platform_share_minor),
  CHECK (instructor_share_minor = obligation_applied_minor + transfer_minor + held_minor),
  CHECK (currency = LOWER(currency) AND char_length(currency) = 3),
  CHECK (
    NOT first_live
    OR state IN ('planned', 'shadowed', 'approval_pending', 'paused')
    OR (approval_admin_id IS NOT NULL AND approved_at IS NOT NULL
      AND NULLIF(BTRIM(approval_evidence_reference), '') IS NOT NULL)
  ),
  CHECK (state NOT IN (
    'locked', 'transferring', 'transferred', 'reconciling', 'failed_confirmed'
  ) OR locked_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_payout_runs_state
  ON payout_runs(school_id, state, lock_at);

CREATE TABLE IF NOT EXISTS instructor_payout_batches (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  payout_run_id UUID NOT NULL,
  instructor_id INTEGER NOT NULL,
  agreement_version_id UUID NOT NULL,
  connect_scope_id BIGINT,
  currency TEXT NOT NULL,
  gross_minor BIGINT NOT NULL,
  stripe_fee_minor BIGINT NOT NULL,
  net_minor BIGINT NOT NULL,
  instructor_share_minor BIGINT NOT NULL,
  platform_share_minor BIGINT NOT NULL,
  opening_obligation_minor BIGINT NOT NULL,
  new_obligation_minor BIGINT NOT NULL,
  applied_obligation_minor BIGINT NOT NULL,
  closing_obligation_minor BIGINT NOT NULL,
  transfer_planned_minor BIGINT NOT NULL,
  transfer_submitted_minor BIGINT NOT NULL,
  held_minor BIGINT NOT NULL,
  state TEXT NOT NULL,
  batch_fingerprint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  locked_at TIMESTAMPTZ NOT NULL,
  submitted_at TIMESTAMPTZ,
  reconciled_at TIMESTAMPTZ,
  last_error_code TEXT,
  UNIQUE (id, school_id),
  UNIQUE (school_id, payout_run_id, instructor_id),
  UNIQUE (school_id, batch_fingerprint),
  FOREIGN KEY (payout_run_id, school_id)
    REFERENCES payout_runs(id, school_id),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  FOREIGN KEY (agreement_version_id, school_id)
    REFERENCES instructor_payout_agreement_versions(id, school_id),
  FOREIGN KEY (connect_scope_id, school_id)
    REFERENCES payout_v2_connected_account_scopes(id, school_id),
  CHECK (currency = LOWER(currency) AND char_length(currency) = 3),
  CHECK (gross_minor >= 0 AND stripe_fee_minor >= 0 AND net_minor >= 0),
  CHECK (instructor_share_minor >= 0 AND platform_share_minor >= 0),
  CHECK (opening_obligation_minor >= 0 AND new_obligation_minor >= 0),
  CHECK (applied_obligation_minor >= 0 AND closing_obligation_minor >= 0),
  CHECK (transfer_planned_minor >= 0 AND transfer_submitted_minor >= 0),
  CHECK (held_minor >= 0),
  CHECK (gross_minor = stripe_fee_minor + net_minor),
  CHECK (net_minor = instructor_share_minor + platform_share_minor),
  CHECK (opening_obligation_minor + new_obligation_minor
    = applied_obligation_minor + closing_obligation_minor),
  CHECK (instructor_share_minor
    = applied_obligation_minor + transfer_planned_minor + held_minor),
  CHECK (transfer_submitted_minor <= transfer_planned_minor),
  CHECK (state IN (
    'locked', 'transfer_pending', 'held_connect_not_ready', 'transferring',
    'transferred', 'reconciling', 'failed_confirmed', 'zero_value'
  )),
  CHECK (batch_fingerprint ~ '^sha256:[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_instructor_payout_batches_instructor
  ON instructor_payout_batches(school_id, instructor_id, locked_at DESC);
CREATE INDEX IF NOT EXISTS idx_instructor_payout_batches_run
  ON instructor_payout_batches(school_id, payout_run_id, state);

CREATE TABLE IF NOT EXISTS instructor_payout_obligations (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  instructor_id INTEGER NOT NULL,
  agreement_version_id UUID NOT NULL,
  obligation_type TEXT NOT NULL,
  type_rank INTEGER NOT NULL,
  incurred_at TIMESTAMPTZ NOT NULL,
  original_amount_minor BIGINT NOT NULL,
  currency TEXT NOT NULL,
  source_payout_run_id UUID,
  source_dispute_id UUID,
  source_payment_contract_id UUID,
  idempotency_identity TEXT NOT NULL,
  evidence_fingerprint TEXT NOT NULL,
  created_actor_type TEXT NOT NULL,
  created_admin_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (id, school_id),
  UNIQUE (school_id, idempotency_identity),
  UNIQUE (school_id, evidence_fingerprint),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  FOREIGN KEY (agreement_version_id, school_id)
    REFERENCES instructor_payout_agreement_versions(id, school_id),
  FOREIGN KEY (source_payout_run_id, school_id)
    REFERENCES payout_runs(id, school_id),
  FOREIGN KEY (source_payment_contract_id, school_id)
    REFERENCES lesson_payment_contracts(id, school_id),
  FOREIGN KEY (created_admin_id, school_id)
    REFERENCES admin_users(id, school_id),
  CHECK (obligation_type IN ('weekly_franchise_fee', 'final_dispute_loss')),
  CHECK ((obligation_type = 'final_dispute_loss' AND type_rank = 1)
      OR (obligation_type = 'weekly_franchise_fee' AND type_rank = 2)),
  CHECK (original_amount_minor > 0),
  CHECK (currency = LOWER(currency) AND char_length(currency) = 3),
  CHECK ((obligation_type = 'weekly_franchise_fee'
      AND source_payout_run_id IS NOT NULL
      AND source_dispute_id IS NULL
      AND source_payment_contract_id IS NULL)
    OR (obligation_type = 'final_dispute_loss'
      AND source_payout_run_id IS NULL
      AND source_dispute_id IS NOT NULL
      AND source_payment_contract_id IS NOT NULL)),
  CHECK (evidence_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (created_actor_type IN ('system', 'admin')),
  CHECK ((created_actor_type = 'admin' AND created_admin_id IS NOT NULL)
      OR (created_actor_type = 'system' AND created_admin_id IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_instructor_obligation_weekly_source
  ON instructor_payout_obligations(school_id, instructor_id, source_payout_run_id)
  WHERE obligation_type = 'weekly_franchise_fee';
CREATE UNIQUE INDEX IF NOT EXISTS uq_instructor_obligation_dispute_source
  ON instructor_payout_obligations(school_id, source_dispute_id)
  WHERE obligation_type = 'final_dispute_loss';
CREATE INDEX IF NOT EXISTS idx_instructor_obligations_order
  ON instructor_payout_obligations(school_id, instructor_id, incurred_at, type_rank, id);

CREATE TABLE IF NOT EXISTS instructor_payout_obligation_applications (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  obligation_id UUID NOT NULL,
  instructor_id INTEGER NOT NULL,
  application_type TEXT NOT NULL,
  amount_minor BIGINT NOT NULL,
  source_batch_id UUID,
  source_payment_contract_id UUID,
  reverses_application_id UUID,
  external_reference TEXT,
  actor_type TEXT NOT NULL,
  actor_admin_id INTEGER,
  reason TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  idempotency_identity TEXT NOT NULL,
  application_fingerprint TEXT NOT NULL,
  UNIQUE (id, school_id),
  UNIQUE (school_id, idempotency_identity),
  UNIQUE (school_id, application_fingerprint),
  FOREIGN KEY (obligation_id, school_id)
    REFERENCES instructor_payout_obligations(id, school_id),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  FOREIGN KEY (source_batch_id, school_id)
    REFERENCES instructor_payout_batches(id, school_id),
  FOREIGN KEY (source_payment_contract_id, school_id)
    REFERENCES lesson_payment_contracts(id, school_id),
  FOREIGN KEY (reverses_application_id, school_id)
    REFERENCES instructor_payout_obligation_applications(id, school_id),
  FOREIGN KEY (actor_admin_id, school_id)
    REFERENCES admin_users(id, school_id),
  CHECK (application_type IN (
    'batch_earnings', 'manual_repayment', 'manual_clearance',
    'write_off', 'reversal'
  )),
  CHECK (amount_minor > 0),
  CHECK ((application_type = 'batch_earnings' AND source_batch_id IS NOT NULL)
      OR application_type <> 'batch_earnings'),
  CHECK ((application_type = 'reversal' AND reverses_application_id IS NOT NULL)
      OR (application_type <> 'reversal' AND reverses_application_id IS NULL)),
  CHECK (actor_type IN ('system', 'admin')),
  CHECK ((actor_type = 'admin' AND actor_admin_id IS NOT NULL)
      OR (actor_type = 'system' AND actor_admin_id IS NULL)),
  CHECK (NULLIF(BTRIM(reason), '') IS NOT NULL),
  CHECK (application_fingerprint ~ '^sha256:[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_obligation_applications_obligation
  ON instructor_payout_obligation_applications(school_id, obligation_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_obligation_applications_batch
  ON instructor_payout_obligation_applications(school_id, source_batch_id)
  WHERE source_batch_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS stripe_launch_booking_earnings (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  payout_run_id UUID NOT NULL,
  payout_batch_id UUID NOT NULL,
  payment_contract_id UUID NOT NULL,
  outcome_revision_id UUID NOT NULL,
  instructor_id INTEGER NOT NULL,
  service_date DATE NOT NULL,
  gross_minor BIGINT NOT NULL,
  stripe_fee_minor BIGINT NOT NULL,
  net_minor BIGINT NOT NULL,
  split_bps INTEGER NOT NULL,
  instructor_share_minor BIGINT NOT NULL,
  platform_share_minor BIGINT NOT NULL,
  currency TEXT NOT NULL,
  accounting_version TEXT NOT NULL,
  earning_fingerprint TEXT NOT NULL,
  locked_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (id, school_id),
  UNIQUE (school_id, payment_contract_id),
  UNIQUE (school_id, outcome_revision_id),
  UNIQUE (school_id, earning_fingerprint),
  FOREIGN KEY (payout_run_id, school_id)
    REFERENCES payout_runs(id, school_id),
  FOREIGN KEY (payout_batch_id, school_id)
    REFERENCES instructor_payout_batches(id, school_id),
  FOREIGN KEY (payment_contract_id, school_id)
    REFERENCES lesson_payment_contracts(id, school_id),
  FOREIGN KEY (outcome_revision_id, school_id)
    REFERENCES lesson_outcome_revisions(id, school_id),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  CHECK (gross_minor > 0),
  CHECK (stripe_fee_minor BETWEEN 0 AND gross_minor),
  CHECK (net_minor >= 0),
  CHECK (split_bps BETWEEN 0 AND 10000),
  CHECK (instructor_share_minor >= 0 AND platform_share_minor >= 0),
  CHECK (gross_minor = stripe_fee_minor + net_minor),
  CHECK (net_minor = instructor_share_minor + platform_share_minor),
  CHECK (currency = LOWER(currency) AND char_length(currency) = 3),
  CHECK (accounting_version = 'simon_launch_v1'),
  CHECK (earning_fingerprint ~ '^sha256:[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_stripe_launch_earnings_batch
  ON stripe_launch_booking_earnings(school_id, payout_batch_id, service_date);
CREATE INDEX IF NOT EXISTS idx_stripe_launch_earnings_instructor
  ON stripe_launch_booking_earnings(school_id, instructor_id, locked_at);

CREATE TABLE IF NOT EXISTS stripe_launch_transfer_intents (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  payout_batch_id UUID NOT NULL,
  instructor_id INTEGER NOT NULL,
  connect_scope_id BIGINT NOT NULL,
  source_payment_contract_id UUID NOT NULL,
  stripe_source_charge_id TEXT NOT NULL,
  stripe_destination_account_id TEXT NOT NULL,
  amount_minor BIGINT NOT NULL,
  currency TEXT NOT NULL,
  stable_identity TEXT NOT NULL,
  stripe_idempotency_key TEXT NOT NULL,
  plan_fingerprint TEXT NOT NULL,
  state TEXT NOT NULL,
  stripe_transfer_id TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  submitted_at TIMESTAMPTZ,
  reconciled_at TIMESTAMPTZ,
  last_error_code TEXT,
  UNIQUE (id, school_id),
  UNIQUE (school_id, stable_identity),
  UNIQUE (stripe_idempotency_key),
  UNIQUE (school_id, plan_fingerprint),
  FOREIGN KEY (payout_batch_id, school_id)
    REFERENCES instructor_payout_batches(id, school_id),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  FOREIGN KEY (connect_scope_id, school_id)
    REFERENCES payout_v2_connected_account_scopes(id, school_id),
  FOREIGN KEY (source_payment_contract_id, school_id)
    REFERENCES lesson_payment_contracts(id, school_id),
  CHECK (stripe_source_charge_id LIKE 'ch\_%' ESCAPE '\'),
  CHECK (stripe_destination_account_id LIKE 'acct\_%' ESCAPE '\'),
  CHECK (amount_minor > 0),
  CHECK (currency = LOWER(currency) AND char_length(currency) = 3),
  CHECK (plan_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (state IN (
    'planned', 'submitting', 'reconciling', 'transferred',
    'failed_confirmed', 'blocked'
  )),
  CHECK (state <> 'transferred' OR stripe_transfer_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_stripe_launch_transfer_id
  ON stripe_launch_transfer_intents(stripe_transfer_id)
  WHERE stripe_transfer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stripe_launch_transfers_batch
  ON stripe_launch_transfer_intents(school_id, payout_batch_id, state);
CREATE INDEX IF NOT EXISTS idx_stripe_launch_transfers_contract
  ON stripe_launch_transfer_intents(school_id, source_payment_contract_id);

CREATE TABLE IF NOT EXISTS stripe_launch_transfer_attempts (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  transfer_intent_id UUID NOT NULL,
  attempt_number INTEGER NOT NULL,
  attempt_kind TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  response_classification TEXT NOT NULL,
  stripe_request_id TEXT,
  observed_transfer_id TEXT,
  sanitized_error_code TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (id, school_id),
  UNIQUE (school_id, transfer_intent_id, attempt_number),
  UNIQUE (school_id, request_fingerprint),
  FOREIGN KEY (transfer_intent_id, school_id)
    REFERENCES stripe_launch_transfer_intents(id, school_id),
  CHECK (attempt_number > 0),
  CHECK (attempt_kind IN ('submission', 'reconciliation')),
  CHECK (request_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (response_classification IN (
    'success', 'definite_failure', 'ambiguous', 'found',
    'not_found_safe_retry', 'operator_review'
  ))
);

CREATE INDEX IF NOT EXISTS idx_stripe_launch_transfer_attempts_intent
  ON stripe_launch_transfer_attempts(school_id, transfer_intent_id, attempt_number);

CREATE TABLE IF NOT EXISTS payout_batch_earning_dispositions (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  payout_batch_id UUID NOT NULL,
  booking_earning_id UUID NOT NULL,
  disposition_type TEXT NOT NULL,
  amount_minor BIGINT NOT NULL,
  obligation_application_id UUID,
  transfer_intent_id UUID,
  disposition_fingerprint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (id, school_id),
  UNIQUE (school_id, disposition_fingerprint),
  FOREIGN KEY (payout_batch_id, school_id)
    REFERENCES instructor_payout_batches(id, school_id),
  FOREIGN KEY (booking_earning_id, school_id)
    REFERENCES stripe_launch_booking_earnings(id, school_id),
  FOREIGN KEY (obligation_application_id, school_id)
    REFERENCES instructor_payout_obligation_applications(id, school_id),
  FOREIGN KEY (transfer_intent_id, school_id)
    REFERENCES stripe_launch_transfer_intents(id, school_id),
  CHECK (disposition_type IN (
    'obligation_application', 'transfer_allocation', 'held_connect_not_ready'
  )),
  CHECK (amount_minor > 0),
  CHECK ((disposition_type = 'obligation_application'
      AND obligation_application_id IS NOT NULL AND transfer_intent_id IS NULL)
    OR (disposition_type = 'transfer_allocation'
      AND obligation_application_id IS NULL AND transfer_intent_id IS NOT NULL)
    OR (disposition_type = 'held_connect_not_ready'
      AND obligation_application_id IS NULL AND transfer_intent_id IS NULL)),
  CHECK (disposition_fingerprint ~ '^sha256:[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_payout_dispositions_earning
  ON payout_batch_earning_dispositions(school_id, booking_earning_id);
CREATE INDEX IF NOT EXISTS idx_payout_dispositions_batch
  ON payout_batch_earning_dispositions(school_id, payout_batch_id, disposition_type);
CREATE INDEX IF NOT EXISTS idx_payout_dispositions_transfer
  ON payout_batch_earning_dispositions(school_id, transfer_intent_id)
  WHERE transfer_intent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS payout_statements (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  payout_batch_id UUID NOT NULL,
  instructor_id INTEGER NOT NULL,
  statement_number TEXT NOT NULL,
  display_period_start TIMESTAMPTZ NOT NULL,
  display_period_end TIMESTAMPTZ NOT NULL,
  currency TEXT NOT NULL,
  canonical_statement_json JSONB NOT NULL,
  statement_fingerprint TEXT NOT NULL,
  transfer_status_wording TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL,
  durable_storage_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (id, school_id),
  UNIQUE (school_id, payout_batch_id),
  UNIQUE (school_id, statement_number),
  UNIQUE (school_id, statement_fingerprint),
  FOREIGN KEY (payout_batch_id, school_id)
    REFERENCES instructor_payout_batches(id, school_id),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  CHECK (display_period_end > display_period_start),
  CHECK (currency = LOWER(currency) AND char_length(currency) = 3),
  CHECK (jsonb_typeof(canonical_statement_json) = 'object'),
  CHECK (statement_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (transfer_status_wording IN (
    'locked', 'transfer_scheduled', 'transferred_to_stripe',
    'held_connect_not_ready', 'reconciling', 'failed_under_review', 'zero_value'
  ))
);

CREATE INDEX IF NOT EXISTS idx_payout_statements_instructor
  ON payout_statements(school_id, instructor_id, generated_at DESC);

CREATE TABLE IF NOT EXISTS payout_statement_delivery_attempts (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  payout_statement_id UUID NOT NULL,
  attempt_number INTEGER NOT NULL,
  recipient_identity TEXT NOT NULL,
  channel TEXT NOT NULL,
  template_version TEXT NOT NULL,
  statement_fingerprint TEXT NOT NULL,
  provider_message_id TEXT,
  outcome TEXT NOT NULL,
  error_code TEXT,
  attempted_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  delivery_fingerprint TEXT NOT NULL,
  UNIQUE (id, school_id),
  UNIQUE (school_id, payout_statement_id, attempt_number),
  UNIQUE (school_id, delivery_fingerprint),
  FOREIGN KEY (payout_statement_id, school_id)
    REFERENCES payout_statements(id, school_id),
  CHECK (attempt_number > 0),
  CHECK (channel IN ('email')),
  CHECK (statement_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (outcome IN ('pending', 'sent', 'failed', 'delivered')),
  CHECK (completed_at IS NULL OR completed_at >= attempted_at),
  CHECK (delivery_fingerprint ~ '^sha256:[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_statement_delivery_attempts_statement
  ON payout_statement_delivery_attempts(school_id, payout_statement_id, attempt_number);

CREATE TABLE IF NOT EXISTS payment_disputes (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  payment_contract_id UUID NOT NULL,
  stripe_dispute_id TEXT NOT NULL,
  stripe_charge_id TEXT NOT NULL,
  stripe_payment_intent_id TEXT NOT NULL,
  current_state TEXT NOT NULL,
  disputed_amount_minor BIGINT NOT NULL,
  final_principal_lost_minor BIGINT,
  currency TEXT NOT NULL,
  reason TEXT,
  response_deadline TIMESTAMPTZ,
  current_fingerprint TEXT NOT NULL,
  opened_at TIMESTAMPTZ NOT NULL,
  terminal_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (id, school_id),
  UNIQUE (stripe_dispute_id),
  UNIQUE (school_id, current_fingerprint),
  FOREIGN KEY (payment_contract_id, school_id)
    REFERENCES lesson_payment_contracts(id, school_id),
  CHECK (stripe_dispute_id LIKE 'dp\_%' ESCAPE '\'),
  CHECK (stripe_charge_id LIKE 'ch\_%' ESCAPE '\'),
  CHECK (disputed_amount_minor > 0),
  CHECK (final_principal_lost_minor IS NULL OR
    final_principal_lost_minor BETWEEN 0 AND disputed_amount_minor),
  CHECK (currency = LOWER(currency) AND char_length(currency) = 3),
  CHECK (current_state IN (
    'open', 'needs_response', 'under_review', 'won', 'lost', 'closed_manual'
  )),
  CHECK (current_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (current_state NOT IN ('won', 'lost', 'closed_manual') OR terminal_at IS NOT NULL),
  CHECK (current_state <> 'lost' OR final_principal_lost_minor IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_payment_disputes_contract
  ON payment_disputes(school_id, payment_contract_id, current_state);
CREATE INDEX IF NOT EXISTS idx_payment_disputes_deadline
  ON payment_disputes(school_id, response_deadline)
  WHERE current_state IN ('open', 'needs_response', 'under_review');

CREATE TABLE IF NOT EXISTS payment_dispute_events (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  payment_dispute_id UUID NOT NULL,
  stripe_event_id TEXT NOT NULL,
  stripe_event_type TEXT NOT NULL,
  stripe_created_at TIMESTAMPTZ NOT NULL,
  observed_state TEXT NOT NULL,
  evidence_fingerprint TEXT NOT NULL,
  evidence_json JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  UNIQUE (id, school_id),
  UNIQUE (stripe_event_id),
  UNIQUE (school_id, evidence_fingerprint),
  FOREIGN KEY (payment_dispute_id, school_id)
    REFERENCES payment_disputes(id, school_id),
  CHECK (observed_state IN (
    'open', 'needs_response', 'under_review', 'won', 'lost', 'closed_manual'
  )),
  CHECK (evidence_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (jsonb_typeof(evidence_json) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_payment_dispute_events_dispute
  ON payment_dispute_events(school_id, payment_dispute_id, stripe_created_at);

CREATE TABLE IF NOT EXISTS dispute_evidence_pack_versions (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  payment_dispute_id UUID NOT NULL,
  version_number INTEGER NOT NULL,
  included_record_ids JSONB NOT NULL,
  document_hashes JSONB NOT NULL,
  evidence_snapshot JSONB NOT NULL,
  created_by_admin_id INTEGER NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL,
  external_submission_reference TEXT,
  external_submission_status TEXT NOT NULL,
  pack_fingerprint TEXT NOT NULL,
  UNIQUE (id, school_id),
  UNIQUE (school_id, payment_dispute_id, version_number),
  UNIQUE (school_id, pack_fingerprint),
  FOREIGN KEY (payment_dispute_id, school_id)
    REFERENCES payment_disputes(id, school_id),
  FOREIGN KEY (created_by_admin_id, school_id)
    REFERENCES admin_users(id, school_id),
  CHECK (version_number > 0),
  CHECK (jsonb_typeof(included_record_ids) = 'object'),
  CHECK (jsonb_typeof(document_hashes) = 'object'),
  CHECK (jsonb_typeof(evidence_snapshot) = 'object'),
  CHECK (external_submission_status IN (
    'not_submitted', 'submitted_manually', 'accepted', 'rejected'
  )),
  CHECK (pack_fingerprint ~ '^sha256:[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_dispute_evidence_versions_dispute
  ON dispute_evidence_pack_versions(school_id, payment_dispute_id, version_number);

CREATE TABLE IF NOT EXISTS dispute_notification_attempts (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  payment_dispute_id UUID NOT NULL,
  logical_notice_identity TEXT NOT NULL,
  notice_type TEXT NOT NULL,
  channel TEXT NOT NULL,
  recipient_identity TEXT NOT NULL,
  outcome TEXT NOT NULL,
  provider_message_id TEXT,
  error_code TEXT,
  attempted_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  notification_fingerprint TEXT NOT NULL,
  UNIQUE (id, school_id),
  UNIQUE (school_id, logical_notice_identity),
  UNIQUE (school_id, notification_fingerprint),
  FOREIGN KEY (payment_dispute_id, school_id)
    REFERENCES payment_disputes(id, school_id),
  CHECK (notice_type IN (
    'opened', 'updated', 'deadline_three_days', 'deadline_twenty_four_hours',
    'won', 'lost'
  )),
  CHECK (channel = 'email'),
  CHECK (outcome IN ('pending', 'sent', 'failed', 'delivered')),
  CHECK (completed_at IS NULL OR completed_at >= attempted_at),
  CHECK (notification_fingerprint ~ '^sha256:[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_dispute_notifications_dispute
  ON dispute_notification_attempts(school_id, payment_dispute_id, attempted_at);

CREATE TABLE IF NOT EXISTS financial_job_occurrences (
  id UUID PRIMARY KEY,
  school_id INTEGER REFERENCES schools(id),
  scope_kind TEXT NOT NULL,
  job_kind TEXT NOT NULL,
  scheduled_local_label TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  scheduled_at_utc TIMESTAMPTZ NOT NULL,
  state TEXT NOT NULL,
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  result_fingerprint TEXT,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (id, school_id),
  CHECK ((scope_kind = 'global' AND school_id IS NULL)
      OR (scope_kind = 'school' AND school_id IS NOT NULL)),
  CHECK (job_kind IN (
    'outcome_digest', 'weekly_lock', 'weekly_transfer', 'refund_reconcile',
    'transfer_reconcile', 'dispute_deadline_reminder'
  )),
  CHECK (time_zone = 'Europe/London'),
  CHECK (state IN (
    'pending', 'leased', 'running', 'completed', 'failed_retryable',
    'failed_confirmed', 'missed_manual_review'
  )),
  CHECK (attempt_count >= 0),
  CHECK ((state IN ('leased', 'running')
      AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (state NOT IN ('leased', 'running'))),
  CHECK (result_fingerprint IS NULL OR result_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (completed_at IS NULL OR started_at IS NULL OR completed_at >= started_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_job_occurrence_global
  ON financial_job_occurrences(job_kind, scheduled_at_utc)
  WHERE scope_kind = 'global';
CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_job_occurrence_school
  ON financial_job_occurrences(school_id, job_kind, scheduled_at_utc)
  WHERE scope_kind = 'school';
CREATE INDEX IF NOT EXISTS idx_financial_job_occurrences_due
  ON financial_job_occurrences(state, scheduled_at_utc);

-- Complete the issue/run and dispute/obligation tenant-safe links after both
-- sides exist.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'lesson_issue_reports_run_school_fk'
      AND conrelid = 'lesson_issue_reports'::regclass
  ) THEN
    ALTER TABLE lesson_issue_reports
      ADD CONSTRAINT lesson_issue_reports_run_school_fk
      FOREIGN KEY (applicable_run_id, school_id)
      REFERENCES payout_runs(id, school_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'instructor_obligations_dispute_school_fk'
      AND conrelid = 'instructor_payout_obligations'::regclass
  ) THEN
    ALTER TABLE instructor_payout_obligations
      ADD CONSTRAINT instructor_obligations_dispute_school_fk
      FOREIGN KEY (source_dispute_id, school_id)
      REFERENCES payment_disputes(id, school_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'refund_intents_source_batch_school_fk'
      AND conrelid = 'refund_intents'::regclass
  ) THEN
    ALTER TABLE refund_intents
      ADD CONSTRAINT refund_intents_source_batch_school_fk
      FOREIGN KEY (source_batch_id, school_id)
      REFERENCES instructor_payout_batches(id, school_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'refund_intents_source_earning_school_fk'
      AND conrelid = 'refund_intents'::regclass
  ) THEN
    ALTER TABLE refund_intents
      ADD CONSTRAINT refund_intents_source_earning_school_fk
      FOREIGN KEY (source_earning_id, school_id)
      REFERENCES stripe_launch_booking_earnings(id, school_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payout_runs_occurrence_fk'
      AND conrelid = 'payout_runs'::regclass
  ) THEN
    ALTER TABLE payout_runs
      ADD CONSTRAINT payout_runs_occurrence_fk
      FOREIGN KEY (scheduled_occurrence_id, school_id)
      REFERENCES financial_job_occurrences(id, school_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_refund_intents_source_batch
  ON refund_intents(school_id, source_batch_id) WHERE source_batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_refund_intents_source_earning
  ON refund_intents(school_id, source_earning_id) WHERE source_earning_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_instructor_obligations_dispute
  ON instructor_payout_obligations(school_id, source_dispute_id)
  WHERE source_dispute_id IS NOT NULL;

-- Shared append-only and immutable-fact guards.
CREATE OR REPLACE FUNCTION stripe_launch_reject_change()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is forbidden', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION stripe_launch_reject_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% preserves launch financial history: DELETE is forbidden', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION stripe_launch_guard_operational_update()
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
    RAISE EXCEPTION '% immutable identity, scope, or financial facts changed', TG_TABLE_NAME
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION stripe_launch_guard_config_update()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.school_id <> NEW.school_id
    OR OLD.cutover_at <> NEW.cutover_at
    OR OLD.accounting_version <> NEW.accounting_version
    OR OLD.created_by_admin_id <> NEW.created_by_admin_id
    OR OLD.created_at <> NEW.created_at
  THEN
    RAISE EXCEPTION 'launch configuration identity and cutover are immutable'
      USING ERRCODE = '55000';
  END IF;
  IF NOT (
    (OLD.mode = NEW.mode)
    OR (OLD.mode = 'disabled' AND NEW.mode IN ('shadow', 'approval_pending'))
    OR (OLD.mode = 'shadow' AND NEW.mode IN ('approval_pending', 'paused'))
    OR (OLD.mode = 'approval_pending' AND NEW.mode IN ('live', 'paused'))
    OR (OLD.mode = 'live' AND NEW.mode = 'paused')
    OR (OLD.mode = 'paused' AND NEW.mode IN ('live', 'approval_pending'))
  ) THEN
    RAISE EXCEPTION 'invalid launch mode transition % -> %', OLD.mode, NEW.mode
      USING ERRCODE = '23514';
  END IF;
  IF OLD.mode = 'live' AND NEW.mode = 'shadow' THEN
    RAISE EXCEPTION 'live launch classification cannot return to shadow'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION stripe_launch_guard_agreement_write()
RETURNS TRIGGER AS $$
DECLARE
  overlap_exists BOOLEAN;
BEGIN
  PERFORM pg_advisory_xact_lock(NEW.school_id, NEW.instructor_id);
  SELECT EXISTS (
    SELECT 1
    FROM instructor_payout_agreement_versions other
    WHERE other.school_id = NEW.school_id
      AND other.instructor_id = NEW.instructor_id
      AND other.id <> NEW.id
      AND other.status IN ('active', 'paused')
      AND NEW.status IN ('active', 'paused')
      AND tstzrange(other.starts_at, other.ends_at, '[)')
        && tstzrange(NEW.starts_at, NEW.ends_at, '[)')
  ) INTO overlap_exists;
  IF overlap_exists THEN
    RAISE EXCEPTION 'payout agreement effective ranges overlap'
      USING ERRCODE = '23P01';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status <> 'draft' THEN
      IF to_jsonb(OLD) - ARRAY['status', 'ends_at']::text[]
        <> to_jsonb(NEW) - ARRAY['status', 'ends_at']::text[]
      THEN
        RAISE EXCEPTION 'activated payout agreement facts are immutable'
          USING ERRCODE = '55000';
      END IF;
      IF NOT ((OLD.status = NEW.status)
        OR (OLD.status = 'active' AND NEW.status IN ('paused', 'ended'))
        OR (OLD.status = 'paused' AND NEW.status IN ('active', 'ended')))
      THEN
        RAISE EXCEPTION 'invalid payout agreement state transition'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION stripe_launch_guard_contract_update()
RETURNS TRIGGER AS $$
DECLARE
  immutable_columns TEXT[] := ARRAY[
    'id', 'school_id', 'learner_id', 'instructor_id', 'funding_source_id',
    'origin', 'regime', 'stripe_payment_created_at', 'gross_amount_minor',
    'currency', 'stripe_payment_intent_id', 'stripe_charge_id', 'created_at',
    'fingerprint'
  ];
  column_name TEXT;
BEGIN
  IF OLD.evidence_status <> 'pending' THEN
    RAISE EXCEPTION 'completed/terminal lesson payment contract is immutable'
      USING ERRCODE = '55000';
  END IF;
  FOREACH column_name IN ARRAY immutable_columns LOOP
    IF to_jsonb(OLD)->column_name IS DISTINCT FROM to_jsonb(NEW)->column_name THEN
      RAISE EXCEPTION 'lesson payment contract identity changed: %', column_name
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
  IF (OLD.stripe_fee_minor IS NOT NULL AND OLD.stripe_fee_minor IS DISTINCT FROM NEW.stripe_fee_minor)
    OR (OLD.split_bps IS NOT NULL AND OLD.split_bps IS DISTINCT FROM NEW.split_bps)
    OR (OLD.agreement_version_id IS NOT NULL AND OLD.agreement_version_id IS DISTINCT FROM NEW.agreement_version_id)
    OR (OLD.stripe_balance_transaction_id IS NOT NULL AND OLD.stripe_balance_transaction_id IS DISTINCT FROM NEW.stripe_balance_transaction_id)
    OR (OLD.stripe_funds_available_at IS NOT NULL AND OLD.stripe_funds_available_at IS DISTINCT FROM NEW.stripe_funds_available_at)
  THEN
    RAISE EXCEPTION 'known lesson payment evidence cannot be replaced'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.evidence_status NOT IN ('pending', 'complete', 'contradictory', 'ineligible') THEN
    RAISE EXCEPTION 'invalid lesson payment evidence transition'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION stripe_launch_validate_contract_regime()
RETURNS TRIGGER AS $$
DECLARE
  config_row stripe_connect_launch_configs%ROWTYPE;
BEGIN
  SELECT * INTO config_row
  FROM stripe_connect_launch_configs
  WHERE school_id = NEW.school_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lesson payment contract requires explicit school launch configuration'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.regime <> (CASE
    WHEN NEW.stripe_payment_created_at >= config_row.cutover_at THEN 'launch'
    ELSE 'legacy'
  END) THEN
    RAISE EXCEPTION 'lesson payment regime does not match immutable Stripe creation time'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION stripe_launch_guard_payout_source_update()
RETURNS TRIGGER AS $$
DECLARE
  old_facts JSONB;
  new_facts JSONB;
  fill_column TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payout_funding_sources is append-only: DELETE is forbidden'
      USING ERRCODE = '55000';
  END IF;
  old_facts := to_jsonb(OLD) - ARRAY[
    'stripe_payment_created_at', 'stripe_funds_available_at', 'payment_origin',
    'source_booking_id', 'lesson_payment_contract_id', 'evidence_completeness',
    'contradiction_code'
  ]::text[];
  new_facts := to_jsonb(NEW) - ARRAY[
    'stripe_payment_created_at', 'stripe_funds_available_at', 'payment_origin',
    'source_booking_id', 'lesson_payment_contract_id', 'evidence_completeness',
    'contradiction_code'
  ]::text[];
  IF old_facts <> new_facts THEN
    RAISE EXCEPTION 'payout funding source historic facts are immutable'
      USING ERRCODE = '55000';
  END IF;
  FOREACH fill_column IN ARRAY ARRAY[
    'stripe_payment_created_at', 'stripe_funds_available_at', 'payment_origin',
    'source_booking_id', 'lesson_payment_contract_id'
  ] LOOP
    IF to_jsonb(OLD)->fill_column IS NOT NULL
      AND to_jsonb(OLD)->fill_column IS DISTINCT FROM to_jsonb(NEW)->fill_column
    THEN
      RAISE EXCEPTION 'known payout source launch evidence cannot be replaced: %', fill_column
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
  IF OLD.evidence_completeness IS NOT NULL
    AND OLD.evidence_completeness <> 'pending'
    AND OLD.evidence_completeness IS DISTINCT FROM NEW.evidence_completeness
  THEN
    RAISE EXCEPTION 'terminal payout source evidence classification is immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payout_funding_sources_append_only ON payout_funding_sources;
CREATE TRIGGER payout_funding_sources_append_only
  BEFORE UPDATE OR DELETE ON payout_funding_sources
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_guard_payout_source_update();

CREATE OR REPLACE FUNCTION stripe_launch_validate_outcome_insert()
RETURNS TRIGGER AS $$
DECLARE
  booking_row lesson_bookings%ROWTYPE;
  prior_row lesson_outcome_revisions%ROWTYPE;
  replacement_row lesson_bookings%ROWTYPE;
BEGIN
  SELECT * INTO booking_row
  FROM lesson_bookings
  WHERE id = NEW.booking_id AND school_id = NEW.school_id
  FOR UPDATE;
  IF NOT FOUND OR booking_row.instructor_id <> NEW.instructor_id
    OR NEW.actor_instructor_id <> NEW.instructor_id
    OR booking_row.lesson_payment_contract_id IS DISTINCT FROM NEW.lesson_payment_contract_id
  THEN
    RAISE EXCEPTION 'outcome does not match school-scoped booking ownership/contract'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.revision_number > 1 THEN
    SELECT * INTO prior_row
    FROM lesson_outcome_revisions
    WHERE id = NEW.supersedes_revision_id AND school_id = NEW.school_id;
    IF NOT FOUND OR prior_row.booking_id <> NEW.booking_id
      OR prior_row.revision_number <> NEW.revision_number - 1
    THEN
      RAISE EXCEPTION 'outcome revision chain is not contiguous'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.outcome IN ('delivered', 'late_learner_cancel_or_no_show')
    AND ((booking_row.scheduled_date + booking_row.end_time)
      AT TIME ZONE 'Europe/London') > NEW.occurred_at
  THEN
    RAISE EXCEPTION 'payable outcome cannot be recorded before lesson end'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.outcome = 'rescheduled' THEN
    SELECT * INTO replacement_row
    FROM lesson_bookings
    WHERE id = NEW.replacement_booking_id AND school_id = NEW.school_id;
    IF NOT FOUND OR replacement_row.id = booking_row.id
      OR replacement_row.instructor_id <> booking_row.instructor_id
      OR replacement_row.lesson_payment_contract_id IS DISTINCT FROM booking_row.lesson_payment_contract_id
    THEN
      RAISE EXCEPTION 'rescheduled outcome requires real same-instructor contract replacement'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  IF EXISTS (
    SELECT 1 FROM stripe_launch_booking_earnings e
    WHERE e.school_id = NEW.school_id
      AND e.payment_contract_id = NEW.lesson_payment_contract_id
  ) THEN
    RAISE EXCEPTION 'outcome cannot change after launch earning lock'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION stripe_launch_validate_refund_attempt()
RETURNS TRIGGER AS $$
DECLARE
  intent_row refund_intents%ROWTYPE;
BEGIN
  SELECT * INTO intent_row FROM refund_intents
  WHERE id = NEW.refund_intent_id AND school_id = NEW.school_id
  FOR UPDATE;
  IF NOT FOUND OR NEW.idempotency_key <> intent_row.stripe_idempotency_key THEN
    RAISE EXCEPTION 'refund attempt must reuse the intent idempotency key'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION stripe_launch_validate_transfer_attempt()
RETURNS TRIGGER AS $$
DECLARE
  intent_row stripe_launch_transfer_intents%ROWTYPE;
BEGIN
  SELECT * INTO intent_row FROM stripe_launch_transfer_intents
  WHERE id = NEW.transfer_intent_id AND school_id = NEW.school_id
  FOR UPDATE;
  IF NOT FOUND OR NEW.idempotency_key <> intent_row.stripe_idempotency_key THEN
    RAISE EXCEPTION 'transfer attempt must reuse the intent idempotency key'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION stripe_launch_validate_obligation_application()
RETURNS TRIGGER AS $$
DECLARE
  obligation_row instructor_payout_obligations%ROWTYPE;
  reversed_row instructor_payout_obligation_applications%ROWTYPE;
  reduced BIGINT;
  reversed BIGINT;
BEGIN
  SELECT * INTO obligation_row
  FROM instructor_payout_obligations
  WHERE id = NEW.obligation_id AND school_id = NEW.school_id
  FOR UPDATE;
  IF NOT FOUND OR obligation_row.instructor_id <> NEW.instructor_id THEN
    RAISE EXCEPTION 'obligation application scope/instructor mismatch'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.application_type = 'reversal' THEN
    SELECT * INTO reversed_row
    FROM instructor_payout_obligation_applications
    WHERE id = NEW.reverses_application_id AND school_id = NEW.school_id;
    IF NOT FOUND OR reversed_row.obligation_id <> NEW.obligation_id
      OR reversed_row.application_type = 'reversal'
      OR NEW.amount_minor > reversed_row.amount_minor
    THEN
      RAISE EXCEPTION 'obligation reversal is not bounded to a prior application'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  SELECT
    COALESCE(SUM(amount_minor) FILTER (WHERE application_type <> 'reversal'), 0),
    COALESCE(SUM(amount_minor) FILTER (WHERE application_type = 'reversal'), 0)
  INTO reduced, reversed
  FROM instructor_payout_obligation_applications
  WHERE obligation_id = NEW.obligation_id AND school_id = NEW.school_id;
  IF NEW.application_type = 'reversal' THEN reversed := reversed + NEW.amount_minor;
  ELSE reduced := reduced + NEW.amount_minor;
  END IF;
  IF reversed > reduced OR reduced - reversed > obligation_row.original_amount_minor THEN
    RAISE EXCEPTION 'obligation applications exceed immutable principal'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION stripe_launch_validate_obligation_insert()
RETURNS TRIGGER AS $$
DECLARE
  run_row payout_runs%ROWTYPE;
  agreement_row instructor_payout_agreement_versions%ROWTYPE;
  dispute_row payment_disputes%ROWTYPE;
  earning_row stripe_launch_booking_earnings%ROWTYPE;
  expected_loss BIGINT;
BEGIN
  IF NEW.obligation_type = 'weekly_franchise_fee' THEN
    SELECT * INTO run_row FROM payout_runs
    WHERE id = NEW.source_payout_run_id AND school_id = NEW.school_id;
    SELECT * INTO agreement_row FROM instructor_payout_agreement_versions
    WHERE id = NEW.agreement_version_id AND school_id = NEW.school_id;
    IF run_row.id IS NULL OR agreement_row.id IS NULL
      OR agreement_row.instructor_id <> NEW.instructor_id
      OR agreement_row.currency <> NEW.currency
      OR agreement_row.weekly_franchise_fee_minor <> NEW.original_amount_minor
      OR NOT (agreement_row.starts_at <= run_row.lock_at
        AND (agreement_row.ends_at IS NULL OR agreement_row.ends_at > run_row.lock_at))
    THEN
      RAISE EXCEPTION 'weekly obligation does not match the agreement active at lock'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT * INTO dispute_row FROM payment_disputes
    WHERE id = NEW.source_dispute_id AND school_id = NEW.school_id;
    SELECT * INTO earning_row FROM stripe_launch_booking_earnings
    WHERE payment_contract_id = NEW.source_payment_contract_id
      AND school_id = NEW.school_id;
    IF dispute_row.id IS NULL OR earning_row.id IS NULL
      OR dispute_row.current_state <> 'lost'
      OR dispute_row.payment_contract_id <> NEW.source_payment_contract_id
      OR earning_row.instructor_id <> NEW.instructor_id
      OR earning_row.currency <> NEW.currency
    THEN
      RAISE EXCEPTION 'final dispute obligation lacks matching terminal loss/earning evidence'
        USING ERRCODE = '23514';
    END IF;
    expected_loss := LEAST(
      earning_row.instructor_share_minor,
      (earning_row.instructor_share_minor * dispute_row.final_principal_lost_minor
        + earning_row.gross_minor / 2) / earning_row.gross_minor
    );
    IF NEW.original_amount_minor <> expected_loss THEN
      RAISE EXCEPTION 'final dispute obligation is not the bounded proportional instructor share'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION stripe_launch_validate_disposition_link()
RETURNS TRIGGER AS $$
DECLARE
  earning_row stripe_launch_booking_earnings%ROWTYPE;
  transfer_row stripe_launch_transfer_intents%ROWTYPE;
  application_row instructor_payout_obligation_applications%ROWTYPE;
BEGIN
  SELECT * INTO earning_row FROM stripe_launch_booking_earnings
  WHERE id = NEW.booking_earning_id AND school_id = NEW.school_id;
  IF NOT FOUND OR earning_row.payout_batch_id <> NEW.payout_batch_id THEN
    RAISE EXCEPTION 'earning disposition batch mismatch'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.transfer_intent_id IS NOT NULL THEN
    SELECT * INTO transfer_row FROM stripe_launch_transfer_intents
    WHERE id = NEW.transfer_intent_id AND school_id = NEW.school_id;
    IF NOT FOUND OR transfer_row.payout_batch_id <> NEW.payout_batch_id
      OR transfer_row.source_payment_contract_id <> earning_row.payment_contract_id
    THEN
      RAISE EXCEPTION 'transfer disposition source/batch mismatch'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.obligation_application_id IS NOT NULL THEN
    SELECT * INTO application_row FROM instructor_payout_obligation_applications
    WHERE id = NEW.obligation_application_id AND school_id = NEW.school_id;
    IF NOT FOUND OR application_row.source_batch_id <> NEW.payout_batch_id
      OR application_row.amount_minor <> NEW.amount_minor
    THEN
      RAISE EXCEPTION 'obligation disposition does not match its application'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION stripe_launch_validate_batch_insert()
RETURNS TRIGGER AS $$
DECLARE
  run_row payout_runs%ROWTYPE;
  agreement_row instructor_payout_agreement_versions%ROWTYPE;
  scope_row payout_v2_connected_account_scopes%ROWTYPE;
BEGIN
  SELECT * INTO run_row FROM payout_runs
  WHERE id = NEW.payout_run_id AND school_id = NEW.school_id;
  SELECT * INTO agreement_row FROM instructor_payout_agreement_versions
  WHERE id = NEW.agreement_version_id AND school_id = NEW.school_id;
  IF run_row.id IS NULL OR agreement_row.id IS NULL
    OR agreement_row.instructor_id <> NEW.instructor_id
    OR agreement_row.currency <> NEW.currency
    OR run_row.currency <> NEW.currency
    OR NEW.locked_at <> run_row.lock_at
    OR agreement_row.status NOT IN ('active', 'paused')
    OR agreement_row.starts_at > run_row.lock_at
    OR (agreement_row.ends_at IS NOT NULL AND agreement_row.ends_at <= run_row.lock_at)
  THEN
    RAISE EXCEPTION 'payout batch does not match its run/agreement snapshot'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.connect_scope_id IS NOT NULL THEN
    SELECT * INTO scope_row FROM payout_v2_connected_account_scopes
    WHERE id = NEW.connect_scope_id AND school_id = NEW.school_id;
    IF scope_row.id IS NULL OR scope_row.owner_type <> 'instructor'
      OR scope_row.instructor_id <> NEW.instructor_id
    THEN
      RAISE EXCEPTION 'payout batch Connect scope does not belong to instructor'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION stripe_launch_validate_earning_insert()
RETURNS TRIGGER AS $$
DECLARE
  run_row payout_runs%ROWTYPE;
  batch_row instructor_payout_batches%ROWTYPE;
  contract_row lesson_payment_contracts%ROWTYPE;
  outcome_row lesson_outcome_revisions%ROWTYPE;
  latest_revision INTEGER;
BEGIN
  SELECT * INTO run_row FROM payout_runs
  WHERE id = NEW.payout_run_id AND school_id = NEW.school_id;
  SELECT * INTO batch_row FROM instructor_payout_batches
  WHERE id = NEW.payout_batch_id AND school_id = NEW.school_id;
  SELECT * INTO contract_row FROM lesson_payment_contracts
  WHERE id = NEW.payment_contract_id AND school_id = NEW.school_id;
  SELECT * INTO outcome_row FROM lesson_outcome_revisions
  WHERE id = NEW.outcome_revision_id AND school_id = NEW.school_id;
  SELECT MAX(revision_number) INTO latest_revision FROM lesson_outcome_revisions
  WHERE school_id = NEW.school_id
    AND lesson_payment_contract_id = NEW.payment_contract_id;
  IF run_row.id IS NULL OR batch_row.id IS NULL OR contract_row.id IS NULL
    OR outcome_row.id IS NULL
    OR batch_row.payout_run_id <> NEW.payout_run_id
    OR batch_row.instructor_id <> NEW.instructor_id
    OR contract_row.instructor_id <> NEW.instructor_id
    OR outcome_row.instructor_id <> NEW.instructor_id
    OR outcome_row.lesson_payment_contract_id <> NEW.payment_contract_id
    OR outcome_row.revision_number <> latest_revision
    OR outcome_row.outcome NOT IN ('delivered', 'late_learner_cancel_or_no_show')
    OR outcome_row.occurred_at >= run_row.lock_at
    OR contract_row.evidence_status <> 'complete'
    OR contract_row.regime <> 'launch'
    OR contract_row.gross_amount_minor <> NEW.gross_minor
    OR contract_row.stripe_fee_minor <> NEW.stripe_fee_minor
    OR contract_row.split_bps <> NEW.split_bps
    OR contract_row.currency <> NEW.currency
    OR batch_row.currency <> NEW.currency
  THEN
    RAISE EXCEPTION 'launch earning lacks one exact eligible contract/outcome/batch'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION stripe_launch_validate_transfer_insert()
RETURNS TRIGGER AS $$
DECLARE
  batch_row instructor_payout_batches%ROWTYPE;
  contract_row lesson_payment_contracts%ROWTYPE;
  scope_row payout_v2_connected_account_scopes%ROWTYPE;
BEGIN
  SELECT * INTO batch_row FROM instructor_payout_batches
  WHERE id = NEW.payout_batch_id AND school_id = NEW.school_id;
  SELECT * INTO contract_row FROM lesson_payment_contracts
  WHERE id = NEW.source_payment_contract_id AND school_id = NEW.school_id;
  SELECT * INTO scope_row FROM payout_v2_connected_account_scopes
  WHERE id = NEW.connect_scope_id AND school_id = NEW.school_id;
  IF batch_row.id IS NULL OR contract_row.id IS NULL OR scope_row.id IS NULL
    OR batch_row.instructor_id <> NEW.instructor_id
    OR contract_row.instructor_id <> NEW.instructor_id
    OR contract_row.currency <> NEW.currency
    OR batch_row.currency <> NEW.currency
    OR contract_row.stripe_charge_id <> NEW.stripe_source_charge_id
    OR scope_row.owner_type <> 'instructor'
    OR scope_row.instructor_id <> NEW.instructor_id
    OR scope_row.stripe_account_id <> NEW.stripe_destination_account_id
  THEN
    RAISE EXCEPTION 'transfer intent source, recipient, currency, or batch mismatch'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION stripe_launch_validate_refund_intent_insert()
RETURNS TRIGGER AS $$
DECLARE
  contract_row lesson_payment_contracts%ROWTYPE;
  booking_row lesson_bookings%ROWTYPE;
  already_claimed BIGINT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(
    NEW.school_id::TEXT || ':refund:' || NEW.payment_contract_id::TEXT, 0
  ));
  SELECT * INTO contract_row FROM lesson_payment_contracts
  WHERE id = NEW.payment_contract_id AND school_id = NEW.school_id;
  SELECT * INTO booking_row FROM lesson_bookings
  WHERE id = NEW.booking_id AND school_id = NEW.school_id;
  IF contract_row.id IS NULL OR booking_row.id IS NULL
    OR contract_row.learner_id <> NEW.learner_id
    OR contract_row.instructor_id <> NEW.instructor_id
    OR contract_row.funding_source_id <> NEW.funding_source_id
    OR contract_row.gross_amount_minor <> NEW.gross_amount_minor
    OR contract_row.stripe_fee_minor <> NEW.stripe_fee_minor
    OR contract_row.currency <> NEW.currency
    OR contract_row.stripe_payment_intent_id <> NEW.stripe_payment_intent_id
    OR contract_row.stripe_charge_id <> NEW.stripe_charge_id
    OR booking_row.lesson_payment_contract_id <> NEW.payment_contract_id
  THEN
    RAISE EXCEPTION 'refund intent does not match immutable contract/booking evidence'
      USING ERRCODE = '23514';
  END IF;
  SELECT COALESCE(SUM(refund_amount_minor), 0) INTO already_claimed
  FROM refund_intents
  WHERE school_id = NEW.school_id
    AND payment_contract_id = NEW.payment_contract_id;
  IF already_claimed + NEW.refund_amount_minor > contract_row.gross_amount_minor THEN
    RAISE EXCEPTION 'refund intents exceed immutable contract gross amount'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION stripe_launch_validate_issue_report_insert()
RETURNS TRIGGER AS $$
DECLARE
  token_row lesson_issue_tokens%ROWTYPE;
BEGIN
  SELECT * INTO token_row FROM lesson_issue_tokens
  WHERE id = NEW.token_id AND school_id = NEW.school_id
  FOR UPDATE;
  IF token_row.id IS NULL OR token_row.booking_id <> NEW.booking_id
    OR token_row.learner_id IS DISTINCT FROM NEW.learner_id
    OR token_row.expires_at < NEW.reported_at
    OR token_row.revoked_at IS NOT NULL
    OR token_row.consumed_at IS NOT NULL
  THEN
    RAISE EXCEPTION 'lesson issue report token is invalid, expired, or consumed'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION stripe_launch_validate_contract_completion()
RETURNS TRIGGER AS $$
DECLARE
  target_contract_id UUID;
  target_school_id INTEGER;
  contract_row lesson_payment_contracts%ROWTYPE;
  booking_count BIGINT;
  source_count BIGINT;
BEGIN
  IF TG_TABLE_NAME = 'lesson_payment_contracts' THEN
    target_contract_id := NEW.id;
    target_school_id := NEW.school_id;
  ELSE
    target_contract_id := NEW.lesson_payment_contract_id;
    target_school_id := NEW.school_id;
  END IF;
  IF target_contract_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO contract_row FROM lesson_payment_contracts
  WHERE id = target_contract_id AND school_id = target_school_id;
  IF NOT FOUND OR contract_row.evidence_status <> 'complete' THEN RETURN NULL; END IF;
  SELECT COUNT(*) INTO booking_count FROM lesson_bookings
  WHERE school_id = target_school_id
    AND lesson_payment_contract_id = target_contract_id
    AND status IN ('scheduled', 'chargeable');
  IF booking_count <> 1 THEN
    RAISE EXCEPTION 'complete launch contract must have exactly one active booking link'
      USING ERRCODE = '23514';
  END IF;
  SELECT COUNT(*) INTO source_count FROM payout_funding_sources
  WHERE id = contract_row.funding_source_id
    AND school_id = target_school_id
    AND lesson_payment_contract_id = target_contract_id
    AND source_booking_id = (
      SELECT id FROM lesson_bookings
      WHERE school_id = target_school_id
        AND lesson_payment_contract_id = target_contract_id
        AND status IN ('scheduled', 'chargeable')
      LIMIT 1
    );
  IF source_count <> 1 THEN
    RAISE EXCEPTION 'complete launch contract must match its funding source and active booking'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION stripe_launch_validate_earning_dispositions()
RETURNS TRIGGER AS $$
DECLARE
  target_id UUID;
  target_school INTEGER;
  earning_row stripe_launch_booking_earnings%ROWTYPE;
  disposed BIGINT;
BEGIN
  target_school := NEW.school_id;
  IF TG_TABLE_NAME = 'stripe_launch_booking_earnings' THEN target_id := NEW.id;
  ELSE target_id := NEW.booking_earning_id;
  END IF;
  SELECT * INTO earning_row FROM stripe_launch_booking_earnings
  WHERE id = target_id AND school_id = target_school;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT COALESCE(SUM(amount_minor), 0) INTO disposed
  FROM payout_batch_earning_dispositions
  WHERE booking_earning_id = target_id AND school_id = target_school;
  IF disposed <> earning_row.instructor_share_minor THEN
    RAISE EXCEPTION 'earning dispositions do not conserve instructor share'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION stripe_launch_validate_transfer_total()
RETURNS TRIGGER AS $$
DECLARE
  target_id UUID;
  target_school INTEGER;
  transfer_row stripe_launch_transfer_intents%ROWTYPE;
  allocated BIGINT;
BEGIN
  target_school := NEW.school_id;
  IF TG_TABLE_NAME = 'stripe_launch_transfer_intents' THEN target_id := NEW.id;
  ELSE target_id := NEW.transfer_intent_id;
  END IF;
  IF target_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO transfer_row FROM stripe_launch_transfer_intents
  WHERE id = target_id AND school_id = target_school;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT COALESCE(SUM(amount_minor), 0) INTO allocated
  FROM payout_batch_earning_dispositions
  WHERE transfer_intent_id = target_id AND school_id = target_school;
  IF allocated <> transfer_row.amount_minor THEN
    RAISE EXCEPTION 'transfer allocations do not equal immutable transfer amount'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION stripe_launch_validate_batch_totals()
RETURNS TRIGGER AS $$
DECLARE
  target_id UUID;
  target_school INTEGER;
  batch_row instructor_payout_batches%ROWTYPE;
  earning_totals RECORD;
  disposition_totals RECORD;
  application_total BIGINT;
  new_obligation_total BIGINT;
BEGIN
  target_school := NEW.school_id;
  IF TG_TABLE_NAME = 'instructor_payout_batches' THEN
    target_id := NEW.id;
  ELSIF TG_TABLE_NAME = 'instructor_payout_obligation_applications' THEN
    target_id := NEW.source_batch_id;
  ELSIF TG_TABLE_NAME = 'instructor_payout_obligations' THEN
    SELECT id INTO target_id FROM instructor_payout_batches
    WHERE school_id = NEW.school_id
      AND payout_run_id = NEW.source_payout_run_id
      AND instructor_id = NEW.instructor_id;
  ELSE
    target_id := NEW.payout_batch_id;
  END IF;
  IF target_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO batch_row FROM instructor_payout_batches
  WHERE id = target_id AND school_id = target_school;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT COALESCE(SUM(gross_minor),0) gross,
    COALESCE(SUM(stripe_fee_minor),0) stripe_fee,
    COALESCE(SUM(net_minor),0) net,
    COALESCE(SUM(instructor_share_minor),0) instructor_share,
    COALESCE(SUM(platform_share_minor),0) platform_share
  INTO earning_totals
  FROM stripe_launch_booking_earnings
  WHERE payout_batch_id = target_id AND school_id = target_school;
  SELECT
    COALESCE(SUM(amount_minor) FILTER (WHERE disposition_type = 'obligation_application'),0) obligation,
    COALESCE(SUM(amount_minor) FILTER (WHERE disposition_type = 'transfer_allocation'),0) transfer,
    COALESCE(SUM(amount_minor) FILTER (WHERE disposition_type = 'held_connect_not_ready'),0) held
  INTO disposition_totals
  FROM payout_batch_earning_dispositions
  WHERE payout_batch_id = target_id AND school_id = target_school;
  SELECT COALESCE(SUM(amount_minor),0) INTO application_total
  FROM instructor_payout_obligation_applications
  WHERE source_batch_id = target_id AND school_id = target_school
    AND application_type = 'batch_earnings';
  SELECT COALESCE(SUM(original_amount_minor),0) INTO new_obligation_total
  FROM instructor_payout_obligations
  WHERE source_payout_run_id = batch_row.payout_run_id
    AND school_id = target_school
    AND instructor_id = batch_row.instructor_id;
  IF earning_totals.gross <> batch_row.gross_minor
    OR earning_totals.stripe_fee <> batch_row.stripe_fee_minor
    OR earning_totals.net <> batch_row.net_minor
    OR earning_totals.instructor_share <> batch_row.instructor_share_minor
    OR earning_totals.platform_share <> batch_row.platform_share_minor
    OR disposition_totals.obligation <> batch_row.applied_obligation_minor
    OR disposition_totals.transfer <> batch_row.transfer_planned_minor
    OR disposition_totals.held <> batch_row.held_minor
    OR application_total <> batch_row.applied_obligation_minor
    OR new_obligation_total <> batch_row.new_obligation_minor
  THEN
    RAISE EXCEPTION 'instructor payout batch child rows do not conserve locked totals'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION stripe_launch_validate_run_totals()
RETURNS TRIGGER AS $$
DECLARE
  target_id UUID;
  target_school INTEGER;
  run_row payout_runs%ROWTYPE;
  totals RECORD;
BEGIN
  target_school := NEW.school_id;
  IF TG_TABLE_NAME = 'payout_runs' THEN target_id := NEW.id;
  ELSE target_id := NEW.payout_run_id;
  END IF;
  SELECT * INTO run_row FROM payout_runs
  WHERE id = target_id AND school_id = target_school;
  IF NOT FOUND OR run_row.state IN ('planned', 'shadowed', 'approval_pending') THEN RETURN NULL; END IF;
  SELECT COALESCE(SUM(gross_minor),0) gross,
    COALESCE(SUM(stripe_fee_minor),0) stripe_fee,
    COALESCE(SUM(net_minor),0) net,
    COALESCE(SUM(instructor_share_minor),0) instructor_share,
    COALESCE(SUM(platform_share_minor),0) platform_share,
    COALESCE(SUM(applied_obligation_minor),0) obligation,
    COALESCE(SUM(transfer_planned_minor),0) transfer,
    COALESCE(SUM(held_minor),0) held
  INTO totals FROM instructor_payout_batches
  WHERE payout_run_id = target_id AND school_id = target_school;
  IF totals.gross <> run_row.gross_minor
    OR totals.stripe_fee <> run_row.stripe_fee_minor
    OR totals.net <> run_row.net_minor
    OR totals.instructor_share <> run_row.instructor_share_minor
    OR totals.platform_share <> run_row.platform_share_minor
    OR totals.obligation <> run_row.obligation_applied_minor
    OR totals.transfer <> run_row.transfer_minor
    OR totals.held <> run_row.held_minor
  THEN
    RAISE EXCEPTION 'payout run batches do not conserve locked totals'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION stripe_launch_guard_state_transition()
RETURNS TRIGGER AS $$
DECLARE
  old_state TEXT := to_jsonb(OLD)->>TG_ARGV[0];
  new_state TEXT := to_jsonb(NEW)->>TG_ARGV[0];
  allowed BOOLEAN := FALSE;
BEGIN
  IF old_state = new_state THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'refund_intents' THEN
    allowed := (old_state = 'planned' AND new_state IN ('submitting','manual_review'))
      OR (old_state = 'submitting' AND new_state IN ('succeeded','reconciling','failed_confirmed'))
      OR (old_state = 'reconciling' AND new_state IN ('succeeded','failed_confirmed','manual_review'))
      OR (old_state = 'failed_confirmed' AND new_state IN ('submitting','manual_review'));
  ELSIF TG_TABLE_NAME = 'stripe_launch_transfer_intents' THEN
    allowed := (old_state = 'planned' AND new_state IN ('submitting','blocked'))
      OR (old_state = 'submitting' AND new_state IN ('transferred','reconciling','failed_confirmed'))
      OR (old_state = 'reconciling' AND new_state IN ('transferred','failed_confirmed'))
      OR (old_state = 'failed_confirmed' AND new_state = 'submitting');
  ELSIF TG_TABLE_NAME = 'payment_disputes' THEN
    allowed := old_state IN ('open','needs_response','under_review')
      AND new_state IN ('open','needs_response','under_review','won','lost','closed_manual');
  ELSIF TG_TABLE_NAME = 'financial_job_occurrences' THEN
    allowed := (old_state = 'pending' AND new_state IN ('leased','missed_manual_review'))
      OR (old_state = 'leased' AND new_state IN ('running','pending','failed_retryable'))
      OR (old_state = 'running' AND new_state IN ('completed','failed_retryable','failed_confirmed'))
      OR (old_state = 'failed_retryable' AND new_state = 'leased');
  ELSIF TG_TABLE_NAME = 'payout_runs' THEN
    allowed := (old_state = 'planned' AND new_state IN ('shadowed','approval_pending','locked','paused'))
      OR (old_state = 'shadowed' AND new_state IN ('approval_pending','paused'))
      OR (old_state = 'approval_pending' AND new_state IN ('locked','paused'))
      OR (old_state = 'locked' AND new_state IN ('transferring','paused'))
      OR (old_state = 'transferring' AND new_state IN ('transferred','reconciling','failed_confirmed','paused'))
      OR (old_state = 'reconciling' AND new_state IN ('transferred','failed_confirmed','paused'))
      OR (old_state = 'failed_confirmed' AND new_state IN ('transferring','paused'))
      OR (old_state = 'paused' AND new_state IN ('approval_pending','locked','transferring'));
  ELSIF TG_TABLE_NAME = 'instructor_payout_batches' THEN
    allowed := (old_state IN ('locked','zero_value','held_connect_not_ready')
        AND new_state IN ('transfer_pending','transferring','held_connect_not_ready'))
      OR (old_state = 'transfer_pending' AND new_state IN ('transferring','held_connect_not_ready'))
      OR (old_state = 'transferring' AND new_state IN ('transferred','reconciling','failed_confirmed'))
      OR (old_state = 'reconciling' AND new_state IN ('transferred','failed_confirmed'))
      OR (old_state = 'failed_confirmed' AND new_state = 'transferring');
  END IF;
  IF NOT allowed THEN
    RAISE EXCEPTION 'invalid % state transition % -> %', TG_TABLE_NAME, old_state, new_state
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Append-only evidence tables.
DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'stripe_connect_launch_events', 'lesson_outcome_revisions',
    'lesson_issue_reports', 'lesson_issue_actions', 'refund_attempts',
    'connect_account_state_events', 'instructor_payout_obligations',
    'instructor_payout_obligation_applications', 'stripe_launch_booking_earnings',
    'stripe_launch_transfer_attempts', 'payout_batch_earning_dispositions',
    'payout_statements', 'payout_statement_delivery_attempts',
    'payment_dispute_events', 'dispute_evidence_pack_versions',
    'dispute_notification_attempts'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I',
      table_name || '_append_only', table_name);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION stripe_launch_reject_change()',
      table_name || '_append_only', table_name);
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS stripe_connect_launch_configs_no_delete ON stripe_connect_launch_configs;
CREATE TRIGGER stripe_connect_launch_configs_no_delete
  BEFORE DELETE ON stripe_connect_launch_configs
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_reject_delete();
DROP TRIGGER IF EXISTS stripe_connect_launch_configs_update_guard ON stripe_connect_launch_configs;
CREATE TRIGGER stripe_connect_launch_configs_update_guard
  BEFORE UPDATE ON stripe_connect_launch_configs
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_guard_config_update();

DROP TRIGGER IF EXISTS payout_agreements_write_guard ON instructor_payout_agreement_versions;
CREATE TRIGGER payout_agreements_write_guard
  BEFORE INSERT OR UPDATE ON instructor_payout_agreement_versions
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_guard_agreement_write();
DROP TRIGGER IF EXISTS payout_agreements_no_delete ON instructor_payout_agreement_versions;
CREATE TRIGGER payout_agreements_no_delete
  BEFORE DELETE ON instructor_payout_agreement_versions
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_reject_delete();

DROP TRIGGER IF EXISTS lesson_payment_contracts_regime_guard ON lesson_payment_contracts;
CREATE TRIGGER lesson_payment_contracts_regime_guard
  BEFORE INSERT OR UPDATE ON lesson_payment_contracts
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_validate_contract_regime();
DROP TRIGGER IF EXISTS lesson_payment_contracts_update_guard ON lesson_payment_contracts;
CREATE TRIGGER lesson_payment_contracts_update_guard
  BEFORE UPDATE ON lesson_payment_contracts
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_guard_contract_update();
DROP TRIGGER IF EXISTS lesson_payment_contracts_no_delete ON lesson_payment_contracts;
CREATE TRIGGER lesson_payment_contracts_no_delete
  BEFORE DELETE ON lesson_payment_contracts
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_reject_delete();

DROP TRIGGER IF EXISTS lesson_outcome_revisions_insert_guard ON lesson_outcome_revisions;
CREATE TRIGGER lesson_outcome_revisions_insert_guard
  BEFORE INSERT ON lesson_outcome_revisions
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_validate_outcome_insert();

DROP TRIGGER IF EXISTS lesson_issue_tokens_no_delete ON lesson_issue_tokens;
CREATE TRIGGER lesson_issue_tokens_no_delete
  BEFORE DELETE ON lesson_issue_tokens
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_reject_delete();
DROP TRIGGER IF EXISTS lesson_issue_tokens_immutable_facts ON lesson_issue_tokens;
CREATE TRIGGER lesson_issue_tokens_immutable_facts
  BEFORE UPDATE ON lesson_issue_tokens
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_guard_operational_update('consumed_at', 'revoked_at');
DROP TRIGGER IF EXISTS lesson_issue_reports_insert_guard ON lesson_issue_reports;
CREATE TRIGGER lesson_issue_reports_insert_guard
  BEFORE INSERT ON lesson_issue_reports
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_validate_issue_report_insert();

DROP TRIGGER IF EXISTS refund_intents_no_delete ON refund_intents;
CREATE TRIGGER refund_intents_no_delete
  BEFORE DELETE ON refund_intents
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_reject_delete();
DROP TRIGGER IF EXISTS refund_intents_immutable_facts ON refund_intents;
CREATE TRIGGER refund_intents_immutable_facts
  BEFORE UPDATE ON refund_intents
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_guard_operational_update(
    'state', 'stripe_refund_id', 'refund_event_id', 'updated_at',
    'last_error_class', 'last_error_code'
  );
DROP TRIGGER IF EXISTS refund_intents_state_guard ON refund_intents;
CREATE TRIGGER refund_intents_state_guard
  BEFORE UPDATE ON refund_intents
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_guard_state_transition('state');
DROP TRIGGER IF EXISTS refund_intents_insert_guard ON refund_intents;
CREATE TRIGGER refund_intents_insert_guard
  BEFORE INSERT ON refund_intents
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_validate_refund_intent_insert();
DROP TRIGGER IF EXISTS refund_attempts_insert_guard ON refund_attempts;
CREATE TRIGGER refund_attempts_insert_guard
  BEFORE INSERT ON refund_attempts
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_validate_refund_attempt();

DROP TRIGGER IF EXISTS payout_runs_no_delete ON payout_runs;
CREATE TRIGGER payout_runs_no_delete
  BEFORE DELETE ON payout_runs
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_reject_delete();
DROP TRIGGER IF EXISTS payout_runs_immutable_facts ON payout_runs;
CREATE TRIGGER payout_runs_immutable_facts
  BEFORE UPDATE ON payout_runs
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_guard_operational_update(
    'state', 'approved_at', 'approval_admin_id', 'approval_evidence_reference',
    'locked_at', 'submitted_at', 'reconciled_at', 'last_error_code'
  );
DROP TRIGGER IF EXISTS payout_runs_state_guard ON payout_runs;
CREATE TRIGGER payout_runs_state_guard
  BEFORE UPDATE ON payout_runs
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_guard_state_transition('state');

DROP TRIGGER IF EXISTS instructor_payout_batches_no_delete ON instructor_payout_batches;
CREATE TRIGGER instructor_payout_batches_no_delete
  BEFORE DELETE ON instructor_payout_batches
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_reject_delete();
DROP TRIGGER IF EXISTS instructor_payout_batches_immutable_facts ON instructor_payout_batches;
CREATE TRIGGER instructor_payout_batches_immutable_facts
  BEFORE UPDATE ON instructor_payout_batches
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_guard_operational_update(
    'state', 'transfer_submitted_minor', 'submitted_at', 'reconciled_at', 'last_error_code'
  );
DROP TRIGGER IF EXISTS instructor_payout_batches_state_guard ON instructor_payout_batches;
CREATE TRIGGER instructor_payout_batches_state_guard
  BEFORE UPDATE ON instructor_payout_batches
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_guard_state_transition('state');
DROP TRIGGER IF EXISTS instructor_payout_batches_insert_guard ON instructor_payout_batches;
CREATE TRIGGER instructor_payout_batches_insert_guard
  BEFORE INSERT ON instructor_payout_batches
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_validate_batch_insert();

DROP TRIGGER IF EXISTS stripe_launch_booking_earnings_insert_guard
  ON stripe_launch_booking_earnings;
CREATE TRIGGER stripe_launch_booking_earnings_insert_guard
  BEFORE INSERT ON stripe_launch_booking_earnings
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_validate_earning_insert();

DROP TRIGGER IF EXISTS stripe_launch_transfer_intents_no_delete ON stripe_launch_transfer_intents;
CREATE TRIGGER stripe_launch_transfer_intents_no_delete
  BEFORE DELETE ON stripe_launch_transfer_intents
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_reject_delete();
DROP TRIGGER IF EXISTS stripe_launch_transfer_intents_immutable_facts ON stripe_launch_transfer_intents;
CREATE TRIGGER stripe_launch_transfer_intents_immutable_facts
  BEFORE UPDATE ON stripe_launch_transfer_intents
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_guard_operational_update(
    'state', 'stripe_transfer_id', 'submitted_at', 'reconciled_at', 'last_error_code'
  );
DROP TRIGGER IF EXISTS stripe_launch_transfer_intents_state_guard ON stripe_launch_transfer_intents;
CREATE TRIGGER stripe_launch_transfer_intents_state_guard
  BEFORE UPDATE ON stripe_launch_transfer_intents
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_guard_state_transition('state');
DROP TRIGGER IF EXISTS stripe_launch_transfer_intents_insert_guard
  ON stripe_launch_transfer_intents;
CREATE TRIGGER stripe_launch_transfer_intents_insert_guard
  BEFORE INSERT ON stripe_launch_transfer_intents
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_validate_transfer_insert();
DROP TRIGGER IF EXISTS stripe_launch_transfer_attempts_insert_guard ON stripe_launch_transfer_attempts;
CREATE TRIGGER stripe_launch_transfer_attempts_insert_guard
  BEFORE INSERT ON stripe_launch_transfer_attempts
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_validate_transfer_attempt();

DROP TRIGGER IF EXISTS payment_disputes_no_delete ON payment_disputes;
CREATE TRIGGER payment_disputes_no_delete
  BEFORE DELETE ON payment_disputes
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_reject_delete();
DROP TRIGGER IF EXISTS payment_disputes_immutable_facts ON payment_disputes;
CREATE TRIGGER payment_disputes_immutable_facts
  BEFORE UPDATE ON payment_disputes
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_guard_operational_update(
    'current_state', 'final_principal_lost_minor', 'response_deadline',
    'current_fingerprint', 'terminal_at', 'updated_at'
  );
DROP TRIGGER IF EXISTS payment_disputes_state_guard ON payment_disputes;
CREATE TRIGGER payment_disputes_state_guard
  BEFORE UPDATE ON payment_disputes
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_guard_state_transition('current_state');

DROP TRIGGER IF EXISTS financial_job_occurrences_no_delete ON financial_job_occurrences;
CREATE TRIGGER financial_job_occurrences_no_delete
  BEFORE DELETE ON financial_job_occurrences
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_reject_delete();
DROP TRIGGER IF EXISTS financial_job_occurrences_immutable_facts ON financial_job_occurrences;
CREATE TRIGGER financial_job_occurrences_immutable_facts
  BEFORE UPDATE ON financial_job_occurrences
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_guard_operational_update(
    'state', 'lease_owner', 'lease_expires_at', 'attempt_count', 'started_at',
    'completed_at', 'result_fingerprint', 'error_code', 'updated_at'
  );
DROP TRIGGER IF EXISTS financial_job_occurrences_state_guard ON financial_job_occurrences;
CREATE TRIGGER financial_job_occurrences_state_guard
  BEFORE UPDATE ON financial_job_occurrences
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_guard_state_transition('state');

DROP TRIGGER IF EXISTS obligation_applications_insert_guard
  ON instructor_payout_obligation_applications;
CREATE TRIGGER obligation_applications_insert_guard
  BEFORE INSERT ON instructor_payout_obligation_applications
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_validate_obligation_application();
DROP TRIGGER IF EXISTS obligations_insert_guard ON instructor_payout_obligations;
CREATE TRIGGER obligations_insert_guard
  BEFORE INSERT ON instructor_payout_obligations
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_validate_obligation_insert();
DROP TRIGGER IF EXISTS payout_dispositions_insert_guard ON payout_batch_earning_dispositions;
CREATE TRIGGER payout_dispositions_insert_guard
  BEFORE INSERT ON payout_batch_earning_dispositions
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_validate_disposition_link();

-- Deferred cross-row integrity. Parent and child rows may be inserted in either
-- order inside one transaction, but commit fails unless exact pence conserves.
DROP TRIGGER IF EXISTS lesson_contract_completion_guard ON lesson_payment_contracts;
CREATE CONSTRAINT TRIGGER lesson_contract_completion_guard
  AFTER INSERT OR UPDATE ON lesson_payment_contracts
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_validate_contract_completion();
DROP TRIGGER IF EXISTS lesson_booking_contract_completion_guard ON lesson_bookings;
CREATE CONSTRAINT TRIGGER lesson_booking_contract_completion_guard
  AFTER INSERT OR UPDATE OF lesson_payment_contract_id, status ON lesson_bookings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_validate_contract_completion();

DROP TRIGGER IF EXISTS launch_earning_disposition_totals_guard ON stripe_launch_booking_earnings;
CREATE CONSTRAINT TRIGGER launch_earning_disposition_totals_guard
  AFTER INSERT ON stripe_launch_booking_earnings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_validate_earning_dispositions();
DROP TRIGGER IF EXISTS launch_disposition_earning_totals_guard ON payout_batch_earning_dispositions;
CREATE CONSTRAINT TRIGGER launch_disposition_earning_totals_guard
  AFTER INSERT ON payout_batch_earning_dispositions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_validate_earning_dispositions();

DROP TRIGGER IF EXISTS launch_transfer_totals_guard ON stripe_launch_transfer_intents;
CREATE CONSTRAINT TRIGGER launch_transfer_totals_guard
  AFTER INSERT ON stripe_launch_transfer_intents
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_validate_transfer_total();
DROP TRIGGER IF EXISTS launch_disposition_transfer_totals_guard ON payout_batch_earning_dispositions;
CREATE CONSTRAINT TRIGGER launch_disposition_transfer_totals_guard
  AFTER INSERT ON payout_batch_earning_dispositions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_validate_transfer_total();

DROP TRIGGER IF EXISTS launch_batch_totals_guard ON instructor_payout_batches;
CREATE CONSTRAINT TRIGGER launch_batch_totals_guard
  AFTER INSERT ON instructor_payout_batches
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_validate_batch_totals();
DROP TRIGGER IF EXISTS launch_earning_batch_totals_guard ON stripe_launch_booking_earnings;
CREATE CONSTRAINT TRIGGER launch_earning_batch_totals_guard
  AFTER INSERT ON stripe_launch_booking_earnings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_validate_batch_totals();
DROP TRIGGER IF EXISTS launch_disposition_batch_totals_guard ON payout_batch_earning_dispositions;
CREATE CONSTRAINT TRIGGER launch_disposition_batch_totals_guard
  AFTER INSERT ON payout_batch_earning_dispositions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_validate_batch_totals();
DROP TRIGGER IF EXISTS launch_obligation_batch_totals_guard ON instructor_payout_obligations;
CREATE CONSTRAINT TRIGGER launch_obligation_batch_totals_guard
  AFTER INSERT ON instructor_payout_obligations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_validate_batch_totals();
DROP TRIGGER IF EXISTS launch_application_batch_totals_guard
  ON instructor_payout_obligation_applications;
CREATE CONSTRAINT TRIGGER launch_application_batch_totals_guard
  AFTER INSERT ON instructor_payout_obligation_applications
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_validate_batch_totals();

DROP TRIGGER IF EXISTS launch_run_totals_guard ON payout_runs;
CREATE CONSTRAINT TRIGGER launch_run_totals_guard
  AFTER INSERT OR UPDATE ON payout_runs
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_validate_run_totals();
DROP TRIGGER IF EXISTS launch_batch_run_totals_guard ON instructor_payout_batches;
CREATE CONSTRAINT TRIGGER launch_batch_run_totals_guard
  AFTER INSERT ON instructor_payout_batches
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION stripe_launch_validate_run_totals();
