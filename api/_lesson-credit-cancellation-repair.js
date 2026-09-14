'use strict';

const crypto = require('crypto');

const TARGETS = Object.freeze({
  lloyd: Object.freeze({
    version: 'lloyd-zero-credit-cancellation-repair-2026-09-14-v2',
    action: 'credits.lloyd_zero_credit_cancellation_repair',
    schoolId: 1,
    schoolName: 'CoachCarter Driving School',
    learnerId: 27,
    learnerName: 'Lloyd',
    instructorId: 4,
    instructorName: 'Fraser Carter',
    lcbId: 43,
    lcbUpdatedAt: '2026-06-04T08:04:09.117643Z',
    beforeMinutes: 90,
    bookingId: 249,
    bookingCancelledAt: '2026-06-04T08:04:08.778296Z',
    bookingCreatedBy: 'instructor',
    bookingListPricePence: null,
    bookingListPriceSource: null,
    bookingScheduledDate: '2026-06-04',
    bookingStartTime: '13:00:00',
    bookingEndTime: '15:00:00',
    creditTransactionIds: [107],
    bookingIds: [234, 249],
    balanceAuditIds: [29, 30, 74],
    expectedBcs: [{
      id: 3, bookingId: 234, creditTransactionId: 107, minutes: 90,
      rate: 92, contributionPence: 8250, stripeFeePence: 177,
      absorbedBy: null, refundedAt: null,
    }],
    expectedCreditTransactions: [{
      id: 107, type: 'slot_purchase', minutes: 90, amountPence: 8250,
      paymentMethod: 'card', stripeFeePence: 177, effectiveRate: 92,
      source: 'stripe', absorbedBy: null,
    }],
    expectedPayouts: [{
      id: 72, payoutId: 7, bookingId: 234, pricePence: 8250,
      instructorAmountPence: 8073, commissionRate: '1.000',
      stripeFeePence: 177, payoutStatus: 'completed',
    }],
    expectedBalanceAudits: [
      { id: 29, oldMinutes: 0, newMinutes: 90, deltaMinutes: 90, createdAt: '2026-05-22T08:06:40.913Z' },
      { id: 30, oldMinutes: 90, newMinutes: 0, deltaMinutes: -90, createdAt: '2026-05-22T08:06:41.054Z' },
      { id: 74, oldMinutes: 0, newMinutes: 90, deltaMinutes: 90, createdAt: '2026-06-04T08:04:09.117Z' },
    ],
    bcsRestore: null,
  }),
  limkholwe: Object.freeze({
    version: 'limkholwe-free-trial-credit-repair-2026-09-14-v2',
    action: 'credits.limkholwe_free_trial_credit_repair',
    schoolId: 1,
    schoolName: 'CoachCarter Driving School',
    learnerId: 126,
    learnerName: 'limkholwe E Ngulube',
    instructorId: 4,
    instructorName: 'Fraser Carter',
    lcbId: 218,
    lcbUpdatedAt: '2026-07-06T11:52:59.630173Z',
    beforeMinutes: 90,
    bookingId: 331,
    bookingCancelledAt: '2026-07-06T11:52:59.164857Z',
    bookingCreatedBy: 'free_trial_self_serve',
    bookingListPricePence: 0,
    bookingListPriceSource: 'live_compute_insert',
    bookingScheduledDate: '2026-07-06',
    bookingStartTime: '13:30:00',
    bookingEndTime: '14:30:00',
    creditTransactionIds: [170],
    bookingIds: [331],
    balanceAuditIds: [195],
    expectedBcs: [{
      id: 91, bookingId: 331, creditTransactionId: 170, minutes: 60,
      rate: 0, contributionPence: 0, stripeFeePence: 0,
      absorbedBy: 'platform', refundedAt: '2026-07-06T11:52:59.267428Z',
    }],
    expectedCreditTransactions: [{
      id: 170, type: 'free_trial', minutes: 60, amountPence: 0,
      paymentMethod: 'free', stripeFeePence: 0, effectiveRate: 0,
      source: 'free_trial', absorbedBy: 'platform',
    }],
    expectedPayouts: [],
    expectedBalanceAudits: [
      { id: 195, oldMinutes: 0, newMinutes: 90, deltaMinutes: 90, createdAt: '2026-07-06T11:52:59.630Z' },
    ],
    bcsRestore: Object.freeze({ id: 91, refundedAt: '2026-07-06T11:52:59.267428Z' }),
  }),
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

function iso(value) {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function check(name, expected, actual) {
  return { name, expected, actual, ok: JSON.stringify(expected) === JSON.stringify(actual) };
}

function targetFor(key) {
  const target = TARGETS[key];
  if (!target) throw new Error(`Unknown cancellation-credit repair target: ${key}`);
  return target;
}

function proposedChanges(target) {
  return {
    learner_credit_balance: { id: target.lcbId, before_minutes: target.beforeMinutes, after_minutes: 0 },
    aggregate_shadow: { learner_id: target.learnerId, before_minutes: target.beforeMinutes, after_minutes: 0 },
    booking: { id: target.bookingId, credit_returned_before: true, credit_returned_after: false },
    booking_credit_source: target.bcsRestore
      ? { id: target.bcsRestore.id, refunded_at_before: target.bcsRestore.refundedAt, refunded_at_after: null }
      : null,
    untouched: ['credit_transactions', 'credit_source_adjustments', 'refund_events', 'refund_event_lines', 'payouts'],
    audit_action: target.action,
  };
}

function planFingerprint(target) {
  return fingerprint({ version: target.version, target: {
    schoolId: target.schoolId,
    learnerId: target.learnerId,
    instructorId: target.instructorId,
    bookingId: target.bookingId,
  }, changes: proposedChanges(target) });
}

async function readEvidence(client, key, { lock = false } = {}) {
  const target = targetFor(key);
  const identityLock = lock ? 'FOR UPDATE OF learner, lcb' : '';
  const bookingLock = lock ? 'FOR UPDATE OF booking' : '';
  const bcsLock = lock ? 'FOR UPDATE OF bcs' : '';
  const [identity] = await query(client, `
    /* cancellation-credit-repair:identity */
    SELECT school.id::int AS school_id, school.name AS school_name,
           learner.id::int AS learner_id, learner.name AS learner_name,
           learner.balance_minutes::int AS aggregate_minutes,
           learner.credit_balance::int AS aggregate_credits,
           instructor.id::int AS instructor_id, instructor.name AS instructor_name,
           instructor.payouts_paused,
           lcb.id::int AS lcb_id, lcb.balance_minutes::int AS lcb_minutes,
           lcb.grandfathered_at, lcb.updated_at,
           to_char(lcb.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS lcb_updated_at_exact
      FROM schools school
      JOIN learner_users learner ON learner.id = $2 AND learner.school_id = school.id
      JOIN instructors instructor ON instructor.id = $3 AND instructor.school_id = school.id
      JOIN learner_credit_balances lcb
        ON lcb.learner_id = learner.id AND lcb.instructor_id = instructor.id AND lcb.school_id = school.id
     WHERE school.id = $1
     ${identityLock}
  `, [target.schoolId, target.learnerId, target.instructorId]);

  const [booking] = await query(client, `
    /* cancellation-credit-repair:booking */
    SELECT booking.id::int, booking.learner_id::int, booking.instructor_id::int,
           booking.school_id::int, booking.status, booking.created_by,
           booking.payment_method, booking.minutes_deducted::int,
           booking.list_price_pence::int, booking.list_price_source,
           booking.credit_returned, booking.credit_forfeited,
           booking.cancelled_at, booking.edited_at,
           to_char(booking.cancelled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cancelled_at_exact,
           to_char(booking.edited_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS edited_at_exact,
           booking.scheduled_date::text, booking.start_time::text, booking.end_time::text
      FROM lesson_bookings booking
     WHERE booking.id = $2 AND booking.school_id = $1
       AND booking.learner_id = $3 AND booking.instructor_id = $4
     ${bookingLock}
  `, [target.schoolId, target.bookingId, target.learnerId, target.instructorId]);

  const bookingCreditSources = await query(client, `
    /* cancellation-credit-repair:bcs */
    SELECT bcs.id::int, bcs.booking_id::int, bcs.credit_transaction_id::int,
           bcs.minutes_drawn::int, bcs.rate_pence_per_minute::int,
           bcs.contribution_pence::int, bcs.stripe_fee_pence::int,
           bcs.absorbed_by, bcs.refunded_at,
           to_char(bcs.refunded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS refunded_at_exact
      FROM booking_credit_sources bcs
     WHERE bcs.school_id = $1 AND bcs.booking_id = ANY($2::bigint[])
     ORDER BY bcs.id
     ${bcsLock}
  `, [target.schoolId, target.bookingIds]);

  const creditTransactions = await query(client, `
    /* cancellation-credit-repair:credit-transactions */
    SELECT id::int, learner_id::int, instructor_id::int, school_id::int,
           type, minutes::int, amount_pence::int, payment_method,
           stripe_fee_pence::int, effective_rate_pence_per_minute::int,
           source, absorbed_by
      FROM credit_transactions
     WHERE school_id = $1 AND id = ANY($2::bigint[])
     ORDER BY id
  `, [target.schoolId, target.creditTransactionIds]);

  const balanceAudits = await query(client, `
    /* cancellation-credit-repair:balance-audit */
    SELECT id::int, learner_id::int, old_balance_minutes::int,
           new_balance_minutes::int, delta_minutes::int, created_at
      FROM balance_audit
     WHERE learner_id = $1 AND id = ANY($2::bigint[])
     ORDER BY id
  `, [target.learnerId, target.balanceAuditIds]);

  const payouts = await query(client, `
    /* cancellation-credit-repair:payouts */
    SELECT line.id::int, line.payout_id::int, line.booking_id::int,
           line.price_pence::int, line.instructor_amount_pence::int,
           line.commission_rate::text, line.stripe_fee_pence::int,
           payout.status AS payout_status
      FROM payout_line_items line
      JOIN instructor_payouts payout ON payout.id = line.payout_id
     WHERE line.school_id = $1 AND line.booking_id = ANY($2::bigint[])
     ORDER BY line.id
  `, [target.schoolId, target.bookingIds]);

  const [contradictions] = await query(client, `
    /* cancellation-credit-repair:contradictions */
    SELECT
      (SELECT COUNT(*)::int FROM credit_source_adjustments adjustment
        WHERE adjustment.credit_transaction_id = ANY($1::bigint[])) AS source_adjustments,
      (SELECT COUNT(*)::int FROM refund_event_lines line
        WHERE line.school_id = $2
          AND (line.credit_transaction_id = ANY($1::bigint[])
            OR line.booking_credit_source_id = ANY($3::bigint[]))) AS refund_lines,
      (SELECT COUNT(*)::int FROM flexible_package_booking_allocations allocation
        WHERE allocation.school_id = $2 AND allocation.booking_id = ANY($4::bigint[])) AS flexible_allocations
  `, [target.creditTransactionIds, target.schoolId, target.expectedBcs.map(row => row.id), target.bookingIds]);

  const [reconciliation] = await query(client, `
    /* cancellation-credit-repair:reconciliation */
    WITH purchases AS (
      SELECT COALESCE(SUM(minutes), 0)::int AS minutes
        FROM credit_transactions
       WHERE school_id = $1 AND learner_id = $2 AND instructor_id = $3
    ), active_bcs AS (
      SELECT COALESCE(SUM(bcs.minutes_drawn), 0)::int AS minutes
        FROM booking_credit_sources bcs
        JOIN credit_transactions ct ON ct.id = bcs.credit_transaction_id
       WHERE bcs.school_id = $1 AND ct.school_id = $1
         AND ct.learner_id = $2 AND ct.instructor_id = $3
         AND bcs.refunded_at IS NULL
    ), adjustments AS (
      SELECT COALESCE(SUM(adjustment.minutes_adjusted), 0)::int AS minutes
        FROM credit_source_adjustments adjustment
        JOIN credit_transactions ct ON ct.id = adjustment.credit_transaction_id
       WHERE ct.school_id = $1 AND ct.learner_id = $2 AND ct.instructor_id = $3
    ), unattributed_bookings AS (
      SELECT COALESCE(SUM(booking.minutes_deducted), 0)::int AS minutes
        FROM lesson_bookings booking
       WHERE booking.school_id = $1 AND booking.learner_id = $2 AND booking.instructor_id = $3
         AND booking.credit_returned = FALSE
         AND COALESCE(booking.payment_method, '') <> 'flexible_package'
         AND booking.minutes_deducted > 0
         AND NOT EXISTS (
           SELECT 1 FROM booking_credit_sources bcs
            WHERE bcs.school_id = booking.school_id AND bcs.booking_id = booking.id
         )
    )
    SELECT purchases.minutes AS purchase_minutes,
           active_bcs.minutes AS active_bcs_minutes,
           adjustments.minutes AS adjustment_minutes,
           unattributed_bookings.minutes AS unattributed_booking_minutes,
           purchases.minutes - active_bcs.minutes - adjustments.minutes
             - unattributed_bookings.minutes AS computed_minutes
      FROM purchases, active_bcs, adjustments, unattributed_bookings
  `, [target.schoolId, target.learnerId, target.instructorId]);

  const [marker] = await query(client, `
    /* cancellation-credit-repair:marker */
    SELECT id::int, details, created_at
      FROM audit_log
     WHERE school_id = $1 AND action = $2
       AND target_type = 'learner' AND target_id = $3
     ORDER BY id DESC LIMIT 1
  `, [target.schoolId, target.action, target.learnerId]);

  return {
    identity: identity || null,
    booking: booking || null,
    bookingCreditSources,
    creditTransactions,
    balanceAudits,
    payouts,
    contradictions: contradictions || null,
    reconciliation: reconciliation || null,
    marker: marker || null,
  };
}

function normaliseBcs(row) {
  return {
    id: Number(row.id), bookingId: Number(row.booking_id),
    creditTransactionId: Number(row.credit_transaction_id), minutes: Number(row.minutes_drawn),
    rate: Number(row.rate_pence_per_minute), contributionPence: Number(row.contribution_pence),
    stripeFeePence: Number(row.stripe_fee_pence), absorbedBy: row.absorbed_by,
    refundedAt: row.refunded_at_exact,
  };
}

function normaliseCreditTransaction(row) {
  return {
    id: Number(row.id), type: row.type, minutes: Number(row.minutes),
    amountPence: Number(row.amount_pence), paymentMethod: row.payment_method,
    stripeFeePence: row.stripe_fee_pence == null ? null : Number(row.stripe_fee_pence),
    effectiveRate: row.effective_rate_pence_per_minute == null ? null : Number(row.effective_rate_pence_per_minute),
    source: row.source, absorbedBy: row.absorbed_by,
  };
}

function normalisePayout(row) {
  return {
    id: Number(row.id), payoutId: Number(row.payout_id), bookingId: Number(row.booking_id),
    pricePence: Number(row.price_pence), instructorAmountPence: Number(row.instructor_amount_pence),
    commissionRate: row.commission_rate, stripeFeePence: Number(row.stripe_fee_pence),
    payoutStatus: row.payout_status,
  };
}

function normaliseBalanceAudit(row) {
  return {
    id: Number(row.id), oldMinutes: Number(row.old_balance_minutes),
    newMinutes: Number(row.new_balance_minutes), deltaMinutes: Number(row.delta_minutes),
    createdAt: iso(row.created_at),
  };
}

function evaluatePreconditions(evidence, key) {
  const target = targetFor(key);
  const identity = evidence.identity || {};
  const booking = evidence.booking || {};
  const reconciliation = evidence.reconciliation || {};
  const contradictions = evidence.contradictions || {};
  return [
    check('repair marker absent', null, evidence.marker ? Number(evidence.marker.id) : null),
    check('school identity', [target.schoolId, target.schoolName], [Number(identity.school_id || 0), identity.school_name || null]),
    check('learner identity', [target.learnerId, target.learnerName], [Number(identity.learner_id || 0), identity.learner_name || null]),
    check('instructor identity', [target.instructorId, target.instructorName], [Number(identity.instructor_id || 0), identity.instructor_name || null]),
    check('LCB exact state', [target.lcbId, target.beforeMinutes, null, target.lcbUpdatedAt], [
      Number(identity.lcb_id || 0), Number(identity.lcb_minutes ?? -1),
      iso(identity.grandfathered_at), identity.lcb_updated_at_exact || null,
    ]),
    check('aggregate shadow exact state', [target.beforeMinutes, 0], [Number(identity.aggregate_minutes ?? -1), Number(identity.aggregate_credits ?? -1)]),
    check('target booking exact state', [
      target.bookingId, target.learnerId, target.instructorId, target.schoolId,
      'refunded', target.bookingCreatedBy, 'free', 0,
      target.bookingListPricePence, target.bookingListPriceSource,
      true, false, target.bookingCancelledAt, null,
      target.bookingScheduledDate, target.bookingStartTime, target.bookingEndTime,
    ], [
      Number(booking.id || 0), Number(booking.learner_id || 0), Number(booking.instructor_id || 0), Number(booking.school_id || 0),
      booking.status || null, booking.created_by || null, booking.payment_method || null, Number(booking.minutes_deducted ?? -1),
      booking.list_price_pence == null ? null : Number(booking.list_price_pence), booking.list_price_source || null,
      booking.credit_returned === true, booking.credit_forfeited === true,
      booking.cancelled_at_exact || null, booking.edited_at_exact || null,
      booking.scheduled_date || null, booking.start_time || null, booking.end_time || null,
    ]),
    check('exact booking credit sources', target.expectedBcs, evidence.bookingCreditSources.map(normaliseBcs)),
    check('exact credit transactions', target.expectedCreditTransactions, evidence.creditTransactions.map(normaliseCreditTransaction)),
    check('exact causal balance audit', target.expectedBalanceAudits, evidence.balanceAudits.map(normaliseBalanceAudit)),
    check('exact payout evidence', target.expectedPayouts, evidence.payouts.map(normalisePayout)),
    check('no source adjustment/refund/flexible contradiction', [0, 0, 0], [
      Number(contradictions.source_adjustments ?? -1), Number(contradictions.refund_lines ?? -1),
      Number(contradictions.flexible_allocations ?? -1),
    ]),
    check('current reconciliation', key === 'lloyd' ? [90, 90, 0, 0, 0] : [60, 0, 0, 0, 60], [
      Number(reconciliation.purchase_minutes ?? -1), Number(reconciliation.active_bcs_minutes ?? -1),
      Number(reconciliation.adjustment_minutes ?? -1), Number(reconciliation.unattributed_booking_minutes ?? -1),
      Number(reconciliation.computed_minutes ?? -1),
    ]),
  ];
}

async function buildCancellationCreditRepairPreview(client, key, { lock = false } = {}) {
  const target = targetFor(key);
  const evidence = await readEvidence(client, key, { lock });
  const repairFingerprint = planFingerprint(target);
  if (evidence.marker) {
    return {
      version: target.version, mode: 'dry-run', mutation_performed: false,
      status: 'already_applied', ready: false, plan_fingerprint: repairFingerprint,
      marker: evidence.marker,
    };
  }
  const preconditions = evaluatePreconditions(evidence, key);
  const ready = preconditions.every(row => row.ok);
  return {
    version: target.version, mode: 'dry-run', mutation_performed: false,
    status: ready ? 'ready' : 'blocked', ready, plan_fingerprint: repairFingerprint,
    target: { school_id: target.schoolId, learner_id: target.learnerId, instructor_id: target.instructorId, booking_id: target.bookingId },
    preconditions,
    before: {
      lcb_minutes: Number(evidence.identity?.lcb_minutes || 0),
      aggregate_shadow_minutes: Number(evidence.identity?.aggregate_minutes || 0),
      computed_ledger_minutes: Number(evidence.reconciliation?.computed_minutes || 0),
    },
    proposed_changes: proposedChanges(target),
    expected_after: {
      lcb_minutes: 0, aggregate_shadow_minutes: 0, computed_ledger_minutes: 0,
      booking_credit_returned: false,
      booking_credit_source_refunded_at: target.bcsRestore ? null : 'unchanged',
    },
  };
}

async function readPostconditions(client, key) {
  const target = targetFor(key);
  const [row] = await query(client, `
    /* cancellation-credit-repair:postconditions */
    SELECT lcb.balance_minutes::int AS lcb_minutes,
           learner.balance_minutes::int AS aggregate_minutes,
           learner.credit_balance::int AS aggregate_credits,
           booking.status, booking.credit_returned, booking.minutes_deducted::int,
           (SELECT refunded_at FROM booking_credit_sources WHERE id = $5 AND school_id = $1) AS bcs_refunded_at,
           (SELECT COUNT(*)::int FROM audit_log
             WHERE school_id = $1 AND action = $6 AND target_type = 'learner' AND target_id = $2) AS marker_count,
           (SELECT COUNT(*)::int FROM refund_event_lines line
             WHERE line.school_id = $1 AND line.credit_transaction_id = ANY($7::bigint[])) AS refund_lines,
           (SELECT COUNT(*)::int FROM payout_line_items line
             WHERE line.school_id = $1 AND line.booking_id = $4) AS target_booking_payout_lines
      FROM learner_users learner
      JOIN learner_credit_balances lcb
        ON lcb.learner_id = learner.id AND lcb.instructor_id = $3 AND lcb.school_id = learner.school_id
      JOIN lesson_bookings booking
        ON booking.id = $4 AND booking.learner_id = learner.id AND booking.school_id = learner.school_id
     WHERE learner.school_id = $1 AND learner.id = $2
  `, [target.schoolId, target.learnerId, target.instructorId, target.bookingId, target.bcsRestore?.id || -1, target.action, target.creditTransactionIds]);

  const [reconciliation] = await query(client, `
    WITH purchases AS (
      SELECT COALESCE(SUM(minutes), 0)::int minutes FROM credit_transactions
       WHERE school_id=$1 AND learner_id=$2 AND instructor_id=$3
    ), bcs AS (
      SELECT COALESCE(SUM(source.minutes_drawn), 0)::int minutes
        FROM booking_credit_sources source JOIN credit_transactions tx ON tx.id=source.credit_transaction_id
       WHERE source.school_id=$1 AND tx.school_id=$1 AND tx.learner_id=$2 AND tx.instructor_id=$3
         AND source.refunded_at IS NULL
    ), csa AS (
      SELECT COALESCE(SUM(adjustment.minutes_adjusted), 0)::int minutes
        FROM credit_source_adjustments adjustment JOIN credit_transactions tx ON tx.id=adjustment.credit_transaction_id
       WHERE tx.school_id=$1 AND tx.learner_id=$2 AND tx.instructor_id=$3
    ) SELECT purchases.minutes-bcs.minutes-csa.minutes AS computed_minutes FROM purchases,bcs,csa
  `, [target.schoolId, target.learnerId, target.instructorId]);
  return { ...(row || {}), computed_minutes: reconciliation?.computed_minutes };
}

function assertPostconditions(post, key) {
  const target = targetFor(key);
  const checks = [
    check('LCB zero', 0, Number(post?.lcb_minutes ?? -1)),
    check('aggregate shadow zero', [0, 0], [Number(post?.aggregate_minutes ?? -1), Number(post?.aggregate_credits ?? -1)]),
    check('booking remains refunded without returned Lesson Credit', ['refunded', false, 0], [post?.status, post?.credit_returned === true, Number(post?.minutes_deducted ?? -1)]),
    check('computed ledger zero', 0, Number(post?.computed_minutes ?? -1)),
    check('one repair marker', 1, Number(post?.marker_count ?? -1)),
    check('no refund ledger rows', 0, Number(post?.refund_lines ?? -1)),
    check('target booking not paid out', 0, Number(post?.target_booking_payout_lines ?? -1)),
    check('BCS restored as active when required', null, target.bcsRestore ? iso(post?.bcs_refunded_at) : null),
  ];
  const failed = checks.filter(row => !row.ok);
  if (failed.length) {
    const error = new Error(`Cancellation-credit repair postconditions failed: ${failed.map(row => row.name).join(', ')}`);
    error.code = 'CANCELLATION_CREDIT_REPAIR_POSTCONDITION_FAILED';
    error.checks = checks;
    throw error;
  }
  return checks;
}

async function applyCancellationCreditRepair(client, key, { reviewedFingerprint, adminId, operatorIdentity, evidenceReference }) {
  const target = targetFor(key);
  await client.query('SELECT pg_advisory_xact_lock($1::integer, hashtext($2)::integer)', [target.schoolId, target.version]);
  const preview = await buildCancellationCreditRepairPreview(client, key, { lock: true });
  if (preview.status === 'already_applied') {
    const post = await readPostconditions(client, key);
    return { ...preview, mode: 'apply', idempotent: true, postconditions: assertPostconditions(post, key), after: post };
  }
  if (!preview.ready) {
    const error = new Error('Cancellation-credit repair preconditions failed');
    error.code = 'CANCELLATION_CREDIT_REPAIR_PRECONDITION_FAILED';
    error.preview = preview;
    throw error;
  }
  if (reviewedFingerprint !== preview.plan_fingerprint) {
    throw Object.assign(new Error('Reviewed repair fingerprint does not match the live preview'), { code: 'CANCELLATION_CREDIT_REPAIR_FINGERPRINT_MISMATCH' });
  }

  const admin = await client.query('SELECT id,email FROM admin_users WHERE id=$1 AND school_id=$2 FOR SHARE', [adminId, target.schoolId]);
  if (admin.rowCount !== 1) {
    throw Object.assign(new Error('Admin identity is outside the repair school'), { code: 'CANCELLATION_CREDIT_REPAIR_ADMIN_SCOPE_MISMATCH' });
  }

  if (target.bcsRestore) {
    const restored = await client.query(`
      UPDATE booking_credit_sources SET refunded_at = NULL
       WHERE id=$1 AND school_id=$2 AND booking_id=$3
         AND credit_transaction_id=$4 AND refunded_at=$5::timestamptz
      RETURNING id
    `, [target.bcsRestore.id, target.schoolId, target.bookingId, target.creditTransactionIds[0], target.bcsRestore.refundedAt]);
    if (restored.rowCount !== 1) throw Object.assign(new Error('Expected one exact BCS restoration'), { code: 'CANCELLATION_CREDIT_REPAIR_BCS_MISMATCH' });
  }

  const booking = await client.query(`
    UPDATE lesson_bookings SET credit_returned=FALSE
     WHERE id=$1 AND school_id=$2 AND learner_id=$3 AND instructor_id=$4
       AND status='refunded' AND payment_method='free' AND minutes_deducted=0
       AND credit_returned=TRUE AND cancelled_at=$5::timestamptz
    RETURNING id
  `, [target.bookingId, target.schoolId, target.learnerId, target.instructorId, target.bookingCancelledAt]);
  if (booking.rowCount !== 1) throw Object.assign(new Error('Expected one exact booking correction'), { code: 'CANCELLATION_CREDIT_REPAIR_BOOKING_MISMATCH' });

  const lcb = await client.query(`
    UPDATE learner_credit_balances SET balance_minutes=0, updated_at=NOW()
     WHERE id=$1 AND school_id=$2 AND learner_id=$3 AND instructor_id=$4
       AND balance_minutes=$5 AND updated_at=$6::timestamptz
    RETURNING id
  `, [target.lcbId, target.schoolId, target.learnerId, target.instructorId, target.beforeMinutes, target.lcbUpdatedAt]);
  if (lcb.rowCount !== 1) throw Object.assign(new Error('Expected one exact LCB correction'), { code: 'CANCELLATION_CREDIT_REPAIR_LCB_MISMATCH' });

  const detail = {
    version: target.version,
    plan_fingerprint: preview.plan_fingerprint,
    operator_identity: operatorIdentity,
    evidence_reference: evidenceReference,
    learner_id: target.learnerId,
    instructor_id: target.instructorId,
    booking_id: target.bookingId,
    lcb_minutes_removed: target.beforeMinutes,
    aggregate_shadow_updated_by_lcb_trigger: true,
    restored_booking_credit_source_id: target.bcsRestore?.id || null,
    no_stripe_or_payout_mutation: true,
  };
  const audit = await client.query(`
    INSERT INTO audit_log (admin_id,admin_email,action,target_type,target_id,details,ip_address,school_id)
    VALUES ($1,$2,$3,'learner',$4,$5::jsonb,'local_operator_tool',$6)
    RETURNING id
  `, [adminId, admin.rows[0].email, target.action, target.learnerId, JSON.stringify(detail), target.schoolId]);

  const post = await readPostconditions(client, key);
  const postconditions = assertPostconditions(post, key);
  return {
    mode: 'apply', mutation_performed: true, idempotent: false,
    version: target.version, plan_fingerprint: preview.plan_fingerprint,
    audit_id: Number(audit.rows[0].id), postconditions, after: post,
  };
}

module.exports = {
  TARGETS,
  applyCancellationCreditRepair,
  assertPostconditions,
  buildCancellationCreditRepairPreview,
  evaluatePreconditions,
  fingerprint,
  planFingerprint,
  proposedChanges,
  readEvidence,
  readPostconditions,
};
