// Admin authentication & dashboard data
//
// Routes:
//   POST /api/admin?action=login
//     → authenticate admin, return JWT
//
//   POST /api/admin?action=create-admin
//     → create a new admin user (requires ADMIN_SECRET or existing admin JWT)
//
//   GET  /api/admin?action=verify
//     → verify admin JWT is valid, return admin info
//
//   GET  /api/admin?action=dashboard-stats
//     → overview stats for admin dashboard (admin JWT required)
//
//   GET  /api/admin?action=all-bookings
//     → all bookings with learner/instructor info (admin JWT required)
//
//   POST /api/admin?action=mark-complete
//     → mark a booking as completed (admin JWT required)
//
//   GET  /api/admin?action=all-instructors
//     → all instructors including inactive (admin JWT required)
//
//   POST /api/admin?action=create-instructor
//     → create a new instructor account (admin JWT required)
//
//   POST /api/admin?action=update-instructor
//     → update instructor name/email/phone/bio/photo (admin JWT required)
//
//   POST /api/admin?action=toggle-instructor
//     → activate or deactivate an instructor account (admin JWT required)
//
//   GET  /api/admin?action=all-learners
//     → all learners with aggregated stats (admin JWT required)
//
//   GET  /api/admin?action=learner-detail
//     → booking history, credit transactions, progress for one learner (admin JWT required)
//
//   POST /api/admin?action=adjust-credits
//     → add or remove lesson credits for a learner (admin JWT required)

const { neon }   = require('@neondatabase/serverless');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const { reportError } = require('./_error-alert');
const { processAllPayouts, getEligibleBookings } = require('./_payout-helpers');
const { requireAuth, getSchoolId, verifyAdminSecret, isSuperAdmin } = require('./_auth');
const { createTransporter, generateToken } = require('./_auth-helpers');
const { logAudit } = require('./_audit');
const { checkRateLimit, getClientIp } = require('./_rate-limit');
const { extractPostcode, bulkGeocodeUK, estimateDriveMinutes } = require('./_travel-time');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Helper: derive schoolId from admin JWT (superadmins can pass ?school_id= to target a specific school)
function getAdminSchoolId(admin, req) {
  return (admin.school_id != null) ? admin.school_id : (parseInt(req.query?.school_id) || 1);
}

function setCors(res) {
}

// Verify admin JWT token (accepts admin/superadmin roles OR instructors with isAdmin flag)
function verifyAdminJWT(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  try {
    const payload = jwt.verify(auth.slice(7), secret);
    if (payload.role === 'admin' || payload.role === 'superadmin') return payload;
    if (payload.role === 'instructor' && payload.isAdmin === true) return payload;
    return null;
  } catch { return null; }
}

module.exports = async (req, res) => {
  setCors(res);
  const action = req.query.action;
  if (action === 'login')           return handleLogin(req, res);
  if (action === 'create-admin')    return handleCreateAdmin(req, res);
  if (action === 'verify')          return handleVerify(req, res);
  if (action === 'dashboard-stats') return handleDashboardStats(req, res);
  if (action === 'all-bookings')    return handleAllBookings(req, res);
  if (action === 'edit-booking')    return handleEditBooking(req, res);
  if (action === 'mark-complete')   return handleMarkComplete(req, res);
  if (action === 'all-instructors')   return handleAllInstructors(req, res);
  if (action === 'create-instructor') return handleCreateInstructor(req, res);
  if (action === 'update-instructor') return handleUpdateInstructor(req, res);
  if (action === 'toggle-instructor') return handleToggleInstructor(req, res);
  if (action === 'all-learners')      return handleAllLearners(req, res);
  if (action === 'learner-detail')    return handleLearnerDetail(req, res);
  if (action === 'adjust-credits')    return handleAdjustCredits(req, res);
  if (action === 'delete-learner')    return handleDeleteLearner(req, res);
  if (action === 'confirmation-details') return handleConfirmationDetails(req, res);
  if (action === 'resolve-dispute')      return handleResolveDispute(req, res);
  if (action === 'toggle-payout-pause')  return handleTogglePayoutPause(req, res);
  if (action === 'payout-overview')      return handlePayoutOverview(req, res);
  if (action === 'process-payouts')      return handleProcessPayouts(req, res);
  if (action === 'instructor-payout-history') return handleInstructorPayoutHistory(req, res);
  if (action === 'invite-learner')           return handleInviteLearner(req, res);
  if (action === 'instructor-blackouts')     return handleInstructorBlackouts(req, res);
  if (action === 'set-instructor-blackouts') return handleSetInstructorBlackouts(req, res);

  return res.status(400).json({ error: 'Unknown action' });
};

// ── POST /api/admin?action=login ──────────────────────────────────────────────
async function handleLogin(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password are required' });

  const secret = process.env.JWT_SECRET;
  if (!secret) return res.status(500).json({ error: 'JWT_SECRET not configured' });

  const sql = neon(process.env.POSTGRES_URL);
  const normalisedEmail = email.toLowerCase().trim();

  // Rate limiting: max 5 attempts per email per hour, 10 per IP per hour.
  // Counts ALL attempts (success + failure) so brute-forcing a known email is
  // blocked. See api/_rate-limit.js for the shared helper.
  const emailRl = await checkRateLimit(sql, {
    key: `admin_login_email:${normalisedEmail}`,
    max: 5,
    windowSeconds: 3600,
  });
  if (!emailRl.allowed) {
    return res.status(429).json({ error: 'Too many login attempts. Please try again later.' });
  }
  const ipRl = await checkRateLimit(sql, {
    key: `admin_login_ip:${getClientIp(req)}`,
    max: 10,
    windowSeconds: 3600,
  });
  if (!ipRl.allowed) {
    return res.status(429).json({ error: 'Too many login attempts. Please try again later.' });
  }

  try {
    const rows = await sql`
      SELECT id, name, email, password_hash, role, active, school_id
      FROM admin_users
      WHERE email = ${normalisedEmail} AND active = true
    `;
    if (rows.length === 0)
      return res.status(401).json({ error: 'Invalid email or password' });

    const admin = rows[0];
    const match = await bcrypt.compare(password, admin.password_hash);
    if (!match)
      return res.status(401).json({ error: 'Invalid email or password' });

    const token = jwt.sign(
      { id: admin.id, email: admin.email, role: admin.role, isAdmin: true, school_id: admin.school_id || null },
      secret,
      { expiresIn: '7d' }
    );

    return res.json({
      token,
      admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role, school_id: admin.school_id || null }
    });
  } catch (err) {
    console.error('admin login error:', err);
    reportError('/api/admin', err);
    return res.status(500).json({ error: 'Login failed', details: 'Internal server error' });
  }
}

