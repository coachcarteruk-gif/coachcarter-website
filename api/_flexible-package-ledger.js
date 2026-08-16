'use strict';

const { withNeonTransaction } = require('./_db-transaction');
const { SCHEDULED, REFUNDED, BLOCKING_STATUSES } = require('./_booking-status');
const { operationalTimeZone, zonedDateTimeToDate } = require('./_full-curriculum');

const FLEXIBLE_UNIT_MINUTES = 30;

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

class FlexiblePackageAbort extends Error {
  constructor(result) {
    super(result?.message || result?.code || 'FLEXIBLE_PACKAGE_ABORT');
    this.name = 'FlexiblePackageAbort';
    this.result = { ok: false, ...(result || {}) };
  }
}

function abort(result) {
  throw new FlexiblePackageAbort(result);
}

function unitsForDuration(durationMinutes) {
  const duration = Number(durationMinutes);
  if (!Number.isSafeInteger(duration) || duration <= 0 || duration % FLEXIBLE_UNIT_MINUTES !== 0) return null;
  return duration / FLEXIBLE_UNIT_MINUTES;
}

function hoursUntilFlexibleLesson({ scheduledDate, startTime, schoolConfig, now = new Date() }) {
  const lessonAt = zonedDateTimeToDate(
    String(scheduledDate || '').slice(0, 10),
    String(startTime || '').slice(0, 5),
    operationalTimeZone(schoolConfig)
  );
  const nowAt = now instanceof Date ? now : new Date(now);
  if (!lessonAt || Number.isNaN(nowAt.getTime())) return null;
  return (lessonAt.getTime() - nowAt.getTime()) / 3600000;
}

function planFlexiblePackageFifo(sources, unitsRequired) {
  const required = Number(unitsRequired);
  if (!Number.isSafeInteger(required) || required <= 0) {
    return { ok: false, code: 'INVALID_UNIT_REQUEST', allocations: [] };
  }
  let remaining = required;
  const allocations = [];
  for (const source of sources || []) {
    const available = Math.max(0, Number(source.remaining_units || 0));
    if (!available || remaining <= 0) continue;
    const units = Math.min(available, remaining);
    const rate = Number(source.rate_pence_per_unit);
    if (!Number.isSafeInteger(rate) || rate <= 0) {
      return { ok: false, code: 'INVALID_SOURCE_RATE', source_id: source.id, allocations: [] };
    }
    allocations.push({
      source_id: Number(source.id),
      units,
      rate_pence_per_unit: rate,
      contribution_pence: units * rate,
    });
    remaining -= units;
  }
  if (remaining > 0) {
    return { ok: false, code: 'INSUFFICIENT_FLEXIBLE_UNITS', shortage_units: remaining, allocations: [] };
  }
  return {
    ok: true,
    units: required,
    allocations,
    contribution_pence: allocations.reduce((sum, row) => sum + row.contribution_pence, 0),
  };
}

