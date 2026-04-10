// Calendar integration — .ics file generation & calendar feed
//
// Routes:
//   GET /api/calendar?action=download&booking_id=X   (JWT auth required)
//     → returns a downloadable .ics file for a single booking
//
//   GET /api/calendar?action=feed&token=X
//     → returns an iCal feed of all upcoming bookings for the learner
//        (token is a per-learner calendar token, not the JWT)
//
//   GET /api/calendar?action=feed-url                (JWT auth required)
//     → returns the personalised feed URL for the authenticated learner

const { neon } = require('@neondatabase/serverless');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const { reportError } = require('./_error-alert');

const SLOT_MINUTES = 90;

function setCors(res) {
}

function verifyAuth(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  try { return jwt.verify(auth.slice(7), secret); } catch { return null; }
}

module.exports = async (req, res) => {
  setCors(res);
  const action = req.query.action;
  if (action === 'download')            return handleDownload(req, res);
  if (action === 'feed')                return handleFeed(req, res);
  if (action === 'feed-url')            return handleFeedUrl(req, res);
  if (action === 'instructor-feed')     return handleInstructorFeed(req, res);
  if (action === 'instructor-feed-url') return handleInstructorFeedUrl(req, res);

  return res.status(400).json({ error: 'Unknown action' });
};

// ── GET /api/calendar?action=download&booking_id=X ─────────────────────────
// Returns a single .ics file for one booking
async function handleDownload(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });

  const { booking_id } = req.query;
  if (!booking_id) return res.status(400).json({ error: 'booking_id required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Defence-in-depth: also enforce school_id from the JWT
    const userSchoolId = user.school_id || 1;
    const [booking] = await sql`
      SELECT
        lb.id,
        lb.scheduled_date::text AS scheduled_date,
        lb.start_time::text AS start_time,
        lb.end_time::text AS end_time,
        lb.status,
        i.name AS instructor_name,
        lt.name AS lesson_type_name,
        COALESCE(lt.duration_minutes, 90) AS duration_minutes
      FROM lesson_bookings lb
      JOIN instructors i ON i.id = lb.instructor_id
      LEFT JOIN lesson_types lt ON lt.id = lb.lesson_type_id
      WHERE lb.id = ${booking_id}
        AND lb.learner_id = ${user.id}
        AND lb.school_id = ${userSchoolId}
    `;

    if (!booking)
      return res.status(404).json({ error: 'Booking not found' });

    const ics = generateICS(booking);
    const filename = `coachcarter-lesson-${booking.scheduled_date}.ics`;

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(ics);

  } catch (err) {
    console.error('calendar download error:', err);
    reportError('/api/calendar', err);
    return res.status(500).json({ error: 'Failed to generate calendar file' });
  }
}

// ── GET /api/calendar?action=feed&token=X ──────────────────────────────────
// Returns a full iCal feed of all upcoming confirmed bookings.
// Uses a per-learner calendar token (not the JWT) so Apple Calendar can poll it.
async function handleFeed(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const calToken = req.query.token;
  if (!calToken) return res.status(400).json({ error: 'token required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Look up learner by calendar token
    const [learner] = await sql`
      SELECT id, name FROM learner_users WHERE calendar_token = ${calToken}
    `;
    if (!learner)
      return res.status(404).send('Invalid calendar token');

    // Get all confirmed bookings (upcoming and recent past for context)
    const bookings = await sql`
      SELECT
        lb.id,
        lb.scheduled_date::text AS scheduled_date,
        lb.start_time::text AS start_time,
        lb.end_time::text AS end_time,
        lb.status,
        i.name AS instructor_name,
        lt.name AS lesson_type_name,
        COALESCE(lt.duration_minutes, 90) AS duration_minutes
      FROM lesson_bookings lb
      JOIN instructors i ON i.id = lb.instructor_id
      LEFT JOIN lesson_types lt ON lt.id = lb.lesson_type_id
      WHERE lb.learner_id = ${learner.id}
        AND lb.status IN ('confirmed', 'completed', 'awaiting_confirmation')
        AND lb.scheduled_date >= (CURRENT_DATE - INTERVAL '7 days')
      ORDER BY lb.scheduled_date, lb.start_time
    `;

    const icsContent = generateFeedICS(bookings, learner.name);

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return res.status(200).send(icsContent);

  } catch (err) {
    console.error('calendar feed error:', err);
    reportError('/api/calendar', err);
    return res.status(500).send('Failed to generate calendar feed');
  }
}

// ── GET /api/calendar?action=feed-url ──────────────────────────────────────
// Returns (or creates) the learner's personal calendar feed URL.
async function handleFeedUrl(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Check if learner already has a calendar token
    const [learner] = await sql`
      SELECT calendar_token FROM learner_users WHERE id = ${user.id}
    `;

    let calToken = learner?.calendar_token;

    // Generate one if they don't have one yet
    if (!calToken) {
      calToken = crypto.randomBytes(24).toString('hex');
      await sql`
        UPDATE learner_users SET calendar_token = ${calToken} WHERE id = ${user.id}
      `;
    }

    const feedUrl = `https://coachcarter.uk/api/calendar?action=feed&token=${calToken}`;

    return res.json({
      feed_url: feedUrl,
      webcal_url: feedUrl.replace('https://', 'webcal://'),
      instructions: 'Open the webcal:// link on your iPhone to subscribe. Your calendar will update automatically when bookings change.'
    });

  } catch (err) {
    console.error('calendar feed-url error:', err);
    reportError('/api/calendar', err);
    return res.status(500).json({ error: 'Failed to generate feed URL' });
  }
}

