const REFUND_EVENT_TYPES = Object.freeze([
  'credit_purchase',
  'repeat_offer_partial',
  'direct_slot',
  'direct_offer',
  'manual_record',
]);

const REFUND_EVENT_STATUSES = Object.freeze([
  'previewed',
  'manual_review',
  'blocked',
  'executed',
]);

function positiveInteger(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function cleanText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function validationError(code, message, status = 400) {
  return { ok: false, status, code, message };
}

function cleanDate(value) {
  const text = cleanText(value);
  if (!text) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    ? text
    : false;
}

function validateRefundEventSearchRequest(query = {}, { schoolId } = {}) {
  if (!positiveInteger(schoolId)) {
    return validationError('SCHOOL_SCOPE_REQUIRED', 'Admin school scope is required.');
  }

  const refundEventId = positiveInteger(query.refund_event_id || query.event_id);
  if ((query.refund_event_id || query.event_id) && !refundEventId) {
    return validationError('INVALID_REFUND_EVENT_ID', 'refund_event_id must be a positive integer.');
  }

  const learnerId = positiveInteger(query.learner_id);
  if (query.learner_id && !learnerId) {
    return validationError('INVALID_LEARNER_ID', 'learner_id must be a positive integer.');
  }

  const refundType = cleanText(query.refund_type);
  if (refundType && !REFUND_EVENT_TYPES.includes(refundType)) {
    return validationError('INVALID_REFUND_TYPE', `refund_type must be one of: ${REFUND_EVENT_TYPES.join(', ')}.`);
  }

  const status = cleanText(query.status);
  if (status && !REFUND_EVENT_STATUSES.includes(status)) {
    return validationError('INVALID_REFUND_STATUS', `status must be one of: ${REFUND_EVENT_STATUSES.join(', ')}.`);
  }

  const createdFrom = cleanDate(query.created_from || query.from);
  if (createdFrom === false) {
    return validationError('INVALID_CREATED_FROM', 'created_from must use YYYY-MM-DD.');
  }

  const createdTo = cleanDate(query.created_to || query.to);
  if (createdTo === false) {
    return validationError('INVALID_CREATED_TO', 'created_to must use YYYY-MM-DD.');
  }

  const q = cleanText(query.q || query.search);
  const learnerQuery = cleanText(query.learner || query.learner_query);
  const idempotencyKey = cleanText(query.idempotency_key);
  const stripeRefundId = cleanText(query.stripe_refund_id);
  const hasIdentifierSearch = Boolean(refundEventId || idempotencyKey || stripeRefundId || q);
  const hasExplicitDateRange = Boolean(createdFrom || createdTo);
  const hasExplicitRecentDays = !(query.recent_days == null || query.recent_days === '');
  const recentDaysRaw = !hasExplicitRecentDays
    ? (hasExplicitDateRange || hasIdentifierSearch ? null : 30)
    : Number(query.recent_days);
  const recentDays = recentDaysRaw == null ? null : recentDaysRaw;
  if (recentDays != null && (!Number.isInteger(recentDays) || recentDays < 1 || recentDays > 365)) {
    return validationError('INVALID_RECENT_DAYS', 'recent_days must be an integer between 1 and 365.');
  }

  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 25));

  return {
    ok: true,
    input: {
      schoolId: Number(schoolId),
      refundEventId,
      q,
      qLike: q ? `%${q}%` : null,
      learnerId,
      learnerQuery,
      learnerLike: learnerQuery ? `%${learnerQuery}%` : null,
      idempotencyKey,
      stripeRefundId,
      refundType,
      status,
      createdFrom,
      createdTo,
      recentDays,
      limit,
    },
  };
}

