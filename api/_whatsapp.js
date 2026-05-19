const twilio = require('twilio');
const { logNotification } = require('./_notification-log');

// 8-second timeout — safely under Vercel's function limit.
const TWILIO_TIMEOUT_MS = 8000;

/**
 * Send an SMS via Twilio. Despite the function name, this goes out as a
 * regular SMS using TWILIO_WHATSAPP_FROM as the sender ID (legacy name).
 *
 * Every attempt is recorded in `notification_log` after the send completes.
 * Pass `meta` to enrich the log row (purpose / learner_id / instructor_id /
 * school_id). If omitted, the row is recorded with purpose='other' and no
 * foreign keys.
 *
 * Logging never blocks the send — log writes are awaited but their errors
 * are swallowed inside logNotification.
 */
async function sendWhatsApp(to, message, meta = {}) {
  const sid  = process.env.TWILIO_SID;
  const auth = process.env.TWILIO_AUTH;
  const from = process.env.TWILIO_WHATSAPP_FROM;
  if (!sid || !auth || !from || !to) {
    // No-op path — record as skipped so support can tell config-missing apart
    // from "we tried but it failed". Only logs if a recipient was supplied.
    if (to) {
      await logNotification({
        channel: 'sms',
        purpose: meta.purpose || 'other',
        recipient: to,
        deliveryStatus: 'skipped',
        errorMessage: 'Twilio not configured or recipient missing',
        payloadSummary: summarise(message),
        learnerId: meta.learnerId,
        instructorId: meta.instructorId,
        schoolId: meta.schoolId,
      });
    }
    return;
  }

  // Normalise to E.164: UK numbers starting with 0 → +44
  let phone = to.replace(/\s+/g, '');
  if (phone.startsWith('0')) phone = '+44' + phone.slice(1);
  else if (!phone.startsWith('+')) phone = '+' + phone;

  const client = twilio(sid, auth, { timeout: TWILIO_TIMEOUT_MS });
  try {
    await client.messages.create({ from, to: phone, body: message });
    await logNotification({
      channel: 'sms',
      purpose: meta.purpose || 'other',
      recipient: phone,
      deliveryStatus: 'sent',
      payloadSummary: summarise(message),
      learnerId: meta.learnerId,
      instructorId: meta.instructorId,
      schoolId: meta.schoolId,
    });
  } catch (err) {
    console.warn('SMS failed:', err.code, err.message, '→ to:', phone);
    await logNotification({
      channel: 'sms',
      purpose: meta.purpose || 'other',
      recipient: phone,
      deliveryStatus: 'failed',
      errorMessage: `[${err.code || 'ERR'}] ${err.message}`,
      payloadSummary: summarise(message),
      learnerId: meta.learnerId,
      instructorId: meta.instructorId,
      schoolId: meta.schoolId,
    });
  }
}

function summarise(message) {
  if (!message) return null;
  const oneLine = String(message).replace(/\s+/g, ' ').trim();
  return oneLine.slice(0, 80);
}

module.exports = { sendWhatsApp };
