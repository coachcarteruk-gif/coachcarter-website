// Slot generation engine + booking actions
//
// Routes:
//   GET  /api/slots?action=available&from=YYYY-MM-DD&to=YYYY-MM-DD[&instructor_id=X][&lesson_type_id=X]
//     → returns available slots for the given lesson type duration, grouped by date
//
//   POST /api/slots?action=book          (JWT auth required)
//     → deduct hours from balance and create a confirmed booking
//     → optional repeat_weeks (2-8): creates N weekly bookings sharing a series_id
//
//   POST /api/slots?action=cancel        (JWT auth required)
//     → cancel a booking; returns hours if 48+ hours notice
//     → optional cancel_series: cancels all future bookings in the series
//
//   GET  /api/slots?action=my-bookings   (JWT auth required)
//     → upcoming + recent past bookings for the authenticated learner
//
//   GET  /api/slots?action=series-info&booking_id=X (JWT auth required)
//     → returns all bookings in a series
//
// Constraints enforced:
//   - "from" may not be in the past
//   - "to" may not exceed 90 days from today (3-month advance booking window)
//   - Max 31 days per request (for performance)
//   - 48-hour cancellation policy for hours return

const { neon }    = require('@neondatabase/serverless');
const nodemailer  = require('nodemailer');
const jwt         = require('jsonwebtoken');
const crypto      = require('crypto');
const stripe      = require('stripe')(process.env.STRIPE_SECRET_KEY);
const twilio      = require('twilio');
const { reportError } = require('./_error-alert');
const { checkWaitlistOnCancel } = require('./waitlist');
const { checkAdjacentTravelTime, extractPostcode, bulkGeocodeUK, estimateDriveMinutes, TRAVEL_BUFFER_MINUTES, DEFAULT_MAX_TRAVEL_MINUTES } = require('./_travel-time');

// ── WhatsApp helper ──────────────────────────────────────────────────────────
function sendWhatsApp(to, message) {
  const sid  = process.env.TWILIO_SID;
  const auth = process.env.TWILIO_AUTH;
  const from = process.env.TWILIO_WHATSAPP_FROM;
  if (!sid || !auth || !from || !to) return Promise.resolve();

  // Normalise phone to E.164: UK numbers starting with 0 → +44
  let phone = to.replace(/\s+/g, '');
  if (phone.startsWith('0')) phone = '+44' + phone.slice(1);
  else if (!phone.startsWith('+')) phone = '+' + phone;

  const client = twilio(sid, auth);
  return client.messages.create({
    from: `whatsapp:${from}`,
    to:   `whatsapp:${phone}`,
    body: message
  }).catch(err => {
    console.warn('WhatsApp failed:', err.message);
  });
}

const DEFAULT_SLOT_MINUTES = 90;  // fallback if no lesson type specified
const MAX_DAYS_AHEAD      = 90;   // booking window
const MAX_RANGE_DAYS      = 31;   // max days per API request
const CANCEL_HOURS_CUTOFF = 48;   // hours notice needed to get hours back
const RESERVATION_MINUTES = 10;   // hold slot for 10 mins during checkout

// Look up a lesson type by ID (or return the default 'standard' type)
async function getLessonType(sql, lessonTypeId) {
  if (lessonTypeId) {
    const [lt] = await sql`SELECT * FROM lesson_types WHERE id = ${lessonTypeId} AND active = true`;
    return lt || null;
  }
  // Default to standard lesson
  const [lt] = await sql`SELECT * FROM lesson_types WHERE slug = 'standard' AND active = true`;
  return lt || { id: null, name: 'Standard Lesson', slug: 'standard', duration_minutes: 90, price_pence: 8250, colour: '#3b82f6' };
}

function formatHours(minutes) {
  const hrs = minutes / 60;
  return hrs % 1 === 0 ? `${hrs} hour${hrs !== 1 ? 's' : ''}` : `${hrs.toFixed(1)} hours`;
}

function setCors(res) {
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
  const action = req.query.action;
  if (action === 'available')    return handleAvailable(req, res);
  if (action === 'book')         return handleBook(req, res);
  if (action === 'checkout-slot') return handleCheckoutSlot(req, res);
  if (action === 'checkout-slot-guest') return handleCheckoutSlotGuest(req, res);
  if (action === 'cancel')       return handleCancel(req, res);
  if (action === 'reschedule')   return handleReschedule(req, res);
  if (action === 'my-bookings')  return handleMyBookings(req, res);
  if (action === 'series-info')  return handleSeriesInfo(req, res);

  return res.status(400).json({ error: 'Unknown action' });
};

