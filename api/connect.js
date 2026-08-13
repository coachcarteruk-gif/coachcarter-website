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
//
//   POST /api/connect?action=school-create-account  (school admin JWT)
//     → creates Express account for school
//
//   GET  /api/connect?action=school-onboarding-link (school admin JWT)
//     → onboarding link for school's Connect account
//
//   GET  /api/connect?action=school-connect-status  (school admin JWT)
//     → check school account status, update DB if newly complete
//
//   GET  /api/connect?action=school-dashboard-link  (school admin JWT)
//     → Stripe Express dashboard login link for school

const { createPlatformStripeClient, STRIPE_CLIENT_PURPOSES } = require('./_stripe-clients');
const stripe   = createPlatformStripeClient({
  purpose: STRIPE_CLIENT_PURPOSES.CONNECT_V1,
  expectedMode: 'live',
});
const { neon } = require('@neondatabase/serverless');
const jwt      = require('jsonwebtoken');
const { requireAuth, getSchoolId } = require('./_auth');
const { createTransporter } = require('./_auth-helpers');
const { reportError }       = require('./_error-alert');
const { logAudit }          = require('./_audit');
const { createConnectV2Handler } = require('./_connect-v2-routes');
const { createConnectV1InterimHandler } = require('./_connect-v1-interim');

const BASE_URL = process.env.BASE_URL || 'https://coachcarter.uk';
const handleConnectV2 = createConnectV2Handler();
const handleConnectV1Interim = createConnectV1InterimHandler({
  stripe,
  baseUrl: BASE_URL,
  createTransporter,
});

function setCors(res) {
}

// Delegate to shared requireAuth for cookie-first reads.
function verifyInstructorAuth(req) {
  return requireAuth(req, { roles: ['instructor'] });
}

function verifyAdminJWT(req) {
  return requireAuth(req, { roles: ['admin'] });
}

module.exports = async (req, res) => {
  setCors(res);
  const action = req.query.action;
  if (await handleConnectV1Interim(req, res)) return;
  if (await handleConnectV2(req, res)) return;
  if (action === 'create-account')      return handleCreateAccount(req, res);
  if (action === 'onboarding-link')     return handleOnboardingLink(req, res);
  if (action === 'connect-status')      return handleConnectStatus(req, res);
  if (action === 'dashboard-link')      return handleDashboardLink(req, res);
  if (action === 'admin-create-account') return handleAdminCreateAccount(req, res);
  if (action === 'admin-send-invite')    return handleAdminSendInvite(req, res);

  // School-level Stripe Connect
  if (action === 'school-create-account')  return handleSchoolCreateAccount(req, res);
  if (action === 'school-onboarding-link') return handleSchoolOnboardingLink(req, res);
  if (action === 'school-connect-status')  return handleSchoolConnectStatus(req, res);
  if (action === 'school-dashboard-link')  return handleSchoolDashboardLink(req, res);

  return res.status(400).json({ error: true, code: 'UNKNOWN_ACTION', message: 'Unknown action' });
};

// ── Instructor: Create Connect account + onboarding ──
async function handleCreateAccount(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: true, message: 'POST required' });
  const user = verifyInstructorAuth(req);
  if (!user) return res.status(401).json({ error: true, code: 'AUTH_REQUIRED', message: 'Not authenticated' });

  const schoolId = getSchoolId(user, req);
  if (!schoolId) return res.status(403).json({ error: true, code: 'SCHOOL_SCOPE_REQUIRED', message: 'School scope is required' });
  try {
    const sql = neon(process.env.POSTGRES_URL);
    const [instructor] = await sql`
      SELECT i.id, i.email, i.name, i.stripe_account_id, c.id AS interim_v1_control_id
        FROM instructors i
        LEFT JOIN interim_v1_instructor_controls c
          ON c.school_id = i.school_id AND c.instructor_id = i.id
       WHERE i.id = ${user.id} AND i.school_id = ${schoolId}
    `;
    if (!instructor) return res.status(404).json({ error: true, code: 'NOT_FOUND', message: 'Instructor not found' });

    if (instructor.interim_v1_control_id) {
      return res.status(409).json({
        error: true,
        code: 'INTERIM_V1_HARDENED_INVITE_REQUIRED',
        message: 'Use the separately confirmed interim-v1 invitation command',
      });
    }

    let accountId = instructor.stripe_account_id;

    // New account creation must go through the durable admin-prepared interim
    // command. Existing mapped instructors may still request a fresh hosted
    // onboarding link here.
    if (!accountId) {
      return res.status(409).json({
        error: true,
        code: 'INTERIM_V1_PREPARATION_REQUIRED',
        message: 'A school-scoped admin must prepare and reconcile the payout account first',
      });
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
    console.error('create-account error:', err);
    reportError('/api/connect?action=create-account', err);
    return res.status(500).json({ error: true, code: 'SERVER_ERROR', message: 'Failed to create Connect account' });
  }
}

