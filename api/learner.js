const { neon } = require('@neondatabase/serverless');
const jwt = require('jsonwebtoken');

// ── Auth helper ──────────────────────────────────────────────────────────────
function verifyAuth(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  try { return jwt.verify(auth.slice(7), secret); } catch { return null; }
}

// ── Main handler ─────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const action = req.query.action;
  if (action === 'update-name')       return handleUpdateName(req, res);
  if (action === 'sessions')          return handleSessions(req, res);
  if (action === 'progress')          return handleProgress(req, res);
  if (action === 'contact-pref')      return handleContactPref(req, res);
  if (action === 'set-contact-pref')  return handleSetContactPref(req, res);
  if (action === 'profile')           return handleProfile(req, res);
  if (action === 'update-profile')    return handleUpdateProfile(req, res);
  return res.status(400).json({ error: 'Unknown action' });
};

// ── Update name (for new magic-link users) ──────────────────────────────────
async function handleUpdateName(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });

  try {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });

    const sql = neon(process.env.POSTGRES_URL);
    await sql`UPDATE learner_users SET name = ${name.trim()} WHERE id = ${user.id}`;
    return res.json({ success: true, name: name.trim() });
  } catch (err) {
    console.error('update-name error:', err);
    return res.status(500).json({ error: 'Failed to update name' });
  }
}

// ── Sessions ──────────────────────────────────────────────────────────────────
async function handleSessions(req, res) {
  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });

  const sql = neon(process.env.POSTGRES_URL);
  await sql`CREATE TABLE IF NOT EXISTS driving_sessions (
    id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, session_date DATE NOT NULL,
    duration_minutes INTEGER, session_type TEXT DEFAULT 'instructor', notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS skill_ratings (
    id SERIAL PRIMARY KEY, session_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
    tier INTEGER NOT NULL, skill_key TEXT NOT NULL, rating TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW())`;
  // Add note column to existing tables that predate this feature
  await sql`ALTER TABLE skill_ratings ADD COLUMN IF NOT EXISTS note TEXT`;

  if (req.method === 'GET') {
    try {
      const sessions = await sql`
        SELECT s.*,
          COALESCE(json_agg(
            json_build_object('skill_key', r.skill_key, 'tier', r.tier, 'rating', r.rating, 'note', r.note)
            ORDER BY r.id
          ) FILTER (WHERE r.id IS NOT NULL), '[]') as ratings
        FROM driving_sessions s
        LEFT JOIN skill_ratings r ON r.session_id = s.id
        WHERE s.user_id = ${user.id}
        GROUP BY s.id ORDER BY s.session_date DESC, s.created_at DESC LIMIT 20`;
      return res.json({ sessions });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to load sessions', details: err.message });
    }
  }

  if (req.method === 'POST') {
    try {
      const { session_date, duration_minutes, session_type, notes, ratings } = req.body;
      if (!session_date) return res.status(400).json({ error: 'Session date is required' });

      const sessionRows = await sql`
        INSERT INTO driving_sessions (user_id, session_date, duration_minutes, session_type, notes)
        VALUES (${user.id}, ${session_date}, ${duration_minutes || null}, ${session_type || 'instructor'}, ${notes || null})
        RETURNING id`;
      const sessionId = sessionRows[0].id;

      if (ratings?.length > 0) {
        for (const r of ratings) {
          await sql`INSERT INTO skill_ratings (session_id, user_id, tier, skill_key, rating, note)
            VALUES (${sessionId}, ${user.id}, ${r.tier}, ${r.skill_key}, ${r.rating}, ${r.note || null})`;
        }
      }
      return res.json({ success: true, session_id: sessionId });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to save session', details: err.message });
    }
  }
  return res.status(405).json({ error: 'Method not allowed' });
}

// ── Progress ──────────────────────────────────────────────────────────────────
async function handleProgress(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });

  const sql = neon(process.env.POSTGRES_URL);
  try {
    const latestRatings = await sql`
      SELECT DISTINCT ON (skill_key, tier) skill_key, tier, rating, created_at
      FROM skill_ratings WHERE user_id = ${user.id}
      ORDER BY skill_key, tier, created_at DESC`;

    const stats = await sql`
      SELECT COUNT(*)::int as total_sessions,
        COALESCE(SUM(duration_minutes), 0)::int as total_minutes,
        COUNT(*) FILTER (WHERE session_type = 'instructor')::int as instructor_sessions,
        COUNT(*) FILTER (WHERE session_type = 'private')::int as private_sessions
      FROM driving_sessions WHERE user_id = ${user.id}`;

    const userRow = await sql`SELECT current_tier, name, phone, pickup_address, prefer_contact_before FROM learner_users WHERE id = ${user.id}`;
    return res.json({
      latest_ratings: latestRatings,
      stats: stats[0],
      current_tier: userRow[0]?.current_tier || 1,
      name: userRow[0]?.name || '',
      phone: userRow[0]?.phone || '',
      pickup_address: userRow[0]?.pickup_address || '',
      prefer_contact_before: userRow[0]?.prefer_contact_before || false
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load progress', details: err.message });
  }
}

// ── GET /api/learner?action=contact-pref ─────────────────────────────────────
// Returns the learner's contact preference.
async function handleContactPref(req, res) {
  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const [row] = await sql`
      SELECT prefer_contact_before FROM learner_users WHERE id = ${user.id}
    `;
    return res.json({ prefer_contact_before: row?.prefer_contact_before || false });
  } catch (err) {
    console.error('contact-pref error:', err);
    return res.status(500).json({ error: 'Failed to load preference' });
  }
}

// ── POST /api/learner?action=set-contact-pref ────────────────────────────────
// Body: { prefer_contact_before: boolean }
async function handleSetContactPref(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });

  try {
    const { prefer_contact_before } = req.body;
    const val = prefer_contact_before === true;
    const sql = neon(process.env.POSTGRES_URL);
    await sql`
      UPDATE learner_users SET prefer_contact_before = ${val} WHERE id = ${user.id}
    `;
    return res.json({ success: true, prefer_contact_before: val });
  } catch (err) {
    console.error('set-contact-pref error:', err);
    return res.status(500).json({ error: 'Failed to save preference' });
  }
}

// ── GET /api/learner?action=profile ──────────────────────────────────────────
// Returns the learner's profile (name, phone, pickup_address).
async function handleProfile(req, res) {
  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const [row] = await sql`
      SELECT name, email, phone, pickup_address, prefer_contact_before
      FROM learner_users WHERE id = ${user.id}
    `;
    if (!row) return res.status(404).json({ error: 'User not found' });
    return res.json({ profile: row });
  } catch (err) {
    console.error('profile error:', err);
    return res.status(500).json({ error: 'Failed to load profile' });
  }
}

// ── POST /api/learner?action=update-profile ──────────────────────────────────
// Body: { phone, pickup_address }
async function handleUpdateProfile(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });

  try {
    const { phone, pickup_address } = req.body;
    const sql = neon(process.env.POSTGRES_URL);
    const [updated] = await sql`
      UPDATE learner_users SET
        phone          = COALESCE(${phone ?? null}, phone),
        pickup_address = COALESCE(${pickup_address ?? null}, pickup_address)
      WHERE id = ${user.id}
      RETURNING name, email, phone, pickup_address
    `;
    return res.json({ success: true, profile: updated });
  } catch (err) {
    console.error('update-profile error:', err);
    return res.status(500).json({ error: 'Failed to update profile' });
  }
}
