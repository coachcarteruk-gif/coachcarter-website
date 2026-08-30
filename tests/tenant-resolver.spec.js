// @ts-check
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const {
  isDevelopmentHost,
  normaliseHost,
  resolveSchoolFromRequest,
} = require('../api/_tenant');

function makeReq({ host, query = {} }) {
  return {
    headers: host ? { host } : {},
    query,
  };
}

function makeSql(canned) {
  const calls = [];
  const sql = (strings, ...values) => {
    const text = strings.join('?');
    calls.push({ text, values });
    for (const entry of canned) {
      if (text.includes(entry.match)) {
        if (entry.error) return Promise.reject(entry.error);
        return Promise.resolve(entry.rows);
      }
    }
    return Promise.resolve([]);
  };
  return { sql, calls };
}

function extractAsyncFunction(source, functionName) {
  const marker = `async function ${functionName}`;
  const start = source.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);

  const openBrace = source.indexOf('{', start);
  expect(openBrace).toBeGreaterThanOrEqual(0);

  let depth = 0;
  for (let i = openBrace; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') depth--;
    if (depth === 0) return source.slice(openBrace + 1, i);
  }

  throw new Error(`Could not find end of ${functionName}`);
}

test.describe('public tenant resolver', () => {
  test('normalises host headers before lookup', () => {
    expect(normaliseHost('WWW.CoachCarter.UK:443')).toBe('www.coachcarter.uk');
    expect(normaliseHost('localhost:3000')).toBe('localhost');
    expect(normaliseHost('::1')).toBe('::1');
    expect(normaliseHost('[::1]:3000')).toBe('::1');
    expect(normaliseHost('preview.vercel.app')).toBe('preview.vercel.app');
  });

  test('detects development hosts only for explicit fallback', () => {
    expect(isDevelopmentHost('localhost:3000')).toBe(true);
    expect(isDevelopmentHost('127.0.0.1')).toBe(true);
    expect(isDevelopmentHost('team-feature.vercel.app')).toBe(true);
    expect(isDevelopmentHost('www.coachcarter.uk')).toBe(false);
  });

  test('host mapping wins over query parameters', async () => {
    const { sql, calls } = makeSql([
      { match: 'LOWER(primary_host)', rows: [{ id: 2, slug: 'school-two' }] },
      { match: 'WHERE slug =', rows: [{ id: 3, slug: 'other' }] },
    ]);

    const tenant = await resolveSchoolFromRequest(
      makeReq({ host: 'school-two.example', query: { school: 'other' } }),
      { sql, allowLegacySchoolIdQuery: true }
    );

    expect(tenant).toEqual({
      schoolId: 2,
      slug: 'school-two',
      source: 'host',
      host: 'school-two.example',
    });
    expect(calls.length).toBe(1);
    expect(calls[0].values).toContain('school-two.example');
  });

  test('falls back to school slug query when host is unmapped', async () => {
    const { sql } = makeSql([
      { match: 'LOWER(primary_host)', rows: [] },
      { match: 'WHERE slug =', rows: [{ id: 4, slug: 'instructorbook-demo' }] },
    ]);

    const tenant = await resolveSchoolFromRequest(
      makeReq({ host: 'unknown.example', query: { school: 'instructorbook-demo' } }),
      { sql }
    );

    expect(tenant).toMatchObject({
      schoolId: 4,
      slug: 'instructorbook-demo',
      source: 'query',
    });
  });

  test('allows legacy school_id query only when caller opts in', async () => {
    const { sql } = makeSql([
      { match: 'LOWER(primary_host)', rows: [] },
      { match: 'WHERE id =', rows: [{ id: 5, slug: 'legacy' }] },
    ]);

    const withoutOptIn = await resolveSchoolFromRequest(
      makeReq({ host: 'unknown.example', query: { school_id: '5' } }),
      { sql }
    );
    const withOptIn = await resolveSchoolFromRequest(
      makeReq({ host: 'unknown.example', query: { school_id: '5' } }),
      { sql, allowLegacySchoolIdQuery: true }
    );

    expect(withoutOptIn).toBeNull();
    expect(withOptIn).toMatchObject({
      schoolId: 5,
      slug: 'legacy',
      source: 'query_id',
    });
  });

  test('uses development fallback for localhost and Vercel preview hosts', async () => {
    const { sql } = makeSql([
      { match: 'LOWER(primary_host)', rows: [] },
    ]);

    await expect(resolveSchoolFromRequest(makeReq({ host: 'localhost:3000' }), { sql }))
      .resolves.toMatchObject({ schoolId: 1, source: 'dev_fallback' });
    await expect(resolveSchoolFromRequest(makeReq({ host: 'branch.vercel.app' }), { sql }))
      .resolves.toMatchObject({ schoolId: 1, source: 'dev_fallback' });
  });

  test('unmapped production host returns null', async () => {
    const { sql } = makeSql([
      { match: 'LOWER(primary_host)', rows: [] },
    ]);

    const tenant = await resolveSchoolFromRequest(makeReq({ host: 'unknown.example' }), { sql });
    expect(tenant).toBeNull();
  });

  test('keeps CoachCarter deploy-safe if primary_host migration has not run yet', async () => {
    const err = new Error('column "primary_host" does not exist');
    err.code = '42703';
    const { sql } = makeSql([
      { match: 'LOWER(primary_host)', error: err },
    ]);

    const tenant = await resolveSchoolFromRequest(makeReq({ host: 'www.coachcarter.uk' }), { sql });
    expect(tenant).toMatchObject({
      schoolId: 1,
      slug: 'coachcarter',
      source: 'legacy_host',
    });
  });
});