// ── POST /api/admin?action=create-admin ───────────────────────────────────────
// Requires either ADMIN_SECRET or an existing admin JWT
async function handleCreateAdmin(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const adminJWT = verifyAdminJWT(req);
  const hasSecret = verifyAdminSecret(req);
  if (!adminJWT && !hasSecret)
    return res.status(401).json({ error: 'Unauthorised' });

  // Derive school_id: from JWT if available, otherwise from body or default to 1
  const schoolId = adminJWT
    ? getAdminSchoolId(adminJWT, req)
    : (parseInt(req.body?.school_id) || 1);

  const { name, email, password } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: 'name, email and password are required' });
  if (password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const existing = await sql`SELECT id FROM admin_users WHERE email = ${email.toLowerCase().trim()}`;
    if (existing.length > 0)
      return res.status(400).json({ error: 'An admin with this email already exists' });

    const hash = await bcrypt.hash(password, 10);
    const [admin] = await sql`
      INSERT INTO admin_users (name, email, password_hash, school_id)
      VALUES (${name.trim()}, ${email.toLowerCase().trim()}, ${hash}, ${schoolId})
      RETURNING id, name, email, role, active, created_at, school_id
    `;

    return res.status(201).json({ admin });
  } catch (err) {
    console.error('admin create error:', err);
    reportError('/api/admin', err);
    return res.status(500).json({ error: 'Failed to create admin', details: 'Internal server error' });
  }
}

// ── GET /api/admin?action=verify ──────────────────────────────────────────────
async function handleVerify(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Invalid or expired token' });

  return res.json({ valid: true, admin: { id: admin.id, email: admin.email, role: admin.role } });
}

// ── GET /api/admin?action=dashboard-stats ─────────────────────────────────────
async function handleDashboardStats(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = getAdminSchoolId(admin, req);

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Booking stats
    const bookingStats = await sql`
      SELECT
        COUNT(*)::int AS total_bookings,
        COUNT(*) FILTER (WHERE status = 'confirmed')::int AS confirmed,
        COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
        COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
        COUNT(*) FILTER (WHERE status = 'confirmed' AND scheduled_date >= CURRENT_DATE)::int AS upcoming,
        COUNT(*) FILTER (WHERE status = 'awaiting_confirmation')::int AS awaiting_confirmation,
        COUNT(*) FILTER (WHERE status = 'disputed')::int AS disputed,
        COUNT(*) FILTER (WHERE status = 'no_show')::int AS no_show
      FROM lesson_bookings
      WHERE school_id = ${schoolId}
    `;

    // Learner stats
    const learnerStats = await sql`
      SELECT
        COUNT(*)::int AS total_learners,
        COALESCE(SUM(credit_balance), 0)::int AS total_credits_held
      FROM learner_users
      WHERE school_id = ${schoolId}
    `;

    // Instructor stats
    const instructorStats = await sql`
      SELECT
        COUNT(*)::int AS total_instructors,
        COUNT(*) FILTER (WHERE active = true)::int AS active_instructors
      FROM instructors
      WHERE school_id = ${schoolId}
    `;

    // Revenue (from credit transactions)
    const revenueStats = await sql`
      SELECT
        COALESCE(SUM(amount_pence) FILTER (WHERE type = 'purchase'), 0)::int AS total_revenue_pence,
        COUNT(*) FILTER (WHERE type = 'purchase')::int AS total_purchases
      FROM credit_transactions
      WHERE school_id = ${schoolId}
    `;

    // Today's bookings
    const todayBookings = await sql`
      SELECT COUNT(*)::int AS today
      FROM lesson_bookings
      WHERE school_id = ${schoolId}
        AND scheduled_date = CURRENT_DATE AND status IN ('confirmed', 'completed', 'awaiting_confirmation')
    `;

    // This week's bookings
    const weekBookings = await sql`
      SELECT COUNT(*)::int AS this_week
      FROM lesson_bookings
      WHERE school_id = ${schoolId}
        AND scheduled_date BETWEEN CURRENT_DATE AND (CURRENT_DATE + INTERVAL '7 days')
        AND status IN ('confirmed', 'completed', 'awaiting_confirmation')
    `;

    return res.json({
      bookings: bookingStats[0],
      learners: learnerStats[0],
      instructors: instructorStats[0],
      revenue: revenueStats[0],
      today: todayBookings[0].today,
      this_week: weekBookings[0].this_week
    });
  } catch (err) {
    console.error('admin dashboard-stats error:', err);
    reportError('/api/admin', err);
    return res.status(500).json({ error: 'Failed to load stats', details: 'Internal server error' });
  }
}

// ── GET /api/admin?action=all-bookings ────────────────────────────────────────
async function handleAllBookings(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = getAdminSchoolId(admin, req);

  const { status, instructor_id, from, to } = req.query;

  // Use NULL-safe params so one query handles all filter combos without nested sql fragments
  const statusFilter     = status || null;
  const instructorFilter = instructor_id ? parseInt(instructor_id) : null;
  const fromFilter       = from || null;
  const toFilter         = to || null;

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const bookings = await sql`
      SELECT
        lb.id,
        lb.scheduled_date::text,
        lb.start_time::text,
        lb.end_time::text,
        lb.status,
        lb.cancelled_at,
        lb.credit_returned,
        lb.notes,
        lb.created_at,
        lb.lesson_type_id,
        lb.minutes_deducted,
        lb.edited_at,
        lt.name AS lesson_type_name,
        COALESCE(lt.duration_minutes, 90) AS duration_minutes,
        lu.id   AS learner_id,
        lu.name AS learner_name,
        lu.email AS learner_email,
        lu.phone AS learner_phone,
        i.id   AS instructor_id,
        i.name AS instructor_name,
        i.email AS instructor_email
      FROM lesson_bookings lb
      JOIN learner_users lu ON lu.id = lb.learner_id
      JOIN instructors i    ON i.id  = lb.instructor_id
      LEFT JOIN lesson_types lt ON lt.id = lb.lesson_type_id
      WHERE lb.school_id = ${schoolId}
        AND (${statusFilter}::text IS NULL OR lb.status = ${statusFilter})
        AND (${instructorFilter}::integer IS NULL OR lb.instructor_id = ${instructorFilter})
        AND (${fromFilter}::date IS NULL OR lb.scheduled_date >= ${fromFilter}::date)
        AND (${toFilter}::date IS NULL OR lb.scheduled_date <= ${toFilter}::date)
      ORDER BY lb.scheduled_date ASC, lb.start_time ASC
      LIMIT 200
    `;

    return res.json({ bookings });
  } catch (err) {
    console.error('admin all-bookings error:', err);
    reportError('/api/admin', err);
    return res.status(500).json({ error: 'Failed to load bookings', details: 'Internal server error' });
  }
}

