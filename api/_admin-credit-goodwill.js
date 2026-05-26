const { lockBalanceAndMutate } = require('./_credit-grant');
const { logAudit } = require('./_audit');
const { getEffectiveRatePencePerMinute } = require('./_pricing-helpers');
const { SCOPED_LOOKUP_REJECT } = require('./_admin-credit-contracts');

function creditsDeltaForMinutes(minutes) {
  return Math.max(1, Math.round(minutes / 60));
}

async function assertGoodwillScope(sql, { learnerId, instructorId, schoolId }) {
  const [scope] = await sql`
    SELECT
      EXISTS (
        SELECT 1
          FROM learner_users
         WHERE id = ${learnerId}
           AND school_id = ${schoolId}
      ) AS learner_ok,
      EXISTS (
        SELECT 1
          FROM instructors
         WHERE id = ${instructorId}
           AND school_id = ${schoolId}
      ) AS instructor_ok
  `;

  if (!scope || scope.learner_ok !== true || scope.instructor_ok !== true) {
    return {
      ok: false,
      status: SCOPED_LOOKUP_REJECT.status,
      code: SCOPED_LOOKUP_REJECT.code,
      message: SCOPED_LOOKUP_REJECT.message,
    };
  }

  return { ok: true };
}

async function grantGoodwillCredits({
  sql,
  admin,
  schoolId,
  input,
  req,
  mutateCredits = lockBalanceAndMutate,
  auditLogger = logAudit,
  rateGetter = getEffectiveRatePencePerMinute,
} = {}) {
  if (!sql) throw new Error('sql client required');
  if (!admin) throw new Error('admin required');
  if (!input) throw new Error('input required');

  const scope = await assertGoodwillScope(sql, input);
  if (!scope.ok) return scope;

  const effectiveRatePencePerMinute = await rateGetter(sql, {
    schoolId,
    instructorId: input.instructorId,
    learnerId: input.learnerId,
  });

  const mutation = await mutateCredits(sql, {
    learnerId: input.learnerId,
    instructorId: input.instructorId,
    schoolId,
    delta: input.minutes,
    creditsDelta: creditsDeltaForMinutes(input.minutes),
    ledgerType: 'admin_add',
    reason: input.reason,
    amountPence: 0,
    stripeFeePence: 0,
    effectiveRatePencePerMinute,
    source: 'goodwill',
    absorbedBy: input.absorbedBy,
    allowOverdraft: false,
  });

  if (!mutation.ok) {
    return {
      ok: false,
      status: mutation.code === 'LEARNER_NOT_FOUND' ? 404 : 500,
      code: mutation.code || 'CREDIT_GOODWILL_FAILED',
      message: mutation.message || 'Failed to grant goodwill credits.',
    };
  }

  await auditLogger(sql, {
    adminId: admin.id,
    adminEmail: admin.email,
    action: 'admin.credit_goodwill_grant',
    targetType: 'learner',
    targetId: input.learnerId,
    schoolId,
    req,
    details: {
      learner_id: input.learnerId,
      instructor_id: input.instructorId,
      minutes: input.minutes,
      absorbed_by: input.absorbedBy,
      reason: input.reason,
      credit_transaction_id: mutation.transactionId,
      effective_rate_pence_per_minute: effectiveRatePencePerMinute,
    },
  });

  return {
    ok: true,
    credit_transaction: {
      id: mutation.transactionId,
      source: 'goodwill',
      type: 'admin_add',
      amount_pence: 0,
      stripe_fee_pence: 0,
      absorbed_by: input.absorbedBy,
    },
    learner_balance: {
      learner_id: input.learnerId,
      instructor_id: input.instructorId,
      school_id: schoolId,
      balance_minutes: mutation.balanceMinutes,
    },
    audit_action: 'admin.credit_goodwill_grant',
  };
}

module.exports = {
  grantGoodwillCredits,
  assertGoodwillScope,
  creditsDeltaForMinutes,
};
