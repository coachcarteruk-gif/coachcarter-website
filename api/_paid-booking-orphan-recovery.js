'use strict';

const { withNeonTransaction } = require('./_db-transaction');
const { lockBalanceAdjustLCB } = require('./_credit-grant');
const { blocksSlot, isTerminal } = require('./_booking-status');

class PaidBookingRecoveryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PaidBookingRecoveryError';
    this.code = code;
  }
}

function positiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new PaidBookingRecoveryError('PAID_BOOKING_RECOVERY_INPUT_INVALID', `${field} is invalid`);
  }
  return number;
}

function exactText(value, field) {
  const text = String(value || '').trim();
  if (!text) {
    throw new PaidBookingRecoveryError('PAID_BOOKING_RECOVERY_INPUT_INVALID', `${field} is missing`);
  }
  return text;
}

function clientSqlTag(client) {
  return async (strings, ...values) => {
    let text = '';
    for (let index = 0; index < strings.length; index += 1) {
      text += strings[index];
      if (index < values.length) text += `$${index + 1}`;
    }
    return (await client.query(text, values)).rows || [];
  };
}

function normalizeInput(input) {
  const paymentType = exactText(input?.paymentType, 'paymentType');
  if (!['slot_booking', 'lesson_offer'].includes(paymentType)) {
    throw new PaidBookingRecoveryError(
      'PAID_BOOKING_RECOVERY_UNSUPPORTED',
      'Only direct slots and one-off slot-pinned offers can be recovered'
    );
  }
  if (paymentType === 'lesson_offer' && input.repeatWeeks !== 1) {
    throw new PaidBookingRecoveryError(
      'PAID_BOOKING_RECOVERY_UNSUPPORTED',
      'Repeating or flexible offers require operator reconciliation'
    );
  }
  const stripeFeePence = Number(input.stripeFeePence);
  if (!Number.isSafeInteger(stripeFeePence) || stripeFeePence < 0) {
    throw new PaidBookingRecoveryError(
      'PAID_BOOKING_RECOVERY_EVIDENCE_INCOMPLETE',
      'Exact Stripe fee evidence is required before automatic recovery'
    );
  }
  if (!input.stripeChargeId) {
    throw new PaidBookingRecoveryError(
      'PAID_BOOKING_RECOVERY_EVIDENCE_INCOMPLETE',
      'Exact Stripe charge or balance-transaction identity is required before automatic recovery'
    );
  }
  return {
    paymentType,
    schoolId: positiveInteger(input.schoolId, 'schoolId'),
    learnerId: positiveInteger(input.learnerId, 'learnerId'),
    instructorId: positiveInteger(input.instructorId, 'instructorId'),
    sessionId: exactText(input.sessionId, 'sessionId'),
    paymentIntentId: exactText(input.paymentIntentId, 'paymentIntentId'),
    scheduledDate: exactText(input.scheduledDate, 'scheduledDate'),
    startTime: exactText(input.startTime, 'startTime'),
    endTime: exactText(input.endTime, 'endTime'),
    minutes: positiveInteger(input.minutes, 'minutes'),
    amountPence: positiveInteger(input.amountPence, 'amountPence'),
    lessonTypeId: input.lessonTypeId == null ? null : positiveInteger(input.lessonTypeId, 'lessonTypeId'),
    offerId: input.offerId == null ? null : positiveInteger(input.offerId, 'offerId'),
    stripeFeePence,
    stripeChargeId: exactText(input.stripeChargeId, 'stripeChargeId'),
    transmissionType: String(input.transmissionType || '').trim().toLowerCase() === 'automatic'
      ? 'automatic'
      : 'manual',
    pickupAddress: input.pickupAddress || null,
    dropoffAddress: input.dropoffAddress || null,
    socialVideoConsent: input.socialVideoConsent === true,
    socialVideoAgeConfirmed: input.socialVideoConsent === true
      && input.socialVideoAgeConfirmed === true,
    socialVideoDiscountPct: input.socialVideoConsent === true
      ? (Number(input.socialVideoDiscountPct) || 0)
      : 0,
  };
}

