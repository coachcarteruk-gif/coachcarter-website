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
//   POST /api/admin?action=update-learner
//     → update learner name/email/phone/pickup_address (admin JWT required)
//
//   POST /api/admin?action=adjust-credits
//     → add or remove lesson credits for a learner (admin JWT required)

const { neon }   = require('@neondatabase/serverless');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const { reportError } = require('./_error-alert');
const { processAllPayouts, getEligibleBookings, simulatePayoutForInstructor } = require('./_payout-helpers');
const { computePlatformBalance } = require('./_platform-balance');
const { sendPayoutSummary } = require('./_payout-email');
const { requireAuth, getSchoolId, verifyAdminSecret, isSuperAdmin,
        SESSION_COOKIE_NAMES, SESSION_MAX_AGE_SEC,
        buildSessionCookie, buildSessionClearCookie } = require('./_auth');
const { buildCsrfCookie, buildCsrfClearCookie, mintCsrfToken, appendSetCookie, parseCookies } = require('./_csrf');
const { createTransporter, generateToken } = require('./_auth-helpers');
const { sendWhatsApp } = require('./_whatsapp');
const { lockBalanceAndMutate } = require('./_credit-grant');
const {
  validateGoodwillRequest,
  validateReconciliationRequest,
} = require('./_admin-credit-contracts');
const { grantGoodwillCredits } = require('./_admin-credit-goodwill');
const { inspectCreditReconciliation, grantReconciliationCredits } = require('./_admin-credit-reconciliation');
const { planAdminRefundPreview, validateRefundPreviewRequest } = require('./_refund-planner');
const { executeAdminRefund, validateRefundExecuteRequest } = require('./_refund-executor');
const { recordManualBankRefund, validateManualBankRefundRequest } = require('./_refund-manual-bank');
const { searchRefundEvents, validateRefundEventSearchRequest } = require('./_refund-events');
const {
  fetchRefundIncidentReadiness,
  validateRefundIncidentReadinessRequest,
} = require('./_refund-incident-readiness');
const {
  fetchRefundIncidentRepairPlan,
  validateRefundIncidentRepairPlanRequest,
} = require('./_refund-incident-repair');
const {
  addRefundNote,
  listRefundNotes,
  validateRefundNoteCreateRequest,
  validateRefundNoteListRequest,
} = require('./_refund-notes');
const { logAudit } = require('./_audit');
const { deleteLearnerCascade } = require('./_gdpr');
const { checkRateLimit, getClientIp } = require('./_rate-limit');
const { SCHEDULED, CHARGEABLE, REFUNDED, BLOCKING_STATUSES } = require('./_booking-status');
const { extractPostcode, bulkGeocodeUK, estimateDriveMinutes } = require('./_travel-time');
const { withNeonTransaction } = require('./_db-transaction');
const { planFifoCreditDraw } = require('./_bcs-fifo');
const { splitFifoPlanAcrossBookings } = require('./_bcs-booking-plan');

const LEARNER_CATEGORIES = new Set(['regular', 'sporadic', 'inactive', 'passed']);
const BROADCAST_MAX_RECIPIENTS = 200;
const INSTRUCTOR_ACCESS_MAX_AGE_SEC = 60 * 60 * 2;
const CREDIT_BOOKING_SOURCE_TYPES = ['purchase', 'slot_purchase', 'admin_add', 'referral_bonus', 'referral_reward', 'legacy_grandfather'];

class AdminRetrospectiveBookingAbort extends Error {
  constructor(result) {
    super(result?.message || result?.code || 'ADMIN_RETROSPECTIVE_BOOKING_ABORT');
    this.name = 'AdminRetrospectiveBookingAbort';
    this.result = { ok: false, ...(result || {}) };
  }
}

function abortAdminRetrospectiveBooking(result) {
  throw new AdminRetrospectiveBookingAbort(result);
}

function normaliseLearnerCategory(value) {
  const text = String(value || '').trim().toLowerCase();
  return LEARNER_CATEGORIES.has(text) ? text : null;
}

async function ensureInstructorLearnerLink(sql, { instructorId, learnerId, schoolId }) {
  if (!instructorId || !learnerId || !schoolId) return null;
  const [row] = await sql`
    INSERT INTO instructor_learner_notes (instructor_id, learner_id, school_id, updated_at)
    VALUES (${instructorId}, ${learnerId}, ${schoolId}, NOW())
    ON CONFLICT (instructor_id, learner_id)
    DO UPDATE SET school_id = ${schoolId}, updated_at = NOW()
    RETURNING instructor_id, learner_id, learner_category
  `;
  return row || null;
}

function normaliseBroadcastCategories(value) {
  if (!Array.isArray(value)) {
    return { ok: false, status: 400, code: 'INVALID_CATEGORIES', message: 'categories must be an array.' };
  }
  const categories = [];
  for (const item of value) {
    const category = normaliseLearnerCategory(item);
    if (!category) {
      return { ok: false, status: 400, code: 'INVALID_CATEGORY', message: 'Selected learner category is invalid.' };
    }
    if (!categories.includes(category)) categories.push(category);
  }
  if (categories.length === 0) {
    return { ok: false, status: 400, code: 'NO_CATEGORIES', message: 'Select at least one learner category.' };
  }
  return { ok: true, categories };
}

function normaliseBroadcastPhone(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const compact = raw.replace(/[\s().-]/g, '');
  if (!/^(?:\+|00)?\d{10,15}$/.test(compact)) return null;
  if (compact.startsWith('+')) return compact;
  if (compact.startsWith('00')) return `+${compact.slice(2)}`;
  if (compact.startsWith('0')) return `+44${compact.slice(1)}`;
  return `+${compact}`;
}

function summariseBroadcastError(result) {
  if (!result || result.ok) return null;
  return String(result.error || result.status || 'Send failed').slice(0, 500);
}

async function resolveLearnerBroadcastRecipients(sql, schoolId, categories) {
  const learners = await sql`
    SELECT id, name, email, phone, learner_category
    FROM learner_users
    WHERE school_id = ${schoolId}
      AND learner_category = ANY(${categories}::text[])
    ORDER BY learner_category ASC, name ASC NULLS LAST, email ASC NULLS LAST, id ASC
  `;

  const recipients = [];
  const skipped = [];
  for (const learner of learners) {
    const phone = normaliseBroadcastPhone(learner.phone);
    const row = {
      learner_id: learner.id,
      name: learner.name,
      email: learner.email,
      phone: phone || learner.phone || null,
      learner_category: learner.learner_category,
    };
    if (!phone) {
      skipped.push({ ...row, skip_reason: learner.phone ? 'invalid_phone' : 'missing_phone' });
    } else {
      recipients.push({ ...row, phone });
    }
  }

  return {
    recipients,
    skipped,
    counts: {
      matched: learners.length,
      recipients: recipients.length,
      skipped: skipped.length,
    },
  };
}

function createStripeClient() {
  return require('stripe')(process.env.STRIPE_SECRET_KEY);
}

// Helper: derive schoolId from admin JWT (superadmins can pass ?school_id= to target a specific school)
function getAdminSchoolId(admin, req) {
  return (admin.school_id != null) ? admin.school_id : (parseInt(req.query?.school_id) || 1);
}

function buildScopedDurationCreditRefusal(delta, availableMinutes, style = 'admin') {
  if (delta <= 0) return null;
  const balance = Number(availableMinutes || 0);
  if (balance >= delta) return null;
  return style === 'instructor'
    ? `Learner has insufficient balance. Needs ${delta} more minutes but has ${balance}.`
    : `Learner has insufficient balance (needs ${delta} more minutes, has ${balance})`;
}

const ADMIN_ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ADMIN_TIME_HHMM_RE = /^\d{2}:\d{2}$/;
const RESERVED_MOVE_NOTICE_HOURS = 48;

function normaliseAdminControlBool(value) {
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0' || value == null || value === '') return false;
  return null;
}

function normaliseAdminControlDate(value, fieldName) {
  if (value == null || value === '') return { ok: true, value: null };
  const text = String(value).trim();
  if (!ADMIN_ISO_DATE_RE.test(text)) {
    return { ok: false, error: `${fieldName} must be YYYY-MM-DD` };
  }
  return { ok: true, value: text };
}

function normaliseAdminControlTime(value, fieldName) {
  if (value == null || value === '') return { ok: true, value: null };
  const text = String(value).trim();
  if (!ADMIN_TIME_HHMM_RE.test(text)) {
    return { ok: false, error: `${fieldName} must be HH:MM` };
  }
  return { ok: true, value: text };
}

class ReservedGoodwillMoveAbort extends Error {
  constructor(statusCode, payload) {
    super(payload?.message || payload?.error || payload?.code || 'Reserved goodwill move refused');
    this.name = 'ReservedGoodwillMoveAbort';
    this.statusCode = statusCode;
    this.payload = payload;
  }
}

function abortReservedGoodwillMove(statusCode, payload) {
  throw new ReservedGoodwillMoveAbort(statusCode, payload);
}

function isValidAdminIsoDate(value) {
  if (!ADMIN_ISO_DATE_RE.test(String(value || ''))) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function normaliseAdminTimeHHMM(value) {
  const text = String(value || '').trim();
  if (!ADMIN_TIME_HHMM_RE.test(text)) return null;
  const [hh, mm] = text.split(':').map(Number);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return text;
}

function adminTimeToMinutes(value) {
  const [hh, mm] = String(value || '').slice(0, 5).split(':').map(Number);
  return (hh * 60) + mm;
}

function adminMinutesToTime(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function parseHourlyRatePence(value, { allowOmitted = false } = {}) {
  if (value === undefined) {
    return allowOmitted ? { present: false, value: undefined } : { present: true, value: null };
  }
  if (value === null || value === '') return { present: true, value: null };

  const rate = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(rate) || rate <= 0 || rate > 50000) {
    return { present: true, error: 'hourly_rate_pence must be null or an integer between 1 and 50000' };
  }
  return { present: true, value: rate };
}

function resolveAdjustCreditsTarget({ learner, lcbRows, explicitInstructorId, explicitLcbRow }) {
  let targetInstructorId = parseInt(explicitInstructorId, 10);
  let preCheckBalance = Number(learner?.balance_minutes || 0);

  if (!Number.isFinite(targetInstructorId) || targetInstructorId <= 0) {
    const rows = Array.isArray(lcbRows) ? lcbRows : [];
    if (rows.length === 0) {
      return { ok: true, targetInstructorId: 1, preCheckBalance };
    }
    if (rows.length === 1) {
      return {
        ok: true,
        targetInstructorId: rows[0].instructor_id,
        preCheckBalance: Number(rows[0].balance_minutes || 0),
      };
    }
    return {
      ok: false,
      code: 'AMBIGUOUS_INSTRUCTOR',
      status: 409,
      count: rows.length,
      instructorIds: rows.map(r => r.instructor_id),
    };
  }

  return {
    ok: true,
    targetInstructorId,
    preCheckBalance: explicitLcbRow ? Number(explicitLcbRow.balance_minutes || 0) : 0,
  };
}

function setCors(res) {
}

// Verify admin JWT token (accepts admin/superadmin roles OR instructors with isAdmin flag).
// Delegates to shared requireAuth so cookie-first + CSRF + school_id checks
// are applied consistently with the rest of the codebase.
function verifyAdminJWT(req) {
  return requireAuth(req, { roles: ['admin'] });
}

module.exports = async (req, res) => {
  setCors(res);
  const action = req.query.action;
  if (action === 'login')           return handleLogin(req, res);
  if (action === 'logout')          return handleLogout(req, res);
  if (action === 'request-reset')   return handleRequestReset(req, res);
  if (action === 'reset-password')  return handleResetPassword(req, res);
  if (action === 'create-admin')    return handleCreateAdmin(req, res);
  if (action === 'verify')          return handleVerify(req, res);
  if (action === 'dashboard-stats') return handleDashboardStats(req, res);
  if (action === 'all-bookings')    return handleAllBookings(req, res);
  if (action === 'create-retrospective-booking') return handleCreateRetrospectiveBooking(req, res);
  if (action === 'edit-booking')    return handleEditBooking(req, res);
  if (action === 'reserved-goodwill-move') return handleReservedGoodwillMove(req, res);
  if (action === 'mark-complete')   return handleMarkComplete(req, res);
  if (action === 'all-instructors')   return handleAllInstructors(req, res);
  if (action === 'create-instructor') return handleCreateInstructor(req, res);
  if (action === 'update-instructor') return handleUpdateInstructor(req, res);
  if (action === 'toggle-instructor') return handleToggleInstructor(req, res);
  if (action === 'access-instructor-account') return handleAccessInstructorAccount(req, res);
  if (action === 'stop-instructor-access')    return handleStopInstructorAccess(req, res);
  if (action === 'all-learners')      return handleAllLearners(req, res);
  if (action === 'learner-controls')  return handleLearnerControls(req, res);
  if (action === 'learner-detail')    return handleLearnerDetail(req, res);
  if (action === 'update-learner')    return handleUpdateLearner(req, res);
  if (action === 'update-learner-controls') return handleUpdateLearnerControls(req, res);
  if (action === 'update-learner-relationship') return handleUpdateLearnerRelationship(req, res);
  if (action === 'learner-broadcast-preview') return handleLearnerBroadcastPreview(req, res);
  if (action === 'send-learner-broadcast') return handleSendLearnerBroadcast(req, res);
  if (action === 'learner-broadcast-history') return handleLearnerBroadcastHistory(req, res);
  if (action === 'learner-feedback') return handleLearnerFeedback(req, res);
  if (action === 'update-learner-feedback') return handleUpdateLearnerFeedback(req, res);
  if (action === 'adjust-credits')    return handleAdjustCredits(req, res);
  if (action === 'credit-goodwill')    return handleCreditGoodwillContract(req, res);
  if (action === 'credit-reconciliation') return handleCreditReconciliationContract(req, res);
  if (action === 'refund-preview')      return handleRefundPreview(req, res);
  if (action === 'execute-refund')      return handleExecuteRefund(req, res);
  if (action === 'record-manual-bank-refund') return handleRecordManualBankRefund(req, res);
  if (action === 'refund-events')       return handleRefundEvents(req, res);
  if (action === 'refund-incident-readiness') return handleRefundIncidentReadiness(req, res);
  if (action === 'refund-incident-repair-plan') return handleRefundIncidentRepairPlan(req, res);
  if (action === 'refund-notes')        return handleRefundNotes(req, res);
  if (action === 'add-refund-note')     return handleAddRefundNote(req, res);
  if (action === 'delete-learner')    return handleDeleteLearner(req, res);
  if (action === 'confirmation-details') return handleConfirmationDetails(req, res);
  if (action === 'toggle-payout-pause')  return handleTogglePayoutPause(req, res);
  if (action === 'payout-overview')      return handlePayoutOverview(req, res);
  if (action === 'platform-balance')     return handlePlatformBalance(req, res);
  if (action === 'process-payouts')      return handleProcessPayouts(req, res);
  if (action === 'instructor-payout-history') return handleInstructorPayoutHistory(req, res);
  if (action === 'invite-learner')           return handleInviteLearner(req, res);
  if (action === 'instructor-blackouts')     return handleInstructorBlackouts(req, res);
  if (action === 'set-instructor-blackouts') return handleSetInstructorBlackouts(req, res);
  if (action === 'referral-activity')        return handleReferralActivity(req, res);
  if (action === 'referral-relationships')   return handleReferralRelationships(req, res);
  if (action === 'link-referral-relationship') return handleLinkReferralRelationship(req, res);
  if (action === 'referral-config')          return handleReferralConfig(req, res);
  if (action === 'update-referral-config')   return handleUpdateReferralConfig(req, res);
  if (action === 'notification-log')         return handleNotificationLog(req, res);

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
      return res.status(401).json({
        error: 'invalid_credentials',
        message: 'Email or password is incorrect.',
      });

    const admin = rows[0];
    const match = await bcrypt.compare(password, admin.password_hash);
    if (!match)
      return res.status(401).json({
        error: 'invalid_credentials',
        message: 'Email or password is incorrect.',
      });

    const token = jwt.sign(
      { id: admin.id, email: admin.email, role: admin.role, isAdmin: true, school_id: admin.school_id || null },
      secret,
      { expiresIn: '7d' }
    );

    // Set httpOnly session cookie + CSRF double-submit cookie.
    appendSetCookie(res, buildSessionCookie(SESSION_COOKIE_NAMES.admin, token, SESSION_MAX_AGE_SEC.admin));
    appendSetCookie(res, buildCsrfCookie(mintCsrfToken()));

    return res.json({
      admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role, school_id: admin.school_id || null }
    });
  } catch (err) {
    console.error('admin login error:', err);
    reportError('/api/admin', err);
    return res.status(500).json({ error: 'Login failed', details: 'Internal server error' });
  }
}

