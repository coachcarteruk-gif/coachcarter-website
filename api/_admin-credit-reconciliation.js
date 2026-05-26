// Inspection and idempotency helpers for future admin credit reconciliation.
//
// This module deliberately does not write to Postgres. The inspection
// orchestrator only reads Stripe via an injected client and reads Postgres via
// injected SQL; the real reconciliation writer will call this before attempting
// any credit mutation.

const {
  evaluateReconciliationStripeState,
} = require('./_admin-credit-contracts');
const { lockBalanceAndMutate } = require('./_credit-grant');
const { logAudit } = require('./_audit');
const {
  ReconciliationStripeLookupError,
  inspectReconciliationStripePayment,
} = require('./_admin-credit-reconciliation-stripe');

const RECONCILIATION_BUILDER_ERRORS = Object.freeze({
  PREVIEW_NOT_READY: Object.freeze({
    ok: false,
    status: 409,
    code: 'RECONCILIATION_PREVIEW_NOT_READY',
    message: 'Credit reconciliation preview is not ready for mutation.',
  }),
  PREVIEW_NOOP: Object.freeze({
    ok: false,
    status: 409,
    code: 'RECONCILIATION_PREVIEW_NOOP',
    message: 'Credit reconciliation preview is a no-op; no mutation input can be built.',
  }),
  PREVIEW_MANUAL_REVIEW: Object.freeze({
    ok: false,
    status: 409,
    code: 'RECONCILIATION_PREVIEW_MANUAL_REVIEW',
    message: 'Credit reconciliation preview requires manual review; no mutation input can be built.',
  }),
  PREVIEW_MALFORMED: Object.freeze({
    ok: false,
    status: 400,
    code: 'RECONCILIATION_PREVIEW_MALFORMED',
    message: 'Credit reconciliation preview is missing required grant fields.',
  }),
  REASON_REQUIRED: Object.freeze({
    ok: false,
    status: 400,
    code: 'INVALID_REASON',
    message: 'reason is required.',
  }),
});

const RECONCILIATION_IDENTITY_CONFLICT = Object.freeze({
  status: 409,
  code: 'RECONCILIATION_IDENTITY_CONFLICT',
  message: 'Stripe identities matched different credit transactions; manual review is required.',
});

