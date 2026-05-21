// Read-only FIFO planner for Step 5 booking_credit_sources wiring.
//
// This module deliberately does not insert booking_credit_sources or mutate
// balances. Writer callsites will use the planned rows in later slices.

const { allocate } = require('./_pence-allocator');

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

function createdAtKey(value) {
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function normalizeSource(source) {
  const minutes = toPositiveInteger(source.minutes, 'source.minutes');
  const activeMinutesDrawn = toNonNegativeInteger(
    source.active_minutes_drawn ?? source.activeMinutesDrawn,
    'source.active_minutes_drawn'
  );
  const adjustedMinutes = Number(source.adjusted_minutes ?? source.adjustedMinutes ?? 0);
  if (!Number.isInteger(adjustedMinutes)) {
    throw new TypeError('source.adjusted_minutes must be an integer');
  }
  const adjustedPence = toNonNegativeInteger(
    source.adjusted_pence ?? source.adjustedPence,
    'source.adjusted_pence'
  );
  const activeStripeFeePence = toNonNegativeInteger(
    source.active_stripe_fee_pence ?? source.activeStripeFeePence,
    'source.active_stripe_fee_pence'
  );
  const stripeFeePence = toNonNegativeInteger(
    source.stripe_fee_pence ?? source.stripeFeePence,
    'source.stripe_fee_pence'
  );
  const amountPence = toNonNegativeInteger(
    source.amount_pence ?? source.amountPence,
    'source.amount_pence'
  );
  if (activeStripeFeePence > stripeFeePence) {
    throw new RangeError(`source ${source.id} has already over-allocated Stripe fee`);
  }
  const activeContributionPence = toNonNegativeInteger(
    source.active_contribution_pence ?? source.activeContributionPence,
    'source.active_contribution_pence'
  );
  if (activeContributionPence > amountPence) {
    throw new RangeError(`source ${source.id} has already over-allocated contribution`);
  }
  if (activeContributionPence + adjustedPence > amountPence) {
    throw new RangeError(`source ${source.id} has contribution plus adjustments above source amount`);
  }

  return {
    id: toPositiveInteger(source.id, 'source.id'),
    created_at: source.created_at ?? source.createdAt ?? null,
    school_id: toPositiveInteger(source.school_id ?? source.schoolId, 'source.school_id'),
    minutes,
    amount_pence: amountPence,
    effective_rate_pence_per_minute: toNonNegativeInteger(
      source.effective_rate_pence_per_minute ?? source.effectiveRatePencePerMinute,
      'source.effective_rate_pence_per_minute'
    ),
    stripe_fee_pence: stripeFeePence,
    absorbed_by: source.absorbed_by ?? source.absorbedBy ?? null,
    active_minutes_drawn: activeMinutesDrawn,
    adjusted_minutes: adjustedMinutes,
    active_stripe_fee_pence: activeStripeFeePence,
    active_contribution_pence: activeContributionPence,
    adjusted_pence: adjustedPence,
    available_minutes: minutes - activeMinutesDrawn - adjustedMinutes,
  };
}

function allocatePenceForDraw(source, minutesDrawn, {
  totalField,
  activeField,
  adjustedField,
}) {
  const totalPence = source[totalField];
  if (totalPence === 0) return 0;

  const minutesAfterDraw = source.available_minutes - minutesDrawn;
  const adjustedPence = adjustedField ? source[adjustedField] : 0;
  const remainingPence = totalPence - source[activeField] - adjustedPence;

  if (minutesAfterDraw === 0) {
    return remainingPence;
  }

  const remainingOriginalMinutes = Math.max(source.minutes - minutesDrawn, 0);
  const proportional = allocate(totalPence, [
    minutesDrawn,
    remainingOriginalMinutes,
  ])[0];

  return Math.min(proportional, remainingPence);
}

function allocateFeeForDraw(source, minutesDrawn) {
  return allocatePenceForDraw(source, minutesDrawn, {
    totalField: 'stripe_fee_pence',
    activeField: 'active_stripe_fee_pence',
  });
}

function allocateContributionForDraw(source, minutesDrawn) {
  return allocatePenceForDraw(source, minutesDrawn, {
    totalField: 'amount_pence',
    activeField: 'active_contribution_pence',
    adjustedField: 'adjusted_pence',
  });
}

function planFifoCreditDraw({ sources, minutes, schoolId }) {
  const requestedMinutes = toPositiveInteger(minutes, 'minutes');
  const resolvedSchoolId = toPositiveInteger(schoolId, 'schoolId');
  if (!Array.isArray(sources)) {
    throw new TypeError('sources must be an array');
  }

  const ordered = sources
    .map(normalizeSource)
    .filter(source => source.school_id === resolvedSchoolId && source.available_minutes > 0)
    .sort((a, b) => createdAtKey(a.created_at) - createdAtKey(b.created_at) || a.id - b.id);

  const rows = [];
  let remaining = requestedMinutes;

  for (const source of ordered) {
    if (remaining <= 0) break;
    const minutesDrawn = Math.min(remaining, source.available_minutes);
    const stripeFeePence = allocateFeeForDraw(source, minutesDrawn);
    const contributionPence = allocateContributionForDraw(source, minutesDrawn);
    rows.push({
      credit_transaction_id: source.id,
      minutes_drawn: minutesDrawn,
      rate_pence_per_minute: source.effective_rate_pence_per_minute,
      contribution_pence: contributionPence,
      stripe_fee_pence: stripeFeePence,
      absorbed_by: source.absorbed_by,
      school_id: resolvedSchoolId,
    });

    remaining -= minutesDrawn;
  }

  return {
    ok: remaining === 0,
    requested_minutes: requestedMinutes,
    planned_minutes: requestedMinutes - remaining,
    shortage_minutes: remaining,
    rows,
  };
}

async function loadFifoCreditSources(sql, {
  learnerId,
  instructorId,
  schoolId,
  creditTransactionTypes,
}) {
  if (!sql) throw new Error('sql client required');
  const resolvedLearnerId = toPositiveInteger(learnerId, 'learnerId');
  const resolvedInstructorId = toPositiveInteger(instructorId, 'instructorId');
  const resolvedSchoolId = toPositiveInteger(schoolId, 'schoolId');
  if (!Array.isArray(creditTransactionTypes) || creditTransactionTypes.length === 0) {
    throw new TypeError('creditTransactionTypes must be a non-empty array');
  }
  const resolvedTypes = creditTransactionTypes.map((type, index) => {
    const value = String(type || '').trim();
    if (!value) throw new TypeError(`creditTransactionTypes[${index}] must be non-empty`);
    return value;
  });

  return sql`
    SELECT
      ct.id,
      ct.created_at,
      ct.school_id,
      ct.minutes,
      COALESCE(ct.amount_pence, 0)::int AS amount_pence,
      COALESCE(ct.effective_rate_pence_per_minute, 0)::int AS effective_rate_pence_per_minute,
      COALESCE(ct.stripe_fee_pence, 0)::int AS stripe_fee_pence,
      ct.absorbed_by,
      COALESCE(bcs.active_minutes_drawn, 0)::int AS active_minutes_drawn,
      COALESCE(bcs.active_contribution_pence, 0)::int AS active_contribution_pence,
      COALESCE(bcs.active_stripe_fee_pence, 0)::int AS active_stripe_fee_pence,
      COALESCE(csa.adjusted_minutes, 0)::int AS adjusted_minutes,
      COALESCE(csa.adjusted_pence, 0)::int AS adjusted_pence
    FROM credit_transactions ct
    LEFT JOIN LATERAL (
      SELECT
        COALESCE(SUM(minutes_drawn), 0)::int AS active_minutes_drawn,
        COALESCE(SUM(contribution_pence), 0)::int AS active_contribution_pence,
        COALESCE(SUM(stripe_fee_pence), 0)::int AS active_stripe_fee_pence
      FROM booking_credit_sources
      WHERE credit_transaction_id = ct.id
        AND school_id = ${resolvedSchoolId}
        AND refunded_at IS NULL
    ) bcs ON TRUE
    LEFT JOIN LATERAL (
      SELECT
        COALESCE(SUM(minutes_adjusted), 0)::int AS adjusted_minutes,
        COALESCE(SUM(pence_adjusted), 0)::int AS adjusted_pence
      FROM credit_source_adjustments
      WHERE credit_transaction_id = ct.id
    ) csa ON TRUE
    WHERE ct.learner_id = ${resolvedLearnerId}
      AND ct.instructor_id = ${resolvedInstructorId}
      AND ct.school_id = ${resolvedSchoolId}
      AND ct.type = ANY(${resolvedTypes}::text[])
      AND ct.minutes > 0
    ORDER BY ct.created_at ASC, ct.id ASC
  `;
}

async function planFifoCreditDrawFromDb(sql, args) {
  const sources = await loadFifoCreditSources(sql, args);
  return planFifoCreditDraw({
    sources,
    minutes: args.minutes,
    schoolId: args.schoolId,
  });
}

module.exports = {
  planFifoCreditDraw,
  loadFifoCreditSources,
  planFifoCreditDrawFromDb,
};
