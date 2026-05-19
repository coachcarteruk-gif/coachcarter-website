// Shared credit-grant helper. Step 0 of PER-INSTRUCTOR-CREDITS-PLAN.md.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE BUG THIS CLOSES
// ─────────────────────────────────────────────────────────────────────────────
// Before this module, three call sites did this shape:
//
//   await sql`INSERT INTO credit_transactions (...) VALUES (...)`;
//   await sql`UPDATE learner_users SET balance_minutes = balance_minutes + ${m}
//              WHERE id = ${learnerId}`;
//
// Two separate HTTP round-trips. If the process died between them (or the
// Vercel function got killed for any reason), the credit_transactions row
// persisted but the balance never incremented. Stripe's retry would hit the
// unique index on stripe_session_id, see the existing row, treat it as
// "already processed", and return — leaving the learner permanently short.
//
// The fix: a single SQL statement with multiple data-modifying CTEs. The
// INSERT and the balance UPDATE run inside one server-side transaction (the
// implicit one PostgreSQL wraps every standalone statement in). Either both
// land or neither does. Duplicate Stripe retries find the credit_transactions
// row already exists, the INSERT no-ops via ON CONFLICT DO NOTHING, the
// `applied` CTE coalesces to zero, and nothing changes. Perfectly idempotent.
//
// ─────────────────────────────────────────────────────────────────────────────
// LOAD-BEARING INVARIANT — read before adding any new credit-affecting writer
// ─────────────────────────────────────────────────────────────────────────────
// Every code path that mutates a learner's credit state MUST acquire the
// learner_users row lock (Pre-Phase-2A) or the learner_credit_balances row
// lock (Phase-2A+) before doing the mutation. This is the chokepoint that
// serialises concurrent writers — without it, a grant and a deduct racing
// against the same learner can produce a wrong balance under PostgreSQL's
// default READ COMMITTED isolation.
//
// Writers known to hold this invariant today:
//   1. grantCredits()                — this module.
//   2. api/slots.js handleBook()     — CTE-locked deduct path.
// Writers that MUST adopt it as they're cut over in later waves:
//   3. api/slots.js handleCancel()   — refund path (Step 5).
//   4. api/offers.js bookOfferSeries — balance writes (Step 5 / 1b).
//   5. api/admin.js admin grants     — credit-reconciliation / credit-goodwill (Step 5.5).
//
// Grep periodically for direct writes to learner_users.balance_minutes or
// learner_credit_balances.balance_minutes outside this lock pattern.
//
// ─────────────────────────────────────────────────────────────────────────────
// PRE-2A vs PHASE-2A
// ─────────────────────────────────────────────────────────────────────────────
// Pre-Phase-2A (current state): credits are scoped to the learner only.
// learner_credit_balances doesn't exist. Lock target is learner_users(id).
// The credit_transactions INSERT writes (learner_id, school_id, ...) with no
// instructor_id (column doesn't exist on the table yet).
//
// Phase-2A (future, ships with Step 2 + Step 4): credits are scoped per
// (learner, instructor) pair. Lock target is learner_credit_balances row.
// The INSERT additionally writes instructor_id; the UPDATE reconciles via
// SUM(credit_transactions) − SUM(booking_credit_sources) + SUM(adjustments).
//
// Selection happens lazily on first call via an information_schema check,
// or eagerly via env var. Cached for the Node process lifetime. The two
// variants live as separate exported functions to keep their SQL distinct
// and statically inspectable.
//
// ─────────────────────────────────────────────────────────────────────────────
// SOURCE-OF-TRUTH RULE (callers — please read)
// ─────────────────────────────────────────────────────────────────────────────
// Callers in webhook / verify-session paths MUST source amountPence, minutes,
// credits, and (Phase-2A) instructorId from Stripe Session metadata only —
// never by re-calling live pricing helpers. If an admin changes a rate
// between Checkout Session creation and webhook delivery, the in-flight
// session must still credit at the price the learner agreed to. This module
// has no `sql` handle for pricing lookup; it accepts these as explicit
// arguments. Defence-in-depth.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THE PARTIAL-INDEX WHERE CLAUSE IS LOAD-BEARING
// ─────────────────────────────────────────────────────────────────────────────
// The idempotency-enforcing unique index is partial:
//   CREATE UNIQUE INDEX uq_credit_tx_session
//     ON credit_transactions(stripe_session_id)
//     WHERE stripe_session_id IS NOT NULL;
//
// PostgreSQL's ON CONFLICT inference for a partial unique index REQUIRES the
// arbiter clause to repeat the index predicate verbatim — otherwise PG won't
// pick this index as the arbiter and the INSERT errors out instead of
// no-opping on duplicate. The exact clause used below:
//
//   ON CONFLICT (stripe_session_id) WHERE stripe_session_id IS NOT NULL DO NOTHING
//
// If db/migration.sql's index predicate is ever widened or dropped, the
// WHERE clause here MUST be updated to match. The "duplicate Stripe retry"
// integration test below catches a mismatch — it inserts twice with the
// same session_id and asserts the second call is alreadyProcessed.

