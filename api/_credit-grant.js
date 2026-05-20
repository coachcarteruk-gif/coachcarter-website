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
// EMERGENCY REVERT 2026-05-20 ~13:15 BST: a fourth-round GPT review
// surfaced a P1 in the Phase 2A SQL — per PG docs §7.8.4, all
// data-modifying CTEs in one WITH chain share the pre-statement
// snapshot. The outer `UPDATE learner_credit_balances WHERE ...` that
// filters by table columns (not by referencing the ensured CTE alias)
// cannot see the row ensured's INSERT just created. For a first-ever
// (learner, instructor) pair the UPDATE matches nothing and the
// balance write silently fails — even though the credit_transactions
// row got written. Stripe retries would then see the session as
// already processed and the learner's balance stays stuck at 0.
//
// Flipped this back to false to close the silent-failure window. A
// follow-up PR restructures the Phase 2A SQL to use
// INSERT ... ON CONFLICT DO UPDATE on learner_credit_balances itself
// (the only single-statement shape that gives correct first-write
// semantics under PG's CTE snapshot rules). Re-flips after that
// follow-up ships + deploys.
//
// Rollback story: revert this commit + run a Neon PITR restore (Free
// tier 6h window). Procedure documented in docs/credits-grandfather.md.
let PHASE_2A_IMPLEMENTED = false;

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
// PHASE-2A variant — single-statement CTE, instructor-scoped
// ─────────────────────────────────────────────────────────────────────────────
// Same atomicity guarantee as Pre-2A (everything inside the implicit
// transaction PG wraps each statement in), but the lock target is the
// learner_credit_balances(learner_id, instructor_id) row instead of
// learner_users(id), and the reconcile sums the ledger.
//
//   ensured   — INSERT ... ON CONFLICT DO UPDATE ... RETURNING. Materialises
//               an LCB row for this (learner_id, instructor_id) pair if
//               missing AND acquires a row-level exclusive lock that's
//               held until statement commit. ON CONFLICT DO UPDATE's lock
//               is equivalent to FOR UPDATE for our purposes — serialises
//               concurrent writers on the same row.
//
//               Why not ensured + separate locked CTE: data-modifying CTEs
//               in PG share one snapshot; a sibling CTE scanning LCB after
//               ensured's INSERT won't see the new row. First-ever writes
//               for a (learner, instructor) pair would silently fail. The
//               DO UPDATE pattern dodges this by returning the row directly
//               whether it was inserted or already existed. The no-op SET
//               clause (`updated_at = lcb.updated_at`) is the standard
//               trick to force RETURNING on the conflict branch.
//
//   inserted  — INSERT into credit_transactions. ON CONFLICT clauses cover
//               the three idempotency arbiters: stripe_session_id (partial),
//               stripe_payment_intent_id (partial), stripe_charge_id (partial).
//               Plan §Step 0 L165-177. The WHERE clause on the partial-index
//               arbiter is load-bearing — PG requires it for arbiter inference.
//               RETURNING (id, minutes) — caller adds the new minutes to LCB.
//
// The top-level UPDATE is `balance_minutes = ensured.balance_minutes +
// inserted.minutes`. This is a deliberate departure from the plan's
// "reconcile from ledger" wording (SUM(ct) − SUM(bcs) + SUM(csa)). That
// wording is the right shape for a periodic divergence-check (Step 4.5
// TODO below); it is the WRONG shape for an inline single-statement
// writer because PG's READ COMMITTED snapshot is taken at statement
// start, before the LCB row lock is acquired. A sibling table-scan on
// credit_transactions inside the same statement therefore can't see a
// concurrent transaction that committed while this statement was
// waiting on the LCB row lock. Two concurrent writes would each scan
// the pre-lock snapshot, each add their own minutes, and each overwrite
// LCB.balance_minutes with `pre_snapshot_sum + my_new`, losing the
// other writer's increment.
//
// The lock-then-running-total pattern (ensured.balance_minutes is read
// AFTER the row lock is acquired by ON CONFLICT DO UPDATE — that
// returns the post-conflict committed value) dodges the snapshot
// problem entirely. The locked balance is correct by construction;
// add your own delta to it. Duplicate Stripe retries: `inserted` is
// empty, delta is 0, LCB.balance_minutes is rewritten to its current
// value (no-op), alreadyProcessed = true. Exactly what we want.
//
// Step 4.5 TODO: add a divergence-check cron that compares
// learner_credit_balances.balance_minutes against the full ledger
// reconcile: SUM(credit_transactions.minutes)
// − SUM(booking_credit_sources.minutes_drawn)
// − SUM(credit_source_adjustments.minutes_adjusted). Inline writers
// treat LCB as the locked running total; the cron is the guardrail
// for drift.

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

  // The arbiter clause must be ON CONFLICT (stripe_session_id) WHERE
  // stripe_session_id IS NOT NULL — same load-bearing partial-index match
  // documented for Pre-2A above. The OR-chained alt arbiters cover the
  // payment_intent and charge unique indexes. We pick the session-id arbiter
  // because every webhook call carries one; PI / charge are belt-and-braces
  // for the rare path where session_id is missing but PI is known (reconcile).
  //
  // ON CONFLICT can only target a single arbiter per INSERT, so the
  // partial-index 23505 collisions on the other two unique indexes (PI,
  // charge) raise as exceptions and the caller swallows them just like the
  // Pre-2A path does in webhook.js handleCreditPurchase. The UPDATE below
  // then writes ensured.balance_minutes + inserted minutes (LCB-as-locked-
  // running-total per the module header — no inline ledger reconcile).
  const [row] = await sql`
    WITH ensured AS (
      INSERT INTO learner_credit_balances (learner_id, instructor_id, school_id, balance_minutes)
      VALUES (${learnerId}, ${instructorId}, ${schoolId}, 0)
      ON CONFLICT (learner_id, instructor_id) DO UPDATE
        SET updated_at = learner_credit_balances.updated_at
      RETURNING balance_minutes
    ),
    inserted AS (
      INSERT INTO credit_transactions
        (learner_id, instructor_id, school_id, type, credits, minutes,
         amount_pence, payment_method, stripe_session_id, stripe_fee_pence,
         stripe_payment_intent_id, stripe_charge_id,
         effective_rate_pence_per_minute, source, absorbed_by)
      SELECT
        ${learnerId}, ${instructorId}, ${schoolId}, 'purchase', ${credits}, ${minutes},
        ${amountPence}, ${paymentMethod}, ${sessionId}, ${stripeFeePence},
        ${paymentIntentId}, ${chargeId},
        ${effectiveRatePencePerMinute}, ${resolvedSource}, ${absorbedBy}
      FROM ensured
      ON CONFLICT (stripe_session_id) WHERE stripe_session_id IS NOT NULL DO NOTHING
      RETURNING id, minutes
    )
    UPDATE learner_credit_balances lcb
       SET balance_minutes = (SELECT balance_minutes FROM ensured)
                           + COALESCE((SELECT SUM(minutes)::int FROM inserted), 0),
           updated_at = NOW()
     WHERE lcb.learner_id = ${learnerId}
       AND lcb.instructor_id = ${instructorId}
       AND EXISTS (SELECT 1 FROM ensured)
    RETURNING
      lcb.balance_minutes,
      (SELECT id FROM inserted)                  AS transaction_id,
      ((SELECT id FROM inserted) IS NULL)        AS already_processed
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
  const deductGuard = (delta < 0 && !allowOverdraft) ? -delta : null;
  const resolvedSource = source || 'stripe';

  const [row] = await sql`
    WITH ensured AS (
      INSERT INTO learner_credit_balances (learner_id, instructor_id, school_id, balance_minutes)
      VALUES (${learnerId}, ${instructorId}, ${schoolId}, 0)
      ON CONFLICT (learner_id, instructor_id) DO UPDATE
        SET updated_at = learner_credit_balances.updated_at
      RETURNING id, balance_minutes
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
      FROM ensured
      WHERE ${deductGuard === null}::boolean
         OR ensured.balance_minutes >= ${deductGuard}
      RETURNING id, minutes
    )
    -- LCB as locked running total (see grantCreditsPhase2A header). The
    -- ensured CTE's RETURNING gives us the post-lock committed balance;
    -- add this writer's own delta from inserted. No ledger re-scan, no
    -- READ COMMITTED snapshot hazard.
    UPDATE learner_credit_balances lcb
       SET balance_minutes = (SELECT balance_minutes FROM ensured)
                           + COALESCE((SELECT SUM(minutes)::int FROM inserted), 0),
           updated_at = NOW()
     WHERE lcb.learner_id = ${learnerId}
       AND lcb.instructor_id = ${instructorId}
       AND EXISTS (SELECT 1 FROM inserted)
    RETURNING
      lcb.balance_minutes,
      (SELECT id FROM inserted) AS transaction_id
  `;

  if (!row) {
    // Disambiguate: LEARNER_NOT_FOUND (parent FK) vs INSUFFICIENT_BALANCE.
    // The LCB row exists by construction (ensured CTE) for any valid learner
    // — but the learner_credit_balances FK to learner_users would have raised
    // by now if the learner didn't exist. So a missing return-row here means
    // the deduct guard refused: INSUFFICIENT_BALANCE.
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
  const deductGuard = (delta < 0 && !allowOverdraft) ? -delta : null;

  const [row] = await sql`
    WITH ensured AS (
      INSERT INTO learner_credit_balances (learner_id, instructor_id, school_id, balance_minutes)
      VALUES (${learnerId}, ${instructorId}, ${schoolId}, 0)
      ON CONFLICT (learner_id, instructor_id) DO UPDATE
        SET updated_at = learner_credit_balances.updated_at
      RETURNING id, balance_minutes
    )
    UPDATE learner_credit_balances lcb
       SET balance_minutes = lcb.balance_minutes + ${delta},
           updated_at = NOW()
     WHERE lcb.learner_id = ${learnerId}
       AND lcb.instructor_id = ${instructorId}
       AND EXISTS (
         SELECT 1 FROM ensured
         WHERE ${deductGuard === null}::boolean
            OR ensured.balance_minutes >= ${deductGuard}
       )
    RETURNING lcb.balance_minutes
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
