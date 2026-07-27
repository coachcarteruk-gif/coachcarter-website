-- Payout v2 Slice 5 inactive connected-bank visibility diagnostic.
-- READ ONLY. Run only with an explicit school:
--   psql ... -v school_id=1 -f db/diagnostics/payout-v2-bank-payout-visibility.sql

-- 1. Connect transfers with no downstream bank-payout evidence.
WITH params AS (SELECT :'school_id'::integer AS school_id)
SELECT
  pt.id AS payout_transfer_id,
  pt.payout_batch_id,
  pt.stripe_transfer_id,
  pt.amount_pence,
  pt.currency,
  pt.stripe_destination_account_id,
  pt.stripe_created_at
FROM payout_transfers pt
JOIN params p ON p.school_id = pt.school_id
WHERE pt.state = 'transferred'
  AND NOT EXISTS (
    SELECT 1
    FROM connected_bank_payout_transfer_links cbptl
    WHERE cbptl.school_id = pt.school_id
      AND cbptl.payout_transfer_id = pt.id
  )
ORDER BY pt.stripe_created_at NULLS FIRST, pt.id;

-- 2. Connected payouts retained without an exact local transfer correlation.
WITH params AS (SELECT :'school_id'::integer AS school_id)
SELECT
  cbp.id AS connected_bank_payout_id,
  cbp.stripe_payout_id,
  cbp.stripe_account_id,
  cbp.amount_pence,
  cbp.currency,
  cbp.state,
  cbp.stripe_created_at
FROM connected_bank_payouts cbp
JOIN params p ON p.school_id = cbp.school_id
WHERE NOT EXISTS (
  SELECT 1
  FROM connected_bank_payout_transfer_links cbptl
  WHERE cbptl.school_id = cbp.school_id
    AND cbptl.connected_bank_payout_id = cbp.id
)
ORDER BY cbp.stripe_created_at NULLS FIRST, cbp.id;

-- 3. Exact link identities must agree. Must return no rows.
WITH params AS (SELECT :'school_id'::integer AS school_id)
SELECT
  cbptl.id AS link_id,
  cbp.id AS connected_bank_payout_id,
  pt.id AS payout_transfer_id,
  cbptl.stripe_balance_transaction_id,
  cbp.stripe_account_id AS payout_account_id,
  pt.stripe_destination_account_id AS transfer_destination_account_id,
  cbptl.amount_pence AS settlement_transfer_pence,
  pt.amount_pence AS connect_transfer_pence,
  cbptl.currency AS settlement_currency,
  pt.currency AS transfer_currency
FROM connected_bank_payout_transfer_links cbptl
JOIN params p ON p.school_id = cbptl.school_id
JOIN connected_bank_payouts cbp
  ON cbp.school_id = cbptl.school_id
 AND cbp.id = cbptl.connected_bank_payout_id
JOIN payout_transfers pt
  ON pt.school_id = cbptl.school_id
 AND pt.id = cbptl.payout_transfer_id
WHERE cbp.stripe_account_id <> pt.stripe_destination_account_id
   OR cbptl.amount_pence <> pt.amount_pence
   OR cbptl.currency <> pt.currency
ORDER BY cbptl.id;

-- 4. Global identity constraints should make all cohorts empty.
WITH params AS (SELECT :'school_id'::integer AS school_id),
duplicates AS (
  SELECT 'stripe_transfer_id' AS identity_type, stripe_transfer_id AS identity,
         COUNT(*)::int AS count
  FROM payout_transfers pt
  JOIN params p ON p.school_id = pt.school_id
  WHERE stripe_transfer_id IS NOT NULL
  GROUP BY stripe_transfer_id
  HAVING COUNT(*) > 1
  UNION ALL
  SELECT 'stripe_payout_id', stripe_payout_id, COUNT(*)::int
  FROM connected_bank_payouts cbp
  JOIN params p ON p.school_id = cbp.school_id
  GROUP BY stripe_payout_id
  HAVING COUNT(*) > 1
  UNION ALL
  SELECT 'stripe_balance_transaction_id', stripe_balance_transaction_id,
         COUNT(*)::int
  FROM connected_bank_payout_transfer_links cbptl
  JOIN params p ON p.school_id = cbptl.school_id
  GROUP BY stripe_balance_transaction_id
  HAVING COUNT(*) > 1
)
SELECT * FROM duplicates ORDER BY identity_type, identity;

-- 5. Terminal evidence that arrived before payout.created. Informational:
-- delivery order is not an error when the final state and identities agree.
WITH params AS (SELECT :'school_id'::integer AS school_id),
event_order AS (
  SELECT
    pese.object_id AS stripe_payout_id,
    MIN(pese.received_at) FILTER (WHERE pese.event_type = 'payout.created')
      AS created_received_at,
    MIN(pese.received_at) FILTER (
      WHERE pese.event_type IN ('payout.paid', 'payout.failed')
    ) AS terminal_received_at
  FROM payout_v2_stripe_evidence_events pese
  JOIN params p ON p.school_id = pese.school_id
  WHERE pese.object_type = 'payout'
  GROUP BY pese.object_id
)
SELECT *
FROM event_order
WHERE terminal_received_at IS NOT NULL
  AND (
    created_received_at IS NULL
    OR terminal_received_at < created_received_at
  )
ORDER BY terminal_received_at;

-- 6. Stuck receipt claims requiring retry/operator inspection.
WITH params AS (SELECT :'school_id'::integer AS school_id)
SELECT
  ser.stripe_event_id,
  ser.event_type,
  ser.connected_account_id,
  ser.received_at,
  NOW() - ser.received_at AS processing_age
FROM stripe_event_receipts ser
JOIN params p ON p.school_id = ser.school_id
WHERE ser.processing_status = 'processing'
  AND ser.received_at < NOW() - INTERVAL '5 minutes'
ORDER BY ser.received_at;

-- 7. Explicit operator-review evidence.
WITH params AS (SELECT :'school_id'::integer AS school_id)
SELECT
  pese.stripe_event_id,
  pese.event_type,
  pese.object_type,
  pese.object_id,
  pese.connected_account_id,
  pese.operator_review_reasons,
  pese.received_at
FROM payout_v2_stripe_evidence_events pese
JOIN params p ON p.school_id = pese.school_id
WHERE pese.disposition = 'operator_review'
ORDER BY pese.received_at, pese.id;

-- 8. State summary keeps Connect transfer and bank settlement distinct.
WITH params AS (SELECT :'school_id'::integer AS school_id)
SELECT state, COUNT(*)::int AS count
FROM payout_batches pb
JOIN params p ON p.school_id = pb.school_id
GROUP BY state
ORDER BY state;

-- 9. Slice 5 remains inactive. Informational only.
WITH params AS (SELECT :'school_id'::integer AS school_id)
SELECT id AS school_id, payout_engine_version
FROM schools s
JOIN params p ON p.school_id = s.id;
