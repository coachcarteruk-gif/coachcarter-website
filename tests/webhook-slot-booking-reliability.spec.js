// @ts-check
const { test, expect } = require('@playwright/test');
const path = require('path');
const { Readable } = require('stream');

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY
  || 'sk_test_webhook_slot_reliability';
process.env.POSTGRES_URL = process.env.POSTGRES_URL || 'postgres://mock';

const repoRoot = path.resolve(__dirname, '..');

function eventFixture() {
  return {
    id: 'evt_slot_reliability',
    type: 'checkout.session.completed',
    livemode: false,
    data: {
      object: {
        id: 'cs_slot_reliability',
        object: 'checkout.session',
        payment_status: 'paid',
        payment_intent: 'pi_slot_reliability',
        metadata: {
          payment_type: 'slot_booking',
          school_id: '1',
          learner_id: '10',
          instructor_id: '20',
          learner_email: 'learner@example.test',
          instructor_name: 'Test Instructor',
          scheduled_date: '2026-08-10',
          start_time: '10:00',
          end_time: '11:30',
          duration_minutes: '90',
          charge_minutes: '90',
          amount_pence: '8250',
          transmission_type: 'manual',
          payment_contract_candidate_id: '11111111-1111-4111-8111-111111111111',
          payment_contract_schema_version: 'simon_launch_payment_v1',
          payment_origin: 'direct_slot',
        },
      },
    },
  };
}

function createState(overrides = {}) {
  const state = {
    event: eventFixture(),
    receiptStatus: null,
    receiptProcessed: 0,
    receiptFailed: 0,
    creditTransactions: [],
    bookings: [],
    bookingCreditSources: [],
    payoutSources: [],
    paymentContracts: [],
    notificationAttempts: [],
    sendAttempts: [],
    reports: [],
    balanceAdjustments: [],
    failPurposes: new Set(),
    coreFailure: null,
    bookingInsertError: null,
    materializationResults: [],
    testBookedUpdates: 0,
    ...overrides,
  };

  state.sql = async (strings, ...values) => {
    const query = strings.join(' ').replace(/\s+/g, ' ').trim();

    if (query.includes('FROM learner_users lu') && query.includes('JOIN instructors i')) {
      return [{ ok: 1 }];
    }
    if (query.includes('FROM credit_transactions') && query.includes("type = 'slot_purchase'")) {
      return state.creditTransactions.slice();
    }
    if (query.includes('INSERT INTO credit_transactions')) {
      const row = {
        id: 101,
        amount_pence: 8250,
        stripe_fee_pence: 250,
        effective_rate_pence_per_minute: 92,
      };
      state.creditTransactions.push(row);
      return [row];
    }
    if (query.includes('INSERT INTO lesson_bookings')) {
      if (state.bookingInsertError) throw state.bookingInsertError;
      const row = {
        id: 201,
        status: 'scheduled',
        scheduled_date: '2026-08-10',
        start_time: '10:00:00',
        end_time: '11:30:00',
      };
      state.bookings.push(row);
      return [row];
    }
    if (query.includes('FROM lesson_bookings') && query.includes('ORDER BY id DESC')) {
      return state.bookings.slice().reverse();
    }
    if (query.includes('INSERT INTO booking_credit_sources')) {
      if (!state.bookingCreditSources.length) {
        state.bookingCreditSources.push({ booking_id: 201, credit_transaction_id: 101 });
      }
      return [];
    }
    if (query.includes('SELECT email, phone FROM instructors')) {
      return [{ email: 'instructor@example.test', phone: null }];
    }
    if (query.includes('SELECT name, email, phone FROM learner_users')) {
      return [{ name: 'Test Learner', email: 'learner@example.test', phone: null }];
    }
    if (query.includes('DELETE FROM slot_reservations')) return [];
    if (query.includes('SET test_instructor_booked = TRUE')) {
      state.testBookedUpdates += 1;
      return [];
    }
    return [];
  };

  return state;
}