// ── Instructor auth helper ────────────────────────────────────────────────────

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

// ── GET /api/calendar?action=instructor-feed&token=X ────────────────────────
// Returns a full iCal feed of all upcoming bookings for the instructor.
async function handleInstructorFeed(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const calToken = req.query.token;
  if (!calToken) return res.status(400).json({ error: 'token required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const [instructor] = await sql`
      SELECT id, name, school_id FROM instructors WHERE calendar_token = ${calToken}
    `;
    if (!instructor)
      return res.status(404).send('Invalid calendar token');

    // Defence-in-depth: also enforce school_id from the instructor record
    const instSchoolId = instructor.school_id || 1;
    const bookings = await sql`
      SELECT
        lb.id,
        lb.scheduled_date::text AS scheduled_date,
        lb.start_time::text AS start_time,
        lb.end_time::text AS end_time,
        lb.status,
        lu.name AS learner_name,
        lt.name AS lesson_type_name,
        COALESCE(lt.duration_minutes, 90) AS duration_minutes
      FROM lesson_bookings lb
      JOIN learner_users lu ON lu.id = lb.learner_id
      LEFT JOIN lesson_types lt ON lt.id = lb.lesson_type_id
      WHERE lb.instructor_id = ${instructor.id}
        AND lb.school_id = ${instSchoolId}
        AND lb.status IN ('confirmed', 'completed', 'awaiting_confirmation')
        AND lb.scheduled_date >= (CURRENT_DATE - INTERVAL '7 days')
      ORDER BY lb.scheduled_date, lb.start_time
    `;

    const icsContent = generateInstructorFeedICS(bookings, instructor.name);

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return res.status(200).send(icsContent);

  } catch (err) {
    console.error('instructor calendar feed error:', err);
    reportError('/api/calendar', err);
    return res.status(500).send('Failed to generate calendar feed');
  }
}

// ── GET /api/calendar?action=instructor-feed-url ────────────────────────────
// Returns (or creates) the instructor's personal calendar feed URL.
async function handleInstructorFeedUrl(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = verifyInstructorAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const [instructor] = await sql`
      SELECT calendar_token FROM instructors WHERE id = ${user.id}
    `;

    let calToken = instructor?.calendar_token;

    if (!calToken) {
      calToken = crypto.randomBytes(24).toString('hex');
      await sql`
        UPDATE instructors SET calendar_token = ${calToken} WHERE id = ${user.id}
      `;
    }

    const feedUrl = `https://coachcarter.uk/api/calendar?action=instructor-feed&token=${calToken}`;

    return res.json({
      feed_url: feedUrl,
      webcal_url: feedUrl.replace('https://', 'webcal://')
    });

  } catch (err) {
    console.error('instructor calendar feed-url error:', err);
    reportError('/api/calendar', err);
    return res.status(500).json({ error: 'Failed to generate feed URL' });
  }
}

// ── ICS generation helpers ────────────────────────────────────────────────────

// Generate a single-event .ics file
function formatDuration(mins) {
  if (!mins) return '1.5 hours';
  const hrs = mins / 60;
  return hrs % 1 === 0 ? `${hrs} hour${hrs !== 1 ? 's' : ''}` : `${hrs.toFixed(1)} hours`;
}

function generateICS(booking) {
  const dtStart = toICSDate(booking.scheduled_date, booking.start_time);
  const dtEnd   = toICSDate(booking.scheduled_date, booking.end_time);
  const uid     = `booking-${booking.id}@coachcarter.uk`;
  const now     = toICSTimestamp(new Date());

  const status = booking.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED';

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CoachCarter//Lesson Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${booking.lesson_type_name || 'Driving Lesson'} — ${booking.instructor_name}`,
    `DESCRIPTION:${formatDuration(booking.duration_minutes)} ${booking.lesson_type_name || 'driving lesson'} with ${booking.instructor_name}.\\n\\nManage your bookings: https://coachcarter.uk/learner/book.html\\n\\nNeed to cancel? Do so at least 48 hours before and the hours return to your balance.`,
    `STATUS:${status}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT2H',
    'ACTION:DISPLAY',
    'DESCRIPTION:Driving lesson in 2 hours',
    'END:VALARM',
    'BEGIN:VALARM',
    'TRIGGER:-PT15M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Driving lesson in 15 minutes',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
}

// Generate a multi-event feed .ics (for calendar subscriptions)
function generateFeedICS(bookings, learnerName) {
  const now = toICSTimestamp(new Date());

  const events = bookings.map(b => {
    const dtStart = toICSDate(b.scheduled_date, b.start_time);
    const dtEnd   = toICSDate(b.scheduled_date, b.end_time);
    const uid     = `booking-${b.id}@coachcarter.uk`;
    const status  = b.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED';

    return [
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${now}`,
      `DTSTART:${dtStart}`,
      `DTEND:${dtEnd}`,
      `SUMMARY:${b.lesson_type_name || 'Driving Lesson'} — ${b.instructor_name}`,
      `DESCRIPTION:${formatDuration(b.duration_minutes)} ${b.lesson_type_name || 'driving lesson'} with ${b.instructor_name}.\\n\\nManage bookings: https://coachcarter.uk/learner/book.html`,
      `STATUS:${status}`,
      'BEGIN:VALARM',
      'TRIGGER:-PT2H',
      'ACTION:DISPLAY',
      'DESCRIPTION:Driving lesson in 2 hours',
      'END:VALARM',
      'BEGIN:VALARM',
      'TRIGGER:-PT15M',
      'ACTION:DISPLAY',
      'DESCRIPTION:Driving lesson in 15 minutes',
      'END:VALARM',
      'END:VEVENT'
    ].join('\r\n');
  });

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CoachCarter//Lesson Bookings//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:CoachCarter Lessons`,
    `X-WR-CALDESC:Driving lesson schedule for ${learnerName}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT4H',
    'X-PUBLISHED-TTL:PT4H',
    ...events,
    'END:VCALENDAR'
  ].join('\r\n');
}

// Generate a multi-event feed .ics for instructor (shows learner names)
function generateInstructorFeedICS(bookings, instructorName) {
  const now = toICSTimestamp(new Date());

  const events = bookings.map(b => {
    const dtStart = toICSDate(b.scheduled_date, b.start_time);
    const dtEnd   = toICSDate(b.scheduled_date, b.end_time);
    const uid     = `booking-${b.id}-instructor@coachcarter.uk`;
    const status  = b.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED';

    return [
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${now}`,
      `DTSTART:${dtStart}`,
      `DTEND:${dtEnd}`,
      `SUMMARY:${b.lesson_type_name || 'Lesson'} — ${b.learner_name}`,
      `DESCRIPTION:${formatDuration(b.duration_minutes)} ${b.lesson_type_name || 'lesson'} with ${b.learner_name}.\\n\\nManage schedule: https://coachcarter.uk/instructor/`,
      `STATUS:${status}`,
      'BEGIN:VALARM',
      'TRIGGER:-PT2H',
      'ACTION:DISPLAY',
      `DESCRIPTION:Lesson with ${b.learner_name} in 2 hours`,
      'END:VALARM',
      'BEGIN:VALARM',
      'TRIGGER:-PT15M',
      'ACTION:DISPLAY',
      `DESCRIPTION:Lesson with ${b.learner_name} in 15 minutes`,
      'END:VALARM',
      'END:VEVENT'
    ].join('\r\n');
  });

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CoachCarter//Instructor Schedule//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:CoachCarter Schedule`,
    `X-WR-CALDESC:Lesson schedule for ${instructorName}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT4H',
    'X-PUBLISHED-TTL:PT4H',
    ...events,
    'END:VCALENDAR'
  ].join('\r\n');
}

// "2026-03-15", "09:30" → "20260315T093000"
function toICSDate(dateStr, timeStr) {
  const d = dateStr.replace(/-/g, '');
  const t = timeStr.replace(/:/g, '').slice(0, 6);
  // Pad to 6 digits if only HHMM
  return `${d}T${t.padEnd(6, '0')}`;
}

// Date object → "20260315T093000Z"
function toICSTimestamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}