// ── POST /api/admin?action=logout ─────────────────────────────────────────────
// Clear the cc_admin + cc_csrf cookies. No auth required — if you can hit
// the endpoint at all, clearing your own cookies is always safe. Attributes
// must match the Set-Cookie used at login or the browser won't match.
async function handleLogout(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  appendSetCookie(res, buildSessionClearCookie(SESSION_COOKIE_NAMES.admin));
  appendSetCookie(res, buildCsrfClearCookie());
  return res.json({ ok: true });
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
        COUNT(*) FILTER (WHERE status = ${SCHEDULED})::int AS confirmed,
        COUNT(*) FILTER (WHERE status = ${CHARGEABLE})::int AS completed,
        COUNT(*) FILTER (WHERE status = ${REFUNDED})::int AS cancelled,
        COUNT(*) FILTER (WHERE status = ${SCHEDULED} AND scheduled_date >= CURRENT_DATE)::int AS upcoming
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
        AND scheduled_date = CURRENT_DATE AND status = ANY(${BLOCKING_STATUSES}::text[])
    `;

    // This week's bookings
    const weekBookings = await sql`
      SELECT COUNT(*)::int AS this_week
      FROM lesson_bookings
      WHERE school_id = ${schoolId}
        AND scheduled_date BETWEEN CURRENT_DATE AND (CURRENT_DATE + INTERVAL '7 days')
        AND status = ANY(${BLOCKING_STATUSES}::text[])
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
        COALESCE(lb.instructor_notes, lb.notes) AS notes,
        lb.pickup_address,
        lb.dropoff_address,
        lb.payment_method,
        COALESCE(lb.transmission_type, 'manual') AS transmission_type,
        lb.created_at,
        lb.lesson_type_id,
        lb.minutes_deducted,
        lb.edited_at,
        rsb.id AS recurring_slot_block_id,
        rsbi.id AS recurring_slot_block_item_id,
        COALESCE(rsb.status = 'confirmed' AND rsbi.status = 'booked', false) AS is_reserved_weekly_slot,
        CASE
          WHEN rsb.status = 'confirmed' AND rsbi.status = 'booked' THEN ${RESERVED_MOVE_NOTICE_HOURS}
          ELSE NULL
        END AS reserved_move_notice_hours,
        CASE
          WHEN rsb.status = 'confirmed' AND rsbi.status = 'booked'
          THEN to_char(lb.scheduled_date::date + lb.start_time::time - (${RESERVED_MOVE_NOTICE_HOURS}::integer * INTERVAL '1 hour'), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
          ELSE NULL
        END AS reserved_move_request_deadline,
        CASE
          WHEN rsb.status = 'confirmed' AND rsbi.status = 'booked'
          THEN (NOW() < (lb.scheduled_date::date + lb.start_time::time - (${RESERVED_MOVE_NOTICE_HOURS}::integer * INTERVAL '1 hour')))
          ELSE NULL
        END AS reserved_move_policy_open,
        CASE
          WHEN rsb.status = 'confirmed' AND rsbi.status = 'booked'
          THEN (
            lb.status = ${SCHEDULED}
            AND NOW() < (lb.scheduled_date::date + lb.start_time::time)
            AND NOW() >= (lb.scheduled_date::date + lb.start_time::time - (${RESERVED_MOVE_NOTICE_HOURS}::integer * INTERVAL '1 hour'))
          )
          ELSE false
        END AS reserved_goodwill_move_open,
        CASE
          WHEN rsb.status = 'confirmed' AND rsbi.status = 'booked'
          THEN 'policy_visible_admin_override'
          ELSE NULL
        END AS reserved_move_policy_mode,
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
      LEFT JOIN recurring_slot_block_items rsbi
        ON rsbi.lesson_booking_id = lb.id
       AND rsbi.school_id = lb.school_id
       AND rsbi.instructor_id = lb.instructor_id
       AND rsbi.status = 'booked'
      LEFT JOIN recurring_slot_blocks rsb
        ON rsb.id = rsbi.block_id
       AND rsb.school_id = lb.school_id
       AND rsb.learner_id = lb.learner_id
       AND rsb.instructor_id = lb.instructor_id
       AND rsb.status = 'confirmed'
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
// Retrospective credit-funded inserts use the same LCB + FIFO BCS accounting shape as learner/instructor credit bookings.
// Body: { learner_id, instructor_id, scheduled_date, start_time, lesson_type_id, payment_method }
async function createAdminRetrospectiveCreditBookingTransaction({
  connectionString,
  learnerId,
  instructorId,
  schoolId,
  scheduledDate,
  startTime,
  endTime,
  lessonTypeId,
  transmissionType = 'manual',
  durationMins,
  notes,
  pickupAddress,
  dropoffAddress,
}) {
  try {
    return await withNeonTransaction(connectionString, async client => {
      await client.query(
        `INSERT INTO learner_credit_balances
           (learner_id, instructor_id, school_id, balance_minutes)
         VALUES ($1, $2, $3, 0)
         ON CONFLICT (learner_id, instructor_id) DO NOTHING`,
        [learnerId, instructorId, schoolId]
      );

      const locked = await client.query(
        `SELECT balance_minutes
           FROM learner_credit_balances
          WHERE learner_id = $1
            AND instructor_id = $2
            AND school_id = $3
          FOR UPDATE`,
        [learnerId, instructorId, schoolId]
      );

      if (locked.rowCount === 0) {
        abortAdminRetrospectiveBooking({
          code: 'LCB_SCOPE_INVARIANT',
          message: 'Learner credit balance row exists outside the expected school scope',
        });
      }

      const balanceMinutes = Number(locked.rows[0].balance_minutes || 0);
      if (balanceMinutes < durationMins) {
        abortAdminRetrospectiveBooking({
          code: 'INSUFFICIENT_BALANCE',
          balanceMinutes,
          message: `Learner has insufficient balance for this instructor (${balanceMinutes} minutes available)`,
        });
      }

      const conflicts = await client.query(
        `SELECT lb.id
           FROM lesson_bookings lb
          WHERE lb.instructor_id = $1
            AND lb.school_id = $2
            AND lb.scheduled_date = $3
            AND lb.status = ANY($6::text[])
            AND $4::time < lb.end_time
            AND $5::time > lb.start_time
          LIMIT 1`,
        [instructorId, schoolId, scheduledDate, startTime, endTime, BLOCKING_STATUSES]
      );
      if (conflicts.rowCount > 0) {
        abortAdminRetrospectiveBooking({
          code: 'SLOT_UNAVAILABLE',
          message: 'This lesson overlaps with another lesson for the instructor.',
        });
      }

      const sourcesResult = await client.query(
        `SELECT
           ct.id,
           ct.created_at,
           ct.school_id,
           ct.minutes,
           COALESCE(ct.amount_pence, 0)::int AS amount_pence,
           COALESCE(ct.effective_rate_pence_per_minute, 0)::int AS effective_rate_pence_per_minute,
           COALESCE(ct.stripe_fee_pence, 0)::int AS stripe_fee_pence,
           ct.absorbed_by,
           COALESCE(bcs.active_minutes_drawn, 0)::int AS active_minutes_drawn,
           COALESCE(bcs.active_contribution_pence, 0)::int AS active_contribution_pence,
           COALESCE(bcs.active_stripe_fee_pence, 0)::int AS active_stripe_fee_pence,
           COALESCE(csa.adjusted_minutes, 0)::int AS adjusted_minutes,
           COALESCE(csa.adjusted_pence, 0)::int AS adjusted_pence
         FROM credit_transactions ct
         LEFT JOIN LATERAL (
           SELECT
             COALESCE(SUM(minutes_drawn), 0)::int AS active_minutes_drawn,
             COALESCE(SUM(contribution_pence), 0)::int AS active_contribution_pence,
             COALESCE(SUM(stripe_fee_pence), 0)::int AS active_stripe_fee_pence
           FROM booking_credit_sources
           WHERE credit_transaction_id = ct.id
             AND school_id = $3
             AND refunded_at IS NULL
         ) bcs ON TRUE
         LEFT JOIN LATERAL (
           SELECT
             COALESCE(SUM(minutes_adjusted), 0)::int AS adjusted_minutes,
             COALESCE(SUM(pence_adjusted), 0)::int AS adjusted_pence
           FROM credit_source_adjustments
           WHERE credit_transaction_id = ct.id
         ) csa ON TRUE
         WHERE ct.learner_id = $1
           AND ct.instructor_id = $2
           AND ct.school_id = $3
           AND ct.type = ANY($4::text[])
           AND ct.minutes > 0
         ORDER BY ct.created_at ASC, ct.id ASC`,
        [learnerId, instructorId, schoolId, CREDIT_BOOKING_SOURCE_TYPES]
      );

      const fifoPlan = planFifoCreditDraw({
        sources: sourcesResult.rows,
        minutes: durationMins,
        schoolId,
      });
      if (!fifoPlan.ok) {
        abortAdminRetrospectiveBooking({
          code: 'INSUFFICIENT_FIFO_SOURCES',
          balanceMinutes,
          shortageMinutes: fifoPlan.shortage_minutes,
          message: 'Learner credit balance could not be matched to available credit sources.',
        });
      }

      let booking;
      try {
        const inserted = await client.query(
          `INSERT INTO lesson_bookings
             (learner_id, instructor_id, scheduled_date, start_time, end_time, status,
              created_by, payment_method, instructor_notes, pickup_address, dropoff_address,
              lesson_type_id, transmission_type, minutes_deducted, school_id,
              list_price_pence, list_price_source)
           VALUES
             ($1, $2, $3, $4, $5, $6,
              'admin', 'credit', $7, $8, $9,
              $10, $11, $12, $13,
              0, 'live_compute_insert')
           RETURNING id, scheduled_date::text, start_time::text, end_time::text, status`,
          [
            learnerId, instructorId, scheduledDate, startTime, endTime, CHARGEABLE,
            notes || null, pickupAddress || null, dropoffAddress || null,
            lessonTypeId || null, transmissionType, durationMins, schoolId,
          ]
        );
        booking = inserted.rows[0];
      } catch (err) {
        if (err.code === '23505' || err.message?.includes('uq_booking_slot') || err.message?.includes('uq_instructor_slot')) {
          abortAdminRetrospectiveBooking({
            code: 'SLOT_UNAVAILABLE',
            message: 'This lesson overlaps with another lesson for the instructor.',
          });
        }
        throw err;
      }

      const bcsRows = splitFifoPlanAcrossBookings({
        plannedRows: fifoPlan.rows,
        bookingTargets: [{ booking_id: booking.id, minutes: durationMins }],
      });

      let payableListPricePence = 0;
      for (const row of bcsRows) {
        if (row.absorbed_by !== 'instructor') payableListPricePence += row.contribution_pence;
      }

      let insertedBcsCount = 0;
      for (const row of bcsRows) {
        const inserted = await client.query(
          `INSERT INTO booking_credit_sources
             (school_id, booking_id, credit_transaction_id, minutes_drawn,
              rate_pence_per_minute, contribution_pence, stripe_fee_pence, absorbed_by)
           VALUES
             ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (booking_id, credit_transaction_id) DO NOTHING
           RETURNING id`,
          [
            row.school_id, row.booking_id, row.credit_transaction_id, row.minutes_drawn,
            row.rate_pence_per_minute, row.contribution_pence, row.stripe_fee_pence, row.absorbed_by,
          ]
        );
        insertedBcsCount += inserted.rowCount;
      }

      if (insertedBcsCount !== bcsRows.length) {
        throw new Error(`BCS_IDEMPOTENCY_INVARIANT: expected ${bcsRows.length} inserts, got ${insertedBcsCount}`);
      }

      await client.query(
        `UPDATE lesson_bookings
            SET list_price_pence = $1
          WHERE id = $2
            AND school_id = $3`,
        [payableListPricePence, booking.id, schoolId]
      );

      const decremented = await client.query(
        `UPDATE learner_credit_balances
            SET balance_minutes = balance_minutes - $4,
                updated_at = NOW()
          WHERE learner_id = $1
            AND instructor_id = $2
            AND school_id = $3
            AND balance_minutes >= $4
        RETURNING balance_minutes`,
        [learnerId, instructorId, schoolId, durationMins]
      );

      if (decremented.rowCount !== 1) {
        throw new Error('LCB_DECREMENT_INVARIANT: locked balance failed guarded decrement');
      }

      return {
        ok: true,
        booking: { ...booking, list_price_pence: payableListPricePence },
        balanceMinutes: Number(decremented.rows[0].balance_minutes || 0),
        bcsRows,
      };
    });
  } catch (err) {
    if (err instanceof AdminRetrospectiveBookingAbort) return err.result;
    throw err;
  }
}

async function handleCreateRetrospectiveBooking(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = getAdminSchoolId(admin, req);

  const learnerId = parseInt(req.body?.learner_id, 10);
  const instructorId = parseInt(req.body?.instructor_id, 10);
  const lessonTypeId = parseInt(req.body?.lesson_type_id, 10);
  const scheduledDate = String(req.body?.scheduled_date || '').trim();
  const startTime = normaliseAdminTimeHHMM(req.body?.start_time);
  const paymentMethod = String(req.body?.payment_method || '').trim().toLowerCase();
  const notes = String(req.body?.notes || '').trim();
  const pickupAddress = String(req.body?.pickup_address || '').trim();
  const dropoffAddress = String(req.body?.dropoff_address || '').trim();
  const requestedTransmission = String(req.body?.transmission_type || '').trim().toLowerCase();
  const transmissionType = ['manual', 'auto', 'automatic'].includes(requestedTransmission)
    ? (requestedTransmission === 'automatic' ? 'auto' : requestedTransmission)
    : 'manual';

  if (!Number.isInteger(learnerId) || learnerId <= 0) {
    return res.status(400).json({ error: true, code: 'INVALID_LEARNER', message: 'Choose a learner.' });
  }
  if (!Number.isInteger(instructorId) || instructorId <= 0) {
    return res.status(400).json({ error: true, code: 'INVALID_INSTRUCTOR', message: 'Choose an instructor.' });
  }
  if (!Number.isInteger(lessonTypeId) || lessonTypeId <= 0) {
    return res.status(400).json({ error: true, code: 'INVALID_LESSON_TYPE', message: 'Choose a lesson type.' });
  }
  if (!isValidAdminIsoDate(scheduledDate)) {
    return res.status(400).json({ error: true, code: 'INVALID_DATE', message: 'Date must be YYYY-MM-DD.' });
  }
  if (!startTime) {
    return res.status(400).json({ error: true, code: 'INVALID_START_TIME', message: 'Start time must be HH:MM.' });
  }
  if (!['credit', 'cash'].includes(paymentMethod)) {
    return res.status(400).json({ error: true, code: 'INVALID_PAYMENT_METHOD', message: 'Choose credit or cash.' });
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const [learner] = await sql`
      SELECT id, name, pickup_address
        FROM learner_users
       WHERE id = ${learnerId}
         AND school_id = ${schoolId}
    `;
    if (!learner) return res.status(404).json({ error: true, code: 'LEARNER_NOT_FOUND', message: 'Learner not found.' });

    const [instructor] = await sql`
      SELECT id, name
        FROM instructors
       WHERE id = ${instructorId}
         AND school_id = ${schoolId}
         AND active = true
    `;
    if (!instructor) return res.status(404).json({ error: true, code: 'INSTRUCTOR_NOT_FOUND', message: 'Active instructor not found.' });

    const [lessonType] = await sql`
      SELECT id, name, duration_minutes
        FROM lesson_types
       WHERE id = ${lessonTypeId}
         AND school_id = ${schoolId}
         AND active = true
    `;
    if (!lessonType) return res.status(404).json({ error: true, code: 'LESSON_TYPE_NOT_FOUND', message: 'Active lesson type not found.' });

    const durationMins = Number(lessonType.duration_minutes || 90);
    if (!Number.isInteger(durationMins) || durationMins <= 0 || durationMins > 24 * 60) {
      return res.status(400).json({ error: true, code: 'INVALID_DURATION', message: 'Lesson type duration is invalid.' });
    }
    const endMins = adminTimeToMinutes(startTime) + durationMins;
    if (endMins > 24 * 60) {
      return res.status(400).json({ error: true, code: 'LESSON_CROSSES_MIDNIGHT', message: 'Lesson must finish on the same day.' });
    }
    const endTime = adminMinutesToTime(endMins);
    const finishedAt = new Date(`${scheduledDate}T${endTime}:00`);
    if (Number.isNaN(finishedAt.getTime()) || finishedAt.getTime() > Date.now()) {
      return res.status(400).json({
        error: true,
        code: 'NOT_RETROSPECTIVE',
        message: 'Retrospective lessons must have already finished.',
      });
    }

    const conflicts = await sql`
      SELECT lb.id, lb.start_time::text AS start_time, lb.end_time::text AS end_time,
             lu.name AS learner_name
        FROM lesson_bookings lb
        JOIN learner_users lu ON lu.id = lb.learner_id
       WHERE lb.instructor_id = ${instructorId}
         AND lb.school_id = ${schoolId}
         AND lb.scheduled_date = ${scheduledDate}
         AND lb.status = ANY(${BLOCKING_STATUSES}::text[])
         AND ${startTime}::time < lb.end_time
         AND ${endTime}::time > lb.start_time
       ORDER BY lb.start_time
       LIMIT 5
    `;
    if (conflicts.length > 0) {
      return res.status(409).json({
        error: true,
        code: 'SLOT_UNAVAILABLE',
        message: 'This lesson overlaps with another lesson for the instructor.',
        conflicts: conflicts.map(c => ({
          id: c.id,
          learner_name: c.learner_name,
          time: `${String(c.start_time).slice(0, 5)}-${String(c.end_time).slice(0, 5)}`,
        })),
      });
    }

    let booking;
    let remainingBalance = null;
    if (paymentMethod === 'credit') {
      const booked = await createAdminRetrospectiveCreditBookingTransaction({
        connectionString: process.env.POSTGRES_URL,
        learnerId,
        instructorId,
        schoolId,
        scheduledDate,
        startTime,
        endTime,
        lessonTypeId,
        transmissionType,
        durationMins,
        notes,
        pickupAddress: pickupAddress || learner.pickup_address || null,
        dropoffAddress,
      });
      if (!booked.ok) {
        const status = booked.code === 'INSUFFICIENT_BALANCE' || booked.code === 'INSUFFICIENT_FIFO_SOURCES' ? 402 :
          booked.code === 'SLOT_UNAVAILABLE' ? 409 : 400;
        return res.status(status).json({
          error: true,
          code: booked.code,
          message: booked.message || 'Could not create credit-funded lesson.',
          balance_minutes: booked.balanceMinutes,
          shortage_minutes: booked.shortageMinutes,
        });
      }
      booking = booked.booking;
      remainingBalance = booked.balanceMinutes;
    } else {
      const inserted = await sql`
        INSERT INTO lesson_bookings
          (learner_id, instructor_id, scheduled_date, start_time, end_time, status,
           created_by, payment_method, instructor_notes, pickup_address, dropoff_address,
           lesson_type_id, transmission_type, minutes_deducted, school_id)
        VALUES
          (${learnerId}, ${instructorId}, ${scheduledDate}, ${startTime}::time, ${endTime}::time, ${CHARGEABLE},
           'admin', 'cash', ${notes || null}, ${pickupAddress || learner.pickup_address || null}, ${dropoffAddress || null},
           ${lessonTypeId}, ${transmissionType}, 0, ${schoolId})
        RETURNING id, scheduled_date::text, start_time::text, end_time::text, status
      `;
      booking = inserted[0];
    }

    await ensureInstructorLearnerLink(sql, { instructorId, learnerId, schoolId });
    await logAudit(sql, {
      adminId: admin.id,
      adminEmail: admin.email,
      action: 'admin.create_retrospective_booking',
      targetType: 'booking',
      targetId: booking.id,
      details: {
        learner_id: learnerId,
        instructor_id: instructorId,
        lesson_type_id: lessonTypeId,
        scheduled_date: scheduledDate,
        start_time: startTime,
        end_time: endTime,
        duration_minutes: durationMins,
        payment_method: paymentMethod,
        status: CHARGEABLE,
      },
      schoolId,
      req,
    });

    return res.json({
      ok: true,
      booking_id: booking.id,
      booking,
      payment_method: paymentMethod,
      remaining_balance_minutes: remainingBalance,
    });
  } catch (err) {
    console.error('admin create-retrospective-booking error:', err);
    reportError('/api/admin', err);
    return res.status(500).json({ error: 'Failed to create retrospective lesson', details: 'Internal server error' });
  }
}

// -- POST /api/admin?action=edit-booking -------------------------------------
// Body: { booking_id, scheduled_date?, start_time?, lesson_type_id?, pickup_address?, dropoff_address?, notes? }
async function handleEditBooking(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = getAdminSchoolId(admin, req);

  const body = req.body || {};
  const { booking_id, scheduled_date, start_time, lesson_type_id, pickup_address, dropoff_address, notes, force } = body;
  const bookingId = parseInt(booking_id, 10);
  const hasScheduledDate = Object.prototype.hasOwnProperty.call(body, 'scheduled_date');
  const hasStartTime = Object.prototype.hasOwnProperty.call(body, 'start_time');
  const hasLessonType = Object.prototype.hasOwnProperty.call(body, 'lesson_type_id');
  const hasPickupAddress = Object.prototype.hasOwnProperty.call(body, 'pickup_address');
  const hasDropoffAddress = Object.prototype.hasOwnProperty.call(body, 'dropoff_address');
  const hasNotes = Object.prototype.hasOwnProperty.call(body, 'notes');
  if (!Number.isInteger(bookingId) || bookingId <= 0) return res.status(400).json({ error: 'booking_id is required' });
  if (!hasScheduledDate && !hasStartTime && !hasLessonType && !hasPickupAddress && !hasDropoffAddress && !hasNotes)
    return res.status(400).json({ error: 'At least one field to edit is required' });

  const requestedDate = hasScheduledDate ? String(scheduled_date || '').trim() : null;
  const requestedStartTime = hasStartTime ? normaliseAdminTimeHHMM(start_time) : null;
  const requestedLessonTypeId = hasLessonType && lesson_type_id !== null && lesson_type_id !== ''
    ? parseInt(lesson_type_id, 10)
    : null;
  if (hasScheduledDate && !isValidAdminIsoDate(requestedDate)) {
    return res.status(400).json({ error: 'Date must be YYYY-MM-DD' });
  }
  if (hasStartTime && !requestedStartTime) {
    return res.status(400).json({ error: 'Start time must be HH:MM' });
  }
  if (hasLessonType && (!Number.isInteger(requestedLessonTypeId) || requestedLessonTypeId <= 0)) {
    return res.status(400).json({ error: 'Lesson type is required' });
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const [booking] = await sql`
      SELECT lb.id, lb.status, lb.learner_id, lb.instructor_id,
             lb.scheduled_date::text AS scheduled_date, lb.start_time::text AS start_time, lb.end_time::text AS end_time,
             lb.lesson_type_id, lb.minutes_deducted, lb.list_price_pence, lb.setmore_key, lb.pickup_address, lb.dropoff_address,
             COALESCE(lb.instructor_notes, lb.notes) AS notes,
             lu.name AS learner_name, lu.email AS learner_email,
             i.name AS instructor_name,
             COALESCE(i.buffer_minutes, 30) AS buffer_minutes,
             COALESCE(lt.duration_minutes, 90) AS type_duration_minutes
      FROM lesson_bookings lb
      JOIN learner_users lu ON lu.id = lb.learner_id
      JOIN instructors i ON i.id = lb.instructor_id
      LEFT JOIN lesson_types lt ON lt.id = lb.lesson_type_id
      WHERE lb.id = ${bookingId} AND lb.school_id = ${schoolId}
    `;
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (![SCHEDULED, CHARGEABLE].includes(booking.status))
      return res.status(400).json({ error: `Cannot edit a booking with status "${booking.status}"` });

    const oldStart = String(booking.start_time).slice(0, 5);
    const oldEnd = String(booking.end_time).slice(0, 5);
    let newDate = hasScheduledDate ? requestedDate : booking.scheduled_date;
    let newStartTime = hasStartTime ? requestedStartTime : oldStart;
    let newLessonTypeId = hasLessonType ? requestedLessonTypeId : booking.lesson_type_id;
    let newDuration = parseInt(booking.type_duration_minutes) || 90;
    const newPickupAddress = hasPickupAddress ? String(pickup_address || '').trim() || null : booking.pickup_address || null;
    const newDropoffAddress = hasDropoffAddress ? String(dropoff_address || '').trim() || null : booking.dropoff_address || null;
    const newNotes = hasNotes ? String(notes || '').trim() || null : booking.notes || null;
    const lessonTypeChanged = hasLessonType && newLessonTypeId !== booking.lesson_type_id;

    if (lessonTypeChanged) {
      const [newType] = await sql`SELECT duration_minutes FROM lesson_types WHERE id = ${newLessonTypeId} AND school_id = ${schoolId}`;
      if (!newType) return res.status(404).json({ error: 'Lesson type not found or inactive' });
      newDuration = newType.duration_minutes;
    }

    const endMins = adminTimeToMinutes(newStartTime) + newDuration;
    if (endMins > 24 * 60) {
      return res.status(400).json({ error: 'Lesson must finish on the same day' });
    }
    const newEndTime = adminMinutesToTime(endMins);
    const timeChanged = newDate !== booking.scheduled_date ||
      newStartTime !== oldStart ||
      newEndTime !== oldEnd;

    const [paidOut] = await sql`SELECT id FROM payout_line_items WHERE booking_id = ${bookingId}`;
    if (paidOut && (timeChanged || lessonTypeChanged)) {
      return res.status(400).json({ error: 'Cannot change date, time, or lesson type after a booking has been included in a payout' });
    }

    if (booking.status === CHARGEABLE) {
      const finishedAt = new Date(`${newDate}T${newEndTime}:00`);
      if (Number.isNaN(finishedAt.getTime()) || finishedAt.getTime() > Date.now()) {
        return res.status(400).json({
          error: true,
          code: 'RETROSPECTIVE_EDIT_MUST_STAY_PAST',
          message: 'Completed lessons must still finish in the past.',
        });
      }
    }

    // Overlap check with buffer — warn with details, allow force override
    const buffer = parseInt(booking.buffer_minutes) || 30;
    const conflicts = await sql`
      SELECT lb.id, lb.start_time::text AS start_time, lb.end_time::text AS end_time,
             lb.pickup_address, lu.name AS learner_name
      FROM lesson_bookings lb
      JOIN learner_users lu ON lu.id = lb.learner_id
      WHERE lb.instructor_id = ${booking.instructor_id}
        AND lb.scheduled_date = ${newDate}
        AND lb.school_id = ${schoolId}
        AND lb.id != ${bookingId}
        AND lb.status = ANY(${BLOCKING_STATUSES}::text[])
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

    // Credit/balance adjustment. Step 4 cutover: prior to this, the balance
    // UPDATE and ledger INSERT ran as two separate statements — a process
    // kill between them moved the balance but lost the audit row.
    // lockBalanceAndMutate writes both atomically inside one CTE.
    const oldMinutes = parseInt(booking.minutes_deducted) || 0;
    const delta = newDuration - oldMinutes;
    if (delta !== 0 && oldMinutes > 0) {
      if (delta > 0) {
        const [scopedBalance] = await sql`
          SELECT balance_minutes
            FROM learner_credit_balances
           WHERE learner_id = ${booking.learner_id}
             AND instructor_id = ${booking.instructor_id}
             AND school_id = ${schoolId}
        `;
        const availableMinutes = scopedBalance ? Number(scopedBalance.balance_minutes || 0) : 0;
        const refusal = buildScopedDurationCreditRefusal(delta, availableMinutes);
        if (refusal) return res.status(402).json({ error: refusal });
      }
      const adj = await lockBalanceAndMutate(sql, {
        learnerId: booking.learner_id,
        schoolId,
        instructorId: booking.instructor_id,
        delta: -delta,
        ledgerType: 'edit_adjustment',
        reason: 'edit',
      });
      if (!adj.ok) {
        return res.status(adj.code === 'INSUFFICIENT_BALANCE' ? 402 : 500).json({
          error: adj.code === 'INSUFFICIENT_BALANCE'
            ? `Learner has insufficient balance (needs ${delta} more minutes)`
            : 'Failed to adjust learner balance',
        });
      }
    }
    const oldListPricePence = booking.list_price_pence == null ? null : parseInt(booking.list_price_pence, 10);
    const newListPricePence = oldMinutes > 0 && oldListPricePence != null
      ? Math.max(0, Math.round((oldListPricePence * newDuration) / oldMinutes))
      : oldListPricePence;

    await sql`
      UPDATE lesson_bookings
      SET scheduled_date = ${newDate}, start_time = ${newStartTime}::time, end_time = ${newEndTime}::time,
          lesson_type_id = ${newLessonTypeId}, minutes_deducted = ${oldMinutes > 0 ? newDuration : 0},
          list_price_pence = ${newListPricePence},
          pickup_address = ${newPickupAddress},
          dropoff_address = ${newDropoffAddress},
          instructor_notes = ${newNotes},
          edited_at = NOW()
      WHERE id = ${bookingId}
        AND school_id = ${schoolId}
    `;

    await logAudit(sql, {
      adminId: admin.id, adminEmail: admin.email, action: 'edit-booking',
      targetType: 'booking', targetId: bookingId,
      details: {
        old: {
          date: booking.scheduled_date,
          start: oldStart,
          lesson_type_id: booking.lesson_type_id,
          minutes_deducted: oldMinutes,
          list_price_pence: oldListPricePence,
          pickup_address: booking.pickup_address,
          dropoff_address: booking.dropoff_address,
          notes: booking.notes,
        },
        new: {
          date: newDate,
          start: newStartTime,
          lesson_type_id: newLessonTypeId,
          minutes_deducted: oldMinutes > 0 ? newDuration : 0,
          list_price_pence: newListPricePence,
          pickup_address: newPickupAddress,
          dropoff_address: newDropoffAddress,
          notes: newNotes,
        }
      },
      schoolId, req
    });

    // Email learner if a future scheduled lesson moved. Past admin corrections stay internal.
    if (booking.status === SCHEDULED && timeChanged && booking.learner_email) {
      try {
        const mailer = createTransporter();
        const isoOldDate = booking.scheduled_date instanceof Date ? booking.scheduled_date.toISOString().slice(0, 10) : String(booking.scheduled_date).slice(0, 10);
        const oldDateFmt = new Date(isoOldDate + 'T00:00:00Z')
          .toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
        const newDateFmt = new Date(newDate + 'T00:00:00Z')
          .toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
        const firstName = (booking.learner_name || '').split(' ')[0] || 'there';
        const durationStr = newDuration >= 60
          ? (newDuration % 60 === 0 ? (newDuration/60) + ' hour' + (newDuration/60 !== 1 ? 's' : '') : (newDuration/60).toFixed(1) + ' hours')
          : newDuration + ' mins';
        await mailer.sendMail({
          _log: {
            purpose: 'admin.booking_updated',
            learnerId: booking.learner_id,
            instructorId: booking.instructor_id,
            schoolId,
          },
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

    await logAudit(sql, {
      adminId: admin.id, adminEmail: admin.email,
      action: 'admin.edit_booking',
      targetType: 'booking', targetId: bookingId,
      details: {
        old: {
          scheduled_date: booking.scheduled_date,
          start_time: booking.start_time,
          end_time: booking.end_time,
          lesson_type_id: booking.lesson_type_id,
          pickup_address: booking.pickup_address,
          dropoff_address: booking.dropoff_address,
          notes: booking.notes,
        },
        new: {
          scheduled_date: newDate,
          start_time: newStartTime,
          end_time: newEndTime,
          lesson_type_id: newLessonTypeId,
          pickup_address: newPickupAddress,
          dropoff_address: newDropoffAddress,
          notes: newNotes,
        },
        force: !!force,
      },
      schoolId, req,
    });

    return res.json({ ok: true, booking_id: bookingId });
  } catch (err) {
    console.error('admin edit-booking error:', err);
    reportError('/api/admin', err);
    return res.status(500).json({ error: 'Failed to edit booking', details: 'Internal server error' });
  }
}

// -- POST /api/admin?action=reserved-goodwill-move ----------------------------
// Body: { booking_id, new_date, new_start_time, reason }
// Admin-only under-48-hour exception for one confirmed reserved weekly occurrence.
async function handleReservedGoodwillMove(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = getAdminSchoolId(admin, req);

  const bookingId = parseInt(req.body?.booking_id, 10);
  const newDate = String(req.body?.new_date || '').trim();
  const newStartTime = normaliseAdminTimeHHMM(req.body?.new_start_time);
  const reason = String(req.body?.reason || '').trim();

  if (!Number.isInteger(bookingId) || bookingId <= 0) {
    return res.status(400).json({ error: true, code: 'INVALID_BOOKING_ID', message: 'booking_id is required' });
  }
  if (!isValidAdminIsoDate(newDate)) {
    return res.status(400).json({ error: true, code: 'INVALID_NEW_DATE', message: 'new_date must be YYYY-MM-DD' });
  }
  if (!newStartTime) {
    return res.status(400).json({ error: true, code: 'INVALID_NEW_START_TIME', message: 'new_start_time must be HH:MM' });
  }
  if (!reason) {
    return res.status(400).json({ error: true, code: 'GOODWILL_REASON_REQUIRED', message: 'A reason is required for the audit log' });
  }

  try {
    const result = await withNeonTransaction(process.env.POSTGRES_URL, async client => {
      const bookingResult = await client.query(
        `SELECT
           lb.id,
           lb.learner_id,
           lb.instructor_id,
           lb.school_id,
           lb.status,
           lb.scheduled_date::text AS scheduled_date,
           lb.start_time::text AS start_time,
           lb.end_time::text AS end_time,
           lb.lesson_type_id,
           lb.minutes_deducted,
           COALESCE(lb.reschedule_count, 0)::int AS reschedule_count,
           lb.pickup_address,
           lb.dropoff_address,
           lb.payment_method,
           lb.stripe_fee_pence,
           lb.stripe_fee_source,
           lb.list_price_pence,
           lb.list_price_source,
           COALESCE(lb.transmission_type, 'manual') AS transmission_type,
           rsb.id AS recurring_slot_block_id,
           rsbi.id AS recurring_slot_block_item_id,
           rsbi.price_pence AS recurring_item_price_pence
         FROM lesson_bookings lb
         JOIN recurring_slot_block_items rsbi
           ON rsbi.lesson_booking_id = lb.id
          AND rsbi.school_id = lb.school_id
          AND rsbi.instructor_id = lb.instructor_id
          AND rsbi.status = 'booked'
         JOIN recurring_slot_blocks rsb
           ON rsb.id = rsbi.block_id
          AND rsb.school_id = lb.school_id
          AND rsb.learner_id = lb.learner_id
          AND rsb.instructor_id = lb.instructor_id
          AND rsb.status = 'confirmed'
         WHERE lb.id = $1
           AND lb.school_id = $2
           AND lb.status = $3
         FOR UPDATE OF lb, rsbi, rsb`,
        [bookingId, schoolId, SCHEDULED]
      );
      const booking = bookingResult.rows[0];
      if (!booking) {
        abortReservedGoodwillMove(404, {
          error: true,
          code: 'RESERVED_BOOKING_NOT_FOUND',
          message: 'Confirmed reserved weekly booking not found',
        });
      }

      const oldDate = String(booking.scheduled_date).slice(0, 10);
      const oldStart = String(booking.start_time).slice(0, 5);
      if (newDate === oldDate && newStartTime === oldStart) {
        abortReservedGoodwillMove(400, {
          error: true,
          code: 'SAME_RESERVED_SLOT',
          message: 'New time is the same as the current reserved lesson',
        });
      }

      const oldLessonStart = new Date(`${oldDate}T${oldStart}:00Z`);
      if (oldLessonStart.getTime() <= Date.now()) {
        abortReservedGoodwillMove(400, {
          error: true,
          code: 'RESERVED_LESSON_ALREADY_STARTED',
          message: 'Cannot goodwill move a reserved lesson that has already started',
        });
      }

      const noticeHours = (oldLessonStart.getTime() - Date.now()) / 3600000;
      if (noticeHours >= RESERVED_MOVE_NOTICE_HOURS) {
        abortReservedGoodwillMove(409, {
          error: true,
          code: 'RESERVED_POLICY_MOVE_OPEN',
          message: 'This reserved lesson can still be moved by the learner with at least 48 hours notice.',
        });
      }

      const newStart = adminTimeToMinutes(newStartTime);
      const originalDuration = adminTimeToMinutes(booking.end_time) - adminTimeToMinutes(booking.start_time);
      const durationMinutes = originalDuration > 0 ? originalDuration : Number(booking.minutes_deducted || 0);
      if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
        abortReservedGoodwillMove(400, {
          error: true,
          code: 'UNKNOWN_BOOKING_DURATION',
          message: 'Could not determine the reserved lesson duration',
        });
      }
      const newEndMins = newStart + durationMinutes;
      if (newEndMins > 24 * 60) {
        abortReservedGoodwillMove(400, {
          error: true,
          code: 'NEW_SLOT_ENDS_AFTER_DAY',
          message: 'The replacement slot would finish after the end of the day',
        });
      }
      const newEndTime = adminMinutesToTime(newEndMins);

      const newSlotStart = new Date(`${newDate}T${newStartTime}:00Z`);
      if (newSlotStart.getTime() <= Date.now()) {
        abortReservedGoodwillMove(400, {
          error: true,
          code: 'NEW_SLOT_IN_PAST',
          message: 'The replacement slot must be in the future',
        });
      }

      const bookingConflict = await client.query(
        `SELECT id
           FROM lesson_bookings
          WHERE instructor_id = $1
            AND school_id = $2
            AND scheduled_date = $3::date
            AND start_time < $5::time
            AND end_time > $4::time
            AND status = ANY($6::text[])
            AND id <> $7
          LIMIT 1`,
        [booking.instructor_id, schoolId, newDate, newStartTime, newEndTime, BLOCKING_STATUSES, booking.id]
      );
      if (bookingConflict.rowCount > 0) {
        abortReservedGoodwillMove(409, {
          error: true,
          code: 'SLOT_UNAVAILABLE',
          message: 'That replacement slot is already booked',
        });
      }

      const activeReservation = await client.query(
        `SELECT id
           FROM slot_reservations
          WHERE instructor_id = $1
            AND school_id = $2
            AND scheduled_date = $3::date
            AND start_time < $5::time
            AND end_time > $4::time
            AND expires_at > NOW()
          LIMIT 1`,
        [booking.instructor_id, schoolId, newDate, newStartTime, newEndTime]
      );
      if (activeReservation.rowCount > 0) {
        abortReservedGoodwillMove(409, {
          error: true,
          code: 'SLOT_RESERVED',
          message: 'Someone is currently booking that replacement slot',
        });
      }

      const pendingOffer = await client.query(
        `SELECT id
           FROM lesson_offers
          WHERE instructor_id = $1
            AND school_id = $2
            AND scheduled_date = $3::date
            AND start_time < $5::time
            AND end_time > $4::time
            AND status = 'pending'
            AND expires_at > NOW()
          LIMIT 1`,
        [booking.instructor_id, schoolId, newDate, newStartTime, newEndTime]
      );
      if (pendingOffer.rowCount > 0) {
        abortReservedGoodwillMove(409, {
          error: true,
          code: 'SLOT_HAS_PENDING_OFFER',
          message: 'That replacement slot has a pending offer',
        });
      }

      const recurringConflict = await client.query(
        `SELECT id, status
           FROM recurring_slot_block_items
          WHERE instructor_id = $1
            AND school_id = $2
            AND scheduled_date = $3::date
            AND start_time < $5::time
            AND end_time > $4::time
            AND status IN ('held', 'booked')
            AND id <> $6
          LIMIT 1`,
        [booking.instructor_id, schoolId, newDate, newStartTime, newEndTime, booking.recurring_slot_block_item_id]
      );
      if (recurringConflict.rowCount > 0) {
        abortReservedGoodwillMove(409, {
          error: true,
          code: 'SLOT_HELD_FOR_RECURRING_BLOCK',
          message: 'That replacement slot is held for a recurring block',
        });
      }

      const sameBlockItem = await client.query(
        `SELECT id, status
           FROM recurring_slot_block_items
          WHERE block_id = $1
            AND school_id = $2
            AND scheduled_date = $3::date
            AND start_time = $4::time
          LIMIT 1`,
        [booking.recurring_slot_block_id, schoolId, newDate, newStartTime]
      );
      if (sameBlockItem.rowCount > 0) {
        abortReservedGoodwillMove(409, {
          error: true,
          code: 'REPLACEMENT_ALREADY_IN_BLOCK',
          message: 'That replacement slot is already represented in this reserved weekly block',
        });
      }

      const refundedBcs = await client.query(
        `UPDATE booking_credit_sources
            SET refunded_at = NOW()
          WHERE booking_id = $1
            AND school_id = $2
            AND refunded_at IS NULL
          RETURNING id`,
        [booking.id, schoolId]
      );
      const refundedBcsIds = refundedBcs.rows.map(row => row.id);

      await client.query(
        `UPDATE lesson_bookings
            SET status = $1,
                credit_returned = TRUE,
                cancelled_at = NOW()
          WHERE id = $2
            AND school_id = $3
            AND status = $4`,
        [REFUNDED, booking.id, schoolId, SCHEDULED]
      );

      const insertedBooking = await client.query(
        `INSERT INTO lesson_bookings
           (learner_id, instructor_id, scheduled_date, start_time, end_time, status,
            rescheduled_from, reschedule_count, pickup_address, dropoff_address,
            lesson_type_id, minutes_deducted, school_id, created_by, payment_method,
            stripe_fee_pence, stripe_fee_source, list_price_pence, list_price_source,
            transmission_type)
         VALUES
           ($1, $2, $3::date, $4::time, $5::time, $6,
            $7, $8, $9, $10,
            $11, $12, $13, 'admin', $14,
            $15, $16, $17, $18,
            $19)
         RETURNING id, scheduled_date::text, start_time::text, end_time::text, status`,
        [
          booking.learner_id,
          booking.instructor_id,
          newDate,
          newStartTime,
          newEndTime,
          SCHEDULED,
          booking.id,
          booking.reschedule_count,
          booking.pickup_address || null,
          booking.dropoff_address || null,
          booking.lesson_type_id || null,
          booking.minutes_deducted != null ? booking.minutes_deducted : null,
          schoolId,
          booking.payment_method || null,
          booking.stripe_fee_pence != null ? booking.stripe_fee_pence : null,
          booking.stripe_fee_source || null,
          booking.list_price_pence != null ? booking.list_price_pence : null,
          booking.list_price_source || null,
          booking.transmission_type || 'manual',
        ]
      );
      const newBooking = insertedBooking.rows[0];

      if (refundedBcsIds.length > 0) {
        await client.query(
          `INSERT INTO booking_credit_sources
             (school_id, booking_id, credit_transaction_id, minutes_drawn,
              rate_pence_per_minute, contribution_pence, stripe_fee_pence, absorbed_by,
              refunded_at)
           SELECT
             school_id, $1, credit_transaction_id, minutes_drawn,
             rate_pence_per_minute, contribution_pence, stripe_fee_pence, absorbed_by,
             NULL
             FROM booking_credit_sources
            WHERE id = ANY($2::int[])
              AND school_id = $3
              AND refunded_at IS NOT NULL
           ON CONFLICT (booking_id, credit_transaction_id) DO NOTHING`,
          [newBooking.id, refundedBcsIds, schoolId]
        );
      }

      await client.query(
        `UPDATE recurring_slot_block_items
            SET status = 'released',
                updated_at = NOW()
          WHERE id = $1
            AND school_id = $2
            AND status = 'booked'`,
        [booking.recurring_slot_block_item_id, schoolId]
      );

      const insertedItem = await client.query(
        `INSERT INTO recurring_slot_block_items
           (block_id, school_id, instructor_id, lesson_booking_id,
            scheduled_date, start_time, end_time, status, price_pence)
         VALUES
           ($1, $2, $3, $4,
            $5::date, $6::time, $7::time, 'booked', $8)
         RETURNING id`,
        [
          booking.recurring_slot_block_id,
          schoolId,
          booking.instructor_id,
          newBooking.id,
          newDate,
          newStartTime,
          newEndTime,
          booking.recurring_item_price_pence || 0,
        ]
      );

      return {
        old_booking_id: booking.id,
        new_booking_id: newBooking.id,
        recurring_slot_block_id: booking.recurring_slot_block_id,
        released_recurring_slot_block_item_id: booking.recurring_slot_block_item_id,
        replacement_recurring_slot_block_item_id: insertedItem.rows[0].id,
        movement_type: 'reserved_goodwill_admin_move',
        old_slot: { date: oldDate, start_time: oldStart, end_time: String(booking.end_time).slice(0, 5) },
        new_slot: { date: newDate, start_time: newStartTime, end_time: newEndTime },
        copied_booking_credit_source_count: refundedBcsIds.length,
      };
    });

    const sql = neon(process.env.POSTGRES_URL);
    await logAudit(sql, {
      adminId: admin.id,
      adminEmail: admin.email,
      action: 'reserved_goodwill_admin_move',
      targetType: 'booking',
      targetId: bookingId,
      details: { ...result, reason },
      schoolId,
      req,
    });

    return res.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof ReservedGoodwillMoveAbort) {
      return res.status(err.statusCode).json(err.payload);
    }
    console.error('admin reserved-goodwill-move error:', err);
    reportError('/api/admin?action=reserved-goodwill-move', err);
    return res.status(500).json({ error: true, code: 'RESERVED_GOODWILL_MOVE_FAILED', message: 'Failed to move reserved lesson' });
  }
}

// -- POST /api/admin?action=mark-complete -------------------------------------
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
    if (booking.status !== SCHEDULED)
      return res.status(400).json({ error: `Cannot mark a "${booking.status}" booking as complete` });

    await sql`
      UPDATE lesson_bookings SET status = ${CHARGEABLE} WHERE id = ${booking_id}
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
        i.hourly_rate_pence,
        COALESCE(i.bulk_tiers_enabled, FALSE) AS bulk_tiers_enabled,
        (i.password_hash IS NOT NULL) AS has_password,
        (i.stripe_account_id IS NOT NULL) AS connect_has_account,
        COALESCE(i.stripe_onboarding_complete, FALSE) AS connect_onboarding_complete,
        COALESCE(i.payouts_paused, FALSE) AS connect_payouts_paused,
        (SELECT COUNT(*)::int FROM lesson_bookings lb
         WHERE lb.instructor_id = i.id AND lb.status = ${SCHEDULED}
           AND lb.scheduled_date >= CURRENT_DATE AND lb.school_id = ${schoolId}) AS upcoming_bookings,
        (SELECT COUNT(*)::int FROM lesson_bookings lb
         WHERE lb.instructor_id = i.id AND lb.status = ${CHARGEABLE} AND lb.school_id = ${schoolId}) AS completed_lessons
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

  const { name, email, phone, bio, photo_url, bulk_tiers_enabled } = req.body || {};
  if (!name || !email) return res.status(400).json({ error: 'Name and email are required' });
  if (bulk_tiers_enabled !== undefined && typeof bulk_tiers_enabled !== 'boolean') {
    return res.status(400).json({ error: 'bulk_tiers_enabled must be true or false' });
  }
  const hourlyRate = parseHourlyRatePence(req.body?.hourly_rate_pence);
  if (hourlyRate.error) return res.status(400).json({ error: hourlyRate.error });

  const normalised = email.trim().toLowerCase();

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Check for duplicate email within same school
    const existing = await sql`SELECT id FROM instructors WHERE email = ${normalised} AND school_id = ${schoolId}`;
    if (existing.length > 0) return res.status(409).json({ error: 'An instructor with that email already exists' });

    const rows = await sql`
      INSERT INTO instructors (name, email, phone, bio, photo_url, active, bulk_tiers_enabled, hourly_rate_pence, school_id)
      VALUES (
        ${name.trim()},
        ${normalised},
        ${phone?.trim() || null},
        ${bio?.trim() || null},
        ${photo_url?.trim() || null},
        true,
        ${bulk_tiers_enabled === true},
        ${hourlyRate.value},
        ${schoolId}
      )
      RETURNING id, name, email, phone, bio, photo_url, active, created_at, hourly_rate_pence, COALESCE(bulk_tiers_enabled, FALSE) AS bulk_tiers_enabled
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
        _log: {
          purpose: 'admin.instructor_invite',
          instructorId: instructor.id,
          schoolId,
        },
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
  const hasBulkTiers = 'bulk_tiers_enabled' in body;
  const hourlyRate = parseHourlyRatePence(body.hourly_rate_pence, { allowOmitted: true });
  if (hourlyRate.error) return res.status(400).json({ error: hourlyRate.error });
  if (hasBulkTiers && typeof body.bulk_tiers_enabled !== 'boolean') {
    return res.status(400).json({ error: 'bulk_tiers_enabled must be true or false' });
  }

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
          bulk_tiers_enabled = CASE WHEN ${hasBulkTiers} THEN ${body.bulk_tiers_enabled === true} ELSE bulk_tiers_enabled END,
          weekly_franchise_fee_pence = CASE WHEN ${hasFranchiseFee} THEN ${hasFranchiseFee ? body.weekly_franchise_fee_pence : null}::integer ELSE weekly_franchise_fee_pence END,
          hourly_rate_pence = CASE WHEN ${hourlyRate.present} THEN ${hourlyRate.value}::integer ELSE hourly_rate_pence END
      WHERE id = ${id} AND school_id = ${schoolId}
      RETURNING id, name, email, phone, bio, photo_url, active, commission_rate, weekly_franchise_fee_pence, hourly_rate_pence, COALESCE(bulk_tiers_enabled, FALSE) AS bulk_tiers_enabled
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

// -- POST /api/admin?action=access-instructor-account -------------------------
// Mint a short-lived instructor session for admin support access. This does not
// reveal or mutate the instructor's password and leaves the admin session intact.
async function handleAccessInstructorAccount(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorised' });

  const instructorId = parseInt(req.body?.instructor_id, 10);
  if (!Number.isFinite(instructorId) || instructorId <= 0) {
    return res.status(400).json({ error: 'instructor_id is required' });
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) return res.status(500).json({ error: 'JWT_SECRET not configured' });

  const schoolId = getAdminSchoolId(admin, req);
  try {
    const sql = neon(process.env.POSTGRES_URL);
    const [instructor] = await sql`
      SELECT id, name, email, photo_url, school_id, onboarding_complete,
             COALESCE(is_admin, FALSE) AS is_admin,
             active
        FROM instructors
       WHERE id = ${instructorId}
         AND school_id = ${schoolId}`;

    if (!instructor) return res.status(404).json({ error: 'Instructor not found' });
    if (!instructor.active) return res.status(409).json({ error: 'Instructor account is inactive' });

    const tokenPayload = {
      id: instructor.id,
      email: instructor.email,
      role: 'instructor',
      school_id: instructor.school_id || schoolId,
      impersonation: true,
      impersonated_by_admin_id: admin.id || null,
      impersonated_by_admin_email: admin.email || null,
    };
    if (admin.role === 'instructor') {
      tokenPayload.return_instructor_admin = {
        id: admin.id,
        email: admin.email,
        school_id: admin.school_id || schoolId,
        isAdmin: true,
      };
    }
    if (instructor.is_admin) tokenPayload.isAdmin = true;

    const sessionToken = jwt.sign(tokenPayload, secret, { expiresIn: INSTRUCTOR_ACCESS_MAX_AGE_SEC });
    appendSetCookie(res, buildSessionCookie(
      SESSION_COOKIE_NAMES.instructor,
      sessionToken,
      INSTRUCTOR_ACCESS_MAX_AGE_SEC
    ));
    appendSetCookie(res, buildCsrfCookie(mintCsrfToken()));

    await logAudit(sql, {
      adminId: admin.id,
      adminEmail: admin.email,
      action: 'admin.instructor_access_start',
      targetType: 'instructor',
      targetId: instructor.id,
      details: {
        instructor_email: instructor.email,
        instructor_name: instructor.name,
        session_max_age_sec: INSTRUCTOR_ACCESS_MAX_AGE_SEC,
      },
      schoolId,
      req,
    });

    return res.json({
      success: true,
      instructor: {
        id: instructor.id,
        name: instructor.name,
        email: instructor.email,
        photo_url: instructor.photo_url,
        is_admin: !!instructor.is_admin,
        school_id: instructor.school_id || schoolId,
        onboarding_complete: !!instructor.onboarding_complete,
      },
      impersonation: {
        active: true,
        admin_id: admin.id || null,
        admin_email: admin.email || null,
        started_at: new Date().toISOString(),
        max_age_sec: INSTRUCTOR_ACCESS_MAX_AGE_SEC,
      },
    });
  } catch (err) {
    console.error('admin access-instructor-account error:', err);
    reportError('/api/admin?action=access-instructor-account', err);
    return res.status(500).json({ error: 'Failed to access instructor account' });
  }
}

// -- POST /api/admin?action=stop-instructor-access ----------------------------
// Clears the support instructor session only. The admin cookie is deliberately
// left alone so the operator returns to the admin portal still signed in.
async function handleStopInstructorAccess(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const cookies = parseCookies(req);
  let instructorPayload = null;
  try {
    const token = cookies[SESSION_COOKIE_NAMES.instructor];
    if (token && process.env.JWT_SECRET) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded && decoded.role === 'instructor' && decoded.impersonation === true) {
        instructorPayload = decoded;
      }
    }
  } catch {
    instructorPayload = null;
  }

  let admin = null;
  if (cookies[SESSION_COOKIE_NAMES.admin] || !instructorPayload) {
    admin = verifyAdminJWT(req);
  }

  if (!admin && !instructorPayload) return res.status(401).json({ error: 'Unauthorised' });

  appendSetCookie(res, buildSessionClearCookie(SESSION_COOKIE_NAMES.instructor));
  appendSetCookie(res, buildCsrfCookie(mintCsrfToken()));

  const returnInstructorAdmin = instructorPayload?.return_instructor_admin;
  if (returnInstructorAdmin && process.env.JWT_SECRET) {
    const restoredToken = jwt.sign(
      {
        id: returnInstructorAdmin.id,
        email: returnInstructorAdmin.email,
        role: 'instructor',
        school_id: returnInstructorAdmin.school_id,
        isAdmin: true,
      },
      process.env.JWT_SECRET,
      { expiresIn: '180d' }
    );
    appendSetCookie(res, buildSessionCookie(
      SESSION_COOKIE_NAMES.instructor,
      restoredToken,
      SESSION_MAX_AGE_SEC.instructor
    ));
  }

  const operatorId = admin?.id || returnInstructorAdmin?.id || null;
  const operatorEmail = admin?.email || returnInstructorAdmin?.email || null;
  const schoolId = admin ? getAdminSchoolId(admin, req) : (instructorPayload?.school_id || returnInstructorAdmin?.school_id || 1);
  if (instructorPayload) {
    try {
      const sql = neon(process.env.POSTGRES_URL);
      await logAudit(sql, {
        adminId: operatorId,
        adminEmail: operatorEmail,
        action: 'admin.instructor_access_stop',
        targetType: 'instructor',
        targetId: instructorPayload.id,
        details: {
          instructor_email: instructorPayload.email || null,
          started_by_admin_id: instructorPayload.impersonated_by_admin_id || null,
          started_by_admin_email: instructorPayload.impersonated_by_admin_email || null,
        },
        schoolId: instructorPayload.school_id || schoolId,
        req,
      });
    } catch (auditErr) {
      console.error('admin stop-instructor-access audit error:', auditErr.message);
    }
  }

  return res.json({ success: true });
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
        lu.current_tier, lu.credit_balance,
        COALESCE((
          SELECT SUM(lcb.balance_minutes)::int
          FROM learner_credit_balances lcb
          WHERE lcb.learner_id = lu.id
            AND lcb.school_id = ${schoolId}
        ), lu.balance_minutes, 0)::int AS balance_minutes,
        lu.pickup_address, lu.prefer_contact_before,
        lu.learner_category,
        lu.primary_instructor_id,
        pi.name AS primary_instructor_name,
        lu.test_date::text AS test_date,
        lu.created_at,
        (SELECT COUNT(*)::int FROM lesson_bookings lb
         WHERE lb.learner_id = lu.id AND lb.school_id = ${schoolId}) AS total_bookings,
        (SELECT COUNT(*)::int FROM lesson_bookings lb
         WHERE lb.learner_id = lu.id AND lb.status = ${SCHEDULED}
           AND lb.scheduled_date >= CURRENT_DATE AND lb.school_id = ${schoolId}) AS upcoming_bookings,
        (SELECT MAX(lb.scheduled_date)::text FROM lesson_bookings lb
         WHERE lb.learner_id = lu.id AND lb.school_id = ${schoolId}) AS last_booking_date,
        (SELECT MIN(lb.scheduled_date)::text FROM lesson_bookings lb
         WHERE lb.learner_id = lu.id AND lb.status = ${SCHEDULED}
           AND lb.scheduled_date >= CURRENT_DATE AND lb.school_id = ${schoolId}) AS next_booking_date,
        (SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (lb.end_time - lb.start_time)) / 60), 0)::int
         FROM lesson_bookings lb
         WHERE lb.learner_id = lu.id AND lb.status = ${CHARGEABLE}
           AND lb.school_id = ${schoolId}) AS delivered_minutes,
        (SELECT COUNT(*)::int FROM driving_sessions ds
         WHERE ds.user_id = lu.id AND ds.school_id = ${schoolId}) AS total_sessions
      FROM learner_users lu
      LEFT JOIN instructors pi
        ON pi.id = lu.primary_instructor_id
       AND pi.school_id = ${schoolId}
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
// -- GET /api/admin?action=learner-controls ---------------------------------
// Dense, read-mostly admin control room for key learner decisions.
async function handleLearnerControls(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = getAdminSchoolId(admin, req);

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const instructors = await sql`
      SELECT id, name, active, hourly_rate_pence
      FROM instructors
      WHERE school_id = ${schoolId}
      ORDER BY active DESC, name ASC
    `;

    const learners = await sql`
      WITH trial_stats AS (
        SELECT
          lb.learner_id,
          COUNT(*)::int AS trial_booking_count,
          MIN(lb.scheduled_date)::text AS first_trial_date,
          MAX(
            CASE
              WHEN lb.status = ${CHARGEABLE}
              THEN (lb.scheduled_date::timestamp + lb.end_time)::timestamptz
              ELSE NULL
            END
          ) AS completed_at
        FROM lesson_bookings lb
        JOIN lesson_types lt
          ON lt.id = lb.lesson_type_id
         AND lt.school_id = lb.school_id
        WHERE lb.school_id = ${schoolId}
          AND lt.slug = 'trial'
          AND lb.learner_id IS NOT NULL
        GROUP BY lb.learner_id
      ),
      booking_stats AS (
        SELECT
          learner_id,
          COUNT(*)::int AS total_bookings,
          COUNT(*) FILTER (WHERE status = ${SCHEDULED} AND scheduled_date >= CURRENT_DATE)::int AS upcoming_bookings,
          (MIN(scheduled_date) FILTER (WHERE status = ${SCHEDULED} AND scheduled_date >= CURRENT_DATE))::text AS next_booking_date,
          MAX(scheduled_date)::text AS last_booking_date,
          (MAX(scheduled_date) FILTER (WHERE status = ${CHARGEABLE}))::text AS last_lesson_date
        FROM lesson_bookings
        WHERE school_id = ${schoolId}
          AND learner_id IS NOT NULL
        GROUP BY learner_id
      ),
      credit_stats AS (
        SELECT
          lcb.learner_id,
          COALESCE(SUM(lcb.balance_minutes), 0)::int AS balance_minutes,
          json_agg(
            json_build_object(
              'instructor_id', lcb.instructor_id,
              'instructor_name', i.name,
              'balance_minutes', lcb.balance_minutes
            )
            ORDER BY i.name ASC
          ) AS balances
        FROM learner_credit_balances lcb
        JOIN instructors i
          ON i.id = lcb.instructor_id
         AND i.school_id = ${schoolId}
        WHERE lcb.school_id = ${schoolId}
        GROUP BY lcb.learner_id
      )
      SELECT
        lu.id,
        lu.name,
        lu.email,
        lu.phone,
        lu.pickup_address,
        lu.learner_category,
        lu.primary_instructor_id,
        pi.name AS primary_instructor_name,
        lu.test_date::text AS test_date,
        lu.test_time,
        lu.test_centre,
        COALESCE(lu.free_trial_allowed, TRUE) AS free_trial_allowed,
        lu.free_trial_completed_at,
        COALESCE(lu.test_instructor_booked, FALSE) AS test_instructor_booked,
        lu.admin_control_notes,
        COALESCE(cs.balance_minutes, lu.balance_minutes, 0)::int AS balance_minutes,
        COALESCE(cs.balances, '[]'::json) AS credit_balances,
        COALESCE(bs.total_bookings, 0)::int AS total_bookings,
        COALESCE(bs.upcoming_bookings, 0)::int AS upcoming_bookings,
        bs.next_booking_date,
        bs.last_booking_date,
        bs.last_lesson_date,
        COALESCE(ts.trial_booking_count, 0)::int AS trial_booking_count,
        ts.first_trial_date,
        COALESCE(lu.free_trial_completed_at, ts.completed_at) AS trial_completed_at,
        iln.custom_hourly_rate_pence,
        pi.hourly_rate_pence AS instructor_hourly_rate_pence
      FROM learner_users lu
      LEFT JOIN instructors pi
        ON pi.id = lu.primary_instructor_id
       AND pi.school_id = ${schoolId}
      LEFT JOIN instructor_learner_notes iln
        ON iln.learner_id = lu.id
       AND iln.instructor_id = lu.primary_instructor_id
       AND iln.school_id = ${schoolId}
      LEFT JOIN trial_stats ts ON ts.learner_id = lu.id
      LEFT JOIN booking_stats bs ON bs.learner_id = lu.id
      LEFT JOIN credit_stats cs ON cs.learner_id = lu.id
      WHERE lu.school_id = ${schoolId}
      ORDER BY
        CASE
          WHEN lu.test_date::text ~ '^\\d{4}-\\d{2}-\\d{2}$'
           AND lu.test_date::date >= CURRENT_DATE
          THEN 0
          ELSE 1
        END,
        CASE
          WHEN lu.test_date::text ~ '^\\d{4}-\\d{2}-\\d{2}$'
          THEN lu.test_date::date
          ELSE NULL
        END ASC NULLS LAST,
        lu.created_at DESC
    `;

    return res.json({ ok: true, learners, instructors });
  } catch (err) {
    console.error('admin learner-controls error:', err);
    reportError('/api/admin?action=learner-controls', err);
    return res.status(500).json({ error: 'Failed to load learner controls', details: 'Internal server error' });
  }
}

async function handleLearnerDetail(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = getAdminSchoolId(admin, req);

  const learnerId = parseInt(req.query.learner_id);
  if (!learnerId) return res.status(400).json({ error: 'learner_id is required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const [learner] = await sql`
      SELECT
        lu.id, lu.name, lu.email, lu.phone,
        lu.current_tier, lu.credit_balance,
        COALESCE((
          SELECT SUM(lcb.balance_minutes)::int
          FROM learner_credit_balances lcb
          WHERE lcb.learner_id = lu.id
            AND lcb.school_id = ${schoolId}
        ), lu.balance_minutes, 0)::int AS balance_minutes,
        lu.pickup_address, lu.prefer_contact_before,
        lu.learner_category,
        lu.primary_instructor_id,
        pi.name AS primary_instructor_name,
        lu.test_date::text AS test_date,
        lu.created_at
      FROM learner_users lu
      LEFT JOIN instructors pi
        ON pi.id = lu.primary_instructor_id
       AND pi.school_id = ${schoolId}
      WHERE lu.id = ${learnerId}
        AND lu.school_id = ${schoolId}
    `;
    if (!learner) return res.status(404).json({ error: 'Learner not found' });

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
      SELECT id, type, credits, minutes, amount_pence, payment_method, created_at
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

    const instructorLinks = await sql`
      WITH related_instructors AS (
        SELECT primary_instructor_id AS instructor_id
        FROM learner_users
        WHERE id = ${learnerId}
          AND school_id = ${schoolId}
          AND primary_instructor_id IS NOT NULL
        UNION
        SELECT instructor_id
        FROM lesson_bookings
        WHERE learner_id = ${learnerId}
          AND school_id = ${schoolId}
        UNION
        SELECT instructor_id
        FROM instructor_learner_notes
        WHERE learner_id = ${learnerId}
          AND school_id = ${schoolId}
        UNION
        SELECT instructor_id
        FROM learner_credit_balances
        WHERE learner_id = ${learnerId}
          AND school_id = ${schoolId}
      )
      SELECT
        i.id AS instructor_id,
        i.name AS instructor_name,
        iln.learner_category AS relationship_category,
        iln.test_date::text AS relationship_test_date,
        iln.notes AS relationship_notes,
        COUNT(lb.id)::int AS total_bookings,
        COUNT(lb.id) FILTER (WHERE lb.status = ${CHARGEABLE})::int AS delivered_lessons,
        COALESCE(SUM(EXTRACT(EPOCH FROM (lb.end_time - lb.start_time)) / 60)
          FILTER (WHERE lb.status = ${CHARGEABLE}), 0)::int AS delivered_minutes,
        COUNT(lb.id) FILTER (WHERE lb.status = ${SCHEDULED} AND lb.scheduled_date >= CURRENT_DATE)::int AS upcoming_lessons,
        MAX(lb.scheduled_date)::text AS last_booking_date
      FROM related_instructors ri
      JOIN instructors i
        ON i.id = ri.instructor_id
       AND i.school_id = ${schoolId}
      LEFT JOIN instructor_learner_notes iln
        ON iln.instructor_id = i.id
       AND iln.learner_id = ${learnerId}
       AND iln.school_id = ${schoolId}
      LEFT JOIN lesson_bookings lb
        ON lb.instructor_id = i.id
       AND lb.learner_id = ${learnerId}
        AND lb.school_id = ${schoolId}
      GROUP BY i.id, i.name, iln.learner_category, iln.test_date, iln.notes
      ORDER BY MAX(lb.scheduled_date) DESC NULLS LAST, i.name ASC
    `;

    const availability = await sql`
      SELECT day_of_week,
             start_time::text AS start_time,
             end_time::text AS end_time,
             active
      FROM learner_availability
      WHERE learner_id = ${learnerId}
        AND school_id = ${schoolId}
        AND active = true
      ORDER BY day_of_week, start_time
    `;

    return res.json({
      learner,
      bookings,
      transactions,
      progress: progress[0] || { total_sessions: 0, total_minutes: 0 },
      instructor_links: instructorLinks,
      availability
    });
  } catch (err) {
    console.error('admin learner-detail error:', err);
    reportError('/api/admin', err);
    return res.status(500).json({ error: 'Failed to load learner details', details: 'Internal server error' });
  }
}

// ── POST /api/admin?action=update-learner ─────────────────────────────────────
// Body: { id, name?, email?, phone?, pickup_address?, learner_category?, primary_instructor_id?, test_date? }
// Updates editable learner fields. Audit-logs before/after values.
async function handleUpdateLearnerControls(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = getAdminSchoolId(admin, req);

  const body = req.body || {};
  const learnerId = parseInt(body.learner_id || body.id, 10);
  if (!learnerId) return res.status(400).json({ error: 'Learner ID is required' });

  const category = body.learner_category != null && body.learner_category !== ''
    ? normaliseLearnerCategory(body.learner_category)
    : null;
  if (body.learner_category != null && body.learner_category !== '' && !category) {
    return res.status(400).json({ error: 'Invalid learner category' });
  }

  const primaryInstructorId = body.primary_instructor_id != null && body.primary_instructor_id !== ''
    ? parseInt(body.primary_instructor_id, 10)
    : null;
  if (body.primary_instructor_id != null && body.primary_instructor_id !== '' && (!primaryInstructorId || primaryInstructorId < 1)) {
    return res.status(400).json({ error: 'Invalid assigned instructor' });
  }

  const testDate = normaliseAdminControlDate(body.test_date, 'test_date');
  if (!testDate.ok) return res.status(400).json({ error: testDate.error });
  const testTime = normaliseAdminControlTime(body.test_time, 'test_time');
  if (!testTime.ok) return res.status(400).json({ error: testTime.error });

  const freeTrialAllowed = normaliseAdminControlBool(body.free_trial_allowed);
  if (freeTrialAllowed == null && body.free_trial_allowed != null && body.free_trial_allowed !== '') {
    return res.status(400).json({ error: 'free_trial_allowed must be true or false' });
  }
  const testInstructorBooked = normaliseAdminControlBool(body.test_instructor_booked);
  if (testInstructorBooked == null && body.test_instructor_booked != null && body.test_instructor_booked !== '') {
    return res.status(400).json({ error: 'test_instructor_booked must be true or false' });
  }

  let customHourlyRatePence = null;
  if (body.custom_hourly_rate_pence != null && body.custom_hourly_rate_pence !== '') {
    customHourlyRatePence = parseInt(body.custom_hourly_rate_pence, 10);
    if (!Number.isFinite(customHourlyRatePence) || customHourlyRatePence < 0 || customHourlyRatePence > 25000) {
      return res.status(400).json({ error: 'Custom hourly rate is invalid' });
    }
  }

  const testCentre = body.test_centre != null
    ? String(body.test_centre).trim().replace(/\s+/g, ' ').slice(0, 160) || null
    : null;
  const adminNotes = body.admin_control_notes != null
    ? String(body.admin_control_notes).trim().slice(0, 2000) || null
    : null;

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const [existing] = await sql`
      SELECT
        lu.id,
        lu.name,
        lu.email,
        lu.learner_category,
        lu.primary_instructor_id,
        lu.test_date::text AS test_date,
        lu.test_time,
        lu.test_centre,
        COALESCE(lu.free_trial_allowed, TRUE) AS free_trial_allowed,
        COALESCE(lu.test_instructor_booked, FALSE) AS test_instructor_booked,
        lu.admin_control_notes,
        iln.custom_hourly_rate_pence
      FROM learner_users lu
      LEFT JOIN instructor_learner_notes iln
        ON iln.learner_id = lu.id
       AND iln.instructor_id = lu.primary_instructor_id
       AND iln.school_id = ${schoolId}
      WHERE lu.id = ${learnerId}
        AND lu.school_id = ${schoolId}
    `;
    if (!existing) return res.status(404).json({ error: 'Learner not found' });

    if (primaryInstructorId) {
      const [instructor] = await sql`
        SELECT id FROM instructors
        WHERE id = ${primaryInstructorId}
          AND school_id = ${schoolId}
          AND active = TRUE
      `;
      if (!instructor) return res.status(400).json({ error: 'Assigned instructor must be an active instructor in this school' });
    }

    if (customHourlyRatePence != null && !primaryInstructorId) {
      return res.status(400).json({ error: 'Assign an instructor before setting a learner hourly rate' });
    }

    const [updated] = await sql`
      UPDATE learner_users
      SET learner_category = ${category},
          primary_instructor_id = ${primaryInstructorId},
          test_date = ${testDate.value},
          test_time = ${testTime.value},
          test_centre = ${testCentre},
          free_trial_allowed = ${freeTrialAllowed},
          test_instructor_booked = ${testInstructorBooked},
          admin_control_notes = ${adminNotes}
      WHERE id = ${learnerId}
        AND school_id = ${schoolId}
      RETURNING id, learner_category, primary_instructor_id, test_date::text AS test_date,
                test_time, test_centre, free_trial_allowed, test_instructor_booked,
                admin_control_notes
    `;

    let relationship = null;
    if (primaryInstructorId) {
      const [row] = await sql`
        INSERT INTO instructor_learner_notes
          (instructor_id, learner_id, learner_category, custom_hourly_rate_pence, school_id, updated_at)
        VALUES
          (${primaryInstructorId}, ${learnerId}, ${category}, ${customHourlyRatePence}, ${schoolId}, NOW())
        ON CONFLICT (instructor_id, learner_id)
        DO UPDATE SET learner_category = ${category},
                      custom_hourly_rate_pence = ${customHourlyRatePence},
                      school_id = ${schoolId},
                      updated_at = NOW()
        RETURNING instructor_id, learner_id, learner_category, custom_hourly_rate_pence
      `;
      relationship = row || null;
    }

    await logAudit(sql, {
      adminId: admin.id,
      adminEmail: admin.email,
      action: 'admin.update_learner_controls',
      targetType: 'learner',
      targetId: learnerId,
      details: {
        before: {
          learner_category: existing.learner_category,
          primary_instructor_id: existing.primary_instructor_id,
          test_date: existing.test_date,
          test_time: existing.test_time,
          test_centre: existing.test_centre,
          free_trial_allowed: existing.free_trial_allowed,
          test_instructor_booked: existing.test_instructor_booked,
          admin_control_notes: existing.admin_control_notes,
          custom_hourly_rate_pence: existing.custom_hourly_rate_pence
        },
        after: {
          learner_category: updated.learner_category,
          primary_instructor_id: updated.primary_instructor_id,
          test_date: updated.test_date,
          test_time: updated.test_time,
          test_centre: updated.test_centre,
          free_trial_allowed: updated.free_trial_allowed,
          test_instructor_booked: updated.test_instructor_booked,
          admin_control_notes: updated.admin_control_notes,
          custom_hourly_rate_pence: relationship?.custom_hourly_rate_pence ?? null
        }
      },
      schoolId,
      req
    });

    return res.json({ ok: true, learner: updated, relationship });
  } catch (err) {
    console.error('admin update-learner-controls error:', err);
    reportError('/api/admin?action=update-learner-controls', err);
    return res.status(500).json({ error: 'Failed to update learner controls', details: 'Internal server error' });
  }
}

async function handleUpdateLearner(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = getAdminSchoolId(admin, req);

  const { id, name, email, phone, pickup_address, learner_category, primary_instructor_id, test_date } = req.body || {};
  if (!id) return res.status(400).json({ error: 'Learner ID is required' });

  const category = learner_category != null && learner_category !== '' ? normaliseLearnerCategory(learner_category) : null;
  if (learner_category != null && learner_category !== '' && !category) {
    return res.status(400).json({ error: 'Invalid learner category' });
  }
  const primaryInstructorId = primary_instructor_id != null && primary_instructor_id !== ''
    ? parseInt(primary_instructor_id, 10)
    : null;
  if (primary_instructor_id != null && primary_instructor_id !== '' && (!primaryInstructorId || primaryInstructorId < 1)) {
    return res.status(400).json({ error: 'Invalid assigned instructor' });
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Fetch current values for audit before/after
    const [existing] = await sql`
      SELECT id, name, email, phone, pickup_address, learner_category, primary_instructor_id, test_date::text AS test_date
      FROM learner_users WHERE id = ${id} AND school_id = ${schoolId}
    `;
    if (!existing) return res.status(404).json({ error: 'Learner not found' });

    // Build update values — keep current if not provided
    const newName    = name !== undefined ? name.trim() : existing.name;
    const newEmail   = email !== undefined ? email.trim().toLowerCase() : existing.email;
    const newPhone   = phone !== undefined ? phone.trim() || null : existing.phone;
    const newPickup  = pickup_address !== undefined ? pickup_address.trim() || null : existing.pickup_address;
    const newCategory = learner_category !== undefined ? category : existing.learner_category;
    const newPrimaryInstructorId = primary_instructor_id !== undefined ? primaryInstructorId : existing.primary_instructor_id;
    const newTestDate = test_date !== undefined ? (test_date || null) : existing.test_date;

    // Check email uniqueness within school (if changed)
    if (newEmail !== existing.email) {
      const conflict = await sql`
        SELECT id FROM learner_users WHERE email = ${newEmail} AND id != ${id} AND school_id = ${schoolId}
      `;
      if (conflict.length > 0) return res.status(409).json({ error: 'That email is already used by another learner' });
    }

    // Check phone uniqueness within school (if changed)
    if (newPhone && newPhone !== existing.phone) {
      const phoneConflict = await sql`
        SELECT id FROM learner_users WHERE phone = ${newPhone} AND id != ${id} AND school_id = ${schoolId}
      `;
      if (phoneConflict.length > 0) return res.status(409).json({ error: 'That phone number is already used by another learner' });
    }

    if (newPrimaryInstructorId) {
      const [instructor] = await sql`
        SELECT id FROM instructors
        WHERE id = ${newPrimaryInstructorId}
          AND school_id = ${schoolId}
          AND active = TRUE
      `;
      if (!instructor) return res.status(400).json({ error: 'Assigned instructor must be an active instructor in this school' });
    }

    const rows = await sql`
      UPDATE learner_users
      SET name           = ${newName},
          email          = ${newEmail},
          phone          = ${newPhone},
          pickup_address = ${newPickup},
          learner_category = ${newCategory},
          primary_instructor_id = ${newPrimaryInstructorId},
          test_date = ${newTestDate}
      WHERE id = ${id} AND school_id = ${schoolId}
      RETURNING id, name, email, phone, pickup_address, learner_category, primary_instructor_id, test_date::text AS test_date
    `;

    const after = rows[0];
    let assignmentLink = null;
    if (newPrimaryInstructorId) {
      assignmentLink = await ensureInstructorLearnerLink(sql, {
        instructorId: newPrimaryInstructorId,
        learnerId: parseInt(id, 10),
        schoolId,
      });
    }

    await logAudit(sql, {
      adminId: admin.id, adminEmail: admin.email,
      action: 'update-learner', targetType: 'learner', targetId: id,
      details: {
        before: {
          name: existing.name,
          email: existing.email,
          phone: existing.phone,
          pickup_address: existing.pickup_address,
          learner_category: existing.learner_category,
          primary_instructor_id: existing.primary_instructor_id,
          test_date: existing.test_date
        },
        after: {
          name: after.name,
          email: after.email,
          phone: after.phone,
          pickup_address: after.pickup_address,
          learner_category: after.learner_category,
          primary_instructor_id: after.primary_instructor_id,
          test_date: after.test_date
        },
        assignment_link_created: !!assignmentLink
      },
      schoolId, req
    });

    await logAudit(sql, {
      adminId: admin.id, adminEmail: admin.email,
      action: 'admin.update_learner',
      targetType: 'learner', targetId: parseInt(id, 10),
      details: { fields_changed: Object.keys(req.body || {}).filter(k => k !== 'id') },
      schoolId, req,
    });

    return res.json({ ok: true, learner: after, assignment_link: assignmentLink });
  } catch (err) {
    console.error('admin update-learner error:', err);
    reportError('/api/admin', err);
    return res.status(500).json({ error: 'Failed to update learner', details: 'Internal server error' });
  }
}

// ── POST /api/admin?action=adjust-credits ─────────────────────────────────────
// Body: { learner_id, hours: float (e.g. 1.5), reason }
// Positive = add, negative = remove. Updates balance_minutes (primary) + credit_balance (legacy).
// Body: { learner_id, instructor_id, learner_category? }
// Updates the per-instructor learner relationship category.
async function handleUpdateLearnerRelationship(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = getAdminSchoolId(admin, req);

  const { learner_id, instructor_id, learner_category } = req.body || {};
  const learnerId = parseInt(learner_id, 10);
  const instructorId = parseInt(instructor_id, 10);
  if (!learnerId || !instructorId) return res.status(400).json({ error: 'learner_id and instructor_id are required' });

  const category = learner_category != null && learner_category !== '' ? normaliseLearnerCategory(learner_category) : null;
  if (learner_category != null && learner_category !== '' && !category) {
    return res.status(400).json({ error: 'Invalid learner category' });
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const [scope] = await sql`
      SELECT
        EXISTS (SELECT 1 FROM learner_users WHERE id = ${learnerId} AND school_id = ${schoolId}) AS learner_ok,
        EXISTS (SELECT 1 FROM instructors WHERE id = ${instructorId} AND school_id = ${schoolId}) AS instructor_ok
    `;
    if (!scope?.learner_ok || !scope?.instructor_ok) {
      return res.status(404).json({ error: 'Learner or instructor not found' });
    }

    const [before] = await sql`
      SELECT learner_category
      FROM instructor_learner_notes
      WHERE learner_id = ${learnerId}
        AND instructor_id = ${instructorId}
        AND school_id = ${schoolId}
    `;

    const [row] = await sql`
      INSERT INTO instructor_learner_notes (instructor_id, learner_id, learner_category, school_id, updated_at)
      VALUES (${instructorId}, ${learnerId}, ${category}, ${schoolId}, NOW())
      ON CONFLICT (instructor_id, learner_id)
      DO UPDATE SET learner_category = ${category}, school_id = ${schoolId}, updated_at = NOW()
      RETURNING instructor_id, learner_id, learner_category
    `;

    await logAudit(sql, {
      adminId: admin.id,
      adminEmail: admin.email,
      action: 'admin.update_learner_relationship',
      targetType: 'learner',
      targetId: learnerId,
      details: {
        instructor_id: instructorId,
        before: before?.learner_category || null,
        after: row.learner_category || null
      },
      schoolId,
      req
    });

    return res.json({ ok: true, relationship: row });
  } catch (err) {
    console.error('admin update-learner-relationship error:', err);
    reportError('/api/admin', err);
    return res.status(500).json({ error: 'Failed to update learner relationship', details: 'Internal server error' });
  }
}

// GET/POST /api/admin?action=learner-broadcast-preview
// Body/query: { categories: ['regular', ...] }
// Returns the exact school-scoped recipient set that the send action will use.
async function handleLearnerBroadcastPreview(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = getAdminSchoolId(admin, req);

  const rawCategories = req.method === 'GET'
    ? String(req.query.categories || '').split(',').filter(Boolean)
    : req.body?.categories;
  const validated = normaliseBroadcastCategories(rawCategories);
  if (!validated.ok) {
    return res.status(validated.status).json({ error: true, code: validated.code, message: validated.message });
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const preview = await resolveLearnerBroadcastRecipients(sql, schoolId, validated.categories);
    return res.json({ ok: true, categories: validated.categories, ...preview });
  } catch (err) {
    console.error('admin learner-broadcast-preview error:', err);
    reportError('/api/admin?action=learner-broadcast-preview', err);
    return res.status(500).json({ error: true, code: 'BROADCAST_PREVIEW_FAILED', message: 'Failed to preview learner broadcast.' });
  }
}

// POST /api/admin?action=send-learner-broadcast
// Body: { label, message_body, categories[] }
async function handleSendLearnerBroadcast(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = getAdminSchoolId(admin, req);

  const label = String(req.body?.label || '').trim();
  const messageBody = String(req.body?.message_body || '').trim();
  const validated = normaliseBroadcastCategories(req.body?.categories);

  if (!validated.ok) {
    return res.status(validated.status).json({ error: true, code: validated.code, message: validated.message });
  }
  if (!label) {
    return res.status(400).json({ error: true, code: 'LABEL_REQUIRED', message: 'Broadcast label is required.' });
  }
  if (label.length > 120) {
    return res.status(400).json({ error: true, code: 'LABEL_TOO_LONG', message: 'Broadcast label must be 120 characters or fewer.' });
  }
  if (!messageBody) {
    return res.status(400).json({ error: true, code: 'MESSAGE_REQUIRED', message: 'Message body is required.' });
  }
  if (messageBody.length > 1000) {
    return res.status(400).json({ error: true, code: 'MESSAGE_TOO_LONG', message: 'Message body must be 1000 characters or fewer.' });
  }

  const sql = neon(process.env.POSTGRES_URL);
  let broadcastId = null;

  try {
    const resolved = await resolveLearnerBroadcastRecipients(sql, schoolId, validated.categories);
    if (resolved.recipients.length === 0) {
      return res.status(400).json({
        error: true,
        code: 'NO_USABLE_RECIPIENTS',
        message: 'No selected learners have a usable phone number.',
        categories: validated.categories,
        skipped: resolved.skipped,
        counts: resolved.counts,
      });
    }
    if (resolved.recipients.length > BROADCAST_MAX_RECIPIENTS) {
      return res.status(400).json({
        error: true,
        code: 'TOO_MANY_RECIPIENTS',
        message: `This broadcast has ${resolved.recipients.length} recipients. The first version is capped at ${BROADCAST_MAX_RECIPIENTS}.`,
        counts: resolved.counts,
      });
    }

    const [broadcast] = await sql`
      INSERT INTO learner_broadcasts (
        school_id, label, message_body, selected_categories, created_by,
        status, recipient_count, skipped_count
      ) VALUES (
        ${schoolId}, ${label}, ${messageBody}, ${validated.categories}, ${admin.id || null},
        'sending', ${resolved.recipients.length}, ${resolved.skipped.length}
      )
      RETURNING id, label, message_body, selected_categories, status, created_at
    `;
    broadcastId = broadcast.id;

    for (const learner of resolved.skipped) {
      await sql`
        INSERT INTO learner_broadcast_recipients (
          school_id, broadcast_id, learner_id, learner_name, learner_email,
          phone, learner_category, status, skip_reason
        ) VALUES (
          ${schoolId}, ${broadcastId}, ${learner.learner_id}, ${learner.name}, ${learner.email},
          ${learner.phone}, ${learner.learner_category}, 'skipped', ${learner.skip_reason}
        )
      `;
    }

    const sentRows = [];
    let sentCount = 0;
    let failedCount = 0;
    let skippedDuringSendCount = 0;

    for (const learner of resolved.recipients) {
      const result = await sendWhatsApp(learner.phone, messageBody, {
        purpose: 'admin.learner_broadcast',
        learnerId: learner.learner_id,
        schoolId,
      });
      const status = result?.ok ? 'sent' : (result?.status === 'skipped' ? 'skipped' : 'failed');
      if (status === 'sent') sentCount += 1;
      else if (status === 'skipped') skippedDuringSendCount += 1;
      else failedCount += 1;

      const [row] = await sql`
        INSERT INTO learner_broadcast_recipients (
          school_id, broadcast_id, learner_id, learner_name, learner_email,
          phone, learner_category, status, skip_reason, error_message, sent_at
        ) VALUES (
          ${schoolId}, ${broadcastId}, ${learner.learner_id}, ${learner.name}, ${learner.email},
          ${learner.phone}, ${learner.learner_category}, ${status},
          ${status === 'skipped' ? 'messaging_skipped' : null},
          ${summariseBroadcastError(result)},
          ${status === 'sent' ? new Date().toISOString() : null}
        )
        RETURNING learner_id, learner_name AS name, learner_email AS email, phone,
                  learner_category, status, skip_reason, error_message
      `;
      sentRows.push(row);
    }

    const finalSkippedCount = resolved.skipped.length + skippedDuringSendCount;
    const finalStatus = failedCount > 0 || skippedDuringSendCount > 0 ? 'partial_failed' : 'sent';
    const [updated] = await sql`
      UPDATE learner_broadcasts
      SET status = ${finalStatus},
          sent_count = ${sentCount},
          failed_count = ${failedCount},
          skipped_count = ${finalSkippedCount},
          completed_at = NOW()
      WHERE id = ${broadcastId}
        AND school_id = ${schoolId}
      RETURNING id, label, message_body, selected_categories, status,
                recipient_count, skipped_count, sent_count, failed_count,
                created_at, completed_at
    `;

    await logAudit(sql, {
      adminId: admin.id,
      adminEmail: admin.email,
      action: 'admin.send_learner_broadcast',
      targetType: 'learner_broadcast',
      targetId: broadcastId,
      details: {
        label,
        selected_categories: validated.categories,
        recipient_count: resolved.recipients.length,
        skipped_count: finalSkippedCount,
        sent_count: sentCount,
        failed_count: failedCount,
      },
      schoolId,
      req,
    });

    return res.json({
      ok: true,
      broadcast: updated,
      recipients: sentRows,
      skipped: resolved.skipped,
    });
  } catch (err) {
    console.error('admin send-learner-broadcast error:', err);
    if (broadcastId) {
      try {
        await sql`
          UPDATE learner_broadcasts
          SET status = 'failed', completed_at = NOW()
          WHERE id = ${broadcastId}
            AND school_id = ${schoolId}
        `;
      } catch (updateErr) {
        console.error('admin send-learner-broadcast status update error:', updateErr.message);
      }
    }
    reportError('/api/admin?action=send-learner-broadcast', err);
    return res.status(500).json({ error: true, code: 'BROADCAST_SEND_FAILED', message: 'Failed to send learner broadcast.' });
  }
}

// GET /api/admin?action=learner-broadcast-history
async function handleLearnerBroadcastHistory(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = getAdminSchoolId(admin, req);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const broadcasts = await sql`
      SELECT lb.id, lb.label, lb.message_body, lb.selected_categories, lb.status,
             lb.recipient_count, lb.skipped_count, lb.sent_count, lb.failed_count,
             lb.created_at, lb.completed_at, au.name AS created_by_name
      FROM learner_broadcasts lb
      LEFT JOIN admin_users au
        ON au.id = lb.created_by
       AND au.school_id = ${schoolId}
      WHERE lb.school_id = ${schoolId}
      ORDER BY lb.created_at DESC, lb.id DESC
      LIMIT ${limit}
    `;

    const ids = broadcasts.map(row => row.id);
    let recipientRows = [];
    if (ids.length > 0) {
      recipientRows = await sql`
        SELECT broadcast_id, learner_id, learner_name AS name, learner_email AS email,
               phone, learner_category, status, skip_reason, error_message, sent_at, created_at
        FROM learner_broadcast_recipients
        WHERE school_id = ${schoolId}
          AND broadcast_id = ANY(${ids}::int[])
        ORDER BY broadcast_id DESC, status ASC, learner_name ASC NULLS LAST, learner_id ASC
      `;
    }

    const recipientsByBroadcast = new Map();
    for (const row of recipientRows) {
      if (!recipientsByBroadcast.has(row.broadcast_id)) recipientsByBroadcast.set(row.broadcast_id, []);
      recipientsByBroadcast.get(row.broadcast_id).push(row);
    }

    return res.json({
      ok: true,
      broadcasts: broadcasts.map(row => ({
        ...row,
        recipients: recipientsByBroadcast.get(row.id) || [],
      })),
    });
  } catch (err) {
    console.error('admin learner-broadcast-history error:', err);
    reportError('/api/admin?action=learner-broadcast-history', err);
    return res.status(500).json({ error: true, code: 'BROADCAST_HISTORY_FAILED', message: 'Failed to load learner broadcast history.' });
  }
}

// GET /api/admin?action=learner-feedback
async function handleLearnerFeedback(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = getAdminSchoolId(admin, req);
  const status = String(req.query.status || '').trim().toLowerCase();
  const type = String(req.query.type || '').trim().toLowerCase();
  const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 50, 100));

  if (status && !['open', 'reviewed', 'closed'].includes(status)) {
    return res.status(400).json({ error: true, code: 'INVALID_FEEDBACK_STATUS', message: 'Invalid feedback status.' });
  }
  if (type && !['issue', 'suggestion'].includes(type)) {
    return res.status(400).json({ error: true, code: 'INVALID_FEEDBACK_TYPE', message: 'Invalid feedback type.' });
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const feedback = await sql`
      SELECT lf.id, lf.type, lf.title, lf.message, lf.page_url, lf.status,
             lf.reviewed_at, lf.created_at,
             lu.id AS learner_id, lu.name AS learner_name, lu.email AS learner_email,
             lu.phone AS learner_phone
      FROM learner_feedback lf
      JOIN learner_users lu
        ON lu.id = lf.learner_id
       AND lu.school_id = lf.school_id
      WHERE lf.school_id = ${schoolId}
        AND (${status || null}::text IS NULL OR lf.status = ${status})
        AND (${type || null}::text IS NULL OR lf.type = ${type})
      ORDER BY
        CASE WHEN lf.status = 'open' THEN 0 ELSE 1 END,
        lf.created_at DESC
      LIMIT ${limit}`;

    return res.json({ ok: true, feedback });
  } catch (err) {
    console.error('admin learner-feedback error:', err);
    reportError('/api/admin?action=learner-feedback', err);
    return res.status(500).json({ error: true, code: 'FEEDBACK_LIST_FAILED', message: 'Failed to load learner feedback.' });
  }
}

// POST /api/admin?action=update-learner-feedback
async function handleUpdateLearnerFeedback(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = getAdminSchoolId(admin, req);
  const id = parseInt(req.body?.id, 10);
  const status = String(req.body?.status || '').trim().toLowerCase();

  if (!id) return res.status(400).json({ error: true, code: 'FEEDBACK_ID_REQUIRED', message: 'Feedback id is required.' });
  if (!['open', 'reviewed', 'closed'].includes(status)) {
    return res.status(400).json({ error: true, code: 'INVALID_FEEDBACK_STATUS', message: 'Invalid feedback status.' });
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const [existing] = await sql`
      SELECT id, learner_id, type, title, status
      FROM learner_feedback
      WHERE id = ${id} AND school_id = ${schoolId}`;
    if (!existing) return res.status(404).json({ error: true, code: 'FEEDBACK_NOT_FOUND', message: 'Feedback not found.' });

    const [feedback] = await sql`
      UPDATE learner_feedback
      SET status = ${status},
          reviewed_at = CASE WHEN ${status} = 'open' THEN NULL ELSE COALESCE(reviewed_at, NOW()) END
      WHERE id = ${id} AND school_id = ${schoolId}
      RETURNING id, type, title, status, reviewed_at`;

    await logAudit(sql, {
      adminId: admin.id,
      adminEmail: admin.email,
      action: 'learner_feedback.update_status',
      targetType: 'learner_feedback',
      targetId: id,
      details: {
        learner_id: existing.learner_id,
        type: existing.type,
        title: existing.title,
        previous_status: existing.status,
        status,
      },
      schoolId,
      req,
    });

    return res.json({ ok: true, feedback });
  } catch (err) {
    console.error('admin update-learner-feedback error:', err);
    reportError('/api/admin?action=update-learner-feedback', err);
    return res.status(500).json({ error: true, code: 'FEEDBACK_UPDATE_FAILED', message: 'Failed to update learner feedback.' });
  }
}

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

    // Step 4 cutover: lockBalanceAndMutate writes balance + ledger
    // atomically inside one CTE.
    //
    // Phase-2A scoping (PR #174 review P3 fix). Admin adjust-credits is
    // historically pooled — the UI doesn't pick an instructor. Under
    // Phase 2A every mutation must land on a specific LCB row. Resolve
    // the target instructor based on the learner's existing LCB rows:
    //
    //   - 0 LCB rows  → grandfather to instructor 1 (Fraser). Same as the
    //                   dispatcher's default; explicit here for audit. The
    //                   negative-balance pre-check uses the aggregate shadow
    //                   because there's no LCB row to read.
    //   - 1 LCB row   → use that instructor. Pre-check reads that row's
    //                   balance directly.
    //   - 2+ LCB rows → AMBIGUOUS_INSTRUCTOR. Admin must re-issue with an
    //                   explicit instructor_id. Without this guard, a
    //                   aggregate pre-check could pass while the LCB write
    //                   minted a negative balance on the wrong row.
    //
    // Accept req.body.instructor_id when present so the admin UI can
    // pass it explicitly and skip the auto-resolve.
    const explicitInstructorId = parseInt(req.body.instructor_id, 10);
    let targetInstructorId;
    let preCheckBalance;
    if (!Number.isFinite(explicitInstructorId) || explicitInstructorId <= 0) {
      const lcbRows = await sql`
        SELECT instructor_id, balance_minutes
          FROM learner_credit_balances
         WHERE learner_id = ${learner_id}
           AND school_id = ${schoolId}
         ORDER BY instructor_id
      `;
      const resolved = resolveAdjustCreditsTarget({ learner, lcbRows, explicitInstructorId: req.body.instructor_id });
      if (!resolved.ok) {
        return res.status(409).json({
          error: 'AMBIGUOUS_INSTRUCTOR',
          message: `Learner has balances with ${resolved.count} instructors. Re-issue this request with an explicit instructor_id.`,
          instructor_ids: resolved.instructorIds,
        });
      }
      targetInstructorId = resolved.targetInstructorId;
      preCheckBalance = resolved.preCheckBalance;
    } else {
      // Explicit instructor — read THAT row's balance for the pre-check
      // so an admin can't accidentally take Fraser negative by passing
      // instructor_id=1 when the learner's balance lives elsewhere.
      const [lcbRow] = await sql`
        SELECT balance_minutes
          FROM learner_credit_balances
         WHERE learner_id = ${learner_id}
           AND instructor_id = ${explicitInstructorId}
           AND school_id = ${schoolId}
      `;
      const resolved = resolveAdjustCreditsTarget({
        learner,
        explicitInstructorId: req.body.instructor_id,
        explicitLcbRow: lcbRow,
      });
      targetInstructorId = resolved.targetInstructorId;
      preCheckBalance = resolved.preCheckBalance;
    }

    // Prevent negative balance (now against the resolved target).
    const newMinutes = preCheckBalance + minutesDelta;
    if (newMinutes < 0) {
      return res.status(400).json({
        error: `Cannot reduce below 0. Instructor ${targetInstructorId} balance: ${Math.round(preCheckBalance / 60 * 10) / 10} hours`
      });
    }

    // Trade-off accepted: credit_balance is incremented additively
    // (creditsDelta = Math.round(hoursFloat)) rather than re-derived from
    // balance_minutes / 60. For fractional adjustments this can drift over
    // many grants. credit_balance is the legacy cosmetic counter; the next
    // purchase via grantCredits rebases it. Admin grants are infrequent
    // enough that the drift is acceptable.
    const creditsDelta = Math.round(hoursFloat);
    // allowOverdraft: false (defence-in-depth — the pre-check above is
    // racy against concurrent writers on the same LCB row; the helper's
    // own deduct-guard inside the CTE refuses overdraft at write time).
    // Grants (positive delta) skip the guard inside the helper anyway.
    const adj = await lockBalanceAndMutate(sql, {
      learnerId: learner_id,
      schoolId,
      instructorId: targetInstructorId,
      delta: minutesDelta,
      creditsDelta,
      ledgerType: minutesDelta > 0 ? 'admin_add' : 'admin_remove',
      reason: reason || 'Admin adjustment',
      source: 'goodwill',
      absorbedBy: 'platform',
      allowOverdraft: false,
    });
    if (!adj.ok) {
      if (adj.code === 'INSUFFICIENT_BALANCE') {
        return res.status(400).json({
          error: `Cannot reduce below 0. Instructor ${targetInstructorId} balance: ${Math.round((adj.balanceMinutes || 0) / 60 * 10) / 10} hours`
        });
      }
      console.error('admin adjust-credits failed:', adj.code);
      return res.status(500).json({ error: 'Failed to adjust learner balance' });
    }
    // Re-read the aggregate shadow for the response/audit compatibility
    // fields. lockBalanceAndMutate returns the scoped LCB balance.
    const [updated] = await sql`SELECT balance_minutes, credit_balance FROM learner_users WHERE id = ${learner_id} AND school_id = ${schoolId}`;

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

// Step 5.5 goodwill grant. Uses the shared LCB-serialised credit mutation
// path; credit-reconciliation below is gated by inspection before mutation.
async function handleCreditGoodwillContract(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Admin auth required' });
  const schoolId = getAdminSchoolId(admin, req);

  const validated = validateGoodwillRequest(req.body || {}, { schoolId });
  if (!validated.ok) {
    return res.status(validated.status).json({
      error: true,
      code: validated.code,
      message: validated.message,
    });
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const result = await grantGoodwillCredits({
      sql,
      admin,
      schoolId,
      input: validated.input,
      req,
    });

    if (!result.ok) {
      return res.status(result.status || 500).json({
        error: true,
        code: result.code || 'CREDIT_GOODWILL_FAILED',
        message: result.message || 'Failed to grant goodwill credits.',
      });
    }

    return res.json(result);
  } catch (err) {
    console.error('admin credit-goodwill error:', err.message);
    reportError('/api/admin', err);
    return res.status(500).json({ error: true, code: 'CREDIT_GOODWILL_FAILED', message: 'Failed to grant goodwill credits.' });
  }
}

function isCreditReconciliationDryRun(body = {}) {
  return body.dry_run === true || body.mode === 'inspect';
}

function decorateCreditReconciliationInspection(result = {}) {
  const message = result.message
    ? `Inspection only: ${result.message} No credit was granted.`
    : 'Inspection only: no credit was granted.';
  return {
    ...result,
    inspection_only: true,
    credit_granted: false,
    message,
  };
}

// Step 5.5 reconciliation. Dry-run requests remain inspection-only; mutating
// requests are gated by the same inspection preview before any credit write.
async function handleCreditReconciliationContract(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Admin auth required' });
  const schoolId = getAdminSchoolId(admin, req);

  const validated = validateReconciliationRequest(req.body || {}, { schoolId });
  if (!validated.ok) {
    return res.status(validated.status).json({
      error: true,
      code: validated.code,
      message: validated.message,
    });
  }

  if (isCreditReconciliationDryRun(req.body || {})) {
    try {
      const sql = req.sql || req._sql || neon(process.env.POSTGRES_URL);
      const stripeClient = req.stripeClient || req._stripe || createStripeClient();
      const result = await inspectCreditReconciliation({
        sql,
        stripe: stripeClient,
        schoolId,
        input: validated.input,
      });

      return res.status(result.status || 200).json(decorateCreditReconciliationInspection(result));
    } catch (err) {
      console.error('admin credit-reconciliation inspection error:', err.message);
      reportError('/api/admin', err);
      return res.status(500).json({
        error: true,
        code: 'CREDIT_RECONCILIATION_INSPECTION_FAILED',
        message: 'Inspection only: failed to inspect credit reconciliation. No credit was granted.',
        inspection_only: true,
        credit_granted: false,
      });
    }
  }

  if (!validated.input.reason) {
    return res.status(400).json({
      error: true,
      code: 'INVALID_REASON',
      message: 'reason is required.',
    });
  }

  try {
    const sql = req.sql || req._sql || neon(process.env.POSTGRES_URL);
    const stripeClient = req.stripeClient || req._stripe || createStripeClient();
    const result = await grantReconciliationCredits({
      sql,
      stripe: stripeClient,
      admin,
      schoolId,
      input: validated.input,
      req,
    });

    return res.status(result.status || 200).json(result);
  } catch (err) {
    console.error('admin credit-reconciliation error:', err.message);
    reportError('/api/admin', err);
    return res.status(500).json({
      error: true,
      code: 'CREDIT_RECONCILIATION_FAILED',
      message: 'Failed to reconcile credits.',
      credit_granted: false,
    });
  }
}

// Read-only refund planner. This deliberately does not create refund_events,
// mutate credit balances, update CSA, or call stripe.refunds.create.
async function handleRefundPreview(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Admin auth required' });
  const schoolId = getAdminSchoolId(admin, req);

  const validated = validateRefundPreviewRequest(req.body || {}, { schoolId });
  if (!validated.ok) {
    return res.status(validated.status).json({
      error: true,
      code: validated.code,
      message: validated.message,
    });
  }

  try {
    const sql = req.sql || req._sql || neon(process.env.POSTGRES_URL);
    const stripeClient = req.stripeClient || req._stripe || createStripeClient();
    const result = await planAdminRefundPreview({
      sql,
      stripe: stripeClient,
      input: validated.input,
    });

    if (!result.ok) {
      return res.status(result.status || 400).json({
        error: true,
        code: result.code || 'REFUND_PREVIEW_FAILED',
        message: result.message || 'Refund preview could not be prepared.',
      });
    }

    return res.status(result.status || 200).json(result);
  } catch (err) {
    console.error('admin refund-preview error:', err.message);
    reportError('/api/admin', err);
    return res.status(500).json({
      error: true,
      code: 'REFUND_PREVIEW_FAILED',
      message: 'Failed to prepare refund preview.',
    });
  }
}

// Tightly gated refund execution. This re-runs the trusted server-side planner
// and only calls Stripe through an injected/created client after all blockers
// have cleared. Do not run against prod without a future explicit operator go.
async function handleExecuteRefund(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Admin auth required' });
  const schoolId = getAdminSchoolId(admin, req);

  const validated = validateRefundExecuteRequest(req.body || {}, { schoolId });
  if (!validated.ok) {
    return res.status(validated.status).json({
      error: true,
      code: validated.code,
      message: validated.message,
    });
  }

  try {
    const sql = req.sql || req._sql || neon(process.env.POSTGRES_URL);
    const stripeClient = req.stripeClient || req._stripe || createStripeClient();
    const result = await executeAdminRefund({
      sql,
      stripe: stripeClient,
      admin,
      schoolId,
      input: validated.input,
      req,
      adjustCreditBalance: req.adjustCreditBalance || req._adjustCreditBalance,
      auditLogger: req.auditLogger || req._auditLogger,
      connectionString: (req.sql || req._sql) ? req.connectionString : process.env.POSTGRES_URL,
      transactionRunner: req.transactionRunner || req._transactionRunner,
    });

    if (!result.ok) {
      return res.status(result.status || 400).json({
        error: true,
        code: result.code || 'REFUND_EXECUTE_FAILED',
        message: result.message || 'Refund could not be executed.',
        refund_executed: false,
        stripe_refund_id: result.stripe_refund_id,
        refund_event_id: result.refund_event_id,
      });
    }

    return res.status(result.status || 200).json(result);
  } catch (err) {
    console.error('admin execute-refund error:', err.message);
    reportError('/api/admin', err);
    return res.status(500).json({
      error: true,
      code: 'REFUND_EXECUTE_FAILED',
      message: 'Failed to execute refund.',
      refund_executed: false,
    });
  }
}

// Ledger-only manual bank refund recording. This records an approved manual
// bank refund after a server-side preview, but never calls stripe.refunds,
// changes booking status, edits payout rows, or mutates learner credit.
async function handleRecordManualBankRefund(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Admin auth required' });
  const schoolId = getAdminSchoolId(admin, req);

  const validated = validateManualBankRefundRequest(req.body || {}, { schoolId });
  if (!validated.ok) {
    return res.status(validated.status).json({
      error: true,
      code: validated.code,
      message: validated.message,
      manual_bank_recorded: false,
    });
  }

  try {
    const sql = req.sql || req._sql || neon(process.env.POSTGRES_URL);
    const stripeClient = req.stripeClient || req._stripe || createStripeClient();
    const result = await recordManualBankRefund({
      sql,
      stripe: stripeClient,
      admin,
      input: validated.input,
      req,
      auditLogger: req.auditLogger || req._auditLogger,
      connectionString: (req.sql || req._sql) ? req.connectionString : process.env.POSTGRES_URL,
      transactionRunner: req.transactionRunner || req._transactionRunner,
    });

    if (!result.ok) {
      return res.status(result.status || 400).json({
        error: true,
        code: result.code || 'MANUAL_BANK_REFUND_RECORD_FAILED',
        message: result.message || 'Manual bank refund could not be recorded.',
        manual_bank_recorded: false,
      });
    }

    return res.status(result.status || 200).json(result);
  } catch (err) {
    console.error('admin record-manual-bank-refund error:', err.message);
    reportError('/api/admin', err);
    return res.status(500).json({
      error: true,
      code: 'MANUAL_BANK_REFUND_RECORD_FAILED',
      message: 'Failed to record manual bank refund.',
      manual_bank_recorded: false,
    });
  }
}

// Read-only refund event discovery/detail endpoint. It is school-scoped and
// never repairs, mutates ledgers, changes bookings/payouts, or calls Stripe.
async function handleRefundEvents(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Admin auth required' });
  const schoolId = getAdminSchoolId(admin, req);

  const validated = validateRefundEventSearchRequest(req.query || {}, { schoolId });
  if (!validated.ok) {
    return res.status(validated.status).json({
      error: true,
      code: validated.code,
      message: validated.message,
    });
  }

  try {
    const sql = req.sql || req._sql || neon(process.env.POSTGRES_URL);
    const result = await searchRefundEvents({ sql, input: validated.input });
    if (!result.ok) {
      return res.status(result.status || 400).json({
        error: true,
        code: result.code || 'REFUND_EVENTS_FAILED',
        message: result.message || 'Refund events could not be loaded.',
      });
    }
    return res.status(200).json(result);
  } catch (err) {
    console.error('admin refund-events error:', err.message);
    reportError('/api/admin', err);
    return res.status(500).json({
      error: true,
      code: 'REFUND_EVENTS_FAILED',
      message: 'Failed to load refund events.',
    });
  }
}

// Read-only incident readiness classifier. It uses local refund ledger,
// metadata, Stripe refs already stored locally, and notes only.
async function handleRefundIncidentReadiness(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Admin auth required' });
  const schoolId = getAdminSchoolId(admin, req);

  const validated = validateRefundIncidentReadinessRequest(req.query || {}, { schoolId });
  if (!validated.ok) {
    return res.status(validated.status).json({
      error: true,
      code: validated.code,
      message: validated.message,
    });
  }

  try {
    const sql = req.sql || req._sql || neon(process.env.POSTGRES_URL);
    const result = await fetchRefundIncidentReadiness({ sql, input: validated.input });
    if (!result.ok) {
      return res.status(result.status || 400).json({
        error: true,
        code: result.code || 'REFUND_INCIDENT_READINESS_FAILED',
        message: result.message || 'Refund incident readiness could not be loaded.',
      });
    }
    return res.status(200).json(result);
  } catch (err) {
    console.error('admin refund-incident-readiness error:', err.message);
    reportError('/api/admin', err);
    return res.status(500).json({
      error: true,
      code: 'REFUND_INCIDENT_READINESS_FAILED',
      message: 'Failed to load refund incident readiness.',
    });
  }
}

// Refusal-only incident repair contract. This is not a repair mutation: it
// reads local refund evidence, returns structured stop reasons, and never
// calls Stripe or writes booking, payout, credit, CSA, BCS, or ledger rows.
async function handleRefundIncidentRepairPlan(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Admin auth required' });
  const schoolId = getAdminSchoolId(admin, req);

  const validated = validateRefundIncidentRepairPlanRequest(req.body || {}, { schoolId });
  if (!validated.ok) {
    return res.status(validated.status).json({
      error: true,
      code: validated.code,
      message: validated.message,
      repair_mutation_allowed: false,
      mutation_performed: false,
      refusal_reasons: validated.refusal_reasons,
    });
  }

  try {
    const sql = req.sql || req._sql || neon(process.env.POSTGRES_URL);
    const result = await fetchRefundIncidentRepairPlan({ sql, input: validated.input });
    if (!result.ok) {
      return res.status(result.status || 409).json({
        error: true,
        ...result,
      });
    }
    return res.status(200).json(result);
  } catch (err) {
    console.error('admin refund-incident-repair-plan error:', err.message);
    reportError('/api/admin', err);
    return res.status(500).json({
      error: true,
      code: 'REFUND_INCIDENT_REPAIR_PLAN_FAILED',
      message: 'Failed to prepare refund incident repair plan.',
      repair_mutation_allowed: false,
      mutation_performed: false,
    });
  }
}

// Admin refund notes timeline. These notes do not repair or mutate refund
// accounting; they preserve operator/incident context alongside the ledger.
async function handleRefundNotes(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Admin auth required' });
  const schoolId = getAdminSchoolId(admin, req);

  const validated = validateRefundNoteListRequest(req.query || {}, { schoolId });
  if (!validated.ok) {
    return res.status(validated.status).json({
      error: true,
      code: validated.code,
      message: validated.message,
    });
  }

  try {
    const sql = req.sql || req._sql || neon(process.env.POSTGRES_URL);
    const result = await listRefundNotes({ sql, input: validated.input });
    if (!result.ok) {
      return res.status(result.status || 400).json({
        error: true,
        code: result.code || 'REFUND_NOTES_FAILED',
        message: result.message || 'Refund notes could not be loaded.',
      });
    }
    return res.status(200).json(result);
  } catch (err) {
    console.error('admin refund-notes error:', err.message);
    reportError('/api/admin', err);
    return res.status(500).json({
      error: true,
      code: 'REFUND_NOTES_FAILED',
      message: 'Failed to load refund notes.',
    });
  }
}

async function handleAddRefundNote(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Admin auth required' });
  const schoolId = getAdminSchoolId(admin, req);

  const validated = validateRefundNoteCreateRequest(req.body || {}, { schoolId });
  if (!validated.ok) {
    return res.status(validated.status).json({
      error: true,
      code: validated.code,
      message: validated.message,
      note_added: false,
    });
  }

  try {
    const sql = req.sql || req._sql || neon(process.env.POSTGRES_URL);
    const result = await addRefundNote({
      sql,
      admin,
      input: validated.input,
      req,
      auditLogger: req.auditLogger || req._auditLogger,
    });
    if (!result.ok) {
      return res.status(result.status || 400).json({
        error: true,
        code: result.code || 'REFUND_NOTE_ADD_FAILED',
        message: result.message || 'Refund note could not be added.',
        note_added: false,
      });
    }
    return res.status(200).json({ ...result, note_added: true });
  } catch (err) {
    console.error('admin add-refund-note error:', err.message);
    reportError('/api/admin', err);
    return res.status(500).json({
      error: true,
      code: 'REFUND_NOTE_ADD_FAILED',
      message: 'Failed to add refund note.',
      note_added: false,
    });
  }
}

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

    // Run the unified GDPR cascade. Previously this path only cleaned up 4
    // tables explicitly and relied on the ON DELETE CASCADE FK on
    // lesson_bookings.learner_id (and others) to mop up the rest — that
    // cascade is gone after PR-K's migration (financial records now
    // anonymise, not delete). See api/_gdpr.js.
    await deleteLearnerCascade(sql, learner_id, { email: learner.email });

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

    await logAudit(sql, {
      adminId: admin.id, adminEmail: admin.email,
      action: paused ? 'admin.payouts_pause' : 'admin.payouts_resume',
      targetType: 'instructor', targetId: updated.id,
      details: { instructor_name: updated.name, paused },
      schoolId, req,
    });

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
             stripe_account_id, stripe_onboarding_complete, payouts_paused, payouts_start_date
        FROM instructors WHERE school_id = ${schoolId} ORDER BY name ASC
    `;

    // Upcoming payout estimates per instructor
    const estimates = [];
    for (const inst of instructors) {
      if (!inst.active || !inst.stripe_onboarding_complete) continue;
      const bookings = await getEligibleBookings(sql, inst.id, inst.payouts_start_date || null);
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

// ── GET /api/admin?action=platform-balance ──
// Dry-run preview of the next Friday payout cron. Answers the only question
// the commingled-account architecture forces us to keep asking: "will the
// next payout run actually succeed against the available Stripe balance?"
//
// Builds per-instructor results using simulatePayoutForInstructor — same
// math as the real Friday path, no INSERT/UPDATE, no Stripe transfer.
// Filter MUST match processAllPayouts exactly (active + onboarded + not
// paused + has stripe_account_id) so the headline number === what Friday
// would actually transfer.
//
// status:
//   red    — balance_after_payout < 0 (Friday would fail)
//   green  — balance_after_payout >= 0 (Friday would succeed)
//
// Advisory section (separate, does NOT affect headline status):
//   - excluded_instructors: instructors with chargeable lessons who would
//     NOT be paid this Friday (paused / no Connect / onboarding incomplete).
//   - refund_exposure_pence: advisory legacy aggregate exposure signal. It
//     uses learner_users.balance_minutes valued at the school bulk rate and
//     caps that by Stripe-originated net cash-in. It is NOT an exact refund
//     liability under per-instructor credits/source pricing/goodwill absorber
//     attribution. Test accounts excluded.
async function handlePlatformBalance(req, res) {
  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Admin auth required' });
  // Admin widget is deliberately school-scoped: school admins are locked to
  // their JWT school, and superadmins may target one school via ?school_id=.
  // Omitted-school global mode is reserved for the snapshot cron.
  const schoolId = getAdminSchoolId(admin, req);

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const result = await computePlatformBalance(sql, createStripeClient(), { schoolId });
    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error('platform-balance error:', err);
    reportError('/api/admin (platform-balance)', err);
    return res.status(500).json({ error: 'Failed to load platform balance' });
  }
}

// ── POST /api/admin?action=process-payouts ──
// Manual trigger for payout processing (same logic as cron).
async function handleProcessPayouts(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Admin auth required' });

  // School admins always scope to their own school. Superadmins can target
  // a specific school via ?school_id=, or omit it to mirror the Friday cron
  // (all active schools). We pass `undefined` rather than 1 in the all-schools
  // case so processAllPayouts skips its school filter entirely.
  const isSuperadmin = admin.school_id == null;
  const querySchoolId = parseInt(req.query?.school_id, 10);
  const schoolId = isSuperadmin
    ? (querySchoolId || undefined)
    : admin.school_id;

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const results = await processAllPayouts(sql, createStripeClient(), schoolId ? { schoolId } : {});

    // Send the same weekly summary email that the Friday cron sends so the
    // admin trigger and the cron produce identical artefacts. Fire-and-forget:
    // a digest failure must not fail the admin response.
    try {
      const summaryTransporter = createTransporter();
      await sendPayoutSummary(sql, results, summaryTransporter);
    } catch (summaryErr) {
      reportError('/api/admin (process-payouts summary email)', summaryErr);
    }

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
      _log: {
        purpose: 'admin.learner_invite',
        schoolId,
      },
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

    await logAudit(sql, {
      adminId: admin.id, adminEmail: admin.email,
      action: 'admin.set_instructor_blackouts',
      targetType: 'instructor', targetId: parseInt(instructor_id, 10),
      details: { ranges_count: saved.length },
      schoolId, req,
    });

    return res.json({ ok: true, blackout_dates: saved });
  } catch (err) {
    console.error('set-instructor-blackouts error:', err);
    reportError('/api/admin', err);
    return res.status(500).json({ error: 'Failed to save blackout dates' });
  }
}

// ── GET /api/admin?action=referral-activity ──────────────────────────────────
async function handleReferralActivity(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = getAdminSchoolId(admin, req);

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const referrals = await sql`
      SELECT r.code, r.created_at AS code_created,
             lu_referrer.id AS referrer_id, lu_referrer.name AS referrer_name, lu_referrer.email AS referrer_email,
             (SELECT COUNT(*)::int FROM learner_users WHERE referred_by = r.learner_id AND school_id = ${schoolId}) AS total_referred,
             (SELECT COALESCE(SUM(minutes), 0)::int FROM credit_transactions WHERE learner_id = r.learner_id AND type = 'referral_reward' AND school_id = ${schoolId}) AS total_rewards_minutes
      FROM referrals r
      JOIN learner_users lu_referrer ON r.learner_id = lu_referrer.id
      WHERE r.school_id = ${schoolId}
      ORDER BY total_referred DESC
    `;

    return res.json({ ok: true, referrals });
  } catch (err) {
    console.error('referral-activity error:', err);
    reportError('/api/admin', err);
    return res.status(500).json({ error: 'Failed to load referral activity' });
  }
}

// GET /api/admin?action=referral-relationships
async function handleReferralRelationships(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = getAdminSchoolId(admin, req);

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const relationships = await sql`
      SELECT
        referrer.id AS referrer_id,
        referrer.name AS referrer_name,
        referrer.email AS referrer_email,
        referral_code.code AS referral_code,
        referee.id AS referee_id,
        referee.name AS referee_name,
        referee.email AS referee_email,
        referee.phone AS referee_phone,
        referee.created_at AS referred_at,
        (
          SELECT MIN(b.scheduled_date)
          FROM lesson_bookings b
          WHERE b.learner_id = referee.id
            AND b.school_id = ${schoolId}
            AND b.status IN (${SCHEDULED}, ${CHARGEABLE}, ${REFUNDED})
        ) AS first_booking_date,
        (
          SELECT MIN(b.scheduled_date)
          FROM lesson_bookings b
          WHERE b.learner_id = referee.id
            AND b.school_id = ${schoolId}
            AND b.status = ${CHARGEABLE}
            AND b.payment_method <> 'free'
        ) AS first_paid_lesson_date,
        EXISTS (
          SELECT 1 FROM lesson_bookings b
          WHERE b.learner_id = referee.id
            AND b.school_id = ${schoolId}
            AND b.status IN (${SCHEDULED}, ${CHARGEABLE}, ${REFUNDED})
        ) AS has_any_booking,
        EXISTS (
          SELECT 1 FROM lesson_bookings b
          WHERE b.learner_id = referee.id
            AND b.school_id = ${schoolId}
            AND b.status = ${CHARGEABLE}
            AND b.payment_method <> 'free'
        ) AS has_completed_paid,
        COALESCE((
          SELECT SUM(FLOOR((EXTRACT(EPOCH FROM (b.end_time - b.start_time)) / 60) / 3))::int
          FROM lesson_bookings b
          WHERE b.learner_id = referee.id
            AND b.school_id = ${schoolId}
            AND b.status = ${CHARGEABLE}
            AND b.payment_method <> 'free'
            AND b.referral_rewarded_at IS NOT NULL
        ), 0)::int AS reward_minutes,
        COALESCE((
          SELECT SUM(FLOOR((EXTRACT(EPOCH FROM (b.end_time - b.start_time)) / 60) / 3))::int
          FROM lesson_bookings b
          WHERE b.learner_id = referee.id
            AND b.school_id = ${schoolId}
            AND b.status = ${CHARGEABLE}
            AND b.payment_method <> 'free'
            AND b.referral_rewarded_at IS NULL
        ), 0)::int AS pending_reward_minutes
      FROM learner_users referee
      JOIN learner_users referrer
        ON referrer.id = referee.referred_by
       AND referrer.school_id = ${schoolId}
      LEFT JOIN referrals referral_code
        ON referral_code.learner_id = referrer.id
       AND referral_code.school_id = ${schoolId}
      WHERE referee.school_id = ${schoolId}
        AND referee.referred_by IS NOT NULL
      ORDER BY referee.created_at DESC
      LIMIT 200
    `;

    const enriched = relationships.map((r) => ({
      ...r,
      status: r.has_completed_paid ? 'lessoned'
            : r.has_any_booking    ? 'booked'
            : 'joined',
      reward_status: r.reward_minutes > 0 ? 'rewarded'
                   : r.pending_reward_minutes > 0 ? 'pending'
                   : 'none'
    }));

    return res.json({ ok: true, relationships: enriched });
  } catch (err) {
    console.error('referral-relationships error:', err);
    reportError('/api/admin', err);
    return res.status(500).json({ error: 'Failed to load referral relationships' });
  }
}

// POST /api/admin?action=link-referral-relationship
// Body: { referrer_learner_id, referred_learner_id }
async function handleLinkReferralRelationship(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = getAdminSchoolId(admin, req);

  const { referrer_learner_id, referred_learner_id } = req.body || {};
  const referrerId = parseInt(referrer_learner_id, 10);
  const referredId = parseInt(referred_learner_id, 10);
  if (!Number.isInteger(referrerId) || referrerId <= 0 ||
      !Number.isInteger(referredId) || referredId <= 0) {
    return res.status(400).json({ error: 'referrer_learner_id and referred_learner_id are required' });
  }
  if (referrerId === referredId) {
    return res.status(400).json({ error: 'A learner cannot refer themselves' });
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const [referrer] = await sql`
      SELECT id, name, email, referred_by
      FROM learner_users
      WHERE id = ${referrerId}
        AND school_id = ${schoolId}
    `;
    const [referred] = await sql`
      SELECT id, name, email, referred_by
      FROM learner_users
      WHERE id = ${referredId}
        AND school_id = ${schoolId}
    `;
    if (!referrer || !referred) {
      return res.status(404).json({ error: 'Both learners must exist in this school' });
    }

    const cycleRows = await sql`
      WITH RECURSIVE referrer_ancestors AS (
        SELECT id, referred_by, 0 AS depth
        FROM learner_users
        WHERE id = ${referrerId}
          AND school_id = ${schoolId}
        UNION ALL
        SELECT lu.id, lu.referred_by, ra.depth + 1
        FROM learner_users lu
        JOIN referrer_ancestors ra ON lu.id = ra.referred_by
        WHERE lu.school_id = ${schoolId}
          AND ra.referred_by IS NOT NULL
          AND ra.depth < 25
      )
      SELECT 1
      FROM referrer_ancestors
      WHERE id = ${referredId}
      LIMIT 1
    `;
    if (cycleRows.length > 0) {
      return res.status(400).json({ error: 'This link would create a referral cycle' });
    }

    if (referred.referred_by && referred.referred_by !== referrerId) {
      const alreadyRewarded = await sql`
        SELECT 1
        FROM lesson_bookings
        WHERE learner_id = ${referredId}
          AND school_id = ${schoolId}
          AND status = ${CHARGEABLE}
          AND payment_method <> 'free'
          AND referral_rewarded_at IS NOT NULL
        LIMIT 1
      `;
      if (alreadyRewarded.length > 0) {
        return res.status(409).json({
          error: 'This learner already has rewarded referral lessons. Changing the referrer would not move historical credit.'
        });
      }
    }

    const [updated] = await sql`
      UPDATE learner_users
         SET referred_by = ${referrerId}
       WHERE id = ${referredId}
         AND school_id = ${schoolId}
      RETURNING id, name, email, referred_by
    `;

    await logAudit(sql, {
      adminId: admin.id,
      adminEmail: admin.email,
      action: 'admin.link_referral_relationship',
      targetType: 'learner',
      targetId: referredId,
      details: {
        referrer_learner_id: referrerId,
        referred_learner_id: referredId,
        previous_referrer_learner_id: referred.referred_by || null,
        referrer_name: referrer.name || null,
        referred_name: referred.name || null
      },
      schoolId,
      req
    });

    return res.json({ ok: true, relationship: updated });
  } catch (err) {
    console.error('admin link-referral-relationship error:', err);
    reportError('/api/admin', err);
    return res.status(500).json({ error: 'Failed to link referral relationship', details: 'Internal server error' });
  }
}

// GET /api/admin?action=referral-config
async function handleReferralConfig(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = getAdminSchoolId(admin, req);

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const [school] = await sql`SELECT config FROM schools WHERE id = ${schoolId}`;
    const config = school?.config || {};

    return res.json({
      ok: true,
      referral_enabled: config.referral_enabled || false,
      referral_welcome_bonus_minutes: config.referral_welcome_bonus_minutes ?? 90,
      referral_reward_minutes: config.referral_reward_minutes ?? 30
    });
  } catch (err) {
    console.error('referral-config error:', err);
    reportError('/api/admin', err);
    return res.status(500).json({ error: 'Failed to load referral config' });
  }
}

