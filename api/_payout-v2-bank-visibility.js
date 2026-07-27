const PAYOUT_V2_STATE_COPY = Object.freeze({
  planned: 'Statement planned; no transfer has been submitted.',
  claimed: 'Earnings claimed for this statement; no transfer has been submitted.',
  submitting: 'Connect transfer submission is in progress.',
  reconciling: 'Transfer evidence is being reconciled; do not retry or assume failure.',
  transferred: 'Transferred to the instructor’s connected Stripe balance; bank arrival is not yet confirmed.',
  failed_confirmed: 'Stripe confirms the Connect transfer was not created.',
  bank_paid: 'Stripe confirms the connected bank payout was paid.',
  bank_payout_failed: 'The Connect transfer still exists, but Stripe reports the downstream bank payout failed.',
});

function requirePositiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${field} must be a positive safe integer`);
  }
}

async function readPayoutV2BankVisibility({
  client,
  schoolId,
  now = new Date(),
}) {
  requirePositiveInteger(schoolId, 'schoolId');
  if (!client || typeof client.query !== 'function') {
    throw new TypeError('A database client is required');
  }
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError('now must be a valid Date');
  }

  const transferredWithoutVisibility = (await client.query(
    `SELECT
       pt.id AS payout_transfer_id,
       pt.payout_batch_id,
       pt.stripe_transfer_id,
       pt.amount_pence,
       pt.currency,
       pt.stripe_destination_account_id,
       pt.stripe_created_at
     FROM payout_transfers pt
    WHERE pt.school_id = $1
      AND pt.state = 'transferred'
      AND NOT EXISTS (
        SELECT 1
        FROM connected_bank_payout_transfer_links cbptl
        WHERE cbptl.school_id = pt.school_id
          AND cbptl.payout_transfer_id = pt.id
      )
    ORDER BY pt.stripe_created_at NULLS FIRST, pt.id`,
    [schoolId]
  )).rows;

  const payoutsWithoutCorrelation = (await client.query(
    `SELECT
       cbp.id AS connected_bank_payout_id,
       cbp.stripe_payout_id,
       cbp.stripe_account_id,
       cbp.amount_pence,
       cbp.currency,
       cbp.state,
       cbp.stripe_created_at
     FROM connected_bank_payouts cbp
    WHERE cbp.school_id = $1
      AND NOT EXISTS (
        SELECT 1
        FROM connected_bank_payout_transfer_links cbptl
        WHERE cbptl.school_id = cbp.school_id
          AND cbptl.connected_bank_payout_id = cbp.id
      )
    ORDER BY cbp.stripe_created_at NULLS FIRST, cbp.id`,
    [schoolId]
  )).rows;

  const identityConflicts = (await client.query(
    `SELECT
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
     JOIN connected_bank_payouts cbp
       ON cbp.school_id = cbptl.school_id
      AND cbp.id = cbptl.connected_bank_payout_id
     JOIN payout_transfers pt
       ON pt.school_id = cbptl.school_id
      AND pt.id = cbptl.payout_transfer_id
    WHERE cbptl.school_id = $1
      AND (
        cbp.stripe_account_id <> pt.stripe_destination_account_id
        OR cbptl.amount_pence <> pt.amount_pence
        OR cbptl.currency <> pt.currency
      )
    ORDER BY cbptl.id`,
    [schoolId]
  )).rows;

  const duplicateIdentities = (await client.query(
    `WITH duplicate_transfer_ids AS (
       SELECT stripe_transfer_id AS identity, COUNT(*)::int AS count
       FROM payout_transfers
       WHERE school_id = $1
         AND stripe_transfer_id IS NOT NULL
       GROUP BY stripe_transfer_id
       HAVING COUNT(*) > 1
     ),
     duplicate_payout_ids AS (
       SELECT stripe_payout_id AS identity, COUNT(*)::int AS count
       FROM connected_bank_payouts
       WHERE school_id = $1
       GROUP BY stripe_payout_id
       HAVING COUNT(*) > 1
     ),
     duplicate_balance_ids AS (
       SELECT stripe_balance_transaction_id AS identity, COUNT(*)::int AS count
       FROM connected_bank_payout_transfer_links
       WHERE school_id = $1
       GROUP BY stripe_balance_transaction_id
       HAVING COUNT(*) > 1
     )
     SELECT 'stripe_transfer_id' AS identity_type, identity, count
     FROM duplicate_transfer_ids
     UNION ALL
     SELECT 'stripe_payout_id', identity, count
     FROM duplicate_payout_ids
     UNION ALL
     SELECT 'stripe_balance_transaction_id', identity, count
     FROM duplicate_balance_ids
     ORDER BY identity_type, identity`,
    [schoolId]
  )).rows;

  const outOfOrderEvents = (await client.query(
    `WITH event_order AS (
       SELECT
         object_id AS stripe_payout_id,
         MIN(received_at) FILTER (WHERE event_type = 'payout.created')
           AS created_received_at,
         MIN(received_at) FILTER (
           WHERE event_type IN ('payout.paid', 'payout.failed')
         ) AS terminal_received_at
       FROM payout_v2_stripe_evidence_events
       WHERE school_id = $1
         AND object_type = 'payout'
       GROUP BY object_id
     )
     SELECT stripe_payout_id, created_received_at, terminal_received_at
     FROM event_order
     WHERE terminal_received_at IS NOT NULL
       AND (
         created_received_at IS NULL
         OR terminal_received_at < created_received_at
       )
     ORDER BY terminal_received_at`,
    [schoolId]
  )).rows;

  const stuckReceipts = (await client.query(
    `SELECT
       stripe_event_id,
       event_type,
       connected_account_id,
       received_at
     FROM stripe_event_receipts
    WHERE school_id = $1
      AND processing_status = 'processing'
      AND received_at < $2::timestamptz - INTERVAL '5 minutes'
    ORDER BY received_at`,
    [schoolId, now.toISOString()]
  )).rows;

  const operatorReviewEvents = (await client.query(
    `SELECT
       stripe_event_id,
       event_type,
       object_type,
       object_id,
       connected_account_id,
       operator_review_reasons,
       received_at
     FROM payout_v2_stripe_evidence_events
    WHERE school_id = $1
      AND disposition = 'operator_review'
    ORDER BY received_at, id`,
    [schoolId]
  )).rows;

  const stateCounts = (await client.query(
    `SELECT state, COUNT(*)::int AS count
     FROM payout_batches
    WHERE school_id = $1
    GROUP BY state
    ORDER BY state`,
    [schoolId]
  )).rows;

  const blockers = [
    ...transferredWithoutVisibility.map((row) => ({
      code: 'transferred_without_downstream_visibility',
      payout_transfer_id: Number(row.payout_transfer_id),
      payout_batch_id: Number(row.payout_batch_id),
    })),
    ...payoutsWithoutCorrelation.map((row) => ({
      code: 'bank_payout_without_safe_local_correlation',
      connected_bank_payout_id: Number(row.connected_bank_payout_id),
      stripe_payout_id: row.stripe_payout_id,
    })),
    ...identityConflicts.map((row) => ({
      code: 'conflicting_transfer_payout_identity',
      link_id: Number(row.link_id),
      payout_transfer_id: Number(row.payout_transfer_id),
      connected_bank_payout_id: Number(row.connected_bank_payout_id),
    })),
    ...duplicateIdentities.map((row) => ({
      code: 'duplicate_stripe_identity',
      identity_type: row.identity_type,
      identity: row.identity,
      count: Number(row.count),
    })),
    ...stuckReceipts.map((row) => ({
      code: 'stuck_processing_receipt',
      stripe_event_id: row.stripe_event_id,
      event_type: row.event_type,
    })),
    ...operatorReviewEvents.map((row) => ({
      code: 'stripe_event_operator_review',
      stripe_event_id: row.stripe_event_id,
      event_type: row.event_type,
      reasons: row.operator_review_reasons,
    })),
  ];

  return {
    ok: blockers.length === 0,
    mode: 'inactive_read_only',
    school_id: schoolId,
    generated_at: now.toISOString(),
    production_cron_connected: false,
    mutation_performed: false,
    operator_review_required: blockers.length > 0,
    blockers,
    transferred_without_downstream_visibility: transferredWithoutVisibility,
    bank_payouts_without_safe_correlation: payoutsWithoutCorrelation,
    identity_conflicts: identityConflicts,
    duplicate_identities: duplicateIdentities,
    out_of_order_events: outOfOrderEvents,
    stuck_processing_receipts: stuckReceipts,
    operator_review_events: operatorReviewEvents,
    batch_state_counts: stateCounts,
    state_copy: PAYOUT_V2_STATE_COPY,
  };
}

module.exports = {
  PAYOUT_V2_STATE_COPY,
  readPayoutV2BankVisibility,
};
