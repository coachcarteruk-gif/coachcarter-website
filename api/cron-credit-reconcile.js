// Daily credit-divergence-check cron — runs 08:30 UTC.
//
// GET /api/cron-credit-reconcile
//   Authorization: Bearer ${CRON_SECRET}   (Vercel Cron sends this automatically)
//
// PURPOSE
// ──────────────────────────────────────────────────────────────────────────────
// Step 4.5 from PER-INSTRUCTOR-CREDITS-PLAN.md.
//
// Compare learner_credit_balances.balance_minutes against the source-of-truth
// ledger reconcile, per (learner_id, instructor_id) pair:
//
//   expected_balance_minutes
//     =  SUM(credit_transactions.minutes)                                          (always — credit purchases)
//      - SUM(lesson_bookings.minutes_deducted)
//             WHERE credit_returned = FALSE
//               AND booking has no booking_credit_sources row                       (always — un-attributed booking draws)
//      - SUM(booking_credit_sources.minutes_drawn) WHERE refunded_at IS NULL        (if BCS exists — attributed draws)
//      - SUM(credit_source_adjustments.minutes_adjusted)                            (if CSA exists — cash refunds, admin clawbacks)
//
// Drift = actual_lcb - expected. Any non-zero drift fires an operator alert.
//
// Why the lb.minutes_deducted term is load-bearing in EVERY mode
// ──────────────────────────────────────────────────────────────────────────────
// Booking deductions on the live writer path (api/slots.js#L1006) go through
// lockBalanceAdjustLCB, which mutates LCB but DOES NOT write a credit_transactions
// row (deliberate — see api/_credit-grant.js#L957 "balance-only mutation, no
// ledger row"). The deduction is recorded as lesson_bookings.minutes_deducted
// and reversed by toggling credit_returned = TRUE on ≥48h cancellation.
//
// Step 5's booking_credit_sources writer will start populating BCS rows at
// booking-creation time, but it does NOT backfill historical bookings (per
// PER-INSTRUCTOR-CREDITS-PLAN.md §Step 5). So historical bookings will live
// in lb.minutes_deducted forever; new bookings will live in BCS. The
// "booking has no BCS row" guard prevents double-counting once Step 5 ships.
//
// This is a READ-ONLY guardrail. It MUST NOT mutate learner_credit_balances,
// learner_users.balance_minutes, credit_transactions, booking_credit_sources,
// or credit_source_adjustments. It reads and alerts only. Auto-correction is
// deliberately deferred per the franchise-model "year one is human" principle.
//
// SCHEMA-AWARENESS
// ──────────────────────────────────────────────────────────────────────────────
// CoachCarter is in a staged credits rollout. Main has PHASE_2A_IMPLEMENTED=
// true, but Step 5 tables (booking_credit_sources, credit_source_adjustments)
// may not exist yet. The cron probes information_schema at the start of each
// run and picks one of three reconcile formulas:
//
//   schema_mode = 'ct_only'         BCS absent, CSA absent (current main state)
//   schema_mode = 'ct_plus_bcs'     BCS present, CSA absent
//   schema_mode = 'full'            BCS present, CSA present (Step 5.5 ship)
//
// One impossible state — CSA present without BCS — hard-fails with an explicit
// alert. The plan lands BCS and CSA together (Step 2 of Step 5), so the only
// way to observe this is a botched migration, which is worth waking the
// operator over rather than silently picking a mode.
//
// BCS refund semantics
// ──────────────────────────────────────────────────────────────────────────────
// Every reconcile expression in PER-INSTRUCTOR-CREDITS-PLAN.md uses
// `FILTER (WHERE bcs.refunded_at IS NULL)` for the BCS deduction (see plan
// lines 191–199, 916, and the "Balance vs sources" invariant on line 1156).
// Refunded BCS rows have returned their minutes to the source, so they are
// NOT counted as drawn. CSA rows have no refunded_at concept — every row in
// credit_source_adjustments counts toward the deduction.
//
// FULL OUTER JOIN
// ──────────────────────────────────────────────────────────────────────────────
// The reconcile uses FULL OUTER JOIN between the ledger CTE and
// learner_credit_balances so both directions of "data exists on one side
// only" surface as drift:
//
//   • Phantom LCB:   LCB row exists with non-zero balance, no CT rows for the
//                    pair. Drift = +balance.
//   • Missing LCB:   CT rows exist with non-zero net minutes, no LCB row.
//                    Drift = -expected.
//
// Pre-2A pooled credit_transactions rows (instructor_id IS NULL) are excluded
// from the ledger CTE — they belong to the legacy pooled balance, not a
// per-pair scope.

const { sendAlertEmail } = require('./_error-alert');
const { verifyCronAuth } = require('./_auth');
const { withCronLock } = require('./_cron-lock');

const SCHOOL_ID = 1; // CoachCarter — only school using per-instructor credits at the cutover.

// Hard cap on per-pair detail rows included in the alert email body. If drift
// is wider than this, the email summarises and points at the manual diagnostic
// SQL. Prevents a corruption event from generating a multi-megabyte email.
const ALERT_EMAIL_MAX_PAIRS = 20;