function loadWebhook(state) {
  const files = {
    webhook: path.join(repoRoot, 'api', 'webhook.js'),
    stripeClients: path.join(repoRoot, 'api', '_stripe-clients.js'),
    stripeFee: path.join(repoRoot, 'api', '_stripe-fee.js'),
    creditGrant: path.join(repoRoot, 'api', '_credit-grant.js'),
    dbTransaction: path.join(repoRoot, 'api', '_db-transaction.js'),
    receipts: path.join(repoRoot, 'api', '_stripe-event-receipts.js'),
    launchContracts: path.join(repoRoot, 'api', '_stripe-launch-payment-contracts.js'),
    authHelpers: path.join(repoRoot, 'api', '_auth-helpers.js'),
    notificationLog: path.join(repoRoot, 'api', '_notification-log.js'),
    errorAlert: path.join(repoRoot, 'api', '_error-alert.js'),
    whatsApp: path.join(repoRoot, 'api', '_whatsapp.js'),
    availability: path.join(repoRoot, 'api', '_notify-availability.js'),
  };
  const moduleIds = ['@neondatabase/serverless', ...Object.values(files)];
  const originals = new Map();

  for (const moduleId of moduleIds) {
    const resolved = require.resolve(moduleId);
    originals.set(resolved, require.cache[resolved]);
    delete require.cache[resolved];
  }

  require.cache[require.resolve('@neondatabase/serverless')] = {
    exports: { neon: () => state.sql },
  };
  require.cache[require.resolve(files.stripeClients)] = {
    exports: {
      STRIPE_CLIENT_PURPOSES: { RECONCILIATION: 'reconciliation' },
      createPlatformStripeClient: () => ({
        webhooks: { constructEvent: () => state.event },
      }),
    },
  };
  require.cache[require.resolve(files.stripeFee)] = {
    exports: {
      fetchSessionFeePence: async () => ({ feePence: 250, source: 'balance_transaction' }),
      fetchSessionFundingEvidence: async () => ({
        checkoutSessionId: 'cs_slot_reliability',
        paymentIntentId: 'pi_slot_reliability',
        chargeId: 'ch_slot_reliability',
        balanceTransactionId: 'txn_slot_reliability',
        amountPence: 8250,
        currency: 'gbp',
        feePence: 250,
        source: 'balance_transaction',
      }),
    },
  };
  require.cache[require.resolve(files.creditGrant)] = {
    exports: {
      grantCredits: async () => ({ ok: true }),
      lockBalanceAdjustLCB: async (_sql, args) => {
        state.balanceAdjustments.push(args.delta);
        return { ok: true, balance_minutes: 0 };
      },
    },
  };
  require.cache[require.resolve(files.dbTransaction)] = {
    exports: {
      withNeonTransaction: async (_options, callback) => callback({
        query: async text => {
          if (text.includes('INSERT INTO lesson_bookings')) {
            if (state.bookingInsertError) throw state.bookingInsertError;
            const row = {
              id: 201,
              status: 'scheduled',
              scheduled_date: '2026-08-10',
              start_time: '10:00:00',
              end_time: '11:30:00',
            };
            state.bookings.push(row);
            return { rows: [row] };
          }
          return { rows: [] };
        },
      }),
    },
  };
  require.cache[require.resolve(files.receipts)] = {
    exports: {
      claimStripeEventReceipt: async () => {
        if (state.receiptStatus === 'processed') return { claimed: false };
        state.receiptStatus = 'processing';
        return { claimed: true };
      },
      markStripeEventProcessed: async () => {
        state.receiptStatus = 'processed';
        state.receiptProcessed += 1;
      },
      markStripeEventFailed: async () => {
        state.receiptStatus = 'failed';
        state.receiptFailed += 1;
      },
    },
  };
  require.cache[require.resolve(files.launchContracts)] = {
    exports: {
      PAYMENT_ORIGINS: {
        DIRECT_SLOT: 'direct_slot',
        TEST_DATE_DIRECT: 'test_date_direct',
        CAPTURED_REQUEST: 'captured_request',
      },
      loadShadowLaunchConfig: async () => ({ enabled: true }),
      materializeLaunchPaymentContract: async (args) => {
        if (state.coreFailure) throw state.coreFailure;
        const result = state.materializationResults.length
          ? state.materializationResults.shift()
          : {
            enabled: true,
            candidate: true,
            materialized: true,
            created: true,
            contract: { evidence_status: 'complete' },
          };
        if (result.materialized) {
          if (!state.payoutSources.length) {
            state.payoutSources.push({ credit_transaction_id: args.creditTransactionId });
          }
          if (!state.paymentContracts.length) {
            state.paymentContracts.push({
              booking_id: args.bookingId,
              payment_origin: args.expectedOrigin,
              evidence_status: result.contract?.evidence_status || 'complete',
            });
          }
        }
        return result;
      },
      isStripeLaunchSchemaUnavailable: () => false,
    },
  };
  require.cache[require.resolve(files.authHelpers)] = {
    exports: {
      createTransporter: () => ({
        sendMail: async options => {
          const purpose = options?._log?.purpose || 'other';
          state.sendAttempts.push(purpose);
          const failed = state.failPurposes.has(purpose);
          state.notificationAttempts.push({
            purpose,
            delivery_status: failed ? 'failed' : 'sent',
          });
          if (failed) {
            const err = new Error('SMTP password=must-not-reach-reporting');
            err.code = 'ESOCKET';
            throw err;
          }
          return { accepted: [options.to] };
        },
      }),
    },
  };
  require.cache[require.resolve(files.notificationLog)] = {
    exports: {
      logNotification: async entry => state.notificationAttempts.push(entry),
    },
  };
  require.cache[require.resolve(files.errorAlert)] = {
    exports: {
      reportError: (endpoint, error) => state.reports.push({ endpoint, message: error.message }),
    },
  };
  require.cache[require.resolve(files.whatsApp)] = {
    exports: { sendWhatsApp: () => Promise.resolve(false) },
  };
  require.cache[require.resolve(files.availability)] = {
    exports: { supersedeBroadcastSiblings: () => Promise.resolve() },
  };

  let webhook;
  try {
    webhook = require(files.webhook);
  } finally {
    for (const moduleId of moduleIds) {
      const resolved = require.resolve(moduleId);
      // handleSlotBooking loads this module lazily after webhook import. Keep
      // the no-op fixture installed for this dedicated worker process.
      if (resolved === require.resolve(files.availability)) continue;
      const original = originals.get(resolved);
      if (original) require.cache[resolved] = original;
      else delete require.cache[resolved];
    }
  }
  return webhook;
}