// ── GET /api/slots?action=available ──────────────────────────────────────────
async function handleAvailable(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { from, to, instructor_id, lesson_type_id, pickup_postcode, school_id } = req.query;
  const schoolId = parseInt(school_id) || 1;

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

    // 0. Look up lesson type to get duration
    const lessonType = await getLessonType(sql, lesson_type_id);
    if (!lessonType) return res.status(404).json({ error: 'Lesson type not found or inactive' });
    const slotMinutes = lessonType.duration_minutes;

    // 1. Load availability windows (optionally filtered to one instructor)
    const windows = instructor_id
      ? await sql`
          SELECT ia.instructor_id, ia.day_of_week,
                 ia.start_time::text AS start_time,
                 ia.end_time::text   AS end_time,
                 i.name AS instructor_name,
                 i.photo_url, i.bio,
                 COALESCE(i.buffer_minutes, 30) AS buffer_minutes,
                 COALESCE(i.min_booking_notice_hours, 24) AS min_booking_notice_hours,
                 i.max_travel_minutes
          FROM instructor_availability ia
          JOIN instructors i ON i.id = ia.instructor_id
          WHERE ia.instructor_id = ${instructor_id}
            AND ia.active = true
            AND i.active  = true
            AND i.school_id = ${schoolId}
          ORDER BY ia.day_of_week, ia.start_time
        `
      : await sql`
          SELECT ia.instructor_id, ia.day_of_week,
                 ia.start_time::text AS start_time,
                 ia.end_time::text   AS end_time,
                 i.name AS instructor_name,
                 i.photo_url, i.bio,
                 COALESCE(i.buffer_minutes, 30) AS buffer_minutes,
                 COALESCE(i.min_booking_notice_hours, 24) AS min_booking_notice_hours,
                 i.max_travel_minutes
          FROM instructor_availability ia
          JOIN instructors i ON i.id = ia.instructor_id
          WHERE ia.active = true
            AND i.active  = true
            AND i.email  != 'demo@coachcarter.uk'
            AND i.school_id = ${schoolId}
          ORDER BY ia.instructor_id, ia.day_of_week, ia.start_time
        `;

    // 2. Load all confirmed/completed bookings in the date range
    const bookings = instructor_id
      ? await sql`
          SELECT instructor_id,
                 scheduled_date::text AS scheduled_date,
                 start_time::text     AS start_time,
                 end_time::text       AS end_time,
                 pickup_address
          FROM lesson_bookings
          WHERE scheduled_date BETWEEN ${from} AND ${to}
            AND status IN ('confirmed', 'completed', 'awaiting_confirmation')
            AND instructor_id = ${instructor_id}
        `
      : await sql`
          SELECT instructor_id,
                 scheduled_date::text AS scheduled_date,
                 start_time::text     AS start_time,
                 end_time::text       AS end_time,
                 pickup_address
          FROM lesson_bookings
          WHERE scheduled_date BETWEEN ${from} AND ${to}
            AND status IN ('confirmed', 'completed', 'awaiting_confirmation')
        `;

    // 2b. Also load active slot reservations (held during Stripe checkout)
    let reservations = [];
    try {
      reservations = instructor_id
        ? await sql`
            SELECT instructor_id,
                   scheduled_date::text AS scheduled_date,
                   start_time::text     AS start_time,
                   end_time::text       AS end_time
            FROM slot_reservations
            WHERE scheduled_date BETWEEN ${from} AND ${to}
              AND expires_at > NOW()
              AND instructor_id = ${instructor_id}
          `
        : await sql`
            SELECT instructor_id,
                   scheduled_date::text AS scheduled_date,
                   start_time::text     AS start_time,
                   end_time::text       AS end_time
            FROM slot_reservations
            WHERE scheduled_date BETWEEN ${from} AND ${to}
              AND expires_at > NOW()
          `;
    } catch (e) {
      // Table may not exist yet — that's fine, no reservations
    }

    // 2b-ii. Also load pending lesson offers (instructor-initiated, awaiting acceptance)
    let pendingOffers = [];
    try {
      pendingOffers = instructor_id
        ? await sql`
            SELECT instructor_id,
                   scheduled_date::text AS scheduled_date,
                   start_time::text     AS start_time,
                   end_time::text       AS end_time
            FROM lesson_offers
            WHERE scheduled_date BETWEEN ${from} AND ${to}
              AND status = 'pending'
              AND expires_at > NOW()
              AND instructor_id = ${instructor_id}
          `
        : await sql`
            SELECT instructor_id,
                   scheduled_date::text AS scheduled_date,
                   start_time::text     AS start_time,
                   end_time::text       AS end_time
            FROM lesson_offers
            WHERE scheduled_date BETWEEN ${from} AND ${to}
              AND status = 'pending'
              AND expires_at > NOW()
          `;
    } catch (e) {
      // Table may not exist yet
    }

    // Merge pending offers into reservations so they block slots
    reservations = reservations.concat(pendingOffers);

    // 2c. Load blackout date ranges overlapping the requested window
    let blackouts = [];
    try {
      blackouts = instructor_id
        ? await sql`
            SELECT instructor_id, blackout_date::text AS start_date, end_date::text
            FROM instructor_blackout_dates
            WHERE blackout_date <= ${to} AND end_date >= ${from}
              AND instructor_id = ${instructor_id}
          `
        : await sql`
            SELECT instructor_id, blackout_date::text AS start_date, end_date::text
            FROM instructor_blackout_dates
            WHERE blackout_date <= ${to} AND end_date >= ${from}
          `;
    } catch (e) {
      console.warn('Blackout query failed (end_date column may be missing — run migration):', e.message);
      // Fallback: try single-date query without end_date
      try {
        blackouts = instructor_id
          ? await sql`
              SELECT instructor_id, blackout_date::text AS start_date, blackout_date::text AS end_date
              FROM instructor_blackout_dates
              WHERE blackout_date BETWEEN ${from} AND ${to}
                AND instructor_id = ${instructor_id}
            `
          : await sql`
              SELECT instructor_id, blackout_date::text AS start_date, blackout_date::text AS end_date
              FROM instructor_blackout_dates
              WHERE blackout_date BETWEEN ${from} AND ${to}
            `;
      } catch (e2) {
        // Table genuinely doesn't exist
      }
    }

    // 2d. Load external calendar events (iCal sync) in the date range
    let externalEvents = [];
    try {
      externalEvents = instructor_id
        ? await sql`
            SELECT instructor_id, event_date::text AS event_date,
                   start_time::text AS start_time, end_time::text AS end_time, is_all_day
            FROM instructor_external_events
            WHERE event_date BETWEEN ${from} AND ${to}
              AND instructor_id = ${instructor_id}
          `
        : await sql`
            SELECT instructor_id, event_date::text AS event_date,
                   start_time::text AS start_time, end_time::text AS end_time, is_all_day
            FROM instructor_external_events
            WHERE event_date BETWEEN ${from} AND ${to}
          `;
    } catch (e) {
      // Table may not exist yet
    }

    // Expand blackout ranges into individual "instructorId|date" entries for fast lookup
    const blackoutIndex = new Set();
    for (const b of blackouts) {
      const start = new Date(b.start_date + 'T00:00:00');
      const end = new Date(b.end_date + 'T00:00:00');
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const ds = d.toISOString().slice(0, 10);
        blackoutIndex.add(`${b.instructor_id}|${ds}`);
      }
    }

    // Index bookings + reservations by "instructorId|date" for fast lookup
    const bookedIndex = {};
    for (const b of [...bookings, ...reservations]) {
      const key = `${b.instructor_id}|${b.scheduled_date}`;
      if (!bookedIndex[key]) bookedIndex[key] = [];
      bookedIndex[key].push({
        start: timeToMinutes(b.start_time),
        end: timeToMinutes(b.end_time),
        postcode: b.pickup_address ? extractPostcode(b.pickup_address) : null
      });
    }

    // Index external calendar events — all-day as blackouts, timed as booked slots
    for (const e of externalEvents) {
      if (e.is_all_day) {
        blackoutIndex.add(`${e.instructor_id}|${e.event_date}`);
      } else {
        const key = `${e.instructor_id}|${e.event_date}`;
        if (!bookedIndex[key]) bookedIndex[key] = [];
        bookedIndex[key].push({ start: timeToMinutes(e.start_time), end: timeToMinutes(e.end_time) });
      }
    }

    // 3. Group windows by instructor
    const byInstructor = {};
    for (const w of windows) {
      if (!byInstructor[w.instructor_id]) {
        byInstructor[w.instructor_id] = {
          id:             w.instructor_id,
          name:           w.instructor_name,
          photo_url:      w.photo_url,
          bio:            w.bio,
          buffer_minutes: parseInt(w.buffer_minutes) || 30,
          min_booking_notice_hours: parseInt(w.min_booking_notice_hours) || 24,
          max_travel_minutes: w.max_travel_minutes != null ? parseInt(w.max_travel_minutes) : DEFAULT_MAX_TRAVEL_MINUTES,
          windows:        []
        };
      }
      byInstructor[w.instructor_id].windows.push({
        day_of_week: w.day_of_week,
        start: timeToMinutes(w.start_time),
        end:   timeToMinutes(w.end_time)
      });
    }

    // 3b. Travel time filtering — geocode all postcodes if learner provided theirs
    const learnerPostcode = pickup_postcode ? pickup_postcode.toUpperCase().replace(/\s+/g, ' ') : null;
    let coordMap = {}; // postcode → { lat, lon }
    if (learnerPostcode) {
      try {
        // Collect all unique postcodes from bookings + learner's postcode
        const allPostcodes = new Set([learnerPostcode]);
        for (const slots of Object.values(bookedIndex)) {
          for (const s of slots) {
            if (s.postcode) allPostcodes.add(s.postcode);
          }
        }
        coordMap = await bulkGeocodeUK([...allPostcodes]);
      } catch { /* graceful — skip travel filtering if geocoding fails */ }
    }

    // 4. Walk every date in range and generate slots
    const result = {}; // { "YYYY-MM-DD": [ slot, ... ] }
    let travelHiddenCount = 0; // slots removed by travel time filter

    // For same-day booking: calculate current time in minutes to filter past slots
    const now          = new Date();
    const todayStr     = formatDate(today);
    const nowMinutes   = now.getUTCHours() * 60 + now.getUTCMinutes();

    let cursor = new Date(fromDate);
    while (cursor <= toDate) {
      const dateStr    = formatDate(cursor);
      const dayOfWeek  = cursor.getDay(); // 0=Sun … 6=Sat
      const isToday    = dateStr === todayStr;
      const daySlots   = [];

      for (const instructor of Object.values(byInstructor)) {
        // Skip this instructor on this date if it's a blackout day
        if (blackoutIndex.has(`${instructor.id}|${dateStr}`)) continue;

        const matchingWindows = instructor.windows.filter(w => w.day_of_week === dayOfWeek);
        const bookedSlots     = bookedIndex[`${instructor.id}|${dateStr}`] || [];
        const buffer          = instructor.buffer_minutes || 0;

        for (const window of matchingWindows) {
          let slotStart = window.start;

          while (slotStart + slotMinutes <= window.end) {
            const slotEnd = slotStart + slotMinutes;

            // Skip slots that have already started today
            if (isToday && slotStart <= nowMinutes) {
              slotStart += slotMinutes;
              continue;
            }

            // Skip slots within the instructor's minimum booking notice period
            if (instructor.min_booking_notice_hours > 0) {
              const slotDateTime = new Date(cursor);
              slotDateTime.setUTCHours(Math.floor(slotStart / 60), slotStart % 60, 0, 0);
              const hoursUntilSlot = (slotDateTime - now) / 3600000;
              if (hoursUntilSlot < instructor.min_booking_notice_hours) {
                slotStart += slotMinutes;
                continue;
              }
            }

            // Check if this slot overlaps any booked slot (including buffer after each booking)
            const isBooked = bookedSlots.some(
              b => slotStart < (b.end + buffer) && slotEnd > b.start
            );

            if (isBooked) {
              slotStart += slotMinutes;
              continue;
            }

            // Travel time filter — hide slots where instructor can't travel in time
            if (learnerPostcode && coordMap[learnerPostcode]) {
              const learnerCoord = coordMap[learnerPostcode];
              let travelBlocked = false;

              // Find closest booking BEFORE this slot (with a pickup postcode)
              let closestBefore = null;
              let closestAfter = null;
              for (const b of bookedSlots) {
                if (b.end <= slotStart && b.postcode && coordMap[b.postcode]) {
                  if (!closestBefore || b.end > closestBefore.end) closestBefore = b;
                }
                if (b.start >= slotEnd && b.postcode && coordMap[b.postcode]) {
                  if (!closestAfter || b.start < closestAfter.start) closestAfter = b;
                }
              }

              // Check gap before: can instructor get from previous booking's pickup to learner's pickup?
              if (closestBefore) {
                const prevCoord = coordMap[closestBefore.postcode];
                const driveMinutes = estimateDriveMinutes(prevCoord.lat, prevCoord.lon, learnerCoord.lat, learnerCoord.lon);
                const gapMinutes = slotStart - closestBefore.end;
                if (gapMinutes < driveMinutes + TRAVEL_BUFFER_MINUTES) travelBlocked = true;
              }

              // Check gap after: can instructor get from learner's pickup to next booking's pickup?
              if (!travelBlocked && closestAfter) {
                const nextCoord = coordMap[closestAfter.postcode];
                const driveMinutes = estimateDriveMinutes(learnerCoord.lat, learnerCoord.lon, nextCoord.lat, nextCoord.lon);
                const gapMinutes = closestAfter.start - slotEnd;
                if (gapMinutes < driveMinutes + TRAVEL_BUFFER_MINUTES) travelBlocked = true;
              }

              if (travelBlocked) {
                travelHiddenCount++;
                slotStart += slotMinutes;
                continue;
              }
            }

            daySlots.push({
              instructor_id:   instructor.id,
              instructor_name: instructor.name,
              instructor_photo: instructor.photo_url,
              date:            dateStr,
              start_time:      minutesToTime(slotStart),
              end_time:        minutesToTime(slotEnd)
            });

            slotStart += slotMinutes;
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

    const response = {
      from,
      to,
      instructor_id: instructor_id || null,
      lesson_type: { id: lessonType.id, name: lessonType.name, duration_minutes: slotMinutes, price_pence: lessonType.price_pence, colour: lessonType.colour },
      days_with_slots: Object.keys(result).length,
      slots: result
    };
    if (travelHiddenCount > 0) response.travel_hidden = travelHiddenCount;
    return res.json(response);

  } catch (err) {
    console.error('slots available error:', err);
    reportError('/api/slots', err);
    return res.status(500).json({ error: 'Failed to generate slots', details: err.message });
  }
}

// ── POST /api/slots?action=book ───────────────────────────────────────────────
// Body: { instructor_id, date, start_time, end_time, lesson_type_id?, pickup_address?, dropoff_address? }
// Deducts hours from balance atomically and creates a confirmed booking.
async function handleBook(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = user.school_id || 1;

  const { instructor_id, date, start_time, end_time, lesson_type_id, pickup_address, dropoff_address, repeat_weeks } = req.body;
  if (!instructor_id || !date || !start_time || !end_time)
    return res.status(400).json({ error: 'instructor_id, date, start_time and end_time are required' });

  // Validate repeat_weeks if provided
  const weeks = repeat_weeks ? parseInt(repeat_weeks, 10) : 1;
  if (weeks < 1 || weeks > 8 || isNaN(weeks))
    return res.status(400).json({ error: 'repeat_weeks must be between 1 and 8' });
  const isRecurring = weeks > 1;

  // Validate date is not in the past and within booking window
  const bookingDate = parseDate(date);
  if (!bookingDate)
    return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });

  const today    = startOfDay(new Date());
  const maxAhead = addDays(today, MAX_DAYS_AHEAD);
  if (bookingDate < today)
    return res.status(400).json({ error: 'Cannot book a slot in the past' });

  // Build list of dates for all weeks
  const bookingDates = [];
  for (let w = 0; w < weeks; w++) {
    const d = addDays(bookingDate, w * 7);
    bookingDates.push({ date: formatDate(d), dateObj: d });
  }

  // Validate all dates are within the booking window
  const lastDate = bookingDates[bookingDates.length - 1];
  if (lastDate.dateObj > maxAhead)
    return res.status(400).json({ error: `Cannot book more than ${MAX_DAYS_AHEAD} days in advance. The last date in this series (${lastDate.date}) exceeds the limit.` });

  // Reject same-day bookings where the slot has already started
  const startMins = timeToMinutes(start_time);
  const endMins   = timeToMinutes(end_time);
  if (bookingDate.getTime() === today.getTime()) {
    const now = new Date();
    const nowMins = now.getUTCHours() * 60 + now.getUTCMinutes();
    if (startMins <= nowMins)
      return res.status(400).json({ error: 'This slot has already started. Please choose a later time.' });
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // 0. Look up lesson type
    const lessonType = await getLessonType(sql, lesson_type_id);
    if (!lessonType) return res.status(404).json({ error: 'Lesson type not found or inactive' });
    const durationMins = lessonType.duration_minutes;

    // Validate slot duration matches lesson type
    if (endMins - startMins !== durationMins)
      return res.status(400).json({ error: `Slot must be exactly ${formatHours(durationMins)} for ${lessonType.name}` });

    // 1. Check learner has enough hours
    const [learner] = await sql`
      SELECT id, name, email, phone, credit_balance, balance_minutes, pickup_address
      FROM learner_users WHERE id = ${user.id}
    `;
    if (!learner)
      return res.status(404).json({ error: 'Learner account not found' });

    // 2. Check instructor exists and is active
    const [instructor] = await sql`
      SELECT id, name, email, phone, max_travel_minutes FROM instructors
      WHERE id = ${instructor_id} AND active = true
    `;
    if (!instructor)
      return res.status(404).json({ error: 'Instructor not found or unavailable' });

    // Demo instructor bookings are free (no deduction)
    const isDemoInstructor = instructor.email === 'demo@coachcarter.uk';

    // 2b. Travel time check between pickup postcodes (warning only, not blocking)
    let travelWarnings = null;
    const bookingPickupAddr = pickup_address || learner.pickup_address || null;
    const skipTravel = req.query.skip_travel_check === 'true';
    if (bookingPickupAddr && !skipTravel && !isDemoInstructor) {
      try {
        const result = await checkAdjacentTravelTime(
          sql, instructor_id, date, start_time, end_time,
          bookingPickupAddr, instructor.max_travel_minutes || undefined
        );
        if (result) travelWarnings = result.warnings;
      } catch { /* never block bookings due to travel check errors */ }
    }

    const totalMins = durationMins * weeks;
    if (!isDemoInstructor) {
      const balance = learner.balance_minutes || 0;
      if (balance < totalMins)
        return res.status(402).json({
          error: `Not enough hours. You need ${formatHours(totalMins)} for ${weeks} lessons but have ${formatHours(balance)}. Please buy more hours.`
        });
    }

    // 3. For recurring bookings, check all slots are available before booking any
    if (isRecurring) {
      const dateStrings = bookingDates.map(d => d.date);
      const conflicts = await sql`
        SELECT scheduled_date::text AS date, start_time::text
        FROM lesson_bookings
        WHERE instructor_id = ${instructor_id}
          AND scheduled_date = ANY(${dateStrings})
          AND start_time = ${start_time}
          AND status = 'confirmed'
      `;
      // Also check slot reservations (Stripe checkout holds)
      const reservations = await sql`
        SELECT scheduled_date::text AS date, start_time::text
        FROM slot_reservations
        WHERE instructor_id = ${instructor_id}
          AND scheduled_date = ANY(${dateStrings})
          AND start_time = ${start_time}
          AND expires_at > NOW()
      `;
      // Also check pending lesson offers
      let offerConflicts = [];
      try {
        offerConflicts = await sql`
          SELECT scheduled_date::text AS date, start_time::text
          FROM lesson_offers
          WHERE instructor_id = ${instructor_id}
            AND scheduled_date = ANY(${dateStrings})
            AND start_time = ${start_time}
            AND status = 'pending'
            AND expires_at > NOW()
        `;
      } catch (e) { /* table may not exist yet */ }
      const takenDates = new Set([
        ...conflicts.map(c => c.date),
        ...reservations.map(r => r.date),
        ...offerConflicts.map(o => o.date)
      ]);
      if (takenDates.size > 0) {
        return res.status(409).json({
          error: true,
          code: 'SLOTS_UNAVAILABLE',
          message: `${takenDates.size} of ${weeks} slots are not available`,
          conflicts: [...takenDates].map(d => ({ date: d, start_time, reason: 'already booked' })),
          available: dateStrings.filter(d => !takenDates.has(d)).map(d => ({ date: d, start_time }))
        });
      }
    }

    // 4. Deduct hours FIRST (skip for demo instructor)
    if (!isDemoInstructor) {
      const creditsToDeduct = Math.ceil(totalMins / 60);
      const [deducted] = await sql`
        UPDATE learner_users
        SET balance_minutes = balance_minutes - ${totalMins},
            credit_balance = GREATEST(credit_balance - ${creditsToDeduct}, 0)
        WHERE id = ${user.id} AND balance_minutes >= ${totalMins}
        RETURNING balance_minutes
      `;
      if (!deducted)
        return res.status(402).json({ error: `Not enough hours. You need ${formatHours(totalMins)}. Please buy more hours.` });
    }

    // 5. Create booking(s) — unique index on (instructor_id, scheduled_date, start_time)
    const seriesId = isRecurring ? crypto.randomUUID() : null;
    const bookingPickup  = pickup_address || learner.pickup_address || null;
    const bookingDropoff = dropoff_address || null;
    const minsPerBooking = isDemoInstructor ? 0 : durationMins;
    const createdBookings = [];

    try {
      for (const bd of bookingDates) {
        const [b] = await sql`
          INSERT INTO lesson_bookings
            (learner_id, instructor_id, scheduled_date, start_time, end_time, status,
             pickup_address, dropoff_address, lesson_type_id, minutes_deducted, series_id, school_id)
          VALUES
            (${user.id}, ${instructor_id}, ${bd.date}, ${start_time}, ${end_time}, 'confirmed',
             ${bookingPickup}, ${bookingDropoff}, ${lessonType.id}, ${minsPerBooking}, ${seriesId}, ${schoolId})
          RETURNING id, scheduled_date::text, start_time::text, end_time::text, status, created_at
        `;
        createdBookings.push(b);
      }
    } catch (insertErr) {
      // Refund the hours since booking failed (not needed for demo)
      if (!isDemoInstructor) {
        const creditsToRefund = Math.ceil(totalMins / 60);
        await sql`
          UPDATE learner_users
          SET balance_minutes = balance_minutes + ${totalMins},
              credit_balance = credit_balance + ${creditsToRefund}
          WHERE id = ${user.id}
        `;
      }
      // If some bookings in a series were created before the failure, cancel them
      if (createdBookings.length > 0) {
        const createdIds = createdBookings.map(b => b.id);
        await sql`
          UPDATE lesson_bookings SET status = 'cancelled', cancelled_at = NOW()
          WHERE id = ANY(${createdIds})
        `;
      }
      if (insertErr.message?.includes('uq_booking_slot') || insertErr.message?.includes('uq_instructor_slot')) {
        return res.status(409).json({ error: 'Sorry, one of the slots was just booked by someone else. Please try again.' });
      }
      throw insertErr;
    }

    // GDPR: update last activity timestamp
    try { await sql`UPDATE learner_users SET last_activity_at = NOW() WHERE id = ${user.id}`; } catch (e) {}

    // 6. Get updated balance for response
    const [updated] = await sql`SELECT balance_minutes, credit_balance FROM learner_users WHERE id = ${user.id}`;
    const durationStr = formatHours(durationMins);
    const balanceStr  = formatHours(updated.balance_minutes || 0);

    // 7. Send notifications
    const mailer = createTransporter();

    if (isRecurring) {
      // Send summary email + ICS for each booking in the series
      const dateList = bookingDates.map(bd => {
        const display = formatDateDisplay(bd.date);
        return `<li>${display} at ${start_time} – ${end_time}</li>`;
      }).join('');

      await mailer.sendMail({
        from:    'CoachCarter <bookings@coachcarter.uk>',
        to:      learner.email,
        subject: `${weeks} weekly lessons confirmed — starting ${formatDateDisplay(date)}`,
        html: `
          <h1>${weeks} weekly lessons confirmed.</h1>
          <table>
            <tr><td><strong>Instructor:</strong></td><td>${instructor.name}</td></tr>
            <tr><td><strong>Type:</strong></td><td>${lessonType.name} (${durationStr})</td></tr>
            <tr><td><strong>Total hours:</strong></td><td>${formatHours(totalMins)}</td></tr>
            <tr><td><strong>Hours remaining:</strong></td><td>${balanceStr}</td></tr>
          </table>
          <h3>Dates:</h3>
          <ol>${dateList}</ol>
          <p style="margin-top:16px;font-size:0.875rem;color:#797879">
            Need to cancel? You can cancel individual lessons or the whole series.
            Cancel at least 48 hours before and the hours return to your balance.
          </p>
          <p>
            <a href="https://coachcarter.uk/learner/"
               style="background:#f58321;color:white;padding:12px 24px;text-decoration:none;border-radius:8px;display:inline-block;font-weight:bold">
              View my bookings →
            </a>
          </p>
        `,
        attachments: bookingDates.map((bd, i) => ({
          filename: `coachcarter-lesson-${bd.date}.ics`,
          content: generateICS({
            id: createdBookings[i].id,
            scheduled_date: bd.date,
            start_time,
            end_time,
            instructor_name: instructor.name,
            lesson_type_name: lessonType.name,
            duration_str: durationStr
          }),
          contentType: 'text/calendar; method=PUBLISH'
        }))
      });

      if (!isDemoInstructor) {
        await mailer.sendMail({
          from:    'CoachCarter <system@coachcarter.uk>',
          to:      instructor.email,
          subject: `${weeks} weekly bookings — ${learner.name} starting ${formatDateDisplay(date)}`,
          html: `
            <h2>${weeks} weekly lessons booked</h2>
            <table>
              <tr><td><strong>Learner:</strong></td><td>${learner.name}</td></tr>
              <tr><td><strong>Email:</strong></td><td>${learner.email}</td></tr>
              <tr><td><strong>Type:</strong></td><td>${lessonType.name} (${durationStr})</td></tr>
            </table>
            <h3>Dates:</h3>
            <ol>${dateList}</ol>
            <p style="margin-top:16px">
              <a href="https://coachcarter.uk/instructor/"
                 style="background:#f58321;color:white;padding:10px 20px;text-decoration:none;
                        border-radius:8px;display:inline-block;font-weight:bold;font-size:0.9rem">
                View my schedule →
              </a>
            </p>
          `
        });
      }

      // WhatsApp — single summary message
      const dateListText = bookingDates.map(bd => `  📅 ${formatDateDisplay(bd.date)}`).join('\n');
      await sendWhatsApp(learner.phone,
        `✅ ${weeks} weekly lessons confirmed!\n\n🚗 Instructor: ${instructor.name}\n📋 ${lessonType.name} (${durationStr} each)\n⏰ ${start_time} – ${end_time}\n\n${dateListText}\n\nTotal: ${formatHours(totalMins)} | Remaining: ${balanceStr}\n\nView bookings: https://coachcarter.uk/learner/`
      );
      if (!isDemoInstructor) {
        await sendWhatsApp(instructor.phone,
          `📋 ${weeks} weekly bookings!\n\n👤 ${learner.name}\n📋 ${lessonType.name} (${durationStr})\n⏰ ${start_time} – ${end_time}\n\n${dateListText}\n\nView schedule: https://coachcarter.uk/instructor/`
        );
      }
    } else {
      // Single booking — existing notification flow
      const lessonDateStr = formatDateDisplay(date);
      const lessonTime    = `${start_time} – ${end_time}`;

      const icsContent = generateICS({
        id: createdBookings[0].id,
        scheduled_date: date,
        start_time,
        end_time,
        instructor_name: instructor.name,
        lesson_type_name: lessonType.name,
        duration_str: durationStr
      });

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
            <tr><td><strong>Type:</strong></td><td>${lessonType.name}</td></tr>
            <tr><td><strong>Duration:</strong></td><td>${durationStr}</td></tr>
            <tr><td><strong>Hours remaining:</strong></td><td>${balanceStr}</td></tr>
          </table>
          <p style="margin-top:16px;font-size:0.875rem;color:#797879">
            Need to cancel? Do so at least 48 hours before and the hours return to your balance.
          </p>
          <p>
            <a href="https://coachcarter.uk/learner/"
               style="background:#f58321;color:white;padding:12px 24px;text-decoration:none;border-radius:8px;display:inline-block;font-weight:bold">
              View my bookings →
            </a>
          </p>
        `,
        attachments: [{
          filename: `coachcarter-lesson-${date}.ics`,
          content:  icsContent,
          contentType: 'text/calendar; method=PUBLISH'
        }]
      });

      if (!isDemoInstructor) {
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
              <tr><td><strong>Type:</strong></td><td>${lessonType.name} (${durationStr})</td></tr>
            </table>
            <p style="margin-top:16px">
              <a href="https://coachcarter.uk/instructor/"
                 style="background:#f58321;color:white;padding:10px 20px;text-decoration:none;
                        border-radius:8px;display:inline-block;font-weight:bold;font-size:0.9rem">
                View my schedule →
              </a>
            </p>
          `
        });
      }

      await sendWhatsApp(learner.phone,
        `✅ Lesson confirmed!\n\n📅 ${lessonDateStr}\n⏰ ${lessonTime}\n🚗 Instructor: ${instructor.name}\n📋 ${lessonType.name} (${durationStr})\n\nNeed to cancel? Do so at least 48 hours before and the hours return to your balance.\n\nView bookings: https://coachcarter.uk/learner/`
      );
      if (!isDemoInstructor) {
        await sendWhatsApp(instructor.phone,
          `📋 New booking!\n\n👤 ${learner.name}\n📅 ${lessonDateStr}\n⏰ ${lessonTime}\n📋 ${lessonType.name} (${durationStr})\n\nView schedule: https://coachcarter.uk/instructor/`
        );
      }
    }

    // 8. Response
    const response = {
      success:         true,
      booking_id:      createdBookings[0].id,
      balance_minutes: updated.balance_minutes || 0,
      balance_hours:   ((updated.balance_minutes || 0) / 60).toFixed(1),
      credit_balance:  updated.credit_balance
    };
    if (isRecurring) {
      response.series_id   = seriesId;
      response.booking_ids = createdBookings.map(b => b.id);
      response.dates       = bookingDates.map(bd => bd.date);
      response.weeks       = weeks;
    }
    if (travelWarnings && travelWarnings.length > 0) {
      response.travel_warnings = travelWarnings;
    }

    return res.status(201).json(response);

  } catch (err) {
    console.error('slots book error:', err);
    reportError('/api/slots', err);
    return res.status(500).json({ error: 'Booking failed', details: err.message });
  }
}

