'use strict';

const { SCHEDULED, CHARGEABLE } = require('./_booking-status');
const { operationalTimeZone, zonedDateTimeToDate } = require('./_full-curriculum');
const { allocate } = require('./_pence-allocator');
const { loadFifoCreditSources, planFifoCreditDraw } = require('./_bcs-fifo');
const { loadLockedFlexibleSources, planFlexiblePackageFifo, unitsForDuration } = require('./_flexible-package-ledger');
const { logAuditRequired } = require('./_audit');

class DurationCorrectionError extends Error {
  constructor(code, message, status = 409) { super(message); this.code = code; this.status = status; }
}
const refuse = (code, message, status) => { throw new DurationCorrectionError(code, message, status); };
const minutes = time => { const [h, m] = String(time).split(':').map(Number); return h * 60 + m; };
const sum = (rows, field) => rows.reduce((total, row) => total + Number(row[field]), 0);
const sqlFor = client => async (strings, ...values) => (await client.query(
  strings.reduce((query, part, i) => query + (i ? '$' + i : '') + part, ''), values
)).rows;
const SOURCE_TYPES = ['purchase', 'slot_purchase', 'admin_add', 'referral_bonus', 'referral_reward', 'legacy_grandfather', 'instructor_transfer_in'];

// Retain the oldest existing allocations first. Only split the final retained
// source; preserve its frozen value/fee, with exact integer-pence conservation.
function retainMinutes(rows, requestedMinutes) {
  let remaining = requestedMinutes;
  const retained = [];
  for (const row of rows) {
    const take = Math.min(remaining, Number(row.minutes_drawn));
    if (take <= 0) break;
    const weights = [take, Number(row.minutes_drawn) - take];
    retained.push({ ...row, minutes_drawn: take,
      contribution_pence: allocate(Number(row.contribution_pence), weights)[0],
      stripe_fee_pence: allocate(Number(row.stripe_fee_pence || 0), weights)[0] });
    remaining -= take;
  }
  if (remaining) refuse('FUNDING_MISMATCH', 'The lesson funding does not match its recorded duration. Review its ledger first.');
  return retained;
}

