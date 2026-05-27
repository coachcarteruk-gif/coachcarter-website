// @ts-check
// Slice 2 per-instructor credit API contract tests.
//
// These tests mock Stripe and Neon. They pin API shape, metadata, and school
// scoping without requiring a live DB; the LCB mutation semantics remain
// covered by the dedicated integration tests.

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const path = require('path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'credits-instructor-api-test-secret';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_credits_instructor_api';
process.env.POSTGRES_URL = process.env.POSTGRES_URL || 'postgres://mock';

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

function learnerHeaders({ id = 10, schoolId = 1, email = 'learner@example.test', method = 'GET' } = {}) {
  const csrf = 'b'.repeat(64);
  const token = jwt.sign(
    { id, email, role: 'learner', school_id: schoolId },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
  const headers = { cookie: `cc_learner=${token}; cc_csrf=${csrf}` };
  if (method !== 'GET') headers['x-csrf-token'] = csrf;
  return headers;
}

async function call(handler, { method = 'GET', query = {}, body = {}, headers = {} } = {}) {
  const req = {
    method,
    query,
    body,
    headers,
    url: `/api/credits?action=${query.action || ''}`,
  };
  const res = makeRes();
  await handler(req, res);
  return res;
}

function withMockedModules({ sql, stripe, pricing, grantCredits, fetchSessionFeePence, createTransporter } = {}, load) {
  const repoRoot = path.resolve(__dirname, '..');
  const modulePaths = [
    '@neondatabase/serverless',
    'stripe',
    path.join(repoRoot, 'api', '_pricing-helpers.js'),
    path.join(repoRoot, 'api', '_credit-grant.js'),
    path.join(repoRoot, 'api', '_stripe-fee.js'),
    path.join(repoRoot, 'api', '_auth-helpers.js'),
    path.join(repoRoot, 'api', 'credits.js'),
    path.join(repoRoot, 'api', 'webhook.js'),
  ];
  for (const p of modulePaths) {
    try { delete require.cache[require.resolve(p)]; } catch (_) { /* ignore */ }
  }

  require.cache[require.resolve('@neondatabase/serverless')] = {
    exports: { neon: () => sql },
  };
  require.cache[require.resolve('stripe')] = {
    exports: () => stripe || { checkout: { sessions: { create: async () => ({ url: 'https://stripe.test/session' }) } } },
  };
  require.cache[require.resolve(path.join(repoRoot, 'api', '_pricing-helpers.js'))] = {
    exports: pricing || {
      MAX_HOURS_PER_PURCHASE: 36,
      getBulkPricing: async () => ({ hourlyPence: 5500, discountTiers: [], source: 'mock' }),
      calcBulkTotal: async (_sql, _schoolId, hours) => ({
        fullPence: Math.round(hours * 5500),
        discountPct: 0,
        discountAmt: 0,
        totalPence: Math.round(hours * 5500),
        pricePerHourPence: 5500,
      }),
    },
  };
  if (grantCredits) {
    require.cache[require.resolve(path.join(repoRoot, 'api', '_credit-grant.js'))] = {
      exports: {
        grantCredits,
        lockBalanceAdjustLCB: async () => ({ ok: true }),
      },
    };
  }
  if (fetchSessionFeePence) {
    require.cache[require.resolve(path.join(repoRoot, 'api', '_stripe-fee.js'))] = {
      exports: { fetchSessionFeePence },
    };
  }
  if (createTransporter) {
    require.cache[require.resolve(path.join(repoRoot, 'api', '_auth-helpers.js'))] = {
      exports: { createTransporter },
    };
  }

  return load();
}

function checkoutSql({ validInstructor = true } = {}) {
  return async (strings, ...values) => {
    const text = strings.join('?');
    if (text.includes('FROM instructors') && text.includes('active = true')) {
      return validInstructor ? [{ id: values[0], name: 'Fraser Carter' }] : [];
    }
    throw new Error(`Unexpected checkout SQL: ${text}`);
  };
}

function balanceSql({ selectedInstructorExists = true, selectedBalanceRows = [{ balance_minutes: 90 }] } = {}) {
  return async (strings) => {
    const text = strings.join('?');
    if (text.includes('SELECT lu.credit_balance')) {
      return [{ credit_balance: 2, balance_minutes: 150 }];
    }
    if (text.includes('SELECT id') && text.includes('FROM instructors')) {
      return selectedInstructorExists ? [{ id: 4 }] : [];
    }
    if (text.includes('SELECT COALESCE(balance_minutes, 0)::int AS balance_minutes')) {
      return selectedBalanceRows;
    }
    if (text.includes('SELECT lcb.instructor_id')) {
      return [
        { instructor_id: 4, instructor_name: 'Sarah Driver', balance_minutes: 90, instructor_active: true },
        { instructor_id: 7, instructor_name: 'Liam Driver', balance_minutes: 60, instructor_active: true },
      ];
    }
    if (text.includes('FROM credit_transactions')) {
      return [{ id: 99, type: 'purchase', minutes: 90, amount_pence: 8250, payment_method: 'card' }];
    }
    throw new Error(`Unexpected balance SQL: ${text}`);
  };
}

test.describe('instructor-aware credit checkout API', () => {
  test('checkout without instructor_id is rejected for normal learner purchase', async () => {
    const stripeCalls = [];
    const credits = withMockedModules({
      sql: checkoutSql(),
      stripe: { checkout: { sessions: { create: async (payload) => { stripeCalls.push(payload); return { url: 'unused' }; } } } },
    }, () => require('../api/credits'));

    const res = await call(credits, {
      method: 'POST',
      query: { action: 'checkout' },
      body: { hours: 1.5 },
      headers: learnerHeaders({ method: 'POST' }),
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ code: 'INSTRUCTOR_REQUIRED' });
    expect(stripeCalls).toHaveLength(0);
  });

  test('checkout with valid same-school active instructor includes instructor_id in Stripe metadata', async () => {
    const stripeCalls = [];
    const credits = withMockedModules({
      sql: checkoutSql({ validInstructor: true }),
      stripe: { checkout: { sessions: { create: async (payload) => { stripeCalls.push(payload); return { url: 'https://stripe.test/ok' }; } } } },
    }, () => require('../api/credits'));

    const res = await call(credits, {
      method: 'POST',
      query: { action: 'checkout' },
      body: { hours: 1.5, instructor_id: 4 },
      headers: learnerHeaders({ method: 'POST', schoolId: 2 }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ url: 'https://stripe.test/ok' });
    expect(stripeCalls).toHaveLength(1);
    expect(stripeCalls[0].metadata).toMatchObject({
      school_id: '2',
      instructor_id: '4',
      payment_type: 'credit_purchase',
    });
    expect(stripeCalls[0].cancel_url).toBe('https://coachcarter.uk/learner/buy-credits.html?cancelled=true&instructor_id=4');
  });

  test('checkout with cross-school or inactive instructor is rejected', async () => {
    const stripeCalls = [];
    const credits = withMockedModules({
      sql: checkoutSql({ validInstructor: false }),
      stripe: { checkout: { sessions: { create: async (payload) => { stripeCalls.push(payload); return { url: 'unused' }; } } } },
    }, () => require('../api/credits'));

    const res = await call(credits, {
      method: 'POST',
      query: { action: 'checkout' },
      body: { hours: 1.5, instructor_id: 999 },
      headers: learnerHeaders({ method: 'POST' }),
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ code: 'INVALID_INSTRUCTOR' });
    expect(stripeCalls).toHaveLength(0);
  });

  test('checkout resolver excludes hidden demo instructor using the public-list convention', async () => {
    const repoRoot = path.resolve(__dirname, '..');
    const creditsSource = fs.readFileSync(path.join(repoRoot, 'api', 'credits.js'), 'utf8').replace(/\r\n/g, '\n');

    expect(creditsSource).toContain("AND email != 'demo@coachcarter.uk'");
  });
});

test.describe('instructor-aware credit balance API', () => {
  test('balance returns aggregate fields plus per-instructor balances', async () => {
    const credits = withMockedModules({ sql: balanceSql() }, () => require('../api/credits'));

    const res = await call(credits, {
      method: 'GET',
      query: { action: 'balance' },
      headers: learnerHeaders(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      credit_balance: 2,
      balance_minutes: 150,
      balance_hours: '2.5',
    });
    expect(res.body.balances).toEqual([
      { instructor_id: 4, instructor_name: 'Sarah Driver', balance_minutes: 90, balance_hours: '1.5', instructor_active: true },
      { instructor_id: 7, instructor_name: 'Liam Driver', balance_minutes: 60, balance_hours: '1.0', instructor_active: true },
    ]);
  });

  test('balance with instructor_id returns selected instructor balance instead of aggregate credit', async () => {
    const credits = withMockedModules({ sql: balanceSql() }, () => require('../api/credits'));

    const res = await call(credits, {
      method: 'GET',
      query: { action: 'balance', instructor_id: '4' },
      headers: learnerHeaders(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.balance_minutes).toBe(150);
    expect(res.body.selected_instructor_id).toBe(4);
    expect(res.body.selected_instructor_balance_minutes).toBe(90);
    expect(res.body.selected_instructor_balance_hours).toBe('1.5');
  });

  test('balance with instructor_id returns zero when no selected LCB row exists', async () => {
    const credits = withMockedModules({ sql: balanceSql({ selectedBalanceRows: [] }) }, () => require('../api/credits'));

    const res = await call(credits, {
      method: 'GET',
      query: { action: 'balance', instructor_id: '4' },
      headers: learnerHeaders(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.balance_minutes).toBe(150);
    expect(res.body.selected_instructor_id).toBe(4);
    expect(res.body.selected_instructor_balance_minutes).toBe(0);
    expect(res.body.selected_instructor_balance_hours).toBe('0.0');
  });
});

test.describe('public lessons bulk checkout instructor context', () => {
  test('lessons.html bulk checkout sends the explicit legacy instructor context', () => {
    const repoRoot = path.resolve(__dirname, '..');
    const lessonsSource = fs.readFileSync(path.join(repoRoot, 'public', 'lessons.js'), 'utf8').replace(/\r\n/g, '\n');

    expect(lessonsSource).toContain('const LEGACY_MARKETING_INSTRUCTOR_ID = 1;');
    expect(lessonsSource).toContain('instructor_id: LEGACY_MARKETING_INSTRUCTOR_ID');
    expect(lessonsSource).toContain('legacy public marketing funnel is CoachCarter');
  });
});

test.describe('credit purchase webhook instructor metadata', () => {
  test('webhook grant path passes metadata instructor_id into grantCredits', async () => {
    const grantCalls = [];
    const webhook = withMockedModules({
      sql: async () => [],
      grantCredits: async (args) => {
        grantCalls.push(args);
        return { ok: true, alreadyProcessed: false };
      },
      fetchSessionFeePence: async () => ({ feePence: 123 }),
      createTransporter: () => ({ sendMail: async () => {} }),
    }, () => require('../api/webhook'));

    await webhook._handleCreditPurchase({
      id: 'cs_credit_metadata',
      payment_status: 'paid',
      payment_method_types: ['card'],
      payment_intent: 'pi_credit_metadata',
      metadata: {
        payment_type: 'credit_purchase',
        learner_id: '10',
        learner_email: 'learner@example.test',
        credits_purchased: '1',
        minutes_purchased: '90',
        amount_pence: '8250',
        school_id: '2',
        instructor_id: '4',
      },
    });

    expect(grantCalls).toHaveLength(1);
    expect(grantCalls[0]).toMatchObject({
      learnerId: 10,
      schoolId: 2,
      instructorId: 4,
      sessionId: 'cs_credit_metadata',
      paymentIntentId: 'pi_credit_metadata',
      stripeFeePence: 123,
      source: 'stripe',
    });
  });
});