// ── POST /api/slots?action=checkout-slot ──────────────────────────────────────
// Body: { instructor_id, date, start_time, end_time, lesson_type_id? }
// Creates a Stripe Checkout session for a single lesson at the lesson type's price.
// Reserves the slot for 10 minutes while the learner pays.
// The webhook will book the slot and add+deduct hours on payment completion.
async function handleCheckoutSlot(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = user.school_id || 1;

  const { instructor_id, date, start_time, end_time, lesson_type_id } = req.body;
  if (!instructor_id || !date || !start_time || !end_time)
    return res.status(400).json({ error: 'instructor_id, date, start_time, end_time required' });

  // Reject same-day bookings where the slot has already started
  const startMins    = timeToMinutes(start_time);
  const endMins      = timeToMinutes(end_time);
  const checkoutDate = parseDate(date);
  const todayStart   = startOfDay(new Date());
  if (checkoutDate && checkoutDate.getTime() === todayStart.getTime()) {
    const now = new Date();
    const nowMins = now.getUTCHours() * 60 + now.getUTCMinutes();
    if (startMins <= nowMins)
      return res.status(400).json({ error: 'This slot has already started. Please choose a later time.' });
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // 0. Look up lesson type for pricing
    const lessonType = await getLessonType(sql, lesson_type_id);
    if (!lessonType) return res.status(404).json({ error: 'Lesson type not found or inactive' });
    const durationMins = lessonType.duration_minutes;
    const pricePence   = lessonType.price_pence;
    const durationStr  = formatHours(durationMins);

    // Validate slot duration matches lesson type
    if (endMins - startMins !== durationMins)
      return res.status(400).json({ error: `Slot must be exactly ${durationStr} for ${lessonType.name}` });

    // Clean up any expired reservations
    await sql`DELETE FROM slot_reservations WHERE expires_at < NOW()`;

    // Check slot isn't already booked
    const [existingBooking] = await sql`
      SELECT id FROM lesson_bookings
      WHERE instructor_id = ${instructor_id}
        AND scheduled_date = ${date}
        AND start_time = ${start_time}::time
        AND status = 'confirmed'
    `;
    if (existingBooking)
      return res.status(409).json({ error: 'Sorry, that slot is already booked.' });

    // Check slot isn't already reserved by someone else
    const [existingReservation] = await sql`
      SELECT id FROM slot_reservations
      WHERE instructor_id = ${instructor_id}
        AND scheduled_date = ${date}
        AND start_time = ${start_time}::time
        AND expires_at > NOW()
        AND learner_id != ${user.id}
    `;
    if (existingReservation)
      return res.status(409).json({ error: 'Someone else is currently booking this slot. Try another or wait a few minutes.' });

    // Check slot isn't held by a pending lesson offer
    try {
      const [existingOffer] = await sql`
        SELECT id FROM lesson_offers
        WHERE instructor_id = ${instructor_id}
          AND scheduled_date = ${date}
          AND start_time = ${start_time}::time
          AND status = 'pending'
          AND expires_at > NOW()
      `;
      if (existingOffer)
        return res.status(409).json({ error: 'This slot is currently held for a pending lesson offer.' });
    } catch (e) { /* table may not exist yet */ }

    // Check instructor is valid
    const [instructor] = await sql`
      SELECT id, name FROM instructors WHERE id = ${instructor_id} AND active = true
    `;
    if (!instructor)
      return res.status(404).json({ error: 'Instructor not found' });

    // Get learner email
    const [learner] = await sql`SELECT email FROM learner_users WHERE id = ${user.id}`;
    if (!learner)
      return res.status(404).json({ error: 'Learner not found' });

    // Create Stripe Checkout session
    const origin = req.headers.origin || 'https://coachcarter.uk';
    const lessonDate = new Date(date + 'T00:00:00Z')
      .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card', 'klarna'],
      line_items: [{
        price_data: {
          currency: 'gbp',
          unit_amount: pricePence,
          product_data: {
            name: `${lessonType.name} — ${lessonDate} ${start_time}–${end_time}`,
            description: `${durationStr} lesson with ${instructor.name}. Slot held for ${RESERVATION_MINUTES} minutes.`
          }
        },
        quantity: 1
      }],
      metadata: {
        payment_type:    'slot_booking',
        learner_id:      String(user.id),
        learner_email:   learner.email,
        instructor_id:   String(instructor_id),
        instructor_name: instructor.name,
        scheduled_date:  date,
        start_time,
        end_time,
        lesson_type_id:  String(lessonType.id),
        duration_minutes: String(durationMins),
        amount_pence:    String(pricePence)
      },
      customer_email: learner.email,
      billing_address_collection: 'required',
      allow_promotion_codes: true,
      success_url: `${origin}/learner/book.html?paid=1`,
      cancel_url:  `${origin}/learner/book.html?cancelled=1`
    });

    // Reserve the slot (upsert in case learner retries)
    await sql`
      INSERT INTO slot_reservations
        (learner_id, instructor_id, scheduled_date, start_time, end_time, stripe_session_id, expires_at, school_id)
      VALUES
        (${user.id}, ${instructor_id}, ${date}, ${start_time}, ${end_time}, ${session.id},
         NOW() + INTERVAL '10 minutes', ${schoolId})
      ON CONFLICT DO NOTHING
    `;

    return res.json({ url: session.url });
  } catch (err) {
    console.error('checkout-slot error:', err);
    reportError('/api/slots', err);
    return res.status(500).json({ error: 'Failed to create checkout', details: err.message });
  }
}

