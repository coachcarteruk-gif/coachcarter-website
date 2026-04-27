const twilio = require('twilio');

// 8-second timeout — safely under Vercel's function limit.
// Twilio SDK default (~30s) can exceed the limit on slow cold-starts,
// causing silent teardown of the in-flight HTTP request.
const TWILIO_TIMEOUT_MS = 8000;

function sendWhatsApp(to, message) {
  const sid  = process.env.TWILIO_SID;
  const auth = process.env.TWILIO_AUTH;
  const from = process.env.TWILIO_WHATSAPP_FROM;
  if (!sid || !auth || !from || !to) return Promise.resolve();

  // Normalise to E.164: UK numbers starting with 0 → +44
  let phone = to.replace(/\s+/g, '');
  if (phone.startsWith('0')) phone = '+44' + phone.slice(1);
  else if (!phone.startsWith('+')) phone = '+' + phone;

  const client = twilio(sid, auth, { timeout: TWILIO_TIMEOUT_MS });
  return client.messages.create({
    from: `whatsapp:${from}`,
    to:   `whatsapp:${phone}`,
    body: message
  }).catch(err => {
    // Log full error including Twilio code (e.g. 63016 = opt-in required,
    // 21211 = invalid number) so failures are diagnosable in Vercel logs.
    console.warn('WhatsApp failed:', err.code, err.message, '→ to:', phone);
  });
}

module.exports = { sendWhatsApp };
