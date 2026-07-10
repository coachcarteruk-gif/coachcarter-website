// Shared lesson-request helpers ("request to book", July 2026)
//
// See LESSON-REQUEST-PLAN.md. A lesson request is a learner-initiated hold on
// a slot for an instructor with `request_to_book = TRUE`. Payment is held,
// never taken up front:
//   - credit path:  'request_hold' credit_transactions row (minutes < 0) at
//                    request time, refunded in full via 'request_refund'
//   - card path:    Stripe PaymentIntent with capture_method='manual' —
//                    captured on accept, cancelled on decline/expiry
//
// Pending requests block their slot everywhere a pending lesson_offer does.
// Requests expire at min(created + 48h, lesson start − 2h).
//
// Lifecycle invariant: every status transition away from 'pending' is an
// atomic claim (UPDATE ... WHERE status = 'pending'), and the held payment is
// released exactly once, recorded by released_at. The expire cron sweeps
// decided-but-unreleased rows so a crash between claim and release always
// self-heals in the learner's favour.

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { sendWhatsApp } = require('./_whatsapp');
const { createTransporter } = require('./_auth-helpers');
const { lockBalanceAndMutate, lockBalanceAdjustLCB } = require('./_credit-grant');
const { reportError } = require('./_error-alert');
const { SCHEDULED } = require('./_booking-status');

const REQUEST_EXPIRY_HOURS = 48;
// A request must be answerable before the lesson: it expires no later than
// 2h before the slot starts, and can't be created at all inside that window.
const REQUEST_MIN_LEAD_MINUTES = 120;

// min(now + 48h, slot start − 2h). Returns null when the slot is already
// inside the minimum lead window (request must be rejected, not created).
function computeRequestExpiresAt(scheduledDate, startTime) {
  const slotStart = new Date(`${String(scheduledDate).slice(0, 10)}T${String(startTime).slice(0, 5)}:00Z`);
  if (Number.isNaN(slotStart.getTime())) return null;
  const latestDecision = new Date(slotStart.getTime() - REQUEST_MIN_LEAD_MINUTES * 60 * 1000);
  if (latestDecision.getTime() <= Date.now()) return null;
  const standard = new Date(Date.now() + REQUEST_EXPIRY_HOURS * 60 * 60 * 1000);
  return standard < latestDecision ? standard : latestDecision;
}

// ── Slot-blocking checks ──────────────────────────────────────────────────────
// Mirrors the pending lesson_offers conflict checks: exact slot-grid match on
// (instructor, date, start_time). Both a neon tagged-template variant and a
// pg-client variant (for use inside withNeonTransaction).

async function pendingRequestConflicts(sql, { instructorId, schoolId, dates, startTime }) {
  try {
    return await sql`
      SELECT scheduled_date::text AS date, start_time::text
      FROM lesson_requests
      WHERE instructor_id = ${instructorId}
        AND school_id = ${schoolId}
        AND scheduled_date = ANY(${dates})
        AND start_time = ${startTime}::time
        AND status = 'pending'
        AND expires_at > NOW()
    `;
  } catch (e) {
    // Table may not exist yet mid-deploy — never block booking on that.
    return [];
  }
}

async function pendingRequestConflictsPg(client, { instructorId, schoolId, dates, startTime }) {
  try {
    const result = await client.query(
      `SELECT scheduled_date::text AS date, start_time::text
         FROM lesson_requests
        WHERE instructor_id = $1
          AND school_id = $2
          AND scheduled_date = ANY($3::date[])
          AND start_time = $4::time
          AND status = 'pending'
          AND expires_at > NOW()`,
      [instructorId, schoolId, dates, startTime]
    );
    return result.rows;
  } catch (e) {
    return [];
  }
}

// Overlap variant for slot-feed generation, where candidate windows aren't
// grid-aligned with the request's start_time. Returns pending windows for the
// date range so the caller can exclude overlapping candidates in memory.
async function pendingRequestWindows(sql, { instructorId = null, schoolId, fromDate, toDate }) {
  try {
    return await sql`
      SELECT instructor_id, scheduled_date::text AS date,
             start_time::text AS start_time, end_time::text AS end_time
      FROM lesson_requests
      WHERE (${instructorId}::int IS NULL OR instructor_id = ${instructorId})
        AND school_id = ${schoolId}
        AND scheduled_date >= ${fromDate}
        AND scheduled_date <= ${toDate}
        AND status = 'pending'
        AND expires_at > NOW()
    `;
  } catch (e) {
    return [];
  }
}

