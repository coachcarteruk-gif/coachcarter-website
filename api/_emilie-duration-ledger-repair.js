'use strict';

const crypto = require('crypto');

const REPAIR_VERSION = 'emilie-duration-ledger-repair-2026-09-14-v2';
const REPAIR_ACTION = 'credits.emilie_duration_ledger_repair';

const TARGET = Object.freeze({
  schoolId: 1,
  schoolName: 'CoachCarter Driving School',
  learnerId: 144,
  learnerName: 'Emilie Bishop',
  instructorId: 6,
  instructorName: 'Simon Edwards',
  lcbId: 386,
  lcbUpdatedAt: '2026-09-07T19:32:00.078998Z',
  bookings: Object.freeze({
    533: Object.freeze({
      status: 'chargeable', minutes: 90, beforePence: 11000, afterPence: 8250,
      editedAt: '2026-09-02T17:56:12.026353Z', scheduledDate: '2026-09-03',
      startTime: '09:30:00', endTime: '11:00:00',
    }),
    585: Object.freeze({
      status: 'scheduled', minutes: 90, beforePence: 5500, afterPence: 8250,
      editedAt: '2026-09-07T19:32:00.164425Z', scheduledDate: '2026-09-14',
      startTime: '13:00:00', endTime: '14:30:00',
    }),
  }),
  originalBcs: Object.freeze([
    Object.freeze({ id: 287, bookingId: 533, creditTransactionId: 318, minutes: 120, rate: 92, contributionPence: 11000, stripeFeePence: 0 }),
    Object.freeze({ id: 329, bookingId: 585, creditTransactionId: 354, minutes: 60, rate: 92, contributionPence: 5500, stripeFeePence: 0 }),
  ]),
  creditTransactions: Object.freeze([
    Object.freeze({ id: 318, type: 'slot_purchase', minutes: 120, amountPence: 11000, paymentMethod: 'card', stripeFeePence: null, effectiveRate: 92, source: 'stripe' }),
    Object.freeze({ id: 336, type: 'edit_adjustment', minutes: 30, amountPence: 0, paymentMethod: 'edit', stripeFeePence: null, effectiveRate: null, source: 'stripe' }),
    Object.freeze({ id: 354, type: 'slot_purchase', minutes: 60, amountPence: 5500, paymentMethod: 'card', stripeFeePence: null, effectiveRate: 92, source: 'stripe' }),
    Object.freeze({ id: 355, type: 'edit_adjustment', minutes: -30, amountPence: 0, paymentMethod: 'edit', stripeFeePence: null, effectiveRate: null, source: 'stripe' }),
  ]),
  fundingEvidence: Object.freeze([
    Object.freeze({
      id: '924a52ce-2aca-4101-a2cc-084baf0ffffb', bookingId: 533,
      creditTransactionId: 318, bookingCreditSourceId: 287,
      status: 'pending', grossPence: 11000, feePence: null,
      fingerprint: 'sha256:1cc76a32daf1285088c037e19e75fb69457c16849517b34279f95bfaf595ed19',
    }),
    Object.freeze({
      id: '9152801e-ee66-42e5-87da-df469025673b', bookingId: 585,
      creditTransactionId: 354, bookingCreditSourceId: 329,
      status: 'pending', grossPence: 5500, feePence: null,
      fingerprint: 'sha256:d3548962e14b52e14d841dea0298a6ef91f2136d17500bcb37b0e3f709d378c2',
    }),
  ]),
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

function proposedChanges() {
  return {
    supersede_booking_credit_source: { id: 287, booking_id: 533, credit_transaction_id: 318 },
    replacement_booking_credit_sources: [
      { booking_id: 533, credit_transaction_id: 318, minutes: 90, rate: 92, contribution_pence: 8250, stripe_fee_pence: 0 },
      { booking_id: 585, credit_transaction_id: 318, minutes: 30, rate: 92, contribution_pence: 2750, stripe_fee_pence: 0 },
    ],
    booking_list_prices: [
      { booking_id: 533, before_pence: 11000, after_pence: 8250 },
      { booking_id: 585, before_pence: 5500, after_pence: 8250 },
    ],
    unchanged: ['learner_credit_balances', 'learner_users.balance_minutes', 'credit_transactions', 'refund_events', 'payouts', 'Stripe'],
    audit_action: REPAIR_ACTION,
  };
}

function planFingerprint() {
  return fingerprint({
    version: REPAIR_VERSION,
    target: { schoolId: TARGET.schoolId, learnerId: TARGET.learnerId, instructorId: TARGET.instructorId, bookingIds: [533, 585] },
    changes: proposedChanges(),
  });
}

async function readEvidence(client, { lock = false } = {}) {
  const identityLock = lock ? 'FOR UPDATE OF learner, lcb' : '';
  const bookingLock = lock ? 'FOR UPDATE OF booking' : '';
  const bcsLock = lock ? 'FOR UPDATE OF bcs' : '';
  const [schema] = await query(client, `
    /* emilie-duration-repair:schema */
    SELECT
      (SELECT COUNT(*)::int FROM pg_constraint
        WHERE conrelid='booking_credit_sources'::regclass AND contype='u'
          AND pg_get_constraintdef(oid)='UNIQUE (booking_id, credit_transaction_id)') AS legacy_pair_constraints,
      (SELECT COUNT(*)::int FROM pg_indexes
        WHERE schemaname='public' AND tablename='booking_credit_sources'
          AND indexname='uq_bcs_active_booking_source'
          AND indexdef ILIKE 'CREATE UNIQUE INDEX%WHERE (refunded_at IS NULL)%') AS active_pair_indexes
  `);

  const [identity] = await query(client, `
    /* emilie-duration-repair:identity */
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
      JOIN learner_users learner ON learner.id=$2 AND learner.school_id=school.id
      JOIN instructors instructor ON instructor.id=$3 AND instructor.school_id=school.id
      JOIN learner_credit_balances lcb
        ON lcb.learner_id=learner.id AND lcb.instructor_id=instructor.id AND lcb.school_id=school.id
     WHERE school.id=$1
     ${identityLock}
  `, [TARGET.schoolId, TARGET.learnerId, TARGET.instructorId]);

  const bookings = await query(client, `
    /* emilie-duration-repair:bookings */
    SELECT booking.id::int, booking.learner_id::int, booking.instructor_id::int,
           booking.school_id::int, booking.status, booking.payment_method,
           booking.minutes_deducted::int, booking.list_price_pence::int,
           booking.list_price_source, booking.credit_returned,
           booking.credit_forfeited, booking.cancelled_at, booking.edited_at,
           to_char(booking.cancelled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cancelled_at_exact,
           to_char(booking.edited_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS edited_at_exact,
           booking.scheduled_date::text, booking.start_time::text, booking.end_time::text
      FROM lesson_bookings booking
     WHERE booking.school_id=$1 AND booking.learner_id=$2 AND booking.instructor_id=$3
       AND booking.id=ANY($4::bigint[])
     ORDER BY booking.id
     ${bookingLock}
  `, [TARGET.schoolId, TARGET.learnerId, TARGET.instructorId, [533, 585]]);

  const bookingCreditSources = await query(client, `
    /* emilie-duration-repair:bcs */
    SELECT bcs.id::int, bcs.booking_id::int, bcs.credit_transaction_id::int,
           bcs.minutes_drawn::int, bcs.rate_pence_per_minute::int,
           bcs.contribution_pence::int, bcs.stripe_fee_pence::int,
           bcs.absorbed_by, bcs.refunded_at
      FROM booking_credit_sources bcs
     WHERE bcs.school_id=$1 AND bcs.booking_id=ANY($2::bigint[])
     ORDER BY bcs.id
     ${bcsLock}
  `, [TARGET.schoolId, [533, 585]]);

  const creditTransactions = await query(client, `
    /* emilie-duration-repair:credit-transactions */
    SELECT id::int,learner_id::int,instructor_id::int,school_id::int,
           type,minutes::int,amount_pence::int,payment_method,
           stripe_fee_pence::int,effective_rate_pence_per_minute::int,
           source,absorbed_by
      FROM credit_transactions
     WHERE school_id=$1 AND learner_id=$2 AND instructor_id=$3
       AND id=ANY($4::bigint[])
     ORDER BY id
  `, [TARGET.schoolId, TARGET.learnerId, TARGET.instructorId, TARGET.creditTransactions.map(row => row.id)]);

  const fundingEvidence = await query(client, `
    /* emilie-duration-repair:funding-evidence */
    SELECT id::text,booking_id::int,credit_transaction_id::int,
           booking_credit_source_id::int,evidence_status,
           gross_collected_pence::int,stripe_fee_pence::int,evidence_fingerprint
      FROM interim_v1_funding_evidence
     WHERE school_id=$1 AND learner_id=$2 AND instructor_id=$3
       AND booking_id=ANY($4::bigint[])
     ORDER BY booking_id
  `, [TARGET.schoolId, TARGET.learnerId, TARGET.instructorId, [533, 585]]);

  const [counts] = await query(client, `
    /* emilie-duration-repair:contradictions */
    SELECT
      (SELECT COUNT(*)::int FROM credit_source_adjustments adjustment
        WHERE adjustment.credit_transaction_id=ANY($1::bigint[])) AS source_adjustments,
      (SELECT COUNT(*)::int FROM refund_event_lines line
        WHERE line.school_id=$2 AND (line.credit_transaction_id=ANY($1::bigint[])
          OR line.booking_credit_source_id=ANY($3::bigint[]))) AS refund_lines,
      (SELECT COUNT(*)::int FROM payout_line_items line
        WHERE line.school_id=$2 AND line.booking_id=ANY($4::bigint[])) AS payout_lines,
      (SELECT COUNT(*)::int FROM interim_v1_manual_payout_settlement_bookings claim
        WHERE claim.school_id=$2 AND claim.booking_id=ANY($4::bigint[])) AS manual_claims,
      (SELECT COUNT(*)::int FROM payout_direct_evidence_observations observation
        WHERE observation.school_id=$2 AND observation.booking_id=ANY($4::bigint[])) AS direct_observations,
      (SELECT COUNT(*)::int FROM flexible_package_booking_allocations allocation
        WHERE allocation.school_id=$2 AND allocation.booking_id=ANY($4::bigint[])) AS flexible_allocations
  `, [TARGET.creditTransactions.map(row => row.id), TARGET.schoolId, TARGET.originalBcs.map(row => row.id), [533, 585]]);

  const [reconciliation] = await query(client, `
    /* emilie-duration-repair:reconciliation */
    WITH purchases AS (
      SELECT COALESCE(SUM(minutes),0)::int minutes FROM credit_transactions
       WHERE school_id=$1 AND learner_id=$2 AND instructor_id=$3
         AND id=ANY($4::bigint[])
    ), active_bcs AS (
      SELECT COALESCE(SUM(bcs.minutes_drawn),0)::int minutes,
             COALESCE(SUM(bcs.contribution_pence),0)::int pence
        FROM booking_credit_sources bcs JOIN credit_transactions tx ON tx.id=bcs.credit_transaction_id
       WHERE bcs.school_id=$1 AND tx.school_id=$1 AND tx.learner_id=$2 AND tx.instructor_id=$3
         AND tx.id=ANY($4::bigint[])
         AND bcs.refunded_at IS NULL
    ), adjustments AS (
      SELECT COALESCE(SUM(adjustment.minutes_adjusted),0)::int minutes
        FROM credit_source_adjustments adjustment JOIN credit_transactions tx ON tx.id=adjustment.credit_transaction_id
       WHERE tx.school_id=$1 AND tx.learner_id=$2 AND tx.instructor_id=$3
         AND tx.id=ANY($4::bigint[])
    )
    SELECT purchases.minutes AS transaction_minutes,
           active_bcs.minutes AS active_bcs_minutes,
           active_bcs.pence AS active_bcs_pence,
           adjustments.minutes AS adjustment_minutes,
           purchases.minutes-active_bcs.minutes-adjustments.minutes AS computed_minutes
      FROM purchases,active_bcs,adjustments
  `, [TARGET.schoolId, TARGET.learnerId, TARGET.instructorId, TARGET.creditTransactions.map(row => row.id)]);

  const [marker] = await query(client, `
    /* emilie-duration-repair:marker */
    SELECT id::int,details,created_at FROM audit_log
     WHERE school_id=$1 AND action=$2 AND target_type='learner' AND target_id=$3
     ORDER BY id DESC LIMIT 1
  `, [TARGET.schoolId, REPAIR_ACTION, TARGET.learnerId]);

  return {
    schema: schema || null,
    identity: identity || null,
    bookings,
    bookingCreditSources,
    creditTransactions,
    fundingEvidence,
    counts: counts || null,
    reconciliation: reconciliation || null,
    marker: marker || null,
  };
}

function normaliseBooking(row) {
  return {
    id: Number(row.id), status: row.status, paymentMethod: row.payment_method,
    minutes: Number(row.minutes_deducted), listPricePence: Number(row.list_price_pence),
    listPriceSource: row.list_price_source, creditReturned: row.credit_returned === true,
    creditForfeited: row.credit_forfeited === true, cancelledAt: row.cancelled_at_exact || null,
    editedAt: row.edited_at_exact || null, scheduledDate: row.scheduled_date,
    startTime: row.start_time, endTime: row.end_time,
  };
}

function expectedBookings() {
  return Object.entries(TARGET.bookings).map(([id, booking]) => ({
    id: Number(id), status: booking.status, paymentMethod: 'credit', minutes: booking.minutes,
    listPricePence: booking.beforePence, listPriceSource: 'stripe_metadata',
    creditReturned: false, creditForfeited: false, cancelledAt: null,
    editedAt: booking.editedAt, scheduledDate: booking.scheduledDate,
    startTime: booking.startTime, endTime: booking.endTime,
  }));
}

function normaliseBcs(row) {
  return {
    id: Number(row.id),bookingId:Number(row.booking_id),creditTransactionId:Number(row.credit_transaction_id),
    minutes:Number(row.minutes_drawn),rate:Number(row.rate_pence_per_minute),
    contributionPence:Number(row.contribution_pence),stripeFeePence:Number(row.stripe_fee_pence),
    absorbedBy:row.absorbed_by,refundedAt:iso(row.refunded_at),
  };
}

function expectedOriginalBcs() {
  return TARGET.originalBcs.map(row => ({ ...row, absorbedBy: null, refundedAt: null }));
}

function normaliseCreditTransaction(row) {
  return {
    id:Number(row.id),type:row.type,minutes:Number(row.minutes),amountPence:Number(row.amount_pence),
    paymentMethod:row.payment_method,stripeFeePence:row.stripe_fee_pence==null?null:Number(row.stripe_fee_pence),
    effectiveRate:row.effective_rate_pence_per_minute==null?null:Number(row.effective_rate_pence_per_minute),
    source:row.source,
  };
}

function normaliseFundingEvidence(row) {
  return {
    id:row.id,bookingId:Number(row.booking_id),creditTransactionId:Number(row.credit_transaction_id),
    bookingCreditSourceId:Number(row.booking_credit_source_id),status:row.evidence_status,
    grossPence:Number(row.gross_collected_pence),feePence:row.stripe_fee_pence==null?null:Number(row.stripe_fee_pence),
    fingerprint:row.evidence_fingerprint,
  };
}

function evaluatePreconditions(evidence) {
  const identity=evidence.identity||{};
  const schema=evidence.schema||{};
  const counts=evidence.counts||{};
  const reconciliation=evidence.reconciliation||{};
  return [
    check('migration 064 active-row uniqueness ready', [0,1], [Number(schema.legacy_pair_constraints??-1),Number(schema.active_pair_indexes??-1)]),
    check('repair marker absent', null, evidence.marker?Number(evidence.marker.id):null),
    check('school identity',[TARGET.schoolId,TARGET.schoolName],[Number(identity.school_id||0),identity.school_name||null]),
    check('learner identity',[TARGET.learnerId,TARGET.learnerName],[Number(identity.learner_id||0),identity.learner_name||null]),
    check('instructor identity and pause',[TARGET.instructorId,TARGET.instructorName,true],[Number(identity.instructor_id||0),identity.instructor_name||null,identity.payouts_paused===true]),
    check('zero balance exact state',[TARGET.lcbId,0,0,0,null,TARGET.lcbUpdatedAt],[Number(identity.lcb_id||0),Number(identity.lcb_minutes??-1),Number(identity.aggregate_minutes??-1),Number(identity.aggregate_credits??-1),iso(identity.grandfathered_at),identity.lcb_updated_at_exact||null]),
    check('exact booking states',expectedBookings(),evidence.bookings.map(normaliseBooking)),
    check('exact original booking sources',expectedOriginalBcs(),evidence.bookingCreditSources.map(normaliseBcs)),
    check('exact credit transactions',TARGET.creditTransactions,evidence.creditTransactions.map(normaliseCreditTransaction)),
    check('immutable pending funding evidence',TARGET.fundingEvidence,evidence.fundingEvidence.map(normaliseFundingEvidence)),
    check('no adjustment/refund/payout/evidence contradiction',[0,0,0,0,0,0],[Number(counts.source_adjustments??-1),Number(counts.refund_lines??-1),Number(counts.payout_lines??-1),Number(counts.manual_claims??-1),Number(counts.direct_observations??-1),Number(counts.flexible_allocations??-1)]),
    check('current minutes and pence',[180,180,16500,0,0],[Number(reconciliation.transaction_minutes??-1),Number(reconciliation.active_bcs_minutes??-1),Number(reconciliation.active_bcs_pence??-1),Number(reconciliation.adjustment_minutes??-1),Number(reconciliation.computed_minutes??-1)]),
  ];
}

async function buildEmilieRepairPreview(client,{lock=false}={}) {
  const evidence=await readEvidence(client,{lock});
  const preconditions=evaluatePreconditions(evidence);
  const ready=preconditions.every(row=>row.ok);
  const repairFingerprint=planFingerprint();
  if(evidence.marker){
    return {version:REPAIR_VERSION,mode:'dry-run',mutation_performed:false,status:'already_applied',ready:false,plan_fingerprint:repairFingerprint,marker:evidence.marker};
  }
  return {
    version:REPAIR_VERSION,mode:'dry-run',mutation_performed:false,
    status:ready?'ready':'blocked',ready,plan_fingerprint:repairFingerprint,
    target:{school_id:1,learner_id:144,instructor_id:6,booking_ids:[533,585]},
    preconditions,
    before:{lcb_minutes:Number(evidence.identity?.lcb_minutes||0),active_bcs_minutes:Number(evidence.reconciliation?.active_bcs_minutes||0),active_bcs_pence:Number(evidence.reconciliation?.active_bcs_pence||0),booking_prices_pence:{533:11000,585:5500}},
    proposed_changes:proposedChanges(),
    expected_after:{lcb_minutes:0,active_bcs_minutes:180,active_bcs_pence:16500,booking_prices_pence:{533:8250,585:8250},source_318_active:{minutes:120,pence:11000},source_354_active:{minutes:60,pence:5500},booking_585_active_source_count:2},
  };
}

async function readPostconditions(client){
  const [row]=await query(client,`
    /* emilie-duration-repair:postconditions */
    SELECT lcb.balance_minutes::int AS lcb_minutes,learner.balance_minutes::int AS aggregate_minutes,
      (SELECT COUNT(*)::int FROM audit_log WHERE school_id=$1 AND action=$4 AND target_type='learner' AND target_id=$2) marker_count,
      (SELECT COUNT(*)::int FROM booking_credit_sources WHERE school_id=$1 AND id=287 AND refunded_at IS NOT NULL) original_287_retired,
      (SELECT COUNT(*)::int FROM booking_credit_sources WHERE school_id=$1 AND booking_id=585 AND refunded_at IS NULL) booking_585_active_sources,
      (SELECT COALESCE(SUM(minutes_drawn),0)::int FROM booking_credit_sources WHERE school_id=$1 AND credit_transaction_id=318 AND refunded_at IS NULL) source_318_minutes,
      (SELECT COALESCE(SUM(contribution_pence),0)::int FROM booking_credit_sources WHERE school_id=$1 AND credit_transaction_id=318 AND refunded_at IS NULL) source_318_pence,
      (SELECT COALESCE(SUM(minutes_drawn),0)::int FROM booking_credit_sources WHERE school_id=$1 AND credit_transaction_id=354 AND refunded_at IS NULL) source_354_minutes,
      (SELECT COALESCE(SUM(contribution_pence),0)::int FROM booking_credit_sources WHERE school_id=$1 AND credit_transaction_id=354 AND refunded_at IS NULL) source_354_pence,
      (SELECT list_price_pence::int FROM lesson_bookings WHERE school_id=$1 AND id=533) booking_533_pence,
      (SELECT list_price_pence::int FROM lesson_bookings WHERE school_id=$1 AND id=585) booking_585_pence,
      (SELECT COUNT(*)::int FROM payout_line_items WHERE school_id=$1 AND booking_id=ANY($5::bigint[])) payout_lines,
      (SELECT COUNT(*)::int FROM refund_event_lines WHERE school_id=$1 AND (credit_transaction_id=ANY($6::bigint[]) OR booking_credit_source_id=ANY($7::bigint[]))) refund_lines
    FROM learner_users learner JOIN learner_credit_balances lcb ON lcb.learner_id=learner.id AND lcb.instructor_id=$3 AND lcb.school_id=learner.school_id
    WHERE learner.school_id=$1 AND learner.id=$2
  `,[TARGET.schoolId,TARGET.learnerId,TARGET.instructorId,REPAIR_ACTION,[533,585],[318,336,354,355],[287,329]]);
  return row||null;
}

function assertPostconditions(post){
  const checks=[
    check('balances unchanged at zero',[0,0],[Number(post?.lcb_minutes??-1),Number(post?.aggregate_minutes??-1)]),
    check('one repair marker',1,Number(post?.marker_count??-1)),
    check('original #287 retired',1,Number(post?.original_287_retired??-1)),
    check('booking #585 has two active sources',2,Number(post?.booking_585_active_sources??-1)),
    check('source #318 conserved',[120,11000],[Number(post?.source_318_minutes??-1),Number(post?.source_318_pence??-1)]),
    check('source #354 conserved',[60,5500],[Number(post?.source_354_minutes??-1),Number(post?.source_354_pence??-1)]),
    check('booking prices corrected',[8250,8250],[Number(post?.booking_533_pence??-1),Number(post?.booking_585_pence??-1)]),
    check('no payout/refund mutation',[0,0],[Number(post?.payout_lines??-1),Number(post?.refund_lines??-1)]),
  ];
  const failed=checks.filter(row=>!row.ok);
  if(failed.length){const error=new Error(`Emilie repair postconditions failed: ${failed.map(row=>row.name).join(', ')}`);error.code='EMILIE_REPAIR_POSTCONDITION_FAILED';error.checks=checks;throw error;}
  return checks;
}

async function applyEmilieRepair(client,{reviewedFingerprint,adminId,operatorIdentity,evidenceReference}){
  await client.query('SELECT pg_advisory_xact_lock($1::integer,hashtext($2)::integer)',[TARGET.schoolId,REPAIR_VERSION]);
  const preview=await buildEmilieRepairPreview(client,{lock:true});
  if(preview.status==='already_applied'){const post=await readPostconditions(client);return {...preview,mode:'apply',idempotent:true,postconditions:assertPostconditions(post),after:post};}
  if(!preview.ready){const error=new Error('Emilie repair preconditions failed');error.code='EMILIE_REPAIR_PRECONDITION_FAILED';error.preview=preview;throw error;}
  if(reviewedFingerprint!==preview.plan_fingerprint)throw Object.assign(new Error('Reviewed Emilie fingerprint does not match the live preview'),{code:'EMILIE_REPAIR_FINGERPRINT_MISMATCH'});
  const admin=await client.query('SELECT id,email FROM admin_users WHERE id=$1 AND school_id=$2 FOR SHARE',[adminId,TARGET.schoolId]);
  if(admin.rowCount!==1)throw Object.assign(new Error('Admin identity is outside the repair school'),{code:'EMILIE_REPAIR_ADMIN_SCOPE_MISMATCH'});

  const retired=await client.query(`UPDATE booking_credit_sources SET refunded_at=NOW() WHERE id=287 AND school_id=$1 AND booking_id=533 AND credit_transaction_id=318 AND minutes_drawn=120 AND contribution_pence=11000 AND refunded_at IS NULL RETURNING id,refunded_at`,[TARGET.schoolId]);
  if(retired.rowCount!==1)throw Object.assign(new Error('Expected exact BCS #287 retirement'),{code:'EMILIE_REPAIR_RETIRE_COUNT_MISMATCH'});

  const inserted=await client.query(`
    INSERT INTO booking_credit_sources (school_id,booking_id,credit_transaction_id,minutes_drawn,rate_pence_per_minute,contribution_pence,stripe_fee_pence,absorbed_by)
    VALUES ($1,533,318,90,92,8250,0,NULL),($1,585,318,30,92,2750,0,NULL)
    ON CONFLICT DO NOTHING
    RETURNING id,booking_id,credit_transaction_id
  `,[TARGET.schoolId]);
  if(inserted.rowCount!==2)throw Object.assign(new Error('Expected exactly two replacement BCS rows'),{code:'EMILIE_REPAIR_INSERT_COUNT_MISMATCH'});

  const updated=await client.query(`
    UPDATE lesson_bookings SET list_price_pence=CASE id WHEN 533 THEN 8250 WHEN 585 THEN 8250 END
     WHERE school_id=$1 AND learner_id=$2 AND instructor_id=$3
       AND ((id=533 AND status='chargeable' AND minutes_deducted=90 AND list_price_pence=11000 AND edited_at=$4::timestamptz)
         OR (id=585 AND status='scheduled' AND minutes_deducted=90 AND list_price_pence=5500 AND edited_at=$5::timestamptz))
    RETURNING id
  `,[TARGET.schoolId,TARGET.learnerId,TARGET.instructorId,TARGET.bookings[533].editedAt,TARGET.bookings[585].editedAt]);
  if(updated.rowCount!==2)throw Object.assign(new Error('Expected both exact booking price corrections'),{code:'EMILIE_REPAIR_BOOKING_COUNT_MISMATCH'});

  const detail={version:REPAIR_VERSION,plan_fingerprint:preview.plan_fingerprint,operator_identity:operatorIdentity,evidence_reference:evidenceReference,learner_id:TARGET.learnerId,instructor_id:TARGET.instructorId,booking_ids:[533,585],retired_booking_credit_source_id:287,replacement_booking_credit_source_ids:inserted.rows.map(row=>Number(row.id)).sort((a,b)=>a-b),unchanged_interim_funding_evidence_ids:TARGET.fundingEvidence.map(row=>row.id),no_stripe_balance_or_payout_mutation:true};
  const audit=await client.query(`INSERT INTO audit_log(admin_id,admin_email,action,target_type,target_id,details,ip_address,school_id) VALUES($1,$2,$3,'learner',$4,$5::jsonb,'local_operator_tool',$6) RETURNING id`,[adminId,admin.rows[0].email,REPAIR_ACTION,TARGET.learnerId,JSON.stringify(detail),TARGET.schoolId]);
  const post=await readPostconditions(client);
  return {mode:'apply',mutation_performed:true,idempotent:false,version:REPAIR_VERSION,plan_fingerprint:preview.plan_fingerprint,audit_id:Number(audit.rows[0].id),postconditions:assertPostconditions(post),after:post};
}

module.exports={REPAIR_ACTION,REPAIR_VERSION,TARGET,applyEmilieRepair,assertPostconditions,buildEmilieRepairPreview,evaluatePreconditions,fingerprint,planFingerprint,proposedChanges,readEvidence,readPostconditions};
