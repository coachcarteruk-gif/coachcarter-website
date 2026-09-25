-- Record actual off-platform receipts without inventing Stripe payment identities.
-- No gate activation, cash movement, credit balance or payout writes.
CREATE TABLE IF NOT EXISTS flexible_package_bank_receipts (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  learner_id INTEGER,
  product_version_id BIGINT NOT NULL,
  amount_pence INTEGER NOT NULL CHECK (amount_pence > 0),
  received_on DATE NOT NULL,
  bank_reference TEXT,
  reference_sha256 TEXT NOT NULL CHECK (reference_sha256 ~ '^[0-9a-f]{64}$'),
  request_sha256 TEXT NOT NULL CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
  consent_evidence_reference TEXT,
  reason TEXT,
  recorded_by_admin_id INTEGER NOT NULL,
  recorded_by_role TEXT NOT NULL,
  disclosure_version TEXT NOT NULL,
  adult_age_confirmed BOOLEAN NOT NULL CHECK (adult_age_confirmed),
  terms_accepted BOOLEAN NOT NULL CHECK (terms_accepted),
  immediate_access_requested BOOLEAN NOT NULL CHECK (immediate_access_requested),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, reference_sha256),
  FOREIGN KEY (learner_id, school_id) REFERENCES learner_users(id, school_id) ON DELETE SET NULL (learner_id),
  FOREIGN KEY (product_version_id, school_id) REFERENCES package_product_versions(id, school_id),
  CHECK (recorded_by_role IN ('admin','superadmin','instructor')),
  CHECK (learner_id IS NULL OR (bank_reference IS NOT NULL AND consent_evidence_reference IS NOT NULL AND reason IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_flexible_bank_receipts_learner
  ON flexible_package_bank_receipts(school_id, learner_id);
CREATE INDEX IF NOT EXISTS idx_flexible_bank_receipts_version
  ON flexible_package_bank_receipts(product_version_id, school_id);

-- Actor ID plus role supports both admin accounts and authenticated instructor-admins.
-- The receipt is append-only except the exact GDPR anonymisation below.
CREATE OR REPLACE FUNCTION forbid_flexible_bank_receipt_change()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.learner_id IS NOT NULL AND NEW.learner_id IS NULL
     AND NEW.bank_reference IS NULL AND NEW.consent_evidence_reference IS NULL AND NEW.reason IS NULL
     AND (to_jsonb(NEW) - ARRAY['learner_id','bank_reference','consent_evidence_reference','reason'])
       = (to_jsonb(OLD) - ARRAY['learner_id','bank_reference','consent_evidence_reference','reason']) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'flexible_package_bank_receipts is append-only' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_flexible_bank_receipts_append_only ON flexible_package_bank_receipts;
CREATE TRIGGER trg_flexible_bank_receipts_append_only
  BEFORE UPDATE OR DELETE ON flexible_package_bank_receipts
  FOR EACH ROW EXECUTE FUNCTION forbid_flexible_bank_receipt_change();

ALTER TABLE flexible_package_purchases
  ALTER COLUMN attempt_id DROP NOT NULL,
  ALTER COLUMN stripe_checkout_session_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS payment_provider TEXT NOT NULL DEFAULT 'stripe',
  ADD COLUMN IF NOT EXISTS bank_receipt_id UUID;
ALTER TABLE flexible_package_purchases
  ADD CONSTRAINT flexible_purchase_bank_receipt_fk FOREIGN KEY (bank_receipt_id, school_id)
    REFERENCES flexible_package_bank_receipts(id, school_id),
  ADD CONSTRAINT flexible_purchase_provider_check CHECK (
    (payment_provider = 'stripe' AND attempt_id IS NOT NULL
      AND stripe_checkout_session_id IS NOT NULL AND bank_receipt_id IS NULL)
    OR (payment_provider = 'bank_transfer' AND bank_receipt_id IS NOT NULL
      AND attempt_id IS NULL AND stripe_checkout_session_id IS NULL
      AND stripe_payment_intent_id IS NULL AND post_trial_quote_id IS NULL)
  );
CREATE UNIQUE INDEX IF NOT EXISTS uq_flexible_purchase_bank_receipt
  ON flexible_package_purchases(bank_receipt_id) WHERE bank_receipt_id IS NOT NULL;
