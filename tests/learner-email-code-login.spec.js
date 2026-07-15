// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'learner-email-code-test-secret';
process.env.POSTGRES_URL = process.env.POSTGRES_URL || 'postgres://mock';

const repoRoot = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), 'utf8');
}

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

async function call(handler, { action, body = {} }) {
  const req = {
    method: 'POST',
    query: { action },
    body,
    headers: {},
    url: `/api/magic-link?action=${action}`,
  };
  const res = makeRes();
  await handler(req, res);
  return res;
}

function makeSql({ learner = null, tokenRows = [] } = {}) {
  const calls = [];
  const sql = async (strings, ...values) => {
    const text = Array.isArray(strings) ? strings.join('?') : String(strings);
    calls.push({ text, values });

    if (/SELECT request_count FROM rate_limits/i.test(text)) return [];
    if (/SELECT id FROM instructors/i.test(text)) return [];
    if (/SELECT id, password_hash FROM learner_users/i.test(text)) return learner ? [learner] : [];
    if (/SELECT id, school_id FROM magic_link_tokens/i.test(text)) return tokenRows;
    if (/SELECT id, name, email, phone, school_id, current_tier, terms_accepted_at/i.test(text)) {
      return learner ? [learner] : [];
    }
    return [];
  };
  sql.calls = calls;
  return sql;
}

function withMockedMagicLink(sql, sendMail, run) {
  const modulePaths = [
    '@neondatabase/serverless',
    path.join(repoRoot, 'api', '_auth-helpers.js'),
    path.join(repoRoot, 'api', '_error-alert.js'),
    path.join(repoRoot, 'api', '_credit-grant.js'),
    path.join(repoRoot, 'api', 'magic-link.js'),
  ];
  const originals = new Map();
  for (const p of modulePaths) {
    try {
      const resolved = require.resolve(p);
      originals.set(resolved, require.cache[resolved]);
      delete require.cache[resolved];
    } catch (_) {}
  }

  require.cache[require.resolve('@neondatabase/serverless')] = {
    exports: { neon: () => sql },
  };
  require.cache[require.resolve(path.join(repoRoot, 'api', '_auth-helpers.js'))] = {
    exports: {
      createTransporter: () => ({ sendMail }),
      generateToken: () => 'long-token-for-test',
      sanitizeEmail: (email) => String(email || '').trim().toLowerCase(),
    },
  };
  require.cache[require.resolve(path.join(repoRoot, 'api', '_error-alert.js'))] = {
    exports: { reportError: () => {} },
  };
  require.cache[require.resolve(path.join(repoRoot, 'api', '_credit-grant.js'))] = {
    exports: { lockBalanceAndMutate: async () => ({ ok: true }) },
  };

  try {
    const handler = require(path.join(repoRoot, 'api', 'magic-link.js'));
    return run(handler);
  } finally {
    for (const p of modulePaths) {
      try {
        const resolved = require.resolve(p);
        if (originals.has(resolved) && originals.get(resolved)) {
          require.cache[resolved] = originals.get(resolved);
        } else {
          delete require.cache[resolved];
        }
      } catch (_) {}
    }
  }
}

