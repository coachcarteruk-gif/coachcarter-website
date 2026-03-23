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
  if (action === 'mock-tests')       return handleMockTests(req, res);
  if (action === 'mock-test-faults') return handleMockTestFaults(req, res);
  if (action === 'quiz-results')     return handleQuizResults(req, res);
  if (action === 'competency')       return handleCompetency(req, res);
  if (action === 'onboarding')       return handleOnboarding(req, res);
  if (action === 'profile-completeness') return handleProfileCompleteness(req, res);
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
          await sql`INSERT INTO skill_ratings (session_id, user_id, tier, skill_key, rating, note, driving_faults, serious_faults, dangerous_faults)
            VALUES (${sessionId}, ${user.id}, ${r.tier}, ${r.skill_key}, ${r.rating}, ${r.note || null},
                    ${r.driving_faults || 0}, ${r.serious_faults || 0}, ${r.dangerous_faults || 0})`;
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

// ── Mock Tests ──────────────────────────────────────────────────────────────
// GET: list learner's mock tests
// POST: create a new mock test (returns id), or complete one (body.complete = true)
async function handleMockTests(req, res) {
  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });
  const sql = neon(process.env.POSTGRES_URL);

  if (req.method === 'GET') {
    try {
      const tests = await sql`
        SELECT mt.*,
          COALESCE(json_agg(
            json_build_object(
              'part', f.part, 'skill_key', f.skill_key,
              'driving_faults', f.driving_faults,
              'serious_faults', f.serious_faults,
              'dangerous_faults', f.dangerous_faults
            ) ORDER BY f.part, f.skill_key
          ) FILTER (WHERE f.id IS NOT NULL), '[]') AS faults
        FROM mock_tests mt
        LEFT JOIN mock_test_faults f ON f.mock_test_id = mt.id
        WHERE mt.learner_id = ${user.id}
        GROUP BY mt.id
        ORDER BY mt.started_at DESC
        LIMIT 20`;
      return res.json({ mock_tests: tests });
    } catch (err) {
      console.error('mock-tests GET error:', err);
      return res.status(500).json({ error: 'Failed to load mock tests' });
    }
  }

  if (req.method === 'POST') {
    try {
      const { mock_test_id, complete, notes } = req.body;

      // Complete an existing mock test
      if (complete && mock_test_id) {
        // Sum faults from mock_test_faults
        const [totals] = await sql`
          SELECT
            COALESCE(SUM(driving_faults), 0)::int AS total_d,
            COALESCE(SUM(serious_faults), 0)::int AS total_s,
            COALESCE(SUM(dangerous_faults), 0)::int AS total_x
          FROM mock_test_faults WHERE mock_test_id = ${mock_test_id}`;

        const result = (totals.total_s > 0 || totals.total_x > 0 || totals.total_d > 15)
          ? 'fail' : 'pass';

        await sql`
          UPDATE mock_tests SET
            completed_at = NOW(),
            result = ${result},
            total_driving_faults = ${totals.total_d},
            total_serious_faults = ${totals.total_s},
            total_dangerous_faults = ${totals.total_x},
            notes = ${notes || null}
          WHERE id = ${mock_test_id} AND learner_id = ${user.id}`;

        return res.json({ success: true, mock_test_id, result, totals });
      }

      // Create new mock test
      const [row] = await sql`
        INSERT INTO mock_tests (learner_id)
        VALUES (${user.id})
        RETURNING id, started_at`;

      return res.json({ success: true, mock_test_id: row.id, started_at: row.started_at });
    } catch (err) {
      console.error('mock-tests POST error:', err);
      return res.status(500).json({ error: 'Failed to save mock test' });
    }
  }
  return res.status(405).json({ error: 'Method not allowed' });
}

// ── Mock Test Faults (save faults for a part) ───────────────────────────────
// POST: { mock_test_id, part (1-3), faults: [{ skill_key, driving, serious, dangerous }] }
async function handleMockTestFaults(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });

  try {
    const { mock_test_id, part, faults } = req.body;
    if (!mock_test_id || !part || part < 1 || part > 3)
      return res.status(400).json({ error: 'mock_test_id and part (1-3) required' });

    const sql = neon(process.env.POSTGRES_URL);

    // Verify ownership
    const [test] = await sql`
      SELECT id FROM mock_tests WHERE id = ${mock_test_id} AND learner_id = ${user.id}`;
    if (!test) return res.status(404).json({ error: 'Mock test not found' });

    // Clear any existing faults for this part (allow re-recording)
    await sql`DELETE FROM mock_test_faults WHERE mock_test_id = ${mock_test_id} AND part = ${part}`;

    // Insert new faults (only skills that had faults)
    if (faults?.length > 0) {
      for (const f of faults) {
        if ((f.driving || 0) + (f.serious || 0) + (f.dangerous || 0) > 0) {
          await sql`
            INSERT INTO mock_test_faults (mock_test_id, part, skill_key, driving_faults, serious_faults, dangerous_faults)
            VALUES (${mock_test_id}, ${part}, ${f.skill_key}, ${f.driving || 0}, ${f.serious || 0}, ${f.dangerous || 0})`;
        }
      }
    }

    return res.json({ success: true, part });
  } catch (err) {
    console.error('mock-test-faults error:', err);
    return res.status(500).json({ error: 'Failed to save faults' });
  }
}