let phase2ACheckPromise;

// ─────────────────────────────────────────────────────────────────────────────
// Input normalisation
// ─────────────────────────────────────────────────────────────────────────────
// Lenient coercion matches the codebase's style (Stripe metadata values arrive
// as strings; webhook callers pass parsed ints; tests pass plain numbers).
// We coerce to integer where unambiguous, throw with a useful message
// otherwise. All coercion happens before any SQL runs.

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
    learnerId:      toPositiveInteger(args.learnerId, 'learnerId'),
    schoolId:       toPositiveInteger(args.schoolId || 1, 'schoolId'),
    credits:        toPositiveInteger(args.credits, 'credits'),
    minutes:        toPositiveInteger(args.minutes, 'minutes'),
    amountPence:    toNonNegativeInteger(args.amountPence || 0, 'amountPence'),
    paymentMethod:  String(args.paymentMethod || 'card').slice(0, 64),
    sessionId,
    stripeFeePence: toOptionalNonNegativeInteger(args.stripeFeePence, 'stripeFeePence'),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase detection (lazy, memoised)
// ─────────────────────────────────────────────────────────────────────────────
// Returns true if credit_transactions has an instructor_id column, false
// otherwise. Cached for the Node process lifetime via a module-scoped
// Promise — repeated callers share one in-flight check.
//
// Process boundary note: Vercel runs each function invocation in a fresh
// Node process (cold start), but warm processes reuse this module. After
// Step 2's DDL lands, a warm process that already cached `false` will keep
// returning the wrong answer until the process recycles. The plan's
// resolution is "force a Vercel redeploy after the Step 2 migration" — that
// evicts all warm processes. PER_INSTRUCTOR_CREDITS_PHASE_2A=1 env-var
// override exists as a belt-and-braces for that window.

async function hasPhase2ASchema(sql) {
  if (!phase2ACheckPromise) {
    phase2ACheckPromise = (async () => {
      try {
        const rows = await sql`
          SELECT 1
            FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'credit_transactions'
             AND column_name = 'instructor_id'
           LIMIT 1
        `;
        return rows.length > 0;
      } catch (err) {
        // Fail closed: any error in the detection query falls back to
        // pre_2a so a transient DB hiccup doesn't promote us to a
        // not-yet-deployed schema variant.
        console.warn('[_credit-grant] phase detection failed, defaulting to pre_2a:', err.message);
        return false;
      }
    })();
  }
  return phase2ACheckPromise;
}

