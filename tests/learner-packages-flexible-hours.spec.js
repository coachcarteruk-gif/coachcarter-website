'use strict';

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const {
  FLEXIBLE_HOURS_DISCLOSURE_VERSION,
  FLEXIBLE_PACKAGE_LIVE_GATE,
  FLEXIBLE_PACKAGE_TERMS,
  buildFlexiblePackageCheckoutParams,
  getFlexiblePackageLivePaymentConfiguration,
  getFlexiblePackageLiveWebhookSecret,
  isFlexiblePackageLivePurchasingEnabled,
  productTerms,
  validateFlexibleProviderObject,
} = require('../api/_flexible-package-payments');
const {
  hoursUntilFlexibleLesson,
  planFlexiblePackageFifo,
  unitsForDuration,
} = require('../api/_flexible-package-ledger');
const {
  allowedTransition,
  targetStatus,
} = require('../api/flexible-package-webhook')._test;

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/\r\n/g, '\n');

function product(slug, overrides = {}) {
  const terms = FLEXIBLE_PACKAGE_TERMS[slug];
  return {
    product_slug: slug,
    price_pence: terms.amountPence,
    currency: 'GBP',
    customer_terms_version: 'flexible-hours-v1',
    content: {
      entitlement: { units: terms.totalUnits, unit_minutes: 30, scope: 'school' },
      consumer_rights: { disclosure_version: FLEXIBLE_HOURS_DISCLOSURE_VERSION },
    },
    ...overrides,
  };
}

function attempt(overrides = {}) {
  return {
    id: '018f47b0-1a2b-4c3d-8e9f-0123456789ab',
    school_id: 1,
    learner_id: 41,
    product_id: 20,
    product_version_id: 30,
    product_slug: 'flexible-15-hours',
    product_snapshot: { name: '15-hour Flexible Hours package', short_description: 'School-wide hours' },
    amount_pence: 81000,
    currency: 'GBP',
    total_units: 30,
    unit_minutes: 30,
    rate_pence_per_unit: 2700,
    customer_terms_version: 'flexible-hours-v1',
    disclosure_version: FLEXIBLE_HOURS_DISCLOSURE_VERSION,
    stripe_payment_method_configuration_id: 'pmc_FlexibleLiveOnly',
    stripe_checkout_session_id: 'cs_live_flexible',
    stripe_payment_intent_id: 'pi_flexible',
    ...overrides,
  };
}

function providerObject(overrides = {}) {
  const local = attempt();
  return {
    id: local.stripe_checkout_session_id,
    livemode: true,
    mode: 'payment',
    amount_total: local.amount_pence,
    currency: 'gbp',
    payment_intent: local.stripe_payment_intent_id,
    payment_method_configuration_details: { id: local.stripe_payment_method_configuration_id },
    metadata: {
      payment_type: 'learner_flexible_package_live',
      flexible_attempt_id: local.id,
      school_id: String(local.school_id),
      learner_id: String(local.learner_id),
      product_id: String(local.product_id),
      product_version_id: String(local.product_version_id),
      product_slug: local.product_slug,
      amount_pence: String(local.amount_pence),
      total_units: String(local.total_units),
      unit_minutes: String(local.unit_minutes),
      rate_pence_per_unit: String(local.rate_pence_per_unit),
      terms_version: local.customer_terms_version,
      disclosure_version: local.disclosure_version,
      payment_method_configuration_id: local.stripe_payment_method_configuration_id,
      stripe_mode: 'live',
    },
    ...overrides,
  };
}

