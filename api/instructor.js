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
//
//   POST /api/instructor?action=ical-test       (JWT auth required)
//     → test-fetches an iCal feed URL, returns event count
//
//   GET  /api/instructor?action=ical-status     (JWT auth required)
//     → returns iCal sync status (url, last_synced, error, event_count)

const { neon }   = require('@neondatabase/serverless');
const jwt        = require('jsonwebtoken');
const twilio     = require('twilio');
const { createTransporter, generateToken } = require('./_auth-helpers');
const { reportError } = require('./_error-alert');
const { resolveConfirmations } = require('./_confirmation-resolver');
const { getEligibleBookings }  = require('./_payout-helpers');

function sendWhatsApp(to, message) {
  const sid  = process.env.TWILIO_SID;
  const auth = process.env.TWILIO_AUTH;
  const from = process.env.TWILIO_WHATSAPP_FROM;
  if (!sid || !auth || !from || !to) return Promise.resolve();
  let phone = to.replace(/\s+/g, '');
  if (phone.startsWith('0')) phone = '+44' + phone.slice(1);
  else if (!phone.startsWith('+')) phone = '+' + phone;
  const client = twilio(sid, auth);
  return client.messages.create({
    from: `whatsapp:${from}`,
    to:   `whatsapp:${phone}`,
    body: message
  }).catch(err => { console.warn('WhatsApp failed:', err.message); });
}

const TOKEN_EXPIRY_MINUTES = 30;
const JWT_EXPIRY           = '7d';