// ── POST /api/slots?action=checkout-slot-guest ────────────────────────────────
// Guest checkout: no auth required. Creates learner account, reserves slot, returns Stripe URL.
// Body: { instructor_id, date, start_time, end_time, lesson_type_id?, guest_name, guest_email, guest_phone, guest_pickup_address }
async function handleCheckoutSlotGuest(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { instructor_id, date, start_time, end_time, lesson_type_id,
          guest_name, guest_email, guest_phone, guest_pickup_address } = req.body;

  // Validate required guest fields
  if (!guest_name || !guest_name.trim())
    return res.status(400).json({ error: 'Name is required' });
  if (!guest_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guest_email.trim()))
    return res.status(400).json({ error: 'A valid email address is required' });
  if (!guest_phone || !/^(?:07\d{9}|\+447\d{9})$/.test(guest_phone.replace(/\s+/g, '')))
    return res.status(400).json({ error: 'A valid UK phone number is required (07xxx xxx xxx)' });
  if (!guest_pickup_address || !guest_pickup_address.trim())
    return res.status(400).json({ error: 'Pickup address is required' });
  if (!instructor_id || !date || !start_time || !end_time)
    return res.status(400).json({ error: 'instructor_id, date, start_time, end_time required' });

  const cleanEmail = guest_email.toLowerCase().trim();
  const cleanPhone = guest_phone.replace(/\s+/g, '').trim();
  const cleanName  = guest_name.trim();
  const cleanAddr  = guest_pickup_address.trim();
  const schoolId   = parseInt(req.body.school_id, 10) || 1;

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // ── Rate limiting: 10 per IP per hour, 5 per phone per hour ──
    const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
    const ipKey = `guest_checkout_ip:${ip}`;
    const phoneKey = `guest_checkout_phone:${cleanPhone}`;
    try {
      await sql`DELETE FROM rate_limits WHERE window_start < NOW() - INTERVAL '1 hour'`;
      const [ipLimit] = await sql`SELECT request_count FROM rate_limits WHERE key = ${ipKey} AND window_start > NOW() - INTERVAL '1 hour'`;
      if (ipLimit && ipLimit.request_count >= 10)
        return res.status(429).json({ error: 'Too many booking attempts. Please try again later.' });
      const [phoneLimit] = await sql`SELECT request_count FROM rate_limits WHERE key = ${phoneKey} AND window_start > NOW() - INTERVAL '1 hour'`;
      if (phoneLimit && phoneLimit.request_count >= 5)
        return res.status(429).json({ error: 'Too many booking attempts for this phone number. Please try again later.' });
      // Increment counters
      for (const key of [ipKey, phoneKey]) {
        const [ex] = await sql`SELECT request_count FROM rate_limits WHERE key = ${key} AND window_start > NOW() - INTERVAL '1 hour'`;
        if (ex) {
          await sql`UPDATE rate_limits SET request_count = request_count + 1 WHERE key = ${key} AND window_start > NOW() - INTERVAL '1 hour'`;
        } else {
          await sql`INSERT INTO rate_limits (key, request_count, window_start) VALUES (${key}, 1, NOW())`;
        }
      }
    } catch (e) { /* rate limit check failed — allow request through */ }

    // ── Slot validation (same as authenticated flow) ──
    const startMins = timeToMinutes(start_time);
    const endMins   = timeToMinutes(end_time);
    const checkoutDate = parseDate(date);
    const todayStart   = startOfDay(new Date());
    if (checkoutDate && checkoutDate.getTime() === todayStart.getTime()) {
      const now = new Date();
      const nowMins = now.getUTCHours() * 60 + now.getUTCMinutes();
      if (startMins <= nowMins)
        return res.status(400).json({ error: 'This slot has already started. Please choose a later time.' });
    }

    const lessonType = await getLessonType(sql, lesson_type_id);
    if (!lessonType) return res.status(404).json({ error: 'Lesson type not found or inactive' });
    const durationMins = lessonType.duration_minutes;
    const pricePence   = lessonType.price_pence;
    const durationStr  = formatHours(durationMins);

    if (endMins - startMins !== durationMins)
      return res.status(400).json({ error: `Slot must be exactly ${durationStr} for ${lessonType.name}` });

    await sql`DELETE FROM slot_reservations WHERE expires_at < NOW()`;

    const [existingBooking] = await sql`
      SELECT id FROM lesson_bookings
      WHERE instructor_id = ${instructor_id}
        AND scheduled_date = ${date}
        AND start_time = ${start_time}::time
        AND status = 'confirmed'
    `;
    if (existingBooking)
      return res.status(409).json({ error: 'Sorry, that slot is already booked.' });

    const [existingReservation] = await sql`
      SELECT id FROM slot_reservations
      WHERE instructor_id = ${instructor_id}
        AND scheduled_date = ${date}
        AND start_time = ${start_time}::time
        AND expires_at > NOW()
    `;
    if (existingReservation)
      return res.status(409).json({ error: 'Someone else is currently booking this slot. Try another or wait a few minutes.' });

    try {
      const [existingOffer] = await sql`
        SELECT id FROM lesson_offers
        WHERE instructor_id = ${instructor_id}
          AND scheduled_date = ${date}
          AND start_time = ${start_time}::time
          AND status = 'pending'
          AND expires_at > NOW()
      `;
      if (existingOffer)
        return res.status(409).json({ error: 'This slot is currently held for a pending lesson offer.' });
    } catch (e) { /* table may not exist yet */ }

    const [instructor] = await sql`
      SELECT id, name FROM instructors WHERE id = ${instructor_id} AND active = true
    `;
    if (!instructor)
      return res.status(404).json({ error: 'Instructor not found' });

    // ── Find or create learner ──
    let learnerId;
    const [existingLearner] = await sql`
      SELECT id, name, phone, pickup_address FROM learner_users
      WHERE LOWER(email) = ${cleanEmail} AND school_id = ${schoolId}
    `;

    if (existingLearner) {
      learnerId = existingLearner.id;
      // Backfill empty fields only — never overwrite existing data
      const needsUpdate = (!existingLearner.name && cleanName) ||
                          (!existingLearner.phone && cleanPhone) ||
                          (!existingLearner.pickup_address && cleanAddr);
      if (needsUpdate) {
        await sql`
          UPDATE learner_users SET
            name = COALESCE(NULLIF(name, ''), ${cleanName}),
            phone = COALESCE(phone, ${cleanPhone}),
            pickup_address = COALESCE(NULLIF(pickup_address, ''), ${cleanAddr}),
            last_activity_at = NOW()
          WHERE id = ${learnerId}
        `;
      }
    } else {
      try {
        const [newLearner] = await sql`
          INSERT INTO learner_users (name, email, phone, pickup_address, balance_minutes, credit_balance, school_id)
          VALUES (${cleanName}, ${cleanEmail}, ${cleanPhone}, ${cleanAddr}, 0, 0, ${schoolId})
          RETURNING id
        `;
        learnerId = newLearner.id;
      } catch (insertErr) {
        if (insertErr.message?.includes('learner_users_phone_key') || insertErr.message?.includes('unique')) {
          // Phone already in use by another account — retry without phone
          console.warn('⚠️ Guest checkout: phone conflict, retrying without phone');
          const [newLearner] = await sql`
            INSERT INTO learner_users (name, email, pickup_address, balance_minutes, credit_balance, school_id)
            VALUES (${cleanName}, ${cleanEmail}, ${cleanAddr}, 0, 0, ${schoolId})
            RETURNING id
          `;
          learnerId = newLearner.id;
        } else {
          throw insertErr;
        }
      }
    }

    // ── Create Stripe Checkout session ──
    const origin = req.headers.origin || 'https://coachcarter.uk';
    const lessonDate = new Date(date + 'T00:00:00Z')
      .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card', 'klarna'],
      line_items: [{
        price_data: {
          currency: 'gbp',
          unit_amount: pricePence,
          product_data: {
            name: `${lessonType.name} — ${lessonDate} ${start_time}–${end_time}`,
            description: `${durationStr} lesson with ${instructor.name}. Slot held for ${RESERVATION_MINUTES} minutes.`
          }
        },
        quantity: 1
      }],
      metadata: {
        payment_type:    'slot_booking',
        learner_id:      String(learnerId),
        learner_email:   cleanEmail,
        instructor_id:   String(instructor_id),
        instructor_name: instructor.name,
        scheduled_date:  date,
        start_time,
        end_time,
        lesson_type_id:  String(lessonType.id),
        duration_minutes: String(durationMins),
        amount_pence:    String(pricePence),
        school_id:       String(schoolId)
      },
      customer_email: cleanEmail,
      billing_address_collection: 'required',
      allow_promotion_codes: true,
      success_url: `${origin}/learner/book.html?paid=1`,
      cancel_url:  `${origin}/learner/book.html?cancelled=1`
    });

    // Reserve the slot
    await sql`
      INSERT INTO slot_reservations
        (learner_id, instructor_id, scheduled_date, start_time, end_time, stripe_session_id, expires_at, school_id)
      VALUES
        (${learnerId}, ${instructor_id}, ${date}, ${start_time}, ${end_time}, ${session.id},
         NOW() + INTERVAL '10 minutes', ${schoolId})
      ON CONFLICT DO NOTHING
    `;

    return res.json({ url: session.url });
  } catch (err) {
    console.error('checkout-slot-guest error:', err);
    reportError('/api/slots?action=checkout-slot-guest', err);
    return res.status(500).json({ error: 'Failed to create checkout', details: err.message });
  }
}

