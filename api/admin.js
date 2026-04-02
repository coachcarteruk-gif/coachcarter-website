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
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Admin-Secret');
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

// Verify legacy ADMIN_SECRET
function verifyAdminSecret(req) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;
  return (req.body?.admin_secret === secret) ||
         (req.headers['x-admin-secret'] === secret);
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const action = req.query.action;
  if (action === 'login')           return handleLogin(req, res);
  if (action === 'create-admin')    return handleCreateAdmin(req, res);
  if (action === 'verify')          return handleVerify(req, res);
  if (action === 'dashboard-stats') return handleDashboardStats(req, res);
  if (action === 'all-bookings')    return handleAllBookings(req, res);
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

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const rows = await sql`
      SELECT * FROM admin_users
      WHERE email = ${email.toLowerCase().trim()} AND active = true
    `;
    if (rows.length === 0)
      return res.status(401).json({ error: 'Invalid email or password' });

    const admin = rows[0];
    const match = await bcrypt.compare(password, admin.password_hash);
    if (!match)
      return res.status(401).json({ error: 'Invalid email or password' });

    const token = jwt.sign(
      { id: admin.id, email: admin.email, role: admin.role, isAdmin: true },
      secret,
      { expiresIn: '7d' }
    );

    return res.json({
      token,
      admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role }
    });
  } catch (err) {
    console.error('admin login error:', err);
    reportError('/api/admin', err);
    return res.status(500).json({ error: 'Login failed', details: err.message });
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
      INSERT INTO admin_users (name, email, password_hash)
      VALUES (${name.trim()}, ${email.toLowerCase().trim()}, ${hash})
      RETURNING id, name, email, role, active, created_at
    `;

    return res.status(201).json({ admin });
  } catch (err) {
    console.error('admin create error:', err);
    reportError('/api/admin', err);
    return res.status(500).json({ error: 'Failed to create admin', details: err.message });
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
    `;

    // Learner stats
    const learnerStats = await sql`
      SELECT
        COUNT(*)::int AS total_learners,
        COALESCE(SUM(credit_balance), 0)::int AS total_credits_held
      FROM learner_users
    `;

    // Instructor stats
    const instructorStats = await sql`
      SELECT
        COUNT(*)::int AS total_instructors,
        COUNT(*) FILTER (WHERE active = true)::int AS active_instructors
      FROM instructors
    `;

    // Revenue (from credit transactions)
    const revenueStats = await sql`
      SELECT
        COALESCE(SUM(amount_pence) FILTER (WHERE type = 'purchase'), 0)::int AS total_revenue_pence,
        COUNT(*) FILTER (WHERE type = 'purchase')::int AS total_purchases
      FROM credit_transactions
    `;

    // Today's bookings
    const todayBookings = await sql`
      SELECT COUNT(*)::int AS today
      FROM lesson_bookings
      WHERE scheduled_date = CURRENT_DATE AND status IN ('confirmed', 'completed', 'awaiting_confirmation')
    `;

    // This week's bookings
    const weekBookings = await sql`
      SELECT COUNT(*)::int AS this_week
      FROM lesson_bookings
      WHERE scheduled_date BETWEEN CURRENT_DATE AND (CURRENT_DATE + INTERVAL '7 days')
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
    return res.status(500).json({ error: 'Failed to load stats', details: err.message });
  }
}

// ── GET /api/admin?action=all-bookings ────────────────────────────────────────
async function handleAllBookings(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorised' });

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
      WHERE (${statusFilter}::text IS NULL OR lb.status = ${statusFilter})
        AND (${instructorFilter}::integer IS NULL OR lb.instructor_id = ${instructorFilter})
        AND (${fromFilter}::date IS NULL OR lb.scheduled_date >= ${fromFilter}::date)
        AND (${toFilter}::date IS NULL OR lb.scheduled_date <= ${toFilter}::date)
      ORDER BY lb.scheduled_date DESC, lb.start_time DESC
      LIMIT 200
    `;

    return res.json({ bookings });
  } catch (err) {
    console.error('admin all-bookings error:', err);
    reportError('/api/admin', err);
    return res.status(500).json({ error: 'Failed to load bookings', details: err.message });
  }
}

