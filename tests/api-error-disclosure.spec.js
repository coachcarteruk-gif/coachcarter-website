// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const canary = 'relation "private_financial_table" does not exist';

test('migration endpoints do not serialize raw database errors', () => {
  const files = fs.readdirSync(path.join(repoRoot, 'api'))
    .filter((name) => /^migrate.*\.js$/.test(name));

  for (const name of files) {
    const source = fs.readFileSync(path.join(repoRoot, 'api', name), 'utf8');
    expect(source, name).not.toMatch(/(?:details|error|message)\s*:\s*(?:err|error)\.message/);
  }
});

test('aggregate migration logs statement failures but returns a stable message', async () => {
  const migratePath = path.join(repoRoot, 'api/migrate.js');
  const neonPath = require.resolve('@neondatabase/serverless');
  const authPath = path.join(repoRoot, 'api/_auth.js');
  const alertPath = path.join(repoRoot, 'api/_error-alert.js');
  const modulePaths = [migratePath, neonPath, authPath, alertPath].map(require.resolve);
  const originals = new Map(modulePaths.map((resolved) => [resolved, require.cache[resolved]]));
  const originalConsoleError = console.error;
  const logged = [];

  try {
    for (const resolved of modulePaths) delete require.cache[resolved];
    require.cache[neonPath] = { exports: { neon: () => async () => { throw new Error(canary); } } };
    require.cache[require.resolve(authPath)] = { exports: { safeEqual: () => true } };
    require.cache[require.resolve(alertPath)] = { exports: { reportError: () => {} } };
    console.error = (...args) => logged.push(args);

    const handler = require(migratePath);
    const res = makeRes();
    await handler({ method: 'POST', query: { secret: 'test' }, headers: {} }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.errors).toBeGreaterThan(0);
    expect(JSON.stringify(res.body)).not.toContain(canary);
    expect(res.body.results.every((row) => row.status !== 'error' || row.error === 'Statement failed')).toBe(true);
    expect(logged.some((args) => args.some((arg) => String(arg && arg.message || arg).includes(canary)))).toBe(true);
  } finally {
    console.error = originalConsoleError;
    for (const resolved of modulePaths) {
      const original = originals.get(resolved);
      if (original) require.cache[resolved] = original;
      else delete require.cache[resolved];
    }
  }
});

test('admin payout detail sanitization removes provider and database messages', () => {
  const { sanitizePayoutDetails } = require('../api/_response-sanitizers');
  const result = sanitizePayoutDetails([
    { instructor_id: 1, status: 'error', error: canary },
    { school_id: 2, status: 'failed', error: 'Stripe secret detail' },
    { school_id: 3, status: 'refused', code: 'V1_PAYOUTS_DISABLED', error: 'internal policy wording' },
    { school_id: 4, status: 'completed', transfer_id: 'tr_test' },
  ]);

  expect(JSON.stringify(result)).not.toContain(canary);
  expect(JSON.stringify(result)).not.toContain('Stripe secret detail');
  expect(JSON.stringify(result)).not.toContain('internal policy wording');
  expect(result[0].error).toBe('Payout processing failed');
  expect(result[2]).toMatchObject({ status: 'refused', code: 'V1_PAYOUTS_DISABLED', error: 'Payout processing refused' });
  expect(result[3]).toMatchObject({ status: 'completed', transfer_id: 'tr_test' });
});

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}
