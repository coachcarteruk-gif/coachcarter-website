// @ts-check
// Mocked admin execute-refund tests. No Neon, no prod, no live Stripe.

const { test, expect } = require('@playwright/test');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'admin-execute-refund-test-secret';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_admin_execute_refund';

const adminHandler = require('../api/admin');
const { EXECUTE_OPERATOR_GO } = require('../api/_refund-executor');

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
  const csrf = 'd'.repeat(64);
  const token = jwt.sign(
    { id: 321, email: 'admin@example.test', role: 'admin', isAdmin: true, school_id: schoolId },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
  return {
    cookie: `cc_admin=${token}; cc_csrf=${csrf}`,
    'x-csrf-token': csrf,
    'x-forwarded-for': '203.0.113.10',
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
    already_paid_out: false,
    ...overrides,
  };
}

function makeSql({
  sourceRow = creditSourceRow(),
  bookingSourceRow = null,
  existingEvent = null,
  existingLines = [],
  failLineInsertOnce = false,
} = {}) {
  const calls = [];
  const state = {
    event: existingEvent,
    nextEventId: 700,
    nextCsaId: 800,
    lines: [...existingLines],
    failLineInsertOnce,
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
        metadata: values[13],
      };
      return [{ id: state.event.id }];
    }

    if (/INSERT INTO credit_source_adjustments/i.test(text)) {
      return [{ id: state.nextCsaId++ }];
    }

    if (/FROM credit_source_adjustments/i.test(text) && /stripe_refund_id = \?/i.test(text)) {
      return [];
    }

    if (/INSERT INTO refund_event_lines/i.test(text)) {
      if (state.failLineInsertOnce) {
        state.failLineInsertOnce = false;
        throw new Error('simulated line insert failure');
      }
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

function makeRollbackTransactionRunner(sql) {
  const transactionCalls = [];
  const runner = async (callback) => {
    transactionCalls.push('begin');
    const snapshot = {
      event: sql.state.event ? { ...sql.state.event } : null,
      nextEventId: sql.state.nextEventId,
      nextCsaId: sql.state.nextCsaId,
      lines: sql.state.lines.map((line) => ({ ...line })),
    };
    try {
      const result = await callback(sql);
      transactionCalls.push('commit');
      return result;
    } catch (err) {
      sql.state.event = snapshot.event;
      sql.state.nextEventId = snapshot.nextEventId;
      sql.state.nextCsaId = snapshot.nextCsaId;
      sql.state.lines = snapshot.lines;
      transactionCalls.push('rollback');
      throw err;
    }
  };
  runner.calls = transactionCalls;
  return runner;
}

function makeStripe({ fail = false } = {}) {
  const calls = [];
  return {
    refunds: {
      create: async (...args) => {
        calls.push(['refunds.create', ...args]);
        if (fail) throw new Error('simulated Stripe failure');
        return {
          id: 're_test_123',
          balance_transaction: 'txn_refund_123',
        };
      },
    },
    calls,
  };
}

async function callExecute({
  body,
  sql = makeSql(),
  stripeClient = makeStripe(),
  headers = csrfAuthedHeaders(),
  adjustCreditBalance = async () => ({ ok: true, balanceMinutes: 0 }),
  transactionRunner,
} = {}) {
  const req = {
    method: 'POST',
    query: { action: 'execute-refund' },
    body,
    headers,
    url: '/api/admin?action=execute-refund',
    sql,
    stripeClient,
    adjustCreditBalance,
    transactionRunner,
  };
  const res = makeRes();
  await adminHandler(req, res);
  return res;
}

function executeBody(overrides = {}) {
  return {
    refund_type: 'credit_purchase',
    credit_transaction_id: 101,
    reason: 'approved unused credit refund',
    idempotency_key: 'refund-test-key-101',
    operator_go: EXECUTE_OPERATOR_GO,
    ...overrides,
  };
}

test.describe('admin execute-refund endpoint', () => {
  test('executes a credit-source refund through injected Stripe, ledger, CSA, balance adjustment, and audit', async () => {
    const sql = makeSql();
    const stripeClient = makeStripe();
    const balanceCalls = [];

    const res = await callExecute({
      body: executeBody(),
      sql,
      stripeClient,
      adjustCreditBalance: async (_sql, args) => {
        balanceCalls.push(args);
        return { ok: true, balanceMinutes: 0 };
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      refund_executed: true,
      idempotent_replay: false,
      refund_event: {
        status: 'executed',
        stripe_refund_id: 're_test_123',
        net_refund_pence: 8106,
      },
    });
    expect(stripeClient.calls).toHaveLength(1);
    expect(stripeClient.calls[0][1]).toMatchObject({
      amount: 8106,
      payment_intent: 'pi_credit',
    });
    expect(stripeClient.calls[0][2]).toEqual({ idempotencyKey: 'refund-test-key-101' });
    expect(balanceCalls).toEqual([expect.objectContaining({
      learnerId: 61,
      instructorId: 4,
      schoolId: 1,
      delta: -90,
      creditsDelta: -2,
    })]);
    expect(sql.calls.some((call) => /INSERT INTO credit_source_adjustments/i.test(call.text))).toBe(true);
    expect(sql.calls.some((call) => /INSERT INTO refund_events/i.test(call.text))).toBe(true);
    expect(sql.calls.some((call) => /INSERT INTO refund_event_lines/i.test(call.text))).toBe(true);
    expect(sql.calls.some((call) => /INSERT INTO audit_log/i.test(call.text))).toBe(true);
  });

  test('uses the planner-derived learner/instructor/school tuple for the LCB decrement', async () => {
    const sql = makeSql({
      sourceRow: creditSourceRow({
        learner_id: 77,
        instructor_id: 9,
        school_id: 1,
      }),
    });
    const balanceCalls = [];

    const res = await callExecute({
      body: executeBody({
        instructor_id: 12345,
        learner_id: 54321,
        school_id: 999,
        idempotency_key: 'refund-test-key-trusted-line-scope',
      }),
      sql,
      stripeClient: makeStripe(),
      adjustCreditBalance: async (_sql, args) => {
        balanceCalls.push(args);
        return { ok: true, balanceMinutes: 0 };
      },
    });

    expect(res.statusCode).toBe(200);
    expect(balanceCalls).toEqual([{
      learnerId: 77,
      instructorId: 9,
      schoolId: 1,
      delta: -90,
      creditsDelta: -2,
      allowOverdraft: false,
    }]);
  });

  test('idempotent replay returns existing event without another Stripe refund or ledger write', async () => {
    const existingEvent = {
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
      idempotency_key: 'refund-test-key-101',
      reason: 'approved unused credit refund',
      metadata: {},
    };
    const sql = makeSql({
      existingEvent,
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
    const stripeClient = makeStripe();

    const res = await callExecute({
      body: executeBody(),
      sql,
      stripeClient,
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      idempotent_replay: true,
      refund_executed: false,
      refund_event: { id: 777, stripe_refund_id: 're_existing' },
    });
    expect(stripeClient.calls).toHaveLength(0);
    expect(sql.calls.some((call) => /INSERT INTO refund_events/i.test(call.text))).toBe(false);
    expect(sql.calls.some((call) => /INSERT INTO credit_source_adjustments/i.test(call.text))).toBe(false);
  });

  test('idempotent replay refuses an incomplete existing event instead of returning false success', async () => {
    const sql = makeSql({
      existingEvent: {
        id: 778,
        school_id: 1,
        learner_id: 61,
        created_by: 321,
        refund_type: 'credit_purchase',
        status: 'executed',
        gross_refund_pence: 8250,
        processing_fee_withheld_pence: 144,
        net_refund_pence: 8106,
        stripe_refund_id: 're_partial',
        idempotency_key: 'refund-test-key-101',
        reason: 'partial old ledger',
        metadata: {},
      },
      existingLines: [],
    });
    const stripeClient = makeStripe();

    const res = await callExecute({
      body: executeBody(),
      sql,
      stripeClient,
    });

    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({
      error: true,
      code: 'INCOMPLETE_REFUND_LEDGER',
    });
    expect(stripeClient.calls).toHaveLength(0);
    expect(sql.calls.some((call) => /INSERT INTO refund_events/i.test(call.text))).toBe(false);
  });

  test('rolls back post-Stripe ledger writes if line insertion fails, allowing retry to complete cleanly', async () => {
    const sql = makeSql({ failLineInsertOnce: true });
    const transactionRunner = makeRollbackTransactionRunner(sql);

    const first = await callExecute({
      body: executeBody({ idempotency_key: 'refund-test-key-rollback' }),
      sql,
      stripeClient: makeStripe(),
      transactionRunner,
    });

    expect(first.statusCode).toBe(500);
    expect(sql.state.event).toBeNull();
    expect(sql.state.lines).toEqual([]);
    expect(transactionRunner.calls).toEqual(['begin', 'rollback']);

    const retryStripe = makeStripe();
    const retry = await callExecute({
      body: executeBody({ idempotency_key: 'refund-test-key-rollback' }),
      sql,
      stripeClient: retryStripe,
      transactionRunner,
    });

    expect(retry.statusCode).toBe(200);
    expect(retry.body).toMatchObject({
      ok: true,
      refund_executed: true,
      refund_event: { status: 'executed' },
    });
    expect(sql.state.lines).toHaveLength(1);
    expect(transactionRunner.calls).toEqual(['begin', 'rollback', 'begin', 'commit']);
  });

  test('ignores caller-supplied tiny refunded_minutes for full credit-source execution', async () => {
    const sql = makeSql();
    const balanceCalls = [];

    const res = await callExecute({
      body: executeBody({ refunded_minutes: 1 }),
      sql,
      stripeClient: makeStripe(),
      adjustCreditBalance: async (_sql, args) => {
        balanceCalls.push(args);
        return { ok: true, balanceMinutes: 0 };
      },
    });

    expect(res.statusCode).toBe(200);
    expect(balanceCalls).toEqual([expect.objectContaining({
      delta: -90,
      creditsDelta: -2,
    })]);
    expect(sql.state.lines[0]).toMatchObject({
      gross_pence_removed: 8250,
      minutes_adjusted: 90,
    });
  });

  test('derives partial refund minutes proportionally with ceiling rounding', async () => {
    const sql = makeSql();
    const balanceCalls = [];

    const res = await callExecute({
      body: executeBody({
        gross_refund_pence: 4125,
        refunded_minutes: 1,
        idempotency_key: 'refund-test-key-partial',
      }),
      sql,
      stripeClient: makeStripe(),
      adjustCreditBalance: async (_sql, args) => {
        balanceCalls.push(args);
        return { ok: true, balanceMinutes: 45 };
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.refund_event).toMatchObject({
      gross_refund_pence: 4125,
      processing_fee_withheld_pence: 72,
      net_refund_pence: 4053,
    });
    expect(balanceCalls).toEqual([expect.objectContaining({
      delta: -45,
      creditsDelta: -1,
    })]);
    expect(sql.state.lines[0]).toMatchObject({
      gross_pence_removed: 4125,
      minutes_adjusted: 45,
    });
  });

  test('blocks execution when trusted source minutes cannot be derived safely', async () => {
    const sql = makeSql({
      sourceRow: creditSourceRow({
        source_minutes: 0,
      }),
    });
    const stripeClient = makeStripe();

    const res = await callExecute({
      body: executeBody({
        gross_refund_pence: 4125,
        refunded_minutes: 1,
        idempotency_key: 'refund-test-key-underivable-minutes',
      }),
      sql,
      stripeClient,
    });

    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({
      error: true,
      code: 'REFUND_MINUTES_UNDERIVABLE',
      refund_executed: false,
    });
    expect(stripeClient.calls).toHaveLength(0);
    expect(sql.calls.some((call) => /INSERT INTO refund_events/i.test(call.text))).toBe(false);
  });

  test('Stripe failure returns before ledger, CSA, balance, or audit mutation', async () => {
    const sql = makeSql();
    const stripeClient = makeStripe({ fail: true });
    const balanceCalls = [];

    const res = await callExecute({
      body: executeBody(),
      sql,
      stripeClient,
      adjustCreditBalance: async (_sql, args) => {
        balanceCalls.push(args);
        return { ok: true };
      },
    });

    expect(res.statusCode).toBe(502);
    expect(res.body).toMatchObject({
      error: true,
      code: 'STRIPE_REFUND_FAILED',
      refund_executed: false,
    });
    expect(stripeClient.calls).toHaveLength(1);
    expect(balanceCalls).toHaveLength(0);
    expect(sql.calls.some((call) => /INSERT INTO refund_events/i.test(call.text))).toBe(false);
    expect(sql.calls.some((call) => /INSERT INTO credit_source_adjustments/i.test(call.text))).toBe(false);
    expect(sql.calls.some((call) => /INSERT INTO audit_log/i.test(call.text))).toBe(false);
  });

  test('missing fee evidence remains blocked/manual-review and does not call Stripe refunds', async () => {
    const sql = makeSql({
      sourceRow: creditSourceRow({
        source_stripe_fee_pence: null,
        stripe_session_id: null,
        stripe_payment_intent_id: null,
        stripe_charge_id: null,
      }),
    });
    const stripeClient = makeStripe();

    const res = await callExecute({
      body: executeBody(),
      sql,
      stripeClient,
    });

    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({
      error: true,
      code: 'MISSING_PROCESSING_FEE',
      refund_executed: false,
    });
    expect(stripeClient.calls).toHaveLength(0);
  });

  test('already-paid-out direct bookings remain blocked before Stripe refund creation', async () => {
    const sql = makeSql({
      sourceRow: null,
      bookingSourceRow: bookingRow({ already_paid_out: true }),
    });
    const stripeClient = makeStripe();

    const res = await callExecute({
      body: executeBody({
        refund_type: 'direct_slot',
        credit_transaction_id: undefined,
        lesson_booking_id: 7001,
        idempotency_key: 'refund-test-key-paid-out',
      }),
      sql,
      stripeClient,
    });

    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({
      error: true,
      code: 'BOOKING_ALREADY_PAID_OUT',
      refund_executed: false,
    });
    expect(stripeClient.calls).toHaveLength(0);
    expect(sql.calls.some((call) => /payout_line_items/i.test(call.text))).toBe(true);
    expect(sql.calls.some((call) => /INSERT INTO refund_events/i.test(call.text))).toBe(false);
  });

  test('operator go is required before planning, Stripe, or SQL mutation', async () => {
    const sql = makeSql();
    const stripeClient = makeStripe();

    const res = await callExecute({
      body: executeBody({ operator_go: 'not-today' }),
      sql,
      stripeClient,
    });

    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({
      error: true,
      code: 'OPERATOR_GO_REQUIRED',
    });
    expect(stripeClient.calls).toHaveLength(0);
    expect(sql.calls).toHaveLength(0);
  });

  test('idempotency key is required before planning, Stripe, or SQL mutation', async () => {
    const sql = makeSql();
    const stripeClient = makeStripe();

    const res = await callExecute({
      body: executeBody({ idempotency_key: '' }),
      sql,
      stripeClient,
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({
      error: true,
      code: 'IDEMPOTENCY_KEY_REQUIRED',
    });
    expect(stripeClient.calls).toHaveLength(0);
    expect(sql.calls).toHaveLength(0);
  });

  test('tenant scope is carried into planner and ledger writes', async () => {
    const sql = makeSql({ sourceRow: null });
    const stripeClient = makeStripe();

    const res = await callExecute({
      body: executeBody(),
      sql,
      stripeClient,
      headers: csrfAuthedHeaders(2),
    });

    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({
      error: true,
      code: 'CREDIT_TRANSACTION_NOT_FOUND',
      refund_executed: false,
    });
    const creditLookup = sql.calls.find((call) => /FROM credit_transactions ct/i.test(call.text));
    expect(creditLookup.values).toEqual(expect.arrayContaining([2, 101]));
    expect(stripeClient.calls).toHaveLength(0);
  });

  test('does not mutate booking status or payout rows during automatic execution', async () => {
    const sql = makeSql();

    const res = await callExecute({
      body: executeBody(),
      sql,
      stripeClient: makeStripe(),
    });

    expect(res.statusCode).toBe(200);
    const allSql = sql.calls.map((call) => call.text).join('\n');
    expect(allSql).not.toMatch(/UPDATE\s+lesson_bookings/i);
    expect(allSql).not.toMatch(/INSERT\s+INTO\s+payout_line_items/i);
    expect(allSql).not.toMatch(/UPDATE\s+instructor_payouts/i);
    expect(allSql).not.toMatch(/DELETE\s+FROM/i);
  });
});
