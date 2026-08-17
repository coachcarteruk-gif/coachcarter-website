'use strict';

const { Readable } = require('stream');
const Stripe = require('stripe');
const { test, expect } = require('@playwright/test');
const { metadataForAttempt, payloadSha256 } = require('../api/_flexible-package-payments');

const ATTEMPT_ID = 'f73d6f09-e474-4a73-87e0-47ef6b798c5b';

function clone(value) {
  return structuredClone(value);
}

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

class FlexibleWebhookDatabase {
  constructor(attempt) {
    this.state = {
      attempt: clone(attempt),
      paymentEvents: [],
      purchases: [],
      sources: [],
      stateEvents: [],
      financialWrites: [],
      nextPurchaseId: 1,
      nextSourceId: 1,
    };
  }

  async transaction(_connectionString, callback) {
    const before = clone(this.state);
    try {
      return await callback({ query: (sql, params) => this.query(sql, params) });
    } catch (error) {
      this.state = before;
      throw error;
    }
  }

  async query(sql, params = []) {
    const statement = String(sql).replace(/\s+/g, ' ').trim();
    if (/instructor_earnings|booking_earnings|payout|transfer/i.test(statement)) {
      this.state.financialWrites.push(statement);
      throw new Error('Purchase fulfilment must not write earnings, transfer, or payout records');
    }

    if (statement.startsWith('SELECT * FROM flexible_package_purchase_attempts')) {
      return { rowCount: 1, rows: [clone(this.state.attempt)] };
    }

    if (statement.startsWith('INSERT INTO flexible_package_payment_events')) {
      const existing = this.state.paymentEvents.find(row => row.stripe_event_id === params[2]);
      if (existing) return { rowCount: 0, rows: [] };
      const row = {
        school_id: params[0],
        attempt_id: params[1],
        stripe_event_id: params[2],
        event_type: params[3],
        stripe_object_id: params[4],
        payload_sha256: params[5],
        processing_state: 'processing',
        delivery_count: 1,
      };
      this.state.paymentEvents.push(row);
      return { rowCount: 1, rows: [clone(row)] };
    }

    if (statement.startsWith('SELECT school_id, attempt_id::text')) {
      const row = this.state.paymentEvents.find(event => event.stripe_event_id === params[0]);
      return { rowCount: row ? 1 : 0, rows: row ? [clone(row)] : [] };
    }

    if (statement.startsWith('UPDATE flexible_package_payment_events')
        && statement.includes('delivery_count = delivery_count + 1')) {
      const row = this.state.paymentEvents.find(event => event.stripe_event_id === params[0]);
      row.delivery_count += 1;
      return { rowCount: 1, rows: [] };
    }

    if (statement.startsWith('UPDATE flexible_package_purchase_attempts')
        && statement.includes('stripe_checkout_session_id = COALESCE')) {
      if (!statement.includes('$2::text IS NULL')) {
        const error = new Error('could not determine data type of parameter $2');
        error.code = '42P08';
        throw error;
      }
      this.state.attempt.stripe_checkout_session_id ||= params[0];
      this.state.attempt.stripe_payment_intent_id ||= params[1];
      return { rowCount: 1, rows: [clone(this.state.attempt)] };
    }

    if (statement.startsWith('UPDATE flexible_package_purchase_attempts')
        && statement.includes('SET status = $1')) {
      this.state.attempt.status = params[0];
      if (params[0] === 'paid') this.state.attempt.paid_at ||= '2026-08-17T18:37:30.000Z';
      return { rowCount: 1, rows: [] };
    }

    if (statement.startsWith('INSERT INTO flexible_package_purchases')) {
      const existing = this.state.purchases.find(row => row.attempt_id === params[0]);
      if (existing) return { rowCount: 0, rows: [] };
      const attempt = this.state.attempt;
      const row = {
        id: this.state.nextPurchaseId++,
        school_id: attempt.school_id,
        learner_id: attempt.learner_id,
        attempt_id: attempt.id,
        product_id: attempt.product_id,
        product_version_id: attempt.product_version_id,
        product_slug: attempt.product_slug,
        product_snapshot: clone(attempt.product_snapshot),
        amount_pence: attempt.amount_pence,
        currency: attempt.currency,
        total_units: attempt.total_units,
        unit_minutes: attempt.unit_minutes,
        rate_pence_per_unit: attempt.rate_pence_per_unit,
        customer_terms_version: attempt.customer_terms_version,
        stripe_checkout_session_id: attempt.stripe_checkout_session_id,
        stripe_payment_intent_id: attempt.stripe_payment_intent_id,
        paid_at: attempt.paid_at,
      };
      this.state.purchases.push(row);
      return { rowCount: 1, rows: [clone(row)] };
    }

    if (statement.startsWith('SELECT * FROM flexible_package_purchases')) {
      const row = this.state.purchases.find(purchase => purchase.attempt_id === params[0]);
      return { rowCount: row ? 1 : 0, rows: row ? [clone(row)] : [] };
    }

    if (statement.startsWith('INSERT INTO flexible_package_sources')) {
      const existing = this.state.sources.find(row => row.purchase_id === params[2]);
      if (existing) return { rowCount: 0, rows: [] };
      const row = {
        id: this.state.nextSourceId++,
        school_id: params[0],
        learner_id: params[1],
        purchase_id: params[2],
        product_version_id: params[3],
        initial_units: Number(params[4]),
        unit_minutes: Number(params[5]),
        rate_pence_per_unit: Number(params[6]),
        original_value_pence: Number(params[7]),
        available_at: params[8],
      };
      this.state.sources.push(row);
      return { rowCount: 1, rows: [{ id: row.id }] };
    }

    if (statement.startsWith('INSERT INTO flexible_package_state_events')) {
      this.state.stateEvents.push({
        event_type: 'entitlement_created',
        attempt_id: params[2],
        purchase_id: params[3],
        source_id: params[4],
        detail: JSON.parse(params[5]),
      });
      return { rowCount: 1, rows: [] };
    }

    if (statement.startsWith('UPDATE flexible_package_payment_events')
        && statement.includes("processing_state = 'processed'")) {
      const row = this.state.paymentEvents.find(event => event.stripe_event_id === params[0]);
      row.processing_state = 'processed';
      return { rowCount: 1, rows: [] };
    }

    throw new Error(`Unexpected Flexible Hours test query: ${statement.slice(0, 120)}`);
  }
}

