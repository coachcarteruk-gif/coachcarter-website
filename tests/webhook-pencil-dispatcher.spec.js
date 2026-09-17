const { test, expect } = require('@playwright/test');
const { Readable } = require('stream');

process.env.STRIPE_SECRET_KEY ||= 'sk_test_webhook_pencil_dispatcher';
process.env.STRIPE_WEBHOOK_SECRET ||= 'whsec_webhook_pencil_dispatcher';
process.env.POSTGRES_URL ||= 'postgresql://loopback-only/webhook-pencil';

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
  };
}

function createRequest() {
  const req = Readable.from(['{}']);
  req.method = 'POST';
  req.headers = { 'stripe-signature': 'signed-test-event' };
  return req;
}

function loadDispatcherHarness({
  paid = true,
  pencilled = true,
  refundFails = 0,
  metadataMode = 'valid',
  shadowEnabled = false,
} = {}) {
  const state = {
    offer: {
      id: 91,
      token: 'token_dispatch_pencil',
      status: 'pending',
      booking_id: null,
      learner_id: 22,
      school_id: 7,
      instructor_id: 12,
      extension_booking_id: null,
      extension_minutes: null,
      extension_base_list_price_pence: null,
      offer_price_pence: 5500,
      scheduled_date: '2026-01-20',
      start_time: '10:00:00',
      end_time: '11:00:00',
      stripe_session_id: 'cs_dispatch_pencil',
      expires_at: '2026-01-18T10:00:00.000Z',
      pencilled,
      lesson_type_id: 4,
    },
    refundEvent: null,
    refundCalls: [],
    preprocessCalls: [],
    reportErrors: [],
    creditTransactions: 0,
    bookings: 0,
    receiptClaims: [],
    receiptProcessed: [],
    receiptFailed: [],
    shadowSchoolIds: [],
  };
  let receiptStatus = null;
  let failuresRemaining = refundFails;
  let currentEvent = {
    id: 'evt_dispatch_pencil',
    type: 'checkout.session.completed',
    created: Date.parse('2026-01-18T09:59:59.000Z') / 1000,
    livemode: false,
    data: { object: {
      id: 'cs_dispatch_pencil',
      object: 'checkout.session',
      payment_status: paid ? 'paid' : 'unpaid',
      amount_total: 5500,
      currency: 'gbp',
      payment_intent: 'pi_dispatch_pencil',
      total_details: { amount_discount: 0 },
      customer_email: 'learner@example.test',
      metadata: {
        payment_type: 'lesson_offer',
        offer_token: 'token_dispatch_pencil',
        offer_id: '91',
        instructor_id: '12',
        instructor_name: 'Instructor',
        lesson_type_id: '4',
        duration_minutes: '60',
        scheduled_date: '2026-01-20',
        start_time: '10:00',
        end_time: '11:00',
        learner_email: 'learner@example.test',
        post_trial_quote_id: '00000000-0000-4000-8000-000000000091',
        // Deliberately omit school_id and learner_id. The handler must derive
        // them from the canonical offer before validating the paid quote.
      },
    } },
  };
  if (metadataMode === 'missing') {
    currentEvent.data.object.metadata = { payment_type: 'lesson_offer' };
  } else if (metadataMode === 'contradictory') {
    Object.assign(currentEvent.data.object.metadata, {
      offer_token: 'token_for_another_offer',
      offer_id: '999',
      school_id: '7',
      instructor_id: '999',
      learner_id: '22',
    });
  }

  const sql = async (parts, ...values) => {
    const text = parts.join('?').replace(/\s+/g, ' ').trim();
    if (text.includes('FROM lesson_offers offer') && text.includes('JOIN instructors instructor')) {
      return pencilled ? [{ id: state.offer.id, school_id: state.offer.school_id }] : [];
    }
    if (text.includes('FROM lesson_offers o') && text.includes('JOIN instructors i')) {
      return [];
    }
    if (text.includes('SELECT id, status, booking_id, learner_id, school_id FROM lesson_offers')) {
      return [{
        id: state.offer.id,
        status: state.offer.status,
        booking_id: state.offer.booking_id,
        learner_id: state.offer.learner_id,
        school_id: state.offer.school_id,
      }];
    }
    if (text.includes('SELECT instructor_id, extension_booking_id, extension_minutes')) {
      return [{ ...state.offer }];
    }
    if (text.includes('SELECT id FROM learner_users') && text.includes('school_id')) {
      return [{ id: state.offer.learner_id }];
    }
    if (text.includes('SELECT id, name, email, phone, pickup_address') && text.includes('FROM learner_users')) {
      return [{ id: 22, name: 'Learner', email: 'learner@example.test', phone: null, pickup_address: null }];
    }
    if (text.includes("UPDATE refund_events SET status='manual_review'")) {
      state.refundEvent.status = 'manual_review';
      state.refundEvent.metadata = { refund_error: 'temporary refund failure' };
      return [];
    }
    throw new Error(`Unexpected tagged SQL: ${text} / ${values.length}`);
  };

  const transactionClient = {
    async query(text, args = []) {
      const normal = String(text).replace(/\s+/g, ' ').trim();
      if (normal.startsWith('SELECT lock_pencilled_slot_day')) return { rows: [{}], rowCount: 1 };
      if (normal.includes('FROM lesson_offers WHERE id=$1 AND school_id=$2 FOR UPDATE')) {
        return { rows: [{ ...state.offer }], rowCount: 1 };
      }
      if (normal.startsWith('SELECT source FROM (')) return { rows: [], rowCount: 0 };
      if (normal.startsWith('INSERT INTO refund_events')) {
        if (state.refundEvent) return { rows: [], rowCount: 0 };
        state.refundEvent = { id: 701, status: 'previewed', stripe_refund_id: null };
        return { rows: [{ id: 701, status: 'previewed' }], rowCount: 1 };
      }
      if (normal.startsWith('SELECT id,status FROM refund_events')) {
        return { rows: [{ id: 701, status: state.refundEvent.status }], rowCount: 1 };
      }
      if (normal.startsWith("UPDATE lesson_offers SET status='cancelled'")) {
        if (state.offer.status === 'pending') state.offer.status = 'cancelled';
        return { rows: [], rowCount: 1 };
      }
      if (normal.startsWith('SELECT status FROM refund_events')) {
        return { rows: [{ status: state.refundEvent.status }], rowCount: 1 };
      }
      if (normal.startsWith('UPDATE refund_events SET status=')) {
        state.refundEvent.status = 'executed';
        state.refundEvent.stripe_refund_id = args[0];
        return { rows: [], rowCount: 1 };
      }
      if (normal.startsWith("UPDATE lesson_offers SET status='accepted'")) {
        state.offer.status = 'accepted';
        return { rows: [], rowCount: 1 };
      }
      if (normal.startsWith('INSERT INTO credit_transactions')) {
        state.creditTransactions += 1;
        return { rows: [{ id: 801 }], rowCount: 1 };
      }
      if (normal.startsWith('INSERT INTO lesson_bookings')) {
        state.bookings += 1;
        return { rows: [{ id: 901 }], rowCount: 1 };
      }
      if (normal.startsWith('INSERT INTO booking_credit_sources')) return { rows: [], rowCount: 1 };
      if (normal.startsWith('UPDATE lesson_offers SET booking_id=')) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected transaction SQL: ${normal}`);
    },
  };

  const fakeStripe = {
    webhooks: { constructEvent: () => currentEvent },
    refunds: { create: async (_payload, options) => {
      state.refundCalls.push(options.idempotencyKey);
      if (failuresRemaining > 0) {
        failuresRemaining -= 1;
        throw Object.assign(new Error('temporary refund failure'), { code: 'api_error' });
      }
      return { id: 're_dispatch_pencil', status: 'succeeded' };
    } },
  };

  const replacements = new Map();
  function replace(request, exports) {
    const resolved = require.resolve(request);
    replacements.set(resolved, require.cache[resolved]);
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
  }

  replace('../api/_stripe-clients', {
    createPlatformStripeClient: () => fakeStripe,
    STRIPE_CLIENT_PURPOSES: { RECONCILIATION: 'reconciliation', REFUNDS: 'refunds' },
  });
  replace('@neondatabase/serverless', { neon: () => sql });
  replace('../api/_post-trial-webhook', {
    preprocessPostTrialWebhook: async (_sql, input) => {
      state.preprocessCalls.push(input);
      if (!paid) return { hasQuote: true, ok: true, fulfill: false, paymentState: 'processing' };
      return {
        hasQuote: true,
        ok: false,
        fulfill: false,
        compensationRequired: true,
        code: 'POST_TRIAL_QUOTE_MISMATCH',
      };
    },
  });
  replace('../api/_db-transaction', {
    withNeonTransaction: async (_connectionString, callback) => callback(transactionClient),
  });
  replace('../api/_stripe-fee', {
    fetchSessionFeePence: async () => 170,
    fetchSessionFundingEvidence: async () => ({ feePence: 170, chargeId: 'ch_dispatch' }),
  });
  replace('../api/_error-alert', { reportError: (path, error) => state.reportErrors.push({ path, error }) });
  replace('../api/_stripe-event-receipts', {
    claimStripeEventReceipt: async input => {
      state.receiptClaims.push(input);
      if (receiptStatus === 'processed') return { claimed: false, status: 'processed' };
      receiptStatus = 'processing';
      return { claimed: true, status: 'processing' };
    },
    markStripeEventProcessed: async input => {
      state.receiptProcessed.push(input);
      receiptStatus = 'processed';
    },
    markStripeEventFailed: async input => {
      state.receiptFailed.push(input);
      receiptStatus = 'failed';
    },
  });
  replace('../api/_stripe-launch-payment-contracts', {
    PAYMENT_ORIGINS: { ONE_OFF_OFFER: 'one_off_offer' },
    loadShadowLaunchConfig: async (_sql, schoolId) => {
      state.shadowSchoolIds.push(schoolId);
      return shadowEnabled ? { mode: 'shadow' } : null;
    },
    materializeLaunchPaymentContract: async () => ({ disabled: true }),
    isStripeLaunchSchemaUnavailable: () => false,
  });

  const webhookPath = require.resolve('../api/webhook');
  replacements.set(webhookPath, require.cache[webhookPath]);
  delete require.cache[webhookPath];
  const handler = require('../api/webhook');

  return {
    state,
    setEvent(event) { currentEvent = event; },
    async dispatch() {
      const res = createResponse();
      await handler(createRequest(), res);
      return res;
    },
    restore() {
      for (const [resolved, cached] of replacements) {
        if (cached) require.cache[resolved] = cached;
        else delete require.cache[resolved];
      }
    },
  };
}

test.describe('actual webhook dispatcher pencilled compensation routing', () => {
  test('uses canonical scope, retains refund failure, retries idempotently, and no-ops duplicates', async () => {
    const harness = loadDispatcherHarness({ refundFails: 1, shadowEnabled: true });
    try {
      const first = await harness.dispatch();
      expect(first.statusCode).toBe(500);
      expect(harness.state.preprocessCalls[0]).toMatchObject({ schoolId: 7, learnerId: 22 });
      expect(harness.state.refundEvent).toMatchObject({ id: 701, status: 'manual_review' });
      expect(harness.state.bookings).toBe(0);
      expect(harness.state.creditTransactions).toBe(0);
      expect(harness.state.shadowSchoolIds).toEqual([7]);
      expect(harness.state.receiptFailed).toHaveLength(1);
      expect(harness.state.receiptProcessed).toHaveLength(0);

      const retry = await harness.dispatch();
      expect(retry.statusCode).toBe(200);
      expect(harness.state.refundEvent).toMatchObject({ status: 'executed', stripe_refund_id: 're_dispatch_pencil' });
      expect(harness.state.refundCalls).toEqual([
        'pencilled_offer_unfulfilled_cs_dispatch_pencil',
        'pencilled_offer_unfulfilled_cs_dispatch_pencil',
      ]);
      expect(harness.state.receiptFailed).toHaveLength(1);
      expect(harness.state.receiptProcessed).toHaveLength(1);

      const duplicate = await harness.dispatch();
      expect(duplicate.statusCode).toBe(200);
      expect(duplicate.body).toMatchObject({ received: true, duplicate: true });
      expect(harness.state.refundCalls).toHaveLength(2);
      expect(harness.state.receiptClaims).toHaveLength(3);
      expect(harness.state.receiptProcessed).toHaveLength(1);
    } finally {
      harness.restore();
    }
  });

  test('keeps unpaid quote initiation separate from fulfilment and compensation', async () => {
    const harness = loadDispatcherHarness({ paid: false });
    try {
      const response = await harness.dispatch();
      expect(response.statusCode).toBe(200);
      expect(harness.state.preprocessCalls).toHaveLength(1);
      expect(harness.state.refundEvent).toBeNull();
      expect(harness.state.refundCalls).toEqual([]);
      expect(harness.state.bookings).toBe(0);
    } finally {
      harness.restore();
    }
  });

  test('does not broaden terminal quote compensation to an ordinary offer', async () => {
    const harness = loadDispatcherHarness({ pencilled: false });
    try {
      const response = await harness.dispatch();
      expect(response.statusCode).toBe(200);
      expect(harness.state.preprocessCalls).toHaveLength(1);
      expect(harness.state.refundEvent).toBeNull();
      expect(harness.state.refundCalls).toEqual([]);
      expect(harness.state.bookings).toBe(0);
      expect(harness.state.creditTransactions).toBe(0);
    } finally {
      harness.restore();
    }
  });

  test('does not broaden contradictory-metadata compensation to an ordinary offer', async () => {
    const harness = loadDispatcherHarness({ pencilled: false, metadataMode: 'contradictory' });
    try {
      const response = await harness.dispatch();
      expect(response.statusCode).toBe(200);
      expect(harness.state.offer.status).toBe('pending');
      expect(harness.state.refundEvent).toBeNull();
      expect(harness.state.refundCalls).toEqual([]);
      expect(harness.state.bookings).toBe(0);
      expect(harness.state.creditTransactions).toBe(0);
    } finally {
      harness.restore();
    }
  });

  test('keeps enabled-shadow receipt scope strict for an ordinary contradictory offer', async () => {
    const harness = loadDispatcherHarness({
      pencilled: false,
      metadataMode: 'contradictory',
      shadowEnabled: true,
    });
    try {
      const response = await harness.dispatch();
      expect(response.statusCode).toBe(500);
      expect(harness.state.shadowSchoolIds).toEqual([7]);
      expect(harness.state.receiptClaims).toHaveLength(0);
      expect(harness.state.refundEvent).toBeNull();
      expect(harness.state.refundCalls).toEqual([]);
      expect(harness.state.offer.status).toBe('pending');
    } finally {
      harness.restore();
    }
  });

  for (const metadataMode of ['missing', 'contradictory']) {
    test(`canonically resolves and compensates paid pencilled ${metadataMode} advisory metadata`, async () => {
      const harness = loadDispatcherHarness({ metadataMode, shadowEnabled: true });
      try {
        const response = await harness.dispatch();
        expect(response.statusCode).toBe(200);
        expect(harness.state.offer.status).toBe('cancelled');
        expect(harness.state.refundEvent).toMatchObject({
          id: 701,
          status: 'executed',
          stripe_refund_id: 're_dispatch_pencil',
        });
        expect(harness.state.refundCalls).toEqual([
          'pencilled_offer_unfulfilled_cs_dispatch_pencil',
        ]);
        expect(harness.state.bookings).toBe(0);
        expect(harness.state.creditTransactions).toBe(0);
        expect(harness.state.preprocessCalls).toHaveLength(0);
        expect(harness.state.shadowSchoolIds).toEqual([7]);
        expect(harness.state.receiptProcessed).toHaveLength(1);
        expect(harness.state.receiptFailed).toHaveLength(0);
      } finally {
        harness.restore();
      }
    });
  }
});