// ── Instructor: Fresh onboarding link (if incomplete) ──
async function handleOnboardingLink(req, res) {
  const user = verifyInstructorAuth(req);
  if (!user) return res.status(401).json({ error: true, code: 'AUTH_REQUIRED', message: 'Not authenticated' });
  const schoolId = getSchoolId(user, req);
  if (!schoolId) return res.status(403).json({ error: true, code: 'SCHOOL_SCOPE_REQUIRED', message: 'School scope is required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const [instructor] = await sql`
      SELECT i.stripe_account_id, c.id AS interim_v1_control_id
        FROM instructors i
        LEFT JOIN interim_v1_instructor_controls c
          ON c.school_id = i.school_id AND c.instructor_id = i.id
       WHERE i.id = ${user.id} AND i.school_id = ${schoolId}
    `;
    if (!instructor?.stripe_account_id) {
      return res.status(400).json({ error: true, code: 'NO_ACCOUNT', message: 'No Connect account found. Create one first.' });
    }
    if (instructor.interim_v1_control_id) {
      return res.status(409).json({
        error: true,
        code: 'INTERIM_V1_OWNER_INVITATION_REQUIRED',
        message: 'Interim v1 onboarding links require the separate owner-controlled invitation route',
      });
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
//
// Returns:
//   has_account          — instructors.stripe_account_id set?
//   onboarding_complete  — DB flag (updated live if Stripe says complete)
//   payouts_paused       — DB flag (admin paused payouts for this instructor)
//   charges_enabled      — Stripe-live: can the account accept payments?
//   payouts_enabled      — Stripe-live: can the account receive payouts?
//   requirements_pending — Stripe-live: count of currently_due items
//
// charges/payouts/requirements fields are present only when has_account=true.
// Banner UI uses them to distinguish "red (no account)" from "amber (account
// exists but Stripe needs more info)" from "green (all set)".
async function handleConnectStatus(req, res) {
  const user = verifyInstructorAuth(req);
  if (!user) return res.status(401).json({ error: true, code: 'AUTH_REQUIRED', message: 'Not authenticated' });
  const schoolId = getSchoolId(user, req);
  if (!schoolId) return res.status(403).json({ error: true, code: 'SCHOOL_SCOPE_REQUIRED', message: 'School scope is required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const [instructor] = await sql`
      SELECT stripe_account_id, stripe_onboarding_complete, payouts_paused
        FROM instructors WHERE id = ${user.id} AND school_id = ${schoolId}
    `;
    if (!instructor) return res.status(404).json({ error: true, code: 'NOT_FOUND', message: 'Instructor not found' });

    const result = {
      ok: true,
      has_account: !!instructor.stripe_account_id,
      onboarding_complete: !!instructor.stripe_onboarding_complete,
      payouts_paused: !!instructor.payouts_paused
    };

    if (instructor.stripe_account_id) {
      const account = await stripe.accounts.retrieve(instructor.stripe_account_id);
      result.charges_enabled = !!account.charges_enabled;
      result.payouts_enabled = !!account.payouts_enabled;
      result.requirements_pending = (account.requirements?.currently_due || []).length;

      if (!instructor.stripe_onboarding_complete && account.charges_enabled && account.payouts_enabled) {
        await sql`UPDATE instructors SET stripe_onboarding_complete = TRUE WHERE id = ${user.id} AND school_id = ${schoolId}`;
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
  const schoolId = getSchoolId(user, req);
  if (!schoolId) return res.status(403).json({ error: true, code: 'SCHOOL_SCOPE_REQUIRED', message: 'School scope is required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const [instructor] = await sql`SELECT stripe_account_id, stripe_onboarding_complete FROM instructors WHERE id = ${user.id} AND school_id = ${schoolId}`;
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
    const adminSchoolId = getSchoolId(admin, req);
    if (!adminSchoolId) return res.status(403).json({ error: true, code: 'SCHOOL_SCOPE_REQUIRED', message: 'School scope is required' });
    const { instructor_id } = req.body || {};
    if (!instructor_id) return res.status(400).json({ error: true, code: 'MISSING_FIELD', message: 'instructor_id required' });

    const sql = neon(process.env.POSTGRES_URL);
    const [instructor] = await sql`SELECT id, email, name, stripe_account_id FROM instructors WHERE id = ${instructor_id} AND school_id = ${adminSchoolId}`;
    if (!instructor) return res.status(404).json({ error: true, code: 'NOT_FOUND', message: 'Instructor not found' });

    let accountId = instructor.stripe_account_id;
    if (!accountId) {
      return res.status(409).json({
        error: true,
        code: 'INTERIM_V1_HARDENED_ROUTE_REQUIRED',
        message: 'Use the durable interim-v1 account command with an explicit payout start date',
      });
    }

    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${BASE_URL}/instructor/earnings.html?connect=refresh`,
      return_url: `${BASE_URL}/instructor/earnings.html?connect=return`,
      type: 'account_onboarding'
    });

    await logAudit(sql, {
      adminId: admin.id, adminEmail: admin.email,
      action: 'connect.admin_create_account',
      targetType: 'instructor', targetId: instructor.id,
      details: { instructor_name: instructor.name, stripe_account_id: accountId },
      schoolId: adminSchoolId, req,
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
    const adminSchoolId = getSchoolId(admin, req);
    if (!adminSchoolId) return res.status(403).json({ error: true, code: 'SCHOOL_SCOPE_REQUIRED', message: 'School scope is required' });
    const { instructor_id } = req.body || {};
    if (!instructor_id) return res.status(400).json({ error: true, code: 'MISSING_FIELD', message: 'instructor_id required' });

    const sql = neon(process.env.POSTGRES_URL);
    const [instructor] = await sql`
      SELECT i.id, i.email, i.name, i.stripe_account_id, i.payouts_start_date,
             i.payouts_paused, c.id AS interim_v1_control_id,
             ci.state AS interim_v1_account_state, ci.provider_account_id
        FROM instructors i
        LEFT JOIN interim_v1_instructor_controls c
          ON c.school_id = i.school_id AND c.instructor_id = i.id
        LEFT JOIN connect_v1_account_creation_intents ci
          ON ci.school_id = c.school_id AND ci.id = c.account_creation_intent_id
       WHERE i.id = ${instructor_id} AND i.school_id = ${adminSchoolId}
    `;
    if (!instructor) return res.status(404).json({ error: true, code: 'NOT_FOUND', message: 'Instructor not found' });

    let accountId = instructor.stripe_account_id;
    if (!accountId) {
      return res.status(409).json({
        error: true,
        code: 'INTERIM_V1_ACCOUNT_PREPARATION_REQUIRED',
        message: 'Create or reconcile the durable account identity before sending an invitation',
      });
    }
    if (instructor.interim_v1_control_id) {
      return res.status(409).json({
        error: true,
        code: 'INTERIM_V1_OWNER_INVITATION_REQUIRED',
        message: 'Interim v1 onboarding links require the separate owner-controlled invitation route',
      });
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

    await logAudit(sql, {
      adminId: admin.id, adminEmail: admin.email,
      action: 'connect.admin_send_invite',
      targetType: 'instructor', targetId: instructor.id,
      details: { instructor_name: instructor.name, instructor_email: instructor.email, stripe_account_id: accountId },
      schoolId: adminSchoolId, req,
    });

    return res.json({ ok: true, email_sent: true, account_id: accountId });
  } catch (err) {
    reportError('/api/connect?action=admin-send-invite', err);
    return res.status(500).json({ error: true, code: 'SERVER_ERROR', message: 'Failed to send Connect invite' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// School-level Stripe Connect
// ══════════════════════════════════════════════════════════════════════════════

// ── School: Create Connect account ──
async function handleSchoolCreateAccount(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: true, message: 'POST required' });
  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: true, code: 'AUTH_REQUIRED', message: 'Admin auth required' });

  const schoolId = getSchoolId(admin, req);
  if (!schoolId) return res.status(403).json({ error: true, code: 'SCHOOL_SCOPE_REQUIRED', message: 'School scope is required' });
  try {
    const sql = neon(process.env.POSTGRES_URL);
    const [school] = await sql`SELECT id, name, stripe_account_id FROM schools WHERE id = ${schoolId}`;
    if (!school) return res.status(404).json({ error: true, code: 'NOT_FOUND', message: 'School not found' });

    if (school.stripe_account_id) {
      return res.status(400).json({ error: true, code: 'ALREADY_EXISTS', message: 'School already has a Stripe Connect account' });
    }

    const account = await stripe.accounts.create({
      type: 'express',
      country: 'GB',
      business_type: 'company',
      metadata: { school_id: String(school.id), platform: 'coachcarter' },
      capabilities: { transfers: { requested: true } }
    });

    await sql`UPDATE schools SET stripe_account_id = ${account.id} WHERE id = ${schoolId}`;

    await logAudit(sql, {
      adminId: admin.id, adminEmail: admin.email,
      action: 'connect.school_create_account',
      targetType: 'school', targetId: schoolId,
      details: { school_name: school.name, stripe_account_id: account.id },
      schoolId, req,
    });

    return res.json({ ok: true, account_id: account.id });
  } catch (err) {
    console.error('school-create-account error:', err);
    reportError('/api/connect?action=school-create-account', err);
    return res.status(500).json({ error: true, code: 'SERVER_ERROR', message: 'Failed to create school Connect account' });
  }
}

// ── School: Onboarding link ──
async function handleSchoolOnboardingLink(req, res) {
  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: true, code: 'AUTH_REQUIRED', message: 'Admin auth required' });

  const schoolId = getSchoolId(admin, req);
  if (!schoolId) return res.status(403).json({ error: true, code: 'SCHOOL_SCOPE_REQUIRED', message: 'School scope is required' });
  try {
    const sql = neon(process.env.POSTGRES_URL);
    const [school] = await sql`SELECT stripe_account_id FROM schools WHERE id = ${schoolId}`;
    if (!school?.stripe_account_id) {
      return res.status(400).json({ error: true, code: 'NO_ACCOUNT', message: 'No Connect account found. Create one first.' });
    }

    const link = await stripe.accountLinks.create({
      account: school.stripe_account_id,
      refresh_url: `${BASE_URL}/admin/portal.html`,
      return_url: `${BASE_URL}/admin/portal.html`,
      type: 'account_onboarding'
    });

    return res.json({ ok: true, url: link.url });
  } catch (err) {
    reportError('/api/connect?action=school-onboarding-link', err);
    return res.status(500).json({ error: true, code: 'SERVER_ERROR', message: 'Failed to generate onboarding link' });
  }
}

