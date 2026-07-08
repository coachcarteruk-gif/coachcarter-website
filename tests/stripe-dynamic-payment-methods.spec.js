const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8').replace(/\r\n/g, '\n');
}

function functionBody(source, name) {
  const start = source.indexOf(`async function ${name}`);
  expect(start, `${name} should exist`).toBeGreaterThanOrEqual(0);
  const next = source.indexOf('\nasync function ', start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

function checkoutSessionPayloads(source) {
  const marker = 'stripe.checkout.sessions.create({';
  const payloads = [];
  let searchFrom = 0;

  while (true) {
    const markerIndex = source.indexOf(marker, searchFrom);
    if (markerIndex === -1) return payloads;

    const start = source.indexOf('{', markerIndex);
    let depth = 0;
    let end = start;

    for (; end < source.length; end += 1) {
      const char = source[end];
      if (char === '{') depth += 1;
      if (char === '}') depth -= 1;
      if (depth === 0) break;
    }

    payloads.push(source.slice(start, end + 1));
    searchFrom = end + 1;
  }
}

test('Stage 3 payment-method audit tracks expected Stripe checkout surfaces', () => {
  expect(checkoutSessionPayloads(read('api/slots.js')).length, 'slots should have auth, guest, test-date, and reserved-block bank Checkout').toBe(4);
  expect(checkoutSessionPayloads(read('api/offers.js')).length, 'lesson offers should have one Checkout surface').toBe(1);
  expect(checkoutSessionPayloads(read('api/credits.js')).length, 'retired credit checkout remains dormant for compatibility').toBe(1);
});

test('Checkout Sessions rely on Stripe dynamic payment methods', () => {
  const checkoutFiles = [
    'api/credits.js',
    'api/offers.js',
    'api/slots.js',
  ];

  for (const relativePath of checkoutFiles) {
    const source = read(relativePath);
    const payloads = checkoutSessionPayloads(source);

    expect(payloads.length, `${relativePath} should create at least one Checkout Session`).toBeGreaterThan(0);
    for (const payload of payloads) {
      expect(payload, `${relativePath} should not pin Checkout to a manual method list`).not.toMatch(/(^|[^_])payment_method_types\s*:/);
      expect(payload, `${relativePath} should exclude retired Klarna while keeping dynamic methods`).toContain('excluded_payment_method_types: CHECKOUT_EXCLUDED_PAYMENT_METHOD_TYPES');
    }
  }
});

test('Stripe Checkout excludes only Klarna through a shared helper', () => {
  const helper = read('api/_stripe-payment-methods.js');

  expect(helper).toContain("const CHECKOUT_EXCLUDED_PAYMENT_METHOD_TYPES = Object.freeze(['klarna']);");
  expect(helper).not.toContain('card');
  expect(helper).not.toContain('pay_by_bank');

  for (const relativePath of ['api/credits.js', 'api/offers.js', 'api/slots.js']) {
    const source = read(relativePath);
    expect(source).toContain("require('./_stripe-payment-methods')");
    expect(source).not.toContain("excluded_payment_method_types: ['klarna']");
  }
});

test('live code and current reference copy do not present Klarna as available', () => {
  const noKlarnaFiles = [
    'api/_stripe-fee.js',
    'api/webhook.js',
    'docs/franchise-benefits.md',
    'public/learner/buy-credits.html',
  ];

  for (const relativePath of noKlarnaFiles) {
    expect(read(relativePath), `${relativePath} should not contain stale Klarna copy`).not.toMatch(/klarna/i);
  }

  const project = read('PROJECT.md');
  expect(project).not.toContain('enabled via Stripe dashboard, not hardcoded');
  expect(project).not.toContain('card + Klarna');
  expect(project).toContain('Klarna has been removed from Stripe configuration');
});

test('retired credit payment creation stops before pricing, SQL, or Stripe work', () => {
  const source = read('api/credits.js');
  const checkoutBody = functionBody(source, 'handleCheckout');
  const paymentIntentBody = functionBody(source, 'handleCreatePaymentIntent');

  const checkoutRetiredGuard = checkoutBody.indexOf('CREDIT_PURCHASE_RETIRED_RESPONSE');
  expect(checkoutRetiredGuard).toBeGreaterThanOrEqual(0);
  expect(checkoutRetiredGuard).toBeLessThan(checkoutBody.indexOf('const schoolId'));
  expect(checkoutRetiredGuard).toBeLessThan(checkoutBody.indexOf('neon(process.env.POSTGRES_URL)'));
  expect(checkoutRetiredGuard).toBeLessThan(checkoutBody.indexOf('stripe.checkout.sessions.create'));

  const paymentIntentRetiredGuard = paymentIntentBody.indexOf('CREDIT_PURCHASE_RETIRED_RESPONSE');
  expect(paymentIntentRetiredGuard).toBeGreaterThanOrEqual(0);
  expect(paymentIntentRetiredGuard).toBeLessThan(paymentIntentBody.indexOf('const schoolId'));
  expect(paymentIntentRetiredGuard).toBeLessThan(paymentIntentBody.indexOf('neon(process.env.POSTGRES_URL)'));
  expect(paymentIntentRetiredGuard).toBeLessThan(paymentIntentBody.indexOf('stripe.paymentIntents.create'));
});

test('direct Pay As You Go checkout uses server-calculated amounts and no client payment-method controls', () => {
  const source = read('api/slots.js');

  for (const handlerName of ['handleCheckoutSlot', 'handleCheckoutSlotGuest']) {
    const body = functionBody(source, handlerName);

    expect(body).toContain('const directPrice');
    expect(body).toContain('calcDirectLessonPrice(sql, {');
    expect(body).toContain('const pricePence');
    expect(body).toContain('unit_amount: pricePence');
    expect(body).toContain('amount_pence:    String(pricePence)');
    expect(body).not.toMatch(/(^|[^_])payment_method_types\s*:/);
    expect(body).not.toContain('payment_method_configurations');
    expect(body).toContain('excluded_payment_method_types: CHECKOUT_EXCLUDED_PAYMENT_METHOD_TYPES');
    expect(body).not.toContain('req.body.amount_pence');
    expect(body).not.toContain('req.body.price_pence');
    expect(body).not.toContain('req.body.payment_method');
  }
});
