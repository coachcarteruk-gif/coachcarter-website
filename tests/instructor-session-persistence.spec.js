const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const jwt = require('jsonwebtoken');
const auth = require('../api/_auth');
const csrf = require('../api/_csrf');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const secret = 'session-persistence-tests-only';
const operator = { id: 4, name: 'Operator', email: 'operator@example.test', school_id: 1, is_admin: true, active: true };
const colleague = { id: 6, name: 'Colleague', email: 'colleague@example.test', school_id: 1, is_admin: false, active: true };
const sign = (payload, expiresIn = '180d') => jwt.sign(payload, secret, { expiresIn });
const normalToken = (extra = {}) => sign({ id: operator.id, email: operator.email, role: 'instructor', school_id: 1, isAdmin: true, ...extra });

test.beforeEach(() => { process.env.JWT_SECRET = secret; });

function backend(rows = [operator, colleague]) {
  const audits = [];
  const queries = [];
  const sql = async (strings, ...values) => {
    if (!rows) throw new Error('database temporarily unavailable');
    queries.push({ text: strings.join('?'), values });
    return rows.filter(row => row.id === values[0] && row.school_id === values[1] &&
      (!strings.join('').includes('AND active = TRUE') || row.active));
  };
  const context = {
    ...auth, ...csrf, jwt, console, Date, process,
    neon: () => sql, logAudit: async (_, entry) => audits.push(entry), reportError: () => {},
    verifyAdminJWT: req => auth.requireAuth(req, { roles: ['admin'] }),
    getAdminSchoolId: (actor, req) => auth.getSchoolId(actor, req),
    INSTRUCTOR_ACCESS_MAX_AGE_SEC: 7200,
  };
  const source = read('api/admin.js');
  const start = source.indexOf('async function handleAccessInstructorAccount(');
  const end = source.indexOf('async function handleAllLearners(', start);
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  async function call(action, jar, body = {}, options = {}) {
    const headers = { cookie: Object.entries(jar).map(([key, value]) => `${key}=${value}`).join('; ') };
    if (!options.noCsrf) headers['x-csrf-token'] = jar.cc_csrf;
    const req = { method: options.method || 'POST', headers, body, query: {}, url: '/api/admin?action=' + action };
    const res = { statusCode: 200, headers: {}, status(code) { this.statusCode = code; return this; },
      json(data) { this.body = data; return this; },
      setHeader(key, value) { this.headers[key] = value; }, getHeader(key) { return this.headers[key]; } };
    await context[action === 'start' ? 'handleAccessInstructorAccount' : 'handleStopInstructorAccess'](req, res);
    for (const cookie of res.headers['Set-Cookie'] || []) {
      const [pair] = cookie.split(';');
      const idx = pair.indexOf('=');
      if (cookie.includes('Max-Age=0;')) delete jar[pair.slice(0, idx)];
      else jar[pair.slice(0, idx)] = pair.slice(idx + 1);
    }
    return res;
  }
  return { call, audits, queries };
}

test('support expiry restores the exact original login and server identity, with no expiry extension', async () => {
  const api = backend();
  const original = normalToken();
  const jar = { cc_instructor: original, cc_csrf: 'csrf-test' };
  const started = await api.call('start', jar, { instructor_id: 6 });
  expect(started.statusCode).toBe(200);
  expect(jar.cc_instructor_return).toBe(original);
  const support = jwt.verify(jar.cc_instructor, secret);
  expect(support.id).toBe(6);
  expect(support.exp - support.iat).toBe(7200);
  expect(started.headers['Set-Cookie'].find(c => c.startsWith('cc_instructor_return='))).toContain('HttpOnly; Secure; SameSite=Lax');
  // Browser removes the expired two-hour cookie while retaining the original.
  delete jar.cc_instructor;
  const stopped = await api.call('stop', jar);
  expect(stopped.statusCode).toBe(200);
  expect(jar.cc_instructor).toBe(original);
  expect(jar.cc_instructor_return).toBeUndefined();
  expect(stopped.body.instructor.name).toBe('Operator');
  expect(api.audits.at(-1).details.support_session_missing_or_expired).toBe(true);
  expect(api.audits.at(-1).schoolId).toBe(1);
  expect(api.queries.at(-1).text).toContain('school_id = ?');
  // A second tab exiting after the first must not destroy the restored login.
  expect((await api.call('stop', jar)).statusCode).toBe(200);
  expect(jar.cc_instructor).toBe(original);
});

