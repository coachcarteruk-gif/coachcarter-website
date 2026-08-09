'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const CONNECT_V2_CONFIGURATION = 'recipient';
const CONNECT_V2_DASHBOARD = 'express';
const CONNECT_V2_SCHEMA_VERSION = 'connect-v2-readiness/1';
const DEFAULT_MAX_OBSERVATION_AGE_MS = 15 * 60 * 1000;

const SUPPORTED_ACCOUNT_EVENT_TYPES = new Set([
  'v2.core.account.created',
  'v2.core.account.updated',
  'v2.core.account[configuration.recipient].capability_status_updated',
  'v2.core.account[configuration.recipient].updated',
  'v2.core.account[requirements].updated',
  'v2.core.account[future_requirements].updated',
  'v2.core.account[defaults].updated',
  'v2.core.account[identity].updated',
]);

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

function exactTrue(value) {
  return value === true || value === 'true';
}

function evaluateConnectV2Gate({ env = process.env, schoolConfig, operation }) {
  const mode = env.STRIPE_MODE;
  const operationEnv = operation === 'account_create'
    ? 'STRIPE_CONNECT_V2_ACCOUNT_CREATION_ENABLED'
    : operation === 'account_link'
      ? 'STRIPE_CONNECT_V2_ACCOUNT_LINKS_ENABLED'
      : operation === 'dashboard_link'
        ? 'STRIPE_CONNECT_V2_DASHBOARD_LINKS_ENABLED'
        : operation === 'agreement'
          ? 'STRIPE_CONNECT_V2_AGREEMENTS_ENABLED'
          : operation === 'webhook'
            ? 'STRIPE_CONNECT_V2_WEBHOOK_PROCESSING_ENABLED'
      : null;
  const blockers = [];

  if (mode !== 'test' && mode !== 'live') blockers.push('stripe_mode_invalid');
  if (!exactTrue(env.STRIPE_CONNECT_V2_ENABLED)) blockers.push('global_gate_inactive');
  if (schoolConfig?.features?.stripe_connect_accounts_v2 !== true) blockers.push('school_gate_inactive');
  if (operationEnv && !exactTrue(env[operationEnv])) blockers.push(`${operation}_gate_inactive`);
  if (mode === 'live' && !exactTrue(env.STRIPE_CONNECT_V2_LIVE_ENABLED)) {
    blockers.push('live_gate_inactive');
  }

  return Object.freeze({ enabled: blockers.length === 0, mode: mode || null, blockers });
}

function makeStableIdentity({ schoolId, instructorId, mode }) {
  return `cc:connect-v2:${Number(schoolId)}:${Number(instructorId)}:${mode}:recipient`;
}

function makeCreationCommand({ schoolId, instructorId, mode, intentId }) {
  const stableIdentity = makeStableIdentity({ schoolId, instructorId, mode });
  const requestFacts = {
    schema: CONNECT_V2_SCHEMA_VERSION,
    stable_identity: stableIdentity,
    configuration: CONNECT_V2_CONFIGURATION,
    dashboard: CONNECT_V2_DASHBOARD,
  };
  return Object.freeze({
    stableIdentity,
    idempotencyKey: `cc-connect-v2-${intentId}`,
    requestFingerprint: fingerprint(requestFacts),
    requestFacts,
  });
}

function buildRecipientAccountCreateParams({ schoolId, instructorId, intentId, mode, email, displayName }) {
  const stableIdentity = makeStableIdentity({ schoolId, instructorId, mode });
  return {
    contact_email: email,
    display_name: displayName,
    dashboard: CONNECT_V2_DASHBOARD,
    identity: { country: 'gb', entity_type: 'individual' },
    defaults: {
      currency: 'gbp',
      locales: ['en-GB'],
      responsibilities: {
        fees_collector: 'application',
        losses_collector: 'application',
      },
    },
    configuration: {
      recipient: {
        capabilities: {
          stripe_balance: { stripe_transfers: { requested: true } },
        },
      },
    },
    include: [
      'configuration.recipient',
      'defaults',
      'identity',
      'requirements',
      'future_requirements',
    ],
    metadata: {
      cc_schema: CONNECT_V2_SCHEMA_VERSION,
      cc_connect_intent_id: String(intentId),
      cc_stable_identity: stableIdentity,
      cc_school_id: String(Number(schoolId)),
      cc_instructor_id: String(Number(instructorId)),
    },
  };
}

