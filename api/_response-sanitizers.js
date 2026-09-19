function sanitizePayoutDetails(details) {
  if (!Array.isArray(details)) return [];
  return details.map((detail) => {
    if (!detail || typeof detail !== 'object' || !detail.error) return detail;
    return {
      ...detail,
      error: detail.status === 'refused'
        ? 'Payout processing refused'
        : 'Payout processing failed',
    };
  });
}

module.exports = { sanitizePayoutDetails };