// ── POST /api/admin?action=mark-complete ──────────────────────────────────────
async function handleMarkComplete(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorised' });

  const { booking_id } = req.body;
  if (!booking_id) return res.status(400).json({ error: 'booking_id required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const [booking] = await sql`
      SELECT id, status FROM lesson_bookings WHERE id = ${booking_id}
    `;
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (!['confirmed', 'awaiting_confirmation', 'disputed'].includes(booking.status))
      return res.status(400).json({ error: `Cannot mark a "${booking.status}" booking as complete` });

    await sql`
      UPDATE lesson_bookings SET status = 'completed' WHERE id = ${booking_id}
    `;

    return res.json({ success: true, booking_id });
  } catch (err) {
    console.error('admin mark-complete error:', err);
    reportError('/api/admin', err);
    return res.status(500).json({ error: 'Failed to mark complete', details: err.message });
  }
}

// ── GET /api/admin?action=all-instructors ─────────────────────────────────────
// Returns ALL instructors (including inactive) for admin management
async function handleAllInstructors(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorised' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const instructors = await sql`
      SELECT
        i.id, i.name, i.email, i.phone, i.bio, i.photo_url, i.active, i.created_at,
        COALESCE(i.buffer_minutes, 30) AS buffer_minutes,
        COALESCE(i.commission_rate, 0.85) AS commission_rate,
        i.weekly_franchise_fee_pence,
        (SELECT COUNT(*)::int FROM lesson_bookings lb
         WHERE lb.instructor_id = i.id AND lb.status = 'confirmed'
           AND lb.scheduled_date >= CURRENT_DATE) AS upcoming_bookings,
        (SELECT COUNT(*)::int FROM lesson_bookings lb
         WHERE lb.instructor_id = i.id AND lb.status = 'completed') AS completed_lessons
      FROM instructors i
      ORDER BY i.active DESC, i.name ASC
    `;

    // Get availability windows for each instructor
    const availability = await sql`
      SELECT instructor_id, id, day_of_week, start_time::text, end_time::text, active
      FROM instructor_availability
      WHERE active = true
      ORDER BY instructor_id, day_of_week, start_time
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
    return res.status(500).json({ error: 'Failed to load instructors', details: err.message });
  }
}

// ── POST /api/admin?action=create-instructor ───────────────────────────────────
async function handleCreateInstructor(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorised' });

  const { name, email, phone, bio, photo_url } = req.body || {};
  if (!name || !email) return res.status(400).json({ error: 'Name and email are required' });

  const normalised = email.trim().toLowerCase();

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Check for duplicate email
    const existing = await sql`SELECT id FROM instructors WHERE email = ${normalised}`;
    if (existing.length > 0) return res.status(409).json({ error: 'An instructor with that email already exists' });

    const rows = await sql`
      INSERT INTO instructors (name, email, phone, bio, photo_url, active)
      VALUES (
        ${name.trim()},
        ${normalised},
        ${phone?.trim() || null},
        ${bio?.trim() || null},
        ${photo_url?.trim() || null},
        true
      )
      RETURNING id, name, email, phone, bio, photo_url, active, created_at
    `;

    return res.status(201).json({ success: true, instructor: rows[0] });
  } catch (err) {
    console.error('admin create-instructor error:', err);
    reportError('/api/admin', err);
    return res.status(500).json({ error: 'Failed to create instructor', details: err.message });
  }
}

// ── POST /api/admin?action=update-instructor ───────────────────────────────────
async function handleUpdateInstructor(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorised' });

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

    // Check email not taken by another instructor
    const conflict = await sql`
      SELECT id FROM instructors WHERE email = ${normalised} AND id != ${id}
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
      WHERE id = ${id}
      RETURNING id, name, email, phone, bio, photo_url, active, commission_rate, weekly_franchise_fee_pence
    `;

    if (rows.length === 0) return res.status(404).json({ error: 'Instructor not found' });
    return res.json({ success: true, instructor: rows[0] });
  } catch (err) {
    console.error('admin update-instructor error:', err);
    reportError('/api/admin', err);
    return res.status(500).json({ error: 'Failed to update instructor', details: err.message });
  }
}