// ── POST /api/admin?action=edit-booking ──────────────────────────────────────
// Body: { booking_id, scheduled_date?, start_time?, lesson_type_id? }
async function handleEditBooking(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = getAdminSchoolId(admin, req);

  const { booking_id, scheduled_date, start_time, lesson_type_id, force } = req.body;
  if (!booking_id) return res.status(400).json({ error: 'booking_id is required' });
  if (!scheduled_date && !start_time && !lesson_type_id)
    return res.status(400).json({ error: 'At least one field to edit is required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const [booking] = await sql`
      SELECT lb.id, lb.status, lb.learner_id, lb.instructor_id,
             lb.scheduled_date::text AS scheduled_date, lb.start_time::text AS start_time, lb.end_time::text AS end_time,
             lb.lesson_type_id, lb.minutes_deducted, lb.setmore_key,
             lu.name AS learner_name, lu.email AS learner_email, lu.balance_minutes,
             i.name AS instructor_name,
             COALESCE(i.buffer_minutes, 30) AS buffer_minutes,
             COALESCE(lt.duration_minutes, 90) AS type_duration_minutes
      FROM lesson_bookings lb
      JOIN learner_users lu ON lu.id = lb.learner_id
      JOIN instructors i ON i.id = lb.instructor_id
      LEFT JOIN lesson_types lt ON lt.id = lb.lesson_type_id
      WHERE lb.id = ${booking_id} AND lb.school_id = ${schoolId}
    `;
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (booking.status !== 'confirmed' && booking.status !== 'awaiting_confirmation')
      return res.status(400).json({ error: `Cannot edit a booking with status "${booking.status}"` });

    // Block lesson type change if already paid out
    if (lesson_type_id && lesson_type_id !== booking.lesson_type_id) {
      const [paidOut] = await sql`SELECT id FROM payout_line_items WHERE booking_id = ${booking_id}`;
      if (paidOut) return res.status(400).json({ error: 'Cannot change lesson type — booking already included in a payout' });
    }

    let newDate = scheduled_date || booking.scheduled_date;
    let newStartTime = start_time || String(booking.start_time).slice(0, 5);
    let newLessonTypeId = lesson_type_id || booking.lesson_type_id;
    let newDuration = parseInt(booking.type_duration_minutes) || 90;

    if (lesson_type_id && lesson_type_id !== booking.lesson_type_id) {
      const [newType] = await sql`SELECT duration_minutes FROM lesson_types WHERE id = ${lesson_type_id} AND school_id = ${schoolId}`;
      if (!newType) return res.status(404).json({ error: 'Lesson type not found or inactive' });
      newDuration = newType.duration_minutes;
    }

    const startParts = newStartTime.split(':').map(Number);
    const startMins = startParts[0] * 60 + startParts[1];
    const endMins = startMins + newDuration;
    const newEndTime = `${String(Math.floor(endMins / 60)).padStart(2, '0')}:${String(endMins % 60).padStart(2, '0')}`;

    // Overlap check with buffer — warn with details, allow force override
    const buffer = parseInt(booking.buffer_minutes) || 30;
    const conflicts = await sql`
      SELECT lb.id, lb.start_time::text AS start_time, lb.end_time::text AS end_time,
             lb.pickup_address, lu.name AS learner_name
      FROM lesson_bookings lb
      JOIN learner_users lu ON lu.id = lb.learner_id
      WHERE lb.instructor_id = ${booking.instructor_id}
        AND lb.scheduled_date = ${newDate}
        AND lb.id != ${booking_id}
        AND lb.status IN ('confirmed', 'completed', 'awaiting_confirmation')
        AND ${newStartTime}::time < (lb.end_time + (${buffer} || ' minutes')::interval)
        AND ${newEndTime}::time > lb.start_time
      ORDER BY lb.start_time
    `;
    if (conflicts.length > 0 && !force) {
      const conflictDetails = conflicts.map(c => ({
        id: c.id, learner_name: c.learner_name,
        time: c.start_time.slice(0,5) + ' – ' + c.end_time.slice(0,5)
      }));
      return res.status(409).json({
        error: 'conflict', message: 'This time overlaps with another booking',
        conflicts: conflictDetails, can_force: true
      });
    }

    // Credit/balance adjustment
    const oldMinutes = parseInt(booking.minutes_deducted) || 0;
    const delta = newDuration - oldMinutes;
    if (delta !== 0 && oldMinutes > 0) {
      if (delta > 0 && booking.balance_minutes < delta)
        return res.status(402).json({ error: `Learner has insufficient balance (needs ${delta} more minutes, has ${booking.balance_minutes})` });
      await sql`UPDATE learner_users SET balance_minutes = balance_minutes - ${delta} WHERE id = ${booking.learner_id}`;
      await sql`INSERT INTO credit_transactions (learner_id, type, minutes, credits, amount_pence, payment_method, school_id)
        VALUES (${booking.learner_id}, 'edit_adjustment', ${-delta}, 0, 0, 'edit', ${schoolId})`;
    }

    await sql`
      UPDATE lesson_bookings
      SET scheduled_date = ${newDate}, start_time = ${newStartTime}::time, end_time = ${newEndTime}::time,
          lesson_type_id = ${newLessonTypeId}, minutes_deducted = ${oldMinutes > 0 ? newDuration : 0},
          edited_at = NOW()
      WHERE id = ${booking_id}
    `;

    await logAudit(sql, {
      adminId: admin.id, adminEmail: admin.email, action: 'edit-booking',
      targetType: 'booking', targetId: booking_id,
      details: {
        old: { date: booking.scheduled_date, start: String(booking.start_time).slice(0,5), lesson_type_id: booking.lesson_type_id },
        new: { date: newDate, start: newStartTime, lesson_type_id: newLessonTypeId }
      },
      schoolId, req
    });

    // Email learner if time changed
    const timeChanged = newDate !== booking.scheduled_date ||
      newStartTime !== String(booking.start_time).slice(0, 5) ||
      newEndTime !== String(booking.end_time).slice(0, 5);

    if (timeChanged && booking.learner_email) {
      try {
        const mailer = createTransporter();
        const oldDateFmt = new Date(booking.scheduled_date + 'T00:00:00Z')
          .toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
        const newDateFmt = new Date(newDate + 'T00:00:00Z')
          .toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
        const firstName = (booking.learner_name || '').split(' ')[0] || 'there';
        const durationStr = newDuration >= 60
          ? (newDuration % 60 === 0 ? (newDuration/60) + ' hour' + (newDuration/60 !== 1 ? 's' : '') : (newDuration/60).toFixed(1) + ' hours')
          : newDuration + ' mins';
        await mailer.sendMail({
          from: 'CoachCarter <system@coachcarter.uk>',
          to: booking.learner_email,
          subject: `Lesson updated — now ${newDateFmt} at ${newStartTime}`,
          html: `<h2>Hi ${firstName},</h2>
            <p>Your lesson has been updated:</p>
            <table>
              <tr><td><strong>Was:</strong></td><td><s>${oldDateFmt} at ${String(booking.start_time).slice(0,5)}</s></td></tr>
              <tr><td><strong>Now:</strong></td><td>${newDateFmt} at ${newStartTime}</td></tr>
              <tr><td><strong>Duration:</strong></td><td>${durationStr}</td></tr>
            </table>
            <p style="margin:28px 0">
              <a href="https://coachcarter.uk/learner/book.html"
                 style="background:#f58321;color:white;padding:14px 28px;text-decoration:none;
                        border-radius:8px;display:inline-block;font-weight:bold;font-size:1rem;">
                View my bookings →
              </a>
            </p>`
        });
      } catch (emailErr) { console.error('Failed to send edit email:', emailErr); }
    }

    return res.json({ ok: true, booking_id });
  } catch (err) {
    console.error('admin edit-booking error:', err);
    reportError('/api/admin', err);
    return res.status(500).json({ error: 'Failed to edit booking', details: 'Internal server error' });
  }
}

// ── POST /api/admin?action=mark-complete ──────────────────────────────────────
async function handleMarkComplete(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = getAdminSchoolId(admin, req);

  const { booking_id } = req.body;
  if (!booking_id) return res.status(400).json({ error: 'booking_id required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const [booking] = await sql`
      SELECT id, status FROM lesson_bookings WHERE id = ${booking_id} AND school_id = ${schoolId}
    `;
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (!['confirmed', 'awaiting_confirmation', 'disputed'].includes(booking.status))
      return res.status(400).json({ error: `Cannot mark a "${booking.status}" booking as complete` });

    await sql`
      UPDATE lesson_bookings SET status = 'completed' WHERE id = ${booking_id}
    `;

    await logAudit(sql, { adminId: admin.id, adminEmail: admin.email, action: 'mark-complete', targetType: 'booking', targetId: booking_id, details: { previous_status: booking.status }, schoolId, req });

    return res.json({ success: true, booking_id });
  } catch (err) {
    console.error('admin mark-complete error:', err);
    reportError('/api/admin', err);
    return res.status(500).json({ error: 'Failed to mark complete', details: 'Internal server error' });
  }
}

// ── GET /api/admin?action=all-instructors ─────────────────────────────────────
// Returns ALL instructors (including inactive) for admin management
async function handleAllInstructors(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = getAdminSchoolId(admin, req);

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const instructors = await sql`
      SELECT
        i.id, i.name, i.email, i.phone, i.bio, i.photo_url, i.active, i.created_at,
        COALESCE(i.buffer_minutes, 30) AS buffer_minutes,
        i.max_travel_minutes,
        COALESCE(i.commission_rate, 0.85) AS commission_rate,
        i.weekly_franchise_fee_pence,
        (SELECT COUNT(*)::int FROM lesson_bookings lb
         WHERE lb.instructor_id = i.id AND lb.status = 'confirmed'
           AND lb.scheduled_date >= CURRENT_DATE AND lb.school_id = ${schoolId}) AS upcoming_bookings,
        (SELECT COUNT(*)::int FROM lesson_bookings lb
         WHERE lb.instructor_id = i.id AND lb.status = 'completed' AND lb.school_id = ${schoolId}) AS completed_lessons
      FROM instructors i
      WHERE i.school_id = ${schoolId}
      ORDER BY i.active DESC, i.name ASC
    `;

    // Get availability windows for each instructor (scoped via instructor join)
    const availability = await sql`
      SELECT ia.instructor_id, ia.id, ia.day_of_week, ia.start_time::text, ia.end_time::text, ia.active
      FROM instructor_availability ia
      JOIN instructors i ON i.id = ia.instructor_id
      WHERE ia.active = true AND i.school_id = ${schoolId}
      ORDER BY ia.instructor_id, ia.day_of_week, ia.start_time
    `;

    // Group availability by instructor
    const availByInstructor = {};
    for (const w of availability) {
      if (!availByInstructor[w.instructor_id]) availByInstructor[w.instructor_id] = [];
      availByInstructor[w.instructor_id].push(w);
    }

    const result = instructors.map(i => ({
      ...i,
      availability: availByInstructor[i.id] || []
    }));

    return res.json({ instructors: result });
  } catch (err) {
    console.error('admin all-instructors error:', err);
    reportError('/api/admin', err);
    return res.status(500).json({ error: 'Failed to load instructors', details: 'Internal server error' });
  }
}

// ── POST /api/admin?action=create-instructor ───────────────────────────────────
async function handleCreateInstructor(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = getAdminSchoolId(admin, req);

  const { name, email, phone, bio, photo_url } = req.body || {};
  if (!name || !email) return res.status(400).json({ error: 'Name and email are required' });

  const normalised = email.trim().toLowerCase();

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Check for duplicate email within same school
    const existing = await sql`SELECT id FROM instructors WHERE email = ${normalised} AND school_id = ${schoolId}`;
    if (existing.length > 0) return res.status(409).json({ error: 'An instructor with that email already exists' });

    const rows = await sql`
      INSERT INTO instructors (name, email, phone, bio, photo_url, active, school_id)
      VALUES (
        ${name.trim()},
        ${normalised},
        ${phone?.trim() || null},
        ${bio?.trim() || null},
        ${photo_url?.trim() || null},
        true,
        ${schoolId}
      )
      RETURNING id, name, email, phone, bio, photo_url, active, created_at
    `;

    const instructor = rows[0];

    // Send invite email with magic link
    try {
      const token = generateToken();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      await sql`
        INSERT INTO instructor_login_tokens (instructor_id, token, expires_at, school_id)
        VALUES (${instructor.id}, ${token}, ${expiresAt.toISOString()}, ${schoolId})
      `;

      // Get school name
      const [school] = await sql`SELECT name FROM schools WHERE id = ${schoolId}`;
      const schoolName = school?.name || 'your driving school';

      const baseUrl = process.env.BASE_URL || 'https://coachcarter.uk';
      const inviteLink = `${baseUrl}/instructor/login.html?token=${token}`;
      const firstName = name.trim().split(' ')[0] || 'there';
      const mailer = createTransporter();

      await mailer.sendMail({
        from:    `${schoolName} <system@coachcarter.uk>`,
        to:      normalised,
        subject: `You've been added as an instructor at ${schoolName}`,
        html: `
          <h2>Hi ${firstName},</h2>
          <p>You've been added as an instructor at <strong>${schoolName}</strong> on CoachCarter.</p>
          <p>Click the button below to sign in and set up your profile.</p>
          <p style="margin:28px 0">
            <a href="${inviteLink}"
               style="background:#f58321;color:white;padding:14px 28px;text-decoration:none;
                      border-radius:8px;display:inline-block;font-weight:bold;font-size:1rem;">
              Set up my profile &rarr;
            </a>
          </p>
          <p style="color:#888;font-size:0.85em">This link expires in 7 days. If you didn't expect this email, you can safely ignore it.</p>
        `
      });
    } catch (emailErr) {
      // Don't fail the whole request if email fails — instructor was still created
      console.error('Failed to send instructor invite email:', emailErr.message);
    }

    await logAudit(sql, { adminId: admin.id, adminEmail: admin.email, action: 'create-instructor', targetType: 'instructor', targetId: instructor.id, details: { name: instructor.name, email: instructor.email }, schoolId, req });

    return res.status(201).json({ success: true, instructor, invite_sent: true });
  } catch (err) {
    console.error('admin create-instructor error:', err);
    reportError('/api/admin', err);
    return res.status(500).json({ error: 'Failed to create instructor', details: 'Internal server error' });
  }
}

