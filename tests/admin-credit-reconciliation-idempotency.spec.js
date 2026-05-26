// @ts-check
// Mocked SQL tests for future credit-reconciliation idempotency lookup.
//
// These tests do not touch Neon, Stripe, migrations, payout crons, or credit
// writers. They only pin the read-only lookup contract.

const { test, expect } = require('@playwright/test');
const {
  findExistingReconciliationCreditTransaction,
} = require('../api/_admin-credit-reconciliation');
const {
  evaluateReconciliationStripeState,
} = require('../api/_admin-credit-contracts');

function creditTransaction(overrides = {}) {
  return {
    id: 42,
    source: 'stripe',
    created_at: '2026-05-25T10:00:00.000Z',
    school_id: 1,
    stripe_session_id: 'cs_lookup',
    stripe_payment_intent_id: 'pi_lookup',
    stripe_charge_id: 'ch_lookup',
    ...overrides,
  };
}

function makeSql(rows = []) {
  const calls = [];
  const sql = async (strings, ...values) => {
    const text = strings.join('?');
    calls.push({ text, values });
    return rows;
  };
  sql.calls = calls;
  return sql;
}

function expectSchoolScopedLookup(sql, expectedSchoolId = 1) {
  expect(sql.calls).toHaveLength(1);
  expect(sql.calls[0].text).toContain('FROM credit_transactions');
  expect(sql.calls[0].text).toContain('WHERE school_id = ?');
  expect(sql.calls[0].text).toContain('stripe_session_id = ?');
  expect(sql.calls[0].text).toContain('stripe_payment_intent_id = ?');
  expect(sql.calls[0].text).toContain('stripe_charge_id = ?');
  expect(sql.calls[0].values[0]).toBe(expectedSchoolId);
}

