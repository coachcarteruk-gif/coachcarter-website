// Instructor portal API
//
// Routes:
//   POST /api/instructor?action=request-login
//     → sends a magic link to the instructor's email
//
//   GET  /api/instructor?action=validate-token&token=X
//     → lightweight token check (does NOT consume it — safe from email prefetchers)
//
//   POST /api/instructor?action=verify-token
//     → consumes the token and returns a JWT (body: { token })
//
//   GET  /api/instructor?action=schedule        (JWT auth required)
//     → returns the instructor's upcoming + recent bookings
//
//   POST /api/instructor?action=complete        (JWT auth required)
//     → marks a booking as completed
//
//   GET  /api/instructor?action=availability    (JWT auth required)
//     → returns the instructor's current availability windows
//
//   POST /api/instructor?action=set-availability (JWT auth required)
//     → replaces the instructor's availability windows
//
//   GET  /api/instructor?action=profile         (JWT auth required)
//     → returns the instructor's profile
//
//   POST /api/instructor?action=update-profile  (JWT auth required)
//     → updates name, phone, bio, photo_url

const { neon }   = require('@neondatabase/serverless');
const jwt        = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const crypto     = require('crypto');

const TOKEN_EXPIRY_MINUTES = 30;
const JWT_EXPIRY           = '7d';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

function verifyInstructorAuth(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  try {
    const payload = jwt.verify(auth.slice(7), secret);
    if (payload.role !== 'instructor') return null;
    return payload;
  } catch { return null; }
}

function createTransporter() {
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   parseInt(process.env.SMTP_PORT),
    secure: process.env.SMTP_PORT === '465',
    auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const action = req.query.action;
  if (action === 'request-login')    return handleRequestLogin(req, res);
  if (action === 'validate-token')   return handleValidateToken(req, res);
  if (action === 'verify-token')     return handleVerifyToken(req, res);
  if (action === 'schedule')         return handleSchedule(req, res);
  if (action === 'schedule-range')   return handleScheduleRange(req, res);
  if (action === 'complete')         return handleComplete(req, res);
  if (action === 'availability')     return handleAvailability(req, res);
  if (action === 'set-availability') return handleSetAvailability(req, res);
  if (action === 'profile')          return handleProfile(req, res);
  if (action === 'update-profile')   return handleUpdateProfile(req, res);
  if (action === 'blackout-dates')     return handleBlackoutDates(req, res);
  if (action === 'set-blackout-dates') return handleSetBlackoutDates(req, res);

  return res.status(400).json({ error: 'Unknown action' });
};

// ── POST /api/instructor?action=request-login ─────────────────────────────────
// Body: { email }
// Sends a magic link to the instructor's email address.
async function handleRequestLogin(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Ensure the token table exists
    await sql`
      CREATE TABLE IF NOT EXISTS instructor_login_tokens (
        id            SERIAL PRIMARY KEY,
        instructor_id INTEGER NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
        token         TEXT    NOT NULL UNIQUE,
        expires_at    TIMESTAMPTZ NOT NULL,
        used          BOOLEAN NOT NULL DEFAULT FALSE,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;

    // Look up instructor by email
    const [instructor] = await sql`
      SELECT id, name, email FROM instructors
      WHERE LOWER(email) = LOWER(${email.trim()}) AND active = TRUE
    `;

    // Always return success — don't reveal whether email exists
    if (!instructor) {
      return res.json({ success: true });
    }

    // Generate a secure random token
    const token     = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MINUTES * 60 * 1000);

    // Invalidate any existing unused tokens for this instructor
    await sql`
      UPDATE instructor_login_tokens
      SET used = TRUE
      WHERE instructor_id = ${instructor.id} AND used = FALSE
    `;

    // Store the new token
    await sql`
      INSERT INTO instructor_login_tokens (instructor_id, token, expires_at)
      VALUES (${instructor.id}, ${token}, ${expiresAt.toISOString()})
    `;

    // Send the magic link email
    const magicLink = `https://coachcarter.uk/instructor/login.html?token=${token}`;
    const mailer    = createTransporter();
    const firstName = instructor.name.split(' ')[0] || 'there';

    await mailer.sendMail({
      from:    'CoachCarter <system@coachcarter.uk>',
      to:      instructor.email,
      subject: 'Your CoachCarter instructor portal sign-in link',
      html: `
        <h2>Hi ${firstName},</h2>
        <p>Click the button below to sign in to your CoachCarter instructor portal.
           This link expires in ${TOKEN_EXPIRY_MINUTES} minutes.</p>
        <p style="margin:28px 0">
          <a href="${magicLink}"
             style="background:#f58321;color:white;padding:14px 28px;text-decoration:none;
                    border-radius:8px;display:inline-block;font-weight:bold;font-size:1rem;">
            Sign in to portal →
          </a>
        </p>
        <p style="color:#888;font-size:0.85rem;">
          If you didn't request this, you can safely ignore this email.
          The link will expire automatically.
        </p>
      `
    });

    return res.json({ success: true });

  } catch (err) {
    console.error('instructor request-login error:', err);
    return res.status(500).json({ error: 'Failed to send login link' });
  }
}

