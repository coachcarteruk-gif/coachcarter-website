// Multi-tenant school management
//
// Routes:
//   GET  /api/schools?action=branding         — public school branding (no auth)
//   GET  /api/schools?action=list             — all schools with stats (superadmin)
//   GET  /api/schools?action=get              — single school detail (admin)
//   POST /api/schools?action=create           — create new school (superadmin)
//   POST /api/schools?action=update           — update school (superadmin or own admin)
//   POST /api/schools?action=toggle           — toggle active status (superadmin)
//   POST /api/schools?action=create-admin     — create admin for a school (superadmin)
//   GET  /api/schools?action=platform-stats   — aggregate platform metrics (superadmin)
//   GET  /api/schools?action=school-stats     — per-school metrics (superadmin)

const { neon } = require('@neondatabase/serverless');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { requireAuth, getSchoolId, verifyAdminSecret, isSuperAdmin } = require('./_auth');
const { reportError } = require('./_error-alert');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

// ── Handlers ────────────────────────────────────────────────────────────────

async function handleBranding(req, res) {
  try {
    const sql = neon(process.env.POSTGRES_URL);
    const schoolId = req.query?.school_id;
    const slug = req.query?.school;

    if (!schoolId && !slug) {
      return res.status(400).json({ error: true, code: 'MISSING_IDENTIFIER', message: 'Provide school_id or school slug' });
    }

    let rows;
    if (schoolId) {
      rows = await sql`
        SELECT id, name, slug, logo_url, primary_colour, secondary_colour, accent_colour,
               contact_email, contact_phone, website_url
        FROM schools WHERE id = ${parseInt(schoolId, 10)} AND active = true`;
    } else {
      rows = await sql`
        SELECT id, name, slug, logo_url, primary_colour, secondary_colour, accent_colour,
               contact_email, contact_phone, website_url
        FROM schools WHERE slug = ${slug.toLowerCase()} AND active = true`;
    }

    if (!rows.length) {
      return res.status(404).json({ error: true, code: 'SCHOOL_NOT_FOUND', message: 'School not found' });
    }

    return res.json({ ok: true, school: rows[0] });
  } catch (err) {
    reportError('/api/schools', err);
    return res.status(500).json({ error: true, code: 'SERVER_ERROR', message: 'Failed to load branding' });
  }
}

async function handleList(req, res) {
  const admin = requireAuth(req, { roles: ['admin'] });
  if (!admin || !isSuperAdmin(admin)) {
    return res.status(403).json({ error: true, code: 'FORBIDDEN', message: 'Superadmin access required' });
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const schools = await sql`
      SELECT s.*,
        (SELECT COUNT(*) FROM learner_users WHERE school_id = s.id) AS learner_count,
        (SELECT COUNT(*) FROM instructors WHERE school_id = s.id AND active = true) AS instructor_count,
        (SELECT COUNT(*) FROM lesson_bookings WHERE school_id = s.id AND status IN ('confirmed','completed')) AS booking_count
      FROM schools s ORDER BY s.id`;

    return res.json({ ok: true, schools });
  } catch (err) {
    reportError('/api/schools', err);
    return res.status(500).json({ error: true, code: 'SERVER_ERROR', message: 'Failed to list schools' });
  }
}

async function handleGet(req, res) {
  const admin = requireAuth(req, { roles: ['admin'] });
  if (!admin) {
    return res.status(401).json({ error: true, code: 'UNAUTHORIZED', message: 'Admin access required' });
  }

  const schoolId = parseInt(req.query?.school_id, 10);
  if (!schoolId) {
    return res.status(400).json({ error: true, code: 'MISSING_SCHOOL_ID', message: 'school_id is required' });
  }

  // Regular admins can only view their own school
  if (!isSuperAdmin(admin) && admin.school_id !== schoolId) {
    return res.status(403).json({ error: true, code: 'FORBIDDEN', message: 'Cannot access another school' });
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const [school] = await sql`SELECT * FROM schools WHERE id = ${schoolId}`;
    if (!school) {
      return res.status(404).json({ error: true, code: 'SCHOOL_NOT_FOUND', message: 'School not found' });
    }

    const [stats] = await sql`
      SELECT
        (SELECT COUNT(*) FROM learner_users WHERE school_id = ${schoolId}) AS learner_count,
        (SELECT COUNT(*) FROM instructors WHERE school_id = ${schoolId} AND active = true) AS instructor_count,
        (SELECT COUNT(*) FROM lesson_bookings WHERE school_id = ${schoolId} AND status IN ('confirmed','completed')) AS booking_count`;

    return res.json({ ok: true, school: { ...school, ...stats } });
  } catch (err) {
    reportError('/api/schools', err);
    return res.status(500).json({ error: true, code: 'SERVER_ERROR', message: 'Failed to get school' });
  }
}

