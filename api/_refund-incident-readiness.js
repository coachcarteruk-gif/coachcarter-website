const READINESS_CLASSIFICATIONS = Object.freeze([
  'complete',
  'incomplete',
  'needs_manual_decision',
]);

function positiveInteger(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function validationError(code, message, status = 400) {
  return { ok: false, status, code, message };
}

function validateRefundIncidentReadinessRequest(query = {}, { schoolId } = {}) {
  if (!positiveInteger(schoolId)) {
    return validationError('SCHOOL_SCOPE_REQUIRED', 'Admin school scope is required.');
  }

  const refundEventId = positiveInteger(query.refund_event_id || query.event_id);
  if (!refundEventId) {
    return validationError('REFUND_EVENT_REQUIRED', 'refund_event_id is required.');
  }

  return {
    ok: true,
    input: {
      schoolId: Number(schoolId),
      refundEventId,
    },
  };
}

function toPence(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
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

function sumLines(lines, field) {
  return lines.reduce((total, line) => total + toPence(line[field]), 0);
}

function hasOpenIncident(notes) {
  return notes.some((note) =>
    note.note_type === 'incident'
      && ['open', 'watching'].includes(note.incident_status || 'not_applicable')
  );
}

function missingAutomaticCsa(event, line) {
  const manualBank = event.metadata?.refund_channel === 'manual_bank';
  if (manualBank) return false;
  return Boolean(
    event.stripe_refund_id
      && line.credit_transaction_id
      && !line.booking_credit_source_id
      && Number(line.minutes_adjusted || 0) > 0
      && !line.credit_source_adjustment_id
  );
}

function classifyRefundIncidentReadiness({ event, lines, notes }) {
  const incompleteReasons = [];
  const manualDecisionReasons = [];
  const evidence = [];

  if (event.id) evidence.push(`refund_event:${event.id}`);
  if (event.idempotency_key) evidence.push(`idempotency_key:${event.idempotency_key}`);
  if (event.stripe_refund_id) evidence.push(`stripe_refund_id:${event.stripe_refund_id}`);
  if (event.stripe_payment_intent_id) evidence.push(`stripe_payment_intent_id:${event.stripe_payment_intent_id}`);
  if (event.stripe_charge_id) evidence.push(`stripe_charge_id:${event.stripe_charge_id}`);
  if (event.metadata?.manual_bank_reference) {
    evidence.push(`manual_bank_reference:${event.metadata.manual_bank_reference}`);
  }

  if (event.status !== 'executed') {
    manualDecisionReasons.push('REFUND_EVENT_NOT_EXECUTED');
  }

  if (!Array.isArray(lines) || lines.length < 1) {
    incompleteReasons.push('REFUND_EVENT_LINES_MISSING');
  } else {
    const grossTotal = sumLines(lines, 'gross_pence_removed');
    const feeTotal = sumLines(lines, 'fee_withheld_pence');
    const netTotal = sumLines(lines, 'net_refund_pence');
    if (grossTotal !== event.gross_refund_pence) {
      incompleteReasons.push('GROSS_LINE_TOTAL_MISMATCH');
    }
    if (feeTotal !== event.processing_fee_withheld_pence) {
      incompleteReasons.push('FEE_LINE_TOTAL_MISMATCH');
    }
    if (netTotal !== event.net_refund_pence) {
      incompleteReasons.push('NET_LINE_TOTAL_MISMATCH');
    }
    if (lines.some((line) => missingAutomaticCsa(event, line))) {
      incompleteReasons.push('CREDIT_SOURCE_ADJUSTMENT_MISSING');
    }
  }

  const manualBank = event.metadata?.refund_channel === 'manual_bank';
  if (manualBank && !event.metadata?.manual_bank_reference) {
    manualDecisionReasons.push('MANUAL_BANK_REFERENCE_MISSING');
  }
  if (!manualBank && Number(event.net_refund_pence || 0) > 0 && !event.stripe_refund_id) {
    manualDecisionReasons.push('STRIPE_REFUND_REFERENCE_MISSING');
  }
  if (hasOpenIncident(notes)) {
    manualDecisionReasons.push('OPEN_INCIDENT_NOTE');
  }

  let classification = 'complete';
  if (incompleteReasons.length) {
    classification = 'incomplete';
  } else if (manualDecisionReasons.length) {
    classification = 'needs_manual_decision';
  }

  const repairableCandidate = classification === 'incomplete'
    && event.status === 'executed'
    && Boolean(event.stripe_refund_id)
    && event.metadata?.refund_channel !== 'manual_bank';

  return {
    classification,
    complete: classification === 'complete',
    repairable_candidate: repairableCandidate,
    reasons: {
      incomplete: incompleteReasons,
      manual_decision: manualDecisionReasons,
    },
    required_evidence: evidence,
    stop_conditions: [
      ...incompleteReasons,
      ...manualDecisionReasons,
    ],
    allowed_next_step: classification === 'complete'
      ? 'post_refund_verification'
      : 'record_evidence_and_stop_for_review',
  };
}

async function fetchRefundIncidentReadiness({ sql, input } = {}) {
  if (!sql) throw new Error('sql client required');
  if (!input) throw new Error('input required');

  const eventRows = await sql`
    SELECT re.id, re.school_id, re.learner_id,
           lu.name AS learner_name, lu.email AS learner_email,
           re.created_by, au.email AS admin_email,
           re.refund_type, re.status, re.gross_refund_pence,
           re.processing_fee_withheld_pence, re.net_refund_pence,
           re.stripe_payment_intent_id, re.stripe_charge_id, re.stripe_refund_id,
           re.stripe_balance_transaction_id, re.idempotency_key, re.reason,
           re.metadata, re.created_at
      FROM refund_events re
      LEFT JOIN learner_users lu
        ON lu.id = re.learner_id
       AND lu.school_id = re.school_id
      LEFT JOIN admin_users au
        ON au.id = re.created_by
     WHERE re.school_id = ${input.schoolId}
       AND re.id = ${input.refundEventId}
     LIMIT 1
  `;

  const event = eventRows[0] ? normalizeEvent(eventRows[0]) : null;
  if (!event) {
    return validationError('REFUND_EVENT_NOT_FOUND', 'Refund event was not found in this school.', 404);
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

  const lines = lineRows.map(normalizeLine);
  const notes = noteRows.map(normalizeNote);
  const readiness = classifyRefundIncidentReadiness({ event, lines, notes });

  return {
    ok: true,
    read_only: true,
    classifications: READINESS_CLASSIFICATIONS,
    event,
    lines,
    notes,
    readiness,
  };
}

module.exports = {
  READINESS_CLASSIFICATIONS,
  classifyRefundIncidentReadiness,
  fetchRefundIncidentReadiness,
  validateRefundIncidentReadinessRequest,
};
