// Consolidated enquiries endpoint — replaces:
//   get-enquiries.js, get-enquiry.js, submit-enquiry.js, update-enquiry-status.js
//
// Routes:
//   GET  /api/enquiries?action=list                → list all enquiries
//   GET  /api/enquiries?action=get&id=123          → single enquiry
//   POST /api/enquiries?action=submit              → submit new enquiry
//   POST /api/enquiries?action=update-status       → update enquiry status

const { Resend }     = require('resend');
const { neon }       = require('@neondatabase/serverless');
const { reportError } = require('./_error-alert');
const { createTransporter } = require('./_auth-helpers');
const { requireAuth, getSchoolId } = require('./_auth');
const { checkRateLimit, getClientIp } = require('./_rate-limit');

// HTML-escape helper for email templates — user input is never trusted.
function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Normalise an email to a safe mailto/href value: reject anything that isn't
// a plausible email address to prevent attribute-context injection.
function safeEmail(raw) {
  const s = String(raw == null ? '' : raw).trim();
  return /^[^\s<>"']+@[^\s<>"']+$/.test(s) ? s : '';
}

// Normalise a phone to a safe tel: href value: strip everything except digits
// and the leading +.
function safePhone(raw) {
  return String(raw == null ? '' : raw).replace(/[^\d+]/g, '');
}

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const transporter = createTransporter();

module.exports = async (req, res) => {
  const action = req.query.action;

  if (action === 'submit')        return handleSubmit(req, res);

  // Admin-only endpoints
  const admin = requireAuth(req, { roles: ['admin'] });
  if (!admin) return res.status(401).json({ error: 'Unauthorised — admin access required' });
  const schoolId = getSchoolId(admin, req);

  if (action === 'list')          return handleList(req, res, schoolId);
  if (action === 'get')           return handleGet(req, res, schoolId);
  if (action === 'update-status') return handleUpdateStatus(req, res, schoolId);

  return res.status(400).json({ error: 'Unknown action' });
};

// ── GET /api/enquiries?action=list ────────────────────────────────────────────
async function handleList(req, res, schoolId) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const sql = neon(process.env.POSTGRES_URL);

    const enquiries = await sql`
      SELECT * FROM enquiries WHERE school_id = ${schoolId} ORDER BY submitted_at DESC LIMIT 50
    `;
    return res.json({ enquiries });
  } catch (err) {
    console.error('enquiries list error:', err);
    reportError('/api/enquiries', err);
    return res.status(500).json({ error: 'Database error' });
  }
}

// ── GET /api/enquiries?action=get&id=123 ──────────────────────────────────────
async function handleGet(req, res, schoolId) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'ID required' });
  try {
    const sql = neon(process.env.POSTGRES_URL);
    const [enquiry] = await sql`SELECT * FROM enquiries WHERE id = ${id} AND school_id = ${schoolId}`;
    if (!enquiry) return res.status(404).json({ error: 'Not found' });
    return res.json({ enquiry });
  } catch (err) {
    console.error('enquiries get error:', err);
    reportError('/api/enquiries', err);
    return res.status(500).json({ error: 'Failed to load enquiry' });
  }
}

