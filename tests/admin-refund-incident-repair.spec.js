// @ts-check
// Mocked admin refund incident repair-plan refusal tests. No Neon, no prod, no live Stripe.

const { test, expect } = require('@playwright/test');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'admin-refund-repair-test-secret';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_admin_refund_repair';

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
  const csrf = 'p'.repeat(64);
  const token = jwt.sign(
    { id: 321, name: 'Test Admin', email: 'admin@example.test', role: 'admin', isAdmin: true, school_id: schoolId },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
  return {
    cookie: `cc_admin=${token}; cc_csrf=${csrf}`,
    'x-csrf-token': csrf,
    'x-forwarded-for': '203.0.113.29',
  };
}

function eventRow(overrides = {}) {
  return {
    id: 900,
    school_id: 1,
    learner_id: 61,
    created_by: 321,
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
    credit_source_adjustment_id: null,
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

    if (/FROM refund_events/i.test(text) && /idempotency_key/i.test(text)) {
      const schoolId = values[0];
      const idempotencyKey = values[1];
      return events.filter((event) => event.school_id === schoolId && event.idempotency_key === idempotencyKey);
    }

    return [];
  };

  sql.calls = calls;
  return sql;
}

function cleanRepairBody(overrides = {}) {
  return {
    refund_event_id: 900,
    original_idempotency_key: 'refund-ui-900',
    stripe_refund_id: 're_credit_900',
    expected_refund_type: 'credit_purchase',
    expected_source_evidence: {
      school_id: 1,
      learner_id: 61,
      credit_transaction_id: 101,
      gross_refund_pence: 8250,
      net_refund_pence: 8106,
      stripe_payment_intent_id: 'pi_credit_900',
    },
    operator_go: 'PLAN_INCIDENT_REPAIR_ONLY',
    ...overrides,
  };
}

async function callRepair({ body = cleanRepairBody(), sql = makeSql(), headers = csrfAuthedHeaders(), stripeClient } = {}) {
  const req = {
    method: 'POST',
    query: { action: 'refund-incident-repair-plan' },
    body,
    headers,
    url: '/api/admin?action=refund-incident-repair-plan',
    sql,
    stripeClient,
  };
  const res = makeRes();
  await adminHandler(req, res);
  return res;
}

function sqlText(sql) {
  return sql.calls.map((call) => call.text).join('\n');
}

function expectSelectOnly(sql) {
  const allSql = sqlText(sql);
  expect(allSql).toMatch(/SELECT re\.id/i);
  expect(allSql).not.toMatch(/\bINSERT\b/i);
  expect(allSql).not.toMatch(/\bUPDATE\b/i);
  expect(allSql).not.toMatch(/\bDELETE\b/i);
  expect(allSql).not.toMatch(/\bFROM\s+stripe/i);
  expect(allSql).not.toMatch(/stripe_refunds/i);
  expect(allSql).not.toMatch(/lesson_bookings/i);
  expect(allSql).not.toMatch(/payout_line_items/i);
  expect(allSql).not.toMatch(/instructor_payouts/i);
  expect(allSql).not.toMatch(/learner_credit_balances/i);
  expect(allSql).not.toMatch(/credit_source_adjustments/i);
  expect(allSql).not.toMatch(/booking_credit_sources/i);
  expect(allSql).not.toMatch(/credit_transactions/i);
}

