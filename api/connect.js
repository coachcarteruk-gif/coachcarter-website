// Stripe Connect — instructor onboarding & account management
//
// Routes:
//   POST /api/connect?action=create-account      (instructor JWT)
//     → creates Express account + returns onboarding URL
//
//   GET  /api/connect?action=onboarding-link      (instructor JWT)
//     → fresh onboarding link for incomplete setup
//
//   GET  /api/connect?action=connect-status       (instructor JWT)
//     → check account status, update DB if newly complete
//
//   GET  /api/connect?action=dashboard-link       (instructor JWT)
//     → Stripe Express dashboard login link
//
//   POST /api/connect?action=admin-create-account (admin JWT)
//     → create Express account for a specific instructor
//
//   POST /api/connect?action=admin-send-invite    (admin JWT)
//     → create account + email onboarding link to instructor

const stripe   = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { neon } = require('@neondatabase/serverless');
const jwt      = require('jsonwebtoken');
const { createTransporter } = require('./_auth-helpers');
const { reportError }       = require('./_error-alert');

const BASE_URL = process.env.BASE_URL || 'https://coachcarter.co.uk';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

function verifyInstructorAuth(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  try {
    const payload = jwt.verify(auth.slice(7), secret);
    if (payload.role !== 'instructor') return null;
    return payload;
  } catch { return null; }
}

function verifyAdminJWT(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  try {
    const payload = jwt.verify(auth.slice(7), secret);
    if (payload.role === 'admin' || payload.role === 'superadmin') return payload;
    if (payload.role === 'instructor' && payload.isAdmin === true) return payload;
    return null;
  } catch { return null; }
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const action = req.query.action;
  if (action === 'create-account')      return handleCreateAccount(req, res);
  if (action === 'onboarding-link')     return handleOnboardingLink(req, res);
  if (action === 'connect-status')      return handleConnectStatus(req, res);
  if (action === 'dashboard-link')      return handleDashboardLink(req, res);
  if (action === 'admin-create-account') return handleAdminCreateAccount(req, res);
  if (action === 'admin-send-invite')    return handleAdminSendInvite(req, res);

  return res.status(400).json({ error: true, code: 'UNKNOWN_ACTION', message: 'Unknown action' });
};

// ── Instructor: Create Connect account + onboarding ──
async function handleCreateAccount(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: true, message: 'POST required' });
  const user = verifyInstructorAuth(req);
  if (!user) return res.status(401).json({ error: true, code: 'AUTH_REQUIRED', message: 'Not authenticated' });

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const [instructor] = await sql`SELECT id, email, name, stripe_account_id FROM instructors WHERE id = ${user.id}`;
    if (!instructor) return res.status(404).json({ error: true, code: 'NOT_FOUND', message: 'Instructor not found' });

    let accountId = instructor.stripe_account_id;

    // Create Express account if they don't have one yet
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'GB',
        email: instructor.email,
        capabilities: { transfers: { requested: true } },
        business_type: 'individual',
        metadata: { instructor_id: String(instructor.id), platform: 'coachcarter' }
      });
      accountId = account.id;
      await sql`UPDATE instructors SET stripe_account_id = ${accountId} WHERE id = ${instructor.id}`;
    }

    // Generate onboarding link
    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${BASE_URL}/instructor/earnings.html?connect=refresh`,
      return_url: `${BASE_URL}/instructor/earnings.html?connect=return`,
      type: 'account_onboarding'
    });

    return res.json({ ok: true, onboarding_url: link.url });
  } catch (err) {
    reportError('/api/connect?action=create-account', err);
    return res.status(500).json({ error: true, code: 'SERVER_ERROR', message: 'Failed to create Connect account' });
  }
}

// ── Instructor: Fresh onboarding link (if incomplete) ──
async function handleOnboardingLink(req, res) {
  const user = verifyInstructorAuth(req);
  if (!user) return res.status(401).json({ error: true, code: 'AUTH_REQUIRED', message: 'Not authenticated' });

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const [instructor] = await sql`SELECT stripe_account_id FROM instructors WHERE id = ${user.id}`;
    if (!instructor?.stripe_account_id) {
      return res.status(400).json({ error: true, code: 'NO_ACCOUNT', message: 'No Connect account found. Create one first.' });
    }

    const link = await stripe.accountLinks.create({
      account: instructor.stripe_account_id,
      refresh_url: `${BASE_URL}/instructor/earnings.html?connect=refresh`,
      return_url: `${BASE_URL}/instructor/earnings.html?connect=return`,
      type: 'account_onboarding'
    });

    return res.json({ ok: true, onboarding_url: link.url });
  } catch (err) {
    reportError('/api/connect?action=onboarding-link', err);
    return res.status(500).json({ error: true, code: 'SERVER_ERROR', message: 'Failed to generate onboarding link' });
  }
}

// ── Instructor: Check Connect status ──
async function handleConnectStatus(req, res) {
  const user = verifyInstructorAuth(req);
  if (!user) return res.status(401).json({ error: true, code: 'AUTH_REQUIRED', message: 'Not authenticated' });

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const [instructor] = await sql`
      SELECT stripe_account_id, stripe_onboarding_complete, payouts_paused
        FROM instructors WHERE id = ${user.id}
    `;
    if (!instructor) return res.status(404).json({ error: true, code: 'NOT_FOUND', message: 'Instructor not found' });

    const result = {
      ok: true,
      has_account: !!instructor.stripe_account_id,
      onboarding_complete: !!instructor.stripe_onboarding_complete,
      payouts_paused: !!instructor.payouts_paused
    };

    // If they have an account but onboarding not marked complete, check with Stripe
    if (instructor.stripe_account_id && !instructor.stripe_onboarding_complete) {
      const account = await stripe.accounts.retrieve(instructor.stripe_account_id);
      if (account.charges_enabled && account.payouts_enabled) {
        await sql`UPDATE instructors SET stripe_onboarding_complete = TRUE WHERE id = ${user.id}`;
        result.onboarding_complete = true;
      }
    }

    return res.json(result);
  } catch (err) {
    reportError('/api/connect?action=connect-status', err);
    return res.status(500).json({ error: true, code: 'SERVER_ERROR', message: 'Failed to check Connect status' });
  }
}

// ── Instructor: Stripe Express dashboard link ──
async function handleDashboardLink(req, res) {
  const user = verifyInstructorAuth(req);
  if (!user) return res.status(401).json({ error: true, code: 'AUTH_REQUIRED', message: 'Not authenticated' });

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const [instructor] = await sql`SELECT stripe_account_id, stripe_onboarding_complete FROM instructors WHERE id = ${user.id}`;
    if (!instructor?.stripe_account_id || !instructor.stripe_onboarding_complete) {
      return res.status(400).json({ error: true, code: 'NOT_ONBOARDED', message: 'Complete onboarding first' });
    }

    const link = await stripe.accounts.createLoginLink(instructor.stripe_account_id);
    return res.json({ ok: true, dashboard_url: link.url });
  } catch (err) {
    reportError('/api/connect?action=dashboard-link', err);
    return res.status(500).json({ error: true, code: 'SERVER_ERROR', message: 'Failed to generate dashboard link' });
  }
}

// ── Admin: Create Connect account for an instructor ──
async function handleAdminCreateAccount(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: true, message: 'POST required' });
  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: true, code: 'AUTH_REQUIRED', message: 'Admin auth required' });

  try {
    const { instructor_id } = req.body || {};
    if (!instructor_id) return res.status(400).json({ error: true, code: 'MISSING_FIELD', message: 'instructor_id required' });

    const sql = neon(process.env.POSTGRES_URL);
    const [instructor] = await sql`SELECT id, email, name, stripe_account_id FROM instructors WHERE id = ${instructor_id}`;
    if (!instructor) return res.status(404).json({ error: true, code: 'NOT_FOUND', message: 'Instructor not found' });

    let accountId = instructor.stripe_account_id;
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'GB',
        email: instructor.email,
        capabilities: { transfers: { requested: true } },
        business_type: 'individual',
        metadata: { instructor_id: String(instructor.id), platform: 'coachcarter' }
      });
      accountId = account.id;
      await sql`UPDATE instructors SET stripe_account_id = ${accountId} WHERE id = ${instructor.id}`;
    }

    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${BASE_URL}/instructor/earnings.html?connect=refresh`,
      return_url: `${BASE_URL}/instructor/earnings.html?connect=return`,
      type: 'account_onboarding'
    });

    return res.json({ ok: true, onboarding_url: link.url, account_id: accountId });
  } catch (err) {
    reportError('/api/connect?action=admin-create-account', err);
    return res.status(500).json({ error: true, code: 'SERVER_ERROR', message: 'Failed to create Connect account' });
  }
}