// ── Hold release ──────────────────────────────────────────────────────────────
// Releases the held payment for a request whose status has ALREADY been
// atomically claimed away from 'pending' by the caller. Exactly-once is
// enforced by the released_at claim below, so cron retries are safe.
//
// Returns { ok: true } or { ok: false, error }.
async function releaseRequestHold(sql, request) {
  // Claim the release. If another runner (or an earlier crashed attempt that
  // actually completed) got here first, do nothing.
  const [claimed] = await sql`
    UPDATE lesson_requests
       SET released_at = NOW()
     WHERE id = ${request.id}
       AND school_id = ${request.school_id}
       AND released_at IS NULL
     RETURNING id
  `;
  if (!claimed) return { ok: true, alreadyReleased: true };

  try {
    if (request.payment_method === 'credit') {
      if (!request.hold_transaction_id || !request.learner_id) {
        // Hold was never taken (crash between insert and hold) — nothing to
        // refund. released_at now records that we checked.
        return { ok: true, nothingHeld: true };
      }
      const minutes = Number(request.credits_minutes || 0);
      if (minutes <= 0) return { ok: true, nothingHeld: true };
      const refund = await lockBalanceAndMutate(sql, {
        learnerId: request.learner_id,
        instructorId: request.instructor_id,
        schoolId: request.school_id,
        delta: minutes,
        creditsDelta: Math.ceil(minutes / 60),
        ledgerType: 'request_refund',
        reason: 'lesson request released',
        allowOverdraft: true,
      });
      if (!refund.ok) throw new Error(`request_refund failed: ${refund.code}`);
      return { ok: true };
    }

    if (request.payment_method === 'card_hold') {
      if (!request.payment_intent_id) return { ok: true, nothingHeld: true };
      try {
        await stripe.paymentIntents.cancel(request.payment_intent_id);
      } catch (err) {
        // Already-cancelled / already-expired holds are success states.
        const code = err?.code || '';
        const msg = String(err?.message || '');
        const status = err?.raw?.payment_intent?.status || '';
        const benign = code === 'payment_intent_unexpected_state'
          && (status === 'canceled' || /already.*(canceled|cancelled)/i.test(msg));
        if (!benign) throw err;
      }
      return { ok: true };
    }

    return { ok: true, nothingHeld: true };
  } catch (err) {
    // Un-claim so the cron sweep retries the release.
    try {
      await sql`
        UPDATE lesson_requests SET released_at = NULL
         WHERE id = ${request.id} AND school_id = ${request.school_id}
      `;
    } catch (unclaimErr) {
      console.error('[lesson-requests] release un-claim failed', { requestId: request.id, err: unclaimErr.message });
    }
    console.error('[lesson-requests] hold release failed', { requestId: request.id, err: err.message });
    reportError('lesson-request hold release', err);
    return { ok: false, error: err.message };
  }
}

// Load learner contact details onto a request row (guest columns already
// carry contact for guest requests).
async function withLearnerContact(sql, request) {
  if (!request.learner_id) return request;
  try {
    const [learner] = await sql`
      SELECT name, email, phone FROM learner_users
      WHERE id = ${request.learner_id} AND school_id = ${request.school_id}
    `;
    if (learner) {
      return {
        ...request,
        learner_name: learner.name,
        learner_email: learner.email,
        learner_phone: learner.phone,
      };
    }
  } catch (e) { /* fall through — notify with what we have */ }
  return request;
}

