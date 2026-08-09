-- Stripe Connect Simon launch Slice 4: Accounts v2 onboarding readiness.
-- Additive and inert: no account, link, agreement, payout, or provider action
-- is activated by this migration.

CREATE TABLE IF NOT EXISTS connect_v2_account_creation_intents (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  instructor_id INTEGER NOT NULL,
  stripe_mode TEXT NOT NULL,
  configuration_type TEXT NOT NULL,
  dashboard_type TEXT NOT NULL,
  stable_identity TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  state TEXT NOT NULL,
  provider_account_id TEXT,
  connect_scope_id BIGINT,
  last_error_class TEXT,
  created_by_user_id INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (id, school_id),
  UNIQUE (school_id, instructor_id, stripe_mode, configuration_type),
  UNIQUE (stable_identity),
  UNIQUE (idempotency_key),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  FOREIGN KEY (connect_scope_id, school_id)
    REFERENCES payout_v2_connected_account_scopes(id, school_id),
  CHECK (stripe_mode IN ('test', 'live')),
  CHECK (configuration_type = 'recipient'),
  CHECK (dashboard_type = 'express'),
  CHECK (stable_identity ~ '^cc:connect-v2:[0-9]+:[0-9]+:(test|live):recipient$'),
  CHECK (idempotency_key ~ '^cc-connect-v2-[0-9a-f-]{36}$'),
  CHECK (request_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (state IN (
    'planned', 'submitting', 'reconciling', 'succeeded',
    'failed_confirmed', 'manual_review'
  )),
  CHECK (provider_account_id IS NULL OR provider_account_id LIKE 'acct\_%' ESCAPE '\'),
  CHECK (last_error_class IS NULL OR last_error_class IN (
    'invalid_request', 'authentication', 'permission', 'idempotency',
    'network', 'rate_limit', 'api', 'unknown'
  ))
);

CREATE INDEX IF NOT EXISTS idx_connect_v2_creation_intents_school_state
  ON connect_v2_account_creation_intents(school_id, state, updated_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_v2_scope_instructor_owner
  ON payout_v2_connected_account_scopes(school_id, instructor_id)
  WHERE owner_type = 'instructor';
CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_v2_scope_school_owner
  ON payout_v2_connected_account_scopes(school_id, destination_school_id)
  WHERE owner_type = 'school';

CREATE TABLE IF NOT EXISTS connect_v2_account_creation_attempts (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  instructor_id INTEGER NOT NULL,
  intent_id UUID NOT NULL,
  attempt_number INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  provider_account_id TEXT,
  provider_request_id TEXT,
  error_class TEXT,
  evidence_json JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  UNIQUE (id, school_id),
  UNIQUE (school_id, intent_id, attempt_number),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  FOREIGN KEY (intent_id, school_id)
    REFERENCES connect_v2_account_creation_intents(id, school_id),
  CHECK (attempt_number > 0),
  CHECK (outcome IN (
    'provider_succeeded', 'provider_failed_confirmed',
    'provider_ambiguous', 'reconciled_existing', 'reconcile_no_match',
    'reconcile_multiple_matches'
  )),
  CHECK (provider_account_id IS NULL OR provider_account_id LIKE 'acct\_%' ESCAPE '\'),
  CHECK (jsonb_typeof(evidence_json) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_connect_v2_creation_attempts_intent
  ON connect_v2_account_creation_attempts(school_id, intent_id, occurred_at);

CREATE TABLE IF NOT EXISTS connect_v2_account_link_events (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  instructor_id INTEGER NOT NULL,
  connect_scope_id BIGINT NOT NULL,
  stripe_account_id TEXT NOT NULL,
  action TEXT NOT NULL,
  state_fingerprint TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  evidence_json JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  UNIQUE (id, school_id),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  FOREIGN KEY (connect_scope_id, school_id)
    REFERENCES payout_v2_connected_account_scopes(id, school_id),
  CHECK (stripe_account_id LIKE 'acct\_%' ESCAPE '\'),
  CHECK (action IN ('created', 'refresh_validated', 'return_validated')),
  CHECK (state_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (jsonb_typeof(evidence_json) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_connect_v2_link_events_scope
  ON connect_v2_account_link_events(school_id, connect_scope_id, occurred_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_connect_v2_link_event_state_action
  ON connect_v2_account_link_events(school_id, state_fingerprint, action);

CREATE OR REPLACE FUNCTION connect_v2_forbid_append_only_change()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is forbidden', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION connect_v2_guard_creation_intent_update()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'connect account creation intents cannot be deleted'
      USING ERRCODE = '55000';
  END IF;
  IF to_jsonb(OLD) - ARRAY[
      'state', 'provider_account_id', 'connect_scope_id',
      'last_error_class', 'updated_at'
    ]::text[]
    <> to_jsonb(NEW) - ARRAY[
      'state', 'provider_account_id', 'connect_scope_id',
      'last_error_class', 'updated_at'
    ]::text[]
  THEN
    RAISE EXCEPTION 'connect account creation identity is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF OLD.provider_account_id IS NOT NULL
    AND OLD.provider_account_id IS DISTINCT FROM NEW.provider_account_id
  THEN
    RAISE EXCEPTION 'connect provider account identity cannot be replaced'
      USING ERRCODE = '55000';
  END IF;
  IF OLD.connect_scope_id IS NOT NULL
    AND OLD.connect_scope_id IS DISTINCT FROM NEW.connect_scope_id
  THEN
    RAISE EXCEPTION 'connect account scope cannot be replaced'
      USING ERRCODE = '55000';
  END IF;
  IF NOT (
    OLD.state = NEW.state
    OR (OLD.state = 'planned' AND NEW.state = 'submitting')
    OR (OLD.state = 'submitting' AND NEW.state IN ('planned', 'reconciling', 'succeeded', 'failed_confirmed', 'manual_review'))
    OR (OLD.state = 'reconciling' AND NEW.state IN ('succeeded', 'manual_review'))
  ) THEN
    RAISE EXCEPTION 'invalid connect account creation state transition'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS connect_v2_creation_intents_guard
  ON connect_v2_account_creation_intents;
CREATE TRIGGER connect_v2_creation_intents_guard
  BEFORE UPDATE OR DELETE ON connect_v2_account_creation_intents
  FOR EACH ROW EXECUTE FUNCTION connect_v2_guard_creation_intent_update();

DROP TRIGGER IF EXISTS connect_v2_creation_attempts_append_only
  ON connect_v2_account_creation_attempts;
CREATE TRIGGER connect_v2_creation_attempts_append_only
  BEFORE UPDATE OR DELETE ON connect_v2_account_creation_attempts
  FOR EACH ROW EXECUTE FUNCTION connect_v2_forbid_append_only_change();

DROP TRIGGER IF EXISTS connect_v2_link_events_append_only
  ON connect_v2_account_link_events;
CREATE TRIGGER connect_v2_link_events_append_only
  BEFORE UPDATE OR DELETE ON connect_v2_account_link_events
  FOR EACH ROW EXECUTE FUNCTION connect_v2_forbid_append_only_change();

-- Once accepted, the commercial and acceptance facts of a draft are frozen.
-- Approval may only fill the approval/linkage fields and move draft -> active.
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
    ELSIF OLD.accepted_at IS NOT NULL THEN
      IF to_jsonb(OLD) - ARRAY[
          'status', 'connect_scope_id', 'stripe_configuration_id',
          'approved_by_admin_id', 'approved_at'
        ]::text[]
        <> to_jsonb(NEW) - ARRAY[
          'status', 'connect_scope_id', 'stripe_configuration_id',
          'approved_by_admin_id', 'approved_at'
        ]::text[]
      THEN
        RAISE EXCEPTION 'accepted payout agreement facts are immutable'
          USING ERRCODE = '55000';
      END IF;
      IF NEW.status NOT IN ('draft', 'active') THEN
        RAISE EXCEPTION 'invalid accepted agreement state transition'
          USING ERRCODE = '23514';
      END IF;
    ELSIF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'unaccepted payout agreement cannot be activated'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
