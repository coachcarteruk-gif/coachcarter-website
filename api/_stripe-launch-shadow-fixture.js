const crypto = require('crypto');
const { safeEqual } = require('./_auth');
const { logAuditRequired } = require('./_audit');
const { withNeonTransaction } = require('./_db-transaction');
const { canonicalJson } = require('./_payout-v2-contracts');

const ACCOUNTING_VERSION = 'simon_launch_v1';
const SHADOW_MODE = 'shadow';
const CONFIRMATION = 'CREATE_STRIPE_LAUNCH_SHADOW_FIXTURE_CONFIRMED';
const AUDIT_ACTION = 'stripe-launch-shadow-fixture.create';
const ADVISORY_LOCK_NAMESPACE = 7512;
const ADVISORY_LOCK_KEY = 1;

class StripeLaunchShadowFixtureError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'StripeLaunchShadowFixtureError';
    this.status = status;
    this.code = code;
  }
}

function refuse(status, code, message) {
  throw new StripeLaunchShadowFixtureError(status, code, message);
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function requireIntegerInRange(value, minimum, maximum, field) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    refuse(400, 'INVALID_FIXTURE_INPUT', `${field} is invalid`);
  }
  return value;
}

function cleanText(value, maximum, field) {
  if (typeof value !== 'string') {
    refuse(400, 'INVALID_FIXTURE_INPUT', `${field} is invalid`);
  }
  const text = value.trim();
  if (!text || text.length > maximum) {
    refuse(400, 'INVALID_FIXTURE_INPUT', `${field} is invalid`);
  }
  return text;
}

function validateStripeLaunchShadowFixtureRequest(body = {}) {
  if (body.operator_go !== CONFIRMATION) {
    refuse(400, 'CONFIRMATION_REQUIRED', 'Explicit shadow fixture confirmation is required');
  }

  const commandId = cleanText(body.command_id, 128, 'command_id').toLowerCase();
  if (!/^[a-z0-9][a-z0-9:_-]{7,127}$/.test(commandId)) {
    refuse(400, 'INVALID_FIXTURE_INPUT', 'command_id is invalid');
  }

  const currency = cleanText(body.currency, 3, 'currency').toLowerCase();
  if (!/^[a-z]{3}$/.test(currency)) {
    refuse(400, 'INVALID_FIXTURE_INPUT', 'currency is invalid');
  }

  return {
    commandId,
    instructorId: requireIntegerInRange(body.instructor_id, 1, Number.MAX_SAFE_INTEGER, 'instructor_id'),
    splitBps: requireIntegerInRange(body.split_bps, 0, 10000, 'split_bps'),
    weeklyFranchiseFeeMinor: requireIntegerInRange(
      body.weekly_franchise_fee_minor,
      0,
      100000000,
      'weekly_franchise_fee_minor'
    ),
    currency,
    documentVersion: cleanText(body.document_version, 160, 'document_version'),
  };
}

function authorizeStripeLaunchShadowFixture({ schoolId, env = process.env } = {}) {
  const scopedSchoolId = positiveInteger(schoolId);
  const configuredSchoolId = positiveInteger(env.STRIPE_LAUNCH_SHADOW_SCHOOL_ID);
  const expectedProjectId = String(env.STRIPE_LAUNCH_SHADOW_PROJECT_ID || '');
  const currentProjectId = String(env.VERCEL_PROJECT_ID || '');
  const expectedVercelEnv = String(env.STRIPE_LAUNCH_SHADOW_VERCEL_ENV || '');
  const currentVercelEnv = String(env.VERCEL_ENV || '');

  if (!scopedSchoolId || scopedSchoolId !== configuredSchoolId) return null;
  if (env.STRIPE_LAUNCH_SHADOW_OPERATIONS_ENABLED !== 'true') return null;
  if (env.STRIPE_MODE !== 'test') return null;
  if (!expectedProjectId || !currentProjectId || !safeEqual(currentProjectId, expectedProjectId)) return null;
  if (!expectedVercelEnv || !currentVercelEnv || !safeEqual(currentVercelEnv, expectedVercelEnv)) return null;

  return { schoolId: scopedSchoolId, projectId: currentProjectId, vercelEnv: currentVercelEnv };
}

