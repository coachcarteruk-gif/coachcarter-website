// Public lesson offer endpoints (no auth required — token-based access)
//
// Routes:
//   GET  /api/offers?action=get-offer&token=TOKEN
//     → returns offer details for the accept page
//
//   POST /api/offers?action=accept-offer
//     → collects learner details, creates Stripe checkout, returns URL
//
//   GET  /api/offers?action=expire-offers  (CRON_SECRET auth)
//     → cron-triggered: bulk-expire stale pending offers

const crypto = require('crypto');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const jwt    = require('jsonwebtoken');
const { neon } = require('@neondatabase/serverless');
const { reportError } = require('./_error-alert');
const { withCronLock } = require('./_cron-lock');
const { safeEqual, verifyCronAuth, SESSION_COOKIE_NAMES, SESSION_MAX_AGE_SEC, buildSessionCookie } = require('./_auth');
const { buildCsrfCookie, mintCsrfToken, appendSetCookie } = require('./_csrf');
const { SCHEDULED, BLOCKING_STATUSES } = require('./_booking-status');
const { allocate } = require('./_pence-allocator');
const { lockBalanceAndMutate } = require('./_credit-grant');
const { CHECKOUT_EXCLUDED_PAYMENT_METHOD_TYPES } = require('./_stripe-payment-methods');

