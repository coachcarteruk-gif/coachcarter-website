// @ts-check
// Mocked admin refund incident readiness tests. No Neon, no prod, no live Stripe.

const { test, expect } = require('@playwright/test');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'admin-refund-readiness-test-secret';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_admin_refund_readiness';

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
  const csrf = 'r'.repeat(64);
  const token = jwt.sign(
    { id: 321, name: 'Test Admin', email: 'admin@example.test', role: 'admin', isAdmin: true, school_id: schoolId },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
  return {
    cookie: `cc_admin=${token}; cc_csrf=${csrf}`,
    'x-csrf-token': csrf,
    'x-forwarded-for': '203.0.113.28',
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
    refund_type: 'credit_purchase',
    status: 'executed',
    gross_refund_pence: 8250,
    processing_fee_withheld_pence: 144,
    net_refund_pence: 8106,
    stripe_payment_intent_id: 'pi_credit_900',
    stripe_charge_id: 'ch_credit_900',
    stripe_refund_id: 're_credit_900',
    stripe_balance_transaction_id: 'txn_refund_900',
    idempotency_key: 'refund-ui-900',
    reason: 'Approved unused-credit refund',
    metadata: { refund_channel: 'stripe', fee_evidence: { source: 'credit_transactions.stripe_fee_pence' } },
    created_at: '2026-06-04T09:00:00.000Z',
    ...overrides,
  };
}

function lineRow(overrides = {}) {
  return {
    id: 1,
    school_id: 1,
    refund_event_id: 900,
    credit_transaction_id: 101,
    booking_credit_source_id: null,
    lesson_booking_id: null,
    credit_source_adjustment_id: 800,
    gross_pence_removed: 8250,
    source_fee_pence_used: 144,
    fee_withheld_pence: 144,
    net_refund_pence: 8106,
    minutes_adjusted: 90,
    created_at: '2026-06-04T09:00:01.000Z',
    ...overrides,
  };
}

function noteRow(overrides = {}) {
  return {
    id: 1200,
    school_id: 1,
    refund_event_id: 900,
    note_type: 'operator_note',
    incident_status: 'not_applicable',
    body: 'Evidence reviewed.',
    evidence_reference: 'OPS-900',
    metadata: {},
    created_at: '2026-06-04T09:05:00.000Z',
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
      return events.filter((event) => event.school_id === schoolId && event.id === refundEventId).slice(0, 1);
    }

    if (/FROM refund_event_lines/i.test(text)) {
      const schoolId = values[0];
      const refundEventId = values[1];
      return lines.filter((line) => line.school_id === schoolId && line.refund_event_id === refundEventId);
    }

    if (/FROM refund_event_notes/i.test(text)) {
      const schoolId = values[0];
      const refundEventId = values[1];
      return notes.filter((note) => note.school_id === schoolId && note.refund_event_id === refundEventId);
    }

    return [];
  };

  sql.calls = calls;
  return sql;
}

async function callReadiness({ query = {}, sql = makeSql(), headers = csrfAuthedHeaders(), stripeClient } = {}) {
  const req = {
    method: 'GET',
    query: { action: 'refund-incident-readiness', refund_event_id: 900, ...query },
    body: {},
    headers,
    url: '/api/admin?action=refund-incident-readiness',
    sql,
    stripeClient,
  };
  const res = makeRes();
  await adminHandler(req, res);
  return res;
}

test.describe('admin refund incident readiness endpoint', () => {
  test('classifies a complete Stripe refund ledger as complete', async () => {
    const sql = makeSql({
      events: [eventRow()],
      lines: [lineRow()],
      notes: [noteRow()],
    });

    const res = await callReadiness({ sql });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      read_only: true,
      readiness: {
        classification: 'complete',
        complete: true,
        repairable_candidate: false,
        allowed_next_step: 'post_refund_verification',
      },
    });
    expect(res.body.readiness.required_evidence).toEqual(expect.arrayContaining([
      'refund_event:900',
      'idempotency_key:refund-ui-900',
      'stripe_refund_id:re_credit_900',
    ]));
  });

  test('classifies missing ledger lines as incomplete repair candidate without mutating anything', async () => {
    const sql = makeSql({
      events: [eventRow()],
      lines: [],
      notes: [],
    });

    const res = await callReadiness({ sql });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      readiness: {
        classification: 'incomplete',
        complete: false,
        repairable_candidate: true,
        allowed_next_step: 'record_evidence_and_stop_for_review',
        reasons: {
          incomplete: ['REFUND_EVENT_LINES_MISSING'],
        },
      },
    });

    const allSql = sql.calls.map((call) => call.text).join('\n');
    expect(allSql).toMatch(/SELECT re\.id/i);
    expect(allSql).not.toMatch(/\bINSERT\b/i);
    expect(allSql).not.toMatch(/\bUPDATE\b/i);
    expect(allSql).not.toMatch(/\bDELETE\b/i);
    expect(allSql).not.toMatch(/lesson_bookings/i);
    expect(allSql).not.toMatch(/payout_line_items/i);
    expect(allSql).not.toMatch(/instructor_payouts/i);
    expect(allSql).not.toMatch(/learner_credit_balances/i);
    expect(allSql).not.toMatch(/credit_source_adjustments/i);
    expect(allSql).not.toMatch(/booking_credit_sources/i);
    expect(allSql).not.toMatch(/credit_transactions/i);
  });

  test('classifies open incident notes as needing a manual decision', async () => {
    const sql = makeSql({
      events: [eventRow()],
      lines: [lineRow()],
      notes: [noteRow({
        note_type: 'incident',
        incident_status: 'open',
        body: 'Stripe succeeded but evidence needs operator review.',
      })],
    });

    const res = await callReadiness({ sql });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      readiness: {
        classification: 'needs_manual_decision',
        complete: false,
        repairable_candidate: false,
        reasons: {
          manual_decision: ['OPEN_INCIDENT_NOTE'],
        },
      },
    });
  });

  test('does not expose a cross-school refund event by id', async () => {
    const sql = makeSql({
      events: [eventRow({ school_id: 2 })],
      lines: [lineRow({ school_id: 2 })],
    });

    const res = await callReadiness({ sql, query: { refund_event_id: 900 } });

    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({
      error: true,
      code: 'REFUND_EVENT_NOT_FOUND',
    });
    expect(sql.calls).toHaveLength(1);
  });

  test('rejects invalid requests before SQL and never calls Stripe', async () => {
    const sql = makeSql({
      events: [eventRow()],
      lines: [lineRow()],
    });
    const stripeClient = {
      refunds: {
        create: async () => {
          throw new Error('Stripe should not be called by readiness');
        },
      },
    };

    const invalid = await callReadiness({
      sql,
      stripeClient,
      query: { refund_event_id: 'nope' },
    });

    expect(invalid.statusCode).toBe(400);
    expect(invalid.body).toMatchObject({
      error: true,
      code: 'REFUND_EVENT_REQUIRED',
    });
    expect(sql.calls).toHaveLength(0);

    const ok = await callReadiness({ sql, stripeClient });
    expect(ok.statusCode).toBe(200);
    expect(sql.calls).toHaveLength(3);
  });
});
