-- Full Curriculum consumer-rights, withdrawal and manual-refund evidence.
--
-- This migration is additive and inert. It does not enable purchasing, issue
-- a refund, call Stripe, create Lesson Credit, or change payout behaviour.

CREATE TABLE IF NOT EXISTS full_curriculum_consumer_contract_evidence (
  id                              BIGSERIAL PRIMARY KEY,
  school_id                       INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  attempt_id                      UUID NOT NULL,
  learner_id                      INTEGER,
  customer_terms_version          TEXT NOT NULL,
  policy_version                  TEXT NOT NULL,
  disclosure_version              TEXT NOT NULL,
  refund_calculation_version      TEXT NOT NULL,
  disclosure_snapshot             JSONB NOT NULL,
  disclosure_sha256               TEXT NOT NULL,
  checkout_acknowledgement_sha256 TEXT NOT NULL,
  early_start_requested           BOOLEAN NOT NULL,
  start_request_text              TEXT NOT NULL,
  start_request_sha256            TEXT NOT NULL,
  actor_type                      TEXT NOT NULL DEFAULT 'learner',
  actor_id                        INTEGER,
  acknowledged_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, attempt_id),
  FOREIGN KEY (attempt_id, school_id)
    REFERENCES package_purchase_attempts(id, school_id),
  FOREIGN KEY (learner_id, school_id)
    REFERENCES learner_users(id, school_id) ON DELETE SET NULL (learner_id),
  CHECK (jsonb_typeof(disclosure_snapshot) = 'object'),
  CHECK (disclosure_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (checkout_acknowledgement_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (start_request_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (actor_type = 'learner'),
  CHECK (char_length(BTRIM(customer_terms_version)) BETWEEN 1 AND 120),
  CHECK (char_length(BTRIM(policy_version)) BETWEEN 1 AND 120),
  CHECK (char_length(BTRIM(disclosure_version)) BETWEEN 1 AND 120),
  CHECK (char_length(BTRIM(refund_calculation_version)) BETWEEN 1 AND 120),
  CHECK (char_length(BTRIM(start_request_text)) BETWEEN 20 AND 4000)
);

CREATE INDEX IF NOT EXISTS idx_full_curriculum_contract_evidence_learner
  ON full_curriculum_consumer_contract_evidence(school_id, learner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS full_curriculum_contract_events (
  id                  BIGSERIAL PRIMARY KEY,
  school_id           INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  attempt_id          UUID NOT NULL,
  purchase_id         BIGINT,
  enrolment_id        BIGINT,
  event_type          TEXT NOT NULL,
  actor_type          TEXT NOT NULL,
  actor_id            INTEGER,
  detail              JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at         TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  FOREIGN KEY (attempt_id, school_id)
    REFERENCES package_purchase_attempts(id, school_id),
  FOREIGN KEY (purchase_id, school_id)
    REFERENCES learner_package_purchases(id, school_id),
  FOREIGN KEY (enrolment_id, school_id)
    REFERENCES full_curriculum_enrolments(id, school_id),
  CHECK (event_type IN (
    'checkout_evidence_recorded', 'contract_formed',
    'durable_confirmation_queued', 'durable_confirmation_delivered',
    'durable_confirmation_failed', 'cooling_off_hold_released'
  )),
  CHECK (actor_type IN ('learner', 'system', 'admin', 'superadmin', 'instructor_admin')),
  CHECK (jsonb_typeof(detail) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_full_curriculum_contract_events_attempt
  ON full_curriculum_contract_events(school_id, attempt_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_full_curriculum_contract_formed_event
  ON full_curriculum_contract_events(school_id, attempt_id, event_type)
  WHERE event_type IN ('checkout_evidence_recorded', 'contract_formed');

ALTER TABLE full_curriculum_enrolments
  ADD COLUMN IF NOT EXISTS early_start_requested BOOLEAN,
  ADD COLUMN IF NOT EXISTS contract_formed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cooling_off_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS service_may_start_at TIMESTAMPTZ;

ALTER TABLE full_curriculum_enrolments
  DROP CONSTRAINT IF EXISTS full_curriculum_enrolments_status_check;
ALTER TABLE full_curriculum_enrolments
  ADD CONSTRAINT full_curriculum_enrolments_status_check
  CHECK (status IN (
    'cooling_off_hold', 'paid_matching', 'active', 'assessment_pending',
    'retake_pending', 'retake_active', 'completed', 'withdrawn'
  ));

DROP INDEX IF EXISTS uq_full_curriculum_active_learner;
CREATE UNIQUE INDEX uq_full_curriculum_active_learner
  ON full_curriculum_enrolments(school_id, learner_id)
  WHERE learner_id IS NOT NULL
    AND status IN (
      'cooling_off_hold', 'paid_matching', 'active', 'assessment_pending',
      'retake_pending', 'retake_active'
    );

DO $$ BEGIN
  ALTER TABLE full_curriculum_enrolments
    ADD CONSTRAINT full_curriculum_enrolments_consumer_timing_check
    CHECK (
      (contract_formed_at IS NULL AND cooling_off_expires_at IS NULL AND service_may_start_at IS NULL)
      OR
      (contract_formed_at IS NOT NULL AND cooling_off_expires_at IS NOT NULL
       AND service_may_start_at IS NOT NULL
       AND cooling_off_expires_at > contract_formed_at
       AND service_may_start_at >= contract_formed_at)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE full_curriculum_enrolments
    ADD CONSTRAINT full_curriculum_enrolments_cooling_hold_check
    CHECK (status <> 'cooling_off_hold' OR (
      early_start_requested = FALSE
      AND programme_start_at IS NULL
      AND service_may_start_at = cooling_off_expires_at
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE full_curriculum_progress_events
  DROP CONSTRAINT IF EXISTS full_curriculum_progress_events_actor_type_check;
ALTER TABLE full_curriculum_progress_events
  ADD CONSTRAINT full_curriculum_progress_events_actor_type_check
  CHECK (actor_type IN (
    'system', 'learner', 'admin', 'superadmin', 'instructor', 'instructor_admin'
  ));

CREATE TABLE IF NOT EXISTS full_curriculum_termination_requests (
  id                    UUID PRIMARY KEY,
  school_id             INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  enrolment_id          BIGINT NOT NULL,
  learner_id            INTEGER,
  request_kind          TEXT NOT NULL,
  channel               TEXT NOT NULL,
  reason                TEXT,
  actor_type            TEXT NOT NULL,
  actor_id              INTEGER,
  received_at           TIMESTAMPTZ NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, enrolment_id, id),
  FOREIGN KEY (enrolment_id, school_id)
    REFERENCES full_curriculum_enrolments(id, school_id),
  FOREIGN KEY (learner_id, school_id)
    REFERENCES learner_users(id, school_id) ON DELETE SET NULL (learner_id),
  CHECK (request_kind IN (
    'learner_cancellation', 'matching_failure', 'provider_nonfulfilment'
  )),
  CHECK (channel IN ('self_service', 'email', 'post', 'phone', 'admin_recorded')),
  CHECK (actor_type IN ('learner', 'admin', 'superadmin', 'instructor_admin')),
  CHECK (reason IS NULL OR char_length(BTRIM(reason)) BETWEEN 2 AND 1000)
);

CREATE INDEX IF NOT EXISTS idx_full_curriculum_termination_enrolment
  ON full_curriculum_termination_requests(school_id, enrolment_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_full_curriculum_termination_learner
  ON full_curriculum_termination_requests(school_id, learner_id, received_at DESC);

CREATE TABLE IF NOT EXISTS full_curriculum_refund_cases (
  id                         UUID PRIMARY KEY,
  school_id                  INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  enrolment_id               BIGINT NOT NULL,
  purchase_id                BIGINT NOT NULL,
  learner_id                 INTEGER,
  termination_request_id     UUID NOT NULL,
  classification             TEXT NOT NULL,
  status                     TEXT NOT NULL DEFAULT 'calculated',
  calculation_version        TEXT NOT NULL,
  calculation_fingerprint    TEXT NOT NULL,
  calculation_snapshot       JSONB NOT NULL,
  original_payment_pence     INTEGER NOT NULL,
  previous_refund_pence      INTEGER NOT NULL DEFAULT 0,
  deduction_pence            INTEGER NOT NULL DEFAULT 0,
  refund_due_pence           INTEGER NOT NULL,
  stripe_fee_absorbed_pence  INTEGER,
  reviewed_by_admin_id       INTEGER,
  reviewed_at                TIMESTAMPTZ,
  approved_by_admin_id       INTEGER,
  approved_at                TIMESTAMPTZ,
  provider_refund_id         TEXT,
  provider_status            TEXT,
  provider_recorded_at       TIMESTAMPTZ,
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, termination_request_id),
  UNIQUE (school_id, calculation_fingerprint),
  UNIQUE (provider_refund_id),
  FOREIGN KEY (enrolment_id, school_id)
    REFERENCES full_curriculum_enrolments(id, school_id),
  FOREIGN KEY (purchase_id, school_id)
    REFERENCES learner_package_purchases(id, school_id),
  FOREIGN KEY (termination_request_id, school_id)
    REFERENCES full_curriculum_termination_requests(id, school_id),
  FOREIGN KEY (learner_id, school_id)
    REFERENCES learner_users(id, school_id) ON DELETE SET NULL (learner_id),
  CHECK (classification IN (
    'cooling_off_cancellation', 'voluntary_withdrawal',
    'matching_failure', 'provider_nonfulfilment'
  )),
  CHECK (status IN (
    'calculated', 'manual_review', 'reviewed', 'approved', 'rejected',
    'provider_succeeded', 'provider_failed'
  )),
  CHECK (calculation_fingerprint ~ '^[0-9a-f]{64}$'),
  CHECK (jsonb_typeof(calculation_snapshot) = 'object'),
  CHECK (original_payment_pence > 0),
  CHECK (previous_refund_pence BETWEEN 0 AND original_payment_pence),
  CHECK (deduction_pence BETWEEN 0 AND original_payment_pence - previous_refund_pence),
  CHECK (refund_due_pence = original_payment_pence - previous_refund_pence - deduction_pence),
  CHECK (stripe_fee_absorbed_pence IS NULL OR stripe_fee_absorbed_pence >= 0),
  CHECK (approved_by_admin_id IS NULL OR reviewed_by_admin_id IS DISTINCT FROM approved_by_admin_id),
  CHECK (provider_refund_id IS NULL OR provider_refund_id ~ '^re_[A-Za-z0-9_]+$'),
  CHECK (provider_status IS NULL OR provider_status IN ('succeeded', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_full_curriculum_refund_cases_queue
  ON full_curriculum_refund_cases(school_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_full_curriculum_refund_cases_learner
  ON full_curriculum_refund_cases(school_id, learner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS full_curriculum_refund_lines (
  id                 BIGSERIAL PRIMARY KEY,
  school_id          INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  refund_case_id     UUID NOT NULL,
  line_number        INTEGER NOT NULL,
  line_type          TEXT NOT NULL,
  quantity           INTEGER NOT NULL,
  unit_value_pence   INTEGER,
  cap_pence          INTEGER NOT NULL,
  deduction_pence    INTEGER NOT NULL,
  evidence_snapshot  JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, refund_case_id, line_number),
  FOREIGN KEY (refund_case_id, school_id)
    REFERENCES full_curriculum_refund_cases(id, school_id),
  CHECK (line_number > 0),
  CHECK (line_type IN (
    'base_teaching', 'retake_teaching', 'completed_assessment',
    'matching_admin', 'stripe_fee', 'corrective_adjustment'
  )),
  CHECK (quantity >= 0),
  CHECK (unit_value_pence IS NULL OR unit_value_pence >= 0),
  CHECK (cap_pence >= 0),
  CHECK (deduction_pence >= 0),
  CHECK (jsonb_typeof(evidence_snapshot) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_full_curriculum_refund_lines_case
  ON full_curriculum_refund_lines(school_id, refund_case_id, line_number);

CREATE TABLE IF NOT EXISTS full_curriculum_refund_case_events (
  id                 BIGSERIAL PRIMARY KEY,
  school_id          INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  refund_case_id     UUID NOT NULL,
  from_status        TEXT,
  to_status          TEXT NOT NULL,
  actor_type         TEXT NOT NULL,
  actor_id           INTEGER,
  detail             JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  FOREIGN KEY (refund_case_id, school_id)
    REFERENCES full_curriculum_refund_cases(id, school_id),
  CHECK (actor_type IN ('learner', 'system', 'admin', 'superadmin', 'instructor_admin')),
  CHECK (jsonb_typeof(detail) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_full_curriculum_refund_case_events_case
  ON full_curriculum_refund_case_events(school_id, refund_case_id, id);

CREATE OR REPLACE FUNCTION guard_full_curriculum_consumer_identity()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% is retained consumer/financial evidence', TG_TABLE_NAME
      USING ERRCODE = '55000';
  END IF;
  IF NEW IS DISTINCT FROM OLD THEN
    IF OLD.learner_id IS NOT NULL AND NEW.learner_id IS NULL THEN
      NEW := OLD;
      NEW.learner_id := NULL;
      IF OLD.actor_type = 'learner' THEN
        NEW.actor_id := NULL;
      END IF;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION '% evidence is immutable', TG_TABLE_NAME
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_full_curriculum_contract_evidence_immutable
  ON full_curriculum_consumer_contract_evidence;
CREATE TRIGGER trg_full_curriculum_contract_evidence_immutable
BEFORE UPDATE OR DELETE ON full_curriculum_consumer_contract_evidence
FOR EACH ROW EXECUTE FUNCTION guard_full_curriculum_consumer_identity();

DROP TRIGGER IF EXISTS trg_full_curriculum_termination_immutable
  ON full_curriculum_termination_requests;
CREATE TRIGGER trg_full_curriculum_termination_immutable
BEFORE UPDATE OR DELETE ON full_curriculum_termination_requests
FOR EACH ROW EXECUTE FUNCTION guard_full_curriculum_consumer_identity();

CREATE OR REPLACE FUNCTION guard_full_curriculum_refund_case_change()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Full Curriculum refund cases are retained financial evidence'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.school_id IS DISTINCT FROM OLD.school_id
     OR (NEW.learner_id IS DISTINCT FROM OLD.learner_id
         AND NOT (OLD.learner_id IS NOT NULL AND NEW.learner_id IS NULL))
     OR NEW.enrolment_id IS DISTINCT FROM OLD.enrolment_id
     OR NEW.purchase_id IS DISTINCT FROM OLD.purchase_id
     OR NEW.termination_request_id IS DISTINCT FROM OLD.termination_request_id
     OR NEW.classification IS DISTINCT FROM OLD.classification
     OR NEW.calculation_version IS DISTINCT FROM OLD.calculation_version
     OR NEW.calculation_fingerprint IS DISTINCT FROM OLD.calculation_fingerprint
     OR NEW.calculation_snapshot IS DISTINCT FROM OLD.calculation_snapshot
     OR NEW.original_payment_pence IS DISTINCT FROM OLD.original_payment_pence
     OR NEW.previous_refund_pence IS DISTINCT FROM OLD.previous_refund_pence
     OR NEW.deduction_pence IS DISTINCT FROM OLD.deduction_pence
     OR NEW.refund_due_pence IS DISTINCT FROM OLD.refund_due_pence
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Full Curriculum refund calculation evidence is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status IN ('calculated', 'manual_review') AND NEW.status IN ('reviewed', 'rejected'))
    OR (OLD.status = 'reviewed' AND NEW.status IN ('approved', 'rejected'))
    OR (OLD.status = 'approved' AND NEW.status IN ('provider_succeeded', 'provider_failed'))
    OR (OLD.status = 'provider_failed' AND NEW.status = 'provider_succeeded')
  ) THEN
    RAISE EXCEPTION 'Invalid Full Curriculum refund case transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;
  IF NEW.approved_by_admin_id IS NOT NULL
     AND NEW.approved_by_admin_id = NEW.reviewed_by_admin_id THEN
    RAISE EXCEPTION 'Full Curriculum refund approval requires a second admin'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_full_curriculum_refund_case_change
  ON full_curriculum_refund_cases;
CREATE TRIGGER trg_guard_full_curriculum_refund_case_change
BEFORE UPDATE OR DELETE ON full_curriculum_refund_cases
FOR EACH ROW EXECUTE FUNCTION guard_full_curriculum_refund_case_change();

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'full_curriculum_contract_events',
    'full_curriculum_refund_lines',
    'full_curriculum_refund_case_events'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_append_only ON %I', table_name, table_name);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_full_curriculum_evidence_change()',
      table_name,
      table_name
    );
  END LOOP;
END $$;