test('nested support and opening your own account retain the original token', async () => {
  const api = backend();
  const original = normalToken();
  const jar = { cc_instructor: original, cc_csrf: 'csrf-test' };
  await api.call('start', jar, { instructor_id: 4 });
  await api.call('start', jar, { instructor_id: 6 });
  expect(jar.cc_instructor_return).toBe(original);
  expect((await api.call('stop', jar)).body.instructor.id).toBe(4);
  expect(jar.cc_instructor).toBe(original);
});

test('an expired original login cannot be renewed from a newer support session', async () => {
  const api = backend();
  const jar = { cc_instructor: normalToken(), cc_csrf: 'csrf-test' };
  await api.call('start', jar, { instructor_id: 6 });
  jar.cc_instructor_return = sign({ id: 4, role: 'instructor', school_id: 1 }, '-1s');
  const result = await api.call('stop', jar);
  expect(result.statusCode).toBe(401);
  expect(result.headers['Set-Cookie']).toBeUndefined();
});

test('a saved session never grants ordinary instructor access after support expires', () => {
  const req = { method: 'GET', headers: { cookie: 'cc_instructor_return=' + normalToken() } };
  expect(auth.requireAuth(req, { roles: ['instructor'] })).toBeNull();
});

test('support restoration rejects missing CSRF, invalid or expired tokens, inactive users and cross-school sessions', async () => {
  const original = normalToken();
  const api = backend();
  for (const token of [original.slice(0, -8) + 'tampered', sign({ id: 4, role: 'instructor', school_id: 1 }, '-1s'), normalToken({ impersonation: true }), normalToken({ role: 'learner' })]) {
    const res = await api.call('stop', { cc_instructor_return: token, cc_csrf: 'csrf-test' });
    expect(res.statusCode).toBe(401);
    expect(res.headers['Set-Cookie']).toBeUndefined();
  }
  expect((await api.call('stop', { cc_instructor_return: original, cc_csrf: 'csrf-test' }, {}, { noCsrf: true })).statusCode).toBe(401);
  expect((await backend([{ ...operator, active: false }]).call('stop', { cc_instructor_return: original, cc_csrf: 'csrf-test' })).statusCode).toBe(401);
  const crossSchool = { cc_instructor_return: original, cc_instructor: sign({ id: 9, role: 'instructor', school_id: 2, impersonation: true }, '2h'), cc_csrf: 'csrf-test' };
  expect((await api.call('stop', crossSchool)).statusCode).toBe(403);
  expect((await api.call('start', { cc_instructor: original, cc_csrf: 'csrf-test' }, { instructor_id: 90 })).statusCode).toBe(404);
});

test('admin-only support exit preserves admin login and legacy instructor support can still return', async () => {
  const api = backend();
  const adminToken = sign({ id: 2, role: 'admin', school_id: 1 }, '7d');
  const jar = { cc_admin: adminToken, cc_csrf: 'csrf-test' };
  await api.call('start', jar, { instructor_id: 6 });
  delete jar.cc_instructor;
  expect((await api.call('stop', jar)).body.instructor).toBeNull();
  expect(jar.cc_admin).toBe(adminToken);
  const legacy = { cc_csrf: 'csrf-test', cc_instructor: sign({ id: 6, role: 'instructor', school_id: 1, impersonation: true,
    return_instructor_admin: { id: 4, school_id: 1, isAdmin: true } }, '2h') };
  expect((await api.call('stop', legacy)).body.instructor.id).toBe(4);
  expect(jwt.verify(legacy.cc_instructor, secret).id).toBe(4);
});

