const { neon } = require('@neondatabase/serverless');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { requireAuth } = require('./_auth');
const { reportError } = require('./_error-alert');
const { checkRateLimit } = require('./_rate-limit');
const { SCHEDULED, CHARGEABLE, REFUNDED, BLOCKING_STATUSES } = require('./_booking-status');
const { deleteLearnerCascade, refundLedgerTablesExist, learnerBroadcastTablesExist } = require('./_gdpr');

// ── Auth helper ──────────────────────────────────────────────────────────────
// Every handler in this file operates on learner-owned data (skill ratings,
// onboarding, deletion requests, profile, etc.) and there is no legitimate
// cross-role use case. The wrapper gates on role='learner' so a stale
// instructor or admin cookie cannot reach a learner endpoint and act under
// the wrong user_id. Legacy learner tokens (pre-multi-tenancy, no `role`
// field) still pass — requireAuth normalises them to 'learner' at line 178.
function verifyAuth(req) {
  return requireAuth(req, { roles: ['learner'] });
}

function escapeEmailHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Main handler ─────────────────────────────────────────────────────────────
//
// Every mutating request (non-GET) is logged with action, status, and
// duration so "the button does nothing" reports can be diagnosed from
// Vercel logs without contacting the learner. Tag the line with
// [learner-api] so it's easy to grep / filter.
module.exports = async (req, res) => {
  const action = req.query.action;
  const method = req.method || 'GET';
  const shouldLog = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
  const startedAt = shouldLog ? Date.now() : 0;

  if (shouldLog) {
    const origStatus = res.status.bind(res);
    let statusCode = 200;
    res.status = (code) => { statusCode = code; return origStatus(code); };
    res.on('finish', () => {
      const ms = Date.now() - startedAt;
      console.log(`[learner-api] ${method} action=${action} status=${statusCode} ${ms}ms`);
    });
  }

  if (action === 'update-name')       return handleUpdateName(req, res);
  if (action === 'sessions')          return handleSessions(req, res);
  if (action === 'progress')          return handleProgress(req, res);
  if (action === 'contact-pref')      return handleContactPref(req, res);
  if (action === 'set-contact-pref')  return handleSetContactPref(req, res);
  if (action === 'profile')           return handleProfile(req, res);
  if (action === 'update-profile')    return handleUpdateProfile(req, res);
  if (action === 'unlogged-bookings') return handleUnloggedBookings(req, res);
  if (action === 'mock-tests')       return handleMockTests(req, res);
  if (action === 'mock-test-faults') return handleMockTestFaults(req, res);
  if (action === 'focused-practice') return handleFocusedPractice(req, res);
  if (action === 'quiz-results')     return handleQuizResults(req, res);
  if (action === 'competency')       return handleCompetency(req, res);
  if (action === 'onboarding')       return handleOnboarding(req, res);
  if (action === 'profile-completeness') return handleProfileCompleteness(req, res);
  if (action === 'my-availability')       return handleMyAvailability(req, res);
  if (action === 'set-availability')      return handleSetAvailability(req, res);
  if (action === 'accept-terms')          return handleAcceptTerms(req, res);
  if (action === 'validate-referral')      return handleValidateReferral(req, res);
  if (action === 'referral-code')         return handleReferralCode(req, res);
  if (action === 'referral-stats')        return handleReferralStats(req, res);
  if (action === 'submit-feedback')       return handleSubmitFeedback(req, res);
  if (action === 'export-data')           return handleExportData(req, res);
  if (action === 'request-deletion')      return handleRequestDeletion(req, res);
  if (action === 'confirm-deletion')      return handleConfirmDeletion(req, res);
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
    const schoolId = user.school_id || 1;
    await sql`UPDATE learner_users SET name = ${name.trim()} WHERE id = ${user.id} AND school_id = ${schoolId}`;
    return res.json({ success: true, name: name.trim() });
  } catch (err) {
    console.error('update-name error:', err);
    reportError('/api/learner', err);
    return res.status(500).json({ error: 'Failed to update name' });
  }
}

// ── Sessions ──────────────────────────────────────────────────────────────────
async function handleSessions(req, res) {
  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = user.school_id || 1;

  const sql = neon(process.env.POSTGRES_URL);

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
        WHERE s.user_id = ${user.id} AND s.school_id = ${schoolId}
        GROUP BY s.id ORDER BY s.session_date DESC, s.created_at DESC LIMIT 20`;
      return res.json({ sessions });
    } catch (err) {
      reportError('/api/learner', err);
      return res.status(500).json({ error: 'Failed to load sessions', details: 'Internal server error' });
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
          WHERE id = ${booking_id} AND learner_id = ${user.id} AND school_id = ${schoolId} AND status = ${CHARGEABLE}`;
        if (!booking) return res.status(400).json({ error: 'Invalid or incomplete booking' });

        const [existing] = await sql`
          SELECT id FROM driving_sessions WHERE booking_id = ${booking_id}`;
        if (existing) return res.status(400).json({ error: 'This booking has already been logged' });
      }

      const sessionRows = await sql`
        INSERT INTO driving_sessions (user_id, session_date, duration_minutes, session_type, notes, booking_id, school_id)
        VALUES (${user.id}, ${session_date}, ${duration_minutes || null}, ${session_type || 'instructor'}, ${notes || null}, ${booking_id || null}, ${schoolId})
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
      reportError('/api/learner', err);
      return res.status(500).json({ error: 'Failed to save session', details: 'Internal server error' });
    }
  }
  return res.status(405).json({ error: 'Method not allowed' });
}

// ── Progress ──────────────────────────────────────────────────────────────────
async function handleProgress(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = user.school_id || 1;

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
      FROM driving_sessions WHERE user_id = ${user.id} AND school_id = ${schoolId}`;

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
    reportError('/api/learner', err);
    return res.status(500).json({ error: 'Failed to load progress', details: 'Internal server error' });
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
    reportError('/api/learner', err);
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
    const schoolId = user.school_id || 1;
    await sql`
      UPDATE learner_users SET prefer_contact_before = ${val} WHERE id = ${user.id} AND school_id = ${schoolId}
    `;
    return res.json({ success: true, prefer_contact_before: val });
  } catch (err) {
    console.error('set-contact-pref error:', err);
    reportError('/api/learner', err);
    return res.status(500).json({ error: 'Failed to save preference' });
  }
}

