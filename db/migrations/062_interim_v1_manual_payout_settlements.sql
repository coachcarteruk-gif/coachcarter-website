-- Append-only record of a payout made outside CoachCarter.
--
-- Additive and inert: this migration records no settlement, evidence, approval,
-- payout, transfer, refund, or audit row. The dedicated superadmin operation is
-- the only application writer. Coverage rows deliberately contain no money
-- columns: they are duplicate-claim guards, not zero-value payout lines.

CREATE TABLE IF NOT EXISTS interim_v1_manual_payout_settlements (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  instructor_id INTEGER NOT NULL,
  manual_settlement_boundary_id UUID NOT NULL,
  period_start_at TIMESTAMPTZ NOT NULL,
  period_end_at TIMESTAMPTZ NOT NULL,
  time_zone TEXT NOT NULL DEFAULT 'Europe/London',
  authoritative_earning_pence INTEGER NOT NULL,
  franchise_fee_deducted_pence INTEGER NOT NULL,
  bank_payment_pence INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'gbp',
  paid_local_date DATE NOT NULL,
  bank_reference TEXT NOT NULL,
  covered_booking_count INTEGER NOT NULL,
  evidence_reference TEXT NOT NULL,
  reason TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  settlement_fingerprint TEXT NOT NULL,
  created_by_admin_id INTEGER NOT NULL REFERENCES admin_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (id, school_id, instructor_id),
  UNIQUE (school_id, instructor_id, period_start_at, period_end_at),
  UNIQUE (idempotency_key),
  UNIQUE (settlement_fingerprint),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  FOREIGN KEY (manual_settlement_boundary_id, school_id)
    REFERENCES interim_v1_manual_settlement_boundaries(id, school_id),
  CHECK (time_zone = 'Europe/London'),
  CHECK (currency = 'gbp'),
  CHECK (period_end_at > period_start_at),
  CHECK (authoritative_earning_pence > 0),
  CHECK (franchise_fee_deducted_pence >= 0),
  CHECK (bank_payment_pence > 0),
  CHECK (authoritative_earning_pence - franchise_fee_deducted_pence = bank_payment_pence),
  CHECK (covered_booking_count > 0),
  CHECK (NULLIF(BTRIM(bank_reference), '') IS NOT NULL),
  CHECK (NULLIF(BTRIM(evidence_reference), '') IS NOT NULL),
  CHECK (NULLIF(BTRIM(reason), '') IS NOT NULL),
  CHECK (idempotency_key ~ '^cc-interim-v1-manual-settlement-[0-9a-f-]{36}$'),
  CHECK (settlement_fingerprint ~ '^sha256:[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_interim_v1_manual_payout_settlement_scope
  ON interim_v1_manual_payout_settlements(
    school_id, instructor_id, period_start_at, period_end_at
  );

CREATE TABLE IF NOT EXISTS interim_v1_manual_payout_settlement_bookings (
  settlement_id UUID NOT NULL,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  instructor_id INTEGER NOT NULL,
  booking_id INTEGER NOT NULL,
  booking_ends_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (settlement_id, booking_id),
  UNIQUE (school_id, booking_id),
  FOREIGN KEY (settlement_id, school_id, instructor_id)
    REFERENCES interim_v1_manual_payout_settlements(id, school_id, instructor_id),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  FOREIGN KEY (booking_id, school_id)
    REFERENCES lesson_bookings(id, school_id)
);

CREATE INDEX IF NOT EXISTS idx_interim_v1_manual_payout_booking_scope
  ON interim_v1_manual_payout_settlement_bookings(
    school_id, instructor_id, booking_ends_at, booking_id
  );

CREATE OR REPLACE FUNCTION interim_v1_validate_manual_payout_settlement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  boundary_row interim_v1_manual_settlement_boundaries%ROWTYPE;
  instructor_paused BOOLEAN;
BEGIN
  PERFORM pg_advisory_xact_lock(NEW.school_id, NEW.instructor_id);

  SELECT * INTO boundary_row
    FROM interim_v1_manual_settlement_boundaries
   WHERE id = NEW.manual_settlement_boundary_id
     AND school_id = NEW.school_id
     AND instructor_id = NEW.instructor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'manual payout settlement boundary scope mismatch'
      USING ERRCODE = '23514';
  END IF;

  SELECT payouts_paused INTO instructor_paused
    FROM instructors
   WHERE id = NEW.instructor_id AND school_id = NEW.school_id;
  IF instructor_paused IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'manual payout settlement requires paused instructor'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.period_start_at IS DISTINCT FROM boundary_row.settled_before_at
     OR NEW.period_end_at IS DISTINCT FROM boundary_row.first_system_period_end_at
     OR NEW.time_zone IS DISTINCT FROM boundary_row.time_zone THEN
    RAISE EXCEPTION 'manual payout settlement must cover the exact boundary interval'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION interim_v1_guard_manual_payout_booking_claim()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  settlement_row interim_v1_manual_payout_settlements%ROWTYPE;
  booking_end TIMESTAMPTZ;
  booking_matches BOOLEAN;
BEGIN
  PERFORM pg_advisory_xact_lock(NEW.school_id, NEW.booking_id);

  SELECT * INTO settlement_row
    FROM interim_v1_manual_payout_settlements
   WHERE id = NEW.settlement_id
     AND school_id = NEW.school_id
     AND instructor_id = NEW.instructor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'manual payout settlement booking scope mismatch'
      USING ERRCODE = '23514';
  END IF;

  SELECT ((lb.scheduled_date + lb.end_time) AT TIME ZONE settlement_row.time_zone),
         lb.instructor_id = NEW.instructor_id
           AND lb.status = 'chargeable'
           AND COALESCE(lu.is_test_account, FALSE) = FALSE
    INTO booking_end, booking_matches
    FROM lesson_bookings lb
    JOIN learner_users lu
      ON lu.id = lb.learner_id AND lu.school_id = lb.school_id
   WHERE lb.id = NEW.booking_id AND lb.school_id = NEW.school_id;

  IF NOT FOUND OR booking_matches IS DISTINCT FROM TRUE
     OR booking_end < settlement_row.period_start_at
     OR booking_end >= settlement_row.period_end_at
     OR NEW.booking_ends_at IS DISTINCT FROM booking_end THEN
    RAISE EXCEPTION 'booking is not a chargeable obligation in the settlement interval'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM payout_line_items
     WHERE school_id = NEW.school_id AND booking_id = NEW.booking_id
  ) OR EXISTS (
    SELECT 1
      FROM school_payout_line_items spli
      JOIN school_payouts sp ON sp.id = spli.school_payout_id
     WHERE sp.school_id = NEW.school_id AND spli.booking_id = NEW.booking_id
  ) OR EXISTS (
    SELECT 1 FROM booking_earnings
     WHERE school_id = NEW.school_id AND booking_id = NEW.booking_id
  ) OR EXISTS (
    SELECT 1
      FROM lesson_bookings lb
      JOIN stripe_launch_booking_earnings launch_earning
        ON launch_earning.school_id = lb.school_id
       AND launch_earning.payment_contract_id = lb.lesson_payment_contract_id
     WHERE lb.school_id = NEW.school_id AND lb.id = NEW.booking_id
  ) THEN
    RAISE EXCEPTION 'booking already has a payout claim'
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION interim_v1_guard_payout_claim_against_manual_settlement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  claim_school_id INTEGER;
  claim_booking_id INTEGER;
BEGIN
  claim_booking_id := NEW.booking_id;
  IF TG_TABLE_NAME = 'school_payout_line_items' THEN
    SELECT school_id INTO claim_school_id
      FROM school_payouts WHERE id = NEW.school_payout_id;
  ELSIF TG_TABLE_NAME = 'stripe_launch_booking_earnings' THEN
    claim_school_id := NEW.school_id;
    SELECT id INTO claim_booking_id
      FROM lesson_bookings
     WHERE school_id = NEW.school_id
       AND lesson_payment_contract_id = NEW.payment_contract_id
       AND status IN ('scheduled', 'chargeable')
     LIMIT 1;
    IF claim_booking_id IS NULL THEN RETURN NEW; END IF;
  ELSE
    claim_school_id := NEW.school_id;
  END IF;

  IF claim_school_id IS NULL THEN
    RAISE EXCEPTION 'payout claim school scope missing' USING ERRCODE = '23514';
  END IF;
  PERFORM pg_advisory_xact_lock(claim_school_id, claim_booking_id);

  IF EXISTS (
    SELECT 1 FROM interim_v1_manual_payout_settlement_bookings
     WHERE school_id = claim_school_id AND booking_id = claim_booking_id
  ) THEN
    RAISE EXCEPTION 'booking already covered by a manual payout settlement'
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION interim_v1_validate_manual_payout_settlement() FROM PUBLIC;
REVOKE ALL ON FUNCTION interim_v1_guard_manual_payout_booking_claim() FROM PUBLIC;
REVOKE ALL ON FUNCTION interim_v1_guard_payout_claim_against_manual_settlement() FROM PUBLIC;

DROP TRIGGER IF EXISTS interim_v1_manual_payout_settlements_validate
  ON interim_v1_manual_payout_settlements;
CREATE TRIGGER interim_v1_manual_payout_settlements_validate
  BEFORE INSERT ON interim_v1_manual_payout_settlements
  FOR EACH ROW EXECUTE FUNCTION interim_v1_validate_manual_payout_settlement();

DROP TRIGGER IF EXISTS interim_v1_manual_payout_settlements_append_only
  ON interim_v1_manual_payout_settlements;
CREATE TRIGGER interim_v1_manual_payout_settlements_append_only
  BEFORE UPDATE OR DELETE ON interim_v1_manual_payout_settlements
  FOR EACH ROW EXECUTE FUNCTION interim_v1_forbid_append_only_change();

DROP TRIGGER IF EXISTS interim_v1_manual_payout_bookings_claim_guard
  ON interim_v1_manual_payout_settlement_bookings;
CREATE TRIGGER interim_v1_manual_payout_bookings_claim_guard
  BEFORE INSERT ON interim_v1_manual_payout_settlement_bookings
  FOR EACH ROW EXECUTE FUNCTION interim_v1_guard_manual_payout_booking_claim();

DROP TRIGGER IF EXISTS interim_v1_manual_payout_bookings_append_only
  ON interim_v1_manual_payout_settlement_bookings;
CREATE TRIGGER interim_v1_manual_payout_bookings_append_only
  BEFORE UPDATE OR DELETE ON interim_v1_manual_payout_settlement_bookings
  FOR EACH ROW EXECUTE FUNCTION interim_v1_forbid_append_only_change();

DROP TRIGGER IF EXISTS payout_line_items_manual_settlement_guard ON payout_line_items;
CREATE TRIGGER payout_line_items_manual_settlement_guard
  BEFORE INSERT OR UPDATE OF school_id, booking_id ON payout_line_items
  FOR EACH ROW EXECUTE FUNCTION interim_v1_guard_payout_claim_against_manual_settlement();

DROP TRIGGER IF EXISTS school_payout_line_items_manual_settlement_guard
  ON school_payout_line_items;
CREATE TRIGGER school_payout_line_items_manual_settlement_guard
  BEFORE INSERT OR UPDATE OF school_payout_id, booking_id ON school_payout_line_items
  FOR EACH ROW EXECUTE FUNCTION interim_v1_guard_payout_claim_against_manual_settlement();

DROP TRIGGER IF EXISTS booking_earnings_manual_settlement_guard ON booking_earnings;
CREATE TRIGGER booking_earnings_manual_settlement_guard
  BEFORE INSERT OR UPDATE OF school_id, booking_id ON booking_earnings
  FOR EACH ROW EXECUTE FUNCTION interim_v1_guard_payout_claim_against_manual_settlement();

DROP TRIGGER IF EXISTS stripe_launch_booking_earnings_manual_settlement_guard
  ON stripe_launch_booking_earnings;
CREATE TRIGGER stripe_launch_booking_earnings_manual_settlement_guard
  BEFORE INSERT OR UPDATE OF school_id, payment_contract_id
  ON stripe_launch_booking_earnings
  FOR EACH ROW EXECUTE FUNCTION interim_v1_guard_payout_claim_against_manual_settlement();

DO $restore_manual_payout_settlement_access$
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
      'GRANT SELECT, INSERT ON TABLE public.interim_v1_manual_payout_settlements, public.interim_v1_manual_payout_settlement_bookings TO %I',
      grantee_name
    );
  END LOOP;
END
$restore_manual_payout_settlement_access$;
