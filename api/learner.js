const { neon } = require('@neondatabase/serverless');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');

const FREE_TRIAL_CREDITS = 1;  // credits granted on signup

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
  if (action === 'register') return handleRegister(req, res);
  if (action === 'login')    return handleLogin(req, res);
  if (action === 'sessions') return handleSessions(req, res);
  if (action === 'progress') return handleProgress(req, res);
  return res.status(400).json({ error: 'Unknown action' });
};

// ── Register ─────────────────────────────────────────────────────────────────
async function handleRegister(req, res) {
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
        id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL, current_tier INTEGER DEFAULT 1,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`;

    const existing = await sql`SELECT id FROM learner_users WHERE email = ${email.toLowerCase().trim()}`;
    if (existing.length > 0)
      return res.status(400).json({ error: 'An account with this email already exists' });

    const hash = await bcrypt.hash(password, 10);
    const cleanEmail = email.toLowerCase().trim();
    const cleanName  = name.trim();

    const rows = await sql`
      INSERT INTO learner_users (name, email, password_hash, credit_balance)
      VALUES (${cleanName}, ${cleanEmail}, ${hash}, ${FREE_TRIAL_CREDITS})
      RETURNING id, name, email, current_tier, credit_balance`;

    const user = rows[0];

    // Record the free trial credit as a transaction for audit trail
    await sql`
      INSERT INTO credit_transactions
        (learner_id, type, credits, amount_pence, payment_method)
      VALUES
        (${user.id}, 'purchase', ${FREE_TRIAL_CREDITS}, 0, 'free_trial')
    `;

    // Send welcome email with free credit info
    try {
      const mailer = createTransporter();
      const firstName = cleanName.split(' ')[0] || 'there';
      await mailer.sendMail({
        from:    'CoachCarter <bookings@coachcarter.uk>',
        to:      cleanEmail,
        subject: `Welcome to CoachCarter — your free lesson credit is ready`,
        html: `
          <h1>Welcome, ${firstName}!</h1>
          <p>Your CoachCarter account is set up and we've added
             <strong>1 free lesson credit</strong> to get you started.</p>
          <p>That's a full 1.5-hour lesson with one of our instructors — no payment needed.</p>
          <h2>What to do next:</h2>
          <ol>
            <li><strong>Pick a slot</strong> — Browse available times and book your free lesson</li>
            <li><strong>Turn up and drive</strong> — Meet your instructor and get behind the wheel</li>
            <li><strong>Decide what's next</strong> — No pressure, no auto-billing</li>
          </ol>
          <p>
            <a href="https://coachcarter.uk/learner/book.html"
               style="background:#f58321;color:white;padding:14px 28px;text-decoration:none;
                      border-radius:8px;display:inline-block;font-weight:bold;">
              Book your free lesson →
            </a>
          </p>
          <p style="color:#888;font-size:0.85rem;margin-top:20px;">
            Questions? Just reply to this email — we're here to help.
          </p>
        `
      });
    } catch (emailErr) {
      // Don't fail registration if email fails
      console.error('welcome email error:', emailErr);
    }

    const token = jwt.sign({ id: user.id, email: user.email }, secret, { expiresIn: '30d' });
    return res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, tier: user.current_tier },
      free_credit: true
    });
  } catch (err) {
    console.error('register error:', err);
    return res.status(500).json({ error: 'Registration failed', details: err.message });
  }
}

// ── Email helper ────────────────────────────────────────────────────────────
function createTransporter() {
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   parseInt(process.env.SMTP_PORT),
    secure: process.env.SMTP_PORT === '465',
    auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

// ── Login ─────────────────────────────────────────────────────────────────────
async function handleLogin(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Email and password are required' });

    const secret = process.env.JWT_SECRET;
    if (!secret) return res.status(500).json({ error: 'JWT_SECRET not configured' });

    const sql = neon(process.env.POSTGRES_URL);
    const rows = await sql`SELECT * FROM learner_users WHERE email = ${email.toLowerCase().trim()}`;
    if (rows.length === 0) return res.status(401).json({ error: 'Invalid email or password' });

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid email or password' });

    const token = jwt.sign({ id: user.id, email: user.email }, secret, { expiresIn: '30d' });
    return res.json({ token, user: { id: user.id, name: user.name, email: user.email, tier: user.current_tier } });
  } catch (err) {
    console.error('login error:', err);
    return res.status(500).json({ error: 'Login failed', details: err.message });
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

    const userRow = await sql`SELECT current_tier, name FROM learner_users WHERE id = ${user.id}`;
    return res.json({
      latest_ratings: latestRatings,
      stats: stats[0],
      current_tier: userRow[0]?.current_tier || 1,
      name: userRow[0]?.name || ''
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load progress', details: err.message });
  }
}
