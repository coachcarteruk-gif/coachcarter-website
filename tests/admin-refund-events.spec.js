// @ts-check
// Mocked admin refund-event discovery tests. No Neon, no prod, no live Stripe.

const { test, expect } = require('@playwright/test');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'admin-refund-events-test-secret';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_admin_refund_events';

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
  const csrf = 'e'.repeat(64);
  const token = jwt.sign(
    { id: 321, name: 'Test Admin', email: 'admin@example.test', role: 'admin', isAdmin: true, school_id: schoolId },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
  return {
    cookie: `cc_admin=${token}; cc_csrf=${csrf}`,
    'x-csrf-token': csrf,
    'x-forwarded-for': '203.0.113.18',
  };
}

function eventRow(overrides = {}) {
  return {
    id: 900,
    school_id: 1,
    learner_id: 61,
    learner_name: 'Alex Learner',
    learner_email: 'alex@example.test',
    created_by: 321,
    admin_email: 'admin@example.test',
    admin_name: 'Test Admin',
    refund_type: 'direct_slot',
    status: 'executed',
    gross_refund_pence: 8250,
    processing_fee_withheld_pence: 144,
    net_refund_pence: 8106,
    stripe_payment_intent_id: 'pi_slot_900',
    stripe_charge_id: 'ch_slot_900',
    stripe_refund_id: 're_slot_900',
    stripe_balance_transaction_id: 'txn_slot_900',
    idempotency_key: 'refund-ui-900',
    reason: 'Approved refund event',
    metadata: { refund_channel: 'stripe', evidence_reference: 'OPS-900' },
    line_count: 1,
    note_count: 1,
    latest_note_at: '2026-06-03T11:00:00.000Z',
    created_at: '2026-06-03T10:00:00.000Z',
    ...overrides,
  };
}

function makeSql({ events = [], lines = [], notes = [] } = {}) {
  const calls = [];
  const sql = async (strings, ...values) => {
    const text = strings.join('?');
    calls.push({ text, values });

    if (/FROM refund_events re/i.test(text)) {
      const schoolId = values[0];
      const refundEventId = values[1];
      const idempotencyKey = values[3];
      const stripeRefundId = values[5];
      const learnerId = values[7];
      const refundType = values[9];
      const status = values[11];
      const learnerLike = values[21] ? String(values[21]).replace(/%/g, '').toLowerCase() : null;
      const qLike = values[24] ? String(values[24]).replace(/%/g, '').toLowerCase() : null;
      const qExact = values[25] ? String(values[25]).toLowerCase() : null;
      const limit = values[32] || 25;

      return events.filter((event) => {
        if (event.school_id !== schoolId) return false;
        if (refundEventId && event.id !== refundEventId) return false;
        if (idempotencyKey && event.idempotency_key !== idempotencyKey) return false;
        if (stripeRefundId && event.stripe_refund_id !== stripeRefundId) return false;
        if (learnerId && event.learner_id !== learnerId) return false;
        if (refundType && event.refund_type !== refundType) return false;
        if (status && event.status !== status) return false;
        if (learnerLike) {
          const learnerText = `${event.learner_name || ''} ${event.learner_email || ''}`.toLowerCase();
          if (!learnerText.includes(learnerLike)) return false;
        }
        if (qLike) {
          const haystack = [
            event.id,
            event.idempotency_key,
            event.stripe_refund_id,
            event.stripe_payment_intent_id,
            event.stripe_charge_id,
            event.learner_name,
            event.learner_email,
          ].join(' ').toLowerCase();
          if (String(event.id) !== qExact && !haystack.includes(qLike)) return false;
        }
        return true;
      }).slice(0, limit);
    }

    if (/FROM refund_event_lines/i.test(text)) {
      return lines.filter((line) => line.school_id === values[0] && line.refund_event_id === values[1]);
    }

    if (/FROM refund_event_notes rn/i.test(text)) {
      return notes.filter((note) => note.school_id === values[0] && note.refund_event_id === values[1]);
    }

    return [];
  };

  sql.calls = calls;
  return sql;
}

async function callRefundEvents({ query = {}, sql = makeSql(), headers = csrfAuthedHeaders() } = {}) {
  const req = {
    method: 'GET',
    query: { action: 'refund-events', ...query },
    body: {},
    headers,
    url: '/api/admin?action=refund-events',
    sql,
  };
  const res = makeRes();
  await adminHandler(req, res);
  return res;
}

