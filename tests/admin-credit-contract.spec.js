// @ts-check
// Step 5.5 admin credit endpoint contract tests.
//
// These are intentionally contract/unit tests: no Stripe live calls, no Neon
// integration DB, no migrations, no payout crons, and no credit mutations.

const { test, expect } = require('@playwright/test');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'admin-credit-contract-test-secret';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_admin_credit_contract';

const adminHandler = require('../api/admin');
const instructorHandler = require('../api/instructor');
const fs = require('fs');
const path = require('path');
const {
  GOODWILL_EXPECTED_WRITE_SHAPE,
  RECONCILIATION_EXPECTED_WRITE_SHAPE,
  RECONCILIATION_LOOKUP_IDENTITIES,
  SCOPED_LOOKUP_REJECT,
  validateGoodwillRequest,
  validateReconciliationRequest,
  evaluateReconciliationStripeState,
} = require('../api/_admin-credit-contracts');
const {
  grantGoodwillCredits,
} = require('../api/_admin-credit-goodwill');

const {
  _resolveAdjustCreditsTarget: resolveAdjustCreditsTarget,
  _buildScopedDurationCreditRefusal: buildAdminScopedDurationCreditRefusal,
} = adminHandler;
const {
  _buildScopedDurationCreditRefusal: buildInstructorScopedDurationCreditRefusal,
} = instructorHandler;

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

