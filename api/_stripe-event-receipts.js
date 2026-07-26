function requireSchoolId(schoolId) {
  if (!Number.isSafeInteger(schoolId) || schoolId <= 0) {
    throw new TypeError('schoolId must be a positive safe integer');
  }
}

function cleanText(value, maxLength = 500) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text ? text.slice(0, maxLength) : null;
}

async function claimStripeEventReceipt({
  sql,
  schoolId,
  stripeEventId,
  eventType,
  livemode,
  objectId = null,
  connectedAccountId = null,
}) {
  requireSchoolId(schoolId);
  if (typeof sql !== 'function') {
    throw new TypeError('sql must be a Neon-compatible tagged query function');
  }
  const eventId = cleanText(stripeEventId, 255);
  const type = cleanText(eventType, 255);
  const cleanObjectId = cleanText(objectId, 255);
  const cleanConnectedAccountId = cleanText(connectedAccountId, 255);
  const isLive = livemode === true;
  if (!eventId || !eventId.startsWith('evt_')) {
    throw new TypeError('stripeEventId must be an immutable Stripe event ID');
  }
  if (!type) throw new TypeError('eventType is required');

  let rows;
  try {
    rows = await sql`
      INSERT INTO stripe_event_receipts (
        school_id,
        stripe_event_id,
        event_type,
        livemode,
        object_id,
        connected_account_id,
        processing_status
      )
      VALUES (
        ${schoolId},
        ${eventId},
        ${type},
        ${isLive},
        ${cleanObjectId},
        ${cleanConnectedAccountId},
        'processing'
      )
      ON CONFLICT (school_id, stripe_event_id)
      DO UPDATE SET
        processing_status = 'processing',
        processed_at = NOW(),
        last_error = NULL
      WHERE stripe_event_receipts.event_type = ${type}
        AND stripe_event_receipts.livemode = ${isLive}
        AND stripe_event_receipts.object_id IS NOT DISTINCT FROM ${cleanObjectId}
        AND stripe_event_receipts.connected_account_id
              IS NOT DISTINCT FROM ${cleanConnectedAccountId}
        AND (
          stripe_event_receipts.processing_status IN ('received', 'failed')
          OR (
            stripe_event_receipts.processing_status = 'processing'
            AND COALESCE(
              stripe_event_receipts.processed_at,
              stripe_event_receipts.received_at
            ) < NOW() - INTERVAL '5 minutes'
          )
        )
      RETURNING *
    `;
  } catch (err) {
    if (err?.code === '23505') {
      const conflict = new Error(
        'Stripe event ID is already bound to another immutable receipt scope'
      );
      conflict.code = 'PAYOUT_V2_EVENT_RECEIPT_CONFLICT';
      throw conflict;
    }
    throw err;
  }

  if (rows[0]) {
    return { claimed: true, receipt: rows[0] };
  }

  const existing = await sql`
    SELECT *
    FROM stripe_event_receipts
    WHERE school_id = ${schoolId}
      AND stripe_event_id = ${eventId}
    LIMIT 1
  `;
  if (
    existing[0] &&
    (
      existing[0].event_type !== type ||
      existing[0].livemode !== isLive ||
      (existing[0].object_id || null) !== cleanObjectId ||
      (existing[0].connected_account_id || null) !== cleanConnectedAccountId
    )
  ) {
    const err = new Error('Stripe event replay contradicted immutable receipt evidence');
    err.code = 'PAYOUT_V2_EVENT_RECEIPT_CONFLICT';
    throw err;
  }
  return {
    claimed: false,
    receipt: existing[0] || null,
  };
}

async function markStripeEventProcessed({ sql, schoolId, stripeEventId }) {
  requireSchoolId(schoolId);
  const eventId = cleanText(stripeEventId, 255);
  const rows = await sql`
    UPDATE stripe_event_receipts
    SET processing_status = 'processed',
        processed_at = NOW(),
        last_error = NULL
    WHERE school_id = ${schoolId}
      AND stripe_event_id = ${eventId}
      AND processing_status = 'processing'
    RETURNING *
  `;
  if (!rows[0]) {
    const err = new Error('Stripe event receipt was not in processing state for this school');
    err.code = 'PAYOUT_V2_EVENT_RECEIPT_STATE_CONFLICT';
    throw err;
  }
  return rows[0];
}

async function markStripeEventFailed({ sql, schoolId, stripeEventId, error }) {
  requireSchoolId(schoolId);
  const eventId = cleanText(stripeEventId, 255);
  const errorCode = cleanText(error?.code, 100);
  const errorMessage = cleanText(error?.message, 350) || 'processing_failed';
  const lastError = errorCode ? `${errorCode}: ${errorMessage}` : errorMessage;
  const rows = await sql`
    UPDATE stripe_event_receipts
    SET processing_status = 'failed',
        processed_at = NULL,
        last_error = ${lastError}
    WHERE school_id = ${schoolId}
      AND stripe_event_id = ${eventId}
      AND processing_status = 'processing'
    RETURNING *
  `;
  return rows[0] || null;
}

module.exports = {
  claimStripeEventReceipt,
  markStripeEventProcessed,
  markStripeEventFailed,
};
