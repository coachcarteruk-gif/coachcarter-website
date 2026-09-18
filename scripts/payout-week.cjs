'use strict';

/**
 * Assemble one pay week for an instructor.
 *
 * Spec §2.1: weeks run midday Friday to midday Friday, evaluated in
 * Europe/London so BST/GMT transitions do not shift lessons between weeks. A
 * lesson at 11:00 on Friday belongs to the closing week, one at 13:00 to the
 * opening week.
 *
 * This is the layer that turns database rows into the calculation module's
 * inputs. It decides how each lesson was funded; it does not decide what
 * anything is worth. Every rate comes from api/_payout-rates.js and every
 * amount from api/_payout-summary.js.
 */

const { FUNDING } = require('../api/_payout-summary');
const { resolveWeekRates, legacyRateFor } = require('../api/_payout-rates');

/**
 * Lessons in the pay week.
 *
 * Bounds are built as Europe/London wall-clock timestamps and compared against
 * the booking's own local date+time, which is how getEligibleBookings already
 * does it (api/_payout-helpers.js casts AT TIME ZONE 'Europe/London').
 */
async function fetchWeekBookings(sql, { instructorId, schoolId, periodStart, periodEnd }) {
  return sql`
    SELECT lb.id                AS lesson_id,
           lb.learner_id        AS pupil_id,
           lu.name              AS pupil_name,
           lb.scheduled_date::text AS date,
           lb.start_time::text  AS start_time,
           -- Spec §2.2: duration is the source of truth, not a label. Derived
           -- from the booking's own times: lesson_types.duration_minutes is the
           -- catalogue's nominal length and is wrong for any extended lesson,
           -- and the payout query's COALESCE(..., 90) silently turns an unknown
           -- duration into 90 minutes — the overpayment bug in spec §1.
           EXTRACT(EPOCH FROM (lb.end_time - lb.start_time)) / 60 AS duration_minutes,
           lt.slug              AS lesson_type_slug,
           fba.source_id        AS flexible_source_id,
           (SELECT e.evidence_status
              FROM payout_flexible_source_evidence e
             WHERE e.source_id = fba.source_id
               AND e.evidence_status = 'complete'
             LIMIT 1)          AS flexible_evidence_status
      FROM lesson_bookings lb
      LEFT JOIN learner_users lu ON lu.id = lb.learner_id
      LEFT JOIN lesson_types lt  ON lt.id = lb.lesson_type_id AND lt.school_id = lb.school_id
      LEFT JOIN flexible_package_booking_allocations fba ON fba.booking_id = lb.id
     WHERE lb.instructor_id = ${instructorId}
       AND lb.school_id = ${schoolId}
       AND lb.status = 'chargeable'
       AND (lb.scheduled_date + lb.start_time) >= ${`${periodStart} 12:00`}::timestamp
       AND (lb.scheduled_date + lb.start_time) <  ${`${periodEnd} 12:00`}::timestamp
     ORDER BY lb.scheduled_date, lb.start_time
  `;
}

/**
 * How a booking was funded, as one or more segments.
 *
 * A lesson can draw on several sources at different rates — a free trial
 * extended with paid time, or a booking spanning two credit purchases — so this
 * always returns a list and the caller collapses a single entry.
 */
async function fundingSegments(sql, booking, { rates, legacy }) {
  const sources = await sql`
    SELECT minutes_drawn, contribution_pence, stripe_fee_pence
      FROM booking_credit_sources
     WHERE booking_id = ${booking.lesson_id}
       AND refunded_at IS NULL
     ORDER BY id
  `;
  if (!sources.length) return { blocked: 'LEGACY_RATE_MISSING' };

  const segments = [];
  for (const source of sources) {
    const minutes = Number(source.minutes_drawn);
    const contribution = Number(source.contribution_pence);

    // No money attached to these minutes. Either a free trial, or hours bought
    // off-platform before the current model. Both are flat-rate; neither can be
    // guessed, so an unrecognised one blocks.
    if (contribution === 0) {
      if (booking.lesson_type_slug === 'trial') {
        if (!rates.free_trial_rate_pence_per_hour) return { blocked: 'TRIAL_RATE_MISSING' };
        segments.push({
          funding: FUNDING.TRIAL,
          duration_minutes: minutes,
          flat_rate_pence_per_hour: rates.free_trial_rate_pence_per_hour,
          price_pence_per_hour: 0,
          stripe_fee_pence: null,
        });
        continue;
      }
      if (legacy && legacy.settlement === 'flat') {
        segments.push({
          funding: FUNDING.LEGACY,
          duration_minutes: minutes,
          flat_rate_pence_per_hour: legacy.rate_pence_per_hour,
          price_pence_per_hour: 0,
          stripe_fee_pence: null,
        });
        continue;
      }
      return { blocked: 'LEGACY_RATE_MISSING' };
    }

    segments.push({
      funding: FUNDING.STANDARD,
      duration_minutes: minutes,
      price_pence_per_hour: contribution / (minutes / 60),
      stripe_fee_pence: source.stripe_fee_pence,
    });
  }
  return { segments };
}

