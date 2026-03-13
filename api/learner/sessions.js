const { neon } = require('@neondatabase/serverless');
const verifyAuth = require('./_auth');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });

  const sql = neon(process.env.POSTGRES_URL);

  await sql`
    CREATE TABLE IF NOT EXISTS driving_sessions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      session_date DATE NOT NULL,
      duration_minutes INTEGER,
      session_type TEXT DEFAULT 'instructor',
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS skill_ratings (
      id SERIAL PRIMARY KEY,
      session_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      tier INTEGER NOT NULL,
      skill_key TEXT NOT NULL,
      rating TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  // GET — return sessions with their ratings
  if (req.method === 'GET') {
    try {
      const sessions = await sql`
        SELECT s.*,
          COALESCE(
            json_agg(
              json_build_object('skill_key', r.skill_key, 'tier', r.tier, 'rating', r.rating)
              ORDER BY r.id
            ) FILTER (WHERE r.id IS NOT NULL),
            '[]'
          ) as ratings
        FROM driving_sessions s
        LEFT JOIN skill_ratings r ON r.session_id = s.id
        WHERE s.user_id = ${user.id}
        GROUP BY s.id
        ORDER BY s.session_date DESC, s.created_at DESC
        LIMIT 20
      `;
      return res.json({ sessions });
    } catch (err) {
      console.error('sessions GET error:', err);
      return res.status(500).json({ error: 'Failed to load sessions', details: err.message });
    }
  }

  // POST — log a new session
  if (req.method === 'POST') {
    try {
      const { session_date, duration_minutes, session_type, notes, ratings } = req.body;
      if (!session_date) return res.status(400).json({ error: 'Session date is required' });

      const sessionRows = await sql`
        INSERT INTO driving_sessions (user_id, session_date, duration_minutes, session_type, notes)
        VALUES (${user.id}, ${session_date}, ${duration_minutes || null}, ${session_type || 'instructor'}, ${notes || null})
        RETURNING id
      `;
      const sessionId = sessionRows[0].id;

      if (ratings && ratings.length > 0) {
        for (const r of ratings) {
          await sql`
            INSERT INTO skill_ratings (session_id, user_id, tier, skill_key, rating)
            VALUES (${sessionId}, ${user.id}, ${r.tier}, ${r.skill_key}, ${r.rating})
          `;
        }
      }

      return res.json({ success: true, session_id: sessionId });
    } catch (err) {
      console.error('sessions POST error:', err);
      return res.status(500).json({ error: 'Failed to save session', details: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
