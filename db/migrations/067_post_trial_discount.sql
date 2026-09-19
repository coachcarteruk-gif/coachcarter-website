CREATE TABLE IF NOT EXISTS post_trial_discount_quotes (
  id                       UUID PRIMARY KEY,
  school_id                INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  learner_id               INTEGER REFERENCES learner_users(id) ON DELETE SET NULL,
  trial_booking_id         INTEGER NOT NULL REFERENCES lesson_bookings(id) ON DELETE RESTRICT,
  policy_version           TEXT NOT NULL,
  base_amount_pence        INTEGER NOT NULL CHECK (base_amount_pence >= 0),
  discount_pct             NUMERIC(5,2) NOT NULL CHECK (discount_pct >= 0 AND discount_pct < 100),
  discount_pence           INTEGER NOT NULL CHECK (discount_pence >= 0),
  final_amount_pence       INTEGER NOT NULL CHECK (final_amount_pence >= 0),
  trial_ended_at           TIMESTAMPTZ NOT NULL,
  eligible_until           TIMESTAMPTZ NOT NULL,
  checkout_expires_at      TIMESTAMPTZ NOT NULL,
  payment_type             TEXT,
  payment_identity         TEXT,
  bound_at                 TIMESTAMPTZ,
  provider_initiated_at    TIMESTAMPTZ,
  settlement_status        TEXT CHECK (settlement_status IN ('paid', 'authorized', 'invalid_requires_compensation')),
  settlement_reason        TEXT,
  settled_amount_pence     INTEGER CHECK (settled_amount_pence >= 0),
  provider_discount_pence  INTEGER CHECK (provider_discount_pence >= 0),
  settled_at               TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT post_trial_discount_amounts_check
    CHECK (base_amount_pence = discount_pence + final_amount_pence),
  CONSTRAINT post_trial_discount_times_check
    CHECK (trial_ended_at <= created_at AND created_at < eligible_until
       AND created_at < checkout_expires_at),
  CONSTRAINT post_trial_discount_binding_check
    CHECK ((payment_type IS NULL) = (payment_identity IS NULL)),
  CONSTRAINT post_trial_discount_settlement_check
    CHECK ((settlement_status IS NULL) = (settled_amount_pence IS NULL)
       AND (settlement_status IS NULL) = (provider_discount_pence IS NULL)
       AND (settlement_status IS NULL) = (settled_at IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_post_trial_discount_quotes_learner
  ON post_trial_discount_quotes(learner_id, school_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_post_trial_discount_quotes_trial_booking
  ON post_trial_discount_quotes(trial_booking_id);

CREATE INDEX IF NOT EXISTS idx_post_trial_discount_quotes_school
  ON post_trial_discount_quotes(school_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_post_trial_discount_quote_payment
  ON post_trial_discount_quotes(payment_type, payment_identity)
  WHERE payment_identity IS NOT NULL;

CREATE OR REPLACE FUNCTION protect_post_trial_discount_quote()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'post-trial discount quotes are retained financial evidence';
  END IF;
  IF OLD.school_id IS DISTINCT FROM NEW.school_id
     OR OLD.id IS DISTINCT FROM NEW.id
     OR OLD.trial_booking_id IS DISTINCT FROM NEW.trial_booking_id
     OR OLD.policy_version IS DISTINCT FROM NEW.policy_version
     OR OLD.base_amount_pence IS DISTINCT FROM NEW.base_amount_pence
     OR OLD.discount_pct IS DISTINCT FROM NEW.discount_pct
     OR OLD.discount_pence IS DISTINCT FROM NEW.discount_pence
     OR OLD.final_amount_pence IS DISTINCT FROM NEW.final_amount_pence
     OR OLD.trial_ended_at IS DISTINCT FROM NEW.trial_ended_at
     OR OLD.eligible_until IS DISTINCT FROM NEW.eligible_until
     OR OLD.checkout_expires_at IS DISTINCT FROM NEW.checkout_expires_at
     OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'post-trial discount quote financial snapshot is immutable';
  END IF;
  IF OLD.learner_id IS NULL AND NEW.learner_id IS NOT NULL
     OR OLD.learner_id IS NOT NULL AND NEW.learner_id IS NOT NULL AND OLD.learner_id <> NEW.learner_id THEN
    RAISE EXCEPTION 'post-trial discount quote learner binding is immutable';
  END IF;
  IF OLD.payment_identity IS NOT NULL
     AND (OLD.payment_identity IS DISTINCT FROM NEW.payment_identity OR OLD.payment_type IS DISTINCT FROM NEW.payment_type) THEN
    RAISE EXCEPTION 'post-trial discount quote payment binding is immutable';
  END IF;
  IF OLD.bound_at IS NOT NULL AND OLD.bound_at IS DISTINCT FROM NEW.bound_at THEN
    RAISE EXCEPTION 'post-trial discount quote binding timestamp is immutable';
  END IF;
  IF OLD.provider_initiated_at IS NOT NULL AND OLD.provider_initiated_at IS DISTINCT FROM NEW.provider_initiated_at THEN
    RAISE EXCEPTION 'post-trial discount initiation evidence is immutable';
  END IF;
  IF OLD.settlement_status IS NOT NULL
     AND NOT (OLD.settlement_status = 'authorized'
       AND NEW.settlement_status IN ('paid', 'invalid_requires_compensation'))
     AND (OLD.settlement_status IS DISTINCT FROM NEW.settlement_status
       OR OLD.settlement_reason IS DISTINCT FROM NEW.settlement_reason
       OR OLD.settled_amount_pence IS DISTINCT FROM NEW.settled_amount_pence
       OR OLD.provider_discount_pence IS DISTINCT FROM NEW.provider_discount_pence
       OR OLD.settled_at IS DISTINCT FROM NEW.settled_at) THEN
    RAISE EXCEPTION 'post-trial discount settlement outcome is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_post_trial_discount_quote_trigger ON post_trial_discount_quotes;
CREATE TRIGGER protect_post_trial_discount_quote_trigger
BEFORE UPDATE OR DELETE ON post_trial_discount_quotes
FOR EACH ROW EXECUTE FUNCTION protect_post_trial_discount_quote();