function normalizeEvent(row = {}) {
  return {
    id: row.id,
    school_id: row.school_id,
    learner_id: row.learner_id || null,
    learner_name: row.learner_name || null,
    learner_email: row.learner_email || null,
    created_by: row.created_by || null,
    admin_email: row.admin_email || null,
    admin_name: row.admin_name || null,
    refund_type: row.refund_type,
    status: row.status,
    gross_refund_pence: row.gross_refund_pence || 0,
    processing_fee_withheld_pence: row.processing_fee_withheld_pence || 0,
    net_refund_pence: row.net_refund_pence || 0,
    stripe_payment_intent_id: row.stripe_payment_intent_id || null,
    stripe_charge_id: row.stripe_charge_id || null,
    stripe_refund_id: row.stripe_refund_id || null,
    stripe_balance_transaction_id: row.stripe_balance_transaction_id || null,
    idempotency_key: row.idempotency_key || null,
    reason: row.reason || null,
    metadata: row.metadata || {},
    line_count: Number(row.line_count || 0),
    note_count: Number(row.note_count || 0),
    latest_note_at: row.latest_note_at || null,
    created_at: row.created_at,
  };
}

function normalizeLine(row = {}) {
  return {
    id: row.id,
    school_id: row.school_id,
    refund_event_id: row.refund_event_id,
    credit_transaction_id: row.credit_transaction_id || null,
    booking_credit_source_id: row.booking_credit_source_id || null,
    lesson_booking_id: row.lesson_booking_id || null,
    credit_source_adjustment_id: row.credit_source_adjustment_id || null,
    gross_pence_removed: row.gross_pence_removed || 0,
    source_fee_pence_used: row.source_fee_pence_used || 0,
    fee_withheld_pence: row.fee_withheld_pence || 0,
    net_refund_pence: row.net_refund_pence || 0,
    minutes_adjusted: row.minutes_adjusted || 0,
    created_at: row.created_at,
  };
}

function normalizeNote(row = {}) {
  return {
    id: row.id,
    school_id: row.school_id,
    refund_event_id: row.refund_event_id,
    created_by: row.created_by || null,
    admin_email: row.admin_email || null,
    admin_name: row.admin_name || null,
    note_type: row.note_type,
    incident_status: row.incident_status || 'not_applicable',
    body: row.body,
    evidence_reference: row.evidence_reference || null,
    metadata: row.metadata || {},
    created_at: row.created_at,
  };
}