function setCors(res) {
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
  const action = req.query.action;
  if (action === 'request-login')    return handleRequestLogin(req, res);
  if (action === 'validate-token')   return handleValidateToken(req, res);
  if (action === 'verify-token')     return handleVerifyToken(req, res);
  if (action === 'schedule')         return handleSchedule(req, res);
  if (action === 'schedule-range')   return handleScheduleRange(req, res);
  if (action === 'complete')         return handleComplete(req, res);
  if (action === 'confirm-lesson')   return handleConfirmLesson(req, res);
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
  if (action === 'create-booking')     return handleCreateBooking(req, res);
  if (action === 'stats')              return handleStats(req, res);
  if (action === 'upload-photo')       return handleUploadPhoto(req, res);
  if (action === 'my-learners')        return handleMyLearners(req, res);
  if (action === 'update-notes')       return handleUpdateNotes(req, res);
  if (action === 'learner-notes')      return handleLearnerNotes(req, res);
  if (action === 'learner-mock-tests') return handleLearnerMockTests(req, res);
  if (action === 'update-learner-notes') return handleUpdateLearnerNotes(req, res);
  if (action === 'earnings-week')        return handleEarningsWeek(req, res);
  if (action === 'earnings-history')     return handleEarningsHistory(req, res);
  if (action === 'earnings-summary')     return handleEarningsSummary(req, res);
  if (action === 'ical-test')            return handleIcalTest(req, res);
  if (action === 'ical-status')          return handleIcalStatus(req, res);
  if (action === 'create-offer')         return handleCreateOffer(req, res);
  if (action === 'list-offers')          return handleListOffers(req, res);
  if (action === 'cancel-offer')         return handleCancelOffer(req, res);
  if (action === 'payout-history')       return handlePayoutHistory(req, res);
  if (action === 'next-payout-preview')  return handleNextPayoutPreview(req, res);
  if (action === 'complete-onboarding')  return handleCompleteOnboarding(req, res);
  if (action === 'running-late')         return handleRunningLate(req, res);

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
             i.school_id, i.onboarding_complete,
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
    const jwtPayload = { id: row.instructor_id, email: row.email, role: 'instructor', school_id: row.school_id };
    if (row.is_admin) jwtPayload.isAdmin = true;
    const jwtToken = jwt.sign(jwtPayload, secret, { expiresIn: JWT_EXPIRY });

    return res.json({
      token: jwtToken,
      instructor: { id: row.instructor_id, name: row.name, email: row.email, photo_url: row.photo_url, is_admin: !!row.is_admin, school_id: row.school_id, onboarding_complete: row.onboarding_complete }
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
  const schoolId = instructor.school_id || 1;

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
        lb.lesson_type_id,
        lu.id   AS learner_id,
        lu.name AS learner_name,
        lu.email AS learner_email,
        lu.phone AS learner_phone,
        COALESCE(lu.prefer_contact_before, false) AS prefer_contact_before,
        lu.pickup_address AS learner_pickup_address,
        lb.pickup_address AS booking_pickup_address,
        lb.dropoff_address AS booking_dropoff_address,
        ds.id AS session_log_id,
        ds.notes AS session_notes,
        lb.instructor_notes,
        lt.name AS lesson_type_name,
        lt.colour AS lesson_type_colour,
        COALESCE(lt.duration_minutes, 90) AS duration_minutes
      FROM lesson_bookings lb
      JOIN learner_users lu ON lu.id = lb.learner_id
      LEFT JOIN driving_sessions ds ON ds.booking_id = lb.id
      LEFT JOIN lesson_types lt ON lt.id = lb.lesson_type_id
      WHERE lb.instructor_id = ${instructor.id}
        AND lb.school_id = ${schoolId}
        AND lb.status IN ('confirmed', 'completed', 'awaiting_confirmation')
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
  const schoolId = instructor.school_id || 1;

  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: '"from" and "to" are required (YYYY-MM-DD)' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to))
    return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Core query with lesson type join
    const bookings = await sql`
      SELECT
        lb.id,
        lb.scheduled_date::text,
        lb.start_time::text,
        lb.end_time::text,
        lb.status,
        lb.notes,
        lb.instructor_notes,
        lb.lesson_type_id,
        lu.id    AS learner_id,
        lu.name  AS learner_name,
        lu.email AS learner_email,
        lu.phone AS learner_phone,
        lu.pickup_address AS learner_pickup_address,
        lb.pickup_address AS booking_pickup_address,
        lb.dropoff_address AS booking_dropoff_address,
        COALESCE(lu.prefer_contact_before, false) AS prefer_contact_before,
        lt.name AS lesson_type_name,
        lt.colour AS lesson_type_colour,
        COALESCE(lt.duration_minutes, 90) AS duration_minutes
      FROM lesson_bookings lb
      JOIN learner_users lu ON lu.id = lb.learner_id
      LEFT JOIN lesson_types lt ON lt.id = lb.lesson_type_id
      WHERE lb.instructor_id = ${instructor.id}
        AND lb.school_id = ${schoolId}
        AND lb.status IN ('confirmed', 'completed', 'awaiting_confirmation')
        AND lb.scheduled_date >= ${from}::date
        AND lb.scheduled_date <= ${to}::date
      ORDER BY lb.scheduled_date ASC, lb.start_time ASC
      LIMIT 500
    `;

    return res.json({ bookings });

  } catch (err) {
    console.error('schedule-range err:', err.message);
    reportError('/api/instructor', err);
    return res.status(500).json({ error: 'Failed to load schedule', details: 'Internal server error' });
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

    const [booking] = await sql`
      SELECT lb.id, lb.status, lb.scheduled_date, lb.start_time, lb.end_time,
             lu.email AS learner_email, lu.name AS learner_name, lu.phone AS learner_phone,
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
    if (!['confirmed', 'awaiting_confirmation'].includes(booking.status))
      return res.status(400).json({ error: `Cannot complete a booking with status "${booking.status}"` });

    // Only allow completing bookings that are in the past
    const dateStr = typeof booking.scheduled_date === 'string'
      ? booking.scheduled_date.slice(0, 10)
      : new Date(booking.scheduled_date).toISOString().slice(0, 10);
    const timeStr = booking.end_time || booking.start_time || '23:59:59';
    const lessonEnd = new Date(`${dateStr}T${timeStr}Z`);
    if (lessonEnd > new Date())
      return res.status(400).json({ error: 'Cannot mark a future lesson as complete' });

    // Store instructor notes if provided
    if (instructor_notes) {
      await sql`
        UPDATE lesson_bookings SET instructor_notes = ${instructor_notes.trim()}
        WHERE id = ${booking_id}
      `;
    }

    // Submit instructor confirmation (lesson happened = true, via legacy complete flow)
    await sql`
      INSERT INTO lesson_confirmations (booking_id, confirmed_by_role, lesson_happened, notes)
      VALUES (${booking_id}, 'instructor', true, ${instructor_notes ? instructor_notes.trim() : null})
      ON CONFLICT (booking_id, confirmed_by_role) DO NOTHING
    `;

    // If booking was still 'confirmed', transition to 'awaiting_confirmation'
    if (booking.status === 'confirmed') {
      await sql`
        UPDATE lesson_bookings SET status = 'awaiting_confirmation'
        WHERE id = ${booking_id} AND status = 'confirmed'
      `;
    }

    // Try to resolve (in case learner already confirmed)
    const result = await resolveConfirmations(sql, booking_id);

    // Send confirmation prompt email to learner
    const isDemoInstructor = booking.instructor_email === 'demo@coachcarter.uk';
    if (!isDemoInstructor && booking.learner_email) {
      try {
        const mailer = createTransporter();
        const firstName = (booking.learner_name || '').split(' ')[0] || 'there';
        const dateStr = new Date(booking.scheduled_date + 'T00:00:00Z')
          .toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
        const baseUrl = process.env.BASE_URL || 'https://coachcarter.uk';
        const confirmUrl = `${baseUrl}/learner/confirm-lesson.html?booking_id=${booking_id}`;

        await mailer.sendMail({
          from: 'CoachCarter <system@coachcarter.uk>',
          to: booking.learner_email,
          subject: 'How did your lesson go? Please confirm',
          html: `
            <h2>Hey ${firstName}!</h2>
            <p>Your lesson on <strong>${dateStr}</strong> with ${booking.instructor_name} has ended.</p>
            <p>Please take a moment to confirm how it went — it only takes 30 seconds.</p>
            <p style="margin:28px 0">
              <a href="${confirmUrl}"
                 style="background:#f58321;color:white;padding:14px 28px;text-decoration:none;
                        border-radius:8px;display:inline-block;font-weight:bold;font-size:1rem;">
                Confirm my lesson →
              </a>
            </p>
            <p style="color:#888;font-size:0.85rem;">
              You can also confirm from your dashboard at any time.
            </p>
          `
        });
      } catch (emailErr) {
        console.error('Failed to send confirmation email:', emailErr);
      }
    }

    return res.json({ success: true, status: result.resolved ? result.newStatus : 'awaiting_confirmation' });

  } catch (err) {
    console.error('instructor complete error:', err);
    reportError('/api/instructor', err);
    return res.status(500).json({ error: 'Failed to mark booking as complete', message: err.message });
  }
}

// ── POST /api/instructor?action=confirm-lesson ─────────────────────────────────
// Body: { booking_id, lesson_happened, late_party, late_minutes, notes }
// Instructor submits their confirmation of whether the lesson took place.
async function handleConfirmLesson(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const instructor = verifyInstructorAuth(req);
  if (!instructor) return res.status(401).json({ error: 'Unauthorised' });

  const { booking_id, lesson_happened, late_party, late_minutes, notes } = req.body;
  if (!booking_id) return res.status(400).json({ error: 'booking_id required' });
  if (typeof lesson_happened !== 'boolean') return res.status(400).json({ error: 'lesson_happened must be true or false' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const [booking] = await sql`
      SELECT lb.id, lb.status, lb.scheduled_date, lb.start_time, lb.end_time,
             lu.email AS learner_email, lu.name AS learner_name, lu.phone AS learner_phone,
             i.name AS instructor_name, i.email AS instructor_email
      FROM lesson_bookings lb
      JOIN learner_users lu ON lu.id = lb.learner_id
      JOIN instructors i ON i.id = lb.instructor_id
      WHERE lb.id = ${booking_id} AND lb.instructor_id = ${instructor.id}
    `;

    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (['completed', 'no_show', 'disputed', 'cancelled'].includes(booking.status))
      return res.status(400).json({ error: `Booking already resolved with status "${booking.status}"` });

    // Must be in the past
    const lessonEnd = new Date(`${booking.scheduled_date}T${booking.end_time || booking.start_time}Z`);
    if (lessonEnd > new Date())
      return res.status(400).json({ error: 'Cannot confirm a lesson that hasn\'t ended yet' });

    // Validate late_party
    const validLateParty = late_party && ['instructor', 'learner'].includes(late_party) ? late_party : null;
    const validLateMinutes = validLateParty && late_minutes > 0 ? parseInt(late_minutes) : null;

    // Insert confirmation
    await sql`
      INSERT INTO lesson_confirmations (booking_id, confirmed_by_role, lesson_happened, late_party, late_minutes, notes)
      VALUES (${booking_id}, 'instructor', ${lesson_happened}, ${validLateParty}, ${validLateMinutes}, ${notes ? notes.trim() : null})
      ON CONFLICT (booking_id, confirmed_by_role) DO NOTHING
    `;

    // If booking was still 'confirmed', transition to 'awaiting_confirmation' and prompt learner
    if (booking.status === 'confirmed') {
      await sql`
        UPDATE lesson_bookings SET status = 'awaiting_confirmation'
        WHERE id = ${booking_id} AND status = 'confirmed'
      `;

      // Send learner confirmation prompt
      const isDemoInstructor = booking.instructor_email === 'demo@coachcarter.uk';
      if (!isDemoInstructor && booking.learner_email) {
        try {
          const mailer = createTransporter();
          const firstName = (booking.learner_name || '').split(' ')[0] || 'there';
          const dateStr = new Date(booking.scheduled_date + 'T00:00:00Z')
            .toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
          const baseUrl = process.env.BASE_URL || 'https://coachcarter.uk';
          const confirmUrl = `${baseUrl}/learner/confirm-lesson.html?booking_id=${booking_id}`;

          await mailer.sendMail({
            from: 'CoachCarter <system@coachcarter.uk>',
            to: booking.learner_email,
            subject: 'How did your lesson go? Please confirm',
            html: `
              <h2>Hey ${firstName}!</h2>
              <p>Your lesson on <strong>${dateStr}</strong> with ${booking.instructor_name} has ended.</p>
              <p>Please take a moment to confirm how it went — it only takes 30 seconds.</p>
              <p style="margin:28px 0">
                <a href="${confirmUrl}"
                   style="background:#f58321;color:white;padding:14px 28px;text-decoration:none;
                          border-radius:8px;display:inline-block;font-weight:bold;font-size:1rem;">
                  Confirm my lesson →
                </a>
              </p>
            `
          });
        } catch (emailErr) {
          console.error('Failed to send learner confirmation email:', emailErr);
        }
      }
    }

    // Try to resolve
    const result = await resolveConfirmations(sql, booking_id);

    return res.json({
      success: true,
      status: result.resolved ? result.newStatus : 'awaiting_confirmation'
    });

  } catch (err) {
    console.error('instructor confirm-lesson error:', err);
    reportError('/api/instructor', err);
    return res.status(500).json({ error: 'Failed to confirm lesson' });
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
      SELECT id, name, email, phone, bio, photo_url, active, slug, created_at,
             COALESCE(buffer_minutes, 30) AS buffer_minutes,
             COALESCE(calendar_start_hour, 7) AS calendar_start_hour,
             adi_grade, pass_rate, years_experience,
             COALESCE(specialisms, '[]'::jsonb) AS specialisms,
             vehicle_make, vehicle_model,
             COALESCE(transmission_type, 'manual') AS transmission_type,
             COALESCE(dual_controls, true) AS dual_controls,
             COALESCE(service_areas, '[]'::jsonb) AS service_areas,
             COALESCE(languages, '["English"]'::jsonb) AS languages,
             ical_feed_url, ical_last_synced_at, ical_sync_error
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

  const {
    name, phone, bio, photo_url, buffer_minutes, calendar_start_hour, reminder_hours, daily_schedule_email,
    adi_grade, pass_rate, years_experience, specialisms,
    vehicle_make, vehicle_model, transmission_type, dual_controls,
    service_areas, languages, ical_feed_url
  } = req.body;

  // Validate buffer_minutes if provided
  if (buffer_minutes !== undefined && buffer_minutes !== null) {
    const buf = parseInt(buffer_minutes);
    if (isNaN(buf) || buf < 0 || buf > 120)
      return res.status(400).json({ error: 'Buffer time must be between 0 and 120 minutes' });
  }

  // Validate calendar_start_hour if provided
  if (calendar_start_hour !== undefined && calendar_start_hour !== null) {
    const csh = parseInt(calendar_start_hour);
    if (isNaN(csh) || csh < 0 || csh > 23)
      return res.status(400).json({ error: 'Calendar start hour must be between 0 and 23' });
  }

  // Validate reminder_hours if provided
  if (reminder_hours !== undefined && reminder_hours !== null) {
    const rh = parseInt(reminder_hours);
    if (isNaN(rh) || rh < 1 || rh > 72)
      return res.status(400).json({ error: 'Reminder hours must be between 1 and 72' });
  }

  // Validate daily_schedule_email if provided
  if (daily_schedule_email !== undefined && daily_schedule_email !== null && typeof daily_schedule_email !== 'boolean') {
    return res.status(400).json({ error: 'daily_schedule_email must be true or false' });
  }

  // Validate pass_rate if provided
  if (pass_rate !== undefined && pass_rate !== null) {
    const pr = parseFloat(pass_rate);
    if (isNaN(pr) || pr < 0 || pr > 100)
      return res.status(400).json({ error: 'Pass rate must be between 0 and 100' });
  }

  // Validate years_experience if provided
  if (years_experience !== undefined && years_experience !== null) {
    const ye = parseInt(years_experience);
    if (isNaN(ye) || ye < 0 || ye > 60)
      return res.status(400).json({ error: 'Years experience must be between 0 and 60' });
  }

  // Validate transmission_type if provided
  const allowedTransmissions = ['manual', 'automatic', 'both'];
  if (transmission_type !== undefined && transmission_type !== null && !allowedTransmissions.includes(transmission_type)) {
    return res.status(400).json({ error: 'Transmission type must be manual, automatic, or both' });
  }

  // Validate dual_controls if provided
  if (dual_controls !== undefined && dual_controls !== null && typeof dual_controls !== 'boolean') {
    return res.status(400).json({ error: 'dual_controls must be true or false' });
  }

  // Validate JSONB array fields
  for (const [field, val] of [['specialisms', specialisms], ['service_areas', service_areas], ['languages', languages]]) {
    if (val !== undefined && val !== null && !Array.isArray(val)) {
      return res.status(400).json({ error: `${field} must be an array` });
    }
  }

  // Validate iCal feed URL if provided
  let icalUrlClean = undefined; // undefined = don't touch column
  if (ical_feed_url !== undefined) {
    if (ical_feed_url === null || ical_feed_url === '') {
      icalUrlClean = ''; // signals "clear it"
    } else {
      let url = String(ical_feed_url).trim();
      if (url.startsWith('webcal://')) url = 'https://' + url.slice(9);
      try { new URL(url); } catch {
        return res.status(400).json({ error: 'Invalid iCal feed URL' });
      }
      if (!url.startsWith('https://'))
        return res.status(400).json({ error: 'iCal feed URL must use https://' });
      if (url.length > 2048)
        return res.status(400).json({ error: 'iCal feed URL is too long' });
      if (/coachcarter\.(uk|co\.uk)/i.test(url))
        return res.status(400).json({ error: 'Cannot use a CoachCarter URL as the feed source' });
      icalUrlClean = url;
    }
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const bufVal = (buffer_minutes !== undefined && buffer_minutes !== null)
      ? parseInt(buffer_minutes) : null;
    const cshVal = (calendar_start_hour !== undefined && calendar_start_hour !== null)
      ? parseInt(calendar_start_hour) : null;
    const rhVal = (reminder_hours !== undefined && reminder_hours !== null)
      ? parseInt(reminder_hours) : null;
    const dseVal = (daily_schedule_email !== undefined && daily_schedule_email !== null)
      ? daily_schedule_email : null;
    const prVal = (pass_rate !== undefined && pass_rate !== null)
      ? parseFloat(pass_rate) : null;
    const yeVal = (years_experience !== undefined && years_experience !== null)
      ? parseInt(years_experience) : null;
    const dcVal = (dual_controls !== undefined && dual_controls !== null)
      ? dual_controls : null;
    const specVal = (specialisms !== undefined && specialisms !== null)
      ? JSON.stringify(specialisms) : null;
    const areasVal = (service_areas !== undefined && service_areas !== null)
      ? JSON.stringify(service_areas) : null;
    const langsVal = (languages !== undefined && languages !== null)
      ? JSON.stringify(languages) : null;

    // If iCal URL is being changed (set or cleared), reset sync state
    const icalChanged = icalUrlClean !== undefined;
    const icalVal = icalUrlClean === '' ? null : (icalUrlClean || null);

    const [updated] = await sql`
      UPDATE instructors SET
        name                 = COALESCE(NULLIF(${name      || ''}, ''), name),
        phone                = COALESCE(${phone     ?? null}, phone),
        bio                  = COALESCE(${bio       ?? null}, bio),
        photo_url            = COALESCE(${photo_url ?? null}, photo_url),
        buffer_minutes       = COALESCE(${bufVal}, buffer_minutes),
        calendar_start_hour  = COALESCE(${cshVal}, calendar_start_hour),
        reminder_hours       = COALESCE(${rhVal}, reminder_hours),
        daily_schedule_email = COALESCE(${dseVal}, daily_schedule_email),
        adi_grade            = COALESCE(${adi_grade ?? null}, adi_grade),
        pass_rate            = COALESCE(${prVal}, pass_rate),
        years_experience     = COALESCE(${yeVal}, years_experience),
        specialisms          = COALESCE(${specVal}::jsonb, specialisms),
        vehicle_make         = COALESCE(${vehicle_make ?? null}, vehicle_make),
        vehicle_model        = COALESCE(${vehicle_model ?? null}, vehicle_model),
        transmission_type    = COALESCE(${transmission_type ?? null}, transmission_type),
        dual_controls        = COALESCE(${dcVal}, dual_controls),
        service_areas        = COALESCE(${areasVal}::jsonb, service_areas),
        languages            = COALESCE(${langsVal}::jsonb, languages),
        ical_feed_url        = CASE WHEN ${icalChanged} THEN ${icalVal} ELSE ical_feed_url END,
        ical_last_synced_at  = CASE WHEN ${icalChanged} THEN NULL ELSE ical_last_synced_at END,
        ical_sync_error      = CASE WHEN ${icalChanged} THEN NULL ELSE ical_sync_error END
      WHERE id = ${instructor.id}
      RETURNING id, name, email, phone, bio, photo_url,
                COALESCE(buffer_minutes, 30) AS buffer_minutes,
                COALESCE(calendar_start_hour, 7) AS calendar_start_hour,
                COALESCE(reminder_hours, 24) AS reminder_hours,
                COALESCE(daily_schedule_email, true) AS daily_schedule_email,
                adi_grade, pass_rate, years_experience,
                COALESCE(specialisms, '[]'::jsonb) AS specialisms,
                vehicle_make, vehicle_model,
                COALESCE(transmission_type, 'manual') AS transmission_type,
                COALESCE(dual_controls, true) AS dual_controls,
                COALESCE(service_areas, '[]'::jsonb) AS service_areas,
                COALESCE(languages, '["English"]'::jsonb) AS languages,
                ical_feed_url, ical_last_synced_at, ical_sync_error
    `;

    return res.json({ success: true, instructor: updated });

  } catch (err) {
    console.error('instructor update-profile error:', err);
    reportError('/api/instructor', err);
    return res.status(500).json({ error: 'Failed to update profile' });
  }
}

// ── GET /api/instructor?action=blackout-dates ─────────────────────────────────
// Returns the instructor's blackout date ranges (active/future only).
async function handleBlackoutDates(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const instructor = verifyInstructorAuth(req);
  if (!instructor) return res.status(401).json({ error: 'Unauthorised' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const dates = await sql`
      SELECT id, blackout_date::text AS start_date, end_date::text, reason
      FROM instructor_blackout_dates
      WHERE instructor_id = ${instructor.id}
        AND end_date >= CURRENT_DATE
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
// Body: { ranges: [{ start_date, end_date, reason? }, ...] }
// Replaces all future blackout date ranges for this instructor.
async function handleSetBlackoutDates(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const instructor = verifyInstructorAuth(req);
  if (!instructor) return res.status(401).json({ error: 'Unauthorised' });

  const { ranges } = req.body;
  if (!Array.isArray(ranges))
    return res.status(400).json({ error: 'ranges must be an array' });

  const dateRx = /^\d{4}-\d{2}-\d{2}$/;
  for (const r of ranges) {
    if (!r.start_date || !dateRx.test(r.start_date))
      return res.status(400).json({ error: `Invalid start_date: ${r.start_date}. Use YYYY-MM-DD` });
    if (!r.end_date || !dateRx.test(r.end_date))
      return res.status(400).json({ error: `Invalid end_date: ${r.end_date}. Use YYYY-MM-DD` });
    if (r.end_date < r.start_date)
      return res.status(400).json({ error: `end_date must be >= start_date` });
    // Max 365-day range
    const diffMs = new Date(r.end_date) - new Date(r.start_date);
    if (diffMs > 365 * 86400000)
      return res.status(400).json({ error: 'Range cannot exceed 365 days' });
  }

  // Check for overlapping ranges within the submission
  const sorted = [...ranges].sort((a, b) => a.start_date.localeCompare(b.start_date));
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start_date <= sorted[i - 1].end_date)
      return res.status(400).json({ error: 'Submitted ranges must not overlap' });
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Delete all future/active blackout ranges for this instructor
    await sql`
      DELETE FROM instructor_blackout_dates
      WHERE instructor_id = ${instructor.id}
        AND end_date >= CURRENT_DATE
    `;

    // Insert new ranges
    for (const r of ranges) {
      await sql`
        INSERT INTO instructor_blackout_dates (instructor_id, blackout_date, end_date, reason)
        VALUES (${instructor.id}, ${r.start_date}, ${r.end_date}, ${r.reason || null})
      `;
    }

    const saved = await sql`
      SELECT id, blackout_date::text AS start_date, end_date::text, reason
      FROM instructor_blackout_dates
      WHERE instructor_id = ${instructor.id}
        AND end_date >= CURRENT_DATE
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
  const schoolId = instructor.school_id || 1;

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
          AND q.school_id = ${schoolId}
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
        WHERE q.school_id = ${schoolId}
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
  const schoolId = instructor.school_id || 1;

  const questionId = req.query.question_id;
  if (!questionId) return res.status(400).json({ error: 'question_id required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const [question] = await sql`
      SELECT q.*, lu.name AS learner_name
      FROM qa_questions q
      JOIN learner_users lu ON lu.id = q.learner_id
      WHERE q.id = ${questionId} AND q.school_id = ${schoolId}`;
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
  const schoolId = instructor.school_id || 1;

  const { question_id, body } = req.body;
  if (!question_id) return res.status(400).json({ error: 'question_id required' });
  if (!body || !body.trim()) return res.status(400).json({ error: 'Reply body is required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const [question] = await sql`SELECT id, status FROM qa_questions WHERE id = ${question_id} AND school_id = ${schoolId}`;
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
  const schoolId = instructor.school_id || 1;

  const learnerId = req.query.learner_id;
  if (!learnerId) return res.status(400).json({ error: 'learner_id required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const [learner] = await sql`
      SELECT id, name, email, phone, current_tier, created_at,
             pickup_address, prefer_contact_before
      FROM learner_users WHERE id = ${learnerId} AND school_id = ${schoolId}
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
             COALESCE(lb.minutes_deducted, 90) AS minutes_deducted,
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

    const minsToReturn = booking.minutes_deducted || 90;

    // Cancel the booking
    await sql`
      UPDATE lesson_bookings SET status = 'cancelled',
        credit_returned = true, cancelled_at = NOW(),
        instructor_notes = ${reason ? 'Cancelled: ' + reason.trim() : 'Cancelled by instructor'}
      WHERE id = ${booking_id}
    `;

    // Refund the learner's balance (minutes + credit count)
    await sql`
      UPDATE learner_users
      SET balance_minutes = balance_minutes + ${minsToReturn},
          credit_balance = credit_balance + 1
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

    const schoolId = instructor.school_id || 1;

    // Load booking — must belong to this instructor
    const [booking] = await sql`
      SELECT lb.id, lb.status, lb.learner_id, lb.scheduled_date, lb.start_time, lb.end_time,
             lb.instructor_id, lb.school_id, COALESCE(lb.reschedule_count, 0) AS reschedule_count,
             lb.lesson_type_id, lb.minutes_deducted, lb.pickup_address, lb.dropoff_address,
             lu.name AS learner_name, lu.email AS learner_email,
             i.name AS instructor_name,
             COALESCE(lt.duration_minutes, 90) AS type_duration_minutes
      FROM lesson_bookings lb
      JOIN learner_users lu ON lu.id = lb.learner_id
      JOIN instructors i ON i.id = lb.instructor_id
      LEFT JOIN lesson_types lt ON lt.id = lb.lesson_type_id
      WHERE lb.id = ${booking_id} AND lb.instructor_id = ${instructor.id}
        AND COALESCE(lb.school_id, 1) = ${schoolId}
    `;

    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (booking.status !== 'confirmed')
      return res.status(400).json({ error: `Cannot reschedule a booking with status "${booking.status}"` });

    // Calculate new end time using booking's lesson type duration
    const bookingDuration = parseInt(booking.type_duration_minutes) || 90;
    const startParts = new_start_time.split(':').map(Number);
    const startMins  = startParts[0] * 60 + startParts[1];
    const endMins    = startMins + bookingDuration;
    const new_end_time = `${String(Math.floor(endMins / 60)).padStart(2, '0')}:${String(endMins % 60).padStart(2, '0')}`;

    // Check new slot is available
    const [existingBooking] = await sql`
      SELECT id FROM lesson_bookings
      WHERE instructor_id = ${booking.instructor_id}
        AND scheduled_date = ${new_date}
        AND start_time = ${new_start_time}::time
        AND status IN ('confirmed', 'completed', 'awaiting_confirmation')
        AND COALESCE(school_id, 1) = ${schoolId}
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
           rescheduled_from, reschedule_count, lesson_type_id, minutes_deducted,
           pickup_address, dropoff_address, school_id)
        VALUES
          (${booking.learner_id}, ${booking.instructor_id}, ${new_date}, ${new_start_time},
           ${new_end_time}, 'confirmed', ${booking_id}, ${booking.reschedule_count + 1},
           ${booking.lesson_type_id || null}, ${booking.minutes_deducted != null ? booking.minutes_deducted : null},
           ${booking.pickup_address || null}, ${booking.dropoff_address || null}, ${schoolId})
        RETURNING id, scheduled_date, start_time::text, end_time::text, reschedule_count
      `;
      newBooking = b;
    } catch (insertErr) {
      // Rollback: restore old booking
      await sql`
        UPDATE lesson_bookings SET status = 'confirmed', cancelled_at = NULL
        WHERE id = ${booking_id}
      `;
      if (insertErr.message?.includes('uq_booking_slot') || insertErr.code === '23505') {
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
            <tr><td><strong>Duration:</strong></td><td>${bookingDuration >= 60 ? (bookingDuration % 60 === 0 ? (bookingDuration/60) + ' hour' + (bookingDuration/60 !== 1 ? 's' : '') : (bookingDuration/60).toFixed(1) + ' hours') : bookingDuration + ' mins'}</td></tr>
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

// ── POST /api/instructor?action=create-booking ────────────────────────────
// Body: { learner_id, scheduled_date, start_time, payment_method, notes, pickup_address?, dropoff_address? }
// Instructor creates a booking on behalf of a learner.
async function handleCreateBooking(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const instructor = verifyInstructorAuth(req);
  if (!instructor) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = instructor.school_id || 1;

  const { learner_id, scheduled_date, start_time, lesson_type_id, payment_method, notes, pickup_address, dropoff_address } = req.body;
  if (!learner_id || !scheduled_date || !start_time)
    return res.status(400).json({ error: 'learner_id, scheduled_date and start_time are required' });

  // Validate date
  const bookingDate = new Date(scheduled_date + 'T00:00:00Z');
  if (isNaN(bookingDate.getTime()))
    return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  if (bookingDate < today)
    return res.status(400).json({ error: 'Cannot book a slot in the past' });

  const payMethod = payment_method || 'cash';

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Look up lesson type (default to standard)
    let lessonType;
    if (lesson_type_id) {
      const [lt] = await sql`SELECT * FROM lesson_types WHERE id = ${lesson_type_id} AND active = true AND school_id = ${schoolId}`;
      lessonType = lt;
    }
    if (!lessonType) {
      const [lt] = await sql`SELECT * FROM lesson_types WHERE slug = 'standard' AND active = true AND school_id = ${schoolId}`;
      lessonType = lt || { id: null, duration_minutes: 90, name: 'Standard Lesson', price_pence: 8250 };
    }
    const durationMins = lessonType.duration_minutes;

    // Calculate end time from lesson type duration
    const startParts = start_time.split(':').map(Number);
    const startMins  = startParts[0] * 60 + startParts[1];
    const endMins    = startMins + durationMins;
    const end_time   = `${String(Math.floor(endMins / 60)).padStart(2, '0')}:${String(endMins % 60).padStart(2, '0')}`;
    const durationStr = durationMins >= 60
      ? (durationMins % 60 === 0 ? `${durationMins / 60} hour${durationMins / 60 !== 1 ? 's' : ''}` : `${(durationMins / 60).toFixed(1)} hours`)
      : `${durationMins} mins`;

    // Verify learner exists
    const [learner] = await sql`
      SELECT id, name, email, phone, credit_balance, balance_minutes, pickup_address
      FROM learner_users WHERE id = ${learner_id} AND school_id = ${schoolId}
    `;
    if (!learner)
      return res.status(404).json({ error: 'Learner not found' });

    // Get instructor details for notifications
    const [instrDetails] = await sql`
      SELECT id, name, email, phone FROM instructors WHERE id = ${instructor.id} AND school_id = ${schoolId}
    `;

    // Handle credit/hours deduction if paying by credit
    let creditDeducted = false;
    if (payMethod === 'credit') {
      const balance = learner.balance_minutes || 0;
      if (balance < durationMins)
        return res.status(402).json({ error: `${learner.name} doesn't have enough hours. They need ${durationStr} but have ${(balance / 60).toFixed(1)} hrs. Use "Cash" or "Free" instead.` });

      const [deducted] = await sql`
        UPDATE learner_users
        SET balance_minutes = balance_minutes - ${durationMins},
            credit_balance = GREATEST(credit_balance - 1, 0)
        WHERE id = ${learner_id} AND balance_minutes >= ${durationMins}
        RETURNING balance_minutes
      `;
      if (!deducted)
        return res.status(402).json({ error: 'Learner doesn\'t have enough hours.' });
      creditDeducted = true;
    }

    // Insert booking
    let booking;
    try {
      const bookingPickup = pickup_address || learner.pickup_address || null;
      const bookingDropoff = dropoff_address || null;
      const [b] = await sql`
        INSERT INTO lesson_bookings
          (learner_id, instructor_id, scheduled_date, start_time, end_time, status,
           created_by, payment_method, instructor_notes, pickup_address, dropoff_address,
           lesson_type_id, minutes_deducted, school_id)
        VALUES
          (${learner_id}, ${instructor.id}, ${scheduled_date}, ${start_time}, ${end_time},
           'confirmed', 'instructor', ${payMethod}, ${notes || null},
           ${bookingPickup}, ${bookingDropoff},
           ${lessonType.id}, ${payMethod === 'credit' ? durationMins : 0}, ${schoolId})
        RETURNING id, scheduled_date, start_time::text, end_time::text, status
      `;
      booking = b;
    } catch (insertErr) {
      // Rollback hours if deducted
      if (creditDeducted) {
        await sql`UPDATE learner_users SET balance_minutes = balance_minutes + ${durationMins}, credit_balance = credit_balance + 1 WHERE id = ${learner_id}`;
      }
      if (insertErr.message?.includes('uq_booking_slot') || insertErr.code === '23505') {
        return res.status(409).json({ error: 'That slot is already booked. Please choose another time.' });
      }
      throw insertErr;
    }

    // Get updated balance
    const [updated] = await sql`SELECT credit_balance, balance_minutes FROM learner_users WHERE id = ${learner_id}`;
    const balanceStr = ((updated.balance_minutes || 0) / 60).toFixed(1) + ' hrs';

    // Send confirmation email to learner
    const dateObj = new Date(scheduled_date + 'T00:00:00Z');
    const dateStr = dateObj.toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC'
    });
    const firstName = (learner.name || '').split(' ')[0] || 'there';

    try {
      const mailer = createTransporter();
      await mailer.sendMail({
        from: 'CoachCarter <bookings@coachcarter.uk>',
        to: learner.email,
        subject: `Lesson booked — ${dateStr} at ${start_time}`,
        html: `
          <h2>Hi ${firstName},</h2>
          <p>Your instructor ${instrDetails.name} has booked a lesson for you:</p>
          <table>
            <tr><td><strong>Date:</strong></td><td>${dateStr}</td></tr>
            <tr><td><strong>Time:</strong></td><td>${start_time} – ${end_time}</td></tr>
            <tr><td><strong>Instructor:</strong></td><td>${instrDetails.name}</td></tr>
            <tr><td><strong>Type:</strong></td><td>${lessonType.name}</td></tr>
            <tr><td><strong>Duration:</strong></td><td>${durationStr}</td></tr>
          </table>
          ${payMethod === 'credit' ? `<p>${durationStr} deducted from your balance. You have ${balanceStr} remaining.</p>` : ''}
          <p style="margin-top:16px;font-size:0.875rem;color:#797879">
            Need to cancel? Do so at least 48 hours before and the hours return to your balance.
          </p>
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
      console.error('Failed to send booking email:', emailErr);
    }

    // WhatsApp to learner
    await sendWhatsApp(learner.phone,
      `✅ Lesson booked!\n\n📅 ${dateStr}\n⏰ ${start_time} – ${end_time}\n🚗 Instructor: ${instrDetails.name}\n\n${payMethod === 'credit' ? `1 lesson deducted. ${updated.credit_balance} remaining.\n\n` : ''}Need to cancel? Do so at least 48 hours before and the lesson returns to your balance.\n\nView bookings: https://coachcarter.uk/learner/`
    );

    return res.json({
      ok: true,
      booking_id: booking.id,
      learner_name: learner.name,
      scheduled_date,
      start_time,
      end_time,
      payment_method: payMethod,
      credit_balance: updated.credit_balance
    });
  } catch (err) {
    console.error('instructor create-booking error:', err);
    reportError('/api/instructor', err);
    return res.status(500).json({ error: 'Failed to create booking' });
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
  const schoolId = instructor.school_id || 1;

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
        iln.test_date::text AS test_date,
        iln.custom_hourly_rate_pence
      FROM learner_users lu
      JOIN lesson_bookings lb ON lb.learner_id = lu.id
      LEFT JOIN instructor_learner_notes iln ON iln.learner_id = lu.id AND iln.instructor_id = ${instructor.id}
      WHERE lb.instructor_id = ${instructor.id}
        AND lb.school_id = ${schoolId}
      GROUP BY lu.id, iln.notes, iln.test_date, iln.custom_hourly_rate_pence
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
    if (!['confirmed', 'completed'].includes(booking.status))
      return res.status(400).json({ error: 'Can only edit notes on confirmed or completed lessons' });

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

// ── GET /api/instructor?action=learner-mock-tests&learner_id=X ──────────────
// Returns mock test history for a learner (scoped to instructor's school).
async function handleLearnerMockTests(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const instructor = verifyInstructorAuth(req);
  if (!instructor) return res.status(401).json({ error: 'Unauthorised' });

  const learner_id = req.query.learner_id;
  if (!learner_id) return res.status(400).json({ error: 'learner_id required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const schoolId = instructor.school_id || 1;

    const tests = await sql`
      SELECT mt.id, mt.started_at, mt.completed_at, mt.result, mt.mode,
        mt.total_driving_faults, mt.total_serious_faults, mt.total_dangerous_faults,
        mt.notes,
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
      WHERE mt.learner_id = ${learner_id}
        AND mt.school_id = ${schoolId}
        AND mt.completed_at IS NOT NULL
      GROUP BY mt.id
      ORDER BY mt.started_at DESC
      LIMIT 10`;

    return res.json({ mock_tests: tests });
  } catch (err) {
    console.error('learner-mock-tests error:', err);
    reportError('/api/instructor', err);
    return res.status(500).json({ error: 'Failed to load mock tests' });
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
      SELECT notes, test_date::text, custom_hourly_rate_pence
      FROM instructor_learner_notes
      WHERE instructor_id = ${instructor.id} AND learner_id = ${learner_id}
    `;
    return res.json({ notes: row?.notes || '', test_date: row?.test_date || null, custom_hourly_rate_pence: row?.custom_hourly_rate_pence || null });
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

  const { learner_id, notes, test_date, custom_hourly_rate_pence } = req.body;
  if (!learner_id) return res.status(400).json({ error: 'learner_id required' });

  const ratePence = custom_hourly_rate_pence != null && custom_hourly_rate_pence !== '' ? parseInt(custom_hourly_rate_pence) : null;
  if (ratePence != null && (isNaN(ratePence) || ratePence < 0)) return res.status(400).json({ error: 'Invalid hourly rate' });

  try {
    const sql = neon(process.env.POSTGRES_URL);
    await sql`
      INSERT INTO instructor_learner_notes (instructor_id, learner_id, notes, test_date, custom_hourly_rate_pence, updated_at)
      VALUES (${instructor.id}, ${learner_id}, ${notes || null}, ${test_date || null}, ${ratePence}, NOW())
      ON CONFLICT (instructor_id, learner_id)
      DO UPDATE SET notes = ${notes || null}, test_date = ${test_date || null}, custom_hourly_rate_pence = ${ratePence}, updated_at = NOW()
    `;
    return res.json({ ok: true });
  } catch (err) {
    console.error('update-learner-notes error:', err);
    reportError('/api/instructor', err);
    return res.status(500).json({ error: 'Failed to save notes' });
  }
}

// ── GET /api/instructor?action=earnings-week ──────────────────────────────────
// Returns lessons for a Monday–Sunday pay week with per-lesson pay.
// Query params: week_start=YYYY-MM-DD (optional, defaults to current week's Monday)
async function handleEarningsWeek(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const instructor = verifyInstructorAuth(req);
  if (!instructor) return res.status(401).json({ error: 'Unauthorised' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Get commission rate and franchise fee
    const [inst] = await sql`
      SELECT COALESCE(commission_rate, 0.85) AS commission_rate, weekly_franchise_fee_pence
      FROM instructors WHERE id = ${instructor.id}
    `;
    const rate = parseFloat(inst.commission_rate);
    const franchiseFee = inst.weekly_franchise_fee_pence != null ? parseInt(inst.weekly_franchise_fee_pence) : null;
    const feeModel = franchiseFee != null ? 'franchise' : 'commission';

    // Determine week boundaries (Monday–Sunday)
    let weekStart = req.query.week_start;
    const [weekRow] = weekStart
      ? await sql`SELECT ${weekStart}::date AS week_start, (${weekStart}::date + 6) AS week_end`
      : await sql`SELECT date_trunc('week', CURRENT_DATE)::date AS week_start, (date_trunc('week', CURRENT_DATE)::date + 6) AS week_end`;

    const lessons = await sql`
      SELECT
        lb.id, lb.scheduled_date::text AS date,
        lb.start_time::text AS start_time,
        lb.end_time::text AS end_time,
        lb.status,
        lu.name AS learner_name,
        lt.name AS lesson_type_name,
        CASE WHEN iln.custom_hourly_rate_pence IS NOT NULL
          THEN ROUND(iln.custom_hourly_rate_pence * COALESCE(lt.duration_minutes, 90) / 60.0)
          ELSE COALESCE(lt.price_pence, 8250)
        END AS price_pence,
        COALESCE(lt.duration_minutes, 90) AS duration_minutes
      FROM lesson_bookings lb
      JOIN learner_users lu ON lu.id = lb.learner_id
      LEFT JOIN lesson_types lt ON lt.id = lb.lesson_type_id
      LEFT JOIN instructor_learner_notes iln ON iln.instructor_id = lb.instructor_id AND iln.learner_id = lb.learner_id
      WHERE lb.instructor_id = ${instructor.id}
        AND lb.status IN ('confirmed', 'completed', 'awaiting_confirmation')
        AND lb.scheduled_date >= ${weekRow.week_start}
        AND lb.scheduled_date <= ${weekRow.week_end}
      ORDER BY lb.scheduled_date ASC, lb.start_time ASC
    `;

    let grossPence = 0;
    let completedCount = 0;
    let confirmedCount = 0;
    const mapped = lessons.map(l => {
      const pricePence = parseInt(l.price_pence);
      grossPence += pricePence;
      if (l.status === 'completed') completedCount++;
      else confirmedCount++;
      return {
        id: l.id,
        date: l.date,
        start_time: l.start_time,
        end_time: l.end_time,
        status: l.status,
        learner_name: l.learner_name,
        lesson_type_name: l.lesson_type_name || 'Standard Lesson',
        duration_minutes: parseInt(l.duration_minutes),
        price_pence: pricePence,
        instructor_pay_pence: Math.round(pricePence * rate) // per-lesson (for display)
      };
    });

    // Calculate total based on fee model
    let totalPence;
    let franchiseFeeApplied = null;
    if (feeModel === 'franchise') {
      franchiseFeeApplied = Math.min(franchiseFee, grossPence);
      totalPence = grossPence - franchiseFeeApplied;
    } else {
      totalPence = mapped.reduce((sum, l) => sum + l.instructor_pay_pence, 0);
    }

    return res.json({
      commission_rate: rate,
      fee_model: feeModel,
      weekly_franchise_fee_pence: franchiseFee,
      franchise_fee_applied_pence: franchiseFeeApplied,
      gross_pence: grossPence,
      week_start: weekRow.week_start,
      week_end: weekRow.week_end,
      lessons: mapped,
      total_pence: totalPence,
      completed_count: completedCount,
      confirmed_count: confirmedCount
    });
  } catch (err) {
    console.error('instructor earnings-week error:', err);
    reportError('/api/instructor', err);
    return res.status(500).json({ error: 'Failed to load weekly earnings' });
  }
}

// ── GET /api/instructor?action=earnings-history ───────────────────────────────
// Returns aggregated weekly totals for past weeks.
// Query params: limit (default 12, max 52), offset (default 0)
async function handleEarningsHistory(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const instructor = verifyInstructorAuth(req);
  if (!instructor) return res.status(401).json({ error: 'Unauthorised' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const [inst] = await sql`
      SELECT COALESCE(commission_rate, 0.85) AS commission_rate, weekly_franchise_fee_pence
      FROM instructors WHERE id = ${instructor.id}
    `;
    const rate = parseFloat(inst.commission_rate);
    const franchiseFee = inst.weekly_franchise_fee_pence != null ? parseInt(inst.weekly_franchise_fee_pence) : null;
    const feeModel = franchiseFee != null ? 'franchise' : 'commission';

    const limit  = Math.min(parseInt(req.query.limit) || 12, 52);
    const offset = parseInt(req.query.offset) || 0;

    const weeks = await sql`
      SELECT
        date_trunc('week', lb.scheduled_date)::date AS week_start,
        (date_trunc('week', lb.scheduled_date)::date + 6) AS week_end,
        COUNT(*)::int AS lesson_count,
        SUM(COALESCE(lt.duration_minutes, 90))::int AS total_minutes,
        SUM(COALESCE(lt.price_pence, 8250))::int AS gross_pence
      FROM lesson_bookings lb
      LEFT JOIN lesson_types lt ON lt.id = lb.lesson_type_id
      WHERE lb.instructor_id = ${instructor.id}
        AND lb.status = 'completed'
      GROUP BY date_trunc('week', lb.scheduled_date)
      ORDER BY week_start DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const mapped = weeks.map(w => {
      const instructorPay = feeModel === 'franchise'
        ? w.gross_pence - Math.min(franchiseFee, w.gross_pence)
        : Math.round(w.gross_pence * rate);
      return {
        week_start: w.week_start,
        week_end: w.week_end,
        lesson_count: w.lesson_count,
        total_minutes: w.total_minutes,
        total_hours: +(w.total_minutes / 60).toFixed(1),
        gross_pence: w.gross_pence,
        instructor_pay_pence: instructorPay
      };
    });

    return res.json({
      commission_rate: rate,
      fee_model: feeModel,
      weekly_franchise_fee_pence: franchiseFee,
      weeks: mapped,
      limit,
      offset
    });
  } catch (err) {
    console.error('instructor earnings-history error:', err);
    reportError('/api/instructor', err);
    return res.status(500).json({ error: 'Failed to load earnings history' });
  }
}

// ── GET /api/instructor?action=earnings-summary ───────────────────────────────
// Returns summary stats: this month, all-time, average per week.
async function handleEarningsSummary(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const instructor = verifyInstructorAuth(req);
  if (!instructor) return res.status(401).json({ error: 'Unauthorised' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const [inst] = await sql`
      SELECT COALESCE(commission_rate, 0.85) AS commission_rate, weekly_franchise_fee_pence
      FROM instructors WHERE id = ${instructor.id}
    `;
    const rate = parseFloat(inst.commission_rate);
    const franchiseFee = inst.weekly_franchise_fee_pence != null ? parseInt(inst.weekly_franchise_fee_pence) : null;
    const feeModel = franchiseFee != null ? 'franchise' : 'commission';

    // This month (include confirmed + completed to match weekly view)
    const [monthData] = await sql`
      SELECT
        COUNT(*)::int AS lesson_count,
        COALESCE(SUM(COALESCE(lt.price_pence, 8250)), 0)::int AS gross_pence,
        COALESCE(SUM(COALESCE(lt.duration_minutes, 90)), 0)::int AS total_minutes
      FROM lesson_bookings lb
      LEFT JOIN lesson_types lt ON lt.id = lb.lesson_type_id
      WHERE lb.instructor_id = ${instructor.id}
        AND lb.status IN ('confirmed', 'completed', 'awaiting_confirmation')
        AND lb.scheduled_date >= date_trunc('month', CURRENT_DATE)
        AND lb.scheduled_date < date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'
    `;

    // All-time
    const [allTime] = await sql`
      SELECT
        COUNT(*)::int AS lesson_count,
        COALESCE(SUM(COALESCE(lt.price_pence, 8250)), 0)::int AS gross_pence,
        COALESCE(SUM(COALESCE(lt.duration_minutes, 90)), 0)::int AS total_minutes
      FROM lesson_bookings lb
      LEFT JOIN lesson_types lt ON lt.id = lb.lesson_type_id
      WHERE lb.instructor_id = ${instructor.id}
        AND lb.status = 'completed'
    `;

    // Distinct weeks with completed lessons (for average)
    const [weeksActive] = await sql`
      SELECT COUNT(DISTINCT date_trunc('week', scheduled_date))::int AS count
      FROM lesson_bookings
      WHERE instructor_id = ${instructor.id} AND status = 'completed'
    `;

    // Calculate earnings based on fee model
    let monthEarnings, allTimeEarnings, avgPerWeekPence;
    if (feeModel === 'franchise') {
      // For franchise: need per-week gross to cap fee per week
      // Month: approximate by counting distinct weeks in the month's data
      const monthWeeks = await sql`
        SELECT COUNT(DISTINCT date_trunc('week', lb.scheduled_date))::int AS count
        FROM lesson_bookings lb
        WHERE lb.instructor_id = ${instructor.id}
          AND lb.status IN ('confirmed', 'completed', 'awaiting_confirmation')
          AND lb.scheduled_date >= date_trunc('month', CURRENT_DATE)
          AND lb.scheduled_date < date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'
      `;
      // For month: gross minus (fee × weeks in month), but each week capped at that week's gross
      // Simplified: use aggregate approach (close enough for summary display)
      const mWeeks = monthWeeks[0].count || 0;
      const mTotalFee = Math.min(franchiseFee * mWeeks, monthData.gross_pence);
      monthEarnings = monthData.gross_pence - mTotalFee;

      const aTotalFee = Math.min(franchiseFee * weeksActive.count, allTime.gross_pence);
      allTimeEarnings = allTime.gross_pence - aTotalFee;

      avgPerWeekPence = weeksActive.count > 0
        ? Math.round(allTimeEarnings / weeksActive.count) : 0;
    } else {
      monthEarnings = Math.round(monthData.gross_pence * rate);
      allTimeEarnings = Math.round(allTime.gross_pence * rate);
      avgPerWeekPence = weeksActive.count > 0
        ? Math.round(allTimeEarnings / weeksActive.count) : 0;
    }

    return res.json({
      commission_rate: rate,
      fee_model: feeModel,
      weekly_franchise_fee_pence: franchiseFee,
      this_month: {
        lesson_count: monthData.lesson_count,
        total_minutes: monthData.total_minutes,
        earnings_pence: monthEarnings
      },
      all_time: {
        lesson_count: allTime.lesson_count,
        total_minutes: allTime.total_minutes,
        earnings_pence: allTimeEarnings
      },
      avg_per_week_pence: avgPerWeekPence,
      weeks_active: weeksActive.count
    });
  } catch (err) {
    console.error('instructor earnings-summary error:', err);
    reportError('/api/instructor', err);
    return res.status(500).json({ error: 'Failed to load earnings summary' });
  }
}

// ── POST /api/instructor?action=ical-test ────────────────────────────────────
// Body: { url }  — test-fetch an iCal feed URL, returns event count
async function handleIcalTest(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const instructor = verifyInstructorAuth(req);
  if (!instructor) return res.status(401).json({ error: 'Unauthorised' });

  let url = String(req.body.url || '').trim();
  if (!url) return res.status(400).json({ error: 'URL is required' });
  if (url.startsWith('webcal://')) url = 'https://' + url.slice(9);

  try { new URL(url); } catch {
    return res.status(400).json({ error: 'Invalid URL format' });
  }
  if (!url.startsWith('https://'))
    return res.status(400).json({ error: 'URL must use https://' });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'CoachCarter-CalSync/1.0' }
    });
    clearTimeout(timeout);

    if (!resp.ok)
      return res.json({ ok: false, error: `Feed returned HTTP ${resp.status}` });

    const text = await resp.text();
    if (!text.includes('BEGIN:VCALENDAR'))
      return res.json({ ok: false, error: 'Response is not a valid iCal feed' });

    const ical = require('node-ical');
    const parsed = ical.sync.parseICS(text);
    const events = Object.values(parsed).filter(e => e.type === 'VEVENT');

    return res.json({ ok: true, event_count: events.length });
  } catch (err) {
    if (err.name === 'AbortError')
      return res.json({ ok: false, error: 'Feed took too long to respond' });
    console.error('ical-test error:', err);
    return res.json({ ok: false, error: 'Could not fetch or parse the feed' });
  }
}

