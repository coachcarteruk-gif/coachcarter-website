// @ts-check

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const {
  STRIPE_API_VERSION,
  STRIPE_CLIENT_PURPOSES,
  STRIPE_NETWORK_PROFILES,
  StripeConfigurationError,
  classifyStripeError,
  createAccountsV2StripeClient,
  createPlatformStripeClient,
  getStripeClientMetadata,
} = require('../api/_stripe-clients');

const repoRoot = path.resolve(__dirname, '..');

function capturingStripeConstructor(calls) {
  return function FakeStripe(key, config) {
    calls.push({ key, config });
    this.fake = true;
  };
}

function fakeCredential(prefix, mode, label) {
  return [prefix, mode, label].join('_');
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

function javascriptFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...javascriptFiles(fullPath));
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(fullPath);
  }
  return files;
}

test('package and lockfile pin one exact officially selected Stripe SDK', () => {
  const manifest = readJson('package.json');
  const lockfile = readJson('package-lock.json');

  expect(manifest.dependencies.stripe).toBe('22.4.0');
  expect(manifest.dependencies.stripe).toMatch(/^\d+\.\d+\.\d+$/);
  expect(lockfile.packages[''].dependencies.stripe).toBe('22.4.0');
  expect(lockfile.packages['node_modules/stripe'].version).toBe('22.4.0');
});

test('platform v1 and Accounts v2 factories are distinct and use one API version', () => {
  const calls = [];
  const StripeCtor = capturingStripeConstructor(calls);
  const env = { STRIPE_SECRET_KEY: 'sk_test_compatibility_fallback' };

  const platform = createPlatformStripeClient({ env, StripeCtor });
  const accountsV2 = createAccountsV2StripeClient({ env, StripeCtor });

  expect(calls).toHaveLength(2);
  expect(calls.map((call) => call.config.apiVersion)).toEqual([
    STRIPE_API_VERSION,
    STRIPE_API_VERSION,
  ]);
  expect(STRIPE_API_VERSION).toBe('2026-07-29.dahlia');
  expect(getStripeClientMetadata(platform)?.purpose).toBe(STRIPE_CLIENT_PURPOSES.PLATFORM_V1);
  expect(getStripeClientMetadata(accountsV2)?.purpose).toBe(STRIPE_CLIENT_PURPOSES.ACCOUNTS_V2);
  expect(() => createPlatformStripeClient({
    purpose: STRIPE_CLIENT_PURPOSES.ACCOUNTS_V2,
    env,
    StripeCtor,
  })).toThrowError(StripeConfigurationError);
});

test('restricted-key precedence and compatibility fallback are deterministic', () => {
  const calls = [];
  const StripeCtor = capturingStripeConstructor(calls);

  const paymentClient = createPlatformStripeClient({
    purpose: STRIPE_CLIENT_PURPOSES.PAYMENTS,
    env: {
      STRIPE_PAYMENTS_RESTRICTED_KEY: 'rk_test_payments',
      STRIPE_PLATFORM_RESTRICTED_KEY: 'rk_test_platform',
      STRIPE_SECRET_KEY: 'sk_test_fallback',
    },
    StripeCtor,
  });
  const fallbackClient = createPlatformStripeClient({
    purpose: STRIPE_CLIENT_PURPOSES.PAYMENTS,
    env: { STRIPE_SECRET_KEY: 'sk_test_fallback_only' },
    StripeCtor,
  });

  expect(calls.map((call) => call.key)).toEqual([
    'rk_test_payments',
    'sk_test_fallback_only',
  ]);
  expect(getStripeClientMetadata(paymentClient)).toMatchObject({
    credentialSource: 'STRIPE_PAYMENTS_RESTRICTED_KEY',
    credentialClass: 'restricted',
    mode: 'test',
  });
  expect(getStripeClientMetadata(fallbackClient)).toMatchObject({
    credentialSource: 'STRIPE_SECRET_KEY',
    credentialClass: 'secret',
    mode: 'test',
  });
});