test.describe('learner email-code login', () => {
  test('existing learner without a password can request a login code', async () => {
    const sql = makeSql({ learner: { id: 7, password_hash: null } });
    const sent = [];

    await withMockedMagicLink(sql, async (mail) => sent.push(mail), async (handler) => {
      const res = await call(handler, {
        action: 'send-email-code',
        body: { email: 'NoPass@Example.test', purpose: 'login', role: 'learner' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(sent).toHaveLength(1);
      expect(sql.calls.some((call) =>
        /INSERT INTO magic_link_tokens/i.test(call.text) &&
        call.values.includes('login') &&
        call.values.includes('learner')
      )).toBe(true);
    });
  });

  test('existing learner with a password can request a login code', async () => {
    const sql = makeSql({ learner: { id: 8, password_hash: 'hash' } });
    const sent = [];

    await withMockedMagicLink(sql, async (mail) => sent.push(mail), async (handler) => {
      const res = await call(handler, {
        action: 'send-email-code',
        body: { email: 'HasPass@Example.test', purpose: 'login', role: 'learner' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(sent).toHaveLength(1);
    });
  });

  test('a new offline learner can request a passwordless signup code', async () => {
    const sql = makeSql({ learner: null });
    const sent = [];

    await withMockedMagicLink(sql, async (mail) => sent.push(mail), async (handler) => {
      const res = await call(handler, {
        action: 'send-email-code',
        body: { email: 'NewLearner@Example.test', purpose: 'signup', role: 'learner' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(sent).toHaveLength(1);
      expect(sent[0].subject).toBe('Verify your CoachCarter email');
      expect(sql.calls.some((entry) =>
        /INSERT INTO magic_link_tokens/i.test(entry.text) &&
        entry.values.includes('signup')
      )).toBe(true);
    });
  });

  test('passwordless signup reports an existing learner and sends no code', async () => {
    const sql = makeSql({ learner: { id: 8, password_hash: null } });
    const sent = [];

    await withMockedMagicLink(sql, async (mail) => sent.push(mail), async (handler) => {
      const res = await call(handler, {
        action: 'send-email-code',
        body: { email: 'Existing@Example.test', purpose: 'signup', role: 'learner' },
      });

      expect(res.statusCode).toBe(409);
      expect(res.body.error).toBe('account_exists');
      expect(sent).toHaveLength(0);
    });
  });

  test('successful signup code verification returns a purpose-bound ticket, not a session', async () => {
    const sql = makeSql({ learner: null, tokenRows: [{ id: 55, school_id: 3 }] });

    await withMockedMagicLink(sql, async () => {}, async (handler) => {
      const res = await call(handler, {
        action: 'verify-email-code',
        body: { email: 'new@example.test', code: '123456', purpose: 'signup', role: 'learner' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.getHeader('Set-Cookie')).toBeUndefined();

      const claims = jwt.verify(res.body.ticket, process.env.JWT_SECRET, { audience: 'learner-signup' });
      expect(claims).toMatchObject({
        sub: 'new@example.test',
        role: 'learner',
        purpose: 'signup',
        token_id: 55,
        school_id: 3,
      });
    });
  });

  test('invalid or expired login code fails without setting cookies', async () => {
    const sql = makeSql({ learner: { id: 9, password_hash: null }, tokenRows: [] });

    await withMockedMagicLink(sql, async () => {}, async (handler) => {
      const res = await call(handler, {
        action: 'verify-email-code',
        body: { email: 'learner@example.test', code: '123456', purpose: 'login', role: 'learner' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('invalid_code');
      expect(res.getHeader('Set-Cookie')).toBeUndefined();
    });
  });

  test('successful login code verification sets learner and CSRF cookies', async () => {
    const learner = {
      id: 10,
      name: 'Dhanya',
      email: 'dhanya@example.test',
      phone: null,
      school_id: 3,
      current_tier: 'standard',
      terms_accepted_at: '2026-01-01T00:00:00Z',
      password_hash: null,
    };
    const sql = makeSql({ learner, tokenRows: [{ id: 44, school_id: 3 }] });

    await withMockedMagicLink(sql, async () => {}, async (handler) => {
      const res = await call(handler, {
        action: 'verify-email-code',
        body: { email: 'dhanya@example.test', code: '654321', purpose: 'login', role: 'learner' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({
        success: true,
        is_new_user: false,
        needs_name: false,
        terms_accepted: true,
        user: { id: 10, email: 'dhanya@example.test', school_id: 3 },
      });

      const cookies = res.getHeader('Set-Cookie');
      expect(cookies.some((cookie) => cookie.startsWith('cc_learner=') && cookie.includes('HttpOnly'))).toBe(true);
      expect(cookies.some((cookie) => cookie.startsWith('cc_csrf='))).toBe(true);

      const learnerCookie = cookies.find((cookie) => cookie.startsWith('cc_learner='));
      const token = learnerCookie.split(';')[0].split('=')[1];
      const claims = jwt.verify(token, process.env.JWT_SECRET);
      expect(claims).toMatchObject({ id: 10, email: 'dhanya@example.test', role: 'learner', school_id: 3 });
      expect(sql.calls.some((call) => /UPDATE learner_users SET last_activity_at = NOW\(\)/i.test(call.text))).toBe(true);
    });
  });

  test('frontend finishLogin stores display-only learner data and redirects', () => {
    const loginJs = read('public/learner/login.js');
    expect(loginJs).toContain("localStorage.setItem('cc_learner', JSON.stringify({ user: data.user }))");
    expect(loginJs).toContain("body: JSON.stringify({ email: email, purpose: 'login', role: 'learner' })");
    expect(loginJs).toContain('finishLogin(out.data)');
    expect(loginJs).toContain("localStorage.removeItem('cc_learner')");
  });

  test('learner emails no longer contain dead token login links', () => {
    const checked = [
      'api/slots.js',
      'api/admin.js',
      'api/setmore-welcome.js',
      'api/magic-link.js',
    ].map(read).join('\n');

    expect(checked).not.toContain('/learner/login.html?token=');
    expect(checked).not.toContain('/learner/verify.html?token=');
    expect(checked).not.toContain('magicUrl');
    expect(read('api/slots.js')).toContain('/learner/login.html?email=');
    expect(read('api/admin.js')).toContain('/learner/login.html?email=');
    expect(read('api/setmore-welcome.js')).toContain('/learner/login.html?email=');
  });
});
