// Instructor management endpoint
//
// Public routes (no auth):
//   GET  /api/instructors?action=list
//     → list all active instructors
//   GET  /api/instructors?action=availability&instructor_id=X
//     → get weekly availability windows for one instructor
//
// Admin routes (require ADMIN_SECRET in request body or header):
//   POST /api/instructors?action=create
//     → create a new instructor
//   POST /api/instructors?action=update
//     → update instructor details
//   POST /api/instructors?action=set-availability
//     → replace all availability windows for an instructor

const { neon } = require('@neondatabase/serverless');
const jwt = require('jsonwebtoken');
const { reportError } = require('./_error-alert');
const { requireAuth, getSchoolId } = require('./_auth');

module.exports = async (req, res) => {
  const action = req.query.action;

  if (action === 'list')             return handleList(req, res);
  if (action === 'availability')     return handleAvailability(req, res);
  if (action === 'create')           return handleCreate(req, res);
  if (action === 'update')           return handleUpdate(req, res);
  if (action === 'set-availability') return handleSetAvailability(req, res);

  return res.status(400).json({ error: 'Unknown action' });
};

// ── GET /api/instructors?action=list ─────────────────────────────────────────
async function handleList(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const sql = neon(process.env.POSTGRES_URL);
    const schoolId = parseInt(req.query.school_id) || 1;
    const instructors = await sql`
      SELECT id, name, email, phone, bio, photo_url, active, slug, created_at
      FROM instructors
      WHERE active = true
        AND school_id = ${schoolId}
        AND email != 'demo@coachcarter.uk'
      ORDER BY name ASC
    `;
    return res.json({ instructors });
  } catch (err) {
    console.error('instructors list error:', err);
    reportError('/api/instructors', err);
    return res.status(500).json({ error: 'Failed to load instructors', details: 'Internal server error' });
  }
}

