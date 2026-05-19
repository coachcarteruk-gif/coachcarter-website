const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { neon } = require('@neondatabase/serverless');
const jwt = require('jsonwebtoken');
const { sendWhatsApp } = require('./_whatsapp');
const { reportError } = require('./_error-alert');
const { createTransporter } = require('./_auth-helpers');
const { SCHEDULED } = require('./_booking-status');
const { fetchSessionFeePence } = require('./_stripe-fee');
const { grantCredits } = require('./_credit-grant');


// Resolve school_id from Stripe metadata with a tenant-safe fallback.
// Order: metadata.school_id → lookup via instructor_id (instructors are
// school-unique) → metadata.learner_id → hard fallback to 1 with an alert.
// The fallback prevents non-school-1 paid bookings from being silently
// attributed to school 1 if metadata was written before this safety net.
async function resolveSchoolId(sql, metadata, sessionId) {
  const fromMeta = parseInt(metadata?.school_id, 10);
  if (fromMeta) return fromMeta;

  const instructorId = parseInt(metadata?.instructor_id, 10);
  if (instructorId) {
    try {
      const [row] = await sql`SELECT school_id FROM instructors WHERE id = ${instructorId}`;
      if (row?.school_id) return row.school_id;
    } catch (_) { /* fall through */ }
  }

  const learnerId = parseInt(metadata?.learner_id, 10);
  if (learnerId) {
    try {
      const [row] = await sql`SELECT school_id FROM learner_users WHERE id = ${learnerId}`;
      if (row?.school_id) return row.school_id;
    } catch (_) { /* fall through */ }
  }

  console.error('⚠️ webhook: school_id missing from metadata and cannot be derived', {
    sessionId, payment_type: metadata?.payment_type, instructorId, learnerId
  });
  reportError('/api/webhook (school_id fallback)', new Error(
    `school_id missing in webhook metadata for session ${sessionId}; defaulting to 1`
  ));
  return 1;
}

module.exports = async (req, res) => {
  // Raw body needed for Stripe signature
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    // For Vercel, we need to get the raw body
    const rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, endpointSecret);
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err);
    reportError('/api/webhook (signature)', err);
    return res.status(400).send('Webhook signature verification failed');
  }

  // Dispatch with re-throw semantics (PR-I, audit #14). Any thrown error
  // bubbles up to the 500 response below, which Stripe interprets as a
  // delivery failure and retries with exponential backoff (Stripe webhook
  // retry schedule: up to 3 days). Handlers are idempotent via
  // uq_credit_tx_session, so retries past the first successful INSERT are
  // no-ops. Pre-PR-I these handlers swallowed every error and returned 200,
  // which meant a transient Neon outage or bug silently dropped a paid
  // checkout off the floor and Stripe never retried.
  try {
    // Klarna and other delayed-payment methods deliver `completed` early
    // with payment_status='unpaid', then fire `async_payment_succeeded`
    // once the payment actually clears. Card payments only fire
    // `completed` (paid). We route both events through the same dispatch.
    if (event.type === 'checkout.session.completed' ||
        event.type === 'checkout.session.async_payment_succeeded') {
      const session = event.data.object;
      const paymentType = session.metadata?.payment_type;

      if (paymentType === 'credit_purchase') {
        // ── Credit purchase (in-app buy-credits + marketing bulk packages) ─
        await handleCreditPurchase(session);
      } else if (paymentType === 'slot_booking') {
        // ── Pay-per-slot: single lesson purchase + instant booking ─────
        await handleSlotBooking(session);
      } else if (paymentType === 'lesson_offer') {
        // ── Instructor-initiated offer: learner accepted + paid ────────
        await handleOfferBooking(session);
      } else {
        // Unknown payment_type. Pre-PR-J this fell into the legacy
        // handleCheckoutComplete + in-memory Map flow, which silently
        // dropped paid checkouts on cold start. Post-PR-J every supported
        // path sets payment_type explicitly — so this is now an alert path,
        // not a happy path.
        console.error('Stripe webhook: unknown payment_type', {
          session_id: session.id,
          payment_type: paymentType || '(missing)',
          metadata: session.metadata
        });
        reportError('/api/webhook (unknown payment_type)', new Error(
          `Unknown payment_type "${paymentType || ''}" for session ${session.id}. ` +
          `This used to route through the retired handleCheckoutComplete flow. ` +
          `Reconcile manually via Stripe Dashboard.`
        ));
      }
    }

    // Klarna failure / cancellation — log only. No DB writes happened on
    // the earlier `completed` event because handlers gate on
    // payment_status='paid'. No retry needed (Stripe won't re-charge).
    if (event.type === 'checkout.session.async_payment_failed') {
      const session = event.data.object;
      console.error('Stripe async payment failed:', {
        session_id: session.id,
        payment_type: session.metadata?.payment_type,
        learner_email: session.customer_details?.email || session.metadata?.learner_email,
      });
      reportError('/api/webhook (async_payment_failed)', new Error(
        `Async payment failed for session ${session.id} (${session.metadata?.payment_type || 'unknown'})`
      ));
    }

    // ── Stripe Connect: instructor onboarding complete ──
    // Re-throw on DB failure so Stripe retries. Both UPDATE statements are
    // idempotent (WHERE stripe_onboarding_complete = FALSE) so a retry
    // after partial success is safe.
    if (event.type === 'account.updated') {
      const account = event.data.object;
      if (account.charges_enabled && account.payouts_enabled) {
        const sql = neon(process.env.POSTGRES_URL);
        await sql`
          UPDATE instructors
             SET stripe_onboarding_complete = TRUE
           WHERE stripe_account_id = ${account.id}
             AND stripe_onboarding_complete = FALSE
        `;
        await sql`
          UPDATE schools
             SET stripe_onboarding_complete = TRUE
           WHERE stripe_account_id = ${account.id}
             AND stripe_onboarding_complete = FALSE
        `;
      }
    }

    return res.json({ received: true });
  } catch (err) {
    console.error(`Stripe webhook handler error (${event.type}):`, err);
    reportError(`/api/webhook (${event.type})`, err);
    // 500 → Stripe retries. Idempotency keys in handlers (uq_credit_tx_session
    // for credit/slot/offer paths, WHERE stripe_onboarding_complete = FALSE
    // for account.updated) make replays safe.
    return res.status(500).json({ error: 'Webhook handler failed', event_type: event.type });
  }
};

