// Availability Submissions endpoint
//
//   GET  /api/availability?status=pending   → list (admin only, scoped to school)
//   POST /api/availability                   → submit (public, rate-limited)
//
// Tenant-scoped by school_id. All admin queries MUST filter by school_id.

const { Resend } = require('resend');
const { neon } = require('@neondatabase/serverless');
const { reportError } = require('./_error-alert');
const { requireAuth, getSchoolId } = require('./_auth');
const { checkRateLimit, getClientIp } = require('./_rate-limit');

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// HTML-escape helper for email templates — user data is never trusted.
function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = async (req, res) => {
  // CORS handled centrally by middleware.js

  // ── GET — admin list (tenant-scoped) ────────────────────────────────────────
  if (req.method === 'GET') {
    const admin = requireAuth(req, { roles: ['admin'] });
    if (!admin) return res.status(401).json({ error: 'Unauthorised — admin access required' });
    const schoolId = getSchoolId(admin, req);

    try {
      const sql = neon(process.env.POSTGRES_URL);
      const { status } = req.query;
      const limit  = Math.min(parseInt(req.query.limit)  || 50, 200);
      const offset = Math.max(parseInt(req.query.offset) || 0, 0);

      const submissions = status
        ? await sql`
            SELECT * FROM availability_submissions
            WHERE school_id = ${schoolId} AND status = ${status}
            ORDER BY submitted_at DESC
            LIMIT ${limit} OFFSET ${offset}`
        : await sql`
            SELECT * FROM availability_submissions
            WHERE school_id = ${schoolId}
            ORDER BY submitted_at DESC
            LIMIT ${limit} OFFSET ${offset}`;

      const [countRow] = status
        ? await sql`SELECT COUNT(*)::int AS total FROM availability_submissions WHERE school_id = ${schoolId} AND status = ${status}`
        : await sql`SELECT COUNT(*)::int AS total FROM availability_submissions WHERE school_id = ${schoolId}`;

      return res.status(200).json({
        submissions,
        pagination: { total: countRow.total, limit, offset }
      });
    } catch (err) {
      reportError('/api/availability', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── POST — public submission (rate-limited, validated) ──────────────────────
  try {
    const { booking_reference, email, availability, frequency_preference, notes } = req.body || {};

    // Validate inputs
    if (!email || typeof email !== 'string') return res.status(400).json({ error: 'Email is required' });
    if (!availability || typeof availability !== 'object' || Array.isArray(availability)) {
      return res.status(400).json({ error: 'Availability is required' });
    }
    if (email.length > 254) return res.status(400).json({ error: 'Email too long' });
    if (notes && typeof notes === 'string' && notes.length > 2000) {
      return res.status(400).json({ error: 'Notes too long' });
    }

    const sql = neon(process.env.POSTGRES_URL);

    // Rate limiting: max 5 submissions per IP per hour (see api/_rate-limit.js)
    const rl = await checkRateLimit(sql, {
      key: `availability_submit:${getClientIp(req)}`,
      max: 5,
      windowSeconds: 3600,
    });
    if (!rl.allowed) {
      return res.status(429).json({ error: 'Too many submissions. Please try again later.' });
    }

    const schoolId = parseInt(req.body.school_id) || 1;

    // Count and group slots
    const values = Object.values(availability);
    const availableSlots = values.filter(v => v === 'available').length;
    const preferredSlots = values.filter(v => v === 'preferred').length;

    const preferredDays = Object.entries(availability)
      .filter(([, v]) => v === 'preferred')
      .map(([k]) => k);
    const availableDays = Object.entries(availability)
      .filter(([, v]) => v === 'available')
      .map(([k]) => k);

    // Save to database (tenant-scoped)
    const [submission] = await sql`
      INSERT INTO availability_submissions (
        customer_email,
        booking_reference,
        preferred_days,
        available_days,
        frequency_preference,
        additional_notes,
        status,
        school_id
      ) VALUES (
        ${email},
        ${booking_reference || null},
        ${preferredDays},
        ${availableDays},
        ${frequency_preference || null},
        ${notes || null},
        'pending',
        ${schoolId}
      )
      RETURNING id`;

    // Send staff notification (escape ALL interpolations)
    if (resend && process.env.STAFF_EMAIL) {
      try {
        await resend.emails.send({
          from: 'CoachCarter <system@coachcarter.uk>',
          to: process.env.STAFF_EMAIL,
          subject: `📅 Availability received — ${esc(booking_reference || 'no ref')}`,
          html: `
            <h2>Availability Submitted</h2>
            <p><strong>Reference:</strong> ${esc(booking_reference || 'N/A')}</p>
            <p><strong>Email:</strong> ${esc(email)}</p>
            <p><strong>Slots selected:</strong> ${availableSlots + preferredSlots} total (${preferredSlots} preferred)</p>
            <p><strong>Frequency:</strong> ${esc(frequency_preference || 'N/A')}</p>
            <p><strong>Notes:</strong> ${esc(notes || 'None')}</p>
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
            <p>Reference: ${esc(booking_reference || 'N/A')}</p>
          `
        });
      } catch (emailErr) {
        console.error('availability email send failed:', emailErr.message);
      }
    }

    return res.json({ success: true, submissionId: submission.id });

  } catch (err) {
    console.error('availability POST error:', err.message);
    reportError('/api/availability', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