test.describe('tenant resolver wiring', () => {
  const instructorsJs = fs.readFileSync(path.join(__dirname, '..', 'api', 'instructors.js'), 'utf8');
  const slotsJs = fs.readFileSync(path.join(__dirname, '..', 'api', 'slots.js'), 'utf8');
  const enquiriesJs = fs.readFileSync(path.join(__dirname, '..', 'api', 'enquiries.js'), 'utf8');
  const migrationSql = fs.readFileSync(path.join(__dirname, '..', 'db', 'migration.sql'), 'utf8');

  test('public instructor list uses resolver instead of silent school_id default', () => {
    const body = extractAsyncFunction(instructorsJs, 'handleList');
    expect(instructorsJs).toContain("require('./_tenant')");
    expect(body).toContain('resolveSchoolFromRequest(req, { sql, allowLegacySchoolIdQuery: true })');
    expect(body).not.toContain('parseInt(req.query.school_id) || 1');
  });

  test('public instructor availability uses resolver instead of silent school_id default', () => {
    const body = extractAsyncFunction(instructorsJs, 'handleAvailability');
    expect(body).toContain('resolveSchoolFromRequest(req, { sql, allowLegacySchoolIdQuery: true })');
    expect(body).not.toContain('parseInt(req.query.school_id) || 1');
    expect(body).toContain('AND i.school_id = ${schoolId}');
  });

  test('public available slots uses resolver instead of silent school_id default', () => {
    const body = extractAsyncFunction(slotsJs, 'handleAvailable');
    expect(slotsJs).toContain("require('./_tenant')");
    expect(body).toContain('resolveSchoolFromRequest(req, { sql, allowLegacySchoolIdQuery: true })');
    expect(body).not.toContain('parseInt(school_id) || 1');
    expect(body).not.toContain('parseInt(req.query.school_id) || 1');
    expect(body).toContain('ia.school_id = ${schoolId}');
  });

  test('public durations-for-slot uses resolver instead of silent school_id default', () => {
    const body = extractAsyncFunction(slotsJs, 'handleDurationsForSlot');
    expect(body).toContain('resolveSchoolFromRequest(req, { sql, allowLegacySchoolIdQuery: true })');
    expect(body).not.toContain('parseInt(school_id) || 1');
    expect(body).not.toContain('parseInt(req.query.school_id) || 1');
    expect(body).toContain('WHERE school_id = ${schoolId}');
  });

  test('public enquiry submission derives tenant scope instead of trusting the request body', () => {
    const body = extractAsyncFunction(enquiriesJs, 'handleSubmit');
    expect(enquiriesJs).toContain("require('./_tenant')");
    expect(body).toContain('resolveSchoolFromRequest(req, { sql })');
    expect(body).not.toContain('req.body.school_id');
    expect(body).not.toContain('parseInt(req.body.school_id)');
    expect(body).toContain('const schoolId = tenant.schoolId');
  });

  test('migration adds primary_host and second-school insert gate', () => {
    expect(migrationSql).toContain('ALTER TABLE schools ADD COLUMN IF NOT EXISTS primary_host TEXT');
    expect(migrationSql).toContain('uq_schools_primary_host_lower');
    expect(migrationSql).toContain('public_endpoints_tenant_resolved');
    expect(migrationSql).toContain('trg_schools_require_tenant_resolution');
  });
});
