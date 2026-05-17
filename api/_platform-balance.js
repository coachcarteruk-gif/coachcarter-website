/**
 * Shared compute for the Next Payout Preview widget AND the daily snapshot cron.
 *
 * Extracted from api/admin.js handlePlatformBalance (2026-05-17) so the widget
 * route and api/cron-balance-snapshot.js share one source of truth. Returning
 * the same shape both surfaces consume — handlePlatformBalance wraps in
 * { ok: true, ...result }; the snapshot cron persists it into
 * platform_balance_snapshots.
 *
 * Invariant: this function must stay in lockstep with the cron path
 * simulatePayoutForInstructor + processPayoutForInstructor in _payout-helpers.js.
 * If you change what the widget shows, the snapshot must change with it, and
 * the eligibility filter must keep matching processAllPayouts.
 */
const { simulatePayoutForInstructor } = require('./_payout-helpers');

async function computePlatformBalance(sql, stripe) {
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
      LEFT JOIN learner_users lu ON lu.id = lb.learner_id
      LEFT JOIN payout_line_items pli ON pli.booking_id = lb.id
     WHERE pli.id IS NULL
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

  // 4. Advisory — "if learners refunded today" worst case. Net cash inflow
  // per non-test learner (purchases + slot_purchases minus refunds), capped
  // at the live learner_credit valuation. Anything spent on lessons isn't
  // refundable, so the live balance is the natural ceiling.
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
        WHERE ct.stripe_session_id IS NOT NULL
          AND lu2.is_test_account = FALSE
      ), 0)::bigint AS net_cash_in_pence
    FROM learner_users lu
    JOIN schools s ON s.id = lu.school_id
    WHERE lu.balance_minutes > 0
      AND lu.is_test_account = FALSE
  `;
  const liveCreditPence = parseInt(refundExposureRow.live_credit_pence) || 0;
  const netCashInPence  = Math.max(0, parseInt(refundExposureRow.net_cash_in_pence) || 0);
  const refundExposurePence = Math.min(liveCreditPence, netCashInPence);

  // 5. Status — strictly binary. Friday either works or it doesn't.
  const status = balanceAfterPayoutPence >= 0 ? 'green' : 'red';

  return {
    available_pence: availablePence,
    pending_pence:   pendingPence,
    payout_preview: payoutPreview,
    total_payout_pence: totalPayoutPence,
    balance_after_payout_pence: balanceAfterPayoutPence,
    excluded_instructors: excludedInstructors,
    refund_exposure_pence: refundExposurePence,
    status
  };
}

module.exports = { computePlatformBalance };
