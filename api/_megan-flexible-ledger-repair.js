'use strict';

const crypto = require('crypto');

const REPAIR_VERSION = 'megan-flexible-ledger-repair-2026-09-13-v1';
const REPAIR_EVENT = 'megan_flexible_ledger_repair_2026_09_13';
const REPAIR_ACTION = 'credits.megan_flexible_ledger_repair';

const TARGET = Object.freeze({
  schoolId: 1,
  learnerId: 151,
  learnerName: 'Megan Cridland',
  instructorId: 6,
  instructorName: 'Simon Edwards',
  sourceId: 1,
  purchaseAmountPence: 81000,
  initialUnits: 30,
  unitMinutes: 30,
  ratePencePerUnit: 2700,
  ordinaryBalanceMinutes: 120,
  refundedBookingIds: [500, 501, 510],
  allocatedBookingIds: [500, 501],
  unallocatedBookingIds: [510],
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

function normaliseAllocation(row) {
  return {
    id: Number(row.id),
    bookingId: Number(row.booking_id),
    learnerId: Number(row.learner_id),
    instructorId: Number(row.instructor_id),
    sourceId: Number(row.source_id),
    units: Number(row.units_allocated),
    unitMinutes: Number(row.unit_minutes),
    ratePencePerUnit: Number(row.rate_pence_per_unit),
    contributionPence: Number(row.contribution_pence),
    status: row.status,
    durationMinutes: Number(row.minutes_deducted),
    paymentMethod: row.payment_method,
    creditReturned: row.credit_returned === true,
    returned: row.return_id != null,
    returnId: row.return_id == null ? null : Number(row.return_id),
    returnedUnits: row.return_units == null ? null : Number(row.return_units),
  };
}

function normaliseBooking(row) {
  return {
    id: Number(row.id),
    learnerId: Number(row.learner_id),
    instructorId: Number(row.instructor_id),
    status: row.status,
    durationMinutes: Number(row.minutes_deducted),
    paymentMethod: row.payment_method,
    creditReturned: row.credit_returned === true,
  };
}

function proposedChanges(evidence) {
  const allocations = evidence.allocations.map(normaliseAllocation);
  const active = allocations.filter(row => !row.returned).sort((a, b) => a.id - b.id);
  const previouslyReturned = allocations.filter(row => row.returned).sort((a, b) => a.id - b.id);
  return {
    allocation_returns: active.map(row => ({
      allocation_id: row.id,
      booking_id: row.bookingId,
      units_returned: row.units,
      reason: 'admin_eligible_cancellation',
    })),
    previously_returned_allocations: previouslyReturned.map(row => ({
      allocation_id: row.id,
      booking_id: row.bookingId,
      units_returned: row.returnedUnits,
    })),
    ordinary_lcb_delta_minutes: -TARGET.ordinaryBalanceMinutes,
    cancellation_minutes_explained_in_audit: TARGET.ordinaryBalanceMinutes,
    audit_action: REPAIR_ACTION,
    state_event: REPAIR_EVENT,
  };
}

async function readMeganRepairEvidence(client, { lock = false } = {}) {
  const identityLock = lock ? 'FOR UPDATE OF learner, instructor, lcb, source, purchase' : '';
  const allocationLock = lock ? 'FOR SHARE OF allocation, booking' : '';
  const [identity] = await query(client, `
    /* megan-repair:identity */
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

  const bookings = await query(client, `
    /* megan-repair:bookings */
    SELECT booking.id::int, booking.learner_id::int, booking.instructor_id::int,
           booking.status, booking.minutes_deducted::int, booking.payment_method,
           booking.credit_returned
      FROM lesson_bookings booking
     WHERE booking.school_id = $1
       AND booking.learner_id = $2
       AND booking.id = ANY($3::bigint[])
     ORDER BY booking.id
  `, [TARGET.schoolId, TARGET.learnerId, TARGET.refundedBookingIds]);

  const allocations = await query(client, `
    /* megan-repair:allocations */
    SELECT allocation.id::int, allocation.booking_id::int,
           allocation.learner_id::int, allocation.instructor_id::int,
           allocation.source_id::int, allocation.units_allocated::numeric,
           allocation.unit_minutes::int, allocation.rate_pence_per_unit::numeric,
           allocation.contribution_pence::int,
           booking.status, booking.minutes_deducted::int, booking.payment_method,
           booking.credit_returned,
           returned.id::int AS return_id,
           returned.units_returned::numeric AS return_units
      FROM flexible_package_booking_allocations allocation
      JOIN lesson_bookings booking
        ON booking.id = allocation.booking_id AND booking.school_id = allocation.school_id
      LEFT JOIN flexible_package_allocation_returns returned
        ON returned.allocation_id = allocation.id AND returned.school_id = allocation.school_id
     WHERE allocation.school_id = $1
       AND allocation.learner_id = $2
       AND allocation.source_id = $3
       AND allocation.booking_id = ANY($4::bigint[])
     ORDER BY allocation.booking_id, allocation.id
     ${allocationLock}
  `, [TARGET.schoolId, TARGET.learnerId, TARGET.sourceId, TARGET.refundedBookingIds]);

  const [totals] = await query(client, `
    /* megan-repair:totals */
    WITH active AS (
      SELECT allocation.*, booking.status, booking.minutes_deducted
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
           remaining.refundable_value_pence::int AS remaining_pence,
           COALESCE(SUM(active.units_allocated), 0)::numeric AS active_units,
           COALESCE(SUM(active.units_allocated) FILTER (WHERE active.status = 'chargeable'), 0)::numeric AS active_chargeable_units,
           COALESCE(SUM(active.units_allocated) FILTER (WHERE active.status = 'refunded'), 0)::numeric AS active_refunded_units,
           COALESCE(SUM(active.units_allocated) FILTER (WHERE active.booking_id = ANY($4::bigint[])), 0)::numeric AS target_active_units,
           (SELECT COALESCE(SUM(reduction.units_reduced), 0)::numeric
              FROM flexible_package_source_reductions reduction
             WHERE reduction.school_id = $1 AND reduction.source_id = $3) AS reduced_units,
           (SELECT COUNT(*)::int
              FROM booking_credit_sources bcs
              JOIN active active_booking ON active_booking.booking_id = bcs.booking_id
             WHERE bcs.school_id = $1 AND bcs.refunded_at IS NULL) AS mixed_funding_rows,
           (SELECT COUNT(*)::int FROM (
              SELECT active_booking.booking_id
                FROM active active_booking
               GROUP BY active_booking.booking_id
              HAVING ROUND(SUM(active_booking.units_allocated * active_booking.unit_minutes))::int
                   <> MAX(active_booking.minutes_deducted)::int
           ) mismatch) AS duration_mismatch_rows
      FROM flexible_package_source_remaining remaining
      LEFT JOIN active ON TRUE
     WHERE remaining.source_id = $3 AND remaining.school_id = $1 AND remaining.learner_id = $2
     GROUP BY remaining.remaining_units, remaining.refundable_value_pence
  `, [TARGET.schoolId, TARGET.learnerId, TARGET.sourceId, TARGET.refundedBookingIds]);

  const [marker] = await query(client, `
    /* megan-repair:marker */
    SELECT id::int, detail
      FROM flexible_package_state_events
     WHERE school_id = $1 AND learner_id = $2 AND source_id = $3 AND event_type = $4
     ORDER BY id DESC LIMIT 1
  `, [TARGET.schoolId, TARGET.learnerId, TARGET.sourceId, REPAIR_EVENT]);

  return {
    identity: identity || null,
    bookings,
    allocations,
    totals: totals || null,
    marker: marker || null,
  };
}

function evaluatePreconditions(evidence) {
  const identity = evidence.identity || {};
  const totals = evidence.totals || {};
  const bookings = (evidence.bookings || []).map(normaliseBooking);
  const allocations = evidence.allocations.map(normaliseAllocation);
  const bookingIds = bookings.map(row => row.id).sort((a, b) => a - b);
  const allocatedBookingIds = allocations.map(row => row.bookingId).sort((a, b) => a - b);
  const bookingsStructurallyValid = bookings.every(row => (
    row.learnerId === TARGET.learnerId
    && row.instructorId === TARGET.instructorId
    && row.status === 'refunded'
    && row.durationMinutes === 60
    && row.paymentMethod === 'flexible_package'
    && row.creditReturned
  ));
  const structurallyValid = allocations.every(row => (
    row.learnerId === TARGET.learnerId
    && row.instructorId === TARGET.instructorId
    && row.sourceId === TARGET.sourceId
    && row.units === 2
    && row.unitMinutes === TARGET.unitMinutes
    && row.ratePencePerUnit === TARGET.ratePencePerUnit
    && row.contributionPence === 5400
    && row.status === 'refunded'
    && row.durationMinutes === 60
    && row.paymentMethod === 'flexible_package'
    && (row.returned ? row.returnedUnits === 2 : row.creditReturned === true)
  ));
  const active = allocations.filter(row => !row.returned);
  const returned = allocations.filter(row => row.returned);

  return [
    check('repair marker absent', null, evidence.marker ? Number(evidence.marker.id) : null),
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
    check('exact refunded booking set', TARGET.refundedBookingIds, bookingIds),
    check('refunded booking structure', true, bookingsStructurallyValid),
    check('exact allocated booking set', TARGET.allocatedBookingIds, allocatedBookingIds),
    check('one allocation per allocated booking', 2, allocations.length),
    check('replacement booking has no allocation', false, allocatedBookingIds.includes(TARGET.unallocatedBookingIds[0])),
    check('affected allocation structure', true, structurallyValid),
    check('two active misclassified allocations', 2, active.length),
    check('no existing allocation returns', 0, returned.length),
    check('current source totals', [26, 70200, 4, 0, 4, 4, 0, 0, 0], [
      Number(totals.remaining_units ?? -1), Number(totals.remaining_pence ?? -1),
      Number(totals.active_units ?? -1), Number(totals.active_chargeable_units ?? -1),
      Number(totals.active_refunded_units ?? -1), Number(totals.target_active_units ?? -1),
      Number(totals.reduced_units ?? -1), Number(totals.mixed_funding_rows ?? -1),
      Number(totals.duration_mismatch_rows ?? -1),
    ]),
    check('total unused entitlement minutes', 900, Number(identity.lcb_minutes || 0) + Number(totals.remaining_units || 0) * TARGET.unitMinutes),
  ];
}

async function buildMeganRepairPreview(client, { lock = false } = {}) {
  const evidence = await readMeganRepairEvidence(client, { lock });
  const changes = proposedChanges(evidence);
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
  const ready = preconditions.every(row => row.ok);
  return {
    version: REPAIR_VERSION,
    mode: 'dry-run',
    mutation_performed: false,
    status: ready ? 'ready' : 'blocked',
    ready,
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
      flexible_remaining_units: 30,
      flexible_remaining_minutes: 900,
      flexible_remaining_gross_pence: 81000,
      active_units: 0,
      active_units_by_booking: { 500: 0, 501: 0, 510: 0 },
      unused_entitlement_minutes: 900,
    },
  };
}

async function readPostconditions(client) {
  const [row] = await query(client, `
    /* megan-repair:postconditions */
    WITH active AS (
      SELECT allocation.booking_id, allocation.units_allocated, allocation.unit_minutes,
             booking.status, booking.minutes_deducted
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
           COALESCE(SUM(active.units_allocated), 0)::numeric AS active_units,
           COALESCE(SUM(active.units_allocated) FILTER (WHERE active.status = 'refunded'), 0)::numeric AS refunded_active_units,
           COALESCE(SUM(active.units_allocated) FILTER (WHERE active.booking_id = ANY($5::bigint[])), 0)::numeric AS target_active_units,
           (SELECT COUNT(*)::int
              FROM flexible_package_booking_allocations allocation
             WHERE allocation.school_id = $1 AND allocation.learner_id = $2 AND allocation.source_id = $3
               AND allocation.booking_id = ANY($5::bigint[])
               AND EXISTS (
                 SELECT 1 FROM flexible_package_allocation_returns returned
                  WHERE returned.school_id = allocation.school_id AND returned.allocation_id = allocation.id
               )) AS target_returned_allocations,
           (SELECT COUNT(*)::int
              FROM flexible_package_booking_allocations allocation
             WHERE allocation.school_id = $1 AND allocation.learner_id = $2 AND allocation.source_id = $3
               AND allocation.booking_id = ANY($5::bigint[])) AS target_total_allocations,
           (SELECT COUNT(*)::int
              FROM flexible_package_booking_allocations allocation
             WHERE allocation.school_id = $1 AND allocation.learner_id = $2 AND allocation.source_id = $3
               AND allocation.booking_id = ANY($6::bigint[])) AS unallocated_booking_allocations,
           (SELECT COALESCE(SUM(reduction.units_reduced), 0)::numeric
              FROM flexible_package_source_reductions reduction
             WHERE reduction.school_id = $1 AND reduction.source_id = $3) AS reduced_units,
           (SELECT COUNT(*)::int
              FROM booking_credit_sources bcs
              JOIN active active_booking ON active_booking.booking_id = bcs.booking_id
             WHERE bcs.school_id = $1 AND bcs.refunded_at IS NULL) AS mixed_funding_rows,
           (SELECT COUNT(*)::int FROM (
              SELECT active_booking.booking_id
                FROM active active_booking
               GROUP BY active_booking.booking_id
              HAVING ROUND(SUM(active_booking.units_allocated * active_booking.unit_minutes))::int
                   <> MAX(active_booking.minutes_deducted)::int
           ) mismatch) AS duration_mismatch_rows
      FROM learner_credit_balances lcb
      JOIN flexible_package_source_remaining remaining
        ON remaining.school_id = lcb.school_id AND remaining.learner_id = lcb.learner_id AND remaining.source_id = $3
      LEFT JOIN active ON TRUE
     WHERE lcb.school_id = $1 AND lcb.learner_id = $2 AND lcb.instructor_id = $4
     GROUP BY lcb.balance_minutes, remaining.remaining_units, remaining.refundable_value_pence
  `, [TARGET.schoolId, TARGET.learnerId, TARGET.sourceId, TARGET.instructorId, TARGET.refundedBookingIds, TARGET.unallocatedBookingIds]);
  return row || null;
}

function assertPostconditions(post) {
  const checks = [
    check('ordinary LCB', 0, Number(post?.lcb_minutes ?? -1)),
    check('flexible remaining units', 30, Number(post?.remaining_units ?? -1)),
    check('flexible remaining gross pence', 81000, Number(post?.remaining_pence ?? -1)),
    check('no active package units', 0, Number(post?.active_units ?? -1)),
    check('no active units on refunded bookings', 0, Number(post?.refunded_active_units ?? -1)),
    check('no active units on target bookings', 0, Number(post?.target_active_units ?? -1)),
    check('both target allocations returned', 2, Number(post?.target_returned_allocations ?? -1)),
    check('exactly two target allocations exist', 2, Number(post?.target_total_allocations ?? -1)),
    check('replacement booking remains unallocated', 0, Number(post?.unallocated_booking_allocations ?? -1)),
    check('no source reductions', 0, Number(post?.reduced_units ?? -1)),
    check('no mixed Lesson Credit funding', 0, Number(post?.mixed_funding_rows ?? -1)),
    check('no active allocation-duration mismatch', 0, Number(post?.duration_mismatch_rows ?? -1)),
    check('unused entitlement minutes', 900, Number(post?.lcb_minutes || 0) + Number(post?.remaining_units || 0) * TARGET.unitMinutes),
  ];
  const failed = checks.filter(row => !row.ok);
  if (failed.length) {
    const error = new Error(`Megan repair postconditions failed: ${failed.map(row => row.name).join(', ')}`);
    error.code = 'MEGAN_REPAIR_POSTCONDITION_FAILED';
    error.checks = checks;
    throw error;
  }
  return checks;
}

async function applyMeganRepair(client, { reviewedFingerprint, adminId, operatorIdentity, evidenceReference }) {
  await client.query('SELECT pg_advisory_xact_lock($1::integer, hashtext($2)::integer)', [TARGET.schoolId, REPAIR_VERSION]);
  const preview = await buildMeganRepairPreview(client, { lock: true });
  if (preview.status === 'already_applied') {
    const post = await readPostconditions(client);
    const postconditionChecks = assertPostconditions(post);
    return { ...preview, mode: 'apply', idempotent: true, postconditions: postconditionChecks, after: post };
  }
  if (!preview.ready) {
    const error = new Error('Megan repair preconditions failed');
    error.code = 'MEGAN_REPAIR_PRECONDITION_FAILED';
    error.preview = preview;
    throw error;
  }
  if (reviewedFingerprint !== preview.plan_fingerprint) {
    const error = new Error('Reviewed Megan repair fingerprint does not match the live preview');
    error.code = 'MEGAN_REPAIR_FINGERPRINT_MISMATCH';
    throw error;
  }

  const admin = await client.query(
    'SELECT id, email FROM admin_users WHERE id = $1 AND school_id = $2 FOR SHARE',
    [adminId, TARGET.schoolId]
  );
  if (admin.rowCount !== 1) {
    throw Object.assign(new Error('Admin identity is not valid for school 1'), { code: 'MEGAN_REPAIR_ADMIN_SCOPE_MISMATCH' });
  }

  const allocationIds = preview.proposed_changes.allocation_returns.map(row => row.allocation_id);
  if (allocationIds.length !== 2) {
    throw Object.assign(new Error('Expected exactly two active allocations in reviewed plan'), { code: 'MEGAN_REPAIR_PLAN_COUNT_MISMATCH' });
  }
  const returned = await client.query(`
    INSERT INTO flexible_package_allocation_returns (school_id, allocation_id, booking_id, units_returned, reason)
    SELECT allocation.school_id, allocation.id, allocation.booking_id, allocation.units_allocated, 'admin_eligible_cancellation'
      FROM flexible_package_booking_allocations allocation
     WHERE allocation.school_id = $1 AND allocation.learner_id = $2 AND allocation.source_id = $3
       AND allocation.id = ANY($4::bigint[])
       AND allocation.booking_id = ANY($5::bigint[])
    ON CONFLICT (allocation_id) DO NOTHING
    RETURNING allocation_id, booking_id
  `, [TARGET.schoolId, TARGET.learnerId, TARGET.sourceId, allocationIds, TARGET.allocatedBookingIds]);
  if (returned.rowCount !== 2) {
    throw Object.assign(new Error('Expected two allocation returns'), { code: 'MEGAN_REPAIR_RETURN_COUNT_MISMATCH' });
  }

  const lcb = await client.query(`
    UPDATE learner_credit_balances
       SET balance_minutes = balance_minutes - $1, updated_at = NOW()
     WHERE school_id = $2 AND learner_id = $3 AND instructor_id = $4 AND balance_minutes = $1
    RETURNING balance_minutes
  `, [TARGET.ordinaryBalanceMinutes, TARGET.schoolId, TARGET.learnerId, TARGET.instructorId]);
  if (lcb.rowCount !== 1 || Number(lcb.rows[0].balance_minutes) !== 0) {
    throw Object.assign(new Error('Ordinary LCB did not move from exactly 120 to zero'), { code: 'MEGAN_REPAIR_LCB_MISMATCH' });
  }

  const detail = {
    version: REPAIR_VERSION,
    plan_fingerprint: preview.plan_fingerprint,
    evidence_reference: evidenceReference,
    operator_identity: operatorIdentity,
    returned_allocation_ids: returned.rows.map(row => Number(row.allocation_id)).sort((a, b) => a - b),
    affected_booking_ids: returned.rows.map(row => Number(row.booking_id)).sort((a, b) => a - b),
    previously_returned_allocations: preview.proposed_changes.previously_returned_allocations,
    ordinary_lcb_minutes_removed: TARGET.ordinaryBalanceMinutes,
    cancellation_minutes_previously_returned_to_wrong_ledger: TARGET.ordinaryBalanceMinutes,
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
    mode: 'apply',
    mutation_performed: true,
    idempotent: false,
    version: REPAIR_VERSION,
    plan_fingerprint: preview.plan_fingerprint,
    state_event_id: Number(stateEvent.rows[0].id),
    audit_id: Number(audit.rows[0].id),
    postconditions: postconditionChecks,
    after: post,
  };
}

module.exports = {
  REPAIR_ACTION,
  REPAIR_EVENT,
  REPAIR_VERSION,
  TARGET,
  applyMeganRepair,
  assertPostconditions,
  buildMeganRepairPreview,
  evaluatePreconditions,
  fingerprint,
  proposedChanges,
  readMeganRepairEvidence,
  readPostconditions,
};