async function handleCreate(req, res) {
  const admin = requireAuth(req, { roles: ['admin'] });
  if (!admin || !isSuperAdmin(admin)) {
    return res.status(403).json({ error: true, code: 'FORBIDDEN', message: 'Superadmin access required' });
  }

  const { name, slug, contact_email, contact_phone, logo_url, primary_colour, secondary_colour, accent_colour, website_url } = req.body || {};

  if (!name || !slug) {
    return res.status(400).json({ error: true, code: 'MISSING_FIELDS', message: 'name and slug are required' });
  }

  // Validate slug format
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return res.status(400).json({ error: true, code: 'INVALID_SLUG', message: 'Slug must be lowercase alphanumeric with hyphens' });
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Check slug uniqueness
    const existing = await sql`SELECT id FROM schools WHERE slug = ${slug}`;
    if (existing.length) {
      return res.status(409).json({ error: true, code: 'SLUG_TAKEN', message: 'A school with this slug already exists' });
    }

    const [school] = await sql`
      INSERT INTO schools (name, slug, contact_email, contact_phone, logo_url, primary_colour, secondary_colour, accent_colour, website_url)
      VALUES (${name}, ${slug}, ${contact_email || null}, ${contact_phone || null}, ${logo_url || null},
              ${primary_colour || null}, ${secondary_colour || null}, ${accent_colour || null}, ${website_url || null})
      RETURNING *`;

    return res.json({ ok: true, school });
  } catch (err) {
    reportError('/api/schools', err);
    return res.status(500).json({ error: true, code: 'SERVER_ERROR', message: 'Failed to create school' });
  }
}

async function handleUpdate(req, res) {
  const admin = requireAuth(req, { roles: ['admin'] });
  if (!admin) {
    return res.status(401).json({ error: true, code: 'UNAUTHORIZED', message: 'Admin access required' });
  }

  const { school_id, name, slug, contact_email, contact_phone, logo_url, primary_colour, secondary_colour, accent_colour, website_url, config } = req.body || {};

  const targetId = parseInt(school_id, 10);
  if (!targetId) {
    return res.status(400).json({ error: true, code: 'MISSING_SCHOOL_ID', message: 'school_id is required' });
  }

  // Regular admins can only update their own school
  if (!isSuperAdmin(admin) && admin.school_id !== targetId) {
    return res.status(403).json({ error: true, code: 'FORBIDDEN', message: 'Cannot update another school' });
  }

  // Validate slug if provided
  if (slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return res.status(400).json({ error: true, code: 'INVALID_SLUG', message: 'Slug must be lowercase alphanumeric with hyphens' });
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Check slug uniqueness if changing
    if (slug) {
      const existing = await sql`SELECT id FROM schools WHERE slug = ${slug} AND id != ${targetId}`;
      if (existing.length) {
        return res.status(409).json({ error: true, code: 'SLUG_TAKEN', message: 'A school with this slug already exists' });
      }
    }

    // Read current row, merge provided fields, write back (clean partial update with tagged templates)
    const [current] = await sql`SELECT * FROM schools WHERE id = ${targetId}`;
    if (!current) {
      return res.status(404).json({ error: true, code: 'SCHOOL_NOT_FOUND', message: 'School not found' });
    }

    const body = req.body;
    const v = (key) => key in body ? body[key] : current[key];
    const cfgVal = config !== undefined ? JSON.stringify(config) : current.config;

    const [school] = await sql`
      UPDATE schools SET
        name = ${v('name')},
        slug = ${v('slug')},
        contact_email = ${v('contact_email')},
        contact_phone = ${v('contact_phone')},
        logo_url = ${v('logo_url')},
        primary_colour = ${v('primary_colour')},
        secondary_colour = ${v('secondary_colour')},
        accent_colour = ${v('accent_colour')},
        website_url = ${v('website_url')},
        config = ${cfgVal},
        updated_at = NOW()
      WHERE id = ${targetId}
      RETURNING *`;

    return res.json({ ok: true, school });
  } catch (err) {
    reportError('/api/schools', err);
    return res.status(500).json({ error: true, code: 'SERVER_ERROR', message: 'Failed to update school' });
  }
}

async function handleToggle(req, res) {
  const admin = requireAuth(req, { roles: ['admin'] });
  if (!admin || !isSuperAdmin(admin)) {
    return res.status(403).json({ error: true, code: 'FORBIDDEN', message: 'Superadmin access required' });
  }

  const schoolId = parseInt(req.body?.school_id, 10);
  if (!schoolId) {
    return res.status(400).json({ error: true, code: 'MISSING_SCHOOL_ID', message: 'school_id is required' });
  }

  if (schoolId === 1) {
    return res.status(400).json({ error: true, code: 'CANNOT_DEACTIVATE_PRIMARY', message: 'Cannot deactivate the primary school' });
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const [school] = await sql`
      UPDATE schools SET active = NOT active, updated_at = NOW()
      WHERE id = ${schoolId}
      RETURNING id, name, active`;

    if (!school) {
      return res.status(404).json({ error: true, code: 'SCHOOL_NOT_FOUND', message: 'School not found' });
    }

    return res.json({ ok: true, school });
  } catch (err) {
    reportError('/api/schools', err);
    return res.status(500).json({ error: true, code: 'SERVER_ERROR', message: 'Failed to toggle school' });
  }
}