async function loadExactBooking(client, input) {
  const result = await client.query(
    `SELECT id,status,minutes_deducted,list_price_pence,stripe_fee_pence
       FROM lesson_bookings
      WHERE school_id=$1 AND learner_id=$2 AND instructor_id=$3
        AND scheduled_date=$4::date AND start_time=$5::time AND end_time=$6::time
      ORDER BY id`,
    [input.schoolId,input.learnerId,input.instructorId,input.scheduledDate,input.startTime,input.endTime]
  );
  if (result.rowCount > 1) {
    throw new PaidBookingRecoveryError(
      'PAID_BOOKING_RECOVERY_DUPLICATE_BOOKING',
      'Multiple exact bookings already exist for the paid slot'
    );
  }
  return result.rows[0] || null;
}

async function loadConflicts(client, input) {
  const result = await client.query(
    `SELECT ARRAY_REMOVE(ARRAY[
       CASE WHEN EXISTS (
         SELECT 1 FROM lesson_bookings
          WHERE school_id=$1 AND instructor_id=$2 AND scheduled_date=$3::date
            AND status IN ('scheduled','chargeable')
            AND start_time < $5::time AND end_time > $4::time
       ) THEN 'booking' END,
       CASE WHEN EXISTS (
         SELECT 1 FROM slot_reservations
          WHERE school_id=$1 AND instructor_id=$2 AND scheduled_date=$3::date
            AND expires_at>NOW() AND stripe_session_id IS DISTINCT FROM $6
            AND start_time < $5::time AND end_time > $4::time
       ) THEN 'reservation' END,
       CASE WHEN EXISTS (
         SELECT 1 FROM lesson_offers
          WHERE school_id=$1 AND instructor_id=$2 AND scheduled_date=$3::date
            AND status='pending' AND expires_at>NOW() AND id IS DISTINCT FROM $7
            AND start_time < $5::time AND end_time > $4::time
       ) THEN 'offer' END,
       CASE WHEN EXISTS (
         SELECT 1 FROM lesson_requests
          WHERE school_id=$1 AND instructor_id=$2 AND scheduled_date=$3::date
            AND status='pending' AND expires_at>NOW()
            AND start_time < $5::time AND end_time > $4::time
       ) THEN 'request' END,
       CASE WHEN EXISTS (
         SELECT 1 FROM instructor_busy_blocks
          WHERE school_id=$1 AND instructor_id=$2 AND block_date=$3::date
            AND start_time < $5::time AND end_time > $4::time
       ) THEN 'busy_block' END,
       CASE WHEN EXISTS (
         SELECT 1 FROM instructor_external_events
          WHERE school_id=$1 AND instructor_id=$2 AND event_date=$3::date
            AND (is_all_day OR (start_time < $5::time AND end_time > $4::time))
       ) THEN 'external_event' END,
       CASE WHEN EXISTS (
         SELECT 1 FROM instructor_blackout_dates
          WHERE school_id=$1 AND instructor_id=$2
            AND $3::date BETWEEN blackout_date AND COALESCE(end_date,blackout_date)
       ) THEN 'blackout' END,
       CASE WHEN EXISTS (
         SELECT 1 FROM instructor_availability_overrides
          WHERE school_id=$1 AND instructor_id=$2 AND override_date=$3::date
            AND active=FALSE
            AND (start_time IS NULL OR (start_time < $5::time AND end_time > $4::time))
       ) THEN 'unavailable_override' END,
       CASE WHEN EXISTS (
         SELECT 1 FROM recurring_slot_block_items rsbi
         JOIN recurring_slot_blocks rsb ON rsb.id=rsbi.block_id AND rsb.school_id=rsbi.school_id
          WHERE rsbi.school_id=$1 AND rsbi.instructor_id=$2 AND rsbi.scheduled_date=$3::date
            AND rsbi.status='held' AND rsb.status='pending_payment' AND rsb.expires_at>NOW()
            AND rsbi.start_time < $5::time AND rsbi.end_time > $4::time
       ) THEN 'recurring_hold' END
     ],NULL) AS conflicts`,
    [input.schoolId,input.instructorId,input.scheduledDate,input.startTime,input.endTime,
      input.sessionId,input.offerId]
  );
  return result.rows[0]?.conflicts || [];
}

