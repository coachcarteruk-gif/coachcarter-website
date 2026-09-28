'use strict';

const crypto = require('crypto');
const { withNeonTransaction } = require('./_db-transaction');
const { loadLockedFlexibleSources, planFlexiblePackageFifo, insertFlexiblePackageBooking, unitsForDuration } = require('./_flexible-package-ledger');

class WeeklyBookingError extends Error {
  constructor(code, message, status = 409, extra = {}) {
    super(message);
    Object.assign(this, { code, status, extra });
  }
}

function parseWeeklyBooking(body = {}) {
  const instructorId = Number(body.instructor_id);
  const lessonTypeId = Number(body.lesson_type_id);
  const lessons = Number(body.repeat_weeks);
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  const date = String(body.date || '');
  const dateObject = new Date(date + 'T00:00:00Z');
  if (!Number.isSafeInteger(instructorId) || instructorId <= 0
      || !Number.isSafeInteger(lessonTypeId) || lessonTypeId <= 0
      || !Number.isInteger(lessons) || lessons < 2 || lessons > 4
      || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(dateObject.getTime())
      || dateObject.toISOString().slice(0, 10) !== date
      || !time.test(body.start_time) || !time.test(body.end_time)
      || !['manual', 'automatic', 'both'].includes(body.transmission_type)
      || body.funding_method !== 'flexible_package'
      || body.social_video_consent === true || body.social_video_age_confirmed === true) {
    throw new WeeklyBookingError('INVALID_WEEKLY_BOOKING', 'Choose 2–4 weekly lessons using Flexible Hours.', 400);
  }
  const minutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  const durationMinutes = minutes(body.end_time) - minutes(body.start_time);
  if (!unitsForDuration(durationMinutes)) {
    throw new WeeklyBookingError('FLEXIBLE_DURATION_INCOMPATIBLE', 'Choose a lesson length in 30-minute units.', 400);
  }
  const address = value => typeof value === 'string' ? value.trim() : '';
  const pickupAddress = address(body.pickup_address);
  const dropoffAddress = address(body.dropoff_address) || null;
  if (!pickupAddress || pickupAddress.length > 500 || (dropoffAddress && dropoffAddress.length > 500)) {
    throw new WeeklyBookingError('INVALID_PICKUP', 'Choose a valid pickup address.', 400);
  }
  const dates = Array.from({ length: lessons }, (_, index) => {
    const next = new Date(dateObject);
    next.setUTCDate(next.getUTCDate() + index * 7);
    return next.toISOString().slice(0, 10);
  });
  return { instructorId, lessonTypeId, dates, startTime: body.start_time, endTime: body.end_time,
    durationMinutes, pickupAddress, dropoffAddress, transmissionType: body.transmission_type };
}

