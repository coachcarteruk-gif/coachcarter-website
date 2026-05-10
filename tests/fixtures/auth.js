// @ts-check
/**
 * Authenticated Playwright fixtures for CoachCarter.
 *
 * Each role logs in via the live API (POST /api/<role>-auth?action=login or
 * /api/admin?action=login), captures the Set-Cookie response, and exposes a
 * `storageState`-shaped object that tests can pass to `browser.newContext()`.
 *
 * Why this shape (cookies + localStorage):
 *   The frontend treats the httpOnly JWT cookie as the source of truth for
 *   the API, but ALSO reads a display-only blob from localStorage at the
 *   same key (`cc_learner` / `cc_instructor` / `cc_admin`) to render the
 *   user's name, school, etc. without an extra round-trip. A test that only
 *   sets the cookie will be authenticated but the UI may render as logged-out
 *   until something refreshes the blob — see the memory note on this.
 *
 * Why fixtures, not a `globalSetup` storageState file:
 *   A static storageState file means real credentials need to live somewhere
 *   on disk between runs. Per-test login (worker-scoped) keeps secrets in env
 *   vars only and guarantees we hit a fresh JWT every run.
 *
 * Skipping behaviour:
 *   If CC_TEST_API is not set, every authed test in this file's `test` is
 *   skipped — the cookie-consent suite (which uses the bare `@playwright/test`
 *   import) is unaffected.
 *
 * Required env vars when CC_TEST_API=1:
 *   CC_TEST_BASE_URL              — points at vercel dev (default :3000)
 *   CC_TEST_LEARNER_EMAIL/PASSWORD
 *   CC_TEST_INSTRUCTOR_EMAIL/PASSWORD
 *   CC_TEST_ADMIN_EMAIL/PASSWORD
 *
 * Test usage:
 *   const { test, expect } = require('./fixtures/auth');
 *   test('learner can list bookings', async ({ learnerPage }) => {
 *     await learnerPage.goto('/learner/index.html');
 *     ...
 *   });
 */

const base = require('@playwright/test');

const ROLE_CONFIG = {
  learner: {
    endpoint: '/api/learner-auth?action=login',
    cookie: 'cc_learner',
    blobKey: 'cc_learner',
    blobShape: (body) => ({ user: body.user }),
    envEmail: 'CC_TEST_LEARNER_EMAIL',
    envPass: 'CC_TEST_LEARNER_PASSWORD',
  },
  instructor: {
    endpoint: '/api/instructor-auth?action=login',
    cookie: 'cc_instructor',
    blobKey: 'cc_instructor',
    blobShape: (body) => ({ instructor: body.instructor }),
    envEmail: 'CC_TEST_INSTRUCTOR_EMAIL',
    envPass: 'CC_TEST_INSTRUCTOR_PASSWORD',
  },
  admin: {
    endpoint: '/api/admin?action=login',
    cookie: 'cc_admin',
    blobKey: 'cc_admin',
    blobShape: (body) => ({ admin: body.admin }),
    envEmail: 'CC_TEST_ADMIN_EMAIL',
    envPass: 'CC_TEST_ADMIN_PASSWORD',
  },
};

// Parse a single Set-Cookie header value into the `{ name, value, domain, ... }`
// shape Playwright's storageState expects. We only care about cookies the
// browser would actually send — name, value, domain, path, expires, httpOnly,
// secure, sameSite — defaults are fine for the rest.
function parseSetCookie(setCookieHeader, hostname) {
  const parts = setCookieHeader.split(';').map((s) => s.trim());
  const [nameValue, ...attrs] = parts;
  const eqIdx = nameValue.indexOf('=');
  if (eqIdx < 0) return null;
  const name = nameValue.slice(0, eqIdx);
  const value = nameValue.slice(eqIdx + 1);

  const cookie = {
    name,
    value,
    domain: hostname,
    path: '/',
    expires: -1,
    httpOnly: false,
    secure: false,
    sameSite: 'Lax',
  };

  for (const attr of attrs) {
    const lower = attr.toLowerCase();
    if (lower === 'httponly') cookie.httpOnly = true;
    else if (lower === 'secure') cookie.secure = true;
    else if (lower.startsWith('path=')) cookie.path = attr.slice(5);
    else if (lower.startsWith('max-age=')) {
      const ageSec = parseInt(attr.slice(8), 10);
      if (!isNaN(ageSec)) cookie.expires = Math.floor(Date.now() / 1000) + ageSec;
    } else if (lower.startsWith('expires=')) {
      const t = Date.parse(attr.slice(8));
      if (!isNaN(t)) cookie.expires = Math.floor(t / 1000);
    } else if (lower.startsWith('samesite=')) {
      const s = attr.slice(9).toLowerCase();
      cookie.sameSite = s === 'strict' ? 'Strict' : s === 'none' ? 'None' : 'Lax';
    }
  }
  return cookie;
}

// Set-Cookie can arrive as a single string with comma-separated cookies (rare
// but possible) or as multiple headers. Playwright's APIRequest exposes the
// raw `headers()` map; we normalise both shapes.
function extractSetCookies(headers) {
  const raw = headers['set-cookie'];
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  // Splitting on comma is unsafe (Expires=Wed, 09 Jun ...). Cookies are
  // newline-separated when joined by node's http parser via `\n`.
  return raw.split('\n').map((s) => s.trim()).filter(Boolean);
}

