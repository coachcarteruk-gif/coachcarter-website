// @ts-check
// Mocked inspection-orchestrator tests for future credit-reconciliation.
//
// These tests use mocked Stripe and mocked SQL only. They do not touch Neon,
// migrations, payout crons, live Stripe, Stripe mutations, or credit writers.

const { test, expect } = require('@playwright/test');
const {
  inspectCreditReconciliation,
} = require('../api/_admin-credit-reconciliation');

function paymentIntent(overrides = {}) {
  return {
    id: 'pi_inspect',
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
      id: 'ch_inspect',
      object: 'charge',
      disputed: false,
      balance_transaction: { id: 'txn_inspect', fee: 514 },
    },
    ...overrides,
  };
}

function checkoutSession(overrides = {}) {
  return {
    id: 'cs_inspect',
    object: 'checkout.session',
    payment_intent: 'pi_inspect',
    metadata: { payment_type: 'credit_purchase' },
    ...overrides,
  };
}

function makeMockStripe({
  paymentIntents = {},
  sessionsByPaymentIntent = {},
  charges = {},
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
        return charges[id] || null;
      },
    },
    calls,
  };
}

function creditTransaction(overrides = {}) {
  return {
    id: 42,
    source: 'stripe',
    created_at: '2026-05-25T10:00:00.000Z',
    school_id: 1,
    stripe_session_id: 'cs_inspect',
    stripe_payment_intent_id: 'pi_inspect',
    stripe_charge_id: 'ch_inspect',
    ...overrides,
  };
}

function makeSql(rows = []) {
  const calls = [];
  const sql = async (strings, ...values) => {
    calls.push({ text: strings.join('?'), values });
    return rows;
  };
  sql.calls = calls;
  return sql;
}

function validStripe(overrides = {}) {
  return makeMockStripe({
    paymentIntents: { pi_inspect: paymentIntent(overrides.paymentIntent) },
    sessionsByPaymentIntent: { pi_inspect: [checkoutSession(overrides.checkoutSession)] },
  });
}

async function inspect({ stripe = validStripe(), sql = makeSql([]), input = null } = {}) {
  return inspectCreditReconciliation({
    sql,
    stripe,
    schoolId: 1,
    input: input || {
      schoolId: 1,
      paymentIntentId: 'pi_inspect',
      sessionId: '',
      chargeId: '',
      reason: 'webhook missed',
    },
  });
}