// ── GET /api/instructors?action=availability&instructor_id=X ─────────────────
// Returns the recurring weekly windows for one instructor.
async function handleAvailability(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { instructor_id } = req.query;
  if (!instructor_id) return res.status(400).json({ error: 'instructor_id required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const windows = await sql`
      SELECT id, day_of_week, start_time, end_time, active
      FROM instructor_availability
      WHERE instructor_id = ${instructor_id}
        AND active = true
      ORDER BY day_of_week ASC, start_time ASC
    `;
    return res.json({ windows });
  } catch (err) {
    console.error('instructors availability error:', err);
    reportError('/api/instructors', err);
    return res.status(500).json({ error: 'Failed to load availability', details: 'Internal server error' });
  }
}

// ── POST /api/instructors?action=create ──────────────────────────────────────
async function handleCreate(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const payload = requireAuth(req, { roles: ['admin'] });
  if (!payload) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = getSchoolId(payload, req);

  const { name, email, phone, bio, photo_url, buffer_minutes } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'name and email are required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const existing = await sql`SELECT id FROM instructors WHERE email = ${email.toLowerCase().trim()} AND school_id = ${schoolId}`;
    if (existing.length > 0)
      return res.status(400).json({ error: 'An instructor with this email already exists' });

    const bufVal = (buffer_minutes !== undefined && buffer_minutes !== null) ? parseInt(buffer_minutes) : 30;

    const [instructor] = await sql`
      INSERT INTO instructors (name, email, phone, bio, photo_url, buffer_minutes, school_id)
      VALUES (
        ${name.trim()},
        ${email.toLowerCase().trim()},
        ${phone || null},
        ${bio || null},
        ${photo_url || null},
        ${bufVal},
        ${schoolId}
      )
      RETURNING id, name, email, phone, bio, photo_url, active, created_at, buffer_minutes
    `;
    return res.status(201).json({ instructor });
  } catch (err) {
    console.error('instructors create error:', err);
    reportError('/api/instructors', err);
    return res.status(500).json({ error: 'Failed to create instructor', details: 'Internal server error' });
  }
}

// ── POST /api/instructors?action=update ──────────────────────────────────────
async function handleUpdate(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const payload = requireAuth(req, { roles: ['admin'] });
  if (!payload) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = getSchoolId(payload, req);

  const { id, name, email, phone, bio, photo_url, active, buffer_minutes, commission_rate, max_travel_minutes } = req.body;
  if (!id) return res.status(400).json({ error: 'id is required' });

  const hasFranchiseFee = 'weekly_franchise_fee_pence' in (req.body || {});
  const franchiseFeeVal = hasFranchiseFee ? req.body.weekly_franchise_fee_pence : undefined;

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const bufVal = (buffer_minutes !== undefined && buffer_minutes !== null) ? parseInt(buffer_minutes) : null;
    const rateVal = (commission_rate !== undefined && commission_rate !== null) ? parseFloat(commission_rate) : null;
    const travelVal = (max_travel_minutes !== undefined && max_travel_minutes !== null) ? parseInt(max_travel_minutes) : null;

    const [instructor] = await sql`
      UPDATE instructors SET
        name            = COALESCE(${name      || null}, name),
        email           = COALESCE(${email     ? email.toLowerCase().trim() : null}, email),
        phone           = COALESCE(${phone     || null}, phone),
        bio             = COALESCE(${bio       || null}, bio),
        photo_url       = COALESCE(${photo_url || null}, photo_url),
        active          = COALESCE(${active !== undefined ? active : null}, active),
        buffer_minutes  = COALESCE(${bufVal}, buffer_minutes),
        max_travel_minutes = COALESCE(${travelVal}, max_travel_minutes),
        commission_rate = COALESCE(${rateVal}, commission_rate),
        weekly_franchise_fee_pence = CASE WHEN ${hasFranchiseFee} THEN ${franchiseFeeVal != null ? parseInt(franchiseFeeVal) : null}::integer ELSE weekly_franchise_fee_pence END
      WHERE id = ${id} AND school_id = ${schoolId}
      RETURNING id, name, email, phone, bio, photo_url, active, COALESCE(buffer_minutes, 30) AS buffer_minutes, max_travel_minutes, COALESCE(commission_rate, 0.85) AS commission_rate, weekly_franchise_fee_pence
    `;
    if (!instructor) return res.status(404).json({ error: 'Instructor not found' });
    return res.json({ instructor });
  } catch (err) {
    console.error('instructors update error:', err);
    reportError('/api/instructors', err);
    return res.status(500).json({ error: 'Failed to update instructor', details: 'Internal server error' });
  }
}

// ── POST /api/instructors?action=set-availability ────────────────────────────
// Replaces ALL availability windows for an instructor.
// Body: {
//   instructor_id: number,
//   windows: [{ day_of_week: 0-6, start_time: "HH:MM", end_time: "HH:MM" }, ...]
// }
// day_of_week: 0=Sunday, 1=Monday, … 6=Saturday
async function handleSetAvailability(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const payload = requireAuth(req, { roles: ['admin'] });
  if (!payload) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = getSchoolId(payload, req);

  const { instructor_id, windows } = req.body;
  if (!instructor_id)           return res.status(400).json({ error: 'instructor_id required' });
  if (!Array.isArray(windows))  return res.status(400).json({ error: 'windows must be an array' });

  // Validate each window
  for (const w of windows) {
    if (w.day_of_week < 0 || w.day_of_week > 6)
      return res.status(400).json({ error: `Invalid day_of_week: ${w.day_of_week}` });
    if (!isValidTime(w.start_time) || !isValidTime(w.end_time))
      return res.status(400).json({ error: `Invalid time format in window: ${JSON.stringify(w)}` });
    if (w.start_time >= w.end_time)
      return res.status(400).json({ error: `start_time must be before end_time: ${JSON.stringify(w)}` });
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Verify instructor exists and belongs to this school
    const [instructor] = await sql`SELECT id FROM instructors WHERE id = ${instructor_id} AND school_id = ${schoolId}`;
    if (!instructor) return res.status(404).json({ error: 'Instructor not found' });

    // Delete existing windows and insert new ones in one go
    await sql`
      DELETE FROM instructor_availability WHERE instructor_id = ${instructor_id}
    `;

    if (windows.length > 0) {
      for (const w of windows) {
        await sql`
          INSERT INTO instructor_availability (instructor_id, day_of_week, start_time, end_time)
          VALUES (${instructor_id}, ${w.day_of_week}, ${w.start_time}, ${w.end_time})
        `;
      }
    }

    // Return the saved windows
    const saved = await sql`
      SELECT id, day_of_week, start_time, end_time, active
      FROM instructor_availability
      WHERE instructor_id = ${instructor_id}
      ORDER BY day_of_week ASC, start_time ASC
    `;
    return res.json({ success: true, windows: saved });
  } catch (err) {
    console.error('instructors set-availability error:', err);
    reportError('/api/instructors', err);
    return res.status(500).json({ error: 'Failed to save availability', details: 'Internal server error' });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function isValidTime(t) {
  return typeof t === 'string' && /^\d{2}:\d{2}$/.test(t);
}