async function buildWeek(sql, { instructorId, schoolId = 1, periodStart, periodEnd = null }) {
  const end = periodEnd || (() => {
    const d = new Date(`${periodStart}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 7);
    return d.toISOString().slice(0, 10);
  })();

  const rates = await resolveWeekRates(sql, { schoolId, instructorId, periodStart });
  const bookings = await fetchWeekBookings(sql, { instructorId, schoolId, periodStart, periodEnd: end });

  const lessons = [];
  for (const booking of bookings) {
    const minutes = Math.round(Number(booking.duration_minutes));
    const lesson = {
      lesson_id: booking.lesson_id,
      pupil_id: booking.pupil_id,
      pupil_name: booking.pupil_name,
      date: booking.date,
      start_time: booking.start_time,
      duration_minutes: minutes,
      share_rate: rates.share_rate,
    };
    const legacy = await legacyRateFor(sql, { schoolId, learnerId: booking.pupil_id });

    // A Flexible Hours lesson is funded by a package, not by credit rows. Where
    // the learner has a confirmed package rate, use it; otherwise the source
    // needs its admin funding reconciliation before the lesson can be paid.
    if (booking.flexible_source_id) {
      if (legacy && legacy.settlement === 'share') {
        Object.assign(lesson, {
          funding: FUNDING.PACKAGE,
          price_pence_per_hour: legacy.rate_pence_per_hour,
          stripe_fee_pence: null,
        });
        lessons.push(lesson);
        continue;
      }
      if (booking.flexible_evidence_status !== 'complete') {
        lesson.blocked_reason = 'FLEXIBLE_SOURCE_EVIDENCE_INCOMPLETE';
        lesson.blocked_context = { source_id: Number(booking.flexible_source_id) };
        lessons.push(lesson);
        continue;
      }
    }

    const funding = await fundingSegments(sql, booking, { rates, legacy });
    if (funding.blocked) {
      lesson.blocked_reason = funding.blocked;
      lessons.push(lesson);
      continue;
    }
    const segmentMinutes = funding.segments.reduce((sum, s) => sum + s.duration_minutes, 0);
    if (segmentMinutes !== minutes) {
      lesson.blocked_reason = 'SEGMENT_MINUTES_MISMATCH';
      lesson.blocked_context = { segment_minutes: segmentMinutes, duration_minutes: minutes };
      lessons.push(lesson);
      continue;
    }
    if (funding.segments.length === 1) Object.assign(lesson, funding.segments[0]);
    else Object.assign(lesson, { funding: FUNDING.SEGMENTED, segments: funding.segments });
    lessons.push(lesson);
  }

  // Spec §2.4: the fee is a dated agreement. An unset fee is not £0 — it means
  // nothing was agreed for this period, so no deduction line is drawn at all.
  const deductions = rates.franchise_fee_pence != null
    ? [{ label: 'Franchise fee', amount_pence: rates.franchise_fee_pence }]
    : [];

  const [instructor] = await sql`
    SELECT id, name FROM instructors WHERE id = ${instructorId} AND school_id = ${schoolId}
  `;

  // eslint-disable-next-line global-require
  const { buildPayoutSummary } = require('../api/_payout-summary');
  const summary = buildPayoutSummary({
    instructor,
    periodStart,
    periodEnd: end,
    lessons,
    deductions,
  });
  summary.rates = rates;
  return { summary, periodStart, periodEnd: end };
}

module.exports = { buildWeek, fetchWeekBookings, fundingSegments };