// ── GET /api/instructor?action=ical-status ───────────────────────────────────
// Returns the instructor's iCal sync status
async function handleIcalStatus(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const instructor = verifyInstructorAuth(req);
  if (!instructor) return res.status(401).json({ error: 'Unauthorised' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const [row] = await sql`
      SELECT ical_feed_url, ical_last_synced_at, ical_sync_error
      FROM instructors WHERE id = ${instructor.id}
    `;

    let event_count = 0;
    if (row.ical_feed_url) {
      try {
        const [cnt] = await sql`
          SELECT COUNT(*)::int AS count FROM instructor_external_events
          WHERE instructor_id = ${instructor.id} AND event_date >= CURRENT_DATE
        `;
        event_count = cnt.count;
      } catch { /* table may not exist yet */ }
    }

    return res.json({
      ical_feed_url: row.ical_feed_url,
      ical_last_synced_at: row.ical_last_synced_at,
      ical_sync_error: row.ical_sync_error,
      event_count
    });
  } catch (err) {
    console.error('ical-status error:', err);
    reportError('/api/instructor', err);
    return res.status(500).json({ error: 'Failed to load iCal status' });
  }
}

// ── POST /api/instructor?action=create-offer ──────────────────────────────────
// Body: { learner_email, scheduled_date, start_time, lesson_type_id? }
// Creates a lesson offer and emails the learner an accept link.
async function handleCreateOffer(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const instructor = verifyInstructorAuth(req);
  if (!instructor) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = instructor.school_id || 1;

  const { learner_email, scheduled_date, start_time, lesson_type_id, discount_pct } = req.body;
  if (!learner_email || !scheduled_date || !start_time)
    return res.status(400).json({ error: 'learner_email, scheduled_date and start_time are required' });

  // Validate discount
  const discount = parseInt(discount_pct) || 0;
  if (![0, 25, 50, 75, 100].includes(discount))
    return res.status(400).json({ error: 'discount_pct must be 0, 25, 50, 75 or 100' });

  // Validate email format
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(learner_email))
    return res.status(400).json({ error: 'Invalid email address' });

  // Validate date
  const bookingDate = new Date(scheduled_date + 'T00:00:00Z');
  if (isNaN(bookingDate.getTime()))
    return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  if (bookingDate < today)
    return res.status(400).json({ error: 'Cannot offer a lesson in the past' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Look up lesson type (default to standard)
    let lessonType;
    if (lesson_type_id) {
      const [lt] = await sql`SELECT * FROM lesson_types WHERE id = ${lesson_type_id} AND active = true AND school_id = ${schoolId}`;
      lessonType = lt;
    }
    if (!lessonType) {
      const [lt] = await sql`SELECT * FROM lesson_types WHERE slug = 'standard' AND active = true AND school_id = ${schoolId}`;
      lessonType = lt || { id: null, duration_minutes: 90, name: 'Standard Lesson', price_pence: 8250 };
    }
    const durationMins = lessonType.duration_minutes;

    // Calculate end time
    const startParts = start_time.split(':').map(Number);
    const startMins  = startParts[0] * 60 + startParts[1];
    const endMins    = startMins + durationMins;
    const end_time   = `${String(Math.floor(endMins / 60)).padStart(2, '0')}:${String(endMins % 60).padStart(2, '0')}`;

    // Get instructor details
    const [instrDetails] = await sql`
      SELECT id, name, email, phone FROM instructors WHERE id = ${instructor.id}
    `;
    if (!instrDetails) return res.status(404).json({ error: 'Instructor not found' });

    // Check for conflicts — bookings
    const [existingBooking] = await sql`
      SELECT id FROM lesson_bookings
      WHERE instructor_id = ${instructor.id}
        AND scheduled_date = ${scheduled_date}
        AND start_time = ${start_time}::time
        AND status IN ('confirmed', 'completed', 'awaiting_confirmation')
    `;
    if (existingBooking)
      return res.status(409).json({ error: 'That slot is already booked.' });

    // Check for conflicts — pending offers
    const [existingOffer] = await sql`
      SELECT id FROM lesson_offers
      WHERE instructor_id = ${instructor.id}
        AND scheduled_date = ${scheduled_date}
        AND start_time = ${start_time}::time
        AND status = 'pending'
        AND expires_at > NOW()
    `;
    if (existingOffer)
      return res.status(409).json({ error: 'There is already a pending offer for that slot.' });

    // Check for conflicts — active reservations
    let hasReservation = false;
    try {
      const [existingRes] = await sql`
        SELECT id FROM slot_reservations
        WHERE instructor_id = ${instructor.id}
          AND scheduled_date = ${scheduled_date}
          AND start_time = ${start_time}::time
          AND expires_at > NOW()
      `;
      hasReservation = !!existingRes;
    } catch (e) { /* table may not exist */ }
    if (hasReservation)
      return res.status(409).json({ error: 'Someone is currently booking that slot. Try again shortly.' });

    // Check if learner already exists
    const [existingLearner] = await sql`
      SELECT id, name, email FROM learner_users WHERE LOWER(email) = LOWER(${learner_email})
    `;

    // Generate offer token
    const token = generateToken();

    // Insert offer
    const [offer] = await sql`
      INSERT INTO lesson_offers
        (token, instructor_id, learner_email, learner_id, scheduled_date, start_time, end_time,
         lesson_type_id, discount_pct, status, expires_at)
      VALUES
        (${token}, ${instructor.id}, ${learner_email.toLowerCase()}, ${existingLearner?.id || null},
         ${scheduled_date}, ${start_time}, ${end_time},
         ${lessonType.id}, ${discount}, 'pending', NOW() + INTERVAL '24 hours')
      RETURNING id, expires_at
    `;

    // Format for email
    const dateObj = new Date(scheduled_date + 'T00:00:00Z');
    const dateStr = dateObj.toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC'
    });
    const durationStr = durationMins >= 60
      ? (durationMins % 60 === 0 ? `${durationMins / 60} hour${durationMins / 60 !== 1 ? 's' : ''}` : `${(durationMins / 60).toFixed(1)} hours`)
      : `${durationMins} mins`;
    const discountedPence = Math.round(lessonType.price_pence * (100 - discount) / 100);
    const priceStr = discount > 0
      ? (discount === 100 ? 'FREE' : `<s>£${(lessonType.price_pence / 100).toFixed(2)}</s> £${(discountedPence / 100).toFixed(2)} (${discount}% off)`)
      : `£${(lessonType.price_pence / 100).toFixed(2)}`;
    const baseUrl = process.env.BASE_URL || 'https://coachcarter.uk';
    const acceptUrl = `${baseUrl}/accept-offer.html?token=${token}`;
    const firstName = existingLearner ? (existingLearner.name || '').split(' ')[0] || 'there' : 'there';

    // Send offer email
    try {
      const mailer = createTransporter();
      await mailer.sendMail({
        from: 'CoachCarter <bookings@coachcarter.uk>',
        to: learner_email,
        subject: `Driving lesson offer from ${instrDetails.name} — ${dateStr}`,
        html: `
          <div style="font-family:Arial,Helvetica,sans-serif;max-width:580px;margin:0 auto">
            <h2 style="color:#262626">Hi ${firstName},</h2>
            <p>${instrDetails.name} has offered you a driving lesson:</p>
            <table style="border-collapse:collapse;margin:16px 0">
              <tr><td style="padding:6px 16px 6px 0;font-weight:bold">Date</td><td style="padding:6px 0">${dateStr}</td></tr>
              <tr><td style="padding:6px 16px 6px 0;font-weight:bold">Time</td><td style="padding:6px 0">${start_time} – ${end_time}</td></tr>
              <tr><td style="padding:6px 16px 6px 0;font-weight:bold">Duration</td><td style="padding:6px 0">${durationStr}</td></tr>
              <tr><td style="padding:6px 16px 6px 0;font-weight:bold">Price</td><td style="padding:6px 0">${priceStr}</td></tr>
            </table>
            <p style="margin:24px 0">
              <a href="${acceptUrl}"
                 style="background:#f58321;color:white;padding:14px 28px;text-decoration:none;
                        border-radius:8px;display:inline-block;font-weight:bold;font-size:1rem">
                Accept &amp; pay →
              </a>
            </p>
            <p style="font-size:0.85rem;color:#797879">
              This offer expires in 24 hours. If you don't accept by then, the slot will become available again.
            </p>
          </div>
        `
      });
    } catch (emailErr) {
      console.error('Failed to send offer email:', emailErr);
      // Still return success — offer was created, email just failed
    }

    return res.json({
      ok: true,
      offer_id: offer.id,
      expires_at: offer.expires_at,
      learner_exists: !!existingLearner,
      accept_url: acceptUrl
    });
  } catch (err) {
    console.error('create-offer error:', err);
    if (err.message?.includes('uq_offer_slot')) {
      return res.status(409).json({ error: 'There is already a pending offer for that slot.' });
    }
    reportError('/api/instructor', err);
    return res.status(500).json({ error: 'Failed to create offer' });
  }
}

