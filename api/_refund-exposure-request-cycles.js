// Released reservation minutes are not a new purchase. Only omit them when
// their entire school/learner/instructor request cycle demonstrably nets to zero.
// Unbalanced, spent, priced or provider-linked rows remain visible for review.
function normalizeRequestReleaseSources(rows, cycles) {
  const key = row => `${row.school_id}:${row.learner_id}:${row.instructor_id}`;
  const balanced = new Set(cycles.filter(c =>
    Number(c.held_minutes) > 0 &&
    Number(c.held_minutes) === Number(c.released_minutes) &&
    Number(c.invalid_sign_count) === 0
  ).map(key));
  const excluded = [];
  const sources = rows.filter(row => {
    const omit = row.source_type === 'request_refund' &&
      balanced.has(key(row)) &&
      Number(row.source_amount_pence) === 0 &&
      Number(row.active_minutes_drawn) === 0 &&
      Number(row.active_contribution_pence) === 0 &&
      Number(row.adjusted_minutes) === 0 &&
      Number(row.adjusted_pence) === 0 &&
      !row.stripe_session_id && !row.stripe_payment_intent_id && !row.stripe_charge_id;
    if (omit) excluded.push(row);
    return !omit;
  });
  return {
    sources,
    evidence: {
      excluded_balanced_request_release_count: excluded.length,
      excluded_balanced_request_release_minutes: excluded.reduce((sum, row) => sum + Number(row.source_minutes), 0),
    },
  };
}

module.exports = { normalizeRequestReleaseSources };
