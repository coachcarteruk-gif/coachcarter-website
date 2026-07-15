// @ts-check
const { test, expect } = require('@playwright/test');
const path = require('path');
const jwt = require('jsonwebtoken');

const repoRoot = path.resolve(__dirname, '..');
const secret = 'learner-passwordless-signup-test-secret';

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    getHeader(name) {
      return this.headers[name.toLowerCase()];
    },
  };
}

function makeSql({ existingLearner = null, instructor = null } = {}) {
  const calls = [];
  const user = {
    id: 42,
    name: 'Alex Rider',
    email: 'alex@example.test',
    phone: null,
    school_id: 3,
    current_tier: 1,
    terms_accepted_at: null,
  };

  const sql = async (strings, ...values) => {
    const text = Array.isArray(strings) ? strings.join('?') : String(strings);
    calls.push({ text, values });

    if (/SELECT id FROM instructors/i.test(text)) return instructor ? [instructor] : [];
    if (/SELECT id FROM learner_users/i.test(text)) return existingLearner ? [existingLearner] : [];
    if (/SELECT learner_id FROM referrals/i.test(text)) return [];
    if (/INSERT INTO learner_users/i.test(text)) return [user];
    return [];
  };
  sql.calls = calls;
  return sql;
}

async function withMockedLearnerAuth(sql, auditCalls, run) {
  const relModules = [
    'api/_auth-helpers.js',
    'api/_auth.js',
    'api/_csrf.js',
    'api/_password.js',
    'api/_audit.js',
    'api/_error-alert.js',
    'api/learner-auth.js',
  ];
  const modulePaths = ['@neondatabase/serverless', ...relModules.map((rel) => path.join(repoRoot, rel))];
  const originals = new Map();

  for (const modulePath of modulePaths) {
    try {
      const resolved = require.resolve(modulePath);
      originals.set(resolved, require.cache[resolved]);
      delete require.cache[resolved];
    } catch (_) {}
  }

  require.cache[require.resolve('@neondatabase/serverless')] = {
    exports: { neon: () => sql },
  };
  require.cache[require.resolve(path.join(repoRoot, 'api/_auth-helpers.js'))] = {
    exports: { sanitizeEmail: (email) => String(email || '').trim().toLowerCase() },
  };
  require.cache[require.resolve(path.join(repoRoot, 'api/_auth.js'))] = {
    exports: {
      SESSION_COOKIE_NAMES: { learner: 'cc_learner' },
      SESSION_MAX_AGE_SEC: { learner: 180 * 24 * 60 * 60 },
      buildSessionCookie: (name, token) => `${name}=${token}; Path=/; HttpOnly`,
    },
  };
  require.cache[require.resolve(path.join(repoRoot, 'api/_csrf.js'))] = {
    exports: {
      buildCsrfCookie: () => 'cc_csrf=test-csrf; Path=/',
      mintCsrfToken: () => 'test-csrf',
      appendSetCookie: (res, cookie) => {
        const current = res.getHeader('Set-Cookie') || [];
        res.setHeader('Set-Cookie', Array.isArray(current) ? [...current, cookie] : [current, cookie]);
      },
    },
  };
  require.cache[require.resolve(path.join(repoRoot, 'api/_password.js'))] = {
    exports: {
      validatePassword: () => null,
      hashPassword: async () => 'unused-hash',
      verifyPassword: async () => false,
      checkLoginLockout: async () => ({ locked: false }),
      recordFailedLogin: async () => {},
      clearLoginLockout: async () => {},
    },
  };
  require.cache[require.resolve(path.join(repoRoot, 'api/_audit.js'))] = {
    exports: { logAudit: async (_sql, payload) => auditCalls.push(payload) },
  };
  require.cache[require.resolve(path.join(repoRoot, 'api/_error-alert.js'))] = {
    exports: { reportError: () => {} },
  };

  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = secret;
  try {
    const handler = require(path.join(repoRoot, 'api/learner-auth.js'));
    await run(handler);
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
    for (const modulePath of modulePaths) {
      try {
        const resolved = require.resolve(modulePath);
        if (originals.get(resolved)) require.cache[resolved] = originals.get(resolved);
        else delete require.cache[resolved];
      } catch (_) {}
    }
  }
}

async function call(handler, body) {
  const req = {
    method: 'POST',
    query: { action: 'signup-with-code' },
    body,
    headers: {},
    url: '/api/learner-auth?action=signup-with-code',
  };
  const res = makeRes();
  await handler(req, res);
  return res;
}

test.describe('passwordless offline learner signup', () => {
  test('requires a purpose-bound signup verification ticket', async () => {
    const sql = makeSql();
    await withMockedLearnerAuth(sql, [], async (handler) => {
      const wrongTicket = jwt.sign(
        { sub: 'alex@example.test', role: 'learner', purpose: 'login', school_id: 3 },
        secret,
        { expiresIn: '5m', audience: 'password-set' }
      );
      const res = await call(handler, { ticket: wrongTicket, name: 'Alex Rider' });

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('invalid_ticket');
      expect(sql.calls.some((entry) => /INSERT INTO learner_users/i.test(entry.text))).toBe(false);
    });
  });

  test('creates a verified zero-credit account without a password or free-trial ledger row', async () => {
    const sql = makeSql();
    const auditCalls = [];
    await withMockedLearnerAuth(sql, auditCalls, async (handler) => {
      const ticket = jwt.sign(
        { sub: 'Alex@Example.test', role: 'learner', purpose: 'signup', school_id: 3 },
        secret,
        { expiresIn: '5m', audience: 'learner-signup' }
      );
      const res = await call(handler, { ticket, name: 'Alex Rider' });

      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({
        success: true,
        is_new_user: true,
        needs_name: false,
        user: { id: 42, email: 'alex@example.test', school_id: 3 },
      });

      const insert = sql.calls.find((entry) => /INSERT INTO learner_users/i.test(entry.text));
      expect(insert).toBeTruthy();
      expect(insert.text).toContain('email_verified');
      expect(insert.text).not.toContain('password_hash');
      expect(insert.values).toContain('alex@example.test');
      expect(insert.values).toContain('Alex Rider');
      expect(sql.calls.some((entry) => /INSERT INTO credit_transactions/i.test(entry.text))).toBe(false);

      expect(auditCalls).toHaveLength(1);
      expect(auditCalls[0]).toMatchObject({
        action: 'learner.signup',
        schoolId: 3,
        details: {
          method: 'email_code',
          source: 'offline_lesson_or_trial',
          free_trial_credit_minutes: 0,
        },
      });

      const cookies = res.getHeader('Set-Cookie');
      expect(cookies.some((cookie) => cookie.startsWith('cc_learner=') && cookie.includes('HttpOnly'))).toBe(true);
      expect(cookies.some((cookie) => cookie.startsWith('cc_csrf='))).toBe(true);
    });
  });

  test('does not create a duplicate learner after verification', async () => {
    const sql = makeSql({ existingLearner: { id: 9 } });
    await withMockedLearnerAuth(sql, [], async (handler) => {
      const ticket = jwt.sign(
        { sub: 'alex@example.test', role: 'learner', purpose: 'signup', school_id: 3 },
        secret,
        { expiresIn: '5m', audience: 'learner-signup' }
      );
      const res = await call(handler, { ticket, name: 'Alex Rider' });

      expect(res.statusCode).toBe(409);
      expect(res.body.error).toBe('account_exists');
      expect(sql.calls.some((entry) => /INSERT INTO learner_users/i.test(entry.text))).toBe(false);
    });
  });
});
