/**
 * Shared compute for the Next Payout Preview widget AND the daily snapshot cron.
 *
 * Extracted from api/admin.js handlePlatformBalance (2026-05-17) so the widget
 * route and api/cron-balance-snapshot.js share one source of truth. Returning
 * the same shape both surfaces consume — handlePlatformBalance wraps in
 * { ok: true, ...result }; the snapshot cron persists it into
 * platform_balance_snapshots.
 *
 * refund_exposure_pence is deliberately advisory. It is still the legacy
 * aggregate learner balance shadow valued at the school bulk rate, capped by
 * Stripe-originated net cash-in. It is not a per-instructor/source-level refund
 * liability model.
 *
 * Invariant: this function must stay in lockstep with the cron path
 * simulatePayoutForInstructor + processPayoutForInstructor in _payout-helpers.js.
 * If you change what the widget shows, the snapshot must change with it, and
 * the eligibility filter must keep matching processAllPayouts.
 */
const { simulatePayoutForInstructor } = require('./_payout-helpers');

const REFUND_EXPOSURE_VALUATION_POLICY = Object.freeze({
  current: Object.freeze({
    kind: 'advisory_legacy_aggregate_shadow',
    exact_refund_liability: false,
    balance_source: 'learner_users.balance_minutes',
    valuation: 'school bulk_hourly_pence fallback 5500 pence/hour',
    cap_source: 'Stripe-originated net credit_transactions cash in',
    deferred: Object.freeze([
      'learner_credit_balances per-instructor valuation',
      'credit_transactions effective_rate_pence_per_minute source valuation',
      'goodwill absorbed_by treatment',
    ]),
  }),
  future_exact_contract: Object.freeze({
    exact_refund_liability: true,
    balance_source: 'learner_credit_balances',
    forbidden_balance_sources: Object.freeze([
      'learner_users.balance_minutes',
    ]),
    required_school_scoped_sources: Object.freeze([
      'learner_credit_balances',
      'credit_transactions',
      'booking_credit_sources',
      'refund_events',
      'refund_event_lines',
    ]),
    valuation_sources: Object.freeze([
      'credit_transactions.effective_rate_pence_per_minute',
      'booking_credit_sources.rate_pence_per_minute',
      'credit_source_adjustments',
      'absorbed_by',
      'Stripe-originated purchase/refund rows',
    ]),
    cash_cap_policy: 'cap headline collectability by real Stripe-originated net cash-in without discarding source-level liability rows',
  }),
});

function toPositiveInteger(value, name) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return n;
}

function clonePolicy(value) {
  return JSON.parse(JSON.stringify(value));
}

function describeRefundExposureValuationPolicy() {
  return clonePolicy(REFUND_EXPOSURE_VALUATION_POLICY);
}

