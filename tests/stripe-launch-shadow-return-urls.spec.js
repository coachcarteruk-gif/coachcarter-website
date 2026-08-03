const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const {
  PAYMENT_CONTRACT_SCHEMA_VERSION,
  PAYMENT_ORIGINS,
} = require('../api/_stripe-launch-payment-contracts');
const {
  resolveStripeCheckoutReturnUrls,
} = require('../api/_stripe-launch-shadow-return-urls');

const repoRoot = path.resolve(__dirname, '..');
const baseEnv = Object.freeze({
  STRIPE_LAUNCH_SHADOW_OPERATIONS_ENABLED: 'true',
  STRIPE_LAUNCH_SHADOW_PROJECT_ID: 'prj_Shadow05Identity',
  STRIPE_LAUNCH_SHADOW_SCHOOL_ID: '7',
  STRIPE_LAUNCH_SHADOW_VERCEL_ENV: 'production',
  STRIPE_LAUNCH_SHADOW_DEPLOYMENT_HOST: 'cc-simon-shadow-05-abc123.vercel.app',
  STRIPE_LAUNCH_SHADOW_NEON_PROJECT_ID: 'shadow-project-12345678',
  STRIPE_LAUNCH_SHADOW_NEON_BRANCH_ID: 'br-shadow-05-abcdef',
  STRIPE_LAUNCH_SHADOW_NEON_ENDPOINT_HOST: 'ep-shadow-05.eu-west-2.aws.neon.tech',
  STRIPE_LAUNCH_SHADOW_NEON_DATABASE_NAME: 'shadowdb',
  STRIPE_MODE: 'test',
  VERCEL_PROJECT_ID: 'prj_Shadow05Identity',
  VERCEL_ENV: 'production',
  VERCEL_URL: 'cc-simon-shadow-05-abc123.vercel.app',
  NEON_PROJECT_ID: 'shadow-project-12345678',
  NEON_BRANCH_ID: 'br-shadow-05-abcdef',
  POSTGRES_URL: 'postgresql://shadow_user:secret@ep-shadow-05.eu-west-2.aws.neon.tech/shadowdb',
});

const sql = async () => [{ database_name: 'shadowdb' }];

function metadata(origin) {
  return {
    payment_contract_candidate_id: '5df71872-7c2a-4ae5-a1d9-2f1069f43524',
    payment_contract_schema_version: PAYMENT_CONTRACT_SCHEMA_VERSION,
    payment_origin: origin,
  };
}

function functionBody(source, name) {
  const start = source.indexOf(`async function ${name}`);
  if (start < 0) return '';
  const next = source.indexOf('\nasync function ', start + 1);
  return source.slice(start, next < 0 ? source.length : next);
}

