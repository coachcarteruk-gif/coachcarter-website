// @ts-check
// Mocked admin manual-bank refund tests. No Neon, no prod, no live Stripe.

const { test, expect } = require('@playwright/test');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'admin-manual-bank-refund-test-secret';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_admin_manual_bank_refund';

const adminHandler = require('../api/admin');
const { MANUAL_BANK_OPERATOR_GO } = require('../api/_refund-manual-bank');

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
  const csrf = 'm'.repeat(64);
  const token = jwt.sign(
    { id: 321, email: 'admin@example.test', role: 'admin', isAdmin: true, school_id: schoolId },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
  return {
    cookie: `cc_admin=${token}; cc_csrf=${csrf}`,
    'x-csrf-token': csrf,
    'x-forwarded-for': '203.0.113.11',
  };
}

function creditSourceRow(overrides = {}) {
  return {
    credit_transaction_id: 101,
    school_id: 1,
    learner_id: 61,
    instructor_id: 4,
    source_minutes: 90,
    source_amount_pence: 8250,
    source_stripe_fee_pence: 144,
    stripe_session_id: 'cs_credit',
    stripe_payment_intent_id: 'pi_credit',
    stripe_charge_id: 'ch_credit',
    active_contribution_pence: 0,
    active_stripe_fee_pence: 0,
    active_minutes_drawn: 0,
    adjusted_pence: 0,
    adjusted_minutes: 0,
    ...overrides,
  };
}

function bookingRow(overrides = {}) {
  return {
    lesson_booking_id: 7001,
    school_id: 1,
    learner_id: 61,
    instructor_id: 4,
    payment_method: 'card',
    list_price_pence: 8250,
    booking_stripe_fee_pence: 144,
    bcs_contribution_pence: 0,
    bcs_stripe_fee_pence: 0,
    stripe_session_id: 'cs_slot',
    stripe_payment_intent_id: 'pi_slot',
    stripe_charge_id: 'ch_slot',
    already_paid_out: true,
    ...overrides,
  };
}