// ── POST /api/admin?action=update-instructor ───────────────────────────────────
async function handleUpdateInstructor(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = getAdminSchoolId(admin, req);

  const { id, name, email, phone, bio, photo_url } = req.body || {};
  if (!id) return res.status(400).json({ error: 'Instructor ID is required' });
  if (!name || !email) return res.status(400).json({ error: 'Name and email are required' });

  const normalised = email.trim().toLowerCase();

  // Handle fee model fields
  const body = req.body || {};
  const hasCommission = 'commission_rate' in body;
  const hasFranchiseFee = 'weekly_franchise_fee_pence' in body;

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Check email not taken by another instructor in same school
    const conflict = await sql`
      SELECT id FROM instructors WHERE email = ${normalised} AND id != ${id} AND school_id = ${schoolId}
    `;
    if (conflict.length > 0) return res.status(409).json({ error: 'That email is already used by another instructor' });

    const rows = await sql`
      UPDATE instructors
      SET name      = ${name.trim()},
          email     = ${normalised},
          phone     = ${phone?.trim() || null},
          bio       = ${bio?.trim() || null},
          photo_url = ${photo_url?.trim() || null},
          commission_rate = CASE WHEN ${hasCommission} THEN ${hasCommission ? (parseFloat(body.commission_rate) || 0.85) : 0.85} ELSE commission_rate END,
          weekly_franchise_fee_pence = CASE WHEN ${hasFranchiseFee} THEN ${hasFranchiseFee ? body.weekly_franchise_fee_pence : null}::integer ELSE weekly_franchise_fee_pence END
      WHERE id = ${id} AND school_id = ${schoolId}
      RETURNING id, name, email, phone, bio, photo_url, active, commission_rate, weekly_franchise_fee_pence
    `;

    if (rows.length === 0) return res.status(404).json({ error: 'Instructor not found' });

    await logAudit(sql, { adminId: admin.id, adminEmail: admin.email, action: 'update-instructor', targetType: 'instructor', targetId: id, details: { name: name.trim(), email: normalised }, schoolId, req });

    return res.json({ success: true, instructor: rows[0] });
  } catch (err) {
    console.error('admin update-instructor error:', err);
    reportError('/api/admin', err);
    return res.status(500).json({ error: 'Failed to update instructor', details: 'Internal server error' });
  }
}

