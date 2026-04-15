/**
 * Shared resolver for the post-lesson dual confirmation system.
 *
 * After each confirmation submission (instructor or learner), this module:
 *  1. Checks whether both parties have now submitted.
 *  2. Determines the final booking status based on agreement/disagreement.
 *  3. Updates lesson_bookings.status accordingly.
 *  4. Sends admin alert emails for disputes and lateness reports.
 *
 * Returns { resolved: true, newStatus } if both parties responded,
 * or { resolved: false } if only one has responded so far.
 */
const { createTransporter } = require('./_auth-helpers');

const STAFF_EMAIL = () => process.env.STAFF_EMAIL || process.env.ERROR_ALERT_EMAIL;
const BASE_URL    = () => process.env.BASE_URL || 'https://coachcarter.uk';

/**
 * Attempt to resolve a booking's confirmation status.
 * @param {Function} sql - neon SQL tagged template
 * @param {number} bookingId
 * @returns {{ resolved: boolean, newStatus?: string }}
 */
async function resolveConfirmations(sql, bookingId) {
  // Fetch both confirmations (max 2 rows)
  const confirmations = await sql`
    SELECT confirmed_by_role, lesson_happened, late_party, late_minutes, notes, auto_confirmed
    FROM lesson_confirmations
    WHERE booking_id = ${bookingId}
    ORDER BY confirmed_by_role
  `;

  if (confirmations.length < 2) {
    return { resolved: false };
  }

  const instructor = confirmations.find(c => c.confirmed_by_role === 'instructor');
  const learner    = confirmations.find(c => c.confirmed_by_role === 'learner');

  let newStatus;
  if (instructor.lesson_happened && learner.lesson_happened) {
    newStatus = 'completed';
  } else if (!instructor.lesson_happened && !learner.lesson_happened) {
    newStatus = 'no_show';
  } else {
    newStatus = 'disputed';
  }

  // Update booking status
  await sql`
    UPDATE lesson_bookings SET status = ${newStatus}
    WHERE id = ${bookingId} AND status IN ('awaiting_confirmation', 'confirmed')
  `;

  // Fetch booking details for admin alerts
  const [booking] = await sql`
    SELECT lb.id, lb.scheduled_date::text, lb.start_time::text,
           lu.name AS learner_name, i.name AS instructor_name
    FROM lesson_bookings lb
    JOIN learner_users lu ON lu.id = lb.learner_id
    JOIN instructors i ON i.id = lb.instructor_id
    WHERE lb.id = ${bookingId}
  `;

  // Send admin alerts
  if (newStatus === 'disputed') {
    sendDisputeAlert(booking, instructor, learner);
  }

  // Check for lateness reports from either party
  const latenessReports = confirmations.filter(c => c.late_party);
  if (latenessReports.length > 0) {
    sendLatenessAlert(booking, latenessReports);
  }

  return { resolved: true, newStatus };
}

function sendDisputeAlert(booking, instructorConf, learnerConf) {
  const to = STAFF_EMAIL();
  if (!to) return;

  const isoDate = booking.scheduled_date instanceof Date ? booking.scheduled_date.toISOString().slice(0, 10) : String(booking.scheduled_date).slice(0, 10);
  const dateStr = new Date(isoDate + 'T00:00:00Z')
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const adminUrl = `${BASE_URL()}/admin/portal.html`;

  try {
    const mailer = createTransporter();
    mailer.sendMail({
      from: 'CoachCarter <system@coachcarter.uk>',
      to,
      subject: `[CoachCarter] Lesson dispute — Booking #${booking.id}`,
      html: `
        <h2 style="color:#ef4444;">Lesson Dispute</h2>
        <p><strong>Booking #${booking.id}</strong> on ${dateStr} at ${booking.start_time}</p>
        <p><strong>Instructor:</strong> ${booking.instructor_name}</p>
        <p><strong>Learner:</strong> ${booking.learner_name}</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;">
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <tr>
            <td style="padding:8px;font-weight:bold;">Instructor says:</td>
            <td style="padding:8px;">${instructorConf.lesson_happened ? 'Lesson happened' : 'Lesson did NOT happen'}</td>
          </tr>
          <tr>
            <td style="padding:8px;font-weight:bold;">Learner says:</td>
            <td style="padding:8px;">${learnerConf.lesson_happened ? 'Lesson happened' : 'Lesson did NOT happen'}</td>
          </tr>
          ${instructorConf.notes ? `<tr><td style="padding:8px;font-weight:bold;">Instructor notes:</td><td style="padding:8px;">${instructorConf.notes}</td></tr>` : ''}
          ${learnerConf.notes ? `<tr><td style="padding:8px;font-weight:bold;">Learner notes:</td><td style="padding:8px;">${learnerConf.notes}</td></tr>` : ''}
        </table>
        <p style="margin:24px 0;">
          <a href="${adminUrl}" style="background:#f58321;color:white;padding:12px 24px;text-decoration:none;border-radius:8px;font-weight:bold;">
            Resolve in Admin Portal
          </a>
        </p>
      `
    }).catch(() => {});
  } catch (_) {}
}

function sendLatenessAlert(booking, latenessReports) {
  const to = STAFF_EMAIL();
  if (!to) return;

  const isoDate2 = booking.scheduled_date instanceof Date ? booking.scheduled_date.toISOString().slice(0, 10) : String(booking.scheduled_date).slice(0, 10);
  const dateStr = new Date(isoDate2 + 'T00:00:00Z')
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

  const rows = latenessReports.map(r => {
    const reporter = r.confirmed_by_role === 'instructor' ? booking.instructor_name : booking.learner_name;
    const lateParty = r.late_party === 'instructor' ? booking.instructor_name : booking.learner_name;
    return `<tr>
      <td style="padding:8px;">${reporter} (${r.confirmed_by_role})</td>
      <td style="padding:8px;">${lateParty} was ${r.late_minutes} min late</td>
      ${r.notes ? `<td style="padding:8px;">${r.notes}</td>` : '<td style="padding:8px;">—</td>'}
    </tr>`;
  }).join('');

  try {
    const mailer = createTransporter();
    mailer.sendMail({
      from: 'CoachCarter <system@coachcarter.uk>',
      to,
      subject: `[CoachCarter] Lateness reported — Booking #${booking.id}`,
      html: `
        <h2 style="color:#f59e0b;">Lateness Reported</h2>
        <p><strong>Booking #${booking.id}</strong> on ${dateStr} at ${booking.start_time}</p>
        <p><strong>Instructor:</strong> ${booking.instructor_name} | <strong>Learner:</strong> ${booking.learner_name}</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:16px;">
          <tr style="background:#f9fafb;"><th style="padding:8px;text-align:left;">Reported by</th><th style="padding:8px;text-align:left;">Details</th><th style="padding:8px;text-align:left;">Notes</th></tr>
          ${rows}
        </table>
      `
    }).catch(() => {});
  } catch (_) {}
}

module.exports = { resolveConfirmations };