async function loadBalanceReconciliation(client, input) {
  const result = await client.query(
    `WITH purchases AS (
       SELECT COALESCE(SUM(minutes),0)::int AS minutes
         FROM credit_transactions
        WHERE school_id=$1 AND learner_id=$2 AND instructor_id=$3
     ), bcs_draws AS (
       SELECT COALESCE(SUM(bcs.minutes_drawn),0)::int AS minutes
         FROM booking_credit_sources bcs
         JOIN credit_transactions ct
           ON ct.id=bcs.credit_transaction_id AND ct.school_id=bcs.school_id
        WHERE bcs.school_id=$1 AND ct.learner_id=$2 AND ct.instructor_id=$3
          AND bcs.refunded_at IS NULL
     ), unattributed_booking_draws AS (
       SELECT COALESCE(SUM(lb.minutes_deducted),0)::int AS minutes
         FROM lesson_bookings lb
        WHERE lb.school_id=$1 AND lb.learner_id=$2 AND lb.instructor_id=$3
          AND lb.credit_returned=FALSE AND COALESCE(lb.minutes_deducted,0)>0
          AND NOT EXISTS (
            SELECT 1 FROM booking_credit_sources bcs
             WHERE bcs.school_id=lb.school_id AND bcs.booking_id=lb.id
          )
     ), source_adjustments AS (
       SELECT COALESCE(SUM(csa.minutes_adjusted),0)::int AS minutes
         FROM credit_source_adjustments csa
         JOIN credit_transactions ct ON ct.id=csa.credit_transaction_id
        WHERE ct.school_id=$1 AND ct.learner_id=$2 AND ct.instructor_id=$3
     )
     SELECT COALESCE((
              SELECT balance_minutes FROM learner_credit_balances
               WHERE school_id=$1 AND learner_id=$2 AND instructor_id=$3
              FOR UPDATE
            ),0)::int AS actual_minutes,
            (p.minutes-b.minutes-u.minutes-a.minutes)::int AS expected_with_orphan_minutes
       FROM purchases p CROSS JOIN bcs_draws b
       CROSS JOIN unattributed_booking_draws u CROSS JOIN source_adjustments a`,
    [input.schoolId,input.learnerId,input.instructorId]
  );
  return result.rows[0];
}

async function createBooking(client, input, feePence) {
  if (input.paymentType === 'lesson_offer') {
    return (await client.query(
      `INSERT INTO lesson_bookings (
         learner_id,instructor_id,scheduled_date,start_time,end_time,status,
         created_by,payment_method,lesson_type_id,minutes_deducted,pickup_address,
         school_id,stripe_fee_pence,stripe_fee_source,list_price_pence,list_price_source
       ) VALUES ($1,$2,$3,$4,$5,'scheduled','instructor_offer','card',$6,$7,$8,$9,$10,$11,$12,'stripe_metadata')
       RETURNING id,status,scheduled_date::text,start_time::text,end_time::text`,
      [input.learnerId,input.instructorId,input.scheduledDate,input.startTime,input.endTime,
        input.lessonTypeId,input.minutes,input.pickupAddress,input.schoolId,
        feePence,feePence != null ? 'balance_transaction' : null,input.amountPence]
    )).rows[0];
  }
  return (await client.query(
    `INSERT INTO lesson_bookings (
       learner_id,instructor_id,scheduled_date,start_time,end_time,status,
       lesson_type_id,transmission_type,minutes_deducted,school_id,
       pickup_address,dropoff_address,stripe_fee_pence,stripe_fee_source,
       list_price_pence,list_price_source,social_video_consent,
       social_video_age_confirmed,social_video_discount_pct,booking_purpose
     ) VALUES ($1,$2,$3,$4,$5,'scheduled',$6,$7,$8,$9,$10,$11,$12,$13,$14,
       'stripe_metadata',$15,$16,$17,'lesson')
     RETURNING id,status,scheduled_date::text,start_time::text,end_time::text`,
    [input.learnerId,input.instructorId,input.scheduledDate,input.startTime,input.endTime,
      input.lessonTypeId,input.transmissionType,input.minutes,input.schoolId,
      input.pickupAddress,input.dropoffAddress,feePence,
      feePence != null ? 'balance_transaction' : null,input.amountPence,
      input.socialVideoConsent,input.socialVideoAgeConfirmed,input.socialVideoDiscountPct]
  )).rows[0];
}

