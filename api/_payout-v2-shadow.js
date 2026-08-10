const {
  PAYOUT_V2_EARNING_CALCULATION_VERSION,
  planPayoutV2Earnings,
  roundBasisPoints,
} = require('./_payout-v2-earning-planner');
const { CHARGEABLE } = require('./_booking-status');

function requirePositiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${field} must be a positive safe integer`);
  }
}

function dateOnly(value, field) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new TypeError(`${field} must use YYYY-MM-DD`);
  }
  return text;
}

function makeSqlTag(client) {
  if (!client || typeof client.query !== 'function') {
    throw new TypeError('client must provide query(text, values)');
  }
  return async (strings, ...values) => {
    let text = strings[0];
    for (let index = 0; index < values.length; index += 1) {
      text += `$${index + 1}${strings[index + 1]}`;
    }
    const result = await client.query(text, values);
    return result.rows;
  };
}

function integer(value) {
  const number = Number(value || 0);
  if (!Number.isSafeInteger(number)) throw new TypeError('Database pence value is not a safe integer');
  return number;
}

function statusZeroFundingClass(row) {
  if (String(row.payment_method || '').toLowerCase() === 'free') return 'free';
  if (row.created_by === 'free_trial_self_serve') return 'free';
  return null;
}

function evidenceFromSource(row) {
  const metadata = row.source_metadata || {};
  return {
    stripe_checkout_session_id: row.stripe_checkout_session_id || null,
    stripe_payment_intent_id: row.stripe_payment_intent_id || null,
    stripe_charge_id: row.stripe_charge_id || null,
    stripe_balance_transaction_id: row.stripe_balance_transaction_id || null,
    explicitly_funded: metadata.explicitly_funded === true,
    evidence_reference: metadata.evidence_reference || null,
  };
}

async function loadPayoutV2ShadowInput({
  sql,
  schoolId,
  payoutRoute,
  instructorId = null,
  periodStart,
  periodEnd,
  snapshotAt = new Date().toISOString(),
  excludeExistingBookingIds = [],
}) {
  if (typeof sql !== 'function') throw new TypeError('sql must be a tagged query function');
  requirePositiveInteger(schoolId, 'schoolId');
  const start = dateOnly(periodStart, 'periodStart');
  const end = dateOnly(periodEnd, 'periodEnd');
  if (start > end) throw new TypeError('periodStart must not follow periodEnd');
  if (payoutRoute === 'instructor_direct') requirePositiveInteger(instructorId, 'instructorId');
  if (!['instructor_direct', 'school'].includes(payoutRoute)) {
    throw new TypeError('payoutRoute must be instructor_direct or school');
  }
  for (const bookingId of excludeExistingBookingIds) {
    requirePositiveInteger(bookingId, 'excludeExistingBookingIds[]');
  }

  const schoolRows = await sql`
    SELECT id, platform_fee_pct, payout_engine_version
    FROM schools
    WHERE id = ${schoolId}
    LIMIT 1
  `;
  const school = schoolRows[0];
  if (!school) {
    const err = new Error('School was not found');
    err.code = 'PAYOUT_V2_SHADOW_SCOPE_MISMATCH';
    throw err;
  }

  let instructor = null;
  let policy;
  let policyBlocker = null;
  if (payoutRoute === 'instructor_direct') {
    const rows = await sql`
      SELECT
        id,
        school_id,
        commission_rate,
        weekly_franchise_fee_pence,
        payouts_start_date
      FROM instructors
      WHERE id = ${instructorId}
        AND school_id = ${schoolId}
      LIMIT 1
    `;
    instructor = rows[0];
    if (!instructor) {
      const err = new Error('Instructor was not found in the requested school');
      err.code = 'PAYOUT_V2_SHADOW_SCOPE_MISMATCH';
      throw err;
    }
    if (instructor.weekly_franchise_fee_pence == null) {
      policy = {
        kind: 'commission',
        commissionRateBps: Math.round(Number(instructor.commission_rate || 0) * 10_000),
        evidenceReference: `db:instructors:${instructorId}:commission_rate`,
        snapshottedAt: snapshotAt,
      };
    } else {
      const [priorCompleted, priorShortfall] = await Promise.all([
        sql`
          SELECT COUNT(*)::int AS payout_count
          FROM instructor_payouts
          WHERE school_id = ${schoolId}
            AND instructor_id = ${instructorId}
            AND status = 'completed'
        `,
        sql`
          SELECT id, shortfall_pence
          FROM instructor_payouts
          WHERE school_id = ${schoolId}
            AND instructor_id = ${instructorId}
            AND status = 'completed'
            AND shortfall_pence > 0
            AND shortfall_recovered_from_payout_id IS NULL
          ORDER BY period_end DESC, id DESC
          LIMIT 1
        `,
      ]);
      const isFirstPayout = integer(priorCompleted[0]?.payout_count) === 0;
      const weeklyFranchiseFeePence = integer(instructor.weekly_franchise_fee_pence);
      policy = {
        kind: 'franchise',
        weeklyFranchiseFeePence,
        depositPence: 0,
        vehicleDepositPolicy: 'off_system',
        v1ComparisonDepositPence:
          isFirstPayout && weeklyFranchiseFeePence === 19_500 ? 25_000 : 0,
        priorShortfallPence: integer(priorShortfall[0]?.shortfall_pence),
        evidenceReference:
          `owner-policy:2026-07-25:vehicle-deposits-off-system;` +
          `db:instructors:${instructorId}:franchise-policy`,
        snapshottedAt: snapshotAt,
      };
    }
  } else {
    policy = {
      kind: 'school_platform_fee',
      platformFeeBps: Math.round(Number(school.platform_fee_pct || 0) * 100),
      evidenceReference: `db:schools:${schoolId}:platform_fee_pct`,
      snapshottedAt: snapshotAt,
    };
  }

  const bookings = await sql`
    SELECT
      lb.id AS booking_id,
      lb.school_id,
      lb.instructor_id,
      lb.status,
      lb.scheduled_date::text,
      (
        (lb.scheduled_date + lb.end_time)
        AT TIME ZONE 'Europe/London'
      ) AS earned_at,
      lb.payment_method,
      lb.created_by,
      COALESCE(lu.is_test_account, FALSE) AS is_test_account,
      EXISTS (
        SELECT 1
        FROM payout_line_items pli
        WHERE pli.booking_id = lb.id
          AND pli.school_id = lb.school_id
      ) AS has_v1_direct_claim,
      EXISTS (
        SELECT 1
        FROM school_payout_line_items spli
        JOIN school_payouts sp
          ON sp.id = spli.school_payout_id
         AND sp.school_id = lb.school_id
        WHERE spli.booking_id = lb.id
      ) AS has_v1_school_claim
      ,
      EXISTS (
        SELECT 1
        FROM booking_earnings be
        WHERE be.booking_id = lb.id
          AND be.school_id = lb.school_id
          AND NOT (be.booking_id = ANY(${excludeExistingBookingIds}::integer[]))
      ) AS has_v2_earning
    FROM lesson_bookings lb
    LEFT JOIN learner_users lu
      ON lu.id = lb.learner_id
     AND lu.school_id = lb.school_id
    WHERE lb.school_id = ${schoolId}
      AND lb.scheduled_date >= ${start}::date
      AND lb.scheduled_date <= ${end}::date
      AND (
        ${payoutRoute}::text = 'school'
        OR lb.instructor_id = ${instructorId}
      )
    ORDER BY lb.scheduled_date, lb.id
  `;
  const bookingIds = bookings.map((booking) => Number(booking.booking_id));
  const sourceRows = bookingIds.length === 0 ? [] : await sql`
    SELECT
      bcs.id AS booking_credit_source_id,
      bcs.booking_id,
      bcs.school_id,
      lb.instructor_id AS booking_instructor_id,
      bcs.credit_transaction_id,
      bcs.contribution_pence,
      bcs.stripe_fee_pence AS bcs_stripe_fee_pence,
      bcs.absorbed_by,
      ct.type AS credit_transaction_type,
      ct.transferred_from_credit_transaction_id,
      pfs.id AS funding_source_id,
      pfs.instructor_id AS source_instructor_id,
      pfs.funding_class,
      pfs.source_status,
      pfs.source_fingerprint,
      pfs.payable_pool_pence,
      pfs.stripe_checkout_session_id,
      pfs.stripe_payment_intent_id,
      pfs.stripe_charge_id,
      pfs.stripe_balance_transaction_id,
      pfs.metadata AS source_metadata,
      COALESCE(allocated.instructor_pence, 0)::int AS already_allocated_pence
    FROM booking_credit_sources bcs
    JOIN lesson_bookings lb
      ON lb.id = bcs.booking_id
     AND lb.school_id = bcs.school_id
    JOIN credit_transactions ct
      ON ct.id = bcs.credit_transaction_id
     AND ct.school_id = bcs.school_id
    LEFT JOIN credit_transactions transferred_from_ct
      ON transferred_from_ct.id = ct.transferred_from_credit_transaction_id
     AND transferred_from_ct.school_id = ct.school_id
    LEFT JOIN payout_funding_sources pfs
      ON pfs.credit_transaction_id = COALESCE(transferred_from_ct.id, bcs.credit_transaction_id)
     AND pfs.school_id = bcs.school_id
     AND (pfs.metadata->>'launch_accounting_version') IS DISTINCT FROM 'simon_launch_v1'
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(bes.payable_contribution_pence), 0)::int AS instructor_pence
      FROM booking_earning_sources bes
      JOIN booking_earnings be
        ON be.id = bes.booking_earning_id
       AND be.school_id = bes.school_id
      WHERE bes.school_id = pfs.school_id
        AND bes.funding_source_id = pfs.id
        AND NOT (be.booking_id = ANY(${excludeExistingBookingIds}::integer[]))
    ) allocated ON TRUE
    WHERE bcs.school_id = ${schoolId}
      AND bcs.booking_id = ANY(${bookingIds}::integer[])
      AND bcs.refunded_at IS NULL
    ORDER BY bcs.booking_id, bcs.id
  `;
  const sourcesByBooking = new Map();
  for (const row of sourceRows) {
    let source;
    if (!row.funding_source_id) {
      source = {
        fundingSourceId: null,
        bookingCreditSourceId: Number(row.booking_credit_source_id),
        schoolId: Number(row.school_id),
        instructorId: Number(row.booking_instructor_id),
        fundingClass: 'manual_review',
        sourceStatus: 'manual_review',
        sourceFingerprint: null,
        grossContributionPence: 0,
        stripeFeeContributionPence: 0,
        payablePoolPence: 0,
        alreadyAllocatedPence: 0,
        evidence: {
          credit_transaction_id: Number(row.credit_transaction_id),
          missing_payout_funding_source: true,
          credit_transaction_type: row.credit_transaction_type,
          absorbed_by: row.absorbed_by || null,
        },
      };
    } else {
      source = {
        fundingSourceId: Number(row.funding_source_id),
        bookingCreditSourceId: Number(row.booking_credit_source_id),
        schoolId: Number(row.school_id),
        // An explicit reschedule transfer preserves the immutable Stripe
        // source while assigning the delivered lesson's earning to the new
        // instructor. Ordinary sources must still match exactly.
        instructorId: row.credit_transaction_type === 'instructor_transfer_in'
          ? Number(row.booking_instructor_id)
          : Number(row.source_instructor_id),
        fundingClass: row.funding_class,
        sourceStatus: row.source_status,
        sourceFingerprint: row.source_fingerprint,
        grossContributionPence: integer(row.contribution_pence),
        stripeFeeContributionPence: integer(row.bcs_stripe_fee_pence),
        payablePoolPence: integer(row.payable_pool_pence),
        alreadyAllocatedPence: integer(row.already_allocated_pence),
        evidence: {
          ...evidenceFromSource(row),
          instructor_switch_transfer: row.credit_transaction_type === 'instructor_transfer_in',
          transferred_from_credit_transaction_id: row.transferred_from_credit_transaction_id
            ? Number(row.transferred_from_credit_transaction_id)
            : null,
        },
      };
    }
    if (!sourcesByBooking.has(Number(row.booking_id))) {
      sourcesByBooking.set(Number(row.booking_id), []);
    }
    sourcesByBooking.get(Number(row.booking_id)).push(source);
  }

  const recoveries = payoutRoute === 'instructor_direct'
    ? await sql`
        SELECT
          parent.id,
          parent.created_at,
          (
            ABS(parent.amount_pence) -
            COALESCE(SUM(child.amount_pence), 0)
          )::int AS remaining_pence
        FROM payout_adjustments parent
        LEFT JOIN payout_adjustments child
          ON child.parent_adjustment_id = parent.id
         AND child.school_id = parent.school_id
         AND child.adjustment_type = 'recovery_application'
        WHERE parent.school_id = ${schoolId}
          AND parent.instructor_id = ${instructorId}
          AND parent.adjustment_type = 'recovery'
          AND parent.status = 'pending'
        GROUP BY parent.id
        HAVING ABS(parent.amount_pence) - COALESCE(SUM(child.amount_pence), 0) > 0
        ORDER BY parent.created_at, parent.id
      `
    : [];

  return {
    schoolId,
    payoutRoute,
    destinationInstructorId: payoutRoute === 'instructor_direct' ? instructorId : null,
    periodStart: start,
    periodEnd: end,
    policy,
    policyBlocker,
    recoveries: recoveries.map((recovery) => ({
      id: Number(recovery.id),
      remainingPence: integer(recovery.remaining_pence),
      createdAt: recovery.created_at,
    })),
    bookings: bookings.map((booking) => ({
      bookingId: Number(booking.booking_id),
      schoolId: Number(booking.school_id),
      instructorId: Number(booking.instructor_id),
      status: booking.status,
      scheduledDate: booking.scheduled_date,
      earnedAt: booking.earned_at,
      payoutRoute,
      isTestAccount: booking.is_test_account === true,
      existingV1Routes: [
        ...(booking.has_v1_direct_claim ? ['instructor_direct'] : []),
        ...(booking.has_v1_school_claim ? ['school'] : []),
      ],
      existingV2Earning: booking.has_v2_earning === true,
      zeroFundingClass: statusZeroFundingClass(booking),
      fundingSources: sourcesByBooking.get(Number(booking.booking_id)) || [],
    })),
    selection: {
      schoolId,
      payoutRoute,
      instructorId: payoutRoute === 'instructor_direct' ? instructorId : null,
      periodStart: start,
      periodEnd: end,
      snapshotAt,
    },
  };
}

async function loadCurrentV1Comparison({
  sql,
  schoolId,
  payoutRoute,
  instructorId,
  periodStart,
  periodEnd,
  policy,
  policyBlocker,
}) {
  // This query intentionally mirrors the current v1 fallback pricing only for
  // comparison. None of these fields are passed into the v2 planner.
  const rows = await sql`
    SELECT
      lb.id AS booking_id,
      COALESCE(
        lb.list_price_pence,
        CASE WHEN iln.custom_hourly_rate_pence IS NOT NULL
          THEN ROUND(iln.custom_hourly_rate_pence * COALESCE(lt.duration_minutes, 90) / 60.0)
          ELSE COALESCE(lt.price_pence, 8250)
        END
      )::int AS v1_gross_pence,
      CASE WHEN active_bcs.active_bcs_count > 0
        THEN active_bcs.stripe_fee_pence
        ELSE COALESCE(lb.stripe_fee_pence, 0)
      END::int AS v1_stripe_fee_pence
    FROM lesson_bookings lb
    LEFT JOIN lesson_types lt
      ON lt.id = lb.lesson_type_id
     AND lt.school_id = lb.school_id
    LEFT JOIN learner_users lu
      ON lu.id = lb.learner_id
     AND lu.school_id = lb.school_id
    LEFT JOIN instructor_learner_notes iln
      ON iln.instructor_id = lb.instructor_id
     AND iln.learner_id = lb.learner_id
     AND iln.school_id = lb.school_id
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)::int AS active_bcs_count,
        COALESCE(SUM(bcs.stripe_fee_pence), 0)::int AS stripe_fee_pence
      FROM booking_credit_sources bcs
      WHERE bcs.booking_id = lb.id
        AND bcs.school_id = lb.school_id
        AND bcs.refunded_at IS NULL
    ) active_bcs ON TRUE
    WHERE lb.school_id = ${schoolId}
      AND lb.scheduled_date >= ${periodStart}::date
      AND lb.scheduled_date <= ${periodEnd}::date
      AND lb.status = ${CHARGEABLE}
      AND COALESCE(lu.is_test_account, FALSE) = FALSE
      AND (${payoutRoute}::text = 'school' OR lb.instructor_id = ${instructorId})
      AND NOT EXISTS (
        SELECT 1 FROM payout_line_items pli
        WHERE pli.booking_id = lb.id
          AND pli.school_id = lb.school_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM school_payout_line_items spli
        JOIN school_payouts sp
          ON sp.id = spli.school_payout_id
         AND sp.school_id = lb.school_id
        WHERE spli.booking_id = lb.id
      )
    ORDER BY lb.scheduled_date, lb.id
  `;
  const gross = rows.reduce((total, row) => total + integer(row.v1_gross_pence), 0);
  const fees = rows.reduce((total, row) => total + integer(row.v1_stripe_fee_pence), 0);
  let amount = null;
  if (!policyBlocker) {
    if (policy.kind === 'commission') {
      amount = rows.reduce(
        (total, row) => total +
          Math.max(
            0,
            roundBasisPoints(integer(row.v1_gross_pence), policy.commissionRateBps) -
              integer(row.v1_stripe_fee_pence)
          ),
        0
      );
    } else if (policy.kind === 'franchise') {
      const net = Math.max(0, gross - fees);
      const afterFee = Math.max(0, net - policy.weeklyFranchiseFeePence);
      const afterDeposit = Math.max(
        0,
        afterFee - integer(policy.v1ComparisonDepositPence)
      );
      amount = afterDeposit >= policy.priorShortfallPence
        ? afterDeposit - policy.priorShortfallPence
        : 0;
    } else {
      amount = Math.max(
        0,
        gross - roundBasisPoints(gross, policy.platformFeeBps)
      );
    }
  }
  return {
    comparison_only_uses_current_v1_live_fallbacks: true,
    booking_count: rows.length,
    booking_ids: rows.map((row) => Number(row.booking_id)),
    gross_pence: gross,
    stripe_fees_pence: fees,
    vehicle_deposit_pence: policy.kind === 'franchise'
      ? integer(policy.v1ComparisonDepositPence)
      : 0,
    transfer_pence: amount,
    unavailable_reason: policyBlocker,
  };
}

function classifyComparison(plan, v1) {
  const deliberateReasons = new Set();
  for (const booking of plan.bookings) {
    if (
      booking.funding_classes.includes('legacy_pre_connect_settled') ||
      booking.review_reason === 'settled_or_zero_funded_source'
    ) {
      deliberateReasons.add('legacy_or_zero_funding_is_not_paid_twice');
    }
    if (booking.blocked) {
      deliberateReasons.add(`fail_closed:${booking.blocker_reason}`);
    }
  }
  if (plan.totals.recovery_deducted_pence > 0) {
    deliberateReasons.add('full_available_offset_recovery');
  }
  if (plan.payout_route === 'school' && plan.totals.stripe_fees_pence > 0) {
    deliberateReasons.add('v2_school_route_conserves_stripe_fees');
  }
  if (integer(v1.vehicle_deposit_pence) > 0) {
    deliberateReasons.add('vehicle_deposit_handled_off_system');
  }
  const difference = v1.transfer_pence == null
    ? null
    : plan.totals.net_shadow_transfer_pence - v1.transfer_pence;
  const unexplained = difference !== null && difference !== 0 && deliberateReasons.size === 0;
  return {
    v1_transfer_pence: v1.transfer_pence,
    v2_shadow_transfer_pence: plan.totals.net_shadow_transfer_pence,
    difference_pence: difference,
    deliberate_policy_differences: [...deliberateReasons].sort(),
    unexplained_difference: unexplained,
    classification: difference === null
      ? 'comparison_unavailable'
      : difference === 0
        ? 'matched'
        : unexplained
          ? 'unexplained_difference'
          : 'deliberate_policy_difference',
  };
}

async function buildPayoutV2ShadowStatement(options) {
  const input = await loadPayoutV2ShadowInput(options);
  const plan = planPayoutV2Earnings(input);
  const v1 = await loadCurrentV1Comparison({
    sql: options.sql,
    schoolId: input.schoolId,
    payoutRoute: input.payoutRoute,
    instructorId: input.destinationInstructorId,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    policy: input.policy,
    policyBlocker: input.policyBlocker,
  });
  return {
    mode: 'read_only_shadow',
    calculation_version: PAYOUT_V2_EARNING_CALCULATION_VERSION,
    school_id: input.schoolId,
    instructor_id: input.destinationInstructorId,
    payout_route: input.payoutRoute,
    period_start: input.periodStart,
    period_end: input.periodEnd,
    plan_fingerprint: plan.plan_fingerprint,
    totals: plan.totals,
    bookings: plan.bookings,
    v1_preview: v1,
    comparison: classifyComparison(plan, v1),
    mutation_guarantee: {
      claims_created: false,
      locks_taken: false,
      financial_rows_written: false,
      stripe_calls: false,
    },
  };
}

module.exports = {
  makeSqlTag,
  loadPayoutV2ShadowInput,
  loadCurrentV1Comparison,
  classifyComparison,
  buildPayoutV2ShadowStatement,
};