test.describe('admin credit-reconciliation idempotency lookup helper', () => {
  test('matches an existing credit transaction by session id', async () => {
    const sql = makeSql([creditTransaction({
      stripe_payment_intent_id: null,
      stripe_charge_id: null,
    })]);

    const result = await findExistingReconciliationCreditTransaction(sql, {
      schoolId: 1,
      stripeSessionId: 'cs_lookup',
    });

    expect(result).toMatchObject({
      ok: true,
      conflict: false,
      existingCreditTransaction: {
        id: 42,
        stripe_session_id: 'cs_lookup',
      },
      matched_identities: ['stripe_session_id'],
    });
    expect(evaluateReconciliationStripeState({
      existingCreditTransaction: result.existingCreditTransaction,
    })).toMatchObject({
      ok: true,
      noop: true,
      code: 'ALREADY_RECONCILED',
      transactionId: 42,
    });
    expectSchoolScopedLookup(sql);
    expect(sql.calls[0].values).toEqual([
      1,
      'cs_lookup',
      'cs_lookup',
      null,
      null,
      null,
      null,
    ]);
  });

  test('matches an existing credit transaction by payment intent id', async () => {
    const sql = makeSql([creditTransaction({
      stripe_session_id: null,
      stripe_charge_id: null,
    })]);

    const result = await findExistingReconciliationCreditTransaction(sql, {
      schoolId: 1,
      stripePaymentIntentId: 'pi_lookup',
    });

    expect(result).toMatchObject({
      ok: true,
      existingCreditTransaction: {
        id: 42,
        stripe_payment_intent_id: 'pi_lookup',
      },
      matched_identities: ['stripe_payment_intent_id'],
    });
    expectSchoolScopedLookup(sql);
  });

  test('matches an existing credit transaction by charge id', async () => {
    const sql = makeSql([creditTransaction({
      stripe_session_id: null,
      stripe_payment_intent_id: null,
    })]);

    const result = await findExistingReconciliationCreditTransaction(sql, {
      schoolId: 1,
      stripeChargeId: 'ch_lookup',
    });

    expect(result).toMatchObject({
      ok: true,
      existingCreditTransaction: {
        id: 42,
        stripe_charge_id: 'ch_lookup',
      },
      matched_identities: ['stripe_charge_id'],
    });
    expectSchoolScopedLookup(sql);
  });

  test('returns no-op-compatible null without querying when no identities are supplied', async () => {
    const sql = makeSql([creditTransaction()]);

    const result = await findExistingReconciliationCreditTransaction(sql, {
      schoolId: 1,
      stripeSessionId: '   ',
      stripePaymentIntentId: null,
      stripeChargeId: '',
    });

    expect(result).toEqual({
      ok: true,
      existingCreditTransaction: null,
      identities: {
        stripeSessionId: null,
        stripePaymentIntentId: null,
        stripeChargeId: null,
      },
      conflict: false,
    });
    expect(sql.calls).toHaveLength(0);
  });

  test('returns null when no existing row matches', async () => {
    const sql = makeSql([]);

    const result = await findExistingReconciliationCreditTransaction(sql, {
      schoolId: 1,
      stripeSessionId: 'cs_missing',
      stripePaymentIntentId: 'pi_missing',
      stripeChargeId: 'ch_missing',
    });

    expect(result).toMatchObject({
      ok: true,
      existingCreditTransaction: null,
      conflict: false,
    });
    expectSchoolScopedLookup(sql);
  });

  test('deduplicates multiple identities matching the same row', async () => {
    const sql = makeSql([creditTransaction()]);

    const result = await findExistingReconciliationCreditTransaction(sql, {
      schoolId: 1,
      stripeSessionId: 'cs_lookup',
      stripePaymentIntentId: 'pi_lookup',
      stripeChargeId: 'ch_lookup',
    });

    expect(result).toMatchObject({
      ok: true,
      conflict: false,
      existingCreditTransaction: {
        id: 42,
        stripe_session_id: 'cs_lookup',
        stripe_payment_intent_id: 'pi_lookup',
        stripe_charge_id: 'ch_lookup',
      },
      matched_identities: [
        'stripe_session_id',
        'stripe_payment_intent_id',
        'stripe_charge_id',
      ],
    });
    expect(evaluateReconciliationStripeState({
      existingCreditTransaction: result.existingCreditTransaction,
    })).toMatchObject({ ok: true, noop: true, transactionId: 42 });
    expectSchoolScopedLookup(sql);
  });

  test('returns a typed conflict when identities match different rows', async () => {
    const sql = makeSql([
      creditTransaction({
        id: 42,
        stripe_session_id: 'cs_lookup',
        stripe_payment_intent_id: null,
        stripe_charge_id: null,
      }),
      creditTransaction({
        id: 43,
        stripe_session_id: null,
        stripe_payment_intent_id: 'pi_lookup',
        stripe_charge_id: 'ch_lookup',
      }),
    ]);

    const result = await findExistingReconciliationCreditTransaction(sql, {
      schoolId: 1,
      stripeSessionId: 'cs_lookup',
      stripePaymentIntentId: 'pi_lookup',
      stripeChargeId: 'ch_lookup',
    });

    expect(result).toEqual({
      ok: false,
      status: 409,
      code: 'RECONCILIATION_IDENTITY_CONFLICT',
      message: 'Stripe identities matched different credit transactions; manual review is required.',
      conflict: true,
      identities: {
        stripeSessionId: 'cs_lookup',
        stripePaymentIntentId: 'pi_lookup',
        stripeChargeId: 'ch_lookup',
      },
      matches: [
        {
          id: 42,
          source: 'stripe',
          created_at: '2026-05-25T10:00:00.000Z',
          school_id: 1,
          stripe_session_id: 'cs_lookup',
          stripe_payment_intent_id: null,
          stripe_charge_id: null,
          matched_identities: ['stripe_session_id'],
        },
        {
          id: 43,
          source: 'stripe',
          created_at: '2026-05-25T10:00:00.000Z',
          school_id: 1,
          stripe_session_id: null,
          stripe_payment_intent_id: 'pi_lookup',
          stripe_charge_id: 'ch_lookup',
          matched_identities: ['stripe_payment_intent_id', 'stripe_charge_id'],
        },
      ],
    });
    expectSchoolScopedLookup(sql);
  });
});