test('database failures preserve both cookies for a later recovery attempt', async () => {
  const token = normalToken();
  const jar = { cc_instructor_return: token, cc_csrf: 'csrf-test' };
  const result = await backend(null).call('stop', jar);
  expect(result.statusCode).toBe(500);
  expect(result.headers['Set-Cookie']).toBeUndefined();
  expect(jar.cc_instructor_return).toBe(token);
});

test('explicit instructor logout clears both ordinary and saved sessions in each logout route', async () => {
  for (const file of ['api/instructor.js', 'api/instructor-auth.js']) {
    const source = read(file);
    const start = source.indexOf('async function handleLogout(');
    const end = source.indexOf('\n}', start) + 2;
    const context = { ...auth, ...csrf, COOKIE_NAME: auth.SESSION_COOKIE_NAMES.instructor };
    vm.createContext(context);
    vm.runInContext(source.slice(start, end), context);
    const res = { headers: {}, setHeader(key, value) { this.headers[key] = value; },
      getHeader(key) { return this.headers[key]; }, json(value) { this.body = value; return this; } };
    await context.handleLogout({ method: 'POST' }, res);
    expect(res.headers['Set-Cookie']).toContain(auth.buildSessionClearCookie('cc_instructor'));
    expect(res.headers['Set-Cookie']).toContain(auth.buildSessionClearCookie('cc_instructor_return'));
  }
});

function frontend(file, stored, responder) {
  const storage = new Map(Object.entries(stored));
  const calls = [], alerts = [], elements = {};
  const context = { Headers, console, URLSearchParams,
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    document: { cookie: 'cc_csrf=csrf-test', getElementById: id => elements[id] || (elements[id] = {}) },
    window: { location: { href: '', reload() { this.reloaded = true; } }, alert: text => alerts.push(text) },
    fetch: async (url, options) => { calls.push({ url, options }); return responder(url, options); } };
  context.window.ccAdminAuth = { fetchAuthed: context.fetch, logout: () => calls.push({ url: 'admin-logout' }) };
  let source = read(file);
  if (file.endsWith('portal.js')) source = source.slice(0, source.indexOf('// ── Navigation')) + 'window.testBack = logout;})();';
  vm.runInNewContext(source, context);
  return { context, storage, calls, alerts, elements };
}
const response = (status, body = {}) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const tick = () => new Promise(resolve => setImmediate(resolve));

test('Back to Portal navigates without deleting cookies or display state', async () => {
  const ui = frontend('public/admin/portal.js', { cc_instructor: JSON.stringify({ instructor: operator }) }, () => response(200));
  await tick();
  ui.context.window.testBack();
  expect(ui.context.window.location.href).toBe('/instructor/');
  expect(ui.storage.has('cc_instructor')).toBe(true);
  expect(ui.calls.map(c => c.url)).toEqual(['/api/admin?action=verify']);
});

for (const failure of ['network', 503, 429]) {
  test(`admin verification ${failure} preserves session`, async () => {
    const ui = frontend('public/admin/portal.js', { cc_instructor: JSON.stringify({ instructor: operator }) }, () => {
      if (failure === 'network') throw new Error('offline');
      return response(failure);
    });
    await tick();
    expect(ui.storage.has('cc_instructor')).toBe(true);
    expect(ui.context.window.location.href).toBe('');
    expect(ui.calls).toHaveLength(1);
    expect(ui.elements['admin-name'].textContent).toContain('Reload');
  });
}

test('confirmed admin 401 redirects without posting logout; genuine admin Sign Out still works', async () => {
  const ui = frontend('public/admin/portal.js', { cc_instructor: JSON.stringify({ instructor: operator }) }, () => response(401));
  await tick();
  expect(ui.context.window.location.href).toBe('/instructor/login.html');
  expect(ui.storage.has('cc_instructor')).toBe(false);
  expect(ui.calls).toHaveLength(1);
  const admin = frontend('public/admin/portal.js', { cc_admin: JSON.stringify({ admin: { name: 'Admin' } }) }, () => response(200));
  admin.context.window.testBack();
  expect(admin.calls.at(-1).url).toBe('admin-logout');
});

