const { logAudit } = require('./_audit');

const REFUND_NOTE_TYPES = Object.freeze([
  'operator_note',
  'evidence',
  'incident',
  'repair_decision',
]);

const REFUND_INCIDENT_STATUSES = Object.freeze([
  'open',
  'watching',
  'resolved',
  'not_applicable',
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

function validateRefundNoteListRequest(query = {}, { schoolId } = {}) {
  if (!positiveInteger(schoolId)) {
    return validationError('SCHOOL_SCOPE_REQUIRED', 'Admin school scope is required.');
  }

  const refundEventId = positiveInteger(query.refund_event_id);
  if (!refundEventId) {
    return validationError('REFUND_EVENT_REQUIRED', 'refund_event_id is required.');
  }

  return { ok: true, input: { schoolId: Number(schoolId), refundEventId } };
}

function validateRefundNoteCreateRequest(body = {}, { schoolId } = {}) {
  if (!positiveInteger(schoolId)) {
    return validationError('SCHOOL_SCOPE_REQUIRED', 'Admin school scope is required.');
  }

  const refundEventId = positiveInteger(body.refund_event_id);
  if (!refundEventId) {
    return validationError('REFUND_EVENT_REQUIRED', 'refund_event_id is required.');
  }

  const noteType = cleanText(body.note_type) || 'operator_note';
  if (!REFUND_NOTE_TYPES.includes(noteType)) {
    return validationError('INVALID_REFUND_NOTE_TYPE', `note_type must be one of: ${REFUND_NOTE_TYPES.join(', ')}.`);
  }

  const bodyText = cleanText(body.body);
  if (!bodyText || bodyText.length > 2000) {
    return validationError('REFUND_NOTE_BODY_REQUIRED', 'body is required and must be 2000 characters or fewer.');
  }

  const evidenceReference = cleanText(body.evidence_reference);
  if (evidenceReference && evidenceReference.length > 500) {
    return validationError('REFUND_NOTE_EVIDENCE_TOO_LONG', 'evidence_reference must be 500 characters or fewer.');
  }

  const incidentStatus = cleanText(body.incident_status) || (noteType === 'incident' ? 'open' : 'not_applicable');
  if (!REFUND_INCIDENT_STATUSES.includes(incidentStatus)) {
    return validationError('INVALID_REFUND_INCIDENT_STATUS', `incident_status must be one of: ${REFUND_INCIDENT_STATUSES.join(', ')}.`);
  }
  if (noteType !== 'incident' && incidentStatus !== 'not_applicable') {
    return validationError('INCIDENT_STATUS_NOTE_TYPE_MISMATCH', 'incident_status is only supported for incident notes.', 409);
  }

  return {
    ok: true,
    input: {
      schoolId: Number(schoolId),
      refundEventId,
      noteType,
      incidentStatus,
      body: bodyText,
      evidenceReference,
    },
  };
}

async function fetchRefundEvent(sql, { schoolId, refundEventId }) {
  const rows = await sql`
    SELECT id, school_id, refund_type, status, idempotency_key, stripe_refund_id
      FROM refund_events
     WHERE school_id = ${schoolId}
       AND id = ${refundEventId}
     LIMIT 1
  `;
  return rows[0] || null;
}

function normalizeNote(row = {}) {
  return {
    id: row.id,
    school_id: row.school_id,
    refund_event_id: row.refund_event_id,
    created_by: row.created_by,
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

async function listRefundNotes({ sql, input } = {}) {
  if (!sql) throw new Error('sql client required');
  if (!input) throw new Error('input required');

  const event = await fetchRefundEvent(sql, input);
  if (!event) {
    return validationError('REFUND_EVENT_NOT_FOUND', 'Refund event was not found in this school.', 404);
  }

  const rows = await sql`
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

  return {
    ok: true,
    refund_event: event,
    notes: rows.map(normalizeNote),
  };
}

async function addRefundNote({
  sql,
  admin,
  input,
  req,
  auditLogger = logAudit,
} = {}) {
  if (!sql) throw new Error('sql client required');
  if (!admin) throw new Error('admin required');
  if (!input) throw new Error('input required');

  const event = await fetchRefundEvent(sql, input);
  if (!event) {
    return validationError('REFUND_EVENT_NOT_FOUND', 'Refund event was not found in this school.', 404);
  }

  const rows = await sql`
    INSERT INTO refund_event_notes
      (school_id, refund_event_id, created_by, note_type, incident_status,
       body, evidence_reference, metadata)
    VALUES
      (${input.schoolId}, ${input.refundEventId}, ${admin.id}, ${input.noteType},
       ${input.incidentStatus}, ${input.body}, ${input.evidenceReference},
       ${JSON.stringify({
         refund_event_status: event.status,
         refund_type: event.refund_type,
         idempotency_key: event.idempotency_key || null,
         stripe_refund_id: event.stripe_refund_id || null,
       })})
    RETURNING id, school_id, refund_event_id, created_by, note_type,
              incident_status, body, evidence_reference, metadata, created_at
  `;

  const note = normalizeNote({
    ...rows[0],
    admin_email: admin.email || null,
    admin_name: admin.name || null,
  });

  await auditLogger(sql, {
    adminId: admin.id,
    adminEmail: admin.email,
    action: 'admin.add_refund_note',
    targetType: 'refund_event',
    targetId: input.refundEventId,
    schoolId: input.schoolId,
    req,
    details: {
      refund_note_id: note.id,
      note_type: input.noteType,
      incident_status: input.incidentStatus,
      evidence_reference: input.evidenceReference || null,
    },
  });

  return { ok: true, refund_event: event, note };
}

module.exports = {
  REFUND_NOTE_TYPES,
  REFUND_INCIDENT_STATUSES,
  addRefundNote,
  listRefundNotes,
  validateRefundNoteCreateRequest,
  validateRefundNoteListRequest,
};
