// @ts-check
// Mocked backend writer tests for admin credit-reconciliation.
//
// No live Stripe, no Neon, no migrations, no payout crons, no Stripe
// mutations, and no UI apply/grant path.

const { test, expect } = require('@playwright/test');
const jwt = require('jsonwebtoken');
const adminHandler = require('../api/admin');
const {
  grantReconciliationCredits,
} = require('../api/_admin-credit-reconciliation');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'admin-credit-reconciliation-writer-test-secret';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_admin_credit_writer';

function readyPreview(overrides = {}) {
  return {
    ok: true,
    ready: true,
    noop: false,
    status: 200,
    code: 'READY_TO_RECONCILE',
    message: 'Payment is ready for a reconciliation credit grant preview.',
    grant_preview: {
      source: 'reconciliation',
      type: 'admin_add',
      learner_id: 10,
      instructor_id: 4,
      school_id: overrides.schoolId || 1,
      minutes: 600,
      effective_rate_pence_per_minute: 55,
      amount_pence: 33000,
      stripe_fee_pence: 514,
      absorbed_by: null,
      stripe_session_id: 'cs_writer',
      stripe_payment_intent_id: 'pi_writer',
      stripe_charge_id: 'ch_writer',
      ...(overrides.grant_preview || {}),
    },
    stripe: {
      session_id: 'cs_writer',
      payment_intent_id: 'pi_writer',
      charge_id: 'ch_writer',
    },
  };
}

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

function makeMutationHarness({
  inspectionResults = [readyPreview()],
  mutateImpl = async (sqlArg, args) => ({ ok: true, transactionId: 77, balanceMinutes: 660, instructorId: args.instructorId }),
} = {}) {
  const inspectCalls = [];
  const mutateCalls = [];
  const auditCalls = [];
  const sql = { mocked: true };
  let inspectionIndex = 0;

  return {
    sql,
    inspectCalls,
    mutateCalls,
    auditCalls,
    inspect: async (args) => {
      inspectCalls.push(args);
      const result = inspectionResults[Math.min(inspectionIndex, inspectionResults.length - 1)];
      inspectionIndex += 1;
      return result;
    },
    mutateCredits: async (sqlArg, args) => {
      mutateCalls.push({ sqlArg, args });
      return mutateImpl(sqlArg, args);
    },
    auditLogger: async (sqlArg, args) => {
      auditCalls.push({ sqlArg, args });
    },
  };
}

function paymentIntent(overrides = {}) {
  return {
    id: 'pi_dry_writer',
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
      id: 'ch_dry_writer',
      object: 'charge',
      disputed: false,
      balance_transaction: { id: 'txn_dry_writer', fee: 514 },
    },
    ...overrides,
  };
}

function checkoutSession() {
  return {
    id: 'cs_dry_writer',
    object: 'checkout.session',
    payment_intent: 'pi_dry_writer',
    metadata: { payment_type: 'credit_purchase' },
  };
}

function makeDryRunSql(rows = []) {
  const calls = [];
  const sql = async (strings, ...values) => {
    const text = strings.join('?');
    calls.push({ text, values });
    if (/\b(INSERT|UPDATE|DELETE)\b/i.test(text)) {
      throw new Error(`mutation SQL is forbidden in dry-run test: ${text}`);
    }
    return rows;
  };
  sql.calls = calls;
  return sql;
}

