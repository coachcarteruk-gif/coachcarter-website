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
const jwt    = require('jsonwebtoken');
const { neon } = require('@neondatabase/serverless');
const { reportError } = require('./_error-alert');
const { safeEqual, verifyCronAuth, SESSION_COOKIE_NAMES, SESSION_MAX_AGE_SEC, buildSessionCookie } = require('./_auth');
const { buildCsrfCookie, mintCsrfToken, appendSetCookie } = require('./_csrf');

function setCors(res) {
}

module.exports = async (req, res) => {
  setCors(res);
  const action = req.query.action;
  if (action === 'get-offer')      return handleGetOffer(req, res);
  if (action === 'accept-offer')   return handleAcceptOffer(req, res);
  if (action === 'expire-offers')  return handleExpireOffers(req, res);

  return res.status(400).json({ error: 'Unknown action' });
};

// ── Shared: find or create a learner by email/phone ─────────────────────────
// Handles phone format mismatches and unique constraint races gracefully.
async function findOrCreateLearner(sql, email, details, schoolId) {
  // Normalize phone: strip spaces/dashes, convert 07→+447
  let cleanPhone = (details.phone || '').replace(/[\s\-()]/g, '');
  if (cleanPhone.startsWith('07') && cleanPhone.length === 11) cleanPhone = '+44' + cleanPhone.slice(1);
  else if (cleanPhone.startsWith('7') && cleanPhone.length === 10) cleanPhone = '+44' + cleanPhone;
  else if (cleanPhone.startsWith('44') && cleanPhone.length >= 12 && !cleanPhone.startsWith('+')) cleanPhone = '+' + cleanPhone;
  if (!cleanPhone) cleanPhone = null;

  // 1. Try email match
  let [existing] = await sql`
    SELECT id FROM learner_users WHERE LOWER(email) = LOWER(${email})
  `;

  // 2. Try phone match (both raw and normalized)
  if (!existing && cleanPhone) {
    [existing] = await sql`
      SELECT id FROM learner_users WHERE phone = ${cleanPhone} OR phone = ${details.phone}
    `;
  }

  // 3. Found → update missing fields, return
  if (existing) {
    await sql`
      UPDATE learner_users SET
        name = COALESCE(NULLIF(name, ''), ${details.name || null}),
        phone = COALESCE(phone, ${cleanPhone}),
        email = COALESCE(email, ${email}),
        pickup_address = COALESCE(NULLIF(pickup_address, ''), ${details.pickup_address || null})
      WHERE id = ${existing.id}
    `;
    return existing.id;
  }

  // 4. Insert new learner
  try {
    const [row] = await sql`
      INSERT INTO learner_users (name, email, phone, pickup_address, balance_minutes, credit_balance, school_id)
      VALUES (${details.name}, ${email}, ${cleanPhone}, ${details.pickup_address || null}, 0, 0, ${schoolId})
      RETURNING id
    `;
    return row.id;
  } catch (err) {
    if (!err.message?.includes('unique') && !err.message?.includes('duplicate')) throw err;

    // Race condition or format mismatch — find whichever account conflicted
    const [byEmail] = await sql`SELECT id FROM learner_users WHERE LOWER(email) = LOWER(${email})`;
    if (byEmail) return byEmail.id;

    if (cleanPhone) {
      const [byPhone] = await sql`SELECT id FROM learner_users WHERE phone = ${cleanPhone} OR phone = ${details.phone}`;
      if (byPhone) return byPhone.id;
    }

    // Phone conflict but different email — insert without phone
    const [row] = await sql`
      INSERT INTO learner_users (name, email, pickup_address, balance_minutes, credit_balance, school_id)
      VALUES (${details.name}, ${email}, ${details.pickup_address || null}, 0, 0, ${schoolId})
      RETURNING id
    `;
    return row.id;
  }
}

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
      SELECT o.id, o.learner_email, o.learner_id, o.learner_name AS offer_learner_name,
             o.scheduled_date::text,
             o.start_time::text, o.end_time::text, o.status, o.expires_at,
             o.discount_pct, o.offer_price_pence,
             lt.name AS lesson_type_name, lt.duration_minutes, lt.price_pence,
             i.name AS instructor_name, i.school_id AS instructor_school_id,
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
    // Prefer offer's own learner_name, fall back to joined learner_users name
    const resolvedName = offer.offer_learner_name || offer.learner_name || '';
    const needsDetails = !resolvedName || !offer.learner_phone || !offer.learner_pickup_address;
    const isFlexible = !offer.scheduled_date && !offer.start_time;
    const originalPricePence = offer.price_pence || 8250;

    // offer_price_pence (custom price) takes precedence over discount_pct
    let finalPricePence;
    if (offer.offer_price_pence != null) {
      finalPricePence = offer.offer_price_pence;
    } else {
      const discountPct = offer.discount_pct || 0;
      finalPricePence = Math.round(originalPricePence * (100 - discountPct) / 100);
    }

    return res.json({
      ok: true,
      offer: {
        id: offer.id,
        scheduled_date: offer.scheduled_date || null,
        start_time: offer.start_time || null,
        end_time: offer.end_time || null,
        expires_at: offer.expires_at,
        instructor_name: offer.instructor_name,
        lesson_type_name: offer.lesson_type_name || 'Standard Lesson',
        duration_minutes: offer.duration_minutes || 90,
        price_pence: finalPricePence,
        original_price_pence: originalPricePence,
        is_flexible: isFlexible,
        learner_email: offer.learner_email,
        learner_name: resolvedName,
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

  const { token, name, phone, pickup_address, email } = req.body;
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

    // Resolve learner email: offer's email takes priority, fall back to form input
    const resolvedEmail = offer.learner_email || (email ? email.trim().toLowerCase() : null);
    if (!resolvedEmail)
      return res.status(400).json({ error: 'Email address is required' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(resolvedEmail))
      return res.status(400).json({ error: 'Invalid email address' });

    // Derive school_id from instructor
    const [instrRow] = await sql`SELECT school_id FROM instructors WHERE id = ${offer.instructor_id}`;
    const schoolId = instrRow?.school_id || 1;

    const isFlexible = !offer.scheduled_date && !offer.start_time;
    const originalPricePence = offer.price_pence || 8250;

    // offer_price_pence (custom price) takes precedence over discount_pct
    let pricePence;
    if (offer.offer_price_pence != null) {
      pricePence = offer.offer_price_pence;
    } else {
      const discountPct = offer.discount_pct || 0;
      pricePence = Math.round(originalPricePence * (100 - discountPct) / 100);
    }

    const durationMins = offer.duration_minutes || 90;
    const durationStr = durationMins >= 60
      ? (durationMins % 60 === 0 ? `${durationMins / 60} hour${durationMins / 60 !== 1 ? 's' : ''}` : `${(durationMins / 60).toFixed(1)} hours`)
      : `${durationMins} mins`;

    const lessonDate = offer.scheduled_date
      ? new Date(offer.scheduled_date + 'T00:00:00Z')
          .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
      : null;

    const baseUrl = process.env.BASE_URL || 'https://coachcarter.uk';

    // Free offer → skip Stripe, confirm directly (only for slot-pinned offers)
    if (pricePence === 0 && !isFlexible) {
      return await handleFreeOffer(sql, offer, { name: name.trim(), phone: (phone || '').trim(), pickup_address: (pickup_address || '').trim() }, baseUrl, token, res, resolvedEmail);
    }

    // Flexible + free → create/find learner, add credit, redirect to success
    if (pricePence === 0 && isFlexible) {
      const { createTransporter } = require('./_auth-helpers');
      const learnerDetails = { name: name.trim(), phone: (phone || '').trim(), pickup_address: (pickup_address || '').trim() };

      const learnerId = await findOrCreateLearner(sql, resolvedEmail, learnerDetails, schoolId);

      // Auto-login: set learner session cookie so they can use credits on the booking page
      const secret = process.env.JWT_SECRET;
      if (secret) {
        const jwtToken = jwt.sign(
          { id: learnerId, email: resolvedEmail, role: 'learner', school_id: schoolId },
          secret,
          { expiresIn: '30d' }
        );
        appendSetCookie(res, buildSessionCookie(SESSION_COOKIE_NAMES.learner, jwtToken, SESSION_MAX_AGE_SEC.learner));
        appendSetCookie(res, buildCsrfCookie(mintCsrfToken()));
      }

      // 2. Add credit to learner balance
      await sql`
        UPDATE learner_users
        SET credit_balance = credit_balance + 1,
            balance_minutes = balance_minutes + ${durationMins}
        WHERE id = ${learnerId}
      `;

      // 3. Mark offer accepted
      await sql`
        UPDATE lesson_offers SET status = 'accepted', learner_id = ${learnerId}, accepted_at = NOW()
        WHERE id = ${offer.id}
      `;

      // 4. Send confirmation email
      try {
        const transporter = createTransporter();
        const firstName = (learnerDetails.name || '').split(' ')[0] || 'there';
        await transporter.sendMail({
          from: 'CoachCarter <bookings@coachcarter.uk>',
          to: resolvedEmail,
          subject: `Free lesson credit added — book your ${durationStr} lesson`,
          html: `
            <h1>Free lesson credit added!</h1>
            <p>Hi ${firstName}, your free ${durationStr} lesson credit from ${offer.instructor_name} is ready.</p>
            <p><strong>Next step:</strong> Log in and pick a time that works for you.</p>
            <p><a href="${baseUrl}/learner/book.html" style="display:inline-block;padding:12px 24px;background:#f58321;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;">Book your lesson</a></p>
          `
        });
      } catch (emailErr) {
        console.error('Free flexible offer email failed:', emailErr);
      }

      return res.json({
        ok: true,
        url: `${baseUrl}/offer-success.html?token=${token}&flexible=1&free=1&iid=${offer.instructor_id}${offer.lesson_type_id ? '&ltid=' + offer.lesson_type_id : ''}&dur=${durationMins}&iname=${encodeURIComponent(offer.instructor_name)}`,
        flexible_accepted: true,
        learner_session: { id: learnerId, name: learnerDetails.name, email: resolvedEmail, school_id: schoolId }
      });
    }

    // Build Stripe Checkout label
    let priceLabel;
    if (isFlexible) {
      priceLabel = `${offer.lesson_type_name || 'Standard Lesson'} — flexible time`;
    } else {
      priceLabel = `${offer.lesson_type_name || 'Standard Lesson'} — ${lessonDate} ${offer.start_time}–${offer.end_time}`;
    }

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
        learner_email:     resolvedEmail,
        learner_name:      name.trim(),
        learner_phone:     (phone || '').trim(),
        pickup_address:    (pickup_address || '').trim(),
        scheduled_date:    offer.scheduled_date || '',
        start_time:        offer.start_time || '',
        end_time:          offer.end_time || '',
        lesson_type_id:    String(offer.lesson_type_id || ''),
        duration_minutes:  String(durationMins),
        amount_pence:      String(pricePence),
        school_id:         String(schoolId),
        is_flexible:       isFlexible ? '1' : '0'
      },
      customer_email: resolvedEmail,
      billing_address_collection: 'required',
      allow_promotion_codes: true,
      success_url: isFlexible
        ? `${baseUrl}/offer-success.html?token=${token}&flexible=1&iid=${offer.instructor_id}${offer.lesson_type_id ? '&ltid=' + offer.lesson_type_id : ''}&dur=${durationMins}&iname=${encodeURIComponent(offer.instructor_name)}`
        : `${baseUrl}/offer-success.html?token=${token}`,
      cancel_url:  `${baseUrl}/accept-offer.html?token=${token}&cancelled=1`
    });

    // Store Stripe session ID on the offer
    await sql`
      UPDATE lesson_offers SET stripe_session_id = ${session.id}
      WHERE id = ${offer.id}
    `;

    return res.json({ ok: true, url: session.url });
  } catch (err) {
    console.error('accept-offer error:', err.message, err.stack);
    reportError('/api/offers', err);
    return res.status(500).json({ error: 'Failed to create checkout', details: err.message || 'Internal server error' });
  }
}