function loadWebhookWithDatabase(database) {
  const transactionPath = require.resolve('../api/_db-transaction');
  const webhookPath = require.resolve('../api/flexible-package-webhook');
  const originalTransaction = require.cache[transactionPath];
  const originalWebhook = require.cache[webhookPath];
  require.cache[transactionPath] = {
    id: transactionPath,
    filename: transactionPath,
    loaded: true,
    exports: { withNeonTransaction: database.transaction.bind(database) },
  };
  delete require.cache[webhookPath];
  const webhook = require('../api/flexible-package-webhook');
  return {
    webhook,
    restore() {
      if (originalTransaction) require.cache[transactionPath] = originalTransaction;
      else delete require.cache[transactionPath];
      if (originalWebhook) require.cache[webhookPath] = originalWebhook;
      else delete require.cache[webhookPath];
    },
  };
}

test('a signed paid Flexible Hours event avoids the 42P08 bind failure and fulfils once', async () => {
  const originalEnv = {
    POSTGRES_URL: process.env.POSTGRES_URL,
    STRIPE_FLEXIBLE_PACKAGES_LIVE_RESTRICTED_KEY: process.env.STRIPE_FLEXIBLE_PACKAGES_LIVE_RESTRICTED_KEY,
    STRIPE_FLEXIBLE_PACKAGES_LIVE_WEBHOOK_SECRET: process.env.STRIPE_FLEXIBLE_PACKAGES_LIVE_WEBHOOK_SECRET,
    STRIPE_PACKAGES_TEST_WEBHOOK_SECRET: process.env.STRIPE_PACKAGES_TEST_WEBHOOK_SECRET,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  };
  process.env.POSTGRES_URL = 'postgresql://test.invalid/incident';
  process.env.STRIPE_FLEXIBLE_PACKAGES_LIVE_RESTRICTED_KEY = `rk_live_${'x'.repeat(32)}`;
  process.env.STRIPE_FLEXIBLE_PACKAGES_LIVE_WEBHOOK_SECRET = 'whsec_flexible_incident_regression';
  delete process.env.STRIPE_PACKAGES_TEST_WEBHOOK_SECRET;
  delete process.env.STRIPE_WEBHOOK_SECRET;

  const attempt = {
    id: ATTEMPT_ID,
    school_id: 1,
    learner_id: 101,
    product_id: '11',
    product_version_id: '12',
    product_slug: 'flexible-15-hours',
    product_snapshot: { name: '15-hour Flexible Hours package' },
    amount_pence: 81000,
    currency: 'GBP',
    total_units: 30,
    unit_minutes: 30,
    rate_pence_per_unit: 2700,
    customer_terms_version: 'flexible-hours-v1',
    disclosure_version: 'flexible-hours-consumer-rights-v1',
    stripe_payment_method_configuration_id: 'pmc_live_incident',
    stripe_checkout_session_id: 'cs_live_incident_regression',
    stripe_payment_intent_id: null,
    status: 'pending',
    paid_at: null,
  };
  const database = new FlexibleWebhookDatabase(attempt);
  const loaded = loadWebhookWithDatabase(database);
  try {
    const event = {
      id: 'evt_live_flexible_incident_regression',
      type: 'checkout.session.completed',
      created: Math.floor(Date.now() / 1000),
      livemode: true,
      data: {
        object: {
          id: attempt.stripe_checkout_session_id,
          livemode: true,
          mode: 'payment',
          payment_status: 'paid',
          amount_total: 81000,
          currency: 'gbp',
          payment_intent: 'pi_live_incident_regression',
          payment_method_configuration_details: { id: attempt.stripe_payment_method_configuration_id },
          metadata: metadataForAttempt(attempt),
        },
      },
    };
    const payload = JSON.stringify(event);
    const signingStripe = new Stripe('sk_test_incident_signature_only');
    const signature = signingStripe.webhooks.generateTestHeaderString({
      payload,
      secret: process.env.STRIPE_FLEXIBLE_PACKAGES_LIVE_WEBHOOK_SECRET,
    });

    async function deliver() {
      const req = Readable.from([Buffer.from(payload)]);
      req.method = 'POST';
      req.headers = { 'stripe-signature': signature };
      const res = responseRecorder();
      await loaded.webhook(req, res);
      return res;
    }

    const first = await deliver();
    const second = await deliver();

    expect(first.statusCode).toBe(200);
    expect(first.body).toMatchObject({
      received: true,
      duplicate: false,
      status: 'paid',
      entitlement_created: true,
    });
    expect(second.statusCode).toBe(200);
    expect(second.body).toMatchObject({
      received: true,
      duplicate: true,
      status: 'paid',
      entitlement_created: false,
    });

    expect(database.state.attempt.status).toBe('paid');
    expect(database.state.purchases).toHaveLength(1);
    expect(database.state.sources).toHaveLength(1);
    expect(database.state.sources[0]).toMatchObject({ initial_units: 30, unit_minutes: 30 });
    expect(database.state.sources[0].initial_units * database.state.sources[0].unit_minutes).toBe(900);
    expect(database.state.paymentEvents).toHaveLength(1);
    expect(database.state.paymentEvents[0]).toMatchObject({
      payload_sha256: payloadSha256(Buffer.from(payload)),
      delivery_count: 2,
      processing_state: 'processed',
    });
    expect(database.state.stateEvents).toHaveLength(1);
    expect(database.state.stateEvents[0].detail).toMatchObject({
      units: 30,
      unit_minutes: 30,
      earnings_created: false,
      payout_created: false,
    });
    expect(database.state.financialWrites).toEqual([]);
  } finally {
    loaded.restore();
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
