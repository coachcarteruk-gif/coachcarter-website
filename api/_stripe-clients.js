'use strict';

const Stripe = require('stripe');

// stripe-node 22.4.0 is pinned to this version in Stripe's official changelog.
const STRIPE_API_VERSION = '2026-07-29.dahlia';

const STRIPE_CLIENT_PURPOSES = Object.freeze({
  PLATFORM_V1: 'platform_v1',
  PAYMENTS: 'payments',
  REFUNDS: 'refunds',
  PAYOUTS: 'payouts',
  RECONCILIATION: 'reconciliation',
  CONNECT_V1: 'connect_v1',
  ACCOUNTS_V2: 'accounts_v2',
});

const STRIPE_NETWORK_PROFILES = Object.freeze({
  DEFAULT: 'default',
  READ_ONLY_AUDIT: 'read_only_audit',
  NO_AUTOMATIC_RETRIES: 'no_automatic_retries',
});

// These values make the stripe-node defaults used by the prior integration
// explicit. The read-only audit profile preserves the one existing script
// that deliberately used two retries.
const NETWORK_CONFIGS = Object.freeze({
  [STRIPE_NETWORK_PROFILES.DEFAULT]: Object.freeze({
    timeout: 80_000,
    maxNetworkRetries: 1,
    telemetry: true,
  }),
  [STRIPE_NETWORK_PROFILES.READ_ONLY_AUDIT]: Object.freeze({
    timeout: 80_000,
    maxNetworkRetries: 2,
    telemetry: true,
  }),
  // Money-creation flows with their own durable ambiguous-response state use
  // this profile so the application, not an SDK retry, owns reconciliation.
  [STRIPE_NETWORK_PROFILES.NO_AUTOMATIC_RETRIES]: Object.freeze({
    timeout: 80_000,
    maxNetworkRetries: 0,
    telemetry: true,
  }),
});

// A purpose-specific restricted key wins, followed by the platform-wide
// restricted key. STRIPE_SECRET_KEY remains the final compatibility fallback
// so Slice 0 requires no deployment configuration change.
const PURPOSE_KEY_ENV_VARS = Object.freeze({
  [STRIPE_CLIENT_PURPOSES.PLATFORM_V1]: Object.freeze([
    'STRIPE_PLATFORM_RESTRICTED_KEY',
  ]),
  [STRIPE_CLIENT_PURPOSES.PAYMENTS]: Object.freeze([
    'STRIPE_PAYMENTS_RESTRICTED_KEY',
    'STRIPE_PLATFORM_RESTRICTED_KEY',
  ]),
  [STRIPE_CLIENT_PURPOSES.REFUNDS]: Object.freeze([
    'STRIPE_REFUNDS_RESTRICTED_KEY',
    'STRIPE_PLATFORM_RESTRICTED_KEY',
  ]),
  [STRIPE_CLIENT_PURPOSES.PAYOUTS]: Object.freeze([
    'STRIPE_PAYOUTS_RESTRICTED_KEY',
    'STRIPE_PLATFORM_RESTRICTED_KEY',
  ]),
  [STRIPE_CLIENT_PURPOSES.RECONCILIATION]: Object.freeze([
    'STRIPE_RECONCILIATION_RESTRICTED_KEY',
    'STRIPE_PLATFORM_RESTRICTED_KEY',
  ]),
  [STRIPE_CLIENT_PURPOSES.CONNECT_V1]: Object.freeze([
    'STRIPE_CONNECT_RESTRICTED_KEY',
    'STRIPE_PLATFORM_RESTRICTED_KEY',
  ]),
  [STRIPE_CLIENT_PURPOSES.ACCOUNTS_V2]: Object.freeze([
    'STRIPE_ACCOUNTS_V2_RESTRICTED_KEY',
    'STRIPE_CONNECT_RESTRICTED_KEY',
    'STRIPE_PLATFORM_RESTRICTED_KEY',
  ]),
});

const clientMetadata = new WeakMap();

class StripeConfigurationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'StripeConfigurationError';
    this.code = code;
  }
}

function unique(values) {
  return [...new Set(values)];
}

function keyMode(key) {
  const match = /^(?:sk|rk)_(test|live)_/.exec(key);
  return match ? match[1] : null;
}

