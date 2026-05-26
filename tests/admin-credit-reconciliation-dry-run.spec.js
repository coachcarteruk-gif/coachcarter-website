// @ts-check
// Mocked admin endpoint tests for credit-reconciliation dry-run inspection.
//
// No live Stripe, no Neon, no migrations, no payout crons, and no credit
// mutation helpers. SQL and Stripe are injected into the request object.

const { test, expect } = require('@playwright/test');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'admin-credit-dry-run-test-secret';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_admin_credit_dry_run';

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
  const csrf = 'b'.repeat(64);
  const token = jwt.sign(
    { id: 123, email: 'admin@example.test', role: 'admin', isAdmin: true, school_id: schoolId },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
  return {
    cookie: `cc_admin=${token}; cc_csrf=${csrf}`,
    'x-csrf-token': csrf,
  };
}

async function callAdmin({
  body = {},
  headers = csrfAuthedHeaders(),
  method = 'POST',
  sql = makeSql([]),
  stripeClient = validStripe(),
} = {}) {
  const req = {
    method,
    query: { action: 'credit-reconciliation' },
    body,
    headers,
    url: '/api/admin?action=credit-reconciliation',
    sql,
    stripeClient,
  };
  const res = makeRes();
  await adminHandler(req, res);
  return res;
}

function paymentIntent(overrides = {}) {
  return {
    id: 'pi_dry_run',
    object: 'payment_intent',
    amount: 33000,
    amount_received: 33000,
    amount_refunded: 0,
    metadata: {
      learner_id: '10',
      instructor_id: '4',
      minutes: '600',
      effective_rate_pence_per_minute: '55',
      payment_type: 'credit_purchase',
    },
    latest_charge: {
      id: 'ch_dry_run',
      object: 'charge',
      disputed: false,
      balance_transaction: { id: 'txn_dry_run', fee: 514 },
    },
    ...overrides,
  };
}

function checkoutSession(overrides = {}) {
  return {
    id: 'cs_dry_run',
    object: 'checkout.session',
    payment_intent: 'pi_dry_run',
    metadata: { payment_type: 'credit_purchase' },
    ...overrides,
  };
}

function creditTransaction(overrides = {}) {
  return {
    id: 42,
    source: 'stripe',
    created_at: '2026-05-25T10:00:00.000Z',
    school_id: 1,
    stripe_session_id: 'cs_dry_run',
    stripe_payment_intent_id: 'pi_dry_run',
    stripe_charge_id: 'ch_dry_run',
    ...overrides,
  };
}

function makeStripe({
  paymentIntents = { pi_dry_run: paymentIntent() },
  sessionsByPaymentIntent = { pi_dry_run: [checkoutSession()] },
} = {}) {
  const calls = [];
  return {
    paymentIntents: {
      retrieve: async (id, options) => {
        calls.push(['paymentIntents.retrieve', id, options]);
        return paymentIntents[id] || null;
      },
    },
    checkout: {
      sessions: {
        retrieve: async (id, options) => {
          calls.push(['checkout.sessions.retrieve', id, options]);
          const session = Object.values(sessionsByPaymentIntent)
            .flat()
            .find((row) => row.id === id);
          return session || null;
        },
        list: async (params) => {
          calls.push(['checkout.sessions.list', params]);
          return { data: sessionsByPaymentIntent[params.payment_intent] || [] };
        },
      },
    },
    charges: {
      retrieve: async (id, options) => {
        calls.push(['charges.retrieve', id, options]);
        return null;
      },
    },
    calls,
  };
}

function validStripe(overrides = {}) {
  return makeStripe({
    paymentIntents: { pi_dry_run: paymentIntent(overrides.paymentIntent) },
    sessionsByPaymentIntent: { pi_dry_run: [checkoutSession(overrides.checkoutSession)] },
  });
}

function makeSql(rows = []) {
  const calls = [];
  const sql = async (strings, ...values) => {
    const text = strings.join('?');
    calls.push({ text, values });
    if (/\b(INSERT|UPDATE|DELETE)\b/i.test(text)) {
      throw new Error(`mutation SQL is forbidden in dry-run tests: ${text}`);
    }
    return rows;
  };
  sql.calls = calls;
  return sql;
}