// ── POST /api/admin?action=update-referral-config ────────────────────────────
async function handleUpdateReferralConfig(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = getAdminSchoolId(admin, req);

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const { referral_enabled, referral_welcome_bonus_minutes, referral_reward_minutes } = req.body;

    // Read current config, merge referral keys
    const [school] = await sql`SELECT config FROM schools WHERE id = ${schoolId}`;
    const config = school?.config || {};

    if (referral_enabled !== undefined) config.referral_enabled = !!referral_enabled;
    if (referral_welcome_bonus_minutes !== undefined) {
      const mins = parseInt(referral_welcome_bonus_minutes, 10);
      if (isNaN(mins) || mins < 0) return res.status(400).json({ error: 'Welcome bonus must be 0 or more minutes' });
      config.referral_welcome_bonus_minutes = mins;
    }
    if (referral_reward_minutes !== undefined) {
      const mins = parseInt(referral_reward_minutes, 10);
      if (isNaN(mins) || mins < 0) return res.status(400).json({ error: 'Reward must be 0 or more minutes' });
      config.referral_reward_minutes = mins;
    }

    await sql`UPDATE schools SET config = ${JSON.stringify(config)}, updated_at = NOW() WHERE id = ${schoolId}`;

    await logAudit(sql, {
      adminId: admin.id,
      adminEmail: admin.email,
      action: 'update-referral-config',
      targetType: 'school',
      targetId: schoolId,
      details: { referral_enabled: config.referral_enabled, referral_welcome_bonus_minutes: config.referral_welcome_bonus_minutes, referral_reward_minutes: config.referral_reward_minutes },
      schoolId
    });

    return res.json({
      ok: true,
      referral_enabled: config.referral_enabled,
      referral_welcome_bonus_minutes: config.referral_welcome_bonus_minutes,
      referral_reward_minutes: config.referral_reward_minutes
    });
  } catch (err) {
    console.error('update-referral-config error:', err);
    reportError('/api/admin', err);
    return res.status(500).json({ error: 'Failed to update referral config' });
  }
}

