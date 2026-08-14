const { test, expect } = require('@playwright/test');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  buildPackageCheckoutParams,
  createPackageTestStripeClient,
  getPackageTestPaymentConfiguration,
  getPackageTestWebhookSecret,
  isLearnerPackagePurchasingEnabled,
  publicAttemptStatus,
  validateProviderObject,
} = require('../api/_learner-package-payments');
const packageWebhookTest = require('../api/package-webhook')._test;

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/\r\n/g, '\n');

function attempt(overrides = {}) {
  return {
    id: '018f47b0-1a2b-4c3d-8e9f-0123456789ab',
    school_id: 7,
    learner_id: 41,
    product_id: 91,
    product_version_id: 9101,
    product_slug: 'full-curriculum',
    product_name: 'Full Curriculum',
    product_description: 'Structured weekly programme.',
    full_curriculum_test_booking_id: 701,
    stripe_payment_method_configuration_id: 'pmc_package_test',
    amount_pence: 200000,
    currency: 'GBP',
    customer_terms_version: 'package-terms-v1',
    status: 'pending',
    review_after: '2026-08-14T12:00:00.000Z',
    ...overrides,
  };
}

function checkoutSession(local, overrides = {}) {
  return {
    id: 'cs_test_package_123',
    object: 'checkout.session',
    livemode: false,
    mode: 'payment',
    amount_total: local.amount_pence,
    currency: 'gbp',
    payment_status: 'paid',
    payment_intent: 'pi_package_123',
    payment_method_configuration_details: { id: local.stripe_payment_method_configuration_id },
    metadata: {
      payment_type: 'learner_package_test',
      package_attempt_id: local.id,
      school_id: String(local.school_id),
      learner_id: String(local.learner_id),
      package_product_id: String(local.product_id),
      package_product_version_id: String(local.product_version_id),
      amount_pence: String(local.amount_pence),
      currency: local.currency,
      customer_terms_version: local.customer_terms_version,
      stripe_mode: 'test',
      full_curriculum_test_booking_id: String(local.full_curriculum_test_booking_id),
      payment_method_configuration_id: local.stripe_payment_method_configuration_id,
    },
    ...overrides,
  };
}

function packageEvent(type, local, objectOverrides = {}) {
  return {
    id: `evt_${type.replace(/[^a-z]/g, '_')}`,
    type,
    created: 1786622400,
    livemode: false,
    data: { object: checkoutSession(local, objectOverrides) },
  };
}

function webhookTransitionSql(initialAttempt) {
  const state = { attempt: { ...initialAttempt }, transitions: [] };
  const sql = async (strings, ...values) => {
    const statement = strings.join('?');
    if (/WITH previous AS/.test(statement)) {
      const allowedStatuses = values[2];
      const targetStatus = values[3];
      if (!allowedStatuses.includes(state.attempt.status)) return [];
      const fromStatus = state.attempt.status;
      state.attempt = { ...state.attempt, status: targetStatus, from_status: fromStatus };
      state.transitions.push([fromStatus, targetStatus]);
      return [state.attempt];
    }
    if (/SELECT \* FROM package_purchase_attempts/.test(statement)) return [state.attempt];
    throw new Error(`Unexpected webhook SQL: ${statement}`);
  };
  return { sql, state };
}

function makeResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

async function callPackageApi(handler, { action, method = 'GET', body = {}, query = {} } = {}) {
  const req = {
    method,
    body,
    query: { action, ...query },
    headers: { host: 'localhost:3000' },
    url: `/api/packages?action=${action}`,
  };
  const res = makeResponse();
  await handler(req, res);
  return res;
}

function loadPackagesApi({ sql, learner, stripeClient, audits = [] }) {
  const realPayments = require('../api/_learner-package-payments');
  const entries = [
    ['@neondatabase/serverless', { neon: () => sql }],
    [path.join(root, 'api', '_auth.js'), {
      requireAuth: (_req, options) => options.roles.includes('learner') ? learner : null,
      getSchoolId: (actor) => Number(actor?.school_id),
      decodeToken: () => learner,
      SESSION_COOKIE_NAMES: { learner: 'cc_learner' },
    }],
    [path.join(root, 'api', '_tenant.js'), {
      isDevelopmentHost: () => true,
      resolveSchoolFromRequest: async () => ({ schoolId: learner?.school_id || 7 }),
    }],
    [path.join(root, 'api', '_audit.js'), { logAudit: async (_sql, entry) => audits.push(entry) }],
    [path.join(root, 'api', '_error-alert.js'), { reportError: () => {} }],
    [path.join(root, 'api', '_learner-package-payments.js'), {
      ...realPayments,
      createPackageTestStripeClient: () => stripeClient,
      getPackageTestPaymentConfiguration: () => 'pmc_package_test',
    }],
  ];
  const originals = new Map();
  for (const [request, exports] of entries) {
    const resolved = require.resolve(request);
    originals.set(resolved, require.cache[resolved]);
    require.cache[resolved] = { exports };
  }
  const target = require.resolve(path.join(root, 'api', 'packages.js'));
  const originalTarget = require.cache[target];
  delete require.cache[target];
  const handler = require(target);
  for (const [request] of entries) {
    const resolved = require.resolve(request);
    if (originals.get(resolved)) require.cache[resolved] = originals.get(resolved);
    else delete require.cache[resolved];
  }
  if (originalTarget) require.cache[target] = originalTarget;
  else delete require.cache[target];
  return handler;
}

