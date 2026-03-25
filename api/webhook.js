const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const nodemailer = require('nodemailer');
const { neon } = require('@neondatabase/serverless');
const jwt = require('jsonwebtoken');
const twilio = require('twilio');

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
  }).then(msg => {
    console.log('WhatsApp sent OK, sid:', msg?.sid, 'to:', phone);
  }).catch(err => {
    console.error('WHATSAPP_FAIL', JSON.stringify({ message: err.message, code: err.code, status: err.status, moreInfo: err.moreInfo, to: phone, from }));
  });
}

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
    console.log(`Webhook signature verification failed:`, err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const paymentType = session.metadata?.payment_type;

    if (paymentType === 'credit_purchase') {
      // ── New credit-based booking system ──────────────────────────────────
      await handleCreditPurchase(session);
    } else if (paymentType === 'slot_booking') {
      // ── Pay-per-slot: single lesson purchase + instant booking ──────────
      await handleSlotBooking(session);
    } else {
      // ── Legacy pass guarantee / package flow ──────────────────────────────
      await handleCheckoutComplete(session);
    }
  }

  res.json({ received: true });
};

// ── Credit purchase handler ───────────────────────────────────────────────────
async function handleCreditPurchase(session) {
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

    // Idempotency check — skip if this session was already processed
    const [existing] = await sql`
      SELECT id FROM credit_transactions WHERE stripe_session_id = ${session.id}
    `;
    if (existing) {
      console.log(`⏭️ Duplicate webhook for session ${session.id} — skipping`);
      return;
    }

    // Determine payment method (card or klarna)
    const paymentMethod = session.payment_method_types?.[0] || 'card';

    // 1. Record the transaction
    await sql`
      INSERT INTO credit_transactions
        (learner_id, type, credits, amount_pence, payment_method, stripe_session_id)
      VALUES
        (${learnerId}, 'purchase', ${credits}, ${amountPence}, ${paymentMethod}, ${session.id})
    `;

    // 2. Increment the learner's credit balance atomically
    await sql`
      UPDATE learner_users
      SET credit_balance = credit_balance + ${credits}
      WHERE id = ${learnerId}
    `;

    console.log(`✅ Lessons added: ${credits} lessons → learner #${learnerId} (${learnerEmail})`);

    // 3. Send confirmation email via nodemailer
    const transporter = createTransporter();
    const plural = credits === 1 ? 'lesson' : 'lessons';

    await transporter.sendMail({
      from:    'CoachCarter <bookings@coachcarter.uk>',
      to:      learnerEmail,
      subject: `${credits} ${plural} added to your account`,
      html: `
        <h1>Your lessons are ready to book.</h1>
        <p>We've added <strong>${credits} ${plural}</strong> to your CoachCarter account.</p>
        <p><strong>Amount paid:</strong> £${(amountPence / 100).toFixed(2)}</p>
        <p>Head to your dashboard to book your next lesson.</p>
        <p><a href="https://coachcarter.uk/learner/"
              style="background:#f58321;color:#fff;padding:14px 28px;text-decoration:none;
                     border-radius:8px;display:inline-block;font-weight:bold;">
          Book a lesson →
        </a></p>
        <p style="color:#888;font-size:0.85rem;">
          Lessons are fully refundable. Cancel 48+ hours before and the lesson
          returns to your balance automatically.
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
  const metadata      = session.metadata || {};
  const learnerId     = parseInt(metadata.learner_id, 10);
  const instructorId  = parseInt(metadata.instructor_id, 10);
  const learnerEmail  = metadata.learner_email || session.customer_email;
  const instructorName = metadata.instructor_name;
  const scheduledDate = metadata.scheduled_date;
  const startTime     = metadata.start_time;
  const endTime       = metadata.end_time;
  const amountPence   = parseInt(metadata.amount_pence, 10);

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
      console.log(`⏭️ Duplicate slot_booking webhook for ${session.id} — skipping`);
      return;
    }

    // 1. Record the transaction (1 credit purchased for this single lesson)
    await sql`
      INSERT INTO credit_transactions
        (learner_id, type, credits, amount_pence, payment_method, stripe_session_id)
      VALUES
        (${learnerId}, 'slot_purchase', 1, ${amountPence}, 'card', ${session.id})
    `;

    // 2. Add 1 credit to the learner's balance
    await sql`
      UPDATE learner_users
      SET credit_balance = credit_balance + 1
      WHERE id = ${learnerId}
    `;

    // 3. Immediately deduct 1 credit and create the booking (atomic deduct)
    const [deducted] = await sql`
      UPDATE learner_users
      SET credit_balance = credit_balance - 1
      WHERE id = ${learnerId} AND credit_balance >= 1
      RETURNING credit_balance
    `;

    if (!deducted) {
      console.error('❌ slot_booking: failed to deduct credit after adding it — race condition?');
      return;
    }

    // 4. Create the booking
    let booking;
    try {
      const [b] = await sql`
        INSERT INTO lesson_bookings
          (learner_id, instructor_id, scheduled_date, start_time, end_time, status)
        VALUES
          (${learnerId}, ${instructorId}, ${scheduledDate}, ${startTime}, ${endTime}, 'confirmed')
        RETURNING id, scheduled_date, start_time::text, end_time::text
      `;
      booking = b;
    } catch (insertErr) {
      // Slot was taken — refund the credit
      await sql`
        UPDATE learner_users SET credit_balance = credit_balance + 1 WHERE id = ${learnerId}
      `;
      console.error('❌ slot_booking: slot already taken, credit refunded', insertErr.message);
      // TODO: could send a "sorry, slot was taken" email here
      return;
    }

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

    const creditBalance = deducted.credit_balance;

    // 7. Send confirmation emails
    const transporter = createTransporter();
    const lessonDate = new Date(scheduledDate + 'T00:00:00Z')
      .toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    const lessonTime = `${startTime} – ${endTime}`;

    // Generate .ics calendar attachment
    const icsContent = generateICS({
      id: booking.id,
      scheduled_date: scheduledDate,
      start_time: startTime,
      end_time: endTime,
      instructor_name: instructorName
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
          <tr><td><strong>Duration:</strong></td><td>1.5 hours</td></tr>
          <tr><td><strong>Lessons remaining:</strong></td><td>${creditBalance}</td></tr>
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
    // Instructor WhatsApp disabled for now — enable when ready
    // sendWhatsApp(instructor?.phone,
    //   `📋 New booking!\n\n👤 ${learner?.name || 'Unknown'}\n📅 ${lessonDate}\n⏰ ${lessonTime}\n\nView schedule: https://coachcarter.uk/instructor/`
    // );

    console.log(`✅ Slot booking complete: lesson #${booking.id} for learner #${learnerId}`);

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
    `DESCRIPTION:1.5-hour driving lesson with ${booking.instructor_name}.\\n\\nManage your bookings: https://coachcarter.uk/learner/book.html`,
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
  console.log('✅ Booking created:', bookingRef, 'for', customerEmail, '- Type:', packageType);

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

function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT),
    secure: process.env.SMTP_PORT === '465',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

// ── Increment guarantee price after a purchase ──────────────────────────────
async function incrementGuaranteePrice() {
  const sql = neon(process.env.POSTGRES_URL);

  // Ensure the table exists (idempotent)
  await sql`
    CREATE TABLE IF NOT EXISTS guarantee_pricing (
      id            INTEGER PRIMARY KEY DEFAULT 1,
      base_price    INTEGER NOT NULL DEFAULT 1500,
      current_price INTEGER NOT NULL DEFAULT 1500,
      increment     INTEGER NOT NULL DEFAULT 100,
      cap           INTEGER NOT NULL DEFAULT 3000,
      purchases     INTEGER NOT NULL DEFAULT 0,
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  // Seed if empty
  await sql`
    INSERT INTO guarantee_pricing (id, base_price, current_price, increment, cap, purchases)
    VALUES (1, 1500, 1500, 100, 3000, 0)
    ON CONFLICT (id) DO NOTHING
  `;

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

  console.log(`✅ Guarantee price incremented → £${updated.current_price} (purchase #${updated.purchases})`);
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