// ── POST /api/enquiries?action=submit ─────────────────────────────────────────
async function handleSubmit(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, email, phone, enquiryType, message, marketing, submittedAt } = req.body;
  if (!name || !email || !phone || !enquiryType)
    return res.status(400).json({ error: 'Missing required fields' });

  // Rate limiting: max 5 submissions per IP per hour (see api/_rate-limit.js)
  const sql = neon(process.env.POSTGRES_URL);
  const rl = await checkRateLimit(sql, {
    key: `enquiry_submit:${getClientIp(req)}`,
    max: 5,
    windowSeconds: 3600,
  });
  if (!rl.allowed) {
    return res.status(429).json({ error: 'Too many submissions. Please try again later.' });
  }

  const schoolId = parseInt(req.body.school_id) || 1;

  let dbSaved = false;
  let enquiryId;
  let sheetsSaved = false;

  // Save to DB
  try {
    const result = await sql`
      INSERT INTO enquiries (name, email, phone, enquiry_type, message, marketing_consent, submitted_at, school_id)
      VALUES (
        ${name}, ${email}, ${phone}, ${enquiryType},
        ${message || null}, ${marketing || false},
        ${submittedAt || new Date().toISOString()},
        ${schoolId}
      )
      RETURNING id
    `;
    enquiryId = result[0].id;
    dbSaved   = true;
  } catch (dbErr) {
    console.error('Database save failed:', dbErr);
  }

  // Forward to n8n / Google Sheets
  if (process.env.N8N_WEBHOOK_URL) {
    try {
      const labels = {
        general: 'General Question', booking: 'Booking Enquiry',
        'pass-guarantee': 'Test Ready Guarantee', 'bulk-packages': 'Bulk Packages',
        availability: 'Check Availability'
      };
      const n8nRes = await fetch(process.env.N8N_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: new Date(submittedAt || Date.now()).toLocaleString('en-GB'),
          name, email, phone, type: labels[enquiryType] || enquiryType,
          message: message || '', marketing: marketing ? 'Yes' : 'No',
          status: 'New', id: enquiryId ? String(enquiryId) : 'N/A'
        })
      });
      if (n8nRes.ok) sheetsSaved = true;
    } catch (n8nErr) {
      console.error('n8n forward failed:', n8nErr);
    }
  }

  // Send staff email
  const enquiryTypeLabels = {
    general: 'General Question', booking: 'Booking Enquiry',
    'pass-guarantee': 'Test Ready Guarantee', 'bulk-packages': 'Bulk Packages',
    availability: 'Check Availability', 'join-team': 'Instructor Application'
  };
  const formattedType = enquiryTypeLabels[enquiryType] || enquiryType;
  const toEmail       = process.env.STAFF_EMAIL || 'fraser@coachcarter.uk';

  const safeMailTo = safeEmail(email);
  const safeTel    = safePhone(phone);
  const messageHtml = message ? esc(message).replace(/\n/g, '<br>') : '';

  const emailHtml = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:40px 20px;color:#272727">
      <div style="text-align:center;margin-bottom:32px">
        <h2 style="color:#f58321;margin:0;font-size:28px">CoachCarter</h2>
        <p style="color:#797879;margin:8px 0 0;font-size:14px">New Website Enquiry</p>
      </div>
      <div style="background:#f9f9f9;border-radius:16px;padding:32px;border:1px solid #e0e0e0">
        <div style="margin-bottom:24px">
          <label style="display:block;font-size:12px;text-transform:uppercase;color:#797879;font-weight:700;margin-bottom:4px">Enquiry Type</label>
          <div style="font-size:18px;font-weight:700;color:#f58321">${esc(formattedType)}</div>
        </div>
        <div style="margin-bottom:20px">
          <label style="display:block;font-size:12px;text-transform:uppercase;color:#797879;font-weight:700;margin-bottom:4px">Name</label>
          <div>${esc(name)}</div>
        </div>
        <div style="margin-bottom:20px">
          <label style="display:block;font-size:12px;text-transform:uppercase;color:#797879;font-weight:700;margin-bottom:4px">Email</label>
          <div>${safeMailTo ? `<a href="mailto:${esc(safeMailTo)}" style="color:#272727">${esc(safeMailTo)}</a>` : esc(email)}</div>
        </div>
        <div style="margin-bottom:20px">
          <label style="display:block;font-size:12px;text-transform:uppercase;color:#797879;font-weight:700;margin-bottom:4px">Phone</label>
          <div>${safeTel ? `<a href="tel:${esc(safeTel)}" style="color:#272727">${esc(safeTel)}</a>` : esc(phone)}</div>
        </div>
        ${message ? `
        <div style="margin-bottom:20px">
          <label style="display:block;font-size:12px;text-transform:uppercase;color:#797879;font-weight:700;margin-bottom:4px">Message</label>
          <div style="line-height:1.6;white-space:pre-wrap">${messageHtml}</div>
        </div>` : ''}
        <div style="margin-top:24px;padding-top:24px;border-top:1px solid #e0e0e0;font-size:12px;color:#797879">
          <strong>Marketing Consent:</strong> ${marketing ? 'Yes' : 'No'}<br>
          <strong>Submitted:</strong> ${esc(new Date(submittedAt || Date.now()).toLocaleString('en-GB'))}
        </div>
      </div>
      <div style="text-align:center;margin-top:32px;font-size:12px;color:#797879">
        <p>
          ${safeMailTo ? `<a href="mailto:${esc(safeMailTo)}?subject=Re: Your enquiry to CoachCarter"
             style="background:#f58321;color:white;padding:12px 24px;text-decoration:none;border-radius:8px;display:inline-block;font-weight:700;margin-right:8px">
            Reply to ${esc(name)}
          </a>` : ''}
          ${safeTel ? `<a href="tel:${esc(safeTel)}"
             style="background:#272727;color:white;padding:12px 24px;text-decoration:none;border-radius:8px;display:inline-block;font-weight:700">
            Call ${esc(safeTel)}
          </a>` : ''}
        </p>
      </div>
    </div>
  `;

  let emailSent = false;
  if (resend) {
    try {
      const { error } = await resend.emails.send({
        from: 'CoachCarter <enquiries@coachcarter.uk>', to: [toEmail],
        subject: `New Enquiry: ${formattedType} from ${name}`,
        html: emailHtml, reply_to: email
      });
      if (!error) emailSent = true;
    } catch (err) { console.error('Resend failed:', err); }
  }
  if (!emailSent) {
    try {
      await transporter.sendMail({
        from: `"CoachCarter" <${process.env.SMTP_USER}>`, to: toEmail,
        subject: `New Enquiry: ${formattedType} from ${name}`,
        html: emailHtml, replyTo: email
      });
    } catch (err) { console.error('Nodemailer failed:', err); }
  }

  return res.status(200).json({ success: true, dbSaved, sheetsSaved });
}

// ── POST /api/enquiries?action=update-status ──────────────────────────────────
async function handleUpdateStatus(req, res, schoolId) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { id, status } = req.body;
  if (!id || !status) return res.status(400).json({ error: 'ID and status required' });
  try {
    const sql = neon(process.env.POSTGRES_URL);
    await sql`UPDATE enquiries SET status = ${status} WHERE id = ${id} AND school_id = ${schoolId}`;
    return res.json({ success: true });
  } catch (err) {
    console.error('enquiries update-status error:', err);
    reportError('/api/enquiries', err);
    return res.status(500).json({ error: 'Failed to update status' });
  }
}
