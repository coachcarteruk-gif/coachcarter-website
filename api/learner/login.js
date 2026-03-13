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
    const { email, password } = req.body;

    if (!email || !password)
      return res.status(400).json({ error: 'Email and password are required' });

    const secret = process.env.JWT_SECRET;
    if (!secret) return res.status(500).json({ error: 'JWT_SECRET not configured' });

    const sql = neon(process.env.POSTGRES_URL);
    const rows = await sql`SELECT * FROM learner_users WHERE email = ${email.toLowerCase().trim()}`;

    if (rows.length === 0)
      return res.status(401).json({ error: 'Invalid email or password' });

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match)
      return res.status(401).json({ error: 'Invalid email or password' });

    const token = jwt.sign({ id: user.id, email: user.email }, secret, { expiresIn: '30d' });

    return res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, tier: user.current_tier }
    });
  } catch (err) {
    console.error('login error:', err);
    return res.status(500).json({ error: 'Login failed', details: err.message });
  }
};
