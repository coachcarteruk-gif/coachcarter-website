'use strict';

/**
 * As-of rate resolution for the instructor payout summary.
 *
 * Spec §2.4 and business rule 8: the franchise fee and share rate must be
 * effective-dated, so regenerating an old week reproduces that week's figures
 * rather than today's. Reading instructors.commission_rate directly gives you
 * today's number applied to last month's lessons, which silently restates
 * history — and history is what gets disputed.
 *
 * Every lookup here takes an `asOf` date and answers "what was true then",
 * never "what is true now".
 *
 * Reads only. Tables are created by db/migrations/069_payout_summary_rates.sql.
 */

class PayoutRateError extends Error {
  constructor(code, message, context = {}) {
    super(message);
    this.name = 'PayoutRateError';
    this.code = code;
    this.context = context;
  }
}

/**
 * The rate in force on `asOf`: the most recent row starting on or before that
 * date. Returns null when no rate had been set yet, which the caller must treat
 * as a block rather than a default — spec §9 rule 7.
 */
async function rateAsOf(sql, { schoolId, instructorId, rateKind, asOf }) {
  const [row] = await sql`
    SELECT rate_value, effective_from::text AS effective_from, note
      FROM instructor_rate_history
     WHERE school_id = ${schoolId}
       AND instructor_id = ${instructorId}
       AND rate_kind = ${rateKind}
       AND effective_from <= ${asOf}::date
     ORDER BY effective_from DESC
     LIMIT 1
  `;
  return row || null;
}

/**
 * Commission share as a fraction (0.90), from basis points (9000).
 *
 * Falls back to instructors.commission_rate when no history row covers the
 * date, because the history table starts empty and the current-value column is
 * what every existing payout already uses. The fallback is reported in the
 * result so a caller can tell a dated fact from a current guess — silently
 * blending the two is how "which rate applied?" becomes unanswerable.
 */
async function commissionShareAsOf(sql, { schoolId, instructorId, asOf }) {
  const dated = await rateAsOf(sql, { schoolId, instructorId, rateKind: 'commission_share', asOf });
  if (dated) {
    return { share_rate: dated.rate_value / 10000, source: 'rate_history', effective_from: dated.effective_from };
  }
  const [instructor] = await sql`
    SELECT commission_rate FROM instructors
     WHERE id = ${instructorId} AND school_id = ${schoolId}
  `;
  const current = Number(instructor?.commission_rate);
  if (!Number.isFinite(current) || current <= 0 || current > 1) {
    throw new PayoutRateError('COMMISSION_RATE_MISSING',
      'No dated or current commission rate for this instructor',
      { instructorId, asOf });
  }
  return { share_rate: current, source: 'instructor_current', effective_from: null };
}

/**
 * Weekly franchise fee in pence.
 *
 * No fallback to a hardcoded £90. weekly_franchise_fee_pence is NULL for every
 * instructor in production, so a default here would invent a deduction nobody
 * agreed to and quietly take £90 off an instructor's pay. Returning null forces
 * the caller to decide.
 */
async function franchiseFeeAsOf(sql, { schoolId, instructorId, asOf }) {
  const dated = await rateAsOf(sql, { schoolId, instructorId, rateKind: 'weekly_franchise_fee', asOf });
  if (dated) {
    return { fee_pence: dated.rate_value, source: 'rate_history', effective_from: dated.effective_from };
  }
  const [instructor] = await sql`
    SELECT weekly_franchise_fee_pence FROM instructors
     WHERE id = ${instructorId} AND school_id = ${schoolId}
  `;
  const current = instructor?.weekly_franchise_fee_pence;
  if (current === null || current === undefined) {
    return { fee_pence: null, source: 'unset', effective_from: null };
  }
  return { fee_pence: Number(current), source: 'instructor_current', effective_from: null };
}

/**
 * An off-platform legacy rate, or null if the learner has none.
 *
 * `rate_pence_per_hour` is NUMERIC(12,4) and is deliberately returned as a
 * float rather than rounded: Esha's is 4983.25 pence/hour exactly, and
 * rounding the rate before multiplying by hours is the bug in spec §1.
 */
async function legacyRateFor(sql, { schoolId, learnerId }) {
  const [row] = await sql`
    SELECT rate_pence_per_hour, settlement, purchased_on::text AS purchased_on,
           purchase_reference, note
      FROM learner_legacy_rates
     WHERE school_id = ${schoolId} AND learner_id = ${learnerId}
  `;
  if (!row) return null;
  return {
    rate_pence_per_hour: Number(row.rate_pence_per_hour),
    settlement: row.settlement,
    purchased_on: row.purchased_on,
    purchase_reference: row.purchase_reference,
    note: row.note,
  };
}

/**
 * The school's free-trial rate. Config-driven per CLAUDE.md franchise rule 1,
 * rather than the constant in docs/payout/payout_renderer.py.
 *
 * Returns null rather than defaulting to £30: a school that has not set one
 * should block, not silently adopt CoachCarter's figure.
 */
async function freeTrialRateFor(sql, { schoolId }) {
  const [school] = await sql`SELECT config FROM schools WHERE id = ${schoolId}`;
  const raw = school?.config?.pricing?.free_trial_rate_pence_per_hour;
  const rate = Number(raw);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return rate;
}

/**
 * Everything a pay week needs, resolved once for the period start.
 *
 * The period start is the as-of date: a rate that changes mid-week applies to
 * the following week, so one week is never split across two rates. That is
 * simpler to explain to an instructor than a part-week proration, and matches
 * how the weekly fee is actually agreed.
 */
async function resolveWeekRates(sql, { schoolId, instructorId, periodStart }) {
  const [commission, franchise, freeTrialRate] = await Promise.all([
    commissionShareAsOf(sql, { schoolId, instructorId, asOf: periodStart }),
    franchiseFeeAsOf(sql, { schoolId, instructorId, asOf: periodStart }),
    freeTrialRateFor(sql, { schoolId }),
  ]);
  return {
    as_of: periodStart,
    share_rate: commission.share_rate,
    share_rate_source: commission.source,
    franchise_fee_pence: franchise.fee_pence,
    franchise_fee_source: franchise.source,
    free_trial_rate_pence_per_hour: freeTrialRate,
  };
}

module.exports = {
  PayoutRateError,
  rateAsOf,
  commissionShareAsOf,
  franchiseFeeAsOf,
  legacyRateFor,
  freeTrialRateFor,
  resolveWeekRates,
};
