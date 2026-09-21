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
  let remaining = required * FLEXIBLE_UNIT_MINUTES;
  const allocations = [];
  for (const source of sources || []) {
    const available = Math.max(0, Math.round(Number(source.remaining_units || 0) * FLEXIBLE_UNIT_MINUTES));
    if (!available || remaining <= 0) continue;
    const minutes = Math.min(available, remaining);
    const units = minutes / FLEXIBLE_UNIT_MINUTES;
    const rate = Number(source.rate_pence_per_unit);
    const remainingValuePence = source.remaining_value_pence == null
      ? Math.round((available / FLEXIBLE_UNIT_MINUTES) * rate)
      : Number(source.remaining_value_pence);
    if (!Number.isFinite(rate) || rate <= 0 || !Number.isSafeInteger(Math.round(rate * 1e6))) {
      return { ok: false, code: 'INVALID_SOURCE_RATE', source_id: source.id, allocations: [] };
    }
    if (!Number.isSafeInteger(remainingValuePence) || remainingValuePence < 0) {
      return { ok: false, code: 'INVALID_SOURCE_VALUE', source_id: source.id, allocations: [] };
    }
    const availableUnits = available / FLEXIBLE_UNIT_MINUTES;
    const contributionPence = units === availableUnits
      ? remainingValuePence
      : Math.round(units * remainingValuePence / availableUnits);
    allocations.push({
      source_id: Number(source.id),
      units,
      rate_pence_per_unit: rate,
      contribution_pence: contributionPence,
    });
    remaining -= minutes;
  }
  if (remaining > 0) {
    return { ok: false, code: 'INSUFFICIENT_FLEXIBLE_UNITS', shortage_units: remaining / FLEXIBLE_UNIT_MINUTES, allocations: [] };
  }
  return {
    ok: true,
    units: required,
    allocations,
    contribution_pence: allocations.reduce((sum, row) => sum + row.contribution_pence, 0),
  };
}

