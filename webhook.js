const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const nodemailer = require('nodemailer');

// In-memory storage for demo (replace with Vercel Postgres or Airtable in production)
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
    await handleCheckoutComplete(session);
  }

  res.json({ received: true });
};

async function handleCheckoutComplete(session) {
  const provisionalLicence = session.custom_fields?.find(f => f.key === 'provisional_licence')?.text?.value;
  const testStatus = session.custom_fields?.find(f => f.key === 'has_test_booked')?.dropdown?.value;
  const testReference = session.custom_fields?.find(f => f.key === 'dvsa_reference')?.text?.value;
  const testCentre = session.custom_fields?.find(f => f.key === 'test_centre_preference')?.text?.value;

  const customerEmail = session.customer_details.email;
  const customerName = session.customer_details.name;
  const amount = session.amount_total / 100;
  const packageType = session.metadata?.package_type || 'unknown';
  const isPassGuarantee = packageType === 'pass_guarantee';
  const bookingRef = `CC-${Date.now().toString().slice(-6)}`;

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
    amount_paid: amount,
    status: isPassGuarantee ? 'PAID_PENDING_VERIFICATION' : 'PAID_PENDING_SCHEDULING',
    created_at: new Date().toISOString()
  };

  bookings.set(bookingRef, booking);

  // Send emails
  await sendCustomerConfirmation(booking);
  await notifyStaff(booking);

  // Delayed availability email for Pass Guarantee
  if (isPassGuarantee) {
    setTimeout(() => sendAvailabilityFormLink(booking), 5 * 60 * 1000);
  }
}

async function sendCustomerConfirmation(booking) {
  const transporter = createTransporter();

  const isPassGuarantee = booking.package_type === 'pass_guarantee';
  const subject = isPassGuarantee 
    ? `Pass Guarantee confirmed — Reference: ${booking.booking_reference}`
    : `Booking confirmed — Reference: ${booking.booking_reference}`;

  const html = isPassGuarantee ? `
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

    ${booking.claimed_test_status === 'has_test' ? 
      '<p><strong>Your test date:</strong> We'll verify this with DVSA and reverse-engineer your start date.</p>' :
      '<p><strong>Your test:</strong> We'll book this for week 16-18 of your programme.</p>'
    }

    <p>Questions? Reply to this email.</p>
  ` : `
    <h1>Thanks, ${booking.customer_name?.split(' ')[0] || 'there'}</h1>
    <p><strong>Reference:</strong> ${booking.booking_reference}<br>
    <strong>Package:</strong> ${booking.package_type}<br>
    <strong>Amount paid:</strong> £${booking.amount_paid}</p>

    <p>We'll be in touch within 24 hours to schedule your first lesson.</p>

    <p>Questions? Reply to this email.</p>
  `;

  await transporter.sendMail({
    from: 'CoachCarter <bookings@coachcarter.uk>',
    to: booking.customer_email,
    subject,
    html
  });
}

async function notifyStaff(booking) {
  const transporter = createTransporter();
  const isPassGuarantee = booking.package_type === 'pass_guarantee';

  // Email to staff
  await transporter.sendMail({
    from: 'CoachCarter System <system@coachcarter.uk>',
    to: process.env.STAFF_EMAIL,
    subject: `${isPassGuarantee ? '[ACTION REQUIRED]' : '[NEW BOOKING]'} ${booking.booking_reference}`,
    html: `
      <h2>${isPassGuarantee ? 'Pass Guarantee — Verify Required' : 'New Booking'}</h2>
      <table>
        <tr><td><strong>Reference:</strong></td><td>${booking.booking_reference}</td></tr>
        <tr><td><strong>Customer:</strong></td><td>${booking.customer_name}</td></tr>
        <tr><td><strong>Email:</strong></td><td>${booking.customer_email}</td></tr>
        <tr><td><strong>Licence:</strong></td><td>${booking.provisional_licence || 'Not provided'}</td></tr>
        <tr><td><strong>Package:</strong></td><td>${booking.package_type}</td></tr>
        <tr><td><strong>Amount:</strong></td><td>£${booking.amount_paid}</td></tr>
        <tr><td><strong>Test status:</strong></td><td>${booking.claimed_test_status || 'Unknown'}</td></tr>
        ${booking.claimed_test_reference ? `<tr><td><strong>Test ref:</strong></td><td>${booking.claimed_test_reference}</td></tr>` : ''}
        ${booking.claimed_test_centre ? `<tr><td><strong>Centre:</strong></td><td>${booking.claimed_test_centre}</td></tr>` : ''}
      </table>

      ${booking.claimed_test_status === 'has_test' ? `
      <p style="color: #d96710;"><strong>Action:</strong> Verify DVSA reference and confirm test date.</p>
      <p><a href="https://www.gov.uk/check-driving-test">Check DVSA →</a></p>
      ` : '<p>No test booked — you will book at week 16-18.</p>'}
    `
  });

  // Slack notification
  if (process.env.SLACK_WEBHOOK_URL) {
    await fetch(process.env.SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: isPassGuarantee ? '🎯 New Pass Guarantee' : '💳 New Booking',
        blocks: [
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Ref:*\n${booking.booking_reference}` },
              { type: 'mrkdwn', text: `*Amount:*\n£${booking.amount_paid}` },
              { type: 'mrkdwn', text: `*Customer:*\n${booking.customer_name}` },
              { type: 'mrkdwn', text: `*Email:*\n${booking.customer_email}` },
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