// ── POST /api/slots?action=cancel ─────────────────────────────────────────────
// Body: { booking_id }
// Cancels a confirmed booking. Returns credit if 48+ hours before lesson.
async function handleCancel(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = user.school_id || 1;

  const { booking_id, cancel_series } = req.body;
  if (!booking_id) return res.status(400).json({ error: 'booking_id required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Load booking — must belong to this learner
    const [booking] = await sql`
      SELECT lb.*, i.name AS instructor_name, i.email AS instructor_email, i.phone AS instructor_phone,
             lu.name AS learner_name, lu.email AS learner_email, lu.phone AS learner_phone
      FROM lesson_bookings lb
      JOIN instructors i    ON i.id  = lb.instructor_id
      JOIN learner_users lu ON lu.id = lb.learner_id
      WHERE lb.id = ${booking_id} AND lb.learner_id = ${user.id}
        AND COALESCE(lb.school_id, 1) = ${schoolId}
    `;

    if (!booking)
      return res.status(404).json({ error: 'Booking not found' });
    if (booking.status !== 'confirmed')
      return res.status(400).json({ error: `Cannot cancel a booking with status "${booking.status}"` });

    const isDemoBooking = booking.instructor_email === 'demo@coachcarter.uk';

    // ── Series cancellation ─────────────────────────────────────────────────
    if (cancel_series && booking.series_id) {
      // Find all future confirmed bookings in this series (including the target)
      const seriesBookings = await sql`
        SELECT id, scheduled_date::text, start_time::text, end_time::text, minutes_deducted
        FROM lesson_bookings
        WHERE series_id = ${booking.series_id}
          AND learner_id = ${user.id}
          AND status = 'confirmed'
          AND scheduled_date >= CURRENT_DATE
        ORDER BY scheduled_date
      `;

      if (seriesBookings.length === 0)
        return res.status(400).json({ error: 'No future bookings in this series to cancel' });

      const cancelled = [];
      const refunded = [];
      const noRefund = [];
      let totalMinsRefunded = 0;

      for (const sb of seriesBookings) {
        const lessonDT = new Date(`${sb.scheduled_date}T${sb.start_time}:00Z`);
        const hoursUntil = (lessonDT - Date.now()) / 3600000;
        const eligible = !isDemoBooking && hoursUntil >= CANCEL_HOURS_CUTOFF;
        const mins = sb.minutes_deducted || DEFAULT_SLOT_MINUTES;

        await sql`
          UPDATE lesson_bookings
          SET status = 'cancelled', cancelled_at = NOW(), credit_returned = ${eligible}
          WHERE id = ${sb.id}
        `;

        cancelled.push(sb.id);
        if (eligible) {
          refunded.push(sb.id);
          totalMinsRefunded += mins;
        } else {
          noRefund.push(sb.id);
        }
      }

      // Refund total eligible minutes in one update
      if (totalMinsRefunded > 0) {
        const creditsBack = Math.ceil(totalMinsRefunded / 60);
        await sql`
          UPDATE learner_users
          SET balance_minutes = balance_minutes + ${totalMinsRefunded},
              credit_balance = credit_balance + ${creditsBack}
          WHERE id = ${user.id}
        `;
      }

      const [updated] = await sql`SELECT credit_balance, balance_minutes FROM learner_users WHERE id = ${user.id}`;
      const balanceStr = formatHours(updated.balance_minutes || 0);
      const refundedStr = formatHours(totalMinsRefunded);

      // Send summary notifications
      const mailer = createTransporter();
      const dateList = seriesBookings.map(sb => {
        const display = formatDateDisplay(sb.scheduled_date);
        return `<li>${display} at ${String(sb.start_time).slice(0, 5)}</li>`;
      }).join('');

      await mailer.sendMail({
        from:    'CoachCarter <bookings@coachcarter.uk>',
        to:      booking.learner_email,
        subject: `${cancelled.length} lessons cancelled`,
        html: `
          <h1>${cancelled.length} lessons cancelled.</h1>
          <p>The following lessons with ${booking.instructor_name} have been cancelled:</p>
          <ol>${dateList}</ol>
          ${totalMinsRefunded > 0 ? `<p><strong>${refundedStr} returned to your balance.</strong> You now have ${balanceStr} remaining.</p>` : ''}
          ${noRefund.length > 0 ? `<p>${noRefund.length} lesson(s) were within 48 hours and hours were forfeited.</p>` : ''}
          <p><a href="https://coachcarter.uk/learner/"
                style="background:#f58321;color:white;padding:12px 24px;text-decoration:none;
                       border-radius:8px;display:inline-block;font-weight:bold">
            Book again →
          </a></p>
        `
      });

      if (!isDemoBooking) {
        await mailer.sendMail({
          from:    'CoachCarter <system@coachcarter.uk>',
          to:      booking.instructor_email,
          subject: `${cancelled.length} lessons cancelled — ${booking.learner_name}`,
          html: `
            <h2>${cancelled.length} lessons cancelled</h2>
            <p><strong>${booking.learner_name}</strong> has cancelled their weekly series:</p>
            <ol>${dateList}</ol>
            <p>These slots are now free.</p>
          `
        });
      }

      const dateListText = seriesBookings.map(sb => `  📅 ${formatDateDisplay(sb.scheduled_date)}`).join('\n');
      await sendWhatsApp(booking.learner_phone,
        `❌ ${cancelled.length} lessons cancelled\n\n${dateListText}\n\n${totalMinsRefunded > 0 ? `${refundedStr} returned. Balance: ${balanceStr}` : 'Hours forfeited (less than 48hrs notice).'}\n\nRebook: https://coachcarter.uk/learner/book.html`
      );
      if (!isDemoBooking) {
        await sendWhatsApp(booking.instructor_phone,
          `❌ ${cancelled.length} lessons cancelled\n\n👤 ${booking.learner_name}\n${dateListText}\n\nThese slots are now free.`
        );
      }

      // Waitlist: notify matching learners for each freed slot (fire-and-forget)
      for (const sb of seriesBookings) {
        checkWaitlistOnCancel({
          instructor_id:   booking.instructor_id,
          instructor_name: booking.instructor_name,
          scheduled_date:  sb.scheduled_date,
          start_time:      sb.start_time,
          end_time:        sb.end_time,
          lesson_type_id:  booking.lesson_type_id,
          school_id:       booking.school_id
        }).catch(err => {
          console.warn('waitlist series check failed:', err.message);
          reportError('/api/slots:waitlist-series', err);
        });
      }

      return res.json({
        success:          true,
        cancelled,
        refunded,
        no_refund:        noRefund,
        minutes_returned: totalMinsRefunded,
        credit_balance:   updated.credit_balance,
        balance_minutes:  updated.balance_minutes || 0,
        balance_hours:    ((updated.balance_minutes || 0) / 60).toFixed(1),
        message: `${cancelled.length} lessons cancelled. ${totalMinsRefunded > 0 ? formatHours(totalMinsRefunded) + ' returned.' : ''}`
      });
    }

    // ── Single booking cancellation (existing logic) ────────────────────────

    // Calculate hours until lesson
    const lessonDateTime = new Date(`${booking.scheduled_date}T${booking.start_time}:00Z`);
    const hoursUntil     = (lessonDateTime - Date.now()) / 3600000;
    // Demo bookings are free, so no hours to return
    const creditReturned = !isDemoBooking && hoursUntil >= CANCEL_HOURS_CUTOFF;
    const minsToReturn   = booking.minutes_deducted || DEFAULT_SLOT_MINUTES;

    // Cancel the booking
    await sql`
      UPDATE lesson_bookings
      SET status = 'cancelled', cancelled_at = NOW(), credit_returned = ${creditReturned}
      WHERE id = ${booking_id}
    `;

    // Return hours if eligible (not for demo bookings)
    if (creditReturned) {
      await sql`
        UPDATE learner_users
        SET balance_minutes = balance_minutes + ${minsToReturn},
            credit_balance = credit_balance + 1
        WHERE id = ${user.id}
      `;
    }

    const [updated] = await sql`SELECT credit_balance, balance_minutes FROM learner_users WHERE id = ${user.id}`;
    const balanceStr = formatHours(updated.balance_minutes || 0);
    const returnedStr = formatHours(minsToReturn);

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
        <p><strong>${returnedStr} returned to your balance.</strong>
           You now have ${balanceStr} remaining.</p>
        <p><a href="https://coachcarter.uk/learner/"
              style="background:#f58321;color:white;padding:12px 24px;text-decoration:none;
                     border-radius:8px;display:inline-block;font-weight:bold">
          Book another lesson →
        </a></p>
      ` : `
        <h1>Lesson cancelled.</h1>
        <p>Your lesson on <strong>${lessonDateStr} at ${String(booking.start_time).slice(0,5)}</strong>
           with ${booking.instructor_name} has been cancelled.</p>
        <p><strong>As this was cancelled with less than 48 hours' notice, your hours have been forfeited
           in line with our cancellation policy.</strong></p>
        <p>If you believe this is an error, please reply to this email.</p>
      `
    });

    // Notify instructor (skip for demo instructor)
    if (!isDemoBooking) {
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
    }

    // WhatsApp cancellation notifications
    const cancelTime = String(booking.start_time).slice(0, 5);
    await sendWhatsApp(booking.learner_phone,
      creditReturned
        ? `❌ Lesson cancelled\n\n📅 ${lessonDateStr} at ${cancelTime}\n\n${returnedStr} returned to your balance. You now have ${balanceStr} remaining.\n\nRebook: https://coachcarter.uk/learner/book.html`
        : `❌ Lesson cancelled\n\n📅 ${lessonDateStr} at ${cancelTime}\n\nAs this was less than 48 hours' notice, your hours have been forfeited.`
    );
    if (!isDemoBooking) {
      await sendWhatsApp(booking.instructor_phone,
        `❌ Lesson cancelled\n\n👤 ${booking.learner_name}\n📅 ${lessonDateStr} at ${cancelTime}\n\nThis slot is now free.`
      );
    }

    // Waitlist: notify matching learners for this freed slot (fire-and-forget)
    checkWaitlistOnCancel({
      instructor_id:   booking.instructor_id,
      instructor_name: booking.instructor_name,
      scheduled_date:  String(booking.scheduled_date).slice(0, 10),
      start_time:      booking.start_time,
      end_time:        booking.end_time,
      lesson_type_id:  booking.lesson_type_id,
      school_id:       booking.school_id
    }).catch(err => {
      console.warn('waitlist check failed:', err.message);
      reportError('/api/slots:waitlist', err);
    });

    return res.json({
      success:          true,
      credit_returned:  creditReturned,
      credit_balance:   updated.credit_balance,
      balance_minutes:  updated.balance_minutes || 0,
      balance_hours:    ((updated.balance_minutes || 0) / 60).toFixed(1),
      minutes_returned: creditReturned ? minsToReturn : 0,
      message: isDemoBooking
        ? 'Demo booking cancelled.'
        : creditReturned
          ? `Booking cancelled and ${returnedStr} returned to your balance.`
          : `Booking cancelled. Hours forfeited (less than ${CANCEL_HOURS_CUTOFF} hours' notice).`
    });

  } catch (err) {
    console.error('slots cancel error:', err);
    reportError('/api/slots', err);
    return res.status(500).json({ error: 'Cancellation failed', details: err.message });
  }
}

