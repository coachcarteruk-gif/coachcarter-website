const { test, expect } = require('@playwright/test');
const path = require('path');

const root = path.resolve(__dirname, '..');

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function loadHandler({ sql, stripe, quote, bind, expire }) {
  const cacheKeysBefore = new Set(Object.keys(require.cache));
  const apiRoot = path.join(root, 'api') + path.sep;
  const replacements = [
    ['@neondatabase/serverless', { neon: () => sql }],
    [path.join(root, 'api', '_stripe-clients.js'), {
      STRIPE_CLIENT_PURPOSES: { PAYMENTS: 'payments' },
      createPlatformStripeClient: () => stripe,
    }],
    [path.join(root, 'api', '_retired-products.js'), {
      loadRetiredProductState: async () => false,
      sendRetiredProduct: () => {},
    }],
    [path.join(root, 'api', '_stripe-launch-payment-contracts.js'), {
      PAYMENT_ORIGINS: { ONE_OFF_OFFER: 'one_off_offer' },
      prepareLaunchPaymentCandidate: async () => ({}),
    }],
    [path.join(root, 'api', '_stripe-launch-shadow-return-urls.js'), {
      resolveStripeCheckoutReturnUrls: async () => ({
        successUrl: 'https://example.test/success',
        cancelUrl: 'https://example.test/cancel',
      }),
    }],
    [path.join(root, 'api', '_booking-extension-invalidation.js'), {
      expireExtensionCheckoutSessions: expire,
    }],
    [path.join(root, 'api', '_post-trial-discount.js'), {
      applyPostTrialDiscount: amount => ({ pricePence: amount, discountPence: 0, discountPct: 0 }),
      getPostTrialDiscount: async () => ({ eligible: false }),
      quotePostTrialPrice: quote,
      bindPostTrialQuote: bind,
    }],
  ];
  const originals = new Map();
  for (const [request, exports] of replacements) {
    const resolved = require.resolve(request);
    originals.set(resolved, require.cache[resolved]);
    require.cache[resolved] = { exports };
  }
  const target = require.resolve('../api/offers');
  const oldTarget = require.cache[target];
  delete require.cache[target];
  try {
    return require('../api/offers');
  } finally {
    for (const key of Object.keys(require.cache)) {
      if (!cacheKeysBefore.has(key) && key.startsWith(apiRoot)) delete require.cache[key];
    }
    for (const [request] of replacements) {
      const resolved = require.resolve(request);
      const old = originals.get(resolved);
      if (old) require.cache[resolved] = old;
      else delete require.cache[resolved];
    }
    if (oldTarget) require.cache[target] = oldTarget;
    else delete require.cache[target];
  }
}

function makeOffer(kind) {
  const common = {
    id: kind === 'extension' ? 52 : 51,
    token: kind === 'extension' ? 'extension-token' : 'pencil-token',
    school_id: 1,
    learner_id: 41,
    learner_email: 'learner@example.test',
    learner_name: 'Learner',
    instructor_id: 9,
    instructor_name: 'Instructor',
    lesson_type_id: 3,
    lesson_type_name: 'Standard lesson',
    lesson_type_slug: 'standard',
    duration_minutes: 60,
    price_pence: 10000,
    scheduled_date: '2026-12-01',
    scheduled_date_text: '2026-12-01',
    start_time: '10:00',
    end_time: '11:00',
    status: 'pending',
    expires_at: '2099-12-01T12:00:00.000Z',
    max_repeat_weeks: 1,
    offer_price_pence: 10000,
    pencilled: kind === 'pencilled',
    stripe_session_id: null,
    checkout_attempt_id: null,
    checkout_attempt_started_at: null,
    checkout_attempt_payload: null,
  };
  if (kind === 'extension') {
    return {
      ...common,
      offer_price_pence: 3000,
      extension_booking_id: 501,
      extension_minutes: 30,
      extension_base_list_price_pence: 3000,
    };
  }
  return common;
}

