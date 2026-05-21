// Notification log writer — shared by api/_whatsapp.js (SMS) and
// api/_auth-helpers.js (email via nodemailer).
//
// Records every email / SMS attempt in `notification_log` so support can
// answer "did we actually try to send the reminder?" when a learner says
// they never got one.
//
// Writes are fire-and-forget on the caller's side: the send is awaited
// first, the log row is written after. Log-write failures are swallowed
// (console.error only) — logging is observability, never break the send.

const { neon } = require('@neondatabase/serverless');

const VALID_CHANNELS = new Set(['email', 'sms', 'whatsapp']);
const VALID_STATUS   = new Set(['sent', 'failed', 'skipped']);

/**
 * Record a single send attempt.
 *
 * @param {Object} entry
 * @param {'email'|'sms'|'whatsapp'} entry.channel
 * @param {string} entry.purpose            Coarse label, e.g. 'reminder.lesson',
 *                                          'booking.confirmation', 'welcome',
 *                                          'gdpr.deletion', 'admin.invite',
 *                                          'auth.password_reset', 'other'.
 * @param {string} entry.recipient          Email address or phone number.
 * @param {string} [entry.deliveryStatus]   'sent' (default) | 'failed' | 'skipped'.
 * @param {string} [entry.errorMessage]     Truncated to 500 chars.
 * @param {string} [entry.payloadSummary]   Subject line or first 80 chars of body.
 * @param {number} [entry.learnerId]
 * @param {number} [entry.instructorId]
 * @param {number} [entry.schoolId]         Defaults to 1.
 */
async function logNotification(entry) {
  try {
    const sql = neon(process.env.POSTGRES_URL);
    const channel = VALID_CHANNELS.has(entry.channel) ? entry.channel : 'email';
    const status  = VALID_STATUS.has(entry.deliveryStatus) ? entry.deliveryStatus : 'sent';
    const purpose = String(entry.purpose || 'other').slice(0, 80);
    const recipient = String(entry.recipient || '').slice(0, 200);
    const payload   = entry.payloadSummary ? String(entry.payloadSummary).slice(0, 200) : null;
    const errMsg    = entry.errorMessage ? String(entry.errorMessage).slice(0, 500) : null;
    const learnerId    = Number.isInteger(entry.learnerId)    ? entry.learnerId    : null;
    const instructorId = Number.isInteger(entry.instructorId) ? entry.instructorId : null;
    const schoolId     = Number.isInteger(entry.schoolId)     ? entry.schoolId     : 1;

    await sql`
      INSERT INTO notification_log (
        channel, purpose, recipient, learner_id, instructor_id,
        payload_summary, delivery_status, error_message, school_id
      ) VALUES (
        ${channel}, ${purpose}, ${recipient}, ${learnerId}, ${instructorId},
        ${payload}, ${status}, ${errMsg}, ${schoolId}
      )
    `;
  } catch (err) {
    console.error('notification_log write failed:', err.message);
  }
}

module.exports = { logNotification };
