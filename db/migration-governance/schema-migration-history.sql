-- Phase 2 reviewed DDL for the authoritative migration-attempt ledger.
-- This file is an operator artifact, not a numbered migration. It must only be
-- installed by scripts/migration-ledger-rehearsal.js with separate approval.

CREATE TABLE public.schema_migration_history (
  attempt_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  migration_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  checksum CHARACTER(64) NOT NULL,
  checksum_algorithm TEXT NOT NULL DEFAULT 'sha256-lf-v1',
  record_kind TEXT NOT NULL DEFAULT 'execution',
  evidence_kind TEXT NOT NULL DEFAULT 'numbered_execution',
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  executed_at TIMESTAMPTZ,
  duration_ms BIGINT,
  error_code TEXT,
  execution_context JSONB,
  CONSTRAINT schema_migration_history_migration_id_check
    CHECK (migration_id ~ '^[0-9]{3}[a-z]?$'),
  CONSTRAINT schema_migration_history_filename_check
    CHECK (filename ~ '^[0-9]{3}_[a-z0-9_]+[.]sql$'),
  CONSTRAINT schema_migration_history_checksum_check
    CHECK (checksum ~ '^[a-f0-9]{64}$'),
  CONSTRAINT schema_migration_history_checksum_algorithm_check
    CHECK (checksum_algorithm = 'sha256-lf-v1'),
  CONSTRAINT schema_migration_history_status_check
    CHECK (status IN ('running', 'succeeded', 'failed')),
  CONSTRAINT schema_migration_history_record_kind_check
    CHECK (record_kind IN ('baseline', 'execution')),
  CONSTRAINT schema_migration_history_evidence_kind_check
    CHECK (evidence_kind IN (
      'exact_execution',
      'structural_equivalence',
      'intentionally_removed',
      'numbered_execution'
    )),
  CONSTRAINT schema_migration_history_record_evidence_check
    CHECK (
      (record_kind = 'execution' AND evidence_kind = 'numbered_execution')
      OR
      (record_kind = 'baseline' AND evidence_kind IN (
        'exact_execution',
        'structural_equivalence',
        'intentionally_removed'
      ) AND status = 'succeeded')
    ),
  CONSTRAINT schema_migration_history_context_check
    CHECK (execution_context IS NULL OR jsonb_typeof(execution_context) = 'object'),
  CONSTRAINT schema_migration_history_terminal_state_check
    CHECK (
      (
        status = 'running'
        AND executed_at IS NULL
        AND duration_ms IS NULL
        AND error_code IS NULL
      )
      OR
      (
        status = 'succeeded'
        AND executed_at IS NOT NULL
        AND executed_at >= started_at
        AND duration_ms IS NOT NULL
        AND duration_ms >= 0
        AND error_code IS NULL
      )
      OR
      (
        status = 'failed'
        AND executed_at IS NOT NULL
        AND executed_at >= started_at
        AND duration_ms IS NOT NULL
        AND duration_ms >= 0
        AND error_code IS NOT NULL
        AND error_code ~ '^(?:[A-Z0-9]{5}|MIGRATION_ERROR)$'
      )
    )
);

CREATE UNIQUE INDEX schema_migration_history_success_migration_uniq
  ON public.schema_migration_history (migration_id)
  WHERE status = 'succeeded';

CREATE UNIQUE INDEX schema_migration_history_success_filename_uniq
  ON public.schema_migration_history (filename)
  WHERE status = 'succeeded';

CREATE FUNCTION public.guard_schema_migration_history_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'schema_migration_history is append-only';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'schema_migration_history rows cannot be deleted';
  END IF;

  IF TG_OP <> 'UPDATE'
     OR OLD.status <> 'running'
     OR NEW.status NOT IN ('succeeded', 'failed')
     OR NEW.attempt_id IS DISTINCT FROM OLD.attempt_id
     OR NEW.migration_id IS DISTINCT FROM OLD.migration_id
     OR NEW.filename IS DISTINCT FROM OLD.filename
     OR NEW.checksum IS DISTINCT FROM OLD.checksum
     OR NEW.checksum_algorithm IS DISTINCT FROM OLD.checksum_algorithm
     OR NEW.record_kind IS DISTINCT FROM OLD.record_kind
     OR NEW.evidence_kind IS DISTINCT FROM OLD.evidence_kind
     OR NEW.started_at IS DISTINCT FROM OLD.started_at
     OR NEW.execution_context IS DISTINCT FROM OLD.execution_context
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'schema_migration_history permits only running-to-terminal finalization';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER schema_migration_history_guard_update_delete
BEFORE UPDATE OR DELETE ON public.schema_migration_history
FOR EACH ROW
EXECUTE FUNCTION public.guard_schema_migration_history_append_only();

CREATE TRIGGER schema_migration_history_guard_truncate
BEFORE TRUNCATE ON public.schema_migration_history
FOR EACH STATEMENT
EXECUTE FUNCTION public.guard_schema_migration_history_append_only();

REVOKE ALL ON TABLE public.schema_migration_history FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.schema_migration_history_attempt_id_seq FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_schema_migration_history_append_only() FROM PUBLIC;

COMMENT ON TABLE public.schema_migration_history IS
  'Append-only migration execution and reviewed historical-baseline receipts.';
COMMENT ON COLUMN public.schema_migration_history.executed_at IS
  'Terminal timestamp for this ledger attempt or baseline recording, not an inferred historical timestamp.';
COMMENT ON COLUMN public.schema_migration_history.execution_context IS
  'Optional non-secret repository, target, and evidence metadata.';