function keyClass(key) {
  if (key.startsWith('rk_')) return 'restricted';
  if (key.startsWith('sk_')) return 'secret';
  return null;
}

function normalizeExpectedMode(value) {
  if (value == null || value === '') return null;
  if (value === 'test' || value === 'live') return value;
  throw new StripeConfigurationError(
    'STRIPE_MODE_INVALID',
    'Stripe mode must be either test or live.'
  );
}

function selectCredential({ purpose, env, expectedMode }) {
  const purposeEnvVars = PURPOSE_KEY_ENV_VARS[purpose];
  if (!purposeEnvVars) {
    throw new StripeConfigurationError(
      'STRIPE_PURPOSE_INVALID',
      'Stripe client purpose is not recognized.'
    );
  }

  const envVarOrder = unique([...purposeEnvVars, 'STRIPE_SECRET_KEY']);
  const configured = envVarOrder
    .filter((name) => typeof env[name] === 'string' && env[name].trim() !== '')
    .map((name) => {
      const key = env[name].trim();
      return { name, key, mode: keyMode(key), className: keyClass(key) };
    });

  if (configured.length === 0) {
    throw new StripeConfigurationError(
      'STRIPE_CREDENTIAL_MISSING',
      `Stripe credential is not configured for purpose ${purpose}.`
    );
  }

  if (configured.some((item) => !item.mode || !item.className)) {
    throw new StripeConfigurationError(
      'STRIPE_CREDENTIAL_INVALID',
      'Stripe credential format is not recognized.'
    );
  }

  const configuredModes = new Set(configured.map((item) => item.mode));
  if (configuredModes.size !== 1) {
    throw new StripeConfigurationError(
      'STRIPE_CREDENTIAL_MODE_MIXED',
      'Stripe test and live credentials cannot be configured together for one client purpose.'
    );
  }

  const selected = configured[0];
  if (selected.name !== 'STRIPE_SECRET_KEY' && selected.className !== 'restricted') {
    throw new StripeConfigurationError(
      'STRIPE_RESTRICTED_CREDENTIAL_REQUIRED',
      `${selected.name} must contain a restricted Stripe credential.`
    );
  }

  const requiredMode = normalizeExpectedMode(
    expectedMode == null ? env.STRIPE_MODE : expectedMode
  );
  if (requiredMode && selected.mode !== requiredMode) {
    throw new StripeConfigurationError(
      'STRIPE_CREDENTIAL_MODE_MISMATCH',
      `Stripe credential mode does not match the required ${requiredMode} mode.`
    );
  }

  return selected;
}

function networkConfig(profile) {
  const config = NETWORK_CONFIGS[profile];
  if (!config) {
    throw new StripeConfigurationError(
      'STRIPE_NETWORK_PROFILE_INVALID',
      'Stripe network profile is not recognized.'
    );
  }
  return config;
}

