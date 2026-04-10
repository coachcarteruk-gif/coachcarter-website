// Waiting List API
//
// Routes:
//   POST /api/waitlist?action=join          (JWT auth required)
//     → add learner to waitlist with optional day/time/instructor prefs
//
//   GET  /api/waitlist?action=my-waitlist   (JWT auth required)
//     → list active/notified entries for this learner
//
//   POST /api/waitlist?action=leave         (JWT auth required)
//     → remove a waitlist entry
//
// Internal export:
//   checkWaitlistOnCancel(slot) — called from slots.js after cancellation

const { neon }   = require('@neondatabase/serverless');
const nodemailer = require('nodemailer');
const jwt        = require('jsonwebtoken');
const twilio     = require('twilio');
const { reportError } = require('./_error-alert');
const { requireAuth, getSchoolId } = require('./_auth');

// ── Helpers (duplicated from slots.js per project convention) ────────────────

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

function createTransporter() {
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   parseInt(process.env.SMTP_PORT),
    secure: process.env.SMTP_PORT === '465',
    auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

function formatDateDisplay(str) {
  const d = new Date(str + 'T00:00:00Z');
  return d.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
  });
}

function formatTime12(t) {
  const [h, m] = String(t).slice(0, 5).split(':').map(Number);
  const ampm = h >= 12 ? 'pm' : 'am';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, '0')}${ampm}`;
}

// ── Main handler ─────────────────────────────────────────────────────────────

const handler = async (req, res) => {
  const action = req.query.action;
  if (action === 'join')        return handleJoin(req, res);
  if (action === 'my-waitlist') return handleMyWaitlist(req, res);
  if (action === 'leave')       return handleLeave(req, res);
  return res.status(400).json({ error: 'Unknown action' });
};

// ── POST ?action=join ────────────────────────────────────────────────────────

async function handleJoin(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = requireAuth(req, { roles: ['learner'] });
  if (!user) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = getSchoolId(user, req);

  try {
    const sql = neon(process.env.POSTGRES_URL);
    let { instructor_id, preferred_day, preferred_start_time, preferred_end_time,
          lesson_type_id, use_my_availability } = req.body;

    // Coerce nullable ints
    instructor_id = instructor_id ? parseInt(instructor_id) : null;
    lesson_type_id = lesson_type_id ? parseInt(lesson_type_id) : null;

    // If using availability windows, null out explicit prefs
    if (use_my_availability) {
      preferred_day = null;
      preferred_start_time = null;
      preferred_end_time = null;

      // Verify learner has at least one availability window
      const [check] = await sql`
        SELECT 1 FROM learner_availability
        WHERE learner_id = ${user.id} AND active = true LIMIT 1`;
      if (!check) {
        return res.status(400).json({
          error: 'Please set your weekly availability on your profile first'
        });
      }
    } else {
      // Validate explicit prefs if provided
      if (preferred_day !== null && preferred_day !== undefined) {
        preferred_day = parseInt(preferred_day);
        if (preferred_day < 0 || preferred_day > 6)
          return res.status(400).json({ error: 'preferred_day must be 0-6' });
      } else {
        preferred_day = null;
      }

      const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
      if (preferred_start_time || preferred_end_time) {
        if (!timeRe.test(preferred_start_time) || !timeRe.test(preferred_end_time))
          return res.status(400).json({ error: 'Times must be HH:MM format' });
        if (preferred_start_time >= preferred_end_time)
          return res.status(400).json({ error: 'end_time must be after start_time' });
      } else {
        preferred_start_time = null;
        preferred_end_time = null;
      }
    }

    // Duplicate check
    const [existing] = await sql`
      SELECT 1 FROM waitlist
      WHERE learner_id = ${user.id}
        AND school_id = ${schoolId}
        AND status = 'active'
        AND instructor_id IS NOT DISTINCT FROM ${instructor_id}
        AND preferred_day IS NOT DISTINCT FROM ${preferred_day}
        AND preferred_start_time IS NOT DISTINCT FROM ${preferred_start_time}
        AND preferred_end_time IS NOT DISTINCT FROM ${preferred_end_time}
      LIMIT 1`;

    if (existing)
      return res.status(409).json({ error: 'You already have an identical waitlist entry' });

    // Cap active entries per learner
    const [countRow] = await sql`
      SELECT COUNT(*)::int AS cnt FROM waitlist
      WHERE learner_id = ${user.id} AND school_id = ${schoolId} AND status = 'active'`;
    if (countRow.cnt >= 10)
      return res.status(400).json({ error: 'Maximum 10 active waitlist entries' });

    const [entry] = await sql`
      INSERT INTO waitlist (learner_id, instructor_id, preferred_day,
        preferred_start_time, preferred_end_time, lesson_type_id, school_id)
      VALUES (${user.id}, ${instructor_id}, ${preferred_day},
        ${preferred_start_time}, ${preferred_end_time}, ${lesson_type_id}, ${schoolId})
      RETURNING id, status, expires_at`;

    return res.json({ success: true, entry });
  } catch (err) {
    console.error('waitlist join error:', err);
    reportError('/api/waitlist', err);
    return res.status(500).json({ error: 'Failed to join waitlist' });
  }
}

// ── GET ?action=my-waitlist ──────────────────────────────────────────────────

async function handleMyWaitlist(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = requireAuth(req, { roles: ['learner'] });
  if (!user) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = getSchoolId(user, req);

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Expire stale entries
    await sql`
      UPDATE waitlist SET status = 'expired'
      WHERE learner_id = ${user.id} AND school_id = ${schoolId} AND status = 'active' AND expires_at < NOW()`;

    const entries = await sql`
      SELECT w.id, w.instructor_id, w.preferred_day,
             w.preferred_start_time::text, w.preferred_end_time::text,
             w.lesson_type_id, w.status, w.created_at, w.expires_at, w.notified_at,
             i.name AS instructor_name,
             lt.name AS lesson_type_name
      FROM waitlist w
      LEFT JOIN instructors i ON i.id = w.instructor_id AND i.school_id = ${schoolId}
      LEFT JOIN lesson_types lt ON lt.id = w.lesson_type_id
      WHERE w.learner_id = ${user.id}
        AND w.school_id = ${schoolId}
        AND w.status IN ('active', 'notified')
      ORDER BY w.created_at DESC`;

    return res.json({ entries });
  } catch (err) {
    console.error('waitlist my-waitlist error:', err);
    reportError('/api/waitlist', err);
    return res.status(500).json({ error: 'Failed to load waitlist' });
  }
}

// ── POST ?action=leave ───────────────────────────────────────────────────────

async function handleLeave(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = requireAuth(req, { roles: ['learner'] });
  if (!user) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = getSchoolId(user, req);

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const { waitlist_id } = req.body;
    if (!waitlist_id) return res.status(400).json({ error: 'waitlist_id required' });

    const result = await sql`
      UPDATE waitlist SET status = 'expired'
      WHERE id = ${waitlist_id}
        AND learner_id = ${user.id}
        AND school_id = ${schoolId}
        AND status IN ('active', 'notified')
      RETURNING id`;

    if (result.length === 0)
      return res.status(404).json({ error: 'Waitlist entry not found or already removed' });

    return res.json({ success: true });
  } catch (err) {
    console.error('waitlist leave error:', err);
    reportError('/api/waitlist', err);
    return res.status(500).json({ error: 'Failed to leave waitlist' });
  }
}

// ── Internal: check waitlist after a cancellation ────────────────────────────
// Called from api/slots.js — fire-and-forget, errors are caught by caller.

async function checkWaitlistOnCancel({ instructor_id, instructor_name, scheduled_date, start_time, end_time, lesson_type_id, school_id }) {
  const sql = neon(process.env.POSTGRES_URL);
  const schoolId = school_id || 1;

  // 1. Expire stale entries first
  await sql`
    UPDATE waitlist SET status = 'expired'
    WHERE school_id = ${schoolId} AND status = 'active' AND expires_at < NOW()`;

  // 2. Compute day of week for the cancelled slot
  const cancelledDay = new Date(scheduled_date + 'T00:00:00Z').getUTCDay();
  const slotStart = String(start_time).slice(0, 5);
  const slotEnd   = String(end_time).slice(0, 5);

  // 3. Find matching waitlist entries:
  //    Branch 1: explicit day/time prefs on the entry
  //    Branch 2: no explicit prefs → fall back to learner_availability windows
  const matches = await sql`
    SELECT DISTINCT w.id AS waitlist_id, w.learner_id,
           lu.name, lu.email, lu.phone
    FROM waitlist w
    JOIN learner_users lu ON lu.id = w.learner_id
    WHERE w.status = 'active'
      AND w.school_id = ${schoolId}
      AND (w.instructor_id = ${instructor_id} OR w.instructor_id IS NULL)
      AND (w.lesson_type_id = ${lesson_type_id || null} OR w.lesson_type_id IS NULL)
      AND (
        (w.preferred_day = ${cancelledDay}
         AND w.preferred_start_time <= ${slotStart}::time
         AND w.preferred_end_time >= ${slotEnd}::time)
        OR
        (w.preferred_day IS NULL AND EXISTS (
          SELECT 1 FROM learner_availability la
          WHERE la.learner_id = w.learner_id
            AND la.active = true
            AND la.day_of_week = ${cancelledDay}
            AND la.start_time <= ${slotStart}::time
            AND la.end_time >= ${slotEnd}::time
        ))
      )`;

  if (matches.length === 0) return;

  // 4. Mark all matched entries as notified
  const matchIds = matches.map(m => m.waitlist_id);
  await sql`
    UPDATE waitlist SET status = 'notified', notified_at = NOW()
    WHERE id = ANY(${matchIds})`;

  // 5. Send notifications to all matches
  const dateStr = formatDateDisplay(scheduled_date);
  const timeStr = formatTime12(slotStart);
  const bookLink = `https://coachcarter.uk/learner/book.html`;

  const mailer = createTransporter();

  for (const m of matches) {
    // WhatsApp
    sendWhatsApp(m.phone,
      `A slot just opened!\n\n📅 ${dateStr} at ${timeStr}\n👨‍🏫 ${instructor_name}\n\nBook now: ${bookLink}`
    ).catch(err => console.warn('waitlist WA failed:', err.message));

    // Email
    mailer.sendMail({
      from:    'CoachCarter <bookings@coachcarter.uk>',
      to:      m.email,
      subject: `A slot opened — ${dateStr} at ${timeStr}`,
      html: `
        <h2>A lesson slot just opened!</h2>
        <p>A slot you were waiting for is now available:</p>
        <table style="border-collapse:collapse;margin:16px 0">
          <tr><td style="padding:6px 16px 6px 0;font-weight:bold">Date</td><td>${dateStr}</td></tr>
          <tr><td style="padding:6px 16px 6px 0;font-weight:bold">Time</td><td>${timeStr}</td></tr>
          <tr><td style="padding:6px 16px 6px 0;font-weight:bold">Instructor</td><td>${instructor_name}</td></tr>
        </table>
        <p>This slot is available to all notified learners — first to book gets it!</p>
        <p style="margin:24px 0">
          <a href="${bookLink}"
             style="background:#f58321;color:white;padding:14px 28px;text-decoration:none;
                    border-radius:8px;display:inline-block;font-weight:bold;font-size:1rem">
            Book this slot →
          </a>
        </p>
        <p style="font-size:0.85rem;color:#888">You received this because you're on the waitlist. If you no longer need notifications, visit your profile to update your waitlist.</p>
      `
    }).catch(err => console.warn('waitlist email failed:', err.message));
  }

}

// ── Exports ──────────────────────────────────────────────────────────────────

handler.checkWaitlistOnCancel = checkWaitlistOnCancel;
module.exports = handler;