// ── POST /api/admin?action=toggle-instructor ───────────────────────────────────
async function handleToggleInstructor(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = getAdminSchoolId(admin, req);

  const { id, active } = req.body || {};
  if (id === undefined || active === undefined) return res.status(400).json({ error: 'id and active are required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const rows = await sql`
      UPDATE instructors SET active = ${!!active} WHERE id = ${id} AND school_id = ${schoolId}
      RETURNING id, name, active
    `;

    if (rows.length === 0) return res.status(404).json({ error: 'Instructor not found' });

    await logAudit(sql, { adminId: admin.id, adminEmail: admin.email, action: 'toggle-instructor', targetType: 'instructor', targetId: id, details: { active: !!active, name: rows[0].name }, schoolId, req });

    return res.json({ success: true, instructor: rows[0] });
  } catch (err) {
    console.error('admin toggle-instructor error:', err);
    reportError('/api/admin', err);
    return res.status(500).json({ error: 'Failed to update instructor', details: 'Internal server error' });
  }
}

// ── GET /api/admin?action=all-learners ──────────────────────────────────────
// Returns ALL learners with aggregated booking/session stats
async function handleAllLearners(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = getAdminSchoolId(admin, req);

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const learners = await sql`
      SELECT
        lu.id, lu.name, lu.email, lu.phone,
        lu.current_tier, lu.credit_balance, lu.balance_minutes,
        lu.pickup_address, lu.prefer_contact_before,
        lu.created_at,
        (SELECT COUNT(*)::int FROM lesson_bookings lb
         WHERE lb.learner_id = lu.id AND lb.school_id = ${schoolId}) AS total_bookings,
        (SELECT COUNT(*)::int FROM lesson_bookings lb
         WHERE lb.learner_id = lu.id AND lb.status = 'confirmed'
           AND lb.scheduled_date >= CURRENT_DATE AND lb.school_id = ${schoolId}) AS upcoming_bookings,
        (SELECT MAX(lb.scheduled_date)::text FROM lesson_bookings lb
         WHERE lb.learner_id = lu.id AND lb.school_id = ${schoolId}) AS last_booking_date,
        (SELECT COUNT(*)::int FROM driving_sessions ds
         WHERE ds.user_id = lu.id AND ds.school_id = ${schoolId}) AS total_sessions
      FROM learner_users lu
      WHERE lu.school_id = ${schoolId}
      ORDER BY lu.created_at DESC
    `;

    return res.json({ learners });
  } catch (err) {
    console.error('admin all-learners error:', err);
    reportError('/api/admin', err);
    return res.status(500).json({ error: 'Failed to load learners', details: 'Internal server error' });
  }
}

// ── GET /api/admin?action=learner-detail ────────────────────────────────────
// Returns booking history, credit transactions, and progress for one learner
async function handleLearnerDetail(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = getAdminSchoolId(admin, req);

  const learnerId = parseInt(req.query.learner_id);
  if (!learnerId) return res.status(400).json({ error: 'learner_id is required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Verify learner belongs to this school
    const [learnerCheck] = await sql`SELECT id FROM learner_users WHERE id = ${learnerId} AND school_id = ${schoolId}`;
    if (!learnerCheck) return res.status(404).json({ error: 'Learner not found' });

    const bookings = await sql`
      SELECT
        lb.id,
        lb.scheduled_date::text,
        lb.start_time::text,
        lb.end_time::text,
        lb.status,
        lb.notes,
        lb.created_at,
        i.name AS instructor_name
      FROM lesson_bookings lb
      JOIN instructors i ON i.id = lb.instructor_id
      WHERE lb.learner_id = ${learnerId} AND lb.school_id = ${schoolId}
      ORDER BY lb.scheduled_date DESC, lb.start_time DESC
    `;

    const transactions = await sql`
      SELECT id, type, credits, amount_pence, payment_method, created_at
      FROM credit_transactions
      WHERE learner_id = ${learnerId} AND school_id = ${schoolId}
      ORDER BY created_at DESC
    `;

    const progress = await sql`
      SELECT
        COUNT(*)::int AS total_sessions,
        COALESCE(SUM(duration_minutes), 0)::int AS total_minutes
      FROM driving_sessions
      WHERE user_id = ${learnerId} AND school_id = ${schoolId}
    `;

    return res.json({
      bookings,
      transactions,
      progress: progress[0] || { total_sessions: 0, total_minutes: 0 }
    });
  } catch (err) {
    console.error('admin learner-detail error:', err);
    reportError('/api/admin', err);
    return res.status(500).json({ error: 'Failed to load learner details', details: 'Internal server error' });
  }
}

// ── POST /api/admin?action=adjust-credits ─────────────────────────────────────
// Body: { learner_id, hours: float (e.g. 1.5), reason }
// Positive = add, negative = remove. Updates balance_minutes (primary) + credit_balance (legacy).
async function handleAdjustCredits(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Admin auth required' });
  const schoolId = getAdminSchoolId(admin, req);

  const { learner_id, hours, reason } = req.body;
  if (!learner_id || hours === undefined || hours === 0)
    return res.status(400).json({ error: 'learner_id and non-zero hours are required' });

  const hoursFloat = parseFloat(hours);
  if (isNaN(hoursFloat) || hoursFloat === 0)
    return res.status(400).json({ error: 'hours must be a non-zero number' });

  const minutesDelta = Math.round(hoursFloat * 60);

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Check learner exists and belongs to this school
    const [learner] = await sql`SELECT id, balance_minutes, credit_balance FROM learner_users WHERE id = ${learner_id} AND school_id = ${schoolId}`;
    if (!learner) return res.status(404).json({ error: 'Learner not found' });

    // Prevent negative balance
    const newMinutes = (learner.balance_minutes || 0) + minutesDelta;
    if (newMinutes < 0)
      return res.status(400).json({ error: 'Cannot reduce below 0. Current balance: ' + Math.round((learner.balance_minutes || 0) / 60 * 10) / 10 + ' hours' });

    // Update both balance_minutes (primary) and credit_balance (legacy dual-write)
    const creditsDelta    = Math.round(hoursFloat);
    const newCreditBal    = Math.max(0, (learner.credit_balance || 0) + creditsDelta);
    const [updated] = await sql`
      UPDATE learner_users
      SET balance_minutes = balance_minutes + ${minutesDelta},
          credit_balance  = ${newCreditBal}
      WHERE id = ${learner_id}
      RETURNING balance_minutes, credit_balance
    `;

    // Log transaction (best-effort — don't fail the request if this errors)
    try {
      await sql`
        INSERT INTO credit_transactions (learner_id, type, credits, minutes, amount_pence, payment_method, school_id)
        VALUES (${learner_id}, ${minutesDelta > 0 ? 'admin_add' : 'admin_remove'}, ${creditsDelta}, ${minutesDelta}, 0, ${reason || 'Admin adjustment'}, ${schoolId})
      `;
    } catch (txErr) {
      console.error('admin adjust-credits transaction log failed:', txErr.message);
    }

    await logAudit(sql, { adminId: admin.id, adminEmail: admin.email, action: 'adjust-credits', targetType: 'learner', targetId: learner_id, details: { hours: hoursFloat, reason, previous: learner.balance_minutes || 0, new: updated.balance_minutes }, schoolId, req });

    return res.json({
      ok: true,
      previous_balance_minutes: learner.balance_minutes || 0,
      new_balance_minutes: updated.balance_minutes,
      adjusted_hours: hoursFloat
    });
  } catch (err) {
    console.error('admin adjust-credits error:', err.message, err.stack);
    reportError('/api/admin', err);
    return res.status(500).json({ error: 'Failed to adjust hours', details: 'Internal server error' });
  }
}

// ── POST /api/admin?action=delete-learner ────────────────────────────────────
// Body: { learner_id }
// Deletes a learner and all their associated data.
async function handleDeleteLearner(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Admin auth required' });
  const schoolId = getAdminSchoolId(admin, req);

  const { learner_id } = req.body;
  if (!learner_id) return res.status(400).json({ error: 'learner_id is required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Verify learner exists and belongs to this school
    const [learner] = await sql`SELECT id, name, email FROM learner_users WHERE id = ${learner_id} AND school_id = ${schoolId}`;
    if (!learner) return res.status(404).json({ error: 'Learner not found' });

    // Delete associated data (order matters for foreign keys)
    // Anonymize credit transactions (7-year tax retention)
    try { await sql`UPDATE credit_transactions SET learner_id = NULL, anonymized = true WHERE learner_id = ${learner_id}`; } catch (e) { console.warn('anonymize credit_transactions skipped:', e.message); }
    try { await sql`DELETE FROM skill_ratings WHERE user_id = ${learner_id}`; } catch (e) { console.warn('delete skill_ratings skipped:', e.message); }
    try { await sql`DELETE FROM driving_sessions WHERE user_id = ${learner_id}`; } catch (e) { console.warn('delete driving_sessions skipped:', e.message); }
    try { await sql`DELETE FROM lesson_bookings WHERE learner_id = ${learner_id}`; } catch (e) { console.warn('delete lesson_bookings skipped:', e.message); }
    try { await sql`DELETE FROM qa_questions WHERE learner_id = ${learner_id}`; } catch (e) { console.warn('delete qa_questions skipped:', e.message); }

    // Delete the learner
    await sql`DELETE FROM learner_users WHERE id = ${learner_id}`;

    await logAudit(sql, { adminId: admin.id, adminEmail: admin.email, action: 'delete-learner', targetType: 'learner', targetId: learner_id, details: { name: learner.name, email: learner.email }, schoolId, req });

    return res.json({ success: true, deleted: { id: learner.id, name: learner.name, email: learner.email } });
  } catch (err) {
    console.error('admin delete-learner error:', err);
    reportError('/api/admin', err);
    return res.status(500).json({ error: 'Failed to delete learner', details: 'Internal server error' });
  }
}

// ── GET /api/admin?action=confirmation-details&booking_id=X ──────────────────
// Returns both confirmation records for a booking (admin can see both sides).
async function handleConfirmationDetails(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = getAdminSchoolId(admin, req);

  const booking_id = req.query.booking_id;
  if (!booking_id) return res.status(400).json({ error: 'booking_id required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const [booking] = await sql`
      SELECT lb.id, lb.status, lb.scheduled_date::text, lb.start_time::text, lb.end_time::text,
             lb.instructor_notes,
             lu.name AS learner_name, lu.email AS learner_email,
             i.name AS instructor_name, i.email AS instructor_email
      FROM lesson_bookings lb
      JOIN learner_users lu ON lu.id = lb.learner_id
      JOIN instructors i ON i.id = lb.instructor_id
      WHERE lb.id = ${booking_id} AND lb.school_id = ${schoolId}
    `;
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    const confirmations = await sql`
      SELECT confirmed_by_role, lesson_happened, late_party, late_minutes, notes, auto_confirmed, created_at
      FROM lesson_confirmations
      WHERE booking_id = ${booking_id}
      ORDER BY confirmed_by_role
    `;

    const instructor = confirmations.find(c => c.confirmed_by_role === 'instructor') || null;
    const learner    = confirmations.find(c => c.confirmed_by_role === 'learner') || null;

    return res.json({ booking, instructor_confirmation: instructor, learner_confirmation: learner });
  } catch (err) {
    console.error('admin confirmation-details error:', err);
    reportError('/api/admin', err);
    return res.status(500).json({ error: 'Failed to load confirmation details' });
  }
}

// ── POST /api/admin?action=resolve-dispute ───────────────────────────────────
// Body: { booking_id, resolution } where resolution is 'completed', 'no_show', or 'cancelled'
// Admin manually overrides the status of a disputed or awaiting_confirmation booking.
async function handleResolveDispute(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = getAdminSchoolId(admin, req);

  const { booking_id, resolution } = req.body;
  if (!booking_id) return res.status(400).json({ error: 'booking_id required' });
  if (!['completed', 'no_show', 'cancelled'].includes(resolution))
    return res.status(400).json({ error: 'resolution must be completed, no_show, or cancelled' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const [booking] = await sql`
      SELECT id, status FROM lesson_bookings WHERE id = ${booking_id} AND school_id = ${schoolId}
    `;
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (!['disputed', 'awaiting_confirmation', 'no_show'].includes(booking.status))
      return res.status(400).json({ error: `Cannot resolve a booking with status "${booking.status}"` });

    await sql`
      UPDATE lesson_bookings SET status = ${resolution} WHERE id = ${booking_id}
    `;

    return res.json({ success: true, booking_id, previous_status: booking.status, new_status: resolution });
  } catch (err) {
    console.error('admin resolve-dispute error:', err);
    reportError('/api/admin', err);
    return res.status(500).json({ error: 'Failed to resolve dispute' });
  }
}

// ── POST /api/admin?action=toggle-payout-pause ──
async function handleTogglePayoutPause(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Admin auth required' });
  const schoolId = getAdminSchoolId(admin, req);

  try {
    const { instructor_id, paused } = req.body || {};
    if (!instructor_id || typeof paused !== 'boolean')
      return res.status(400).json({ error: 'instructor_id and paused (boolean) required' });

    const sql = neon(process.env.POSTGRES_URL);
    const [updated] = await sql`
      UPDATE instructors SET payouts_paused = ${paused} WHERE id = ${instructor_id} AND school_id = ${schoolId} RETURNING id, name
    `;
    if (!updated) return res.status(404).json({ error: 'Instructor not found' });

    return res.json({ ok: true, instructor_id: updated.id, name: updated.name, payouts_paused: paused });
  } catch (err) {
    console.error('toggle-payout-pause error:', err);
    reportError('/api/admin', err);
    return res.status(500).json({ error: 'Failed to toggle payout pause' });
  }
}

// ── GET /api/admin?action=payout-overview ──
// Returns all instructors' connect status, upcoming payout estimates, and recent payouts.
async function handlePayoutOverview(req, res) {
  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Admin auth required' });
  const schoolId = getAdminSchoolId(admin, req);

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Instructor connect statuses
    const instructors = await sql`
      SELECT id, name, email, active, commission_rate, weekly_franchise_fee_pence,
             stripe_account_id, stripe_onboarding_complete, payouts_paused
        FROM instructors WHERE school_id = ${schoolId} ORDER BY name ASC
    `;

    // Upcoming payout estimates per instructor
    const estimates = [];
    for (const inst of instructors) {
      if (!inst.active || !inst.stripe_onboarding_complete) continue;
      const bookings = await getEligibleBookings(sql, inst.id);
      if (!bookings.length) continue;

      const franchiseFee = inst.weekly_franchise_fee_pence != null ? parseInt(inst.weekly_franchise_fee_pence) : null;
      let grossPence = 0;
      for (const b of bookings) grossPence += parseInt(b.price_pence);

      let estimatedPence;
      if (franchiseFee != null) {
        estimatedPence = grossPence - Math.min(franchiseFee, grossPence);
      } else {
        const rate = parseFloat(inst.commission_rate) || 0.85;
        estimatedPence = 0;
        for (const b of bookings) estimatedPence += Math.round(parseInt(b.price_pence) * rate);
      }

      estimates.push({
        instructor_id: inst.id,
        name: inst.name,
        eligible_lessons: bookings.length,
        estimated_pence: estimatedPence,
        paused: inst.payouts_paused,
        fee_model: franchiseFee != null ? 'franchise' : 'commission'
      });
    }

    // Recent payouts (scoped via instructor school_id)
    const recentPayouts = await sql`
      SELECT ip.id, ip.instructor_id, i.name AS instructor_name,
             ip.amount_pence, ip.status, ip.period_start, ip.period_end,
             ip.created_at, ip.completed_at,
             (SELECT COUNT(*) FROM payout_line_items WHERE payout_id = ip.id) AS lesson_count
        FROM instructor_payouts ip
        JOIN instructors i ON i.id = ip.instructor_id
       WHERE i.school_id = ${schoolId}
       ORDER BY ip.created_at DESC
       LIMIT 20
    `;

    // Summary stats (scoped via instructor school_id)
    const [stats] = await sql`
      SELECT
        COALESCE(SUM(ip.amount_pence) FILTER (WHERE ip.status = 'completed'
          AND ip.completed_at >= date_trunc('month', CURRENT_DATE)), 0)::int AS this_month_pence,
        COALESCE(SUM(ip.amount_pence) FILTER (WHERE ip.status = 'completed'), 0)::int AS all_time_pence,
        COUNT(*) FILTER (WHERE ip.status = 'completed')::int AS total_payouts
      FROM instructor_payouts ip
      JOIN instructors i ON i.id = ip.instructor_id
      WHERE i.school_id = ${schoolId}
    `;

    return res.json({
      ok: true,
      instructors: instructors.map(i => ({
        id: i.id, name: i.name, email: i.email, active: i.active,
        commission_rate: i.commission_rate,
        weekly_franchise_fee_pence: i.weekly_franchise_fee_pence,
        fee_model: i.weekly_franchise_fee_pence != null ? 'franchise' : 'commission',
        connect_status: !i.stripe_account_id ? 'not_started'
          : i.stripe_onboarding_complete ? 'active' : 'pending',
        payouts_paused: i.payouts_paused
      })),
      estimates,
      recent_payouts: recentPayouts,
      stats
    });
  } catch (err) {
    console.error('payout-overview error:', err);
    reportError('/api/admin', err);
    return res.status(500).json({ error: 'Failed to load payout overview' });
  }
}

// ── POST /api/admin?action=process-payouts ──
// Manual trigger for payout processing (same logic as cron).
async function handleProcessPayouts(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Admin auth required' });
  const schoolId = getAdminSchoolId(admin, req);

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const results = await processAllPayouts(sql, stripe, { schoolId });

    return res.json({
      ok: true,
      processed: results.processed,
      skipped: results.skipped,
      failed: results.failed,
      total_transferred_pence: results.total_pence,
      details: results.details
    });
  } catch (err) {
    console.error('process-payouts error:', err);
    reportError('/api/admin', err);
    return res.status(500).json({ error: 'Failed to process payouts' });
  }
}

// ── GET /api/admin?action=instructor-payout-history&instructor_id=X ──
async function handleInstructorPayoutHistory(req, res) {
  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Admin auth required' });
  const schoolId = getAdminSchoolId(admin, req);

  try {
    const instructorId = parseInt(req.query.instructor_id);
    if (!instructorId) return res.status(400).json({ error: 'instructor_id required' });

    const sql = neon(process.env.POSTGRES_URL);

    // Verify instructor belongs to this school
    const [instCheck] = await sql`SELECT id FROM instructors WHERE id = ${instructorId} AND school_id = ${schoolId}`;
    if (!instCheck) return res.status(404).json({ error: 'Instructor not found' });

    const payouts = await sql`
      SELECT ip.id, ip.amount_pence, ip.platform_fee_pence, ip.stripe_transfer_id,
             ip.period_start, ip.period_end, ip.status, ip.failure_reason,
             ip.created_at, ip.completed_at
        FROM instructor_payouts ip
       WHERE ip.instructor_id = ${instructorId}
       ORDER BY ip.created_at DESC
       LIMIT 52
    `;

    // For each payout, get line items
    for (const p of payouts) {
      p.line_items = await sql`
        SELECT pli.booking_id, pli.price_pence, pli.instructor_amount_pence, pli.commission_rate,
               lb.scheduled_date, lb.start_time, lb.end_time, lb.status AS booking_status,
               COALESCE(lt.name, 'Standard Lesson') AS lesson_type
          FROM payout_line_items pli
          JOIN lesson_bookings lb ON lb.id = pli.booking_id
          LEFT JOIN lesson_types lt ON lt.id = lb.lesson_type_id
         WHERE pli.payout_id = ${p.id}
         ORDER BY lb.scheduled_date ASC
      `;
    }

    return res.json({ ok: true, payouts });
  } catch (err) {
    console.error('instructor-payout-history error:', err);
    reportError('/api/admin', err);
    return res.status(500).json({ error: 'Failed to load payout history' });
  }
}

// ── POST /api/admin?action=invite-learner ─────────────────────────────────────
async function handleInviteLearner(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = getAdminSchoolId(admin, req);

  const { email, phone, name } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email is required' });

  const normalised = email.trim().toLowerCase();

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Check if learner already exists in this school
    const existing = await sql`
      SELECT id FROM learner_users
      WHERE LOWER(email) = ${normalised} AND school_id = ${schoolId}
    `;
    if (existing.length > 0) {
      return res.status(409).json({ error: 'A learner with that email already exists in this school' });
    }

    // Create learner row
    const [learner] = await sql`
      INSERT INTO learner_users (email, name, phone, credit_balance, balance_minutes, school_id)
      VALUES (${normalised}, ${name?.trim() || null}, ${phone?.trim() || null}, 0, 0, ${schoolId})
      RETURNING id
    `;

    // Generate magic link token with 7-day expiry
    const token = generateToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await sql`
      INSERT INTO magic_link_tokens (token, email, method, expires_at)
      VALUES (${token}, ${normalised}, 'email', ${expiresAt.toISOString()})
    `;

    // Get school name for email
    const [school] = await sql`SELECT name FROM schools WHERE id = ${schoolId}`;
    const schoolName = school?.name || 'your driving school';

    // Send invite email
    const baseUrl = process.env.BASE_URL || 'https://coachcarter.uk';
    const inviteLink = `${baseUrl}/learner/login.html?token=${token}`;
    const firstName = (name || '').split(' ')[0] || 'there';
    const mailer = createTransporter();

    await mailer.sendMail({
      from:    `${schoolName} <system@coachcarter.uk>`,
      to:      normalised,
      subject: `You've been invited to ${schoolName}`,
      html: `
        <h2>Hi ${firstName},</h2>
        <p>You've been invited to join <strong>${schoolName}</strong> on CoachCarter.</p>
        <p>Click the button below to set up your account and start booking lessons.</p>
        <p style="margin:28px 0">
          <a href="${inviteLink}"
             style="background:#f58321;color:white;padding:14px 28px;text-decoration:none;
                    border-radius:8px;display:inline-block;font-weight:bold;font-size:1rem;">
            Set up my account &rarr;
          </a>
        </p>
        <p style="color:#888;font-size:0.85em">This link expires in 7 days. If you didn't expect this email, you can safely ignore it.</p>
      `
    });

    return res.status(201).json({ ok: true, learner_id: learner.id, invite_sent: true });
  } catch (err) {
    console.error('invite-learner error:', err);
    reportError('/api/admin', err);
    return res.status(500).json({ error: 'Failed to invite learner', details: 'Internal server error' });
  }
}

