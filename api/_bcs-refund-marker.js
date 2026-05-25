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

module.exports = {
  markBookingCreditSourcesRefunded,
  restoreBookingCreditSourcesActive,
};
