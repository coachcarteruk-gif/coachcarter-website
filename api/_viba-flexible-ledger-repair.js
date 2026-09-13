'use strict';

const crypto = require('crypto');

const REPAIR_VERSION = 'viba-flexible-ledger-repair-2026-09-13-v1';
const REPAIR_EVENT = 'viba_flexible_ledger_repair_2026_09_13';
const REPAIR_ACTION = 'credits.viba_flexible_ledger_repair';

const TARGET = Object.freeze({
  schoolId: 1,
  learnerId: 143,
  learnerName: 'Viba Balaji',
  instructorId: 6,
  instructorName: 'Simon Edwards',
  sourceId: 3,
  purchaseAmountPence: 81000,
  initialUnits: 30,
  unitMinutes: 30,
  ratePencePerUnit: 2700,
  ordinaryBalanceMinutes: 210,
  futureBookingId: 611,
  allocations: [
    { id: 7, bookingId: 536, units: 3, durationMinutes: 60, status: 'chargeable', replacementUnits: 2 },
    { id: 8, bookingId: 537, units: 3, durationMinutes: 90, status: 'refunded', replacementUnits: 0 },
    { id: 9, bookingId: 568, units: 3, durationMinutes: 60, status: 'chargeable', replacementUnits: 2 },
    { id: 10, bookingId: 569, units: 2, durationMinutes: 60, status: 'refunded', replacementUnits: 0 },
  ],
  correctionTransactionIds: [334, 371],
});

function rows(result) {
  return Array.isArray(result) ? result : (result?.rows || []);
}

