-- Learner reschedule: explicit cross-instructor entitlement transfer.
-- The source purchase remains immutable. A paired negative/positive ledger
-- entry moves the consumed lesson entitlement between instructor scopes, and
-- the replacement booking draws from the new instructor-scoped entry.

ALTER TABLE credit_transactions
  ADD COLUMN IF NOT EXISTS transferred_from_credit_transaction_id INTEGER;

ALTER TABLE credit_transactions
  ADD COLUMN IF NOT EXISTS instructor_transfer_group_id UUID;

CREATE INDEX IF NOT EXISTS idx_credit_tx_transferred_from
  ON credit_transactions(transferred_from_credit_transaction_id, school_id)
  WHERE transferred_from_credit_transaction_id IS NOT NULL;

ALTER TABLE credit_transactions
  DROP CONSTRAINT IF EXISTS credit_transactions_transferred_from_school_fkey;
ALTER TABLE credit_transactions
  ADD CONSTRAINT credit_transactions_transferred_from_school_fkey
  FOREIGN KEY (transferred_from_credit_transaction_id, school_id)
  REFERENCES credit_transactions(id, school_id);

CREATE INDEX IF NOT EXISTS idx_credit_tx_instructor_transfer_group
  ON credit_transactions(instructor_transfer_group_id)
  WHERE instructor_transfer_group_id IS NOT NULL;

ALTER TABLE credit_transactions
  DROP CONSTRAINT IF EXISTS credit_transactions_type_check;
ALTER TABLE credit_transactions
  ADD CONSTRAINT credit_transactions_type_check
  CHECK (type IN (
    'purchase', 'refund', 'slot_purchase', 'edit_adjustment',
    'admin_add', 'admin_remove', 'referral_bonus', 'referral_reward',
    'free_trial', 'legacy_grandfather', 'request_hold', 'request_refund',
    'instructor_transfer_out', 'instructor_transfer_in'
  ));

ALTER TABLE credit_transactions
  DROP CONSTRAINT IF EXISTS credit_transactions_source_check;
ALTER TABLE credit_transactions
  ADD CONSTRAINT credit_transactions_source_check
  CHECK (source IS NULL OR source IN (
    'stripe', 'free_trial', 'reconciliation', 'goodwill', 'instructor_transfer'
  ));

ALTER TABLE credit_transactions
  DROP CONSTRAINT IF EXISTS credit_transactions_instructor_transfer_check;
ALTER TABLE credit_transactions
  ADD CONSTRAINT credit_transactions_instructor_transfer_check CHECK (
    (type NOT IN ('instructor_transfer_out', 'instructor_transfer_in')
      AND instructor_transfer_group_id IS NULL
      AND transferred_from_credit_transaction_id IS NULL)
    OR
    (type = 'instructor_transfer_out'
      AND minutes < 0
      AND instructor_transfer_group_id IS NOT NULL
      AND transferred_from_credit_transaction_id IS NOT NULL)
    OR
    (type = 'instructor_transfer_in'
      AND minutes > 0
      AND instructor_transfer_group_id IS NOT NULL
      AND transferred_from_credit_transaction_id IS NOT NULL)
  );