function csrfAuthedHeaders() {
  const csrf = 'a'.repeat(64);
  const token = jwt.sign(
    { id: 123, email: 'admin@example.test', role: 'admin', isAdmin: true, school_id: 1 },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
  return {
    cookie: `cc_admin=${token}; cc_csrf=${csrf}`,
    'x-csrf-token': csrf,
  };
}

async function callAdmin(action, { body = {}, headers = {}, method = 'POST' } = {}) {
  const req = {
    method,
    query: { action },
    body,
    headers,
    url: `/api/admin?action=${action}`,
  };
  const res = makeRes();
  await adminHandler(req, res);
  return res;
}

function validPaymentIntent(overrides = {}) {
  return {
    id: 'pi_contract',
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
    latest_charge: { id: 'ch_contract', disputed: false },
    ...overrides,
  };
}

test.describe('per-instructor credit safety slice', () => {
  test('admin adjust-credits with multiple LCB rows requires an explicit instructor', () => {
    const resolved = resolveAdjustCreditsTarget({
      learner: { balance_minutes: 180 },
      lcbRows: [
        { instructor_id: 1, balance_minutes: 120 },
        { instructor_id: 7, balance_minutes: 60 },
      ],
    });

    expect(resolved).toEqual({
      ok: false,
      code: 'AMBIGUOUS_INSTRUCTOR',
      status: 409,
      count: 2,
      instructorIds: [1, 7],
    });
  });

  test('admin adjust-credits explicit instructor uses that instructor scoped LCB balance', () => {
    const resolved = resolveAdjustCreditsTarget({
      learner: { balance_minutes: 240 },
      explicitInstructorId: 7,
      explicitLcbRow: { balance_minutes: 30 },
    });

    expect(resolved).toEqual({
      ok: true,
      targetInstructorId: 7,
      preCheckBalance: 30,
    });
  });

  test('admin and instructor edit-booking duration prechecks refuse cross-instructor credit', () => {
    expect(buildAdminScopedDurationCreditRefusal(30, 0))
      .toBe('Learner has insufficient balance (needs 30 more minutes, has 0)');
    expect(buildInstructorScopedDurationCreditRefusal(30, 0))
      .toBe('Learner has insufficient balance. Needs 30 more minutes but has 0.');
    expect(buildAdminScopedDurationCreditRefusal(30, 90)).toBeNull();
    expect(buildInstructorScopedDurationCreditRefusal(30, 90)).toBeNull();
  });

  test('LCB reads added in this safety slice are school scoped', () => {
    const repoRoot = path.resolve(__dirname, '..');
    const adminSource = fs.readFileSync(path.join(repoRoot, 'api', 'admin.js'), 'utf8');
    const instructorSource = fs.readFileSync(path.join(repoRoot, 'api', 'instructor.js'), 'utf8');
    const creditsSource = fs.readFileSync(path.join(repoRoot, 'api', 'credits.js'), 'utf8');
    const creditGrantSource = fs.readFileSync(path.join(repoRoot, 'api', '_credit-grant.js'), 'utf8');

    expect(adminSource).toContain('FROM learner_credit_balances\n         WHERE learner_id = ${learner_id}\n           AND school_id = ${schoolId}');
    expect(adminSource).toContain('AND instructor_id = ${explicitInstructorId}\n           AND school_id = ${schoolId}');
    expect(adminSource).toContain('AND instructor_id = ${booking.instructor_id}\n             AND school_id = ${schoolId}');
    expect(instructorSource).toContain('AND instructor_id = ${booking.instructor_id}\n             AND school_id = ${schoolId}');
    expect(creditsSource).toContain('WHERE lcb.learner_id = lu.id\n                  AND lcb.school_id = ${schoolId}');
    expect(creditGrantSource).toContain('WHERE learner_credit_balances.school_id = ${schoolId}');
    expect(creditGrantSource).toContain('AND school_id = ${schoolId}');
  });
});

test.describe('admin Step 5.5 credit endpoints', () => {
  for (const action of ['credit-goodwill', 'credit-reconciliation']) {
    test(`${action} requires admin auth before validation or writes`, async () => {
      const res = await callAdmin(action, {
        body: {
          learner_id: 999999,
          instructor_id: 888888,
          minutes: 60,
          absorbed_by: 'platform',
          payment_intent_id: 'pi_nonexistent',
        },
      });

      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({ error: 'Admin auth required' });
    });
  }

  test('credit-goodwill validates learner, instructor, school, minutes, and absorber scope', () => {
    expect(validateGoodwillRequest({
      learner_id: 10,
      instructor_id: 4,
      minutes: 90,
      absorbed_by: 'platform',
      reason: 'service recovery',
    }, { schoolId: 1 })).toMatchObject({
      ok: true,
      input: {
        learnerId: 10,
        instructorId: 4,
        schoolId: 1,
        minutes: 90,
        absorbedBy: 'platform',
      },
    });

    expect(validateGoodwillRequest({ learner_id: 10, instructor_id: 4, minutes: 0, absorbed_by: 'platform' }, { schoolId: 1 }))
      .toMatchObject({ ok: false, code: 'INVALID_MINUTES' });
    expect(validateGoodwillRequest({ learner_id: 10, instructor_id: 4, minutes: 60, absorbed_by: 'school' }, { schoolId: 1 }))
      .toMatchObject({ ok: false, code: 'INVALID_ABSORBED_BY' });
    expect(validateGoodwillRequest({ learner_id: 10, instructor_id: 4, minutes: 60, absorbed_by: 'platform' }, { schoolId: null }))
      .toMatchObject({ ok: false, code: 'SCHOOL_SCOPE_REQUIRED' });
    expect(validateGoodwillRequest({ learner_id: 10, instructor_id: 4, minutes: 60, absorbed_by: 'platform', reason: '   ' }, { schoolId: 1 }))
      .toMatchObject({ ok: false, code: 'INVALID_REASON' });
  });

  test('credit-goodwill grants through the shared credit mutation path and audit log', async () => {
    const calls = [];
    const sql = (strings, ...values) => {
      calls.push({ text: strings.join('?'), values });
      if (strings.join('?').includes('AS learner_ok')) {
        return Promise.resolve([{ learner_ok: true, instructor_ok: true }]);
      }
      return Promise.resolve([]);
    };
    const mutationCalls = [];
    const auditCalls = [];

    const result = await grantGoodwillCredits({
      sql,
      admin: { id: 123, email: 'admin@example.test' },
      schoolId: 1,
      input: {
        learnerId: 10,
        instructorId: 4,
        schoolId: 1,
        minutes: 90,
        absorbedBy: 'instructor',
        reason: 'agreed goodwill',
      },
      req: { headers: {} },
      rateGetter: async () => 92,
      mutateCredits: async (sqlArg, args) => {
        mutationCalls.push({ sqlArg, args });
        return { ok: true, transactionId: 55, balanceMinutes: 150, instructorId: args.instructorId };
      },
      auditLogger: async (sqlArg, args) => {
        auditCalls.push({ sqlArg, args });
      },
    });

    expect(result).toEqual({
      ok: true,
      credit_transaction: {
        id: 55,
        source: 'goodwill',
        type: 'admin_add',
        amount_pence: 0,
        stripe_fee_pence: 0,
        absorbed_by: 'instructor',
      },
      learner_balance: {
        learner_id: 10,
        instructor_id: 4,
        school_id: 1,
        balance_minutes: 150,
      },
      audit_action: 'admin.credit_goodwill_grant',
    });
    expect(calls[0].text).toContain('FROM learner_users');
    expect(calls[0].text).toContain('FROM instructors');
    expect(calls[0].values).toEqual([10, 1, 4, 1]);
    expect(mutationCalls).toHaveLength(1);
    expect(mutationCalls[0].args).toMatchObject({
      learnerId: 10,
      instructorId: 4,
      schoolId: 1,
      delta: 90,
      ledgerType: 'admin_add',
      amountPence: 0,
      stripeFeePence: 0,
      effectiveRatePencePerMinute: 92,
      source: 'goodwill',
      absorbedBy: 'instructor',
      allowOverdraft: false,
    });
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0].args).toMatchObject({
      adminId: 123,
      adminEmail: 'admin@example.test',
      action: 'admin.credit_goodwill_grant',
      targetType: 'learner',
      targetId: 10,
      schoolId: 1,
      details: {
        learner_id: 10,
        instructor_id: 4,
        minutes: 90,
        absorbed_by: 'instructor',
        reason: 'agreed goodwill',
        credit_transaction_id: 55,
        effective_rate_pence_per_minute: 92,
      },
    });
  });

  test('credit-goodwill refuses unscoped learner/instructor pairs without mutating or auditing', async () => {
    const sql = (strings) => {
      if (strings.join('?').includes('AS learner_ok')) {
        return Promise.resolve([{ learner_ok: false, instructor_ok: true }]);
      }
      return Promise.resolve([]);
    };
    let mutated = false;
    let audited = false;

    const result = await grantGoodwillCredits({
      sql,
      admin: { id: 123, email: 'admin@example.test' },
      schoolId: 1,
      input: {
        learnerId: 999999,
        instructorId: 4,
        schoolId: 1,
        minutes: 90,
        absorbedBy: 'platform',
        reason: 'service recovery',
      },
      mutateCredits: async () => { mutated = true; },
      auditLogger: async () => { audited = true; },
      rateGetter: async () => 92,
    });

    expect(result).toEqual({ ok: false, ...SCOPED_LOOKUP_REJECT });
    expect(mutated).toBe(false);
    expect(audited).toBe(false);
  });

  test('credit-goodwill pins the eventual ledger and audit shape', () => {
    expect(GOODWILL_EXPECTED_WRITE_SHAPE).toEqual({
      creditTransaction: {
        source: 'goodwill',
        type: 'admin_add',
        amount_pence: 0,
        stripe_fee_pence: 0,
        absorbed_by: 'copied_from_request',
      },
      auditAction: 'admin.credit_goodwill_grant',
    });
  });

  test('eventual scoped lookup failures use a generic non-enumerating contract', () => {
    expect(SCOPED_LOOKUP_REJECT).toEqual({
      status: 404,
      code: 'CREDIT_SCOPE_NOT_AVAILABLE',
      message: 'Credit action could not be applied for the requested scope.',
    });
    expect(SCOPED_LOOKUP_REJECT.message).not.toMatch(/learner not found|instructor not found|account exists/i);
  });

  test('credit-reconciliation accepts any Stripe identity and records all lookup keys', () => {
    expect(RECONCILIATION_LOOKUP_IDENTITIES).toEqual([
      'stripe_session_id',
      'stripe_payment_intent_id',
      'stripe_charge_id',
    ]);

    expect(validateReconciliationRequest({ payment_intent_id: 'pi_123' }, { schoolId: 1 }))
      .toMatchObject({ ok: true, input: { paymentIntentId: 'pi_123' } });
    expect(validateReconciliationRequest({ session_id: 'cs_123' }, { schoolId: 1 }))
      .toMatchObject({ ok: true, input: { sessionId: 'cs_123' } });
    expect(validateReconciliationRequest({ charge_id: 'ch_123' }, { schoolId: 1 }))
      .toMatchObject({ ok: true, input: { chargeId: 'ch_123' } });
    expect(validateReconciliationRequest({}, { schoolId: 1 }))
      .toMatchObject({ ok: false, code: 'STRIPE_IDENTITY_REQUIRED' });
  });

  test('credit-reconciliation mutating requests require a reason before inspection or writes', async () => {
    const res = await callAdmin('credit-reconciliation', {
      headers: csrfAuthedHeaders(),
      body: { payment_intent_id: 'pi_contract' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      error: true,
      code: 'INVALID_REASON',
      message: 'reason is required.',
    });
  });

  test('credit-reconciliation no-ops when any existing credit transaction is found', () => {
    const result = evaluateReconciliationStripeState({
      existingCreditTransaction: {
        id: 42,
        source: 'stripe',
        created_at: '2026-05-25T10:00:00.000Z',
      },
      paymentIntent: validPaymentIntent(),
      checkoutSession: { id: 'cs_contract', metadata: { payment_type: 'credit_purchase' } },
    });

    expect(result).toMatchObject({
      ok: true,
      noop: true,
      code: 'ALREADY_RECONCILED',
      transactionId: 42,
    });
  });

  test('credit-reconciliation rejects refunded, disputed, mismatched, malformed, and wrong-type payments', () => {
    const baseSession = { id: 'cs_contract', metadata: { payment_type: 'credit_purchase' } };

    expect(evaluateReconciliationStripeState({
      paymentIntent: validPaymentIntent({ amount_refunded: 100 }),
      checkoutSession: baseSession,
    })).toMatchObject({ ok: false, code: 'PAYMENT_REFUNDED' });

    expect(evaluateReconciliationStripeState({
      paymentIntent: validPaymentIntent({
        amount_refunded: undefined,
        latest_charge: { id: 'ch_contract', amount_refunded: 100, disputed: false },
      }),
      checkoutSession: baseSession,
    })).toMatchObject({ ok: false, code: 'PAYMENT_REFUNDED' });

    expect(evaluateReconciliationStripeState({
      paymentIntent: validPaymentIntent({ latest_charge: { id: 'ch_contract', disputed: true } }),
      checkoutSession: baseSession,
    })).toMatchObject({ ok: false, code: 'PAYMENT_DISPUTED' });

    expect(evaluateReconciliationStripeState({
      paymentIntent: validPaymentIntent({ amount_received: 32999 }),
      checkoutSession: baseSession,
    })).toMatchObject({ ok: false, code: 'AMOUNT_MISMATCH' });

    expect(evaluateReconciliationStripeState({
      paymentIntent: validPaymentIntent({ metadata: { payment_type: 'credit_purchase' } }),
      checkoutSession: baseSession,
    })).toMatchObject({ ok: false, code: 'MISSING_METADATA' });

    expect(evaluateReconciliationStripeState({
      paymentIntent: validPaymentIntent(),
      checkoutSession: null,
    })).toMatchObject({ ok: false, code: 'MISSING_CHECKOUT_SESSION' });

    expect(evaluateReconciliationStripeState({
      paymentIntent: validPaymentIntent({ metadata: { ...validPaymentIntent().metadata, payment_type: 'slot_purchase' } }),
      checkoutSession: { id: 'cs_contract', metadata: {} },
    })).toMatchObject({ ok: false, code: 'WRONG_PAYMENT_TYPE' });
  });

  test('credit-reconciliation pins the eventual ledger and audit shape', () => {
    expect(RECONCILIATION_EXPECTED_WRITE_SHAPE).toEqual({
      creditTransaction: {
        source: 'reconciliation',
        absorbed_by: null,
        stripe_session_id: 'required_from_checkout_session',
        stripe_payment_intent_id: 'required_from_payment_intent',
        stripe_charge_id: 'required_from_latest_charge',
      },
      auditAction: 'admin.credit_reconciliation',
    });
  });
});
