const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { neon } = require('@neondatabase/serverless');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { sendWhatsApp } = require('./_whatsapp');
const { reportError } = require('./_error-alert');
const { createTransporter } = require('./_auth-helpers');
const { SCHEDULED, BLOCKING_STATUSES, blocksSlot, isTerminal } = require('./_booking-status');
const { fetchSessionFeePence } = require('./_stripe-fee');
const { grantCredits, lockBalanceAdjustLCB } = require('./_credit-grant');
const { splitFifoPlanAcrossBookings } = require('./_bcs-booking-plan');
const { withNeonTransaction } = require('./_db-transaction');


function concreteLessonTransmissionType(value) {
  const text = String(value || '').trim().toLowerCase();
  return text === 'automatic' ? 'automatic' : 'manual';
}

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
    // Some async payment methods deliver `completed` early with
    // payment_status='unpaid', then fire `async_payment_succeeded` once the
    // payment actually clears. Immediate methods usually fire `completed`
    // already paid. We route both events through the same dispatch.
    if (event.type === 'checkout.session.completed' ||
        event.type === 'checkout.session.async_payment_succeeded') {
      const session = event.data.object;
      const paymentType = session.metadata?.payment_type;

      if (paymentType === 'credit_purchase') {
        // Historical Lesson Credit purchase compatibility.
        await handleCreditPurchase(session);
      } else if (paymentType === 'slot_booking') {
        // ── Pay-per-slot: single lesson purchase + instant booking ─────
        await handleSlotBooking(session);
      } else if (paymentType === 'lesson_offer') {
        // ── Instructor-initiated offer: learner accepted + paid ────────
        await handleOfferBooking(session);
      } else if (paymentType === 'recurring_block_bank_checkout') {
        // Reserved Weekly Slot Pay by Bank: convert held block on success.
        await handleRecurringBlockBankPaymentSuccess(session);
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

    // Async payment failure / cancellation — log only. No DB writes happened
    // on an earlier unpaid `completed` event because handlers gate on
    // payment_status='paid'. No retry needed (Stripe won't re-charge).
    if (event.type === 'payment_intent.succeeded') {
      const paymentIntent = event.data.object;
      const paymentType = paymentIntent.metadata?.payment_type;

      if (paymentType === 'credit_purchase') {
        await handleCreditPurchase(paymentIntentToCreditSession(paymentIntent));
      } else if (paymentType === 'recurring_block_bank_checkout') {
        await handleRecurringBlockBankPaymentSuccess(paymentIntentToRecurringBlockSession(paymentIntent));
      }
    }

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
      if (session.metadata?.payment_type === 'recurring_block_bank_checkout') {
        await handleRecurringBlockBankPaymentRelease(session, 'payment_failed');
      }
    }

    if (event.type === 'checkout.session.expired') {
      const session = event.data.object;
      if (session.metadata?.payment_type === 'recurring_block_bank_checkout') {
        await handleRecurringBlockBankPaymentRelease(session, 'expired');
      }
    }

    if (event.type === 'payment_intent.payment_failed') {
      const paymentIntent = event.data.object;
      if (paymentIntent.metadata?.payment_type === 'recurring_block_bank_checkout') {
        await handleRecurringBlockBankPaymentRelease(paymentIntentToRecurringBlockSession(paymentIntent), 'payment_failed');
      }
    }

    if (event.type === 'charge.failed') {
      const charge = event.data.object;
      if (charge.metadata?.payment_type === 'recurring_block_bank_checkout') {
        await handleRecurringBlockBankPaymentRelease(chargeToRecurringBlockSession(charge), 'payment_failed');
      }
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

// Don't process unpaid sessions. Async payment methods can fire `completed`
// before the payment clears; the follow-up `async_payment_succeeded` event
// re-runs this handler with status='paid'.
function isPaid(session) {
  if (session.payment_status === 'paid') return true;
  console.log(`⏭  Skipping ${session.id} — payment_status=${session.payment_status} (will re-run on async_payment_succeeded)`);
  return false;
}

// ── Credit purchase handler ───────────────────────────────────────────────────
function paymentIntentToCreditSession(paymentIntent) {
  return {
    id: paymentIntent.id,
    object: 'payment_intent',
    payment_status: paymentIntent.status === 'succeeded' ? 'paid' : paymentIntent.status,
    payment_method_types: paymentIntent.payment_method_types || ['card'],
    payment_intent: paymentIntent.id,
    metadata: paymentIntent.metadata || {},
    customer_email: paymentIntent.receipt_email || null,
  };
}

function paymentIntentToRecurringBlockSession(paymentIntent) {
  return {
    id: paymentIntent.id,
    object: 'payment_intent',
    payment_status: paymentIntent.status === 'succeeded' ? 'paid' : paymentIntent.status,
    payment_intent: paymentIntent.id,
    metadata: paymentIntent.metadata || {},
  };
}

function chargeToRecurringBlockSession(charge) {
  return {
    id: charge.id,
    object: 'charge',
    payment_status: charge.status === 'succeeded' ? 'paid' : charge.status,
    payment_intent: typeof charge.payment_intent === 'string'
      ? charge.payment_intent
      : charge.payment_intent?.id || null,
    metadata: charge.metadata || {},
  };
}

function stripePaymentIntentId(session) {
  if (!session) return null;
  if (session.object === 'payment_intent') return session.id;
  if (typeof session.payment_intent === 'string') return session.payment_intent;
  return session.payment_intent?.id || null;
}

function splitPenceAcrossItems(totalPence, items) {
  if (totalPence == null) return items.map(() => null);
  const total = Math.max(0, parseInt(totalPence, 10) || 0);
  const weights = items.map(item => Math.max(0, parseInt(item.price_pence, 10) || 0));
  const weightTotal = weights.reduce((sum, value) => sum + value, 0) || items.length;
  let assigned = 0;
  return items.map((_, index) => {
    if (index === items.length - 1) return total - assigned;
    const weight = weightTotal === items.length ? 1 : weights[index];
    const share = Math.floor((total * weight) / weightTotal);
    assigned += share;
    return share;
  });
}

function recurringBlockMetadataPatch(session, extra = {}) {
  return {
    webhook: {
      last_event_object: session.object || null,
      last_event_id: session.id || null,
    },
    ...extra,
  };
}

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

    // Determine the Stripe-reported payment method for historical credit rows.
    const paymentMethod = session.payment_method_types?.[0] || 'card';

    // Calculate minutes: each credit = 90 minutes (standard lesson)
    // Future: metadata.minutes_purchased overrides this
    const minutes = parseInt(metadata.minutes_purchased, 10) || (credits * 90);
    const hoursStr = (minutes / 60) % 1 === 0 ? `${minutes / 60}` : (minutes / 60).toFixed(1);

    // Snapshot the Stripe processing fee (Step 4f.b). NULL on failure; the
    // reconcile cron (4f.e) backfills, and the payout pipeline treats NULL
    // as zero in the meantime.
    const { feePence: stripeFeePence } = await fetchSessionFeePence(session);

    // Step 4 / Phase 2A: source instructor scope + effective rate from the
    // Stripe Session metadata so credits are written against the correct
    // (learner, instructor) LCB row. Metadata is the source of truth per
    // PER-INSTRUCTOR-CREDITS-PLAN.md §Step 0 L239-247. If metadata is missing
    // instructor_id (in-flight session created before checkout sites added
    // it), grantCredits' dispatcher grandfather routes to instructor_id = 1
    // and logs legacy_pre_cutover.
    //
    // effective_rate_pence_per_minute = amountPence / minutes (derived from
    // Stripe-session values rather than a live pricing recall — same source
    // the learner agreed to).
    const instructorIdMeta = parseInt(metadata.instructor_id, 10) || null;
    const effectiveRatePencePerMinute = minutes > 0
      ? Math.round(amountPence / minutes)
      : null;
    const isPaymentIntentOnly = session.object === 'payment_intent';
    const paymentIntentId = typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id || null;

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
      sessionId: isPaymentIntentOnly ? null : session.id,
      stripeFeePence,
      instructorId: instructorIdMeta,
      effectiveRatePencePerMinute,
      paymentIntentId,
      source: 'stripe',
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
          Cancel 48+ hours before a lesson and the lesson credit returns to your balance automatically.
          Approved refunds are returned to the original payment method where possible, minus any non-refundable payment processing fees charged by our payment provider.
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
        <p><strong>What happens next:</strong> ${instructorName || 'Your instructor'} or our team will contact you within 24 hours to either confirm the slot manually or arrange an approved refund if it can't be honoured.</p>
        <p>Approved refunds are returned to the original payment method where possible, minus any non-refundable payment processing fees charged by our payment provider.</p>
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
  const pickupAddress = metadata.pickup_address || '';
  const dropoffAddress = metadata.dropoff_address || '';
  const amountPence   = parseInt(metadata.amount_pence, 10);
  const lessonTypeId  = metadata.lesson_type_id ? parseInt(metadata.lesson_type_id, 10) : null;
  const durationMins  = parseInt(metadata.duration_minutes, 10) || 90;
  const bookingTransmissionType = concreteLessonTransmissionType(metadata.transmission_type);

  if (!learnerId || !instructorId || !scheduledDate || !startTime || !endTime) {
    console.error('❌ slot_booking webhook missing required metadata', metadata);
    return;
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const schoolId = await resolveSchoolId(sql, metadata, session.id);

    // Step 4 / Phase 2A: effective rate is derivable from the Stripe-session
    // amount and minutes — no live pricing recall. instructor_id comes from
    // metadata (already in scope above). payment_intent_id is captured for
    // the uq_credit_tx_payment_intent reconciliation idempotency arbiter.
    const effectiveRatePencePerMinute = durationMins > 0
      ? Math.round(amountPence / durationMins)
      : null;
    const paymentIntentId = typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id || null;

    const [existingCreditTx] = await sql`
      SELECT id, amount_pence, stripe_fee_pence, effective_rate_pence_per_minute
        FROM credit_transactions
       WHERE stripe_session_id = ${session.id}
         AND type = 'slot_purchase'
         AND learner_id = ${learnerId}
         AND instructor_id = ${instructorId}
         AND school_id = ${schoolId}
       LIMIT 1
    `;
    if (existingCreditTx) {
      const existingBooking = await findExistingSlotBooking(sql, {
        learnerId, instructorId, scheduledDate, startTime, endTime, schoolId,
      });
      if (existingBooking && blocksSlot(existingBooking.status)) {
        await ensureSlotBookingBcs(sql, {
          schoolId,
          bookingId: existingBooking.id,
          creditTransaction: existingCreditTx,
          durationMins,
        });
        return;
      }
      if (existingBooking && isTerminal(existingBooking.status)) {
        console.warn(`slot_booking ${session.id} has slot_purchase CT and refunded booking ${existingBooking.id}; not repairing active BCS`);
        return;
      }

      // Existing behaviour for an orphan paid session: once the slot_purchase
      // ledger row exists but no matching booking exists, do not replay the
      // booking/balance/notification path from a retry. The existing failure
      // alert path is responsible for operator recovery.
      console.warn(`slot_booking ${session.id} has slot_purchase CT but no matching booking; leaving orphan recovery to operator flow`);
      return;
    }

    // Snapshot the Stripe processing fee (Step 4f.b). NULL on failure; the
    // reconcile cron (4f.e) backfills, and the payout pipeline treats NULL
    // as zero in the meantime.
    const { feePence: stripeFeePence } = await fetchSessionFeePence(session);

    // 1. Record the transaction. uq_credit_tx_session backstops the
    // SELECT idempotency check above against concurrent retries.
    let slotCreditTx;
    try {
      const [creditTx] = await sql`
        INSERT INTO credit_transactions
          (learner_id, type, credits, amount_pence, payment_method, stripe_session_id, minutes, school_id,
           stripe_fee_pence, instructor_id, effective_rate_pence_per_minute, stripe_payment_intent_id, source)
        VALUES
          (${learnerId}, 'slot_purchase', 1, ${amountPence}, 'card', ${session.id}, ${durationMins}, ${schoolId},
           ${stripeFeePence}, ${instructorId}, ${effectiveRatePencePerMinute}, ${paymentIntentId}, 'stripe')
        RETURNING id, amount_pence, stripe_fee_pence, effective_rate_pence_per_minute
      `;
      slotCreditTx = creditTx;
    } catch (insertErr) {
      if (insertErr.message?.includes('uq_credit_tx_session') || insertErr.code === '23505') {
        const [racedCreditTx] = await sql`
          SELECT id, amount_pence, stripe_fee_pence, effective_rate_pence_per_minute
            FROM credit_transactions
           WHERE stripe_session_id = ${session.id}
             AND type = 'slot_purchase'
             AND learner_id = ${learnerId}
             AND instructor_id = ${instructorId}
             AND school_id = ${schoolId}
           LIMIT 1
        `;
        const racedBooking = await findExistingSlotBooking(sql, {
          learnerId, instructorId, scheduledDate, startTime, endTime, schoolId,
        });
        if (racedCreditTx && racedBooking && blocksSlot(racedBooking.status)) {
          await ensureSlotBookingBcs(sql, {
            schoolId,
            bookingId: racedBooking.id,
            creditTransaction: racedCreditTx,
            durationMins,
          });
        } else if (racedBooking && isTerminal(racedBooking.status)) {
          console.warn(`slot_booking ${session.id} hit uq_credit_tx_session with refunded booking ${racedBooking.id}; not repairing active BCS`);
        } else {
          console.warn(`slot_booking ${session.id} hit uq_credit_tx_session before a matching booking was visible; leaving retry/operator flow unchanged`);
        }
        return;
      }
      throw insertErr;
    }

    // 2. Add hours to balance (net zero — add then deduct). lockBalanceAdjustLCB
    // is the balance-only writer (no separate ledger row — the slot_purchase
    // INSERT above is the single audit-of-record for this Stripe payment).
    // Same chokepoint invariant as grantCredits: locks the LCB row for this
    // (learner, instructor) pair, serialising concurrent writers.
    const addResult = await lockBalanceAdjustLCB(sql, {
      learnerId, instructorId, schoolId,
      delta: durationMins, creditsDelta: 1,
    });
    if (!addResult.ok) {
      console.error('❌ slot_booking: failed to add hours pre-deduct', addResult.code);
      return;
    }

    // 3. Immediately deduct hours and create the booking. allowOverdraft is
    // unnecessary because the matching add above already landed under the
    // same lock, but it's belt-and-braces against a misconfigured edge case.
    const deductResult = await lockBalanceAdjustLCB(sql, {
      learnerId, instructorId, schoolId,
      delta: -durationMins, creditsDelta: -1,
    });
    if (!deductResult.ok) {
      console.error('❌ slot_booking: failed to deduct hours after adding — race condition?', deductResult.code);
      return;
    }

    // 4. Create the booking. stripe_fee_pence + 'balance_transaction' source —
    // one charge funds exactly one booking on this path, so the full fee
    // attributes directly. NULL stays NULL if the fee fetch failed at webhook
    // time; the reconcile cron (4f.e) backfills.
    //
    // list_price_pence snapshot (Step 1b): one Stripe charge → one booking, so
    // metadata.amount_pence IS the per-lesson list price. Tag stripe_metadata
    // per the source-of-truth rule (PER-INSTRUCTOR-CREDITS-PLAN.md §Step 0
    // L239-247): once the Checkout Session is created, the snapshot is frozen
    // and read back from Stripe, never recomputed live.
    let booking;
    try {
      const [b] = await sql`
        INSERT INTO lesson_bookings
          (learner_id, instructor_id, scheduled_date, start_time, end_time, status,
           lesson_type_id, transmission_type, minutes_deducted, school_id,
           pickup_address, dropoff_address,
           stripe_fee_pence, stripe_fee_source,
           list_price_pence, list_price_source)
        VALUES
          (${learnerId}, ${instructorId}, ${scheduledDate}, ${startTime}, ${endTime}, ${SCHEDULED},
           ${lessonTypeId}, ${bookingTransmissionType}, ${durationMins}, ${schoolId},
           ${pickupAddress || null}, ${dropoffAddress || null},
           ${stripeFeePence}, ${stripeFeePence != null ? 'balance_transaction' : null},
           ${amountPence}, 'stripe_metadata')
        RETURNING id, scheduled_date, start_time::text, end_time::text
      `;
      booking = b;
    } catch (insertErr) {
      // Booking insert failed (slot taken, FK / CHECK violation, etc.). Refund
      // the deduction so the learner has the hours on their account, then
      // alert Fraser + email the learner — see notifyBookingInsertFailed.
      await lockBalanceAdjustLCB(sql, {
        learnerId, instructorId, schoolId,
        delta: durationMins, creditsDelta: 1,
      });
      console.error('❌ slot_booking: insert failed, hours refunded to learner balance', insertErr.message);
      await notifyBookingInsertFailed({
        session, kind: 'slot_booking',
        learnerEmail, instructorName,
        scheduledDate, startTime, endTime,
        amountPence, insertErr
      });
      return;
    }

    // 4b. Attribute this direct-paid slot purchase to the booking. One Stripe
    // charge funds exactly one lesson here, so the single slot_purchase source
    // row contributes the full payable amount and fee. The rounded rate is only
    // an audit/display snapshot; contribution_pence is the exact source amount.
    await ensureSlotBookingBcs(sql, {
      schoolId,
      bookingId: booking.id,
      creditTransaction: slotCreditTx,
      durationMins,
    });

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

    const balanceHrs = ((deductResult.balance_minutes || 0) / 60).toFixed(1);
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
          Need to cancel? Do so at least 48 hours before and the lesson credit returns to your balance.
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
      `✅ Lesson confirmed!\n\n📅 ${lessonDate}\n⏰ ${lessonTime}\n🚗 Instructor: ${instructorName}\n\nNeed to cancel? Do so at least 48 hours before and the lesson credit returns to your balance.\n\nView bookings: https://coachcarter.uk/learner/`,
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

async function findExistingSlotBooking(sql, {
  learnerId,
  instructorId,
  scheduledDate,
  startTime,
  endTime,
  schoolId,
}) {
  const bookings = await sql`
    SELECT id, status, scheduled_date, start_time::text, end_time::text
      FROM lesson_bookings
     WHERE learner_id = ${learnerId}
       AND instructor_id = ${instructorId}
       AND scheduled_date = ${scheduledDate}
       AND start_time = ${startTime}
       AND end_time = ${endTime}
       AND school_id = ${schoolId}
     ORDER BY id DESC
  `;
  return bookings.find(booking => blocksSlot(booking.status))
    || bookings.find(booking => isTerminal(booking.status))
    || null;
}

async function ensureSlotBookingBcs(sql, {
  schoolId,
  bookingId,
  creditTransaction,
  durationMins,
}) {
  const bcsStripeFeePence = creditTransaction.stripe_fee_pence ?? 0;
  await sql`
    INSERT INTO booking_credit_sources
      (school_id, booking_id, credit_transaction_id, minutes_drawn,
       rate_pence_per_minute, contribution_pence, stripe_fee_pence, absorbed_by)
    VALUES
      (${schoolId}, ${bookingId}, ${creditTransaction.id}, ${durationMins},
       ${creditTransaction.effective_rate_pence_per_minute}, ${creditTransaction.amount_pence}, ${bcsStripeFeePence}, NULL)
    ON CONFLICT (booking_id, credit_transaction_id) DO NOTHING
  `;
}

async function ensureOfferSeriesBcs(sql, {
  schoolId,
  bookedLessons,
  creditTransaction,
  durationMins,
}) {
  const bookingTargets = bookedLessons.map(booking => ({
    booking_id: booking.booking_id,
    minutes: durationMins,
  }));
  const bcsRows = splitFifoPlanAcrossBookings({
    plannedRows: [{
      credit_transaction_id: creditTransaction.id,
      minutes_drawn: creditTransaction.minutes,
      rate_pence_per_minute: creditTransaction.effective_rate_pence_per_minute,
      contribution_pence: creditTransaction.amount_pence,
      stripe_fee_pence: creditTransaction.stripe_fee_pence ?? 0,
      absorbed_by: null,
      school_id: schoolId,
    }],
    bookingTargets,
  });

  for (const row of bcsRows) {
    await sql`
      INSERT INTO booking_credit_sources
        (school_id, booking_id, credit_transaction_id, minutes_drawn,
         rate_pence_per_minute, contribution_pence, stripe_fee_pence, absorbed_by)
      VALUES
        (${row.school_id}, ${row.booking_id}, ${row.credit_transaction_id}, ${row.minutes_drawn},
         ${row.rate_pence_per_minute}, ${row.contribution_pence}, ${row.stripe_fee_pence}, ${row.absorbed_by})
      ON CONFLICT (booking_id, credit_transaction_id) DO NOTHING
    `;
  }
}

async function handleRecurringBlockBankPaymentSuccess(session) {
  if (!isPaid(session)) return;

  const metadata = session.metadata || {};
  const blockId = parseInt(metadata.recurring_slot_block_id, 10);
  const schoolId = parseInt(metadata.school_id, 10);
  if (!blockId || !schoolId) {
    const err = new Error(`recurring_block_bank_checkout success missing block/school metadata for ${session.id}`);
    console.error(err.message, metadata);
    reportError('/api/webhook (recurring block bank metadata)', err);
    return;
  }

  const paymentIntentId = stripePaymentIntentId(session);
  const checkoutSessionId = session.object === 'checkout.session' ? session.id : null;
  const { feePence: stripeFeePence, source: stripeFeeSource } = await fetchSessionFeePence({ payment_intent: paymentIntentId });

  const result = await convertRecurringBlockBankHoldTransaction({
    connectionString: process.env.POSTGRES_URL,
    blockId,
    schoolId,
    checkoutSessionId,
    paymentIntentId,
    stripeFeePence,
    stripeFeeSource,
    metadataPatch: recurringBlockMetadataPatch(session, {
      payment_status: session.payment_status || null,
      payment_success_seen_at: new Date().toISOString(),
    }),
  });

  if (result.code === 'SLOTS_UNAVAILABLE') {
    const err = new Error(`Paid recurring block ${blockId} could not be converted because selected slots are unavailable`);
    console.error(err.message, result.conflicts || []);
    reportError('/api/webhook (recurring block bank conflict)', err);
    return;
  }

  if (result.createdBookings?.length) {
    await supersedeRecurringBlockBroadcasts({
      schoolId,
      instructorId: result.instructorId,
      bookings: result.createdBookings,
    });
  }
}

async function handleRecurringBlockBankPaymentRelease(session, releaseStatus) {
  const metadata = session.metadata || {};
  const blockId = parseInt(metadata.recurring_slot_block_id, 10);
  const schoolId = parseInt(metadata.school_id, 10);
  if (!blockId || !schoolId) {
    const err = new Error(`recurring_block_bank_checkout release missing block/school metadata for ${session.id}`);
    console.error(err.message, metadata);
    reportError('/api/webhook (recurring block bank release metadata)', err);
    return;
  }

  await releaseRecurringBlockBankHoldTransaction({
    connectionString: process.env.POSTGRES_URL,
    blockId,
    schoolId,
    releaseStatus,
    checkoutSessionId: session.object === 'checkout.session' ? session.id : null,
    paymentIntentId: stripePaymentIntentId(session),
    metadataPatch: recurringBlockMetadataPatch(session, {
      release_reason: releaseStatus,
      release_seen_at: new Date().toISOString(),
    }),
  });
}

async function convertRecurringBlockBankHoldTransaction({
  connectionString,
  blockId,
  schoolId,
  checkoutSessionId = null,
  paymentIntentId = null,
  stripeFeePence = null,
  stripeFeeSource = null,
  metadataPatch = {},
}) {
  return withNeonTransaction(connectionString, async client => {
    const blockResult = await client.query(
      `SELECT rsb.*,
              anchor.pickup_address,
              anchor.dropoff_address,
              COALESCE(anchor.transmission_type, 'manual') AS transmission_type
         FROM recurring_slot_blocks rsb
         LEFT JOIN lesson_bookings anchor
           ON anchor.id = rsb.anchor_booking_id
          AND anchor.school_id = rsb.school_id
        WHERE rsb.id = $1
          AND rsb.school_id = $2
        FOR UPDATE OF rsb`,
      [blockId, schoolId]
    );
    const block = blockResult.rows[0];
    if (!block) return { ok: false, code: 'BLOCK_NOT_FOUND' };
    if (block.funding_method !== 'bank_payment') return { ok: false, code: 'NOT_BANK_PAYMENT' };

    await client.query(
      `UPDATE recurring_slot_blocks
          SET stripe_checkout_session_id = COALESCE($3, stripe_checkout_session_id),
              stripe_payment_intent_id = COALESCE($4, stripe_payment_intent_id),
              metadata = metadata || $5::jsonb,
              updated_at = NOW()
        WHERE id = $1
          AND school_id = $2`,
      [blockId, schoolId, checkoutSessionId, paymentIntentId, JSON.stringify(metadataPatch || {})]
    );

    if (block.status === 'confirmed') {
      return {
        ok: true,
        code: 'ALREADY_CONFIRMED',
        instructorId: block.instructor_id,
        createdBookings: [],
      };
    }
    if (block.status !== 'pending_payment') {
      return { ok: true, code: 'BLOCK_NOT_PENDING', status: block.status };
    }

    const itemsResult = await client.query(
      `SELECT id, scheduled_date::text AS scheduled_date, start_time::text AS start_time,
              end_time::text AS end_time, price_pence
         FROM recurring_slot_block_items
        WHERE block_id = $1
          AND school_id = $2
          AND status = 'held'
        ORDER BY scheduled_date, start_time
        FOR UPDATE`,
      [blockId, schoolId]
    );
    const items = itemsResult.rows;
    if (items.length !== Number(block.selected_lessons)) {
      await releaseRecurringBlockBankHoldInTransaction(client, {
        blockId,
        schoolId,
        releaseStatus: 'released',
        metadataPatch: {
          release_reason: 'held_item_count_mismatch_manual_review',
          expected_items: Number(block.selected_lessons),
          actual_items: items.length,
        },
      });
      return { ok: false, code: 'HELD_ITEM_COUNT_MISMATCH' };
    }

    const dates = items.map(item => item.scheduled_date);
    const bookingConflicts = await client.query(
      `SELECT scheduled_date::text AS date, start_time::text
         FROM lesson_bookings
        WHERE instructor_id = $1
          AND school_id = $2
          AND scheduled_date = ANY($3::date[])
          AND status = ANY($4::text[])
          AND start_time < $6::time
          AND end_time > $5::time`,
      [block.instructor_id, schoolId, dates, BLOCKING_STATUSES, block.start_time, block.end_time]
    );
    const reservationConflicts = await client.query(
      `SELECT scheduled_date::text AS date, start_time::text
         FROM slot_reservations
        WHERE instructor_id = $1
          AND school_id = $2
          AND scheduled_date = ANY($3::date[])
          AND expires_at > NOW()
          AND start_time < $5::time
          AND end_time > $4::time`,
      [block.instructor_id, schoolId, dates, block.start_time, block.end_time]
    );
    const offerConflicts = await client.query(
      `SELECT scheduled_date::text AS date, start_time::text
         FROM lesson_offers
        WHERE instructor_id = $1
          AND school_id = $2
          AND scheduled_date = ANY($3::date[])
          AND status = 'pending'
          AND expires_at > NOW()
          AND start_time < $5::time
          AND end_time > $4::time`,
      [block.instructor_id, schoolId, dates, block.start_time, block.end_time]
    );
    const conflicts = [
      ...bookingConflicts.rows.map(row => ({ date: String(row.date).slice(0, 10), start_time: row.start_time, reason: 'booking_conflict' })),
      ...reservationConflicts.rows.map(row => ({ date: String(row.date).slice(0, 10), start_time: row.start_time, reason: 'reservation_conflict' })),
      ...offerConflicts.rows.map(row => ({ date: String(row.date).slice(0, 10), start_time: row.start_time, reason: 'offer_conflict' })),
    ];
    if (conflicts.length > 0) {
      await releaseRecurringBlockBankHoldInTransaction(client, {
        blockId,
        schoolId,
        releaseStatus: 'released',
        metadataPatch: {
          release_reason: 'payment_success_slot_conflict_manual_review',
          conflicts,
        },
      });
      return { ok: false, code: 'SLOTS_UNAVAILABLE', conflicts };
    }

    const seriesId = crypto.randomUUID();
    const feeShares = splitPenceAcrossItems(stripeFeePence, items);
    const createdBookings = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const inserted = await client.query(
        `INSERT INTO lesson_bookings
           (learner_id, instructor_id, scheduled_date, start_time, end_time, status,
            pickup_address, dropoff_address, lesson_type_id, transmission_type,
            minutes_deducted, series_id, school_id, payment_method, created_by,
            stripe_fee_pence, stripe_fee_source, list_price_pence, list_price_source)
         VALUES
           ($1, $2, $3, $4, $5, $6,
            $7, $8, $9, $10,
            $11, $12, $13, 'bank_payment', 'recurring_block_bank_checkout',
            $14, $15, $16, 'stripe_metadata')
         RETURNING id, scheduled_date::text, start_time::text, end_time::text, status`,
        [
          block.learner_id,
          block.instructor_id,
          item.scheduled_date,
          item.start_time,
          item.end_time,
          SCHEDULED,
          block.pickup_address || null,
          block.dropoff_address || null,
          block.lesson_type_id || null,
          block.transmission_type || 'manual',
          block.duration_minutes,
          seriesId,
          schoolId,
          feeShares[i],
          feeShares[i] == null ? null : stripeFeeSource,
          item.price_pence,
        ]
      );
      const booking = inserted.rows[0];
      createdBookings.push(booking);
      await client.query(
        `UPDATE recurring_slot_block_items
            SET status = 'booked',
                lesson_booking_id = $4,
                updated_at = NOW()
          WHERE id = $1
            AND block_id = $2
            AND school_id = $3
            AND status = 'held'`,
        [item.id, blockId, schoolId, booking.id]
      );
    }

    await client.query(
      `UPDATE recurring_slot_blocks
          SET status = 'confirmed',
              confirmed_at = NOW(),
              expires_at = NULL,
              stripe_checkout_session_id = COALESCE($3, stripe_checkout_session_id),
              stripe_payment_intent_id = COALESCE($4, stripe_payment_intent_id),
              metadata = metadata || $5::jsonb,
              updated_at = NOW()
        WHERE id = $1
          AND school_id = $2
          AND status = 'pending_payment'`,
      [
        blockId,
        schoolId,
        checkoutSessionId,
        paymentIntentId,
        JSON.stringify({
          ...metadataPatch,
          converted_booking_ids: createdBookings.map(booking => booking.id),
          series_id: seriesId,
          stripe_fee_pence: stripeFeePence,
          stripe_fee_source: stripeFeeSource,
        }),
      ]
    );

    return {
      ok: true,
      code: 'CONFIRMED',
      instructorId: block.instructor_id,
      createdBookings,
    };
  });
}

async function releaseRecurringBlockBankHoldTransaction({
  connectionString,
  blockId,
  schoolId,
  releaseStatus,
  checkoutSessionId = null,
  paymentIntentId = null,
  metadataPatch = {},
}) {
  return withNeonTransaction(connectionString, async client => {
    const blockResult = await client.query(
      `SELECT id, status, funding_method
         FROM recurring_slot_blocks
        WHERE id = $1
          AND school_id = $2
        FOR UPDATE`,
      [blockId, schoolId]
    );
    const block = blockResult.rows[0];
    if (!block) return { ok: false, code: 'BLOCK_NOT_FOUND' };
    if (block.funding_method !== 'bank_payment') return { ok: false, code: 'NOT_BANK_PAYMENT' };
    if (block.status !== 'pending_payment') return { ok: true, code: 'BLOCK_NOT_PENDING', status: block.status };

    await client.query(
      `UPDATE recurring_slot_blocks
          SET stripe_checkout_session_id = COALESCE($3, stripe_checkout_session_id),
              stripe_payment_intent_id = COALESCE($4, stripe_payment_intent_id),
              updated_at = NOW()
        WHERE id = $1
          AND school_id = $2`,
      [blockId, schoolId, checkoutSessionId, paymentIntentId]
    );
    await releaseRecurringBlockBankHoldInTransaction(client, {
      blockId,
      schoolId,
      releaseStatus,
      metadataPatch,
    });
    return { ok: true, code: releaseStatus.toUpperCase() };
  });
}

async function releaseRecurringBlockBankHoldInTransaction(client, {
  blockId,
  schoolId,
  releaseStatus,
  metadataPatch = {},
}) {
  const status = releaseStatus === 'expired' ? 'expired'
    : releaseStatus === 'payment_failed' ? 'payment_failed'
    : 'released';
  await client.query(
    `UPDATE recurring_slot_block_items
        SET status = 'released',
            updated_at = NOW()
      WHERE block_id = $1
        AND school_id = $2
        AND status = 'held'`,
    [blockId, schoolId]
  );
  await client.query(
    `UPDATE recurring_slot_blocks
        SET status = $3,
            released_at = NOW(),
            metadata = metadata || $4::jsonb,
            updated_at = NOW()
      WHERE id = $1
        AND school_id = $2
        AND status = 'pending_payment'`,
    [blockId, schoolId, status, JSON.stringify(metadataPatch || {})]
  );
}

async function supersedeRecurringBlockBroadcasts({ schoolId, instructorId, bookings }) {
  try {
    const { supersedeBroadcastSiblings } = require('./_notify-availability');
    await Promise.all((bookings || []).map(booking =>
      supersedeBroadcastSiblings({
        instructor_id: instructorId,
        scheduled_date: String(booking.scheduled_date).slice(0, 10),
        start_time: String(booking.start_time).slice(0, 5),
        school_id: schoolId,
      }).catch(err => console.warn('supersede on recurring bank block failed:', err.message))
    ));
  } catch (_) {}
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
  const metadataSchoolId = parseInt(metadata.school_id, 10) || null;
  const instructorId   = parseInt(metadata.instructor_id, 10);
  const instructorName = metadata.instructor_name;
  const metadataLearnerId = parseInt(metadata.learner_id, 10) || null;
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

    // Trust boundary: metadata is advisory. The token points at the canonical
    // pending-payment row, and that DB row owns tenant + learner binding.
    const [offer] = await sql`
      SELECT id, status, booking_id, learner_id, school_id FROM lesson_offers
      WHERE token = ${offerToken}
    `;
    if (!offer) {
      console.error('❌ lesson_offer webhook: offer not found for token', offerToken);
      return;
    }

    const schoolId = offer.school_id;
    const rejectOfferMetadata = (reason) => {
      const err = new Error(`lesson_offer ${session.id}: ${reason}`);
      console.error('❌ lesson_offer metadata mismatch:', err.message, {
        offer_id: offer.id,
        offer_token: offerToken,
        metadata_offer_id: metadata.offer_id,
        metadata_school_id: metadata.school_id,
        metadata_learner_id: metadata.learner_id,
      });
      reportError('/api/webhook (lesson_offer metadata mismatch)', err);
      return true;
    };

    if (metadata.school_id && metadataSchoolId !== schoolId) {
      return rejectOfferMetadata(`metadata school_id ${metadata.school_id} does not match offer.school_id ${schoolId}`);
    }
    if (metadata.offer_id && offerId !== offer.id) {
      return rejectOfferMetadata(`metadata offer_id ${metadata.offer_id} does not match offer.id ${offer.id}`);
    }
    if (metadata.learner_id) {
      if (!metadataLearnerId) {
        return rejectOfferMetadata(`metadata learner_id ${metadata.learner_id} is invalid`);
      }
      if (!offer.learner_id) {
        return rejectOfferMetadata(`metadata learner_id ${metadataLearnerId} was supplied for unbound offer ${offer.id}`);
      }
      if (metadataLearnerId !== offer.learner_id) {
        return rejectOfferMetadata(`metadata learner_id ${metadataLearnerId} does not match offer.learner_id ${offer.learner_id}`);
      }
    }

    if (offer.status === 'accepted') {
      if (!isFlexible && repeatWeeks === 1 && offer.booking_id) {
        const [existingOfferCreditTx] = await sql`
          SELECT id, amount_pence, stripe_fee_pence, effective_rate_pence_per_minute, minutes
            FROM credit_transactions
           WHERE stripe_session_id = ${session.id}
             AND type = 'slot_purchase'
             AND learner_id IS NOT NULL
             AND instructor_id = ${instructorId}
             AND school_id = ${schoolId}
           LIMIT 1
        `;
        if (existingOfferCreditTx) {
          await ensureSlotBookingBcs(sql, {
            schoolId,
            bookingId: offer.booking_id,
            creditTransaction: existingOfferCreditTx,
            durationMins,
          });
        }
      }
      return;
    }

    // 1. Find or create learner
    let learnerId;
    let existingLearner = null;
    const boundLearnerId = offer.learner_id;
    if (boundLearnerId) {
      const [bound] = await sql`
        SELECT id, name, email, phone, pickup_address
        FROM learner_users
        WHERE id = ${boundLearnerId}
          AND school_id = ${schoolId}
      `;
      if (!bound) {
        throw new Error(`lesson_offer ${session.id}: bound learner ${boundLearnerId} not found in school ${schoolId}`);
      }
      existingLearner = bound;
    } else {
      [existingLearner] = await sql`
        SELECT id, name, phone, pickup_address
        FROM learner_users
        WHERE LOWER(email) = LOWER(${learnerEmail})
          AND school_id = ${schoolId}
      `;
    }

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
            AND school_id = ${schoolId}
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

    // Step 4 / Phase 2A: effective rate is per-minute on the total charge
    // (totalAmountPence / totalMinutes). For repeat-weeks series this is the
    // same per-minute rate every week (Stripe charges per-week × repeatWeeks
    // via line-item quantity, so the per-minute rate is invariant across weeks).
    const effectiveRatePencePerMinute = totalMinutes > 0
      ? Math.round(totalAmountPence / totalMinutes)
      : null;
    const paymentIntentId = typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id || null;

    // uq_credit_tx_session catches concurrent Stripe retries on the same
    // offer-acceptance event. SELECT idempotency above is the fast path;
    // this is the DB-enforced backstop.
    let offerCreditTx;
    try {
      const [creditTx] = await sql`
        INSERT INTO credit_transactions
          (learner_id, type, credits, amount_pence, payment_method, stripe_session_id, minutes, school_id,
           stripe_fee_pence, instructor_id, effective_rate_pence_per_minute, stripe_payment_intent_id, source)
        VALUES
          (${learnerId}, 'slot_purchase', ${totalCredits}, ${totalAmountPence}, 'card', ${session.id}, ${totalMinutes}, ${schoolId},
           ${stripeFeePence}, ${instructorId}, ${effectiveRatePencePerMinute}, ${paymentIntentId}, 'stripe')
        RETURNING id, amount_pence, stripe_fee_pence, effective_rate_pence_per_minute, minutes
      `;
      offerCreditTx = creditTx;
    } catch (insertErr) {
      if (insertErr.message?.includes('uq_credit_tx_session') || insertErr.code === '23505') {
        const duplicatePendingError = new Error(
          `lesson_offer ${session.id} already has a credit_transaction but offer ${offer.id} is not accepted; previous webhook attempt likely failed mid-flight`
        );
        console.error('❌ lesson_offer: duplicate credit transaction on pending offer', duplicatePendingError.message);
        throw duplicatePendingError;
      }
      throw insertErr;
    }

    // Net-zero add (matched by deduct below for slot-pinned offers, left in
    // place for flexible offers so the learner has balance to spend).
    await lockBalanceAdjustLCB(sql, {
      learnerId, instructorId, schoolId,
      delta: totalMinutes, creditsDelta: totalCredits,
    });

    // ── Flexible offers: credit the learner, skip booking (they pick their own slot) ──
    if (isFlexible) {
      // Leave credit on learner's balance — no deduct, no booking
      await sql`
        UPDATE lesson_offers
        SET status = 'accepted', learner_id = ${learnerId}, accepted_at = NOW()
        WHERE id = ${offer.id}
          AND school_id = ${schoolId}
      `;

      const [instructor] = await sql`SELECT name, email FROM instructors WHERE id = ${instructorId} AND school_id = ${schoolId}`;
      const [learner] = await sql`SELECT name FROM learner_users WHERE id = ${learnerId} AND school_id = ${schoolId}`;
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
    const deducted = await lockBalanceAdjustLCB(sql, {
      learnerId, instructorId, schoolId,
      delta: -totalMinutes, creditsDelta: -totalCredits,
    });

    if (!deducted.ok) {
      console.error('❌ lesson_offer: failed to deduct hours after adding — race condition?', deducted.code);
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
        totalStripeFeePence: stripeFeePence,
        // Step 1b: amountPence is already per-lesson here (Stripe charged
        // amountPence × repeatWeeks via line-item quantity — see L735), so it
        // is also the per-booking list price. Tag stripe_metadata per the
        // source-of-truth rule: the snapshot was frozen at offer-acceptance
        // time, before this webhook fired.
        listPricePerBookingPence: amountPence,
        listPriceSource: 'stripe_metadata'
      });
      booking = { id: seriesResult.booked[0].booking_id, scheduled_date: scheduledDate, start_time: startTime, end_time: endTime };
    } catch (insertErr) {
      // Booking insert failed (slot taken, FK / CHECK violation, etc.). Refund
      // the deduction so the learner has the hours on their account, mark the
      // offer cancelled, then alert Fraser + email the learner — see
      // notifyBookingInsertFailed.
      await lockBalanceAdjustLCB(sql, {
        learnerId, instructorId, schoolId,
        delta: totalMinutes, creditsDelta: totalCredits,
      });
      console.error('❌ lesson_offer: insert failed, hours refunded to learner balance', insertErr.message);
      await sql`UPDATE lesson_offers SET status = 'cancelled' WHERE id = ${offer.id} AND school_id = ${schoolId}`;
      await notifyBookingInsertFailed({
        session, kind: 'lesson_offer',
        learnerEmail, instructorName,
        scheduledDate, startTime, endTime,
        amountPence, insertErr
      });
      return;
    }

    // Step 5 narrow slice: paid, non-flexible, slot-pinned offers get BCS
    // attribution once every requested repeat week has been booked. Partial
    // repeats need a later CSA-aware slice because Stripe partially refunds
    // unused weeks while the source CT remains immutable.
    if (!isFlexible && repeatWeeks === 1 && seriesResult.booked.length === 1) {
      await ensureSlotBookingBcs(sql, {
        schoolId,
        bookingId: seriesResult.booked[0].booking_id,
        creditTransaction: offerCreditTx,
        durationMins,
      });
    } else if (!isFlexible && repeatWeeks > 1 && seriesResult.booked.length === repeatWeeks) {
      await ensureOfferSeriesBcs(sql, {
        schoolId,
        bookedLessons: seriesResult.booked,
        creditTransaction: offerCreditTx,
        durationMins,
      });
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
        if (!session.payment_intent) {
          throw new Error(`Missing payment_intent for partial repeat-offer refund on session ${session.id}`);
        }

        await stripe.refunds.create({
          payment_intent: session.payment_intent,
          amount: amountPence * unused,
          reason: 'requested_by_customer',
          metadata: { offer_id: String(offer.id), unused_weeks: String(unused) }
        });
      } catch (refundErr) {
        console.error('❌ lesson_offer: partial refund failed', refundErr.message);
        const partialRefundError = new Error(
          `Partial repeat-offer refund failed for session ${session.id}, offer ${offer.id}, unused_weeks=${unused}, refund_amount_pence=${amountPence * unused}: ${refundErr.message}`
        );
        reportError('/api/webhook (lesson_offer partial repeat refund failed)', partialRefundError);
        throw partialRefundError;
      }
    }

    // 4. Update the offer
    const [acceptedOffer] = await sql`
      UPDATE lesson_offers
      SET status = 'accepted', booking_id = ${booking.id}, learner_id = ${learnerId},
          accepted_at = NOW()
      WHERE id = ${offer.id}
        AND school_id = ${schoolId}
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
        winnerOfferId: offer.id,
        batchId: acceptedOffer.batch_id
      }).catch(err => console.warn('supersede siblings failed:', err.message));
    }

    // 5. Send confirmation emails
    const [instructor] = await sql`SELECT name, email, phone FROM instructors WHERE id = ${instructorId} AND school_id = ${schoolId}`;
    const [learner] = await sql`SELECT name, email, phone FROM learner_users WHERE id = ${learnerId} AND school_id = ${schoolId}`;

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

module.exports._handleCreditPurchase = handleCreditPurchase;
module.exports._paymentIntentToCreditSession = paymentIntentToCreditSession;
