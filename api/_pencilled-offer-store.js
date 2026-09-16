'use strict';

const { withNeonTransaction } = require('./_db-transaction');
const { BLOCKING_STATUSES } = require('./_booking-status');

class PencilledOfferConflict extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PencilledOfferConflict';
    this.code = code;
  }
}

async function createPencilledOfferTransaction({ connectionString, offer, transactionRunner = withNeonTransaction }) {
  return transactionRunner(connectionString, async client => {
    await client.query('SELECT lock_pencilled_slot_day($1, $2, $3::date)', [
      offer.schoolId, offer.instructorId, offer.scheduledDate,
    ]);
    const conflict = await client.query(
      `SELECT source FROM (
         SELECT 'booking' AS source FROM lesson_bookings
          WHERE school_id=$1 AND instructor_id=$2 AND scheduled_date=$3::date
            AND status=ANY($6::text[]) AND start_time < $5::time AND end_time > $4::time
         UNION ALL
         SELECT 'offer' FROM lesson_offers
          WHERE school_id=$1 AND instructor_id=$2 AND scheduled_date=$3::date
            AND status='pending' AND expires_at>NOW() AND start_time < $5::time AND end_time > $4::time
         UNION ALL
         SELECT 'request' FROM lesson_requests
          WHERE school_id=$1 AND instructor_id=$2 AND scheduled_date=$3::date
            AND status='pending' AND expires_at>NOW() AND start_time < $5::time AND end_time > $4::time
         UNION ALL
         SELECT 'reservation' FROM slot_reservations
          WHERE school_id=$1 AND instructor_id=$2 AND scheduled_date=$3::date
            AND expires_at>NOW() AND start_time < $5::time AND end_time > $4::time
         UNION ALL
         SELECT 'recurring_hold' FROM recurring_slot_block_items
          WHERE school_id=$1 AND instructor_id=$2 AND scheduled_date=$3::date
            AND status='held' AND start_time < $5::time AND end_time > $4::time
         UNION ALL
         SELECT 'busy_block' FROM instructor_busy_blocks
          WHERE school_id=$1 AND instructor_id=$2 AND block_date=$3::date
            AND start_time < $5::time AND end_time > $4::time
       ) conflicts LIMIT 1`,
      [offer.schoolId, offer.instructorId, offer.scheduledDate, offer.startTime, offer.endTime, BLOCKING_STATUSES]
    );
    if (conflict.rowCount) {
      throw new PencilledOfferConflict('PENCILLED_SLOT_UNAVAILABLE', 'That time is no longer available.');
    }
    const inserted = await client.query(
      `INSERT INTO lesson_offers
         (token, instructor_id, learner_email, learner_name, learner_id,
          scheduled_date, start_time, end_time, lesson_type_id, discount_pct,
          offer_price_pence, max_repeat_weeks, status, expires_at, school_id, pencilled)
       VALUES ($1,$2,$3,$4,$5,$6::date,$7::time,$8::time,$9,0,$10,1,'pending',$11,$12,TRUE)
       RETURNING id, expires_at`,
      [offer.token, offer.instructorId, offer.learnerEmail, offer.learnerName, offer.learnerId,
        offer.scheduledDate, offer.startTime, offer.endTime, offer.lessonTypeId,
        offer.offerPricePence, offer.expiresAt, offer.schoolId]
    );
    return inserted.rows[0];
  });
}

module.exports = { createPencilledOfferTransaction, PencilledOfferConflict };
