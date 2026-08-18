'use strict';

const crypto = require('crypto');
const {
  STRIPE_CLIENT_PURPOSES,
  STRIPE_NETWORK_PROFILES,
  classifyStripeError,
  createPlatformStripeClient,
} = require('./_stripe-clients');

const FLEXIBLE_PACKAGE_PAYMENT_TYPE = 'learner_flexible_package_live';
const FLEXIBLE_PACKAGE_LIVE_GATE = 'learner_flexible_package_purchasing_live_enabled';
const FLEXIBLE_PACKAGE_LIVE_RESTRICTED_KEY_ENV = 'STRIPE_FLEXIBLE_PACKAGES_LIVE_RESTRICTED_KEY';
const FLEXIBLE_PACKAGE_LIVE_PAYMENT_CONFIGURATION_ENV = 'STRIPE_FLEXIBLE_PACKAGES_LIVE_PAYMENT_METHOD_CONFIGURATION';
const FLEXIBLE_PACKAGE_LIVE_WEBHOOK_SECRET_ENV = 'STRIPE_FLEXIBLE_PACKAGES_LIVE_WEBHOOK_SECRET';
const FLEXIBLE_HOURS_DISCLOSURE_VERSION = 'flexible-hours-consumer-rights-v1';
const FLEXIBLE_PACKAGE_SLUGS = Object.freeze(['flexible-10-hours', 'flexible-15-hours', 'flexible-30-hours']);
const FLEXIBLE_PACKAGE_TERMS = Object.freeze({
  'flexible-10-hours': Object.freeze({ amountPence: 55000, totalUnits: 20, unitMinutes: 30, ratePencePerUnit: 2750 }),
  'flexible-15-hours': Object.freeze({ amountPence: 81000, totalUnits: 30, unitMinutes: 30, ratePencePerUnit: 2700 }),
  'flexible-30-hours': Object.freeze({ amountPence: 159000, totalUnits: 60, unitMinutes: 30, ratePencePerUnit: 2650 }),
});
const FLEXIBLE_PACKAGE_EVENT_TYPES = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
]);