// Atomically expire one pending request: claim status, release the hold,
// notify the learner. Used by the hourly cron and by the lazy-expire path in
// slot handlers (a pending-but-expired row still holds uq_request_slot until
// its status flips). Safe to call on rows that were just claimed elsewhere —
// the claim simply misses and we do nothing.
async function expirePendingRequest(sql, requestRow, { instructorName } = {}) {
  const [claimed] = await sql`
    UPDATE lesson_requests
       SET status = 'expired', decided_at = NOW()
     WHERE id = ${requestRow.id}
       AND school_id = ${requestRow.school_id}
       AND status = 'pending'
     RETURNING *
  `;
  if (!claimed) return { ok: true, skipped: true };

  const release = await releaseRequestHold(sql, claimed);
  if (!release.ok) {
    // released_at was un-claimed inside releaseRequestHold; the cron sweep
    // will retry. Still notify — the learner-facing outcome is the same.
    console.error('[lesson-requests] expire release failed, sweep will retry', { requestId: claimed.id });
  }

  let name = instructorName;
  if (!name) {
    try {
      const [instr] = await sql`
        SELECT name FROM instructors WHERE id = ${claimed.instructor_id} AND school_id = ${claimed.school_id}
      `;
      name = instr?.name;
    } catch (e) { /* default below */ }
  }
  const withContact = await withLearnerContact(sql, claimed);
  await notifyLearnerRequestClosed(withContact, 'expired', { instructorName: name || 'Your instructor' });
  return { ok: true, released: release.ok };
}

// Lazy-expire any pending-but-expired request holding a specific slot, so a
// new request/booking isn't blocked by a row the hourly cron hasn't reached.
async function lazyExpireSlotRequests(sql, { instructorId, schoolId, date, startTime }) {
  let stale = [];
  try {
    stale = await sql`
      SELECT * FROM lesson_requests
      WHERE instructor_id = ${instructorId}
        AND school_id = ${schoolId}
        AND scheduled_date = ${date}
        AND start_time = ${startTime}::time
        AND status = 'pending'
        AND expires_at <= NOW()
    `;
  } catch (e) {
    return;
  }
  for (const row of stale) {
    await expirePendingRequest(sql, row);
  }
}

// ── Card path: capture + booking creation on accept ──────────────────────────

// Capture the manual-capture PaymentIntent for an accepted card request.
// Idempotent: an already-captured PI is a success state (webhook retries,
// double-clicked accept).
async function captureRequestHold(request) {
  if (!request.payment_intent_id) {
    return { ok: false, error: 'Request has no payment intent to capture' };
  }
  try {
    await stripe.paymentIntents.capture(request.payment_intent_id);
    return { ok: true };
  } catch (err) {
    const status = err?.raw?.payment_intent?.status || '';
    if (err?.code === 'payment_intent_unexpected_state' && status === 'succeeded') {
      return { ok: true, alreadyCaptured: true };
    }
    console.error('[lesson-requests] PI capture failed', { requestId: request.id, err: err.message });
    return { ok: false, error: err.message, code: err.code || null };
  }
}

// Refund a captured card request (accept crashed after capture, or the
// booking insert lost a race). Idempotent via Stripe's own refund semantics.
async function refundCapturedRequest(request) {
  if (!request.payment_intent_id) return { ok: true, nothingHeld: true };
  try {
    await stripe.refunds.create({ payment_intent: request.payment_intent_id });
    return { ok: true };
  } catch (err) {
    if (err?.code === 'charge_already_refunded') return { ok: true, alreadyRefunded: true };
    console.error('[lesson-requests] captured-request refund failed', { requestId: request.id, err: err.message });
    reportError('lesson-request captured refund', err);
    return { ok: false, error: err.message };
  }
}