function cleanIdentity(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function positiveInteger(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function nonNegativeInteger(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function creditsDeltaForReconciliationMinutes(minutes) {
  return Math.max(1, Math.round(minutes / 60));
}

function builderError(error, extra = {}) {
  return { ...error, ...extra };
}

function isUniqueConstraintError(err) {
  if (!err) return false;
  if (err.code === '23505') return true;
  return /duplicate key value violates unique constraint/i.test(String(err.message || ''));
}

function normalizeCreditTransaction(row) {
  if (!row) return null;
  return {
    id: row.id,
    source: row.source,
    created_at: row.created_at,
    school_id: row.school_id,
    stripe_session_id: row.stripe_session_id || null,
    stripe_payment_intent_id: row.stripe_payment_intent_id || null,
    stripe_charge_id: row.stripe_charge_id || null,
  };
}

function matchedIdentities(row, identities) {
  const matches = [];
  if (identities.stripeSessionId && row.stripe_session_id === identities.stripeSessionId) {
    matches.push('stripe_session_id');
  }
  if (identities.stripePaymentIntentId && row.stripe_payment_intent_id === identities.stripePaymentIntentId) {
    matches.push('stripe_payment_intent_id');
  }
  if (identities.stripeChargeId && row.stripe_charge_id === identities.stripeChargeId) {
    matches.push('stripe_charge_id');
  }
  return matches;
}

function noExistingResult(identities) {
  return {
    ok: true,
    existingCreditTransaction: null,
    identities,
    conflict: false,
  };
}

async function findExistingReconciliationCreditTransaction(sql, {
  schoolId,
  stripeSessionId = null,
  stripePaymentIntentId = null,
  stripeChargeId = null,
} = {}) {
  const identities = {
    stripeSessionId: cleanIdentity(stripeSessionId),
    stripePaymentIntentId: cleanIdentity(stripePaymentIntentId),
    stripeChargeId: cleanIdentity(stripeChargeId),
  };

  if (!identities.stripeSessionId && !identities.stripePaymentIntentId && !identities.stripeChargeId) {
    return noExistingResult(identities);
  }

  const rows = await sql`
    SELECT id, source, created_at, school_id,
           stripe_session_id, stripe_payment_intent_id, stripe_charge_id
      FROM credit_transactions
     WHERE school_id = ${schoolId}
       AND (
            (${identities.stripeSessionId} IS NOT NULL AND stripe_session_id = ${identities.stripeSessionId})
         OR (${identities.stripePaymentIntentId} IS NOT NULL AND stripe_payment_intent_id = ${identities.stripePaymentIntentId})
         OR (${identities.stripeChargeId} IS NOT NULL AND stripe_charge_id = ${identities.stripeChargeId})
       )
     ORDER BY id ASC
  `;

  if (!rows || rows.length === 0) {
    return noExistingResult(identities);
  }

  const uniqueRows = Array.from(
    new Map(rows.map((row) => [String(row.id), normalizeCreditTransaction(row)])).values()
  );

  if (uniqueRows.length > 1) {
    return {
      ok: false,
      ...RECONCILIATION_IDENTITY_CONFLICT,
      conflict: true,
      identities,
      matches: uniqueRows.map((row) => ({
        ...row,
        matched_identities: matchedIdentities(row, identities),
      })),
    };
  }

  const existingCreditTransaction = uniqueRows[0];
  return {
    ok: true,
    existingCreditTransaction,
    identities,
    conflict: false,
    matched_identities: matchedIdentities(existingCreditTransaction, identities),
  };
}

function stripeLookupFailureResult(err) {
  const known = err instanceof ReconciliationStripeLookupError;
  return {
    ok: false,
    ready: false,
    manual_review: true,
    status: known && err.status ? err.status : 409,
    code: known && err.code ? err.code : 'STRIPE_LOOKUP_FAILED',
    message: known && err.message ? err.message : 'Stripe lookup failed; manual review is required.',
  };
}

function conflictResult(result) {
  return {
    ok: false,
    ready: false,
    manual_review: true,
    status: result.status,
    code: result.code,
    message: result.message,
    conflict: true,
    identities: result.identities,
    matches: result.matches,
  };
}

function evaluatorRejectResult(result) {
  return {
    ok: false,
    ready: false,
    manual_review: true,
    status: result.status,
    code: result.code,
    message: result.message,
  };
}

function alreadyReconciledResult(result, existingCreditTransaction) {
  return {
    ok: true,
    ready: false,
    noop: true,
    status: 200,
    code: result.code,
    message: 'Payment is already reconciled; no credit mutation is needed.',
    transaction_id: result.transactionId,
    created_at: result.createdAt,
    existing_credit_transaction: existingCreditTransaction,
  };
}

function readyGrantPreviewResult({ schoolId, evaluation, stripeInspection }) {
  const input = evaluation.input;
  return {
    ok: true,
    ready: true,
    noop: false,
    status: 200,
    code: 'READY_TO_RECONCILE',
    message: 'Payment is ready for a reconciliation credit grant preview.',
    grant_preview: {
      source: 'reconciliation',
      type: 'admin_add',
      learner_id: input.learnerId,
      instructor_id: input.instructorId,
      school_id: schoolId,
      minutes: input.minutes,
      effective_rate_pence_per_minute: input.effectiveRatePencePerMinute,
      amount_pence: input.amountPence,
      stripe_fee_pence: stripeInspection.stripeFeePence,
      absorbed_by: null,
      stripe_session_id: input.stripeSessionId,
      stripe_payment_intent_id: input.stripePaymentIntentId,
      stripe_charge_id: input.stripeChargeId,
    },
    stripe: {
      session_id: input.stripeSessionId,
      payment_intent_id: input.stripePaymentIntentId,
      charge_id: input.stripeChargeId,
    },
  };
}

function buildReconciliationGrantInput({
  preview,
  reason,
} = {}) {
  if (!preview || typeof preview !== 'object') {
    return builderError(RECONCILIATION_BUILDER_ERRORS.PREVIEW_MALFORMED);
  }
  if (preview.noop === true || preview.code === 'ALREADY_RECONCILED') {
    return builderError(RECONCILIATION_BUILDER_ERRORS.PREVIEW_NOOP);
  }
  if (preview.conflict === true || preview.manual_review === true || preview.ok === false) {
    return builderError(RECONCILIATION_BUILDER_ERRORS.PREVIEW_MANUAL_REVIEW, {
      preview_code: preview.code || null,
    });
  }
  if (!Object.prototype.hasOwnProperty.call(preview, 'ready') && !preview.grant_preview) {
    return builderError(RECONCILIATION_BUILDER_ERRORS.PREVIEW_MALFORMED);
  }
  if (preview.ready !== true || !preview.grant_preview || typeof preview.grant_preview !== 'object') {
    return builderError(RECONCILIATION_BUILDER_ERRORS.PREVIEW_NOT_READY, {
      preview_code: preview.code || null,
    });
  }

  const normalizedReason = typeof reason === 'string' ? reason.trim() : '';
  if (!normalizedReason) {
    return builderError(RECONCILIATION_BUILDER_ERRORS.REASON_REQUIRED);
  }

  const grant = preview.grant_preview;
  const learnerId = positiveInteger(grant.learner_id);
  const instructorId = positiveInteger(grant.instructor_id);
  const schoolId = positiveInteger(grant.school_id);
  const minutes = positiveInteger(grant.minutes);
  const amountPence = nonNegativeInteger(grant.amount_pence);
  const stripeFeePence = nonNegativeInteger(grant.stripe_fee_pence);
  const effectiveRatePencePerMinute = positiveInteger(grant.effective_rate_pence_per_minute);
  const stripeSessionId = cleanIdentity(grant.stripe_session_id);
  const stripePaymentIntentId = cleanIdentity(grant.stripe_payment_intent_id);
  const stripeChargeId = cleanIdentity(grant.stripe_charge_id);

  if (
    grant.source !== 'reconciliation' ||
    grant.type !== 'admin_add' ||
    grant.absorbed_by !== null ||
    !learnerId ||
    !instructorId ||
    !schoolId ||
    !minutes ||
    amountPence === null ||
    stripeFeePence === null ||
    !effectiveRatePencePerMinute ||
    !stripeSessionId ||
    !stripePaymentIntentId ||
    !stripeChargeId
  ) {
    return builderError(RECONCILIATION_BUILDER_ERRORS.PREVIEW_MALFORMED);
  }

  const mutationInput = {
    learnerId,
    instructorId,
    schoolId,
    delta: minutes,
    creditsDelta: creditsDeltaForReconciliationMinutes(minutes),
    ledgerType: 'admin_add',
    reason: normalizedReason,
    amountPence,
    stripeFeePence,
    effectiveRatePencePerMinute,
    source: 'reconciliation',
    absorbedBy: null,
    stripeSessionId,
    stripePaymentIntentId,
    stripeChargeId,
    allowOverdraft: false,
  };

  return {
    ok: true,
    mutationInput,
    audit: {
      action: 'admin.credit_reconciliation',
      targetType: 'learner',
      targetId: learnerId,
      schoolId,
      details: {
        learner_id: learnerId,
        instructor_id: instructorId,
        school_id: schoolId,
        minutes,
        credits_delta: mutationInput.creditsDelta,
        reason: normalizedReason,
        amount_pence: amountPence,
        stripe_fee_pence: stripeFeePence,
        effective_rate_pence_per_minute: effectiveRatePencePerMinute,
        source: 'reconciliation',
        absorbed_by: null,
        stripe_session_id: stripeSessionId,
        stripe_payment_intent_id: stripePaymentIntentId,
        stripe_charge_id: stripeChargeId,
      },
    },
  };
}

async function inspectCreditReconciliation({
  sql,
  stripe,
  schoolId,
  input,
} = {}) {
  let stripeInspection;
  try {
    stripeInspection = await inspectReconciliationStripePayment({
      stripe,
      paymentIntentId: input && input.paymentIntentId,
      sessionId: input && input.sessionId,
      chargeId: input && input.chargeId,
    });
  } catch (err) {
    return stripeLookupFailureResult(err);
  }

  const existingLookup = await findExistingReconciliationCreditTransaction(sql, {
    schoolId,
    stripeSessionId: stripeInspection.stripeSessionId,
    stripePaymentIntentId: stripeInspection.stripePaymentIntentId,
    stripeChargeId: stripeInspection.stripeChargeId,
  });

  if (!existingLookup.ok && existingLookup.conflict) {
    return conflictResult(existingLookup);
  }

  const evaluation = evaluateReconciliationStripeState({
    existingCreditTransaction: existingLookup.existingCreditTransaction,
    paymentIntent: stripeInspection.paymentIntent,
    checkoutSession: stripeInspection.checkoutSession,
  });

  if (!evaluation.ok) {
    return evaluatorRejectResult(evaluation);
  }

  if (evaluation.noop) {
    return alreadyReconciledResult(evaluation, existingLookup.existingCreditTransaction);
  }

  return readyGrantPreviewResult({ schoolId, evaluation, stripeInspection });
}

async function grantReconciliationCredits({
  sql,
  stripe,
  admin,
  schoolId,
  input,
  req,
  inspect = inspectCreditReconciliation,
  mutateCredits = lockBalanceAndMutate,
  auditLogger = logAudit,
} = {}) {
  if (!sql) throw new Error('sql client required');
  if (!admin) throw new Error('admin required');
  if (!input) throw new Error('input required');

  const inspection = await inspect({ sql, stripe, schoolId, input });
  if (!inspection.ready) {
    return {
      ...inspection,
      credit_granted: false,
    };
  }

  const built = buildReconciliationGrantInput({
    preview: inspection,
    reason: input.reason,
  });
  if (!built.ok) {
    return built;
  }

  let mutation;
  try {
    mutation = await mutateCredits(sql, built.mutationInput);
  } catch (err) {
    if (!isUniqueConstraintError(err)) throw err;

    const racedInspection = await inspect({
      sql,
      stripe,
      schoolId,
      input: {
        ...input,
        sessionId: built.mutationInput.stripeSessionId,
        paymentIntentId: built.mutationInput.stripePaymentIntentId,
        chargeId: built.mutationInput.stripeChargeId,
      },
    });

    if (racedInspection.noop || racedInspection.conflict || racedInspection.manual_review || racedInspection.ok === false) {
      return {
        ...racedInspection,
        credit_granted: false,
        duplicate_race: true,
      };
    }

    return {
      ok: false,
      ready: false,
      manual_review: true,
      status: 409,
      code: 'RECONCILIATION_DUPLICATE_RACE',
      message: 'Stripe identity was claimed during reconciliation; manual review is required.',
      credit_granted: false,
      duplicate_race: true,
    };
  }

  if (!mutation || !mutation.ok) {
    return {
      ok: false,
      status: mutation && mutation.code === 'LEARNER_NOT_FOUND' ? 404 : 500,
      code: mutation && mutation.code ? mutation.code : 'CREDIT_RECONCILIATION_FAILED',
      message: mutation && mutation.message ? mutation.message : 'Failed to reconcile credits.',
      credit_granted: false,
    };
  }

  await auditLogger(sql, {
    adminId: admin.id,
    adminEmail: admin.email,
    action: built.audit.action,
    targetType: built.audit.targetType,
    targetId: built.audit.targetId,
    schoolId: built.audit.schoolId,
    req,
    details: {
      ...built.audit.details,
      credit_transaction_id: mutation.transactionId,
    },
  });

  return {
    ok: true,
    ready: false,
    noop: false,
    credit_granted: true,
    credit_transaction: {
      id: mutation.transactionId,
      source: 'reconciliation',
      type: 'admin_add',
      amount_pence: built.mutationInput.amountPence,
      stripe_fee_pence: built.mutationInput.stripeFeePence,
      absorbed_by: null,
      stripe_session_id: built.mutationInput.stripeSessionId,
      stripe_payment_intent_id: built.mutationInput.stripePaymentIntentId,
      stripe_charge_id: built.mutationInput.stripeChargeId,
    },
    learner_balance: {
      learner_id: built.mutationInput.learnerId,
      instructor_id: built.mutationInput.instructorId,
      school_id: built.mutationInput.schoolId,
      balance_minutes: mutation.balanceMinutes,
    },
    audit_action: built.audit.action,
  };
}

module.exports = {
  RECONCILIATION_BUILDER_ERRORS,
  RECONCILIATION_IDENTITY_CONFLICT,
  buildReconciliationGrantInput,
  creditsDeltaForReconciliationMinutes,
  findExistingReconciliationCreditTransaction,
  grantReconciliationCredits,
  inspectCreditReconciliation,
  isUniqueConstraintError,
};