test.describe('admin credit-reconciliation inspection orchestrator', () => {
  test('happy path returns a ready grant preview with Stripe identities and fee', async () => {
    const sql = makeSql([]);
    const stripe = validStripe();

    const result = await inspect({ stripe, sql });

    expect(result).toEqual({
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
        school_id: 1,
        minutes: 600,
        effective_rate_pence_per_minute: 55,
        amount_pence: 33000,
        stripe_fee_pence: 514,
        absorbed_by: null,
        stripe_session_id: 'cs_inspect',
        stripe_payment_intent_id: 'pi_inspect',
        stripe_charge_id: 'ch_inspect',
      },
      stripe: {
        session_id: 'cs_inspect',
        payment_intent_id: 'pi_inspect',
        charge_id: 'ch_inspect',
      },
    });

    expect(sql.calls).toHaveLength(1);
    expect(sql.calls[0].text).toContain('FROM credit_transactions');
    expect(sql.calls[0].values).toEqual([
      1,
      'cs_inspect',
      'cs_inspect',
      'pi_inspect',
      'pi_inspect',
      'ch_inspect',
      'ch_inspect',
    ]);
    expect(stripe.calls.map((call) => call[0])).toEqual([
      'paymentIntents.retrieve',
      'checkout.sessions.list',
    ]);
  });

  test('existing credit transaction returns a no-op already reconciled result', async () => {
    const result = await inspect({ sql: makeSql([creditTransaction()]) });

    expect(result).toEqual({
      ok: true,
      ready: false,
      noop: true,
      status: 200,
      code: 'ALREADY_RECONCILED',
      message: 'Payment is already reconciled; no credit mutation is needed.',
      transaction_id: 42,
      created_at: '2026-05-25T10:00:00.000Z',
      existing_credit_transaction: creditTransaction(),
    });
  });

  test('identity conflict returns manual-review conflict and is not ready', async () => {
    const result = await inspect({
      sql: makeSql([
        creditTransaction({
          id: 42,
          stripe_session_id: 'cs_inspect',
          stripe_payment_intent_id: null,
          stripe_charge_id: null,
        }),
        creditTransaction({
          id: 43,
          stripe_session_id: null,
          stripe_payment_intent_id: 'pi_inspect',
          stripe_charge_id: 'ch_inspect',
        }),
      ]),
    });

    expect(result).toMatchObject({
      ok: false,
      ready: false,
      manual_review: true,
      status: 409,
      code: 'RECONCILIATION_IDENTITY_CONFLICT',
      conflict: true,
    });
    expect(result.matches).toHaveLength(2);
    expect(result).not.toHaveProperty('grant_preview');
  });

  test('Stripe lookup failure returns a typed manual-review reject without SQL lookup', async () => {
    const sql = makeSql([]);

    const result = await inspect({
      stripe: makeMockStripe(),
      sql,
      input: {
        schoolId: 1,
        paymentIntentId: 'pi_missing',
        sessionId: '',
        chargeId: '',
      },
    });

    expect(result).toEqual({
      ok: false,
      ready: false,
      manual_review: true,
      status: 409,
      code: 'PAYMENT_INTENT_NOT_FOUND',
      message: 'PaymentIntent could not be resolved.',
    });
    expect(sql.calls).toHaveLength(0);
  });

  test('refunded, disputed, wrong-type, and missing-metadata evaluator rejects are surfaced', async () => {
    const cases = [
      {
        name: 'refunded',
        paymentIntent: { amount_refunded: 100 },
        expected: { status: 409, code: 'PAYMENT_REFUNDED' },
      },
      {
        name: 'latest-charge-refunded',
        paymentIntent: {
          amount_refunded: undefined,
          latest_charge: {
            id: 'ch_inspect',
            amount_refunded: 100,
            disputed: false,
            balance_transaction: { id: 'txn_inspect', fee: 514 },
          },
        },
        expected: { status: 409, code: 'PAYMENT_REFUNDED' },
      },
      {
        name: 'disputed',
        paymentIntent: {
          latest_charge: {
            id: 'ch_inspect',
            disputed: true,
            balance_transaction: { id: 'txn_inspect', fee: 514 },
          },
        },
        expected: { status: 409, code: 'PAYMENT_DISPUTED' },
      },
      {
        name: 'wrong-type',
        paymentIntent: {
          metadata: {
            ...paymentIntent().metadata,
            payment_type: 'slot_purchase',
          },
        },
        checkoutSession: { metadata: {} },
        expected: { status: 409, code: 'WRONG_PAYMENT_TYPE' },
      },
      {
        name: 'missing-metadata',
        paymentIntent: { metadata: { payment_type: 'credit_purchase' } },
        expected: { status: 409, code: 'MISSING_METADATA' },
      },
    ];

    for (const item of cases) {
      const result = await inspect({
        stripe: validStripe({
          paymentIntent: item.paymentIntent,
          checkoutSession: item.checkoutSession,
        }),
      });

      expect(result, item.name).toMatchObject({
        ok: false,
        ready: false,
        manual_review: true,
        ...item.expected,
      });
      expect(result, item.name).not.toHaveProperty('grant_preview');
    }
  });

  test('resolved latest charge refund rejects even when PaymentIntent refund field is absent', async () => {
    const result = await inspect({
      stripe: makeMockStripe({
        paymentIntents: {
          pi_inspect: paymentIntent({
            amount_refunded: undefined,
            latest_charge: 'ch_inspect',
          }),
        },
        sessionsByPaymentIntent: { pi_inspect: [checkoutSession()] },
        charges: {
          ch_inspect: {
            id: 'ch_inspect',
            object: 'charge',
            amount_refunded: 100,
            disputed: false,
            balance_transaction: { id: 'txn_inspect', fee: 514 },
          },
        },
      }),
    });

    expect(result).toMatchObject({
      ok: false,
      ready: false,
      manual_review: true,
      status: 409,
      code: 'PAYMENT_REFUNDED',
    });
    expect(result).not.toHaveProperty('grant_preview');
  });
});
