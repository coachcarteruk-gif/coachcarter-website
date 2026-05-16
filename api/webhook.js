const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { neon } = require('@neondatabase/serverless');
const jwt = require('jsonwebtoken');
const { sendWhatsApp } = require('./_whatsapp');
const { reportError } = require('./_error-alert');
const { createTransporter } = require('./_auth-helpers');
const { SCHEDULED } = require('./_booking-status');
const { fetchSessionFeePence } = require('./_stripe-fee');


// In-memory storage for legacy booking flow (pass guarantee / packages)
// NOTE: this is intentionally kept for the existing flow — the new credit
// purchase flow writes directly to Neon instead.
const bookings = new Map();

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

  // Klarna and other delayed-payment methods deliver `completed` early with
  // payment_status='unpaid', then fire `async_payment_succeeded` once the
  // payment actually clears. Card payments only fire `completed` (paid).
  // We route both events through the same dispatch — handlers are idempotent
  // via stripe_session_id and gate writes on payment_status='paid'.
  if (event.type === 'checkout.session.completed' ||
      event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data.object;
    const paymentType = session.metadata?.payment_type;

    if (paymentType === 'credit_purchase') {
      // ── New credit-based booking system ──────────────────────────────────
      await handleCreditPurchase(session);
    } else if (paymentType === 'slot_booking') {
      // ── Pay-per-slot: single lesson purchase + instant booking ──────────
      await handleSlotBooking(session);
    } else if (paymentType === 'lesson_offer') {
      // ── Instructor-initiated offer: learner accepted + paid ─────────────
      await handleOfferBooking(session);
    } else {
      // ── Legacy pass guarantee / package flow ──────────────────────────────
      await handleCheckoutComplete(session);
    }
  }

  // Klarna failure / cancellation — log only. No DB writes happened on the
  // earlier `completed` event because handlers gate on payment_status='paid'.
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
  if (event.type === 'account.updated') {
    try {
      const account = event.data.object;
      if (account.charges_enabled && account.payouts_enabled) {
        const sql = neon(process.env.POSTGRES_URL);
        // Update instructors table
        await sql`
          UPDATE instructors
             SET stripe_onboarding_complete = TRUE
           WHERE stripe_account_id = ${account.id}
             AND stripe_onboarding_complete = FALSE
        `;
        // Also update schools table if the account belongs to a school
        await sql`
          UPDATE schools
             SET stripe_onboarding_complete = TRUE
           WHERE stripe_account_id = ${account.id}
             AND stripe_onboarding_complete = FALSE
        `;
      }
    } catch (err) {
      console.error('account.updated handler error:', err);
      reportError('/api/webhook (account.updated)', err);
    }
  }

  res.json({ received: true });
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
  const schoolId      = parseInt(metadata.school_id, 10) || 1;

  if (!learnerId || !credits) {
    console.error('❌ credit_purchase webhook missing learner_id or credits_purchased', metadata);
    return;
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Idempotency check — skip if this session was already processed
    const [existing] = await sql`
      SELECT id FROM credit_transactions WHERE stripe_session_id = ${session.id}
    `;
    if (existing) {
      return;
    }

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

    // 1. Record the transaction
    await sql`
      INSERT INTO credit_transactions
        (learner_id, type, credits, amount_pence, payment_method, stripe_session_id, minutes, school_id, stripe_fee_pence)
      VALUES
        (${learnerId}, 'purchase', ${credits}, ${amountPence}, ${paymentMethod}, ${session.id}, ${minutes}, ${schoolId}, ${stripeFeePence})
    `;

    // 2. Increment the learner's balance atomically (both columns for transition)
    await sql`
      UPDATE learner_users
      SET credit_balance = credit_balance + ${credits},
          balance_minutes = balance_minutes + ${minutes}
      WHERE id = ${learnerId}
    `;

    // 3. Send confirmation email via nodemailer
    const transporter = createTransporter();

    await transporter.sendMail({
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
    // Don't rethrow — we've already responded 200 to Stripe.
    // A failed DB write here should be caught by Neon error logging / Stripe retry.
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
  const schoolId      = parseInt(metadata.school_id, 10) || 1;

  if (!learnerId || !instructorId || !scheduledDate || !startTime || !endTime) {
    console.error('❌ slot_booking webhook missing required metadata', metadata);
    return;
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);

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

    // 1. Record the transaction
    await sql`
      INSERT INTO credit_transactions
        (learner_id, type, credits, amount_pence, payment_method, stripe_session_id, minutes, school_id, stripe_fee_pence)
      VALUES
        (${learnerId}, 'slot_purchase', 1, ${amountPence}, 'card', ${session.id}, ${durationMins}, ${schoolId}, ${stripeFeePence})
    `;

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
      // Slot was taken — refund the hours
      await sql`
        UPDATE learner_users
        SET credit_balance = credit_balance + 1,
            balance_minutes = balance_minutes + ${durationMins}
        WHERE id = ${learnerId}
      `;
      console.error('❌ slot_booking: slot already taken, hours refunded', insertErr.message);
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
      `✅ Lesson confirmed!\n\n📅 ${lessonDate}\n⏰ ${lessonTime}\n🚗 Instructor: ${instructorName}\n\nNeed to cancel? Do so at least 48 hours before and the lesson returns to your balance.\n\nView bookings: https://coachcarter.uk/learner/`
    );
    sendWhatsApp(instructor?.phone,
      `📋 New booking!\n\n👤 ${learner?.name || 'Unknown'}\n📅 ${lessonDate}\n⏰ ${lessonTime}\n\nView schedule: https://coachcarter.uk/instructor/`
    );

  } catch (err) {
    console.error('❌ handleSlotBooking error:', err);
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

// ── Legacy checkout handler ───────────────────────────────────────────────────
async function handleCheckoutComplete(session) {
  if (!isPaid(session)) return;

  const provisionalLicence = session.custom_fields?.find(f => f.key === 'provisional_licence')?.text?.value;
  const testStatus = session.custom_fields?.find(f => f.key === 'has_test_booked')?.dropdown?.value;
  const testReference = session.custom_fields?.find(f => f.key === 'dvsa_reference')?.text?.value;
  const testCentre = session.custom_fields?.find(f => f.key === 'test_centre_preference')?.text?.value;

  const customerEmail = session.customer_details.email;
  const customerName = session.customer_details.name;
  const amount = session.amount_total / 100;
  const metadata = session.metadata || {};
  const packageType = metadata.package_type || 'unknown';
  
  // FIXED: Use Stripe session ID slice to match verify-session.js
  const bookingRef = session.id.slice(-8).toUpperCase();
  
  // Determine if this is a calculator package
  const calculatorTiers = ['core_only', 'core_plus_1', 'core_plus_2', 'core_plus_lifetime'];
  const isCalculatorPackage = calculatorTiers.includes(packageType);
  const isPassGuarantee = packageType === 'pass_guarantee' || isCalculatorPackage;

  // Store booking
  const booking = {
    stripe_session_id: session.id,
    booking_reference: bookingRef,
    customer_email: customerEmail,
    customer_name: customerName,
    provisional_licence: provisionalLicence,
    claimed_test_status: testStatus,
    claimed_test_reference: testReference,
    claimed_test_centre: testCentre,
    package_type: packageType,
    package_name: metadata.package_name || getPackageDisplayName(packageType),
    total_hours: metadata.total_hours || 'N/A',
    retake_coverage: metadata.retake_coverage || '0',
    estimated_profit: metadata.estimated_profit || 'N/A',
    amount_paid: amount,
    status: isPassGuarantee ? 'PAID_PENDING_VERIFICATION' : 'PAID_PENDING_SCHEDULING',
    created_at: new Date().toISOString()
  };

  bookings.set(bookingRef, booking);
  // If this is a Test Ready Guarantee purchase, increment the dynamic price
  if (isPassGuarantee) {
    try {
      await incrementGuaranteePrice();
    } catch (err) {
      console.error('⚠️ Failed to increment guarantee price (non-fatal):', err.message);
    }
  }

  // Send emails
  await sendCustomerConfirmation(booking, isCalculatorPackage);
  await notifyStaff(booking, isCalculatorPackage);

  // Delayed availability email for Test Ready Guarantee and Calculator packages
  if (isPassGuarantee) {
    await sendAvailabilityFormLink(booking);
  }
}

function getPackageDisplayName(packageType) {
  const names = {
    'payg': 'Pay As You Go',
    'bulk': 'Bulk Package',
    'pass_guarantee': 'Test Ready Guarantee',
    'core_only': 'Core Programme',
    'core_plus_1': 'Core + 1 Retake',
    'core_plus_2': 'Core + 2 Retakes',
    'core_plus_lifetime': 'Core + Lifetime Cover'
  };
  return names[packageType] || 'Driving Package';
}

async function sendCustomerConfirmation(booking, isCalculatorPackage) {
  const transporter = createTransporter();
  const isPassGuarantee = booking.package_type === 'pass_guarantee' || isCalculatorPackage;
  
  let subject, html;

  if (isCalculatorPackage) {
    // Calculator-specific email
    subject = `Test Ready Guarantee confirmed — ${booking.package_name} — Reference: ${booking.booking_reference}`;
    
    const retakeText = booking.retake_coverage === '0' 
      ? '1 attempt included'
      : booking.retake_coverage === 'unlimited'
        ? 'Unlimited retakes until you pass'
        : `${parseInt(booking.retake_coverage) + 1} attempts total coverage`;
    
    html = `
      <h1>You're in, ${booking.customer_name?.split(' ')[0] || 'there'}</h1>
      <p><strong>Reference:</strong> ${booking.booking_reference}<br>
      <strong>Package:</strong> ${booking.package_name}<br>
      <strong>Amount paid:</strong> £${booking.amount_paid}</p>

      <h2>Your protection level:</h2>
      <p>${retakeText}</p>

      <h2>Next steps:</h2>
      <ol>
        <li><strong>Verify your details</strong> — We're checking your licence and test status</li>
        <li><strong>Submit your availability</strong> — Link coming in the next email (arriving in 5 minutes)</li>
        <li><strong>We propose slots</strong> — Within 24 hours of receiving your availability</li>
        <li><strong>First lesson confirmed</strong> — Meet your instructor, begin your 18 weeks</li>
      </ol>

      ${booking.claimed_test_status === 'hastest' ? 
        "<p><strong>Your test date:</strong> We'll verify this with DVSA and reverse-engineer your start date.</p>" :
        "<p><strong>Your test:</strong> We'll book this for week 16-18 of your programme.</p>"
      }

      <p>Questions? Reply to this email.</p>
    `;
  } else if (isPassGuarantee) {
    // Legacy pass guarantee email
    subject = `Test Ready Guarantee confirmed — Reference: ${booking.booking_reference}`;
    html = `
      <h1>You're in, ${booking.customer_name?.split(' ')[0] || 'there'}</h1>
      <p><strong>Reference:</strong> ${booking.booking_reference}<br>
      <strong>Amount paid:</strong> £${booking.amount_paid}</p>

      <h2>Next steps:</h2>
      <ol>
        <li><strong>Verify your details</strong> — We're checking your licence and test status</li>
        <li><strong>Submit your availability</strong> — Link coming in the next email (arriving in 5 minutes)</li>
        <li><strong>We propose slots</strong> — Within 24 hours of receiving your availability</li>
        <li><strong>First lesson confirmed</strong> — Meet your instructor, begin your 18 weeks</li>
      </ol>

      ${booking.claimed_test_status === 'hastest' ? 
        "<p><strong>Your test date:</strong> We'll verify this with DVSA and reverse-engineer your start date.</p>" :
        "<p><strong>Your test:</strong> We'll book this for week 16-18 of your programme.</p>"
      }

      <p>Questions? Reply to this email.</p>
    `;
  } else {
    // Standard packages
    subject = `Booking confirmed — Reference: ${booking.booking_reference}`;
    html = `
      <h1>Thanks, ${booking.customer_name?.split(' ')[0] || 'there'}</h1>
      <p><strong>Reference:</strong> ${booking.booking_reference}<br>
      <strong>Package:</strong> ${booking.package_name}<br>
      <strong>Amount paid:</strong> £${booking.amount_paid}</p>

      <p>We'll be in touch within 24 hours to schedule your first lesson.</p>

      <p>Questions? Reply to this email.</p>
    `;
  }

  await transporter.sendMail({
    from: 'CoachCarter <bookings@coachcarter.uk>',
    to: booking.customer_email,
    subject,
    html
  });
}

async function notifyStaff(booking, isCalculatorPackage) {
  const transporter = createTransporter();
  const isPassGuarantee = booking.package_type === 'pass_guarantee' || isCalculatorPackage;

  // Build calculator-specific details
  let calculatorDetails = '';
  if (isCalculatorPackage) {
    calculatorDetails = `
      <tr><td><strong>Total Hours:</strong></td><td>${booking.total_hours}</td></tr>
      <tr><td><strong>Retake Coverage:</strong></td><td>${booking.retake_coverage}</td></tr>
      <tr><td><strong>Est. Profit:</strong></td><td>£${booking.estimated_profit}</td></tr>
    `;
  }

  // Email to staff
  await transporter.sendMail({
    from: 'CoachCarter System <system@coachcarter.uk>',
    to: process.env.STAFF_EMAIL,
    subject: `${isPassGuarantee ? '[ACTION REQUIRED]' : '[NEW BOOKING]'} ${booking.booking_reference} — ${booking.package_name}`,
    html: `
      <h2>${isPassGuarantee ? 'Test Ready Guarantee — Verify Required' : 'New Booking'}</h2>
      <table>
        <tr><td><strong>Reference:</strong></td><td>${booking.booking_reference}</td></tr>
        <tr><td><strong>Customer:</strong></td><td>${booking.customer_name}</td></tr>
        <tr><td><strong>Email:</strong></td><td>${booking.customer_email}</td></tr>
        <tr><td><strong>Licence:</strong></td><td>${booking.provisional_licence || 'Not provided'}</td></tr>
        <tr><td><strong>Package:</strong></td><td>${booking.package_name}</td></tr>
        <tr><td><strong>Type:</strong></td><td>${booking.package_type}</td></tr>
        <tr><td><strong>Amount:</strong></td><td>£${booking.amount_paid}</td></tr>
        <tr><td><strong>Test status:</strong></td><td>${booking.claimed_test_status || 'Unknown'}</td></tr>
        ${booking.claimed_test_reference ? `<tr><td><strong>Test ref:</strong></td><td>${booking.claimed_test_reference}</td></tr>` : ''}
        ${booking.claimed_test_centre ? `<tr><td><strong>Centre:</strong></td><td>${booking.claimed_test_centre}</td></tr>` : ''}
        ${booking.preferred_start_date ? `<tr><td><strong>Start date:</strong></td><td>${booking.preferred_start_date}</td></tr>` : ''}
        ${calculatorDetails}
      </table>

      ${booking.claimed_test_status === 'hastest' ? `
      <p style="color: #d96710;"><strong>Action:</strong> Verify DVSA reference and confirm test date.</p>
      <p><a href="https://www.gov.uk/check-driving-test">Check DVSA →</a></p>
      ` : '<p>No test booked — you will book at week 16-18.</p>'}
    `
  });

  // Slack notification
  if (process.env.SLACK_WEBHOOK_URL) {
    const slackText = isCalculatorPackage 
      ? `🎯 New Calculator Booking: ${booking.package_name}`
      : isPassGuarantee ? '🎯 New Test Ready Guarantee' : '💳 New Booking';
    
    await fetch(process.env.SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: slackText,
        blocks: [
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Ref:*\n${booking.booking_reference}` },
              { type: 'mrkdwn', text: `*Amount:*\n£${booking.amount_paid}` },
              { type: 'mrkdwn', text: `*Customer:*\n${booking.customer_name}` },
              { type: 'mrkdwn', text: `*Package:*\n${booking.package_name}` },
              { type: 'mrkdwn', text: `*Licence:*\n${booking.provisional_licence || 'N/A'}` },
              { type: 'mrkdwn', text: `*Test:*\n${booking.claimed_test_status || 'N/A'}` }
            ]
          }
        ]
      })
    });
  }
}

async function sendAvailabilityFormLink(booking) {
  const transporter = createTransporter();
  const availabilityUrl = `https://coachcarter.uk/availability.html?ref=${booking.booking_reference}&email=${encodeURIComponent(booking.customer_email)}`;

  await transporter.sendMail({
    from: 'CoachCarter <bookings@coachcarter.uk>',
    to: booking.customer_email,
    subject: `Submit your availability — Reference: ${booking.booking_reference}`,
    html: `
      <h1>When can you take lessons, ${booking.customer_name?.split(' ')[0] || 'there'}?</h1>
      <p>To match you with the right instructor, we need to know your typical weekly availability.</p>
      <p><a href="${availabilityUrl}" style="background: #f47c20; color: white; padding: 16px 32px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold;">Submit Availability →</a></p>
      <p><strong>Takes 2 minutes.</strong></p>
      <p>Reference: ${booking.booking_reference}</p>
    `
  });
}

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
  const schoolId       = parseInt(metadata.school_id, 10) || 1;

  const isFlexible = metadata.is_flexible === '1';
  const repeatWeeks = Math.max(1, parseInt(metadata.repeat_weeks, 10) || 1);
  if (!offerToken || !instructorId || (!isFlexible && (!scheduledDate || !startTime || !endTime))) {
    console.error('❌ lesson_offer webhook missing required metadata', metadata);
    return;
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);

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

    await sql`
      INSERT INTO credit_transactions
        (learner_id, type, credits, amount_pence, payment_method, stripe_session_id, minutes, school_id, stripe_fee_pence)
      VALUES
        (${learnerId}, 'slot_purchase', ${totalCredits}, ${totalAmountPence}, 'card', ${session.id}, ${totalMinutes}, ${schoolId}, ${stripeFeePence})
    `;

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
      // First slot lost the race — refund and cancel offer.
      await sql`
        UPDATE learner_users
        SET credit_balance = credit_balance + ${totalCredits},
            balance_minutes = balance_minutes + ${totalMinutes}
        WHERE id = ${learnerId}
      `;
      console.error('❌ lesson_offer: first slot already taken, hours refunded', insertErr.message);
      await sql`UPDATE lesson_offers SET status = 'cancelled' WHERE id = ${offerId}`;
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
  }
}

// ── Increment guarantee price after a purchase ──────────────────────────────
async function incrementGuaranteePrice() {
  const sql = neon(process.env.POSTGRES_URL);

  // Atomic increment
  const [updated] = await sql`
    UPDATE guarantee_pricing
    SET
      current_price = LEAST(current_price + increment, cap),
      purchases     = purchases + 1,
      updated_at    = NOW()
    WHERE id = 1
    RETURNING current_price, purchases
  `;

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
