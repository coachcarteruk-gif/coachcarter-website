// Consolidated enquiries endpoint — replaces:
//   get-enquiries.js, get-enquiry.js, submit-enquiry.js, update-enquiry-status.js
//
// Routes:
//   GET  /api/enquiries?action=list                → list all enquiries
//   GET  /api/enquiries?action=get&id=123          → single enquiry
//   POST /api/enquiries?action=submit              → submit new enquiry
//   POST /api/enquiries?action=update-status       → update enquiry status

const { Resend }     = require('resend');
const nodemailer     = require('nodemailer');
const { neon }       = require('@neondatabase/serverless');
const jwt            = require('jsonwebtoken');
const { reportError } = require('./_error-alert');

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST || 'smtp.ionos.co.uk',
  port:   parseInt(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
});

// Admin auth — checks JWT or ADMIN_SECRET
function verifyAdmin(req) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(auth.slice(7), process.env.JWT_SECRET);
      if (decoded.role === 'admin' || decoded.role === 'superadmin') return true;
      if (decoded.role === 'instructor' && decoded.isAdmin === true) return true;
    } catch {}
  }
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;
  const provided = req.body?.admin_secret || req.headers['x-admin-secret'];
  return provided === secret;
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization, X-Admin-Secret');
}

module.exports = async (req, res) => {
  setCors(res);
  const action = req.query.action;

  if (action === 'submit')        return handleSubmit(req, res);

  // Admin-only endpoints
  if (!verifyAdmin(req)) return res.status(401).json({ error: 'Unauthorised — admin access required' });
  if (action === 'list')          return handleList(req, res);
  if (action === 'get')           return handleGet(req, res);
  if (action === 'update-status') return handleUpdateStatus(req, res);

  return res.status(400).json({ error: 'Unknown action' });
};

// ── GET /api/enquiries?action=list ────────────────────────────────────────────
async function handleList(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const sql = neon(process.env.POSTGRES_URL);

    const enquiries = await sql`
      SELECT * FROM enquiries ORDER BY submitted_at DESC LIMIT 50
    `;
    return res.json({ enquiries });
  } catch (err) {
    console.error('enquiries list error:', err);
    reportError('/api/enquiries', err);
    return res.status(500).json({ error: 'Database error', details: err.message });
  }
}

// ── GET /api/enquiries?action=get&id=123 ──────────────────────────────────────
async function handleGet(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'ID required' });
  try {
    const sql = neon(process.env.POSTGRES_URL);
    const [enquiry] = await sql`SELECT * FROM enquiries WHERE id = ${id}`;
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

  let dbSaved = false;
  let enquiryId;
  let sheetsSaved = false;

  // Save to DB
  try {
    const sql = neon(process.env.POSTGRES_URL);

    const result = await sql`
      INSERT INTO enquiries (name, email, phone, enquiry_type, message, marketing_consent, submitted_at)
      VALUES (
        ${name}, ${email}, ${phone}, ${enquiryType},
        ${message || null}, ${marketing || false},
        ${submittedAt || new Date().toISOString()}
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

  const emailHtml = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:40px 20px;color:#272727">
      <div style="text-align:center;margin-bottom:32px">
        <h2 style="color:#f58321;margin:0;font-size:28px">CoachCarter</h2>
        <p style="color:#797879;margin:8px 0 0;font-size:14px">New Website Enquiry</p>
      </div>
      <div style="background:#f9f9f9;border-radius:16px;padding:32px;border:1px solid #e0e0e0">
        <div style="margin-bottom:24px">
          <label style="display:block;font-size:12px;text-transform:uppercase;color:#797879;font-weight:700;margin-bottom:4px">Enquiry Type</label>
          <div style="font-size:18px;font-weight:700;color:#f58321">${formattedType}</div>
        </div>
        <div style="margin-bottom:20px">
          <label style="display:block;font-size:12px;text-transform:uppercase;color:#797879;font-weight:700;margin-bottom:4px">Name</label>
          <div>${name}</div>
        </div>
        <div style="margin-bottom:20px">
          <label style="display:block;font-size:12px;text-transform:uppercase;color:#797879;font-weight:700;margin-bottom:4px">Email</label>
          <div><a href="mailto:${email}" style="color:#272727">${email}</a></div>
        </div>
        <div style="margin-bottom:20px">
          <label style="display:block;font-size:12px;text-transform:uppercase;color:#797879;font-weight:700;margin-bottom:4px">Phone</label>
          <div><a href="tel:${phone}" style="color:#272727">${phone}</a></div>
        </div>
        ${message ? `
        <div style="margin-bottom:20px">
          <label style="display:block;font-size:12px;text-transform:uppercase;color:#797879;font-weight:700;margin-bottom:4px">Message</label>
          <div style="line-height:1.6;white-space:pre-wrap">${message.replace(/\n/g, '<br>')}</div>
        </div>` : ''}
        <div style="margin-top:24px;padding-top:24px;border-top:1px solid #e0e0e0;font-size:12px;color:#797879">
          <strong>Marketing Consent:</strong> ${marketing ? 'Yes' : 'No'}<br>
          <strong>Submitted:</strong> ${new Date(submittedAt || Date.now()).toLocaleString('en-GB')}
        </div>
      </div>
      <div style="text-align:center;margin-top:32px;font-size:12px;color:#797879">
        <p>
          <a href="mailto:${email}?subject=Re: Your enquiry to CoachCarter"
             style="background:#f58321;color:white;padding:12px 24px;text-decoration:none;border-radius:8px;display:inline-block;font-weight:700;margin-right:8px">
            Reply to ${name}
          </a>
          <a href="tel:${phone}"
             style="background:#272727;color:white;padding:12px 24px;text-decoration:none;border-radius:8px;display:inline-block;font-weight:700">
            Call ${phone}
          </a>
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
async function handleUpdateStatus(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { id, status } = req.body;
  if (!id || !status) return res.status(400).json({ error: 'ID and status required' });
  try {
    const sql = neon(process.env.POSTGRES_URL);
    await sql`UPDATE enquiries SET status = ${status} WHERE id = ${id}`;
    return res.json({ success: true });
  } catch (err) {
    console.error('enquiries update-status error:', err);
    reportError('/api/enquiries', err);
    return res.status(500).json({ error: 'Failed to update status' });
  }
}