test.describe('admin credit-reconciliation dry-run endpoint', () => {
  test('authenticated non-dry-run requires a reason before Stripe or SQL', async () => {
    const sql = makeSql([]);
    const stripeClient = validStripe();

    const res = await callAdmin({
      body: { payment_intent_id: 'pi_dry_run' },
      sql,
      stripeClient,
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      error: true,
      code: 'INVALID_REASON',
      message: 'reason is required.',
    });
    expect(sql.calls).toHaveLength(0);
    expect(stripeClient.calls).toHaveLength(0);
  });

  test('unauthenticated dry-run returns 401 before Stripe or SQL', async () => {
    const sql = makeSql([]);
    const stripeClient = validStripe();

    const res = await callAdmin({
      headers: {},
      body: { dry_run: true, payment_intent_id: 'pi_dry_run' },
      sql,
      stripeClient,
    });

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Admin auth required' });
    expect(sql.calls).toHaveLength(0);
    expect(stripeClient.calls).toHaveLength(0);
  });

  test('invalid dry-run request returns the existing validation error', async () => {
    const sql = makeSql([]);
    const stripeClient = validStripe();

    const res = await callAdmin({
      body: { dry_run: true, reason: 'missing Stripe identity' },
      sql,
      stripeClient,
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      error: true,
      code: 'STRIPE_IDENTITY_REQUIRED',
      message: 'Provide a payment_intent_id, session_id, or charge_id.',
    });
    expect(sql.calls).toHaveLength(0);
    expect(stripeClient.calls).toHaveLength(0);
  });

  test('dry-run happy path returns a ready preview and performs no mutation SQL', async () => {
    const sql = makeSql([]);
    const stripeClient = validStripe();

    const res = await callAdmin({
      body: { mode: 'inspect', payment_intent_id: 'pi_dry_run', reason: 'webhook missed' },
      sql,
      stripeClient,
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      ready: true,
      noop: false,
      code: 'READY_TO_RECONCILE',
      inspection_only: true,
      credit_granted: false,
      grant_preview: {
        source: 'reconciliation',
        type: 'admin_add',
        learner_id: 10,
        instructor_id: 4,
        school_id: 1,
        minutes: 600,
        amount_pence: 33000,
        stripe_fee_pence: 514,
        stripe_payment_intent_id: 'pi_dry_run',
      },
    });
    expect(res.body.message).toContain('Inspection only:');
    expect(res.body.message).toContain('No credit was granted.');
    expect(sql.calls).toHaveLength(1);
    expect(sql.calls[0].text).toContain('FROM credit_transactions');
    expect(stripeClient.calls.map((call) => call[0])).toEqual([
      'paymentIntents.retrieve',
      'checkout.sessions.list',
    ]);
  });

  test('dry-run no-op existing transaction returns already reconciled result', async () => {
    const res = await callAdmin({
      body: { dry_run: true, payment_intent_id: 'pi_dry_run' },
      sql: makeSql([creditTransaction()]),
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      ready: false,
      noop: true,
      code: 'ALREADY_RECONCILED',
      transaction_id: 42,
      inspection_only: true,
      credit_granted: false,
    });
    expect(res.body.message).toContain('No credit was granted.');
  });

  test('dry-run identity conflict returns typed manual-review result', async () => {
    const res = await callAdmin({
      body: { dry_run: true, payment_intent_id: 'pi_dry_run' },
      sql: makeSql([
        creditTransaction({
          id: 42,
          stripe_session_id: 'cs_dry_run',
          stripe_payment_intent_id: null,
          stripe_charge_id: null,
        }),
        creditTransaction({
          id: 43,
          stripe_session_id: null,
          stripe_payment_intent_id: 'pi_dry_run',
          stripe_charge_id: 'ch_dry_run',
        }),
      ]),
    });

    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({
      ok: false,
      ready: false,
      manual_review: true,
      code: 'RECONCILIATION_IDENTITY_CONFLICT',
      conflict: true,
      inspection_only: true,
      credit_granted: false,
    });
    expect(res.body.matches).toHaveLength(2);
    expect(res.body).not.toHaveProperty('grant_preview');
  });

  test('dry-run Stripe reject returns typed manual-review result', async () => {
    const res = await callAdmin({
      body: { dry_run: true, payment_intent_id: 'pi_dry_run' },
      stripeClient: validStripe({ paymentIntent: { amount_refunded: 100 } }),
    });

    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({
      ok: false,
      ready: false,
      manual_review: true,
      code: 'PAYMENT_REFUNDED',
      inspection_only: true,
      credit_granted: false,
    });
    expect(res.body.message).toContain('No credit was granted.');
    expect(res.body).not.toHaveProperty('grant_preview');
  });
});