// ── POST /api/slots?action=reschedule ────────────────────────────────────────
// Body: { booking_id, new_date, new_start_time }
// Atomically moves a confirmed booking to a new time slot (no credit change).
async function handleReschedule(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = user.school_id || 1;

  const { booking_id, new_date, new_start_time } = req.body;
  if (!booking_id || !new_date || !new_start_time)
    return res.status(400).json({ error: 'booking_id, new_date and new_start_time are required' });

  // Validate new date format
  const newBookingDate = parseDate(new_date);
  if (!newBookingDate)
    return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });

  const today    = startOfDay(new Date());
  const maxAhead = addDays(today, MAX_DAYS_AHEAD);
  if (newBookingDate < today)
    return res.status(400).json({ error: 'Cannot reschedule to a date in the past' });
  if (newBookingDate > maxAhead)
    return res.status(400).json({ error: `Cannot reschedule more than ${MAX_DAYS_AHEAD} days in advance` });

  const newStartMins = timeToMinutes(new_start_time);

  // Reject if new slot has already started
  if (newBookingDate.getTime() === today.getTime()) {
    const now = new Date();
    const nowMins = now.getUTCHours() * 60 + now.getUTCMinutes();
    if (newStartMins <= nowMins)
      return res.status(400).json({ error: 'This slot has already started.' });
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Load booking — must belong to this learner
    const [booking] = await sql`
      SELECT lb.*, i.name AS instructor_name, i.email AS instructor_email,
             i.phone AS instructor_phone,
             lu.name AS learner_name, lu.email AS learner_email, lu.phone AS learner_phone,
             COALESCE(lb.reschedule_count, 0) AS reschedule_count,
             COALESCE(lt.duration_minutes, ${DEFAULT_SLOT_MINUTES}) AS type_duration_minutes,
             lt.name AS lesson_type_name
      FROM lesson_bookings lb
      JOIN instructors i    ON i.id  = lb.instructor_id
      JOIN learner_users lu ON lu.id = lb.learner_id
      LEFT JOIN lesson_types lt ON lt.id = lb.lesson_type_id
      WHERE lb.id = ${booking_id} AND lb.learner_id = ${user.id}
        AND COALESCE(lb.school_id, 1) = ${schoolId}
    `;

    if (!booking)
      return res.status(404).json({ error: 'Booking not found' });

    // Calculate new end time using booking's lesson type duration
    const bookingDuration = parseInt(booking.type_duration_minutes) || DEFAULT_SLOT_MINUTES;
    const newEndMins   = newStartMins + bookingDuration;
    const new_end_time = minutesToTime(newEndMins);
    if (booking.status !== 'confirmed')
      return res.status(400).json({ error: `Cannot reschedule a booking with status "${booking.status}"` });

    // Check 48-hour reschedule window (same as cancellation policy)
    const lessonDateTime = new Date(`${booking.scheduled_date}T${booking.start_time}:00Z`);
    const hoursUntil     = (lessonDateTime - Date.now()) / 3600000;
    if (hoursUntil < CANCEL_HOURS_CUTOFF)
      return res.status(400).json({
        error: `Cannot reschedule with less than ${CANCEL_HOURS_CUTOFF} hours' notice. You can still cancel, but the lesson will be forfeited.`
      });

    // Reschedule count cap (max 2)
    const MAX_RESCHEDULES = 2;
    if (booking.reschedule_count >= MAX_RESCHEDULES)
      return res.status(400).json({
        error: `This lesson has already been rescheduled ${MAX_RESCHEDULES} times. Please cancel and rebook instead.`
      });

    // Check new slot isn't the same as current
    const oldDate  = String(booking.scheduled_date).slice(0, 10);
    const oldStart = String(booking.start_time).slice(0, 5);
    if (new_date === oldDate && new_start_time === oldStart)
      return res.status(400).json({ error: 'New time is the same as current booking' });

    // Check new slot is available (not booked or reserved)
    const [existingBooking] = await sql`
      SELECT id FROM lesson_bookings
      WHERE instructor_id = ${booking.instructor_id}
        AND scheduled_date = ${new_date}
        AND start_time = ${new_start_time}::time
        AND status IN ('confirmed', 'completed', 'awaiting_confirmation')
        AND COALESCE(school_id, 1) = ${schoolId}
    `;
    if (existingBooking)
      return res.status(409).json({ error: 'That slot is already booked. Please choose another.' });

    const [existingReservation] = await sql`
      SELECT id FROM slot_reservations
      WHERE instructor_id = ${booking.instructor_id}
        AND scheduled_date = ${new_date}
        AND start_time = ${new_start_time}::time
        AND expires_at > NOW()
    `;
    if (existingReservation)
      return res.status(409).json({ error: 'Someone is currently booking that slot. Try another or wait a few minutes.' });

    // Atomically: mark old booking as rescheduled, create new one
    // 1. Mark old booking as rescheduled
    await sql`
      UPDATE lesson_bookings
      SET status = 'rescheduled', cancelled_at = NOW()
      WHERE id = ${booking_id}
    `;

    // 2. Create new booking
    let newBooking;
    try {
      const [b] = await sql`
        INSERT INTO lesson_bookings
          (learner_id, instructor_id, scheduled_date, start_time, end_time, status,
           rescheduled_from, reschedule_count, pickup_address, dropoff_address,
           lesson_type_id, minutes_deducted, school_id)
        VALUES
          (${user.id}, ${booking.instructor_id}, ${new_date}, ${new_start_time}, ${new_end_time},
           'confirmed', ${booking_id}, ${booking.reschedule_count + 1},
           ${booking.pickup_address || null}, ${booking.dropoff_address || null},
           ${booking.lesson_type_id || null}, ${booking.minutes_deducted != null ? booking.minutes_deducted : null},
           ${schoolId})
        RETURNING id, scheduled_date, start_time::text, end_time::text, status,
                  rescheduled_from, reschedule_count
      `;
      newBooking = b;
    } catch (insertErr) {
      // Rollback: restore old booking
      await sql`
        UPDATE lesson_bookings
        SET status = 'confirmed', cancelled_at = NULL
        WHERE id = ${booking_id}
      `;
      if (insertErr.message?.includes('uq_booking_slot') || insertErr.code === '23505') {
        return res.status(409).json({ error: 'That slot was just booked by someone else. Please choose another.' });
      }
      throw insertErr;
    }

    // Send notifications
    const oldDateStr = formatDateDisplay(oldDate);
    const newDateStr = formatDateDisplay(new_date);
    const oldTime    = oldStart;
    const newTime    = new_start_time;
    const mailer     = createTransporter();
    const isDemoBooking = booking.instructor_email === 'demo@coachcarter.uk';

    // Generate .ics for new booking
    const icsContent = generateICS({
      id: newBooking.id,
      scheduled_date: new_date,
      start_time: new_start_time,
      end_time: new_end_time,
      instructor_name: booking.instructor_name
    });

    // Email to learner
    await mailer.sendMail({
      from:    'CoachCarter <bookings@coachcarter.uk>',
      to:      booking.learner_email,
      subject: `Lesson rescheduled — now ${newDateStr} at ${newTime}`,
      html: `
        <h1>Lesson rescheduled</h1>
        <p>Your lesson has been moved:</p>
        <table>
          <tr><td><strong>Was:</strong></td><td><s>${oldDateStr} at ${oldTime}</s></td></tr>
          <tr><td><strong>Now:</strong></td><td>${newDateStr} at ${newTime}</td></tr>
          <tr><td><strong>Instructor:</strong></td><td>${booking.instructor_name}</td></tr>
          <tr><td><strong>Duration:</strong></td><td>${formatHours(bookingDuration)}</td></tr>
        </table>
        <p style="margin-top:16px;font-size:0.875rem;color:#797879">
          You can reschedule ${MAX_RESCHEDULES - newBooking.reschedule_count} more time${MAX_RESCHEDULES - newBooking.reschedule_count !== 1 ? 's' : ''}.
          Cancel at least 48 hours before and the hours return to your balance.
        </p>
        <p>
          <a href="https://coachcarter.uk/learner/"
             style="background:#f58321;color:white;padding:12px 24px;text-decoration:none;border-radius:8px;display:inline-block;font-weight:bold">
            View my bookings →
          </a>
        </p>
      `,
      attachments: [{
        filename: `coachcarter-lesson-${new_date}.ics`,
        content:  icsContent,
        contentType: 'text/calendar; method=PUBLISH'
      }]
    });

    // Email to instructor (skip demo)
    if (!isDemoBooking) {
      await mailer.sendMail({
        from:    'CoachCarter <system@coachcarter.uk>',
        to:      booking.instructor_email,
        subject: `Lesson rescheduled — ${booking.learner_name}`,
        html: `
          <h2>Lesson rescheduled</h2>
          <p><strong>${booking.learner_name}</strong> has rescheduled their lesson:</p>
          <table>
            <tr><td><strong>Was:</strong></td><td>${oldDateStr} at ${oldTime}</td></tr>
            <tr><td><strong>Now:</strong></td><td>${newDateStr} at ${newTime}</td></tr>
          </table>
          <p style="margin-top:16px">
            <a href="https://coachcarter.uk/instructor/"
               style="background:#f58321;color:white;padding:10px 20px;text-decoration:none;
                      border-radius:8px;display:inline-block;font-weight:bold;font-size:0.9rem">
              View my schedule →
            </a>
          </p>
        `
      });
    }

    // WhatsApp notifications
    await sendWhatsApp(booking.learner_phone,
      `🔄 Lesson rescheduled!\n\n❌ Was: ${oldDateStr} at ${oldTime}\n✅ Now: ${newDateStr} at ${newTime}\n🚗 Instructor: ${booking.instructor_name}\n\nView bookings: https://coachcarter.uk/learner/`
    );
    if (!isDemoBooking) {
      await sendWhatsApp(booking.instructor_phone,
        `🔄 Lesson rescheduled\n\n👤 ${booking.learner_name}\n❌ Was: ${oldDateStr} at ${oldTime}\n✅ Now: ${newDateStr} at ${newTime}\n\nView schedule: https://coachcarter.uk/instructor/`
      );
    }

    return res.json({
      ok: true,
      old_booking_id: booking_id,
      new_booking_id: newBooking.id,
      new_date,
      new_start_time,
      new_end_time,
      reschedule_count: newBooking.reschedule_count,
      message: `Lesson rescheduled from ${oldDateStr} at ${oldTime} to ${newDateStr} at ${newTime}.`
    });

  } catch (err) {
    console.error('slots reschedule error:', err);
    reportError('/api/slots', err);
    return res.status(500).json({ error: 'Reschedule failed', details: err.message });
  }
}