async function ensureBcs(client, input, source, bookingId, feePence) {
  await client.query(
    `INSERT INTO booking_credit_sources (
       school_id,booking_id,credit_transaction_id,minutes_drawn,
       rate_pence_per_minute,contribution_pence,stripe_fee_pence,absorbed_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,NULL)
     ON CONFLICT (booking_id,credit_transaction_id) DO NOTHING`,
    [input.schoolId,bookingId,source.id,input.minutes,
      source.effective_rate_pence_per_minute,input.amountPence,feePence ?? 0]
  );
  const result = await client.query(
    `SELECT id,minutes_drawn,contribution_pence,stripe_fee_pence
       FROM booking_credit_sources
      WHERE school_id=$1 AND booking_id=$2 AND credit_transaction_id=$3`,
    [input.schoolId,bookingId,source.id]
  );
  const row = result.rows[0];
  if (result.rowCount !== 1
      || Number(row.minutes_drawn) !== input.minutes
      || Number(row.contribution_pence) !== input.amountPence
      || Number(row.stripe_fee_pence) !== Number(feePence ?? 0)) {
    throw new PaidBookingRecoveryError(
      'PAID_BOOKING_RECOVERY_BCS_MISMATCH',
      'Existing booking credit attribution contradicts the paid source'
    );
  }
  return row;
}

