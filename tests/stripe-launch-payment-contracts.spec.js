const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY
  || 'sk_test_stripe_launch_payment_contracts';

const {
  PAYMENT_CONTRACT_SCHEMA_VERSION,
  PAYMENT_ORIGINS,
  prepareLaunchPaymentCandidate,
  parseLaunchPaymentCandidate,
  buildLaunchEvidenceDecision,
  materializeLaunchPaymentContract,
} = require('../api/_stripe-launch-payment-contracts');
const {
  comparePendingContract,
  reconcilePendingLaunchPaymentContracts,
} = require('../api/_stripe-launch-payment-reconciler');
const { fetchSessionFundingEvidence } = require('../api/_stripe-fee');

const repoRoot = path.resolve(__dirname, '..');
const candidateId = '11111111-1111-4111-8111-111111111111';

function taggedResponses(...responses) {
  let index = 0;
  return async () => responses[index++] || [];
}

function exactEvidence(overrides = {}) {
  return {
    checkoutSessionId: 'cs_launch_exact',
    paymentIntentId: 'pi_launch_exact',
    paymentIntentStatus: 'succeeded',
    chargeId: 'ch_launch_exact',
    chargePaid: true,
    chargeCaptured: true,
    chargePaymentIntentId: 'pi_launch_exact',
    balanceTransactionId: 'txn_launch_exact',
    balanceTransactionSourceId: 'ch_launch_exact',
    balanceTransactionType: 'charge',
    balanceTransactionAmountPence: 5500,
    balanceTransactionCurrency: 'gbp',
    balanceTransactionStatus: 'available',
    paymentCreatedAt: '2026-08-01T10:00:00.000Z',
    fundsAvailableAt: '2026-08-03T10:00:00.000Z',
    amountPence: 5500,
    currency: 'gbp',
    feePence: 103,
    source: 'balance_transaction',
    reviewReasons: [],
    ...overrides,
  };
}

test.describe('Stripe launch candidate boundary', () => {
  test('is inert without one explicit shadow config row', async () => {
    let calls = 0;
    const sql = async () => {
      calls += 1;
      return [];
    };
    await expect(prepareLaunchPaymentCandidate({
      sql,
      schoolId: 7,
      instructorId: 9,
      origin: PAYMENT_ORIGINS.DIRECT_SLOT,
    })).resolves.toEqual({});
    expect(calls).toBe(1);
  });

  test('adds a deterministic contract shape only after config and agreement checks', async () => {
    const metadata = await prepareLaunchPaymentCandidate({
      sql: taggedResponses(
        [{ id: candidateId, school_id: 7, mode: 'shadow' }],
        [{ id: '22222222-2222-4222-8222-222222222222' }]
      ),
      schoolId: 7,
      instructorId: 9,
      origin: PAYMENT_ORIGINS.TEST_DATE_DIRECT,
      now: new Date('2026-08-01T09:00:00.000Z'),
      randomUUID: () => candidateId,
    });
    expect(metadata).toEqual({
      payment_contract_candidate_id: candidateId,
      payment_contract_schema_version: PAYMENT_CONTRACT_SCHEMA_VERSION,
      payment_origin: PAYMENT_ORIGINS.TEST_DATE_DIRECT,
    });
    expect(parseLaunchPaymentCandidate(
      metadata,
      PAYMENT_ORIGINS.TEST_DATE_DIRECT
    )).toEqual({
      candidateId,
      schemaVersion: PAYMENT_CONTRACT_SCHEMA_VERSION,
      origin: PAYMENT_ORIGINS.TEST_DATE_DIRECT,
    });
  });

  test('rejects incomplete, forged, and wrong-origin candidate metadata', () => {
    expect(parseLaunchPaymentCandidate({}, PAYMENT_ORIGINS.DIRECT_SLOT)).toBeNull();
    expect(() => parseLaunchPaymentCandidate({
      payment_contract_candidate_id: candidateId,
      payment_contract_schema_version: PAYMENT_CONTRACT_SCHEMA_VERSION,
      payment_origin: PAYMENT_ORIGINS.ONE_OFF_OFFER,
    }, PAYMENT_ORIGINS.DIRECT_SLOT)).toThrow(/origin is invalid/);
    expect(() => parseLaunchPaymentCandidate({
      payment_contract_candidate_id: 'not-a-uuid',
      payment_contract_schema_version: PAYMENT_CONTRACT_SCHEMA_VERSION,
      payment_origin: PAYMENT_ORIGINS.DIRECT_SLOT,
    })).toThrow(/candidate ID is invalid/);
  });

  test('ignores uncandidated pre-cutover delivery but blocks uncandidated post-cutover delivery', async () => {
    const transactionRunner = async (_options, callback) => callback({
      query: async () => ({ rows: [{ cutover_at: '2026-08-01T00:00:00.000Z' }] }),
    });
    const base = {
      connectionString: 'not-used',
      schoolId: 7,
      creditTransactionId: 11,
      bookingId: 13,
      metadata: {},
      expectedOrigin: PAYMENT_ORIGINS.DIRECT_SLOT,
      transactionRunner,
    };
    await expect(materializeLaunchPaymentContract({
      ...base,
      fundingEvidence: { paymentCreatedAt: '2026-07-31T23:59:59.999Z' },
    })).resolves.toMatchObject({
      candidate: false,
      materialized: false,
      reason: 'pre_cutover_payment_without_candidate',
    });
    await expect(materializeLaunchPaymentContract({
      ...base,
      fundingEvidence: { paymentCreatedAt: '2026-08-01T00:00:00.000Z' },
    })).rejects.toMatchObject({ code: 'STRIPE_LAUNCH_CANDIDATE_MISSING' });
  });
});

