const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY
  || 'sk_test_payout_v2_source_ingestion';

const {
  SOURCE_KINDS,
  buildStripeSourceRecord,
  buildLegacySourceRecord,
} = require('../api/_payout-v2-source-writer');
const {
  fetchSessionFundingEvidence,
} = require('../api/_stripe-fee');
const {
  _validatePayoutV2ReceiptScope: validatePayoutV2ReceiptScope,
} = require('../api/webhook');

function sourceRow(overrides = {}) {
  return {
    id: 91,
    school_id: 4,
    learner_id: 12,
    instructor_id: 8,
    type: 'purchase',
    amount_pence: 8250,
    stripe_fee_pence: 250,
    stripe_session_id: 'cs_source_contract',
    stripe_payment_intent_id: 'pi_source_contract',
    created_at: new Date('2026-07-25T10:00:00.000Z'),
    ...overrides,
  };
}

function exactEvidence(overrides = {}) {
  return {
    checkoutSessionId: 'cs_source_contract',
    paymentIntentId: 'pi_source_contract',
    paymentIntentStatus: 'succeeded',
    chargeId: 'ch_source_contract',
    chargePaid: true,
    chargeCaptured: true,
    chargePaymentIntentId: 'pi_source_contract',
    balanceTransactionId: 'txn_source_contract',
    balanceTransactionSourceId: 'ch_source_contract',
    balanceTransactionType: 'charge',
    balanceTransactionAmountPence: 8250,
    balanceTransactionCurrency: 'gbp',
    amountPence: 8250,
    currency: 'gbp',
    feePence: 250,
    source: 'balance_transaction',
    ...overrides,
  };
}

