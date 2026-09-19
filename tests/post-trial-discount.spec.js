const { test, expect } = require('@playwright/test');
process.env.STRIPE_SECRET_KEY = 'sk_test_post_trial_dispatch';
const fs = require('fs');
const path = require('path');
const {
  applyPostTrialDiscount,
  getPostTrialDiscount,
  quotePostTrialPrice,
  validatePostTrialQuote,
  validatePostTrialConfig,
  bindPostTrialQuote,
} = require('../api/_post-trial-discount');
const { preprocessPostTrialWebhook } = require('../api/_post-trial-webhook');
const {
  _prepareLegacyPostTrialEvent: prepareLegacyPostTrialEvent,
  _splitPenceAcrossCount: splitPenceAcrossCount,
} = require('../api/webhook');

function result(rows) {
  return Array.isArray(rows) ? rows : [rows];
}

test.describe('post-trial discount core', () => {
  test('stacks after an existing price and conserves exact pennies', () => {
    expect(applyPostTrialDiscount(7837, 10)).toEqual({
      pricePence: 7053,
      discountPence: 784,
      discountPct: 10,
    });
  });

  test('repeat offer partial fulfilment allocates uneven pennies before refunding unbooked shares', () => {
    const requested = splitPenceAcrossCount(1001, 4);
    expect(requested).toEqual([251, 250, 250, 250]);
    const booked = requested.slice(0, 2);
    const refund = requested.slice(2).reduce((sum, value) => sum + value, 0);
    expect(booked.reduce((sum, value) => sum + value, 0)).toBe(501);
    expect(refund).toBe(500);
    expect(booked.reduce((sum, value) => sum + value, 0) + refund).toBe(1001);
  });

  test('validates editable commercial settings', () => {
    expect(validatePostTrialConfig({ post_trial_discount_pct: 10, post_trial_discount_hours: 48 })).toBeNull();
    expect(validatePostTrialConfig({ post_trial_discount_pct: 100 })).toMatch(/99.99/);
    expect(validatePostTrialConfig({ post_trial_discount_pct: 10.123 })).toMatch(/two decimal/);
    expect(validatePostTrialConfig({ post_trial_discount_hours: 0 })).toMatch(/between 1 and 720/);
  });

  test('quotes for 30 minutes beyond an eligibility boundary and emits string metadata', async () => {
    const calls = [];
    const sql = async (parts, ...values) => {
      const query = parts.join('?');
      calls.push({ query, values });
      if (query.includes('SELECT config FROM schools')) return result({ config: { timezone: 'Europe/London', pricing: { post_trial_discount_pct: 10, post_trial_discount_hours: 48 } } });
      if (query.includes('FROM lesson_bookings')) return result({ id: 7, trial_ended_at: '2026-09-14T14:00:00.000Z' });
      if (query.includes('INSERT INTO post_trial_discount_quotes')) return [];
      throw new Error(query);
    };
    const now = new Date('2026-09-16T13:59:00.000Z');
    const quote = await quotePostTrialPrice(sql, { schoolId: 1, learnerId: 2, amountPence: 8250, now });
    expect(quote.pricePence).toBe(7425);
    expect(quote.eligibleUntil).toBe('2026-09-16T14:00:00.000Z');
    expect(quote.checkoutExpiresAt).toBe('2026-09-16T14:29:00.000Z');
    expect(Object.values(quote.metadata).every(value => typeof value === 'string')).toBe(true);
    expect(calls.some(call => call.query.includes("lt.slug = 'trial'") && call.query.includes("booking_purpose"))).toBe(true);
  });

  test('uses a shorter existing slot hold as the quote deadline', async () => {
    const sql = async (parts) => {
      const query = parts.join('?');
      if (query.includes('SELECT config FROM schools')) return result({ config: { pricing: {} } });
      if (query.includes('FROM lesson_bookings')) return result({ id: 8, trial_ended_at: '2026-09-16T12:00:00.000Z' });
      return [];
    };
    const quote = await quotePostTrialPrice(sql, {
      schoolId: 1, learnerId: 2, amountPence: 1000,
      now: new Date('2026-09-16T13:00:00.000Z'),
      maxExpiresAt: new Date('2026-09-16T13:10:00.000Z'),
    });
    expect(quote.checkoutExpiresAt).toBe('2026-09-16T13:10:00.000Z');
  });

  test('requires provider initiation evidence and accepts explicit provider promotion evidence', async () => {
    const quote = {
      id: '00000000-0000-4000-8000-000000000001',
      school_id: 1,
      learner_id: 2,
      final_amount_pence: 7425,
      payment_type: 'checkout_session',
      payment_identity: 'cs_test',
      created_at: '2026-09-16T13:00:00.000Z',
      checkout_expires_at: '2026-09-16T13:30:00.000Z',
      provider_initiated_at: null,
    };
    const sql = async (parts) => {
      const query = parts.join('?');
      if (query.includes('SELECT * FROM post_trial_discount_quotes')) return result(quote);
      if (query.includes('UPDATE post_trial_discount_quotes')) return result({ ...quote, provider_initiated_at: '2026-09-16T13:20:00.000Z' });
      throw new Error(query);
    };
    const base = { quoteId: quote.id, schoolId: 1, learnerId: 2, amountPence: 7000,
      providerDiscountPence: 425, paymentType: 'checkout_session', paymentIdentity: 'cs_test' };
    await expect(validatePostTrialQuote(sql, base)).resolves.toMatchObject({ ok: false, code: 'POST_TRIAL_INITIATION_EVIDENCE_REQUIRED' });
    await expect(validatePostTrialQuote(sql, { ...base, providerInitiatedAt: '2026-09-16T13:20:00.000Z' }))
      .resolves.toMatchObject({ ok: true });
    await expect(validatePostTrialQuote(sql, { ...base, providerInitiatedAt: '2026-09-16T13:30:00.000Z' }))
      .resolves.toMatchObject({ ok: false });
  });

  test('invalid timezone configuration is replaced before it reaches SQL', async () => {
    const sql = async (parts, ...values) => {
      const query = parts.join('?');
      if (query.includes('SELECT config FROM schools')) return result({ config: { timezone: 'Not/AZone', pricing: {} } });
      if (query.includes('FROM lesson_bookings')) {
        expect(values).toContain('Europe/London');
        return [];
      }
      return [];
    };
    await expect(getPostTrialDiscount(sql, { schoolId: 1, learnerId: 2, now: new Date() }))
      .resolves.toMatchObject({ eligible: false });
  });

  test('accepts a signed provider event in the same whole second as quote creation', async () => {
    const quote = {
      id: '00000000-0000-4000-8000-000000000002', school_id: 1, learner_id: 2,
      final_amount_pence: 900, payment_type: 'payment_intent', payment_identity: 'pi_same_second',
      created_at: '2026-09-16T13:00:00.900Z', checkout_expires_at: '2026-09-16T13:30:00.000Z',
      provider_initiated_at: null,
    };
    const sql = async (parts) => {
      const query = parts.join('?');
      if (query.includes('SELECT *')) return result(quote);
      if (query.includes('UPDATE post_trial')) return result({ ...quote, provider_initiated_at: '2026-09-16T13:00:00.000Z' });
      return [];
    };
    await expect(validatePostTrialQuote(sql, {
      quoteId: quote.id, schoolId: 1, learnerId: 2, amountPence: 900,
      paymentType: 'payment_intent', paymentIdentity: 'pi_same_second',
      providerInitiatedAt: '2026-09-16T13:00:00.000Z',
    })).resolves.toMatchObject({ ok: true });
  });

  test('rejects blank payment bindings before SQL', async () => {
    let called = false;
    const sql = async () => { called = true; return []; };
    await expect(bindPostTrialQuote(sql, {
      quoteId: '00000000-0000-4000-8000-000000000003', schoolId: 1, learnerId: 2,
      paymentType: 'payment_intent', paymentIdentity: '   ',
    })).resolves.toEqual({ ok: false, code: 'POST_TRIAL_QUOTE_BINDING_REQUIRED' });
    expect(called).toBe(false);
  });

  test('webhook records processing initiation, then fulfils delayed settlement from stored evidence', async () => {
    let quote = {
      id: '00000000-0000-4000-8000-000000000004', school_id: 1, learner_id: 2,
      base_amount_pence: 1000, discount_pct: 10, discount_pence: 100, final_amount_pence: 900,
      payment_type: 'payment_intent', payment_identity: 'pi_async',
      created_at: '2026-09-16T13:00:00.000Z', checkout_expires_at: '2026-09-16T13:30:00.000Z',
      provider_initiated_at: null,
    };
    const sql = async (parts, ...values) => {
      const query = parts.join('?');
      if (query.includes('SELECT *')) return result(quote);
      if (query.includes('SET provider_initiated_at')) {
        quote = { ...quote, provider_initiated_at: values[0] };
        return result(quote);
      }
      if (query.includes('SET settlement_status')) return [];
      throw new Error(query);
    };
    const processing = { type: 'payment_intent.processing', created: 1789564200,
      data: { object: { id: 'pi_async', amount: 900, status: 'processing', metadata: { post_trial_quote_id: quote.id } } } };
    const settled = { type: 'payment_intent.succeeded', created: 1789567200,
      data: { object: { id: 'pi_async', amount: 900, amount_received: 900, status: 'succeeded', metadata: { post_trial_quote_id: quote.id } } } };
    const first = await preprocessPostTrialWebhook(sql, { event: processing, schoolId: 1, learnerId: 2, paymentType: 'payment_intent' });
    expect(first).toMatchObject({ ok: true, fulfill: false, paymentState: 'processing' });
    const second = await preprocessPostTrialWebhook(sql, { event: settled, schoolId: 1, learnerId: 2, paymentType: 'payment_intent' });
    expect(second).toMatchObject({ ok: true, fulfill: true, paymentState: 'paid', monetary: { paidAmountPence: 900 } });
  });

  test('paid quote mismatch is acknowledged for narrow compensation instead of fulfilment', async () => {
    const quote = {
      id: '00000000-0000-4000-8000-000000000005', school_id: 1, learner_id: 2,
      final_amount_pence: 900, payment_type: 'checkout_session', payment_identity: 'cs_bad',
      created_at: '2026-09-16T13:00:00.000Z', checkout_expires_at: '2026-09-16T13:30:00.000Z',
      provider_initiated_at: null,
    };
    const outcomes = [];
    const sql = async (parts, ...values) => {
      const query = parts.join('?');
      if (query.includes('SELECT *')) return result(quote);
      if (query.includes('SET settlement_status')) { outcomes.push(values); return []; }
      return [];
    };
    const event = { type: 'checkout.session.completed', created: 1789564200,
      data: { object: { id: 'cs_bad', amount_total: 899, payment_status: 'paid', total_details: { amount_discount: 0 }, metadata: { post_trial_quote_id: quote.id } } } };
    const checked = await preprocessPostTrialWebhook(sql, { event, schoolId: 1, learnerId: 2, paymentType: 'checkout_session' });
    expect(checked).toMatchObject({ ok: false, fulfill: false, compensationRequired: true, code: 'POST_TRIAL_AMOUNT_MISMATCH' });
    expect(outcomes).toHaveLength(1);
  });

  test('checkout completed processing is later fulfilled by async success using stored initiation', async () => {
    let quote = {
      id: '00000000-0000-4000-8000-000000000006', school_id: 1, learner_id: 2,
      base_amount_pence: 1000, discount_pct: 10, discount_pence: 100, final_amount_pence: 900,
      payment_type: 'checkout_session', payment_identity: 'cs_async',
      created_at: '2026-09-16T13:00:00.000Z', checkout_expires_at: '2026-09-16T13:30:00.000Z', provider_initiated_at: null,
    };
    const sql = async (parts, ...values) => {
      const query = parts.join('?');
      if (query.includes('SELECT *')) return result(quote);
      if (query.includes('SET provider_initiated_at')) { quote = { ...quote, provider_initiated_at: values[0] }; return result(quote); }
      if (query.includes('SET settlement_status')) return [];
      return [];
    };
    const object = { id: 'cs_async', amount_total: 900, payment_status: 'unpaid',
      total_details: { amount_discount: 0 }, metadata: { post_trial_quote_id: quote.id } };
    const completed = await preprocessPostTrialWebhook(sql, {
      event: { type: 'checkout.session.completed', created: 1789564200, data: { object } },
      schoolId: 1, learnerId: 2, paymentType: 'checkout_session',
    });
    expect(completed).toMatchObject({ ok: true, fulfill: false, paymentState: 'processing' });
    const succeeded = await preprocessPostTrialWebhook(sql, {
      event: { type: 'checkout.session.async_payment_succeeded', created: 1789654200,
        data: { object: { ...object, payment_status: 'paid' } } },
      schoolId: 1, learnerId: 2, paymentType: 'checkout_session',
    });
    expect(succeeded).toMatchObject({ ok: true, fulfill: true, paymentState: 'paid' });
  });

  test('request authorization can be captured later against its stored authorization time', async () => {
    let quote = {
      id: '00000000-0000-4000-8000-000000000007', school_id: 1, learner_id: 2,
      base_amount_pence: 1000, discount_pct: 10, discount_pence: 100, final_amount_pence: 900,
      payment_type: 'payment_intent', payment_identity: 'pi_request',
      created_at: '2026-09-16T13:00:00.000Z', checkout_expires_at: '2026-09-16T13:30:00.000Z', provider_initiated_at: null,
    };
    const sql = async (parts, ...values) => {
      const query = parts.join('?');
      if (query.includes('SELECT *')) return result(quote);
      if (query.includes('SET provider_initiated_at')) { quote = { ...quote, provider_initiated_at: values[0] }; return result(quote); }
      if (query.includes('SET settlement_status')) return [];
      return [];
    };
    const authorized = await preprocessPostTrialWebhook(sql, {
      event: { type: 'payment_intent.amount_capturable_updated', created: 1789564200,
        data: { object: { id: 'pi_request', amount: 900, amount_capturable: 900, status: 'requires_capture', metadata: { post_trial_quote_id: quote.id } } } },
      schoolId: 1, learnerId: 2, paymentType: 'payment_intent',
    });
    expect(authorized).toMatchObject({ ok: true, fulfill: true, paymentState: 'authorized' });
    const captured = await preprocessPostTrialWebhook(sql, {
      event: { type: 'payment_intent.succeeded', created: 1789820000,
        data: { object: { id: 'pi_request', amount: 900, amount_received: 900, status: 'succeeded', metadata: { post_trial_quote_id: quote.id } } } },
      schoolId: 1, learnerId: 2, paymentType: 'payment_intent',
    });
    expect(captured).toMatchObject({ ok: true, fulfill: true, paymentState: 'paid' });
  });

  test('legacy direct and test-date slot dispatch use validated paid gross', async () => {
    for (const bookingPurpose of ['lesson', 'test_date']) {
      const event = { type: 'checkout.session.completed', data: { object: {
        id: `cs_${bookingPurpose}`, object: 'checkout.session', amount_total: 800, payment_status: 'paid',
        metadata: { post_trial_quote_id: 'q', school_id: '1', learner_id: '2', amount_pence: '1000', booking_purpose: bookingPurpose },
      } } };
      const checked = await prepareLegacyPostTrialEvent(event, 'slot_booking', {
        sql: async () => [],
        preprocess: async () => ({ ok: true, fulfill: true, monetary: {
          baseAmountPence: 1000, postTrialDiscountPence: 100, postTrialDiscountPct: 10,
          postTrialPricePence: 900, providerDiscountPence: 100, paidAmountPence: 800,
        } }),
      });
      expect(checked.proceed).toBe(true);
      expect(checked.object.metadata.amount_pence).toBe('800');
    }
  });

  test('legacy native PI and request dispatch preserve provider identity contracts', async () => {
    const seen = [];
    const preprocess = async (_sql, args) => {
      seen.push(args);
      return { ok: true, fulfill: args.event.type === 'payment_intent.succeeded', monetary: {
        baseAmountPence: 1000, postTrialDiscountPence: 100, postTrialDiscountPct: 10,
        postTrialPricePence: 900, providerDiscountPence: 0, paidAmountPence: 900,
      } };
    };
    const pi = type => ({ type, data: { object: { id: 'pi_1', object: 'payment_intent',
      metadata: { post_trial_quote_id: 'q', school_id: '1', learner_id: '2' } } } });
    expect((await prepareLegacyPostTrialEvent(pi('payment_intent.processing'), 'credit_purchase', { sql: async () => [], preprocess })).proceed).toBe(false);
    expect((await prepareLegacyPostTrialEvent(pi('payment_intent.succeeded'), 'credit_purchase', { sql: async () => [], preprocess })).proceed).toBe(true);
    await prepareLegacyPostTrialEvent(pi('payment_intent.succeeded'), 'lesson_request_hold', {
      sql: async () => [{ payment_identity: 'cs_request' }], preprocess,
    });
    expect(seen[2]).toMatchObject({ paymentIdentity: 'pi_1', useStoredPaymentIdentity: true });
  });

  test('request capture rejects a PaymentIntent not linked to the bound Checkout session', async () => {
    let preprocessCalled = false;
    const event = { type: 'payment_intent.succeeded', data: { object: {
      id: 'pi_attacker', object: 'payment_intent', metadata: {
        payment_type: 'lesson_request_hold', post_trial_quote_id: '00000000-0000-4000-8000-000000000008',
        school_id: '1', learner_id: '2',
      },
    } } };
    const checked = await prepareLegacyPostTrialEvent(event, 'lesson_request_hold', {
      sql: async () => [],
      preprocess: async () => { preprocessCalled = true; return { ok: true, fulfill: true }; },
    });
    expect(checked).toMatchObject({ proceed: false, result: {
      compensationRequired: true, code: 'POST_TRIAL_REQUEST_PAYMENT_IDENTITY_MISMATCH',
    } });
    expect(preprocessCalled).toBe(false);
  });

  test('amount mismatches are terminal while missing earlier initiation remains retryable', async () => {
    const paid = { type: 'payment_intent.succeeded', created: 1789820000, data: { object: {
      id: 'pi_late', amount: 899, amount_received: 899, metadata: { post_trial_quote_id: 'q' },
    } } };
    const quote = { final_amount_pence: 900, payment_type: 'payment_intent', payment_identity: 'pi_late',
      created_at: '2026-09-16T13:00:00Z', checkout_expires_at: '2026-09-16T13:30:00Z', provider_initiated_at: null };
    const amountSql = async parts => parts.join('?').includes('SELECT *') ? [quote] : [];
    const amountResult = await preprocessPostTrialWebhook(amountSql, {
      event: paid, schoolId: 1, learnerId: 2, paymentType: 'payment_intent', paymentIdentity: 'pi_late',
    });
    expect(amountResult).toMatchObject({ ok: false, code: 'POST_TRIAL_AMOUNT_MISMATCH' });
    expect(amountResult.retryable).toBeUndefined();
    paid.data.object.amount = paid.data.object.amount_received = 900;
    const historyResult = await preprocessPostTrialWebhook(amountSql, {
      event: paid, schoolId: 1, learnerId: 2, paymentType: 'payment_intent', paymentIdentity: 'pi_late',
    });
    expect(historyResult).toMatchObject({ ok: false, retryable: true, code: 'POST_TRIAL_INITIATION_HISTORY_REQUIRED' });
  });

  test('invalid paid legacy quote is retained for compensation and never fulfilled', async () => {
    const event = { type: 'checkout.session.completed', data: { object: { id: 'cs_expired', object: 'checkout.session',
      metadata: { post_trial_quote_id: 'q', school_id: '1', learner_id: '2' } } } };
    const checked = await prepareLegacyPostTrialEvent(event, 'slot_booking', {
      sql: async () => [],
      preprocess: async () => ({ ok: false, fulfill: false, compensationRequired: true, code: 'POST_TRIAL_QUOTE_MISMATCH' }),
    });
    expect(checked).toMatchObject({ proceed: false, result: { compensationRequired: true } });
  });

  test('webhook routes initiation events and delegates paid offers to canonical validation', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'webhook.js'), 'utf8');
    expect(source).toContain("event.type === 'payment_intent.processing'");
    expect(source).toContain("event.type === 'payment_intent.amount_capturable_updated'");
    expect(source).toContain('await handleOfferBooking(session, { ...paymentEventContext, stripeEvent: event })');
    expect(source).toContain('if (payoutV2Receipt.postTrialBlocked && offer.pencilled !== true) return;');
    expect(source).toContain("effective_rate_pence_per_minute: String(Math.round(result.monetary.paidAmountPence / pricedMinutes))");
  });

  test('revokes an uninitiated quote when its source trial is no longer valid', async () => {
    const quote = { id: '00000000-0000-4000-8000-000000000009', trial_booking_id: 77,
      final_amount_pence: 900, payment_type: 'payment_intent', payment_identity: 'pi_revoked',
      created_at: '2026-09-16T13:00:00Z', checkout_expires_at: '2026-09-16T13:30:00Z', provider_initiated_at: null };
    const sql = async parts => parts.join('?').includes('SELECT * FROM post_trial') ? [quote] : [];
    await expect(validatePostTrialQuote(sql, { quoteId: quote.id, schoolId: 1, learnerId: 2,
      amountPence: 900, paymentType: 'payment_intent', paymentIdentity: 'pi_revoked',
      providerInitiatedAt: '2026-09-16T13:10:00Z' }))
      .resolves.toMatchObject({ ok: false, code: 'POST_TRIAL_TRIAL_REVOKED' });
  });

  test('enabled Reserved Weekly Slot bank checkout quotes the whole block and allocates exact pennies', () => {
    const slots = fs.readFileSync(path.join(__dirname, '..', 'api', 'slots.js'), 'utf8');
    const webhook = fs.readFileSync(path.join(__dirname, '..', 'api', 'webhook.js'), 'utf8');
    expect(slots).toContain('amountPence: preview.pricing.requested_total_price_pence');
    expect(slots).toContain('allocateRecurringBlockPence');
    expect(slots).toContain('unit_amount: discountedTotalPence');
    expect(slots).toContain('quoteId: postTrialQuote.quoteId');
    expect(webhook).toContain("paymentType === 'recurring_block_bank_checkout'");
    expect(webhook).toContain('recurringCapture');
  });
});