test.describe('Stripe launch immutable evidence', () => {
  test('requires exact fee, Stripe creation time, availability time and status', () => {
    const complete = buildLaunchEvidenceDecision({
      fundingEvidence: exactEvidence(),
      now: new Date('2026-08-04T00:00:00.000Z'),
    });
    expect(complete).toMatchObject({
      missing: [],
      contradictory: [],
      fundsAvailable: true,
    });

    for (const evidence of [
      exactEvidence({ feePence: null, reviewReasons: ['missing_stripe_fee_evidence'] }),
      exactEvidence({ paymentCreatedAt: null }),
      exactEvidence({ fundsAvailableAt: null }),
      exactEvidence({ balanceTransactionStatus: null }),
    ]) {
      const decision = buildLaunchEvidenceDecision({
        fundingEvidence: evidence,
        now: new Date('2026-08-04T00:00:00.000Z'),
      });
      expect(decision.missing.length).toBeGreaterThan(0);
    }
  });

  test('does not classify future/pending Stripe funds as available', () => {
    expect(buildLaunchEvidenceDecision({
      fundingEvidence: exactEvidence({ balanceTransactionStatus: 'pending' }),
      now: new Date('2026-08-04T00:00:00.000Z'),
    }).fundsAvailable).toBe(false);
    expect(buildLaunchEvidenceDecision({
      fundingEvidence: exactEvidence({ fundsAvailableAt: '2026-08-05T00:00:00.000Z' }),
      now: new Date('2026-08-04T00:00:00.000Z'),
    }).fundsAvailable).toBe(false);
  });

  test('treats source-writer contradicts codes as terminal contradictions', () => {
    const decision = buildLaunchEvidenceDecision({
      fundingEvidence: exactEvidence({
        reviewReasons: ['stripe_amount_contradicts_credit_transaction'],
      }),
      now: new Date('2026-08-04T00:00:00.000Z'),
    });
    expect(decision.missing).toEqual([]);
    expect(decision.contradictory).toEqual([
      'stripe_amount_contradicts_credit_transaction',
    ]);
  });

  test('captures Stripe creation and balance availability evidence from read-only retrieval', async () => {
    const stripeClient = {
      paymentIntents: {
        retrieve: async () => ({
          id: 'pi_launch_exact',
          status: 'succeeded',
          created: 1785578400,
          amount_received: 5500,
          currency: 'gbp',
          latest_charge: {
            id: 'ch_launch_exact',
            paid: true,
            captured: true,
            payment_intent: 'pi_launch_exact',
            amount: 5500,
            currency: 'gbp',
            balance_transaction: {
              id: 'txn_launch_exact',
              source: 'ch_launch_exact',
              type: 'charge',
              amount: 5500,
              currency: 'gbp',
              fee: 103,
              status: 'available',
              available_on: 1785751200,
            },
          },
        }),
      },
    };
    const evidence = await fetchSessionFundingEvidence({
      id: 'cs_launch_exact',
      object: 'checkout.session',
      payment_intent: 'pi_launch_exact',
    }, stripeClient);
    expect(evidence).toMatchObject({
      balanceTransactionStatus: 'available',
      paymentCreatedAt: '2026-08-01T10:00:00.000Z',
      fundsAvailableAt: '2026-08-03T10:00:00.000Z',
      feePence: 103,
    });
  });

  test('reconciliation detects immutable amount, currency and Stripe-link contradictions', () => {
    const contract = {
      stripe_payment_intent_id: 'pi_launch_exact',
      stripe_charge_id: 'ch_launch_exact',
      stripe_balance_transaction_id: 'txn_launch_exact',
      gross_amount_minor: 5500,
      stripe_fee_minor: 103,
      currency: 'gbp',
      stripe_payment_created_at: '2026-08-01T10:00:00.000Z',
      stripe_funds_available_at: '2026-08-03T10:00:00.000Z',
    };
    expect(comparePendingContract(contract, exactEvidence())).toEqual([]);
    expect(comparePendingContract(contract, exactEvidence({
      amountPence: 5400,
      currency: 'usd',
      balanceTransactionSourceId: 'ch_other',
    }))).toEqual(expect.arrayContaining([
      'reconcile_gross_amount_minor_contradiction',
      'reconcile_currency_contradiction',
      'reconcile_balance_transaction_charge_contradiction',
    ]));
  });

  test('reconciler makes no Stripe request when no shadow contract is pending', async () => {
    let stripeCalls = 0;
    const result = await reconcilePendingLaunchPaymentContracts({
      sql: async () => [],
      connectionString: 'not-used',
      stripeEvidenceFetcher: async () => {
        stripeCalls += 1;
        return exactEvidence();
      },
    });
    expect(result).toMatchObject({ checked: 0, completed: 0, failed: 0 });
    expect(stripeCalls).toBe(0);
  });
});

