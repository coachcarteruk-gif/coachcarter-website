const crypto = require('crypto');

const REPAIR_CONTRACT_VERSION = 'refund-incident-repair-refusal-v1';
const INCIDENT_REPAIR_OPERATOR_GO = 'PLAN_INCIDENT_REPAIR_ONLY';

const FUTURE_REPAIRABLE_REFUND_TYPES = Object.freeze([
  'credit_purchase',
]);

const FORBIDDEN_MUTATION_TARGETS = Object.freeze({
  lesson_bookings: 'BOOKING_MUTATION_PROPOSED',
  bookings: 'BOOKING_MUTATION_PROPOSED',
  booking_status: 'BOOKING_MUTATION_PROPOSED',
  payout_line_items: 'PAYOUT_MUTATION_PROPOSED',
  instructor_payouts: 'PAYOUT_MUTATION_PROPOSED',
  payouts: 'PAYOUT_MUTATION_PROPOSED',
  booking_credit_sources: 'BOOKING_CREDIT_SOURCE_MUTATION_PROPOSED',
  bcs: 'BOOKING_CREDIT_SOURCE_MUTATION_PROPOSED',
  refund_events: 'HISTORICAL_REFUND_EVENT_MUTATION_PROPOSED',
  refund_event: 'HISTORICAL_REFUND_EVENT_MUTATION_PROPOSED',
  refund_event_lines: 'HISTORICAL_REFUND_EVENT_LINE_MUTATION_PROPOSED',
  refund_event_line: 'HISTORICAL_REFUND_EVENT_LINE_MUTATION_PROPOSED',
  stripe: 'STRIPE_MUTATION_PROPOSED',
  stripe_refunds: 'STRIPE_MUTATION_PROPOSED',
  stripe_refund: 'STRIPE_MUTATION_PROPOSED',
  learner_credit_balances: 'LEARNER_CREDIT_MUTATION_PROPOSED',
  learner_credits: 'LEARNER_CREDIT_MUTATION_PROPOSED',
  credit_source_adjustments: 'CREDIT_SOURCE_ADJUSTMENT_MUTATION_PROPOSED',
  credit_transactions: 'CREDIT_TRANSACTION_MUTATION_PROPOSED',
});

