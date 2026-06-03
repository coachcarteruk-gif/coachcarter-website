const { neon } = require('@neondatabase/serverless');

const DEFAULT_SCHOOL_ID = 1;
const COACHCARTER_HOSTS = new Set([
  'coachcarter.uk',
  'www.coachcarter.uk',
]);

function normaliseHost(rawHost) {
  let host = String(rawHost || '').trim().toLowerCase();
  if (!host) return '';

  host = host.split(',')[0].trim();
  if (host.endsWith('.')) host = host.slice(0, -1);

  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    return end >= 0 ? host.slice(1, end) : host;
  }

  const colon = host.lastIndexOf(':');
  if (colon > -1 && host.indexOf(':') === colon) {
    const port = host.slice(colon + 1);
    if (/^\d+$/.test(port)) host = host.slice(0, colon);
  }

  return host;
}

function getRequestHost(req) {
  return normaliseHost(
    req?.headers?.['x-forwarded-host'] ||
    req?.headers?.host ||
    ''
  );
}

function isDevelopmentHost(host) {
  const h = normaliseHost(host);
  return h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '::1' ||
    h.endsWith('.localhost') ||
    h.endsWith('.vercel.app');
}

function normaliseSlug(value) {
  const slug = String(value || '').trim().toLowerCase();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? slug : '';
}

function positiveInteger(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function primaryHostColumnMissing(err) {
  return err && (
    err.code === '42703' ||
    /primary_host/i.test(String(err.message || ''))
  );
}

async function lookupByPrimaryHost(sql, host) {
  if (!host) return null;
  const rows = await sql`
    SELECT id, slug
      FROM schools
     WHERE LOWER(primary_host) = ${host}
       AND active = true
     LIMIT 1
  `;
  return rows[0] || null;
}

async function lookupBySlug(sql, slug) {
  if (!slug) return null;
  const rows = await sql`
    SELECT id, slug
      FROM schools
     WHERE slug = ${slug}
       AND active = true
     LIMIT 1
  `;
  return rows[0] || null;
}

async function lookupById(sql, schoolId) {
  if (!schoolId) return null;
  const rows = await sql`
    SELECT id, slug
      FROM schools
     WHERE id = ${schoolId}
       AND active = true
     LIMIT 1
  `;
  return rows[0] || null;
}

async function resolveSchoolFromRequest(req, opts = {}) {
  const sql = opts.sql || neon(process.env.POSTGRES_URL);
  const host = getRequestHost(req);

  try {
    const byHost = await lookupByPrimaryHost(sql, host);
    if (byHost) {
      return { schoolId: byHost.id, slug: byHost.slug, source: 'host', host };
    }
  } catch (err) {
    if (!primaryHostColumnMissing(err)) throw err;
    if (COACHCARTER_HOSTS.has(host)) {
      return { schoolId: DEFAULT_SCHOOL_ID, slug: 'coachcarter', source: 'legacy_host', host };
    }
  }

  const slug = normaliseSlug(req?.query?.school);
  if (slug) {
    const bySlug = await lookupBySlug(sql, slug);
    if (bySlug) {
      return { schoolId: bySlug.id, slug: bySlug.slug, source: 'query', host };
    }
    return null;
  }

  if (opts.allowLegacySchoolIdQuery) {
    const schoolId = positiveInteger(req?.query?.school_id);
    if (schoolId) {
      const byId = await lookupById(sql, schoolId);
      if (byId) {
        return { schoolId: byId.id, slug: byId.slug, source: 'query_id', host };
      }
      return null;
    }
  }

  if (isDevelopmentHost(host)) {
    return { schoolId: DEFAULT_SCHOOL_ID, slug: 'coachcarter', source: 'dev_fallback', host };
  }

  return null;
}

module.exports = {
  DEFAULT_SCHOOL_ID,
  getRequestHost,
  isDevelopmentHost,
  normaliseHost,
  resolveSchoolFromRequest,
};
