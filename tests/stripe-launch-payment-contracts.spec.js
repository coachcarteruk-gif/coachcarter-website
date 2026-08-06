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
  compareLocalStripeFeeEvidence,
  materializeLaunchPaymentContract,
} = require('../api/_stripe-launch-payment-contracts');
const {
  RECOVERY_CONFIRMATION,
  comparePendingContract,
  recoverExactLaunchPaymentCandidate,
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

function recoveryLocalRow(overrides = {}) {
  return {
    credit_transaction_id: 11,
    school_id: 7,
    learner_id: 8,
    instructor_id: 9,
    amount_pence: 5500,
    credit_transaction_fee_pence: null,
    stripe_session_id: 'cs_test_launch123',
    stripe_payment_intent_id: 'pi_launch123',
    instructor_active: true,
    booking_id: 13,
    booking_status: 'scheduled',
    booking_purpose: 'test_date',
    booking_contract_id: null,
    booking_fee_pence: null,
    stripe_fee_source: null,
    booking_credit_source_id: 17,
    contribution_pence: 5500,
    booking_credit_source_fee_pence: 0,
    refunded_at: null,
    cutover_at: '2026-07-01T00:00:00.000Z',
    active_mapping_count: 1,
    funding_source_count: 0,
    payment_contract_count: 0,
    ...overrides,
  };
}

function recoveryPaymentObject() {
  return {
    id: 'cs_test_launch123',
    object: 'checkout.session',
    payment_status: 'paid',
    payment_intent: 'pi_launch123',
    metadata: {
      payment_contract_candidate_id: candidateId,
      payment_contract_schema_version: PAYMENT_CONTRACT_SCHEMA_VERSION,
      payment_origin: PAYMENT_ORIGINS.TEST_DATE_DIRECT,
    },
  };
}

function recoveryInput(overrides = {}) {
  return {
    connectionString: 'not-used',
    schoolId: 7,
    candidateId,
    checkoutSessionId: 'cs_test_launch123',
    paymentIntentId: 'pi_launch123',
    chargeId: 'ch_launch123',
    balanceTransactionId: 'txn_launch123',
    bookingId: 13,
    creditTransactionId: 11,
    bookingCreditSourceId: 17,
    origin: PAYMENT_ORIGINS.TEST_DATE_DIRECT,
    grossAmountMinor: 5500,
    stripeFeeMinor: 103,
    currency: 'gbp',
    now: new Date('2026-08-04T00:00:00.000Z'),
    paymentObjectFetcher: async () => recoveryPaymentObject(),
    stripeEvidenceFetcher: async () => exactEvidence({
      paymentIntentId: 'pi_launch123',
      chargeId: 'ch_launch123',
      chargePaymentIntentId: 'pi_launch123',
      balanceTransactionId: 'txn_launch123',
      balanceTransactionSourceId: 'ch_launch123',
    }),
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

  test('preserves delayed balance evidence as pending without writing a guessed contract', async () => {
    let mutationQueries = 0;
    const transactionRunner = async (_options, callback) => callback({
      query: async (text) => {
        if (/SELECT id, cutover_at/i.test(text)) {
          return { rows: [{ cutover_at: '2026-08-01T00:00:00.000Z' }] };
        }
        if (/FROM credit_transactions ct/i.test(text)) {
          return { rows: [{
            id: 11,
            school_id: 7,
            learner_id: 8,
            instructor_id: 9,
            instructor_active: true,
            type: 'slot_purchase',
            amount_pence: 5500,
            stripe_session_id: 'cs_launch_exact',
            stripe_payment_intent_id: 'pi_launch_exact',
            stripe_fee_pence: null,
          }] };
        }
        if (/FROM lesson_bookings b/i.test(text) && /booking_credit_sources bcs/i.test(text)) {
          return { rows: [{
            id: 13,
            school_id: 7,
            learner_id: 8,
            instructor_id: 9,
            status: 'scheduled',
            booking_purpose: 'lesson',
            lesson_payment_contract_id: null,
            booking_stripe_fee_pence: null,
            stripe_fee_source: null,
            contribution_pence: 5500,
            bcs_stripe_fee_pence: 0,
            refunded_at: null,
          }] };
        }
        if (/SELECT b\.id, b\.status/i.test(text)) {
          return { rows: [{ id: 13, status: 'scheduled', refunded_at: null }] };
        }
        if (/\b(?:INSERT|UPDATE|DELETE)\b/i.test(text)) mutationQueries += 1;
        return { rows: [] };
      },
    });
    const result = await materializeLaunchPaymentContract({
      connectionString: 'not-used',
      schoolId: 7,
      creditTransactionId: 11,
      bookingId: 13,
      metadata: {
        payment_contract_candidate_id: candidateId,
        payment_contract_schema_version: PAYMENT_CONTRACT_SCHEMA_VERSION,
        payment_origin: PAYMENT_ORIGINS.DIRECT_SLOT,
      },
      expectedOrigin: PAYMENT_ORIGINS.DIRECT_SLOT,
      fundingEvidence: exactEvidence({
        feePence: null,
        source: null,
        balanceTransactionId: null,
        fundsAvailableAt: null,
        balanceTransactionStatus: null,
      }),
      transactionRunner,
    });
    expect(result).toMatchObject({
      candidate: true,
      materialized: false,
      status: 'pending',
      payment_origin: PAYMENT_ORIGINS.DIRECT_SLOT,
    });
    expect(mutationQueries).toBe(0);
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

  test('historical processed candidate recovery dry-runs read-only, then materializes exactly once', async () => {
    let materializerCalls = 0;
    let postflightReady = false;
    const sql = async (strings) => {
      const text = strings.join('');
      if (/FROM credit_transactions ct/i.test(text)) return [recoveryLocalRow()];
      if (/FROM instructor_payout_agreement_versions a/i.test(text)) {
        return [{ agreement_count: 1 }];
      }
      if (/AS booking_link_count/i.test(text)) {
        return [{
          funding_source_count: postflightReady ? 1 : 0,
          payment_contract_count: postflightReady ? 1 : 0,
          booking_link_count: postflightReady ? 1 : 0,
        }];
      }
      return [];
    };
    const contractMaterializer = async () => {
      materializerCalls += 1;
      postflightReady = true;
      return {
        materialized: true,
        created: true,
        contract: {
          id: candidateId,
          evidence_status: 'complete',
          ineligibility_code: null,
          contradiction_code: null,
        },
      };
    };

    const dryRun = await recoverExactLaunchPaymentCandidate(recoveryInput({
      sql,
      dryRun: true,
      contractMaterializer,
    }));
    expect(dryRun).toMatchObject({
      status: 'ready',
      dry_run: true,
      identity: {
        candidate_id: candidateId,
        booking_id: 13,
        credit_transaction_id: 11,
        booking_credit_source_id: 17,
      },
    });
    expect(dryRun.identity.origin).toBe(PAYMENT_ORIGINS.TEST_DATE_DIRECT);
    expect(materializerCalls).toBe(0);

    const recovered = await recoverExactLaunchPaymentCandidate(recoveryInput({
      sql,
      dryRun: false,
      confirmation: RECOVERY_CONFIRMATION,
      contractMaterializer,
    }));
    expect(recovered).toMatchObject({
      status: 'complete',
      dry_run: false,
      identity: {
        candidate_id: candidateId,
        checkout_session_id: 'cs_test_launch123',
        payment_intent_id: 'pi_launch123',
        charge_id: 'ch_launch123',
        balance_transaction_id: 'txn_launch123',
        gross_amount_minor: 5500,
        stripe_fee_minor: 103,
        currency: 'gbp',
      },
    });
    expect(materializerCalls).toBe(1);
  });

  test('exact candidate recovery refuses identity drift, existing evidence, and non-test-date origins', async () => {
    let stripeCalls = 0;
    const base = recoveryInput({
      sql: async () => [recoveryLocalRow({ funding_source_count: 1 })],
      paymentObjectFetcher: async () => {
        stripeCalls += 1;
        return recoveryPaymentObject();
      },
    });
    await expect(recoverExactLaunchPaymentCandidate(base)).rejects.toMatchObject({
      code: 'STRIPE_LAUNCH_RECOVERY_NOT_MISSING',
    });
    expect(stripeCalls).toBe(0);

    await expect(recoverExactLaunchPaymentCandidate(recoveryInput({
      sql: async () => [recoveryLocalRow()],
      origin: PAYMENT_ORIGINS.DIRECT_SLOT,
    }))).rejects.toMatchObject({
      code: 'STRIPE_LAUNCH_RECOVERY_ORIGIN_REJECTED',
    });

    await expect(recoverExactLaunchPaymentCandidate(recoveryInput({
      sql: async () => [recoveryLocalRow()],
      stripeEvidenceFetcher: async () => exactEvidence({ feePence: 104 }),
    }))).rejects.toMatchObject({
      code: 'STRIPE_LAUNCH_RECOVERY_STRIPE_IDENTITY_MISMATCH',
    });

    let materializerCalls = 0;
    await expect(recoverExactLaunchPaymentCandidate(recoveryInput({
      sql: async (strings) => (
        /FROM credit_transactions ct/i.test(strings.join(''))
          ? [recoveryLocalRow({ credit_transaction_fee_pence: 102 })]
          : [{ agreement_count: 1 }]
      ),
      dryRun: false,
      confirmation: RECOVERY_CONFIRMATION,
      contractMaterializer: async () => { materializerCalls += 1; },
    }))).rejects.toMatchObject({
      code: 'STRIPE_LAUNCH_RECOVERY_STRIPE_IDENTITY_MISMATCH',
    });
    expect(materializerCalls).toBe(0);

    await expect(recoverExactLaunchPaymentCandidate(recoveryInput({
      sql: async (strings) => (
        /FROM credit_transactions ct/i.test(strings.join(''))
          ? [recoveryLocalRow()]
          : [{ agreement_count: 0 }]
      ),
      dryRun: false,
      confirmation: RECOVERY_CONFIRMATION,
      contractMaterializer: async () => { materializerCalls += 1; },
    }))).rejects.toMatchObject({
      code: 'STRIPE_LAUNCH_RECOVERY_AGREEMENT_MISMATCH',
    });
    expect(materializerCalls).toBe(0);
  });

  test('treats legacy null/zero fee placeholders as unknown but preserves known mismatches', () => {
    expect(compareLocalStripeFeeEvidence({
      creditTransactionFeePence: null,
      bookingFeePence: null,
      bookingFeeSource: null,
      bookingContributionFeePence: 0,
      stripeFeePence: 199,
    })).toEqual([]);

    expect(compareLocalStripeFeeEvidence({
      creditTransactionFeePence: 198,
      bookingFeePence: 198,
      bookingFeeSource: 'balance_transaction',
      bookingContributionFeePence: 198,
      stripeFeePence: 199,
    })).toEqual([
      'credit_transaction_stripe_fee_contradiction',
      'booking_stripe_fee_contradiction',
      'booking_contribution_stripe_fee_contradiction',
    ]);
  });

  test('reconciler recovers every Slice 2 origin that has no initial contract', async () => {
    const origins = Object.values(PAYMENT_ORIGINS);
    const originRows = origins.map((payment_origin, index) => ({
      school_id: 7,
      credit_transaction_id: 100 + index,
      booking_id: 200 + index,
      stripe_checkout_session_id: payment_origin === PAYMENT_ORIGINS.CAPTURED_REQUEST
        ? null
        : `cs_${index}`,
      stripe_payment_intent_id: `pi_${index}`,
      payment_origin,
    }));
    const materialized = [];
    const sql = async (strings) => {
      const text = strings.join('');
      if (/SELECT c\.id, c\.school_id/i.test(text)) return [];
      if (/SELECT DISTINCT ON/i.test(text)) return originRows;
      return [];
    };
    const result = await reconcilePendingLaunchPaymentContracts({
      sql,
      connectionString: 'not-used',
      schoolId: 7,
      paymentObjectFetcher: async (candidate) => ({
        id: candidate.stripe_checkout_session_id || candidate.stripe_payment_intent_id,
        object: candidate.stripe_checkout_session_id ? 'checkout.session' : 'payment_intent',
        payment_intent: candidate.stripe_payment_intent_id,
        metadata: { payment_origin: candidate.payment_origin },
      }),
      stripeEvidenceFetcher: async () => exactEvidence(),
      contractMaterializer: async (input) => {
        materialized.push(input);
        return { materialized: true, contract: { evidence_status: 'complete' } };
      },
    });

    expect(result).toMatchObject({
      checked: 4,
      unmaterialized_origins: 4,
      completed: 4,
      failed: 0,
    });
    expect(materialized.map((input) => input.expectedOrigin).sort()).toEqual(origins.sort());
    expect(materialized.every((input) => input.schoolId === 7)).toBe(true);
    expect(materialized.every((input) => input.eventContext.stripeEventType === 'reconciliation')).toBe(true);
  });

  test('delayed balance evidence remains retryable and duplicate reconciliation is idempotent', async () => {
    const candidate = {
      school_id: 7,
      credit_transaction_id: 301,
      booking_id: 401,
      stripe_checkout_session_id: 'cs_delayed',
      stripe_payment_intent_id: 'pi_delayed',
      payment_origin: PAYMENT_ORIGINS.DIRECT_SLOT,
    };
    const sql = async (strings) => /SELECT DISTINCT ON/i.test(strings.join('')) ? [candidate] : [];
    let evidenceAvailable = false;
    let materializerCalls = 0;
    const options = {
      sql,
      connectionString: 'not-used',
      schoolId: 7,
      paymentObjectFetcher: async () => ({
        id: 'cs_delayed',
        object: 'checkout.session',
        payment_intent: 'pi_delayed',
        metadata: {},
      }),
      stripeEvidenceFetcher: async () => evidenceAvailable
        ? exactEvidence()
        : exactEvidence({ feePence: null, reviewReasons: ['missing_stripe_fee_evidence'] }),
      contractMaterializer: async ({ fundingEvidence }) => {
        materializerCalls += 1;
        if (fundingEvidence.feePence === null) {
          return { materialized: false, status: 'pending', reasons: ['stripe_fee_minor'] };
        }
        return {
          materialized: true,
          created: materializerCalls === 2,
          contract: { id: candidateId, evidence_status: 'complete' },
        };
      },
    };

    const delayed = await reconcilePendingLaunchPaymentContracts(options);
    expect(delayed).toMatchObject({ checked: 1, pending: 1, completed: 0, failed: 0 });

    evidenceAvailable = true;
    const recovered = await reconcilePendingLaunchPaymentContracts(options);
    const duplicate = await reconcilePendingLaunchPaymentContracts(options);
    expect(recovered).toMatchObject({ checked: 1, completed: 1, failed: 0 });
    expect(duplicate).toMatchObject({ checked: 1, completed: 1, failed: 0 });
    expect(materializerCalls).toBe(3);
  });

  test('school-scoped reconciliation rejects cross-tenant rows even from an adversarial query adapter', async () => {
    const foreign = {
      school_id: 8,
      credit_transaction_id: 500,
      booking_id: 600,
      stripe_checkout_session_id: 'cs_foreign',
      stripe_payment_intent_id: 'pi_foreign',
      payment_origin: PAYMENT_ORIGINS.DIRECT_SLOT,
    };
    let stripeCalls = 0;
    const result = await reconcilePendingLaunchPaymentContracts({
      sql: async (strings) => /SELECT DISTINCT ON/i.test(strings.join('')) ? [foreign] : [],
      connectionString: 'not-used',
      schoolId: 7,
      paymentObjectFetcher: async () => {
        stripeCalls += 1;
        return {};
      },
    });
    expect(result).toMatchObject({ checked: 0, failed: 0 });
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
