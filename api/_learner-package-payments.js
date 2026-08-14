'use strict';

const crypto = require('crypto');
const {
  STRIPE_CLIENT_PURPOSES,
  STRIPE_NETWORK_PROFILES,
  classifyStripeError,
  createPlatformStripeClient,
} = require('./_stripe-clients');

const PACKAGE_PAYMENT_TYPE = 'learner_package_test';
const PACKAGE_PURCHASING_CONFIG_PATH = Object.freeze([
  'features',
  'learner_package_purchasing_test_enabled',
]);
const PACKAGE_TEST_RESTRICTED_KEY_ENV = 'STRIPE_PACKAGES_TEST_RESTRICTED_KEY';
const PACKAGE_TEST_PAYMENT_CONFIGURATION_ENV = 'STRIPE_PACKAGES_TEST_PAYMENT_METHOD_CONFIGURATION';
const PACKAGE_TEST_WEBHOOK_SECRET_ENV = 'STRIPE_PACKAGES_TEST_WEBHOOK_SECRET';
const MIN_PAY_BY_BANK_PENCE = 50;
const MAX_PAY_BY_BANK_PENCE = 1_000_000;

const PACKAGE_EVENT_TYPES = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
  'payment_intent.payment_failed',
]);

function isLearnerPackagePurchasingEnabled(config) {
  return config?.features?.learner_package_purchasing_test_enabled === true;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || '').trim()
  );
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function safeFailureCode(value, fallback = 'PACKAGE_PAYMENT_ERROR') {
  const normalised = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  return /^[A-Z0-9_]{1,100}$/.test(normalised) ? normalised : fallback;
}

function createPackageTestStripeClient({ env = process.env, client = null } = {}) {
  if (client) {
    return createPlatformStripeClient({
      purpose: STRIPE_CLIENT_PURPOSES.PAYMENTS,
      expectedMode: 'test',
      injectedMode: 'test',
      client,
    });
  }
  const dedicatedKey = String(env[PACKAGE_TEST_RESTRICTED_KEY_ENV] || '').trim();
  return createPlatformStripeClient({
    purpose: STRIPE_CLIENT_PURPOSES.PAYMENTS,
    expectedMode: 'test',
    networkProfile: STRIPE_NETWORK_PROFILES.NO_AUTOMATIC_RETRIES,
    // Deliberately omit STRIPE_SECRET_KEY and every live/shared credential.
    env: { STRIPE_PAYMENTS_RESTRICTED_KEY: dedicatedKey },
  });
}

function getPackageTestPaymentConfiguration(env = process.env) {
  const value = String(env[PACKAGE_TEST_PAYMENT_CONFIGURATION_ENV] || '').trim();
  if (!/^pmc_[A-Za-z0-9]+$/.test(value)) {
    const error = new Error('Lesson Packages test Payment Method Configuration is not configured');
    error.code = 'PACKAGE_TEST_PAYMENT_CONFIGURATION_MISSING';
    throw error;
  }
  const reservedSlotConfiguration = String(
    env.STRIPE_RESERVED_BLOCK_BANK_PAYMENT_METHOD_CONFIGURATION || ''
  ).trim();
  if (reservedSlotConfiguration && value === reservedSlotConfiguration) {
    const error = new Error('Lesson Packages must not reuse the Reserved Weekly Slot configuration');
    error.code = 'PACKAGE_TEST_PAYMENT_CONFIGURATION_NOT_DEDICATED';
    throw error;
  }
  return value;
}

function getPackageTestWebhookSecret(env = process.env) {
  const value = String(env[PACKAGE_TEST_WEBHOOK_SECRET_ENV] || '').trim();
  if (!/^whsec_[A-Za-z0-9_]+$/.test(value)) {
    const error = new Error('Lesson Packages test webhook secret is not configured');
    error.code = 'PACKAGE_TEST_WEBHOOK_SECRET_MISSING';
    throw error;
  }
  return value;
}

function packageMetadata(attempt) {
  const metadata = {
    payment_type: PACKAGE_PAYMENT_TYPE,
    package_attempt_id: String(attempt.id),
    school_id: String(attempt.school_id),
    learner_id: String(attempt.learner_id),
    package_product_id: String(attempt.product_id),
    package_product_version_id: String(attempt.product_version_id),
    package_product_slug: String(attempt.product_slug),
    amount_pence: String(attempt.amount_pence),
    currency: String(attempt.currency).toUpperCase(),
    customer_terms_version: String(attempt.customer_terms_version),
    stripe_mode: 'test',
  };
  if (attempt.full_curriculum_test_booking_id) {
    metadata.full_curriculum_test_booking_id = String(attempt.full_curriculum_test_booking_id);
  }
  if (attempt.stripe_payment_method_configuration_id) {
    metadata.payment_method_configuration_id = String(attempt.stripe_payment_method_configuration_id);
  }
  return metadata;
}

function statementDescriptor(schoolName) {
  const value = String(schoolName || 'COACHCARTER')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 22);
  return value || 'COACHCARTER';
}