// ── School: Check Connect status ──
async function handleSchoolConnectStatus(req, res) {
  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: true, code: 'AUTH_REQUIRED', message: 'Admin auth required' });

  const schoolId = getSchoolId(admin, req);
  if (!schoolId) return res.status(403).json({ error: true, code: 'SCHOOL_SCOPE_REQUIRED', message: 'School scope is required' });
  try {
    const sql = neon(process.env.POSTGRES_URL);
    const [school] = await sql`
      SELECT stripe_account_id, stripe_onboarding_complete
        FROM schools WHERE id = ${schoolId}
    `;
    if (!school) return res.status(404).json({ error: true, code: 'NOT_FOUND', message: 'School not found' });

    const result = {
      ok: true,
      has_account: !!school.stripe_account_id,
      onboarding_complete: !!school.stripe_onboarding_complete
    };

    // If account exists but onboarding not yet marked complete, check with Stripe
    if (school.stripe_account_id && !school.stripe_onboarding_complete) {
      const account = await stripe.accounts.retrieve(school.stripe_account_id);
      result.charges_enabled = account.charges_enabled;
      result.payouts_enabled = account.payouts_enabled;
      if (account.charges_enabled && account.payouts_enabled) {
        await sql`UPDATE schools SET stripe_onboarding_complete = TRUE WHERE id = ${schoolId}`;
        result.onboarding_complete = true;

        // Log the onboarding-complete transition. This is a persistent state
        // change triggered by Stripe (not the admin clicking a button), so
        // record it once when the flag flips. Subsequent calls find
        // stripe_onboarding_complete = TRUE and skip this branch.
        await logAudit(sql, {
          adminId: admin.id, adminEmail: admin.email,
          action: 'connect.school_onboarding_complete',
          targetType: 'school', targetId: schoolId,
          details: { stripe_account_id: school.stripe_account_id },
          schoolId, req,
        });
      }
    }

    return res.json(result);
  } catch (err) {
    reportError('/api/connect?action=school-connect-status', err);
    return res.status(500).json({ error: true, code: 'SERVER_ERROR', message: 'Failed to check school Connect status' });
  }
}

// ── School: Stripe Express dashboard link ──
async function handleSchoolDashboardLink(req, res) {
  const admin = verifyAdminJWT(req);
  if (!admin) return res.status(401).json({ error: true, code: 'AUTH_REQUIRED', message: 'Admin auth required' });

  const schoolId = getSchoolId(admin, req);
  if (!schoolId) return res.status(403).json({ error: true, code: 'SCHOOL_SCOPE_REQUIRED', message: 'School scope is required' });
  try {
    const sql = neon(process.env.POSTGRES_URL);
    const [school] = await sql`SELECT stripe_account_id, stripe_onboarding_complete FROM schools WHERE id = ${schoolId}`;
    if (!school?.stripe_account_id || !school.stripe_onboarding_complete) {
      return res.status(400).json({ error: true, code: 'NOT_ONBOARDED', message: 'Complete school onboarding first' });
    }

    const link = await stripe.accounts.createLoginLink(school.stripe_account_id);
    return res.json({ ok: true, url: link.url });
  } catch (err) {
    reportError('/api/connect?action=school-dashboard-link', err);
    return res.status(500).json({ error: true, code: 'SERVER_ERROR', message: 'Failed to generate dashboard link' });
  }
}
