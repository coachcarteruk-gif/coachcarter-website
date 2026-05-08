// Availability-based cancellation notifications.
//
// When a booking is cancelled, this module finds learners whose
// `learner_availability` window covers the freed slot and pings them via
// WhatsApp + email so they can rebook it.
//
// Two paths:
//
//   1. **Plain notification (default).** A simple "a slot just opened" message
//      pointing the learner at the booking page. Fired when the cancellation is
//      ≥48h before lesson start, or when the instructor has not opted into
//      broadcast offers. No discount, no token.
//
//   2. **Broadcast offer (opt-in, <48h cancellation).** Mints one
//      `lesson_offers` row per matching learner — same `batch_id`, individual
//      single-use `token`, `discount_pct=25`, `kind='broadcast'`,
//      `trigger='cancellation'`. The notification message links each learner to
//      `/accept-offer.html?token=…` for first-come-first-served acceptance.
//      Sibling supersession + "no longer available" follow-ups fire from the
//      Stripe webhook (or from the normal-booking hook in slots.js) when one
//      learner accepts.
//
// PR 2a (May 2026) added the broadcast path. PR 2b will add the
// instructor-triggered manual broadcast (same primitives, different trigger).

const { neon } = require('@neondatabase/serverless');
const crypto = require('crypto');
const { sendWhatsApp } = require('./_whatsapp');
const { createTransporter } = require('./_auth-helpers');

const FLASH_DISCOUNT_PCT = 25;
const FLASH_WINDOW_HOURS = 48; // cancellations within this window trigger the discount path
const BASE_URL = process.env.BASE_URL || 'https://coachcarter.uk';