// Create the paid booking for an accepted (captured) card request. Mirrors
// webhook.js handleSlotBooking: slot_purchase credit_transactions row →
// add+deduct LCB → booking insert → BCS attribution. Idempotent on the
// request's stripe_session_id via uq_credit_tx_session.
//
// Returns { ok: true, booking } or { ok: false, code, error }.
async function bookAcceptedCardRequest(sql, { request, lessonType }) {
  const chargeMins = Number(request.credits_minutes || lessonType?.duration_minutes || 0)
    || Math.round((new Date(`1970-01-01T${String(request.end_time).slice(0, 8)}Z`)
      - new Date(`1970-01-01T${String(request.start_time).slice(0, 8)}Z`)) / 60000);
  const amountPence = Number(request.amount_pence || 0);
  const effectiveRate = chargeMins > 0 ? Math.round(amountPence / chargeMins) : null;

  // 1. Ledger row for the captured charge — same shape as a direct slot
  // purchase so payouts / reconcile / FIFO treat it identically. Fee is left
  // NULL for the reconcile cron to backfill from the balance transaction.
  let creditTx;
  try {
    const [inserted] = await sql`
      INSERT INTO credit_transactions
        (learner_id, type, credits, amount_pence, payment_method, stripe_session_id, minutes, school_id,
         stripe_fee_pence, instructor_id, effective_rate_pence_per_minute, stripe_payment_intent_id, source)
      VALUES
        (${request.learner_id}, 'slot_purchase', 1, ${amountPence}, 'card', ${request.stripe_session_id}, ${chargeMins}, ${request.school_id},
         NULL, ${request.instructor_id}, ${effectiveRate}, ${request.payment_intent_id}, 'stripe')
      RETURNING id, amount_pence, stripe_fee_pence, effective_rate_pence_per_minute
    `;
    creditTx = inserted;
  } catch (insertErr) {
    if (insertErr.code === '23505' || insertErr.message?.includes('uq_credit_tx')) {
      const [existing] = await sql`
        SELECT id, amount_pence, stripe_fee_pence, effective_rate_pence_per_minute
          FROM credit_transactions
         WHERE stripe_session_id = ${request.stripe_session_id}
           AND type = 'slot_purchase'
           AND learner_id = ${request.learner_id}
           AND school_id = ${request.school_id}
         LIMIT 1
      `;
      if (!existing) throw insertErr;
      creditTx = existing;
    } else {
      throw insertErr;
    }
  }

  // 2. Add then deduct (net zero) under the LCB lock — the slot_purchase row
  // above is the single audit-of-record for the charge.
  const addResult = await lockBalanceAdjustLCB(sql, {
    learnerId: request.learner_id,
    instructorId: request.instructor_id,
    schoolId: request.school_id,
    delta: chargeMins, creditsDelta: 1,
  });
  if (!addResult.ok) return { ok: false, code: addResult.code, error: 'balance add failed' };
  const deductResult = await lockBalanceAdjustLCB(sql, {
    learnerId: request.learner_id,
    instructorId: request.instructor_id,
    schoolId: request.school_id,
    delta: -chargeMins, creditsDelta: -1,
  });
  if (!deductResult.ok) return { ok: false, code: deductResult.code, error: 'balance deduct failed' };

  // 3. The booking itself.
  let booking;
  try {
    const [b] = await sql`
      INSERT INTO lesson_bookings
        (learner_id, instructor_id, scheduled_date, start_time, end_time, status,
         lesson_type_id, transmission_type, minutes_deducted, school_id,
         pickup_address,
         list_price_pence, list_price_source)
      VALUES
        (${request.learner_id}, ${request.instructor_id}, ${request.scheduled_date}, ${request.start_time}, ${request.end_time}, ${SCHEDULED},
         ${request.lesson_type_id}, ${request.transmission_type || 'manual'}, ${chargeMins}, ${request.school_id},
         ${request.pickup_address || null},
         ${amountPence}, 'stripe_metadata')
      RETURNING id, scheduled_date::text, start_time::text, end_time::text
    `;
    booking = b;
  } catch (insertErr) {
    // Slot lost to a race after capture. The caller refunds the captured
    // charge; the ledger must end net-zero for the divergence cron:
    // slot_purchase (+N) needs a matching 'refund' CT (−N). Restore the
    // balance first so the guarded refund deduct can land.
    await lockBalanceAdjustLCB(sql, {
      learnerId: request.learner_id,
      instructorId: request.instructor_id,
      schoolId: request.school_id,
      delta: chargeMins, creditsDelta: 1,
    });
    const compensate = await lockBalanceAndMutate(sql, {
      learnerId: request.learner_id,
      instructorId: request.instructor_id,
      schoolId: request.school_id,
      delta: -chargeMins,
      creditsDelta: -1,
      ledgerType: 'refund',
      reason: 'lesson request slot lost after capture',
      amountPence,
      allowOverdraft: true,
    });
    if (!compensate.ok) {
      console.error('[lesson-requests] compensating refund CT failed — expect divergence drift', { requestId: request.id, code: compensate.code });
      reportError('lesson-request compensating refund CT', new Error(compensate.code || 'unknown'));
    }
    if (insertErr.code === '23505' || insertErr.message?.includes('uq_booking_slot') || insertErr.message?.includes('uq_instructor_slot')) {
      return { ok: false, code: 'SLOT_UNAVAILABLE', error: 'slot already booked' };
    }
    throw insertErr;
  }

  // 4. Attribute the charge to the booking.
  await sql`
    INSERT INTO booking_credit_sources
      (school_id, booking_id, credit_transaction_id, minutes_drawn,
       rate_pence_per_minute, contribution_pence, stripe_fee_pence, absorbed_by)
    VALUES
      (${request.school_id}, ${booking.id}, ${creditTx.id}, ${chargeMins},
       ${creditTx.effective_rate_pence_per_minute}, ${creditTx.amount_pence}, ${creditTx.stripe_fee_pence ?? 0}, NULL)
    ON CONFLICT (booking_id, credit_transaction_id) DO NOTHING
  `;

  return { ok: true, booking };
}