// ── GET /api/learner?action=profile ──────────────────────────────────────────
// Returns the learner's profile (name, phone, pickup_address).
async function handleProfile(req, res) {
  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = user.school_id || 1;

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Columns already exist in learner_users — no migrations needed
    const [row] = await sql`
      SELECT name, email, phone, pickup_address, prefer_contact_before, test_date, test_time
      FROM learner_users WHERE id = ${user.id} AND school_id = ${schoolId}
    `;
    if (!row) return res.status(404).json({ error: 'User not found' });
    return res.json({ profile: row });
  } catch (err) {
    console.error('profile error:', err);
    reportError('/api/learner', err);
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
    const schoolId = user.school_id || 1;
    const bookings = await sql`
      SELECT lb.id, lb.scheduled_date::text, lb.start_time::text, lb.end_time::text,
             i.name AS instructor_name, i.id AS instructor_id
      FROM lesson_bookings lb
      JOIN instructors i ON i.id = lb.instructor_id
      LEFT JOIN driving_sessions ds ON ds.booking_id = lb.id
      WHERE lb.learner_id = ${user.id}
        AND lb.status = ${CHARGEABLE}
        AND ds.id IS NULL
        AND lb.school_id = ${schoolId}
      ORDER BY lb.scheduled_date DESC
      LIMIT 20`;
    return res.json({ bookings });
  } catch (err) {
    console.error('unlogged-bookings error:', err);
    reportError('/api/learner', err);
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
    const schoolId = user.school_id || 1;

    // No migration needed — pickup_address column already exists in learner_users
    const [updated] = await sql`
      UPDATE learner_users SET
        phone          = COALESCE(${phone || null}, phone),
        pickup_address = COALESCE(${pickup_address || null}, pickup_address)
      WHERE id = ${user.id} AND school_id = ${schoolId}
      RETURNING name, email, phone, pickup_address
    `;
    return res.json({ success: true, profile: updated });
  } catch (err) {
    console.error('update-profile error:', err.message);
    // Unique constraint on phone number
    if (err.message && err.message.includes('duplicate') && err.message.includes('phone')) {
      return res.status(409).json({ error: 'This phone number is already linked to another account.' });
    }
    reportError('/api/learner', err);
    return res.status(500).json({ error: 'Failed to update profile', details: 'Internal server error' });
  }
}

// ── Mock Tests ──────────────────────────────────────────────────────────────
// GET: list learner's mock tests
// POST: create a new mock test (returns id), or complete one (body.complete = true)
async function handleMockTests(req, res) {
  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });
  const sql = neon(process.env.POSTGRES_URL);
  const schoolId = user.school_id || 1;

  if (req.method === 'GET') {
    try {
      const tests = await sql`
        SELECT mt.*,
          COALESCE(json_agg(
            json_build_object(
              'part', f.part, 'skill_key', f.skill_key,
              'driving_faults', f.driving_faults,
              'serious_faults', f.serious_faults,
              'dangerous_faults', f.dangerous_faults,
              'supervisor_rating', f.supervisor_rating
            ) ORDER BY f.part, f.skill_key
          ) FILTER (WHERE f.id IS NOT NULL), '[]') AS faults
        FROM mock_tests mt
        LEFT JOIN mock_test_faults f ON f.mock_test_id = mt.id
        WHERE mt.learner_id = ${user.id} AND mt.school_id = ${schoolId}
        GROUP BY mt.id
        ORDER BY mt.started_at DESC
        LIMIT 20`;
      return res.json({ mock_tests: tests });
    } catch (err) {
      console.error('mock-tests GET error:', err);
      reportError('/api/learner', err);
      return res.status(500).json({ error: 'Failed to load mock tests' });
    }
  }

  if (req.method === 'POST') {
    try {
      const { mock_test_id, complete, notes, mode, route_id, instructor_id } = req.body;

      // Complete an existing mock test
      if (complete && mock_test_id) {
        // Check mode to determine result logic
        const [testRow] = await sql`
          SELECT mode FROM mock_tests WHERE id = ${mock_test_id} AND learner_id = ${user.id}`;
        if (!testRow) return res.status(404).json({ error: 'Mock test not found' });

        if (testRow.mode === 'supervisor') {
          // Supervisor mode: no pass/fail, just mark complete
          await sql`
            UPDATE mock_tests SET
              completed_at = NOW(),
              result = NULL,
              notes = ${notes || null}
            WHERE id = ${mock_test_id} AND learner_id = ${user.id}`;
          return res.json({ success: true, mock_test_id, result: null });
        }

        // Instructor mode (or legacy): pass/fail based on D/S/X
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

      // Create new mock test (with mode)
      const testMode = mode === 'supervisor' ? 'supervisor' : mode === 'instructor' ? 'instructor' : null;
      const [row] = await sql`
        INSERT INTO mock_tests (learner_id, school_id, mode, route_id, instructor_id)
        VALUES (${user.id}, ${schoolId}, ${testMode}, ${route_id || null}, ${instructor_id || null})
        RETURNING id, started_at`;

      return res.json({ success: true, mock_test_id: row.id, started_at: row.started_at });
    } catch (err) {
      console.error('mock-tests POST error:', err);
      reportError('/api/learner', err);
      return res.status(500).json({ error: 'Failed to save mock test' });
    }
  }
  return res.status(405).json({ error: 'Method not allowed' });
}

// ── Mock Test Faults (save faults for a part) ───────────────────────────────
// POST: { mock_test_id, part, faults: [{ skill_key, sub_key?, driving?, serious?, dangerous?, supervisor_rating? }] }
async function handleMockTestFaults(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });

  try {
    const { mock_test_id, part, faults } = req.body;
    if (!mock_test_id || !part || part < 1 || part > 10)
      return res.status(400).json({ error: 'mock_test_id and part (1-10) required' });

    const sql = neon(process.env.POSTGRES_URL);
    const schoolId = user.school_id || 1;

    // Verify ownership
    const [test] = await sql`
      SELECT id FROM mock_tests WHERE id = ${mock_test_id} AND learner_id = ${user.id}`;
    if (!test) return res.status(404).json({ error: 'Mock test not found' });

    // Clear any existing faults for this part (allow re-recording)
    await sql`DELETE FROM mock_test_faults WHERE mock_test_id = ${mock_test_id} AND part = ${part}`;

    // Insert new faults
    if (faults?.length > 0) {
      for (const f of faults) {
        const hasDSX = (f.driving || 0) + (f.serious || 0) + (f.dangerous || 0) > 0;
        const hasSupervisor = !!f.supervisor_rating;
        if (hasDSX || hasSupervisor) {
          await sql`
            INSERT INTO mock_test_faults (mock_test_id, school_id, part, skill_key, sub_key, driving_faults, serious_faults, dangerous_faults, supervisor_rating)
            VALUES (${mock_test_id}, ${schoolId}, ${part}, ${f.skill_key}, ${f.sub_key || null}, ${f.driving || 0}, ${f.serious || 0}, ${f.dangerous || 0}, ${f.supervisor_rating || null})`;
        }
      }
    }

    return res.json({ success: true, part });
  } catch (err) {
    console.error('mock-test-faults error:', err);
    reportError('/api/learner', err);
    return res.status(500).json({ error: 'Failed to save faults' });
  }
}

