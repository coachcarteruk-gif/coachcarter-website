const {
  canonicalJson,
  fingerprintPayoutPlan,
} = require('./_payout-v2-contracts');
const { withNeonTransaction } = require('./_db-transaction');

const PAYOUT_V2_WEBHOOK_VERSION = 'payout-v2-webhook-v1';
const RECEIPT_STALE_MINUTES = 5;

const TRANSFER_EVENT_TYPES = new Set([
  'transfer.created',
  'transfer.updated',
  'transfer.reversed',
]);
const PAYOUT_EVENT_TYPES = new Set([
  'payout.created',
  'payout.updated',
  'payout.paid',
  'payout.failed',
]);
const NEGATIVE_SOURCE_EVENT_TYPES = new Set([
  'charge.refunded',
  'charge.dispute.created',
  'charge.dispute.updated',
  'charge.dispute.closed',
]);
const SUPPORTED_EVENT_TYPES = new Set([
  ...TRANSFER_EVENT_TYPES,
  ...PAYOUT_EVENT_TYPES,
  ...NEGATIVE_SOURCE_EVENT_TYPES,
]);

function webhookError(code, message, reasons = [], {
  retryable = false,
  operatorReviewRequired = false,
} = {}) {
  const error = new Error(message);
  error.code = code;
  error.reasons = reasons;
  error.retryable = retryable;
  error.operatorReviewRequired = operatorReviewRequired;
  return error;
}

function requirePositiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${field} must be a positive safe integer`);
  }
}

function cleanText(value, maxLength = 500) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text ? text.slice(0, maxLength) : null;
}

function stripeId(value, prefix) {
  const text = cleanText(typeof value === 'string' ? value : value?.id, 255);
  return text?.startsWith(prefix) ? text : null;
}

function unixTimestamp(value) {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) return null;
  return new Date(numeric * 1000);
}

function parseSchoolId(value) {
  const numeric = Number.parseInt(value, 10);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

function objectTypeForEvent(eventType) {
  if (TRANSFER_EVENT_TYPES.has(eventType)) return 'transfer';
  if (PAYOUT_EVENT_TYPES.has(eventType)) return 'payout';
  if (eventType === 'charge.refunded') return 'charge';
  if (NEGATIVE_SOURCE_EVENT_TYPES.has(eventType)) return 'dispute';
  return null;
}

function immutableTransferEvidence(transfer) {
  return {
    id: stripeId(transfer?.id, 'tr_'),
    object: transfer?.object || 'transfer',
    amount: Number(transfer?.amount),
    amount_reversed: Number(transfer?.amount_reversed || 0),
    reversed: transfer?.reversed === true,
    currency: cleanText(transfer?.currency, 10)?.toLowerCase() || null,
    destination: stripeId(transfer?.destination, 'acct_'),
    source_transaction: stripeId(transfer?.source_transaction, 'ch_'),
    transfer_group: cleanText(transfer?.transfer_group, 255),
    metadata: {
      school_id: cleanText(transfer?.metadata?.school_id, 32),
      payout_batch_id: cleanText(transfer?.metadata?.payout_batch_id, 32),
      payout_route: cleanText(transfer?.metadata?.payout_route, 64),
      plan_fingerprint: cleanText(transfer?.metadata?.plan_fingerprint, 80),
      logical_transfer_fingerprint:
        cleanText(
          transfer?.metadata?.payout_v2_logical_transfer_fingerprint ||
            transfer?.metadata?.logical_transfer_fingerprint,
          80
        ),
      stripe_idempotency_key:
        cleanText(
          transfer?.metadata?.payout_v2_idempotency_key ||
            transfer?.metadata?.stripe_idempotency_key,
          255
        ),
      source_group: cleanText(transfer?.metadata?.source_group, 255),
    },
    created: Number.isSafeInteger(Number(transfer?.created))
      ? Number(transfer.created)
      : null,
    livemode: transfer?.livemode === true,
  };
}

function immutablePayoutEvidence(payout) {
  return {
    id: stripeId(payout?.id, 'po_'),
    object: payout?.object || 'payout',
    amount: Number(payout?.amount),
    currency: cleanText(payout?.currency, 10)?.toLowerCase() || null,
    status: cleanText(payout?.status, 64)?.toLowerCase() || null,
    created: Number.isSafeInteger(Number(payout?.created))
      ? Number(payout.created)
      : null,
    arrival_date: Number.isSafeInteger(Number(payout?.arrival_date))
      ? Number(payout.arrival_date)
      : null,
    automatic: payout?.automatic === true,
    method: cleanText(payout?.method, 64),
    type: cleanText(payout?.type, 64),
    balance_transaction: stripeId(payout?.balance_transaction, 'txn_'),
    failure_balance_transaction:
      stripeId(payout?.failure_balance_transaction, 'txn_'),
    failure_code: cleanText(payout?.failure_code, 100),
    failure_message: cleanText(payout?.failure_message, 350),
    livemode: payout?.livemode === true,
  };
}

function immutableNegativeEvidence(eventType, object) {
  const dispute = eventType.startsWith('charge.dispute.') ? object : null;
  const charge = dispute
    ? (typeof dispute.charge === 'object' ? dispute.charge : null)
    : object;
  return {
    object_type: dispute ? 'dispute' : 'charge',
    object_id: dispute
      ? stripeId(dispute.id, 'dp_')
      : stripeId(charge?.id, 'ch_'),
    charge_id: dispute
      ? stripeId(dispute.charge, 'ch_')
      : stripeId(charge?.id, 'ch_'),
    amount: Number(dispute?.amount ?? charge?.amount_refunded ?? 0),
    currency:
      cleanText(dispute?.currency || charge?.currency, 10)?.toLowerCase() || null,
    dispute_status: cleanText(dispute?.status, 64),
    refunded: charge?.refunded === true,
    amount_refunded: Number(charge?.amount_refunded || 0),
    created: Number.isSafeInteger(Number(dispute?.created || charge?.created))
      ? Number(dispute?.created || charge?.created)
      : null,
    metadata_school_id: cleanText(
      dispute?.metadata?.school_id || charge?.metadata?.school_id,
      32
    ),
    livemode: object?.livemode === true,
  };
}

function payoutState(eventType, payoutStatus) {
  if (eventType === 'payout.paid' || payoutStatus === 'paid') return 'paid';
  if (eventType === 'payout.failed' || payoutStatus === 'failed') return 'failed';
  if (payoutStatus === 'in_transit') return 'in_transit';
  if (payoutStatus === 'canceled' || payoutStatus === 'cancelled') return 'cancelled';
  if (payoutStatus === 'pending') return 'pending';
  return 'created';
}

function transferIdentityReasons(local, evidence, schoolId) {
  const reasons = [];
  if (!evidence.id) reasons.push('missing_stripe_transfer_id');
  if (Number(local.amount_pence) !== evidence.amount) reasons.push('amount_mismatch');
  if (local.currency !== evidence.currency) reasons.push('currency_mismatch');
  if (local.stripe_destination_account_id !== evidence.destination) {
    reasons.push('destination_mismatch');
  }
  if ((local.stripe_source_charge_id || null) !== evidence.source_transaction) {
    reasons.push('source_transaction_mismatch');
  }
  if (local.transfer_group !== evidence.transfer_group) {
    reasons.push('transfer_group_mismatch');
  }
  if (local.logical_transfer_fingerprint !==
      evidence.metadata.logical_transfer_fingerprint) {
    reasons.push('logical_transfer_fingerprint_mismatch');
  }
  if (local.idempotency_key !== evidence.metadata.stripe_idempotency_key) {
    reasons.push('idempotency_metadata_mismatch');
  }
  if (local.plan_fingerprint !== evidence.metadata.plan_fingerprint) {
    reasons.push('plan_fingerprint_mismatch');
  }
  if (String(local.payout_batch_id) !== evidence.metadata.payout_batch_id) {
    reasons.push('payout_batch_metadata_mismatch');
  }
  if (String(schoolId) !== evidence.metadata.school_id) {
    reasons.push('school_metadata_mismatch');
  }
  if (local.stripe_transfer_id && local.stripe_transfer_id !== evidence.id) {
    reasons.push('stripe_transfer_id_mismatch');
  }
  return reasons;
}

function defaultTransactionRunner(connectionString) {
  if (!cleanText(connectionString, 2000)) {
    throw new TypeError('connectionString is required');
  }
  return (callback) => withNeonTransaction(connectionString, callback);
}

async function resolveConnectedAccountScope(client, connectedAccountId) {
  const accountId = stripeId(connectedAccountId, 'acct_');
  if (!accountId) {
    throw webhookError(
      'PAYOUT_V2_CONNECTED_ACCOUNT_REQUIRED',
      'A connected Stripe account is required',
      ['missing_connected_account'],
      { operatorReviewRequired: true }
    );
  }

  // This is the only deliberately global lookup: stripe_account_id is a
  // globally unique security anchor whose purpose is to derive school_id.
  const global = await client.query(
    `SELECT school_id
       FROM payout_v2_connected_account_scopes
      WHERE stripe_account_id = $1`,
    [accountId]
  );
  if (global.rowCount !== 1) {
    throw webhookError(
      global.rowCount === 0
        ? 'PAYOUT_V2_CONNECTED_ACCOUNT_UNKNOWN'
        : 'PAYOUT_V2_CONNECTED_ACCOUNT_CONTRADICTORY',
      'Connected Stripe account scope is unknown or contradictory',
      [global.rowCount === 0 ? 'unknown_connected_account' : 'duplicate_connected_account_scope'],
      { operatorReviewRequired: true }
    );
  }
  const schoolId = Number(global.rows[0].school_id);
  requirePositiveInteger(schoolId, 'resolved schoolId');
  const scoped = await client.query(
    `SELECT *
       FROM payout_v2_connected_account_scopes
      WHERE school_id = $1
        AND stripe_account_id = $2
      LIMIT 1`,
    [schoolId, accountId]
  );
  if (scoped.rowCount !== 1) {
    throw webhookError(
      'PAYOUT_V2_CONNECTED_ACCOUNT_SCOPE_CONFLICT',
      'Connected account failed explicit school verification',
      ['connected_account_scope_conflict'],
      { operatorReviewRequired: true }
    );
  }
  return {
    schoolId,
    connectedAccountId: accountId,
    ownerType: scoped.rows[0].owner_type,
    instructorId: scoped.rows[0].instructor_id
      ? Number(scoped.rows[0].instructor_id)
      : null,
    destinationSchoolId: scoped.rows[0].destination_school_id
      ? Number(scoped.rows[0].destination_school_id)
      : null,
  };
}

async function resolveEventScope(client, event) {
  const object = event.data?.object || {};
  if (PAYOUT_EVENT_TYPES.has(event.type)) {
    if (!event.account) {
      throw webhookError(
        'PAYOUT_V2_CONNECTED_ACCOUNT_REQUIRED',
        'Connected bank payout events require event.account',
        ['missing_event_account'],
        { operatorReviewRequired: true }
      );
    }
    return resolveConnectedAccountScope(client, event.account);
  }
  if (TRANSFER_EVENT_TYPES.has(event.type)) {
    const destination = stripeId(object.destination, 'acct_');
    const eventAccount = stripeId(event.account, 'acct_');
    if (destination && eventAccount && destination !== eventAccount) {
      throw webhookError(
        'PAYOUT_V2_CONNECTED_ACCOUNT_CONTRADICTION',
        'Transfer destination contradicts connected event account',
        ['event_account_destination_mismatch'],
        { operatorReviewRequired: true }
      );
    }
    const scope = await resolveConnectedAccountScope(client, destination || eventAccount);
    const metadataSchoolId = parseSchoolId(object.metadata?.school_id);
    if (!metadataSchoolId || metadataSchoolId !== scope.schoolId) {
      throw webhookError(
        'PAYOUT_V2_TRANSFER_SCHOOL_CONTRADICTION',
        'Transfer metadata does not match the connected account school',
        [metadataSchoolId ? 'cross_school_transfer_metadata' : 'missing_transfer_school_metadata'],
        { operatorReviewRequired: true }
      );
    }
    return scope;
  }

  const negative = immutableNegativeEvidence(event.type, object);
  const schoolId = parseSchoolId(negative.metadata_school_id);
  if (!schoolId) {
    throw webhookError(
      'PAYOUT_V2_NEGATIVE_EVIDENCE_SCOPE_REQUIRED',
      'Refund or dispute evidence has no explicit school metadata',
      ['missing_negative_evidence_school_scope'],
      { operatorReviewRequired: true }
    );
  }
  const match = await client.query(
    `SELECT COUNT(*)::int AS count
       FROM payout_transfers
      WHERE school_id = $1
        AND stripe_source_charge_id = $2`,
    [schoolId, negative.charge_id]
  );
  if (Number(match.rows[0]?.count || 0) === 0) {
    throw webhookError(
      'PAYOUT_V2_NEGATIVE_EVIDENCE_SCOPE_UNKNOWN',
      'Refund or dispute charge has no same-school Payout v2 transfer',
      ['unknown_same_school_source_charge'],
      { operatorReviewRequired: true }
    );
  }
  return {
    schoolId,
    connectedAccountId: null,
    ownerType: null,
    instructorId: null,
    destinationSchoolId: null,
  };
}

async function claimReceipt(client, { schoolId, event, objectId, accountId }) {
  const inserted = await client.query(
    `INSERT INTO stripe_event_receipts (
       school_id, stripe_event_id, event_type, livemode, object_id,
       connected_account_id, processing_status
     )
     VALUES ($1, $2, $3, $4, $5, $6, 'processing')
     ON CONFLICT (school_id, stripe_event_id)
     DO UPDATE SET
       processing_status = 'processing',
       processed_at = NULL,
       last_error = NULL
     WHERE stripe_event_receipts.event_type = EXCLUDED.event_type
       AND stripe_event_receipts.livemode = EXCLUDED.livemode
       AND stripe_event_receipts.object_id IS NOT DISTINCT FROM EXCLUDED.object_id
       AND stripe_event_receipts.connected_account_id
             IS NOT DISTINCT FROM EXCLUDED.connected_account_id
       AND (
         stripe_event_receipts.processing_status IN ('received', 'failed')
         OR (
           stripe_event_receipts.processing_status = 'processing'
           AND stripe_event_receipts.received_at <
             NOW() - ($7::text || ' minutes')::interval
         )
       )
     RETURNING *`,
    [
      schoolId,
      event.id,
      event.type,
      event.livemode === true,
      objectId,
      accountId,
      String(RECEIPT_STALE_MINUTES),
    ]
  );
  if (inserted.rows[0]) return { claimed: true, receipt: inserted.rows[0] };

  const existing = await client.query(
    `SELECT *
       FROM stripe_event_receipts
      WHERE school_id = $1
        AND stripe_event_id = $2
      LIMIT 1`,
    [schoolId, event.id]
  );
  const row = existing.rows[0];
  if (
    row &&
    (
      row.event_type !== event.type ||
      row.livemode !== (event.livemode === true) ||
      (row.object_id || null) !== objectId ||
      (row.connected_account_id || null) !== accountId
    )
  ) {
    throw webhookError(
      'PAYOUT_V2_EVENT_RECEIPT_CONFLICT',
      'Stripe event replay contradicts immutable receipt evidence',
      ['event_receipt_identity_conflict'],
      { operatorReviewRequired: true }
    );
  }
  return { claimed: false, receipt: row || null };
}

async function finishReceipt(client, {
  schoolId,
  eventId,
  status,
  error = null,
}) {
  const lastError = error
    ? cleanText(
      `${cleanText(error.code, 100) || 'processing_failed'}: ` +
      `${cleanText(error.message, 350) || 'processing failed'}`,
      500
    )
    : null;
  const result = await client.query(
    `UPDATE stripe_event_receipts
        SET processing_status = $3,
            processed_at = CASE WHEN $3 IN ('processed', 'manual_review')
                                THEN NOW() ELSE NULL END,
            last_error = $4
      WHERE school_id = $1
        AND stripe_event_id = $2
        AND processing_status = 'processing'
      RETURNING *`,
    [schoolId, eventId, status, lastError]
  );
  if (result.rowCount !== 1) {
    throw webhookError(
      'PAYOUT_V2_EVENT_RECEIPT_STATE_CONFLICT',
      'Stripe event receipt is no longer claimable',
      ['event_receipt_state_conflict'],
      { retryable: true }
    );
  }
  return result.rows[0];
}

async function recordFailedReceipt(transaction, {
  schoolId,
  event,
  objectId,
  accountId,
  error,
}) {
  if (!schoolId) return null;
  return transaction(async (client) => {
    await client.query(
      `INSERT INTO stripe_event_receipts (
         school_id, stripe_event_id, event_type, livemode, object_id,
         connected_account_id, processing_status, last_error
       )
       VALUES ($1, $2, $3, $4, $5, $6, 'failed', $7)
       ON CONFLICT (school_id, stripe_event_id)
       DO UPDATE SET
         processing_status = 'failed',
         processed_at = NULL,
         last_error = EXCLUDED.last_error
       WHERE stripe_event_receipts.event_type = EXCLUDED.event_type
         AND stripe_event_receipts.livemode = EXCLUDED.livemode
         AND stripe_event_receipts.object_id IS NOT DISTINCT FROM EXCLUDED.object_id
         AND stripe_event_receipts.connected_account_id
               IS NOT DISTINCT FROM EXCLUDED.connected_account_id
         AND stripe_event_receipts.processing_status <> 'processed'`,
      [
        schoolId,
        event.id,
        event.type,
        event.livemode === true,
        objectId,
        accountId,
        cleanText(
          `${cleanText(error?.code, 100) || 'processing_failed'}: ` +
          `${cleanText(error?.message, 350) || 'processing failed'}`,
          500
        ),
      ]
    );
  });
}

async function insertEvidenceEvent(client, {
  schoolId,
  event,
  objectType,
  objectId,
  accountId,
  disposition,
  reasons,
  evidence,
}) {
  const body = {
    school_id: schoolId,
    stripe_event_id: event.id,
    event_type: event.type,
    livemode: event.livemode === true,
    connected_account_id: accountId,
    object_type: objectType,
    object_id: objectId,
    disposition,
    operator_review_reasons: [...reasons].sort(),
    evidence,
  };
  const fingerprint = fingerprintPayoutPlan(body, PAYOUT_V2_WEBHOOK_VERSION);
  const inserted = await client.query(
    `INSERT INTO payout_v2_stripe_evidence_events (
       school_id, stripe_event_id, event_type, livemode,
       connected_account_id, object_type, object_id, disposition,
       operator_review_reasons, evidence_fingerprint, evidence_json,
       stripe_created_at
     )
     VALUES (
       $1, $2, $3, $4,
       $5, $6, $7, $8,
       $9::jsonb, $10, $11::jsonb, $12
     )
     ON CONFLICT (stripe_event_id) DO NOTHING
     RETURNING *`,
    [
      schoolId,
      event.id,
      event.type,
      event.livemode === true,
      accountId,
      objectType,
      objectId,
      disposition,
      JSON.stringify(body.operator_review_reasons),
      fingerprint,
      JSON.stringify(evidence),
      unixTimestamp(event.created)?.toISOString() || null,
    ]
  );
  const row = inserted.rows[0] || (await client.query(
    `SELECT *
       FROM payout_v2_stripe_evidence_events
      WHERE school_id = $1
        AND stripe_event_id = $2
      LIMIT 1`,
    [schoolId, event.id]
  )).rows[0];
  if (
    !row ||
    row.evidence_fingerprint !== fingerprint ||
    row.disposition !== disposition
  ) {
    throw webhookError(
      'PAYOUT_V2_EVENT_EVIDENCE_CONFLICT',
      'Existing Stripe event evidence contradicts this delivery',
      ['stripe_event_evidence_conflict'],
      { operatorReviewRequired: true }
    );
  }
  return row;
}

async function linkEvidenceToTransfer(client, {
  schoolId,
  evidenceEventId,
  transferId,
  relationship,
  identityStatus,
  evidence = {},
}) {
  await client.query(
    `INSERT INTO payout_v2_stripe_evidence_transfer_links (
       school_id, stripe_evidence_event_id, payout_transfer_id,
       relationship, identity_status, evidence_json
     )
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT (
       school_id, stripe_evidence_event_id, payout_transfer_id, relationship
     ) DO NOTHING`,
    [
      schoolId,
      evidenceEventId,
      transferId,
      relationship,
      identityStatus,
      JSON.stringify(evidence),
    ]
  );
}

async function refreshTransferredBatch(client, schoolId, batchId) {
  const incomplete = await client.query(
    `SELECT COUNT(*)::int AS count
       FROM payout_transfers
      WHERE school_id = $1
        AND payout_batch_id = $2
        AND state <> 'transferred'`,
    [schoolId, batchId]
  );
  if (Number(incomplete.rows[0]?.count || 0) === 0) {
    await client.query(
      `UPDATE payout_batches
          SET state = 'transferred',
              settled_at = COALESCE(settled_at, NOW()),
              failure_reason = NULL
        WHERE school_id = $1
          AND id = $2
          AND state IN ('claimed', 'submitting', 'reconciling', 'transferred')`,
      [schoolId, batchId]
    );
  }
}

async function processTransferEvent(client, {
  schoolId,
  event,
  accountId,
}) {
  const evidence = immutableTransferEvidence(event.data.object);
  const candidate = await client.query(
    `SELECT *
       FROM payout_transfers
      WHERE school_id = $1
        AND (
          stripe_transfer_id = $2
          OR logical_transfer_fingerprint = $3
          OR idempotency_key = $4
          OR transfer_group = $5
        )
      ORDER BY id
      FOR UPDATE`,
    [
      schoolId,
      evidence.id,
      evidence.metadata.logical_transfer_fingerprint,
      evidence.metadata.stripe_idempotency_key,
      evidence.transfer_group,
    ]
  );
  let reasons = [];
  if (candidate.rowCount !== 1) {
    reasons.push(
      candidate.rowCount === 0
        ? 'local_transfer_not_found'
        : 'multiple_local_transfer_candidates'
    );
  }
  const local = candidate.rowCount === 1 ? candidate.rows[0] : null;
  if (local) reasons.push(...transferIdentityReasons(local, evidence, schoolId));
  if (
    event.type === 'transfer.reversed' &&
    evidence.amount_reversed > 0 &&
    evidence.amount_reversed !== evidence.amount
  ) {
    reasons.push('partial_transfer_reversal');
  }
  const disposition = reasons.length > 0 ? 'operator_review' : 'applied';
  const evidenceRow = await insertEvidenceEvent(client, {
    schoolId,
    event,
    objectType: 'transfer',
    objectId: evidence.id || event.data.object?.id || 'unknown_transfer',
    accountId,
    disposition,
    reasons,
    evidence,
  });
  if (!local || reasons.length > 0) {
    if (local) {
      await linkEvidenceToTransfer(client, {
        schoolId,
        evidenceEventId: Number(evidenceRow.id),
        transferId: Number(local.id),
        relationship: event.type === 'transfer.reversed'
          ? 'transfer_reversal'
          : 'transfer_observed',
        identityStatus: 'contradictory',
        evidence: { reasons },
      });
    }
    return {
      status: 'operator_review_required',
      operator_review_required: true,
      reasons,
      transfer_id: local ? Number(local.id) : null,
    };
  }

  const reversed = event.type === 'transfer.reversed' ||
    (evidence.reversed && evidence.amount_reversed === evidence.amount);
  await client.query(
    `UPDATE payout_transfers
        SET stripe_transfer_id = COALESCE(stripe_transfer_id, $3),
            state = $4,
            stripe_created_at = COALESCE(
              stripe_created_at,
              TO_TIMESTAMP($5)
            ),
            reconciled_at = COALESCE(reconciled_at, NOW()),
            last_error_code = CASE WHEN $4 = 'reversed'
                                   THEN 'stripe_transfer_reversed' ELSE NULL END,
            last_error_message = CASE WHEN $4 = 'reversed'
                                      THEN 'Stripe reports the Connect transfer was reversed'
                                      ELSE NULL END
      WHERE school_id = $1
        AND id = $2`,
    [
      schoolId,
      local.id,
      evidence.id,
      reversed ? 'reversed' : 'transferred',
      evidence.created || Math.floor(Date.now() / 1000),
    ]
  );
  await linkEvidenceToTransfer(client, {
    schoolId,
    evidenceEventId: Number(evidenceRow.id),
    transferId: Number(local.id),
    relationship: reversed ? 'transfer_reversal' : 'transfer_observed',
    identityStatus: 'matched',
    evidence: {
      stripe_transfer_id: evidence.id,
      amount_reversed: evidence.amount_reversed,
    },
  });
  if (reversed) {
    await client.query(
      `UPDATE payout_batches
          SET state = 'reconciling',
              failure_reason = 'transfer_reversal_operator_review'
        WHERE school_id = $1
          AND id = $2`,
      [schoolId, local.payout_batch_id]
    );
  } else {
    await refreshTransferredBatch(
      client,
      schoolId,
      Number(local.payout_batch_id)
    );
  }
  return {
    status: reversed ? 'transfer_reversal_recorded' : 'transfer_observed',
    operator_review_required: reversed,
    reasons: reversed ? ['transfer_reversal_requires_operator_review'] : [],
    transfer_id: Number(local.id),
    stripe_transfer_id: evidence.id,
  };
}

function normaliseBalanceTransactions(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  return [];
}

function immutableBalanceTransactionEvidence(row) {
  return {
    id: stripeId(row?.id, 'txn_'),
    type: cleanText(row?.type, 64),
    amount: Number(row?.amount),
    currency: cleanText(row?.currency, 10)?.toLowerCase() || null,
    source: stripeId(row?.source, 'tr_'),
    payout: stripeId(row?.payout, 'po_'),
    created: Number.isSafeInteger(Number(row?.created))
      ? Number(row.created)
      : null,
    available_on: Number.isSafeInteger(Number(row?.available_on))
      ? Number(row.available_on)
      : null,
  };
}

async function upsertConnectedBankPayout(client, {
  schoolId,
  accountId,
  event,
  evidence,
}) {
  const desiredState = payoutState(event.type, evidence.status);
  const inserted = await client.query(
    `INSERT INTO connected_bank_payouts (
       school_id, stripe_account_id, stripe_payout_id, payout_batch_id,
       amount_pence, currency, state, arrival_estimate, stripe_created_at,
       paid_at, failed_at, failure_code, failure_message, evidence_json
     )
     VALUES (
       $1, $2, $3, NULL,
       $4, $5, $6, $7, $8,
       $9, $10, $11, $12, $13::jsonb
     )
     ON CONFLICT (stripe_payout_id) DO NOTHING
     RETURNING *`,
    [
      schoolId,
      accountId,
      evidence.id,
      evidence.amount,
      evidence.currency,
      desiredState,
      unixTimestamp(evidence.arrival_date)?.toISOString() || null,
      unixTimestamp(evidence.created)?.toISOString() || null,
      desiredState === 'paid'
        ? (unixTimestamp(event.created)?.toISOString() || new Date().toISOString())
        : null,
      desiredState === 'failed'
        ? (unixTimestamp(event.created)?.toISOString() || new Date().toISOString())
        : null,
      evidence.failure_code,
      evidence.failure_message,
      JSON.stringify({ latest_event_id: event.id, latest_event_type: event.type }),
    ]
  );
  const row = inserted.rows[0] || (await client.query(
    `SELECT *
       FROM connected_bank_payouts
      WHERE school_id = $1
        AND stripe_payout_id = $2
      LIMIT 1
      FOR UPDATE`,
    [schoolId, evidence.id]
  )).rows[0];
  if (!row) {
    return {
      row: null,
      reasons: ['stripe_payout_id_owned_by_another_school'],
    };
  }
  const contradictions = [];
  if (row.stripe_account_id !== accountId) contradictions.push('payout_account_mismatch');
  if (Number(row.amount_pence) !== evidence.amount) contradictions.push('payout_amount_mismatch');
  if (row.currency !== evidence.currency) contradictions.push('payout_currency_mismatch');
  if (
    row.stripe_created_at &&
    evidence.created &&
    new Date(row.stripe_created_at).getTime() !== evidence.created * 1000
  ) {
    contradictions.push('payout_created_time_mismatch');
  }
  const terminalConflict =
    (row.state === 'paid' && desiredState === 'failed') ||
    (row.state === 'failed' && desiredState === 'paid');
  if (terminalConflict) contradictions.push('payout_terminal_state_conflict');

  const nextState = contradictions.length > 0
    ? 'manual_review'
    : (
      row.state === 'paid' || row.state === 'failed'
        ? row.state
        : desiredState
    );
  const updated = await client.query(
    `UPDATE connected_bank_payouts
        SET state = $3,
            arrival_estimate = COALESCE(arrival_estimate, $4),
            paid_at = CASE WHEN $3 = 'paid'
                           THEN COALESCE(paid_at, $5) ELSE paid_at END,
            failed_at = CASE WHEN $3 = 'failed'
                             THEN COALESCE(failed_at, $6) ELSE failed_at END,
            failure_code = CASE WHEN $3 = 'failed'
                                THEN COALESCE(failure_code, $7) ELSE failure_code END,
            failure_message = CASE WHEN $3 = 'failed'
                                   THEN COALESCE(failure_message, $8) ELSE failure_message END,
            evidence_json = $9::jsonb,
            updated_at = NOW()
      WHERE school_id = $1
        AND id = $2
      RETURNING *`,
    [
      schoolId,
      row.id,
      nextState,
      unixTimestamp(evidence.arrival_date)?.toISOString() || null,
      unixTimestamp(event.created)?.toISOString() || new Date().toISOString(),
      unixTimestamp(event.created)?.toISOString() || new Date().toISOString(),
      evidence.failure_code,
      evidence.failure_message,
      JSON.stringify({
        latest_event_id: event.id,
        latest_event_type: event.type,
        operator_review_reasons: contradictions,
      }),
    ]
  );
  return { row: updated.rows[0], reasons: contradictions };
}

async function insertPayoutTransferLink(client, {
  schoolId,
  connectedPayoutId,
  transfer,
  balanceEvidence,
}) {
  const body = {
    school_id: schoolId,
    connected_bank_payout_id: Number(connectedPayoutId),
    payout_transfer_id: Number(transfer.id),
    stripe_balance_transaction_id: balanceEvidence.id,
    amount_pence: balanceEvidence.amount,
    currency: balanceEvidence.currency,
  };
  const fingerprint = fingerprintPayoutPlan(body, PAYOUT_V2_WEBHOOK_VERSION);
  await client.query(
    `INSERT INTO connected_bank_payout_transfer_links (
       school_id, connected_bank_payout_id, payout_transfer_id,
       stripe_balance_transaction_id, amount_pence, currency,
       link_fingerprint, evidence_json
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     ON CONFLICT (
       school_id, connected_bank_payout_id, payout_transfer_id
     ) DO NOTHING`,
    [
      schoolId,
      connectedPayoutId,
      transfer.id,
      balanceEvidence.id,
      balanceEvidence.amount,
      balanceEvidence.currency,
      fingerprint,
      JSON.stringify(balanceEvidence),
    ]
  );
  const existing = await client.query(
    `SELECT *
       FROM connected_bank_payout_transfer_links
      WHERE school_id = $1
        AND connected_bank_payout_id = $2
        AND payout_transfer_id = $3
      LIMIT 1`,
    [schoolId, connectedPayoutId, transfer.id]
  );
  if (!existing.rows[0] || existing.rows[0].link_fingerprint !== fingerprint) {
    throw webhookError(
      'PAYOUT_V2_BANK_PAYOUT_LINK_CONFLICT',
      'Existing bank-payout correlation contradicts Stripe evidence',
      ['connected_payout_transfer_link_conflict'],
      { operatorReviewRequired: true }
    );
  }
}

async function refreshBankBatchStates(client, schoolId, batchIds) {
  const uniqueBatchIds = [...new Set(batchIds.map(Number).filter(Number.isSafeInteger))];
  for (const batchId of uniqueBatchIds) {
    const [summary] = (await client.query(
      `SELECT
         COUNT(pt.id)::int AS transfer_count,
         COUNT(pt.id) FILTER (
           WHERE EXISTS (
             SELECT 1
             FROM connected_bank_payout_transfer_links cbptl
             JOIN connected_bank_payouts cbp
               ON cbp.school_id = cbptl.school_id
              AND cbp.id = cbptl.connected_bank_payout_id
             WHERE cbptl.school_id = pt.school_id
               AND cbptl.payout_transfer_id = pt.id
               AND cbp.state = 'paid'
           )
         )::int AS paid_count,
         COUNT(pt.id) FILTER (
           WHERE EXISTS (
             SELECT 1
             FROM connected_bank_payout_transfer_links cbptl
             JOIN connected_bank_payouts cbp
               ON cbp.school_id = cbptl.school_id
              AND cbp.id = cbptl.connected_bank_payout_id
             WHERE cbptl.school_id = pt.school_id
               AND cbptl.payout_transfer_id = pt.id
               AND cbp.state = 'failed'
           )
         )::int AS failed_count,
         COUNT(pt.id) FILTER (WHERE pt.state <> 'transferred')::int
           AS non_transferred_count
       FROM payout_transfers pt
      WHERE pt.school_id = $1
        AND pt.payout_batch_id = $2`,
      [schoolId, batchId]
    )).rows;
    const transferCount = Number(summary?.transfer_count || 0);
    const paidCount = Number(summary?.paid_count || 0);
    const failedCount = Number(summary?.failed_count || 0);
    const nonTransferred = Number(summary?.non_transferred_count || 0);
    if (transferCount > 0 && paidCount === transferCount && nonTransferred === 0) {
      await client.query(
        `UPDATE payout_batches
            SET state = 'bank_paid',
                settled_at = COALESCE(settled_at, NOW()),
                failure_reason = NULL
          WHERE school_id = $1
            AND id = $2
            AND state IN ('transferred', 'bank_payout_failed', 'bank_paid')`,
        [schoolId, batchId]
      );
    } else if (failedCount > 0) {
      await client.query(
        `UPDATE payout_batches
            SET state = 'bank_payout_failed',
                failure_reason = 'connected_bank_payout_failed'
          WHERE school_id = $1
            AND id = $2
            AND state IN ('transferred', 'bank_payout_failed')`,
        [schoolId, batchId]
      );
    }
  }
}

async function processPayoutEvent(client, {
  schoolId,
  event,
  accountId,
  balanceTransactions,
  transferObjects,
}) {
  const evidence = immutablePayoutEvidence(event.data.object);
  let reasons = [];
  if (!evidence.id) reasons.push('missing_stripe_payout_id');
  if (!Number.isSafeInteger(evidence.amount) || evidence.amount <= 0) {
    reasons.push('invalid_payout_amount');
  }
  if (!evidence.currency) reasons.push('invalid_payout_currency');
  const upsert = await upsertConnectedBankPayout(client, {
    schoolId,
    accountId,
    event,
    evidence,
  });
  reasons.push(...upsert.reasons);
  const payoutRow = upsert.row;
  const batchIds = [];
  const matchedTransferIds = [];
  const rows = normaliseBalanceTransactions(balanceTransactions);
  if (rows.length === 0) reasons.push('payout_balance_transactions_unavailable');

  if (payoutRow) {
    for (const raw of rows) {
      const balanceEvidence = immutableBalanceTransactionEvidence(raw);
      if (
        !balanceEvidence.id ||
        balanceEvidence.payout !== evidence.id ||
        balanceEvidence.type !== 'transfer' ||
        !balanceEvidence.source
      ) {
        reasons.push(
          balanceEvidence.type === 'transfer'
            ? 'contradictory_payout_balance_transaction'
            : 'unmatched_non_transfer_payout_balance_transaction'
        );
        continue;
      }
      const local = await client.query(
        `SELECT *
           FROM payout_transfers
          WHERE school_id = $1
            AND stripe_transfer_id = $2
          LIMIT 2`,
        [schoolId, balanceEvidence.source]
      );
      if (local.rowCount !== 1) {
        reasons.push(
          local.rowCount === 0
            ? `unmatched_transfer:${balanceEvidence.source}`
            : `duplicate_local_transfer:${balanceEvidence.source}`
        );
        continue;
      }
      const transfer = local.rows[0];
      const stripeTransfer = transferObjects.get(balanceEvidence.source);
      if (!stripeTransfer) {
        reasons.push(`missing_stripe_transfer_read:${balanceEvidence.source}`);
        continue;
      }
      const transferEvidence = immutableTransferEvidence(stripeTransfer);
      const identityReasons = transferIdentityReasons(
        transfer,
        transferEvidence,
        schoolId
      );
      if (balanceEvidence.amount !== Number(transfer.amount_pence)) {
        identityReasons.push('balance_transaction_amount_mismatch');
      }
      if (balanceEvidence.currency !== transfer.currency) {
        identityReasons.push('balance_transaction_currency_mismatch');
      }
      if (transfer.stripe_destination_account_id !== accountId) {
        identityReasons.push('balance_transaction_destination_mismatch');
      }
      if (identityReasons.length > 0) {
        reasons.push(...identityReasons.map(
          (reason) => `${balanceEvidence.source}:${reason}`
        ));
        continue;
      }
      await insertPayoutTransferLink(client, {
        schoolId,
        connectedPayoutId: Number(payoutRow.id),
        transfer,
        balanceEvidence,
      });
      matchedTransferIds.push(Number(transfer.id));
      batchIds.push(Number(transfer.payout_batch_id));
    }
  }

  const uniqueReasons = [...new Set(reasons)].sort();
  const disposition = uniqueReasons.length > 0
    ? 'operator_review'
    : (matchedTransferIds.length > 0 ? 'applied' : 'operator_review');
  if (matchedTransferIds.length === 0 && uniqueReasons.length === 0) {
    uniqueReasons.push('payout_has_no_payout_v2_transfer_correlation');
  }
  await insertEvidenceEvent(client, {
    schoolId,
    event,
    objectType: 'payout',
    objectId: evidence.id || event.data.object?.id || 'unknown_payout',
    accountId,
    disposition,
    reasons: uniqueReasons,
    evidence: {
      payout: evidence,
      balance_transactions: rows.map(immutableBalanceTransactionEvidence),
      matched_payout_transfer_ids: matchedTransferIds.sort((a, b) => a - b),
    },
  });
  await refreshBankBatchStates(client, schoolId, batchIds);
  return {
    status: disposition === 'applied'
      ? `bank_payout_${payoutRow.state}`
      : 'operator_review_required',
    operator_review_required: disposition !== 'applied',
    reasons: uniqueReasons,
    connected_bank_payout_id: payoutRow ? Number(payoutRow.id) : null,
    stripe_payout_id: evidence.id,
    matched_transfer_ids: matchedTransferIds,
    connect_transfer_amounts_remain_separate: true,
    connected_bank_payout_amount_pence: evidence.amount,
  };
}

async function processNegativeSourceEvent(client, {
  schoolId,
  event,
}) {
  const evidence = immutableNegativeEvidence(event.type, event.data.object);
  const matches = await client.query(
    `SELECT id
       FROM payout_transfers
      WHERE school_id = $1
        AND stripe_source_charge_id = $2
      ORDER BY id`,
    [schoolId, evidence.charge_id]
  );
  const reasons = matches.rowCount === 0
    ? ['no_same_school_transfer_for_negative_source_evidence']
    : [];
  const evidenceRow = await insertEvidenceEvent(client, {
    schoolId,
    event,
    objectType: evidence.object_type,
    objectId: evidence.object_id || event.data.object?.id || 'unknown_source_object',
    accountId: null,
    disposition: reasons.length > 0 ? 'operator_review' : 'applied',
    reasons,
    evidence,
  });
  const relationship = event.type === 'charge.refunded'
    ? 'source_refund'
    : 'source_dispute';
  for (const row of matches.rows) {
    await linkEvidenceToTransfer(client, {
      schoolId,
      evidenceEventId: Number(evidenceRow.id),
      transferId: Number(row.id),
      relationship,
      identityStatus: 'matched',
      evidence: {
        charge_id: evidence.charge_id,
        negative_event_type: event.type,
      },
    });
  }
  return {
    status: reasons.length > 0
      ? 'operator_review_required'
      : 'negative_source_evidence_recorded',
    operator_review_required: true,
    reasons: reasons.length > 0
      ? reasons
      : ['negative_source_evidence_requires_operator_review'],
    matched_transfer_ids: matches.rows.map((row) => Number(row.id)),
    automatic_adjustment_created: false,
    stripe_mutation_called: false,
  };
}

async function ingestSignedPayoutV2Webhook({
  rawBody,
  signature,
  webhookSecret,
  constructEvent,
  connectionString = null,
  runInTransaction = null,
  stripeReader = null,
}) {
  if (typeof constructEvent !== 'function') {
    throw new TypeError('An injected constructEvent verifier is required');
  }
  if (rawBody == null || rawBody === '') {
    throw webhookError(
      'PAYOUT_V2_WEBHOOK_RAW_BODY_REQUIRED',
      'Stripe webhook raw body is required'
    );
  }
  if (!cleanText(signature, 2000)) {
    throw webhookError(
      'PAYOUT_V2_WEBHOOK_SIGNATURE_REQUIRED',
      'Stripe-Signature header is required'
    );
  }
  if (!cleanText(webhookSecret, 1000)) {
    throw webhookError(
      'PAYOUT_V2_WEBHOOK_SECRET_REQUIRED',
      'Webhook signing secret is required'
    );
  }

  // No database or Stripe read is allowed before this call succeeds.
  let event;
  try {
    event = constructEvent(rawBody, signature, webhookSecret);
  } catch {
    throw webhookError(
      'PAYOUT_V2_WEBHOOK_SIGNATURE_INVALID',
      'Stripe webhook signature verification failed'
    );
  }
  if (
    !stripeId(event?.id, 'evt_') ||
    !cleanText(event?.type, 255) ||
    !event?.data?.object
  ) {
    throw webhookError(
      'PAYOUT_V2_WEBHOOK_EVENT_INVALID',
      'Verified Stripe event has an invalid envelope'
    );
  }
  if (!SUPPORTED_EVENT_TYPES.has(event.type)) {
    return {
      ok: true,
      status: 'ignored_verified_event',
      event_type: event.type,
      supported: false,
      production_route_connected: false,
    };
  }

  const transaction = runInTransaction || defaultTransactionRunner(connectionString);
  const objectType = objectTypeForEvent(event.type);
  const objectId = cleanText(event.data.object.id, 255);
  let scope = null;
  let claimed = false;
  try {
    const claim = await transaction(async (client) => {
      const resolved = await resolveEventScope(client, event);
      const receipt = await claimReceipt(client, {
        schoolId: resolved.schoolId,
        event,
        objectId,
        accountId: resolved.connectedAccountId,
      });
      return { resolved, receipt };
    });
    scope = claim.resolved;
    if (!claim.receipt.claimed) {
      return {
        ok: true,
        status: claim.receipt.receipt?.processing_status === 'processed'
          ? 'duplicate_processed'
          : 'duplicate_in_progress_or_manual_review',
        duplicate: true,
        school_id: scope.schoolId,
        event_id: event.id,
        event_type: event.type,
        production_route_connected: false,
      };
    }
    claimed = true;

    let balanceTransactions = [];
    const transferObjects = new Map();
    if (PAYOUT_EVENT_TYPES.has(event.type)) {
      if (
        typeof stripeReader?.listPayoutBalanceTransactions !== 'function' ||
        typeof stripeReader?.retrieveTransfer !== 'function'
      ) {
        throw webhookError(
          'PAYOUT_V2_STRIPE_READER_REQUIRED',
          'Injected Stripe payout reads are required for exact correlation',
          ['missing_injected_stripe_reader'],
          { retryable: true }
        );
      }
      balanceTransactions = await stripeReader.listPayoutBalanceTransactions({
        connectedAccountId: scope.connectedAccountId,
        payoutId: objectId,
      });
      for (const row of normaliseBalanceTransactions(balanceTransactions)) {
        const transferId = stripeId(row?.source, 'tr_');
        if (transferId && !transferObjects.has(transferId)) {
          transferObjects.set(
            transferId,
            await stripeReader.retrieveTransfer({
              connectedAccountId: scope.connectedAccountId,
              stripeTransferId: transferId,
            })
          );
        }
      }
    }

    const result = await transaction(async (client) => {
      let processed;
      if (TRANSFER_EVENT_TYPES.has(event.type)) {
        processed = await processTransferEvent(client, {
          schoolId: scope.schoolId,
          event,
          accountId: scope.connectedAccountId,
        });
      } else if (PAYOUT_EVENT_TYPES.has(event.type)) {
        processed = await processPayoutEvent(client, {
          schoolId: scope.schoolId,
          event,
          accountId: scope.connectedAccountId,
          balanceTransactions,
          transferObjects,
        });
      } else {
        processed = await processNegativeSourceEvent(client, {
          schoolId: scope.schoolId,
          event,
        });
      }
      await finishReceipt(client, {
        schoolId: scope.schoolId,
        eventId: event.id,
        status: processed.operator_review_required
          ? 'manual_review'
          : 'processed',
      });
      return processed;
    });
    return {
      ok: !result.operator_review_required,
      ...result,
      school_id: scope.schoolId,
      event_id: event.id,
      event_type: event.type,
      signature_verified: true,
      receipt_deduplicated: true,
      production_route_connected: false,
      stripe_mutation_called: false,
    };
  } catch (error) {
    if (claimed && scope?.schoolId) {
      await recordFailedReceipt(transaction, {
        schoolId: scope.schoolId,
        event,
        objectId,
        accountId: scope.connectedAccountId,
        error,
      }).catch(() => {});
    }
    if (!error.code) {
      error.code = 'PAYOUT_V2_WEBHOOK_PROCESSING_FAILED';
      error.retryable = true;
    }
    throw error;
  }
}

module.exports = {
  PAYOUT_V2_WEBHOOK_VERSION,
  RECEIPT_STALE_MINUTES,
  SUPPORTED_EVENT_TYPES,
  TRANSFER_EVENT_TYPES,
  PAYOUT_EVENT_TYPES,
  NEGATIVE_SOURCE_EVENT_TYPES,
  webhookError,
  immutableTransferEvidence,
  immutablePayoutEvidence,
  immutableNegativeEvidence,
  immutableBalanceTransactionEvidence,
  payoutState,
  transferIdentityReasons,
  resolveConnectedAccountScope,
  resolveEventScope,
  ingestSignedPayoutV2Webhook,
};
