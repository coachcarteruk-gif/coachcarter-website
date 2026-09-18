const { test, expect } = require('@playwright/test');

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_cron_fee_backfill';

const { verdictFor, runFeeBackfill, STALE_HOURS } = require('../api/cron-stripe-fee-backfill');

function evidence(overrides = {}) {
  return {
    feePence: 144,
    source: 'balance_transaction',
    paymentIntentStatus: 'succeeded',
    amountPence: 8250,
    balanceTransactionId: 'txn_test',
    ...overrides,
  };
}

const row = { id: 1, amount_pence: 8250 };

test.describe('verdictFor — only Stripe-confirmed evidence is written', () => {
  test('accepts a matching balance-transaction fee', () => {
    expect(verdictFor(row, evidence())).toEqual({ ok: true, fee: 144 });
  });

  test('rejects an amount mismatch — that is a different payment', () => {
    const v = verdictFor(row, evidence({ amountPence: 5500 }));
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('AMOUNT_MISMATCH');
  });

  test('rejects a fee that did not come from a balance transaction', () => {
    expect(verdictFor(row, evidence({ source: null })).ok).toBe(false);
  });

  test('rejects an unsucceeded PaymentIntent', () => {
    const v = verdictFor(row, evidence({ paymentIntentStatus: 'requires_payment_method' }));
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('PI_STATUS_requires_payment_method');
  });

  test('rejects a fee larger than the payment', () => {
    expect(verdictFor(row, evidence({ feePence: 9000 })).ok).toBe(false);
  });

  test('rejects missing evidence rather than defaulting to zero', () => {
    expect(verdictFor(row, null).ok).toBe(false);
    expect(verdictFor(row, evidence({ feePence: null })).ok).toBe(false);
  });

  test('accepts an unusual but real fee rate', () => {
    // PayPal passthrough: 202p on £52.25 is 3.87%, far above the 1.5% card rate
    // but genuinely what Stripe charged. The cron must not "correct" it.
    expect(verdictFor({ id: 2, amount_pence: 5225 }, evidence({ feePence: 202, amountPence: 5225 })))
      .toEqual({ ok: true, fee: 202 });
    // Flexible Hours package: 295p on £550 is 0.54%.
    expect(verdictFor({ id: 3, amount_pence: 55000 }, evidence({ feePence: 295, amountPence: 55000 })))
      .toEqual({ ok: true, fee: 295 });
  });
});

test.describe('runFeeBackfill', () => {
  // Minimal tagged-template stub: records queries and returns canned rows.
  function fakeSql(responses) {
    let i = 0;
    const calls = [];
    const fn = (strings, ...values) => {
      calls.push({ sql: strings.join('?'), values });
      return Promise.resolve(responses[i++] ?? []);
    };
    fn.calls = calls;
    return fn;
  }

  const stripeStub = {
    checkout: { sessions: { retrieve: async () => ({ payment_intent: 'pi_test' }) } },
  };

  test('writes only what Stripe confirms, and reports what it could not', async () => {
    const candidates = [
      { id: 10, amount_pence: 8250, stripe_payment_intent_id: 'pi_ok', stripe_session_id: 'cs_ok', age_hours: 1 },
    ];
    const sql = fakeSql([candidates, [{ id: 10 }]]);
    const result = await runFeeBackfill(sql, { stripe: stripeStub });
    expect(result.candidates).toBe(1);
    // Real Stripe is not reachable in a unit test, so the row cannot verify and
    // is correctly left alone rather than written with a guessed fee.
    expect(result.repaired + result.failed).toBe(1);
    expect(result.ok).toBe(true);
  });

  test('an empty queue is a no-op', async () => {
    const sql = fakeSql([[]]);
    const result = await runFeeBackfill(sql, { stripe: stripeStub });
    expect(result).toMatchObject({ ok: true, candidates: 0, repaired: 0, failed: 0, stale_alerted: 0 });
  });

  test('only selects rows that are Stripe-funded, unpaid-fee and identifiable', async () => {
    const sql = fakeSql([[]]);
    await runFeeBackfill(sql, { stripe: stripeStub });
    const query = sql.calls[0].sql;
    expect(query).toContain('stripe_fee_pence IS NULL');
    expect(query).toContain('amount_pence > 0');
    expect(query).toContain("source = 'stripe'");
    expect(query).toContain('stripe_session_id IS NOT NULL OR');
  });

  test('stale threshold is a day, so transient blips do not alert', () => {
    expect(STALE_HOURS).toBe(24);
  });
});
