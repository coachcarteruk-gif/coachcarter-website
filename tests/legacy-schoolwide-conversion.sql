-- Run only on the disposable production clone documented in the runbook.
-- Uses the copied School 1 / learner 34 fixture. All successful mutations are
-- rolled back in a PL/pgSQL subtransaction; a failed assertion aborts the call.
DO $test$
DECLARE
  preview JSONB;
  applied JSONB;
  replay JSONB;
  before_sources INTEGER;
  before_adjustments INTEGER;
  before_audits INTEGER;
  evidence TEXT := 'Integration fixture: confirmed original rate GBP48/hour';
  request_id UUID := 'e6406163-d81a-4fb1-8ef5-a5f4932fb236';
BEGIN
  SELECT COUNT(*) INTO before_sources FROM flexible_package_sources WHERE school_id=1;
  SELECT COUNT(*) INTO before_adjustments FROM credit_source_adjustments a
    JOIN credit_transactions ct ON ct.id=a.credit_transaction_id WHERE ct.school_id=1;
  SELECT COUNT(*) INTO before_audits FROM audit_log WHERE school_id=1;
  BEGIN
    preview := convert_legacy_credit_to_schoolwide_hours(1,34,4,1,4800,evidence,request_id);
    IF preview#>>'{conversion,minutes}' IS DISTINCT FROM '180' THEN RAISE EXCEPTION 'Expected 180 minutes'; END IF;
    IF (SELECT COUNT(*) FROM flexible_package_sources WHERE school_id=1) <> before_sources THEN RAISE EXCEPTION 'Preview mutated'; END IF;
    BEGIN
      PERFORM convert_legacy_credit_to_schoolwide_hours(1,34,4,1,4800,evidence,request_id,true,'stale');
      RAISE EXCEPTION 'Stale preview accepted';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'LEGACY_CONVERSION_STALE_PREVIEW' THEN RAISE; END IF;
    END;
    BEGIN
      PERFORM convert_legacy_credit_to_schoolwide_hours(2,34,4,1,4800,evidence,request_id);
      RAISE EXCEPTION 'Cross-school conversion accepted';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'LEGACY_CONVERSION_ADMIN_SCOPE' THEN RAISE; END IF;
    END;
    BEGIN
      PERFORM convert_legacy_credit_to_schoolwide_hours(1,34,4,1,NULL,evidence,request_id);
      RAISE EXCEPTION 'Unknown rate accepted';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'LEGACY_CONVERSION_INVALID_INPUT' THEN RAISE; END IF;
    END;
    BEGIN
      PERFORM convert_legacy_credit_to_schoolwide_hours(1,27,4,1,4800,evidence,request_id);
      RAISE EXCEPTION 'Stripe source accepted';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'LEGACY_CONVERSION_NOT_OFFLINE_LEGACY' THEN RAISE; END IF;
    END;
    applied := convert_legacy_credit_to_schoolwide_hours(1,34,4,1,4800,evidence,request_id,true,preview#>>'{conversion,fingerprint}');
    replay := convert_legacy_credit_to_schoolwide_hours(1,34,4,1,4800,evidence,request_id,true,preview#>>'{conversion,fingerprint}');
    IF replay->>'reused' IS DISTINCT FROM 'true' OR replay->>'source_id' IS DISTINCT FROM applied->>'source_id' THEN RAISE EXCEPTION 'Replay duplicated'; END IF;
    IF (SELECT balance_minutes FROM learner_credit_balances WHERE school_id=1 AND learner_id=34 AND instructor_id=4) IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'Old balance still spendable'; END IF;
    IF NOT EXISTS (SELECT 1 FROM flexible_package_sources WHERE school_id=1 AND id=(applied->>'source_id')::bigint
      AND initial_units=6 AND rate_pence_per_unit=2400 AND original_value_pence=14400 AND purchase_id IS NULL) THEN RAISE EXCEPTION 'Hours or original rate changed'; END IF;
    IF (SELECT COUNT(*) FROM flexible_package_sources WHERE school_id=1) <> before_sources+1 THEN RAISE EXCEPTION 'Wrong source count'; END IF;
    IF (SELECT COUNT(*) FROM credit_source_adjustments a JOIN credit_transactions ct ON ct.id=a.credit_transaction_id WHERE ct.school_id=1) <> before_adjustments+1 THEN RAISE EXCEPTION 'Wrong adjustment count'; END IF;
    IF (SELECT COUNT(*) FROM audit_log WHERE school_id=1) <> before_audits+1 THEN RAISE EXCEPTION 'Missing audit'; END IF;
    IF NOT EXISTS (SELECT 1 FROM credit_transactions WHERE school_id=1 AND id=161 AND minutes=450 AND amount_pence=0 AND effective_rate_pence_per_minute=92) THEN RAISE EXCEPTION 'Historical source rewritten'; END IF;
    BEGIN
      PERFORM convert_legacy_credit_to_schoolwide_hours(1,34,4,1,5500,evidence,request_id,true,preview#>>'{conversion,fingerprint}');
      RAISE EXCEPTION 'Replay rate mismatch accepted';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'LEGACY_CONVERSION_REQUEST_MISMATCH' THEN RAISE; END IF;
    END;
    preview := convert_legacy_credit_to_schoolwide_hours(1,74,4,1,4983.25,evidence,'f6193d67-c69d-4a92-9cd7-07f51dbd7b32');
    IF preview#>>'{conversion,minutes}' IS DISTINCT FROM '424' THEN RAISE EXCEPTION 'Lost remainder minutes'; END IF;
    applied := convert_legacy_credit_to_schoolwide_hours(1,74,4,1,4983.25,evidence,'f6193d67-c69d-4a92-9cd7-07f51dbd7b32',true,preview#>>'{conversion,fingerprint}');
    IF NOT EXISTS (SELECT 1 FROM flexible_package_balances WHERE school_id=1 AND learner_id=74
      AND remaining_minutes=424 AND refundable_value_pence=35215) THEN RAISE EXCEPTION 'Maisie rate or remainder changed'; END IF;
    RAISE EXCEPTION USING ERRCODE='Z0001', MESSAGE='rollback successful test mutations';
  EXCEPTION WHEN SQLSTATE 'Z0001' THEN NULL;
  END;
  IF (SELECT COUNT(*) FROM flexible_package_sources WHERE school_id=1) <> before_sources THEN RAISE EXCEPTION 'Test leaked mutations'; END IF;
END;
$test$;
