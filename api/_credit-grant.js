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
//
// ─────────────────────────────────────────────────────────────────────────────
// PHASE_2A_IMPLEMENTED — the master switch
// ─────────────────────────────────────────────────────────────────────────────
// Step 2 (schema) and Step 4 (Phase 2A code) ship as separate deploys per
// PER-INSTRUCTOR-CREDITS-PLAN.md L407 ("Schema-only, no behavioural change.
// Same two-deploy split as Step 1 (schema migration first, then writer code
// in Step 4)").
//
// That means after Step 2's DDL lands, credit_transactions.instructor_id
// exists, but grantCreditsPhase2A() is still a throwing stub. A naive
// "auto-promote on schema detection" dispatcher would route every Stripe
// webhook, verify-session call, and booking deduct through the stub and
//500 them all until Step 4 ships. Found in PR #166 review.
//
// PHASE_2A_IMPLEMENTED encodes "is the Phase 2A *code* deployed?" — distinct
// from "does the schema support Phase 2A?". The dispatcher short-circuits to
// Pre-2A whenever this is false, regardless of schema state or env-var
// override. Step 4's PR is the one that flips this to true AND ships the
// real implementation in the same commit. Atomic at the source level.
//
// Once true, the dispatcher honours the plan-spec OR semantics: env-var
// override OR schema check. Either signal routes to Phase 2A.
//
// Do NOT flip this without also implementing grantCreditsPhase2A.
//
// History:
//   2026-05-20 ~12:56 BST — PR #174 flipped this to true. Within 14
//     minutes a fourth-round GPT review surfaced a P1 in the Phase 2A
//     SQL: per PG docs §7.8.4, all data-modifying CTEs in one WITH
//     chain share the pre-statement snapshot. The outer
//     `UPDATE learner_credit_balances WHERE …` that filtered by table
//     columns (not via the ensured CTE alias) could not see the row
//     ensured's INSERT had just created. For any first-ever
//     (learner, instructor) pair the UPDATE matched nothing — balance
//     write silently dropped while the credit_transactions row landed.
//     Stripe retries then saw the session as already processed; the
//     learner's balance was stuck at 0. Zero customer impact in the
//     14-min window (0 Phase 2A writes verified via Neon).
//   2026-05-20 ~13:20 BST — PR #175 flipped this back to false to
//     close the silent-failure window.
//   2026-05-20 (this commit) — re-flip to true after restructuring all
//     three Phase 2A SQL statements to use INSERT ... ON CONFLICT
//     DO UPDATE on learner_credit_balances itself (the only single-
//     statement shape that gives correct first-write semantics under
//     PG's CTE snapshot rules). See the grantCreditsPhase2A header
//     comment block for the load-bearing PG §7.8.4 reasoning. SQL
//     shape verified by six integration tests against the Neon test
//     branch (tests/credit-grant-phase2a.integration.spec.js):
//     T1 first-ever write, T2 increment, T3 idempotent retry, T4
//     concurrent first-write race (20 runs), T5 deduct guard on
//     existing row, T6 deduct guard on missing row.
//
// Rollback story: revert this commit + run a Neon PITR restore (Free
// tier 6h window). Procedure documented in docs/credits-grandfather.md.
let PHASE_2A_IMPLEMENTED = true;

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

// Optional Phase-2A fields (D2 — extend normalizer; dispatcher / Phase-2A
// callee enforces "required-when-Phase-2A," not the normalizer). Pre-2A
// callers can keep passing the old arg set and get the same behaviour.
//
// `source` defaults to 'stripe' for purchase paths. Free-trial / referral /
// admin paths set it explicitly. The DB column defaults to 'stripe' too, so
// undefined here is also safe.
const ALLOWED_SOURCES = new Set(['stripe', 'free_trial', 'reconciliation', 'goodwill']);
const ALLOWED_ABSORBED_BY = new Set(['platform', 'instructor']);

function toOptionalEnum(value, name, allowed) {
  if (value === undefined || value === null || value === '') return null;
  const s = String(value);
  if (!allowed.has(s)) {
    throw new Error(`${name} must be one of ${[...allowed].join(', ')} when provided`);
  }
  return s;
}

