/**
 * Fire-and-forget email error alerting.
 * Uses existing SMTP config + ERROR_ALERT_EMAIL env var for the recipient.
 */
const { createTransporter } = require('./_auth-helpers');

function reportError(endpoint, err) {
  const to = process.env.ERROR_ALERT_EMAIL;
  if (!to) return;

  const message = err && err.message ? err.message : String(err);
  const stack = err && err.stack ? err.stack : '';
  const timestamp = new Date().toISOString();

  try {
    const transporter = createTransporter();
    transporter.sendMail({
      from: process.env.SMTP_USER,
      to,
      subject: `[CoachCarter] 500 Error on ${endpoint}`,
      text: `Endpoint: ${endpoint}\nTime: ${timestamp}\n\nError: ${message}\n\nStack:\n${stack}`,
      html: `
        <h3 style="color:#ef4444;">500 Error on <code>${endpoint}</code></h3>
        <p><strong>Time:</strong> ${timestamp}</p>
        <p><strong>Error:</strong> ${message}</p>
        <pre style="background:#f5f5f5;padding:12px;border-radius:6px;font-size:13px;overflow-x:auto;">${stack}</pre>
      `
    }).catch(() => {}); // fire-and-forget
  } catch (_) {} // don't let alert failures break anything
}

module.exports = { reportError };
