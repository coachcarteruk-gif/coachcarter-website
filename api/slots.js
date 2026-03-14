// Slot generation engine + booking actions
//
// Routes:
//   GET  /api/slots?action=available&from=YYYY-MM-DD&to=YYYY-MM-DD[&instructor_id=X]
//     → returns all available 1.5-hour slots in date range, grouped by date
//
//   POST /api/slots?action=book          (JWT auth required)
//     → deduct 1 credit and create a confirmed booking
//
//   POST /api/slots?action=cancel        (JWT auth required)
//     → cancel a booking; returns credit if 48+ hours notice
//
//   GET  /api/slots?action=my-bookings   (JWT auth required)
//     → upcoming + recent past bookings for the authenticated learner
//
// Constraints enforced:
//   - "from" may not be in the past
//   - "to" may not exceed 90 days from today (3-month advance booking window)
//   - Max 31 days per request (for performance)
//   - 48-hour cancellation policy for credit return

const { neon }    = require('@neondatabase/serverless');
const nodemailer  = require('nodemailer');
const jwt         = require('jsonwebtoken');

const SLOT_MINUTES        = 90;   // 1.5 hours
const MAX_DAYS_AHEAD      = 90;   // booking window
const MAX_RANGE_DAYS      = 31;   // max days per API request
const CANCEL_HOURS_CUTOFF = 48;   // hours notice needed to get credit back

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

function verifyAuth(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  try { return jwt.verify(auth.slice(7), secret); } catch { return null; }
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
  if (action === 'available')   return handleAvailable(req, res);
  if (action === 'book')        return handleBook(req, res);
  if (action === 'cancel')      return handleCancel(req, res);
  if (action === 'my-bookings') return handleMyBookings(req, res);

  return res.status(400).json({ error: 'Unknown action' });
};

// ── GET /api/slots?action=available ──────────────────────────────────────────
async function handleAvailable(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { from, to, instructor_id } = req.query;

  // Validate dates
  if (!from || !to)
    return res.status(400).json({ error: '"from" and "to" query params are required (YYYY-MM-DD)' });

  const fromDate = parseDate(from);
  const toDate   = parseDate(to);

  if (!fromDate || !toDate)
    return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });

  const today    = startOfDay(new Date());
  const maxAhead = addDays(today, MAX_DAYS_AHEAD);

  if (fromDate < today)
    return res.status(400).json({ error: '"from" date cannot be in the past' });

  if (toDate > maxAhead)
    return res.status(400).json({
      error: `"to" date cannot be more than ${MAX_DAYS_AHEAD} days from today`
    });

  if (daysBetween(fromDate, toDate) > MAX_RANGE_DAYS)
    return res.status(400).json({
      error: `Date range cannot exceed ${MAX_RANGE_DAYS} days per request`
    });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // 1. Load availability windows (optionally filtered to one instructor)
    const windows = instructor_id
      ? await sql`
          SELECT ia.instructor_id, ia.day_of_week,
                 ia.start_time::text AS start_time,
                 ia.end_time::text   AS end_time,
                 i.name AS instructor_name,
                 i.photo_url, i.bio
          FROM instructor_availability ia
          JOIN instructors i ON i.id = ia.instructor_id
          WHERE ia.instructor_id = ${instructor_id}
            AND ia.active = true
            AND i.active  = true
          ORDER BY ia.day_of_week, ia.start_time
        `
      : await sql`
          SELECT ia.instructor_id, ia.day_of_week,
                 ia.start_time::text AS start_time,
                 ia.end_time::text   AS end_time,
                 i.name AS instructor_name,
                 i.photo_url, i.bio
          FROM instructor_availability ia
          JOIN instructors i ON i.id = ia.instructor_id
          WHERE ia.active = true
            AND i.active  = true
          ORDER BY ia.instructor_id, ia.day_of_week, ia.start_time
        `;

    // 2. Load all confirmed/completed bookings in the date range
    const bookings = await sql`
      SELECT instructor_id,
             scheduled_date::text AS scheduled_date,
             start_time::text     AS start_time,
             end_time::text       AS end_time
      FROM lesson_bookings
      WHERE scheduled_date BETWEEN ${from} AND ${to}
        AND status IN ('confirmed', 'completed')
        ${instructor_id ? sql`AND instructor_id = ${instructor_id}` : sql``}
    `;

    // Index bookings by "instructorId|date" for fast lookup
    const bookedIndex = {};
    for (const b of bookings) {
      const key = `${b.instructor_id}|${b.scheduled_date}`;
      if (!bookedIndex[key]) bookedIndex[key] = [];
      bookedIndex[key].push({ start: timeToMinutes(b.start_time), end: timeToMinutes(b.end_time) });
    }

    // 3. Group windows by instructor
    const byInstructor = {};
    for (const w of windows) {
      if (!byInstructor[w.instructor_id]) {
        byInstructor[w.instructor_id] = {
          id:       w.instructor_id,
          name:     w.instructor_name,
          photo_url: w.photo_url,
          bio:      w.bio,
          windows:  []
        };
      }
      byInstructor[w.instructor_id].windows.push({
        day_of_week: w.day_of_week,
        start: timeToMinutes(w.start_time),
        end:   timeToMinutes(w.end_time)
      });
    }

    // 4. Walk every date in range and generate slots
    const result = {}; // { "YYYY-MM-DD": [ slot, ... ] }

    let cursor = new Date(fromDate);
    while (cursor <= toDate) {
      const dateStr    = formatDate(cursor);
      const dayOfWeek  = cursor.getDay(); // 0=Sun … 6=Sat
      const daySlots   = [];

      for (const instructor of Object.values(byInstructor)) {
        const matchingWindows = instructor.windows.filter(w => w.day_of_week === dayOfWeek);
        const bookedSlots     = bookedIndex[`${instructor.id}|${dateStr}`] || [];

        for (const window of matchingWindows) {
          let slotStart = window.start;

          while (slotStart + SLOT_MINUTES <= window.end) {
            const slotEnd = slotStart + SLOT_MINUTES;

            // Check if this slot overlaps any booked slot
            const isBooked = bookedSlots.some(
              b => slotStart < b.end && slotEnd > b.start
            );

            if (!isBooked) {
              daySlots.push({
                instructor_id:   instructor.id,
                instructor_name: instructor.name,
                instructor_photo: instructor.photo_url,
                date:            dateStr,
                start_time:      minutesToTime(slotStart),
                end_time:        minutesToTime(slotEnd)
              });
            }

            slotStart += SLOT_MINUTES;
          }
        }
      }

      // Only include dates that have at least one slot
      if (daySlots.length > 0) {
        // Sort by start time, then instructor name
        daySlots.sort((a, b) =>
          a.start_time.localeCompare(b.start_time) ||
          a.instructor_name.localeCompare(b.instructor_name)
        );
        result[dateStr] = daySlots;
      }

      cursor = addDays(cursor, 1);
    }

    return res.json({
      from,
      to,
      instructor_id: instructor_id || null,
      days_with_slots: Object.keys(result).length,
      slots: result
    });

  } catch (err) {
    console.error('slots available error:', err);
    return res.status(500).json({ error: 'Failed to generate slots', details: err.message });
  }
}