function checkoutSql({
  existingAttempt = null,
  learnerSchoolMatches = true,
  catalogueEnabled = true,
  purchasingEnabled = true,
} = {}) {
  const state = { attempt: existingAttempt, statements: [] };
  const sql = async (strings, ...values) => {
    const statement = strings.join('?');
    state.statements.push({ statement, values });
    if (/SELECT id, name, slug, primary_host, config\s+FROM schools/.test(statement)) {
      return [{ id: 7, name: 'North School', slug: 'north', primary_host: null, config: {
        features: {
          learner_packages_enabled: catalogueEnabled,
          learner_package_purchasing_test_enabled: purchasingEnabled,
        },
      } }];
    }
    if (/SELECT id, email, name, email_verified\s+FROM learner_users/.test(statement)) {
      return learnerSchoolMatches ? [{ id: 41, email: 'learner@example.test', name: 'Learner', email_verified: true }] : [];
    }
    if (/FROM package_products p\s+JOIN LATERAL/.test(statement)) {
      return [{
        product_id: 91, product_slug: 'full-curriculum', product_type: 'full_curriculum',
        prerequisite_product_id: null, product_version_id: 9101, version_number: 3,
        price_pence: 200000, currency: 'GBP',
        content: { name: 'Full Curriculum', short_description: 'Structured weekly programme.' },
        customer_terms_version: 'package-terms-v1', effective_from: '2026-08-13T00:00:00.000Z',
      }];
    }
    if (/FROM full_curriculum_test_bookings/.test(statement)) {
      return [{ id: 701, test_date: '2026-12-10', test_time: '10:30:00', test_centre: 'Example Centre', verified_at: '2026-08-13T10:00:00.000Z', test_at: '2026-12-10T10:30:00.000Z' }];
    }
    if (/FROM full_curriculum_enrolments/.test(statement)) return [];
    if (/INSERT INTO package_purchase_attempts/.test(statement)) {
      if (state.attempt) return [];
      state.attempt = attempt({
        id: values[0], status: 'created', client_request_id: values[11],
        idempotency_key: values[12], product_version_id: 9101,
        created_at: '2026-08-13T12:00:00.000Z',
      });
      return [state.attempt];
    }
    if (/INSERT INTO package_purchase_attempt_state_events/.test(statement)) return [];
    if (/SET status = 'submitting'/.test(statement)) {
      state.attempt = { ...state.attempt, status: 'submitting' };
      return [state.attempt];
    }
    if (/SET status = 'pending'/.test(statement)) {
      state.attempt = {
        ...state.attempt, status: 'pending', stripe_checkout_session_id: values[0],
        stripe_payment_intent_id: values[1], stripe_checkout_url: values[2],
      };
      return [state.attempt];
    }
    if (/SET status = \?/.test(statement)) {
      state.attempt = {
        ...state.attempt, status: values[0], failure_code: values[1], failure_message: values[2],
        review_required_at: values[0] === 'review_required' ? '2026-08-13T12:01:00.000Z' : null,
      };
      return [state.attempt];
    }
    if (/client_request_id = \?::uuid/.test(statement)) {
      return state.attempt && state.attempt.client_request_id === values[2] ? [state.attempt] : [];
    }
    if (/status IN \('created', 'submitting', 'pending', 'paid', 'review_required'\)/.test(statement)) return state.attempt ? [state.attempt] : [];
    if (/WHERE id = \?::uuid/.test(statement)) return state.attempt ? [state.attempt] : [];
    throw new Error(`Unexpected SQL: ${statement}`);
  };
  return { sql, state };
}

