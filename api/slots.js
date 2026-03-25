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
const stripe      = require('stripe')(process.env.STRIPE_SECRET_KEY);
const twilio      = require('twilio');

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

const SLOT_MINUTES        = 90;   // 1.5 hours
const MAX_DAYS_AHEAD      = 90;   // booking window
const MAX_RANGE_DAYS      = 31;   // max days per API request
const CANCEL_HOURS_CUTOFF = 48;   // hours notice needed to get credit back
const LESSON_PRICE_PENCE  = 8250; // £82.50 per single lesson
const RESERVATION_MINUTES = 10;   // hold slot for 10 mins during checkout

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
  if (action === 'available')    return handleAvailable(req, res);
  if (action === 'book')         return handleBook(req, res);
  if (action === 'checkout-slot') return handleCheckoutSlot(req, res);
  if (action === 'cancel')       return handleCancel(req, res);
  if (action === 'my-bookings')  return handleMyBookings(req, res);

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
                 i.photo_url, i.bio,
                 COALESCE(i.buffer_minutes, 30) AS buffer_minutes
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
                 i.photo_url, i.bio,
                 COALESCE(i.buffer_minutes, 30) AS buffer_minutes
          FROM instructor_availability ia
          JOIN instructors i ON i.id = ia.instructor_id
          WHERE ia.active = true
            AND i.active  = true
            AND i.email  != 'demo@coachcarter.uk'
          ORDER BY ia.instructor_id, ia.day_of_week, ia.start_time
        `;

    // 2. Load all confirmed/completed bookings in the date range
    const bookings = instructor_id
      ? await sql`
          SELECT instructor_id,
                 scheduled_date::text AS scheduled_date,
                 start_time::text     AS start_time,
                 end_time::text       AS end_time
          FROM lesson_bookings
          WHERE scheduled_date BETWEEN ${from} AND ${to}
            AND status IN ('confirmed', 'completed')
            AND instructor_id = ${instructor_id}
        `
      : await sql`
          SELECT instructor_id,
                 scheduled_date::text AS scheduled_date,
                 start_time::text     AS start_time,
                 end_time::text       AS end_time
          FROM lesson_bookings
          WHERE scheduled_date BETWEEN ${from} AND ${to}
            AND status IN ('confirmed', 'completed')
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

    // 2c. Load blackout dates in the date range
    let blackouts = [];
    try {
      blackouts = instructor_id
        ? await sql`
            SELECT instructor_id, blackout_date::text AS blackout_date
            FROM instructor_blackout_dates
            WHERE blackout_date BETWEEN ${from} AND ${to}
              AND instructor_id = ${instructor_id}
          `
        : await sql`
            SELECT instructor_id, blackout_date::text AS blackout_date
            FROM instructor_blackout_dates
            WHERE blackout_date BETWEEN ${from} AND ${to}
          `;
    } catch (e) {
      // Table may not exist yet — that's fine, no blackout dates
    }

    // Index blackout dates as "instructorId|date" for fast lookup
    const blackoutIndex = new Set();
    for (const b of blackouts) {
      blackoutIndex.add(`${b.instructor_id}|${b.blackout_date}`);
    }

    // Index bookings + reservations by "instructorId|date" for fast lookup
    const bookedIndex = {};
    for (const b of [...bookings, ...reservations]) {
      const key = `${b.instructor_id}|${b.scheduled_date}`;
      if (!bookedIndex[key]) bookedIndex[key] = [];
      bookedIndex[key].push({ start: timeToMinutes(b.start_time), end: timeToMinutes(b.end_time) });
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
          windows:        []
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

          while (slotStart + SLOT_MINUTES <= window.end) {
            const slotEnd = slotStart + SLOT_MINUTES;

            // Skip slots that have already started today
            if (isToday && slotStart <= nowMinutes) {
              slotStart += SLOT_MINUTES;
              continue;
            }

            // Check if this slot overlaps any booked slot (including buffer after each booking)
            const isBooked = bookedSlots.some(
              b => slotStart < (b.end + buffer) && slotEnd > b.start
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

  // Reject same-day bookings where the slot has already started
  if (bookingDate.getTime() === today.getTime()) {
    const now = new Date();
    const nowMins = now.getUTCHours() * 60 + now.getUTCMinutes();
    if (startMins <= nowMins)
      return res.status(400).json({ error: 'This slot has already started. Please choose a later time.' });
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // 1. Check learner has enough credits
    const [learner] = await sql`
      SELECT id, name, email, phone, credit_balance
      FROM learner_users WHERE id = ${user.id}
    `;
    if (!learner)
      return res.status(404).json({ error: 'Learner account not found' });

    // 2. Check instructor exists and is active
    const [instructor] = await sql`
      SELECT id, name, email, phone FROM instructors
      WHERE id = ${instructor_id} AND active = true
    `;
    if (!instructor)
      return res.status(404).json({ error: 'Instructor not found or unavailable' });

    // Demo instructor bookings are free (no credit deduction)
    const isDemoInstructor = instructor.email === 'demo@coachcarter.uk';

    if (!isDemoInstructor) {
      if (learner.credit_balance < 1)
        return res.status(402).json({ error: 'You have no lessons remaining. Please buy lessons to book.' });
    }

    // 3. Deduct credit FIRST (skip for demo instructor)
    if (!isDemoInstructor) {
      const [deducted] = await sql`
        UPDATE learner_users
        SET credit_balance = credit_balance - 1
        WHERE id = ${user.id} AND credit_balance >= 1
        RETURNING credit_balance
      `;
      if (!deducted)
        return res.status(402).json({ error: 'You have no lessons remaining. Please buy lessons to book.' });
    }

    // 4. Create booking — unique index on (instructor_id, scheduled_date, start_time)
    //    will throw if slot was taken. If so, refund the credit.
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
      // Refund the credit since booking failed (not needed for demo)
      if (!isDemoInstructor) {
        await sql`
          UPDATE learner_users
          SET credit_balance = credit_balance + 1
          WHERE id = ${user.id}
        `;
      }
      if (insertErr.message?.includes('uq_instructor_slot')) {
        return res.status(409).json({ error: 'Sorry, that slot was just booked by someone else. Please choose another.' });
      }
      throw insertErr;
    }

    // 5. Get updated balance for response
    const [updated] = await sql`SELECT credit_balance FROM learner_users WHERE id = ${user.id}`;

    // 6. Send confirmation emails
    const lessonDateStr = formatDateDisplay(date);
    const lessonTime    = `${start_time} – ${end_time}`;
    const mailer        = createTransporter();

    // Generate .ics calendar attachment
    const icsContent = generateICS({
      id: booking.id,
      scheduled_date: date,
      start_time,
      end_time,
      instructor_name: instructor.name
    });

    // Email to learner (with .ics attachment)
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
          <tr><td><strong>Lessons remaining:</strong></td><td>${updated.credit_balance}</td></tr>
        </table>
        <p style="margin-top:16px;font-size:0.875rem;color:#797879">
          Need to cancel? Do so at least 48 hours before and the lesson returns to your balance.
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

    // Email to instructor (skip for demo instructor)
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

    // WhatsApp notification — must await so Vercel doesn't kill the function
    await sendWhatsApp(learner.phone,
      `✅ Lesson confirmed!\n\n📅 ${lessonDateStr}\n⏰ ${lessonTime}\n🚗 Instructor: ${instructor.name}\n\nNeed to cancel? Do so at least 48 hours before and the lesson returns to your balance.\n\nView bookings: https://coachcarter.uk/learner/`
    );
    if (!isDemoInstructor) {
      await sendWhatsApp(instructor.phone,
        `📋 New booking!\n\n👤 ${learner.name}\n📅 ${lessonDateStr}\n⏰ ${lessonTime}\n\nView schedule: https://coachcarter.uk/instructor/`
      );
    }

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

// ── POST /api/slots?action=checkout-slot ──────────────────────────────────────
// Body: { instructor_id, date, start_time, end_time }
// Creates a Stripe Checkout session for a single lesson (£82.50).
// Reserves the slot for 10 minutes while the learner pays.
// The webhook will book the slot and add+deduct a credit on payment completion.
async function handleCheckoutSlot(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });

  const { instructor_id, date, start_time, end_time } = req.body;
  if (!instructor_id || !date || !start_time || !end_time)
    return res.status(400).json({ error: 'instructor_id, date, start_time, end_time required' });

  // Validate slot is 90 minutes
  const startMins = timeToMinutes(start_time);
  const endMins   = timeToMinutes(end_time);
  if (endMins - startMins !== SLOT_MINUTES)
    return res.status(400).json({ error: 'Slot must be exactly 90 minutes' });

  // Reject same-day bookings where the slot has already started
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
          unit_amount: LESSON_PRICE_PENCE,
          product_data: {
            name: `Driving Lesson — ${lessonDate} ${start_time}–${end_time}`,
            description: `1.5-hour lesson with ${instructor.name}. Slot held for ${RESERVATION_MINUTES} minutes.`
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
        amount_pence:    String(LESSON_PRICE_PENCE)
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
        (learner_id, instructor_id, scheduled_date, start_time, end_time, stripe_session_id, expires_at)
      VALUES
        (${user.id}, ${instructor_id}, ${date}, ${start_time}, ${end_time}, ${session.id},
         NOW() + INTERVAL '10 minutes')
      ON CONFLICT DO NOTHING
    `;

    return res.json({ url: session.url });
  } catch (err) {
    console.error('checkout-slot error:', err);
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

  const { booking_id } = req.body;
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
    `;

    if (!booking)
      return res.status(404).json({ error: 'Booking not found' });
    if (booking.status !== 'confirmed')
      return res.status(400).json({ error: `Cannot cancel a booking with status "${booking.status}"` });

    // Calculate hours until lesson
    const lessonDateTime = new Date(`${booking.scheduled_date}T${booking.start_time}:00Z`);
    const hoursUntil     = (lessonDateTime - Date.now()) / 3600000;
    const isDemoBooking  = booking.instructor_email === 'demo@coachcarter.uk';
    // Demo bookings are free, so no credit to return
    const creditReturned = !isDemoBooking && hoursUntil >= CANCEL_HOURS_CUTOFF;

    // Cancel the booking
    await sql`
      UPDATE lesson_bookings
      SET status = 'cancelled', cancelled_at = NOW(), credit_returned = ${creditReturned}
      WHERE id = ${booking_id}
    `;

    // Return credit if eligible (not for demo bookings)
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
        <p><strong>Your lesson has been returned to your balance.</strong>
           You now have ${updated.credit_balance} lesson${updated.credit_balance !== 1 ? 's' : ''} remaining.</p>
        <p><a href="https://coachcarter.uk/learner/"
              style="background:#f58321;color:white;padding:12px 24px;text-decoration:none;
                     border-radius:8px;display:inline-block;font-weight:bold">
          Book another lesson →
        </a></p>
      ` : `
        <h1>Lesson cancelled.</h1>
        <p>Your lesson on <strong>${lessonDateStr} at ${String(booking.start_time).slice(0,5)}</strong>
           with ${booking.instructor_name} has been cancelled.</p>
        <p><strong>As this was cancelled with less than 48 hours' notice, your lesson has been forfeited
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
        ? `❌ Lesson cancelled\n\n📅 ${lessonDateStr} at ${cancelTime}\n\nYour lesson has been returned to your balance. You now have ${updated.credit_balance} lesson(s) remaining.\n\nRebook: https://coachcarter.uk/learner/book.html`
        : `❌ Lesson cancelled\n\n📅 ${lessonDateStr} at ${cancelTime}\n\nAs this was less than 48 hours' notice, the lesson has been forfeited.`
    );
    if (!isDemoBooking) {
      await sendWhatsApp(booking.instructor_phone,
        `❌ Lesson cancelled\n\n👤 ${booking.learner_name}\n📅 ${lessonDateStr} at ${cancelTime}\n\nThis slot is now free.`
      );
    }

    return res.json({
      success:        true,
      credit_returned: creditReturned,
      credit_balance:  updated.credit_balance,
      message: isDemoBooking
        ? 'Demo booking cancelled.'
        : creditReturned
          ? 'Booking cancelled and lesson returned to your balance.'
          : `Booking cancelled. Lesson forfeited (less than ${CANCEL_HOURS_CUTOFF} hours\' notice).`
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
    `SUMMARY:Driving Lesson — ${booking.instructor_name}`,
    `DESCRIPTION:1.5-hour driving lesson with ${booking.instructor_name}.\\n\\nManage your bookings: https://coachcarter.uk/learner/book.html\\n\\nNeed to cancel? Do so at least 48 hours before and the lesson returns to your balance.`,
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
