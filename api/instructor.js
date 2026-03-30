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
//
//   GET  /api/instructor?action=my-learners     (JWT auth required)
//     → returns learners who have booked with this instructor, with aggregated stats

const { neon }   = require('@neondatabase/serverless');
const jwt        = require('jsonwebtoken');
const { createTransporter, generateToken } = require('./_auth-helpers');
const { reportError } = require('./_error-alert');

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
  if (action === 'qa-list')            return handleQAList(req, res);
  if (action === 'qa-detail')          return handleQADetail(req, res);
  if (action === 'qa-reply')           return handleQAReply(req, res);
  if (action === 'learner-history')    return handleLearnerHistory(req, res);
  if (action === 'cancel-booking')     return handleCancelBooking(req, res);
  if (action === 'reschedule-booking') return handleRescheduleBooking(req, res);
  if (action === 'stats')              return handleStats(req, res);
  if (action === 'upload-photo')       return handleUploadPhoto(req, res);
  if (action === 'my-learners')        return handleMyLearners(req, res);
  if (action === 'update-notes')       return handleUpdateNotes(req, res);
  if (action === 'learner-notes')      return handleLearnerNotes(req, res);
  if (action === 'update-learner-notes') return handleUpdateLearnerNotes(req, res);

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
    const token     = generateToken();
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
    reportError('/api/instructor', err);
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
    reportError('/api/instructor', err);
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
             i.id AS instructor_id, i.name, i.email, i.photo_url,
             COALESCE(i.is_admin, FALSE) AS is_admin
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
    const jwtPayload = { id: row.instructor_id, email: row.email, role: 'instructor' };
    if (row.is_admin) jwtPayload.isAdmin = true;
    const jwtToken = jwt.sign(jwtPayload, secret, { expiresIn: JWT_EXPIRY });

    return res.json({
      token: jwtToken,
      instructor: { id: row.instructor_id, name: row.name, email: row.email, photo_url: row.photo_url, is_admin: !!row.is_admin }
    });

  } catch (err) {
    console.error('instructor verify-token error:', err);
    reportError('/api/instructor', err);
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
        lu.pickup_address AS learner_pickup_address,
        ds.id AS session_log_id,
        ds.notes AS session_notes,
        lb.instructor_notes
      FROM lesson_bookings lb
      JOIN learner_users lu ON lu.id = lb.learner_id
      LEFT JOIN driving_sessions ds ON ds.booking_id = lb.id
      WHERE lb.instructor_id = ${instructor.id}
        AND lb.status IN ('confirmed', 'completed')
        AND lb.scheduled_date >= (CURRENT_DATE - INTERVAL '14 days')
      ORDER BY lb.scheduled_date ASC, lb.start_time ASC
      LIMIT 60
    `;

    // Fetch skill ratings for any logged sessions
    const loggedIds = bookings.filter(b => b.session_log_id).map(b => b.session_log_id);
    let ratingsMap = {};
    if (loggedIds.length > 0) {
      const allRatings = await sql`
        SELECT session_id, skill_key, rating
        FROM skill_ratings
        WHERE session_id = ANY(${loggedIds})
        ORDER BY id`;
      for (const r of allRatings) {
        if (!ratingsMap[r.session_id]) ratingsMap[r.session_id] = [];
        ratingsMap[r.session_id].push({ skill_key: r.skill_key, rating: r.rating });
      }
    }

    const now      = new Date();
    const upcoming = [];
    const past     = [];

    for (const b of bookings) {
      // Attach learner ratings if session was logged
      if (b.session_log_id) {
        b.learner_ratings = ratingsMap[b.session_log_id] || [];
      }
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
    reportError('/api/instructor', err);
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

    // Simple core query — only uses tables we know exist
    const bookings = await sql`
      SELECT
        lb.id,
        lb.scheduled_date::text,
        lb.start_time::text,
        lb.end_time::text,
        lb.status,
        lb.notes,
        lb.instructor_notes,
        lu.id    AS learner_id,
        lu.name  AS learner_name,
        lu.email AS learner_email,
        lu.phone AS learner_phone,
        lu.pickup_address AS learner_pickup_address,
        COALESCE(lu.prefer_contact_before, false) AS prefer_contact_before
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
    console.error('schedule-range err:', err.message);
    reportError('/api/instructor', err);
    return res.status(500).json({ error: 'Failed to load schedule', details: err.message });
  }
}

