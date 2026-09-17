// @ts-check
const { test, expect } = require('@playwright/test');
const path = require('path');
const jwt = require('jsonwebtoken');
const fs = require('fs');

const repoRoot = path.resolve(__dirname, '..');
const secret = 'learner-email-migration-security-test-secret';

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    getHeader(name) { return this.headers[name.toLowerCase()]; },
  };
}

async function withMockedLearnerAuth({ auth, sql }, run) {
  const relModules = [
    'api/_auth-helpers.js',
    'api/_auth.js',
    'api/_csrf.js',
    'api/_password.js',
    'api/_audit.js',
    'api/_error-alert.js',
    'api/_rate-limit.js',
    'api/_tenant.js',
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

  require.cache[require.resolve('@neondatabase/serverless')] = { exports: { neon: () => sql } };
  require.cache[require.resolve(path.join(repoRoot, 'api/_auth-helpers.js'))] = {
    exports: {
      sanitizeEmail: (email) => String(email || '').trim().toLowerCase(),
      createTransporter: () => ({ sendMail: async () => {} }),
    },
  };
  require.cache[require.resolve(path.join(repoRoot, 'api/_auth.js'))] = {
    exports: {
      SESSION_COOKIE_NAMES: { learner: 'cc_learner' },
      SESSION_MAX_AGE_SEC: { learner: 180 * 24 * 60 * 60 },
      buildSessionCookie: (name, token) => `${name}=${token}; Path=/; HttpOnly`,
      requireAuth: () => auth,
    },
  };
  require.cache[require.resolve(path.join(repoRoot, 'api/_csrf.js'))] = {
    exports: {
      buildCsrfCookie: () => 'cc_csrf=test; Path=/',
      mintCsrfToken: () => 'test',
      appendSetCookie: () => {},
    },
  };
  require.cache[require.resolve(path.join(repoRoot, 'api/_password.js'))] = {
    exports: {
      validatePassword: () => null,
      hashPassword: async () => 'secure-hash',
      verifyPassword: async () => false,
      checkLoginLockout: async () => ({ locked: false }),
      recordFailedLogin: async () => {},
      clearLoginLockout: async () => {},
    },
  };
  require.cache[require.resolve(path.join(repoRoot, 'api/_audit.js'))] = {
    exports: { logAudit: async () => {} },
  };
  require.cache[require.resolve(path.join(repoRoot, 'api/_error-alert.js'))] = {
    exports: { reportError: () => {} },
  };
  require.cache[require.resolve(path.join(repoRoot, 'api/_rate-limit.js'))] = {
    exports: {
      checkRateLimit: async () => ({ allowed: true, remaining: 4 }),
      getClientIp: () => '127.0.0.1',
    },
  };
  require.cache[require.resolve(path.join(repoRoot, 'api/_tenant.js'))] = {
    exports: { resolveSchoolFromRequest: async () => ({ schoolId: 3 }) },
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

function request(action, body = {}) {
  return {
    method: 'POST',
    query: { action },
    body,
    headers: {},
    socket: {},
    url: `/api/learner-auth?action=${action}`,
  };
}

test.describe('phone-only learner email migration security', () => {
  test('frontend sends add-email through the cookie and CSRF-aware client', () => {
    const loginJs = fs.readFileSync(path.join(repoRoot, 'public/learner/login.js'), 'utf8');
    expect(loginJs).toContain("window.ccAuth.fetchAuthed('/api/learner-auth?action=add-email'");
    expect(loginJs).toContain('body: JSON.stringify({ email: email })');
    expect(loginJs).not.toContain('body: JSON.stringify({ phone: smsPhone, email: email })');
  });

  test('rejects add-email without the SMS-authenticated learner session', async () => {
    let sqlCalled = false;
    const sql = async () => { sqlCalled = true; return []; };

    await withMockedLearnerAuth({ auth: null, sql }, async (handler) => {
      const res = makeRes();
      await handler(request('add-email', { email: 'attacker@example.test' }), res);

      expect(res.statusCode).toBe(401);
      expect(res.body.error).toBe('Unauthorised');
      expect(sqlCalled).toBe(false);
    });
  });

  test('stores the proposed email on a school-scoped token without changing the learner', async () => {
    const calls = [];
    const sql = async (strings, ...values) => {
      const text = Array.isArray(strings) ? strings.join('?') : String(strings);
      calls.push({ text, values });
      if (/SELECT id, school_id, phone, email, password_hash/i.test(text)) {
        return [{ id: 7, school_id: 3, phone: '07700900123', email: null, password_hash: null }];
      }
      if (/SELECT id FROM learner_users/i.test(text)) return [];
      return [];
    };

    await withMockedLearnerAuth({ auth: { id: 7, role: 'learner', school_id: 3 }, sql }, async (handler) => {
      const res = makeRes();
      await handler(request('add-email', { email: 'Owner@Example.test' }), res);

      expect(res.statusCode).toBe(200);
      expect(calls.some((call) => /UPDATE learner_users/i.test(call.text))).toBe(false);
      const learnerLookup = calls.find((call) => /SELECT id, school_id, phone, email, password_hash/i.test(call.text));
      expect(learnerLookup.text).toMatch(/WHERE id = \?\s+AND school_id = \?/i);
      expect(learnerLookup.values).toEqual([7, 3]);
      const tokenInsert = calls.find((call) => /INSERT INTO magic_link_tokens/i.test(call.text));
      expect(tokenInsert.text).toContain('phone');
      expect(tokenInsert.values).toContain('owner@example.test');
      expect(tokenInsert.values).toContain('07700900123');
      expect(tokenInsert.values).toContain(3);
    });
  });

  test('applies the verified email and password atomically to the ticket-bound learner and school', async () => {
    const calls = [];
    const sql = async (strings, ...values) => {
      const text = Array.isArray(strings) ? strings.join('?') : String(strings);
      calls.push({ text, values });
      if (/UPDATE learner_users/i.test(text) && /RETURNING id/i.test(text)) {
        return [{
          id: 7,
          name: 'Phone Learner',
          email: 'owner@example.test',
          phone: '07700900123',
          school_id: 3,
          current_tier: 'standard',
          terms_accepted_at: null,
          password_hash: 'secure-hash',
        }];
      }
      return [];
    };
    const ticket = jwt.sign(
      {
        sub: 'owner@example.test',
        role: 'learner',
        purpose: 'migration',
        learner_id: 7,
        school_id: 3,
      },
      secret,
      { expiresIn: '5m', audience: 'password-set' }
    );

    await withMockedLearnerAuth({ auth: null, sql }, async (handler) => {
      const res = makeRes();
      await handler(request('set-password', { ticket, password: 'Correct-Horse-123' }), res);

      expect(res.statusCode).toBe(200);
      const update = calls.find((call) => /UPDATE learner_users/i.test(call.text) && /RETURNING id/i.test(call.text));
      expect(update.text).toMatch(/SET email = \?/i);
      expect(update.text).toMatch(/WHERE id = \?\s+AND school_id = \?\s+AND password_hash IS NULL/i);
      expect(update.values).toEqual(['owner@example.test', 'secure-hash', 7, 3]);
    });
  });
});
