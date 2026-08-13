'use strict';

const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');
const { requireAuth, getSchoolId } = require('./_auth');
const { logAuditRequired } = require('./_audit');
const { withNeonTransaction } = require('./_db-transaction');
const { classifyStripeError, getStripeClientMetadata } = require('./_stripe-clients');

const ACTIONS = new Set([
  'interim-v1-account',
  'interim-v1-invite',
  'interim-v1-status',
]);

const CREATE_CONFIRMATION = 'CREATE_INTERIM_V1_ACCOUNT_CONFIRMED';
const INVITE_CONFIRMATION = 'SEND_INTERIM_V1_INVITE_CONFIRMED';
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RECONCILIATION_PAGES = 100;

class ConnectV1InterimError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ConnectV1InterimError';
    this.status = status;
    this.code = code;
  }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value) {
  return `sha256:${crypto.createHash('sha256').update(stableJson(value)).digest('hex')}`;
}

function makeStableIdentity({ schoolId, instructorId }) {
  return `cc:connect-v1:${Number(schoolId)}:${Number(instructorId)}:live:express`;
}

function isOwnerAssistedSession({ owner, instructor, schoolId }) {
  if (!owner || owner.role !== 'superadmin') return false;
  if (!instructor || instructor.role !== 'instructor' || instructor.impersonation !== true) return false;

  const ownerId = Number(owner.id);
  const impersonatingAdminId = Number(instructor.impersonated_by_admin_id);
  const instructorSchoolId = Number(instructor.school_id);
  if (!Number.isSafeInteger(ownerId) || ownerId <= 0 || impersonatingAdminId !== ownerId) return false;
  if (!Number.isSafeInteger(instructorSchoolId) || instructorSchoolId !== Number(schoolId)) return false;

  const ownerEmail = String(owner.email || '').trim().toLowerCase();
  const impersonatingAdminEmail = String(instructor.impersonated_by_admin_email || '').trim().toLowerCase();
  return ownerEmail.length > 0 && impersonatingAdminEmail === ownerEmail;
}

function makeCreationCommand({ schoolId, instructorId, payoutsStartDate, intentId }) {
  const stableIdentity = makeStableIdentity({ schoolId, instructorId });
  const requestFacts = {
    schema: 'interim-v1-connect/1',
    school_id: Number(schoolId),
    instructor_id: Number(instructorId),
    payouts_start_date: payoutsStartDate,
    stripe_mode: 'live',
    account_type: 'express',
  };
  return Object.freeze({
    stableIdentity,
    idempotencyKey: `cc-connect-v1-${intentId}`,
    requestFingerprint: fingerprint(requestFacts),
    requestFacts,
  });
}

function buildAccountCreateParams({ schoolId, instructor, intent }) {
  return {
    type: 'express',
    country: 'GB',
    email: instructor.email,
    capabilities: { transfers: { requested: true } },
    business_type: 'individual',
    metadata: {
      platform: 'coachcarter',
      cc_schema: 'interim-v1-connect/1',
      cc_connect_v1_intent_id: String(intent.id),
      cc_stable_identity: intent.stable_identity,
      cc_school_id: String(Number(schoolId)),
      cc_instructor_id: String(Number(instructor.id)),
    },
  };
}