function createStripeClient({
  purpose,
  env = process.env,
  expectedMode = null,
  networkProfile = STRIPE_NETWORK_PROFILES.DEFAULT,
  client = null,
  injectedMode = null,
  StripeCtor = Stripe,
} = {}) {
  if (client) {
    const mode = normalizeExpectedMode(injectedMode);
    const requiredMode = normalizeExpectedMode(expectedMode);
    if (mode && requiredMode && mode !== requiredMode) {
      throw new StripeConfigurationError(
        'STRIPE_INJECTED_CLIENT_MODE_MISMATCH',
        'Injected Stripe client mode does not match the required mode.'
      );
    }
    if ((typeof client === 'object' && client !== null) || typeof client === 'function') {
      clientMetadata.set(client, Object.freeze({
        purpose,
        apiVersion: STRIPE_API_VERSION,
        mode: mode || 'injected',
        credentialClass: 'injected',
        credentialSource: 'injected',
        networkProfile: 'injected',
        injected: true,
      }));
    }
    return client;
  }

  if (typeof StripeCtor !== 'function') {
    throw new StripeConfigurationError(
      'STRIPE_CONSTRUCTOR_INVALID',
      'Stripe client constructor is unavailable.'
    );
  }

  const credential = selectCredential({ purpose, env, expectedMode });
  const requestConfig = networkConfig(networkProfile);
  const constructorConfig = {
    apiVersion: STRIPE_API_VERSION,
    timeout: requestConfig.timeout,
    maxNetworkRetries: requestConfig.maxNetworkRetries,
    telemetry: requestConfig.telemetry,
  };

  let stripeClient;
  try {
    stripeClient = new StripeCtor(credential.key, constructorConfig);
  } catch {
    throw new StripeConfigurationError(
      'STRIPE_CLIENT_CONSTRUCTION_FAILED',
      'Stripe client could not be constructed safely.'
    );
  }

  if ((typeof stripeClient !== 'object' || stripeClient === null) && typeof stripeClient !== 'function') {
    throw new StripeConfigurationError(
      'STRIPE_CLIENT_CONSTRUCTION_FAILED',
      'Stripe client could not be constructed safely.'
    );
  }

  clientMetadata.set(stripeClient, Object.freeze({
    purpose,
    apiVersion: STRIPE_API_VERSION,
    mode: credential.mode,
    credentialClass: credential.className,
    credentialSource: credential.name,
    networkProfile,
    timeout: requestConfig.timeout,
    maxNetworkRetries: requestConfig.maxNetworkRetries,
    telemetry: requestConfig.telemetry,
    injected: false,
  }));
  return stripeClient;
}

function createPlatformStripeClient(options = {}) {
  const purpose = options.purpose || STRIPE_CLIENT_PURPOSES.PLATFORM_V1;
  if (purpose === STRIPE_CLIENT_PURPOSES.ACCOUNTS_V2) {
    throw new StripeConfigurationError(
      'STRIPE_PURPOSE_BOUNDARY_MISMATCH',
      'Accounts v2 clients must use the Accounts v2 factory.'
    );
  }
  return createStripeClient({ ...options, purpose });
}

function createAccountsV2StripeClient(options = {}) {
  return createStripeClient({
    ...options,
    purpose: STRIPE_CLIENT_PURPOSES.ACCOUNTS_V2,
  });
}

function getStripeClientMetadata(client) {
  const metadata = client && clientMetadata.get(client);
  return metadata ? { ...metadata } : null;
}

function safeProviderCode(value, fallback = 'stripe_error') {
  return typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,80}$/.test(value)
    ? value
    : fallback;
}

function safeRequestId(value) {
  return typeof value === 'string' && /^req_[a-zA-Z0-9]{1,80}$/.test(value)
    ? value
    : null;
}

function classifyStripeError(error) {
  const type = typeof error?.type === 'string' ? error.type : '';
  const name = typeof error?.name === 'string' ? error.name : '';
  const statusCode = Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode <= 599
    ? error.statusCode
    : null;
  const identity = `${type} ${name}`.toLowerCase();

  let category = 'unknown';
  if (identity.includes('carderror')) category = 'card';
  else if (identity.includes('invalidrequest')) category = 'invalid_request';
  else if (identity.includes('authentication')) category = 'authentication';
  else if (identity.includes('permission')) category = 'permission';
  else if (identity.includes('ratelimit') || statusCode === 429) category = 'rate_limit';
  else if (identity.includes('idempotency')) category = 'idempotency';
  else if (
    identity.includes('connection') ||
    identity.includes('network') ||
    identity.includes('timeout') ||
    ['ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN'].includes(error?.code)
  ) category = 'network';
  else if (identity.includes('apierror') || (statusCode != null && statusCode >= 500)) category = 'api';

  return Object.freeze({
    provider: 'stripe',
    category,
    code: safeProviderCode(error?.code),
    declineCode: safeProviderCode(error?.decline_code, null),
    statusCode,
    requestId: safeRequestId(error?.requestId || error?.request_id),
    retryable: category === 'network' || category === 'rate_limit' || category === 'api',
  });
}

module.exports = {
  STRIPE_API_VERSION,
  STRIPE_CLIENT_PURPOSES,
  STRIPE_NETWORK_PROFILES,
  StripeConfigurationError,
  classifyStripeError,
  createAccountsV2StripeClient,
  createPlatformStripeClient,
  getStripeClientMetadata,
};