// ── GET /api/instructor?action=list-offers ────────────────────────────────────
// Query: ?status=pending|accepted|expired|cancelled (optional)
// Returns the instructor's lesson offers.
async function handleListOffers(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const instructor = verifyInstructorAuth(req);
  if (!instructor) return res.status(401).json({ error: 'Unauthorised' });

  const statusFilter = req.query.status;

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Lazy-expire any stale pending offers
    await sql`
      UPDATE lesson_offers SET status = 'expired'
      WHERE status = 'pending' AND expires_at <= NOW()
    `;

    const offers = statusFilter
      ? await sql`
          SELECT o.id, o.token, o.learner_email, o.learner_id, o.scheduled_date::text,
                 o.start_time::text, o.end_time::text, o.status, o.expires_at, o.accepted_at,
                 o.created_at, o.booking_id,
                 lt.name AS lesson_type_name, lt.duration_minutes, lt.price_pence,
                 lu.name AS learner_name
          FROM lesson_offers o
          LEFT JOIN lesson_types lt ON lt.id = o.lesson_type_id
          LEFT JOIN learner_users lu ON lu.id = o.learner_id
          WHERE o.instructor_id = ${instructor.id} AND o.status = ${statusFilter}
          ORDER BY o.created_at DESC
          LIMIT 50
        `
      : await sql`
          SELECT o.id, o.token, o.learner_email, o.learner_id, o.scheduled_date::text,
                 o.start_time::text, o.end_time::text, o.status, o.expires_at, o.accepted_at,
                 o.created_at, o.booking_id,
                 lt.name AS lesson_type_name, lt.duration_minutes, lt.price_pence,
                 lu.name AS learner_name
          FROM lesson_offers o
          LEFT JOIN lesson_types lt ON lt.id = o.lesson_type_id
          LEFT JOIN learner_users lu ON lu.id = o.learner_id
          WHERE o.instructor_id = ${instructor.id}
          ORDER BY o.created_at DESC
          LIMIT 50
        `;

    return res.json({ ok: true, offers });
  } catch (err) {
    console.error('list-offers error:', err);
    reportError('/api/instructor', err);
    return res.status(500).json({ error: 'Failed to list offers' });
  }
}