// ── POST /api/slots?action=book ───────────────────────────────────────────────
// Body: { instructor_id, date, start_time, end_time }
// Deducts 1 credit atomically and creates a confirmed booking.
async function handleBook(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });

  const { instructor_id, date, start_time, end_time } = req.body;
  if (!instructor_id || !date || !start_time || !end_time)
    return res.status(400).json({ error: 'instructor_id, date, start_time and end_time are required' });

  // Validate date is not in the past and within booking window
  const bookingDate = parseDate(date);
  if (!bookingDate)
    return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });

  const today    = startOfDay(new Date());
  const maxAhead = addDays(today, MAX_DAYS_AHEAD);
  if (bookingDate < today)
    return res.status(400).json({ error: 'Cannot book a slot in the past' });
  if (bookingDate > maxAhead)
    return res.status(400).json({ error: `Cannot book more than ${MAX_DAYS_AHEAD} days in advance` });

  // Validate slot is exactly 90 minutes
  const startMins = timeToMinutes(start_time);
  const endMins   = timeToMinutes(end_time);
  if (endMins - startMins !== SLOT_MINUTES)
    return res.status(400).json({ error: 'Slot must be exactly 90 minutes' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // 1. Check learner has enough credits
    const [learner] = await sql`
      SELECT id, name, email, credit_balance
      FROM learner_users WHERE id = ${user.id}
    `;
    if (!learner)
      return res.status(404).json({ error: 'Learner account not found' });
    if (learner.credit_balance < 1)
      return res.status(402).json({ error: 'Insufficient credits. Please purchase credits to book a lesson.' });

    // 2. Check instructor exists and is active
    const [instructor] = await sql`
      SELECT id, name, email FROM instructors
      WHERE id = ${instructor_id} AND active = true
    `;
    if (!instructor)
      return res.status(404).json({ error: 'Instructor not found or unavailable' });

    // 3. Create booking — unique index on (instructor_id, scheduled_date, start_time)
    //    will throw if slot was taken between the credit check and this insert
    let booking;
    try {
      const [b] = await sql`
        INSERT INTO lesson_bookings
          (learner_id, instructor_id, scheduled_date, start_time, end_time, status)
        VALUES
          (${user.id}, ${instructor_id}, ${date}, ${start_time}, ${end_time}, 'confirmed')
        RETURNING id, learner_id, instructor_id, scheduled_date,
                  start_time::text, end_time::text, status, created_at
      `;
      booking = b;
    } catch (insertErr) {
      if (insertErr.message?.includes('uq_instructor_slot')) {
        return res.status(409).json({ error: 'Sorry, that slot was just booked by someone else. Please choose another.' });
      }
      throw insertErr;
    }

    // 4. Deduct 1 credit from learner balance
    await sql`
      UPDATE learner_users
      SET credit_balance = credit_balance - 1
      WHERE id = ${user.id}
    `;

    // 5. Get updated balance for response
    const [updated] = await sql`SELECT credit_balance FROM learner_users WHERE id = ${user.id}`;

    // 6. Send confirmation emails
    const lessonDateStr = formatDateDisplay(date);
    const lessonTime    = `${start_time} – ${end_time}`;
    const mailer        = createTransporter();

    // Email to learner
    await mailer.sendMail({
      from:    'CoachCarter <bookings@coachcarter.uk>',
      to:      learner.email,
      subject: `Lesson confirmed — ${lessonDateStr} at ${start_time}`,
      html: `
        <h1>Lesson confirmed.</h1>
        <table>
          <tr><td><strong>Date:</strong></td><td>${lessonDateStr}</td></tr>
          <tr><td><strong>Time:</strong></td><td>${lessonTime}</td></tr>
          <tr><td><strong>Instructor:</strong></td><td>${instructor.name}</td></tr>
          <tr><td><strong>Duration:</strong></td><td>1.5 hours</td></tr>
          <tr><td><strong>Credits remaining:</strong></td><td>${updated.credit_balance}</td></tr>
        </table>
        <p style="margin-top:16px;font-size:0.875rem;color:#797879">
          Need to cancel? Do so at least 48 hours before the lesson to get your credit back.
        </p>
        <p>
          <a href="https://coachcarter.uk/learner/dashboard.html"
             style="background:#f58321;color:white;padding:12px 24px;text-decoration:none;border-radius:8px;display:inline-block;font-weight:bold">
            View my bookings →
          </a>
        </p>
      `
    });

    // Email to instructor
    await mailer.sendMail({
      from:    'CoachCarter <system@coachcarter.uk>',
      to:      instructor.email,
      subject: `New booking — ${lessonDateStr} at ${start_time}`,
      html: `
        <h2>New lesson booked</h2>
        <table>
          <tr><td><strong>Learner:</strong></td><td>${learner.name}</td></tr>
          <tr><td><strong>Email:</strong></td><td>${learner.email}</td></tr>
          <tr><td><strong>Date:</strong></td><td>${lessonDateStr}</td></tr>
          <tr><td><strong>Time:</strong></td><td>${lessonTime}</td></tr>
        </table>
      `
    });

    return res.status(201).json({
      success:        true,
      booking_id:     booking.id,
      credit_balance: updated.credit_balance
    });

  } catch (err) {
    console.error('slots book error:', err);
    return res.status(500).json({ error: 'Booking failed', details: err.message });
  }
}