test('test and live configuration cannot be silently mixed', () => {
  const StripeCtor = capturingStripeConstructor([]);

  expect(() => createPlatformStripeClient({
    purpose: STRIPE_CLIENT_PURPOSES.REFUNDS,
    env: {
      STRIPE_REFUNDS_RESTRICTED_KEY: fakeCredential('rk', 'live', 'refunds'),
      STRIPE_SECRET_KEY: 'sk_test_fallback',
    },
    StripeCtor,
  })).toThrowError(/cannot be configured together/i);

  expect(() => createPlatformStripeClient({
    env: { STRIPE_SECRET_KEY: fakeCredential('sk', 'live', 'platform') },
    expectedMode: 'test',
    StripeCtor,
  })).toThrowError(/does not match/i);

  expect(() => createPlatformStripeClient({
    purpose: STRIPE_CLIENT_PURPOSES.PAYOUTS,
    env: { STRIPE_PAYOUTS_RESTRICTED_KEY: 'sk_test_not_restricted' },
    StripeCtor,
  })).toThrowError(/must contain a restricted/i);
});

test('timeout, retry, and telemetry settings are explicit and centralized', () => {
  const calls = [];
  const StripeCtor = capturingStripeConstructor(calls);
  const env = { STRIPE_SECRET_KEY: 'sk_test_network' };

  createPlatformStripeClient({ env, StripeCtor });
  createPlatformStripeClient({
    env,
    StripeCtor,
    networkProfile: STRIPE_NETWORK_PROFILES.READ_ONLY_AUDIT,
  });

  expect(calls[0].config).toEqual({
    apiVersion: STRIPE_API_VERSION,
    timeout: 80_000,
    maxNetworkRetries: 1,
    telemetry: true,
  });
  expect(calls[1].config).toEqual({
    apiVersion: STRIPE_API_VERSION,
    timeout: 80_000,
    maxNetworkRetries: 2,
    telemetry: true,
  });
});

test('missing or unsafe credentials fail closed without exposing a key', () => {
  const StripeCtor = capturingStripeConstructor([]);
  const missing = () => createPlatformStripeClient({ env: {}, StripeCtor });
  const malformed = () => createPlatformStripeClient({
    env: { STRIPE_SECRET_KEY: 'not-a-stripe-key' },
    StripeCtor,
  });

  expect(missing).toThrowError(/not configured/i);
  expect(malformed).toThrowError(/format is not recognized/i);
  for (const action of [missing, malformed]) {
    try {
      action();
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain('not-a-stripe-key');
    }
  }
});

test('sanitized Stripe error classification excludes raw provider details', () => {
  const secret = fakeCredential('sk', 'live', 'must_never_escape');
  const classified = classifyStripeError({
    type: 'StripeAPIError',
    code: 'api_error',
    statusCode: 503,
    requestId: 'req_Safe123',
    message: `provider body with ${secret}`,
    raw: { request_body: `card and ${secret}` },
    stack: `stack trace with ${secret}`,
  });
  const serialized = JSON.stringify(classified);

  expect(classified).toEqual({
    provider: 'stripe',
    category: 'api',
    code: 'api_error',
    declineCode: null,
    statusCode: 503,
    requestId: 'req_Safe123',
    retryable: true,
  });
  expect(serialized).not.toContain(secret);
  expect(serialized).not.toContain('provider body');
  expect(serialized).not.toContain('request_body');
  expect(serialized).not.toContain('stack trace');
});

test('fake clients can be injected without a constructor or network access', () => {
  const fake = { refunds: { create: async () => ({ id: 're_fake' }) } };
  const returned = createPlatformStripeClient({
    purpose: STRIPE_CLIENT_PURPOSES.REFUNDS,
    client: fake,
    injectedMode: 'test',
    expectedMode: 'test',
    env: {},
    StripeCtor: null,
  });

  expect(returned).toBe(fake);
  expect(getStripeClientMetadata(fake)).toMatchObject({
    purpose: STRIPE_CLIENT_PURPOSES.REFUNDS,
    mode: 'test',
    injected: true,
  });
});

test('production construction exists only in the Stripe client boundary', () => {
  const directConstruction = /require\s*\(\s*['"]stripe['"]\s*\)|new\s+Stripe\s*\(/;
  const productionFiles = [
    ...javascriptFiles(path.join(repoRoot, 'api')),
    ...javascriptFiles(path.join(repoRoot, 'scripts')),
  ];
  const offenders = productionFiles
    .filter((file) => path.basename(file) !== '_stripe-clients.js')
    .filter((file) => directConstruction.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(repoRoot, file));

  expect(offenders).toEqual([]);

  const fixture = fs.readFileSync(
    path.join(repoRoot, 'tests', 'payout-v2-webhook.integration.spec.js'),
    'utf8'
  );
  expect(fixture).toContain('Test-only signing helper');
  expect(fixture).toContain("new Stripe('sk_test_payout_v2_slice5_fixture')");
});
