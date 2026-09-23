const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const jwt = require('jsonwebtoken');
const { createRequire } = require('module');
const { buildContacts, contactsCsv, normalisePhone, loadContacts } = require('../api/_contacts-export');

// The site's worker reloads on first installation and bypasses mocked routes.
test.use({ serviceWorkers: 'block' });

const headers = ['First Name', 'Last Name', 'Email', 'Phone', 'Tags', 'Address1', 'City', 'State', 'Postal Code', 'Country', 'Source'];

// Independent CSV parser, including embedded newlines, commas and escaped quotes.
function parseCsv(csv) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  const source = csv.replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '"') {
      if (quoted && source[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && char === ',') { row.push(cell); cell = ''; }
    else if (!quoted && char === '\r' && source[i + 1] === '\n') {
      row.push(cell); rows.push(row); row = []; cell = ''; i++;
    } else cell += char;
  }
  return rows;
}

test('CSV round-trips exact headers, Unicode, quoted tags and multiline addresses', () => {
  const rows = buildContacts([{ id: 1, kind: 'learner', name: 'Zoë van Dijk', email: ' ZOE@example.test ',
    phone: '07700 900000', address: '12 "Rose" Lane, Reading\nBerkshire RG1 1AA', source: 'website' }]);
  const parsed = parseCsv(contactsCsv(rows));
  expect(parsed[0]).toEqual(headers);
  expect(parsed[1]).toEqual(['Zoë', 'van Dijk', 'zoe@example.test', '+447700900000', 'learner',
    '12 "Rose" Lane, Reading\nBerkshire RG1 1AA', '', '', 'RG1 1AA', 'GB', 'website']);
  expect(parseCsv(contactsCsv([]))).toEqual([headers]);
});

test('merges matching emails, prefers accounts, and keeps different emails on shared phones separate', () => {
  const contacts = buildContacts([
    { id: 1, kind: 'learner', name: 'Sam Smith', email: 'sam@example.test', phone: '07700 900000', source: 'website' },
    { id: 8, kind: 'enquiry', name: 'Old Sam', email: 'SAM@example.test', phone: '07700 900999', source: 'facebook' },
    { id: 7, kind: 'enquiry', name: 'Sam', email: 'sam@example.test', source: 'website' },
    { id: 2, kind: 'learner', name: 'Alex Smith', email: 'alex@example.test', phone: '07700 900000' },
    { id: 3, kind: 'instructor', name: 'Robin', email: 'robin@example.test', active: false },
    { id: 4, kind: 'administrator', name: 'Robin', email: 'robin@example.test' },
  ]);
  expect(contacts).toHaveLength(3);
  expect(contacts[0].slice(0, 5)).toEqual(['Sam', 'Smith', 'sam@example.test', '+447700900000', 'learner, enquiry']);
  expect(contacts[0][10]).toBe('facebook');
  expect(contacts[2][4]).toBe('instructor, inactive instructor, administrator');
});

test('preserves contacts with missing names and numbers needing review, skips empty anonymised rows', () => {
  const rows = buildContacts([
    { kind: 'lesson offer', id: 1, email: 'someone@example.test' },
    { kind: 'guest booking', id: 2, phone: '07700 900000' },
    { kind: 'guest booking', id: 3, phone: '+447700900000' },
    { kind: 'lesson request', id: 4, name: 'Onlyname', phone: '0118 123 4567 ext 12' },
    { kind: 'lesson request', id: 5, name: null, email: null, phone: null },
  ]);
  expect(rows).toHaveLength(3);
  expect(rows[0][0]).toBe('Unknown');
  expect(rows[0][4]).toContain('name needs review');
  expect(rows[2][3]).toBe('0118 123 4567 ext 12');
  expect(rows[2][4]).toContain('phone needs review');
});