// ── GET /api/instructor?action=validate-token&token=X ─────────────────────────
// Lightweight check — does NOT consume the token.
// Prevents email-client link prefetchers from burning tokens.
async function handleValidateToken(req, res) {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token is required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const [row] = await sql`
      SELECT t.id, t.expires_at, t.used
      FROM instructor_login_tokens t
      WHERE t.token = ${token}
    `;

    if (!row)                                  return res.status(401).json({ error: 'Invalid login link' });
    if (row.used)                              return res.status(401).json({ error: 'This login link has already been used' });
    if (new Date(row.expires_at) < new Date()) return res.status(401).json({ error: 'This login link has expired. Please request a new one.' });

    return res.json({ valid: true });
  } catch (err) {
    console.error('instructor validate-token error:', err);
    return res.status(500).json({ error: 'Validation failed' });
  }
}

// ── POST /api/instructor?action=verify-token ──────────────────────────────────
// Consumes the token and returns a JWT. POST-only to prevent email prefetchers.
// Body: { token }
async function handleVerifyToken(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = req.body?.token;
  if (!token) return res.status(400).json({ error: 'Token is required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const [row] = await sql`
      SELECT t.id AS token_id, t.expires_at, t.used,
             i.id AS instructor_id, i.name, i.email, i.photo_url
      FROM instructor_login_tokens t
      JOIN instructors i ON i.id = t.instructor_id
      WHERE t.token = ${token}
    `;

    if (!row)                                  return res.status(401).json({ error: 'Invalid login link' });
    if (row.used)                              return res.status(401).json({ error: 'This login link has already been used' });
    if (new Date(row.expires_at) < new Date()) return res.status(401).json({ error: 'This login link has expired. Please request a new one.' });

    // Mark token as used
    await sql`
      UPDATE instructor_login_tokens SET used = TRUE WHERE id = ${row.token_id}
    `;

    // Issue a JWT
    const secret   = process.env.JWT_SECRET;
    const jwtToken = jwt.sign(
      { id: row.instructor_id, email: row.email, role: 'instructor' },
      secret,
      { expiresIn: JWT_EXPIRY }
    );

    return res.json({
      token: jwtToken,
      instructor: { id: row.instructor_id, name: row.name, email: row.email, photo_url: row.photo_url }
    });

  } catch (err) {
    console.error('instructor verify-token error:', err);
    return res.status(500).json({ error: 'Verification failed' });
  }
}

// ── GET /api/instructor?action=schedule ──────────────────────────────────────
// Returns the instructor's upcoming + recent past bookings.
async function handleSchedule(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const instructor = verifyInstructorAuth(req);
  if (!instructor) return res.status(401).json({ error: 'Unauthorised' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const bookings = await sql`
      SELECT
        lb.id,
        lb.scheduled_date::text,
        lb.start_time::text,
        lb.end_time::text,
        lb.status,
        lb.notes,
        lu.id   AS learner_id,
        lu.name AS learner_name,
        lu.email AS learner_email,
        lu.phone AS learner_phone,
        COALESCE(lu.prefer_contact_before, false) AS prefer_contact_before,
        lu.pickup_address AS learner_pickup_address
      FROM lesson_bookings lb
      JOIN learner_users lu ON lu.id = lb.learner_id
      WHERE lb.instructor_id = ${instructor.id}
        AND lb.status IN ('confirmed', 'completed')
        AND lb.scheduled_date >= (CURRENT_DATE - INTERVAL '14 days')
      ORDER BY lb.scheduled_date ASC, lb.start_time ASC
      LIMIT 60
    `;

    const now      = new Date();
    const upcoming = [];
    const past     = [];

    for (const b of bookings) {
      const lessonTime = new Date(`${b.scheduled_date}T${b.start_time}Z`);
      if (b.status === 'confirmed' && lessonTime > now) {
        upcoming.push(b);
      } else {
        past.push(b);
      }
    }

    // Past sorted newest first
    past.sort((a, b) =>
      b.scheduled_date.localeCompare(a.scheduled_date) ||
      b.start_time.localeCompare(a.start_time)
    );

    return res.json({ upcoming, past });

  } catch (err) {
    console.error('instructor schedule error:', err);
    return res.status(500).json({ error: 'Failed to load schedule' });
  }
}

// ── GET /api/instructor?action=schedule-range ────────────────────────────────
// Returns bookings within a date range for the instructor's calendar view.
// Query params: from=YYYY-MM-DD&to=YYYY-MM-DD
async function handleScheduleRange(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const instructor = verifyInstructorAuth(req);
  if (!instructor) return res.status(401).json({ error: 'Unauthorised' });

  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: '"from" and "to" are required (YYYY-MM-DD)' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to))
    return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const bookings = await sql`
      SELECT
        lb.id,
        lb.scheduled_date::text,
        lb.start_time::text,
        lb.end_time::text,
        lb.status,
        lb.notes,
        lu.id    AS learner_id,
        lu.name  AS learner_name,
        lu.email AS learner_email,
        lu.phone AS learner_phone,
        COALESCE(lu.prefer_contact_before, false) AS prefer_contact_before,
        lu.pickup_address AS learner_pickup_address
      FROM lesson_bookings lb
      JOIN learner_users lu ON lu.id = lb.learner_id
      WHERE lb.instructor_id = ${instructor.id}
        AND lb.status IN ('confirmed', 'completed')
        AND lb.scheduled_date >= ${from}::date
        AND lb.scheduled_date <= ${to}::date
      ORDER BY lb.scheduled_date ASC, lb.start_time ASC
      LIMIT 500
    `;

    return res.json({ bookings });

  } catch (err) {
    console.error('instructor schedule-range error:', err);
    return res.status(500).json({ error: 'Failed to load schedule' });
  }
}

// ── POST /api/instructor?action=complete ──────────────────────────────────────
// Body: { booking_id }
// Marks a booking as completed.
async function handleComplete(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const instructor = verifyInstructorAuth(req);
  if (!instructor) return res.status(401).json({ error: 'Unauthorised' });

  const { booking_id } = req.body;
  if (!booking_id) return res.status(400).json({ error: 'booking_id required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Must belong to this instructor and be a past confirmed booking
    const [booking] = await sql`
      SELECT id, status, scheduled_date, start_time
      FROM lesson_bookings
      WHERE id = ${booking_id} AND instructor_id = ${instructor.id}
    `;

    if (!booking)
      return res.status(404).json({ error: 'Booking not found' });
    if (booking.status === 'completed')
      return res.status(400).json({ error: 'Booking is already marked as completed' });
    if (booking.status !== 'confirmed')
      return res.status(400).json({ error: `Cannot complete a booking with status "${booking.status}"` });

    // Only allow completing bookings that are in the past
    const lessonTime = new Date(`${booking.scheduled_date}T${booking.start_time}Z`);
    if (lessonTime > new Date())
      return res.status(400).json({ error: 'Cannot mark a future lesson as complete' });

    await sql`
      UPDATE lesson_bookings SET status = 'completed' WHERE id = ${booking_id}
    `;

    return res.json({ success: true });

  } catch (err) {
    console.error('instructor complete error:', err);
    return res.status(500).json({ error: 'Failed to mark booking as complete' });
  }
}

// ── GET /api/instructor?action=availability ───────────────────────────────────
// Returns the instructor's current weekly availability windows.
async function handleAvailability(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const instructor = verifyInstructorAuth(req);
  if (!instructor) return res.status(401).json({ error: 'Unauthorised' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const windows = await sql`
      SELECT id, day_of_week, start_time::text, end_time::text, active
      FROM instructor_availability
      WHERE instructor_id = ${instructor.id}
      ORDER BY day_of_week, start_time
    `;

    return res.json({ windows });

  } catch (err) {
    console.error('instructor availability error:', err);
    return res.status(500).json({ error: 'Failed to load availability' });
  }
}

// ── POST /api/instructor?action=set-availability ──────────────────────────────
// Body: { windows: [{ day_of_week, start_time, end_time }, ...] }
// Replaces all availability windows for this instructor.
async function handleSetAvailability(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const instructor = verifyInstructorAuth(req);
  if (!instructor) return res.status(401).json({ error: 'Unauthorised' });

  const { windows } = req.body;
  if (!Array.isArray(windows))
    return res.status(400).json({ error: 'windows must be an array' });

  // Validate each window
  for (const w of windows) {
    if (w.day_of_week < 0 || w.day_of_week > 6)
      return res.status(400).json({ error: `Invalid day_of_week: ${w.day_of_week}` });
    if (!/^\d{2}:\d{2}$/.test(w.start_time) || !/^\d{2}:\d{2}$/.test(w.end_time))
      return res.status(400).json({ error: 'Times must be HH:MM format' });
    if (w.start_time >= w.end_time)
      return res.status(400).json({ error: 'start_time must be before end_time' });
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Delete existing windows
    await sql`DELETE FROM instructor_availability WHERE instructor_id = ${instructor.id}`;

    // Insert new windows
    if (windows.length > 0) {
      for (const w of windows) {
        await sql`
          INSERT INTO instructor_availability (instructor_id, day_of_week, start_time, end_time)
          VALUES (${instructor.id}, ${w.day_of_week}, ${w.start_time}, ${w.end_time})
        `;
      }
    }

    const saved = await sql`
      SELECT id, day_of_week, start_time::text, end_time::text, active
      FROM instructor_availability
      WHERE instructor_id = ${instructor.id}
      ORDER BY day_of_week, start_time
    `;

    return res.json({ success: true, windows: saved });

  } catch (err) {
    console.error('instructor set-availability error:', err);
    return res.status(500).json({ error: 'Failed to save availability' });
  }
}

// ── GET /api/instructor?action=profile ────────────────────────────────────────
async function handleProfile(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const instructor = verifyInstructorAuth(req);
  if (!instructor) return res.status(401).json({ error: 'Unauthorised' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const [profile] = await sql`
      SELECT id, name, email, phone, bio, photo_url, active, created_at,
             COALESCE(buffer_minutes, 30) AS buffer_minutes
      FROM instructors WHERE id = ${instructor.id}
    `;

    if (!profile) return res.status(404).json({ error: 'Instructor not found' });

    return res.json({ instructor: profile });

  } catch (err) {
    console.error('instructor profile error:', err);
    return res.status(500).json({ error: 'Failed to load profile' });
  }
}

// ── POST /api/instructor?action=update-profile ────────────────────────────────
// Body: { name, phone, bio, photo_url, buffer_minutes }  (all optional)
// Note: email is not editable by the instructor — admin controls that.
async function handleUpdateProfile(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const instructor = verifyInstructorAuth(req);
  if (!instructor) return res.status(401).json({ error: 'Unauthorised' });

  const { name, phone, bio, photo_url, buffer_minutes } = req.body;

  // Validate buffer_minutes if provided
  if (buffer_minutes !== undefined && buffer_minutes !== null) {
    const buf = parseInt(buffer_minutes);
    if (isNaN(buf) || buf < 0 || buf > 120)
      return res.status(400).json({ error: 'Buffer time must be between 0 and 120 minutes' });
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const bufVal = (buffer_minutes !== undefined && buffer_minutes !== null)
      ? parseInt(buffer_minutes) : null;

    const [updated] = await sql`
      UPDATE instructors SET
        name           = COALESCE(NULLIF(${name      || ''}, ''), name),
        phone          = COALESCE(${phone     ?? null}, phone),
        bio            = COALESCE(${bio       ?? null}, bio),
        photo_url      = COALESCE(${photo_url ?? null}, photo_url),
        buffer_minutes = COALESCE(${bufVal}, buffer_minutes)
      WHERE id = ${instructor.id}
      RETURNING id, name, email, phone, bio, photo_url, COALESCE(buffer_minutes, 30) AS buffer_minutes
    `;

    return res.json({ success: true, instructor: updated });

  } catch (err) {
    console.error('instructor update-profile error:', err);
    return res.status(500).json({ error: 'Failed to update profile' });
  }
}

// ── GET /api/instructor?action=blackout-dates ─────────────────────────────────
// Returns the instructor's blackout dates (future only).
async function handleBlackoutDates(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const instructor = verifyInstructorAuth(req);
  if (!instructor) return res.status(401).json({ error: 'Unauthorised' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Ensure table exists (safe for first run before migration)
    await sql`CREATE TABLE IF NOT EXISTS instructor_blackout_dates (
      id SERIAL PRIMARY KEY,
      instructor_id INTEGER NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
      blackout_date DATE NOT NULL,
      reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_blackout_date UNIQUE (instructor_id, blackout_date)
    )`;

    const dates = await sql`
      SELECT id, blackout_date::text, reason
      FROM instructor_blackout_dates
      WHERE instructor_id = ${instructor.id}
        AND blackout_date >= CURRENT_DATE
      ORDER BY blackout_date ASC
    `;

    return res.json({ blackout_dates: dates });

  } catch (err) {
    console.error('instructor blackout-dates error:', err);
    return res.status(500).json({ error: 'Failed to load blackout dates' });
  }
}

// ── POST /api/instructor?action=set-blackout-dates ────────────────────────────
// Body: { dates: [{ date: "YYYY-MM-DD", reason?: "..." }, ...] }
// Replaces all future blackout dates for this instructor.
async function handleSetBlackoutDates(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const instructor = verifyInstructorAuth(req);
  if (!instructor) return res.status(401).json({ error: 'Unauthorised' });

  const { dates } = req.body;
  if (!Array.isArray(dates))
    return res.status(400).json({ error: 'dates must be an array' });

  // Validate each date
  for (const d of dates) {
    if (!d.date || !/^\d{4}-\d{2}-\d{2}$/.test(d.date))
      return res.status(400).json({ error: `Invalid date format: ${d.date}. Use YYYY-MM-DD` });
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Ensure table exists
    await sql`CREATE TABLE IF NOT EXISTS instructor_blackout_dates (
      id SERIAL PRIMARY KEY,
      instructor_id INTEGER NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
      blackout_date DATE NOT NULL,
      reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_blackout_date UNIQUE (instructor_id, blackout_date)
    )`;

    // Delete all future blackout dates for this instructor
    await sql`
      DELETE FROM instructor_blackout_dates
      WHERE instructor_id = ${instructor.id}
        AND blackout_date >= CURRENT_DATE
    `;

    // Insert new blackout dates
    for (const d of dates) {
      await sql`
        INSERT INTO instructor_blackout_dates (instructor_id, blackout_date, reason)
        VALUES (${instructor.id}, ${d.date}, ${d.reason || null})
        ON CONFLICT (instructor_id, blackout_date) DO UPDATE SET reason = EXCLUDED.reason
      `;
    }

    const saved = await sql`
      SELECT id, blackout_date::text, reason
      FROM instructor_blackout_dates
      WHERE instructor_id = ${instructor.id}
        AND blackout_date >= CURRENT_DATE
      ORDER BY blackout_date ASC
    `;

    return res.json({ success: true, blackout_dates: saved });

  } catch (err) {
    console.error('instructor set-blackout-dates error:', err);
    return res.status(500).json({ error: 'Failed to save blackout dates' });
  }
}
