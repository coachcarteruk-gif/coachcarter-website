// Shared authentication helpers used by magic-link.js and instructor.js
const nodemailer = require('nodemailer');
const crypto = require('crypto');

/** Create a reusable nodemailer transporter from env vars.
 *  Wraps sendMail to sanitize recipient addresses, preventing 501 SMTP errors. */
function createTransporter() {
  const transport = nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   parseInt(process.env.SMTP_PORT),
    secure: process.env.SMTP_PORT === '465',
    auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });

  const origSendMail = transport.sendMail.bind(transport);
  transport.sendMail = function(mailOptions, ...args) {
    if (mailOptions && mailOptions.to) {
      const cleaned = sanitizeEmail(mailOptions.to);
      if (!cleaned) {
        return Promise.reject(new Error(`Invalid recipient email: ${mailOptions.to}`));
      }
      mailOptions.to = cleaned;
    }
    return origSendMail(mailOptions, ...args);
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