// ── POST /api/instructor?action=cancel-offer ──────────────────────────────────
// Body: { offer_id }
// Cancels a pending lesson offer.
async function handleCancelOffer(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const instructor = verifyInstructorAuth(req);
  if (!instructor) return res.status(401).json({ error: 'Unauthorised' });

  const { offer_id } = req.body;
  if (!offer_id) return res.status(400).json({ error: 'offer_id is required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const [updated] = await sql`
      UPDATE lesson_offers SET status = 'cancelled'
      WHERE id = ${offer_id} AND instructor_id = ${instructor.id} AND status = 'pending'
      RETURNING id, learner_email
    `;
    if (!updated)
      return res.status(404).json({ error: 'Offer not found or already processed' });

    return res.json({ ok: true, cancelled_id: updated.id });
  } catch (err) {
    console.error('cancel-offer error:', err);
    reportError('/api/instructor', err);
    return res.status(500).json({ error: 'Failed to cancel offer' });
  }
}

// ── GET /api/instructor?action=payout-history ──
// Returns paginated payout records for the instructor.
async function handlePayoutHistory(req, res) {
  const user = verifyInstructorAuth(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const limit = Math.min(parseInt(req.query.limit) || 20, 52);
    const offset = parseInt(req.query.offset) || 0;

    const payouts = await sql`
      SELECT id, amount_pence, platform_fee_pence, stripe_transfer_id,
             period_start, period_end, status, failure_reason,
             created_at, completed_at,
             (SELECT COUNT(*) FROM payout_line_items WHERE payout_id = ip.id) AS lesson_count
        FROM instructor_payouts ip
       WHERE instructor_id = ${user.id}
       ORDER BY created_at DESC
       LIMIT ${limit} OFFSET ${offset}
    `;

    const [{ total }] = await sql`
      SELECT COUNT(*)::int AS total FROM instructor_payouts WHERE instructor_id = ${user.id}
    `;

    return res.json({ ok: true, payouts, total, limit, offset });
  } catch (err) {
    console.error('payout-history error:', err);
    reportError('/api/instructor', err);
    return res.status(500).json({ error: 'Failed to load payout history' });
  }
}

// ── GET /api/instructor?action=next-payout-preview ──
// Returns estimated next payout amount based on unpaid eligible bookings.
async function handleNextPayoutPreview(req, res) {
  const user = verifyInstructorAuth(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const [instructor] = await sql`
      SELECT commission_rate, weekly_franchise_fee_pence, stripe_onboarding_complete, payouts_paused
        FROM instructors WHERE id = ${user.id}
    `;
    if (!instructor) return res.status(404).json({ error: 'Instructor not found' });

    const bookings = await getEligibleBookings(sql, user.id);
    const rate = parseFloat(instructor.commission_rate) || 0.85;
    const franchiseFee = instructor.weekly_franchise_fee_pence != null ? parseInt(instructor.weekly_franchise_fee_pence) : null;
    const feeModel = franchiseFee != null ? 'franchise' : 'commission';

    let grossPence = 0;
    for (const b of bookings) grossPence += parseInt(b.price_pence);

    let estimatedPence;
    let franchiseFeeApplied = null;
    if (feeModel === 'franchise') {
      franchiseFeeApplied = Math.min(franchiseFee, grossPence);
      estimatedPence = grossPence - franchiseFeeApplied;
    } else {
      estimatedPence = 0;
      for (const b of bookings) estimatedPence += Math.round(parseInt(b.price_pence) * rate);
    }

    // Calculate next Friday
    const now = new Date();
    const dayOfWeek = now.getUTCDay(); // 0=Sun, 5=Fri
    const daysUntilFriday = (5 - dayOfWeek + 7) % 7 || 7;
    const nextFriday = new Date(now);
    nextFriday.setUTCDate(now.getUTCDate() + daysUntilFriday);
    const nextPayoutDate = nextFriday.toISOString().split('T')[0];

    return res.json({
      ok: true,
      fee_model: feeModel,
      weekly_franchise_fee_pence: franchiseFee,
      franchise_fee_applied_pence: franchiseFeeApplied,
      gross_pence: grossPence,
      estimated_pence: estimatedPence,
      eligible_lessons: bookings.length,
      next_payout_date: nextPayoutDate,
      onboarding_complete: !!instructor.stripe_onboarding_complete,
      payouts_paused: !!instructor.payouts_paused
    });
  } catch (err) {
    console.error('next-payout-preview error:', err);
    reportError('/api/instructor', err);
    return res.status(500).json({ error: 'Failed to preview next payout' });
  }
}

// ── POST /api/instructor?action=complete-onboarding ──────────────────────────
async function handleCompleteOnboarding(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = verifyInstructorAuth(req);
  if (!auth) return res.status(401).json({ error: 'Unauthorised' });

  const {
    name, phone, bio, vehicle_make, vehicle_model, transmission_type,
    adi_grade, years_experience, service_areas, languages
  } = req.body || {};

  // Validate transmission_type if provided
  const allowedTransmissions = ['manual', 'automatic', 'both'];
  if (transmission_type && !allowedTransmissions.includes(transmission_type)) {
    return res.status(400).json({ error: 'Transmission type must be manual, automatic, or both' });
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const [updated] = await sql`
      UPDATE instructors SET
        name               = COALESCE(${name?.trim() || null}, name),
        phone              = COALESCE(${phone?.trim() || null}, phone),
        bio                = COALESCE(${bio?.trim() || null}, bio),
        vehicle_make       = COALESCE(${vehicle_make?.trim() || null}, vehicle_make),
        vehicle_model      = COALESCE(${vehicle_model?.trim() || null}, vehicle_model),
        transmission_type  = COALESCE(${transmission_type || null}, transmission_type),
        adi_grade          = COALESCE(${adi_grade?.trim() || null}, adi_grade),
        years_experience   = COALESCE(${years_experience != null ? parseInt(years_experience) : null}, years_experience),
        service_areas      = COALESCE(${service_areas ? JSON.stringify(service_areas) : null}::jsonb, service_areas),
        languages          = COALESCE(${languages ? JSON.stringify(languages) : null}::jsonb, languages),
        onboarding_complete = TRUE
      WHERE id = ${auth.id}
      RETURNING id, name, email, phone, bio, vehicle_make, vehicle_model,
                transmission_type, adi_grade, years_experience, service_areas,
                languages, onboarding_complete
    `;

    if (!updated) {
      return res.status(404).json({ error: 'Instructor not found' });
    }

    return res.json({ ok: true, instructor: updated });
  } catch (err) {
    console.error('complete-onboarding error:', err);
    reportError('/api/instructor', err);
    return res.status(500).json({ error: 'Failed to complete onboarding', details: 'Internal server error' });
  }
}

// ── Running Late ──────────────────────────────────────────────

async function handleRunningLate(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });

  const auth = verifyInstructorAuth(req);
  if (!auth) return res.status(401).json({ error: 'Unauthorized' });

  const sql = neon(process.env.POSTGRES_URL);

  try {
    const { delay_minutes } = req.body || {};
    const delay = parseInt(delay_minutes);
    if (!delay || delay < 1 || delay > 120) {
      return res.status(400).json({ error: 'delay_minutes must be between 1 and 120' });
    }

    // Get instructor name
    const [instructor] = await sql`
      SELECT name FROM instructors WHERE id = ${auth.id}
    `;
    if (!instructor) return res.status(404).json({ error: 'Instructor not found' });

    const firstName = instructor.name.split(' ')[0];

    // Get today's remaining confirmed bookings (start_time > now)
    const now = new Date();
    const today = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    const currentTime = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

    const bookings = await sql`
      SELECT lb.id, lb.start_time, lu.name AS learner_name, lu.phone AS learner_phone, lu.email AS learner_email
      FROM lesson_bookings lb
      JOIN learner_users lu ON lu.id = lb.learner_id
      WHERE lb.instructor_id = ${auth.id}
        AND lb.scheduled_date = ${today}
        AND lb.status = 'confirmed'
        AND lb.start_time > ${currentTime}
      ORDER BY lb.start_time ASC
    `;

    if (bookings.length === 0) {
      return res.json({ ok: true, notified: 0, message: 'No upcoming lessons to notify' });
    }

    const mailer = createTransporter();
    let notified = 0;

    for (const b of bookings) {
      const learnerFirst = (b.learner_name || 'there').split(' ')[0];
      const lessonTime = b.start_time.slice(0, 5);
      const whatsappMsg = `Hi ${learnerFirst}, ${firstName} is running about ${delay} minutes late today. Your lesson at ${lessonTime} may start a little later than planned. Apologies for any inconvenience!`;

      // Send WhatsApp
      if (b.learner_phone) {
        await sendWhatsApp(b.learner_phone, whatsappMsg);
      }

      // Send email
      if (b.learner_email) {
        try {
          await mailer.sendMail({
            from: 'CoachCarter <system@coachcarter.uk>',
            to: b.learner_email,
            subject: `${firstName} is running late today`,
            html: `
              <h2>Hi ${learnerFirst},</h2>
              <p>${firstName} is running approximately <strong>${delay} minutes late</strong> today.</p>
              <p>Your lesson at <strong>${lessonTime}</strong> may start a little later than planned.</p>
              <p>Apologies for any inconvenience!</p>
              <p style="color:#888;font-size:0.85rem;">— CoachCarter</p>
            `
          });
        } catch (emailErr) {
          console.warn('Running late email failed for', b.learner_email, emailErr.message);
        }
      }

      notified++;
    }

    return res.json({ ok: true, notified });
  } catch (err) {
    console.error('running-late error:', err);
    reportError('/api/instructor', err);
    return res.status(500).json({ error: 'Failed to send notifications', details: 'Internal server error' });
  }
}