// ── Quiz Results (persist per-question answers) ─────────────────────────────
// POST: { results: [{ question_id, skill_key, correct, learner_answer, correct_answer }] }
// GET: returns quiz history for this learner
async function handleQuizResults(req, res) {
  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });
  const sql = neon(process.env.POSTGRES_URL);

  if (req.method === 'GET') {
    try {
      // Per-skill accuracy
      const accuracy = await sql`
        SELECT skill_key,
          COUNT(*)::int AS attempts,
          COUNT(*) FILTER (WHERE correct)::int AS correct_count,
          ROUND(100.0 * COUNT(*) FILTER (WHERE correct) / NULLIF(COUNT(*), 0), 1) AS accuracy_pct
        FROM quiz_results
        WHERE learner_id = ${user.id}
        GROUP BY skill_key
        ORDER BY accuracy_pct ASC`;

      // Recent results (last 50)
      const recent = await sql`
        SELECT question_id, skill_key, correct, learner_answer, correct_answer, answered_at
        FROM quiz_results
        WHERE learner_id = ${user.id}
        ORDER BY answered_at DESC
        LIMIT 50`;

      return res.json({ accuracy, recent });
    } catch (err) {
      console.error('quiz-results GET error:', err);
      return res.status(500).json({ error: 'Failed to load quiz results' });
    }
  }

  if (req.method === 'POST') {
    try {
      const { results } = req.body;
      if (!results?.length) return res.status(400).json({ error: 'results array required' });

      for (const r of results) {
        await sql`
          INSERT INTO quiz_results (learner_id, question_id, skill_key, correct, learner_answer, correct_answer)
          VALUES (${user.id}, ${r.question_id}, ${r.skill_key}, ${r.correct}, ${r.learner_answer || null}, ${r.correct_answer || null})`;
      }

      return res.json({ success: true, saved: results.length });
    } catch (err) {
      console.error('quiz-results POST error:', err);
      return res.status(500).json({ error: 'Failed to save quiz results' });
    }
  }
  return res.status(405).json({ error: 'Method not allowed' });
}

// ── Competency Profile (aggregated view for dashboard / AI) ─────────────────
// GET: returns the full competency profile for this learner
async function handleCompetency(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Latest 3 lesson ratings per skill (new keys only, ignoring legacy)
    const lessonData = await sql`
      SELECT skill_key, rating, created_at
      FROM skill_ratings
      WHERE user_id = ${user.id}
      ORDER BY skill_key, created_at DESC`;

    // Quiz accuracy per skill
    const quizData = await sql`
      SELECT skill_key,
        COUNT(*)::int AS attempts,
        COUNT(*) FILTER (WHERE correct)::int AS correct_count
      FROM quiz_results
      WHERE learner_id = ${user.id}
      GROUP BY skill_key`;

    // Mock test summary
    const mockData = await sql`
      SELECT
        COUNT(*)::int AS total_tests,
        COUNT(*) FILTER (WHERE result = 'pass')::int AS passes,
        COUNT(*) FILTER (WHERE result = 'fail')::int AS fails
      FROM mock_tests
      WHERE learner_id = ${user.id} AND completed_at IS NOT NULL`;

    // Mock test faults aggregated by skill
    const mockFaults = await sql`
      SELECT f.skill_key,
        SUM(f.driving_faults)::int AS total_driving,
        SUM(f.serious_faults)::int AS total_serious,
        SUM(f.dangerous_faults)::int AS total_dangerous
      FROM mock_test_faults f
      JOIN mock_tests mt ON mt.id = f.mock_test_id
      WHERE mt.learner_id = ${user.id}
      GROUP BY f.skill_key`;

    // Session stats
    const stats = await sql`
      SELECT COUNT(*)::int as total_sessions,
        COALESCE(SUM(duration_minutes), 0)::int as total_minutes
      FROM driving_sessions WHERE user_id = ${user.id}`;

    return res.json({
      lesson_ratings: lessonData,
      quiz_accuracy: quizData,
      mock_summary: mockData[0] || { total_tests: 0, passes: 0, fails: 0 },
      mock_faults: mockFaults,
      session_stats: stats[0] || { total_sessions: 0, total_minutes: 0 }
    });
  } catch (err) {
    console.error('competency error:', err);
    return res.status(500).json({ error: 'Failed to load competency data' });
  }
}

