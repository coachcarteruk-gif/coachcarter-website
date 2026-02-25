const { Resend } = require('resend');
const { neon } = require('@neondatabase/serverless');

// Initialize Resend
const resend = new Resend(process.env.RESEND_API_KEY);

module.exports = async (req, res) => {
  // CORS headers
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

    // Connect to database
    const sql = neon(process.env.POSTGRES_URL);

    // Count slots
    const availableSlots = Object.values(availability).filter(v => v === 'available').length;
    const preferredSlots = Object.values(availability).filter(v => v === 'preferred').length;

    // Convert availability object to arrays for database
    const preferredDays = Object.entries(availability)
      .filter(([key, value]) => value === 'preferred')
      .map(([key]) => key);

    const availableDays = Object.entries(availability)
      .filter(([key, value]) => value === 'available')
      .map(([key]) => key);

    // Save to database
    const result = await sql(
      `INSERT INTO availability_submissions (
        customer_email,
        booking_reference,
        preferred_days,
        available_days,
        frequency_preference,
        additional_notes,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [
        email,
        booking_reference,
        preferredDays,
        availableDays,
        frequency_preference || null,
        notes || null,
        'pending'
      ]
    );

    const submission = result[0];

    // Send staff notification
    await resend.emails.send({
      from: 'CoachCarter <system@coachcarter.uk>',
      to: process.env.STAFF_EMAIL,
      subject: `📅 Availability received — ${booking_reference}`,
      html: `
        <h2>Availability Submitted</h2>
        <p><strong>Reference:</strong> ${booking_reference}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Slots selected:</strong> ${availableSlots + preferredSlots} total (${preferredSlots} preferred)</p>
        <p><strong>Frequency:</strong> ${frequency_preference}</p>
        <p><strong>Notes:</strong> ${notes || 'None'}</p>
        <p><a href="https://coachcarter.uk/admin.html">View in dashboard →</a></p>
      `
    });

    // Send customer confirmation
    await resend.emails.send({
      from: 'CoachCarter <bookings@coachcarter.uk>',
      to: email,
      subject: "Availability received — We'll propose slots within 24 hours",
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
        <p>Reference: ${booking_reference}</p>
      `
    });

    res.json({ success: true, submissionId: submission.id });

  } catch (err) {
    console.error('Error processing availability:', err);
    res.status(500).json({ error: err.message });
  }
};
