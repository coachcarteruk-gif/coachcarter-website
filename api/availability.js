const { Resend } = require('resend');
const { neon } = require('@neondatabase/serverless');
const { reportError } = require('./_error-alert');
const { requireAuth } = require('./_auth');

// Initialize Resend
const resend = new Resend(process.env.RESEND_API_KEY);

module.exports = async (req, res) => {
  // CORS handled centrally by middleware.js
  // GET — fetch submissions (admin use)
  if (req.method === 'GET') {
    const admin = requireAuth(req, { roles: ['admin'] });
    if (!admin) return res.status(401).json({ error: 'Unauthorised — admin access required' });

    try {
      const sql = neon(process.env.POSTGRES_URL);
      const { status, limit = 50, offset = 0 } = req.query;
      let query = 'SELECT * FROM availability_submissions';
      let params = [];
      let countQuery = 'SELECT COUNT(*) as total FROM availability_submissions';
      let countParams = [];
      if (status) {
        query += ' WHERE status = $1';
        countQuery += ' WHERE status = $1';
        params.push(status);
        countParams.push(status);
      }
      query += ` ORDER BY submitted_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(parseInt(limit), parseInt(offset));
      const submissions = await sql(query, params);
      const countResult = await sql(countQuery, countParams);
      return res.status(200).json({
        submissions,
        pagination: { total: parseInt(countResult[0].total), limit: parseInt(limit), offset: parseInt(offset) }
      });
    } catch (err) {
      reportError('/api/availability', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
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
    reportError('/api/availability', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};