function fingerprint(value) {
  return `sha256:${crypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
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

function timestampIso(value) {
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function matchingAgreement(row, input, schoolId, instructorId, adminId, effectiveAt, agreementFingerprint) {
  return Boolean(row)
    && Number(row.school_id) === schoolId
    && Number(row.instructor_id) === instructorId
    && Number(row.version_number) === 1
    && timestampIso(row.starts_at) === effectiveAt
    && row.ends_at == null
    && row.status === 'active'
    && Number(row.split_bps) === input.splitBps
    && Number(row.weekly_franchise_fee_minor) === input.weeklyFranchiseFeeMinor
    && row.currency === input.currency
    && timestampIso(row.accepted_at) === effectiveAt
    && row.acceptance_evidence_reference === `shadow-fixture:${input.commandId}`
    && row.document_version === input.documentVersion
    && row.connect_scope_id == null
    && row.stripe_configuration_id == null
    && Number(row.created_by_admin_id) === adminId
    && Number(row.approved_by_admin_id) === adminId
    && timestampIso(row.created_at) === effectiveAt
    && timestampIso(row.approved_at) === effectiveAt
    && row.agreement_fingerprint === agreementFingerprint;
}

function matchingConfig(row, schoolId, adminId, effectiveAt) {
  return Boolean(row)
    && Number(row.school_id) === schoolId
    && timestampIso(row.cutover_at) === effectiveAt
    && row.accounting_version === ACCOUNTING_VERSION
    && row.mode === SHADOW_MODE
    && Number(row.created_by_admin_id) === adminId
    && timestampIso(row.created_at) === effectiveAt
    && row.activated_at == null
    && row.paused_at == null
    && row.pause_reason == null;
}

function matchingAuditEvidence(audit, config, agreement, input, requestFingerprint, schoolId, adminId) {
  const details = audit?.details;
  const effectiveAt = details?.effective_at;
  const expectedAgreementFingerprint = fingerprint({
    agreement_id: agreement?.id,
    effective_at: effectiveAt,
    request_fingerprint: requestFingerprint,
  });
  const expectedDetails = {
    accounting_version: ACCOUNTING_VERSION,
    agreement_fingerprint: expectedAgreementFingerprint,
    agreement_version_id: agreement?.id,
    command_id: input.commandId,
    currency: input.currency,
    document_version: input.documentVersion,
    effective_at: effectiveAt,
    instructor_id: input.instructorId,
    launch_config_id: config?.id,
    mode: SHADOW_MODE,
    request_fingerprint: requestFingerprint,
    split_bps: input.splitBps,
    weekly_franchise_fee_minor: input.weeklyFranchiseFeeMinor,
  };
  return Boolean(audit && details)
    && Number(audit.admin_id) === adminId
    && Number(audit.target_id) === input.instructorId
    && timestampIso(effectiveAt) === effectiveAt
    && matchingConfig(config, schoolId, adminId, effectiveAt)
    && matchingAgreement(
      agreement,
      input,
      schoolId,
      input.instructorId,
      adminId,
      effectiveAt,
      expectedAgreementFingerprint
    )
    && canonicalJson(details) === canonicalJson(expectedDetails);
}

async function createStripeLaunchShadowFixture({
  schoolId,
  admin,
  req,
  input,
  connectionString,
  runInTransaction,
  now = () => new Date(),
  randomUUID = () => crypto.randomUUID(),
}) {
  const scopedSchoolId = positiveInteger(schoolId);
  const adminId = positiveInteger(admin?.id);
  if (!scopedSchoolId || !adminId) {
    refuse(401, 'UNAUTHORISED', 'Authenticated school admin is required');
  }
  if (!input || typeof input !== 'object') {
    refuse(400, 'INVALID_FIXTURE_INPUT', 'Validated fixture input is required');
  }

  const effectiveAtDate = now();
  if (!(effectiveAtDate instanceof Date) || Number.isNaN(effectiveAtDate.getTime())) {
    throw new TypeError('now must return a valid Date');
  }
  const effectiveAt = effectiveAtDate.toISOString();
  const configId = randomUUID();
  const agreementId = randomUUID();
  const requestFingerprint = fingerprint({
    accounting_version: ACCOUNTING_VERSION,
    command_id: input.commandId,
    currency: input.currency,
    document_version: input.documentVersion,
    instructor_id: input.instructorId,
    mode: SHADOW_MODE,
    school_id: scopedSchoolId,
    split_bps: input.splitBps,
    weekly_franchise_fee_minor: input.weeklyFranchiseFeeMinor,
  });
  const agreementFingerprint = fingerprint({
    agreement_id: agreementId,
    effective_at: effectiveAt,
    request_fingerprint: requestFingerprint,
  });

  const transaction = runInTransaction || ((work) => withNeonTransaction(connectionString, work));
  return transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [ADVISORY_LOCK_NAMESPACE, ADVISORY_LOCK_KEY]);

    const school = await client.query(
      `SELECT id, active
         FROM schools
        WHERE id = $1
        FOR UPDATE`,
      [scopedSchoolId]
    );
    if (school.rowCount !== 1 || school.rows[0].active !== true) {
      refuse(404, 'SHADOW_SCHOOL_NOT_FOUND', 'Target shadow school is missing or inactive');
    }

    const adminRow = await client.query(
      `SELECT id, email, active
         FROM admin_users
        WHERE id = $1
          AND school_id = $2
        FOR UPDATE`,
      [adminId, scopedSchoolId]
    );
    if (adminRow.rowCount !== 1 || adminRow.rows[0].active !== true) {
      refuse(401, 'UNAUTHORISED', 'Authenticated school admin is not active in the target school');
    }

    const instructor = await client.query(
      `SELECT id, active
         FROM instructors
        WHERE id = $1
          AND school_id = $2
        FOR UPDATE`,
      [input.instructorId, scopedSchoolId]
    );
    if (instructor.rowCount !== 1 || instructor.rows[0].active !== true) {
      refuse(404, 'SHADOW_INSTRUCTOR_NOT_FOUND', 'Active same-school instructor was not found');
    }

    const configs = await client.query(
      `SELECT id, school_id, cutover_at, accounting_version, mode, created_by_admin_id,
              created_at, activated_at, paused_at, pause_reason
         FROM stripe_connect_launch_configs
        ORDER BY school_id
        FOR UPDATE`,
      []
    );
    const agreements = await client.query(
      `SELECT id, school_id, instructor_id, version_number, starts_at, ends_at, status,
              split_bps, weekly_franchise_fee_minor, currency, document_version,
              accepted_at, acceptance_evidence_reference, connect_scope_id,
              stripe_configuration_id, created_by_admin_id, approved_by_admin_id,
              created_at, approved_at, agreement_fingerprint
         FROM instructor_payout_agreement_versions
        WHERE school_id = $1
        ORDER BY instructor_id, version_number
        FOR UPDATE`,
      [scopedSchoolId]
    );
    const commandAudits = await client.query(
      `SELECT id, admin_id, target_id, details
         FROM audit_log
        WHERE school_id = $1
          AND action = $2
          AND details->>'command_id' = $3
        ORDER BY id
        FOR UPDATE`,
      [scopedSchoolId, AUDIT_ACTION, input.commandId]
    );

    const schoolConfigs = configs.rows.filter((row) => Number(row.school_id) === scopedSchoolId);
    const otherSchoolConfigs = configs.rows.filter((row) => Number(row.school_id) !== scopedSchoolId);

    if (commandAudits.rowCount > 0) {
      if (
        commandAudits.rowCount !== 1
        || schoolConfigs.length !== 1
        || agreements.rowCount !== 1
        || otherSchoolConfigs.length !== 0
        || !matchingAuditEvidence(
          commandAudits.rows[0],
          schoolConfigs[0],
          agreements.rows[0],
          input,
          requestFingerprint,
          scopedSchoolId,
          adminId
        )
      ) {
        refuse(409, 'SHADOW_FIXTURE_IDEMPOTENCY_CONFLICT', 'Existing fixture evidence does not match this command');
      }
      return {
        ok: true,
        idempotent_replay: true,
        school_id: scopedSchoolId,
        instructor_id: input.instructorId,
        launch_config_id: schoolConfigs[0].id,
        agreement_version_id: agreements.rows[0].id,
        accounting_version: ACCOUNTING_VERSION,
        mode: SHADOW_MODE,
      };
    }

    if (configs.rowCount !== 0 || agreements.rowCount !== 0) {
      refuse(409, 'SHADOW_FIXTURE_STATE_NOT_EMPTY', 'Launch config or agreement state already exists');
    }

    const configInsert = await client.query(
      `INSERT INTO stripe_connect_launch_configs (
         id, school_id, cutover_at, accounting_version, mode,
         created_by_admin_id, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $3)
       RETURNING id, school_id, cutover_at, accounting_version, mode`,
      [configId, scopedSchoolId, effectiveAt, ACCOUNTING_VERSION, SHADOW_MODE, adminId]
    );
    const agreementInsert = await client.query(
      `INSERT INTO instructor_payout_agreement_versions (
         id, school_id, instructor_id, version_number, starts_at, ends_at,
         status, split_bps, weekly_franchise_fee_minor, currency,
         accepted_at, acceptance_evidence_reference, document_version,
         connect_scope_id, stripe_configuration_id, created_by_admin_id,
         approved_by_admin_id, created_at, approved_at, agreement_fingerprint
       ) VALUES (
         $1, $2, $3, 1, $4, NULL,
         'active', $5, $6, $7,
         $4, $8, $9,
         NULL, NULL, $10,
         $10, $4, $4, $11
       )
       RETURNING id, school_id, instructor_id, starts_at, status,
                 split_bps, weekly_franchise_fee_minor, currency, document_version`,
      [
        agreementId,
        scopedSchoolId,
        input.instructorId,
        effectiveAt,
        input.splitBps,
        input.weeklyFranchiseFeeMinor,
        input.currency,
        `shadow-fixture:${input.commandId}`,
        input.documentVersion,
        adminId,
        agreementFingerprint,
      ]
    );

    if (configInsert.rowCount !== 1 || agreementInsert.rowCount !== 1) {
      throw new Error('Shadow fixture inserts did not return exactly one row each');
    }

    await logAuditRequired(clientSqlTag(client), {
      adminId,
      adminEmail: adminRow.rows[0].email,
      action: AUDIT_ACTION,
      targetType: 'stripe_launch_shadow_fixture',
      targetId: input.instructorId,
      details: {
        accounting_version: ACCOUNTING_VERSION,
        agreement_fingerprint: agreementFingerprint,
        agreement_version_id: agreementId,
        command_id: input.commandId,
        currency: input.currency,
        document_version: input.documentVersion,
        effective_at: effectiveAt,
        instructor_id: input.instructorId,
        launch_config_id: configId,
        mode: SHADOW_MODE,
        request_fingerprint: requestFingerprint,
        split_bps: input.splitBps,
        weekly_franchise_fee_minor: input.weeklyFranchiseFeeMinor,
      },
      schoolId: scopedSchoolId,
      req,
    });

    return {
      ok: true,
      idempotent_replay: false,
      school_id: scopedSchoolId,
      instructor_id: input.instructorId,
      launch_config_id: configId,
      agreement_version_id: agreementId,
      accounting_version: ACCOUNTING_VERSION,
      mode: SHADOW_MODE,
    };
  });
}

module.exports = {
  ACCOUNTING_VERSION,
  SHADOW_MODE,
  CONFIRMATION,
  AUDIT_ACTION,
  StripeLaunchShadowFixtureError,
  validateStripeLaunchShadowFixtureRequest,
  authorizeStripeLaunchShadowFixture,
  createStripeLaunchShadowFixture,
  clientSqlTag,
};
