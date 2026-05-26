// @ts-check
// Mocked Stripe lookup tests for future credit-reconciliation.
//
// These tests do not import the Stripe SDK, call live Stripe, touch Neon, run
// migrations, or mutate credit ledgers.

const { test, expect } = require('@playwright/test');
const {
  ReconciliationStripeLookupError,
  inspectReconciliationStripePayment,
} = require('../api/_admin-credit-reconciliation-stripe');
const {
  evaluateReconciliationStripeState,
} = require('../api/_admin-credit-contracts');

function paymentIntent(overrides = {}) {
  return {
    id: 'pi_mock',
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
      id: 'ch_mock',
      object: 'charge',
      disputed: false,
      balance_transaction: { id: 'txn_mock', fee: 514 },
    },
    ...overrides,
  };
}

function checkoutSession(overrides = {}) {
  return {
    id: 'cs_mock',
    object: 'checkout.session',
    payment_intent: 'pi_mock',
    metadata: { payment_type: 'credit_purchase' },
    ...overrides,
  };
}

function charge(overrides = {}) {
  return {
    id: 'ch_mock',
    object: 'charge',
    payment_intent: 'pi_mock',
    disputed: false,
    balance_transaction: { id: 'txn_mock', fee: 514 },
    ...overrides,
  };
}