test('normalises UK/international numbers and protects formula cells without altering E.164', () => {
  for (const phone of ['07700 900000', '7700900000', '447700900000', '00447700900000', '+44 (0) 7700 900000']) {
    expect(normalisePhone(phone)).toBe('+447700900000');
  }
  expect(normalisePhone('+1 (202) 555-0123')).toBe('+12025550123');
  const row = parseCsv(contactsCsv([['\t=HYPERLINK("bad")', '@SUM(1)', '-1+1', '+447700900000', '+CMD', '', '', '', '', 'GB', '=1+1']]))[1];
  expect(row[0]).toBe('\'=HYPERLINK("bad")');
  expect(row[1]).toBe("'@SUM(1)");
  expect(row[2]).toBe("'-1+1");
  expect(row[3]).toBe('+447700900000');
  expect(row[4]).toBe("'+CMD");
  expect(row[10]).toBe("'=1+1");
});

test('queries all contact sources without a display limit, scoped on every branch', async () => {
  await loadContacts(async (strings, ...values) => {
    const sql = strings.join('?');
    expect(values).toEqual([42, 42, 42, 42, 42, 42, 42]);
    for (const table of ['learner_users', 'instructors', 'admin_users', 'enquiries', 'lesson_requests', 'lesson_offers', 'lesson_bookings']) {
      expect(sql).toContain('FROM ' + table + ' WHERE school_id = ?');
    }
    expect(sql).toContain('learner_anonymized IS NOT TRUE');
    expect(sql).not.toMatch(/\bLIMIT\b|password_hash|calendar_token|instructor_notes/);
    return [];
  }, 42);
});

function handlerFixture(fail = false) {
  const file = path.resolve(__dirname, '../api/_contacts-export.js');
  const nativeRequire = createRequire(file);
  const queries = [], audits = [];
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    module, exports: module.exports, process, console,
    require(name) {
      if (name === '@neondatabase/serverless') return { neon: () => async (strings, ...values) => {
        queries.push(values);
        if (fail) throw new Error('secret SQL connection details');
        return [{ id: 1, kind: 'learner', name: 'School Contact', email: 'contact@example.test' }];
      } };
      if (name === './_audit') return { logAudit: async (_sql, entry) => { await Promise.resolve(); audits.push(entry); } };
      return nativeRequire(name);
    },
  }, { filename: file });
  return { handler: module.exports.handleExportContacts, queries, audits };
}

async function request(fixture, payload, query = {}, method = 'GET') {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'contacts-export-hermetic-test-only';
  try {
    const token = payload && jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
    const cookie = payload?.role === 'instructor' ? 'cc_instructor' : payload?.role === 'learner' ? 'cc_learner' : 'cc_admin';
    const req = { method, url: '/api/admin?action=export-contacts', query, headers: { cookie: token ? cookie + '=' + token : '' } };
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; },
      status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; }, send(body) { this.body = body; return this; } };
    await fixture.handler(req, res);
    return res;
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
}

test('real auth rejects anonymous, learners and ordinary instructors before database access', async () => {
  for (const payload of [null, { role: 'learner', id: 1, school_id: 7 }, { role: 'instructor', id: 1, school_id: 7 }, { role: 'admin', id: 1 }]) {
    const fixture = handlerFixture();
    expect((await request(fixture, payload)).statusCode).toBe(401);
    expect(fixture.queries).toHaveLength(0);
  }
});

