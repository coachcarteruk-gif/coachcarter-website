const { withNeonTransaction } = require('./_db-transaction');
const { isChargeable } = require('./_booking-status');
const {
  PAYOUT_V2_EARNING_CALCULATION_VERSION,
  planPayoutV2Earnings,
} = require('./_payout-v2-earning-planner');
const {
  makeSqlTag,
  loadPayoutV2ShadowInput,
} = require('./_payout-v2-shadow');
const {
  buildRecoveryApplicationRecord,
} = require('./_payout-v2-recovery');
const { canonicalJson } = require('./_payout-v2-contracts');

function requirePositiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${field} must be a positive safe integer`);
  }
}

function planDrift(message) {
  const err = new Error(message);
  err.code = 'PAYOUT_V2_EARNING_PLAN_DRIFT';
  return err;
}

function immutablePlanBody(plan) {
  return {
    calculation_version: plan.calculation_version,
    input_fingerprint: plan.input_fingerprint,
    school_id: plan.school_id,
    payout_route: plan.payout_route,
    destination_instructor_id: plan.destination_instructor_id,
    destination_school_id: plan.destination_school_id,
    period_start: plan.period_start,
    period_end: plan.period_end,
    policy: plan.policy,
    totals: plan.totals,
    recovery_plan_fingerprint: plan.recovery_plan_fingerprint,
    recovery_allocations: plan.recovery_allocations,
    bookings: plan.bookings,
  };
}

function immutableEarningShape(row) {
  return {
    school_id: Number(row.school_id),
    booking_id: Number(row.booking_id),
    instructor_id: Number(row.instructor_id),
    payout_route: row.payout_route,
    gross_price_snapshot_pence: Number(row.gross_price_snapshot_pence),
    stripe_fee_snapshot_pence: Number(row.stripe_fee_snapshot_pence),
    instructor_earning_pence: Number(row.instructor_earning_pence),
    platform_fee_pence: Number(row.platform_fee_pence),
    franchise_fee_allocation_pence: Number(row.franchise_fee_allocation_pence),
    earning_status: row.earning_status,
    calculation_version: row.calculation_version,
    calculation_fingerprint: row.calculation_fingerprint,
  };
}

function expectedEarningShape(booking) {
  return {
    school_id: booking.school_id,
    booking_id: booking.booking_id,
    instructor_id: booking.instructor_id,
    payout_route: booking.payout_route,
    gross_price_snapshot_pence: booking.gross_snapshot_pence,
    stripe_fee_snapshot_pence: booking.stripe_fee_pence,
    instructor_earning_pence: booking.instructor_earning_pence,
    platform_fee_pence: booking.platform_fee_pence,
    franchise_fee_allocation_pence: booking.franchise_fee_pence,
    earning_status: booking.earning_status,
    calculation_version: booking.calculation_version,
    calculation_fingerprint: booking.calculation_fingerprint,
  };
}

async function lockPlanInputs(client, plan, schoolId) {
  const bookingIds = plan.bookings.map((booking) => booking.booking_id);
  if (bookingIds.length > 0) {
    const bookings = await client.query(
      `SELECT id
         FROM lesson_bookings
        WHERE school_id = $1
          AND id = ANY($2::integer[])
        ORDER BY id
        FOR UPDATE`,
      [schoolId, bookingIds]
    );
    if (bookings.rowCount !== bookingIds.length) {
      throw planDrift('A booking left the requested school before materialisation');
    }
  }

  const sourceIds = [...new Set(plan.bookings.flatMap(
    (booking) => booking.funding_allocations
      .map((allocation) => allocation.funding_source_id)
      .filter((id) => id != null)
  ))].sort((left, right) => left - right);
  if (sourceIds.length > 0) {
    const sources = await client.query(
      `SELECT id
         FROM payout_funding_sources
        WHERE school_id = $1
          AND id = ANY($2::bigint[])
        ORDER BY id
        FOR UPDATE`,
      [schoolId, sourceIds]
    );
    if (sources.rowCount !== sourceIds.length) {
      throw planDrift('A funding source left the requested school before materialisation');
    }
  }

  const recoveryIds = plan.recovery_allocations.map(
    (allocation) => allocation.recoveryAdjustmentId
  );
  if (recoveryIds.length > 0) {
    const recoveries = await client.query(
      `SELECT id
         FROM payout_adjustments
        WHERE school_id = $1
          AND id = ANY($2::bigint[])
          AND adjustment_type = 'recovery'
        ORDER BY id
        FOR UPDATE`,
      [schoolId, recoveryIds]
    );
    if (recoveries.rowCount !== recoveryIds.length) {
      throw planDrift('A recovery obligation changed scope before materialisation');
    }
  }
}

async function insertOrVerifyEarning(client, schoolId, booking) {
  const result = await client.query(
    `INSERT INTO booking_earnings (
       school_id, booking_id, instructor_id, payout_route,
       gross_price_snapshot_pence, stripe_fee_snapshot_pence,
       instructor_earning_pence, platform_fee_pence,
       franchise_fee_allocation_pence, commission_rate_snapshot,
       earning_status, earned_at, blocked_reason, calculation_version,
       calculation_fingerprint, calculation_json
     )
     VALUES (
       $1, $2, $3, $4,
       $5, $6,
       $7, $8,
       $9, $10,
       $11, $12, NULL, $13,
       $14, $15::jsonb
     )
     ON CONFLICT (school_id, booking_id) DO NOTHING
     RETURNING *`,
    [
      schoolId,
      booking.booking_id,
      booking.instructor_id,
      booking.payout_route,
      booking.gross_snapshot_pence,
      booking.stripe_fee_pence,
      booking.instructor_earning_pence,
      booking.platform_fee_pence,
      booking.franchise_fee_pence,
      booking.calculation_json.policy.kind === 'commission'
        ? booking.calculation_json.policy.commission_rate_bps / 10_000
        : null,
      booking.earning_status,
      booking.earned_at,
      booking.calculation_version,
      booking.calculation_fingerprint,
      JSON.stringify(booking.calculation_json),
    ]
  );
  const created = result.rows[0] || null;
  const row = created || (await client.query(
    `SELECT *
       FROM booking_earnings
      WHERE school_id = $1
        AND booking_id = $2
      LIMIT 1`,
    [schoolId, booking.booking_id]
  )).rows[0];
  if (
    !row ||
    JSON.stringify(immutableEarningShape(row)) !==
      JSON.stringify(expectedEarningShape(booking))
  ) {
    throw planDrift('Existing booking earning contradicts the reviewed plan');
  }
  return { created: Boolean(created), row };
}

async function insertOrVerifyAllocation(client, schoolId, earningId, allocation) {
  if (allocation.funding_source_id == null) {
    if (
      allocation.gross_contribution_pence !== 0 ||
      allocation.instructor_earning_contribution_pence !== 0
    ) {
      throw planDrift('A positive allocation has no immutable funding source');
    }
    return { created: false, row: null };
  }
  const result = await client.query(
    `INSERT INTO booking_earning_sources (
       school_id, booking_earning_id, funding_source_id,
       booking_credit_source_id, gross_contribution_pence,
       stripe_fee_contribution_pence, payable_contribution_pence,
       instructor_earning_contribution_pence,
       platform_fee_contribution_pence,
       franchise_fee_contribution_pence,
       allocation_fingerprint
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (school_id, allocation_fingerprint) DO NOTHING
     RETURNING *`,
    [
      schoolId,
      earningId,
      allocation.funding_source_id,
      allocation.booking_credit_source_id,
      allocation.gross_contribution_pence,
      allocation.stripe_fee_contribution_pence,
      allocation.payable_contribution_pence,
      allocation.instructor_earning_contribution_pence,
      allocation.platform_fee_contribution_pence,
      allocation.franchise_fee_contribution_pence,
      allocation.allocation_fingerprint,
    ]
  );
  const created = result.rows[0] || null;
  const row = created || (await client.query(
    `SELECT *
       FROM booking_earning_sources
      WHERE school_id = $1
        AND allocation_fingerprint = $2
      LIMIT 1`,
    [schoolId, allocation.allocation_fingerprint]
  )).rows[0];
  if (
    !row ||
    Number(row.booking_earning_id) !== Number(earningId) ||
    Number(row.funding_source_id) !== allocation.funding_source_id ||
    Number(row.gross_contribution_pence) !== allocation.gross_contribution_pence ||
    Number(row.stripe_fee_contribution_pence) !==
      allocation.stripe_fee_contribution_pence ||
    Number(row.instructor_earning_contribution_pence) !==
      allocation.instructor_earning_contribution_pence ||
    Number(row.platform_fee_contribution_pence) !==
      allocation.platform_fee_contribution_pence ||
    Number(row.franchise_fee_contribution_pence) !==
      allocation.franchise_fee_contribution_pence
  ) {
    throw planDrift('Existing funding allocation contradicts the reviewed plan');
  }
  return { created: Boolean(created), row };
}

async function insertOrVerifyBatch(client, schoolId, plan, createdBy) {
  const result = await client.query(
    `INSERT INTO payout_batches (
       school_id, instructor_id, destination_school_id, payout_route,
       period_start, period_end, currency, gross_pence, stripe_fees_pence,
       platform_fee_pence, franchise_fee_pence, instructor_amount_pence,
       shortfall_pence, deposit_deducted_pence, recovery_deducted_pence,
       state, calculation_version, plan_fingerprint, plan_json,
       created_by_type, created_by_id
     )
     VALUES (
       $1, $2, $3, $4,
       $5, $6, 'gbp', $7, $8,
       $9, $10, $11,
       $12, $13, $14,
       'planned', $15, $16, $17::jsonb,
       $18, $19
     )
     ON CONFLICT (school_id, plan_fingerprint) DO NOTHING
     RETURNING *`,
    [
      schoolId,
      plan.destination_instructor_id,
      plan.destination_school_id,
      plan.payout_route,
      plan.period_start,
      plan.period_end,
      plan.totals.gross_pence,
      plan.totals.stripe_fees_pence,
      plan.totals.platform_fee_pence,
      plan.totals.franchise_fee_pence,
      plan.totals.net_shadow_transfer_pence,
      plan.totals.shortfall_deducted_pence,
      plan.totals.deposit_deducted_pence,
      plan.totals.recovery_deducted_pence,
      plan.calculation_version,
      plan.plan_fingerprint,
      JSON.stringify(immutablePlanBody(plan)),
      createdBy.type,
      createdBy.id || null,
    ]
  );
  const created = result.rows[0] || null;
  const row = created || (await client.query(
    `SELECT *
       FROM payout_batches
      WHERE school_id = $1
        AND plan_fingerprint = $2
      LIMIT 1`,
    [schoolId, plan.plan_fingerprint]
  )).rows[0];
  if (
    !row ||
    Number(row.school_id) !== schoolId ||
    row.payout_route !== plan.payout_route ||
    Number(row.gross_pence) !== plan.totals.gross_pence ||
    Number(row.stripe_fees_pence) !== plan.totals.stripe_fees_pence ||
    Number(row.platform_fee_pence) !== plan.totals.platform_fee_pence ||
    Number(row.franchise_fee_pence) !== plan.totals.franchise_fee_pence ||
    Number(row.instructor_amount_pence) !== plan.totals.net_shadow_transfer_pence ||
    Number(row.shortfall_pence) !== plan.totals.shortfall_deducted_pence ||
    Number(row.deposit_deducted_pence) !== plan.totals.deposit_deducted_pence ||
    Number(row.recovery_deducted_pence) !== plan.totals.recovery_deducted_pence ||
    canonicalJson(row.plan_json) !== canonicalJson(immutablePlanBody(plan))
  ) {
    throw planDrift('Existing shadow batch contradicts the reviewed plan');
  }
  return { created: Boolean(created), row };
}

async function linkEarningToBatch(client, schoolId, batchId, earningId) {
  await client.query(
    `INSERT INTO payout_batch_earnings (
       school_id, payout_batch_id, booking_earning_id
     )
     VALUES ($1, $2, $3)
     ON CONFLICT (school_id, booking_earning_id) DO NOTHING`,
    [schoolId, batchId, earningId]
  );
  const row = (await client.query(
    `SELECT payout_batch_id
       FROM payout_batch_earnings
      WHERE school_id = $1
        AND booking_earning_id = $2
      LIMIT 1`,
    [schoolId, earningId]
  )).rows[0];
  if (!row || Number(row.payout_batch_id) !== Number(batchId)) {
    throw planDrift('Booking earning is already claimed by a different shadow batch');
  }
}

async function materializeRecoveryApplications(client, schoolId, batch, plan) {
  const rows = [];
  for (const allocation of plan.recovery_allocations) {
    const parent = (await client.query(
      `SELECT id, instructor_id, evidence_reference
         FROM payout_adjustments
        WHERE school_id = $1
          AND id = $2
          AND adjustment_type = 'recovery'
        LIMIT 1`,
      [schoolId, allocation.recoveryAdjustmentId]
    )).rows[0];
    if (
      !parent ||
      Number(parent.instructor_id) !== Number(plan.destination_instructor_id)
    ) {
      throw planDrift('Recovery allocation crossed instructor or school scope');
    }
    const record = buildRecoveryApplicationRecord({
      schoolId,
      instructorId: Number(parent.instructor_id),
      recoveryAdjustmentId: Number(parent.id),
      payoutBatchId: Number(batch.id),
      appliedPence: allocation.appliedPence,
      parentEvidenceReference: parent.evidence_reference,
      planFingerprint: plan.plan_fingerprint,
    });
    const inserted = await client.query(
      `INSERT INTO payout_adjustments (
         school_id, instructor_id, parent_adjustment_id, payout_batch_id,
         adjustment_type, amount_pence, currency, reason,
         evidence_reference, status, adjustment_fingerprint,
         applied_at, metadata
       )
       VALUES (
         $1, $2, $3, $4,
         $5, $6, $7, $8,
         $9, $10, $11,
         NOW(), $12::jsonb
       )
       ON CONFLICT (school_id, adjustment_fingerprint) DO NOTHING
       RETURNING *`,
      [
        record.school_id,
        record.instructor_id,
        record.parent_adjustment_id,
        record.payout_batch_id,
        record.adjustment_type,
        record.amount_pence,
        record.currency,
        record.reason,
        record.evidence_reference,
        record.status,
        record.adjustment_fingerprint,
        JSON.stringify(record.metadata),
      ]
    );
    const row = inserted.rows[0] || (await client.query(
      `SELECT *
         FROM payout_adjustments
        WHERE school_id = $1
          AND adjustment_fingerprint = $2
        LIMIT 1`,
      [schoolId, record.adjustment_fingerprint]
    )).rows[0];
    if (
      !row ||
      Number(row.parent_adjustment_id) !== record.parent_adjustment_id ||
      Number(row.payout_batch_id) !== Number(batch.id) ||
      Number(row.amount_pence) !== record.amount_pence
    ) {
      throw planDrift('Existing recovery application contradicts the reviewed plan');
    }
    rows.push(row);
  }
  return rows;
}

async function materializePayoutV2ShadowPlanInTransaction({
  client,
  schoolId,
  reviewedPlan,
  createdBy = { type: 'system', id: null },
  reloadInput = loadPayoutV2ShadowInput,
}) {
  requirePositiveInteger(schoolId, 'schoolId');
  if (!reviewedPlan || reviewedPlan.school_id !== schoolId) {
    throw planDrift('Reviewed plan does not belong to the explicit school');
  }
  if (!['system', 'admin', 'migration'].includes(createdBy.type)) {
    throw new TypeError('createdBy.type is unsupported');
  }
  if (createdBy.id != null) requirePositiveInteger(createdBy.id, 'createdBy.id');
  if (typeof reloadInput !== 'function') throw new TypeError('reloadInput must be a function');

  const chargeableBlockers = reviewedPlan.bookings.filter(
    (booking) => isChargeable(booking.booking_status) && booking.blocked
  );
  if (chargeableBlockers.length > 0) {
    const err = new Error('Blocked chargeable bookings cannot be materialised');
    err.code = 'PAYOUT_V2_EARNING_PLAN_BLOCKED';
    err.blockedBookingIds = chargeableBlockers.map((booking) => booking.booking_id);
    throw err;
  }
  const materialBookings = reviewedPlan.bookings.filter(
    (booking) => isChargeable(booking.booking_status) && booking.included && !booking.blocked
  );
  if (materialBookings.length === 0) {
    const err = new Error('No chargeable earnings are available to materialise');
    err.code = 'PAYOUT_V2_NO_EARNINGS';
    throw err;
  }

  await lockPlanInputs(client, reviewedPlan, schoolId);
  const sql = makeSqlTag(client);
  const reloadedInput = await reloadInput({
    sql,
    schoolId,
    payoutRoute: reviewedPlan.payout_route,
    instructorId: reviewedPlan.destination_instructor_id,
    periodStart: reviewedPlan.period_start,
    periodEnd: reviewedPlan.period_end,
    snapshotAt: reviewedPlan.normalized_input.policy.snapshotted_at,
    excludeExistingBookingIds: materialBookings.map((booking) => booking.booking_id),
  });
  const currentPlan = planPayoutV2Earnings(reloadedInput);
  if (
    currentPlan.input_fingerprint !== reviewedPlan.input_fingerprint ||
    currentPlan.plan_fingerprint !== reviewedPlan.plan_fingerprint
  ) {
    throw planDrift('Immutable payout inputs changed after shadow review');
  }

  const earnings = [];
  let createdEarningCount = 0;
  let createdAllocationCount = 0;
  for (const booking of materialBookings) {
    const earning = await insertOrVerifyEarning(client, schoolId, booking);
    if (earning.created) createdEarningCount += 1;
    for (const allocation of booking.funding_allocations) {
      const source = await insertOrVerifyAllocation(
        client,
        schoolId,
        earning.row.id,
        allocation
      );
      if (source.created) createdAllocationCount += 1;
    }
    earnings.push(earning.row);
  }

  const batch = await insertOrVerifyBatch(
    client,
    schoolId,
    reviewedPlan,
    createdBy
  );
  for (const earning of earnings) {
    await linkEarningToBatch(client, schoolId, batch.row.id, earning.id);
  }
  const recoveryApplications = await materializeRecoveryApplications(
    client,
    schoolId,
    batch.row,
    reviewedPlan
  );
  await client.query('SET CONSTRAINTS ALL IMMEDIATE');
  await client.query('SET CONSTRAINTS ALL DEFERRED');

  return {
    ok: true,
    mode: 'inactive_shadow_materialisation',
    calculation_version: PAYOUT_V2_EARNING_CALCULATION_VERSION,
    plan_fingerprint: reviewedPlan.plan_fingerprint,
    batch_id: Number(batch.row.id),
    batch_created: batch.created,
    earning_ids: earnings.map((earning) => Number(earning.id)),
    created_earning_count: createdEarningCount,
    created_allocation_count: createdAllocationCount,
    recovery_application_ids: recoveryApplications.map((row) => Number(row.id)),
    stripe_transfer_created: false,
    activation_switch_changed: false,
  };
}

async function materializePayoutV2ShadowPlan({
  connectionString,
  schoolId,
  reviewedPlan,
  createdBy,
}) {
  return withNeonTransaction({ connectionString }, (client) =>
    materializePayoutV2ShadowPlanInTransaction({
      client,
      schoolId,
      reviewedPlan,
      createdBy,
    })
  );
}

module.exports = {
  immutablePlanBody,
  materializePayoutV2ShadowPlan,
  materializePayoutV2ShadowPlanInTransaction,
};
