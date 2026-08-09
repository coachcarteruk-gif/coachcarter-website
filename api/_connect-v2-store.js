'use strict';

const crypto = require('crypto');
const { fingerprint, makeStableIdentity } = require('./_connect-v2');

function one(rows) {
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function loadSchoolAndInstructor(sql, { schoolId, instructorId }) {
  return one(await sql`
    SELECT i.id, i.school_id, i.email, i.name, s.config
      FROM instructors i
      JOIN schools s ON s.id = i.school_id
     WHERE i.id = ${instructorId}
       AND i.school_id = ${schoolId}
       AND COALESCE(i.active, TRUE) = TRUE
     LIMIT 1
  `);
}

async function loadSchoolConfig(sql, schoolId) {
  return one(await sql`SELECT id, config FROM schools WHERE id = ${schoolId} LIMIT 1`);
}

async function listSchoolInstructors(sql, schoolId) {
  return sql`
    SELECT id, school_id, name, active
      FROM instructors
     WHERE school_id = ${schoolId}
     ORDER BY active DESC, name ASC, id ASC
  `;
}

async function loadInstructorScope(sql, { schoolId, instructorId }) {
  const rows = await sql`
    SELECT id, school_id, owner_type, instructor_id, stripe_account_id, evidence_json, created_at
      FROM payout_v2_connected_account_scopes
     WHERE school_id = ${schoolId}
       AND owner_type = 'instructor'
       AND instructor_id = ${instructorId}
     ORDER BY id ASC
     LIMIT 2
  `;
  if (rows.length > 1) throw new Error('CONNECT_V2_MULTIPLE_ACCOUNT_SCOPES');
  return one(rows);
}

async function loadCreationIntent(sql, { schoolId, instructorId, mode }) {
  return one(await sql`
    SELECT * FROM connect_v2_account_creation_intents
     WHERE school_id = ${schoolId} AND instructor_id = ${instructorId}
       AND stripe_mode = ${mode} AND configuration_type = 'recipient'
     LIMIT 1
  `);
}

async function loadScopeByAccount(sql, accountId) {
  return one(await sql`
    SELECT id, school_id, owner_type, instructor_id, stripe_account_id, evidence_json, created_at
      FROM payout_v2_connected_account_scopes
     WHERE stripe_account_id = ${accountId}
     LIMIT 1
  `);
}

async function ensureCreationIntent(sql, command) {
  const now = new Date().toISOString();
  await sql`
    INSERT INTO connect_v2_account_creation_intents (
      id, school_id, instructor_id, stripe_mode, configuration_type,
      dashboard_type, stable_identity, idempotency_key, request_fingerprint,
      state, created_by_user_id, created_at, updated_at
    ) VALUES (
      ${command.intentId}, ${command.schoolId}, ${command.instructorId}, ${command.mode}, 'recipient',
      'express', ${command.stableIdentity}, ${command.idempotencyKey}, ${command.requestFingerprint},
      'planned', ${command.actorId}, ${now}, ${now}
    ) ON CONFLICT (school_id, instructor_id, stripe_mode, configuration_type) DO NOTHING
  `;
  return one(await sql`
    SELECT * FROM connect_v2_account_creation_intents
     WHERE school_id = ${command.schoolId}
       AND instructor_id = ${command.instructorId}
       AND stripe_mode = ${command.mode}
       AND configuration_type = 'recipient'
     LIMIT 1
  `);
}

async function claimCreationIntent(sql, { schoolId, instructorId, intentId }) {
  return one(await sql`
    UPDATE connect_v2_account_creation_intents
       SET state = 'submitting', updated_at = NOW()
     WHERE id = ${intentId}
       AND school_id = ${schoolId}
       AND instructor_id = ${instructorId}
       AND state = 'planned'
     RETURNING *
  `);
}

async function setCreationIntentState(sql, {
  schoolId, instructorId, intentId, state, providerAccountId = null,
  connectScopeId = null, errorClass = null, expectedStates,
}) {
  return one(await sql`
    UPDATE connect_v2_account_creation_intents
       SET state = ${state},
           provider_account_id = COALESCE(provider_account_id, ${providerAccountId}),
           connect_scope_id = COALESCE(connect_scope_id, ${connectScopeId}),
           last_error_class = ${errorClass},
           updated_at = NOW()
     WHERE id = ${intentId}
       AND school_id = ${schoolId}
       AND instructor_id = ${instructorId}
       AND state = ANY(${expectedStates}::text[])
     RETURNING *
  `);
}

async function recordCreationAttempt(sql, {
  schoolId, instructorId, intentId, outcome, providerAccountId = null,
  providerRequestId = null, errorClass = null, evidence = {},
}) {
  const id = crypto.randomUUID();
  return one(await sql`
    INSERT INTO connect_v2_account_creation_attempts (
      id, school_id, instructor_id, intent_id, attempt_number, outcome,
      provider_account_id, provider_request_id, error_class, evidence_json, occurred_at
    ) SELECT
      ${id}, ${schoolId}, ${instructorId}, ${intentId},
      COALESCE(MAX(attempt_number), 0) + 1, ${outcome},
      ${providerAccountId}, ${providerRequestId}, ${errorClass}, ${JSON.stringify(evidence)}, NOW()
      FROM connect_v2_account_creation_attempts
     WHERE school_id = ${schoolId} AND intent_id = ${intentId}
    RETURNING *
  `);
}

async function registerAccountScope(sql, { schoolId, instructorId, accountId, mode, intentId }) {
  const evidence = {
    schema: 'connect-v2-readiness/1', configuration_type: 'recipient',
    dashboard_type: 'express', stripe_mode: mode, event_context: 'platform',
    creation_intent_id: intentId,
    stable_identity: makeStableIdentity({ schoolId, instructorId, mode }),
  };
  const inserted = one(await sql`
    INSERT INTO payout_v2_connected_account_scopes (
      school_id, stripe_account_id, owner_type, instructor_id, destination_school_id, evidence_json
    ) VALUES (${schoolId}, ${accountId}, 'instructor', ${instructorId}, NULL, ${JSON.stringify(evidence)})
    ON CONFLICT (stripe_account_id) DO NOTHING
    RETURNING *
  `);
  const scope = inserted || await loadScopeByAccount(sql, accountId);
  if (!scope || Number(scope.school_id) !== Number(schoolId) || Number(scope.instructor_id) !== Number(instructorId) || scope.owner_type !== 'instructor') {
    throw new Error('CONNECT_V2_ACCOUNT_SCOPE_CONFLICT');
  }
  return scope;
}

async function loadObservations(sql, { schoolId, instructorId, limit = 10 }) {
  return sql`
    SELECT * FROM connect_account_state_events
     WHERE school_id = ${schoolId} AND instructor_id = ${instructorId}
     ORDER BY observed_at DESC, created_at DESC, id DESC
     LIMIT ${limit}
  `;
}

async function loadCurrentAgreement(sql, { schoolId, instructorId }) {
  return one(await sql`
    SELECT * FROM instructor_payout_agreement_versions
     WHERE school_id = ${schoolId} AND instructor_id = ${instructorId}
     ORDER BY CASE
       WHEN status = 'active' AND starts_at <= NOW() AND (ends_at IS NULL OR ends_at > NOW()) THEN 0
       WHEN status = 'draft' THEN 1
       WHEN status = 'paused' AND starts_at <= NOW() AND (ends_at IS NULL OR ends_at > NOW()) THEN 2
       ELSE 3
     END, version_number DESC
     LIMIT 1
  `);
}

async function loadAgreementVersions(sql, { schoolId, instructorId }) {
  return sql`
    SELECT id, school_id, instructor_id, version_number, starts_at, ends_at,
           status, split_bps, weekly_franchise_fee_minor, currency,
           accepted_at, acceptance_evidence_reference, document_version,
           connect_scope_id, stripe_configuration_id, created_at, approved_at,
           agreement_fingerprint
      FROM instructor_payout_agreement_versions
     WHERE school_id = ${schoolId} AND instructor_id = ${instructorId}
     ORDER BY version_number DESC
  `;
}

async function insertObservation(sql, observation) {
  const evidence = {
    schema: observation.schema,
    livemode: observation.livemode,
    applied_configurations: observation.applied_configurations,
    recipient_applied: observation.recipient_applied,
    identity_country: observation.identity_country,
    fees_collector: observation.fees_collector,
    losses_collector: observation.losses_collector,
    provider_event_created_at: observation.provider_event_created_at,
    event_envelope_fingerprint: observation.event_envelope_fingerprint || null,
    state_fingerprint: observation.state_fingerprint,
  };
  const inserted = one(await sql`
    INSERT INTO connect_account_state_events (
      id, school_id, instructor_id, connect_scope_id, stripe_account_id,
      stripe_event_id, event_type, event_context, requirements_summary,
      transfers_capability_status, dashboard_type, observed_at,
      payload_fingerprint, evidence_json, created_at
    ) VALUES (
      ${crypto.randomUUID()}, ${observation.school_id}, ${observation.instructor_id},
      ${observation.connect_scope_id}, ${observation.stripe_account_id},
      ${observation.event_id}, ${observation.event_type}, ${observation.event_context},
      ${JSON.stringify({ current: observation.requirements, future: observation.future_requirements })},
      ${observation.transfers_capability_status}, ${observation.dashboard_type},
      ${observation.observed_at}, ${observation.payload_fingerprint},
      ${JSON.stringify(evidence)}, NOW()
    ) ON CONFLICT (school_id, payload_fingerprint) DO NOTHING
    RETURNING *
  `);
  return inserted;
}

async function loadEventReceipt(sql, eventId) {
  return one(await sql`
    SELECT id, school_id, instructor_id, stripe_account_id, event_type,
           event_context, evidence_json, payload_fingerprint
      FROM connect_account_state_events
     WHERE stripe_event_id = ${eventId}
     LIMIT 1
  `);
}

async function recordLinkEvent(sql, { schoolId, instructorId, scopeId, accountId, action, token, expiresAt = null }) {
  return one(await sql`
    INSERT INTO connect_v2_account_link_events (
      id, school_id, instructor_id, connect_scope_id, stripe_account_id,
      action, state_fingerprint, expires_at, evidence_json, occurred_at
    ) VALUES (
      ${crypto.randomUUID()}, ${schoolId}, ${instructorId}, ${scopeId}, ${accountId},
      ${action}, ${fingerprint({ token })}, ${expiresAt}, ${JSON.stringify({ schema: 'connect-v2-readiness/1' })}, NOW()
    ) ON CONFLICT (school_id, state_fingerprint, action) DO NOTHING
    RETURNING id, occurred_at
  `);
}

async function createAgreementDraft(sql, {
  schoolId, instructorId, adminId, startsAt, endsAt = null,
  splitBps, weeklyFeeMinor, currency, documentVersion,
}) {
  const id = crypto.randomUUID();
  const next = one(await sql`
    SELECT COALESCE(MAX(version_number), 0) + 1 AS version_number
      FROM instructor_payout_agreement_versions
     WHERE school_id = ${schoolId} AND instructor_id = ${instructorId}
  `);
  const versionNumber = Number(next?.version_number || 1);
  const facts = { school_id: Number(schoolId), instructor_id: Number(instructorId), version_number: versionNumber, starts_at: startsAt, ends_at: endsAt, split_bps: splitBps, weekly_franchise_fee_minor: weeklyFeeMinor, currency, document_version: documentVersion };
  const agreementFingerprint = fingerprint(facts);
  return one(await sql`
    INSERT INTO instructor_payout_agreement_versions (
      id, school_id, instructor_id, version_number, starts_at, ends_at, status,
      split_bps, weekly_franchise_fee_minor, currency, document_version,
      created_by_admin_id, created_at, agreement_fingerprint
    ) VALUES (
      ${id}, ${schoolId}, ${instructorId}, ${versionNumber}, ${startsAt}, ${endsAt}, 'draft',
      ${splitBps}, ${weeklyFeeMinor}, ${currency}, ${documentVersion},
      ${adminId}, NOW(), ${agreementFingerprint}
    ) RETURNING *
  `);
}

async function acceptAgreement(sql, { schoolId, instructorId, agreementId, agreementFingerprint, evidenceReference }) {
  return one(await sql`
    UPDATE instructor_payout_agreement_versions
       SET accepted_at = NOW(), acceptance_evidence_reference = ${evidenceReference}
     WHERE id = ${agreementId} AND school_id = ${schoolId} AND instructor_id = ${instructorId}
       AND status = 'draft' AND accepted_at IS NULL
       AND agreement_fingerprint = ${agreementFingerprint}
     RETURNING *
  `);
}

async function activateAgreement(sql, { schoolId, instructorId, agreementId, agreementFingerprint, scopeId, adminId }) {
  return one(await sql`
    UPDATE instructor_payout_agreement_versions
       SET status = 'active', connect_scope_id = ${scopeId}, stripe_configuration_id = 'recipient',
           approved_by_admin_id = ${adminId}, approved_at = NOW()
     WHERE id = ${agreementId} AND school_id = ${schoolId} AND instructor_id = ${instructorId}
       AND status = 'draft' AND accepted_at IS NOT NULL
       AND agreement_fingerprint = ${agreementFingerprint}
     RETURNING *
  `);
}

module.exports = {
  acceptAgreement,
  activateAgreement,
  claimCreationIntent,
  createAgreementDraft,
  ensureCreationIntent,
  insertObservation,
  loadAgreementVersions,
  loadCurrentAgreement,
  loadCreationIntent,
  loadEventReceipt,
  loadInstructorScope,
  loadObservations,
  loadSchoolAndInstructor,
  loadSchoolConfig,
  listSchoolInstructors,
  loadScopeByAccount,
  recordCreationAttempt,
  recordLinkEvent,
  registerAccountScope,
  setCreationIntentState,
};