async function callWebhook(webhook) {
  const req = Readable.from(['{}']);
  req.method = 'POST';
  req.headers = { 'stripe-signature': 'test_signature' };
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
  };
  await webhook(req, res);
  return res;
}

test.describe('slot-booking webhook post-commit reliability', () => {
  test('SMTP failure returns 200, processes the receipt, and a retry creates no duplicates', async () => {
    const state = createState();
    state.failPurposes.add('booking.slot_confirmation_learner');
    const webhook = loadWebhook(state);

    const first = await callWebhook(webhook);

    expect(first.statusCode).toBe(200);
    expect(first.body).toEqual({ received: true });
    expect(state.receiptStatus).toBe('processed');
    expect(state.receiptProcessed).toBe(1);
    expect(state.receiptFailed).toBe(0);
    expect(state.creditTransactions).toHaveLength(1);
    expect(state.bookings).toHaveLength(1);
    expect(state.bookingCreditSources).toHaveLength(1);
    expect(state.payoutSources).toHaveLength(1);
    expect(state.paymentContracts).toEqual([
      { booking_id: 201, payment_origin: 'direct_slot', evidence_status: 'complete' },
    ]);
    expect(state.notificationAttempts).toEqual([
      { purpose: 'booking.slot_confirmation_learner', delivery_status: 'failed' },
      { purpose: 'booking.slot_confirmation_instructor', delivery_status: 'sent' },
    ]);
    expect(state.sendAttempts).toEqual([
      'booking.slot_confirmation_learner',
      'booking.slot_confirmation_instructor',
    ]);
    expect(state.reports).toHaveLength(1);
    expect(state.reports[0].message).toContain('Error/ESOCKET');
    expect(state.reports[0].message).not.toContain('must-not-reach-reporting');

    const retry = await callWebhook(webhook);

    expect(retry.statusCode).toBe(200);
    expect(retry.body).toEqual({ received: true, duplicate: true });
    expect(state.creditTransactions).toHaveLength(1);
    expect(state.bookings).toHaveLength(1);
    expect(state.bookingCreditSources).toHaveLength(1);
    expect(state.payoutSources).toHaveLength(1);
    expect(state.paymentContracts).toHaveLength(1);
    expect(state.sendAttempts).toHaveLength(2);
  });

  test('missing launch evidence retries materialization without duplicating core rows or notifications', async () => {
    const event = eventFixture();
    event.data.object.metadata.booking_purpose = 'test_date';
    event.data.object.metadata.payment_origin = 'test_date_direct';
    event.data.object.metadata.test_time = '10:45';
    event.data.object.metadata.test_centre = 'Reading Test Centre';
    const state = createState({
      event,
      materializationResults: [
        {
          enabled: true,
          candidate: true,
          materialized: false,
          status: 'pending',
          reasons: ['missing_stripe_fee_evidence'],
        },
        {
          enabled: true,
          candidate: true,
          materialized: true,
          created: true,
          contract: { evidence_status: 'complete' },
        },
      ],
    });
    const webhook = loadWebhook(state);

    const first = await callWebhook(webhook);
    expect(first.statusCode).toBe(500);
    expect(state.receiptStatus).toBe('failed');
    expect(state.receiptFailed).toBe(1);
    expect(state.creditTransactions).toHaveLength(1);
    expect(state.bookings).toHaveLength(1);
    expect(state.bookingCreditSources).toHaveLength(1);
    expect(state.payoutSources).toHaveLength(0);
    expect(state.paymentContracts).toHaveLength(0);
    expect(state.testBookedUpdates).toBe(1);
    expect(state.sendAttempts).toEqual([
      'booking.slot_confirmation_learner',
      'booking.slot_confirmation_instructor',
    ]);

    const retry = await callWebhook(webhook);
    expect(retry.statusCode).toBe(200);
    expect(retry.body).toEqual({ received: true });
    expect(state.receiptStatus).toBe('processed');
    expect(state.receiptProcessed).toBe(1);
    expect(state.creditTransactions).toHaveLength(1);
    expect(state.bookings).toHaveLength(1);
    expect(state.bookingCreditSources).toHaveLength(1);
    expect(state.payoutSources).toHaveLength(1);
    expect(state.paymentContracts).toEqual([
      { booking_id: 201, payment_origin: 'test_date_direct', evidence_status: 'complete' },
    ]);
    expect(state.testBookedUpdates).toBe(1);
    expect(state.sendAttempts).toHaveLength(2);

    const duplicate = await callWebhook(webhook);
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.body).toEqual({ received: true, duplicate: true });
    expect(state.creditTransactions).toHaveLength(1);
    expect(state.bookings).toHaveLength(1);
    expect(state.bookingCreditSources).toHaveLength(1);
    expect(state.payoutSources).toHaveLength(1);
    expect(state.paymentContracts).toHaveLength(1);
    expect(state.testBookedUpdates).toBe(1);
    expect(state.sendAttempts).toHaveLength(2);
  });

  test('complete evidence with pending Stripe funds commits normally', async () => {
    const state = createState({
      materializationResults: [{
        enabled: true,
        candidate: true,
        materialized: true,
        created: true,
        contract: { evidence_status: 'pending' },
      }],
    });
    const webhook = loadWebhook(state);

    const response = await callWebhook(webhook);

    expect(response.statusCode).toBe(200);
    expect(state.receiptStatus).toBe('processed');
    expect(state.receiptFailed).toBe(0);
    expect(state.payoutSources).toHaveLength(1);
    expect(state.paymentContracts).toEqual([
      { booking_id: 201, payment_origin: 'direct_slot', evidence_status: 'pending' },
    ]);
    expect(state.sendAttempts).toHaveLength(2);
  });

  test('a core launch-contract failure still fails the receipt and returns 500', async () => {
    const state = createState({ coreFailure: new Error('core contract write failed') });
    const webhook = loadWebhook(state);

    const response = await callWebhook(webhook);

    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({
      error: 'Webhook handler failed',
      event_type: 'checkout.session.completed',
    });
    expect(state.receiptStatus).toBe('failed');
    expect(state.receiptFailed).toBe(1);
    expect(state.sendAttempts).toHaveLength(0);
  });

  test('a genuine booking insert failure restores credit and keeps its alert/apology path', async () => {
    const insertError = new Error('uq_instructor_slot conflict');
    insertError.code = '23505';
    const state = createState({ bookingInsertError: insertError });
    const webhook = loadWebhook(state);

    const response = await callWebhook(webhook);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ received: true });
    expect(state.balanceAdjustments).toEqual([90, -90, 90]);
    expect(state.bookings).toHaveLength(0);
    expect(state.bookingCreditSources).toHaveLength(0);
    expect(state.payoutSources).toHaveLength(0);
    expect(state.paymentContracts).toHaveLength(0);
    expect(state.reports.some(report =>
      report.endpoint === '/api/webhook (slot_booking insert failed)'
    )).toBe(true);
    expect(state.sendAttempts).toContain('booking.insert_failed_apology');
    expect(state.receiptStatus).toBe('processed');
  });
});
