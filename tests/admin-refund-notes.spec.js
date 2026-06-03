// @ts-check
// Mocked admin refund-note timeline tests. No Neon, no prod, no Stripe.

const { test, expect } = require('@playwright/test');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'admin-refund-notes-test-secret';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_admin_refund_notes';

const adminHandler = require('../api/admin');

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    getHeader(name) {
      return this.headers[name.toLowerCase()];
    },
  };
}

function csrfAuthedHeaders(schoolId = 1) {
  const csrf = 'n'.repeat(64);
  const token = jwt.sign(
    { id: 321, name: 'Test Admin', email: 'admin@example.test', role: 'admin', isAdmin: true, school_id: schoolId },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
  return {
    cookie: `cc_admin=${token}; cc_csrf=${csrf}`,
    'x-csrf-token': csrf,
    'x-forwarded-for': '203.0.113.12',
  };
}

function refundEvent(overrides = {}) {
  return {
    id: 900,
    school_id: 1,
    refund_type: 'direct_slot',
    status: 'executed',
    idempotency_key: 'manual-bank-refund-key-7001',
    stripe_refund_id: null,
    ...overrides,
  };
}

function makeSql({ event = refundEvent(), notes = [] } = {}) {
  const calls = [];
  const state = {
    event,
    notes: [...notes],
    nextNoteId: 1200,
  };

  const sql = async (strings, ...values) => {
    const text = strings.join('?');
    calls.push({ text, values });

    if (/FROM refund_events/i.test(text) && /WHERE school_id = \?/i.test(text) && /id = \?/i.test(text)) {
      return state.event && state.event.school_id === values[0] && state.event.id === values[1]
        ? [state.event]
        : [];
    }

    if (/FROM refund_event_notes rn/i.test(text)) {
      return state.notes.filter((note) => note.school_id === values[0] && note.refund_event_id === values[1]);
    }

    if (/INSERT INTO refund_event_notes/i.test(text)) {
      const note = {
        id: state.nextNoteId++,
        school_id: values[0],
        refund_event_id: values[1],
        created_by: values[2],
        note_type: values[3],
        incident_status: values[4],
        body: values[5],
        evidence_reference: values[6],
        metadata: typeof values[7] === 'string' ? JSON.parse(values[7]) : values[7],
        created_at: '2026-06-03T10:00:00.000Z',
      };
      state.notes.push(note);
      return [note];
    }

    if (/INSERT INTO audit_log/i.test(text)) {
      return [];
    }

    return [];
  };

  sql.calls = calls;
  sql.state = state;
  return sql;
}

async function callAdmin({ action, method = 'POST', query = {}, body = {}, sql = makeSql(), headers = csrfAuthedHeaders() } = {}) {
  const req = {
    method,
    query: { action, ...query },
    body,
    headers,
    url: `/api/admin?action=${action}`,
    sql,
  };
  const res = makeRes();
  await adminHandler(req, res);
  return res;
}

test.describe('admin refund notes timeline', () => {
  test('adds an incident note against a school-scoped refund event and audit logs it', async () => {
    const sql = makeSql();

    const res = await callAdmin({
      action: 'add-refund-note',
      sql,
      body: {
        refund_event_id: 900,
        note_type: 'incident',
        incident_status: 'open',
        body: 'Stripe refund succeeded but local ledger repair is pending review.',
        evidence_reference: 'INC-REFUND-900',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      note_added: true,
      note: {
        refund_event_id: 900,
        note_type: 'incident',
        incident_status: 'open',
        body: 'Stripe refund succeeded but local ledger repair is pending review.',
        evidence_reference: 'INC-REFUND-900',
      },
    });
    expect(res.body.note.metadata).toMatchObject({
      refund_event_status: 'executed',
      refund_type: 'direct_slot',
      idempotency_key: 'manual-bank-refund-key-7001',
    });
    expect(sql.calls.some((call) => /INSERT INTO refund_event_notes/i.test(call.text))).toBe(true);
    expect(sql.calls.some((call) => /INSERT INTO audit_log/i.test(call.text))).toBe(true);
  });

  test('lists notes for an existing refund event', async () => {
    const sql = makeSql({
      notes: [{
        id: 1200,
        school_id: 1,
        refund_event_id: 900,
        created_by: 321,
        admin_email: 'admin@example.test',
        admin_name: 'Test Admin',
        note_type: 'repair_decision',
        incident_status: 'not_applicable',
        body: 'No local repair needed after replay returned complete ledger.',
        evidence_reference: null,
        metadata: {},
        created_at: '2026-06-03T10:05:00.000Z',
      }],
    });

    const res = await callAdmin({
      action: 'refund-notes',
      method: 'GET',
      query: { refund_event_id: 900 },
      sql,
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      refund_event: { id: 900, school_id: 1 },
      notes: [{
        id: 1200,
        note_type: 'repair_decision',
        body: 'No local repair needed after replay returned complete ledger.',
      }],
    });
  });

  test('rejects cross-school refund events before note insertion or audit', async () => {
    const sql = makeSql({ event: refundEvent({ school_id: 2 }) });

    const res = await callAdmin({
      action: 'add-refund-note',
      sql,
      body: {
        refund_event_id: 900,
        note_type: 'operator_note',
        body: 'Should not attach cross-school.',
      },
    });

    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({
      error: true,
      code: 'REFUND_EVENT_NOT_FOUND',
      note_added: false,
    });
    expect(sql.calls.some((call) => /INSERT INTO refund_event_notes/i.test(call.text))).toBe(false);
    expect(sql.calls.some((call) => /INSERT INTO audit_log/i.test(call.text))).toBe(false);
  });

  test('rejects non-incident notes with incident status before SQL', async () => {
    const sql = makeSql();

    const res = await callAdmin({
      action: 'add-refund-note',
      sql,
      body: {
        refund_event_id: 900,
        note_type: 'repair_decision',
        incident_status: 'resolved',
        body: 'Resolved without incident note type.',
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({
      error: true,
      code: 'INCIDENT_STATUS_NOTE_TYPE_MISMATCH',
      note_added: false,
    });
    expect(sql.calls).toHaveLength(0);
  });
});
