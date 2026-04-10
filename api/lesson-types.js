// Lesson Types API
//
// Routes:
//   GET  /api/lesson-types?action=list
//     → all active lesson types sorted by sort_order (public, no auth)
//
//   GET  /api/lesson-types?action=all
//     → all lesson types including inactive (admin JWT required)
//
//   POST /api/lesson-types?action=create
//     → create a new lesson type (admin JWT required)
//
//   POST /api/lesson-types?action=update
//     → update an existing lesson type (admin JWT required)
//
//   POST /api/lesson-types?action=toggle
//     → activate or deactivate a lesson type (admin JWT required)

const { neon } = require('@neondatabase/serverless');
const jwt      = require('jsonwebtoken');
const { requireAuth } = require('./_auth');
const { reportError } = require('./_error-alert');

function setCors(res) {
}

function verifyAdminJWT(req) {
  return requireAuth(req, { roles: ['admin'] });
}

module.exports = async (req, res) => {
  setCors(res);
  const action = req.query.action;
  if (action === 'list')   return handleList(req, res);
  if (action === 'all')    return handleAll(req, res);
  if (action === 'create') return handleCreate(req, res);
  if (action === 'update') return handleUpdate(req, res);
  if (action === 'toggle') return handleToggle(req, res);

  return res.status(400).json({ error: true, code: 'UNKNOWN_ACTION', message: 'Unknown action' });
};

// Public — active lesson types
// Optional: ?learner_id=X&instructor_id=Y to apply per-learner custom hourly rate
async function handleList(req, res) {
  try {
    const sql = neon(process.env.POSTGRES_URL);
    const schoolId = parseInt(req.query.school_id) || 1;
    const includeInactive = req.query.include_inactive === 'true';
    const rows = await sql`
      SELECT id, name, slug, duration_minutes, price_pence, colour, active, sort_order
      FROM lesson_types
      WHERE (active = true OR ${includeInactive}) AND school_id = ${schoolId}
      ORDER BY sort_order, id
    `;

    // If learner + instructor provided, check for custom hourly rate override
    const learnerId = parseInt(req.query.learner_id);
    const instructorId = parseInt(req.query.instructor_id);
    if (learnerId && instructorId) {
      const [custom] = await sql`
        SELECT custom_hourly_rate_pence FROM instructor_learner_notes
        WHERE instructor_id = ${instructorId} AND learner_id = ${learnerId}
      `;
      if (custom?.custom_hourly_rate_pence) {
        const rate = custom.custom_hourly_rate_pence;
        for (const lt of rows) {
          lt.price_pence = Math.round(rate * lt.duration_minutes / 60);
        }
      }
    }

    return res.json({ ok: true, lesson_types: rows });
  } catch (err) {
    reportError('/api/lesson-types?action=list', err);
    return res.status(500).json({ error: true, code: 'SERVER_ERROR', message: 'Failed to load lesson types' });
  }
}

// Admin — all types including inactive
async function handleAll(req, res) {
  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: true, code: 'UNAUTHORIZED', message: 'Admin access required' });
  const schoolId = admin.school_id || 1;

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const rows = await sql`
      SELECT id, name, slug, duration_minutes, price_pence, colour, active, sort_order, created_at
      FROM lesson_types
      WHERE school_id = ${schoolId}
      ORDER BY sort_order, id
    `;
    return res.json({ ok: true, lesson_types: rows });
  } catch (err) {
    reportError('/api/lesson-types?action=all', err);
    return res.status(500).json({ error: true, code: 'SERVER_ERROR', message: 'Failed to load lesson types' });
  }
}

// Admin — create
async function handleCreate(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: true, code: 'METHOD_NOT_ALLOWED', message: 'POST required' });
  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: true, code: 'UNAUTHORIZED', message: 'Admin access required' });

  const schoolId = admin.school_id || 1;
  const { name, slug, duration_minutes, price_pence, colour, sort_order } = req.body || {};
  if (!name || !slug || !duration_minutes || !price_pence) {
    return res.status(400).json({ error: true, code: 'MISSING_FIELDS', message: 'name, slug, duration_minutes, price_pence required' });
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const rows = await sql`
      INSERT INTO lesson_types (name, slug, duration_minutes, price_pence, colour, sort_order, school_id)
      VALUES (${name}, ${slug}, ${duration_minutes}, ${price_pence}, ${colour || '#3b82f6'}, ${sort_order || 0}, ${schoolId})
      RETURNING *
    `;
    return res.json({ ok: true, lesson_type: rows[0] });
  } catch (err) {
    if (err.message?.includes('unique') || err.message?.includes('duplicate')) {
      return res.status(409).json({ error: true, code: 'DUPLICATE_SLUG', message: 'A lesson type with that slug already exists' });
    }
    reportError('/api/lesson-types?action=create', err);
    return res.status(500).json({ error: true, code: 'SERVER_ERROR', message: 'Failed to create lesson type' });
  }
}

// Admin — update
async function handleUpdate(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: true, code: 'METHOD_NOT_ALLOWED', message: 'POST required' });
  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: true, code: 'UNAUTHORIZED', message: 'Admin access required' });

  const schoolId = admin.school_id || 1;
  const { id, name, slug, duration_minutes, price_pence, colour, active, sort_order } = req.body || {};
  if (!id) return res.status(400).json({ error: true, code: 'MISSING_ID', message: 'id required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const rows = await sql`
      UPDATE lesson_types SET
        name             = COALESCE(${name}, name),
        slug             = COALESCE(${slug}, slug),
        duration_minutes = COALESCE(${duration_minutes}, duration_minutes),
        price_pence      = COALESCE(${price_pence}, price_pence),
        colour           = COALESCE(${colour}, colour),
        active           = COALESCE(${active}, active),
        sort_order       = COALESCE(${sort_order}, sort_order)
      WHERE id = ${id} AND school_id = ${schoolId}
      RETURNING *
    `;
    if (!rows.length) return res.status(404).json({ error: true, code: 'NOT_FOUND', message: 'Lesson type not found' });
    return res.json({ ok: true, lesson_type: rows[0] });
  } catch (err) {
    if (err.message?.includes('unique') || err.message?.includes('duplicate')) {
      return res.status(409).json({ error: true, code: 'DUPLICATE_SLUG', message: 'A lesson type with that slug already exists' });
    }
    reportError('/api/lesson-types?action=update', err);
    return res.status(500).json({ error: true, code: 'SERVER_ERROR', message: 'Failed to update lesson type' });
  }
}

// Admin — toggle active/inactive
async function handleToggle(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: true, code: 'METHOD_NOT_ALLOWED', message: 'POST required' });
  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: true, code: 'UNAUTHORIZED', message: 'Admin access required' });

  const schoolId = admin.school_id || 1;
  const { id, active } = req.body || {};
  if (!id || typeof active !== 'boolean') {
    return res.status(400).json({ error: true, code: 'MISSING_FIELDS', message: 'id and active (boolean) required' });
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const rows = await sql`
      UPDATE lesson_types SET active = ${active} WHERE id = ${id} AND school_id = ${schoolId} RETURNING *
    `;
    if (!rows.length) return res.status(404).json({ error: true, code: 'NOT_FOUND', message: 'Lesson type not found' });
    return res.json({ ok: true, lesson_type: rows[0] });
  } catch (err) {
    reportError('/api/lesson-types?action=toggle', err);
    return res.status(500).json({ error: true, code: 'SERVER_ERROR', message: 'Failed to toggle lesson type' });
  }
}