// Don't process unpaid sessions. Klarna fires `completed` with
// payment_status='unpaid' before the payment clears; the follow-up
// `async_payment_succeeded` event re-runs this handler with status='paid'.
function isPaid(session) {
  if (session.payment_status === 'paid') return true;
  console.log(`⏭  Skipping ${session.id} — payment_status=${session.payment_status} (will re-run on async_payment_succeeded)`);
  return false;
}

// ── Credit purchase handler ───────────────────────────────────────────────────
async function handleCreditPurchase(session) {
  if (!isPaid(session)) return;

  const metadata      = session.metadata || {};
  const learnerId     = parseInt(metadata.learner_id, 10);
  const credits       = parseInt(metadata.credits_purchased, 10);
  const amountPence   = parseInt(metadata.amount_pence, 10);
  const learnerEmail  = metadata.learner_email || session.customer_email;

  if (!learnerId || !credits) {
    console.error('❌ credit_purchase webhook missing learner_id or credits_purchased', metadata);
    return;
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const schoolId = await resolveSchoolId(sql, metadata, session.id);

    // Determine payment method (card or klarna)
    const paymentMethod = session.payment_method_types?.[0] || 'card';

    // Calculate minutes: each credit = 90 minutes (standard lesson)
    // Future: metadata.minutes_purchased overrides this
    const minutes = parseInt(metadata.minutes_purchased, 10) || (credits * 90);
    const hoursStr = (minutes / 60) % 1 === 0 ? `${minutes / 60}` : (minutes / 60).toFixed(1);

    // Snapshot the Stripe processing fee (Step 4f.b). NULL on failure; the
    // reconcile cron (4f.e) backfills, and the payout pipeline treats NULL
    // as zero in the meantime.
    const { feePence: stripeFeePence } = await fetchSessionFeePence(session);

    // Record the transaction AND increment the balance in one DB statement
    // via api/_credit-grant.js. Closes the historical split-write race:
    //
    //   - Stripe retries on 5xx → the partial unique index on stripe_session_id
    //     catches the duplicate; grantCredits returns alreadyProcessed=true
    //     and we skip the confirmation email (no double-send).
    //   - Concurrent verify-session call → both callers race for the FOR
    //     UPDATE row lock; exactly one inserts, the other no-ops cleanly.
    //   - Process killed mid-grant → the implicit transaction wrapping the
    //     CTE rolls back the whole statement; the row never persisted, so
    //     the retry runs as a fresh insert.
    const grant = await grantCredits({
      sql,
      learnerId,
      schoolId,
      credits,
      minutes,
      amountPence,
      paymentMethod,
      sessionId: session.id,
      stripeFeePence,
    });

    if (!grant.ok) {
      // LEARNER_NOT_FOUND — surfaced as a 500 so Stripe retries. By the
      // time the webhook fires the learner should exist; if they don't,
      // something is very wrong (signup flow regression, school_id drift)
      // and we want it loud.
      throw new Error(`credit_purchase ${session.id}: ${grant.code || 'GRANT_FAILED'}`);
    }
    if (grant.alreadyProcessed) {
      console.log(`⏭  credit_purchase ${session.id} — already processed`);
      return;
    }

    // Send confirmation email via nodemailer.
    const transporter = createTransporter();

    await transporter.sendMail({
      _log: {
        purpose: 'credit.purchase_confirmation',
        learnerId,
        schoolId,
      },
      from:    'CoachCarter <bookings@coachcarter.uk>',
      to:      learnerEmail,
      subject: `${hoursStr} hours added to your account`,
      html: `
        <h1>Your hours are ready to book.</h1>
        <p>We've added <strong>${hoursStr} hours</strong> to your CoachCarter account.</p>
        <p><strong>Amount paid:</strong> £${(amountPence / 100).toFixed(2)}</p>
        <p>Head to your dashboard to book your next lesson.</p>
        <p><a href="https://coachcarter.uk/learner/"
              style="background:#f58321;color:#fff;padding:14px 28px;text-decoration:none;
                     border-radius:8px;display:inline-block;font-weight:bold;">
          Book a lesson →
        </a></p>
        <p style="color:#888;font-size:0.85rem;">
          Hours are fully refundable. Cancel 48+ hours before and the hours
          return to your balance automatically.
        </p>
      `
    });

  } catch (err) {
    console.error('❌ handleCreditPurchase error:', err);
    // Re-throw — dispatcher catches and returns 500 so Stripe retries.
    // uq_credit_tx_session makes a successful retry idempotent (INSERT
    // either succeeds the first time or hits the unique violation that
    // we already treat as "already processed" inside this handler).
    throw err;
  }
}