// ── POST /api/instructor?action=complete ──────────────────────────────────────
// Body: { booking_id }
// Marks a booking as completed.
async function handleComplete(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const instructor = verifyInstructorAuth(req);
  if (!instructor) return res.status(401).json({ error: 'Unauthorised' });

  const { booking_id, instructor_notes } = req.body;
  if (!booking_id) return res.status(400).json({ error: 'booking_id required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Must belong to this instructor and be a past confirmed booking
    const [booking] = await sql`
      SELECT lb.id, lb.status, lb.scheduled_date, lb.start_time,
             lu.email AS learner_email, lu.name AS learner_name,
             i.name AS instructor_name, i.email AS instructor_email
      FROM lesson_bookings lb
      JOIN learner_users lu ON lu.id = lb.learner_id
      JOIN instructors i ON i.id = lb.instructor_id
      WHERE lb.id = ${booking_id} AND lb.instructor_id = ${instructor.id}
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
      UPDATE lesson_bookings SET status = 'completed',
        instructor_notes = ${instructor_notes ? instructor_notes.trim() : null}
      WHERE id = ${booking_id}
    `;

    // Send email to learner prompting them to log the session
    const isDemoInstructor = booking.instructor_email === 'demo@coachcarter.uk';
    if (!isDemoInstructor && booking.learner_email) {
      try {
        const mailer = createTransporter();
        const firstName = (booking.learner_name || '').split(' ')[0] || 'there';
        const dateStr = new Date(booking.scheduled_date + 'T00:00:00Z')
          .toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
        const logUrl = `https://coachcarter.uk/learner/log-session.html?booking_id=${booking_id}`;

        await mailer.sendMail({
          from: 'CoachCarter <system@coachcarter.uk>',
          to: booking.learner_email,
          subject: 'Your lesson is complete — log your session!',
          html: `
            <h2>Nice one, ${firstName}!</h2>
            <p>${booking.instructor_name} has marked your lesson on <strong>${dateStr}</strong> as complete.</p>
            <p>Take a moment to log how it went — it only takes 30 seconds and helps you track your progress.</p>
            <p style="margin:28px 0">
              <a href="${logUrl}"
                 style="background:#f58321;color:white;padding:14px 28px;text-decoration:none;
                        border-radius:8px;display:inline-block;font-weight:bold;font-size:1rem;">
                Log my session →
              </a>
            </p>
            <p style="color:#888;font-size:0.85rem;">
              You can also log sessions from your dashboard at any time.
            </p>
          `
        });
      } catch (emailErr) {
        console.error('Failed to send session-log email:', emailErr);
        // Don't fail the request if email fails
      }
    }

    return res.json({ success: true });

  } catch (err) {
    console.error('instructor complete error:', err);
    reportError('/api/instructor', err);
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
    reportError('/api/instructor', err);
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
    reportError('/api/instructor', err);
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
    reportError('/api/instructor', err);
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
    reportError('/api/instructor', err);
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
    reportError('/api/instructor', err);
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
    reportError('/api/instructor', err);
    return res.status(500).json({ error: 'Failed to save blackout dates' });
  }
}

// ── Q&A: List questions (all, public) ───────────────────────────────────────
async function handleQAList(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const instructor = verifyInstructorAuth(req);
  if (!instructor) return res.status(401).json({ error: 'Unauthorised' });

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
    console.error('instructor qa-list error:', err);
    reportError('/api/instructor', err);
    return res.status(500).json({ error: 'Failed to load questions' });
  }
}

// ── Q&A: Question detail with answers ───────────────────────────────────────
async function handleQADetail(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const instructor = verifyInstructorAuth(req);
  if (!instructor) return res.status(401).json({ error: 'Unauthorised' });

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
    console.error('instructor qa-detail error:', err);
    reportError('/api/instructor', err);
    return res.status(500).json({ error: 'Failed to load question' });
  }
}

