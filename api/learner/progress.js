const { neon } = require('@neondatabase/serverless');
const verifyAuth = require('./_auth');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });

  const sql = neon(process.env.POSTGRES_URL);

  try {
    // Latest rating per skill (most recent session wins)
    const latestRatings = await sql`
      SELECT DISTINCT ON (skill_key, tier)
        skill_key, tier, rating, created_at
      FROM skill_ratings
      WHERE user_id = ${user.id}
      ORDER BY skill_key, tier, created_at DESC
    `;

    // Session statistics
    const stats = await sql`
      SELECT
        COUNT(*)::int as total_sessions,
        COALESCE(SUM(duration_minutes), 0)::int as total_minutes,
        COUNT(*) FILTER (WHERE session_type = 'instructor')::int as instructor_sessions,
        COUNT(*) FILTER (WHERE session_type = 'private')::int as private_sessions
      FROM driving_sessions
      WHERE user_id = ${user.id}
    `;

    // User info
    const userRow = await sql`SELECT current_tier, name FROM learner_users WHERE id = ${user.id}`;

    return res.json({
      latest_ratings: latestRatings,
      stats: stats[0],
      current_tier: userRow[0]?.current_tier || 1,
      name: userRow[0]?.name || ''
    });
  } catch (err) {
    console.error('progress error:', err);
    return res.status(500).json({ error: 'Failed to load progress', details: err.message });
  }
};