// ── POST /api/admin?action=toggle-instructor ───────────────────────────────────
async function handleToggleInstructor(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorised' });

  const { id, active } = req.body || {};
  if (id === undefined || active === undefined) return res.status(400).json({ error: 'id and active are required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const rows = await sql`
      UPDATE instructors SET active = ${!!active} WHERE id = ${id}
      RETURNING id, name, active
    `;

    if (rows.length === 0) return res.status(404).json({ error: 'Instructor not found' });
    return res.json({ success: true, instructor: rows[0] });
  } catch (err) {
    console.error('admin toggle-instructor error:', err);
    reportError('/api/admin', err);
    return res.status(500).json({ error: 'Failed to update instructor', details: err.message });
  }
}

// ── GET /api/admin?action=all-learners ──────────────────────────────────────
// Returns ALL learners with aggregated booking/session stats
async function handleAllLearners(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorised' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const learners = await sql`
      SELECT
        lu.id, lu.name, lu.email, lu.phone,
        lu.current_tier, lu.credit_balance, lu.balance_minutes,
        lu.pickup_address, lu.prefer_contact_before,
        lu.created_at,
        (SELECT COUNT(*)::int FROM lesson_bookings lb
         WHERE lb.learner_id = lu.id) AS total_bookings,
        (SELECT COUNT(*)::int FROM lesson_bookings lb
         WHERE lb.learner_id = lu.id AND lb.status = 'confirmed'
           AND lb.scheduled_date >= CURRENT_DATE) AS upcoming_bookings,
        (SELECT MAX(lb.scheduled_date)::text FROM lesson_bookings lb
         WHERE lb.learner_id = lu.id) AS last_booking_date,
        (SELECT COUNT(*)::int FROM driving_sessions ds
         WHERE ds.user_id = lu.id) AS total_sessions
      FROM learner_users lu
      ORDER BY lu.created_at DESC
    `;

    return res.json({ learners });
  } catch (err) {
    console.error('admin all-learners error:', err);
    reportError('/api/admin', err);
    return res.status(500).json({ error: 'Failed to load learners', details: err.message });
  }
}

// ── GET /api/admin?action=learner-detail ────────────────────────────────────
// Returns booking history, credit transactions, and progress for one learner
async function handleLearnerDetail(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorised' });

  const learnerId = parseInt(req.query.learner_id);
  if (!learnerId) return res.status(400).json({ error: 'learner_id is required' });

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
        lb.created_at,
        i.name AS instructor_name
      FROM lesson_bookings lb
      JOIN instructors i ON i.id = lb.instructor_id
      WHERE lb.learner_id = ${learnerId}
      ORDER BY lb.scheduled_date DESC, lb.start_time DESC
    `;

    const transactions = await sql`
      SELECT id, type, credits, amount_pence, payment_method, created_at
      FROM credit_transactions
      WHERE learner_id = ${learnerId}
      ORDER BY created_at DESC
    `;

    const progress = await sql`
      SELECT
        COUNT(*)::int AS total_sessions,
        COALESCE(SUM(duration_minutes), 0)::int AS total_minutes
      FROM driving_sessions
      WHERE user_id = ${learnerId}
    `;

    return res.json({
      bookings,
      transactions,
      progress: progress[0] || { total_sessions: 0, total_minutes: 0 }
    });
  } catch (err) {
    console.error('admin learner-detail error:', err);
    reportError('/api/admin', err);
    return res.status(500).json({ error: 'Failed to load learner details', details: err.message });
  }
}

// ── POST /api/admin?action=adjust-credits ─────────────────────────────────────
// Body: { learner_id, hours: float (e.g. 1.5), reason }
// Positive = add, negative = remove. Updates balance_minutes (primary) + credit_balance (legacy).
async function handleAdjustCredits(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Admin auth required' });

  const { learner_id, hours, reason } = req.body;
  if (!learner_id || hours === undefined || hours === 0)
    return res.status(400).json({ error: 'learner_id and non-zero hours are required' });

  const hoursFloat = parseFloat(hours);
  if (isNaN(hoursFloat) || hoursFloat === 0)
    return res.status(400).json({ error: 'hours must be a non-zero number' });

  const minutesDelta = Math.round(hoursFloat * 60);

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Check learner exists
    const [learner] = await sql`SELECT id, balance_minutes, credit_balance FROM learner_users WHERE id = ${learner_id}`;
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

    // Log transaction (credits field stores whole hours, legacy)
    await sql`
      INSERT INTO credit_transactions (learner_id, type, credits, amount_pence, payment_method)
      VALUES (${learner_id}, ${minutesDelta > 0 ? 'admin_add' : 'admin_remove'}, ${creditsDelta}, 0, ${reason || 'Admin adjustment'})
    `;

    return res.json({
      ok: true,
      previous_balance_minutes: learner.balance_minutes || 0,
      new_balance_minutes: updated.balance_minutes,
      adjusted_hours: hoursFloat
    });
  } catch (err) {
    console.error('admin adjust-credits error:', err);
    reportError('/api/admin', err);
    return res.status(500).json({ error: 'Failed to adjust hours', details: err.message });
  }
}