async function correctCredit(client, booking, duration, bcs) {
  const { id: bookingId, learner_id: learnerId, instructor_id: instructorId, school_id: schoolId } = booking;
  const balance = (await client.query(`SELECT balance_minutes FROM learner_credit_balances
    WHERE learner_id=$1 AND instructor_id=$2 AND school_id=$3 FOR UPDATE`, [learnerId, instructorId, schoolId])).rows[0];
  await client.query(`SELECT id FROM credit_transactions WHERE learner_id=$1 AND instructor_id=$2 AND school_id=$3
    ORDER BY id FOR UPDATE`, [learnerId, instructorId, schoolId]);
  const sources = await loadFifoCreditSources(sqlFor(client), { learnerId, instructorId, schoolId, creditTransactionTypes: SOURCE_TYPES });
  const sourceIds = new Set(sources.map(row => Number(row.id)));
  const available = sources.reduce((total, row) => total + Number(row.minutes) - Number(row.active_minutes_drawn) - Number(row.adjusted_minutes), 0);
  const oldValue = bcs.filter(row => row.absorbed_by !== 'instructor').reduce((total, row) => total + Number(row.contribution_pence), 0);
  if (!balance || available !== Number(balance.balance_minutes) || !bcs.length
      || bcs.some(row => !sourceIds.has(Number(row.credit_transaction_id)))
      || bcs.some(row => !Number.isSafeInteger(Number(row.minutes_drawn)) || Number(row.minutes_drawn) <= 0
        || row.contribution_pence == null || !Number.isSafeInteger(Number(row.contribution_pence)) || Number(row.contribution_pence) < 0
        || row.stripe_fee_pence == null || !Number.isSafeInteger(Number(row.stripe_fee_pence)) || Number(row.stripe_fee_pence) < 0)
      || sum(bcs, 'minutes_drawn') !== Number(booking.minutes_deducted)
      || booking.list_price_pence == null || oldValue !== Number(booking.list_price_pence)
      || sources.some(row => Number(row.minutes) < Number(row.active_minutes_drawn) + Number(row.adjusted_minutes)
        || Number(row.amount_pence) < Number(row.active_contribution_pence) + Number(row.adjusted_pence)
        || Number(row.stripe_fee_pence) < Number(row.active_stripe_fee_pence))) {
    refuse('FUNDING_MISMATCH', 'The lesson credit sources and balance do not reconcile. Review its ledger before correcting the duration.');
  }
  const delta = duration - Number(booking.minutes_deducted);
  let replacement = delta < 0 ? retainMinutes(bcs, duration) : bcs.map(row => ({ ...row }));
  if (delta > 0) {
    if (available < delta) refuse('INSUFFICIENT_BALANCE', `The learner needs ${delta} additional minutes with this instructor.`, 402);
    const plan = planFifoCreditDraw({ sources, minutes: delta, schoolId });
    if (!plan.ok) refuse('INSUFFICIENT_BALANCE', 'There is insufficient source-backed lesson credit.', 402);
    for (const extra of plan.rows) {
      const existing = replacement.find(row => Number(row.credit_transaction_id) === Number(extra.credit_transaction_id));
      if (existing) {
        existing.minutes_drawn = Number(existing.minutes_drawn) + extra.minutes_drawn;
        existing.contribution_pence = Number(existing.contribution_pence) + extra.contribution_pence;
        existing.stripe_fee_pence = Number(existing.stripe_fee_pence) + extra.stripe_fee_pence;
      } else replacement.push(extra);
    }
  }
  await client.query(`UPDATE booking_credit_sources SET refunded_at=NOW()
    WHERE booking_id=$1 AND school_id=$2 AND refunded_at IS NULL`, [bookingId, schoolId]);
  const appendedIds = [];
  for (const row of replacement) {
    const inserted = await client.query(`INSERT INTO booking_credit_sources
      (school_id,booking_id,credit_transaction_id,minutes_drawn,rate_pence_per_minute,contribution_pence,stripe_fee_pence,absorbed_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [schoolId, bookingId, row.credit_transaction_id,
      row.minutes_drawn, row.rate_pence_per_minute, row.contribution_pence, row.stripe_fee_pence, row.absorbed_by]);
    appendedIds.push(inserted.rows[0].id);
  }
  const changed = await client.query(`UPDATE learner_credit_balances SET balance_minutes=balance_minutes-$4, updated_at=NOW()
    WHERE learner_id=$1 AND instructor_id=$2 AND school_id=$3 AND balance_minutes >= $4 RETURNING balance_minutes`,
  [learnerId, instructorId, schoolId, delta]);
  if (changed.rowCount !== 1) refuse('BALANCE_CHANGED', 'The learner balance changed. Refresh and try again.');
  // No positive edit_adjustment CT: returning the original BCS makes the original
  // source spendable again. A new CT would duplicate that entitlement.
  return { value: sum(replacement.filter(row => row.absorbed_by !== 'instructor'), 'contribution_pence'),
    retired_ids: bcs.map(row => row.id), replacement_ids: appendedIds, balance_minutes: Number(changed.rows[0].balance_minutes) };
}

async function correctFlexible(client, booking, duration, allocations) {
  const { id: bookingId, learner_id: learnerId, instructor_id: instructorId, school_id: schoolId } = booking;
  if (!unitsForDuration(duration)) refuse('FLEXIBLE_DURATION_INVALID', 'Flexible Hours corrections must use whole 30-minute units.', 400);
  const sources = await loadLockedFlexibleSources(client, { schoolId, learnerId });
  const sourceIds = new Set(sources.rows.map(row => Number(row.id)));
  // The general balance loader clamps exhausted sources to zero for display.
  // Corrections must also reject historical over-allocation rather than hide it.
  const contradictions = await client.query(`SELECT s.id FROM flexible_package_sources s
    WHERE s.school_id=$1 AND s.learner_id=$2 AND (
      s.initial_units < COALESCE((SELECT SUM(a.units_allocated) FROM flexible_package_booking_allocations a
        WHERE a.source_id=s.id AND a.school_id=s.school_id AND NOT EXISTS
          (SELECT 1 FROM flexible_package_allocation_returns r WHERE r.allocation_id=a.id AND r.school_id=a.school_id)),0)
        + COALESCE((SELECT SUM(r.units_reduced) FROM flexible_package_source_reductions r WHERE r.source_id=s.id AND r.school_id=s.school_id),0)
      OR s.original_value_pence < COALESCE((SELECT SUM(a.contribution_pence) FROM flexible_package_booking_allocations a
        WHERE a.source_id=s.id AND a.school_id=s.school_id AND NOT EXISTS
          (SELECT 1 FROM flexible_package_allocation_returns r WHERE r.allocation_id=a.id AND r.school_id=a.school_id)),0)
        + COALESCE((SELECT SUM(r.gross_refund_pence) FROM flexible_package_source_reductions r WHERE r.source_id=s.id AND r.school_id=s.school_id),0)
    ) LIMIT 1`, [schoolId, learnerId]);
  const old = allocations.map(row => ({ ...row, minutes_drawn: Number(row.units_allocated) * Number(row.unit_minutes) }));
  if (contradictions.rowCount || !old.length || old.some(row => Number(row.learner_id) !== Number(learnerId)
      || Number(row.instructor_id) !== Number(instructorId) || Number(row.unit_minutes) !== 30
      || !sourceIds.has(Number(row.source_id)))
      || sum(old, 'minutes_drawn') !== Number(booking.minutes_deducted)
      || booking.list_price_pence == null || sum(old, 'contribution_pence') !== Number(booking.list_price_pence)) {
    refuse('FUNDING_MISMATCH', 'The Flexible Hours allocations do not match this lesson. Review its ledger before correcting the duration.');
  }
  const delta = duration - Number(booking.minutes_deducted);
  let replacement = delta < 0 ? retainMinutes(old, duration) : old;
  if (delta > 0) {
    const plan = planFlexiblePackageFifo(sources.rows, unitsForDuration(delta));
    if (!plan.ok) refuse(plan.code, 'There are not enough available Flexible Hours for the longer lesson.', 402);
    replacement = replacement.concat(plan.allocations.map(row => ({ ...row, minutes_drawn: row.units * 30 })));
  }
  for (const row of old) {
    await client.query(`INSERT INTO flexible_package_allocation_returns
      (school_id,allocation_id,booking_id,units_returned,reason)
      VALUES ($1,$2,$3,$4,'delivered_duration_correction')`, [schoolId, row.id, bookingId, row.units_allocated]);
  }
  const appendedIds = [];
  for (const row of replacement) {
    const inserted = await client.query(`INSERT INTO flexible_package_booking_allocations
      (school_id,learner_id,source_id,booking_id,instructor_id,units_allocated,unit_minutes,rate_pence_per_unit,contribution_pence)
      VALUES ($1,$2,$3,$4,$5,$6,30,$7,$8) RETURNING id`, [schoolId, learnerId, row.source_id, bookingId,
      instructorId, row.minutes_drawn / 30, row.rate_pence_per_unit, row.contribution_pence]);
    appendedIds.push(inserted.rows[0].id);
  }
  const evidence = { retired_ids: old.map(row => row.id), replacement_ids: appendedIds, minutes_returned: -delta };
  await client.query(`INSERT INTO flexible_package_state_events (school_id,learner_id,event_type,booking_id,detail)
    VALUES ($1,$2,'delivered_duration_corrected',$3,$4::jsonb)`, [schoolId, learnerId, bookingId, JSON.stringify(evidence)]);
  return { value: sum(replacement, 'contribution_pence'), ...evidence };
}

// Caller MUST run this in one interactive transaction. No provider calls occur
// here: every booking, allocation, balance and required audit write commits together.
async function correctDeliveredDuration(client, { schoolId, bookingId, lessonTypeId, expected, changes, admin, req, now = new Date() }) {
  const identity = (await client.query(`SELECT learner_id,instructor_id FROM lesson_bookings WHERE id=$1 AND school_id=$2`, [bookingId, schoolId])).rows[0];
  if (!identity) refuse('BOOKING_NOT_FOUND', 'Booking not found.', 404);
  await client.query('SELECT pg_advisory_xact_lock($1,$2)', [schoolId, identity.instructor_id]);
  const learner = await client.query(`SELECT id FROM learner_users WHERE id=$1 AND school_id=$2 FOR UPDATE`, [identity.learner_id, schoolId]);
  const instructor = await client.query(`SELECT id FROM instructors WHERE id=$1 AND school_id=$2`, [identity.instructor_id, schoolId]);
  if (!learner.rowCount || !instructor.rowCount) refuse('BOOKING_SCOPE_MISMATCH', 'The learner and instructor must belong to this school.');
  await client.query('SELECT pg_advisory_xact_lock($1,$2)', [schoolId, bookingId]);
  const booking = (await client.query(`SELECT *,scheduled_date::text AS scheduled_date,start_time::text AS start_time,end_time::text AS end_time
    FROM lesson_bookings WHERE id=$1 AND school_id=$2 FOR UPDATE`, [bookingId, schoolId])).rows[0];
  if (!booking || booking.learner_id !== identity.learner_id || booking.instructor_id !== identity.instructor_id) refuse('BOOKING_CHANGED', 'The booking changed. Refresh and try again.');
  const oldDuration = minutes(booking.end_time) - minutes(booking.start_time);
  if (!expected || ['scheduled_date', 'start_time', 'end_time', 'lesson_type_id', 'minutes_deducted', 'list_price_pence', 'status'].some(key =>
    String(booking[key]) !== String(expected[key])) || (expected.expected_duration_minutes != null && Number(expected.expected_duration_minutes) !== oldDuration)) {
    refuse('BOOKING_CHANGED', 'The booking changed while you were editing it. Refresh and try again.');
  }
  const type = (await client.query(`SELECT duration_minutes FROM lesson_types WHERE id=$1 AND school_id=$2`, [lessonTypeId, schoolId])).rows[0];
  const duration = Number(type?.duration_minutes);
  if (!Number.isSafeInteger(duration) || duration <= 0 || duration >= 1440) refuse('INVALID_DURATION', 'Choose a valid lesson length.', 400);
  if (duration === oldDuration) refuse('DURATION_UNCHANGED', 'The lesson already has this duration. Refresh the booking.');
  const startTime = changes.start_time;
  const endMinutes = minutes(startTime) + duration;
  if (endMinutes >= 1440) refuse('INVALID_DURATION', 'The lesson must finish before midnight.', 400);
  const endTime = String(Math.floor(endMinutes / 60)).padStart(2, '0') + ':' + String(endMinutes % 60).padStart(2, '0');
  const school = (await client.query('SELECT config FROM schools WHERE id=$1', [schoolId])).rows[0];
  const zone = operationalTimeZone(school?.config);
  const oldEnd = zonedDateTimeToDate(booking.scheduled_date, booking.end_time.slice(0, 5), zone);
  const newEnd = zonedDateTimeToDate(changes.scheduled_date, endTime, zone);
  if (![SCHEDULED, CHARGEABLE].includes(booking.status) || !oldEnd || !newEnd || oldEnd > now || newEnd > now) {
    refuse('NOT_DELIVERED', 'Duration corrections are only available after the original and corrected lesson have finished.', 400);
  }
  if (booking.cancelled_at || booking.credit_forfeited || booking.credit_returned) refuse('BOOKING_CANCELLED', 'Cancelled or forfeited lessons cannot use a delivered-duration correction.');
  if (oldDuration !== Number(booking.minutes_deducted)) refuse('FUNDING_MISMATCH', 'The recorded duration differs from the funded minutes. Review any free extension or historical correction first.');
  const claims = await client.query(`SELECT 1 FROM payout_line_items WHERE booking_id=$1 AND school_id=$2
    UNION ALL SELECT 1 FROM interim_v1_manual_payout_settlement_bookings WHERE booking_id=$1 AND school_id=$2
    UNION ALL SELECT 1 FROM booking_earnings WHERE booking_id=$1 AND school_id=$2
    UNION ALL SELECT 1 FROM school_payout_line_items item JOIN school_payouts payout ON payout.id=item.school_payout_id
      WHERE item.booking_id=$1 AND payout.school_id=$2
    UNION ALL SELECT 1 FROM stripe_launch_booking_earnings WHERE payment_contract_id=$3 AND school_id=$2`,
  [bookingId, schoolId, booking.lesson_payment_contract_id || null]);
  if (claims.rowCount) refuse('BOOKING_PAID_OUT', 'This lesson is already included in a payout or settlement. Its duration needs a separate payout adjustment.');
  const clashes = await client.query(`SELECT id FROM lesson_bookings WHERE school_id=$1 AND instructor_id=$2 AND id<>$3
    AND scheduled_date=$4 AND status=ANY($7::text[]) AND start_time<$6::time AND end_time>$5::time LIMIT 1`,
  [schoolId, booking.instructor_id, bookingId, changes.scheduled_date, startTime, endTime, [SCHEDULED, CHARGEABLE]]);
  if (clashes.rowCount && !changes.force) refuse('LESSON_OVERLAP', 'The corrected lesson overlaps another lesson. Check its time first.');
  const bcs = (await client.query(`SELECT * FROM booking_credit_sources WHERE booking_id=$1 AND school_id=$2 AND refunded_at IS NULL ORDER BY id FOR UPDATE`, [bookingId, schoolId])).rows;
  const allocations = (await client.query(`SELECT a.* FROM flexible_package_booking_allocations a
    WHERE a.booking_id=$1 AND a.school_id=$2 AND NOT EXISTS
      (SELECT 1 FROM flexible_package_allocation_returns r WHERE r.allocation_id=a.id AND r.school_id=a.school_id)
    ORDER BY a.id FOR SHARE OF a`, [bookingId, schoolId])).rows;
  if ((bcs.length && allocations.length) || (booking.payment_method === 'credit' && allocations.length)
      || (booking.payment_method === 'flexible_package' && bcs.length)) refuse('MIXED_FUNDING', 'This lesson has conflicting funding records. Review its ledger first.');
  let funding;
  if (booking.payment_method === 'credit') funding = await correctCredit(client, booking, duration, bcs);
  else if (booking.payment_method === 'flexible_package') funding = await correctFlexible(client, booking, duration, allocations);
  else refuse('UNSUPPORTED_FUNDING', 'This payment method needs a separate duration correction.');
  await client.query(`UPDATE lesson_bookings SET lesson_type_id=$3,scheduled_date=$4,start_time=$5::time,end_time=$6::time,
    minutes_deducted=$7,list_price_pence=$8,pickup_address=$9,dropoff_address=$10,instructor_notes=$11,edited_at=NOW()
    WHERE id=$1 AND school_id=$2`, [bookingId, schoolId, lessonTypeId, changes.scheduled_date, startTime, endTime,
    duration, funding.value, changes.pickup_address, changes.dropoff_address, changes.notes]);
  const offers = await client.query(`UPDATE lesson_offers SET status='cancelled'
    WHERE extension_booking_id=$1 AND school_id=$2 AND instructor_id=$3 AND status='pending' RETURNING stripe_session_id`,
  [bookingId, schoolId, booking.instructor_id]);
  await logAuditRequired(sqlFor(client), { adminId: admin.id, adminEmail: admin.email, schoolId, req,
    action: 'admin.correct_delivered_duration', targetType: 'booking', targetId: bookingId,
    details: { old: { date: booking.scheduled_date, start: booking.start_time, end: booking.end_time, duration: oldDuration,
      lesson_type_id: booking.lesson_type_id, value_pence: booking.list_price_pence, pickup_address: booking.pickup_address,
      dropoff_address: booking.dropoff_address, notes: booking.instructor_notes },
    new: { ...changes, end_time: endTime, duration, lesson_type_id: lessonTypeId, value_pence: funding.value },
    payment_method: booking.payment_method, funding } });
  return { ok: true, booking_id: bookingId, minutes_returned: oldDuration - duration,
    session_ids: offers.rows.map(row => row.stripe_session_id) };
}

module.exports = { correctDeliveredDuration, DurationCorrectionError, retainMinutes };