function makeSql({
  sourceRow = creditSourceRow(),
  bookingSourceRow = bookingRow(),
  existingEvent = null,
  existingLines = [],
} = {}) {
  const calls = [];
  const state = {
    event: existingEvent,
    nextEventId: 900,
    lines: [...existingLines],
  };

  const sql = async (strings, ...values) => {
    const text = strings.join('?');
    calls.push({ text, values });

    if (/FROM refund_events/i.test(text) && /WHERE school_id = \?/i.test(text) && /idempotency_key = \?/i.test(text)) {
      return state.event ? [state.event] : [];
    }

    if (/FROM refund_event_lines/i.test(text)) {
      return state.lines;
    }

    if (/FROM credit_transactions ct/i.test(text)) {
      return sourceRow ? [sourceRow] : [];
    }

    if (/FROM lesson_bookings lb/i.test(text)) {
      return bookingSourceRow ? [bookingSourceRow] : [];
    }

    if (/INSERT INTO refund_events/i.test(text)) {
      if (state.event) return [];
      state.event = {
        id: state.nextEventId++,
        school_id: values[0],
        learner_id: values[1],
        created_by: values[2],
        refund_type: values[3],
        status: 'executed',
        gross_refund_pence: values[4],
        processing_fee_withheld_pence: values[5],
        net_refund_pence: values[6],
        stripe_payment_intent_id: values[7],
        stripe_charge_id: values[8],
        stripe_refund_id: values[9],
        stripe_balance_transaction_id: values[10],
        idempotency_key: values[11],
        reason: values[12],
        metadata: typeof values[13] === 'string' ? JSON.parse(values[13]) : values[13],
      };
      return [{ id: state.event.id }];
    }

    if (/INSERT INTO refund_event_lines/i.test(text)) {
      state.lines.push({
        id: state.lines.length + 1,
        school_id: values[0],
        refund_event_id: values[1],
        credit_transaction_id: values[2],
        booking_credit_source_id: values[3],
        lesson_booking_id: values[4],
        credit_source_adjustment_id: values[5],
        gross_pence_removed: values[6],
        source_fee_pence_used: values[7],
        fee_withheld_pence: values[8],
        net_refund_pence: values[9],
        minutes_adjusted: values[10],
      });
      return [];
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

function makeStripe() {
  const calls = [];
  return {
    refunds: {
      create: async (...args) => {
        calls.push(['refunds.create', ...args]);
        throw new Error('manual bank tests must not create Stripe refunds');
      },
    },
    calls,
  };
}

async function callManualBank({
  body,
  sql = makeSql(),
  stripeClient = makeStripe(),
  headers = csrfAuthedHeaders(),
} = {}) {
  const req = {
    method: 'POST',
    query: { action: 'record-manual-bank-refund' },
    body,
    headers,
    url: '/api/admin?action=record-manual-bank-refund',
    sql,
    stripeClient,
  };
  const res = makeRes();
  await adminHandler(req, res);
  return res;
}

function manualBankBody(overrides = {}) {
  return {
    refund_type: 'direct_slot',
    lesson_booking_id: 7001,
    reason: 'Approved bank refund for already-paid-out lesson',
    idempotency_key: 'manual-bank-refund-key-7001',
    manual_bank_reference: 'BANK-REF-7001',
    operator_go: MANUAL_BANK_OPERATOR_GO,
    ...overrides,
  };
}

test.describe('admin manual bank refund record endpoint', () => {
  test('records an already-paid-out direct booking as ledger-only manual bank evidence', async () => {
    const sql = makeSql();
    const stripeClient = makeStripe();

    const res = await callManualBank({
      body: manualBankBody(),
      sql,
      stripeClient,
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      manual_bank_recorded: true,
      idempotent_replay: false,
      refund_event: {
        status: 'executed',
        refund_type: 'direct_slot',
        stripe_refund_id: null,
        gross_refund_pence: 8250,
        processing_fee_withheld_pence: 144,
        net_refund_pence: 8106,
      },
    });
    expect(res.body.refund_event.metadata).toMatchObject({
      refund_channel: 'manual_bank',
      manual_bank_reference: 'BANK-REF-7001',
      preview_code: 'BOOKING_ALREADY_PAID_OUT',
      recommended_operator_action: 'manual_bank_review_required',
    });
    expect(res.body.refund_event.lines[0]).toMatchObject({
      lesson_booking_id: 7001,
      source_fee_pence_used: 144,
      fee_withheld_pence: 144,
      net_refund_pence: 8106,
    });
    expect(stripeClient.calls).toHaveLength(0);
    expect(sql.calls.some((call) => /INSERT INTO refund_events/i.test(call.text))).toBe(true);
    expect(sql.calls.some((call) => /INSERT INTO refund_event_lines/i.test(call.text))).toBe(true);
    expect(sql.calls.some((call) => /INSERT INTO audit_log/i.test(call.text))).toBe(true);

    const allSql = sql.calls.map((call) => call.text).join('\n');
    expect(allSql).not.toMatch(/stripe\.refunds/i);
    expect(allSql).not.toMatch(/INSERT INTO credit_source_adjustments/i);
    expect(allSql).not.toMatch(/UPDATE\s+learner_credit_balances/i);
    expect(allSql).not.toMatch(/UPDATE\s+lesson_bookings/i);
    expect(allSql).not.toMatch(/INSERT\s+INTO\s+payout_line_items/i);
    expect(allSql).not.toMatch(/UPDATE\s+instructor_payouts/i);
  });

  test('refuses to divert clean execute-eligible refunds into manual bank recording', async () => {
    const sql = makeSql({ bookingSourceRow: null });
    const stripeClient = makeStripe();

    const res = await callManualBank({
      body: manualBankBody({
        refund_type: 'credit_purchase',
        lesson_booking_id: undefined,
        credit_transaction_id: 101,
        idempotency_key: 'manual-bank-clean-credit-key',
      }),
      sql,
      stripeClient,
    });

    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({
      error: true,
      code: 'MANUAL_BANK_NOT_ALLOWED_FOR_CLEAN_PREVIEW',
      manual_bank_recorded: false,
    });
    expect(stripeClient.calls).toHaveLength(0);
    expect(sql.calls.some((call) => /INSERT INTO refund_events/i.test(call.text))).toBe(false);
    expect(sql.calls.some((call) => /INSERT INTO refund_event_lines/i.test(call.text))).toBe(false);
  });

  test('records a missing-fee credit purchase when the preview still has source line evidence', async () => {
    const sql = makeSql({
      sourceRow: creditSourceRow({
        source_stripe_fee_pence: null,
        stripe_session_id: null,
        stripe_payment_intent_id: null,
        stripe_charge_id: null,
      }),
      bookingSourceRow: null,
    });
    const stripeClient = makeStripe();

    const res = await callManualBank({
      body: manualBankBody({
        refund_type: 'credit_purchase',
        lesson_booking_id: undefined,
        credit_transaction_id: 101,
        idempotency_key: 'manual-bank-missing-fee-credit-key',
        manual_bank_reference: 'BANK-MISSING-FEE-101',
      }),
      sql,
      stripeClient,
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      manual_bank_recorded: true,
      refund_event: {
        refund_type: 'credit_purchase',
        stripe_refund_id: null,
        net_refund_pence: 8250,
      },
    });
    expect(res.body.refund_event.metadata).toMatchObject({
      refund_channel: 'manual_bank',
      manual_bank_reference: 'BANK-MISSING-FEE-101',
      preview_code: 'MISSING_PROCESSING_FEE',
    });
    expect(res.body.refund_event.lines[0]).toMatchObject({
      credit_transaction_id: 101,
      source_fee_pence_used: 0,
      fee_withheld_pence: 0,
      net_refund_pence: 8250,
      minutes_adjusted: 90,
    });
    expect(stripeClient.calls).toHaveLength(0);
    expect(sql.calls.some((call) => /INSERT INTO credit_source_adjustments/i.test(call.text))).toBe(false);
  });

  test('idempotent replay returns the existing manual bank event without another ledger write', async () => {
    const existingEvent = {
      id: 901,
      school_id: 1,
      learner_id: 61,
      created_by: 321,
      refund_type: 'direct_slot',
      status: 'executed',
      gross_refund_pence: 8250,
      processing_fee_withheld_pence: 0,
      net_refund_pence: 8250,
      stripe_refund_id: null,
      idempotency_key: 'manual-bank-refund-key-7001',
      reason: 'Approved bank refund for already-paid-out lesson',
      metadata: {
        refund_channel: 'manual_bank',
        manual_bank_reference: 'BANK-REF-7001',
        manual_bank_request: {
          school_id: 1,
          refund_type: 'direct_slot',
          credit_transaction_id: null,
          booking_credit_source_id: null,
          lesson_booking_id: 7001,
          gross_refund_pence: null,
          refunded_minutes: null,
          reason: 'Approved bank refund for already-paid-out lesson',
          manual_bank_reference: 'BANK-REF-7001',
        },
      },
    };
    const sql = makeSql({
      existingEvent,
      existingLines: [{
        id: 1,
        school_id: 1,
        refund_event_id: 901,
        lesson_booking_id: 7001,
        gross_pence_removed: 8250,
        source_fee_pence_used: 0,
        fee_withheld_pence: 0,
        net_refund_pence: 8250,
        minutes_adjusted: 0,
      }],
    });

    const res = await callManualBank({
      body: manualBankBody(),
      sql,
      stripeClient: makeStripe(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      idempotent_replay: true,
      manual_bank_recorded: false,
      refund_event: { id: 901 },
    });
    expect(sql.calls.some((call) => /INSERT INTO refund_events/i.test(call.text))).toBe(false);
    expect(sql.calls.some((call) => /INSERT INTO refund_event_lines/i.test(call.text))).toBe(false);
  });

  test('idempotent replay refuses a reused manual key for a different request', async () => {
    const sql = makeSql({
      existingEvent: {
        id: 902,
        school_id: 1,
        learner_id: 61,
        created_by: 321,
        refund_type: 'direct_slot',
        status: 'executed',
        gross_refund_pence: 8250,
        processing_fee_withheld_pence: 144,
        net_refund_pence: 8106,
        stripe_refund_id: null,
        idempotency_key: 'manual-bank-refund-key-7001',
        reason: 'Different approved bank refund',
        metadata: {
          refund_channel: 'manual_bank',
          manual_bank_reference: 'BANK-OTHER',
          manual_bank_request: {
            school_id: 1,
            refund_type: 'direct_slot',
            credit_transaction_id: null,
            booking_credit_source_id: null,
            lesson_booking_id: 9999,
            gross_refund_pence: null,
            refunded_minutes: null,
            reason: 'Different approved bank refund',
            manual_bank_reference: 'BANK-OTHER',
          },
        },
      },
      existingLines: [{
        id: 1,
        school_id: 1,
        refund_event_id: 902,
        lesson_booking_id: 9999,
        gross_pence_removed: 8250,
        source_fee_pence_used: 144,
        fee_withheld_pence: 144,
        net_refund_pence: 8106,
        minutes_adjusted: 0,
      }],
    });

    const res = await callManualBank({
      body: manualBankBody(),
      sql,
      stripeClient: makeStripe(),
    });

    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({
      error: true,
      code: 'IDEMPOTENCY_KEY_COLLISION',
      manual_bank_recorded: false,
    });
    expect(sql.calls.some((call) => /INSERT INTO refund_events/i.test(call.text))).toBe(false);
  });

  test('operator go is required before planning or SQL mutation', async () => {
    const sql = makeSql();
    const stripeClient = makeStripe();

    const res = await callManualBank({
      body: manualBankBody({ operator_go: 'NOT_CONFIRMED' }),
      sql,
      stripeClient,
    });

    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({
      error: true,
      code: 'OPERATOR_GO_REQUIRED',
      manual_bank_recorded: false,
    });
    expect(stripeClient.calls).toHaveLength(0);
    expect(sql.calls).toHaveLength(0);
  });

  test('colliding automatic refund idempotency keys are refused', async () => {
    const sql = makeSql({
      existingEvent: {
        id: 777,
        school_id: 1,
        learner_id: 61,
        created_by: 321,
        refund_type: 'credit_purchase',
        status: 'executed',
        gross_refund_pence: 8250,
        processing_fee_withheld_pence: 144,
        net_refund_pence: 8106,
        stripe_refund_id: 're_existing',
        idempotency_key: 'manual-bank-refund-key-7001',
        reason: 'automatic refund',
        metadata: {},
      },
      existingLines: [{
        id: 1,
        school_id: 1,
        refund_event_id: 777,
        credit_transaction_id: 101,
        credit_source_adjustment_id: 800,
        gross_pence_removed: 8250,
        source_fee_pence_used: 144,
        fee_withheld_pence: 144,
        net_refund_pence: 8106,
        minutes_adjusted: 90,
      }],
    });

    const res = await callManualBank({
      body: manualBankBody(),
      sql,
      stripeClient: makeStripe(),
    });

    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({
      error: true,
      code: 'IDEMPOTENCY_KEY_COLLISION',
      manual_bank_recorded: false,
    });
    expect(sql.calls.some((call) => /INSERT INTO refund_events/i.test(call.text))).toBe(false);
  });
});