function validateIsoDate(value) {
  const text = String(value || '').trim();
  if (!ISO_DATE_RE.test(text)) return null;
  const parsed = new Date(`${text}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text
    ? null
    : text;
}

function normalizeDateOnly(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value || '').slice(0, 10);
}

function validateProviderAccount(account, {
  schoolId, instructorId, intentId, stableIdentity, providerMode,
}) {
  if (!account || !/^acct_[A-Za-z0-9]+$/.test(account.id || '')) {
    throw new ConnectV1InterimError(502, 'INTERIM_V1_PROVIDER_CONTRACT_INVALID', 'Stripe returned an invalid account response');
  }
  // Stripe v1 Account objects do not expose a `livemode` property. Prove the
  // mode at the authenticated client boundary instead of treating an absent
  // response field as test-mode evidence.
  if (providerMode !== 'live') {
    throw new ConnectV1InterimError(409, 'INTERIM_V1_TEST_ACCOUNT_REFUSED', 'A test-mode account cannot be used for the interim Production path');
  }
  const metadata = account.metadata || {};
  if (
    metadata.cc_connect_v1_intent_id !== String(intentId)
    || metadata.cc_stable_identity !== stableIdentity
    || metadata.cc_school_id !== String(Number(schoolId))
    || metadata.cc_instructor_id !== String(Number(instructorId))
  ) {
    throw new ConnectV1InterimError(409, 'INTERIM_V1_PROVIDER_IDENTITY_MISMATCH', 'Stripe account ownership evidence does not match');
  }
  return account;
}

async function findReconciliationMatches(stripe, { stableIdentity }) {
  const matches = [];
  let startingAfter;
  for (let page = 0; page < MAX_RECONCILIATION_PAGES; page += 1) {
    const params = { limit: 100 };
    if (startingAfter) params.starting_after = startingAfter;
    const response = await stripe.accounts.list(params);
    if (!response || !Array.isArray(response.data) || typeof response.has_more !== 'boolean') {
      throw new ConnectV1InterimError(502, 'INTERIM_V1_RECONCILIATION_INVALID', 'Stripe account reconciliation returned an invalid response');
    }
    for (const account of response.data) {
      if (account?.metadata?.cc_stable_identity === stableIdentity) matches.push(account);
    }
    if (!response.has_more) return matches;
    const lastId = response.data[response.data.length - 1]?.id;
    if (!lastId || lastId === startingAfter) {
      throw new ConnectV1InterimError(409, 'INTERIM_V1_RECONCILIATION_INCOMPLETE', 'Stripe account reconciliation could not advance safely');
    }
    startingAfter = lastId;
  }
  throw new ConnectV1InterimError(409, 'INTERIM_V1_RECONCILIATION_INCOMPLETE', 'Stripe account reconciliation exceeded its safe bound');
}

function clientSqlTag(client) {
  return async (strings, ...values) => {
    let text = '';
    for (let index = 0; index < strings.length; index += 1) {
      text += strings[index];
      if (index < values.length) text += `$${index + 1}`;
    }
    const result = await client.query(text, values);
    return result.rows || [];
  };
}

function auditEntry(req, admin, schoolId, action, instructorId, details) {
  return {
    adminId: admin.id,
    adminEmail: admin.email,
    action,
    targetType: 'instructor',
    targetId: instructorId,
    details,
    schoolId,
    req,
  };
}

async function recordAttempt(sql, {
  schoolId, instructorId, intentId, outcome, providerAccountId = null,
  providerRequestId = null, errorClass = null, evidence = {},
}) {
  return sql`
    INSERT INTO connect_v1_account_creation_attempts (
      id, school_id, instructor_id, intent_id, attempt_number, outcome,
      provider_account_id, provider_request_id, error_class, evidence_json, occurred_at
    ) SELECT
      ${crypto.randomUUID()}, ${schoolId}, ${instructorId}, ${intentId},
      COALESCE(MAX(attempt_number), 0) + 1, ${outcome},
      ${providerAccountId}, ${providerRequestId}, ${errorClass}, ${JSON.stringify(evidence)}, NOW()
      FROM connect_v1_account_creation_attempts
     WHERE school_id = ${schoolId} AND intent_id = ${intentId}
    RETURNING id
  `;
}

async function finalizeMappedAccount({ transactionRunner, req, admin, schoolId, instructor, intent, account, outcome }) {
  return transactionRunner(async (sql) => {
    const [locked] = await sql`
      SELECT id, stripe_account_id
        FROM instructors
       WHERE id = ${instructor.id} AND school_id = ${schoolId}
       FOR UPDATE
    `;
    if (!locked) throw new ConnectV1InterimError(404, 'NOT_FOUND', 'Instructor not found');
    if (locked.stripe_account_id && locked.stripe_account_id !== account.id) {
      throw new ConnectV1InterimError(409, 'INTERIM_V1_ACCOUNT_MAPPING_CONFLICT', 'Instructor already has a different Connect account');
    }
    await sql`
      UPDATE instructors
         SET stripe_account_id = COALESCE(stripe_account_id, ${account.id}),
             payouts_start_date = ${intent.payouts_start_date},
             payouts_paused = TRUE
       WHERE id = ${instructor.id} AND school_id = ${schoolId}
    `;
    await sql`
      UPDATE connect_v1_account_creation_intents
         SET state = 'succeeded', provider_account_id = COALESCE(provider_account_id, ${account.id}),
             last_error_class = NULL, updated_at = NOW()
       WHERE id = ${intent.id} AND school_id = ${schoolId}
         AND state = ANY(${['submitting', 'reconciling']}::text[])
    `;
    await recordAttempt(sql, {
      schoolId,
      instructorId: instructor.id,
      intentId: intent.id,
      outcome,
      providerAccountId: account.id,
      evidence: { livemode: true, stable_identity: intent.stable_identity },
    });
    await logAuditRequired(sql, auditEntry(req, admin, schoolId, 'connect.interim_v1_account_mapped', instructor.id, {
      account_creation_intent_id: intent.id,
      stripe_account_id: account.id,
      payouts_start_date: intent.payouts_start_date,
      payouts_paused: true,
      reconciliation_outcome: outcome,
    }));
    return account.id;
  });
}

function createConnectV1InterimHandler({
  stripe,
  baseUrl,
  createTransporter,
  connectionString = process.env.POSTGRES_URL,
  sql = connectionString ? neon(connectionString) : null,
  transactionRunner,
} = {}) {
  const runTransaction = transactionRunner || ((work) => withNeonTransaction(connectionString, async (client) => work(clientSqlTag(client))));
  const providerMode = getStripeClientMetadata(stripe)?.mode || null;

  return async function handleConnectV1Interim(req, res) {
    const action = req.query?.action;
    if (!ACTIONS.has(action)) return false;
    const admin = requireAuth(req, { roles: ['superadmin'] });
    if (!admin) {
      res.status(401).json({ error: true, code: 'SUPERADMIN_REQUIRED', message: 'Platform owner authorization is required' });
      return true;
    }
    const schoolId = getSchoolId(admin, req);
    const instructorId = Number(req.body?.instructor_id || req.query?.instructor_id);
    if (!Number.isSafeInteger(schoolId) || schoolId <= 0 || !Number.isSafeInteger(instructorId) || instructorId <= 0) {
      res.status(400).json({ error: true, code: 'INVALID_SCOPE', message: 'A valid school and instructor are required' });
      return true;
    }

    try {
      if (action === 'interim-v1-status') {
        if (req.method !== 'GET') throw new ConnectV1InterimError(405, 'METHOD_NOT_ALLOWED', 'GET required');
        const [row] = await sql`
          SELECT i.id, i.name, i.stripe_account_id, i.stripe_onboarding_complete,
                 i.payouts_paused, i.payouts_start_date, c.id AS control_id,
                 c.funding_policy, ci.id AS intent_id, ci.state AS account_state,
                 ci.provider_account_id
            FROM instructors i
            LEFT JOIN interim_v1_instructor_controls c
              ON c.school_id = i.school_id AND c.instructor_id = i.id
            LEFT JOIN connect_v1_account_creation_intents ci
              ON ci.school_id = c.school_id AND ci.id = c.account_creation_intent_id
           WHERE i.id = ${instructorId} AND i.school_id = ${schoolId}
           LIMIT 1
        `;
        if (!row) throw new ConnectV1InterimError(404, 'NOT_FOUND', 'Instructor not found');
        res.json({ ok: true, interim_v1: row });
        return true;
      }

      if (req.method !== 'POST') throw new ConnectV1InterimError(405, 'METHOD_NOT_ALLOWED', 'POST required');

      if (action === 'interim-v1-account') {
        if (req.body?.operator_go !== CREATE_CONFIRMATION) {
          throw new ConnectV1InterimError(400, 'OPERATOR_CONFIRMATION_REQUIRED', `operator_go must equal ${CREATE_CONFIRMATION}`);
        }
        const payoutsStartDate = validateIsoDate(req.body?.payouts_start_date);
        if (!payoutsStartDate) throw new ConnectV1InterimError(400, 'INVALID_START_DATE', 'payouts_start_date must be a real YYYY-MM-DD date');

        const prepared = await runTransaction(async (txSql) => {
          const [instructor] = await txSql`
            SELECT id, school_id, name, email, stripe_account_id, payouts_start_date
              FROM instructors
             WHERE id = ${instructorId} AND school_id = ${schoolId} AND active = TRUE
             FOR UPDATE
          `;
          if (!instructor) throw new ConnectV1InterimError(404, 'NOT_FOUND', 'Instructor not found');
          const [existingIntent] = await txSql`
            SELECT * FROM connect_v1_account_creation_intents
             WHERE school_id = ${schoolId} AND instructor_id = ${instructorId}
             LIMIT 1
          `;
          const intentId = existingIntent?.id || crypto.randomUUID();
          const command = makeCreationCommand({ schoolId, instructorId, payoutsStartDate, intentId });
          if (existingIntent && (
            normalizeDateOnly(existingIntent.payouts_start_date) !== payoutsStartDate
            || existingIntent.stable_identity !== command.stableIdentity
            || existingIntent.idempotency_key !== command.idempotencyKey
            || existingIntent.request_fingerprint !== command.requestFingerprint
          )) {
            throw new ConnectV1InterimError(409, 'INTERIM_V1_INTENT_CONFLICT', 'Existing account identity uses different immutable start evidence');
          }
          let intent = existingIntent;
          if (!intent) {
            [intent] = await txSql`
              INSERT INTO connect_v1_account_creation_intents (
                id, school_id, instructor_id, payouts_start_date, stable_identity,
                idempotency_key, request_fingerprint, state, created_by_admin_id
              ) VALUES (
                ${intentId}, ${schoolId}, ${instructorId}, ${payoutsStartDate}, ${command.stableIdentity},
                ${command.idempotencyKey}, ${command.requestFingerprint}, 'planned', ${admin.id}
              ) RETURNING *
            `;
            await txSql`
              INSERT INTO interim_v1_instructor_controls (
                id, school_id, instructor_id, account_creation_intent_id,
                payouts_start_date, funding_policy, created_by_admin_id
              ) VALUES (
                ${crypto.randomUUID()}, ${schoolId}, ${instructorId}, ${intentId},
                ${payoutsStartDate}, 'exact_direct_slot_stripe', ${admin.id}
              )
            `;
            await logAuditRequired(txSql, auditEntry(req, admin, schoolId, 'connect.interim_v1_start_pause_prepared', instructorId, {
              account_creation_intent_id: intentId,
              payouts_start_date: payoutsStartDate,
              payouts_paused: true,
              funding_policy: 'exact_direct_slot_stripe',
            }));
          }
          await txSql`
            UPDATE instructors
               SET payouts_start_date = ${payoutsStartDate}, payouts_paused = TRUE
             WHERE id = ${instructorId} AND school_id = ${schoolId}
          `;
          return { instructor, intent };
        });

        const { instructor, intent } = prepared;
        if (instructor.stripe_account_id) {
          if (intent.state !== 'succeeded' || intent.provider_account_id !== instructor.stripe_account_id) {
            throw new ConnectV1InterimError(409, 'INTERIM_V1_ACCOUNT_MAPPING_CONFLICT', 'Stored account identities disagree');
          }
          res.json({ ok: true, state: 'existing', account_id: instructor.stripe_account_id, payouts_start_date: payoutsStartDate, payouts_paused: true });
          return true;
        }
        if (intent.state === 'succeeded') {
          res.json({ ok: true, state: 'existing', account_id: intent.provider_account_id, payouts_start_date: payoutsStartDate, payouts_paused: true });
          return true;
        }
        if (['submitting', 'reconciling'].includes(intent.state)) {
          const matches = await findReconciliationMatches(stripe, { stableIdentity: intent.stable_identity });
          if (matches.length === 1) {
            const account = validateProviderAccount(matches[0], {
              schoolId, instructorId, intentId: intent.id, stableIdentity: intent.stable_identity,
              providerMode,
            });
            const accountId = await finalizeMappedAccount({
              transactionRunner: runTransaction, req, admin, schoolId, instructor, intent, account,
              outcome: 'reconciled_existing',
            });
            res.json({ ok: true, state: 'reconciled', account_id: accountId, payouts_start_date: payoutsStartDate, payouts_paused: true });
            return true;
          }
          await runTransaction(async (txSql) => {
            await recordAttempt(txSql, {
              schoolId, instructorId, intentId: intent.id,
              outcome: matches.length === 0 ? 'reconcile_no_match' : 'reconcile_multiple_matches',
              evidence: { match_count: matches.length },
            });
            if (matches.length > 1) {
              await txSql`
                UPDATE connect_v1_account_creation_intents
                   SET state = 'manual_review', updated_at = NOW()
                 WHERE id = ${intent.id} AND school_id = ${schoolId} AND state = 'reconciling'
              `;
            }
          });
          res.status(202).json({
            ok: false,
            code: matches.length === 0 ? 'INTERIM_V1_RECONCILING' : 'INTERIM_V1_MANUAL_REVIEW',
            message: 'The original account identity requires reconciliation; no replacement account was created',
            state: matches.length === 0 ? 'reconciling' : 'manual_review',
          });
          return true;
        }
        if (intent.state !== 'planned') {
          throw new ConnectV1InterimError(409, 'INTERIM_V1_MANUAL_REVIEW', 'Account identity requires operator review');
        }

        await runTransaction(async (txSql) => {
          const rows = await txSql`
            UPDATE connect_v1_account_creation_intents
               SET state = 'submitting', updated_at = NOW()
             WHERE id = ${intent.id} AND school_id = ${schoolId} AND state = 'planned'
             RETURNING id
          `;
          if (!rows[0]) throw new ConnectV1InterimError(409, 'INTERIM_V1_INTENT_BUSY', 'Account identity is already being processed');
          await logAuditRequired(txSql, auditEntry(req, admin, schoolId, 'connect.interim_v1_account_create_requested', instructorId, {
            account_creation_intent_id: intent.id,
            request_fingerprint: intent.request_fingerprint,
            stable_identity: intent.stable_identity,
          }));
        });

        let account;
        try {
          account = await stripe.accounts.create(
            buildAccountCreateParams({ schoolId, instructor, intent }),
            { idempotencyKey: intent.idempotency_key }
          );
          validateProviderAccount(account, {
            schoolId, instructorId, intentId: intent.id, stableIdentity: intent.stable_identity,
            providerMode,
          });
        } catch (error) {
          const classification = classifyStripeError(error);
          const ambiguous = error instanceof ConnectV1InterimError || classification.retryable === true;
          await runTransaction(async (txSql) => {
            await recordAttempt(txSql, {
              schoolId, instructorId, intentId: intent.id,
              outcome: ambiguous ? 'provider_ambiguous' : 'provider_failed_confirmed',
              providerRequestId: classification.requestId,
              errorClass: classification.category,
              evidence: { retryable: classification.retryable, provider_code: classification.code || null },
            });
            await txSql`
              UPDATE connect_v1_account_creation_intents
                 SET state = ${ambiguous ? 'reconciling' : 'failed_confirmed'},
                     last_error_class = ${classification.category}, updated_at = NOW()
               WHERE id = ${intent.id} AND school_id = ${schoolId} AND state = 'submitting'
            `;
            await logAuditRequired(txSql, auditEntry(req, admin, schoolId,
              ambiguous ? 'connect.interim_v1_account_ambiguous' : 'connect.interim_v1_account_failed_confirmed',
              instructorId,
              { account_creation_intent_id: intent.id, error_class: classification.category }
            ));
          });
          res.status(ambiguous ? 202 : 502).json({
            error: true,
            code: ambiguous ? 'INTERIM_V1_RECONCILING' : 'INTERIM_V1_PROVIDER_REJECTED',
            message: ambiguous
              ? 'Account creation outcome is uncertain and will be reconciled without creating a replacement'
              : 'Stripe rejected account creation before a usable account was recorded',
          });
          return true;
        }

        const accountId = await finalizeMappedAccount({
          transactionRunner: runTransaction, req, admin, schoolId, instructor, intent, account,
          outcome: 'provider_succeeded',
        });
        res.status(201).json({ ok: true, state: 'created', account_id: accountId, payouts_start_date: payoutsStartDate, payouts_paused: true });
        return true;
      }

      if (req.body?.operator_go !== INVITE_CONFIRMATION) {
        throw new ConnectV1InterimError(400, 'OPERATOR_CONFIRMATION_REQUIRED', `operator_go must equal ${INVITE_CONFIRMATION}`);
      }
      const [instructor] = await sql`
        SELECT i.id, i.name, i.email, i.stripe_account_id, i.payouts_start_date,
               i.payouts_paused, c.id AS control_id, ci.state AS account_state,
               ci.provider_account_id
          FROM instructors i
          JOIN interim_v1_instructor_controls c
            ON c.school_id = i.school_id AND c.instructor_id = i.id
          JOIN connect_v1_account_creation_intents ci
            ON ci.school_id = c.school_id AND ci.id = c.account_creation_intent_id
         WHERE i.id = ${instructorId} AND i.school_id = ${schoolId}
         LIMIT 1
      `;
      if (!instructor) throw new ConnectV1InterimError(409, 'INTERIM_V1_PREPARATION_REQUIRED', 'Prepare and reconcile the hardened account before invitation');
      if (!instructor.stripe_account_id || instructor.account_state !== 'succeeded' || instructor.provider_account_id !== instructor.stripe_account_id) {
        throw new ConnectV1InterimError(409, 'INTERIM_V1_ACCOUNT_NOT_READY', 'The durable account identity is not reconciled');
      }
      if (!instructor.payouts_start_date || instructor.payouts_paused !== true) {
        throw new ConnectV1InterimError(409, 'INTERIM_V1_SAFEGUARD_MISSING', 'Start-date and paused safeguards must be intact');
      }
      const link = await stripe.accountLinks.create({
        account: instructor.stripe_account_id,
        refresh_url: `${baseUrl}/instructor/earnings.html?connect=refresh`,
        return_url: `${baseUrl}/instructor/earnings.html?connect=return`,
        type: 'account_onboarding',
      });
      const transporter = createTransporter();
      await transporter.sendMail({
        from: process.env.SMTP_USER,
        to: instructor.email,
        subject: 'Set Up Your CoachCarter Payouts',
        html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;"><h2>Set Up Direct Payouts</h2><p>Hi ${String(instructor.name || '').replace(/[<>&"]/g, '')},</p><p>Use Stripe's secure hosted onboarding to provide your payout details.</p><p><a href="${link.url}">Continue to Stripe onboarding</a></p><p>This invitation does not activate automatic payouts. CoachCarter will review each initial payout separately.</p></div>`,
      });
      await logAuditRequired(sql, auditEntry(req, admin, schoolId, 'connect.interim_v1_invite_sent', instructorId, {
        stripe_account_id: instructor.stripe_account_id,
        payouts_start_date: instructor.payouts_start_date,
        payouts_paused: true,
      }));
      res.json({ ok: true, email_sent: true, payouts_paused: true });
      return true;
    } catch (error) {
      const status = error instanceof ConnectV1InterimError ? error.status : 500;
      const code = error instanceof ConnectV1InterimError ? error.code : 'SERVER_ERROR';
      const message = error instanceof ConnectV1InterimError ? error.message : 'Interim v1 Connect operation failed';
      res.status(status).json({ error: true, code, message });
      return true;
    }
  };
}

module.exports = {
  ACTIONS,
  CREATE_CONFIRMATION,
  INVITE_CONFIRMATION,
  ConnectV1InterimError,
  buildAccountCreateParams,
  createConnectV1InterimHandler,
  findReconciliationMatches,
  fingerprint,
  isOwnerAssistedSession,
  makeCreationCommand,
  makeStableIdentity,
  stableJson,
  validateIsoDate,
  validateProviderAccount,
};