function loadWebhook({ constructEvent, sql = async () => { throw new Error('SQL must not run'); } }) {
  const entries = [
    ['@neondatabase/serverless', { neon: () => sql }],
    [path.join(root, 'api', '_error-alert.js'), { reportError: () => {} }],
    [path.join(root, 'api', '_learner-package-payments.js'), {
      PACKAGE_EVENT_TYPES: new Set(['checkout.session.completed']),
      PACKAGE_PAYMENT_TYPE: 'learner_package_test',
      createPackageTestStripeClient: () => ({ webhooks: { constructEvent } }),
      getPackageTestWebhookSecret: () => 'whsec_package_test',
      getRawBody: async (req) => req.body,
      isUuid: () => true,
      payloadSha256: () => 'a'.repeat(64),
      positiveInteger: (value) => Number(value) || null,
      safeFailureCode: (value, fallback) => value || fallback,
      validateProviderObject: () => ({ ok: true, contradictions: [] }),
    }],
  ];
  const originals = new Map();
  for (const [request, exports] of entries) {
    const resolved = require.resolve(request);
    originals.set(resolved, require.cache[resolved]);
    require.cache[resolved] = { exports };
  }
  const target = require.resolve(path.join(root, 'api', 'package-webhook.js'));
  const originalTarget = require.cache[target];
  delete require.cache[target];
  const handler = require(target);
  for (const [request] of entries) {
    const resolved = require.resolve(request);
    if (originals.get(resolved)) require.cache[resolved] = originals.get(resolved);
    else delete require.cache[resolved];
  }
  if (originalTarget) require.cache[target] = originalTarget;
  else delete require.cache[target];
  return handler;
}

