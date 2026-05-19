const { test, expect } = require('@playwright/test');
const {
  grantCredits,
  grantCreditsPre2A,
  normalizeGrantArgs,
  _resetPhaseDetectionForTests,
} = require('../api/_credit-grant');

function makeSql(responses, calls = []) {
  return async function sql(strings, ...values) {
    const text = strings.join('?');
    calls.push({ text, values });
    const next = responses.shift();
    return typeof next === 'function' ? next({ text, values }) : next;
  };
}

const baseGrant = {
  learnerId: 12,
  schoolId: 1,
  credits: 4,
  minutes: 360,
  amountPence: 19800,
  paymentMethod: 'card',
  sessionId: 'cs_test_atomic',
  stripeFeePence: 610,
};

test.describe('grantCreditsPre2A', () => {
  test('uses one statement for ledger insert plus balance increment', async () => {
    const calls = [];
    const sql = makeSql([[
      {
        credit_balance: 9,
        balance_minutes: 810,
        transaction_id: 42,
        already_processed: false,
      },
    ]], calls);

    const result = await grantCreditsPre2A({ ...baseGrant, sql });

    expect(result).toMatchObject({
      ok: true,
      completed: true,
      alreadyProcessed: false,
      transactionId: 42,
      creditBalance: 9,
      balanceMinutes: 810,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain('WITH locked AS');
    expect(calls[0].text).toContain('FOR UPDATE');
    expect(calls[0].text).toContain('INSERT INTO credit_transactions');
    expect(calls[0].text).toContain('ON CONFLICT (stripe_session_id) WHERE stripe_session_id IS NOT NULL DO NOTHING');
    expect(calls[0].text).toContain('UPDATE learner_users');
  });

  test('duplicate Stripe session returns alreadyProcessed without applying a delta', async () => {
    const sql = makeSql([[
      {
        credit_balance: 5,
        balance_minutes: 450,
        transaction_id: null,
        already_processed: true,
      },
    ]]);

    const result = await grantCreditsPre2A({ ...baseGrant, sql });

    expect(result).toMatchObject({
      ok: true,
      completed: true,
      alreadyProcessed: true,
      transactionId: null,
      creditBalance: 5,
      balanceMinutes: 450,
    });
  });

  test('missing learner is surfaced as a typed no-op', async () => {
    const sql = makeSql([[]]);

    const result = await grantCreditsPre2A({ ...baseGrant, sql });

    expect(result).toMatchObject({
      ok: false,
      code: 'LEARNER_NOT_FOUND',
      alreadyProcessed: false,
      transactionId: null,
    });
  });
});

test.describe('grantCredits dispatcher', () => {
  test('runs the lazy phase check once and dispatches to Pre2A on current schema', async () => {
    _resetPhaseDetectionForTests();
    const calls = [];
    const sql = makeSql([
      [],
      [{
        credit_balance: 9,
        balance_minutes: 810,
        transaction_id: 42,
        already_processed: false,
      }],
    ], calls);

    const result = await grantCredits({ ...baseGrant, sql });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0].text).toContain('information_schema.columns');
    expect(calls[1].text).toContain('UPDATE learner_users');
  });
});

test.describe('normalizeGrantArgs', () => {
  test('rejects non-positive money-path values before SQL runs', () => {
    expect(() => normalizeGrantArgs({ ...baseGrant, sql: async () => [], minutes: 0 }))
      .toThrow('minutes must be a positive integer');
    expect(() => normalizeGrantArgs({ ...baseGrant, sql: async () => [], credits: -1 }))
      .toThrow('credits must be a positive integer');
    expect(() => normalizeGrantArgs({ ...baseGrant, sql: async () => [], amountPence: -1 }))
      .toThrow('amountPence must be a non-negative integer');
    expect(() => normalizeGrantArgs({ ...baseGrant, sql: async () => [], stripeFeePence: -1 }))
      .toThrow('stripeFeePence must be non-negative when provided');
  });
});