async function bookFlexiblePackageSlotTransaction({
  connectionString,
  learnerId,
  instructorId,
  schoolId,
  date,
  startTime,
  endTime,
  lessonTypeId,
  durationMinutes,
  pickupAddress,
  dropoffAddress,
  transmissionType = 'manual',
  clientRequestId,
}) {
  const unitsRequired = unitsForDuration(durationMinutes);
  if (!unitsRequired) {
    return { ok: false, code: 'FLEXIBLE_DURATION_INCOMPATIBLE', unit_minutes: FLEXIBLE_UNIT_MINUTES };
  }
  if (!isUuid(clientRequestId)) {
    return { ok: false, code: 'FLEXIBLE_BOOKING_REQUEST_ID_REQUIRED' };
  }
  try {
    return await withNeonTransaction(connectionString, async client => {
      const learner = await client.query(
        `SELECT id FROM learner_users WHERE id = $1 AND school_id = $2 FOR UPDATE`,
        [learnerId, schoolId]
      );
      if (!learner.rowCount) abort({ code: 'LEARNER_SCOPE_MISMATCH' });

      const instructor = await client.query(
        `SELECT id FROM instructors WHERE id = $1 AND school_id = $2 AND active = TRUE FOR SHARE`,
        [instructorId, schoolId]
      );
      if (!instructor.rowCount) abort({ code: 'INSTRUCTOR_NOT_ELIGIBLE' });

      await client.query(`SELECT pg_advisory_xact_lock($1, $2)`, [schoolId, learnerId]);

      const existing = await client.query(
        `SELECT b.id, b.instructor_id, b.scheduled_date::text, b.start_time::text,
                b.end_time::text, b.lesson_type_id, b.status, b.created_at,
                COALESCE(SUM(a.units_allocated),0)::int AS allocated_units
           FROM lesson_bookings b
           LEFT JOIN flexible_package_booking_allocations a
             ON a.booking_id = b.id AND a.school_id = b.school_id
          WHERE b.school_id = $1 AND b.learner_id = $2
            AND b.flexible_package_booking_request_id = $3::uuid
          GROUP BY b.id
          LIMIT 1`,
        [schoolId, learnerId, clientRequestId]
      );
      if (existing.rowCount) {
        const row = existing.rows[0];
        if (Number(row.instructor_id) !== Number(instructorId)
            || row.scheduled_date !== String(date)
            || String(row.start_time).slice(0, 5) !== String(startTime).slice(0, 5)
            || String(row.end_time).slice(0, 5) !== String(endTime).slice(0, 5)
            || Number(row.lesson_type_id) !== Number(lessonTypeId)
            || Number(row.allocated_units) !== unitsRequired) {
          abort({ code: 'FLEXIBLE_BOOKING_REQUEST_MISMATCH' });
        }
        const balance = await client.query(
          `SELECT COALESCE(SUM(remaining_units),0)::int AS remaining_units
             FROM flexible_package_source_remaining
            WHERE school_id = $1 AND learner_id = $2`,
          [schoolId, learnerId]
        );
        return { ok: true, reused: true, booking: row, allocations: [],
          remainingUnits: Number(balance.rows[0]?.remaining_units || 0) };
      }

      const conflicts = await client.query(
        `SELECT id FROM lesson_bookings
          WHERE school_id = $1 AND instructor_id = $2 AND scheduled_date = $3::date
            AND start_time = $4::time AND status = ANY($5::text[])
          LIMIT 1`,
        [schoolId, instructorId, date, startTime, BLOCKING_STATUSES]
      );
      if (conflicts.rowCount) abort({ code: 'SLOTS_UNAVAILABLE' });

      const sources = await client.query(
        `SELECT s.id, s.rate_pence_per_unit,
                GREATEST(0, s.initial_units
                  - COALESCE((SELECT SUM(r.units_reduced) FROM flexible_package_source_reductions r
                               WHERE r.source_id = s.id AND r.school_id = $1), 0)
                  - COALESCE((SELECT SUM(a.units_allocated)
                                FROM flexible_package_booking_allocations a
                               WHERE a.source_id = s.id AND a.school_id = $1
                                 AND NOT EXISTS (
                                   SELECT 1 FROM flexible_package_allocation_returns ar
                                    WHERE ar.allocation_id = a.id AND ar.school_id = a.school_id
                                 )), 0)
                )::int AS remaining_units
           FROM flexible_package_sources s
          WHERE s.school_id = $1 AND s.learner_id = $2 AND s.available_at <= NOW()
          ORDER BY s.available_at ASC, s.id ASC
          FOR UPDATE OF s`,
        [schoolId, learnerId]
      );
      const plan = planFlexiblePackageFifo(sources.rows, unitsRequired);
      if (!plan.ok) abort(plan);

      const inserted = await client.query(
        `INSERT INTO lesson_bookings (
           learner_id, instructor_id, scheduled_date, start_time, end_time, status,
           pickup_address, dropoff_address, lesson_type_id, transmission_type,
           minutes_deducted, school_id, payment_method, stripe_fee_pence,
           stripe_fee_source, list_price_pence, list_price_source
           , flexible_package_booking_request_id
         ) VALUES (
           $1, $2, $3::date, $4::time, $5::time, $6,
           $7, $8, $9, $10, $11, $12, 'flexible_package', 0,
           'platform_absorbed_package_fee', $13, 'flexible_package_frozen_rate', $14::uuid
         )
         RETURNING id, scheduled_date::text, start_time::text, end_time::text, status, created_at`,
        [
          learnerId, instructorId, date, startTime, endTime, SCHEDULED,
          pickupAddress || null, dropoffAddress || null, lessonTypeId || null,
          transmissionType, Number(durationMinutes), schoolId, plan.contribution_pence, clientRequestId,
        ]
      );
      const booking = inserted.rows[0];

      for (const allocation of plan.allocations) {
        await client.query(
          `INSERT INTO flexible_package_booking_allocations (
             school_id, learner_id, source_id, booking_id, instructor_id,
             units_allocated, unit_minutes, rate_pence_per_unit, contribution_pence
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            schoolId, learnerId, allocation.source_id, booking.id, instructorId,
            allocation.units, FLEXIBLE_UNIT_MINUTES, allocation.rate_pence_per_unit,
            allocation.contribution_pence,
          ]
        );
      }
      await client.query(
        `INSERT INTO flexible_package_state_events (
           school_id, learner_id, event_type, booking_id, detail
         ) VALUES ($1,$2,'booking_allocated',$3,$4::jsonb)`,
        [schoolId, learnerId, booking.id, JSON.stringify({
          instructor_id: instructorId,
          units: unitsRequired,
          unit_minutes: FLEXIBLE_UNIT_MINUTES,
          contribution_pence: plan.contribution_pence,
          client_request_id: clientRequestId,
          sources: plan.allocations.map(row => ({ source_id: row.source_id, units: row.units })),
        })]
      );
      const balance = await client.query(
        `SELECT COALESCE(SUM(remaining_units),0)::int AS remaining_units
           FROM flexible_package_source_remaining
          WHERE school_id = $1 AND learner_id = $2`,
        [schoolId, learnerId]
      );
      return {
        ok: true,
        reused: false,
        booking,
        allocations: plan.allocations,
        contributionPence: plan.contribution_pence,
        remainingUnits: Number(balance.rows[0]?.remaining_units || 0),
      };
    });
  } catch (error) {
    if (error instanceof FlexiblePackageAbort) return error.result;
    if (error?.code === '23505') return { ok: false, code: 'SLOTS_UNAVAILABLE' };
    throw error;
  }
}

async function cancelFlexiblePackageBookingTransaction({ connectionString, learnerId, schoolId, bookingId, eligibleReturn }) {
  return withNeonTransaction(connectionString, async client => {
    const bookingResult = await client.query(
      `SELECT id, status, minutes_deducted, cancelled_at, credit_forfeited
         FROM lesson_bookings
        WHERE id = $1 AND learner_id = $2 AND school_id = $3
        FOR UPDATE`,
      [bookingId, learnerId, schoolId]
    );
    const booking = bookingResult.rows[0];
    if (!booking) abort({ code: 'BOOKING_NOT_FOUND' });
    const allocations = await client.query(
      `SELECT a.id, a.units_allocated
         FROM flexible_package_booking_allocations a
        WHERE a.booking_id = $1 AND a.school_id = $2
        ORDER BY a.id
        FOR SHARE OF a`,
      [bookingId, schoolId]
    );
    if (!allocations.rowCount) abort({ code: 'NOT_FLEXIBLE_PACKAGE_BOOKING' });

    const units = allocations.rows.reduce((sum, row) => sum + Number(row.units_allocated), 0);
    if (booking.status === REFUNDED) {
      const returned = await client.query(
        `SELECT COALESCE(SUM(ar.units_returned),0)::int AS units
           FROM flexible_package_allocation_returns ar
           JOIN flexible_package_booking_allocations a
             ON a.id = ar.allocation_id AND a.school_id = ar.school_id
          WHERE a.booking_id = $1 AND a.school_id = $2`,
        [bookingId, schoolId]
      );
      if (Number(returned.rows[0]?.units || 0) !== units) abort({ code: 'BOOKING_RETURN_CONTRADICTION' });
      const balance = await client.query(
        `SELECT COALESCE(SUM(remaining_units),0)::int AS remaining_units
           FROM flexible_package_source_remaining
          WHERE school_id = $1 AND learner_id = $2`,
        [schoolId, learnerId]
      );
      return { ok: true, eligibleReturn: true, idempotent: true, units,
        minutesReturned: units * FLEXIBLE_UNIT_MINUTES,
        remainingUnits: Number(balance.rows[0]?.remaining_units || 0) };
    }
    if (booking.status === SCHEDULED && booking.cancelled_at && booking.credit_forfeited === true) {
      const balance = await client.query(
        `SELECT COALESCE(SUM(remaining_units),0)::int AS remaining_units
           FROM flexible_package_source_remaining
          WHERE school_id = $1 AND learner_id = $2`,
        [schoolId, learnerId]
      );
      return { ok: true, eligibleReturn: false, idempotent: true, units,
        minutesReturned: 0, remainingUnits: Number(balance.rows[0]?.remaining_units || 0) };
    }
    if (booking.status !== SCHEDULED) abort({ code: 'BOOKING_NOT_CANCELLABLE' });

    if (eligibleReturn) {
      await client.query(
        `UPDATE lesson_bookings
            SET status = $1, cancelled_at = NOW(), credit_returned = FALSE, credit_forfeited = FALSE
          WHERE id = $2 AND school_id = $3 AND status = $4`,
        [REFUNDED, bookingId, schoolId, SCHEDULED]
      );
      for (const allocation of allocations.rows) {
        await client.query(
          `INSERT INTO flexible_package_allocation_returns (
             school_id, allocation_id, booking_id, units_returned, reason
           ) VALUES ($1,$2,$3,$4,'learner_cancelled_48h_plus')
           ON CONFLICT (allocation_id) DO NOTHING`,
          [schoolId, allocation.id, bookingId, allocation.units_allocated]
        );
      }
    } else {
      await client.query(
        `UPDATE lesson_bookings
            SET cancelled_at = NOW(), credit_returned = FALSE, credit_forfeited = TRUE
          WHERE id = $1 AND school_id = $2 AND status = $3`,
        [bookingId, schoolId, SCHEDULED]
      );
    }
    await client.query(
      `INSERT INTO flexible_package_state_events (
         school_id, learner_id, event_type, booking_id, detail
       ) VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [
        schoolId, learnerId,
        eligibleReturn ? 'eligible_cancellation_returned' : 'late_cancellation_consumed',
        bookingId,
        JSON.stringify({ units, unit_minutes: FLEXIBLE_UNIT_MINUTES }),
      ]
    );
    const balance = await client.query(
      `SELECT COALESCE(SUM(remaining_units),0)::int AS remaining_units
         FROM flexible_package_source_remaining
        WHERE school_id = $1 AND learner_id = $2`,
      [schoolId, learnerId]
    );
    return {
      ok: true,
      eligibleReturn,
      idempotent: false,
      units,
      minutesReturned: eligibleReturn ? units * FLEXIBLE_UNIT_MINUTES : 0,
      remainingUnits: Number(balance.rows[0]?.remaining_units || 0),
    };
  }).catch(error => {
    if (error instanceof FlexiblePackageAbort) return error.result;
    throw error;
  });
}

module.exports = {
  FLEXIBLE_UNIT_MINUTES,
  bookFlexiblePackageSlotTransaction,
  cancelFlexiblePackageBookingTransaction,
  hoursUntilFlexibleLesson,
  planFlexiblePackageFifo,
  unitsForDuration,
};
