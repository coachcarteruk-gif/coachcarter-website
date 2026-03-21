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
  if (action === 'unlogged-bookings') return handleUnloggedBookings(req, res);
  if (action === 'qa-list')          return handleQAList(req, res);
  if (action === 'qa-detail')        return handleQADetail(req, res);
  if (action === 'qa-ask')           return handleQAAsk(req, res);
  if (action === 'qa-reply')         return handleQAReply(req, res);
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
  // Add booking link column
  await sql`ALTER TABLE driving_sessions ADD COLUMN IF NOT EXISTS booking_id INTEGER`;

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
      const { session_date, duration_minutes, session_type, notes, ratings, booking_id } = req.body;
      if (!session_date) return res.status(400).json({ error: 'Session date is required' });

      // Validate booking_id if provided
      if (booking_id) {
        const [booking] = await sql`
          SELECT id FROM lesson_bookings
          WHERE id = ${booking_id} AND learner_id = ${user.id} AND status = 'completed'`;
        if (!booking) return res.status(400).json({ error: 'Invalid or incomplete booking' });

        const [existing] = await sql`
          SELECT id FROM driving_sessions WHERE booking_id = ${booking_id}`;
        if (existing) return res.status(400).json({ error: 'This booking has already been logged' });
      }

      const sessionRows = await sql`
        INSERT INTO driving_sessions (user_id, session_date, duration_minutes, session_type, notes, booking_id)
        VALUES (${user.id}, ${session_date}, ${duration_minutes || null}, ${session_type || 'instructor'}, ${notes || null}, ${booking_id || null})
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

// ── GET /api/learner?action=unlogged-bookings ────────────────────────────────
// Returns completed bookings that haven't been logged yet.
async function handleUnloggedBookings(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const bookings = await sql`
      SELECT lb.id, lb.scheduled_date::text, lb.start_time::text, lb.end_time::text,
             i.name AS instructor_name, i.id AS instructor_id
      FROM lesson_bookings lb
      JOIN instructors i ON i.id = lb.instructor_id
      LEFT JOIN driving_sessions ds ON ds.booking_id = lb.id
      WHERE lb.learner_id = ${user.id}
        AND lb.status = 'completed'
        AND ds.id IS NULL
      ORDER BY lb.scheduled_date DESC
      LIMIT 20`;
    return res.json({ bookings });
  } catch (err) {
    console.error('unlogged-bookings error:', err);
    return res.status(500).json({ error: 'Failed to load unlogged bookings' });
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

// ── Q&A: List questions (public) ────────────────────────────────────────────
async function handleQAList(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const status = req.query.status;
    const limit = Math.min(parseInt(req.query.limit) || 50, 50);

    let questions;
    if (status) {
      questions = await sql`
        SELECT q.id, q.learner_id, q.title, q.body, q.status, q.booking_id, q.session_id,
               q.created_at, q.updated_at,
               lu.name AS learner_name,
               COUNT(a.id)::int AS answer_count
        FROM qa_questions q
        JOIN learner_users lu ON lu.id = q.learner_id
        LEFT JOIN qa_answers a ON a.question_id = q.id
        WHERE q.status = ${status}
        GROUP BY q.id, lu.name
        ORDER BY q.created_at DESC
        LIMIT ${limit}`;
    } else {
      questions = await sql`
        SELECT q.id, q.learner_id, q.title, q.body, q.status, q.booking_id, q.session_id,
               q.created_at, q.updated_at,
               lu.name AS learner_name,
               COUNT(a.id)::int AS answer_count
        FROM qa_questions q
        JOIN learner_users lu ON lu.id = q.learner_id
        LEFT JOIN qa_answers a ON a.question_id = q.id
        GROUP BY q.id, lu.name
        ORDER BY q.created_at DESC
        LIMIT ${limit}`;
    }
    return res.json({ questions });
  } catch (err) {
    console.error('qa-list error:', err);
    return res.status(500).json({ error: 'Failed to load questions' });
  }
}

// ── Q&A: Question detail with answers ───────────────────────────────────────
async function handleQADetail(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });

  const questionId = req.query.question_id;
  if (!questionId) return res.status(400).json({ error: 'question_id required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const [question] = await sql`
      SELECT q.*, lu.name AS learner_name
      FROM qa_questions q
      JOIN learner_users lu ON lu.id = q.learner_id
      WHERE q.id = ${questionId}`;
    if (!question) return res.status(404).json({ error: 'Question not found' });

    const answers = await sql`
      SELECT a.*,
        CASE WHEN a.author_type = 'learner' THEN lu.name
             WHEN a.author_type = 'instructor' THEN i.name
             ELSE 'Unknown' END AS author_name
      FROM qa_answers a
      LEFT JOIN learner_users lu ON a.author_type = 'learner' AND lu.id = a.author_id
      LEFT JOIN instructors i ON a.author_type = 'instructor' AND i.id = a.author_id
      WHERE a.question_id = ${questionId}
      ORDER BY a.created_at ASC`;

    return res.json({ question, answers });
  } catch (err) {
    console.error('qa-detail error:', err);
    return res.status(500).json({ error: 'Failed to load question' });
  }
}

// ── Q&A: Ask a question ─────────────────────────────────────────────────────
async function handleQAAsk(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });

  const { title, body, booking_id, session_id } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'Title is required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Ensure tables exist
    await sql`CREATE TABLE IF NOT EXISTS qa_questions (
      id SERIAL PRIMARY KEY, learner_id INTEGER NOT NULL, booking_id INTEGER,
      session_id INTEGER, title TEXT NOT NULL, body TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`;
    await sql`CREATE TABLE IF NOT EXISTS qa_answers (
      id SERIAL PRIMARY KEY, question_id INTEGER NOT NULL,
      author_type TEXT NOT NULL, author_id INTEGER NOT NULL,
      body TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())`;

    const [question] = await sql`
      INSERT INTO qa_questions (learner_id, booking_id, session_id, title, body)
      VALUES (${user.id}, ${booking_id || null}, ${session_id || null}, ${title.trim()}, ${body || null})
      RETURNING id, created_at`;

    // Send email notification to all active instructors
    try {
      const instructors = await sql`SELECT name, email FROM instructors WHERE active = TRUE`;
      if (instructors.length > 0) {
        const nodemailer = require('nodemailer');
        const mailer = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: parseInt(process.env.SMTP_PORT),
          secure: process.env.SMTP_PORT === '465',
          auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        });

        const [learner] = await sql`SELECT name FROM learner_users WHERE id = ${user.id}`;
        const learnerName = learner?.name || 'A learner';

        for (const inst of instructors) {
          if (inst.email === 'demo@coachcarter.uk') continue;
          await mailer.sendMail({
            from: 'CoachCarter <system@coachcarter.uk>',
            to: inst.email,
            subject: `New Q&A question from ${learnerName}`,
            html: `
              <h2>New question from ${learnerName}</h2>
              <p style="font-size:1.1rem;font-weight:bold;margin:16px 0 8px">${title.trim()}</p>
              ${body ? `<p style="color:#555">${body}</p>` : ''}
              <p style="margin:28px 0">
                <a href="https://coachcarter.uk/instructor/qa.html"
                   style="background:#f58321;color:white;padding:14px 28px;text-decoration:none;
                          border-radius:8px;display:inline-block;font-weight:bold;font-size:1rem;">
                  Answer this question
                </a>
              </p>
            `
          });
        }
      }
    } catch (emailErr) {
      console.error('Failed to send Q&A notification email:', emailErr);
    }

    return res.json({ success: true, question_id: question.id });
  } catch (err) {
    console.error('qa-ask error:', err);
    return res.status(500).json({ error: 'Failed to create question' });
  }
}

// ── Q&A: Learner reply/follow-up ────────────────────────────────────────────
async function handleQAReply(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });

  const { question_id, body } = req.body;
  if (!question_id) return res.status(400).json({ error: 'question_id required' });
  if (!body || !body.trim()) return res.status(400).json({ error: 'Reply body is required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const [question] = await sql`SELECT id FROM qa_questions WHERE id = ${question_id}`;
    if (!question) return res.status(404).json({ error: 'Question not found' });

    const [answer] = await sql`
      INSERT INTO qa_answers (question_id, author_type, author_id, body)
      VALUES (${question_id}, 'learner', ${user.id}, ${body.trim()})
      RETURNING id, created_at`;

    await sql`UPDATE qa_questions SET updated_at = NOW() WHERE id = ${question_id}`;

    return res.json({ success: true, answer_id: answer.id });
  } catch (err) {
    console.error('qa-reply error:', err);
    return res.status(500).json({ error: 'Failed to post reply' });
  }
}