// ─────────────────────────────────────────────────────────────────────────────
// Schema probe — picks which reconcile formula to use this run.
// ─────────────────────────────────────────────────────────────────────────────
async function probeSchemaMode(sql) {
  const [row] = await sql`
    SELECT
      EXISTS (
        SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'booking_credit_sources'
      ) AS has_bcs,
      EXISTS (
        SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'credit_source_adjustments'
      ) AS has_csa
  `;
  const hasBcs = !!row.has_bcs;
  const hasCsa = !!row.has_csa;

  if (hasBcs && hasCsa)   return { mode: 'full',          has_bcs: true,  has_csa: true  };
  if (hasBcs && !hasCsa)  return { mode: 'ct_plus_bcs',   has_bcs: true,  has_csa: false };
  if (!hasBcs && !hasCsa) return { mode: 'ct_only',       has_bcs: false, has_csa: false };
  // Impossible per plan: CSA without BCS. Step 2 of Step 5 lands them together.
  return { mode: 'half_migrated_csa_without_bcs', has_bcs: false, has_csa: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reconcile query builders.
//
// Each returns the full list of (learner_id, instructor_id) drift rows.
// They differ only in which CTE columns are subtracted. We pre-build them as
// three separate functions rather than templating into one query, because
// referring to a missing table inside a CTE — even unreached — would fail
// pre-Step-5 with a relation-does-not-exist error.
// ─────────────────────────────────────────────────────────────────────────────

async function reconcileCtOnly(sql) {
  // BCS absent (current main state). Booking deductions come exclusively from
  // lesson_bookings.minutes_deducted. NOT IN (SELECT booking_id FROM
  // booking_credit_sources) is omitted because the table doesn't exist —
  // every active booking with minutes_deducted contributes to the deduction.
  return sql`
    WITH purchases AS (
      SELECT
        ct.learner_id,
        ct.instructor_id,
        COALESCE(SUM(ct.minutes), 0)::int AS minutes
      FROM credit_transactions ct
      WHERE ct.school_id = ${SCHOOL_ID}
        AND ct.instructor_id IS NOT NULL    -- exclude Pre-2A pooled rows
      GROUP BY ct.learner_id, ct.instructor_id
    ),
    booking_draws AS (
      SELECT
        lb.learner_id,
        lb.instructor_id,
        COALESCE(SUM(lb.minutes_deducted), 0)::int AS minutes
      FROM lesson_bookings lb
      WHERE lb.school_id = ${SCHOOL_ID}
        AND lb.credit_returned = FALSE
        AND lb.minutes_deducted IS NOT NULL
        AND lb.minutes_deducted > 0
      GROUP BY lb.learner_id, lb.instructor_id
    ),
    ledger AS (
      SELECT
        COALESCE(p.learner_id,    bd.learner_id)    AS learner_id,
        COALESCE(p.instructor_id, bd.instructor_id) AS instructor_id,
          COALESCE(p.minutes,  0)
        - COALESCE(bd.minutes, 0)                   AS expected_balance_minutes
      FROM purchases p
      FULL OUTER JOIN booking_draws bd
        ON  bd.learner_id    = p.learner_id
        AND bd.instructor_id = p.instructor_id
    )
    SELECT
      COALESCE(lcb.learner_id,    l.learner_id)    AS learner_id,
      COALESCE(lcb.instructor_id, l.instructor_id) AS instructor_id,
      COALESCE(lcb.balance_minutes, 0)             AS actual_lcb_balance_minutes,
      COALESCE(l.expected_balance_minutes, 0)      AS computed_ledger_balance_minutes,
      COALESCE(lcb.balance_minutes, 0)
        - COALESCE(l.expected_balance_minutes, 0)  AS drift_minutes
    FROM ledger l
    FULL OUTER JOIN learner_credit_balances lcb
      ON  lcb.learner_id    = l.learner_id
      AND lcb.instructor_id = l.instructor_id
    WHERE (lcb.school_id IS NULL OR lcb.school_id = ${SCHOOL_ID})
      AND COALESCE(lcb.balance_minutes, 0)
            IS DISTINCT FROM COALESCE(l.expected_balance_minutes, 0)
      -- Conditional grandfather suppression (Plan A). Only suppress rows
      -- that are legacy-origin AND have a clean per-pair ledger; the
      -- moment the ledger goes non-zero we re-flag regardless of the
      -- grandfather sigil. See docs/credits-grandfather.md "Mechanical
      -- grandfathering" for the truth table.
      AND (lcb.grandfathered_at IS NULL
           OR COALESCE(l.expected_balance_minutes, 0) IS DISTINCT FROM 0)
    ORDER BY ABS(COALESCE(lcb.balance_minutes, 0)
                 - COALESCE(l.expected_balance_minutes, 0)) DESC,
             learner_id, instructor_id
  `;
}

async function reconcileCtPlusBcs(sql) {
  // BCS present, CSA absent. Mixed deduction sourcing:
  //   • bookings WITH a BCS row → counted via SUM(active BCS minutes_drawn)
  //   • bookings WITHOUT a BCS row → counted via SUM(lb.minutes_deducted)
  // The booking_draws CTE filters to lb.id NOT IN (BCS booking_ids) so historical
  // bookings predating Step 5 (no BCS row) and any future writer regression
  // (booking inserted but BCS row missing) both get caught.
  return sql`
    WITH bcs_per_pair AS (
      SELECT
        ct.learner_id,
        ct.instructor_id,
        SUM(bcs.minutes_drawn)::int AS minutes
      FROM booking_credit_sources bcs
      JOIN credit_transactions ct ON ct.id = bcs.credit_transaction_id
      WHERE bcs.refunded_at IS NULL
        AND ct.school_id = ${SCHOOL_ID}
        AND ct.instructor_id IS NOT NULL
      GROUP BY ct.learner_id, ct.instructor_id
    ),
    purchases AS (
      SELECT
        ct.learner_id,
        ct.instructor_id,
        COALESCE(SUM(ct.minutes), 0)::int AS minutes
      FROM credit_transactions ct
      WHERE ct.school_id = ${SCHOOL_ID}
        AND ct.instructor_id IS NOT NULL
      GROUP BY ct.learner_id, ct.instructor_id
    ),
    booking_draws AS (
      SELECT
        lb.learner_id,
        lb.instructor_id,
        COALESCE(SUM(lb.minutes_deducted), 0)::int AS minutes
      FROM lesson_bookings lb
      WHERE lb.school_id = ${SCHOOL_ID}
        AND lb.credit_returned = FALSE
        AND lb.minutes_deducted IS NOT NULL
        AND lb.minutes_deducted > 0
        AND NOT EXISTS (
          SELECT 1 FROM booking_credit_sources bcs2
           WHERE bcs2.booking_id = lb.id
        )
      GROUP BY lb.learner_id, lb.instructor_id
    ),
    ledger AS (
      SELECT
        COALESCE(p.learner_id, bd.learner_id, b.learner_id)             AS learner_id,
        COALESCE(p.instructor_id, bd.instructor_id, b.instructor_id)    AS instructor_id,
          COALESCE(p.minutes,  0)
        - COALESCE(bd.minutes, 0)
        - COALESCE(b.minutes,  0)                                       AS expected_balance_minutes
      FROM purchases p
      FULL OUTER JOIN booking_draws bd
        ON  bd.learner_id    = p.learner_id
        AND bd.instructor_id = p.instructor_id
      FULL OUTER JOIN bcs_per_pair b
        ON  b.learner_id    = COALESCE(p.learner_id, bd.learner_id)
        AND b.instructor_id = COALESCE(p.instructor_id, bd.instructor_id)
    )
    SELECT
      COALESCE(lcb.learner_id,    l.learner_id)    AS learner_id,
      COALESCE(lcb.instructor_id, l.instructor_id) AS instructor_id,
      COALESCE(lcb.balance_minutes, 0)             AS actual_lcb_balance_minutes,
      COALESCE(l.expected_balance_minutes, 0)      AS computed_ledger_balance_minutes,
      COALESCE(lcb.balance_minutes, 0)
        - COALESCE(l.expected_balance_minutes, 0)  AS drift_minutes
    FROM ledger l
    FULL OUTER JOIN learner_credit_balances lcb
      ON  lcb.learner_id    = l.learner_id
      AND lcb.instructor_id = l.instructor_id
    WHERE (lcb.school_id IS NULL OR lcb.school_id = ${SCHOOL_ID})
      AND COALESCE(lcb.balance_minutes, 0)
            IS DISTINCT FROM COALESCE(l.expected_balance_minutes, 0)
      -- Conditional grandfather suppression (Plan A) — see reconcileCtOnly.
      AND (lcb.grandfathered_at IS NULL
           OR COALESCE(l.expected_balance_minutes, 0) IS DISTINCT FROM 0)
    ORDER BY ABS(COALESCE(lcb.balance_minutes, 0)
                 - COALESCE(l.expected_balance_minutes, 0)) DESC,
             learner_id, instructor_id
  `;
}

async function reconcileFull(sql) {
  // BCS and CSA both present. Adds CSA cash-refund / admin-clawback deductions
  // on top of the ct_plus_bcs formula. Same mixed-sourcing rule for bookings:
  // attributed via BCS or un-attributed via lb.minutes_deducted, never both.
  return sql`
    WITH bcs_per_pair AS (
      SELECT
        ct.learner_id,
        ct.instructor_id,
        SUM(bcs.minutes_drawn)::int AS minutes
      FROM booking_credit_sources bcs
      JOIN credit_transactions ct ON ct.id = bcs.credit_transaction_id
      WHERE bcs.refunded_at IS NULL
        AND ct.school_id = ${SCHOOL_ID}
        AND ct.instructor_id IS NOT NULL
      GROUP BY ct.learner_id, ct.instructor_id
    ),
    csa_per_pair AS (
      SELECT
        ct.learner_id,
        ct.instructor_id,
        SUM(csa.minutes_adjusted)::int AS minutes
      FROM credit_source_adjustments csa
      JOIN credit_transactions ct ON ct.id = csa.credit_transaction_id
      WHERE ct.school_id = ${SCHOOL_ID}
        AND ct.instructor_id IS NOT NULL
      GROUP BY ct.learner_id, ct.instructor_id
    ),
    purchases AS (
      SELECT
        ct.learner_id,
        ct.instructor_id,
        COALESCE(SUM(ct.minutes), 0)::int AS minutes
      FROM credit_transactions ct
      WHERE ct.school_id = ${SCHOOL_ID}
        AND ct.instructor_id IS NOT NULL
      GROUP BY ct.learner_id, ct.instructor_id
    ),
    booking_draws AS (
      SELECT
        lb.learner_id,
        lb.instructor_id,
        COALESCE(SUM(lb.minutes_deducted), 0)::int AS minutes
      FROM lesson_bookings lb
      WHERE lb.school_id = ${SCHOOL_ID}
        AND lb.credit_returned = FALSE
        AND lb.minutes_deducted IS NOT NULL
        AND lb.minutes_deducted > 0
        AND NOT EXISTS (
          SELECT 1 FROM booking_credit_sources bcs2
           WHERE bcs2.booking_id = lb.id
        )
      GROUP BY lb.learner_id, lb.instructor_id
    ),
    all_pairs AS (
      SELECT learner_id, instructor_id FROM purchases
      UNION
      SELECT learner_id, instructor_id FROM booking_draws
      UNION
      SELECT learner_id, instructor_id FROM bcs_per_pair
      UNION
      SELECT learner_id, instructor_id FROM csa_per_pair
    ),
    ledger AS (
      SELECT
        ap.learner_id,
        ap.instructor_id,
          COALESCE(p.minutes,  0)
        - COALESCE(bd.minutes, 0)
        - COALESCE(b.minutes,  0)
        - COALESCE(c.minutes,  0)                              AS expected_balance_minutes
      FROM all_pairs ap
      LEFT JOIN purchases     p  ON p.learner_id  = ap.learner_id AND p.instructor_id  = ap.instructor_id
      LEFT JOIN booking_draws bd ON bd.learner_id = ap.learner_id AND bd.instructor_id = ap.instructor_id
      LEFT JOIN bcs_per_pair  b  ON b.learner_id  = ap.learner_id AND b.instructor_id  = ap.instructor_id
      LEFT JOIN csa_per_pair  c  ON c.learner_id  = ap.learner_id AND c.instructor_id  = ap.instructor_id
    )
    SELECT
      COALESCE(lcb.learner_id,    l.learner_id)    AS learner_id,
      COALESCE(lcb.instructor_id, l.instructor_id) AS instructor_id,
      COALESCE(lcb.balance_minutes, 0)             AS actual_lcb_balance_minutes,
      COALESCE(l.expected_balance_minutes, 0)      AS computed_ledger_balance_minutes,
      COALESCE(lcb.balance_minutes, 0)
        - COALESCE(l.expected_balance_minutes, 0)  AS drift_minutes
    FROM ledger l
    FULL OUTER JOIN learner_credit_balances lcb
      ON  lcb.learner_id    = l.learner_id
      AND lcb.instructor_id = l.instructor_id
    WHERE (lcb.school_id IS NULL OR lcb.school_id = ${SCHOOL_ID})
      AND COALESCE(lcb.balance_minutes, 0)
            IS DISTINCT FROM COALESCE(l.expected_balance_minutes, 0)
      -- Conditional grandfather suppression (Plan A) — see reconcileCtOnly.
      AND (lcb.grandfathered_at IS NULL
           OR COALESCE(l.expected_balance_minutes, 0) IS DISTINCT FROM 0)
    ORDER BY ABS(COALESCE(lcb.balance_minutes, 0)
                 - COALESCE(l.expected_balance_minutes, 0)) DESC,
             learner_id, instructor_id
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
// Grandfather suppression counters — Plan A.
//
// Each function returns COUNT(*) of LCB rows that:
//   • have grandfathered_at IS NOT NULL (legacy-origin), AND
//   • would have appeared in the corresponding reconcile's drift output if
//     the suppression predicate were dropped — i.e. lcb.balance_minutes
//     IS DISTINCT FROM expected_balance_minutes for the same pair, AND
//     expected_balance_minutes = 0 (the suppression branch's pre-condition).
//
// The "expected = 0" branch is computed directly here, mirroring each
// reconcile mode's ledger arithmetic, not by subtracting the cron's drift
// count from a hypothetical un-suppressed count. Direct computation keeps
// the semantics legible: this is "rows we silenced".
// ─────────────────────────────────────────────────────────────────────────────

async function countGrandfatheredSuppressedCtOnly(sql) {
  const [row] = await sql`
    WITH purchases AS (
      SELECT ct.learner_id, ct.instructor_id,
             COALESCE(SUM(ct.minutes), 0)::int AS minutes
        FROM credit_transactions ct
       WHERE ct.school_id = ${SCHOOL_ID}
         AND ct.instructor_id IS NOT NULL
       GROUP BY ct.learner_id, ct.instructor_id
    ),
    booking_draws AS (
      SELECT lb.learner_id, lb.instructor_id,
             COALESCE(SUM(lb.minutes_deducted), 0)::int AS minutes
        FROM lesson_bookings lb
       WHERE lb.school_id = ${SCHOOL_ID}
         AND lb.credit_returned = FALSE
         AND lb.minutes_deducted IS NOT NULL
         AND lb.minutes_deducted > 0
       GROUP BY lb.learner_id, lb.instructor_id
    )
    SELECT COUNT(*)::int AS n
      FROM learner_credit_balances lcb
      LEFT JOIN purchases p
        ON p.learner_id = lcb.learner_id AND p.instructor_id = lcb.instructor_id
      LEFT JOIN booking_draws bd
        ON bd.learner_id = lcb.learner_id AND bd.instructor_id = lcb.instructor_id
     WHERE lcb.school_id = ${SCHOOL_ID}
       AND lcb.grandfathered_at IS NOT NULL
       AND (COALESCE(p.minutes, 0) - COALESCE(bd.minutes, 0)) = 0
       AND COALESCE(lcb.balance_minutes, 0) IS DISTINCT FROM 0
  `;
  return row.n || 0;
}

async function countGrandfatheredSuppressedCtPlusBcs(sql) {
  const [row] = await sql`
    WITH purchases AS (
      SELECT ct.learner_id, ct.instructor_id,
             COALESCE(SUM(ct.minutes), 0)::int AS minutes
        FROM credit_transactions ct
       WHERE ct.school_id = ${SCHOOL_ID}
         AND ct.instructor_id IS NOT NULL
       GROUP BY ct.learner_id, ct.instructor_id
    ),
    booking_draws AS (
      SELECT lb.learner_id, lb.instructor_id,
             COALESCE(SUM(lb.minutes_deducted), 0)::int AS minutes
        FROM lesson_bookings lb
       WHERE lb.school_id = ${SCHOOL_ID}
         AND lb.credit_returned = FALSE
         AND lb.minutes_deducted IS NOT NULL
         AND lb.minutes_deducted > 0
         AND NOT EXISTS (
           SELECT 1 FROM booking_credit_sources bcs2 WHERE bcs2.booking_id = lb.id
         )
       GROUP BY lb.learner_id, lb.instructor_id
    ),
    bcs_per_pair AS (
      SELECT ct.learner_id, ct.instructor_id,
             SUM(bcs.minutes_drawn)::int AS minutes
        FROM booking_credit_sources bcs
        JOIN credit_transactions ct ON ct.id = bcs.credit_transaction_id
       WHERE bcs.refunded_at IS NULL
         AND ct.school_id = ${SCHOOL_ID}
         AND ct.instructor_id IS NOT NULL
       GROUP BY ct.learner_id, ct.instructor_id
    )
    SELECT COUNT(*)::int AS n
      FROM learner_credit_balances lcb
      LEFT JOIN purchases p
        ON p.learner_id = lcb.learner_id AND p.instructor_id = lcb.instructor_id
      LEFT JOIN booking_draws bd
        ON bd.learner_id = lcb.learner_id AND bd.instructor_id = lcb.instructor_id
      LEFT JOIN bcs_per_pair b
        ON b.learner_id = lcb.learner_id AND b.instructor_id = lcb.instructor_id
     WHERE lcb.school_id = ${SCHOOL_ID}
       AND lcb.grandfathered_at IS NOT NULL
       AND ( COALESCE(p.minutes, 0)
           - COALESCE(bd.minutes, 0)
           - COALESCE(b.minutes,  0) ) = 0
       AND COALESCE(lcb.balance_minutes, 0) IS DISTINCT FROM 0
  `;
  return row.n || 0;
}

async function countGrandfatheredSuppressedFull(sql) {
  const [row] = await sql`
    WITH purchases AS (
      SELECT ct.learner_id, ct.instructor_id,
             COALESCE(SUM(ct.minutes), 0)::int AS minutes
        FROM credit_transactions ct
       WHERE ct.school_id = ${SCHOOL_ID}
         AND ct.instructor_id IS NOT NULL
       GROUP BY ct.learner_id, ct.instructor_id
    ),
    booking_draws AS (
      SELECT lb.learner_id, lb.instructor_id,
             COALESCE(SUM(lb.minutes_deducted), 0)::int AS minutes
        FROM lesson_bookings lb
       WHERE lb.school_id = ${SCHOOL_ID}
         AND lb.credit_returned = FALSE
         AND lb.minutes_deducted IS NOT NULL
         AND lb.minutes_deducted > 0
         AND NOT EXISTS (
           SELECT 1 FROM booking_credit_sources bcs2 WHERE bcs2.booking_id = lb.id
         )
       GROUP BY lb.learner_id, lb.instructor_id
    ),
    bcs_per_pair AS (
      SELECT ct.learner_id, ct.instructor_id,
             SUM(bcs.minutes_drawn)::int AS minutes
        FROM booking_credit_sources bcs
        JOIN credit_transactions ct ON ct.id = bcs.credit_transaction_id
       WHERE bcs.refunded_at IS NULL
         AND ct.school_id = ${SCHOOL_ID}
         AND ct.instructor_id IS NOT NULL
       GROUP BY ct.learner_id, ct.instructor_id
    ),
    csa_per_pair AS (
      SELECT ct.learner_id, ct.instructor_id,
             SUM(csa.minutes_adjusted)::int AS minutes
        FROM credit_source_adjustments csa
        JOIN credit_transactions ct ON ct.id = csa.credit_transaction_id
       WHERE ct.school_id = ${SCHOOL_ID}
         AND ct.instructor_id IS NOT NULL
       GROUP BY ct.learner_id, ct.instructor_id
    )
    SELECT COUNT(*)::int AS n
      FROM learner_credit_balances lcb
      LEFT JOIN purchases p
        ON p.learner_id = lcb.learner_id AND p.instructor_id = lcb.instructor_id
      LEFT JOIN booking_draws bd
        ON bd.learner_id = lcb.learner_id AND bd.instructor_id = lcb.instructor_id
      LEFT JOIN bcs_per_pair b
        ON b.learner_id = lcb.learner_id AND b.instructor_id = lcb.instructor_id
      LEFT JOIN csa_per_pair c
        ON c.learner_id = lcb.learner_id AND c.instructor_id = lcb.instructor_id
     WHERE lcb.school_id = ${SCHOOL_ID}
       AND lcb.grandfathered_at IS NOT NULL
       AND ( COALESCE(p.minutes,  0)
           - COALESCE(bd.minutes, 0)
           - COALESCE(b.minutes,  0)
           - COALESCE(c.minutes,  0) ) = 0
       AND COALESCE(lcb.balance_minutes, 0) IS DISTINCT FROM 0
  `;
  return row.n || 0;
}

// Total pair count for the scanned scope, for the response payload. Unions
// across every table the reconcile considers (LCB, credit_transactions,
// lesson_bookings) so the count reflects the actual analytical universe.
async function countPairsScanned(sql) {
  const [row] = await sql`
    WITH all_pairs AS (
      SELECT learner_id, instructor_id FROM learner_credit_balances WHERE school_id = ${SCHOOL_ID}
      UNION
      SELECT learner_id, instructor_id FROM credit_transactions
       WHERE school_id = ${SCHOOL_ID} AND instructor_id IS NOT NULL
      UNION
      SELECT learner_id, instructor_id FROM lesson_bookings
       WHERE school_id = ${SCHOOL_ID}
         AND minutes_deducted IS NOT NULL
         AND minutes_deducted > 0
    )
    SELECT COUNT(*)::int AS n FROM all_pairs
  `;
  return row.n || 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Alert email composition. Capped at ALERT_EMAIL_MAX_PAIRS rows; the tail
// gets summarised. No payment intent IDs, no Stripe identifiers — those live
// in the manual diagnostic SQL the operator pulls separately.
// ─────────────────────────────────────────────────────────────────────────────
async function buildAlertEmail(sql, schemaMode, driftRows, capturedAt) {
  const totalDrift = driftRows.length;
  const shown = driftRows.slice(0, ALERT_EMAIL_MAX_PAIRS);
  const overflow = totalDrift - shown.length;

  // Fetch learner name+email per shown pair, plus the 3 most recent CT rows.
  const shownLearnerIds = [...new Set(shown.map(r => r.learner_id).filter(x => x != null))];
  let learnersById = {};
  if (shownLearnerIds.length) {
    const rows = await sql`
      SELECT id, name, email
        FROM learner_users
       WHERE id = ANY(${shownLearnerIds})
    `;
    for (const r of rows) learnersById[r.id] = r;
  }

  // 3 most recent ct rows per (learner, instructor) for shown pairs.
  const recentByPair = {};
  for (const r of shown) {
    if (r.learner_id == null || r.instructor_id == null) continue;
    const key = `${r.learner_id}:${r.instructor_id}`;
    const recents = await sql`
      SELECT id, type, minutes, created_at
        FROM credit_transactions
       WHERE learner_id    = ${r.learner_id}
         AND instructor_id = ${r.instructor_id}
         AND school_id     = ${SCHOOL_ID}
       ORDER BY created_at DESC, id DESC
       LIMIT 3
    `;
    recentByPair[key] = recents;
  }

  const subject =
    `⚠️ Credit divergence — ${totalDrift} pair(s) [schema_mode=${schemaMode}]`;

  const lines = [];
  lines.push(`Credit divergence detected on ${capturedAt.toISOString()}`);
  lines.push(`Schema mode: ${schemaMode}`);
  lines.push(`Drift pairs: ${totalDrift}${overflow > 0 ? ` (showing first ${shown.length})` : ''}`);
  lines.push('');
  for (const r of shown) {
    const learner = learnersById[r.learner_id] || {};
    const key = `${r.learner_id}:${r.instructor_id}`;
    const recents = recentByPair[key] || [];
    lines.push(`  • learner_id=${r.learner_id} instructor_id=${r.instructor_id}`);
    lines.push(`      ${learner.name || '(no name)'} <${learner.email || '(no email)'}>`);
    lines.push(`      actual_lcb=${r.actual_lcb_balance_minutes}min  computed=${r.computed_ledger_balance_minutes}min  drift=${r.drift_minutes}min`);
    if (recents.length) {
      lines.push(`      recent ct rows:`);
      for (const ct of recents) {
        const created = new Date(ct.created_at).toISOString().slice(0, 19).replace('T', ' ');
        lines.push(`        • ct#${ct.id} ${ct.type} ${ct.minutes >= 0 ? '+' : ''}${ct.minutes}min @ ${created}`);
      }
    } else {
      lines.push(`      recent ct rows: (none)`);
    }
    lines.push('');
  }
  if (overflow > 0) {
    lines.push(`  … and ${overflow} more pair(s). Run db/diagnostics/cron-credit-reconcile-manual.sql for the full list.`);
    lines.push('');
  }
  lines.push(`This is a read-only guardrail. No data has been mutated.`);
  lines.push(`Investigate manually before correcting LCB. See db/diagnostics/hotfix-177-post-deploy-audit.sql for the correction template.`);

  const text = lines.join('\n');

  const rowsHtml = shown.map(r => {
    const learner = learnersById[r.learner_id] || {};
    const key = `${r.learner_id}:${r.instructor_id}`;
    const recents = recentByPair[key] || [];
    const recentRows = recents.length
      ? recents.map(ct => {
          const created = new Date(ct.created_at).toISOString().slice(0, 19).replace('T', ' ');
          const sign = ct.minutes >= 0 ? '+' : '';
          return `<div style="font-family:monospace;font-size:12px;color:#555;">ct#${ct.id} ${escapeHtml(ct.type)} ${sign}${ct.minutes}min @ ${created}</div>`;
        }).join('')
      : `<div style="font-family:monospace;font-size:12px;color:#999;">(no recent ct rows)</div>`;
    return `
      <tr style="border-top:1px solid #eee;">
        <td style="padding:8px 12px;vertical-align:top;">
          <div><b>learner_id=${r.learner_id}</b> instructor_id=${r.instructor_id}</div>
          <div style="color:#666;font-size:13px;">${escapeHtml(learner.name || '(no name)')} &lt;${escapeHtml(learner.email || '(no email)')}&gt;</div>
        </td>
        <td style="padding:8px 12px;vertical-align:top;text-align:right;font-family:monospace;">${r.actual_lcb_balance_minutes}</td>
        <td style="padding:8px 12px;vertical-align:top;text-align:right;font-family:monospace;">${r.computed_ledger_balance_minutes}</td>
        <td style="padding:8px 12px;vertical-align:top;text-align:right;font-family:monospace;color:${r.drift_minutes > 0 ? '#b45309' : '#1d4ed8'};"><b>${r.drift_minutes > 0 ? '+' : ''}${r.drift_minutes}</b></td>
        <td style="padding:8px 12px;vertical-align:top;">${recentRows}</td>
      </tr>
    `;
  }).join('');

  const overflowHtml = overflow > 0
    ? `<p style="color:#666;">… and ${overflow} more pair(s). Run <code>db/diagnostics/cron-credit-reconcile-manual.sql</code> for the full list.</p>`
    : '';

  const html = `
    <h3 style="color:#b45309;">Credit divergence — ${totalDrift} (learner, instructor) pair(s)</h3>
    <p style="font-family:monospace;font-size:13px;">
      schema_mode: <b>${escapeHtml(schemaMode)}</b><br/>
      captured_at: ${capturedAt.toISOString()}<br/>
      shown: ${shown.length} / ${totalDrift}
    </p>
    <table style="border-collapse:collapse;font-size:13px;">
      <thead>
        <tr style="background:#f5f5f5;">
          <th style="padding:8px 12px;text-align:left;">Pair</th>
          <th style="padding:8px 12px;text-align:right;">LCB</th>
          <th style="padding:8px 12px;text-align:right;">Ledger</th>
          <th style="padding:8px 12px;text-align:right;">Drift</th>
          <th style="padding:8px 12px;text-align:left;">Recent ct rows</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
    ${overflowHtml}
    <p style="color:#666;font-size:12px;">This is a read-only guardrail. No data has been mutated. See <code>db/diagnostics/hotfix-177-post-deploy-audit.sql</code> for the correction template.</p>
  `;

  return { subject, text, html };
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─────────────────────────────────────────────────────────────────────────────
// Core orchestration. Exported for the integration test to call directly
// without going through HTTP. The HTTP handler below wraps this in
// verifyCronAuth + withCronLock.
//
// Returns the JSON body the handler responds with. Does not send any HTTP
// response itself.
// ─────────────────────────────────────────────────────────────────────────────
async function runDivergenceCheck(sql, { now = new Date(), sendAlerts = true } = {}) {
  const schema = await probeSchemaMode(sql);

  // Impossible state — alert and refuse to reconcile. Returns ok:false but
  // the HTTP wrapper still uses 200 to stop Vercel retrying the same alert.
  if (schema.mode === 'half_migrated_csa_without_bcs') {
    if (sendAlerts) {
      sendAlertEmail({
        subject: `🚨 Credit reconcile cron — half-migrated schema (CSA without BCS)`,
        text: [
          `The credit reconcile cron probed information_schema and found`,
          `credit_source_adjustments present, but booking_credit_sources missing.`,
          ``,
          `Per PER-INSTRUCTOR-CREDITS-PLAN.md, Step 2 of Step 5 lands both tables`,
          `together. This state should be unreachable via the planned migration.`,
          ``,
          `Cron did NOT run a reconcile this cycle. Investigate the migration`,
          `state before next firing (08:30 UTC daily).`,
        ].join('\n'),
        html: `
          <h3 style="color:#b91c1c;">Credit reconcile cron — half-migrated schema</h3>
          <p><code>credit_source_adjustments</code> exists but <code>booking_credit_sources</code> is missing.</p>
          <p>Per <code>PER-INSTRUCTOR-CREDITS-PLAN.md</code>, Step 2 of Step 5 lands both tables together — this state should be unreachable via the planned migration.</p>
          <p><b>The reconcile did NOT run this cycle.</b> Investigate the migration state before the next firing.</p>
        `
      });
    }
    return {
      ok: false,
      error: 'schema_inconsistent',
      schema_mode: schema.mode,
      has_bcs: schema.has_bcs,
      has_csa: schema.has_csa,
      ran_at: now.toISOString(),
      pairs_scanned: 0,
      drift_count: 0,
      alert_sent: !!sendAlerts,
    };
  }

  // Pick the reconcile formula matching the live schema state. Each branch
  // refers ONLY to tables we've just confirmed exist, so pre-Step-5 runs
  // never reference booking_credit_sources or credit_source_adjustments.
  let driftRows;
  let grandfatheredCount;
  if (schema.mode === 'full') {
    driftRows          = await reconcileFull(sql);
    grandfatheredCount = await countGrandfatheredSuppressedFull(sql);
  } else if (schema.mode === 'ct_plus_bcs') {
    driftRows          = await reconcileCtPlusBcs(sql);
    grandfatheredCount = await countGrandfatheredSuppressedCtPlusBcs(sql);
  } else {
    driftRows          = await reconcileCtOnly(sql);
    grandfatheredCount = await countGrandfatheredSuppressedCtOnly(sql);
  }

  const pairsScanned = await countPairsScanned(sql);

  // Compose response. The drift_summary array is bounded by
  // ALERT_EMAIL_MAX_PAIRS so the JSON body stays bounded even under a
  // corruption event.
  const driftSummary = driftRows.slice(0, ALERT_EMAIL_MAX_PAIRS).map(r => ({
    learner_id: r.learner_id,
    instructor_id: r.instructor_id,
    actual_lcb_balance_minutes: r.actual_lcb_balance_minutes,
    computed_ledger_balance_minutes: r.computed_ledger_balance_minutes,
    drift_minutes: r.drift_minutes,
  }));

  let alertSent = false;
  if (driftRows.length > 0 && sendAlerts) {
    const email = await buildAlertEmail(sql, schema.mode, driftRows, now);
    sendAlertEmail(email);
    alertSent = true;
  }

  return {
    ok: true,
    schema_mode: schema.mode,
    has_bcs: schema.has_bcs,
    has_csa: schema.has_csa,
    ran_at: now.toISOString(),
    pairs_scanned: pairsScanned,
    drift_count: driftRows.length,
    grandfathered_count: grandfatheredCount,
    alert_sent: alertSent,
    drift_summary: driftSummary,
    drift_truncated: driftRows.length > driftSummary.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP handler — production entry point invoked by Vercel Cron.
// ─────────────────────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!verifyCronAuth(req)) return res.status(401).json({ error: 'Unauthorised' });

  // Lease 300s. The reconcile is a single GROUP BY over modest-sized tables
  // (credit_transactions + LCB) so worst-case <5s; the floor gives crash
  // recovery headroom while still releasing quickly on the next daily run.
  return withCronLock(req, res, 'cron-credit-reconcile', 300, async (sql) => {
    return runDivergenceCheck(sql);
  });
};

// Test hooks — used by tests/cron-credit-reconcile.integration.spec.js to
// drive the core logic against a Neon test branch without going through HTTP.
module.exports.runDivergenceCheck = runDivergenceCheck;
module.exports.probeSchemaMode    = probeSchemaMode;
module.exports.ALERT_EMAIL_MAX_PAIRS = ALERT_EMAIL_MAX_PAIRS;