// ── Focused Practice Sessions ────────────────────────────────────────────────
// GET: return history  POST: create session with reflections
async function handleFocusedPractice(req, res) {
  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });
  const sql = neon(process.env.POSTGRES_URL);
  const schoolId = user.school_id || 1;

  if (req.method === 'GET') {
    try {
      const sessions = await sql`
        SELECT fp.*, ds.session_date, ds.duration_minutes
        FROM focused_practice_sessions fp
        JOIN driving_sessions ds ON ds.id = fp.session_id
        WHERE fp.learner_id = ${user.id} AND fp.school_id = ${schoolId}
        ORDER BY fp.created_at DESC
        LIMIT 20`;
      return res.json({ sessions });
    } catch (err) {
      console.error('focused-practice GET error:', err);
      reportError('/api/learner', err);
      return res.status(500).json({ error: 'Failed to load practice sessions' });
    }
  }

  if (req.method === 'POST') {
    try {
      const { focus_areas, suggested_areas, duration_minutes, reflections } = req.body;
      if (!focus_areas || !Array.isArray(focus_areas) || focus_areas.length === 0 || focus_areas.length > 3) {
        return res.status(400).json({ error: 'focus_areas must be 1-3 items' });
      }

      // Create driving_session
      const [session] = await sql`
        INSERT INTO driving_sessions (user_id, session_date, duration_minutes, session_type, school_id)
        VALUES (${user.id}, NOW()::date, ${duration_minutes || 0}, 'focused_practice', ${schoolId})
        RETURNING id`;

      // Create focused_practice_sessions row
      const [fp] = await sql`
        INSERT INTO focused_practice_sessions (session_id, learner_id, school_id, focus_areas, suggested_areas, reflections, completed_at)
        VALUES (${session.id}, ${user.id}, ${schoolId}, ${JSON.stringify(focus_areas)}, ${JSON.stringify(suggested_areas || null)}, ${JSON.stringify(reflections || null)}, NOW())
        RETURNING id`;

      // Create skill_ratings for each reflected area
      if (reflections && typeof reflections === 'object') {
        for (const [skillKey, data] of Object.entries(reflections)) {
          if (data && data.rating) {
            await sql`
              INSERT INTO skill_ratings (session_id, user_id, skill_key, rating, note, tier, school_id)
              VALUES (${session.id}, ${user.id}, ${skillKey}, ${data.rating}, ${data.note || null}, 1, ${schoolId})`;
          }
        }
      }

      // Update last_activity_at
      await sql`UPDATE learner_users SET last_activity_at = NOW() WHERE id = ${user.id}`;

      return res.json({ success: true, session_id: session.id, practice_id: fp.id });
    } catch (err) {
      console.error('focused-practice POST error:', err);
      reportError('/api/learner', err);
      return res.status(500).json({ error: 'Failed to save practice session' });
    }
  }
  return res.status(405).json({ error: 'Method not allowed' });
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
      reportError('/api/learner', err);
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
      reportError('/api/learner', err);
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
  const schoolId = user.school_id || 1;

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Latest 3 lesson ratings per skill (new keys only, ignoring legacy)
    const lessonData = await sql`
      SELECT skill_key, rating, created_at
      FROM skill_ratings
      WHERE user_id = ${user.id} AND school_id = ${schoolId}
      ORDER BY skill_key, created_at DESC`;

    // Quiz accuracy per skill
    const quizData = await sql`
      SELECT skill_key,
        COUNT(*)::int AS attempts,
        COUNT(*) FILTER (WHERE correct)::int AS correct_count
      FROM quiz_results
      WHERE learner_id = ${user.id} AND school_id = ${schoolId}
      GROUP BY skill_key`;

    // Mock test summary (only instructor-mode or legacy tests count for pass/fail)
    const mockData = await sql`
      SELECT
        COUNT(*)::int AS total_tests,
        COUNT(*) FILTER (WHERE result = 'pass')::int AS passes,
        COUNT(*) FILTER (WHERE result = 'fail')::int AS fails
      FROM mock_tests
      WHERE learner_id = ${user.id} AND school_id = ${schoolId} AND completed_at IS NOT NULL`;

    // Mock test faults aggregated by skill
    const mockFaults = await sql`
      SELECT f.skill_key,
        SUM(f.driving_faults)::int AS total_driving,
        SUM(f.serious_faults)::int AS total_serious,
        SUM(f.dangerous_faults)::int AS total_dangerous
      FROM mock_test_faults f
      JOIN mock_tests mt ON mt.id = f.mock_test_id
      WHERE mt.learner_id = ${user.id} AND mt.school_id = ${schoolId}
      GROUP BY f.skill_key`;

    // Most recent completed mock test — metadata + per-skill + per-sub-skill faults.
    // The progress page's skill breakdown is now scoped to this one mock test,
    // so we need the date/result for the heading and the full fault breakdown.
    const recentMockMeta = await sql`
      SELECT id, completed_at, result
      FROM mock_tests
      WHERE learner_id = ${user.id} AND school_id = ${schoolId}
        AND completed_at IS NOT NULL
      ORDER BY completed_at DESC
      LIMIT 1`;
    const recentMockId = recentMockMeta[0] ? recentMockMeta[0].id : null;

    // Per-skill parent-level fault totals from the most recent mock (sub_key IS NULL)
    const recentSkillFaults = recentMockId ? await sql`
      SELECT f.skill_key,
        SUM(f.driving_faults)::int AS driving,
        SUM(f.serious_faults)::int AS serious,
        SUM(f.dangerous_faults)::int AS dangerous
      FROM mock_test_faults f
      WHERE f.mock_test_id = ${recentMockId} AND f.sub_key IS NULL
      GROUP BY f.skill_key` : [];

    // Per-sub-skill faults from the most recent mock (sub_key IS NOT NULL)
    const recentSubFaults = recentMockId ? await sql`
      SELECT f.skill_key, f.sub_key,
        SUM(f.driving_faults)::int AS driving,
        SUM(f.serious_faults)::int AS serious,
        SUM(f.dangerous_faults)::int AS dangerous
      FROM mock_test_faults f
      WHERE f.mock_test_id = ${recentMockId} AND f.sub_key IS NOT NULL
      GROUP BY f.skill_key, f.sub_key` : [];

    // Session stats
    const stats = await sql`
      SELECT COUNT(*)::int as total_sessions,
        COALESCE(SUM(duration_minutes), 0)::int as total_minutes
      FROM driving_sessions WHERE user_id = ${user.id} AND school_id = ${schoolId}`;

    // Focused practice session count
    const fpStats = await sql`
      SELECT COUNT(*)::int as total_sessions
      FROM focused_practice_sessions
      WHERE learner_id = ${user.id} AND school_id = ${schoolId}`;

    return res.json({
      lesson_ratings: lessonData,
      quiz_accuracy: quizData,
      mock_summary: mockData[0] || { total_tests: 0, passes: 0, fails: 0 },
      mock_faults: mockFaults,
      recent_mock: recentMockMeta[0] || null,
      recent_skill_faults: recentSkillFaults,
      recent_sub_faults: recentSubFaults,
      session_stats: stats[0] || { total_sessions: 0, total_minutes: 0 },
      focused_practice_count: (fpStats[0] || {}).total_sessions || 0
    });
  } catch (err) {
    console.error('competency error:', err);
    reportError('/api/learner', err);
    return res.status(500).json({ error: 'Failed to load competency data' });
  }
}

