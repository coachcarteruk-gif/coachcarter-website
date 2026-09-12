-- Authoritative lesson payout evidence for the controlled Simon route.
-- Additive and inert: creates no evidence, approval, payout, or transfer rows.

CREATE TABLE IF NOT EXISTS payout_direct_evidence_observations (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  instructor_id INTEGER NOT NULL,
  booking_id INTEGER NOT NULL,
  evidence_status TEXT NOT NULL,
  evidence_json JSONB NOT NULL,
  evidence_fingerprint TEXT NOT NULL,
  observed_by_admin_id INTEGER NOT NULL REFERENCES admin_users(id),
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, booking_id, evidence_fingerprint),
  FOREIGN KEY (instructor_id, school_id) REFERENCES instructors(id, school_id),
  FOREIGN KEY (booking_id, school_id) REFERENCES lesson_bookings(id, school_id),
  CHECK (evidence_status IN ('pending','complete','contradictory')),
  CHECK (jsonb_typeof(evidence_json) = 'object'),
  CHECK (evidence_fingerprint ~ '^sha256:[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_payout_direct_evidence_latest
  ON payout_direct_evidence_observations(school_id, booking_id, observed_at DESC, id DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_direct_evidence_terminal
  ON payout_direct_evidence_observations(school_id, booking_id)
  WHERE evidence_status IN ('complete','contradictory');

CREATE TABLE IF NOT EXISTS payout_flexible_source_evidence (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  source_id BIGINT NOT NULL,
  evidence_status TEXT NOT NULL,
  evidence_json JSONB NOT NULL,
  evidence_fingerprint TEXT NOT NULL,
  observed_by_admin_id INTEGER NOT NULL REFERENCES admin_users(id),
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, source_id, evidence_fingerprint),
  FOREIGN KEY (source_id, school_id)
    REFERENCES flexible_package_sources(id, school_id),
  CHECK (evidence_status IN ('pending','complete','contradictory')),
  CHECK (jsonb_typeof(evidence_json) = 'object'),
  CHECK (evidence_fingerprint ~ '^sha256:[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_payout_flexible_source_evidence_latest
  ON payout_flexible_source_evidence(school_id, source_id, observed_at DESC, id DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_flexible_source_terminal
  ON payout_flexible_source_evidence(school_id, source_id)
  WHERE evidence_status IN ('complete','contradictory');

CREATE TABLE IF NOT EXISTS payout_funding_basis_events (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  learner_id INTEGER,
  instructor_id INTEGER NOT NULL,
  booking_id INTEGER NOT NULL,
  sequence_no INTEGER NOT NULL,
  supersedes_event_id UUID,
  funding_class TEXT NOT NULL,
  value_semantics TEXT NOT NULL,
  payment_processor TEXT NOT NULL,
  gross_pence INTEGER,
  actual_processing_fee_pence INTEGER,
  net_pence INTEGER,
  final_instructor_payable_pence INTEGER,
  processing_fee_evidence_reference TEXT,
  evidence_reference TEXT NOT NULL,
  reason TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  basis_fingerprint TEXT NOT NULL,
  created_by_admin_id INTEGER NOT NULL REFERENCES admin_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (id, school_id, booking_id, instructor_id),
  UNIQUE (school_id, booking_id, sequence_no),
  UNIQUE (idempotency_key),
  FOREIGN KEY (learner_id, school_id)
    REFERENCES learner_users(id, school_id) ON DELETE SET NULL (learner_id),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  FOREIGN KEY (booking_id, school_id)
    REFERENCES lesson_bookings(id, school_id),
  FOREIGN KEY (supersedes_event_id, school_id, booking_id, instructor_id)
    REFERENCES payout_funding_basis_events(id, school_id, booking_id, instructor_id),
  CHECK (sequence_no > 0),
  CHECK (funding_class IN ('manual','cash','bank','external','legacy','correction')),
  CHECK (value_semantics IN (
    'gross_customer_revenue','net_after_processing','final_instructor_payable'
  )),
  CHECK (payment_processor IN ('none','stripe','external')),
  CHECK (NULLIF(BTRIM(evidence_reference), '') IS NOT NULL),
  CHECK (NULLIF(BTRIM(reason), '') IS NOT NULL),
  CHECK (idempotency_key ~ '^cc-payout-basis-[0-9a-f-]{36}$'),
  CHECK (basis_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (
    (value_semantics = 'gross_customer_revenue'
      AND gross_pence IS NOT NULL AND gross_pence >= 0
      AND actual_processing_fee_pence IS NOT NULL
      AND actual_processing_fee_pence >= 0
      AND actual_processing_fee_pence <= gross_pence
      AND net_pence IS NULL AND final_instructor_payable_pence IS NULL)
    OR
    (value_semantics = 'net_after_processing'
      AND net_pence IS NOT NULL AND net_pence >= 0
      AND gross_pence IS NULL AND actual_processing_fee_pence IS NULL
      AND final_instructor_payable_pence IS NULL)
    OR
    (value_semantics = 'final_instructor_payable'
      AND final_instructor_payable_pence IS NOT NULL
      AND final_instructor_payable_pence >= 0
      AND gross_pence IS NULL AND actual_processing_fee_pence IS NULL
      AND net_pence IS NULL)
  ),
  CHECK (payment_processor <> 'none' OR COALESCE(actual_processing_fee_pence, 0) = 0),
  CHECK (payment_processor <> 'stripe'
    OR value_semantics <> 'gross_customer_revenue'
    OR NULLIF(BTRIM(processing_fee_evidence_reference), '') IS NOT NULL),
  CHECK (COALESCE(actual_processing_fee_pence, 0) = 0
    OR NULLIF(BTRIM(processing_fee_evidence_reference), '') IS NOT NULL),
  CHECK ((sequence_no = 1 AND supersedes_event_id IS NULL)
    OR (sequence_no > 1 AND supersedes_event_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_payout_funding_basis_latest
  ON payout_funding_basis_events(school_id, booking_id, sequence_no DESC, id DESC);

-- The legacy payout columns are non-null and assume every stored value is
-- gross. Keep them as an explicitly documented compatibility projection, and
-- preserve the authoritative nullable dimensions alongside them. In
-- particular, NULL actual_processing_fee_pence means "not represented by this
-- audited net/final basis" and is never silently converted into fee evidence.
ALTER TABLE payout_line_items
  ADD COLUMN IF NOT EXISTS payout_value_semantics TEXT,
  ADD COLUMN IF NOT EXISTS attributable_gross_pence INTEGER,
  ADD COLUMN IF NOT EXISTS actual_processing_fee_pence INTEGER,
  ADD COLUMN IF NOT EXISTS net_attributable_revenue_pence INTEGER,
  ADD COLUMN IF NOT EXISTS payout_calculation_version TEXT,
  ADD COLUMN IF NOT EXISTS funding_evidence_json JSONB;

ALTER TABLE payout_line_items
  DROP CONSTRAINT IF EXISTS payout_line_items_authoritative_semantics_check;
ALTER TABLE payout_line_items
  ADD CONSTRAINT payout_line_items_authoritative_semantics_check CHECK (
    payout_value_semantics IS NULL OR payout_value_semantics IN (
      'gross_customer_revenue','net_after_processing','final_instructor_payable'
    )
  );
ALTER TABLE payout_line_items
  DROP CONSTRAINT IF EXISTS payout_line_items_authoritative_amounts_check;
ALTER TABLE payout_line_items
  ADD CONSTRAINT payout_line_items_authoritative_amounts_check CHECK (
    (attributable_gross_pence IS NULL OR attributable_gross_pence >= 0)
    AND (actual_processing_fee_pence IS NULL OR actual_processing_fee_pence >= 0)
    AND (net_attributable_revenue_pence IS NULL OR net_attributable_revenue_pence >= 0)
    AND (funding_evidence_json IS NULL OR jsonb_typeof(funding_evidence_json) = 'object')
  );

ALTER TABLE instructor_payouts
  ADD COLUMN IF NOT EXISTS payout_calculation_version TEXT,
  ADD COLUMN IF NOT EXISTS payout_value_semantics TEXT,
  ADD COLUMN IF NOT EXISTS authoritative_gross_pence INTEGER,
  ADD COLUMN IF NOT EXISTS authoritative_processing_fee_pence INTEGER,
  ADD COLUMN IF NOT EXISTS authoritative_net_pence INTEGER;

ALTER TABLE instructor_payouts
  DROP CONSTRAINT IF EXISTS instructor_payouts_authoritative_semantics_check;
ALTER TABLE instructor_payouts
  ADD CONSTRAINT instructor_payouts_authoritative_semantics_check CHECK (
    payout_value_semantics IS NULL OR payout_value_semantics IN (
      'gross_customer_revenue','net_after_processing','final_instructor_payable','mixed'
    )
  );
ALTER TABLE instructor_payouts
  DROP CONSTRAINT IF EXISTS instructor_payouts_authoritative_amounts_check;
ALTER TABLE instructor_payouts
  ADD CONSTRAINT instructor_payouts_authoritative_amounts_check CHECK (
    (authoritative_gross_pence IS NULL OR authoritative_gross_pence >= 0)
    AND (authoritative_processing_fee_pence IS NULL OR authoritative_processing_fee_pence >= 0)
    AND (authoritative_net_pence IS NULL OR authoritative_net_pence >= 0)
  );

DROP TRIGGER IF EXISTS payout_flexible_source_evidence_append_only
  ON payout_flexible_source_evidence;
CREATE TRIGGER payout_flexible_source_evidence_append_only
  BEFORE UPDATE OR DELETE ON payout_flexible_source_evidence
  FOR EACH ROW EXECUTE FUNCTION interim_v1_forbid_append_only_change();

DROP TRIGGER IF EXISTS payout_direct_evidence_observations_append_only
  ON payout_direct_evidence_observations;
CREATE TRIGGER payout_direct_evidence_observations_append_only
  BEFORE UPDATE OR DELETE ON payout_direct_evidence_observations
  FOR EACH ROW EXECUTE FUNCTION interim_v1_forbid_append_only_change();

DROP TRIGGER IF EXISTS payout_funding_basis_events_append_only
  ON payout_funding_basis_events;
CREATE TRIGGER payout_funding_basis_events_append_only
  BEFORE UPDATE OR DELETE ON payout_funding_basis_events
  FOR EACH ROW EXECUTE FUNCTION interim_v1_forbid_append_only_change();

DO $restore_authoritative_payout_access$
DECLARE grantee_name TEXT;
BEGIN
  FOR grantee_name IN
    SELECT DISTINCT grantee
      FROM information_schema.role_table_grants
     WHERE table_schema = 'public'
       AND table_name = 'interim_v1_instructor_controls'
       AND privilege_type = 'SELECT'
  LOOP
    EXECUTE format(
      'GRANT SELECT, INSERT ON TABLE public.payout_direct_evidence_observations, public.payout_flexible_source_evidence, public.payout_funding_basis_events TO %I',
      grantee_name
    );
  END LOOP;
END
$restore_authoritative_payout_access$;
