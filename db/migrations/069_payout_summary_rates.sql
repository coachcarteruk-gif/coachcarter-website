-- 069: Effective-dated payout rates and off-platform legacy rates.
--
-- Supports the automated instructor payout summary (docs/payout/PAYOUT-SUMMARY-SPEC.md).
-- Spec §2.4 and business rule 8: "Franchise fee and share rate must be
-- effective-dated, so regenerating an old week reproduces that week's figures
-- rather than today's."
--
-- Today neither is true. instructors.commission_rate and
-- instructors.weekly_franchise_fee_pence are current-value columns with no
-- history, so regenerating August with today's numbers would silently restate
-- it. weekly_franchise_fee_pence is also NULL for every instructor: the £90/week
-- agreed with Simon exists only in conversation and in the hand-built image.
--
-- Per CLAUDE.md franchise rule 1, numbers live in admin-editable config, never
-- hardcoded. This migration creates the storage; it does not change how any
-- existing payout is calculated. The v1 payout path continues to read the
-- current-value columns until a later change moves it over.

-- ─────────────────────────────────────────────────────────────────────────────
-- Effective-dated instructor rates
-- ─────────────────────────────────────────────────────────────────────────────
-- One row per (instructor, rate kind, start date). A rate applies from
-- effective_from until the next row's effective_from, or indefinitely.
-- Open-ended by design: an end date would have to be rewritten every time a new
-- rate is added, and a gap or overlap between explicit ranges is a whole class
-- of bug this shape cannot have.
CREATE TABLE IF NOT EXISTS instructor_rate_history (
  id              SERIAL PRIMARY KEY,
  school_id       INTEGER NOT NULL REFERENCES schools(id) DEFAULT 1,
  instructor_id   INTEGER NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
  rate_kind       TEXT NOT NULL,
  -- Interpretation depends on rate_kind:
  --   commission_share     basis points of net revenue (9000 = 0.90)
  --   weekly_franchise_fee pence per week (9000 = £90.00)
  rate_value      INTEGER NOT NULL,
  effective_from  DATE NOT NULL,
  note            TEXT,
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_instructor_rate_kind
    CHECK (rate_kind IN ('commission_share', 'weekly_franchise_fee')),
  -- A share above 100% would pay an instructor more than the lesson earned.
  CONSTRAINT chk_instructor_rate_value
    CHECK (rate_value >= 0 AND (rate_kind <> 'commission_share' OR rate_value <= 10000))
);

-- One rate per kind per instructor per day. Two rows sharing a start date have
-- no defined order, so "which rate applied?" would be unanswerable.
CREATE UNIQUE INDEX IF NOT EXISTS uq_instructor_rate_history_point
  ON instructor_rate_history (school_id, instructor_id, rate_kind, effective_from);

-- The as-of lookup is always (instructor, kind) ordered by date descending.
CREATE INDEX IF NOT EXISTS idx_instructor_rate_history_lookup
  ON instructor_rate_history (school_id, instructor_id, rate_kind, effective_from DESC);

CREATE INDEX IF NOT EXISTS idx_instructor_rate_history_instructor
  ON instructor_rate_history (instructor_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Off-platform legacy rates
-- ─────────────────────────────────────────────────────────────────────────────
-- A learner who paid for hours outside the current model, where the money
-- reached the school directly and an instructor now delivers against it.
--
-- Giovanni Calvia: 29 hours entered as admin_add with amount_pence = 0 and a
-- rate stamp of 92p/min (£55.20/hr) that is not what he paid. The real purchase
-- was £46.77/hr on 22 March 2026, off-platform. Without this table the payout
-- has nothing to compute from and correctly refuses the lesson.
--
-- Deliberately separate from credit_transactions: those are financial facts
-- about money that moved through this system, and CLAUDE.md's legacy-conversion
-- rule forbids relabelling them. This records what was agreed, alongside them.
CREATE TABLE IF NOT EXISTS learner_legacy_rates (
  id                     SERIAL PRIMARY KEY,
  school_id              INTEGER NOT NULL REFERENCES schools(id) DEFAULT 1,
  learner_id             INTEGER NOT NULL REFERENCES learner_users(id) ON DELETE CASCADE,
  -- Pence per hour, to 4 decimal places. NOT an integer: Esha's £1214.40 for
  -- 24 hours, less the £18.42 Stripe actually charged, is 4983.25 pence/hour
  -- exactly. Rounding the rate and multiplying by hours is the specific bug
  -- spec §1 exists to prevent, so the fraction is carried and truncation
  -- happens once, at the end of the payout calculation.
  rate_pence_per_hour    NUMERIC(12,4) NOT NULL,
  -- How the payout should treat it. 'flat' pays rate x hours with no share and
  -- no processing fee, because the money arrived before this model and the
  -- school already holds it.
  settlement             TEXT NOT NULL DEFAULT 'flat',
  -- Evidence. purchased_on is when the learner actually paid; the reference is
  -- whatever ties it back (a Stripe id, a bank date, an invoice number).
  purchased_on           DATE,
  purchase_reference     TEXT,
  original_amount_pence  INTEGER,
  original_hours         NUMERIC(8,2),
  note                   TEXT,
  created_by             TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_legacy_rate_positive CHECK (rate_pence_per_hour > 0),
  CONSTRAINT chk_legacy_settlement CHECK (settlement IN ('flat', 'share'))
);

-- One active legacy rate per learner. A second would make the payout ambiguous,
-- which is exactly the "same pupil at two different rates" error in spec §5.
CREATE UNIQUE INDEX IF NOT EXISTS uq_learner_legacy_rate
  ON learner_legacy_rates (school_id, learner_id);

CREATE INDEX IF NOT EXISTS idx_learner_legacy_rates_learner
  ON learner_legacy_rates (learner_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- School-level payout configuration
-- ─────────────────────────────────────────────────────────────────────────────
-- The free-trial rate currently exists only as a constant in
-- docs/payout/payout_renderer.py. Per CLAUDE.md franchise rule 1 it belongs in
-- admin-editable config. Merged rather than replaced so no existing key is lost.
UPDATE schools
   SET config = jsonb_set(
         COALESCE(config, '{}'::jsonb),
         '{pricing,free_trial_rate_pence_per_hour}',
         '3000'::jsonb,
         true
       )
 WHERE id = 1
   AND COALESCE(config #> '{pricing,free_trial_rate_pence_per_hour}', 'null'::jsonb) = 'null'::jsonb;