function buildPackageCheckoutParams({ attempt, learnerEmail, schoolName, returnBaseUrl, paymentMethodConfiguration }) {
  const metadata = packageMetadata(attempt);
  const productName = String(attempt.product_name).slice(0, 240);
  const description = String(attempt.product_description || '').slice(0, 500);
  return {
    mode: 'payment',
    client_reference_id: String(attempt.id),
    line_items: [{
      price_data: {
        currency: 'gbp',
        unit_amount: Number(attempt.amount_pence),
        product_data: {
          name: productName,
          ...(description ? { description } : {}),
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
    payment_method_configuration: paymentMethodConfiguration,
    payment_method_options: {
      pay_by_bank: { statement_descriptor: statementDescriptor(schoolName) },
    },
    billing_address_collection: 'required',
    success_url: `${returnBaseUrl}/learner/packages.html?package_return=1&attempt_id=${attempt.id}`,
    cancel_url: `${returnBaseUrl}/learner/packages.html?package_cancelled=1&attempt_id=${attempt.id}`,
  };
}

function providerObjectMetadata(object) {
  return object?.metadata && typeof object.metadata === 'object' ? object.metadata : {};
}

function validateProviderObject(attempt, object) {
  const metadata = providerObjectMetadata(object);
  const contradictions = [];
  const objectId = String(object?.id || '');
  const objectIsSession = objectId.startsWith('cs_');
  const amount = objectIsSession ? object?.amount_total : object?.amount;
  const currency = String(object?.currency || '').toUpperCase();
  const paymentIntentId = objectIsSession
    ? (typeof object.payment_intent === 'string' ? object.payment_intent : object.payment_intent?.id)
    : objectId.startsWith('pi_') ? objectId : null;

  if (object?.livemode !== false) contradictions.push('provider_not_test_mode');
  if (metadata.payment_type !== PACKAGE_PAYMENT_TYPE) contradictions.push('payment_type_mismatch');
  if (metadata.package_attempt_id !== String(attempt.id)) contradictions.push('attempt_id_mismatch');
  if (positiveInteger(metadata.school_id) !== Number(attempt.school_id)) contradictions.push('school_id_mismatch');
  if (positiveInteger(metadata.learner_id) !== Number(attempt.learner_id)) contradictions.push('learner_id_mismatch');
  if (positiveInteger(metadata.package_product_id) !== Number(attempt.product_id)) contradictions.push('product_id_mismatch');
  if (positiveInteger(metadata.package_product_version_id) !== Number(attempt.product_version_id)) contradictions.push('product_version_id_mismatch');
  if (Number(amount) !== Number(attempt.amount_pence)) contradictions.push('amount_mismatch');
  if (currency !== String(attempt.currency).toUpperCase()) contradictions.push('currency_mismatch');
  if (metadata.customer_terms_version !== String(attempt.customer_terms_version)) contradictions.push('terms_version_mismatch');
  if (metadata.stripe_mode !== 'test') contradictions.push('metadata_mode_mismatch');
  if (
    attempt.full_curriculum_test_booking_id
    && positiveInteger(metadata.full_curriculum_test_booking_id) !== Number(attempt.full_curriculum_test_booking_id)
  ) contradictions.push('test_booking_id_mismatch');
  if (
    attempt.stripe_payment_method_configuration_id
    && metadata.payment_method_configuration_id !== String(attempt.stripe_payment_method_configuration_id)
  ) contradictions.push('payment_configuration_metadata_mismatch');
  const providerPaymentConfiguration = object?.payment_method_configuration_details?.id || null;
  if (
    attempt.stripe_payment_method_configuration_id
    && providerPaymentConfiguration !== String(attempt.stripe_payment_method_configuration_id)
  ) contradictions.push('payment_configuration_provider_mismatch');
  if (objectIsSession && object.mode !== 'payment') contradictions.push('checkout_mode_mismatch');
  if (attempt.stripe_checkout_session_id && objectIsSession && objectId !== attempt.stripe_checkout_session_id) {
    contradictions.push('checkout_session_id_mismatch');
  }
  if (attempt.stripe_payment_intent_id && paymentIntentId && paymentIntentId !== attempt.stripe_payment_intent_id) {
    contradictions.push('payment_intent_id_mismatch');
  }

  return {
    ok: contradictions.length === 0,
    contradictions,
    objectId,
    paymentIntentId: paymentIntentId || null,
  };
}

function classifyPackageStripeError(error) {
  const provider = classifyStripeError(error);
  const definitive = new Set(['invalid_request', 'authentication', 'permission', 'idempotency', 'card']);
  return {
    ambiguous: !definitive.has(provider.category),
    code: safeFailureCode(`STRIPE_${provider.category || 'unknown'}`),
    requestId: provider.requestId || null,
  };
}

function publicAttemptStatus(attempt, now = new Date()) {
  const stored = String(attempt?.status || 'review_required');
  const reviewAfter = attempt?.review_after ? new Date(attempt.review_after) : null;
  if (
    ['created', 'submitting', 'pending'].includes(stored)
    && reviewAfter
    && !Number.isNaN(reviewAfter.getTime())
    && reviewAfter <= now
  ) return 'review_required';
  if (stored === 'created' || stored === 'submitting') return 'pending';
  return stored;
}

async function getRawBody(req) {
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody;
  if (typeof req.rawBody === 'string') return Buffer.from(req.rawBody);
  // Vercel's req.body is a lazy parsed-body getter. Do not access it here:
  // Stripe signature verification requires the untouched request bytes.
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
  MAX_PAY_BY_BANK_PENCE,
  MIN_PAY_BY_BANK_PENCE,
  PACKAGE_EVENT_TYPES,
  PACKAGE_PAYMENT_TYPE,
  PACKAGE_PURCHASING_CONFIG_PATH,
  PACKAGE_TEST_PAYMENT_CONFIGURATION_ENV,
  PACKAGE_TEST_RESTRICTED_KEY_ENV,
  PACKAGE_TEST_WEBHOOK_SECRET_ENV,
  buildPackageCheckoutParams,
  classifyPackageStripeError,
  createPackageTestStripeClient,
  getPackageTestPaymentConfiguration,
  getPackageTestWebhookSecret,
  getRawBody,
  isLearnerPackagePurchasingEnabled,
  isUuid,
  packageMetadata,
  payloadSha256,
  positiveInteger,
  publicAttemptStatus,
  safeFailureCode,
  validateProviderObject,
};
