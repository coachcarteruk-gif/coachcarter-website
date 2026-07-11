// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'instructor-email-code-test-secret';
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

function makeSql({ instructor = null, tokenRows = [] } = {}) {
  const calls = [];
  const sql = async (strings, ...values) => {
    const text = Array.isArray(strings) ? strings.join('?') : String(strings);
    calls.push({ text, values });

    if (/SELECT request_count FROM rate_limits/i.test(text)) return [];
    if (/FROM instructors/i.test(text) && /active = TRUE/i.test(text)) return instructor ? [instructor] : [];
    if (/SELECT id, school_id FROM magic_link_tokens/i.test(text)) return tokenRows;
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
      generateToken: () => 'long-token-for-instructor-test',
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

test.describe('instructor email-code login', () => {
  test('active instructor can request a login code', async () => {
    const instructor = { id: 21, email: 'instructor@example.test', active: true };
    const sql = makeSql({ instructor });
    const sent = [];

    await withMockedMagicLink(sql, async (mail) => sent.push(mail), async (handler) => {
      const res = await call(handler, {
        action: 'send-email-code',
        body: { email: 'Instructor@Example.test', purpose: 'login', role: 'instructor' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(sent).toHaveLength(1);
      expect(sql.calls.some((call) =>
        /INSERT INTO magic_link_tokens/i.test(call.text) &&
        call.values.includes('login') &&
        call.values.includes('instructor')
      )).toBe(true);
    });
  });

  test('inactive or unknown instructor email gets generic success and no email', async () => {
    const sql = makeSql({ instructor: null });
    const sent = [];

    await withMockedMagicLink(sql, async (mail) => sent.push(mail), async (handler) => {
      const res = await call(handler, {
        action: 'send-email-code',
        body: { email: 'unknown@example.test', purpose: 'login', role: 'instructor' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(sent).toHaveLength(0);
    });
  });

  test('successful instructor login code verification sets instructor and CSRF cookies', async () => {
    const instructor = {
      id: 22,
      name: 'Fraser',
      email: 'fraser@example.test',
      photo_url: '/photo.jpg',
      school_id: 4,
      onboarding_complete: true,
      must_change_password: true,
      is_admin: true,
      active: true,
    };
    const sql = makeSql({ instructor, tokenRows: [{ id: 77, school_id: 4 }] });

    await withMockedMagicLink(sql, async () => {}, async (handler) => {
      const res = await call(handler, {
        action: 'verify-email-code',
        body: { email: 'fraser@example.test', code: '123456', purpose: 'login', role: 'instructor' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({
        success: true,
        must_change_password: false,
        instructor: {
          id: 22,
          email: 'fraser@example.test',
          school_id: 4,
          is_admin: true,
          onboarding_complete: true,
        },
      });

      const cookies = res.getHeader('Set-Cookie');
      expect(cookies.some((cookie) => cookie.startsWith('cc_instructor=') && cookie.includes('HttpOnly'))).toBe(true);
      expect(cookies.some((cookie) => cookie.startsWith('cc_csrf='))).toBe(true);

      const instructorCookie = cookies.find((cookie) => cookie.startsWith('cc_instructor='));
      const token = instructorCookie.split(';')[0].split('=')[1];
      const claims = jwt.verify(token, process.env.JWT_SECRET);
      expect(claims).toMatchObject({
        id: 22,
        email: 'fraser@example.test',
        role: 'instructor',
        school_id: 4,
        isAdmin: true,
      });
    });
  });

  test('instructor login UI defaults to email-code and still stores display data', () => {
    const js = read('public/instructor/login.js');
    const html = read('public/instructor/login.html');

    expect(js).toContain("body: JSON.stringify({ email: email, purpose: 'login', role: 'instructor' })");
    expect(js).toContain("body: JSON.stringify({ email: pendingEmail, code: code, purpose: 'login', role: 'instructor' })");
    expect(js).toContain("localStorage.setItem('cc_instructor', JSON.stringify({ instructor: data.instructor }))");
    expect(html).toContain('Send sign-in code');
    expect(html).toContain('id="screen-code"');
    expect(html).toContain('Use password instead');
  });
});
