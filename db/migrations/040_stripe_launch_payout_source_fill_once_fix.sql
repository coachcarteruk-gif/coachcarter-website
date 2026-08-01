-- Stripe Connect Simon launch: forward-only correction for the Slice 1
-- payout-source fill-once guard.
--
-- PostgreSQL JSONB extraction with -> returns a JSON null value for an SQL
-- NULL column. JSON null is itself non-NULL to SQL, so migration 039's guard
-- rejected the first legitimate NULL-to-value fill. Text extraction with ->>
-- returns SQL NULL and preserves the intended append-only rule: a launch fact
-- may be filled once, but can never be replaced afterward.

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
    IF to_jsonb(OLD)->>fill_column IS NOT NULL
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