// ── POST /api/admin?action=delete-learner ────────────────────────────────────
// Body: { learner_id }
// Deletes a learner and all their associated data.
async function handleDeleteLearner(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Admin auth required' });

  const { learner_id } = req.body;
  if (!learner_id) return res.status(400).json({ error: 'learner_id is required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Verify learner exists
    const [learner] = await sql`SELECT id, name, email FROM learner_users WHERE id = ${learner_id}`;
    if (!learner) return res.status(404).json({ error: 'Learner not found' });

    // Delete associated data (order matters for foreign keys)
    const tables = [
      { name: 'skill_ratings', col: 'user_id' },
      { name: 'driving_sessions', col: 'user_id' },
      { name: 'credit_transactions', col: 'learner_id' },
      { name: 'lesson_bookings', col: 'learner_id' },
      { name: 'qa_questions', col: 'user_id' },
    ];

    for (const t of tables) {
      try {
        await sql(`DELETE FROM ${t.name} WHERE ${t.col} = $1`, [learner_id]);
      } catch (e) { console.warn(`delete from ${t.name} skipped:`, e.message); }
    }

    // Delete the learner
    await sql`DELETE FROM learner_users WHERE id = ${learner_id}`;

    return res.json({ success: true, deleted: { id: learner.id, name: learner.name, email: learner.email } });
  } catch (err) {
    console.error('admin delete-learner error:', err);
    reportError('/api/admin', err);
    return res.status(500).json({ error: 'Failed to delete learner', details: err.message });
  }
}

// ── GET /api/admin?action=confirmation-details&booking_id=X ──────────────────
// Returns both confirmation records for a booking (admin can see both sides).
async function handleConfirmationDetails(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorised' });

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
      WHERE lb.id = ${booking_id}
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

  const { booking_id, resolution } = req.body;
  if (!booking_id) return res.status(400).json({ error: 'booking_id required' });
  if (!['completed', 'no_show', 'cancelled'].includes(resolution))
    return res.status(400).json({ error: 'resolution must be completed, no_show, or cancelled' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const [booking] = await sql`
      SELECT id, status FROM lesson_bookings WHERE id = ${booking_id}
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

  try {
    const { instructor_id, paused } = req.body || {};
    if (!instructor_id || typeof paused !== 'boolean')
      return res.status(400).json({ error: 'instructor_id and paused (boolean) required' });

    const sql = neon(process.env.POSTGRES_URL);
    const [updated] = await sql`
      UPDATE instructors SET payouts_paused = ${paused} WHERE id = ${instructor_id} RETURNING id, name
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

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Instructor connect statuses
    const instructors = await sql`
      SELECT id, name, email, active, commission_rate, weekly_franchise_fee_pence,
             stripe_account_id, stripe_onboarding_complete, payouts_paused
        FROM instructors ORDER BY name ASC
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

    // Recent payouts
    const recentPayouts = await sql`
      SELECT ip.id, ip.instructor_id, i.name AS instructor_name,
             ip.amount_pence, ip.status, ip.period_start, ip.period_end,
             ip.created_at, ip.completed_at,
             (SELECT COUNT(*) FROM payout_line_items WHERE payout_id = ip.id) AS lesson_count
        FROM instructor_payouts ip
        JOIN instructors i ON i.id = ip.instructor_id
       ORDER BY ip.created_at DESC
       LIMIT 20
    `;

    // Summary stats
    const [stats] = await sql`
      SELECT
        COALESCE(SUM(amount_pence) FILTER (WHERE status = 'completed'
          AND completed_at >= date_trunc('month', CURRENT_DATE)), 0)::int AS this_month_pence,
        COALESCE(SUM(amount_pence) FILTER (WHERE status = 'completed'), 0)::int AS all_time_pence,
        COUNT(*) FILTER (WHERE status = 'completed')::int AS total_payouts
      FROM instructor_payouts
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

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const results = await processAllPayouts(sql, stripe);

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

  try {
    const instructorId = parseInt(req.query.instructor_id);
    if (!instructorId) return res.status(400).json({ error: 'instructor_id required' });

    const sql = neon(process.env.POSTGRES_URL);

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