function intValue(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function hasStripeIdentity(row = {}) {
  return Boolean(row.stripe_session_id || row.stripe_payment_intent_id || row.stripe_charge_id);
}

function classifyRefundExposureSource(row = {}) {
  const source = row.source || null;
  const absorbedBy = row.absorbed_by || null;
  if (absorbedBy === 'instructor') return 'instructor_absorbed';
  if (absorbedBy === 'platform') return 'platform_goodwill';
  if (source === 'goodwill') return 'legacy_unknown_absorber';
  if (hasStripeIdentity(row)) return 'stripe_cash_backed';
  return 'legacy_unknown_absorber';
}

function sourceRemaining(row = {}) {
  const minutes = Math.max(0, intValue(row.source_minutes));
  if (!row.credit_transaction_id) {
    return {
      minutes: Math.max(0, intValue(row.lcb_balance_minutes)),
      pence: 0,
    };
  }
  return {
    minutes: Math.max(
      0,
      minutes - intValue(row.active_minutes_drawn) - intValue(row.adjusted_minutes)
    ),
    pence: Math.max(
      0,
      intValue(row.source_amount_pence) - intValue(row.active_contribution_pence) - intValue(row.adjusted_pence)
    ),
  };
}

function valueSourceMinutes(row, valuedMinutes, remaining) {
  const rate = intValue(row.effective_rate_pence_per_minute);
  if (rate > 0) {
    return {
      pence: valuedMinutes * rate,
      rate_pence_per_minute: rate,
      valuation_basis: 'credit_transactions.effective_rate_pence_per_minute',
      legacy_unpriced: false,
    };
  }

  const remainingPence = intValue(remaining.pence);
  if (remaining.minutes > 0 && remainingPence > 0) {
    return {
      pence: Math.round((remainingPence * valuedMinutes) / remaining.minutes),
      rate_pence_per_minute: null,
      valuation_basis: 'legacy_source_remaining_pence_fallback',
      legacy_unpriced: true,
    };
  }

  return {
    pence: 0,
    rate_pence_per_minute: null,
    valuation_basis: 'unvalued_legacy_source',
    legacy_unpriced: true,
  };
}

function emptyExactExposure({ schoolId, netCashInPence = 0 } = {}) {
  return {
    kind: 'source_attributed_instructor_scoped',
    exact_refund_liability: true,
    school_id: schoolId,
    platform_refund_exposure_pence: 0,
    gross_source_liability_pence: 0,
    stripe_cash_backed_pence: 0,
    stripe_cash_backed_capped_pence: 0,
    platform_goodwill_pence: 0,
    instructor_absorbed_pence: 0,
    legacy_unknown_absorber_pence: 0,
    legacy_unpriced_pence: 0,
    unvalued_legacy_minutes: 0,
    stripe_originated_net_cash_in_pence: Math.max(0, intValue(netCashInPence)),
    source_count: 0,
    sources: [],
    warnings: [],
    basis: {
      balance_source: 'learner_credit_balances',
      exact_refund_liability: true,
      valuation_sources: [
        'credit_transactions.effective_rate_pence_per_minute',
        'booking_credit_sources source usage',
        'credit_source_adjustments',
        'absorbed_by',
        'Stripe-originated purchase/refund rows',
      ],
      forbidden_balance_sources: ['learner_users.balance_minutes'],
    },
  };
}

function summarizeExactRefundExposureRows(rows = [], { schoolId, netCashInPence = 0 } = {}) {
  const summary = emptyExactExposure({ schoolId, netCashInPence });
  const groups = new Map();

  for (const row of rows || []) {
    const key = `${row.school_id || schoolId}:${row.learner_id}:${row.instructor_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  for (const groupRows of groups.values()) {
    const ordered = groupRows
      .slice()
      .sort((a, b) => {
        const aTime = Date.parse(a.created_at || '') || 0;
        const bTime = Date.parse(b.created_at || '') || 0;
        return aTime - bTime || intValue(a.credit_transaction_id) - intValue(b.credit_transaction_id);
      });
    let lcbRemaining = Math.max(0, intValue(ordered[0]?.lcb_balance_minutes));
    let sourceRemainingMinutesTotal = 0;

    for (const row of ordered) {
      const remaining = sourceRemaining(row);
      sourceRemainingMinutesTotal += remaining.minutes;
      if (lcbRemaining <= 0 || remaining.minutes <= 0) continue;

      const valuedMinutes = Math.min(remaining.minutes, lcbRemaining);
      lcbRemaining -= valuedMinutes;

      const valued = valueSourceMinutes(row, valuedMinutes, remaining);
      const classification = classifyRefundExposureSource(row);
      const sourceLine = {
        school_id: intValue(row.school_id || schoolId),
        learner_id: row.learner_id || null,
        instructor_id: row.instructor_id || null,
        credit_transaction_id: row.credit_transaction_id || null,
        source: row.source || null,
        absorbed_by: row.absorbed_by || null,
        classification,
        remaining_minutes: remaining.minutes,
        valued_minutes: valuedMinutes,
        value_pence: valued.pence,
        rate_pence_per_minute: valued.rate_pence_per_minute,
        valuation_basis: valued.valuation_basis,
        legacy_unpriced: valued.legacy_unpriced,
        stripe_originated: hasStripeIdentity(row),
      };
      summary.sources.push(sourceLine);
      summary.source_count += 1;
      summary.gross_source_liability_pence += valued.pence;
      summary[`${classification}_pence`] += valued.pence;
      if (valued.legacy_unpriced) {
        summary.legacy_unpriced_pence += valued.pence;
        if (valued.pence === 0) summary.unvalued_legacy_minutes += valuedMinutes;
      }
    }

    const liveMinutes = Math.max(0, intValue(ordered[0]?.lcb_balance_minutes));
    if (sourceRemainingMinutesTotal !== liveMinutes) {
      summary.warnings.push({
        code: 'LCB_SOURCE_RECONCILIATION_MISMATCH',
        learner_id: ordered[0]?.learner_id || null,
        instructor_id: ordered[0]?.instructor_id || null,
        lcb_balance_minutes: liveMinutes,
        source_remaining_minutes: sourceRemainingMinutesTotal,
      });
    }
    if (lcbRemaining > 0) {
      summary.warnings.push({
        code: 'UNATTRIBUTED_LCB_MINUTES',
        learner_id: ordered[0]?.learner_id || null,
        instructor_id: ordered[0]?.instructor_id || null,
        minutes: lcbRemaining,
      });
      summary.unvalued_legacy_minutes += lcbRemaining;
    }
  }

  summary.stripe_cash_backed_capped_pence = Math.min(
    summary.stripe_cash_backed_pence,
    summary.stripe_originated_net_cash_in_pence
  );
  summary.platform_refund_exposure_pence =
    summary.stripe_cash_backed_capped_pence + summary.platform_goodwill_pence;

  return summary;
}

async function loadExactRefundExposureRows(sql, { schoolId }) {
  const resolvedSchoolId = toPositiveInteger(schoolId, 'schoolId');
  return sql`
    WITH exact_refund_exposure_sources AS (
      SELECT
        lcb.school_id,
        lcb.learner_id,
        lcb.instructor_id,
        lcb.balance_minutes::int AS lcb_balance_minutes,
        ct.id AS credit_transaction_id,
        ct.created_at,
        COALESCE(ct.minutes, 0)::int AS source_minutes,
        COALESCE(ct.amount_pence, 0)::int AS source_amount_pence,
        COALESCE(ct.effective_rate_pence_per_minute, 0)::int AS effective_rate_pence_per_minute,
        ct.source,
        ct.absorbed_by,
        ct.stripe_session_id,
        ct.stripe_payment_intent_id,
        ct.stripe_charge_id,
        COALESCE(bcs.active_minutes_drawn, 0)::int AS active_minutes_drawn,
        COALESCE(bcs.active_contribution_pence, 0)::int AS active_contribution_pence,
        COALESCE(csa.adjusted_minutes, 0)::int AS adjusted_minutes,
        COALESCE(csa.adjusted_pence, 0)::int AS adjusted_pence
      FROM learner_credit_balances lcb
      JOIN learner_users lu
        ON lu.id = lcb.learner_id
       AND lu.school_id = ${resolvedSchoolId}
      JOIN instructors i
        ON i.id = lcb.instructor_id
       AND i.school_id = ${resolvedSchoolId}
      LEFT JOIN credit_transactions ct
        ON ct.learner_id = lcb.learner_id
       AND ct.instructor_id = lcb.instructor_id
       AND ct.school_id = ${resolvedSchoolId}
       AND COALESCE(ct.minutes, 0) > 0
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(SUM(minutes_drawn), 0)::int AS active_minutes_drawn,
          COALESCE(SUM(contribution_pence), 0)::int AS active_contribution_pence
        FROM booking_credit_sources bcs
        WHERE bcs.school_id = ${resolvedSchoolId}
          AND bcs.credit_transaction_id = ct.id
          AND bcs.refunded_at IS NULL
      ) bcs ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(SUM(minutes_adjusted), 0)::int AS adjusted_minutes,
          COALESCE(SUM(pence_adjusted), 0)::int AS adjusted_pence
        FROM credit_source_adjustments csa
        WHERE csa.credit_transaction_id = ct.id
      ) csa ON TRUE
      WHERE lcb.school_id = ${resolvedSchoolId}
        AND lcb.balance_minutes > 0
        AND COALESCE(lu.is_test_account, FALSE) = FALSE
    )
    SELECT *
      FROM exact_refund_exposure_sources
     ORDER BY school_id, learner_id, instructor_id, created_at ASC NULLS LAST, credit_transaction_id ASC NULLS LAST
  `;
}

async function loadStripeOriginatedNetCashIn(sql, { schoolId }) {
  const resolvedSchoolId = toPositiveInteger(schoolId, 'schoolId');
  const [row] = await sql`
    SELECT COALESCE(SUM(
      CASE WHEN ct.type IN ('purchase', 'slot_purchase') THEN ct.amount_pence
           WHEN ct.type = 'refund' THEN -ct.amount_pence
           ELSE 0 END
    ), 0)::bigint AS stripe_net_cash_in_pence
      FROM credit_transactions ct
      JOIN learner_users lu
        ON lu.id = ct.learner_id
       AND lu.school_id = ${resolvedSchoolId}
     WHERE ct.school_id = ${resolvedSchoolId}
       AND ct.stripe_session_id IS NOT NULL
       AND COALESCE(lu.is_test_account, FALSE) = FALSE
  `;
  return Math.max(0, intValue(row?.stripe_net_cash_in_pence));
}

async function computeExactRefundExposure(sql, { schoolId = 1 } = {}) {
  const resolvedSchoolId = toPositiveInteger(schoolId, 'schoolId');
  const rows = await loadExactRefundExposureRows(sql, { schoolId: resolvedSchoolId });
  const netCashInPence = await loadStripeOriginatedNetCashIn(sql, { schoolId: resolvedSchoolId });
  return summarizeExactRefundExposureRows(rows, {
    schoolId: resolvedSchoolId,
    netCashInPence,
  });
}

async function computePlatformBalance(sql, stripe, { schoolId = 1 } = {}) {
  const resolvedSchoolId = toPositiveInteger(schoolId, 'schoolId');
  // 1. Stripe balance (GBP only).
  const balance = await stripe.balance.retrieve();
  const pickGbp = (arr) => {
    const row = (arr || []).find(b => b.currency === 'gbp');
    return row ? parseInt(row.amount) : 0;
  };
  const availablePence = pickGbp(balance.available);
  const pendingPence   = pickGbp(balance.pending);

  // 2. Per-instructor payout dry-run. Filter MUST match processAllPayouts.
  const eligibleInstructors = await sql`
    SELECT id, name, email, commission_rate, weekly_franchise_fee_pence,
           stripe_account_id, payouts_start_date
      FROM instructors
     WHERE active = TRUE
       AND stripe_onboarding_complete = TRUE
       AND payouts_paused = FALSE
       AND stripe_account_id IS NOT NULL
       AND school_id = ${resolvedSchoolId}
  `;

  const payoutPreview = [];
  let totalPayoutPence = 0;
  for (const inst of eligibleInstructors) {
    const sim = await simulatePayoutForInstructor(sql, inst);
    if (!sim) continue;
    payoutPreview.push(sim);
    totalPayoutPence += sim.amount_pence;
  }
  payoutPreview.sort((a, b) => b.amount_pence - a.amount_pence);

  const balanceAfterPayoutPence = availablePence - totalPayoutPence;

  // 3. Advisory — instructors with chargeable lessons who would NOT be paid
  // this Friday. Helps Fraser see what's stuck without affecting the headline.
  const blockedRows = await sql`
    SELECT i.id, i.name,
           i.active, i.stripe_onboarding_complete, i.payouts_paused,
           i.stripe_account_id,
           COUNT(lb.id)::int AS chargeable_lessons
      FROM instructors i
      JOIN lesson_bookings lb ON lb.instructor_id = i.id AND lb.status = 'chargeable'
      LEFT JOIN learner_users lu ON lu.id = lb.learner_id AND lu.school_id = ${resolvedSchoolId}
      LEFT JOIN payout_line_items pli ON pli.booking_id = lb.id
     WHERE pli.id IS NULL
       AND i.school_id = ${resolvedSchoolId}
       AND lb.school_id = ${resolvedSchoolId}
       AND COALESCE(lu.is_test_account, FALSE) = FALSE
       AND NOT (i.active = TRUE AND i.stripe_onboarding_complete = TRUE
                AND i.payouts_paused = FALSE AND i.stripe_account_id IS NOT NULL)
     GROUP BY i.id, i.name, i.active, i.stripe_onboarding_complete,
              i.payouts_paused, i.stripe_account_id
     ORDER BY chargeable_lessons DESC
  `;
  const excludedInstructors = blockedRows.map(r => ({
    instructor_id: r.id,
    name: r.name,
    chargeable_lessons: r.chargeable_lessons,
    reason: !r.active                       ? 'inactive'
          : !r.stripe_account_id            ? 'no_connect'
          : !r.stripe_onboarding_complete   ? 'onboarding_incomplete'
          : r.payouts_paused                ? 'paused'
          : 'unknown'
  }));

  // 4. Advisory — "if learners refunded today" worst case. This still uses
  // the legacy aggregate learner balance at the school rate, so it is a
  // conservative dashboard signal rather than a per-instructor accounting
  // model. Per-instructor effective-rate and goodwill absorber valuation are
  // deferred until the pricing/refund/payout policy is designed together.
  // Anything spent on lessons isn't refundable, so the live balance is the
  // natural ceiling.
  //
  // Filter is intent-based: stripe_session_id IS NOT NULL captures every
  // row that originated from a Stripe checkout, regardless of which
  // card/wallet type ended up in payment_method. The previous filter
  // (payment_method='stripe') matched zero rows because the webhook writes
  // session.payment_method_types[0] (typically 'card'), so the advisory
  // silently read £0 since v2 (#142) shipped.
  const [refundExposureRow] = await sql`
    SELECT
      COALESCE(SUM(
        lu.balance_minutes
        * COALESCE((s.config -> 'pricing' ->> 'bulk_hourly_pence')::int, 5500)
        / 60.0
      ), 0)::bigint AS live_credit_pence,
      COALESCE((
        SELECT SUM(
          CASE WHEN ct.type IN ('purchase', 'slot_purchase') THEN ct.amount_pence
               WHEN ct.type = 'refund' THEN -ct.amount_pence
               ELSE 0 END
        )
        FROM credit_transactions ct
        JOIN learner_users lu2 ON lu2.id = ct.learner_id
        WHERE ct.school_id = ${resolvedSchoolId}
          AND lu2.school_id = ${resolvedSchoolId}
          AND ct.stripe_session_id IS NOT NULL
          AND lu2.is_test_account = FALSE
      ), 0)::bigint AS net_cash_in_pence
    FROM learner_users lu
    JOIN schools s ON s.id = lu.school_id
    WHERE lu.balance_minutes > 0
      AND lu.school_id = ${resolvedSchoolId}
      AND lu.is_test_account = FALSE
  `;
  const liveCreditPence = parseInt(refundExposureRow.live_credit_pence) || 0;
  const netCashInPence  = Math.max(0, parseInt(refundExposureRow.net_cash_in_pence) || 0);
  const refundExposurePence = Math.min(liveCreditPence, netCashInPence);
  const exactRefundExposure = await computeExactRefundExposure(sql, { schoolId: resolvedSchoolId });

  // 5. Status — strictly binary. Friday either works or it doesn't.
  const status = balanceAfterPayoutPence >= 0 ? 'green' : 'red';

  return {
    available_pence: availablePence,
    pending_pence:   pendingPence,
    payout_preview: payoutPreview,
    total_payout_pence: totalPayoutPence,
    balance_after_payout_pence: balanceAfterPayoutPence,
    excluded_instructors: excludedInstructors,
    exact_refund_exposure_pence: exactRefundExposure.platform_refund_exposure_pence,
    exact_refund_exposure: exactRefundExposure,
    exact_refund_exposure_basis: exactRefundExposure.basis,
    legacy_advisory_refund_exposure_pence: refundExposurePence,
    legacy_advisory_refund_exposure_basis: describeRefundExposureValuationPolicy().current,
    refund_exposure_pence: refundExposurePence,
    refund_exposure_basis: describeRefundExposureValuationPolicy().current,
    status
  };
}

module.exports = {
  computePlatformBalance,
  computeExactRefundExposure,
  describeRefundExposureValuationPolicy,
  summarizeExactRefundExposureRows,
};
