-- Legacy prepaid Lesson Credit may be explicitly converted into school-wide
-- Flexible Hours. Installing this migration converts no balances.
-- Original credit/payment/booking evidence remains unchanged.
-- Fractions of a 30-minute unit preserve exact legacy minutes. Lesson duration
-- validation still requires multiples of 30 minutes. Rates retain six decimals;
-- booking contributions are rounded to pennies, as are remaining source values.
DROP VIEW IF EXISTS flexible_package_balances;
DROP VIEW IF EXISTS flexible_package_source_remaining;
ALTER TABLE flexible_package_sources
  ALTER COLUMN initial_units TYPE NUMERIC,
  ALTER COLUMN rate_pence_per_unit TYPE NUMERIC(16,6),
  DROP CONSTRAINT IF EXISTS flexible_package_sources_check1;
ALTER TABLE flexible_package_sources ADD CONSTRAINT flexible_package_sources_check1
  CHECK (original_value_pence = ROUND(initial_units * rate_pence_per_unit));
ALTER TABLE flexible_package_booking_allocations
  ALTER COLUMN units_allocated TYPE NUMERIC,
  ALTER COLUMN rate_pence_per_unit TYPE NUMERIC(16,6),
  DROP CONSTRAINT IF EXISTS flexible_package_booking_allocations_check1;
ALTER TABLE flexible_package_booking_allocations ADD CONSTRAINT flexible_package_booking_allocations_check1
  CHECK (contribution_pence = ROUND(units_allocated * rate_pence_per_unit));
ALTER TABLE flexible_package_allocation_returns ALTER COLUMN units_returned TYPE NUMERIC;
-- Some installations have 050 without the 051 return-reason extension.
ALTER TABLE flexible_package_allocation_returns DROP CONSTRAINT IF EXISTS flexible_package_allocation_returns_reason_check;
ALTER TABLE flexible_package_allocation_returns ADD CONSTRAINT flexible_package_allocation_returns_reason_check
  CHECK (reason IN ('learner_cancelled_48h_plus','admin_eligible_cancellation','rescheduled_48h_plus'));
ALTER TABLE flexible_package_source_reductions ALTER COLUMN units_reduced TYPE NUMERIC;

CREATE OR REPLACE VIEW flexible_package_source_remaining AS
SELECT s.id AS source_id, s.school_id, s.learner_id, s.purchase_id,
       s.initial_units, s.unit_minutes, s.rate_pence_per_unit,
       remainder.units AS remaining_units,
       ROUND(remainder.units * s.rate_pence_per_unit)::integer AS refundable_value_pence,
       s.available_at, s.created_at
  FROM flexible_package_sources s
  CROSS JOIN LATERAL (
    SELECT GREATEST(0, ROUND((s.initial_units
      - COALESCE((SELECT SUM(r.units_reduced) FROM flexible_package_source_reductions r
                   WHERE r.source_id=s.id AND r.school_id=s.school_id),0)
      - COALESCE((SELECT SUM(a.units_allocated) FROM flexible_package_booking_allocations a
                   WHERE a.source_id=s.id AND a.school_id=s.school_id
                     AND NOT EXISTS (SELECT 1 FROM flexible_package_allocation_returns ar
                       WHERE ar.allocation_id=a.id AND ar.school_id=a.school_id)),0)
    ) * 30)) / 30 AS units
  ) remainder;
CREATE OR REPLACE VIEW flexible_package_balances AS
SELECT school_id, learner_id, SUM(remaining_units) AS remaining_units,
       ROUND(SUM(remaining_units * unit_minutes))::integer AS remaining_minutes,
       SUM(refundable_value_pence)::integer AS refundable_value_pence
  FROM flexible_package_source_remaining WHERE learner_id IS NOT NULL GROUP BY school_id, learner_id;

ALTER TABLE flexible_package_sources
  ALTER COLUMN purchase_id DROP NOT NULL,
  ALTER COLUMN product_version_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS legacy_conversion JSONB;

