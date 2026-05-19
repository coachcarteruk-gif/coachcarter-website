/**
 * Atomic credit grants for Stripe-funded lesson credit.
 *
 * Current-main schema (pre per-instructor Step 2) has one pooled learner
 * balance on learner_users. The invariant here is intentionally small:
 * credit_transactions INSERT and learner_users balance increment happen in
 * one PostgreSQL statement, so webhook/verify races cannot leave a ledger row
 * without the matching balance change, or double-increment the balance.
 *
 * Future per-instructor schema should add a Phase 2A variant that locks and
 * writes learner_credit_balances(learner_id, instructor_id). Keep that variant
 * separate from this one; conditional SQL inside a single function is too easy
 * to audit incorrectly.
 */

let phase2ACheckPromise;

function toPositiveInteger(value, name) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return n;
}

function toNonNegativeInteger(value, name) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return n;
}

function toOptionalInteger(value, name) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n)) {
    throw new Error(`${name} must be an integer when provided`);
  }
  return n;
}

function toOptionalNonNegativeInteger(value, name) {
  const n = toOptionalInteger(value, name);
  if (n !== null && n < 0) {
    throw new Error(`${name} must be non-negative when provided`);
  }
  return n;
}

function normalizeGrantArgs(args) {
  if (!args || typeof args !== 'object') throw new Error('grantCredits args required');
  if (!args.sql) throw new Error('sql client required');

  const sessionId = String(args.sessionId || '').trim();
  if (!sessionId) throw new Error('sessionId required');

  return {
    sql: args.sql,
    learnerId: toPositiveInteger(args.learnerId, 'learnerId'),
    schoolId: toPositiveInteger(args.schoolId || 1, 'schoolId'),
    credits: toPositiveInteger(args.credits, 'credits'),
    minutes: toPositiveInteger(args.minutes, 'minutes'),
    amountPence: toNonNegativeInteger(args.amountPence || 0, 'amountPence'),
    paymentMethod: String(args.paymentMethod || 'card').slice(0, 64),
    sessionId,
    stripeFeePence: toOptionalNonNegativeInteger(args.stripeFeePence, 'stripeFeePence'),
  };
}

async function hasPhase2ASchema(sql) {
  if (!phase2ACheckPromise) {
    phase2ACheckPromise = (async () => {
      const rows = await sql`
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'credit_transactions'
          AND column_name = 'instructor_id'
        LIMIT 1
      `;
      return rows.length > 0;
    })();
  }
  return phase2ACheckPromise;
}

async function grantCredits(args) {
  const normalized = normalizeGrantArgs(args);
  const phase2A = process.env.PER_INSTRUCTOR_CREDITS_PHASE_2A === '1'
    || await hasPhase2ASchema(normalized.sql);

  if (phase2A) {
    return grantCreditsPhase2A(normalized);
  }
  return grantCreditsPre2A(normalized);
}

async function grantCreditsPre2A({
  sql,
  learnerId,
  schoolId,
  credits,
  minutes,
  amountPence,
  paymentMethod,
  sessionId,
  stripeFeePence,
}) {
  const [row] = await sql`
    WITH locked AS (
      SELECT id
      FROM learner_users
      WHERE id = ${learnerId}
        AND school_id = ${schoolId}
      FOR UPDATE
    ),
    inserted AS (
      INSERT INTO credit_transactions
        (learner_id, type, credits, amount_pence, payment_method,
         stripe_session_id, minutes, school_id, stripe_fee_pence)
      SELECT
        ${learnerId}, 'purchase', ${credits}, ${amountPence}, ${paymentMethod},
        ${sessionId}, ${minutes}, ${schoolId}, ${stripeFeePence}
      FROM locked
      ON CONFLICT (stripe_session_id) WHERE stripe_session_id IS NOT NULL DO NOTHING
      RETURNING id, credits, minutes
    ),
    applied AS (
      SELECT
        COALESCE(SUM(credits), 0)::int AS credits,
        COALESCE(SUM(minutes), 0)::int AS minutes,
        MAX(id)::int AS transaction_id
      FROM inserted
    )
    UPDATE learner_users lu
    SET credit_balance = lu.credit_balance + (SELECT credits FROM applied),
        balance_minutes = lu.balance_minutes + (SELECT minutes FROM applied)
    WHERE lu.id = ${learnerId}
      AND lu.school_id = ${schoolId}
      AND EXISTS (SELECT 1 FROM locked)
    RETURNING
      lu.credit_balance,
      lu.balance_minutes,
      (SELECT transaction_id FROM applied) AS transaction_id,
      ((SELECT transaction_id FROM applied) IS NULL) AS already_processed
  `;

  if (!row) {
    return {
      ok: false,
      code: 'LEARNER_NOT_FOUND',
      message: 'Learner not found for credit grant',
      alreadyProcessed: false,
      transactionId: null,
    };
  }

  return {
    ok: true,
    completed: true,
    alreadyProcessed: Boolean(row.already_processed),
    transactionId: row.transaction_id || null,
    creditBalance: row.credit_balance,
    balanceMinutes: row.balance_minutes,
  };
}

async function grantCreditsPhase2A() {
  throw new Error('grantCreditsPhase2A is not available until the per-instructor credit schema ships');
}

function _resetPhaseDetectionForTests() {
  phase2ACheckPromise = undefined;
}

module.exports = {
  grantCredits,
  grantCreditsPre2A,
  grantCreditsPhase2A,
  normalizeGrantArgs,
  hasPhase2ASchema,
  _resetPhaseDetectionForTests,
};