function isFlexiblePackageLivePurchasingEnabled(config, schoolId) {
  return Number(schoolId) === 1
    && config?.features?.[FLEXIBLE_PACKAGE_LIVE_GATE] === true;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function createFlexiblePackageLiveStripeClient({ env = process.env, client = null } = {}) {
  if (client) {
    return createPlatformStripeClient({
      purpose: STRIPE_CLIENT_PURPOSES.PAYMENTS,
      expectedMode: 'live',
      injectedMode: 'live',
      client,
    });
  }
  const dedicatedKey = String(env[FLEXIBLE_PACKAGE_LIVE_RESTRICTED_KEY_ENV] || '').trim();
  return createPlatformStripeClient({
    purpose: STRIPE_CLIENT_PURPOSES.PAYMENTS,
    expectedMode: 'live',
    networkProfile: STRIPE_NETWORK_PROFILES.NO_AUTOMATIC_RETRIES,
    env: { STRIPE_PAYMENTS_RESTRICTED_KEY: dedicatedKey },
  });
}

function getFlexiblePackageLivePaymentConfiguration(env = process.env) {
  const value = String(env[FLEXIBLE_PACKAGE_LIVE_PAYMENT_CONFIGURATION_ENV] || '').trim();
  if (!/^pmc_[A-Za-z0-9]+$/.test(value)) {
    const error = new Error('Flexible Hours live Payment Method Configuration is not configured');
    error.code = 'FLEXIBLE_PACKAGE_LIVE_PAYMENT_CONFIGURATION_MISSING';
    throw error;
  }
  const forbidden = [
    env.STRIPE_PACKAGES_TEST_PAYMENT_METHOD_CONFIGURATION,
    env.STRIPE_RESERVED_BLOCK_BANK_PAYMENT_METHOD_CONFIGURATION,
  ].filter(Boolean).map(String);
  if (forbidden.includes(value)) {
    const error = new Error('Flexible Hours must use its own live Pay by Bank configuration');
    error.code = 'FLEXIBLE_PACKAGE_LIVE_PAYMENT_CONFIGURATION_NOT_DEDICATED';
    throw error;
  }
  return value;
}

function getFlexiblePackageLiveWebhookSecret(env = process.env) {
  const value = String(env[FLEXIBLE_PACKAGE_LIVE_WEBHOOK_SECRET_ENV] || '').trim();
  if (!/^whsec_[A-Za-z0-9_]+$/.test(value)) {
    const error = new Error('Flexible Hours live webhook secret is not configured');
    error.code = 'FLEXIBLE_PACKAGE_LIVE_WEBHOOK_SECRET_MISSING';
    throw error;
  }
  if (value === env.STRIPE_PACKAGES_TEST_WEBHOOK_SECRET || value === env.STRIPE_WEBHOOK_SECRET) {
    const error = new Error('Flexible Hours must use a dedicated live webhook identity');
    error.code = 'FLEXIBLE_PACKAGE_LIVE_WEBHOOK_NOT_DEDICATED';
    throw error;
  }
  return value;
}

function productTerms(product) {
  const expected = FLEXIBLE_PACKAGE_TERMS[product?.product_slug || product?.slug];
  const entitlement = product?.content?.entitlement;
  const rights = product?.content?.consumer_rights;
  if (!expected
      || Number(product.price_pence) !== expected.amountPence
      || product.currency !== 'GBP'
      || Number(entitlement?.units) !== expected.totalUnits
      || Number(entitlement?.unit_minutes) !== expected.unitMinutes
      || product.customer_terms_version !== 'flexible-hours-v1'
      || rights?.disclosure_version !== FLEXIBLE_HOURS_DISCLOSURE_VERSION) return null;
  return expected;
}

function metadataForAttempt(attempt) {
  return {
    payment_type: FLEXIBLE_PACKAGE_PAYMENT_TYPE,
    flexible_attempt_id: String(attempt.id),
    school_id: String(attempt.school_id),
    learner_id: String(attempt.learner_id),
    product_id: String(attempt.product_id),
    product_version_id: String(attempt.product_version_id),
    product_slug: String(attempt.product_slug),
    amount_pence: String(attempt.amount_pence),
    total_units: String(attempt.total_units),
    unit_minutes: String(attempt.unit_minutes),
    rate_pence_per_unit: String(attempt.rate_pence_per_unit),
    terms_version: String(attempt.customer_terms_version),
    disclosure_version: String(attempt.disclosure_version),
    payment_method_configuration_id: String(attempt.stripe_payment_method_configuration_id),
    stripe_mode: 'live',
  };
}

function buildFlexiblePackageCheckoutParams({ attempt, learnerEmail, returnBaseUrl }) {
  const metadata = metadataForAttempt(attempt);
  return {
    mode: 'payment',
    client_reference_id: String(attempt.id),
    line_items: [{
      price_data: {
        currency: 'gbp',
        unit_amount: Number(attempt.amount_pence),
        product_data: {
          name: String(attempt.product_snapshot?.name || 'Flexible Hours').slice(0, 240),
          description: String(attempt.product_snapshot?.short_description || '').slice(0, 500),
          metadata: {
            package_product_id: String(attempt.product_id),
            package_product_version_id: String(attempt.product_version_id),
          },
        },
      },
      quantity: 1,
    }],
    metadata,
    payment_intent_data: { metadata },
    customer_email: learnerEmail,
    payment_method_configuration: attempt.stripe_payment_method_configuration_id,
    billing_address_collection: 'required',
    success_url: `${returnBaseUrl}/learner/packages.html?flexible_return=1&attempt_id=${attempt.id}`,
    cancel_url: `${returnBaseUrl}/learner/packages.html?flexible_cancelled=1&attempt_id=${attempt.id}`,
  };
}

function validateFlexibleProviderObject(attempt, object) {
  const metadata = object?.metadata || {};
  const contradictions = [];
  const paymentIntentId = typeof object?.payment_intent === 'string'
    ? object.payment_intent : object?.payment_intent?.id || null;
  const configurationId = object?.payment_method_configuration_details?.id || null;
  if (object?.livemode !== true) contradictions.push('provider_not_live_mode');
  if (object?.mode !== 'payment') contradictions.push('checkout_mode_mismatch');
  if (metadata.payment_type !== FLEXIBLE_PACKAGE_PAYMENT_TYPE) contradictions.push('payment_type_mismatch');
  if (metadata.flexible_attempt_id !== String(attempt.id)) contradictions.push('attempt_id_mismatch');
  for (const key of ['school_id','learner_id','product_id','product_version_id','amount_pence','total_units','unit_minutes','rate_pence_per_unit']) {
    const localKey = key === 'product_version_id' ? 'product_version_id' : key;
    if (Number(metadata[key]) !== Number(attempt[localKey])) contradictions.push(`${key}_mismatch`);
  }
  if (metadata.product_slug !== attempt.product_slug) contradictions.push('product_slug_mismatch');
  if (metadata.terms_version !== attempt.customer_terms_version) contradictions.push('terms_version_mismatch');
  if (metadata.disclosure_version !== attempt.disclosure_version) contradictions.push('disclosure_version_mismatch');
  if (metadata.stripe_mode !== 'live') contradictions.push('metadata_mode_mismatch');
  if (Number(object?.amount_total) !== Number(attempt.amount_pence)) contradictions.push('amount_total_mismatch');
  if (String(object?.currency || '').toUpperCase() !== 'GBP') contradictions.push('currency_mismatch');
  if (configurationId !== attempt.stripe_payment_method_configuration_id) contradictions.push('payment_configuration_mismatch');
  if (attempt.stripe_checkout_session_id && object?.id !== attempt.stripe_checkout_session_id) contradictions.push('checkout_identity_mismatch');
  if (attempt.stripe_payment_intent_id && paymentIntentId !== attempt.stripe_payment_intent_id) contradictions.push('payment_intent_identity_mismatch');
  return { ok: contradictions.length === 0, contradictions, paymentIntentId };
}

function classifyFlexibleStripeError(error) {
  const provider = classifyStripeError(error);
  const definitive = new Set(['invalid_request', 'authentication', 'permission', 'idempotency', 'card']);
  return { ambiguous: !definitive.has(provider.category), code: `STRIPE_${String(provider.category || 'unknown').toUpperCase()}` };
}

async function getRawBody(req) {
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody;
  if (typeof req.rawBody === 'string') return Buffer.from(req.rawBody);
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function payloadSha256(rawBody) {
  return crypto.createHash('sha256').update(rawBody).digest('hex');
}

module.exports = {
  FLEXIBLE_HOURS_DISCLOSURE_VERSION,
  FLEXIBLE_PACKAGE_EVENT_TYPES,
  FLEXIBLE_PACKAGE_LIVE_GATE,
  FLEXIBLE_PACKAGE_LIVE_PAYMENT_CONFIGURATION_ENV,
  FLEXIBLE_PACKAGE_LIVE_RESTRICTED_KEY_ENV,
  FLEXIBLE_PACKAGE_LIVE_WEBHOOK_SECRET_ENV,
  FLEXIBLE_PACKAGE_PAYMENT_TYPE,
  FLEXIBLE_PACKAGE_SLUGS,
  FLEXIBLE_PACKAGE_TERMS,
  buildFlexiblePackageCheckoutParams,
  classifyFlexibleStripeError,
  createFlexiblePackageLiveStripeClient,
  getFlexiblePackageLivePaymentConfiguration,
  getFlexiblePackageLiveWebhookSecret,
  getRawBody,
  isFlexiblePackageLivePurchasingEnabled,
  isUuid,
  metadataForAttempt,
  payloadSha256,
  productTerms,
  validateFlexibleProviderObject,
};