test.describe('Learner Packages Phase 2 payment foundation', () => {
  test('test purchasing uses a second strict Boolean flag that defaults off', () => {
    expect(isLearnerPackagePurchasingEnabled()).toBe(false);
    expect(isLearnerPackagePurchasingEnabled({ features: {} })).toBe(false);
    expect(isLearnerPackagePurchasingEnabled({ features: { learner_package_purchasing_test_enabled: 'true' } })).toBe(false);
    expect(isLearnerPackagePurchasingEnabled({ features: { learner_package_purchasing_test_enabled: 1 } })).toBe(false);
    expect(isLearnerPackagePurchasingEnabled({ features: { learner_package_purchasing_test_enabled: true } })).toBe(true);
  });

  test('schema pins tenancy, immutable snapshots, guarded transitions, review indexes, and append-only evidence', () => {
    for (const source of [read('db/migration.sql'), read('db/migrations/045_learner_packages_payment_foundation.sql')]) {
      expect(source).toContain('CREATE TABLE IF NOT EXISTS package_purchase_attempts');
      expect(source).toContain('CREATE TABLE IF NOT EXISTS package_payment_events');
      expect(source).toContain('CREATE TABLE IF NOT EXISTS package_purchase_attempt_state_events');
      expect(source).toMatch(/school_id\s+INTEGER NOT NULL DEFAULT 1 REFERENCES schools\(id\)/);
      expect(source).toContain('FOREIGN KEY (learner_id, school_id)');
      expect(source).toContain('FOREIGN KEY (product_version_id, school_id, product_id)');
      expect(source).toContain("CHECK (stripe_mode = 'test')");
      expect(source).toContain("CHECK (livemode = FALSE)");
      expect(source).toContain('idx_package_attempts_review_queue');
      expect(source).toContain('uq_package_attempts_active_product');
      expect(source).toContain("WHERE status IN ('created', 'submitting', 'pending', 'paid', 'review_required')");
      expect(source).toContain('package purchase attempt snapshots are immutable');
      expect(source).toContain('package payment event provider evidence is immutable');
      expect(source).toContain('package purchase attempt state events are append-only');
      expect(source).toContain("OLD.status = 'failed' AND NEW.status IN ('paid'");
      expect(source).toContain("OLD.status = 'expired' AND NEW.status IN ('paid'");
      expect(source).toContain("OLD.status = 'paid' AND NEW.status = 'refunded'");
    }
  });

  test('Checkout is server-priced, test-only, configuration-specific, and explicitly idempotent', () => {
    const local = attempt();
    const params = buildPackageCheckoutParams({
      attempt: local,
      learnerEmail: 'learner@example.test',
      schoolName: 'North School',
      returnBaseUrl: 'https://north.example.test',
      paymentMethodConfiguration: 'pmc_package_test',
    });
    expect(params.mode).toBe('payment');
    expect(params.line_items[0].price_data).toMatchObject({ currency: 'gbp', unit_amount: 200000 });
    expect(params.line_items[0].price_data.product_data.name).toBe(local.product_name);
    expect(params.payment_method_configuration).toBe('pmc_package_test');
    expect(params).not.toHaveProperty('payment_method_types');
    expect(params.metadata).toMatchObject({
      payment_type: 'learner_package_test',
      package_attempt_id: local.id,
      school_id: '7',
      learner_id: '41',
      package_product_version_id: '9101',
      amount_pence: '200000',
      full_curriculum_test_booking_id: '701',
      currency: 'GBP',
      stripe_mode: 'test',
    });
    expect(params.success_url).toContain(`attempt_id=${local.id}`);
    expect(params.cancel_url).toContain(`attempt_id=${local.id}`);

    const api = read('api/packages.js');
    expect(api).toContain("idempotencyKey: attempt.idempotency_key");
    expect(api).toContain("status: 'review_required'");
    expect(api).toContain('STRIPE_RESPONSE_AMBIGUOUS');
    expect(api).not.toContain('STRIPE_RESERVED_BLOCK_BANK_PAYMENT_METHOD_CONFIGURATION');
    const helper = read('api/_learner-package-payments.js');
    expect(helper).toContain('STRIPE_PACKAGES_TEST_RESTRICTED_KEY');
    expect(helper).toContain('STRIPE_PACKAGES_TEST_PAYMENT_METHOD_CONFIGURATION');
    expect(helper).toContain('NO_AUTOMATIC_RETRIES');
    expect(helper).toContain('PACKAGE_TEST_PAYMENT_CONFIGURATION_NOT_DEDICATED');
  });

  test('authenticated checkout ignores client price/content and submits one durable server snapshot', async () => {
    const database = checkoutSql();
    const calls = [];
    const stripeClient = {
      checkout: { sessions: { create: async (params, options) => {
        calls.push({ params, options });
        return {
          id: 'cs_test_package_123', livemode: false, mode: 'payment',
          amount_total: params.line_items[0].price_data.unit_amount, currency: 'gbp',
          payment_status: 'unpaid', payment_intent: null, metadata: params.metadata,
          payment_method_configuration_details: { id: 'pmc_package_test' },
          url: 'https://checkout.stripe.test/package', expires_at: 1786640400,
        };
      } } },
    };
    const handler = loadPackagesApi({
      sql: database.sql,
      learner: { id: 41, role: 'learner', school_id: 7 },
      stripeClient,
    });
    const response = await callPackageApi(handler, {
      action: 'create-checkout', method: 'POST',
      body: {
        product_id: 91,
        client_request_id: '123e4567-e89b-42d3-a456-426614174000',
        price_pence: 1,
        currency: 'EUR',
        product_name: 'Untrusted browser name',
        school_id: 999,
        product_version_id: 1,
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.body.url).toBe('https://checkout.stripe.test/package');
    expect(calls).toHaveLength(1);
    expect(calls[0].params.line_items[0].price_data).toMatchObject({ unit_amount: 200000, currency: 'gbp' });
    expect(calls[0].params.line_items[0].price_data.product_data.name).toBe('Full Curriculum');
    expect(calls[0].params.metadata).toMatchObject({ school_id: '7', package_product_version_id: '9101' });
    expect(calls[0].options.idempotencyKey).toMatch(/^cc-package-test-checkout-/);
    expect(database.state.attempt.status).toBe('pending');
  });

  test('duplicate browser requests reuse the same pending attempt without another Stripe call', async () => {
    const existing = attempt({
      client_request_id: '123e4567-e89b-42d3-a456-426614174000',
      idempotency_key: 'cc-package-test-checkout-018f47b0-1a2b-4c3d-8e9f-0123456789ab',
      stripe_checkout_url: 'https://checkout.stripe.test/existing',
    });
    const database = checkoutSql({ existingAttempt: existing });
    const handler = loadPackagesApi({
      sql: database.sql,
      learner: { id: 41, role: 'learner', school_id: 7 },
      stripeClient: { checkout: { sessions: { create: async () => { throw new Error('must not call Stripe'); } } } },
    });
    const response = await callPackageApi(handler, {
      action: 'create-checkout', method: 'POST',
      body: { product_id: 91, client_request_id: existing.client_request_id },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({ reused: true, url: existing.stripe_checkout_url });
  });

  test('a paid but unfulfilled attempt blocks a new checkout identity without another Stripe call', async () => {
    const existing = attempt({
      status: 'paid',
      client_request_id: '123e4567-e89b-42d3-a456-426614174010',
      paid_at: '2026-08-13T12:05:00.000Z',
    });
    const database = checkoutSql({ existingAttempt: existing });
    let stripeCalls = 0;
    const handler = loadPackagesApi({
      sql: database.sql,
      learner: { id: 41, role: 'learner', school_id: 7 },
      stripeClient: { checkout: { sessions: { create: async () => { stripeCalls += 1; } } } },
    });
    const response = await callPackageApi(handler, {
      action: 'create-checkout', method: 'POST',
      body: {
        product_id: 91,
        client_request_id: '123e4567-e89b-42d3-a456-426614174011',
      },
    });
    expect(response.statusCode).toBe(202);
    expect(response.body).toMatchObject({
      reused: true,
      code: 'PACKAGE_PAYMENT_ALREADY_CONFIRMED',
      fulfilment_pending: true,
      attempt: { status: 'paid' },
    });
    expect(response.body.attempt.message).toContain('Do not start another checkout');
    expect(stripeCalls).toBe(0);
  });

  test('ambiguous Checkout creation becomes review-required and is never automatically retried', async () => {
    const database = checkoutSql();
    let calls = 0;
    const handler = loadPackagesApi({
      sql: database.sql,
      learner: { id: 41, role: 'learner', school_id: 7 },
      stripeClient: { checkout: { sessions: { create: async () => {
        calls += 1;
        const error = new Error('connection reset');
        error.type = 'StripeConnectionError';
        error.code = 'ECONNRESET';
        throw error;
      } } } },
    });
    const response = await callPackageApi(handler, {
      action: 'create-checkout', method: 'POST',
      body: { product_id: 91, client_request_id: '123e4567-e89b-42d3-a456-426614174001' },
    });
    expect(calls).toBe(1);
    expect(response.statusCode).toBe(202);
    expect(response.body.attempt).toMatchObject({ status: 'review_required', failure_code: 'STRIPE_RESPONSE_AMBIGUOUS' });
  });

  test('same-school verified learner lookup fails closed before Stripe on tenant mismatch', async () => {
    const database = checkoutSql({ learnerSchoolMatches: false });
    let calls = 0;
    const handler = loadPackagesApi({
      sql: database.sql,
      learner: { id: 41, role: 'learner', school_id: 7 },
      stripeClient: { checkout: { sessions: { create: async () => { calls += 1; } } } },
    });
    const response = await callPackageApi(handler, {
      action: 'create-checkout', method: 'POST',
      body: { product_id: 91, client_request_id: '123e4567-e89b-42d3-a456-426614174002' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.body.code).toBe('VERIFIED_LEARNER_REQUIRED');
    expect(calls).toBe(0);
  });

  test('either package feature gate blocks Checkout before an attempt or Stripe call', async () => {
    for (const disabled of [
      { catalogueEnabled: false, purchasingEnabled: true, expectedCode: 'LEARNER_PACKAGES_DISABLED' },
      { catalogueEnabled: true, purchasingEnabled: false, expectedCode: 'PACKAGE_TEST_PURCHASING_DISABLED' },
    ]) {
      const database = checkoutSql(disabled);
      let stripeCalls = 0;
      const handler = loadPackagesApi({
        sql: database.sql,
        learner: { id: 41, role: 'learner', school_id: 7 },
        stripeClient: { checkout: { sessions: { create: async () => { stripeCalls += 1; } } } },
      });
      const response = await callPackageApi(handler, {
        action: 'create-checkout', method: 'POST',
        body: {
          product_id: 91,
          client_request_id: crypto.randomUUID(),
        },
      });
      expect(response.statusCode).toBe(404);
      expect(response.body.code).toBe(disabled.expectedCode);
      expect(database.state.attempt).toBeNull();
      expect(stripeCalls).toBe(0);
    }
  });

  test('dedicated package client fails closed on missing or live credentials', () => {
    expect(() => createPackageTestStripeClient({ env: {} })).toThrow(/credential is not configured/i);
    expect(() => createPackageTestStripeClient({
      env: { STRIPE_SECRET_KEY: 'sk_test_shared_not_allowed' },
    })).toThrow(/credential is not configured/i);
    expect(() => createPackageTestStripeClient({
      env: { STRIPE_PACKAGES_TEST_RESTRICTED_KEY: 'rk_live_not_allowed' },
    })).toThrow(/required test mode/i);
    expect(() => getPackageTestPaymentConfiguration({})).toThrow(/not configured/i);
    expect(() => getPackageTestPaymentConfiguration({
      STRIPE_PACKAGES_TEST_PAYMENT_METHOD_CONFIGURATION: 'pmc_shared123',
      STRIPE_RESERVED_BLOCK_BANK_PAYMENT_METHOD_CONFIGURATION: 'pmc_shared123',
    })).toThrow(/must not reuse/i);
    expect(() => getPackageTestWebhookSecret({})).toThrow(/not configured/i);
  });

  test('provider evidence requires exact school, learner, version, amount, currency, terms, and test mode', () => {
    const local = attempt();
    expect(validateProviderObject(local, checkoutSession(local))).toMatchObject({ ok: true, contradictions: [] });
    const wrong = checkoutSession(local, {
      livemode: true,
      amount_total: 75000,
      currency: 'eur',
      payment_method_configuration_details: { id: 'pmc_wrong' },
      metadata: {
        ...checkoutSession(local).metadata,
        school_id: '8',
        learner_id: '42',
        package_product_id: '92',
        package_product_version_id: '9999',
        customer_terms_version: 'wrong-terms',
        full_curriculum_test_booking_id: '702',
        payment_method_configuration_id: 'pmc_wrong',
      },
    });
    const result = validateProviderObject(local, wrong);
    expect(result.ok).toBe(false);
    expect(result.contradictions).toEqual(expect.arrayContaining([
      'provider_not_test_mode', 'school_id_mismatch', 'product_version_id_mismatch',
      'learner_id_mismatch', 'product_id_mismatch', 'amount_mismatch',
      'currency_mismatch', 'terms_version_mismatch', 'test_booking_id_mismatch',
      'payment_configuration_metadata_mismatch', 'payment_configuration_provider_mismatch',
    ]));
  });

  test('operator runbook pins test-only setup, safe disable, and exact production project', () => {
    const runbook = read('docs/learner-packages-test-purchasing-runbook.md');
    expect(runbook).toContain('coachcarter-website');
    expect(runbook).toContain('STRIPE_PACKAGES_TEST_RESTRICTED_KEY');
    expect(runbook).toContain('STRIPE_PACKAGES_TEST_PAYMENT_METHOD_CONFIGURATION');
    expect(runbook).toContain('STRIPE_PACKAGES_TEST_WEBHOOK_SECRET');
    expect(runbook).toContain('learner_package_purchasing_test_enabled');
    expect(runbook).toContain('checkout.session.async_payment_succeeded');
    expect(runbook).toContain('payment_intent.payment_failed');
    expect(runbook).toContain('Do not delete or disable the webhook endpoint while a test payment is unresolved');
    expect(runbook).toContain('No live-mode resource');
  });

  test('stale pending attempts become honest review-required polling states without mutation', () => {
    expect(publicAttemptStatus(attempt({ status: 'pending', review_after: '2026-08-13T00:00:00.000Z' }), new Date('2026-08-14T00:00:00.000Z'))).toBe('review_required');
    expect(publicAttemptStatus(attempt({ status: 'pending', review_after: '2026-08-15T00:00:00.000Z' }), new Date('2026-08-14T00:00:00.000Z'))).toBe('pending');
    expect(publicAttemptStatus(attempt({ status: 'paid' }), new Date('2026-08-14T00:00:00.000Z'))).toBe('paid');
  });

  test('wrong webhook secret and live events are rejected before database access', async () => {
    const wrongSecret = loadWebhook({ constructEvent: () => { throw new Error('bad signature'); } });
    const wrongResponse = makeResponse();
    await wrongSecret({ method: 'POST', headers: { 'stripe-signature': 'bad' }, body: Buffer.from('{}') }, wrongResponse);
    expect(wrongResponse.statusCode).toBe(400);
    expect(wrongResponse.body.code).toBe('INVALID_STRIPE_SIGNATURE');

    const liveWebhook = loadWebhook({
      constructEvent: () => ({
        id: 'evt_live', type: 'checkout.session.completed', livemode: true,
        data: { object: { id: 'cs_live_1', livemode: true, metadata: { payment_type: 'learner_package_test' } } },
      }),
    });
    const liveResponse = makeResponse();
    await liveWebhook({ method: 'POST', headers: { 'stripe-signature': 'valid' }, body: Buffer.from('{}') }, liveResponse);
    expect(liveResponse.statusCode).toBe(400);
    expect(liveResponse.body.code).toBe('LIVE_STRIPE_EVENT_REJECTED');
  });

  test('webhook transitions tolerate unpaid completion, reordered failure, expiry, and late success', async () => {
    const local = attempt({ status: 'submitting' });
    const database = webhookTransitionSql(local);

    await packageWebhookTest.processPackageEvent(database.sql, {
      event: packageEvent('checkout.session.completed', local, { payment_status: 'unpaid' }),
      attempt: database.state.attempt,
    });
    expect(database.state.attempt.status).toBe('pending');

    await packageWebhookTest.processPackageEvent(database.sql, {
      event: packageEvent('checkout.session.expired', local, { payment_status: 'unpaid' }),
      attempt: database.state.attempt,
    });
    expect(database.state.attempt.status).toBe('expired');

    await packageWebhookTest.processPackageEvent(database.sql, {
      event: packageEvent('checkout.session.async_payment_succeeded', local, { payment_status: 'paid' }),
      attempt: database.state.attempt,
    });
    expect(database.state.attempt.status).toBe('paid');

    await packageWebhookTest.processPackageEvent(database.sql, {
      event: packageEvent('checkout.session.async_payment_failed', local, { payment_status: 'unpaid' }),
      attempt: database.state.attempt,
    });
    expect(database.state.attempt.status).toBe('paid');
    expect(database.state.transitions).toEqual([
      ['submitting', 'pending'], ['pending', 'expired'], ['expired', 'paid'],
    ]);
  });

  test('duplicate signed event receipts are counted but not reclaimed after processing', async () => {
    const local = attempt();
    const event = packageEvent('checkout.session.completed', local);
    const receipt = {
      id: 72, school_id: local.school_id, attempt_id: local.id,
      stripe_event_id: event.id, processing_state: 'processed', delivery_count: 1,
    };
    let insertCalls = 0;
    let deliveryCount = 1;
    const sql = async (strings) => {
      const statement = strings.join('?');
      if (/INSERT INTO package_payment_events/.test(statement)) {
        insertCalls += 1;
        return insertCalls === 1 ? [receipt] : [];
      }
      if (/SET delivery_count = delivery_count \+ 1/.test(statement)) {
        deliveryCount += 1;
        return [];
      }
      if (/SELECT \* FROM package_payment_events/.test(statement)) {
        return [{ ...receipt, delivery_count: deliveryCount }];
      }
      throw new Error(`Unexpected receipt SQL: ${statement}`);
    };
    const first = await packageWebhookTest.claimEvent(sql, { event, attempt: local, rawBody: Buffer.from('{}') });
    const duplicate = await packageWebhookTest.claimEvent(sql, { event, attempt: local, rawBody: Buffer.from('{}') });
    expect(first.claimed).toBe(true);
    expect(duplicate).toMatchObject({ claimed: false, receipt: { delivery_count: 2 } });
  });

  test('webhook source covers paid, unpaid, duplicate, failed, expired, reordered, and late-success rules', () => {
    const webhook = read('api/package-webhook.js');
    expect(webhook).toContain("object.payment_status === 'paid' ? 'paid' : 'pending'");
    expect(webhook).toContain("checkout.session.async_payment_succeeded");
    expect(webhook).toContain("checkout.session.expired");
    expect(webhook).toContain("targetStatus: 'failed'");
    expect(webhook).toContain('ON CONFLICT (stripe_event_id) DO NOTHING');
    expect(webhook).toContain("processing_state !== 'failed'");
    expect(webhook).toContain("? ['created', 'submitting', 'pending', 'failed', 'expired', 'review_required']");
    expect(webhook).toContain("status = ANY(${allowedStatuses}::text[])");
    expect(webhook).toContain('await fulfilFullCurriculum');
    expect(webhook).toContain('ON CONFLICT (attempt_id) DO UPDATE');
    expect(webhook).toContain('RETURNING *, (xmax = 0) AS created_now');
    expect(webhook.indexOf('constructEvent')).toBeLessThan(webhook.indexOf('neon(process.env.POSTGRES_URL)'));
    const helper = read('api/_learner-package-payments.js');
    expect(helper).toContain("req.on('data'");
    expect(helper).not.toContain('Buffer.isBuffer(req.body)');
    expect(helper).not.toContain('typeof req.body');
  });

  test('status and diagnostics are school-scoped, read-only, and hide raw Stripe payloads', () => {
    const api = read('api/packages.js');
    expect(api).toContain("requireAuth(req, { roles: ['learner'], requireSchool: true })");
    expect(api).toContain('AND learner_id = ${learnerId}');
    expect(api).toContain('AND school_id = ${schoolId}');
    expect(api).toContain("action === 'attempt-status'");
    expect(api).toContain("action === 'attempt-diagnostics'");
    expect(api).toContain('read_only: true');
    expect(api).toContain('safe_to_retry: false');
    expect(api).not.toContain('raw_stripe_payload');
  });

  test('test fulfilment stays isolated from credits, flexible packages, refunds, rewards, earnings, and payouts', () => {
    const sources = [
      read('api/packages.js'),
      read('api/package-webhook.js'),
      read('api/_learner-package-payments.js'),
      read('db/migrations/045_learner_packages_payment_foundation.sql'),
    ].join('\n');
    for (const forbidden of [
      'learner_credit_balances', 'package_hour_sources', 'course_enrolments',
      'manoeuvres_session_units', 'promotion_rewards', 'refund_events',
      'instructor_payouts', 'payout_line_items', 'stripe.refunds.create',
      'stripe.transfers.create',
    ]) expect(sources).not.toContain(forbidden);
    expect(sources).not.toContain('recurring_slot_blocks');
  });

  test('retained package payment evidence participates in GDPR export and one-way anonymisation', () => {
    const migration = read('db/migrations/045_learner_packages_payment_foundation.sql');
    const gdpr = read('api/_gdpr.js');
    const learner = read('api/learner.js');
    expect(migration).toContain('ON DELETE SET NULL (learner_id)');
    expect(migration).toContain('OLD.learner_id IS NOT NULL AND NEW.learner_id IS NULL');
    expect(gdpr).toContain('UPDATE package_purchase_attempts SET learner_id = NULL');
    expect(learner).toContain("['package_purchase_attempts']");
    expect(learner).toContain('WHERE learner_id = ${user.id} AND school_id = ${schoolId}');
  });

  test('browser return only polls status and exposes accessible pending/failure/retry states', () => {
    const html = read('public/learner/packages.html');
    const js = read('public/learner/packages.js');
    const css = read('public/learner/packages.css');
    expect(html).toContain('id="purchase-status"');
    expect(html).toContain('aria-live="polite"');
    expect(js).toContain("apiUrl('attempt-status'");
    expect(js).toContain("apiUrl('create-checkout')");
    expect(js).toContain('window.crypto.randomUUID()');
    expect(js).toContain('button.setAttribute(\'aria-busy\', \'true\')');
    expect(js).toContain('return page cannot activate a package');
    expect(js).not.toContain('/api/credits');
    expect(js).not.toContain('checkout-slot');
    expect(css).toContain('.product-action.is-purchasable:focus-visible');
    expect(css).toContain('@media (max-width: 620px)');
  });

  test('retired credit checkout and Reserved Weekly Slot configuration remain isolated', () => {
    expect(read('api/credits.js')).toContain("code: 'CREDIT_PURCHASE_RETIRED'");
    expect(read('api/_stripe-payment-methods.js')).toContain('STRIPE_RESERVED_BLOCK_BANK_PAYMENT_METHOD_CONFIGURATION');
    expect(read('api/_learner-package-payments.js')).toContain('must not reuse the Reserved Weekly Slot configuration');
    expect(read('api/package-webhook.js')).not.toContain('recurring_block_bank_checkout');
  });
});

function uiProduct(id, slug, productType, name, pricePence, eligibility) {
  return {
    id, slug, product_type: productType, product_version_id: id * 100,
    version_number: 1, price_pence: pricePence, currency: 'GBP',
    content: { name, short_description: `${name} description`, highlights: ['Server condition'] },
    eligibility,
  };
}

function phase2UiCatalogue() {
  const available = {
    state: 'test_checkout_available', purchase_eligible: true,
    checkout_available: true, reason: 'Test checkout available.',
  };
  const locked = {
    state: 'locked', purchase_eligible: false, checkout_available: false,
    reason: 'Requires an independently assessed pass. No package assessment evidence is available in Phase 1.',
  };
  return [
    uiProduct(1, 'flexible-30-hours', 'flexible_hours', '30-hour flexible package', 165000, { state: 'visible_not_fulfilled', purchase_eligible: false, checkout_available: false }),
    uiProduct(5, 'full-curriculum', 'full_curriculum', 'Full Curriculum Enrolment', 200000, available),
    uiProduct(6, 'manoeuvres', 'manoeuvres', 'Manoeuvres', 15000, { state: 'visible_not_fulfilled', purchase_eligible: false, checkout_available: false }),
    uiProduct(7, 'manoeuvres-challenge', 'manoeuvres', 'Manoeuvres Challenge', 15000, { state: 'visible_not_fulfilled', purchase_eligible: false, checkout_available: false }),
  ];
}

test.describe('Learner Packages Phase 2 page states', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('cc_cookie_consent', JSON.stringify({ analytics: false, version: 1 }));
      localStorage.setItem('cc_learner', JSON.stringify({ user: { id: 41, name: 'Learner', school_id: 1 } }));
    });
    await page.route('**/api/packages?action=feature-state**', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, enabled: true, purchasing_test_enabled: true }),
    }));
    await page.route('**/api/packages?action=catalogue**', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        ok: true, phase: 'full_curriculum_test_foundation', checkout_available: true,
        purchasing_test_enabled: true, payment_method: 'pay_by_bank_test',
        viewer: { signed_in_as_learner: true, learner_id: 41 },
        full_curriculum_eligibility: { test_booking: { verification_status: 'verified', is_future: true }, has_active_enrolment: false },
        school: { id: 1, slug: 'coachcarter', name: 'CoachCarter' },
        products: phase2UiCatalogue(),
      }),
    }));
  });

  test('mobile checkout controls expose accessible review state and send no client pricing', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    let checkoutBody = null;
    await page.route('**/api/packages?action=create-checkout**', async route => {
      checkoutBody = route.request().postDataJSON();
      await route.fulfill({
        status: 202, contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          attempt: {
            id: '018f47b0-1a2b-4c3d-8e9f-0123456789ab', status: 'review_required',
            failure_code: 'STRIPE_RESPONSE_AMBIGUOUS', product: { id: 5 },
            message: 'Payment needs review.',
          },
        }),
      });
    });
    await page.goto('/learner/packages.html', { waitUntil: 'domcontentloaded' });
    const button = page.getByRole('button', { name: 'Start test Pay by Bank' }).first();
    await expect(button).toBeVisible();
    await button.click();
    await expect(page.getByRole('heading', { name: 'Payment review required' })).toBeVisible();
    expect(checkoutBody.product_id).toBe(5);
    expect(checkoutBody.client_request_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Object.keys(checkoutBody).sort()).toEqual(['client_request_id', 'product_id']);
    await expect(page.getByText(/Three internal stages/i)).toBeVisible();
    const layout = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);
  });

  test('browser return polls the owned attempt and never fulfils from URL data', async ({ page }) => {
    let statusRequests = 0;
    await page.route('**/*attempt-status*', route => {
      statusRequests += 1;
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          ok: true, fulfilment_created: false,
          attempt: {
            id: '018f47b0-1a2b-4c3d-8e9f-0123456789ab', status: 'paid',
            product: { id: 5, name: 'Full Curriculum' },
            message: 'Test payment confirmed. Fulfilment is being checked.',
          },
        }),
      });
    });
    await page.goto('/learner/packages?package_return=1&attempt_id=018f47b0-1a2b-4c3d-8e9f-0123456789ab', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Test payment confirmed' })).toBeVisible();
    await expect(page.getByText(/browser page cannot create it/i)).toBeVisible();
    expect(statusRequests).toBe(1);
  });
});