async function loginAndBuildState(role, baseURL, request) {
  const cfg = ROLE_CONFIG[role];
  const email = process.env[cfg.envEmail];
  const password = process.env[cfg.envPass];
  if (!email || !password) {
    throw new Error(`Missing ${cfg.envEmail} or ${cfg.envPass} env var for ${role} login`);
  }

  const res = await request.post(cfg.endpoint, {
    data: { email, password },
  });
  if (!res.ok()) {
    const text = await res.text().catch(() => '');
    throw new Error(`${role} login failed: ${res.status()} ${text}`);
  }
  const body = await res.json();
  const headers = res.headers();
  const url = new URL(baseURL);
  const cookies = extractSetCookies(headers)
    .map((sc) => parseSetCookie(sc, url.hostname))
    .filter(Boolean);

  if (!cookies.find((c) => c.name === cfg.cookie)) {
    throw new Error(`${role} login response missing ${cfg.cookie} cookie`);
  }

  const blob = cfg.blobShape(body);

  return {
    cookies,
    origins: [
      {
        origin: url.origin,
        localStorage: [
          { name: cfg.blobKey, value: JSON.stringify(blob) },
        ],
      },
    ],
  };
}

// Worker-scoped login. Runs once per worker per role and caches the
// storageState. Worker fixtures only see other worker-scoped values, so we
// resolve baseURL from the project config (workerInfo) instead of injecting it.
// Worker-scoped login. Returns null when CC_TEST_API isn't set so the per-test
// fixtures can short-circuit with a skip rather than a login error.
async function buildStorageOrNull(role, playwright, workerInfo) {
  if (!process.env.CC_TEST_API) return null;
  const baseURL = workerInfo.project.use.baseURL || process.env.CC_TEST_BASE_URL || 'http://localhost:3000';
  const request = await playwright.request.newContext({ baseURL });
  try {
    const state = await loginAndBuildState(role, baseURL, request);
    return state;
  } finally {
    await request.dispose();
  }
}

const test = base.test.extend({
  learnerStorage: [async ({ playwright }, use, workerInfo) => {
    await use(await buildStorageOrNull('learner', playwright, workerInfo));
  }, { scope: 'worker' }],

  instructorStorage: [async ({ playwright }, use, workerInfo) => {
    await use(await buildStorageOrNull('instructor', playwright, workerInfo));
  }, { scope: 'worker' }],

  adminStorage: [async ({ playwright }, use, workerInfo) => {
    await use(await buildStorageOrNull('admin', playwright, workerInfo));
  }, { scope: 'worker' }],

  // Per-test pages already loaded with the role's session cookie + display blob.
  // Each role's page fixture skips when CC_TEST_API is unset so the bare
  // cookie-consent suite (which imports @playwright/test directly) is
  // unaffected — only authedTest blocks that touch a *Page or *Request fixture
  // get skipped.
  learnerPage: async ({ browser, learnerStorage }, use, testInfo) => {
    if (!process.env.CC_TEST_API) testInfo.skip(true, 'set CC_TEST_API=1 with vercel dev to run authed tests');
    const ctx = await browser.newContext({ storageState: learnerStorage });
    const page = await ctx.newPage();
    await use(page);
    await ctx.close();
  },

  instructorPage: async ({ browser, instructorStorage }, use, testInfo) => {
    if (!process.env.CC_TEST_API) testInfo.skip(true, 'set CC_TEST_API=1 with vercel dev to run authed tests');
    const ctx = await browser.newContext({ storageState: instructorStorage });
    const page = await ctx.newPage();
    await use(page);
    await ctx.close();
  },

  adminPage: async ({ browser, adminStorage }, use, testInfo) => {
    if (!process.env.CC_TEST_API) testInfo.skip(true, 'set CC_TEST_API=1 with vercel dev to run authed tests');
    const ctx = await browser.newContext({ storageState: adminStorage });
    const page = await ctx.newPage();
    await use(page);
    await ctx.close();
  },

  // Authenticated APIRequestContexts — for tests that hit the API directly
  // and need the cookie attached. Cheaper than newPage for pure JSON tests.
  learnerRequest: async ({ playwright, baseURL, learnerStorage }, use, testInfo) => {
    if (!process.env.CC_TEST_API) testInfo.skip(true, 'set CC_TEST_API=1 with vercel dev to run authed tests');
    const ctx = await playwright.request.newContext({ baseURL, storageState: learnerStorage });
    await use(ctx);
    await ctx.dispose();
  },

  instructorRequest: async ({ playwright, baseURL, instructorStorage }, use, testInfo) => {
    if (!process.env.CC_TEST_API) testInfo.skip(true, 'set CC_TEST_API=1 with vercel dev to run authed tests');
    const ctx = await playwright.request.newContext({ baseURL, storageState: instructorStorage });
    await use(ctx);
    await ctx.dispose();
  },

  adminRequest: async ({ playwright, baseURL, adminStorage }, use, testInfo) => {
    if (!process.env.CC_TEST_API) testInfo.skip(true, 'set CC_TEST_API=1 with vercel dev to run authed tests');
    const ctx = await playwright.request.newContext({ baseURL, storageState: adminStorage });
    await use(ctx);
    await ctx.dispose();
  },
});

module.exports = { test, expect: base.expect };