function cleanRequirementEntries(requirements) {
  const entries = Array.isArray(requirements?.entries) ? requirements.entries : [];
  const counts = { total: entries.length, currently_due: 0, past_due: 0, eventually_due: 0, user_action: 0 };
  const errorCodes = new Set();
  for (const entry of entries) {
    const status = entry?.minimum_deadline?.status;
    if (Object.hasOwn(counts, status)) counts[status] += 1;
    if (entry?.awaiting_action_from === 'user') counts.user_action += 1;
    for (const error of Array.isArray(entry?.errors) ? entry.errors : []) {
      if (/^[a-zA-Z0-9_.-]{1,80}$/.test(error?.code || '')) errorCodes.add(error.code);
    }
  }
  return {
    ...counts,
    error_codes: [...errorCodes].sort(),
    minimum_deadline: requirements?.summary?.minimum_deadline || null,
  };
}

function normalizeAccountObservation({
  account,
  schoolId,
  instructorId,
  connectScopeId,
  expectedAccountId,
  eventId = null,
  eventType = 'api.refresh',
  eventContext = 'platform',
  observedAt = new Date().toISOString(),
  providerEventCreatedAt = null,
}) {
  if (!account || account.object !== 'v2.core.account') throw new Error('CONNECT_V2_ACCOUNT_OBJECT_INVALID');
  if (!/^acct_[A-Za-z0-9]+$/.test(account.id || '')) throw new Error('CONNECT_V2_ACCOUNT_ID_INVALID');
  if (expectedAccountId && account.id !== expectedAccountId) throw new Error('CONNECT_V2_ACCOUNT_ID_MISMATCH');
  if (typeof account.livemode !== 'boolean') throw new Error('CONNECT_V2_ACCOUNT_MODE_UNKNOWN');

  const appliedConfigurations = Array.isArray(account.applied_configurations)
    ? [...new Set(account.applied_configurations)].sort()
    : [];
  const recipient = account.configuration?.recipient;
  const transfers = recipient?.capabilities?.stripe_balance?.stripe_transfers;
  const requirements = cleanRequirementEntries(account.requirements);
  const futureRequirements = cleanRequirementEntries(account.future_requirements);
  const stateFacts = {
    schema: CONNECT_V2_SCHEMA_VERSION,
    school_id: Number(schoolId),
    instructor_id: Number(instructorId),
    connect_scope_id: Number(connectScopeId),
    stripe_account_id: account.id,
    livemode: account.livemode,
    applied_configurations: appliedConfigurations,
    recipient_applied: recipient?.applied === true,
    transfers_capability_status: ['inactive', 'pending', 'active', 'restricted'].includes(transfers?.status)
      ? transfers.status
      : 'unknown',
    dashboard_type: ['express', 'full', 'none'].includes(account.dashboard) ? account.dashboard : 'unknown',
    identity_country: typeof account.identity?.country === 'string' ? account.identity.country.toLowerCase() : null,
    fees_collector: account.defaults?.responsibilities?.fees_collector || null,
    losses_collector: account.defaults?.responsibilities?.losses_collector || null,
    requirements,
    future_requirements: futureRequirements,
  };
  const facts = {
    ...stateFacts,
    event_id: eventId,
    event_type: eventType,
    event_context: eventContext,
    observed_at: observedAt,
    provider_event_created_at: providerEventCreatedAt,
  };
  return Object.freeze({
    ...facts,
    state_fingerprint: fingerprint(stateFacts),
    payload_fingerprint: fingerprint(facts),
  });
}

function selectCurrentObservation(observations) {
  const valid = (Array.isArray(observations) ? observations : [])
    .filter((item) => item && Number.isFinite(Date.parse(item.observed_at)))
    .sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at));
  if (valid.length === 0) return { observation: null, contradictory: false };
  const newestAt = Date.parse(valid[0].observed_at);
  const newest = valid.filter((item) => Date.parse(item.observed_at) === newestAt);
  return {
    observation: valid[0],
    contradictory: new Set(newest.map((item) => item.state_fingerprint || item.payload_fingerprint)).size > 1,
  };
}