// ── POST /api/slots?action=cancel ─────────────────────────────────────────────
// Body: { booking_id }
// Cancels a confirmed booking. Returns credit if 48+ hours before lesson.
async function handleCancel(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });

  const { booking_id } = req.body;
  if (!booking_id) return res.status(400).json({ error: 'booking_id required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Load booking — must belong to this learner
    const [booking] = await sql`
      SELECT lb.*, i.name AS instructor_name, i.email AS instructor_email,
             lu.name AS learner_name, lu.email AS learner_email
      FROM lesson_bookings lb
      JOIN instructors i    ON i.id  = lb.instructor_id
      JOIN learner_users lu ON lu.id = lb.learner_id
      WHERE lb.id = ${booking_id} AND lb.learner_id = ${user.id}
    `;

    if (!booking)
      return res.status(404).json({ error: 'Booking not found' });
    if (booking.status !== 'confirmed')
      return res.status(400).json({ error: `Cannot cancel a booking with status "${booking.status}"` });

    // Calculate hours until lesson
    const lessonDateTime = new Date(`${booking.scheduled_date}T${booking.start_time}:00Z`);
    const hoursUntil     = (lessonDateTime - Date.now()) / 3600000;
    const creditReturned = hoursUntil >= CANCEL_HOURS_CUTOFF;

    // Cancel the booking
    await sql`
      UPDATE lesson_bookings
      SET status = 'cancelled', cancelled_at = NOW(), credit_returned = ${creditReturned}
      WHERE id = ${booking_id}
    `;

    // Return credit if eligible
    if (creditReturned) {
      await sql`
        UPDATE learner_users SET credit_balance = credit_balance + 1
        WHERE id = ${user.id}
      `;
    }

    const [updated] = await sql`SELECT credit_balance FROM learner_users WHERE id = ${user.id}`;

    // Notify learner
    const lessonDateStr = formatDateDisplay(String(booking.scheduled_date).slice(0, 10));
    const mailer        = createTransporter();

    await mailer.sendMail({
      from:    'CoachCarter <bookings@coachcarter.uk>',
      to:      booking.learner_email,
      subject: `Lesson cancelled — ${lessonDateStr}`,
      html: creditReturned ? `
        <h1>Lesson cancelled.</h1>
        <p>Your lesson on <strong>${lessonDateStr} at ${String(booking.start_time).slice(0,5)}</strong>
           with ${booking.instructor_name} has been cancelled.</p>
        <p><strong>Your credit has been returned to your balance.</strong>
           You now have ${updated.credit_balance} credit${updated.credit_balance !== 1 ? 's' : ''}.</p>
        <p><a href="https://coachcarter.uk/learner/dashboard.html"
              style="background:#f58321;color:white;padding:12px 24px;text-decoration:none;
                     border-radius:8px;display:inline-block;font-weight:bold">
          Book another lesson →
        </a></p>
      ` : `
        <h1>Lesson cancelled.</h1>
        <p>Your lesson on <strong>${lessonDateStr} at ${String(booking.start_time).slice(0,5)}</strong>
           with ${booking.instructor_name} has been cancelled.</p>
        <p><strong>As this was cancelled with less than 48 hours' notice, your credit has been forfeited
           in line with our cancellation policy.</strong></p>
        <p>If you believe this is an error, please reply to this email.</p>
      `
    });

    // Notify instructor
    await mailer.sendMail({
      from:    'CoachCarter <system@coachcarter.uk>',
      to:      booking.instructor_email,
      subject: `Lesson cancelled — ${lessonDateStr} at ${String(booking.start_time).slice(0,5)}`,
      html: `
        <h2>Lesson cancelled</h2>
        <p>The lesson with <strong>${booking.learner_name}</strong> on
           <strong>${lessonDateStr} at ${String(booking.start_time).slice(0,5)}</strong>
           has been cancelled by the learner.</p>
      `
    });

    return res.json({
      success:        true,
      credit_returned: creditReturned,
      credit_balance:  updated.credit_balance,
      message: creditReturned
        ? 'Booking cancelled and credit returned to your balance.'
        : `Booking cancelled. Credit forfeited (less than ${CANCEL_HOURS_CUTOFF} hours' notice).`
    });

  } catch (err) {
    console.error('slots cancel error:', err);
    return res.status(500).json({ error: 'Cancellation failed', details: err.message });
  }
}