test('only the four approved one-payment/one-lesson origins are emitted', () => {
  expect(Object.values(PAYMENT_ORIGINS).sort()).toEqual([
    'captured_request',
    'direct_slot',
    'one_off_offer',
    'test_date_direct',
  ]);
  const slots = fs.readFileSync(path.join(repoRoot, 'api', 'slots.js'), 'utf8');
  const offers = fs.readFileSync(path.join(repoRoot, 'api', 'offers.js'), 'utf8');
  const contracts = fs.readFileSync(path.join(repoRoot, 'api', '_stripe-launch-payment-contracts.js'), 'utf8');
  expect(slots).toContain('PAYMENT_ORIGINS.CAPTURED_REQUEST');
  expect(slots).toContain('PAYMENT_ORIGINS.TEST_DATE_DIRECT');
  expect(slots).toContain('PAYMENT_ORIGINS.DIRECT_SLOT');
  expect(offers).toContain('PAYMENT_ORIGINS.ONE_OFF_OFFER');
  expect(contracts).toContain('mode = ${SHADOW_WRITER_MODE}');
});

test('Slice 2 cannot create earnings, transfers, refunds or Connect resources', () => {
  const files = [
    'api/_stripe-launch-payment-contracts.js',
    'api/_stripe-launch-payment-reconciler.js',
  ];
  const source = files.map((file) => fs.readFileSync(path.join(repoRoot, file), 'utf8')).join('\n');
  expect(source).not.toMatch(/stripe\.transfers|stripe\.refunds|accounts\.create|accountLinks\.create/);
  expect(source).not.toMatch(/INSERT INTO\s+(stripe_launch_booking_earnings|stripe_launch_transfer_intents|refund_intents)/i);

  const shadow = fs.readFileSync(path.join(repoRoot, 'api', '_payout-v2-shadow.js'), 'utf8');
  const transfers = fs.readFileSync(path.join(repoRoot, 'api', '_payout-v2-transfer-executor.js'), 'utf8');
  expect(shadow).toContain("metadata->>'launch_accounting_version') IS DISTINCT FROM 'simon_launch_v1'");
  expect(transfers.match(/metadata->>'launch_accounting_version'\) IS DISTINCT FROM 'simon_launch_v1'/g)).toHaveLength(2);
});

test('one-off offer marks accepted before a retryable contract evidence write', () => {
  const webhook = fs.readFileSync(path.join(repoRoot, 'api', 'webhook.js'), 'utf8');
  const marker = webhook.indexOf('accepted_at = COALESCE(accepted_at, NOW())');
  const materialization = webhook.indexOf(
    'expectedOrigin: STRIPE_LAUNCH_PAYMENT_ORIGINS.ONE_OFF_OFFER',
    marker
  );
  expect(marker).toBeGreaterThan(0);
  expect(materialization).toBeGreaterThan(marker);
});
