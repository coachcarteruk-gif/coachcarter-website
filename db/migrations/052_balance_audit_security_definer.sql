-- Production runtime roles update learner balances but must not receive direct
-- INSERT/sequence privileges on the append-only balance audit ledger. Keep the
-- trigger owner-controlled so ordinary balance writes remain auditable.

CREATE OR REPLACE FUNCTION public.trg_balance_audit() RETURNS TRIGGER
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  old_bm INTEGER;
  new_bm INTEGER;
  old_cb INTEGER;
  new_cb INTEGER;
BEGIN
  IF TG_OP = 'INSERT' THEN
    old_bm := NULL; old_cb := NULL;
    new_bm := NEW.balance_minutes; new_cb := NEW.credit_balance;
    IF COALESCE(new_bm, 0) = 0 AND COALESCE(new_cb, 0) = 0 THEN
      RETURN NEW;
    END IF;
    INSERT INTO public.balance_audit (learner_id, op, old_balance_minutes, new_balance_minutes,
      old_credit_balance, new_credit_balance, delta_minutes, delta_credits,
      db_session_user, application_name)
    VALUES (NEW.id, 'INSERT', NULL, new_bm, NULL, new_cb,
      COALESCE(new_bm, 0), COALESCE(new_cb, 0),
      session_user, pg_catalog.current_setting('application_name', true));
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    old_bm := OLD.balance_minutes; new_bm := NEW.balance_minutes;
    old_cb := OLD.credit_balance;  new_cb := NEW.credit_balance;
    IF old_bm IS NOT DISTINCT FROM new_bm AND old_cb IS NOT DISTINCT FROM new_cb THEN
      RETURN NEW;
    END IF;
    INSERT INTO public.balance_audit (learner_id, op, old_balance_minutes, new_balance_minutes,
      old_credit_balance, new_credit_balance, delta_minutes, delta_credits,
      db_session_user, application_name)
    VALUES (NEW.id, 'UPDATE', old_bm, new_bm, old_cb, new_cb,
      COALESCE(new_bm, 0) - COALESCE(old_bm, 0),
      COALESCE(new_cb, 0) - COALESCE(old_cb, 0),
      session_user, pg_catalog.current_setting('application_name', true));
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.balance_audit (learner_id, op, old_balance_minutes, new_balance_minutes,
      old_credit_balance, new_credit_balance, delta_minutes, delta_credits,
      db_session_user, application_name)
    VALUES (OLD.id, 'DELETE', OLD.balance_minutes, NULL, OLD.credit_balance, NULL,
      -COALESCE(OLD.balance_minutes, 0), -COALESCE(OLD.credit_balance, 0),
      session_user, pg_catalog.current_setting('application_name', true));
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

ALTER FUNCTION public.trg_balance_audit() OWNER TO neondb_owner;
REVOKE ALL ON FUNCTION public.trg_balance_audit() FROM PUBLIC;
