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
const { sendWhatsApp } = require('./_whatsapp');
const { createTransporter, generateToken } = require('./_auth-helpers');
const { requireAuth, SESSION_COOKIE_NAMES, SESSION_MAX_AGE_SEC,
        buildSessionCookie, buildSessionClearCookie } = require('./_auth');
const { buildCsrfCookie, buildCsrfClearCookie, mintCsrfToken, appendSetCookie } = require('./_csrf');
const { reportError } = require('./_error-alert');
const { extractPostcode, bulkGeocodeUK, estimateDriveMinutes } = require('./_travel-time');
const { getEligibleBookings }  = require('./_payout-helpers');
const { SCHEDULED, CHARGEABLE, REFUNDED, BLOCKING_STATUSES } = require('./_booking-status');
const { lockBalanceAndMutate, lockBalanceAdjustLCB } = require('./_credit-grant');
const { withNeonTransaction } = require('./_db-transaction');
const { planFifoCreditDraw } = require('./_bcs-fifo');
const { splitFifoPlanAcrossBookings } = require('./_bcs-booking-plan');
const { getEffectiveHourlyPence, calcOfferLessonPrice } = require('./_pricing-helpers');
const { isLessonTypeOffered } = require('./_lesson-type-helpers');
const {
  markBookingCreditSourcesRefunded,
  restoreBookingCreditSourcesActive,
  copyRefundedBookingCreditSources,
} = require('./_bcs-refund-marker');


const TOKEN_EXPIRY_MINUTES = 30;
const JWT_EXPIRY           = '180d';
const CREDIT_BOOKING_SOURCE_TYPES = ['purchase', 'slot_purchase', 'admin_add', 'referral_bonus', 'referral_reward', 'legacy_grandfather'];
const LEARNER_CATEGORIES = new Set(['regular', 'sporadic', 'inactive', 'passed']);

class InstructorBookingTransactionAbort extends Error {
  constructor(result) {
    super(result?.message || result?.code || 'INSTRUCTOR_BOOKING_TRANSACTION_ABORT');
    this.name = 'InstructorBookingTransactionAbort';
    this.result = { ok: false, ...(result || {}) };
  }
}

function abortInstructorBookingTransaction(result) {
  throw new InstructorBookingTransactionAbort(result);
}