function fingerprint(input) {
  return crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function taggedClient(client) {
  return async (strings, ...values) => (await client.query(
    strings.reduce((query, part, index) => query + (index ? '$' + index : '') + part, ''), values
  )).rows;
}

async function weeklySchemaReady(sql) {
  const [schema] = await sql`
    SELECT EXISTS (SELECT 1 FROM pg_attribute
      WHERE attrelid = 'lesson_bookings'::regclass
        AND attname = 'flexible_package_weekly_request_id' AND NOT attisdropped)
      AND to_regclass('public.uq_flexible_weekly_request') IS NOT NULL AS ready`;
  return schema?.ready === true;
}

async function remainingMinutes(client, schoolId, learnerId) {
  const balance = await client.query(`SELECT COALESCE(SUM(remaining_units),0)::numeric AS units
    FROM flexible_package_source_remaining WHERE school_id=$1 AND learner_id=$2 AND available_at<=NOW()`, [schoolId, learnerId]);
  return Math.round(Number(balance.rows[0]?.units || 0) * 30);
}

function bookingResponse(bookings, minutes, reused) {
  return { ok: true, reused, funding_method: 'flexible_package', booking_id: bookings[0].id,
    booking_ids: bookings.map(b => b.id), dates: bookings.map(b => b.scheduled_date),
    bookings, flexible_package_remaining_minutes: minutes };
}

async function commitWeeklyBooking({ connectionString, schoolId, learnerId, input, clientRequestId,
  validateSlots, transaction = withNeonTransaction }) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(clientRequestId || ''))) {
    throw new WeeklyBookingError('FLEXIBLE_BOOKING_REQUEST_ID_REQUIRED', 'A weekly booking request identity is required.', 400);
  }
  const requestId = clientRequestId.toLowerCase();
  return transaction(connectionString, async client => {
    const learner = await client.query('SELECT id FROM learner_users WHERE id=$1 AND school_id=$2 FOR UPDATE', [learnerId, schoolId]);
    if (!learner.rowCount) throw new WeeklyBookingError('LEARNER_NOT_FOUND', 'Learner not found.', 404);
    const existing = await client.query(`SELECT detail FROM flexible_package_state_events
      WHERE school_id=$1 AND learner_id=$2 AND event_type='weekly_bookings_created'
        AND detail->>'client_request_id'=$3`, [schoolId, learnerId, requestId]);
    if (existing.rowCount) {
      const saved = existing.rows[0].detail;
      if (saved.fingerprint !== fingerprint(input)) {
        throw new WeeklyBookingError('FLEXIBLE_BOOKING_REQUEST_MISMATCH', 'This request was already used for different weekly lessons.');
      }
      return bookingResponse(saved.bookings, await remainingMinutes(client, schoolId, learnerId), true);
    }
    // The database triggers use this same instructor lock for booking and hold
    // writes, including writers outside this endpoint (migration 074).
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('flexible-weekly:' || $1::text || ':' || $2::text, 0))`, [schoolId, input.instructorId]);
    const instructor = await client.query(`SELECT id FROM instructors WHERE id=$1 AND school_id=$2
      AND active=TRUE AND COALESCE(request_to_book,FALSE)=FALSE FOR SHARE`, [input.instructorId, schoolId]);
    if (!instructor.rowCount) throw new WeeklyBookingError('INSTRUCTOR_NOT_ELIGIBLE', 'This instructor is not available for instant booking.');
    await client.query('SELECT id FROM lesson_types WHERE id=$1 AND school_id=$2 FOR SHARE', [input.lessonTypeId, schoolId]);
    const preview = await validateSlots(taggedClient(client), input, { schoolId, learnerId });
    if (!preview.can_commit) {
      throw new WeeklyBookingError('SLOTS_UNAVAILABLE', 'Some weekly dates are no longer available. Choose fewer lessons or another time.', 409, { conflicts: preview.conflicts });
    }
    const sources = (await loadLockedFlexibleSources(client, { schoolId, learnerId })).rows;
    const totalUnits = unitsForDuration(input.durationMinutes) * input.dates.length;
    const wholePlan = planFlexiblePackageFifo(sources, totalUnits);
    if (!wholePlan.ok) {
      if (wholePlan.code === 'INSUFFICIENT_FLEXIBLE_UNITS') {
        throw new WeeklyBookingError(wholePlan.code, 'Not enough Flexible Hours for these weekly lessons. Choose fewer lessons.', 402);
      }
      throw new WeeklyBookingError(wholePlan.code, 'The package source value could not be verified. Please contact support.');
    }
    const bookings = [];
    for (const date of input.dates) {
      const plan = planFlexiblePackageFifo(sources, unitsForDuration(input.durationMinutes));
      if (!plan.ok) throw new WeeklyBookingError(plan.code, 'The package balance changed. Please refresh.');
      bookings.push(await insertFlexiblePackageBooking(client, {
        ...input, date, schoolId, learnerId, clientRequestId: crypto.randomUUID(),
        weeklyRequestId: requestId, plan, transmissionType: preview.transmission_type || input.transmissionType,
      }));
      for (const allocation of plan.allocations) {
        const source = sources.find(s => Number(s.id) === allocation.source_id);
        source.remaining_units = Number(source.remaining_units) - allocation.units;
        source.remaining_value_pence = Number(source.remaining_value_pence) - allocation.contribution_pence;
      }
    }
    await client.query(`INSERT INTO flexible_package_state_events(school_id,learner_id,event_type,detail)
      VALUES($1,$2,'weekly_bookings_created',$3::jsonb)`, [schoolId, learnerId, JSON.stringify({
      client_request_id: requestId, fingerprint: fingerprint(input), bookings,
      required_minutes: input.durationMinutes * input.dates.length,
    })]);
    await client.query('UPDATE learner_users SET last_activity_at=NOW() WHERE id=$1 AND school_id=$2', [learnerId, schoolId]);
    return bookingResponse(bookings, await remainingMinutes(client, schoolId, learnerId), false);
  });
}

module.exports = { WeeklyBookingError, parseWeeklyBooking, commitWeeklyBooking, weeklySchemaReady, taggedClient };