// ── Free offer handler (100% discount — no Stripe) ───────────────────────────
// Creates learner + booking directly without payment.
async function handleFreeOffer(sql, offer, learnerDetails, baseUrl, token, res, resolvedEmail) {
  const { createTransporter } = require('./_auth-helpers');
  const durationMins = offer.duration_minutes || 90;

  // Derive school_id from instructor
  const [instrRow] = await sql`SELECT school_id FROM instructors WHERE id = ${offer.instructor_id}`;
  const schoolId = instrRow?.school_id || 1;

  const learnerId = await findOrCreateLearner(sql, resolvedEmail, learnerDetails, schoolId);

  // Auto-login: set learner session cookie
  const secret = process.env.JWT_SECRET;
  if (secret) {
    const jwtToken = jwt.sign(
      { id: learnerId, email: resolvedEmail, role: 'learner', school_id: schoolId },
      secret,
      { expiresIn: '30d' }
    );
    appendSetCookie(res, buildSessionCookie(SESSION_COOKIE_NAMES.learner, jwtToken, SESSION_MAX_AGE_SEC.learner));
    appendSetCookie(res, buildCsrfCookie(mintCsrfToken()));
  }

  // 2. Create booking directly (free — no credit transaction)
  let booking;
  try {
    const [b] = await sql`
      INSERT INTO lesson_bookings
        (learner_id, instructor_id, scheduled_date, start_time, end_time, status,
         created_by, payment_method, lesson_type_id, minutes_deducted,
         pickup_address, school_id)
      VALUES
        (${learnerId}, ${offer.instructor_id}, ${offer.scheduled_date}, ${offer.start_time}, ${offer.end_time}, 'confirmed',
         'instructor_offer', 'free', ${offer.lesson_type_id}, 0,
         ${learnerDetails.pickup_address || null}, ${schoolId})
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
      to: resolvedEmail,
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
  return res.json({
    ok: true,
    url: `${baseUrl}/offer-success.html?token=${token}`,
    learner_session: { id: learnerId, name: learnerDetails.name, email: resolvedEmail, school_id: schoolId }
  });
}

// ── POST /api/offers?action=expire-offers ─────────────────────────────────────
// Cron-triggered: bulk-expire stale pending offers.
async function handleExpireOffers(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Fail-closed cron auth using the shared helper (Authorization: Bearer
  // or ?key=). Matches cron-retention.js / cron-payouts.js. Previously
  // accepted the spoofable `x-vercel-cron` header as a bypass — removed.
  if (!verifyCronAuth(req)) {
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