// ── GET /api/admin?action=instructor-blackouts&instructor_id=X ───────────────
async function handleInstructorBlackouts(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorised' });

  const instructorId = parseInt(req.query.instructor_id, 10);
  if (!instructorId) return res.status(400).json({ error: 'instructor_id required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const dates = await sql`
      SELECT id, blackout_date::text AS start_date, end_date::text, reason
      FROM instructor_blackout_dates
      WHERE instructor_id = ${instructorId}
        AND end_date >= CURRENT_DATE
      ORDER BY blackout_date ASC
    `;
    return res.json({ blackout_dates: dates });
  } catch (err) {
    console.error('instructor-blackouts error:', err);
    reportError('/api/admin', err);
    return res.status(500).json({ error: 'Failed to load blackout dates' });
  }
}

// ── POST /api/admin?action=set-instructor-blackouts ──────────────────────────
// Body: { instructor_id, ranges: [{ start_date, end_date, reason? }] }
async function handleSetInstructorBlackouts(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorised' });

  const { instructor_id, ranges } = req.body;
  if (!instructor_id) return res.status(400).json({ error: 'instructor_id required' });
  if (!Array.isArray(ranges)) return res.status(400).json({ error: 'ranges must be an array' });

  const dateRx = /^\d{4}-\d{2}-\d{2}$/;
  for (const r of ranges) {
    if (!r.start_date || !dateRx.test(r.start_date))
      return res.status(400).json({ error: `Invalid start_date: ${r.start_date}. Use YYYY-MM-DD` });
    if (!r.end_date || !dateRx.test(r.end_date))
      return res.status(400).json({ error: `Invalid end_date: ${r.end_date}. Use YYYY-MM-DD` });
    if (r.end_date < r.start_date)
      return res.status(400).json({ error: 'end_date must be >= start_date' });
    const diffMs = new Date(r.end_date) - new Date(r.start_date);
    if (diffMs > 365 * 86400000)
      return res.status(400).json({ error: 'Range cannot exceed 365 days' });
  }

  // Check for overlapping ranges
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
      WHERE instructor_id = ${instructor_id}
        AND end_date >= CURRENT_DATE
    `;

    // Insert new ranges
    for (const r of ranges) {
      await sql`
        INSERT INTO instructor_blackout_dates (instructor_id, blackout_date, end_date, reason)
        VALUES (${instructor_id}, ${r.start_date}, ${r.end_date}, ${r.reason || null})
      `;
    }

    const saved = await sql`
      SELECT id, blackout_date::text AS start_date, end_date::text, reason
      FROM instructor_blackout_dates
      WHERE instructor_id = ${instructor_id}
        AND end_date >= CURRENT_DATE
      ORDER BY blackout_date ASC
    `;

    return res.json({ ok: true, blackout_dates: saved });
  } catch (err) {
    console.error('set-instructor-blackouts error:', err);
    reportError('/api/admin', err);
    return res.status(500).json({ error: 'Failed to save blackout dates' });
  }
}
