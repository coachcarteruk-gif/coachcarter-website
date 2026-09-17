const { test, expect } = require('@playwright/test');

process.env.STRIPE_SECRET_KEY ||= 'sk_test_webhook_pencil_fulfilment';

const {
  _fulfilPencilledOffer: fulfilPencilledOffer,
  _settleUnfulfilledPencilledOfferRefund: settleUnfulfilledPencilledOfferRefund,
} = require('../api/webhook');

function minutes(value) {
  const [hours, mins] = String(value).slice(0, 5).split(':').map(Number);
  return hours * 60 + mins;
}

function overlaps(leftStart, leftEnd, rightStart, rightEnd) {
  return minutes(leftStart) < minutes(rightEnd) && minutes(leftEnd) > minutes(rightStart);
}

function fulfilmentHarness({ status = 'pending', calendar = [] } = {}) {
  const state = {
    offer: {
      id: 91,
      status,
      learner_id: 22,
      school_id: 7,
      instructor_id: 12,
      scheduled_date: '2026-01-20',
      start_time: '10:00:00',
      end_time: '11:00:00',
      expires_at: '2026-01-18T10:00:00.000Z',
      stripe_session_id: 'cs_pencil',
      pencilled: true,
      booking_id: null,
      offer_price_pence: 5500,
      lesson_type_id: 4,
    },
    calendar,
    calls: [],
    bookings: 0,
    creditTransactions: 0,
    refundEvent: null,
  };

  const client = {
    async query(text, args = []) {
      const sql = String(text).replace(/\s+/g, ' ').trim();
      state.calls.push(sql);
      if (sql.startsWith('SELECT lock_pencilled_slot_day')) return { rows: [{ lock_pencilled_slot_day: null }], rowCount: 1 };
      if (sql.includes('FROM lesson_offers WHERE id=$1 AND school_id=$2 FOR UPDATE')) {
        return { rows: [{ ...state.offer }], rowCount: 1 };
      }
      if (sql.startsWith('SELECT source FROM (')) {
        const conflict = state.calendar.find(row =>
          row.school_id === args[0] && row.instructor_id === args[1] && row.date === args[2]
          && overlaps(row.start_time, row.end_time, args[3], args[4])
        );
        return { rows: conflict ? [{ source: conflict.source }] : [], rowCount: conflict ? 1 : 0 };
      }
      if (sql.startsWith('INSERT INTO refund_events')) {
        if (state.refundEvent) return { rows: [], rowCount: 0 };
        state.refundEvent = { id: 701, status: 'previewed', reason: args[5] };
        return { rows: [{ id: 701, status: 'previewed' }], rowCount: 1 };
      }
      if (sql.startsWith('SELECT id,status FROM refund_events')) {
        return { rows: state.refundEvent ? [{ ...state.refundEvent }] : [], rowCount: state.refundEvent ? 1 : 0 };
      }
      if (sql.startsWith("UPDATE lesson_offers SET status='cancelled'")) {
        state.offer.status = 'cancelled';
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("UPDATE lesson_offers SET status='accepted'")) {
        state.offer.status = 'accepted';
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith('INSERT INTO credit_transactions')) {
        state.creditTransactions += 1;
        return { rows: [{ id: 801 }], rowCount: 1 };
      }
      if (sql.startsWith('INSERT INTO lesson_bookings')) {
        state.bookings += 1;
        return { rows: [{ id: 901 }], rowCount: 1 };
      }
      if (sql.startsWith('INSERT INTO booking_credit_sources')) return { rows: [], rowCount: 1 };
      if (sql.startsWith('UPDATE lesson_offers SET booking_id=$1')) {
        state.offer.booking_id = args[0];
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };

  const transactionRunner = async (_connectionString, callback) => callback(client);
  const run = (overrides = {}) => fulfilPencilledOffer({
    session: {
      id: overrides.sessionId || 'cs_pencil',
      payment_intent: `pi_${overrides.sessionId || 'cs_pencil'}`,
      currency: 'gbp',
      total_details: { amount_discount: 0 },
    },
    offer: { ...state.offer },
    learnerId: 22,
    schoolId: 7,
    instructorId: 12,
    lessonTypeId: 4,
    durationMins: 60,
    pickupAddress: '1 Test Road',
    amountPence: 5500,
    fundingEvidence: { feePence: 170 },
    // The provider recorded success before the deadline even though this
    // fulfilment runs after the hold has elapsed.
    paymentSucceededAt: '2026-01-18T09:59:59.999Z',
    quoteValidation: { ok: true },
    transactionRunner,
    connectionString: 'postgresql://loopback-only/test',
  });

  return { state, run };
}

test.describe('pencilled-offer webhook fulfilment transaction', () => {
  test('compensates a delayed timely payment when a differently-started booking now overlaps', async () => {
    const harness = fulfilmentHarness({
      calendar: [{
        source: 'booking', school_id: 7, instructor_id: 12, date: '2026-01-20',
        start_time: '10:30', end_time: '11:30',
      }],
    });

    const result = await harness.run();

    expect(result).toMatchObject({
      applied: false,
      refundRequired: true,
      refundEventId: 701,
      reason: 'calendar_booking_overlap',
    });
    expect(harness.state.bookings).toBe(0);
    expect(harness.state.creditTransactions).toBe(0);
    expect(harness.state.offer.status).toBe('cancelled');
    expect(harness.state.calls.indexOf('SELECT lock_pencilled_slot_day($1,$2,$3::date)'))
      .toBeLessThan(harness.state.calls.findIndex(sql => sql.startsWith('SELECT source FROM (')));
  });

  test('treats adjacency as available and fulfils a delayed timely payment', async () => {
    const harness = fulfilmentHarness({
      calendar: [{
        source: 'booking', school_id: 7, instructor_id: 12, date: '2026-01-20',
        start_time: '11:00', end_time: '12:00',
      }],
    });

    const result = await harness.run();

    expect(result).toMatchObject({ applied: true, bookingId: 901, creditTransactionId: 801 });
    expect(harness.state.bookings).toBe(1);
    expect(harness.state.creditTransactions).toBe(1);
    expect(harness.state.offer.status).toBe('accepted');
  });

  test('duplicate paid delivery and cancellation/payment races remain one-outcome idempotent', async () => {
    const duplicate = fulfilmentHarness();
    expect(await duplicate.run()).toMatchObject({ applied: true, bookingId: 901 });
    expect(await duplicate.run()).toMatchObject({ applied: false, idempotent: true, bookingId: 901 });
    expect(duplicate.state.bookings).toBe(1);
    expect(duplicate.state.creditTransactions).toBe(1);

    const cancelled = fulfilmentHarness({ status: 'cancelled' });
    const first = await cancelled.run();
    const replay = await cancelled.run();
    expect(first).toMatchObject({ refundRequired: true, refundEventId: 701, reason: 'offer_cancelled' });
    expect(replay).toMatchObject({ refundRequired: true, refundEventId: 701, reason: 'offer_cancelled' });
    expect(cancelled.state.bookings).toBe(0);
    expect(cancelled.state.creditTransactions).toBe(0);
  });
});

test('pencilled compensation retains a failed refund and retries with the same provider key', async () => {
  const state = { status: 'previewed', stripeRefundId: null, sqlUpdates: 0 };
  const sql = async (parts, ...values) => {
    const text = parts.join('?');
    if (text.includes("UPDATE refund_events SET status='manual_review'")) {
      state.status = 'manual_review';
      state.sqlUpdates += 1;
      return [];
    }
    throw new Error(`Unexpected tagged SQL: ${text} / ${values.length}`);
  };
  const keys = [];
  let refundAttempts = 0;
  const stripeClient = { refunds: { create: async (_payload, options) => {
    keys.push(options.idempotencyKey);
    refundAttempts += 1;
    if (refundAttempts === 1) throw Object.assign(new Error('temporary provider failure'), { code: 'api_error' });
    return { id: 're_pencil', status: 'succeeded' };
  } } };
  const client = { query: async (text, args) => {
    const normal = String(text).replace(/\s+/g, ' ').trim();
    if (normal.startsWith('SELECT status FROM refund_events')) {
      return { rows: [{ status: state.status }], rowCount: 1 };
    }
    if (normal.startsWith('UPDATE refund_events SET status=')) {
      state.status = 'executed';
      state.stripeRefundId = args[0];
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unexpected transaction SQL: ${normal}`);
  } };
  const transactionRunner = async (_connectionString, callback) => callback(client);
  const input = {
    sql,
    session: { id: 'cs_retry' },
    result: {
      refundEventStatus: 'previewed', refundEventId: 702, schoolId: 7,
      learnerId: 22, amountPence: 5500, paymentIntentId: 'pi_retry', bookingId: null,
    },
    stripeClient,
    transactionRunner,
    connectionString: 'postgresql://loopback-only/test',
  };

  await expect(settleUnfulfilledPencilledOfferRefund(input)).rejects.toThrow('temporary provider failure');
  expect(state).toMatchObject({ status: 'manual_review', sqlUpdates: 1 });
  await settleUnfulfilledPencilledOfferRefund({ ...input, result: { ...input.result, refundEventStatus: state.status } });
  expect(state).toMatchObject({ status: 'executed', stripeRefundId: 're_pencil' });
  expect(keys).toEqual(['pencilled_offer_unfulfilled_cs_retry', 'pencilled_offer_unfulfilled_cs_retry']);
});

test('pencilled compensation lazily constructs a refund-scoped Stripe client by default', async () => {
  const stripeClientsPath = require.resolve('../api/_stripe-clients');
  const webhookPath = require.resolve('../api/webhook');
  const originalStripeClients = require.cache[stripeClientsPath];
  const originalWebhook = require.cache[webhookPath];
  const purposes = [];
  const refundCalls = [];
  const reconciliationClient = {
    refunds: { create: async () => { throw new Error('reconciliation client must not issue refunds'); } },
  };
  const refundClient = {
    refunds: { create: async (payload, options) => {
      refundCalls.push({ payload, options });
      return { id: 're_scoped', status: 'succeeded' };
    } },
  };

  try {
    require.cache[stripeClientsPath] = {
      id: stripeClientsPath,
      filename: stripeClientsPath,
      loaded: true,
      exports: {
        STRIPE_CLIENT_PURPOSES: { RECONCILIATION: 'reconciliation', REFUNDS: 'refunds' },
        createPlatformStripeClient({ purpose }) {
          purposes.push(purpose);
          return purpose === 'refunds' ? refundClient : reconciliationClient;
        },
      },
    };
    delete require.cache[webhookPath];
    const freshWebhook = require('../api/webhook');
    const state = { status: 'previewed' };
    const transactionRunner = async (_connectionString, callback) => callback({
      async query(text, args) {
        const normal = String(text).replace(/\s+/g, ' ').trim();
        if (normal.startsWith('SELECT status FROM refund_events')) {
          return { rows: [{ status: state.status }], rowCount: 1 };
        }
        if (normal.startsWith('UPDATE refund_events SET status=')) {
          state.status = 'executed';
          state.stripeRefundId = args[0];
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`Unexpected transaction SQL: ${normal}`);
      },
    });

    await freshWebhook._settleUnfulfilledPencilledOfferRefund({
      sql: async () => { throw new Error('tagged SQL is not expected for a successful refund'); },
      session: { id: 'cs_refund_scope' },
      result: {
        refundEventStatus: 'previewed', refundEventId: 703, schoolId: 7,
        learnerId: 22, amountPence: 5500, paymentIntentId: 'pi_refund_scope', bookingId: null,
      },
      transactionRunner,
      connectionString: 'postgresql://loopback-only/test',
    });

    expect(purposes).toEqual(['reconciliation', 'refunds']);
    expect(refundCalls).toHaveLength(1);
    expect(refundCalls[0].options.idempotencyKey).toBe('pencilled_offer_unfulfilled_cs_refund_scope');
    expect(state).toMatchObject({ status: 'executed', stripeRefundId: 're_scoped' });
  } finally {
    if (originalStripeClients) require.cache[stripeClientsPath] = originalStripeClients;
    else delete require.cache[stripeClientsPath];
    if (originalWebhook) require.cache[webhookPath] = originalWebhook;
    else delete require.cache[webhookPath];
  }
});
