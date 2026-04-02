// Public lesson offer endpoints (no auth required — token-based access)
//
// Routes:
//   GET  /api/offers?action=get-offer&token=TOKEN
//     → returns offer details for the accept page
//
//   POST /api/offers?action=accept-offer
//     → collects learner details, creates Stripe checkout, returns URL
//
//   POST /api/offers?action=expire-offers
//     → cron-triggered: bulk-expire stale pending offers

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { neon } = require('@neondatabase/serverless');
const { reportError } = require('./_error-alert');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const action = req.query.action;
  if (action === 'get-offer')      return handleGetOffer(req, res);
  if (action === 'accept-offer')   return handleAcceptOffer(req, res);
  if (action === 'expire-offers')  return handleExpireOffers(req, res);

  return res.status(400).json({ error: 'Unknown action' });
};

// ── GET /api/offers?action=get-offer&token=TOKEN ──────────────────────────────
// Public — returns offer details for the accept page.
async function handleGetOffer(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = req.query.token;
  if (!token) return res.status(400).json({ error: 'Token is required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Lazy-expire stale offers
    await sql`
      UPDATE lesson_offers SET status = 'expired'
      WHERE status = 'pending' AND expires_at <= NOW()
    `;

    const [offer] = await sql`
      SELECT o.id, o.learner_email, o.learner_id, o.scheduled_date::text,
             o.start_time::text, o.end_time::text, o.status, o.expires_at,
             o.discount_pct,
             lt.name AS lesson_type_name, lt.duration_minutes, lt.price_pence,
             i.name AS instructor_name,
             lu.name AS learner_name, lu.phone AS learner_phone,
             lu.pickup_address AS learner_pickup_address
      FROM lesson_offers o
      JOIN instructors i ON i.id = o.instructor_id
      LEFT JOIN lesson_types lt ON lt.id = o.lesson_type_id
      LEFT JOIN learner_users lu ON lu.id = o.learner_id
      WHERE o.token = ${token}
    `;

    if (!offer)
      return res.status(404).json({ error: true, code: 'NOT_FOUND', message: 'Offer not found' });

    if (offer.status === 'expired')
      return res.status(410).json({ error: true, code: 'EXPIRED', message: 'This offer has expired' });

    if (offer.status === 'accepted')
      return res.status(410).json({ error: true, code: 'ALREADY_ACCEPTED', message: 'This offer has already been accepted' });

    if (offer.status === 'cancelled')
      return res.status(410).json({ error: true, code: 'CANCELLED', message: 'This offer has been cancelled' });

    // Determine what details the learner still needs to provide
    const needsDetails = !offer.learner_name || !offer.learner_phone || !offer.learner_pickup_address;
    const originalPricePence = offer.price_pence || 8250;
    const discountPct = offer.discount_pct || 0;
    const finalPricePence = Math.round(originalPricePence * (100 - discountPct) / 100);

    return res.json({
      ok: true,
      offer: {
        id: offer.id,
        scheduled_date: offer.scheduled_date,
        start_time: offer.start_time,
        end_time: offer.end_time,
        expires_at: offer.expires_at,
        instructor_name: offer.instructor_name,
        lesson_type_name: offer.lesson_type_name || 'Standard Lesson',
        duration_minutes: offer.duration_minutes || 90,
        price_pence: finalPricePence,
        original_price_pence: originalPricePence,
        discount_pct: discountPct,
        learner_email: offer.learner_email,
        learner_name: offer.learner_name || '',
        learner_phone: offer.learner_phone || '',
        learner_pickup_address: offer.learner_pickup_address || '',
        needs_details: needsDetails
      }
    });
  } catch (err) {
    console.error('get-offer error:', err);
    reportError('/api/offers', err);
    return res.status(500).json({ error: 'Failed to load offer' });
  }
}

// ── POST /api/offers?action=accept-offer ──────────────────────────────────────
// Body: { token, name, phone, pickup_address }
// Creates a Stripe Checkout session for the offer.
async function handleAcceptOffer(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token, name, phone, pickup_address } = req.body;
  if (!token) return res.status(400).json({ error: 'Token is required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Lazy-expire stale offers
    await sql`
      UPDATE lesson_offers SET status = 'expired'
      WHERE status = 'pending' AND expires_at <= NOW()
    `;

    // Fetch the offer with full details
    const [offer] = await sql`
      SELECT o.*, lt.name AS lesson_type_name, lt.duration_minutes, lt.price_pence,
             i.name AS instructor_name
      FROM lesson_offers o
      JOIN instructors i ON i.id = o.instructor_id
      LEFT JOIN lesson_types lt ON lt.id = o.lesson_type_id
      WHERE o.token = ${token} AND o.status = 'pending' AND o.expires_at > NOW()
    `;

    if (!offer)
      return res.status(404).json({ error: true, code: 'NOT_FOUND', message: 'Offer not found, expired, or already accepted' });

    // Validate required details
    if (!name || !name.trim())
      return res.status(400).json({ error: 'Name is required' });

    const originalPricePence = offer.price_pence || 8250;
    const discountPct = offer.discount_pct || 0;
    const pricePence = Math.round(originalPricePence * (100 - discountPct) / 100);
    const durationMins = offer.duration_minutes || 90;
    const durationStr = durationMins >= 60
      ? (durationMins % 60 === 0 ? `${durationMins / 60} hour${durationMins / 60 !== 1 ? 's' : ''}` : `${(durationMins / 60).toFixed(1)} hours`)
      : `${durationMins} mins`;

    const lessonDate = new Date(offer.scheduled_date + 'T00:00:00Z')
      .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

    const baseUrl = process.env.BASE_URL || 'https://coachcarter.uk';

    // 100% discount → skip Stripe, confirm directly
    if (pricePence === 0) {
      return await handleFreeOffer(sql, offer, { name: name.trim(), phone: (phone || '').trim(), pickup_address: (pickup_address || '').trim() }, baseUrl, token, res);
    }

    // Create Stripe Checkout session
    const priceLabel = discountPct > 0
      ? `${offer.lesson_type_name || 'Standard Lesson'} — ${lessonDate} ${offer.start_time}–${offer.end_time} (${discountPct}% off)`
      : `${offer.lesson_type_name || 'Standard Lesson'} — ${lessonDate} ${offer.start_time}–${offer.end_time}`;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card', 'klarna'],
      line_items: [{
        price_data: {
          currency: 'gbp',
          unit_amount: pricePence,
          product_data: {
            name: priceLabel,
            description: `${durationStr} driving lesson with ${offer.instructor_name}`
          }
        },
        quantity: 1
      }],
      metadata: {
        payment_type:      'lesson_offer',
        offer_token:       token,
        offer_id:          String(offer.id),
        instructor_id:     String(offer.instructor_id),
        instructor_name:   offer.instructor_name,
        learner_email:     offer.learner_email,
        learner_name:      name.trim(),
        learner_phone:     (phone || '').trim(),
        pickup_address:    (pickup_address || '').trim(),
        scheduled_date:    offer.scheduled_date,
        start_time:        offer.start_time,
        end_time:          offer.end_time,
        lesson_type_id:    String(offer.lesson_type_id || ''),
        duration_minutes:  String(durationMins),
        amount_pence:      String(pricePence)
      },
      customer_email: offer.learner_email,
      billing_address_collection: 'required',
      allow_promotion_codes: true,
      success_url: `${baseUrl}/offer-success.html?token=${token}`,
      cancel_url:  `${baseUrl}/accept-offer.html?token=${token}&cancelled=1`
    });

    // Store Stripe session ID on the offer
    await sql`
      UPDATE lesson_offers SET stripe_session_id = ${session.id}
      WHERE id = ${offer.id}
    `;

    return res.json({ ok: true, url: session.url });
  } catch (err) {
    console.error('accept-offer error:', err);
    reportError('/api/offers', err);
    return res.status(500).json({ error: 'Failed to create checkout', details: err.message });
  }
}