// ── Learner notifications ─────────────────────────────────────────────────────

function formatSlotDisplay(request) {
  const iso = String(request.scheduled_date).slice(0, 10);
  const d = new Date(iso + 'T00:00:00Z');
  const dateStr = d.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC'
  });
  return `${dateStr}, ${String(request.start_time).slice(0, 5)} – ${String(request.end_time).slice(0, 5)}`;
}

function requestRecipient(request) {
  return {
    email: request.learner_email || request.guest_email || null,
    phone: request.learner_phone || request.guest_phone || null,
    name: request.learner_name || request.guest_name || 'there',
  };
}

// kind: 'declined' | 'expired' | 'withdrawn' | 'accept_failed'
// The request row should carry learner_email / learner_name / learner_phone
// (joined by the caller) or guest_* columns.
async function notifyLearnerRequestClosed(request, kind, { instructorName = 'Your instructor', declineReason = null } = {}) {
  const { email, phone, name } = requestRecipient(request);
  const firstName = String(name || 'there').split(' ')[0] || 'there';
  const slot = formatSlotDisplay(request);
  const isCard = request.payment_method === 'card_hold';

  const moneyLineText = isCard
    ? 'Your card was NOT charged. If you can see a pending amount on your statement, it is only an authorisation hold and will disappear within a few days.'
    : 'Your lesson credits have been returned to your balance in full.';

  let headline;
  if (kind === 'declined') headline = `${instructorName} can't make your requested lesson`;
  else if (kind === 'expired') headline = `Your lesson request has expired`;
  else if (kind === 'withdrawn') headline = `Your lesson request was withdrawn`;
  else headline = `Your lesson request couldn't be completed`;

  let bodyText;
  if (kind === 'declined') {
    bodyText = `${instructorName} isn't available for the lesson you requested (${slot}).`
      + (declineReason ? ` They said: "${declineReason}".` : '');
  } else if (kind === 'expired') {
    bodyText = `${instructorName} didn't respond to your lesson request (${slot}) in time, so it has expired.`;
  } else if (kind === 'withdrawn') {
    bodyText = `Your lesson request (${slot}) has been withdrawn as you asked.`;
  } else {
    bodyText = `${instructorName} accepted your lesson request (${slot}), but the booking couldn't be completed.`
      + (declineReason ? ` Reason: ${declineReason}.` : '');
  }

  const baseUrl = process.env.BASE_URL || 'https://coachcarter.uk';

  if (email) {
    try {
      const mailer = createTransporter();
      await mailer.sendMail({
        from: 'CoachCarter <bookings@coachcarter.uk>',
        to: email,
        subject: headline,
        html: `
          <div style="font-family:Arial,Helvetica,sans-serif;max-width:580px;margin:0 auto">
            <h2 style="color:#262626">Hi ${firstName},</h2>
            <p>${bodyText}</p>
            <p><strong>${moneyLineText}</strong></p>
            <p style="margin:24px 0">
              <a href="${baseUrl}/learner/book.html"
                 style="background:#f58321;color:white;padding:14px 28px;text-decoration:none;
                        border-radius:8px;display:inline-block;font-weight:bold;font-size:1rem">
                Find another slot →
              </a>
            </p>
          </div>
        `,
      });
    } catch (err) {
      console.error('[lesson-requests] learner close email failed', { requestId: request.id, err: err.message });
    }
  }

  if (phone && kind !== 'withdrawn') {
    try {
      await sendWhatsApp(
        phone,
        `Hi ${firstName}, ${bodyText}\n${moneyLineText}\nFind another slot: ${baseUrl}/learner/book.html`,
        {
          purpose: 'lesson_request.closed_learner',
          learnerId: request.learner_id || undefined,
          instructorId: request.instructor_id,
          schoolId: request.school_id,
        }
      );
    } catch (err) {
      console.error('[lesson-requests] learner close SMS failed', { requestId: request.id, err: err.message });
    }
  }
}