function evaluateReadiness({
  schoolId,
  instructorId,
  expectedMode,
  scope,
  observations,
  agreement,
  now = new Date(),
  maxObservationAgeMs = DEFAULT_MAX_OBSERVATION_AGE_MS,
}) {
  const blockers = [];
  if (!scope) blockers.push('account_mapping_missing');
  else {
    if (Number(scope.school_id) !== Number(schoolId)) blockers.push('account_school_mismatch');
    if (scope.owner_type !== 'instructor') blockers.push('account_owner_type_mismatch');
    if (Number(scope.instructor_id) !== Number(instructorId)) blockers.push('account_instructor_mismatch');
    if (!/^acct_[A-Za-z0-9]+$/.test(scope.stripe_account_id || '')) blockers.push('account_identity_invalid');
    if (scope.evidence_json?.configuration_type !== CONNECT_V2_CONFIGURATION) blockers.push('account_configuration_mapping_mismatch');
    if (scope.evidence_json?.dashboard_type !== CONNECT_V2_DASHBOARD) blockers.push('account_dashboard_mapping_mismatch');
    if (scope.evidence_json?.stripe_mode !== expectedMode) blockers.push('account_mode_mapping_mismatch');
    if (!/^[0-9a-f-]{36}$/i.test(scope.evidence_json?.creation_intent_id || '') || scope.evidence_json?.stable_identity !== makeStableIdentity({ schoolId, instructorId, mode: expectedMode })) blockers.push('account_creation_evidence_mismatch');
  }

  const current = selectCurrentObservation(observations);
  const observation = current.observation;
  if (!observation) blockers.push('account_state_missing');
  else {
    if (current.contradictory) blockers.push('account_state_contradictory');
    if (Number(observation.school_id) !== Number(schoolId)) blockers.push('state_school_mismatch');
    if (Number(observation.instructor_id) !== Number(instructorId)) blockers.push('state_instructor_mismatch');
    if (scope && observation.stripe_account_id !== scope.stripe_account_id) blockers.push('state_account_mismatch');
    if (observation.livemode !== (expectedMode === 'live')) blockers.push('state_mode_mismatch');
    if (!observation.applied_configurations?.includes(CONNECT_V2_CONFIGURATION) || observation.recipient_applied !== true) blockers.push('recipient_configuration_inactive');
    if (observation.dashboard_type !== CONNECT_V2_DASHBOARD) blockers.push('dashboard_not_express');
    if (observation.identity_country !== 'gb') blockers.push('identity_country_mismatch');
    if (observation.fees_collector !== 'application' || observation.losses_collector !== 'application') blockers.push('responsibilities_mismatch');
    if (observation.transfers_capability_status !== 'active') blockers.push('transfers_capability_not_active');
    if (observation.requirements?.currently_due > 0 || observation.requirements?.past_due > 0 || observation.requirements?.user_action > 0) blockers.push('requirements_outstanding');
    const observedMs = Date.parse(observation.observed_at);
    if (!Number.isFinite(observedMs) || now.getTime() - observedMs > maxObservationAgeMs || observedMs > now.getTime() + 60_000) blockers.push('account_state_stale_or_invalid');
  }

  if (!agreement) blockers.push('agreement_missing');
  else {
    if (Number(agreement.school_id) !== Number(schoolId)) blockers.push('agreement_school_mismatch');
    if (Number(agreement.instructor_id) !== Number(instructorId)) blockers.push('agreement_instructor_mismatch');
    if (agreement.status !== 'active') blockers.push('agreement_not_active');
    const startsAt = Date.parse(agreement.starts_at);
    const endsAt = agreement.ends_at == null ? null : Date.parse(agreement.ends_at);
    if (!Number.isFinite(startsAt) || startsAt > now.getTime() || (endsAt != null && (!Number.isFinite(endsAt) || endsAt <= now.getTime()))) blockers.push('agreement_not_effective');
    if (!agreement.accepted_at || !agreement.acceptance_evidence_reference) blockers.push('agreement_not_accepted');
    if (!agreement.approved_at || !agreement.approved_by_admin_id) blockers.push('agreement_not_approved');
    if (scope && Number(agreement.connect_scope_id) !== Number(scope.id)) blockers.push('agreement_account_mismatch');
    if (agreement.stripe_configuration_id !== CONNECT_V2_CONFIGURATION) blockers.push('agreement_configuration_mismatch');
  }

  return Object.freeze({
    ready: blockers.length === 0,
    blockers: [...new Set(blockers)],
    account_state_observed_at: observation?.observed_at || null,
    transfers_capability_status: observation?.transfers_capability_status || 'unknown',
    dashboard_type: observation?.dashboard_type || 'unknown',
    agreement_status: agreement?.status || 'missing',
    payout_activation_changed: false,
  });
}

