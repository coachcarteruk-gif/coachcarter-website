const nodemailer = require('nodemailer');

// Same in-memory store (replace with DB in production)
const bookings = new Map();

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { booking_reference, email, availability, frequency_preference, notes } = req.body;

    // In production, verify against your database
    // For now, just process the submission

    // Count slots
    const availableSlots = Object.values(availability).filter(v => v === 'available').length;
    const preferredSlots = Object.values(availability).filter(v => v === 'preferred').length;

    // Notify staff
    await notifyStaffOfAvailability({
      bookingRef: booking_reference,
      email,
      availableSlots,
      preferredSlots,
      frequency_preference,
      notes
    });

    // Confirm to customer
    await sendConfirmationToCustomer(email, booking_reference);

    res.json({ success: true });
  } catch (err) {
    console.error('Error processing availability:', err);
    res.status(500).json({ error: err.message });
  }
};

async function notifyStaffOfAvailability({ bookingRef, email, availableSlots, preferredSlots, frequency_preference, notes }) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT),
    secure: process.env.SMTP_PORT === '465',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  await transporter.sendMail({
    from: 'CoachCarter System <system@coachcarter.uk>',
    to: process.env.STAFF_EMAIL,
    subject: `📅 Availability received — ${bookingRef}`,
    html: `
      <h2>Availability Submitted</h2>
      <p><strong>Reference:</strong> ${bookingRef}</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Slots selected:</strong> ${availableSlots + preferredSlots} total (${preferredSlots} preferred)</p>
      <p><strong>Frequency:</strong> ${frequency_preference}</p>
      <p><strong>Notes:</strong> ${notes || 'None'}</p>
      <p><a href="https://coachcarter.uk/admin.html">View in dashboard →</a></p>
    `
  });

  // Slack
  if (process.env.SLACK_WEBHOOK_URL) {
    await fetch(process.env.SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `📅 Availability received — ${bookingRef}`,
        blocks: [
          {
            type: 'section',
            text: { type: 'mrkdwn', text: `*${bookingRef}* submitted availability` }
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Slots:*\n${availableSlots + preferredSlots} (${preferredSlots} preferred)` },
              { type: 'mrkdwn', text: `*Frequency:*\n${frequency_preference}` },
              { type: 'mrkdwn', text: `*Notes:*\n${notes || 'None'}` }
            ]
          }
        ]
      })
    });
  }
}

async function sendConfirmationToCustomer(email, bookingRef) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT),
    secure: process.env.SMTP_PORT === '465',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  await transporter.sendMail({
    from: 'CoachCarter <bookings@coachcarter.uk>',
    to: email,
    subject: 'Availability received — We'll propose slots within 24 hours',
    html: `
      <h1>Got it.</h1>
      <p>We've captured your availability preferences.</p>
      <h2>What happens next:</h2>
      <ol>
        <li>We review your slots against instructor schedules</li>
        <li>We propose specific lesson times (within 24 hours)</li>
        <li>You confirm or request adjustments</li>
        <li>First lesson locked in, instructor introduced</li>
      </ol>
      <p>Reference: ${bookingRef}</p>
    `
  });
}