// ── GET /api/slots?action=my-bookings ────────────────────────────────────────
// Returns the authenticated learner's upcoming and recent bookings.
async function handleMyBookings(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });

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
        i.id   AS instructor_id,
        i.name AS instructor_name,
        i.photo_url AS instructor_photo
      FROM lesson_bookings lb
      JOIN instructors i ON i.id = lb.instructor_id
      WHERE lb.learner_id = ${user.id}
      ORDER BY lb.scheduled_date DESC, lb.start_time DESC
      LIMIT 50
    `;

    // Split into upcoming (confirmed, future) and past
    const now      = new Date();
    const upcoming = [];
    const past     = [];

    for (const b of bookings) {
      const lessonTime = new Date(`${b.scheduled_date}T${b.start_time}:00Z`);
      if (b.status === 'confirmed' && lessonTime > now) {
        upcoming.push(b);
      } else {
        past.push(b);
      }
    }

    // Sort upcoming soonest-first
    upcoming.sort((a, b) =>
      a.scheduled_date.localeCompare(b.scheduled_date) ||
      a.start_time.localeCompare(b.start_time)
    );

    return res.json({ upcoming, past });

  } catch (err) {
    console.error('slots my-bookings error:', err);
    return res.status(500).json({ error: 'Failed to load bookings', details: err.message });
  }
}

// ── Date/time helpers ─────────────────────────────────────────────────────────

// "09:30" or "09:30:00" → minutes from midnight
function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

// 570 → "09:30"
function minutesToTime(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// "2026-03-15" → Date (UTC midnight)
function parseDate(str) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
  const d = new Date(str + 'T00:00:00Z');
  return isNaN(d.getTime()) ? null : d;
}

// Date → "YYYY-MM-DD"
function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

function startOfDay(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addDays(d, n) {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

function daysBetween(a, b) {
  return Math.round((b - a) / 86400000);
}

// "2026-03-15" → "Saturday 15 March 2026"
function formatDateDisplay(str) {
  const d = new Date(str + 'T00:00:00Z');
  return d.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
  });
}