// ── Free offer handler (100% discount — no Stripe) ───────────────────────────
// Creates learner + booking directly without payment.
async function handleFreeOffer(sql, offer, learnerDetails, baseUrl, token, res) {
  const { createTransporter } = require('./_auth-helpers');
  const durationMins = offer.duration_minutes || 90;

  // 1. Find or create learner
  let learnerId;
  const [existingLearner] = await sql`
    SELECT id, name, phone, pickup_address FROM learner_users WHERE LOWER(email) = LOWER(${offer.learner_email})
  `;

  if (existingLearner) {
    learnerId = existingLearner.id;
    await sql`
      UPDATE learner_users SET
        name = COALESCE(NULLIF(name, ''), ${learnerDetails.name || null}),
        phone = COALESCE(phone, ${learnerDetails.phone || null}),
        pickup_address = COALESCE(NULLIF(pickup_address, ''), ${learnerDetails.pickup_address || null})
      WHERE id = ${learnerId}
    `;
  } else {
    try {
      const [newLearner] = await sql`
        INSERT INTO learner_users (name, email, phone, pickup_address, balance_minutes, credit_balance)
        VALUES (${learnerDetails.name}, ${offer.learner_email.toLowerCase()}, ${learnerDetails.phone || null},
                ${learnerDetails.pickup_address || null}, 0, 0)
        RETURNING id
      `;
      learnerId = newLearner.id;
    } catch (insertErr) {
      if (insertErr.message?.includes('learner_users_phone_key') || insertErr.message?.includes('unique')) {
        const [newLearner] = await sql`
          INSERT INTO learner_users (name, email, pickup_address, balance_minutes, credit_balance)
          VALUES (${learnerDetails.name}, ${offer.learner_email.toLowerCase()}, ${learnerDetails.pickup_address || null}, 0, 0)
          RETURNING id
        `;
        learnerId = newLearner.id;
      } else {
        throw insertErr;
      }
    }
  }

  // 2. Create booking directly (free — no credit transaction)
  let booking;
  try {
    const [b] = await sql`
      INSERT INTO lesson_bookings
        (learner_id, instructor_id, scheduled_date, start_time, end_time, status,
         created_by, payment_method, lesson_type_id, minutes_deducted,
         pickup_address)
      VALUES
        (${learnerId}, ${offer.instructor_id}, ${offer.scheduled_date}, ${offer.start_time}, ${offer.end_time}, 'confirmed',
         'instructor_offer', 'free', ${offer.lesson_type_id}, 0,
         ${learnerDetails.pickup_address || null})
      RETURNING id, scheduled_date, start_time::text, end_time::text
    `;
    booking = b;
  } catch (insertErr) {
    if (insertErr.message?.includes('uq_booking_slot')) {
      return res.status(409).json({ error: true, code: 'SLOT_TAKEN', message: 'Sorry, that slot has been taken.' });
    }
    throw insertErr;
  }

  // 3. Update offer
  await sql`
    UPDATE lesson_offers
    SET status = 'accepted', booking_id = ${booking.id}, learner_id = ${learnerId}, accepted_at = NOW()
    WHERE id = ${offer.id}
  `;

  // 4. Send confirmation emails
  const [instructor] = await sql`SELECT name, email FROM instructors WHERE id = ${offer.instructor_id}`;
  const durationStr = durationMins >= 60
    ? (durationMins % 60 === 0 ? `${durationMins / 60} hour${durationMins / 60 !== 1 ? 's' : ''}` : `${(durationMins / 60).toFixed(1)} hours`)
    : `${durationMins} mins`;
  const lessonDate = new Date(offer.scheduled_date + 'T00:00:00Z')
    .toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

  try {
    const transporter = createTransporter();
    const firstName = (learnerDetails.name || '').split(' ')[0] || 'there';

    await transporter.sendMail({
      from: 'CoachCarter <bookings@coachcarter.uk>',
      to: offer.learner_email,
      subject: `Free lesson confirmed — ${lessonDate} at ${offer.start_time}`,
      html: `
        <h1>Lesson confirmed!</h1>
        <p>Hi ${firstName}, your free lesson is booked.</p>
        <table>
          <tr><td><strong>Date:</strong></td><td>${lessonDate}</td></tr>
          <tr><td><strong>Time:</strong></td><td>${offer.start_time} – ${offer.end_time}</td></tr>
          <tr><td><strong>Instructor:</strong></td><td>${offer.instructor_name}</td></tr>
          <tr><td><strong>Duration:</strong></td><td>${durationStr}</td></tr>
          <tr><td><strong>Price:</strong></td><td>FREE</td></tr>
        </table>
        <p><a href="${baseUrl}/learner/" style="background:#f58321;color:white;padding:12px 24px;text-decoration:none;border-radius:8px;display:inline-block;font-weight:bold">View my bookings →</a></p>
      `
    });

    if (instructor?.email) {
      await transporter.sendMail({
        from: 'CoachCarter <system@coachcarter.uk>',
        to: instructor.email,
        subject: `Free offer accepted — ${learnerDetails.name} on ${lessonDate}`,
        html: `
          <h2>Free lesson offer accepted!</h2>
          <p>${learnerDetails.name} has accepted your free lesson offer.</p>
          <table>
            <tr><td><strong>Learner:</strong></td><td>${learnerDetails.name}</td></tr>
            <tr><td><strong>Date:</strong></td><td>${lessonDate}</td></tr>
            <tr><td><strong>Time:</strong></td><td>${offer.start_time} – ${offer.end_time}</td></tr>
          </table>
          <p><a href="${baseUrl}/instructor/" style="background:#f58321;color:white;padding:10px 20px;text-decoration:none;border-radius:8px;display:inline-block;font-weight:bold;font-size:0.9rem">View my schedule →</a></p>
        `
      });
    }
  } catch (emailErr) {
    console.error('Free offer email failed:', emailErr);
  }

  // Redirect to success page
  return res.json({ ok: true, url: `${baseUrl}/offer-success.html?token=${token}` });
}

// ── POST /api/offers?action=expire-offers ─────────────────────────────────────
// Cron-triggered: bulk-expire stale pending offers.
async function handleExpireOffers(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Simple cron auth — same pattern as reminders.js
  const secret = req.query.secret || req.headers['x-cron-secret'];
  const cronSecret = process.env.CRON_SECRET || process.env.MIGRATION_SECRET;
  if (secret !== cronSecret && req.headers['x-vercel-cron'] !== '1') {
    return res.status(401).json({ error: 'Unauthorised' });
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const expired = await sql`
      UPDATE lesson_offers SET status = 'expired'
      WHERE status = 'pending' AND expires_at <= NOW()
      RETURNING id, learner_email, scheduled_date::text
    `;

    return res.json({ ok: true, expired_count: expired.length });
  } catch (err) {
    console.error('expire-offers error:', err);
    reportError('/api/offers', err);
    return res.status(500).json({ error: 'Failed to expire offers' });
  }
}