test('support exit is single-flight, restores server identity and keeps state on network failure', async () => {
  const support = JSON.stringify({ instructor: colleague, impersonation: { active: true, return_instructor_admin: { id: 999 } } });
  let resolve;
  const ui = frontend('public/shared/instructor-auth.js', { cc_instructor: support }, () => new Promise(r => { resolve = r; }));
  const first = ui.context.window.ccAuth.logout();
  const second = ui.context.window.ccAuth.logout();
  expect(first).toBe(second);
  expect(ui.storage.get('cc_instructor')).toBe(support);
  resolve(response(200, { instructor: operator }));
  await first;
  expect(ui.calls).toHaveLength(1);
  expect(JSON.parse(ui.storage.get('cc_instructor')).instructor.id).toBe(4);
  expect(ui.context.window.location.href).toBe('/admin/portal.html');
  const failed = frontend('public/shared/instructor-auth.js', { cc_instructor: support }, () => { throw new Error('offline'); });
  await failed.context.window.ccAuth.logout();
  expect(failed.storage.get('cc_instructor')).toBe(support);
  expect(failed.context.window.location.href).toBe('');
  expect(failed.alerts).toHaveLength(1);
});

test('opening Admin with expired support restores before any admin verification', async () => {
  const ui = frontend('public/admin/portal.js', { cc_instructor: JSON.stringify({ instructor: colleague, impersonation: { active: true } }) }, () => response(200, { instructor: operator }));
  await tick();
  expect(ui.calls.map(c => c.url)).toEqual(['/api/admin?action=stop-instructor-access']);
  expect(ui.context.window.location.reloaded).toBe(true);
  expect(JSON.parse(ui.storage.get('cc_instructor')).instructor.id).toBe(4);
});

test('browser retains and restores the secure original cookie after support cookie expiry', async ({ page, context }) => {
  const api = backend();
  const origin = 'https://sessions.example.test';
  const original = normalToken();
  const jar = { cc_instructor: original, cc_csrf: 'browser-csrf' };
  await api.call('start', jar, { instructor_id: 6 });
  await context.addCookies(Object.entries(jar).map(([name, value]) => ({
    name, value, url: origin, secure: true, httpOnly: name !== 'cc_csrf', sameSite: 'Lax',
    expires: Math.floor(Date.now() / 1000) + (name === 'cc_instructor' ? 7200 : 15552000),
  })));
  await page.route(origin + '/**', async route => {
    const request = route.request();
    if (request.url().includes('/api/admin?action=stop-instructor-access')) {
      const headers = await request.allHeaders();
      const requestJar = csrf.parseCookies({ headers });
      expect(headers['x-csrf-token']).toBe(requestJar.cc_csrf);
      const res = await api.call('stop', requestJar);
      await route.fulfill({ status: res.statusCode, contentType: 'application/json',
        headers: { 'set-cookie': (res.headers['Set-Cookie'] || []).join('\n') }, body: JSON.stringify(res.body) });
    } else if (request.url().includes('/api/instructor?')) {
      await route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"Unauthorised"}' });
    } else if (request.url().endsWith('/shared/instructor-auth.js')) {
      await route.fulfill({ contentType: 'application/javascript', body: read('public/shared/instructor-auth.js') });
    } else {
      await route.fulfill({ contentType: 'text/html', body: '<!doctype html><script src="/shared/instructor-auth.js"></script>' });
    }
  });
  await page.goto(origin + '/instructor/');
  await page.evaluate(() => localStorage.setItem('cc_instructor', JSON.stringify({ instructor: { id: 6 }, impersonation: { active: true } })));
  expect(await page.evaluate(() => document.cookie)).not.toContain('cc_instructor_return');
  await context.clearCookies({ name: 'cc_instructor' });
  await page.evaluate(() => { window.ccAuth.fetchAuthed('/api/instructor?action=profile').catch(() => {}); });
  await page.waitForURL(origin + '/admin/portal.html');
  const cookies = await context.cookies(origin);
  expect(cookies.find(cookie => cookie.name === 'cc_instructor').value).toBe(original);
  expect(cookies.some(cookie => cookie.name === 'cc_instructor_return')).toBe(false);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cc_instructor')).instructor.id)).toBe(4);
});