function validStripe() {
  const calls = [];
  return {
    paymentIntents: {
      retrieve: async (id, options) => {
        calls.push(['paymentIntents.retrieve', id, options]);
        return paymentIntent();
      },
    },
    checkout: {
      sessions: {
        list: async (params) => {
          calls.push(['checkout.sessions.list', params]);
          return { data: [checkoutSession()] };
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

test.describe('admin credit-reconciliation backend writer', () => {
  test('non-dry-run ready preview creates the expected ledger, balance, and audit payload', async () => {
    const harness = makeMutationHarness();

    const result = await grantReconciliationCredits({
      sql: harness.sql,
      stripe: { mocked: true },
      admin: { id: 123, email: 'admin@example.test' },
      schoolId: 1,
      input: {
        schoolId: 1,
        paymentIntentId: 'pi_writer',
        sessionId: '',
        chargeId: '',
        reason: '  webhook missed  ',
      },
      req: { headers: {} },
      inspect: harness.inspect,
      mutateCredits: harness.mutateCredits,
      auditLogger: harness.auditLogger,
    });

    expect(result).toEqual({
      ok: true,
      ready: false,
      noop: false,
      credit_granted: true,
      credit_transaction: {
        id: 77,
        source: 'reconciliation',
        type: 'admin_add',
        amount_pence: 33000,
        stripe_fee_pence: 514,
        absorbed_by: null,
        stripe_session_id: 'cs_writer',
        stripe_payment_intent_id: 'pi_writer',
        stripe_charge_id: 'ch_writer',
      },
      learner_balance: {
        learner_id: 10,
        instructor_id: 4,
        school_id: 1,
        balance_minutes: 660,
      },
      audit_action: 'admin.credit_reconciliation',
    });
    expect(harness.mutateCalls).toHaveLength(1);
    expect(harness.mutateCalls[0].args).toEqual({
      learnerId: 10,
      instructorId: 4,
      schoolId: 1,
      delta: 600,
      creditsDelta: 10,
      ledgerType: 'admin_add',
      reason: 'webhook missed',
      amountPence: 33000,
      stripeFeePence: 514,
      effectiveRatePencePerMinute: 55,
      source: 'reconciliation',
      absorbedBy: null,
      stripeSessionId: 'cs_writer',
      stripePaymentIntentId: 'pi_writer',
      stripeChargeId: 'ch_writer',
      allowOverdraft: false,
    });
    expect(harness.auditCalls).toHaveLength(1);
    expect(harness.auditCalls[0].args).toMatchObject({
      adminId: 123,
      adminEmail: 'admin@example.test',
      action: 'admin.credit_reconciliation',
      targetType: 'learner',
      targetId: 10,
      schoolId: 1,
      details: {
        learner_id: 10,
        instructor_id: 4,
        school_id: 1,
        minutes: 600,
        credits_delta: 10,
        reason: 'webhook missed',
        amount_pence: 33000,
        stripe_fee_pence: 514,
        effective_rate_pence_per_minute: 55,
        source: 'reconciliation',
        absorbed_by: null,
        stripe_session_id: 'cs_writer',
        stripe_payment_intent_id: 'pi_writer',
        stripe_charge_id: 'ch_writer',
        credit_transaction_id: 77,
      },
    });
  });

  test('missing reason is rejected at the endpoint before SQL or Stripe mutation setup', async () => {
    const sql = makeDryRunSql([]);
    const stripeClient = validStripe();
    const req = {
      method: 'POST',
      query: { action: 'credit-reconciliation' },
      body: { payment_intent_id: 'pi_writer' },
      headers: csrfAuthedHeaders(),
      url: '/api/admin?action=credit-reconciliation',
      sql,
      stripeClient,
    };
    const res = makeRes();

    await adminHandler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      error: true,
      code: 'INVALID_REASON',
      message: 'reason is required.',
    });
    expect(sql.calls).toHaveLength(0);
    expect(stripeClient.calls).toHaveLength(0);
  });

  test('no-op preview does not mutate or audit', async () => {
    const harness = makeMutationHarness({
      inspectionResults: [{
        ok: true,
        ready: false,
        noop: true,
        status: 200,
        code: 'ALREADY_RECONCILED',
        transaction_id: 42,
      }],
    });

    const result = await grantReconciliationCredits({
      sql: harness.sql,
      stripe: {},
      admin: { id: 123, email: 'admin@example.test' },
      schoolId: 1,
      input: { schoolId: 1, paymentIntentId: 'pi_writer', reason: 'already handled' },
      inspect: harness.inspect,
      mutateCredits: harness.mutateCredits,
      auditLogger: harness.auditLogger,
    });

    expect(result).toMatchObject({
      ok: true,
      ready: false,
      noop: true,
      code: 'ALREADY_RECONCILED',
      credit_granted: false,
    });
    expect(harness.mutateCalls).toHaveLength(0);
    expect(harness.auditCalls).toHaveLength(0);
  });

  test('manual-review, conflict, and reject previews do not mutate', async () => {
    const cases = [
      { ok: false, ready: false, manual_review: true, status: 409, code: 'PAYMENT_REFUNDED' },
      { ok: false, ready: false, manual_review: true, conflict: true, status: 409, code: 'RECONCILIATION_IDENTITY_CONFLICT' },
      { ok: false, ready: false, manual_review: true, status: 409, code: 'WRONG_PAYMENT_TYPE' },
    ];

    for (const inspection of cases) {
      const harness = makeMutationHarness({ inspectionResults: [inspection] });
      const result = await grantReconciliationCredits({
        sql: harness.sql,
        stripe: {},
        admin: { id: 123, email: 'admin@example.test' },
        schoolId: 1,
        input: { schoolId: 1, paymentIntentId: 'pi_writer', reason: 'manual check' },
        inspect: harness.inspect,
        mutateCredits: harness.mutateCredits,
        auditLogger: harness.auditLogger,
      });

      expect(result).toMatchObject({
        ready: false,
        credit_granted: false,
        code: inspection.code,
      });
      expect(harness.mutateCalls).toHaveLength(0);
      expect(harness.auditCalls).toHaveLength(0);
    }
  });

  test('duplicate Stripe identity unique-race cannot double-grant', async () => {
    const duplicate = new Error('duplicate key value violates unique constraint "uq_credit_tx_payment_intent"');
    duplicate.code = '23505';
    const harness = makeMutationHarness({
      inspectionResults: [
        readyPreview(),
        {
          ok: true,
          ready: false,
          noop: true,
          status: 200,
          code: 'ALREADY_RECONCILED',
          transaction_id: 88,
        },
      ],
      mutateImpl: async () => { throw duplicate; },
    });

    const result = await grantReconciliationCredits({
      sql: harness.sql,
      stripe: {},
      admin: { id: 123, email: 'admin@example.test' },
      schoolId: 1,
      input: { schoolId: 1, paymentIntentId: 'pi_writer', reason: 'race test' },
      inspect: harness.inspect,
      mutateCredits: harness.mutateCredits,
      auditLogger: harness.auditLogger,
    });

    expect(result).toMatchObject({
      ok: true,
      ready: false,
      noop: true,
      code: 'ALREADY_RECONCILED',
      credit_granted: false,
      duplicate_race: true,
    });
    expect(harness.inspectCalls).toHaveLength(2);
    expect(harness.mutateCalls).toHaveLength(1);
    expect(harness.auditCalls).toHaveLength(0);
  });

  test('school scoping is preserved for inspection and mutation', async () => {
    const harness = makeMutationHarness({
      inspectionResults: [readyPreview({ schoolId: 7, grant_preview: { school_id: 7 } })],
    });

    const result = await grantReconciliationCredits({
      sql: harness.sql,
      stripe: {},
      admin: { id: 123, email: 'admin@example.test' },
      schoolId: 7,
      input: { schoolId: 7, paymentIntentId: 'pi_writer', reason: 'school scoped' },
      inspect: harness.inspect,
      mutateCredits: harness.mutateCredits,
      auditLogger: harness.auditLogger,
    });

    expect(result.ok).toBe(true);
    expect(harness.inspectCalls[0].schoolId).toBe(7);
    expect(harness.mutateCalls[0].args.schoolId).toBe(7);
    expect(harness.auditCalls[0].args.schoolId).toBe(7);
  });

  test('dry-run remains inspection-only with credit_granted false', async () => {
    const sql = makeDryRunSql([]);
    const stripeClient = validStripe();
    const req = {
      method: 'POST',
      query: { action: 'credit-reconciliation' },
      body: { dry_run: true, payment_intent_id: 'pi_dry_writer', reason: 'inspect only' },
      headers: csrfAuthedHeaders(),
      url: '/api/admin?action=credit-reconciliation',
      sql,
      stripeClient,
    };
    const res = makeRes();

    await adminHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      ready: true,
      inspection_only: true,
      credit_granted: false,
      code: 'READY_TO_RECONCILE',
    });
    expect(sql.calls).toHaveLength(1);
    expect(sql.calls[0].text).toContain('FROM credit_transactions');
    expect(sql.calls[0].text).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
  });
});
