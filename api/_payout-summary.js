'use strict';

/**
 * Instructor payout summary — calculation.
 *
 * Pure: rows in, lines and totals out. No I/O, no SQL, no rendering. The query
 * layer supplies already-resolved rows; the render layer consumes the result.
 *
 * Spec: docs/payout/PAYOUT-SUMMARY-SPEC.md. Reference: docs/payout/payout_renderer.py.
 *
 * The load-bearing rule (spec §1): compute from the pupil's price and the
 * lesson's duration every time. NEVER store a derived hourly payout rate and
 * multiply it up — that caused the same lesson length to produce four different
 * amounts across four weeks (£72.86 / £72.95 / £72.96 / £73.02).
 *
 * Money is handled in pence as integers wherever possible. The one unavoidable
 * float is `gross = price_per_hour × hours`, which is truncated exactly once, at
 * the end, per spec §3.1.
 */

const CALCULATION_VERSION = 'payout-summary/1';

/** Spec §5: durations outside this set warn (not block) — they are unusual, not impossible. */
const EXPECTED_DURATION_HOURS = new Set([0.5, 1.0, 1.5, 2.0, 2.5, 3.0]);

/**
 * How a lesson was funded. Decides which calculation branch applies.
 *
 * standard  gross − stripe fee, × share            (spec §3.1)
 * direct    gross × share, no fee at all           (spec §3.1 rule 4/6)
 * package   package per-hour price, fee already taken on the package purchase
 * legacy    off-platform purchase; flat rate, no share, no fee
 * trial     flat hourly trial rate, no share, no fee
 */
const FUNDING = Object.freeze({
  STANDARD: 'standard',
  DIRECT: 'direct',
  PACKAGE: 'package',
  LEGACY: 'legacy',
  TRIAL: 'trial',
});

class PayoutCalculationError extends Error {
  constructor(code, message, context = {}) {
    super(message);
    this.name = 'PayoutCalculationError';
    this.code = code;
    this.context = context;
  }
}

/**
 * Truncate to the penny. Never round. Applied ONCE, at the end (spec §3.1).
 *
 * Works in a scaled integer domain and nudges by a hair before flooring:
 * 46.77 × 1.5 is 70.15499999999999 in IEEE-754, and 8250 × 0.015 lands a hair
 * under 123.75. Without the epsilon a value that is mathematically exactly
 * x.xx5000 can floor a penny low. The epsilon is far smaller than a penny, so
 * it cannot promote a genuinely-lower value.
 */
function truncatePence(amountPence) {
  if (!Number.isFinite(amountPence)) {
    throw new PayoutCalculationError('NON_FINITE_AMOUNT', 'Amount is not a finite number', { amountPence });
  }
  if (amountPence < 0) {
    throw new PayoutCalculationError('NEGATIVE_AMOUNT', 'Payout amounts must not be negative', { amountPence });
  }
  return Math.floor(amountPence + 1e-6);
}

function requirePositiveInteger(value, code, label, context) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new PayoutCalculationError(code, `${label} must be a positive integer`, { ...context, value });
  }
  return n;
}

/**
 * A rate in pence per hour that need not be a whole penny.
 *
 * Legacy rates are derived by dividing a real purchase by its hours and can land
 * on a fraction: Esha's £1214.40 for 24 hours, less the £18.42 Stripe actually
 * charged, is 4983.25 pence/hour exactly. Rounding the *rate* to 4983 would lose
 * 0.25p per hour and reintroduce the stored-derived-rate bug from spec §1, so
 * the fraction is carried through and truncation happens once, at the end.
 */
function requirePositiveRate(value, code, label, context) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new PayoutCalculationError(code, `${label} must be a positive number`, { ...context, value });
  }
  return n;
}

/**
 * Duration in hours, derived from real minutes.
 *
 * Spec §2.2 wants duration as the source of truth, not a label. In this
 * codebase the only honest source is end_time − start_time on the booking:
 * lesson_types.duration_minutes is the catalogue's nominal length and is wrong
 * for any extended lesson, and the payout query's COALESCE(..., 90) default
 * silently turns an unknown duration into 90 minutes — exactly the
 * "1 hr logged as 1.5 hr, overpaying £24.17" error from spec §1.
 */