// ── GET /api/slots?action=my-bookings ────────────────────────────────────────
// Returns the authenticated learner's upcoming and recent bookings.
async function handleMyBookings(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = user.school_id || 1;
  const pastLimit = Math.min(parseInt(new URL(req.url, 'http://x').searchParams.get('past_limit')) || 20, 100);
  const pastOffset = parseInt(new URL(req.url, 'http://x').searchParams.get('past_offset')) || 0;

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const nowISO = new Date().toISOString().slice(0, 10);

    // Upcoming: all confirmed future lessons (no limit)
    const upcoming = await sql`
      SELECT
        lb.id, lb.scheduled_date::text, lb.start_time::text, lb.end_time::text,
        lb.status, lb.cancelled_at, lb.credit_returned,
        COALESCE(lb.reschedule_count, 0) AS reschedule_count,
        lb.rescheduled_from, lb.pickup_address, lb.dropoff_address,
        lb.lesson_type_id, lb.minutes_deducted, lb.series_id,
        i.id AS instructor_id, i.name AS instructor_name, i.photo_url AS instructor_photo,
        lt.name AS lesson_type_name, lt.colour AS lesson_type_colour,
        COALESCE(lt.duration_minutes, ${DEFAULT_SLOT_MINUTES}) AS duration_minutes
      FROM lesson_bookings lb
      JOIN instructors i ON i.id = lb.instructor_id
      LEFT JOIN lesson_types lt ON lt.id = lb.lesson_type_id
      WHERE lb.learner_id = ${user.id}
        AND COALESCE(lb.school_id, 1) = ${schoolId}
        AND lb.status = 'confirmed'
        AND lb.scheduled_date >= ${nowISO}
      ORDER BY lb.scheduled_date ASC, lb.start_time ASC
    `;

    // Past: paginated (completed, cancelled, or past confirmed)
    const past = await sql`
      SELECT
        lb.id, lb.scheduled_date::text, lb.start_time::text, lb.end_time::text,
        lb.status, lb.cancelled_at, lb.credit_returned,
        COALESCE(lb.reschedule_count, 0) AS reschedule_count,
        lb.rescheduled_from, lb.pickup_address, lb.dropoff_address,
        lb.lesson_type_id, lb.minutes_deducted, lb.series_id,
        i.id AS instructor_id, i.name AS instructor_name, i.photo_url AS instructor_photo,
        lt.name AS lesson_type_name, lt.colour AS lesson_type_colour,
        COALESCE(lt.duration_minutes, ${DEFAULT_SLOT_MINUTES}) AS duration_minutes
      FROM lesson_bookings lb
      JOIN instructors i ON i.id = lb.instructor_id
      LEFT JOIN lesson_types lt ON lt.id = lb.lesson_type_id
      WHERE lb.learner_id = ${user.id}
        AND COALESCE(lb.school_id, 1) = ${schoolId}
        AND NOT (lb.status = 'confirmed' AND lb.scheduled_date >= ${nowISO})
      ORDER BY lb.scheduled_date DESC, lb.start_time DESC
      LIMIT ${pastLimit + 1}
      OFFSET ${pastOffset}
    `;

    const hasMorePast = past.length > pastLimit;
    if (hasMorePast) past.pop();

    return res.json({ upcoming, past, hasMorePast });

  } catch (err) {
    console.error('slots my-bookings error:', err);
    reportError('/api/slots', err);
    return res.status(500).json({ error: 'Failed to load bookings', details: err.message });
  }
}