async function loadLockedFlexibleSources(client, { schoolId, learnerId }) {
  return client.query(
    `SELECT s.id, s.rate_pence_per_unit,
            GREATEST(0, s.original_value_pence
              - COALESCE((SELECT SUM(r.gross_refund_pence) FROM flexible_package_source_reductions r
                           WHERE r.source_id = s.id AND r.school_id = $1), 0)
              - COALESCE((SELECT SUM(a.contribution_pence)
                            FROM flexible_package_booking_allocations a
                           WHERE a.source_id = s.id AND a.school_id = $1
                             AND NOT EXISTS (
                               SELECT 1 FROM flexible_package_allocation_returns ar
                                WHERE ar.allocation_id = a.id AND ar.school_id = a.school_id
                             )), 0)
            )::integer AS remaining_value_pence,
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
            )::numeric AS remaining_units
       FROM flexible_package_sources s
      WHERE s.school_id = $1 AND s.learner_id = $2 AND s.available_at <= NOW()
      ORDER BY s.available_at ASC, s.id ASC
      FOR UPDATE OF s`,
    [schoolId, learnerId]
  );
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
  createdBy = 'learner',
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
                COALESCE(SUM(a.units_allocated),0)::numeric AS allocated_units
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
            || Math.round(Number(row.allocated_units) * FLEXIBLE_UNIT_MINUTES) !== Number(durationMinutes)) {
          abort({ code: 'FLEXIBLE_BOOKING_REQUEST_MISMATCH' });
        }
        const balance = await client.query(
          `SELECT COALESCE(SUM(remaining_units),0)::numeric AS remaining_units
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

      const sources = await loadLockedFlexibleSources(client, { schoolId, learnerId });
      const plan = planFlexiblePackageFifo(sources.rows, unitsRequired);
      if (!plan.ok) abort(plan);

      const inserted = await client.query(
        `INSERT INTO lesson_bookings (
           learner_id, instructor_id, scheduled_date, start_time, end_time, status,
           pickup_address, dropoff_address, lesson_type_id, transmission_type,
           minutes_deducted, school_id, payment_method, stripe_fee_pence,
           stripe_fee_source, list_price_pence, list_price_source
           , flexible_package_booking_request_id, created_by
         ) VALUES (
           $1, $2, $3::date, $4::time, $5::time, $6,
           $7, $8, $9, $10, $11, $12, 'flexible_package', 0,
           'platform_absorbed_package_fee', $13, 'flexible_package_frozen_rate', $14::uuid, $15
         )
         RETURNING id, scheduled_date::text, start_time::text, end_time::text, status, created_at`,
        [
          learnerId, instructorId, date, startTime, endTime, SCHEDULED,
          pickupAddress || null, dropoffAddress || null, lessonTypeId || null,
          transmissionType, Number(durationMinutes), schoolId, plan.contribution_pence, clientRequestId, createdBy,
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
        `SELECT COALESCE(SUM(remaining_units),0)::numeric AS remaining_units
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

// Caller holds the learner, offer and booking locks in one transaction. Append
// only the extra units: historical allocations keep their original identities.
async function allocateFlexibleExtensionWithClient(client, { booking, extensionMinutes, offerId }) {
  const schoolId = Number(booking.school_id);
  const learnerId = Number(booking.learner_id);
  const instructorId = Number(booking.instructor_id);
  const unitsRequired = unitsForDuration(extensionMinutes);
  if (!unitsRequired || booking.payment_method !== 'flexible_package') {
    return { ok: false, code: 'FLEXIBLE_EXTENSION_FUNDING_REQUIRED' };
  }
  const allocations = await client.query(
    `SELECT a.id, a.learner_id, a.instructor_id, a.units_allocated, a.unit_minutes, a.contribution_pence
       FROM flexible_package_booking_allocations a
      WHERE a.booking_id = $1 AND a.school_id = $2
        AND NOT EXISTS (SELECT 1 FROM flexible_package_allocation_returns r
                         WHERE r.allocation_id = a.id AND r.school_id = a.school_id)
      ORDER BY a.id FOR SHARE OF a`,
    [booking.id, schoolId]
  );
  const mixed = await client.query(
    `SELECT 1 FROM booking_credit_sources
      WHERE booking_id = $1 AND school_id = $2 AND refunded_at IS NULL LIMIT 1`,
    [booking.id, schoolId]
  );
  if (mixed.rowCount) return { ok: false, code: 'FLEXIBLE_MIXED_FUNDING_CONTRADICTION' };
  const oldMinutes = allocations.rows.reduce((sum, row) => sum + Number(row.units_allocated) * Number(row.unit_minutes), 0);
  const oldValue = allocations.rows.reduce((sum, row) => sum + Number(row.contribution_pence), 0);
  const minutes = time => { const [h, m] = String(time).split(':').map(Number); return h * 60 + m; };
  if (!allocations.rowCount || allocations.rows.some(row => Number(row.learner_id) !== learnerId
      || Number(row.instructor_id) !== instructorId || Number(row.unit_minutes) !== FLEXIBLE_UNIT_MINUTES)
      || oldMinutes !== Number(booking.minutes_deducted)
      || oldMinutes !== minutes(booking.end_time) - minutes(booking.start_time)
      || booking.list_price_pence == null || oldValue !== Number(booking.list_price_pence)) {
    return { ok: false, code: 'FLEXIBLE_ALLOCATION_VALUE_CONTRADICTION' };
  }
  const sources = await loadLockedFlexibleSources(client, { schoolId, learnerId });
  const plan = planFlexiblePackageFifo(sources.rows, unitsRequired);
  if (!plan.ok) return plan;
  for (const allocation of plan.allocations) {
    await client.query(
      `INSERT INTO flexible_package_booking_allocations (
         school_id, learner_id, source_id, booking_id, instructor_id,
         units_allocated, unit_minutes, rate_pence_per_unit, contribution_pence
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [schoolId, learnerId, allocation.source_id, booking.id, instructorId,
        allocation.units, FLEXIBLE_UNIT_MINUTES, allocation.rate_pence_per_unit, allocation.contribution_pence]
    );
  }
  await client.query(
    `INSERT INTO flexible_package_state_events (school_id, learner_id, event_type, booking_id, detail)
     VALUES ($1,$2,'booking_extended',$3,$4::jsonb)`,
    [schoolId, learnerId, booking.id, JSON.stringify({ offer_id: offerId, instructor_id: instructorId,
      minutes: extensionMinutes, contribution_pence: plan.contribution_pence, allocations: plan.allocations })]
  );
  return { ok: true, contributionPence: plan.contribution_pence };
}

const FLEXIBLE_RETURN_REASONS = new Set([
  'learner_cancelled_48h_plus',
  'admin_eligible_cancellation',
]);

async function cancelFlexiblePackageBookingWithClient(client, {
  learnerId,
  instructorId = null,
  schoolId,
  bookingId,
  eligibleReturn,
  allowedStatuses = [SCHEDULED],
  returnReason = 'learner_cancelled_48h_plus',
  eventType = null,
  cancellationNote = null,
}) {
    if (eligibleReturn && !FLEXIBLE_RETURN_REASONS.has(returnReason)) {
      abort({ code: 'FLEXIBLE_RETURN_REASON_INVALID' });
    }
    const permittedStatuses = [...new Set((allowedStatuses || []).map(String))];
    if (!permittedStatuses.length) abort({ code: 'BOOKING_NOT_CANCELLABLE' });
    const bookingResult = await client.query(
      `SELECT id, status, instructor_id, minutes_deducted, cancelled_at, credit_forfeited
         FROM lesson_bookings
        WHERE id = $1 AND learner_id = $2 AND school_id = $3
          AND ($4::integer IS NULL OR instructor_id = $4)
        FOR UPDATE`,
      [bookingId, learnerId, schoolId, instructorId]
    );
    const booking = bookingResult.rows[0];
    if (!booking) abort({ code: 'BOOKING_NOT_FOUND' });
    const allocations = await client.query(
      `SELECT a.id, a.units_allocated, a.unit_minutes,
              EXISTS (
                SELECT 1 FROM flexible_package_allocation_returns returned
                 WHERE returned.allocation_id = a.id
                   AND returned.school_id = a.school_id
              ) AS returned
         FROM flexible_package_booking_allocations a
        WHERE a.booking_id = $1 AND a.school_id = $2 AND a.learner_id = $3
        ORDER BY a.id
        FOR SHARE OF a`,
      [bookingId, schoolId, learnerId]
    );
    if (!allocations.rowCount) abort({ code: 'NOT_FLEXIBLE_PACKAGE_BOOKING' });

    const activeAllocations = allocations.rows.filter(row => row.returned !== true);
    const activeUnits = activeAllocations.reduce((sum, row) => sum + Number(row.units_allocated), 0);
    const activeMinutes = Math.round(activeAllocations.reduce(
      (sum, row) => sum + Number(row.units_allocated) * Number(row.unit_minutes),
      0
    ));
    if (booking.status === REFUNDED) {
      if (activeAllocations.length) abort({ code: 'BOOKING_RETURN_CONTRADICTION' });
      const returnedUnits = allocations.rows.reduce((sum, row) => sum + Number(row.units_allocated), 0);
      const balance = await client.query(
        `SELECT COALESCE(SUM(remaining_units),0)::numeric AS remaining_units
           FROM flexible_package_source_remaining
          WHERE school_id = $1 AND learner_id = $2`,
        [schoolId, learnerId]
      );
      return { ok: true, eligibleReturn: true, idempotent: true, units: returnedUnits,
        minutesReturned: Math.round(returnedUnits * FLEXIBLE_UNIT_MINUTES),
        remainingUnits: Number(balance.rows[0]?.remaining_units || 0) };
    }
    if (booking.status === SCHEDULED && booking.cancelled_at && booking.credit_forfeited === true) {
      const balance = await client.query(
        `SELECT COALESCE(SUM(remaining_units),0)::numeric AS remaining_units
           FROM flexible_package_source_remaining
          WHERE school_id = $1 AND learner_id = $2`,
        [schoolId, learnerId]
      );
      return { ok: true, eligibleReturn: false, idempotent: true, units: activeUnits,
        minutesReturned: 0, remainingUnits: Number(balance.rows[0]?.remaining_units || 0) };
    }
    if (!permittedStatuses.includes(booking.status)) abort({ code: 'BOOKING_NOT_CANCELLABLE' });

    const mixedFunding = await client.query(
      `SELECT 1
         FROM booking_credit_sources
        WHERE booking_id = $1 AND school_id = $2 AND refunded_at IS NULL
        LIMIT 1`,
      [bookingId, schoolId]
    );
    if (mixedFunding.rowCount) abort({ code: 'FLEXIBLE_MIXED_FUNDING_CONTRADICTION' });
    if (!activeAllocations.length || activeMinutes !== Number(booking.minutes_deducted || 0)) {
      abort({ code: 'FLEXIBLE_ALLOCATION_DURATION_CONTRADICTION' });
    }

    if (eligibleReturn) {
      await client.query(
        `UPDATE lesson_bookings
            SET status = $1, cancelled_at = NOW(), credit_returned = FALSE,
                credit_forfeited = FALSE,
                instructor_notes = CASE
                  WHEN $5::text IS NULL THEN instructor_notes
                  WHEN NULLIF(BTRIM(instructor_notes), '') IS NULL THEN $5::text
                  ELSE instructor_notes || E'\\n' || $5::text
                END
          WHERE id = $2 AND school_id = $3 AND status = ANY($4::text[])`,
        [REFUNDED, bookingId, schoolId, permittedStatuses, cancellationNote]
      );
      for (const allocation of activeAllocations) {
        await client.query(
          `INSERT INTO flexible_package_allocation_returns (
             school_id, allocation_id, booking_id, units_returned, reason
           ) VALUES ($1,$2,$3,$4,$5)
            ON CONFLICT (allocation_id) DO NOTHING`,
          [schoolId, allocation.id, bookingId, allocation.units_allocated, returnReason]
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
        eventType || (eligibleReturn ? 'eligible_cancellation_returned' : 'late_cancellation_consumed'),
        bookingId,
        JSON.stringify({
          units: activeUnits,
          unit_minutes: FLEXIBLE_UNIT_MINUTES,
          return_reason: eligibleReturn ? returnReason : null,
          instructor_id: Number(booking.instructor_id),
        }),
      ]
    );
    const balance = await client.query(
      `SELECT COALESCE(SUM(remaining_units),0)::numeric AS remaining_units
         FROM flexible_package_source_remaining
        WHERE school_id = $1 AND learner_id = $2`,
      [schoolId, learnerId]
    );
    return {
      ok: true,
      eligibleReturn,
      idempotent: false,
      units: activeUnits,
      minutesReturned: eligibleReturn ? activeMinutes : 0,
      remainingUnits: Number(balance.rows[0]?.remaining_units || 0),
    };
}

async function cancelFlexiblePackageBookingTransaction(args) {
  return withNeonTransaction(args.connectionString, async client => {
    return cancelFlexiblePackageBookingWithClient(client, args);
  }).catch(error => {
    if (error instanceof FlexiblePackageAbort) return error.result;
    throw error;
  });
}

async function moveFlexiblePackageBookingAllocations(client, {
  learnerId,
  schoolId,
  oldBookingId,
  newBookingId,
  newInstructorId,
}) {
  const oldBooking = await client.query(
    `SELECT id, instructor_id, minutes_deducted, status
       FROM lesson_bookings
      WHERE id = $1 AND learner_id = $2 AND school_id = $3
      FOR UPDATE`,
    [oldBookingId, learnerId, schoolId]
  );
  const newBooking = await client.query(
    `SELECT id, instructor_id, minutes_deducted, status
       FROM lesson_bookings
      WHERE id = $1 AND learner_id = $2 AND school_id = $3`,
    [newBookingId, learnerId, schoolId]
  );
  const mixedFunding = await client.query(
    `SELECT 1
       FROM booking_credit_sources
      WHERE booking_id = $1 AND school_id = $2 AND refunded_at IS NULL
      LIMIT 1`,
    [oldBookingId, schoolId]
  );
  if (!oldBooking.rowCount || oldBooking.rows[0].status !== SCHEDULED) {
    abort({ code: 'BOOKING_CHANGED', message: 'This lesson is no longer available to reschedule.' });
  }
  if (!newBooking.rowCount
      || Number(newBooking.rows[0].instructor_id) !== Number(newInstructorId)
      || newBooking.rows[0].status !== SCHEDULED) {
    abort({ code: 'FLEXIBLE_REPLACEMENT_BOOKING_MISMATCH', message: 'The replacement lesson could not be verified safely.' });
  }
  if (mixedFunding.rowCount) {
    abort({ code: 'FLEXIBLE_MIXED_FUNDING_CONTRADICTION', message: 'A Flexible Hours lesson cannot also use Lesson Credit.' });
  }

  const allocations = await client.query(
    `SELECT a.id, a.source_id, a.units_allocated, a.unit_minutes,
            a.rate_pence_per_unit, a.contribution_pence
       FROM flexible_package_booking_allocations a
      WHERE a.booking_id = $1 AND a.school_id = $2 AND a.learner_id = $3
        AND NOT EXISTS (
          SELECT 1 FROM flexible_package_allocation_returns returned
           WHERE returned.allocation_id = a.id AND returned.school_id = a.school_id
        )
      ORDER BY a.id
      FOR SHARE OF a`,
    [oldBookingId, schoolId, learnerId]
  );
  if (!allocations.rowCount) {
    abort({ code: 'NOT_FLEXIBLE_PACKAGE_BOOKING', message: 'No active Flexible Hours allocation was found.' });
  }

  const units = allocations.rows.reduce((sum, row) => sum + Number(row.units_allocated), 0);
  const minutes = Math.round(allocations.rows.reduce(
    (sum, row) => sum + Number(row.units_allocated) * Number(row.unit_minutes),
    0
  ));
  const contributionPence = allocations.rows.reduce(
    (sum, row) => sum + Number(row.contribution_pence),
    0
  );
  if (minutes !== Number(oldBooking.rows[0].minutes_deducted)
      || minutes !== Number(newBooking.rows[0].minutes_deducted)) {
    abort({ code: 'FLEXIBLE_RESCHEDULE_VALUE_CONTRADICTION', message: 'The Flexible Hours value does not match the lesson duration.' });
  }

  for (const allocation of allocations.rows) {
    await client.query(
      `INSERT INTO flexible_package_allocation_returns (
         school_id, allocation_id, booking_id, units_returned, reason
       ) VALUES ($1,$2,$3,$4,'rescheduled_48h_plus')`,
      [schoolId, allocation.id, oldBookingId, allocation.units_allocated]
    );
    await client.query(
      `INSERT INTO flexible_package_booking_allocations (
         school_id, learner_id, source_id, booking_id, instructor_id,
         units_allocated, unit_minutes, rate_pence_per_unit, contribution_pence
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        schoolId, learnerId, allocation.source_id, newBookingId, newInstructorId,
        allocation.units_allocated, allocation.unit_minutes,
        allocation.rate_pence_per_unit, allocation.contribution_pence,
      ]
    );
  }
  await client.query(
    `INSERT INTO flexible_package_state_events (
       school_id, learner_id, event_type, booking_id, detail
     ) VALUES ($1,$2,'booking_rescheduled',$3,$4::jsonb)`,
    [schoolId, learnerId, newBookingId, JSON.stringify({
      old_booking_id: Number(oldBookingId),
      old_instructor_id: Number(oldBooking.rows[0].instructor_id),
      new_instructor_id: Number(newInstructorId),
      units,
      unit_minutes: FLEXIBLE_UNIT_MINUTES,
      contribution_pence: contributionPence,
      notice_rule: '48h_plus',
    })]
  );
  return { units, minutes, contributionPence };
}

module.exports = {
  allocateFlexibleExtensionWithClient,
  FLEXIBLE_UNIT_MINUTES,
  bookFlexiblePackageSlotTransaction,
  cancelFlexiblePackageBookingWithClient,
  cancelFlexiblePackageBookingTransaction,
  hoursUntilFlexibleLesson,
  moveFlexiblePackageBookingAllocations,
  planFlexiblePackageFifo,
  unitsForDuration,
};
