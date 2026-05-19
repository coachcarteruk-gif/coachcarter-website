// Shared authentication helpers used by magic-link.js and instructor.js
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const { logNotification } = require('./_notification-log');

/** Create a reusable nodemailer transporter from env vars.
 *  Wraps sendMail to:
 *    1. Sanitize recipient addresses (preventing 501 SMTP errors).
 *    2. Record every send attempt to notification_log.
 *
 *  Callers may attach a `_log` field to mailOptions to enrich the log row:
 *    mailOptions._log = { purpose, learnerId, instructorId, schoolId }
 *  If omitted, the row is recorded with purpose='other' and no foreign keys.
 *  The `_log` field is stripped before being passed to nodemailer. */
function createTransporter() {
  const transport = nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   parseInt(process.env.SMTP_PORT),
    secure: process.env.SMTP_PORT === '465',
    auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });

  const origSendMail = transport.sendMail.bind(transport);
  transport.sendMail = async function(mailOptions, ...args) {
    const logMeta = (mailOptions && mailOptions._log) || {};
    if (mailOptions && '_log' in mailOptions) delete mailOptions._log;

    let cleanedTo = null;
    if (mailOptions && mailOptions.to) {
      cleanedTo = sanitizeEmail(mailOptions.to);
      if (!cleanedTo) {
        await logNotification({
          channel: 'email',
          purpose: logMeta.purpose || 'other',
          recipient: String(mailOptions.to),
          deliveryStatus: 'failed',
          errorMessage: `Invalid recipient email: ${mailOptions.to}`,
          payloadSummary: mailOptions.subject || null,
          learnerId: logMeta.learnerId,
          instructorId: logMeta.instructorId,
          schoolId: logMeta.schoolId,
        });
        throw new Error(`Invalid recipient email: ${mailOptions.to}`);
      }
      mailOptions.to = cleanedTo;
    }

    try {
      const result = await origSendMail(mailOptions, ...args);
      await logNotification({
        channel: 'email',
        purpose: logMeta.purpose || 'other',
        recipient: cleanedTo || (mailOptions && mailOptions.to) || '',
        deliveryStatus: 'sent',
        payloadSummary: mailOptions && mailOptions.subject ? mailOptions.subject : null,
        learnerId: logMeta.learnerId,
        instructorId: logMeta.instructorId,
        schoolId: logMeta.schoolId,
      });
      return result;
    } catch (err) {
      await logNotification({
        channel: 'email',
        purpose: logMeta.purpose || 'other',
        recipient: cleanedTo || (mailOptions && mailOptions.to) || '',
        deliveryStatus: 'failed',
        errorMessage: err.message,
        payloadSummary: mailOptions && mailOptions.subject ? mailOptions.subject : null,
        learnerId: logMeta.learnerId,
        instructorId: logMeta.instructorId,
        schoolId: logMeta.schoolId,
      });
      throw err;
    }
  };

  return transport;
}

/** Generate a cryptographically secure random token */
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

/** Strip all whitespace from an email and lowercase it. Returns null if invalid. */
function sanitizeEmail(email) {
  if (!email) return null;
  const cleaned = email.replace(/\s+/g, '').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) return null;
  return cleaned;
}

module.exports = { createTransporter, generateToken, sanitizeEmail };