function harness({
  kind = 'pencilled', failFirstSave = false, failFirstBind = false,
  rejectFirstBind = false, confirmExpiry = true,
} = {}) {
  const offer = makeOffer(kind);
  let attemptIsStale = false;
  let saveFailures = failFirstSave ? 1 : 0;
  let bindFailures = failFirstBind ? 1 : 0;
  let bindRejections = rejectFirstBind ? 1 : 0;
  let quoteCalls = 0;
  const createCalls = [];
  const bindCalls = [];
  const expiryCalls = [];
  const sessionsByKey = new Map();

  const stripe = { checkout: { sessions: {
    create: async (params, options) => {
      createCalls.push({
        key: options.idempotencyKey,
        serializedParams: JSON.stringify(params),
      });
      if (!sessionsByKey.has(options.idempotencyKey)) {
        sessionsByKey.set(options.idempotencyKey, {
          id: kind === 'extension' ? 'cs_extension_original' : 'cs_pencil_original',
          status: 'open',
          url: `https://checkout.test/${kind}`,
          metadata: { ...params.metadata },
        });
      }
      return sessionsByKey.get(options.idempotencyKey);
    },
    retrieve: async id => [...sessionsByKey.values()].find(session => session.id === id),
    expire: async id => {
      const session = [...sessionsByKey.values()].find(item => item.id === id);
      if (session) session.status = 'expired';
    },
  } } };

  const sql = async (strings, ...values) => {
    const query = strings.join('?');
    if (/UPDATE lesson_offers SET status = 'expired'/.test(query)) return [];
    if (/SELECT o\.\*/.test(query)) return [{ ...offer }];
    if (/SELECT id, name, email, phone, pickup_address/.test(query)) {
      return [{ id: 41, name: 'Learner', email: 'learner@example.test', phone: '', pickup_address: '' }];
    }
    if (/FROM lesson_bookings/.test(query)) {
      return [{ id: 501, status: 'scheduled', end_time: offer.start_time }];
    }
    if (/SET checkout_attempt_id = COALESCE/.test(query)) {
      if (offer.checkout_attempt_id && !attemptIsStale) return [];
      offer.checkout_attempt_id ||= values[0];
      offer.checkout_attempt_started_at = new Date().toISOString();
      attemptIsStale = false;
      return [{
        checkout_attempt_id: offer.checkout_attempt_id,
        checkout_attempt_payload: offer.checkout_attempt_payload,
      }];
    }
    if (/SET checkout_attempt_payload=/.test(query)) {
      offer.checkout_attempt_payload = JSON.parse(values[0]);
      return [];
    }
    if (/SET stripe_session_id =/.test(query)) {
      if (saveFailures-- > 0) throw new Error('synthetic session save failure');
      offer.stripe_session_id = values[0];
      return [{ id: offer.id }];
    }
    if (/stripe_session_id = NULL, checkout_attempt_id = NULL/.test(query)) {
      offer.stripe_session_id = null;
      offer.checkout_attempt_id = null;
      offer.checkout_attempt_payload = null;
      return [];
    }
    throw new Error(`Unexpected SQL: ${query}`);
  };

  const quote = async (_sql, { amountPence }) => {
    quoteCalls += 1;
    return {
      pricePence: amountPence - 1000,
      discountPence: 1000,
      discountPct: 10,
      quoteId: `${kind}-quote-1`,
      metadata: {
        post_trial_quote_id: `${kind}-quote-1`,
        post_trial_checkout_expires_at: '2099-12-01T11:30:00.000Z',
      },
    };
  };
  const bind = async (_sql, input) => {
    bindCalls.push({ ...input });
    if (bindFailures-- > 0) throw new Error('synthetic quote binding failure');
    if (bindRejections-- > 0) return { ok: false, code: 'POST_TRIAL_QUOTE_BINDING_MISMATCH' };
    return { ok: true };
  };
  const expire = async sessionIds => {
    if (sessionIds.length > 0) expiryCalls.push([...sessionIds]);
    return sessionIds.map(sessionId => ({ sessionId, expired: confirmExpiry }));
  };
  const handler = loadHandler({ sql, stripe, quote, bind, expire });
  const accept = async (body = {}) => {
    const res = response();
    await handler({
      method: 'POST',
      query: { action: 'accept-offer' },
      body: { token: offer.token, ...body },
    }, res);
    return res;
  };

  return {
    accept,
    makeAttemptStale() { attemptIsStale = true; },
    stats() { return { quoteCalls, createCalls, bindCalls, expiryCalls, offer: { ...offer } }; },
  };
}

