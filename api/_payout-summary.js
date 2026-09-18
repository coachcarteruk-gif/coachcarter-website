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
  // A lesson funded by several sources at different rates — see
  // calculateSegmentedPayout. Carries `segments`, not its own price.
  SEGMENTED: 'segmented',
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
 * Why a lesson could not be included, and whose problem it is.
 *
 * `operator_action` distinguishes "a human must do something" from "the data is
 * broken". A Flexible Hours lesson whose source has no terminal evidence row is
 * not a defect: evidence capture is a deliberate admin-attested reconciliation
 * (api/_interim-v1-payout.js, action interim-v1-reconcile-funding-evidence), so
 * the summary should say "awaiting reconciliation" and name the source, not
 * report a generic failure the operator cannot act on.
 */
const BLOCK_REASONS = Object.freeze({
  FLEXIBLE_SOURCE_EVIDENCE_INCOMPLETE: {
    operator_action: true,
    summary: 'Flexible Hours funding is not yet reconciled',
    detail: 'An admin must record the Stripe funding evidence for this source before the lesson can be paid.',
  },
  FLEXIBLE_SOURCE_EVIDENCE_CONTRADICTORY: {
    operator_action: true,
    summary: 'Flexible Hours funding evidence contradicts the source',
    detail: 'The recorded Stripe facts do not match the stored source. Investigate before paying.',
  },
  LEGACY_RATE_MISSING: {
    operator_action: true,
    summary: 'Off-platform legacy rate is not recorded',
    detail: 'This pupil paid outside the platform. Store their agreed hourly rate before the lesson can be paid.',
  },
  STRIPE_FEE_EVIDENCE_MISSING: {
    operator_action: false,
    summary: 'Stripe processing fee evidence is missing',
    detail: 'The fee Stripe charged was never recorded against this funding. Recover it from the balance transaction.',
  },
  PUPIL_PRICE_MISSING: {
    operator_action: true,
    summary: 'No price record for this pupil',
    detail: 'Never defaulted. Record what this lesson was worth before it can be paid.',
  },
});

/**
 * Describe a blocked lesson for the operator. Unknown codes still return a
 * usable shape so a new failure mode is never swallowed.
 */
function describeBlock(code, context = {}) {
  const known = BLOCK_REASONS[code];
  return {
    code,
    operator_action: known ? known.operator_action : false,
    summary: known ? known.summary : 'Lesson could not be calculated',
    detail: known ? known.detail : 'Unrecognised block reason — investigate before rendering.',
    ...context,
  };
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
/**
 * A lesson can be funded by several sources at different rates, and they must
 * each be calculated on their own terms.
 *
 * The real case: a free trial extended with paid time. Booking #580 is 180
 * minutes made of a 60-minute free trial (£0) plus a 120-minute paid extension
 * (£110, fee 185p). Treating the whole thing as one lesson is wrong either way
 * — as a standard lesson it pays £97.33 and swallows the free hour; as a trial
 * it pays £90.00 and gives away two paid hours. The correct payout is £30.00 +
 * £97.33 = £127.33.
 *
 * Each segment is truncated on its own, because each is a separate funding fact
 * with its own gross and its own fee. Summing untruncated segments and
 * truncating once at the end would be a different (and wrong) answer: it would
 * silently move pennies between funding sources.
 */
function calculateSegmentedPayout(lesson) {
  const segments = lesson.segments;
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new PayoutCalculationError('SEGMENTS_EMPTY', 'A segmented lesson needs at least one segment',
      { lesson_id: lesson.lesson_id });
  }

  const totalMinutes = segments.reduce((sum, s) => sum + Number(s.duration_minutes || 0), 0);
  if (totalMinutes !== Number(lesson.duration_minutes)) {
    throw new PayoutCalculationError('SEGMENT_MINUTES_MISMATCH',
      'Segment minutes do not sum to the lesson duration',
      { lesson_id: lesson.lesson_id, totalMinutes, duration_minutes: lesson.duration_minutes });
  }

  const computed = segments.map((segment) => calculateLessonPayout({
    ...segment,
    lesson_id: lesson.lesson_id,
    share_rate: segment.share_rate ?? lesson.share_rate,
  }));

  return {
    payout_pence: computed.reduce((sum, c) => sum + c.payout_pence, 0),
    gross_pence: computed.reduce((sum, c) => sum + (c.gross_pence || 0), 0) || null,
    stripe_fee_pence: computed.reduce((sum, c) => sum + c.stripe_fee_pence, 0),
    share_rate: null,
    hours: totalMinutes / 60,
    funding: FUNDING.SEGMENTED,
    segments: computed,
  };
}

