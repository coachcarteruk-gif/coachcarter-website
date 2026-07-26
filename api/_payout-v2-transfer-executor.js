const {
  canonicalJson,
  fingerprintPayoutPlan,
  ZERO_PAYOUT_FUNDING_CLASSES,
} = require('./_payout-v2-contracts');
const {
  PAYOUT_V2_EARNING_CALCULATION_VERSION,
  allocatePence,
} = require('./_payout-v2-earning-planner');
const { isChargeable } = require('./_booking-status');
const { withNeonTransaction } = require('./_db-transaction');

const TRANSFER_CALCULATION_VERSION = 'payout-v2-transfer-executor-v1';
const IDEMPOTENCY_RETENTION_MS = 23 * 60 * 60 * 1000;
const RETRYABLE_BATCH_STATES = new Set(['planned', 'claimed', 'failed_confirmed']);
const SETTLED_BATCH_STATES = new Set(['transferred', 'bank_paid', 'bank_payout_failed']);
const POSITIVE_FUNDING_CLASSES = new Set([
  'stripe_backed',
  'platform_goodwill',
  'external_cash_payable',
]);

function transferError(code, message, reasons = []) {
  const error = new Error(message);
  error.code = code;
  error.reasons = reasons;
  return error;
}

function requirePositiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${field} must be a positive safe integer`);
  }
}

function integer(value, field) {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) {
    throw transferError('PAYOUT_V2_TRANSFER_INVALID_SNAPSHOT', `${field} is not safe integer pence`);
  }
  return result;
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function immutableStripeEvidence(transfer) {
  return {
    id: transfer.id,
    object: transfer.object || 'transfer',
    amount: Number(transfer.amount),
    currency: transfer.currency,
    destination:
      typeof transfer.destination === 'string'
        ? transfer.destination
        : transfer.destination?.id || null,
    source_transaction:
      typeof transfer.source_transaction === 'string'
        ? transfer.source_transaction
        : transfer.source_transaction?.id || null,
    transfer_group: transfer.transfer_group || null,
    metadata: transfer.metadata || {},
    created: transfer.created == null ? null : Number(transfer.created),
    livemode: transfer.livemode === true,
  };
}

function safeStripeErrorEvidence(error) {
  return {
    type: nonEmpty(error?.type) ? error.type : null,
    code: nonEmpty(error?.code) ? error.code : null,
    request_id:
      error?.requestId || error?.request_id || error?.raw?.requestId || null,
    status_code: Number.isInteger(error?.statusCode) ? error.statusCode : null,
    confirmed_no_transfer: error?.confirmedNoTransfer === true,
  };
}

async function emitTransferAlert(onAlert, payload) {
  if (typeof onAlert !== 'function') return false;
  try {
    await onAlert({
      component: 'payout_v2_transfer_executor',
      ...payload,
    });
    return true;
  } catch {
    return false;
  }
}

function logicalTransferIdentity({
  schoolId,
  batchId,
  destinationAccountId,
  sourceGroup,
  amountPence,
  currency,
  planFingerprint,
}) {
  requirePositiveInteger(schoolId, 'schoolId');
  requirePositiveInteger(batchId, 'batchId');
  if (!nonEmpty(destinationAccountId)) throw new TypeError('destinationAccountId is required');
  if (!nonEmpty(sourceGroup)) throw new TypeError('sourceGroup is required');
  if (!Number.isSafeInteger(amountPence) || amountPence <= 0) {
    throw new TypeError('amountPence must be positive safe integer pence');
  }
  const body = {
    school_id: schoolId,
    payout_batch_id: batchId,
    stripe_destination_account_id: destinationAccountId,
    source_group: sourceGroup,
    amount_pence: amountPence,
    currency,
    plan_fingerprint: planFingerprint,
  };
  const logicalFingerprint = fingerprintPayoutPlan(body, TRANSFER_CALCULATION_VERSION);
  const keyFingerprint = fingerprintPayoutPlan(
    { ...body, logical_transfer_fingerprint: logicalFingerprint },
    `${TRANSFER_CALCULATION_VERSION}:stripe-idempotency`
  );
  const idempotencyKey = `payout-v2:${keyFingerprint.slice('sha256:'.length)}`;
  const transferGroupHash = logicalFingerprint.slice('sha256:'.length, 'sha256:'.length + 24);
  return {
    body,
    logicalFingerprint,
    idempotencyKey,
    transferGroup: `payout-v2-b${batchId}-${transferGroupHash}`,
  };
}

function sourceTransferGroup(source) {
  if (source.funding_class === 'stripe_backed') {
    if (!nonEmpty(source.stripe_charge_id)) {
      throw transferError(
        'PAYOUT_V2_TRANSFER_SOURCE_BLOCKED',
        'Stripe-backed source has no immutable charge',
        ['missing_stripe_source_charge']
      );
    }
    return {
      key: `stripe-charge:${source.stripe_charge_id}`,
      stripeSourceChargeId: source.stripe_charge_id,
    };
  }
  if (source.funding_class === 'platform_goodwill' ||
      source.funding_class === 'external_cash_payable') {
    const documented = source.metadata?.transfer_source_group;
    if (!nonEmpty(documented) || !nonEmpty(source.metadata?.evidence_reference)) {
      throw transferError(
        'PAYOUT_V2_TRANSFER_SOURCE_BLOCKED',
        'Non-Stripe payable source requires a documented immutable transfer group',
        ['missing_documented_source_group']
      );
    }
    return {
      key: `documented:${source.funding_class}:${documented.trim()}`,
      stripeSourceChargeId: null,
    };
  }
  throw transferError(
    'PAYOUT_V2_TRANSFER_SOURCE_BLOCKED',
    'Funding class cannot create a positive transfer',
    [`non_payable_funding_class:${source.funding_class}`]
  );
}

function assertBatchPlanSnapshot(batch) {
  const plan = batch.plan_json;
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    throw transferError(
      'PAYOUT_V2_TRANSFER_PLAN_DRIFT',
      'Materialized batch has no immutable reviewed plan snapshot',
      ['missing_plan_json']
    );
  }
  const calculated = fingerprintPayoutPlan(plan, batch.calculation_version);
  if (calculated !== batch.plan_fingerprint) {
    throw transferError(
      'PAYOUT_V2_TRANSFER_PLAN_DRIFT',
      'Materialized batch plan fingerprint is invalid',
      ['plan_fingerprint_mismatch']
    );
  }
  if (
    batch.calculation_version !== PAYOUT_V2_EARNING_CALCULATION_VERSION ||
    plan.calculation_version !== batch.calculation_version
  ) {
    throw transferError(
      'PAYOUT_V2_TRANSFER_PLAN_DRIFT',
      'Unsupported or contradictory calculation version',
      ['calculation_version_mismatch']
    );
  }
  const totals = plan.totals || {};
  const comparisons = [
    ['gross_pence', batch.gross_pence],
    ['stripe_fees_pence', batch.stripe_fees_pence],
    ['platform_fee_pence', batch.platform_fee_pence],
    ['franchise_fee_pence', batch.franchise_fee_pence],
    ['net_shadow_transfer_pence', batch.instructor_amount_pence],
    ['shortfall_deducted_pence', batch.shortfall_pence],
    ['deposit_deducted_pence', batch.deposit_deducted_pence],
    ['recovery_deducted_pence', batch.recovery_deducted_pence],
  ];
  const drift = comparisons
    .filter(([field, value]) => integer(totals[field], `plan.totals.${field}`) !== Number(value))
    .map(([field]) => `batch_total_mismatch:${field}`);
  if (Number(batch.deposit_deducted_pence) !== 0 || totals.deposit_deducted_pence !== 0) {
    drift.push('vehicle_deposit_must_be_zero');
  }
  if (
    Number(batch.school_id) !== Number(plan.school_id) ||
    batch.payout_route !== plan.payout_route ||
    Number(batch.instructor_id || 0) !== Number(plan.destination_instructor_id || 0) ||
    Number(batch.destination_school_id || 0) !== Number(plan.destination_school_id || 0)
  ) {
    drift.push('batch_scope_or_route_mismatch');
  }
  if (drift.length > 0) {
    throw transferError('PAYOUT_V2_TRANSFER_PLAN_DRIFT', 'Batch contradicts reviewed plan', drift);
  }
  return plan;
}

function expectedMaterialBookings(plan) {
  return (Array.isArray(plan.bookings) ? plan.bookings : []).filter(
    (booking) =>
      booking.included === true &&
      booking.blocked === false &&
      isChargeable(booking.booking_status)
  );
}

function assertClaimAndEarningSnapshots({ batch, plan, claimRows, allocationRows }) {
  const expected = expectedMaterialBookings(plan);
  const expectedByBooking = new Map(expected.map((booking) => [Number(booking.booking_id), booking]));
  const reasons = [];
  if (claimRows.length !== expected.length) reasons.push('claim_count_mismatch');
  const claimByBooking = new Map();
  for (const row of claimRows) {
    const bookingId = Number(row.booking_id);
    if (claimByBooking.has(bookingId)) reasons.push(`duplicate_claim:${bookingId}`);
    claimByBooking.set(bookingId, row);
    const booking = expectedByBooking.get(bookingId);
    if (!booking) {
      reasons.push(`unexpected_claim:${bookingId}`);
      continue;
    }
    if (
      Number(row.school_id) !== Number(batch.school_id) ||
      Number(row.payout_batch_id) !== Number(batch.id) ||
      row.payout_route !== batch.payout_route ||
      row.earning_status !== booking.earning_status ||
      row.calculation_version !== booking.calculation_version ||
      row.calculation_fingerprint !== booking.calculation_fingerprint ||
      canonicalJson(row.calculation_json) !== canonicalJson(booking.calculation_json) ||
      fingerprintPayoutPlan(row.calculation_json, row.calculation_version) !==
        row.calculation_fingerprint
    ) {
      reasons.push(`earning_snapshot_mismatch:${bookingId}`);
    }
  }
  for (const booking of expected) {
    if (!claimByBooking.has(Number(booking.booking_id))) {
      reasons.push(`missing_claim:${booking.booking_id}`);
    }
  }

  const allocationsByEarning = new Map();
  for (const row of allocationRows) {
    const earningId = Number(row.booking_earning_id);
    if (!allocationsByEarning.has(earningId)) allocationsByEarning.set(earningId, []);
    allocationsByEarning.get(earningId).push(row);
  }
  for (const claim of claimRows) {
    const booking = expectedByBooking.get(Number(claim.booking_id));
    if (!booking) continue;
    const actual = allocationsByEarning.get(Number(claim.booking_earning_id)) || [];
    const planned = booking.funding_allocations || [];
    if (actual.length !== planned.length) {
      reasons.push(`source_allocation_count_mismatch:${claim.booking_id}`);
      continue;
    }
    const actualByFingerprint = new Map(actual.map((row) => [row.allocation_fingerprint, row]));
    for (const allocation of planned) {
      const row = actualByFingerprint.get(allocation.allocation_fingerprint);
      if (
        !row ||
        Number(row.funding_source_id) !== Number(allocation.funding_source_id) ||
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
        reasons.push(`source_allocation_mismatch:${allocation.allocation_fingerprint}`);
      }
    }
  }
  if (reasons.length > 0) {
    throw transferError(
      'PAYOUT_V2_TRANSFER_CLAIM_DRIFT',
      'Batch claims or immutable earnings contradict the reviewed plan',
      reasons
    );
  }
}

function buildSourceLinkedTransferPlan({
  batch,
  plan,
  claimRows,
  allocationRows,
  destinationAccountId,
}) {
  const allocationsByEarning = new Map();
  for (const row of allocationRows) {
    const earningId = Number(row.booking_earning_id);
    if (!allocationsByEarning.has(earningId)) allocationsByEarning.set(earningId, []);
    allocationsByEarning.get(earningId).push(row);
  }
  const sourceAmounts = new Map();
  for (const claim of claimRows) {
    const target = integer(
      claim.calculation_json.net_shadow_transfer_pence,
      'calculation_json.net_shadow_transfer_pence'
    );
    const sources = (allocationsByEarning.get(Number(claim.booking_earning_id)) || [])
      .slice()
      .sort((a, b) =>
        Number(a.funding_source_id) - Number(b.funding_source_id) ||
        a.allocation_fingerprint.localeCompare(b.allocation_fingerprint)
      );
    const split = allocatePence(target, sources.map((source) => ({
      key: `${source.funding_source_id}:${source.allocation_fingerprint}`,
      weight: Number(source.instructor_earning_contribution_pence),
    })));
    sources.forEach((source, index) => {
      if (split[index] === 0) return;
      const sourceId = Number(source.funding_source_id);
      sourceAmounts.set(sourceId, (sourceAmounts.get(sourceId) || 0) + split[index]);
    });
  }
  const grouped = new Map();
  for (const source of allocationRows) {
    const sourceId = Number(source.funding_source_id);
    if (!sourceAmounts.has(sourceId)) continue;
    if (
      Number(source.school_id) !== Number(batch.school_id) ||
      source.source_status !== 'available' ||
      ZERO_PAYOUT_FUNDING_CLASSES.has(source.funding_class) ||
      !POSITIVE_FUNDING_CLASSES.has(source.funding_class)
    ) {
      throw transferError(
        'PAYOUT_V2_TRANSFER_SOURCE_BLOCKED',
        'Source is unavailable or cannot fund an automatic payout',
        [`blocked_source:${sourceId}`]
      );
    }
    const group = sourceTransferGroup(source);
    if (!grouped.has(group.key)) {
      grouped.set(group.key, {
        sourceGroup: group.key,
        stripeSourceChargeId: group.stripeSourceChargeId,
        amountPence: 0,
        sources: new Map(),
      });
    }
    const target = grouped.get(group.key);
    const amount = sourceAmounts.get(sourceId);
    if (!target.sources.has(sourceId)) {
      target.sources.set(sourceId, {
        fundingSourceId: sourceId,
        amountPence: amount,
      });
      target.amountPence += amount;
    }
  }
  const transfers = [...grouped.values()]
    .map((group) => {
      const identity = logicalTransferIdentity({
        schoolId: Number(batch.school_id),
        batchId: Number(batch.id),
        destinationAccountId,
        sourceGroup: group.sourceGroup,
        amountPence: group.amountPence,
        currency: batch.currency,
        planFingerprint: batch.plan_fingerprint,
      });
      return {
        ...group,
        sources: [...group.sources.values()].sort(
          (left, right) => left.fundingSourceId - right.fundingSourceId
        ),
        ...identity,
      };
    })
    .sort((left, right) => left.sourceGroup.localeCompare(right.sourceGroup));
  const total = transfers.reduce((sum, transfer) => sum + transfer.amountPence, 0);
  if (total !== Number(batch.instructor_amount_pence)) {
    throw transferError(
      'PAYOUT_V2_TRANSFER_CONSERVATION_FAILED',
      'Source-linked transfers do not equal the immutable batch amount',
      [`transfer_total:${total}`, `batch_total:${batch.instructor_amount_pence}`]
    );
  }
  return transfers;
}

async function loadDestination(client, batch) {
  if (batch.payout_route === 'instructor_direct') {
    const result = await client.query(
      `SELECT stripe_account_id, stripe_onboarding_complete, payouts_paused
         FROM instructors
        WHERE school_id = $1
          AND id = $2
        LIMIT 1
        FOR UPDATE`,
      [batch.school_id, batch.instructor_id]
    );
    const destination = result.rows[0];
    if (
      !destination ||
      !nonEmpty(destination.stripe_account_id) ||
      destination.stripe_onboarding_complete !== true ||
      destination.payouts_paused === true
    ) {
      throw transferError(
        'PAYOUT_V2_TRANSFER_DESTINATION_BLOCKED',
        'Instructor payout destination is unavailable',
        ['instructor_destination_unavailable']
      );
    }
    return destination.stripe_account_id;
  }
  const result = await client.query(
    `SELECT stripe_account_id, stripe_onboarding_complete
       FROM schools
      WHERE id = $1
      LIMIT 1
      FOR UPDATE`,
    [batch.school_id]
  );
  const destination = result.rows[0];
  if (
    !destination ||
    !nonEmpty(destination.stripe_account_id) ||
    destination.stripe_onboarding_complete !== true
  ) {
    throw transferError(
      'PAYOUT_V2_TRANSFER_DESTINATION_BLOCKED',
      'School payout destination is unavailable',
      ['school_destination_unavailable']
    );
  }
  return destination.stripe_account_id;
}

async function loadValidatedBatchSnapshot(client, {
  schoolId,
  batchId,
  expectedPlanFingerprint,
}) {
  requirePositiveInteger(schoolId, 'schoolId');
  requirePositiveInteger(batchId, 'batchId');
  if (!nonEmpty(expectedPlanFingerprint)) {
    throw new TypeError('expectedPlanFingerprint is required');
  }
  const batchResult = await client.query(
    `SELECT *
       FROM payout_batches
      WHERE school_id = $1
        AND id = $2
      LIMIT 1
      FOR UPDATE`,
    [schoolId, batchId]
  );
  const batch = batchResult.rows[0];
  if (!batch) {
    throw transferError('PAYOUT_V2_TRANSFER_SCOPE_MISMATCH', 'Batch was not found in school');
  }
  if (SETTLED_BATCH_STATES.has(batch.state)) {
    throw transferError(
      'PAYOUT_V2_TRANSFER_ALREADY_SETTLED',
      'Batch is already settled',
      [`batch_state:${batch.state}`]
    );
  }
  if (!RETRYABLE_BATCH_STATES.has(batch.state)) {
    throw transferError(
      'PAYOUT_V2_TRANSFER_RECONCILIATION_REQUIRED',
      'Batch must reconcile before another submission',
      [`batch_state:${batch.state}`]
    );
  }
  if (batch.plan_fingerprint !== expectedPlanFingerprint) {
    throw transferError(
      'PAYOUT_V2_TRANSFER_PLAN_DRIFT',
      'Caller reviewed a different immutable batch plan',
      ['expected_plan_fingerprint_mismatch']
    );
  }
  const plan = assertBatchPlanSnapshot(batch);
  const claimResult = await client.query(
    `SELECT
       pbe.payout_batch_id,
       pbe.booking_earning_id,
       be.school_id,
       be.booking_id,
       be.instructor_id,
       be.payout_route,
       be.earning_status,
       be.calculation_version,
       be.calculation_fingerprint,
       be.calculation_json
     FROM payout_batch_earnings pbe
     JOIN booking_earnings be
       ON be.id = pbe.booking_earning_id
      AND be.school_id = pbe.school_id
    WHERE pbe.school_id = $1
      AND pbe.payout_batch_id = $2
    ORDER BY be.booking_id
    FOR UPDATE OF be`,
    [schoolId, batchId]
  );
  const earningIds = claimResult.rows.map((row) => Number(row.booking_earning_id));
  const allocationResult = earningIds.length === 0
    ? { rows: [] }
    : await client.query(
      `SELECT
         bes.*,
         pfs.funding_class,
         pfs.source_status,
         pfs.stripe_charge_id,
         pfs.payable_pool_pence,
         pfs.metadata
       FROM booking_earning_sources bes
       JOIN payout_funding_sources pfs
         ON pfs.id = bes.funding_source_id
        AND pfs.school_id = bes.school_id
      WHERE bes.school_id = $1
        AND bes.booking_earning_id = ANY($2::bigint[])
      ORDER BY bes.booking_earning_id, bes.funding_source_id
      FOR UPDATE OF pfs`,
      [schoolId, earningIds]
    );
  assertClaimAndEarningSnapshots({
    batch,
    plan,
    claimRows: claimResult.rows,
    allocationRows: allocationResult.rows,
  });

  const v1Overlap = await client.query(
    `SELECT be.booking_id
       FROM payout_batch_earnings pbe
       JOIN booking_earnings be
         ON be.id = pbe.booking_earning_id
        AND be.school_id = pbe.school_id
      WHERE pbe.school_id = $1
        AND pbe.payout_batch_id = $2
        AND (
          EXISTS (
            SELECT 1 FROM payout_line_items pli
             WHERE pli.school_id = pbe.school_id
               AND pli.booking_id = be.booking_id
          )
          OR EXISTS (
            SELECT 1
              FROM school_payout_line_items spli
              JOIN school_payouts sp
                ON sp.id = spli.school_payout_id
               AND sp.school_id = pbe.school_id
             WHERE spli.booking_id = be.booking_id
          )
        )
      LIMIT 1`,
    [schoolId, batchId]
  );
  if (v1Overlap.rowCount > 0) {
    throw transferError(
      'PAYOUT_V2_TRANSFER_ROUTE_OVERLAP',
      'A claimed booking overlaps existing v1 payout history',
      [`booking_id:${v1Overlap.rows[0].booking_id}`]
    );
  }

  const recovery = await client.query(
    `SELECT COALESCE(SUM(amount_pence), 0)::bigint AS total
       FROM payout_adjustments
      WHERE school_id = $1
        AND payout_batch_id = $2
        AND adjustment_type = 'recovery_application'`,
    [schoolId, batchId]
  );
  if (Number(recovery.rows[0].total) !== Number(batch.recovery_deducted_pence)) {
    throw transferError(
      'PAYOUT_V2_TRANSFER_RECOVERY_DRIFT',
      'Recovery applications do not equal the immutable batch deduction',
      ['recovery_total_mismatch']
    );
  }
  return {
    batch,
    plan,
    claimRows: claimResult.rows,
    allocationRows: allocationResult.rows,
  };
}

async function verifySourceCapacity(client, schoolId, transfers) {
  for (const transfer of transfers) {
    for (const source of transfer.sources) {
      const result = await client.query(
        `SELECT
           pfs.payable_pool_pence,
           COALESCE((
             SELECT SUM(bes.instructor_earning_contribution_pence)
               FROM booking_earning_sources bes
              WHERE bes.school_id = pfs.school_id
                AND bes.funding_source_id = pfs.id
           ), 0)::bigint AS allocated_pence,
           COALESCE((
             SELECT SUM(pts.amount_pence)
               FROM payout_transfer_sources pts
              WHERE pts.school_id = pfs.school_id
                AND pts.funding_source_id = pfs.id
                AND NOT EXISTS (
                  SELECT 1
                    FROM payout_transfers pt
                   WHERE pt.id = pts.payout_transfer_id
                     AND pt.school_id = pts.school_id
                     AND pt.payout_batch_id = $3
                )
           ), 0)::bigint AS previously_transferred_pence
         FROM payout_funding_sources pfs
        WHERE pfs.school_id = $1
          AND pfs.id = $2
        LIMIT 1`,
        [schoolId, source.fundingSourceId, transfer.body.payout_batch_id]
      );
      const row = result.rows[0];
      const remaining = Math.min(
        Number(row?.payable_pool_pence || 0),
        Number(row?.allocated_pence || 0)
      ) - Number(row?.previously_transferred_pence || 0);
      if (!row || source.amountPence > remaining) {
        throw transferError(
          'PAYOUT_V2_TRANSFER_SOURCE_CAP_EXCEEDED',
          'Transfer would exceed a source-backed payable pool',
          [`funding_source_id:${source.fundingSourceId}`]
        );
      }
    }
  }
}

async function insertOrVerifyIntent(client, snapshot, destinationAccountId, transfer) {
  const batch = snapshot.batch;
  const metadata = {
    payout_v2: true,
    school_id: String(batch.school_id),
    payout_batch_id: String(batch.id),
    payout_route: batch.payout_route,
    plan_fingerprint: batch.plan_fingerprint,
    logical_transfer_fingerprint: transfer.logicalFingerprint,
    stripe_idempotency_key: transfer.idempotencyKey,
    source_group: transfer.sourceGroup,
  };
  const inserted = await client.query(
    `INSERT INTO payout_transfers (
       school_id, payout_batch_id, instructor_id, destination_school_id,
       stripe_destination_account_id, stripe_source_charge_id,
       amount_pence, currency, idempotency_key, transfer_group,
       plan_fingerprint, logical_transfer_fingerprint, state, metadata
     )
     VALUES (
       $1, $2, $3, $4,
       $5, $6,
       $7, $8, $9, $10,
       $11, $12, 'planned', $13::jsonb
     )
     ON CONFLICT (school_id, logical_transfer_fingerprint) DO NOTHING
     RETURNING *`,
    [
      batch.school_id,
      batch.id,
      batch.instructor_id,
      batch.destination_school_id,
      destinationAccountId,
      transfer.stripeSourceChargeId,
      transfer.amountPence,
      batch.currency,
      transfer.idempotencyKey,
      transfer.transferGroup,
      batch.plan_fingerprint,
      transfer.logicalFingerprint,
      JSON.stringify(metadata),
    ]
  );
  const row = inserted.rows[0] || (await client.query(
    `SELECT *
       FROM payout_transfers
      WHERE school_id = $1
        AND logical_transfer_fingerprint = $2
      LIMIT 1`,
    [batch.school_id, transfer.logicalFingerprint]
  )).rows[0];
  const expected = {
    school_id: Number(batch.school_id),
    payout_batch_id: Number(batch.id),
    stripe_destination_account_id: destinationAccountId,
    stripe_source_charge_id: transfer.stripeSourceChargeId,
    amount_pence: transfer.amountPence,
    currency: batch.currency,
    idempotency_key: transfer.idempotencyKey,
    transfer_group: transfer.transferGroup,
    plan_fingerprint: batch.plan_fingerprint,
    logical_transfer_fingerprint: transfer.logicalFingerprint,
  };
  const actual = Object.fromEntries(
    Object.keys(expected).map((key) => [
      key,
      ['school_id', 'payout_batch_id', 'amount_pence'].includes(key)
        ? Number(row?.[key])
        : row?.[key] ?? null,
    ])
  );
  if (!row || canonicalJson(actual) !== canonicalJson(expected)) {
    throw transferError(
      'PAYOUT_V2_TRANSFER_INTENT_CONFLICT',
      'Existing logical transfer contradicts immutable intent'
    );
  }
  for (const source of transfer.sources) {
    const fingerprint = fingerprintPayoutPlan(
      {
        school_id: Number(batch.school_id),
        payout_transfer_id: Number(row.id),
        funding_source_id: source.fundingSourceId,
        amount_pence: source.amountPence,
        logical_transfer_fingerprint: transfer.logicalFingerprint,
      },
      TRANSFER_CALCULATION_VERSION
    );
    await client.query(
      `INSERT INTO payout_transfer_sources (
         school_id, payout_transfer_id, funding_source_id,
         amount_pence, source_fingerprint
       )
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (school_id, source_fingerprint) DO NOTHING`,
      [batch.school_id, row.id, source.fundingSourceId, source.amountPence, fingerprint]
    );
  }
  const sources = await client.query(
    `SELECT funding_source_id, amount_pence
       FROM payout_transfer_sources
      WHERE school_id = $1
        AND payout_transfer_id = $2
      ORDER BY funding_source_id`,
    [batch.school_id, row.id]
  );
  const expectedSources = transfer.sources.map((source) => ({
    funding_source_id: source.fundingSourceId,
    amount_pence: source.amountPence,
  }));
  const actualSources = sources.rows.map((source) => ({
    funding_source_id: Number(source.funding_source_id),
    amount_pence: Number(source.amount_pence),
  }));
  if (canonicalJson(actualSources) !== canonicalJson(expectedSources)) {
    throw transferError(
      'PAYOUT_V2_TRANSFER_INTENT_CONFLICT',
      'Transfer source allocations contradict immutable intent'
    );
  }
  return row;
}

async function preparePayoutV2TransferIntentsInTransaction({
  client,
  schoolId,
  batchId,
  expectedPlanFingerprint,
}) {
  const snapshot = await loadValidatedBatchSnapshot(client, {
    schoolId,
    batchId,
    expectedPlanFingerprint,
  });
  if (Number(snapshot.batch.instructor_amount_pence) === 0) {
    await client.query(
      `UPDATE payout_batches
          SET state = 'transferred',
              submitted_at = COALESCE(submitted_at, NOW()),
              settled_at = COALESCE(settled_at, NOW()),
              failure_reason = NULL
        WHERE school_id = $1
          AND id = $2`,
      [schoolId, batchId]
    );
    return {
      ok: true,
      zero_transfer: true,
      batch_id: batchId,
      transfer_intents: [],
      stripe_called: false,
    };
  }
  const destinationAccountId = await loadDestination(client, snapshot.batch);
  const transfers = buildSourceLinkedTransferPlan({
    ...snapshot,
    destinationAccountId,
  });
  await verifySourceCapacity(client, schoolId, transfers);
  const intents = [];
  for (const transfer of transfers) {
    intents.push(await insertOrVerifyIntent(
      client,
      snapshot,
      destinationAccountId,
      transfer
    ));
  }
  await client.query('SET CONSTRAINTS ALL IMMEDIATE');
  await client.query('SET CONSTRAINTS ALL DEFERRED');
  await client.query(
    `UPDATE payout_batches
        SET state = 'claimed',
            failure_reason = NULL
      WHERE school_id = $1
        AND id = $2`,
    [schoolId, batchId]
  );
  return {
    ok: true,
    zero_transfer: false,
    batch_id: batchId,
    transfer_intents: intents,
    stripe_called: false,
  };
}

async function appendAttempt(client, {
  schoolId,
  transferId,
  attemptKind,
  outcome,
  evidence,
  stripeRequestId = null,
  stripeTransferId = null,
}) {
  const fingerprint = fingerprintPayoutPlan(
    {
      school_id: schoolId,
      payout_transfer_id: transferId,
      attempt_kind: attemptKind,
      outcome,
      evidence,
    },
    TRANSFER_CALCULATION_VERSION
  );
  await client.query(
    `INSERT INTO payout_transfer_attempts (
       school_id, payout_transfer_id, attempt_kind, outcome,
       stripe_request_id, stripe_transfer_id,
       evidence_fingerprint, evidence_json
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     ON CONFLICT (school_id, evidence_fingerprint) DO NOTHING`,
    [
      schoolId,
      transferId,
      attemptKind,
      outcome,
      stripeRequestId,
      stripeTransferId,
      fingerprint,
      JSON.stringify(evidence),
    ]
  );
}

async function beginSubmission(client, schoolId, transferId) {
  const locked = await client.query(
    `SELECT *
       FROM payout_transfers
      WHERE school_id = $1
        AND id = $2
      LIMIT 1
      FOR UPDATE`,
    [schoolId, transferId]
  );
  const transfer = locked.rows[0];
  if (!transfer) {
    throw transferError('PAYOUT_V2_TRANSFER_SCOPE_MISMATCH', 'Transfer was not found in school');
  }
  if (transfer.state === 'transferred') return { action: 'complete', transfer };
  if (transfer.state === 'submitting' || transfer.state === 'reconciling') {
    return { action: 'reconcile', transfer };
  }
  if (!['planned', 'failed_confirmed'].includes(transfer.state)) {
    throw transferError(
      'PAYOUT_V2_TRANSFER_BLOCKED',
      'Transfer state cannot be submitted',
      [`transfer_state:${transfer.state}`]
    );
  }
  const updated = (await client.query(
    `UPDATE payout_transfers
        SET state = 'submitting',
            request_created_at = COALESCE(request_created_at, NOW()),
            last_error_code = NULL,
            last_error_message = NULL
      WHERE school_id = $1
        AND id = $2
      RETURNING *`,
    [schoolId, transferId]
  )).rows[0];
  await client.query(
    `UPDATE payout_batches
        SET state = 'submitting',
            submitted_at = COALESCE(submitted_at, NOW()),
            failure_reason = NULL
      WHERE school_id = $1
        AND id = $2`,
    [schoolId, updated.payout_batch_id]
  );
  await appendAttempt(client, {
    schoolId,
    transferId,
    attemptKind: 'submission',
    outcome: 'started',
    evidence: {
      logical_transfer_fingerprint: updated.logical_transfer_fingerprint,
      idempotency_key: updated.idempotency_key,
      transfer_group: updated.transfer_group,
    },
  });
  return { action: 'submit', transfer: updated };
}

function stripeCreateParams(transfer) {
  const params = {
    amount: Number(transfer.amount_pence),
    currency: transfer.currency,
    destination: transfer.stripe_destination_account_id,
    transfer_group: transfer.transfer_group,
    metadata: {
      ...transfer.metadata,
      payout_v2_logical_transfer_fingerprint:
        transfer.logical_transfer_fingerprint,
      payout_v2_idempotency_key: transfer.idempotency_key,
    },
  };
  if (nonEmpty(transfer.stripe_source_charge_id)) {
    params.source_transaction = transfer.stripe_source_charge_id;
  }
  return params;
}

function assertStripeIdentity(transfer, stripeTransfer) {
  const evidence = immutableStripeEvidence(stripeTransfer);
  const reasons = [];
  if (!nonEmpty(evidence.id)) reasons.push('missing_stripe_transfer_id');
  if (evidence.amount !== Number(transfer.amount_pence)) reasons.push('amount_mismatch');
  if (evidence.currency !== transfer.currency) reasons.push('currency_mismatch');
  if (evidence.destination !== transfer.stripe_destination_account_id) {
    reasons.push('destination_mismatch');
  }
  if ((evidence.source_transaction || null) !== (transfer.stripe_source_charge_id || null)) {
    reasons.push('source_transaction_mismatch');
  }
  if (evidence.transfer_group !== transfer.transfer_group) reasons.push('transfer_group_mismatch');
  if (
    evidence.metadata.payout_v2_logical_transfer_fingerprint !==
      transfer.logical_transfer_fingerprint ||
    evidence.metadata.payout_v2_idempotency_key !== transfer.idempotency_key
  ) {
    reasons.push('metadata_identity_mismatch');
  }
  if (reasons.length > 0) {
    throw transferError(
      'PAYOUT_V2_STRIPE_IDENTITY_MISMATCH',
      'Stripe transfer contradicts immutable local intent',
      reasons
    );
  }
  return evidence;
}

async function persistTransferSuccess(client, schoolId, transferId, stripeTransfer, {
  attemptKind = 'submission',
  outcome = 'succeeded',
} = {}) {
  const current = (await client.query(
    `SELECT *
       FROM payout_transfers
      WHERE school_id = $1
        AND id = $2
      LIMIT 1
      FOR UPDATE`,
    [schoolId, transferId]
  )).rows[0];
  if (!current) {
    throw transferError('PAYOUT_V2_TRANSFER_SCOPE_MISMATCH', 'Transfer was not found in school');
  }
  const evidence = assertStripeIdentity(current, stripeTransfer);
  if (
    current.stripe_transfer_id &&
    current.stripe_transfer_id !== evidence.id
  ) {
    throw transferError(
      'PAYOUT_V2_STRIPE_IDENTITY_MISMATCH',
      'Local intent is already attached to a different Stripe transfer'
    );
  }
  await client.query(
    `UPDATE payout_transfers
        SET stripe_transfer_id = $3,
            state = 'transferred',
            stripe_created_at = COALESCE(
              stripe_created_at,
              TO_TIMESTAMP($4)
            ),
            reconciled_at = CASE WHEN $5 = 'reconciliation' THEN NOW() ELSE reconciled_at END,
            last_error_code = NULL,
            last_error_message = NULL
      WHERE school_id = $1
        AND id = $2`,
    [schoolId, transferId, evidence.id, evidence.created || Math.floor(Date.now() / 1000), attemptKind]
  );
  await appendAttempt(client, {
    schoolId,
    transferId,
    attemptKind,
    outcome,
    stripeRequestId: stripeTransfer.lastResponse?.requestId || null,
    stripeTransferId: evidence.id,
    evidence,
  });
  const remaining = await client.query(
    `SELECT COUNT(*)::int AS count
       FROM payout_transfers
      WHERE school_id = $1
        AND payout_batch_id = $2
        AND state <> 'transferred'`,
    [schoolId, current.payout_batch_id]
  );
  if (Number(remaining.rows[0].count) === 0) {
    await client.query(
      `UPDATE payout_batches
          SET state = 'transferred',
              settled_at = COALESCE(settled_at, NOW()),
              failure_reason = NULL
        WHERE school_id = $1
          AND id = $2`,
      [schoolId, current.payout_batch_id]
    );
  }
  return evidence;
}

async function persistTransferFailure(client, schoolId, transferId, error, {
  ambiguous,
  attemptKind = 'submission',
  outcome = ambiguous ? 'ambiguous' : 'failed_confirmed',
}) {
  const evidence = safeStripeErrorEvidence(error);
  const state = ambiguous ? 'reconciling' : 'failed_confirmed';
  const locked = (await client.query(
    `SELECT state, payout_batch_id
       FROM payout_transfers
      WHERE school_id = $1
        AND id = $2
      LIMIT 1
      FOR UPDATE`,
    [schoolId, transferId]
  )).rows[0];
  if (!locked) {
    throw transferError('PAYOUT_V2_TRANSFER_SCOPE_MISMATCH', 'Transfer was not found in school');
  }
  if (locked.state === 'transferred') {
    return { state: 'transferred', evidence };
  }
  const current = (await client.query(
    `UPDATE payout_transfers
        SET state = $3,
            reconciled_at = CASE WHEN $4 = 'reconciliation' THEN NOW() ELSE reconciled_at END,
            last_error_code = $5,
            last_error_message = $6
      WHERE school_id = $1
        AND id = $2
      RETURNING payout_batch_id`,
    [
      schoolId,
      transferId,
      state,
      attemptKind,
      evidence.code || (ambiguous ? 'ambiguous_stripe_result' : 'confirmed_no_transfer'),
      ambiguous
        ? 'Stripe result is ambiguous; reconciliation is required'
        : 'Stripe evidence confirms no transfer was created',
    ]
  )).rows[0];
  await client.query(
    `UPDATE payout_batches
        SET state = $3,
            failure_reason = $4
      WHERE school_id = $1
        AND id = $2`,
    [
      schoolId,
      current.payout_batch_id,
      state,
      ambiguous ? 'transfer_reconciliation_required' : 'transfer_failed_confirmed',
    ]
  );
  await appendAttempt(client, {
    schoolId,
    transferId,
    attemptKind,
    outcome,
    stripeRequestId: evidence.request_id,
    evidence,
  });
  return { state, evidence };
}

function defaultTransactionRunner(connectionString) {
  return (callback) => withNeonTransaction({ connectionString }, callback);
}

async function executePayoutV2Batch({
  connectionString,
  schoolId,
  batchId,
  expectedPlanFingerprint,
  stripeClient,
  runInTransaction = null,
  beforePersistSuccess = null,
  onAlert = null,
}) {
  if (!stripeClient?.transfers || typeof stripeClient.transfers.create !== 'function') {
    throw new TypeError('An injected Stripe client with transfers.create is required');
  }
  const transaction = runInTransaction || defaultTransactionRunner(connectionString);
  const prepared = await transaction((client) =>
    preparePayoutV2TransferIntentsInTransaction({
      client,
      schoolId,
      batchId,
      expectedPlanFingerprint,
    })
  );
  if (prepared.zero_transfer) return prepared;

  const results = [];
  for (const intent of prepared.transfer_intents) {
    const beginning = await transaction((client) =>
      beginSubmission(client, schoolId, Number(intent.id))
    );
    if (beginning.action !== 'submit') {
      results.push({
        transfer_id: Number(intent.id),
        state: beginning.transfer.state,
        action: beginning.action,
      });
      continue;
    }
    let stripeTransfer;
    try {
      stripeTransfer = await stripeClient.transfers.create(
        stripeCreateParams(beginning.transfer),
        { idempotencyKey: beginning.transfer.idempotency_key }
      );
    } catch (error) {
      const ambiguous = error?.confirmedNoTransfer !== true;
      const failure = await transaction((client) =>
        persistTransferFailure(client, schoolId, Number(intent.id), error, { ambiguous })
      );
      await emitTransferAlert(onAlert, {
        event: ambiguous
          ? 'transfer_submission_ambiguous'
          : 'transfer_submission_failed_confirmed',
        school_id: schoolId,
        payout_batch_id: batchId,
        payout_transfer_id: Number(intent.id),
        state: failure.state,
        error_code: error?.code || null,
        operator_review_required: ambiguous,
      });
      results.push({
        transfer_id: Number(intent.id),
        state: failure.state,
        operator_review_required: ambiguous,
      });
      continue;
    }

    try {
      if (typeof beforePersistSuccess === 'function') {
        await beforePersistSuccess({ transfer: beginning.transfer, stripeTransfer });
      }
      const evidence = await transaction((client) =>
        persistTransferSuccess(client, schoolId, Number(intent.id), stripeTransfer)
      );
      results.push({
        transfer_id: Number(intent.id),
        state: 'transferred',
        stripe_transfer_id: evidence.id,
      });
    } catch (localError) {
      const ambiguousError = Object.assign(
        new Error('Stripe succeeded but local persistence failed'),
        {
          code: 'stripe_success_local_write_failed',
          requestId: stripeTransfer.lastResponse?.requestId,
        }
      );
      const recoveryState = await transaction((client) =>
        persistTransferFailure(
          client,
          schoolId,
          Number(intent.id),
          ambiguousError,
          { ambiguous: true }
        )
      ).catch(() => null);
      if (recoveryState?.state === 'transferred') {
        results.push({
          transfer_id: Number(intent.id),
          state: 'transferred',
          stripe_transfer_id: stripeTransfer.id,
          reason: 'local_commit_confirmed_on_recheck',
        });
        continue;
      }
      await emitTransferAlert(onAlert, {
        event: 'stripe_success_local_write_failed',
        school_id: schoolId,
        payout_batch_id: batchId,
        payout_transfer_id: Number(intent.id),
        state: 'reconciling',
        stripe_transfer_id: stripeTransfer.id,
        operator_review_required: true,
      });
      results.push({
        transfer_id: Number(intent.id),
        state: 'reconciling',
        stripe_transfer_id: stripeTransfer.id,
        operator_review_required: true,
        reason: 'stripe_success_local_write_failed',
        local_error_code: localError.code || null,
      });
    }
  }
  return {
    ok: results.every((result) => result.state === 'transferred'),
    zero_transfer: false,
    batch_id: batchId,
    transfer_results: results,
  };
}

async function findStripeTransferForIntent(stripeClient, transfer) {
  if (nonEmpty(transfer.stripe_transfer_id)) {
    const found = await stripeClient.transfers.retrieve(transfer.stripe_transfer_id);
    return { match: found, authoritativeNoMatch: false };
  }
  if (typeof stripeClient.transfers.list !== 'function') {
    return { match: null, authoritativeNoMatch: false };
  }
  const page = await stripeClient.transfers.list({
    transfer_group: transfer.transfer_group,
    limit: 100,
  });
  const rows = Array.isArray(page?.data) ? page.data : [];
  const candidates = rows.filter((candidate) => {
    const evidence = immutableStripeEvidence(candidate);
    return (
      evidence.metadata.payout_v2_logical_transfer_fingerprint ===
        transfer.logical_transfer_fingerprint ||
      evidence.metadata.payout_v2_idempotency_key === transfer.idempotency_key
    );
  });
  if (candidates.length > 1) {
    throw transferError(
      'PAYOUT_V2_RECONCILIATION_DUPLICATE',
      'Multiple Stripe transfers match one logical obligation',
      candidates.map((candidate) => `stripe_transfer_id:${candidate.id}`)
    );
  }
  return {
    match: candidates[0] || null,
    authoritativeNoMatch:
      page?.has_more === false &&
      stripeClient.payoutV2AuthoritativeTransferGroupLookup === true,
  };
}

async function reconcilePayoutV2Transfer({
  connectionString,
  schoolId,
  transferId,
  stripeClient,
  runInTransaction = null,
  now = new Date(),
  onAlert = null,
}) {
  requirePositiveInteger(schoolId, 'schoolId');
  requirePositiveInteger(transferId, 'transferId');
  if (!stripeClient?.transfers) throw new TypeError('An injected Stripe client is required');
  const transaction = runInTransaction || defaultTransactionRunner(connectionString);
  const transfer = await transaction(async (client) => {
    const row = (await client.query(
      `SELECT *
         FROM payout_transfers
        WHERE school_id = $1
          AND id = $2
        LIMIT 1`,
      [schoolId, transferId]
    )).rows[0];
    if (!row) {
      throw transferError('PAYOUT_V2_TRANSFER_SCOPE_MISMATCH', 'Transfer was not found in school');
    }
    return row;
  });
  if (transfer.state === 'transferred') {
    return {
      ok: true,
      status: 'already_reconciled',
      transfer_id: transferId,
      stripe_transfer_id: transfer.stripe_transfer_id,
    };
  }
  if (!['submitting', 'reconciling'].includes(transfer.state)) {
    return {
      ok: false,
      status: 'not_reconcilable',
      operator_review_required: transfer.state !== 'failed_confirmed',
      reason: `transfer_state:${transfer.state}`,
    };
  }

  let lookup;
  try {
    lookup = await findStripeTransferForIntent(stripeClient, transfer);
  } catch (error) {
    await transaction((client) =>
      persistTransferFailure(client, schoolId, transferId, error, {
        ambiguous: true,
        attemptKind: 'reconciliation',
        outcome: 'operator_review',
      })
    );
    await emitTransferAlert(onAlert, {
      event: 'transfer_reconciliation_operator_review',
      school_id: schoolId,
      payout_transfer_id: transferId,
      state: 'reconciling',
      reasons: error.reasons || ['stripe_lookup_ambiguous'],
      operator_review_required: true,
    });
    return {
      ok: false,
      status: 'operator_review_required',
      operator_review_required: true,
      reasons: error.reasons || ['stripe_lookup_ambiguous'],
    };
  }
  if (lookup.match) {
    try {
      const evidence = await transaction((client) =>
        persistTransferSuccess(client, schoolId, transferId, lookup.match, {
          attemptKind: 'reconciliation',
          outcome: 'found',
        })
      );
      return {
        ok: true,
        status: 'reconciled_transferred',
        transfer_id: transferId,
        stripe_transfer_id: evidence.id,
      };
    } catch (error) {
      await transaction((client) =>
        persistTransferFailure(client, schoolId, transferId, error, {
          ambiguous: true,
          attemptKind: 'reconciliation',
          outcome: 'operator_review',
        })
      );
      await emitTransferAlert(onAlert, {
        event: 'transfer_reconciliation_identity_mismatch',
        school_id: schoolId,
        payout_transfer_id: transferId,
        state: 'reconciling',
        reasons: error.reasons || ['stripe_identity_mismatch'],
        operator_review_required: true,
      });
      return {
        ok: false,
        status: 'operator_review_required',
        operator_review_required: true,
        reasons: error.reasons || ['stripe_identity_mismatch'],
      };
    }
  }

  const requestedAt = transfer.request_created_at
    ? new Date(transfer.request_created_at).getTime()
    : NaN;
  const withinRetention =
    Number.isFinite(requestedAt) &&
    now.getTime() >= requestedAt &&
    now.getTime() - requestedAt <= IDEMPOTENCY_RETENTION_MS;
  if (lookup.authoritativeNoMatch && withinRetention) {
    const safeError = Object.assign(new Error('Authoritative Stripe lookup found no transfer'), {
      code: 'stripe_transfer_not_found',
      confirmedNoTransfer: true,
    });
    await transaction((client) =>
      persistTransferFailure(client, schoolId, transferId, safeError, {
        ambiguous: false,
        attemptKind: 'reconciliation',
        outcome: 'not_found_safe_retry',
      })
    );
    return {
      ok: false,
      status: 'not_found_safe_retry',
      safe_to_retry: true,
      operator_review_required: false,
      idempotency_key_reused: true,
    };
  }

  const unknown = Object.assign(new Error('Stripe transfer absence is not authoritative'), {
    code: 'stripe_transfer_lookup_unknown',
  });
  await transaction((client) =>
    persistTransferFailure(client, schoolId, transferId, unknown, {
      ambiguous: true,
      attemptKind: 'reconciliation',
      outcome: 'operator_review',
    })
  );
  await emitTransferAlert(onAlert, {
    event: 'transfer_reconciliation_operator_review',
    school_id: schoolId,
    payout_transfer_id: transferId,
    state: 'reconciling',
    reasons: [
      lookup.authoritativeNoMatch
        ? 'idempotency_retention_window_elapsed'
        : 'stripe_lookup_not_authoritative',
    ],
    operator_review_required: true,
  });
  return {
    ok: false,
    status: 'operator_review_required',
    safe_to_retry: false,
    operator_review_required: true,
    reasons: [
      lookup.authoritativeNoMatch
        ? 'idempotency_retention_window_elapsed'
        : 'stripe_lookup_not_authoritative',
    ],
  };
}

async function reconcilePayoutV2SameDay({
  connectionString,
  schoolId,
  stripeClient,
  runInTransaction = null,
  now = new Date(),
  onAlert = null,
}) {
  requirePositiveInteger(schoolId, 'schoolId');
  const transaction = runInTransaction || defaultTransactionRunner(connectionString);
  const since = new Date(now);
  since.setUTCHours(0, 0, 0, 0);
  const ids = await transaction(async (client) => {
    const result = await client.query(
      `SELECT id
         FROM payout_transfers
        WHERE school_id = $1
          AND state IN ('submitting', 'reconciling')
          AND request_created_at >= $2
        ORDER BY id`,
      [schoolId, since.toISOString()]
    );
    return result.rows.map((row) => Number(row.id));
  });
  const results = [];
  for (const transferId of ids) {
    results.push(await reconcilePayoutV2Transfer({
      connectionString,
      schoolId,
      transferId,
      stripeClient,
      runInTransaction: transaction,
      now,
      onAlert,
    }));
  }
  return {
    ok: results.every((result) => result.ok),
    mode: 'inactive_same_day_reconciliation',
    school_id: schoolId,
    checked_transfer_count: ids.length,
    results,
    production_cron_connected: false,
  };
}

module.exports = {
  TRANSFER_CALCULATION_VERSION,
  IDEMPOTENCY_RETENTION_MS,
  logicalTransferIdentity,
  emitTransferAlert,
  sourceTransferGroup,
  assertBatchPlanSnapshot,
  assertClaimAndEarningSnapshots,
  buildSourceLinkedTransferPlan,
  stripeCreateParams,
  assertStripeIdentity,
  loadValidatedBatchSnapshot,
  verifySourceCapacity,
  preparePayoutV2TransferIntentsInTransaction,
  beginSubmission,
  persistTransferSuccess,
  persistTransferFailure,
  executePayoutV2Batch,
  reconcilePayoutV2Transfer,
  reconcilePayoutV2SameDay,
};