// ── GET /api/slots?action=series-info&booking_id=X ──────────────────────────
// Returns all bookings in a series, given any booking ID from that series.
async function handleSeriesInfo(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = user.school_id || 1;

  const { booking_id } = req.query;
  if (!booking_id) return res.status(400).json({ error: 'booking_id required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Find the series_id for this booking
    const [target] = await sql`
      SELECT series_id FROM lesson_bookings
      WHERE id = ${booking_id} AND learner_id = ${user.id}
        AND COALESCE(school_id, 1) = ${schoolId}
    `;
    if (!target)
      return res.status(404).json({ error: 'Booking not found' });
    if (!target.series_id)
      return res.json({ ok: true, series: null, message: 'This booking is not part of a series' });

    // Load all bookings in the series
    const bookings = await sql`
      SELECT
        lb.id,
        lb.scheduled_date::text,
        lb.start_time::text,
        lb.end_time::text,
        lb.status,
        lb.cancelled_at,
        lb.credit_returned,
        lb.series_id,
        i.name AS instructor_name,
        lt.name AS lesson_type_name,
        lt.colour AS lesson_type_colour,
        COALESCE(lt.duration_minutes, ${DEFAULT_SLOT_MINUTES}) AS duration_minutes
      FROM lesson_bookings lb
      JOIN instructors i ON i.id = lb.instructor_id
      LEFT JOIN lesson_types lt ON lt.id = lb.lesson_type_id
      WHERE lb.series_id = ${target.series_id} AND lb.learner_id = ${user.id}
        AND COALESCE(lb.school_id, 1) = ${schoolId}
      ORDER BY lb.scheduled_date, lb.start_time
    `;

    const confirmed = bookings.filter(b => b.status === 'confirmed');
    const future = confirmed.filter(b => new Date(`${b.scheduled_date}T${b.start_time}:00Z`) > new Date());

    return res.json({
      ok: true,
      series_id: target.series_id,
      total: bookings.length,
      confirmed: confirmed.length,
      remaining: future.length,
      bookings
    });

  } catch (err) {
    console.error('slots series-info error:', err);
    reportError('/api/slots', err);
    return res.status(500).json({ error: 'Failed to load series info', details: err.message });
  }
}

// ── ICS calendar file generation ──────────────────────────────────────────────

function generateICS(booking) {
  const dtStart = toICSDate(booking.scheduled_date, booking.start_time);
  const dtEnd   = toICSDate(booking.scheduled_date, booking.end_time);
  const uid     = `booking-${booking.id}@coachcarter.uk`;
  const now     = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

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
    `DESCRIPTION:${booking.duration_str || '1.5 hours'} ${booking.lesson_type_name || 'driving lesson'} with ${booking.instructor_name}.\\n\\nManage your bookings: https://coachcarter.uk/learner/book.html\\n\\nNeed to cancel? Do so at least 48 hours before and the hours return to your balance.`,
    'STATUS:CONFIRMED',
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

// "2026-03-15", "09:30" → "20260315T093000"
function toICSDate(dateStr, timeStr) {
  const d = dateStr.replace(/-/g, '');
  const t = timeStr.replace(/:/g, '').slice(0, 6);
  return `${d}T${t.padEnd(6, '0')}`;
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