function serializeEventContext(context) {
  if (context == null || context === '') return 'platform';
  const value = typeof context === 'string' ? context : String(context);
  if (value === '') return 'platform';
  if (!/^[A-Za-z0-9_:/.-]{1,200}$/.test(value)) throw new Error('CONNECT_V2_EVENT_CONTEXT_INVALID');
  return value;
}

function validateThinEventEnvelope(event) {
  if (!event || typeof event !== 'object') throw new Error('CONNECT_V2_EVENT_INVALID');
  if (!/^evt_[A-Za-z0-9]+$/.test(event.id || '')) throw new Error('CONNECT_V2_EVENT_ID_INVALID');
  if (!SUPPORTED_ACCOUNT_EVENT_TYPES.has(event.type)) throw new Error('CONNECT_V2_EVENT_UNSUPPORTED');
  const accountId = event.related_object?.id;
  if (!/^acct_[A-Za-z0-9]+$/.test(accountId || '')) throw new Error('CONNECT_V2_EVENT_ACCOUNT_INVALID');
  const context = serializeEventContext(event.context);
  const envelope = { id: event.id, type: event.type, account_id: accountId, context, livemode: event.livemode };
  if (typeof event.livemode !== 'boolean') throw new Error('CONNECT_V2_EVENT_MODE_UNKNOWN');
  return Object.freeze({ ...envelope, fingerprint: fingerprint(envelope) });
}

function signOnboardingState({ schoolId, instructorId, scopeId, accountId, mode, nonce, secret, expiresIn = '20m' }) {
  if (!secret) throw new Error('CONNECT_V2_STATE_SECRET_MISSING');
  return jwt.sign({ school_id: Number(schoolId), instructor_id: Number(instructorId), scope_id: Number(scopeId), account_id: accountId, mode, nonce }, secret, {
    algorithm: 'HS256', audience: 'connect-v2-onboarding', expiresIn,
  });
}

function verifyOnboardingState(token, { schoolId, instructorId, scopeId, accountId, mode, secret }) {
  if (!secret) throw new Error('CONNECT_V2_STATE_SECRET_MISSING');
  const payload = jwt.verify(token, secret, { algorithms: ['HS256'], audience: 'connect-v2-onboarding' });
  if (Number(payload.school_id) !== Number(schoolId) || Number(payload.instructor_id) !== Number(instructorId) || Number(payload.scope_id) !== Number(scopeId) || payload.account_id !== accountId || payload.mode !== mode) {
    throw new Error('CONNECT_V2_STATE_SCOPE_MISMATCH');
  }
  return payload;
}

function classifyCreationOutcome(errorClassification) {
  return errorClassification?.retryable ? 'provider_ambiguous' : 'provider_failed_confirmed';
}

module.exports = {
  CONNECT_V2_CONFIGURATION,
  CONNECT_V2_DASHBOARD,
  CONNECT_V2_SCHEMA_VERSION,
  DEFAULT_MAX_OBSERVATION_AGE_MS,
  SUPPORTED_ACCOUNT_EVENT_TYPES,
  buildRecipientAccountCreateParams,
  classifyCreationOutcome,
  evaluateConnectV2Gate,
  evaluateReadiness,
  fingerprint,
  makeCreationCommand,
  makeStableIdentity,
  normalizeAccountObservation,
  selectCurrentObservation,
  serializeEventContext,
  signOnboardingState,
  stableJson,
  validateThinEventEnvelope,
  verifyOnboardingState,
};