// ── Booking-insert-failed safety net ────────────────────────────────────────
// Called from both handleSlotBooking and handleOfferBooking when the DB INSERT
// throws after we've already taken the learner's money. Previously these paths
// silently returned (only a console.error), so Beatriz / Simon 2026-05-19
// happened: payment captured, no booking, no email, no alert. Now:
//   1. Email Fraser via reportError() with full context
//   2. Email the learner so they know we have their money and will be in touch
// The credit_transactions row is intentionally left in place — accounting ties
// to Stripe, and the orphan can be found with:
//   WHERE type='slot_purchase' AND NOT EXISTS (matching lesson_booking)
async function notifyBookingInsertFailed({ session, kind, learnerEmail, instructorName, scheduledDate, startTime, endTime, amountPence, insertErr }) {
  // 1. Alert email to Fraser
  try {
    reportError(`/api/webhook (${kind} insert failed)`, new Error(
      `Booking insert failed after paid Stripe session ${session.id}. ` +
      `Learner email: ${learnerEmail || '(unknown)'}, instructor: ${instructorName || '(unknown)'}, ` +
      `slot: ${scheduledDate} ${startTime}–${endTime}, amount: £${(amountPence / 100).toFixed(2)}. ` +
      `Underlying error: ${insertErr?.message || insertErr}. ` +
      `Action required: either book the slot manually (payment_method='credit' deducts the hours already on the learner's account) or refund the learner via Stripe.`
    ));
  } catch (e) {
    console.error('notifyBookingInsertFailed: reportError threw', e);
  }

  // 2. Email the learner — only if we have an email address
  if (!learnerEmail) return;
  try {
    const transporter = createTransporter();
    await transporter.sendMail({
      _log: {
        purpose: 'booking.insert_failed_apology',
      },
      from: 'CoachCarter <bookings@coachcarter.uk>',
      to: learnerEmail,
      subject: 'Your payment went through — booking on hold',
      html: `
        <h2>We've received your payment</h2>
        <p>Thanks for booking with CoachCarter. Your payment of <strong>£${(amountPence / 100).toFixed(2)}</strong> was successful and the funds are safely with us.</p>
        <p>However, we hit a technical snag finalising the booking on our end. Nothing to worry about — your money is safe and the hours are on your account.</p>
        <p><strong>What happens next:</strong> ${instructorName || 'Your instructor'} or our team will contact you within 24 hours to either confirm the slot manually or arrange a refund if it can't be honoured.</p>
        <p>If you'd rather not wait, reply to this email or text us and we'll sort it straight away.</p>
        <p style="color:#888;font-size:0.85rem;margin-top:24px">
          Reference: ${session.id.slice(-12)}<br>
          Requested slot: ${scheduledDate} at ${startTime}
        </p>
      `
    });
  } catch (mailErr) {
    console.error('notifyBookingInsertFailed: learner email failed', mailErr);
  }
}

