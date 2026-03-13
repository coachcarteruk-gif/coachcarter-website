const { neon } = require('@neondatabase/serverless');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password)
      return res.status(400).json({ error: 'Name, email and password are required' });
    if (password.length < 8)
      return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const secret = process.env.JWT_SECRET;
    if (!secret) return res.status(500).json({ error: 'JWT_SECRET not configured' });

    const sql = neon(process.env.POSTGRES_URL);

    await sql`
      CREATE TABLE IF NOT EXISTS learner_users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        current_tier INTEGER DEFAULT 1,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    const existing = await sql`SELECT id FROM learner_users WHERE email = ${email.toLowerCase().trim()}`;
    if (existing.length > 0)
      return res.status(400).json({ error: 'An account with this email already exists' });

    const hash = await bcrypt.hash(password, 10);
    const rows = await sql`
      INSERT INTO learner_users (name, email, password_hash)
      VALUES (${name.trim()}, ${email.toLowerCase().trim()}, ${hash})
      RETURNING id, name, email, current_tier
    `;

    const user = rows[0];
    const token = jwt.sign({ id: user.id, email: user.email }, secret, { expiresIn: '30d' });

    return res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, tier: user.current_tier }
    });
  } catch (err) {
    console.error('register error:', err);
    return res.status(500).json({ error: 'Registration failed', details: err.message });
  }
};