async function searchRefundEvents({ sql, input } = {}) {
  if (!sql) throw new Error('sql client required');
  if (!input) throw new Error('input required');

  const events = await sql`
    SELECT re.id, re.school_id, re.learner_id,
           lu.name AS learner_name, lu.email AS learner_email,
           re.created_by, au.email AS admin_email, au.name AS admin_name,
           re.refund_type, re.status, re.gross_refund_pence,
           re.processing_fee_withheld_pence, re.net_refund_pence,
           re.stripe_payment_intent_id, re.stripe_charge_id, re.stripe_refund_id,
           re.stripe_balance_transaction_id, re.idempotency_key, re.reason,
           re.metadata, re.created_at,
           (
             SELECT COUNT(*)::int
               FROM refund_event_lines rel
              WHERE rel.school_id = re.school_id
                AND rel.refund_event_id = re.id
           ) AS line_count,
           (
             SELECT COUNT(*)::int
               FROM refund_event_notes rn
              WHERE rn.school_id = re.school_id
                AND rn.refund_event_id = re.id
           ) AS note_count,
           (
             SELECT MAX(rn.created_at)
               FROM refund_event_notes rn
              WHERE rn.school_id = re.school_id
                AND rn.refund_event_id = re.id
           ) AS latest_note_at
      FROM refund_events re
      LEFT JOIN learner_users lu
        ON lu.id = re.learner_id
       AND lu.school_id = re.school_id
      LEFT JOIN admin_users au
        ON au.id = re.created_by
     WHERE re.school_id = ${input.schoolId}
       AND (${input.refundEventId}::int IS NULL OR re.id = ${input.refundEventId})
       AND (${input.idempotencyKey}::text IS NULL OR re.idempotency_key = ${input.idempotencyKey})
       AND (${input.stripeRefundId}::text IS NULL OR re.stripe_refund_id = ${input.stripeRefundId})
       AND (${input.learnerId}::int IS NULL OR re.learner_id = ${input.learnerId})
       AND (${input.refundType}::text IS NULL OR re.refund_type = ${input.refundType})
       AND (${input.status}::text IS NULL OR re.status = ${input.status})
       AND (${input.createdFrom}::date IS NULL OR re.created_at >= ${input.createdFrom}::date)
       AND (${input.createdTo}::date IS NULL OR re.created_at < (${input.createdTo}::date + INTERVAL '1 day'))
       AND (${input.refundEventId}::int IS NOT NULL OR ${input.recentDays}::int IS NULL OR re.created_at >= NOW() - (${input.recentDays}::int * INTERVAL '1 day'))
       AND (
         ${input.learnerLike}::text IS NULL
         OR lu.name ILIKE ${input.learnerLike}
         OR lu.email ILIKE ${input.learnerLike}
       )
       AND (
         ${input.qLike}::text IS NULL
         OR re.id::text = ${input.q}
         OR re.idempotency_key ILIKE ${input.qLike}
         OR re.stripe_refund_id ILIKE ${input.qLike}
         OR re.stripe_payment_intent_id ILIKE ${input.qLike}
         OR re.stripe_charge_id ILIKE ${input.qLike}
         OR lu.name ILIKE ${input.qLike}
         OR lu.email ILIKE ${input.qLike}
       )
     ORDER BY re.created_at DESC, re.id DESC
     LIMIT ${input.limit}
  `;

  const normalizedEvents = events.map(normalizeEvent);
  const result = {
    ok: true,
    events: normalizedEvents,
    filters: {
      refund_event_id: input.refundEventId || null,
      q: input.q || null,
      learner_id: input.learnerId || null,
      learner_query: input.learnerQuery || null,
      idempotency_key: input.idempotencyKey || null,
      stripe_refund_id: input.stripeRefundId || null,
      refund_type: input.refundType || null,
      status: input.status || null,
      created_from: input.createdFrom || null,
      created_to: input.createdTo || null,
      recent_days: input.recentDays || null,
      limit: input.limit,
    },
  };

  if (input.refundEventId) {
    const event = normalizedEvents[0] || null;
    if (!event) {
      return validationError('REFUND_EVENT_NOT_FOUND', 'Refund event was not found in this school.', 404);
    }

    const lines = await sql`
      SELECT id, school_id, refund_event_id, credit_transaction_id,
             booking_credit_source_id, lesson_booking_id,
             credit_source_adjustment_id, gross_pence_removed,
             source_fee_pence_used, fee_withheld_pence, net_refund_pence,
             minutes_adjusted, created_at
        FROM refund_event_lines
       WHERE school_id = ${input.schoolId}
         AND refund_event_id = ${input.refundEventId}
       ORDER BY id ASC
    `;

    const notes = await sql`
      SELECT rn.id, rn.school_id, rn.refund_event_id, rn.created_by,
             au.email AS admin_email, au.name AS admin_name,
             rn.note_type, rn.incident_status, rn.body, rn.evidence_reference,
             rn.metadata, rn.created_at
        FROM refund_event_notes rn
        LEFT JOIN admin_users au ON au.id = rn.created_by
       WHERE rn.school_id = ${input.schoolId}
         AND rn.refund_event_id = ${input.refundEventId}
       ORDER BY rn.created_at ASC, rn.id ASC
    `;

    result.event = event;
    result.lines = lines.map(normalizeLine);
    result.notes = notes.map(normalizeNote);
  }

  return result;
}

module.exports = {
  REFUND_EVENT_STATUSES,
  REFUND_EVENT_TYPES,
  searchRefundEvents,
  validateRefundEventSearchRequest,
};