test.describe('fail-closed Stripe launch shadow Checkout return URLs', () => {
  for (const origin of Object.values(PAYMENT_ORIGINS)) {
    test(`${origin} binds both success and cancellation to the exact shadow deployment`, async () => {
      const result = await resolveStripeCheckoutReturnUrls({
        env: { ...baseEnv },
        sql,
        schoolId: 7,
        launchMetadata: metadata(origin),
        legacyBaseUrl: 'https://evil.example',
        successPath: '/learner/book.html?paid=1',
        cancelPath: '/learner/book.html?cancelled=1',
      });
      expect(result).toMatchObject({
        shadow: true,
        paymentOrigin: origin,
        successUrl: 'https://cc-simon-shadow-05-abc123.vercel.app/learner/book.html?paid=1',
        cancelUrl: 'https://cc-simon-shadow-05-abc123.vercel.app/learner/book.html?cancelled=1',
      });
      expect(result.successUrl).not.toContain('coachcarter.uk');
      expect(result.cancelUrl).not.toContain('evil.example');
    });
  }

  test('a missing client Origin succeeds only from complete trusted deployment evidence', async () => {
    const result = await resolveStripeCheckoutReturnUrls({
      env: { ...baseEnv },
      sql,
      schoolId: 7,
      launchMetadata: metadata(PAYMENT_ORIGINS.DIRECT_SLOT),
      legacyBaseUrl: 'https://coachcarter.uk',
      successPath: '/learner/book.html?paid=1',
      cancelPath: '/learner/book.html?cancelled=1',
    });
    expect(result.successUrl).toContain('cc-simon-shadow-05-abc123.vercel.app');
    expect(result.cancelUrl).toContain('cc-simon-shadow-05-abc123.vercel.app');
  });

  test('bootstraps both return URLs from runtime VERCEL_URL when no custom deployment host exists', async () => {
    const runtimeOnlyEnv = { ...baseEnv };
    delete runtimeOnlyEnv.STRIPE_LAUNCH_SHADOW_DEPLOYMENT_HOST;
    const result = await resolveStripeCheckoutReturnUrls({
      env: runtimeOnlyEnv,
      sql,
      schoolId: 7,
      launchMetadata: metadata(PAYMENT_ORIGINS.DIRECT_SLOT),
      legacyBaseUrl: 'https://coachcarter.uk',
      successPath: '/learner/book.html?paid=1',
      cancelPath: '/learner/book.html?cancelled=1',
    });
    expect(result).toMatchObject({
      shadow: true,
      successUrl: 'https://cc-simon-shadow-05-abc123.vercel.app/learner/book.html?paid=1',
      cancelUrl: 'https://cc-simon-shadow-05-abc123.vercel.app/learner/book.html?cancelled=1',
    });
  });

  for (const [name, patch, field] of [
    ['missing trusted deployment host', { STRIPE_LAUNCH_SHADOW_DEPLOYMENT_HOST: '' }, 'vercel.deployment_host'],
    ['malformed trusted deployment host', { STRIPE_LAUNCH_SHADOW_DEPLOYMENT_HOST: 'https://shadow.example/path' }, 'vercel.deployment_host'],
    ['production fallback as trusted host', { STRIPE_LAUNCH_SHADOW_DEPLOYMENT_HOST: 'coachcarter.uk' }, 'vercel.deployment_host'],
    ['runtime deployment mismatch', { VERCEL_URL: 'cc-simon-shadow-05-other.vercel.app' }, 'vercel.deployment_host'],
  ]) {
    test(`fails closed for ${name}`, async () => {
      await expect(resolveStripeCheckoutReturnUrls({
        env: { ...baseEnv, ...patch },
        sql,
        schoolId: 7,
        launchMetadata: metadata(PAYMENT_ORIGINS.DIRECT_SLOT),
        legacyBaseUrl: 'https://coachcarter.uk',
        successPath: '/learner/book.html?paid=1',
        cancelPath: '/learner/book.html?cancelled=1',
      })).rejects.toMatchObject({ fields: expect.arrayContaining([field]) });
    });
  }

  test('rejects malformed candidate and arbitrary absolute redirect evidence', async () => {
    await expect(resolveStripeCheckoutReturnUrls({
      env: { ...baseEnv },
      sql,
      schoolId: 7,
      launchMetadata: { payment_origin: PAYMENT_ORIGINS.DIRECT_SLOT },
      legacyBaseUrl: 'https://coachcarter.uk',
      successPath: '/learner/book.html?paid=1',
      cancelPath: '/learner/book.html?cancelled=1',
    })).rejects.toMatchObject({ code: 'STRIPE_LAUNCH_SHADOW_RETURN_URL_EVIDENCE_INVALID' });

    await expect(resolveStripeCheckoutReturnUrls({
      env: { ...baseEnv },
      sql,
      schoolId: 7,
      launchMetadata: metadata(PAYMENT_ORIGINS.DIRECT_SLOT),
      legacyBaseUrl: 'https://coachcarter.uk',
      successPath: 'https://evil.example/paid',
      cancelPath: '//evil.example/cancelled',
    })).rejects.toMatchObject({ code: 'STRIPE_LAUNCH_SHADOW_RETURN_URL_PATH_INVALID' });
  });

  test('keeps the existing live/non-shadow URL contract unchanged', async () => {
    const result = await resolveStripeCheckoutReturnUrls({
      env: {},
      sql: null,
      schoolId: 1,
      launchMetadata: {},
      legacyBaseUrl: 'https://coachcarter.uk',
      successPath: '/learner/book.html?paid=1',
      cancelPath: '/learner/book.html?cancelled=1',
    });
    expect(result).toEqual({
      successUrl: 'https://coachcarter.uk/learner/book.html?paid=1',
      cancelUrl: 'https://coachcarter.uk/learner/book.html?cancelled=1',
      shadow: false,
    });
  });

  test('all four Checkout producers resolve URLs before creating a session', () => {
    const slots = fs.readFileSync(path.join(repoRoot, 'api', 'slots.js'), 'utf8');
    const offers = fs.readFileSync(path.join(repoRoot, 'api', 'offers.js'), 'utf8');
    const slices = [
      ['direct_slot', functionBody(slots, 'handleCheckoutSlot')],
      ['direct_slot_guest', functionBody(slots, 'handleCheckoutSlotGuest')],
      ['test_date_direct', functionBody(slots, 'handleCheckoutTestDate')],
      ['captured_request', functionBody(slots, 'handleCheckoutRequest')],
      ['one_off_offer', offers.slice(offers.indexOf('const launchMetadata = !isFlexible'))],
    ];
    for (const [name, source] of slices) {
      const resolver = source.indexOf('resolveStripeCheckoutReturnUrls({');
      const checkout = source.indexOf('stripe.checkout.sessions.create({');
      expect(resolver, `${name} resolver`).toBeGreaterThanOrEqual(0);
      expect(checkout, `${name} Checkout`).toBeGreaterThan(resolver);
      expect(source).toContain('success_url: checkoutReturnUrls.successUrl');
      expect(source).toContain('cancel_url:');
      expect(source).toContain('checkoutReturnUrls.cancelUrl');
    }
  });
});