test.describe('school-wide Flexible Hours packages', () => {
  test('pins the approved immutable prices and 30-minute entitlements', () => {
    expect(productTerms(product('flexible-15-hours'))).toEqual({
      amountPence: 81000, totalUnits: 30, unitMinutes: 30, ratePencePerUnit: 2700,
    });
    expect(productTerms(product('flexible-30-hours'))).toEqual({
      amountPence: 159000, totalUnits: 60, unitMinutes: 30, ratePencePerUnit: 2650,
    });
    expect(productTerms(product('flexible-15-hours', { price_pence: 80999 }))).toBeNull();
    expect(productTerms(product('flexible-30-hours', { customer_terms_version: 'draft' }))).toBeNull();
  });

  test('enables only an exact Boolean School 1 gate', () => {
    const config = { features: { [FLEXIBLE_PACKAGE_LIVE_GATE]: true } };
    expect(isFlexiblePackageLivePurchasingEnabled(config, 1)).toBe(true);
    expect(isFlexiblePackageLivePurchasingEnabled(config, 2)).toBe(false);
    expect(isFlexiblePackageLivePurchasingEnabled({ features: { [FLEXIBLE_PACKAGE_LIVE_GATE]: 'true' } }, 1)).toBe(false);
    expect(isFlexiblePackageLivePurchasingEnabled({}, 1)).toBe(false);
  });

  test('requires dedicated live configuration and webhook identities', () => {
    expect(getFlexiblePackageLivePaymentConfiguration({
      STRIPE_FLEXIBLE_PACKAGES_LIVE_PAYMENT_METHOD_CONFIGURATION: 'pmc_FlexibleLiveOnly',
      STRIPE_PACKAGES_TEST_PAYMENT_METHOD_CONFIGURATION: 'pmc_PackageTest',
      STRIPE_RESERVED_BLOCK_BANK_PAYMENT_METHOD_CONFIGURATION: 'pmc_Reserved',
    })).toBe('pmc_FlexibleLiveOnly');
    expect(() => getFlexiblePackageLivePaymentConfiguration({
      STRIPE_FLEXIBLE_PACKAGES_LIVE_PAYMENT_METHOD_CONFIGURATION: 'pmc_Reserved',
      STRIPE_RESERVED_BLOCK_BANK_PAYMENT_METHOD_CONFIGURATION: 'pmc_Reserved',
    })).toThrow(/own live Pay by Bank/);
    expect(getFlexiblePackageLiveWebhookSecret({
      STRIPE_FLEXIBLE_PACKAGES_LIVE_WEBHOOK_SECRET: 'whsec_flexible_live',
      STRIPE_WEBHOOK_SECRET: 'whsec_shared',
    })).toBe('whsec_flexible_live');
    expect(() => getFlexiblePackageLiveWebhookSecret({
      STRIPE_FLEXIBLE_PACKAGES_LIVE_WEBHOOK_SECRET: 'whsec_shared',
      STRIPE_WEBHOOK_SECRET: 'whsec_shared',
    })).toThrow(/dedicated live webhook/);
  });

  test('uses the dedicated configuration without specifying payment_method_types', () => {
    const params = buildFlexiblePackageCheckoutParams({
      attempt: attempt(), learnerEmail: 'learner@example.test', returnBaseUrl: 'https://coachcarter.uk',
    });
    expect(params.payment_method_configuration).toBe('pmc_FlexibleLiveOnly');
    expect(params).not.toHaveProperty('payment_method_types');
    expect(params.payment_intent_data.metadata).toEqual(params.metadata);
    expect(params.success_url).toContain('attempt_id=018f47b0-1a2b-4c3d-8e9f-0123456789ab');
  });

  test('fails closed on provider mode, tenant, amount, Checkout, PI or configuration contradictions', () => {
    expect(validateFlexibleProviderObject(attempt(), providerObject())).toEqual({ ok: true, contradictions: [], paymentIntentId: 'pi_flexible' });
    for (const changed of [
      { livemode: false },
      { amount_total: 1 },
      { id: 'cs_live_other' },
      { payment_intent: 'pi_other' },
      { payment_method_configuration_details: { id: 'pmc_other' } },
      { metadata: { ...providerObject().metadata, school_id: '2' } },
    ]) expect(validateFlexibleProviderObject(attempt(), providerObject(changed)).ok).toBe(false);
  });

  test('supports paid-after-expiry reorder while terminal paid cannot regress', () => {
    expect(targetStatus('checkout.session.completed', { payment_status: 'unpaid' })).toBe('pending');
    expect(targetStatus('checkout.session.async_payment_succeeded', {})).toBe('paid');
    expect(allowedTransition('expired', 'paid')).toBe(true);
    expect(allowedTransition('failed', 'paid')).toBe(true);
    expect(allowedTransition('paid', 'expired')).toBe(false);
    expect(allowedTransition('paid', 'failed')).toBe(false);
  });

  test('uses the school timezone for the exact 48-hour Flexible Hours return boundary', () => {
    const schoolConfig = { timezone: 'Europe/London' };
    expect(hoursUntilFlexibleLesson({
      scheduledDate: '2027-01-15', startTime: '10:00:00', schoolConfig,
      now: new Date('2027-01-13T10:00:00.000Z'),
    })).toBe(48);
    expect(hoursUntilFlexibleLesson({
      scheduledDate: '2027-07-15', startTime: '10:00:00', schoolConfig,
      now: new Date('2027-07-13T09:00:00.000Z'),
    })).toBe(48);
    expect(hoursUntilFlexibleLesson({
      scheduledDate: '2027-07-15', startTime: '10:00:00', schoolConfig,
      now: new Date('2027-07-13T10:00:00.000Z'),
    })).toBe(47);
    expect(hoursUntilFlexibleLesson({
      scheduledDate: 'not-a-date', startTime: '10:00:00', schoolConfig,
    })).toBeNull();
  });

  test('persists verified webhook identity before fulfilment and tolerates webhook-first Checkout ordering', () => {
    const endpoint = read('api/flexible-packages.js');
    const webhook = read('api/flexible-package-webhook.js');
    expect(validateFlexibleProviderObject(
      attempt({ stripe_checkout_session_id: null, stripe_payment_intent_id: null }),
      providerObject()
    )).toMatchObject({ ok: true, paymentIntentId: 'pi_flexible' });
    expect(webhook.indexOf('SET stripe_checkout_session_id = COALESCE(stripe_checkout_session_id, $1)'))
      .toBeLessThan(webhook.indexOf('INSERT INTO flexible_package_purchases'));
    expect(webhook).toContain('stripe_payment_intent_id = COALESCE(stripe_payment_intent_id, $2)');
    expect(endpoint).toContain("status IN ('submitting','pending','paid')");
    expect(endpoint).toContain("status = CASE WHEN status = 'submitting' THEN 'pending' ELSE status END");
    expect(endpoint).toContain('if (!pending)');
  });

  test('allocates multiple immutable sources FIFO and preserves each frozen contribution', () => {
    const plan = planFlexiblePackageFifo([
      { id: 11, remaining_units: 2, rate_pence_per_unit: 2700 },
      { id: 12, remaining_units: 5, rate_pence_per_unit: 2650 },
    ], 4);
    expect(plan).toMatchObject({ ok: true, units: 4, contribution_pence: 10700 });
    expect(plan.allocations).toEqual([
      { source_id: 11, units: 2, rate_pence_per_unit: 2700, contribution_pence: 5400 },
      { source_id: 12, units: 2, rate_pence_per_unit: 2650, contribution_pence: 5300 },
    ]);
    expect(planFlexiblePackageFifo([{ id: 11, remaining_units: 1, rate_pence_per_unit: 2700 }], 2))
      .toMatchObject({ ok: false, code: 'INSUFFICIENT_FLEXIBLE_UNITS' });
  });

  test('accepts exact 30-minute units and rejects incompatible offered durations', () => {
    expect(unitsForDuration(30)).toBe(1);
    expect(unitsForDuration(90)).toBe(3);
    expect(unitsForDuration(165)).toBeNull();
    expect(unitsForDuration(0)).toBeNull();
  });

  test('ships the additive ledger in both migrations with tenant and append-only controls', () => {
    for (const source of [read('db/migrations/050_flexible_hours_packages.sql'), read('db/migration.sql')]) {
      for (const table of [
        'flexible_package_purchase_attempts', 'flexible_package_payment_events',
        'flexible_package_purchases', 'flexible_package_sources',
        'flexible_package_booking_allocations', 'flexible_package_allocation_returns',
        'flexible_package_source_reductions', 'flexible_package_state_events',
      ]) expect(source).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
      expect(source).toContain('CREATE OR REPLACE VIEW flexible_package_balances');
      expect(source).toContain("'flexible-15-hours', 'flexible_hours'");
      expect(source).toContain('81000');
      expect(source).toContain('159000');
      expect(source).toContain("to_jsonb(NEW) -> 'learner_id'");
      expect(source).toContain('flexible_package_booking_request_id');
      expect(source).toContain('uq_flexible_package_booking_request');
      expect(source).toContain('validate_flexible_package_allocation_return');
      expect(source).not.toMatch(/UPDATE package_product_versions\s+SET/i);
    }
  });

  test('keeps booking and refund money separate from Lesson Credit and attributes frozen lesson value', () => {
    const ledger = read('api/_flexible-package-ledger.js');
    const endpoint = read('api/flexible-packages.js');
    const webhook = read('api/flexible-package-webhook.js');
    const payout = read('api/_payout-helpers.js');
    expect(ledger).toContain("'flexible_package_frozen_rate'");
    expect(ledger).toContain("'platform_absorbed_package_fee'");
    expect(ledger).toContain('FOR UPDATE OF s');
    expect(ledger).toContain('ON CONFLICT (allocation_id) DO NOTHING');
    expect(ledger).toContain('FLEXIBLE_BOOKING_REQUEST_MISMATCH');
    expect(ledger).toContain('flexible_package_booking_request_id = $3::uuid');
    expect(payout).toContain('lb.list_price_pence');
    expect(endpoint).toContain('provider_call_made_by_application: false');
    expect(endpoint).not.toContain('stripe.refunds.create');
    expect(webhook).not.toContain('instructor_earnings');
    expect(webhook).not.toContain('payout_transfers');
    for (const source of [ledger, endpoint, webhook]) {
      expect(source).not.toContain('learner_credit_balances');
      expect(source).not.toContain('learner_users.balance_minutes');
    }
  });

  test('return pages only poll owned status and the signed webhook is the sole fulfiller', () => {
    const ui = read('public/learner/packages.js');
    const endpoint = read('api/flexible-packages.js');
    const webhook = read('api/flexible-package-webhook.js');
    expect(ui).toContain("flexibleApiUrl('attempt-status'");
    expect(endpoint).not.toContain('INSERT INTO flexible_package_sources');
    expect(webhook).toContain('constructEvent(rawBody');
    expect(webhook).toContain('INSERT INTO flexible_package_sources');
    expect(webhook).toContain('ON CONFLICT (purchase_id) DO NOTHING');
    expect(webhook).toContain("'reconciliation_contradiction'");
    expect(webhook).toContain("processing_state = 'failed'");
    expect(webhook).toContain('FLEXIBLE_PACKAGE_DUPLICATE_EVENT_CONTRADICTION');
  });

  test('covers GDPR export/anonymisation and accessible learner/admin status regions', () => {
    const learnerApi = read('api/learner.js');
    const gdpr = read('api/_gdpr.js');
    const learnerHtml = read('public/learner/packages.html');
    const adminHtml = read('public/admin/packages.html');
    expect(learnerApi).toContain('flexible_hours: flexibleHours');
    expect(gdpr).toContain('UPDATE flexible_package_purchases SET learner_id = NULL');
    expect(gdpr).toContain('UPDATE flexible_package_booking_allocations SET learner_id = NULL');
    expect(learnerHtml).toContain('aria-live="polite"');
    expect(adminHtml).toContain('id="flexible-package-operations"');
  });

  test('keeps tenant and instructor eligibility checks in every mutation path', () => {
    const ledger = read('api/_flexible-package-ledger.js');
    const endpoint = read('api/flexible-packages.js');
    expect(ledger).toContain('id = $1 AND school_id = $2 AND active = TRUE');
    expect(ledger).toContain('s.school_id = $1 AND s.learner_id = $2');
    expect(endpoint).toContain('source.id = $1 AND source.school_id = $2');
    expect(endpoint).toContain('purchase.school_id = ${scope.schoolId}');
  });

  test('gives booking retries a stable identity and operators a Checkout review queue', () => {
    const bookingUi = read('public/learner/book.js');
    const slots = read('api/slots.js');
    const endpoint = read('api/flexible-packages.js');
    const adminUi = read('public/admin/packages.js');
    expect(bookingUi).toContain('flexibleBookingRequestId ||= window.crypto.randomUUID()');
    expect(bookingUi).toContain('bookBody.client_request_id = flexibleBookingRequestId');
    expect(slots).toContain('flexiblePackageBookingReused');
    expect(endpoint).toContain('attempt_exceptions: attemptExceptions');
    expect(adminUi).toContain('Checkout review queue');
  });
});