// ── Onboarding ──────────────────────────────────────────────────────────────
// GET: returns existing onboarding data (or null)
// POST: saves/updates onboarding data + optional initial assessment ratings
async function handleOnboarding(req, res) {
  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });
  const sql = neon(process.env.POSTGRES_URL);

  if (req.method === 'GET') {
    try {
      const [row] = await sql`SELECT * FROM learner_onboarding WHERE learner_id = ${user.id}`;
      return res.json({ onboarding: row || null });
    } catch (err) {
      console.error('onboarding GET error:', err);
      return res.status(500).json({ error: 'Failed to load onboarding data' });
    }
  }

  if (req.method === 'POST') {
    try {
      const { prior_hours_pro, prior_hours_private, previous_tests, transmission,
              test_booked, test_date, main_concerns, initial_ratings } = req.body;

      // Upsert onboarding record
      await sql`
        INSERT INTO learner_onboarding (learner_id, prior_hours_pro, prior_hours_private,
          previous_tests, transmission, test_booked, test_date, main_concerns, completed_at)
        VALUES (${user.id}, ${prior_hours_pro || 0}, ${prior_hours_private || 0},
          ${previous_tests || 0}, ${transmission || 'manual'},
          ${test_booked || false}, ${test_date || null}, ${main_concerns || null}, NOW())
        ON CONFLICT (learner_id) DO UPDATE SET
          prior_hours_pro = ${prior_hours_pro || 0},
          prior_hours_private = ${prior_hours_private || 0},
          previous_tests = ${previous_tests || 0},
          transmission = ${transmission || 'manual'},
          test_booked = ${test_booked || false},
          test_date = ${test_date || null},
          main_concerns = ${main_concerns || null},
          completed_at = NOW()`;

      // Save initial self-assessment as a special "onboarding" session
      if (initial_ratings?.length > 0) {
        // Check if an onboarding session already exists
        const [existing] = await sql`
          SELECT id FROM driving_sessions WHERE user_id = ${user.id} AND session_type = 'onboarding'`;

        let sessionId;
        if (existing) {
          sessionId = existing.id;
          // Clear old ratings for this session
          await sql`DELETE FROM skill_ratings WHERE session_id = ${sessionId}`;
        } else {
          const [newSession] = await sql`
            INSERT INTO driving_sessions (user_id, session_date, duration_minutes, session_type, notes)
            VALUES (${user.id}, CURRENT_DATE, 0, 'onboarding', 'Initial self-assessment during onboarding')
            RETURNING id`;
          sessionId = newSession.id;
        }

        for (const r of initial_ratings) {
          await sql`INSERT INTO skill_ratings (session_id, user_id, tier, skill_key, rating)
            VALUES (${sessionId}, ${user.id}, 0, ${r.skill_key}, ${r.rating})`;
        }
      }

      return res.json({ success: true });
    } catch (err) {
      console.error('onboarding POST error:', err);
      return res.status(500).json({ error: 'Failed to save onboarding data' });
    }
  }
  return res.status(405).json({ error: 'Method not allowed' });
}

// ── Profile Completeness ────────────────────────────────────────────────────
// GET: returns completion status for each onboarding step
async function handleProfileCompleteness(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const [onboarding] = await sql`SELECT id FROM learner_onboarding WHERE learner_id = ${user.id}`;
    const [assessment] = await sql`
      SELECT ds.id FROM driving_sessions ds WHERE ds.user_id = ${user.id} AND ds.session_type = 'onboarding'`;
    const [session] = await sql`
      SELECT id FROM driving_sessions WHERE user_id = ${user.id} AND session_type != 'onboarding' LIMIT 1`;
    const [quiz] = await sql`SELECT id FROM quiz_results WHERE learner_id = ${user.id} LIMIT 1`;

    const steps = {
      account_created: true,
      prior_experience: !!onboarding,
      initial_assessment: !!assessment,
      first_session: !!session,
      first_quiz: !!quiz
    };

    const completed = Object.values(steps).filter(Boolean).length;
    const total = Object.keys(steps).length;

    return res.json({ steps, completed, total, percentage: Math.round((completed / total) * 100) });
  } catch (err) {
    console.error('profile-completeness error:', err);
    return res.status(500).json({ error: 'Failed to check profile completeness' });
  }
}