function toOptionalString(value, name, maxLen = 255) {
  if (value === undefined || value === null || value === '') return null;
  const s = String(value).trim();
  if (!s) return null;
  if (s.length > maxLen) {
    throw new Error(`${name} must be ${maxLen} chars or less`);
  }
  return s;
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

    // Phase-2A fields (optional in the type system; dispatcher enforces
    // required-when-Phase-2A semantics for instructorId before routing).
    instructorId:                  toOptionalInteger(args.instructorId, 'instructorId'),
    effectiveRatePencePerMinute:   toOptionalNonNegativeInteger(args.effectiveRatePencePerMinute, 'effectiveRatePencePerMinute'),
    paymentIntentId:               toOptionalString(args.paymentIntentId, 'paymentIntentId'),
    chargeId:                      toOptionalString(args.chargeId, 'chargeId'),
    source:                        toOptionalEnum(args.source, 'source', ALLOWED_SOURCES),
    absorbedBy:                    toOptionalEnum(args.absorbedBy, 'absorbedBy', ALLOWED_ABSORBED_BY),
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

// Test-only override for the PHASE_2A_IMPLEMENTED master switch. Used by
// the dispatcher-routing test to prove that when the constant is true, the
// existing env-var / schema-check OR semantics still apply correctly.
// Production code MUST NOT call this.
function _setPhase2AImplementedForTests(value) {
  PHASE_2A_IMPLEMENTED = Boolean(value);
}

// ─────────────────────────────────────────────────────────────────────────────
// Dispatcher
// ─────────────────────────────────────────────────────────────────────────────
// The single entry point callers should use. Three signals decide which
// variant runs:
//
//   1. PHASE_2A_IMPLEMENTED constant (this file). Necessary condition. If
//      false, the dispatcher routes to Pre-2A unconditionally — even if
//      the schema check or env var say Phase 2A is "ready". This blocks
//      the Step 2 / Step 4 cold-start window where the column exists but
//      the implementation doesn't.
//   2. PER_INSTRUCTOR_CREDITS_PHASE_2A=1 env var (eager override). Useful
//      in the deploy window between Step 4 deploy and full worker recycle
//      if a specific function needs to be flipped early.
//   3. The lazy DDL check (automatic detection). Caches per process.
//
// Step 4's PR is what flips PHASE_2A_IMPLEMENTED to true AND ships the real
// grantCreditsPhase2A implementation in the same commit. Until that PR
// lands, only Pre-2A runs in production.
//
// Plan reference: PER-INSTRUCTOR-CREDITS-PLAN.md Step 0 L225 (env-var OR
// schema check) and L407 (Step 2 is schema-only; Step 4 ships the code).

async function grantCredits(args) {
  const normalized = normalizeGrantArgs(args);

  // Master switch — short-circuit when the Phase 2A code isn't deployed.
  // This is the load-bearing safety net: without it, applying the Step 2
  // DDL would break every credit grant in prod (the schema check would
  // flip true, the dispatcher would route to grantCreditsPhase2A, and the
  // stub would throw on every webhook + verify + book call).
  if (!PHASE_2A_IMPLEMENTED) {
    return grantCreditsPre2A(normalized);
  }

  const phase2A = process.env.PER_INSTRUCTOR_CREDITS_PHASE_2A === '1'
    || await hasPhase2ASchema(normalized.sql);

  if (phase2A) {
    // Required-when-Phase-2A validation lives on the dispatcher (D2). The
    // normalizer accepts these as optional so Pre-2A callers don't break.
    if (normalized.instructorId == null) {
      // Plan §Step 4 L759-764: missing instructor_id is the "legacy_pre_cutover"
      // path during the ~30-day window — grandfather to Fraser (instructor_id=1)
      // and log it. After the sunset window this branch turns into a 500.
      console.warn('[_credit-grant] legacy_pre_cutover: missing instructor_id on grantCredits, routing to Fraser (id=1) — sessionId=' + normalized.sessionId);
      normalized.instructorId = 1;
      normalized.legacyPreCutover = true;
    }
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
// PHASE-2A variant — single-statement, LCB-write-via-ON-CONFLICT, instructor-scoped
// ─────────────────────────────────────────────────────────────────────────────
// Same atomicity guarantee as Pre-2A (everything inside the implicit
// transaction PG wraps each statement in), but the lock target is the
// learner_credit_balances(learner_id, instructor_id) row instead of
// learner_users(id).
//
// Load-bearing constraint (PostgreSQL docs §7.8.4
// https://www.postgresql.org/docs/current/queries-with.html#QUERIES-WITH-MODIFYING):
//
//   "All the statements are executed with the same snapshot, so they
//    cannot 'see' one another's effects on the target tables ...
//    RETURNING data is the only way to communicate changes between
//    different WITH sub-statements and the main query."
//
// This rules out the obvious shape (PR #174's shipped + reverted shape):
//
//   WITH ensured  AS (INSERT INTO LCB ... ON CONFLICT DO UPDATE RETURNING ...),
//        inserted AS (INSERT INTO credit_transactions ... RETURNING minutes)
//   UPDATE learner_credit_balances lcb
//      SET balance_minutes = ...
//    WHERE lcb.learner_id = $1 AND lcb.instructor_id = $2;
//
// For a first-ever (learner_id, instructor_id) pair, the outer UPDATE's
// table scan runs against the pre-statement snapshot — ensured's INSERT
// is invisible to it. The scan matches nothing, the UPDATE writes zero
// rows, RETURNING is empty, the helper returns LEARNER_NOT_FOUND, but
// credit_transactions was already inserted. Stripe retries hit the
// session_id arbiter and skip. Learner's balance is stuck at 0.
//
// The fix: make the LCB write itself the ON CONFLICT statement, with
// the ledger insert as a CTE feeding EXCLUDED.balance_minutes:
//
//   WITH inserted AS (
//     INSERT INTO credit_transactions (...) VALUES (...)
//     ON CONFLICT (stripe_session_id) WHERE ... DO NOTHING
//     RETURNING id, minutes
//   )
//   INSERT INTO learner_credit_balances
//     (learner_id, instructor_id, school_id, balance_minutes)
//   SELECT $1, $2, $3, COALESCE((SELECT SUM(minutes)::int FROM inserted), 0)
//   ON CONFLICT (learner_id, instructor_id) DO UPDATE
//     SET balance_minutes = learner_credit_balances.balance_minutes
//                         + COALESCE((SELECT SUM(minutes)::int FROM inserted), 0),
//         updated_at = NOW()
//   RETURNING balance_minutes,
//             (SELECT id FROM inserted) AS transaction_id,
//             ((SELECT id FROM inserted) IS NULL) AS already_processed;
//
// Why this shape is correct:
//
//  - First-ever write: no LCB row exists, so the INSERT branch fires,
//    materialising the row with balance_minutes = inserted.minutes.
//    Atomic with the ledger insert; no snapshot-visibility problem
//    because we never read LCB before writing it.
//
//  - Existing row: the conflict branch's UPDATE clause reads
//    learner_credit_balances.balance_minutes from the row it just
//    acquired the exclusive lock on. PG's INSERT ... ON CONFLICT
//    DO UPDATE semantics are: lock the conflicting row, then read+
//    update it. The read happens AFTER the lock, so any concurrent
//    writer that committed while we waited on the lock is visible.
//    Concurrent writes therefore serialise correctly — no lost
//    increments. This is the documented guarantee of ON CONFLICT
//    DO UPDATE (§7.8.4 says it differently for CTEs; the per-row
//    locking semantics for ON CONFLICT DO UPDATE are in §6.4).
//
//  - Duplicate Stripe retry: `inserted` is empty, the COALESCE'd
//    SUM is 0, EXCLUDED.balance_minutes is 0, the conflict branch's
//    UPDATE is balance_minutes = LCB.balance_minutes + 0 (no-op).
//    transaction_id is NULL, already_processed = true.
//
// Idempotency anchor: ON CONFLICT (stripe_session_id) WHERE
// stripe_session_id IS NOT NULL on the credit_transactions INSERT —
// the same load-bearing partial-index match documented for Pre-2A.
// We can only target one arbiter per INSERT; the other unique
// indexes (payment_intent, charge) raise 23505 as exceptions and the
// caller swallows them like the Pre-2A path does in webhook.js.
//
// Edge case — duplicate retry where first attempt died between the
// ledger insert and the LCB write (extremely rare, requires a
// process crash mid-statement which the single-statement shape
// itself rules out, but possible if a future refactor splits them):
// `inserted` will be empty, EXCLUDED.balance_minutes is 0, the
// INSERT branch materialises LCB with balance_minutes = 0. Ledger
// is correct (one row); LCB is wrong (0 instead of `minutes`). The
// Step 4.5 divergence-check cron catches this; we accept it as the
// cost of the atomic single-statement shape. Do not reintroduce
// inline ledger-scan reconcile to "fix" this — that reintroduces
// the §7.8.4 problem.
//
// Step 4.5 TODO: add a divergence-check cron that compares
// learner_credit_balances.balance_minutes against the full ledger
// reconcile: SUM(credit_transactions.minutes)
// − SUM(booking_credit_sources.minutes_drawn)
// − SUM(credit_source_adjustments.minutes_adjusted). Inline writers
// trust ON CONFLICT DO UPDATE's locking semantics; the cron is the
// guardrail for drift.

async function grantCreditsPhase2A({
  sql,
  learnerId,
  instructorId,
  schoolId,
  credits,
  minutes,
  amountPence,
  paymentMethod,
  sessionId,
  stripeFeePence,
  effectiveRatePencePerMinute,
  paymentIntentId,
  chargeId,
  source,
  absorbedBy,
  legacyPreCutover,
}) {
  const resolvedSource = source || 'stripe';

  // See module header above for the load-bearing PG §7.8.4 reasoning.
  // The arbiter clause on the ledger INSERT is ON CONFLICT (stripe_session_id)
  // WHERE stripe_session_id IS NOT NULL — the partial-index match required
  // for arbiter inference. Other unique indexes (payment_intent, charge) raise
  // 23505 as exceptions; callers (webhook.js handleCreditPurchase) swallow
  // those exactly as in the Pre-2A path.
  const [row] = await sql`
    WITH inserted AS (
      INSERT INTO credit_transactions
        (learner_id, instructor_id, school_id, type, credits, minutes,
         amount_pence, payment_method, stripe_session_id, stripe_fee_pence,
         stripe_payment_intent_id, stripe_charge_id,
         effective_rate_pence_per_minute, source, absorbed_by)
      VALUES
        (${learnerId}, ${instructorId}, ${schoolId}, 'purchase', ${credits}, ${minutes},
         ${amountPence}, ${paymentMethod}, ${sessionId}, ${stripeFeePence},
         ${paymentIntentId}, ${chargeId},
         ${effectiveRatePencePerMinute}, ${resolvedSource}, ${absorbedBy})
      ON CONFLICT (stripe_session_id) WHERE stripe_session_id IS NOT NULL DO NOTHING
      RETURNING id, minutes
    )
    INSERT INTO learner_credit_balances
      (learner_id, instructor_id, school_id, balance_minutes)
    SELECT
      ${learnerId}, ${instructorId}, ${schoolId},
      COALESCE((SELECT SUM(minutes)::int FROM inserted), 0)
    ON CONFLICT (learner_id, instructor_id) DO UPDATE
      SET balance_minutes = learner_credit_balances.balance_minutes
                          + COALESCE((SELECT SUM(minutes)::int FROM inserted), 0),
          updated_at = NOW()
    RETURNING
      learner_credit_balances.balance_minutes,
      (SELECT id FROM inserted)            AS transaction_id,
      ((SELECT id FROM inserted) IS NULL)  AS already_processed
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
    balanceMinutes: row.balance_minutes,
    instructorId,
    legacyPreCutover: Boolean(legacyPreCutover),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// lockBalanceAndMutate — shared helper for the 9-writer cutover (D1)
// ─────────────────────────────────────────────────────────────────────────────
// Used by every non-Stripe-purchase writer that mutates a learner's balance:
//   - slots.js handleBook deduct + refund-on-failure  (already CTE-locked)
//   - slots.js handleCancel single + series refund
//   - offers.js bookOfferSeries refund-on-failure
//   - admin.js edit-booking delta + adjust-credits
//   - instructor.js cancel refund + edit-booking delta + mark-paid + undo
//   - cron-referral-rewards.js referrer payout
//   - magic-link.js welcome bonus
//
// The Stripe-session purchase paths (webhook.handleCreditPurchase plus the
// offers.js handleFreeOffer credit grant) still go through grantCredits() —
// that path writes Stripe linkage fields (session_id, payment_intent_id,
// charge_id, effective rate) which this helper deliberately doesn't.
// The slot-purchase net-zero pattern in webhook.handleSlotBooking and the
// slot-pinned arm of webhook.handleOfferBooking use lockBalanceAdjustLCB
// below (balance-only, no separate ledger row).
//
// Phase gating mirrors grantCredits():
//   - PHASE_2A_IMPLEMENTED = false → lock learner_users + write balance_minutes.
//     Pre-2A behaviour, current production.
//   - PHASE_2A_IMPLEMENTED = true  → lock LCB row + reconcile via ledger SUM.
//     Same chokepoint as grantCreditsPhase2A.
//
// The Pre-2A path here is a single CTE that mirrors the shape grantCreditsPre2A
// uses, but with a signed `delta` (positive = grant, negative = deduct) and
// the booking-flow ledger types ('edit_adjustment', 'admin_add', etc).
// Insufficient-balance is signalled by `ok: false, code: 'INSUFFICIENT_BALANCE'`
// — the UPDATE clause's `balance_minutes >= -delta` predicate prevents the
// write when the balance would go negative on a deduct.

const ALLOWED_LEDGER_TYPES = new Set([
  'purchase', 'refund', 'slot_purchase',
  'edit_adjustment', 'admin_add', 'admin_remove',
  'referral_bonus', 'referral_reward', 'free_trial',
]);

async function lockBalanceAndMutate(sql, args) {
  if (!sql) throw new Error('sql client required');
  if (!args || typeof args !== 'object') throw new Error('lockBalanceAndMutate args required');

  const learnerId   = toPositiveInteger(args.learnerId, 'learnerId');
  const schoolId    = toPositiveInteger(args.schoolId || 1, 'schoolId');
  const delta       = Number(args.delta);
  if (!Number.isInteger(delta) || delta === 0) {
    throw new Error('delta must be a non-zero integer');
  }
  const ledgerType  = String(args.ledgerType || '').trim();
  if (!ALLOWED_LEDGER_TYPES.has(ledgerType)) {
    throw new Error(`ledgerType must be one of ${[...ALLOWED_LEDGER_TYPES].join(', ')}`);
  }
  const reason         = String(args.reason || ledgerType).slice(0, 255);
  const amountPence    = toNonNegativeInteger(args.amountPence || 0, 'amountPence');
  const creditsDelta   = Number.isInteger(args.creditsDelta) ? args.creditsDelta : 0;
  const allowOverdraft = Boolean(args.allowOverdraft);

  // Phase-2A optional fields. instructorId is REQUIRED when Phase 2A is live;
  // we mirror the dispatcher's grandfather behaviour so callers that haven't
  // adopted instructor_id yet still work during the cutover window.
  let instructorId = toOptionalInteger(args.instructorId, 'instructorId');
  const effectiveRate            = toOptionalNonNegativeInteger(args.effectiveRatePencePerMinute, 'effectiveRatePencePerMinute');
  const source                   = toOptionalEnum(args.source, 'source', ALLOWED_SOURCES);
  const absorbedBy               = toOptionalEnum(args.absorbedBy, 'absorbedBy', ALLOWED_ABSORBED_BY);

  // ─── Pre-2A path ────────────────────────────────────────────────────────
  if (!PHASE_2A_IMPLEMENTED) {
    return lockBalanceAndMutatePre2A({
      sql, learnerId, schoolId, delta, ledgerType, reason,
      amountPence, creditsDelta, allowOverdraft,
    });
  }

  // ─── Phase-2A path ──────────────────────────────────────────────────────
  // Same env-var / schema-check OR as grantCredits().
  const phase2A = process.env.PER_INSTRUCTOR_CREDITS_PHASE_2A === '1'
    || await hasPhase2ASchema(sql);
  if (!phase2A) {
    return lockBalanceAndMutatePre2A({
      sql, learnerId, schoolId, delta, ledgerType, reason,
      amountPence, creditsDelta, allowOverdraft,
    });
  }

  if (instructorId == null) {
    console.warn('[_credit-grant] legacy_pre_cutover: missing instructor_id on lockBalanceAndMutate, routing to Fraser (id=1) — ledgerType=' + ledgerType);
    instructorId = 1;
  }

  return lockBalanceAndMutatePhase2A({
    sql, learnerId, instructorId, schoolId, delta, ledgerType, reason,
    amountPence, creditsDelta, allowOverdraft,
    effectiveRate, source, absorbedBy,
  });
}

async function lockBalanceAndMutatePre2A({
  sql, learnerId, schoolId, delta, ledgerType, reason,
  amountPence, creditsDelta, allowOverdraft,
}) {
  // Insufficient-balance guard: deducts (delta < 0) require enough balance
  // to absorb the deduction without going negative. The UPDATE WHERE clause
  // enforces it; if no row matches, the caller sees INSUFFICIENT_BALANCE.
  // allowOverdraft skips the guard — used by referral-bonus and admin-add
  // paths where the delta is always positive anyway.
  const deductGuard = (delta < 0 && !allowOverdraft) ? -delta : null;

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
        (learner_id, type, minutes, credits, amount_pence, payment_method, school_id)
      SELECT
        ${learnerId}, ${ledgerType}, ${delta}, ${creditsDelta}, ${amountPence}, ${reason}, ${schoolId}
      FROM locked
      WHERE ${deductGuard === null}::boolean
         OR (SELECT balance_minutes FROM learner_users WHERE id = ${learnerId} AND school_id = ${schoolId}) >= ${deductGuard}
      RETURNING id
    )
    UPDATE learner_users lu
       SET balance_minutes = lu.balance_minutes + ${delta},
           credit_balance  = GREATEST(lu.credit_balance + ${creditsDelta}, 0)
     WHERE lu.id = ${learnerId}
       AND lu.school_id = ${schoolId}
       AND EXISTS (SELECT 1 FROM inserted)
    RETURNING
      lu.balance_minutes,
      (SELECT id FROM inserted) AS transaction_id
  `;

  if (!row) {
    // Could be LEARNER_NOT_FOUND or INSUFFICIENT_BALANCE — disambiguate.
    const [exists] = await sql`
      SELECT balance_minutes
        FROM learner_users
       WHERE id = ${learnerId} AND school_id = ${schoolId}
    `;
    if (!exists) {
      return { ok: false, code: 'LEARNER_NOT_FOUND', balanceMinutes: null, transactionId: null };
    }
    return {
      ok: false,
      code: 'INSUFFICIENT_BALANCE',
      balanceMinutes: exists.balance_minutes,
      transactionId: null,
    };
  }

  return {
    ok: true,
    balanceMinutes: row.balance_minutes,
    transactionId: row.transaction_id || null,
  };
}

async function lockBalanceAndMutatePhase2A({
  sql, learnerId, instructorId, schoolId, delta, ledgerType, reason,
  amountPence, creditsDelta, allowOverdraft,
  effectiveRate, source, absorbedBy,
}) {
  // Phase-2A insufficient-balance guard reads the LCB row's balance_minutes,
  // not the pooled learner_users.balance_minutes — credits are scoped per
  // instructor now and a learner can have plenty of pooled minutes while
  // having zero for this instructor.
  //
  // SQL shape: the LCB write is the lock-acquiring statement (its own
  // INSERT ... ON CONFLICT DO UPDATE WHERE guard). The ledger insert is a
  // dependent CTE that consumes the LCB write's RETURNING — it fires only
  // when the LCB write actually committed.
  //
  // Why this ordering matters (GPT review of PR #176):
  //
  //   PR #176's first cut had the ledger insert as the FIRST CTE with a
  //   pre-lock subquery against LCB for the deduct guard, then the LCB
  //   write as the outer INSERT...ON CONFLICT DO UPDATE WHERE balance +
  //   delta >= 0. Race: two concurrent delta=-50 calls against LCB=60
  //   both pass the pre-lock subquery (60 >= 50), both write a -50 row
  //   into credit_transactions. Caller A wins the lock, UPDATE passes,
  //   LCB=10. Caller B waits for the lock, re-reads LCB=10, UPDATE
  //   rejects (10 + -50 < 0), returns no row → INSUFFICIENT_BALANCE,
  //   but the -50 ledger row from B is already committed. Ledger and
  //   LCB diverge by one phantom row.
  //
  //   The fix: the ledger insert must depend on a row that ONLY exists
  //   if the locked LCB mutation actually succeeded. PG §7.8.4 still
  //   applies — CTEs share a snapshot — but the LCB write returns
  //   RETURNING from inside the same statement, so the ledger CTE
  //   consuming that RETURNING does see it (RETURNING data is exactly
  //   the §7.8.4-permitted communication channel between CTEs).
  //
  // Shape:
  //
  //   WITH lcb_write AS (
  //     INSERT INTO learner_credit_balances (...) VALUES (... $delta)
  //     ON CONFLICT (learner_id, instructor_id) DO UPDATE
  //       SET balance_minutes = LCB.balance_minutes + $delta, ...
  //       WHERE LCB.balance_minutes + $delta >= 0
  //     RETURNING balance_minutes
  //   ),
  //   inserted AS (
  //     INSERT INTO credit_transactions (...) VALUES (...)
  //     FROM lcb_write   -- only fires if lcb_write committed a row
  //     RETURNING id
  //   )
  //   SELECT lcb_write.balance_minutes, inserted.id AS transaction_id
  //     FROM lcb_write LEFT JOIN inserted ON TRUE;
  //
  // First-write deduct (no LCB row, delta negative): the LCB INSERT branch
  // would create a row with balance_minutes = $delta (negative), which we
  // refuse via a `WHERE NOT $isDeduct` on the SELECT. Existing-row deduct
  // (LCB row present, would go negative): the ON CONFLICT DO UPDATE WHERE
  // rejects, lcb_write returns no row, inserted gets no input row, ledger
  // stays clean.
  const isDeduct = delta < 0 && !allowOverdraft;
  const resolvedSource = source || 'stripe';

  // Implementation note on the two-clause refusal pattern:
  //
  //   isDeduct=true + no LCB row:  the SELECT's WHERE NOT $isDeduct is
  //     FALSE → the INSERT attempts nothing → no INSERT branch, no
  //     CONFLICT branch → lcb_write returns 0 rows. (T6 contract.)
  //
  //   isDeduct=true + existing LCB row: the SELECT's WHERE NOT $isDeduct
  //     is FALSE → INSERT attempts nothing — BUT we still need the
  //     ON CONFLICT DO UPDATE path to run so the existing-row deduct
  //     can succeed (or be refused on a balance-would-go-negative basis).
  //     To make the INSERT actually attempt-and-conflict, we feed the
  //     SELECT a single row UNCONDITIONALLY and rely entirely on the
  //     ON CONFLICT DO UPDATE WHERE clause to gate deducts. For first-
  //     write-deduct (no row exists), we then need a separate check —
  //     handled by the WHERE in the ON CONFLICT DO NOTHING fallback
  //     pattern below.
  //
  // The clean expression:
  //   - If isDeduct AND there's no LCB row → must refuse (no row to deduct
  //     from). We can't INSERT a negative balance, so we filter the SELECT
  //     against the existence of an LCB row.
  //   - If isDeduct AND there's an LCB row → INSERT attempt fires, hits
  //     ON CONFLICT, runs DO UPDATE which has the post-write-non-negative
  //     guard. This is the locked path; any concurrent writer has to
  //     serialise here.
  //   - If !isDeduct → INSERT fires either as first-write or as conflict;
  //     no guards needed (or trivially satisfied).
  //
  // The SELECT WHERE expression:
  //   NOT $isDeduct OR EXISTS (SELECT 1 FROM learner_credit_balances ...)
  //
  // First-write add: !isDeduct → TRUE → INSERT fires, no conflict, row
  //   materialises with balance = $delta. ✓
  // First-write deduct: isDeduct + no LCB → FALSE → INSERT skipped → no
  //   side effects → lcb_write returns 0 rows. ✓
  // Existing-row add: !isDeduct → TRUE → INSERT attempt, conflict, DO
  //   UPDATE WHERE TRUE → row updated. ✓
  // Existing-row deduct: isDeduct + EXISTS → TRUE → INSERT attempt,
  //   conflict, DO UPDATE WHERE post >= 0 → either updates and returns,
  //   or rejects and returns nothing. ✓
  const [row] = await sql`
    WITH lcb_write AS (
      INSERT INTO learner_credit_balances
        (learner_id, instructor_id, school_id, balance_minutes)
      SELECT ${learnerId}, ${instructorId}, ${schoolId}, ${delta}
       WHERE NOT ${isDeduct}::boolean
          OR EXISTS (
               SELECT 1 FROM learner_credit_balances
                WHERE learner_id = ${learnerId}
                  AND instructor_id = ${instructorId}
             )
      ON CONFLICT (learner_id, instructor_id) DO UPDATE
        SET balance_minutes = learner_credit_balances.balance_minutes + ${delta},
            updated_at = NOW()
        WHERE NOT ${isDeduct}::boolean
           OR learner_credit_balances.balance_minutes + ${delta} >= 0
      RETURNING balance_minutes
    ),
    inserted AS (
      INSERT INTO credit_transactions
        (learner_id, instructor_id, school_id, type, minutes, credits,
         amount_pence, payment_method,
         effective_rate_pence_per_minute, source, absorbed_by)
      SELECT
        ${learnerId}, ${instructorId}, ${schoolId}, ${ledgerType}, ${delta}, ${creditsDelta},
        ${amountPence}, ${reason},
        ${effectiveRate}, ${resolvedSource}, ${absorbedBy}
      FROM lcb_write
      RETURNING id
    )
    SELECT lcb_write.balance_minutes,
           (SELECT id FROM inserted) AS transaction_id
      FROM lcb_write
  `;

  if (!row) {
    // The lcb_write CTE refused: either the conflict-branch UPDATE WHERE
    // failed (post-deduct balance would go negative), or the SELECT WHERE
    // refused a first-write deduct against a missing LCB row.
    // No ledger row was written (the inserted CTE consumes lcb_write's
    // RETURNING, so it gets nothing).
    const [lcb] = await sql`
      SELECT balance_minutes
        FROM learner_credit_balances
       WHERE learner_id = ${learnerId} AND instructor_id = ${instructorId}
    `;
    return {
      ok: false,
      code: 'INSUFFICIENT_BALANCE',
      balanceMinutes: lcb ? lcb.balance_minutes : null,
      transactionId: null,
      instructorId,
    };
  }

  return {
    ok: true,
    balanceMinutes: row.balance_minutes,
    transactionId: row.transaction_id || null,
    instructorId,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// lockBalanceAdjustLCB — balance-only mutation, no ledger row
// ─────────────────────────────────────────────────────────────────────────────
// Used by the slot-purchase / offer net-zero add-then-deduct sites in
// webhook.js. Those paths INSERT a single 'slot_purchase' credit_transactions
// row themselves (carrying the Stripe session_id, payment_intent_id, fee, etc.)
// and then need to bump the balance by the lesson minutes and immediately
// bump it back — both writes are pure balance mutations, no audit row.
//
// Why this exists separately from lockBalanceAndMutate:
//   The helper above always writes a credit_transactions row alongside the
//   balance mutation. For slot-purchase webhook sites that already INSERT
//   their own 'slot_purchase' ledger row, routing the two net-zero balance
//   writes through it would produce 3 ledger rows per slot booking instead
//   of 1, breaking cron-payouts / cron-reconcile assumptions about
//   row-count-per-Stripe-payment.
//
// Behaviour:
//   - PHASE_2A_IMPLEMENTED = false → lock learner_users + write balance_minutes
//     (and optional credit_balance delta). Pre-2A behaviour, current prod.
//   - PHASE_2A_IMPLEMENTED = true  → lock LCB row + write LCB.balance_minutes.
//
// Net-zero pairing: this helper is designed to be called in matched pairs
// (one positive delta, one negative). The trigger fires after each, so the
// pooled balance flickers up and back. That's the same shape as today's
// raw UPDATEs; the trigger is the cleanup mechanism.
//
// Insufficient-balance: the deduct half of a net-zero pair can't go negative
// because the matching positive write just landed and the LCB lock prevents
// any other writer from draining the row between them. But the predicate is
// still belt-and-braces — if for any reason the row doesn't have enough, we
// return INSUFFICIENT_BALANCE and the caller logs / alerts.

async function lockBalanceAdjustLCB(sql, args) {
  if (!sql) throw new Error('sql client required');
  if (!args || typeof args !== 'object') throw new Error('lockBalanceAdjustLCB args required');

  const learnerId   = toPositiveInteger(args.learnerId, 'learnerId');
  const schoolId    = toPositiveInteger(args.schoolId || 1, 'schoolId');
  const delta       = Number(args.delta);
  if (!Number.isInteger(delta) || delta === 0) {
    throw new Error('delta must be a non-zero integer');
  }
  const creditsDelta   = Number.isInteger(args.creditsDelta) ? args.creditsDelta : 0;
  const allowOverdraft = Boolean(args.allowOverdraft);
  let instructorId     = toOptionalInteger(args.instructorId, 'instructorId');

  // ─── Pre-2A path ────────────────────────────────────────────────────────
  if (!PHASE_2A_IMPLEMENTED) {
    return lockBalanceAdjustPre2A({
      sql, learnerId, schoolId, delta, creditsDelta, allowOverdraft,
    });
  }

  const phase2A = process.env.PER_INSTRUCTOR_CREDITS_PHASE_2A === '1'
    || await hasPhase2ASchema(sql);
  if (!phase2A) {
    return lockBalanceAdjustPre2A({
      sql, learnerId, schoolId, delta, creditsDelta, allowOverdraft,
    });
  }

  if (instructorId == null) {
    console.warn('[_credit-grant] legacy_pre_cutover: missing instructor_id on lockBalanceAdjustLCB, routing to Fraser (id=1)');
    instructorId = 1;
  }

  return lockBalanceAdjustPhase2A({
    sql, learnerId, instructorId, schoolId, delta, allowOverdraft,
  });
}

async function lockBalanceAdjustPre2A({
  sql, learnerId, schoolId, delta, creditsDelta, allowOverdraft,
}) {
  const deductGuard = (delta < 0 && !allowOverdraft) ? -delta : null;

  const [row] = await sql`
    WITH locked AS (
      SELECT id, balance_minutes
        FROM learner_users
       WHERE id = ${learnerId}
         AND school_id = ${schoolId}
       FOR UPDATE
    )
    UPDATE learner_users lu
       SET balance_minutes = lu.balance_minutes + ${delta},
           credit_balance  = GREATEST(lu.credit_balance + ${creditsDelta}, 0)
     WHERE lu.id = ${learnerId}
       AND lu.school_id = ${schoolId}
       AND EXISTS (
         SELECT 1 FROM locked
         WHERE ${deductGuard === null}::boolean
            OR locked.balance_minutes >= ${deductGuard}
       )
    RETURNING lu.balance_minutes
  `;

  if (!row) {
    const [exists] = await sql`
      SELECT balance_minutes FROM learner_users WHERE id = ${learnerId} AND school_id = ${schoolId}
    `;
    if (!exists) {
      return { ok: false, code: 'LEARNER_NOT_FOUND', balanceMinutes: null };
    }
    return { ok: false, code: 'INSUFFICIENT_BALANCE', balanceMinutes: exists.balance_minutes };
  }
  return { ok: true, balanceMinutes: row.balance_minutes };
}

async function lockBalanceAdjustPhase2A({
  sql, learnerId, instructorId, schoolId, delta, allowOverdraft,
}) {
  // Balance-only mutation, no ledger row. SQL shape: INSERT ... ON CONFLICT
  // DO UPDATE on LCB, with delta baked directly into the values clauses.
  // See grantCreditsPhase2A header for the PG §7.8.4 reasoning.
  //
  // Deduct guard — two refusal paths, same shape as
  // lockBalanceAndMutatePhase2A (see GPT review of PR #176):
  //
  //   First-write deduct (no LCB row, isDeduct=true): SELECT WHERE refuses
  //     because EXISTS evaluates FALSE → INSERT attempts nothing → no
  //     CONFLICT branch → no side effect.
  //
  //   Existing-row deduct (LCB present, isDeduct=true): SELECT WHERE
  //     passes (EXISTS=TRUE) → INSERT attempts → ON CONFLICT fires →
  //     DO UPDATE WHERE post-deduct-non-negative gates the actual write.
  //     The DO UPDATE reads the row's current value under the conflict
  //     lock (PG ON CONFLICT DO UPDATE semantics), so concurrent deducts
  //     serialise correctly.
  //
  // Without the EXISTS-gated SELECT WHERE clause, a normal deduct against
  // an existing row would have `NOT $isDeduct = FALSE`, no row would feed
  // the INSERT, ON CONFLICT would never trigger, and the helper would
  // return INSUFFICIENT_BALANCE for any deduct path — breaking the
  // net-zero pairing used by webhook.js slot-purchase (positive +N then
  // matching -N).
  const isDeduct = delta < 0 && !allowOverdraft;

  const [row] = await sql`
    INSERT INTO learner_credit_balances
      (learner_id, instructor_id, school_id, balance_minutes)
    SELECT ${learnerId}, ${instructorId}, ${schoolId}, ${delta}
    WHERE NOT ${isDeduct}::boolean
       OR EXISTS (
            SELECT 1 FROM learner_credit_balances
             WHERE learner_id = ${learnerId}
               AND instructor_id = ${instructorId}
          )
    ON CONFLICT (learner_id, instructor_id) DO UPDATE
      SET balance_minutes = learner_credit_balances.balance_minutes + ${delta},
          updated_at = NOW()
      WHERE NOT ${isDeduct}::boolean
         OR learner_credit_balances.balance_minutes + ${delta} >= 0
    RETURNING learner_credit_balances.balance_minutes
  `;

  if (!row) {
    const [lcb] = await sql`
      SELECT balance_minutes
        FROM learner_credit_balances
       WHERE learner_id = ${learnerId} AND instructor_id = ${instructorId}
    `;
    return {
      ok: false,
      code: 'INSUFFICIENT_BALANCE',
      balanceMinutes: lcb ? lcb.balance_minutes : null,
      instructorId,
    };
  }
  return { ok: true, balanceMinutes: row.balance_minutes, instructorId };
}

module.exports = {
  grantCredits,
  grantCreditsPre2A,
  grantCreditsPhase2A,
  lockBalanceAndMutate,
  lockBalanceAdjustLCB,
  normalizeGrantArgs,
  hasPhase2ASchema,
  // Test-only.
  _resetPhaseDetectionForTests,
  _setPhase2AImplementedForTests,
};