// Reset for tests only. Not part of the public contract — pulled out of
// module.exports separately and prefixed with underscore.
function _resetPhaseDetectionForTests() {
  phase2ACheckPromise = undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dispatcher
// ─────────────────────────────────────────────────────────────────────────────
// The single entry point callers should use. Two ways to land on the
// Phase-2A variant:
//   1. PER_INSTRUCTOR_CREDITS_PHASE_2A=1 env var (eager override). Useful in
//      the deploy window between Step 2 DDL and Step 4 code if warm Vercel
//      processes need flipping before a redeploy completes.
//   2. The lazy DDL check (preferred, automatic).
//
// The OR semantics match PER-INSTRUCTOR-CREDITS-PLAN.md Step 0 L225.

async function grantCredits(args) {
  const normalized = normalizeGrantArgs(args);
  const phase2A = process.env.PER_INSTRUCTOR_CREDITS_PHASE_2A === '1'
    || await hasPhase2ASchema(normalized.sql);

  if (phase2A) {
    return grantCreditsPhase2A(normalized);
  }
  return grantCreditsPre2A(normalized);
}

// ─────────────────────────────────────────────────────────────────────────────
// PRE-2A variant — single-statement CTE
// ─────────────────────────────────────────────────────────────────────────────
// Three CTEs and a top-level UPDATE:
//
//   locked   — SELECT ... FOR UPDATE on the learner_users row. Acquires a
//              row lock that holds for the duration of this statement,
//              serialising every concurrent credit-affecting writer for
//              this (learner, school) pair.
//   inserted — INSERT into credit_transactions, RETURNING the new row.
//              ON CONFLICT (stripe_session_id) WHERE stripe_session_id IS NOT NULL
//              DO NOTHING — duplicate Stripe retries return zero rows here.
//   applied  — Aggregates SUM(credits), SUM(minutes), MAX(id) from `inserted`.
//              Empty `inserted` → all zero / NULL.
//
// The top-level UPDATE adds the `applied` totals to balance, and RETURNING
// surfaces (new balance, transaction_id, already_processed flag) so the
// caller can branch on first-grant vs duplicate-retry.
//
// EXISTS (SELECT 1 FROM locked) is belt-and-braces: if `locked` returned
// zero rows (learner doesn't exist for this school), the UPDATE matches
// nothing and returns no rows — caller sees LEARNER_NOT_FOUND.

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
        MAX(id)::int                    AS transaction_id
      FROM inserted
    )
    UPDATE learner_users lu
       SET credit_balance  = lu.credit_balance  + (SELECT credits FROM applied),
           balance_minutes = lu.balance_minutes + (SELECT minutes FROM applied)
     WHERE lu.id = ${learnerId}
       AND lu.school_id = ${schoolId}
       AND EXISTS (SELECT 1 FROM locked)
    RETURNING
      lu.credit_balance,
      lu.balance_minutes,
      (SELECT transaction_id FROM applied)                       AS transaction_id,
      ((SELECT transaction_id FROM applied) IS NULL)             AS already_processed
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
    creditBalance:  row.credit_balance,
    balanceMinutes: row.balance_minutes,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE-2A variant (stub — implemented in Step 4)
// ─────────────────────────────────────────────────────────────────────────────
// When Step 2's schema ships (learner_credit_balances, instructor_id column
// on credit_transactions, booking_credit_sources), this becomes the active
// variant. The dispatcher will pick it automatically once hasPhase2ASchema()
// sees the new column, or eagerly via PER_INSTRUCTOR_CREDITS_PHASE_2A=1.
//
// Throwing here (rather than silently falling through to pre_2a) is
// deliberate: if a deploy lands the Step 2 DDL but ships an older bundle of
// this file, we want a loud failure rather than a silent regression to
// pooled credits.

async function grantCreditsPhase2A() {
  throw new Error(
    'grantCreditsPhase2A is not available until the per-instructor credit ' +
    'schema ships (Step 2). If you are seeing this in production with Step 2 ' +
    'already deployed, force a Vercel redeploy — warm workers may be running ' +
    'an old bundle of this module.'
  );
}

module.exports = {
  grantCredits,
  grantCreditsPre2A,
  grantCreditsPhase2A,
  normalizeGrantArgs,
  hasPhase2ASchema,
  // Test-only.
  _resetPhaseDetectionForTests,
};
