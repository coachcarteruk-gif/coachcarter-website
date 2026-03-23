// Shared authentication helpers used by magic-link.js and instructor.js
const nodemailer = require('nodemailer');
const crypto = require('crypto');

/** Create a reusable nodemailer transporter from env vars */
function createTransporter() {
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   parseInt(process.env.SMTP_PORT),
    secure: process.env.SMTP_PORT === '465',
    auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

/** Generate a cryptographically secure random token */
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

module.exports = { createTransporter, generateToken };
