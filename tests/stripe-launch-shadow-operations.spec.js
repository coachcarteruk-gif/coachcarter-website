const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_shadow_operations';

const {
  SHADOW_OPERATIONS,
  authorizeStripeLaunchShadowOperation,
} = require('../api/_stripe-launch-shadow-auth');
const { runRequestExpiry } = require('../api/requests');
const { logAuditRequired } = require('../api/_audit');

const repoRoot = path.resolve(__dirname, '..');
const secret = 'shadow-operation-secret-at-least-32-characters';
const baseEnv = Object.freeze({
  STRIPE_LAUNCH_SHADOW_OPERATIONS_ENABLED: 'true',
  STRIPE_LAUNCH_SHADOW_PROJECT_ID: 'prj_shadow_02',
  STRIPE_LAUNCH_SHADOW_SCHOOL_ID: '7',
  STRIPE_LAUNCH_SHADOW_CRON_SECRET: secret,
  STRIPE_MODE: 'test',
  VERCEL_PROJECT_ID: 'prj_shadow_02',
});

function request(overrides = {}) {
  return {
    headers: { authorization: `Bearer ${secret}` },
    query: { school_id: '7' },
    ...overrides,
  };
}

test.describe('Stripe launch shadow operation authentication', () => {
  test('accepts only an exact test-project, tenant, operation and bearer binding', () => {
    expect(authorizeStripeLaunchShadowOperation(request(), {
      operation: SHADOW_OPERATIONS.RECONCILE_PAYMENTS,
      env: { ...baseEnv },
    })).toEqual({
      operation: SHADOW_OPERATIONS.RECONCILE_PAYMENTS,
      projectId: 'prj_shadow_02',
      schoolId: 7,
    });
  });

  for (const [name, envPatch, reqPatch, operation] of [
    ['disabled', { STRIPE_LAUNCH_SHADOW_OPERATIONS_ENABLED: 'false' }, {}, SHADOW_OPERATIONS.RECONCILE_PAYMENTS],
    ['live Stripe mode', { STRIPE_MODE: 'live' }, {}, SHADOW_OPERATIONS.RECONCILE_PAYMENTS],
    ['wrong Vercel project', { VERCEL_PROJECT_ID: 'prj_other' }, {}, SHADOW_OPERATIONS.RECONCILE_PAYMENTS],
    ['short configured secret', { STRIPE_LAUNCH_SHADOW_CRON_SECRET: 'too-short' }, {}, SHADOW_OPERATIONS.RECONCILE_PAYMENTS],
    ['wrong bearer secret', {}, { headers: { authorization: 'Bearer wrong-secret' } }, SHADOW_OPERATIONS.RECONCILE_PAYMENTS],
    ['wrong school', {}, { query: { school_id: '8' } }, SHADOW_OPERATIONS.RECONCILE_PAYMENTS],
    ['missing school', {}, { query: {} }, SHADOW_OPERATIONS.RECONCILE_PAYMENTS],
    ['unsupported operation', {}, {}, 'run_payouts'],
  ]) {
    test(`fails closed for ${name}`, () => {
      expect(authorizeStripeLaunchShadowOperation(request(reqPatch), {
        operation,
        env: { ...baseEnv, ...envPatch },
      })).toBeNull();
    });
  }

  test('routes bind the narrow credential to school-scoped work and audit it', () => {
    const reconcile = fs.readFileSync(path.join(repoRoot, 'api', 'cron-reconcile-payments.js'), 'utf8');
    const requests = fs.readFileSync(path.join(repoRoot, 'api', 'requests.js'), 'utf8');

    expect(reconcile).toContain('operation: SHADOW_OPERATIONS.RECONCILE_PAYMENTS');
    expect(reconcile).toContain('schoolId: shadowAuth.schoolId');
    expect(reconcile).toContain("action: 'stripe-launch-shadow-reconcile-payments'");
    expect(reconcile).toContain("action: 'stripe-launch-shadow-reconcile-payments-started'");
    expect(requests).toContain('operation: SHADOW_OPERATIONS.EXPIRE_REQUESTS');
    expect(requests).toContain('runRequestExpiry(sql, { schoolId: shadowAuth?.schoolId || null })');
    expect(requests).toContain("action: 'stripe-launch-shadow-expire-requests'");
    expect(requests).toContain("action: 'stripe-launch-shadow-expire-requests-started'");
    expect(requests.match(/WHERE school_id = \$\{schoolId\}/g)).toHaveLength(3);
  });

  test('required shadow audit writes fail closed', async () => {
    const sql = async () => { throw new Error('audit unavailable'); };
    await expect(logAuditRequired(sql, {
      action: 'stripe-launch-shadow-reconcile-payments-started',
      schoolId: 7,
      req: { headers: {} },
    })).rejects.toThrow('audit unavailable');
  });

  test('shadow request expiry executes only tenant-scoped read queues', async () => {
    const calls = [];
    const sql = async (strings, ...values) => {
      calls.push({ text: strings.join('?'), values });
      return [];
    };
    await expect(runRequestExpiry(sql, { schoolId: 7 })).resolves.toEqual({
      ok: true,
      expired: 0,
      releases_retried: 0,
      crashed_accepts_closed: 0,
      errors: 0,
    });
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call.text).toMatch(/WHERE school_id = \?/i);
      expect(call.values).toContain(7);
    }
  });
});
