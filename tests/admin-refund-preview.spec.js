// @ts-check
// Mocked admin endpoint tests for read-only refund preview.

const { test, expect } = require('@playwright/test');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'admin-refund-preview-test-secret';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_admin_refund_preview';

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
  const csrf = 'c'.repeat(64);
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

function makeSql(rows = []) {
  const calls = [];
  const sql = async (strings, ...values) => {
    const text = strings.join('?');
    calls.push({ text, values });
    if (/\b(INSERT|UPDATE|DELETE)\b/i.test(text)) {
      throw new Error(`mutation SQL is forbidden in refund-preview tests: ${text}`);
    }
    return rows;
  };
  sql.calls = calls;
  return sql;
}

function makeStripe() {
  const calls = [];
  return {
    refunds: {
      create: async (...args) => {
        calls.push(['refunds.create', ...args]);
        throw new Error('stripe.refunds.create must not be called by refund-preview');
      },
    },
    paymentIntents: {
      retrieve: async (...args) => {
        calls.push(['paymentIntents.retrieve', ...args]);
        return null;
      },
    },
    charges: {
      retrieve: async (...args) => {
        calls.push(['charges.retrieve', ...args]);
        return null;
      },
    },
    calls,
  };
}

async function callAdmin({ body, sql = makeSql([]), stripeClient = makeStripe(), headers = csrfAuthedHeaders() } = {}) {
  const req = {
    method: 'POST',
    query: { action: 'refund-preview' },
    body,
    headers,
    url: '/api/admin?action=refund-preview',
    sql,
    stripeClient,
  };
  const res = makeRes();
  await adminHandler(req, res);
  return res;
}

test.describe('admin refund-preview endpoint', () => {
  test('returns itemised read-only preview and does not call Stripe refunds', async () => {
    const sql = makeSql([{
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
    }]);
    const stripeClient = makeStripe();

    const res = await callAdmin({
      body: {
        refund_type: 'credit_purchase',
        credit_transaction_id: 101,
        reason: 'approved unused credit refund',
      },
      sql,
      stripeClient,
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      blocked: false,
      manual_review_required: false,
      refund_type: 'credit_purchase',
      gross_refund_pence: 8250,
      processing_fee_withheld_pence: 144,
      net_refund_pence: 8106,
    });
    expect(res.body.admin_display_copy).toContain('Refund summary:');
    expect(res.body.admin_display_copy).toContain('Payment processing fee: -£1.44');
    expect(sql.calls).toHaveLength(1);
    expect(sql.calls[0].text).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
    expect(stripeClient.calls.map((call) => call[0])).not.toContain('refunds.create');
  });

  test('unauthenticated request returns 401 before SQL or Stripe', async () => {
    const sql = makeSql([]);
    const stripeClient = makeStripe();

    const res = await callAdmin({
      headers: {},
      body: { refund_type: 'credit_purchase', credit_transaction_id: 101 },
      sql,
      stripeClient,
    });

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Admin auth required' });
    expect(sql.calls).toHaveLength(0);
    expect(stripeClient.calls).toHaveLength(0);
  });
});