// New-request nudge to the instructor (SMS + email). Awaited by callers —
// never fire-and-forget on Vercel.
async function notifyInstructorNewRequest(request, instructor, { learnerDisplayName = 'A learner' } = {}) {
  const slot = formatSlotDisplay(request);
  const baseUrl = process.env.BASE_URL || 'https://coachcarter.uk';
  const dashUrl = `${baseUrl}/instructor/dashboard.html`;
  const expires = new Date(request.expires_at).toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC'
  });

  if (instructor.phone) {
    try {
      await sendWhatsApp(
        instructor.phone,
        `New lesson request: ${learnerDisplayName} wants ${slot}.\n` +
        `Accept or decline by ${expires} or it expires: ${dashUrl}`,
        {
          purpose: 'lesson_request.created_instructor',
          learnerId: request.learner_id || undefined,
          instructorId: request.instructor_id,
          schoolId: request.school_id,
        }
      );
    } catch (err) {
      console.error('[lesson-requests] instructor request SMS failed', { requestId: request.id, err: err.message });
    }
  }

  if (instructor.email) {
    try {
      const mailer = createTransporter();
      await mailer.sendMail({
        from: 'CoachCarter <bookings@coachcarter.uk>',
        to: instructor.email,
        subject: `Lesson request — ${slot}`,
        html: `
          <div style="font-family:Arial,Helvetica,sans-serif;max-width:580px;margin:0 auto">
            <h2 style="color:#262626">New lesson request</h2>
            <p><strong>${learnerDisplayName}</strong> has requested a lesson:</p>
            <table style="border-collapse:collapse;margin:16px 0">
              <tr><td style="padding:6px 16px 6px 0;font-weight:bold">When</td><td style="padding:6px 0">${slot}</td></tr>
              <tr><td style="padding:6px 16px 6px 0;font-weight:bold">Respond by</td><td style="padding:6px 0">${expires}</td></tr>
            </table>
            <p>Their payment is held — it's only taken if you accept.</p>
            <p style="margin:24px 0">
              <a href="${dashUrl}"
                 style="background:#f58321;color:white;padding:14px 28px;text-decoration:none;
                        border-radius:8px;display:inline-block;font-weight:bold;font-size:1rem">
                Accept or decline →
              </a>
            </p>
          </div>
        `,
      });
    } catch (err) {
      console.error('[lesson-requests] instructor request email failed', { requestId: request.id, err: err.message });
    }
  }
}

module.exports = {
  REQUEST_EXPIRY_HOURS,
  REQUEST_MIN_LEAD_MINUTES,
  computeRequestExpiresAt,
  pendingRequestConflicts,
  pendingRequestConflictsPg,
  pendingRequestWindows,
  releaseRequestHold,
  captureRequestHold,
  refundCapturedRequest,
  bookAcceptedCardRequest,
  expirePendingRequest,
  lazyExpireSlotRequests,
  withLearnerContact,
  notifyLearnerRequestClosed,
  notifyInstructorNewRequest,
  formatSlotDisplay,
};
