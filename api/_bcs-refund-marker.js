async function markBookingCreditSourcesRefunded(sql, { bookingId, schoolId }) {
  const rows = await sql`
    UPDATE booking_credit_sources
       SET refunded_at = NOW()
     WHERE booking_id = ${bookingId}
       AND school_id = ${schoolId}
       AND refunded_at IS NULL
     RETURNING id
  `;
  return rows.map(row => row.id);
}

async function restoreBookingCreditSourcesActive(sql, { bcsIds, schoolId }) {
  if (!Array.isArray(bcsIds) || bcsIds.length === 0) return;
  await sql`
    UPDATE booking_credit_sources
       SET refunded_at = NULL
     WHERE id = ANY(${bcsIds})
       AND school_id = ${schoolId}
  `;
}

async function copyRefundedBookingCreditSources(sql, { bcsIds, newBookingId, schoolId }) {
  if (!Array.isArray(bcsIds) || bcsIds.length === 0) return [];
  const rows = await sql`
    INSERT INTO booking_credit_sources
      (school_id, booking_id, credit_transaction_id, minutes_drawn,
       rate_pence_per_minute, contribution_pence, stripe_fee_pence, absorbed_by,
       refunded_at)
    SELECT
      school_id, ${newBookingId}, credit_transaction_id, minutes_drawn,
      rate_pence_per_minute, contribution_pence, stripe_fee_pence, absorbed_by,
      NULL
      FROM booking_credit_sources
     WHERE id = ANY(${bcsIds})
       AND school_id = ${schoolId}
       AND refunded_at IS NOT NULL
    ON CONFLICT (booking_id, credit_transaction_id) DO NOTHING
    RETURNING id
  `;
  return rows.map(row => row.id);
}

module.exports = {
  markBookingCreditSourcesRefunded,
  restoreBookingCreditSourcesActive,
  copyRefundedBookingCreditSources,
};