async function query(client, text, params = []) {
  return rows(await client.query(text, params));
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

function fingerprint(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')}`;
}

function check(name, expected, actual) {
  return { name, expected, actual, ok: JSON.stringify(expected) === JSON.stringify(actual) };
}

function proposedChanges() {
  return {
    allocation_returns: TARGET.allocations.map(row => ({
      allocation_id: row.id,
      booking_id: row.bookingId,
      units_returned: row.units,
      reason: 'admin_eligible_cancellation',
    })),
    replacement_allocations: TARGET.allocations.filter(row => row.replacementUnits > 0).map(row => ({
      original_allocation_id: row.id,
      booking_id: row.bookingId,
      source_id: TARGET.sourceId,
      units_allocated: row.replacementUnits,
      unit_minutes: TARGET.unitMinutes,
      rate_pence_per_unit: TARGET.ratePencePerUnit,
      contribution_pence: row.replacementUnits * TARGET.ratePencePerUnit,
    })),
    ordinary_lcb_delta_minutes: -TARGET.ordinaryBalanceMinutes,
    source_adjustments: TARGET.correctionTransactionIds.map(id => ({
      credit_transaction_id: id,
      kind: 'admin_correction',
      minutes_adjusted: 30,
      pence_adjusted: 0,
    })),
    cancellation_minutes_explained_in_audit: 150,
    audit_action: REPAIR_ACTION,
    state_event: REPAIR_EVENT,
  };
}

async function readVibaRepairEvidence(client, { lock = false } = {}) {
  const identityLock = lock ? 'FOR UPDATE OF learner, instructor, lcb, source, purchase' : '';
  const allocationLock = lock ? 'FOR SHARE OF allocation, booking' : '';
  const [identity] = await query(client, `
    /* viba-repair:identity */
    SELECT learner.id AS learner_id, learner.name AS learner_name,
           instructor.id AS instructor_id, instructor.name AS instructor_name,
           lcb.balance_minutes::int AS lcb_minutes,
           source.id AS source_id, source.initial_units::numeric AS initial_units,
           source.unit_minutes::int AS unit_minutes,
           source.rate_pence_per_unit::numeric AS rate_pence_per_unit,
           source.original_value_pence::int AS original_value_pence,
           purchase.amount_pence::int AS purchase_amount_pence,
           purchase.total_units::numeric AS purchase_total_units,
           purchase.unit_minutes::int AS purchase_unit_minutes,
           purchase.rate_pence_per_unit::numeric AS purchase_rate_pence_per_unit
      FROM learner_users learner
      JOIN instructors instructor
        ON instructor.id = $2 AND instructor.school_id = $1
      JOIN learner_credit_balances lcb
        ON lcb.learner_id = learner.id AND lcb.instructor_id = instructor.id AND lcb.school_id = $1
      JOIN flexible_package_sources source
        ON source.id = $4 AND source.learner_id = learner.id AND source.school_id = $1
     JOIN flexible_package_purchases purchase
        ON purchase.id = source.purchase_id AND purchase.learner_id = learner.id AND purchase.school_id = $1
     WHERE learner.id = $3 AND learner.school_id = $1
     ${identityLock}
  `, [TARGET.schoolId, TARGET.instructorId, TARGET.learnerId, TARGET.sourceId]);

  const allocations = await query(client, `
    /* viba-repair:allocations */
    SELECT allocation.id::int, allocation.booking_id::int,
           allocation.learner_id::int, allocation.instructor_id::int,
           allocation.source_id::int, allocation.units_allocated::numeric,
           allocation.unit_minutes::int, allocation.rate_pence_per_unit::numeric,
           allocation.contribution_pence::int,
           booking.status, booking.minutes_deducted::int,
           returned.id::int AS return_id
      FROM flexible_package_booking_allocations allocation
      JOIN lesson_bookings booking
        ON booking.id = allocation.booking_id AND booking.school_id = allocation.school_id
      LEFT JOIN flexible_package_allocation_returns returned
        ON returned.allocation_id = allocation.id AND returned.school_id = allocation.school_id
     WHERE allocation.school_id = $1 AND allocation.id = ANY($2::bigint[])
     ORDER BY allocation.id
     ${allocationLock}
  `, [TARGET.schoolId, TARGET.allocations.map(row => row.id)]);

  const transactions = await query(client, `
    /* viba-repair:transactions */
    SELECT transaction.id::int, transaction.learner_id::int,
           transaction.instructor_id::int, transaction.school_id::int,
           transaction.type, transaction.minutes::int,
           COALESCE(SUM(adjustment.minutes_adjusted), 0)::int AS adjusted_minutes
      FROM credit_transactions transaction
      LEFT JOIN credit_source_adjustments adjustment
        ON adjustment.credit_transaction_id = transaction.id
     WHERE transaction.id = ANY($1::int[])
     GROUP BY transaction.id
     ORDER BY transaction.id
  `, [TARGET.correctionTransactionIds]);

  const [totals] = await query(client, `
    /* viba-repair:totals */
    WITH active AS (
      SELECT allocation.*, booking.status
        FROM flexible_package_booking_allocations allocation
        JOIN lesson_bookings booking
          ON booking.id = allocation.booking_id AND booking.school_id = allocation.school_id
       WHERE allocation.school_id = $1 AND allocation.learner_id = $2 AND allocation.source_id = $3
         AND NOT EXISTS (
           SELECT 1 FROM flexible_package_allocation_returns returned
            WHERE returned.allocation_id = allocation.id AND returned.school_id = allocation.school_id
         )
    )
    SELECT remaining.remaining_units::numeric,
           COALESCE(SUM(active.units_allocated), 0)::numeric AS active_units,
           COALESCE(SUM(active.units_allocated) FILTER (WHERE active.status = 'chargeable'), 0)::numeric AS active_chargeable_units,
           COALESCE(SUM(active.units_allocated) FILTER (WHERE active.status = 'refunded'), 0)::numeric AS active_refunded_units,
           COALESCE(SUM(active.units_allocated) FILTER (WHERE active.booking_id = $4 AND active.status = 'scheduled'), 0)::numeric AS future_booking_units,
           (SELECT COUNT(*)::int
              FROM booking_credit_sources bcs
              JOIN active active_booking ON active_booking.booking_id = bcs.booking_id
             WHERE bcs.school_id = $1 AND bcs.refunded_at IS NULL) AS mixed_funding_rows,
           (SELECT COUNT(*)::int FROM (
              SELECT active_booking.booking_id
                FROM active active_booking
                JOIN lesson_bookings booking
                  ON booking.id = active_booking.booking_id AND booking.school_id = $1
               GROUP BY active_booking.booking_id
              HAVING ROUND(SUM(active_booking.units_allocated * active_booking.unit_minutes))::int
                   <> MAX(booking.minutes_deducted)::int
           ) mismatch) AS duration_mismatch_rows
      FROM flexible_package_source_remaining remaining
      LEFT JOIN active ON TRUE
     WHERE remaining.source_id = $3 AND remaining.school_id = $1 AND remaining.learner_id = $2
     GROUP BY remaining.remaining_units
  `, [TARGET.schoolId, TARGET.learnerId, TARGET.sourceId, TARGET.futureBookingId]);

  const [schema] = await query(client, `
    /* viba-repair:schema */
    SELECT NOT EXISTS (
      SELECT 1
        FROM pg_constraint constraint_row
       WHERE constraint_row.conrelid = 'flexible_package_booking_allocations'::regclass
         AND constraint_row.contype = 'u'
         AND pg_get_constraintdef(constraint_row.oid) = 'UNIQUE (school_id, source_id, booking_id)'
    ) AS replacement_allocation_supported
  `);

  const [marker] = await query(client, `
    /* viba-repair:marker */
    SELECT id::int, detail
      FROM flexible_package_state_events
     WHERE school_id = $1 AND learner_id = $2 AND source_id = $3 AND event_type = $4
     ORDER BY id DESC LIMIT 1
  `, [TARGET.schoolId, TARGET.learnerId, TARGET.sourceId, REPAIR_EVENT]);

  return { identity: identity || null, allocations, transactions, totals: totals || null, schema: schema || null, marker: marker || null };
}

function evaluatePreconditions(evidence) {
  const identity = evidence.identity || {};
  const totals = evidence.totals || {};
  const actualAllocations = evidence.allocations.map(row => ({
    id: Number(row.id),
    bookingId: Number(row.booking_id),
    units: Number(row.units_allocated),
    durationMinutes: Number(row.minutes_deducted),
    status: row.status,
    sourceId: Number(row.source_id),
    learnerId: Number(row.learner_id),
    instructorId: Number(row.instructor_id),
    unitMinutes: Number(row.unit_minutes),
    ratePencePerUnit: Number(row.rate_pence_per_unit),
    contributionPence: Number(row.contribution_pence),
    returned: row.return_id != null,
  }));
  const expectedAllocations = TARGET.allocations.map(row => ({
    id: row.id,
    bookingId: row.bookingId,
    units: row.units,
    durationMinutes: row.durationMinutes,
    status: row.status,
    sourceId: TARGET.sourceId,
    learnerId: TARGET.learnerId,
    instructorId: TARGET.instructorId,
    unitMinutes: TARGET.unitMinutes,
    ratePencePerUnit: TARGET.ratePencePerUnit,
    contributionPence: row.units * TARGET.ratePencePerUnit,
    returned: false,
  }));
  const actualTransactions = evidence.transactions.map(row => ({
    id: Number(row.id), learnerId: Number(row.learner_id), instructorId: Number(row.instructor_id),
    schoolId: Number(row.school_id), type: row.type, minutes: Number(row.minutes),
    adjustedMinutes: Number(row.adjusted_minutes),
  }));
  const expectedTransactions = TARGET.correctionTransactionIds.map(id => ({
    id, learnerId: TARGET.learnerId, instructorId: TARGET.instructorId,
    schoolId: TARGET.schoolId, type: 'edit_adjustment', minutes: 30, adjustedMinutes: 0,
  }));

  return [
    check('repair marker absent', null, evidence.marker ? Number(evidence.marker.id) : null),
    check('replacement-allocation schema ready', true, evidence.schema?.replacement_allocation_supported === true),
    check('learner identity', [TARGET.learnerId, TARGET.learnerName], [Number(identity.learner_id || 0), identity.learner_name || null]),
    check('instructor identity', [TARGET.instructorId, TARGET.instructorName], [Number(identity.instructor_id || 0), identity.instructor_name || null]),
    check('ordinary LCB minutes', TARGET.ordinaryBalanceMinutes, Number(identity.lcb_minutes ?? -1)),
    check('source identity/value', [TARGET.sourceId, TARGET.initialUnits, TARGET.unitMinutes, TARGET.ratePencePerUnit, TARGET.purchaseAmountPence], [
      Number(identity.source_id || 0), Number(identity.initial_units || 0), Number(identity.unit_minutes || 0),
      Number(identity.rate_pence_per_unit || 0), Number(identity.original_value_pence || 0),
    ]),
    check('purchase identity/value', [TARGET.purchaseAmountPence, TARGET.initialUnits, TARGET.unitMinutes, TARGET.ratePencePerUnit], [
      Number(identity.purchase_amount_pence || 0), Number(identity.purchase_total_units || 0),
      Number(identity.purchase_unit_minutes || 0), Number(identity.purchase_rate_pence_per_unit || 0),
    ]),
    check('affected allocations', expectedAllocations, actualAllocations),
    check('edit adjustment transactions', expectedTransactions, actualTransactions),
    check('current source totals', [3, 27, 19, 5, 3, 0, 2], [
      Number(totals.remaining_units ?? -1), Number(totals.active_units ?? -1),
      Number(totals.active_chargeable_units ?? -1), Number(totals.active_refunded_units ?? -1),
      Number(totals.future_booking_units ?? -1), Number(totals.mixed_funding_rows ?? -1),
      Number(totals.duration_mismatch_rows ?? -1),
    ]),
    check('total unused entitlement minutes', 300, Number(identity.lcb_minutes || 0) + Number(totals.remaining_units || 0) * TARGET.unitMinutes),
  ];
}

async function buildVibaRepairPreview(client, { lock = false } = {}) {
  const evidence = await readVibaRepairEvidence(client, { lock });
  const changes = proposedChanges();
  const planFingerprint = fingerprint({ version: REPAIR_VERSION, target: TARGET, changes });
  if (evidence.marker) {
    return {
      version: REPAIR_VERSION,
      mode: 'dry-run',
      mutation_performed: false,
      status: 'already_applied',
      ready: false,
      plan_fingerprint: planFingerprint,
      marker: evidence.marker,
      evidence,
    };
  }
  const preconditions = evaluatePreconditions(evidence);
  return {
    version: REPAIR_VERSION,
    mode: 'dry-run',
    mutation_performed: false,
    status: preconditions.every(row => row.ok) ? 'ready' : 'blocked',
    ready: preconditions.every(row => row.ok),
    plan_fingerprint: planFingerprint,
    target: TARGET,
    preconditions,
    before: {
      ordinary_lcb_minutes: Number(evidence.identity?.lcb_minutes || 0),
      flexible_remaining_units: Number(evidence.totals?.remaining_units || 0),
      flexible_remaining_minutes: Number(evidence.totals?.remaining_units || 0) * TARGET.unitMinutes,
      total_unused_entitlement_minutes: Number(evidence.identity?.lcb_minutes || 0) + Number(evidence.totals?.remaining_units || 0) * TARGET.unitMinutes,
    },
    proposed_changes: changes,
    expected_after: {
      ordinary_lcb_minutes: 0,
      flexible_remaining_units: 10,
      flexible_remaining_minutes: 300,
      flexible_remaining_gross_pence: 27000,
      active_units_by_booking: { 536: 2, 537: 0, 568: 2, 569: 0, 611: 3 },
      delivered_units: 17,
      delivered_minutes: 510,
      future_units: 3,
      future_minutes: 90,
      unused_entitlement_minutes: 300,
    },
  };
}

async function readPostconditions(client) {
  const [row] = await query(client, `
    /* viba-repair:postconditions */
    WITH active AS (
      SELECT allocation.booking_id, allocation.units_allocated, booking.status
        FROM flexible_package_booking_allocations allocation
        JOIN lesson_bookings booking ON booking.id = allocation.booking_id AND booking.school_id = allocation.school_id
       WHERE allocation.school_id = $1 AND allocation.learner_id = $2 AND allocation.source_id = $3
         AND NOT EXISTS (
           SELECT 1 FROM flexible_package_allocation_returns returned
            WHERE returned.allocation_id = allocation.id AND returned.school_id = allocation.school_id
         )
    )
    SELECT lcb.balance_minutes::int AS lcb_minutes,
           remaining.remaining_units::numeric AS remaining_units,
           remaining.refundable_value_pence::int AS remaining_pence,
           COALESCE(SUM(active.units_allocated) FILTER (WHERE active.status = 'chargeable'),0)::numeric AS delivered_units,
           COALESCE(SUM(active.units_allocated) FILTER (WHERE active.status = 'refunded'),0)::numeric AS refunded_active_units,
           COALESCE(SUM(active.units_allocated) FILTER (WHERE active.booking_id = 536),0)::numeric AS booking_536_units,
           COALESCE(SUM(active.units_allocated) FILTER (WHERE active.booking_id = 537),0)::numeric AS booking_537_units,
           COALESCE(SUM(active.units_allocated) FILTER (WHERE active.booking_id = 568),0)::numeric AS booking_568_units,
           COALESCE(SUM(active.units_allocated) FILTER (WHERE active.booking_id = 569),0)::numeric AS booking_569_units,
           COALESCE(SUM(active.units_allocated) FILTER (WHERE active.booking_id = 611 AND active.status = 'scheduled'),0)::numeric AS booking_611_units,
           (SELECT COALESCE(SUM(adjustment.minutes_adjusted),0)::int
              FROM credit_source_adjustments adjustment
             WHERE adjustment.credit_transaction_id = ANY($5::int[])
               AND adjustment.kind = 'admin_correction') AS corrected_edit_minutes,
           (SELECT COUNT(*)::int
              FROM booking_credit_sources bcs
              JOIN active active_booking ON active_booking.booking_id = bcs.booking_id
             WHERE bcs.school_id = $1 AND bcs.refunded_at IS NULL) AS mixed_funding_rows,
           (SELECT COUNT(*)::int FROM (
              SELECT active_booking.booking_id
                FROM active active_booking
                JOIN lesson_bookings booking
                  ON booking.id = active_booking.booking_id AND booking.school_id = $1
               GROUP BY active_booking.booking_id
              HAVING ROUND(SUM(active_booking.units_allocated * 30))::int
                   <> MAX(booking.minutes_deducted)::int
           ) mismatch) AS duration_mismatch_rows
      FROM learner_credit_balances lcb
      JOIN flexible_package_source_remaining remaining
        ON remaining.school_id = lcb.school_id AND remaining.learner_id = lcb.learner_id AND remaining.source_id = $3
      LEFT JOIN active ON TRUE
     WHERE lcb.school_id = $1 AND lcb.learner_id = $2 AND lcb.instructor_id = $4
     GROUP BY lcb.balance_minutes, remaining.remaining_units, remaining.refundable_value_pence
  `, [TARGET.schoolId, TARGET.learnerId, TARGET.sourceId, TARGET.instructorId, TARGET.correctionTransactionIds]);
  return row || null;
}

function assertPostconditions(post) {
  const checks = [
    check('ordinary LCB', 0, Number(post?.lcb_minutes ?? -1)),
    check('flexible remaining units', 10, Number(post?.remaining_units ?? -1)),
    check('flexible remaining gross pence', 27000, Number(post?.remaining_pence ?? -1)),
    check('delivered units', 17, Number(post?.delivered_units ?? -1)),
    check('refunded active units', 0, Number(post?.refunded_active_units ?? -1)),
    check('booking #536 active units', 2, Number(post?.booking_536_units ?? -1)),
    check('booking #537 active units', 0, Number(post?.booking_537_units ?? -1)),
    check('booking #568 active units', 2, Number(post?.booking_568_units ?? -1)),
    check('booking #569 active units', 0, Number(post?.booking_569_units ?? -1)),
    check('booking #611 active units', 3, Number(post?.booking_611_units ?? -1)),
    check('edit adjustments accounted for additively', 60, Number(post?.corrected_edit_minutes ?? -1)),
    check('no mixed Lesson Credit funding', 0, Number(post?.mixed_funding_rows ?? -1)),
    check('no active allocation-duration mismatch', 0, Number(post?.duration_mismatch_rows ?? -1)),
    check('unused entitlement minutes', 300, Number(post?.lcb_minutes || 0) + Number(post?.remaining_units || 0) * TARGET.unitMinutes),
  ];
  const failed = checks.filter(row => !row.ok);
  if (failed.length) {
    const error = new Error(`Viba repair postconditions failed: ${failed.map(row => row.name).join(', ')}`);
    error.code = 'VIBA_REPAIR_POSTCONDITION_FAILED';
    error.checks = checks;
    throw error;
  }
  return checks;
}

async function applyVibaRepair(client, { reviewedFingerprint, adminId, operatorIdentity, evidenceReference }) {
  await client.query('SELECT pg_advisory_xact_lock($1::integer, hashtext($2)::integer)', [TARGET.schoolId, REPAIR_VERSION]);
  const preview = await buildVibaRepairPreview(client, { lock: true });
  if (preview.status === 'already_applied') {
    const post = await readPostconditions(client);
    const postconditionChecks = assertPostconditions(post);
    return { ...preview, mode: 'apply', idempotent: true, postconditions: postconditionChecks, after: post };
  }
  if (!preview.ready) {
    const error = new Error('Viba repair preconditions failed');
    error.code = 'VIBA_REPAIR_PRECONDITION_FAILED';
    error.preview = preview;
    throw error;
  }
  if (reviewedFingerprint !== preview.plan_fingerprint) {
    const error = new Error('Reviewed Viba repair fingerprint does not match the live preview');
    error.code = 'VIBA_REPAIR_FINGERPRINT_MISMATCH';
    throw error;
  }
  const admin = await client.query(
    'SELECT id, email FROM admin_users WHERE id = $1 AND school_id = $2 FOR SHARE',
    [adminId, TARGET.schoolId]
  );
  if (admin.rowCount !== 1) throw Object.assign(new Error('Admin identity is not valid for school 1'), { code: 'VIBA_REPAIR_ADMIN_SCOPE_MISMATCH' });

  const returned = await client.query(`
    INSERT INTO flexible_package_allocation_returns (school_id, allocation_id, booking_id, units_returned, reason)
    SELECT allocation.school_id, allocation.id, allocation.booking_id, allocation.units_allocated, 'admin_eligible_cancellation'
      FROM flexible_package_booking_allocations allocation
     WHERE allocation.school_id = $1 AND allocation.learner_id = $2 AND allocation.source_id = $3
       AND allocation.id = ANY($4::bigint[])
    ON CONFLICT (allocation_id) DO NOTHING
    RETURNING allocation_id
  `, [TARGET.schoolId, TARGET.learnerId, TARGET.sourceId, TARGET.allocations.map(row => row.id)]);
  if (returned.rowCount !== 4) throw Object.assign(new Error('Expected four allocation returns'), { code: 'VIBA_REPAIR_RETURN_COUNT_MISMATCH' });

  const replacements = await client.query(`
    INSERT INTO flexible_package_booking_allocations (
      school_id, learner_id, source_id, booking_id, instructor_id,
      units_allocated, unit_minutes, rate_pence_per_unit, contribution_pence
    )
    SELECT original.school_id, original.learner_id, original.source_id, original.booking_id, original.instructor_id,
           2, original.unit_minutes, original.rate_pence_per_unit, 2 * original.rate_pence_per_unit
      FROM flexible_package_booking_allocations original
     WHERE original.school_id = $1 AND original.id = ANY($2::bigint[])
     ORDER BY original.id
    RETURNING id, booking_id
  `, [TARGET.schoolId, [7, 9]]);
  if (replacements.rowCount !== 2) throw Object.assign(new Error('Expected two replacement allocations'), { code: 'VIBA_REPAIR_REPLACEMENT_COUNT_MISMATCH' });

  const lcb = await client.query(`
    UPDATE learner_credit_balances
       SET balance_minutes = balance_minutes - $1, updated_at = NOW()
     WHERE school_id = $2 AND learner_id = $3 AND instructor_id = $4 AND balance_minutes = $1
    RETURNING balance_minutes
  `, [TARGET.ordinaryBalanceMinutes, TARGET.schoolId, TARGET.learnerId, TARGET.instructorId]);
  if (lcb.rowCount !== 1 || Number(lcb.rows[0].balance_minutes) !== 0) {
    throw Object.assign(new Error('Ordinary LCB did not move from exactly 210 to zero'), { code: 'VIBA_REPAIR_LCB_MISMATCH' });
  }

  const correctionReason = `${REPAIR_VERSION}; ${evidenceReference}`;
  const corrections = await client.query(`
    INSERT INTO credit_source_adjustments (
      credit_transaction_id, kind, minutes_adjusted, pence_adjusted, reason, created_by
    )
    SELECT transaction.id, 'admin_correction', 30, 0, $1, $2
      FROM credit_transactions transaction
     WHERE transaction.id = ANY($3::int[]) AND transaction.school_id = $4
     ORDER BY transaction.id
    RETURNING id, credit_transaction_id
  `, [correctionReason, adminId, TARGET.correctionTransactionIds, TARGET.schoolId]);
  if (corrections.rowCount !== 2) throw Object.assign(new Error('Expected two additive source adjustments'), { code: 'VIBA_REPAIR_CORRECTION_COUNT_MISMATCH' });

  const detail = {
    version: REPAIR_VERSION,
    plan_fingerprint: preview.plan_fingerprint,
    evidence_reference: evidenceReference,
    operator_identity: operatorIdentity,
    returned_allocation_ids: TARGET.allocations.map(row => row.id),
    replacement_allocations: replacements.rows.map(row => ({ id: Number(row.id), booking_id: Number(row.booking_id) })),
    corrected_credit_transaction_ids: TARGET.correctionTransactionIds,
    ordinary_lcb_minutes_removed: TARGET.ordinaryBalanceMinutes,
    cancellation_minutes_previously_returned_to_wrong_ledger: 150,
  };
  const stateEvent = await client.query(`
    INSERT INTO flexible_package_state_events (school_id, learner_id, event_type, source_id, detail)
    VALUES ($1,$2,$3,$4,$5::jsonb)
    RETURNING id
  `, [TARGET.schoolId, TARGET.learnerId, REPAIR_EVENT, TARGET.sourceId, JSON.stringify(detail)]);

  const audit = await client.query(`
    INSERT INTO audit_log (admin_id, admin_email, action, target_type, target_id, details, ip_address, school_id)
    VALUES ($1,$2,$3,'learner',$4,$5::jsonb,'local_operator_tool',$6)
    RETURNING id
  `, [adminId, admin.rows[0].email, REPAIR_ACTION, String(TARGET.learnerId), JSON.stringify({ ...detail, state_event_id: Number(stateEvent.rows[0].id) }), TARGET.schoolId]);

  const post = await readPostconditions(client);
  const postconditionChecks = assertPostconditions(post);
  return {
    mode: 'apply', mutation_performed: true, idempotent: false,
    version: REPAIR_VERSION, plan_fingerprint: preview.plan_fingerprint,
    state_event_id: Number(stateEvent.rows[0].id), audit_id: Number(audit.rows[0].id),
    postconditions: postconditionChecks, after: post,
  };
}

module.exports = {
  REPAIR_ACTION,
  REPAIR_EVENT,
  REPAIR_VERSION,
  TARGET,
  applyVibaRepair,
  assertPostconditions,
  buildVibaRepairPreview,
  evaluatePreconditions,
  fingerprint,
  proposedChanges,
  readPostconditions,
  readVibaRepairEvidence,
};