async function handleCreateAdmin(req, res) {
  const admin = requireAuth(req, { roles: ['admin'] });
  if (!admin || !isSuperAdmin(admin)) {
    return res.status(403).json({ error: true, code: 'FORBIDDEN', message: 'Superadmin access required' });
  }

  const { school_id, name, email, password } = req.body || {};

  if (!school_id || !name || !email || !password) {
    return res.status(400).json({ error: true, code: 'MISSING_FIELDS', message: 'school_id, name, email, and password are required' });
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Verify school exists
    const [school] = await sql`SELECT id FROM schools WHERE id = ${parseInt(school_id, 10)}`;
    if (!school) {
      return res.status(404).json({ error: true, code: 'SCHOOL_NOT_FOUND', message: 'School not found' });
    }

    // Check email uniqueness
    const existing = await sql`SELECT id FROM admin_users WHERE email = ${email.toLowerCase()}`;
    if (existing.length) {
      return res.status(409).json({ error: true, code: 'EMAIL_TAKEN', message: 'An admin with this email already exists' });
    }

    const password_hash = await bcrypt.hash(password, 10);

    const [created] = await sql`
      INSERT INTO admin_users (school_id, name, email, password_hash)
      VALUES (${parseInt(school_id, 10)}, ${name}, ${email.toLowerCase()}, ${password_hash})
      RETURNING id, school_id, name, email, created_at`;

    return res.json({ ok: true, admin: created });
  } catch (err) {
    reportError('/api/schools', err);
    return res.status(500).json({ error: true, code: 'SERVER_ERROR', message: 'Failed to create admin' });
  }
}

async function handlePlatformStats(req, res) {
  const admin = requireAuth(req, { roles: ['admin'] });
  if (!admin || !isSuperAdmin(admin)) {
    return res.status(403).json({ error: true, code: 'FORBIDDEN', message: 'Superadmin access required' });
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const [stats] = await sql`
      SELECT
        (SELECT COUNT(*) FROM schools WHERE active = true) AS active_schools,
        (SELECT COUNT(*) FROM learner_users) AS total_learners,
        (SELECT COUNT(*) FROM instructors WHERE active = true) AS total_instructors,
        (SELECT COUNT(*) FROM lesson_bookings WHERE status IN ('confirmed','completed')) AS total_bookings,
        (SELECT COALESCE(SUM(amount_pence), 0) FROM credit_transactions WHERE created_at >= NOW() - INTERVAL '30 days') AS revenue_30d`;

    return res.json({ ok: true, stats });
  } catch (err) {
    reportError('/api/schools', err);
    return res.status(500).json({ error: true, code: 'SERVER_ERROR', message: 'Failed to load platform stats' });
  }
}

async function handleSchoolStats(req, res) {
  const admin = requireAuth(req, { roles: ['admin'] });
  if (!admin || !isSuperAdmin(admin)) {
    return res.status(403).json({ error: true, code: 'FORBIDDEN', message: 'Superadmin access required' });
  }

  const schoolId = parseInt(req.query?.school_id, 10);
  if (!schoolId) {
    return res.status(400).json({ error: true, code: 'MISSING_SCHOOL_ID', message: 'school_id is required' });
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const [stats] = await sql`
      SELECT
        (SELECT COUNT(*) FROM learner_users WHERE school_id = ${schoolId}) AS total_learners,
        (SELECT COUNT(*) FROM instructors WHERE school_id = ${schoolId} AND active = true) AS total_instructors,
        (SELECT COUNT(*) FROM lesson_bookings WHERE school_id = ${schoolId} AND status IN ('confirmed','completed')) AS total_bookings,
        (SELECT COALESCE(SUM(amount_pence), 0) FROM credit_transactions ct
          JOIN learner_users lu ON lu.id = ct.learner_id
          WHERE lu.school_id = ${schoolId} AND ct.created_at >= NOW() - INTERVAL '30 days') AS revenue_30d`;

    return res.json({ ok: true, stats });
  } catch (err) {
    reportError('/api/schools', err);
    return res.status(500).json({ error: true, code: 'SERVER_ERROR', message: 'Failed to load school stats' });
  }
}

// ── Router ──────────────────────────────────────────────────────────────────

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const action = req.query?.action;

  try {
    switch (action) {
      case 'branding':        return handleBranding(req, res);
      case 'list':            return handleList(req, res);
      case 'get':             return handleGet(req, res);
      case 'create':          return handleCreate(req, res);
      case 'update':          return handleUpdate(req, res);
      case 'toggle':          return handleToggle(req, res);
      case 'create-admin':    return handleCreateAdmin(req, res);
      case 'platform-stats':  return handlePlatformStats(req, res);
      case 'school-stats':    return handleSchoolStats(req, res);
      default:
        return res.status(400).json({ error: true, code: 'UNKNOWN_ACTION', message: `Unknown action: ${action}` });
    }
  } catch (err) {
    reportError('/api/schools', err);
    return res.status(500).json({ error: true, code: 'SERVER_ERROR', message: 'Internal server error' });
  }
};