async function recoverPaidBookingOrphan(rawInput, dependencies = {}) {
  const input = normalizeInput(rawInput);
  const runTransaction = dependencies.transactionRunner
    || ((work) => withNeonTransaction(rawInput.connectionString, work));
  const adjustBalance = dependencies.balanceAdjuster || lockBalanceAdjustLCB;

  return runTransaction(async (client) => {
    await client.query(`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`);
    await client.query(`SET LOCAL lock_timeout='5s'`);
    await client.query(`SET LOCAL statement_timeout='30s'`);
    await client.query(`LOCK TABLE lesson_bookings IN SHARE ROW EXCLUSIVE MODE`);

    const sourceResult = await client.query(
      `SELECT id,amount_pence,minutes,stripe_fee_pence,stripe_charge_id,
              effective_rate_pence_per_minute
         FROM credit_transactions
        WHERE stripe_session_id=$1 AND stripe_payment_intent_id=$2
          AND school_id=$3 AND learner_id=$4 AND instructor_id=$5
          AND type='slot_purchase'
        FOR UPDATE`,
      [input.sessionId,input.paymentIntentId,input.schoolId,input.learnerId,input.instructorId]
    );
    if (sourceResult.rowCount !== 1) {
      throw new PaidBookingRecoveryError(
        'PAID_BOOKING_RECOVERY_SOURCE_MISMATCH',
        'The paid source is not singular in the expected tenant scope'
      );
    }
    const source = sourceResult.rows[0];
    if (Number(source.amount_pence) !== input.amountPence
        || Number(source.minutes) !== input.minutes
        || Number(source.effective_rate_pence_per_minute)
          !== Math.round(input.amountPence / input.minutes)) {
      throw new PaidBookingRecoveryError(
        'PAID_BOOKING_RECOVERY_SOURCE_MISMATCH',
        'The paid source amount, duration, or rate contradicts immutable payment metadata'
      );
    }
    if (source.stripe_fee_pence != null && input.stripeFeePence != null
        && Number(source.stripe_fee_pence) !== input.stripeFeePence) {
      throw new PaidBookingRecoveryError(
        'PAID_BOOKING_RECOVERY_SOURCE_MISMATCH',
        'The stored Stripe fee contradicts immutable Stripe evidence'
      );
    }
    if (source.stripe_charge_id && input.stripeChargeId
        && source.stripe_charge_id !== input.stripeChargeId) {
      throw new PaidBookingRecoveryError(
        'PAID_BOOKING_RECOVERY_SOURCE_MISMATCH',
        'The stored Stripe charge contradicts immutable Stripe evidence'
      );
    }
    const feePence = input.stripeFeePence ?? (source.stripe_fee_pence == null
      ? null
      : Number(source.stripe_fee_pence));
    await client.query(
      `UPDATE credit_transactions
          SET stripe_fee_pence=COALESCE(stripe_fee_pence,$2),
              stripe_charge_id=COALESCE(stripe_charge_id,$3)
        WHERE id=$1 AND school_id=$4`,
      [source.id,input.stripeFeePence,input.stripeChargeId,input.schoolId]
    );

    let booking = await loadExactBooking(client,input);
    let balanceMode = 'not_needed';
    if (booking) {
      if (isTerminal(booking.status)) {
        throw new PaidBookingRecoveryError(
          'PAID_BOOKING_RECOVERY_TERMINAL_BOOKING',
          'The exact paid booking is terminal and cannot be reactivated automatically'
        );
      }
      if (!blocksSlot(booking.status)
          || Number(booking.minutes_deducted) !== input.minutes
          || Number(booking.list_price_pence) !== input.amountPence) {
        throw new PaidBookingRecoveryError(
          'PAID_BOOKING_RECOVERY_BOOKING_MISMATCH',
          'The exact booking contradicts immutable payment metadata'
        );
      }
    } else {
      const conflicts = await loadConflicts(client,input);
      if (conflicts.length > 0) {
        throw new PaidBookingRecoveryError(
          'PAID_BOOKING_RECOVERY_SLOT_CONFLICT',
          `The paid slot is no longer free: ${conflicts.join(',')}`
        );
      }
      const reconciliation = await loadBalanceReconciliation(client,input);
      const actual = Number(reconciliation.actual_minutes);
      const expectedWith = Number(reconciliation.expected_with_orphan_minutes);
      const expectedWithout = expectedWith - input.minutes;
      const sql = clientSqlTag(client);
      if (actual === expectedWithout) {
        const added = await adjustBalance(sql, {
          learnerId:input.learnerId,instructorId:input.instructorId,schoolId:input.schoolId,
          delta:input.minutes,creditsDelta:1,
        });
        if (!added.ok) {
          throw new PaidBookingRecoveryError(
            'PAID_BOOKING_RECOVERY_BALANCE_FAILED',
            `The orphan source could not be staged: ${added.code}`
          );
        }
        const deducted = await adjustBalance(sql, {
          learnerId:input.learnerId,instructorId:input.instructorId,schoolId:input.schoolId,
          delta:-input.minutes,creditsDelta:-1,
        });
        if (!deducted.ok || Number(deducted.balanceMinutes ?? deducted.balance_minutes) !== actual) {
          throw new PaidBookingRecoveryError(
            'PAID_BOOKING_RECOVERY_BALANCE_FAILED',
            'The orphan source net-zero balance cycle did not reconcile'
          );
        }
        balanceMode = 'net_zero';
      } else if (actual === expectedWith) {
        const deducted = await adjustBalance(sql, {
          learnerId:input.learnerId,instructorId:input.instructorId,schoolId:input.schoolId,
          delta:-input.minutes,creditsDelta:-1,
        });
        if (!deducted.ok
            || Number(deducted.balanceMinutes ?? deducted.balance_minutes) !== expectedWithout) {
          throw new PaidBookingRecoveryError(
            'PAID_BOOKING_RECOVERY_BALANCE_FAILED',
            'The previously staged orphan credit could not be consumed safely'
          );
        }
        balanceMode = 'consume_staged_credit';
      } else {
        throw new PaidBookingRecoveryError(
          'PAID_BOOKING_RECOVERY_BALANCE_DRIFT',
          'The scoped credit balance does not reconcile with or without the orphan source'
        );
      }
      booking = await createBooking(client,input,feePence);
    }

    const bcs = await ensureBcs(client,input,source,booking.id,feePence);
    if (input.offerId) {
      const offerResult = await client.query(
        `UPDATE lesson_offers
            SET status='accepted',booking_id=$1,learner_id=$2,
                accepted_at=COALESCE(accepted_at,NOW())
          WHERE id=$3 AND school_id=$4 AND instructor_id=$5
            AND stripe_session_id=$6 AND status IN ('pending','expired','accepted')
          RETURNING id,booking_id`,
        [booking.id,input.learnerId,input.offerId,input.schoolId,input.instructorId,input.sessionId]
      );
      if (offerResult.rowCount !== 1
          || Number(offerResult.rows[0].booking_id) !== Number(booking.id)) {
        throw new PaidBookingRecoveryError(
          'PAID_BOOKING_RECOVERY_OFFER_MISMATCH',
          'The paid offer could not be reconciled to the recovered booking'
        );
      }
    }
    await client.query(
      `DELETE FROM slot_reservations WHERE school_id=$1 AND stripe_session_id=$2`,
      [input.schoolId,input.sessionId]
    );
    return {
      recovered:true,
      created:balanceMode !== 'not_needed',
      balanceMode,
      bookingId:Number(booking.id),
      creditTransactionId:Number(source.id),
      bookingCreditSourceId:Number(bcs.id),
    };
  });
}

module.exports = {
  PaidBookingRecoveryError,
  recoverPaidBookingOrphan,
  normalizeInput,
};
