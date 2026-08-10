const crypto = require('crypto');

class InstructorSwitchTransferError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'InstructorSwitchTransferError';
    this.code = code;
  }
}

async function transferBookingFunding(client, {
  oldBookingId,
  newBookingId,
  learnerId,
  oldInstructorId,
  newInstructorId,
  schoolId,
}) {
  if (Number(oldInstructorId) === Number(newInstructorId)) {
    throw new InstructorSwitchTransferError(
      'SAME_INSTRUCTOR',
      'Instructor funding transfer requires two different instructors'
    );
  }

  const sourceResult = await client.query(
    `SELECT
       bcs.id AS booking_credit_source_id,
       bcs.credit_transaction_id,
       COALESCE(ct.transferred_from_credit_transaction_id, ct.id) AS origin_credit_transaction_id,
       bcs.minutes_drawn,
       bcs.rate_pence_per_minute,
       bcs.contribution_pence,
       bcs.stripe_fee_pence,
       bcs.absorbed_by
     FROM booking_credit_sources bcs
     JOIN credit_transactions ct
       ON ct.id = bcs.credit_transaction_id
      AND ct.school_id = bcs.school_id
      AND ct.learner_id = $2
      AND ct.instructor_id = $3
     WHERE bcs.booking_id = $1
       AND bcs.school_id = $4
       AND bcs.refunded_at IS NULL
     ORDER BY bcs.id
     FOR UPDATE OF bcs`,
    [oldBookingId, learnerId, oldInstructorId, schoolId]
  );

  if (sourceResult.rowCount === 0) {
    return { transferGroupId: null, transferredRows: 0, transferredMinutes: 0 };
  }

  const transferGroupId = crypto.randomUUID();
  let transferredMinutes = 0;
  for (const source of sourceResult.rows) {
    const minutes = Number(source.minutes_drawn);
    transferredMinutes += minutes;
    const contributionPence = Number(source.contribution_pence || 0);
    const stripeFeePence = Number(source.stripe_fee_pence || 0);
    const ratePencePerMinute = Number(source.rate_pence_per_minute || 0);

    await client.query(
      `INSERT INTO credit_transactions
         (learner_id, instructor_id, school_id, type, credits, minutes,
          amount_pence, payment_method, stripe_fee_pence,
          effective_rate_pence_per_minute, source, absorbed_by,
          transferred_from_credit_transaction_id, instructor_transfer_group_id)
       VALUES
         ($1, $2, $3, 'instructor_transfer_out', 0, $4,
          0, 'instructor_transfer', 0,
          $5, 'instructor_transfer', $6,
          $7, $8)`,
      [
        learnerId,
        oldInstructorId,
        schoolId,
        -minutes,
        ratePencePerMinute,
        source.absorbed_by || null,
        source.origin_credit_transaction_id,
        transferGroupId,
      ]
    );

    const transferIn = await client.query(
      `INSERT INTO credit_transactions
         (learner_id, instructor_id, school_id, type, credits, minutes,
          amount_pence, payment_method, stripe_fee_pence,
          effective_rate_pence_per_minute, source, absorbed_by,
          transferred_from_credit_transaction_id, instructor_transfer_group_id)
       VALUES
         ($1, $2, $3, 'instructor_transfer_in', 0, $4,
          $5, 'instructor_transfer', $6,
          $7, 'instructor_transfer', $8,
          $9, $10)
       RETURNING id`,
      [
        learnerId,
        newInstructorId,
        schoolId,
        minutes,
        contributionPence,
        stripeFeePence,
        ratePencePerMinute,
        source.absorbed_by || null,
        source.origin_credit_transaction_id,
        transferGroupId,
      ]
    );

    await client.query(
      `UPDATE booking_credit_sources
          SET refunded_at = NOW()
        WHERE id = $1
          AND school_id = $2
          AND refunded_at IS NULL`,
      [source.booking_credit_source_id, schoolId]
    );

    await client.query(
      `INSERT INTO booking_credit_sources
         (school_id, booking_id, credit_transaction_id, minutes_drawn,
          rate_pence_per_minute, contribution_pence, stripe_fee_pence, absorbed_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        schoolId,
        newBookingId,
        transferIn.rows[0].id,
        minutes,
        ratePencePerMinute,
        contributionPence,
        stripeFeePence,
        source.absorbed_by || null,
      ]
    );
  }

  return { transferGroupId, transferredRows: sourceResult.rowCount, transferredMinutes };
}

module.exports = {
  InstructorSwitchTransferError,
  transferBookingFunding,
};