// ── Slot booking handler (pay-per-slot) ─────────────────────────────────────
async function handleSlotBooking(session) {
  if (!isPaid(session)) return;

  const metadata      = session.metadata || {};
  const learnerId     = parseInt(metadata.learner_id, 10);
  const instructorId  = parseInt(metadata.instructor_id, 10);
  const learnerEmail  = metadata.learner_email || session.customer_email;
  const instructorName = metadata.instructor_name;
  const scheduledDate = metadata.scheduled_date;
  const startTime     = metadata.start_time;
  const endTime       = metadata.end_time;
  const amountPence   = parseInt(metadata.amount_pence, 10);
  const lessonTypeId  = metadata.lesson_type_id ? parseInt(metadata.lesson_type_id, 10) : null;
  const durationMins  = parseInt(metadata.duration_minutes, 10) || 90;

  if (!learnerId || !instructorId || !scheduledDate || !startTime || !endTime) {
    console.error('❌ slot_booking webhook missing required metadata', metadata);
    return;
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const schoolId = await resolveSchoolId(sql, metadata, session.id);

    // Idempotency check
    const [existing] = await sql`
      SELECT id FROM credit_transactions WHERE stripe_session_id = ${session.id}
    `;
    if (existing) {
      return;
    }

    // Snapshot the Stripe processing fee (Step 4f.b). NULL on failure; the
    // reconcile cron (4f.e) backfills, and the payout pipeline treats NULL
    // as zero in the meantime.
    const { feePence: stripeFeePence } = await fetchSessionFeePence(session);

    // 1. Record the transaction. uq_credit_tx_session backstops the
    // SELECT idempotency check above against concurrent retries.
    try {
      await sql`
        INSERT INTO credit_transactions
          (learner_id, type, credits, amount_pence, payment_method, stripe_session_id, minutes, school_id, stripe_fee_pence)
        VALUES
          (${learnerId}, 'slot_purchase', 1, ${amountPence}, 'card', ${session.id}, ${durationMins}, ${schoolId}, ${stripeFeePence})
      `;
    } catch (insertErr) {
      if (insertErr.message?.includes('uq_credit_tx_session') || insertErr.code === '23505') {
        console.log(`⏭  slot_booking ${session.id} — already processed (uq_credit_tx_session)`);
        return;
      }
      throw insertErr;
    }

    // 2. Add hours to balance (net zero — add then deduct)
    await sql`
      UPDATE learner_users
      SET credit_balance = credit_balance + 1,
          balance_minutes = balance_minutes + ${durationMins}
      WHERE id = ${learnerId}
    `;

    // 3. Immediately deduct hours and create the booking
    const [deducted] = await sql`
      UPDATE learner_users
      SET credit_balance = credit_balance - 1,
          balance_minutes = balance_minutes - ${durationMins}
      WHERE id = ${learnerId} AND balance_minutes >= ${durationMins}
      RETURNING credit_balance, balance_minutes
    `;

    if (!deducted) {
      console.error('❌ slot_booking: failed to deduct hours after adding — race condition?');
      return;
    }

    // 4. Create the booking. stripe_fee_pence + 'balance_transaction' source —
    // one charge funds exactly one booking on this path, so the full fee
    // attributes directly. NULL stays NULL if the fee fetch failed at webhook
    // time; the reconcile cron (4f.e) backfills.
    let booking;
    try {
      const [b] = await sql`
        INSERT INTO lesson_bookings
          (learner_id, instructor_id, scheduled_date, start_time, end_time, status,
           lesson_type_id, minutes_deducted, school_id,
           stripe_fee_pence, stripe_fee_source)
        VALUES
          (${learnerId}, ${instructorId}, ${scheduledDate}, ${startTime}, ${endTime}, ${SCHEDULED},
           ${lessonTypeId}, ${durationMins}, ${schoolId},
           ${stripeFeePence}, ${stripeFeePence != null ? 'balance_transaction' : null})
        RETURNING id, scheduled_date, start_time::text, end_time::text
      `;
      booking = b;
    } catch (insertErr) {
      // Booking insert failed (slot taken, FK / CHECK violation, etc.). Refund
      // the deduction so the learner has the hours on their account, then
      // alert Fraser + email the learner — see notifyBookingInsertFailed.
      await sql`
        UPDATE learner_users
        SET credit_balance = credit_balance + 1,
            balance_minutes = balance_minutes + ${durationMins}
        WHERE id = ${learnerId}
      `;
      console.error('❌ slot_booking: insert failed, hours refunded to learner balance', insertErr.message);
      await notifyBookingInsertFailed({
        session, kind: 'slot_booking',
        learnerEmail, instructorName,
        scheduledDate, startTime, endTime,
        amountPence, insertErr
      });
      return;
    }

    // 5a. Supersede any pending broadcast offers on this slot — a learner just
    // booked it through the guest-checkout flow, so the broadcast is moot.
    // Fire-and-forget; sends "no longer available" to other broadcast recipients.
    try {
      const { supersedeBroadcastSiblings } = require('./_notify-availability');
      supersedeBroadcastSiblings({
        instructor_id: instructorId,
        scheduled_date: scheduledDate,
        start_time: startTime,
        school_id: schoolId
      }).catch(err => console.warn('supersede on guest-book failed:', err.message));
    } catch (e) {}

    // 5. Clean up the reservation
    try {
      await sql`DELETE FROM slot_reservations WHERE stripe_session_id = ${session.id}`;
    } catch (e) {
      // Table may not exist — that's fine
    }

    // 6. Get instructor & learner details for notifications
    const [instructor] = await sql`
      SELECT email, phone FROM instructors WHERE id = ${instructorId}
    `;
    const [learner] = await sql`
      SELECT name, email, phone FROM learner_users WHERE id = ${learnerId}
    `;

    const balanceHrs = ((deducted.balance_minutes || 0) / 60).toFixed(1);
    const durationStr = durationMins >= 60
      ? (durationMins % 60 === 0 ? `${durationMins / 60} hour${durationMins / 60 !== 1 ? 's' : ''}` : `${(durationMins / 60).toFixed(1)} hours`)
      : `${durationMins} mins`;

    // 7. Send confirmation emails
    const transporter = createTransporter();
    const isoDate1 = scheduledDate instanceof Date ? scheduledDate.toISOString().slice(0, 10) : String(scheduledDate).slice(0, 10);
    const lessonDate = new Date(isoDate1 + 'T00:00:00Z')
      .toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    const lessonTime = `${startTime} – ${endTime}`;

    // Generate .ics calendar attachment
    const icsContent = generateICS({
      id: booking.id,
      scheduled_date: scheduledDate,
      start_time: startTime,
      end_time: endTime,
      instructor_name: instructorName,
      duration_str: durationStr
    });

    // Email to learner
    await transporter.sendMail({
      _log: {
        purpose: 'booking.slot_confirmation_learner',
        learnerId,
        instructorId,
        schoolId,
      },
      from:    'CoachCarter <bookings@coachcarter.uk>',
      to:      learnerEmail,
      subject: `Lesson confirmed — ${lessonDate} at ${startTime}`,
      html: `
        <h1>Lesson confirmed.</h1>
        <p>Your payment of <strong>£${(amountPence / 100).toFixed(2)}</strong> was successful and your lesson is booked.</p>
        <table>
          <tr><td><strong>Date:</strong></td><td>${lessonDate}</td></tr>
          <tr><td><strong>Time:</strong></td><td>${lessonTime}</td></tr>
          <tr><td><strong>Instructor:</strong></td><td>${instructorName}</td></tr>
          <tr><td><strong>Duration:</strong></td><td>${durationStr}</td></tr>
          <tr><td><strong>Hours remaining:</strong></td><td>${balanceHrs} hrs</td></tr>
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
        filename: `coachcarter-lesson-${scheduledDate}.ics`,
        content:  icsContent,
        contentType: 'text/calendar; method=PUBLISH'
      }]
    });

    // Email to instructor
    if (instructor?.email) {
      await transporter.sendMail({
        _log: {
          purpose: 'booking.slot_confirmation_instructor',
          learnerId,
          instructorId,
          schoolId,
        },
        from:    'CoachCarter <system@coachcarter.uk>',
        to:      instructor.email,
        subject: `New booking — ${lessonDate} at ${startTime}`,
        html: `
          <h2>New lesson booked</h2>
          <table>
            <tr><td><strong>Learner:</strong></td><td>${learner?.name || 'Unknown'}</td></tr>
            <tr><td><strong>Email:</strong></td><td>${learnerEmail}</td></tr>
            <tr><td><strong>Date:</strong></td><td>${lessonDate}</td></tr>
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

    // WhatsApp notifications (non-blocking)
    sendWhatsApp(learner?.phone,
      `✅ Lesson confirmed!\n\n📅 ${lessonDate}\n⏰ ${lessonTime}\n🚗 Instructor: ${instructorName}\n\nNeed to cancel? Do so at least 48 hours before and the lesson returns to your balance.\n\nView bookings: https://coachcarter.uk/learner/`,
      { purpose: 'booking.slot_confirmation_learner', learnerId, instructorId, schoolId }
    );
    sendWhatsApp(instructor?.phone,
      `📋 New booking!\n\n👤 ${learner?.name || 'Unknown'}\n📅 ${lessonDate}\n⏰ ${lessonTime}\n\nView schedule: https://coachcarter.uk/instructor/`,
      { purpose: 'booking.slot_confirmation_instructor', learnerId, instructorId, schoolId }
    );

  } catch (err) {
    console.error('❌ handleSlotBooking error:', err);
    // Re-throw — dispatcher catches and returns 500 so Stripe retries.
    // Inner booking-insert failures already alert + refund the learner via
    // notifyBookingInsertFailed and return early (no throw), so this path
    // only fires on errors before/after the booking insert window — which
    // are idempotent under retry (uq_credit_tx_session + idempotent UPDATEs).
    throw err;
  }
}

// Generate .ics calendar file for slot bookings
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
    `DESCRIPTION:${booking.duration_str || '1.5 hours'} driving lesson with ${booking.instructor_name}.\\n\\nManage your bookings: https://coachcarter.uk/learner/book.html`,
    'STATUS:CONFIRMED',
    'BEGIN:VALARM',
    'TRIGGER:-PT2H',
    'ACTION:DISPLAY',
    'DESCRIPTION:Driving lesson in 2 hours',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
}

function toICSDate(dateStr, timeStr) {
  const d = dateStr.replace(/-/g, '');
  const t = timeStr.replace(/:/g, '').slice(0, 6);
  return `${d}T${t.padEnd(6, '0')}`;
}

// ── Legacy checkout handler — RETIRED 2026-05-19 (PR-J, audit #13) ──────────
// handleCheckoutComplete + its helpers (sendCustomerConfirmation, notifyStaff,
// sendAvailabilityFormLink, getPackageDisplayName, incrementGuaranteePrice)
// used an in-memory Map that evaporated on serverless cold start. The only
// callers were /api/create-checkout-session (also retired in PR-J) routing
// payg / bulk / pass_guarantee / core_* package types. All retired flows
// either move to /api/credits?action=checkout (bulk hours via login wall) or
// to /learner/book.html (PAYG). Unknown payment_type now alerts via
// reportError in the dispatcher above rather than silently dropping money.

// ── Lesson offer handler ─────────────────────────────────────────────────────
// Instructor created an offer, learner accepted and paid via Stripe.
async function handleOfferBooking(session) {
  if (!isPaid(session)) return;

  const metadata       = session.metadata || {};
  const offerToken     = metadata.offer_token;
  const offerId        = parseInt(metadata.offer_id, 10);
  const instructorId   = parseInt(metadata.instructor_id, 10);
  const instructorName = metadata.instructor_name;
  const learnerEmail   = metadata.learner_email || session.customer_email;
  const learnerName    = metadata.learner_name || session.customer_details?.name || '';
  const learnerPhone   = metadata.learner_phone || '';
  const pickupAddress  = metadata.pickup_address || '';
  const scheduledDate  = metadata.scheduled_date;
  const startTime      = metadata.start_time;
  const endTime        = metadata.end_time;
  const amountPence    = parseInt(metadata.amount_pence, 10);
  const lessonTypeId   = metadata.lesson_type_id ? parseInt(metadata.lesson_type_id, 10) : null;
  const durationMins   = parseInt(metadata.duration_minutes, 10) || 90;

  const isFlexible = metadata.is_flexible === '1';
  const repeatWeeks = Math.max(1, parseInt(metadata.repeat_weeks, 10) || 1);
  if (!offerToken || !instructorId || (!isFlexible && (!scheduledDate || !startTime || !endTime))) {
    console.error('❌ lesson_offer webhook missing required metadata', metadata);
    return;
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const schoolId = await resolveSchoolId(sql, metadata, session.id);

    // Idempotency — check offer hasn't already been processed
    const [offer] = await sql`
      SELECT id, status FROM lesson_offers WHERE token = ${offerToken}
    `;
    if (!offer) {
      console.error('❌ lesson_offer webhook: offer not found for token', offerToken);
      return;
    }
    if (offer.status === 'accepted') {
      return;
    }

    // 1. Find or create learner
    let learnerId;
    const [existingLearner] = await sql`
      SELECT id, name, phone, pickup_address FROM learner_users WHERE LOWER(email) = LOWER(${learnerEmail})
    `;

    if (existingLearner) {
      learnerId = existingLearner.id;
      // Update only NULL/empty fields — never overwrite existing data
      const updates = {};
      if (!existingLearner.name && learnerName) updates.name = learnerName;
      if (!existingLearner.phone && learnerPhone) updates.phone = learnerPhone;
      if (!existingLearner.pickup_address && pickupAddress) updates.pickup_address = pickupAddress;

      if (Object.keys(updates).length > 0) {
        await sql`
          UPDATE learner_users SET
            name = COALESCE(NULLIF(name, ''), ${updates.name || null}),
            phone = COALESCE(phone, ${updates.phone || null}),
            pickup_address = COALESCE(NULLIF(pickup_address, ''), ${updates.pickup_address || null})
          WHERE id = ${learnerId}
        `;
      }
    } else {
      // Create new learner from offer details + Stripe customer_details
      try {
        const [newLearner] = await sql`
          INSERT INTO learner_users (name, email, phone, pickup_address, balance_minutes, credit_balance, school_id)
          VALUES (${learnerName}, ${learnerEmail.toLowerCase()}, ${learnerPhone || null},
                  ${pickupAddress || null}, 0, 0, ${schoolId})
          RETURNING id
        `;
        learnerId = newLearner.id;
      } catch (insertErr) {
        if (insertErr.message?.includes('learner_users_phone_key') || insertErr.message?.includes('unique')) {
          // Phone already in use — retry without phone
          console.warn('⚠️ Phone conflict creating learner, retrying without phone');
          const [newLearner] = await sql`
            INSERT INTO learner_users (name, email, pickup_address, balance_minutes, credit_balance, school_id)
            VALUES (${learnerName}, ${learnerEmail.toLowerCase()}, ${pickupAddress || null}, 0, 0, ${schoolId})
            RETURNING id
          `;
          learnerId = newLearner.id;
        } else {
          throw insertErr;
        }
      }
    }

    // 2. Record the transaction (add-then-deduct pattern for consistency).
    // For repeat-weeks series, amountPence is per-lesson and Stripe charged
    // amountPence × repeatWeeks via line-item quantity.
    const totalAmountPence = amountPence * repeatWeeks;
    const totalMinutes     = durationMins * repeatWeeks;
    const totalCredits     = repeatWeeks;

    // Snapshot the Stripe processing fee (Step 4f.b). NULL on failure; the
    // reconcile cron (4f.e) backfills, and the payout pipeline treats NULL
    // as zero in the meantime. For repeat-weeks series this is the fee on
    // the FULL charge (totalAmountPence) — Step 4g splits it pro-rata across
    // the N bookings via booking_credit_sources.
    const { feePence: stripeFeePence } = await fetchSessionFeePence(session);

    // uq_credit_tx_session catches concurrent Stripe retries on the same
    // offer-acceptance event. SELECT idempotency above is the fast path;
    // this is the DB-enforced backstop.
    try {
      await sql`
        INSERT INTO credit_transactions
          (learner_id, type, credits, amount_pence, payment_method, stripe_session_id, minutes, school_id, stripe_fee_pence)
        VALUES
          (${learnerId}, 'slot_purchase', ${totalCredits}, ${totalAmountPence}, 'card', ${session.id}, ${totalMinutes}, ${schoolId}, ${stripeFeePence})
      `;
    } catch (insertErr) {
      if (insertErr.message?.includes('uq_credit_tx_session') || insertErr.code === '23505') {
        console.log(`⏭  lesson_offer ${session.id} — already processed (uq_credit_tx_session)`);
        return;
      }
      throw insertErr;
    }

    await sql`
      UPDATE learner_users
      SET credit_balance = credit_balance + ${totalCredits},
          balance_minutes = balance_minutes + ${totalMinutes}
      WHERE id = ${learnerId}
    `;

    // ── Flexible offers: credit the learner, skip booking (they pick their own slot) ──
    if (isFlexible) {
      // Leave credit on learner's balance — no deduct, no booking
      await sql`
        UPDATE lesson_offers
        SET status = 'accepted', learner_id = ${learnerId}, accepted_at = NOW()
        WHERE id = ${offerId}
      `;

      const [instructor] = await sql`SELECT name, email FROM instructors WHERE id = ${instructorId}`;
      const [learner] = await sql`SELECT name FROM learner_users WHERE id = ${learnerId}`;
      const transporter = createTransporter();
      const firstName = (learner?.name || '').split(' ')[0] || 'there';
      const durationStr = durationMins >= 60
        ? (durationMins % 60 === 0 ? `${durationMins / 60} hour${durationMins / 60 !== 1 ? 's' : ''}` : `${(durationMins / 60).toFixed(1)} hours`)
        : `${durationMins} mins`;

      await transporter.sendMail({
        _log: {
          purpose: 'offer.flexible_accepted_learner',
          learnerId,
          instructorId,
          schoolId,
        },
        from:    'CoachCarter <bookings@coachcarter.uk>',
        to:      learnerEmail,
        subject: `Payment received — book your ${durationStr} lesson`,
        html: `
          <h1>Payment received!</h1>
          <p>Hi ${firstName}, your payment of <strong>£${(amountPence / 100).toFixed(2)}</strong> was successful.</p>
          <p>You now have <strong>${durationStr}</strong> of lesson credit. Book a time that works for you:</p>
          <p style="margin:24px 0">
            <a href="https://coachcarter.uk/learner/book.html"
               style="background:#f58321;color:white;padding:14px 28px;text-decoration:none;border-radius:8px;display:inline-block;font-weight:bold;font-size:1rem">
              Book a lesson →
            </a>
          </p>
        `
      });

      if (instructor?.email) {
        await transporter.sendMail({
          _log: {
            purpose: 'offer.flexible_accepted_instructor',
            learnerId,
            instructorId,
            schoolId,
          },
          from:    'CoachCarter <system@coachcarter.uk>',
          to:      instructor.email,
          subject: `Flexible offer accepted — ${learner?.name || learnerEmail} has paid`,
          html: `
            <h2>Flexible offer accepted!</h2>
            <p>${learner?.name || learnerEmail} has paid for a ${durationStr} lesson. They'll book a time from the slot feed.</p>
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
      return;
    }

    // ── Slot-pinned offers: deduct credit and create booking(s) ──
    const [deducted] = await sql`
      UPDATE learner_users
      SET credit_balance = credit_balance - ${totalCredits},
          balance_minutes = balance_minutes - ${totalMinutes}
      WHERE id = ${learnerId} AND balance_minutes >= ${totalMinutes}
      RETURNING credit_balance, balance_minutes
    `;

    if (!deducted) {
      console.error('❌ lesson_offer: failed to deduct hours after adding — race condition?');
      return;
    }

    // 3. Create the booking(s) — single lesson, or weekly series with skip-clash.
    const { bookOfferSeries } = require('./offers');
    let booking;
    let seriesResult;
    try {
      seriesResult = await bookOfferSeries(sql, {
        instructorId,
        learnerId,
        firstDate: scheduledDate,
        startTime,
        endTime,
        lessonTypeId,
        durationMins,
        pickupAddress: pickupAddress || null,
        schoolId,
        repeatWeeks,
        paymentMethod: 'card',
        totalStripeFeePence: stripeFeePence
      });
      booking = { id: seriesResult.booked[0].booking_id, scheduled_date: scheduledDate, start_time: startTime, end_time: endTime };
    } catch (insertErr) {
      // Booking insert failed (slot taken, FK / CHECK violation, etc.). Refund
      // the deduction so the learner has the hours on their account, mark the
      // offer cancelled, then alert Fraser + email the learner — see
      // notifyBookingInsertFailed.
      await sql`
        UPDATE learner_users
        SET credit_balance = credit_balance + ${totalCredits},
            balance_minutes = balance_minutes + ${totalMinutes}
        WHERE id = ${learnerId}
      `;
      console.error('❌ lesson_offer: insert failed, hours refunded to learner balance', insertErr.message);
      await sql`UPDATE lesson_offers SET status = 'cancelled' WHERE id = ${offerId}`;
      await notifyBookingInsertFailed({
        session, kind: 'lesson_offer',
        learnerEmail, instructorName,
        scheduledDate, startTime, endTime,
        amountPence, insertErr
      });
      return;
    }

    // If we couldn't book all the requested weeks (skip-clash hit the 18-week
    // lookahead boundary), refund the unused weeks via Stripe. Balance is
    // already net-zero from the add-then-deduct above and the bookings each
    // recorded their own minutes_deducted, so no further balance change is
    // needed — only a money refund.
    const bookedCount = seriesResult.booked.length;
    if (bookedCount < repeatWeeks) {
      const unused = repeatWeeks - bookedCount;
      try {
        if (session.payment_intent) {
          await stripe.refunds.create({
            payment_intent: session.payment_intent,
            amount: amountPence * unused,
            reason: 'requested_by_customer',
            metadata: { offer_id: String(offerId), unused_weeks: String(unused) }
          });
        }
      } catch (refundErr) {
        console.error('❌ lesson_offer: partial refund failed', refundErr.message);
      }
    }

    // 4. Update the offer
    const [acceptedOffer] = await sql`
      UPDATE lesson_offers
      SET status = 'accepted', booking_id = ${booking.id}, learner_id = ${learnerId},
          accepted_at = NOW()
      WHERE id = ${offerId}
      RETURNING kind, batch_id
    `;

    // 4b. If this was a broadcast offer, supersede sibling rows in the batch
    // and send "no longer available" follow-up to those losers (fire-and-forget).
    if (acceptedOffer?.kind === 'broadcast') {
      const { supersedeBroadcastSiblings } = require('./_notify-availability');
      supersedeBroadcastSiblings({
        instructor_id: instructorId,
        scheduled_date: scheduledDate,
        start_time: startTime,
        school_id: schoolId,
        winnerOfferId: offerId,
        batchId: acceptedOffer.batch_id
      }).catch(err => console.warn('supersede siblings failed:', err.message));
    }

    // 5. Send confirmation emails
    const [instructor] = await sql`SELECT name, email, phone FROM instructors WHERE id = ${instructorId}`;
    const [learner] = await sql`SELECT name, email, phone FROM learner_users WHERE id = ${learnerId}`;

    const durationStr = durationMins >= 60
      ? (durationMins % 60 === 0 ? `${durationMins / 60} hour${durationMins / 60 !== 1 ? 's' : ''}` : `${(durationMins / 60).toFixed(1)} hours`)
      : `${durationMins} mins`;
    const isoDate2 = scheduledDate instanceof Date ? scheduledDate.toISOString().slice(0, 10) : String(scheduledDate).slice(0, 10);
    const lessonDate = new Date(isoDate2 + 'T00:00:00Z')
      .toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    const lessonTime = `${startTime} – ${endTime}`;

    // Generate .ics calendar attachment
    const icsContent = generateICS({
      id: booking.id,
      scheduled_date: scheduledDate,
      start_time: startTime,
      end_time: endTime,
      instructor_name: instructorName,
      duration_str: durationStr
    });

    const transporter = createTransporter();
    const firstName = (learner?.name || '').split(' ')[0] || 'there';

    // Email to learner
    const isSeries = (seriesResult?.booked?.length || 1) > 1;
    const seriesListHtml = isSeries
      ? '<ul style="padding-left:18px;margin:8px 0">' + seriesResult.booked.map(b => {
          const ds = new Date(b.date + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
          return `<li>${ds} at ${startTime} – ${endTime}</li>`;
        }).join('') + '</ul>'
      : '';
    const skippedNote = (isSeries && seriesResult.skipped.length > 0)
      ? `<p style="font-size:0.85rem;color:#797879">We rolled past ${seriesResult.skipped.length} week${seriesResult.skipped.length === 1 ? '' : 's'} where ${instructorName} was unavailable.</p>`
      : '';
    // Stripe charged amountPence × repeatWeeks. If we couldn't fill all weeks,
    // we've already issued a partial refund above, so the net charge is the
    // per-lesson price × the number we actually booked.
    const totalChargedPence = amountPence * bookedCount;

    await transporter.sendMail({
      _log: {
        purpose: 'offer.accepted_learner',
        learnerId,
        instructorId,
        schoolId,
      },
      from:    'CoachCarter <bookings@coachcarter.uk>',
      to:      learnerEmail,
      subject: isSeries
        ? `${bookedCount} lessons confirmed with ${instructorName}`
        : `Lesson confirmed — ${lessonDate} at ${startTime}`,
      html: `
        <h1>${isSeries ? 'Lessons confirmed!' : 'Lesson confirmed!'}</h1>
        <p>Hi ${firstName}, your payment of <strong>£${(totalChargedPence / 100).toFixed(2)}</strong> was successful and your ${isSeries ? `${bookedCount} weekly lessons are` : 'lesson is'} booked.</p>
        ${isSeries ? `<p><strong>Your weekly lessons with ${instructorName}:</strong></p>${seriesListHtml}${skippedNote}` : `
        <table>
          <tr><td><strong>Date:</strong></td><td>${lessonDate}</td></tr>
          <tr><td><strong>Time:</strong></td><td>${lessonTime}</td></tr>
          <tr><td><strong>Instructor:</strong></td><td>${instructorName}</td></tr>
          <tr><td><strong>Duration:</strong></td><td>${durationStr}</td></tr>
        </table>`}
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
        filename: `coachcarter-lesson-${scheduledDate}.ics`,
        content:  icsContent,
        contentType: 'text/calendar; method=PUBLISH'
      }]
    });

    // Email to instructor
    if (instructor?.email) {
      await transporter.sendMail({
        _log: {
          purpose: 'offer.accepted_instructor',
          learnerId,
          instructorId,
          schoolId,
        },
        from:    'CoachCarter <system@coachcarter.uk>',
        to:      instructor.email,
        subject: isSeries
          ? `Offer accepted — ${learner?.name || learnerEmail} booked ${bookedCount} weekly lessons`
          : `Offer accepted — ${learner?.name || learnerEmail} on ${lessonDate}`,
        html: `
          <h2>${isSeries ? 'Weekly lesson series accepted!' : 'Lesson offer accepted!'}</h2>
          <p>${learner?.name || learnerEmail} has accepted your lesson offer and paid £${(totalChargedPence / 100).toFixed(2)}.</p>
          ${isSeries ? `<p><strong>Booked weeks:</strong></p>${seriesListHtml}${skippedNote}` : `
          <table>
            <tr><td><strong>Learner:</strong></td><td>${learner?.name || 'New learner'}</td></tr>
            <tr><td><strong>Email:</strong></td><td>${learnerEmail}</td></tr>
            <tr><td><strong>Date:</strong></td><td>${lessonDate}</td></tr>
            <tr><td><strong>Time:</strong></td><td>${lessonTime}</td></tr>
          </table>`}
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

  } catch (err) {
    console.error('❌ handleOfferBooking error:', err);
    // Re-throw — dispatcher catches and returns 500 so Stripe retries.
    // Idempotency: offer.status='accepted' short-circuits on retry, and
    // uq_credit_tx_session catches concurrent retries of the same session.
    throw err;
  }
}

// Helper to get raw body for Stripe
async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}