test('admins and instructor-admins cannot override their school; export waits for its audit', async () => {
  for (const role of ['admin', 'instructor']) {
    const fixture = handlerFixture();
    const res = await request(fixture, { role, isAdmin: true, id: 1, school_id: 7 }, { school_id: '99' });
    expect(res.statusCode).toBe(200);
    expect(fixture.queries).toEqual([[7, 7, 7, 7, 7, 7, 7]]);
    expect(fixture.audits).toHaveLength(1);
    expect(fixture.audits[0].schoolId).toBe(7);
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(res.headers['Content-Type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['Content-Disposition']).toContain('gohighlevel-contacts-school-7-');
    expect(res.headers['X-Contact-Count']).toBe('1');
    expect(parseCsv(res.body)[0]).toEqual(headers);
  }
});

test('superadmins must select a school; unsupported methods and errors never return a partial export', async () => {
  const admin = { role: 'superadmin', id: 1, school_id: null };
  const fixture = handlerFixture();
  expect((await request(fixture, admin)).statusCode).toBe(400);
  expect(fixture.queries).toHaveLength(0);
  expect((await request(fixture, admin, { school_id: '8' })).statusCode).toBe(200);
  expect(fixture.queries[0]).toEqual([8, 8, 8, 8, 8, 8, 8]);
  expect((await request(fixture, admin, {}, 'POST')).statusCode).toBe(405);
  const error = await request(handlerFixture(true), { role: 'admin', id: 1, school_id: 7 });
  expect(error.statusCode).toBe(500);
  expect(JSON.stringify(error.body)).not.toContain('secret SQL');
  expect(error.headers['Content-Disposition']).toBeUndefined();
});

async function openExport(page, exportResponse, platformAdmin = false) {
  await page.addInitScript(isPlatformAdmin => {
    localStorage.setItem('cc_admin', JSON.stringify({ admin: { name: 'Test Admin', role: isPlatformAdmin ? 'superadmin' : 'admin', school_id: isPlatformAdmin ? null : 7 } }));
    localStorage.setItem('cc_cookie_consent', JSON.stringify({ version: 2, necessary: true, analytics: false, marketing: false, timestamp: new Date().toISOString() }));
  }, platformAdmin);
  await page.route('**/api/**', route => {
    if (new URL(route.request().url()).searchParams.get('action') === 'export-contacts') return exportResponse(route);
    if (new URL(route.request().url()).pathname === '/api/schools') return route.fulfill({ json: { schools: [{ id: 7, name: 'School Seven' }, { id: 8, name: 'School Eight' }] } });
    return route.fulfill({ json: {} });
  });
  await page.goto('/admin/portal.html');
}

test('dashboard button downloads the server CSV and reports the contact count on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const csv = contactsCsv(buildContacts([{ id: 1, kind: 'learner', name: 'CSV Contact', phone: '07700 900000' }]));
  await openExport(page, route => route.fulfill({ body: csv, headers: {
    'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="gohighlevel-contacts-school-7-2026-09-23.csv"', 'X-Contact-Count': '1',
  } }));
  const button = page.getByRole('button', { name: 'Export GoHighLevel CSV' });
  await expect(button).toBeVisible();
  const downloadEvent = page.waitForEvent('download');
  await button.click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('gohighlevel-contacts-school-7-2026-09-23.csv');
  expect(fs.readFileSync(await download.path(), 'utf8')).toBe(csv);
  await expect(page.locator('#contacts-export-status')).toHaveText('1 contact exported for GoHighLevel.');
  await expect(button).toBeEnabled();
});

test('dashboard displays failures as text and allows retry without downloading an error file', async ({ page }) => {
  await openExport(page, route => route.fulfill({ status: 500, json: { error: 'Unable to export <contacts>. Please try again.' } }));
  const downloads = [];
  page.on('download', download => downloads.push(download));
  const button = page.getByRole('button', { name: 'Export GoHighLevel CSV' });
  await button.click();
  await expect(page.locator('#contacts-export-status')).toHaveText('Unable to export <contacts>. Please try again.');
  await expect(button).toBeEnabled();
  expect(downloads).toHaveLength(0);
});

test('platform admin chooses a school before exporting', async ({ page }) => {
  let exportedSchool = null;
  await openExport(page, route => {
    exportedSchool = new URL(route.request().url()).searchParams.get('school_id');
    return route.fulfill({ body: contactsCsv([]), contentType: 'text/csv', headers: { 'X-Contact-Count': '0' } });
  }, true);
  const button = page.getByRole('button', { name: 'Export GoHighLevel CSV' });
  await button.click();
  await expect(page.locator('#contacts-export-status')).toHaveText('Choose a school to export contacts.');
  expect(exportedSchool).toBeNull();
  await page.getByRole('combobox', { name: 'School', exact: true }).selectOption('8');
  const download = page.waitForEvent('download');
  await button.click();
  await download;
  expect(exportedSchool).toBe('8');
  await expect(page.locator('#contacts-export-status')).toHaveText('0 contacts exported for GoHighLevel.');
});