// ── Q&A: Instructor answer ──────────────────────────────────────────────────
async function handleQAReply(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const instructor = verifyInstructorAuth(req);
  if (!instructor) return res.status(401).json({ error: 'Unauthorised' });

  const { question_id, body } = req.body;
  if (!question_id) return res.status(400).json({ error: 'question_id required' });
  if (!body || !body.trim()) return res.status(400).json({ error: 'Reply body is required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const [question] = await sql`SELECT id, status FROM qa_questions WHERE id = ${question_id}`;
    if (!question) return res.status(404).json({ error: 'Question not found' });

    const [answer] = await sql`
      INSERT INTO qa_answers (question_id, author_type, author_id, body)
      VALUES (${question_id}, 'instructor', ${instructor.id}, ${body.trim()})
      RETURNING id, created_at`;

    // Auto-mark as answered when instructor replies
    if (question.status === 'open') {
      await sql`UPDATE qa_questions SET status = 'answered', updated_at = NOW() WHERE id = ${question_id}`;
    } else {
      await sql`UPDATE qa_questions SET updated_at = NOW() WHERE id = ${question_id}`;
    }

    return res.json({ success: true, answer_id: answer.id });
  } catch (err) {
    console.error('instructor qa-reply error:', err);
    reportError('/api/instructor', err);
    return res.status(500).json({ error: 'Failed to post reply' });
  }
}

// ── GET /api/instructor?action=learner-history&learner_id=X ──────────────────
// Returns a learner's full lesson history with this instructor.
async function handleLearnerHistory(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const instructor = verifyInstructorAuth(req);
  if (!instructor) return res.status(401).json({ error: 'Unauthorised' });

  const learnerId = req.query.learner_id;
  if (!learnerId) return res.status(400).json({ error: 'learner_id required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const [learner] = await sql`
      SELECT id, name, email, phone, tier, created_at,
             pickup_address, prefer_contact_before
      FROM learner_users WHERE id = ${learnerId}
    `;
    if (!learner) return res.status(404).json({ error: 'Learner not found' });

    const bookings = await sql`
      SELECT lb.id, lb.scheduled_date::text, lb.start_time::text, lb.end_time::text,
             lb.status, lb.instructor_notes,
             ds.id AS session_log_id, ds.notes AS session_notes
      FROM lesson_bookings lb
      LEFT JOIN driving_sessions ds ON ds.booking_id = lb.id
      WHERE lb.instructor_id = ${instructor.id}
        AND lb.learner_id = ${learnerId}
        AND lb.status IN ('confirmed', 'completed', 'cancelled')
      ORDER BY lb.scheduled_date DESC, lb.start_time DESC
      LIMIT 100
    `;

    // Fetch skill ratings
    const loggedIds = bookings.filter(b => b.session_log_id).map(b => b.session_log_id);
    let ratingsMap = {};
    if (loggedIds.length > 0) {
      const allRatings = await sql`
        SELECT session_id, skill_key, rating FROM skill_ratings
        WHERE session_id = ANY(${loggedIds}) ORDER BY id`;
      for (const r of allRatings) {
        if (!ratingsMap[r.session_id]) ratingsMap[r.session_id] = [];
        ratingsMap[r.session_id].push({ skill_key: r.skill_key, rating: r.rating });
      }
    }
    for (const b of bookings) {
      if (b.session_log_id) b.learner_ratings = ratingsMap[b.session_log_id] || [];
    }

    const totalLessons = bookings.filter(b => b.status === 'completed').length;

    return res.json({ learner, bookings, totalLessons });
  } catch (err) {
    console.error('instructor learner-history error:', err);
    reportError('/api/instructor', err);
    return res.status(500).json({ error: 'Failed to load learner history' });
  }
}

// ── POST /api/instructor?action=cancel-booking ──────────────────────────────
// Body: { booking_id, reason }
// Cancels a confirmed booking and refunds the learner's credit.
async function handleCancelBooking(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const instructor = verifyInstructorAuth(req);
  if (!instructor) return res.status(401).json({ error: 'Unauthorised' });

  const { booking_id, reason } = req.body;
  if (!booking_id) return res.status(400).json({ error: 'booking_id required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const [booking] = await sql`
      SELECT lb.id, lb.status, lb.learner_id, lb.scheduled_date, lb.start_time,
             lu.name AS learner_name, lu.email AS learner_email,
             i.name AS instructor_name
      FROM lesson_bookings lb
      JOIN learner_users lu ON lu.id = lb.learner_id
      JOIN instructors i ON i.id = lb.instructor_id
      WHERE lb.id = ${booking_id} AND lb.instructor_id = ${instructor.id}
    `;

    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (booking.status !== 'confirmed')
      return res.status(400).json({ error: `Cannot cancel a booking with status "${booking.status}"` });

    // Cancel the booking
    await sql`
      UPDATE lesson_bookings SET status = 'cancelled',
        instructor_notes = ${reason ? 'Cancelled: ' + reason.trim() : 'Cancelled by instructor'}
      WHERE id = ${booking_id}
    `;

    // Refund the learner's credit
    await sql`
      UPDATE learner_users SET credits = credits + 1
      WHERE id = ${booking.learner_id}
    `;

    // Email the learner
    try {
      const mailer = createTransporter();
      const firstName = (booking.learner_name || '').split(' ')[0] || 'there';
      const dateObj = new Date(booking.scheduled_date + 'T00:00:00Z');
      const dateStr = dateObj.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
      const timeStr = booking.start_time.slice(0, 5);

      await mailer.sendMail({
        from: 'CoachCarter <system@coachcarter.uk>',
        to: booking.learner_email,
        subject: `Lesson on ${dateStr} has been cancelled`,
        html: `
          <h2>Hi ${firstName},</h2>
          <p>Your lesson on <strong>${dateStr} at ${timeStr}</strong> with ${booking.instructor_name} has been cancelled.</p>
          ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}
          <p>Your lesson credit has been refunded automatically. You can rebook at any time from your dashboard.</p>
          <p style="margin:28px 0">
            <a href="https://coachcarter.uk/learner/book.html"
               style="background:#f58321;color:white;padding:14px 28px;text-decoration:none;
                      border-radius:8px;display:inline-block;font-weight:bold;font-size:1rem;">
              Rebook a lesson →
            </a>
          </p>
        `
      });
    } catch (emailErr) {
      console.error('Failed to send cancellation email:', emailErr);
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('instructor cancel-booking error:', err);
    reportError('/api/instructor', err);
    return res.status(500).json({ error: 'Failed to cancel booking' });
  }
}

// ── POST /api/instructor?action=reschedule-booking ─────────────────────────
// Body: { booking_id, new_date, new_start_time }
// Instructor-initiated reschedule: no 48hr restriction, no reschedule count limit.
async function handleRescheduleBooking(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const instructor = verifyInstructorAuth(req);
  if (!instructor) return res.status(401).json({ error: 'Unauthorised' });

  const { booking_id, new_date, new_start_time } = req.body;
  if (!booking_id || !new_date || !new_start_time)
    return res.status(400).json({ error: 'booking_id, new_date and new_start_time are required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Load booking — must belong to this instructor
    const [booking] = await sql`
      SELECT lb.id, lb.status, lb.learner_id, lb.scheduled_date, lb.start_time, lb.end_time,
             lb.instructor_id, COALESCE(lb.reschedule_count, 0) AS reschedule_count,
             lu.name AS learner_name, lu.email AS learner_email,
             i.name AS instructor_name
      FROM lesson_bookings lb
      JOIN learner_users lu ON lu.id = lb.learner_id
      JOIN instructors i ON i.id = lb.instructor_id
      WHERE lb.id = ${booking_id} AND lb.instructor_id = ${instructor.id}
    `;

    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (booking.status !== 'confirmed')
      return res.status(400).json({ error: `Cannot reschedule a booking with status "${booking.status}"` });

    // Calculate new end time (fixed 90-minute slots)
    const startParts = new_start_time.split(':').map(Number);
    const startMins  = startParts[0] * 60 + startParts[1];
    const endMins    = startMins + 90;
    const new_end_time = `${String(Math.floor(endMins / 60)).padStart(2, '0')}:${String(endMins % 60).padStart(2, '0')}`;

    // Check new slot is available
    const [existingBooking] = await sql`
      SELECT id FROM lesson_bookings
      WHERE instructor_id = ${booking.instructor_id}
        AND scheduled_date = ${new_date}
        AND start_time = ${new_start_time}::time
        AND status IN ('confirmed', 'completed')
    `;
    if (existingBooking)
      return res.status(409).json({ error: 'That slot is already booked.' });

    // Mark old booking as rescheduled
    await sql`
      UPDATE lesson_bookings
      SET status = 'rescheduled', cancelled_at = NOW()
      WHERE id = ${booking_id}
    `;

    // Create new booking
    let newBooking;
    try {
      const [b] = await sql`
        INSERT INTO lesson_bookings
          (learner_id, instructor_id, scheduled_date, start_time, end_time, status,
           rescheduled_from, reschedule_count)
        VALUES
          (${booking.learner_id}, ${booking.instructor_id}, ${new_date}, ${new_start_time},
           ${new_end_time}, 'confirmed', ${booking_id}, ${booking.reschedule_count + 1})
        RETURNING id, scheduled_date, start_time::text, end_time::text, reschedule_count
      `;
      newBooking = b;
    } catch (insertErr) {
      // Rollback: restore old booking
      await sql`
        UPDATE lesson_bookings SET status = 'confirmed', cancelled_at = NULL
        WHERE id = ${booking_id}
      `;
      if (insertErr.message?.includes('uq_booking_slot')) {
        return res.status(409).json({ error: 'That slot was just taken. Please choose another.' });
      }
      throw insertErr;
    }

    // Email the learner
    try {
      const mailer = createTransporter();
      const oldDate = new Date(booking.scheduled_date + 'T00:00:00Z')
        .toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
      const newDateStr = new Date(new_date + 'T00:00:00Z')
        .toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
      const oldTime = String(booking.start_time).slice(0, 5);
      const firstName = (booking.learner_name || '').split(' ')[0] || 'there';

      await mailer.sendMail({
        from: 'CoachCarter <system@coachcarter.uk>',
        to: booking.learner_email,
        subject: `Lesson rescheduled to ${newDateStr} at ${new_start_time}`,
        html: `
          <h2>Hi ${firstName},</h2>
          <p>Your instructor ${booking.instructor_name} has rescheduled your lesson:</p>
          <table>
            <tr><td><strong>Was:</strong></td><td><s>${oldDate} at ${oldTime}</s></td></tr>
            <tr><td><strong>Now:</strong></td><td>${newDateStr} at ${new_start_time}</td></tr>
            <tr><td><strong>Duration:</strong></td><td>1.5 hours</td></tr>
          </table>
          <p style="margin:28px 0">
            <a href="https://coachcarter.uk/learner/book.html"
               style="background:#f58321;color:white;padding:14px 28px;text-decoration:none;
                      border-radius:8px;display:inline-block;font-weight:bold;font-size:1rem;">
              View my bookings →
            </a>
          </p>
        `
      });
    } catch (emailErr) {
      console.error('Failed to send reschedule email:', emailErr);
    }

    return res.json({
      ok: true,
      old_booking_id: booking_id,
      new_booking_id: newBooking.id,
      new_date,
      new_start_time,
      new_end_time
    });
  } catch (err) {
    console.error('instructor reschedule-booking error:', err);
    reportError('/api/instructor', err);
    return res.status(500).json({ error: 'Failed to reschedule booking' });
  }
}

// ── GET /api/instructor?action=stats ────────────────────────────────────────
// Returns summary statistics for the instructor.
async function handleStats(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const instructor = verifyInstructorAuth(req);
  if (!instructor) return res.status(401).json({ error: 'Unauthorised' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Today's lessons
    const [todayStats] = await sql`
      SELECT COUNT(*)::int AS count FROM lesson_bookings
      WHERE instructor_id = ${instructor.id} AND status IN ('confirmed','completed')
        AND scheduled_date = CURRENT_DATE
    `;

    // This week (Mon-Sun)
    const [weekStats] = await sql`
      SELECT COUNT(*)::int AS count FROM lesson_bookings
      WHERE instructor_id = ${instructor.id} AND status IN ('confirmed','completed')
        AND scheduled_date >= date_trunc('week', CURRENT_DATE)
        AND scheduled_date < date_trunc('week', CURRENT_DATE) + INTERVAL '7 days'
    `;

    // This month
    const [monthStats] = await sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
        COUNT(*) FILTER (WHERE status = 'confirmed')::int AS upcoming,
        COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled
      FROM lesson_bookings
      WHERE instructor_id = ${instructor.id}
        AND scheduled_date >= date_trunc('month', CURRENT_DATE)
        AND scheduled_date < date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'
    `;

    // Total all-time
    const [allTime] = await sql`
      SELECT COUNT(*)::int AS total_completed FROM lesson_bookings
      WHERE instructor_id = ${instructor.id} AND status = 'completed'
    `;

    // Unique learners this month
    const [learnerCount] = await sql`
      SELECT COUNT(DISTINCT learner_id)::int AS count FROM lesson_bookings
      WHERE instructor_id = ${instructor.id} AND status IN ('confirmed','completed')
        AND scheduled_date >= date_trunc('month', CURRENT_DATE)
    `;

    // New bookings since last visit (last 24h)
    const [newBookings] = await sql`
      SELECT COUNT(*)::int AS count FROM lesson_bookings
      WHERE instructor_id = ${instructor.id} AND status = 'confirmed'
        AND created_at >= NOW() - INTERVAL '24 hours'
    `;

    return res.json({
      today: todayStats.count,
      thisWeek: weekStats.count,
      thisMonth: monthStats,
      allTimeCompleted: allTime.total_completed,
      uniqueLearnersThisMonth: learnerCount.count,
      newBookingsLast24h: newBookings.count
    });
  } catch (err) {
    console.error('instructor stats error:', err);
    reportError('/api/instructor', err);
    return res.status(500).json({ error: 'Failed to load stats' });
  }
}

// ── POST /api/instructor?action=upload-photo ────────────────────────────────
// Accepts a base64-encoded image and stores it as a data URL.
// Body: { image } (base64 data URL like "data:image/jpeg;base64,...")
async function handleUploadPhoto(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const instructor = verifyInstructorAuth(req);
  if (!instructor) return res.status(401).json({ error: 'Unauthorised' });

  const { image } = req.body;
  if (!image || !image.startsWith('data:image/'))
    return res.status(400).json({ error: 'image must be a data:image/* base64 string' });

  // Limit to ~2MB
  if (image.length > 2 * 1024 * 1024)
    return res.status(400).json({ error: 'Image too large (max 2MB)' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const [updated] = await sql`
      UPDATE instructors SET photo_url = ${image}
      WHERE id = ${instructor.id}
      RETURNING id, name, photo_url
    `;

    return res.json({ success: true, photo_url: updated.photo_url });
  } catch (err) {
    console.error('instructor upload-photo error:', err);
    reportError('/api/instructor', err);
    return res.status(500).json({ error: 'Failed to upload photo' });
  }
}

// ── GET /api/instructor?action=my-learners ──────────────────────────────────
// Returns learners who have booked at least once with this instructor
async function handleMyLearners(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const instructor = verifyInstructorAuth(req);
  if (!instructor) return res.status(401).json({ error: 'Unauthorised' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const learners = await sql`
      SELECT
        lu.id, lu.name, lu.email, lu.phone,
        lu.current_tier, lu.pickup_address, lu.prefer_contact_before,
        COUNT(lb.id)::int AS total_lessons,
        COUNT(lb.id) FILTER (WHERE lb.status = 'completed')::int AS completed_lessons,
        COUNT(lb.id) FILTER (WHERE lb.status = 'confirmed' AND lb.scheduled_date >= CURRENT_DATE)::int AS upcoming_lessons,
        MAX(lb.scheduled_date)::text AS last_lesson_date,
        MIN(lb.scheduled_date)::text AS first_lesson_date,
        iln.notes AS instructor_notes,
        iln.test_date::text AS test_date
      FROM learner_users lu
      JOIN lesson_bookings lb ON lb.learner_id = lu.id
      LEFT JOIN instructor_learner_notes iln ON iln.learner_id = lu.id AND iln.instructor_id = ${instructor.id}
      WHERE lb.instructor_id = ${instructor.id}
      GROUP BY lu.id, iln.notes, iln.test_date
      ORDER BY MAX(lb.scheduled_date) DESC
    `;

    return res.json({ learners });
  } catch (err) {
    console.error('instructor my-learners error:', err);
    reportError('/api/instructor', err);
    return res.status(500).json({ error: 'Failed to load learners' });
  }
}

// ── POST /api/instructor?action=update-notes ──────────────────────────────────
// Body: { booking_id, instructor_notes }
// Updates notes on an already-completed booking.
async function handleUpdateNotes(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const instructor = verifyInstructorAuth(req);
  if (!instructor) return res.status(401).json({ error: 'Unauthorised' });

  const { booking_id, instructor_notes } = req.body;
  if (!booking_id) return res.status(400).json({ error: 'booking_id required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const [booking] = await sql`
      SELECT id, status FROM lesson_bookings
      WHERE id = ${booking_id} AND instructor_id = ${instructor.id}
    `;

    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (booking.status !== 'completed')
      return res.status(400).json({ error: 'Can only edit notes on completed lessons' });

    await sql`
      UPDATE lesson_bookings
      SET instructor_notes = ${instructor_notes ? instructor_notes.trim() : null}
      WHERE id = ${booking_id}
    `;

    return res.json({ ok: true });
  } catch (err) {
    console.error('update-notes error:', err);
    reportError('/api/instructor', err);
    return res.status(500).json({ error: 'Failed to update notes' });
  }
}

// ── GET /api/instructor?action=learner-notes&learner_id=X ─────────────────────
// Returns instructor's notes + test_date for a specific learner.
async function handleLearnerNotes(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const instructor = verifyInstructorAuth(req);
  if (!instructor) return res.status(401).json({ error: 'Unauthorised' });

  const learner_id = req.query.learner_id;
  if (!learner_id) return res.status(400).json({ error: 'learner_id required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const [row] = await sql`
      SELECT notes, test_date::text
      FROM instructor_learner_notes
      WHERE instructor_id = ${instructor.id} AND learner_id = ${learner_id}
    `;
    return res.json({ notes: row?.notes || '', test_date: row?.test_date || null });
  } catch (err) {
    console.error('learner-notes error:', err);
    reportError('/api/instructor', err);
    return res.status(500).json({ error: 'Failed to load notes' });
  }
}

// ── POST /api/instructor?action=update-learner-notes ──────────────────────────
// Body: { learner_id, notes, test_date }
// Upserts instructor's notes and test_date for a learner.
async function handleUpdateLearnerNotes(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const instructor = verifyInstructorAuth(req);
  if (!instructor) return res.status(401).json({ error: 'Unauthorised' });

  const { learner_id, notes, test_date } = req.body;
  if (!learner_id) return res.status(400).json({ error: 'learner_id required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);
    await sql`
      INSERT INTO instructor_learner_notes (instructor_id, learner_id, notes, test_date, updated_at)
      VALUES (${instructor.id}, ${learner_id}, ${notes || null}, ${test_date || null}, NOW())
      ON CONFLICT (instructor_id, learner_id)
      DO UPDATE SET notes = ${notes || null}, test_date = ${test_date || null}, updated_at = NOW()
    `;
    return res.json({ ok: true });
  } catch (err) {
    console.error('update-learner-notes error:', err);
    reportError('/api/instructor', err);
    return res.status(500).json({ error: 'Failed to save notes' });
  }
}