function positiveInteger(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function cleanText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function toPence(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function validationError(code, message, status = 400) {
  return {
    ok: false,
    status,
    code,
    message,
    repair_mutation_allowed: false,
    mutation_performed: false,
    refusal_reasons: [{ code, message }],
  };
}

function validateRefundIncidentRepairPlanRequest(body = {}, { schoolId } = {}) {
  if (!positiveInteger(schoolId)) {
    return validationError('SCHOOL_SCOPE_REQUIRED', 'Admin school scope is required.');
  }

  const refundEventId = positiveInteger(body.refund_event_id || body.event_id);
  if (!refundEventId) {
    return validationError('REFUND_EVENT_REQUIRED', 'refund_event_id is required.');
  }

  const originalIdempotencyKey = cleanText(body.original_idempotency_key || body.idempotency_key);
  if (originalIdempotencyKey && originalIdempotencyKey.length > 180) {
    return validationError('IDEMPOTENCY_KEY_TOO_LONG', 'original_idempotency_key must be 180 characters or fewer.');
  }

  const stripeRefundId = cleanText(body.stripe_refund_id);
  if (stripeRefundId && stripeRefundId.length > 180) {
    return validationError('STRIPE_REFUND_ID_TOO_LONG', 'stripe_refund_id must be 180 characters or fewer.');
  }

  const repairPlanFingerprint = cleanText(body.repair_plan_fingerprint);
  if (repairPlanFingerprint && repairPlanFingerprint.length > 128) {
    return validationError('REPAIR_PLAN_FINGERPRINT_TOO_LONG', 'repair_plan_fingerprint must be 128 characters or fewer.');
  }

  const expectedRefundType = cleanText(body.expected_refund_type || body.refund_type);
  const expectedSourceEvidence = body.expected_source_evidence && typeof body.expected_source_evidence === 'object'
    ? body.expected_source_evidence
    : {};
  const proposedMutations = Array.isArray(body.proposed_mutations)
    ? body.proposed_mutations.slice(0, 50)
    : [];

  return {
    ok: true,
    input: {
      schoolId: Number(schoolId),
      refundEventId,
      originalIdempotencyKey,
      stripeRefundId,
      repairPlanFingerprint,
      expectedRefundType,
      expectedSourceEvidence,
      proposedMutations,
      operatorGo: cleanText(body.operator_go),
    },
  };
}

function normalizeEvent(row = {}) {
  return {
    id: row.id,
    school_id: row.school_id,
    learner_id: row.learner_id || null,
    created_by: row.created_by || null,
    refund_type: row.refund_type,
    status: row.status,
    gross_refund_pence: toPence(row.gross_refund_pence),
    processing_fee_withheld_pence: toPence(row.processing_fee_withheld_pence),
    net_refund_pence: toPence(row.net_refund_pence),
    stripe_payment_intent_id: row.stripe_payment_intent_id || null,
    stripe_charge_id: row.stripe_charge_id || null,
    stripe_refund_id: row.stripe_refund_id || null,
    stripe_balance_transaction_id: row.stripe_balance_transaction_id || null,
    idempotency_key: row.idempotency_key || null,
    reason: row.reason || null,
    metadata: row.metadata || {},
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
    gross_pence_removed: toPence(row.gross_pence_removed),
    source_fee_pence_used: toPence(row.source_fee_pence_used),
    fee_withheld_pence: toPence(row.fee_withheld_pence),
    net_refund_pence: toPence(row.net_refund_pence),
    minutes_adjusted: toPence(row.minutes_adjusted),
    created_at: row.created_at,
  };
}

function normalizeNote(row = {}) {
  return {
    id: row.id,
    school_id: row.school_id,
    refund_event_id: row.refund_event_id,
    note_type: row.note_type,
    incident_status: row.incident_status || 'not_applicable',
    body: row.body || '',
    evidence_reference: row.evidence_reference || null,
    metadata: row.metadata || {},
    created_at: row.created_at,
  };
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    ).join(',')}}`;
  }
  return JSON.stringify(value);
}

function buildRepairFingerprintPayload({ event, lines }) {
  return {
    version: REPAIR_CONTRACT_VERSION,
    school_id: event.school_id,
    refund_event_id: event.id,
    learner_id: event.learner_id || null,
    refund_type: event.refund_type,
    status: event.status,
    original_idempotency_key: event.idempotency_key || null,
    stripe_refund_id: event.stripe_refund_id || null,
    stripe_payment_intent_id: event.stripe_payment_intent_id || null,
    stripe_charge_id: event.stripe_charge_id || null,
    gross_refund_pence: event.gross_refund_pence,
    processing_fee_withheld_pence: event.processing_fee_withheld_pence,
    net_refund_pence: event.net_refund_pence,
    line_contract: (lines || []).map((line) => ({
      id: line.id || null,
      credit_transaction_id: line.credit_transaction_id || null,
      booking_credit_source_id: line.booking_credit_source_id || null,
      lesson_booking_id: line.lesson_booking_id || null,
      credit_source_adjustment_id: line.credit_source_adjustment_id || null,
      gross_pence_removed: line.gross_pence_removed,
      fee_withheld_pence: line.fee_withheld_pence,
      net_refund_pence: line.net_refund_pence,
      minutes_adjusted: line.minutes_adjusted,
    })),
  };
}

function repairPlanFingerprint(payload) {
  return crypto
    .createHash('sha256')
    .update(stableStringify(payload))
    .digest('hex');
}

function reason(code, message, details) {
  return details ? { code, message, details } : { code, message };
}

function addUniqueReason(reasons, item) {
  if (!reasons.some((existing) => existing.code === item.code)) {
    reasons.push(item);
  }
}

function mutationTarget(mutation) {
  if (typeof mutation === 'string') return mutation.trim().toLowerCase();
  if (!mutation || typeof mutation !== 'object') return null;
  return cleanText(mutation.target || mutation.table || mutation.resource || mutation.kind)?.toLowerCase() || null;
}

function forbiddenMutationReasons(proposedMutations = []) {
  const reasons = [];
  proposedMutations.forEach((mutation) => {
    const target = mutationTarget(mutation);
    const code = target ? FORBIDDEN_MUTATION_TARGETS[target] : null;
    if (code) {
      addUniqueReason(
        reasons,
        reason(code, 'The proposed repair includes a forbidden mutation target.', { target })
      );
    }
  });
  return reasons;
}

function hasOpenOrWatchingIncident(notes = []) {
  return notes.some((note) =>
    note.note_type === 'incident'
      && ['open', 'watching'].includes(note.incident_status || 'not_applicable')
  );
}

function hasRepairDecisionNote(notes = []) {
  return notes.some((note) => note.note_type === 'repair_decision');
}

function lineMatchesAny(lines, field, value) {
  if (value == null || value === '') return true;
  const expected = String(value);
  return lines.some((line) => String(line[field] || '') === expected);
}

function sourceEvidenceReasons({ event, lines, input }) {
  const reasons = [];
  const source = input.expectedSourceEvidence || {};

  if (input.expectedRefundType && input.expectedRefundType !== event.refund_type) {
    reasons.push(reason('REFUND_TYPE_MISMATCH', 'Caller refund type evidence does not match the refund event.'));
  }

  if (!FUTURE_REPAIRABLE_REFUND_TYPES.includes(event.refund_type)) {
    reasons.push(reason('UNSUPPORTED_REFUND_TYPE', 'This refund type is not eligible for the future incident repair path.'));
  }

  const manualBank = event.metadata?.refund_channel === 'manual_bank';
  if (manualBank) {
    reasons.push(reason('UNSUPPORTED_REFUND_CHANNEL', 'Manual-bank records are not original-method Stripe repair candidates.'));
  }

  if (source.school_id != null && Number(source.school_id) !== Number(event.school_id)) {
    reasons.push(reason('SOURCE_EVIDENCE_MISMATCH', 'Caller source evidence school_id does not match the refund event.'));
  }
  if (source.learner_id != null && Number(source.learner_id) !== Number(event.learner_id || 0)) {
    reasons.push(reason('SOURCE_EVIDENCE_MISMATCH', 'Caller source evidence learner_id does not match the refund event.'));
  }
  if (source.gross_refund_pence != null && toPence(source.gross_refund_pence) !== event.gross_refund_pence) {
    reasons.push(reason('SOURCE_EVIDENCE_MISMATCH', 'Caller source evidence gross amount does not match the refund event.'));
  }
  if (source.net_refund_pence != null && toPence(source.net_refund_pence) !== event.net_refund_pence) {
    reasons.push(reason('SOURCE_EVIDENCE_MISMATCH', 'Caller source evidence net amount does not match the refund event.'));
  }
  if (source.stripe_payment_intent_id && source.stripe_payment_intent_id !== event.stripe_payment_intent_id) {
    reasons.push(reason('SOURCE_EVIDENCE_MISMATCH', 'Caller source evidence payment intent does not match the refund event.'));
  }
  if (source.stripe_charge_id && source.stripe_charge_id !== event.stripe_charge_id) {
    reasons.push(reason('SOURCE_EVIDENCE_MISMATCH', 'Caller source evidence charge does not match the refund event.'));
  }
  if (!lineMatchesAny(lines, 'credit_transaction_id', source.credit_transaction_id)) {
    reasons.push(reason('SOURCE_EVIDENCE_MISMATCH', 'Caller credit transaction evidence does not match any refund event line.'));
  }
  if (!lineMatchesAny(lines, 'booking_credit_source_id', source.booking_credit_source_id)) {
    reasons.push(reason('SOURCE_EVIDENCE_MISMATCH', 'Caller booking-credit-source evidence does not match any refund event line.'));
  }
  if (!lineMatchesAny(lines, 'lesson_booking_id', source.lesson_booking_id)) {
    reasons.push(reason('SOURCE_EVIDENCE_MISMATCH', 'Caller booking evidence does not match any refund event line.'));
  }

  const hasSupportedCreditSource = lines.some((line) =>
    line.credit_transaction_id
      && !line.booking_credit_source_id
      && !line.lesson_booking_id
  );
  if (!hasSupportedCreditSource) {
    reasons.push(reason('UNSUPPORTED_SOURCE_EVIDENCE', 'No supported original credit-purchase source evidence is present.'));
  }

  return reasons;
}

function buildIncidentRepairRefusal({ event, lines = [], notes = [], idempotencyMatches = [], input }) {
  const payload = buildRepairFingerprintPayload({ event, lines });
  const fingerprint = repairPlanFingerprint(payload);
  const reasons = [
    reason('REPAIR_MUTATION_NOT_IMPLEMENTED', 'Incident repair mutation is not implemented in this slice. Record evidence and stop for review.'),
  ];

  if (input.operatorGo && input.operatorGo !== INCIDENT_REPAIR_OPERATOR_GO) {
    reasons.push(reason('OPERATOR_GO_UNSUPPORTED', `Only operator_go="${INCIDENT_REPAIR_OPERATOR_GO}" is accepted for refusal-only planning.`));
  }

  if (event.status !== 'executed') {
    reasons.push(reason('REFUND_EVENT_NOT_EXECUTED', 'Only executed refund events can be considered for future repair planning.'));
  }

  if (!event.stripe_refund_id || !input.stripeRefundId) {
    reasons.push(reason('STRIPE_REFUND_EVIDENCE_MISSING', 'Original-method repair requires the local Stripe refund ID and matching caller evidence.'));
  } else if (input.stripeRefundId !== event.stripe_refund_id) {
    reasons.push(reason('STRIPE_REFUND_ID_MISMATCH', 'Caller Stripe refund evidence does not match the refund event.'));
  }

  if (!event.idempotency_key || !input.originalIdempotencyKey) {
    reasons.push(reason('ORIGINAL_IDEMPOTENCY_KEY_MISSING', 'Original refund idempotency key evidence is required.'));
  } else if (input.originalIdempotencyKey !== event.idempotency_key) {
    reasons.push(reason('ORIGINAL_IDEMPOTENCY_KEY_MISMATCH', 'Caller idempotency evidence does not match the refund event.'));
  }

  if (event.idempotency_key && idempotencyMatches.length !== 1) {
    reasons.push(reason('ORIGINAL_IDEMPOTENCY_KEY_AMBIGUOUS', 'Original refund idempotency key does not bind to exactly one school-scoped refund event.', {
      matching_refund_event_ids: idempotencyMatches.map((row) => row.id),
    }));
  }

  if (input.repairPlanFingerprint && input.repairPlanFingerprint !== fingerprint) {
    reasons.push(reason('REPAIR_PLAN_FINGERPRINT_MISMATCH', 'Caller repair plan fingerprint does not match the local refusal contract.'));
  }

  if (hasOpenOrWatchingIncident(notes)) {
    reasons.push(reason('OPEN_OR_WATCHING_INCIDENT_NOTE', 'Open or watching incident notes must be resolved before repair planning can proceed.'));
  }
  if (hasRepairDecisionNote(notes)) {
    reasons.push(reason('REPAIR_DECISION_NOTE_PRESENT', 'Existing repair-decision notes require manual review before any future repair path.'));
  }

  reasons.push(...sourceEvidenceReasons({ event, lines, input }));
  reasons.push(...forbiddenMutationReasons(input.proposedMutations));

  return {
    ok: false,
    status: 409,
    code: 'INCIDENT_REPAIR_REFUSED',
    message: 'Incident repair is refusal-only in this slice. No repair mutation was performed.',
    repair_mutation_allowed: false,
    repair_planning_only: true,
    mutation_performed: false,
    stripe_called: false,
    contract_version: REPAIR_CONTRACT_VERSION,
    allowed_operator_go: INCIDENT_REPAIR_OPERATOR_GO,
    plan_contract: {
      school_id: event.school_id,
      refund_event_id: event.id,
      original_idempotency_key: event.idempotency_key || null,
      stripe_refund_id: event.stripe_refund_id || null,
      repair_plan_fingerprint: fingerprint,
      fingerprint_payload: payload,
    },
    refusal_reasons: reasons,
    refusal_reason_codes: reasons.map((item) => item.code),
  };
}

async function fetchRefundIncidentRepairPlan({ sql, input } = {}) {
  if (!sql) throw new Error('sql client required');
  if (!input) throw new Error('input required');

  const eventRows = await sql`
    SELECT re.id, re.school_id, re.learner_id, re.created_by,
           re.refund_type, re.status, re.gross_refund_pence,
           re.processing_fee_withheld_pence, re.net_refund_pence,
           re.stripe_payment_intent_id, re.stripe_charge_id, re.stripe_refund_id,
           re.stripe_balance_transaction_id, re.idempotency_key, re.reason,
           re.metadata, re.created_at
      FROM refund_events re
     WHERE re.school_id = ${input.schoolId}
       AND re.id = ${input.refundEventId}
     LIMIT 1
  `;

  const event = eventRows[0] ? normalizeEvent(eventRows[0]) : null;
  if (!event) {
    return validationError(
      'REFUND_EVENT_NOT_FOUND',
      'Refund event was not found in this school.',
      404
    );
  }

  const lineRows = await sql`
    SELECT id, school_id, refund_event_id, credit_transaction_id,
           booking_credit_source_id, lesson_booking_id, credit_source_adjustment_id,
           gross_pence_removed, source_fee_pence_used, fee_withheld_pence,
           net_refund_pence, minutes_adjusted, created_at
      FROM refund_event_lines
     WHERE school_id = ${input.schoolId}
       AND refund_event_id = ${input.refundEventId}
     ORDER BY id ASC
  `;

  const noteRows = await sql`
    SELECT id, school_id, refund_event_id, note_type, incident_status, body,
           evidence_reference, metadata, created_at
      FROM refund_event_notes
     WHERE school_id = ${input.schoolId}
       AND refund_event_id = ${input.refundEventId}
     ORDER BY created_at ASC, id ASC
  `;

  const idempotencyRows = event.idempotency_key
    ? await sql`
      SELECT id, school_id, idempotency_key
        FROM refund_events
       WHERE school_id = ${input.schoolId}
         AND idempotency_key = ${event.idempotency_key}
       ORDER BY id ASC
    `
    : [];

  return buildIncidentRepairRefusal({
    event,
    lines: lineRows.map(normalizeLine),
    notes: noteRows.map(normalizeNote),
    idempotencyMatches: idempotencyRows,
    input,
  });
}

module.exports = {
  INCIDENT_REPAIR_OPERATOR_GO,
  REPAIR_CONTRACT_VERSION,
  buildIncidentRepairRefusal,
  fetchRefundIncidentRepairPlan,
  repairPlanFingerprint,
  validateRefundIncidentRepairPlanRequest,
};