function formatDateDisplay(str) {
  const iso = str instanceof Date ? str.toISOString().slice(0, 10) : String(str).slice(0, 10);
  const d = new Date(iso + 'T00:00:00Z');
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

function generateToken() {
  return crypto.randomBytes(24).toString('hex');
}

// Compute hours between now and the lesson start (UTC).
function hoursUntilLesson(scheduled_date, start_time) {
  const isoDate = scheduled_date instanceof Date
    ? scheduled_date.toISOString().slice(0, 10)
    : String(scheduled_date).slice(0, 10);
  const lessonDT = new Date(`${isoDate}T${String(start_time).slice(0, 5)}:00Z`);
  return (lessonDT - Date.now()) / 3600000;
}

async function notifyAvailableLearners({
  instructor_id,
  instructor_name,
  scheduled_date,
  start_time,
  end_time,
  lesson_type_id,
  school_id
}) {
  const sql = neon(process.env.POSTGRES_URL);
  const schoolId = school_id || 1;

  const isoSchedDate = scheduled_date instanceof Date
    ? scheduled_date.toISOString().slice(0, 10)
    : String(scheduled_date).slice(0, 10);
  const dayOfWeek = new Date(isoSchedDate + 'T00:00:00Z').getUTCDay();
  const slotStart = String(start_time).slice(0, 5);
  const slotEnd   = String(end_time).slice(0, 5);

  // Find every learner with an active availability window covering the slot,
  // scoped to this school.
  const matches = await sql`
    SELECT DISTINCT lu.id AS learner_id, lu.name, lu.email, lu.phone
    FROM learner_availability la
    JOIN learner_users lu ON lu.id = la.learner_id
    WHERE la.active = true
      AND la.school_id = ${schoolId}
      AND lu.school_id = ${schoolId}
      AND la.day_of_week = ${dayOfWeek}
      AND la.start_time <= ${slotStart}::time
      AND la.end_time   >= ${slotEnd}::time
  `;

  if (matches.length === 0) return { notified: 0, mode: 'none' };

  // Decide path: plain notification OR broadcast offer.
  const hoursUntil = hoursUntilLesson(scheduled_date, start_time);
  const withinFlashWindow = hoursUntil >= 0 && hoursUntil < FLASH_WINDOW_HOURS;

  let instructorOptedIn = false;
  if (withinFlashWindow) {
    const [row] = await sql`
      SELECT broadcast_offers_enabled FROM instructors WHERE id = ${instructor_id}
    `;
    instructorOptedIn = !!row?.broadcast_offers_enabled;
  }

  if (withinFlashWindow && instructorOptedIn) {
    return await sendBroadcastOffer({
      sql, matches, instructor_id, instructor_name,
      scheduled_date: isoSchedDate, start_time: slotStart, end_time: slotEnd,
      lesson_type_id, school_id: schoolId
    });
  }

  return await sendPlainNotification({
    matches, instructor_name,
    scheduled_date, start_time: slotStart
  });
}

// ── Path 1: plain "a slot opened" notification ──────────────────────────────
// Used when the cancellation is ≥48h out, or the instructor hasn't opted in.
async function sendPlainNotification({ matches, instructor_name, scheduled_date, start_time }) {
  const dateStr = formatDateDisplay(scheduled_date);
  const timeStr = formatTime12(start_time);
  const bookLink = `${BASE_URL}/learner/book.html`;
  const message = `A slot just opened!\n\n📅 ${dateStr} at ${timeStr}\n👨‍🏫 ${instructor_name}\n\nBook now: ${bookLink}`;

  const mailer = createTransporter();

  for (const m of matches) {
    if (m.phone) {
      sendWhatsApp(m.phone, message)
        .catch(err => console.warn('availability WA failed:', err.message));
    }
    if (m.email) {
      mailer.sendMail({
        from:    'CoachCarter <bookings@coachcarter.uk>',
        to:      m.email,
        subject: `A slot opened — ${dateStr} at ${timeStr}`,
        html: `
          <h2>A lesson slot just opened!</h2>
          <p>This slot matches your weekly availability:</p>
          <table style="border-collapse:collapse;margin:16px 0">
            <tr><td style="padding:6px 16px 6px 0;font-weight:bold">Date</td><td>${dateStr}</td></tr>
            <tr><td style="padding:6px 16px 6px 0;font-weight:bold">Time</td><td>${timeStr}</td></tr>
            <tr><td style="padding:6px 16px 6px 0;font-weight:bold">Instructor</td><td>${instructor_name}</td></tr>
          </table>
          <p>First to book gets it.</p>
          <p style="margin:24px 0">
            <a href="${bookLink}"
               style="background:#f58321;color:white;padding:14px 28px;text-decoration:none;
                      border-radius:8px;display:inline-block;font-weight:bold;font-size:1rem">
              Book this slot →
            </a>
          </p>
          <p style="font-size:0.85rem;color:#888">You received this because you set weekly availability covering this time. Update your availability anytime on your profile.</p>
        `
      }).catch(err => console.warn('availability email failed:', err.message));
    }
  }

  return { notified: matches.length, mode: 'plain' };
}

// ── Path 2: broadcast offer (25% off, single-use tokens, race) ──────────────
// Used when the cancellation is <48h out AND the instructor has opted in.
async function sendBroadcastOffer({
  sql, matches, instructor_id, instructor_name,
  scheduled_date, start_time, end_time, lesson_type_id, school_id
}) {
  // Look up the lesson type so we know the original price + duration.
  let lessonType = null;
  if (lesson_type_id) {
    const [lt] = await sql`
      SELECT id, name, duration_minutes, price_pence
      FROM lesson_types
      WHERE id = ${lesson_type_id} AND active = true AND school_id = ${school_id}
    `;
    lessonType = lt || null;
  }
  if (!lessonType) {
    // Fall back to standard for this school.
    const [lt] = await sql`
      SELECT id, name, duration_minutes, price_pence
      FROM lesson_types
      WHERE slug = 'standard' AND active = true AND school_id = ${school_id}
    `;
    lessonType = lt || { id: null, name: 'Standard Lesson', duration_minutes: 90, price_pence: 8250 };
  }

  const originalPricePence = lessonType.price_pence || 8250;
  const discountedPricePence = Math.round(originalPricePence * (100 - FLASH_DISCOUNT_PCT) / 100);

  // All offers in this fan-out share the same batch_id. Expire at lesson start.
  const batchId = crypto.randomUUID();
  const expiresAt = new Date(`${scheduled_date}T${start_time}:00Z`);

  // Insert one offer row per matching learner. Each has a unique token.
  const offerRows = [];
  for (const m of matches) {
    const token = generateToken();
    try {
      const [row] = await sql`
        INSERT INTO lesson_offers
          (token, instructor_id, learner_email, learner_id, learner_name,
           scheduled_date, start_time, end_time,
           lesson_type_id, discount_pct, status,
           kind, batch_id, trigger,
           expires_at, school_id)
        VALUES
          (${token}, ${instructor_id}, ${m.email || null}, ${m.learner_id}, ${m.name || null},
           ${scheduled_date}, ${start_time}, ${end_time},
           ${lessonType.id}, ${FLASH_DISCOUNT_PCT}, 'pending',
           'broadcast', ${batchId}, 'cancellation',
           ${expiresAt.toISOString()}, ${school_id})
        RETURNING id, token
      `;
      offerRows.push({ ...row, learner: m });
    } catch (err) {
      console.warn('broadcast offer insert failed for learner', m.learner_id, err.message);
    }
  }

  if (offerRows.length === 0) return { notified: 0, mode: 'broadcast', batch_id: batchId };

  // Send WhatsApp + email to each recipient with their own accept link.
  const dateStr = formatDateDisplay(scheduled_date);
  const timeStr = formatTime12(start_time);
  const priceStr = `£${(discountedPricePence / 100).toFixed(2)}`;
  const wasStr = `£${(originalPricePence / 100).toFixed(2)}`;

  const mailer = createTransporter();

  for (const { token, learner } of offerRows) {
    const acceptLink = `${BASE_URL}/accept-offer.html?token=${token}`;

    const waMsg =
      `We've had a last-minute cancellation — ${instructor_name} has a ${timeStr} slot on ${dateStr} at ${FLASH_DISCOUNT_PCT}% off (${priceStr} instead of ${wasStr}).\n\n` +
      `First come, first served. Click to book: ${acceptLink}`;

    if (learner.phone) {
      sendWhatsApp(learner.phone, waMsg)
        .catch(err => console.warn('broadcast WA failed:', err.message));
    }

    if (learner.email) {
      mailer.sendMail({
        from:    'CoachCarter <bookings@coachcarter.uk>',
        to:      learner.email,
        subject: `Last-minute slot — ${dateStr} at ${timeStr} · ${FLASH_DISCOUNT_PCT}% off`,
        html: `
          <h2>We've had a last-minute cancellation</h2>
          <p><strong>${instructor_name}</strong> has a slot opening up that matches your weekly availability:</p>
          <table style="border-collapse:collapse;margin:16px 0">
            <tr><td style="padding:6px 16px 6px 0;font-weight:bold">Date</td><td>${dateStr}</td></tr>
            <tr><td style="padding:6px 16px 6px 0;font-weight:bold">Time</td><td>${timeStr}</td></tr>
            <tr><td style="padding:6px 16px 6px 0;font-weight:bold">Lesson</td><td>${lessonType.name}</td></tr>
            <tr><td style="padding:6px 16px 6px 0;font-weight:bold">Price</td><td><strong>${priceStr}</strong> <span style="text-decoration:line-through;color:#888;font-weight:normal">${wasStr}</span> &middot; ${FLASH_DISCOUNT_PCT}% off</td></tr>
          </table>
          <p><strong>First come, first served</strong> — this offer is going out to a few learners who said they're free at this time.</p>
          <p style="margin:24px 0">
            <a href="${acceptLink}"
               style="background:#f58321;color:white;padding:14px 28px;text-decoration:none;
                      border-radius:8px;display:inline-block;font-weight:bold;font-size:1rem">
              Book this slot →
            </a>
          </p>
          <p style="font-size:0.85rem;color:#888">You received this because you set weekly availability covering this time. Update your availability anytime on your profile.</p>
        `
      }).catch(err => console.warn('broadcast email failed:', err.message));
    }
  }

  return { notified: offerRows.length, mode: 'broadcast', batch_id: batchId };
}

// ── Sibling supersession ────────────────────────────────────────────────────
// Called from api/webhook.js when a broadcast offer is accepted, and from
// api/slots.js when a learner books the slot via the regular flow without
// going through the offer link. Marks all other pending offers in the same
// batch (or on the same slot) as 'superseded' and sends a "sorry, no longer
// available" follow-up to those learners.
//
// `winnerOfferId` may be null when supersession is triggered by a normal
// booking (no offer was accepted; the slot just got taken).
async function supersedeBroadcastSiblings({ instructor_id, scheduled_date, start_time, school_id, winnerOfferId = null, batchId = null }) {
  const sql = neon(process.env.POSTGRES_URL);

  // Find all pending broadcast offers for this slot, EXCEPT the winner if any.
  // Use batch_id when we know it (cleaner); otherwise match on slot identity.
  let losers;
  if (batchId) {
    losers = await sql`
      SELECT id, learner_email, learner_name, learner_id
      FROM lesson_offers
      WHERE batch_id = ${batchId}
        AND status = 'pending'
        AND id IS DISTINCT FROM ${winnerOfferId}
    `;
  } else {
    losers = await sql`
      SELECT id, learner_email, learner_name, learner_id
      FROM lesson_offers
      WHERE instructor_id = ${instructor_id}
        AND scheduled_date = ${scheduled_date}
        AND start_time = ${start_time}::time
        AND status = 'pending'
        AND kind = 'broadcast'
        AND school_id = ${school_id}
        AND id IS DISTINCT FROM ${winnerOfferId}
    `;
  }

  if (losers.length === 0) return { superseded: 0 };

  const loserIds = losers.map(l => l.id);
  await sql`
    UPDATE lesson_offers SET status = 'superseded'
    WHERE id = ANY(${loserIds})
  `;

  // Fan out the "no longer available" message. We fetch phones up front since
  // the offer table doesn't store phone (only email + learner_id).
  const learnerIds = losers.map(l => l.learner_id).filter(Boolean);
  const phones = learnerIds.length > 0
    ? await sql`SELECT id, phone FROM learner_users WHERE id = ANY(${learnerIds})`
    : [];
  const phoneById = {};
  for (const p of phones) phoneById[p.id] = p.phone;

  const dateStr = formatDateDisplay(scheduled_date);
  const timeStr = formatTime12(start_time);
  const followUpText = `Sorry — the ${timeStr} slot on ${dateStr} is no longer available!`;

  const mailer = createTransporter();

  for (const l of losers) {
    const phone = l.learner_id ? phoneById[l.learner_id] : null;
    if (phone) {
      sendWhatsApp(phone, followUpText)
        .catch(err => console.warn('broadcast follow-up WA failed:', err.message));
    }
    if (l.learner_email) {
      mailer.sendMail({
        from:    'CoachCarter <bookings@coachcarter.uk>',
        to:      l.learner_email,
        subject: `That ${timeStr} slot is no longer available`,
        html: `
          <h2>Sorry — that slot has gone</h2>
          <p>The ${timeStr} slot on ${dateStr} is no longer available.</p>
          <p style="font-size:0.85rem;color:#888">You received this because we'd offered you the slot. We'll let you know when another one matches your availability.</p>
        `
      }).catch(err => console.warn('broadcast follow-up email failed:', err.message));
    }
  }

  return { superseded: losers.length };
}

module.exports = { notifyAvailableLearners, supersedeBroadcastSiblings };