test.describe('admin refund event discovery endpoint', () => {
  test('searches school-scoped refund events by learner, status, type, idempotency, and Stripe refund id', async () => {
    const sql = makeSql({
      events: [
        eventRow(),
        eventRow({ id: 901, idempotency_key: 'refund-ui-901', stripe_refund_id: 're_other', status: 'blocked' }),
        eventRow({ id: 902, school_id: 2, idempotency_key: 'refund-ui-900', stripe_refund_id: 're_slot_900' }),
      ],
    });

    const res = await callRefundEvents({
      sql,
      query: {
        q: 'alex@example.test',
        learner_id: 61,
        status: 'executed',
        refund_type: 'direct_slot',
        idempotency_key: 'refund-ui-900',
        stripe_refund_id: 're_slot_900',
        recent_days: 365,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      events: [{
        id: 900,
        school_id: 1,
        learner_id: 61,
        learner_email: 'alex@example.test',
        refund_type: 'direct_slot',
        status: 'executed',
        stripe_refund_id: 're_slot_900',
        idempotency_key: 'refund-ui-900',
      }],
    });
    expect(res.body.events).toHaveLength(1);
  });

  test('returns event detail with ledger lines, metadata, and notes timeline', async () => {
    const sql = makeSql({
      events: [eventRow()],
      lines: [{
        id: 1,
        school_id: 1,
        refund_event_id: 900,
        credit_transaction_id: null,
        booking_credit_source_id: null,
        lesson_booking_id: 7001,
        credit_source_adjustment_id: null,
        gross_pence_removed: 8250,
        source_fee_pence_used: 144,
        fee_withheld_pence: 144,
        net_refund_pence: 8106,
        minutes_adjusted: 0,
        created_at: '2026-06-03T10:00:01.000Z',
      }],
      notes: [{
        id: 1200,
        school_id: 1,
        refund_event_id: 900,
        created_by: 321,
        admin_email: 'admin@example.test',
        admin_name: 'Test Admin',
        note_type: 'incident',
        incident_status: 'watching',
        body: 'Monitoring ledger visibility after manual evidence review.',
        evidence_reference: 'INC-900',
        metadata: {},
        created_at: '2026-06-03T11:00:00.000Z',
      }],
    });

    const res = await callRefundEvents({ sql, query: { refund_event_id: 900 } });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      event: {
        id: 900,
        metadata: { refund_channel: 'stripe', evidence_reference: 'OPS-900' },
      },
      lines: [{
        lesson_booking_id: 7001,
        net_refund_pence: 8106,
      }],
      notes: [{
        note_type: 'incident',
        incident_status: 'watching',
        body: 'Monitoring ledger visibility after manual evidence review.',
      }],
    });
  });

  test('does not expose a cross-school refund event by id', async () => {
    const sql = makeSql({
      events: [eventRow({ id: 902, school_id: 2 })],
    });

    const res = await callRefundEvents({ sql, query: { refund_event_id: 902 } });

    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({
      error: true,
      code: 'REFUND_EVENT_NOT_FOUND',
    });
    expect(sql.calls).toHaveLength(1);
  });

  test('does not default exact identifier or generic q searches to the recent window', async () => {
    const sql = makeSql({ events: [eventRow()] });

    const byKey = await callRefundEvents({
      sql,
      query: { idempotency_key: 'refund-ui-900' },
    });
    expect(byKey.statusCode).toBe(200);
    expect(byKey.body.filters.recent_days).toBeNull();
    expect(sql.calls[0].values[18]).toBeNull();

    const bySearch = await callRefundEvents({
      sql,
      query: { q: 're_slot_900' },
    });
    expect(bySearch.statusCode).toBe(200);
    expect(bySearch.body.filters.recent_days).toBeNull();
    expect(sql.calls[1].values[18]).toBeNull();

    const broad = await callRefundEvents({ sql });
    expect(broad.statusCode).toBe(200);
    expect(broad.body.filters.recent_days).toBe(30);
    expect(sql.calls[2].values[18]).toBe(30);
  });

  test('is read-only and rejects invalid filters before SQL', async () => {
    const sql = makeSql({ events: [eventRow()] });

    const ok = await callRefundEvents({ sql, query: { recent_days: 30 } });
    expect(ok.statusCode).toBe(200);

    const allSql = sql.calls.map((call) => call.text).join('\n');
    expect(allSql).toMatch(/SELECT re\.id/i);
    expect(allSql).not.toMatch(/\bINSERT\b/i);
    expect(allSql).not.toMatch(/\bUPDATE\b/i);
    expect(allSql).not.toMatch(/\bDELETE\b/i);
    expect(allSql).not.toMatch(/stripe\.refunds/i);

    const invalid = await callRefundEvents({
      sql,
      query: { status: 'paid_to_learner' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.body).toMatchObject({
      error: true,
      code: 'INVALID_REFUND_STATUS',
    });
    expect(sql.calls).toHaveLength(1);

    const invalidDate = await callRefundEvents({
      sql,
      query: { created_from: '2026-02-31' },
    });
    expect(invalidDate.statusCode).toBe(400);
    expect(invalidDate.body).toMatchObject({
      error: true,
      code: 'INVALID_CREATED_FROM',
    });
    expect(sql.calls).toHaveLength(1);
  });
});