test.describe('Payout v2 source ingestion pure contracts', () => {
  test('positive Stripe funding requires charge, balance transaction, amount, and fee evidence', () => {
    const record = buildStripeSourceRecord({
      sourceRow: sourceRow(),
      schoolId: 4,
      sourceKind: SOURCE_KINDS.CREDIT_PURCHASE,
      stripeEvidence: exactEvidence(),
    });
    expect(record).toMatchObject({
      school_id: 4,
      funding_class: 'stripe_backed',
      gross_collected_pence: 8250,
      stripe_fee_pence: 250,
      payable_pool_pence: 8000,
      refundable_pool_pence: 8000,
      source_status: 'available',
    });
    expect(record.metadata.fee_evidence).toBe('stripe_balance_transaction');
    expect(record.source_fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test('missing or contradictory Stripe evidence becomes zero-payable manual review', () => {
    for (const evidence of [
      exactEvidence({ chargeId: null }),
      exactEvidence({ balanceTransactionId: null }),
      exactEvidence({ feePence: null }),
      exactEvidence({ amountPence: 8249 }),
      exactEvidence({ currency: 'usd' }),
      exactEvidence({ source: null }),
      exactEvidence({ chargePaymentIntentId: 'pi_contradiction' }),
      exactEvidence({ balanceTransactionSourceId: 'ch_contradiction' }),
    ]) {
      const record = buildStripeSourceRecord({
        sourceRow: sourceRow(),
        schoolId: 4,
        sourceKind: SOURCE_KINDS.CREDIT_PURCHASE,
        stripeEvidence: evidence,
      });
      expect(record.funding_class).toBe('manual_review');
      expect(record.source_status).toBe('manual_review');
      expect(record.payable_pool_pence).toBe(0);
      expect(record.refundable_pool_pence).toBe(0);
      expect(record.metadata.review_reasons.length).toBeGreaterThan(0);
    }
  });

  test('legacy writer contract ignores positive historical amount for payout value', () => {
    const record = buildLegacySourceRecord({
      sourceRow: sourceRow({
        type: 'legacy_grandfather',
        amount_pence: 41400,
        stripe_session_id: null,
        stripe_payment_intent_id: null,
      }),
      schoolId: 4,
    });
    expect(record).toMatchObject({
      funding_class: 'legacy_pre_connect_settled',
      gross_collected_pence: 41400,
      stripe_fee_pence: 0,
      payable_pool_pence: 0,
      refundable_pool_pence: 0,
    });
    expect(record.metadata.forced_zero_payable_value).toBe(true);
  });

  test('source classification has no live-price input or fallback', () => {
    const writerSource = fs.readFileSync(
      path.resolve(__dirname, '..', 'api', '_payout-v2-source-writer.js'),
      'utf8'
    );
    expect(writerSource).not.toMatch(
      /lesson_types\.price_pence|custom_hourly_rate|hourly_rate_pence|bulk_hourly_pence|list_price_pence/
    );
  });

  test('Stripe evidence helper returns immutable fee provenance', async () => {
    const stripeClient = {
      paymentIntents: {
        retrieve: async () => ({
          id: 'pi_source_contract',
          status: 'succeeded',
          amount_received: 8250,
          currency: 'gbp',
          latest_charge: {
            id: 'ch_source_contract',
            paid: true,
            captured: true,
            payment_intent: 'pi_source_contract',
            amount: 8250,
            currency: 'gbp',
            balance_transaction: {
              id: 'txn_source_contract',
              source: 'ch_source_contract',
              type: 'charge',
              amount: 8250,
              currency: 'gbp',
              fee: 250,
            },
          },
        }),
      },
    };
    await expect(fetchSessionFundingEvidence({
      id: 'cs_source_contract',
      object: 'checkout.session',
      payment_intent: 'pi_source_contract',
    }, stripeClient)).resolves.toEqual(exactEvidence());
  });

  test('Stripe evidence resolves a Charge by PaymentIntent when latest payment identity is not ch_', async () => {
    const stripeClient = {
      paymentIntents: {
        retrieve: async () => ({
          id: 'pi_source_contract',
          status: 'succeeded',
          amount_received: 8250,
          currency: 'gbp',
          latest_charge: {
            id: 'py_source_contract',
            paid: true,
            captured: true,
            payment_intent: 'pi_source_contract',
            balance_transaction: {
              id: 'txn_source_contract',
              source: 'ch_source_contract',
              type: 'charge',
              amount: 8250,
              currency: 'gbp',
              fee: 250,
            },
          },
        }),
      },
      charges: {
        list: async () => ({
          data: [{
            id: 'ch_source_contract',
            paid: true,
            captured: true,
            payment_intent: 'pi_source_contract',
            amount: 8250,
            currency: 'gbp',
            balance_transaction: {
              id: 'txn_source_contract',
              source: 'ch_source_contract',
              type: 'charge',
              amount: 8250,
              currency: 'gbp',
              fee: 250,
            },
          }],
        }),
      },
    };
    await expect(fetchSessionFundingEvidence({
      id: 'cs_source_contract',
      object: 'checkout.session',
      payment_intent: 'pi_source_contract',
    }, stripeClient)).resolves.toEqual(exactEvidence());
  });

  test('webhook verifies signatures before event receipt claiming and dual-writes after primary rows', () => {
    const webhook = fs.readFileSync(
      path.resolve(__dirname, '..', 'api', 'webhook.js'),
      'utf8'
    );
    expect(webhook.indexOf('stripe.webhooks.constructEvent')).toBeLessThan(
      webhook.indexOf('payoutV2Receipt = await claimPayoutV2Receipt(event)')
    );
    expect(webhook).toContain('await handleCreditPurchase(session, payoutV2Receipt)');
    expect(webhook).toContain('await handleSlotBooking(session, payoutV2Receipt)');
    expect(webhook).toContain('await handleOfferBooking(session, payoutV2Receipt)');
    const checkoutDispatch = webhook.indexOf("event.type === 'checkout.session.completed'");
    const requestCreation = webhook.indexOf(
      'await handleRequestHold(session)',
      checkoutDispatch
    );
    const paymentIntentDispatch = webhook.indexOf("event.type === 'payment_intent.succeeded'");
    const capturedSource = webhook.indexOf(
      'await handleCapturedRequestSource(paymentIntent, payoutV2Receipt)',
      paymentIntentDispatch
    );
    expect(requestCreation).toBeGreaterThan(checkoutDispatch);
    expect(requestCreation).toBeLessThan(paymentIntentDispatch);
    expect(capturedSource).toBeGreaterThan(paymentIntentDispatch);
    expect(webhook).toContain('PAYOUT_V2_SOURCE_KINDS.CREDIT_PURCHASE');
    expect(webhook).toContain('PAYOUT_V2_SOURCE_KINDS.DIRECT_BOOKING');
    expect(webhook).toContain('markStripeEventFailed');
    expect(webhook.indexOf('await validatePayoutV2ReceiptScope(event, sql, schoolId)'))
      .toBeLessThan(webhook.indexOf('claimStripeEventReceipt({'));
  });

  test('webhook receipt scope requires canonical same-school payment relationships', async () => {
    const sameSchoolSql = async () => [{ id: 1 }];
    await expect(validatePayoutV2ReceiptScope({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_scope',
          metadata: {
            payment_type: 'slot_booking',
            school_id: '4',
            learner_id: '12',
            instructor_id: '8',
          },
        },
      },
    }, sameSchoolSql, 4)).resolves.toBeUndefined();

    await expect(validatePayoutV2ReceiptScope({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_scope',
          metadata: {
            payment_type: 'lesson_offer',
            school_id: '4',
            offer_id: '91',
            offer_token: 'offer_scope_token',
            instructor_id: '8',
          },
        },
      },
    }, sameSchoolSql, 4)).resolves.toBeUndefined();

    await expect(validatePayoutV2ReceiptScope({
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_scope',
          metadata: {
            payment_type: 'lesson_request_hold',
            school_id: '4',
            learner_id: '12',
            instructor_id: '8',
          },
        },
      },
    }, sameSchoolSql, 4)).resolves.toBeUndefined();

    await expect(validatePayoutV2ReceiptScope({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_cross_school',
          metadata: {
            payment_type: 'slot_booking',
            school_id: '4',
            learner_id: '12',
            instructor_id: '8',
          },
        },
      },
    }, async () => [], 4)).rejects.toMatchObject({
      code: 'PAYOUT_V2_EVENT_SCOPE_MISMATCH',
    });
  });

  test('offer and captured-request producers preserve explicit school scope', () => {
    const offers = fs.readFileSync(
      path.resolve(__dirname, '..', 'api', 'offers.js'),
      'utf8'
    );
    const slots = fs.readFileSync(
      path.resolve(__dirname, '..', 'api', 'slots.js'),
      'utf8'
    );
    const webhook = fs.readFileSync(
      path.resolve(__dirname, '..', 'api', 'webhook.js'),
      'utf8'
    );
    expect(offers).toContain('i.school_id = o.school_id');
    expect(offers).toContain('lt.school_id = o.school_id');
    expect(offers).not.toContain('instrRow?.school_id || 1');
    expect(slots).toContain('metadata: requestPaymentMetadata');
    expect(webhook).toContain('ct.school_id = lr.school_id');
    expect(webhook).toContain('ct.learner_id = lr.learner_id');
    expect(webhook).toContain('ct.instructor_id = lr.instructor_id');
    expect(webhook).toContain("lr.status = 'accepted'");
  });

  test('source preview is read-only, explicitly school-scoped, and has no school default', () => {
    const preview = fs.readFileSync(
      path.resolve(__dirname, '..', 'scripts', 'payout-v2-source-preview.js'),
      'utf8'
    );
    expect(preview).toContain('process.env.PAYOUT_V2_SCHOOL_ID');
    expect(preview).toContain('there is no default');
    expect(preview).toContain('ct.school_id = ${schoolId}');
    expect(preview).toContain('pfs.school_id = ct.school_id');
    expect(preview).not.toMatch(/sql`\s*(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE)/i);
    expect(preview).not.toMatch(/\.(create|update|del|cancel|confirm|capture|refund)\s*\(/i);
  });
});
