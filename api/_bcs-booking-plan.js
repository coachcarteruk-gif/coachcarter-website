// Pure helper for Step 5 BCS writer prep.
//
// Takes a total FIFO draw plan and splits it across already-created booking
// targets. It deliberately does not read/write the database. The eventual
// slots.js writer must still solve the atomic LCB/FIFO/booking/BCS shape.

function toPositiveInteger(value, name) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return n;
}

function toNonNegativeInteger(value, name) {
  const n = Number(value ?? 0);
  if (!Number.isInteger(n) || n < 0) {
    throw new TypeError(`${name} must be a non-negative integer`);
  }
  return n;
}

function normalizePlanRow(row, index) {
  return {
    credit_transaction_id: toPositiveInteger(row.credit_transaction_id, `plannedRows[${index}].credit_transaction_id`),
    minutes_drawn: toPositiveInteger(row.minutes_drawn, `plannedRows[${index}].minutes_drawn`),
    rate_pence_per_minute: toNonNegativeInteger(row.rate_pence_per_minute, `plannedRows[${index}].rate_pence_per_minute`),
    contribution_pence: toNonNegativeInteger(row.contribution_pence, `plannedRows[${index}].contribution_pence`),
    stripe_fee_pence: toNonNegativeInteger(row.stripe_fee_pence, `plannedRows[${index}].stripe_fee_pence`),
    absorbed_by: row.absorbed_by ?? null,
    school_id: toPositiveInteger(row.school_id, `plannedRows[${index}].school_id`),
  };
}

function normalizeBookingTarget(target, index) {
  return {
    booking_id: toPositiveInteger(target.booking_id, `bookingTargets[${index}].booking_id`),
    minutes: toPositiveInteger(target.minutes, `bookingTargets[${index}].minutes`),
  };
}

function floorShare(totalPence, sliceMinutes, totalMinutes) {
  if (totalPence === 0) return 0;
  return Math.floor((totalPence * sliceMinutes) / totalMinutes);
}

function splitFifoPlanAcrossBookings({ plannedRows, bookingTargets }) {
  if (!Array.isArray(plannedRows)) {
    throw new TypeError('plannedRows must be an array');
  }
  if (!Array.isArray(bookingTargets)) {
    throw new TypeError('bookingTargets must be an array');
  }

  const rows = plannedRows.map(normalizePlanRow);
  const targets = bookingTargets.map(normalizeBookingTarget);
  const plannedMinutes = rows.reduce((sum, row) => sum + row.minutes_drawn, 0);
  const bookingMinutes = targets.reduce((sum, target) => sum + target.minutes, 0);

  if (plannedMinutes !== bookingMinutes) {
    throw new RangeError(`booking target minutes (${bookingMinutes}) must match planned minutes (${plannedMinutes})`);
  }

  const output = [];
  let targetIndex = 0;
  let targetRemaining = targets[0]?.minutes || 0;

  for (const sourceRow of rows) {
    let sourceRemaining = sourceRow.minutes_drawn;
    let contributionRemaining = sourceRow.contribution_pence;
    let feeRemaining = sourceRow.stripe_fee_pence;

    while (sourceRemaining > 0) {
      const target = targets[targetIndex];
      if (!target) {
        throw new RangeError('booking targets exhausted before planned rows');
      }

      const sliceMinutes = Math.min(sourceRemaining, targetRemaining);
      const isLastSliceForSource = sliceMinutes === sourceRemaining;
      const contributionPence = isLastSliceForSource
        ? contributionRemaining
        : floorShare(sourceRow.contribution_pence, sliceMinutes, sourceRow.minutes_drawn);
      const stripeFeePence = isLastSliceForSource
        ? feeRemaining
        : floorShare(sourceRow.stripe_fee_pence, sliceMinutes, sourceRow.minutes_drawn);

      output.push({
        school_id: sourceRow.school_id,
        booking_id: target.booking_id,
        credit_transaction_id: sourceRow.credit_transaction_id,
        minutes_drawn: sliceMinutes,
        rate_pence_per_minute: sourceRow.rate_pence_per_minute,
        contribution_pence: contributionPence,
        stripe_fee_pence: stripeFeePence,
        absorbed_by: sourceRow.absorbed_by,
      });

      sourceRemaining -= sliceMinutes;
      contributionRemaining -= contributionPence;
      feeRemaining -= stripeFeePence;
      targetRemaining -= sliceMinutes;

      if (targetRemaining === 0) {
        targetIndex += 1;
        targetRemaining = targets[targetIndex]?.minutes || 0;
      }
    }
  }

  return output;
}

module.exports = {
  splitFifoPlanAcrossBookings,
};