function makeMockStripe({
  paymentIntents = {},
  sessions = {},
  charges = {},
  sessionsByPaymentIntent = {},
} = {}) {
  const calls = [];
  const stripe = {
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
          return sessions[id] || null;
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
  return stripe;
}

test.describe('admin credit-reconciliation Stripe inspection helper', () => {
  test('looks up by PaymentIntent id and discovers the Checkout Session', async () => {
    const stripe = makeMockStripe({
      paymentIntents: { pi_mock: paymentIntent() },
      sessionsByPaymentIntent: { pi_mock: [checkoutSession()] },
    });

    const result = await inspectReconciliationStripePayment({
      stripe,
      paymentIntentId: 'pi_mock',
    });

    expect(result).toMatchObject({
      paymentIntentId: 'pi_mock',
      sessionId: 'cs_mock',
      chargeId: 'ch_mock',
      stripePaymentIntentId: 'pi_mock',
      stripeSessionId: 'cs_mock',
      stripeChargeId: 'ch_mock',
      stripeFeePence: 514,
    });
    expect(stripe.calls.map((call) => call[0])).toEqual([
      'paymentIntents.retrieve',
      'checkout.sessions.list',
    ]);

    expect(evaluateReconciliationStripeState({
      paymentIntent: result.paymentIntent,
      checkoutSession: result.checkoutSession,
    })).toMatchObject({
      ok: true,
      input: {
        stripePaymentIntentId: 'pi_mock',
        stripeSessionId: 'cs_mock',
        stripeChargeId: 'ch_mock',
      },
    });
  });

  test('looks up by Checkout Session id and keeps PaymentIntent central', async () => {
    const stripe = makeMockStripe({
      sessions: { cs_mock: checkoutSession({ payment_intent: 'pi_mock' }) },
      paymentIntents: { pi_mock: paymentIntent() },
    });

    const result = await inspectReconciliationStripePayment({
      stripe,
      sessionId: 'cs_mock',
    });

    expect(result.paymentIntent.id).toBe('pi_mock');
    expect(result.checkoutSession.id).toBe('cs_mock');
    expect(result.chargeId).toBe('ch_mock');
    expect(stripe.calls.map((call) => call[0])).toEqual([
      'checkout.sessions.retrieve',
      'paymentIntents.retrieve',
    ]);
  });

  test('looks up by Charge id and discovers the Checkout Session', async () => {
    const stripe = makeMockStripe({
      charges: { ch_mock: charge({ payment_intent: 'pi_mock' }) },
      paymentIntents: { pi_mock: paymentIntent() },
      sessionsByPaymentIntent: { pi_mock: [checkoutSession()] },
    });

    const result = await inspectReconciliationStripePayment({
      stripe,
      chargeId: 'ch_mock',
    });

    expect(result.paymentIntentId).toBe('pi_mock');
    expect(result.sessionId).toBe('cs_mock');
    expect(result.chargeId).toBe('ch_mock');
    expect(result.stripeFeePence).toBe(514);
    expect(stripe.calls.map((call) => call[0])).toEqual([
      'charges.retrieve',
      'paymentIntents.retrieve',
      'checkout.sessions.list',
    ]);
  });

  test('retrieves latest_charge when the PaymentIntent only has a charge id', async () => {
    const stripe = makeMockStripe({
      paymentIntents: {
        pi_mock: paymentIntent({ latest_charge: 'ch_mock' }),
      },
      sessionsByPaymentIntent: { pi_mock: [checkoutSession()] },
      charges: { ch_mock: charge({ balance_transaction: { id: 'txn_mock', fee: 612 } }) },
    });

    const result = await inspectReconciliationStripePayment({
      stripe,
      paymentIntentId: 'pi_mock',
    });

    expect(result.chargeId).toBe('ch_mock');
    expect(result.stripeFeePence).toBe(612);
    expect(stripe.calls.map((call) => call[0])).toEqual([
      'paymentIntents.retrieve',
      'checkout.sessions.list',
      'charges.retrieve',
    ]);
  });

  test('falls back to paymentIntent.charges.data[0] for latest charge and fee', async () => {
    const stripe = makeMockStripe({
      paymentIntents: {
        pi_mock: paymentIntent({
          latest_charge: null,
          charges: {
            data: [
              charge({ id: 'ch_from_charges', balance_transaction: { id: 'txn_from_charges', fee: 321 } }),
            ],
          },
        }),
      },
      sessionsByPaymentIntent: { pi_mock: [checkoutSession()] },
    });

    const result = await inspectReconciliationStripePayment({
      stripe,
      paymentIntentId: 'pi_mock',
    });

    expect(result.chargeId).toBe('ch_from_charges');
    expect(result.stripeFeePence).toBe(321);
    expect(stripe.calls.map((call) => call[0])).toEqual([
      'paymentIntents.retrieve',
      'checkout.sessions.list',
    ]);
  });

  test('uses only the injected mocked Stripe client', async () => {
    const stripe = makeMockStripe({
      paymentIntents: { pi_mock: paymentIntent() },
      sessionsByPaymentIntent: { pi_mock: [checkoutSession()] },
    });

    await expect(inspectReconciliationStripePayment({
      stripe,
      paymentIntentId: 'pi_mock',
    })).resolves.toMatchObject({
      paymentIntentId: 'pi_mock',
      sessionId: 'cs_mock',
    });

    expect(stripe.calls.length).toBeGreaterThan(0);
  });

  test('throws a clear typed error when required Stripe objects cannot be resolved', async () => {
    const missingPiStripe = makeMockStripe();
    await expect(inspectReconciliationStripePayment({
      stripe: missingPiStripe,
      paymentIntentId: 'pi_missing',
    })).rejects.toMatchObject({
      name: 'ReconciliationStripeLookupError',
      code: 'PAYMENT_INTENT_NOT_FOUND',
      status: 409,
    });

    const missingSessionStripe = makeMockStripe({
      paymentIntents: { pi_mock: paymentIntent() },
      sessionsByPaymentIntent: { pi_mock: [] },
    });
    await expect(inspectReconciliationStripePayment({
      stripe: missingSessionStripe,
      paymentIntentId: 'pi_mock',
    })).rejects.toMatchObject({
      name: 'ReconciliationStripeLookupError',
      code: 'CHECKOUT_SESSION_NOT_FOUND',
    });

    await expect(inspectReconciliationStripePayment({ stripe: makeMockStripe() }))
      .rejects.toBeInstanceOf(ReconciliationStripeLookupError);
  });
});