// ── Onboarding ──────────────────────────────────────────────────────────────
// GET: returns existing onboarding data (or null)
// POST: saves/updates onboarding data + optional initial assessment ratings
async function handleOnboarding(req, res) {
  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = user.school_id || 1;
  const sql = neon(process.env.POSTGRES_URL);

  if (req.method === 'GET') {
    try {
      const [row] = await sql`SELECT * FROM learner_onboarding WHERE learner_id = ${user.id}`;
      return res.json({ onboarding: row || null });
    } catch (err) {
      console.error('onboarding GET error:', err);
      reportError('/api/learner', err);
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
      reportError('/api/learner', err);
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
    reportError('/api/learner', err);
    return res.status(500).json({ error: 'Failed to check profile completeness' });
  }
}

// ── Learner Availability — GET ─────────────────────────────────────────────
async function handleMyAvailability(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const rows = await sql`
      SELECT id, day_of_week, start_time::text, end_time::text
      FROM learner_availability
      WHERE learner_id = ${user.id} AND active = true
      ORDER BY day_of_week, start_time`;
    return res.json({ availability: rows });
  } catch (err) {
    console.error('my-availability error:', err);
    reportError('/api/learner', err);
    return res.status(500).json({ error: 'Failed to load availability' });
  }
}

// ── Learner Availability — SET (delete + insert) ───────────────────────────
async function handleSetAvailability(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });

  try {
    const { windows } = req.body;
    if (!Array.isArray(windows)) return res.status(400).json({ error: 'windows array required' });
    if (windows.length > 14) return res.status(400).json({ error: 'Maximum 14 availability windows' });

    // Validate each window
    const timeRe = /^([01]\d|2[0-3]):(00|30)$/;
    for (const w of windows) {
      if (typeof w.day_of_week !== 'number' || w.day_of_week < 0 || w.day_of_week > 6)
        return res.status(400).json({ error: 'day_of_week must be 0-6' });
      if (!timeRe.test(w.start_time) || !timeRe.test(w.end_time))
        return res.status(400).json({ error: 'Times must be HH:00 or HH:30 format' });
      if (w.start_time >= w.end_time)
        return res.status(400).json({ error: 'end_time must be after start_time' });
    }

    const sql = neon(process.env.POSTGRES_URL);

    // Delete all existing and re-insert
    await sql`DELETE FROM learner_availability WHERE learner_id = ${user.id}`;

    for (const w of windows) {
      await sql`
        INSERT INTO learner_availability (learner_id, day_of_week, start_time, end_time)
        VALUES (${user.id}, ${w.day_of_week}, ${w.start_time}, ${w.end_time})`;
    }

    return res.json({ success: true, count: windows.length });
  } catch (err) {
    console.error('set-availability error:', err);
    reportError('/api/learner', err);
    return res.status(500).json({ error: 'Failed to save availability' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// GDPR: DATA EXPORT (Article 20 — Right to Portability)
// ══════════════════════════════════════════════════════════════════════════════
// ── Accept Terms & Conditions ────────────────────────────────────────────────
async function handleAcceptTerms(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const schoolId = user.school_id || 1;
    await sql`UPDATE learner_users SET terms_accepted_at = NOW() WHERE id = ${user.id} AND school_id = ${schoolId}`;
    return res.json({ ok: true, terms_accepted: true });
  } catch (err) {
    console.error('accept-terms error:', err);
    reportError('/api/learner', err);
    return res.status(500).json({ error: 'Failed to accept terms' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// REFERRAL SYSTEM
// ══════════════════════════════════════════════════════════════════════════════

function generateReferralCode(learnerName) {
  const firstName = (learnerName || 'FRIEND').split(/\s+/)[0].toUpperCase().replace(/[^A-Z]/g, '') || 'FRIEND';
  const suffix = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `${firstName}-${suffix}`;
}

// GET /api/learner?action=validate-referral&code=X&school_id=Y — public, no auth, validates a referral code
async function handleValidateReferral(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const code = (req.query.code || '').trim().toUpperCase();
  if (!code) return res.json({ ok: true, valid: false });

  const schoolId = parseInt(req.query.school_id) || 1;

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Rate limit: 10 validations per IP per minute (prevents code enumeration)
    const { getClientIp } = require('./_rate-limit');
    const ip = getClientIp(req);
    const rl = await checkRateLimit(sql, {
      key: `validate_referral:${ip}`,
      max: 10,
      windowSeconds: 60,
    });
    if (!rl.allowed) {
      return res.status(429).json({ error: 'Too many requests. Please try again shortly.' });
    }

    const [ref] = await sql`
      SELECT r.learner_id, lu.name AS referrer_name
      FROM referrals r
      JOIN learner_users lu ON lu.id = r.learner_id
      WHERE r.code = ${code} AND r.school_id = ${schoolId}`;

    if (!ref) return res.json({ ok: true, valid: false });

    // Only return first name for privacy
    const firstName = (ref.referrer_name || '').split(/\s+/)[0] || null;
    return res.json({ ok: true, valid: true, referrer_first_name: firstName });
  } catch (err) {
    console.error('validate-referral error:', err);
    reportError('/api/learner', err);
    return res.status(500).json({ error: 'Failed to validate referral code' });
  }
}

// GET /api/learner?action=referral-code — returns the learner's referral code (auto-creates if needed)
async function handleReferralCode(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = user.school_id || 1;

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Check if school has referrals enabled
    const [school] = await sql`SELECT config FROM schools WHERE id = ${schoolId}`;
    const config = school?.config || {};
    if (!config.referral_enabled) {
      return res.json({ ok: true, enabled: false });
    }

    // Look up existing code
    const [existing] = await sql`SELECT code FROM referrals WHERE learner_id = ${user.id} AND school_id = ${schoolId}`;
    if (existing) {
      const baseUrl = process.env.BASE_URL || 'https://coachcarter.uk';
      return res.json({ ok: true, enabled: true, code: existing.code, share_url: `${baseUrl}/r/${existing.code}` });
    }

    // Generate a new code with collision retry
    const [learner] = await sql`SELECT name FROM learner_users WHERE id = ${user.id}`;
    let code;
    for (let attempt = 0; attempt < 3; attempt++) {
      code = generateReferralCode(learner?.name);
      try {
        await sql`INSERT INTO referrals (learner_id, school_id, code) VALUES (${user.id}, ${schoolId}, ${code})`;
        break; // success
      } catch (e) {
        if (attempt === 2) throw e; // final attempt failed
        // likely unique violation — retry with different suffix
      }
    }

    const baseUrl = process.env.BASE_URL || 'https://coachcarter.uk';
    return res.json({ ok: true, enabled: true, code, share_url: `${baseUrl}/r/${code}` });
  } catch (err) {
    console.error('referral-code error:', err);
    reportError('/api/learner', err);
    return res.status(500).json({ error: 'Failed to get referral code' });
  }
}

// GET /api/learner?action=referral-stats — referral dashboard data
async function handleReferralStats(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = user.school_id || 1;

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const [countRow] = await sql`
      SELECT COUNT(*)::int AS total FROM learner_users WHERE referred_by = ${user.id} AND school_id = ${schoolId}`;

    const [rewardRow] = await sql`
      SELECT COALESCE(SUM(minutes), 0)::int AS total FROM credit_transactions
      WHERE learner_id = ${user.id} AND type = 'referral_reward' AND school_id = ${schoolId}`;

    // Per-referee status timeline. Three states:
    //   'joined'    — signed up, no booking yet
    //   'booked'    — has at least one upcoming/confirmed booking
    //   'lessoned'  — has at least one completed paid lesson (the trigger
    //                 for actual reward issuance)
    // Free-trial bookings count toward 'booked' but not 'lessoned' since they
    // do not generate a referral reward.
    const recentReferrals = await sql`
      SELECT
        lu.name,
        lu.created_at,
        EXISTS (
          SELECT 1 FROM lesson_bookings b
           WHERE b.learner_id = lu.id
             AND b.status = ${CHARGEABLE}
             AND b.payment_method <> 'free'
        ) AS has_completed_paid,
        EXISTS (
          SELECT 1 FROM lesson_bookings b
           WHERE b.learner_id = lu.id
             AND b.status IN (${SCHEDULED}, ${CHARGEABLE}, ${REFUNDED})
        ) AS has_any_booking
      FROM learner_users lu
      WHERE lu.referred_by = ${user.id} AND lu.school_id = ${schoolId}
      ORDER BY lu.created_at DESC LIMIT 10`;

    const enriched = recentReferrals.map(r => ({
      name: r.name,
      created_at: r.created_at,
      status: r.has_completed_paid ? 'lessoned'
            : r.has_any_booking    ? 'booked'
            : 'joined'
    }));

    return res.json({
      ok: true,
      total_referred: countRow?.total || 0,
      total_reward_minutes: rewardRow?.total || 0,
      recent_referrals: enriched
    });
  } catch (err) {
    console.error('referral-stats error:', err);
    reportError('/api/learner', err);
    return res.status(500).json({ error: 'Failed to load referral stats' });
  }
}

async function handleSubmitFeedback(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = user.school_id || 1;

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const type = String(req.body?.type || '').trim().toLowerCase();
    const title = String(req.body?.title || '').trim();
    const message = String(req.body?.message || '').trim();
    const pageUrl = String(req.body?.page_url || '').trim();

    if (!['issue', 'suggestion'].includes(type)) {
      return res.status(400).json({ error: 'Choose issue or suggestion.' });
    }
    if (!title || title.length > 120) {
      return res.status(400).json({ error: 'Add a title up to 120 characters.' });
    }
    if (!message || message.length > 2000) {
      return res.status(400).json({ error: 'Add details up to 2000 characters.' });
    }

    const rl = await checkRateLimit(sql, {
      key: `learner_feedback:${user.id}`,
      max: 5,
      windowSeconds: 3600,
    });
    if (!rl.allowed) {
      return res.status(429).json({ error: 'Too many feedback submissions. Please try again later.' });
    }

    const [learner] = await sql`
      SELECT id, name, email, phone
      FROM learner_users
      WHERE id = ${user.id} AND school_id = ${schoolId}`;
    if (!learner) return res.status(404).json({ error: 'Learner account not found.' });

    const cleanPageUrl = pageUrl ? pageUrl.slice(0, 500) : null;
    const userAgent = String(req.headers['user-agent'] || '').slice(0, 500) || null;
    const [feedback] = await sql`
      INSERT INTO learner_feedback (school_id, learner_id, type, title, message, page_url, user_agent)
      VALUES (${schoolId}, ${user.id}, ${type}, ${title}, ${message}, ${cleanPageUrl}, ${userAgent})
      RETURNING id, type, title, status, created_at`;

    let alertSent = false;
    if (type === 'issue') {
      try {
        const { createTransporter } = require('./_auth-helpers');
        const mailer = createTransporter();
        const toEmail = process.env.STAFF_EMAIL || 'fraser@coachcarter.uk';
        const learnerLabel = learner.name || learner.email || learner.phone || `Learner #${learner.id}`;
        await mailer.sendMail({
          _log: {
            purpose: 'learner.feedback_issue',
            learnerId: learner.id,
            schoolId,
          },
          from: 'CoachCarter <system@coachcarter.uk>',
          to: toEmail,
          subject: `Learner issue: ${title.slice(0, 80)}`,
          text: [
            `Issue #${feedback.id}: ${title}`,
            `Learner: ${learnerLabel}`,
            learner.email ? `Email: ${learner.email}` : null,
            learner.phone ? `Phone: ${learner.phone}` : null,
            cleanPageUrl ? `Page: ${cleanPageUrl}` : null,
            '',
            message
          ].filter(Boolean).join('\n'),
          html: `
            <h2>Learner issue: ${escapeEmailHtml(title)}</h2>
            <p><strong>Learner:</strong> ${escapeEmailHtml(learnerLabel)}</p>
            ${learner.email ? `<p><strong>Email:</strong> ${escapeEmailHtml(learner.email)}</p>` : ''}
            ${learner.phone ? `<p><strong>Phone:</strong> ${escapeEmailHtml(learner.phone)}</p>` : ''}
            ${cleanPageUrl ? `<p><strong>Page:</strong> ${escapeEmailHtml(cleanPageUrl)}</p>` : ''}
            <p><strong>Details:</strong></p>
            <p style="white-space:pre-wrap">${escapeEmailHtml(message)}</p>
          `
        });
        alertSent = true;
      } catch (mailErr) {
        console.warn('learner feedback issue email failed:', mailErr.message);
      }
    }

    return res.json({ ok: true, feedback, alert_sent: alertSent });
  } catch (err) {
    console.error('submit-feedback error:', err);
    reportError('/api/learner', err);
    return res.status(500).json({ error: 'Failed to send feedback' });
  }
}

async function handleExportData(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = user.school_id || 1;

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Rate limit: max 3 exports per learner per hour. GDPR portability
    // exports iterate 10+ tables and serialise them to JSON — legitimate
    // users export once at most; 3/hr blocks scraping loops.
    const rl = await checkRateLimit(sql, {
      key: `learner_export:${user.id}`,
      max: 3,
      windowSeconds: 3600,
    });
    if (!rl.allowed) {
      return res.status(429).json({ error: 'Too many export requests. Please try again later.' });
    }

    const [profile] = await sql`
      SELECT name, email, phone, pickup_address, learner_category, primary_instructor_id,
             test_date, test_time, prefer_contact_before, terms_accepted_at, created_at, last_activity_at
      FROM learner_users WHERE id = ${user.id} AND school_id = ${schoolId}`;

    const onboarding = await sql`
      SELECT prior_hours_pro, prior_hours_private, previous_tests, transmission, test_date, main_concerns, created_at
      FROM learner_onboarding WHERE learner_id = ${user.id}`;

    const bookings = await sql`
      SELECT lb.scheduled_date, lb.start_time, lb.end_time, lb.pickup_address, lb.status, lb.created_at,
             lb.guest_phone, i.name AS instructor_name, lt.name AS lesson_type
      FROM lesson_bookings lb
        LEFT JOIN instructors i ON lb.instructor_id = i.id
        LEFT JOIN lesson_types lt ON lb.lesson_type_id = lt.id
      WHERE lb.learner_id = ${user.id} AND lb.school_id = ${schoolId}
      ORDER BY lb.scheduled_date DESC`;

    const transactions = await sql`
      SELECT type, credits, minutes, amount_pence, payment_method, created_at
      FROM credit_transactions WHERE learner_id = ${user.id} AND school_id = ${schoolId}
      ORDER BY created_at DESC`;

    const sessions = await sql`
      SELECT session_date, duration_minutes, session_type, notes, created_at
      FROM driving_sessions WHERE user_id = ${user.id} AND school_id = ${schoolId}
      ORDER BY session_date DESC`;

    const skills = await sql`
      SELECT skill_key, rating, note, driving_faults, serious_faults, dangerous_faults, created_at
      FROM skill_ratings WHERE user_id = ${user.id} AND school_id = ${schoolId}
      ORDER BY created_at DESC`;

    const quizzes = await sql`
      SELECT question_id, learner_answer, correct_answer, correct, answered_at
      FROM quiz_results WHERE learner_id = ${user.id} AND school_id = ${schoolId}
      ORDER BY answered_at DESC`;

    const mockTests = await sql`
      SELECT id, started_at, completed_at, total_driving_faults, total_serious_faults, total_dangerous_faults, result, mode, notes
      FROM mock_tests WHERE learner_id = ${user.id} AND school_id = ${schoolId}
      ORDER BY started_at DESC`;

    const focusedPractice = await sql`
      SELECT fp.id, fp.focus_areas, fp.suggested_areas, fp.reflections, fp.completed_at, fp.created_at,
             ds.session_date, ds.duration_minutes
      FROM focused_practice_sessions fp
      JOIN driving_sessions ds ON ds.id = fp.session_id
      WHERE fp.learner_id = ${user.id} AND fp.school_id = ${schoolId}
      ORDER BY fp.created_at DESC`;

    const referralCode = await sql`
      SELECT code, created_at FROM referrals
      WHERE learner_id = ${user.id} AND school_id = ${schoolId}`;

    const referralsMade = await sql`
      SELECT lu.name, lu.created_at AS referred_at
      FROM learner_users lu
      WHERE lu.referred_by = ${user.id} AND lu.school_id = ${schoolId}
      ORDER BY lu.created_at DESC`;

    // ── GDPR Article 15: data subject access. Below tables were added in PR-L
    // (audit #17). Mostly small per-learner row counts; the email-keyed SELECTs
    // (cookie_consents, lesson_offers) need OR-with-learner_id because
    // historical rows may pre-date the learner_id population.

    const availability = await sql`
      SELECT day_of_week, start_time::text, end_time::text, active, created_at
      FROM learner_availability
      WHERE learner_id = ${user.id}
      ORDER BY day_of_week, start_time`;

    const mockTestFaults = await sql`
      SELECT mtf.mock_test_id, mtf.part, mtf.skill_key, mtf.sub_key,
             mtf.driving_faults, mtf.serious_faults, mtf.dangerous_faults
      FROM mock_test_faults mtf
      JOIN mock_tests mt ON mt.id = mtf.mock_test_id
      WHERE mt.learner_id = ${user.id} AND mt.school_id = ${schoolId}
      ORDER BY mtf.mock_test_id, mtf.part, mtf.skill_key`;

    // instructor_learner_notes: notes instructors keep about this learner
    // (test date, learner category, free-text notes). Article 15 access right
    // to data held about the data subject. Includes the instructor name so the
    // learner knows who wrote it.
    const instructorNotes = await sql`
      SELECT i.name AS instructor_name, iln.notes, iln.test_date::text,
             iln.learner_category, iln.updated_at
      FROM instructor_learner_notes iln
      JOIN instructors i ON i.id = iln.instructor_id
      WHERE iln.learner_id = ${user.id}
      ORDER BY iln.updated_at DESC`;

    const cookieConsents = await sql`
      SELECT analytics, consented_at, user_agent
      FROM cookie_consents
      WHERE (learner_id = ${user.id} OR visitor_id = ${user.id}::text)
        AND school_id = ${schoolId}
      ORDER BY consented_at DESC`;

    const deletionRequests = await sql`
      SELECT status, requested_at, confirmed_at, completed_at
      FROM deletion_requests
      WHERE learner_id = ${user.id} AND school_id = ${schoolId}
      ORDER BY requested_at DESC`;

    // lesson_confirmations: rows where THIS learner submitted the confirmation
    // (not the instructor's parallel row). Joined to bookings to scope.
    const lessonConfirmations = await sql`
      SELECT lc.booking_id, lc.lesson_happened, lc.late_party, lc.late_minutes,
             lc.notes, lc.auto_confirmed, lc.created_at,
             lb.scheduled_date::text, lb.start_time::text
      FROM lesson_confirmations lc
      JOIN lesson_bookings lb ON lb.id = lc.booking_id
      WHERE lc.confirmed_by_role = 'learner'
        AND lb.learner_id = ${user.id}
        AND lb.school_id = ${schoolId}
      ORDER BY lc.created_at DESC`;

    // ── Per-instructor credits (Step 2c) ─────────────────────────────────────
    // GDPR Article 15: data subject access. These tables ship as schema-only in
    // Step 2c; Phase 2A (Step 4) starts populating them. Until Step 4, the
    // first two queries return empty arrays for everyone except the LCB
    // backfill rows for Fraser. credit_source_adjustments is only written by
    // future admin cash-refund flows (Step 5.5+), so it's also typically empty.
    const creditBalances = await sql`
      SELECT lcb.instructor_id, i.name AS instructor_name,
             lcb.balance_minutes, lcb.updated_at
        FROM learner_credit_balances lcb
        JOIN instructors i ON i.id = lcb.instructor_id
       WHERE lcb.learner_id = ${user.id} AND lcb.school_id = ${schoolId}
       ORDER BY lcb.updated_at DESC`;

    const bookingCreditSources = await sql`
      SELECT bcs.booking_id, bcs.credit_transaction_id, bcs.minutes_drawn,
             bcs.rate_pence_per_minute, bcs.contribution_pence,
             bcs.stripe_fee_pence, bcs.absorbed_by, bcs.refunded_at, bcs.created_at,
             lb.scheduled_date::text, lb.start_time::text
        FROM booking_credit_sources bcs
        JOIN lesson_bookings lb ON lb.id = bcs.booking_id
       WHERE lb.learner_id = ${user.id} AND lb.school_id = ${schoolId}
       ORDER BY bcs.created_at DESC`;

    const creditAdjustments = await sql`
      SELECT csa.credit_transaction_id, csa.kind, csa.minutes_adjusted,
             csa.pence_adjusted, csa.reason, csa.stripe_refund_id, csa.created_at
        FROM credit_source_adjustments csa
        JOIN credit_transactions ct ON ct.id = csa.credit_transaction_id
       WHERE ct.learner_id = ${user.id} AND ct.school_id = ${schoolId}
       ORDER BY csa.created_at DESC`;

    const hasRefundLedger = await refundLedgerTablesExist(sql);
    const refundEvents = hasRefundLedger
      ? await sql`
          SELECT refund_type, status, gross_refund_pence,
                 processing_fee_withheld_pence, net_refund_pence,
                 reason, metadata, created_at
            FROM refund_events
           WHERE learner_id = ${user.id} AND school_id = ${schoolId}
           ORDER BY created_at DESC`
      : null;

    const hasLearnerBroadcasts = await learnerBroadcastTablesExist(sql);
    const broadcastsReceived = hasLearnerBroadcasts
      ? await sql`
          SELECT lb.label, lb.message_body, lb.selected_categories,
                 lbr.phone, lbr.learner_category, lbr.status,
                 lbr.skip_reason, lbr.error_message, lbr.sent_at, lbr.created_at
            FROM learner_broadcast_recipients lbr
            JOIN learner_broadcasts lb
              ON lb.id = lbr.broadcast_id
             AND lb.school_id = ${schoolId}
           WHERE lbr.learner_id = ${user.id}
             AND lbr.school_id = ${schoolId}
           ORDER BY lbr.created_at DESC`
      : null;

    // Offers sent to this learner (by learner_id once they signed up, or by
    // email before signup). Exclude the token itself — it's an active secret.
    const learnerEmail = profile?.email || null;
    const offersReceived = learnerEmail
      ? await sql`
          SELECT lo.scheduled_date::text, lo.start_time::text, lo.end_time::text,
                 lo.discount_pct, lo.status, lo.kind, lo.trigger,
                 lo.created_at, lo.expires_at,
                 i.name AS instructor_name
          FROM lesson_offers lo
          JOIN instructors i ON i.id = lo.instructor_id
          WHERE (lo.learner_id = ${user.id} OR LOWER(lo.learner_email) = LOWER(${learnerEmail}))
          ORDER BY lo.created_at DESC`
      : await sql`
          SELECT lo.scheduled_date::text, lo.start_time::text, lo.end_time::text,
                 lo.discount_pct, lo.status, lo.kind, lo.trigger,
                 lo.created_at, lo.expires_at,
                 i.name AS instructor_name
          FROM lesson_offers lo
          JOIN instructors i ON i.id = lo.instructor_id
          WHERE lo.learner_id = ${user.id}
          ORDER BY lo.created_at DESC`;

    const feedbackSubmitted = await sql`
      SELECT type, title, message, page_url, status, reviewed_at, created_at
      FROM learner_feedback
      WHERE learner_id = ${user.id} AND school_id = ${schoolId}
      ORDER BY created_at DESC`;

    const exportData = {
      _metadata: {
        exported_at: new Date().toISOString(),
        format: 'json',
        data_categories: [
          'profile', 'onboarding', 'bookings', 'transactions',
          'driving_sessions', 'skill_ratings', 'quiz_results',
          'mock_tests', 'mock_test_faults', 'focused_practice',
          'referral_code', 'referrals_made',
          'availability', 'instructor_notes_about_me',
          'cookie_consents', 'deletion_requests',
          'lesson_confirmations', 'offers_received',
          'feedback_submitted',
          'credit_balances', 'booking_credit_sources', 'credit_adjustments',
          ...(hasRefundLedger ? ['refund_events'] : []),
          ...(hasLearnerBroadcasts ? ['broadcasts_received'] : [])
        ]
      },
      profile: profile || {},
      onboarding: onboarding[0] || null,
      bookings,
      transactions,
      driving_sessions: sessions,
      skill_ratings: skills,
      quiz_results: quizzes,
      mock_tests: mockTests,
      mock_test_faults: mockTestFaults,
      focused_practice: focusedPractice,
      referral_code: referralCode[0] || null,
      referrals_made: referralsMade,
      availability,
      instructor_notes_about_me: instructorNotes,
      cookie_consents: cookieConsents,
      deletion_requests: deletionRequests,
      lesson_confirmations: lessonConfirmations,
      offers_received: offersReceived,
      feedback_submitted: feedbackSubmitted,
      credit_balances: creditBalances,
      booking_credit_sources: bookingCreditSources,
      credit_adjustments: creditAdjustments,
      ...(hasRefundLedger ? { refund_events: refundEvents } : {}),
      ...(hasLearnerBroadcasts ? { broadcasts_received: broadcastsReceived } : {}),
    };

    const dateStr = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="coachcarter-data-export-${dateStr}.json"`);
    return res.json(exportData);
  } catch (err) {
    console.error('export-data error:', err);
    reportError('/api/learner', err);
    return res.status(500).json({ error: 'Failed to export data' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// GDPR: REQUEST ACCOUNT DELETION (Article 17 — Right to Erasure)
// ══════════════════════════════════════════════════════════════════════════════
async function handleRequestDeletion(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = user.school_id || 1;

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const { generateToken } = require('./_auth-helpers');
    const { createTransporter } = require('./_auth-helpers');

    // Rate limit: max 3 deletion requests per learner per hour. Each request
    // sends an email — prevents mailbox spam via a compromised token.
    const rl = await checkRateLimit(sql, {
      key: `learner_deletion:${user.id}`,
      max: 3,
      windowSeconds: 3600,
    });
    if (!rl.allowed) {
      return res.status(429).json({ error: 'Too many deletion requests. Please try again later.' });
    }

    const [learner] = await sql`SELECT id, name, email FROM learner_users WHERE id = ${user.id} AND school_id = ${schoolId}`;
    if (!learner || !learner.email) return res.status(400).json({ error: 'Account not found or no email on file' });

    // Cancel any pending deletion requests
    await sql`UPDATE deletion_requests SET status = 'cancelled' WHERE learner_id = ${user.id} AND status = 'pending'`;

    const token = generateToken();
    await sql`INSERT INTO deletion_requests (learner_id, token, school_id) VALUES (${user.id}, ${token}, ${schoolId})`;

    const baseUrl = process.env.BASE_URL || 'https://coachcarter.uk';
    const confirmUrl = `${baseUrl}/learner/confirm-deletion.html?token=${token}`;
    const firstName = (learner.name || '').split(' ')[0] || 'there';

    const mailer = createTransporter();
    await mailer.sendMail({
      _log: {
        purpose: 'gdpr.deletion_request',
        learnerId: learner.id,
        schoolId,
      },
      from: 'CoachCarter <system@coachcarter.uk>',
      to: learner.email,
      subject: 'Confirm account deletion — CoachCarter',
      html: `
        <h2>Hi ${firstName},</h2>
        <p>We received a request to permanently delete your CoachCarter account and all associated data.</p>
        <p><strong>This action cannot be undone.</strong> Your bookings, progress, quiz results, and all personal data will be permanently removed.</p>
        <p style="margin:28px 0">
          <a href="${confirmUrl}"
             style="background:#ef4444;color:white;padding:14px 28px;text-decoration:none;
                    border-radius:8px;display:inline-block;font-weight:bold;font-size:1rem;">
            Confirm Deletion
          </a>
        </p>
        <p style="color:#888;font-size:0.85em">This link expires in 24 hours. If you didn't request this, you can safely ignore this email.</p>
      `
    });

    return res.json({ ok: true, message: 'Check your email to confirm deletion' });
  } catch (err) {
    console.error('request-deletion error:', err);
    reportError('/api/learner', err);
    return res.status(500).json({ error: 'Failed to process deletion request' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// GDPR: CONFIRM ACCOUNT DELETION
// ══════════════════════════════════════════════════════════════════════════════
async function handleConfirmDeletion(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const [request] = await sql`
      SELECT id, learner_id, school_id, requested_at
      FROM deletion_requests
      WHERE token = ${token} AND status = 'pending'`;

    if (!request) return res.status(400).json({ error: 'Invalid or expired deletion token' });

    // Check 24hr expiry
    const requestedAt = new Date(request.requested_at);
    if (Date.now() - requestedAt.getTime() > 24 * 60 * 60 * 1000) {
      await sql`UPDATE deletion_requests SET status = 'cancelled' WHERE id = ${request.id}`;
      return res.status(400).json({ error: 'Deletion link has expired. Please request a new one.' });
    }

    const learnerId = request.learner_id;
    const schoolId = request.school_id;

    // Get learner email for confirmation
    const [learner] = await sql`SELECT name, email FROM learner_users WHERE id = ${learnerId}`;

    // Run the unified GDPR cascade (anonymises financial records, hard-deletes
    // the rest, wraps in a Neon transaction). See api/_gdpr.js for the full
    // table list and rationale. The deletion_requests row for this learner is
    // deleted inside the cascade — the audit trail for the self-delete lives
    // in the audit_log row written below.
    await deleteLearnerCascade(sql, learnerId, { email: learner?.email });

    // Audit-log the self-delete. Compensates for the deletion_requests row
    // being cleared inside the cascade — without this, there would be no
    // record that the learner ever existed.
    try {
      const { logAudit } = require('./_audit');
      await logAudit(sql, {
        adminId: null,
        adminEmail: 'self-service',
        action: 'learner.self_delete',
        targetType: 'learner',
        targetId: learnerId,
        details: { name: learner?.name || null, email: learner?.email || null },
        schoolId,
        req,
      });
    } catch (e) { console.warn('audit log for self-delete failed:', e.message); }

    // 6. Send confirmation email
    if (learner?.email) {
      try {
        const { createTransporter } = require('./_auth-helpers');
        const mailer = createTransporter();
        await mailer.sendMail({
          _log: {
            // Note: no learnerId — the learner has just been hard-deleted at
            // this point, so the FK would fail. School context only.
            purpose: 'gdpr.deletion_confirmation',
            schoolId,
          },
          from: 'CoachCarter <system@coachcarter.uk>',
          to: learner.email,
          subject: 'Account deleted — CoachCarter',
          html: `
            <h2>Your account has been deleted</h2>
            <p>Your CoachCarter account and all associated personal data have been permanently removed.</p>
            <p>Payment transaction records have been anonymized and retained for legal compliance (tax regulations).</p>
            <p style="color:#888;font-size:0.85em">If you believe this was done in error, please contact us at info@coachcarter.uk</p>
          `
        });
      } catch (e) { console.warn('deletion confirmation email failed:', e.message); }
    }

    return res.json({ ok: true, message: 'Account and all personal data have been permanently deleted' });
  } catch (err) {
    console.error('confirm-deletion error:', err);
    reportError('/api/learner', err);
    return res.status(500).json({ error: 'Failed to complete deletion' });
  }
}