function calculateLessonPayout(lesson) {
  const context = { lesson_id: lesson?.lesson_id };
  if (lesson?.funding === FUNDING.SEGMENTED) return calculateSegmentedPayout(lesson);
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
  //
  // Accepts a fraction for the same reason legacy rates do: a package price is
  // derived by dividing a real purchase by its hours and rarely lands on a whole
  // penny. Viba's 15-hour package is £810.00 less the £4.25 Stripe actually
  // charged = £805.75 over 15 hours = 5371.6667 pence/hour. Rounding that to
  // 5372 before multiplying is exactly the "rate rounded before being multiplied
  // by hours" drift in spec §1 — it pays £48.35 for an hour where truncating
  // once gives £48.34, and the gap widens with duration.
  const pricePerHour = requirePositiveRate(lesson.price_pence_per_hour, 'PUPIL_PRICE_MISSING',
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
    // Spell out each part: the whole point of the note is that the instructor
    // can reproduce the total, and a segmented lesson's total reconciles to
    // nothing without its parts. "Free trial 1 hr + £110.00/2 hr".
    case FUNDING.SEGMENTED:
      return lesson.segments.map((segment, i) => {
        const hours = Number(segment.duration_minutes) / 60;
        const h = Number.isInteger(hours) ? `${hours} hr` : `${hours} hr`;
        if (segment.funding === FUNDING.TRIAL) return `Free trial ${h}`;
        if (segment.funding === FUNDING.LEGACY) {
          return `Legacy £${poundsFromPence(segment.flat_rate_pence_per_hour).toFixed(2)}/hr ${h}`;
        }
        const gross = poundsFromPence(segment.price_pence_per_hour * hours);
        return `${i === 0 ? '' : '+ '}£${gross.toFixed(2)}/${h}`;
      }).join(' ');
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
    // Segmented lessons are exempt: a free trial extended with paid time
    // legitimately carries two rates within one lesson, which is not the
    // "same pupil billed at two different rates" error this check exists for.
    if (lesson.funding !== FUNDING.SEGMENTED && lesson.price_pence_per_hour != null) {
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

  // Blocked lessons are excluded from validation: they have no resolved price
  // or rate yet, so a price-conflict or duration check on them would report a
  // problem the operator cannot act on and that says nothing about the payable
  // lines. Duplicate-id checking still covers every lesson, below.
  const warnings = validateLessons(lessons.filter((l) => !l.blocked_reason));
  const allIds = new Set();
  for (const lesson of lessons) {
    if (allIds.has(lesson.lesson_id)) {
      throw new PayoutCalculationError('DUPLICATE_LESSON_ID',
        `Duplicate lesson_id: ${lesson.lesson_id}`, { lesson_id: lesson.lesson_id });
    }
    allIds.add(lesson.lesson_id);
  }

  const ordered = [...lessons].sort((a, b) => {
    const byDate = String(a.date).localeCompare(String(b.date));
    if (byDate !== 0) return byDate;
    return String(a.start_time || '').localeCompare(String(b.start_time || ''));
  });

  // A lesson the caller has already determined cannot be calculated. It is
  // reported, never silently dropped: a week that quietly omits a lesson is
  // indistinguishable from one where the lesson never happened, and the
  // instructor would have no way to notice the difference.
  const blocked = ordered
    .filter((lesson) => lesson.blocked_reason)
    .map((lesson) => describeBlock(lesson.blocked_reason, {
      lesson_id: lesson.lesson_id,
      pupil_id: lesson.pupil_id,
      pupil_name: lesson.pupil_name,
      date: lesson.date,
      ...(lesson.blocked_context || {}),
    }));

  const payable = ordered.filter((lesson) => !lesson.blocked_reason);

  // A lesson that cannot be calculated becomes a reported block rather than an
  // exception that kills the whole week. One unpayable lesson must not stop the
  // operator seeing the other fifteen — but it must never be silently dropped
  // either, so it lands in `blocked` with the reason and is excluded from every
  // total. Errors that indicate a broken caller (duplicate ids, a missing
  // instructor) are still thrown, above.
  const earnings = [];
  for (const lesson of payable) {
    let computed;
    try {
      computed = calculateLessonPayout(lesson);
    } catch (err) {
      if (!(err instanceof PayoutCalculationError)) throw err;
      blocked.push(describeBlock(err.code, {
        lesson_id: lesson.lesson_id,
        pupil_id: lesson.pupil_id,
        pupil_name: lesson.pupil_name,
        date: lesson.date,
      }));
      continue;
    }
    earnings.push(buildEarningLine(lesson, computed));
  }

  function buildEarningLine(lesson, computed) {
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
        minutes: Number(lesson.duration_minutes),
      },
    };
  }

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

  // Counts describe the rendered lines only, and are derived from `earnings`
  // rather than the input: a lesson that failed calculation moved to `blocked`
  // after `payable` was built, so counting the input would make the footer
  // ("17 lessons, 22 hours") contradict the lines above it.
  const totalMinutes = earnings.reduce((sum, line) => sum + line.basis.minutes, 0);
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
    counts: { lessons: earnings.length, hours: totalHours },
    blocked,
    warnings,
  };
}

module.exports = {
  CALCULATION_VERSION,
  FUNDING,
  BLOCK_REASONS,
  describeBlock,
  PayoutCalculationError,
  truncatePence,
  hoursFromMinutes,
  calculateLessonPayout,
  validateLessons,
  buildPayoutSummary,
  formatRowDate,
  formatDescription,
};