// ── POST /api/admin?action=request-reset ─────────────────────────────────────
//
// Code-based password reset for admins. Mirrors the learner UX: a 6-digit code
// goes to the admin's email, they enter it on the login page, then set a new
// password via reset-password.
//
// Enumeration-safe: same response regardless of whether the email matches an
// admin account.
//
// Body: { email }
async function handleRequestReset(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const rawEmail = req.body?.email;
    if (!rawEmail) return res.status(400).json({ error: 'Email is required' });
    const cleanEmail = String(rawEmail).replace(/\s+/g, '').toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }

    const sql = neon(process.env.POSTGRES_URL);

    // Rate limit: 5 reset requests per email per hour
    const rl = await checkRateLimit(sql, {
      key: `admin_reset:${cleanEmail}`,
      max: 5,
      windowSeconds: 3600,
    });
    if (!rl.allowed) {
      // Same outward response to avoid leaking the rate-limit hit either
      return res.json({
        success: true,
        message: 'If that email matches an admin account, a reset code has been sent.',
      });
    }

    const [admin] = await sql`
      SELECT id, school_id FROM admin_users
       WHERE email = ${cleanEmail} AND active = TRUE`;

    if (admin) {
      const cryptoMod = require('crypto');
      const emailCode = cryptoMod.randomInt(100000, 999999).toString();
      const longToken = cryptoMod.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

      // Invalidate prior unused admin reset rows
      await sql`UPDATE magic_link_tokens SET used = true
                 WHERE email = ${cleanEmail}
                   AND purpose = 'reset'
                   AND role = 'admin'
                   AND used = false`;

      await sql`
        INSERT INTO magic_link_tokens
          (token, email_code, email, method, expires_at, school_id, purpose, role)
        VALUES
          (${longToken}, ${emailCode}, ${cleanEmail}, 'email', ${expiresAt}, ${admin.school_id || 1}, 'reset', 'admin')`;

      try {
        const mailer = createTransporter();
        await mailer.sendMail({
          _log: {
            purpose: 'auth.admin_password_reset',
            schoolId: admin.school_id || 1,
          },
          from: 'CoachCarter <bookings@coachcarter.uk>',
          to: cleanEmail,
          subject: 'Reset your CoachCarter admin password',
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
              <h1 style="font-size: 1.3rem; color: #262626; text-align: center;">Reset your admin password</h1>
              <p style="color: #555; font-size: 0.95rem; line-height: 1.6;">
                Enter this 6-digit code on the admin sign-in page to reset your password. It expires in 15 minutes.
              </p>
              <div style="text-align: center; margin: 28px 0;">
                <div style="display: inline-block; background: #fff4ec; border: 2px dashed #f58321;
                            border-radius: 12px; padding: 18px 28px;
                            font-family: 'SF Mono', Menlo, Consolas, monospace;
                            font-size: 2rem; letter-spacing: 0.4em;
                            font-weight: 700; color: #262626;">
                  ${emailCode}
                </div>
              </div>
              <p style="color: #999; font-size: 0.8rem; line-height: 1.5; text-align: center;">
                Didn't request this? You can safely ignore this email — your password won't change.
              </p>
            </div>
          `,
        });
      } catch (e) {
        console.error('admin reset email failed:', e.message);
        // Still return success
      }
    }

    return res.json({
      success: true,
      message: 'If that email matches an admin account, a reset code has been sent.',
    });
  } catch (err) {
    console.error('admin request-reset error:', err);
    reportError('/api/admin', err);
    return res.status(500).json({ error: 'Could not send reset email' });
  }
}

// ── POST /api/admin?action=reset-password ────────────────────────────────────
//
// Verifies the 6-digit code and sets a new password atomically. Issues a
// fresh admin session JWT on success.
//
// Body: { email, code, new_password }
async function handleResetPassword(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { email, code, new_password } = req.body || {};
    if (!email || !code || !new_password) {
      return res.status(400).json({ error: 'Email, code, and new password are required.' });
    }

    const cleanEmail = String(email).replace(/\s+/g, '').toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }

    // Validate password using shared helper (matches learner/instructor rules)
    const { validatePassword: validatePw } = require('./_password');
    const pwdErr = validatePw(new_password);
    if (pwdErr) return res.status(400).json({ error: 'invalid_password', message: pwdErr });

    const sql = neon(process.env.POSTGRES_URL);

    const [token] = await sql`
      SELECT id, school_id FROM magic_link_tokens
       WHERE email = ${cleanEmail}
         AND email_code = ${String(code).trim()}
         AND purpose = 'reset'
         AND role = 'admin'
         AND used = false
         AND expires_at > NOW()`;

    if (!token) {
      return res.status(400).json({
        error: 'invalid_code',
        message: 'Invalid or expired code. Please request a new one.',
      });
    }

    const [admin] = await sql`
      SELECT id, name, email, role, school_id FROM admin_users
       WHERE email = ${cleanEmail} AND active = TRUE`;
    if (!admin) {
      // Token was valid but admin row vanished/deactivated — treat as invalid
      return res.status(400).json({
        error: 'invalid_code',
        message: 'Invalid or expired code. Please request a new one.',
      });
    }

    const newHash = await bcrypt.hash(new_password, 10);
    await sql`UPDATE admin_users SET password_hash = ${newHash} WHERE id = ${admin.id}`;
    await sql`UPDATE magic_link_tokens SET used = true WHERE id = ${token.id}`;

    // Audit
    try {
      const { logAudit } = require('./_audit');
      await logAudit(sql, {
        adminId: admin.id, adminEmail: admin.email,
        action: 'admin.password_reset',
        targetType: 'admin_users', targetId: admin.id,
        details: { self: true },
        schoolId: admin.school_id || 1, req,
      });
    } catch {}

    // Issue session
    const secret = process.env.JWT_SECRET;
    const sessionToken = jwt.sign(
      { id: admin.id, email: admin.email, role: admin.role, isAdmin: true, school_id: admin.school_id || null },
      secret,
      { expiresIn: '7d' }
    );
    appendSetCookie(res, buildSessionCookie(SESSION_COOKIE_NAMES.admin, sessionToken, SESSION_MAX_AGE_SEC.admin));
    appendSetCookie(res, buildCsrfCookie(mintCsrfToken()));

    return res.json({
      success: true,
      admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role, school_id: admin.school_id || null },
    });
  } catch (err) {
    console.error('admin reset-password error:', err);
    reportError('/api/admin', err);
    return res.status(500).json({ error: 'Could not reset password' });
  }
}

// ── GET /api/admin?action=notification-log ─────────────────────────────────────
// Read-only window over the notification_log table for support triage.
// Query params:
//   learner_id   — filter to a single learner
//   recipient    — filter by email/phone (exact match)
//   status       — 'sent' | 'failed' | 'skipped'
//   channel      — 'email' | 'sms' | 'whatsapp'
//   limit        — default 50, max 200
async function handleNotificationLog(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = getAdminSchoolId(admin, req);

  const learnerId = req.query.learner_id ? parseInt(req.query.learner_id, 10) : null;
  const recipient = req.query.recipient ? String(req.query.recipient).trim().toLowerCase() : null;
  const status    = req.query.status    ? String(req.query.status).trim()    : null;
  const channel   = req.query.channel   ? String(req.query.channel).trim()   : null;
  const limit     = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));

  try {
    const sql = neon(process.env.POSTGRES_URL);
    // Build the WHERE incrementally — sql tagged template literals don't
    // support dynamic clause composition, so use one query with NULL-tolerant
    // predicates (well-indexed via idx_notif_log_school + partial indexes).
    const rows = await sql`
      SELECT id, channel, purpose, recipient, learner_id, instructor_id,
             payload_summary, delivery_status, error_message, created_at
      FROM notification_log
      WHERE school_id = ${schoolId}
        AND (${learnerId}::int IS NULL OR learner_id = ${learnerId})
        AND (${recipient}::text IS NULL OR recipient = ${recipient})
        AND (${status}::text IS NULL OR delivery_status = ${status})
        AND (${channel}::text IS NULL OR channel = ${channel})
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
    return res.json({ ok: true, rows });
  } catch (err) {
    console.error('notification-log error:', err);
    reportError('/api/admin?action=notification-log', err);
    return res.status(500).json({ error: 'Failed to load notification log' });
  }
}

module.exports._resolveAdjustCreditsTarget = resolveAdjustCreditsTarget;
module.exports._buildScopedDurationCreditRefusal = buildScopedDurationCreditRefusal;
module.exports._normaliseBroadcastCategories = normaliseBroadcastCategories;
module.exports._normaliseBroadcastPhone = normaliseBroadcastPhone;