for (const kind of ['pencilled', 'extension']) {
  test(`${kind} retry repairs a thrown quote binding against the original saved Checkout`, async () => {
    const h = harness({ kind, failFirstBind: true });
    const failed = await h.accept({ phone: '07000000001', pickup_address: 'Original address' });
    expect(failed.statusCode).toBe(500);

    const retried = await h.accept({ phone: '07000000002', pickup_address: 'Changed address' });
    expect(retried.statusCode).toBe(200);
    expect(retried.body).toMatchObject({
      url: `https://checkout.test/${kind}`,
      reused: true,
    });

    const { quoteCalls, createCalls, bindCalls, offer } = h.stats();
    expect(quoteCalls).toBe(1);
    expect(createCalls).toHaveLength(1);
    expect(JSON.parse(createCalls[0].serializedParams).metadata).toMatchObject({
      learner_phone: '07000000001',
      pickup_address: 'Original address',
      post_trial_quote_id: `${kind}-quote-1`,
    });
    expect(bindCalls).toEqual([
      expect.objectContaining({ quoteId: `${kind}-quote-1`, paymentIdentity: offer.stripe_session_id }),
      expect.objectContaining({ quoteId: `${kind}-quote-1`, paymentIdentity: offer.stripe_session_id }),
    ]);
    expect(new Set(bindCalls.map(call => call.paymentIdentity))).toEqual(new Set([offer.stripe_session_id]));
  });
}

test('session-save failure still retries with the frozen quote, payload and idempotency identity', async () => {
  const h = harness({ kind: 'pencilled', failFirstSave: true });
  const failed = await h.accept({ phone: '07000000001', pickup_address: 'Original address' });
  expect(failed.statusCode).toBe(500);

  h.makeAttemptStale();
  const retried = await h.accept({ phone: '07000000002', pickup_address: 'Changed address' });
  expect(retried.statusCode).toBe(200);

  const { quoteCalls, createCalls, bindCalls } = h.stats();
  expect(quoteCalls).toBe(1);
  expect(createCalls).toHaveLength(2);
  expect(new Set(createCalls.map(call => call.key)).size).toBe(1);
  expect(new Set(createCalls.map(call => call.serializedParams)).size).toBe(1);
  expect(JSON.parse(createCalls[1].serializedParams).metadata).toMatchObject({
    learner_phone: '07000000001',
    pickup_address: 'Original address',
    post_trial_quote_id: 'pencilled-quote-1',
  });
  expect(bindCalls).toEqual([
    expect.objectContaining({ quoteId: 'pencilled-quote-1', paymentIdentity: 'cs_pencil_original' }),
  ]);
});

for (const kind of ['pencilled', 'extension']) {
  test(`${kind} bind rejection plus ambiguous expiry preserves the original Checkout for a durable retry`, async () => {
    const h = harness({ kind, rejectFirstBind: true, confirmExpiry: false });
    const sessionId = kind === 'extension' ? 'cs_extension_original' : 'cs_pencil_original';
    const quoteId = `${kind}-quote-1`;
    const rejected = await h.accept({ phone: '07000000001', pickup_address: 'Original address' });
    expect(rejected.statusCode).toBe(409);
    expect(rejected.body.code).toBe('POST_TRIAL_QUOTE_NOT_BOUND');

    const afterRejection = h.stats();
    expect(afterRejection.createCalls).toHaveLength(1);
    expect(afterRejection.expiryCalls).toEqual([[sessionId]]);
    expect(afterRejection.offer).toMatchObject({
      stripe_session_id: sessionId,
      checkout_attempt_payload: {
        resolvedEmail: 'learner@example.test',
        learnerDetails: {
          phone: '07000000001',
          pickup_address: 'Original address',
        },
        postTrialQuote: { quoteId },
      },
    });

    const retried = await h.accept({ phone: '07000000002', pickup_address: 'Changed address' });
    expect(retried.statusCode).toBe(200);
    expect(retried.body).toMatchObject({
      url: `https://checkout.test/${kind}`,
      reused: true,
    });

    const final = h.stats();
    expect(final.quoteCalls).toBe(1);
    expect(final.createCalls).toHaveLength(1);
    expect(final.bindCalls).toEqual([
      expect.objectContaining({ quoteId, paymentIdentity: sessionId }),
      expect.objectContaining({ quoteId, paymentIdentity: sessionId }),
    ]);
    expect(final.offer.checkout_attempt_payload.learnerDetails).toMatchObject({
      phone: '07000000001',
      pickup_address: 'Original address',
    });
  });
}
