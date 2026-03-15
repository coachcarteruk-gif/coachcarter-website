const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const nodemailer = require('nodemailer');
const { neon } = require('@neondatabase/serverless');

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

    console.log(`✅ Credits added: ${credits} credits → learner #${learnerId} (${learnerEmail})`);

    // 3. Send confirmation email via nodemailer
    const transporter = createTransporter();
    const plural = credits === 1 ? 'credit' : 'credits';

    await transporter.sendMail({
      from:    'CoachCarter <bookings@coachcarter.uk>',
      to:      learnerEmail,
      subject: `${credits} lesson ${plural} added to your account`,
      html: `
        <h1>Your credits are ready.</h1>
        <p>We've added <strong>${credits} lesson ${plural}</strong> to your CoachCarter account.</p>
        <p><strong>Amount paid:</strong> £${(amountPence / 100).toFixed(2)}</p>
        <p>You can now book your ${plural} directly from your dashboard.</p>
        <p><a href="https://coachcarter.uk/learner/dashboard.html"
              style="background:#f58321;color:#fff;padding:14px 28px;text-decoration:none;
                     border-radius:8px;display:inline-block;font-weight:bold;">
          Book a lesson →
        </a></p>
        <p style="color:#888;font-size:0.85rem;">
          Credits are refundable. Cancellations made 48+ hours before a lesson
          automatically return the credit to your balance.
        </p>
      `
    });

  } catch (err) {
    console.error('❌ handleCreditPurchase error:', err);
    // Don't rethrow — we've already responded 200 to Stripe.
    // A failed DB write here should be caught by Neon error logging / Stripe retry.
  }
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

  // Send emails
  await sendCustomerConfirmation(booking, isCalculatorPackage);
  await notifyStaff(booking, isCalculatorPackage);

  // Delayed availability email for Pass Guarantee and Calculator packages
  if (isPassGuarantee) {
    await sendAvailabilityFormLink(booking);
  }
}

function getPackageDisplayName(packageType) {
  const names = {
    'payg': 'Pay As You Go',
    'bulk': 'Bulk Package',
    'pass_guarantee': 'Pass Guarantee',
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
    subject = `Pass Guarantee confirmed — ${booking.package_name} — Reference: ${booking.booking_reference}`;
    
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
    subject = `Pass Guarantee confirmed — Reference: ${booking.booking_reference}`;
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
      <h2>${isPassGuarantee ? 'Pass Guarantee — Verify Required' : 'New Booking'}</h2>
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
      : isPassGuarantee ? '🎯 New Pass Guarantee' : '💳 New Booking';
    
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

// Helper to get raw body for Stripe
async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}
