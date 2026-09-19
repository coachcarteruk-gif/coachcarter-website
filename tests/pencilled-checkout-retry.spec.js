const { test, expect } = require('@playwright/test');
const path = require('path');

const root = path.resolve(__dirname, '..');

function response() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

function loadHandler({ sql, stripe, quote }) {
  const cacheKeysBefore = new Set(Object.keys(require.cache));
  const apiRoot = path.join(root, 'api') + path.sep;
  const replacements = [
    ['@neondatabase/serverless', { neon: () => sql }],
    [path.join(root, 'api', '_stripe-clients.js'), {
      STRIPE_CLIENT_PURPOSES: { PAYMENTS: 'payments' }, createPlatformStripeClient: () => stripe,
    }],
    [path.join(root, 'api', '_retired-products.js'), { loadRetiredProductState: async () => false, sendRetiredProduct: () => {} }],
    [path.join(root, 'api', '_stripe-launch-payment-contracts.js'), {
      PAYMENT_ORIGINS: { ONE_OFF_OFFER: 'one_off_offer' }, prepareLaunchPaymentCandidate: async () => ({}),
    }],
    [path.join(root, 'api', '_stripe-launch-shadow-return-urls.js'), {
      resolveStripeCheckoutReturnUrls: async () => ({ successUrl: 'https://example.test/success', cancelUrl: 'https://example.test/cancel' }),
    }],
    [path.join(root, 'api', '_booking-extension-invalidation.js'), { expireExtensionCheckoutSessions: async () => {} }],
    [path.join(root, 'api', '_post-trial-discount.js'), {
      applyPostTrialDiscount: (amount) => ({ pricePence: amount, discountPence: 0, discountPct: 0 }),
      getPostTrialDiscount: async () => ({ eligible: false }),
      quotePostTrialPrice: quote,
      bindPostTrialQuote: async () => ({ ok: true }),
    }],
  ];
  const originals = new Map();
  for (const [request, exports] of replacements) {
    const resolved = require.resolve(request); originals.set(resolved, require.cache[resolved]); require.cache[resolved] = { exports };
  }
  const target = require.resolve('../api/offers'); const oldTarget = require.cache[target]; delete require.cache[target];
  try {
    return require('../api/offers');
  } finally {
    for (const key of Object.keys(require.cache)) {
      if (!cacheKeysBefore.has(key) && key.startsWith(apiRoot)) delete require.cache[key];
    }
    for (const [request] of replacements) {
      const resolved = require.resolve(request); const old = originals.get(resolved);
      if (old) require.cache[resolved] = old; else delete require.cache[resolved];
    }
    if (oldTarget) require.cache[target] = oldTarget; else delete require.cache[target];
  }
}

function harness({ failFirstSave = false } = {}) {
  const offer = {
    id: 51, token: 'pencil-token', school_id: 1, learner_id: 41, learner_email: 'learner@example.test',
    learner_name: 'Learner', instructor_id: 9, instructor_name: 'Instructor', lesson_type_id: 3,
    lesson_type_name: 'Standard lesson', lesson_type_slug: 'standard', duration_minutes: 60, price_pence: 10000,
    scheduled_date: '2026-12-01', scheduled_date_text: '2026-12-01', start_time: '10:00', end_time: '11:00',
    status: 'pending', expires_at: '2099-12-01T12:00:00.000Z', max_repeat_weeks: 1,
    offer_price_pence: 10000, pencilled: true, stripe_session_id: null,
    checkout_attempt_id: null, checkout_attempt_started_at: null, checkout_attempt_payload: null,
  };
  let stale = false; let saveFailures = failFirstSave ? 1 : 0; let quoteCalls = 0; let createCalls = 0;
  const createKeys = []; const createdByKey = new Map(); const paramsByKey = new Map();
  const stripe = { checkout: { sessions: {
    create: async (params, options) => {
      createCalls += 1; createKeys.push(options.idempotencyKey);
      const serialized = JSON.stringify(params);
      if (paramsByKey.has(options.idempotencyKey) && paramsByKey.get(options.idempotencyKey) !== serialized) {
        const error = new Error('Keys for idempotent requests can only be used with the same parameters');
        error.code = 'idempotency_error';
        throw error;
      }
      paramsByKey.set(options.idempotencyKey, serialized);
      if (!createdByKey.has(options.idempotencyKey)) createdByKey.set(options.idempotencyKey, { id: 'cs_pencil_1', status: 'open', url: 'https://checkout.test/pencil' });
      return createdByKey.get(options.idempotencyKey);
    },
    retrieve: async id => [...createdByKey.values()].find(item => item.id === id),
    expire: async () => {},
  } } };
  const sql = async (strings, ...values) => {
    const q = strings.join('?');
    if (/UPDATE lesson_offers SET status = 'expired'/.test(q)) return [];
    if (/SELECT o\.\*/.test(q)) return [{ ...offer }];
    if (/SELECT id, name, email, phone, pickup_address/.test(q)) return [{ id: 41, name: 'Learner', email: 'learner@example.test', phone: '', pickup_address: '' }];
    if (/SET checkout_attempt_id = COALESCE/.test(q)) {
      if (offer.checkout_attempt_id && !stale) return [];
      offer.checkout_attempt_id ||= values[0]; offer.checkout_attempt_started_at = new Date().toISOString();
      stale = false;
      return [{ checkout_attempt_id: offer.checkout_attempt_id, checkout_attempt_payload: offer.checkout_attempt_payload }];
    }
    if (/SET checkout_attempt_payload=/.test(q)) { offer.checkout_attempt_payload = JSON.parse(values[0]); return []; }
    if (/SET stripe_session_id =/.test(q)) {
      if (saveFailures-- > 0) throw new Error('synthetic session save failure');
      offer.stripe_session_id = values[0]; return [{ id: offer.id }];
    }
    throw new Error(`Unexpected SQL: ${q}`);
  };
  const quote = async (_sql, { amountPence }) => {
    quoteCalls += 1;
    return { pricePence: 9000, discountPence: amountPence - 9000, discountPct: 10, quoteId: 'quote-1', metadata: { post_trial_quote_id: 'quote-1' } };
  };
  const handler = loadHandler({ sql, stripe, quote });
  const accept = async (body = {}) => { const res = response(); await handler({ method: 'POST', query: { action: 'accept-offer' }, body: { token: offer.token, ...body } }, res); return res; };
  return { accept, offer, makeStale: () => { stale = true; }, stats: () => ({ quoteCalls, createCalls, createKeys }) };
}

test('simultaneous pencilled accepts create only one payable Checkout', async () => {
  const h = harness();
  const first = h.accept();
  const second = await h.accept();
  const won = await first;
  expect([won.statusCode, second.statusCode].sort()).toEqual([200, 409]);
  expect(h.stats()).toMatchObject({ quoteCalls: 1, createCalls: 1 });
  expect(new Set(h.stats().createKeys).size).toBe(1);
});

test('provider-created/session-save-failed retry reuses frozen payload and Stripe idempotency identity', async () => {
  const h = harness({ failFirstSave: true });
  const failed = await h.accept({ phone: '07000000001', pickup_address: 'First address' });
  expect(failed.statusCode).toBe(500);
  h.makeStale();
  const retried = await h.accept({ phone: '07000000002', pickup_address: 'Changed address' });
  expect(retried.statusCode).toBe(200);
  expect(retried.body.url).toBe('https://checkout.test/pencil');
  expect(h.stats()).toMatchObject({ quoteCalls: 1, createCalls: 2 });
  expect(new Set(h.stats().createKeys).size).toBe(1);
});