test.describe('admin refund incident repair-plan refusal endpoint', () => {
  test('returns a structured refusal contract for an otherwise clean candidate', async () => {
    const sql = makeSql({
      events: [eventRow()],
      lines: [lineRow()],
      notes: [noteRow()],
    });

    const res = await callRepair({ sql });

    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({
      error: true,
      ok: false,
      code: 'INCIDENT_REPAIR_REFUSED',
      repair_mutation_allowed: false,
      repair_planning_only: true,
      mutation_performed: false,
      stripe_called: false,
      plan_contract: {
        school_id: 1,
        refund_event_id: 900,
        original_idempotency_key: 'refund-ui-900',
        stripe_refund_id: 're_credit_900',
      },
    });
    expect(res.body.plan_contract.repair_plan_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(res.body.refusal_reason_codes).toEqual(['REPAIR_MUTATION_NOT_IMPLEMENTED']);
    expectSelectOnly(sql);
  });

  test('does not expose a cross-school refund event by id', async () => {
    const sql = makeSql({
      events: [eventRow({ school_id: 2 })],
      lines: [lineRow({ school_id: 2 })],
    });

    const res = await callRepair({ sql });

    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({
      error: true,
      code: 'REFUND_EVENT_NOT_FOUND',
      repair_mutation_allowed: false,
      mutation_performed: false,
      refusal_reasons: [
        { code: 'REFUND_EVENT_NOT_FOUND' },
      ],
    });
    expect(sql.calls).toHaveLength(1);
  });

  test('refuses missing Stripe refund evidence and missing original idempotency evidence', async () => {
    const sql = makeSql({
      events: [eventRow({ stripe_refund_id: null, idempotency_key: null })],
      lines: [lineRow()],
      notes: [],
    });

    const res = await callRepair({
      sql,
      body: cleanRepairBody({
        original_idempotency_key: '',
        stripe_refund_id: '',
      }),
    });

    expect(res.statusCode).toBe(409);
    expect(res.body.refusal_reason_codes).toEqual(expect.arrayContaining([
      'STRIPE_REFUND_EVIDENCE_MISSING',
      'ORIGINAL_IDEMPOTENCY_KEY_MISSING',
    ]));
    expectSelectOnly(sql);
  });

  test('refuses an ambiguous original idempotency key', async () => {
    const sql = makeSql({
      events: [
        eventRow(),
        eventRow({ id: 901, idempotency_key: 'refund-ui-900' }),
      ],
      lines: [lineRow()],
      notes: [],
    });

    const res = await callRepair({ sql });

    expect(res.statusCode).toBe(409);
    expect(res.body.refusal_reason_codes).toEqual(expect.arrayContaining([
      'ORIGINAL_IDEMPOTENCY_KEY_AMBIGUOUS',
    ]));
    expect(res.body.refusal_reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'ORIGINAL_IDEMPOTENCY_KEY_AMBIGUOUS',
        details: { matching_refund_event_ids: [900, 901] },
      }),
    ]));
    expectSelectOnly(sql);
  });

  test('refuses non-executed events and unresolved incident or repair-decision notes', async () => {
    const sql = makeSql({
      events: [eventRow({ status: 'manual_review' })],
      lines: [lineRow()],
      notes: [
        noteRow({ note_type: 'incident', incident_status: 'watching' }),
        noteRow({ id: 1201, note_type: 'repair_decision', incident_status: 'not_applicable' }),
      ],
    });

    const res = await callRepair({ sql });

    expect(res.statusCode).toBe(409);
    expect(res.body.refusal_reason_codes).toEqual(expect.arrayContaining([
      'REFUND_EVENT_NOT_EXECUTED',
      'OPEN_OR_WATCHING_INCIDENT_NOTE',
      'REPAIR_DECISION_NOTE_PRESENT',
    ]));
    expectSelectOnly(sql);
  });

  test('refuses mismatched or unsupported refund type and source evidence', async () => {
    const sql = makeSql({
      events: [eventRow({
        refund_type: 'direct_slot',
        learner_id: 61,
      })],
      lines: [lineRow({
        credit_transaction_id: null,
        lesson_booking_id: 7001,
      })],
      notes: [],
    });

    const res = await callRepair({
      sql,
      body: cleanRepairBody({
        expected_refund_type: 'credit_purchase',
        expected_source_evidence: {
          school_id: 1,
          learner_id: 999,
          credit_transaction_id: 101,
          gross_refund_pence: 111,
          net_refund_pence: 222,
          stripe_payment_intent_id: 'pi_wrong',
        },
      }),
    });

    expect(res.statusCode).toBe(409);
    expect(res.body.refusal_reason_codes).toEqual(expect.arrayContaining([
      'REFUND_TYPE_MISMATCH',
      'UNSUPPORTED_REFUND_TYPE',
      'SOURCE_EVIDENCE_MISMATCH',
      'UNSUPPORTED_SOURCE_EVIDENCE',
    ]));
    expectSelectOnly(sql);
  });

  test('refuses any proposed booking payout BCS ledger Stripe credit or CSA mutation', async () => {
    const sql = makeSql({
      events: [eventRow()],
      lines: [lineRow()],
      notes: [],
    });

    const res = await callRepair({
      sql,
      body: cleanRepairBody({
        proposed_mutations: [
          { target: 'lesson_bookings', operation: 'update' },
          { target: 'payout_line_items', operation: 'update' },
          { target: 'booking_credit_sources', operation: 'update' },
          { target: 'refund_events', operation: 'update' },
          { target: 'refund_event_lines', operation: 'update' },
          { target: 'stripe_refunds', operation: 'create' },
          { target: 'learner_credit_balances', operation: 'update' },
          { target: 'credit_source_adjustments', operation: 'insert' },
        ],
      }),
    });

    expect(res.statusCode).toBe(409);
    expect(res.body.refusal_reason_codes).toEqual(expect.arrayContaining([
      'BOOKING_MUTATION_PROPOSED',
      'PAYOUT_MUTATION_PROPOSED',
      'BOOKING_CREDIT_SOURCE_MUTATION_PROPOSED',
      'HISTORICAL_REFUND_EVENT_MUTATION_PROPOSED',
      'HISTORICAL_REFUND_EVENT_LINE_MUTATION_PROPOSED',
      'STRIPE_MUTATION_PROPOSED',
      'LEARNER_CREDIT_MUTATION_PROPOSED',
      'CREDIT_SOURCE_ADJUSTMENT_MUTATION_PROPOSED',
    ]));
    expectSelectOnly(sql);
  });

  test('rejects invalid requests before SQL and never calls Stripe', async () => {
    const sql = makeSql({
      events: [eventRow()],
      lines: [lineRow()],
    });
    const stripeClient = {
      refunds: {
        create: async () => {
          throw new Error('Stripe should not be called by repair-plan refusal');
        },
      },
    };

    const res = await callRepair({
      sql,
      stripeClient,
      body: { refund_event_id: 'nope' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({
      error: true,
      code: 'REFUND_EVENT_REQUIRED',
      repair_mutation_allowed: false,
      mutation_performed: false,
    });
    expect(sql.calls).toHaveLength(0);
  });
});