function buildScopedDurationCreditRefusal(delta, availableMinutes) {
  if (delta <= 0) return null;
  const balance = Number(availableMinutes || 0);
  if (balance >= delta) return null;
  return `Learner has insufficient balance. Needs ${delta} more minutes but has ${balance}.`;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_HHMM_RE = /^\d{2}:\d{2}$/;
const AVAILABILITY_TRANSMISSION_TYPES = new Set(['manual', 'automatic', 'both']);
const LESSON_TRANSMISSION_TYPES = new Set(['manual', 'automatic']);

function isValidIsoDate(value) {
  if (!ISO_DATE_RE.test(String(value || ''))) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isValidTimeHHMM(value) {
  if (!TIME_HHMM_RE.test(String(value || ''))) return false;
  const [hh, mm] = value.split(':').map(Number);
  return hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59;
}

function timeToMinutes(value) {
  const [hh, mm] = String(value || '').split(':').map(Number);
  return hh * 60 + mm;
}

function startOfTodayUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function normaliseAvailabilityTransmissionType(value) {
  const text = String(value || '').trim().toLowerCase();
  return AVAILABILITY_TRANSMISSION_TYPES.has(text) ? text : null;
}

function normaliseLessonTransmissionType(value) {
  const text = String(value || '').trim().toLowerCase();
  return LESSON_TRANSMISSION_TYPES.has(text) ? text : null;
}

function instructorCanOfferAvailabilityTransmission(instructorTransmissionType, slotTransmissionType) {
  const instructorType = normaliseAvailabilityTransmissionType(instructorTransmissionType) || 'manual';
  return instructorType === 'both' || slotTransmissionType === instructorType;
}

function instructorCanTeachLessonTransmission(instructorTransmissionType, lessonTransmissionType) {
  const instructorType = normaliseAvailabilityTransmissionType(instructorTransmissionType) || 'manual';
  return instructorType === 'both' || lessonTransmissionType === instructorType;
}

function defaultLessonTransmissionForInstructor(instructorTransmissionType) {
  const instructorType = normaliseAvailabilityTransmissionType(instructorTransmissionType) || 'manual';
  return instructorType === 'automatic' ? 'automatic' : 'manual';
}

function normaliseLearnerCategory(value) {
  const text = String(value || '').trim().toLowerCase();
  return LEARNER_CATEGORIES.has(text) ? text : null;
}

function setCors(res) {
}

// Delegates to shared requireAuth so cookie-first + CSRF + school_id
// checks are applied consistently with the rest of the codebase.
function verifyInstructorAuth(req) {
  return requireAuth(req, { roles: ['instructor'] });
}

function lessonBookingTransmissionColumnMissing(err) {
  if (!err) return false;
  const msg = String(err.message || '');
  return /lesson_bookings\.transmission_type|lb\.transmission_type|column .*transmission_type.* does not exist/i.test(msg);
}

async function instructorAvailabilityTransmissionColumnExists(sql) {
  try {
    const [row] = await sql`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'instructor_availability'
          AND column_name = 'transmission_type'
      ) AS exists
    `;
    return !!row?.exists;
  } catch (_) {
    return false;
  }
}

module.exports = async (req, res) => {
  setCors(res);
  const action = req.query.action;
  if (action === 'request-login')    return handleRequestLogin(req, res);
  if (action === 'validate-token')   return handleValidateToken(req, res);
  if (action === 'verify-token')     return handleVerifyToken(req, res);
  if (action === 'logout')           return handleLogout(req, res);
  if (action === 'schedule')         return handleSchedule(req, res);
  if (action === 'schedule-range')   return handleScheduleRange(req, res);
  if (action === 'availability')     return handleAvailability(req, res);
  if (action === 'set-availability') return handleSetAvailability(req, res);
  if (action === 'availability-overrides') return handleAvailabilityOverrides(req, res);
  if (action === 'create-availability-override') return handleCreateAvailabilityOverride(req, res);
  if (action === 'delete-availability-override') return handleDeleteAvailabilityOverride(req, res);
  if (action === 'busy-blocks') return handleBusyBlocks(req, res);
  if (action === 'create-busy-block') return handleCreateBusyBlock(req, res);
  if (action === 'delete-busy-block') return handleDeleteBusyBlock(req, res);
  if (action === 'profile')          return handleProfile(req, res);
  if (action === 'update-profile')   return handleUpdateProfile(req, res);
  if (action === 'blackout-dates')     return handleBlackoutDates(req, res);
  if (action === 'set-blackout-dates') return handleSetBlackoutDates(req, res);
  if (action === 'learner-history')    return handleLearnerHistory(req, res);
  if (action === 'cancel-booking')     return handleCancelBooking(req, res);
  if (action === 'reschedule-booking') return handleRescheduleBooking(req, res);
  if (action === 'edit-booking')       return handleEditBooking(req, res);
  if (action === 'create-booking')     return handleCreateBooking(req, res);
  if (action === 'stats')              return handleStats(req, res);
  if (action === 'upload-photo')       return handleUploadPhoto(req, res);
  if (action === 'my-learners')        return handleMyLearners(req, res);
  if (action === 'school-learners')    return handleSchoolLearners(req, res);
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
  if (action === 'preview-broadcast-audience') return handlePreviewBroadcastAudience(req, res);
  if (action === 'create-broadcast-offer')     return handleCreateBroadcastOffer(req, res);
  if (action === 'close-broadcast-offer')      return handleCloseBroadcastOffer(req, res);
  if (action === 'my-broadcast-batches')       return handleMyBroadcastBatches(req, res);
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

    // Set httpOnly session cookie + CSRF double-submit cookie.
    appendSetCookie(res, buildSessionCookie(SESSION_COOKIE_NAMES.instructor, jwtToken, SESSION_MAX_AGE_SEC.instructor));
    appendSetCookie(res, buildCsrfCookie(mintCsrfToken()));

    return res.json({
      instructor: { id: row.instructor_id, name: row.name, email: row.email, photo_url: row.photo_url, is_admin: !!row.is_admin, school_id: row.school_id, onboarding_complete: row.onboarding_complete }
    });

  } catch (err) {
    console.error('instructor verify-token error:', err);
    reportError('/api/instructor', err);
    return res.status(500).json({ error: 'Verification failed' });
  }
}

// ── POST /api/instructor?action=logout ───────────────────────────────────────
// Clear the cc_instructor + cc_csrf cookies. No auth required.
async function handleLogout(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  appendSetCookie(res, buildSessionClearCookie(SESSION_COOKIE_NAMES.instructor));
  appendSetCookie(res, buildCsrfClearCookie());
  return res.json({ ok: true });
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

    let bookings;
    try {
      bookings = await sql`
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
          CASE
            WHEN COALESCE(i.transmission_type, 'manual') = 'both' THEN COALESCE(lb.transmission_type, 'manual')
            WHEN COALESCE(i.transmission_type, 'manual') = 'automatic' THEN 'automatic'
            ELSE 'manual'
          END AS transmission_type,
          lt.name AS lesson_type_name,
          lt.colour AS lesson_type_colour,
          COALESCE(lt.duration_minutes, 90) AS duration_minutes
        FROM lesson_bookings lb
        JOIN learner_users lu ON lu.id = lb.learner_id AND COALESCE(lu.school_id, 1) = ${schoolId}
        JOIN instructors i ON i.id = lb.instructor_id AND COALESCE(i.school_id, 1) = ${schoolId}
        LEFT JOIN driving_sessions ds ON ds.booking_id = lb.id AND COALESCE(ds.school_id, 1) = ${schoolId}
        LEFT JOIN lesson_types lt ON lt.id = lb.lesson_type_id AND COALESCE(lt.school_id, 1) = ${schoolId}
        WHERE lb.instructor_id = ${instructor.id}
          AND COALESCE(lb.school_id, 1) = ${schoolId}
          AND lb.status = ANY(${BLOCKING_STATUSES}::text[])
          AND lb.scheduled_date >= (CURRENT_DATE - INTERVAL '14 days')
        ORDER BY lb.scheduled_date ASC, lb.start_time ASC
        LIMIT 60
      `;
    } catch (err) {
      if (!lessonBookingTransmissionColumnMissing(err)) throw err;
      bookings = await sql`
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
          CASE WHEN COALESCE(i.transmission_type, 'manual') = 'automatic' THEN 'automatic' ELSE 'manual' END AS transmission_type,
          lt.name AS lesson_type_name,
          lt.colour AS lesson_type_colour,
          COALESCE(lt.duration_minutes, 90) AS duration_minutes
        FROM lesson_bookings lb
        JOIN learner_users lu ON lu.id = lb.learner_id AND COALESCE(lu.school_id, 1) = ${schoolId}
        JOIN instructors i ON i.id = lb.instructor_id AND COALESCE(i.school_id, 1) = ${schoolId}
        LEFT JOIN driving_sessions ds ON ds.booking_id = lb.id AND COALESCE(ds.school_id, 1) = ${schoolId}
        LEFT JOIN lesson_types lt ON lt.id = lb.lesson_type_id AND COALESCE(lt.school_id, 1) = ${schoolId}
        WHERE lb.instructor_id = ${instructor.id}
          AND COALESCE(lb.school_id, 1) = ${schoolId}
          AND lb.status = ANY(${BLOCKING_STATUSES}::text[])
          AND lb.scheduled_date >= (CURRENT_DATE - INTERVAL '14 days')
        ORDER BY lb.scheduled_date ASC, lb.start_time ASC
        LIMIT 60
      `;
    }

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
      if (b.status === SCHEDULED && lessonTime > now) {
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
    let bookings;
    try {
      bookings = await sql`
        SELECT
          lb.id,
          lb.scheduled_date::text,
          lb.start_time::text,
          lb.end_time::text,
          lb.status,
          lb.notes,
          lb.instructor_notes,
          COALESCE(lb.social_video_consent, false) AS social_video_consent,
          COALESCE(lb.social_video_discount_pct, 0) AS social_video_discount_pct,
          CASE
            WHEN COALESCE(i.transmission_type, 'manual') = 'both' THEN COALESCE(lb.transmission_type, 'manual')
            WHEN COALESCE(i.transmission_type, 'manual') = 'automatic' THEN 'automatic'
            ELSE 'manual'
          END AS transmission_type,
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
        JOIN learner_users lu ON lu.id = lb.learner_id AND COALESCE(lu.school_id, 1) = ${schoolId}
        JOIN instructors i ON i.id = lb.instructor_id AND COALESCE(i.school_id, 1) = ${schoolId}
        LEFT JOIN lesson_types lt ON lt.id = lb.lesson_type_id AND COALESCE(lt.school_id, 1) = ${schoolId}
        WHERE lb.instructor_id = ${instructor.id}
          AND COALESCE(lb.school_id, 1) = ${schoolId}
          AND lb.status = ANY(${BLOCKING_STATUSES}::text[])
          AND lb.scheduled_date >= ${from}::date
          AND lb.scheduled_date <= ${to}::date
        ORDER BY lb.scheduled_date ASC, lb.start_time ASC
        LIMIT 500
      `;
    } catch (err) {
      if (!lessonBookingTransmissionColumnMissing(err)) throw err;
      bookings = await sql`
        SELECT
          lb.id,
          lb.scheduled_date::text,
          lb.start_time::text,
          lb.end_time::text,
          lb.status,
          lb.notes,
          lb.instructor_notes,
          COALESCE(lb.social_video_consent, false) AS social_video_consent,
          COALESCE(lb.social_video_discount_pct, 0) AS social_video_discount_pct,
          CASE WHEN COALESCE(i.transmission_type, 'manual') = 'automatic' THEN 'automatic' ELSE 'manual' END AS transmission_type,
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
        JOIN learner_users lu ON lu.id = lb.learner_id AND COALESCE(lu.school_id, 1) = ${schoolId}
        JOIN instructors i ON i.id = lb.instructor_id AND COALESCE(i.school_id, 1) = ${schoolId}
        LEFT JOIN lesson_types lt ON lt.id = lb.lesson_type_id AND COALESCE(lt.school_id, 1) = ${schoolId}
        WHERE lb.instructor_id = ${instructor.id}
          AND COALESCE(lb.school_id, 1) = ${schoolId}
          AND lb.status = ANY(${BLOCKING_STATUSES}::text[])
          AND lb.scheduled_date >= ${from}::date
          AND lb.scheduled_date <= ${to}::date
        ORDER BY lb.scheduled_date ASC, lb.start_time ASC
        LIMIT 500
      `;
    }

    // Pending offers in the same window — slot-pinned only (flexible offers
    // don't block any specific time). Surfaced on the calendar so the
    // instructor can see slots currently held by pending offers and cancel
    // them if needed. Lazy-expire stale ones first so they fall out.
    let pendingOffers = [];
    try {
      await sql`
        UPDATE lesson_offers SET status = 'expired'
        WHERE status = 'pending' AND expires_at <= NOW()
      `;
      pendingOffers = await sql`
        SELECT
          o.id,
          o.token,
          o.scheduled_date::text,
          o.start_time::text,
          o.end_time::text,
          o.learner_email,
          o.learner_name AS offer_learner_name,
          o.offer_price_pence,
          o.discount_pct,
          o.expires_at,
          o.kind,
          lt.id    AS lesson_type_id,
          lt.name  AS lesson_type_name,
          lt.colour AS lesson_type_colour,
          COALESCE(lt.duration_minutes, 90) AS duration_minutes,
          COALESCE(lt.price_pence, 8250)    AS lesson_type_price_pence,
          lu.name  AS learner_name
        FROM lesson_offers o
        LEFT JOIN lesson_types lt ON lt.id = o.lesson_type_id
        LEFT JOIN learner_users lu ON lu.id = o.learner_id
        WHERE o.instructor_id = ${instructor.id}
          AND o.school_id = ${schoolId}
          AND o.status = 'pending'
          AND o.scheduled_date IS NOT NULL
          AND o.scheduled_date >= ${from}::date
          AND o.scheduled_date <= ${to}::date
        ORDER BY o.scheduled_date ASC, o.start_time ASC
        LIMIT 200
      `;
    } catch (e) {
      // lesson_offers table missing in some environments — fail silently
    }

    let availabilityOverrides = [];
    try {
      availabilityOverrides = await sql`
        SELECT id,
               override_date::text AS override_date,
               start_time::text AS start_time,
               end_time::text AS end_time,
               COALESCE(transmission_type, 'both') AS transmission_type,
               note
        FROM instructor_availability_overrides
        WHERE instructor_id = ${instructor.id}
          AND school_id = ${schoolId}
          AND active = true
          AND override_date >= ${from}::date
          AND override_date <= ${to}::date
        ORDER BY override_date ASC, start_time ASC
        LIMIT 200
      `;
    } catch (e) {
      // Table may not exist before the availability override migration has run.
    }

    let busyBlocks = [];
    try {
      busyBlocks = await sql`
        SELECT id,
               block_date::text AS block_date,
               start_time::text AS start_time,
               end_time::text AS end_time,
               note
        FROM instructor_busy_blocks
        WHERE instructor_id = ${instructor.id}
          AND school_id = ${schoolId}
          AND block_date >= ${from}::date
          AND block_date <= ${to}::date
        ORDER BY block_date ASC, start_time ASC
        LIMIT 200
      `;
    } catch (e) {
      // Table may not exist before the busy-block migration has run.
    }

    return res.json({ bookings, pending_offers: pendingOffers, availability_overrides: availabilityOverrides, busy_blocks: busyBlocks });

  } catch (err) {
    console.error('schedule-range err:', err.message);
    reportError('/api/instructor', err);
    return res.status(500).json({ error: 'Failed to load schedule', details: 'Internal server error' });
  }
}

// ── GET /api/instructor?action=availability ───────────────────────────────────
// Returns the instructor's current weekly availability windows.
async function handleAvailability(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const instructor = verifyInstructorAuth(req);
  if (!instructor) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = instructor.school_id || 1;

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const windows = await sql`
      SELECT id, day_of_week, start_time::text, end_time::text, active,
             COALESCE(to_jsonb(instructor_availability)->>'transmission_type', 'both') AS transmission_type
      FROM instructor_availability
      WHERE instructor_id = ${instructor.id}
        AND school_id = ${schoolId}
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
  const schoolId = instructor.school_id || 1;

  const { windows } = req.body;
  if (!Array.isArray(windows))
    return res.status(400).json({ error: 'windows must be an array' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const [instructorRow] = await sql`
      SELECT COALESCE(transmission_type, 'manual') AS transmission_type
      FROM instructors
      WHERE id = ${instructor.id}
        AND school_id = ${schoolId}
        AND active = true
    `;
    if (!instructorRow) return res.status(404).json({ error: 'Instructor not found or inactive' });

    const instructorTransmissionType = normaliseAvailabilityTransmissionType(instructorRow.transmission_type) || 'manual';
    const cleanWindows = [];

    // Validate each window
    for (const w of windows) {
      if (w.day_of_week < 0 || w.day_of_week > 6)
        return res.status(400).json({ error: `Invalid day_of_week: ${w.day_of_week}` });
      if (!/^\d{2}:\d{2}$/.test(w.start_time) || !/^\d{2}:\d{2}$/.test(w.end_time))
        return res.status(400).json({ error: 'Times must be HH:MM format' });
      if (w.start_time >= w.end_time)
        return res.status(400).json({ error: 'start_time must be before end_time' });

      const requestedTransmissionType = w.transmission_type !== undefined && w.transmission_type !== null && String(w.transmission_type).trim() !== ''
        ? normaliseAvailabilityTransmissionType(w.transmission_type)
        : null;
      if (w.transmission_type && !requestedTransmissionType) {
        return res.status(400).json({ error: 'transmission_type must be manual, automatic, or both' });
      }

      const cleanTransmissionType = requestedTransmissionType || (instructorTransmissionType === 'both' ? 'both' : instructorTransmissionType);
      if (!instructorCanOfferAvailabilityTransmission(instructorTransmissionType, cleanTransmissionType)) {
        return res.status(400).json({ error: `This instructor profile is set to ${instructorTransmissionType} transmission only` });
      }

      cleanWindows.push({
        day_of_week: w.day_of_week,
        start_time: w.start_time,
        end_time: w.end_time,
        transmission_type: cleanTransmissionType
      });
    }

    const hasWeeklyTransmissionColumn = await instructorAvailabilityTransmissionColumnExists(sql);

    // Delete existing windows
    await sql`DELETE FROM instructor_availability WHERE instructor_id = ${instructor.id} AND school_id = ${schoolId}`;

    // Insert new windows
    if (cleanWindows.length > 0) {
      for (const w of cleanWindows) {
        if (hasWeeklyTransmissionColumn) {
          await sql`
            INSERT INTO instructor_availability (instructor_id, day_of_week, start_time, end_time, transmission_type, school_id)
            VALUES (${instructor.id}, ${w.day_of_week}, ${w.start_time}, ${w.end_time}, ${w.transmission_type}, ${schoolId})
          `;
        } else {
          await sql`
            INSERT INTO instructor_availability (instructor_id, day_of_week, start_time, end_time, school_id)
            VALUES (${instructor.id}, ${w.day_of_week}, ${w.start_time}, ${w.end_time}, ${schoolId})
          `;
        }
      }
    }

    const saved = await sql`
      SELECT id, day_of_week, start_time::text, end_time::text, active,
             COALESCE(to_jsonb(instructor_availability)->>'transmission_type', 'both') AS transmission_type
      FROM instructor_availability
      WHERE instructor_id = ${instructor.id}
        AND school_id = ${schoolId}
      ORDER BY day_of_week, start_time
    `;

    return res.json({ success: true, windows: saved });

  } catch (err) {
    console.error('instructor set-availability error:', err);
    reportError('/api/instructor', err);
    return res.status(500).json({ error: 'Failed to save availability' });
  }
}

// Date-specific extra availability, used for one-off bookable slots that do
// not change the instructor's recurring weekly pattern.
async function handleAvailabilityOverrides(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const instructor = verifyInstructorAuth(req);
  if (!instructor) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = instructor.school_id || 1;

  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: '"from" and "to" are required (YYYY-MM-DD)' });
  if (!isValidIsoDate(from) || !isValidIsoDate(to)) {
    return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
  }
  if (to < from) return res.status(400).json({ error: '"to" must be on or after "from"' });

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const overrides = await sql`
      SELECT id, override_date::text AS override_date,
             start_time::text AS start_time, end_time::text AS end_time,
             COALESCE(transmission_type, 'both') AS transmission_type,
             note
      FROM instructor_availability_overrides
      WHERE instructor_id = ${instructor.id}
        AND school_id = ${schoolId}
        AND active = true
        AND override_date >= ${from}::date
        AND override_date <= ${to}::date
      ORDER BY override_date ASC, start_time ASC
      LIMIT 500
    `;

    return res.json({ ok: true, overrides });
  } catch (err) {
    console.error('instructor availability-overrides error:', err);
    reportError('/api/instructor?action=availability-overrides', err);
    return res.status(500).json({ error: 'Failed to load availability overrides' });
  }
}

async function handleCreateAvailabilityOverride(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const instructor = verifyInstructorAuth(req);
  if (!instructor) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = instructor.school_id || 1;

  const { override_date, start_time, end_time, note, transmission_type } = req.body || {};
  if (!isValidIsoDate(override_date)) {
    return res.status(400).json({ error: 'override_date must be YYYY-MM-DD' });
  }
  if (!isValidTimeHHMM(start_time) || !isValidTimeHHMM(end_time)) {
    return res.status(400).json({ error: 'Times must be HH:MM format' });
  }
  if (start_time >= end_time) return res.status(400).json({ error: 'start_time must be before end_time' });

  let requestedTransmissionType = null;
  if (transmission_type !== undefined && transmission_type !== null && String(transmission_type).trim() !== '') {
    requestedTransmissionType = normaliseAvailabilityTransmissionType(transmission_type);
    if (!requestedTransmissionType) {
      return res.status(400).json({ error: 'transmission_type must be manual, automatic, or both' });
    }
  }

  const overrideDate = new Date(`${override_date}T00:00:00Z`);
  if (overrideDate < startOfTodayUtc()) {
    return res.status(400).json({ error: 'Cannot add availability in the past' });
  }

  const cleanNote = typeof note === 'string' && note.trim() ? note.trim().slice(0, 250) : null;

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const [instructorRow] = await sql`
      SELECT COALESCE(min_booking_notice_hours, 24) AS min_booking_notice_hours,
             COALESCE(transmission_type, 'manual') AS transmission_type
      FROM instructors
      WHERE id = ${instructor.id}
        AND school_id = ${schoolId}
        AND active = true
    `;
    if (!instructorRow) return res.status(404).json({ error: 'Instructor not found or inactive' });

    const instructorTransmissionType = normaliseAvailabilityTransmissionType(instructorRow.transmission_type) || 'manual';
    const cleanTransmissionType = requestedTransmissionType || (instructorTransmissionType === 'both' ? 'both' : instructorTransmissionType);
    if (!instructorCanOfferAvailabilityTransmission(instructorTransmissionType, cleanTransmissionType)) {
      return res.status(400).json({ error: `This instructor profile is set to ${instructorTransmissionType} transmission only` });
    }

    const slotStartMinutes = timeToMinutes(start_time);
    if (overrideDate.getTime() === startOfTodayUtc().getTime()) {
      const now = new Date();
      const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
      if (slotStartMinutes <= nowMinutes) {
        return res.status(400).json({ error: 'Cannot add availability for a time that has already started' });
      }
    }

    const slotStartDateTime = new Date(`${override_date}T00:00:00Z`);
    slotStartDateTime.setUTCHours(Math.floor(slotStartMinutes / 60), slotStartMinutes % 60, 0, 0);
    const minNoticeHours = Math.max(0, parseInt(instructorRow.min_booking_notice_hours, 10) || 0);
    if (minNoticeHours > 0 && ((slotStartDateTime - new Date()) / 3600000) < minNoticeHours) {
      return res.status(400).json({ error: `Cannot add availability within your ${minNoticeHours}-hour minimum booking notice period` });
    }

    const allDayExternalBlocks = await sql`
      SELECT 1
      FROM instructor_external_events
      WHERE instructor_id = ${instructor.id}
        AND school_id = ${schoolId}
        AND event_date = ${override_date}::date
        AND is_all_day = true
      LIMIT 1
    `;
    if (allDayExternalBlocks.length > 0) {
      return res.status(409).json({ error: 'Your synced calendar has an all-day event on this date' });
    }

    const overlapping = await sql`
      SELECT id
      FROM instructor_availability_overrides
      WHERE instructor_id = ${instructor.id}
        AND school_id = ${schoolId}
        AND active = true
        AND override_date = ${override_date}::date
        AND start_time < ${end_time}::time
        AND end_time > ${start_time}::time
        AND NOT (start_time = ${start_time}::time AND end_time = ${end_time}::time)
      LIMIT 1
    `;
    if (overlapping.length > 0) {
      return res.status(409).json({ error: 'Availability slot overlaps an existing one-off slot' });
    }

    const [row] = await sql`
      INSERT INTO instructor_availability_overrides (
        instructor_id, school_id, override_date, start_time, end_time, transmission_type, note, active
      ) VALUES (
        ${instructor.id}, ${schoolId}, ${override_date}, ${start_time}, ${end_time}, ${cleanTransmissionType}, ${cleanNote}, true
      )
      ON CONFLICT (instructor_id, school_id, override_date, start_time, end_time)
      DO UPDATE SET active = true,
                    transmission_type = EXCLUDED.transmission_type,
                    note = EXCLUDED.note
      RETURNING id, override_date::text AS override_date,
                start_time::text AS start_time, end_time::text AS end_time,
                COALESCE(transmission_type, 'both') AS transmission_type,
                note
    `;

    return res.json({ ok: true, override: row });
  } catch (err) {
    console.error('instructor create-availability-override error:', err);
    reportError('/api/instructor?action=create-availability-override', err);
    return res.status(500).json({ error: 'Failed to add availability slot' });
  }
}

async function handleDeleteAvailabilityOverride(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const instructor = verifyInstructorAuth(req);
  if (!instructor) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = instructor.school_id || 1;

  const id = parseInt(req.body?.id, 10);
  if (!id) return res.status(400).json({ error: 'id is required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const deleted = await sql`
      DELETE FROM instructor_availability_overrides
      WHERE id = ${id}
        AND instructor_id = ${instructor.id}
        AND school_id = ${schoolId}
      RETURNING id
    `;
    if (deleted.length === 0) return res.status(404).json({ error: 'Availability slot not found' });
    return res.json({ ok: true, deleted_id: id });
  } catch (err) {
    console.error('instructor delete-availability-override error:', err);
    reportError('/api/instructor?action=delete-availability-override', err);
    return res.status(500).json({ error: 'Failed to remove availability slot' });
  }
}

// ── GET /api/instructor?action=profile ────────────────────────────────────────
// Date-specific busy blocks, used for one-off commitments that should stop
// learner bookings without changing recurring weekly availability.
async function handleBusyBlocks(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const instructor = verifyInstructorAuth(req);
  if (!instructor) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = instructor.school_id || 1;

  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: '"from" and "to" are required (YYYY-MM-DD)' });
  if (!isValidIsoDate(from) || !isValidIsoDate(to)) {
    return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
  }
  if (to < from) return res.status(400).json({ error: '"to" must be on or after "from"' });

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const blocks = await sql`
      SELECT id, block_date::text AS block_date,
             start_time::text AS start_time, end_time::text AS end_time,
             note
      FROM instructor_busy_blocks
      WHERE instructor_id = ${instructor.id}
        AND school_id = ${schoolId}
        AND block_date >= ${from}::date
        AND block_date <= ${to}::date
      ORDER BY block_date ASC, start_time ASC
      LIMIT 500
    `;

    return res.json({ ok: true, blocks });
  } catch (err) {
    console.error('instructor busy-blocks error:', err);
    reportError('/api/instructor?action=busy-blocks', err);
    return res.status(500).json({ error: 'Failed to load busy blocks' });
  }
}

async function handleCreateBusyBlock(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const instructor = verifyInstructorAuth(req);
  if (!instructor) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = instructor.school_id || 1;

  const { block_date, start_time, end_time, note } = req.body || {};
  if (!isValidIsoDate(block_date)) {
    return res.status(400).json({ error: 'block_date must be YYYY-MM-DD' });
  }
  if (!isValidTimeHHMM(start_time) || !isValidTimeHHMM(end_time)) {
    return res.status(400).json({ error: 'Times must be HH:MM format' });
  }
  if (start_time >= end_time) return res.status(400).json({ error: 'start_time must be before end_time' });

  const blockDate = new Date(`${block_date}T00:00:00Z`);
  if (blockDate < startOfTodayUtc()) {
    return res.status(400).json({ error: 'Cannot block time in the past' });
  }
  if (blockDate.getTime() === startOfTodayUtc().getTime()) {
    const now = new Date();
    const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    if (timeToMinutes(end_time) <= nowMinutes) {
      return res.status(400).json({ error: 'Cannot block a time that has already ended' });
    }
  }

  const cleanNote = typeof note === 'string' && note.trim() ? note.trim().slice(0, 250) : null;

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const [instructorRow] = await sql`
      SELECT id
      FROM instructors
      WHERE id = ${instructor.id}
        AND school_id = ${schoolId}
        AND active = true
    `;
    if (!instructorRow) return res.status(404).json({ error: 'Instructor not found or inactive' });

    const overlappingBusy = await sql`
      SELECT id
      FROM instructor_busy_blocks
      WHERE instructor_id = ${instructor.id}
        AND school_id = ${schoolId}
        AND block_date = ${block_date}::date
        AND start_time < ${end_time}::time
        AND end_time > ${start_time}::time
      LIMIT 1
    `;
    if (overlappingBusy.length > 0) {
      return res.status(409).json({ error: 'Busy block overlaps an existing busy block' });
    }

    const overlappingBookings = await sql`
      SELECT id
      FROM lesson_bookings
      WHERE instructor_id = ${instructor.id}
        AND school_id = ${schoolId}
        AND scheduled_date = ${block_date}::date
        AND status = ANY(${BLOCKING_STATUSES}::text[])
        AND start_time < ${end_time}::time
        AND end_time > ${start_time}::time
      LIMIT 1
    `;
    if (overlappingBookings.length > 0) {
      return res.status(409).json({ error: 'Busy block overlaps an existing lesson' });
    }

    try {
      const overlappingReservations = await sql`
        SELECT id
        FROM slot_reservations
        WHERE instructor_id = ${instructor.id}
          AND school_id = ${schoolId}
          AND scheduled_date = ${block_date}::date
          AND expires_at > NOW()
          AND start_time < ${end_time}::time
          AND end_time > ${start_time}::time
        LIMIT 1
      `;
      if (overlappingReservations.length > 0) {
        return res.status(409).json({ error: 'Busy block overlaps a slot currently being booked' });
      }
    } catch (_) {}

    try {
      const overlappingOffers = await sql`
        SELECT id
        FROM lesson_offers
        WHERE instructor_id = ${instructor.id}
          AND school_id = ${schoolId}
          AND scheduled_date = ${block_date}::date
          AND status = 'pending'
          AND expires_at > NOW()
          AND start_time < ${end_time}::time
          AND end_time > ${start_time}::time
        LIMIT 1
      `;
      if (overlappingOffers.length > 0) {
        return res.status(409).json({ error: 'Busy block overlaps a pending lesson offer' });
      }
    } catch (_) {}

    const [row] = await sql`
      INSERT INTO instructor_busy_blocks (
        instructor_id, school_id, block_date, start_time, end_time, note
      ) VALUES (
        ${instructor.id}, ${schoolId}, ${block_date}, ${start_time}, ${end_time}, ${cleanNote}
      )
      RETURNING id, block_date::text AS block_date,
                start_time::text AS start_time, end_time::text AS end_time,
                note
    `;

    return res.json({ ok: true, block: row });
  } catch (err) {
    console.error('instructor create-busy-block error:', err);
    reportError('/api/instructor?action=create-busy-block', err);
    return res.status(500).json({ error: 'Failed to block time' });
  }
}

async function handleDeleteBusyBlock(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const instructor = verifyInstructorAuth(req);
  if (!instructor) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = instructor.school_id || 1;

  const id = parseInt(req.body?.id, 10);
  if (!id) return res.status(400).json({ error: 'id is required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const deleted = await sql`
      DELETE FROM instructor_busy_blocks
      WHERE id = ${id}
        AND instructor_id = ${instructor.id}
        AND school_id = ${schoolId}
      RETURNING id
    `;
    if (deleted.length === 0) return res.status(404).json({ error: 'Busy block not found' });
    return res.json({ ok: true, deleted_id: id });
  } catch (err) {
    console.error('instructor delete-busy-block error:', err);
    reportError('/api/instructor?action=delete-busy-block', err);
    return res.status(500).json({ error: 'Failed to remove busy block' });
  }
}

async function handleProfile(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const instructor = verifyInstructorAuth(req);
  if (!instructor) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = instructor.school_id || 1;

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const [profile] = await sql`
      SELECT id, name, email, phone, bio, photo_url, active, slug, created_at,
             COALESCE(buffer_minutes, 30) AS buffer_minutes,
             COALESCE(max_booking_days_ahead, 84) AS max_booking_days_ahead,
             COALESCE(calendar_start_hour, 7) AS calendar_start_hour,
             adi_grade, pass_rate, years_experience,
             COALESCE(specialisms, '[]'::jsonb) AS specialisms,
             vehicle_make, vehicle_model,
             COALESCE(transmission_type, 'manual') AS transmission_type,
             COALESCE(dual_controls, true) AS dual_controls,
             COALESCE(service_areas, '[]'::jsonb) AS service_areas,
             COALESCE(languages, '["English"]'::jsonb) AS languages,
             ical_feed_url, ical_last_synced_at, ical_sync_error,
             offered_lesson_types,
             COALESCE(broadcast_offers_enabled, false) AS broadcast_offers_enabled,
             COALESCE(bulk_tiers_enabled, false) AS bulk_tiers_enabled,
             COALESCE(social_video_opt_in, false) AS social_video_opt_in
      FROM instructors
      WHERE id = ${instructor.id}
        AND school_id = ${schoolId}
    `;

    if (!profile) return res.status(404).json({ error: 'Instructor not found' });
    profile.effective_hourly_rate_pence = await getEffectiveHourlyPence(sql, {
      schoolId,
      instructorId: instructor.id,
    });

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
  const schoolId = instructor.school_id || 1;

  const {
    name, phone, bio, photo_url, buffer_minutes, max_booking_days_ahead, calendar_start_hour, reminder_hours, daily_schedule_email,
    adi_grade, pass_rate, years_experience, specialisms,
    vehicle_make, vehicle_model, transmission_type, dual_controls,
    service_areas, languages, ical_feed_url, offered_lesson_types,
    broadcast_offers_enabled, bulk_tiers_enabled, social_video_opt_in
  } = req.body;

  // Validate broadcast_offers_enabled if provided
  if (broadcast_offers_enabled !== undefined && broadcast_offers_enabled !== null && typeof broadcast_offers_enabled !== 'boolean') {
    return res.status(400).json({ error: 'broadcast_offers_enabled must be true or false' });
  }
  if (bulk_tiers_enabled !== undefined && bulk_tiers_enabled !== null && typeof bulk_tiers_enabled !== 'boolean') {
    return res.status(400).json({ error: 'bulk_tiers_enabled must be true or false' });
  }
  if (social_video_opt_in !== undefined && social_video_opt_in !== null && typeof social_video_opt_in !== 'boolean') {
    return res.status(400).json({ error: 'social_video_opt_in must be true or false' });
  }

  // Validate buffer_minutes if provided
  if (buffer_minutes !== undefined && buffer_minutes !== null) {
    const buf = parseInt(buffer_minutes);
    if (isNaN(buf) || buf < 0 || buf > 120)
      return res.status(400).json({ error: 'Buffer time must be between 0 and 120 minutes' });
  }

  // Validate max_booking_days_ahead if provided. This can only reduce the
  // learner-facing window below the platform cap, never extend it.
  if (max_booking_days_ahead !== undefined && max_booking_days_ahead !== null) {
    const maxDays = parseInt(max_booking_days_ahead, 10);
    if (isNaN(maxDays) || maxDays < 1 || maxDays > 84)
      return res.status(400).json({ error: 'Advance booking window must be between 1 and 84 days' });
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

  // Validate offered_lesson_types: null (default lesson set) or array of slug strings
  // TODO: dynamicise from lesson_types table — this list drifts from DB.
  const validSlugs = ['standard', '2hr', '3hr', 'trial', '1hr'];
  if (offered_lesson_types !== undefined && offered_lesson_types !== null) {
    if (!Array.isArray(offered_lesson_types) || !offered_lesson_types.every(s => validSlugs.includes(s))) {
      return res.status(400).json({ error: 'offered_lesson_types must be null or an array of valid lesson type slugs' });
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
    const maxBookingDaysVal = (max_booking_days_ahead !== undefined && max_booking_days_ahead !== null)
      ? parseInt(max_booking_days_ahead, 10) : null;
    const cshVal = (calendar_start_hour !== undefined && calendar_start_hour !== null)
      ? parseInt(calendar_start_hour) : null;
    const rhVal = (reminder_hours !== undefined && reminder_hours !== null)
      ? parseInt(reminder_hours) : null;
    const dseVal = (daily_schedule_email !== undefined && daily_schedule_email !== null)
      ? daily_schedule_email : null;
    const broVal = (broadcast_offers_enabled !== undefined && broadcast_offers_enabled !== null)
      ? broadcast_offers_enabled : null;
    const bulkVal = (bulk_tiers_enabled !== undefined && bulk_tiers_enabled !== null)
      ? bulk_tiers_enabled : null;
    const socialVideoVal = (social_video_opt_in !== undefined && social_video_opt_in !== null)
      ? social_video_opt_in : null;
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

    // offered_lesson_types: undefined = don't touch; null = default lesson set; array = explicit list
    const offeredChanged = offered_lesson_types !== undefined;
    const offeredVal = (offered_lesson_types !== undefined && offered_lesson_types !== null)
      ? JSON.stringify(offered_lesson_types) : null;

    const [updated] = await sql`
      UPDATE instructors SET
        name                 = COALESCE(NULLIF(${name      || ''}, ''), name),
        phone                = COALESCE(${phone     ?? null}, phone),
        bio                  = COALESCE(${bio       ?? null}, bio),
        photo_url            = COALESCE(${photo_url ?? null}, photo_url),
        buffer_minutes       = COALESCE(${bufVal}, buffer_minutes),
        max_booking_days_ahead = COALESCE(${maxBookingDaysVal}, max_booking_days_ahead),
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
        ical_sync_error      = CASE WHEN ${icalChanged} THEN NULL ELSE ical_sync_error END,
        offered_lesson_types = CASE WHEN ${offeredChanged} THEN ${offeredVal}::jsonb ELSE offered_lesson_types END,
        broadcast_offers_enabled = COALESCE(${broVal}, broadcast_offers_enabled),
        bulk_tiers_enabled = COALESCE(${bulkVal}, bulk_tiers_enabled),
        social_video_opt_in = COALESCE(${socialVideoVal}, social_video_opt_in)
      WHERE id = ${instructor.id}
        AND school_id = ${schoolId}
      RETURNING id, name, email, phone, bio, photo_url,
                COALESCE(buffer_minutes, 30) AS buffer_minutes,
                COALESCE(max_booking_days_ahead, 84) AS max_booking_days_ahead,
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
                ical_feed_url, ical_last_synced_at, ical_sync_error,
                offered_lesson_types,
                COALESCE(broadcast_offers_enabled, false) AS broadcast_offers_enabled,
                COALESCE(bulk_tiers_enabled, false) AS bulk_tiers_enabled,
                COALESCE(social_video_opt_in, false) AS social_video_opt_in
    `;
    if (updated) {
      updated.effective_hourly_rate_pence = await getEffectiveHourlyPence(sql, {
        schoolId,
        instructorId: instructor.id,
      });
    }

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
  const schoolId = instructor.school_id || 1;

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const dates = await sql`
      SELECT id, blackout_date::text AS start_date, end_date::text, reason
      FROM instructor_blackout_dates
      WHERE instructor_id = ${instructor.id}
        AND school_id = ${schoolId}
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
  const schoolId = instructor.school_id || 1;

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
        AND school_id = ${schoolId}
        AND end_date >= CURRENT_DATE
    `;

    // Insert new ranges
    for (const r of ranges) {
      await sql`
        INSERT INTO instructor_blackout_dates (instructor_id, blackout_date, end_date, reason, school_id)
        VALUES (${instructor.id}, ${r.start_date}, ${r.end_date}, ${r.reason || null}, ${schoolId})
      `;
    }

    const saved = await sql`
      SELECT id, blackout_date::text AS start_date, end_date::text, reason
      FROM instructor_blackout_dates
      WHERE instructor_id = ${instructor.id}
        AND school_id = ${schoolId}
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
      LEFT JOIN driving_sessions ds ON ds.booking_id = lb.id AND ds.school_id = ${schoolId}
      WHERE lb.instructor_id = ${instructor.id}
        AND lb.learner_id = ${learnerId}
        AND lb.school_id = ${schoolId}
        AND lb.status IN (${SCHEDULED}, ${CHARGEABLE}, ${REFUNDED})
      ORDER BY lb.scheduled_date DESC, lb.start_time DESC
      LIMIT 100
    `;

    // Fetch skill ratings
    const loggedIds = bookings.filter(b => b.session_log_id).map(b => b.session_log_id);
    let ratingsMap = {};
    if (loggedIds.length > 0) {
      const allRatings = await sql`
        SELECT session_id, skill_key, rating FROM skill_ratings
        WHERE session_id = ANY(${loggedIds}) AND school_id = ${schoolId} ORDER BY id`;
      for (const r of allRatings) {
        if (!ratingsMap[r.session_id]) ratingsMap[r.session_id] = [];
        ratingsMap[r.session_id].push({ skill_key: r.skill_key, rating: r.rating });
      }
    }
    for (const b of bookings) {
      if (b.session_log_id) b.learner_ratings = ratingsMap[b.session_log_id] || [];
    }

    const privatePractice = await sql`
      SELECT fp.id, fp.focus_areas, fp.reflections, fp.completed_at, fp.created_at,
             ds.session_date::text, ds.duration_minutes
      FROM focused_practice_sessions fp
      JOIN driving_sessions ds ON ds.id = fp.session_id AND ds.school_id = fp.school_id
      WHERE fp.learner_id = ${learnerId} AND fp.school_id = ${schoolId}
      ORDER BY COALESCE(fp.completed_at, fp.created_at) DESC
      LIMIT 5`;

    const totalLessons = bookings.filter(b => b.status === CHARGEABLE).length;

    return res.json({ learner, bookings, totalLessons, private_practice: privatePractice });
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

  const { booking_id, reason, notify } = req.body;
  if (!booking_id) return res.status(400).json({ error: 'booking_id required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const [booking] = await sql`
      SELECT lb.id, lb.status, lb.learner_id, lb.instructor_id, lb.school_id,
             lb.scheduled_date, lb.start_time,
             COALESCE(lb.minutes_deducted, 90) AS minutes_deducted,
             lu.name AS learner_name, lu.email AS learner_email,
             i.name AS instructor_name
      FROM lesson_bookings lb
      JOIN learner_users lu ON lu.id = lb.learner_id
      JOIN instructors i ON i.id = lb.instructor_id
      WHERE lb.id = ${booking_id} AND lb.instructor_id = ${instructor.id}
    `;

    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (booking.status !== SCHEDULED)
      return res.status(400).json({ error: `Cannot cancel a booking with status "${booking.status}"` });

    const minsToReturn = booking.minutes_deducted || 90;

    // Cancel the booking
    await sql`
      UPDATE lesson_bookings SET status = ${REFUNDED},
        credit_returned = true, cancelled_at = NOW(),
        instructor_notes = ${reason ? 'Cancelled: ' + reason.trim() : 'Cancelled by instructor'}
      WHERE id = ${booking_id}
    `;
    await markBookingCreditSourcesRefunded(sql, {
      bookingId: booking_id,
      schoolId: booking.school_id || 1,
    });

    // Refund the learner's balance to the same LCB row that was debited.
    // No ledger row (matches the slots.js cancel refund convention — the
    // lesson_bookings row's REFUNDED status is the audit trail).
    await lockBalanceAdjustLCB(sql, {
      learnerId: booking.learner_id,
      instructorId: booking.instructor_id,
      schoolId: booking.school_id || 1,
      delta: minsToReturn,
      creditsDelta: Math.ceil(minsToReturn / 60),
    });

    // Email the learner (unless notify is explicitly false)
    if (notify !== false) try {
      const mailer = createTransporter();
      const firstName = (booking.learner_name || '').split(' ')[0] || 'there';
      const isoDate = booking.scheduled_date instanceof Date ? booking.scheduled_date.toISOString().slice(0, 10) : String(booking.scheduled_date).slice(0, 10);
      const dateObj = new Date(isoDate + 'T00:00:00Z');
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
             COALESCE(lb.social_video_consent, false) AS social_video_consent,
             COALESCE(lb.social_video_age_confirmed, false) AS social_video_age_confirmed,
             COALESCE(lb.social_video_discount_pct, 0) AS social_video_discount_pct,
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
    if (booking.status !== SCHEDULED)
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
        AND status = ANY(${BLOCKING_STATUSES}::text[])
        AND COALESCE(school_id, 1) = ${schoolId}
    `;
    if (existingBooking)
      return res.status(409).json({ error: 'That slot is already booked.' });

    // Mark old booking as rescheduled. credit_returned = TRUE prevents the
    // divergence cron from double-counting the deduction: the credit was
    // debited once on the original booking, the new booking carries the
    // same minutes_deducted forward, and the old row is no longer an
    // active draw. Without this, the cron's booking_draws CTE counts both
    // rows and reports +minutes_deducted of drift per reschedule (see
    // memory/project_step_4_5_shipped.md chip #3 entry for the three
    // historical bookings affected: #117, #133, #214).
    await sql`
      UPDATE lesson_bookings
      SET status = ${REFUNDED}, credit_returned = TRUE, cancelled_at = NOW()
      WHERE id = ${booking_id}
    `;
    const refundedBcsIds = await markBookingCreditSourcesRefunded(sql, { bookingId: booking_id, schoolId });

    // Create new booking
    let newBooking;
    try {
      const [b] = await sql`
        INSERT INTO lesson_bookings
          (learner_id, instructor_id, scheduled_date, start_time, end_time, status,
           rescheduled_from, reschedule_count, lesson_type_id, minutes_deducted,
           pickup_address, dropoff_address, school_id, social_video_consent, social_video_age_confirmed, social_video_discount_pct)
        VALUES
          (${booking.learner_id}, ${booking.instructor_id}, ${new_date}, ${new_start_time},
           ${new_end_time}, ${SCHEDULED}, ${booking_id}, ${booking.reschedule_count + 1},
           ${booking.lesson_type_id || null}, ${booking.minutes_deducted != null ? booking.minutes_deducted : null},
           ${booking.pickup_address || null}, ${booking.dropoff_address || null}, ${schoolId},
           ${!!booking.social_video_consent}, ${!!booking.social_video_age_confirmed}, ${booking.social_video_discount_pct || 0})
        RETURNING id, scheduled_date, start_time::text, end_time::text, reschedule_count
      `;
      newBooking = b;
    } catch (insertErr) {
      // Rollback: restore old booking. credit_returned must flip back to
      // FALSE in lockstep — leaving it TRUE while status returns to
      // SCHEDULED would silently exclude the booking from the cron's
      // booking_draws CTE, manufacturing -minutes_deducted of drift.
      await sql`
        UPDATE lesson_bookings
        SET status = ${SCHEDULED}, credit_returned = FALSE, cancelled_at = NULL
        WHERE id = ${booking_id}
      `;
      await restoreBookingCreditSourcesActive(sql, { bcsIds: refundedBcsIds, schoolId });
      if (insertErr.message?.includes('uq_booking_slot') || insertErr.code === '23505') {
        return res.status(409).json({ error: 'That slot was just taken. Please choose another.' });
      }
      throw insertErr;
    }
    await copyRefundedBookingCreditSources(sql, {
      bcsIds: refundedBcsIds,
      newBookingId: newBooking.id,
      schoolId,
    });

    // Email the learner
    try {
      const mailer = createTransporter();
      const isoOldDate = booking.scheduled_date instanceof Date ? booking.scheduled_date.toISOString().slice(0, 10) : String(booking.scheduled_date).slice(0, 10);
      const oldDate = new Date(isoOldDate + 'T00:00:00Z')
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

// ── POST /api/instructor?action=edit-booking ────────────────────────────────
// Body: { booking_id, scheduled_date?, start_time?, lesson_type_id?, transmission_type? }
// In-place edit of a booking's date, time, lesson type, or transmission.
async function handleEditBooking(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const instructor = verifyInstructorAuth(req);
  if (!instructor) return res.status(401).json({ error: 'Unauthorised' });

  const { booking_id, scheduled_date, start_time, lesson_type_id, transmission_type, force, notify } = req.body;
  if (!booking_id) return res.status(400).json({ error: 'booking_id is required' });
  if (!scheduled_date && !start_time && !lesson_type_id && transmission_type === undefined)
    return res.status(400).json({ error: 'At least one field to edit is required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const schoolId = instructor.school_id || 1;

    // Load booking — must belong to this instructor
    const [booking] = await sql`
      SELECT lb.id, lb.status, lb.learner_id, lb.instructor_id, lb.school_id,
             lb.scheduled_date::text AS scheduled_date, lb.start_time::text AS start_time, lb.end_time::text AS end_time,
             lb.lesson_type_id, lb.minutes_deducted, lb.setmore_key,
             CASE
               WHEN COALESCE(i.transmission_type, 'manual') = 'both' THEN COALESCE(lb.transmission_type, 'manual')
               WHEN COALESCE(i.transmission_type, 'manual') = 'automatic' THEN 'automatic'
               ELSE 'manual'
             END AS transmission_type,
             lu.name AS learner_name, lu.email AS learner_email,
             i.name AS instructor_name,
             COALESCE(i.transmission_type, 'manual') AS instructor_transmission_type,
             COALESCE(i.buffer_minutes, 30) AS buffer_minutes,
             COALESCE(lt.duration_minutes, 90) AS type_duration_minutes,
             lt.name AS lesson_type_name
      FROM lesson_bookings lb
      JOIN learner_users lu ON lu.id = lb.learner_id
      JOIN instructors i ON i.id = lb.instructor_id
      LEFT JOIN lesson_types lt ON lt.id = lb.lesson_type_id
      WHERE lb.id = ${booking_id} AND lb.instructor_id = ${instructor.id}
        AND COALESCE(lb.school_id, 1) = ${schoolId}
    `;
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (booking.status !== SCHEDULED)
      return res.status(400).json({ error: `Cannot edit a booking with status "${booking.status}"` });

    // Check if already paid out (block lesson type changes)
    if (lesson_type_id && lesson_type_id !== booking.lesson_type_id) {
      const [paidOut] = await sql`SELECT id FROM payout_line_items WHERE booking_id = ${booking_id}`;
      if (paidOut) return res.status(400).json({ error: 'Cannot change lesson type — this booking has already been included in a payout' });
    }

    // Resolve new values
    let newDate = scheduled_date || booking.scheduled_date;
    let newStartTime = start_time || String(booking.start_time).slice(0, 5);
    let newLessonTypeId = lesson_type_id || booking.lesson_type_id;
    let newDuration = parseInt(booking.type_duration_minutes) || 90;
    let newTransmissionType = normaliseLessonTransmissionType(booking.transmission_type)
      || defaultLessonTransmissionForInstructor(booking.instructor_transmission_type);

    if (transmission_type !== undefined && transmission_type !== null && String(transmission_type).trim() !== '') {
      newTransmissionType = normaliseLessonTransmissionType(transmission_type);
      if (!newTransmissionType) {
        return res.status(400).json({ error: 'transmission_type must be manual or automatic' });
      }
    }
    if (!instructorCanTeachLessonTransmission(booking.instructor_transmission_type, newTransmissionType)) {
      return res.status(400).json({ error: `This instructor profile is set to ${booking.instructor_transmission_type} transmission only` });
    }

    // If lesson type changed, look up new duration
    if (lesson_type_id && lesson_type_id !== booking.lesson_type_id) {
      const [newType] = await sql`SELECT duration_minutes FROM lesson_types WHERE id = ${lesson_type_id} AND school_id = ${schoolId}`;
      if (!newType) return res.status(404).json({ error: 'Lesson type not found' });
      newDuration = newType.duration_minutes;
    }

    // Calculate new end time
    const startParts = newStartTime.split(':').map(Number);
    const startMins = startParts[0] * 60 + startParts[1];
    const endMins = startMins + newDuration;
    const newEndTime = `${String(Math.floor(endMins / 60)).padStart(2, '0')}:${String(endMins % 60).padStart(2, '0')}`;

    // Slot conflict check — return details for confirmation instead of blocking
    const buffer = parseInt(booking.buffer_minutes) || 30;
    const conflicts = await sql`
      SELECT lb.id, lb.start_time::text AS start_time, lb.end_time::text AS end_time,
             lb.pickup_address, lu.name AS learner_name
      FROM lesson_bookings lb
      JOIN learner_users lu ON lu.id = lb.learner_id
      WHERE lb.instructor_id = ${booking.instructor_id}
        AND lb.scheduled_date = ${newDate}
        AND lb.id != ${booking_id}
        AND lb.status = ANY(${BLOCKING_STATUSES}::text[])
        AND ${newStartTime}::time < (lb.end_time + (${buffer} || ' minutes')::interval)
        AND ${newEndTime}::time > lb.start_time
      ORDER BY lb.start_time
    `;

    if (conflicts.length > 0 && !force) {
      // Estimate travel time between pickup addresses if available
      const thisPickup = booking.pickup_address || booking.learner_pickup_address;
      const conflictDetails = [];
      for (const c of conflicts) {
        const detail = {
          id: c.id,
          learner_name: c.learner_name,
          time: c.start_time.slice(0,5) + ' – ' + c.end_time.slice(0,5),
          travel_minutes: null
        };
        // Try to estimate travel time between pickups
        if (thisPickup && c.pickup_address) {
          try {
            const pcA = extractPostcode(thisPickup);
            const pcB = extractPostcode(c.pickup_address);
            if (pcA && pcB && pcA.replace(/\s/g,'') !== pcB.replace(/\s/g,'')) {
              const coords = await bulkGeocodeUK([pcA, pcB]);
              if (coords[pcA] && coords[pcB]) {
                detail.travel_minutes = estimateDriveMinutes(coords[pcA].lat, coords[pcA].lon, coords[pcB].lat, coords[pcB].lon);
              }
            } else if (pcA && pcB) {
              detail.travel_minutes = 0;
            }
          } catch { /* skip travel estimate */ }
        }
        conflictDetails.push(detail);
      }
      return res.status(409).json({
        error: 'conflict',
        message: 'This time overlaps with another booking',
        conflicts: conflictDetails,
        can_force: true
      });
    }

    const [busyBlock] = await sql`
      SELECT id
      FROM instructor_busy_blocks
      WHERE instructor_id = ${booking.instructor_id}
        AND school_id = ${schoolId}
        AND block_date = ${newDate}::date
        AND start_time < ${newEndTime}::time
        AND end_time > ${newStartTime}::time
      LIMIT 1
    `;
    if (busyBlock) {
      return res.status(409).json({ error: 'That time is blocked as busy. Remove the busy block or choose another time.' });
    }

    // Credit/balance adjustment
    const oldMinutes = parseInt(booking.minutes_deducted) || 0;
    const newMinutes = newDuration;
    const delta = newMinutes - oldMinutes;
    let balanceAdjusted = false;

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
      // Step 4 cutover: atomic balance + ledger via one CTE. Previously
      // the UPDATE and INSERT ran separately so a process kill between
      // them could move the balance without logging the adjustment.
      // delta is signed (positive = upgrade, negative = downgrade); the
      // credit_transactions row historically wrote `-delta` (positive when
      // minutes are deducted), so we negate here to preserve that convention.
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
            ? `Learner has insufficient balance. Needs ${delta} more minutes.`
            : 'Failed to adjust learner balance',
        });
      }
      balanceAdjusted = true;
    }

    // Update the booking (keep setmore_key so sync can find and skip it via edited_at check)
    await sql`
      UPDATE lesson_bookings
      SET scheduled_date = ${newDate},
          start_time = ${newStartTime}::time,
          end_time = ${newEndTime}::time,
          lesson_type_id = ${newLessonTypeId},
          transmission_type = ${newTransmissionType},
          minutes_deducted = ${oldMinutes > 0 ? newMinutes : 0},
          edited_at = NOW()
      WHERE id = ${booking_id}
    `;

    // Email learner if date/time changed and notify is not explicitly false
    const timeChanged = newDate !== booking.scheduled_date ||
      newStartTime !== String(booking.start_time).slice(0, 5) ||
      newEndTime !== String(booking.end_time).slice(0, 5);
    const shouldNotify = notify !== false;

    if (timeChanged && shouldNotify && booking.learner_email) {
      try {
        const mailer = createTransporter();
        const isoOldDate = booking.scheduled_date instanceof Date ? booking.scheduled_date.toISOString().slice(0, 10) : String(booking.scheduled_date).slice(0, 10);
        const oldDate = new Date(isoOldDate + 'T00:00:00Z')
          .toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
        const newDateStr = new Date(newDate + 'T00:00:00Z')
          .toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
        const oldTime = String(booking.start_time).slice(0, 5);
        const firstName = (booking.learner_name || '').split(' ')[0] || 'there';
        const durationStr = newDuration >= 60
          ? (newDuration % 60 === 0 ? (newDuration/60) + ' hour' + (newDuration/60 !== 1 ? 's' : '') : (newDuration/60).toFixed(1) + ' hours')
          : newDuration + ' mins';

        await mailer.sendMail({
          from: 'CoachCarter <system@coachcarter.uk>',
          to: booking.learner_email,
          subject: `Lesson updated — now ${newDateStr} at ${newStartTime}`,
          html: `
            <h2>Hi ${firstName},</h2>
            <p>Your instructor ${booking.instructor_name} has updated your lesson:</p>
            <table>
              <tr><td><strong>Was:</strong></td><td><s>${oldDate} at ${oldTime}</s></td></tr>
              <tr><td><strong>Now:</strong></td><td>${newDateStr} at ${newStartTime}</td></tr>
              <tr><td><strong>Duration:</strong></td><td>${durationStr}</td></tr>
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
        console.error('Failed to send edit notification email:', emailErr);
      }
    }

    return res.json({ ok: true, booking_id, newDate, newStartTime, newEndTime, newLessonTypeId, transmission_type: newTransmissionType, balanceAdjusted, delta });
  } catch (err) {
    console.error('instructor edit-booking error:', err);
    reportError('/api/instructor', err);
    return res.status(500).json({ error: 'Failed to edit booking' });
  }
}

// ── POST /api/instructor?action=create-booking ────────────────────────────
// Body: { learner_id, scheduled_date, start_time, payment_method, notes, pickup_address?, dropoff_address?, transmission_type? }
// Instructor creates a booking on behalf of a learner.
async function createInstructorCreditBookingTransaction({
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
  sourceTypes = CREDIT_BOOKING_SOURCE_TYPES,
  blockingStatuses = BLOCKING_STATUSES,
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
        abortInstructorBookingTransaction({
          ok: false,
          code: 'LCB_SCOPE_INVARIANT',
          message: 'Learner credit balance row exists outside the expected school scope',
        });
      }

      const balanceMinutes = Number(locked.rows[0].balance_minutes || 0);
      if (balanceMinutes < durationMins) {
        abortInstructorBookingTransaction({
          ok: false,
          code: 'INSUFFICIENT_BALANCE',
          balanceMinutes,
        });
      }

      const existingBooking = await client.query(
        `SELECT id
           FROM lesson_bookings
          WHERE instructor_id = $1
            AND school_id = $2
            AND scheduled_date = $3
            AND start_time = $4::time
            AND status = ANY($5::text[])
          LIMIT 1`,
        [instructorId, schoolId, scheduledDate, startTime, blockingStatuses]
      );
      if (existingBooking.rowCount > 0) {
        abortInstructorBookingTransaction({
          ok: false,
          code: 'SLOT_UNAVAILABLE',
          message: 'That slot is already booked. Please choose another time.',
        });
      }

      const busyBlockConflict = await client.query(
        `SELECT id
           FROM instructor_busy_blocks
          WHERE instructor_id = $1
            AND school_id = $2
            AND block_date = $3::date
            AND start_time < $5::time
            AND end_time > $4::time
          LIMIT 1`,
        [instructorId, schoolId, scheduledDate, startTime, endTime]
      );
      if (busyBlockConflict.rowCount > 0) {
        abortInstructorBookingTransaction({
          ok: false,
          code: 'SLOT_UNAVAILABLE',
          message: 'That time is blocked as busy. Remove the busy block or choose another time.',
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
        [learnerId, instructorId, schoolId, sourceTypes]
      );

      const fifoPlan = planFifoCreditDraw({
        sources: sourcesResult.rows,
        minutes: durationMins,
        schoolId,
      });
      if (!fifoPlan.ok) {
        abortInstructorBookingTransaction({
          ok: false,
          code: 'INSUFFICIENT_FIFO_SOURCES',
          balanceMinutes,
          shortageMinutes: fifoPlan.shortage_minutes,
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
              'instructor', 'credit', $7, $8, $9,
              $10, $11, $12, $13,
              0, 'live_compute_insert')
           RETURNING id, scheduled_date::text, start_time::text, end_time::text, status`,
          [
            learnerId, instructorId, scheduledDate, startTime, endTime, SCHEDULED,
            notes || null, pickupAddress || null, dropoffAddress || null,
            lessonTypeId || null, transmissionType, durationMins, schoolId,
          ]
        );
        booking = inserted.rows[0];
      } catch (err) {
        if (err.code === '23505' || err.message?.includes('uq_booking_slot') || err.message?.includes('uq_instructor_slot')) {
          abortInstructorBookingTransaction({
            ok: false,
            code: 'SLOT_UNAVAILABLE',
            message: 'That slot is already booked. Please choose another time.',
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
        if (row.absorbed_by !== 'instructor') {
          payableListPricePence += row.contribution_pence;
        }
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
    if (err instanceof InstructorBookingTransactionAbort) {
      return err.result;
    }
    throw err;
  }
}

async function handleCreateBooking(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const instructor = verifyInstructorAuth(req);
  if (!instructor) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = instructor.school_id || 1;

  const { learner_id, scheduled_date, start_time, lesson_type_id, payment_method, notes, pickup_address, dropoff_address, transmission_type } = req.body;
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
      SELECT id, name, email, phone, COALESCE(transmission_type, 'manual') AS transmission_type
      FROM instructors
      WHERE id = ${instructor.id} AND school_id = ${schoolId}
    `;
    if (!instrDetails) return res.status(404).json({ error: 'Instructor not found' });

    const requestedTransmissionType = transmission_type !== undefined && transmission_type !== null && String(transmission_type).trim() !== ''
      ? normaliseLessonTransmissionType(transmission_type)
      : null;
    if (transmission_type && !requestedTransmissionType) {
      return res.status(400).json({ error: 'transmission_type must be manual or automatic' });
    }
    const bookingTransmissionType = requestedTransmissionType
      || defaultLessonTransmissionForInstructor(instrDetails.transmission_type);
    if (!instructorCanTeachLessonTransmission(instrDetails.transmission_type, bookingTransmissionType)) {
      return res.status(400).json({ error: `This instructor profile is set to ${instrDetails.transmission_type} transmission only` });
    }

    // Credit bookings must create booking_credit_sources in the same
    // transaction as the booking and LCB decrement, matching slots.js.
    let booking;
    const bookingPickup = pickup_address || learner.pickup_address || null;
    const bookingDropoff = dropoff_address || null;

    try {
      const [busyBlock] = await sql`
        SELECT id
        FROM instructor_busy_blocks
        WHERE instructor_id = ${instructor.id}
          AND school_id = ${schoolId}
          AND block_date = ${scheduled_date}::date
          AND start_time < ${end_time}::time
          AND end_time > ${start_time}::time
        LIMIT 1
      `;
      if (busyBlock) {
        return res.status(409).json({ error: 'That time is blocked as busy. Remove the busy block or choose another time.' });
      }
    } catch (_) {}

    if (payMethod === 'credit') {
      const booked = await createInstructorCreditBookingTransaction({
        connectionString: process.env.POSTGRES_URL,
        learnerId: learner_id,
        instructorId: instructor.id,
        schoolId,
        scheduledDate: scheduled_date,
        startTime: start_time,
        endTime: end_time,
        lessonTypeId: lessonType.id,
        transmissionType: bookingTransmissionType,
        durationMins,
        notes,
        pickupAddress: bookingPickup,
        dropoffAddress: bookingDropoff,
      });

      if (!booked.ok) {
        if (booked.code === 'INSUFFICIENT_BALANCE' || booked.code === 'INSUFFICIENT_FIFO_SOURCES') {
          const balance = booked.balanceMinutes != null ? booked.balanceMinutes : 0;
          return res.status(402).json({ error: `${learner.name} doesn't have enough hours. They need ${durationStr} but have ${(balance / 60).toFixed(1)} hrs. Use "Cash" or "Free" instead.` });
        }
        if (booked.code === 'SLOT_UNAVAILABLE') {
          return res.status(409).json({ error: booked.message || 'That slot is already booked. Please choose another time.' });
        }
        return res.status(500).json({ error: 'Failed to create credit booking' });
      }

      booking = booked.booking;
    } else {
      try {
        const [b] = await sql`
          INSERT INTO lesson_bookings
            (learner_id, instructor_id, scheduled_date, start_time, end_time, status,
             created_by, payment_method, instructor_notes, pickup_address, dropoff_address,
             lesson_type_id, transmission_type, minutes_deducted, school_id)
          VALUES
            (${learner_id}, ${instructor.id}, ${scheduled_date}, ${start_time}, ${end_time},
             ${SCHEDULED}, 'instructor', ${payMethod}, ${notes || null},
             ${bookingPickup}, ${bookingDropoff},
             ${lessonType.id}, ${bookingTransmissionType}, 0, ${schoolId})
          RETURNING id, scheduled_date, start_time::text, end_time::text, status
        `;
        booking = b;
      } catch (insertErr) {
        if (insertErr.message?.includes('uq_booking_slot') || insertErr.code === '23505') {
          return res.status(409).json({ error: 'That slot is already booked. Please choose another time.' });
        }
        throw insertErr;
      }
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
            <tr><td><strong>Transmission:</strong></td><td>${bookingTransmissionType === 'automatic' ? 'Automatic' : 'Manual'}</td></tr>
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
      `✅ Lesson booked!\n\n📅 ${dateStr}\n⏰ ${start_time} – ${end_time}\n🚗 Instructor: ${instrDetails.name}\n\n${payMethod === 'credit' ? `${durationStr} deducted. ${balanceStr} remaining.\n\n` : ''}Need to cancel? Do so at least 48 hours before and the lesson returns to your balance.\n\nView bookings: https://coachcarter.uk/learner/`
    );

    await sendWhatsApp(
      instrDetails.phone,
      `Lesson booked\n\nLearner: ${learner.name}\nDate: ${dateStr}\nTime: ${start_time} - ${end_time}\nType: ${lessonType.name}\nDuration: ${durationStr}\n\nView schedule: https://coachcarter.uk/instructor/`,
      {
        purpose: 'instructor.booking_created',
        learnerId: learner.id,
        instructorId: instructor.id,
        schoolId,
      }
    );

    return res.json({
      ok: true,
      booking_id: booking.id,
      learner_name: learner.name,
      scheduled_date,
      start_time,
      end_time,
      transmission_type: bookingTransmissionType,
      payment_method: payMethod,
      credit_balance: updated.credit_balance,
      balance_minutes: updated.balance_minutes || 0,
      balance_hours: ((updated.balance_minutes || 0) / 60).toFixed(1)
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
      WHERE instructor_id = ${instructor.id} AND status = ANY(${BLOCKING_STATUSES}::text[])
        AND scheduled_date = CURRENT_DATE
    `;

    // This week (Mon-Sun)
    const [weekStats] = await sql`
      SELECT COUNT(*)::int AS count FROM lesson_bookings
      WHERE instructor_id = ${instructor.id} AND status = ANY(${BLOCKING_STATUSES}::text[])
        AND scheduled_date >= date_trunc('week', CURRENT_DATE)
        AND scheduled_date < date_trunc('week', CURRENT_DATE) + INTERVAL '7 days'
    `;

    // This month
    const [monthStats] = await sql`
      SELECT
        COUNT(*) FILTER (WHERE status = ${CHARGEABLE})::int AS completed,
        COUNT(*) FILTER (WHERE status = ${SCHEDULED})::int AS upcoming,
        COUNT(*) FILTER (WHERE status = ${REFUNDED})::int AS cancelled
      FROM lesson_bookings
      WHERE instructor_id = ${instructor.id}
        AND scheduled_date >= date_trunc('month', CURRENT_DATE)
        AND scheduled_date < date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'
    `;

    // Total all-time
    const [allTime] = await sql`
      SELECT COUNT(*)::int AS total_completed FROM lesson_bookings
      WHERE instructor_id = ${instructor.id} AND status = ${CHARGEABLE}
    `;

    // Unique learners this month
    const [learnerCount] = await sql`
      SELECT COUNT(DISTINCT learner_id)::int AS count FROM lesson_bookings
      WHERE instructor_id = ${instructor.id} AND status = ANY(${BLOCKING_STATUSES}::text[])
        AND scheduled_date >= date_trunc('month', CURRENT_DATE)
    `;

    // New bookings since last visit (last 24h)
    const [newBookings] = await sql`
      SELECT COUNT(*)::int AS count FROM lesson_bookings
      WHERE instructor_id = ${instructor.id} AND status = ${SCHEDULED}
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
        lu.credit_balance, lu.balance_minutes,
        COALESCE(lcb.balance_minutes, 0)::int AS instructor_balance_minutes,
        COUNT(lb.id)::int AS total_lessons,
        COUNT(lb.id) FILTER (WHERE lb.status = ${CHARGEABLE})::int AS completed_lessons,
        COUNT(lb.id) FILTER (WHERE lb.status = ${SCHEDULED} AND lb.scheduled_date >= CURRENT_DATE)::int AS upcoming_lessons,
        MAX(lb.scheduled_date)::text AS last_lesson_date,
        MIN(lb.scheduled_date)::text AS first_lesson_date,
        iln.notes AS instructor_notes,
        iln.test_date::text AS test_date,
        iln.custom_hourly_rate_pence,
        iln.learner_category
      FROM learner_users lu
      LEFT JOIN lesson_bookings lb
        ON lb.learner_id = lu.id
       AND lb.instructor_id = ${instructor.id}
       AND lb.school_id = ${schoolId}
      LEFT JOIN instructor_learner_notes iln
        ON iln.learner_id = lu.id
       AND iln.instructor_id = ${instructor.id}
       AND iln.school_id = ${schoolId}
      LEFT JOIN learner_credit_balances lcb
        ON lcb.learner_id = lu.id
       AND lcb.instructor_id = ${instructor.id}
       AND lcb.school_id = ${schoolId}
      WHERE lu.school_id = ${schoolId}
        AND lu.archived_at IS NULL
        AND (
          lb.id IS NOT NULL
          OR iln.id IS NOT NULL
          OR lu.primary_instructor_id = ${instructor.id}
          OR lcb.id IS NOT NULL
        )
      GROUP BY lu.id, lcb.balance_minutes, iln.notes, iln.test_date, iln.custom_hourly_rate_pence, iln.learner_category
      ORDER BY MAX(lb.scheduled_date) DESC NULLS LAST, lu.name ASC
    `;

    // Bolt on availability windows for each learner so the list view can show
    // "free Mon 4–6pm, Wed evenings…" without a per-row fetch.
    const learnerIds = learners.map(l => l.id);
    let availabilityByLearner = {};
    if (learnerIds.length > 0) {
      const windows = await sql`
        SELECT learner_id, day_of_week,
               start_time::text AS start_time,
               end_time::text   AS end_time
        FROM learner_availability
        WHERE active = true
          AND school_id = ${schoolId}
          AND learner_id = ANY(${learnerIds})
        ORDER BY day_of_week, start_time
      `;
      for (const w of windows) {
        if (!availabilityByLearner[w.learner_id]) availabilityByLearner[w.learner_id] = [];
        availabilityByLearner[w.learner_id].push({
          day_of_week: w.day_of_week,
          start_time:  w.start_time.slice(0, 5),
          end_time:    w.end_time.slice(0, 5)
        });
      }
    }
    for (const l of learners) {
      l.availability = availabilityByLearner[l.id] || [];
    }

    return res.json({ learners });
  } catch (err) {
    console.error('instructor my-learners error:', err);
    reportError('/api/instructor', err);
    return res.status(500).json({ error: 'Failed to load learners' });
  }
}

// ── GET /api/instructor?action=school-learners ──────────────────────────────
// Returns every learner in this instructor's school, with a per-instructor
// `is_your_learner` flag so the booking dropdown can mark "Your learner" vs
// "New to you". Distinct from my-learners (which restricts to learners who
// have booked with this instructor) — only used by the Book Lesson modal.
async function handleSchoolLearners(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const instructor = verifyInstructorAuth(req);
  if (!instructor) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = instructor.school_id || 1;

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const learners = await sql`
      SELECT
        lu.id, lu.name, lu.email, lu.phone,
        lu.credit_balance,
        COALESCE(lcb.balance_minutes, 0)::int AS balance_minutes,
        lu.balance_minutes AS total_balance_minutes,
        (
          EXISTS (
          SELECT 1 FROM lesson_bookings lb
          WHERE lb.learner_id = lu.id
            AND lb.instructor_id = ${instructor.id}
            AND lb.school_id = ${schoolId}
          )
          OR EXISTS (
            SELECT 1 FROM instructor_learner_notes iln
            WHERE iln.learner_id = lu.id
              AND iln.instructor_id = ${instructor.id}
              AND iln.school_id = ${schoolId}
          )
          OR lu.primary_instructor_id = ${instructor.id}
          OR lcb.id IS NOT NULL
        ) AS is_your_learner
      FROM learner_users lu
      LEFT JOIN learner_credit_balances lcb
        ON lcb.learner_id = lu.id
       AND lcb.instructor_id = ${instructor.id}
       AND lcb.school_id = ${schoolId}
      WHERE lu.school_id = ${schoolId}
        AND lu.archived_at IS NULL
      ORDER BY lu.name ASC
    `;

    return res.json({ learners });
  } catch (err) {
    console.error('instructor school-learners error:', err);
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
    if (![SCHEDULED, CHARGEABLE].includes(booking.status))
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
        mt.supervisor_notes,
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
      LEFT JOIN mock_test_faults f ON f.mock_test_id = mt.id AND f.school_id = ${schoolId}
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
  const schoolId = instructor.school_id || 1;

  const learner_id = req.query.learner_id;
  if (!learner_id) return res.status(400).json({ error: 'learner_id required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Tenant relationship check: the learner must belong to this instructor's
    // school. Without this an instructor could read notes (or create one via
    // the POST handler) against a learner_id from another school.
    const [learner] = await sql`
      SELECT id FROM learner_users WHERE id = ${learner_id} AND school_id = ${schoolId}
    `;
    if (!learner) return res.status(404).json({ error: 'Learner not found' });

    const [row] = await sql`
      SELECT notes, test_date::text, custom_hourly_rate_pence, learner_category
      FROM instructor_learner_notes
      WHERE instructor_id = ${instructor.id}
        AND learner_id = ${learner_id}
        AND school_id = ${schoolId}
    `;
    return res.json({
      notes: row?.notes || '',
      test_date: row?.test_date || null,
      custom_hourly_rate_pence: row?.custom_hourly_rate_pence || null,
      learner_category: row?.learner_category || null
    });
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
  const schoolId = instructor.school_id || 1;

  const { learner_id, notes, test_date, custom_hourly_rate_pence, learner_category } = req.body;
  if (!learner_id) return res.status(400).json({ error: 'learner_id required' });

  const ratePence = custom_hourly_rate_pence != null && custom_hourly_rate_pence !== '' ? parseInt(custom_hourly_rate_pence) : null;
  if (ratePence != null && (isNaN(ratePence) || ratePence < 0)) return res.status(400).json({ error: 'Invalid hourly rate' });
  const category = learner_category != null && learner_category !== '' ? normaliseLearnerCategory(learner_category) : null;
  if (learner_category != null && learner_category !== '' && !category) {
    return res.status(400).json({ error: 'Invalid learner category' });
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Tenant relationship check: the learner must belong to this instructor's
    // school. Without this an instructor could upsert a note against a
    // learner_id from another school. The ON CONFLICT clause stops them
    // overwriting an existing note from another instructor, but does not
    // stop them from creating a row against an arbitrary learner_id.
    const [learner] = await sql`
      SELECT id FROM learner_users WHERE id = ${learner_id} AND school_id = ${schoolId}
    `;
    if (!learner) return res.status(404).json({ error: 'Learner not found' });

    await sql`
      INSERT INTO instructor_learner_notes (instructor_id, learner_id, notes, test_date, custom_hourly_rate_pence, learner_category, school_id, updated_at)
      VALUES (${instructor.id}, ${learner_id}, ${notes || null}, ${test_date || null}, ${ratePence}, ${category}, ${schoolId}, NOW())
      ON CONFLICT (instructor_id, learner_id)
      DO UPDATE SET notes = ${notes || null}, test_date = ${test_date || null}, custom_hourly_rate_pence = ${ratePence}, learner_category = ${category}, updated_at = NOW()
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
      LEFT JOIN learner_users lu ON lu.id = lb.learner_id
      LEFT JOIN lesson_types lt ON lt.id = lb.lesson_type_id
      LEFT JOIN instructor_learner_notes iln ON iln.instructor_id = lb.instructor_id AND iln.learner_id = lb.learner_id
      WHERE lb.instructor_id = ${instructor.id}
        AND lb.status = ANY(${BLOCKING_STATUSES}::text[])
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
      if (l.status === CHARGEABLE) completedCount++;
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
        AND lb.status = ${CHARGEABLE}
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
        AND lb.status = ANY(${BLOCKING_STATUSES}::text[])
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
        AND lb.status = ${CHARGEABLE}
    `;

    // Distinct weeks with completed lessons (for average)
    const [weeksActive] = await sql`
      SELECT COUNT(DISTINCT date_trunc('week', scheduled_date))::int AS count
      FROM lesson_bookings
      WHERE instructor_id = ${instructor.id} AND status = ${CHARGEABLE}
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
          AND lb.status = ANY(${BLOCKING_STATUSES}::text[])
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
// Body: { learner_id?, learner_email?, learner_name?, scheduled_date?, start_time?, lesson_type_id?, offer_price_pence?, discount_pct?, max_repeat_weeks? }
// Creates a lesson offer. If learner_id is provided, binds the offer to that existing school learner.
// If learner_email is provided, emails the learner an accept link.
// If only learner_name is provided, creates a link-only offer (no email sent).
// Slot fields are optional — omit for "flexible" offers where learner picks their own time.
// offer_price_pence overrides effective pricing; otherwise the final price is snapshotted from effective hourly fallback.
// max_repeat_weeks (1..18, default null = single lesson): caps how many weekly
// repeats the learner can choose on the accept page. Slot-pinned only.
async function handleCreateOffer(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const instructor = verifyInstructorAuth(req);
  if (!instructor) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = instructor.school_id || 1;

  const { learner_id, learner_email, learner_name, scheduled_date, start_time, lesson_type_id, offer_price_pence, discount_pct, max_repeat_weeks } = req.body;
  const learnerIdClean = learner_id != null && learner_id !== '' ? parseInt(learner_id, 10) : null;
  if (learnerIdClean != null && (!Number.isInteger(learnerIdClean) || learnerIdClean <= 0))
    return res.status(400).json({ error: 'learner_id must be a positive integer' });
  if (!learnerIdClean && !learner_email && !learner_name)
    return res.status(400).json({ error: 'Either learner_id, learner_email, or learner_name is required' });

  const isFlexible = !scheduled_date && !start_time;

  // Validate custom price if provided
  if (offer_price_pence != null) {
    const p = parseInt(offer_price_pence);
    if (isNaN(p) || p < 0) return res.status(400).json({ error: 'offer_price_pence must be a non-negative integer' });
  }
  const discountPctClean = (discount_pct === undefined || discount_pct === null || discount_pct === '') ? 0 : parseInt(discount_pct, 10);
  if (![0, 25, 50, 75, 100].includes(discountPctClean))
    return res.status(400).json({ error: 'discount_pct must be 0, 25, 50, 75, or 100' });

  // Validate max_repeat_weeks if provided. Range 1..18 (1 = single lesson, no
  // repeat option shown; 2..18 = learner picks count on accept page). Only
  // valid for slot-pinned offers — flexible offers credit the learner instead.
  let maxRepeatWeeksClean = null;
  if (max_repeat_weeks != null && max_repeat_weeks !== '') {
    const mrw = parseInt(max_repeat_weeks, 10);
    if (isNaN(mrw) || mrw < 1 || mrw > 18)
      return res.status(400).json({ error: 'max_repeat_weeks must be between 1 and 18' });
    if (isFlexible && mrw > 1)
      return res.status(400).json({ error: 'Weekly repeats can only be offered with a fixed slot, not flexible offers' });
    maxRepeatWeeksClean = mrw;
  }

  // Validate email format (only when email is provided)
  if (learner_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(learner_email))
    return res.status(400).json({ error: 'Invalid email address' });

  // Validate date (only for slot-pinned offers)
  if (scheduled_date) {
    const bookingDate = new Date(scheduled_date + 'T00:00:00Z');
    if (isNaN(bookingDate.getTime()))
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    if (bookingDate < today)
      return res.status(400).json({ error: 'Cannot offer a lesson in the past' });
    // First slot of the offer must be within the 4-week advance cap.
    // The series itself may run past it (the webhook creates the repeats with
    // the exemption justified by the instructor's explicit opt-in).
    const maxAhead = new Date(today);
    maxAhead.setUTCDate(maxAhead.getUTCDate() + 28);
    if (bookingDate > maxAhead)
      return res.status(400).json({ error: 'Offer date cannot be more than 4 weeks in advance' });
    if (!start_time)
      return res.status(400).json({ error: 'start_time is required when scheduled_date is provided' });
  }

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
      lessonType = lt || { id: null, slug: 'standard', duration_minutes: 90, name: 'Standard Lesson', price_pence: 8250 };
    }
    const durationMins = lessonType.duration_minutes;
    const isTrialOffer = lessonType.slug === 'trial';
    if (isTrialOffer && isFlexible) {
      return res.status(400).json({ error: 'Free trial offers must be for a fixed slot. Pick a date and time, or use a standard/free lesson offer.' });
    }

    // Calculate end time (only for slot-pinned offers)
    let end_time = null;
    if (start_time) {
      const startParts = start_time.split(':').map(Number);
      const startMins  = startParts[0] * 60 + startParts[1];
      const endMins    = startMins + durationMins;
      end_time = `${String(Math.floor(endMins / 60)).padStart(2, '0')}:${String(endMins % 60).padStart(2, '0')}`;
    }

    // Get instructor details
    const [instrDetails] = await sql`
      SELECT id, name, email, phone, offered_lesson_types FROM instructors
      WHERE id = ${instructor.id}
        AND school_id = ${schoolId}
    `;
    if (!instrDetails) return res.status(404).json({ error: 'Instructor not found' });
    if (!isLessonTypeOffered(instrDetails.offered_lesson_types, lessonType.slug)) {
      return res.status(400).json({ error: 'This instructor does not offer that lesson type' });
    }

    // Slot conflict checks (only for slot-pinned offers)
    if (!isFlexible) {
      const [existingBooking] = await sql`
        SELECT id FROM lesson_bookings
        WHERE instructor_id = ${instructor.id}
          AND scheduled_date = ${scheduled_date}
          AND start_time = ${start_time}::time
          AND status = ANY(${BLOCKING_STATUSES}::text[])
          AND school_id = ${schoolId}
      `;
      if (existingBooking)
        return res.status(409).json({ error: 'That slot is already booked.' });

      const [existingOffer] = await sql`
        SELECT id FROM lesson_offers
        WHERE instructor_id = ${instructor.id}
          AND scheduled_date = ${scheduled_date}
          AND start_time = ${start_time}::time
          AND status = 'pending'
          AND expires_at > NOW()
          AND school_id = ${schoolId}
      `;
      if (existingOffer)
        return res.status(409).json({ error: 'There is already a pending offer for that slot.' });

      let hasReservation = false;
      try {
        const [existingRes] = await sql`
          SELECT id FROM slot_reservations
          WHERE instructor_id = ${instructor.id}
            AND scheduled_date = ${scheduled_date}
            AND start_time = ${start_time}::time
            AND expires_at > NOW()
            AND school_id = ${schoolId}
        `;
        hasReservation = !!existingRes;
      } catch (e) { /* table may not exist */ }
      if (hasReservation)
        return res.status(409).json({ error: 'Someone is currently booking that slot. Try again shortly.' });
    }

    let existingLearner = null;
    if (learnerIdClean) {
      const [found] = await sql`
        SELECT id, name, email, phone, pickup_address
        FROM learner_users
        WHERE id = ${learnerIdClean}
          AND school_id = ${schoolId}
          AND archived_at IS NULL
      `;
      if (!found)
        return res.status(404).json({ error: 'Learner not found in your school' });
      existingLearner = found;
    } else if (learner_email) {
      const [found] = await sql`
        SELECT id, name, email, phone, pickup_address FROM learner_users
        WHERE LOWER(email) = LOWER(${learner_email})
          AND school_id = ${schoolId}
      `;
      existingLearner = found || null;
    }

    // Generate offer token
    const token = generateToken();

    // Freeze the per-lesson price now. Link-only/flexible offers with no
    // learner id skip the custom-pair tier and use instructor -> school.
    const offerPricing = await calcOfferLessonPrice(sql, {
      schoolId,
      instructorId: instructor.id,
      learnerId: existingLearner?.id || null,
      durationMinutes: durationMins,
      explicitPricePence: isTrialOffer ? 0 : offer_price_pence,
      discountPct: discountPctClean,
    });

    // Insert offer
    const resolvedEmail = existingLearner?.email || (learner_email ? learner_email.toLowerCase() : null);
    const resolvedPhone = existingLearner?.phone || null;
    const offerName = existingLearner?.name || learner_name || null;
    const offerExpiresAt = new Date(Date.now() + (isFlexible ? 7 : 1) * 24 * 60 * 60 * 1000).toISOString();
    const [offer] = await sql`
      INSERT INTO lesson_offers
        (token, instructor_id, learner_email, learner_name, learner_id, scheduled_date, start_time, end_time,
         lesson_type_id, discount_pct, offer_price_pence, max_repeat_weeks, status, expires_at, school_id)
      VALUES
        (${token}, ${instructor.id}, ${resolvedEmail}, ${offerName}, ${existingLearner?.id || null},
         ${scheduled_date || null}, ${start_time || null}, ${end_time},
         ${lessonType.id}, ${discountPctClean}, ${offerPricing.pricePence}, ${maxRepeatWeeksClean}, 'pending', ${offerExpiresAt}, ${schoolId})
      RETURNING id, expires_at
    `;

    // Determine final price for email
    const pricePence = offerPricing.pricePence;
    const priceStr = pricePence === 0 ? 'FREE' : `£${(pricePence / 100).toFixed(2)}`;
    const durationStr = durationMins >= 60
      ? (durationMins % 60 === 0 ? `${durationMins / 60} hour${durationMins / 60 !== 1 ? 's' : ''}` : `${(durationMins / 60).toFixed(1)} hours`)
      : `${durationMins} mins`;
    const baseUrl = process.env.BASE_URL || 'https://coachcarter.uk';
    const acceptUrl = `${baseUrl}/accept-offer.html?token=${token}`;
    const firstName = existingLearner ? (existingLearner.name || '').split(' ')[0] || 'there' : 'there';
    const discountText = offerPricing.discountPct > 0 ? ` (${offerPricing.discountPct}% off)` : '';
    const perLessonText = maxRepeatWeeksClean && maxRepeatWeeksClean > 1 ? ' per lesson' : '';
    const priceDisplayText = `${priceStr}${perLessonText}${discountText}`;
    const messageAcceptLine = isFlexible
      ? `Choose a time here: ${acceptUrl}`
      : `Accept within 24 hours: ${acceptUrl}`;
    const emailExpiryText = isFlexible
      ? 'This flexible offer is valid for 7 days.'
      : 'This offer expires in 24 hours. If you don\'t accept by then, the slot will become available again.';

    // Build notification content — slot-pinned vs flexible
    let emailSubject, emailSlotRows, messageOfferSummary;
    if (isFlexible) {
      emailSubject = `Driving lesson offer from ${instrDetails.name}`;
      messageOfferSummary = `${durationStr} driving lesson at a time you choose`;
      emailSlotRows = `
        <tr><td style="padding:6px 16px 6px 0;font-weight:bold">When</td><td style="padding:6px 0">Pick a time that suits you</td></tr>
        <tr><td style="padding:6px 16px 6px 0;font-weight:bold">Duration</td><td style="padding:6px 0">${durationStr}</td></tr>
        <tr><td style="padding:6px 16px 6px 0;font-weight:bold">Price</td><td style="padding:6px 0">${priceDisplayText}</td></tr>`;
    } else {
      const dateObj = new Date(scheduled_date + 'T00:00:00Z');
      const dateStr = dateObj.toLocaleDateString('en-GB', {
        weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC'
      });
      emailSubject = `Driving lesson offer from ${instrDetails.name} — ${dateStr}`;
      const repeatRow = maxRepeatWeeksClean && maxRepeatWeeksClean > 1
        ? `<tr><td style="padding:6px 16px 6px 0;font-weight:bold">Weekly repeats</td><td style="padding:6px 0">Pick up to ${maxRepeatWeeksClean} weekly lessons on the accept page</td></tr>`
        : '';
      messageOfferSummary = `${dateStr} at ${start_time} - ${end_time} (${durationStr})${maxRepeatWeeksClean && maxRepeatWeeksClean > 1 ? `, with up to ${maxRepeatWeeksClean} weekly lessons available` : ''}`;
      emailSlotRows = `
        <tr><td style="padding:6px 16px 6px 0;font-weight:bold">Date</td><td style="padding:6px 0">${dateStr}</td></tr>
        <tr><td style="padding:6px 16px 6px 0;font-weight:bold">Time</td><td style="padding:6px 0">${start_time} – ${end_time}</td></tr>
        <tr><td style="padding:6px 16px 6px 0;font-weight:bold">Duration</td><td style="padding:6px 0">${durationStr}</td></tr>
        <tr><td style="padding:6px 16px 6px 0;font-weight:bold">Price</td><td style="padding:6px 0">${priceDisplayText}</td></tr>
        ${repeatRow}`;
    }

    // Send offer SMS (only when a stored learner phone is available). Delivery
    // failures must not block offer creation; instructors can always copy the link.
    let messageSent = false;
    let messageError = null;
    if (resolvedPhone) {
      try {
        const messageResult = await sendWhatsApp(
          resolvedPhone,
          `Hi ${firstName}, ${instrDetails.name} has sent you a driving lesson offer.\n\n` +
          `${messageOfferSummary}\n` +
          `Price: ${priceDisplayText}\n\n` +
          messageAcceptLine,
          {
            purpose: 'offer.created_learner',
            learnerId: existingLearner?.id,
            instructorId: instructor.id,
            schoolId,
          }
        );
        messageSent = !!messageResult?.ok;
        messageError = messageResult?.ok ? null : (messageResult?.error || 'Message delivery failed');
      } catch (messageErr) {
        console.error('Failed to send offer message:', messageErr);
        messageError = messageErr.message || 'Message delivery failed';
      }
    }

    // Send offer email (only when email is provided)
    let emailSent = false;
    if (resolvedEmail) {
      try {
        const mailer = createTransporter();
        await mailer.sendMail({
          from: 'CoachCarter <bookings@coachcarter.uk>',
          to: resolvedEmail,
          subject: emailSubject,
          html: `
            <div style="font-family:Arial,Helvetica,sans-serif;max-width:580px;margin:0 auto">
              <h2 style="color:#262626">Hi ${firstName},</h2>
              <p>${instrDetails.name} has offered you a driving lesson:</p>
              <table style="border-collapse:collapse;margin:16px 0">
                ${emailSlotRows}
              </table>
              <p style="margin:24px 0">
                <a href="${acceptUrl}"
                   style="background:#f58321;color:white;padding:14px 28px;text-decoration:none;
                          border-radius:8px;display:inline-block;font-weight:bold;font-size:1rem">
                  ${pricePence === 0 ? 'Accept free lesson →' : 'Accept &amp; pay →'}
                </a>
              </p>
              <p style="font-size:0.85rem;color:#797879">
                ${emailExpiryText}
              </p>
            </div>
          `
        });
        emailSent = true;
      } catch (emailErr) {
        console.error('Failed to send offer email:', emailErr);
        // Still return success — offer was created, email just failed
      }
    }

    return res.json({
      ok: true,
      offer_id: offer.id,
      expires_at: offer.expires_at,
      learner_exists: !!existingLearner,
      learner_name: offerName,
      email_available: !!resolvedEmail,
      message_available: !!resolvedPhone,
      email_sent: emailSent,
      message_sent: messageSent,
      message_error: messageError,
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

// ── GET /api/instructor?action=preview-broadcast-audience ────────────────────
// Query: ?scheduled_date=YYYY-MM-DD&start_time=HH:MM&end_time=HH:MM
// Returns the list of learners with active weekly availability covering the
// slot, for the instructor's broadcast picker. Names + per-learner availability
// summary (the same chips shown on the My Learners page) so the instructor
// can untick anyone they don't want to message.
async function handlePreviewBroadcastAudience(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const instructor = verifyInstructorAuth(req);
  if (!instructor) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = instructor.school_id || 1;

  const { scheduled_date, start_time, end_time } = req.query;
  if (!scheduled_date || !start_time || !end_time)
    return res.status(400).json({ error: 'scheduled_date, start_time, end_time all required' });

  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduled_date))
    return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
  // Validate times
  const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!timeRe.test(start_time) || !timeRe.test(end_time))
    return res.status(400).json({ error: 'Times must be HH:MM format' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Compute day-of-week from the slot date (UTC).
    const dayOfWeek = new Date(scheduled_date + 'T00:00:00Z').getUTCDay();

    // Find all learners with an active availability window covering the slot,
    // scoped to this school. Aggregate their other availability windows so the
    // picker can show "Mon/Wed eves" alongside each name.
    const learners = await sql`
      SELECT lu.id, lu.name, lu.email,
             COALESCE(json_agg(
               json_build_object(
                 'day_of_week', la2.day_of_week,
                 'start_time', la2.start_time::text,
                 'end_time', la2.end_time::text
               ) ORDER BY la2.day_of_week, la2.start_time
             ) FILTER (WHERE la2.id IS NOT NULL), '[]'::json) AS availability
      FROM learner_availability la
      JOIN learner_users lu ON lu.id = la.learner_id
      LEFT JOIN learner_availability la2
        ON la2.learner_id = lu.id AND la2.active = true AND la2.school_id = ${schoolId}
      WHERE la.active = true
        AND la.school_id = ${schoolId}
        AND lu.school_id = ${schoolId}
        AND la.day_of_week = ${dayOfWeek}
        AND la.start_time <= ${start_time}::time
        AND la.end_time   >= ${end_time}::time
      GROUP BY lu.id, lu.name, lu.email
      ORDER BY lu.name ASC
    `;

    return res.json({ ok: true, learners });
  } catch (err) {
    console.error('preview-broadcast-audience error:', err);
    reportError('/api/instructor', err);
    return res.status(500).json({ error: 'Failed to load audience' });
  }
}

// ── POST /api/instructor?action=create-broadcast-offer ───────────────────────
// Body: {
//   scheduled_date: 'YYYY-MM-DD',
//   start_time: 'HH:MM',
//   lesson_type_id?: number (defaults to standard),
//   discount_pct?: 0|25|50|75|100 (defaults to 0),
//   learner_ids: number[]
// }
// Mints a broadcast batch in lesson_offers (kind='broadcast', trigger='instructor_manual').
// One row per learner_id with its own single-use token. Sends WhatsApp + email
// per recipient with a link to /accept-offer.html?token=… (race-aware copy).
async function handleCreateBroadcastOffer(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const instructor = verifyInstructorAuth(req);
  if (!instructor) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = instructor.school_id || 1;

  const { scheduled_date, start_time, lesson_type_id, discount_pct, learner_ids } = req.body;

  if (!scheduled_date || !/^\d{4}-\d{2}-\d{2}$/.test(scheduled_date))
    return res.status(400).json({ error: 'scheduled_date (YYYY-MM-DD) required' });
  if (!start_time || !/^([01]\d|2[0-3]):[0-5]\d$/.test(start_time))
    return res.status(400).json({ error: 'start_time (HH:MM) required' });
  if (!Array.isArray(learner_ids) || learner_ids.length === 0)
    return res.status(400).json({ error: 'learner_ids must be a non-empty array' });
  if (learner_ids.some(id => !Number.isInteger(id) || id <= 0))
    return res.status(400).json({ error: 'learner_ids must contain positive integers' });

  // Reject past dates so we don't create offers for slots that have already passed
  const slotDT = new Date(`${scheduled_date}T${start_time}:00Z`);
  if (slotDT.getTime() <= Date.now())
    return res.status(400).json({ error: 'Cannot broadcast for a slot in the past' });

  // discount_pct must match the table's CHECK constraint
  const dp = (discount_pct === undefined || discount_pct === null) ? 0 : parseInt(discount_pct);
  if (![0, 25, 50, 75, 100].includes(dp))
    return res.status(400).json({ error: 'discount_pct must be 0, 25, 50, 75, or 100' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Look up lesson type (or default to standard).
    let lessonType;
    if (lesson_type_id) {
      const [lt] = await sql`
        SELECT id, name, duration_minutes, price_pence
        FROM lesson_types
        WHERE id = ${parseInt(lesson_type_id)} AND active = true AND school_id = ${schoolId}
      `;
      lessonType = lt;
    }
    if (!lessonType) {
      const [lt] = await sql`
        SELECT id, name, duration_minutes, price_pence
        FROM lesson_types
        WHERE slug = 'standard' AND active = true AND school_id = ${schoolId}
      `;
      lessonType = lt || { id: null, name: 'Standard Lesson', duration_minutes: 90, price_pence: 8250 };
    }
    const durationMins = lessonType.duration_minutes;

    // Compute end_time from start + duration
    const [sh, sm] = start_time.split(':').map(Number);
    const startMins = sh * 60 + sm;
    const endMins = startMins + durationMins;
    const end_time = `${String(Math.floor(endMins / 60)).padStart(2, '0')}:${String(endMins % 60).padStart(2, '0')}`;

    // Slot-conflict checks: don't broadcast on a slot that's already booked or
    // has a pending manual offer. (Many pending broadcasts on the same slot are
    // fine — that's the whole point — so we don't check those.)
    const [existingBooking] = await sql`
      SELECT id FROM lesson_bookings
      WHERE instructor_id = ${instructor.id}
        AND scheduled_date = ${scheduled_date}
        AND start_time = ${start_time}::time
        AND status = ANY(${BLOCKING_STATUSES}::text[])
        AND school_id = ${schoolId}
    `;
    if (existingBooking)
      return res.status(409).json({ error: 'That slot is already booked.' });

    const [existingManualOffer] = await sql`
      SELECT id FROM lesson_offers
      WHERE instructor_id = ${instructor.id}
        AND scheduled_date = ${scheduled_date}
        AND start_time = ${start_time}::time
        AND status = 'pending'
        AND kind = 'manual'
        AND school_id = ${schoolId}
    `;
    if (existingManualOffer)
      return res.status(409).json({ error: 'There is already a pending offer on that slot.' });

    // Verify each learner is in this school AND has availability covering the slot.
    // We trust the frontend less than the DB — re-validate so a malicious client
    // can't broadcast to learners who didn't opt in to that time.
    const dayOfWeek = new Date(scheduled_date + 'T00:00:00Z').getUTCDay();
    const validLearners = await sql`
      SELECT DISTINCT lu.id, lu.name, lu.email, lu.phone
      FROM learner_users lu
      JOIN learner_availability la ON la.learner_id = lu.id
      WHERE lu.id = ANY(${learner_ids})
        AND lu.school_id = ${schoolId}
        AND la.school_id = ${schoolId}
        AND la.active = true
        AND la.day_of_week = ${dayOfWeek}
        AND la.start_time <= ${start_time}::time
        AND la.end_time   >= ${end_time}::time
    `;

    if (validLearners.length === 0)
      return res.status(400).json({ error: 'None of the selected learners are free at that time.' });

    // Mint the batch.
    const crypto = require('crypto');
    const batchId = crypto.randomUUID();
    const expiresAt = new Date(`${scheduled_date}T${start_time}:00Z`);

    const offerRows = [];
    for (const lu of validLearners) {
      const token = crypto.randomBytes(24).toString('hex');
      const offerPricing = await calcOfferLessonPrice(sql, {
        schoolId,
        instructorId: instructor.id,
        learnerId: lu.id,
        durationMinutes: durationMins,
        discountPct: dp,
      });
      try {
        const [row] = await sql`
          INSERT INTO lesson_offers
            (token, instructor_id, learner_email, learner_id, learner_name,
             scheduled_date, start_time, end_time,
             lesson_type_id, discount_pct, offer_price_pence, status,
             kind, batch_id, trigger,
             expires_at, school_id)
          VALUES
            (${token}, ${instructor.id}, ${lu.email || null}, ${lu.id}, ${lu.name || null},
             ${scheduled_date}, ${start_time}, ${end_time},
             ${lessonType.id}, ${dp}, ${offerPricing.pricePence}, 'pending',
             'broadcast', ${batchId}, 'instructor_manual',
             ${expiresAt.toISOString()}, ${schoolId})
          RETURNING id, token
        `;
        offerRows.push({ ...row, learner: lu, pricing: offerPricing });
      } catch (err) {
        console.warn('broadcast offer insert failed for learner', lu.id, err.message);
      }
    }

    if (offerRows.length === 0)
      return res.status(500).json({ error: 'Failed to create any offers' });

    // Send notifications in parallel (fire-and-forget).
    const { sendWhatsApp } = require('./_whatsapp');
    const { createTransporter } = require('./_auth-helpers');
    const baseUrl = process.env.BASE_URL || 'https://coachcarter.uk';

    const isoDate = scheduled_date;
    const dateObj = new Date(isoDate + 'T00:00:00Z');
    const dateStr = dateObj.toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC'
    });
    function fmtTime(t) {
      const [h, m] = t.split(':').map(Number);
      const ampm = h >= 12 ? 'pm' : 'am';
      const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, '0')}${ampm}`;
    }
    const timeStr = fmtTime(start_time);
    const [instrRow] = await sql`SELECT name FROM instructors WHERE id = ${instructor.id}`;
    const instructorName = instrRow?.name || 'Your instructor';

    const mailer = createTransporter();

    for (const { token, learner, pricing } of offerRows) {
      const acceptLink = `${baseUrl}/accept-offer.html?token=${token}`;
      const priceStr = pricing.pricePence === 0 ? 'FREE' : `£${(pricing.pricePence / 100).toFixed(2)}`;
      const wasStr = `£${(pricing.basePricePence / 100).toFixed(2)}`;
      const discountLabel = dp > 0 ? ` at ${dp}% off (${priceStr} instead of ${wasStr})` : ` for ${priceStr}`;
      const waMsg = `${instructorName} has a ${timeStr} slot on ${dateStr}${discountLabel}.\n\nFirst come, first served. Click to book: ${acceptLink}`;

      if (learner.phone) {
        sendWhatsApp(learner.phone, waMsg)
          .catch(err => console.warn('manual broadcast WA failed:', err.message));
      }
      if (learner.email) {
        mailer.sendMail({
          from:    'CoachCarter <bookings@coachcarter.uk>',
          to:      learner.email,
          subject: `${instructorName} has a ${timeStr} slot on ${dateStr}`,
          html: `
            <h2>A lesson slot is available</h2>
            <p><strong>${instructorName}</strong> has a slot opening up that matches your weekly availability:</p>
            <table style="border-collapse:collapse;margin:16px 0">
              <tr><td style="padding:6px 16px 6px 0;font-weight:bold">Date</td><td>${dateStr}</td></tr>
              <tr><td style="padding:6px 16px 6px 0;font-weight:bold">Time</td><td>${timeStr}</td></tr>
              <tr><td style="padding:6px 16px 6px 0;font-weight:bold">Lesson</td><td>${lessonType.name}</td></tr>
              <tr><td style="padding:6px 16px 6px 0;font-weight:bold">Price</td><td>
                ${dp > 0
                  ? `<strong>${priceStr}</strong> <span style="text-decoration:line-through;color:#888;font-weight:normal">${wasStr}</span> &middot; ${dp}% off`
                  : `<strong>${priceStr}</strong>`}
              </td></tr>
            </table>
            <p><strong>First come, first served</strong> — this slot is being offered to a few learners who said they're free at this time.</p>
            <p style="margin:24px 0">
              <a href="${acceptLink}"
                 style="background:#f58321;color:white;padding:14px 28px;text-decoration:none;
                        border-radius:8px;display:inline-block;font-weight:bold;font-size:1rem">
                Book this slot →
              </a>
            </p>
            <p style="font-size:0.85rem;color:#888">You received this because you set weekly availability covering this time. Update your availability anytime on your profile.</p>
          `
        }).catch(err => console.warn('manual broadcast email failed:', err.message));
      }
    }

    return res.json({
      ok: true,
      batch_id: batchId,
      notified: offerRows.length,
      skipped: learner_ids.length - validLearners.length,
      expires_at: expiresAt.toISOString()
    });
  } catch (err) {
    console.error('create-broadcast-offer error:', err);
    reportError('/api/instructor', err);
    return res.status(500).json({ error: 'Failed to create broadcast offer' });
  }
}

// ── POST /api/instructor?action=close-broadcast-offer ────────────────────────
// Body: { batch_id }
// Cancels all pending offers in the batch and sends a "no longer available"
// follow-up to those recipients. Slot is implicitly withdrawn — no booking
// gets made, the calendar shows it as free again.
async function handleCloseBroadcastOffer(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const instructor = verifyInstructorAuth(req);
  if (!instructor) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = instructor.school_id || 1;

  const { batch_id } = req.body;
  if (!batch_id) return res.status(400).json({ error: 'batch_id required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Verify the batch belongs to this instructor (and isn't already closed).
    // We grab one row to confirm ownership; the supersede helper handles the
    // rest of the logic + notifications.
    const [sample] = await sql`
      SELECT scheduled_date::text AS scheduled_date, start_time::text AS start_time
      FROM lesson_offers
      WHERE batch_id = ${batch_id}
        AND instructor_id = ${instructor.id}
        AND school_id = ${schoolId}
        AND status = 'pending'
        AND kind = 'broadcast'
      LIMIT 1
    `;

    if (!sample)
      return res.status(404).json({ error: 'No pending broadcast found with that batch_id (already closed or not yours)' });

    const { supersedeBroadcastSiblings } = require('./_notify-availability');
    const { superseded } = await supersedeBroadcastSiblings({
      instructor_id: instructor.id,
      scheduled_date: sample.scheduled_date,
      start_time: sample.start_time.slice(0, 5),
      school_id: schoolId,
      winnerOfferId: null, // no winner — instructor is closing
      batchId: batch_id
    });

    return res.json({ ok: true, closed: superseded });
  } catch (err) {
    console.error('close-broadcast-offer error:', err);
    reportError('/api/instructor', err);
    return res.status(500).json({ error: 'Failed to close broadcast' });
  }
}

// ── GET /api/instructor?action=my-broadcast-batches ──────────────────────────
// Returns active broadcast batches (pending offers grouped by batch_id) for
// the dashboard card. Each batch shows slot details + recipient count.
async function handleMyBroadcastBatches(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const instructor = verifyInstructorAuth(req);
  if (!instructor) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = instructor.school_id || 1;

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const batches = await sql`
      SELECT
        batch_id,
        MIN(scheduled_date::text)            AS scheduled_date,
        MIN(start_time::text)                AS start_time,
        MIN(end_time::text)                  AS end_time,
        MIN(lesson_type_id)                  AS lesson_type_id,
        MIN(discount_pct)                    AS discount_pct,
        MIN(trigger)                         AS trigger,
        MIN(created_at)                      AS created_at,
        MIN(expires_at)                      AS expires_at,
        COUNT(*) FILTER (WHERE status = 'pending')::int    AS pending_count,
        COUNT(*) FILTER (WHERE status = 'accepted')::int   AS accepted_count,
        COUNT(*) FILTER (WHERE status = 'superseded')::int AS superseded_count,
        COUNT(*)::int                         AS total_count
      FROM lesson_offers
      WHERE instructor_id = ${instructor.id}
        AND school_id = ${schoolId}
        AND kind = 'broadcast'
        AND batch_id IS NOT NULL
        AND expires_at > NOW()
      GROUP BY batch_id
      HAVING COUNT(*) FILTER (WHERE status = 'pending') > 0
      ORDER BY MIN(scheduled_date) ASC, MIN(start_time) ASC
    `;

    return res.json({ ok: true, batches });
  } catch (err) {
    console.error('my-broadcast-batches error:', err);
    reportError('/api/instructor', err);
    return res.status(500).json({ error: 'Failed to load broadcast batches' });
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
      SELECT id, amount_pence, platform_fee_pence, franchise_fee_pence, stripe_transfer_id,
             period_start, period_end, status, failure_reason,
             shortfall_pence, shortfall_recovered_from_payout_id, deposit_deducted_pence,
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

    // Running outstanding shortfall — sum of completed-but-unrecovered shortfalls.
    // Drives the "Outstanding from prior weeks" banner on /instructor/earnings.html.
    const [{ outstanding_shortfall_pence }] = await sql`
      SELECT COALESCE(SUM(shortfall_pence), 0)::int AS outstanding_shortfall_pence
        FROM instructor_payouts
       WHERE instructor_id = ${user.id}
         AND status = ${CHARGEABLE}
         AND shortfall_pence > 0
         AND shortfall_recovered_from_payout_id IS NULL
    `;

    return res.json({ ok: true, payouts, total, limit, offset, outstanding_shortfall_pence });
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
      SELECT commission_rate, weekly_franchise_fee_pence, stripe_onboarding_complete, payouts_paused, payouts_start_date
        FROM instructors WHERE id = ${user.id}
    `;
    if (!instructor) return res.status(404).json({ error: 'Instructor not found' });

    const bookings = await getEligibleBookings(sql, user.id, instructor.payouts_start_date || null);
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
        AND lb.status = ${SCHEDULED}
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

module.exports._createInstructorCreditBookingTransaction = createInstructorCreditBookingTransaction;
module.exports._CREDIT_BOOKING_SOURCE_TYPES = CREDIT_BOOKING_SOURCE_TYPES;
module.exports._buildScopedDurationCreditRefusal = buildScopedDurationCreditRefusal;