function hoursFromMinutes(minutes, context) {
  const m = requirePositiveInteger(minutes, 'DURATION_MISSING', 'Lesson duration in minutes', context);
  return m / 60;
}

/**
 * Payout for one lesson, in pence.
 *
 * Order of operations is fixed by spec §3.1 and must not be rearranged:
 *   gross      = pupil_hourly_price × hours
 *   stripe_fee = actual fee from the balance transaction (never recomputed)
 *   payout     = truncate((gross − fee) × share)
 *
 * `stripeFeePence` is the fee Stripe actually charged, recovered from the
 * balance transaction. It is NOT recomputed as 1.5% + 20p here: production data
 * shows a PayPal payment legitimately costing 3.87%, and re-deriving would
 * quietly mis-pay it. Spec §4 is settled — one charge per lesson — so there is
 * no transaction_count multiplier.
 */
function calculateLessonPayout(lesson) {
  const context = { lesson_id: lesson?.lesson_id };
  const funding = lesson?.funding;
  if (!Object.values(FUNDING).includes(funding)) {
    throw new PayoutCalculationError('UNKNOWN_FUNDING', `Unknown funding type: ${funding}`, context);
  }

  const hours = hoursFromMinutes(lesson.duration_minutes, context);

  // Trial and legacy are flat hourly arrangements: the money either never
  // existed (trial) or arrived off-platform before this model (legacy), so
  // there is no gross to take a share of and no Stripe fee to deduct.
  if (funding === FUNDING.TRIAL || funding === FUNDING.LEGACY) {
    const code = funding === FUNDING.TRIAL ? 'TRIAL_RATE_MISSING' : 'LEGACY_RATE_MISSING';
    const rate = requirePositiveRate(lesson.flat_rate_pence_per_hour, code,
      `${funding} rate (pence per hour)`, context);
    return {
      payout_pence: truncatePence(rate * hours),
      gross_pence: null,
      stripe_fee_pence: 0,
      share_rate: null,
      hours,
      funding,
    };
  }

  // Spec §5 + §9 rule 7: never silently default a pupil's price to £55.
  const pricePerHour = requirePositiveInteger(lesson.price_pence_per_hour, 'PUPIL_PRICE_MISSING',
    'Pupil hourly price (pence)', context);

  const shareRate = Number(lesson.share_rate);
  if (!Number.isFinite(shareRate) || shareRate <= 0 || shareRate > 1) {
    throw new PayoutCalculationError('SHARE_RATE_INVALID',
      'Share rate must be a number in (0, 1]', { ...context, share_rate: lesson.share_rate });
  }

  const gross = pricePerHour * hours;

  // DIRECT and PACKAGE take no fee, but for different reasons, and the
  // distinction matters (spec §3.1 rule 6): a direct bank payment takes neither
  // the percentage nor the fixed fee. Modelling it as "zero fixed fees" would
  // still deduct 1.5% and underpay £48.75 instead of £49.50 per hour.
  let feePence = 0;
  if (funding === FUNDING.STANDARD) {
    // Check for null/undefined BEFORE Number(): Number(null) is 0, which would
    // sail through isSafeInteger and silently treat missing fee evidence as a
    // zero fee — overpaying 93p on a £55 hour (£49.50 instead of £48.57).
    // A NULL stripe_fee_pence means "we do not know", never "there was no fee".
    if (lesson.stripe_fee_pence === null || lesson.stripe_fee_pence === undefined || lesson.stripe_fee_pence === '') {
      throw new PayoutCalculationError('STRIPE_FEE_EVIDENCE_MISSING',
        'Stripe-funded lesson has no verified processing fee', { ...context, stripe_fee_pence: lesson.stripe_fee_pence });
    }
    const fee = Number(lesson.stripe_fee_pence);
    if (!Number.isSafeInteger(fee) || fee < 0) {
      throw new PayoutCalculationError('STRIPE_FEE_EVIDENCE_MISSING',
        'Stripe-funded lesson has no verified processing fee', { ...context, stripe_fee_pence: lesson.stripe_fee_pence });
    }
    if (fee > gross + 1e-6) {
      throw new PayoutCalculationError('STRIPE_FEE_EXCEEDS_GROSS',
        'Processing fee exceeds gross', { ...context, fee, gross });
    }
    feePence = fee;
  }

  return {
    payout_pence: truncatePence((gross - feePence) * shareRate),
    gross_pence: gross,
    stripe_fee_pence: feePence,
    share_rate: shareRate,
    hours,
    funding,
  };
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Spec §6.5: `Fri 11 Sep` — abbreviated day and month, no year. */
function formatRowDate(isoDate) {
  const d = new Date(`${String(isoDate).slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) {
    throw new PayoutCalculationError('INVALID_DATE', 'Lesson date is not parseable', { date: isoDate });
  }
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** Spec §6.5: `Pupil Name – 1.5 hr`, en dash with spaces. Trailing .0 dropped. */
function formatDescription(pupilName, hours) {
  const h = Number.isInteger(hours) ? String(hours) : String(Number(hours.toFixed(2)));
  return `${pupilName} – ${h} hr`;
}

function poundsFromPence(pence) {
  return pence / 100;
}

/**
 * Spec §6.5: the sub-note is the rate basis, and it is what lets the instructor
 * reproduce the total themselves. It is not decorative — keep it.
 */
function formatNote(lesson, computed) {
  switch (computed.funding) {
    case FUNDING.TRIAL:
      return 'Free trial';
    case FUNDING.LEGACY:
      return `Legacy rate £${poundsFromPence(lesson.flat_rate_pence_per_hour).toFixed(2)}/hr`;
    case FUNDING.PACKAGE:
      return `Package rate £${poundsFromPence(lesson.price_pence_per_hour).toFixed(2)}/hr`;
    case FUNDING.DIRECT: {
      const perHour = poundsFromPence(lesson.price_pence_per_hour) * computed.share_rate;
      return `Direct payment £${perHour.toFixed(2)}/hr`;
    }
    default:
      return `£${poundsFromPence(lesson.price_pence_per_hour).toFixed(2)}/hr pupil price`;
  }
}

/**
 * Spec §5 — run before rendering. Each check exists because it caught a real
 * error in a hand-built sheet. Blocks are fatal; warnings surface to the
 * operator before the image is generated, not after it has been sent.
 */
function validateLessons(lessons) {
  const warnings = [];
  const seenIds = new Set();
  const priceByPupil = new Map();
  const hoursByPupilDay = new Map();

  for (const lesson of lessons) {
    const id = lesson.lesson_id;
    if (id === undefined || id === null) {
      throw new PayoutCalculationError('LESSON_ID_MISSING', 'Every lesson needs an id for reconciliation');
    }
    if (seenIds.has(id)) {
      throw new PayoutCalculationError('DUPLICATE_LESSON_ID', `Duplicate lesson_id: ${id}`, { lesson_id: id });
    }
    seenIds.add(id);

    // Pupils are keyed on id, never name. "%Esha%" also matches "Aleesha".
    const pupilKey = lesson.pupil_id;
    if (pupilKey === undefined || pupilKey === null) {
      throw new PayoutCalculationError('PUPIL_ID_MISSING', 'Every lesson needs a pupil_id', { lesson_id: id });
    }

    // Spec §5: a genuine tier change should be dated, not concurrent.
    if (lesson.price_pence_per_hour != null) {
      const prior = priceByPupil.get(pupilKey);
      if (prior != null && prior !== lesson.price_pence_per_hour) {
        throw new PayoutCalculationError('PUPIL_PRICE_CONFLICT',
          `Pupil ${pupilKey} has two different hourly prices in one week: ${prior} and ${lesson.price_pence_per_hour}`,
          { lesson_id: id, pupil_id: pupilKey });
      }
      priceByPupil.set(pupilKey, lesson.price_pence_per_hour);
    }

    const hours = hoursFromMinutes(lesson.duration_minutes, { lesson_id: id });
    if (!EXPECTED_DURATION_HOURS.has(hours)) {
      warnings.push({ code: 'UNUSUAL_DURATION', lesson_id: id, hours });
    }

    if (lesson.funding === FUNDING.TRIAL && Number(lesson.price_pence_per_hour) > 0) {
      warnings.push({ code: 'TRIAL_WITH_PRICE', lesson_id: id, price_pence_per_hour: lesson.price_pence_per_hour });
    }

    const dayKey = `${pupilKey}|${String(lesson.date).slice(0, 10)}`;
    const dayHours = (hoursByPupilDay.get(dayKey) || 0) + hours;
    hoursByPupilDay.set(dayKey, dayHours);
  }

  for (const [key, hours] of hoursByPupilDay) {
    if (hours > 2.5) {
      const [pupilId, date] = key.split('|');
      warnings.push({ code: 'PUPIL_DAY_OVER_2_5_HOURS', pupil_id: pupilId, date, hours });
    }
  }

  return warnings;
}

/**
 * Build a full pay-week summary.
 *
 * `lessons` are already filtered to the pay week and to payable status by the
 * query layer. Deductions are instructor-owed lines (the franchise fee, and any
 * others), in pence.
 *
 * Throws rather than returning a bad number: spec §9 rule 9 requires every
 * rendered total to reconcile exactly to the sum of its lines, or refuse to
 * render.
 */
function buildPayoutSummary({ instructor, periodStart, periodEnd, lessons, deductions = [] }) {
  if (!instructor || !instructor.name) {
    throw new PayoutCalculationError('INSTRUCTOR_MISSING', 'Instructor name is required');
  }

  const warnings = validateLessons(lessons);

  const ordered = [...lessons].sort((a, b) => {
    const byDate = String(a.date).localeCompare(String(b.date));
    if (byDate !== 0) return byDate;
    return String(a.start_time || '').localeCompare(String(b.start_time || ''));
  });

  const earnings = ordered.map((lesson) => {
    const computed = calculateLessonPayout(lesson);
    return {
      lesson_id: lesson.lesson_id,
      pupil_id: lesson.pupil_id,
      date: formatRowDate(lesson.date),
      description: formatDescription(lesson.pupil_name, computed.hours),
      note: formatNote(lesson, computed),
      amount_pence: computed.payout_pence,
      // Kept so a disputed figure traces to lesson ids without regenerating (spec §8).
      basis: {
        funding: computed.funding,
        hours: computed.hours,
        gross_pence: computed.gross_pence,
        stripe_fee_pence: computed.stripe_fee_pence,
        share_rate: computed.share_rate,
      },
    };
  });

  const deductionLines = deductions.map((d) => {
    const amount = requirePositiveInteger(d.amount_pence, 'DEDUCTION_INVALID', 'Deduction amount (pence)', { label: d.label });
    return { date: d.date || 'Weekly', description: d.label, note: d.note || '', amount_pence: amount };
  });

  const subtotalPence = earnings.reduce((sum, line) => sum + line.amount_pence, 0);
  const deductedPence = deductionLines.reduce((sum, line) => sum + line.amount_pence, 0);
  const netPence = subtotalPence - deductedPence;

  // Spec §5 + §9 rule 9. Integer pence throughout, so this is exact equality:
  // any mismatch means a line was mutated after summing, and we refuse.
  const recomputedSubtotal = earnings.reduce((sum, line) => sum + line.amount_pence, 0);
  if (recomputedSubtotal !== subtotalPence) {
    throw new PayoutCalculationError('SUBTOTAL_DOES_NOT_RECONCILE',
      'Recomputed subtotal does not equal the sum of rendered lines',
      { subtotalPence, recomputedSubtotal });
  }
  if (netPence !== subtotalPence - deductedPence) {
    throw new PayoutCalculationError('NET_DOES_NOT_RECONCILE', 'Net does not reconcile',
      { subtotalPence, deductedPence, netPence });
  }

  const totalMinutes = ordered.reduce((sum, l) => sum + Number(l.duration_minutes), 0);
  const totalHours = totalMinutes / 60;

  return {
    calculation_version: CALCULATION_VERSION,
    instructor: { id: instructor.id, name: instructor.name },
    period: { start: periodStart, end: periodEnd },
    earnings,
    deductions: deductionLines,
    totals: {
      subtotal_pence: subtotalPence,
      deducted_pence: deductedPence,
      net_pence: netPence,
    },
    counts: { lessons: ordered.length, hours: totalHours },
    warnings,
  };
}

module.exports = {
  CALCULATION_VERSION,
  FUNDING,
  PayoutCalculationError,
  truncatePence,
  hoursFromMinutes,
  calculateLessonPayout,
  validateLessons,
  buildPayoutSummary,
  formatRowDate,
  formatDescription,
};