function dateOnly(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Series fan-out for offer-driven weekly repeats (May 2026)
// ─────────────────────────────────────────────────────────────────────────────
// Walks weekly from `firstDate` and books up to `repeatWeeks` lessons at the
// same day-of-week / time. Skips any week the instructor isn't available
// (existing booking, blackout, no availability window for that DoW) and rolls
// to the next free week. Search is bounded to 18 weeks past `firstDate` —
// matches the offer's maximum so we never search beyond what the instructor
// agreed to.
//
// Returns { booked: [{ date, booking_id }...], skipped: [{ date, reason }...] }.
// The first week is always week 0; if that's clashed, the offer caller has
// already set status=cancelled and refunded — this helper assumes the first
// week is bookable (it's been held by the offer until now).
async function bookOfferSeries(sql, {
  instructorId, learnerId, firstDate, startTime, endTime, lessonTypeId,
  durationMins, pickupAddress, schoolId, repeatWeeks, paymentMethod,
  totalStripeFeePence = null,
  // Step 1b: per-booking list-price snapshot. Callers supply the per-lesson
  // price (already divided across the series) and the provenance tag.
  // Paid offers tag 'stripe_metadata' (price was frozen in Stripe metadata at
  // offer creation); free offers tag 'live_compute_insert' with value 0.
  listPricePerBookingPence = null,
  listPriceSource = null
}) {
  const SERIES_LOOKAHEAD_WEEKS = 18;
  const seriesId = repeatWeeks > 1 ? crypto.randomUUID() : null;
  const firstDateText = dateOnly(firstDate);
  if (!firstDateText) throw new Error(`Invalid offer firstDate: ${firstDate}`);

  // Day-of-week (0=Sun..6=Sat) of the first slot — must match every week.
  const firstDateObj = new Date(firstDateText + 'T00:00:00Z');
  const dow = firstDateObj.getUTCDay();

  // Pull instructor's availability for this DoW (any window covering the slot).
  const availability = await sql`
    SELECT start_time::text AS start_time, end_time::text AS end_time
    FROM instructor_availability
    WHERE instructor_id = ${instructorId}
      AND day_of_week = ${dow}
      AND active = true
  `;
  const slotStartM = parseInt(startTime.slice(0,2),10)*60 + parseInt(startTime.slice(3,5),10);
  const slotEndM   = parseInt(endTime.slice(0,2),10)*60 + parseInt(endTime.slice(3,5),10);
  const dowCoversSlot = availability.some(w => {
    const ws = parseInt(w.start_time.slice(0,2),10)*60 + parseInt(w.start_time.slice(3,5),10);
    const we = parseInt(w.end_time.slice(0,2),10)*60 + parseInt(w.end_time.slice(3,5),10);
    return ws <= slotStartM && we >= slotEndM;
  });

  // If the instructor doesn't even cover this DoW/time in their normal
  // availability, only book the first lesson (it was the offered slot — they
  // chose to make an exception). Skip all repeats.
  const allowRepeats = dowCoversSlot && repeatWeeks > 1;

  // Pull blackout ranges that overlap the search window so we can check each
  // candidate date in memory without hammering the DB.
  const lookaheadEnd = new Date(firstDateObj);
  lookaheadEnd.setUTCDate(lookaheadEnd.getUTCDate() + SERIES_LOOKAHEAD_WEEKS * 7);
  const lookaheadEndStr = lookaheadEnd.toISOString().slice(0, 10);
  const blackouts = await sql`
    SELECT blackout_date::text AS start_date, end_date::text AS end_date
    FROM instructor_blackout_dates
    WHERE instructor_id = ${instructorId}
      AND blackout_date <= ${lookaheadEndStr}
      AND end_date >= ${firstDateText}
  `;
  const isBlackedOut = (dateStr) => blackouts.some(b => dateStr >= b.start_date && dateStr <= b.end_date);

  const fmt = d => d.toISOString().slice(0, 10);
  const booked = [];
  const skipped = [];

  // Walk weeks. We try each week in turn; on clash we move to the next week
  // (still same DoW/time) until we hit either repeatWeeks confirmed bookings
  // or the lookahead boundary.
  let weekOffset = 0;
  while (booked.length < repeatWeeks && weekOffset <= SERIES_LOOKAHEAD_WEEKS) {
    const candidate = new Date(firstDateObj);
    candidate.setUTCDate(candidate.getUTCDate() + weekOffset * 7);
    const candidateStr = fmt(candidate);

    // First lesson is always week 0 — booked unconditionally (the offer held
    // this slot). For later weeks, run the conflict checks.
    let canBook = weekOffset === 0;
    let skipReason = null;

    if (!canBook) {
      if (!allowRepeats) { weekOffset++; continue; }
      if (isBlackedOut(candidateStr)) { skipped.push({ date: candidateStr, reason: 'blackout' }); weekOffset++; continue; }

      const [existing] = await sql`
        SELECT id FROM lesson_bookings
        WHERE instructor_id = ${instructorId}
          AND scheduled_date = ${candidateStr}
          AND start_time = ${startTime}::time
          AND status = ANY(${BLOCKING_STATUSES}::text[])
      `;
      if (existing) { skipped.push({ date: candidateStr, reason: 'already_booked' }); weekOffset++; continue; }

      // A pending lesson request holds this slot — skip the week rather than
      // book over the requesting learner's held payment.
      try {
        const [pendingRequest] = await sql`
          SELECT id FROM lesson_requests
          WHERE instructor_id = ${instructorId}
            AND scheduled_date = ${candidateStr}
            AND start_time = ${startTime}::time
            AND status = 'pending'
            AND expires_at > NOW()
        `;
        if (pendingRequest) { skipped.push({ date: candidateStr, reason: 'pending_request' }); weekOffset++; continue; }
      } catch (e) { /* table may not exist yet */ }

      canBook = true;
    }

    if (canBook) {
      try {
        const [b] = await sql`
          INSERT INTO lesson_bookings
            (learner_id, instructor_id, scheduled_date, start_time, end_time, status,
             created_by, payment_method, lesson_type_id, minutes_deducted,
             pickup_address, series_id, school_id,
             list_price_pence, list_price_source)
          VALUES
            (${learnerId}, ${instructorId}, ${candidateStr}, ${startTime}, ${endTime}, ${SCHEDULED},
             'instructor_offer', ${paymentMethod}, ${lessonTypeId}, ${durationMins},
             ${pickupAddress || null}, ${seriesId}, ${schoolId},
             ${listPricePerBookingPence}, ${listPriceSource})
          RETURNING id
        `;
        booked.push({ date: candidateStr, booking_id: b.id });
      } catch (insertErr) {
        // Race: someone booked the slot between our check and INSERT. Treat as clash.
        if (insertErr.message?.includes('uq_booking_slot') || insertErr.message?.includes('uq_instructor_slot')) {
          if (weekOffset === 0) {
            // First slot lost the race — bubble up so caller can refund/cancel.
            throw insertErr;
          }
          skipped.push({ date: candidateStr, reason: 'race' });
        } else {
          throw insertErr;
        }
      }
    }

    weekOffset++;
  }

  // Step 4f.c — attribute the charge's Stripe fee across the booked lessons.
  // The fee was on the FULL charge (amountPence × repeatWeeks). We split it
  // into `repeatWeeks` equal pence shares via the shared pence allocator
  // (Hamilton/largest-remainder, lowest-index tie-break) and write the first
  // `booked.length` shares onto the booked lessons. The remaining shares are
  // platform-absorbed orphan — Stripe kept its cut on the partial refund
  // (Decision 3).
  //
  // Why the shared allocator: Step 4g's FIFO fee math uses the same helper,
  // so the rounding rule has to be identical here. Two allocators in the
  // same pipeline would not reconcile pence-exactly on cross-source refunds.
  if (totalStripeFeePence != null && booked.length > 0) {
    const perWeekShares = allocate(totalStripeFeePence, new Array(repeatWeeks).fill(1));
    for (let i = 0; i < booked.length; i++) {
      const feeForThis = perWeekShares[i];
      await sql`
        UPDATE lesson_bookings
           SET stripe_fee_pence = ${feeForThis},
               stripe_fee_source = 'balance_transaction'
         WHERE id = ${booked[i].booking_id}
      `;
    }
  }

  return { booked, skipped, series_id: seriesId };
}


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

// Exposed for api/webhook.js handleOfferBooking — see top of file for behaviour.
module.exports.bookOfferSeries = bookOfferSeries;

// ── Shared: find or create a learner by email/phone ─────────────────────────
// Handles phone format mismatches and unique constraint races gracefully.
async function findOrCreateLearner(sql, email, details, schoolId) {
  const preferredLearnerId = parseInt(details.learner_id, 10);
  if (preferredLearnerId) {
    const [bound] = await sql`
      SELECT id FROM learner_users
      WHERE id = ${preferredLearnerId}
        AND school_id = ${schoolId}
    `;
    if (bound) return bound.id;
  }

  // Normalize phone: strip spaces/dashes, convert 07→+447
  let cleanPhone = (details.phone || '').replace(/[\s\-()]/g, '');
  if (cleanPhone.startsWith('07') && cleanPhone.length === 11) cleanPhone = '+44' + cleanPhone.slice(1);
  else if (cleanPhone.startsWith('7') && cleanPhone.length === 10) cleanPhone = '+44' + cleanPhone;
  else if (cleanPhone.startsWith('44') && cleanPhone.length >= 12 && !cleanPhone.startsWith('+')) cleanPhone = '+' + cleanPhone;
  if (!cleanPhone) cleanPhone = null;

  // 1. Try email match — scoped to this school. Without the school filter
  // an offer for fred@example.com would attach to whichever school happened
  // to have that email first, even if a learner with the same email also
  // exists under another school.
  let [existing] = await sql`
    SELECT id FROM learner_users
    WHERE LOWER(email) = LOWER(${email})
      AND school_id = ${schoolId}
  `;

  // 2. Try phone match (both raw and normalized) — same school
  if (!existing && cleanPhone) {
    [existing] = await sql`
      SELECT id FROM learner_users
      WHERE (phone = ${cleanPhone} OR phone = ${details.phone})
        AND school_id = ${schoolId}
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
    // (still scoped to this school — same reasoning as the lookups above)
    const [byEmail] = await sql`
      SELECT id FROM learner_users
      WHERE LOWER(email) = LOWER(${email}) AND school_id = ${schoolId}
    `;
    if (byEmail) return byEmail.id;

    if (cleanPhone) {
      const [byPhone] = await sql`
        SELECT id FROM learner_users
        WHERE (phone = ${cleanPhone} OR phone = ${details.phone})
          AND school_id = ${schoolId}
      `;
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
             o.discount_pct, o.offer_price_pence, o.max_repeat_weeks,
             o.kind, o.trigger,
             lt.name AS lesson_type_name, lt.slug AS lesson_type_slug, lt.duration_minutes, lt.price_pence,
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

    if (offer.status === 'accepted') {
      // Minimal payload for the offer-success.html post-payment auth gate
      // (a guest who just paid needs the learner_email to set a password).
      // Leaves status at 410 + code=ALREADY_ACCEPTED so existing callers that
      // only check `code` keep working unchanged. Slot details included so the
      // success page can render the confirmation card for slot-pinned offers
      // (free or paid) without an extra round-trip.
      return res.status(410).json({
        error: true,
        code: 'ALREADY_ACCEPTED',
        message: 'This offer has already been accepted',
        offer: {
          id: offer.id,
          learner_email: offer.learner_email,
          instructor_name: offer.instructor_name,
          duration_minutes: offer.duration_minutes || 90,
          is_flexible: !offer.scheduled_date && !offer.start_time,
          scheduled_date: offer.scheduled_date || null,
          start_time: offer.start_time || null,
          end_time: offer.end_time || null,
        }
      });
    }

    if (offer.status === 'cancelled')
      return res.status(410).json({ error: true, code: 'CANCELLED', message: 'This offer has been cancelled' });

    // Broadcast offer where another learner won the race.
    if (offer.status === 'superseded')
      return res.status(410).json({ error: true, code: 'SUPERSEDED', message: 'Sorry — that slot is no longer available!' });

    // Determine what details the learner still needs to provide
    // Prefer offer's own learner_name, fall back to joined learner_users name
    const resolvedName = offer.offer_learner_name || offer.learner_name || '';
    const needsDetails = !resolvedName || !offer.learner_phone || !offer.learner_pickup_address;
    const isFlexible = !offer.scheduled_date && !offer.start_time;
    const isTrialOffer = offer.lesson_type_slug === 'trial';
    const originalPricePence = offer.price_pence ?? 8250;

    // offer_price_pence is the frozen final price for new offers. Since this
    // first slice deliberately does not store base/source columns, only legacy
    // null-price offers expose a lesson-type "original" price for was/now UI.
    let finalPricePence;
    let displayOriginalPricePence = originalPricePence;
    if (isTrialOffer) {
      finalPricePence = 0;
      displayOriginalPricePence = 0;
    } else if (offer.offer_price_pence != null) {
      finalPricePence = offer.offer_price_pence;
      displayOriginalPricePence = finalPricePence;
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
        original_price_pence: displayOriginalPricePence,
        discount_pct: offer.discount_pct || 0,
        kind: offer.kind || 'manual',
        trigger: offer.trigger || null,
        max_repeat_weeks: offer.max_repeat_weeks || null,
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

  const { token, name, phone, pickup_address, email, repeat_weeks } = req.body;
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
      SELECT o.*, o.scheduled_date::text AS scheduled_date_text,
             lt.name AS lesson_type_name, lt.slug AS lesson_type_slug, lt.duration_minutes, lt.price_pence,
             i.name AS instructor_name
      FROM lesson_offers o
      JOIN instructors i ON i.id = o.instructor_id
      LEFT JOIN lesson_types lt ON lt.id = o.lesson_type_id
      WHERE o.token = ${token} AND o.status = 'pending' AND o.expires_at > NOW()
    `;

    if (!offer) {
      // Distinguish a broadcast loser ("someone else booked it") from generic
      // expiry/not-found. Superseded rows still exist in the table, just with
      // a non-pending status — we look them up explicitly here.
      const [superseded] = await sql`
        SELECT id FROM lesson_offers WHERE token = ${token} AND status = 'superseded'
      `;
      if (superseded)
        return res.status(410).json({ error: true, code: 'SUPERSEDED', message: 'Sorry — that slot is no longer available!' });
      return res.status(404).json({ error: true, code: 'NOT_FOUND', message: 'Offer not found, expired, or already accepted' });
    }

    // Derive school_id from instructor
    const [instrRow] = await sql`SELECT school_id FROM instructors WHERE id = ${offer.instructor_id}`;
    const schoolId = instrRow?.school_id || 1;

    let boundLearner = null;
    if (offer.learner_id) {
      const [learner] = await sql`
        SELECT id, name, email, phone, pickup_address
        FROM learner_users
        WHERE id = ${offer.learner_id}
          AND school_id = ${schoolId}
      `;
      if (!learner)
        return res.status(400).json({ error: 'Offer learner is no longer available' });
      boundLearner = learner;
    }

    // Resolve learner details. Existing-learner offers prefer the stored
    // learner record while still letting the accept form fill missing fields.
    const resolvedName = (name && name.trim()) || boundLearner?.name || offer.learner_name || '';
    if (!resolvedName)
      return res.status(400).json({ error: 'Name is required' });

    const resolvedEmail = offer.learner_email || boundLearner?.email || (email ? email.trim().toLowerCase() : null);
    if (!resolvedEmail)
      return res.status(400).json({ error: 'Email address is required' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(resolvedEmail))
      return res.status(400).json({ error: 'Invalid email address' });

    const learnerDetails = {
      learner_id: boundLearner?.id || null,
      name: resolvedName,
      phone: (phone || boundLearner?.phone || '').trim(),
      pickup_address: (pickup_address || boundLearner?.pickup_address || '').trim()
    };

    const offerDateText = dateOnly(offer.scheduled_date_text || offer.scheduled_date);
    const isFlexible = !offerDateText && !offer.start_time;
    const isTrialOffer = offer.lesson_type_slug === 'trial';
    const originalPricePence = offer.price_pence ?? 8250;
    if (isTrialOffer && isFlexible)
      return res.status(400).json({ error: 'Free trial offers must be for a fixed slot. Ask your instructor to send a dated trial offer.' });

    // Resolve weekly-repeat count. The offer's max_repeat_weeks is the ceiling
    // the instructor set (null/1 = single lesson only). Learner-supplied count
    // is clamped to that ceiling. Repeats are slot-pinned only — flexible
    // offers credit the learner instead and let them book themselves.
    const offerMaxRepeat = (offer.max_repeat_weeks && !isFlexible) ? parseInt(offer.max_repeat_weeks, 10) : 1;
    let repeatWeeksClean = 1;
    if (repeat_weeks != null && repeat_weeks !== '') {
      const rw = parseInt(repeat_weeks, 10);
      if (isNaN(rw) || rw < 1)
        return res.status(400).json({ error: 'repeat_weeks must be a positive integer' });
      repeatWeeksClean = Math.min(rw, offerMaxRepeat);
    }

    // offer_price_pence (custom price) takes precedence over discount_pct
    let pricePence;
    if (isTrialOffer) {
      pricePence = 0;
    } else if (offer.offer_price_pence != null) {
      pricePence = offer.offer_price_pence;
    } else {
      const discountPct = offer.discount_pct || 0;
      pricePence = Math.round(originalPricePence * (100 - discountPct) / 100);
    }

    const durationMins = offer.duration_minutes || 90;
    const durationStr = durationMins >= 60
      ? (durationMins % 60 === 0 ? `${durationMins / 60} hour${durationMins / 60 !== 1 ? 's' : ''}` : `${(durationMins / 60).toFixed(1)} hours`)
      : `${durationMins} mins`;

    const lessonDate = offerDateText
      ? new Date(offerDateText + 'T00:00:00Z')
          .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
      : null;

    const baseUrl = process.env.BASE_URL || 'https://coachcarter.uk';

    // Free offer → skip Stripe, confirm directly (only for slot-pinned offers)
    if (pricePence === 0 && !isFlexible) {
      return await handleFreeOffer(sql, offer, learnerDetails, baseUrl, token, res, resolvedEmail, repeatWeeksClean);
    }

    // Flexible + free → create/find learner, add credit, redirect to success
    if (pricePence === 0 && isFlexible) {
      const { createTransporter } = require('./_auth-helpers');

      const learnerId = await findOrCreateLearner(sql, resolvedEmail, learnerDetails, schoolId);

      // Auto-login: set learner session cookie so they can use credits on the booking page
      const secret = process.env.JWT_SECRET;
      if (secret) {
        const jwtToken = jwt.sign(
          { id: learnerId, email: resolvedEmail, role: 'learner', school_id: schoolId },
          secret,
          { expiresIn: '180d' }
        );
        appendSetCookie(res, buildSessionCookie(SESSION_COOKIE_NAMES.learner, jwtToken, SESSION_MAX_AGE_SEC.learner));
        appendSetCookie(res, buildCsrfCookie(mintCsrfToken()));
      }

      // 2. Add credit to learner balance.
      //
      // Step 4 audit improvement: this flexible-free-offer path historically
      // wrote balance without a matching credit_transactions row, leaving no
      // ledger trace of the grant. lockBalanceAndMutate inserts an
      // 'admin_add' / source='goodwill' row alongside the balance write so
      // admin credits views and learner transaction history reflect the
      // grant. Scoped to the offer's instructor under Phase 2A.
      await lockBalanceAndMutate(sql, {
        learnerId,
        schoolId,
        instructorId: offer.instructor_id,
        delta: durationMins,
        creditsDelta: 1,
        ledgerType: 'admin_add',
        reason: 'free flexible offer',
        source: 'goodwill',
        absorbedBy: 'platform',
        allowOverdraft: true,
      });

      // 3. Mark offer accepted
      await sql`
        UPDATE lesson_offers SET status = 'accepted', learner_id = ${learnerId}, accepted_at = NOW()
        WHERE id = ${offer.id}
          AND school_id = ${schoolId}
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
    } else if (repeatWeeksClean > 1) {
      priceLabel = `${offer.lesson_type_name || 'Standard Lesson'} — ${repeatWeeksClean} weekly lessons from ${lessonDate}`;
    } else {
      priceLabel = `${offer.lesson_type_name || 'Standard Lesson'} — ${lessonDate} ${offer.start_time}–${offer.end_time}`;
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'gbp',
          unit_amount: pricePence,
          product_data: {
            name: priceLabel,
            description: repeatWeeksClean > 1
              ? `${repeatWeeksClean} × ${durationStr} driving lessons with ${offer.instructor_name}`
              : `${durationStr} driving lesson with ${offer.instructor_name}`
          }
        },
        quantity: repeatWeeksClean
      }],
      metadata: {
        payment_type:      'lesson_offer',
        offer_token:       token,
        offer_id:          String(offer.id),
        instructor_id:     String(offer.instructor_id),
        instructor_name:   offer.instructor_name,
        learner_email:     resolvedEmail,
        learner_id:        boundLearner?.id ? String(boundLearner.id) : '',
        learner_name:      learnerDetails.name,
        learner_phone:     learnerDetails.phone,
        pickup_address:    learnerDetails.pickup_address,
        scheduled_date:    offerDateText || '',
        start_time:        offer.start_time || '',
        end_time:          offer.end_time || '',
        lesson_type_id:    String(offer.lesson_type_id || ''),
        duration_minutes:  String(durationMins),
        amount_pence:      String(pricePence),
        repeat_weeks:      String(repeatWeeksClean),
        school_id:         String(schoolId),
        is_flexible:       isFlexible ? '1' : '0',
        // Step 4 / Phase 2A: per-minute rate is invariant across the weekly
        // series (Stripe charges quantity = repeatWeeksClean), so the rate
        // computed here is correct for each booked lesson.
        effective_rate_pence_per_minute: String(durationMins > 0 ? Math.round(pricePence / durationMins) : 0)
      },
      customer_email: resolvedEmail,
      excluded_payment_method_types: CHECKOUT_EXCLUDED_PAYMENT_METHOD_TYPES,
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
        AND school_id = ${schoolId}
    `;

    return res.json({ ok: true, url: session.url });
  } catch (err) {
    console.error('accept-offer error:', err.message, err.stack);
    reportError('/api/offers', err);
    return res.status(500).json({ error: 'Failed to create checkout' });
  }
}

// ── Free offer handler (100% discount — no Stripe) ───────────────────────────
// Creates learner + booking directly without payment.
async function handleFreeOffer(sql, offer, learnerDetails, baseUrl, token, res, resolvedEmail, repeatWeeks) {
  const { createTransporter } = require('./_auth-helpers');
  const durationMins = offer.duration_minutes || 90;
  const repeats = Math.max(1, parseInt(repeatWeeks, 10) || 1);

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
      { expiresIn: '180d' }
    );
    appendSetCookie(res, buildSessionCookie(SESSION_COOKIE_NAMES.learner, jwtToken, SESSION_MAX_AGE_SEC.learner));
    appendSetCookie(res, buildCsrfCookie(mintCsrfToken()));
  }

  // 2. Create booking(s) — single lesson or weekly series with skip-clash.
  const isoDate0 = dateOnly(offer.scheduled_date_text || offer.scheduled_date);
  let seriesResult;
  try {
    seriesResult = await bookOfferSeries(sql, {
      instructorId: offer.instructor_id,
      learnerId,
      firstDate: isoDate0,
      startTime: offer.start_time,
      endTime: offer.end_time,
      lessonTypeId: offer.lesson_type_id,
      durationMins: 0,        // free — no minutes deducted
      pickupAddress: learnerDetails.pickup_address || null,
      schoolId,
      repeatWeeks: repeats,
      paymentMethod: 'free',
      // Step 1b: free offer has no list price. Tag live_compute_insert so the
      // value is a positive assertion ("0 is correct") rather than NULL ("we
      // didn't snapshot").
      listPricePerBookingPence: 0,
      listPriceSource: 'live_compute_insert'
    });
  } catch (insertErr) {
    if (insertErr.message?.includes('uq_booking_slot') || insertErr.message?.includes('uq_instructor_slot')) {
      return res.status(409).json({ error: true, code: 'SLOT_TAKEN', message: 'Sorry, that slot has been taken.' });
    }
    throw insertErr;
  }
  const booking = { id: seriesResult.booked[0].booking_id };

  // 3. Update offer
  await sql`
    UPDATE lesson_offers
    SET status = 'accepted', booking_id = ${booking.id}, learner_id = ${learnerId}, accepted_at = NOW()
    WHERE id = ${offer.id}
      AND school_id = ${schoolId}
  `;

  // 4. Send confirmation emails
  const [instructor] = await sql`SELECT name, email FROM instructors WHERE id = ${offer.instructor_id}`;
  const durationStr = durationMins >= 60
    ? (durationMins % 60 === 0 ? `${durationMins / 60} hour${durationMins / 60 !== 1 ? 's' : ''}` : `${(durationMins / 60).toFixed(1)} hours`)
    : `${durationMins} mins`;
  const lessonDate = new Date(isoDate0 + 'T00:00:00Z')
    .toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

  try {
    const transporter = createTransporter();
    const firstName = (learnerDetails.name || '').split(' ')[0] || 'there';

    const isSeries = seriesResult.booked.length > 1;
    const seriesListHtml = isSeries
      ? '<ul style="padding-left:18px;margin:8px 0">' + seriesResult.booked.map(b => {
          const ds = new Date(b.date + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
          return `<li>${ds} at ${offer.start_time}</li>`;
        }).join('') + '</ul>'
      : '';
    const skippedListHtml = (isSeries && seriesResult.skipped.length > 0)
      ? '<p style="font-size:0.85rem;color:#797879">Skipped weeks where the instructor was unavailable — those slots rolled to the next free week.</p>'
      : '';

    await transporter.sendMail({
      from: 'CoachCarter <bookings@coachcarter.uk>',
      to: resolvedEmail,
      subject: isSeries
        ? `${seriesResult.booked.length} free lessons confirmed with ${offer.instructor_name}`
        : `Free lesson confirmed — ${lessonDate} at ${offer.start_time}`,
      html: `
        <h1>${isSeries ? 'Lessons confirmed!' : 'Lesson confirmed!'}</h1>
        <p>Hi ${firstName}, your ${isSeries ? `${seriesResult.booked.length} free lessons are` : 'free lesson is'} booked.</p>
        ${isSeries ? `<p><strong>Your weekly lessons:</strong></p>${seriesListHtml}${skippedListHtml}` : `
        <table>
          <tr><td><strong>Date:</strong></td><td>${lessonDate}</td></tr>
          <tr><td><strong>Time:</strong></td><td>${offer.start_time} – ${offer.end_time}</td></tr>
          <tr><td><strong>Instructor:</strong></td><td>${offer.instructor_name}</td></tr>
          <tr><td><strong>Duration:</strong></td><td>${durationStr}</td></tr>
          <tr><td><strong>Price:</strong></td><td>FREE</td></tr>
        </table>`}
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

  // Redirect to success page. `free=1` tells the page this was a £0 lesson
  // (skipped Stripe) so it can drop the "payment successful" wording.
  return res.json({
    ok: true,
    url: `${baseUrl}/offer-success.html?token=${token}&free=1`,
    learner_session: { id: learnerId, name: learnerDetails.name, email: resolvedEmail, school_id: schoolId }
  });
}

// ── GET /api/offers?action=expire-offers ──────────────────────────────────────
// Cron-triggered: bulk-expire stale pending offers. Vercel Cron always sends
// GET (per vercel.json), so this handler accepts GET to match. Previously
// gated on POST, which meant the cron never actually ran — the `expires_at`
// check inside handleGetOffer (lazy-expire at view-time) was masking this
// in prod. Auth gate is verifyCronAuth(), not the HTTP method.
async function handleExpireOffers(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Fail-closed cron auth using the shared helper (Authorization: Bearer
  // or ?key=). Matches cron-retention.js / cron-payouts.js. Previously
  // accepted the spoofable `x-vercel-cron` header as a bypass — removed.
  if (!verifyCronAuth(req)) {
    return res.status(401).json({ error: 'Unauthorised' });
  }

  // Lease 120s — hourly cron, single UPDATE. Lock is belt-and-braces; the
  // UPDATE itself is idempotent (WHERE status='pending'), but lock saves
  // wasted work + avoids two parallel runs both holding the row lock briefly.
  return withCronLock(req, res, 'offers.expire', 120, async (sql) => {
    const expired = await sql`
      UPDATE lesson_offers SET status = 'expired'
      WHERE status = 'pending' AND expires_at <= NOW()
      RETURNING id, learner_email, scheduled_date::text
    `;
    return { ok: true, expired_count: expired.length };
  });
}