// ── Admin: Create account + email onboarding link to instructor ──
async function handleAdminSendInvite(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: true, message: 'POST required' });
  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: true, code: 'AUTH_REQUIRED', message: 'Admin auth required' });

  try {
    const { instructor_id } = req.body || {};
    if (!instructor_id) return res.status(400).json({ error: true, code: 'MISSING_FIELD', message: 'instructor_id required' });

    const sql = neon(process.env.POSTGRES_URL);
    const [instructor] = await sql`SELECT id, email, name, stripe_account_id FROM instructors WHERE id = ${instructor_id}`;
    if (!instructor) return res.status(404).json({ error: true, code: 'NOT_FOUND', message: 'Instructor not found' });

    let accountId = instructor.stripe_account_id;
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'GB',
        email: instructor.email,
        capabilities: { transfers: { requested: true } },
        business_type: 'individual',
        metadata: { instructor_id: String(instructor.id), platform: 'coachcarter' }
      });
      accountId = account.id;
      await sql`UPDATE instructors SET stripe_account_id = ${accountId} WHERE id = ${instructor.id}`;
    }

    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${BASE_URL}/instructor/earnings.html?connect=refresh`,
      return_url: `${BASE_URL}/instructor/earnings.html?connect=return`,
      type: 'account_onboarding'
    });

    // Send email to instructor
    const transporter = createTransporter();
    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: instructor.email,
      subject: 'Set Up Your CoachCarter Payouts',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
          <h2 style="color:#f97316;">Set Up Direct Payouts</h2>
          <p>Hi ${instructor.name},</p>
          <p>CoachCarter is now set up to pay you automatically every Friday for your completed lessons.</p>
          <p>To get started, you'll need to connect your bank account through our secure payment partner, Stripe.</p>
          <p style="text-align:center;margin:24px 0;">
            <a href="${link.url}" style="background:#f97316;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
              Set Up Payouts
            </a>
          </p>
          <p style="color:#6b7280;font-size:13px;">This link expires in a few minutes. If it expires, you can request a new one from your earnings page.</p>
        </div>
      `
    });

    return res.json({ ok: true, email_sent: true, account_id: accountId });
  } catch (err) {
    reportError('/api/connect?action=admin-send-invite', err);
    return res.status(500).json({ error: true, code: 'SERVER_ERROR', message: 'Failed to send Connect invite' });
  }
}