ALTER TABLE flexible_package_sources DROP CONSTRAINT IF EXISTS flexible_source_origin_check;
ALTER TABLE flexible_package_sources ADD CONSTRAINT flexible_source_origin_check CHECK (
  (purchase_id IS NOT NULL AND product_version_id IS NOT NULL AND legacy_conversion IS NULL)
  OR (purchase_id IS NULL AND product_version_id IS NULL AND legacy_conversion IS NOT NULL
    AND jsonb_typeof(legacy_conversion) = 'object'
    AND legacy_conversion ?& ARRAY['request_id','fingerprint','instructor_id','minutes','hourly_rate_pence','evidence','source_draws'])
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_flexible_legacy_conversion_request
  ON flexible_package_sources(school_id, (legacy_conversion->>'request_id'))
  WHERE legacy_conversion IS NOT NULL;

-- Operator-only SQL entry point; no public API or automatic grant trigger.
-- Preview first (apply=false); apply requires that exact current fingerprint.
-- Only offline legacy/admin sources qualify. Stripe sources require a separate
-- original-payment/refund design and must never be laundered through this path.
CREATE OR REPLACE FUNCTION convert_legacy_credit_to_schoolwide_hours(
  p_school INTEGER, p_learner INTEGER, p_instructor INTEGER, p_admin INTEGER,
  p_hourly_rate_pence NUMERIC, p_evidence TEXT, p_request UUID,
  p_apply BOOLEAN DEFAULT FALSE, p_fingerprint TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  balance INTEGER;
  ledger_minutes INTEGER;
  unattributed_minutes INTEGER;
  source_rows JSONB;
  source_row JSONB;
  draws JSONB := '[]'::jsonb;
  remaining INTEGER;
  available INTEGER;
  drawn INTEGER;
  source_id BIGINT;
  prior flexible_package_sources%ROWTYPE;
  fingerprint TEXT;
  detail JSONB;
  admin_email TEXT;
BEGIN
  IF p_school IS NULL OR p_learner IS NULL OR p_instructor IS NULL OR p_admin IS NULL
     OR p_request IS NULL OR p_apply IS NULL OR p_hourly_rate_pence IS NULL
     OR p_hourly_rate_pence <= 0 OR p_hourly_rate_pence > 100000
     OR p_hourly_rate_pence <> round(p_hourly_rate_pence,4)
     OR length(trim(COALESCE(p_evidence,''))) < 10 THEN
    RAISE EXCEPTION 'LEGACY_CONVERSION_INVALID_INPUT';
  END IF;
  SELECT email INTO admin_email FROM admin_users
   WHERE id = p_admin AND school_id = p_school AND active = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LEGACY_CONVERSION_ADMIN_SCOPE'; END IF;
  PERFORM id FROM learner_users WHERE id = p_learner AND school_id = p_school FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LEGACY_CONVERSION_LEARNER_SCOPE'; END IF;
  PERFORM id FROM instructors WHERE id = p_instructor AND school_id = p_school;
  IF NOT FOUND THEN RAISE EXCEPTION 'LEGACY_CONVERSION_INSTRUCTOR_SCOPE'; END IF;

  SELECT * INTO prior FROM flexible_package_sources
   WHERE school_id = p_school AND legacy_conversion->>'request_id' = p_request::text;
  IF FOUND THEN
    IF prior.learner_id IS DISTINCT FROM p_learner
       OR (prior.legacy_conversion->>'instructor_id')::integer IS DISTINCT FROM p_instructor
       OR (prior.legacy_conversion->>'hourly_rate_pence')::numeric IS DISTINCT FROM p_hourly_rate_pence
       OR prior.legacy_conversion->>'evidence' IS DISTINCT FROM p_evidence
       OR (p_apply AND prior.legacy_conversion->>'fingerprint' IS DISTINCT FROM p_fingerprint) THEN
      RAISE EXCEPTION 'LEGACY_CONVERSION_REQUEST_MISMATCH';
    END IF;
    RETURN jsonb_build_object('ok',true,'reused',true,'source_id',prior.id,'conversion',prior.legacy_conversion);
  END IF;

  SELECT balance_minutes INTO balance FROM learner_credit_balances
   WHERE school_id = p_school AND learner_id = p_learner AND instructor_id = p_instructor FOR UPDATE;
  IF NOT FOUND OR balance <= 0 THEN RAISE EXCEPTION 'LEGACY_CONVERSION_NO_BALANCE'; END IF;

  -- Freeze the source rows after the same LCB lock used by ordinary spenders.
  PERFORM id FROM credit_transactions
   WHERE school_id = p_school AND learner_id = p_learner AND instructor_id = p_instructor ORDER BY id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM credit_transactions
    WHERE school_id = p_school AND learner_id = p_learner AND instructor_id = p_instructor
      AND minutes > 0 AND (type NOT IN ('legacy_grandfather','admin_add')
        OR COALESCE(amount_pence,0) <> 0 OR stripe_session_id IS NOT NULL
        OR stripe_payment_intent_id IS NOT NULL OR stripe_charge_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'LEGACY_CONVERSION_NOT_OFFLINE_LEGACY';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]'::jsonb) INTO source_rows FROM (
    SELECT ct.id, ct.type, ct.minutes, ct.amount_pence, ct.effective_rate_pence_per_minute,
      COALESCE((SELECT SUM(b.minutes_drawn) FROM booking_credit_sources b
        WHERE b.school_id = p_school AND b.credit_transaction_id = ct.id AND b.refunded_at IS NULL),0)::integer AS used_minutes,
      COALESCE((SELECT SUM(a.minutes_adjusted) FROM credit_source_adjustments a
        WHERE a.credit_transaction_id = ct.id),0)::integer AS adjusted_minutes
    FROM credit_transactions ct
    WHERE ct.school_id = p_school AND ct.learner_id = p_learner AND ct.instructor_id = p_instructor
  ) s;
  SELECT COALESCE(SUM(b.minutes_deducted),0)::integer INTO unattributed_minutes FROM lesson_bookings b
   WHERE b.school_id = p_school AND b.learner_id = p_learner AND b.instructor_id = p_instructor
     AND b.credit_returned = FALSE AND b.minutes_deducted > 0
     AND COALESCE(b.payment_method,'') <> 'flexible_package'
     AND NOT EXISTS (SELECT 1 FROM booking_credit_sources bs WHERE bs.school_id = p_school AND bs.booking_id = b.id);
  SELECT COALESCE(SUM((s->>'minutes')::integer - (s->>'used_minutes')::integer - (s->>'adjusted_minutes')::integer),0)::integer
    - unattributed_minutes INTO ledger_minutes FROM jsonb_array_elements(source_rows) s;
  IF ledger_minutes <> balance THEN RAISE EXCEPTION 'LEGACY_CONVERSION_LEDGER_DRIFT'; END IF;

  remaining := balance;
  FOR source_row IN SELECT value FROM jsonb_array_elements(source_rows) LOOP
    IF source_row->>'type' NOT IN ('legacy_grandfather','admin_add') THEN CONTINUE; END IF;
    available := GREATEST(0,(source_row->>'minutes')::integer - (source_row->>'used_minutes')::integer - (source_row->>'adjusted_minutes')::integer);
    drawn := LEAST(available, remaining);
    IF drawn > 0 THEN
      draws := draws || jsonb_build_array(jsonb_build_object('credit_transaction_id',(source_row->>'id')::integer,'minutes',drawn));
      remaining := remaining - drawn;
    END IF;
  END LOOP;
  IF remaining <> 0 THEN RAISE EXCEPTION 'LEGACY_CONVERSION_INSUFFICIENT_SOURCES'; END IF;
  fingerprint := md5(jsonb_build_object('school',p_school,'learner',p_learner,'instructor',p_instructor,
    'balance',balance,'sources',source_rows,'unattributed',unattributed_minutes,
    'rate',p_hourly_rate_pence,'evidence',p_evidence)::text);
  detail := jsonb_build_object('request_id',p_request,'fingerprint',fingerprint,'instructor_id',p_instructor,
    'minutes',balance,'hourly_rate_pence',p_hourly_rate_pence,'evidence',p_evidence,'source_draws',draws);
  IF NOT p_apply THEN RETURN jsonb_build_object('ok',true,'preview',true,'conversion',detail); END IF;
  IF p_fingerprint IS DISTINCT FROM fingerprint THEN RAISE EXCEPTION 'LEGACY_CONVERSION_STALE_PREVIEW'; END IF;

  INSERT INTO flexible_package_sources(school_id,learner_id,purchase_id,product_version_id,initial_units,
    unit_minutes,rate_pence_per_unit,original_value_pence,available_at,legacy_conversion)
  VALUES(p_school,p_learner,NULL,NULL,balance/30.0,30,p_hourly_rate_pence/2,
    ROUND(balance/60.0*p_hourly_rate_pence),NOW(),detail) RETURNING id INTO source_id;
  FOR source_row IN SELECT value FROM jsonb_array_elements(draws) LOOP
    INSERT INTO credit_source_adjustments(credit_transaction_id,kind,minutes_adjusted,pence_adjusted,reason,created_by)
    VALUES((source_row->>'credit_transaction_id')::integer,'admin_correction',(source_row->>'minutes')::integer,
      0,'School-wide hours conversion ' || p_request::text || '; ' || p_evidence,p_admin);
  END LOOP;
  UPDATE learner_credit_balances SET balance_minutes = balance_minutes - balance
   WHERE school_id = p_school AND learner_id = p_learner AND instructor_id = p_instructor;
  INSERT INTO flexible_package_state_events(school_id,learner_id,event_type,source_id,detail)
   VALUES(p_school,p_learner,'legacy_credit_converted',source_id,detail);
  INSERT INTO audit_log(admin_id,admin_email,action,target_type,target_id,details,ip_address,school_id)
   VALUES(p_admin,admin_email,'credits.convert_legacy_schoolwide','learner',p_learner,
     detail || jsonb_build_object('source_id',source_id),'operator-sql',p_school);
  RETURN jsonb_build_object('ok',true,'reused',false,'source_id',source_id,'conversion',detail);
END;
$$;
REVOKE ALL ON FUNCTION convert_legacy_credit_to_schoolwide_hours(INTEGER,INTEGER,INTEGER,INTEGER,NUMERIC,TEXT,UUID,BOOLEAN,TEXT) FROM PUBLIC;


-- Migration 058 recreated these views and thereby removed their ACLs.
-- Restore SELECT only for roles already entitled to read every underlying
-- ledger. Include NOLOGIN group roles: production login rotation uses inherited
-- grants, so filtering to rolcanlogin would silently miss the runtime role.
DO $restore_flexible_read_access$
DECLARE reader RECORD;
BEGIN
  FOR reader IN
    SELECT DISTINCT r.rolname
      FROM pg_class c
      CROSS JOIN LATERAL aclexplode(c.relacl) a
      JOIN pg_roles r ON r.oid = a.grantee
     WHERE c.oid = 'public.flexible_package_sources'::regclass
       AND a.grantee <> c.relowner
       AND a.privilege_type = 'SELECT'
       AND has_table_privilege(r.oid, 'public.flexible_package_booking_allocations', 'SELECT')
       AND has_table_privilege(r.oid, 'public.flexible_package_allocation_returns', 'SELECT')
       AND has_table_privilege(r.oid, 'public.flexible_package_source_reductions', 'SELECT')
  LOOP
    EXECUTE format('GRANT SELECT ON public.flexible_package_balances, public.flexible_package_source_remaining TO %I', reader.rolname);
  END LOOP;
END;
$restore_flexible_read_access$;
