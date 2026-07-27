const { normalizeScope } = require('./_payout-v2-protected-balance');

const AUTHORITY_REFUSAL_CODES = Object.freeze({
  ACTOR_NOT_AUTHENTICATED: 'ACTOR_NOT_AUTHENTICATED',
  CONFIRMATION_REQUIRED: 'CONFIRMATION_REQUIRED',
  CROSS_SCHOOL_ACCESS: 'CROSS_SCHOOL_ACCESS',
  EXPECTED_FINGERPRINT_REQUIRED: 'EXPECTED_FINGERPRINT_REQUIRED',
  FINGERPRINT_CHANGED: 'FINGERPRINT_CHANGED',
  GLOBAL_SCOPE_FORBIDDEN: 'GLOBAL_SCOPE_FORBIDDEN',
  IDEMPOTENCY_IDENTITY_REQUIRED: 'IDEMPOTENCY_IDENTITY_REQUIRED',
  OPERATOR_CONFIGURATION_MISSING: 'OPERATOR_CONFIGURATION_MISSING',
  OPERATION_NOT_ALLOWED: 'OPERATION_NOT_ALLOWED',
  ORDINARY_SCHOOL_ADMIN_FORBIDDEN: 'ORDINARY_SCHOOL_ADMIN_FORBIDDEN',
  REASON_REQUIRED: 'REASON_REQUIRED',
  SCHOOL_SCOPE_REQUIRED: 'SCHOOL_SCOPE_REQUIRED',
  UNSUPPORTED_AUTHORITY_CLASS: 'UNSUPPORTED_AUTHORITY_CLASS',
});

function refusal(code) {
  return { code, non_pii: true };
}

function authorizePayoutV2Mutation({
  actor,
  operation,
  scope,
  reason,
  confirmation_phrase,
  required_confirmation_phrase,
  idempotency_identity,
  expected_fingerprint,
  actual_fingerprint,
}) {
  const normalizedScope = normalizeScope(scope);
  const refusals = [];
  const authorityClass = actor?.authority_class || null;
  if (!actor?.authenticated) refusals.push(refusal(AUTHORITY_REFUSAL_CODES.ACTOR_NOT_AUTHENTICATED));
  if (typeof operation !== 'string' || !operation.trim()) {
    refusals.push(refusal(AUTHORITY_REFUSAL_CODES.OPERATION_NOT_ALLOWED));
  }
  if (typeof reason !== 'string' || reason.trim().length < 8) {
    refusals.push(refusal(AUTHORITY_REFUSAL_CODES.REASON_REQUIRED));
  }
  if (
    typeof required_confirmation_phrase !== 'string'
    || !required_confirmation_phrase
    || confirmation_phrase !== required_confirmation_phrase
  ) {
    refusals.push(refusal(AUTHORITY_REFUSAL_CODES.CONFIRMATION_REQUIRED));
  }
  if (
    typeof idempotency_identity !== 'string'
    || !/^payout-v2:[a-z0-9:_-]{8,180}:sha256:[0-9a-f]{64}$/.test(idempotency_identity)
  ) {
    refusals.push(refusal(AUTHORITY_REFUSAL_CODES.IDEMPOTENCY_IDENTITY_REQUIRED));
  }
  if (typeof expected_fingerprint !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(expected_fingerprint)) {
    refusals.push(refusal(AUTHORITY_REFUSAL_CODES.EXPECTED_FINGERPRINT_REQUIRED));
  } else if (expected_fingerprint !== actual_fingerprint) {
    refusals.push(refusal(AUTHORITY_REFUSAL_CODES.FINGERPRINT_CHANGED));
  }

  if (authorityClass === 'cron') {
    if (!actor.cron_authenticated) refusals.push(refusal(AUTHORITY_REFUSAL_CODES.ACTOR_NOT_AUTHENTICATED));
    if (!Array.isArray(actor.allowed_operations) || !actor.allowed_operations.includes(operation)) {
      refusals.push(refusal(AUTHORITY_REFUSAL_CODES.OPERATION_NOT_ALLOWED));
    }
  } else if (authorityClass === 'superadmin') {
    if (normalizedScope.kind === 'school' && !normalizedScope.school_id) {
      refusals.push(refusal(AUTHORITY_REFUSAL_CODES.SCHOOL_SCOPE_REQUIRED));
    }
  } else if (authorityClass === 'scoped_operator') {
    if (!actor.configuration_present) {
      refusals.push(refusal(AUTHORITY_REFUSAL_CODES.OPERATOR_CONFIGURATION_MISSING));
    }
    if (!Array.isArray(actor.allowed_operations) || !actor.allowed_operations.includes(operation)) {
      refusals.push(refusal(AUTHORITY_REFUSAL_CODES.OPERATION_NOT_ALLOWED));
    }
    if (normalizedScope.kind === 'global' && actor.allow_global !== true) {
      refusals.push(refusal(AUTHORITY_REFUSAL_CODES.GLOBAL_SCOPE_FORBIDDEN));
    }
    if (
      normalizedScope.kind === 'school'
      && (!Array.isArray(actor.allowed_school_ids) || !actor.allowed_school_ids.includes(normalizedScope.school_id))
    ) {
      refusals.push(refusal(AUTHORITY_REFUSAL_CODES.CROSS_SCHOOL_ACCESS));
    }
  } else if (authorityClass === 'school_admin') {
    refusals.push(refusal(AUTHORITY_REFUSAL_CODES.ORDINARY_SCHOOL_ADMIN_FORBIDDEN));
  } else {
    refusals.push(refusal(AUTHORITY_REFUSAL_CODES.UNSUPPORTED_AUTHORITY_CLASS));
  }

  return {
    allowed: refusals.length === 0,
    authority_class: authorityClass,
    operation,
    scope: normalizedScope,
    refusals,
    audit_context: {
      actor_id: actor?.id || null,
      authority_class: authorityClass,
      scope: normalizedScope,
      reason: typeof reason === 'string' ? reason.trim().slice(0, 500) : null,
      confirmation_fingerprint: confirmation_phrase
        ? require('./_payout-v2-protected-balance').sha256({ confirmation_phrase })
        : null,
      idempotency_identity: idempotency_identity || null,
      expected_fingerprint: expected_fingerprint || null,
    },
  };
}

module.exports = {
  AUTHORITY_REFUSAL_CODES,
  authorizePayoutV2Mutation,
};
